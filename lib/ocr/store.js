/**
 * OCR artifacts live under `capital-data/ocr/<doc_id>/`; the model only gets `doc_id`.
 * Content-addressed ids make a repeat parse a cache hit. `document.md` is written before
 * `meta.json`, so meta's presence means a complete artifact; half-written ones are redone.
 * Page reads reuse the persisted text instead of re-running a paid upstream job.
 */
import { DatasetStoreError } from '../data-collector/store.js';
import { WORKSPACE_DATA_DIR } from '../data-collector/store.js';
export const OCR_ARTIFACT_SUBDIR = `${WORKSPACE_DATA_DIR}/ocr`;
export const OCR_DOC_ID_PATTERN = /^ocr_[0-9a-f]{12}$/u;
const META_FILE = 'meta.json';
const DOCUMENT_FILE = 'document.md';
/** Read cap for local documents: 100-page reports fit; fail rather than buffer a whole file. */
export const OCR_MAX_SOURCE_BYTES = 32 * 1024 * 1024;
/**
 * No `@types/node` (same `process.getBuiltinModule` idiom as hub/sources). Fail loudly:
 * `doc_id` is a cache key, so a weaker fallback could collide two documents onto one id.
 */
function createHash(algorithm) {
    const processLike = globalThis.process;
    const hash = processLike?.getBuiltinModule?.('node:crypto')?.createHash?.(algorithm);
    if (!hash)
        throw new Error('node:crypto is unavailable; cannot derive a content-addressed doc_id');
    return hash;
}
export function deriveOcrDocId(seed, model, charts) {
    const hash = createHash('sha1');
    hash.update(seed);
    hash.update(`\u0000${model}\u0000${charts ? 'charts' : 'no-charts'}`);
    return `ocr_${hash.digest('hex').slice(0, 12)}`;
}
export function ocrArtifactRef(docId) {
    return `workspace://${OCR_ARTIFACT_SUBDIR}/${docId}`;
}
function requireDocId(docId) {
    if (!OCR_DOC_ID_PATTERN.test(docId))
        throw new Error('doc_id is invalid: expected ocr_<12 hex characters>');
    return docId;
}
function metaPath(docId) {
    return `${OCR_ARTIFACT_SUBDIR}/${requireDocId(docId)}/${META_FILE}`;
}
function documentPath(docId) {
    return `${OCR_ARTIFACT_SUBDIR}/${requireDocId(docId)}/${DOCUMENT_FILE}`;
}
function isNotFound(error) {
    return error instanceof DatasetStoreError && error.code === 'dataset_not_found';
}
function isTooLarge(error) {
    return error instanceof DatasetStoreError && error.code === 'dataset_too_large';
}
/** Corrupt artifact, not caller error; the repair hint needs the source only this meta holds. */
export class OcrArtifactError extends Error {
    reason;
    docId;
    sourceKind;
    source;
    constructor(reason, docId, sourceKind, source, message) {
        super(message);
        this.reason = reason;
        this.docId = docId;
        this.sourceKind = sourceKind;
        this.source = source;
        this.name = 'OcrArtifactError';
    }
}
/**
 * `undefined` = never parsed (safe to submit a job). A throw = meta present but body
 * missing/corrupt: do not treat as empty and do not silently re-run (a re-run costs a job).
 */
export async function readOcrArtifact(store, input) {
    const docId = requireDocId(input.doc_id);
    let metaText;
    try {
        metaText = await store.readWorkspaceText({ session: input.session, path: metaPath(docId), signal: input.signal });
    }
    catch (error) {
        if (isNotFound(error))
            return undefined;
        if (isTooLarge(error))
            throw error;
        throw new OcrArtifactError('meta_unreadable', docId, undefined, undefined, `产物 ${docId} 的 meta.json 读不出来：${error instanceof Error ? error.message : String(error)}`);
    }
    let meta;
    try {
        meta = normalizeMeta(JSON.parse(metaText), docId);
    }
    catch (error) {
        throw new OcrArtifactError('meta_invalid', docId, undefined, undefined, `产物 ${docId} 的 meta.json 不是可识别的记录：${error instanceof Error ? error.message : String(error)}`);
    }
    let text;
    try {
        text = await store.readWorkspaceText({ session: input.session, path: documentPath(docId), signal: input.signal });
    }
    catch (error) {
        if (isNotFound(error)) {
            throw new OcrArtifactError('document_missing', docId, meta.source_kind, meta.source, `产物 ${docId} 的 document.md 缺失（meta 在、正文不在）`);
        }
        throw error;
    }
    return { meta, document: { document: text, pages: meta.page_entries, chars: meta.chars, images: meta.images, tables: meta.tables, styleCharsRemoved: meta.style_chars_removed } };
}
/** `overwrite` only when the caller has already decided to regenerate. */
export async function writeOcrArtifact(store, input) {
    const docId = requireDocId(input.meta.doc_id);
    const written = await store.writeWorkspaceFiles({
        session: input.session,
        dir: `${OCR_ARTIFACT_SUBDIR}/${docId}`,
        files: [
            { name: DOCUMENT_FILE, content: input.document.document },
            { name: META_FILE, content: `${JSON.stringify(input.meta)}\n` },
        ],
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.overwrite ? { overwrite: true } : {}),
    });
    return { artifact_ref: ocrArtifactRef(docId), paths: written.map((file) => file.path) };
}
/** Re-validate our own record field by field so a hand-edited file fails loudly. */
function normalizeMeta(value, docId) {
    const record = (typeof value === 'object' && value !== null ? value : {});
    const pages = Array.isArray(record.page_entries) ? record.page_entries : [];
    const entries = pages.map((item) => {
        const page = (typeof item === 'object' && item !== null ? item : {});
        if (typeof page.page !== 'number' || typeof page.start !== 'number' || typeof page.end !== 'number' || typeof page.chars !== 'number') {
            throw new Error('page_entries 项缺字段');
        }
        const heading = typeof page.heading === 'string' ? { heading: page.heading } : {};
        return { page: page.page, start: page.start, end: page.end, chars: page.chars, ...heading };
    });
    const text = (key) => {
        if (typeof record[key] !== 'string')
            throw new Error(`meta.${key} 不是字符串`);
        return record[key];
    };
    const num = (key) => {
        if (typeof record[key] !== 'number')
            throw new Error(`meta.${key} 不是数字`);
        return record[key];
    };
    if (record.doc_id !== docId)
        throw new Error(`meta.doc_id 与目录不一致（${String(record.doc_id)}）`);
    const source = typeof record.source === 'string' ? { source: record.source } : {};
    const charts = typeof record.charts === 'boolean' ? { charts: record.charts } : {};
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
    };
}
/** Fail on an unknown provenance: defaulting it to `url` would fabricate attribution. */
function sourceKind(value) {
    if (value === 'url' || value === 'file' || value === 'job')
        return value;
    throw new Error(`meta.source_kind 不认识：${String(value)}`);
}
export function buildArtifactMeta(input) {
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
    };
}
/**
 * `file` entry: workspace-relative only (absolute paths, drive letters and `..` are
 * rejected downstream, then ownership is checked); @mentions show just the path tail.
 */
export async function readOcrSourceBytes(store, input) {
    const bytes = await store.readWorkspaceBytes({
        session: input.session,
        path: input.path,
        maxBytes: OCR_MAX_SOURCE_BYTES,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const filename = input.path.split('/').pop() ?? 'document';
    return { bytes, filename };
}
