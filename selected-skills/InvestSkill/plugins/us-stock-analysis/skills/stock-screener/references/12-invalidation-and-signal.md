# Thesis Invalidation and Signal Output

Part 3 of 3 for `stock-screener` — the invalidation contract and the multi-stock signal shape
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Thesis Invalidation

A ranking is a snapshot. After the screening summary, state what would reorder it:

**The Top Pick loses its rank if:**
- Its composite falls below the #2 ticker's score on the next re-run — name the dimension most likely to slip (usually Momentum or Sentiment, which move fastest)
- Its Valuation score was carried by a single depressed multiple that mean-reverts
- A `bear-case` run on it surfaces a red flag none of the five dimensions weight (accounting quality, governance, customer concentration)

**The Avoid list is wrong if:**
- A name was penalized for a one-off (impairment, litigation charge, guidance reset) that the next quarter normalizes
- Momentum was measured across a market-wide drawdown rather than a stock-specific one

**The Market Bias flips if:**
- The average composite crosses 6.0 or 4.0 — check whether one outlier dragged it, not the universe

**Re-run this screen when:**
- [ ] Any screened ticker reports earnings
- [ ] The universe changes (add/remove a ticker — the ranking is relative)
- [ ] 30 days have elapsed (momentum and sentiment decay fastest)
- [ ] The sector or factor regime shifts (`economics-analysis` / `sector-analysis`)

---

## Standard Signal Output (Multi-Stock)

End every screening session with this standardized block reflecting the overall health of the screened universe:

```
╔══════════════════════════════════════════════╗
║           INVESTMENT SIGNAL — SCREENING SUMMARY           ║
╠══════════════════════════════════════════════╣
║ Top Pick:    [TICKER] — Score X.X / 10       ║
║ Avg Score:   X.X / 10 (screened universe)    ║
║ Tickers Screened: N                          ║
╠══════════════════════════════════════════════╣
║ Market Bias: BULLISH / NEUTRAL / BEARISH     ║
║ Best Sector: [SECTOR]                        ║
╚══════════════════════════════════════════════╝
```

Score Guide: 8.0–10.0 Strongly Bullish | 6.0–7.9 Moderately Bullish | 4.0–5.9 Neutral | 2.0–3.9 Moderately Bearish | 0.0–1.9 Strongly Bearish
Market Bias: derived from the average composite score of the screened universe. BULLISH if avg ≥ 6.0, NEUTRAL if 4.0–5.9, BEARISH if < 4.0.
Best Sector: the GICS sector with the highest average composite score across all screened tickers in that sector.

**Disclaimer:** Educational analysis only. Not financial advice.
