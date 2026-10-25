/**
 * Sole reader of the bundled `capital-config` entry. The id must match the host row,
 * settings card and preset row; drift is caught by the four-way assertion in
 * `test/capital-config.test.mjs`. Unreadable returns `{}` and callers fill defaults;
 * only reference names are read here, never resolved secrets.
 */
import type { Context } from '@deepseek-ai/cordis'

import type { RetrieverConfig } from './retriever-config.js'
import type { SelectedSkillSelection, SelectedSkillsMode } from './agents/selected-skills-provider.js'

export const CAPITAL_CONFIG_ENTRY_ID = 'capital-config'

/** Fields this repo consumes (the host half owns the rest). */
export interface CapitalConfigSlice {
  fuyaoCredentialRef?: string
  ftshareCredentialRef?: string
  customPersona?: string
  retriever?: RetrieverConfig
  selectedSkills?: SelectedSkillSelection
  selectedSkillsMode?: SelectedSkillsMode
}

interface SettingsDescribeLike {
  describe?: () => Array<{ ns?: string; value?: unknown }>
}
interface ConfigEditorLike {
  entries?: () => Array<{ options?: { id?: string; config?: unknown } }>
}

export type CapitalEntrySource = 'settings-describe' | 'config-editor'

/**
 * Settings first, then the config-editor save layer. The selected-skill provider and the
 * persona section live in a separate preset row; reading only `settings.describe()` there
 * made a saved toggle look all-off whenever the settings projection was not ready.
 */
export function readCapitalEntry(ctx: Context): { value?: Record<string, unknown>; source?: CapitalEntrySource } {
  try {
    const settings = ctx.get('settings') as SettingsDescribeLike | undefined
    const value = settings?.describe?.().find((entry) => entry?.ns === CAPITAL_CONFIG_ENTRY_ID)?.value
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return { value: value as Record<string, unknown>, source: 'settings-describe' }
    }
  } catch {
  }
  try {
    const editor = ctx.get('configEditor') as ConfigEditorLike | undefined
    const value = editor?.entries?.().find((row) => row?.options?.id === CAPITAL_CONFIG_ENTRY_ID)?.options?.config
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return { value: value as Record<string, unknown>, source: 'config-editor' }
    }
  } catch {
  }
  return {}
}

export function readCapitalConfig(ctx: Context): CapitalConfigSlice {
  return (readCapitalEntry(ctx).value ?? {}) as CapitalConfigSlice
}

/** Flat credential refs needed by the collector domain (same shape as `CollectorConfig`). */
export function readCollectorConfig(ctx: Context): {
  fuyaoCredentialRef?: string
  ftshareCredentialRef?: string
  windCredentialRef?: string
} {
  const config = readCapitalConfig(ctx)
  return {
    fuyaoCredentialRef: config.fuyaoCredentialRef,
    ftshareCredentialRef: config.ftshareCredentialRef,
    windCredentialRef: config.retriever?.windDocs?.credentialRef,
  }
}

/** Retriever config slice (baseURL, credential ref, Wind endpoint, local fallback switch). */
export function readRetrieverConfig(ctx: Context): RetrieverConfig {
  return readCapitalConfig(ctx).retriever ?? {}
}
