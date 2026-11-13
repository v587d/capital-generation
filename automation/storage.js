/**
 * Workspace storage accounting and cache cleanup. `capital-data` is disposable
 * (datasets, derived profiles, OCR); `capital-analysis` is user-facing output and
 * stays read-only. Only direct children of `capital-data` are removed, never the
 * directory itself, and symlinks are never followed.
 */
import { lstat, readdir, realpath, rm, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { defaultWorkspaceTitle, workspaceDisplayPath } from './workspaces.js'

export const CACHE_DIR = 'capital-data'
export const RETAINED_DIR = 'capital-analysis'

const CACHE_GROUPS = [
  { id: 'datasets', name: 'datasets' },
  { id: 'profiles', name: 'profiles' },
  { id: 'ocr', name: 'ocr' },
]
const ANALYSIS_GROUPS = [
  { id: 'charts', name: 'charts' },
  { id: 'runs', name: 'runs' },
]
const OTHER_ID = 'other'
const MAX_SCAN_ENTRIES = 150_000
const MAX_SCAN_MS = 5_000
const STATS_TTL_MS = 15_000

const ZERO = Object.freeze({ bytes: 0, files: 0 })

export class StorageError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'StorageError'
    this.code = code
  }
}

function isMissing(error) {
  return error?.code === 'ENOENT'
}

function safeJoin(root, relativePath) {
  if (typeof root !== 'string' || root.length === 0 || !isAbsolute(root)) {
    throw new StorageError('workspace_unavailable', '工作区路径不可用。')
  }
  if (typeof relativePath !== 'string' || relativePath.length === 0 || isAbsolute(relativePath)) {
    throw new StorageError('workspace_unavailable', '缓存目录不可用。')
  }
  const base = resolve(root)
  const target = resolve(base, relativePath)
  const rel = relative(base, target)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new StorageError('workspace_unavailable', '缓存目录不在工作区内。')
  }
  return target
}

function scanState() {
  return { entries: 0, truncated: false, unreadable: 0, startedAt: Date.now() }
}

function overLimit(scan) {
  if (scan.truncated) return true
  scan.entries += 1
  if (scan.entries > MAX_SCAN_ENTRIES || Date.now() - scan.startedAt > MAX_SCAN_MS) {
    scan.truncated = true
    return true
  }
  return false
}

function add(target, value) {
  target.bytes += value.bytes
  target.files += value.files
}

/**
 * Sizes without following symlinks. Unreadable entries still count toward
 * `unreadable` but do not fail the whole panel; a capped scan reports `truncated`
 * while cleanup may still remove everything.
 */
async function measurePath(target, scan) {
  if (overLimit(scan)) return ZERO
  let metadata
  try {
    metadata = await lstat(target)
  } catch (error) {
    if (!isMissing(error)) scan.unreadable += 1
    return ZERO
  }
  if (metadata.isSymbolicLink()) return ZERO
  if (metadata.isFile()) return { bytes: metadata.size, files: 1 }
  if (!metadata.isDirectory()) return ZERO
  let entries
  try {
    entries = await readdir(target, { withFileTypes: true })
  } catch (error) {
    if (!isMissing(error)) scan.unreadable += 1
    return ZERO
  }
  const result = { bytes: 0, files: 0 }
  for (const entry of entries) {
    add(result, await measurePath(join(target, entry.name), scan))
    if (scan.truncated) break
  }
  return result
}

function emptyGroups(groups) {
  return Object.fromEntries([...groups.map((group) => [group.id, { ...ZERO }]), [OTHER_ID, { ...ZERO }]])
}

async function measureRoot(workspace, group, groups, scan) {
  const categories = emptyGroups(groups)
  const root = safeJoin(workspace, group)
  let rootMeta
  try {
    rootMeta = await lstat(root)
  } catch (error) {
    if (isMissing(error)) {
      return { bytes: 0, files: 0, categories, truncated: scan.truncated, unreadable: scan.unreadable, unsafe: false }
    }
    throw new StorageError('workspace_unavailable', '工作区目录不可读。')
  }
  if (rootMeta.isSymbolicLink() || !rootMeta.isDirectory()) {
    return { bytes: 0, files: 0, categories, truncated: scan.truncated, unreadable: scan.unreadable, unsafe: true }
  }
  const known = new Set(groups.map((item) => item.name))
  const result = { bytes: 0, files: 0, categories, truncated: false, unreadable: 0, unsafe: false }
  for (const item of groups) {
    const measured = await measurePath(join(root, item.name), scan)
    categories[item.id] = measured
    add(result, measured)
  }
  let entries = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (!isMissing(error)) scan.unreadable += 1
  }
  for (const entry of entries) {
    if (known.has(entry.name)) continue
    if (scan.truncated) break
    const measured = await measurePath(join(root, entry.name), scan)
    categories[OTHER_ID].bytes += measured.bytes
    categories[OTHER_ID].files += measured.files
    add(result, measured)
  }
  result.truncated = scan.truncated
  result.unreadable = scan.unreadable
  return result
}

/** Both roots share one scan budget so a huge `capital-data` cannot stall the panel twice. */
export async function measureWorkspace(workspacePath) {
  const scan = scanState()
  // Retained analysis is usually much smaller; measure it first so a huge
  // `capital-data` cannot starve the retained number behind the same budget.
  const analysis = await measureRoot(workspacePath, RETAINED_DIR, ANALYSIS_GROUPS, scan)
  const cache = await measureRoot(workspacePath, CACHE_DIR, CACHE_GROUPS, scan)
  return { cache, analysis }
}

