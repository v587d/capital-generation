import { SELECTED_SKILL_CATALOG } from './catalog.js'
import {
  SELECTED_SKILL_PRESET_ORDER,
  SELECTED_SKILL_ROLE_ALIASES,
  SELECTED_SKILL_ROUTING,
} from './routing.js'

/** Both filter dimensions use this value for "no constraint". */
export const SELECTED_SKILL_FILTER_ALL = 'all'

/** Roles a skill can be loaded by; aliases resolve before matching. */
export function selectedSkillRoles(entry) {
  return (SELECTED_SKILL_ROUTING[entry.name]?.roles ?? [])
    .map((role) => SELECTED_SKILL_ROLE_ALIASES[role] ?? role)
}

/** Trait order is the full-catalog count, so chips never reorder while the user filters. */
export function selectedSkillTraitOrder(catalog = SELECTED_SKILL_CATALOG) {
  const counts = new Map()
  for (const entry of catalog) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  const traits = [...counts.keys()].sort((left, right) => counts.get(right) - counts.get(left))
  return [SELECTED_SKILL_FILTER_ALL, ...traits]
}

/** Total skills each preset can load; zero-count presets stay visible but disabled. */
export function selectedSkillPresetTotals(catalog = SELECTED_SKILL_CATALOG) {
  const totals = new Map(SELECTED_SKILL_PRESET_ORDER.map((preset) => [preset, 0]))
  for (const entry of catalog) {
    for (const role of new Set(selectedSkillRoles(entry))) {
      if (totals.has(role)) totals.set(role, totals.get(role) + 1)
    }
  }
  return totals
}

const matchesTrait = (entry, trait) => trait === SELECTED_SKILL_FILTER_ALL || entry.tags.includes(trait)
const matchesPreset = (entry, preset) => preset === SELECTED_SKILL_FILTER_ALL || selectedSkillRoles(entry).includes(preset)

/** Both dimensions intersect; either one set to `all` leaves the other as the only constraint. */
export function filterSelectedSkills({
  trait = SELECTED_SKILL_FILTER_ALL,
  preset = SELECTED_SKILL_FILTER_ALL,
  catalog = SELECTED_SKILL_CATALOG,
} = {}) {
  return catalog.filter((entry) => matchesTrait(entry, trait) && matchesPreset(entry, preset))
}

/**
 * Counts answer "how many rows will this chip show next", so each dimension is
 * counted under the other dimension's current selection.
 */
export function selectedSkillFacetCounts({
  trait = SELECTED_SKILL_FILTER_ALL,
  preset = SELECTED_SKILL_FILTER_ALL,
  catalog = SELECTED_SKILL_CATALOG,
} = {}) {
  const traits = new Map([[SELECTED_SKILL_FILTER_ALL, 0]])
  for (const entry of catalog.filter((item) => matchesPreset(item, preset))) {
    traits.set(SELECTED_SKILL_FILTER_ALL, traits.get(SELECTED_SKILL_FILTER_ALL) + 1)
    for (const tag of entry.tags) traits.set(tag, (traits.get(tag) ?? 0) + 1)
  }
  const presets = new Map([[SELECTED_SKILL_FILTER_ALL, 0]])
  for (const entry of catalog.filter((item) => matchesTrait(item, trait))) {
    presets.set(SELECTED_SKILL_FILTER_ALL, presets.get(SELECTED_SKILL_FILTER_ALL) + 1)
    for (const role of new Set(selectedSkillRoles(entry))) presets.set(role, (presets.get(role) ?? 0) + 1)
  }
  return { traits, presets }
}
