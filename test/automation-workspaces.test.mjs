import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceCatalog } from '../automation/workspaces.js'
import { fakeContext } from './automation-harness.mjs'

function registry() {
  const entities = new Map()
  let counter = 0
  let createCalls = 0
  return {
    entities,
    get createCalls() { return createCalls },
    list: () => [...entities.values()],
    get: (id) => entities.get(id),
    async create(path, title) {
      createCalls += 1
      for (const entity of entities.values()) if (entity.path === path) return entity
      const entity = {
        id: `ws_${++counter}`,
        path,
        title: title ?? path,
        sessionIds: [],
        async attachSession(id) {
          if (!this.sessionIds.includes(id)) this.sessionIds.push(id)
        },
        async status() { return 'ok' },
      }
      entities.set(entity.id, entity)
      return entity
    },
  }
}

async function harness(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'capgen-workspaces-'))
  const runDir = join(dir, 'automation')
  const reg = options.registry ?? registry()
  const persistence = options.persistence ?? { list: async () => [] }
  const { ctx } = fakeContext({ workspaceRegistry: reg, sessionPersistence: persistence })
  const catalog = createWorkspaceCatalog({ ctx, displayName: 'web', runDir, logger: { warn() {} } })
  return { dir, runDir, reg, ctx, catalog, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

test('默认工作区：首次读取时注册到 workspace registry，运行使用 workspaceId 而不是裸 cwd', async () => {
  const { runDir, catalog, cleanup } = await harness()
  try {
    const list = await catalog.list()
    assert.equal(list.length, 1)
    assert.equal(list[0].default, true)
    assert.equal(list[0].title, 'CapGen 投研自动化（web）')
    assert.equal('path' in list[0], false, '页面 meta 不暴露工作区绝对路径')
    const target = await catalog.resolve('')
    assert.equal(target.workspaceId, list[0].id)
    assert.equal(target.path, runDir)
  } finally {
    await cleanup()
  }
})

test('多个 catalog 并发解析同一默认目录时只注册一次', async () => {
  const { runDir, reg, ctx, catalog, cleanup } = await harness()
  const second = createWorkspaceCatalog({ ctx, displayName: 'web', runDir, logger: { warn() {} } })
  try {
    const [first, again] = await Promise.all([catalog.list(), second.list()])
    assert.equal(first.length, 1)
    assert.deepEqual(again, first)
    assert.equal(reg.createCalls, 1)
  } finally {
    await cleanup()
  }
})
test('显式选择只接受已注册工作区；未知 id 与缺失目录分别报稳定 code', async () => {
  const { runDir, reg, catalog, cleanup } = await harness()
  try {
    const other = await reg.create(join(runDir, '..', 'project'), '项目')
    assert.deepEqual(await catalog.resolve(other.id), { workspaceId: other.id, path: other.path })
    await assert.rejects(catalog.resolve('ws_missing'), (error) => error.code === 'workspace_not_found')
    other.status = async () => 'missing-dir'
    await assert.rejects(catalog.resolve(other.id), (error) => error.code === 'workspace_unavailable')
  } finally {
    await cleanup()
  }
})

test('注册默认工作区时把同名 cwd 的历史 session 归入该工作区，避免继续留在未分组', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'capgen-workspaces-'))
  const runDir = join(dir, 'automation')
  const reg = registry()
  const persistence = {
    list: async () => [
      { header: { id: 'session-old', cwd: '/tmp/somewhere' } },
      { header: { id: 'session-new', cwd: runDir } },
    ],
  }
  const { ctx } = fakeContext({ workspaceRegistry: reg, sessionPersistence: persistence })
  const catalog = createWorkspaceCatalog({ ctx, displayName: 'web', runDir, logger: { warn() {} } })
  try {
    const list = await catalog.list()
    const entity = reg.get(list[0].id)
    assert.deepEqual(entity.sessionIds, ['session-new'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('workspaceRegistry 不可用时退回受控目录，不阻断运行与页面', async () => {
  const { ctx } = fakeContext({})
  const catalog = createWorkspaceCatalog({ ctx, displayName: 'web', runDir: '/tmp/capgen-no-registry', logger: { warn() {} } })
  assert.deepEqual(await catalog.list(), [])
  assert.deepEqual(await catalog.resolve(''), { workspaceId: undefined, path: '/tmp/capgen-no-registry' })
})
