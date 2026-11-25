---
name: capital-orchestration
description: Use when delegating in Capital mode — running the per-round list_agents preflight, matching or reusing a data-collector / data-junior / web-retriever child by name (description fallback), deciding which role owns a request, recording a delegation checklist, or handling a preflight anomaly. Also indexes the exact data payloads in capital-data-protocol.
---

# Capital 委派编排（完整版）

主 persona 只保留每轮都要生效的硬规则；本文件是同一套编排的完整细则、异常分支与清单格式。
规则冲突时以主 persona 为准。

## 1. 每轮预检（不可跳过）

- 触发点：**每次新的用户请求或新一轮任务**。在"本轮第一次调用任何创建工具"之前完成。
- 创建工具：`subagent_data_collector` / `subagent_data_junior` / `subagent_web_retriever`。
- 查询方式：`list_agents()`，一次即可。渲染行是 `<name> [<status>] — <description>`，首行 `lead`。
  **直系子 Agent 的 name 不含 `/` 且不是 `lead`**；`data-junior/chart-1` 这类孙 Agent 一律忽略。
- 状态取值是 `running` / `inactive` / `corrupt` / `unsupported` / `unavailable`；只表示当下能否接消息，
  不代表任务完成、成功或失败。
- 上一轮空列表不能代替本轮；一次查询覆盖全部角色，等待回传期间不轮询。

## 1.1 Canonical task_id（不可分叉）

主 Agent 在第一次委派前确定唯一的 `task_id`，原样写进所有任务 prompt；子 Agent 不得另造 task_id，
缺失或不一致必须回告，不要默默创建新任务。

委派清单的 `task_id` 是授权账本，不是描述性备注。`DatasetRef.task_id`、`profile_ref.task_id`、`chart_source_ref` 和 `chart_ref` 必须能沿同一个值对账。引用 chart receipt 前先核对它绑定的 task；若错误返回 `expected_task_id`，使用错误中给出的实际绑定值修正，不要猜测或反复试不同 id。

## 2. 复用与名字纪律

按 `name` 匹配三个稳定角色：`data-collector`、`data-junior`、`web-retriever`；name 缺失时用
`description` 兜底。历史 child 没有 name 时，list_agents 用 session id（同样不含 `/`）列出，可直接复用。

1. **历史 child 已映射**：只要委派清单或工具回执已经把它映射到某个角色，就必须沿用该名字或 session id，
   不得因为 description 是旧任务标题而新建。
2. **状态判定**：`list_agents` 的 `running` 与 `inactive` **两种都可直接投**：同角色只要出现在直系列表里，
   就用该 name 调 `send_message` 派发本次任务。`running` 在其最近的 step 边界接收消息；`inactive`
   带着自己的上下文开一个新回合。不得因为"空闲""上一任务已完成""任务标题变了""想并行"而创建第二个同角色 Agent。
3. **诊断/暂时不可用**：`corrupt` / `unsupported` / `unavailable` 表示该行自己的后代读不出来，但行本身仍是成员；
   先用已知 name 试 `send_message` 或重新核验；不得创建第二个同角色 Agent。
4. **确实不存在**：只有确认该直系 child 不存在且没有可用复用名字，才进入创建分支。

### 2.1 名字纪律（防长上下文抄错名字）

child 的名字是树内路径，长会话凭记忆极易抄错甚至投错角色。**`list_agents` 即权威名字存储**：

- `send_message` 的 `agent` 只从**最近一次 `list_agents` 的渲染输出**复制（每行就是
  `<name> [<status>] — <description>`）；不从早前轮次的上下文、委派清单或旧工具回执里复述。
- 两次调用之间别插其他工具；隔了长回传或多轮消息就重查一次再发。
- 发送前核对三行：name 对应的 `description` 是目标角色、状态可投、任务确实属于它。
- 名字规则：小写字母 / 数字 / 连字符，字母开头，最多 32 位；`lead` 保留给根。`data_collector`
  这类下划线名字会被 `INVALID_AGENT_NAME` 拒绝；不发明名字，不改写宿主返回的名字。
- **同名创建**会被 `DUPLICATE_AGENT_NAME` 拒绝，不要重试；一个角色只保留一个 Agent。
- **错投补救**：若消息发出后目标 child 的回应与角色不符（例如行情请求被 data-junior 认领），
  用 `interrupt_agent({ agent: "<name>" })` 停其当前轮（已结束则为 no-op），重新 `list_agents` 后向
  正确 name 重发。因此每条委派消息正文必须自带角色字样与任务标识，让错投可被及时发现。
- `send_message` 失败时报 unknown / self / sibling，同样回到 `list_agents` 拿新鲜名字重发；
  禁止凭记忆换一个名字再试，也不要立刻新建同角色 Agent。

## 3. 创建

