import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentSessionId, isRootAgent, type AgentLike, type PolicyContext } from './root-tool-policy.js'
// The catalog is a shipped data file outside the TypeScript root; runtime keeps this
// import so the published lib resolves the same metadata beside the pinned snapshots.
// @ts-expect-error catalog.js is intentionally maintained as package data.
import { SELECTED_SKILL_CATALOG as CATALOG, SELECTED_SKILL_SKILL_DIRS, SELECTED_SKILL_TASK_IDS, selectedSkillsForTask } from '../../selected-skills/catalog.js'

export type SelectedSkillStatus = 'experimental' | 'watchlist'
export type SelectedSkillCatalogEntry = {
  key: string
  name: string
  status: SelectedSkillStatus
  tags: readonly string[]
}

export const SELECTED_SKILL_CATALOG = CATALOG as readonly SelectedSkillCatalogEntry[]

export type SelectedSkillKey = typeof SELECTED_SKILL_CATALOG[number]['key']
export type SelectedSkillSelection = Partial<Record<SelectedSkillKey, boolean>>
export type SelectedSkillSelectionSource = SelectedSkillSelection | (() => SelectedSkillSelection)

const PROVIDER_NAME = 'capital-selected-skills'
/** 本 preset 的身份：两条注册路径（`agent/created` 与 `agent-preset/selected`）共用一份。 */
const CAPITAL_PRESET_ID = 'capital-generation'
// skills 根按 catalog 的「仓库 → 上游 SKILL.md 相对路径」现算：第三颗快照的上游把 skill 放在
// plugins/us-stock-analysis/skills，不在 <repo>/skills 底下。写死目录列表的表现不是报错，
// 而是"用户在卡片上勾了那一格、技能永远不出现"（AGENTS.md §9.7）。
const SKILL_ROOTS = Object.entries(SELECTED_SKILL_SKILL_DIRS as Record<string, string>).map(
  ([repository, skillsDir]) => fileURLToPath(new URL(`../../selected-skills/${repository}/${skillsDir}`, import.meta.url)),
)

/**
 * 任务型内置 skill 的根目录（`lib/agents/` → 包根 → `preset/capital-generation/skills`）。
 *
 * 索引**不改磁盘**：`preset/.../SKILL.md` 一个字节都不动，正文在 `get()` 读取期拼上索引块。
 * 三个理由，缺一都不是洁癖：装好的包常常整棵只读（全局安装更糟）；`skill-filesystem` 的 watcher
 * 会被写文件搅动，多会话并行时互相打架；`test/persona.test.mjs` 正钉着这些文件的 frontmatter 与
 * 体积，运行期改写会让那些闸门失去意义。
 */
const TASK_SKILL_ROOT = fileURLToPath(new URL('../../preset/capital-generation/skills', import.meta.url))
/**
 * 遮蔽候选的 rank。DSH 的 `compareIndexedCandidates` 先比 rank 再比 provider 顺序，**小的赢**；
 * 同层自定义根是 `CUSTOM_RANK = 300`，这里取 150 保证同层时压过 fs provider。
 *
 * 跨层本来也轮不到 rank：`dsh-agent-preset-registry` 把 preset 的 standing scope 挂成
 * **agent scope 的 parent**（`standingKey = scopeParentOf(agentKey)`），而 `chainLayers` 的注释写明
 * "farthest ancestor first, the nearest scope has the final word"、`scopeChainOf(...).reverse()` 后
 * 逐层 `merged.set(name, ...)` —— 本 provider 注册在 agent scope 里，是最近的一层，同名天然覆盖。
 * 两条机制取其一即可，取两条是因为遮蔽失败的症状是"索引静默消失"，没有第二个人会发现。
 */
const TASK_SKILL_SHADOW_RANK = 150
const INDEX_HEADING = '## 附：本轮可用的外部精选 Skill（索引）'
/**
 * 索引块的框。它把**外部方法论**塞进了**宿主契约 skill** 的正文里，框架被拉平了，所以这四句必须
 * 写在块内而不是别的文档里：冲突判据、不可动摇的三处边界、以及"这里只有摘要"。
 */
