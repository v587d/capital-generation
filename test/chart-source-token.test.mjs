import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChartSourceTokenStore, registerChartSourceTool } from '../lib/chart/source-token.js'
import { renderChart } from '../lib/chart/tool.js'
import { WorkspaceDatasetStore } from '../lib/data-collector/store.js'

const WORKSPACE = '/workspace/proj'
const MAIN = { id: 'main-1', header: { cwd: WORKSPACE } }
const COLLECTOR = { id: 'collector-1', header: { cwd: WORKSPACE, parentSession: MAIN.id } }
const JUNIOR = { id: 'junior-1', header: { cwd: WORKSPACE, parentSession: MAIN.id } }
const GRANDCHILD = { id: 'visual-1', header: { cwd: WORKSPACE, parentSession: JUNIOR.id } }

function execAs(session) {
  return { agent: { session }, signal: new AbortController().signal }
}

function fakeFs() {
  const files = new Map()
  const dirs = new Set()
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
    files,
    dirs,
    async resolve(path, opts = {}) {
      const cwd = opts.cwd ?? '/'
      const absolute = path.startsWith('/') ? path : `${cwd.replace(/\/$/, '')}/${path}`
      const normalized = norm(absolute)
      return { targetKey: `key:${normalized}`, displayPath: normalized }
    },
    contains(parent, child) {
      return child.displayPath === parent.displayPath || child.displayPath.startsWith(`${parent.displayPath}/`)
    },
    async writeText(target, content, expected) {
      if (expected?.kind === 'createIfAbsent' && this.files.has(target.displayPath)) {
        const error = new Error('already exists')
        error.code = 'FS_NOT_OBSERVED'
        throw error
      }
      const segments = target.displayPath.split('/').filter(Boolean)
      for (let index = 1; index < segments.length; index += 1) this.dirs.add('/' + segments.slice(0, index).join('/'))
      this.files.set(target.displayPath, content)
      return { operation: 'create' }
    },
    async readText(target) {
      if (!this.files.has(target.displayPath)) {
        const error = new Error('missing')
        error.code = 'FS_NOT_FOUND'
        throw error
      }
      return this.files.get(target.displayPath)
    },
    async stat(target) {
      if (!this.files.has(target.displayPath)) return undefined
      return { type: 'file', size: Buffer.byteLength(this.files.get(target.displayPath)) }
    },
  }
}

const sandboxPolicy = { resolve: () => ({ mode: 'workspace-write', workspaceRoot: WORKSPACE }) }

async function fixture() {
  const fs = fakeFs()
  const store = new WorkspaceDatasetStore({ fs, sandboxPolicy, now: () => 1_700_000_000_000 })
  const ref = await store.save({
    session: COLLECTOR,
    task_id: 'task-1',
    capability: 'history',
    params_digest: 'digest-1',
    source_label: '同花顺日线',
    format: 'json_rows',
    schema: { rowShape: 'array' },
    row_count: 2,
    data: [
      { trade_date: '2025-01-01', close: 10 },
      { trade_date: '2025-01-02', close: 11 },
    ],
  })
  return { fs, store, ref }
}

test('ChartSourceTokenStore：签发、任务绑定、过期和撤销', async () => {
  let now = 1_700_000_000_000
  const { store, ref } = await fixture()
  const tokens = new ChartSourceTokenStore({
    now: () => now,
    ttlMs: 1000,
    newToken: () => 'cs_test_token',
  })

  const liveJunior = { ...JUNIOR, snapshotEvents() { return [] } }
  const issued = await tokens.issue({ store, session: liveJunior, dataset_id: ref.dataset_id, task_id: 'task-1' })
  assert.equal(tokens.resolve({ chart_source_ref: issued.chart_source_ref, task_id: 'task-1' }).sourceSession, liveJunior)
  assert.deepEqual(issued, {
    chart_source_ref: 'cs_test_token',
    dataset_id: ref.dataset_id,
    task_id: 'task-1',
    expires_at: now + 1000,
  })
  assert.equal(tokens.resolve({ chart_source_ref: issued.chart_source_ref, task_id: 'task-1' }).dataset_id, ref.dataset_id)
  assert.throws(
    () => tokens.resolve({ chart_source_ref: issued.chart_source_ref, task_id: 'other-task' }),
    (error) => error.code === 'chart_source_scope_mismatch',
  )

  now += 1001
  assert.throws(
    () => tokens.resolve({ chart_source_ref: issued.chart_source_ref, task_id: 'task-1' }),
    (error) => error.code === 'chart_source_expired',
  )
  assert.equal(tokens.revoke(issued.chart_source_ref), false, '过期 token 应已从内存索引清理')
})

