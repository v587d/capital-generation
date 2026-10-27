import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Release gate: outward-facing version strings must track package.json `version` — nested package
// manifests, README badge, CHANGELOG entry, DSH baseline (README badge + README/CONTRIBUTING prose).
// A missed bump fails nothing at runtime, so "forgot to sync" has to become a named failure.
// Same family: README image refs must exist under assets/, and linked docs/*.md must be git-tracked
// (`docs/*` is gitignored with per-file allow — un-allowed reads fine locally, 404 on GitHub).
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const rootVersion = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

test('发版闸门：随包嵌套包（chart-ui / capital-config / capital-watchlist / capital-automation）的 version 必须与主包一致', () => {
  const version = rootVersion()
  for (const manifestPath of ['chart-ui/package.json', 'config/package.json', 'watchlist/package.json', 'automation/package.json']) {
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

// shields badges encode `-` as `--` (`0.1.7--rc.2` renders as `0.1.7-rc.2`).
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

test('发版闸门：README 跳转的详情页必须被 git 跟踪（docs/* 默认被 .gitignore 排除）', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const links = [
    ...new Set(
      [...readme.matchAll(/\]\(([^)#\s]+?\.md)\)/g)]
        .map((match) => match[1])
        .filter((link) => !/^[a-z]+:\/\//.test(link)),
    ),
  ]
  assert.ok(links.length >= 5, `README 只剩 ${links.length} 条相对 .md 链接，多半是跳转被误删`)
  const untracked = links.filter(
    (link) => !existsSync(join(ROOT, link)) || spawnSync('git', ['ls-files', '--error-unmatch', link], { cwd: ROOT }).status !== 0,
  )
  assert.deepEqual(
    untracked,
    [],
    `README 链接了未入库的文件（GitHub 上会是 404）——在 .gitignore 补 !${untracked.join(' 与 !')} 一行`,
  )
})
