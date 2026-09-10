import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WorkspaceDatasetStore, DEFAULT_RETENTION_MS } from '../lib/data-collector/store.js'

const SESSION = { id: 'session-1', header: { cwd: '/workspace/proj' } }

/** 极简 in-memory fake ctx.fs：只实现 store 用到的最小子集，行为对齐官方契约。 */
function fakeFs() {
  const files = new Map() // displayPath -> content
  const dirs = new Set()
  const ops = []
  const api = {
    files,
    dirs,
    ops,
    failNextWrite: undefined,
    containsResult: true,
  }
  const norm = (path) => {
    const parts = []
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') parts.pop()
      else parts.push(part)
    }
    return '/' + parts.join('/')
  }
  return {
    ...api,
    async resolve(path, opts = {}) {
      const cwd = opts.cwd ?? '/'
      const absolute = path.startsWith('/') ? path : `${cwd.replace(/\/$/, '')}/${path}`
      const normalized = norm(absolute)
      return { targetKey: `key:${normalized}`, displayPath: normalized }
    },
    contains(parent, child) {
      if (!this.containsResult) return false
      return child.displayPath === parent.displayPath || child.displayPath.startsWith(`${parent.displayPath}/`)
    },
    async writeText(target, content, expected, signal, policy) {
      this.ops.push({ op: 'write', path: target.displayPath, expected: expected?.kind, policyMode: policy?.mode })
      if (this.failNextWrite) {
        const code = this.failNextWrite
        this.failNextWrite = undefined
        const error = new Error(`fake ${code}`)
        error.code = code
        throw error
      }
      if (expected?.kind === 'createIfAbsent' && this.files.has(target.displayPath)) {
        const error = new Error('already exists')
        error.code = 'FS_NOT_OBSERVED'
        throw error
      }
      // 模拟 fs-local 写入时自动创建父目录
      const segments = target.displayPath.split('/').filter(Boolean)
      for (let i = 1; i < segments.length; i += 1) this.dirs.add('/' + segments.slice(0, i).join('/'))
      this.files.set(target.displayPath, content)
      return { operation: 'create', version: 'v1', before: null, after: content }
    },
    async readText(target) {
      if (!this.files.has(target.displayPath)) {
        const error = new Error('missing')
        error.code = 'FS_NOT_FOUND'
        throw error
      }
      return this.files.get(target.displayPath)
    },
    async listDir(target) {
      if (!this.dirs.has(target.displayPath)) {
        const error = new Error('missing dir')
        error.code = 'FS_NOT_FOUND'
        throw error
      }
      const prefix = `${target.displayPath}/`
      const names = new Set()
      for (const key of this.files.keys()) if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0])
      for (const dir of this.dirs) if (dir.startsWith(prefix) && dir !== target.displayPath) names.add(dir.slice(prefix.length).split('/')[0])
      return [...names].map((name) => ({
        name,
        type: this.dirs.has(prefix + name) ? 'directory' : 'file',
        target: { targetKey: `key:${prefix}${name}`, displayPath: prefix + name },
      }))
    },
  }
}

function policyLike(mode = 'workspace-write', root = '/workspace/proj') {
  return { resolve: ({ session }) => ({ mode, workspaceRoot: root, sessionId: session?.id }) }
}

function makeStore(options = {}) {
  const fs = options.fs ?? fakeFs()
  const store = new WorkspaceDatasetStore({
    fs,
    sandboxPolicy: options.sandboxPolicy ?? policyLike(options.mode, options.root),
    now: options.now ?? (() => 1_700_000_000_000),
    newId: options.newId,
    retentionMs: options.retentionMs,
  })
  return { store, fs }
}

let idCounter = 0
const deterministicId = () => (prefix) => `${prefix}_${String(++idCounter).padStart(3, '0')}`

function saveInput(overrides = {}) {
  return {
    session: SESSION,
    capability: 'history',
    params_digest: 'history:{}',
    source_label: 'fuyao',
    format: 'json_rows',
    schema: { columns: ['date_ms', 'close_price'] },
    row_count: 2,
    data: { timestamp: 1, total: 2, item: [{ date_ms: 1, close_price: 100 }] },
    ...overrides,
  }
}

const manifestPath = (root, id) => `${root}/capital-data/datasets/${id}/manifest.json`
const rawPath = (root, id) => `${root}/capital-data/datasets/${id}/raw.json`

