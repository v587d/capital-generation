---
name: china-idea-generation
description: Systematic stock screening and investment idea sourcing for A-share markets. Combines quantitative screens, thematic research, and pattern recognition to surface new long and short ideas. Adapted from the original idea-generation skill for Chinese market conventions and data sources. Triggers on "A股选股", "股票筛选", "寻找机会", "stock screen China", "A-share ideas", "find ideas for Chinese stocks", or "screen for A-share opportunities".
---

# china-idea-generation

> 本文件相对上游 `d7585ca` 快照做过合规改写（取数与凭据口径），逐条记在快照根目录的 UPSTREAM.md；方法论、阈值与输出模板未改。

## Purpose

Systematically surface new **A股投资机会** through quantitative screens, thematic analysis, and pattern recognition.

## Data Sources

A screen is a set of conditions applied to numbers somebody else handed back, and this step retrieves none of them: the plugin has one retrieval entry — the main agent delegating to the role that owns structured data or web and disclosure material — and it holds no data-service key and runs no query from here.

发 brief 时按族写清标的或筛选条件、要的字段与 as-of 日期：

- 全市场快照：涨跌幅榜、成交额榜与异动名单
- 候选池的行情与估值：价格、PE / PB、市值，以及一段价格序列（动量与形态要用同一段区间）
- 财务口径：利润表与资产负债表的关键科目（筛选阈值那一节按这些数下判断）
- 分类与同业：行业分类口径下的成分股清单，以及同一批字段（一次 brief，别逐个问）

### Secondary Screening Data

| Data | 披露/发布方 | Use |
|------|-------------|-----|
| 龙虎榜 (Dragon-Tiger list) | 交易所每日榜单 | Unusual activity, institutional interest |
| 北向资金 (Northbound flows) | 沪深港通 | Foreign investor sentiment |
| 融资融券 (Margin trading) | 交易所 | Leverage and sentiment |
| 股东人数变化 | 定期报告与公告 | Institutional accumulation/distribution |
| 机构持仓 | 季报 / F10 | Fund ownership trends |
| 大宗交易 (Block trades) | 交易所 | Smart money signals |

这几档同样按"要哪个字段"写进 brief，由检索侧决定去哪儿取；哪一档没回来就在筛选记录里写明它缺席，
不许凭印象把它算进或排除。北向那一档按宿主返回的口径转述——实时买卖明细已停止披露，别写成"净买入"。

## Workflow

### Step 1: Define Screen Criteria

**Investment philosophy alignment:**
- Value vs Growth vs GARP vs Momentum
- Market cap preference (large / mid / small)
- Sector focus or sector-agnostic
- Liquidity requirements (turnover threshold)
- Risk tolerance (volatility, leverage, earnings stability)

**Screen parameters (A-share specific):**

| Parameter | Typical Range | Notes |
|-----------|--------------|-------|
| PE (TTM) | 5-50x | Avoid negative PE |
| PB | 0.5-5x | <1x may indicate distress |
| PS | 0.5-5x | For high-growth unprofitable |
| Market cap | >50亿 | Liquidity threshold |
| Daily turnover | >5000万 | Tradability |
| ROE | >10% | Quality filter |
| Debt/Equity | <100% | Financial health |
| Revenue growth | >10% | Growth filter |
| EPS growth | >15% | Earnings momentum |

### Step 2: Quantitative Screens

**Screen 1: Deep Value (深度价值)**

```
Filters:
- PE (TTM) < 15x AND PB < 1.5x
- ROE > 10% (past 3 years average)
- Debt/Equity < 80%
- Revenue growth > 0% (not declining)
- Market cap > 30亿

Output: Value candidates with potential mispricing
```

**Screen 2: Growth at Reasonable Price (GARP)**

```
Filters:
- PEG < 1.0 (PE / growth rate)
- Revenue growth > 20%
- Gross margin > 30%
- ROE > 15%
- Market cap > 100亿

Output: Quality growth at reasonable multiples
```

**Screen 3: Momentum (趋势跟踪)**

```
Filters:
- Price above 20-day MA AND 60-day MA
- Price within 10% of 52-week high
- Volume above 20-day average
- RSI between 40-70 (not overbought)
- Upward earnings revision

Output: Momentum names in uptrends
```

**Screen 4: Turnaround (困境反转)**

```
Filters:
- Recent loss or margin compression
- New management / strategy announced
- Order book recovering
- Debt restructuring completed
- Insiders buying

Output: Potential turnaround candidates
```

**Screen 5: Dividend Yield (高股息)**

```
Filters:
- Dividend yield > 3%
- Payout ratio < 60%
- FCF positive and stable
- Debt/Equity < 100%
- Stable earnings history

Output: High-quality income names
```

**Screen 6: Special Situations (事件驱动)**

```
Filters:
- Lock-up expiry within 3 months (限售解禁)
- M&A announcement pending
- Regulatory catalyst (集采结果, etc.)
- Index inclusion/exclusion
- STAR/ChiNext eligibility

Output: Event-driven opportunities
```

### Step 3: Thematic Research

**Identify emerging themes:**

| Theme Type | Examples (A-share) | Data Sources |
|-----------|-------------------|-------------|
| Policy-driven | 国产替代, 新基建, 双碳 | 政策文件, 部委公告 |
| Technology | AI应用, 自动驾驶, 机器人 | 技术进展, 订单公告 |
| Demographics | 老龄化, 少子化 | 人口数据, 消费数据 |
| Consumption | 消费升级, 国货崛起 | 零售数据, 品牌调研 |
| Industrial | 高端制造, 专精特新 | 行业数据, 政策 |

