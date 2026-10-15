# Phase 1 — Portfolio Snapshot

Part 1 of 4 for `portfolio-review` — Phase 1 — Portfolio Snapshot; Phase 2 — Performance Analysis; Phase 3 — Asset Allocation Review; Phase 4 — Holdings Review; Phase 5 — Concentration Risk Scoring
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Phase 1 — Portfolio Snapshot

Start with a high-level summary before diving into details:
- Total portfolio value and cash position
- Number of holdings and average position size
- Date range of analysis
- Investor profile: risk tolerance (conservative / moderate / aggressive), time horizon, income vs. growth objective

## Phase 2 — Performance Analysis

1. **Absolute Returns**
   - YTD, 1Y, 3Y, 5Y total return
   - Compare against relevant benchmarks (S&P 500, Russell 2000, custom blended benchmark)
   - Annualized return vs. benchmark — outperformance or underperformance in basis points

2. **Risk-Adjusted Returns**
   - Sharpe ratio (excess return per unit of total risk)
   - Sortino ratio (penalizes only downside volatility)
   - Calmar ratio (annualized return / max drawdown)
   - Information ratio vs. benchmark

3. **Drawdown Analysis**
   - Maximum drawdown: peak-to-trough magnitude and duration
   - Recovery period after each significant drawdown
   - Drawdown frequency over the analysis window
   - Compare portfolio drawdown vs. benchmark during market stress periods

4. **Volatility Metrics**
   - Annualized standard deviation of returns
   - Beta vs. S&P 500 (market sensitivity)
   - Tracking error vs. benchmark
   - Upside capture / downside capture ratios

## Phase 3 — Asset Allocation Review

1. **Current Allocation Breakdown**
   - Asset class weights: equities, fixed income, cash, REITs, commodities, alternatives
   - Equity sub-breakdown: US large cap, US small/mid cap, international developed, emerging markets
   - Compare current weights to target/policy weights — flag deviations > 5%

2. **Geographic Diversification**
   - US vs. international exposure (%)
   - Country concentration risk — any single country > 20%?
   - Currency exposure and hedging status

3. **Sector and Industry Weights**
   - GICS sector breakdown vs. S&P 500 sector weights
   - Overweight / underweight sectors and the investment thesis behind each
   - Cyclical vs. defensive balance relative to current macro environment

4. **Market Cap Distribution**
   - Large cap / mid cap / small cap split
   - Growth vs. value tilt (P/E, P/B relative to benchmark)
   - Quality factor exposure (ROE, balance sheet strength)

## Phase 4 — Holdings Review

1. **Individual Position Analysis**
   - Position size as % of portfolio — flag any > 10% single-stock concentration
   - Contribution to total return (winners vs. laggards)
   - Unrealized gain/loss and holding period (tax impact)

2. **Position Sizing Discipline**
   - Largest 5 positions — are sizes justified by conviction and risk/reward?
   - Smallest positions — are they too small to be meaningful?
   - Kelly criterion or volatility-scaled sizing check

3. **Overlap and Redundancy**
   - Identify pairs of holdings with > 0.7 correlation
   - ETF overlap analysis — holdings duplicated across ETFs
   - Factor overlap: are multiple positions expressing the same single bet?

4. **Cost Efficiency**
   - Weighted average expense ratio for ETF/fund holdings
   - Estimated annual trading cost drag
   - Tax lot optimization — identify specific lots to sell for tax efficiency

## Phase 5 — Concentration Risk Scoring

Score each concentration dimension independently, then aggregate:

**Single-Stock Concentration**

| Position Weight | Score | Status |
|----------------|-------|--------|
| < 5%           | 0     | OK |
| 5%–10%         | 1     | Monitor |
| 10%–15%        | 2     | Warning |
| 15%–20%        | 3     | High Risk |
| > 20%          | 5     | Red Flag — immediate review required |

**Sector Concentration**

| Largest Sector Weight | Score | Status |
|-----------------------|-------|--------|
| < 20%                 | 0     | Diversified |
| 20%–25%               | 1     | Slight tilt |
| 25%–30%               | 2     | Elevated |
| 30%–40%               | 3     | Warning |
| > 40%                 | 5     | Concentration risk — rebalance urged |

**Factor Concentration**

| Factor Tilt Condition | Score | Note |
|-----------------------|-------|------|
| Mixed factors         | 0     | Balanced |
| Mild single-factor tilt | 1   | Acceptable with thesis |
| Strong single-factor tilt (>70% one factor) | 3 | Vulnerable to factor drawdown |
| Pure single-factor portfolio (>90%) | 5 | Maximum factor risk |

Common factor concentration traps: all high-growth names (P/E > 40), all micro/small-cap, all rate-sensitive (long-duration bonds + REITs + utilities together).

**Aggregate Concentration Score**
- 0–2: Well-diversified
- 3–5: Moderate concentration — monitor
- 6–9: High concentration — rebalance
- 10+: Critical — urgent review


