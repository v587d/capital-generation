/**
 * Async PaddleOCR jobs client — the plugin's only OCR egress implementation.
 *
 * Flow: POST job → poll state → fetch result JSONL (one layout result per page).
 *
 * ⛔ Two response-shape facts determine the code below:
 * 1. Business failures arrive as HTTP 200 with `{ code: nonzero, jobId absent }`, so always check `code`.
 * 2. Unknown `optionalPayload` keys are silently ignored; send only documented example keys.
 */
import type { HttpOutcome, HttpRequest } from '../web-retriever/local-fetch.js';
import { type OcrDocument } from './markdown.js';
export declare const PADDLE_OCR_DEFAULT_ENDPOINT = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
export declare const PADDLE_OCR_DEFAULT_MODEL = "PaddleOCR-VL-1.6";
/** Upstream PDF page limit; reject earlier than letting the remote job fail. */
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
/** Poll status, narrowed to fields used here. */
export interface OcrJobState {
    state: string;
    progress?: OcrProgress;
    jsonUrl?: string;
    errorMsg?: string;
}
export interface OcrSubmitInput {
    /** Public PDF URL fetched by the provider; no local bytes are involved. */
    fileUrl?: string;
    /** Local document bytes uploaded as multipart. */
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
    /** Present whenever status is done. */
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
    /** Injectable sleep keeps polling cancellable. */
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    now?: () => number;
}
export interface PaddleOcrClient {
    readonly model: string;
    submit(input: OcrSubmitInput): Promise<string>;
    poll(jobId: string, signal: AbortSignal): Promise<OcrJobState>;
    wait(jobId: string, signal: AbortSignal, progress?: OcrProgress): Promise<OcrWaitOutcome>;
    /** Submit and poll until terminal, or return pending when the wait budget is exhausted. */
    parse(input: OcrSubmitInput): Promise<OcrWaitOutcome>;
    load(jsonUrl: string, signal: AbortSignal): Promise<OcrDocument>;
}
export declare function createPaddleOcrClient(options: PaddleOcrClientOptions): PaddleOcrClient;
