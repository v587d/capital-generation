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

function strictCapitalPreset(ctx: PolicyContext, agent: AgentLike): boolean {
  try {
    const presets = ctx.get?.('agentPresets') as { composedPreset?: (agentCtx: unknown) => string | undefined } | undefined
    return typeof presets?.composedPreset === 'function'
      && presets.composedPreset(agent.ctx) === 'capital-generation'
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
  // passes a reader so a settings toggle is observed for the next root Agent.
  if (typeof selection !== 'function' && selectedNames(selection).size === 0) return

  const listenCtx = ctx.root ?? ctx
  if (typeof listenCtx.on !== 'function') return

  const stop = listenCtx.on('agent/created', ({ agent }) => {
    if (!agent || !isRootAgent(agent) || !strictCapitalPreset(ctx, agent)) return
    const enabled = selectedNames(readSelection(selection))
    if (enabled.size === 0) return
    const agentCtx = agent.ctx as (Context & {
      inject?: (deps: string[], callback: (injectedCtx: Context & { skills?: SkillRegistryLike }) => void) => unknown
    }) | undefined
    if (!agentCtx || typeof agentCtx.inject !== 'function') {
      ctx.logger?.warn?.('capital-generation: selected skills are unavailable (root Agent cannot inject skills)')
      return
    }

    agentCtx.inject(['skills'], (injectedCtx) => {
      const skills = injectedCtx.skills
      if (typeof skills?.registerProvider !== 'function') {
        ctx.logger?.warn?.('capital-generation: selected skills are unavailable (root Agent has no skills registry)')
        return
      }

      let filesystemProvider: FileSystemSkillSource | undefined
      injectedCtx.effect(() => {
        const unregister = skills.registerProvider((control) => {
          filesystemProvider = createFilesystemProvider(injectedCtx, control, {
            providerName: PROVIDER_NAME,
            includeDefaultRoots: false,
            customSkillDirs: SKILL_ROOTS,
            watch: true,
          })
          const provider: SkillProvider = {
            name: PROVIDER_NAME,
            async list(options) {
              const result = await filesystemProvider!.list(options)
              if (Array.isArray(result)) return result.filter((candidate) => enabled.has(candidate.name))
              return { ...result, candidates: result.candidates.filter((candidate) => enabled.has(candidate.name)) }
            },
            get(candidate, options) {
              if (!enabled.has(candidate.name)) {
                throw new Error(`selected skill is not enabled: ${candidate.name}`)
              }
              return filesystemProvider!.get(candidate, options)
            },
          }
          return provider
        })
        return () => {
          unregister()
          void filesystemProvider?.dispose()
          filesystemProvider = undefined
        }
      }, `capital-generation: selected skills for ${agentSessionId(agent) ?? 'root'}`)
    })
  })

  ctx.effect?.(() => () => {
    if (typeof stop === 'function') stop()
  }, 'capital-generation: selected skill root listener')
}