const INDEX_FRAME = [
  '以下是你（用户）在设置里启用的外部精选 Skill，按能力标签与本次任务关联后列出。它们是**方法论材料**，',
  '需要正文时照常用 `skill` 工具按名加载。它们**不改变**本 skill 的证据门、工具委派路径、输出通道与报告形状；',
  '与本 skill 冲突时**以本 skill 为准**。这里只给名称与摘要，摘要不等于全文，未加载前不要照它行事。',
]

type TaskSkillBase = { name: string; description: string; content: string; directory: string }
type RuntimeSummary = { name: string; description: string }

/** 最小 frontmatter 读取：只要 `name` / `description` / 正文。完整策略解析仍归 fs provider。 */
function readFrontmatter(raw: string): { fields: Map<string, string>; body: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (match === null) return undefined
  const fields = new Map<string, string>()
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (field !== null) fields.set(field[1], field[2].trim())
  }
  return { fields, body: raw.slice(match[0].length) }
}

/**
 * 载入三颗任务型 skill 的正文。**读不到就不遮蔽**：`list()` 不会列出这个候选，fs provider 照常
 * 供原文，用户看到的是"没有索引"，而不是"这颗 skill 不见了"（AGENTS.md §9.7 ⑤ 失败要留余地）。
 */
function loadTaskSkillBases(root = TASK_SKILL_ROOT): Map<string, TaskSkillBase> {
  const bases = new Map<string, TaskSkillBase>()
  for (const name of SELECTED_SKILL_TASK_IDS as string[]) {
    try {
      const raw = readFileSync(join(root, name, 'SKILL.md'), 'utf8')
      const parsed = readFrontmatter(raw)
      const description = parsed?.fields.get('description')
      if (parsed === undefined || description === undefined || description === '') continue
      bases.set(name, { name, description, content: parsed.body.trim(), directory: join(root, name) })
    } catch {
      // 读不到是 fail-open，不是错误路径：默认态（一颗都没启用）本来就不遮蔽任何东西。
    }
  }
  return bases
}

/**
 * 索引块正文。**唯一实现**：条目集合来自 catalog 的 `selectedSkillsForTask`（与目录、闸门同源），
 * 描述用**运行时那一份**（上游 frontmatter，也就是会话目录里模型看到的那句话），不是设置卡片里
 * 策展过的中文摘要——同一个 skill 在同一段上下文里出现两种描述，只会让模型两处对照。
 */
export function renderTaskSkillIndex(taskId: string, summaries: readonly RuntimeSummary[]): string | undefined {
  if (summaries.length === 0) return undefined
  return [
    INDEX_HEADING,
    '',
    ...INDEX_FRAME,
    '',
    ...summaries.map((entry) => `- \`${entry.name}\`: ${entry.description}`),
  ].join('\n')
}

type FileSystemSkillConfig = {
  providerName: string
  includeDefaultRoots: false
  customSkillDirs: string[]
  watch: true
}
type FileSystemSkillSource = Pick<FileSystemSkillProvider, 'list' | 'get' | 'dispose'>
type FileSystemSkillFactory = (ctx: Context, control: SkillProviderControl, config: FileSystemSkillConfig) => FileSystemSkillSource

interface SkillRegistryLike {
  registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void
}

function createFilesystemSkillProvider(ctx: Context, control: SkillProviderControl, config: FileSystemSkillConfig): FileSystemSkillSource {
  return new FileSystemSkillProvider(ctx, control, config)
}

function selectedNames(selection: SelectedSkillSelection): Set<string> {
  return new Set(SELECTED_SKILL_CATALOG
    .filter(({ key }) => selection[key] === true)
    .map(({ name }) => name))
}

