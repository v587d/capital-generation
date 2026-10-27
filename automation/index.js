/**
 * Host row `capital-automation`: fixed domain, profile-filtered API, one cross-process
 * scheduler lease, and the browser page mounted on the host plane. The official
 * `ui-schedule` row and its `schedules` identities are untouched.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createRunRunner, buildRunPrompt, sessionTitleOf } from './runner.js'
import { createScheduler } from './scheduler.js'
import { createAutomationService, AutomationError } from './service.js'
import { createAutomationStore, domainSpec, ROUTE_PATH } from './store.js'
import { createAutomationRouteHandler } from './route.js'
import { resolveAutomationSettings } from './settings.js'
import { installAutomationPolicy } from './policy.js'
import { createTradingCalendar } from './calendar.js'
import { createWorkspaceCatalog } from './workspaces.js'
import { sanitizeMessage } from './redact.js'

export const name = 'capital-automation'
export { ROUTE_PATH, domainSpec, buildRunPrompt, sessionTitleOf }

function versionOf() {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120)
}

/**
 * Build the runtime without Cordis services. Exported for tests and for the desktop carrier
 * that supplies its own HTTP/auth plane.
 */
export function createAutomationRuntime(options) {
  const { ctx, profile, storageDomain, settings, now = () => Date.now(), logger, version = versionOf() } = options
  const calendar = options.calendar ?? createTradingCalendar()
  const getSettings = typeof settings === 'function' ? settings : () => resolveAutomationSettings(ctx, settings)
  const rawProfileName = String(profile.name)
  const displayName = rawProfileName.slice(0, 200)
  const home = profile.home ?? profile.dir ?? process.cwd()
  const runDir = profile.runDir ?? join(home, 'automation-workspace', safeSegment(displayName))
  const ownerDir = profile.ownerDir ?? join(home, 'storages', 'capital-automation-locks')
  const policyContext = options.policyContext ?? ctx
  const workspaces = createWorkspaceCatalog({ ctx, displayName, runDir, logger })
  const store = createAutomationStore({
    openDomain: () => storageDomain.open(domainSpec),
    profile: { name: rawProfileName },
    now,
    calendar,
  })
  const runner = createRunRunner({
    ctx,
    store,
    settings: getSettings,
    profile: { displayName, runDir },
    workspaces,
    now,
    logger,
  })
  const scheduler = createScheduler({
    store,
    runner,
    calendar,
    profile: { ownerDir },
    getSettings,
    now,
    logger,
  })
  const service = createAutomationService({
    store,
    scheduler,
    runner,
    calendar,
    profile: { displayName },
    workspaces,
    version,
    settings: getSettings,
    now,
  })
  runner.installListeners()
  if (typeof policyContext?.inject === 'function') {
    policyContext.inject(['tools'], (toolsCtx) => {
      installAutomationPolicy({ ctx: toolsCtx, runner, logger })
    })
  }
  return { store, runner, scheduler, service, calendar, workspaces, profile: { displayName, runDir, ownerDir } }
}

function authorizeFactory(ctx) {
  return (req) => {
    let connection
    try {
      connection = ctx.get('connection')
    } catch {
      return 401
    }
    if (connection === undefined || connection === null) return 401
    if (typeof connection.requestRejection !== 'function') return 401
    return connection.requestRejection(req)
  }
}

function unavailable(code, message) {
  return Promise.reject(new AutomationError(code, message, 503))
}

/** Route proxy: the page exists before the profile/storage fibers settle, and says so. */
function lazyService(getService) {
  return new Proxy({}, {
    get(_target, property) {
      return async (...args) => {
        let service
        try {
          service = await getService()
        } catch {
          return unavailable('automation_unavailable', '投研自动化服务尚未就绪。')
        }
        const method = service?.[property]
        if (typeof method !== 'function') return unavailable('automation_unavailable', '投研自动化服务尚未就绪。')
        return method(...args)
      }
    },
  })
}

export function apply(ctx) {
  const logger = ctx.logger
  let activeService

  function currentService() {
    return activeService
  }

  ctx.inject(['profileContext', 'storageDomain'], (appCtx) => {
    let created
    try {
      const profileContext = appCtx.profileContext
      created = createAutomationRuntime({
        ctx,
        profile: profileContext,
        storageDomain: appCtx.storageDomain,
        policyContext: appCtx,
        logger,
      })
      activeService = created.service
      created.scheduler.start()
        .then(() => logger?.info?.(`capital-automation: scheduler ${created.scheduler.status().state}`))
        .catch((error) => logger?.error?.(`capital-automation: scheduler 启动失败：${String(error)}`))
      appCtx.effect(() => async () => {
        if (activeService === created.service) {
          activeService = undefined
        }
        await created.scheduler.stop().catch(() => {})
        await created.runner.dispose?.()
        await created.store.close().catch(() => {})
      }, 'capital-automation: runtime')
    } catch (error) {
      logger?.error?.(`capital-automation: 运行时组装失败：${sanitizeMessage(String(error))}`)
    }
  })

  const service = lazyService(currentService)
  const handler = createAutomationRouteHandler(service, {
    authorize: authorizeFactory(ctx),
    logger,
  })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler }),
      'capital-automation: route',
    )
  })

  ctx.logger?.info?.('capital-automation: host row active (page + /capital-automation)')
}

export { resolveAutomationSettings }
