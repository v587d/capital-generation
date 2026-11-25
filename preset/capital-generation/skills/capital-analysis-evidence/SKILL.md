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

## 6. 模块输入契约

先 `list_analysis_modules` → `describe_analysis_module` 看 `input_schema`，再按形状取用；`params` 自创字段会被拒。

**三表横截面**

- `financial_quality`：三份 Dataset（利润表 `operating_income`+`net_profit`；资产负债表 `assets_total`+
  `holder_equity_total`；现金流量表 `act_cash_flow_net`），按 `period_end_ms`/`period` 对齐；`params`
  `period`、`compare_previous`、`{role}_dataset_id`。A 股 `period` 列实测是常量 `annual`，选期用日期或
  `fiscal_year`。缺整张利润表 → `blocked`，缺列/分母无意义 → `partial`。
- `statement_integrity`：同样三份表；校验资产负债恒等式、现金流对账、留存收益滚动；`params` `period`、
  `tolerance_ratio`（默认 0.1%）、`tolerance_abs`。差异是发现不是缺口；缺 `retained_earnings` /
  `dividends_paid` 时只报缺口，不估算。

**利润表两期**

- `earnings_bridge`：一份利润表序列（≥2 期，`operating_income`+`net_profit`；税前分解另需
  `profit_total`+`income_tax_expense`）；`params` `period`、`income_dataset_id`。收入/净利率与税前/税率
  两条恒等式的效应必须加回净利润差额；只有一期 → `blocked`。

**价格序列**

- `returns_risk`：一份时间列+正价格列，可选基准 Dataset；`params` `risk_free_rate`、`confidence`、
  `periods_per_year`、`timezone`。有效观测 <3 → `blocked`，<30 只作方向性参考。
- `kline_quality`：一份 OHLC 日 K（open/high/low/close 必需，volume 可选）；`params` `jump_threshold`
  （默认 0.5，只标 suspect 不删）。输出清洗序列 + 逐行拒绝原因；全被拒 → `blocked`。
- `technical_indicators`：同一价格序列 + 指标窗口（`sma_windows`/`ema_windows`/`rsi_period`/`macd_*`/
  `boll_*`/`atr_period`，至少给一组）；窗口不足的指标写缺口。指标是复盘条件，不是方向预测。
- `simple_backtest`：价格序列 + `rule`（`sma_cross`/`price_above_sma`）+ `fast_window`（`sma_cross` 另给
  `slow_window`）+ `fee_rate`；信号 t 根收盘、t+1 根收盘执行；样本内、参数由你给，不做寻优，结果不许
  写成策略推荐。

**横截面 / 组合**

- `comps_valuation`：peers 横截面（一行一家，`market_cap`+`net_profit`，可选 `equity`/`revenue`/
  `enterprise_value`/`ebitda`）；可选 `subject_dataset_id` 只比一只标的；多份同型表必须用
  `peers_dataset_id` 指名。中位数只描述样本，不是目标价。
- `portfolio_stress`：`positions[]`（dataset_id + weight，权重和 = 1）+ `windows[]`（name/start/end 历史
  区间）；每个持仓一份价格序列。窗口越界写缺口、不借日期；历史回放不是假设情景。

**参数型（不读 Dataset）**

- `scenario_sensitivity`：显式恒等式（`product`/`sum`）+ 1–4 因子基准 + 网格/情景；因子基准必须来自已核过
  的 `metrics` 或 profile，不凭记忆填；输出是算术取值，不是概率或预测。
- `valuation_sensitivity`：`projections`（显式 FCF 序列）+ `wacc` 或完整 CAPM 参数 + `terminal_growth`、
  `net_debt`、`shares_outstanding`；输出模型值与 WACC×g 格点，**不是目标价**；`wacc ≤ g` 的格点写 null+缺口。
- `hello`：只做环境自检，不产出结论，不要用它回答研究问题。

## 7. 证据不足也要给结论

- 允许建快照、跑模块、提交 `partial` / `blocked` 产物；**不允许**用训练记忆或行业常识补缺的数字。
- `evidence_level=insufficient` 时产物 `status` 不能写 `completed`。
- 结论强度跟着证据走：官方披露 > 媒体转述 > 用户提供；单一来源的关键判断要标"待交叉验证"。
