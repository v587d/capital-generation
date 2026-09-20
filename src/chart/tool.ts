/**
 * `render_chart`：把已经取到的数据渲染成图，**只回一条小回执**。
 *
 * 上下文经济学（这是本工具存在的理由）：
 *  - 常驻成本 = 一条工具 schema；协议细节在 skill `capital-chart-protocol` 里按需加载；
 *  - 每次调用成本 = spec（几十到一百多 token）+ 回执（几十 token）；
 *  - 序列数据 **0 token**：由宿主写进 workspace 产物，浏览器走旁路取。
 * 对照：让模型把 250 点日线写进参数 ≈ 5–8k token，还会被工具结果剪枝器截断。
 *
 * 权限边界（AGENTS.md「数据调度纪律」的显式豁免）：本工具是**呈现**工具，不是数据工具。
 * 它读 Dataset 只在宿主进程内进行，回执不含任何 rows —— 因此不越过"数据内容不进主 Agent
 * 上下文"这条真正的边界。需要数值结论仍走 data_junior 的 profile / query。
 */
import type { Context } from '@deepseek-ai/cordis'

import { DatasetStoreError, WorkspaceDatasetStore } from '../data-collector/store.js'
import { ChartError } from './errors.js'
import { buildStandaloneHtml, loadVendoredChartLibrary } from './html.js'
import { buildChartPayload, extractRows, MAX_CHART_POINTS } from './series.js'
import { normalizeChartSpec } from './spec.js'
import { chartSourceTokenForRender, type ChartSourceTokenStore } from './source-token.js'
import { ChartArtifactRegistry, chartSessionScopeId } from './artifact-ref.js'
import type { ChartEventPublisher } from './events.js'

type ToolRuntimeLike = { register(definition: unknown): () => void }
type AgentExecutionLike = { session?: { id?: string; header?: { cwd?: string; parentSession?: string } } }
type ToolExecLike = { agent?: AgentExecutionLike; signal: AbortSignal }

const jsonObject = (properties: Record<string, unknown> = {}, required: string[] = []): object =>
  ({ type: 'object', properties, required, additionalProperties: false })

export const CHART_ARTIFACT_DIR = 'capital-analysis/charts'

