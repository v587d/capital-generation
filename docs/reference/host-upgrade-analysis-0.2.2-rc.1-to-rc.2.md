# 宿主升级分析报告：dsh 0.2.2-rc.1 → 0.2.2-rc.2

> **维护者文档**，不注入模型、不进 skill 目录。调查方式：只读——发布说明 + 把
> `dsh-subagent`、`dsh-tool-subagent`、`dsh-tool-subagent-control`、`dsh-agent-team`、
> `dsh-base` 等 0.2.2-rc.2 包从 npm 解包，对照本机 rc.1 的安装态逐项核对；本机宿主仍为
> `0.2.2-rc.1`，rc.2 的结论需按 §7 在真机复核后生效。
> 日期：2026-11-12。**本文是方案，不含代码改动。**

## 0. 结论

1. **rc.2 的多 agent 不是增量，而是换面。** rc.1 是“父↔直系子、`scope=children`、按 session id
   寻址”的邻接控制面；rc.2 换成“整棵树、`lead` + 全路径名、树内任意成员可互发、Team 按会话
   开关”的具名协作面。本仓的多 agent 纪律建立在旧拓扑上，所以冲击集中在编排层。
2. **两个 P0。** `wait_for_agents` 的宿主方法 `waitForChildren` 被 `waitForTreeWork` 取代；
   控制工具词汇整体换掉（`list_agents` 无参/整树/名字、`send_message` 的 `agent`、创建回执
   `name`、子→父 `lead`）。不改代码直接升：等待工具每次抛错、预检**静默**返回错形状、
   `send_message` 必失败。
3. **单轮编排仍然可行。** 一轮机制不依赖 AgentTeam，而是“主 Agent 保持在未结束的 tool call 里
   + 子 Agent 通知进 inbox”；rc.2 仍提供阻塞等子树的 `waitForTreeWork`，只是改名。Team 可以
   一直关着，不影响单轮。
4. **三个 P1 边界变化。** 树内任意互发（中继从“能力约束”降为“提示约束”）；根能看到孙 Agent
   （specialist）并可直接发消息；`dsh-base` 已挂 AgentTeam，Team 模式开启后 `team_task_*` 与
   `team:policy` 会进入所有 Capital Agent。
5. **数据/图表/UI/自动化/检索基本零改。** PTC 新增 2048 次/2 分钟调用上限，本仓远未触及。
6. **不建议照搬 AgentTeam 任务板。** 它不建模 `DatasetRef` / `profile_ref` / `chart_ref` /
   `task_id`，且对所有成员开放，和“叶子只回传、不创建不指挥”冲突。

## 1. 基线

| 字段 | 升级前 | 升级后（目标） |
|---|---|---|
| 本机全局宿主 | `@deepseek-ai/dsh@0.2.2-rc.1` | `0.2.2-rc.2` |
| 两个 dsh peer | `@deepseek-ai/dsh-skill` / `dsh-skill-filesystem` 精确 `0.2.2-rc.1` | 精确 `0.2.2-rc.2` |
| devDependencies | 三颗 dsh 包 `^0.2.2-rc.1` | `^0.2.2-rc.2`，lockfile 同步 |
| 本机 profile | `capital` / `web` 均 `link:/home/shawn/projects/capital-generation` | 不变；升级后重启宿主 |
| 多 agent 插件版本 | 2.21.0 | 建议 2.22.0（独立一节 CHANGELOG） |

## 2. 上游变化总表（与本仓相关的部分）

