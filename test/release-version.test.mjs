import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 发版闸门：对外可见的版本号与 README 素材。
 *
 * 版本号真值是 `package.json` 的 `version`，但对外可见的版本号散落多处。
 * `WIND_CLIENT_VERSION` / `LOCAL_FETCH_CLIENT_VERSION` / `chart-ui` 已各有测试守着
 * （其中 chart-ui 的守卫在 chart-composition 里，这里再守一次不重复付出成本），
 * 但**嵌套包 capital-config、README 徽章、CHANGELOG 条目**此前无人看守——
 * 发版时漏改不会有任何测试失败，只能靠人记得改全（2.1.0 发版就漏过两处）。
 * 这里把"忘了同步"变成具名失败。
 *
 * 同一族的还有两件事：**DSH 基线版本**（README 徽章 + README/CONTRIBUTING 正文，2.4.0 迁
 * 0.1.7 时 CONTRIBUTING 就漏了一处）与 **README 引用的截图**（换图/改名后留空引用是 404 图片，
 * 用户看到的是裂图，测试与构建都不会失败）。
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

/** shields 徽章里的 `-` 写成 `--`（`0.1.7--rc.2` 显示为 `0.1.7-rc.2`）。 */
function decodeShieldsLabel(label) {
  return label.replace(/--/g, '-')
}

test('发版闸门：DSH 基线版本在 README 徽章 / README 正文 / CONTRIBUTING 三处一致', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const contributing = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8')
  const badge = readme.match(/badge\/DSH%20Baseline-(.+?)-blue/)
  const note = readme.match(/适配 DSH`@([^`]+)`/)
  const devSetup = contributing.match(/当前适配 `@([^`]+)`/)
  assert.ok(badge, 'README 顶部缺少 DSH Baseline 徽章')
  assert.ok(note, 'README 的 NOTE 里缺少「适配 DSH`@…`」')
  assert.ok(devSetup, 'CONTRIBUTING 的开发环境准备里缺少「当前适配 `@…`」')
  assert.equal(note[1], decodeShieldsLabel(badge[1]), `README 正文说的基线（${note[1]}）与徽章（${badge[1]}）不一致`)
  assert.equal(devSetup[1], decodeShieldsLabel(badge[1]), `CONTRIBUTING 说的基线（${devSetup[1]}）与 README 徽章不一致——升级 DSH 后三处要一起改`)
})

test('发版闸门：README 引用的截图都在 assets/ 里（换图改名不许留空引用）', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const refs = [...new Set([...readme.matchAll(/assets\/[^\s")]+?\.(?:png|jpe?g|gif|svg|webp)/g)].map((match) => match[0]))]
  assert.ok(refs.length >= 5, `README 只引用了 ${refs.length} 张图，多半是引用被误删`)
  const missing = refs.filter((ref) => !existsSync(join(ROOT, decodeURIComponent(ref))))
  assert.deepEqual(missing, [], `README 引用了不存在的图片（GitHub 上会是裂图）：${missing.join(', ')}`)
})
