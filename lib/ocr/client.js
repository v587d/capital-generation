/**
 * Async PaddleOCR jobs client — the plugin's only OCR egress implementation.
 *
 * Flow: POST job → poll state → fetch result JSONL (one layout result per page).
 *
 * ⛔ Two response-shape facts determine the code below:
 * 1. Business failures arrive as HTTP 200 with `{ code: nonzero, jobId absent }`, so always check `code`.
 * 2. Unknown `optionalPayload` keys are silently ignored; send only documented example keys.
 */
import { buildOcrDocument } from './markdown.js';
export const PADDLE_OCR_DEFAULT_ENDPOINT = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';
export const PADDLE_OCR_DEFAULT_MODEL = 'PaddleOCR-VL-1.6';
/** Upstream PDF page limit; reject earlier than letting the remote job fail. */
export const PADDLE_OCR_MAX_PAGES = 100;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
/** Wait budget stays below the tool timeout, leaving time for the response and disk write. */
const DEFAULT_WAIT_BUDGET_MS = 200_000;
/** JSONL response cap; exceeding it fails loudly rather than parsing a partial document. */
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
 * Map transport exceptions to OCR codes. `LocalFetchError` carries the HTTP status
 * only in its message, so recognize 401/403 to point at the token card; otherwise
 * fall back to UPSTREAM rather than infer upstream details.
 */
function mapTransportFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP\s*(401|403)\b/u.test(message)) {
        return new OcrError('NO_CREDENTIAL', `PaddleOCR 拒绝鉴权（${message}）：请在 设置 → 插件 → 自动模式填写 PaddleOCR Token`);
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
            throw new OcrError('NO_CREDENTIAL', 'PaddleOCR Token 未配置：在 设置 → 插件 → 插件配置 → 自动模式填写（credentials 引用 PADDLE_OCR_TOKEN，环境变量同名亦可）');
        }
        return { authorization: `bearer ${token}` };
    }
    /** Send and validate `body.code`; HTTP 200 can still be a business error. */
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
                throw new OcrError('NO_CREDENTIAL', `PaddleOCR 未鉴权（code 401 ${message}）：请在 设置 → 插件 → 自动模式填写 Token`);
            throw new OcrError('UPSTREAM', `PaddleOCR 返回业务错误 code=${String(code)}：${message}`);
        }
        return parsed;
    }
    function optionalPayload(charts) {
        // Send only the three documented example keys.
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
            // Narrow the buffer-backed view at this runtime boundary; the bytes are freshly allocated.
            form.append('file', new Blob([file.bytes], { type: 'application/octet-stream' }), file.filename);
            extraHeaders = {};
            body = form;
        }
        // ⛔ Send both bearer and content-type headers; omitting either makes the two egress paths diverge.
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
        // ⛔ Fetch the presigned result URL without our bearer: object storage rejects mixed auth
        // and the token must not leak to a third-party host.
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
        // Cap the result JSONL separately; an oversize response is not a usable document.
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
            // ⛔ Successful rows also carry errorMsg; use errorCode !== 0, not field presence.
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
                // A sleep failure means job state is unknown; do not relabel it as an upstream error.
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
