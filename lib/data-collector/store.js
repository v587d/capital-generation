import { DatasetQueryError, executeJsonRowsQuery } from './query.js';
import { defaultAxisWindows, isoDateFromEpoch, probeTimeAxis, readAxisDates } from './time-axis.js';
/**
 * Phase 1/2 workspace-local Dataset store（设计约定见 AGENTS.md「数据布局」）。
 *
 * 原始 Dataset 只由宿主写入，Dataset/Profile 都通过 createIfAbsent 发布。
 * Agent 只能使用 dataset_id 和 opaque artifact_ref，不能传入真实路径。
 */
export const WORKSPACE_DATA_DIR = 'capital-data';
export const DATASETS_SUBDIR = `${WORKSPACE_DATA_DIR}/datasets`;
export const PROFILES_SUBDIR = `${WORKSPACE_DATA_DIR}/profiles`;
export const RAW_FILE = 'raw.json';
export const MANIFEST_FILE = 'manifest.json';
export const PROFILE_FILE = 'profile.json';
export const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_RAW_READ_BYTES = 16 * 1024 * 1024;
export const MAX_PROFILE_BYTES = 64 * 1024;
/** 类别事实：最多跟踪多少个不同取值；超过则 distinct_count 记 null 并标记 truncated。 */
export const MAX_CATEGORY_DISTINCT = 2_000;
/** `top_values` 只展示前 N 个高频取值，其余由 truncated 显式披露。 */
export const MAX_CATEGORY_TOP_VALUES = 5;
const MAX_CATEGORY_VALUE_LENGTH = 64;
/** 结构摘要：路径条目上限与递归深度上限，保证 profile 体积有界。 */
export const MAX_STRUCTURE_ENTRIES = 24;
/**
 * 递归深度上限。行集合里 depth 0 就是列本身，文档里 depth 0 是 `$` 根，
 * 因此文档需要多一层才够到 `abilities[].indicators[]` 这种叶子。
 * 条目上限（24）才是真正的体积闸门，深度只是防止病态深嵌套。
 */
const MAX_STRUCTURE_DEPTH = 4;
const MAX_STRUCTURE_FIELDS = 8;
const MAX_STRUCTURE_SAMPLED_ELEMENTS = 50;
/**
 * `time_facts.windows` 的条数上限。默认只给 4 个常用窗口（近 1 月/3 月/1 年/年初至今），
 * 上限是防回涨的闸门：窗口是"现成坐标"，不是让宿主把任意期间都算一遍。
 */
const MAX_TIME_WINDOWS = 8;
/** 推断时间轴时最多检查多少行：命中的列通常在前若干行就出现，不必为一次探针读全量。 */
const MAX_AXIS_PROBE_ROWS = 500;
/**
 * 文档型 Dataset（顶层对象、没有行数组，如财务指标 / 回测结果）交给 data_junior 的
 * 内容预算（Unicode 码点数）。取值必须留在 preset 的工具结果剪枝阈值（8192）以内：
 * 超过就会被剪掉中间段，而不是被完整读到。长数组按下面的档位逐级截断，截断了什么
 * 一律写进 `omitted`，不做静默省略。
 */
export const MAX_DOCUMENT_CHARS = 6_000;
/**
 * 呈现层（图表）一次性读取行集的上限。超过就拒绝，而不是把几百 MB 拉进宿主内存：
 * 图表是**有界呈现**，不是通用分析通道。
 */
