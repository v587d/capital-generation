import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentSessionId, isRootAgent, type AgentLike, type PolicyContext } from './root-tool-policy.js'
// Catalog is package data outside the TS root; the runtime import keeps lib resolving it beside pinned snapshots.
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
const CAPITAL_PRESET_ID = 'capital-generation'
// Derive roots from the catalog: a hardcoded list silently hides checked boxes (upstream layouts differ).
const SKILL_ROOTS = Object.entries(SELECTED_SKILL_SKILL_DIRS as Record<string, string>).map(
  ([repository, skillsDir]) => fileURLToPath(new URL(`../../selected-skills/${repository}/${skillsDir}`, import.meta.url)),
)

/** Built-in task skill root; the index is appended at read time, never written to disk:
 * installs may be read-only, watchers would churn, and tests pin frontmatter and size. */
const TASK_SKILL_ROOT = fileURLToPath(new URL('../../preset/capital-generation/skills', import.meta.url))
/** Smaller rank wins: 150 beats the same-layer custom root (300). The agent scope usually
 * shadows anyway; both are cheap insurance because failure is silent. */
const TASK_SKILL_SHADOW_RANK = 150
const INDEX_HEADING = '## 附：本轮可用的外部精选 Skill（索引）'
/** Conflict precedence and the three untouchable boundaries must live inside the block. */
const INDEX_FRAME = [
  '以下是你（用户）在设置里启用的外部精选 Skill，按能力标签与本次任务关联后列出。它们是**方法论材料**，',
  '需要正文时照常用 `skill` 工具按名加载。它们**不改变**本 skill 的证据门、工具委派路径、输出通道与报告形状；',
  '与本 skill 冲突时**以本 skill 为准**。这里只给名称与摘要，摘要不等于全文，未加载前不要照它行事。',
]

type TaskSkillBase = { name: string; description: string; content: string; directory: string }
type RuntimeSummary = { name: string; description: string }

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

/** Unreadable means no shadow, never a missing skill: the fs provider still serves the original. */
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
    }
  }
  return bases
}

/** Sole index renderer; descriptions use runtime frontmatter (what the model sees), not card summaries. */
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

// Fingerprint only the catalog key set: refresh the cache only when the selection changes.
function selectionFingerprint(selection: SelectedSkillSelection): string {
  return SELECTED_SKILL_CATALOG.map(({ key }) => (selection[key] === true ? '1' : '0')).join('')
}

type PreStepListener = (payload: unknown, next: () => unknown) => unknown

// `agent/pre-step` belongs to dsh-agent; attach via the injected Agent context so scope filtering admits it.
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

/** Registers selected community experiments on the Capital root Agent only. */
export function registerRootSelectedSkills(
  ctx: PolicyContext,
  selection: SelectedSkillSelectionSource,
  createFilesystemProvider: FileSystemSkillFactory = createFilesystemSkillProvider,
): void {
  // Static callers keep the all-off fast path; the plugin passes a reader so live toggles apply
  // at the next step (list/get filter by selection, pre-step refreshes the visible catalog).
  if (typeof selection !== 'function' && selectedNames(selection).size === 0) return

  const listenCtx = ctx.root ?? ctx
  if (typeof listenCtx.on !== 'function') return

  // One registration per root Agent: both event paths can observe the same Agent.
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
      // agent/created is serial: DSH awaits listeners, so this inject lands before the first prompt.
      await agentCtx.inject(['skills'], (injectedCtx) => {
        const skills = injectedCtx.skills
        if (typeof skills?.registerProvider !== 'function') {
          ctx.logger?.warn?.('capital-generation: selected skills are unavailable (root Agent has no skills registry)')
          return
        }

        let filesystemProvider: FileSystemSkillSource | undefined
        let control: SkillProviderControl | undefined
        // Register even when all toggles are off; otherwise a later enable would never surface. Pre-step aligns settings.
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
            const taskBases = loadTaskSkillBases()
            // Summaries from the last `list()`; `get()` reuses them instead of rescanning dirs.
            let runtimeSummaries: RuntimeSummary[] = []
            const indexFor = (taskId: string): string | undefined => {
              const byName = new Map(runtimeSummaries.map((entry) => [entry.name, entry]))
              const summaries = (selectedSkillsForTask(taskId, [...byName.keys()]) as { name: string }[])
                .map((entry) => byName.get(entry.name))
                .filter((entry): entry is RuntimeSummary => entry !== undefined)
              return renderTaskSkillIndex(taskId, summaries)
            }
            const provider: SkillProvider = {
              name: PROVIDER_NAME,
              async list(options) {
                // Read at call time: toggles are settings, not fixed at Agent creation.
                const enabled = selectedNames(readSelection(selection))
                // All-off is the default: skip snapshot dirs (no watcher starts) and shadow nothing, matching no-provider output.
                if (enabled.size === 0) {
                  runtimeSummaries = []
                  return []
                }
                const result = await filesystemProvider!.list(options)
                const candidates = Array.isArray(result) ? result : result.candidates
                const selected = candidates.filter((candidate) => enabled.has(candidate.name))
                runtimeSummaries = selected.map((candidate) => ({ name: candidate.name, description: candidate.description }))
                // Shadow a task skill only when it has an index; otherwise the fs provider's original wins.
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
          // Invalidate before next() so this turn's snapshot sees the change regardless of listener order.
          // A settings read failure only degrades this hook.
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
      // Optional capability: degrade with a warning, never block Agent creation; clear so a later event can retry.
      registered.delete(agent)
      ctx.logger?.warn?.(`capital-generation: selected skills are unavailable (${String(error)})`)
    }
  }

  const stop = listenCtx.on('agent/created', ({ agent }) => registerFor(agent))

  // Second path: GUI creates with the default preset, then selects Capital. `agent/created`
  // already fired and apply() runs inside that remount, so `agent-preset/selected` arrives after mount.
  const onPresetEvent = listenCtx.on as unknown as
    | ((event: string, listener: (sessionId?: unknown, agentPreset?: unknown) => void) => unknown)
    | undefined
  const stopPreset = onPresetEvent?.('agent-preset/selected', (sessionId, agentPreset) => {
    if (agentPreset !== CAPITAL_PRESET_ID) return
    const agents = ctx.get?.('agents') as { get?: (id: string) => AgentLike | undefined } | undefined
    const agent = agents?.get?.(String(sessionId))
    if (agent === undefined) return
    // Emit-style event: the promise only lets tests await registration; errors are handled inside.
    return registerFor(agent)
  })

  ctx.effect?.(() => () => {
    if (typeof stop === 'function') (stop as () => void)()
    if (typeof stopPreset === 'function') (stopPreset as () => void)()
  }, 'capital-generation: selected skill root listener')
}
