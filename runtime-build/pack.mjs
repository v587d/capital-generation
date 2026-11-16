#!/usr/bin/env node
/**
 * Packer for the plugin-private Python runtime.
 *
 * Maintainer-only: takes a prepared interpreter tree and site-packages directory, adds the
 * npm package metadata, license texts and notices, checks that no symlink escapes the payload,
 * and runs `npm pack` once. Platform scripts in this directory only fetch/prune the interpreter
 * and call this file, so package names/versions come from `runtime/manifest.json` in one place.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = join(ROOT, 'runtime', 'manifest.json')
const LICENSES = {
  'numpy': 'BSD-3-Clause',
  'pandas': 'BSD-3-Clause',
  'python-dateutil': 'Apache-2.0 OR BSD-3-Clause',
  'six': 'MIT',
  'tzdata': 'Apache-2.0',
  'pyarrow': 'Apache-2.0',
}

const FILES = {
  base: ['python', 'site-packages', 'runtime-pack.json', 'THIRD_PARTY_NOTICES.md', 'licenses'],
  parquet: ['site-packages', 'runtime-pack.json', 'THIRD_PARTY_NOTICES.md', 'licenses'],
}

export function targetParts(target) {
  const index = target.lastIndexOf('-')
  if (index <= 0) throw new Error(`target 不合法：${target}`)
  return { platform: target.slice(0, index), arch: target.slice(index + 1) }
}

export function executableFor(target) {
  const { platform } = targetParts(target)
  if (platform === 'win32') return 'python/python.exe'
  return 'python/bin/python3.13'
}

export function packageJsonFor(manifest, kind, target, version) {
  const { platform, arch } = targetParts(target)
  const dependency = manifest.packs[kind]?.targets?.[target]
  if (dependency === undefined) throw new Error(`manifest 没有 ${kind}/${target}`)
  if (version !== dependency.version) {
    throw new Error(`${kind}/${target} 的版本是 ${dependency.version}，传入 ${version}`)
  }
  return {
    name: dependency.package,
    version,
    description: `Capital Generation private Python runtime (${kind}, ${target})`,
    license: 'SEE LICENSE IN THIRD_PARTY_NOTICES.md',
    os: [platform],
    cpu: [arch],
    ...(platform === 'linux' ? { libc: ['glibc'] } : {}),
    files: FILES[kind],
    publishConfig: { access: 'public' },
  }
}

export function runtimePackFor(manifest, kind, target) {
  const { platform, arch } = targetParts(target)
  return {
    schemaVersion: 1,
    kind: manifest.packs[kind].kind,
    platform,
    arch,
    pythonVersion: manifest.python,
    executable: kind === 'base' ? executableFor(target) : null,
    sitePackages: ['site-packages'],
    packages: { ...manifest.packs[kind].packages },
    ...(manifest.packs[kind].requires === undefined ? {} : { requires: { ...manifest.packs[kind].requires } }),
  }
}

function parseArgs(argv) {
  const options = {
    kind: '',
    target: '',
    out: '',
    pythonDir: '',
    siteDir: '',
    version: '',
    extraLicenses: [],
    keepStaging: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--kind') options.kind = argv[++index] ?? ''
    else if (arg === '--target') options.target = argv[++index] ?? ''
    else if (arg === '--out') options.out = argv[++index] ?? ''
    else if (arg === '--python-dir') options.pythonDir = argv[++index] ?? ''
    else if (arg === '--site-dir') options.siteDir = argv[++index] ?? ''
    else if (arg === '--version') options.version = argv[++index] ?? ''
    else if (arg === '--extra-license') options.extraLicenses.push(argv[++index] ?? '')
    else if (arg === '--keep-staging') options.keepStaging = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown option: ${arg}`)
  }
  return options
}

function usage() {
  return `Usage: node runtime-build/pack.mjs --kind base|parquet --target <target> --out <dir> \\
  [--python-dir <dir>] --site-dir <dir> [--version <version>] \\
  [--extra-license <label>=<path>] [--keep-staging]`
}

/** Reject absolute links and links whose real target leaves the pack root. */
export async function assertNoEscapingSymlinks(root) {
  const canonicalRoot = resolve(root)
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        let target
        try {
          target = await realpath(path)
        } catch {
          throw new Error(`运行时包里有断链：${relative(canonicalRoot, path)}`)
        }
        if (!isInside(canonicalRoot, target)) {
          throw new Error(`运行时包里的符号链接逃出 payload：${relative(canonicalRoot, path)} -> ${target}`)
        }
      } else if (entry.isDirectory()) {
        await walk(path)
      }
    }
  }
  await walk(canonicalRoot)
}

