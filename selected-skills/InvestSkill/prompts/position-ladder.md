# Position Ladder — Staged Entry & Cost-Basis Management

## ⚠️ Data Verification — Do This Before Any Analysis

Before running any analysis, always retrieve the latest market data for the ticker:

1. **Fetch current price** — use web search or ask the user for the live price, 52-week range, and market cap. Never assume a price from training data.
2. **Confirm key figures** — recent earnings, revenue, key ratios (P/E, P/S, etc.) as applicable to this skill.
3. **State your data source** — fill in the `Data & Sources` header (next section) so the origin, as-of date, retrieval path, and confidence of every figure are explicit at the top of the output.
4. **Flag stale data explicitly** — if live data is unavailable, display this warning before proceeding:

> ⚠️ **Live data unavailable.** The following analysis uses training-data estimates which may be significantly out of date. Verify all prices and metrics before making any decisions.

Never silently substitute training-data estimates for current prices. When in doubt, ask the user to paste the latest quote.

---

## 📋 Data & Sources Header — Open Every Output With It

The first thing in the output is this provenance block, filled in — never left as placeholders. It is the standard documented on the [Data & Accuracy](https://yennanliu.github.io/InvestSkill/data-and-accuracy.html) page and the first thing `result-validator` looks for:

```
Data & Sources
  As of:      <date the figures represent, e.g. 2026-06-30>
  Source:     <primary docs — SEC EDGAR 10-K/10-Q, company IR, FRED, exchange data …>
  Retrieval:  <pasted by user | web/tool retrieval | model memory>
  Confidence: <HIGH | MEDIUM | LOW>
```

- `Retrieval: model memory` must be paired with `Confidence: LOW` — memory is a placeholder until confirmed against a primary source.
- Mixed sources: list each with its own as-of date rather than blending them.
- Data the user pasted is reported as `pasted by user`; do not upgrade its confidence beyond what the user's own source supports.

---

## ⚠️ Read This First — This Is Scenario Modeling, Not a Recommendation

This framework is **more prescriptive than the rest of the InvestSkill catalog**: it outputs specific price levels and share counts. Every number it produces is a **conditional plan under stated assumptions**, not an instruction to trade.

Three honest claims must appear in every output:

1. **Lowering average cost is not the same as making money.** Average cost is an accounting anchor and a psychological one — it is not a return metric. Trimming a high-cost lot mechanically lowers the number without creating a dollar of wealth. Always report **total return and realized P&L alongside average cost**, and show the buy-and-hold comparison.
2. **This is volatility harvesting.** The strategy monetizes oscillation around a level. It **outperforms in a range-bound / mean-reverting tape and underperforms in a strong trend** — in either direction. A stock that only goes up leaves the ladder underfilled; a stock that only goes down fills it and keeps falling.
3. **Position control is the actual edge.** The hard ceiling on share count — "stop adding at N shares, no matter what" — is what converts averaging down from an unbounded liability into a bounded, pre-sized bet. Without the cap, this is not a strategy; it is a mechanism for concentrating capital into losers.

State all three, then produce the plan. Never present the ladder as a way to guarantee a recovery.

---

## Overview

Answer the question the rest of the catalog does not: **"I own this — now what is my execution plan?"**

The other frameworks decide *what* to own (`stock-eval`, `fundamental-analysis`), *what it is worth* (`stock-valuation`, `dcf-valuation`), and *when* to enter (`technical-analysis`). None of them manages a position across its life. This one does. It takes a holding — or a planned holding — and produces:

- A **share-count band**: a floor (core position you always keep) and a ceiling (the hard cap on adding).
- An **entry ladder**: pre-committed rungs between today's price and the bottom of the build zone, with the size of each.
- A **trim/re-add cycle**: sell the highest-cost lots when price trades above blended average cost, buy them back below it, oscillating inside the band.
- The **accounting truth**: capital at full deployment, blended average cost at each stage, realized vs. unrealized P&L, wash-sale exposure, and the total-return comparison against simply holding.
- A **thesis-break gate**: the conditions under which the correct action is to stop laddering and exit.

This is distinct from `portfolio-review`, which operates *across* holdings (allocation, drift, concentration, tax-loss harvesting). This one operates *inside a single holding*. Use `portfolio-review` to decide how big the position may be; use this skill to decide how to get there and how to manage it once there.

---

## 1. Inputs

Collect these before modeling. Ask for anything missing rather than assuming — the plan is only as good as the position cap.

| Input | Required | Default if unstated |
|-------|----------|---------------------|
| Ticker | ✅ | — |
| Current shares held and average cost | ✅ (or 0 for a new position) | — |
| Live market price | ✅ | fetch, or ask |
| Ceiling: max shares **or** max % of portfolio **or** max dollars | ✅ | ask — never invent a cap |
| Floor: the core position never sold | — | 60% of ceiling |
| Portfolio size (for the concentration check) | — | ask; skip concentration scoring if withheld |
| Rung spacing method | — | 1.0 × ATR(14), rounded to a clean price |
| Number of rungs | — | 5 |
| Account type: taxable / IRA / 401(k) / non-US | — | taxable (the conservative assumption — full tax friction) |
| Lot-accounting method: FIFO / specific-ID / average | — | FIFO (most brokers' default) |
| Asset type: single stock / broad ETF / leveraged ETF | — | single stock (full thesis gate applies) |
| Time budget: how long you will let the ladder work | — | 2 quarters |

---

## 2. Phase 1 — Position Control (控倉): Set the Bounds First

The bounds are set **before the first share is bought**, and they are the part of the plan that does not move.

**Derive the ceiling** — take the *most restrictive* of:

- **Concentration cap**: single-position weight ≤ 10% of portfolio for a large-cap, ≤ 5% for a high-beta or single-product name (align with `portfolio-review`'s flags).
- **Capital cap**: total dollars you will commit if *every* rung fills. Compute this explicitly — the most common failure is discovering the full ladder costs more cash than exists.
- **Loss-tolerance cap**: ceiling shares × (bottom rung − plausible bear-case price). If the position filled completely and then fell to the `bear-case` target, is the dollar loss survivable? If not, the ceiling is too high.

**Derive the floor** — the share count you would still want if the stock did nothing for two years. Typically 50–70% of ceiling. The floor exists so the trim leg can never sell you out of a name you want to own.

**The cap rule (state it verbatim in the output):**

> **At the ceiling, adding stops.** Further weakness is not a reason to add beyond the cap — it is a reason to re-run the thesis gate in Phase 6. Raising the ceiling mid-drawdown is the single most common way this plan fails.

---

## 3. Phase 2 — Build the Entry Ladder

### Rung spacing

| Method | Spacing | Best for |
|--------|---------|----------|
| **Volatility-scaled** (default) | 1.0–1.5 × ATR(14) per rung | Any name — spacing adapts to how much the stock actually moves |
| **Fixed percentage** | 3–4% (mega-cap), 5–7% (mid-cap), 8–12% (high-beta) | Simple, mechanical, easy to place as resting orders |
| **Support-based** | Rungs at identified support / value-area levels | When `technical-analysis` has produced a clean support table — the highest-quality placement |
| **Fixed dollar** | Equal $ increments | Round-number psychology; only sensible for a narrow price band |

Rungs spaced tighter than ~0.5 × ATR will all fill on a single day's noise, which defeats the purpose. Rungs wider than ~2 × ATR rarely fill at all.

### Rung sizing

| Sizing | Mechanic | Effect on average cost |
|--------|----------|------------------------|
| **Equal shares** | Same share count per rung | Simplest; average cost = simple mean of rung prices |
| **Equal dollars** (preferred) | Same dollar amount per rung | Mechanically buys more shares at lower prices → average cost is always ≤ equal-shares |
| **Pyramid** | Size increases at lower rungs (e.g. 1×, 1×, 1.5×, 2×, 2.5×) | Lowest average cost, but concentrates the most capital into the deepest drawdown — requires the strongest thesis conviction |
| **Inverted (anti-)pyramid** | Size decreases lower | Do not use for accumulation; it is a scaling-out pattern |

### Required ladder math

Always compute and show:

- **Blended average cost at full fill** — Σ(rung price × rung shares) ÷ total shares.
- **Total capital at full fill** — the cash the plan demands in the worst case.
- **Drawdown to full fill** — (bottom rung ÷ current price) − 1. This is the decline the plan *expects to sit through*, stated up front.
- **Unrealized loss at full fill if price stops at the bottom rung** — ceiling shares × (bottom rung − blended average). The number the user must be able to hold without abandoning the plan.
- **Dry powder remaining** — capital not committed to this ladder, so the user sees the opportunity cost.

### The underfill problem (and its fix)

A ladder on a name in a durable uptrend never fills. The position ends at 10–20% of target and the analysis was wasted — a real cost, not a hypothetical one. Two mitigations, both stated as explicit choices:

- **Starter tranche**: deploy 30–40% of the target position at market immediately, ladder the remaining 60–70%. Guarantees meaningful exposure; costs you the better average if the dip arrives.
- **Time-based backstop**: if the ladder is still under X% filled after the stated time budget and price is above the top rung, either re-anchor the ladder upward to current price or accept the smaller position. Decide **which** in advance — this is exactly the decision emotion makes badly in the moment.

---

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

## 7. Phase 6 — The Thesis-Break Gate

A ladder is only legitimate on a name still worth owning. Without this gate, disciplined averaging down is a machine for concentrating capital into deteriorating businesses.

**Hard stop — abandon the ladder and consider exiting, do not add — if any of these fire:**

- The original investment thesis has been **falsified**, not merely delayed: structural margin compression, permanent demand loss, a broken product cycle, or the moat breached.
- Accounting or governance red flags surface (run `bear-case`; a restatement, auditor change, or aggressive revenue recognition ends the ladder).
- Leverage deterioration: covenant risk, a distressed refinancing, or dilutive emergency financing.
- The decline is **fundamental, not technical** — consensus estimates are being cut as fast as the price is falling, so the stock is not getting cheaper.
- The position has already breached the portfolio concentration cap.

**Do-not-ladder list** — asset types where this framework should refuse to produce a plan and say why:

- **Leveraged and inverse ETFs** — daily rebalancing makes them path-dependent with structural decay; averaging down compounds the decay.
- **Binary-event names** — single-drug biotechs, litigation-outcome stocks, pending all-cash acquisitions. There is no mean to revert to; the distribution is bimodal.
- **Anything where the bear case is solvency**, not valuation.

**Regime fit check** — the strategy needs oscillation:

| Signal | Favorable (ladder works) | Unfavorable (ladder misfires) |
|--------|-------------------------|-------------------------------|
| ADX(14) | < 25 — no dominant trend | > 30 — strong trend; ladder underfills or catches a falling knife |
| Price vs. MA200 | Oscillating around it | Extended far above (underfill) or in confirmed breakdown below |
| ATR as % of price | 1.5–5% — enough movement to fill rungs | < 1% — rungs never fill; > 8% — spacing must widen materially |
| Recent behavior | Range-bound, repeated tests of support | One-directional, gap-driven |

**Ladder Suitability Score (0–10)** — the skill's headline number:

| Component | Points | What earns full marks |
|-----------|--------|----------------------|
| Thesis integrity | 0–3 | Would you buy this fresh today, at this price, knowing nothing of your entry? |
| Regime fit | 0–2 | Range-bound, mean-reverting, oscillating around a level |
| Volatility adequacy | 0–2 | ATR wide enough that rungs realistically fill inside the time budget |
| Position headroom | 0–2 | Full ceiling still fits inside the portfolio concentration cap |
| Account / tax fit | 0–1 | Tax-advantaged account, or trim levels sit in gain territory |

| Score | Reading |
|-------|---------|
| 8.0–10.0 | Ladder is appropriate — execute the plan as modeled |
| 6.0–7.9 | Workable with a reduced ceiling and wider rungs |
| 4.0–5.9 | Marginal — prefer a single sized entry over a ladder |
| 0.0–3.9 | Do not ladder — the thesis, regime, or concentration test failed |

---

## 8. Scenario Presets

Match the preset to the situation, state which was applied, and show the parameters used.

| Preset | Floor / Ceiling | Rung spacing | Sizing | Thesis gate | Notes |
|--------|----------------|--------------|--------|-------------|-------|
| **Core compounder** | 60% / 100% | 3–4% or 1× ATR | Equal dollars | Full fundamental gate | Trim only above average cost; long holds favor tax-efficient trims |
| **Broad-index ETF autopilot** | 50% / 100% | 4–5% or 1× ATR | Equal dollars | None — no company thesis to break | Cleanest use case; regime and cap checks still apply |
| **High-beta single stock** | 40% / 100% | 8–12% or 1.5× ATR | Pyramid | Strict + hard stop | Smaller ceiling %, wider rungs, mandatory `bear-case` |
| **Starter + ladder (anti-underfill)** | 40% at market, ladder the rest | 1× ATR | Equal dollars | Full gate | For names that rarely pull back |
| **Underwater rescue** | Current holding / hard cap | Support-based | Equal dollars | **Mandatory re-underwrite** | Only proceed if the fresh-money test passes; otherwise this is an exit plan, not a ladder |

---

## 9. Worked Example

Position: 20 shares bought at $128. Price now $122. Target band: floor 60 shares, ceiling 100. Equal shares, $3 rungs, taxable account, specific-lot ID.

**Ladder**

| Rung | Price | Shares | Cost | Status |
|------|-------|--------|------|--------|
| 1 | $128 | 20 | $2,560 | filled (the original entry) |
| 2 | $125 | 20 | $2,500 | fills now — above market |
| 3 | $122 | 20 | $2,440 | fills now — at market |
| 4 | $119 | 20 | $2,380 | pending |
| 5 | $116 | 20 | $2,320 | pending |

Full fill: 100 shares, **$12,200** capital, blended average **$122.00**. Drawdown to full fill is **−4.9%** from today's $122 (116 ÷ 122 − 1) — that is the further decline the plan is signing up to sit through, and $4,700 of the $12,200 (rungs 4–5) is still uncommitted. Equal-*dollar* sizing of the same $12,200 would instead yield ~100.1 shares at **$121.85** — mechanically lower, always.

**Trim to floor** — price recovers: sell the $128 lot at $125, then the $125 lot at $128.

- Cash back: (20 × $125) + (20 × $128) = **$5,060**
- Realized: −$60 on the first lot, +$60 on the second = **$0 net**
- Remaining: 60 shares at $122 / $119 / $116 → average **$119.00**
- ⚠️ The $125 sale realized a **$60 loss**. Any repurchase within 30 days is a **wash sale** — the loss is disallowed and added to the replacement shares' basis.

**Re-add to ceiling** — price falls back; buy 20 at $117 and 20 at $115.

- 100 shares, total cash out **$11,780**, average **$117.80** (down from $122.00)

**Reality check at three prices**

| Price path | Buy-and-hold 100 @ $122 | Ladder + cycle |
|-----------|------------------------|----------------|
| Back to $122 | $0 | **+$420** — same 100 shares, $4.20 lower basis |
| Rallies to $140 (trimmed, never re-added) | +$1,800 | **+$1,260** — $540 worse; 40 shares were sold into the rally |
| Stalls at $115 | −$700 | −$280 on 100 shares at $117.80 |

The middle row is the honest cost of the strategy: **the lower average cost was purchased with forgone upside.** The first row is the edge. Which row you get is decided by the tape, not by the discipline.

---

## 10. Input Formats

### Format 1: Manage an existing position
```text
User: position-ladder AVGO — I hold 20 shares at $128, now $122. Target 60–100 shares.

The assistant builds the ladder, the trim/re-add cycle, and the total-return comparison.
```

### Format 2: Plan a new position from scratch
```text
User: position-ladder MSFT — new position, max 5% of a $200k portfolio, ETF-style autopilot.

The assistant derives the ceiling from the concentration cap and lays out the rungs.
```

### Format 3: Pasted holdings, multiple positions
```text
User: position-ladder — here are my holdings: [paste]. Which of these should I be laddering?

The assistant scores each position's Ladder Suitability and produces a plan only for those that pass the gate.
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

**Note:** The Score above is the Ladder Suitability Score, mapped onto the standard scale for cross-skill comparability. It rates *how appropriate staged accumulation is right now* — not how attractive the stock is. Pair it with `stock-eval` for the directional view.

**Disclaimer:** Educational analysis only. Not financial advice. All price levels and share counts are scenario models under stated assumptions, not trade instructions.