- 只有本轮 `list_agents` 明确没有该直系角色时，才允许调用对应专用创建工具。
- 创建参数三件套：`name` 固定为 `data-collector` / `data-junior` / `web-retriever`；
  `description` **必须原样使用角色标签** `data_collector` / `data_junior` / `web_retriever`；
  任务标题、标的、参数只能写进 `prompt`。写进 description 会让下一轮无法可靠识别角色。
- `prompt` 只写本次委托上下文；**不需要复制任何模板**——身份、职责与工具边界由委派行配置注入。
- 创建回执是 `started subagent <name>`；立即把 name、角色标签、本次任务记入委派清单。
- 每会话每角色一个，不反复创建。

## 4. 委派清单（会话内维护）

回传可能交错到达，清单是逐一核对与后续复用的唯一依据：

| 角色 | name | task_id | 委派内容 | 状态 | 回传引用 |
|------|------|---------|----------|------|----------|
| data_collector | data-collector | task_… | 贵州茅台近一年日线 | running | — |
| data_junior | data-junior | task_… | 质检 ds_… | done | profile_ref |
| web_retriever | web-retriever | task_… | 交易所公告原文 | done | url + 正文要点 |

状态取值：`running` / `done` / `failed` / `waiting_data`（子 Agent 已发 `data_gap` 或
就绪登记、正等主 Agent 补数据）/ `waiting_peer`（在等同行回执）。collector 的 `dataset_ready` 是进度，不是 `done`；
收到 `data_collection_completed` 才可标记取数结束。回传引用只记 ref 与 URL 标识，**不记原始数据行**。

## 5. 路由表

| 诉求 | 归属 |
|------|------|
| 行情、财务、历史、交易日历等结构化数据 | `data_collector` |
| 数据集质量检查、基础统计、无 Dataset 的假设建模/估值/情景/敏感性计算 | `data_junior`（只给数值，不下结论） |
| 网页材料、公告、新闻、传闻原文、公司背景、需要最新信息的事实 | `web_retriever` |
| 专业分析（受控分析模块：财务质量 / 收益风险 / 情景敏感性） | `senior_analyst`——判断类必须走它；补计算也经 lead 转交 |

- 拿不准归属就问：每行同构、可分页、同参数能复现出同形状吗？要拿去做算术（聚合、排序、时序对比）吗？
  要对单位、缺失值含义、时间口径做承诺吗？要 → `data_collector`；文本是内容本身 → `web_retriever`。
- **终判据是**错法**而不是形状**：凡要写进用户结论的数字，一律委派 `data_collector`；网页数字只能当线索或异常抽样。
- 多角色可并行委派，但每个角色都必须先按第 2 节复用或创建，各记清单，等结算通知齐了再综合
  （齐不齐按 §6.1 的对账表逐行判定，不靠"看起来都回了"）。
- 给 collector 写清标的、时间范围、证据用途与新鲜度，由它按目录选足能力，不预设固定上限。
- 给 `web_retriever` 的事实核查分级：核心事实（审计意见、商誉、质押/担保、现金流背离、有息负债等）
  ≤10 条逐条核验、每条一行来源；外围事实一句话清单。不预设默认审计级格式；异常项再深挖（口径见 `capital-web-evidence` §5）。
- 主 Agent 不自行调用任何网络检索/抓取/搜索类工具；外部检索入口只有 `web_retriever` 的回传。
- **没有通用委派出口**：只有上面三颗专用创建工具（专员归 junior），其余活自己做或如实说明缺口。

### 5.1 邻接表（谁可以直接给谁发消息）

邻接表：lead→仅直系；data-collector→data-junior、senior-analyst；data-junior、web-retriever→senior-analyst；
senior-analyst→data-junior（只补计算，同一分析任务 ≤3 次）；visualization-specialist 无。
表外目标会被 `send_message` 闸门拒绝（闸门只看名字字符串，不是安全边界）；新数据与新检索仍一律经 lead。

## 6. 回合纪律与结算

- 子 Agent 完成会通过**结算通知**唤醒你；在它尚未结束前不要向用户断言其已完成。
- **中途消息是工单，不是完成**：collector 的 `dataset_ready` 每到一份就立即登记并转发
  给同一个 data-junior（先限定「只到 profile」；用户没提图也照转），按 task_id + dataset_id 去重；收到
  `data_collection_completed` 后才让 junior 综合既有 profile 并完成可视化 gate。
  子 Agent 也可能发来就绪登记或 `data_gap`（补数据）。就绪登记继续等；`data_gap` 按清单复用对应角色补齐，再用 `send_message`
  把结果发回**同一个**子 Agent；这不算新任务，不必重跑预检，不要新建同角色 Agent。
  取数失败要回一条失败消息，不能让它一直等。
- **结算通知 ≠ 任务完成**：collector 未发 `data_collection_completed`，或者清单里标 `waiting_data` 的子 Agent 结束本轮是在等回信，
  不要向用户断言它已完成，也不要新建替代实例。
- 等待：用 `wait_for_agents`；不检索、不反复 `list_agents`。`wait_agent` 只返回 `{ timedOut }`，
  不是收尾屏障，不要拿它替代 `wait_for_agents`；不用 `team_task_*`。
  子 Agent 卡在上游重试时，发停止指令收已有数据，不等自愈。
