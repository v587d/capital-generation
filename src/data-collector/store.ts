import { DatasetQueryError, executeJsonRowsQuery, type QueryResult, type QuerySpec } from './query.js'

/**
 * Phase 1/2 workspace-local Dataset store（设计约定见 AGENTS.md「数据布局」）。
 *
 * 原始 Dataset 只由宿主写入，Dataset/Profile 都通过 createIfAbsent 发布。
 * Agent 只能使用 dataset_id 和 opaque artifact_ref，不能传入真实路径。
 */

export const WORKSPACE_DATA_DIR = 'capital-data'
export const DATASETS_SUBDIR = `${WORKSPACE_DATA_DIR}/datasets`
export const PROFILES_SUBDIR = `${WORKSPACE_DATA_DIR}/profiles`
export const RAW_FILE = 'raw.json'
export const MANIFEST_FILE = 'manifest.json'
export const PROFILE_FILE = 'profile.json'
export const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_RAW_READ_BYTES = 16 * 1024 * 1024
export const MAX_PROFILE_BYTES = 64 * 1024
/** 类别事实：最多跟踪多少个不同取值；超过则 distinct_count 记 null 并标记 truncated。 */
export const MAX_CATEGORY_DISTINCT = 2_000
/** `top_values` 只展示前 N 个高频取值，其余由 truncated 显式披露。 */
export const MAX_CATEGORY_TOP_VALUES = 5
const MAX_CATEGORY_VALUE_LENGTH = 64
/** 结构摘要：路径条目上限与递归深度上限，保证 profile 体积有界。 */
export const MAX_STRUCTURE_ENTRIES = 24
/**
 * 递归深度上限。行集合里 depth 0 就是列本身，文档里 depth 0 是 `$` 根，
 * 因此文档需要多一层才够到 `abilities[].indicators[]` 这种叶子。
 * 条目上限（24）才是真正的体积闸门，深度只是防止病态深嵌套。
 */
const MAX_STRUCTURE_DEPTH = 4
const MAX_STRUCTURE_FIELDS = 8
const MAX_STRUCTURE_SAMPLED_ELEMENTS = 50

/**
 * 文档型 Dataset（顶层对象、没有行数组，如财务指标 / 回测结果）交给 data_junior 的
 * 内容预算（Unicode 码点数）。取值必须留在 preset 的工具结果剪枝阈值（8192）以内：
 * 超过就会被剪掉中间段，而不是被完整读到。长数组按下面的档位逐级截断，截断了什么
 * 一律写进 `omitted`，不做静默省略。
 */
export const MAX_DOCUMENT_CHARS = 6_000
const DOCUMENT_ARRAY_KEEP_STEPS = [8, 3, 1, 0]
const DOCUMENT_MAX_DEPTH = 6
const DOCUMENT_MAX_OMISSIONS = 8

export const ARTIFACT_SCHEME = 'workspace://'

export interface DatasetRef {
  dataset_id: string
  task_id: string | null
  session_id: string
  artifact_ref: string
  format: 'json' | 'json_rows'
  capability: string
  source_label: string
  schema: object | null
  row_count: number | null
  captured_at: number
  retention_until: number
  params_digest: string
}

type StoredDatasetManifest = DatasetRef & {
  /** Host-only authorization scope; never returned as part of DatasetRef. */
  session_scope_id: string
  /** Host-only row array key; old manifests default to `item`. */
  row_key?: string
}

export type DatasetShape = 'array' | 'envelope_item' | 'document' | 'none'

export interface DatasetInspection extends DatasetRef {
  query_access: {
    /** true = 宿主可读取并产出事实（rows 可 query，document 只能 profile）。 */
    readable: boolean
    shape: DatasetShape
    reason?: string
  }
}

export interface ProfileRef {
  profile_id: string
  dataset_id: string
  task_id: string | null
  session_id: string
  artifact_ref: string
  created_at: number
  retention_until: number
}

export type ProfileObservedType = 'missing' | 'null' | 'boolean' | 'integer' | 'number' | 'string' | 'object' | 'array' | 'mixed'
export type ProfileContractType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'json'

export interface ProfileColumn {
  contract_type: ProfileContractType | null
  inferred_type: ProfileObservedType
  observed_types: Partial<Record<ProfileObservedType, number>>
  missing_count: number
  null_count: number
  non_null_count: number
  invalid_count: number
  nullable: boolean
  contract_nullable?: boolean
  required?: boolean
  allow_numeric_string?: boolean
  numeric_string_count?: number
}

export interface ProfileValidationViolation {
  column: string
  rule: 'required' | 'nullable' | 'type'
  expected: string | boolean
  observed: string
  invalid_count: number
  severity: 'error' | 'warning'
}

export interface ProfileValidation {
  status: 'pass' | 'fail'
  violations: ProfileValidationViolation[]
}

/**
 * Profile 的职责：把「原始行」翻译成模型可以安全引用的事实。
 *
 * 除了逐列的类型与缺失统计（Phase 1），Phase 2 起补齐四类事实，它们对应
 * Fuyao 数据里最常见的四类问题：
 * - `statistics` 加 `count` / `sum`：回答「合计多少、覆盖多少条」；
 * - `categories`：字符串列的 distinct 与高频取值，回答「有哪些类别、分布如何」；
 * - `time_facts`：时间列的覆盖范围 + 首行/末行的数值，回答「最新值、区间涨跌」——
 *   只报 min/max 会被模型讲成「先涨到最高再回落」，这是实测过的失真来源；
 * - `structure`：单元格里的数组/对象展开成有界路径摘要，回答「里面有几层、
 *   多少个叶子」，避免只报一句「这一格是 object」。
 */
export interface ProfileStatistic {
  count?: number
  sum?: number | null
  min?: number | null
  max?: number | null
  mean?: number | null
  p25?: number | null
  p50?: number | null
  p75?: number | null
}

export interface ProfileCategoryValue {
  value: string
  count: number
}

export interface ProfileCategory {
  /** 精确去重数；超过枚举上限时为 null（此时 truncated=true）。 */
  distinct_count: number | null
  top_values: ProfileCategoryValue[]
  /** true = 还有未展示的取值，`top_values` 不是全部。 */
  truncated: boolean
}

export interface ProfileTimeFacts {
  time_column: string
  /** 文件顺序是否随时间递增；null = 时间列有缺失，无法判断。 */
  ordered_ascending: boolean | null
  /** 时间列的最小/最大值（覆盖范围），原值不改写。 */
  covered_from: unknown
  covered_to: unknown
  /** 首行与末行的「时间列 + 数值列」取值（文件顺序），用于首末值与区间变化。 */
  first: Record<string, unknown>
  last: Record<string, unknown>
}

export interface ProfileStructureField {
  name: string
  type: string
}

export interface ProfileStructure {
  type: 'array' | 'object'
  /** 该路径在数据中出现的次数（行内多次出现会累加）。 */
  occurrences: number
  /** 未抽样时，所有出现位置的元素总数；对象路径不返回该字段。 */
  total_elements?: number
  /** 该路径受上限影响时，实际检查到的元素/对象数量；存在时不代表完整数量。 */
  sampled_elements?: number
  /** 数组：空数组的出现次数与长度极值。 */
  empty_count: number
  min_length: number
  max_length: number
  /** 对象：直接字段名与观察到的类型（有界）。 */
  fields: ProfileStructureField[]
}

export interface ProfilePayload {
  row_count: number
  columns: string[]
  quality: {
    missing_values: number
    duplicate_rows: number
    time_ordered: boolean | null
  }
  statistics?: Record<string, ProfileStatistic>
  categories?: Record<string, ProfileCategory>
  time_facts?: ProfileTimeFacts
  structure?: Record<string, ProfileStructure>
  schema?: Record<string, ProfileColumn>
  validation?: ProfileValidation
  warnings: string[]
}

export type DatasetStoreErrorCode =
  | 'workspace_not_writable'
  | 'session_unavailable'
  | 'session_cwd_unavailable'
  | 'sandbox_policy_unavailable'
  | 'filesystem_unavailable'
  | 'dataset_write_failed'
  | 'dataset_id_invalid'
  | 'dataset_not_found'
  | 'dataset_expired'
  | 'dataset_session_mismatch'
  | 'dataset_manifest_invalid'
  | 'dataset_format_unsupported'
  | 'dataset_not_row_readable'
  | 'dataset_too_large'
  | 'profile_invalid'
  | 'profile_too_large'
  | 'profile_dataset_mismatch'

