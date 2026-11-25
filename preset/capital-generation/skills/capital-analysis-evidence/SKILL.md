---
name: capital-analysis-evidence
description: Use when freezing or reviewing the inputs of a Capital analysis — deciding which Dataset / profile / evidence refs belong in an AnalysisSnapshot, reading bounded profile facts, classifying missing data (not delivered vs not in the source vs unsupported), and writing an analysis_data_request through the lead.
---

# 证据与快照（完整版）

在建快照之前和读 profile 之后看这一册。它回答三件事：**这一版输入够不够支撑问题**、
**缺的那些分别属于哪一类**、**要补数据时怎么提**。提交前的数字规则在 `capital-analysis-validation`。

## 1. 建快照前的六问

1. **问题**：一句话说清要判断什么（不是"分析一下这家公司"，而是"毛利率是否可持续 / 现金流是否支撑利润"）。
2. **标的**：公司 / 代码 / 组合，写进 `instrument`；多个标的要分开建快照，除非问题本身就是比较。
3. **期间与 as_of**：结论站在哪一天、覆盖到哪个报告期或交易日；`as_of` 与 `data_cutoff` 必须来自主 Agent
   或用户，不自己推。as_of 晚于数据覆盖时，要在结论里点名"该窗口内没有数据"。
4. **输入**：哪些 DatasetRef、哪些 profile、哪些证据条目，各自服务于哪个子问题。
5. **证据等级**：官方披露 / 媒体转述 / 用户提供；用户粘贴的材料标 `pasted by user`，不因粘贴提高置信度。
6. **完成标准**：到什么程度算够（核心比率能否算全、关键事件是否有官方来源），写进 `constraints`。

六问答不全就先问一次主 Agent，不要用默认值把问题糊过去。

## 2. 快照里放什么

```json
{
  "task_id": "task_...", "question": "...", "instrument": "600519.SH",
  "purpose": "research", "depth": "standard", "as_of": "2025-06-30",
  "dataset_refs": [{ "dataset_id": "ds_..." }],
  "profile_refs": [{ "profile_id": "profile_..." }],
  "evidence": [{ "source_id": "ev_annual_2024", "kind": "filing",
                 "title": "2024 年年度报告", "published_at": "2025-03-28",
                 "excerpt": "营收…（只放摘要）", "verification": "verified_official" }],
  "prior_analysis_refs": [], "constraints": { "must_show_method": true }
}
```

- `kind` 只能 `filing` / `news` / `research` / `user_material`；
  `verification` 只能 `verified_official` / `unverified` / `not_verified`——**没有官方来源就写后两个**，
  不要为了"看起来权威"写 verified。
- `excerpt` 是摘要，不是全文；正文留在检索侧，快照不存大段文本。
- refs 逐份校验：任意一份读不到、过期或不属于本会话，整次建快照失败并点名是哪一份——先修 ref，不要删掉它硬建。
- 同一任务重跑要**重建**快照；旧快照不会因为主 Agent 补了新数据而更新。

## 3. 读 profile 的纪律

- `read_profile` 只给有界事实：行数、列、缺失、重复、时间覆盖与质量标签，**没有行级数据**。
- 判断"这份数据能不能支撑结论"看三点：列是否覆盖所需字段、时间覆盖是否包含所需期间、
  质量标签（`validation` / `warnings`）里有没有致命项。
- 超预算时工具返回小回执 + hint：用 `columns_of_interest` 收窄，不要反复原样重读。
- profile 事实是**输入说明**，不是结论本身；不要把它改写成"数据很好/很差"这种判断。

## 4. 缺口的三种来源（处置完全不同）

| 缺口 | 表现 | 处置 |
|---|---|---|
| **还没取到** | 快照里没有这份 Dataset / 字段 | 发 `analysis_data_request` 给 lead；不加默认值 |
| **数据里确实没有** | 列在、值缺失或字段未披露 | 写 `data_gaps`，结论降级，点名缺哪个字段哪一期 |
| **口径不支持** | 有数据但频率/币种/期间对不上，或模块不适用 | 换模块或如实写"本模块口径算不了"，不硬套 |

三类都要在回执里说清，主 Agent 才能决定是补数还是降级答复。

## 5. 补数请求（经主 Agent）