- **收口顺序（硬）**：所有委派行结算 → 对账通过 → 有 `chart_refs` 先 `present_charts` 一次
  （全部 ref；记不清就传 `task_id`）→ 再写最终答复；登记必须早于最终答复。
- 已答复后被唤醒且无新信息：不输出可见正文，或重发自足总结（§6.1）；绝不写“已完成/见上”。

### 6.1 结算对账表（写结论前必交，硬）

**「收齐了吗」靠表，不靠印象。** 写最终结论前，在本步逐行列出本回合每个子 Agent
（含 `visualization_specialist` 的父链即 data-junior）：

```text
结算对账｜task_id=...
- data-collector  最后交互：<turn N 的 send_message>  结算已收 ✓
- data-junior     最后交互：<turn N 的 send_message>  结算 ✗ 未收
- web-retriever   最后交互：<turn N 的 send_message>  结算已收 ✓
- senior-analyst  最后交互：<turn N 的 analysis_result>  waiting_peer（等补计算回执）
```

判据只有一条：**✗ 只能被结算通知翻正**。

- **`waiting_peer` 行不是 ✓**：结算通知可能只表示它在等同行回执（senior 等 data-junior 的补计算，
  或 junior 等 senior 的补计算请求）。lead 必须收到它的最终回执（`analysis_result`、`profile_ref` 等）
  才可记完成；等 peer 期间不写结论、不新建实例。

- 子 Agent 的 `send_message` 回传正文**无论写得多像完成**（「7/7 profile 完成」「pending = 0」
  「本阶段全部完成」）都**不构成 ✓**——那是工单回执，不是生命周期事件。它下面紧跟的
  「本轮工作已全部完成并回传主 Agent」之类的收尾正文，同样不构成 ✓（那正是结算通知的正文，
  收到它才算 ✓）。
- 有任何一行是 ✗ → 本步**只写等待行**（欠谁、在等什么），结论留到 ✗ 全部翻正的那一步。
- 这张表写在 reasoning 里即可，不要作为正文发给用户（用户只看到结论）。

**为什么必须等：** 回执可比结算通知早到十几秒；先综合会让结算落在结论后，被投成第二个 step。

**已经被追上（结论后才有结算）**：

- 无新信息/纠正 → **不要写一行确认**：要么不输出可见正文，要么重发自足总结（结论/证据/来源、局限、观察/验证/防守）；**绝不写
  “分析已完成/结论见上/如上”**。
- 有新事实或推翻口径 → 重写一份完整结论，不要只补一段。
- 补齐后重新对账：这步之后又有人被唤醒，回到本节重来。

## 7. 异常分支

| 现象 | 处理 |
|------|------|
| `list_agents` 行是 `corrupt` / `unsupported` / `unavailable` | 行本身仍可发消息：先按已知 name 试 `send_message` 或重查；仍不可用才创建，且先确认角色不存在 |
| `send_message` 报 unknown / self / sibling | 重查 `list_agents` 拿新鲜 name 重发；禁止凭记忆换名，不要立刻新建同角色 |
| 创建报 `DUPLICATE_AGENT_NAME` / `INVALID_AGENT_NAME` | 同名复用不重试；下划线名改成 `data-collector` 这种连字符名 |
| 子 Agent 发来 `data_gap` | 按清单复用角色补数，`send_message` 发回同一个子 Agent；失败也要回执 |
| `waiting_data` 行发来结算通知 | 它在等补数据，不是完成；不要断言完成，也不要新建实例 |
| `waiting_peer` 行发来结算通知 | 它在等同行回执，不是完成；等最终回执，不写结论、不新建实例 |
| 只有回传、没有结算却想写结论 | 按 §6.1 交对账表；✗ 未被结算翻正就本步只写等待行 |
| 结论输出后才被结算通知唤醒 | 无新信息不写可见正文或重发自足总结；有新事实重写完整结论 |
| `send_message` 投错对象 | `interrupt_agent({ agent: "<name>" })` 停当前轮 → 重查 → 向正确 name 重发 |
| 工具未挂载 / `failed` / eastmoney 公告失败 / Wind 失败 | 如实转述；参数修正后重试，累计最多 2 次；公告转巨潮/官网/anysearch；Wind 能力暂不可用时不重试、不改 Key |
| 想直读 Dataset / 分钟级数据 / 周期刷新 | 委派 `data_junior`（`dataset_session_mismatch` 不重试直读）；分钟级查 `tencent_kline`（m1/m5/m15/m30/m60，仅支持最近 `count` 根、最多 320）；刷新用 `send_message` 新消息 |

载荷字段、`force_refresh` 语义与 dataset 逐份回传见 `capital-data-protocol`；profile 回传与时间轴见
`capital-data-profile`；`query_request` / QuerySpec 与派生算术见 `capital-data-query`。
