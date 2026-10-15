# Overview

Part 1 of 4 for `position-ladder` — Overview; 1. Inputs; 2. Phase 1 — Position Control (控倉): Set the Bounds First; 3. Phase 2 — Build the Entry Ladder
See `SKILL.md` for what to read and when; this part is procedure, not routing.

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