function isInside(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function copyLicenses(siteDir, licensesDir, extras) {
  await mkdir(licensesDir, { recursive: true })
  const entries = await readdir(siteDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith('.dist-info')) continue
    const packageName = entry.name.slice(0, entry.name.indexOf('-'))
    const distInfo = join(siteDir, entry.name)
    const files = await readdir(distInfo, { withFileTypes: true })
    for (const file of files) {
      if (file.isDirectory() && file.name === 'licenses') {
        await cp(join(distInfo, file.name), join(licensesDir, packageName), { recursive: true })
      } else if (file.isFile() && /^(?:LICEN[CS]E|COPYING|NOTICE)/iu.test(file.name)) {
        await mkdir(join(licensesDir, packageName), { recursive: true })
        await cp(join(distInfo, file.name), join(licensesDir, packageName, file.name))
      }
    }
  }
  for (const extra of extras) {
    const index = extra.indexOf('=')
    if (index <= 0) throw new Error(`--extra-license 必须是 label=path：${extra}`)
    const label = extra.slice(0, index)
    const source = resolve(extra.slice(index + 1))
    if (!existsSync(source)) throw new Error(`--extra-license 指向的文件不存在：${source}`)
    await mkdir(join(licensesDir, label), { recursive: true })
    await cp(source, join(licensesDir, label, source.split(/[\\/]/u).at(-1)))
  }
}

function noticesFor(manifest, kind, target, packageName) {
  const rows = Object.entries(manifest.packs[kind].packages)
    .map(([name, version]) => `| ${name} | ${version} | ${LICENSES[name] ?? '见 licenses/'} |`)
    .join('\n')
  const runtime = kind === 'base'
    ? [
      '| CPython | ' + manifest.python + ' | PSF-2.0 | <https://www.python.org/> |',
      '| python-build-standalone（macOS/Linux 构建来源；Windows 使用 python.org 官方 embeddable） | 20261021 | MPL-2.0 | <https://github.com/astral-sh/python-build-standalone> |',
    ].join('\n')
    : ''
  return `# Third-party notices — ${packageName}

This npm package is a Capital Generation Python runtime pack. It is installed on demand by the
\`capital-generation\` plugin into the DSH home cache; it is not a DSH plugin.

${runtime === '' ? '' : '## Runtime\n\n| Component | Version | License | Source |\n|---|---|---|---|\n' + runtime + '\n\n'}## Python packages

| Component | Version | License |
|---|---|---|
${rows}

Full license texts are under \`licenses/\`. CPython's license is also at \`licenses/CPython/\`.
Native libraries bundled inside the wheels keep their own licenses in the corresponding
\`licenses/\` subdirectories.
`
}

