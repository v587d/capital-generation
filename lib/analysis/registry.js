/**
 * Static analysis-module registry: the whitelist and the version facts, nothing else.
 *
 * Modules are never discovered by scanning a directory — a directory scan would turn "drop a file in
 * the package" into "run arbitrary code under the private interpreter". `module.json` is the single
 * manifest source; the entry only adds the resolved directory the worker gets.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULE_DEFAULT_LIMITS } from './schemas.js';
const MODULE_ROOT = fileURLToPath(new URL('../../python/analysis/modules/', import.meta.url));
/** Registered ids, in listing order. Adding a module means adding its id here. */
const REGISTERED_MODULE_IDS = ['hello', 'financial_quality'];
const cache = new Map();
function readManifest(moduleId) {
    const cached = cache.get(moduleId);
    if (cached !== undefined)
        return cached;
    const dir = join(MODULE_ROOT, moduleId);
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(join(dir, 'module.json'), 'utf8'));
    }
    catch (error) {
        throw new Error(`分析模块 ${moduleId} 的 module.json 读不到（${error instanceof Error ? error.message : String(error)}）`);
    }
    const manifest = normalizeManifest(parsed, moduleId);
    const entry = { manifest, dir, entrypoint: manifest.entrypoint };
    cache.set(moduleId, entry);
    return entry;
}
function normalizeManifest(value, moduleId) {
    const raw = value;
    if (typeof raw !== 'object' || raw === null || raw.id !== moduleId) {
        throw new Error(`分析模块 ${moduleId} 的 manifest 缺失或 id 不符`);
    }
    if (typeof raw.version !== 'string' || typeof raw.description !== 'string' || typeof raw.entrypoint !== 'string') {
        throw new Error(`分析模块 ${moduleId} 的 manifest 缺少 version / description / entrypoint`);
    }
    if (!Array.isArray(raw.roles) || raw.roles.length === 0) {
        throw new Error(`分析模块 ${moduleId} 的 manifest 必须声明 roles（语义键，如 senior_analyst）`);
    }
    if (!Array.isArray(raw.capabilities))
        throw new Error(`分析模块 ${moduleId} 的 manifest 缺少 capabilities`);
    const limits = { ...MODULE_DEFAULT_LIMITS, ...(raw.limits ?? {}) };
    return {
        id: moduleId,
        version: raw.version,
        entrypoint: raw.entrypoint,
        runtime: 'python',
        description: raw.description,
        roles: [...raw.roles],
        capabilities: [...raw.capabilities],
        required_fields: [...(raw.required_fields ?? [])],
        input_schema: raw.input_schema ?? {},
        output_schema: raw.output_schema ?? {},
        assumptions: [...(raw.assumptions ?? [])],
        applicability: [...(raw.applicability ?? [])],
        limits,
        provenance: raw.provenance ?? { source_type: 'original', license: 'MIT' },
    };
}
/** Registered modules, manifest-normalized. Throws when a registered module cannot be read. */
export function listAnalysisModules() {
    return REGISTERED_MODULE_IDS.map((moduleId) => readManifest(moduleId));
}
export function analysisModuleById(moduleId) {
    if (!REGISTERED_MODULE_IDS.includes(moduleId))
        return undefined;
    return readManifest(moduleId);
}
/** Test-only: drop the manifest cache so a fixture rewrite is visible. */
export function resetAnalysisModuleCache() {
    cache.clear();
}
