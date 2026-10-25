/**
 * `tools/root-extras` row: the `customPersona` system-prompt section. Root-only; this row
 * registers no tools. Selected skills moved to the role-scoped `tools/selected-skills` row.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

import { userCustomizationSection } from './user-customization.js'
import { readCapitalConfig } from './capital-settings.js'

export const name = 'capital-root-extras'
export const inject = ['systemPrompt']

interface RootExtrasConfig {
  customPersona?: string
}

/** Re-read per turn so a settings save applies to the same session on the next step. */
export function readRootExtrasConfig(ctx: Context): RootExtrasConfig {
  const config = readCapitalConfig(ctx)
  return { customPersona: config.customPersona }
}

export function apply(ctx: Context): void {
  let lastPersonaError: string | undefined
  const section = userCustomizationSection(
    () => readRootExtrasConfig(ctx).customPersona,
    (error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (message === lastPersonaError) return
      lastPersonaError = message
      ctx.logger?.warn?.(`capital-generation: customPersona 未加载（${message}）`)
    },
  )
  ctx.effect(() => {
    const dispose = ctx.systemPrompt.section(section)
    return typeof dispose === 'function' ? dispose as () => void : () => {}
  }, 'capital-generation.user-customization()')
}
