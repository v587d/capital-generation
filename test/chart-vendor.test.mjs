import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * vendored 图表库的三方一致性闸门（2026-09，GitHub 分发前补）。
 *
 * 同一个库以**两种形态**随包发布：
 *  1. `lib/chart/vendor/lightweight-charts.standalone.production.js` —— 自包含 `chart.html`
 *     内联的那份，来自 `npm run vendor:charts`（源：`vendor/lightweight-charts/`）；
 *  2. `chart-ui/client.js` —— esbuild 从 `node_modules` 的 ESM 入口打包的那份。
 *
 * devDependency 曾经写成 `^5.2.1`：上游一发新版，别人 `npm install && npm run build` 就会把
 * **新版本**打进 `client.js`，而 `vendor/` 仍停在旧版本——同一个产品里两条渲染路径跑不同版本的库，
 * 且没有任何断言会失败。本用例把三条锁死：
 *  ① `node_modules` 版本 == `vendor/VERSION.json` 版本（漂移的源头）；
 *  ② 两份 dist 逐字节一致（sha256，来自 VERSION.json 的登记值）；
 *  ③ 已提交的 `client.js` 许可横幅版本 == vendor 版本（证明构建产物来自同一版本）。
 * 另外核对 `lib/chart/vendor/` 是 `vendor/` 的副本（`scripts/copy-assets.mjs` 跑过）。
 */

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const VENDOR_DIR = join(ROOT, 'vendor', 'lightweight-charts')
const VENDOR_VERSION = JSON.parse(readFileSync(join(VENDOR_DIR, 'VERSION.json'), 'utf8'))
const INSTALLED_PKG = join(ROOT, 'node_modules', 'lightweight-charts', 'package.json')
const DIST_FILE = 'lightweight-charts.standalone.production.js'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

test('vendored 图表库：node_modules 版本必须等于 vendor/VERSION.json（devDependency 必须精确锁版）', () => {
  assert.ok(existsSync(INSTALLED_PKG), `缺少 ${INSTALLED_PKG}：npm test 需要已安装 devDependencies`)
  const installed = JSON.parse(readFileSync(INSTALLED_PKG, 'utf8'))
  assert.equal(
    installed.version,
    VENDOR_VERSION.version,
    `node_modules 里是 lightweight-charts@${installed.version}，vendor 登记的是 @${VENDOR_VERSION.version}：`
      + '先跑 npm run vendor:charts 重新 vendored，否则 client.js 与 chart.html 会内嵌不同版本',
  )
  assert.equal(VENDOR_VERSION.license, 'Apache-2.0')
})

test('vendored 图表库：node_modules 的 dist 与 vendor 的 dist 逐字节一致', () => {
  const installedDist = join(ROOT, 'node_modules', 'lightweight-charts', 'dist', DIST_FILE)
  assert.ok(existsSync(installedDist), `缺少 ${installedDist}：上游可能改了 dist 布局，先核对并更新 vendor 脚本`)
  const installedDigest = sha256(readFileSync(installedDist))
  assert.equal(
    installedDigest,
    VENDOR_VERSION.sha256,
    'vendor 的 dist 与 node_modules 的不是同一次构建：重新 npm run vendor:charts 并提交新 sha256',
  )
})

test('vendored 图表库：已提交的 client.js 必须来自同一版本（许可横幅即版本戳）', () => {
  const client = readFileSync(join(ROOT, 'chart-ui', 'client.js'), 'utf8')
  const marker = `Lightweight Charts™ v${VENDOR_VERSION.version}`
  assert.ok(
    client.includes(marker),
    `chart-ui/client.js 里找不到 "${marker}"：浏览器 bundle 与 vendor 的版本已经分叉，`
      + '或 esbuild 不再保留库的许可横幅（那同时意味着 Apache-2.0 归属信息丢了）——跑 npm run build 后核对',
  )
  // 归属信息是 Apache-2.0 许可要求的一部分，跟着版本戳一起钉住。
  assert.ok(client.includes('TradingView'), 'client.js 必须保留 TradingView 归属信息')
})

test('vendored 图表库：lib/chart/vendor 必须是 vendor/ 的副本（copy-assets 跑过）', () => {
  const shipped = join(ROOT, 'lib', 'chart', 'vendor')
  for (const name of [DIST_FILE, 'VERSION.json', 'LICENSE']) {
    const source = join(VENDOR_DIR, name)
    const copied = join(shipped, name)
    assert.ok(existsSync(copied), `lib/chart/vendor/${name} 缺失：先跑 npm run build（copy-assets 会复制）`)
    assert.equal(
      sha256(readFileSync(copied)),
      sha256(readFileSync(source)),
      `lib/chart/vendor/${name} 与 vendor/${name} 不一致：重新构建后再发布`,
    )
  }
})
