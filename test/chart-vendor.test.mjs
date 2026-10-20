import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Third-party consistency gate for the vendored chart library, which ships in two forms (the
 * standalone dist inlined into chart.html, and client.js bundled from node_modules). A caret
 * devDependency once let a fresh install bundle a newer version than vendor/, so the two render
 * paths diverged silently. Pins: installed version == vendor/VERSION.json, dists byte-identical,
 * and client.js's license banner carries the vendor version.
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
  // Attribution is part of the Apache-2.0 requirement, so pin it alongside the version marker.
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
