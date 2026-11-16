import { readFileSync } from 'node:fs'

import { PythonRuntimeError } from './errors.js'
import { PACK_NAMES, TARGET_IDS, type PackManifest, type PackName, type PackTarget, type RuntimeManifest, type TargetId } from './types.js'

const VERSION = /^\d+(?:\.\d+)+(?:[.\-+][A-Za-z0-9._-]+)*$/u
const PYTHON_VERSION = /^\d+\.\d+\.\d+(?:[.\-+][A-Za-z0-9._-]+)*$/u
const PACKAGE = /^@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/u

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PythonRuntimeError('manifest-invalid', `${label} 必须是对象。`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new PythonRuntimeError('manifest-invalid', `${label} 必须是非空字符串。`)
  }
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new PythonRuntimeError('manifest-invalid', `${label} 必须是正整数。`)
  }
  return value
}

function version(value: unknown, label: string): string {
  const text = string(value, label)
  if (!VERSION.test(text)) throw new PythonRuntimeError('manifest-invalid', `${label} 不是合法版本：${text}`)
  return text
}

function packageName(value: unknown, label: string): string {
  const text = string(value, label)
  if (!PACKAGE.test(text)) throw new PythonRuntimeError('manifest-invalid', `${label} 不是合法包名：${text}`)
  return text
}

function targetId(value: string): TargetId {
  if (!(TARGET_IDS as readonly string[]).includes(value)) {
    throw new PythonRuntimeError('manifest-invalid', `未知 target：${value}`)
  }
  return value as TargetId
}

function packName(value: string): PackName {
  if (!(PACK_NAMES as readonly string[]).includes(value)) {
    throw new PythonRuntimeError('manifest-invalid', `未知 pack：${value}`)
  }
  return value as PackName
}

function parsePack(name: PackName, value: unknown): PackManifest {
  const raw = record(value, `packs.${name}`)
  const kind = raw.kind
  if (kind !== 'base' && kind !== 'lib') throw new PythonRuntimeError('manifest-invalid', `packs.${name}.kind 必须是 base 或 lib。`)
  if (name === 'base' && kind !== 'base') throw new PythonRuntimeError('manifest-invalid', 'base pack 的 kind 必须是 base。')
  if (name !== 'base' && kind !== 'lib') throw new PythonRuntimeError('manifest-invalid', `${name} pack 的 kind 必须是 lib。`)

  const packagesRaw = record(raw.packages, `packs.${name}.packages`)
  const packages: Record<string, string> = {}
  for (const [packageKey, packageVersion] of Object.entries(packagesRaw)) {
    packages[packageKey] = version(packageVersion, `packs.${name}.packages.${packageKey}`)
  }
  if (Object.keys(packages).length === 0) throw new PythonRuntimeError('manifest-invalid', `packs.${name}.packages 不能为空。`)

  const targetsRaw = record(raw.targets, `packs.${name}.targets`)
  const targets: Partial<Record<TargetId, PackTarget>> = {}
  for (const [key, targetValue] of Object.entries(targetsRaw)) {
    const id = targetId(key)
    const target = record(targetValue, `packs.${name}.targets.${key}`)
    targets[id] = {
      package: packageName(target.package, `packs.${name}.targets.${key}.package`),
      version: version(target.version, `packs.${name}.targets.${key}.version`),
      bytes: positiveInteger(target.bytes, `packs.${name}.targets.${key}.bytes`),
      ...(target.sha256 === undefined ? {} : { sha256: string(target.sha256, `packs.${name}.targets.${key}.sha256`) }),
    }
  }
  if (Object.keys(targets).length === 0) throw new PythonRuntimeError('manifest-invalid', `packs.${name}.targets 不能为空。`)

  let requires: Partial<Record<PackName, string>> | undefined
  if (raw.requires !== undefined) {
    const required = record(raw.requires, `packs.${name}.requires`)
    requires = {}
    for (const [key, requiredVersion] of Object.entries(required)) {
      requires[packName(key)] = version(requiredVersion, `packs.${name}.requires.${key}`)
    }
  }

  return { kind, packages, targets, ...(requires === undefined ? {} : { requires }) }
}

export function parseManifest(value: unknown): RuntimeManifest {
  const raw = record(value, 'manifest')
  if (raw.schemaVersion !== 1) throw new PythonRuntimeError('manifest-invalid', 'manifest.schemaVersion 必须是 1。')
  const python = version(raw.python, 'python')
  if (!PYTHON_VERSION.test(python)) throw new PythonRuntimeError('manifest-invalid', `python 必须是三段式版本：${python}`)
  const cacheRoot = string(raw.cacheRoot, 'cacheRoot')
  if (cacheRoot.startsWith('/') || cacheRoot.includes('..') || cacheRoot.includes('\\')) {
    throw new PythonRuntimeError('manifest-invalid', 'cacheRoot 必须是 DSH home 下的相对 POSIX 路径。')
  }
  const packsRaw = record(raw.packs, 'packs')
  const packs = {
    base: parsePack('base', packsRaw.base),
    parquet: parsePack('parquet', packsRaw.parquet),
  }
  const limitsRaw = record(raw.limits, 'limits')
  return {
    schemaVersion: 1,
    python,
    cacheRoot,
    packs,
    limits: {
      minFreeBytes: positiveInteger(limitsRaw.minFreeBytes, 'limits.minFreeBytes'),
      installTimeoutMs: positiveInteger(limitsRaw.installTimeoutMs, 'limits.installTimeoutMs'),
      probeTimeoutMs: positiveInteger(limitsRaw.probeTimeoutMs, 'limits.probeTimeoutMs'),
    },
  }
}

export function readManifest(path: string): RuntimeManifest {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new PythonRuntimeError('manifest-invalid', `读不到 runtime manifest：${path}`, String(error))
  }
  try {
    return parseManifest(JSON.parse(text))
  } catch (error) {
    if (error instanceof PythonRuntimeError) throw error
    throw new PythonRuntimeError('manifest-invalid', `runtime manifest 不是合法 JSON：${path}`, String(error))
  }
}

export function packTarget(manifest: RuntimeManifest, pack: PackName, target: TargetId): PackTarget {
  const found = manifest.packs[pack].targets[target]
  if (found === undefined) {
    throw new PythonRuntimeError('unsupported-platform', `${pack} 没有 ${target} 的运行时包。`)
  }
  return found
}

export function normalizePackNames(value: unknown): PackName[] {
  if (value === undefined) return ['base']
  if (!Array.isArray(value) || value.length === 0) {
    throw new PythonRuntimeError('invalid-request', 'packs 必须是非空数组。')
  }
  const names: PackName[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !(PACK_NAMES as readonly string[]).includes(item)) {
      throw new PythonRuntimeError('invalid-request', `未知 pack：${String(item)}（只能是 ${PACK_NAMES.join(' 或 ')}）。`)
    }
    const name = item as PackName
    if (!names.includes(name)) names.push(name)
  }
  if (names.includes('parquet')) return ['base', ...names.filter((name) => name !== 'base')]
  return names
}
