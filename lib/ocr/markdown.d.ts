/**
 * PaddleOCR output -> model-readable markdown (the only implementation). Upstream emits
 * tables as inline HTML with per-cell `style=`, so on a measured 15-page report ~60% of
 * characters were style boilerplate; `prettifyMarkdown`-style flags are silently ignored.
 * Normalization is lossless layout only: no text, numbers or tables are dropped.
 */
/** One page as returned upstream (we use markdown text and image count). */
export interface OcrSourcePage {
    page: number;
    markdown: string;
    images: number;
}
export interface OcrPageEntry {
    page: number;
    /** Code-point offset into `document` (inclusive). */
    start: number;
    /** End offset (exclusive). */
    end: number;
    chars: number;
    /** First heading line on the page, for the index. */
    heading?: string;
}
export interface OcrDocument {
    /** Pages separated by `<!-- page:N -->`; invisible when rendered, used for page lookup. */
    document: string;
    pages: OcrPageEntry[];
    chars: number;
    images: number;
    /** Number of HTML tables converted to GFM. */
    tables: number;
    /** Stripped style characters, so the receipt can prove layout noise, not truncation. */
    styleCharsRemoved: number;
}
export interface OcrHit {
    page: number;
    at: number;
    excerpt: string;
}
declare const PAGE_MARKER_PREFIX = "<!-- page:";
export interface NormalizedMarkdown {
    markdown: string;
    tables: number;
    styleCharsRemoved: number;
}
/** Strip styles, convert HTML tables to GFM, collapse blank lines; near-identity otherwise. */
export declare function normalizeOcrMarkdown(source: string): NormalizedMarkdown;
/** Join per-page markdown and record page offsets, used by page reads and keyword lookup. */
export declare function buildOcrDocument(sourcePages: OcrSourcePage[]): OcrDocument;
/**
 * `"1-3"` / `"5"` / `"2-4,9"` (1-based, inclusive). Out-of-range pages fail loudly:
 * "page absent" and "not requested" must stay distinguishable in the receipt.
 */
export declare function parsePageRange(spec: string, totalPages: number): number[];
export interface PageExcerpt {
    page: number;
    chars: number;
    heading?: string;
    text: string;
}
/** Slice pages out of the stored text; never re-runs upstream. */
export declare function selectPages(document: OcrDocument, pages: number[]): PageExcerpt[];
/**
 * Keyword lookup over the persisted normalized text (no egress): the output budget is
 * smaller than a whole report, so callers must be able to jump. Adjacent hits merge into
 * one window, and windows never cross a page boundary — a miscited page is worse than
 * fewer hits — which also keeps `<!-- page:N -->` markers out of excerpts.
 */
export declare function locateQuery(document: OcrDocument, query: string, limit: number, windowChars: number): OcrHit[];
export { PAGE_MARKER_PREFIX };
