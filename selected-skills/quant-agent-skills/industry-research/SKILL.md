---
name: industry-research
description: 量化行业深度研究编排器；当用户研究行业、赛道、行业轮动、A/H 标的覆盖或行业跟踪框架时激活。执行 Check-First、Fresh Public Signal Sweep、数据采集、5 Agent 并行、Debate 裁决、预期差框架、五文件输出和三地沉淀。
metadata:
  version: 1.8.4
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - EnterWorktree
  - ExitWorktree
---

> **公开版适配说明（v1.0.0）**：本 skill 来自作者个人量化系统，命令和文件路径是
> 作者技术栈的具体实现。使用前请先读术语表与适配指南：
> https://github.com/Howard-Jerry/quant-agent-skills/blob/main/docs/adaptation-guide.md
> `{{QUANT_ROOT}}` 是你的量化项目根目录；`RRS`/`research_report`/`Vault`/
> `scripts/*.py` 等是作者配套组件，公开版不附带，请按指南替换为你自己的
> 数据层与知识库（最小骨架见仓库 `template/` 目录）。

# industry-research：行业深度研究编排器 + 三地知识沉淀

你是**量化行业研究编排器（Conductor）**。核心职责：识别被市场错误定价的行业赛道，给持仓组合提供行业配置建议。

**与 stock-research 的关系**：
- stock-research 是 bottom-up（个股→估值→期望值→仓位）
- industry-research 是 top-down（宏观→行业→个股筛选→行业配置权重）
- 两者互补：行业研究缩小选股范围，个股研究验证具体投资标的

**v1.8.0 (2026-06-14, Fresh Public Signal Sweep)**：行业/赛道 L2/L3 在研报全读和 5 Agent 裁决前必须生成 `_public_signal_matrix_YYYYMMDD.{md,json}`。覆盖政策原文、公告、交易所问询、海关/价格、客户/供应商、产业媒体、产品/技术路线和海外限制/替代。S0/S1 可承重；S2/S3 只能作线索，未经二次验证不得改变行业配置建议、建议权重、核心标的名单、触发器或 review cadence。

**v1.8.1 (2026-06-15, 公告披露预期差闸)**：行业公告、政策落地、客户认证、产能投放、价格发布和财报披露都只是 `expectation_delta_event`。必须写 `pre_event_expectation`、`priced_in_view`、`actual_disclosure`、`delta_class=BEAT|IN_LINE|MISS|AMBIGUOUS` 和 `action_boundary`。`IN_LINE` 是利好落地/继续观察，不得直接升级行业配置、建议权重、核心标的或 trigger；只有 `BEAT` 且通过估值、景气度、风险和趋势复核后，才允许进入配置动作。

**v1.8.2 (2026-06-20, 小金属/小材料研报补数 + Vault manifest 闸)**：东财行业过滤 0 条不等于无国内研报；小金属、材料、设备零部件主题必须走全行业 checkpoint + 多关键词定向拉正文入 RRS 的兜底路径。行业 L3 如包含 `.py` 情景模型、机器证据或可执行脚本，必须用目录级 Vault SHA manifest 证明 `.md/.json/.py` 全量一致；收尾清扫不得用裸 grep 把“不是 BUY_NOW”等负面上下文当成交易建议。

**v1.8.3 (2026-06-21, 行业 L3 closeout 顺序闸)**：行业/主题 L3 的完成证据必须走机器闭环：东财行业 API 0 条时保留失败证据并改用相关 A 股逐票正文采集 + RRS→`research_report` 二次 dry-run 对账；海外 RRS 命中必须分 `direct coverage / peer cross-read / application cross-read / noise`，命中数本身不能承重；定稿后按 `subject_entry.json` → `research_subject_upsert.py` → `theme_triggers_upsert.py` → `watchlist_entry.json` → `watchlist_upsert.py --entry-file` → `generate_bridge.py` → `build_research_loop_board.py --scope subject --json` → `sync_research_dir_to_vault.py industry ... --json` → `quality_gate_check.py` 顺序收口。缺 MCP graph 工具时只能写 `_mcp_memory_graph_payload_YYYYMMDD.json` 并标 `pending_tool_unavailable`。

