# ETFs & Index Investing

> Most portfolios are built on a core of index funds, and most beginners buy that core without understanding what is inside it. This lesson explains what an ETF actually is, what it costs (the visible fee and the invisible one), how to check that it tracks what it promises, what you really own once you hold three of them, and which fund structures are traps for a long-term holder.

**What you'll learn**

- What an ETF is, how it differs from a mutual fund, and why the mechanics make it tax-efficient
- Why the expense ratio matters far more than it looks — and why it is not the whole cost
- Tracking difference vs. tracking error, and the gap that signals a leaky fund
- How to read liquidity: assets, volume, spread, premium/discount, closure risk
- What you actually own — holdings count, top-10 weight, hidden tilts, and overlap across funds
- Core-satellite construction, and when a single stock beats an ETF
- The structures to avoid as a long-term holder: leveraged, inverse, synthetic, ETNs, single-stock, K-1 commodity funds

---

## What an ETF is

An **exchange-traded fund (ETF)** is a basket of securities — hundreds or thousands of stocks, bonds, or other assets — wrapped into a single share that trades on an exchange like a stock. You buy one share of an S&P 500 ETF and you own a sliver of all 500 companies, in the index's proportions, for one commission-free trade.

Compared with a traditional **mutual fund**, three mechanics differ:

| | ETF | Mutual fund |
|---|---|---|
| **Trading** | Intraday on an exchange, at the market price, with a bid-ask spread | Once a day at the closing net asset value (NAV), directly with the fund |
| **Creation / redemption** | Large dealers swap baskets of stock for ETF shares **in kind** — no cash sale inside the fund | The fund sells holdings for cash when investors redeem |
| **Tax consequence** | In-kind redemption means the fund rarely realizes gains, so holders rarely receive capital-gains distributions | Redemptions can force sales; remaining holders get the taxable distributions |

That in-kind mechanism is why a plain index ETF is one of the most tax-efficient ways to hold stocks: you decide when to realize gains by selling *your* shares, rather than inheriting other investors' tax bills.

> **Key idea:** An ETF is a wrapper. Everything that matters — cost, tracking, what is inside, how it is structured — is about the wrapper *and* the contents. Judge both.

### Index vs. active

An **index fund** holds whatever a published index holds, in the index's weights, and charges very little to do so. An **active fund** pays a manager to pick. Over long periods most active stock funds have lagged their benchmark after fees, and the ones that will beat it are hard to identify in advance. For a beginner's core, the index route is the sensible default; active bets belong in the satellites (below), sized so they cannot hurt.

---

## The visible cost: expense ratio

The **expense ratio** is the annual fee deducted from the fund's assets — you never see a bill, it simply comes out of the return. It looks trivial and compounds like everything else.

### A worked illustration (illustrative, rounded)

$10,000 invested for 20 years, the underlying index returning 7% a year before fees:

| Expense ratio | Return after fees | Value after 20 years | Cost of the fee |
|---|---|---|---|
| 0.03% (a broad US index ETF) | 6.97% | ≈ $38,500 | ≈ $200 |
| 0.20% | 6.80% | ≈ $37,300 | ≈ $1,400 |
| 0.75% (a typical active or thematic fund) | 6.25% | ≈ $33,600 | ≈ $5,100 |

The 0.75% fund handed away about **13% of the final value** for the same underlying exposure. Rules of thumb: a broad US or developed-market index fund above ~0.20% is expensive for what it does; anything above ~0.75% needs a specific reason (a niche market, a strategy you cannot get cheaper).

---

## The invisible cost: tracking difference vs. tracking error

An index fund's job is to deliver the index's return. Two measures tell you how well it does, and they are often confused:

- **Tracking difference** = fund return − index return over a period (1, 3, 5 years). For a well-run fund it should be roughly **minus the expense ratio**: the fee is the only thing standing between you and the index.
- **Tracking error** = the *volatility* of that difference — how erratically the fund wanders around the index day to day. Useful for traders; for a long-term holder, the *difference* is what costs money.

> **Key idea:** If a fund charges 0.10% but lags its index by 0.40% a year, something else is leaking — sampling, poor securities lending, cash drag, or a badly timed rebalance. A tracking difference worse than −(expense ratio + ~0.10%) is a flag. Check it in the issuer's own performance table, not in a headline.

