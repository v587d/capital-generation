#!/usr/bin/env node
/**
 * Bundles `chart-ui/client.src.cjs` into the client module table `chart-ui/client.js`.
 * The chart runtime must not publish a page global (docs/design/chart-visualization.md §9), so the
 * runtime string is emitted as a real temp module rather than eval'd in the browser (CSP), keeping
 * the same source as the standalone HTML. `react` stays external, supplied by the module table.
 */
import { build } from 'esbuild'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CHART_RUNTIME_SOURCE } from '../lib/chart/runtime.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CHART_UI = join(ROOT, 'chart-ui')
const GENERATED_RUNTIME = join(CHART_UI, 'client.runtime.gen.cjs')
const manifest = JSON.parse(readFileSync(join(CHART_UI, 'package.json'), 'utf8'))

// The runtime IIFE returns its API object instead of publishing a global, so export it directly.
writeFileSync(GENERATED_RUNTIME, `'use strict'\nexports.__capitalChart = ${CHART_RUNTIME_SOURCE}\n`)

try {
  const result = await build({
    entryPoints: [join(CHART_UI, 'client.src.cjs')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: ['es2020'],
    // lightweight-charts ships only an ESM entry, so add the import condition for esbuild.
    conditions: ['import'],
    // Keep react external: the module table's require supplies the shell's single copy.
    external: ['react', 'react/jsx-runtime'],
    minify: true,
    legalComments: 'inline',
    write: false,
    logLevel: 'warning',
  })
  const body = result.outputFiles[0].text.trimEnd()
  const indented = body
    .split('\n')
    .map((line) => (line.length > 0 ? `    ${line}` : line))
    .join('\n')
  const wrapped = [
    '// 由 scripts/build-client.mjs 生成，请勿手改；源码见 chart-ui/client.src.cjs。',
    'window.__ModuleLoader__.load({',
    `  id: '${manifest.name}',`,
    '  factory: (require) => {',
    '    var module = { exports: {} }',
    '    var exports = module.exports',
    "    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })",
    indented,
    '    return module.exports',
    '  },',
    '})',
    '',
  ].join('\n')
  writeFileSync(join(CHART_UI, 'client.js'), wrapped)
  console.log(`build-client: 已生成 chart-ui/client.js（${wrapped.length} 字符）`)
} finally {
  rmSync(GENERATED_RUNTIME, { force: true })
}
