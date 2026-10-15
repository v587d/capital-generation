/**
 * shell 调用闸门（`bash` / `pwsh` 两个名字都认，只拦**必然失败的沙箱升级**，不看命令内容）。
 *
 * 背景与边界（设计理由全文在 preset/capital-generation/README.md）：
 *  - bash 不是计算器，是一台完整终端。本仓实测：沙箱**只拦写**（workspace + /tmp 之外
 *    一律 EROFS），**不拦读**（`~/.dsh/.credentials.yaml`、`sessions/**` 整机可读），
 *    **不拦网络**（`curl` 直连 200）。这是 DSH 沙箱词汇表的既定边界——`SandboxMode`
 *    只覆盖文件效果，官方文档亦如此声明。
 *  - 因此本文件**不做命令内容匹配**：正则挡不住 `node -e`/`python3 -c`，而 node/python
 *    正是引入 bash 的目的（未来 data_analyst 也靠它）。禁区与出网纪律走 data_junior 的
 *    persona 软约束，不在这里伪装成安全边界。
 *  - 沙箱写边界也无法单独收窄：数据集管线自己就走沙箱，`store.writeContext()` 用**调用方
 *    session** 的 policy 且要求 mode ∈ {workspace-write, danger-full-access}，把 data_junior
 *    的会话钉成 read-only 会直接打断 `describe_dataset` 的 profile 落盘
 *    （`workspace_not_writable`）。bash 与 Dataset 管线共用同一把尺子（session policy）。
 *
 * 规则只留一层（2026-10-15 用户决策「开 read、同时保留 bash」后）：
 *  A 结构层（**已随决策移除**）：曾拒绝根会话的 shell 调用（"只对被委派子会话开放"）。
 *    现在主 Agent 保留 bash / pwsh（读 skill 分册、纯计算）；shell 归谁由可见性收敛——
 *    `ROOT_AGENT_DENIED_TOOLS` 不再含 shell 名，子会话侧由委派行的 `toolFilter` 把 shell
 *    只给 data_junior。迁移的断言在 `test/bash-guard.test.mjs`（根会话放行是**新契约**）。
 *  B UX 层（保留，收窄到"被委派 / 身份不可考的调用方"）：委派子会话的审批策略由框架固定为
 *    `never`（dsh-subagent 的 `captureDelegatedPolicyOverrides` → `approval/policy: never`，
 *    `dsh-user-approval.decide()` 在 never 时**直接返回 rejected、根本不调用 answerer**），
 *    所以 `sandbox_permissions` 必然失败，而且模型会收到「the user rejected…」这种
 *    **把系统拒绝说成用户拒绝**的文案。这里提前拦下并给出正确路径：省一次必然白跑的往返 +
 *    纠正归因。主 Agent 自己的升级照常走 ask 审批（那正是 escalation 的正当用途）。
 *
 * 为什么用 `tools.guard` 而不是 `tools/pre-execute`：guard 是**单调**的（没有 allow 结果，
 * 任何监听顺序都无法把别人的 deny 翻回 allow），同步、拿到解析后的 `arguments`，且
 * 「注册在 agent.ctx 上就只作用于该 agent」。pre-execute 是 waterfall，可扩展也意味着可被后续
 * 监听改写。
 */
import { type GuardedExecution, type PolicyContext } from './root-tool-policy.js';
/** 闸门看到的调用形状：guard 拿到的是解析后的 arguments，不是一个 shell 字符串。 */
export type BashGuardExecution = GuardedExecution;
/**
 * 沙箱升级拒绝文案：说清"这不是用户拒绝"，并给出正确路径。
 * （A 结构层文案 `SHELL_DELEGATED_ONLY` 随 2026-10-15 决策删除，断言迁移到
 * `test/bash-guard.test.mjs` 的"根会话放行"用例。）
 */
export declare const SHELL_ESCALATION_UNREACHABLE: string;
/**
 * 单次 shell 调用的判定：返回拒绝理由，或 undefined 放行。
 *
 * 2026-10-15 起主 Agent 的 shell 调用一律放行（A 层随决策移除）；被拦的只有**升级参数**
 * ——注意这里**只读两个字段**（调用方身份、`sandbox_permissions`/`justification`），
 * 绝不解析 `command`——理由见文件头。升级判不了身份时 fail closed：根会话的形状是
 * "有 session 且无 parentSession"，证明不了就当最坏打算，不给"拿不到身份就放行"的口子。
 */
export declare function bashGuardReason(exec: BashGuardExecution | undefined): string | undefined;
/**
 * 注册 shell 闸门：对**本 preset 的每个 agent**（含主 Agent）在它自己的 scope 上装一次 guard。
 *
 * 监听位置与 `registerRootToolPolicy` 同因：`agent/created` 的路由键是 agent 对象本身，
 * 注册在 standing scope（打了标签）的监听器**收不到且不报错**，必须挂 `ctx.root`。
 * 安装/释放都不得抛回 agent 创建路径——宁可少一层闸门，也不能挡住建 agent；
 * 静默失败会留下诊断 warn（见 `registerBashGuard` 的返回值处理）。
 */
export declare function registerBashGuard(ctx: PolicyContext): void;
