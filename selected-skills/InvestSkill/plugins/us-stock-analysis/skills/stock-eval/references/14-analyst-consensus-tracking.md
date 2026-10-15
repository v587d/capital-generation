# Analyst Consensus Tracking

Part 5 of 6 for `stock-eval` — Analyst Consensus Tracking; Risk Assessment Matrix; Output Format; Standard Signal Output
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Analyst Consensus Tracking

### Current Consensus Summary

| Metric               | Value |
|----------------------|-------|
| Buy Ratings          | X (X%) |
| Hold Ratings         | X (X%) |
| Sell Ratings         | X (X%) |
| Mean Price Target    |       |
| High Price Target    |       |
| Low Price Target     |       |
| Current Price        |       |
| Upside to Mean Target|       |
| # of Analysts        |       |

**Consensus interpretation:**
- >70% Buy with >20% upside to mean target: Strong consensus support
- Mixed ratings with tight price target range: Consensus uncertainty
- >30% Sell ratings or mean target below current price: Consensus cautious

### Estimate Revision Trend

Track the direction of earnings estimate changes over time:

| Period       | EPS Estimate (Current FY) | Change vs. 30 Days Ago | Change vs. 90 Days Ago |
|--------------|--------------------------|------------------------|------------------------|
| Current FY   |                          |                        |                        |
| Next FY      |                          |                        |                        |
| Revenue (FY) |                          |                        |                        |

- **Estimates rising**: Positive revision momentum — analysts upgrading expectations
- **Estimates falling**: Negative revision momentum — earnings risk, watch for guidance cuts
- **Stable estimates**: Predictable business with low estimate volatility

### Earnings Estimate Revision Momentum (ERM Signal)

- ERM = (Number of upward revisions − Number of downward revisions) / Total revisions over 30 days
- **ERM > +0.3**: Strong positive momentum — bullish signal
- **ERM −0.3 to +0.3**: Neutral
- **ERM < −0.3**: Negative momentum — bearish signal
- Most reliable when combined with price momentum confirmation

---

## Risk Assessment Matrix

### Business Risk

| Risk Factor        | Level (L/M/H) | Notes |
|--------------------|---------------|-------|
| Industry cyclicality |             |       |
| Competitive intensity |            |       |
| Disruption threat  |               |       |
| Customer concentration |           |       |
| Supplier concentration |           |       |
| Regulatory exposure |              |       |
| ESG / litigation   |               |       |

### Financial Risk

| Risk Factor        | Level (L/M/H) | Notes |
|--------------------|---------------|-------|
| Leverage (Net Debt/EBITDA) |       |       |
| Liquidity (Current Ratio) |        |       |
| Refinancing risk (near-term maturities) |  | |
| Covenant compliance |              |       |
| Pension obligations |              |       |
| Off-balance-sheet items |          |       |

**Leverage thresholds (Net Debt/EBITDA):**
- < 1.0x: Conservative, strong balance sheet
- 1.0–2.5x: Moderate, manageable
- 2.5–4.0x: Elevated, monitor closely
- > 4.0x: High financial risk, limited flexibility

### Valuation Risk

| Scenario                  | Implied Multiple | Notes |
|---------------------------|-----------------|-------|
| Bull case intrinsic value  |                |       |
| Base case intrinsic value  |                |       |
| Bear case intrinsic value  |                |       |
| Current market price       |                |       |
| Premium to bear case       |                |       |

- **Multiple compression scenario**: If sector re-rates to lower multiples (e.g., in rising rate environment), what is the downside?
- **Earnings miss scenario**: What happens to price if EPS misses by 10%? By 20%?
- **Sentiment shift risk**: High-multiple, high-expectation stocks carry disproportionate downside on minor guidance cuts.

### Macro Risk

| Factor              | Impact Level | Current Exposure |
|---------------------|-------------|-----------------|
| Interest rate sensitivity |       |                 |
| USD/FX exposure     |             |                 |
| Commodity cost exposure |         |                 |
| Tariff / trade risk |             |                 |
| Geopolitical exposure |           |                 |
| Regulatory / antitrust |          |                 |

---

## Output Format

Provide clear, actionable insights structured as follows:

1. **Investment Thesis Summary** (2–3 sentences capturing the core bull or bear case)
2. **Valuation Assessment**: Undervalued / Fairly Valued / Overvalued, with DCF and multiple-based support
3. **Quality Score**: Piotroski F-Score, Earnings Quality, ROIC vs. WACC verdict
4. **Management Assessment**: Capital allocator quality, guidance credibility, ownership alignment
5. **Analyst Consensus**: Current ratings, price target vs. market, estimate revision direction
6. **Key Risks**: Top 3 risks that could invalidate the thesis
7. **Price Targets**: Bull / Base / Bear case with probability weighting
8. **Recommended Entry Zone**: Based on margin of safety and technical support levels

## Standard Signal Output

All analysis concludes with this standardized block:

```

