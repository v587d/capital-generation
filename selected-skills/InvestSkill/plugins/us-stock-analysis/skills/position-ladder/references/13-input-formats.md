# 10. Input Formats

Part 4 of 4 for `position-ladder` — 10. Input Formats; 11. Output Format; Notes; Signal Output; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## 10. Input Formats

### Format 1: Manage an existing position
```text
User: /position-ladder AVGO — I hold 20 shares at $128, now $122. Target 60–100 shares.

Claude builds the ladder, the trim/re-add cycle, and the total-return comparison.
```

### Format 2: Plan a new position from scratch
```text
User: /position-ladder MSFT — new position, max 5% of a $200k portfolio, ETF-style autopilot.

Claude derives the ceiling from the concentration cap and lays out the rungs.
```

### Format 3: Pasted holdings, multiple positions
```text
User: /position-ladder — here are my holdings: [paste]. Which of these should I be laddering?

Claude scores each position's Ladder Suitability and produces a plan only for those that pass the gate.
```

---

## 11. Output Format

1. **Assumptions Stated** — every input used, every default applied, and what was assumed because it was not supplied. First section, always.
2. **Position Snapshot** — current shares, average cost, market price, unrealized P&L, weight in portfolio.
3. **Position Bounds** — floor, ceiling, and which of the three caps was binding.
4. **Entry Ladder Table** — rungs, sizes, capital at full fill, blended average, drawdown to full fill.
5. **Trim / Re-Add Cycle Table** — one complete cycle with running average cost and realized P&L.
6. **Lot Accounting & Tax Notes** — lot method assumed, wash-sale flags with dates, holding-period effects.
7. **Reality Check** — total return vs. buy-and-hold across all three price paths, in dollars.
8. **Thesis-Break Gate** — the gate checklist, regime table, and the conditions that end the plan.
9. **Ladder Suitability Score** — 0–10 with the component breakdown.
10. **Investment Signal Block**.

Round share counts to whole shares (or state that fractional shares are assumed) and round rung prices to levels that can actually be entered as resting orders.

---

## Notes

- **Complements, does not replace**: run `stock-eval` or `fundamental-analysis` first to establish the thesis, `technical-analysis` for the support levels that make the best rungs, `bear-case` for the gate in Phase 6, and `portfolio-review` for the concentration cap that sets the ceiling.
- **The strategy is regime-dependent, and the regime is not knowable in advance.** Present it as a bounded, rules-based way to build a position — not as an edge that works everywhere.
- **Do not raise the ceiling mid-drawdown.** If the analysis concludes the position should be bigger, that is a new decision requiring a fresh thesis, not a ladder adjustment.
- **Fractional-share brokers change the math** — equal-dollar sizing becomes exact. Say which assumption is in force.
- Tax treatment is modeled at a high level for **US taxable accounts only**. It is not tax advice; recommend a tax professional for anything material.

## Signal Output

This skill measures **execution suitability, not price direction** — so state the mapping explicitly. The Ladder Suitability Score drives the block: a high score means staged accumulation inside the band is appropriate and the plan should be executed as modeled; a low score means the thesis, regime, or concentration test failed and the correct action is to stop adding. `Action: BUY` here means "continue laddering within the stated cap" — never "buy without limit." `Action: SELL` means the gate failed, not that a short is warranted. Read the direction of the underlying stock from `stock-eval` or `bear-case`, not from this block.

All analysis concludes with this standardized block:

```
## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH — thesis breaks if:**
- Price closes below the bottom rung on above-average volume with fundamental deterioration
- Consensus estimates are cut faster than the price falls (the stock is not getting cheaper)
- The position reaches its ceiling and the thesis gate no longer passes

**If signal is BEARISH — thesis breaks if:**
- The falsified thesis element is restored: margins re-expand, demand returns, guidance is raised
- The regime turns range-bound again (ADX falls below 25) with fundamentals stabilized
- Valuation resets low enough that a fresh-money buyer would want the full position today

**Re-run this analysis when:**
- [ ] Next earnings release
- [ ] Price moves ±15% from current level
- [ ] Any rung fills or any trim executes
- [ ] 60 days have elapsed
- [ ] Material news event (acquisition, leadership change, regulatory decision)

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

**Note:** The Score above is the Ladder Suitability Score, mapped onto the standard scale for cross-skill comparability. It rates *how appropriate staged accumulation is right now* — not how attractive the stock is. Pair it with `/stock-eval` for the directional view.

**Disclaimer:** Educational analysis only. Not financial advice. All price levels and share counts are scenario models under stated assumptions, not trade instructions.


