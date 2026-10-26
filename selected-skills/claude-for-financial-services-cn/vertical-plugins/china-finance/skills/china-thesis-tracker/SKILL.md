---
name: china-thesis-tracker
description: Maintain and update investment theses for A-share portfolio positions and watchlist names. Track key data points, catalysts, milestones, and thesis validity over time. Adapted from the original thesis-tracker skill for Chinese market conventions. Triggers on "A股持仓逻辑跟踪", "投资逻辑更新", "thesis check China", "update thesis for [company]", "is my thesis still intact", or "A股持仓复盘".
---

# china-thesis-tracker

> 本文件相对上游 `d7585ca` 快照做过合规改写（取数与凭据口径），逐条记在快照根目录的 UPSTREAM.md；方法论、阈值与输出模板未改。

## Purpose

Track and maintain **A股投资逻辑/thesis** for portfolio positions and watchlist names, ensuring thesis validity is continuously monitored.

## Evidence request

A thesis review is only as good as what came back since the last one, and this step fetches none of it: the plugin has one retrieval entry — the main agent delegating to the role that owns structured data or disclosure and web material — and it holds no data-service key here.

Send out briefs naming the ticker, the fields wanted and the as-of date:

- 行情与估值：最新价与估值、一段股价历史（从论点建立那天到今天）
- 财务与 KPI：三表里论点盯着的那些科目，加上公司专属 KPI（批价、动销、订单…）
- 股东与资金口径：股本结构与股东变化、成分与资金流口径——写成字段，不写成站点或工具
- 披露与新闻：定期报告与公告、业绩说明会材料、已有研报条目、行业与公司新闻

| 材料 | 由谁取 | 注意 |
|------|--------|------|
| 财务与行情数字 | 宿主结构化取数，回传为数据集引用 | 与上一次复核用同一段区间，否则变化没得比 |
| 公告 / 说明会纪要 / 研报 | 宿主的披露与网页检索（正文过长时由其解析成可读文本） | 引用落到具体文件与日期 |
| 公司专属 KPI | 检索侧按行业口径去找 | 这类高频口径常常没有公开来源；取不到就只留能证实的部分，写明来源与时点 |

股东结构与资金流那几档按字段交代即可，服务商名不出现在这份逻辑里。哪个口径没回来，就在"数据追踪"那一节写成缺口，
不用记忆里的价格、持仓或批价补上。

## Workflow

### Step 1: Define / Load Thesis

**Thesis statement template:**

```
公司：[Company]（[Ticker]）
行业：[Industry]
方向：[Long / Short / Watch]

核心投资逻辑 (3-5 bullet points):
1. [Key driver 1]
2. [Key driver 2]
3. [Key driver 3]

目标价：¥XX.XX (X% upside/downside)
时间 horizon：[6M / 1Y / 2Y]
置信度：[High / Medium / Low]
```

**Thesis components:**

| Component | Description | Example |
|-----------|-------------|---------|
| 核心逻辑 (Core thesis) | Why will the stock move? | 批价上行驱动盈利超预期 |
| 关键假设 (Key assumptions) | What must be true? | 批价 >1000元, 动销增速 >15% |
| 催化剂 (Catalysts) | What triggers re-rating? | Q1业绩, 批价数据, 政策变化 |
| 风险因素 (Risks) | What could break the thesis? | 批价下行, 竞品放量, 政策风险 |
| 目标价 (Target) | Fair value estimate | ¥2000 (基于25x PE) |
| 止损位 (Stop loss) | Downside risk limit | ¥1500 (对应20x PE) |

### Step 2: Track Key Data Points

**Company-specific KPIs:**

| KPI | Frequency | Source | Trend |
|-----|-----------|--------|-------|
| e.g., 批价 | Weekly | 渠道调研, 新闻 | ↑ / → / ↓ |
| e.g., 动销增速 | Monthly | 经销商反馈 | ↑ / → / ↓ |
| e.g., 产能利用率 | Quarterly | 年报/中报 | ↑ / → / ↓ |

**Financial metrics to track:**

| Metric | Last Reported | Trend | Thesis Impact |
|--------|--------------|-------|---------------|
| Revenue growth | | | |
| Gross margin | | | |
| Net margin | | | |
| ROE | | | |
| Net debt/EBITDA | | | |

**Market metrics:**

| Metric | Current | 52W High | 52W Low | Thesis Relevance |
|--------|---------|----------|---------|------------------|
| Stock price | | | | |
| Market cap | | | | |
| PE (TTM) | | | | |
| PB | | | | |
| YTD return | | | | |

### Step 3: Monitor Catalysts

**Catalyst checklist:**

| Catalyst | Expected Date | Status | Outcome | Thesis Impact |
|----------|--------------|--------|---------|----------------|
| Q1 季报 | Apr 25 | Pending | | |
| 批价数据 | Weekly | Ongoing | 稳定在980元 | Positive |
| 股东大会 | May 15 | Scheduled | | |

