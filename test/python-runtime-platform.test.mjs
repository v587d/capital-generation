import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { detectPlatform, findPnpmCli, pathDirs } from '../lib/python-runtime/platform.js'

test('platform: Windows x64 build gate and ARM64 refusal', () => {
  assert.deepEqual(detectPlatform({ platform: 'win32', arch: 'x64', release: '10.0.22631' }), {
    platform: 'win32', arch: 'x64', target: 'win32-x64', supported: true,
  })
  assert.equal(detectPlatform({ platform: 'win32', arch: 'x64', release: '10.0.10240' }).supported, false)
  assert.equal(detectPlatform({ platform: 'win32', arch: 'arm64', release: '10.0.22631' }).supported, false)
})

test('platform: macOS 12 is the pyarrow wheel floor', () => {
  assert.equal(detectPlatform({ platform: 'darwin', arch: 'arm64', release: '21.6.0' }).target, 'darwin-arm64')
  assert.equal(detectPlatform({ platform: 'darwin', arch: 'x64', release: '21.6.0' }).target, 'darwin-x64')
  assert.equal(detectPlatform({ platform: 'darwin', arch: 'arm64', release: '20.6.0' }).supported, false)
})

test('platform: Linux glibc 2.28 gate rejects musl and older glibc', () => {
  assert.equal(detectPlatform({ platform: 'linux', arch: 'x64', release: '6.8.0', glibc: '2.28' }).target, 'linux-x64')
  assert.equal(detectPlatform({ platform: 'linux', arch: 'x64', release: '6.8.0', glibc: '2.27' }).supported, false)
  assert.equal(detectPlatform({ platform: 'linux', arch: 'x64', release: '6.8.0', glibc: '' }).supported, false)
  assert.equal(detectPlatform({ platform: 'linux', arch: 'arm64', release: '6.8.0', glibc: '2.31' }).supported, false)
})

test('platform: PATH uses the host delimiter and pnpm resolves to a Node CLI', async () => {
  assert.deepEqual(pathDirs({ PATH: ['/a', '/b'].join(process.platform === 'win32' ? ';' : ':') }), ['/a', '/b'])
  const dir = await mkdtemp(join(tmpdir(), 'cg-pnpm-'))
  const cli = join(dir, 'pnpm.cjs')
  await writeFile(cli, '#!/usr/bin/env node\n')
  const found = findPnpmCli({ PATH: dir, CG_PNPM_CLI: cli })
  assert.equal(found.command, process.execPath)
  assert.deepEqual(found.args, [cli])
})
