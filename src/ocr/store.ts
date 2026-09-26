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

import type { SessionLike, WorkspaceDatasetStore } from '../data-collector/store.js'
import { DatasetStoreError } from '../data-collector/store.js'
import { WORKSPACE_DATA_DIR } from '../data-collector/store.js'
import type { OcrDocument, OcrPageEntry } from './markdown.js'

export const OCR_ARTIFACT_SUBDIR = `${WORKSPACE_DATA_DIR}/ocr`
export const OCR_DOC_ID_PATTERN = /^ocr_[0-9a-f]{12}$/u

const META_FILE = 'meta.json'
const DOCUMENT_FILE = 'document.md'

/** 本地文档字节的读取上限：上游 100 页口径下的研报/公告量级，超限宁可报错也不要缓冲整份。 */
export const OCR_MAX_SOURCE_BYTES = 32 * 1024 * 1024

/** 产物元数据（落盘形态）。字段名与回执一致，模型看到的和盘上的不是两份真相。 */
export interface OcrArtifactMeta {
  doc_id: string
  /**
   * 输入指认：`url:<http(s) URL>` 或 `file:<workspace 相对路径>`。**绝不落绝对路径**。
   * 续查（只传 `job_id` + `doc_id`）时本机没有重算种子的输入，此时**留空而不是编一个**——
   * 把作业号写成来源会被当成"这条 URL 就是文档出处"。
   */
  source?: string
  source_kind: 'url' | 'file' | 'job'
  job_id: string
  model: string
  /** 提交时的图表识别开关；续查时无从得知，留空。 */
  charts?: boolean
  pages: number
  chars: number
  images: number
  tables: number
  style_chars_removed: number
  page_entries: OcrPageEntry[]
  created_at: string
}

export interface OcrArtifact {
  meta: OcrArtifactMeta
  document: OcrDocument
}

interface HashLike {
  update(data: string | Uint8Array): HashLike
  digest(encoding: 'hex'): string
}

/**
 * 与 `hub.ts` / `sources.ts` 同一个 `process.getBuiltinModule` 惯用法（本仓刻意不装
 * `@types/node`）。拿不到就**响亮失败**：`doc_id` 是缓存键，退回一个更弱的哈希会让两份不同
 * 文档撞在同一个 `doc_id` 上、把 A 的正文当 B 交出去。
 */
function createHash(algorithm: string): HashLike {
  const processLike = (globalThis as {
    process?: { getBuiltinModule?: (id: string) => { createHash?: (name: string) => HashLike } }
  }).process
  const hash = processLike?.getBuiltinModule?.('node:crypto')?.createHash?.(algorithm)
  if (!hash) throw new Error('node:crypto is unavailable; cannot derive a content-addressed doc_id')
  return hash
}

/** `seed` 由各形态自己拼（URL 文本 / 文件字节），统一在此收敛成 `ocr_<12 hex>`。 */
export function deriveOcrDocId(seed: string | Uint8Array, model: string, charts: boolean): string {
  const hash = createHash('sha1')
  hash.update(seed)
  hash.update(`\u0000${model}\u0000${charts ? 'charts' : 'no-charts'}`)
  return `ocr_${hash.digest('hex').slice(0, 12)}`
}

/** 回执里给模型的 opaque 引用（与 Dataset/profile 引用同一套 `workspace://` 口径）。 */
export function ocrArtifactRef(docId: string): string {
  return `workspace://${OCR_ARTIFACT_SUBDIR}/${docId}`
}

function requireDocId(docId: string): string {
  if (!OCR_DOC_ID_PATTERN.test(docId)) throw new Error('doc_id is invalid: expected ocr_<12 hex characters>')
  return docId
}

function metaPath(docId: string): string {
  return `${OCR_ARTIFACT_SUBDIR}/${requireDocId(docId)}/${META_FILE}`
}

function documentPath(docId: string): string {
  return `${OCR_ARTIFACT_SUBDIR}/${requireDocId(docId)}/${DOCUMENT_FILE}`
}

