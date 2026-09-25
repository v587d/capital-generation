# 角色边界与数据调度纪律（详情）

> 索引见仓库根 `AGENTS.md` §1。改 `src/data-collector/`、`src/agents/` 或任一子 persona 之前读这里。
> §编号沿用 `AGENTS.md` 的全局命名空间，代码注释按 § 指向本文件。

## 1.1 各角色的硬边界

- **`data_collector`**：唯一接收上游原始数据的子 Agent；宿主立即持久化到 workspace，只回传
  `DatasetRef`。叶子节点——不得创建或指挥下游子 Agent（回归 `test/persona.test.mjs`，下同「叶子
  边界」）。
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
  - **能力边界**：没有外部行情 API、网页检索、通用 filesystem、Python coding，不自查凭据。
    `bash` 是**纯计算兜底**，**不是取数通道**（§1.6 → `bash-gate.md`）。data_analyst 启用前逐行 /
    序列级分析没有合规路径，须如实告知用户并降级到统计能力。
- **主 Agent 读数据一律委派 data_junior**，绝不直接调用 Dataset 系列工具（工具层拒绝主 Agent，
  `dataset_session_mismatch`）。
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

## 1.5 capability 发现与体积预算

- `data_key` 是宿主内部路由字段，不进模型协议；模型侧只用短小全局唯一的 capability 名。
- **两级发现**：`list_capabilities()` 精简目录（capability + ≤50 字 summary + paginated），
  `describe_capability` 完整 schema。目录**刻意不带 schema**（全量曾达 23KB 被剪枝截断中间，
  中间能力发现阶段不可见）。新增 Fuyao 端点必须同时写 `summary` 与 `description`（单位、null
  语义、时间与分页口径）。
- **行数组位置由数据源声明**：`guard.itemKey` → `rowShape`，存储层不靠 `data.item` 猜（实测龙虎榜
  在 `stock_items`）。**新增端点若行数组不叫 `item`，必须在 guard 写明 `itemKey`**。
- **目录体积真实上限** = pruner 的 `thresholdChars`（preset 配 8192，超过则中间被剪枝）；该阈值
  **不能按 Agent 区分**（全仓只有 pruner 一个包持有它，主 / 子共用 standing composition）。由
  **测试**先失败而非运行时静默截断（`test/data-collector-hub.test.mjs`）：**目录 < 6144、单能力
  详情 < 4096**；`test/data-collector-capabilities.test.mjs` 断言能力总表与实现一致。
