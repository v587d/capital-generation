/**
 * PaddleOCR AIStudio **异步 job** 客户端（`ocr` 的上游实现，唯一一份出网实现）。
 *
 * 生命周期（2026-09-25 真报文实测，15 页贵州茅台研报，31 秒完成）：
 * `POST /api/v2/ocr/jobs` → `{code:0,msg:'Success',data:{jobId}}`
 * → `GET /api/v2/ocr/jobs/{jobId}` 轮询 `data.state`：`pending` → `running`
 * （带 `extractProgress.{totalPages,extractedPages}`）→ `done`（带 `resultUrl.jsonUrl`）
 * → `GET jsonUrl` 拿 **JSONL**（每行一个批次，`result.layoutParsingResults[]` 一项一页）。
 *
 * ⛔ 两条只能从真报文里拿到的事实，决定了本文件的形状：
 * 1. **上游把错误装在 HTTP 200 里**：模型名写错返回 `{code:10007,msg:'模型传参错误'}`
 *    且没有 `data.jobId`。只判 `status === 200` 会把失败当成功、`jobId` 变 `undefined`，
 *    然后拿 `undefined` 去轮询——所以每个响应都先看 `code`。
 * 2. **`optionalPayload` 的未知键被静默忽略**（塞 `zzzBogusKey` 照样返回 Success）。
 *    公开文档那页讲的其实是同步 `/layout-parsing`，`mergeTables` / `prettifyMarkdown`
 *    在 jobs 上是否生效无法证明，因此**只传官方示例里出现过的三个键**，
 *    不拿没验证过的开关换"看起来能配"的假象。表格噪音靠 `markdown.ts` 自己处理。
 */
