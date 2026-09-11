---
name: capital-orchestration
description: Use when delegating in Capital mode — running the per-round list_agents preflight, matching or reusing a data_collector / data_junior / web_retriever child by role label, deciding which role owns a request, recording a delegation checklist, or handling a preflight anomaly. Also indexes the exact data payloads in capital-data-protocol.
---

# Capital 委派编排（完整版）

主 persona 只保留每轮都要生效的硬规则；本文件是同一套编排的完整细则、异常分支与清单格式。
规则冲突时以主 persona 为准。

## 1. 每轮预检（不可跳过）

- 触发点：**每次新的用户请求或新一轮任务**。在"本轮第一次调用任何创建工具"之前完成。
- 创建工具指：`subagent_data_collector`、`subagent_data_junior`、`subagent_web_retriever`、
  `subagent`，以及今后新增的任何委派工具。
- 查询方式：`list_agents(scope="children")`，一次即可。
- 不要把它当成"仅在会话恢复时才做的回忆步骤"：上一轮查到的空列表不能代替本轮查询。
- 一次查询结果覆盖本轮所有角色，不要为每个角色重复查询；等待回传期间也不要轮询。

## 2. 匹配与复用

只处理 `kind=child` 的条目。按 `label` 精确匹配三个稳定角色标签：`data_collector`、
`data_junior`、`web_retriever`。

1. **标签非标准但已映射**：历史 child 的 label 仍是旧任务标题时，只要委派清单或工具回执
   已经把它映射到某个角色的 durable id，就必须沿用该 id，不得因为 label 非标准而新建。
2. **状态判定**：同角色只要存在 `running`、`idle` 或 `ready` 任一状态，立即用该 id 调用
   `send_message` 派发本次任务。
   - `running` 会在其最近的 step 边界接收消息；
   - `idle` 会开始一个新回合；
   - `ready` 会冷恢复后继续。
   不得因为"空闲""上一任务已完成""任务标题变了""想并行"而创建第二个同角色 Agent。
3. **诊断/暂时不可用**：已记录 id 但列表出现 diagnostic 或暂时不可用，先用该 id 尝试
   `send_message`，或重新 `list_agents` 核验；不得直接创建第二个同角色 Agent。
4. **确实不存在**：只有确认该 child 不存在且没有可用复用 id，才进入创建分支。

### 2.1 ID 纪律（防长上下文抄错 id）

child id 是随机 UUID、无语义可校验，长会话里凭记忆/从历史轮次复述 id 极易抄错，甚至把
A 角色的请求投给 B 角色。官方机制是 **`list_agents` 即权威 id 存储**——id 不需要被记住，
只需要在用之前 freshly 查一次：

- `send_message` 的 `agent_id` 只从**最近一次 `list_agents` 的渲染输出**复制（每行就是
  `id [status] — label`）；不从早前轮次的上下文、委派清单或旧工具回执里复述 id。
- `list_agents` 与 `send_message` 之间不要插入其他工具调用；中间隔了长回传或多轮消息，
  就重新 `list_agents` 一次再发。
- 发送前三行核对：这一行 id 的 `label` 是不是目标角色、状态是否可投（running/idle/ready
  均可投）、本次任务是否确实属于该角色。
- **错投补救**：若消息发出后目标 child 的回应与角色不符（例如行情请求被 data_junior
  认领），用 `interrupt_agent` 停其当前轮（已结束则为 no-op），重新 `list_agents` 后向
  正确 id 重发。因此每条委派消息正文必须自带角色字样与任务标识，让错投可被及时发现。
- `send_message` 失败时报"不存在/无效 id"，同样回到 `list_agents` 拿新鲜 id 重发，
  禁止凭记忆换一个 id 再试。

## 3. 创建

- 只有本轮 `list_agents` 明确没有该角色标签时，才允许调用对应专用创建工具。
- `description` **必须原样使用角色标签**：`data_collector` / `data_junior` / `web_retriever`。
  任务标题、标的、参数只能写进 `prompt`。写进 description 会让下一轮无法可靠识别角色。
- `prompt` 只写本次委托上下文；**不需要复制任何模板**——身份、职责与工具边界由委派行配置注入。
- 创建返回 durable `subagentId` 后，立即把 id、角色标签、本次任务记入委派清单。
- 每会话只需一个 `data_collector`、一个 `data_junior`、一个 `web_retriever`，不要反复创建。

## 4. 委派清单（会话内维护）