export class DatasetStoreError extends Error {
  readonly code: DatasetStoreErrorCode
  constructor(code: DatasetStoreErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'DatasetStoreError'
    this.code = code
  }
}

export interface SessionLike {
  readonly id: string
  readonly header?: { readonly cwd?: string; readonly parentSession?: string }
}

export interface SandboxPolicyResultLike {
  readonly mode?: string
  readonly workspaceRoot?: string
  readonly sessionId?: string
}

export interface SandboxPolicyLike {
  resolve?(request: { session?: SessionLike }): SandboxPolicyResultLike
}

export interface FsTargetLike {
  readonly targetKey: unknown
  readonly displayPath: string
}

export interface FsLike {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTargetLike>
  contains?(parent: FsTargetLike, child: FsTargetLike): boolean
  stat?(target: FsTargetLike, signal?: AbortSignal): Promise<{ type: 'file' | 'directory' | 'other'; size?: number } | undefined>
  writeText(
    target: FsTargetLike,
    content: string,
    expected?: { kind: 'createIfAbsent' } | { kind: 'replaceIfVersion'; version: unknown },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxPolicyResultLike,
  ): Promise<unknown>
  readText(target: FsTargetLike, signal?: AbortSignal): Promise<string>
  listDir(target: FsTargetLike, signal?: AbortSignal): Promise<Array<{ name: string; type: 'file' | 'directory' | 'other'; target: FsTargetLike }>>
}

export interface ProfileDatasetInput {
  session: SessionLike
  dataset_id: string
  task_id?: string
  time_column?: string
  primary_key?: string
  signal?: AbortSignal
}

export interface QueryDatasetInput {
  session: SessionLike
  dataset_id: string
  query: QuerySpec
  signal?: AbortSignal
}

export interface ProfileDatasetResult extends ProfileRef {
  row_count: number
  columns: string[]
  quality: ProfilePayload['quality']
  statistics?: ProfilePayload['statistics']
  categories?: ProfilePayload['categories']
  time_facts?: ProfilePayload['time_facts']
  structure?: ProfilePayload['structure']
  schema?: ProfilePayload['schema']
  validation?: ProfilePayload['validation']
  warnings: string[]
  /** 仅文档型 Dataset：有界内容，不随 profile 持久化。 */
  document?: ProfileDocument
}

export interface ProfileDocument {
  /** 有界后的文档内容；连最小档位都放不下时为 null。 */
  content: unknown
  truncated: boolean
  /** 被截断的数组路径与省略条数，逐个披露，不做静默省略。 */
  omitted: Array<{ path: string; kept: number; omitted: number }>
}

type RawDataset =
  | { kind: 'rows'; rows: unknown[]; shape: 'array' | 'envelope_item' }
  | { kind: 'document'; value: Record<string, unknown> }

export interface FindDatasetInput {
  session: SessionLike
  capability: string
  params_digest: string
  signal?: AbortSignal
}

export interface SaveDatasetInput {
  session: SessionLike
  capability: string
  task_id?: string
  params_digest: string
  source_label: string
  format: 'json' | 'json_rows'
  schema: object | null
  row_count: number | null
  data: unknown
  /** Host-only row array key for envelope-shaped json_rows data. */
  row_key?: string
  signal?: AbortSignal
}

export interface WriteProfileInput {
  session: SessionLike
  dataset_id: string
  task_id?: string
  profile: unknown
  signal?: AbortSignal
}

export interface WorkspaceDatasetStoreOptions {
  fs?: FsLike
  sandboxPolicy?: SandboxPolicyLike
  retentionMs?: number
  now?: () => number
  newId?: (prefix: string) => string
}

