/**
 * Workspace selection for automation runs. The task stores only a registered Workspace id;
 * paths never enter the wire schema. The dedicated run directory is registered once so its
 * sessions are grouped instead of landing in the ungrouped bucket.
 */
import { mkdir, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'

export const AUTOMATION_WORKSPACE_DIR = 'CapGen-automation-workspace'

export class WorkspaceError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WorkspaceError'
    this.code = code
  }
}

const DEFAULT_REGISTRATIONS = new WeakMap()
const MAX_SESSIONS_TO_ADOPT = 500
const MAX_WORKSPACE_ID_CHARS = 200

function service(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

/** Directory segment safe on every platform; the raw profile name never becomes a path. */
export function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120)
}

export function defaultWorkspacePath(profile = {}) {
  const home = profile.home ?? profile.dir ?? process.cwd()
  return join(home, AUTOMATION_WORKSPACE_DIR, safeSegment(profile.name ?? 'default'))
}

export function defaultWorkspaceTitle(displayName) {
  return `CapGen 投研自动化（${displayName}）`
}

/** `~` only for paths under the user's home; anything else stays absolute so it is unambiguous. */
export function workspaceDisplayPath(path, home) {
  if (typeof path !== 'string' || typeof home !== 'string' || home.length === 0) return path
  const prefix = home.endsWith(sep) ? home : `${home}${sep}`
  return path.startsWith(prefix) ? `~${path.slice(home.length)}` : path
}

