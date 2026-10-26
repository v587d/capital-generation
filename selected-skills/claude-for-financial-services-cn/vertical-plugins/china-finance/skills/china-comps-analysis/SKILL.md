---
name: china-comps-analysis
description: Comparable company analysis for A-share equities. Adapts the original comps-analysis skill for Chinese market data sources, A-share trading multiples, and domestic peer selection. Triggers on "A股可比公司", "可比分析", "comps China", "peer comparison A-share", "可比公司分析", or "trading comps [industry]".
---

# china-comps-analysis

> 本文件相对上游 `d7585ca` 快照做过合规改写（取数与凭据口径），逐条记在快照根目录的 UPSTREAM.md；方法论、阈值与输出模板未改。

## Purpose

Build **A股可比公司分析** — peer group multiples comparison adapted for the Chinese equity market.

## Evidence request

This section says **what to ask the host's retrieval path for**. It is not a set of calls made from here: this plugin obtains data through exactly one entry — the main agent delegating it — and a comps sheet carries no data-service key and issues no interface call.

Hand over a brief naming the peer tickers, the fields, and one shared as-of date:

- Trading multiples inputs per name: 最新价, PE / PB / PS, 市值, 股本
- Financials per name: revenue and 归母净利润 for the LTM window, 资产负债表 for book value and 有息负债, plus the 折旧摊销 needed for EBITDA
- Peer universe: the industry constituents for the classification the host returns
- Filings: the 定期报告 behind any figure that has to be checked against the disclosure rather than a screen

In a host that splits roles, delegate that brief rather than searching from this step, then build the table from what comes back. A peer whose figures did not come back stays out of the median — it is not filled in with a remembered multiple.

## Workflow

### Step 1: Select Peer Group

**Peer selection criteria:**

| Criterion | China Context |
|-----------|---------------|
| Industry | Same industry classification the host returned |
| Market cap | ±3x of subject company |
| Revenue | ±2x of subject company |
| Growth | Similar revenue growth profile |
| Profitability | Comparable margins |
| Business model | Same/related business model |
| Geography | China-focused (A-share only) |
| Listing status | All A-share (include 北交所 if relevant) |

**Typical peer count:** 8-15 companies

### Step 2: Collect Financial Data

**Data to collect for each peer:**

| Data Item | Source | Notes |
|-----------|--------|-------|
| Current price | 宿主取数返回 | as-of 日期与其余行统一 |
| Market cap | Calculated | Shares outstanding × price |
| Revenue (LTM) | 宿主取数返回（利润表） | |
| Net income (LTM) | 宿主取数返回（归母净利润） | |
| EPS ( diluted ) | 宿主取数返回 | |
| Book value | 资产负债表 | |
| EBITDA | Calculate | Net income + tax + interest + D&A |
| EV | Calculate | Market cap + net debt |

The `Source` column is filled with what the retrieval actually returned — a dataset reference from the host's data path or the disclosure document behind it — never with a vendor name, and never left implied.

### Step 3: Calculate Trading Multiples

**Standard multiples:**

| Multiple | Formula | Typical Range (A-share) |
|----------|---------|------------------------|
| P/E (动态) | Price / 预测EPS | 10-50x |
| P/E (TTM) | Price / TTM EPS | 10-50x |
| P/E (静态) | Price / 上年EPS | 10-50x |
| PB | Price / 每股净资产 | 1-10x |
| PS | EV / Revenue | 1-10x |
| EV/EBITDA | EV / EBITDA | 5-20x |
| PEG | P/E / Growth | 0.5-2.0 |
| 股息率 | Dividend / Price | 0-5% |
| ROE | Net income / Equity | 5-30% |

**Multiples calculation notes:**
- P/E: use 归母净利润 (net income attributable to parent)
- PB: use 归属于母公司股东权益
- EBITDA: approximate as 营业利润 + 折旧摊销 (if D&A not separately stated)

### Step 4: Peer Comparison Table

**Standard comps table:**

