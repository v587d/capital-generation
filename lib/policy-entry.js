import { registerBashGuard } from './agents/bash-guard.js';
import { registerPresetRosterFilter } from './agents/preset-roster.js';
import { registerFsWriteGuard, registerRootOcrGuard, registerRootToolPolicy } from './agents/root-tool-policy.js';
import { registerRoleSiblingGuard, registerRoleToolPolicy } from './agents/role-tool-policy.js';
export const name = 'capital-policy';
/**
 * `tools` is a hard dependency: without `inject`, boot resolves it to undefined without
 * throwing and every identity guard silently skips installation. Waiting for the fiber
 * to provide it closes that boot-time race.
 */
export const inject = ['tools'];
export function apply(ctx) {
    const policy = ctx;
    // Preset rows now own visibility; the host keeps only call-level gates.
    registerRootToolPolicy(policy, { deny: false });
    registerRootOcrGuard(policy);
    registerRoleToolPolicy(policy);
    registerRoleSiblingGuard(policy);
    registerBashGuard(policy);
    registerFsWriteGuard(policy);
    registerPresetRosterFilter(ctx);
}