---

## Liquidity: can you get in and out?

| Measure | Why it matters | Rule of thumb |
|---|---|---|
| **Assets under management (AUM)** | Small funds close; a closure forces a taxable sale at a time you did not choose | Under ~$100M is closure risk; over $1B is comfortable |
| **Average daily volume (ADV)** | How easily your order fills without moving the price | Your position should be a small fraction of a day's volume |
| **Bid-ask spread** | The round-trip cost of trading, paid every time | ≤ 0.05% on a large fund; > 0.25% eats into a long-term return quickly |
| **Premium / discount to NAV** | The market price vs. the value of the holdings | Persistent gaps on a liquid fund mean something is wrong; on an illiquid one, you are paying for the illiquidity |

A limit order, placed while the underlying market is open, removes most of the spread risk (see Lesson 9).

---

## What you actually own

The fund name tells you the theme. The **holdings** tell you the truth.

- **Holdings count and top-10 weight.** A "broad" fund whose top 10 names are 40% of the assets is a concentrated bet on ten companies. Cap-weighted indexes concentrate *more* in bull markets, because the winners grow into a larger share of the index — a fund that was diversified five years ago may not be today.
- **Sector tilt.** Compare the fund's sector weights with the total market. A US large-cap index fund is heavily technology; a "dividend" fund is usually a value + low-growth tilt; an "equal-weight" fund is a small-cap tilt.
- **Factor and country tilt.** Size, value/growth, quality, momentum; for international funds, which countries and whether the currency is hedged (a hedged fund is also a bet on the dollar, held whether you wanted it or not).

### Overlap: the same stocks through three doors

Owning three funds does not mean three times the diversification. **Overlap** is the share of one fund that duplicates what you already hold. A tiny example (illustrative, rounded):

| Stock | Weight in your S&P 500 ETF | Weight in your "tech" ETF | Overlap (the smaller of the two) |
|---|---|---|---|
| Mega-cap A | 7% | 22% | 7% |
| Mega-cap B | 6% | 20% | 6% |
| Mega-cap C | 5% | 12% | 5% |
| … | | | |
| **Total overlap** | | | **≈ 45%** |

Nearly half of the "tech" fund is the same bet you already own through the index fund. Add a few single mega-cap stocks and your real exposure to two or three companies can quietly reach 15–20% of the portfolio.

*In the plugin:* `etf-analysis` computes overlap by weight against the holdings you paste, reports the duplicated names, and shows the post-purchase exposure to each.

---

## Core and satellites

A practical structure:

