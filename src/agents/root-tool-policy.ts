/**
 * 根 Agent 的工具收敛：把"只有子 Agent 该用"的工具从**主 Agent**的工具表里拿掉。
 *
 * 为什么需要它：preset 行注册在 standing composition 层，而主 Agent 与子 Agent 的
 * scope 都是 standing 的**子节点（兄弟）**。因此：
 *  - 在 preset 层用 `tools.restrict({deny})` 会把子 Agent 一起 deny
 *    （`dsh-tools` 的 `view()` 里 allow/deny 只是交集过滤，永远不能把祖先 deny 掉的名字加回来），
 *    连 `visualization_specialist` 的 `toolFilter.allow: [render_chart]` 都会失效；
 *  - 只在**根 Agent 自己的 scope** 上 deny，才既拿掉主 Agent 的入口、又不影响子 Agent。
 *
 * ⚠️ 监听必须注册在**未打 scope 标签的 context**（`ctx.root`）上。
 * 实测（2026-09-17，dsh 0.1.5-rc.1）：`agent/created` 的路由键是 **agent 对象本身**
 * （`dsh-agent` 的 `agentCarrier(agent) = scopeTarget(agent, agent)`），不是 agent 的 scope key。
 * `dsh-scope` 的准入规则只放行"未打标签的监听器"或"键在 carrier key 祖先链上"的监听器，
 * 所以注册在 standing scope 上的监听器**收不到**这个事件——表现是主 Agent 的工具表照旧有
 * `render_chart`，而且没有任何报错（静默失效）。宿主平面行之所以能用 `ctx.on('agent/created')`，
 * 正是因为它们未打标签。因此这里取 `ctx.root`，再用 `agentPresets.composedPreset(agent.ctx)`
 * 筛出本 preset 的 agent。
 */

/**
 * 出网工具名（唯一一份事实来源）：检索面 2 + wind 2 + 具名来源查询面 9。
 *
 * ⚠️ **不含 `ocr`**：主 Agent 保留它的本地形态（`file` / `doc_id`），只由
 * {@link rootOcrGuardReason} 关掉 `url` 形态——名字级 deny 做不到这个区分。
 *
 * 主 Agent 侧「外部检索只经 web_retriever 回传」必须是**结构件**，不能只写在 persona 里：
 * 2026-09-24 review 复现——persona 禁直连清单当时写的是 `web_retriever_*` 通配，工具改名后
 * 通配一个都不匹配，禁令名存实亡，而工具表里那 13 个入口始终摆着。逐名 deny 由本清单决定，
 * preset 与测试都从这里取名字（`test/persona.test.mjs` 交叉核验），新增来源只改这一处。
 */
export const RETRIEVAL_DENIED_TOOLS = [
  'anysearch_search', 'web_retriever_fetch',
  'wind_docs_announcements', 'wind_docs_news',
  'cls_telegraph', 'wscn_lives', 'cninfo_irm', 'sseinfo_qa',
  'eastmoney_724', 'eastmoney_stock_news', 'eastmoney_reports', 'sina_reports', 'ths_eps_forecast',
] as const

/**
 * 宿主自己挂的检索工具：persona 早就禁过它们，这里把禁令变成结构件。
 *
 * ⚠️ 这两个名字**只能出现在根收敛里，不能进 preset 的 `toolFilter.deny`**：它们不由本插件
 * 注册，`restrict()` 对未注册名字报错的表现是"创建子 Agent 失败"。根侧逐名 restrict 的
 * try/catch 正好容忍"这个 scope 里根本没有这个名字"，所以放在这里是安全的（装了就有、没装就跳）。
 */
const HOST_RETRIEVAL_DENIED_TOOLS = ['web_search', 'web_fetch'] as const

/** 文档解析工具名（`web_retriever` 的第三个工作面）。 */
export const OCR_TOOL_NAME = 'ocr'

/**
 * 根 Agent 的 `ocr` 只放行**本地形态**（`file` / `doc_id`），`url` 形态拒绝。
 *
 * 为什么不整名 deny：用户把 PDF 放在工作目录用 `@xxx.pdf` 推给主 Agent 是正当入口，
 * 解析它不需要经过委派；但 `url` 形态等于"主 Agent 自己决定去戳一个外部链接"，
 * 那是「外部检索只经 web_retriever」这条结构约束唯一被留的口子。名字级 deny 做不到
 * 这个区分（`render_chart` 的教训一样：可见性不是权限），所以用调用级 guard。
 */
export const OCR_ROOT_URL_DENIED
  = 'ocr 的 url 形态只对被委派的 web_retriever 开放：外部 PDF 链接请委派 subagent_web_retriever 解析。'
    + '工作目录里的本地文档（file）与已解析产物（doc_id + pages/query）可以直接调用。'