| Company | Ticker | Market Cap (亿) | P/E (TTM) | P/B | P/S | EV/EBITDA | Revenue Growth | Net Margin | ROE |
|---------|--------|----------------|-----------|-----|-----|-----------|---------------|------------|-----|
| Subject | | | X.Xx | X.X | X.X | X.X | X% | X% | X% |
| Peer 1 | | | X.Xx | X.X | X.X | X.X | X% | X% | X% |
| Peer 2 | | | X.Xx | X.X | X.X | X.X | X% | X% | X% |
| Peer 3 | | | X.Xx | X.X | X.X | X.X | X% | X% | X% |
| ... | | | | | | | | | |
| Median | | | X.Xx | X.X | X.X | X.X | X% | X% | X% |
| Mean | | | X.Xx | X.X | X.X | X.X | X% | X% | X% |

### Step 5: Identify Outliers

**Outlier analysis:**

| Company | P/E | vs Median | Reason for Premium/Discount |
|---------|-----|-----------|----------------------------|
| | | ±X% | Growth, margin, quality, sentiment |

**Common reasons for A-share premium/discount:**
- 增速 (Growth rate)
- 盈利能力 (Profitability / ROE)
- 行业地位 (Market position)
- 技术壁垒 (Technology moat)
- 管理层质量 (Management quality)
- 流动性 (Liquidity — 北向资金持仓)
- 概念/题材 (Theme / concept premium)
- 治理结构 (Corporate governance)

### Step 6: Valuation Range

**Derive valuation range:**

| Method | Low | Mid | High | Rationale |
|--------|-----|-----|------|-----------|
| P/E | Xx | Xx | Xx | Based on peer range |
| P/B | Xx | Xx | Xx | Based on peer range |
| P/S | Xx | Xx | Xx | Based on peer range |
| EV/EBITDA | Xx | Xx | Xx | Based on peer range |

**Implied price range:**
- Low: ¥XX (using low multiples + conservative assumptions)
- Mid: ¥XX (using median multiples)
- High: ¥XX (using high multiples + optimistic assumptions)

### Step 7: Relative Valuation Conclusion

**Valuation summary:**

```
可比公司估值结论

当前股价: ¥XX
目标价区间: ¥XX - ¥XX
当前估值水平: [Premium/Discount] vs  peers

关键结论:
1. 相对估值: 较同业 [低/中/高]
2. 主要驱动: [Growth / Margin / Quality]
3. 估值折价/溢价原因: [Explanation]

投资建议: [Buy / Hold / Sell]
```

## China-Specific Considerations

### A-share Multiples Quirks

| Issue | Impact | Mitigation |
|-------|--------|-----------|
| 盈利波动大 | TTM earnings volatile | Use 3Y average |
| 一次性损益 | Distorts P/E | Use 扣非净利润 for P/E |
| 亏损公司 | Negative P/E meaningless | Use P/S or EV/EBITDA |
| 新股次新股 | Limited history | Use 静态市盈率 cautiously |
| ST股票 | Distressed | Exclude from peer set |

### Chinese Market Premiums

| Factor | Typical Premium |
|--------|----------------|
| 消费龙头 (Consumer leader) | +20-50% |
| 科技/创新 (Tech/innovation) | +30-100% |
| 医药 (Pharma) | +15-40% |
| 国企 (SOE) | -10 to -30% |
| 高股息 (High dividend) | -5 to +10% |
| 北向资金重仓 | +5-20% |

### 东方财富 Industry Categories

**Common categories for peer selection:**
- 白酒, 啤酒 — Beverages
- 半导体, 芯片 — Semiconductors
- 银行, 证券, 保险 — Financial services
- 创新药, 医疗器械 — Healthcare
- 光伏设备, 锂电池 — New energy
- 汽车整车, 汽车零部件 — Auto
- 软件开发, IT服务 — Software/IT
- 房地产, 建材 — Real estate / Materials

## Quality Checks

Before delivering:
- [ ] Peer group appropriate (similar size, growth, business model)
- [ ] Every figure came back through the host's retrieval path, or is written up as missing
- [ ] Multiples calculated correctly
- [ ] Outliers explained
- [ ] Valuation conclusion supported
- [ ] Current price verified
> 取数档位（接哪家数据服务、用哪个密钥）由宿主的凭据域决定：这张可比表不配置它，也不向使用者索取凭据。
> 目标价区间与最后一行投资建议是把上面这些倍数写成一个结论的**推演练习**，本插件没有券商接口，不据它下单，也不会替你执行任何一笔。