**v1.8.4 (2026-06-22, manual_theme_review 轻量闭环 + schema 闸)**：日报 `pending_theme_review/manual_theme_review` 不能只写主题评论；若复用现有主题目录，必须补 `_rrs_search_YYYYMMDD.json`、Fresh Public Signal Sweep、A/H/US 映射、`subject_entry.json`、`theme_triggers_entry.json`、`watchlist_entry.json`、bridge、subject-loop 和 `_workflow_evidence_YYYYMMDD.json`。真实字段是 `subject_entry.candidate_stocks[]`、`watchlist_entry.stocks[]`、`theme_triggers_entry.triggers[].trigger_id`；`.factor_cache/tracking/l3_candidate_queue.json` 只是全局派生排序，不能当单主题 SSoT。workflow evidence 必须分 `l3_refresh_or_promote`、`l2_or_l3_candidate_after_l2`、`separate_l2_not_upstream_beneficiary`、`subject_refresh_only`、`wait_event_wait_price_only`，并显式写 `current_new_money_pct=0` 时没有买入、目标价、入场价或仓位动作。证据文件补最终结果后必须重跑目录级 Vault sync 和 quality gate。

---

## 黄金法则：行业配置的期望值决策

```
行业配置决策 = 行业期望回报 > 全市场平均 ? 超配 : (行业期望回报 < -5% ? 低配 : 中性)
行业期望回报 = 景气度概率 × 景气期回报 + 中性概率 × 基准回报 + 衰退概率 × 衰退期回报
```

你的工作不是"找到最好的行业"——是**搞清楚市场对这个行业定价了什么，你的增量信息在哪**。

**公告披露不是自动利好**。任何“等公告/等政策/等财报/等订单/等客户验证”的表述，都必须先过 `event-expectation-delta-guard`：事件发生只说明 `event_occurred=true`，不说明行业 thesis 被验证；按计划推进通常是 `IN_LINE`，只触发复核，不触发超配或低配调整。

### 🛑 数据铁律：缺数据→先采集入库→再调用（禁止绕过本地 DB）

**研究过程中发现任何数据缺失，唯一正确做法：调 `/collect-data` skill 采集入库 → DB 验证 → 读 DB 使用。**

- **禁止**绕过 DB 直接调 API / Web 搜索替代结构化数据
- **为什么**：入库 = 知识复利，这次采了下个行业直接可用。每次研究都在铺路
- **公开信息快信号不是绕过 DB**：Fresh Public Signal Sweep 是补足研报/DB 滞后的快变量证据层；凡属于结构化数据（成分股、财务、估值、资金面、研报正文）仍必须入库或走项目封装层。

### 🛑 研究范围铁律：标的清单必须 A股 + 港股双覆盖（2026-06-01 新增）

**产业链映射和标的清单必须同时覆盖 A股和港股**（若该行业有港股标的）。禁止只在 A股票池选股、把港股标的只当"估值锚/背景板"一笔带过。

- **禁止**：聚焦 A股，漏掉港股最直接标的（AI PC 翻车：把港股最直接标的联想 00992 只当估值锚用没列标的，用户当场抓"港股都没有吗"）
- **必须**：每个港股标的给明确定性（买入/观察/回避 + 触发价），与 A股标的同等对待
- **港股数据**：研报走 `hk_report_collector`（AAStocks+yfinance+腾讯），财务走 yfinance（hk_daily_price 表常空），研报在 ResearchReportStore（港股龙头 GS/JPM/MS 全覆盖）。检索港股标的英文名+代码都要搜（如 Lenovo/0992/联想）
- **为什么**：漏港股不仅范围残缺，还连带漏港股标的最新研报（AI PC 漏联想致引用过时 GS TP）。港股龙头常是行业里 AI alpha 捕获最强、最直接的表达
- **红旗自检**：declaring done 前问"这个行业的港股标的我查了吗？有没把港股最直接标的只当背景板？"
- 关联记忆：`feedback_research_scope_a_plus_hk`

