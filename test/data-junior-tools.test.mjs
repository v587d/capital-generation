import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerDatasetTools } from '../lib/data-collector/dataset-tools.js'
import { DatasetStoreError, WorkspaceDatasetStore } from '../lib/data-collector/store.js'

const SESSION = { id: 'session-1', header: { cwd: '/workspace/proj' } }
const OTHER_SESSION = { id: 'session-2', header: { cwd: '/workspace/proj' } }
const COLLECTOR_CHILD = { id: 'collector-1', header: { cwd: '/workspace/proj', parentSession: 'main-1' } }
const JUNIOR_CHILD = { id: 'junior-1', header: { cwd: '/workspace/proj', parentSession: 'main-1' } }
const INDEPENDENT_SESSION = { id: 'main-2', header: { cwd: '/workspace/proj' } }

function fakeFs() {
  const files = new Map()
  const dirs = new Set()
  const ops = []
  const norm = (path) => {
    const parts = []
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue
      if (part === '..') parts.pop()
      else parts.push(part)
    }
    return '/' + parts.join('/')
  }
  return {
    files,
    dirs,
    ops,
    async resolve(path, opts = {}) {
      const cwd = opts.cwd ?? '/'
      return { targetKey: `key:${norm(path.startsWith('/') ? path : `${cwd}/${path}`)}`, displayPath: norm(path.startsWith('/') ? path : `${cwd}/${path}`) }
    },
    contains(parent, child) {
      return child.displayPath === parent.displayPath || child.displayPath.startsWith(`${parent.displayPath}/`)
    },
    async stat(target) {
      if (this.files.has(target.displayPath)) return { type: 'file', size: new TextEncoder().encode(this.files.get(target.displayPath)).byteLength }
      if (this.dirs.has(target.displayPath)) return { type: 'directory' }
      return undefined
    },
    async writeText(target, content, expected, signal, policy) {
      this.ops.push({ path: target.displayPath, expected: expected?.kind, policy: policy?.mode })
      if (expected?.kind === 'createIfAbsent' && this.files.has(target.displayPath)) {
        const error = new Error('already exists')
        error.code = 'FS_NOT_OBSERVED'
        throw error
      }
      const segments = target.displayPath.split('/').filter(Boolean)
      for (let i = 1; i < segments.length; i += 1) this.dirs.add('/' + segments.slice(0, i).join('/'))
      this.files.set(target.displayPath, content)
    },
    async readText(target) {
      if (!this.files.has(target.displayPath)) {
        const error = new Error('missing')
        error.code = 'FS_NOT_FOUND'
        throw error
      }
      return this.files.get(target.displayPath)
    },
  }
}

function policyLike(mode = 'workspace-write') {
  return { resolve: ({ session }) => ({ mode, workspaceRoot: session?.header?.cwd, sessionId: session?.id }) }
}

function makeStore(options = {}) {
  const fs = options.fs ?? fakeFs()
  const store = new WorkspaceDatasetStore({
    fs,
    sandboxPolicy: options.sandboxPolicy ?? policyLike(options.mode),
    now: options.now ?? (() => 1_700_000_000_000),
    newId: options.newId ?? (() => 'ds_001'),
  })
  return { store, fs }
}

function saveInput(overrides = {}) {
  return {
    session: SESSION,
    capability: 'history',
    params_digest: 'digest-1',
    source_label: 'fuyao',
    format: 'json_rows',
    schema: { type: 'array' },
    row_count: 3,
    data: { timestamp: 1, item: [
      { date_ms: 1, close_price: 100, volume: 10 },
      { date_ms: 2, close_price: 102, volume: 11 },
      { date_ms: 3, close_price: 101, volume: 12 },
    ] },
    ...overrides,
  }
}

test('Dataset Phase 2：inspect、slice、profile 走受控 store 流程', async () => {
  let next = 0
  const { store, fs } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput())

  const inspection = await store.inspectDataset(ref.dataset_id, SESSION)
  assert.equal(inspection.dataset_id, ref.dataset_id)
  assert.equal(inspection.row_access.readable, true)
  assert.equal(inspection.row_access.shape, 'envelope_item')
  assert.ok(!('rows' in inspection))

  const slice = await store.readDatasetSlice(ref.dataset_id, SESSION, { offset: 1, limit: 2, columns: ['date_ms', 'close_price'] })
  assert.deepEqual(slice.rows, [
    { date_ms: 2, close_price: 102 },
    { date_ms: 3, close_price: 101 },
  ])
  assert.equal(slice.total_count, 3)
  assert.equal(slice.has_more, false)

  const profile = await store.writeProfile({
    session: SESSION,
    dataset_id: ref.dataset_id,
    task_id: 'task-1',
    profile: {
      row_count: 3,
      columns: ['date_ms', 'close_price'],
      quality: { missing_values: 0, duplicate_rows: 0, time_ordered: true },
      statistics: { close_price: { min: 100, max: 102, mean: 101, p50: 101 } },
      warnings: [],
    },
  })
  assert.equal(profile.dataset_id, ref.dataset_id)
  assert.equal(profile.artifact_ref, `workspace://capital-data/profiles/${profile.profile_id}`)
  assert.ok(fs.files.has(`/workspace/proj/capital-data/profiles/${profile.profile_id}/profile.json`))
  assert.equal(fs.ops.at(-1).expected, 'createIfAbsent')
})