| # | rc.2 事实 | 关键形状 / 落点 | 与本仓关系 |
|---|---|---|---|
| 1 | 等待后端改名 | `SubagentRuntime.waitForTreeWork(root: Agent): Promise<boolean>`；`waitForChildren` 已从类型与实现消失 | `wait_for_agents` 后端 |
| 2 | `list_agents` 换面 | 无参数；整棵树（root + 所有可达 continuable 后代）；行 `{ name, status, description }`；首行 `lead`；无 `kind`/id/`scope` | 每轮预检、按 id 复用 |
| 3 | `send_message` 换参 | 必填 `agent`（树内名字或 session id）、`message`；输出 `{ messageId }`；`agent_id` 已删 | 根派发、子回传、PTC skill |
| 4 | 子 Agent 身份 | 运行时上下文只给名字：`You are a subagent delegated by agent "..."`、根为 `lead`；**不再注入 parent id** | `data_gap` / 回传 |
| 5 | 创建工具具名 | `dsh-tool-subagent` 新增可选 `name`（1–32 位小写字母/数字/连字符，字母开头，`lead` 保留）；回执 `{ kind:'activation', name }`，渲染 `started subagent <name>` | 委派清单、复用 |
| 6 | 控制面 | `interrupt_agent` 由 `config.interrupt` 控制（默认 true；`dsh-base` 行显式 false）；新增 `wait_agent`（`timeout_ms`，输出 `{ timedOut }`） | 错投补救、角色工具面 |
| 7 | Team 毕业 | `dsh-agent-team` / `dsh-tool-agent-team` / `dsh-client-ui-agent-team`；按 root session 开关，默认关；四个 `team_task_*`；`dsh-base` 已挂 | Capital profile 基于 dsh-base |
| 8 | 树内通信放宽 | 同一 subagent 树内任意两个成员可互发，不再限父↔直系子；根从 `list_agents` 能看到孙 Agent | 中继/叶子边界 |
| 9 | 参数校验静默面 | 工具参数对象开放（无 `additionalProperties:false`）；旧 `list_agents(scope="children")` 不报错，只被忽略并返回整树 | 预检静默错 |
| 10 | PTC 调用预算 | 每个 `run_code` 默认 2048 次工具调用（1024/分钟 × 超时）；超限终止并清空保留状态 | data_junior 程序 |

## 3. 影响评估

| 面 | 级别 | 说明 |
|---|---|---|
| 多 Agent 编排 | **高（P0）** | `waitForTreeWork` + 控制词汇；不改直接坏 |
| 角色边界 | **中高（P1）** | 树内互发、整树可见、Team 工具/策略 |
| 数据/图表/交付 | 低 | 本仓工具与 `deliverables/presented` 未变；批量 append 是加法 |
| UI/设置/自选股 | 低 | 无自定义定位浮层；官方 Menu/Modal |
| 自动化 | 低 | `drainDescendants` / `listDescendants` 仍在 |
| PTC | 低 | 2048 次/2 分钟，本仓程序远低 |
| 检索 | 低 | 自有 AnySearch/Wind/具名来源；宿主 `web_search` 默认换 DeepSeek 与本仓无关 |

### 3.1 单轮机制在 rc.2 是否仍成立

**成立。** 一轮不是 AgentTeam 的功能，也不是宿主“自动”保证的；它靠：

1. 主 Agent 调 `wait_for_agents` 时处于“执行工具”状态，**不是 idle**；子 Agent 的完成通知进根
   inbox，不会立刻开新 turn。
2. 工具内 `waitForTreeWork(root)` 等整棵子树没有推进中的工作，同时监听 `agent/inbox/inserted`；
   有 `agent-message` / `user` 就提前返回。返回 `message` / `user_input` 时下一步在同一 turn
   处理；返回 `all_settled` 才进入对账与最终答复。
3. rc.2 的 `waitForTreeWork` 语义与旧 `waitForChildren` 基本一致：等 local child 的
   `whenIdle()`、等 activation 的 `result` / `poke`，空闲且 inbox 有停放消息的子树不等待；且
   activation 的 result 在 cleanup + capacity release + settlement notification 之后交付，对
   “结算通知不能漏”反而更有利。

**残余风险**：`waitForTreeWork` 返回 `all_settled` 与最后一条 `subagent-settled` 插入 inbox
之间没有原子保证；宿主默认仍是“idle 父 Agent 收到通知就开新 turn”。项目只能靠“保持 turn 不
结束 + 对账 + settled-wake”压低，不能拿到硬保证。真机出现“最终答复后又被结算吵醒”时，再在
wait 工具里加有界静默窗口；不要预加魔数。

**AgentTeam 与单轮无关**：`waitForTreeWork` 在 `dsh-subagent`；Team 只是任务板 + 会话开关。
不开 Team，具名子 Agent 与 `waitForTreeWork` 仍可用；开 Team 也不会让单轮更稳，只会多四颗
任务工具和一段 policy。

