/**
 * Workspace selection for automation runs. The task stores only a registered Workspace id;
 * paths never enter the wire schema. The dedicated run directory is registered once so its
 * sessions are grouped instead of landing in the ungrouped bucket.
 */
import { mkdir, realpath } from 'node:fs/promises'

export class WorkspaceError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WorkspaceError'
    this.code = code
  }
}

const DEFAULT_REGISTRATIONS = new WeakMap()
const MAX_SESSIONS_TO_ADOPT = 500

function service(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

export function createWorkspaceCatalog(options) {
  const { ctx, displayName, runDir, logger } = options
  let defaultEntity
  let defaultPromise

  function registry() {
    return service(ctx, 'workspaceRegistry')
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
    if (defaultEntity !== undefined) return defaultEntity
    if (defaultPromise !== undefined) return defaultPromise
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
            created = await current.create(runDir, `CapGen 投研自动化（${displayName}）`)
          } catch (error) {
            const recovered = typeof current.resolveByPath === 'function'
              ? await current.resolveByPath(runDir).catch(() => undefined)
              : undefined
            if (recovered === undefined) throw error
            created = recovered
          }
        }
        defaultEntity = created
        await adoptSessions(created)
        return created
      })()
      registrations.set(runDir, sharedPromise)
    }
    defaultPromise = sharedPromise
    try {
      return await sharedPromise
    } catch (error) {
      logger?.warn?.(`capital-automation: 无法注册默认工作区：${String(error)}`)
      return undefined
    } finally {
      if (registrations.get(runDir) === sharedPromise) registrations.delete(runDir)
      if (defaultEntity === undefined) defaultPromise = undefined
    }
  }

  async function list() {
    const current = registry()
    if (current === undefined) return []
    const preferred = await ensureDefault()
    return current.list().map((entity) => ({
      id: entity.id,
      title: entity.title,
      default: preferred !== undefined && entity.id === preferred.id,
    }))
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
    const preferred = await ensureDefault()
    if (preferred !== undefined) return { workspaceId: preferred.id, path: preferred.path }
    return { workspaceId: undefined, path: runDir }
  }

  return { list, validate, resolve, runDir }
}