function render(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function newChartId(): string {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  const suffix = cryptoLike?.randomUUID ? cryptoLike.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `ch_${suffix}`
}

function sessionOf(exec: ToolExecLike): { id: string; header?: { cwd?: string; parentSession?: string } } {
  const session = exec.agent?.session
  if (!session || typeof session.id !== 'string' || session.id.length === 0) {
    throw new ChartError('chart_source_invalid', 'the calling agent session was not provided')
  }
  return session as { id: string; header?: { cwd?: string; parentSession?: string } }
}

function stripErrorCode(message: string): string {
  const separator = message.indexOf(':')
  return separator >= 0 ? message.slice(separator + 1).trim() : message
}

function normalizeStoreError(error: unknown): ChartError | undefined {
  if (!(error instanceof DatasetStoreError)) return undefined
  const detail = stripErrorCode(error.message)
  switch (error.code) {
    case 'dataset_not_found':
    case 'dataset_expired':
    case 'dataset_session_mismatch':
      return new ChartError('chart_source_not_found', detail, { cause: error.code })
    case 'dataset_id_invalid':
    case 'workspace_path_invalid':
      return new ChartError('chart_source_invalid', detail, { cause: error.code })
    case 'dataset_too_large':
      return new ChartError('chart_too_large', detail, { cause: error.code })
    case 'workspace_file_invalid':
    case 'dataset_not_row_readable':
    case 'dataset_format_unsupported':
      return new ChartError('chart_source_invalid', detail, { cause: error.code })
    case 'workspace_not_writable':
    case 'dataset_write_failed':
      return new ChartError('chart_write_failed', detail, { cause: error.code })
    case 'filesystem_unavailable':
    case 'sandbox_policy_unavailable':
    case 'session_cwd_unavailable':
      return new ChartError('chart_runtime_unavailable', detail, { cause: error.code })
    default:
      return undefined
  }
}

/**
 * 工具框架对 throw 的错误只保留 message；把 ChartError 的 details 在这里展开成
 * JSON 信封，模型才能拿到 array_keys / available 等一次修正所需的信息。
 */
function toolVisibleError(error: unknown): Error {
  const normalized = error instanceof ChartError ? error : normalizeStoreError(error)
  if (!normalized) return error instanceof Error ? error : new Error(String(error))
  const visible = new Error(JSON.stringify(normalized.toEnvelope())) as Error & { code?: string }
  visible.name = normalized.name
  visible.code = normalized.code
  return visible
}

const receiptSchema = jsonObject({
  chart_ref: { type: 'string' },
  chart_id: { type: 'string' },
  kind: { type: 'string' },
  axis: { type: 'string', enum: ['time', 'index'] },
  title: { type: 'string' },
  points: { type: 'integer' },
  original_points: { type: 'integer' },
  downsampled: { type: 'boolean' },
  series_labels: { type: 'array', items: { type: 'string' } },
  has_volume: { type: 'boolean' },
  markers: { type: 'integer' },
  dataset_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  source_label: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  captured_at: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
  chart_url: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  spec_path: { type: 'string' },
  series_path: { type: 'string' },
  html_path: { type: 'string' },
  warnings: { type: 'array', items: { type: 'string' } },
}, [
  'chart_ref', 'chart_id', 'kind', 'axis', 'points', 'original_points', 'downsampled',
  'series_labels', 'has_volume', 'markers', 'dataset_id', 'source_label',
  'captured_at', 'chart_url', 'spec_path', 'series_path', 'html_path', 'warnings',
])

const parameters = jsonObject({
  dataset_id: { type: 'string', description: '数据来源之一：已授权的 DatasetRef 的 dataset_id（与 path / chart_source_ref 三选一）' },
  path: { type: 'string', description: '数据来源之一：workspace 相对路径的 JSON 文件，如 capital-data/datasets/x/raw.json（与 dataset_id / chart_source_ref 三选一）' },
  chart_source_ref: { type: 'string', description: '数据来源之一：宿主签发给 visualization_specialist 的短期 opaque chart source token（与 dataset_id / path 三选一）' },
  task_id: { type: 'string', description: '使用 chart_source_ref 时必需；必须与 token 绑定的当前任务一致' },
  spec: {
    oneOf: [{ type: 'object', additionalProperties: true }, { type: 'string' }],
    description: '图表描述对象或 JSON 对象字符串，至少 { kind, x?, series? | ohlc?, volume?, markers?, range?, title? }；字段语义与错误码见 skill capital-chart-protocol',
  },
  title: { type: 'string', description: '可选：覆盖 spec.title 的图表标题' },
}, ['spec'])

/** 回执字段全部是可以进上下文的小元数据；序列本体永远不在这里。 */
export interface ChartReceipt {
  chart_ref: string
  chart_id: string
  kind: string
  axis: 'time' | 'index'
  title: string
  points: number
  original_points: number
  downsampled: boolean
  series_labels: string[]
  has_volume: boolean
  markers: number
  dataset_id: string | null
  source_label: string | null
  captured_at: number | null
  chart_url: string | null
  spec_path: string
  series_path: string
  html_path: string
  warnings: string[]
}

export interface ChartPublisher {
  publish(input: { chartId: string; filePath: string }): string | null
}

export interface RenderChartInput {
  store: WorkspaceDatasetStore
  sourceTokens?: ChartSourceTokenStore
  artifacts?: ChartArtifactRegistry
  /**
   * 惰性解析 host 平面图表服务（`@v587d/capital-charts` 提供）。
   *
   * 每次画图时解析，而不是在 `apply` 时解析一次：host 平面行与本 preset 行的挂载先后
   * 不由我们决定，一次性解析会把"服务稍后才可用"永久固化成 `chart_url=null`。
   * 服务始终缺席（未安装/无 Web 载体/坏掉）时返回 undefined，整条链路照常降级：产物照样
   * 落盘、`html_path` 照样可 present，只是 `chart_url` 为 null。
   */
  charts?: () => ChartPublisher | undefined
  /**
   * 惰性解析"图表 → 本轮交付"发布器（官方 `deliverables/presented`）。
   *
   * 与 `charts` 同理每次出图解析一次：宿主平面的 `sessions` / `sessionProjections`
   * 不可用时返回 undefined，整条链路照常降级——图仍在 workspace 里，回执照样给 html_path，
   * 只是本轮交付行不会登记这张图。
   */
  chartEvents?: () => ChartEventPublisher | undefined
  now?: () => number
}

export async function renderChart(input: RenderChartInput, args: Record<string, unknown>, exec: ToolExecLike): Promise<ChartReceipt> {
  const now = input.now ?? (() => Date.now())
  const session = sessionOf(exec)
  const requestedDatasetId = typeof args.dataset_id === 'string' && args.dataset_id.trim().length > 0 ? args.dataset_id.trim() : undefined
  const path = typeof args.path === 'string' && args.path.trim().length > 0 ? args.path.trim() : undefined
  const chartSourceRef = typeof args.chart_source_ref === 'string' && args.chart_source_ref.trim().length > 0 ? args.chart_source_ref.trim() : undefined
  const sourceCount = [requestedDatasetId, path, chartSourceRef].filter((value) => value !== undefined).length
  if (sourceCount !== 1) {
    throw new ChartError('chart_source_invalid', 'provide exactly one data source: dataset_id, path, or chart_source_ref')
  }
  if (session.header?.parentSession && chartSourceRef === undefined) {
    throw new ChartError('chart_source_scope_mismatch', 'delegated visualization callers must use chart_source_ref')
  }
  const tokenSource = chartSourceRef === undefined ? undefined : chartSourceTokenForRender(input.sourceTokens, {
    chart_source_ref: chartSourceRef,
    task_id: args.task_id,
  }, session)
  const datasetId = tokenSource?.dataset_id ?? requestedDatasetId

  const spec = normalizeChartSpec(args.spec)
  if (typeof args.title === 'string' && args.title.trim().length > 0) spec.title = args.title.trim().slice(0, 200)

  // ── 取数：两条来源都在宿主进程内完成，rows 不进入任何消息 ────────────────────
  let rows: readonly unknown[]
  let meta: { source_kind: 'dataset' | 'path'; dataset_id?: string; source_label?: string; captured_at?: number }
  if (datasetId !== undefined) {
    // A chart_source_ref carries the direct data-agent session that already has
    // access to the parent Dataset scope. The nested visualization child is
    // only the caller of render_chart; it never receives raw rows.
    const readSession = tokenSource?.sourceSession ?? session
    const { ref, rows: datasetRows } = await input.store.readPresentationRows({ session: readSession, dataset_id: datasetId, signal: exec.signal })
    rows = datasetRows
    meta = { source_kind: 'dataset', dataset_id: ref.dataset_id, source_label: ref.source_label, captured_at: ref.captured_at }
  } else {
    const parsed = await input.store.readWorkspaceJson({ session, path: path!, signal: exec.signal })
    const extracted = extractRows(parsed)
    rows = extracted.rows
    meta = { source_kind: 'path' }
  }

  // ── 有界化 ───────────────────────────────────────────────────────────────
  const chartId = newChartId()
  const payload = buildChartPayload({ chart_id: chartId, spec, rows, meta })
  const library = loadVendoredChartLibrary()
  const generatedAt = now()
  const html = buildStandaloneHtml({ payload, library, generatedAt })
  const dir = `${CHART_ARTIFACT_DIR}/${chartId}`
  const written = await input.store.writeWorkspaceFiles({
    session,
    dir,
    files: [
      { name: 'spec.json', content: `${JSON.stringify({ chart_id: chartId, created_at: generatedAt, source: { dataset_id: meta.dataset_id ?? null, path: path ?? null }, spec }, null, 2)}\n` },
      { name: 'series.json', content: `${JSON.stringify(payload)}\n` },
      { name: 'chart.html', content: html },
    ],
    signal: exec.signal,
  })
  const pathOf = (name: string): string => written.find((file) => file.name === name)?.path ?? `${dir}/${name}`

  // 序列旁路：把 series.json 的**绝对路径**登记给 host 平面路由，客户端凭 chart_url 取数。
  // 登记失败（服务缺失/实现异常）不阻断出图——图已经落盘了，降级成"只有文件路径"。
  let chartUrl: string | null = null
  const seriesFile = written.find((file) => file.name === 'series.json')
  if (input.charts && seriesFile !== undefined) {
    try {
      chartUrl = input.charts()?.publish({ chartId, filePath: seriesFile.absolutePath }) ?? null
    } catch (error) {
      payload.meta.warnings.push(`序列旁路登记失败（回执只给文件路径）：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const taskId = tokenSource?.task_id
    ?? (typeof args.task_id === 'string' && args.task_id.trim().length > 0 ? args.task_id.trim() : null)
  const artifact = input.artifacts?.issue({
    session: tokenSource?.sourceSession ?? session,
    chart_id: chartId,
    task_id: taskId,
    dataset_id: meta.dataset_id ?? null,
    source_label: meta.source_label ?? null,
    captured_at: meta.captured_at ?? null,
    kind: payload.kind,
    axis: payload.axis,
    chart_url: chartUrl,
    spec_path: pathOf('spec.json'),
    series_path: pathOf('series.json'),
    html_path: pathOf('chart.html'),
    created_at: generatedAt,
  })
  // Direct unit callers that do not install the production registry still get
  // a stable receipt; production apply() always injects the registry.
  const chartRef = artifact?.chart_ref ?? `chart_${chartId.slice(3)}`

  // 对话流呈现：把这张图登记为**用户正在看的那条会话**的本轮交付物
  // （owner scope 与 chart_ref 同源，因此 specialist 出的图正好落在主会话）。
  // 走官方 `deliverables/presented`——**不能**改回自定义事件类型：会话日志的事件词汇表
  // 是闭集，非 first-party 类型会让整份会话在冷加载时打不开（事故记录见 src/chart/events.ts）。
  // 事件不进模型消息历史。呈现通道可选：写不进去不影响图表产物与回执。
  try {
    input.chartEvents?.()?.publish({
      ownerSessionId: chartSessionScopeId(tokenSource?.sourceSession ?? session),
      chart_id: chartId,
      title: payload.title,
      html_path: pathOf('chart.html'),
    })
  } catch {
    // 事件通道是可选的呈现路径，绝不因它失败而影响出图。
  }

  return {
    chart_ref: chartRef,
    chart_id: chartId,
    kind: payload.kind,
    axis: payload.axis,
    title: payload.title,
    points: payload.meta.points,
    original_points: payload.meta.original_points,
    downsampled: payload.meta.downsampled,
    series_labels: payload.series.map((item) => item.label).concat(payload.ohlc ? [payload.ohlc.label] : []),
    has_volume: payload.volume !== undefined,
    markers: payload.markers.length,
    dataset_id: meta.dataset_id ?? null,
    source_label: meta.source_label ?? null,
    captured_at: meta.captured_at ?? null,
    chart_url: chartUrl,
    spec_path: pathOf('spec.json'),
    series_path: pathOf('series.json'),
    html_path: pathOf('chart.html'),
    warnings: payload.meta.warnings,
  }
}

export function registerChartTool(ctx: Context, options: RenderChartInput): void {
  const tools = ctx.get('tools') as ToolRuntimeLike | undefined
  if (!tools) return
  const definition = {
    name: 'render_chart',
    description:
      `把已经取到的数据渲染成一张可交互图，产物落在 workspace 的 ${CHART_ARTIFACT_DIR}/<chart_id>/（chart.html 可离线打开）。` +
      '**只回一条小回执，不回任何原始数据行**：序列走旁路，不进入上下文。' +
      '来源三选一：dataset_id（已授权的 DatasetRef）、path（workspace 相对路径的 JSON，支持顶层数组或含行数组的 envelope），或 chart_source_ref（宿主签发给 visualization_specialist 的短期 token；使用它时还要提供 task_id）。' +
      'spec 是自由对象，至少给出 kind（line / area / column / candlestick / bar；后两者要 ohlc 四字段与真实时间列）与字段选择（series 或 ohlc），' +
      `最多保留 ${MAX_CHART_POINTS} 个点（超出由宿主下采样并如实标注）。` +
      '字段语义、可用键与错误码见 skill capital-chart-protocol —— 首次画图前先加载它。' +
      '是否出图由 data_junior 的可视化协议决定；本工具只负责安全生成图表产物和小型回执。' +
      '出图成功后宿主会把这张图登记为当前对话的**本轮交付物**（官方 deliverables/presented），用户可从收尾的交付行点开自包含图表；调用方**不要**在回传或正文里罗列图表文件、路径或 HTML。' +
      '图表是呈现不是分析：需要数值结论（首末值、涨跌幅、分位数等）仍走 data_junior 的 profile / query，不要用图去推断数字。',
    parameters,
    output: { schema: receiptSchema, render },
    async execute(args: Record<string, unknown>, exec: ToolExecLike): Promise<ChartReceipt> {
      try {
        return await renderChart(options, args, exec)
      } catch (error) {
        throw toolVisibleError(error)
      }
    },
  }
  ctx.effect(() => tools.register(definition), 'capital-generation.tool(render_chart)')
}
