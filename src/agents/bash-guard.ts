/**
 * data_junior 的 bash 调用闸门（两层，都是**可靠判定**，不看命令内容）。
 *
 * 背景与边界（设计理由全文在 preset/capital-generation/README.md）：
 *  - bash 不是计算器，是一台完整终端。本仓实测：沙箱**只拦写**（workspace + /tmp 之外
 *    一律 EROFS），**不拦读**（`~/.dsh/.credentials.yaml`、`sessions/**` 整机可读），
 *    **不拦网络**（`curl` 直连 200）。这是 DSH 沙箱词汇表的既定边界——`SandboxMode`
 *    只覆盖文件效果，官方文档亦如此声明。
 *  - 因此本文件**不做命令内容匹配**：正则挡不住 `node -e`/`python3 -c`，而 node/python
 *    正是引入 bash 的目的（未来 data_analyst 也靠它）。禁区与出网纪律走 data_junior 的
 *    persona 软约束，不在这里伪装成安全边界。
 *  - 沙箱写边界也无法单独收窄：数据集管线自己就走沙箱，`store.writeContext()` 用**调用方
 *    session** 的 policy 且要求 mode ∈ {workspace-write, danger-full-access}，把 data_junior
 *    的会话钉成 read-only 会直接打断 `describe_dataset` 的 profile 落盘
 *    （`workspace_not_writable`）。bash 与 Dataset 管线共用同一把尺子（session policy）。
 *
 * 两层规则：
 *  A 结构层：bash 只对**被委派**的子会话开放（镜像 src/tool-exec.ts 的 delegatedSession）——
 *    即使哪天 ROOT_AGENT_DENIED_TOOLS 或 allow 过滤被改坏，执行层仍然拒绝根会话。
 *    docs/dev/bash-gate.md「工具可见性不是权限隔离」。
 *  B UX 层：委派子会话的审批策略由框架固定为 `never`（dsh-subagent 的
 *    `captureDelegatedPolicyOverrides` → `approval/policy: never`，`dsh-user-approval.decide()`
 *    在 never 时**直接返回 rejected、根本不调用 answerer**），所以 `sandbox_permissions`
 *    必然失败，而且模型会收到「the user rejected…」这种**把系统拒绝说成用户拒绝**的文案。
 *    这里提前拦下并给出正确路径：省一次必然白跑的往返 + 纠正归因。
 *
 * 为什么用 `tools.guard` 而不是 `tools/pre-execute`：guard 是**单调**的（没有 allow 结果，
 * 任何监听顺序都无法把别人的 deny 翻回 allow），同步、拿到解析后的 `arguments`，且
 * 「注册在 agent.ctx 上就只作用于该 agent」。pre-execute 是 waterfall，可扩展也意味着可被后续
 * 监听改写。
 */

import { isCapitalAgent, type AgentLike, type GuardedExecution, type PolicyContext } from './root-tool-policy.js'

/** bash 工具名（`@deepseek-ai/dsh-tool-bash` 注册的全局名）。 */
export const BASH_TOOL_NAME = 'bash'

/** 闸门看到的调用形状：guard 拿到的是解析后的 arguments，不是一个 shell 字符串。 */
export type BashGuardExecution = GuardedExecution

/** A 结构层拒绝文案：模型可据此改走委派。 */
export const BASH_DELEGATED_ONLY
  = 'bash 只对被委派的数据子 Agent 开放，当前调用方不是被委派的子会话；数据与统计请由主 Agent 委派 data_collector / data_junior。'

/** B UX 层拒绝文案：说清"这不是用户拒绝"，并给出正确路径。 */
export const BASH_ESCALATION_UNREACHABLE
  = 'bash 的沙箱升级在子 Agent 会话里永远无法获批（框架把委派会话的审批策略固定为 never，不会去问用户），不要重试：'
    + '缺数值用 describe_dataset / query_dataset，缺数据用 send_message 发 data_gap 回主 Agent。'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 单次 bash 调用的判定：返回拒绝理由，或 undefined 放行。
 *
 * 判定顺序是"先身份、后能力"：身份不对时不该让模型以为问题出在参数上。
 * 注意这里**只读两个字段**（调用方身份、`sandbox_permissions`/`justification`），
 * 绝不解析 `command`——理由见文件头。
 */
