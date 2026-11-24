import { type SessionLike } from '../data-collector/store.js';
import { type AnalysisErrorCode } from './types.js';
export declare const ANALYSIS_ROOT = "capital-analysis/runs";
export declare const SNAPSHOT_FILE = "snapshot.json";
export declare const RUN_FILE = "run.json";
export declare const ARTIFACT_FILE = "artifact.json";
export declare const REQUEST_FILE = "request.json";
export declare const RESULT_FILE = "result.json";
/** Opaque refs: the model never learns a filesystem path, only one of these. */
export declare const ANALYSIS_ID: RegExp;
export declare const MODULE_RUN_ID: RegExp;
export interface AnalysisFileWriter {
    writeWorkspaceFiles(input: {
        session: SessionLike;
        dir: string;
        files: Array<{
            name: string;
            content: string;
        }>;
        signal?: AbortSignal;
        overwrite?: boolean;
    }): Promise<Array<{
        name: string;
        path: string;
        absolutePath: string;
    }>>;
    readWorkspaceJson(input: {
        session: SessionLike;
        path: string;
        signal?: AbortSignal;
    }): Promise<unknown>;
}
export declare function newAnalysisId(): string;
export declare function newModuleRunId(): string;
export declare const analysisDir: (analysisId: string) => string;
export declare const inputsDir: (analysisId: string, kind: "datasets" | "profiles" | "evidence") => string;
export declare const moduleRunDir: (analysisId: string, moduleRunId: string) => string;
export declare const snapshotRef: (analysisId: string) => string;
export declare const runRef: (analysisId: string, moduleRunId: string) => string;
export declare const artifactRef: (analysisId: string) => string;
/** Parse a model-supplied ref; an unparsable ref must fail as `analysis_snapshot_invalid`. */
export declare function parseSnapshotRef(ref: unknown): string;
export declare function parseArtifactRef(ref: unknown): string;
/**
 * Translate a store failure into an analysis error code. The store already names the object that
 * failed (dataset id, path), so the message stays actionable without a second lookup.
 */
export declare function asAnalysisError(error: unknown, fallback: AnalysisErrorCode, what: string): never;
/** Write one directory's files through the store (createIfAbsent unless `overwrite`). */
export declare function writeFiles(writer: AnalysisFileWriter, session: SessionLike, dir: string, files: Array<{
    name: string;
    content: string;
}>, options?: {
    signal?: AbortSignal;
    overwrite?: boolean;
    errorCode?: AnalysisErrorCode;
    what?: string;
}): Promise<Array<{
    name: string;
    path: string;
    absolutePath: string;
}>>;
/** Read one JSON file; a missing file is `undefined` (callers decide whether that is fatal). */
export declare function readJsonFile<T>(reader: AnalysisFileWriter, session: SessionLike, path: string, signal?: AbortSignal): Promise<T | undefined>;