## 4. 迁移方案

### 4.0 决策清单（先定，再动手）

| 决策 | 建议 | 备选 / 说明 |
|---|---|---|
| **D1 基线** | 只支持 rc.2，两个 dsh peer 精确 pin；`wait` 工具保留 `waitForTreeWork ?? waitForChildren` 的运行时兜底 | 不做双 persona；兜底只为回退，不承诺 rc.1 |
| **D2 角色名** | `data-collector` / `data-junior` / `web-retriever`；`description` 继续用 `data_collector` 等角色标签；specialist 用 `chart-1` 或不命名 | **下划线非法**；名字与 description 是两字段 |
| **D3 Team** | 保持关闭；优先在 Capital profile 禁用 `agent-team` / `tool-agent-team`；不行则 deny 四个 `team_task_*` 并文档声明不支持 | 只 deny 工具**不去** `team:policy` 文本 |
| **D4 interrupt** | 根 control 行显式 `interrupt:true`；角色行显式 `interrupt:false`；保留调用级兄弟 guard | 先验证 base 的 false 与 preset 的 true 谁生效 |
| **D5 消息边界** | 新增全局 `send_message` 目标 guard：根只发无 `/` 且非 `lead` 的名字；叶子只发 `lead`；specialist 全拒；非 Capital fail-open | 不做则中继只剩人设约束；guard 数 3→4 |
| **D6 `wait_agent`** | 保留可见；不替代 `wait_for_agents`；角色是否 deny 由实施者定，建议保留 | 只返回 `{ timedOut }` |
| **D7 根预检** | `list_agents()` 后只取 `name` 不含 `/` 且 `!== 'lead'`；name 优先、description 兜底 | 历史 child 无 name 时按 session id（无 `/`）处理 |
| **D8 结算竞态** | 保留对账表；不预先加静默窗口；真机出现 late notice 再加有界等待 | `settled-wake` 继续兜底 |

### 4.1 运行时

#### `src/agents/wait-for-agents.ts`（P0）

- `WaitSubagentsLike` 同时接受 `waitForChildren?` / `waitForTreeWork?`；优先新方法；二者都缺才
  抛错，错误文案点名“宿主未提供 waitForTreeWork/waitForChildren”，不要再说“服务未挂载”。
- 保留：30 秒片、`agent/inbox/inserted` 竞速、`message` / `user_input` / `timeout` /
  `all_settled` 四态、`runningRows`、无 `isConcurrencySafe`。
- `runningRows` 继续用 `listDescendants` 的 `kind/id/label/activity`；rc.2 行形状兼容，不用重写。
- 不要用 `wait_agent` 替代；不要改 `all_settled` 语义；不要加并发声明。

#### `src/agents/settled-wake.ts`（P2，预计零改）

- 继续按 `source.kind === 'subagent-settled'` + `senderSessionId` 丢弃“有 relay 的 child”的
  冗余通知；名字化不影响 `senderSessionId`。
- 补回归：具名 child 的结算通知仍被正确丢弃/保留；silent child 的唯一通知不被误删。

#### `src/agents/role-tool-policy.ts` / `root-tool-policy.ts` / `policy-entry.ts`（P1）

- `SIBLING_DENIED_TOOLS` 保持 `interrupt_agent` / `list_agents`；`list_agents` 整树化后更重要。
- D3 走 deny 路线：把四个 `team_task_*` 加进 Capital 根/角色 deny；走禁用行路线则不改。
- D5 采用：新增 `send_message` 目标 guard（可独立 `src/agents/messaging-policy.ts`），全局装
  一次；`policy-entry.ts` 注册；`inject = ['tools']`。
- 更新注释：control 行现在四颗（`send_message` / `interrupt_agent` / `list_agents` /
  `wait_agent`），`interrupt` 有宿主开关。
- 同步 `test/apply-integration.test.mjs`（全局 guard 3→4、sibling 参数 `agent`）、
  `test/policy-dedup.test.mjs`（3→4、重装 6→8）、`test/role-tool-policy.test.mjs`、smoke 的
  guard 计数。