/** guard 的调用形状里 `arguments` 是解析后的对象（不是 JSON 字符串）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 单次调用的判定：根 Agent 用 `ocr` 提交外部 `url` 才拒绝，其余一律放行。 */
export function rootOcrGuardReason(exec: GuardedExecution | undefined): string | undefined {
  if (exec?.name !== OCR_TOOL_NAME) return undefined
  const args = isRecord(exec.arguments) ? exec.arguments : undefined
  if (args !== undefined && typeof args.url === 'string' && args.url.length > 0) return OCR_ROOT_URL_DENIED
  return undefined
}

export const ROOT_AGENT_DENIED_TOOLS = [
  /** 出图只走 data_junior 的可视化 gate（main → junior → specialist）。 */
  'render_chart',
  /** 孙 Agent 的创建工具只属于 data_junior：主 Agent 拿到它只会绕过 gate。 */
  'subagent_visualization_specialist',
  /** 只签发给 delegated data agent（运行时本就拒绝根会话），留在表里只会诱导误调。 */
  'prepare_chart_source',
  /**
   * 十三个出网工具全部收敛：外部检索只有一个入口（web_retriever 子 Agent），它的兄弟行
   * （data_collector / data_junior / visualization_specialist）的 allow 里本来就没有这些名字，
   * 因此根侧 deny 不影响它们，只拿掉主 Agent 自己的直连能力。
   * 唯一的例外是 `ocr`：它同时服务"解析外部 PDF 链接"与"解析用户放在工作目录的本地文档"，
   * 后者是主 Agent 的正当入口，所以不整名 deny，改由 {@link rootOcrGuardReason} 关掉 `url` 形态。
   */
  ...RETRIEVAL_DENIED_TOOLS,
  ...HOST_RETRIEVAL_DENIED_TOOLS,
  /**
   * bash 只给 data_junior（它是数据侧的"纯计算兜底"）。主 Agent 不需要它，而且一旦拥有
   * 就等于拿到通用执行 + 整机读 + 出网能力，会绕过数据调度与出图两道结构 gate。
   * 注意 preset 里那两行 shell 是**平台成对**挂载的（Windows 上是 pwsh），名字由平台决定。
   */
  'bash', 'pwsh',
] as const

/** 本 preset 的 id（`composedPreset` 的返回值）。 */
export const CAPITAL_PRESET_ID = 'capital-generation'

interface ToolRestriction { allow?: readonly string[]; deny?: readonly string[] }
/**
 * `ctx.tools` 里本仓真正用到的两个方法。
 *
 * `guard` 是单调执行闸门（`dsh-tools` 的 `ToolGuard`）：同步检查一次调用，返回字符串即拒绝，
 * **没有 allow 结果**，所以任何监听顺序都翻不回 allow。bash 闸门（`bash-guard.ts`）用它，
 * 因为「只按调用内容 deny」这件事只有这里有正确的语义。
 */
interface RestrictedToolRuntime {
  restrict?(filter: ToolRestriction): unknown
  guard?(guard: (execution: GuardedExecution) => string | undefined): unknown
}

/** 闸门看到的调用形状（`name` + 解析后的 `arguments` + 调用方 agent）。 */
export interface GuardedExecution {
  readonly name?: string
  readonly arguments?: unknown
  readonly agent?: AgentLike
}

/** 事件载荷里我们真正用到的 Agent 形状。 */
export interface AgentLike {
  readonly session?: { readonly id?: string; readonly header?: { readonly parentSession?: string } }
  readonly ctx?: { readonly tools?: RestrictedToolRuntime; readonly [key: string]: unknown }
}

/** 监听用的 context 形状（结构类型，便于单测注入假实现）。 */
export interface PolicyContext {
  on?(event: string, listener: (payload: { agent?: AgentLike }) => void): unknown
  effect?(callback: () => unknown, label?: string): unknown
  get?(name: string): unknown
  logger?: { warn(message: string): void }
  readonly root?: PolicyContext
  readonly [key: string]: unknown
}

export type RootToolPolicyOutcome = 'restricted' | 'skipped' | 'unavailable'

/** 根 Agent 判据：没有 parentSession。子 Agent 一律有（spawn provider 写入）。 */
export function isRootAgent(agent: AgentLike | undefined): boolean {
  if (agent?.session === undefined) return false
  const parent = agent.session.header?.parentSession
  return typeof parent !== 'string' || parent.length === 0
}

