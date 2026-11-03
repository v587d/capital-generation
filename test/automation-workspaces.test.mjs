import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceCatalog, defaultWorkspacePath, defaultWorkspaceTitle, workspaceDisplayPath } from '../automation/workspaces.js'
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
  const runDir = options.runDir ?? join(dir, 'automation')
  const reg = options.registry ?? registry()
  const persistence = options.persistence ?? { list: async () => [] }
  const { ctx } = fakeContext({ workspaceRegistry: reg, sessionPersistence: persistence })
  const catalog = createWorkspaceCatalog({
    ctx,
    displayName: 'web',
    runDir,
    displayHome: options.displayHome ?? dir,
    getDefaultWorkspaceId: options.getDefaultWorkspaceId,
    logger: { warn() {} },
  })
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

test('专属默认工作区目录是 <dsh home>/CapGen-automation-workspace/<profile>，页面显示仍为 ~', () => {
  const home = join(tmpdir(), 'capgen-home')
  assert.equal(
    defaultWorkspacePath({ home, name: 'web' }),
    join(home, 'CapGen-automation-workspace', 'web'),
    '默认目录名与 profile 名分开：改显示名不会再改路径',
  )
  assert.equal(defaultWorkspaceTitle('web'), 'CapGen 投研自动化（web）')
  assert.equal(
    workspaceDisplayPath(join(home, 'CapGen-automation-workspace', 'web'), home),
    '~/CapGen-automation-workspace/web',
  )
  assert.equal(workspaceDisplayPath('/srv/research', '/home/shawn'), '/srv/research', '家目录外的路径仍写绝对路径')
})

test('设置里的统一默认工作区优先；目录不可用时回退专属默认工作区', async () => {
  const { dir, runDir, reg, ctx, catalog, cleanup } = await harness()
  try {
    const other = await reg.create(join(dir, 'project'), '研究项目')
    const configured = createWorkspaceCatalog({
      ctx,
      displayName: 'web',
      runDir,
      displayHome: dir,
      getDefaultWorkspaceId: () => other.id,
      logger: { warn() {} },
    })
    const details = await configured.details()
    const dedicated = details.workspaces.find((item) => item.dedicated === true)
    const preferred = details.workspaces.find((item) => item.id === other.id)
    assert.ok(dedicated, '专属默认工作区仍然注册并列出，作为回退项')
    assert.equal(preferred.default, true, '设置里选中的工作区承担默认标记')
    assert.equal(dedicated.default, false)
    assert.equal(preferred.displayPath, '~/project', '设置卡片显示家目录缩写')
    assert.deepEqual(await configured.resolve(''), { workspaceId: other.id, path: other.path })

    other.status = async () => 'missing-dir'
    const fallback = await configured.resolve('')
    assert.equal(fallback.workspaceId, dedicated.id, '被移除/不可用的目录不能阻断运行')
    assert.equal(fallback.path, runDir)

    const missing = createWorkspaceCatalog({
      ctx,
      displayName: 'web',
      runDir,
      getDefaultWorkspaceId: () => 'ws_missing',
      logger: { warn() {} },
    })
    assert.equal((await missing.resolve('')).workspaceId, dedicated.id, '未知 id 回退到专属默认工作区')
  } finally {
    await cleanup()
  }
})