test('profile_dataset：宿主完成全量基础统计并只返回 profile 摘要', async () => {
  let next = 0
  const { store, fs } = makeStore({ newId: (prefix) => `${prefix}_${++next}` })
  const ref = await store.save(saveInput({ session: COLLECTOR_CHILD }))
  const result = await store.profileDataset({ session: JUNIOR_CHILD, dataset_id: ref.dataset_id, task_id: 'task-profile', time_column: 'date_ms' })
  assert.equal(result.dataset_id, ref.dataset_id)
  assert.equal(result.row_count, 3)
  assert.deepEqual(result.statistics.close_price, { min: 100, max: 102, mean: 101, p25: 100.5, p50: 101, p75: 101.5 })
  assert.equal(result.quality.missing_values, 0)
  assert.equal(result.quality.duplicate_rows, 0)
  assert.equal(result.quality.time_ordered, true)
  assert.ok(!('rows' in result))
  const profilePath = `/workspace/proj/capital-data/profiles/${result.profile_id}/profile.json`
  assert.ok(fs.files.has(profilePath))
  const storedProfile = JSON.parse(fs.files.get(profilePath))
  assert.ok(!('rows' in storedProfile.profile))
  assert.deepEqual(storedProfile.profile.statistics.close_price, result.statistics.close_price)
})

test('Dataset session scope：collector 与 junior 兄弟子 Agent 可共享，独立主 session 不可读取', async () => {
  const { store } = makeStore()
  const ref = await store.save(saveInput({ session: COLLECTOR_CHILD }))
  const inspection = await store.inspectDataset(ref.dataset_id, JUNIOR_CHILD)
  assert.equal(inspection.dataset_id, ref.dataset_id)
  await assert.rejects(() => store.inspectDataset(ref.dataset_id, INDEPENDENT_SESSION), /dataset_session_mismatch/)
})


test('Dataset Phase 2：拒绝其他 session、绝对路径和越界切片', async () => {
  const { store } = makeStore()
  const ref = await store.save(saveInput())
  await assert.rejects(() => store.inspectDataset(ref.dataset_id, OTHER_SESSION), (error) => {
    assert.ok(error instanceof DatasetStoreError)
    assert.equal(error.code, 'dataset_session_mismatch')
    return true
  })
  await assert.rejects(() => store.readDatasetSlice(ref.dataset_id, SESSION, { offset: 99 }), /dataset_slice_out_of_range/)
  await assert.rejects(() => store.inspectDataset('../../etc/passwd', SESSION), /dataset_id_invalid/)
})

test('Dataset Phase 2：profile 不可包含 raw rows，且只读 workspace 不能写入', async () => {
  const { store } = makeStore({ mode: 'read-only' })
  await assert.rejects(() => store.writeProfile({
    session: SESSION,
    dataset_id: 'ds_001',
    profile: { row_count: 0, columns: [], quality: { missing_values: 0, duplicate_rows: 0, time_ordered: null }, warnings: [], rows: [] },
  }), /dataset_not_found|workspace_not_writable/)

  const writable = makeStore().store
  const ref = await writable.save(saveInput())
  await assert.rejects(() => writable.writeProfile({
    session: SESSION,
    dataset_id: ref.dataset_id,
    profile: { row_count: 3, columns: [], quality: { missing_values: 0, duplicate_rows: 0, time_ordered: true }, warnings: [], rows: [{ secret: true }] },
  }), /profile contains unsupported fields/)
})

test('Dataset Phase 2：inspect、slice、profile 与受控统计工具真实注册，schema 不接受路径', () => {
  const definitions = []
  const ctx = {
    get: (name) => name === 'tools' ? { register: (definition) => { definitions.push(definition); return () => {} } } : undefined,
    effect: (fn) => fn(),
  }
  registerDatasetTools(ctx, makeStore().store)
  assert.deepEqual(definitions.map((definition) => definition.name), ['inspect_dataset', 'read_dataset_slice', 'profile_dataset', 'write_profile'])
  const inspect = definitions[0]
  assert.equal(inspect.parameters.additionalProperties, false)
  assert.ok(!('path' in inspect.parameters.properties))
  assert.equal(definitions[1].parameters.properties.limit.maximum, 200)
})