function readSelection(source: SelectedSkillSelectionSource): SelectedSkillSelection {
  return typeof source === 'function' ? source() : source
}

// 选择指纹只认 catalog 的 key 集合：pre-step 每轮拿它对比"上次交给注册表的选择"，
// 变了才失效目录缓存，未变就零成本放行。
function selectionFingerprint(selection: SelectedSkillSelection): string {
  return SELECTED_SKILL_CATALOG.map(({ key }) => (selection[key] === true ? '1' : '0')).join('')
}

type PreStepListener = (payload: unknown, next: () => unknown) => unknown

// agent/pre-step 是 dsh-agent 声明的事件，类型不在本包的 import 面里；按结构挂到注入后的
// Agent context（其 scope tag 就是该 Agent，dispatch 的 scope filter 才放行这条监听）。
function onPreStepEvent(ctx: Context, listener: PreStepListener): unknown {
  const events = ctx as unknown as { on?: (event: string, listener: PreStepListener) => unknown }
  return events.on?.('agent/pre-step', listener)
}

function strictCapitalPreset(ctx: PolicyContext, agent: AgentLike): boolean {
  try {
    const presets = ctx.get?.('agentPresets') as { composedPreset?: (agentCtx: unknown) => string | undefined } | undefined
    return typeof presets?.composedPreset === 'function'
      && presets.composedPreset(agent.ctx) === CAPITAL_PRESET_ID
  } catch {
    return false
  }
}

