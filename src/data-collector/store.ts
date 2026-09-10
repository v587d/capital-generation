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
export const MAX_SLICE_ROWS = 200
export const DEFAULT_SLICE_ROWS = 100
export const MAX_SLICE_OUTPUT_BYTES = 256 * 1024
export const MAX_PROFILE_BYTES = 64 * 1024

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
}

export type DatasetShape = 'array' | 'envelope_item' | 'none'

export interface DatasetInspection extends DatasetRef {
  row_access: {
    readable: boolean
    shape: DatasetShape
    max_slice_rows: number
    reason?: string
  }
}

export interface DatasetSlice {
  dataset_id: string
  offset: number
  limit: number
  returned_count: number
  total_count: number
  has_more: boolean
  rows: unknown[]
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

export interface ProfilePayload {
  row_count: number
  columns: string[]
  quality: {
    missing_values: number
    duplicate_rows: number
    time_ordered: boolean | null
  }
  statistics?: Record<string, {
    min?: number | null
    max?: number | null
    mean?: number | null
    p25?: number | null
    p50?: number | null
    p75?: number | null
  }>
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
  | 'dataset_column_not_found'
  | 'dataset_too_large_for_slice'
  | 'dataset_slice_out_of_range'
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

export interface ProfileDatasetResult extends ProfileRef {
  row_count: number
  columns: string[]
  quality: ProfilePayload['quality']
  statistics?: ProfilePayload['statistics']
  warnings: string[]
}

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
    const ref = await this.requireRef(datasetId, session, signal)
    if (ref.format !== 'json_rows') {
      return { ...ref, row_access: { readable: false, shape: 'none', max_slice_rows: MAX_SLICE_ROWS, reason: 'dataset_format_unsupported' } }
    }
    try {
      const raw = await this.readRaw(ref, session, signal)
      return { ...ref, row_access: { readable: true, shape: raw.shape, max_slice_rows: MAX_SLICE_ROWS } }
    } catch (error) {
      if (error instanceof DatasetStoreError && ['dataset_too_large_for_slice', 'dataset_not_row_readable'].includes(error.code)) {
        return { ...ref, row_access: { readable: false, shape: 'none', max_slice_rows: MAX_SLICE_ROWS, reason: error.code } }
      }
      throw error
    }
  }

  async readDatasetSlice(datasetId: string, session: SessionLike, input: { offset?: number; limit?: number; columns?: string[] } = {}, signal?: AbortSignal): Promise<DatasetSlice> {
    const ref = await this.requireRef(datasetId, session, signal)
    if (ref.format !== 'json_rows') throw new DatasetStoreError('dataset_format_unsupported', `Dataset format ${ref.format} cannot be sliced`)
    const offset = input.offset ?? 0
    const limit = input.limit ?? DEFAULT_SLICE_ROWS
    if (!validNonNegativeInteger(offset)) throw new DatasetStoreError('dataset_slice_out_of_range', 'offset must be a non-negative integer')
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SLICE_ROWS) throw new DatasetStoreError('dataset_slice_out_of_range', `limit must be between 1 and ${MAX_SLICE_ROWS}`)
    const raw = await this.readRaw(ref, session, signal)
    if (offset > raw.rows.length) throw new DatasetStoreError('dataset_slice_out_of_range', `offset ${offset} exceeds total row count ${raw.rows.length}`)

    let rows = raw.rows.slice(offset, offset + limit)
    if (input.columns !== undefined) {
      const columns = validateColumns(input.columns)
      const available = new Set<string>()
      for (const row of raw.rows) if (isRecord(row)) for (const key of Object.keys(row)) available.add(key)
      for (const column of columns) if (!available.has(column)) throw new DatasetStoreError('dataset_column_not_found', `column ${column} is not present in Dataset`)
      rows = rows.map((row) => {
        if (!isRecord(row)) throw new DatasetStoreError('dataset_column_not_found', 'columns projection requires object rows')
        const projected: Record<string, unknown> = {}
        for (const column of columns) if (column in row) projected[column] = row[column]
        return projected
      })
    }

