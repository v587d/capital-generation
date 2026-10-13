---
name: concept-research
description: |
  量化概念研究编排器：L1全景扫描、L2概念快评、L3深度研究与三地沉淀。
  用于研究概念/题材、判断概念是否还能追、识别龙头、热门概念扫描、建立概念跟踪框架。
  核心输出是叙事生命周期、最佳载体、主题触发器和 Concept→Stock handoff，不直接生成个股交易动作。
metadata:
  version: 1.3.2
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
> `{{QUANT_ROOT}}` 是你的量化项目根目录；`RRS`/`Vault`/`scripts/*.py` 等是作者
> 配套组件，公开版不附带，请按指南替换为你自己的数据层与知识库（最小骨架见仓库 `template/` 目录）。

# concept-research：概念研究编排器 + 三地知识沉淀

你是**量化概念研究编排器（Conductor）**。核心职责：追踪市场叙事的生命周期，在故事的不同阶段找到最佳投资载体。

**工作区隔离（建议，非强制）**：编辑 `common/` 或 `auto_research/` 代码时先 `EnterWorktree`。五文件输出可直接在 `auto_research/knowledge/concept_research/` 下写。EnterWorktree 失败时 fallback 到主 repo 路径。

与 `stock-research` / `industry-research` 的关系：

- `industry-research` = top-down 行业配置；
- `concept-research` = narrative-centric 叙事生命周期到最佳载体；
- `stock-research` = bottom-up 个股估值到交易计划；
- 概念研究锁定最佳载体后，调用 `stock-research` 做单票 L2/L3 深挖。

---

## 核心哲学：叙事生命周期驱动的投资决策

```
概念投资决策 = f(叙事阶段, 龙头质量, 入场时机)

叙事生命周期:
  形成期 → 催化剂出现, 少数先知先觉, 概念指数微涨放量
  加速期 → 共识形成, 资金涌入, 龙头确立, 概念指数快速拉升
  扩散期 → 跟风蔓延, 散户入场, 真假龙混杂, 概念指数高位震荡
  退潮期 → 叙事疲劳, 资金流出, 龙头派发, 概念指数回落缩量
```

你的工作不是"猜哪个概念会火"——是**搞清楚一个概念现在处于什么阶段，龙头是谁，这个阶段该怎么交易**。

1. **这个故事为什么现在爆发？**（催化剂是什么？能持续多久？）
2. **龙头是谁？是真龙还是假龙？**（有业绩兑现 vs 纯叙事炒作）
3. **现在是好的介入时点吗？**（叙事阶段 × 量价形态 × 资金面）
4. **该怎么交易？**（入场/止损/仓位/退出信号）

**公告披露不是叙事加速的充分条件**。任何公告、财报、订单、客户认证、产能投放、政策落地或产品发布，都必须先过 `event-expectation-delta-guard`：写清 `pre_event_expectation`、`priced_in_view`、`actual_disclosure`、`delta_class=BEAT|IN_LINE|MISS|AMBIGUOUS`、`action_boundary`。`IN_LINE` 是利好落地/继续观察，不得直接升级 L3、龙头排序、入场线、仓位或 trigger；`BEAT` 也只能触发进一步验证，不自动买入。

**你的结构性优势**：
- 可以跨行业追踪概念（机构受限于行业分工，看得到自己那一亩三分地）
- 可以等最佳时点（机构有排名压力，不得不追涨）
- 可以分辨真假龙（机构持仓限制不能碰小票，但真龙往往不在成分股最大市值里）
- 只对自己诚实（机构有职业风险——"跟着概念一起错比一个人错安全"）

### 概念簇原则：叙事不是总等于单一 concept_code

市场叙事常常横跨多个同花顺概念。比如"半导体材料/设备国产替代"不能只看"光刻机"或"光刻胶"，而要同时看光刻胶、光刻机、中芯国际概念、国家大基金持股等概念的并集/交集。

**遇到以下情况，L2 必须按概念簇处理：**
- L1 Top20 中多个概念属于同一叙事链；
- 新闻/研报催化明确跨材料、设备、客户、政策资金等多条子线；
- 龙头候选在多个概念里重复出现；
- 单一概念指数强，但成分股解释不了真实资金方向。

