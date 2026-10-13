---
name: industry-research-step-01-check-and-collect
description: |
  industry-research Step 0+1：资产检查 + 数据采集。加载 Zsxq 研报检索、
  Fresh Public Signal Sweep、量化信号集成、collect-data 统一入口。
metadata:
  version: 1.4.2
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# Step 0-1: Check-First + 数据采集

## Step 0: Check-First — 永远先检查现有资产

**🛑 硬性执行检查表（禁止静默跳过，必须逐项填写命中数）**：

```
┌──────────────────────────────────────────────────────────────┐
│ Step 0 资产检查表（Conductor 逐项填写）                         │
├──────────────────────────────────────────────────────────────┤
│ □ mem-search: ____ 条相关记忆                                  │
│ □ 项目目录: □ 存在(____ 文件) / □ 不存在→创建                  │
│ □ 量化信号: earnings_zscore=____ nhnl_quadrant=____           │
│ □ 公开信息快信号: ____ 条，S0/S1 ____ 条，待验证 ____ 条        │
│ □ 多关键词轮询: ____ 组 → 去重 ____ 篇国际投行                  │
│ □ 五大行覆盖: GS__ MS__ UBS__ JPM__ Nomura__                  │
│ □ 研究深度判定: L1/L2/L3 → 理由: ____                          │
└──────────────────────────────────────────────────────────────┘
```

```
□ mem-search 搜索: "{行业名} 行业研究"
□ 检查项目目录: auto_research/knowledge/industry_research/{行业名}/
□ 检查 ResearchReportStore FTS5: store.fts_search("{行业英文关键词}", source="zsxq", with_content=True) 🛑with_content必传否则只返元数据不含正文
□ 多关键词轮询: 行业名变体/产业链关键词/龙头公司名/China xxx 系列
□ 检查量化信号缓存: industry_earnings_revision + industry_nhnl_signal
□ Fresh Public Signal Sweep: 政策/公告/海关价格/客户供应商/产业媒体/技术路线
□ 检查五大行覆盖: store.fts_search(..., org_name="Goldman Sachs") 等逐个查
□ 确定研究深度: L1/L2/L3
```

---

## Step 1: 数据采集 — collect-data 统一入口 + 研究特有补充

**🛑 硬性执行检查表（必须逐项填写命中数）**：

```
┌──────────────────────────────────────────────────────────────┐
│ Step 1 数据采集检查表                                          │
├──────────────────────────────────────────────────────────────┤
│ □ collect-data 调用: □ 已触发 / □ 跳过(理由: ____)              │
│ □ public_signal_matrix: □ 已写 / □ 不适用(理由: ____)           │
│ □ 行业成分股财务: 覆盖 ____ 只 / ____ 行业                      │
│ □ 东财行业研报: ____ 篇入库                                     │
│ □ Zsxq多关键词轮询: ____ 组 → 去重 ____ 篇                      │
│ □ 五大行覆盖: GS__ MS__ UBS__ JPM__ Nomura__                  │
│ □ 量化信号: earnings_z=____ nhnl=____ sector_rotation=____     │
│ □ 数据缺失标注: ____ 项                                         │
└──────────────────────────────────────────────────────────────┘
```

### 第一层：collect-data 统一采集（DB+API 层，必须先走）

所有 DB 和 API 数据必须通过 `collect-data` skill 完成（DB-First → 幂等入库）：
- 行业成分股财务数据（Tushare → collect-data → DB → `get_financials_summary()`）
- 东财行业研报（reportapi → collect-data → `research_report` 表）
- 行业估值数据（Tushare `daily_basic` → collect-data → `industry_valuation.py`）
- 行业资金面数据（a-stock-data → collect-data → `industry_capital_flow.py`）
- 国际宏观数据（AkShare/yfinance/FRED → collect-data → `macro_intl_daily` / `fred_macro`）

### 第二层：研究特有数据（collect-data 覆盖不到的部分）

```
通道 1 (国内): industry_report_collector.py --industry "{行业}"
通道 2 (国际): Zsxq DB → ResearchReportStore.list_by_source("zsxq") → 行业关键词过滤
通道 3 (量化): IndustryEarningsRevision().compute_zscore() + IndustryNHNLSignal().compute_nhnl()
```

