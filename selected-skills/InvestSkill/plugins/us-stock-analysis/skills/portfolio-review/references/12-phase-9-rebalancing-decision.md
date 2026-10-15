# Phase 9 — Rebalancing Decision Framework

Part 3 of 4 for `portfolio-review` — Phase 9 — Rebalancing Decision Framework; Phase 10 — Drawdown & Risk Budget Analysis; Phase 11 — Optimization Recommendations; Output Format
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Phase 9 — Rebalancing Decision Framework

**When to Rebalance**

Three trigger systems — use the one matching the investor's approach:

1. **Threshold-Based (Recommended for most investors)**
   - Rebalance when any asset class drifts > 5% from target weight
   - Individual stock position drifts > 3% from target
   - No action if drift is within tolerance band

2. **Calendar-Based**
   - Review quarterly; rebalance only if drift > 3%
   - Annual full rebalance regardless of drift
   - Simpler but may miss significant mid-quarter moves

3. **Factor-Based**
   - Rebalance when portfolio factor score diverges > 1.5 from target
   - Triggered by momentum factor decay (top-quartile stocks reversing)
   - Suitable for factor-aware investors

**Cost-Benefit Analysis**

Before executing any rebalance, verify it clears the cost hurdle:

```
Expected Drift Cost (annual) = Excess vol from drift × Sharpe ratio penalty
Transaction Cost = Commission + (Bid-Ask Spread × Trade Size) + Tax Impact
Rebalance if: Drift Cost > Transaction Cost × 2 (safety margin)
```

Rule of thumb: do not rebalance positions with < $2,000 drift — transaction costs exceed benefit.

**Rebalancing Decision Flowchart**

```
START
  |
  v
Is drift > threshold?
  NO  --> Monitor next period
  YES --> Is account taxable?
            YES --> Are there harvesting opportunities?
                      YES --> Combine harvest + rebalance
                      NO  --> Evaluate tax cost of rebalance
                               Tax cost > drift benefit? --> Delay
                               Tax cost < drift benefit? --> Rebalance
            NO  --> Rebalance immediately (no tax friction)
```

**Tax-Smart Rebalancing Order**

1. Use new cash contributions to buy underweight assets first
2. Reinvest dividends into underweight positions
3. Harvest losses in overweight positions to fund purchases
4. If still needed, sell overweight positions (minimize short-term gains)

## Phase 10 — Drawdown & Risk Budget Analysis

**Per-Position Maximum Drawdown**

For each holding, calculate the worst peak-to-trough decline over the analysis window:

| Position | Max Drawdown | Recovery Time | Current From Peak | Risk Level |
|----------|-------------|---------------|-------------------|-----------|
| Example  | -35%        | 14 months     | -8%               | Medium |

Flag positions with max drawdown > 50%: high-volatility securities require smaller position sizes to avoid outsized portfolio impact.

**Portfolio-Level Value at Risk (VaR)**

95% VaR (1-day): the loss not exceeded on 95% of trading days.

Parametric VaR (simplified) = Portfolio Value × Portfolio Daily Vol × 1.645

Example: $500,000 portfolio, daily vol 0.9% → 95% VaR = $500,000 × 0.009 × 1.645 = $7,403/day

Report also: 99% VaR (multiply by 2.326 / 1.645) and 10-day VaR (multiply by √10).

**Contribution to Portfolio Volatility**

Each position's marginal contribution to total portfolio volatility:

```
Marginal Vol Contribution (i) = weight(i) × Cov(i, portfolio) / Portfolio Vol
% Vol Contribution = Marginal Vol Contribution / Portfolio Vol × 100
```

Target: no single position contributes > 20% of total portfolio volatility unless it is a deliberate high-conviction overweight.

**Risk Budget Allocation Table**

| Position | Weight % | Vol Contribution % | Risk Budget Used | Status |
|----------|----------|--------------------|-----------------|--------|
| Ideal    | ≤ 10%    | ≤ 15%              | ≤ budget        | OK |
| Flag     | > 10%    | > 20%              | Over budget     | Trim |

**Stress Test Scenarios**

Apply historical shock scenarios to estimate portfolio impact:
- 2022 Rate Shock: tech -35%, bonds -15%, energy +50%
- 2020 COVID Crash: market -34% in 33 days, recovery 5 months
- 2008 GFC: market -57%, credit spreads +500bps
- 2000 Dot-com: tech -78% over 2.5 years

For each scenario: estimate portfolio decline, identify worst-hit positions, confirm portfolio can withstand the scenario without forcing a distressed sale.

## Phase 11 — Optimization Recommendations

1. **Rebalancing Actions**
   - List all positions with > 2% drift from target weight
   - Priority order: largest drift first
   - Tax-aware rebalancing: prioritize tax-loss harvesting in taxable accounts
   - Proposed trades: ticker, action (buy/sell/trim), target weight, estimated proceeds

2. **Diversification Improvements**
   - Specific gaps to fill (e.g., no international exposure, no inflation hedge)
   - Correlation-reduction swaps: replace redundant holdings with uncorrelated alternatives
   - Alternative asset candidates if appropriate (gold, TIPS, REITs, private credit proxies)

3. **Underperformer Review**
   - For each position underperforming benchmark by > 10% over 1Y:
     - Is the original thesis intact?
     - Has fundamentals deteriorated or is this a temporary setback?
     - Hold / average down / exit decision with rationale

4. **Upgrade Candidates**
   - Positions to add based on current conviction and valuation
   - New opportunities that fit the portfolio's existing factor tilts
   - Cost reduction opportunities (replace active fund with cheaper ETF equivalent)

## Output Format

Deliver the review as a structured report with these sections:
1. Executive Summary (3–5 bullet points: biggest strengths and risks)
2. Performance Scorecard (table: metric | portfolio | benchmark | delta)
3. Allocation Heat Map (sector/geography breakdown in table form)
4. Concentration Risk Score (aggregate score with dimension breakdown)
5. Factor Exposure Summary (six-factor table vs. benchmark)
6. Holdings Table (position | weight | 1Y return | vol contribution % | status: hold/trim/exit)
7. Tax-Loss Harvest Candidates (position | unrealized loss | estimated tax saving)
8. Risk Budget Table (position | weight | vol contribution | status)
9. Action List (prioritized, with expected portfolio impact)
10. Implementation Roadmap (immediate / 30-day / 90-day actions)

Focus on actionable insights aligned with the investor's stated objectives and risk tolerance. Flag any positions or allocations that conflict with the investor profile.


