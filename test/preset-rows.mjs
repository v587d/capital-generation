// Sole reader of preset/capital-generation/agent.patch.yml; every assembly assertion goes through it.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load as yamlLoad } from 'js-yaml'

const PATCH = fileURLToPath(new URL('../preset/capital-generation/agent.patch.yml', import.meta.url))

export const PRESET_PATCH_TEXT = readFileSync(PATCH, 'utf8')

export function presetDeclaration(patch = yamlLoad(PRESET_PATCH_TEXT.replace(/!!js\s+/g, ''))) {
  // ⛔ Match on `config.id`, never the first preset row: the file holds six presets (root + roles),
  // and a name-based lookup silently returns a role, making every gate read the wrong rows.
  const declared = allPresets(patch).find((row) => row?.config?.id === ROOT_PRESET_ID)
  if (!declared) throw new Error(`agent.patch.yml 里没有 id 为 ${ROOT_PRESET_ID} 的 @deepseek-ai/dsh-agent-preset 声明行`)
  return declared.config
}

export const ROOT_PRESET_ID = 'capital-generation'

export function allPresets(patch = yamlLoad(PRESET_PATCH_TEXT.replace(/!!js\s+/g, ''))) {
  return patch.flatMap((entry) => entry?.insert ?? []).filter((row) => row?.name === '@deepseek-ai/dsh-agent-preset')
}

export function rolePresets(patch = yamlLoad(PRESET_PATCH_TEXT.replace(/!!js\s+/g, ''))) {
  return allPresets(patch).filter((row) => row?.config?.id !== ROOT_PRESET_ID).map((row) => row.config)
}

export function presetRows() {
  const plugins = presetDeclaration().plugins
  if (!Array.isArray(plugins)) throw new Error('预设声明的 config.plugins 必须是行数组')
  return plugins
}

// `renderSkillContent` wraps the body in `<skill_content …>` plus a base-directory line (~500 chars);
// the pruner measures the wrapped tool result, so visibility budgets use this denominator.
const SKILL_RENDER_OVERHEAD = 512

// Delegation rows live in role presets (data_junior owns chart creation), so searching only the
// root preset's rows yields undefined and blurs "wrong place" with "really absent".
export function delegationRow(toolName, patch = yamlLoad(PRESET_PATCH_TEXT.replace(/!!js\s+/g, ''))) {
  for (const preset of allPresets(patch)) {
    const row = (preset.config?.plugins ?? []).find((entry) => entry?.name === '@deepseek-ai/dsh-tool-subagent' && entry?.config?.toolName === toolName)
    if (row) return { row, presetId: preset.config.id }
  }
  return undefined
}

// Must recurse into `cordis:group`: the collector row hides in an isolate realm, and a top-level
// read reports its tool surface as empty.
export function capitalRowsOf(presetId, patch = yamlLoad(PRESET_PATCH_TEXT.replace(/!!js\s+/g, ''))) {
  return allRowsOf(presetId, patch).filter((row) => typeof row?.name === 'string' && row.name.startsWith('@v587d/capital-generation'))
}

// Framework rows (skill / control / shell / fs) can hide in groups too; top-level-only checks miss them.
export function allRowsOf(presetId, patch = yamlLoad(PRESET_PATCH_TEXT.replace(/!!js\s+/g, ''))) {
  const preset = allPresets(patch).find((entry) => entry?.config?.id === presetId)
  if (!preset) throw new Error(`没有 id 为 ${presetId} 的 preset 声明行`)
  const found = []
  const walk = (rows) => {
    for (const row of rows ?? []) {
      found.push(row)
      if (Array.isArray(row?.config)) walk(row.config)
      else if (Array.isArray(row?.config?.plugins)) walk(row.config.plugins)
    }
  }
  walk(preset.config?.plugins)
  return found
}

// `dsh-persona` carries the text under `prefix`, not `persona`.
export function rolePersona(presetId, patch = yamlLoad(PRESET_PATCH_TEXT.replace(/!!js\s+/g, ''))) {
  const preset = allPresets(patch).find((entry) => entry?.config?.id === presetId)
  if (!preset) throw new Error(`没有 id 为 ${presetId} 的 preset 声明行`)
  const row = (preset.config.plugins ?? []).find((entry) => entry?.name === '@deepseek-ai/dsh-persona')
  return row?.config?.prefix
}

// Gates must sweep role personas too: skipping them puts the most protocol-prone texts out of scope.
export function allPersonaTexts(patch = yamlLoad(PRESET_PATCH_TEXT.replace(/!!js\s+/g, ''))) {
  return allPresets(patch)
    .map((preset) => ({ presetId: preset.config.id, persona: rolePersona(preset.config.id, patch) }))
    .filter((entry) => typeof entry.persona === 'string' && entry.persona.length > 0)
}

// Byte budget for a full load: the pruner is not a top-level row (compaction reads it via ctx.get,
// so it must share the realm). It measures Unicode code points, not bytes.
export function loadBudget() {
  const pruner = (presetRows().find((row) => row?.id === 'compaction')?.config ?? [])
    .find((child) => child?.id === 'tool-result-pruner')
  const thresholdChars = Number(pruner?.config?.thresholdChars)
  if (!Number.isInteger(thresholdChars)) throw new Error('agent.patch.yml 的 compaction 组里找不到 tool-result-pruner 的 thresholdChars')
  return { thresholdChars, overheadChars: SKILL_RENDER_OVERHEAD, visibleChars: thresholdChars - SKILL_RENDER_OVERHEAD }
}
