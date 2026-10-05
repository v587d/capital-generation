# 角色边界与数据调度纪律（详情）

> 索引见仓库根 `AGENTS.md` §1。改 `src/data-collector/`、`src/agents/` 或任一子 persona 之前读这里。
> §编号沿用 `AGENTS.md` 的全局命名空间，代码注释按 § 指向本文件。

## 1.1 各角色的硬边界

- **`data_collector`**：唯一接收上游原始数据的子 Agent；宿主立即持久化到 workspace，每次
  `request_data` 返回一份 DatasetRef 就向主 Agent 发送一次 `dataset_ready`（缓存命中、分页每页也一样），
  每次最终失败发 `data_failed`，所有请求结束再发 `data_collection_completed`。不设单回合能力数量上限，
  根据问题所需证据与实际来源选择，绝不为凑能力而全量遍历。叶子节点——不得创建或指挥下游子 Agent
  （回归 `test/persona.test.mjs`，下同「叶子边界」）。
- **`data_junior`**（`subagent_data_junior`）：主 Agent 直接子 Agent，与 data_collector 是兄弟、
  后者不得指挥它；只接收 `DatasetRef`。用法口径在工具 description、子 persona 与 skill
  `capital-data-protocol`，本节只留维护者约束：
  - **⛔ 省往返靠 `isConcurrencySafe: () => true` + 框架并发池**：**不要**改成"一次调用合并返回
    多份 dataset"——会同时废掉体积闸门和 hint。
  - **⛔ 体积闸门只有一道**：超过 `SAFE_RESULT_CHARS = 7000` 码点返回 `{status:'too_large',
    profile_ref, columns, hint}` 小回执，按 hint 用 `columns_of_interest`（或 queries ≤8 条）
    重发。**不要**再引入 digest / 裁剪阶梯，也不要因一次重发砍事实块（超预算的成因总是塞多了）。
  - **出图只有一个入口**：`prepare_chart_source` 创建 one-shot `visualization_specialist` 并汇总
    `chart_ref`（§6 → `chart-presentation.md`）。主 Agent 不出图、不在正文罗列图表文件。
  - **gate 的"必须出图"以委派范围为前提**（2026-09-26 实机冒烟）：主 Agent 说"停在 profile"，
    data_junior 仍按"可视化 gate 是硬步骤"一路出图——工具行为符合协议，但用户的范围指令没被遵守。
    现在两侧都有言：**委派方**要显式写「只到 profile」，**被委派方**认收窄、仍给 gate 结论但不出图，
    并写明"未出图是委派收窄而非数据不支持"。回归 `test/persona.test.mjs`「可视化 gate」用例。
  - **能力边界**：没有外部行情 API、网页检索、通用 filesystem、Python coding，不自查凭据。
    `bash` 是**纯计算兜底**，**不是取数通道**（§1.6 → `bash-gate.md`）。data_analyst 启用前逐行 /
    序列级分析没有合规路径，须如实告知用户并降级到统计能力。
- **主 Agent 读数据一律委派 data_junior**，绝不直接调用 Dataset 系列工具（工具层拒绝主 Agent，
  `dataset_session_mismatch`）。collector 每送达一份 DatasetRef 就把该份交同一个 junior 先到 profile / query，
  收到 collector 终结消息后才要求综合与可视化 gate；同一 task_id + dataset_id 不重复派发。
- **`visualization_specialist`**：one-shot 前台子 Agent，工具表只有 `skill` + `render_chart`；
  spec 由它组装，data_junior 只交"要什么视图"。
- **`data_analyst`**：保持 `disabled`，启用前置条件见 §8.4（`preset-persona.md`）。
  **`web_retriever`**：纪律见 §4.1（`web-retriever.md`）。

## 1.2 两条数据边界（必须分清；2026-09 放宽仅此一处）

- **消息边界（不放松）**：Agent 间消息只传 `DatasetRef`、表结构、profile 引用和统计结果，
  **禁止携带原始 rows**。
- **工具返回边界（有界放松）**：`profile_dataset` 对 data_junior 返回宿主算出的事实（字段以
  schema 为准）；文档型 Dataset 额外返回有界 `document`（`MAX_DOCUMENT_CHARS = 6000` 码点，
  留在剪枝阈值 8192 以内，截断逐条写进 `omitted`）。原始 rows **仍然不进** data_junior 上下文。