/** 会话 id（guard 归档用）；缺失或空串返回 undefined。 */
export function agentSessionId(agent: AgentLike | undefined): string | undefined {
  const id = agent?.session?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** 只有本 preset 的 agent 才收敛：别的 preset 的 agent 不该被我们碰。 */
export function isCapitalAgent(ctx: PolicyContext, agent: AgentLike | undefined): boolean {
  let presets: { composedPreset?: (agentCtx: unknown) => string | undefined } | undefined
  try {
    presets = ctx.get?.('agentPresets') as typeof presets
  } catch {
    presets = undefined
  }
  if (presets === undefined || typeof presets.composedPreset !== 'function') {
    // 读不到 registry 时保守放行：逐名 restrict 本身会拒绝未知工具名，不会误伤别的 preset。
    return true
  }
  try {
    return presets.composedPreset(agent?.ctx) === CAPITAL_PRESET_ID
  } catch {
    return false
  }
}

/**
 * 只对根 Agent 生效地 deny {@link ROOT_AGENT_DENIED_TOOLS}。
 *
 * 逐名 restrict：`tools.restrict()` 对"本 scope 看不到的名字"会抛错（别的 preset、或行还没挂载），
 * 逐名调用把这种"本来就不该有"的情况变成无害跳过，而不是整批失败。
 * 任何异常都不抛出：调用方是 agent 创建路径，宁可少收敛也不能挡住建 agent。
 */
export function restrictRootAgentTools(agent: AgentLike | undefined): RootToolPolicyOutcome {
  if (!isRootAgent(agent)) return 'skipped'
  let tools: RestrictedToolRuntime | undefined
  try {
    tools = agent?.ctx?.tools
  } catch {
    return 'unavailable'
  }
  if (tools === undefined || typeof tools.restrict !== 'function') return 'unavailable'
  for (const name of ROOT_AGENT_DENIED_TOOLS) {
    try {
      tools.restrict({ deny: [name] })
    } catch {
      // 这个 scope 本来就没有这个名字（别的 preset / 该行未挂载）：跳过即可。
    }
  }
  return 'restricted'
}

/**
 * 在**根 Agent 自己的 scope** 上装 `ocr` 的调用级闸门（子 Agent 不装：`url` 形态归它们）。
 *
 * 与 `restrictRootAgentTools` 同一个监听、同一份判据；guard 不可用或安装异常都不影响
 * 已经完成的 deny 收敛（宁可少一层闸门，不能挡住建 agent）。
 */
export function installRootOcrGuard(agent: AgentLike | undefined): (() => void) | undefined {
  if (!isRootAgent(agent)) return undefined
  let tools: RestrictedToolRuntime | undefined
  try {
    tools = agent?.ctx?.tools
  } catch {
    return undefined
  }
  if (tools === undefined || typeof tools.guard !== 'function') return undefined
  try {
    const dispose = tools.guard(rootOcrGuardReason)
    return typeof dispose === 'function' ? (dispose as () => void) : undefined
  } catch {
    return undefined
  }
}

/**
 * 注册 `agent/created` 监听。监听器只做一件事：对本 preset 的根 Agent 收敛一次。
 *
 * 注册位置是 Root context（未打标签），因此能收到全部 agent；`agentPresets` 负责筛出本 preset。
 * Root 监听器不随本 fiber 卸载，所以显式用 `ctx.effect` 持有它的 disposer。
 */
export function registerRootToolPolicy(ctx: PolicyContext): void {
  const listenCtx = ctx.root ?? ctx
  if (typeof listenCtx.on !== 'function') return
  /** 根 Agent 会话 id → `ocr` guard 的 disposer；agent/disposed 时释放，避免跨实例残留。 */
  const guards = new Map<string, () => void>()
  const install = () => {
    const stopCreated = listenCtx.on?.('agent/created', (payload: { agent?: AgentLike }) => {
      try {
        const agent = payload?.agent
        if (!isCapitalAgent(ctx, agent)) return
        const outcome = restrictRootAgentTools(agent)
        if (outcome === 'unavailable') {
          ctx.logger?.warn(`capital-generation: 根 Agent 工具收敛未生效（${outcome}）：主 Agent 仍会看到 ${ROOT_AGENT_DENIED_TOOLS.join(' / ')}`)
        }
        const dispose = installRootOcrGuard(agent)
        const id = agentSessionId(agent)
        if (dispose !== undefined && id !== undefined) guards.set(id, dispose)
      } catch (error) {
        ctx.logger?.warn(`capital-generation: 根 Agent 工具收敛异常：${error instanceof Error ? error.message : String(error)}`)
      }
    })
    const stopDisposed = listenCtx.on?.('agent/disposed', (payload: { agent?: AgentLike }) => {
      try {
        const id = agentSessionId(payload?.agent)
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
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    }, 'capital-generation.root-tool-policy()')
    return
  }
  install()
}
