/**
 * 巡检与发布脚本必须在**离线**状态下可解析、可 import。
 *
 * 为什么单独钉这一条：这些文件只有 CI 会真跑。第一次 hosted 全量就是这样——巡检 109 条全绿，
 * 发单那步炸在 `constructor(message, readonly status, …)`：那是 TypeScript 的参数属性写法，
 * 在 `.mjs` 里是语法错。它躲过了本地 858 条测试，因为**没有任何一条 import 过那个文件**，
 * 而 CI 里它偏偏排在最后一步（前面全绿，只有它红）。
 *
 * 所以这里不测行为，只测"能不能被加载"——`--check` 不执行任何东西，import 也只在 lib 层
 * （`scripts/contract-probe.mjs` 那种 CLI 一 import 就会真打网络，绝不 import）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function scriptsIn(dir) {
  if (!existsSync(join(ROOT, dir))) return []
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) return scriptsIn(rel)
    return entry.name.endsWith('.mjs') ? [rel] : []
  })
}

const modules = [...scriptsIn('scripts'), ...scriptsIn('scripts/lib')].sort()

test('scripts/ 下每个 .mjs 都能被 node 解析（语法错在 CI 的最后一步才炸）', () => {
  assert.ok(modules.length >= 12, `只扫到 ${modules.length} 个脚本，多半是目录写错了`)
  const broken = modules.filter((rel) => {
    // ⛔ 用 process.execPath：按命令名 spawn 在 Windows 上拿到的是 .cmd 垫片（cross-platform 同源教训）。
    const check = spawnSync(process.execPath, ['--check', join(ROOT, rel)], { encoding: 'utf8' })
    if (check.status === 0) return false
    console.error(`${rel}: ${String(check.stderr).split('\n').slice(0, 3).join(' ')}`)
    return true
  })
  assert.deepEqual(broken, [], `上面的文件在 import 阶段就解析失败——CI 里跑它们的那一步必然红`)
})

test('scripts/lib/ 的每一份都可 import 且导出被用到的名字（不发任何请求）', async () => {
  const libs = modules.filter((rel) => rel.startsWith('scripts/lib/'))
  assert.ok(libs.length >= 5, `lib 层只扫到 ${libs.length} 份`)
  for (const rel of libs) {
    const namespace = await import(pathToFileURL(join(ROOT, rel)).href)
    assert.ok(Object.keys(namespace).length > 0, `${rel} 什么都没导出`)
  }
  // 发布脚本与看门狗共用的这一份，名字错了会在 CI 里以 import 失败的形式出现。
  const api = await import(pathToFileURL(join(ROOT, 'scripts/lib/github-api.mjs')).href)
  for (const name of ['GitHubApiError', 'createGitHubApi', 'requireGitHubEnv']) {
    assert.equal(typeof api[name], 'function', `github-api.mjs 缺少导出 ${name}`)
  }
  const error = new api.GitHubApiError('boom', 404, '{}')
  assert.equal(error.status, 404, 'status 没挂到实例上：调用方拿不到状态码就只能猜')
  assert.equal(error.name, 'GitHubApiError')
})
