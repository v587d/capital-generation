# 2. Framework(continued)

Part 2 of 3 for `risk-stress-test` — 2. Framework; 3. Output Format; Example
See `SKILL.md` for what to read and when; this part is procedure, not routing.

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


