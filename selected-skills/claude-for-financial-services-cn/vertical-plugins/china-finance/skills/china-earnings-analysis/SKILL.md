---
name: china-earnings-analysis
description: Post-earnings quarterly update reports for A-share companies under coverage. Analyzes 业绩快报/正式财报, generates variance tables (actual vs 一致预期 vs prior), flags key drivers, and drafts structured earnings notes in Chinese sell-side format. Use instead of the original earnings-analysis skill for Chinese equities. Triggers on "A股财报分析", "季度业绩点评", "年报/中报点评", "earnings review", or "[company] earnings".
---

# china-earnings-analysis

> 本文件相对上游 `d7585ca` 快照做过合规改写（取数与凭据口径），逐条记在快照根目录的 UPSTREAM.md；方法论、阈值与输出模板未改。

## Purpose

Create professional **A股季度/年度业绩点评报告**, analyzing results for companies already under coverage. Follow Chinese sell-side research standards (中金、中信、华泰 format).

## Data Sources

Everything listed below is a **brief to hand to the host's retrieval path**, not a step this report performs. This plugin has exactly one way to obtain data — the main agent delegates it — and from here it calls no data interface and holds no key.

Write the exact request (ticker, the fields needed, the as-of date) for:

- Three statements: 利润表 (quarterly and annual), 资产负债表, 现金流量表
- Market data: 最新价 and its PE / PB, plus the price history this comparison needs
- Disclosure and narrative: the 定期报告 itself (the host parses the filing PDF into readable text), 业绩说明会 material, 投资者关系 Q&A, and recent 相关新闻
- Forward references: whatever 券商预测 fields the host can reach (e.g. 研报条目里的本年 / 次年 EPS 预测)

In a host that splits roles, delegate the request with that brief rather than searching from this step, then keep writing from what comes back and leave the rest unknown.

## Key Financial Terms (Chinese → English)

| Chinese | English | Notes |
|---------|---------|-------|
| 营业收入 | Revenue | Top-line, net of VAT |
| 营业成本 | COGS | Cost of goods sold |
| 毛利率 | Gross margin | 营业利润/营业收入 |
| 营业利润 | Operating profit | 核心经营利润 |
| 归母净利润 | Net income attributable to parent | Key metric for A-share coverage |
| 扣非净利润 | Net income (non-GAAP adj.) | Deducts one-time items |
| 净利润 | Net income | May include minority interest |
| 经营活动现金流 | Operating CF | 经营现金流 |
| 资本支出 | CapEx | 购建固定资产 |
| 有息负债 | Interest-bearing debt | 有息负债 |
| 每股收益 (EPS) | Earnings per share | 基本EPS / 稀释EPS |

## Workflow

### Step 1: Pull the Earnings Print

**Data to collect:**
- Current quarter / full year income statement — asked of the host's retrieval path with the exact fields and as-of date
- Balance sheet and cash flow statement
- Management commentary / 业绩说明会 transcript
- Company press release (投资者关系活动记录表)

**Verify against:**
- Previous quarter guidance (管理层指引)
- Consensus estimates (一致预期) if available

### Step 2: Build the Variance Table

**Required columns:**

| Item | 实际 (Actual) | 一致预期 (Consensus) | 上次预测 (Prior) | 同比 (YoY) | 环比 (QoQ) | Surprise |
|------|---------------|---------------------|------------------|------------|------------|----------|
| 营业收入 | | | | | | |
| 毛利率 | | | | | | |
| 归母净利润 | | | | | | |
| EPS (基本) | | | | | | |
| 经营现金流 | | | | | | |

**Surprise calculation:**
- Beat/Miss % = (Actual - Consensus) / |Consensus| × 100%
- Flag:
  - **大幅超预期**: >+10%
  - **符合预期**: -10% to +10%
  - **低于预期**: <-10%

**Consensus sources (in priority order):**
1. 机构一致预期, for the fields the host actually returned in this brief
2. 券商研报预测 — the forecast figures carried on the research-report entries the host can reach
3. 公司自己的 业绩预告 / 业绩快报 band, which is a disclosed range, not a consensus
4. If none of the above comes back: leave the Consensus column empty, name the missing field, and drop the surprise arithmetic for that line. This plugin has no consensus endpoint of its own, and an expectation is never filled in from memory.

### Step 3: Analyze Key Drivers

**Revenue:**
- Volume vs price decomposition
- Segment revenue breakdown (if disclosed)
- New product / customer contribution
- Industry volume trends