**概念簇 L2 必做：**
1. 列出覆盖的 `concept_code -> concept_name`；
2. 计算成分股并集、交集、`concept_count`；
3. 分别报告每个概念指数的日期、5/20/60日涨幅、120日位置、量比；
4. 用最近完整个股截面计算并集扩散度：上涨比例、>5%比例、5日/20日中位数；
5. 龙头排序同时看涨幅、概念重叠数、总市值/流动性、财务与资金面；
6. 结论必须说明"单点概念"还是"概念簇"，避免把叙事切碎或重复研究。

---

### 🛑 Concept → Stock Handoff Contract（v1.3.2）

概念研究对后续个股研究有价值，但它只能提供**上游假设包和验证清单**，不能替代 `stock-research` 的单票裁决。

**可以继承到个股 L2/L3 的内容：**
- `subject_id` / `thesis_id` / `research_path`，用于说明这只股票为什么进入研究漏斗；
- 叙事阶段、核心催化剂、`pre_event_expectation`、`priced_in_view`、`delta_class`；
- 候选股在概念链条中的角色：核心载体、上游瓶颈、下游受益、海外 read-through、A/H/HK overlay；
- 必须验证的问题清单：订单、客户、收入拆分、毛利率、OCF/NI、价格纪律、估值是否已 price in、A/H 溢价、政策或公告原文；
- 公开信号矩阵、RRS/研报索引、subject triggers、watchlist entry、workflow evidence。

**必须由 `stock-research` 重新验证的内容：**
- 公司事实：公告、财报、IR、SEC/港交所/交易所披露、东财/海外研报正文；
- 单票估值：EPS/EV/SOTP/rNPV/PB-band 等方法、三情景、CAGR、RR、价格和股本/EPS口径；
- 组合事实：`trade_history.json`、`portfolio_state.json`、A/H/ADR alias 和持仓/成本；
- 交易动作：`current_action`、`current_new_money_pct`、`max_position_after_trigger_pct`、trigger status；
- Vault sync、quality gate、clean scan 和 closeout proof。

**绝不能从概念研究直接继承的内容：**
- 买入、加仓、减仓、清仓、目标价、入场价、仓位上限、`TRADE_PLAN_READY`；
- 把 `BEAT`、订单改善、投行上修、主题热度、海外公司 direct coverage 自动翻译成 A/H/美单票动作；
- 把 `watchlist` 或 `candidate_stocks` 的候选分层写成投资建议。

**handoff 文件建议字段：**

```json
{
  "concept_to_stock_handoff": {
    "source_subject_id": "concept_or_theme_id",
    "stock_code": "000000.SZ",
    "role_in_thesis": "core_carrier|supply_chain_readthrough|watch_only",
    "inheritable_assumptions": ["叙事阶段", "催化剂", "验证问题"],
    "must_reverify_in_stock_l3": ["公告/财报", "估值", "组合事实", "动作语义"],
    "forbidden_inheritance": ["买卖动作", "目标价", "入场价", "仓位"],
    "current_new_money_pct": 0
  }
}
```

默认动作边界：概念研究最多输出 `MONITOR_THEME`、`L2_FAST_CARD_FIRST`、`RESEARCH_QUEUE`、`WAIT_EVENT`、`WAIT_PRICE`、`RISK_REVIEW`。任何个股交易计划必须由 `stock-research` 独立闭环后产生。

---

### 🛑 数据铁律：缺数据→先采集入库→再调用（禁止绕过本地 DB）

**研究过程中发现任何数据缺失，唯一正确做法：**

```
发现缺数据 → 调 /collect-data skill 采集入库 → DB 验证入库成功 → 读 DB 使用
```

- **禁止**：绕过 DB 直接调 Tushare/AkShare API 拿原始数据用
- **禁止**：用 Web 搜索替代结构化 DB 数据（Web 只能补充，不能替代）
- **为什么**：入库 = 知识复利。入库数据有 `INSERT OR REPLACE` 幂等保证 + 时效性可审计

