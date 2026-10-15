# DCF Framework

Part 4 of 6 for `stock-eval` — DCF Framework; Management Quality Assessment
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## DCF Framework

### Step-by-Step DCF Methodology

**Step 1 — Project Free Cash Flow (Years 1–10)**
- Start with current year base FCF = Operating Cash Flow − Maintenance Capex
- Apply revenue growth rate assumptions (differentiate Phase 1: high growth, Phase 2: fade to stable)
- Apply operating margin assumptions (expanding/stable/compressing)
- Deduct taxes and changes in net working capital
- FCF = NOPAT + D&A − Change in Working Capital − Capex

**Step 2 — Terminal Value Calculation**
- Gordon Growth Model: TV = FCF(Year 10) × (1 + g) / (WACC − g)
- Exit Multiple Method: TV = EBITDA(Year 10) × Terminal EV/EBITDA multiple
- Terminal growth rate (g): typically 2–3% (in line with long-run nominal GDP growth)
- Cross-check both methods for reasonableness

**Step 3 — Discount to Present Value**
- Discount each year's FCF: PV(FCFt) = FCFt / (1 + WACC)^t
- Discount terminal value: PV(TV) = TV / (1 + WACC)^10
- Enterprise Value = Sum of all discounted FCFs + PV(Terminal Value)
- Equity Value = Enterprise Value − Net Debt
- Intrinsic Value Per Share = Equity Value / Diluted Shares Outstanding

### Key Assumptions

| Assumption             | Base Case | Bull Case | Bear Case |
|------------------------|-----------|-----------|-----------|
| Revenue Growth Yr 1–5  |           |           |           |
| Revenue Growth Yr 6–10 |           |           |           |
| Operating Margin       |           |           |           |
| Tax Rate               |           |           |           |
| Capex (% Revenue)      |           |           |           |
| WACC                   |           |           |           |
| Terminal Growth Rate   |           |           |           |
| Terminal EV/EBITDA     |           |           |           |

### Sensitivity Table

Intrinsic value per share at various WACC and terminal growth rate combinations:

| WACC \ Terminal Growth | 1.5%  | 2.0%  | 2.5%  | 3.0%  | 3.5%  |
|------------------------|-------|-------|-------|-------|-------|
| 7%                     |       |       |       |       |       |
| 8%                     |       |       |       |       |       |
| 9%                     |       |       |       |       |       |
| 10%                    |       |       |       |       |       |
| 11%                    |       |       |       |       |       |

### Margin of Safety Assessment

- **Intrinsic Value (Base Case)**:
- **Current Market Price**:
- **Premium / (Discount) to Intrinsic Value**:
- **Margin of Safety**: (Intrinsic Value − Market Price) / Intrinsic Value × 100%
  - > 30% discount: Significant margin of safety — compelling value
  - 10–30% discount: Moderate margin of safety — attractive
  - 0–10% discount: Limited margin of safety — fairly valued
  - Trading at premium: No margin of safety — risk of capital loss if assumptions miss

---

## Management Quality Assessment

### Capital Allocation Track Record

- **ROIC Trend**: Is management generating returns above cost of capital consistently? Review 5-year ROIC history.
- **Acquisition History**: Evaluate past M&A for value creation. Did acquired assets earn above WACC? Were goodwill impairments taken post-acquisition?
- **Buyback Timing**: Did management repurchase shares below intrinsic value? Assess buyback price vs. subsequent performance.
- **Dividend Policy**: Sustainable payout ratio? Dividend growth track record. Balance between dividends, buybacks, and reinvestment.
- **Capex Discipline**: Differentiate growth capex vs. maintenance capex. Asset-light vs. capital-intensive business assessment.

### Guidance Accuracy History (Last 8 Quarters)

| Quarter  | EPS Guidance | EPS Actual | Beat/Miss | Revenue Guidance | Revenue Actual | Beat/Miss |
|----------|-------------|------------|-----------|------------------|----------------|-----------|
| Q1       |             |            |           |                  |                |           |
| Q2       |             |            |           |                  |                |           |
| Q3       |             |            |           |                  |                |           |
| Q4       |             |            |           |                  |                |           |
| Q5       |             |            |           |                  |                |           |
| Q6       |             |            |           |                  |                |           |
| Q7       |             |            |           |                  |                |           |
| Q8       |             |            |           |                  |                |           |
| **Rate** |             |            | X/8       |                  |                | X/8       |

- Beat rate above 75% (6+/8) is strong. Below 50% suggests overpromising or deteriorating visibility.
- Assess guidance conservatism (sandbagging tendency) vs. optimism bias.

### Insider Ownership Alignment

- **CEO ownership** (% of shares outstanding): > 3% meaningful, > 10% highly aligned
- **Board ownership**: Independent directors with meaningful personal stakes indicate alignment
- **Recent insider transactions**: Open-market buys are strongly positive; sells can be routine diversification
- **Insider buy/sell ratio** over past 12 months
- **10b5-1 plan activity**: Scheduled plan sales are less informative than discretionary transactions

### Compensation Structure

- **Pay-for-performance alignment**: Are bonuses and equity vesting tied to ROIC, FCF, and total shareholder return (TSR)?
- **Long-term equity grants**: Stock option or RSU vesting periods (3+ years preferred)
- **CEO pay ratio**: Context for compensation relative to company size and peers
- **Say-on-pay vote**: Shareholder approval percentage in most recent proxy vote
- **Excessive compensation red flags**: Guaranteed bonuses, repriced options, change-of-control severance packages

---