function isNotFound(error: unknown): boolean {
  return error instanceof DatasetStoreError && error.code === 'dataset_not_found'
}

function isTooLarge(error: unknown): boolean {
  return error instanceof DatasetStoreError && error.code === 'dataset_too_large'
}

/**
 * 落盘产物**自己**坏了（调用方没做错任何事）。
 *
 * 为什么要单独一个类型：翻成回执的那一层要把"下一步该传什么"写清楚，而那一步需要的指认
 * （当初解析用过的 url / file）只有这份 meta 里有。让调用方重新去猜链接，等于把一次
 * 可机械执行的修复推回给人或模型。
 */
export class OcrArtifactError extends Error {
  constructor(
    readonly reason: 'meta_unreadable' | 'meta_invalid' | 'document_missing',
    readonly docId: string,
    readonly sourceKind: OcrArtifactMeta['source_kind'] | undefined,
    readonly source: string | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'OcrArtifactError'
  }
}

/**
 * 读回一份产物。三种"读不到"必须能区分：
 *  - `undefined`：从未解析过（meta 与 document 都不在）——调用方据此决定提交新 job。
 *  - 抛错：meta 在但正文丢失/损坏，或半件产物——**不能**当成"没有内容"，也不能静默重跑
 *    （重跑要花一次 job，用户看不到钱去哪了），交给调用方翻成带 `doc_id` 的失败回执。
 */
export async function readOcrArtifact(
  store: WorkspaceDatasetStore,
  input: { session: SessionLike; doc_id: string; signal?: AbortSignal },
): Promise<OcrArtifact | undefined> {
  const docId = requireDocId(input.doc_id)
  let metaText: string
  try {
    metaText = await store.readWorkspaceText({ session: input.session, path: metaPath(docId), signal: input.signal })
  } catch (error) {
    if (isNotFound(error)) return undefined
    if (isTooLarge(error)) throw error
    throw new OcrArtifactError('meta_unreadable', docId, undefined, undefined, `产物 ${docId} 的 meta.json 读不出来：${error instanceof Error ? error.message : String(error)}`)
  }
  let meta: OcrArtifactMeta
  try {
    meta = normalizeMeta(JSON.parse(metaText), docId)
  } catch (error) {
    throw new OcrArtifactError('meta_invalid', docId, undefined, undefined, `产物 ${docId} 的 meta.json 不是可识别的记录：${error instanceof Error ? error.message : String(error)}`)
  }
  let text: string
  try {
    text = await store.readWorkspaceText({ session: input.session, path: documentPath(docId), signal: input.signal })
  } catch (error) {
    if (isNotFound(error)) {
      throw new OcrArtifactError('document_missing', docId, meta.source_kind, meta.source, `产物 ${docId} 的 document.md 缺失（meta 在、正文不在）`)
    }
    throw error
  }
  return { meta, document: { document: text, pages: meta.page_entries, chars: meta.chars, images: meta.images, tables: meta.tables, styleCharsRemoved: meta.style_chars_removed } }
}

/** 落盘。`overwrite` 只在调用方**已经决定**重新生成时传（见文件头的写入顺序）。 */
export async function writeOcrArtifact(
  store: WorkspaceDatasetStore,
  input: { session: SessionLike; meta: OcrArtifactMeta; document: OcrDocument; signal?: AbortSignal; overwrite?: boolean },
): Promise<{ artifact_ref: string; paths: string[] }> {
  const docId = requireDocId(input.meta.doc_id)
  const written = await store.writeWorkspaceFiles({
    session: input.session,
    dir: `${OCR_ARTIFACT_SUBDIR}/${docId}`,
    files: [
      { name: DOCUMENT_FILE, content: input.document.document },
      { name: META_FILE, content: `${JSON.stringify(input.meta)}\n` },
    ],
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.overwrite ? { overwrite: true } : {}),
  })
  return { artifact_ref: ocrArtifactRef(docId), paths: written.map((file) => file.path) }
}

