# ETF Analysis — What You Actually Own, and What It Costs You

## ⚠️ Data Verification — Do This Before Any Analysis

Before running any analysis, always retrieve the latest fund data for the ticker:

1. **Fetch current price and NAV** — use web search or ask the user for the live price, the fund's net asset value, and the premium/discount to NAV. Never assume a price from training data.
2. **Confirm the fund facts from the issuer** — expense ratio, index tracked, AUM, inception date, holdings count, top-10 weights, and distribution history come from the issuer's factsheet and prospectus, not from memory. Fund facts change: expense ratios get cut, indexes get swapped, funds get merged or closed.
3. **State your data source** — fill in the `Data & Sources` header (next section) so the origin, as-of date, retrieval path, and confidence of every figure are explicit at the top of the output.
4. **Flag stale data explicitly** — if live data is unavailable, display this warning before proceeding:

> ⚠️ **Live data unavailable.** The following analysis uses training-data estimates which may be significantly out of date. Verify all prices and metrics before making any decisions.

Never silently substitute training-data estimates for current fund facts. When in doubt, ask the user to paste the factsheet.

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

Most portfolios are built on an ETF core, yet every other framework in this catalog evaluates a single company. Nobody asks the questions that decide whether an ETF is a good *vehicle*: what does it cost to hold, does it deliver the index it promises, can you get out of it, what is actually inside it, and how much of it do you already own through other positions?

**This skill is due diligence on the wrapper, not a market call.** It does not predict whether US large caps will outperform; `sector-analysis` and `economics-analysis` do that. It answers: *given that you want this exposure, is this fund a fit way to get it — and is it a fit for the portfolio you already have?* The output is an **ETF Fitness Score (0–10)** built from cost, tracking, liquidity, what-you-own, overlap, distributions, and structure, plus a direct comparison against two or three peers and against simply buying the top five holdings.

**Where it sits.** `stock-screener` ranks stocks; `portfolio-review` judges the whole portfolio; `sector-analysis` picks where to be. This skill sits between them: it vets the fund that would carry the exposure, then hands the result to `portfolio-review` (does it fit the allocation?), `risk-stress-test` (what does it do in a drawdown?), and `tax-lens` (what does the wrapper cost after tax?).

---

## 1. Inputs

| Input | Required | Default if unstated |
|-------|----------|---------------------|
| ETF ticker(s) — one fund, or several to compare | ✅ | — |
| The exposure the user *thinks* they are buying ("US large cap", "global ex-US", "dividend growth") | recommended | infer from the fund name and index, and say so |
| Current holdings with weights (tickers, other funds) | optional — required for the overlap section | overlap reported as "not assessed" and its 15% weight redistributed (Phase 9) |
| Intended purchase size (as % of the post-purchase portfolio) | optional — required for post-purchase exposure | 10% of the portfolio, stated |
| Account type (taxable / IRA / non-US) | optional | taxable US assumed; state it |
| Holding horizon | optional | 5+ years |

**Overlap and tilt need holdings data.** Top-10 weights are on every factsheet; the full holdings file (issuer CSV) is needed for an exact overlap or factor tilt. If the user has not pasted it, compute from the top 10 only, label the result as a lower bound, and say what file would sharpen it.

---

## 2. Framework

### Phase 1 — Fund card

Establish the facts before any judgment:

| Field | Why it matters |
|-------|----------------|
| Issuer, ticker, inception date | Funds under 3 years old have no full-cycle record; funds under $100M AUM have closure risk |
| Index tracked (or "active") | The index *is* the strategy — read its methodology: cap-weighted? screened? rebalanced when? |
| Expense ratio (net, after waivers) and waiver expiry | A fee waiver that expires is a fee increase with a date |
| Structure: physical replication / sampling / synthetic (swap) / ETN / grantor trust / commodity pool | Determines counterparty risk, tax form, and whether "holdings" means anything |
| Legal domicile (US 1940-Act ETF, Irish UCITS, …) | Drives withholding tax and estate-tax exposure for non-US holders |
| Distribution policy (accumulating / distributing, frequency) | Matters for taxable accounts and for income users |

### Phase 2 — Cost and tracking

**Expense ratio vs. category.** Compare to the median for funds tracking the *same kind* of index, not to "all ETFs":