export const MAX_PRESENTATION_ROWS = 200_000;
const DOCUMENT_ARRAY_KEEP_STEPS = [8, 3, 1, 0];
const DOCUMENT_MAX_DEPTH = 6;
const DOCUMENT_MAX_OMISSIONS = 8;
export const ARTIFACT_SCHEME = 'workspace://';
export class DatasetStoreError extends Error {
    code;
    constructor(code, detail) {
        super(`${code}: ${detail}`);
        this.name = 'DatasetStoreError';
        this.code = code;
    }
}
function defaultNewId(prefix) {
    const cryptoLike = globalThis.crypto;
    if (cryptoLike?.randomUUID)
        return `${prefix}_${cryptoLike.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
export const DATASET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
function isAbsolutePath(value) {
    return /^([a-zA-Z]:[\\/]|\/)/.test(value);
}
/**
 * 规范化并校验 workspace **相对**路径。
 *
 * 拒绝：空串、绝对路径（含 Windows 盘符）、任何 `..` 段、反斜杠（本仓统一 `/`）。
 * 这里只做形态校验；真正的沙箱归属由 `resolveContained` 证明。两道关卡都要过——
 * 形态校验是为了给出可读错误，归属校验才是安全边界。
 */
export function normalizeWorkspaceRelativePath(value) {
    if (typeof value !== 'string')
        throw new DatasetStoreError('workspace_path_invalid', 'path must be a string');
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 512)
        throw new DatasetStoreError('workspace_path_invalid', 'path must be 1-512 characters');
    if (trimmed.includes('\\'))
        throw new DatasetStoreError('workspace_path_invalid', 'path must use forward slashes');
    if (isAbsolutePath(trimmed))
        throw new DatasetStoreError('workspace_path_invalid', 'path must be relative to the session workspace');
    const segments = trimmed.split('/').filter((segment) => segment.length > 0);
    if (segments.length === 0)
        throw new DatasetStoreError('workspace_path_invalid', 'path must name a file inside the workspace');
    for (const segment of segments) {
        if (segment === '.' || segment === '..')
            throw new DatasetStoreError('workspace_path_invalid', 'path must not contain "." or ".." segments');
    }
    return segments.join('/');
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function errorCodeOf(error) {
    if (error && typeof error === 'object' && typeof error.code === 'string') {
        return error.code;
    }
    return undefined;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
}
function canonicalDatasetRef(datasetId) {
    return `${ARTIFACT_SCHEME}${DATASETS_SUBDIR}/${datasetId}`;
}
function canonicalProfileRef(profileId) {
    return `${ARTIFACT_SCHEME}${PROFILES_SUBDIR}/${profileId}`;
}
function validNonNegativeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export class WorkspaceDatasetStore {
    fs;
    sandboxPolicy;
    retentionMs;
    now;
    newId;
    constructor(options = {}) {
        this.fs = options.fs;
        this.sandboxPolicy = options.sandboxPolicy;
        this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
        this.now = options.now ?? (() => Date.now());
        this.newId = options.newId ?? defaultNewId;
    }
    async save(input) {
        const { session, signal } = input;
        const { root, policy } = this.writeContext(session);
        const datasetId = this.newId('ds');
        if (!DATASET_ID_PATTERN.test(datasetId)) {
            throw new DatasetStoreError('dataset_write_failed', `generated dataset_id is invalid: ${datasetId}`);
        }
        const dirPath = `${DATASETS_SUBDIR}/${datasetId}`;
        await this.assertContained(root, dirPath, signal);
        const capturedAt = this.now();
        const manifest = {
            dataset_id: datasetId,
            task_id: input.task_id ?? null,
            session_id: session.id,
            artifact_ref: canonicalDatasetRef(datasetId),
            format: input.format,
            capability: input.capability,
            source_label: input.source_label,
            schema: input.schema,
            row_count: input.row_count,
            captured_at: capturedAt,
            retention_until: capturedAt + this.retentionMs,
            params_digest: input.params_digest,
        };
        const storedManifest = {
            ...manifest,
            session_scope_id: sessionScopeFor(session),
            ...(input.row_key === undefined ? {} : { row_key: input.row_key }),
        };
        let rawContent;
        try {
            rawContent = JSON.stringify(input.data);
        }
        catch (error) {
            throw new DatasetStoreError('dataset_write_failed', `source result is not JSON-serializable: ${errorMessage(error)}`);
        }
        if (typeof rawContent !== 'string') {
            throw new DatasetStoreError('dataset_write_failed', 'source result is not JSON-serializable: JSON.stringify returned no value');
        }
        const rawTarget = await this.resolveContained(`${dirPath}/${RAW_FILE}`, root, signal);
        try {
            await this.fs.writeText(rawTarget, rawContent, { kind: 'createIfAbsent' }, signal, policy);
        }
        catch (error) {
            this.mapWriteError(error, 'writing raw.json');
        }
        const manifestTarget = await this.resolveContained(`${dirPath}/${MANIFEST_FILE}`, root, signal);
        try {
            await this.fs.writeText(manifestTarget, JSON.stringify(storedManifest), { kind: 'createIfAbsent' }, signal, policy);
        }
        catch (error) {
            this.mapWriteError(error, `writing manifest.json (raw.json of ${datasetId} may remain on disk)`);
        }
        return manifest;
    }
    async readRef(datasetId, session, signal) {
        try {
            return await this.requireRef(datasetId, session, signal);
        }
        catch {
            return undefined;
        }
    }
    async listRefs(session, signal) {
        const root = this.readRoot(session);
        if (!root || !this.fs)
            return [];
        try {
            const dirTarget = await this.resolveContained(DATASETS_SUBDIR, root, signal);
            const entries = await this.fs.listDir(dirTarget, signal);
            const refs = [];
            for (const entry of entries) {
                if (entry.type !== 'directory')
                    continue;
                const ref = await this.readRef(entry.name, session, signal);
                if (ref)
                    refs.push(ref);
            }
            return refs.sort((a, b) => b.captured_at - a.captured_at);
        }
        catch {
            return [];
        }
    }
    async findLatest(input) {
        const refs = await this.listRefs(input.session, input.signal);
        return refs.find((ref) => ref.capability === input.capability && ref.params_digest === input.params_digest);
    }
    async inspectDataset(datasetId, session, signal) {
        const stored = await this.requireStoredRef(datasetId, session, signal);
        const { session_scope_id: _scope, row_key: rowKey, ...ref } = stored;
        try {
            const raw = await this.readRaw(ref, session, signal, rowKey);
            return { ...ref, query_access: { readable: true, shape: raw.kind === 'document' ? 'document' : raw.shape } };
        }
        catch (error) {
            if (error instanceof DatasetStoreError && ['dataset_too_large', 'dataset_not_row_readable'].includes(error.code)) {
                return { ...ref, query_access: { readable: false, shape: 'none', reason: error.code } };
            }
            throw error;
        }
    }
    async profileDataset(input) {
        const stored = await this.requireStoredRef(input.dataset_id, input.session, input.signal);
        const { session_scope_id: _scope, row_key: rowKey, ...ref } = stored;
        const raw = await this.readRaw(ref, input.session, input.signal, rowKey);
        if (raw.kind === 'document') {
            const profile = buildDocumentProfile(raw.value);
            const profileRef = await this.writeProfile({
                session: input.session,
                dataset_id: ref.dataset_id,
                task_id: input.task_id,
                profile,
                signal: input.signal,
            });
            // 结构摘要随 profile 持久化；有界内容只随本次工具结果返回，不进入 profile 产物。
            return { ...profileRef, ...profile, document: boundDocument(raw.value) };
        }
        const profile = buildProfile(raw.rows, input.time_column, input.primary_key, extractRowContracts(ref.schema));
        const profileRef = await this.writeProfile({
            session: input.session,
            dataset_id: ref.dataset_id,
            task_id: input.task_id,
            profile,
            signal: input.signal,
        });
        return { ...profileRef, ...profile };
    }
    async queryDataset(input) {
        const stored = await this.requireStoredRef(input.dataset_id, input.session, input.signal);
        const { session_scope_id: _scope, row_key: rowKey, ...ref } = stored;
        const raw = await this.readRaw(ref, input.session, input.signal, rowKey);
        if (raw.kind !== 'rows')
            throw new DatasetStoreError('dataset_format_unsupported', 'a document Dataset has no rows to query; profile it instead');
        if (input.query.dataset_id !== ref.dataset_id) {
            throw new DatasetQueryError('query_spec_invalid', 'query.dataset_id must match the requested Dataset');
        }
        return executeJsonRowsQuery(raw.rows, ref.schema, input.query);
    }
    /**
     * 时间轴只读探针（`query_dataset` 的日期归一边界与 `resolve_data_time_range` 的数据集模式共用）。
     *
     * 只读前 {@link MAX_AXIS_PROBE_ROWS} 行推断形态与偏移：时间列一定在每行都出现，日线数据
     * 的有序性也让前若干行足以定出粒度；这样这个探针**可以随查询逐次调用**，
     * 代价与"读一份 16MB raw.json 只为一个问题"不同量级。
     */
    async describeTimeAxis(input) {
        const stored = await this.requireStoredRef(input.dataset_id, input.session, input.signal);
        const { session_scope_id: _scope, row_key: rowKey, ...ref } = stored;
        const raw = await this.readRaw(ref, input.session, input.signal, rowKey);
        if (raw.kind !== 'rows' || raw.rows.length === 0)
            return undefined;
        const objectRows = raw.rows.filter(isRecord);
        if (objectRows.length === 0)
            return undefined;
        const columns = [...new Set(objectRows.flatMap((row) => Object.keys(row)))];
        const sample = [];
        const step = Math.max(1, Math.ceil(raw.rows.length / MAX_AXIS_PROBE_ROWS));
        for (let index = 0; index < raw.rows.length && sample.length < MAX_AXIS_PROBE_ROWS; index += step)
            sample.push(raw.rows[index]);
        const column = pickTimeColumn(sample, columns, input.time_column);
        if (column === undefined)
            return undefined;
        const values = sample.map((row) => profileCell(row, column).value);
        const axis = probeTimeAxis(column, values);
        if (axis.value_format === 'unknown')
            return undefined;
        const dates = readAxisDates({ axis, rows: sample });
        if (dates.length === 0)
            return undefined;
        return { dataset_id: ref.dataset_id, columns, axis, dates };
    }
    async writeProfile(input) {
        const { session, signal } = input;
        const ref = await this.requireRef(input.dataset_id, session, signal);
        const profile = validateProfile(input.profile);
        const encodedProfile = JSON.stringify(profile);
        if (byteLength(encodedProfile) > MAX_PROFILE_BYTES)
            throw new DatasetStoreError('profile_too_large', `profile exceeds ${MAX_PROFILE_BYTES} bytes`);
        const { root, policy } = this.writeContext(session);
        const profileId = this.newId('p');
        if (!PROFILE_ID_PATTERN.test(profileId))
            throw new DatasetStoreError('profile_invalid', `generated profile_id is invalid: ${profileId}`);
        const createdAt = this.now();
        const profileRef = {
            profile_id: profileId,
            dataset_id: ref.dataset_id,
            task_id: input.task_id ?? null,
            session_id: session.id,
            artifact_ref: canonicalProfileRef(profileId),
            created_at: createdAt,
            retention_until: Math.min(ref.retention_until, createdAt + this.retentionMs),
        };
        const target = await this.resolveContained(`${PROFILES_SUBDIR}/${profileId}/${PROFILE_FILE}`, root, signal);
        try {
            await this.fs.writeText(target, JSON.stringify({ ref: profileRef, profile }), { kind: 'createIfAbsent' }, signal, policy);
        }
        catch (error) {
            this.mapWriteError(error, `writing profile.json (${profileId})`);
        }
        return profileRef;
    }
    /**
     * 宿主内部**呈现层**读取有界行集（图表用）。
     *
     * 契约（不可违反）：
     *  - 返回值**不得**进入任何 Agent 消息、工具结果或模型上下文；调用方只能在宿主进程内
     *    把它变成有界可视化载荷（见 src/chart/series.ts）。
     *  - 这是唯一一处把原始 rows 交给 store 之外代码的入口，因此命名、文档与调用点都必须是
     *    "呈现"语义。需要数值结论一律走 profile_dataset / query_dataset。
     *  - session 作用域与 profile/query 同源（`sessionScopeFor` 取父会话），所以主 Agent
     *    用自己会话即可读到自己子 Agent 采到的 Dataset。
     */
    async readPresentationRows(input) {
        const stored = await this.requireStoredRef(input.dataset_id, input.session, input.signal);
        const { session_scope_id: _scope, row_key: rowKey, ...ref } = stored;
        const raw = await this.readRaw(ref, input.session, input.signal, rowKey);
        if (raw.kind !== 'rows') {
            throw new DatasetStoreError('dataset_format_unsupported', 'a document Dataset has no rows to present; profile it instead');
        }
        const maxRows = input.maxRows ?? MAX_PRESENTATION_ROWS;
        if (raw.rows.length > maxRows) {
            throw new DatasetStoreError('dataset_too_large', `Dataset has ${raw.rows.length} rows; presentation reads are capped at ${maxRows}`);
        }
        return { ref, rows: raw.rows };
    }
    /**
     * 宿主内部读取 workspace 内的**文本**文件（图表 spec、OCR 产物、用户本地数据）。
     *
     * 这是 workspace 读取的**唯一**实现：`readWorkspaceJson` / `readWorkspaceBytes` 都从
     * `workspaceFileTarget` 取归属与体积闸门，不各自再写一遍路径校验（§9.7——同一个事实
     * 有两份实现就一定会漂移）。
     */
    async readWorkspaceText(input) {
        const maxBytes = input.maxBytes ?? MAX_RAW_READ_BYTES;
        const { relative, target } = await this.workspaceFileTarget(input.session, input.path, input.signal, maxBytes);
        let text;
        try {
            text = await this.fs.readText(target, input.signal);
        }
        catch (error) {
            if (errorCodeOf(error) === 'FS_NOT_FOUND')
                throw new DatasetStoreError('dataset_not_found', `${relative} was not found`);
            throw new DatasetStoreError('workspace_file_invalid', `${relative} could not be read`);
        }
        if (byteLength(text) > maxBytes) {
            throw new DatasetStoreError('dataset_too_large', `${relative} exceeds ${maxBytes} bytes`);
        }
        return text;
    }
    /**
     * 宿主内部读取 workspace 内的**原始字节**（本地 PDF / 图片上传给外部解析服务的入口）。
     *
     * 上限必须显式给出：这道缝后面的调用方要把字节整个装进内存，没有默认值可兜。
     * `fs.readBytes` 缺席（载体未挂载该能力）时**响亮失败**，不回退成 `readText`——
     * 二进制走文本读取会得到被解码污染的字节。
     */
    async readWorkspaceBytes(input) {
        const { relative, target } = await this.workspaceFileTarget(input.session, input.path, input.signal, input.maxBytes);
        if (typeof this.fs?.readBytes !== 'function') {
            throw new DatasetStoreError('filesystem_unavailable', 'the mounted filesystem cannot read raw bytes');
        }
        try {
            return await this.fs.readBytes(target, input.signal, input.maxBytes);
        }
        catch (error) {
            const code = errorCodeOf(error);
            if (code === 'FS_NOT_FOUND')
                throw new DatasetStoreError('dataset_not_found', `${relative} was not found`);
            if (code === 'FS_TOO_LARGE')
                throw new DatasetStoreError('dataset_too_large', `${relative} exceeds ${input.maxBytes} bytes`);
            throw new DatasetStoreError('workspace_file_invalid', `${relative} could not be read`);
        }
    }
    async workspaceFileTarget(session, path, signal, maxBytes) {
        const root = this.readRoot(session);
        if (!root || !this.fs)
            throw new DatasetStoreError('filesystem_unavailable', 'workspace filesystem is unavailable');
        const relative = normalizeWorkspaceRelativePath(path);
        const target = await this.resolveContained(relative, root, signal);
        const info = this.fs.stat ? await this.fs.stat(target, signal) : undefined;
        if (info && info.type !== 'file')
            throw new DatasetStoreError('workspace_file_invalid', `${relative} is not a regular file`);
        if (typeof info?.size === 'number' && info.size > maxBytes) {
            throw new DatasetStoreError('dataset_too_large', `${relative} exceeds ${maxBytes} bytes`);
        }
        return { relative, target };
    }
    /** 宿主内部呈现层读取 workspace 内的 JSON 文件（用户本地数据直接可视化的入口）。 */
    async readWorkspaceJson(input) {
        const text = await this.readWorkspaceText(input);
        try {
            return JSON.parse(text);
        }
        catch {
            throw new DatasetStoreError('workspace_file_invalid', `${input.path} is not valid JSON`);
        }
    }
    /**
     * 宿主内部**产物层**把一组文本文件写进 workspace 的一个子目录（图表与 OCR 产物用）。
     *
     * 走与 Dataset 落盘完全相同的沙箱策略与归属校验；默认 `createIfAbsent`，保证不会静默
     * 覆盖已有产物（图表 id 唯一，重复即 bug，应当响亮失败）。
     *
     * `overwrite: true` 是给**内容寻址产物**重跑用的（OCR：上次在两个文件之间被中断，
     * 半件产物必须能被下一次解析自愈）。它不是"跳过幂等"的口子：幂等判断在调用方，
     * 只有已经决定重新生成时才传。
     *
     * 返回值同时给出**相对路径**（可以进 Agent 消息、可以 present 给用户）与**绝对路径**
     * （只供宿主内部使用，例如登记给 host 平面的取数路由）。这个区分是本仓的数据纪律：
     * 绝对路径不出宿主进程。
     */
    async writeWorkspaceFiles(input) {
        const { session, signal } = input;
        const { root, policy } = this.writeContext(session);
        const dir = normalizeWorkspaceRelativePath(input.dir);
        await this.assertContained(root, dir, signal);
        const written = [];
        for (const file of input.files) {
            if (!/^[A-Za-z0-9._-]{1,64}$/.test(file.name)) {
                throw new DatasetStoreError('workspace_path_invalid', `artifact name is invalid: ${file.name}`);
            }
            const relative = `${dir}/${file.name}`;
            const target = await this.resolveContained(relative, root, signal);
            try {
                await this.fs.writeText(target, file.content, input.overwrite ? undefined : { kind: 'createIfAbsent' }, signal, policy);
            }
            catch (error) {
                this.mapWriteError(error, `writing ${relative}`);
            }
            written.push({ name: file.name, path: relative, absolutePath: target.displayPath });
        }
        return written;
    }
    async requireRef(datasetId, session, signal) {
        const stored = await this.requireStoredRef(datasetId, session, signal);
        const { session_scope_id: _scope, row_key: _rowKey, ...ref } = stored;
        return ref;
    }
    async requireStoredRef(datasetId, session, signal) {
        if (!DATASET_ID_PATTERN.test(datasetId))
            throw new DatasetStoreError('dataset_id_invalid', 'dataset_id is invalid');
        if (!session || typeof session.id !== 'string' || session.id.length === 0)
            throw new DatasetStoreError('session_unavailable', 'the calling agent session has no id');
        const root = this.readRoot(session);
        if (!root || !this.fs)
            throw new DatasetStoreError('filesystem_unavailable', 'workspace filesystem is unavailable');
        let text;
        try {
            const target = await this.resolveContained(`${DATASETS_SUBDIR}/${datasetId}/${MANIFEST_FILE}`, root, signal);
            text = await this.fs.readText(target, signal);
        }
        catch (error) {
            if (errorCodeOf(error) === 'FS_NOT_FOUND')
                throw new DatasetStoreError('dataset_not_found', `Dataset ${datasetId} was not found`);
            if (error instanceof DatasetStoreError)
                throw error;
            throw new DatasetStoreError('dataset_manifest_invalid', 'Dataset manifest could not be read');
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw new DatasetStoreError('dataset_manifest_invalid', 'Dataset manifest is not valid JSON');
        }
        const stored = validateStoredDatasetManifest(parsed, datasetId);
        if (!stored)
            throw new DatasetStoreError('dataset_manifest_invalid', 'Dataset manifest fields are invalid');
        if (stored.session_scope_id !== sessionScopeFor(session))
            throw new DatasetStoreError('dataset_session_mismatch', 'Dataset belongs to another session scope');
        if (stored.retention_until <= this.now())
            throw new DatasetStoreError('dataset_expired', `Dataset ${datasetId} has expired`);
        return stored;
    }
    /**
     * 读取原始 Dataset。返回两种形状之一：
     * - `rows`：顶层数组或 manifest 声明的行数组键，可 profile、可 query；
     * - `document`：顶层对象且没有行数组（财务指标、回测结果这类），可 profile
     *   （宿主算结构摘要 + 有界内容），不可 query。
     * 判定放在读取时而不是复用 manifest 的 `format`：`format` 只记录写入时的粗略
     * 形状，真正的形状以文件内容为准。
     */
    async readRaw(ref, session, signal, rowKey) {
        const root = this.readRoot(session);
        if (!root || !this.fs)
            throw new DatasetStoreError('filesystem_unavailable', 'workspace filesystem is unavailable');
        const target = await this.resolveContained(`${DATASETS_SUBDIR}/${ref.dataset_id}/${RAW_FILE}`, root, signal);
        const info = this.fs.stat ? await this.fs.stat(target, signal) : undefined;
        if (info && info.type !== 'file')
            throw new DatasetStoreError('dataset_not_row_readable', 'raw Dataset object is not a regular file');
        if (typeof info?.size === 'number' && info.size > MAX_RAW_READ_BYTES)
            throw new DatasetStoreError('dataset_too_large', `raw Dataset exceeds ${MAX_RAW_READ_BYTES} bytes`);
        let text;
        try {
            text = await this.fs.readText(target, signal);
        }
        catch {
            throw new DatasetStoreError('dataset_not_row_readable', 'raw Dataset could not be read');
        }
        if (byteLength(text) > MAX_RAW_READ_BYTES)
            throw new DatasetStoreError('dataset_too_large', `raw Dataset exceeds ${MAX_RAW_READ_BYTES} bytes`);
        let value;
        try {
            value = JSON.parse(text);
        }
        catch {
            throw new DatasetStoreError('dataset_not_row_readable', 'raw Dataset is not valid JSON');
        }
        if (Array.isArray(value))
            return { kind: 'rows', rows: value, shape: 'array' };
        if (isRecord(value)) {
            const rows = rowsAtPath(value, rowKey ?? 'item');
            if (rows !== undefined)
                return { kind: 'rows', rows, shape: 'envelope_item' };
        }
        if (isRecord(value))
            return { kind: 'document', value };
        throw new DatasetStoreError('dataset_not_row_readable', 'raw Dataset does not contain a supported row array or document object');
    }
    async resolveContained(relativePath, root, signal) {
        if (!this.fs)
            throw new DatasetStoreError('filesystem_unavailable', 'DSH filesystem service is not mounted');
        const target = await this.fs.resolve(relativePath, { cwd: root, signal });
        const rootTarget = await this.fs.resolve('.', { cwd: root, signal });
        if (typeof this.fs.contains !== 'function' || !this.fs.contains(rootTarget, target)) {
            throw new DatasetStoreError('workspace_not_writable', 'filesystem cannot prove workspace containment');
        }
        return target;
    }
    async assertContained(root, relativePath, signal) {
        await this.resolveContained(relativePath, root, signal);
    }
    writeContext(session) {
        if (!this.fs)
            throw new DatasetStoreError('filesystem_unavailable', 'DSH filesystem is not mounted; cannot persist a Dataset');
        if (typeof this.sandboxPolicy?.resolve !== 'function')
            throw new DatasetStoreError('sandbox_policy_unavailable', 'DSH sandbox policy is not mounted');
        if (!session || typeof session.id !== 'string' || session.id.length === 0)
            throw new DatasetStoreError('session_unavailable', 'the calling agent session has no id');
        const cwd = session.header?.cwd;
        if (typeof cwd !== 'string' || !isAbsolutePath(cwd))
            throw new DatasetStoreError('session_cwd_unavailable', 'calling agent workspace cwd is unavailable or not absolute');
        const policy = this.sandboxPolicy.resolve({ session });
        if (policy?.mode !== 'workspace-write' && policy?.mode !== 'danger-full-access') {
            throw new DatasetStoreError('workspace_not_writable', `current workspace permission is ${policy?.mode ?? 'unknown'}`);
        }
        const root = typeof policy.workspaceRoot === 'string' && policy.workspaceRoot.length > 0 ? policy.workspaceRoot : cwd;
        if (!isAbsolutePath(root))
            throw new DatasetStoreError('workspace_not_writable', 'resolved workspace root is not absolute');
        return { root, policy };
    }
    readRoot(session) {
        if (!this.fs)
            return undefined;
        const cwd = session?.header?.cwd;
        const policyRoot = typeof this.sandboxPolicy?.resolve === 'function' ? this.sandboxPolicy.resolve({ session })?.workspaceRoot : undefined;
        const root = typeof policyRoot === 'string' && policyRoot.length > 0 ? policyRoot : cwd;
        if (typeof root !== 'string' || !isAbsolutePath(root))
            return undefined;
        return root;
    }
    mapWriteError(error, action) {
        const code = errorCodeOf(error);
        if (code === 'FS_SANDBOX_DENIED' || code === 'FS_PERMISSION_DENIED') {
            throw new DatasetStoreError('workspace_not_writable', `${action} denied by the DSH file sandbox (${code})`);
        }
        throw new DatasetStoreError('dataset_write_failed', `${action} failed${code ? ` (${code})` : ''}`);
    }
}
function rowsAtPath(value, path) {
    const segments = path.split('.').filter(Boolean);
    const visit = (current, index) => {
        if (index === segments.length)
            return Array.isArray(current) ? current : undefined;
        if (!current || typeof current !== 'object' || Array.isArray(current))
            return undefined;
        const segment = segments[index];
        if (segment.endsWith('[]')) {
            const child = current[segment.slice(0, -2)];
            if (!Array.isArray(child))
                return undefined;
            const merged = [];
            for (const item of child) {
                const rows = visit(item, index + 1);
                if (rows === undefined)
                    return undefined;
                merged.push(...rows);
            }
            return merged;
        }
        return visit(current[segment], index + 1);
    };
    return visit(value, 0);
}
function sessionScopeFor(session) {
    const parentSession = session.header?.parentSession;
    return typeof parentSession === 'string' && parentSession.length > 0 ? parentSession : session.id;
}
function buildProfile(rows, requestedTimeColumn, primaryKey, contracts = {}) {
    const objectRows = rows.filter(isRecord);
    const observedColumns = objectRows.length > 0
        ? [...new Set(objectRows.flatMap((row) => Object.keys(row)))]
        : rows.length > 0 ? ['value'] : [];
    const columns = [...new Set([...observedColumns, ...Object.keys(contracts)])];
    const warnings = [];
    if (objectRows.length !== rows.length)
        warnings.push('some rows are not objects; object-column checks are partial');
    let missingValues = 0;
    for (const row of rows) {
        if (!isRecord(row)) {
            if (columns.includes('value') && row === null)
                missingValues += 1;
            continue;
        }
        for (const column of observedColumns)
            if (!(column in row) || row[column] === null || row[column] === undefined)
                missingValues += 1;
    }
    const seen = new Set();
    let duplicateRows = 0;
    for (const row of rows) {
        const key = primaryKey && isRecord(row)
            ? stableProfileValue(row[primaryKey])
            : stableProfileValue(row);
        if (seen.has(key))
            duplicateRows += 1;
        else
            seen.add(key);
    }
    const timeColumn = pickTimeColumn(rows, columns, requestedTimeColumn);
    let timeOrdered = null;
    if (timeColumn) {
        const values = rows.map((row) => isRecord(row) ? row[timeColumn] : undefined);
        if (values.every((value) => value !== undefined && value !== null)) {
            timeOrdered = true;
            for (let index = 1; index < values.length; index += 1) {
                if (compareProfileValues(values[index - 1], values[index]) > 0) {
                    timeOrdered = false;
                    break;
                }
            }
        }
        else {
            warnings.push(`time column ${timeColumn} contains missing values`);
        }
    }
    const statistics = {};
    const categories = {};
    const structure = {};
    const categoryTally = new Map();
    const structureEntries = new Map();
    let structureTruncated = false;
    const schema = {};
    const violations = [];
    for (const column of columns) {
        const contract = contracts[column];
        const observedTypes = {};
        let missingCount = 0;
        let nullCount = 0;
        let nonNullCount = 0;
        let invalidCount = 0;
        let numericStringCount = 0;
        for (const row of rows) {
            const cell = profileCell(row, column);
            if (!cell.present || cell.value === undefined) {
                missingCount += 1;
                incrementTypeCount(observedTypes, 'missing');
                continue;
            }
            const type = profileObservedType(cell.value);
            incrementTypeCount(observedTypes, type);
            if (cell.value === null) {
                nullCount += 1;
                continue;
            }
            nonNullCount += 1;
            if (contract && isNumericContract(contract.type) && typeof cell.value === 'string' && isFiniteNumericString(cell.value)) {
                numericStringCount += 1;
            }
            if (contract && !matchesProfileContract(cell.value, contract))
                invalidCount += 1;
            if (typeof cell.value === 'string')
                tallyCategoryValue(categoryTally, column, cell.value);
            if (Array.isArray(cell.value) || isRecord(cell.value)) {
                if (!structureEntries.has(column) && structureEntries.size >= MAX_STRUCTURE_ENTRIES)
                    structureTruncated = true;
                else
                    collectStructure(cell.value, column, 0, structureEntries);
            }
        }
        const inferredType = inferProfileType(observedTypes);
        const columnProfile = {
            contract_type: contract?.type ?? null,
            inferred_type: inferredType,
            observed_types: observedTypes,
            missing_count: missingCount,
            null_count: nullCount,
            non_null_count: nonNullCount,
            invalid_count: invalidCount,
            nullable: nullCount > 0,
            ...(contract?.nullable === undefined ? {} : { contract_nullable: contract.nullable }),
            ...(contract?.required === undefined ? {} : { required: contract.required }),
            ...(contract?.allowNumericString === undefined ? {} : { allow_numeric_string: contract.allowNumericString }),
            ...(numericStringCount > 0 ? { numeric_string_count: numericStringCount } : {}),
        };
        schema[column] = columnProfile;
        if (contract?.required && missingCount > 0) {
            violations.push({ column, rule: 'required', expected: true, observed: 'missing', invalid_count: missingCount, severity: 'error' });
        }
        if (contract?.nullable === false && nullCount > 0) {
            violations.push({ column, rule: 'nullable', expected: false, observed: 'null', invalid_count: nullCount, severity: 'error' });
        }
        if (invalidCount > 0) {
            violations.push({ column, rule: 'type', expected: contract?.type ?? 'unknown', observed: inferredType, invalid_count: invalidCount, severity: 'error' });
        }
        const values = rows
            .map((row) => profileCell(row, column))
            .filter((cell) => cell.present && typeof cell.value === 'number' && Number.isFinite(cell.value))
            .map((cell) => cell.value);
        if (values.length > 0) {
            const sorted = [...values].sort((a, b) => a - b);
            const total = values.reduce((sum, value) => sum + value, 0);
            statistics[column] = {
                count: values.length,
                sum: Number.isFinite(total) ? total : null,
                min: sorted[0],
                max: sorted[sorted.length - 1],
                mean: total / values.length,
                p25: profileQuantile(sorted, 0.25),
                p50: profileQuantile(sorted, 0.5),
                p75: profileQuantile(sorted, 0.75),
            };
        }
        if (inferredType === 'string') {
            const tally = categoryTally.get(column);
            const distinctCount = tally === undefined || tally.overflowed ? null : tally.counts.size;
            const top = [...(tally?.counts ?? new Map()).entries()]
                .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
                .slice(0, MAX_CATEGORY_TOP_VALUES)
                .map(([value, count]) => ({ value, count }));
            categories[column] = {
                distinct_count: distinctCount,
                top_values: top,
                truncated: distinctCount === null || distinctCount > top.length,
            };
        }
    }
    for (const [path, accumulator] of structureEntries)
        structure[path] = finishStructure(accumulator);
    if (structureTruncated)
        warnings.push(`structure digest truncated at ${MAX_STRUCTURE_ENTRIES} paths`);
    if ([...structureEntries.values()].some((accumulator) => accumulator.sampled))
        warnings.push(`structure digest sampled after ${MAX_STRUCTURE_SAMPLED_ELEMENTS} elements; sampled_elements is incomplete`);
    const timeFacts = timeColumn === undefined
        ? undefined
        : timeFactsFor(rows, timeColumn, timeOrdered, new Set(Object.keys(statistics)));
    return {
        row_count: rows.length,
        columns,
        quality: { missing_values: missingValues, duplicate_rows: duplicateRows, time_ordered: timeOrdered },
        ...(Object.keys(statistics).length > 0 ? { statistics } : {}),
        ...(Object.keys(categories).length > 0 ? { categories } : {}),
        ...(timeFacts === undefined ? {} : { time_facts: timeFacts }),
        ...(Object.keys(structure).length > 0 ? { structure } : {}),
        schema,
        validation: { status: violations.length > 0 ? 'fail' : 'pass', violations },
        warnings,
    };
}
/**
 * 挑时间列：显式指定优先；否则按列名候选，并要求该列的非空值全是数字或日期样式
 * 字符串。只按列名取第一个匹配列会把 `report_type`（季度枚举）误当时间轴，
 * 于是首末值与覆盖范围全是错的口径。
 */
function pickTimeColumn(rows, columns, requested) {
    if (requested !== undefined)
        return columns.includes(requested) ? requested : requested;
    for (const column of columns) {
        if (!/date|time|timestamp|_dt$|report$/i.test(column))
            continue;
        const values = rows
            .map((row) => profileCell(row, column))
            .filter((cell) => cell.present && cell.value !== null && cell.value !== undefined)
            .map((cell) => cell.value);
        if (values.length === 0)
            continue;
        if (values.every((value) => typeof value === 'number' && Number.isFinite(value)))
            return column;
        if (values.every((value) => typeof value === 'string' && DATE_LIKE_PATTERN.test(value.trim())))
            return column;
    }
    return undefined;
}
const DATE_LIKE_PATTERN = /^\d{4}(-\d{1,2}(-\d{1,2})?)?$/;
/**
 * 时间事实：覆盖范围 + 首行/末行的「时间列与数值列」取值（文件顺序）。
 *
 * 只报 min/max 时，模型会把区间极值讲成走势（实测样本里出现过「从 74 涨到 105
 * 以上随后可能回落」这种没有依据的叙述）。首末行给出的是真实首末取值，
 * 区间变化因此可追溯；`ordered_ascending` 说明文件顺序，避免把末行当成最新。
 */
/**
 * 时间事实的**唯一实现**（profile 与时间轴探针共用）：
 * 覆盖范围（原值 + ISO）、时间轴语义、常用窗口、首末行取值。
 */
function timeFactsFor(rows, timeColumn, orderedAscending, numericColumns) {
    const project = (row) => {
        const projected = {};
        if (!isRecord(row))
            return projected;
        for (const column of [timeColumn, ...numericColumns]) {
            if (column in projected)
                continue;
            const cell = profileCell(row, column);
            if (cell.present && cell.value !== undefined)
                projected[column] = cell.value;
        }
        return projected;
    };
    const timeValues = rows.map((row) => profileCell(row, timeColumn).value).filter((value) => value !== null && value !== undefined);
    let coveredFrom = null;
    let coveredTo = null;
    for (const value of timeValues) {
        if (coveredFrom === null || compareProfileValues(value, coveredFrom) < 0)
            coveredFrom = value;
        if (coveredTo === null || compareProfileValues(value, coveredTo) > 0)
            coveredTo = value;
    }
    const axis = probeTimeAxis(timeColumn, timeValues);
    const dates = readAxisDates({ axis, rows });
    const coveredFromIso = typeof coveredFrom === 'number' && axis.value_format === 'epoch_ms'
        ? isoDateFromEpoch(coveredFrom, axis.time_zone ?? 'UTC')
        : undefined;
    const coveredToIso = typeof coveredTo === 'number' && axis.value_format === 'epoch_ms'
        ? isoDateFromEpoch(coveredTo, axis.time_zone ?? 'UTC')
        : undefined;
    const windows = axis.value_format === 'unknown' ? [] : defaultAxisWindows({ axis, dates });
    return {
        time_column: timeColumn,
        ordered_ascending: orderedAscending,
        covered_from: coveredFrom,
        covered_to: coveredTo,
        ...(coveredFromIso === undefined ? {} : { covered_from_iso: coveredFromIso }),
        ...(coveredToIso === undefined ? {} : { covered_to_iso: coveredToIso }),
        axis,
        ...(windows.length === 0 ? {} : { windows }),
        first: project(rows[0]),
        last: project(rows[rows.length - 1]),
    };
}
function structureAccumulator(entries, path, type) {
    const existing = entries.get(path);
    if (existing !== undefined)
        return existing;
    if (entries.size >= MAX_STRUCTURE_ENTRIES)
        return undefined;
    const created = { type, occurrences: 0, totalElements: 0, emptyCount: 0, minLength: 0, maxLength: 0, sampledElements: 0, sampled: false, fields: new Map() };
    entries.set(path, created);
    return created;
}
/**
 * 把单元格里的数组/对象展开成有界路径摘要（深度 ≤3、条目 ≤24）。
 *
 * 路径约定：对象字段用 `.name`，数组元素用 `[]`，例如 QDII 额度的三层嵌套会得到
 * `sub_tab`（数组，共 3 项）→ `sub_tab[].fund_list`（数组，共 40 项）。
 * 未抽样时用 `total_elements` 表示完整数量；超过 50 项时改用 `sampled_elements`，明确只统计了实际检查到的部分，
 * 而不是让模型面对一句「sub_tab 的类型是 object」。
 */
function collectStructure(value, path, depth, entries, sampled = false) {
    if (depth > MAX_STRUCTURE_DEPTH)
        return;
    if (Array.isArray(value)) {
        const accumulator = structureAccumulator(entries, path, 'array');
        if (accumulator === undefined)
            return;
        accumulator.occurrences += 1;
        if (sampled || value.length > MAX_STRUCTURE_SAMPLED_ELEMENTS) {
            accumulator.sampled = true;
            accumulator.sampledElements += Math.min(value.length, MAX_STRUCTURE_SAMPLED_ELEMENTS);
        }
        else {
            accumulator.totalElements += value.length;
        }
        if (value.length === 0)
            accumulator.emptyCount += 1;
        if (accumulator.occurrences === 1) {
            accumulator.minLength = value.length;
            accumulator.maxLength = value.length;
        }
        else {
            accumulator.minLength = Math.min(accumulator.minLength, value.length);
            accumulator.maxLength = Math.max(accumulator.maxLength, value.length);
        }
        const sampledChildren = sampled || value.length > MAX_STRUCTURE_SAMPLED_ELEMENTS;
        for (const element of value.slice(0, MAX_STRUCTURE_SAMPLED_ELEMENTS)) {
            if (Array.isArray(element) || isRecord(element))
                collectStructure(element, `${path}[]`, depth + 1, entries, sampledChildren);
        }
        return;
    }
    if (!isRecord(value))
        return;
    const accumulator = structureAccumulator(entries, path, 'object');
    if (accumulator === undefined)
        return;
    accumulator.occurrences += 1;
    if (sampled) {
        accumulator.sampled = true;
        accumulator.sampledElements += 1;
    }
    for (const [key, child] of Object.entries(value)) {
        if (accumulator.fields.size < MAX_STRUCTURE_FIELDS) {
            const type = child === null || child === undefined ? 'null' : Array.isArray(child) ? 'array' : isRecord(child) ? 'object' : typeof child;
            if (!accumulator.fields.has(key))
                accumulator.fields.set(key, type);
        }
        if (Array.isArray(child) || isRecord(child))
            collectStructure(child, `${path}.${key}`, depth + 1, entries, sampled);
    }
}
function finishStructure(accumulator) {
    return {
        type: accumulator.type,
        occurrences: accumulator.occurrences,
        ...(accumulator.sampled ? { sampled_elements: accumulator.sampledElements } : { total_elements: accumulator.totalElements }),
        empty_count: accumulator.emptyCount,
        min_length: accumulator.minLength,
        max_length: accumulator.maxLength,
        fields: [...accumulator.fields.entries()].map(([name, type]) => ({ name, type })),
    };
}
function tallyCategoryValue(tally, column, value) {
    let columnTally = tally.get(column);
    if (columnTally === undefined) {
        columnTally = { counts: new Map(), overflowed: false };
        tally.set(column, columnTally);
    }
    const key = value.length > MAX_CATEGORY_VALUE_LENGTH ? `${value.slice(0, MAX_CATEGORY_VALUE_LENGTH)}…` : value;
    const existing = columnTally.counts.get(key);
    if (existing !== undefined) {
        columnTally.counts.set(key, existing + 1);
        return;
    }
    if (columnTally.counts.size >= MAX_CATEGORY_DISTINCT) {
        columnTally.overflowed = true;
        return;
    }
    columnTally.counts.set(key, 1);
}
/**
 * 文档型 Dataset 的 profile：没有行，所以不给行列统计，只给结构摘要。
 *
 * `$` 表示文档根，其余路径沿用 structure 的约定（对象字段用 `.name`、数组元素用 `[]`），
 * 例如财务指标会得到 `abilities`（共 5 项）与 `abilities[].indicators`（共 40 项）。
 */
function buildDocumentProfile(value) {
    const entries = new Map();
    collectStructure(value, '$', 0, entries);
    const structure = {};
    for (const [path, accumulator] of entries)
        structure[path] = finishStructure(accumulator);
    const warnings = ['dataset is a document (no row array); profile describes structure only'];
    if (entries.size >= MAX_STRUCTURE_ENTRIES)
        warnings.push(`structure digest truncated at ${MAX_STRUCTURE_ENTRIES} paths`);
    if ([...entries.values()].some((accumulator) => accumulator.sampled))
        warnings.push(`structure digest sampled after ${MAX_STRUCTURE_SAMPLED_ELEMENTS} elements; sampled_elements is incomplete`);
    return {
        row_count: 0,
        columns: [],
        quality: { missing_values: 0, duplicate_rows: 0, time_ordered: null },
        structure,
        warnings,
    };
}
/**
 * 把文档内容裁到预算内：长数组按档位逐级截断（保留前 N 项），每次尝试都重新
 * 量体积，直到放得下。返回实际采用的档位与被省略的路径，供模型如实披露
 * 「完整共 N 项，本次只给了前 K 项」。
 */
function boundDocument(value) {
    const measure = (candidate) => {
        try {
            const text = JSON.stringify(candidate);
            return typeof text === 'string' ? [...text].length : undefined;
        }
        catch {
            return undefined;
        }
    };
    const full = measure(value);
    if (full !== undefined && full <= MAX_DOCUMENT_CHARS)
        return { content: value, truncated: false, omitted: [] };
    for (const keep of DOCUMENT_ARRAY_KEEP_STEPS) {
        const omitted = [];
        const bounded = shrinkArrays(value, keep, '$', omitted, 0);
        const size = measure(bounded);
        if (size !== undefined && size <= MAX_DOCUMENT_CHARS)
            return { content: bounded, truncated: omitted.length > 0, omitted };
    }
    return {
        content: null,
        truncated: true,
        omitted: [{ path: '$', kept: 0, omitted: 1 }],
    };
}
function shrinkArrays(value, keep, path, omitted, depth) {
    if (depth > DOCUMENT_MAX_DEPTH)
        return value;
    if (Array.isArray(value)) {
        const head = value.slice(0, keep);
        if (value.length > keep && omitted.length < DOCUMENT_MAX_OMISSIONS) {
            omitted.push({ path, kept: keep, omitted: value.length - keep });
        }
        return head.map((element) => shrinkArrays(element, keep, `${path}[]`, omitted, depth + 1));
    }
    if (!isRecord(value))
        return value;
    const result = {};
    for (const [key, child] of Object.entries(value)) {
        result[key] = Array.isArray(child) || isRecord(child) ? shrinkArrays(child, keep, `${path}.${key}`, omitted, depth + 1) : child;
    }
    return result;
}
function profileCell(row, column) {
    if (isRecord(row))
        return { present: Object.prototype.hasOwnProperty.call(row, column), value: row[column] };
    return column === 'value' ? { present: true, value: row } : { present: false, value: undefined };
}
function profileObservedType(value) {
    if (value === null)
        return 'null';
    if (typeof value === 'boolean')
        return 'boolean';
    if (typeof value === 'number')
        return Number.isInteger(value) ? 'integer' : 'number';
    if (typeof value === 'string')
        return 'string';
    if (Array.isArray(value))
        return 'array';
    return 'object';
}
function incrementTypeCount(counts, type) {
    counts[type] = (counts[type] ?? 0) + 1;
}
function inferProfileType(observedTypes) {
    const nonNullTypes = Object.keys(observedTypes).filter((type) => !['missing', 'null'].includes(type) && (observedTypes[type] ?? 0) > 0);
    if (nonNullTypes.length === 1)
        return nonNullTypes[0];
    if (nonNullTypes.length > 1)
        return 'mixed';
    if ((observedTypes.null ?? 0) > 0)
        return 'null';
    return 'missing';
}
function isNumericContract(type) {
    return type === 'number' || type === 'integer';
}
function isFiniteNumericString(value) {
    return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Number(value));
}
function matchesProfileContract(value, contract) {
    if (value === null)
        return true;
    switch (contract.type) {
        case 'string': return typeof value === 'string';
        case 'number': return (typeof value === 'number' && Number.isFinite(value)) || (contract.allowNumericString === true && isFiniteNumericString(value));
        case 'integer': return (typeof value === 'number' && Number.isSafeInteger(value)) || (contract.allowNumericString === true && isFiniteNumericString(value) && Number.isSafeInteger(Number(value)));
        case 'boolean': return typeof value === 'boolean';
        case 'object': return isRecord(value);
        case 'array': return Array.isArray(value);
        case 'json': return true;
    }
}
function extractRowContracts(schema) {
    if (!isRecord(schema))
        return {};
    let rowSchema = schema;
    const rootProperties = isRecord(schema.properties) ? schema.properties : undefined;
    const itemSchema = rootProperties && isRecord(rootProperties.item) ? rootProperties.item : undefined;
    if (itemSchema)
        rowSchema = itemSchema;
    if (isRecord(rowSchema) && rowSchema.type === 'array' && rowSchema.items !== undefined)
        rowSchema = rowSchema.items;
    const properties = isRecord(rowSchema) && isRecord(rowSchema.properties) ? rowSchema.properties : undefined;
    if (!properties)
        return {};
    const contracts = {};
    for (const [column, property] of Object.entries(properties)) {
        const type = profileContractType(property);
        if (!type)
            continue;
        contracts[column] = { type, allowNumericString: type === 'number' || type === 'integer' };
    }
    return contracts;
}
function profileContractType(schema) {
    if (!isRecord(schema))
        return undefined;
    if (typeof schema.type === 'string') {
        if (schema.type === 'string')
            return 'string';
        if (schema.type === 'number')
            return 'number';
        if (schema.type === 'integer')
            return 'integer';
        if (schema.type === 'boolean')
            return 'boolean';
        if (schema.type === 'object')
            return 'object';
        if (schema.type === 'array')
            return 'array';
    }
    if (Array.isArray(schema.oneOf)) {
        for (const option of schema.oneOf) {
            const type = profileContractType(option);
            if (type)
                return type;
        }
    }
    return 'json';
}
function stableProfileValue(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableProfileValue).join(',')}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableProfileValue(record[key])}`).join(',')}}`;
}
function compareProfileValues(left, right) {
    if (typeof left === 'number' && typeof right === 'number')
        return left - right;
    const leftText = String(left);
    const rightText = String(right);
    return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}
function profileQuantile(sorted, probability) {
    if (sorted.length === 1)
        return sorted[0];
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper)
        return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
function validateStoredDatasetManifest(value, datasetId) {
    if (!isRecord(value))
        return undefined;
    if (value.dataset_id !== datasetId || !DATASET_ID_PATTERN.test(datasetId))
        return undefined;
    if (!(value.task_id === null || typeof value.task_id === 'string'))
        return undefined;
    if (typeof value.session_id !== 'string' || value.session_id.length === 0)
        return undefined;
    if (value.artifact_ref !== canonicalDatasetRef(datasetId))
        return undefined;
    if (value.format !== 'json' && value.format !== 'json_rows')
        return undefined;
    if (typeof value.capability !== 'string' || value.capability.length === 0)
        return undefined;
    if (typeof value.source_label !== 'string' || value.source_label.length === 0)
        return undefined;
    if (!(value.schema === null || isRecord(value.schema)))
        return undefined;
    if (!(value.row_count === null || validNonNegativeInteger(value.row_count)))
        return undefined;
    if (!Number.isSafeInteger(value.captured_at) || !Number.isSafeInteger(value.retention_until))
        return undefined;
    if (typeof value.params_digest !== 'string' || value.params_digest.length === 0)
        return undefined;
    if (value.row_key !== undefined && (typeof value.row_key !== 'string' || value.row_key.length === 0 || value.row_key.length > 128))
        return undefined;
    const ref = {
        dataset_id: value.dataset_id,
        task_id: value.task_id,
        session_id: value.session_id,
        artifact_ref: value.artifact_ref,
        format: value.format,
        capability: value.capability,
        source_label: value.source_label,
        schema: value.schema,
        row_count: value.row_count,
        captured_at: value.captured_at,
        retention_until: value.retention_until,
        params_digest: value.params_digest,
    };
    return {
        ...ref,
        // Manifests written before scope support remain readable by their producer only.
        session_scope_id: typeof value.session_scope_id === 'string' && value.session_scope_id.length > 0
            ? value.session_scope_id
            : ref.session_id,
        ...(value.row_key === undefined ? {} : { row_key: value.row_key }),
    };
}
function validateColumns(value, errorCode = 'profile_invalid', maxColumns = 64) {
    if (!Array.isArray(value) || value.length > maxColumns)
        throw new DatasetStoreError(errorCode, `columns must contain at most ${maxColumns} names`);
    const columns = value.map((column) => {
        if (typeof column !== 'string' || column.length === 0 || column.length > 128)
            throw new DatasetStoreError(errorCode, 'column name is invalid');
        return column;
    });
    if (new Set(columns).size !== columns.length)
        throw new DatasetStoreError(errorCode, 'columns must be unique');
    return columns;
}
function validateProfile(value) {
    if (!isRecord(value))
        throw new DatasetStoreError('profile_invalid', 'profile must be an object');
    const allowed = new Set(['row_count', 'columns', 'quality', 'statistics', 'categories', 'time_facts', 'structure', 'schema', 'validation', 'warnings']);
    if (Object.keys(value).some((key) => !allowed.has(key)))
        throw new DatasetStoreError('profile_invalid', 'profile contains unsupported fields');
    if (!validNonNegativeInteger(value.row_count))
        throw new DatasetStoreError('profile_invalid', 'profile.row_count must be a non-negative integer');
    const columns = validateColumns(value.columns, 'profile_invalid', Number.MAX_SAFE_INTEGER);
    if (!isRecord(value.quality))
        throw new DatasetStoreError('profile_invalid', 'profile.quality is required');
    const qualityKeys = new Set(['missing_values', 'duplicate_rows', 'time_ordered']);
    if (Object.keys(value.quality).some((key) => !qualityKeys.has(key)))
        throw new DatasetStoreError('profile_invalid', 'profile.quality contains unsupported fields');
    if (!validNonNegativeInteger(value.quality.missing_values) || !validNonNegativeInteger(value.quality.duplicate_rows))
        throw new DatasetStoreError('profile_invalid', 'quality counts must be non-negative integers');
    if (!(value.quality.time_ordered === null || typeof value.quality.time_ordered === 'boolean'))
        throw new DatasetStoreError('profile_invalid', 'quality.time_ordered must be boolean or null');
    if (!Array.isArray(value.warnings) || value.warnings.length > 32 || value.warnings.some((warning) => typeof warning !== 'string' || warning.length > 512))
        throw new DatasetStoreError('profile_invalid', 'warnings must be a bounded string array');
    let statistics;
    if (value.statistics !== undefined) {
        if (!isRecord(value.statistics))
            throw new DatasetStoreError('profile_invalid', 'statistics must be an object');
        statistics = {};
        const metricKeys = new Set(['count', 'sum', 'min', 'max', 'mean', 'p25', 'p50', 'p75']);
        for (const [column, metric] of Object.entries(value.statistics)) {
            if (column.length === 0 || column.length > 128 || !isRecord(metric) || Object.keys(metric).some((key) => !metricKeys.has(key)))
                throw new DatasetStoreError('profile_invalid', 'statistics contains an invalid column or metric');
            if (metric.count !== undefined && !validNonNegativeInteger(metric.count))
                throw new DatasetStoreError('profile_invalid', `statistics.${column}.count must be a non-negative integer`);
            for (const [key, item] of Object.entries(metric)) {
                if (key === 'count')
                    continue;
                if (!(item === null || (typeof item === 'number' && Number.isFinite(item))))
                    throw new DatasetStoreError('profile_invalid', `statistics.${column}.${key} must be a finite number or null`);
            }
            statistics[column] = metric;
        }
    }
    let categories;
    if (value.categories !== undefined) {
        if (!isRecord(value.categories))
            throw new DatasetStoreError('profile_invalid', 'categories must be an object');
        categories = {};
        for (const [column, item] of Object.entries(value.categories)) {
            if (!columns.includes(column) || !isRecord(item))
                throw new DatasetStoreError('profile_invalid', 'categories contains an invalid column');
            if (Object.keys(item).some((key) => !['distinct_count', 'top_values', 'truncated'].includes(key)))
                throw new DatasetStoreError('profile_invalid', `categories.${column} contains unsupported fields`);
            if (!(item.distinct_count === null || validNonNegativeInteger(item.distinct_count)))
                throw new DatasetStoreError('profile_invalid', `categories.${column}.distinct_count must be a non-negative integer or null`);
            if (typeof item.truncated !== 'boolean')
                throw new DatasetStoreError('profile_invalid', `categories.${column}.truncated must be boolean`);
            if (!Array.isArray(item.top_values) || item.top_values.length > MAX_CATEGORY_TOP_VALUES)
                throw new DatasetStoreError('profile_invalid', `categories.${column}.top_values must be a bounded array`);
            for (const entry of item.top_values) {
                if (!isRecord(entry) || typeof entry.value !== 'string' || entry.value.length > MAX_CATEGORY_VALUE_LENGTH + 1 || !validNonNegativeInteger(entry.count)) {
                    throw new DatasetStoreError('profile_invalid', `categories.${column}.top_values contains an invalid entry`);
                }
            }
            categories[column] = {
                distinct_count: item.distinct_count,
                top_values: item.top_values,
                truncated: item.truncated,
            };
        }
    }
    let timeFacts;
    if (value.time_facts !== undefined) {
        const item = value.time_facts;
        if (!isRecord(item) || typeof item.time_column !== 'string' || !columns.includes(item.time_column))
            throw new DatasetStoreError('profile_invalid', 'time_facts.time_column must be a profile column');
        if (Object.keys(item).some((key) => !['time_column', 'ordered_ascending', 'covered_from', 'covered_to', 'covered_from_iso', 'covered_to_iso', 'axis', 'windows', 'first', 'last'].includes(key)))
            throw new DatasetStoreError('profile_invalid', 'time_facts contains unsupported fields');
        if (!(item.ordered_ascending === null || typeof item.ordered_ascending === 'boolean'))
            throw new DatasetStoreError('profile_invalid', 'time_facts.ordered_ascending must be boolean or null');
        if (!isRecord(item.first) || !isRecord(item.last))
            throw new DatasetStoreError('profile_invalid', 'time_facts.first and time_facts.last must be objects');
        for (const [key, entry] of [...Object.entries(item.first), ...Object.entries(item.last)]) {
            if (!columns.includes(key))
                throw new DatasetStoreError('profile_invalid', `time_facts.${key} is not a profile column`);
            if (entry !== null && typeof entry === 'object')
                throw new DatasetStoreError('profile_invalid', `time_facts.${key} must be a scalar value`);
        }
        const axis = item.axis;
        if (!isRecord(axis) || axis.column !== item.time_column || !['epoch_ms', 'date_string', 'unknown'].includes(String(axis.value_format))) {
            throw new DatasetStoreError('profile_invalid', 'time_facts.axis must describe the time column');
        }
        if (Object.keys(axis).some((key) => !['column', 'value_format', 'time_zone', 'utc_offset', 'aligned_to'].includes(key))) {
            throw new DatasetStoreError('profile_invalid', 'time_facts.axis contains unsupported fields');
        }
        const windows = item.windows;
        if (windows !== undefined) {
            if (!Array.isArray(windows) || windows.length > MAX_TIME_WINDOWS)
                throw new DatasetStoreError('profile_invalid', `time_facts.windows must contain at most ${MAX_TIME_WINDOWS} windows`);
            for (const window of windows) {
                if (!isRecord(window) || typeof window.name !== 'string' || typeof window.start_date !== 'string' || typeof window.end_date !== 'string') {
                    throw new DatasetStoreError('profile_invalid', 'time_facts.windows items must carry name/start_date/end_date');
                }
            }
        }
        timeFacts = {
            time_column: item.time_column,
            ordered_ascending: item.ordered_ascending,
            covered_from: item.covered_from ?? null,
            covered_to: item.covered_to ?? null,
            ...(typeof item.covered_from_iso === 'string' ? { covered_from_iso: item.covered_from_iso } : {}),
            ...(typeof item.covered_to_iso === 'string' ? { covered_to_iso: item.covered_to_iso } : {}),
            axis: {
                column: item.time_column,
                value_format: axis.value_format,
                ...(typeof axis.time_zone === 'string' ? { time_zone: axis.time_zone } : {}),
                ...(typeof axis.utc_offset === 'string' ? { utc_offset: axis.utc_offset } : {}),
                ...(axis.aligned_to === 'local_midnight' || axis.aligned_to === 'calendar_day' || axis.aligned_to === 'unknown'
                    ? { aligned_to: axis.aligned_to }
                    : {}),
            },
            ...(windows === undefined ? {} : { windows: windows }),
            first: item.first,
            last: item.last,
        };
    }
    let structure;
    if (value.structure !== undefined) {
        if (!isRecord(value.structure))
            throw new DatasetStoreError('profile_invalid', 'structure must be an object');
        structure = {};
        if (Object.keys(value.structure).length > MAX_STRUCTURE_ENTRIES)
            throw new DatasetStoreError('profile_invalid', `structure must contain at most ${MAX_STRUCTURE_ENTRIES} paths`);
        for (const [path, item] of Object.entries(value.structure)) {
            if (path.length === 0 || path.length > 256 || !isRecord(item))
                throw new DatasetStoreError('profile_invalid', 'structure contains an invalid path');
            if (Object.keys(item).some((key) => !['type', 'occurrences', 'total_elements', 'sampled_elements', 'empty_count', 'min_length', 'max_length', 'fields'].includes(key)))
                throw new DatasetStoreError('profile_invalid', `structure.${path} contains unsupported fields`);
            if (item.type !== 'array' && item.type !== 'object')
                throw new DatasetStoreError('profile_invalid', `structure.${path}.type is invalid`);
            const hasTotal = item.total_elements !== undefined;
            const hasSampled = item.sampled_elements !== undefined;
            if (hasTotal === hasSampled)
                throw new DatasetStoreError("profile_invalid", "structure path must contain exactly one of total_elements or sampled_elements");
            for (const key of ['occurrences', 'empty_count', 'min_length', 'max_length', ...(hasTotal ? ['total_elements'] : ['sampled_elements'])]) {
                if (!validNonNegativeInteger(item[key]))
                    throw new DatasetStoreError("profile_invalid", "structure field must be a non-negative integer");
            }
            if (!Array.isArray(item.fields) || item.fields.length > MAX_STRUCTURE_FIELDS)
                throw new DatasetStoreError('profile_invalid', `structure.${path}.fields must be a bounded array`);
            for (const field of item.fields) {
                if (!isRecord(field) || typeof field.name !== 'string' || field.name.length === 0 || field.name.length > 128 || typeof field.type !== 'string' || field.type.length === 0 || field.type.length > 32) {
                    throw new DatasetStoreError('profile_invalid', `structure.${path}.fields contains an invalid entry`);
                }
            }
            structure[path] = item;
        }
    }
    let schema;
    if (value.schema !== undefined) {
        if (!isRecord(value.schema))
            throw new DatasetStoreError('profile_invalid', 'schema must be an object');
        schema = {};
        const observedTypes = new Set(['missing', 'null', 'boolean', 'integer', 'number', 'string', 'object', 'array', 'mixed']);
        const contractTypes = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'json']);
        for (const [column, item] of Object.entries(value.schema)) {
            if (column.length === 0 || column.length > 128 || !isRecord(item))
                throw new DatasetStoreError('profile_invalid', 'schema contains an invalid column');
            const itemKeys = new Set(['contract_type', 'inferred_type', 'observed_types', 'missing_count', 'null_count', 'non_null_count', 'invalid_count', 'nullable', 'contract_nullable', 'required', 'allow_numeric_string', 'numeric_string_count']);
            if (Object.keys(item).some((key) => !itemKeys.has(key)))
                throw new DatasetStoreError('profile_invalid', `schema.${column} contains unsupported fields`);
            if (!(item.contract_type === null || (typeof item.contract_type === 'string' && contractTypes.has(item.contract_type))))
                throw new DatasetStoreError('profile_invalid', `schema.${column}.contract_type is invalid`);
            if (typeof item.inferred_type !== 'string' || !observedTypes.has(item.inferred_type))
                throw new DatasetStoreError('profile_invalid', `schema.${column}.inferred_type is invalid`);
            const observedTypeCounts = item.observed_types;
            if (!isRecord(observedTypeCounts) || Object.keys(observedTypeCounts).some((key) => !observedTypes.has(key) || !validNonNegativeInteger(observedTypeCounts[key])))
                throw new DatasetStoreError('profile_invalid', `schema.${column}.observed_types is invalid`);
            const observedTotal = Object.values(observedTypeCounts).reduce((sum, count) => sum + count, 0);
            if (observedTotal !== value.row_count)
                throw new DatasetStoreError('profile_invalid', `schema.${column}.observed_types count does not equal row_count`);
            for (const key of ['missing_count', 'null_count', 'non_null_count', 'invalid_count'])
                if (!validNonNegativeInteger(item[key]))
                    throw new DatasetStoreError('profile_invalid', `schema.${column}.${key} must be a non-negative integer`);
            const rowCount = value.row_count;
            const missingCount = item.missing_count;
            const nullCount = item.null_count;
            const nonNullCount = item.non_null_count;
            const invalidCount = item.invalid_count;
            if (missingCount + nullCount + nonNullCount !== rowCount)
                throw new DatasetStoreError('profile_invalid', `schema.${column} value counts do not equal row_count`);
            if (invalidCount > nonNullCount)
                throw new DatasetStoreError('profile_invalid', `schema.${column}.invalid_count exceeds non_null_count`);
            if (typeof item.nullable !== 'boolean')
                throw new DatasetStoreError('profile_invalid', `schema.${column}.nullable must be boolean`);
            if (item.nullable !== (nullCount > 0))
                throw new DatasetStoreError('profile_invalid', `schema.${column}.nullable does not match null_count`);
            if (item.contract_nullable !== undefined && typeof item.contract_nullable !== 'boolean')
                throw new DatasetStoreError('profile_invalid', `schema.${column}.contract_nullable must be boolean`);
            if (item.required !== undefined && typeof item.required !== 'boolean')
                throw new DatasetStoreError('profile_invalid', `schema.${column}.required must be boolean`);
            if (item.allow_numeric_string !== undefined && typeof item.allow_numeric_string !== 'boolean')
                throw new DatasetStoreError('profile_invalid', `schema.${column}.allow_numeric_string must be boolean`);
            if (item.numeric_string_count !== undefined && !validNonNegativeInteger(item.numeric_string_count))
                throw new DatasetStoreError('profile_invalid', `schema.${column}.numeric_string_count must be a non-negative integer`);
            if (item.numeric_string_count !== undefined && item.numeric_string_count > nonNullCount)
                throw new DatasetStoreError('profile_invalid', `schema.${column}.numeric_string_count exceeds non_null_count`);
            schema[column] = item;
        }
        if (Object.keys(schema).some((column) => !columns.includes(column)))
            throw new DatasetStoreError('profile_invalid', 'schema columns must be listed in profile.columns');
    }
    let validation;
    if (value.validation !== undefined) {
        if (!isRecord(value.validation) || (value.validation.status !== 'pass' && value.validation.status !== 'fail') || !Array.isArray(value.validation.violations) || value.validation.violations.length > 64) {
            throw new DatasetStoreError('profile_invalid', 'validation must contain a status and bounded violations');
        }
        const violations = [];
        for (const item of value.validation.violations) {
            if (!isRecord(item) || typeof item.column !== 'string' || item.column.length === 0 || !['required', 'nullable', 'type'].includes(String(item.rule)) || !(typeof item.expected === 'string' || typeof item.expected === 'boolean') || typeof item.observed !== 'string' || !validNonNegativeInteger(item.invalid_count) || !['error', 'warning'].includes(String(item.severity))) {
                throw new DatasetStoreError('profile_invalid', 'validation contains an invalid violation');
            }
            violations.push({
                column: item.column,
                rule: item.rule,
                expected: item.expected,
                observed: item.observed,
                invalid_count: item.invalid_count,
                severity: item.severity,
            });
        }
        if ((value.validation.status === 'pass' && violations.length > 0) || (value.validation.status === 'fail' && violations.length === 0)) {
            throw new DatasetStoreError('profile_invalid', 'validation status does not match violations');
        }
        validation = { status: value.validation.status, violations };
    }
    return { row_count: value.row_count, columns, quality: { missing_values: value.quality.missing_values, duplicate_rows: value.quality.duplicate_rows, time_ordered: value.quality.time_ordered }, ...(statistics ? { statistics } : {}), ...(categories ? { categories } : {}), ...(timeFacts ? { time_facts: timeFacts } : {}), ...(structure ? { structure } : {}), ...(schema ? { schema } : {}), ...(validation ? { validation } : {}), warnings: value.warnings };
}
export function provideWorkspaceDatasetStore(ctx, options) {
    const store = new WorkspaceDatasetStore(options);
    ctx.provide('datasetStore', store);
    return store;
}