test('nested visualization child：用 token 读取 direct data-agent scope，不触发 dataset_session_mismatch', async () => {
  const { fs, store, ref } = await fixture()
  const tokens = new ChartSourceTokenStore({ now: () => 1_700_000_000_000, newToken: () => 'cs_nested' })
  const issued = await tokens.issue({ store, session: JUNIOR, dataset_id: ref.dataset_id, task_id: 'task-1' })

  const receipt = await renderChart({ store, sourceTokens: tokens }, {
    chart_source_ref: issued.chart_source_ref,
    task_id: 'task-1',
    spec: { kind: 'line', x: 'trade_date', series: ['close'] },
  }, execAs(GRANDCHILD))

  assert.equal(receipt.dataset_id, ref.dataset_id)
  assert.equal(receipt.points, 2)
  assert.ok(fs.files.has(`${WORKSPACE}/${receipt.html_path}`))
})


test('nested visualization child：token 读取使用 live Session，兼容 sandboxPolicy.snapshotEvents', async () => {
  const fs = fakeFs()
  const strictPolicy = {
    resolve: ({ session }) => {
      if (typeof session?.snapshotEvents !== 'function') throw new Error('session.snapshotEvents is not a function')
      return { mode: 'workspace-write', workspaceRoot: WORKSPACE }
    },
  }
  const store = new WorkspaceDatasetStore({ fs, sandboxPolicy: strictPolicy, now: () => 1_700_000_000_000 })
  const liveCollector = { ...COLLECTOR, snapshotEvents() { return [] } }
  const liveJunior = { ...JUNIOR, snapshotEvents() { return [] } }
  const liveGrandchild = { ...GRANDCHILD, snapshotEvents() { return [] } }
  const ref = await store.save({
    session: liveCollector,
    task_id: 'task-1',
    capability: 'history',
    params_digest: 'digest-live',
    source_label: '同花顺日线',
    format: 'json_rows',
    schema: { rowShape: 'array' },
    row_count: 2,
    data: [{ trade_date: '2025-01-01', close: 10 }, { trade_date: '2025-01-02', close: 11 }],
  })
  const tokens = new ChartSourceTokenStore({ now: () => 1_700_000_000_000, newToken: () => 'cs_live_session' })
  const issued = await tokens.issue({ store, session: liveJunior, dataset_id: ref.dataset_id, task_id: 'task-1' })
  const receipt = await renderChart({ store, sourceTokens: tokens }, {
    chart_source_ref: issued.chart_source_ref,
    task_id: 'task-1',
    spec: { kind: 'line', x: 'trade_date', series: ['close'] },
  }, execAs(liveGrandchild))
  assert.equal(receipt.points, 2)
})

test('prepare_chart_source：主 Agent不能直接签发 token', async () => {
  const { store, ref } = await fixture()
  const tokens = new ChartSourceTokenStore({ newToken: () => 'cs_tool' })
  let definition
  registerChartSourceTool({
    get: (name) => name === 'tools' ? { register: (value) => { definition = value; return () => {} } } : undefined,
    effect: (callback) => callback(),
  }, { store, tokens })

  await assert.rejects(
    () => definition.execute({ dataset_id: ref.dataset_id, task_id: 'task-1' }, execAs(MAIN)),
    (error) => error.code === 'chart_source_scope_mismatch',
  )

  const issued = await definition.execute({ dataset_id: ref.dataset_id, task_id: 'task-1' }, execAs(JUNIOR))
  assert.equal(issued.chart_source_ref, 'cs_tool')
})
