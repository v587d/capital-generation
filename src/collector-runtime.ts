/**
 * Shared data_collector assembly (store + hub + 128 sources). Both `tools/collect` and
 * the monolith need it; duplicating would drift capability registration, credential
 * probes and time tools. Collector domain only — no dataset/chart/watchlist tools.
 */
import type { Context } from '@deepseek-ai/cordis'

import { provideDataCollectorHub } from './data-collector/hub.js'
import { registerDataCollectorTools, type DataCollectorDiagnostics } from './data-collector/tools.js'
import { capitalDatasetStore, type RuntimeContext } from './runtime.js'
import { rootPolicyProbes } from './agents/root-tool-policy.js'
import { rolePolicyProbes } from './agents/role-tool-policy.js'
import { createTencentSources } from './sources/tencent-http.js'
import { createEastmoneySources } from './sources/eastmoney-http.js'
import { createFuyaoRestSources, resolveFuyaoApiKey } from './sources/fuyao-rest.js'
import { createFtshareSources, resolveFtshareApiKey } from './sources/ftshare-rest.js'
import { createWindSources } from './sources/wind-mcp.js'
import { createWindCredentialResolver } from './retriever-runtime.js'

export interface CollectorConfig {
  fuyaoCredentialRef?: string
  ftshareCredentialRef?: string
  /** Flat projection of `retriever.windDocs.credentialRef`. */
  windCredentialRef?: string
}

export interface CollectorRuntime {
  store: ReturnType<typeof capitalDatasetStore>
  hub: ReturnType<typeof provideDataCollectorHub>
  /** Injected into `dc_status` by the caller that owns the `tools/collect` row. */
  diagnostics: DataCollectorDiagnostics
}

function diagnosticsFor(ctx: Context, config: CollectorConfig): DataCollectorDiagnostics {
  const fuyaoCredentialRef = config.fuyaoCredentialRef || 'FUYAO_API_KEY'
  return {
    probeApiKey: async () => {
      try {
        const credentials = ctx.get('credentials') as {
          resolve?: (ref: string) => Promise<{ value: string; source?: string } | undefined>
        } | undefined
        if (credentials?.resolve) {
          const resolved = await credentials.resolve(fuyaoCredentialRef)
          if (resolved?.value) return { present: true, source: resolved.source ?? `credentials(${fuyaoCredentialRef})` }
        }
        const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
        if (processLike?.env?.[fuyaoCredentialRef]) return { present: true, source: `env(${fuyaoCredentialRef})` }
        return { present: false, source: null }
      } catch (error) {
        return { present: false, source: null, error: error instanceof Error ? error.message : String(error) }
      }
    },
    // dc_status readout for root/role convergence; desktop does not persist host logs.
    // Keep the real session shape: opened root and delegated child converge differently.
    rootPolicy: () => [
      ...rootPolicyProbes().map((probe) => ({ ...probe, allowed: [] as string[] })),
      ...rolePolicyProbes().map((probe) => ({
        agentId: probe.agentId,
        root: probe.root,
        presetId: probe.presetId,
        outcome: probe.outcome,
        // Roles have no allow-list (family rows define the surface); report sibling
        // denials and call-level guard rejections.
        allowed: [] as string[],
        denied: probe.denied,
        failed: probe.failed,
      })),
    ],
  }
}

/** Registers all 128 sources; registration is structural, credentials resolve per call. */
function registerSources(ctx: Context, hub: CollectorRuntime['hub'], config: CollectorConfig): void {
  ctx.effect(() => {
    const sources = createTencentSources()
    const disposers = sources.map((dataSource) => hub.registerSource(dataSource))
    ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个腾讯数据源（tencent_*）`)
    return () => { for (const dispose of disposers) dispose() }
  }, 'capital-generation.tencent-sources()')

  ctx.effect(() => {
    const sources = createEastmoneySources()
    const disposers = sources.map((dataSource) => hub.registerSource(dataSource))
    ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个东方财富数据源（eastmoney_*）`)
    return () => { for (const dispose of disposers) dispose() }
  }, 'capital-generation.eastmoney-sources()')

  ctx.effect(() => {
    const sources = createFuyaoRestSources(() => resolveFuyaoApiKey(ctx, config.fuyaoCredentialRef || 'FUYAO_API_KEY'))
    const disposers = sources.map((dataSource) => hub.registerSource(dataSource))
    ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个同花顺数据源（key 每次调用现取）`)
    return () => { for (const dispose of disposers) dispose() }
  }, 'capital-generation.fuyao-sources()')

  ctx.effect(() => {
    const sources = createFtshareSources(() => resolveFtshareApiKey(ctx, config.ftshareCredentialRef || 'FTSHARE_API_KEY'))
    const disposers = sources.map((dataSource) => hub.registerSource(dataSource))
    ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个 FTShare 数据源（ftshare_*，key 每次调用现取）`)
    return () => { for (const dispose of disposers) dispose() }
  }, 'capital-generation.ftshare-sources()')

  const wind = createWindCredentialResolver(ctx, config.windCredentialRef)
  ctx.effect(() => {
    const sources = createWindSources(wind.resolve)
    const disposers = sources.map((dataSource) => hub.registerSource(dataSource))
    ctx.logger.info(`capital-generation: 已注册 ${disposers.length} 个 Wind 数据源（wind_*，与 wind_docs 共用 ${wind.credentialRef}）`)
    return () => { for (const dispose of disposers) dispose() }
  }, 'capital-generation.wind-sources()')
}

export function createCollectorRuntime(ctx: Context, config: CollectorConfig = {}): CollectorRuntime {
  const store = capitalDatasetStore(ctx as unknown as RuntimeContext)
  // The collector preset isolates these services; keep them in the realm to avoid
  // process-wide name collisions across presets.
  ctx.provide('datasetStore', store)
  const hub = provideDataCollectorHub(ctx, { store })

  registerSources(ctx, hub, config)

  // Builds runtime only; model tools belong to the `tools/collect` and `tools/time` rows.
  return { store, hub, diagnostics: diagnosticsFor(ctx, config) }
}
