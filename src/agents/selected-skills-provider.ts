import type { Context } from '@deepseek-ai/cordis'
import type { SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { fileURLToPath } from 'node:url'
import { agentSessionId, isRootAgent, type AgentLike, type PolicyContext } from './root-tool-policy.js'
// The catalog is a shipped data file outside the TypeScript root; runtime keeps this
// import so the published lib resolves the same metadata beside the pinned snapshots.
// @ts-expect-error catalog.js is intentionally maintained as package data.
import { SELECTED_SKILL_CATALOG as CATALOG, SELECTED_SKILL_SKILL_DIRS } from '../../selected-skills/catalog.js'

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
            const provider: SkillProvider = {
              name: PROVIDER_NAME,
              async list(options) {
                // 调用期现读：开关是 settings 偏好，不许在 Agent 创建时定格。
                const enabled = selectedNames(readSelection(selection))
                // 全关是默认常态：短路掉，不碰快照目录（filesystem watcher 在它的 list()
                // 里才启动，短路保证默认关闭的会话不起任何 watcher）。
                if (enabled.size === 0) return []
                const result = await filesystemProvider!.list(options)
                if (Array.isArray(result)) return result.filter((candidate) => enabled.has(candidate.name))
                return { ...result, candidates: result.candidates.filter((candidate) => enabled.has(candidate.name)) }
              },
              get(candidate, options) {
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