```json
{ "protocol": "capital.agent.message/v1", "type": "analysis_data_request",
  "task_id": "task_...", "analysis_id": "analysis_...",
  "payload": { "instrument": "600519.SH", "need": ["利润表 2021-2024 年报"],
               "fields": ["operating_income", "net_profit", "operating_costs"],
               "period": ["2021", "2022", "2023", "2024"], "as_of": "2025-06-30",
               "why": "财务质量模块需要多期趋势，目前只有 2024 一期", "blocking": true } }
```

- 一次把要什么写全：标的、字段、期间、as_of、用途、是否阻塞；不要挤牙膏式一条一条要。
- `blocking: false` 表示可以先出降级结论；`true` 表示没有它就只能 blocked。
- 不要在请求里指定数据源或给服务商键名——那是主 Agent 和取数侧的事。

## 6. 三个模块的输入契约

**`financial_quality`（三表横截面）**

- 吃**三份 Dataset**：利润表（`operating_income` + `net_profit`）、资产负债表（`assets_total` +
  `holder_equity_total`）、现金流量表（`act_cash_flow_net`）。靠列签名识别，不需要预拼宽表。
- 三份都要有公共报告期键：优先 `period_end_ms`，否则 `period`；同一报表同一报告期只能一行。
- `params`：`period`（可选，默认最新一期；`2024`、`2024-FY`、`2024-12-30` 都认，报错会列出可选报告期）、
  `compare_previous`（可选，默认 true 算环比）、以及 `income_dataset_id` / `balance_dataset_id` /
  `cashflow_dataset_id`（多份同型时报错时用来指名）。
- **报告期标签来自报告期键，不来自数据源的 `period` 列**：A 股三表的 `period` 列实测是常量 `annual`，
  每期都一样；选期用 `period_end_ms` 的日期（如 `2024-12-30`）或 `fiscal_year`（如 `2024`）。
  `financial_indicators` 这类 **document 型 Dataset 不能当分析输入**（没有行数组），不要塞进快照。
- 返回：`metrics`（比率 6 位小数、金额原币元、`currency` 记币种）、`assumptions`（EBIT 近似、
  期末余额口径、`total_debt` 是负债合计不是有息负债、累计口径、不换汇）、`data_gaps`（缺表/缺列/
  分母无经济含义）、`outputs`（每个指标的公式与输入值，可逐项复算）。
- `status` 语义：三张表齐且零缺口 → `completed`；有缺口 → `partial`；缺利润表 → `blocked`。
  `partial` 不是失败，是"这几项没算"的诚实表达，如实转述。

**`returns_risk`（单价格序列）**

- 吃一份价格序列 Dataset：时间列（`time_coverage` 列或 `date` / `trade_date_ms` 等）＋正价格列
  （`close` / `adj_close` / `close_price` / `price` / `nav`）；可选第二份做基准（beta / 相关）。
- `params`：`price_dataset_id` / `benchmark_dataset_id`（同型多份时指名）、`risk_free_rate`（年化小数，
  省略按 0 并在摘要与假设里披露）、`confidence`（VaR 默认 0.95）、`periods_per_year`（默认 252）、
  `timezone`（数值时间轴标日期用）。有效观测少于 3 个 → `blocked`；坏行跳过并写进 `data_gaps`。
- `metrics`：区间/年化收益、年化波动、最大回撤、夏普 / 索提诺 / Calmar、历史 VaR / CVaR，给了基准才
  有 beta / 相关。样本少于 30 个收益只是"方向性参考"，模块会写进 limitations。

**`scenario_sensitivity`（假设网格）**

- **不读 Dataset**，只吃 `params`：`target_name` + 1–4 个 `factors`（`base`，可选 `exponent`）＋
  `grid`（因子扫描值）和/或 `scenarios`（具名情景）；`model` = `product`（Π factor^exponent）或
  `sum`（Σ factor×exponent）。
- 因子基准值来自已核过的结果（如 `financial_quality` 的 `metrics` 或 profile 事实），不要凭记忆填；
  情景里没写的因子继承基准，输出的 `inherited` 会标出来。
- 输出是**调用方恒等式在不同假设下的取值**：不是概率、不是预测；网格最小/最大不是置信区间，也不是目标价。

## 7. 证据不足也要给结论

- 允许建快照、跑模块、提交 `partial` / `blocked` 产物；**不允许**用训练记忆或行业常识补缺的数字。
- `evidence_level=insufficient` 时产物 `status` 不能写 `completed`。
- 结论强度跟着证据走：官方披露 > 媒体转述 > 用户提供；单一来源的关键判断要标"待交叉验证"。
