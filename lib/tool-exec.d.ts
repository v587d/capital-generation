import { type SessionLike } from './data-collector/store.js';
/**
 * 「调用方 session 在哪里」的**唯一实现**。
 *
 * ⛔ 2026-09-23 事故（会话 `66fa9666`）：`resolve_data_time_range` 的 Dataset 形态自己写成了
 * `exec.session`，而框架一直把它放在 `exec.agent.session`（`dataset-tools.ts` 的 `callerSession`
 * 从一开始就是这么读的）。结果是该形态对**任何**调用方都抛
 * `Dataset time-range mode requires an authorized session`，模型只好绕道日期串。
 * 同一个事实有两份实现，就一定会漂移——所以这里收敛成一份，两边都从这里取。
 *
 * 注意：这里**只认框架形状** `exec.agent.session`。不要加 `exec.session` 之类的兜底——
 * 那会让本地直调测试继续绕过真实形状，正是上次漏掉该 bug 的原因。
 */
export interface AgentExecutionLike {
    agent?: {
        session?: {
            id?: string;
            header?: {
                cwd?: string;
                parentSession?: string;
            };
        };
    };
    signal: AbortSignal;
}
/** 取调用方 session；缺失即响亮失败（`session_unavailable`）。 */
export declare function callerSession(exec: AgentExecutionLike): SessionLike;
/** 取调用方 session，并要求它是**被委派的**子 Agent（有 parentSession）。 */
export declare function delegatedSession(exec: AgentExecutionLike, toolName: string): SessionLike;
