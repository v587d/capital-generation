# Risk Stress Test — How Much Could This Portfolio Lose?

## ⚠️ Data Verification — Do This Before Any Analysis

Before running any analysis, always retrieve the latest market data for the ticker:

1. **Fetch current price** — use web search or ask the user for the live price of every holding, so weights are computed on today's values, not on cost basis. Never assume a price from training data.
2. **Confirm the risk inputs** — for each holding: 1-year beta to SPY, annualized volatility (σ), 30-day average daily volume (ADV) in shares and dollars, sector, and the current weight. These are the raw material of every number below; if they are missing, ask for them or state the proxy used (sector ETF beta / σ) next to the figure.
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

### Phase 4 — Correlation spike: the diversification you think you have

Diversification is measured on calm days and disappears on the days it is needed. Compute portfolio σ twice:

```
σ_p²  = Σ_i Σ_j w_i w_j σ_i σ_j ρ_ij

Normal case : ρ_ij = the pasted / retrieved pairwise correlations
              (if unavailable: 0.6 within sector · 0.35 across sectors · 0.0 vs. cash — mark "assumed")
Crisis case : ρ_ij = 0.85 for every equity pair (0.95 within sector); bonds vs. equities 0.3
              (2022-style: not the −0.3 the 60/40 model assumes)

Diversification benefit = 1 − σ_p / Σ w_i σ_i        (report for both cases)
```

| | Portfolio σ (ann.) | 1-month VaR 99 % | Diversification benefit |
|---|---|---|---|
| Normal correlations | | | |
| Crisis correlations (ρ → 0.85) | | | |

The gap between the two rows is the amount of "diversification" the portfolio will lose exactly when it is needed. A portfolio whose crisis σ is more than 1.4× its normal σ is diversified in name only.

### Phase 5 — Factor sensitivities

Three exposures that historical beta hides. Score each **Low / Medium / High** with the weight of the portfolio that carries it and the direction of the hit:

| Factor | Who gets hurt | Who benefits | Portfolio exposure | Direction of a +1 σ shock |
|--------|---------------|--------------|--------------------|---------------------------|
| **Rates ↑** (10Y +100 bp) | Long-duration growth (high P/S, distant cash flows), REITs, utilities, long bonds | Banks (NIM), insurers, cash | % of book in rate-sensitive names | est. % move |
| **USD ↑** (DXY +5 %) | Multinationals with > 40 % non-US revenue, commodity producers, EM | Domestic small caps, importers | % of book with heavy foreign revenue | |
| **Oil ↑** (WTI +25 %) | Airlines, chemicals, consumer discretionary, transports | Energy producers, oil services | % energy vs. % oil-consumers | |

Use each company's segment / geographic disclosure (10-K) for revenue exposure; use the sector as a proxy only when stated.

### Phase 6 — Liquidity: can it actually be sold?

```
Days to exit_i   = Shares held_i / (0.20 × ADV_i in shares)      (selling no more than 20 % of a day's volume)
Illiquid weight  = Σ Weight_i where Days to exit_i > 5
Portfolio exit   = the longest Days-to-exit among positions above 2 % weight
```

| Position | Shares | ADV (shares) | Days to exit @ 20 % ADV | Flag |
|----------|--------|--------------|-------------------------|------|
| … | | | | > 5 days ⚠️ · > 20 days 🔴 |

A position that takes more than a month to exit at 20 % of ADV is a private holding with a ticker. Its drawdown in Phase 2 should be widened by an illiquidity haircut (10–25 %) and said so.

### Phase 7 — Risk Budget Score (0–10)

The headline number. It measures **how far inside the stated drawdown budget the portfolio sits** — not whether the holdings are attractive.