export function createWorkspaceCatalog(options) {
  const { ctx, displayName, runDir, displayHome, getDefaultWorkspaceId, logger } = options
  let dedicatedEntity
  let dedicatedPromise
  let warnedDefaultId

  function registry() {
    return service(ctx, 'workspaceRegistry')
  }

  function configuredDefaultId() {
    let value
    try {
      value = typeof getDefaultWorkspaceId === 'function' ? getDefaultWorkspaceId() : getDefaultWorkspaceId
    } catch {
      value = undefined
    }
    if (typeof value !== 'string') return ''
    return value.trim().slice(0, MAX_WORKSPACE_ID_CHARS)
  }

  function warnDefaultUnusable(id, reason) {
    if (warnedDefaultId === id) return
    warnedDefaultId = id
    logger?.warn?.(`capital-automation: 默认工作区 ${id} ${reason}，回退到专属默认工作区。`)
  }

  async function adoptSessions(entity) {
    if (entity.sessionIds.length > 0) return
    const persistence = service(ctx, 'sessionPersistence')
    if (typeof persistence?.list !== 'function') return
    let snapshots
    try {
      snapshots = await persistence.list()
    } catch {
      return
    }
    if (!Array.isArray(snapshots)) return
    let canonical = entity.path
    try {
      canonical = await realpath(entity.path)
    } catch {
      // The registry already canonicalized the path; keep its spelling if realpath races away.
    }
    let adopted = 0
    for (const snapshot of snapshots) {
      if (adopted >= MAX_SESSIONS_TO_ADOPT) break
      const header = snapshot?.header
      if (header?.id === undefined || header.cwd === undefined) continue
      if (header.cwd !== entity.path && header.cwd !== canonical && header.cwd !== runDir) continue
      try {
        await entity.attachSession(header.id)
        adopted += 1
      } catch {
        // A stale header must not block the page or the next run.
      }
    }
  }

  async function ensureDefault() {
    if (dedicatedEntity !== undefined) return dedicatedEntity
    if (dedicatedPromise !== undefined) return dedicatedPromise
    const current = registry()
    if (current === undefined) return undefined
    let registrations = DEFAULT_REGISTRATIONS.get(current)
    if (registrations === undefined) {
      registrations = new Map()
      DEFAULT_REGISTRATIONS.set(current, registrations)
    }
    let sharedPromise = registrations.get(runDir)
    if (sharedPromise === undefined) {
      sharedPromise = (async () => {
        await mkdir(runDir, { recursive: true, mode: 0o700 })
        let created
        if (typeof current.resolveByPath === 'function') {
          created = await current.resolveByPath(runDir).catch(() => undefined)
        }
        if (created === undefined) {
          try {
            created = await current.create(runDir, defaultWorkspaceTitle(displayName))
          } catch (error) {
            const recovered = typeof current.resolveByPath === 'function'
              ? await current.resolveByPath(runDir).catch(() => undefined)
              : undefined
            if (recovered === undefined) throw error
            created = recovered
          }
        }
        dedicatedEntity = created
        await adoptSessions(created)
        return created
      })()
      registrations.set(runDir, sharedPromise)
    }
    dedicatedPromise = sharedPromise
    try {
      const created = await sharedPromise
      if (created !== undefined) dedicatedEntity = created
      return created
    } catch (error) {
      logger?.warn?.(`capital-automation: 无法注册默认工作区：${String(error)}`)
      return undefined
    } finally {
      if (registrations.get(runDir) === sharedPromise) registrations.delete(runDir)
      if (dedicatedEntity === undefined) dedicatedPromise = undefined
    }
  }

  /**
   * A configured default is honoured only while it is registered and its directory is usable.
   * A stale id must degrade to the dedicated workspace instead of breaking every empty task.
   */
  async function configuredDefaultEntity() {
    const id = configuredDefaultId()
    if (id === '') return undefined
    const entity = registry()?.get?.(id)
    if (entity === undefined) {
      warnDefaultUnusable(id, '不存在或已被移除')
      return undefined
    }
    let status
    try {
      status = await entity.status?.()
    } catch {
      status = 'unavailable'
    }
    if (status !== undefined && status !== 'ok') {
      warnDefaultUnusable(id, '目录不可用')
      return undefined
    }
    warnedDefaultId = undefined
    return entity
  }

  async function effectiveDefault() {
    const configured = await configuredDefaultEntity()
    if (configured !== undefined) return configured
    return ensureDefault()
  }

  async function list() {
    await ensureDefault()
    const current = registry()
    if (current === undefined) return []
    const preferred = await effectiveDefault()
    const dedicatedId = dedicatedEntity?.id
    return current.list().map((entity) => ({
      id: entity.id,
      title: entity.title,
      default: preferred !== undefined && entity.id === preferred.id,
      ...(entity.id === dedicatedId ? { dedicated: true } : {}),
    }))
  }

  /** Settings-card projection only: it carries paths, unlike the task page's `/meta`. */
  async function details() {
    await ensureDefault()
    const current = registry()
    if (current === undefined) return { workspaces: [], defaultWorkspaceId: null }
    const preferred = await effectiveDefault()
    const dedicatedId = dedicatedEntity?.id
    return {
      workspaces: current.list().map((entity) => ({
        id: entity.id,
        title: entity.title,
        path: entity.path,
        displayPath: workspaceDisplayPath(entity.path, displayHome),
        default: preferred !== undefined && entity.id === preferred.id,
        dedicated: entity.id === dedicatedId,
      })),
      defaultWorkspaceId: preferred?.id ?? null,
    }
  }

  async function validate(id) {
    if (typeof id !== 'string' || id.length === 0) return
    const current = registry()
    if (current === undefined) {
      throw new WorkspaceError('workspace_unavailable', '工作区服务暂时不可用，不能指定工作区。')
    }
    const entity = current.get(id)
    if (entity === undefined) {
      throw new WorkspaceError('workspace_not_found', '选择的工作区不存在或已被移除。')
    }
    const status = await entity.status?.()
    if (status !== undefined && status !== 'ok') {
      throw new WorkspaceError('workspace_unavailable', `选择的工作区目录不可用：${entity.title}。`)
    }
  }

  async function resolve(id) {
    if (typeof id === 'string' && id.length > 0) {
      await validate(id)
      const entity = registry().get(id)
      return { workspaceId: entity.id, path: entity.path }
    }
    const preferred = await effectiveDefault()
    if (preferred !== undefined) return { workspaceId: preferred.id, path: preferred.path }
    return { workspaceId: undefined, path: runDir }
  }

  return { list, details, validate, resolve, runDir }
}
