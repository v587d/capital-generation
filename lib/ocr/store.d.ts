/**
 * OCR artifacts live under `capital-data/ocr/<doc_id>/`; the model only gets `doc_id`.
 * Content-addressed ids make a repeat parse a cache hit. `document.md` is written before
 * `meta.json`, so meta's presence means a complete artifact; half-written ones are redone.
 * Page reads reuse the persisted text instead of re-running a paid upstream job.
 */
import type { SessionLike, WorkspaceDatasetStore } from '../data-collector/store.js';
import type { OcrDocument, OcrPageEntry } from './markdown.js';
export declare const OCR_ARTIFACT_SUBDIR = "capital-data/ocr";
export declare const OCR_DOC_ID_PATTERN: RegExp;
/** Read cap for local documents: 100-page reports fit; fail rather than buffer a whole file. */
export declare const OCR_MAX_SOURCE_BYTES: number;
/** On-disk metadata; field names match the receipt so disk and model see one truth. */
export interface OcrArtifactMeta {
    doc_id: string;
    /** Input identity, `url:` or `file:` (never absolute); empty on resume — never pass job_id off as provenance. */
    source?: string;
    source_kind: 'url' | 'file' | 'job';
    job_id: string;
    model: string;
    /** Chart-recognition flag at submit; unknown on resume, so omitted. */
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
export declare function deriveOcrDocId(seed: string | Uint8Array, model: string, charts: boolean): string;
export declare function ocrArtifactRef(docId: string): string;
/** Corrupt artifact, not caller error; the repair hint needs the source only this meta holds. */
export declare class OcrArtifactError extends Error {
    readonly reason: 'meta_unreadable' | 'meta_invalid' | 'document_missing';
    readonly docId: string;
    readonly sourceKind: OcrArtifactMeta['source_kind'] | undefined;
    readonly source: string | undefined;
    constructor(reason: 'meta_unreadable' | 'meta_invalid' | 'document_missing', docId: string, sourceKind: OcrArtifactMeta['source_kind'] | undefined, source: string | undefined, message: string);
}
/**
 * `undefined` = never parsed (safe to submit a job). A throw = meta present but body
 * missing/corrupt: do not treat as empty and do not silently re-run (a re-run costs a job).
 */
export declare function readOcrArtifact(store: WorkspaceDatasetStore, input: {
    session: SessionLike;
    doc_id: string;
    signal?: AbortSignal;
}): Promise<OcrArtifact | undefined>;
/** `overwrite` only when the caller has already decided to regenerate. */
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
 * `file` entry: workspace-relative only (absolute paths, drive letters and `..` are
 * rejected downstream, then ownership is checked); @mentions show just the path tail.
 */
export declare function readOcrSourceBytes(store: WorkspaceDatasetStore, input: {
    session: SessionLike;
    path: string;
    signal?: AbortSignal;
}): Promise<{
    bytes: Uint8Array;
    filename: string;
}>;