    const encoded = JSON.stringify(rows)
    if (byteLength(encoded) > MAX_SLICE_OUTPUT_BYTES) throw new DatasetStoreError('dataset_too_large_for_slice', `slice output exceeds ${MAX_SLICE_OUTPUT_BYTES} bytes`)
    return {
      dataset_id: datasetId,
      offset,
      limit,
      returned_count: rows.length,
      total_count: raw.rows.length,
      has_more: offset + rows.length < raw.rows.length,
      rows,
    }
  }

  async profileDataset(input: ProfileDatasetInput): Promise<ProfileDatasetResult> {
    const ref = await this.requireRef(input.dataset_id, input.session, input.signal)
    if (ref.format !== 'json_rows') throw new DatasetStoreError('dataset_format_unsupported', `Dataset format ${ref.format} cannot be profiled`)
    const raw = await this.readRaw(ref, input.session, input.signal)
    const profile = buildProfile(raw.rows, input.time_column, input.primary_key)
    const profileRef = await this.writeProfile({
      session: input.session,
      dataset_id: ref.dataset_id,
      task_id: input.task_id,
      profile,
      signal: input.signal,
    })
    return { ...profileRef, ...profile }
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
    const { session_scope_id: _scope, ...ref } = stored
    return ref
  }

  private async readRaw(ref: DatasetRef, session: SessionLike, signal?: AbortSignal): Promise<{ rows: unknown[]; shape: DatasetShape }> {
    const root = this.readRoot(session)
    if (!root || !this.fs) throw new DatasetStoreError('filesystem_unavailable', 'workspace filesystem is unavailable')
    const target = await this.resolveContained(`${DATASETS_SUBDIR}/${ref.dataset_id}/${RAW_FILE}`, root, signal)
    const info = this.fs.stat ? await this.fs.stat(target, signal) : undefined
    if (info && info.type !== 'file') throw new DatasetStoreError('dataset_not_row_readable', 'raw Dataset object is not a regular file')
    if (typeof info?.size === 'number' && info.size > MAX_RAW_READ_BYTES) throw new DatasetStoreError('dataset_too_large_for_slice', `raw Dataset exceeds ${MAX_RAW_READ_BYTES} bytes`)
    let text: string
    try {
      text = await this.fs.readText(target, signal)
    } catch {
      throw new DatasetStoreError('dataset_not_row_readable', 'raw Dataset could not be read')
    }
    if (byteLength(text) > MAX_RAW_READ_BYTES) throw new DatasetStoreError('dataset_too_large_for_slice', `raw Dataset exceeds ${MAX_RAW_READ_BYTES} bytes`)
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new DatasetStoreError('dataset_not_row_readable', 'raw Dataset is not valid JSON')
    }
    if (Array.isArray(value)) return { rows: value, shape: 'array' }
    if (isRecord(value) && Array.isArray(value.item)) return { rows: value.item, shape: 'envelope_item' }
    throw new DatasetStoreError('dataset_not_row_readable', 'raw Dataset does not contain a supported row array')
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

function sessionScopeFor(session: SessionLike): string {
  const parentSession = session.header?.parentSession
  return typeof parentSession === 'string' && parentSession.length > 0 ? parentSession : session.id
}

function buildProfile(rows: unknown[], requestedTimeColumn?: string, primaryKey?: string): ProfilePayload {
  const objectRows = rows.filter(isRecord)
  const columns = objectRows.length > 0
    ? [...new Set(objectRows.flatMap((row) => Object.keys(row)))].slice(0, 64)
    : rows.length > 0 ? ['value'] : []
  const warnings: string[] = []
  if (objectRows.length !== rows.length) warnings.push('some rows are not objects; object-column checks are partial')

  let missingValues = 0
  for (const row of rows) {
    if (!isRecord(row)) {
      if (columns.includes('value') && row === null) missingValues += 1
      continue
    }
    for (const column of columns) if (!(column in row) || row[column] === null || row[column] === undefined) missingValues += 1
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

  const timeColumn = requestedTimeColumn ?? columns.find((column) => /date|time|timestamp/i.test(column))
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
  for (const column of columns) {
    const values = rows
      .map((row) => isRecord(row) ? row[column] : column === 'value' ? row : undefined)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    if (values.length === 0) continue
    const sorted = [...values].sort((a, b) => a - b)
    statistics[column] = {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      p25: profileQuantile(sorted, 0.25),
      p50: profileQuantile(sorted, 0.5),
      p75: profileQuantile(sorted, 0.75),
    }
  }

  return {
    row_count: rows.length,
    columns,
    quality: { missing_values: missingValues, duplicate_rows: duplicateRows, time_ordered: timeOrdered },
    ...(Object.keys(statistics).length > 0 ? { statistics } : {}),
    warnings,
  }
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
  }
}

