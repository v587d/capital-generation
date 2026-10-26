# Deep Financial Statement Analysis(continued)

Part 2 of 6 for `stock-eval` — Deep Financial Statement Analysis
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### DuPont Decomposition

DuPont analysis decomposes ROE into its constituent drivers to identify whether profitability, efficiency, or leverage is the primary return engine — and whether returns are sustainable.

**3-Factor DuPont**

ROE = Net Profit Margin × Asset Turnover × Equity Multiplier

| Component | Formula | Current | Y-1 | Y-2 |
|-----------|---------|---------|-----|-----|
| Net Profit Margin | Net Income / Revenue | | | |
| Asset Turnover | Revenue / Average Total Assets | | | |
| Equity Multiplier | Average Total Assets / Average Shareholders' Equity | | | |
| **ROE** | Margin × Turnover × Multiplier | | | |

**5-Factor DuPont (Extended)**

ROE = Tax Burden × Interest Burden × EBIT Margin × Asset Turnover × Equity Multiplier

| Component | Formula | Current | Y-1 | Y-2 |
|-----------|---------|---------|-----|-----|
| Tax Burden | Net Income / Pre-Tax Income | | | |
| Interest Burden | Pre-Tax Income / EBIT | | | |
| EBIT Margin | EBIT / Revenue | | | |
| Asset Turnover | Revenue / Average Total Assets | | | |
| Equity Multiplier | Average Total Assets / Average Equity | | | |
| **ROE** | Product of all five | | | |

**DuPont Interpretation**
- ROE driven by high **margin** (e.g., luxury brands, software): High-quality, sustainable — least risky driver
- ROE driven by high **asset turnover** (e.g., retailers, distributors): Efficient but thin — watch for margin erosion
- ROE driven by high **leverage** (equity multiplier > 3x): Amplified returns but magnified downside — assess debt sustainability carefully
- Declining ROE: diagnose which factor is deteriorating before drawing conclusions

### Competitive Analysis — Porter's Five Forces

| Force | Intensity (H/M/L) | Key Evidence |
|-------|------------------|--------------|
| Threat of New Entrants | | Capital requirements, brand moats, regulatory barriers |
| Bargaining Power of Suppliers | | Supplier concentration, switching costs, input criticality |
| Bargaining Power of Buyers | | Customer concentration, price sensitivity, alternatives |
| Threat of Substitutes | | Technology disruption, cross-industry competition |
| Competitive Rivalry | | Number of peers, market growth rate, differentiation |

**Overall Moat Assessment**: Wide / Narrow / None
- **Wide moat**: Durable competitive advantage expected to persist 20+ years
- **Narrow moat**: Competitive advantage present but may erode within 10 years
- **No moat**: Competing primarily on price or operational efficiency

### Visualization Data Tables

When a visual output is needed, populate these tables for chart generation (the host chart channel renders them; this plugin exports no report):

**Revenue & Earnings Growth**
```
Year    Revenue ($M)    Revenue Growth %    Net Income ($M)    EPS ($)
2020    [value]         [%]                 [value]            [value]
2021    [value]         [%]                 [value]            [value]
2022    [value]         [%]                 [value]            [value]
2023    [value]         [%]                 [value]            [value]
2024    [value]         [%]                 [value]            [value]
```

**Profit Margin Trends**
```
Year    Gross Margin %    Operating Margin %    Net Margin %    Industry Avg %
2020    [%]              [%]                   [%]             [%]
2021    [%]              [%]                   [%]             [%]
2022    [%]              [%]                   [%]             [%]
2023    [%]              [%]                   [%]             [%]
2024    [%]              [%]                   [%]             [%]
```

**Balance Sheet Composition**
```
Year    Current Assets ($M)    Fixed Assets ($M)    Intangibles ($M)    Total Assets ($M)
2020    [value]               [value]              [value]             [value]
2021    [value]               [value]              [value]             [value]
2022    [value]               [value]              [value]             [value]
2023    [value]               [value]              [value]             [value]
2024    [value]               [value]              [value]             [value]

Year    Current Liab ($M)    Long-term Debt ($M)    Equity ($M)    Total L+E ($M)
2020    [value]             [value]                [value]        [value]
2021    [value]             [value]                [value]        [value]
2022    [value]             [value]                [value]        [value]
2023    [value]             [value]                [value]        [value]
2024    [value]             [value]                [value]        [value]
```

**Cash Flow Waterfall**
```
Component                   Amount ($M)    Notes
Operating Cash Flow         [value]        Core business generation
Capital Expenditures        [value]        Investments in assets
Free Cash Flow             [value]        Available for distribution
Dividends                  [value]        Shareholder distribution
Share Buybacks             [value]        Share repurchases
M&A Activity               [value]        Acquisitions
Debt Repayment             [value]        Debt reduction
Net Cash Change            [value]        Bottom line impact
```

**Valuation Multiples Comparison**
```
Metric              Company    Industry Avg    5-Year Avg    Assessment
P/E Ratio           [value]    [value]         [value]       [Over/Under/Fair]
P/B Ratio           [value]    [value]         [value]       [Over/Under/Fair]
P/S Ratio           [value]    [value]         [value]       [Over/Under/Fair]
EV/EBITDA          [value]    [value]         [value]       [Over/Under/Fair]
PEG Ratio          [value]    [value]         [value]       [Over/Under/Fair]
```

---


