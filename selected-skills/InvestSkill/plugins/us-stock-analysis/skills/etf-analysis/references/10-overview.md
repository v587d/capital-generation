# Overview

Part 1 of 4 for `etf-analysis` — Overview; 1. Inputs; 2. Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

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


This section is not finished here: `2. Framework` continues in `references/11-phase-5-overlap-with.md`.
