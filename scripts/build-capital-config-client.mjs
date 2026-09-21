#!/usr/bin/env node
import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIR = join(ROOT, 'capital-config')
const manifest = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'))
const result = await build({
  entryPoints: [join(DIR, 'client.src.cjs')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-primitives'],
  minify: true,
  legalComments: 'inline',
  write: false,
  logLevel: 'warning',
})
const body = result.outputFiles[0].text.trimEnd()
const indented = body.split('\n').map((line) => line.length > 0 ? `    ${line}` : line).join('\n')
const wrapped = [
  '// 由 scripts/build-capital-config-client.mjs 生成，请勿手改；源码见 capital-config/client.src.cjs。',
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
writeFileSync(join(DIR, 'client.js'), wrapped)
console.log(`build-capital-config-client: 已生成 capital-config/client.js（${wrapped.length} 字符）`)