## 1.4 `data_gap` 与回合语义

- **`data_gap` 不需要插件代码**：data_junior 用 `send_message` 向父 Agent 发**补数据请求**（细则
  在 persona 与 skill `capital-data-protocol`，两侧都有断言）；框架原生支持 child → direct
  parent 回程，父 Agent id 由框架注入。
- **子 Agent 结束本轮 ≠ 任务完成**：等数据的子 Agent 会先结束回合。委派清单用 `waiting_data`
  标记；收到结算通知不得认定完成、不得新建同角色实例。
- **最终结论前对账结算通知**（真机 `01d6197b`：回传先到、结算后到，结论被切成两个消息）：收齐
  每个子 Agent **最后一次交互之后**的全部结算通知才写结论。对账只约束顺序 ≠ 完成判定；不是猜
  轮号（那条路见 §6.3 → `chart-delivery-events.md`）。回归 `test/persona.test.mjs`「对账结算通知」。
- **对账必须是逐行产物，不是心算**（真机 `cst7n9j3` turn 11 复发，规则当时已存在但被跳过）：
  data_junior 汇总回执先到、结算通知 **14s 后**到，而结论生成占了 **156s**，主 Agent 在 reasoning
  里直接写 "All three roles done" 就开始综合——把回传正文（"7/7 完成、pending = 0"）当成了完成
  证据。框架侧没有商量余地：step 边界 inbox 非空就必然再开一个 step 投递那条结算，turn 不会结束
  （对比同一会话 turn 9→10：结算到达时 turn 已收，splice 目标是 `next-turn`，落成干净的新轮）。
  所以修法是把沉默的判断变成必须输出的**结算对账表**（格式与"✗ 只能被结算通知翻正"的判据在
  skill `capital-orchestration` §6.1），漏计会表现为自相矛盾的行而不是悄悄溜过去；结论已被追上的
  处置（无新增信息只回一行、有新事实才重写）同节。回归断言在 `test/persona.test.mjs`
  「对账表」与「skill 内容」两处。

## 1.5 capability 发现与体积预算

- `data_key` 是宿主内部路由字段，不进模型协议；模型侧只用短小全局唯一的 capability 名。
- **两级发现**：`list_capabilities()` 是**纯文本目录，一行一条** `capability|summary|paginated`
  （1/0；`|` 与换行由生产者转义——分隔符撞车的后果是一条能力被读成两条），`describe_capability` 给
  `description` / `input_schema` / `output_fields`。目录**刻意不带 schema**（全量曾达 23KB 被剪枝截断中间，
  中间能力发现阶段不可见）。新增 Fuyao 端点必须同时写 `summary` 与 `description`（单位、null
  语义、时间与分页口径）。
- **`output_fields` 只是 `output_schema` 的投影**：一行一字段 `路径:类型[:说明]`，`?` = 上游可能给
  `null`，`[].` = 数组元素的字段。改成投影是因为逐列 JSON Schema 让详情体积按**列数**增长（每列 ~55
  字符，72 列 = 4699 字符，第一次注册就打穿 4096）；字典每列 ~15 字符。**权威声明仍住
  `output_schema`**，护栏与 §9.6 的返回值校验照旧按 schema 走，字典不构成第二份真相。
- **行数组位置由数据源声明**：`guard.itemKey` → `rowShape`，存储层不靠 `data.item` 猜（实测龙虎榜
  在 `stock_items`）。**新增端点若行数组不叫 `item`，必须在 guard 写明 `itemKey`**。
- **目录体积真实上限** = pruner 的 `thresholdChars`（preset 配 8192，超过则中间被剪枝）；该阈值
  **不能按 Agent 区分**（全仓只有 pruner 一个包持有它，主 / 子共用 standing composition）。由
  **测试**先失败而非运行时静默截断（`test/data-collector-hub.test.mjs`）：**目录 < 6144、单能力
  详情 < 4096**（2026-10-05 实测 69 条：目录 2435 = 40%、最大详情 2771 = 68%；编码前的 JSON 数组
  是 5530 = 90%，58% 的字节是键名和标点）；`test/data-collector-capabilities.test.mjs` 断言能力总表与实现一致。
