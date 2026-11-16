import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizePackNames, parseManifest, readManifest } from '../lib/python-runtime/manifest.js'
import { PythonRuntimeError } from '../lib/python-runtime/errors.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

test('runtime manifest: locked versions and all four primary targets', () => {
  const manifest = readManifest(join(ROOT, 'runtime', 'manifest.json'))
  assert.equal(manifest.python, '3.13.17')
  assert.deepEqual(manifest.packs.base.packages, {
    numpy: '2.4.6',
    pandas: '3.0.6',
    'python-dateutil': '2.9.0.post0',
    six: '1.17.0',
    tzdata: '2026.6',
  })
  assert.deepEqual(manifest.packs.parquet.packages, { pyarrow: '25.0.1' })
  assert.deepEqual(Object.keys(manifest.packs.base.targets).sort(), ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'])
  assert.deepEqual(manifest.packs.parquet.requires, { base: '1.0.0' })
})

test('runtime manifest: malformed values fail loudly instead of becoming empty defaults', () => {
  const base = JSON.parse(readFileSync(join(ROOT, 'runtime', 'manifest.json'), 'utf8'))
  assert.throws(() => parseManifest({ ...base, python: '3.13' }), (error) => error instanceof PythonRuntimeError && error.code === 'manifest-invalid')
  assert.throws(() => parseManifest({ ...base, packs: { ...base.packs, base: { ...base.packs.base, packages: {} } } }), (error) => error instanceof PythonRuntimeError && error.code === 'manifest-invalid')
  assert.throws(() => parseManifest({ ...base, cacheRoot: '../escape' }), (error) => error instanceof PythonRuntimeError && error.code === 'manifest-invalid')
})

test('runtime manifest: parquet implies base and duplicates collapse', () => {
  assert.deepEqual(normalizePackNames(['parquet']), ['base', 'parquet'])
  assert.deepEqual(normalizePackNames(['base', 'base']), ['base'])
  assert.deepEqual(normalizePackNames(['parquet', 'base']), ['base', 'parquet'])
  assert.throws(() => normalizePackNames(['unknown']), /未知 pack/)
})