| Component | Weight | 10 looks like | 0 looks like |
|-----------|--------|---------------|--------------|
| Worst historical scenario vs. budget | 35 % | Worst replay ≤ 60 % of the budget | Worst replay > 150 % of the budget |
| 1-month CVaR 99 % vs. budget | 20 % | CVaR ≤ 40 % of the budget | CVaR > budget |
| Correlation-spike resilience | 15 % | Crisis σ ≤ 1.2× normal σ | Crisis σ > 1.6× normal σ |
| Concentration (top-3 weight, sector max) | 15 % | Top-3 < 25 %, no sector > 30 % | Top-3 > 50 % or one sector > 50 % |
| Liquidity | 10 % | Every position exits in ≤ 2 days | > 10 % of the book needs > 20 days |
| Factor tilt | 5 % | No High exposure on any factor | High on two or more factors, same direction |

```
Risk Budget Score = Σ component score × weight        (each component scored 0–10, linearly between the anchors)
```

Map — the same bands as the standard Score Guide: **≥ 6.0 → risk within budget** (signal BULLISH; 8.0+ comfortably so) · **4.0–5.9 → at the edge** (NEUTRAL) · **< 4.0 → over budget** (BEARISH). If no budget was supplied, state the one you assumed and show how the score changes at the other two tolerance levels.

---

## 3. Output Format

1. **Data & Sources** header (above) — including the source of every β / σ / ADV and which are proxies
2. **Headline** — three lines: what the book is (β_p, largest tilts) · worst scenario in dollars vs. the budget · Risk Budget Score
3. **Exposure map** (Phase 1 table)
4. **Scenario replay** (Phase 2 table) with proxies marked
5. **VaR / CVaR** table (Phase 3) with the normal-distribution caveat stated
6. **Correlation spike** (Phase 4) — normal vs. crisis rows
7. **Factor sensitivities** (Phase 5)
8. **Liquidity** (Phase 6) with the longest exit named
9. **Risk Budget Score** table (Phase 7) and the sensitivity to the budget assumed
10. **What would bring it inside budget** — the two or three smallest changes (trim X to Y %, add Z % cash, replace A with a lower-β B) with the estimated effect on the worst scenario. Hand the *tax* cost of each to `tax-lens`; hand the *how* to `position-ladder`.
11. **Thesis Invalidation** and the **Investment Signal block**

---

## Example

```
User: Stress-test this portfolio against 2008 and 2022. $400k total. NVDA 22%, AVGO 15%,
      MSFT 15%, TSLA 12%, AMZN 10%, XOM 8%, JPM 8%, cash 10%. I can stomach a 25% drawdown.
      [pastes 1Y betas, σ, and ADV for each]

The assistant maps the book first: net β 1.28, 74% technology / consumer-tech, top-3 weight
52%, 10% cash. Scenario replay: 2008 ≈ −52% ($−208k, mostly proxy via β — none of the tech
names' 2008 paths are representative of today's businesses, and it says so); March 2020
≈ −41% in five weeks; 2022 rate shock ≈ −38% ($−152k) with TSLA (−65%) and NVDA (−50%) as the
worst positions; 2025 tariff shock flagged as the regime where AVGO / NVDA China exposure, not
beta, sets the loss — magnitude left for the reader to confirm. Parametric 1-month VaR 99% is
$−61k, CVaR 99% $−70k — a third of the 2022 replay, so the assistant tells the user to trust the
replay, not the VaR. Crisis-correlation σ is 1.5× normal σ: the seven names diversify each
other on quiet days only. Liquidity is fine (every position exits in under a day). Factor tilt:
High on rates (long-duration growth), Medium on USD, oil roughly neutral (XOM vs. AMZN/TSLA).
Risk Budget Score 3.4 / 10 — every historical scenario except a mild one breaches the 25%
budget. Smallest fixes: trim TSLA 12 → 5% and NVDA 22 → 15% into cash (worst-scenario loss
falls to ≈ −29%), or accept the tail and restate the budget at 40%. Tax cost of the trims →
tax-lens; how to execute → position-ladder.
```

---

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