function defaultNewId(prefix: string): string {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoLike?.randomUUID) return `${prefix}_${cryptoLike.randomUUID()}`
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export const DATASET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function isAbsolutePath(value: string): boolean {
  return /^([a-zA-Z]:[\\/]|\/)/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorCodeOf(error: unknown): string | undefined {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  return undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function canonicalDatasetRef(datasetId: string): string {
  return `${ARTIFACT_SCHEME}${DATASETS_SUBDIR}/${datasetId}`
}

function canonicalProfileRef(profileId: string): string {
  return `${ARTIFACT_SCHEME}${PROFILES_SUBDIR}/${profileId}`
}

function validNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export class WorkspaceDatasetStore {
  private readonly fs: FsLike | undefined
  private readonly sandboxPolicy: SandboxPolicyLike | undefined
  private readonly retentionMs: number
  private readonly now: () => number
  private readonly newId: (prefix: string) => string

  constructor(options: WorkspaceDatasetStoreOptions = {}) {
    this.fs = options.fs
    this.sandboxPolicy = options.sandboxPolicy
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS
    this.now = options.now ?? (() => Date.now())
    this.newId = options.newId ?? defaultNewId
  }

  async save(input: SaveDatasetInput): Promise<DatasetRef> {
    const { session, signal } = input
    const { root, policy } = this.writeContext(session)
    const datasetId = this.newId('ds')
    if (!DATASET_ID_PATTERN.test(datasetId)) {
      throw new DatasetStoreError('dataset_write_failed', `generated dataset_id is invalid: ${datasetId}`)
    }
    const dirPath = `${DATASETS_SUBDIR}/${datasetId}`
    await this.assertContained(root, dirPath, signal)

    const capturedAt = this.now()
    const manifest: DatasetRef = {
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
    }

    const storedManifest: StoredDatasetManifest = {
      ...manifest,
      session_scope_id: sessionScopeFor(session),
      ...(input.row_key === undefined ? {} : { row_key: input.row_key }),
    }

    let rawContent: string | undefined
    try {
      rawContent = JSON.stringify(input.data)
    } catch (error) {
      throw new DatasetStoreError('dataset_write_failed', `source result is not JSON-serializable: ${errorMessage(error)}`)
    }
    if (typeof rawContent !== 'string') {
      throw new DatasetStoreError('dataset_write_failed', 'source result is not JSON-serializable: JSON.stringify returned no value')
    }

    const rawTarget = await this.resolveContained(`${dirPath}/${RAW_FILE}`, root, signal)
    try {
      await this.fs!.writeText(rawTarget, rawContent, { kind: 'createIfAbsent' }, signal, policy)
    } catch (error) {
      this.mapWriteError(error, 'writing raw.json')
    }

    const manifestTarget = await this.resolveContained(`${dirPath}/${MANIFEST_FILE}`, root, signal)
    try {
      await this.fs!.writeText(manifestTarget, JSON.stringify(storedManifest), { kind: 'createIfAbsent' }, signal, policy)
    } catch (error) {
      this.mapWriteError(error, `writing manifest.json (raw.json of ${datasetId} may remain on disk)`)
    }
    return manifest
  }

  async readRef(datasetId: string, session: SessionLike, signal?: AbortSignal): Promise<DatasetRef | undefined> {
    try {
      return await this.requireRef(datasetId, session, signal)
    } catch {
      return undefined
    }
  }

  async listRefs(session: SessionLike, signal?: AbortSignal): Promise<DatasetRef[]> {
    const root = this.readRoot(session)
    if (!root || !this.fs) return []
    try {
      const dirTarget = await this.resolveContained(DATASETS_SUBDIR, root, signal)
      const entries = await this.fs.listDir(dirTarget, signal)
      const refs: DatasetRef[] = []
      for (const entry of entries) {
        if (entry.type !== 'directory') continue
        const ref = await this.readRef(entry.name, session, signal)
        if (ref) refs.push(ref)
      }
      return refs.sort((a, b) => b.captured_at - a.captured_at)
    } catch {
      return []
    }
  }

  async findLatest(input: FindDatasetInput): Promise<DatasetRef | undefined> {
    const refs = await this.listRefs(input.session, input.signal)
    return refs.find((ref) => ref.capability === input.capability && ref.params_digest === input.params_digest)
  }

  async inspectDataset(datasetId: string, session: SessionLike, signal?: AbortSignal): Promise<DatasetInspection> {
    const stored = await this.requireStoredRef(datasetId, session, signal)
    const { session_scope_id: _scope, row_key: rowKey, ...ref } = stored
    try {
      const raw = await this.readRaw(ref, session, signal, rowKey)
      return { ...ref, query_access: { readable: true, shape: raw.kind === 'document' ? 'document' : raw.shape } }
    } catch (error) {
      if (error instanceof DatasetStoreError && ['dataset_too_large', 'dataset_not_row_readable'].includes(error.code)) {
        return { ...ref, query_access: { readable: false, shape: 'none', reason: error.code } }
      }
      throw error
    }
  }

  async profileDataset(input: ProfileDatasetInput): Promise<ProfileDatasetResult> {
    const stored = await this.requireStoredRef(input.dataset_id, input.session, input.signal)
    const { session_scope_id: _scope, row_key: rowKey, ...ref } = stored
    const raw = await this.readRaw(ref, input.session, input.signal, rowKey)
    if (raw.kind === 'document') {
      const profile = buildDocumentProfile(raw.value)
      const profileRef = await this.writeProfile({
        session: input.session,
        dataset_id: ref.dataset_id,
        task_id: input.task_id,
        profile,
        signal: input.signal,
      })
      // 结构摘要随 profile 持久化；有界内容只随本次工具结果返回，不进入 profile 产物。
      return { ...profileRef, ...profile, document: boundDocument(raw.value) }
    }
    const profile = buildProfile(raw.rows, input.time_column, input.primary_key, extractRowContracts(ref.schema))
    const profileRef = await this.writeProfile({
      session: input.session,
      dataset_id: ref.dataset_id,
      task_id: input.task_id,
      profile,
      signal: input.signal,
    })
    return { ...profileRef, ...profile }
  }

  async queryDataset(input: QueryDatasetInput): Promise<QueryResult> {
    const stored = await this.requireStoredRef(input.dataset_id, input.session, input.signal)
    const { session_scope_id: _scope, row_key: rowKey, ...ref } = stored
    const raw = await this.readRaw(ref, input.session, input.signal, rowKey)
    if (raw.kind !== 'rows') throw new DatasetStoreError('dataset_format_unsupported', 'a document Dataset has no rows to query; profile it instead')
    if (input.query.dataset_id !== ref.dataset_id) {
      throw new DatasetQueryError('query_spec_invalid', 'query.dataset_id must match the requested Dataset')
    }
    return executeJsonRowsQuery(raw.rows, ref.schema, input.query)
  }

  async writeProfile(input: WriteProfileInput): Promise<ProfileRef> {
    const { session, signal } = input
    const ref = await this.requireRef(input.dataset_id, session, signal)
    const profile = validateProfile(input.profile)
    const encodedProfile = JSON.stringify(profile)
    if (byteLength(encodedProfile) > MAX_PROFILE_BYTES) throw new DatasetStoreError('profile_too_large', `profile exceeds ${MAX_PROFILE_BYTES} bytes`)

    const { root, policy } = this.writeContext(session)
    const profileId = this.newId('p')
    if (!PROFILE_ID_PATTERN.test(profileId)) throw new DatasetStoreError('profile_invalid', `generated profile_id is invalid: ${profileId}`)
    const createdAt = this.now()
    const profileRef: ProfileRef = {
      profile_id: profileId,
      dataset_id: ref.dataset_id,
      task_id: input.task_id ?? null,
      session_id: session.id,
      artifact_ref: canonicalProfileRef(profileId),
      created_at: createdAt,
      retention_until: Math.min(ref.retention_until, createdAt + this.retentionMs),
    }
    const target = await this.resolveContained(`${PROFILES_SUBDIR}/${profileId}/${PROFILE_FILE}`, root, signal)
    try {
      await this.fs!.writeText(target, JSON.stringify({ ref: profileRef, profile }), { kind: 'createIfAbsent' }, signal, policy)
    } catch (error) {
      this.mapWriteError(error, `writing profile.json (${profileId})`)
    }
    return profileRef
  }

  private async requireRef(datasetId: string, session: SessionLike, signal?: AbortSignal): Promise<DatasetRef> {
    const stored = await this.requireStoredRef(datasetId, session, signal)
    const { session_scope_id: _scope, row_key: _rowKey, ...ref } = stored
    return ref
  }

  private async requireStoredRef(datasetId: string, session: SessionLike, signal?: AbortSignal): Promise<StoredDatasetManifest> {
    if (!DATASET_ID_PATTERN.test(datasetId)) throw new DatasetStoreError('dataset_id_invalid', 'dataset_id is invalid')
    if (!session || typeof session.id !== 'string' || session.id.length === 0) throw new DatasetStoreError('session_unavailable', 'the calling agent session has no id')
    const root = this.readRoot(session)
    if (!root || !this.fs) throw new DatasetStoreError('filesystem_unavailable', 'workspace filesystem is unavailable')
    let text: string
    try {
      const target = await this.resolveContained(`${DATASETS_SUBDIR}/${datasetId}/${MANIFEST_FILE}`, root, signal)
      text = await this.fs.readText(target, signal)
    } catch (error) {
      if (errorCodeOf(error) === 'FS_NOT_FOUND') throw new DatasetStoreError('dataset_not_found', `Dataset ${datasetId} was not found`)
      if (error instanceof DatasetStoreError) throw error
      throw new DatasetStoreError('dataset_manifest_invalid', 'Dataset manifest could not be read')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new DatasetStoreError('dataset_manifest_invalid', 'Dataset manifest is not valid JSON')
    }
    const stored = validateStoredDatasetManifest(parsed, datasetId)
    if (!stored) throw new DatasetStoreError('dataset_manifest_invalid', 'Dataset manifest fields are invalid')
    if (stored.session_scope_id !== sessionScopeFor(session)) throw new DatasetStoreError('dataset_session_mismatch', 'Dataset belongs to another session scope')
    if (stored.retention_until <= this.now()) throw new DatasetStoreError('dataset_expired', `Dataset ${datasetId} has expired`)
    return stored
  }

  /**
   * 读取原始 Dataset。返回两种形状之一：
   * - `rows`：顶层数组或 manifest 声明的行数组键，可 profile、可 query；
   * - `document`：顶层对象且没有行数组（财务指标、回测结果这类），可 profile
   *   （宿主算结构摘要 + 有界内容），不可 query。
   * 判定放在读取时而不是复用 manifest 的 `format`：`format` 只记录写入时的粗略
   * 形状，真正的形状以文件内容为准。
   */
  private async readRaw(ref: DatasetRef, session: SessionLike, signal?: AbortSignal, rowKey?: string): Promise<RawDataset> {
    const root = this.readRoot(session)
    if (!root || !this.fs) throw new DatasetStoreError('filesystem_unavailable', 'workspace filesystem is unavailable')
    const target = await this.resolveContained(`${DATASETS_SUBDIR}/${ref.dataset_id}/${RAW_FILE}`, root, signal)
    const info = this.fs.stat ? await this.fs.stat(target, signal) : undefined
    if (info && info.type !== 'file') throw new DatasetStoreError('dataset_not_row_readable', 'raw Dataset object is not a regular file')
    if (typeof info?.size === 'number' && info.size > MAX_RAW_READ_BYTES) throw new DatasetStoreError('dataset_too_large', `raw Dataset exceeds ${MAX_RAW_READ_BYTES} bytes`)
    let text: string
    try {
      text = await this.fs.readText(target, signal)
    } catch {
      throw new DatasetStoreError('dataset_not_row_readable', 'raw Dataset could not be read')
    }
    if (byteLength(text) > MAX_RAW_READ_BYTES) throw new DatasetStoreError('dataset_too_large', `raw Dataset exceeds ${MAX_RAW_READ_BYTES} bytes`)
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new DatasetStoreError('dataset_not_row_readable', 'raw Dataset is not valid JSON')
    }
    if (Array.isArray(value)) return { kind: 'rows', rows: value, shape: 'array' }
    if (isRecord(value)) {
      const rows = rowsAtPath(value, rowKey ?? 'item')
      if (rows !== undefined) return { kind: 'rows', rows, shape: 'envelope_item' }
    }
    if (isRecord(value)) return { kind: 'document', value }
    throw new DatasetStoreError('dataset_not_row_readable', 'raw Dataset does not contain a supported row array or document object')
  }

  private async resolveContained(relativePath: string, root: string, signal?: AbortSignal): Promise<FsTargetLike> {
    if (!this.fs) throw new DatasetStoreError('filesystem_unavailable', 'DSH filesystem service is not mounted')
    const target = await this.fs.resolve(relativePath, { cwd: root, signal })
    const rootTarget = await this.fs.resolve('.', { cwd: root, signal })
    if (typeof this.fs.contains !== 'function' || !this.fs.contains(rootTarget, target)) {
      throw new DatasetStoreError('workspace_not_writable', 'filesystem cannot prove workspace containment')
    }
    return target
  }

  private async assertContained(root: string, relativePath: string, signal?: AbortSignal): Promise<void> {
    await this.resolveContained(relativePath, root, signal)
  }

  private writeContext(session: SessionLike): { root: string; policy: SandboxPolicyResultLike } {
    if (!this.fs) throw new DatasetStoreError('filesystem_unavailable', 'DSH filesystem is not mounted; cannot persist a Dataset')
    if (typeof this.sandboxPolicy?.resolve !== 'function') throw new DatasetStoreError('sandbox_policy_unavailable', 'DSH sandbox policy is not mounted')
    if (!session || typeof session.id !== 'string' || session.id.length === 0) throw new DatasetStoreError('session_unavailable', 'the calling agent session has no id')
    const cwd = session.header?.cwd
    if (typeof cwd !== 'string' || !isAbsolutePath(cwd)) throw new DatasetStoreError('session_cwd_unavailable', 'calling agent workspace cwd is unavailable or not absolute')
    const policy = this.sandboxPolicy.resolve({ session })
    if (policy?.mode !== 'workspace-write' && policy?.mode !== 'danger-full-access') {
      throw new DatasetStoreError('workspace_not_writable', `current workspace permission is ${policy?.mode ?? 'unknown'}`)
    }
    const root = typeof policy.workspaceRoot === 'string' && policy.workspaceRoot.length > 0 ? policy.workspaceRoot : cwd
    if (!isAbsolutePath(root)) throw new DatasetStoreError('workspace_not_writable', 'resolved workspace root is not absolute')
    return { root, policy }
  }

  private readRoot(session: SessionLike): string | undefined {
    if (!this.fs) return undefined
    const cwd = session?.header?.cwd
    const policyRoot = typeof this.sandboxPolicy?.resolve === 'function' ? this.sandboxPolicy.resolve({ session })?.workspaceRoot : undefined
    const root = typeof policyRoot === 'string' && policyRoot.length > 0 ? policyRoot : cwd
    if (typeof root !== 'string' || !isAbsolutePath(root)) return undefined
    return root
  }

  private mapWriteError(error: unknown, action: string): never {
    const code = errorCodeOf(error)
    if (code === 'FS_SANDBOX_DENIED' || code === 'FS_PERMISSION_DENIED') {
      throw new DatasetStoreError('workspace_not_writable', `${action} denied by the DSH file sandbox (${code})`)
    }
    throw new DatasetStoreError('dataset_write_failed', `${action} failed${code ? ` (${code})` : ''}`)
  }
}
function rowsAtPath(value: unknown, path: string): unknown[] | undefined {
  const segments = path.split('.').filter(Boolean)
  const visit = (current: unknown, index: number): unknown[] | undefined => {
    if (index === segments.length) return Array.isArray(current) ? current : undefined
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    const segment = segments[index]
    if (segment.endsWith('[]')) {
      const child = (current as Record<string, unknown>)[segment.slice(0, -2)]
      if (!Array.isArray(child)) return undefined
      const merged: unknown[] = []
      for (const item of child) {
        const rows = visit(item, index + 1)
        if (rows === undefined) return undefined
        merged.push(...rows)
      }
      return merged
    }
    return visit((current as Record<string, unknown>)[segment], index + 1)
  }
  return visit(value, 0)
}

function sessionScopeFor(session: SessionLike): string {
  const parentSession = session.header?.parentSession
  return typeof parentSession === 'string' && parentSession.length > 0 ? parentSession : session.id
}

type ProfileContract = {
  type: ProfileContractType
  nullable?: boolean
  required?: boolean
  allowNumericString?: boolean
}

function buildProfile(
  rows: unknown[],
  requestedTimeColumn?: string,
  primaryKey?: string,
  contracts: Record<string, ProfileContract> = {},
): ProfilePayload {
  const objectRows = rows.filter(isRecord)
  const observedColumns = objectRows.length > 0
    ? [...new Set(objectRows.flatMap((row) => Object.keys(row)))]
    : rows.length > 0 ? ['value'] : []
  const columns = [...new Set([...observedColumns, ...Object.keys(contracts)])]
  const warnings: string[] = []
  if (objectRows.length !== rows.length) warnings.push('some rows are not objects; object-column checks are partial')

  let missingValues = 0
  for (const row of rows) {
    if (!isRecord(row)) {
      if (columns.includes('value') && row === null) missingValues += 1
      continue
    }
    for (const column of observedColumns) if (!(column in row) || row[column] === null || row[column] === undefined) missingValues += 1
  }

  const seen = new Set<string>()
  let duplicateRows = 0
  for (const row of rows) {
    const key = primaryKey && isRecord(row)
      ? stableProfileValue(row[primaryKey])
      : stableProfileValue(row)
    if (seen.has(key)) duplicateRows += 1
    else seen.add(key)
  }

  const timeColumn = pickTimeColumn(rows, columns, requestedTimeColumn)
  let timeOrdered: boolean | null = null
  if (timeColumn) {
    const values = rows.map((row) => isRecord(row) ? row[timeColumn] : undefined)
    if (values.every((value) => value !== undefined && value !== null)) {
      timeOrdered = true
      for (let index = 1; index < values.length; index += 1) {
        if (compareProfileValues(values[index - 1], values[index]) > 0) {
          timeOrdered = false
          break
        }
      }
    } else {
      warnings.push(`time column ${timeColumn} contains missing values`)
    }
  }

  const statistics: NonNullable<ProfilePayload['statistics']> = {}
  const categories: NonNullable<ProfilePayload['categories']> = {}
  const structure: NonNullable<ProfilePayload['structure']> = {}
  const categoryTally = new Map<string, CategoryTally>()
  const structureEntries = new Map<string, StructureAccumulator>()
  let structureTruncated = false
  const schema: Record<string, ProfileColumn> = {}
  const violations: ProfileValidationViolation[] = []
  for (const column of columns) {
    const contract = contracts[column]
    const observedTypes: Partial<Record<ProfileObservedType, number>> = {}
    let missingCount = 0
    let nullCount = 0
    let nonNullCount = 0
    let invalidCount = 0
    let numericStringCount = 0

    for (const row of rows) {
      const cell = profileCell(row, column)
      if (!cell.present || cell.value === undefined) {
        missingCount += 1
        incrementTypeCount(observedTypes, 'missing')
        continue
      }
      const type = profileObservedType(cell.value)
      incrementTypeCount(observedTypes, type)
      if (cell.value === null) {
        nullCount += 1
        continue
      }
      nonNullCount += 1
      if (contract && isNumericContract(contract.type) && typeof cell.value === 'string' && isFiniteNumericString(cell.value)) {
        numericStringCount += 1
      }
      if (contract && !matchesProfileContract(cell.value, contract)) invalidCount += 1
      if (typeof cell.value === 'string') tallyCategoryValue(categoryTally, column, cell.value)
      if (Array.isArray(cell.value) || isRecord(cell.value)) {
        if (!structureEntries.has(column) && structureEntries.size >= MAX_STRUCTURE_ENTRIES) structureTruncated = true
        else collectStructure(cell.value, column, 0, structureEntries)
      }
    }

    const inferredType = inferProfileType(observedTypes)
    const columnProfile: ProfileColumn = {
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
    }
    schema[column] = columnProfile

    if (contract?.required && missingCount > 0) {
      violations.push({ column, rule: 'required', expected: true, observed: 'missing', invalid_count: missingCount, severity: 'error' })
    }
    if (contract?.nullable === false && nullCount > 0) {
      violations.push({ column, rule: 'nullable', expected: false, observed: 'null', invalid_count: nullCount, severity: 'error' })
    }
    if (invalidCount > 0) {
      violations.push({ column, rule: 'type', expected: contract?.type ?? 'unknown', observed: inferredType, invalid_count: invalidCount, severity: 'error' })
    }

    const values = rows
      .map((row) => profileCell(row, column))
      .filter((cell): cell is { present: true; value: number } => cell.present && typeof cell.value === 'number' && Number.isFinite(cell.value))
      .map((cell) => cell.value)
    if (values.length > 0) {
      const sorted = [...values].sort((a, b) => a - b)
      const total = values.reduce((sum, value) => sum + value, 0)
      statistics[column] = {
        count: values.length,
        sum: Number.isFinite(total) ? total : null,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: total / values.length,
        p25: profileQuantile(sorted, 0.25),
        p50: profileQuantile(sorted, 0.5),
        p75: profileQuantile(sorted, 0.75),
      }
    }

    if (inferredType === 'string') {
      const tally = categoryTally.get(column)
      const distinctCount = tally === undefined || tally.overflowed ? null : tally.counts.size
      const top = [...(tally?.counts ?? new Map<string, number>()).entries()]
        .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
        .slice(0, MAX_CATEGORY_TOP_VALUES)
        .map(([value, count]) => ({ value, count }))
      categories[column] = {
        distinct_count: distinctCount,
        top_values: top,
        truncated: distinctCount === null || distinctCount > top.length,
      }
    }
  }

  for (const [path, accumulator] of structureEntries) structure[path] = finishStructure(accumulator)
  if (structureTruncated) warnings.push(`structure digest truncated at ${MAX_STRUCTURE_ENTRIES} paths`)
  if ([...structureEntries.values()].some((accumulator) => accumulator.sampled)) warnings.push(`structure digest sampled after ${MAX_STRUCTURE_SAMPLED_ELEMENTS} elements; sampled_elements is incomplete`)

  const timeFacts = timeColumn === undefined
    ? undefined
    : buildTimeFacts(rows, timeColumn, timeOrdered, new Set(Object.keys(statistics)))

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
  }
}

