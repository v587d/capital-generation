import { type PackName, type PackTarget, type RuntimeManifest, type TargetId } from './types.js';
export declare function parseManifest(value: unknown): RuntimeManifest;
export declare function readManifest(path: string): RuntimeManifest;
export declare function packTarget(manifest: RuntimeManifest, pack: PackName, target: TargetId): PackTarget;
export declare function normalizePackNames(value: unknown): PackName[];