/** Resolve npm-cli.js without spawning the `npm` command name (a .cmd shim on Windows). */
export function findNpmCli(env = process.env) {
  if (env.CG_NPM_CLI !== undefined && env.CG_NPM_CLI !== '') {
    const cli = resolve(env.CG_NPM_CLI)
    if (!existsSync(cli)) throw new Error(`找不到 npm-cli.js：CG_NPM_CLI 指向的文件不存在（${cli}）`)
    return cli
  }
  const nodeDir = dirname(process.execPath)
  const candidates = [
    env.npm_execpath,
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(nodeDir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((item) => typeof item === 'string' && item !== '')
  for (const candidate of candidates) {
    if (candidate.endsWith('npm-cli.js') && existsSync(candidate)) return candidate
  }
  throw new Error('找不到 npm-cli.js；请设置 CG_NPM_CLI 指向 npm 的 bin/npm-cli.js')
}

async function removeGenerated(root) {
  await rm(join(root, '.lock'), { force: true })
  const walk = async (dir) => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__pycache__') await rm(path, { recursive: true, force: true })
        else await walk(path)
      } else if (entry.isFile() && (entry.name.endsWith('.pyc') || entry.name === '.gitignore' || entry.name === '.npmignore')) {
        // python-build-standalone ships python/.gitignore containing `*`, which makes npm skip the
        // whole interpreter tree. Runtime data does not need ignore files.
        await rm(path, { force: true })
      }
    }
  }
  await walk(root)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help === true) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  if (!['base', 'parquet'].includes(options.kind)) throw new Error(`--kind 必须是 base 或 parquet：${options.kind}`)
  if (options.target === '') throw new Error('--target is required')
  if (options.out === '') throw new Error('--out is required')
  if (options.siteDir === '') throw new Error('--site-dir is required')
  if (options.kind === 'base' && options.pythonDir === '') throw new Error('base pack needs --python-dir')

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  const targetSpec = manifest.packs[options.kind].targets[options.target]
  if (targetSpec === undefined) throw new Error(`manifest 没有 ${options.kind}/${options.target}`)
  const version = options.version === '' ? targetSpec.version : options.version
  const packageJson = packageJsonFor(manifest, options.kind, options.target, version)
  const runtimePack = runtimePackFor(manifest, options.kind, options.target)

  const out = resolve(options.out)
  const staging = join(out, `pkg-${options.kind}-${options.target}`)
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })

  if (options.kind === 'base') {
    await cp(resolve(options.pythonDir), join(staging, 'python'), { recursive: true, verbatimSymlinks: true })
    const executable = join(staging, runtimePack.executable)
    const info = await stat(executable)
    if (!info.isFile()) throw new Error(`解释器不是普通文件：${executable}`)
    if (targetParts(options.target).platform !== 'win32') {
      // npm packs the mode bits, and the installer also repairs it; keep both safe.
      await chmod(executable, 0o755)
    }
  }
  await cp(resolve(options.siteDir), join(staging, 'site-packages'), { recursive: true, verbatimSymlinks: true })
  await removeGenerated(staging)
  await copyLicenses(join(staging, 'site-packages'), join(staging, 'licenses'), options.extraLicenses)
  await writeFile(join(staging, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
  await writeFile(join(staging, 'runtime-pack.json'), `${JSON.stringify(runtimePack, null, 2)}\n`, 'utf8')
  await writeFile(join(staging, 'THIRD_PARTY_NOTICES.md'), noticesFor(manifest, options.kind, options.target, packageJson.name), 'utf8')
  await assertNoEscapingSymlinks(staging)

  const npmCli = findNpmCli()
  const output = execFileSync(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', out], {
    cwd: staging,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let packed
  try {
    packed = JSON.parse(output)
  } catch {
    throw new Error(`npm pack 输出不是 JSON：${output.slice(-2000)}`)
  }
  const result = packed[0]
  if (result === undefined) throw new Error('npm pack 没有返回结果')
  const tarball = join(out, result.filename)
  const digest = createHash('sha256').update(await readFile(tarball)).digest('hex')
  if (options.keepStaging !== true) await rm(staging, { recursive: true, force: true })
  process.stdout.write(`${JSON.stringify({
    package: packageJson.name,
    version,
    target: options.target,
    tarball,
    bytes: result.size,
    unpackedBytes: result.unpackedSize,
    files: result.entryCount,
    sha256: digest,
  }, null, 2)}\n`)
}

const invoked = process.argv[1] === undefined ? false : pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invoked) {
  main().catch((error) => {
    process.stderr.write(`pack: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
