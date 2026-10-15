# Overview

Part 1 of 3 for `risk-stress-test` — Overview; 1. Inputs; 2. Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Overview

Every other framework in the catalog asks whether a holding is *good*. This one asks the question that decides whether the investor is still around to find out: **how much can the whole book lose, how fast, and can it be sold when it has to be?**

`portfolio-review` covers allocation, drift, and concentration. `economics-analysis` names the regime. Neither converts a list of holdings into a dollar figure for a bad month, replays the portfolio through the crashes that actually happened, or tells the investor how many days it would take to get out. This skill does exactly that and nothing else — it is a **risk report, not a recommendation**. Its verdict is a Risk Budget Score: how far the portfolio's measured risk sits inside (or outside) the drawdown the investor has said they can tolerate.

**What an assistant can and cannot compute here.** A language model cannot recall a covariance matrix for a specific set of tickers, and must not pretend to. The skill therefore works from **inputs the user pastes or the assistant retrieves** — beta, σ, ADV, weights — and shows every formula it applies, so the arithmetic can be checked line by line. Historical scenario magnitudes are approximate index-level figures and are labelled as such; the reader confirms the ones that matter.

Pairs with: `portfolio-review` (what to hold), `economics-analysis` (which regime the stress is most likely to come from), `position-ladder` (the share-count ceiling this report may lower), `thesis-tracker` (whether a drawdown is a thesis event or just volatility), and `tax-lens` (what a forced de-risking would cost after tax).

---

## 1. Inputs

| Input | Required | Default if unstated |
|-------|----------|---------------------|
| Holdings with weights (or share counts + prices) | ✅ | — |
| Per-holding beta (1Y vs. SPY), annualized σ, 30-day ADV | ✅ (paste, retrieve, or state the proxy) | sector-ETF beta / σ, flagged `proxy` |
| Total portfolio value | ✅ (for dollar figures) | express everything in % |
| Max-drawdown tolerance (the risk budget) | recommended | propose one from the investor profile: 15 % conservative · 25 % balanced · 40 % aggressive |
| Horizon | optional | 1 day and 1 month |
| Benchmark | optional | SPY |
| Cash / bonds / hedges (puts, inverse ETFs) | optional | assumed zero — say so |

Ask for missing risk inputs rather than inventing them. If the user cannot supply β or σ for a name, use the sector ETF's figures and mark every derived number `(proxy)`.

---

## 2. Framework

### Phase 1 — Exposure map (what the book actually is)

Weights first, then what they load onto:

```
Weight_i        = Value_i / Portfolio Value
β_p (net beta)  = Σ Weight_i × β_i
$-beta to SPY   = β_p × Portfolio Value          (dollar move for a 1.00 % SPY move × 100)
Sector weights  = Σ Weight_i by GICS sector      (flag any sector > 30 %)
Top-3 weight    = sum of the three largest positions
```

| Position | Weight | β | σ (ann.) | Sector | Weight × β | ADV ($) |
|----------|--------|---|----------|--------|------------|---------|
| … | | | | | | |
| **Portfolio** | 100 % | **β_p** | *(Phase 4)* | | | |

Say plainly what the book is: "this is a 1.3-beta, 62 %-technology portfolio" is more useful than any statistic that follows.

### Phase 2 — Historical scenario replay

Replay four regimes. **Measure every holding over the scenario's common date window** (the dates in the first column, index peak to index trough) — not each holding's own peak-to-trough, which would combine losses that never happened at the same time. Where a holding existed through the episode, use its actual return over that window; where it did not (or the data is not available), use **β_i × index move** or the sector ETF's return over the same window, and mark the row `proxy`. For the 2025 tariff shock, **write down the window you are using before computing** (the pre-announcement close to the trough) and confirm it with the user — it is recent enough that the dates are not yet a convention. Index magnitudes below are approximate figures for orientation — the user confirms any that drive the conclusion.

| Scenario | Market move (approx.) | Portfolio est. move | Worst position | Note |
|----------|-----------------------|---------------------|----------------|------|
| **2008 GFC** (Oct-07 → Mar-09) | SPX ≈ −57 %, ~17 months; financials −80 %+, credit frozen | Σ Weight_i × replay_i | | Long duration of decline matters as much as depth |
| **March 2020** (Feb-19 → Mar-23) | SPX ≈ −34 % in ~5 weeks; VIX > 80; everything sold at once | | | Speed: correlations went to ~1; liquidity vanished for a fortnight |
| **2022 rate shock** (Jan → Oct) | SPX ≈ −25 %; Nasdaq-100 ≈ −35 %; long-duration growth −60–80 %; bonds fell *with* stocks | | | Growth / unprofitable tech and 60/40 diversification were the casualties |
| **2025 tariff shock** (recent regime) | Sharp, policy-driven gap lower and partial recovery; magnitude and dates to be confirmed by the reader | | | Import-cost and China-revenue exposure, not beta, decided the losers |

```
Portfolio scenario move = Σ Weight_i × Replay_i
   Replay_i = actual drawdown_i          if the holding traded through the episode
            = β_i × Index move            otherwise  (mark "proxy")
Dollar loss             = Portfolio scenario move × Portfolio Value
```

Report the **worst single scenario in dollars**, and whether it exceeds the risk budget. That comparison is the headline of the report.

### Phase 3 — Parametric VaR and CVaR

```
σ_p        = portfolio σ from Phase 4 (use the "normal-correlation" figure)
VaR(α, t)  = z_α × σ_p × √t × Portfolio Value        z_95 = 1.645   z_99 = 2.326
CVaR(α, t) = (φ(z_α) / (1 − α)) × σ_p × √t × Value   CVaR_95 ≈ 2.063 σ√t · V   CVaR_99 ≈ 2.665 σ√t · V
t          = 1/252 for 1 day · 21/252 for 1 month   (σ_p is annualized)
```

| Horizon | VaR 95 % | CVaR 95 % | VaR 99 % | CVaR 99 % |
|---------|----------|-----------|----------|-----------|
| 1 day | $ / % | | | |
| 1 month | $ / % | | | |

**Say what this is and is not.** Parametric VaR assumes normally distributed returns; equity tails are fatter, so realized 99 % losses come more often and run deeper than the table implies. Present VaR as the *floor* of what a bad day looks like, and the scenario replay in Phase 2 as the more honest picture of the tail. If the two disagree by more than 2×, say so and trust the scenario.


This section is not finished here: `2. Framework` continues in `references/11-phase-4-correlation-spike.md`.