test('save：raw.json 与 manifest.json 原子 createIfAbsent 写入 workspace，raw 先于 manifest', async () => {
  const { store, fs } = makeStore({ newId: deterministicId() })
  const ref = await store.save(saveInput())
  const id = ref.dataset_id
  assert.equal(id, 'ds_001')
  assert.equal(fs.files.has(rawPath('/workspace/proj', id)), true)
  assert.equal(fs.files.has(manifestPath('/workspace/proj', id)), true)
  assert.equal(fs.files.get(rawPath('/workspace/proj', id)), JSON.stringify(saveInput().data), 'raw.json 保存原始结果原文')
  assert.equal(fs.ops[0].path.endsWith('/raw.json'), true, 'raw.json 必须先写')
  assert.equal(fs.ops[1].path.endsWith('/manifest.json'), true)
  for (const op of fs.ops) {
    assert.equal(op.expected, 'createIfAbsent', '不可变 Dataset 必须 createIfAbsent')
    assert.equal(op.policyMode, 'workspace-write', '写入必须携带 per-call sandbox policy')
    assert.ok(op.path.startsWith('/workspace/proj/capital-data/datasets/'), `写入必须位于 session workspace 内: ${op.path}`)
  }
  const manifest = JSON.parse(fs.files.get(manifestPath('/workspace/proj', id)))
  assert.equal(manifest.dataset_id, 'ds_001')
  assert.equal(manifest.task_id, null)
  assert.equal(manifest.session_id, 'session-1')
  assert.equal(manifest.artifact_ref, 'workspace://capital-data/datasets/ds_001', 'artifact_ref 是 opaque 引用，无绝对路径')
  assert.equal(manifest.format, 'json_rows')
  assert.equal(manifest.capability, 'history')
  assert.equal(manifest.source_label, 'fuyao')
  assert.deepEqual(manifest.schema, { columns: ['date_ms', 'close_price'] })
  assert.equal(manifest.row_count, 2)
  assert.equal(manifest.captured_at, 1_700_000_000_000)
  assert.equal(manifest.retention_until, 1_700_000_000_000 + DEFAULT_RETENTION_MS, '默认保留 7 天')
  assert.equal(manifest.params_digest, 'history:{}')
  // 返回值是公开 DatasetRef；manifest 额外包含宿主内部 scope 字段。
  const { session_scope_id: _scope, ...publicManifest } = manifest
  assert.deepEqual(ref, publicManifest)
  assert.equal(manifest.session_scope_id, 'session-1')
  assert.ok(!JSON.stringify(ref).includes('/workspace'), 'DatasetRef 不得泄露绝对路径')
})

test('save：task_id 可关联任务', async () => {
  const { store } = makeStore({ newId: deterministicId() })
  const ref = await store.save(saveInput({ task_id: 'task-7' }))
  assert.equal(ref.task_id, 'task-7')
})

test('重启读取：新 store 实例（新进程内状态）可从同一 workspace 读回 DatasetRef，无需再次取数', async () => {
  const fs = fakeFs()
  const first = new WorkspaceDatasetStore({ fs, sandboxPolicy: policyLike(), now: () => 1_700_000_000_000, newId: deterministicId() })
  const saved = await first.save(saveInput())
  // 模拟重启：全新 store 实例，只共享同一 filesystem backend
  const second = new WorkspaceDatasetStore({ fs, sandboxPolicy: policyLike(), now: () => 1_700_000_000_100 })
  assert.deepEqual(await second.readRef(saved.dataset_id, SESSION), saved)
  assert.deepEqual(await second.listRefs(SESSION), [saved])
})

test('权限失败：read-only workspace 明确返回 workspace_not_writable，零写入', async () => {
  const { store, fs } = makeStore({ mode: 'read-only', newId: deterministicId() })
  await assert.rejects(() => store.save(saveInput()), (error) => {
    assert.match(error.message, /workspace_not_writable/)
    assert.match(error.message, /read-only/)
    return true
  })
  assert.equal(fs.ops.length, 0, '只读时不得尝试任何写入')
})

test('权限失败：未知/缺失 mode 一律拒绝（fail closed）', async () => {
  const { store, fs } = makeStore({ sandboxPolicy: { resolve: () => ({ mode: undefined, workspaceRoot: '/workspace/proj' }) } })
  await assert.rejects(() => store.save(saveInput()), /workspace_not_writable/)
  assert.equal(fs.ops.length, 0)
})

test('权限失败：sandbox backend 拒绝（FS_SANDBOX_DENIED / FS_PERMISSION_DENIED）映射为 workspace_not_writable', async () => {
  for (const code of ['FS_SANDBOX_DENIED', 'FS_PERMISSION_DENIED']) {
    const fs = fakeFs()
    fs.failNextWrite = code
    const store = new WorkspaceDatasetStore({ fs, sandboxPolicy: policyLike(), newId: deterministicId() })
    await assert.rejects(() => store.save(saveInput()), (error) => {
      assert.match(error.message, /workspace_not_writable/)
      assert.ok(error.message.includes(code), '错误信息应包含官方错误码')
      return true
    })
  }
})