import { buildOcrDocument } from './markdown.js';
export const PADDLE_OCR_DEFAULT_ENDPOINT = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
export const PADDLE_OCR_DEFAULT_MODEL = 'PaddleOCR-VL-1.6';
/** 上游文档口径：PDF 默认最多 100 页。超页是**上游会失败**，提前拦比事后猜便宜。 */
export const PADDLE_OCR_MAX_PAGES = 100;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
/** 自有等待预算必须**小于**工具声明的 `timeoutMs`：留出不确定返回与写盘的余量。 */
const DEFAULT_WAIT_BUDGET_MS = 200_000;
/** 结果 JSONL 的体积上限（实测 15 页 258 KB；上限给到 8 MB 并在超限时响亮失败）。 */
const DEFAULT_RESULT_MAX_BYTES = 8 * 1024 * 1024;
export class OcrError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'OcrError';
    }
}
function asRecord(value) {
    return typeof value === 'object' && value !== null ? value : undefined;
}
function sleepAbortable(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason ?? new Error('aborted'));
            return;
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason ?? new Error('aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
/**
 * 把传输层异常翻成 OCR 错误码。
 *
 * ⚠️ `createHttpRequester` 对 4xx/5xx 抛的是 `LocalFetchError('HTTP', '… returned HTTP 401')`，
 * 状态码只在消息文本里。这里按文本识别鉴权类失败（401/403）**只为了把"该去卡片填 token"
 * 这条最有用的话送到模型面前**；识别不到就退回 `UPSTREAM`，绝不假装知道上游说了什么。
 */
function mapTransportFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP\s*(401|403)\b/u.test(message)) {
        return new OcrError('NO_CREDENTIAL', `PaddleOCR 拒绝鉴权（${message}）：请在 设置 → 插件 → Capital 模式 填写 PaddleOCR Token`);
    }
    return new OcrError('UPSTREAM', message);
}
export function createPaddleOcrClient(options) {
    const endpoint = options.endpoint || PADDLE_OCR_DEFAULT_ENDPOINT;
    const model = options.model || PADDLE_OCR_DEFAULT_MODEL;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const waitBudgetMs = options.waitBudgetMs ?? DEFAULT_WAIT_BUDGET_MS;
    const resultMaxBytes = options.resultMaxBytes ?? DEFAULT_RESULT_MAX_BYTES;
    const sleep = options.sleep ?? sleepAbortable;
    const now = options.now ?? Date.now;
    async function authorizedHeaders() {
        const token = await options.resolveToken();
        if (!token) {
            throw new OcrError('NO_CREDENTIAL', 'PaddleOCR Token 未配置：在 设置 → 插件 → 插件配置 → Capital 模式 填写（credentials 引用 PADDLE_OCR_TOKEN，环境变量同名亦可）');
        }
        return { authorization: `bearer ${token}` };
    }
    /** 发一次请求并**校验 body.code**：上游用 HTTP 200 装业务错误（见文件头 ⛔ 1）。 */
    async function call(request, signal) {
        let outcome;
        try {
            outcome = await options.request(request, signal);
        }
        catch (error) {
            const code = error?.code;
            if (code === 'ABORTED' || (error instanceof Error && error.name === 'AbortError'))
                throw error;
            throw mapTransportFailure(error);
        }
        if (outcome.truncated) {
            throw new OcrError('RESULT_INVALID', `上游响应被体积上限截断（${request.url.slice(0, 80)}）：截断的 JSON 是解析失败，不是少读几条`);
        }
        let parsed;
        try {
            parsed = asRecord(JSON.parse(outcome.text));
        }
        catch {
            throw new OcrError('RESULT_INVALID', `上游返回的不是 JSON（HTTP ${outcome.status}）：${outcome.text.slice(0, 160)}`);
        }
        if (!parsed)
            throw new OcrError('RESULT_INVALID', `上游返回的形状不认识（HTTP ${outcome.status}）`);
        const code = parsed.code;
        if (code !== undefined && code !== 0) {
            const message = typeof parsed.msg === 'string' ? parsed.msg : '(无 msg)';
            if (code === 401)
                throw new OcrError('NO_CREDENTIAL', `PaddleOCR 未鉴权（code 401 ${message}）：请在 设置 → 插件 → Capital 模式 填写 Token`);
            throw new OcrError('UPSTREAM', `PaddleOCR 返回业务错误 code=${String(code)}：${message}`);
        }
        return parsed;
    }
    function optionalPayload(charts) {
        // 只带官方示例出现过的三个键（文件头 ⛔ 2）。
        return { useDocOrientationClassify: false, useDocUnwarping: false, useChartRecognition: charts };
    }
    async function submit(input) {
        const headers = await authorizedHeaders();
        const payload = optionalPayload(input.charts);
        let body;
        let extraHeaders;
        if (input.fileUrl !== undefined) {
            extraHeaders = { 'content-type': 'application/json' };
            body = JSON.stringify({ fileUrl: input.fileUrl, model, optionalPayload: payload });
        }
        else {
            const file = input.file;
            const form = new FormData();
            form.append('model', model);
            form.append('optionalPayload', JSON.stringify(payload));
            // `fs.readBytes` 的返回类型是 `Uint8Array<ArrayBufferLike>`，而 `Blob` 只接受
            // ArrayBuffer 背书的视图；字节确实是新分配的 ArrayBuffer，在边界上收敛一次类型。
            form.append('file', new Blob([file.bytes], { type: 'application/octet-stream' }), file.filename);
            extraHeaders = {};
            body = form;
        }
        // ⛔ `headers`（bearer）与 `extraHeaders`（content-type）**都要**带上：只传后者就等于
        //    把作业提交发成一个无鉴权请求（实测 401），而轮询那条路是带着 token 的——
        //    两条出网路径形状不一致，恰是"只测接好的那个入口"能长期潜伏的形态。
        const parsed = await call({ url: endpoint, method: 'POST', headers: { ...headers, ...extraHeaders }, body }, input.signal);
        const jobId = asRecord(parsed.data)?.jobId;
        if (typeof jobId !== 'string' || jobId.length === 0) {
            throw new OcrError('RESULT_INVALID', `提交成功但响应里没有 data.jobId：${JSON.stringify(parsed).slice(0, 200)}`);
        }
        return jobId;
    }
    async function poll(jobId, signal) {
        const parsed = await call({ url: `${endpoint}/${encodeURIComponent(jobId)}`, headers: await authorizedHeaders() }, signal);
        const data = asRecord(parsed.data);
        if (!data)
            throw new OcrError('RESULT_INVALID', `轮询响应缺 data：${JSON.stringify(parsed).slice(0, 200)}`);
        const state = typeof data.state === 'string' ? data.state : '';
        if (state.length === 0)
            throw new OcrError('RESULT_INVALID', `轮询响应缺 state：${JSON.stringify(data).slice(0, 200)}`);
        const progress = asRecord(data.extractProgress);
        const resultUrl = asRecord(data.resultUrl);
        const outcome = { state };
        if (progress && typeof progress.extractedPages === 'number' && typeof progress.totalPages === 'number') {
            outcome.progress = { extracted_pages: progress.extractedPages, total_pages: progress.totalPages };
        }
        if (typeof resultUrl?.jsonUrl === 'string')
            outcome.jsonUrl = resultUrl.jsonUrl;
        if (typeof data.errorMsg === 'string')
            outcome.errorMsg = data.errorMsg;
        return outcome;
    }
    async function load(jsonUrl, signal) {
        // ⛔ 结果地址是**预签名**的对象存储 URL（实测主机 `paddleocr-store-8.bj.bcebos.com`，与作业
        //    API 不同域）。带上我们的 bearer，BOS 会把它当作待验签请求并索要 `date` 头，直接
        //    HTTP 400 `MissingDateHeader`；不带才拿得下来（实测 200 / 308 KB）。而且把 token 发给
        //    第三方存储域本身就是密钥外流——这条路**只**靠签名过的 URL 鉴权。
        let outcome;
        try {
            outcome = await options.request({ url: jsonUrl, accept: 'application/json', maxBytes: resultMaxBytes, maxContentChars: resultMaxBytes }, signal);
        }
        catch (error) {
            const code = error?.code;
            if (code === 'ABORTED' || (error instanceof Error && error.name === 'AbortError'))
                throw error;
            throw mapTransportFailure(error);
        }
        // 结果 JSONL 单独定上限（15 页实测 258 KB），超限就是真超限，不能继续当完整文档解析。
        if (outcome.truncated) {
            throw new OcrError('RESULT_INVALID', `解析结果超出 ${resultMaxBytes} 字节上限并被截断：整份文档作废，不给半份 markdown`);
        }
        const sourcePages = [];
        for (const line of outcome.text.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.length === 0)
                continue;
            let record;
            try {
                record = asRecord(JSON.parse(trimmed));
            }
            catch {
                throw new OcrError('RESULT_INVALID', `结果 JSONL 有一行不是 JSON（长度 ${trimmed.length}）：整份文档作废`);
            }
            if (!record)
                throw new OcrError('RESULT_INVALID', '结果 JSONL 的某一行不是对象');
            // ⛔ 成功行**也带** `errorMsg`：2026-09-25 实测每行都是 `{errorCode: 0, errorMsg: "Success", …}`。
            //    判据只能是 `errorCode !== 0`——把"有 errorMsg"当失败会把每一份成功解析的文档报成失败。
            const errorCode = record.errorCode;
            const failed = typeof errorCode === 'number' ? errorCode !== 0 : typeof errorCode === 'string' ? errorCode !== '0' && errorCode.length > 0 : false;
            const result = asRecord(record.result);
            const layouts = Array.isArray(result?.layoutParsingResults) ? result.layoutParsingResults : [];
            if (failed) {
                throw new OcrError('JOB_FAILED', `上游批次失败 errorCode=${String(errorCode)}：${typeof record.errorMsg === 'string' && record.errorMsg.length > 0 ? record.errorMsg : '(无 errorMsg)'}`);
            }
            for (const item of layouts) {
                const layout = asRecord(item);
                const markdown = asRecord(layout?.markdown);
                if (typeof markdown?.text !== 'string') {
                    throw new OcrError('RESULT_INVALID', 'layoutParsingResults 的一项缺 markdown.text：不给静默空白页');
                }
                sourcePages.push({
                    page: sourcePages.length + 1,
                    markdown: markdown.text,
                    images: markdown.images && typeof markdown.images === 'object' ? Object.keys(markdown.images).length : 0,
                });
            }
        }
        if (sourcePages.length === 0)
            throw new OcrError('RESULT_INVALID', '上游返回 0 页：空 markdown 会被当成"这篇文档没有内容"，比报错危险');
        if (sourcePages.length > PADDLE_OCR_MAX_PAGES) {
            throw new OcrError('TOO_MANY_PAGES', `解析出 ${sourcePages.length} 页，超出上游 ${PADDLE_OCR_MAX_PAGES} 页口径`);
        }
        return buildOcrDocument(sourcePages);
    }
    async function wait(jobId, signal, prior) {
        const started = now();
        let last = prior;
        let attempts = 0;
        while (true) {
            const elapsed = now() - started;
            if (elapsed >= waitBudgetMs) {
                return { status: 'pending', job_id: jobId, ...(last ? { progress: last } : {}), elapsed_ms: elapsed };
            }
            const state = await poll(jobId, signal);
            attempts += 1;
            if (state.progress)
                last = state.progress;
            if (state.state === 'done') {
                if (!state.jsonUrl)
                    throw new OcrError('RESULT_INVALID', `作业标记 done 但没有 resultUrl.jsonUrl：${jobId}`);
                const document = await load(state.jsonUrl, signal);
                return {
                    status: 'done',
                    job_id: jobId,
                    document,
                    json_url: state.jsonUrl,
                    ...(last ? { progress: last } : {}),
                    elapsed_ms: now() - started,
                };
            }
            if (state.state === 'failed') {
                throw new OcrError('JOB_FAILED', `上游作业失败：${state.errorMsg ?? '(没有 errorMsg 字段)'}`);
            }
            try {
                await sleep(Math.min(pollIntervalMs, Math.max(200, waitBudgetMs - (now() - started))), signal);
            }
            catch (error) {
                const code = error?.code;
                if (code === 'ABORTED' || (error instanceof Error && error.name === 'AbortError'))
                    throw error;
                // 睡眠本身不会失败成别的错误；真出了就算作业状态未知，别硬编成上游错误。
                throw new OcrError('RESULT_INVALID', `轮询等待异常（已轮询 ${attempts} 次）：${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    async function parse(input) {
        const jobId = await submit(input);
        return wait(jobId, input.signal);
    }
    return { model, submit, poll, wait, parse, load };
}
