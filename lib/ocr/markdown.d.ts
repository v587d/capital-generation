/**
 * PaddleOCR 输出 → 模型可读 markdown 的归一化（`ocr` 的呈现层，唯一一份实现）。
 *
 * 为什么必须归一化（2026-09-25 拿真报文实测，贵州茅台 15 页研报）：上游把**表格输出成内联
 * HTML**，每个单元格都带 `style='text-align: center; word-wrap: break-word;'`——
 * 105,639 个字符里 63,232 个（60%）是 `style='...'` 样板，去掉再转成 GFM 管道表只剩 27,156。
 * 本仓的场景恰恰是"大量表格、图形"，不处理就等于**预算的六成买的是 HTML 属性**，
 * 而 `prettifyMarkdown` 这类 flag 在上游被静默忽略（未知键也返回 Success），帮不上。
 *
 * 归一化只做**无损排版**：不删正文、不改数字、不做摘要。数字一律照抄上游。
 */
/** 上游一页的解析产物（我们只取 markdown 文本与图片计数）。 */
export interface OcrSourcePage {
    page: number;
    markdown: string;
    images: number;
}
export interface OcrPageEntry {
    page: number;
    /** 该页正文在 `document` 里的起始码点下标（含）。 */
    start: number;
    /** 结束下标（不含）。 */
    end: number;
    chars: number;
    /** 该页第一个标题行（索引用，没有则省略）。 */
    heading?: string;
}
export interface OcrDocument {
    /** 全篇：各页正文以 `<!-- page:N -->` 分隔（渲染不可见，页定位靠它）。 */
    document: string;
    pages: OcrPageEntry[];
    chars: number;
    images: number;
    /** 转成 GFM 的 HTML 表数量。 */
    tables: number;
    /** 剥掉的 style 样板字符数（回执里用来证明"不是截断，是排版噪音"）。 */
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
/** 剥样式 + HTML 表转 GFM + 收空行。对不含 HTML 的正文近似恒等。 */
export declare function normalizeOcrMarkdown(source: string): NormalizedMarkdown;
/** 把逐页 markdown 拼成一份文档，并算出**页偏移索引**（按页取回与关键词定位都靠它）。 */
export declare function buildOcrDocument(sourcePages: OcrSourcePage[]): OcrDocument;
/**
 * 页区间解析：`"1-3"` / `"5"` / `"2-4,9"`（1 起始，闭区间）。
 * 越界页码**响亮失败**而不是静默少给——"这页没有"和"我没给"在回执里必须能区分。
 */
export declare function parsePageRange(spec: string, totalPages: number): number[];
export interface PageExcerpt {
    page: number;
    chars: number;
    heading?: string;
    text: string;
}
/** 按页切出正文（纯字符串切片，不重跑上游）。 */
export declare function selectPages(document: OcrDocument, pages: number[]): PageExcerpt[];
/**
 * 关键词定位：在**已落盘的文档**里找命中，回带页号的上下文片段。
 *
 * 为什么不靠 `pages` 硬读：一份 15 页研报归一化后约 2.7 万字符，而工具输出预算 6,144——
 * 想拿财务预测表就得能"跳着看"。上游页区间不影响算力（整篇都算过），所以定位必须在这份
 * 归一化文本上做，不再出网。
 */
export declare function locateQuery(document: OcrDocument, query: string, limit: number, windowChars: number): OcrHit[];
export { PAGE_MARKER_PREFIX };
