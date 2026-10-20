#!/usr/bin/env node
/**
 * Vendors the lightweight-charts browser standalone build. No CDN (offline deployment), a pinned
 * version recorded with its SHA-256 as an explicit upgrade action, and byte-identical reruns
 * (no timestamps) so diffs stay reviewable.
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

// The license must ship too: Apache-2.0 NOTICE obligation plus attribution.
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
  // Attribution: the library's own attributionLogo stays enabled, so no extra UI line is needed.
  attribution: 'TradingView Lightweight Charts™ — attribution logo 保持开启',
}
writeFileSync(join(OUT_DIR, 'VERSION.json'), `${JSON.stringify(version, null, 2)}\n`)

console.log(`vendor-lightweight-charts: ${manifest.name}@${manifest.version} → vendor/lightweight-charts/${DIST_FILE}`)
console.log(`  sha256 ${sha256}`)
console.log(`  ${(source.length / 1024).toFixed(1)} KiB（随 lib/ 一起发布）`)
