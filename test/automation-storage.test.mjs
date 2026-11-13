import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  StorageError,
  clearWorkspaceCache,
  createStorageService,
  measureWorkspace,
} from '../automation/storage.js'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'capgen-storage-'))
  await mkdir(join(root, 'capital-data', 'datasets', 'd1'), { recursive: true })
  await writeFile(join(root, 'capital-data', 'datasets', 'd1', 'raw.json'), 'x'.repeat(100))
  await mkdir(join(root, 'capital-data', 'profiles', 'p1'), { recursive: true })
  await writeFile(join(root, 'capital-data', 'profiles', 'p1', 'profile.json'), 'y'.repeat(50))
  await mkdir(join(root, 'capital-data', 'ocr', 'o1'), { recursive: true })
  await writeFile(join(root, 'capital-data', 'ocr', 'o1', 'document.md'), 'z'.repeat(10))
  await mkdir(join(root, 'capital-data', 'stray'), { recursive: true })
  await writeFile(join(root, 'capital-data', 'stray', 'note.txt'), 'w'.repeat(5))
  await mkdir(join(root, 'capital-analysis', 'charts', 'c1'), { recursive: true })
  await writeFile(join(root, 'capital-analysis', 'charts', 'c1', 'chart.html'), 'h'.repeat(200))
  await writeFile(join(root, 'user.txt'), 'keep')
  return root
}

test('storage：统计只算 capital-data / capital-analysis，符号链接不跟随', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'outside.txt'), 'outside')
  try {
    await symlink(join(root, 'outside.txt'), join(root, 'capital-data', 'escape'))
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('当前平台不允许创建符号链接')
      return
    }
    throw error
  }

  const { cache, analysis } = await measureWorkspace(root)
  assert.deepEqual(cache.categories.datasets, { bytes: 100, files: 1 })
  assert.deepEqual(cache.categories.profiles, { bytes: 50, files: 1 })
  assert.deepEqual(cache.categories.ocr, { bytes: 10, files: 1 })
  assert.deepEqual(cache.categories.other, { bytes: 5, files: 1 })
  assert.equal(cache.bytes, 165)
  assert.equal(cache.files, 4)
  assert.equal(cache.unsafe, false)
  assert.ok(!JSON.stringify(cache).includes('outside'), '工作区外的文件不能进入任何分类')

  assert.deepEqual(analysis.categories.charts, { bytes: 200, files: 1 })
  assert.equal(analysis.bytes, 200)
  assert.equal(analysis.files, 1)
})

test('storage：清理只删 capital-data 的子项，分析结果与用户文件保留', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  const outside = join(root, 'outside.txt')
  await writeFile(outside, 'outside')
  await symlink(outside, join(root, 'capital-data', 'escape'))

  const cleared = await clearWorkspaceCache(root)
  assert.equal(cleared.bytes, 165)
  assert.equal(cleared.files, 4)
  assert.deepEqual(cleared.failed, [])
  assert.deepEqual(cleared.categories.datasets, { bytes: 100, files: 1 })
  assert.deepEqual(cleared.categories.other, { bytes: 5, files: 1 })

  // The cache root stays, but its children are gone.
  assert.ok(await stat(join(root, 'capital-data')).then(() => true))
  await assert.rejects(stat(join(root, 'capital-data', 'datasets')), { code: 'ENOENT' })
  await assert.rejects(stat(join(root, 'capital-data', 'escape')), { code: 'ENOENT' })

  assert.equal(await readFile(join(root, 'capital-analysis', 'charts', 'c1', 'chart.html'), 'utf8'), 'h'.repeat(200))
  assert.equal(await readFile(join(root, 'user.txt'), 'utf8'), 'keep')
  assert.equal(await readFile(outside, 'utf8'), 'outside', '符号链接只删链接，不删目标')

  const again = await clearWorkspaceCache(root)
  assert.equal(again.bytes, 0)
  assert.equal(again.files, 0)
})

test('storage：capital-data 是符号链接时拒绝清理，不碰目标', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'capgen-storage-link-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = await mkdtemp(join(tmpdir(), 'capgen-storage-target-'))
  t.after(() => rm(target, { recursive: true, force: true }))
  await writeFile(join(target, 'raw.json'), 'x'.repeat(30))
  try {
    await symlink(target, join(root, 'capital-data'))
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('当前平台不允许创建符号链接')
      return
    }
    throw error
  }

  const measured = await measureWorkspace(root)
  assert.equal(measured.cache.unsafe, true)
  assert.equal(measured.cache.bytes, 0)

  await assert.rejects(clearWorkspaceCache(root), (error) => {
    assert.ok(error instanceof StorageError)
    assert.equal(error.code, 'cache_root_unsafe')
    return true
  })
  assert.equal(await readFile(join(target, 'raw.json'), 'utf8'), 'x'.repeat(30))
})

test('storage：相对工作区路径拒绝统计与清理', async () => {
  await assert.rejects(measureWorkspace('relative/path'), (error) => error.code === 'workspace_unavailable')
  await assert.rejects(clearWorkspaceCache('relative/path'), (error) => error.code === 'workspace_unavailable')
})

test('storage service：默认工作区、会话统计与清理后刷新', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspaces = {
    details: async () => ({
      workspaces: [{
        id: 'ws-1',
        title: 'CapGen 投研自动化（web）',
        path: root,
        displayPath: '~/.dsh/CapGen-automation-workspace/web',
        default: true,
        dedicated: true,
      }],
      defaultWorkspaceId: 'ws-1',
    }),
  }
  const ctx = {
    get: (name) => name === 'sessionPersistence'
      ? {
        list: async () => [
          { header: { cwd: root }, sizeBytes: 42 },
          { header: { cwd: '/elsewhere' }, sizeBytes: 9 },
        ],
      }
      : undefined,
  }
  const service = createStorageService({
    ctx,
    workspaces,
    profile: { runDir: root, displayName: 'web' },
    now: () => 1_000,
  })

  const stats = await service.stats()
  assert.equal(stats.workspace.id, 'ws-1')
  assert.equal(stats.workspace.scope, 'dedicated')
  assert.equal(stats.cache.bytes, 165)
  assert.equal(stats.analysis.bytes, 200)
  assert.deepEqual(stats.sessions, { available: true, bytes: 42, count: 1 })

  const cleared = await service.clear()
  assert.equal(cleared.bytes, 165)
  const after = await service.stats()
  assert.equal(after.cache.bytes, 0)
  assert.equal(after.analysis.bytes, 200, 'capital-analysis 不随清理删除')
})

test('storage service：会话服务不可用时只丢会话尺寸，不影响缓存', async (t) => {
  const root = await workspace()
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspaces = {
    details: async () => ({
      workspaces: [{ id: 'ws-1', title: 'T', path: root, displayPath: '~/T', default: true, dedicated: true }],
      defaultWorkspaceId: 'ws-1',
    }),
  }
  const service = createStorageService({
    ctx: { get: () => undefined },
    workspaces,
    profile: { runDir: root, displayName: 'web' },
  })
  const stats = await service.stats()
  assert.deepEqual(stats.sessions, { available: false, bytes: 0, count: 0 })
  assert.equal(stats.cache.bytes, 165)
  assert.equal(stats.analysis.bytes, 200)
})