### 小金属/小材料东财补数兜底（行业过滤 0 条时必须执行）

小金属、关键材料、半导体材料、设备零部件等窄主题经常不在东财 `industry` 参数里形成独立分类。`industry_report_collector.py --industry "{行业}"` 返回 0 条，只能说明行业标签不匹配，不能写“无国内研报”。

兜底流程：

1. 先保留失败证据：记录命令、日期区间、`total/new/content_extracted=0`。
2. 改跑全行业 checkpoint：按日期区间拉取东财全行业/全研报索引到本地 checkpoint，不直接拿网页结果写结论。
3. 用 3 组以上关键词过滤 checkpoint：行业中文名、化学/英文名、上下游产品、关键公司、替代词和缩写都要覆盖，例如 `铟/indium/磷化铟/InP/靶材/高纯金属/中金岭南/云南锗业`。
4. 对命中的报告逐篇定向拉正文：调用现有 `research_report_collector` 正文抓取能力，并用 `ResearchReportStore.save(...)` 写入 RRS。
5. 写回检查表：分别报告 `industry_filter_count`、`all_industry_checkpoint_count`、`keyword_hit_count`、`content_saved_count`、`short_or_title_only_count`。
6. 分层引用：公司直报、行业直报、下游 cross-read、标题-only/摘要/乱码正文必须分开；标题-only 只能作 `keyword_lead`，不能承载估值、盈利弹性或配置结论。

如果全行业 checkpoint 和定向正文抓取都为 0，才能写 `eastmoney_no_direct_report_after_checkpoint_backfill`，并说明关键词组和日期范围。

### 窄主题逐票东财正文兜底（行业 API 0 条后的优先路径）

如果行业过滤或全行业 checkpoint 不能稳定命中，但该主题已有明确 A 股候选池，优先逐票拉东财正文并做双库对账。这样得到的是可复用的本地报告正文，而不是一次性网页搜索结论。

1. 先写清行业接口失败证据：命令、参数、日期、`industry_filter_count=0` 或接口字段不匹配原因。
2. 从产业链和候选股表选出直接相关 A 股代码，不少于上中下游/龙头/替代路径代表；每只股票运行：
   ```bash
   PYTHONPATH={{QUANT_ROOT}} python data_platform/research_report_collector.py --code <code> --text --save
   python scripts/sync_rrs_eastmoney_to_research_report.py --code <code> --name <name> --dry-run
   python scripts/sync_rrs_eastmoney_to_research_report.py --code <code> --name <name>
   python scripts/sync_rrs_eastmoney_to_research_report.py --code <code> --name <name> --dry-run
   ```
3. 完成条件是二次 dry-run 对关键代码证明 `missing_in_research_report=0` 且 `short_content_to_refresh=0`，或把剩余缺口逐项降级成 `short_body_not_load_bearing` / `title_only_lead`。
4. 研报索引必须区分：行业直报、公司直报、全球 peer cross-read、应用场景 cross-read、标题-only/noise。不能把“命中 200 篇”直接写成承重证据。
5. 对外结论只能引用已经进入 RRS/`research_report` 且正文可读的材料；网页搜索和标题命中只能作 `keyword_lead`。

### 第三层：Fresh Public Signal Sweep（快变量，不替代 DB）

行业/赛道研究最容易被研报滞后误导。L2/L3 如果由新闻、政策、出口管制、供应链、客户动作、材料替代、技术路线切换或价格异动驱动，必须先生成 `_public_signal_matrix_YYYYMMDD.{md,json}`。

最低搜索组：

| 搜索组 | 例子 | 目的 |
|------|------|------|
| 官方/监管 | 政策原文、出口管制、交易所问询、行业主管部门 | 确认可承重事实 |
| 公司/产业链 | 龙头公告、IR、客户/供应商公开说法、协会数据 | 确认传导链条 |
| 市场数据 | 海关、价格、产能、招标、库存、订单 | 确认供需或价格方向 |
| 技术/产品 | 工艺路线、替代材料、认证进度、专利/会议 | 确认路线切换是否真实 |
| 媒体/社交 | Reuters/Bloomberg/Nikkei/WSJ/FT/财新/证券时报/雪球/X | 只做 leads，等验证 |

