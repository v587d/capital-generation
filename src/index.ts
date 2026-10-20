import { Context } from '@deepseek-ai/cordis'
// Type-only: loads the `systemPrompt` service augmentation, emits no runtime import.
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { capitalSharedRuntime, type RuntimeContext } from './runtime.js'
import { createCollectorRuntime } from './collector-runtime.js'
import { registerDataCollectorTools } from './data-collector/tools.js'
import { registerTimeTool } from './time/tools.js'
import { resolveUserCustomizationSection } from './user-customization.js'
import { registerDatasetTools } from './data-collector/dataset-tools.js'
import { registerWatchlistTool } from './watchlist/tools.js'
import { registerChartTool } from './chart/tool.js'
import { createChartEventPublisher } from './chart/events.js'
import { chartEventContextOf } from './chart/event-context.js'
import { SELECTED_SKILL_CATALOG, type SelectedSkillSelection } from './agents/selected-skills-provider.js'
import { registerChartSourceTool } from './chart/source-token.js'
import { registerSourceTools, registerWebRetrieverTools } from './web-retriever/tools.js'
import {
  LOCAL_FETCH_DEFAULTS,
  PADDLE_OCR_DEFAULTS,
  type LocalFetchConfig,
  type PaddleOcrConfig,
  type RetrieverConfig,
  type WindDocsConfig,
} from './retriever-config.js'
import { createRetrieverRuntime } from './retriever-runtime.js'

export {
  LOCAL_FETCH_DEFAULTS,
  PADDLE_OCR_DEFAULTS,
  resolveLocalFetchConfig,
  type LocalFetchConfig,
  type PaddleOcrConfig,
  type RetrieverConfig,
  type WindDocsConfig,
} from './retriever-config.js'
export { resolveUserCustomizationSection } from './user-customization.js'

export const name = 'capital-generation'

/** Entry id shared by `cordis.patch.yml`, `config/index.js` and `client.src.cjs`; drift hides the settings card. */
export const CAPITAL_CONFIG_ENTRY_ID = 'capital-config'

const WindDocsSchema = z.object({
  endpoint: z.string().default('').description('可选：覆盖 Wind 文档检索端点'),
  credentialRef: z.string().default('').description('可选：DSH credentials 引用名，空 = WIND_API_KEY'),
  timeoutMs: z.number().default(0).description('可选：单次调用超时毫秒，0 = 默认 60000'),
})

const PaddleOcrSchema = z.object({
  endpoint: z.string().default(PADDLE_OCR_DEFAULTS.endpoint).description('PaddleOCR 作业端点；空 = 官方 jobs 端点'),
  credentialRef: z.string().default(PADDLE_OCR_DEFAULTS.credentialRef).description('PaddleOCR Token 的 credentials 引用名，空 = PADDLE_OCR_TOKEN'),
  model: z.string().default(PADDLE_OCR_DEFAULTS.model).description('解析模型名；空 = PaddleOCR-VL-1.6'),
  pollBudgetMs: z.number().default(PADDLE_OCR_DEFAULTS.pollBudgetMs).description('ocr 工具内部等作业的预算毫秒，0 = 默认 200000（必须小于工具声明的 240000 超时）'),
})

const LocalFetchSchema = z.object({
  enabled: z.boolean().default(LOCAL_FETCH_DEFAULTS.enabled).description('是否允许本机直连出网：AnySearch 失败后的回退抓取 + 具名来源工具的执行（默认开启；关闭时来源工具调用响亮失败）'),
  timeoutMs: z.number().default(LOCAL_FETCH_DEFAULTS.timeoutMs).description('本机直连单次请求超时毫秒'),
  maxBytes: z.number().default(LOCAL_FETCH_DEFAULTS.maxBytes).description('本机直连响应体字节上限'),
  maxContentChars: z.number().default(LOCAL_FETCH_DEFAULTS.maxContentChars).description('本机直连正文码点上限（切在转换前的原始 HTML 上，不是 markdown 输出）'),
  maxRedirects: z.number().default(LOCAL_FETCH_DEFAULTS.maxRedirects).description('本机直连最大重定向跳数'),
  userAgent: z.string().default(LOCAL_FETCH_DEFAULTS.userAgent).description('本机直连 User-Agent；空 = 回落到插件版本号'),
})

