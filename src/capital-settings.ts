/**
 * Sole reader of the bundled `capital-config` entry. The id must match the host row,
 * settings card and preset row; drift is caught by the four-way assertion in
 * `test/capital-config.test.mjs`. Unreadable returns `{}` and callers fill defaults;
 * only reference names are read here, never resolved secrets.
 */
import type { Context } from '@deepseek-ai/cordis'

import type { RetrieverConfig } from './retriever-config.js'
import type { SelectedSkillSelection } from './agents/selected-skills-provider.js'

export const CAPITAL_CONFIG_ENTRY_ID = 'capital-config'

/** Fields this repo consumes (the host half owns the rest). */
export interface CapitalConfigSlice {
  fuyaoCredentialRef?: string
  ftshareCredentialRef?: string
  customPersona?: string
  retriever?: RetrieverConfig
  selectedSkills?: SelectedSkillSelection
}

interface SettingsDescribeLike {
  describe?: () => Array<{ ns?: string; value?: CapitalConfigSlice }>
}

export function readCapitalConfig(ctx: Context): CapitalConfigSlice {
  try {
    const settings = ctx.get('settings') as SettingsDescribeLike | undefined
    return settings?.describe?.().find((entry) => entry?.ns === CAPITAL_CONFIG_ENTRY_ID)?.value ?? {}
  } catch {
    return {}
  }
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
