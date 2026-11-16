import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { PythonRuntimeError } from './errors.js'
import type { PackName, ReadyFile, TargetId } from './types.js'

export function resolveDshHome(profileHome?: string): string {
  const env = process.env.DSH_HOME
  if (env !== undefined && env !== '') return resolve(env)
  if (profileHome !== undefined && profileHome !== '') return resolve(profileHome)
  return join(homedir(), '.dsh')
}

export function runtimeRoot(dshHome: string, cacheRoot: string): string {
  return join(dshHome, ...cacheRoot.split('/'))
}

export function packRoot(cacheRoot: string, pack: PackName, version: string, target: TargetId): string {
  return join(cacheRoot, pack, version, target)
}

export function readyPath(root: string): string {
  return join(root, 'ready.json')
}

export function payloadPath(root: string): string {
  return join(root, 'payload')
}

export function stagingRoot(cacheRoot: string): string {
  return join(cacheRoot, 'staging')
}

export function lockRoot(cacheRoot: string): string {
  return join(cacheRoot, 'locks')
}

export function storeRoot(cacheRoot: string): string {
  return join(cacheRoot, 'pnpm-store')
}

export function safeChild(root: string, ...parts: string[]): string {
  const target = resolve(root, ...parts)
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new PythonRuntimeError('pack-invalid', `路径逃出运行时目录：${parts.join('/')}`)
  }
  return target
}

export function safeRelative(root: string, relativePath: string): string {
  if (relativePath === '' || isAbsolute(relativePath)) {
    throw new PythonRuntimeError('pack-invalid', `运行时报文里的相对路径不合法：${relativePath}`)
  }
  const target = resolve(root, relativePath)
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new PythonRuntimeError('pack-invalid', `运行时报文里的路径逃出 payload：${relativePath}`)
  }
  return target
}

export function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function directoryBytes(path: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await directoryBytes(child)
    else if (entry.isFile()) {
      try {
        total += (await stat(child)).size
      } catch {
        // A file removed during the scan contributes nothing.
      }
    }
  }
  return total
}

export async function availableBytes(path: string): Promise<number | undefined> {
  try {
    const stats = await statfs(path)
    return stats.bavail * stats.bsize
  } catch {
    return undefined
  }
}

export async function removeStaleStaging(staging: string, maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  let entries
  try {
    entries = await readdir(staging, { withFileTypes: true })
  } catch {
    return
  }
  const now = Date.now()
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const target = join(staging, entry.name)
    try {
      const info = await stat(target)
      if (now - info.mtimeMs > maxAgeMs) await rm(target, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export function readyFileShape(value: unknown): value is ReadyFile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Record<string, unknown>
  return raw.schemaVersion === 1
    && typeof raw.pack === 'string'
    && typeof raw.packVersion === 'string'
    && typeof raw.target === 'string'
    && typeof raw.package === 'string'
    && typeof raw.pythonVersion === 'string'
    && (raw.python === null || typeof raw.python === 'string')
    && Array.isArray(raw.sitePackages)
    && raw.sitePackages.every((item) => typeof item === 'string')
    && raw.packages !== null
    && typeof raw.packages === 'object'
}

export function assertStablePath(path: string, label: string): void {
  if (!existsSync(path)) throw new PythonRuntimeError('pack-invalid', `${label} 不存在：${path}`)
}
