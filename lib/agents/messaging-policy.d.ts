/**
 * Call-level `send_message` target guard. The host lets any two members of one subagent tree message
 * each other; this plugin keeps the adjacency table from design §5.2: root -> direct child only,
 * peer edges only where listed, specialist -> none. Targets match fixed tree names because the guard
 * is synchronous and sees raw strings only (a session id is shaped like a name), so this is routing
 * discipline, not a security boundary. Non-Capital presets fail open.
 *
 * The analyst's outgoing peer sends also carry the §5.6 round-trip budget: the send edge stops the
 * fourth request, and `validateArtifact` re-checks the recorded exchanges per `task_id`.
 */
import type { GuardedExecution, PolicyContext } from './root-tool-policy.js';
export declare const MESSAGE_TOOL_NAME = "send_message";
/** Fixed tree names from the delegation prompt; peer edges match these strings, never session ids. */
export declare const ROLE_TREE_NAMES: {
    readonly collector: "data-collector";
    readonly junior: "data-junior";
    readonly retriever: "web-retriever";
    readonly specialist: "visualization-specialist";
    readonly analyst: "senior-analyst";
    readonly lead: "lead";
};
export declare const ROOT_MESSAGE_DENIED: string;
export declare const LEAF_MESSAGE_DENIED = "send_message \u53EA\u80FD\u53D1\u7ED9 `lead`\uFF1A\u53F6\u5B50\u89D2\u8272\u4E0D\u76F4\u63A5\u627E\u5144\u5F1F\u6216\u5B59 Agent\uFF0C\u6750\u6599\u4E0E\u8BF7\u6C42\u90FD\u7ECF\u4E3B Agent \u4E2D\u7EE7\u3002";
export declare const SPECIALIST_MESSAGE_DENIED = "visualization_specialist \u4E0D\u76F4\u63A5\u53D1\u6D88\u606F\uFF1A\u628A\u56FE\u8868\u7ED3\u679C\u4F5C\u4E3A\u6700\u7EC8\u7B54\u590D\u8FD4\u56DE data_junior\uFF0C\u7531\u5B83\u6C47\u603B\u3002";
/** Allowed send edges per role preset. Empty means no messaging at all. Extending one is a product decision. */
export declare const ROLE_MESSAGE_TARGETS: Readonly<Record<string, readonly string[]>>;
/** §5.6-2 budget: one analysis task may ask its peer at most three times. */
export declare const PEER_ROUND_TRIP_BUDGET = 3;
export declare const PEER_BUDGET_DENIED: string;
export declare function peerSendCount(sessionId: string): number;
/** The host owns the required-field error; the guard only judges a target it can actually read. */
export declare function sendMessageTargetOf(exec: GuardedExecution | undefined): string | undefined;
/** Root may address a direct child only: no tree path, and never itself. */
export declare function isDirectChildName(name: string): boolean;
/** Read identity per call because a created-time gate misses manually opened modes; fail open otherwise. */
export declare function sendMessageGuardReasonFor(ctx: PolicyContext): (exec: GuardedExecution | undefined) => string | undefined;
/** Install globally once; a created-time gate misses manually opened modes. */
export declare function registerSendMessageGuard(ctx: PolicyContext): void;
