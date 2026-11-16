#!/usr/bin/env node
/**
 * One-time bootstrap for brand-new runtime package names.
 *
 * npm Trusted Publishing can only be configured for a package that already exists. This script
 * publishes a tiny `0.0.0` placeholder under the `bootstrap` dist-tag for every runtime pack name
 * in `runtime/manifest.json`. It never touches `latest`, and the real `1.0.0` is still published
 * by `.github/workflows/python-runtime-packs.yml` with OIDC and provenance.
 *
 *   npm login
 *   node runtime-build/bootstrap-publish.mjs --dry-run
 *   node runtime-build/bootstrap-publish.mjs
 *
 * Run `npm trust github <name> --file python-runtime-packs.yml --repo ... --allow-publish`
 * for each package after this completes; see runtime-build/README.md.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { findNpmCli, targetParts } from './pack.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'runtime', 'manifest.json')
const VERSION = '0.0.0'
const TAG = 'bootstrap'
const REPOSITORY = 'git+https://github.com/v587d/capital-generation.git'

async function readManifest() {
  const { readFile } = await import('node:fs/promises')
  return JSON.parse(await readFile(MANIFEST, 'utf8'))
}

function packageNames(manifest) {
  const names = []
  for (const kind of ['base', 'parquet']) {
    for (const [target, spec] of Object.entries(manifest.packs[kind].targets)) {
      names.push({ kind, target, name: spec.package })
    }
  }
  return names.sort((left, right) => left.name.localeCompare(right.name))
}

function alreadyExists(npmCli, name) {
  const result = spawnSync(process.execPath, [npmCli, 'view', `${name}@${VERSION}`, 'version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return result.status === 0
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const manifest = await readManifest()
  const npmCli = findNpmCli()
  const packages = packageNames(manifest)
  if (packages.length !== 8) throw new Error(`预期 8 个运行时包，实际 ${packages.length}`)

  const staging = await mkdtemp(join(tmpdir(), 'cg-py-bootstrap-'))
  try {
    for (const item of packages) {
      if (alreadyExists(npmCli, item.name)) {
        console.log(`skip: ${item.name}@${VERSION} 已存在`)
        continue
      }
      const { platform, arch } = targetParts(item.target)
      const dir = join(staging, item.name.replace(/^@/u, '').replace(/\//gu, '__'))
      await mkdir(dir, { recursive: true })
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
      const args = [npmCli, 'publish', dir, '--access', 'public', '--tag', TAG]
      if (dryRun) {
        console.log(`dry-run: ${item.name}@${VERSION} (${TAG})`)
        continue
      }
      console.log(`publish: ${item.name}@${VERSION} (${TAG})`)
      execFileSync(process.execPath, args, { stdio: 'inherit', cwd: dir })
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`bootstrap-publish: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