| Category | Cheap | Expensive | Needs a reason |
|----------|-------|-----------|----------------|
| Broad US large-cap index | ≤ 0.05% | > 0.20% | > 0.75% |
| Broad international developed / EM index | ≤ 0.10% | > 0.35% | > 0.75% |
| Sector, factor, dividend, thematic | ≤ 0.15% | > 0.50% | > 0.95% |
| Active, leveraged, inverse, alternatives | ≤ 0.50% | > 1.00% | — (the whole product needs a reason) |

**Tracking difference vs. tracking error — keep them apart.**
- **Tracking difference** = fund total return − index total return over a period. This is the *cost you actually paid*. For a well-run physical fund it should be close to −(expense ratio); a fund that trails its index by more than the expense ratio every year is leaking money (sampling, cash drag, poor securities lending, withholding tax at the fund level).
- **Tracking error** = the standard deviation of that difference. It measures *consistency*, not cost. Low tracking error with a large negative tracking difference is a fund that reliably underperforms.

Report the 1-, 3-, and 5-year tracking difference from the issuer's own performance table (NAV return vs. index return). Flag a **tracking gap** whenever |tracking difference| exceeds the expense ratio by more than 0.10% per year — and say which direction (a *positive* gap usually means securities-lending revenue, which is fine but not guaranteed).

### Phase 3 — Liquidity and closure risk

| Metric | Comfortable | Caution | Warning |
|--------|-------------|---------|---------|
| AUM | > $1B | $100M – $1B | < $100M (closure risk; issuers cull small funds) |
| Average daily $ volume | > $10M | $1M – $10M | < $1M (use limit orders, avoid the open/close) |
| Bid-ask spread (median, %) | ≤ 0.05% | 0.05% – 0.25% | > 0.25% (a round trip costs more than a year of fees) |
| Premium/discount to NAV (typical range) | ±0.10% | ±0.50% | wider, or persistently one-sided |

Note the caveat that matters: ETF liquidity comes from the underlying basket, not only from the ETF's own volume — a thinly traded ETF on liquid large caps trades fine with limit orders; a heavily traded ETF on illiquid bonds does not. Say which case applies.

### Phase 4 — What you own

- **Holdings count** and **top-10 weight**. Flag concentration when top-10 > 40% for a "broad" fund, or when a single name > 10%. Cap-weighted indexes concentrate in bull markets — a fund that was diversified five years ago may not be now.
- **Sector tilt** — the fund's sector weights vs. the broad benchmark the user thinks they are buying (e.g. the total US market). Report the three largest over/under-weights in percentage points.
- **Factor tilt** — size, value/growth, quality, momentum, low-vol, yield: which way does the index methodology lean, and does the user know it? A "dividend" fund is usually a value + low-growth tilt; an "equal-weight" fund is a small-cap tilt.
- **Country / currency exposure** for international funds — and whether the fund is currency-hedged (a bet on the dollar, held whether the user wants it or not).
- **Look-through**: if the fund holds other funds, look through to the final securities.

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

## 3. Output Format

```
Data & Sources · as of · issuer factsheet · fund prospectus · retrieval · confidence

1. Fund card          ticker · issuer · index tracked · inception · AUM · expense ratio · structure · domicile
2. Cost & tracking    expense ratio vs. category median · 1/3/5-yr tracking difference · tracking gap flag · spread · ADV
3. What you own       #holdings · top-10 weight · sector / factor / country / currency tilt · concentration flag
4. Overlap            % overlap by weight with the user's holdings · duplicated names · verdict (redundant / partial / complementary)
5. Distributions      trailing yield · composition (qualified / ordinary / ROC / gains) · capital-gains distributions (last 5 yrs) · tax form
6. Structure risks    leveraged / inverse / synthetic / ETN / single-stock / commodity / hedged / covered-call → warning box
7. Alternatives       2–3 peers in one table · "vs. top-5 holdings directly" table
8. ETF Fitness Score  0–10 with the six sub-scores and any cap that fired → Thesis Invalidation → signal block
```

When several tickers are given, produce sections 1–6 per fund compactly, then one comparison table, then one score per fund.

---

## Example

```
User: Is VOO or SPYM the better core holding? I already hold VTI at 40% of my portfolio.

The assistant builds the fund card for both (same index family — S&P 500 — so the
comparison collapses to cost, tracking, liquidity and share price), pulls the issuer
performance tables to compare 1/3/5-yr tracking difference against each fund's expense
ratio, notes that both are physical, distributing, 1099 funds with no capital-gains
distributions in the record supplied, and that either is liquid enough for any retail
order with a limit. Then it runs the overlap check against VTI: an S&P 500 fund is
roughly four-fifths of a total-US-market fund by weight, so the overlap is high and the
verdict is "redundant — you already own this exposure through VTI; adding either fund
raises large-cap concentration without adding a new bet." Both funds score well on
fitness in isolation; the report's headline is the overlap finding, and the suggested
next step is `portfolio-review` to decide whether the user actually wants *more* US
large cap, or `etf-analysis` on an international or small-cap fund instead.
```

