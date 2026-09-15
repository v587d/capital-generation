#!/usr/bin/env node
/**
 * 把 `chart-ui/client.src.cjs` 打成客户端模块表 bundle：`chart-ui/client.js`。
 *
 * 为什么需要一个构建步骤（而不是手写 client.js）：
 *  - 设计（docs/design/chart-visualization.md §9）要求客户端**不产生页面全局**，
 *    所以 lightweight-charts 不能走 UMD 全局，必须是打包进来的 ESM 模块（tree-shake 后）。
 *  - 运行时（src/chart/runtime.ts）以**字符串**形式与自包含 HTML 同源；这里把它落成一个
 *    真实的临时模块（而不是在浏览器里 `eval`），既避免 CSP 风险，也保持两边同源。
 *
 * 产物形状与 shipped 客户端一致：`window.__ModuleLoader__.load({ id, factory })`，
 * 工厂是 CommonJS，`react` 保持 external 由 `require` 提供。
 *
 * 用法：node scripts/build-client.mjs（`npm run build` / `npm run build:client` 会调用）
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

// 运行时 IIFE 返回 API 对象、不挂全局，所以这里直接把它赋给模块导出即可。
writeFileSync(GENERATED_RUNTIME, `'use strict'\nexports.__capitalChart = ${CHART_RUNTIME_SOURCE}\n`)

try {
  const result = await build({
    entryPoints: [join(CHART_UI, 'client.src.cjs')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: ['es2020'],
    // lightweight-charts 只有 ESM 入口（exports 里没有 require 条件），
    // 这里补上 import 条件让它按 ESM 解析，再由 esbuild 打包成 CJS。
    conditions: ['import'],
    // shell 静态种子：保持 external，由客户端模块表的 require 提供，避免打进第二份 react。
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