/**
 * 挑时间列：显式指定优先；否则按列名候选，并要求该列的非空值全是数字或日期样式
 * 字符串。只按列名取第一个匹配列会把 `report_type`（季度枚举）误当时间轴，
 * 于是首末值与覆盖范围全是错的口径。
 */
function pickTimeColumn(rows: unknown[], columns: string[], requested?: string): string | undefined {
  if (requested !== undefined) return columns.includes(requested) ? requested : requested
  for (const column of columns) {
    if (!/date|time|timestamp|_dt$|report$/i.test(column)) continue
    const values = rows
      .map((row) => profileCell(row, column))
      .filter((cell) => cell.present && cell.value !== null && cell.value !== undefined)
      .map((cell) => cell.value)
    if (values.length === 0) continue
    if (values.every((value) => typeof value === 'number' && Number.isFinite(value))) return column
    if (values.every((value) => typeof value === 'string' && DATE_LIKE_PATTERN.test(value.trim()))) return column
  }
  return undefined
}

const DATE_LIKE_PATTERN = /^\d{4}(-\d{1,2}(-\d{1,2})?)?$/

/**
 * 时间事实：覆盖范围 + 首行/末行的「时间列与数值列」取值（文件顺序）。
 *
 * 只报 min/max 时，模型会把区间极值讲成走势（实测样本里出现过「从 74 涨到 105
 * 以上随后可能回落」这种没有依据的叙述）。首末行给出的是真实首末取值，
 * 区间变化因此可追溯；`ordered_ascending` 说明文件顺序，避免把末行当成最新。
 */