const RetrieverSchema = z.object({
  baseURL: z.string().default('').description('可选：覆盖 AnySearch API 地址'),
  credentialRef: z.string().default('').description('可选：DSH credentials 引用名，空 = ANYSEARCH_API_KEY'),
  windDocs: WindDocsSchema.default({ endpoint: '', credentialRef: '', timeoutMs: 0 })
    .description('Wind 金融文档检索（public_document）配置；缺省使用官方端点与 WIND_API_KEY'),
  localFetch: LocalFetchSchema.default({ ...LOCAL_FETCH_DEFAULTS })
    .description('本地直连回退配置（AnySearch 明确失败后改由本机抓取公开文本页面）'),
  paddleOcr: PaddleOcrSchema.default({ ...PADDLE_OCR_DEFAULTS })
    .description('PaddleOCR 文档解析（ocr 工具）配置；Token 走 credentials 引用 PADDLE_OCR_TOKEN'),
})

export interface Config {
  customPersona?: string
  selectedSkills?: SelectedSkillSelection
  fuyaoCredentialRef?: string
  ftshareCredentialRef?: string
  retriever?: RetrieverConfig
}

// Derive toggles from the catalog: a hand-copied list silently drops defaults at the entry→plugin boundary.
const SelectedSkillsSchema = z.object(
  Object.fromEntries(SELECTED_SKILL_CATALOG.map(({ key, name }) => [
    key,
    z.boolean().default(false).description(`Enable the community experiment "${name}" for the Auto mode root Agent`),
  ])),
).default(Object.fromEntries(SELECTED_SKILL_CATALOG.map(({ key }) => [key, false])))

export const Config = z.object({
  customPersona: z.string()
    .default('')
    .description('自动模式的附加人设文本（独立 section，非 deployment:persona）；核心安全约束始终保留'),
  selectedSkills: SelectedSkillsSchema.description('Community selected-skill experiments; default off and visible only to the Auto mode root Agent'),
  fuyaoCredentialRef: z.string()
    .default('FUYAO_API_KEY')
    .description('Fuyao credentials 引用名，空 = FUYAO_API_KEY'),
  ftshareCredentialRef: z.string()
    .default('FTSHARE_API_KEY')
    .description('FTShare（非凸科技）credentials 引用名，空 = FTSHARE_API_KEY'),
  retriever: RetrieverSchema.default({ baseURL: '', credentialRef: 'ANYSEARCH_API_KEY', windDocs: { endpoint: '', credentialRef: 'WIND_API_KEY', timeoutMs: 60000 }, localFetch: { ...LOCAL_FETCH_DEFAULTS }, paddleOcr: { ...PADDLE_OCR_DEFAULTS } })
    .description('web_retriever 配置（可选；缺省使用 AnySearch 默认地址与凭据名）'),
})

export type CapitalSettingsSource = 'settings-describe' | 'config-editor' | 'preset'
type SettingsDescribeService = { describe?: () => ReadonlyArray<{ ns: string; value: unknown }> }
type ConfigEditorService = { entries?: () => ReadonlyArray<{ options?: { id?: string; config?: unknown } }> }

/** Fallback order: settings.describe → configEditor.entries → boot preset, so unreadable never
 * reads as "all toggles off". Resolve services per call: boot fibers apply in parallel. */
export function readCapitalSettings(ctx: Context, bootConfig: Config): { config: Config; source: CapitalSettingsSource } {
  const settings = ctx.get('settings') as SettingsDescribeService | undefined
  try {
    const resolved = settings?.describe?.().find((entry) => entry.ns === CAPITAL_CONFIG_ENTRY_ID)?.value
    // Re-parse through this plugin's schema: fills defaults and surfaces schema drift.
    if (resolved && typeof resolved === 'object') return { config: Config(resolved as Config), source: 'settings-describe' }
  } catch {
  }
  const configEditor = ctx.get('configEditor') as ConfigEditorService | undefined
  try {
    const raw = configEditor?.entries?.().find((row) => row?.options?.id === CAPITAL_CONFIG_ENTRY_ID)?.options?.config
    if (raw && typeof raw === 'object') return { config: Config(raw as Config), source: 'config-editor' }
  } catch {
  }
  return { config: bootConfig, source: 'preset' }
}