**Margins:**
- 毛利率变化: input cost (原材料), pricing power, product mix
- 费用率变化: 费用率 = 费用 / 营业收入
- 营业利润率 trends

**Balance Sheet:**
- 应收账款增速 vs 收入增速
- 存货积压 risk
- 有息负债 changes
- 商誉 level (flag impairment risk)

**Cash Flow:**
- 经营现金流 vs 净利润 (quality of earnings)
- 资本支出 intensity
- Free cash flow = 经营CF - 资本支出

### Step 4: Update Estimates

**Forward estimates adjustment:**

Based on current quarter results and management guidance:

- Update FY20XXE revenue, margins, EPS
- Adjust Q2-Q4 quarterly estimates
- Update annual consensus if material change
- Flag if guidance was provided

**Estimate change table:**

| Item | Old Estimate | New Estimate | Change | Driver |
|------|-------------|--------------|--------|--------|
| FY Revenue | | | | |
| FY Net Income | | | | |
| FY EPS | | | | |

### Step 5: Valuation Update

**Current valuation metrics:**
- Current stock price + daily change
- PE (动 / 静), PB, PS
- EV/EBITDA (if applicable)
- 52-week high/low, YTD performance
- Relative to sector median

**Post-earnings re-rating assessment:**
- Did multiple expand/contract?
- Is valuation now cheap/expensive vs history and peers?
- 目标价 adjustment rationale

### Step 6: Draft the Report

**Standard A-share earnings update structure:**

```
标题：[公司名称]（[代码]）[Q20XX / FY20XX] 业绩点评：[超预期/符合预期/低于预期]

一、业绩概览
  - 核心数据一览表
  - 同比/环比增速
  - 超出/低于一致预期幅度

二、收入分析
  - 收入增速分解
  - 分业务/分地区收入
  - 量价分析

三、利润分析
  - 毛利率变化及原因
  - 费用率分析
  - 净利润增速分解

四、资产负债表
  - 应收账款
  - 存货
  - 有息负债
  - 其他关注点

五、现金流量
  - 经营现金流
  - 资本支出
  - 自由现金流

六、估值与投资建议
  - 当前估值水平
  - 目标价调整
  - 评级维持/调整

七、风险提示
  - 行业政策风险
  - 原材料价格波动
  - 竞争加剧
  - 商誉减值风险
```

### Step 7: Quality Check

**Before delivering:**

- [ ] Every number traces back to something the host's retrieval path returned (a filing, a quote, a dataset reference)
- [ ] Variance table complete with actual/consensus/prior
- [ ] Beat/miss flagged with % surprise
- [ ] Key drivers identified and explained
- [ ] Forward estimates updated
- [ ] Valuation metrics current
- [ ] Risk factors listed (China-specific)
- [ ] Citations complete; anything the host could not retrieve is written up as a missing field, not as a figure

## China-Specific Elements

### Earnings Call (业绩说明会)
- Schedule: typically same day or next trading day after earnings release
- Location: 上证e互动 / 深交所互动易
- Format: online video/audio + text Q&A
- Key questions often from retail investors

### Regulatory Requirements
- 业绩预告 (earnings preview): required if variance >50%
- 业绩快报 (earnings flash): optional, typically 10 days before full report
- Full annual report: 4 months after year-end
- Semi-annual report: 2 months after H1
- Quarterly report: 1 month after quarter-end

### Accounting Nuances
- 扣非净利润 (non-GAAP net income) widely used by analysts
- 其他收益 (other income) can mask core operating performance
- 政府补助 (government subsidies) significant for some sectors
- 资产减值损失 (asset impairment) — flag if unexpectedly large
- 股份支付 (share-based compensation) — expensed immediately under CAS

### Market Context
- 涨跌停 limits affect post-earnings price action (±10% main board, ±20% 创业板/科创板)
- Northbound flow (北向资金) may react strongly to earnings
- Retail investor participation high → earnings can cause outsized moves

## Source Citations

**Format for data citations:**

```
Source: 巨潮资讯, [Company] 2024 年年度报告, p.[X]        # the disclosure the host fetched
Source: Dataset <dataset_id>, 利润表 · 2024Q4, as-of [Date]   # what the host's data path returned
Source: 券商研报, [Company] 盈利预测, accessed [Date]      # only when it actually came back
```

**For a figure nothing came back for:** state it as a gap — `缺失：<字段>（未取到）` — and stop the line that needs it.
An unretrieved number is not written into the report, and no figure here is filled in from memory or from a plausible range.

> 取数档位（接哪家数据服务、用哪个密钥）由宿主的凭据域决定：这份报告不配置它，也不向使用者索取凭据。