function buildTimeFacts(
  rows: unknown[],
  timeColumn: string,
  orderedAscending: boolean | null,
  numericColumns: Set<string>,
): ProfileTimeFacts {
  const project = (row: unknown): Record<string, unknown> => {
    const projected: Record<string, unknown> = {}
    if (!isRecord(row)) return projected
    for (const column of [timeColumn, ...numericColumns]) {
      if (column in projected) continue
      const cell = profileCell(row, column)
      if (cell.present && cell.value !== undefined) projected[column] = cell.value
    }
    return projected
  }
  const timeValues = rows.map((row) => profileCell(row, timeColumn).value).filter((value) => value !== null && value !== undefined)
  let coveredFrom: unknown = null
  let coveredTo: unknown = null
  for (const value of timeValues) {
    if (coveredFrom === null || compareProfileValues(value, coveredFrom) < 0) coveredFrom = value
    if (coveredTo === null || compareProfileValues(value, coveredTo) > 0) coveredTo = value
  }
  return {
    time_column: timeColumn,
    ordered_ascending: orderedAscending,
    covered_from: coveredFrom,
    covered_to: coveredTo,
    first: project(rows[0]),
    last: project(rows[rows.length - 1]),
  }
}

type StructureAccumulator = {
  type: 'array' | 'object'
  occurrences: number
  totalElements: number
  sampledElements: number
  sampled: boolean
  emptyCount: number
  minLength: number
  maxLength: number
  fields: Map<string, string>
}

type CategoryTally = { counts: Map<string, number>; overflowed: boolean }

function structureAccumulator(entries: Map<string, StructureAccumulator>, path: string, type: 'array' | 'object'): StructureAccumulator | undefined {
  const existing = entries.get(path)
  if (existing !== undefined) return existing
  if (entries.size >= MAX_STRUCTURE_ENTRIES) return undefined
  const created: StructureAccumulator = { type, occurrences: 0, totalElements: 0, emptyCount: 0, minLength: 0, maxLength: 0, sampledElements: 0, sampled: false, fields: new Map() }
  entries.set(path, created)
  return created
}

/**
 * 把单元格里的数组/对象展开成有界路径摘要（深度 ≤3、条目 ≤24）。
 *
 * 路径约定：对象字段用 `.name`，数组元素用 `[]`，例如 QDII 额度的三层嵌套会得到
 * `sub_tab`（数组，共 3 项）→ `sub_tab[].fund_list`（数组，共 40 项）。
 * 未抽样时用 `total_elements` 表示完整数量；超过 50 项时改用 `sampled_elements`，明确只统计了实际检查到的部分，
 * 而不是让模型面对一句「sub_tab 的类型是 object」。
 */
function collectStructure(value: unknown, path: string, depth: number, entries: Map<string, StructureAccumulator>, sampled = false): void {
  if (depth > MAX_STRUCTURE_DEPTH) return
  if (Array.isArray(value)) {
    const accumulator = structureAccumulator(entries, path, 'array')
    if (accumulator === undefined) return
    accumulator.occurrences += 1
    if (sampled || value.length > MAX_STRUCTURE_SAMPLED_ELEMENTS) {
      accumulator.sampled = true
      accumulator.sampledElements += Math.min(value.length, MAX_STRUCTURE_SAMPLED_ELEMENTS)
    } else {
      accumulator.totalElements += value.length
    }
    if (value.length === 0) accumulator.emptyCount += 1
    if (accumulator.occurrences === 1) {
      accumulator.minLength = value.length
      accumulator.maxLength = value.length
    } else {
      accumulator.minLength = Math.min(accumulator.minLength, value.length)
      accumulator.maxLength = Math.max(accumulator.maxLength, value.length)
    }
    const sampledChildren = sampled || value.length > MAX_STRUCTURE_SAMPLED_ELEMENTS
    for (const element of value.slice(0, MAX_STRUCTURE_SAMPLED_ELEMENTS)) {
      if (Array.isArray(element) || isRecord(element)) collectStructure(element, `${path}[]`, depth + 1, entries, sampledChildren)
    }
    return
  }
  if (!isRecord(value)) return
  const accumulator = structureAccumulator(entries, path, 'object')
  if (accumulator === undefined) return
  accumulator.occurrences += 1
  if (sampled) {
    accumulator.sampled = true
    accumulator.sampledElements += 1
  }
  for (const [key, child] of Object.entries(value)) {
    if (accumulator.fields.size < MAX_STRUCTURE_FIELDS) {
      const type = child === null || child === undefined ? 'null' : Array.isArray(child) ? 'array' : isRecord(child) ? 'object' : typeof child
      if (!accumulator.fields.has(key)) accumulator.fields.set(key, type)
    }
    if (Array.isArray(child) || isRecord(child)) collectStructure(child, `${path}.${key}`, depth + 1, entries, sampled)
  }
}

function finishStructure(accumulator: StructureAccumulator): ProfileStructure {
  return {
    type: accumulator.type,
    occurrences: accumulator.occurrences,
    ...(accumulator.sampled ? { sampled_elements: accumulator.sampledElements } : { total_elements: accumulator.totalElements }),
    empty_count: accumulator.emptyCount,
    min_length: accumulator.minLength,
    max_length: accumulator.maxLength,
    fields: [...accumulator.fields.entries()].map(([name, type]) => ({ name, type })),
  }
}

function tallyCategoryValue(tally: Map<string, CategoryTally>, column: string, value: string): void {
  let columnTally = tally.get(column)
  if (columnTally === undefined) {
    columnTally = { counts: new Map<string, number>(), overflowed: false }
    tally.set(column, columnTally)
  }
  const key = value.length > MAX_CATEGORY_VALUE_LENGTH ? `${value.slice(0, MAX_CATEGORY_VALUE_LENGTH)}…` : value
  const existing = columnTally.counts.get(key)
  if (existing !== undefined) {
    columnTally.counts.set(key, existing + 1)
    return
  }
  if (columnTally.counts.size >= MAX_CATEGORY_DISTINCT) {
    columnTally.overflowed = true
    return
  }
  columnTally.counts.set(key, 1)
}

