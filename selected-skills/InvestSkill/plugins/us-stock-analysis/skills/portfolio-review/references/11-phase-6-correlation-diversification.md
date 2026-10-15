# Phase 6 — Correlation & Diversification Analysis

Part 2 of 4 for `portfolio-review` — Phase 6 — Correlation & Diversification Analysis; Phase 7 — Tax-Loss Harvesting Opportunities; Phase 8 — Factor Exposure Analysis
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Phase 6 — Correlation & Diversification Analysis

**Measuring Diversification Benefit**

Portfolio volatility reduction vs. average asset volatility signals diversification quality. If portfolio vol ≈ average position vol, diversification benefit is near zero.

Diversification Ratio = (Weighted average individual vol) / (Portfolio vol)
- Ratio > 1.5: Good diversification
- Ratio 1.2–1.5: Moderate
- Ratio < 1.2: Poor — holdings move together

**Pairwise Correlation Heatmap Template**

For each pair of top-10 holdings, estimate 1-year rolling correlation:

```
         AAPL   MSFT   GOOGL  AMZN   NVDA   JPM   XOM   GLD
AAPL     1.00   0.85   0.82   0.79   0.76   0.42  0.15  -0.10
MSFT     0.85   1.00   0.84   0.80   0.78   0.41  0.14  -0.12
GOOGL    0.82   0.84   1.00   0.81   0.73   0.39  0.12  -0.09
AMZN     0.79   0.80   0.81   1.00   0.70   0.37  0.10  -0.08
NVDA     0.76   0.78   0.73   0.70   1.00   0.35  0.11  -0.07
JPM      0.42   0.41   0.39   0.37   0.35   1.00  0.48   0.05
XOM      0.15   0.14   0.12   0.10   0.11   0.48  1.00   0.30
GLD     -0.10  -0.12  -0.09  -0.08  -0.07   0.05  0.30  1.00
```

Color code: > 0.75 = HIGH (red), 0.50–0.75 = MODERATE (yellow), < 0.50 = LOW (green)

**Effective Number of Positions (ENP)**

ENP = 1 / sum(wi²) where wi = weight of position i

Interpretation:
- ENP ≈ actual N: equal-weight, low correlation — true diversification
- ENP << actual N: dominated by a few large/correlated positions
- Target ENP: at least 0.6 × actual number of holdings

**Correlated Cluster Identification**

Group holdings with pairwise correlation > 0.75 into clusters. Each cluster behaves as a single economic bet. Example clusters: Big Tech, Energy Majors, Regional Banks, Long-Duration Fixed Income.

Actionable rule: no single cluster should exceed 35% of portfolio weight.

## Phase 7 — Tax-Loss Harvesting Opportunities

**Identification Criteria**

Screen all positions for:
1. Unrealized loss > 10% of cost basis
2. Position held > 30 days (avoid wash-sale complications)
3. Realized gains available to offset in the current tax year

**Wash-Sale Rule (30-Day Rule)**

Do not repurchase the same or substantially identical security within 30 days before or after the sale. Alternatives to maintain exposure during the 30-day window: sell XOM, buy CVX; sell QQQ, buy VGT; sell one S&P 500 ETF for another.

**Net Tax Benefit Calculation**

```
Gross Tax Saving = Realized Loss × Marginal Tax Rate
Transaction Cost  = (Bid-Ask Spread + Commission) × 2
Net Benefit       = Gross Tax Saving − Transaction Cost
Harvest if:       Net Benefit > 0 AND loss > $500 minimum threshold
```

**Tax-Loss Harvest Decision Table**

| Condition | Action |
|-----------|--------|
| Unrealized loss > 10%, gains to offset, loss > $500 | Harvest — sell and replace with correlated substitute |
| Unrealized loss 5–10%, gains to offset | Evaluate: transaction cost vs. tax saving |
| Unrealized loss > 10%, no offsetting gains | Hold or carry forward — harvest at year-end if gains materialize |
| Position held < 30 days | Wait for 30-day window to avoid wash-sale |
| Loss < $500 | Skip — transaction costs exceed benefit |
| Short-term gain offset | Priority harvest — short-term rates are higher |

**Annual Harvest Tracking**

Maintain a log: position, cost basis, current value, loss amount, harvest date, replacement security, re-entry date. Review in October before year-end to maximize benefit.

## Phase 8 — Factor Exposure Analysis

**Six-Factor Portfolio Map**

For each holding, estimate factor scores (1–5 scale, 3 = neutral):

| Factor | Measurement Proxy | Low (1–2) | Neutral (3) | High (4–5) |
|--------|------------------|-----------|-------------|------------|
| Value  | P/E, P/B vs. sector | Expensive | Fair | Cheap |
| Growth | Revenue/EPS CAGR 3Y | < 5% | 5–15% | > 15% |
| Momentum | 12-1 month return | Bottom quartile | Middle | Top quartile |
| Quality | ROE, Debt/EBITDA | Low ROE, high debt | Average | High ROE, low debt |
| Low-Vol | 1Y realized vol | High vol | Average | Low vol |
| Size | Market cap | Mega-cap | Mid-cap | Small-cap |

**Portfolio-Level Factor Score**

Weight each holding's factor score by portfolio weight. Compare to S&P 500 baseline (all factors = 3.0):

```
Factor      Portfolio Score   Benchmark   Active Tilt
Value           2.1              3.0       -0.9  (Growth tilt)
Growth          4.2              3.0       +1.2  (Strong growth)
Momentum        3.8              3.0       +0.8  (Slight momentum)
Quality         3.5              3.0       +0.5  (Slight quality)
Low-Vol         2.3              3.0       -0.7  (Higher volatility)
Size            2.4              3.0       -0.6  (Large-cap tilt)
```

**Unintended Factor Tilt Detection**

Flag when any active tilt exceeds ±1.0: this signals an unintended concentration that may not be in the investment thesis. Common unintended tilts: growth investors inadvertently loading up on momentum; dividend investors loading up on low-vol (rate sensitive); index investors with large-cap tilt through tech sector overweight.

**Benchmark Factor Comparison**

Use the factor tilts to explain return difference from benchmark. Growth tilt +1.2 in a value-outperforming market explains underperformance. Momentum tilt in a mean-reverting market increases drawdown risk.


