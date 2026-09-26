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
import type { HttpOutcome, HttpRequest } from '../web-retriever/local-fetch.js';
import { type OcrDocument } from './markdown.js';
export declare const PADDLE_OCR_DEFAULT_ENDPOINT = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
export declare const PADDLE_OCR_DEFAULT_MODEL = "PaddleOCR-VL-1.6";
/** 上游文档口径：PDF 默认最多 100 页。超页是**上游会失败**，提前拦比事后猜便宜。 */
export declare const PADDLE_OCR_MAX_PAGES = 100;
export type OcrErrorCode = 'NO_CREDENTIAL' | 'UPSTREAM' | 'JOB_FAILED' | 'RESULT_INVALID' | 'TOO_MANY_PAGES' | 'TIMEOUT';
export declare class OcrError extends Error {
    readonly code: OcrErrorCode;
    constructor(code: OcrErrorCode, message: string);
}
export interface OcrProgress {
    extracted_pages: number;
    total_pages: number;
}
/** 一次轮询看到的作业状态（只保留我们用得上的字段）。 */
export interface OcrJobState {
    state: string;
    progress?: OcrProgress;
    jsonUrl?: string;
    errorMsg?: string;
}
export interface OcrSubmitInput {
    /** 公网可达的 `.pdf` 直链：由**上游**去取文件，本机不落任何字节。 */
    fileUrl?: string;
    /** 本地文档字节（`file` 形态）：走 multipart 上传。 */
    file?: {
        bytes: Uint8Array;
        filename: string;
    };
    charts: boolean;
    signal: AbortSignal;
}
export interface OcrWaitOutcome {
    status: 'done' | 'pending';
    job_id: string;
    progress?: OcrProgress;
    /** `status === 'done'` 时一定有。 */
    document?: OcrDocument;
    json_url?: string;
    elapsed_ms: number;
}
export interface PaddleOcrClientOptions {
    endpoint?: string;
    model?: string;
    resolveToken: () => Promise<string | undefined>;
    request: (request: HttpRequest, signal?: AbortSignal) => Promise<HttpOutcome>;
    pollIntervalMs?: number;
    waitBudgetMs?: number;
    resultMaxBytes?: number;
    /** 注入以便测试：睡眠必须可取消。 */
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    now?: () => number;
}
export interface PaddleOcrClient {
    readonly model: string;
    submit(input: OcrSubmitInput): Promise<string>;
    poll(jobId: string, signal: AbortSignal): Promise<OcrJobState>;
    wait(jobId: string, signal: AbortSignal, progress?: OcrProgress): Promise<OcrWaitOutcome>;
    /** 提交并等到有结果（或自有预算耗尽回 pending）。 */
    parse(input: OcrSubmitInput): Promise<OcrWaitOutcome>;
    load(jsonUrl: string, signal: AbortSignal): Promise<OcrDocument>;
}
export declare function createPaddleOcrClient(options: PaddleOcrClientOptions): PaddleOcrClient;
