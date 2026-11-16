import type { Context } from '@deepseek-ai/cordis'
import { fileURLToPath } from 'node:url'

import { PythonRuntimeManager } from './python-runtime/manager.js'
import { readManifest } from './python-runtime/manifest.js'
import { detectPlatform } from './python-runtime/platform.js'
import { createPythonRuntimeHandler } from './python-runtime/routes.js'
import { resolveDshHome } from './python-runtime/paths.js'
import type { PnpmInvocation } from './python-runtime/pnpm.js'

interface ProfileContextLike {
  home?: string
  dir?: string
  packageManager?: PnpmInvocation
}

interface ConnectionLike {
  requestRejection?(req: unknown): number | undefined | null
}

interface WebServerLike {
  register(route: { kind: 'prefix'; path: string; handler: (req: unknown, res: unknown) => Promise<void> }): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Plugin-owned Python runtime manager, provided once by the host-plane row. */
    pythonRuntime: PythonRuntimeManager
  }
}

export const name = 'python-runtime'

export function apply(ctx: Context): void {
  if (ctx.get('pythonRuntime') !== undefined) {
    (ctx as unknown as { logger?: { error?(message: string): void } }).logger?.error?.('python-runtime: 服务已存在，拒绝重复 provide。')
    return
  }

  const profile = ctx.get('profileContext') as ProfileContextLike | undefined
  const manifestPath = fileURLToPath(new URL('../runtime/manifest.json', import.meta.url))
  const target = detectPlatform()
  let manifest
  try {
    manifest = readManifest(manifestPath)
  } catch (error) {
    (ctx as unknown as { logger?: { error?(message: string): void } }).logger?.error?.(`python-runtime: ${String(error)}`)
    return
  }

  const manager = new PythonRuntimeManager({
    manifest,
    dshHome: resolveDshHome(profile?.home),
    workerPath: fileURLToPath(new URL('../python/worker.py', import.meta.url)),
    target,
    ...(profile?.dir === undefined ? {} : { profileDir: profile.dir }),
    ...(profile?.packageManager === undefined ? {} : { packageManager: profile.packageManager }),
    ...(process.env.CG_PYTHON_REGISTRY === undefined ? {} : { registry: process.env.CG_PYTHON_REGISTRY }),
    logger: (ctx as unknown as { logger?: { info?(message: string): void; warn?(message: string): void; error?(message: string): void } }).logger,
  })

  ctx.provide('pythonRuntime', manager)
  ctx.effect(() => () => { void manager.dispose() }, 'python-runtime: dispose')

  ctx.inject(['webServer'], (webCtx) => {
    const web = webCtx as unknown as { webServer: WebServerLike; effect(callback: () => () => void, label?: string): void }
    const authorize = (req: unknown) => {
      let connection: ConnectionLike | undefined
      try {
        connection = ctx.get('connection') as ConnectionLike | undefined
      } catch {
        return 401
      }
      if (connection === undefined || connection === null) return undefined
      if (typeof connection.requestRejection !== 'function') return undefined
      return connection.requestRejection(req)
    }
    const handler = createPythonRuntimeHandler(manager, authorize)
    web.effect(() => web.webServer.register({
      kind: 'prefix',
      path: '/python-runtime',
      handler: handler as unknown as (req: unknown, res: unknown) => Promise<void>,
    }), 'python-runtime: HTTP routes')
  })

  ;(ctx as unknown as { logger?: { info?(message: string): void } }).logger?.info?.(
    `python-runtime: active (${target.target ?? 'unsupported'})`,
  )
}
