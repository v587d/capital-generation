#!/usr/bin/env node
/**
 * 把 `vendor/` 下的浏览器侧静态资源复制进 `lib/`。
 *
 * 为什么必须复制而不是运行时去读 `vendor/`：宿主按 `lib/` 加载本插件（package.json
 * 的 main/exports 都指向 lib），发布出去的包只有 `files` 列表里的内容；`tsc` 不会
 * 搬运非 .ts 资源。于是"构建产物自洽"这件事必须显式做，并由 test/packaging.test.mjs
 * 兜住（漏掉的表现是图表 HTML 里没有库，或者更糟：客户端 bundle 缺失导致 web profile 起不来）。
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** [源目录, 目标目录]；目标必须在 lib/ 内，否则不会随包发布。 */
const ASSETS = [['vendor/lightweight-charts', 'lib/chart/vendor']]

for (const [from, to] of ASSETS) {
  const source = join(ROOT, from)
  const target = join(ROOT, to)
  if (!existsSync(source)) {
    console.error(`copy-assets: 缺少 ${from}；先运行 npm run vendor:charts`)
    process.exit(1)
  }
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, { recursive: true })
  console.log(`copy-assets: ${from} → ${to}`)
}
