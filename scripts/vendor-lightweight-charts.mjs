#!/usr/bin/env node
/**
 * 把 lightweight-charts 的浏览器 standalone 构建 vendor 进本仓库。
 *
 * 设计约束（见 docs/design/chart-visualization.md §5.5）：
 *  - **不用 CDN**：本仓是离线本地部署，图表库必须随包发布；
 *  - **固定版本**：版本号写进 VERSION.json 并记录 SHA-256，升级是一次显式动作，
 *    不是 `npm install` 的副作用；
 *  - **输出确定性**：不写时间戳，重复执行结果逐字节一致，便于 review diff。
 *
 * 用法：node scripts/vendor-lightweight-charts.mjs
 * 前置：node_modules 里已安装 devDependency `lightweight-charts`。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PKG_DIR = join(ROOT, 'node_modules', 'lightweight-charts')
const DIST_FILE = 'lightweight-charts.standalone.production.js'
const OUT_DIR = join(ROOT, 'vendor', 'lightweight-charts')

if (!existsSync(PKG_DIR)) {
  console.error(`vendor-lightweight-charts: 未安装 lightweight-charts；先运行 npm install（devDependency）`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'))
const sourcePath = join(PKG_DIR, 'dist', DIST_FILE)
if (!existsSync(sourcePath)) {
  console.error(`vendor-lightweight-charts: ${DIST_FILE} 不存在；上游可能改了 dist 布局，先核对 ${PKG_DIR}/dist`)
  process.exit(1)
}

const source = readFileSync(sourcePath)
const sha256 = createHash('sha256').update(source).digest('hex')

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, DIST_FILE), source)

// 许可证必须随包发布：Apache-2.0 的 NOTICE 义务 + 归属说明。
const licenseCandidates = ['LICENSE', 'LICENSE.txt', 'LICENSE.md']
const licenseFile = licenseCandidates.find((candidate) => existsSync(join(PKG_DIR, candidate)))
if (!licenseFile) {
  console.error(`vendor-lightweight-charts: 上游包里找不到许可证文件（试过 ${licenseCandidates.join(' / ')}）；不要跳过这一步`)
  process.exit(1)
}
const licenseText = readFileSync(join(PKG_DIR, licenseFile))
writeFileSync(join(OUT_DIR, 'LICENSE'), licenseText)

const version = {
  name: manifest.name,
  version: manifest.version,
  license: manifest.license,
  dist: DIST_FILE,
  sha256,
  // 归属：Apache-2.0 要求保留归属说明；库自带 attributionLogo（默认开启），
  // 我们保持开启，因此无需在 UI 里另加一行 —— 见 typings.d.ts 的 attributionLogo 注释。
  attribution: 'TradingView Lightweight Charts™ — attribution logo 保持开启',
}
writeFileSync(join(OUT_DIR, 'VERSION.json'), `${JSON.stringify(version, null, 2)}\n`)

console.log(`vendor-lightweight-charts: ${manifest.name}@${manifest.version} → vendor/lightweight-charts/${DIST_FILE}`)
console.log(`  sha256 ${sha256}`)
console.log(`  ${(source.length / 1024).toFixed(1)} KiB（随 lib/ 一起发布）`)
