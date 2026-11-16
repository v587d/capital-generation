#!/usr/bin/env node
/**
 * End-to-end check for an installed runtime pack on the host that built it.
 *
 *   node runtime-build/verify-pack.mjs --dsh-home <dir> [--parquet]
 *
 * Resolves the prepared base/parquet packs, runs `python/worker.py run` once, and executes a real
 * pandas workflow (groupby, timezone conversion, optional Parquet round-trip). This is stricter
 * than `python-runtime.mjs verify`, which only imports libraries and reports versions.
 */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { PythonRuntimeManager } from '../lib/python-runtime/manager.js'
import { readManifest } from '../lib/python-runtime/manifest.js'
import { resolveDshHome } from '../lib/python-runtime/paths.js'
import { detectPlatform, killTree, pythonFlags, detachedChild } from '../lib/python-runtime/platform.js'
import { pythonChildEnv } from '../lib/python-runtime/child-env.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_LOG = 64 * 1024

function parseArgs(argv) {
  const options = { dshHome: '', parquet: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dsh-home') options.dshHome = argv[++index] ?? ''
    else if (arg === '--parquet') options.parquet = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown option: ${arg}`)
  }
  return options
}

const ANALYSIS = `import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

versions = {"numpy": np.__version__, "pandas": pd.__version__}
df = pd.DataFrame({"g": ["a", "a", "b"], "x": [1.0, 2.0, 3.0]})
assert df.groupby("g")["x"].sum().to_dict() == {"a": 3.0, "b": 3.0}, "groupby failed"
assert float(df["x"].mean()) == 2.0, "mean failed"

ts = pd.Timestamp("2026-01-01 00:00:00", tz="Asia/Shanghai")
assert ts.tz_convert("UTC").hour == 16, "timezone conversion failed"

if "--parquet" in sys.argv:
    import pyarrow
    Path("outputs").mkdir(exist_ok=True)
    target = Path("outputs/data.parquet")
    df.to_parquet(target, index=False)
    back = pd.read_parquet(target)
    assert list(back.columns) == ["g", "x"], "parquet columns changed"
    assert float(back["x"].sum()) == 6.0, "parquet round-trip failed"
    versions["pyarrow"] = pyarrow.__version__

Path("outputs").mkdir(exist_ok=True)
Path("outputs/verify.json").write_text(json.dumps(versions, ensure_ascii=False), encoding="utf-8")
print("verify-pack: analysis ok")
`

function appendBounded(previous, chunk) {
  const next = previous + chunk.toString('utf8')
  return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next
}

function runWorker({ python, worker, sitePackages, runDir }) {
  return new Promise((resolvePromise, reject) => {
    const args = [
      ...pythonFlags,
      worker,
      'run',
      '--run-dir', runDir,
      ...sitePackages.flatMap((path) => ['--site-packages', path]),
    ]
    const env = pythonChildEnv({
      pythonDir: dirname(python),
      homeDir: join(runDir, 'home'),
      tempDir: join(runDir, 'tmp'),
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const child = spawn(python, args, {
      cwd: runDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: detachedChild,
    })
    const timer = setTimeout(() => {
      timedOut = true
      void killTree(child.pid, child, 'SIGTERM')
      setTimeout(() => { void killTree(child.pid, child, 'SIGKILL') }, 2_000).unref?.()
    }, 180_000)
    timer.unref?.()
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr, timedOut })
    }
    child.stdout?.on('data', (chunk) => { stdout = appendBounded(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = appendBounded(stderr, chunk) })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`启动私有 Python 失败：${String(error)}`))
    })
    child.once('close', (code) => finish(code))
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help === true) {
    process.stdout.write('Usage: node runtime-build/verify-pack.mjs --dsh-home <dir> [--parquet]\n')
    return
  }
  const dshHome = resolveDshHome(options.dshHome === '' ? undefined : options.dshHome)
  const manifest = readManifest(join(ROOT, 'runtime', 'manifest.json'))
  const manager = new PythonRuntimeManager({
    manifest,
    dshHome,
    workerPath: join(ROOT, 'python', 'worker.py'),
    target: detectPlatform(),
  })
  const runDir = await mkdtemp(join(tmpdir(), 'cg-py-verify-'))
  try {
    const packs = options.parquet ? ['base', 'parquet'] : ['base']
    const handle = await manager.resolve(packs)
    await mkdir(join(runDir, 'outputs'), { recursive: true })
    await mkdir(join(runDir, 'home'), { recursive: true })
    await mkdir(join(runDir, 'tmp'), { recursive: true })
    await writeFile(join(runDir, 'analysis.py'), ANALYSIS, 'utf8')
    await writeFile(join(runDir, 'request.json'), JSON.stringify({
      script: 'analysis.py',
      args: options.parquet ? ['--parquet'] : [],
    }, null, 2), 'utf8')

    const result = await runWorker({
      python: handle.python,
      worker: join(ROOT, 'python', 'worker.py'),
      sitePackages: handle.sitePackages,
      runDir,
    })
    const report = await readFile(join(runDir, 'result.json'), 'utf8').catch(() => '')
    const parsed = report === '' ? undefined : JSON.parse(report)
    if (result.timedOut || result.code !== 0 || parsed?.ok !== true) {
      throw new Error([
        result.timedOut ? 'worker 超时' : `worker 退出码 ${String(result.code)}`,
        parsed?.error === undefined ? '' : `error: ${JSON.stringify(parsed.error)}`,
        result.stderr === '' ? '' : `stderr:\n${result.stderr}`,
        result.stdout === '' ? '' : `stdout:\n${result.stdout}`,
      ].filter(Boolean).join('\n'))
    }
    const versions = JSON.parse(await readFile(join(runDir, 'outputs', 'verify.json'), 'utf8'))
    process.stdout.write(`${JSON.stringify({
      ok: true,
      python: handle.pythonVersion,
      executable: handle.python,
      sitePackages: handle.sitePackages,
      packs: handle.packs,
      versions,
      sandbox: runDir,
    }, null, 2)}\n`)
  } finally {
    await manager.dispose()
    await rm(runDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch((error) => {
  process.stderr.write(`verify-pack: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
