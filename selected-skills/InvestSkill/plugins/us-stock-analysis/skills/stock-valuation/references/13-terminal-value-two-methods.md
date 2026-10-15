# Deep DCF Modeling(continued)

Part 4 of 5 for `stock-valuation` — Deep DCF Modeling
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### Terminal Value — Two Methods

Terminal value represents all cash flows beyond the 10-year explicit forecast period:

- **Terminal growth rate (g)**: Typically 2–3% (anchored to nominal GDP growth). Never set g > WACC — this implies infinite value
- **Gordon Growth Model (preferred)**:
  ```
  TV = FCF₁₀ × (1 + g) / (WACC − g)
  ```
- **Exit Multiple Method (alternative)**:
  ```
  TV = FCFₙ × (EV / FCF exit multiple)
  ```
  Use industry-appropriate EV/FCF multiples from comparable mature companies
- **Terminal value as % of Enterprise Value**: If TV > 80% of total EV, the model is highly sensitive to terminal assumptions. Flag this explicitly and widen the sensitivity range

### WACC Decomposition Table

Complete WACC build with component-level transparency:

```
WACC Decomposition
──────────────────────────────────────────────────────────────────────
Component                          Value      Notes
──────────────────────────────────────────────────────────────────────
Risk-Free Rate (Rf)                ___%       10-year US Treasury yield
Beta (β)                           ___        5-year monthly vs. S&P 500
Equity Risk Premium (ERP)          ___%       Damodaran estimate (5–6%)
Size Premium                       ___%       0–2% for small/mid-cap
──────────────────────────────────────────────────────────────────────
Cost of Equity  Ke = Rf + β×ERP + Size       ___%
──────────────────────────────────────────────────────────────────────
Interest Expense (TTM)             $___M
Total Debt                         $___M
Pre-tax Cost of Debt               ___%
Effective Tax Rate                 ___%
──────────────────────────────────────────────────────────────────────
After-Tax Cost of Debt  Kd×(1−t)             ___%
──────────────────────────────────────────────────────────────────────
Equity Market Cap (E)              $___M
Total Debt (D)                     $___M
E/V (Equity Weight)                ___%       Market value weights
D/V (Debt Weight)                  ___%       Market value weights
──────────────────────────────────────────────────────────────────────
WACC = Ke×(E/V) + Kd×(D/V)                  ___%
──────────────────────────────────────────────────────────────────────

Typical WACC Ranges by Risk Profile:
Risk Profile         WACC Range    Company Examples
─────────────────────────────────────────────────────
Low risk (utility)   6–8%          Regulated utilities, large cap staples
Medium risk          8–11%         Large cap tech, established growth
High risk            11–15%        Small cap, emerging market, cyclical
Very high risk       15–20%+       Early-stage, distressed, pre-revenue
```

### Three-Scenario Model — Full Detail

Always present three scenarios with explicit assumption differences and probability-weighted output:

```
Three-Scenario DCF Framework
Scenario    Probability    Revenue CAGR (Y1-5)    FCF Margin (Y5)    WACC    Terminal g
Bull         20%           [higher growth]         [higher margin]    [lower]  [2.5%]
Base         60%           [consensus growth]      [stable margin]    [base]   [2.0%]
Bear         20%           [lower growth]          [compressed]       [higher] [1.5%]

Scenario Narratives:
  Bull Case:  Favorable macro, market share gains, operating leverage, margin expansion
  Base Case:  Historical trend continuation, modest improvement in line with guidance
  Bear Case:  Competitive pressure, margin compression, macro headwinds, execution risk

Intrinsic Value Output:
  Bull Case IV:    $[value]
  Base Case IV:    $[value]
  Bear Case IV:    $[value]

Probability-Weighted IV = (20% × Bull IV) + (60% × Base IV) + (20% × Bear IV) = $[value]
```

The probability-weighted IV is the primary output used for investment decision-making.

### 5×5 Sensitivity Table — Interpretation Guide

```
Sensitivity Table — Intrinsic Value per Share ($)

              Terminal Growth Rate
WACC     1.0%    1.5%    2.0%    2.5%    3.0%
6.0%     $xxx    $xxx    $xxx    $xxx    $xxx
7.0%     $xxx    $xxx    $xxx    $xxx    $xxx
8.0%     $xxx    $xxx    $xxx    $xxx    $xxx  ← Base Case
9.0%     $xxx    $xxx    $xxx    $xxx    $xxx
10.0%    $xxx    $xxx    $xxx    $xxx    $xxx

[*] Shaded cell = Base Case assumption
```

Interpretation guide:
- If the **entire table** shows a margin of safety vs. current price → high confidence in undervaluation
- If **only a few cells** show margin of safety → valuation depends critically on specific assumptions
- If **no cells** show margin of safety → stock is expensive under all reasonable DCF scenarios

### Common DCF Pitfalls

1. **Garbage in, garbage out**: Extrapolating recent high-growth rates too far into the future. Be conservative, especially in years 6–10.
2. **Terminal value dominance**: If TV > 70% of enterprise value, the model is more speculation than analysis. Stress-test terminal assumptions aggressively.
3. **WACC too low**: Using a WACC below the risk-free rate, or ignoring size/liquidity premiums for smaller companies, artificially inflates intrinsic value.
4. **Ignoring cyclicality**: Using peak FCF margins as the base for a cyclical business. Always normalize FCF through a full business cycle.
5. **Ignoring stock-based compensation**: SBC is a real, dilutive cost. Subtract it from operating cash flow when calculating true economic FCF.
6. **Single scenario thinking**: Presenting only a base case. Always run Bull, Base, and Bear scenarios with explicit assumption differences.
7. **Hidden working capital and capex changes**: Rapidly growing companies often consume significant working capital. Ensure this drag is reflected in FCF projections, not hidden in operating cash flow.
8. **Currency and geographic mix**: For international businesses, project by geography and apply appropriate discount rates by region.


This section is not finished here: `Deep DCF Modeling` continues in `references/14-when-dcf-is.md`.
