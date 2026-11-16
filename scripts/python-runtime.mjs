#!/usr/bin/env node
/**
 * Headless entry point for the plugin-owned Python runtime.
 * Run `npm run build` first; this script imports the compiled lib/ modules.
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PythonRuntimeManager } from '../lib/python-runtime/manager.js'
import { normalizePackNames, readManifest } from '../lib/python-runtime/manifest.js'
import { detectPlatform } from '../lib/python-runtime/platform.js'
import { resolveDshHome } from '../lib/python-runtime/paths.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const USAGE = `Usage:
  python-runtime status [--json]
  python-runtime prepare [--pack base|parquet] [--tarball <pack.tgz>] [--json]
  python-runtime verify [--pack base|parquet] [--json]
  python-runtime remove --pack base|parquet --yes
  python-runtime import <pack.tgz> --pack base|parquet [--json]

Options:
  --dsh-home <dir>   Override DSH home (default: $DSH_HOME or ~/.dsh)
  --pnpm-cli <file>  Absolute path to pnpm.cjs
  --registry <url>   Registry for runtime pack installs
`

function parse(argv) {
  const flags = { json: false, yes: false, pack: 'base', tarball: '', dshHome: '', pnpmCli: '', registry: '', args: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') flags.json = true
    else if (arg === '--yes') flags.yes = true
    else if (arg === '--pack') flags.pack = argv[++index] ?? ''
    else if (arg === '--tarball') flags.tarball = argv[++index] ?? ''
    else if (arg === '--dsh-home') flags.dshHome = argv[++index] ?? ''
    else if (arg === '--pnpm-cli') flags.pnpmCli = argv[++index] ?? ''
    else if (arg === '--registry') flags.registry = argv[++index] ?? ''
    else if (arg === '--help' || arg === '-h') flags.help = true
    else if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`)
    else flags.args.push(arg)
  }
  return flags
}

function print(value, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
    return
  }
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`)
}

function humanStatus(status) {
  const lines = [
    `platform: ${status.platform} ${status.arch}`,
    `target: ${status.target ?? 'unsupported'}`,
    `python: ${status.python}`,
    `cache: ${status.cacheRoot}`,
    `base: ${status.base.state}${status.base.installedAt === undefined ? '' : ` (${status.base.installedAt})`}`,
    `parquet: ${status.parquet.state}`,
  ]
  if (status.reason !== undefined) lines.push(`reason: ${status.reason}`)
  if (status.base.error !== undefined) lines.push(`base-error: ${status.base.error}`)
  if (status.activeJob !== undefined) lines.push(`job: ${status.activeJob.id} ${status.activeJob.stage} ${status.activeJob.message}`)
  return lines.join('\n')
}

async function main() {
  const flags = parse(process.argv.slice(2))
  if (flags.help === true || flags.args.length === 0) {
    process.stdout.write(USAGE)
    return
  }
  const command = flags.args[0]
  const manifest = readManifest(join(ROOT, 'runtime', 'manifest.json'))
  const target = detectPlatform()
  const packSources = {}
  if (flags.tarball !== '') packSources[flags.pack] = resolve(flags.tarball)
  if (command === 'import') {
    const file = flags.args[1]
    if (file === undefined) throw new Error('import needs a .tgz path')
    packSources[flags.pack] = resolve(file)
  }
  const manager = new PythonRuntimeManager({
    manifest,
    dshHome: resolveDshHome(flags.dshHome === '' ? undefined : flags.dshHome),
    workerPath: join(ROOT, 'python', 'worker.py'),
    target,
    ...(flags.pnpmCli === '' ? {} : { packageManager: { command: process.execPath, args: [resolve(flags.pnpmCli)] } }),
    ...(flags.registry === '' ? {} : { registry: flags.registry }),
    packSources,
  })

  try {
    if (command === 'status') {
      const status = await manager.status()
      print(flags.json ? status : humanStatus(status), flags.json)
      return
    }
    if (command === 'prepare' || command === 'import') {
      if (command === 'import' && flags.pack === 'parquet') {
        const status = await manager.status()
        if (status.base.state !== 'ready') throw new Error('安装 parquet 前必须先安装 base。')
      }
      const packs = command === 'import' ? [flags.pack] : normalizePackNames([flags.pack])
      const job = manager.prepare(packs)
      if (!flags.json) process.stdout.write(`job ${job.id}: ${job.message}\n`)
      const finished = await manager.waitForJob(job.id)
      if (flags.json) {
        print({ job: finished, status: await manager.status() }, true)
      } else {
        print(finished.state === 'done' ? '分析环境已就绪。' : `准备失败：${finished.error?.code ?? finished.state} ${finished.error?.message ?? ''}`)
        print(humanStatus(await manager.status()), false)
      }
      if (finished.state !== 'done') process.exitCode = 1
      return
    }
    if (command === 'verify') {
      const probe = await manager.verify([flags.pack])
      print(flags.json ? probe : JSON.stringify(probe, null, 2), flags.json)
      return
    }
    if (command === 'remove') {
      if (!flags.yes) throw new Error('remove requires --yes')
      await manager.remove(flags.pack)
      print({ removed: flags.pack }, flags.json)
      return
    }
    throw new Error(`unknown command: ${command}`)
  } finally {
    await manager.dispose()
  }
}

main().catch((error) => {
  process.stderr.write(`python-runtime: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