function categoryOf(name, groups) {
  return groups.find((group) => group.name === name)?.id ?? OTHER_ID
}

function failureCode(error) {
  return typeof error?.code === 'string' && error.code.length <= 40 ? error.code : 'unknown'
}

/**
 * Remove every direct child of `capital-data`; keep the directory and never touch
 * `capital-analysis`. A symlinked cache root is refused outright because following
 * it would turn "clean this workspace" into an arbitrary delete.
 */
export async function clearWorkspaceCache(workspacePath) {
  const root = safeJoin(workspacePath, CACHE_DIR)
  let rootMeta
  try {
    rootMeta = await lstat(root)
  } catch (error) {
    if (isMissing(error)) {
      return { bytes: 0, files: 0, categories: emptyGroups(CACHE_GROUPS), failed: [], truncated: false, unreadable: 0 }
    }
    throw new StorageError('clear_failed', '工作区缓存目录不可读。')
  }
  if (rootMeta.isSymbolicLink() || !rootMeta.isDirectory()) {
    throw new StorageError('cache_root_unsafe', '缓存目录不是普通目录，已停止清理。')
  }
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    throw new StorageError('clear_failed', '工作区缓存目录不可读。')
  }
  const scan = scanState()
  const categories = emptyGroups(CACHE_GROUPS)
  const result = { bytes: 0, files: 0, categories, failed: [], truncated: false, unreadable: 0 }
  for (const entry of entries) {
    const category = categoryOf(entry.name, CACHE_GROUPS)
    const target = join(root, entry.name)
    const measured = await measurePath(target, scan)
    try {
      const metadata = await lstat(target)
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) await unlink(target)
      else await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    } catch (error) {
      if (!isMissing(error)) result.failed.push({ category, code: failureCode(error) })
      continue
    }
    result.bytes += measured.bytes
    result.files += measured.files
    categories[category].bytes += measured.bytes
    categories[category].files += measured.files
  }
  result.truncated = scan.truncated
  result.unreadable = scan.unreadable
  return result
}

async function sessionSummary(ctx, workspacePath) {
  let persistence
  try {
    persistence = ctx.get('sessionPersistence')
  } catch {
    persistence = undefined
  }
  if (typeof persistence?.list !== 'function') return { available: false, bytes: 0, count: 0 }
  let canonical = workspacePath
  try {
    canonical = await realpath(workspacePath)
  } catch {
    // Keep the registry spelling when realpath races away; exact comparison still helps.
  }
  try {
    const snapshots = await persistence.list()
    let bytes = 0
    let count = 0
    for (const snapshot of snapshots) {
      const cwd = snapshot?.header?.cwd
      if (cwd !== workspacePath && cwd !== canonical) continue
      count += 1
      if (Number.isSafeInteger(snapshot.sizeBytes) && snapshot.sizeBytes > 0) bytes += snapshot.sizeBytes
    }
    return { available: true, bytes, count }
  } catch {
    return { available: false, bytes: 0, count: 0 }
  }
}

function publicWorkspace(workspace) {
  return {
    ...(workspace.id === undefined ? {} : { id: workspace.id }),
    title: workspace.title,
    displayPath: workspace.displayPath,
    scope: workspace.scope,
  }
}

/**
 * Active workspace follows the same default the run loop uses: the saved default
 * id when the registry can resolve it, otherwise the dedicated run directory.
 */
export function createStorageService(options) {
  const { ctx, workspaces, profile, now = () => Date.now(), logger } = options
  let cached
  let warned = false

  async function workspaceOf() {
    try {
      const details = await workspaces?.details?.()
      const list = Array.isArray(details?.workspaces) ? details.workspaces : []
      const current = list.find((item) => item?.default === true) ?? list.find((item) => item?.dedicated === true)
      if (current !== undefined && typeof current.path === 'string' && current.path.length > 0) {
        return {
          ...(typeof current.id === 'string' ? { id: current.id } : {}),
          title: typeof current.title === 'string' ? current.title : defaultWorkspaceTitle(profile.displayName),
          displayPath: typeof current.displayPath === 'string' ? current.displayPath : current.path,
          scope: current.dedicated === true ? 'dedicated' : 'selected',
          path: current.path,
        }
      }
    } catch (error) {
      if (!warned) {
        warned = true
        logger?.warn?.(`capital-automation: 工作区列表读取失败，存储面板回退到专属目录（${String(error?.message ?? error)}）`)
      }
    }
    const path = profile.runDir
    return {
      title: defaultWorkspaceTitle(profile.displayName),
      displayPath: workspaceDisplayPath(path, homedir()),
      scope: 'dedicated',
      path,
    }
  }

  async function stats(options = {}) {
    const workspace = await workspaceOf()
    const key = workspace.path
    if (options.force !== true && cached !== undefined && cached.key === key && now() - cached.at < STATS_TTL_MS) {
      return cached.value
    }
    const [measured, sessions] = await Promise.all([
      measureWorkspace(workspace.path),
      sessionSummary(ctx, workspace.path),
    ])
    const value = {
      workspace: publicWorkspace(workspace),
      cache: measured.cache,
      analysis: measured.analysis,
      sessions,
    }
    cached = { key, at: now(), value }
    return value
  }

  async function clear() {
    const workspace = await workspaceOf()
    const cleared = await clearWorkspaceCache(workspace.path)
    cached = undefined
    return cleared
  }

  return { stats, clear, workspaceOf }
}