/** Register explicitly selected community experiments on the Capital root Agent only. */
export function registerRootSelectedSkills(
  ctx: PolicyContext,
  selection: SelectedSkillSelectionSource,
  createFilesystemProvider: FileSystemSkillFactory = createFilesystemSkillProvider,
): void {
  // Static callers retain the cheap all-disabled fast path. The Capital plugin
  // passes a reader so a settings toggle is observed at the next step of every
  // live root Agent: list()/get() filter against the current selection, and the
  // pre-step hook below refreshes the visible catalog when the selection changes.
  if (typeof selection !== 'function' && selectedNames(selection).size === 0) return

  const listenCtx = ctx.root ?? ctx
  if (typeof listenCtx.on !== 'function') return

  // 一个 root Agent 只注册一次：下面两条事件路径会在同一个 Agent 上重叠（建会话时就带 Capital
  // 预设 → `agent/created`；先按默认预设建、再 select 到 Capital → `agent-preset/selected`）。
  const registered = new WeakSet<AgentLike>()

  const registerFor = async (agent: AgentLike | undefined): Promise<void> => {
    if (!agent || registered.has(agent)) return
    if (!isRootAgent(agent) || !strictCapitalPreset(ctx, agent)) return
    registered.add(agent)

    try {
      const agentCtx = agent.ctx as (Context & {
        inject?: (deps: string[], callback: (injectedCtx: Context & { skills?: SkillRegistryLike }) => void) => unknown
      }) | undefined
      if (!agentCtx || typeof agentCtx.inject !== 'function') {
        registered.delete(agent)
        ctx.logger?.warn?.('capital-generation: selected skills are unavailable (root Agent cannot inject skills)')
        return
      }
      // agent/created 是串行事件、DSH 等监听器 settle 才继续创建：await 注入 Fiber，
      // provider 与 pre-step 钩子都在首轮 prompt 前落位（首轮 catalog 不与注册竞态）。
      await agentCtx.inject(['skills'], (injectedCtx) => {
        const skills = injectedCtx.skills
        if (typeof skills?.registerProvider !== 'function') {
          ctx.logger?.warn?.('capital-generation: selected skills are unavailable (root Agent has no skills registry)')
          return
        }

        let filesystemProvider: FileSystemSkillSource | undefined
        let control: SkillProviderControl | undefined
        // 上次交给 skills 注册表的选择指纹。开关是 settings 偏好，不在 Agent 创建时定格：
        // 全关也照常注册 provider（否则会话创建后打开开关永远不出现），靠下面的 pre-step
        // 钩子每轮对齐设置。
        let served = selectionFingerprint(readSelection(selection))
        injectedCtx.effect(() => {
          const unregister = skills.registerProvider((registration) => {
            control = registration
            filesystemProvider = createFilesystemProvider(injectedCtx, registration, {
              providerName: PROVIDER_NAME,
              includeDefaultRoots: false,
              customSkillDirs: SKILL_ROOTS,
              watch: true,
            })
            // 遮蔽用的底稿只在注册时读一次（三份小文件，读不到就不遮蔽）。
            const taskBases = loadTaskSkillBases()
            // 上一次 `list()` 看到的"已启用精选"运行时摘要。`get()` 拼索引时读它，避免为了几行摘要
            // 再枚举一遍快照目录；为空就退回"没有索引"，也就是把整颗让给 fs provider 的原文。
            let runtimeSummaries: RuntimeSummary[] = []
            const indexFor = (taskId: string): string | undefined => {
              const byName = new Map(runtimeSummaries.map((entry) => [entry.name, entry]))
              // 条目集合来自 catalog 的唯一实现（与目录、闸门同源），顺序取 catalog 顺序：
              // 同一仓库的几颗排在一起，读起来比按名字打散更像一份索引。
              const summaries = (selectedSkillsForTask(taskId, [...byName.keys()]) as { name: string }[])
                .map((entry) => byName.get(entry.name))
                .filter((entry): entry is RuntimeSummary => entry !== undefined)
              return renderTaskSkillIndex(taskId, summaries)
            }
            const provider: SkillProvider = {
              name: PROVIDER_NAME,
              async list(options) {
                // 调用期现读：开关是 settings 偏好，不许在 Agent 创建时定格。
                const enabled = selectedNames(readSelection(selection))
                // 全关是默认常态：短路掉，不碰快照目录（filesystem watcher 在它的 list()
                // 里才启动，短路保证默认关闭的会话不起任何 watcher），**也不遮蔽任何内置 skill**：
                // 一颗都没启用时用户看到的必须与没有这个 provider 时逐字相同。
                if (enabled.size === 0) {
                  runtimeSummaries = []
                  return []
                }
                const result = await filesystemProvider!.list(options)
                const candidates = Array.isArray(result) ? result : result.candidates
                const selected = candidates.filter((candidate) => enabled.has(candidate.name))
                runtimeSummaries = selected.map((candidate) => ({ name: candidate.name, description: candidate.description }))
                // 任务型内置 skill 的遮蔽候选：只有当这颗**确实有索引可给**时才列出来。
                // 没有索引就整颗让给 fs provider（正文照旧），因此"索引缺失"永远不会演变成
                // "这颗 skill 不见了"——遮蔽是加法，不是替换。
                const shadows: SkillCandidate[] = [...taskBases.values()]
                  .filter((base) => indexFor(base.name) !== undefined)
                  .map((base) => ({
                    name: base.name,
                    description: base.description,
                    invocation: { modelInvocable: true, userInvocable: true },
                    provider: PROVIDER_NAME,
                    source: 'custom',
                    rank: TASK_SKILL_SHADOW_RANK,
                    locator: { kind: 'task-skill', name: base.name },
                    resourceBase: { kind: 'directory', path: base.directory },
                  }))
                const merged = [...selected, ...shadows]
                return Array.isArray(result) ? merged : { ...result, candidates: merged }
              },
              get(candidate, options) {
                const base = taskBases.get(candidate.name)
                if (base !== undefined) {
                  // 索引在**读取期**算：开关是 settings 偏好，加载这一刻才是最新的。
                  const index = indexFor(base.name)
                  const content = index === undefined ? base.content : `${base.content}\n\n${index}`
                  return Promise.resolve({
                    name: base.name,
                    description: base.description,
                    invocation: { modelInvocable: true, userInvocable: true },
                    source: 'custom',
                    provider: PROVIDER_NAME,
                    resourceBase: { kind: 'directory', path: base.directory },
                    path: join(base.directory, 'SKILL.md'),
                    content,
                  })
                }
                if (!selectedNames(readSelection(selection)).has(candidate.name)) {
                  throw new Error(`selected skill is not enabled: ${candidate.name}`)
                }
                return filesystemProvider!.get(candidate, options)
              },
            }
            return provider
          })
          // 每轮 pre-step 重读开关：集合变了就调 provider control 的 invalidate()，失效
          // skills 的目录缓存（revision++），tool-skill 随后的 catalog 快照因此按最新开关
          // 重算；未变则 digest 不变、catalog 不重发。必须在放行 next() 之前做完——
          // waterfall 里 tool-skill 是 await next() 之后才快照，但监听器注册顺序不归我们
          // 管，先做完再放行在两种顺序下都赶得上本轮快照。设置读取失败只降级，不阻断本轮。
          const stopPreStep = onPreStepEvent(injectedCtx, (_payload, next) => {
            try {
              const fingerprint = selectionFingerprint(readSelection(selection))
              if (fingerprint !== served) {
                served = fingerprint
                control?.invalidate()
              }
            } catch (error) {
              ctx.logger?.warn?.(`capital-generation: selected skill settings unreadable (${String(error)})`)
            }
            return next()
          })
          return () => {
            if (typeof stopPreStep === 'function') (stopPreStep as () => void)()
            unregister()
            void filesystemProvider?.dispose()
            filesystemProvider = undefined
          }
        }, `capital-generation: selected skills for ${agentSessionId(agent) ?? 'root'}`)
      })
    } catch (error) {
      // selected skills 是可选能力：注入失败只降级告警，不能把整个 Agent 创建挡掉；
      // 同时撤掉登记，让后面的事件（下一次 select、别的注册路径）还有重试的余地。
      registered.delete(agent)
      ctx.logger?.warn?.(`capital-generation: selected skills are unavailable (${String(error)})`)
    }
  }

  const stop = listenCtx.on('agent/created', ({ agent }) => registerFor(agent))

  // 第二条路径：**先按默认预设建会话、再切到 Capital**（GUI 的真实顺序）。
  // 2026-10-13 复核复现：会话（header `agentPreset: "cordis"`）建好后客户端才发
  // `agentPresets.select('capital-generation')`，而 `agent/created` 在 select 之前就已经发完——
  // 只挂那一条时本插件的 `apply()` 是在**这次 recompose 的 mount 里**才跑的，监听器出生就错过了
  // 自己这个 Agent：设置卡 10 个开关全开、会话目录仍只有 preset 自带的 8 颗（真 boot graph 探针：
  // create→select 8 颗 / 建会话时 mount 同一 preset 18 颗）。preset registry 在 mount 完成后才
  // `session.append('agent-preset/selected')`，所以本行一定早于这条事件落位。
  const onPresetEvent = listenCtx.on as unknown as
    | ((event: string, listener: (sessionId?: unknown, agentPreset?: unknown) => void) => unknown)
    | undefined
  const stopPreset = onPresetEvent?.('agent-preset/selected', (sessionId, agentPreset) => {
    if (agentPreset !== CAPITAL_PRESET_ID) return
    const agents = ctx.get?.('agents') as { get?: (id: string) => AgentLike | undefined } | undefined
    const agent = agents?.get?.(String(sessionId))
    if (agent === undefined) return
    // emit 型事件不等待监听器；返回 promise 只为让单测能等到注册落地。registerFor 内部
    // 自兜异常（失败只降级告警并撤登记，下一次事件还有重试的余地），这里不会产生未处理拒绝。
    return registerFor(agent)
  })

  ctx.effect?.(() => () => {
    if (typeof stop === 'function') (stop as () => void)()
    if (typeof stopPreset === 'function') (stopPreset as () => void)()
  }, 'capital-generation: selected skill root listener')
}
