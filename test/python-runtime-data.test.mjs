import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { PythonRuntimeManager } from '../lib/python-runtime/manager.js'
import { detectPlatform } from '../lib/python-runtime/platform.js'

// `resolveDshHome` prefers $DSH_HOME over the `dshHome` option; isolate the fixture from the host cache.
delete process.env.DSH_HOME

const PACKAGE = '@test/cg-py-base-linux-x64'
const VERSIONS = { numpy: '2.4.6', pandas: '3.0.6', 'python-dateutil': '2.9.0.post0', six: '1.17.0', tzdata: '2026.6' }
const PYTHON = '3.13.17'
const SCRIPT_ID = 'baostock_valuation_history'
const SCRIPT_PATH = fileURLToPath(new URL('../python/scripts/baostock_valuation_history.py', import.meta.url))
const VENDOR_DIR = fileURLToPath(new URL('../python/vendor', import.meta.url))

function manifest(cacheRoot) {
  return {
    schemaVersion: 1,
    python: PYTHON,
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
        targets: { 'linux-x64': { package: '@test/cg-py-parquet-linux-x64', version: '1.0.0', bytes: 10 } },
      },
    },
    limits: { minFreeBytes: 1, installTimeoutMs: 10_000, probeTimeoutMs: 5_000 },
  }
}

async function fakePnpm(invocation, args) {
  const installDir = args[args.indexOf('--dir') + 1]
  const project = JSON.parse(await readFile(join(installDir, 'package.json'), 'utf8'))
  const packageName = Object.keys(project.dependencies)[0]
  const packageDir = join(installDir, 'node_modules', ...packageName.split('/'))
  await mkdir(join(packageDir, 'site-packages'), { recursive: true })
  await mkdir(join(packageDir, 'python', 'bin'), { recursive: true })
  await writeFile(join(packageDir, 'python', 'bin', 'python3.13'), '#!/bin/sh\n')
  await writeFile(join(packageDir, 'runtime-pack.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'base',
    platform: 'linux',
    arch: 'x64',
    pythonVersion: PYTHON,
    executable: 'python/bin/python3.13',
    sitePackages: ['site-packages'],
    packages: { ...VERSIONS },
  }))
  return { code: 0, output: 'ok', timedOut: false, aborted: false }
}

async function fakeProbe(options) {
  return {
    pythonVersion: PYTHON,
    executable: options.python,
    platform: 'linux',
    arch: 'x86_64',
    sitePackages: options.sitePackages,
    packages: { ...VERSIONS },
  }
}

/** A worker stand-in that speaks `python/worker.py run`'s protocol and records what the manager wrote. */
function fakeWorker(handler) {
  const calls = []
  const runner = async (options) => {
    const call = {
      options,
      runDir: options.cwd,
      files: await readdir(options.cwd),
      request: JSON.parse(await readFile(join(options.cwd, 'request.json'), 'utf8')),
      input: JSON.parse(await readFile(join(options.cwd, 'input.json'), 'utf8')),
      script: await readFile(join(options.cwd, 'baostock_valuation_history.py'), 'utf8'),
    }
    calls.push(call)
    return handler(call)
  }
  return { runner, calls }
}

async function makeManager(runWorkerProcess) {
  const home = await mkdtemp(join(tmpdir(), 'cg-runtime-data-'))
  const manager = new PythonRuntimeManager({
    manifest: manifest('cache/test/python-runtime'),
    dshHome: home,
    workerPath: '/tmp/worker.py',
    target: detectPlatform({ platform: 'linux', arch: 'x64', release: '6.8.0', glibc: '2.31' }),
    packageManager: { command: process.execPath, args: ['/tmp/cg-fake-pnpm.cjs'] },
    runPnpm: fakePnpm,
    probePython: fakeProbe,
    ...(runWorkerProcess === undefined ? {} : { runWorkerProcess }),
  })
  return manager
}

async function readyManager(runWorkerProcess) {
  const manager = await makeManager(runWorkerProcess)
  const job = manager.prepare(['base'])
  const finished = await manager.waitForJob(job.id)
  assert.equal(finished.state, 'done', finished.error?.message ?? finished.message)
  return manager
}

async function dataRunsLeftovers(manager) {
  const status = await manager.status()
  try {
    return await readdir(join(status.cacheRoot, 'data-runs'))
  } catch {
    return []
  }
}

