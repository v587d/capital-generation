---
name: china-initiating-coverage
description: Institutional-quality equity research initiation reports for A-share companies. Covers company analysis, financial modeling, valuation, chart preparation, and final report assembly. Adapted from the original initiating-coverage skill for Chinese market conventions, CAS accounting, and A-share disclosure practice. Triggers on "A股首次覆盖", "首次评级", "initiate coverage China", "initiate on [company]", "A股研究报告", or "start research on [company]".
---

# china-initiating-coverage

> 本文件相对上游 `d7585ca` 快照做过合规改写（取数、凭据与出图口径），逐条记在快照根目录的 UPSTREAM.md；方法论、评级档位表与输出模板未改。

## Purpose

Create institutional-quality **A股首次覆盖研究报告**, following Chinese sell-side research standards.

## Evidence request

An initiation report is assembled from material this step does not fetch. The plugin has one retrieval entry — the main agent delegating to the role that owns structured data or disclosure and web material — and it holds no data-service key and issues no query from here.

Send the briefs in families, each naming the ticker, the fields, and the as-of date:

- 公司底色：profile、主营业务与股本结构
- 行情与历史：最新估值、股价历史（估值分位与事件标注要用同一段区间）
- 三表历史：利润表、资产负债表、现金流量表，长度按建模需要
- 同业：所选分类口径下的成分股清单，以及同一批字段（一次 brief，别逐个问）
- 披露与文档：定期报告与招股文件、上市与公告文件、投资者关系材料、已有的卖方覆盖
- 行业口径：行业协会与统计口径的产业数据

| 材料 | 由谁取 | 注意 |
|------|--------|------|
| 定期报告 / 公告 / 招股书 | 宿主的披露与网页检索（正文过长时由其解析成可读文本） | 引用落到具体文件与页码 |
| 财务与行情数字 | 宿主结构化取数，回传为数据集引用 | 全套统一 as-of 日期 |
| 预期参照 | 券商研报条目里的预测字段 | 单家口径，不是一致预期 |

预期参照在本插件没有一致预期接口可取；取不到就把对比写在历史与披露上，并写明这是自家基线，不假称市场共识。任何字段没回来，就在那一节写成缺口，不用记忆里的数补。

## Workflow

### Task 1: Company Research

**Company overview:**
- Business description (主营业务)
- History and development (发展历程)
- Ownership structure (股权结构)
- Management team (管理层)
- Shareholder composition (股东构成)

**Business segments:**

| Segment | Revenue % | Margin | Growth Driver |
|---------|-----------|--------|---------------|
| | | | |

**Key questions to answer:**
1. What does the company do? How does it make money?
2. What is its competitive advantage? (护城河)
3. What are the key growth drivers?
4. What are the main risks?
5. Who are the comparable companies?

### Task 2: Financial Modeling

Build a financial model (refer to `china-3-statement-model` skill):

**Historical analysis (3-5 years):**

| Metric | 2020 | 2021 | 2022 | 2023 | 2024E | 2025E | 2026E |
|--------|------|------|------|------|-------|-------|-------|
| Revenue (亿) | | | | | | | |
| YoY Growth | | | | | | | |
| Gross Margin | | | | | | | |
| Operating Margin | | | | | | | |
| Net Margin | | | | | | | |
| ROE | | | | | | | |
| Net Debt/EBITDA | | | | | | | |

**Key modeling considerations (see china-3-statement-model):**
- CAS accounting standards
- 25% tax rate (or 15% for 高新技术企业)
- 千元 vs 元 unit normalization
- 增值税 treatment
- 商誉 flagging
- R&D expense treatment

### Task 3: Valuation Analysis

**Build comprehensive valuation:**

1. **DCF** (refer to `china-dcf` skill)
   - WACC with CGB risk-free rate
   - 6-8% China ERP
   - 25% tax rate
   - CNY denominated

2. **Comparable companies** (refer to `china-comps` skill)
   - Peer set from the industry classification the host returned
   - PE, PB, PS, EV/EBITDA multiples
   - Regression analysis if >5 peers

3. **Precedent transactions** (if available)
   - China M&A comparable multiples
   - Control premium analysis

4. **Sum-of-the-parts** (if multi-segment)
   - Segment-level DCF or multiples
   - Conglomerate discount assessment

**Valuation summary:**

| Method | Value (元/股) | Weight | Rationale |
|--------|--------------|--------|-----------|
| DCF | | | |
| PE comps | | | |
| PB comps | | | |
| EV/EBITDA comps | | | |
| SOTP | | | |
| **Implied target** | | | |

### Task 4: Chart Preparation

**Required charts:**

1. **Revenue & earnings history**
   - 5-year historical + 3-year projected
   - Bar chart: Revenue
   - Overlay: Net income, margins

