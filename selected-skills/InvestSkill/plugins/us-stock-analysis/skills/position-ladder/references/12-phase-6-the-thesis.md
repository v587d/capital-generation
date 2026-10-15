# 7. Phase 6 — The Thesis-Break Gate

Part 3 of 4 for `position-ladder` — 7. Phase 6 — The Thesis-Break Gate; 8. Scenario Presets; 9. Worked Example
See `SKILL.md` for what to read and when; this part is procedure, not routing.

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


