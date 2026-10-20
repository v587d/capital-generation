/**
 * Host-plane Capital policy row: call-level gates that preset composition cannot express.
 * Root convergence (visibility already closed by family rows), per-name sibling deny,
 * call-level guards for the `ocr` url form and role `interrupt_agent`, plus shell and fs
 * guards. Identity must be read per call: the host creates the Agent before selecting a
 * preset. Listens on `ctx.root`; one registration per process.
 */
import type { Context } from '@deepseek-ai/cordis'

import { registerBashGuard } from './agents/bash-guard.js'
import { registerFsWriteGuard, registerRootOcrGuard, registerRootToolPolicy, type PolicyContext } from './agents/root-tool-policy.js'
import { registerRoleSiblingGuard, registerRoleToolPolicy } from './agents/role-tool-policy.js'

export const name = 'capital-policy'

/**
 * `tools` is a hard dependency: without `inject`, boot resolves it to undefined without
 * throwing and every identity guard silently skips installation. Waiting for the fiber
 * to provide it closes that boot-time race.
 */
export const inject = ['tools']

export function apply(ctx: Context): void {
  const policy = ctx as unknown as PolicyContext
  // Preset rows now own visibility; the host keeps only call-level gates.
  registerRootToolPolicy(policy, { deny: false })
  registerRootOcrGuard(policy)
  registerRoleToolPolicy(policy)
  registerRoleSiblingGuard(policy)
  registerBashGuard(policy)
  registerFsWriteGuard(policy)
}