2. **Valuation multiple history**
   - PE band (5-year)
   - PB band (5-year)
   - Current vs historical average

3. **Peer comparison**
   - Scatter: Growth vs Multiple
   - Bar: Key metrics vs peers

4. **Share price chart**
   - 2-year price history
   - Key events annotated

**Chart standards:**

The four exhibits above say what an initiation report shows; they are **rendered by the host**, not drawn from this step. This plugin has one charting path — the role that owns visualization — and a report step hands it the series with the as-of window and the intent of each exhibit, then uses what comes back. Theme, styling, and label layout are that path's decisions, not this template's.

- 交出去时说明图型意图：柱状 + 叠加、估值区间带、增长 vs 倍数散点、两年价格线
- 中文标签与 A 股标注（涨跌停、财报日期）作为要求写进 brief，由出图角色落
- 图的出处写回取数回来的那份记录（数据集引用或披露文件），不写服务商名

### Task 5: Report Assembly

**Standard A-share initiation report format:**

```
【XX证券】[公司名称]（[代码]）首次覆盖报告：[评级]

投资要点：
  - [3-5 bullet investment highlights]
  - 目标价：¥XX.XX (X% upside/downside)
  - 评级：买入/增持/中性/减持/卖出

一、投资逻辑
   [Core thesis, 2-3 paragraphs]

二、公司分析
   - 业务概述
   - 竞争优势
   - 管理团队
   - 股权结构

三、行业分析
   - 市场规模与增速
   - 竞争格局
   - 政策环境
   - 发展趋势

四、财务分析
   - 历史财务表现
   - 盈利驱动因素
   - 财务健康度
   - 关键假设

五、估值分析
   - 估值方法概述
   - DCF analysis
   - Comparable companies
   - Valuation summary
   - Target price derivation

六、风险提示
   - [Company-specific risks]
   - [Industry risks]
   - [Market risks]
   - [Policy risks]

附录：
   - 财务报表预测
   - 详细估值模型
   - 公司资料
```

**Report length:**
- Summary: 1 page
- Full report: 15-30 pages
- Financial model appendix: 10-15 pages

## China-Specific Considerations

### Rating Conventions (A-share)

| Rating | Chinese Equivalent | Implied Return |
|--------|-------------------|----------------|
| Buy | 买入 | >15% upside |
| Overweight / Accumulate | 增持 | 5-15% upside |
| Neutral / Hold | 中性 | -5% to +5% |
| Underweight / Reduce | 减持 | -5% to -15% |
| Sell | 卖出 | <-15% downside |

**Note:** Some firms use 5-point scale (买入/增持/中性/减持/卖出), others use 3-point (买入/增持/减持).

### Coverage Initiation Practices

**Pre-initiation checklist:**
- [ ] Company filings reviewed (年报, 招股说明书)
- [ ] Management meeting completed (if possible)
- [ ] Industry research thorough
- [ ] Peer comparison complete
- [ ] Financial model built and validated
- [ ] Valuation analysis complete
- [ ] Conflicts of interest disclosed

**Common initation triggers:**
- New IPO (新股)
- IPO quiet period expiry (typically 30-180 days)
- Market cap reaches coverage threshold
- New sector coverage mandate
- Material corporate action (M&A, restructuring)

### China-Specific Risks to Highlight

| Risk Category | Examples |
|--------------|---------|
| 政策风险 | Regulatory changes, industry policy shifts |
| 市场风险 | A-share volatility, retail sentiment |
| 流动性风险 | Low float, low turnover |
| 公司治理 | Related party transactions, pledge risk |
| 行业风险 | Overcapacity, demand cyclicality |
| 汇率风险 | For exporters/importers |
| 商誉减值 | Goodwill impairment risk |
| 质押风险 | Share pledge unwinding |

### Regulatory Compliance

**Chinese regulatory requirements for research:**
- 投资者适当性管理 (suitability)
- 利益冲突披露 (conflict of interest)
- 研究报告留痕 (research record retention)
- 静默期规定 (quiet period before IPOs)
- 预测免责声明 (disclaimer on estimates)

## Quality Checks

Before delivering:
- [ ] Every figure traces back to what the host's retrieval path returned (a dataset reference or a filing), or is written up as a gap
- [ ] Financial model balanced and validated
- [ ] Valuation analysis comprehensive
- [ ] Peer comparison adequate (>3 peers)
- [ ] Rating and target price justified
- [ ] Risk factors comprehensive
- [ ] Report follows standard format
- [ ] All citations complete
- [ ] Compliance disclosures included
> 取数档位（接哪家数据服务、用哪个密钥）由宿主的凭据域决定：这份报告不配置它，也不向使用者索取凭据。
> 报告里的评级五档与目标价是把上面这些材料写成一个结论的**推演练习**：本插件没有券商接口，不据它下单，也不会替你执行任何一笔。