#### `src/orchestration-entry.ts`

- 只改注释：`waitForTreeWork` 取代 `waitForChildren`；工具仍是根专属。

### 4.2 Persona / preset

#### `preset/capital-generation/agent.patch.yml`（P0）

主 persona `# SUBAGENT ORCHESTRATION`（L538 起）：

- 预检改 `list_agents()`；直系 = `name` 不含 `/` 且不是 `lead`；孙 Agent
  （`data-junior/...`）一律忽略。
- 名字纪律：创建时 `name` 固定为 `data-collector` / `data-junior` / `web-retriever`，
  `description` 保持角色标签；同名创建会被 `DUPLICATE_AGENT_NAME` 拒绝，不要重试；创建回执是
  `started subagent <name>`，清单记 name 而不是 id。
- 派发：`send_message({ agent: "<name>", message })`；禁止 `agent_id`；禁止发 `lead` 或含 `/`
  的名字。
- 子→父：`send_message({ agent: "lead", ... })`；不再提“parent agent id”。
- 错投补救：`interrupt_agent({ agent: "<name>" })`（仅当根确实有该工具；D4 验证后保留）。
- 等待：`wait_for_agents`；不以等待行/空正文结束回合；`all_settled` 后先对账再写最终答复；
  不要用 `list_agents` 轮询，不要用 `wait_agent` 替代。
- Team：明确“不使用 `team_task_*`，不把任务板当委派清单；角色树与中继纪律不变”。

角色 persona：

- `data_collector` / `data_junior` / `web_retriever` 的回传示例改 `{ agent: "lead" }`；
  `list_agents` 仍不可用；specialist 继续不调用 `send_message`。

control 行：

- 根 `config.interrupt: true`；角色 `config.interrupt: false`（若 D4 采用）。
- 更新“0.2.2 起主入口一次焊三颗”的旧注释为四颗。
- 委派行配置不动：`provider` / `toolName` / `agentPreset` / `maxDepth` 闭集未变；不要加
  `persona` / `toolFilter`。

#### `preset/capital-generation/README.md`

- 更新编排说明：名字化、`waitForTreeWork`、Team 不启用；不写 § 编号、不写实现层标识。

### 4.3 Skills（8 份命中控制词汇）

#### `capital-orchestration/SKILL.md`（P0，25 处，主战场）

删除/替换：`list_agents(scope="children")`、`kind=child`、`id [status] — label`、
`agent_id`、`durable id`、`subagentId`。

新结构建议：

1. 预检：`list_agents()`；行格式 `<name> [<status>] — <description>`；首行 `lead`；直系过滤；
   状态 `running/inactive/corrupt/unsupported/unavailable`。
2. 角色匹配：name 优先（`data-collector` 等），description 兜底；历史无 name 的 child 用
   session id（无 `/`）。
3. 名字纪律：不抄 UUID；发送前重新 list 一次确认；名字精确匹配；不发明名字；不用 `/` 名。
4. 创建：`name` + `description` + `prompt`；每会话同角色一个；同名报错不重试。
5. 委派清单：`name` 列替代 `durable id` 列；`task_id` / refs 不变。
6. 诊断：`corrupt/unavailable` 不新建；`send_message` 报 unknown/self/sibling 时重查一次，
   不立刻新建。
7. 等待与对账：`wait_for_agents` 四态；`all_settled` 后对账表；`wait_agent` 不是替代。
8. 错投补救：`interrupt_agent({ agent })`；若根没有该工具，改成“发纠正消息并等回执”。

#### `capital-data-profile/SKILL.md`（L158）

- PTC 示例改 `await tools.send_message({ agent: "lead", message: ... })`；删“parent agent id”。

#### `capital-data-query/SKILL.md`（L40–L41）

- 同上；`data_gap` 回传目标为 `"lead"`。

#### `capital-data-protocol/SKILL.md`

- 所有 `send_message` 描述改为 `agent`；提到父级时写 `lead`。

#### 其余四份

`capital-equity-research`、`capital-event-impact`、`capital-portfolio-review`、
`capital-visualization-protocol`：只改引用 `list_agents` / `send_message` 的句子；specialist 可
加一句“可选 `name: "chart-<n>"`，根不直接寻址它”。

