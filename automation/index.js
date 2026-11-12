/**
 * Host row `capital-automation`: fixed domain, profile-filtered API, one cross-process
 * scheduler lease, and the browser page mounted on the host plane. The official
 * `ui-schedule` row and its `schedules` identities are untouched.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { createRunRunner, buildRunPrompt, sessionTitleOf } from './runner.js'
import { createBriefService, readSessionAnswer } from './brief.js'
import { createBoardService } from './board.js'
import { createTodoWatchService } from './watch.js'
import { createAskService } from './ask.js'
import { createScheduler } from './scheduler.js'
import { createAutomationService, AutomationError } from './service.js'
import { createAutomationStore, domainSpec, ROUTE_PATH } from './store.js'
import { createAutomationRouteHandler } from './route.js'
import { resolveAutomationSettings } from './settings.js'
import { installAutomationPolicy } from './policy.js'
import { createCalendarSource } from './calendar-source.js'
import { createWorkspaceCatalog, defaultWorkspacePath } from './workspaces.js'
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

/**
 * Build the runtime without Cordis services. Exported for tests and for the desktop carrier
 * that supplies its own HTTP/auth plane.
 */
export function createAutomationRuntime(options) {
  const { ctx, profile, storageDomain, settings, now = () => Date.now(), logger, version = versionOf() } = options
  const getSettings = typeof settings === 'function' ? settings : () => resolveAutomationSettings(ctx, settings)
  const rawProfileName = String(profile.name)
  const displayName = rawProfileName.slice(0, 200)
  const home = profile.home ?? profile.dir ?? process.cwd()
  const runDir = profile.runDir ?? defaultWorkspacePath(profile)
  const ownerDir = profile.ownerDir ?? join(home, 'storages', 'capital-automation-locks')
  const calendar = options.calendar ?? createCalendarSource({
    cacheDir: join(home, 'storages', 'capital-automation-calendar'),
    logger,
    now,
  })
  const policyContext = options.policyContext ?? ctx
  const workspaces = createWorkspaceCatalog({
    ctx,
    displayName,
    runDir,
    displayHome: homedir(),
    getDefaultWorkspaceId: () => getSettings()?.defaultWorkspaceId,
    logger,
  })
  const store = createAutomationStore({
    openDomain: () => storageDomain.open(domainSpec),
    profile: { name: rawProfileName },
    now,
    calendar,
    settings: getSettings,
  })
  const asks = createAskService({
    ctx,
    store,
    now,
    logger,
  })
  let briefs
  let watches
  const runner = createRunRunner({
    ctx,
    store,
    settings: getSettings,
    profile: { displayName, runDir },
    workspaces,
    onRunSucceeded: async (payload) => {
      if (watches?.isVerifierTask(payload.task) !== true) return briefs?.onRunSucceeded(payload)
      let summary
      try {
        summary = await watches.onVerifierRun(payload)
      } catch (error) {
        logger?.warn?.(`capital-automation: TODO 核验结果处理失败：${String(error)}`)
      }
      return briefs?.recordVerifierBrief({ ...payload, summary })
    },
    buildPromptContext: (payload) => watches?.promptContextFor(payload.task),
    now,
    logger,
  })
  const scheduler = createScheduler({
    store,
    runner,
    calendar,
    profile: { ownerDir },
    getSettings,
    shouldRun: (task) => watches?.hasCandidates(task) ?? true,
    now,
    logger,
  })
  const boardService = createBoardService({
    store,
    scheduler,
    asks,
    now,
  })
  watches = createTodoWatchService({
    store,
    board: boardService,
    now,
    logger,
    getSettings,
    readAnswer: (sessionId) => {
      let sessionQuery
      try {
        sessionQuery = ctx.get('sessionQuery')
      } catch {
        sessionQuery = undefined
      }
      if (sessionQuery?.readSession === undefined) return Promise.reject(new Error('sessionQuery 不可用'))
      return readSessionAnswer(sessionQuery, sessionId, { includeToolText: true })
    },
    isOwner: () => scheduler.status().state === 'active',
  })
  briefs = createBriefService({
    ctx,
    store,
    scheduler,
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
    briefs,
    asks,
    boardService,
    now,
  })
  runner.installListeners()
  if (typeof policyContext?.inject === 'function') {
    policyContext.inject(['tools'], (toolsCtx) => {
      installAutomationPolicy({ ctx: toolsCtx, runner, logger })
    })
  }
  return { store, runner, scheduler, briefs, watches, asks, service, calendar, workspaces, profile: { displayName, runDir, ownerDir } }
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
        .then(() => {
          created.briefs?.start()
          created.watches?.start()
          logger?.info?.(`capital-automation: scheduler ${created.scheduler.status().state}`)
        })
        .catch((error) => logger?.error?.(`capital-automation: scheduler 启动失败：${String(error)}`))
      appCtx.effect(() => async () => {
        if (activeService === created.service) {
          activeService = undefined
        }
        await created.briefs?.stop?.()
        created.watches?.stop?.()
        await created.scheduler.stop().catch(() => {})
        created.calendar.dispose?.()
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
