#!/usr/bin/env node
/**
 * Copies browser static assets from `vendor/` into `lib/`: the host loads the plugin from lib/,
 * only `files` ships, and tsc never moves non-.ts assets — test/packaging.test.mjs guards the result.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** [from, to]; targets must live under lib/ or they are not published. */
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