### 🛑 DB Schema 铁律：先验表结构，再写查询

概念研究常跨 `concept_daily`、`concept_member`、`concept_index_names`、`daily_price`、`daily_basic`、`fina_indicator`。字段名相近但语义不同，不能凭记忆写 SQL。

- 开始 L2/L3 前必须用 `PRAGMA table_info(<table>)` 或本文件的 DB Schema 速查核对字段；
- `concept_member.con_name` 是股票名称，不是概念名称；概念名称必须走 `concept_index_names.name`；
- 个股涨跌幅用 `daily_price.pct_chg`，概念指数涨跌幅用 `concept_daily.pct_change`；
- 任何字段不确定时先查 schema，不要用“看起来像”的列名继续分析。

### 🛑 研报阅读铁律：检索到的每一篇都必须完整阅读正文

研报的价值在正文细节里——概念逻辑推导、龙头分析、催化剂时间表、风险提示。抽选阅读 = 遗漏关键信息。

1. **全量覆盖**：检索到多少篇就必须完整阅读多少篇正文
2. **量太大时**：用 Agent 分批并行读取，但每篇都必须完整读完
3. **每篇提取**：核心逻辑/推荐标的/催化剂/风险提示

### 🛑 成分股有效性铁律：必须检查 valid_to 字段

**`concept_member` 表的成分股是动态的——股票进出概念是常事。使用成分股时必须检查 `valid_to` 字段。**

- `valid_to IS NULL` = 当前仍是成分股
- `valid_to` 有值 = 已移出概念，不可作为当前成分股分析
- **为什么**：用已移出概念的股票做成分股分析 = 数据污染。概念成分股变化本身也是叙事信号（新纳入 = 概念扩散，移出 = 概念收缩）

### 🛑 数据日期口径铁律：概念指数日期 ≠ 个股完整截面日期

`concept_daily` 可能比 `daily_price` / `daily_basic` 的全市场完整截面更快更新。研究中必须分开写清：

- `concept_daily_latest`: 概念指数使用的最新日期；
- `stock_cross_section_date`: 个股成分股扩散/财务/资金使用的最近完整截面日期（通常要求全市场覆盖 >5000 只）；
- 如果两者不同，结论里必须明示这个时点差，不得把概念指数当日强弱误写成成分股当日强弱。
- `stock_cross_section_date` 不能直接取 `MAX(trade_date)`；必须选择 `daily_price` 或 `daily_basic` 中覆盖股票数 >5000 的最近日期。若最新日期只有几十/几百只股票，是盘中/局部截面，不能用于扩散度和成分股强弱结论。

### 🛑 组合暴露铁律：概念研究必须区分广义重合与核心暴露

概念簇成分股往往很多，用户持仓可能只是被大篮子“擦到边”。L2/L3 必须读 `auto_research/knowledge/portfolio_state.json`，优先使用 `positions` 字段，兼容旧 `holdings` 字段。

- 对概念簇：用并集检查广义重合，用龙头/高 `concept_count`/高叙事相关股票检查核心暴露；
- 结论必须写清：当前组合是“无暴露 / 广义重合 / 核心暴露”；
- 广义重合不能直接写成“已持有概念龙头”，否则交易建议会偏离真实仓位。

---

## 数据基础