---

## 研究深度分级

| 等级 | 适用场景 | 时间 | 产出 |
|------|---------|------|------|
| **L1 快速扫描** | 行业初筛、轮动信号触发验证 | 30-60 min | 一页 checklist，不做五文件 |
| **L2 标准研究** | 准备超配/低配某行业 | 2-4 h | 五文件结构化输出 + 三地沉淀 |
| **L3 深度配置** | 行业配置权重大幅偏离基准(>10%) | 1-3 天 | L2 全部 + 全球产业链深度 + 国际跨市场对标 |

**L1 快速扫描模板**：
```
□ 行业处于周期什么位置？（底部/上升/顶部/下降——用产能利用率/库存水位/CAPEX判断，不是感觉）
□ 盈利修正扩散指数方向？（正=分析师在集体上调，负=集体下调）
□ NHNL 情绪在哪个象限？（贪婪=趋势强但风险高，恐惧=可能底部但别急着抄）
□ 市场对这个行业的共识是什么？我初步觉得共识错在哪？
□ 有没有硬伤可以直接排除？（政策打压/技术替代/需求萎缩/产能过剩>30%）
```

---

## 六步闭环

```
Step 0-1: Check-First → Fresh Public Signal Sweep → 数据采集（collect-data + Zsxq + 量化信号）
Step 2-4: 5 Agent并行 → Debate+Leader辩论裁决 → 行业预期差+期望值框架
Step 5:   五文件输出 → Vault同步硬验证 → watchlist关注池upsert → Quality Gate
```

### 行业 L3 closeout 顺序闸

行业 L3 不能只写五文件后口头说完成。定稿前必须把研究状态推入主题闭环，并用当前文件重跑 Vault 和 gate：

```bash
python scripts/research_subject_upsert.py --entry-file "auto_research/knowledge/industry_research/{行业名}/subject_entry.json" --json
python scripts/theme_triggers_upsert.py --entry-file "auto_research/knowledge/industry_research/{行业名}/theme_triggers_entry.json" --json
python scripts/watchlist_upsert.py --entry-file "auto_research/knowledge/industry_research/{行业名}/watchlist_entry.json"
python scripts/generate_bridge.py
python scripts/build_research_loop_board.py --scope subject --subject-id <subject_id> --json
python scripts/sync_research_dir_to_vault.py industry "auto_research/knowledge/industry_research/{行业名}" --json
python auto_research/quality_gate_check.py "auto_research/knowledge/industry_research/{行业名}"
```

`sync_stock_research_to_vault.py` 和 `sync_concept_research_to_vault.py` 不是行业目录入口；行业目录用 `sync_research_dir_to_vault.py industry ...`。如果 closeout 后又改了 public signal、agent evidence、workflow evidence、subject/watchlist payload、bridge 或五文件，旧 Vault manifest 和旧 quality gate 作废，必须按当前文件重跑。

### manual_theme_review 轻量闭环闸

当海外日报或 discovery loop 产出 `pending_theme_review/manual_theme_review` 时，先判断它是完整行业 L3、轻量 L1/L2 主题刷新，还是只进观察。轻量闭环也必须落到机器状态：