**Catalyst outcome assessment:**
- **Confirming**: Result supports thesis → increase conviction
- **Neutral**: Result as expected → maintain position
- **Breaking**: Result contradicts thesis → reduce/exit position

### Step 4: Thesis Validity Check

**Regular review questions:**

1. **Has the thesis changed?**
   - Core drivers still intact?
   - New information adding to or subtracting from thesis?

2. **Are assumptions still valid?**
   - Key assumptions: still on track?
   - Any material change to underlying business?

3. **Is the timing right?**
   - Catalyst timeline progressing as expected?
   - Market pricing in the thesis?

4. **Is the risk/reward still favorable?**
   - Upside/downside ratio updated?
   - Entry price still reasonable?

5. **Should thesis be adjusted?**
   - Target price update
   - Risk factors added/removed
   - Time horizon extended/contracted

### Step 5: Thesis Status

**Status categories:**

| Status | Definition | Action |
|--------|-----------|--------|
| Intact (逻辑 intact) | All assumptions hold, catalysts on track | Maintain / add on weakness |
| Under pressure (承压) | Some assumptions challenged, thesis not broken | Monitor closely, define exit criteria |
| Broken (逻辑破) | Core thesis invalidated | Exit position, document lessons |
| Evolving (演进中) | Thesis needs update based on new info | Update thesis statement, re-evaluate |

### Step 6: Update Documentation

**Thesis update log:**

```
[公司] 投资逻辑更新 [Date]

一、当前状态：[Intact / Under pressure / Broken / Evolving]

二、本期间重要变化：
   - [Change 1]: [Impact on thesis]
   - [Change 2]: [Impact on thesis]

三、数据追踪：
   [Key metrics updated]

四、催化剂进展：
   [Catalyst status update]

五、决策：
   - [Maintain / Add / Reduce / Exit]
   - [Rationale]

六、后续关注：
   - [Next check-in date]
   - [Key metrics to watch]
```

第五节那个决策（Maintain / Add / Reduce / Exit）与前面的目标价、止损位、置信度，是把材料写成一个结论的**推演练习**：
本插件没有券商接口，不据它下单，也不会替你加减任何一笔仓。使用者的实际持仓与成本由使用者提供，
缺了就只复查逻辑、不给加减建议。

### Step 7: Portfolio-Level Review

**Aggregate view:**

| Position | Thesis Status | Conviction | Days Held | P&L | Next Catalyst | Action |
|----------|--------------|------------|-----------|-----|---------------|--------|
| | | | | | | |

**Portfolio-level insights:**
- Which theses are working? Common factors?
- Which theses are breaking? Common risks?
- Concentration risk (too many bets on similar thesis?)
- Hedge effectiveness ( shorts protecting longs?)

## China-Specific Thesis Considerations

### Common A-share Thesis Types

| Thesis Type | Description | Key Metrics |
|-------------|-------------|-------------|
| 批价上行 | Liquor sector price appreciation | 批价, 库存, 动销 |
| 国产替代 | Import substitution | 市场份额, 认证进展 |
| 产能出清 | Industry capacity rationalization | 产能利用率, 价格 |
| 政策利好 | Policy tailwind | 政策落地, 补贴 |
| 困境反转 | Distressed turnaround | 债务重组, 新管理层 |
| 行业整合 | M&A consolidation | 集中度, 并购活动 |
| 技术突破 | Technology breakthrough | 专利, 订单 |
| 消费升级 | Premiumization | ASP, 产品结构 |

### A-share Market Risks to Track

| Risk Type | Indicator | Mitigation |
|-----------|-----------|------------|
| 政策风险 (Policy) | Regulatory announcements | Diversify across sectors |
| 系统性风险 (Systemic) | 上证指数 drawdown | Hedging, cash position |
| 流动性风险 (Liquidity) | Margin balances, turnover | Avoid illiquid names |
| 解禁风险 (Lock-up) | Unlocking calendar | Avoid near-term unlocks |
| 质押风险 (Pledging) | Shareholder pledge ratio | Check F10 data |
| 商誉风险 (Goodwill) | Goodwill/equity ratio | Flag high goodwill names |

### Typical A-share Thesis Lifecycle

```
Week 1-2: Initial idea, data gathering
Week 3-4: Thesis formation, model build
Week 5-8: Position establishment, catalyst tracking
Week 9-16: Thesis validation / adjustment
Week 17+: Outcome assessment, exit decision
```

## Quality Checks

Before delivering thesis update:
- [ ] Thesis statement clear and specific
- [ ] Key assumptions listed and tracked
- [ ] Catalysts documented with dates
- [ ] Financial metrics current
- [ ] Price trajectory analyzed
- [ ] Risk factors updated
- [ ] Action recommendation clear
- [ ] Next review date set

> 取数档位（接哪家数据服务、用哪个密钥）由宿主的凭据域决定：这份逻辑跟踪不配置它，也不向使用者索取凭据。