/**
 * 文档型 Dataset 的 profile：没有行，所以不给行列统计，只给结构摘要。
 *
 * `$` 表示文档根，其余路径沿用 structure 的约定（对象字段用 `.name`、数组元素用 `[]`），
 * 例如财务指标会得到 `abilities`（共 5 项）与 `abilities[].indicators`（共 40 项）。
 */
function buildDocumentProfile(value: Record<string, unknown>): ProfilePayload {
  const entries = new Map<string, StructureAccumulator>()
  collectStructure(value, '$', 0, entries)
  const structure: NonNullable<ProfilePayload['structure']> = {}
  for (const [path, accumulator] of entries) structure[path] = finishStructure(accumulator)
  const warnings: string[] = ['dataset is a document (no row array); profile describes structure only']
  if (entries.size >= MAX_STRUCTURE_ENTRIES) warnings.push(`structure digest truncated at ${MAX_STRUCTURE_ENTRIES} paths`)
  if ([...entries.values()].some((accumulator) => accumulator.sampled)) warnings.push(`structure digest sampled after ${MAX_STRUCTURE_SAMPLED_ELEMENTS} elements; sampled_elements is incomplete`)
  return {
    row_count: 0,
    columns: [],
    quality: { missing_values: 0, duplicate_rows: 0, time_ordered: null },
    structure,
    warnings,
  }
}

/**
 * 把文档内容裁到预算内：长数组按档位逐级截断（保留前 N 项），每次尝试都重新
 * 量体积，直到放得下。返回实际采用的档位与被省略的路径，供模型如实披露
 * 「完整共 N 项，本次只给了前 K 项」。
 */
function boundDocument(value: unknown): ProfileDocument {
  const measure = (candidate: unknown): number | undefined => {
    try {
      const text = JSON.stringify(candidate)
      return typeof text === 'string' ? [...text].length : undefined
    } catch {
      return undefined
    }
  }
  const full = measure(value)
  if (full !== undefined && full <= MAX_DOCUMENT_CHARS) return { content: value, truncated: false, omitted: [] }
  for (const keep of DOCUMENT_ARRAY_KEEP_STEPS) {
    const omitted: ProfileDocument['omitted'] = []
    const bounded = shrinkArrays(value, keep, '$', omitted, 0)
    const size = measure(bounded)
    if (size !== undefined && size <= MAX_DOCUMENT_CHARS) return { content: bounded, truncated: omitted.length > 0, omitted }
  }
  return {
    content: null,
    truncated: true,
    omitted: [{ path: '$', kept: 0, omitted: 1 }],
  }
}

function shrinkArrays(value: unknown, keep: number, path: string, omitted: ProfileDocument['omitted'], depth: number): unknown {
  if (depth > DOCUMENT_MAX_DEPTH) return value
  if (Array.isArray(value)) {
    const head = value.slice(0, keep)
    if (value.length > keep && omitted.length < DOCUMENT_MAX_OMISSIONS) {
      omitted.push({ path, kept: keep, omitted: value.length - keep })
    }
    return head.map((element) => shrinkArrays(element, keep, `${path}[]`, omitted, depth + 1))
  }
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    result[key] = Array.isArray(child) || isRecord(child) ? shrinkArrays(child, keep, `${path}.${key}`, omitted, depth + 1) : child
  }
  return result
}

function profileCell(row: unknown, column: string): { present: boolean; value: unknown } {
  if (isRecord(row)) return { present: Object.prototype.hasOwnProperty.call(row, column), value: row[column] }
  return column === 'value' ? { present: true, value: row } : { present: false, value: undefined }
}

function profileObservedType(value: unknown): Exclude<ProfileObservedType, 'missing' | 'mixed'> {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (typeof value === 'string') return 'string'
  if (Array.isArray(value)) return 'array'
  return 'object'
}

function incrementTypeCount(counts: Partial<Record<ProfileObservedType, number>>, type: ProfileObservedType): void {
  counts[type] = (counts[type] ?? 0) + 1
}

function inferProfileType(observedTypes: Partial<Record<ProfileObservedType, number>>): ProfileObservedType {
  const nonNullTypes = Object.keys(observedTypes).filter((type) => !['missing', 'null'].includes(type) && (observedTypes[type as ProfileObservedType] ?? 0) > 0)
  if (nonNullTypes.length === 1) return nonNullTypes[0] as ProfileObservedType
  if (nonNullTypes.length > 1) return 'mixed'
  if ((observedTypes.null ?? 0) > 0) return 'null'
  return 'missing'
}

function isNumericContract(type: ProfileContractType): boolean {
  return type === 'number' || type === 'integer'
}

function isFiniteNumericString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Number(value))
}

function matchesProfileContract(value: unknown, contract: ProfileContract): boolean {
  if (value === null) return true
  switch (contract.type) {
    case 'string': return typeof value === 'string'
    case 'number': return (typeof value === 'number' && Number.isFinite(value)) || (contract.allowNumericString === true && isFiniteNumericString(value))
    case 'integer': return (typeof value === 'number' && Number.isSafeInteger(value)) || (contract.allowNumericString === true && isFiniteNumericString(value) && Number.isSafeInteger(Number(value)))
    case 'boolean': return typeof value === 'boolean'
    case 'object': return isRecord(value)
    case 'array': return Array.isArray(value)
    case 'json': return true
  }
}

function extractRowContracts(schema: object | null): Record<string, ProfileContract> {
  if (!isRecord(schema)) return {}
  let rowSchema: unknown = schema
  const rootProperties = isRecord(schema.properties) ? schema.properties : undefined
  const itemSchema = rootProperties && isRecord(rootProperties.item) ? rootProperties.item : undefined
  if (itemSchema) rowSchema = itemSchema
  if (isRecord(rowSchema) && rowSchema.type === 'array' && rowSchema.items !== undefined) rowSchema = rowSchema.items
  const properties = isRecord(rowSchema) && isRecord(rowSchema.properties) ? rowSchema.properties : undefined
  if (!properties) return {}

  const contracts: Record<string, ProfileContract> = {}
  for (const [column, property] of Object.entries(properties)) {
    const type = profileContractType(property)
    if (!type) continue
    contracts[column] = { type, allowNumericString: type === 'number' || type === 'integer' }
  }
  return contracts
}

function profileContractType(schema: unknown): ProfileContractType | undefined {
  if (!isRecord(schema)) return undefined
  if (typeof schema.type === 'string') {
    if (schema.type === 'string') return 'string'
    if (schema.type === 'number') return 'number'
    if (schema.type === 'integer') return 'integer'
    if (schema.type === 'boolean') return 'boolean'
    if (schema.type === 'object') return 'object'
    if (schema.type === 'array') return 'array'
  }
  if (Array.isArray(schema.oneOf)) {
    for (const option of schema.oneOf) {
      const type = profileContractType(option)
      if (type) return type
    }
  }
  return 'json'
}

function stableProfileValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableProfileValue).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableProfileValue(record[key])}`).join(',')}}`
}

function compareProfileValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  const leftText = String(left)
  const rightText = String(right)
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0
}

