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

import { WorkspaceDatasetStore } from '../data-collector/store.js'
import { ChartError } from './errors.js'
import { buildStandaloneHtml, loadVendoredChartLibrary } from './html.js'
import { buildChartPayload, extractRows, MAX_CHART_POINTS } from './series.js'
import { normalizeChartSpec } from './spec.js'

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

const receiptSchema = jsonObject({
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
  'chart_id', 'kind', 'axis', 'points', 'original_points', 'downsampled',
  'series_labels', 'has_volume', 'markers', 'dataset_id', 'source_label',
  'captured_at', 'chart_url', 'spec_path', 'series_path', 'html_path', 'warnings',
])

const parameters = jsonObject({
  dataset_id: { type: 'string', description: '数据来源之一：已授权的 DatasetRef 的 dataset_id（与 path 二选一）' },
  path: { type: 'string', description: '数据来源之一：workspace 相对路径的 JSON 文件，如 capital-data/datasets/x/raw.json（与 dataset_id 二选一）' },
  spec: {
    type: 'object',
    additionalProperties: true,
    description: '图表描述，至少 { kind, x?, series? | ohlc?, volume?, markers?, range?, title? }；字段语义与错误码见 skill capital-chart-protocol',
  },
  title: { type: 'string', description: '可选：覆盖 spec.title 的图表标题' },
}, ['spec'])

/** 回执字段全部是可以进上下文的小元数据；序列本体永远不在这里。 */
export interface ChartReceipt {
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
  publish(input: { chartId: string; filePath: string }): string
}

export interface RenderChartInput {
  store: WorkspaceDatasetStore
  /**
   * 惰性解析 host 平面图表服务（`@v587d/capital-charts` 提供）。
   *
   * 每次画图时解析，而不是在 `apply` 时解析一次：host 平面行与本 preset 行的挂载先后
   * 不由我们决定，一次性解析会把"服务稍后才可用"永久固化成 `chart_url=null`。
   * 服务始终缺席（未安装/无 Web 载体/坏掉）时返回 undefined，整条链路照常降级：产物照样
   * 落盘、`html_path` 照样可 present，只是 `chart_url` 为 null。
   */
  charts?: () => ChartPublisher | undefined
  now?: () => number
}

export async function renderChart(input: RenderChartInput, args: Record<string, unknown>, exec: ToolExecLike): Promise<ChartReceipt> {
  const now = input.now ?? (() => Date.now())
  const session = sessionOf(exec)
  const datasetId = typeof args.dataset_id === 'string' && args.dataset_id.trim().length > 0 ? args.dataset_id.trim() : undefined
  const path = typeof args.path === 'string' && args.path.trim().length > 0 ? args.path.trim() : undefined
  if ((datasetId === undefined) === (path === undefined)) {
    throw new ChartError('chart_source_invalid', 'provide exactly one data source: dataset_id (an authorized DatasetRef) or path (a workspace-relative JSON file)')
  }

  const spec = normalizeChartSpec(args.spec)
  if (typeof args.title === 'string' && args.title.trim().length > 0) spec.title = args.title.trim().slice(0, 200)

  // ── 取数：两条来源都在宿主进程内完成，rows 不进入任何消息 ────────────────────
  let rows: readonly unknown[]
  let meta: { source_kind: 'dataset' | 'path'; dataset_id?: string; source_label?: string; captured_at?: number }
  if (datasetId !== undefined) {
    const { ref, rows: datasetRows } = await input.store.readPresentationRows({ session, dataset_id: datasetId, signal: exec.signal })
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

  return {
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
      `把已经取到的数据渲染成一张可交互图，产物落在 workspace 的 ${CHART_ARTIFACT_DIR}/<chart_id>/（chart.html 可离线打开、可 present）。` +
      '**只回一条小回执，不回任何原始数据行**：序列走旁路，不进入上下文。' +
      '来源二选一：dataset_id（已授权的 DatasetRef）或 path（workspace 相对路径的 JSON，支持顶层数组或含行数组的 envelope）。' +
      'spec 是自由对象，至少给出 kind（line / area / column / candlestick / bar；后两者要 ohlc 四字段与真实时间列）与字段选择（series 或 ohlc），' +
      `最多保留 ${MAX_CHART_POINTS} 个点（超出由宿主下采样并如实标注）。` +
      '字段语义、可用键与错误码见 skill capital-chart-protocol —— 首次画图前先加载它。' +
      '结果里有时间序列（行情 / 净值 / 营收等）时，除文字结论外应**主动出一张图**，不要等用户点名；' +
      '图表是呈现不是分析：需要数值结论（首末值、涨跌幅、分位数等）仍走 data_junior 的 profile / query，不要用图去推断数字。',
    parameters,
    output: { schema: receiptSchema, render },
    async execute(args: Record<string, unknown>, exec: ToolExecLike): Promise<ChartReceipt> {
      return renderChart(options, args, exec)
    },
  }
  ctx.effect(() => tools.register(definition), 'capital-generation.tool(render_chart)')
}