来源分级：

| Tier | 可用性 |
|------|--------|
| `S0_OFFICIAL` | 可支撑政策/约束/触发器事实 |
| `S1_PRIMARY_MARKET` | 可支撑产业链传导、价格、订单、客户认证等证据 |
| `S2_CREDIBLE_MEDIA` | 可作事件线索或情景权重，需 S0/S1 或独立二源交叉后才能承重 |
| `S3_SOCIAL_RUMOR` | 只能写 `lead_only`，不得进入配置建议、建议权重、核心标的名单或 confirmed trigger |

矩阵字段至少包括：

```json
{
  "signal_id": "IPS-001",
  "date": "YYYY-MM-DD",
  "source_tier": "S0_OFFICIAL | S1_PRIMARY_MARKET | S2_CREDIBLE_MEDIA | S3_SOCIAL_RUMOR",
  "source_name": "...",
  "claim": "...",
  "affected_industry_leg": "demand | supply | price | policy | substitution | capacity | customer | valuation | risk",
  "verification_status": "verified | cross_checked | unverified | contradicted | stale",
  "pre_event_expectation": "",
  "priced_in_view": "",
  "actual_disclosure": "",
  "delta_class": "BEAT | IN_LINE | MISS | AMBIGUOUS | not_applicable",
  "action_boundary": "continue_watch | refresh | downgrade | config_review | no_action",
  "decision_use": "fact | scenario_weight | trigger_input | watch_item | lead_only | rejected",
  "downgrade_reason": ""
}
```

硬闸：
- 缺矩阵时，事件/政策/供应链驱动 L2/L3 只能写 `pending_public_signal_sweep`。
- S2/S3 未验证信息不得直接改变行业配置建议、建议权重、核心标的名单、建仓触发器或 review cadence。
- 公告/政策/财报/客户/产能/价格事件缺 `delta_class` 时只能写 `pending_event_expectation_delta`；`IN_LINE` 不能承载超配或核心标的升级。
- 与研报/DB 矛盾时，必须写成 `contradicted` 或 `stale_report_to_verify`，不能把矛盾磨平。

### 🛑 研报全量阅读铁律（通道 1+2 都必须全量阅读）

**检索到的每一篇研报（无论国内/国际），都必须完整阅读正文。禁止抽选、禁止只看标题/摘要、禁止只读开头几段。**

- 搜到 N 篇就读 N 篇全文。量太大（30+）用 Agent 分批并行读取，每批 ≤15 篇，确保全覆盖
- 每篇必须提取：评级/目标价/核心论点/关键假设/风险/与其他机构的分歧点
- 东财行业研报同理——`industry_report_collector.py` 拉取的全部正文必须完整阅读
- 禁止的错误做法："行业研报太多了，抽 5 篇代表性强的读"——不同机构对同一行业的判断可能完全不同，抽选会遗漏关键观点

---

## 量化信号集成

研究过程中必须参考以下信号（已在 common/ 中实现）:

| 信号 | 模块 | 用法 |
|------|------|------|
| 盈利修正扩散 | `industry_earnings_revision.py` | diffusion_index > 0.1 = 分析师集体看多 |
| NHNL 情绪 | `industry_nhnl_signal.py` | quadrant: 贪婪/乐观/中性/悲观/恐惧 |
| 行业估值 | `industry_valuation.py` | PE/PB 分位数 + 周期股PB替代 |
| 行业轮动 | `sector_rotation.py` | 10D综合评分 |

### ⚠️ 静默失败防护（关键路径运行时断言）

每个数据写入点必须输出有效数据占比。API 调用后检查返回值非空率：

```python
# 示例：盈利修正信号获取后
zscore = earnings.compute_zscore()
valid = sum(1 for v in zscore.values() if v is not None)
logger.info(f"盈利修正有效数据: {valid}/{len(zscore)} 行业")
if valid < 10:
    print("⚠️ 盈利修正数据不足，该信号不可用于决策")
```