- **Core (say 70–90%)** — one or two broad, cheap, well-tracking index funds: total US market or S&P 500, plus international if you want it. This is the part that should be boring.
- **Satellites (the rest)** — deliberate, sized bets: a sector, a factor, a handful of single stocks you have actually analyzed. Each small enough that being wrong is survivable (Lesson 6's concentration cap applies).

### When a single stock beats an ETF

Buying the top five holdings of a fund directly gives you zero ongoing fee and full control of tax lots — and a much more concentrated bet with no rebalancing and no dividend-reinvestment convenience. For a broad fund whose top five are 20–25% of the weight, "buy the top five" is a *different, riskier* portfolio, not a cheaper version of the same one. For a narrow sector fund whose top five are 60%+ of the weight, direct ownership is a serious alternative. The plugin's ETF-vs-top-holdings comparison shows this trade-off for any fund.

---

## Structures to avoid as a long-term holder

| Structure | The problem | Who it is for |
|---|---|---|
| **Leveraged / inverse (2×, 3×, −1×)** | Resets daily; the compounding of daily moves erodes value in a choppy market — see below | Day-to-week traders, if anyone |
| **Synthetic / swap-based** | Holds a derivative, not the stocks; adds counterparty risk | Markets that cannot be held physically |
| **Exchange-traded note (ETN)** | An unsecured *debt* of the issuing bank; if the bank fails, so does your note | Almost no long-term holder |
| **Single-stock ETF** | Leverage on one name, daily reset, high fee — three of the problems above at once | Not a substitute for owning the stock |
| **Commodity / futures funds with a K-1** | Roll costs from futures, plus a partnership tax form (K-1) that complicates filing | Investors who understand contango |

### Why daily reset destroys value (illustrative)

An index goes **+10%** one day and **−10%** the next: $100 → $110 → $99, down 1%. A 3× leveraged fund on that index goes **+30%** then **−30%**: $100 → $130 → $91, down **9%**. The index is nearly flat; the leveraged fund lost nine times as much. Do this for a year of ordinary volatility and the fund drifts steadily lower even if the index goes nowhere. These products are built for a day, not a decade.

---

## Distributions and tax

Index ETFs pay out the dividends of their holdings, usually quarterly. Two things to check: how much of the distribution is **qualified dividends** (taxed at the lower long-term rate for US holders) versus ordinary income, and whether the fund has a history of **capital-gains distributions** — a plain equity index ETF should almost never have one; a fund that regularly does is either poorly run or structurally unable to use the in-kind mechanism.

**Non-US investors:** a US-domiciled ETF is a US-situs asset — its dividends are subject to US withholding tax, and the holding counts toward US estate-tax exposure. Many non-US investors hold the same index through an Irish-domiciled UCITS ETF instead. The trade-offs — withholding, estate tax, a slightly higher fee, thinner liquidity — are worked through in Lesson 11 and in `tax-lens --non-us`.

*In the plugin:* `etf-analysis` scores a fund 0–10 on cost and tracking, liquidity, what you own vs. what you wanted, overlap, distributions, and structure; `portfolio-review` checks how the fund fits your allocation; `risk-stress-test` shows what the combined portfolio would have lost in past crashes; `tax-lens` handles the after-tax view.

---

## Check yourself

1. A fund charges 0.09% and has lagged its index by 0.11% a year for five years. Another charges 0.05% and has lagged by 0.45%. Which is the better-run fund, and why?
2. You hold an S&P 500 ETF and add a "US technology" ETF. Explain in one sentence why your diversification may have gone *down*.
3. An index rises 20% on Monday and falls 20% on Tuesday. Where does a 2× leveraged fund end up relative to its start, roughly?
4. Why does a plain equity index ETF rarely pay a capital-gains distribution, while a mutual fund tracking the same index might?
5. A fund has $40M in assets and a 0.60% bid-ask spread. Name two distinct risks a long-term holder is taking.

<details><summary>Answers</summary>

1. The first: its tracking difference (−0.11%) is almost exactly its fee, so nothing else is leaking. The second charges less but loses 0.45% a year — 0.40% of unexplained drag is a flag.
2. The technology ETF's largest holdings are the same mega-caps that already dominate the S&P 500 fund, so the overlap concentrates you further in a few names rather than spreading you out.
3. Index: 100 → 120 → 96 (−4%). The 2× fund: 100 → 140 → 84 (−16%) — four times the loss, because each day's move is applied to a new base.
4. Because ETF shares are created and redeemed in kind with dealers, the fund rarely has to sell holdings; a mutual fund must sell for cash when investors redeem, and the realized gains are distributed to everyone left.
5. Closure risk (a $40M fund may be shut, forcing a sale on the fund's timetable, possibly taxable) and trading cost (0.60% each way is 1.2% round-trip — a meaningful slice of an index return).

</details>

---

## Key takeaways

- An ETF is a wrapper around a basket; judge the wrapper (cost, structure, liquidity) *and* the contents (holdings, tilts, overlap).
- The expense ratio compounds: a 0.75% fund can hand away more than a tenth of the final value versus a 0.03% one over 20 years.
- Tracking *difference* is the cost that matters; it should be about minus the fee. A gap beyond that is a leak.
- Read AUM, volume, spread, and premium/discount before buying; use a limit order.
- Cap-weighted indexes concentrate, and several funds can hold the same few mega-caps — check overlap by weight.
- Build a cheap, boring core and keep bets small in satellites; buying the top five holdings directly is a different portfolio, not a cheaper one.
- Leveraged, inverse, synthetic, ETN, single-stock, and K-1 structures are not long-term holdings.

---

> **Next / Related:** Previous lesson — [Before Your First Trade](learning-setup.html). Next: [**Taxes & Account Types**](learning-taxes.html) — what you keep after the fee and the tax. Or head back to the [Learning hub](learning.html), then [Choose a Skill](choose-a-skill.html) to run `etf-analysis` on a fund you hold. See also [Concepts](concepts.html) and the [Glossary](glossary.html).

*Educational content only. Not financial advice.*