```bash
jq '.items[] | select(.title=="<主题标题>")' auto_research/knowledge/daily_summaries/YYYY-MM-DD_discovery_loop.json
python scripts/research_subject_upsert.py --entry-file auto_research/knowledge/industry_research/{行业名}/subject_entry.json --json
python scripts/theme_triggers_upsert.py --entry-file auto_research/knowledge/industry_research/{行业名}/theme_triggers_entry.json --json
python scripts/watchlist_upsert.py --entry-file auto_research/knowledge/industry_research/{行业名}/watchlist_entry.json
python scripts/generate_bridge.py
PYTHONPATH=. python scripts/build_l3_candidate_queue.py --top 50
python scripts/build_research_loop_board.py --scope subject --subject-id <subject_id> --json
python scripts/sync_research_dir_to_vault.py industry auto_research/knowledge/industry_research/{行业名} --json
python auto_research/quality_gate_check.py auto_research/knowledge/industry_research/{行业名}
```

schema 自检不要猜字段：

- `subject_entry.json`: `candidate_stocks[]`, `triggers[]`
- `watchlist_entry.json`: `stocks[]`
- `theme_triggers_entry.json`: `triggers[].trigger_id`
- `research_subjects.json` / `watchlist.json` / `portfolio_research_bridge.md`: subject-loop 主账
- `.factor_cache/tracking/l3_candidate_queue.json`: 全局派生排序，不是单主题完成证据

`_workflow_evidence_YYYYMMDD.json` 必须给机器分桶：哪些进入或刷新 L3，哪些只是 L2 后候选，哪些是相邻/下游单独 L2，哪些只能 `WAIT_EVENT`/`WAIT_PRICE`。主题闭环不得直接生成买卖、目标价、入场价或仓位动作。

---

## Step 0-1: Check-First → 数据采集

> 详细步骤: 加载 `@steps/01-check-and-collect.skill.md`
> 
> 核心动作: mem-search → 项目目录检查 → Fresh Public Signal Sweep → 量化信号缓存 → Zsxq多关键词轮询 → collect-data统一采集 → 东财行业研报 → 静默失败防护(运行时断言)
> 
> 关键规则: 禁止中文搜Zsxq标题(全英文); 禁止单次搜索后停止(最少3组关键词); 新闻/政策/供应链驱动研究必须有公开信息证据矩阵; 数据写入后必须输出非空率

---

## Step 2-4: Multi-Agent 深度分析 → 辩论 → 期望值

> 详细步骤: 加载 `@steps/02-deep-analysis.skill.md`
> 
> 核心动作: 5 Agent并行(macro/chain/competition/valuation/catalyst-risk; 全部读取公开信息证据矩阵) → Debate+Leader辩论裁决 → 行业预期差挖掘 → 三情景期望值框架
> 
> 关键规则: L1跳过此步骤; Bull/Bear同等篇幅+同等证据标准; 概率用高/中/低定性; 期望回报<全市场平均→中性或低配

---

## Step 5: 五文件输出 + Zsxq + Quality Gate

> 详细步骤: 加载 `@steps/03-output.skill.md`
> 
> 核心动作: 五文件落盘 + `_public_signal_matrix_YYYYMMDD.{md,json}` → Vault同步逐文件验证(5/5 ✅=PASS) → Zsxq 3组关键词轮询 → watchlist关注池upsert(bridge第五区,helper幂等) → Quality Gate(≥70分)
> 
> 关键规则: vault_write返回False必须手动处理; 五文件缺一不可; Zsxq L2+至少3篇国际投行引用; S2/S3未验证信息不得承重

---

## Anti-Patterns — 20 条禁止行为

### 数据采集
1. **禁止中文关键词搜 Zsxq 标题** — 国际投行研报标题全英文，必须用英文关键词
2. **禁止单次搜索后停止** — 必须 3 组关键词轮询
3. **禁止跳过东财行业研报** — 国内券商行业研报是政策方向+竞争格局的主要来源
4. **禁止声称"已覆盖"而未逐行检查** — 没有逐行报告命中数之前不能下结论
5. **禁止将行业报告混同为个股报告** — 研报引用必须区分行业级 vs 公司级覆盖
6. **禁止抽选/跳读研报正文** — 检索到的每一篇研报必须完整阅读全文，禁止以"量太大"为由抽选。量太大用 Agent 分批并行读取，每篇必须提取评级/目标价/核心论点/关键假设/风险/分歧点。研报价值在正文细节，标题和摘要承载不了
7. **禁止事件/政策/供应链驱动行业研究缺公开信息矩阵** — 缺 `_public_signal_matrix_YYYYMMDD.{md,json}` 不能下配置结论；S2/S3 未验证信息不能直接改行业配置建议、建议权重、核心标的名单或 trigger
8. **禁止把公告披露当自动利好** — 行业公告、政策、价格、客户、产能或财报披露必须先做 `BEAT/IN_LINE/MISS/AMBIGUOUS` 预期差分类；`IN_LINE` 不得承载超配、核心标的升级或 trigger confirmation