test('runDataScript: writes request/input/fixed script into an isolated run dir and returns rows', async () => {
  const { runner, calls } = fakeWorker(async () => {
    await writeFile(join(calls.at(-1).runDir, 'result.json'), JSON.stringify({ ok: true, python: PYTHON, durationMs: 12 }))
    await writeFile(join(calls.at(-1).runDir, 'out.json'), JSON.stringify({ rows: [{ date: '2026-11-20' }] }))
    return { code: 0, stdout: '', stderr: '', timedOut: false, aborted: false }
  })
  const manager = await readyManager(runner)
  const result = await manager.runDataScript({ script: SCRIPT_ID, params: { code: 'sh.600519' } })
  assert.deepEqual(result.rows, [{ date: '2026-11-20' }])
  assert.equal(result.pythonVersion, PYTHON)
  assert.equal(result.durationMs, 12)

  const call = calls[0]
  assert.ok(call.runDir.includes(join('data-runs', `${SCRIPT_ID}-`)), `run dir 必须在 cacheRoot/data-runs 下：${call.runDir}`)
  // join() 而不是 'cache/test/…'：Windows 上 runDir 用反斜杠，字面量断言会让这条测试只在 Linux 绿。
  assert.ok(call.runDir.includes(join('cache', 'test', 'python-runtime')), 'run dir 必须落在 cacheRoot 的临时区')
  assert.deepEqual(call.request, { script: 'baostock_valuation_history.py', args: [] })
  assert.deepEqual(call.input, { code: 'sh.600519' })
  assert.equal(call.script, await readFile(SCRIPT_PATH, 'utf8'), '必须写入仓库自带的固定脚本，而不是模型内容')
  assert.equal(call.options.python.endsWith(join('payload', 'python', 'bin', 'python3.13')), true)
  const sites = call.options.args.flatMap((item, index) => (item === '--site-packages' ? [call.options.args[index + 1]] : []))
  assert.ok(sites.some((item) => item.endsWith(join('payload', 'site-packages'))), '必须传 base pack 的 site-packages')
  assert.ok(sites.includes(VENDOR_DIR), '必须传仓库 python/vendor 的绝对路径')
  assert.deepEqual(call.options.args.slice(-2), ['--run-dir', call.runDir])
  assert.ok(call.options.args.includes('run'), 'worker 子命令必须是 run')
  assert.equal(call.options.cwd, call.runDir)
  assert.equal(call.options.env.HOME, join(call.runDir, 'home'))
  assert.equal(call.options.env.TMPDIR, join(call.runDir, 'tmp'))
  assert.equal(call.options.timeoutMs, 5_000, '默认超时沿用 manifest.limits.probeTimeoutMs')
  assert.deepEqual(await dataRunsLeftovers(manager), [], 'run dir 用完必须清理')
})

test('runDataScript: base pack 未就绪时调用期失败，并指向插件设置里的分析环境', async () => {
  const { runner } = fakeWorker(async () => ({ code: 0, stdout: '', stderr: '', timedOut: false, aborted: false }))
  const manager = await makeManager(runner)
  await assert.rejects(
    () => manager.runDataScript({ script: SCRIPT_ID }),
    (error) => {
      assert.equal(error.code, 'data-runtime-not-ready')
      assert.match(error.message, /插件设置 → 分析环境/u)
      return true
    },
  )
  assert.deepEqual(await dataRunsLeftovers(manager), [], '未就绪时不应创建 run dir')
})

test('runDataScript: 只接受固定脚本名，拒绝路径与任意代码', async () => {
  const { runner, calls } = fakeWorker(async () => ({ code: 0, stdout: '', stderr: '', timedOut: false, aborted: false }))
  const manager = await readyManager(runner)
  for (const script of ['../evil', 'scripts/evil', 'evil.py', '', 'UPPER']) {
    await assert.rejects(() => manager.runDataScript({ script }), (error) => {
      assert.equal(error.code, 'invalid-request', `${script} 必须被拒绝`)
      return true
    })
  }
  await assert.rejects(() => manager.runDataScript({ script: 'no_such_script' }), (error) => {
    assert.equal(error.code, 'pack-invalid')
    assert.match(error.message, /固定数据脚本缺失/u)
    return true
  })
  assert.equal(calls.length, 0, '非法脚本名不得启动 Python')
})

