# 2. Framework(continued)

Part 2 of 4 for `etf-analysis` — 2. Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### Phase 5 — Overlap with the user's other holdings

With the holdings the user supplied, compute **overlap by weight**:

1. **Look through** every existing fund position to its underlying securities (top holdings from the issuer's factsheet; label the coverage — "top 10 = 34% of the fund" — so the reader knows the rest is unassessed). Existing single stocks are their own exposure.
2. Express both sides as weights of the **same denominator**: the candidate ETF's holdings as % of the ETF; the existing portfolio's look-through exposures as % of the existing portfolio.
3. **Overlap % = Σ over shared securities of min(weight in ETF, weight in existing portfolio).** This is the share of the ETF that duplicates what the user already owns, on a like-for-like basis.
4. With the **intended purchase size** *p* (as % of the post-purchase portfolio; default 10%, stated), compute the post-purchase exposure to each shared name: (1 − p) × existing weight + p × ETF weight.

Report:

- Overlap % (by weight) and the duplicated names, largest first; the look-through coverage used.
- The *effective* post-purchase exposure to the top duplicated names (e.g. "at a 10% purchase you would own the largest holding through three vehicles at a combined 11% of the portfolio").
- A plain verdict: **redundant** (> 60% overlap — this is the same bet in a second wrapper), **partially overlapping** (25–60% — fine if intentional), **complementary** (< 25%).

Without a holdings file, report the top-10-only overlap as a lower bound and say so.

### Phase 6 — Distributions and taxes

- Trailing 12-month distribution yield and its **composition**: qualified dividends, non-qualified income, return of capital, capital gains. REIT-, bond-, and commodity-heavy funds pay mostly non-qualified income taxed at ordinary rates.
- **Capital-gains distributions, last 5 years.** Most equity ETFs distribute none, because in-kind creation/redemption lets them hand appreciated shares to authorized participants instead of selling them; a mutual fund cannot. An equity ETF that *has* distributed gains (heavy rebalancing, index reconstitution, small AUM with big redemptions) deserves a note. Bond and commodity funds are a different matter.
- **Tax form**: 1099 for ordinary ETFs; **K-1** and 60/40 treatment for many commodity and volatility funds structured as partnerships; grantor-trust rules for physically backed metals. A K-1 is a paperwork and timing cost, not just a tax rate.
- Hand the detail to `tax-lens` — this skill flags, that one computes.

### Phase 7 — Structure warnings

State any that apply, in a box the reader cannot miss:

| Structure | Warning to print |
|-----------|-----------------|
| Leveraged (2×, 3×) or inverse | Resets daily. Over more than a day, path dependence ("volatility decay") means the return is *not* 2× or −1× the index. A holding tool for days, not years — say so even if the user asked for a long-term view |
| Synthetic / swap-based | The fund holds a swap, not the securities. Counterparty exposure to the swap provider; "holdings" listed are collateral |
| ETN | An unsecured note issued by a bank. If the issuer fails, the ETN fails, regardless of the index. Check the issuer's credit and whether the ETN is still creating shares (closed ETNs trade at wild premiums) |
| Single-stock ETF | A leveraged or option-overlaid position in one company. Concentration + decay + fees — nearly always dominated by owning the stock |
| Commodity pool / futures-based | Roll yield (contango) can make the fund diverge sharply from spot; K-1 tax form; not an investment in the physical commodity |
| Currency-hedged | Embeds a short position in the foreign currency; hedging cost ≈ the interest-rate differential |
| Covered-call / buffer / defined-outcome | Caps upside by design; the "yield" is option premium, partly return of your own capital. Compare total return, never headline yield |
| Actively managed | Compare to the cheapest index fund in the same category over the manager's tenure, not to the category average |

### Phase 8 — Alternatives and the direct-ownership check

- **Peers**: two or three funds tracking the same or a very similar index. Compare expense ratio, 3-yr tracking difference, AUM, spread, and structure in one table. Prefer the cheapest fund with the smallest tracking gap and adequate liquidity — everything else is marketing.
- **ETF vs. buying the top 5 holdings directly**: what share of the fund's weight the top 5 represent, the fund's fee on that share, what the investor would give up (the other N−5 holdings, rebalancing, dividend reinvestment convenience) and what they would gain (zero ongoing fee, tax-lot control, no tracking gap). For a broad fund with top-5 weight under 25%, direct ownership is a different, more concentrated bet — say so. For a "sector" fund where the top 5 are 60%+ of the weight, direct ownership is a serious alternative.

### Phase 9 — ETF Fitness Score (0–10)

The headline number. It measures **fitness of the vehicle for the stated exposure and portfolio**, not the attractiveness of the asset class.

| Component | Weight | 10 looks like | 0 looks like |
|-----------|--------|---------------|--------------|
| Cost & tracking | 25% | Cheapest quartile for its category; tracking difference ≈ −ER with no gap | Expensive for the category *and* a tracking gap > 0.25%/yr |
| Liquidity & viability | 15% | AUM > $1B, spread ≤ 0.05%, tight to NAV | AUM < $100M or spread > 0.25% or persistent discount |
| What you own vs. what you wanted | 20% | Index methodology matches the stated exposure; tilts disclosed and acceptable | The fund is a different bet than the user thinks (hidden factor/country/currency tilt, top-10 > 50%) |
| Overlap with existing holdings | 15% | < 25% overlap, or overlap is intentional | > 60% overlap — a duplicate position |
| Distribution & tax efficiency | 10% | No capital-gains distributions; income mostly qualified; 1099 | Regular gains distributions; K-1; non-qualified income in a taxable account |
| Structure | 15% | Plain physical replication | Leveraged/inverse, ETN, or single-stock held as a long-term position |

**Hard caps**: a leveraged/inverse/single-stock fund evaluated for a horizon longer than a few weeks caps at **3.0**; an ETN caps at **5.0**; > 60% overlap caps at **5.0**. State any cap that fired.

**When overlap is not assessed** (no holdings supplied): drop the component and **renormalize the remaining five weights to 100%** (Cost & tracking 29.4% · Liquidity 17.6% · What you own 23.5% · Distribution 11.8% · Structure 17.6%), print `Overlap: not assessed — supply holdings for the full score` under the score, and cap Confidence at MEDIUM. Never score an unassessed component as 10 or as 0.

---