/** `systemPrompt` is a hard dependency of the optional persona section. */
export const inject = ['systemPrompt']

export function apply(ctx: Context, config: Config) {
  // Settings are a host-plane form projection keyed by entry id, not a namespace bus.
  let lastSettingsSource: CapitalSettingsSource | undefined
  const readEffectiveConfig = (): Config => {
    const { config: resolved, source } = readCapitalSettings(ctx, config)
    if (source !== lastSettingsSource) {
      // Warn only on state flips; a silent fallback looks exactly like "all toggles off".
      if (source === 'preset' && (ctx.get('settings') !== undefined || ctx.get('configEditor') !== undefined)) {
        ctx.logger?.warn?.('capital-generation: capital-config 设置暂不可读，回落 preset 配置（精选 Skills 按默认全关；恢复后下一轮自动刷新）')
      }
      lastSettingsSource = source
    }
    return resolved
  }
  const effectiveConfig = readEffectiveConfig()

  // Same construction as the `tools/collect` row.
  const { store, hub: collectorHub, diagnostics: collectorDiagnostics } = createCollectorRuntime(ctx, {
    fuyaoCredentialRef: effectiveConfig.fuyaoCredentialRef,
    ftshareCredentialRef: effectiveConfig.ftshareCredentialRef,
    windCredentialRef: effectiveConfig.retriever?.windDocs?.credentialRef,
  })
  // Monolith carrier registers every family explicitly; no shipped preset mounts this entry.
  registerDataCollectorTools(ctx, collectorHub, collectorDiagnostics)
  registerTimeTool(ctx, store)
  registerDatasetTools(ctx, store, { writeProfile: true })
  // Read-only watchlist is root-only; no role preset mounts tools/watchlist.
  registerWatchlistTool(ctx)
  // Root policy denies render_chart; delivery must use first-party `deliverables/presented` (custom types break cold load).
  // chart_source_ref is a short-lived capability token shared across presets via ctx.root.
  const { sourceTokens: chartSourceTokens, artifacts: chartArtifacts } = capitalSharedRuntime(ctx as unknown as RuntimeContext)
  registerChartSourceTool(ctx, { store, tokens: chartSourceTokens })
  // Host-plane capitalCharts resolves lazily per render; absent means the tool returns the chart file path.
  // Never assemble with `{ ...ctx }`: cordis get/on/effect live on the prototype, so spreading silently drops publishing.
  const chartEventContext = chartEventContextOf(ctx)
  registerChartTool(ctx, {
    store,
    sourceTokens: chartSourceTokens,
    artifacts: chartArtifacts,
    charts: () => ctx.get('capitalCharts') as { publish(input: { chartId: string; filePath: string }): string | null } | undefined,
    chartEvents: () => createChartEventPublisher(chartEventContext),
  })
  // Convergence and shell/fs guards live in host-plane/role entries; retriever client construction is shared.
  const retrieverRuntime = createRetrieverRuntime(ctx, effectiveConfig.retriever ?? {})
  const { windClient, ocrClient, localFetchConfig } = retrieverRuntime
  // `ocr` is not gated by localFetch.enabled; that switch covers local web extraction only.
  registerWebRetrieverTools(ctx, retrieverRuntime.retriever, windClient, { store, client: ocrClient })
  // Named-source tools use local HTTP: disabled means registered but failing loudly, never silently missing.
  registerSourceTools(ctx, {
    enabled: localFetchConfig.enabled,
    timeoutMs: localFetchConfig.timeoutMs,
    maxBytes: localFetchConfig.maxBytes,
    maxContentChars: localFetchConfig.maxContentChars,
    maxRedirects: localFetchConfig.maxRedirects,
    userAgent: localFetchConfig.userAgent,
  })

  ctx.effect(() => {
    const section = resolveUserCustomizationSection(effectiveConfig.customPersona)
    if (!section) return () => {}
    return ctx.systemPrompt.section(section)
  }, 'capital-generation.user-customization()')
}