export function bashGuardReason(exec: BashGuardExecution | undefined): string | undefined {
  if (exec?.name !== BASH_TOOL_NAME) return undefined
  const parent = exec.agent?.session?.header?.parentSession
  if (typeof parent !== 'string' || parent.length === 0) return BASH_DELEGATED_ONLY
  const args = isRecord(exec.arguments) ? exec.arguments : undefined
  if (args !== undefined && (args.sandbox_permissions !== undefined || args.justification !== undefined)) {
    return BASH_ESCALATION_UNREACHABLE
  }
  return undefined
}

/** 事件载荷里我们真正用到的形状（与 dsh-tool-subagent 的 payload 对齐）。 */
interface AgentEventPayload { readonly agent?: AgentLike }

/** `agent.ctx.tools` 的类型（`RestrictedToolRuntime` 是内部接口，用索引访问取）。 */
type AgentToolRuntime = NonNullable<NonNullable<AgentLike['ctx']>['tools']>

/** 在某个 agent 自己的 scope 上安装 guard，返回 disposer（不可用时返回 undefined）。 */
function installAgentGuard(agent: AgentLike | undefined): (() => void) | undefined {
  let tools: AgentToolRuntime | undefined
  try {
    tools = agent?.ctx?.tools
  } catch {
    return undefined
  }
  if (tools === undefined || typeof tools.guard !== 'function') return undefined
  try {
    const dispose = tools.guard(bashGuardReason)
    return typeof dispose === 'function' ? (dispose as () => void) : undefined
  } catch {
    return undefined
  }
}

/**
 * 注册 bash 闸门：对**本 preset 的每个 agent** 在它自己的 scope 上装一次 guard。
 *
 * 监听位置与 `registerRootToolPolicy` 同因：`agent/created` 的路由键是 agent 对象本身，
 * 注册在 standing scope（打了标签）的监听器**收不到且不报错**，必须挂 `ctx.root`。
 * 安装/释放都不得抛回 agent 创建路径——宁可少一层闸门，也不能挡住建 agent；
 * 静默失败会留下诊断 warn（见 `registerBashGuard` 的返回值处理）。
 */
export function registerBashGuard(ctx: PolicyContext): void {
  const listenCtx = ctx.root ?? ctx
  if (typeof listenCtx.on !== 'function') return
  /** agent 会话 id → guard 的 disposer；agent/disposed 时释放，避免跨实例残留。 */
  const guards = new Map<string, () => void>()
  const sessionIdOf = (agent: AgentLike | undefined): string | undefined => {
    const id = (agent?.session as { id?: unknown } | undefined)?.id
    return typeof id === 'string' && id.length > 0 ? id : undefined
  }
  const install = () => {
    const stopCreated = listenCtx.on?.('agent/created', (payload: AgentEventPayload) => {
      try {
        const agent = payload?.agent
        if (!isCapitalAgent(ctx, agent)) return
        const dispose = installAgentGuard(agent)
        if (dispose === undefined) {
          ctx.logger?.warn('capital-generation: bash 闸门未生效（agent scope 上没有 tools.guard）：data_junior 的 bash 只剩 persona 软约束')
          return
        }
        const id = sessionIdOf(agent)
        if (id !== undefined) guards.set(id, dispose)
      } catch (error) {
        ctx.logger?.warn(`capital-generation: bash 闸门安装异常：${error instanceof Error ? error.message : String(error)}`)
      }
    })
    const stopDisposed = listenCtx.on?.('agent/disposed', (payload: AgentEventPayload) => {
      try {
        const id = sessionIdOf(payload?.agent)
        if (id === undefined) return
        const dispose = guards.get(id)
        if (dispose === undefined) return
        guards.delete(id)
        dispose()
      } catch { /* 释放失败不该影响 agent 拆除路径 */ }
    })
    return () => {
      try { if (typeof stopCreated === 'function') stopCreated() } catch { /* ignore */ }
      try { if (typeof stopDisposed === 'function') stopDisposed() } catch { /* ignore */ }
      for (const dispose of guards.values()) {
        try { dispose() } catch { /* ignore */ }
      }
      guards.clear()
    }
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const dispose = install()
      return () => dispose()
    }, 'capital-generation.bash-guard()')
    return
  }
  install()
}
