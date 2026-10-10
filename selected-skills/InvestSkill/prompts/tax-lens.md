# Tax Lens — What You Actually Keep

> ⚠️ **This is not tax advice.** Tax law changes, thresholds are indexed, and the right answer depends on facts this skill cannot see (filing status, state, residency, other income, treaty position). Every output of this skill must open **and** close with: *"Educational illustration of how the rules generally work — confirm with a qualified tax professional before acting."* If the user asks for a filing position, a specific dollar liability to rely on, or anything about a jurisdiction outside the US mechanics described here, say so and stop.

## ⚠️ Data Verification — Do This Before Any Analysis

Before running any analysis, always retrieve the latest market data for the ticker:

1. **Fetch current price** — use web search or ask the user for the live price, 52-week range, and market cap. Never assume a price from training data.
2. **Confirm key figures** — for this skill: each lot's acquisition date, cost basis, and share count; the ex-dividend dates involved; the current tax-year brackets and thresholds (long-term capital-gains brackets, the net investment income tax threshold, the annual capital-loss limit, the non-resident estate-tax exemption). Thresholds are indexed or legislated — state the tax year you are using and ask the user to confirm.
3. **State your data source** — fill in the `Data & Sources` header (next section) so the origin, as-of date, retrieval path, and confidence of every figure are explicit at the top of the output.
4. **Flag stale data explicitly** — if live data is unavailable, display this warning before proceeding:

> ⚠️ **Live data unavailable.** The following analysis uses training-data estimates which may be significantly out of date. Verify all prices and metrics before making any decisions.

Never silently substitute training-data estimates for current prices. When in doubt, ask the user to paste the latest quote.

---

## 📋 Data & Sources Header — Open Every Output With It