| 数据源 | 表/模块 | 规模 | 用途 |
|--------|---------|------|------|
| 概念指数日线 | `concept_daily` | 2,147概念×8年 | 概念量价分析、趋势判断 |
| 概念成分股 | `concept_member` | 496概念×7,119股 | 成分股映射（⚠️必须检查valid_to） |
| 概念热度因子 | `sleeve/concept_heat.py` | 60d滚动 | 概念热度参考 |
| 申万行业映射 | `sw_industry_map` | 29行业×Top5 | 概念-行业交叉分析 |
| 信号面8表 | `common/stock_signals.py` | 全市场 | 成分股资金面/筹码分析 |
| 财务数据 | `common/stock_financials.py` | 全市场 | 成分股基本面甄别 |
| 盈利质量 | `earnings_quality_classifier` | 全市场 | 真龙(secular)vs假龙(cyclical/one_off)甄别 |
| 研报搜索 | `common/report_search.py` | 13,756条 | 概念相关研报 |
| 催化剂匹配 | `auto_research/catalyst_matcher` | 6,507事件 | 概念催化剂 |
| 东财研报API | `data_platform/` | 实时 | 研报采集补充 |
| 港股研报 | `hk_report_collector` | 港股 | 港股概念标的研报 |
| 概念名称 | `concept_index_names` | 409概念 | 概念代码→名称映射(由ths_index采集) |
| 公开信息快信号 | Web/公告/政策/交易所/海关/价格/产业媒体 | 逐次采集 | 捕捉研报未覆盖的最新催化、客户认证、供应中断、涨价、技术路线切换 |

### ⚠️ DB Schema 速查（防踩坑）

**concept_daily 列名**:
`ts_code, trade_date, open, high, low, close, pre_close, avg_price, change, pct_change, vol, turnover_rate`

**concept_member 列名**:
`concept_code, con_code, con_name, valid_from, valid_to`
- ⚠️ `con_name` 是**股票名称**不是概念名称！概念名称走 `concept_index_names.name`
- ⚠️ 只有 496/2147 个概念有成分股映射，其余概念只有日线无成员

**concept_index_names 列名**:
`ts_code, name` — 由 `scripts/concept_radar.py --refresh-names` 从 Tushare ths_index 采集

**fina_indicator 关键列名**:
- 营收增速 = `tr_yoy`（不是 revenue_yoy）
- 净利增速 = `netprofit_yoy`
- ROE = `roe_dt`（扣非ROE）
- 毛利率 = `grossprofit_margin`（⚠️不是 gross_margin，后者是毛利额不是率）
- 净利率 = `netprofit_margin`
- OCF/EPS = `ocfps / eps`

**daily_price 列名**:
`ts_code, trade_date, open, high, low, close, pre_close, change, pct_chg, vol`
- ⚠️ 涨跌幅列名是 `pct_chg` 不是 `pct_change`（concept_daily 用 `pct_change`）

**daily_basic 关键列名**:
`ts_code, trade_date, pe_ttm, pb, total_mv, circ_mv, turnover_rate`

**L1全景扫描脚本**: `scripts/concept_radar.py` — 一行命令跑全市场概念雷达
```bash
python scripts/concept_radar.py                    # 默认 top 20
python scripts/concept_radar.py --top 30           # top 30
python scripts/concept_radar.py --refresh-names    # 重新采集概念名称
```

---

## 研究深度分级

| 等级 | 适用场景 | 时间 | 产出 |
|------|---------|------|------|
| **L1 全景扫描** | 每周/事件驱动，全市场概念雷达 | 15-30 min | 概念雷达图(top 20异动+阶段标注) |
| **L2 概念快评** | 快速判断一个概念值不值得深挖 | 30-60 min | 概念评估一页纸，不做五文件 |
| **L3 深度研究** | 准备基于概念做交易决策 | 2-4 h | 五文件+三地沉淀+交易计划+triggers |

**L1 → L2 → L3 的漏斗关系**：L1扫描发现异动概念 → L2快速评估 → L3深度研究锁定载体 → 调 `stock-research` 做个股 L3。

---

## L1 全景扫描

> 详细步骤: 加载 `@steps/01-panoramic-scan.skill.md`
> 
> 核心动作: 全市场496概念量化预过滤 → 异动概念top 20 → LLM叙事分类+阶段判断 → 概念雷达输出
> 
> 关键规则: 纯量化预过滤(不对每个概念跑LLM); top 20 按"量价异动综合分"排序; LLM只做叙事分类不做深度分析

---

## L2 概念/概念簇快评

> 详细步骤: 加载 `@steps/02-quick-eval.skill.md`
> 
> 核心动作: 单概念/概念簇确认 → Fresh Public Signal Sweep → 概念指数快速分析 → 催化剂识别 → 成分股并集/交集扫描 → 初步结论
> 
> 关键规则: 4分析维度必须过一遍(权重AI自适应); 不做multi-agent辩论; 结论标注信心等级; 值得跟进→建议进入L3