回传可能交错到达，清单是逐一核对与后续复用的唯一依据：

| 角色 | durable id | task_id | 委派内容 | 状态 | 回传引用 |
|------|-----------|---------|----------|------|----------|
| data_collector | … | task_… | 贵州茅台近一年日线 | running | — |
| data_junior | … | task_… | 质检 ds_… | done | profile_ref |
| web_retriever | … | task_… | 交易所公告原文 | done | url + 正文要点 |

状态取值：`running` / `done` / `failed`。回传引用只记 DatasetRef、profile_ref、URL 等标识，
**不记原始数据行**。

## 5. 路由表

| 诉求 | 归属 |
|------|------|
| 行情、财务、历史、交易日历等结构化数据 | `data_collector` |
| 数据集质量检查、缺失/重复/时间范围/基础统计 | `data_junior` |
| 网页材料、公告、新闻、传闻原文、公司背景、需要最新信息的事实 | `web_retriever` |
| 专业分析（Python、回测、统计检验、图表） | 尚未启用——先由 `data_junior` 出基础 profile，并如实告知用户 |

- 多个角色都要时并行委派，但每个角色都必须先按第 2 节复用或创建，各记清单，等结算通知齐了再综合。
- 主 Agent 不自行调用任何网络检索/抓取/搜索类工具；外部检索入口只有 `web_retriever` 的回传。
- 三个已定义角色禁止用通用 `subagent` 创建替代实例；通用委派只用于本 preset 没有专用角色的
  新任务，且同样必须先做本轮预检。

## 6. 回合纪律与结算

- 子 Agent 完成会通过**结算通知**唤醒你；在它尚未结束前不要向用户断言其已完成。
- 等待回传期间：不做任何外部检索/抓取、不反复 `list_agents`、不轮询等待。
- 回传到达后集中核对材料与结论，再决定继续委派或汇总输出。
- 已向用户输出完整答案后被唤醒，且没有新增信息或纠正时不再重复输出，仅在确有必要时补充。
- 永远不要设置 `run_in_background: false`；所有委派必须是 continuable。

## 7. 异常分支

| 现象 | 处理 |
|------|------|
| `list_agents` 出现 diagnostic / 条目暂时不可用 | 先用已知 id 试 `send_message` 或重查一次；仍不可用才考虑创建，且必须先确认该角色确实不存在 |
| `send_message` 失败 | 重新 `list_agents` 确认 id 与状态，从新鲜输出复制 id 重发；禁止凭记忆换一个 id 再试；不要立刻新建同角色 Agent |
| `send_message` 投错对象（目标 child 的回应与角色不符） | `interrupt_agent` 停错投目标当前轮（已结束则为 no-op）→ 重新 `list_agents` → 向正确 id 重发；委派消息正文自带角色字样与任务标识可让错投被及时发现 |
| 子 Agent 回告「工具未挂载」 | 如实转述状态与检查建议，不要编造工具或数据；数据侧提示检查 `request_data`/`list_capabilities`，统计侧提示检查 `inspect_dataset`/`profile_dataset` |
| 子 Agent 回传 `failed` | 按 `error` 与 `code` 判断：参数问题先修正参数再 `send_message` 重试；网络/服务类最多重试 1 次；同一请求重试 2 次仍失败就如实告知用户 |
| 子 Agent 回传 wind_docs 失败（AUTH/RATE_LIMIT/额度类） | Wind 检索暂不可用（Key 缺失/过期或额度不足）：如实告知用户 Wind 能力暂不可用，本轮材料由 anysearch 承担（公告线索搜索 + 官方披露页 fetch）；不要重试 Wind，也不要索取或改配 Key |
| 出现「想直接读取 Dataset 内容」的冲动 | 改为委派 `data_junior`（`inspect_dataset` / `profile_dataset`）；主 Agent 直接调用 Dataset 系列工具会被工具层拒绝（`dataset_session_mismatch`），被拒后不要重试直读，改走委派 |
| 任务需要分钟级/小时级数据而数据管道只支持日线 | 如实向用户披露能力边界；用日线统计（data_junior）+ quote 快照 + 网页旁证降级分析，不编造分钟级走势 |
| 需要周期刷新（如每日收盘快照） | 用 `send_message` 指示 `data_collector` 再次获取并回传；不存在订阅机制——新需求 = 新消息，回传即唤醒 |

载荷字段、`force_refresh` 语义与 dataset/profile 回传格式见 skill `capital-data-protocol`。