**统一 gate**：模型可见文本（`preset/capital-generation/agent.patch.yml` +
`preset/capital-generation/skills/**/*.md`）中不得再出现 `agent_id`、`scope="children"`、
`kind=child`、`durable id`、`subagentId`；建议加一条扫描测试防回潮。

### 4.4 测试

| 文件 | 改动 |
|---|---|
| `test/wait-for-agents.test.mjs` | harness 接受两种方法；新增“只有新方法”“只有旧方法”“都没有→精确报错”“running 行兼容”用例；保留四态/竞速/取消清理 |
| `test/persona.test.mjs` | L739 `scope="children"`→`list_agents()` 直系过滤；L743 `agent_id`→name 复制；L757 `durable id`→name；L1346 skill 模式更新；L144 控制工具清单加 `wait_agent`；新增负向断言旧词不出现 |
| `test/role-tool-policy.test.mjs` | deny 名单/注释；`interrupt:false` 导致缺席时容忍 miss；加 `wait_agent`/team deny 时逐项断言 |
| `test/apply-integration.test.mjs` | `siblingCall` 参数 `agent` 而非 `agent_id`；全局 guard 3→4（若 D5）；只装一次；fail-open |
| `test/policy-dedup.test.mjs` | 全局 guard 3→4；重装 6→8；监听器计数不变 |
| `test/root-tool-policy.test.mjs` | 根 deny 加 team 工具时更新名单形状 |
| `test/ptc-preset.test.mjs` | PTC `tools.send_message` 形状；skill 文本断言 |
| `test/settled-wake.test.mjs` | 加具名 child 的结算通知用例；预期零代码改动 |
| `test/automation-runner.test.mjs` | fake 里若用 `waitForChildren`，补 `waitForTreeWork` |

原则：规则迁移必须同步断言；旧断言不能“删掉变绿”，要换成更强的新断言（例如不仅断言
`agent`，还断言 `agent_id` 不出现）。

### 4.5 探针 / 账本 / 文档

#### `scripts/check-dsh-compat.mjs`

- **L35**：宿主 `send_message({ agent_id: ${encodedParentId}` 已删；改读
  `dsh-tool-subagent-control` 的 `subagent:identity` 上下文，断言
  `You are a subagent delegated by agent`、`The root agent ... "lead"`、
  `send_message({ agent:`、`list_agents({})`；PTC 部分不动。
- **L36**：`waitForChildren(parent: Agent)` → `waitForTreeWork(root: Agent): Promise<boolean>`；
  实现侧断言 `waitForTreeWork`、`whenIdle`、`result`/`poke`；保留 `listDescendants` 行形状、
  inbox/status、`agent-message` / `subagent-settled` 源类型。
- **L12**：账本文字“三颗”改“四颗”；若 `wait_agent`/team 加入 deny，探针同步。
- **新增 L38（控制词汇）**：`list_agents` 无参/行 `{name,status,description}`；
  `send_message.agent` 必填；`subagent.name` 可选 + 回执 `name`；`interrupt` 配置；
  `wait_agent.timeout_ms`/`{timedOut}`。
- **新增 L39（Team 面）**：`dsh-base` 的 `agent-team`/`tool-agent-team` 行、四个
  `team_task_*`、`defaultEnabled:false`、会话开关；若本仓禁用/deny，断言对应防线。
- L31（委派行配置）/L37（`drainDescendants`）预期不变；若红，先查上游是否另有改名。

#### `docs/reference/dsh-surface-ledger.md`

- L35/L36 重写；新增 L38/L39；升级 runbook 第 1 步点名“具名子 Agent / waitForTreeWork /
  Team”；历史表加一条 2026-11-12 记录。

#### `docs/dev/data-roles.md`

- §1.4：“父 Agent id 由框架注入” → 子→父用 `lead`；父 Agent 按名字发回同一 child；历史
  child 无 name 时用 session id。
- §1.7：`waitForChildren` → `waitForTreeWork`；四态/30 秒片/竞速不变；说明“根保持 tool call
  未结束”是一轮机制。