function profileQuantile(sorted: number[], probability: number): number {
  if (sorted.length === 1) return sorted[0]
  const position = (sorted.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function validateStoredDatasetManifest(value: unknown, datasetId: string): StoredDatasetManifest | undefined {
  if (!isRecord(value)) return undefined
  if (value.dataset_id !== datasetId || !DATASET_ID_PATTERN.test(datasetId)) return undefined
  if (!(value.task_id === null || typeof value.task_id === 'string')) return undefined
  if (typeof value.session_id !== 'string' || value.session_id.length === 0) return undefined
  if (value.artifact_ref !== canonicalDatasetRef(datasetId)) return undefined
  if (value.format !== 'json' && value.format !== 'json_rows') return undefined
  if (typeof value.capability !== 'string' || value.capability.length === 0) return undefined
  if (typeof value.source_label !== 'string' || value.source_label.length === 0) return undefined
  if (!(value.schema === null || isRecord(value.schema))) return undefined
  if (!(value.row_count === null || validNonNegativeInteger(value.row_count))) return undefined
  if (!Number.isSafeInteger(value.captured_at) || !Number.isSafeInteger(value.retention_until)) return undefined
  if (typeof value.params_digest !== 'string' || value.params_digest.length === 0) return undefined
  if (value.row_key !== undefined && (typeof value.row_key !== 'string' || value.row_key.length === 0 || value.row_key.length > 128)) return undefined
  const ref: DatasetRef = {
    dataset_id: value.dataset_id as string,
    task_id: value.task_id as string | null,
    session_id: value.session_id as string,
    artifact_ref: value.artifact_ref as string,
    format: value.format as 'json' | 'json_rows',
    capability: value.capability as string,
    source_label: value.source_label as string,
    schema: value.schema as object | null,
    row_count: value.row_count as number | null,
    captured_at: value.captured_at as number,
    retention_until: value.retention_until as number,
    params_digest: value.params_digest as string,
  }
  return {
    ...ref,
    // Manifests written before scope support remain readable by their producer only.
    session_scope_id: typeof value.session_scope_id === 'string' && value.session_scope_id.length > 0
      ? value.session_scope_id
      : ref.session_id,
    ...(value.row_key === undefined ? {} : { row_key: value.row_key as string }),
  }
}

function validateColumns(value: unknown, errorCode: 'profile_invalid' = 'profile_invalid', maxColumns = 64): string[] {
  if (!Array.isArray(value) || value.length > maxColumns) throw new DatasetStoreError(errorCode, `columns must contain at most ${maxColumns} names`)
  const columns = value.map((column) => {
    if (typeof column !== 'string' || column.length === 0 || column.length > 128) throw new DatasetStoreError(errorCode, 'column name is invalid')
    return column
  })
  if (new Set(columns).size !== columns.length) throw new DatasetStoreError(errorCode, 'columns must be unique')
  return columns
}

function validateProfile(value: unknown): ProfilePayload {
  if (!isRecord(value)) throw new DatasetStoreError('profile_invalid', 'profile must be an object')
  const allowed = new Set(['row_count', 'columns', 'quality', 'statistics', 'categories', 'time_facts', 'structure', 'schema', 'validation', 'warnings'])
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new DatasetStoreError('profile_invalid', 'profile contains unsupported fields')
  if (!validNonNegativeInteger(value.row_count)) throw new DatasetStoreError('profile_invalid', 'profile.row_count must be a non-negative integer')
  const columns = validateColumns(value.columns, 'profile_invalid', Number.MAX_SAFE_INTEGER)
  if (!isRecord(value.quality)) throw new DatasetStoreError('profile_invalid', 'profile.quality is required')
  const qualityKeys = new Set(['missing_values', 'duplicate_rows', 'time_ordered'])
  if (Object.keys(value.quality).some((key) => !qualityKeys.has(key))) throw new DatasetStoreError('profile_invalid', 'profile.quality contains unsupported fields')
  if (!validNonNegativeInteger(value.quality.missing_values) || !validNonNegativeInteger(value.quality.duplicate_rows)) throw new DatasetStoreError('profile_invalid', 'quality counts must be non-negative integers')
  if (!(value.quality.time_ordered === null || typeof value.quality.time_ordered === 'boolean')) throw new DatasetStoreError('profile_invalid', 'quality.time_ordered must be boolean or null')
  if (!Array.isArray(value.warnings) || value.warnings.length > 32 || value.warnings.some((warning) => typeof warning !== 'string' || warning.length > 512)) throw new DatasetStoreError('profile_invalid', 'warnings must be a bounded string array')

  let statistics: ProfilePayload['statistics']
  if (value.statistics !== undefined) {
    if (!isRecord(value.statistics)) throw new DatasetStoreError('profile_invalid', 'statistics must be an object')
    statistics = {}
    const metricKeys = new Set(['count', 'sum', 'min', 'max', 'mean', 'p25', 'p50', 'p75'])
    for (const [column, metric] of Object.entries(value.statistics)) {
      if (column.length === 0 || column.length > 128 || !isRecord(metric) || Object.keys(metric).some((key) => !metricKeys.has(key))) throw new DatasetStoreError('profile_invalid', 'statistics contains an invalid column or metric')
      if (metric.count !== undefined && !validNonNegativeInteger(metric.count)) throw new DatasetStoreError('profile_invalid', `statistics.${column}.count must be a non-negative integer`)
      for (const [key, item] of Object.entries(metric)) {
        if (key === 'count') continue
        if (!(item === null || (typeof item === 'number' && Number.isFinite(item)))) throw new DatasetStoreError('profile_invalid', `statistics.${column}.${key} must be a finite number or null`)
      }
      statistics[column] = metric as NonNullable<ProfilePayload['statistics']>[string]
    }
  }

  let categories: ProfilePayload['categories']
  if (value.categories !== undefined) {
    if (!isRecord(value.categories)) throw new DatasetStoreError('profile_invalid', 'categories must be an object')
    categories = {}
    for (const [column, item] of Object.entries(value.categories)) {
      if (!columns.includes(column) || !isRecord(item)) throw new DatasetStoreError('profile_invalid', 'categories contains an invalid column')
      if (Object.keys(item).some((key) => !['distinct_count', 'top_values', 'truncated'].includes(key))) throw new DatasetStoreError('profile_invalid', `categories.${column} contains unsupported fields`)
      if (!(item.distinct_count === null || validNonNegativeInteger(item.distinct_count))) throw new DatasetStoreError('profile_invalid', `categories.${column}.distinct_count must be a non-negative integer or null`)
      if (typeof item.truncated !== 'boolean') throw new DatasetStoreError('profile_invalid', `categories.${column}.truncated must be boolean`)
      if (!Array.isArray(item.top_values) || item.top_values.length > MAX_CATEGORY_TOP_VALUES) throw new DatasetStoreError('profile_invalid', `categories.${column}.top_values must be a bounded array`)
      for (const entry of item.top_values) {
        if (!isRecord(entry) || typeof entry.value !== 'string' || entry.value.length > MAX_CATEGORY_VALUE_LENGTH + 1 || !validNonNegativeInteger(entry.count)) {
          throw new DatasetStoreError('profile_invalid', `categories.${column}.top_values contains an invalid entry`)
        }
      }
      categories[column] = {
        distinct_count: item.distinct_count as number | null,
        top_values: item.top_values as ProfileCategoryValue[],
        truncated: item.truncated,
      }
    }
  }

  let timeFacts: ProfilePayload['time_facts']
  if (value.time_facts !== undefined) {
    const item = value.time_facts
    if (!isRecord(item) || typeof item.time_column !== 'string' || !columns.includes(item.time_column)) throw new DatasetStoreError('profile_invalid', 'time_facts.time_column must be a profile column')
    if (Object.keys(item).some((key) => !['time_column', 'ordered_ascending', 'covered_from', 'covered_to', 'first', 'last'].includes(key))) throw new DatasetStoreError('profile_invalid', 'time_facts contains unsupported fields')
    if (!(item.ordered_ascending === null || typeof item.ordered_ascending === 'boolean')) throw new DatasetStoreError('profile_invalid', 'time_facts.ordered_ascending must be boolean or null')
    if (!isRecord(item.first) || !isRecord(item.last)) throw new DatasetStoreError('profile_invalid', 'time_facts.first and time_facts.last must be objects')
    for (const [key, entry] of [...Object.entries(item.first), ...Object.entries(item.last)]) {
      if (!columns.includes(key)) throw new DatasetStoreError('profile_invalid', `time_facts.${key} is not a profile column`)
      if (entry !== null && typeof entry === 'object') throw new DatasetStoreError('profile_invalid', `time_facts.${key} must be a scalar value`)
    }
    timeFacts = {
      time_column: item.time_column,
      ordered_ascending: item.ordered_ascending as boolean | null,
      covered_from: item.covered_from ?? null,
      covered_to: item.covered_to ?? null,
      first: item.first as Record<string, unknown>,
      last: item.last as Record<string, unknown>,
    }
  }

  let structure: ProfilePayload['structure']
  if (value.structure !== undefined) {
    if (!isRecord(value.structure)) throw new DatasetStoreError('profile_invalid', 'structure must be an object')
    structure = {}
    if (Object.keys(value.structure).length > MAX_STRUCTURE_ENTRIES) throw new DatasetStoreError('profile_invalid', `structure must contain at most ${MAX_STRUCTURE_ENTRIES} paths`)
    for (const [path, item] of Object.entries(value.structure)) {
      if (path.length === 0 || path.length > 256 || !isRecord(item)) throw new DatasetStoreError('profile_invalid', 'structure contains an invalid path')
      if (Object.keys(item).some((key) => !['type', 'occurrences', 'total_elements', 'sampled_elements', 'empty_count', 'min_length', 'max_length', 'fields'].includes(key))) throw new DatasetStoreError('profile_invalid', `structure.${path} contains unsupported fields`)
      if (item.type !== 'array' && item.type !== 'object') throw new DatasetStoreError('profile_invalid', `structure.${path}.type is invalid`)
      const hasTotal = item.total_elements !== undefined
      const hasSampled = item.sampled_elements !== undefined
      if (hasTotal === hasSampled) throw new DatasetStoreError("profile_invalid", "structure path must contain exactly one of total_elements or sampled_elements")
      for (const key of ['occurrences', 'empty_count', 'min_length', 'max_length', ...(hasTotal ? ['total_elements'] : ['sampled_elements'])]) {
        if (!validNonNegativeInteger(item[key])) throw new DatasetStoreError("profile_invalid", "structure field must be a non-negative integer")
      }
      if (!Array.isArray(item.fields) || item.fields.length > MAX_STRUCTURE_FIELDS) throw new DatasetStoreError('profile_invalid', `structure.${path}.fields must be a bounded array`)
      for (const field of item.fields) {
        if (!isRecord(field) || typeof field.name !== 'string' || field.name.length === 0 || field.name.length > 128 || typeof field.type !== 'string' || field.type.length === 0 || field.type.length > 32) {
          throw new DatasetStoreError('profile_invalid', `structure.${path}.fields contains an invalid entry`)
        }
      }
      structure[path] = item as unknown as ProfileStructure
    }
  }
  let schema: ProfilePayload['schema']
  if (value.schema !== undefined) {
    if (!isRecord(value.schema)) throw new DatasetStoreError('profile_invalid', 'schema must be an object')
    schema = {}
    const observedTypes = new Set<ProfileObservedType>(['missing', 'null', 'boolean', 'integer', 'number', 'string', 'object', 'array', 'mixed'])
    const contractTypes = new Set<ProfileContractType>(['string', 'number', 'integer', 'boolean', 'object', 'array', 'json'])
    for (const [column, item] of Object.entries(value.schema)) {
      if (column.length === 0 || column.length > 128 || !isRecord(item)) throw new DatasetStoreError('profile_invalid', 'schema contains an invalid column')
      const itemKeys = new Set(['contract_type', 'inferred_type', 'observed_types', 'missing_count', 'null_count', 'non_null_count', 'invalid_count', 'nullable', 'contract_nullable', 'required', 'allow_numeric_string', 'numeric_string_count'])
      if (Object.keys(item).some((key) => !itemKeys.has(key))) throw new DatasetStoreError('profile_invalid', `schema.${column} contains unsupported fields`)
      if (!(item.contract_type === null || (typeof item.contract_type === 'string' && contractTypes.has(item.contract_type as ProfileContractType)))) throw new DatasetStoreError('profile_invalid', `schema.${column}.contract_type is invalid`)
      if (typeof item.inferred_type !== 'string' || !observedTypes.has(item.inferred_type as ProfileObservedType)) throw new DatasetStoreError('profile_invalid', `schema.${column}.inferred_type is invalid`)
      const observedTypeCounts = item.observed_types
      if (!isRecord(observedTypeCounts) || Object.keys(observedTypeCounts).some((key) => !observedTypes.has(key as ProfileObservedType) || !validNonNegativeInteger(observedTypeCounts[key]))) throw new DatasetStoreError('profile_invalid', `schema.${column}.observed_types is invalid`)
      const observedTotal = Object.values(observedTypeCounts).reduce((sum: number, count) => sum + (count as number), 0)
      if (observedTotal !== value.row_count) throw new DatasetStoreError('profile_invalid', `schema.${column}.observed_types count does not equal row_count`)
      for (const key of ['missing_count', 'null_count', 'non_null_count', 'invalid_count']) if (!validNonNegativeInteger(item[key])) throw new DatasetStoreError('profile_invalid', `schema.${column}.${key} must be a non-negative integer`)
      const rowCount = value.row_count as number
      const missingCount = item.missing_count as number
      const nullCount = item.null_count as number
      const nonNullCount = item.non_null_count as number
      const invalidCount = item.invalid_count as number
      if (missingCount + nullCount + nonNullCount !== rowCount) throw new DatasetStoreError('profile_invalid', `schema.${column} value counts do not equal row_count`)
      if (invalidCount > nonNullCount) throw new DatasetStoreError('profile_invalid', `schema.${column}.invalid_count exceeds non_null_count`)
      if (typeof item.nullable !== 'boolean') throw new DatasetStoreError('profile_invalid', `schema.${column}.nullable must be boolean`)
      if (item.nullable !== (nullCount > 0)) throw new DatasetStoreError('profile_invalid', `schema.${column}.nullable does not match null_count`)
      if (item.contract_nullable !== undefined && typeof item.contract_nullable !== 'boolean') throw new DatasetStoreError('profile_invalid', `schema.${column}.contract_nullable must be boolean`)
      if (item.required !== undefined && typeof item.required !== 'boolean') throw new DatasetStoreError('profile_invalid', `schema.${column}.required must be boolean`)
      if (item.allow_numeric_string !== undefined && typeof item.allow_numeric_string !== 'boolean') throw new DatasetStoreError('profile_invalid', `schema.${column}.allow_numeric_string must be boolean`)
      if (item.numeric_string_count !== undefined && !validNonNegativeInteger(item.numeric_string_count)) throw new DatasetStoreError('profile_invalid', `schema.${column}.numeric_string_count must be a non-negative integer`)
      if (item.numeric_string_count !== undefined && (item.numeric_string_count as number) > nonNullCount) throw new DatasetStoreError('profile_invalid', `schema.${column}.numeric_string_count exceeds non_null_count`)
      schema[column] = item as unknown as ProfileColumn
    }
    if (Object.keys(schema).some((column) => !columns.includes(column))) throw new DatasetStoreError('profile_invalid', 'schema columns must be listed in profile.columns')
  }

  let validation: ProfilePayload['validation']
  if (value.validation !== undefined) {
    if (!isRecord(value.validation) || (value.validation.status !== 'pass' && value.validation.status !== 'fail') || !Array.isArray(value.validation.violations) || value.validation.violations.length > 64) {
      throw new DatasetStoreError('profile_invalid', 'validation must contain a status and bounded violations')
    }
    const violations: ProfileValidationViolation[] = []
    for (const item of value.validation.violations) {
      if (!isRecord(item) || typeof item.column !== 'string' || item.column.length === 0 || !['required', 'nullable', 'type'].includes(String(item.rule)) || !(typeof item.expected === 'string' || typeof item.expected === 'boolean') || typeof item.observed !== 'string' || !validNonNegativeInteger(item.invalid_count) || !['error', 'warning'].includes(String(item.severity))) {
        throw new DatasetStoreError('profile_invalid', 'validation contains an invalid violation')
      }
      violations.push({
        column: item.column,
        rule: item.rule as ProfileValidationViolation['rule'],
        expected: item.expected as string | boolean,
        observed: item.observed,
        invalid_count: item.invalid_count,
        severity: item.severity as ProfileValidationViolation['severity'],
      })
    }
    if ((value.validation.status === 'pass' && violations.length > 0) || (value.validation.status === 'fail' && violations.length === 0)) {
      throw new DatasetStoreError('profile_invalid', 'validation status does not match violations')
    }
    validation = { status: value.validation.status as 'pass' | 'fail', violations }
  }

  return { row_count: value.row_count, columns, quality: { missing_values: value.quality.missing_values, duplicate_rows: value.quality.duplicate_rows, time_ordered: value.quality.time_ordered }, ...(statistics ? { statistics } : {}), ...(categories ? { categories } : {}), ...(timeFacts ? { time_facts: timeFacts } : {}), ...(structure ? { structure } : {}), ...(schema ? { schema } : {}), ...(validation ? { validation } : {}), warnings: value.warnings }
}

export function provideWorkspaceDatasetStore(ctx: import('@deepseek-ai/cordis').Context, options?: WorkspaceDatasetStoreOptions): WorkspaceDatasetStore {
  const store = new WorkspaceDatasetStore(options)
  ctx.provide('datasetStore', store)
  return store
}

declare module '@deepseek-ai/cordis' { interface Context { datasetStore: WorkspaceDatasetStore } }
