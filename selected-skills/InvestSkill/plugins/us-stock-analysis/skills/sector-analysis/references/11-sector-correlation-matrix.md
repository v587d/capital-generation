# Sector Correlation Matrix

Part 2 of 4 for `sector-analysis` — Sector Correlation Matrix; Sector Momentum Scoring
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Sector Correlation Matrix

Use this matrix to understand diversification benefits and macro sensitivity when constructing multi-sector portfolios. Correlations are approximate long-run averages; they compress toward 1.0 during market stress.

### Inter-Sector Correlation (approximate, long-run)

| | Tech | Health | Fin | Disc | Comm | Ind | Staples | Energy | Util | RE | Mats |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Tech** | — | Low+ | Low+ | Med+ | Med+ | Low+ | Low- | Low- | Low- | Low- | Low- |
| **Healthcare** | Low+ | — | Low- | Low- | Low+ | Low- | Med+ | Low- | Med+ | Low- | Low- |
| **Financials** | Low+ | Low- | — | Med+ | Low+ | Med+ | Low- | Low+ | Low- | Med+ | Low+ |
| **Disc** | Med+ | Low- | Med+ | — | Med+ | Med+ | Low- | Low- | Low- | Low- | Low+ |
| **Comm Svcs** | Med+ | Low+ | Low+ | Med+ | — | Low+ | Low+ | Low- | Low+ | Low- | Low- |
| **Industrials** | Low+ | Low- | Med+ | Med+ | Low+ | — | Low- | Med+ | Low- | Low- | Med+ |
| **Staples** | Low- | Med+ | Low- | Low- | Low+ | Low- | — | Low- | Med+ | Low+ | Low- |
| **Energy** | Low- | Low- | Low+ | Low- | Low- | Med+ | Low- | — | Low- | Low- | Med+ |
| **Utilities** | Low- | Med+ | Low- | Low- | Low+ | Low- | Med+ | Low- | — | Med+ | Low- |
| **Real Estate** | Low- | Low- | Med+ | Low- | Low- | Low- | Low+ | Low- | Med+ | — | Low- |
| **Materials** | Low- | Low- | Low+ | Low+ | Low- | Med+ | Low- | Med+ | Low- | Low- | — |

**Key:** Med+ = moderate positive correlation (0.4–0.7) | Low+ = low positive (0.1–0.4) | Low- = low negative or near-zero (-0.2–0.1)

### Sector Sensitivity to Key Macro Variables

| Macro Variable | Strong Positive | Moderate Positive | Neutral | Moderate Negative | Strong Negative |
|---|---|---|---|---|---|
| Rising interest rates | Financials | Energy, Materials | Industrials, Tech | Consumer Disc, Comm Svcs | Utilities, Real Estate |
| Falling interest rates | Utilities, Real Estate | Tech, Healthcare | Staples | Financials | — |
| Rising oil/energy prices | Energy | Materials, Industrials | Healthcare | Consumer Disc, Staples | Airlines (Disc) |
| Falling oil prices | Consumer Disc, Airlines | Staples, Tech | Financials | Energy | Materials |
| USD strengthening | Domestic Staples, Utilities | Financials | Healthcare | Tech (exports), Industrials | Materials, Energy |
| USD weakening | Tech (multinationals), Materials | Energy, Industrials | Healthcare | Domestic Utilities | — |
| GDP acceleration | Industrials, Materials, Energy | Tech, Financials, Disc | Comm Svcs | — | Utilities, Staples |
| Recession / GDP contraction | Utilities, Staples, Healthcare | — | Comm Svcs | Financials, Industrials | Energy, Materials, Disc |
| Inflation rising | Energy, Materials | Real Estate | Industrials | Tech (multiple compression) | Utilities, Staples |
| Inflation falling | Utilities, Real Estate, Tech | Healthcare, Disc | Financials | Energy | Materials |
| Credit spread widening | Utilities, Staples, Healthcare | — | Tech | Financials, Real Estate | Disc, Industrials |

---

## Sector Momentum Scoring

Rank all 11 sectors on a 1–11 scale (1 = strongest, 11 = weakest) across four dimensions, then produce a composite rank. Update this scoring monthly or after significant macro events.

### Scoring Dimensions

| Dimension | How to Score | Data Source |
|---|---|---|
| **3M Price Return** | Rank sectors by 3-month total return vs. each other | Sector price history, or the sector ETF series |
| **Earnings Revision Trend** | % of analysts raising forward EPS estimates (breadth) | Consensus revision history |
| **Forward P/E vs. 10Y Historical Average** | Discount = high score; premium = low score | Valuation history for the sector |
| **Analyst Sentiment** | Net buy ratings minus sell ratings as % of total | Ratings and target-price changes, with their dates |

### Momentum Scorecard Template

```
Sector                  3M Return  EPS Revisions  Fwd P/E vs Hist  Analyst Sent.  Composite Rank
Information Technology  [1-11]     [1-11]         [1-11]           [1-11]         [avg rank]
Healthcare              [1-11]     [1-11]         [1-11]           [1-11]         [avg rank]
Financials              [1-11]     [1-11]         [1-11]           [1-11]         [avg rank]
Consumer Discretionary  [1-11]     [1-11]         [1-11]           [1-11]         [avg rank]
Communication Services  [1-11]     [1-11]         [1-11]           [1-11]         [avg rank]
Industrials             [1-11]     [1-11]         [1-11]           [1-11]         [avg rank]
Consumer Staples        [1-11]     [1-11]         [1-11]           [1-11]         [avg rank]
Energy                  [1-11]     [1-11]         [1-11]           [1-11]         [avg rank]
Utilities               [1-11]     [1-11]         [1-11]           [1-11]         [avg rank]
Real Estate             [1-11]     [1-11]         [1-11]           [1-11]         [avg rank]
Materials               [1-11]     [1-11]         [1-11]           [1-11]         [avg rank]
```

### Composite Rank Interpretation

| Composite Rank | Action |
|---|---|
| 1–3 | Strong overweight — broad-based positive momentum |
| 4–5 | Moderate overweight — mostly positive signals |
| 6–7 | Neutral weight — mixed signals |
| 8–9 | Underweight — mostly negative signals |
| 10–11 | Avoid / underweight significantly — broad deterioration |

**Weighting Suggestion:** Equal-weight all four dimensions as a starting point. Tilt to 40% price return + 30% EPS revisions + 20% valuation + 10% sentiment for a momentum-focused strategy.

---


