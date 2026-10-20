/**
 * OCR artifacts live under `capital-data/ocr/<doc_id>/`; the model only gets `doc_id`.
 * Content-addressed ids make a repeat parse a cache hit. `document.md` is written before
 * `meta.json`, so meta's presence means a complete artifact; half-written ones are redone.
 * Page reads reuse the persisted text instead of re-running a paid upstream job.
 */

import type { SessionLike, WorkspaceDatasetStore } from '../data-collector/store.js'
import { DatasetStoreError } from '../data-collector/store.js'
import { WORKSPACE_DATA_DIR } from '../data-collector/store.js'
import type { OcrDocument, OcrPageEntry } from './markdown.js'

export const OCR_ARTIFACT_SUBDIR = `${WORKSPACE_DATA_DIR}/ocr`
export const OCR_DOC_ID_PATTERN = /^ocr_[0-9a-f]{12}$/u

const META_FILE = 'meta.json'
const DOCUMENT_FILE = 'document.md'

/** Read cap for local documents: 100-page reports fit; fail rather than buffer a whole file. */
export const OCR_MAX_SOURCE_BYTES = 32 * 1024 * 1024

/** On-disk metadata; field names match the receipt so disk and model see one truth. */
export interface OcrArtifactMeta {
  doc_id: string
  /** Input identity, `url:` or `file:` (never absolute); empty on resume — never pass job_id off as provenance. */
  source?: string
  source_kind: 'url' | 'file' | 'job'
  job_id: string
  model: string
  /** Chart-recognition flag at submit; unknown on resume, so omitted. */
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
 * No `@types/node` (same `process.getBuiltinModule` idiom as hub/sources). Fail loudly:
 * `doc_id` is a cache key, so a weaker fallback could collide two documents onto one id.
 */
function createHash(algorithm: string): HashLike {
  const processLike = (globalThis as {
    process?: { getBuiltinModule?: (id: string) => { createHash?: (name: string) => HashLike } }
  }).process
  const hash = processLike?.getBuiltinModule?.('node:crypto')?.createHash?.(algorithm)
  if (!hash) throw new Error('node:crypto is unavailable; cannot derive a content-addressed doc_id')
  return hash
}

export function deriveOcrDocId(seed: string | Uint8Array, model: string, charts: boolean): string {
  const hash = createHash('sha1')
  hash.update(seed)
  hash.update(`\u0000${model}\u0000${charts ? 'charts' : 'no-charts'}`)
  return `ocr_${hash.digest('hex').slice(0, 12)}`
}

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

/** Corrupt artifact, not caller error; the repair hint needs the source only this meta holds. */
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
 * `undefined` = never parsed (safe to submit a job). A throw = meta present but body
 * missing/corrupt: do not treat as empty and do not silently re-run (a re-run costs a job).
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

/** `overwrite` only when the caller has already decided to regenerate. */
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

/** Re-validate our own record field by field so a hand-edited file fails loudly. */
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

/** Fail on an unknown provenance: defaulting it to `url` would fabricate attribution. */
function sourceKind(value: unknown): OcrArtifactMeta['source_kind'] {
  if (value === 'url' || value === 'file' || value === 'job') return value
  throw new Error(`meta.source_kind 不认识：${String(value)}`)
}

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
 * `file` entry: workspace-relative only (absolute paths, drive letters and `..` are
 * rejected downstream, then ownership is checked); @mentions show just the path tail.
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
