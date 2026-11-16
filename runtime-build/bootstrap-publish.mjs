#!/usr/bin/env node
/**
 * One-time bootstrap for brand-new runtime package names.
 *
 * npm Trusted Publishing can only be configured for a package that already exists. This script
 * publishes a tiny `0.0.0` placeholder under the `bootstrap` dist-tag for every runtime pack name
 * in `runtime/manifest.json`, then (with --trust) configures the GitHub Actions trusted publisher.
 * It never touches `latest`; the real `1.0.0` is still published by
 * `.github/workflows/python-runtime-packs.yml` with OIDC and provenance.
 *
 *   npm login
 *   node runtime-build/bootstrap-publish.mjs --dry-run --trust
 *   node runtime-build/bootstrap-publish.mjs --trust
 *
 * Both phases prompt for the account's 2FA code; run this in your own terminal, not CI.
 * The script is resumable: an already-published placeholder or existing trust record is skipped.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { findNpmCli, targetParts } from './pack.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'runtime', 'manifest.json')
const VERSION = '0.0.0'
const TAG = 'bootstrap'
const REPOSITORY = 'git+https://github.com/v587d/capital-generation.git'

function packageNames(manifest) {
  const names = []
  for (const kind of ['base', 'parquet']) {
    for (const [target, spec] of Object.entries(manifest.packs[kind].targets)) {
      names.push({ kind, target, name: spec.package })
    }
  }
  return names.sort((left, right) => left.name.localeCompare(right.name))
}

function npmView(npmCli, name) {
  return spawnSync(process.execPath, [npmCli, 'view', `${name}@${VERSION}`, 'version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).status === 0
}

/** Run npm with inherited stdin (2FA prompts) but captured output for idempotency checks. */
function npm(npmCli, args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [npmCli, ...args], {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: process.env,
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8')
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8')
      process.stderr.write(chunk)
    })
    child.once('error', (error) => resolvePromise({ code: -1, output: String(error) }))
    child.once('close', (code) => resolvePromise({ code, output }))
  })
}

function isAlreadyThere(code, output) {
  return code !== 0 && /(?:E409|previously published|already exists|conflict)/iu.test(output)
}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

/** A successful publish is a 202; registry metadata can take minutes to appear. */
async function waitForPackages(npmCli, names) {
  const deadline = Date.now() + 10 * 60 * 1000
  let unseen = new Set(names)
  while (unseen.size > 0 && Date.now() < deadline) {
    console.log(`waiting for registry metadata: ${[...unseen].join(', ')} (publish returns 202 before it is readable)`)
    await sleep(5_000)
    unseen = new Set([...unseen].filter((name) => !npmView(npmCli, name)))
  }
  return unseen.size === 0
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const withTrust = process.argv.includes('--trust')
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
  const npmCli = findNpmCli()
  const packages = packageNames(manifest)
  if (packages.length !== 8) throw new Error(`预期 8 个运行时包，实际 ${packages.length}`)

  const staging = await mkdtemp(join(tmpdir(), 'cg-py-bootstrap-'))
  const dirFor = (item) => join(staging, item.name.replace(/^@/u, '').replace(/\//gu, '__'))
  try {
    // Phase 1: publish all placeholders. They are independent, so do not wait between them.
    for (const item of packages) {
      const { platform, arch } = targetParts(item.target)
      const dir = dirFor(item)
      await mkdir(dir, { recursive: true })

      if (npmView(npmCli, item.name)) {
        console.log(`skip publish: ${item.name}@${VERSION} 已存在`)
      } else {
        await writeFile(join(dir, 'package.json'), `${JSON.stringify({
          name: item.name,
          version: VERSION,
          description: `Bootstrap placeholder for the Capital Generation private Python runtime (${item.kind}, ${item.target}); the real pack is published from python-runtime-packs.yml via trusted publishing.`,
          license: 'MIT',
          repository: { type: 'git', url: REPOSITORY },
          homepage: 'https://github.com/v587d/capital-generation#readme',
          os: [platform],
          cpu: [arch],
          ...(platform === 'linux' ? { libc: ['glibc'] } : {}),
          files: [],
          publishConfig: { access: 'public' },
        }, null, 2)}\n`, 'utf8')
        await writeFile(join(dir, 'README.md'),
          'Bootstrap placeholder for npm Trusted Publishing. Do not install; the real runtime pack is published by the capital-generation workflow.\n', 'utf8')
        if (dryRun) {
          console.log(`dry-run publish: ${item.name}@${VERSION} (${TAG})`)
        } else {
          console.log(`publish: ${item.name}@${VERSION} (${TAG})`)
          const result = await npm(npmCli, ['publish', '.', '--access', 'public', '--tag', TAG], dir)
          if (isAlreadyThere(result.code, result.output)) {
            console.log(`skip publish: ${item.name}@${VERSION} 已存在`)
          } else if (result.code !== 0) {
            throw new Error(`publish 失败（${item.name}，exit ${result.code}）`)
          }
        }
      }
    }

    // Phase 2: one propagation wait for all names, then configure each trusted publisher.
    if (withTrust) {
      if (dryRun) {
        for (const item of packages) console.log(`dry-run trust: ${item.name}`)
      } else {
        if (!await waitForPackages(npmCli, packages.map((item) => item.name))) {
          throw new Error('registry 10 分钟内仍有包不可读；稍后重跑本脚本只补 trust')
        }
        for (const item of packages) {
          console.log(`trust: ${item.name} -> v587d/capital-generation / python-runtime-packs.yml`)
          const result = await npm(npmCli, [
            'trust', 'github', item.name,
            '--file', 'python-runtime-packs.yml',
            '--repo', 'v587d/capital-generation',
            '--allow-publish', '--yes',
          ], dirFor(item))
          if (isAlreadyThere(result.code, result.output)) {
            console.log(`skip trust: ${item.name} 已配置`)
          } else if (result.code !== 0) {
            throw new Error(`trust 失败（${item.name}，exit ${result.code}）`)
          }
        }
      }
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`bootstrap-publish: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