Immediately after the not-tax-advice banner (which is always line one), the output carries this provenance block, filled in — never left as placeholders. It is the standard documented on the [Data & Accuracy](https://yennanliu.github.io/InvestSkill/data-and-accuracy.html) page and the first thing `result-validator` looks for:

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

For this skill the `Source:` line must also name the **tax year** and the rule sources used (IRS publications 550 / 519 / 559, the Form W-8BEN instructions, the relevant treaty table) — rules, like prices, have an as-of date.

---

## Overview

Every other framework in the catalog stops at the pre-tax number. `stock-eval` says whether to own it, `stock-valuation` what it is worth, `position-ladder` how to build the position, `dividend-analysis` how safe the payout is. None of them answers the question that decides what the investor *keeps*: **what does this trade or this portfolio cost in tax, and is there a cheaper way to do the same thing?**

This skill is that layer. Given a position, a proposed trade, or a whole portfolio with lots and dates, it works through the US mechanics that move the after-tax result — holding period, wash-sale windows, the qualified-dividend test, which lot to sell, whether a loss is worth harvesting and what to swap into, which account each asset belongs in — and estimates the annual **tax drag** the portfolio is carrying. The **`--non-us` module** switches to the rules that apply to a non-resident alien holding US stocks through a US or international broker, which differ completely from what US-centric content teaches and are almost never covered: withholding at source, the treaty rate (or the lack of a treaty), how capital gains are generally treated, the estate-tax exposure that starts far lower than for US persons, and the Irish-domiciled UCITS route many non-US investors use instead.

**What it is not.** It is not a return calculator, a filing tool, or a substitute for a professional. It does not cover state taxes, the alternative minimum tax, employer stock plans (ISOs, ESPPs, RSUs) beyond flagging them, or the investor's home-country taxation in `--non-us` mode. It names the mechanism, shows the arithmetic on the user's own numbers, and says where the professional's judgment has to take over.

---

## 1. Modes

| Mode | Invocation | Scope |
|------|------------|-------|
| **Trade** | `tax-lens AVGO — sell 20 sh bought 2026-05-30 @ $128, now $122` | One proposed sale, purchase, or swap: character of the gain/loss, wash-sale check, lot choice, timing alternatives |
| **Position** | `tax-lens AVGO` + lots | Every lot of one holding: unrealized gain/loss by lot and character, harvest candidates, when short-term lots turn long-term |
| **Portfolio** | `tax-lens --portfolio` + holdings with lots | Whole-portfolio view: annual tax drag, account placement, harvest pairs, concentration of embedded gains |
| **Non-US** | any of the above with `--non-us [country]` | Same questions for a non-resident alien: withholding, treaty rate, capital-gains treatment, estate-tax exposure, UCITS alternatives |

## 2. Inputs

| Input | Required | Default if unstated |
|-------|----------|---------------------|
| Ticker(s) | ✅ | — |
| Lots: shares, acquisition date, cost basis per lot | ✅ for Trade / Position / Portfolio | ask — without dates no holding-period or wash-sale answer is possible |
| Proposed action (sell / buy / swap, quantity, date) | ✅ for Trade | — |
| Account type per holding (taxable, traditional IRA / 401(k), Roth) | recommended | taxable |
| Filing status and approximate marginal bracket | recommended for US mode | illustrate at the 15% long-term / 24% ordinary bracket **and say so** |
| Recent sales and purchases in the same or substantially identical security (±30 days, all accounts) | required for the wash-sale check | ask |
| Country of tax residence, W-8BEN on file (yes/no), broker domicile | required for `--non-us` | ask |
| Days physically present in the US during the tax year | required for the `--non-us` capital-gains answer | if unknown, report the capital-gains treatment as **indeterminate** rather than assuming under 183 |
| Tax year | recommended | current calendar year, stated |

**Never assume a bracket silently.** If the user does not give one, run the illustration at a stated default and show how the answer changes one bracket up and down.

---

## 3. Framework — US mode

### Phase 1 — Character of the gain or loss

For each lot involved:

| Test | Rule (general) | What to output |
|------|----------------|----------------|
| Holding period | Held **more than one year** → long-term; one year or less → short-term. The clock starts the day after the trade date and includes the sale date | Days held, the date each short-term lot turns long-term, and the dollar difference between selling now and selling on that date at today's price |
| Long-term rate | Preferential brackets (generally 0% / 15% / 20% by taxable income) | Which bracket the user's stated income lands in |
| Short-term rate | Taxed as ordinary income at the marginal bracket | The marginal rate the user stated |
| Net investment income tax | An additional 3.8% on investment income above a modified-AGI threshold (not indexed; higher for joint filers) | Whether the user is plausibly above it; if unknown, show both |
| Netting | Short-term gains and losses net first, long-term net separately, then the two net against each other; up to $3,000 of net capital loss offsets ordinary income per year (**$1,500 for married filing separately**), the rest carries forward indefinitely | The user's net position after the proposed trade |

**"Wait N days" is the cheapest tax strategy there is.** Always compute it: if a lot turns long-term within ~60 days, show the tax saved at today's price and the price fall that would wipe out that saving — so the reader can weigh a tax deferral against market risk instead of ignoring one of them.

### Phase 2 — Wash-sale window check

The rule, in general terms: a **loss** is disallowed if the same or a *substantially identical* security is bought within **30 days before or after** the sale (a 61-day window, counting the sale date). The disallowed loss is not gone — it is added to the basis of the replacement shares and the holding period carries over. Gains are never washed.

Check, and state each result explicitly:

1. Any purchase of the same ticker in the 30 days **before** the loss sale (including dividend reinvestment — DRIP purchases are the classic accidental wash).
2. Any planned or automatic purchase in the 30 days **after** (DRIP, a `position-ladder` rung, an options assignment).
3. Purchases in **other accounts** — the rule applies across the investor's accounts, and a repurchase inside an IRA is treated as permanently losing the loss (the basis adjustment has nowhere to go).
4. Substantially identical: same ticker, options on it, convertible into it — yes. A different company in the same industry — no. Two index funds tracking the **same index** — unsettled and conservative practice treats them as risky; two funds tracking **different indexes** — the common practice for harvesting.

Output a 61-day timeline with the sale in the middle and every purchase marked ✓ safe / ✗ wash / ⚠️ scheduled.

### Phase 3 — Dividends: qualified or not

| Question | General rule |
|----------|--------------|
| Is the payer eligible? | US corporations and qualified foreign corporations — yes. REITs, most MLPs, money-market and bond-fund income — generally **not** qualified (REIT ordinary dividends may qualify for a separate 20% deduction instead) |
| Did the holder meet the holding period? | The stock must be held **more than 60 days during the 121-day period that begins 60 days before the ex-dividend date**. Hedged shares (deep puts, short calls) can fail the test |
| What is the consequence? | Qualified → long-term capital-gains rates. Not qualified → ordinary income |

For a dividend payer, show the ex-dividend dates in the period, whether each lot passes the test, and the after-tax yield at the user's bracket — that is the number `dividend-analysis` cannot give.

### Phase 4 — Which lot to sell

| Method | When it helps | Caveat |
|--------|---------------|--------|
| **Specific identification** | Almost always — choose the lot that produces the character and size of gain/loss you want | Must be designated **at or before the trade**, in the form the broker accepts; a retroactive choice is not allowed |
| FIFO (default at most brokers) | Long-held, low-basis lots first — largest gains | Often the worst choice for a partial sale in a rising stock |
| Highest cost first (HIFO) | Minimizes the current gain or maximizes the harvested loss | May realize short-term gains; check character, not just size |
| Lowest cost first | Deliberately realizing gains in a 0% bracket year, or before a rate change | Rare, but real |

Produce the lot table: lot · shares · basis · gain/loss · character · days to long-term · **recommended for this trade?** — and the total tax at the user's bracket under FIFO vs. the recommended specific lots.

### Phase 5 — Tax-loss harvesting pairs

For every lot with an unrealized loss above a materiality floor (state it, e.g. the larger of $500 or 5% of the lot):

- **Value of the harvest** = loss × the rate it offsets (short-term losses are worth more when they offset short-term gains or ordinary income).
- **Replacement**: name a *similar-but-not-substantially-identical* holding that keeps the exposure for the 31 days (a different index or a peer, never the same ticker or an option on it). Say what the tracking difference costs.
- **The reversal**: after 31 days, whether to swap back (a new taxable event) or keep the replacement.
- **Basis reset warning**: harvesting lowers basis — the tax is deferred, not eliminated, unless the position is held until a step-up or a donation.

### Phase 6 — Account placement

General placement logic, shown as a table of the user's holdings:

| Asset behaviour | Taxable account | Tax-deferred (traditional IRA / 401(k)) | Tax-free (Roth) |
|-----------------|-----------------|------------------------------------------|-----------------|
| Broad, low-turnover equity index; individual stocks held long | ✅ best — long-term rates, harvesting possible, step-up | fine | fine |
| Bonds, REITs, high-yield, high-turnover active funds | ✗ ordinary income every year | ✅ | ✅ |
| Highest expected growth | ok | ok | ✅ best — growth never taxed |
| Foreign equity funds with withholding | ✅ (the foreign tax credit is only available here) | ✗ credit lost | ✗ credit lost |

Flag every holding sitting in the wrong column and estimate the annual cost of leaving it there.

### Phase 7 — Annual tax drag

```
Tax drag (% of portfolio per year) ≈
    Σ weight_i × [ yield_i × ( qualified_i × LTCG rate + (1 − qualified_i) × ordinary rate ) ]
  + realized-gain turnover × blended gain rate
  + non-qualified income (bond interest, REIT) × ordinary rate

Scope — the terms are disjoint: yield_i is the dividend yield of the *equity* holdings only
(stocks and equity funds), split into its qualified and non-qualified parts; the third line
covers income that is never a qualified dividend (bond and money-market interest, REIT and
MLP distributions), so it is not counted in yield_i as well.
```

Report the drag in percentage points and dollars, the three largest contributors, and the drag after the Phase 5–6 changes. State the assumed rates in the table, not in prose.

---

## 4. Framework — `--non-us` module (non-resident alien holding US stocks)

The mechanics below describe the **US side only**. The investor's country of residence taxes the same income under its own rules, and that is out of scope — say so in the output.

### Phase 1 — Status and paperwork

- **W-8BEN** certifies non-US status and claims any treaty rate. It is generally valid until the end of the **third calendar year** after signing; an expired form means the broker withholds at the statutory rate (and may apply backup withholding). Output: on file? expiry year? treaty article claimed?
- **Form 1042-S** is the year-end statement of US-source income and tax withheld — the document to reconcile against, and often the one the home-country return needs.
- If the user says they are a US citizen or green-card holder living abroad, **stop the `--non-us` module**: they are taxed as US persons worldwide, and non-US funds (UCITS) raise PFIC issues for them. Point back to US mode.

### Phase 2 — Dividends: withholding and the treaty rate

| Item | General rule | Output |
|------|--------------|--------|
| Statutory withholding on US-source dividends | **30%**, withheld by the broker or paying agent at source | Effective yield after withholding |
| Treaty rate | Reduced (commonly 15%, some treaties 10% or lower) **only** if the residence country has an income-tax treaty with the US and a valid W-8BEN claims it | Name the treaty and the article, or state clearly that **no treaty exists** (for example Taiwan, Hong Kong, Singapore have no US income-tax treaty, so 30% applies) |
| Fund distributions | Ordinary dividends withheld as above; the treatment of short-term / long-term capital-gain and return-of-capital distributions differs — reconcile against the 1042-S rather than assume | Flag distribution types |
| Interest | Portfolio interest (Treasuries, most corporate bonds) is generally **exempt** from US withholding | Note where relevant |
| Derivatives on US equities | Dividend-equivalent payments on certain swaps and deep-in-the-money options can be withheld as if dividends (Section 871(m)) | Flag if the user trades options on dividend payers |

**After-withholding yield** is the headline number: a 3.0% dividend yield is 2.1% to a no-treaty holder and 2.55% at a 15% treaty rate. `dividend-analysis` reports the gross figure; this section converts it.

### Phase 3 — Capital gains

US capital gains on stocks are **generally not taxed by the US** for a non-resident alien. State the general conditions and the exceptions rather than a blanket promise:

- The general exemption applies when the individual is **not present in the US for 183 days or more** in the tax year and the gain is not effectively connected with a US trade or business. The day count is an input, not an assumption — if the user has not supplied it, state the treatment as **indeterminate** and show both outcomes.
- **Exceptions**: gains effectively connected with a US business; gains on **US real property interests** (including certain REITs) under FIRPTA, which are taxed and often withheld; and any home-country tax on the same gain, which is the rule that actually matters for most investors.
- Losses cannot be used against US tax the investor does not owe — the harvesting logic of US mode is **irrelevant** here except for the home-country return. Say so; do not port Phase 5 across.

### Phase 4 — US estate-tax exposure

This is the item most non-US investors have never heard of, and the one with the largest tail:

- US-situs assets of a non-resident alien — **US-domiciled stocks and US-domiciled ETFs** count; US Treasury bonds, bank deposits, and shares of non-US companies (including ADRs of foreign issuers) generally do not — are subject to US estate tax above an exemption of only **$60,000** (not the multi-million exemption US persons have), at rates that reach **40%**, unless an estate-tax treaty provides otherwise (only a minority of countries have one; Taiwan, Hong Kong, and Singapore do not).
- Output: the user's US-situs total today, the excess over $60,000, an illustrative exposure at the statutory brackets, and the two standard mitigations — holding the same exposure through **non-US-domiciled funds** (Phase 5) or estate planning structures that are entirely a professional's domain.
- Brokers may freeze the account pending a US estate-tax clearance; mention it as a practical consequence, not as advice.

### Phase 5 — Irish-domiciled UCITS alternatives

The common route for non-US investors, with an honest cost/benefit table:

| Dimension | US-domiciled ETF (e.g. an S&P 500 ETF listed in New York) | Irish-domiciled UCITS ETF (same index, listed in London / Amsterdam / Frankfurt) |
|-----------|------------------------------------------------------------|-----------------------------------------------------------------------------------|
| Dividend withholding | 30% (or treaty rate) at the investor level | **15% at the fund level** under the US–Ireland treaty; no further Irish withholding on distributions to non-Irish holders |
| Accumulating share class | Not available (US funds must distribute) | Available — reinvests inside the fund; whether the home country taxes the notional income is a **home-country** question |
| US estate tax | US-situs — exposed above $60,000 | **Not US-situs** — outside the US estate-tax net |
| Expense ratio and spread | Usually lower TER, tighter spreads, deepest liquidity | Typically a few basis points higher TER and wider spreads; some are large and liquid, many are not |
| Tracking | Benchmark | Slightly lower drag from the 15% fund-level withholding vs. 30% at investor level — for a no-treaty investor the UCITS fund often **wins after tax despite the higher TER** |
| Access | Any broker | Needs a broker with European exchange access; US brokers generally will not sell UCITS to anyone, and US persons should not buy them (PFIC) |

Show the arithmetic for the user's own case: gross yield → after-withholding yield under both routes → net of the TER difference → the estate-tax exposure difference. Hand the result to `etf-analysis` for the fund-level comparison.

---

## 5. Scoring — Tax Efficiency Score (0–10)

The headline number measures **how tax-efficient the trade or portfolio is as specified**, not whether the investment is good.

| Component | Weight | 10 looks like | 0 looks like |
|-----------|--------|---------------|--------------|
| Character & timing | 30% | Gains long-term, losses short-term; no lot turns long-term within 60 days of a proposed short-term sale | Large short-term gains realized days before turning long-term |
| Wash-sale hygiene | 20% | No purchases in the 61-day window across any account | A harvested loss disallowed by a DRIP or IRA repurchase |
| Lot selection | 15% | Specific-ID chosen and designated | FIFO by default on a partial sale of a long-held winner |
| Account placement | 15% | Every holding in the right column | Bond funds and REITs in taxable, growth in traditional IRA |
| Harvest capture | 10% | Material losses harvested into non-identical replacements | Losses left on the table in a high-gain year |
| Drag & paperwork | 10% | Drag below ~0.5% / yr; W-8BEN current and treaty claimed (non-US) | Drag > 1.5% / yr; expired W-8BEN, statutory withholding, unaddressed estate exposure |

In `--non-us` mode, replace "Harvest capture" with **Estate-tax exposure** (10 looks like: US-situs holdings below the exemption or moved to non-US-domiciled funds; 0: a large US-situs portfolio with no plan).

---

## 6. Output Format

1. **Not-tax-advice banner** (verbatim, first line)
2. `Data & Sources` header — including the tax year and rule sources
3. **Executive summary** — three sentences: the tax cost of the action as specified, the cheapest alternative, and the one thing to confirm with a professional
4. **Lot table** (Trade / Position / Portfolio) — lot · shares · basis · gain/loss · character · days to long-term · recommended?
5. **Wash-sale timeline** — 61-day window with every purchase marked
6. **Dividend test** — ex-dates, holding-period pass/fail, after-tax yield (or after-withholding yield in `--non-us`)
7. **Alternatives table** — "as specified" vs. "wait N days" vs. "specific lots" vs. "harvest & replace", each with estimated tax and market-risk trade-off
8. **Placement & drag** (Portfolio mode) — misplaced holdings, drag before / after
9. **`--non-us` block** — W-8BEN status, treaty or no-treaty rate, capital-gains treatment with exceptions, estate-tax exposure, UCITS comparison
10. **Thesis Invalidation** — what would change this analysis (below)
11. **Investment Signal block** — the standard box (below)
12. **Not-tax-advice banner** (verbatim, last line)

---

## Example

```
User: tax-lens AVGO — I hold 20 sh bought 2026-05-30 @ $128 (taxable) and 10 sh bought
      2025-08-14 @ $96. Price $122. I want to sell 15 shares and rebuy lower with the
      position-ladder plan. 24% bracket, single, DRIP is on.

The assistant opens with the not-tax-advice banner and a Data & Sources header (tax year 2026,
IRS Pub 550, prices pasted by user). Lot table: the 2026 lot shows a $6/sh short-term loss;
the 2025 lot a $26/sh long-term gain that has already passed one year. Selling 15 from the
2026 lot by specific identification realizes a $90 short-term loss; FIFO would instead sell
the 10 long-term gain shares first (+$260 gain, ~$39 tax at 15%) plus 5 loss shares. The
wash-sale timeline flags two problems: DRIP reinvested a dividend on 2026-06-30 (inside the
window — part of the loss is disallowed and added to those shares' basis) and every
position-ladder rung inside the next 30 days would wash the rest. Alternatives: turn DRIP
off and place the first rung on day 31; or accept the wash (the loss moves into the basis of
the re-bought shares and is not lost, only deferred). Tax Efficiency Score 4.5 → NEUTRAL:
the plan is fine once the DRIP and rung timing are fixed. Closes with the banner.

User: tax-lens --non-us Taiwan — I hold $180k of VOO and $40k of AAPL at a US broker,
      W-8BEN signed 2023.

The assistant states that Taiwan has no US income-tax treaty, so dividends are withheld at 30%
(VOO's ~1.3% gross yield → ~0.9% net); the W-8BEN signed in 2023 expires at the end of 2026
and must be renewed or withholding may rise further; US capital gains are generally not taxed
by the US for a non-resident (conditions and exceptions stated) but Taiwan's own rules apply;
US-situs assets total $220k, $160k above the $60k exemption — an illustrative estate-tax
exposure it quantifies at the statutory brackets — and shows the Irish-UCITS comparison for
the VOO sleeve (15% fund-level withholding, no US estate exposure, ~0.03–0.05% higher TER).
Score 3.5 → BEARISH on tax efficiency as held; the investment view is unchanged. Recommends a
cross-border professional for the estate question. Closes with the banner.
```

---

## Notes

- **Rules move.** Brackets and thresholds are indexed annually; the wash-sale rule, the qualified-dividend test, and the treatment of non-resident capital gains have all been the subject of proposals. State the tax year, cite the publication, and tell the user to confirm.
- **Never compute a liability to be relied upon.** Show the mechanics on the user's numbers as an illustration and label it as such.
- **Out of scope, always flagged**: state income tax, AMT, employer equity (ISO/ESPP/RSU) beyond identifying it, trusts and entities, the home-country side of `--non-us`, and gifting/inheritance planning.
- **Pairs with**: `position-ladder` (rung timing vs. the wash window; the ceiling vs. concentration of embedded gains), `portfolio-review` (placement), `dividend-analysis` (gross yield in, after-tax yield out), `etf-analysis` (US vs. UCITS fund comparison), `risk-stress-test` (what a forced de-risking would realize).
- **For the zh-TW audience**: Taiwan has no US income-tax or estate-tax treaty; the 30% withholding, the $60,000 estate exemption, and the UCITS route are the three facts that change the arithmetic most. Home-country reporting of overseas income is a Taiwan tax question this skill does not answer.

## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH (tax-efficient as specified) — the assessment breaks if:**
- A purchase of the same security lands inside the 61-day window (DRIP, a ladder rung, an assignment) and washes a loss the plan relied on
- The user's bracket, filing status, or residency changes — every rate in the table moves with it
- A rule the analysis leaned on changes (rate brackets, the wash-sale scope, treaty status, the estate exemption) — re-run against the new tax year

**If signal is BEARISH (tax-inefficient as specified) — the assessment breaks if:**
- The market moves enough that the tax saving from waiting is smaller than the price risk of waiting — the "wait N days" table shows the break-even fall; below it, sell
- The user has offsetting losses or a low-income year that changes the character math (a 0% long-term bracket year makes realizing gains *desirable*)
- The broker confirms specific-ID designation or a treaty rate the analysis assumed was unavailable

**Re-run this analysis when:**
- [ ] A short-term lot is within 60 days of turning long-term
- [ ] Before any sale at a loss, and 31 days after it (the window closes)
- [ ] Each ex-dividend date for holdings where the qualified test is close
- [ ] Year-end (harvest window) and the new tax year (indexed thresholds)
- [ ] W-8BEN expiry year, a change of residence, or a change in treaty status (`--non-us`)

## Standard Signal Output

This skill measures **tax efficiency of the action or portfolio as specified, not the merit of the investment**, so state the mapping: `Signal: BULLISH` means proceed as planned from a tax standpoint; `NEUTRAL` means the same trade should be done differently (lot choice, timing, account); `BEARISH` means the action as specified is tax-inefficient (a wash, a short-term gain days from long-term, a large avoidable withholding or estate exposure). `Action: BUY / HOLD / SELL` refers to **the tax plan** — adopt it / adjust it / abandon it — never to the stock. Read the investment view from `stock-eval`, `dividend-analysis`, or `etf-analysis`.

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

**Note:** The Score above is the Tax Efficiency Score, mapped onto the standard scale for cross-skill comparability. It rates *how much of the pre-tax result the plan keeps* — not how attractive the security is. Confidence is capped at MEDIUM whenever the user's bracket, residency, or lot dates were assumed rather than supplied.

**Disclaimer:** Educational analysis only. Not financial advice, and **not tax advice** — an illustration of how the rules generally work, for a stated tax year, on the user's own numbers. Tax law changes and depends on facts this skill cannot see. Confirm with a qualified tax professional before acting.
