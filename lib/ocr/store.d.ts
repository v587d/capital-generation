/**
 * `ocr` 的**产物层**：解析结果一律落 `capital-data/ocr/<doc_id>/`，模型侧只拿 `doc_id` 与索引。
 *
 * 为什么必须落盘而不是留在内存：一份 15 页研报归一化后约 2.7 万字符，而工具输出预算
 * 只有 6,144（`SOURCE_OUTPUT_BUDGET_CHARS`）。落盘之后"按页取回 / 关键词定位"才是**纯本地
 * 零花费**的第二、第三次读取；否则每次翻页都要重跑上游、再花一次 job。
 *
 * ```text
 * capital-data/ocr/<doc_id>/
 * ├── meta.json      # 页偏移索引与花费口径（model / charts / job_id / created_at）
 * └── document.md    # 全篇归一化 markdown，页分隔 `<!-- page:N -->`
 * ```
 *
 * `doc_id` 是**内容寻址**的：`sha1(归一化输入 + model + flags)` 前 12 位。因此"同一份文档
 * 重复解析"自动命中缓存不再出网；`refresh` 才强制重跑（上游对同一份 PDF 两次给出过
 * 18% 与 19% 的不同数字，重跑**不是**独立验证，引用必须带 `doc_id` 与 `created_at`）。
 *
 * 写入顺序是 `document.md` → `meta.json`：**meta 的在场即代表产物完整**。中途被中断
 * （超时、取消）留下半件产物时，下一次读取按"未缓存"处理并重写（`overwrite`），
 * 不会把模型永久锁死在一个坏 `doc_id` 上。
 */
import type { SessionLike, WorkspaceDatasetStore } from '../data-collector/store.js';
import type { OcrDocument, OcrPageEntry } from './markdown.js';
export declare const OCR_ARTIFACT_SUBDIR = "capital-data/ocr";
export declare const OCR_DOC_ID_PATTERN: RegExp;
/** 本地文档字节的读取上限：上游 100 页口径下的研报/公告量级，超限宁可报错也不要缓冲整份。 */
export declare const OCR_MAX_SOURCE_BYTES: number;
/** 产物元数据（落盘形态）。字段名与回执一致，模型看到的和盘上的不是两份真相。 */
export interface OcrArtifactMeta {
    doc_id: string;
    /**
     * 输入指认：`url:<http(s) URL>` 或 `file:<workspace 相对路径>`。**绝不落绝对路径**。
     * 续查（只传 `job_id` + `doc_id`）时本机没有重算种子的输入，此时**留空而不是编一个**——
     * 把作业号写成来源会被当成"这条 URL 就是文档出处"。
     */
    source?: string;
    source_kind: 'url' | 'file' | 'job';
    job_id: string;
    model: string;
    /** 提交时的图表识别开关；续查时无从得知，留空。 */
    charts?: boolean;
    pages: number;
    chars: number;
    images: number;
    tables: number;
    style_chars_removed: number;
    page_entries: OcrPageEntry[];
    created_at: string;
}
export interface OcrArtifact {
    meta: OcrArtifactMeta;
    document: OcrDocument;
}
/** `seed` 由各形态自己拼（URL 文本 / 文件字节），统一在此收敛成 `ocr_<12 hex>`。 */
export declare function deriveOcrDocId(seed: string | Uint8Array, model: string, charts: boolean): string;
/** 回执里给模型的 opaque 引用（与 Dataset/profile 引用同一套 `workspace://` 口径）。 */
export declare function ocrArtifactRef(docId: string): string;
/**
 * 落盘产物**自己**坏了（调用方没做错任何事）。
 *
 * 为什么要单独一个类型：翻成回执的那一层要把"下一步该传什么"写清楚，而那一步需要的指认
 * （当初解析用过的 url / file）只有这份 meta 里有。让调用方重新去猜链接，等于把一次
 * 可机械执行的修复推回给人或模型。
 */
export declare class OcrArtifactError extends Error {
    readonly reason: 'meta_unreadable' | 'meta_invalid' | 'document_missing';
    readonly docId: string;
    readonly sourceKind: OcrArtifactMeta['source_kind'] | undefined;
    readonly source: string | undefined;
    constructor(reason: 'meta_unreadable' | 'meta_invalid' | 'document_missing', docId: string, sourceKind: OcrArtifactMeta['source_kind'] | undefined, source: string | undefined, message: string);
}
/**
 * 读回一份产物。三种"读不到"必须能区分：
 *  - `undefined`：从未解析过（meta 与 document 都不在）——调用方据此决定提交新 job。
 *  - 抛错：meta 在但正文丢失/损坏，或半件产物——**不能**当成"没有内容"，也不能静默重跑
 *    （重跑要花一次 job，用户看不到钱去哪了），交给调用方翻成带 `doc_id` 的失败回执。
 */
export declare function readOcrArtifact(store: WorkspaceDatasetStore, input: {
    session: SessionLike;
    doc_id: string;
    signal?: AbortSignal;
}): Promise<OcrArtifact | undefined>;
/** 落盘。`overwrite` 只在调用方**已经决定**重新生成时传（见文件头的写入顺序）。 */
export declare function writeOcrArtifact(store: WorkspaceDatasetStore, input: {
    session: SessionLike;
    meta: OcrArtifactMeta;
    document: OcrDocument;
    signal?: AbortSignal;
    overwrite?: boolean;
}): Promise<{
    artifact_ref: string;
    paths: string[];
}>;
/** 拼一条与盘上记录同形状的 meta（`document` 只提供算好的排版统计）。 */
export declare function buildArtifactMeta(input: {
    doc_id: string;
    source?: string;
    source_kind: OcrArtifactMeta['source_kind'];
    charts?: boolean;
    job_id: string;
    model: string;
    document: OcrDocument;
    createdAt: string;
}): OcrArtifactMeta;
/**
 * 读取**待解析**的本地文档字节（`file` 形态的入口）。
 *
 * 只接受 session workspace 内的相对路径：绝对路径（含 Windows 盘符）与 `..` 段在
 * `normalizeWorkspaceRelativePath` 就被拒，之后仍要过沙箱归属校验。模型从 `@xxx.pdf`
 *  mention 里看到的是路径末段，因此回执话术要求它传 workspace 相对路径。
 */
export declare function readOcrSourceBytes(store: WorkspaceDatasetStore, input: {
    session: SessionLike;
    path: string;
    signal?: AbortSignal;
}): Promise<{
    bytes: Uint8Array;
    filename: string;
}>;