- §1.8：角色树标注名字（`data-collector` 等）与 specialist 全路径。

#### `docs/dev/preset-persona.md`

- §8.4：“label 优先，旧标题按 durable id 沿用” → name 优先、description 兜底；control 行
  四颗；`interrupt` 配置；Team 不启用。

#### `AGENTS.md`

- §1 一句话版：`wait_for_agents` 仍在；补“根只发直系、子只发 lead、specialist 不直连”。
- §6.1：委派出口/族行 invariant 加一句“Team 是宿主全局行，不属 preset 族行；自动模式禁用/
  deny”。
- 注意 16KB 硬闸门与 `test/dev-docs.test.mjs` 的行数/体积断言；只改必要句。

#### `README.md` / `CHANGELOG.md` / `package.json`

- README 徽章与“最新版本已适配” → `0.2.2-rc.2`；用户可见说明只写“支持具名子 Agent /
  单轮编排不变”，不写内部 API。
- 两个 peer 精确 pin rc.2；devDeps 同步；lockfile；版本号抬一档。
- CHANGELOG 单独一节：适配 rc.2、具名子 Agent、`waitForTreeWork`、控制词汇 name/agent、
  Team 关闭、迁移注意。

### 4.6 Smoke / 真机

`scripts/smoke-boot.mjs`：

- `agentPresets.resolve('capital-generation').broken === null`；control 行 active；
  `wait_for_agents` 注册；根 `interrupt_agent` 在场（D4）；角色 `interrupt_agent` 不在场
  （若 config false）。
- Team：Capital 会话不出现 `team_task_*`；若禁用行，断言行 disabled；若 deny，断言工具不可见；
  `team:policy` 不在 prompt（仅禁用行能保证）。
- guard 计数：3→4（若 D5），`identityGuards` 同步。

真机清单：

1. 单轮三角色 + 出图：根 `turn/start` 只 1 次；最终答复后无新 turn；结算通知在收尾前处理；
   `settled-wake` 无多余 step。
2. 名字：`list_agents` 行 `data-collector [..] — data_collector`；根发 `data-collector`；
   子发 `lead`；重复名报 `DUPLICATE_AGENT_NAME`；下划线名报 `INVALID_AGENT_NAME`。
3. 边界：根发 `data-junior/chart-1` 被 guard 拒；叶子发兄弟被拒；specialist 无
   `send_message`。
4. Team：打开开关，Capital 工具面/prompt 不出现 Team 内容；关闭后无变化。
5. 手开角色会话：`list_agents` / `interrupt_agent` 不可见或被 guard 拒；`send_message` 只能
   `lead`。
6. 历史会话：旧 child 无 name，`list_agents` 按 session id 列出；根可复用/发消息；不新建同名
   角色。

### 4.7 执行顺序

| 阶段 | 内容 | 出口 gate |
|---|---|---|
| **P0 基线** | 安装 rc.2、重启；`dsh --version`；跑 `check:dsh` 记录 L35/L36 红；确认实际形状 | 红线条目与 §2 一致；不一致先更新方案 |
| **P1 等待** | `wait-for-agents.ts` 双后端 + 测试；L36 探针/账本 | `node --test test/wait-for-agents.test.mjs` 绿；L36 绿；真机不再抛错 |
| **P2 名字/词汇** | persona + 8 份 skill + 测试 + L35 + 词汇 gate | 模型可见文本零旧词；`persona.test` 绿；L35 绿；真机预检/派发/回传成功 |
| **P3 边界** | `interrupt` 配置、Team 禁用/deny、`send_message` guard（若 D5）；测试 | 根/角色/Team/手开会话四条真机检查通过；guard 计数绿 |
| **P4 账本/文档/版本** | L38/L39、ledger、data-roles、preset-persona、AGENTS、README、CHANGELOG、peer pins | `npm test` + `check:dsh` + README/dev-docs 闸门全绿 |
| **P5 真机收尾** | 单轮三角色 + 出图；历史会话；手开角色；Team 开关 | §6 DoD 全过；记录 `turn/start` 与结算时序证据 |

## 5. 坑清单

### 5.1 P0 坑（会让编排直接坏）

