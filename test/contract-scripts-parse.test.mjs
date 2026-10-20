/**
 * CI-only scripts must parse and import offline. A TS parameter-property in a `.mjs` once passed
 * 858 local tests (none imported that file) and failed on the last CI step. No behavior here: just
 * `--check` and lib-level imports (CLI scripts fire network requests on import).
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
    // Use process.execPath: spawning by command name yields the .cmd shim on Windows.
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
  // Shared by publish and watchdog; a wrong name here surfaces as a CI import failure.
  const api = await import(pathToFileURL(join(ROOT, 'scripts/lib/github-api.mjs')).href)
  for (const name of ['GitHubApiError', 'createGitHubApi', 'requireGitHubEnv']) {
    assert.equal(typeof api[name], 'function', `github-api.mjs 缺少导出 ${name}`)
  }
  const error = new api.GitHubApiError('boom', 404, '{}')
  assert.equal(error.status, 404, 'status 没挂到实例上：调用方拿不到状态码就只能猜')
  assert.equal(error.name, 'GitHubApiError')
})
