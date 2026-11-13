/**
 * Call-level `send_message` target guard. rc.2 lets any two members of one subagent tree message
 * each other; Capital keeps the main-agent relay: root -> direct child only, child -> lead only,
 * specialist -> none. The target map is explicit so a future data-junior -> data-analyst link is a
 * one-line addition, not a policy rewrite. Non-Capital presets fail open.
 */
import type { GuardedExecution, PolicyContext } from './root-tool-policy.js';
export declare const MESSAGE_TOOL_NAME = "send_message";
export declare const ROOT_MESSAGE_DENIED: string;
export declare const LEAF_MESSAGE_DENIED = "send_message \u53EA\u80FD\u53D1\u7ED9 `lead`\uFF1A\u53F6\u5B50\u89D2\u8272\u4E0D\u76F4\u63A5\u627E\u5144\u5F1F\u6216\u5B59 Agent\uFF0C\u6750\u6599\u4E0E\u8BF7\u6C42\u90FD\u7ECF\u4E3B Agent \u4E2D\u7EE7\u3002";
export declare const SPECIALIST_MESSAGE_DENIED = "visualization_specialist \u4E0D\u76F4\u63A5\u53D1\u6D88\u606F\uFF1A\u628A\u56FE\u8868\u7ED3\u679C\u4F5C\u4E3A\u6700\u7EC8\u7B54\u590D\u8FD4\u56DE data_junior\uFF0C\u7531\u5B83\u6C47\u603B\u3002";
/** Allowed targets per role preset. Empty means no messaging at all. Extend junior when the analyst link ships. */
export declare const ROLE_MESSAGE_TARGETS: Readonly<Record<string, readonly string[]>>;
/** The host owns the required-field error; the guard only judges a target it can actually read. */
export declare function sendMessageTargetOf(exec: GuardedExecution | undefined): string | undefined;
/** Root may address a direct child only: no tree path, and never itself. */
export declare function isDirectChildName(name: string): boolean;
/** Read identity per call because a created-time gate misses manually opened modes; fail open otherwise. */
export declare function sendMessageGuardReasonFor(ctx: PolicyContext): (exec: GuardedExecution | undefined) => string | undefined;
/** Installs once per root; the same probe channel makes denials visible through dc_status. */
export declare function registerSendMessageGuard(ctx: PolicyContext): void;
