# Capital Allocation — Beyond Dividends(continued)

Part 4 of 5 for `dividend-analysis` — Capital Allocation — Beyond Dividends; Data Sources; Input Formats
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### 11. FCF Deployment Scorecard

Evaluate how every dollar of free cash flow is allocated across competing priorities:

**Where Does Every $1 of FCF Go?**

Break down actual FCF deployment over trailing 3 years (TTM and 3-year average):
```
FCF Deployment Breakdown:
  Dividends paid:          XX%   ($X.Xb)
  Share buybacks:          XX%   ($X.Xb)
  Debt reduction:          XX%   ($X.Xb)
  Capital expenditures:    XX%   (already deducted from FCF — note if gross capex used)
  M&A and investments:     XX%   ($X.Xb)
  Cash accumulation:        XX%   ($X.Xb)
  Total:                  100%
```
- Note: if using levered FCF, capex is already deducted; use gross cash deployment including capex separately if unlevered FCF is the base
- Trend: is FCF deployment mix shifting? (e.g., buybacks replacing dividends, or debt paydown replacing buybacks)

**Capital Return Yield vs. Peers**
```
Capital Return Yield = Dividend Yield + Buyback Yield

Stock         Div Yield   Buyback Yield   Total Return Yield   vs. Peer Median
[Stock]         X.X%         X.X%              X.X%               +/- X.Xpp
[Peer 1]        X.X%         X.X%              X.X%               Median
[Peer 2]        X.X%         X.X%              X.X%               +/- X.Xpp
[Peer 3]        X.X%         X.X%              X.X%               +/- X.Xpp
```

**Management Capital Allocation Grade**

Score each dimension and assign an overall letter grade:

| Dimension | Score | Grade | Key Evidence |
|-----------|-------|-------|--------------|
| Dividend safety & growth | X/10 | A-F | Payout ratio, streak, DGR |
| Buyback discipline | X/10 | A-F | Price timing, net share reduction |
| M&A track record | X/10 | A-F | Goodwill impairments, synergy delivery |
| Debt management | X/10 | A-F | Leverage trajectory, maturity management |
| FCF deployment efficiency | X/10 | A-F | Return yield vs. peers, cash hoarding |
| **Overall Grade** | **X/10** | **A-F** | **Composite assessment** |

```
Grade Criteria:
A (9-10): Consistent compounders — buyback below fair value, dividend aristocrat, M&A creates value, optimal leverage
B (7-8):  Good stewards — solid on most dimensions, one area of weakness
C (5-6):  Average — market-rate capital return, limited M&A track record
D (3-4):  Poor — overpays for M&A, buybacks at peak, dividend growth stagnant
F (0-2):  Value destroyers — goodwill impairments, dividend cuts, re-levering balance sheet
```

### 12. Capital Allocation Quality Score (Composite 0–10)

Single composite score summarizing overall capital allocation quality:

```
Component                        Weight   Score (0-10)   Weighted Score
Dividend Safety Score              20%      X.X            X.X
Dividend Growth Quality            10%      X.X            X.X
Buyback Discipline                 20%      X.X            X.X
M&A Track Record                   20%      X.X            X.X
Debt Management Quality            15%      X.X            X.X
FCF Deployment Efficiency          15%      X.X            X.X
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Capital Allocation Quality Score   100%                    X.X / 10
```

```
Score    Interpretation
9-10     Exceptional stewardship — rare, compounding machines
7-8      Strong allocators — above-average long-term value creation
5-6      Average — market-rate capital allocation, no clear edge
3-4      Below average — capital misallocation risk weighs on returns
0-2      Poor stewardship — history of value destruction through M&A, buybacks at peaks, or dividend unsustainability
```

---

## Data Sources

**Primary Financials**
- SEC filings (10-K / 10-Q): FCF, net income, dividends paid (cash flow statement), share repurchase disclosures
- Company investor relations pages: dividend history, buyback program announcements, earnings call transcripts

**Dividend Research Platforms**
- **Simply Safe Dividends**: Dividend Safety Scores, comprehensive dividend data (premium)
- **Dividend.com**: Dividend yield, history, DRIP calculators
- **DRIP Investing Resource Center (dripinvesting.org)**: Aristocrats/Kings lists
- **Seeking Alpha Dividends**: Analyst commentary on dividend sustainability
- **S&P Global**: Official Dividend Aristocrats and Kings lists

**Capital Allocation Research**
- **Compustat / FactSet**: Multi-year buyback and M&A data
- **Bloomberg**: Credit ratings, bond spreads, covenant disclosures
- **Morningstar**: Capital allocation ratings, M&A track record, stewardship grade
- **GuruFocus**: FCF analysis, buyback history, insider ownership

**Screening Tools**
- Finviz screener: Filter by dividend yield, payout ratio, buyback yield
- Morningstar: Capital Allocation rating (Exemplary / Standard / Poor)
- GuruFocus: Capital allocation and management quality scores

## Input Formats

### Format 1: Single Ticker
```
User: /dividend-analysis AAPL

Claude analyzes AAPL across all capital allocation dimensions
```

### Format 2: Portfolio Income Review
```
User: /dividend-analysis --portfolio AAPL,JNJ,KO,PEP,XOM

Claude provides comparative analysis across all tickers with portfolio-level income model and capital return yields
```

### Format 3: Sector Screen
```
User: /dividend-analysis --sector utilities

Claude screens utilities sector for best capital allocation quality using safety, growth, buyback yield, and M&A discipline criteria
```