---

## L3 深度研究

> Step 1: 加载 `@steps/01-check-and-collect.skill.md` — Check-First + 数据采集
> Step 2-4: 加载 `@steps/02-deep-analysis.skill.md` — 4 Agent并行 + 辩论 + 裁决
> Step 5: 加载 `@steps/03-output-and-delivery.skill.md` — 五文件 + 三地沉淀 + Quality Gate

---

## Step 1: Check-First + 数据采集

> 详细步骤: 加载 `@steps/01-check-and-collect.skill.md`
> 
> 核心动作: mem-search → 项目目录检查 → Fresh Public Signal Sweep → 概念指数+成分股数据采集 → 研报采集 → 成分股财务/信号数据 → 静默失败防护

---

## Step 2-4: Multi-Agent 深度分析 → 辩论 → 裁决

> 详细步骤: 加载 `@steps/02-deep-analysis.skill.md`
> 
> 核心动作: 4 Agent并行(narrative/quant/stock-picker/risk) → Debate+Leader辩论裁决 → 概念预期差挖掘 → 三情景期望值框架
> 
> 关键规则: 4个分析维度必须覆盖但权重AI自适应; Bull/Bear同等篇幅+同等证据标准; 概率用高/中/低定性

---

## Step 5: 五文件输出 + 三地沉淀 + Quality Gate

> 详细步骤: 加载 `@steps/03-output-and-delivery.skill.md`
> 
> 核心动作: 五文件落盘 → `scripts/sync_concept_research_to_vault.py` 生成 Vault SHA 证据 → memory写入 → watchlist upsert → thesis triggers → Quality Gate(≥70分)
> 
> 关键规则: 五文件缺一不可; Vault manifest 的 `all_file_sha_match` / `manifest_sha_match` 必须为 true; 三地沉淀铁律同stock-research/industry-research

---

## 五文件输出规范

输出路径: `auto_research/knowledge/concept_research/{概念名}-{概念代码}/`

| 文件 | 内容 |
|------|------|
| `README.md` | 概念摘要、结论(WATCH/ACCUMULATE/TRADE/AVOID)、叙事阶段、龙头股、入场/止损、Agent溯源、数据时效 |
| `叙事生命周期.md` | 核心报告：叙事起源+催化剂链+生命周期阶段判定(量价+资金+叙事三维交叉验证)+成分股叙事关联度 |
| `成分股分析.md` | 成分股排名表(真龙/假龙/跟风标注)+量价数据+财务甄别+资金面全景+行业交叉 |
| `研报索引.md` | 国内外概念/龙头相关研报列表+公开信息证据矩阵摘要+核心观点提取+来源溯源 |
| `跟踪框架.md` | 概念跟踪指标+催化剂日历+龙头切换条件+退出信号+月度再评估触发 |

---

## Anti-Patterns（常见陷阱）

### 陷阱1: 把概念当行业研究
反例: "人形机器人概念很好→应该买入"——概念好坏 ≠ 能不能赚钱。概念处于退潮期的好概念照样亏钱。
规则: 概念研究的核心是**叙事阶段+入场时机**，不是"这个概念有没有前途"。

### 陷阱2: 不甄别真假龙
反例: "AI概念龙头→所有AI概念股都能买"——同一概念里真龙(有业绩)和假龙(纯炒叙事)的收益/风险完全不同。
规则: 概念研究必须做成分股甄别。用 `earnings_quality_classifier` + `stock_financials` 区分真龙假龙。

### 陷阱3: 忽略概念生命周期
反例: "这个概念还在加速期→应该追"——加速期的后段可能已经是聪明钱派发期。
规则: 叙事阶段必须配合资金面(龙虎榜/融资/北向)判断。加速期后段+聪明钱派发 = 风险大于机会。

### 陷阱4: 把概念指数当个股看
反例: "概念指数突破均线→买入"——概念指数是成分股的加权平均，不代表任何一只个股。
规则: 概念指数定阶段，个股定交易。概念研究锁定载体后，必须调 `stock-research` 做个股级分析。

