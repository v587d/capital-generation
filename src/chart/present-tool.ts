/**
 * present_charts: the root Agent's final-turn delivery step.
 *
 * render_chart only mints a chart_ref (the specialist row no longer auto-delivers). DSH's
 * deliverable card replays only declarations recorded before the closing assistant message, so
 * the card has to be written by the turn that carries the final answer: the root Agent presents
 * its collected refs/deliverables here immediately before writing that answer. Never a custom
 * event type — the session-event vocabulary is closed (see events.ts).
 */
import type { Context } from '@deepseek-ai/cordis'

import type { ChartArtifactRef, ChartArtifactRegistry } from './artifact-ref.js'
import { MAX_CHARTS_PER_TURN, type ChartEventPublisher } from './events.js'
import { callerSession, type AgentExecutionLike } from '../tool-exec.js'
import type { SessionLike } from '../data-collector/store.js'

type ToolRuntimeLike = { register(definition: unknown): () => void }
type PresentExecLike = AgentExecutionLike

const jsonObject = (properties: Record<string, unknown> = {}, required: string[] = []): object =>
  ({ type: 'object', properties, required, additionalProperties: false })

export interface PresentChartsInput {
  artifacts: ChartArtifactRegistry
  /** Lazy: the host projection may mount after this row; an absent publisher fails the call loudly. */
  chartEvents: () => ChartEventPublisher | undefined
}

export interface PresentChartsReceipt {
  presented: Array<{ chart_ref: string; title: string }>
  failed: Array<{ chart_ref: string; reason: string }>
}

const parameters = jsonObject({
  chart_refs: {
    type: 'array',
    items: { type: 'string' },
    description: 'data_junior 回传的全部 chart_ref，一次传完（最多 8 个，不猜写）。与 task_id 至少给一个。',
  },
  task_id: {
    type: 'string',
    description: '本任务 canonical task_id：省略 chart_refs 时按它登记本会话该任务的全部图表（上下文压缩后记不清 refs 时用）。',
  },
})

const receiptSchema = jsonObject({
  presented: {
    type: 'array',
    items: jsonObject({
      chart_ref: { type: 'string' },
      title: { type: 'string' },
    }, ['chart_ref', 'title']),
  },
  failed: {
    type: 'array',
    items: jsonObject({
      chart_ref: { type: 'string' },
      reason: { type: 'string' },
    }, ['chart_ref', 'reason']),
  },
}, ['presented', 'failed'])

function normalizeRefs(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('present_charts 的 chart_refs 必须是字符串数组')
  const refs: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) throw new Error('present_charts 的 chart_refs 里不能有空值')
    const ref = item.trim()
    if (!refs.includes(ref)) refs.push(ref)
  }
  if (refs.length > MAX_CHARTS_PER_TURN) {
    throw new Error(`present_charts 一次最多登记 ${MAX_CHARTS_PER_TURN} 张图（收到 ${refs.length} 个 chart_ref）`)
  }
  return refs
}

function normalizeTaskId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('present_charts 的 task_id 必须是非空字符串')
  return value.trim()
}

/** Present refs first; otherwise present the whole task so compaction cannot strand the charts. */
function selectArtifacts(input: PresentChartsInput, session: SessionLike, refs: string[], taskId: string | undefined): { selected: ChartArtifactRef[]; failed: PresentChartsReceipt['failed'] } {
  const failed: PresentChartsReceipt['failed'] = []
  if (refs.length > 0) {
    const selected: ChartArtifactRef[] = []
    for (const chartRef of refs) {
      try {
        selected.push(input.artifacts.resolve({ session, chart_ref: chartRef, task_id: taskId }))
      } catch (error) {
        failed.push({ chart_ref: chartRef, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    // A stale ref set must not strand charts the task_id can still find (compaction can mix both).
    if (selected.length > 0 || taskId === undefined) return { selected, failed }
  }
  if (taskId === undefined) throw new Error('present_charts 需要 chart_refs 或 task_id：两者都不给就无法确定要登记哪几张图')
  const all = input.artifacts.list({ session, task_id: taskId })
  if (all.length === 0) failed.push({ chart_ref: '(task)', reason: `本会话该 task_id 没有可登记的图表：${taskId}` })
  const selected = all.slice(0, MAX_CHARTS_PER_TURN)
  if (all.length > MAX_CHARTS_PER_TURN) {
    failed.push({ chart_ref: '(task)', reason: `该 task_id 有 ${all.length} 张图，本轮最多登记 ${MAX_CHARTS_PER_TURN} 张；其余未展示` })
  }
  return { selected, failed }
}

export function registerPresentChartsTool(ctx: Context, input: PresentChartsInput): void {
  const tools = ctx.get('tools') as ToolRuntimeLike | undefined
  if (!tools) return
  const definition = {
    name: 'present_charts',
    description:
      '把本会话已生成的图表登记为**最终答复的交付物**（官方 deliverables/presented）：用户会在本轮答复末尾的「本轮文件改动 / 交付」行看到卡片，点开即渲染自包含 chart.html。'
      + '**只由主 Agent 在写最终答复前调用一次**：参数是 data_junior 回传的 chart_refs（一次全部传入，最多 8 个）；refs 已丢失时改传 task_id 登记该任务的全部图表；调用后立刻写最终答复。'
      + '不要在过程轮 / 等待行前调用，不要分批重复调用；不要传文件路径或 HTML（路径由宿主解析）。'
      + '不调用本工具，图表不会出现在对话里。',
    parameters,
    async execute(args: Record<string, unknown>, exec: PresentExecLike): Promise<PresentChartsReceipt> {
      const session = callerSession(exec)
      const refs = normalizeRefs(args.chart_refs)
      const taskId = normalizeTaskId(args.task_id)
      if (refs.length === 0 && taskId === undefined) {
        throw new Error('present_charts 需要 chart_refs 或 task_id：两者都不给就无法确定要登记哪几张图')
      }
      const publisher = input.chartEvents()
      if (publisher === undefined) {
        throw new Error('图表交付通道不可用（sessions / sessionProjections 解析不到）：图表已落盘，可在 workspace 打开 chart.html')
      }
      const { selected, failed } = selectArtifacts(input, session, refs, taskId)
      const receipt: PresentChartsReceipt = { presented: [], failed }
      for (const artifact of selected) {
        const accepted = publisher.publish({
          ownerSessionId: session.id,
          chart_id: artifact.chart_id,
          title: artifact.title,
          html_path: artifact.html_path,
        })
        if (accepted) receipt.presented.push({ chart_ref: artifact.chart_ref, title: artifact.title })
        else receipt.failed.push({ chart_ref: artifact.chart_ref, reason: `本轮登记已达 ${MAX_CHARTS_PER_TURN} 张上限或回合已关闭，未写入交付行` })
      }
      return receipt
    },
    output: {
      schema: receiptSchema,
      render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
  }
  ctx.effect(() => tools.register(definition), 'capital-generation.tool(present_charts)')
}