**Thematic screening approach:**
1. Define theme and investable universe
2. Map A-share companies to theme
3. Rank by exposure and quality
4. Identify pure-plays vs beneficiaries

### Step 4: Technical Analysis

**A-share technical considerations:**

| Indicator | Use |
|-----------|-----|
| 均线 (Moving averages) | Trend direction (5/10/20/60/120 day) |
| MACD | Momentum and trend changes |
| RSI | Overbought/oversold |
| KDJ | Short-term momentum |
| 成交量 (Volume) | Confirmation of moves |
| 龙虎榜 | Institutional activity |
| 北向资金 | Foreign flows |

**Chart patterns to watch:**
- 突破 (breakout) — above resistance
- 回踩 (pullback to support) — entry opportunity
- 双底/头肩 (double bottom/head & shoulders) — reversal signals
- 量价背离 (volume-price divergence) — trend exhaustion

### Step 5: Fundamental Deep Dive

**For each candidate:**

1. **Business model review**: How does company make money?
2. **Financial health**: Balance sheet, cash flow, earnings quality
3. **Competitive position**: Market share, moat, pricing power
4. **Management quality**: Track record, capital allocation
5. **Valuation**: vs peers, vs history, vs international peers
6. **Catalyst**: What could re-rate the stock?

**Red flag checklist:**
- 商誉占比过高 (>30% of equity)
- 应收账款增速 > 收入增速
- 经营现金流持续为负
- 大股东质押比例过高 (>50%)
- 审计意见非标准无保留
- 频繁变更会计师事务所
- 关联交易占比高

### Step 6: Build the Ideas List

**Standard format:**

| Rank | Ticker | Company | Sector | Idea Type | Thesis | Catalyst | Risk | Conviction |
|------|--------|---------|-------|-----------|--------|----------|------|------------|
| {{RANK}} | {{TICKER}} | {{COMPANY_NAME}} | {{SECTOR}} | {{DIRECTION}} | {{THESIS}} | {{CATALYST}} | {{RISK}} | {{CONVICTION}} |
| Example | 600519 | 贵州茅台 | 白酒 | Long | 批价稳+动销旺+分红高 | Q1业绩超预期 | 批价下行 | High |
| 2 | ... | ... | ... | ... | ... | ... | ... | ... |

**Conviction levels:**
- **High**: Strong thesis, clear catalyst, limited downside
- **Medium**: Good thesis, catalyst timeline uncertain
- **Low**: Exploratory, needs more research

清单里的 Idea Type（Long / Short）、信念档与后面那条仓位设想，是把筛选结果写成一个结论的**推演练习**：
本插件没有券商接口，不据它下单，也不会替你建任何一笔仓；它同样不去替你决定这笔做不做。

### Step 7: Monitor & Update

**Ongoing tracking:**
- Weekly price and news updates
- Catalyst tracking（事件日期与是否落地，逐条复查）
- Thesis validation / invalidation
- Position sizing recommendations（若使用者要一个仓位，按宿主的风险预算口径把算式写出来给他看，不落成订单）

**Update triggers:**
- Earnings results
- Material news (M&A, guidance, regulation)
- Price moves >15% in a week
- Thesis breaking or confirming

## China-Specific Screening Considerations

### Market Structure

| Feature | Screening Implication |
|---------|----------------------|
| 涨跌停限制 | Momentum may be interrupted |
| 散户占比高 | Sentiment-driven overreactions common |
| 政策敏感 | Regulatory risk premium in certain sectors |
| 北向资金 | Track foreign flows for large-caps |
| 龙虎榜 | Unusual activity signals |
| 停牌 (Trading halt) | Due diligence risk for suspended names |

### Common A-share Investment Styles

| Style | Description | Key Metrics |
|-------|-------------|-------------|
| 价值投资 | Deep value, dividend, asset-based | PB, dividend yield, 破净 |
| 成长投资 | High growth, innovation | Revenue growth, R&D intensity |
| 主题投资 | Policy/trend themes | Catalyst proximity, theme purity |
| 技术分析 | Chart-based trading | 均线, MACD, 量价 |
| 量化策略 | Systematic, factor-based | Multi-factor models |
| 打新 | IPO subscription | 中签率, 涨幅预期 |

### Sector-Specific Screening

| Sector | Screening Focus |
|--------|----------------|
| 白酒 | 批价趋势, 渠道库存, 回款, 品牌力 |
| 半导体 | 产能利用率, 国产替代进度, 技术迭代 |
| 新能源 | 产能过剩/出清, 技术路线, 补贴退坡影响 |
| 医药 | 创新药管线, 集采中标, 国际化 |
| 银行 | NIM趋势, 不良率, 拨备, 估值 (破净) |
| 房地产 | 销售额, 融资能力, 土储质量 |
| 消费 | 动销, 库存, 消费升级/降级趋势 |

## Quality Checks

Before delivering ideas list:
- [ ] Screen criteria documented and reproducible
- [ ] Each candidate has fundamental backing
- [ ] Catalysts identified for each idea
- [ ] Risk factors clearly stated
- [ ] Conviction levels assigned
- [ ] Liquidity verified (tradable)
- [ ] Regulatory/compliance review passed

> 取数档位（接哪家数据服务、用哪个密钥）由宿主的凭据域决定：这份选股清单不配置它，也不向使用者索取凭据。