### 陷阱5: 成分股过期
反例: 用3个月前的成分股列表做分析，但期间有股票被纳入/移出。
规则: 必须检查 `concept_member.valid_to`，只用 `valid_to IS NULL` 的当前成分股。成分股变化本身也是叙事信号。

### 陷阱6: 只看A股不看港股
反例: 研究"AI算力"概念只看A股，漏掉港股最直接标的(联想/中芯国际H股)。
规则: 概念成分股若含港股标的，必须同等分析。无港股成分的概念也要查是否有港股同业是更好的表达。

### 陷阱7: 概念叠加不做区分
反例: 一只股票同时属于"AI"、"机器人"、"芯片"三个概念，把三个概念的利好都算在它头上。
规则: 概念叠加是加分项但不是乘法项。一只股票的实际弹性取决于其**最相关概念**的基本面，不是概念数量。

### 陷阱8: 只看研报和本地DB，漏掉快变量
反例: 研报库还没覆盖"出口管制→原料断供→客户认证→技术路线替代"的最新链条，就按旧研报逻辑判断概念阶段。
规则: L2/L3 结论前必须跑 Fresh Public Signal Sweep。公开信息按来源分级：S0官方/公告/交易所/海关，S1公司/产业链/权威行业媒体，S2财经媒体/券商新闻，S3社媒/自媒体。S3只能作线索；S2/S3 未经 S0/S1 或两源交叉验证，不得进入主结论和交易触发器。

---

## 与 stock-research / industry-research 的协作

```
industry-research (行业配置: 超配/中性/低配)
        ↓ 行业方向
concept-research (概念叙事: 什么故事→什么阶段→买谁)
        ↓ 最佳载体 1-3 只
stock-research (个股L3: 估值→交易计划→建仓)
```

**协作规则**：
1. concept-research L3 产出的"最佳载体" → 如果该股尚未被 stock-research 覆盖 → 建议用户调 `/stock-research` 做 L3 深挖
2. 如果该股已有 stock-research 研究 → concept-research 引用其结论，不重复分析
3. concept-research 不重复 stock-research 的个股财务分析（只做成分股初筛级别的甄别）
4. concept-research 的催化剂日历如果与已研究的个股催化剂重合 → 交叉引用

---

## 铁律引用

本 skill 遵循 CLAUDE.md 铁律，特别是：
- **铁律#9**: 断点续跑——所有 pipeline 必须 checkpoint + resume
- **铁律#18**: 三地沉淀——项目目录 + Vault + memory
- **铁律#19**: 行业研究三地沉淀（概念研究同等适用）
- **铁律#21**: 禁原始SQL——查 DB 一律走封装层
- **铁律#23**: 概念研究三地沉淀——项目目录 + Vault + memory

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.3.1 | 2026-06-15 | +公告披露预期差闸：公告/财报/政策/订单/客户认证/产能事件必须区分 BEAT/IN_LINE/MISS/AMBIGUOUS，禁止把“落地/确认”自动写成利好、L3升级或交易触发 |
| 1.3.0 | 2026-06-14 | +Fresh Public Signal Sweep硬闸：引入公开信息证据矩阵、来源分级、二次验证、触发器映射，修复研报/DB滞后导致的快催化遗漏 |
| 1.2.1 | 2026-06-13 | +L3 DB schema先验硬闸 +完整个股截面>5000口径 +组合广义/核心暴露区分 +Vault SHA manifest脚本化 |
| 1.2.0 | 2026-06-11 | +概念簇L2并集/交集流程 +概念指数/个股完整截面日期口径铁律 +L1雷达热度条件回归检查 |
| 1.1.0 | 2026-06-09 | +持仓镜头(Step1.0, 治stock-research同款盲区) +L2→L3升级路径(文件管理规范) +DB Schema速查 +concept_radar.py固化脚本 |
| 1.0.0 | 2026-06-09 | 首版: L1全景扫描+L2快评+L3深度研究, 4Agent并行+辩论, 五文件+三地沉淀 |