/** meta 是**我们**写出去的记录，读回来时仍逐字段核一遍——手改过的盘也要能响亮失败。 */
function normalizeMeta(value: unknown, docId: string): OcrArtifactMeta {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const pages = Array.isArray(record.page_entries) ? record.page_entries : []
  const entries: OcrPageEntry[] = pages.map((item) => {
    const page = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    if (typeof page.page !== 'number' || typeof page.start !== 'number' || typeof page.end !== 'number' || typeof page.chars !== 'number') {
      throw new Error('page_entries 项缺字段')
    }
    const heading = typeof page.heading === 'string' ? { heading: page.heading } : {}
    return { page: page.page, start: page.start, end: page.end, chars: page.chars, ...heading }
  })
  const text = (key: string): string => {
    if (typeof record[key] !== 'string') throw new Error(`meta.${key} 不是字符串`)
    return record[key] as string
  }
  const num = (key: string): number => {
    if (typeof record[key] !== 'number') throw new Error(`meta.${key} 不是数字`)
    return record[key] as number
  }
  if (record.doc_id !== docId) throw new Error(`meta.doc_id 与目录不一致（${String(record.doc_id)}）`)
  const source = typeof record.source === 'string' ? { source: record.source } : {}
  const charts = typeof record.charts === 'boolean' ? { charts: record.charts } : {}
  return {
    doc_id: docId,
    ...source,
    source_kind: sourceKind(record.source_kind),
    job_id: text('job_id'),
    model: text('model'),
    ...charts,
    pages: num('pages'),
    chars: num('chars'),
    images: num('images'),
    tables: num('tables'),
    style_chars_removed: num('style_chars_removed'),
    page_entries: entries,
    created_at: text('created_at'),
  }
}

/** 来源类别缺省或写歪时**响亮失败**：把不认识的 provenance 默认成 `url` 会伪造出处。 */
function sourceKind(value: unknown): OcrArtifactMeta['source_kind'] {
  if (value === 'url' || value === 'file' || value === 'job') return value
  throw new Error(`meta.source_kind 不认识：${String(value)}`)
}

/** 拼一条与盘上记录同形状的 meta（`document` 只提供算好的排版统计）。 */
export function buildArtifactMeta(input: {
  doc_id: string
  source?: string
  source_kind: OcrArtifactMeta['source_kind']
  charts?: boolean
  job_id: string
  model: string
  document: OcrDocument
  createdAt: string
}): OcrArtifactMeta {
  return {
    doc_id: requireDocId(input.doc_id),
    ...(input.source === undefined ? {} : { source: input.source }),
    source_kind: input.source_kind,
    job_id: input.job_id,
    model: input.model,
    ...(input.charts === undefined ? {} : { charts: input.charts }),
    pages: input.document.pages.length,
    chars: input.document.chars,
    images: input.document.images,
    tables: input.document.tables,
    style_chars_removed: input.document.styleCharsRemoved,
    page_entries: input.document.pages,
    created_at: input.createdAt,
  }
}

/**
 * 读取**待解析**的本地文档字节（`file` 形态的入口）。
 *
 * 只接受 session workspace 内的相对路径：绝对路径（含 Windows 盘符）与 `..` 段在
 * `normalizeWorkspaceRelativePath` 就被拒，之后仍要过沙箱归属校验。模型从 `@xxx.pdf`
 *  mention 里看到的是路径末段，因此回执话术要求它传 workspace 相对路径。
 */
export async function readOcrSourceBytes(
  store: WorkspaceDatasetStore,
  input: { session: SessionLike; path: string; signal?: AbortSignal },
): Promise<{ bytes: Uint8Array; filename: string }> {
  const bytes = await store.readWorkspaceBytes({
    session: input.session,
    path: input.path,
    maxBytes: OCR_MAX_SOURCE_BYTES,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  const filename = input.path.split('/').pop() ?? 'document'
  return { bytes, filename }
}
