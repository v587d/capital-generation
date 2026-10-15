# Notes

Part 3 of 3 for `risk-stress-test` — Notes; Thesis Invalidation; Standard Signal Output
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Notes

- **This is a report, not a trade list.** The Risk Budget Score says whether the risk fits the budget; deciding what to do about it belongs to `portfolio-review`, `position-ladder`, and the investor.
- **Every number is only as good as the pasted inputs.** State proxies, assumed correlations, and index magnitudes as such. If more than a third of the risk inputs are proxies, the header's Confidence is LOW regardless of source quality.
- **Scenario dates and magnitudes are approximate** orientation figures for major indices; the user confirms any that decide the verdict, especially the recent 2025 regime.
- **Options and hedges**: if the user holds puts or inverse products, model them as a negative-β sleeve with a stated hedge ratio, and note that hedges decay and roll — a hedge's protection is for the period it covers, not forever.
- **Rebalance the budget, not just the book.** A user who cannot stomach the worst historical scenario for their current book has two honest choices: less risk, or a bigger stated budget. Present both.
- Run `economics-analysis` first when the question is *which* of the four regimes is nearest; run `thesis-tracker --update` after a drawdown to separate a broken thesis from ordinary volatility.

## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH (risk within budget) — the verdict breaks if:**
- Any position drifts above the concentration anchors in Phase 7 (top-3 > 50 % or one sector > 30 %) through price appreciation alone — the book re-rates itself without a trade
- Realized 30-day correlations between the top holdings rise above 0.7 in calm markets — the crisis case is becoming the base case
- `economics-analysis` flags a regime shift toward the scenario that produced this book's worst replay (late-cycle → recession, or a renewed rate-hiking path for a long-duration book)
- ADV of any position above 5 % weight halves — the liquidity assumption no longer holds

**If signal is BEARISH (over budget) — the verdict breaks if:**
- The proposed trims / cash raise are executed and the worst-scenario replay falls inside the budget (re-run to confirm the number, not the intention)
- The user restates the drawdown budget with a written reason (horizon, income, other assets) — the score is relative to the budget, so an honest larger budget changes it
- A hedge sleeve is added with a stated ratio and roll plan that brings the crisis-correlation σ inside the anchor

**Re-run this analysis when:**
- [ ] Quarter-end, or any rebalance
- [ ] Any single position moves ±25 % relative to the portfolio
- [ ] VIX closes above 30, or the 10-year yield moves ±75 bp in a quarter
- [ ] A contribution or withdrawal larger than 10 % of portfolio value
- [ ] The investor's horizon, income needs, or stated drawdown budget change

## Standard Signal Output

This skill measures **whether the portfolio's risk fits the investor's budget, not whether its holdings will rise**, so state the mapping: `Signal: BULLISH` means the measured risk is inside the stated drawdown budget with margin; `NEUTRAL` means it sits at the edge; `BEARISH` means the worst plausible scenario breaches it. `Action: BUY` here means "the current risk level is acceptable to hold" — never "buy more." `Action: SELL` means "reduce risk," not that any holding is a short. Read the direction of the individual holdings from `stock-eval` or `bear-case`, not from this block.

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

Score Guide: 8.0–10.0 Strongly Bullish | 6.0–7.9 Moderately Bullish | 4.0–5.9 Neutral | 2.0–3.9 Moderately Bearish | 0.0–1.9 Strongly Bearish
Confidence: HIGH (strong data, clear signals) | MEDIUM (mixed signals) | LOW (limited data, conflicting signals)
Horizon: SHORT-TERM (1 week–3 months) | MEDIUM-TERM (3 months–1 year) | LONG-TERM (1+ years)

**Note:** The Score above is the Risk Budget Score, mapped onto the standard scale for cross-skill comparability. It rates *how far inside the stated drawdown budget the portfolio sits* — not how attractive the holdings are. Confidence is LOW whenever more than a third of the β / σ / ADV inputs are proxies or assumed correlations were used.

**Disclaimer:** Educational analysis only. Not financial advice. VaR, scenario replays, and drawdown estimates are models under stated assumptions; realized losses can and do exceed them.