test('写冲突：createIfAbsent 撞已有文件（FS_NOT_OBSERVED）报 dataset_write_failed，不假装成功', async () => {
  const { store, fs } = makeStore({ newId: deterministicId() })
  fs.failNextWrite = 'FS_NOT_OBSERVED'
  await assert.rejects(() => store.save(saveInput()), /dataset_write_failed/)
})

test('不可写根：workspaceRoot 非绝对路径报 workspace_not_writable', async () => {
  const { store } = makeStore({ sandboxPolicy: policyLike('workspace-write', 'relative/root') })
  await assert.rejects(() => store.save(saveInput()), /workspace_not_writable/)
})

test('containment：解析结果逃逸 workspace 时报 workspace_not_writable', async () => {
  const { store, fs } = makeStore({ newId: deterministicId() })
  fs.containsResult = false
  await assert.rejects(() => store.save(saveInput()), /workspace_not_writable/)
})

test('session 缺失：无 cwd 报 session_cwd_unavailable，不回退进程 cwd', async () => {
  const { store } = makeStore()
  await assert.rejects(() => store.save(saveInput({ session: { id: 's', header: {} } })), /session_cwd_unavailable/)
  await assert.rejects(() => store.save(saveInput({ session: { id: 's', header: { cwd: 'relative/proj' } } })), /session_cwd_unavailable/)
  await assert.rejects(() => store.save(saveInput({ session: { id: '', header: { cwd: '/workspace/proj' } } })), /session_unavailable/)
})

test('服务缺失：无 sandboxPolicy 报 sandbox_policy_unavailable；无 fs 报 filesystem_unavailable', async () => {
  const noPolicy = new WorkspaceDatasetStore({ fs: fakeFs(), newId: deterministicId() })
  await assert.rejects(() => noPolicy.save(saveInput()), /sandbox_policy_unavailable/)
  const noFs = new WorkspaceDatasetStore({ sandboxPolicy: policyLike(), newId: deterministicId() })
  await assert.rejects(() => noFs.save(saveInput()), /filesystem_unavailable/)
})

test('序列化失败：raw 不可 JSON 序列化报 dataset_write_failed', async () => {
  const { store, fs } = makeStore({ newId: deterministicId() })
  const circular = {}
  circular.self = circular
  await assert.rejects(() => store.save(saveInput({ data: circular })), /dataset_write_failed/)
  assert.equal(fs.ops.length, 0)
})

test('7 天 retention：过期 Dataset 逻辑不可见（readRef/listRefs 返回空），manifest 文件仍保留', async () => {
  const fs = fakeFs()
  let clock = 1_700_000_000_000
  const { store } = { store: new WorkspaceDatasetStore({ fs, sandboxPolicy: policyLike(), now: () => clock, newId: deterministicId() }) }
  const saved = await store.save(saveInput())
  clock += 1000
  assert.deepEqual(await store.readRef(saved.dataset_id, SESSION), saved, '保留期内可读')
  clock = saved.retention_until + 1
  assert.equal(await store.readRef(saved.dataset_id, SESSION), undefined, '过期后 readRef 不可见')
  assert.deepEqual(await store.listRefs(SESSION), [], '过期后 listRefs 不可见')
  assert.equal(fs.files.has(manifestPath('/workspace/proj', saved.dataset_id)), true, '物理文件仍在（DSH fs 无 delete 原语，物理清理留后续）')
})

test('listRefs：损坏 manifest 跳过；datasets 目录不存在返回空；非法 id 返回 undefined', async () => {
  const fs = fakeFs()
  const store = new WorkspaceDatasetStore({ fs, sandboxPolicy: policyLike(), now: () => 1_700_000_000_000, newId: deterministicId() })
  const saved = await store.save(saveInput())
  // 再在 datasets 下写一个损坏 manifest 的目录
  const brokenManifest = await fs.resolve(`capital-data/datasets/ds_broken/manifest.json`, { cwd: '/workspace/proj' })
  await fs.writeText(brokenManifest, 'not json')
  const refs = await store.listRefs(SESSION)
  assert.deepEqual(refs.map((r) => r.dataset_id), [saved.dataset_id], '损坏 manifest 应被跳过')
  assert.equal(await store.readRef('../../etc/passwd', SESSION), undefined)
  const emptyStore = new WorkspaceDatasetStore({ fs: fakeFs(), sandboxPolicy: policyLike() })
  assert.deepEqual(await emptyStore.listRefs(SESSION), [])
})

test('readRef/listRefs：policy 不可用时回退 session cwd（只读路径，无写入）', async () => {
  const fs = fakeFs()
  const writer = new WorkspaceDatasetStore({ fs, sandboxPolicy: policyLike(), newId: deterministicId() })
  const saved = await writer.save(saveInput())
  const reader = new WorkspaceDatasetStore({ fs }) // 无 sandboxPolicy
  assert.deepEqual(await reader.readRef(saved.dataset_id, SESSION), saved)
})
