# 4. Phase 3 — The Trim / Re-Add Cycle

Part 2 of 4 for `position-ladder` — 4. Phase 3 — The Trim / Re-Add Cycle; 5. Phase 4 — Lot Accounting, Taxes & Wash Sales; 6. Phase 5 — Reality Check: Total Return vs. Average Cost
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## 4. Phase 3 — The Trim / Re-Add Cycle

Once the position is built, it oscillates inside the band.

**Trim leg** — when price trades **above blended average cost**:
- Sell the **highest-cost lots first**, one lot per pre-set level, working down toward the floor.
- Never sell below the floor share count.
- Each trim level should sit at or above the cost basis of the lot being sold, so the trim is not a forced loss.
- Recompute blended average cost after each trim and show it.

**Re-add leg** — when price trades **below the new blended average cost**:
- Buy back toward the ceiling using the same rung discipline.
- Re-add levels are set fresh from the *current* average cost, not the original ladder.
- At the ceiling, stop. Again.

**Cycle table** — the primary deliverable of this phase:

| Step | Trigger price | Action | Shares Δ | Position | Blended avg cost | Cash Δ | Realized P&L |
|------|--------------|--------|----------|----------|------------------|--------|--------------|

Show at least one full cycle: build → trim to floor → re-add to ceiling. The end state of a completed cycle in a range-bound tape is *the same share count at a lower average cost* — that, and only that, is where the strategy's edge comes from.

---

## 5. Phase 4 — Lot Accounting, Taxes & Wash Sales

This is the phase most retail versions of this strategy omit, and it is where real money leaks. Treat it as mandatory for any taxable US account.

### Lot selection matters

"Sell the highest-cost lot" is a **specific-identification** instruction. Under a broker's default **FIFO**, the *oldest* lot is sold instead — which may be the lowest-cost lot, producing the opposite tax outcome and a different average cost than the plan modeled. Flag this explicitly:

> ⚠️ This plan assumes **specific-lot identification**. Confirm your broker is not defaulting to FIFO, and select lots at the time of sale. FIFO will produce different realized P&L and a different post-trim average cost than modeled here.

### Wash sales — the structural conflict in this strategy

The trim leg can realize a **loss** (selling a high-cost lot below its cost). The re-add leg then buys the same security back at a lower price. If the repurchase happens **within 30 days before or after** the loss sale, the loss is **disallowed** under the US wash-sale rule and is instead added to the basis of the replacement shares.

The trim/re-add cycle is, by construction, a wash-sale generator. Handle it:

- **Flag every trim that realizes a loss**, and state the 30-day window in which a re-add would trigger a wash sale.
- Note the practical consequence: the loss is deferred, not destroyed — basis moves to the new shares and the holding period carries over. Cash-flow timing suffers; the economics mostly do not.
- Options: wait out the 31 days (risking the re-entry level), accept the deferral, or size the trim so it realizes a gain rather than a loss.
- Wash-sale rules also reach across accounts, including a repurchase in an IRA — where the loss is permanently lost, not deferred. Warn on this specifically.

### Holding period and account type

| Account | Tax friction | Guidance |
|---------|--------------|----------|
| **Taxable** | Full: short/long-term capital gains, wash sales apply | Model tax drag; prefer trims of lots held > 1 year; count the round-trip cost against the average-cost benefit |
| **IRA / 401(k)** | None on internal trades | The cleanest home for this strategy — cycle freely; note that realized losses are never deductible |
| **Non-US** | Varies | State that local rules were not modeled and must be checked |

Every trim resets the holding-period clock on any re-added shares. A strategy that cycles quarterly will hold mostly short-term lots — a real, quantifiable cost in a taxable account that a naive average-cost calculation hides entirely.

---

## 6. Phase 5 — Reality Check: Total Return vs. Average Cost

Mandatory section. Produce this table for the completed plan under three price paths:

| Metric | Buy-and-hold (same capital) | Ladder + trim/re-add |
|--------|----------------------------|----------------------|
| Shares held | | |
| Average cost | | |
| Realized P&L | | |
| Unrealized P&L | | |
| **Total return ($ and %)** | | |
| Est. tax drag | | |

Run it for: (a) price recovers to the original entry, (b) price rallies well above the top rung, (c) price stays below the bottom rung.

The expected pattern — state it plainly:

- **Round trip (price returns to where it started):** the cycler wins. Same shares, lower basis, positive return where buy-and-hold is flat.
- **Strong rally:** the cycler **loses**, because the trim leg sold shares that then kept appreciating. Lower average cost, fewer shares, less money. Quantify the gap in dollars — do not describe it qualitatively.
- **Continued decline:** both lose; the cycler loses *more* than a partial position but *less* than an uncapped averaging-down plan. The ceiling is what bounds the damage.

Also report **opportunity cost**: the capital parked waiting for lower rungs earned nothing (or T-bill yield) while committed to this plan.

---