### 量化信号
6. **禁止跳过盈利修正信号** — `industry_earnings_revision.py` 是行业景气度的客观量化指标
7. **禁止跳过 NHNL 信号** — NHNL 象限是技术面择时的核心参考
8. **禁止在未验证数据分布前使用评级扩散** — A股几乎全是买入，用 EPS 增速+覆盖广度+评级信心替代
9. **禁止假设 forecast_year 是数值** — 外部数据入口统一 `pd.to_numeric()`

### 方法论
10. **禁止不做多空辩论就定结论** — Debate+Leader 是核心步骤，L2+ 必执行
11. **禁止定性概率精确化** — 概率用高/中/低 + 判断依据
12. **禁止期望回报不满足门槛时强行推荐** — 低于全市场平均→中性或低配
20. **禁止单一 PE 列横向排序周期/未盈利/平台型行业** — 行业横向估值对比必须用该行业的适配方法（银行→P/B-ROE分位、保险→P/EV、地产→NAV折价/PB、强周期→PB-band周期位置+mid-cycle、未盈利→PS/管线价值、平台/集团成分股→SOTP，其余→PE/PEG）。单一 TTM PE 列在周期顶会系统性误判"最便宜实际最贵"（沪电 PB 99.9% 分位案例），未盈利赛道无 E 排名是噪音，平台型整体 PE 掩盖异质分部。行业表必须带 PB 分位列或 mid-cycle 交叉列。逐标的调 `route_valuation(ts_code)` 定方法。详见 Step 4「行业→适配方法」+ valuation-agent 陷阱2/4 + SSoT `docs/harness/valuation-method-routing-research-20260607.md`（与 stock-research v2.33.0 §5.8 同源同步）

### 研究范围
19. **禁止标的清单只覆盖 A股漏港股** — 产业链映射和标的清单必须 A股+港股双覆盖（若有港股标的）。禁止把港股最直接标的只当估值锚/背景板（AI PC 翻车：漏联想 00992）。港股标的给明确定性（买入/观察/回避+触发价）。见黄金法则区「研究范围铁律」+ memory `feedback_research_scope_a_plus_hk`

### 输出质量
13. **禁止只输出聊天不落盘** — 五文件 + Vault 同步缺一不可
14. **禁止五文件缺失任一文件**
15. **禁止跳过 Vault 同步返回值检查** — vault_write=False 必须手动处理

### 静默失败防护
16. **禁止新模块关键路径无运行时断言** — 数据写入点必须输出非空率
17. **禁止新方法论落地前不查数据分布** — 一行 SQL 验证核心假设
18. **禁止 API 列名映射变更不告警** — 运行时检测非空率

---

## Related Skills

| Skill | 关系 | 说明 |
|-------|------|------|
| `collect-data` | **数据源** | 所有 DB+API 数据采集统一入口（DB-First → 幂等入库），禁止绕过 |
| `stock-research` | **互补** | Bottom-up 个股研究，行业缩小选股范围 → 个股验证具体标的 |
| `portfolio-rebalance` | **下游** | 行业配置结论 → 组合再平衡的仓位分配输入 |
| `a-stock-data` | **API 层** | 7 层 28 端点，由 collect-data 调度，不直接调用 |