test('runDataScript: 超时与取消映射到既有错误码，并带 stderr 尾部', async () => {
  let mode = 'timeout'
  const { runner } = fakeWorker(async () => (mode === 'timeout'
    ? { code: null, stdout: '', stderr: 'Traceback: slow script\n', timedOut: true, aborted: false }
    : { code: null, stdout: '', stderr: 'killed\n', timedOut: false, aborted: true }))
  const manager = await readyManager(runner)
  await assert.rejects(() => manager.runDataScript({ script: SCRIPT_ID, timeoutMs: 1_234 }), (error) => {
    assert.equal(error.code, 'timeout')
    assert.match(error.message, /超时/u)
    assert.match(error.diagnostics, /slow script/u)
    return true
  })
  mode = 'aborted'
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => manager.runDataScript({ script: SCRIPT_ID, signal: controller.signal }), (error) => error.code === 'cancelled')
  assert.deepEqual(await dataRunsLeftovers(manager), [])
})

test('runDataScript: 脚本非 0 退出时把 stderr 末行作为错误信息，traceback 进 diagnostics', async () => {
  const { runner } = fakeWorker(async (call) => {
    await writeFile(join(call.runDir, 'result.json'), JSON.stringify({
      ok: false,
      python: PYTHON,
      error: { code: 'SYSTEM_EXIT', message: 'analysis.py exited with 1', type: 'SystemExit', traceback: 'Traceback (most recent call last):\n  ...\nSystemExit: 1' },
    }))
    return { code: 1, stdout: '', stderr: 'baostock_valuation_history: baostock 登录失败: 10001001 网络不可用\n', timedOut: false, aborted: false }
  })
  const manager = await readyManager(runner)
  await assert.rejects(() => manager.runDataScript({ script: SCRIPT_ID }), (error) => {
    assert.equal(error.code, 'script-failed')
    assert.match(error.message, /登录失败/u)
    assert.match(error.diagnostics, /SystemExit: 1/u)
    return true
  })
  assert.deepEqual(await dataRunsLeftovers(manager), [])
})

test('runDataScript: result.json / out.json 缺失或格式不对时响亮失败', async () => {
  let mode = 'no-result'
  const { runner } = fakeWorker(async (call) => {
    if (mode === 'no-result') return { code: 1, stdout: '', stderr: 'crashed\n', timedOut: false, aborted: false }
    await writeFile(join(call.runDir, 'result.json'), JSON.stringify({ ok: true, python: PYTHON, durationMs: 1 }))
    if (mode === 'bad-out') await writeFile(join(call.runDir, 'out.json'), JSON.stringify({ rows: 'nope' }))
    return { code: 0, stdout: '', stderr: '', timedOut: false, aborted: false }
  })
  const manager = await readyManager(runner)
  await assert.rejects(() => manager.runDataScript({ script: SCRIPT_ID }), (error) => {
    assert.equal(error.code, 'script-failed')
    assert.match(error.message, /result\.json/u)
    return true
  })
  mode = 'no-out'
  await assert.rejects(() => manager.runDataScript({ script: SCRIPT_ID }), (error) => {
    assert.equal(error.code, 'script-failed')
    assert.match(error.message, /out\.json/u)
    return true
  })
  mode = 'bad-out'
  await assert.rejects(() => manager.runDataScript({ script: SCRIPT_ID }), (error) => error.code === 'script-failed')
  assert.deepEqual(await dataRunsLeftovers(manager), [])
})

test('runDataScript: 启动失败映射为 script-failed 带启动原因', async () => {
  const { runner } = fakeWorker(async () => ({ code: null, stdout: '', stderr: '', timedOut: false, aborted: false, spawnError: 'ENOENT python' }))
  const manager = await readyManager(runner)
  await assert.rejects(() => manager.runDataScript({ script: SCRIPT_ID }), (error) => {
    assert.equal(error.code, 'script-failed')
    assert.match(error.message, /启动 Python 失败/u)
    assert.match(error.message, /ENOENT/u)
    return true
  })
})

test('runDataScript: 非法 timeoutMs 在 create run dir 之前拒绝', async () => {
  const { runner, calls } = fakeWorker(async () => ({ code: 0, stdout: '', stderr: '', timedOut: false, aborted: false }))
  const manager = await readyManager(runner)
  await assert.rejects(() => manager.runDataScript({ script: SCRIPT_ID, timeoutMs: 0 }), (error) => error.code === 'invalid-request')
  assert.equal(calls.length, 0)
})