1. **`wait_for_agents` 每次报“服务未挂载”**：rc.2 删了 `waitForChildren`；旧代码在方法缺失时抛
   通用错误。防线：双后端优先 `waitForTreeWork`；错误文案点名方法；L36 探针；测试“只有新方法”。
2. **预检“看起来成功”，实际返回整棵树**：`list_agents` 参数对象开放，`scope` 被忽略；行无
   `kind`/id；首行 `lead`。防线：`list_agents()` + 直系名过滤；负向断言；真机看行格式。
3. **`send_message` 每次失败**：必填 `agent`，旧 `agent_id` 缺 required。防线：全局替换；
   PTC skill 同步；`rg 'agent_id' preset/` 零命中。
4. **子→父回传找不到 parent id**：身份上下文只给名字。防线：直接角色统一
   `{ agent: "lead" }`；specialist 不发；skill 删“parent id”。
5. **创建回执不是 id**：`{kind:'activation', name}`。防线：清单列改 name；persona 不再写
   `subagentId`。

### 5.2 P1 坑（不报错，但会侵蚀架构）

6. **名字用了下划线**：name 规则只允许小写字母/数字/连字符；`data_collector` 会被
   `INVALID_AGENT_NAME` 拒。防线：`data-collector` 等；description 保留角色标签。
7. **同角色重复创建**：只有同名才被宿主拒；旧会话/未命名 child 不受约束。防线：预检先按
   name/description 找旧 child；同名报错不重试；历史 child 用 session id 复用。
8. **根直接找 specialist**：`list_agents` 整树可见，`send_message` 树内任意成员可发。防线：
   根只发无 `/` 名；D5 guard；persona 禁止 `data-junior/...`。
9. **中继从“能力约束”降为“提示约束”**：rc.2 允许树内任意互发。防线：D5 guard；不做就接受
   风险并写文档。
10. **Team 模式偷偷进入 Capital**：`dsh-base` 已挂；开启后四个 `team_task_*` + `team:policy`
    进入所有成员。防线：禁用两行或 deny 四个工具；注意 deny 不去 policy 文本；真机开关验证。
11. **根丢了 `interrupt_agent`**：base 行 false、preset 行默认 true；谁生效未定。防线：根行显式
    `interrupt:true`；真机看工具表；仍无则删错投补救。
12. **`wait_agent` 被误当收尾屏障**：只返回 `{timedOut}`。防线：persona 明确只用
    `wait_for_agents`。

### 5.3 操作/流程坑

13. **结算通知在最终答复后到达**：`waitForTreeWork` 与最后一条 `subagent-settled` 插入无原子
    保证；宿主默认 idle 唤醒。防线：对账表/`settled-wake`；真机确认；出现 late notice 才加
    有界静默窗口。
14. **宿主提示“结束回合等结果”带偏模型**：rc.2 系统提示更明确建议 end turn。防线：persona
    显式覆盖“委派后先 wait_for_agents，不以等待行结束”。
15. **探针/账本只改一半**：L35 宿主 prompt 已换、L36 方法已换；只改代码不改探针会红，只改
    探针不改账本会失真。防线：L35/L36 + 新 L38/L39 一起改；不删断言。
16. **混装 rc.1/rc.2 进程**：共享会话存储的进程需同步升级。防线：web/desktop/headless 一起
    升；升级后重启；peer 精确 pin，不用 `^rc.2`。
17. **PTC 长循环撞调用上限**：2048 次/2 分钟；所有 binding 计数。防线：不要把大批查询塞进一个
    `run_code` 循环；超限会清空保留状态。
18. **Session 批量 append / 图表交付**：rc.2 支持批量 append，日志格式不变；本仓
    `owner.append` 直接调用。防线：零改动；不要新增 wrapper；交付回归照跑。
19. **UI 浮层定位**：rc.2 改菜单定位接口，自定义浮层需适配；本仓无自定义定位浮层。防线：
    零改动，别顺手改 chart-ui/watchlist。
20. **文档/AGENTS 体积闸门**：AGENTS.md 16KB 硬闸门；persona/patch 也有体积测试。防线：只改
    必要句，跑 `test/dev-docs`/persona 体积闸门。

