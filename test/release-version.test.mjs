import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 发版闸门：版本号一致性。
 *
 * 版本号真值是 `package.json` 的 `version`，但对外可见的版本号散落多处。
 * `WIND_CLIENT_VERSION` / `LOCAL_FETCH_CLIENT_VERSION` / `chart-ui` 已各有测试守着
 * （其中 chart-ui 的守卫在 chart-composition 里，这里再守一次不重复付出成本），
 * 但**嵌套包 capital-config、README 徽章、CHANGELOG 条目**此前无人看守——
 * 发版时漏改不会有任何测试失败，只能靠人记得改全（2.1.0 发版就漏过两处）。
 * 这里把"忘了同步"变成具名失败。
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const rootVersion = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

test('发版闸门：随包嵌套包（chart-ui / capital-config）的 version 必须与主包一致', () => {
  const version = rootVersion()
  for (const manifestPath of ['chart-ui/package.json', 'capital-config/package.json']) {
    const manifest = JSON.parse(readFileSync(join(ROOT, manifestPath), 'utf8'))
    assert.equal(
      manifest.version,
      version,
      `发版时忘了同步 ${manifestPath} 的 version（主包已是 ${version}，该包仍是 ${manifest.version}）`,
    )
  }
})

test('发版闸门：README 版本徽章必须与主包 version 一致', () => {
  const version = rootVersion()
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const badge = readme.match(/img\.shields\.io\/badge\/version-(.+?)-9cf/)
  assert.ok(badge, 'README 顶部缺少 version 徽章（img.shields.io/badge/version-…-9cf）')
  assert.equal(badge[1], version, `发版时忘了同步 README 徽章（徽章是 ${badge[1]}，主包是 ${version}）`)
})

test('发版闸门：CHANGELOG.md 必须已有当前 version 的条目', () => {
  const version = rootVersion()
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  assert.ok(
    changelog.includes(`## [${version}]`),
    `CHANGELOG.md 缺少 "## [${version}]" 条目——发版前先写 changelog（README 只放最近一版，历史都在这里）`,
  )
})
