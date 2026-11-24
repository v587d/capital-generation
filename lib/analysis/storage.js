/**
 * Run-directory layout and the workspace seam for the analysis family.
 *
 * Every path here is workspace-relative and goes through the Dataset store, which owns containment,
 * the sandbox policy and the size gates. Nothing in `src/analysis/` touches `fs` directly.
 *
 * Layout (`capital-analysis/runs/<analysis_id>/`):
 *   snapshot.json  run.json  artifact.json
 *   inputs/{datasets,profiles,evidence}/
 *   modules/<module_run_id>/{request,result}.json + outputs/ + logs/
 */
import { randomUUID } from 'node:crypto';
import { DatasetStoreError } from '../data-collector/store.js';
import { AnalysisError } from './types.js';
export const ANALYSIS_ROOT = 'capital-analysis/runs';
export const SNAPSHOT_FILE = 'snapshot.json';
export const RUN_FILE = 'run.json';
export const ARTIFACT_FILE = 'artifact.json';
export const REQUEST_FILE = 'request.json';
export const RESULT_FILE = 'result.json';
/** Opaque refs: the model never learns a filesystem path, only one of these. */
export const ANALYSIS_ID = /^analysis_[a-z0-9]{6,40}$/u;
export const MODULE_RUN_ID = /^module_run_[a-z0-9]{6,40}$/u;
const idSuffix = () => `${Date.now().toString(36)}${randomUUID().replace(/-/gu, '').slice(0, 10)}`;
export function newAnalysisId() {
    return `analysis_${idSuffix()}`;
}
export function newModuleRunId() {
    return `module_run_${idSuffix()}`;
}
export const analysisDir = (analysisId) => `${ANALYSIS_ROOT}/${analysisId}`;
export const inputsDir = (analysisId, kind) => `${analysisDir(analysisId)}/inputs/${kind}`;
export const moduleRunDir = (analysisId, moduleRunId) => `${analysisDir(analysisId)}/modules/${moduleRunId}`;
export const snapshotRef = (analysisId) => `analysis:${analysisId}`;
export const runRef = (analysisId, moduleRunId) => `analysis_run:${analysisId}/${moduleRunId}`;
export const artifactRef = (analysisId) => `analysis_artifact:${analysisId}`;
/** Parse a model-supplied ref; an unparsable ref must fail as `analysis_snapshot_invalid`. */
export function parseSnapshotRef(ref) {
    const text = typeof ref === 'string' ? ref.trim() : '';
    const id = text.startsWith('analysis:') ? text.slice('analysis:'.length) : '';
    if (!ANALYSIS_ID.test(id)) {
        throw new AnalysisError('analysis_snapshot_invalid', `snapshot 引用无法识别：${JSON.stringify(text).slice(0, 120)}`);
    }
    return id;
}
export function parseArtifactRef(ref) {
    const text = typeof ref === 'string' ? ref.trim() : '';
    const id = text.startsWith('analysis_artifact:') ? text.slice('analysis_artifact:'.length) : '';
    if (!ANALYSIS_ID.test(id)) {
        throw new AnalysisError('analysis_snapshot_invalid', `分析产物引用无法识别：${JSON.stringify(text).slice(0, 120)}`);
    }
    return id;
}
/**
 * Translate a store failure into an analysis error code. The store already names the object that
 * failed (dataset id, path), so the message stays actionable without a second lookup.
 */
export function asAnalysisError(error, fallback, what) {
    if (error instanceof AnalysisError)
        throw error;
    if (error instanceof DatasetStoreError) {
        const code = error.code === 'dataset_expired' || error.code === 'profile_expired'
            ? 'analysis_snapshot_expired'
            : error.code === 'dataset_session_mismatch' || error.code === 'dataset_not_found' || error.code === 'profile_not_found'
                ? 'analysis_snapshot_invalid'
                : fallback;
        throw new AnalysisError(code, `${what}：${error.message}`);
    }
    throw new AnalysisError(fallback, `${what}：${error instanceof Error ? error.message : String(error)}`);
}
/** Write one directory's files through the store (createIfAbsent unless `overwrite`). */
export async function writeFiles(writer, session, dir, files, options = {}) {
    try {
        return await writer.writeWorkspaceFiles({
            session,
            dir,
            files,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            ...(options.overwrite === true ? { overwrite: true } : {}),
        });
    }
    catch (error) {
        asAnalysisError(error, options.errorCode ?? 'analysis_input_invalid', options.what ?? `写入 ${dir} 失败`);
    }
}
/** Read one JSON file; a missing file is `undefined` (callers decide whether that is fatal). */
export async function readJsonFile(reader, session, path, signal) {
    try {
        return await reader.readWorkspaceJson({ session, path, ...(signal === undefined ? {} : { signal }) });
    }
    catch (error) {
        if (error instanceof DatasetStoreError && error.code === 'dataset_not_found')
            return undefined;
        asAnalysisError(error, 'analysis_input_invalid', `读取 ${path} 失败`);
    }
}
