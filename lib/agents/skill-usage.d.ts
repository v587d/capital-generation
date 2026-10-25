/**
 * Programmatic selected-skill ledger: a load counts only after the host returned the
 * selected provider's body. The root prompt reads the tree; the report script re-derives
 * the same facts from durable session logs, so model self-report is never the source.
 */
import { type AgentLike } from './root-tool-policy.js';
export interface SkillUsageRow {
    readonly sessionId: string;
    readonly parentSession?: string;
    readonly role: string;
    readonly names: readonly string[];
}
/** Register a role Agent before it loads anything, so the tree edge survives an empty session. */
export declare function trackSelectedSkillUsage(agent: AgentLike | undefined, role: string): void;
export declare function recordSelectedSkillUsage(agent: AgentLike | undefined, role: string, name: string): void;
/** A new user turn drops the previous turn's names but keeps the tree edges. */
export declare function resetSelectedSkillUsage(rootSessionId: string): void;
/** Agent teardown: the whole subtree's records are process-local and must not outlive it. */
export declare function clearSelectedSkillUsage(rootSessionId: string): void;
export declare function clearAllSelectedSkillUsage(): void;
export declare function skillUsageRows(rootSessionId: string): SkillUsageRow[];
export declare function skillUsageNamesForSession(sessionId: string): string[];
