import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { PythonRuntimeManager } from '../lib/python-runtime/manager.js'
import { detectPlatform } from '../lib/python-runtime/platform.js'

const PACKAGE = '@test/cg-py-base-linux-x64'
const PARQUET = '@test/cg-py-parquet-linux-x64'
const VERSIONS = { numpy: '2.4.6', pandas: '3.0.6', 'python-dateutil': '2.9.0.post0', six: '1.17.0', tzdata: '2026.6' }

function manifest(cacheRoot) {
  return {
    schemaVersion: 1,
    python: '3.13.17',
    cacheRoot,
    packs: {
      base: {
        kind: 'base',
        packages: { ...VERSIONS },
        targets: { 'linux-x64': { package: PACKAGE, version: '1.0.0', bytes: 10 } },
      },
      parquet: {
        kind: 'lib',
        requires: { base: '1.0.0' },
        packages: { pyarrow: '25.0.1' },
        targets: { 'linux-x64': { package: PARQUET, version: '1.0.0', bytes: 10 } },
      },
    },
    limits: { minFreeBytes: 1, installTimeoutMs: 10_000, probeTimeoutMs: 5_000 },
  }
}

async function fakePnpm(invocation, args) {
  const index = args.indexOf('--dir')
  const installDir = args[index + 1]
  const project = JSON.parse(await readFile(join(installDir, 'package.json'), 'utf8'))
  const packageName = Object.keys(project.dependencies)[0]
  const packageDir = join(installDir, 'node_modules', ...packageName.split('/'))
  await mkdir(join(packageDir, 'site-packages'), { recursive: true })
  await mkdir(join(packageDir, 'python', 'bin'), { recursive: true })
  await writeFile(join(packageDir, 'python', 'bin', 'python3.13'), '#!/bin/sh\n')
  await writeFile(join(packageDir, 'runtime-pack.json'), JSON.stringify({
    schemaVersion: 1,
    kind: packageName === PACKAGE ? 'base' : 'lib',
    platform: 'linux',
    arch: 'x64',
    pythonVersion: '3.13.17',
    executable: packageName === PACKAGE ? 'python/bin/python3.13' : null,
    sitePackages: ['site-packages'],
    packages: packageName === PACKAGE ? VERSIONS : { pyarrow: '25.0.1' },
  }))
  return { code: 0, output: 'ok', timedOut: false, aborted: false }
}

async function fakeProbe(options) {
  return {
    pythonVersion: '3.13.17',
    executable: options.python,
    platform: 'linux',
    arch: 'x86_64',
    sitePackages: options.sitePackages,
    packages: { ...VERSIONS, pyarrow: '25.0.1' },
  }
}

function assertDone(job) {
  assert.equal(job.state, 'done', `${job.error?.code ?? job.state}: ${job.error?.message ?? job.message}`)
}

async function makeManager(overrides = {}) {
  const home = await mkdtemp(join(tmpdir(), 'cg-runtime-'))
  const manager = new PythonRuntimeManager({
    manifest: manifest('cache/test/python-runtime'),
    dshHome: home,
    workerPath: '/tmp/worker.py',
    target: detectPlatform({ platform: 'linux', arch: 'x64', release: '6.8.0', glibc: '2.31' }),
    // CI has no pnpm; the injected runPnpm ignores the invocation, but getPnpm() must not throw.
    packageManager: { command: process.execPath, args: ['/tmp/cg-fake-pnpm.cjs'] },
    runPnpm: fakePnpm,
    probePython: fakeProbe,
    ...overrides,
  })
  return { manager, home }
}

test('manager: prepare -> ready -> resolve, then remove', async () => {
  const { manager } = await makeManager()
  const job = manager.prepare(['base'])
  const finished = await manager.waitForJob(job.id)
  assertDone(finished)
  const status = await manager.status()
  assert.equal(status.base.state, 'ready')
  assert.equal(status.parquet.state, 'not-installed')
  const handle = await manager.resolve(['base'])
  assert.equal(handle.pythonVersion, '3.13.17')
  assert.deepEqual(handle.packages.numpy, '2.4.6')
  assert.deepEqual(handle.packs, { base: '1.0.0' })
  assert.ok(handle.python.endsWith('payload/python/bin/python3.13'))
  await manager.remove('base')
  assert.equal((await manager.status()).base.state, 'not-installed')
})

test('manager: parquet requires base and resolves both site-packages', async () => {
  const { manager } = await makeManager()
  const job = manager.prepare(['parquet'])
  assert.deepEqual(job.packs, ['base', 'parquet'])
  const finished = await manager.waitForJob(job.id)
  assertDone(finished)
  const status = await manager.status()
  assert.equal(status.base.state, 'ready')
  assert.equal(status.parquet.state, 'ready')
  const handle = await manager.resolve(['base', 'parquet'])
  assert.equal(handle.sitePackages.length, 2)
  assert.ok(handle.packs.parquet === '1.0.0')
  const probe = await manager.verify(['parquet'])
  assert.equal(probe.sitePackages.length, 2)
  assert.equal(probe.packages.pyarrow, '25.0.1')
})

test('manager: concurrent prepare joins the same job', async () => {
  const { manager } = await makeManager({
    runPnpm: async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 80))
      return fakePnpm(...args)
    },
  })
  const first = manager.prepare(['base'])
  const second = manager.prepare(['base'])
  assert.equal(first.id, second.id)
  await manager.waitForJob(first.id)
  assert.equal((await manager.status()).base.state, 'ready')
})

test('manager: local tarball sources become file:// URLs, not Windows-brittle file: paths', async () => {
  let dependency = ''
  const { manager } = await makeManager({
    packSources: { base: '/tmp/fake-pack.tgz' },
    runPnpm: async (...args) => {
      const installDir = args[1][args[1].indexOf('--dir') + 1]
      const project = JSON.parse(await readFile(join(installDir, 'package.json'), 'utf8'))
      dependency = Object.values(project.dependencies)[0]
      return fakePnpm(...args)
    },
  })
  const job = manager.prepare(['base'])
  await manager.waitForJob(job.id)
  assert.match(dependency, /^file:\/\/\//, '本地 tarball 必须用 file:// URL，Windows 的 file:C:\\... 不可靠')
  assert.match(dependency, /fake-pack\.tgz$/)
})

test('manager: unsupported platform refuses before touching the cache', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cg-runtime-'))
  const manager = new PythonRuntimeManager({
    manifest: manifest('cache/test/python-runtime'),
    dshHome: home,
    workerPath: '/tmp/worker.py',
    target: detectPlatform({ platform: 'linux', arch: 'x64', release: '6.8.0', glibc: '2.27' }),
    runPnpm: fakePnpm,
    probePython: fakeProbe,
  })
  assert.throws(() => manager.prepare(['base']), (error) => error.code === 'unsupported-platform')
})

test('manager: a missing payload file becomes broken and prepare repairs it', async () => {
  const { manager } = await makeManager()
  const first = manager.prepare(['base'])
  await manager.waitForJob(first.id)
  const status = await manager.status()
  const fs = await import('node:fs/promises')
  await fs.rm(join(status.base.path, 'payload', 'python', 'bin', 'python3.13'))
  const broken = await manager.status()
  assert.equal(broken.base.state, 'broken')
  await assert.rejects(() => manager.resolve(['base']), (error) => error.code === 'runtime-not-ready')
  const repair = manager.prepare(['base'])
  const repaired = await manager.waitForJob(repair.id)
  assert.equal(repaired.state, 'done')
  assert.equal((await manager.status()).base.state, 'ready')
})