## 6. 验收清单（DoD）

- [ ] `dsh --version` = `0.2.2-rc.2`；重启过宿主；web/desktop/headless 同步升级。
- [ ] `package.json` 两个 dsh peer 精确 `0.2.2-rc.2`；devDeps/lock 同步；版本号/README/
      CHANGELOG 更新。
- [ ] `npm test` 全绿；没有为变绿删断言；新增 rc.2 形状测试。
- [ ] `npm run check:dsh` 全绿；L35/L36 重写；L38/L39 新增；L31/L37 未无故改动。
- [ ] `npm run smoke:boot`：preset `broken=null`；control 行 active；`wait_for_agents` 在；
      根 interrupt 按决策；Team 工具/策略按决策不出现。
- [ ] 模型可见文本零 `agent_id` / `scope="children"` / `kind=child` / `durable id` /
      `subagentId`；有自动扫描或测试钉住。
- [ ] 真机单轮：一个用户请求，根只 1 个 `turn/start`；最终答复后无新 turn；三角色 +
      specialist 全收口；有图时交付行正常。
- [ ] 名字：`data-collector` / `data-junior` / `web-retriever` 可创建、可复用；重复名被拒；
      下划线名被拒；历史无 name child 可按 session id 复用。
- [ ] 边界：根只发直系；叶子只发 `lead`；specialist 不发；手开角色同样受 guard。
- [ ] Team 开关打开/关闭：Capital 工具面与 prompt 不受影响（或按决策明确记录偏差）。
- [ ] `docs/dev/data-roles.md`、`preset-persona.md`、ledger、AGENTS 与实现一致；README 不含
      内部细节。

## 7. 必须真机确认的问题

1. preset 的 `interrupt:true` 是否压过 `dsh-base` 的 `interrupt:false`？根工具表里有没有
   `interrupt_agent`？
2. Team 开关在 Capital 会话是否可见？开启后四个 `team_task_*` 是否真的进入根/角色工具面？
   `team:policy` 是否进入 prompt？
3. `waitForTreeWork` 是否在最后一条 `subagent-settled` 插入后才 resolve？单轮场景是否还有
   late notice？
4. `list_agents` 渲染是否严格为 `<name> [<status>] — <description>`、首行 `lead`？
5. `send_message({agent:"lead"})` 从直接子 Agent 是否总是可达？根用名字是否可达 inactive
   child？
6. `name` 含连字符是否通过；重复名/下划线名的错误码是否如文档？
7. profile patch 能否按 id 禁用 `agent-team` / `tool-agent-team`？若不能，deny 路线是否足够？
8. `settled-wake` 对具名 child 的 `senderSessionId` 是否仍正确？
9. 角色 control 行 `interrupt:false` 后，`SIBLING_DENIED_TOOLS` 的 deny 是否记录为 miss？
   测试能否容忍？
10. `wait_agent` 是否出现在叶子工具表？保留还是 deny？
11. rc.2 是否要求 Node ≥24.9？本机/发布说明是否需同步。
12. `check:dsh` L31/L37 是否仍绿？若红，先查上游是否还有未列出的改名。

## 8. 回滚

- 迁移作为一个版本/一个 PR 落地；回滚 = **整包回退**，不是只改 peer pin（persona/skill 已按
  rc.2 写，单回 pin 会文本错配）。
- 回滚步骤：还原 `package.json`/lock/README/CHANGELOG；`npm install`；重装
  `@deepseek-ai/dsh@0.2.2-rc.1`；重启宿主；跑 `npm test` + `check:dsh`。
- `wait` 工具的双后端兜底可保留，回滚期间不会坏；但不要对外承诺 rc.1 兼容。
- 不要在同一会话存储上混跑 rc.1/rc.2 进程；升级/回滚都让 web/desktop/headless 同步。

---

**给实施 Agent 的一句话**：先修 `waitForTreeWork` 让一轮机制活下来，再把
`list_agents`/`send_message`/创建回执从 id 迁到 name，最后用 `interrupt` 配置、Team 禁用/
deny、`send_message` guard 把边界补回来；每步同步账本与探针，别让“静默错”混过去。
