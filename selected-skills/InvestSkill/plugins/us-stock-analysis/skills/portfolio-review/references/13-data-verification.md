# Data Verification

Part 4 of 4 for `portfolio-review` — Data Verification; Thesis Invalidation; Standard Signal Output
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Data Verification

Before finalizing the analysis, verify:
- [ ] Position weights sum to 100% (or account for cash)
- [ ] Return figures use total return (dividends reinvested)
- [ ] Benchmark used matches portfolio's investment universe
- [ ] Correlation estimates based on at least 1 year of data
- [ ] Tax calculations use correct marginal rate for the investor
- [ ] Factor scores sourced from consistent data provider
- [ ] VaR calculation uses current portfolio weights, not stale data

## Thesis Invalidation

A portfolio review is a plan, and plans expire. After the signal, state what would make this review's action list wrong:

**If the signal is BULLISH (portfolio is well-positioned) — thesis breaks if:**
- Any single position breaches the concentration limit set in this review (state the % and the ticker)
- Realized correlation between the top holdings rises above the level assumed in the risk-budget table (diversification that only exists on paper)
- The investor's stated objective or horizon changes — a portfolio built for accumulation is wrong for drawdown

**If the signal is BEARISH (portfolio needs repair) — thesis breaks if:**
- The flagged positions are trimmed or hedged as recommended and the risk-budget table re-balances
- The concentration that drove the call resolves through price (the over-weight position falls) rather than through action — re-check before selling into weakness
- The benchmark used turns out to be the wrong universe for the mandate

**Re-run this review when:**
- [ ] Quarter-end (rebalance check)
- [ ] Any position moves more than ±25% relative to the portfolio
- [ ] A contribution or withdrawal larger than 10% of portfolio value
- [ ] Tax-year end (harvest window)
- [ ] The investor's objectives, income needs, or horizon change

## Standard Signal Output

All analysis concludes with this standardized block:

```
╔══════════════════════════════════════════════╗
║              INVESTMENT SIGNAL               ║
╠══════════════════════════════════════════════╣
║ Signal:      BULLISH / NEUTRAL / BEARISH     ║
║ Confidence:  HIGH / MEDIUM / LOW             ║
║ Horizon:     SHORT / MEDIUM / LONG-TERM      ║
║ Score:       X.X / 10                        ║
╠══════════════════════════════════════════════╣
║ Action:      BUY / HOLD / SELL               ║
║ Conviction:  STRONG / MODERATE / WEAK        ║
╚══════════════════════════════════════════════╝
```

**Score Guide**: 8.0–10.0 Strongly Bullish | 6.0–7.9 Moderately Bullish | 4.0–5.9 Neutral | 2.0–3.9 Moderately Bearish | 0.0–1.9 Strongly Bearish
**Confidence**: HIGH (strong data, clear signals) | MEDIUM (mixed signals) | LOW (limited data, conflicting signals)
**Horizon**: SHORT-TERM (1 week–3 months) | MEDIUM-TERM (3 months–1 year) | LONG-TERM (1+ years)

**Disclaimer:** Educational analysis only. Not financial advice.


