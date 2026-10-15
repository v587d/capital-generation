# Analysis Components

Part 1 of 6 for `stock-eval` — Analysis Components; Deep Financial Statement Analysis
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Analysis Components

### 1. Company Overview

- Business model and competitive advantages (moat assessment)
- Market position, addressable market size, and industry trends
- Revenue mix by segment and geographic exposure
- Key products, services, and customer concentration
- Competitive dynamics and threat of disruption

### 2. Financial Health

- Revenue and earnings growth trends (3-year and 5-year CAGR)
- Profit margins: gross margin, operating margin, net margin
- Margin trends: expanding, stable, or compressing
- Balance sheet strength: cash, total debt, net debt, book value
- Liquidity: current ratio, quick ratio, cash conversion cycle
- Cash flow analysis: operating cash flow, free cash flow, FCF yield
- Capital expenditure requirements (maintenance vs. growth capex)
- Working capital management efficiency

### 3. Valuation Metrics

| Metric          | Current | 1-Year Ago | 5-Year Avg | Sector Avg |
|-----------------|---------|------------|------------|------------|
| P/E (TTM)       |         |            |            |            |
| P/E (Forward)   |         |            |            |            |
| PEG Ratio       |         |            |            |            |
| Price/Book      |         |            |            |            |
| Price/Sales     |         |            |            |            |
| EV/EBITDA       |         |            |            |            |
| EV/FCF          |         |            |            |            |
| Dividend Yield  |         |            |            |            |
| Payout Ratio    |         |            |            |            |

### 4. Key Ratios

| Ratio                  | Current | Industry Avg | Assessment |
|------------------------|---------|--------------|------------|
| Return on Equity (ROE) |         |              |            |
| Return on Assets (ROA) |         |              |            |
| Return on Inv. Capital |         |              |            |
| Gross Margin           |         |              |            |
| Operating Margin       |         |              |            |
| Net Margin             |         |              |            |
| Current Ratio          |         |              |            |
| Quick Ratio            |         |              |            |
| Debt-to-Equity         |         |              |            |
| Interest Coverage      |         |              |            |
| Asset Turnover         |         |              |            |

### 5. Peer Comparison

- Direct peer comparison within industry on key valuation multiples
- Historical valuation trends vs. own 5-year history
- Sector performance context and relative positioning
- Market share trends vs. competitors

---

## Deep Financial Statement Analysis

This section provides line-item rigor absorbed from dedicated fundamental analysis workflows. Use when a deeper statement-level breakdown is required.

### Income Statement Line-Item Framework

**Revenue Analysis**
- Break revenue into organic growth vs. acquisition-driven growth vs. FX tailwind/headwind
- Identify top revenue segments by size and growth rate; flag any segment growing faster or slower than the consolidated total
- Assess revenue quality: recurring subscription/contract revenue vs. transactional/one-time revenue
- Operating leverage test: does revenue growth outpace operating expense growth? Calculate incremental operating margin = ΔOperating Income / ΔRevenue

**Cost Structure Decomposition**
- COGS breakdown: raw materials, labor, overhead — track each as % of revenue over 5 years
- SG&A as % of revenue: stable or creeping? Rising SG&A without revenue acceleration signals inefficiency
- R&D intensity: absolute spend and % of revenue — context-dependent (biotech vs. consumer goods)
- Non-recurring items to strip from normalized earnings: restructuring charges, asset write-downs, gain/loss on asset sales, one-time tax benefits, litigation settlements

**Operating Leverage Analysis**
- Fixed vs. variable cost split (estimate from historical margin behavior at different revenue levels)
- Degree of Operating Leverage (DOL) = % Change in Operating Income / % Change in Revenue
- High DOL (>3x) amplifies both upside and downside from revenue swings

| Year | Revenue ($M) | Revenue Growth % | EBIT ($M) | EBIT Growth % | DOL |
|------|-------------|-----------------|-----------|--------------|-----|
| Y-4  |             |                 |           |              |     |
| Y-3  |             |                 |           |              |     |
| Y-2  |             |                 |           |              |     |
| Y-1  |             |                 |           |              |     |
| TTM  |             |                 |           |              |     |

### Working Capital Cycle Analysis

Working capital efficiency directly affects how much cash a business consumes or generates as it grows.

**Key Working Capital Metrics**

| Metric | Formula | Current | Y-1 | Y-2 | Trend |
|--------|---------|---------|-----|-----|-------|
| Days Sales Outstanding (DSO) | Accounts Receivable / (Revenue / 365) | | | | |
| Days Inventory Outstanding (DIO) | Inventory / (COGS / 365) | | | | |
| Days Payable Outstanding (DPO) | Accounts Payable / (COGS / 365) | | | | |
| Cash Conversion Cycle (CCC) | DSO + DIO − DPO | | | | |
| Net Working Capital ($M) | Current Assets − Current Liabilities | | | | |
| NWC as % of Revenue | NWC / Revenue | | | | |

**Cash Conversion Cycle Interpretation**
- **CCC declining**: Company is collecting faster, holding less inventory, and/or extending payables — favorable working capital dynamics, cash generation improves as revenue grows
- **CCC rising**: Working capital is consuming more cash as the business scales — a hidden drag on FCF growth
- **Negative CCC** (e.g., large retailers, subscription businesses): Customers pay before the company pays suppliers — a structural cash flow advantage

**Working Capital as a Growth Funding Check**
- Incremental NWC per $1 of new revenue = ΔNWC / ΔRevenue
- If this ratio exceeds ~15%, rapid revenue growth can strain liquidity even in a profitable business


This section is not finished here: `Deep Financial Statement Analysis` continues in `references/11-dupont-decomposition.md`.