function validateColumns(value: unknown, errorCode: 'dataset_column_not_found' | 'profile_invalid' = 'dataset_column_not_found'): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new DatasetStoreError(errorCode, 'columns must contain at most 64 names')
  const columns = value.map((column) => {
    if (typeof column !== 'string' || column.length === 0 || column.length > 128) throw new DatasetStoreError(errorCode, 'column name is invalid')
    return column
  })
  if (new Set(columns).size !== columns.length) throw new DatasetStoreError(errorCode, 'columns must be unique')
  return columns
}

function validateProfile(value: unknown): ProfilePayload {
  if (!isRecord(value)) throw new DatasetStoreError('profile_invalid', 'profile must be an object')
  const allowed = new Set(['row_count', 'columns', 'quality', 'statistics', 'warnings'])
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new DatasetStoreError('profile_invalid', 'profile contains unsupported fields')
  if (!validNonNegativeInteger(value.row_count)) throw new DatasetStoreError('profile_invalid', 'profile.row_count must be a non-negative integer')
  const columns = validateColumns(value.columns, 'profile_invalid')
  if (!isRecord(value.quality)) throw new DatasetStoreError('profile_invalid', 'profile.quality is required')
  const qualityKeys = new Set(['missing_values', 'duplicate_rows', 'time_ordered'])
  if (Object.keys(value.quality).some((key) => !qualityKeys.has(key))) throw new DatasetStoreError('profile_invalid', 'profile.quality contains unsupported fields')
  if (!validNonNegativeInteger(value.quality.missing_values) || !validNonNegativeInteger(value.quality.duplicate_rows)) throw new DatasetStoreError('profile_invalid', 'quality counts must be non-negative integers')
  if (!(value.quality.time_ordered === null || typeof value.quality.time_ordered === 'boolean')) throw new DatasetStoreError('profile_invalid', 'quality.time_ordered must be boolean or null')
  if (!Array.isArray(value.warnings) || value.warnings.length > 32 || value.warnings.some((warning) => typeof warning !== 'string' || warning.length > 512)) throw new DatasetStoreError('profile_invalid', 'warnings must be a bounded string array')

  let statistics: ProfilePayload['statistics']
  if (value.statistics !== undefined) {
    if (!isRecord(value.statistics) || Object.keys(value.statistics).length > 64) throw new DatasetStoreError('profile_invalid', 'statistics must contain at most 64 columns')
    statistics = {}
    const metricKeys = new Set(['min', 'max', 'mean', 'p25', 'p50', 'p75'])
    for (const [column, metric] of Object.entries(value.statistics)) {
      if (column.length === 0 || column.length > 128 || !isRecord(metric) || Object.keys(metric).some((key) => !metricKeys.has(key))) throw new DatasetStoreError('profile_invalid', 'statistics contains an invalid column or metric')
      for (const [key, item] of Object.entries(metric)) if (!(item === null || (typeof item === 'number' && Number.isFinite(item)))) throw new DatasetStoreError('profile_invalid', `statistics.${column}.${key} must be a finite number or null`)
      statistics[column] = metric as NonNullable<ProfilePayload['statistics']>[string]
    }
  }
  return { row_count: value.row_count, columns, quality: { missing_values: value.quality.missing_values, duplicate_rows: value.quality.duplicate_rows, time_ordered: value.quality.time_ordered }, ...(statistics ? { statistics } : {}), warnings: value.warnings }
}

export function provideWorkspaceDatasetStore(ctx: import('@deepseek-ai/cordis').Context, options?: WorkspaceDatasetStoreOptions): WorkspaceDatasetStore {
  const store = new WorkspaceDatasetStore(options)
  ctx.provide('datasetStore', store)
  return store
}

declare module '@deepseek-ai/cordis' { interface Context { datasetStore: WorkspaceDatasetStore } }
