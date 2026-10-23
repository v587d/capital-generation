/** Execution guard for bash/pwsh/run_code: blocks only doomed sandbox escalation; command/program
 * content is never inspected (the sandbox blocks writes, not reads/network). Delegated approvals
 * are fixed to `never`, so escalation auto-rejects with a misleading "user rejected"; block early
 * instead. Root escalation still uses ask; do not pin delegated sessions read-only
 * (`store.writeContext` needs workspace-write). `tools.guard` is monotonic; pre-execute is a
 * rewritable waterfall. */
import { type GuardedExecution, type PolicyContext } from './root-tool-policy.js';
/** Both shell names on every platform plus the PTC transport: the preset mounts one shell pair for
 * the root and `run_code` for data_junior, so matching only the local platform kills the Windows gate. */
export declare const EXECUTION_ESCALATION_TOOL_NAMES: readonly ["bash", "pwsh", "run_code"];
export type BashGuardExecution = GuardedExecution;
/** States that the rejection is the system's, not the user's, and gives the recovery path. */
export declare const SHELL_ESCALATION_UNREACHABLE: string;
/** Reads identity plus `sandbox_permissions`/`justification`, never `command`/`code`; unknown identity fails closed. */
export declare function bashGuardReason(exec: BashGuardExecution | undefined): string | undefined;
/** Installs on every Capital preset agent. Must listen on `ctx.root`: agent/created routes by
 * the agent object, so tagged standing-scope listeners never fire. Failures only warn. */
export declare function registerBashGuard(ctx: PolicyContext): void;