---

## Notes

- **This is vehicle due diligence, not a market view.** Do not score the asset class. A perfectly built fund on an exposure the user should not own still gets a high Fitness Score — pair with `sector-analysis` or `economics-analysis` for whether to own it, and `portfolio-review` for how much.
- **Never invent fund statistics.** Expense ratios, AUM, tracking figures, and holdings change; if the issuer page or factsheet was not retrieved or pasted, say "not verified" rather than recalling a number.
- **Read the index methodology.** Two funds with similar names can track very different indexes (screened vs. unscreened, capped vs. uncapped, quarterly vs. annual rebalancing). The methodology document, not the fund name, is the strategy.
- **Non-US investors** (including readers using the Traditional Chinese site): a US-domiciled ETF exposes a non-resident holder to 30% (or treaty-rate) withholding on distributions and to US estate-tax exposure above a low exemption; an Irish-domiciled UCITS equivalent typically suffers 15% withholding at the fund level and no US estate-tax exposure, at a somewhat higher expense ratio and, for accumulating share classes, no distributions at all. Name the UCITS equivalent when one exists and hand the arithmetic to `tax-lens --non-us`.
- **Overlap arithmetic depends on the data supplied.** Top-10-only overlap is a lower bound; label it. Full holdings files are downloadable from every major issuer.
- **Bond, commodity, and alternative ETFs** need the extra questions this skill only flags (duration, credit quality, roll yield, collateral). Say when the fund is outside the equity-index case this framework is built for.
- Pairs with: `portfolio-review` (allocation fit), `risk-stress-test` (drawdown behaviour), `tax-lens` (after-tax cost), `sector-analysis` / `stock-screener` (whether the exposure is worth owning at all).

## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH (the fund is a fit vehicle) — the verdict breaks if:**
- The tracking difference widens beyond −(expense ratio + 0.10%) in the next annual performance table — the fund has started leaking
- The issuer changes the index, raises the fee, lets a waiver expire, or announces a merger or liquidation (AUM falling below ~$50M is the early warning)
- The fund's concentration crosses the thresholds above (top-10 > 40%, single name > 10%) so that "broad" is no longer true
- The user's other holdings change such that the overlap verdict moves from complementary to redundant

**If signal is BEARISH (the fund is not a fit vehicle) — the verdict breaks if:**
- A fee cut or a fixed tracking gap removes the cost objection (re-run against the peers)
- The user's stated exposure changes so that the tilt this fund carries is now the intended bet
- The overlap objection disappears because the duplicated position is sold
- For a structure warning: the user's horizon and purpose genuinely match the product (a multi-day hedge with an inverse fund, for example) — the warning still prints, the cap may be lifted

**Re-run this analysis when:**
- [ ] The issuer publishes its annual performance / tracking table
- [ ] Any change to expense ratio, index, or fund structure is announced
- [ ] The user adds or removes a position large enough to change the overlap verdict
- [ ] AUM falls below $100M or the spread widens persistently
- [ ] 12 months have elapsed

## Standard Signal Output

This skill measures **vehicle fitness, not market direction**, so state the mapping: `Signal: BULLISH` means the fund is a fit way to hold the stated exposure for this portfolio; `NEUTRAL` means it is acceptable but a cheaper, better-tracking, or less overlapping alternative exists (name it); `BEARISH` means do not use this wrapper (structure cap fired, redundant overlap, or a tracking gap that peers do not have). `Action: BUY` here means "this fund is fit for the purpose" — it is not a view on the asset class. Read *whether* to own the exposure from `sector-analysis` or `portfolio-review`, not from this block.

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

**Note:** The Score above is the ETF Fitness Score, mapped onto the standard scale for cross-skill comparability. It rates *how fit this fund is as a vehicle for the stated exposure and portfolio* — not how attractive the exposure is. Confidence is LOW whenever the issuer factsheet was not retrieved or the overlap was computed from the top 10 only.

**Disclaimer:** Educational analysis only. Not financial advice. Fund facts change; verify every figure against the issuer's current factsheet and prospectus before acting.
