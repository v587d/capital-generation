# Overview

Part 1 of 5 for `tax-lens` — Overview; 1. Modes; 2. Inputs; 3. Framework — US mode
See `SKILL.md` for what to read and when; this part is procedure, not routing.

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


This section is not finished here: `3. Framework — US mode` continues in `references/11-phase-3-dividends-qualified.md`.
