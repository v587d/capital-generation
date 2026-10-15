# Quality Scoring Framework

Part 3 of 6 for `stock-eval` — Quality Scoring Framework; ROIC / WACC Analysis
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Quality Scoring Framework

### Piotroski F-Score (0–9)

The Piotroski F-Score measures financial strength and operating improvement across 9 binary criteria. Each criterion scores 1 (pass) or 0 (fail). Score of 8–9 is strong; 0–2 is weak.

**Profitability Signals (4 criteria):**

| # | Criterion | Formula | Pass Condition | Score |
|---|-----------|---------|----------------|-------|
| 1 | ROA > 0 | Net Income / Total Assets | Positive ROA in current year | 0 or 1 |
| 2 | Operating Cash Flow > 0 | CFO from cash flow statement | Positive CFO | 0 or 1 |
| 3 | Change in ROA | ROA(t) − ROA(t-1) | ROA improved year-over-year | 0 or 1 |
| 4 | Accruals (quality) | CFO / Total Assets > ROA | Cash earnings exceed reported earnings | 0 or 1 |

**Leverage, Liquidity & Source of Funds (3 criteria):**

| # | Criterion | Formula | Pass Condition | Score |
|---|-----------|---------|----------------|-------|
| 5 | Change in Leverage | Long-term Debt / Avg Assets | Leverage decreased YoY | 0 or 1 |
| 6 | Change in Liquidity | Current Ratio(t) vs (t-1) | Current ratio improved YoY | 0 or 1 |
| 7 | No New Shares Issued | Diluted shares outstanding | No new equity issuance in past year | 0 or 1 |

**Operating Efficiency (2 criteria):**

| # | Criterion | Formula | Pass Condition | Score |
|---|-----------|---------|----------------|-------|
| 8 | Change in Gross Margin | Gross Margin(t) vs (t-1) | Gross margin expanded YoY | 0 or 1 |
| 9 | Change in Asset Turnover | Revenue / Total Assets | Asset turnover improved YoY | 0 or 1 |

**F-Score Interpretation:**
- **8–9**: Strong financial position — high-quality candidate
- **5–7**: Average quality — neutral
- **0–2**: Weak financial position — high risk of deterioration

### Earnings Quality Score

- **Accruals Ratio**: (Net Income − CFO) / Average Total Assets. Low or negative accruals indicate high earnings quality (cash-backed profits).
- **Cash Conversion Rate**: CFO / Net Income. Ratio consistently above 1.0x is positive. Below 0.7x signals potential earnings inflation.
- **Non-Recurring Items**: Identify and strip out restructuring charges, asset write-downs, gains on asset sales, and one-time tax benefits from normalized earnings.
- **Revenue Recognition Risk**: Assess channel stuffing, bill-and-hold arrangements, and aggressive deferred revenue recognition.

---

## ROIC / WACC Analysis

### ROIC Calculation

**ROIC = NOPAT / Invested Capital**

- **NOPAT** (Net Operating Profit After Tax) = EBIT × (1 − effective tax rate)
- **Invested Capital** = Total Equity + Total Debt − Cash and Cash Equivalents
- Alternatively: Invested Capital = Net PP&E + Net Working Capital + Goodwill + Other Long-term Operating Assets

| Component                | Value |
|--------------------------|-------|
| EBIT                     |       |
| Effective Tax Rate       |       |
| NOPAT                    |       |
| Total Equity             |       |
| Total Debt               |       |
| Less: Cash               |       |
| Invested Capital         |       |
| **ROIC**                 |       |

### WACC Calculation

**WACC = (E/V) × Re + (D/V) × Rd × (1 − T)**

- **Cost of Equity (Re)** via CAPM: Re = Rf + β × (Rm − Rf)
  - Rf: Risk-free rate (current 10-year Treasury yield)
  - β: Stock beta (5-year monthly vs. S&P 500)
  - (Rm − Rf): Equity risk premium (historical ~5–6%)
- **Cost of Debt (Rd)**: Weighted average interest rate on outstanding debt
- **Capital Structure Weights**: E/V = market cap / (market cap + total debt), D/V = total debt / (market cap + total debt)
- **Tax Shield**: Multiply Rd by (1 − marginal tax rate) to reflect interest deductibility

| Component              | Value |
|------------------------|-------|
| Risk-Free Rate (Rf)    |       |
| Beta (β)               |       |
| Equity Risk Premium    |       |
| Cost of Equity (Re)    |       |
| Pre-Tax Cost of Debt   |       |
| Tax Rate               |       |
| After-Tax Cost of Debt |       |
| Equity Weight (E/V)    |       |
| Debt Weight (D/V)      |       |
| **WACC**               |       |

### Economic Value Added (EVA)

**EVA = (ROIC − WACC) × Invested Capital**

- **ROIC > WACC**: Company is creating economic value — every dollar invested earns more than its cost. Strong positive signal.
- **ROIC = WACC**: Company is breaking even economically — no value creation or destruction.
- **ROIC < WACC**: Company is destroying shareholder value — capital is deployed below its opportunity cost. Significant warning sign.

ROIC vs. WACC spread trend (expanding = improving value creation, compressing = deteriorating):

| Year    | ROIC | WACC | Spread | EVA |
|---------|------|------|--------|-----|
| Current |      |      |        |     |
| -1 Year |      |      |        |     |
| -2 Year |      |      |        |     |
| -3 Year |      |      |        |     |

---


