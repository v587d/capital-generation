# Before Your First Trade — Goals, Accounts, Orders

> The first eight lessons taught you how to judge a business, value it, read the market, and hold a portfolio. This lesson is the one most guides skip: the practical set-up that happens *before* the first order — the money you keep out of the market, the one-page plan you write, the account you open, the broker you choose, and the order you actually type. None of it needs a finance degree. All of it decides whether the analysis skills you have learned can ever do you any good.

**What you'll learn**

- Which money never goes into stocks, and why an emergency fund comes before any ticker
- The difference between risk *capacity* and risk *tolerance* — and why you need both numbers
- How to write a one-page Investment Policy Statement (IPS) you can actually follow
- The main US account types, and what a non-US investor needs instead (including the W-8BEN form)
- How to compare two brokers on the costs that matter
- Order types — and why "limit" should be your default
- How fractional shares and dollar-cost averaging turn a plan into a habit
- A first-month checklist to run before the first trade

---

## 1. The money you do not invest

The first investing decision is deciding what *not* to invest. Three rules, in order:

1. **An emergency fund comes first.** Keep **3–6 months of living expenses** in cash or a savings account you can reach in a day. Its job is to make sure a lost job or a medical bill never forces you to sell stocks at the worst possible moment.
2. **No money you need within ~3 years.** A stock market can fall 30–50% and take years to recover (Lesson 1). Rent, tuition, a house deposit due in 2028 — that money belongs in cash or short-term bonds, not in shares.
3. **No borrowed money.** Margin loans, credit cards, "buy now pay later" — debt turns a normal drawdown into a forced sale. Leverage is a professional's tool with a professional's risk controls; it is not a foundation.

> **Key idea:** The emergency fund is not a missed investment opportunity. It is what lets you hold your investments through a bad year without being forced to sell them.

Only what is left after these three rules is investable money.

---

## 2. Goals, horizon, and two kinds of risk

Every portfolio decision downstream — allocation, position size, how you react to a crash — flows from two facts about *you*, not about any stock.

**Goal and horizon.** What is the money for, and when do you need it? "Retirement in 30 years" and "a house deposit in 5" call for completely different portfolios (Lesson 6's horizon table). Write the goal down with a year attached.

**Two kinds of risk.** People confuse these constantly, and the confusion is expensive:

| | Risk **capacity** | Risk **tolerance** |
|---|---|---|
| The question | Can you *afford* a 40% drawdown without changing your life? | Can you *sleep* through a 40% drawdown without selling? |
| Depends on | Income stability, time horizon, emergency fund, other assets | Temperament, experience, how you reacted to past losses |
| Measured by | Arithmetic — how much can fall before a goal is at risk | Honesty — what you actually did in March 2020 or 2022 |
| If you ignore it | You *cannot* recover in time | You *will not* stay invested long enough to recover |

Your portfolio should be sized to the **lower** of the two. Plenty of investors have the capacity for an all-stock portfolio and the tolerance for a 60/40 one — and the 60/40 they can hold beats the 100% they abandon at the bottom.

> **Key idea:** Capacity is what you can afford to lose. Tolerance is what you can afford to *watch*. Plan to the smaller number.

*In the plugin:* `risk-stress-test` estimates how far a proposed portfolio would have fallen in 2008, March 2020, and 2022 — the fastest way to turn "40% drawdown" from an abstraction into a dollar figure you can react to *before* it happens.

---

## 3. The one-page Investment Policy Statement

Professionals who manage other people's money write an **Investment Policy Statement (IPS)** before they buy anything. It is a one-page contract with your future self — the version of you who, eighteen months from now, is staring at a red screen and wants to do something. Everything in Lessons 6–8 about position sizing, rebalancing, and sell discipline becomes real only once it is written down here.

Fill this in. Keep it to one page. Print it.

```
INVESTMENT POLICY STATEMENT — <your name> — written <date>

1. GOAL & HORIZON
   Purpose: ______________________   Target amount: $________   Needed by: ______ (year)

2. RISK
   Capacity (largest drawdown I can afford): ____%   Tolerance (largest I can sit through): ____%
   → Portfolio is planned to the LOWER of the two: ____%

3. TARGET ALLOCATION (with rebalancing bands)
   Stocks — broad index core   ____%  (band ± ___ pp)
   Stocks — individual names   ____%  (band ± ___ pp)     max per name: ___%   max per sector: ___%
   Bonds / cash                ____%  (band ± ___ pp)

4. CONTRIBUTIONS
   $______ every ______ (payday / month), invested on the same day regardless of price

5. REBALANCING RULE
   Check on: ______ (e.g. first weekday of Jan / Jul).  Act only if a band is breached.

6. WHAT I WILL NOT DO
   □ Buy with borrowed money   □ Buy anything I cannot explain in two sentences
   □ Add to a position whose thesis is BROKEN   □ Change this document during a drawdown
   □ ______________________

7. REVIEW
   Re-read this on: ______ (once a year, or after a life change — not after a market move)
```

Two rules about the document itself:

- **Change it on a schedule, not on a feeling.** The IPS may be edited at the annual review or after a life event (new job, a child, a house). It may *not* be edited because the market fell 25% — that is exactly the moment it exists for.
- **Bands, not targets.** A 60% stock target with a ±5 pp band means you act only below 55% or above 65%. Without bands you will trade constantly; with them, rebalancing happens two or three times a decade.

*In the plugin:* `portfolio-review` grades a portfolio against a stated allocation, concentration cap, and risk profile — paste your IPS targets with your holdings and it tells you where you have drifted. `thesis-tracker` is the per-position version of the same discipline: it writes down *why* you own each name so that "thesis BROKEN" in rule 6 is a fact, not a mood.

---

## 4. Account types

The account is the container; it decides how — and whether — the government taxes what happens inside. Lesson 11 covers *what to put where*. Here, just learn the containers.

### If you are a US taxpayer

| Account | Money goes in | Grows | Money comes out | Who it suits |
|---|---|---|---|---|
| **Taxable brokerage** | After tax, no limit | Dividends and realized gains taxed each year | Any time, no penalty | Everyone — flexible, the default |
| **Traditional IRA / 401(k)** | Pre-tax (deductible), annual limit | Tax-deferred — nothing taxed while inside | Taxed as income; penalty before age 59½ (with exceptions) | Retirement money; higher bracket now than later |
| **Roth IRA / Roth 401(k)** | After tax, annual limit (income limits for IRA) | Tax-free | Tax-free after 59½ and a 5-year rule; contributions accessible earlier | Retirement money; lower bracket now than later; highest-growth holdings |

A 401(k) is offered through an employer (often with a matching contribution — take the match before anything else); an IRA you open yourself at a broker. Contribution limits change every year; check the current figure before you plan.

### If you are not a US resident

A large share of this site's readers invest in US stocks from Taiwan, Hong Kong, Singapore, Japan, Europe. The mechanics differ:

- **Where to hold the account.** Either an international broker that operates in your country, or a US broker that accepts non-resident clients. Compare on the costs in Section 5 *and* on which regulator protects the account.
- **The W-8BEN form.** When you open the account you sign IRS Form **W-8BEN**. It certifies that you are *not* a US person, so the broker applies non-resident rules rather than US-resident rules — and, if your country has a tax treaty with the US, claims the treaty rate. It is generally valid until the end of the **third calendar year** after you sign it; an expired form means the broker withholds at the statutory rate. Diary the renewal.
- **Dividends are withheld at source.** A non-resident does not receive the full dividend; the broker withholds US tax before the cash reaches you and reports it on Form **1042-S** at year end. Lesson 11 has the rates, the treaty question, and the other non-US topics (capital gains, estate exposure, the UCITS alternative).
- **Your home country taxes you too.** Nothing here replaces your own country's rules on overseas income; that is a question for a local professional.

*In the plugin:* `tax-lens` works through what each account choice costs (US mode) and, with `--non-us`, the withholding, treaty, and estate-tax mechanics for a non-resident. Run it once you have read Lesson 11.

---

## 5. Choosing a broker

Two brokers can hold the identical portfolio and deliver noticeably different results, entirely through costs and frictions. Compare at least two on this table before you open an account:

| Cost / feature | What to look for | Why it matters |
|---|---|---|
| **Commission per trade** | Many US brokers charge $0 for US stocks and ETFs; some charge per share or a minimum | A $5 minimum on a $200 monthly contribution is a 2.5% fee — every month |
| **FX conversion fee** (non-US) | The spread or fee on converting your currency to USD | Often the *largest* cost for a non-US investor; 0.1% and 1.0% are both common |
| **Bid–ask spread & execution** | Where your orders actually fill relative to the quoted price | Hidden cost on every trade; matters most for small-cap or thinly traded names |
| **Margin interest rate** | The rate charged if you borrow | You will not borrow (Section 1) — but a high rate signals how the broker makes money |
| **Fractional shares** | Can you buy $50 of a $400 stock? | Makes dollar-based contributions (Section 7) possible |
| **Dividend reinvestment (DRIP)** | Automatic, optional, free? | Convenient — but see Lesson 11 on why it can complicate loss harvesting |
| **Tax reporting** | US: Form **1099** each year. Non-US: Form **1042-S** | You need the right form for your return; a broker that issues neither is a red flag |
| **Account protection** | US: SIPC coverage; elsewhere, the local scheme | Protects against the *broker* failing, not against market losses |
| **Idle cash** | Is uninvested cash swept to an interest-bearing fund? | Cash between contributions should earn something |

> **Key idea:** For a non-US investor the FX fee usually outweighs the commission. For a small-account US investor, per-trade minimums do. Find *your* biggest line, then choose.

---

## 6. Order types — and why "limit" is your default

An order is an instruction to the broker. The type you choose decides *what price you accept*, and the wrong type can cost more than a year of fees in one click.

| Order type | What it says | When it fills | Use it for |
|---|---|---|---|
| **Market** | "Buy now at whatever the price is" | Immediately, at the best available price — which may not be the one on your screen | Almost never as a beginner; only very liquid names during regular hours |
| **Limit** | "Buy at $X or better; otherwise don't" | Only if the price reaches your limit | **Your default.** You choose the worst price you accept |
| **Stop (stop-loss)** | "If the price falls to $X, sell at market" | Triggers at $X, then fills like a market order — possibly well below $X in a fast move | Predefined exits; understand that the fill is not guaranteed at $X |
| **Stop-limit** | "If the price falls to $X, place a limit order at $Y" | Triggers at $X, fills only at $Y or better | Exits where you would rather not sell at all than sell far below your level |

**Duration.** A **day** order expires at the close if unfilled; **GTC** (good-till-cancelled) stays open, typically for 30–90 days depending on the broker. A GTC limit order you forgot about can fill weeks later at a price that no longer fits your plan — review open orders monthly.

**Pre-market and after-hours.** Trading outside 9:30–16:00 Eastern is possible at many brokers, but liquidity is thin and spreads are wide. Prices can jump around on a single order. If you must trade there, use a limit order, always.

**T+1 settlement.** In US markets a trade *settles* — cash and shares actually change hands — one business day after the trade date. Practically: the cash from a sale on Tuesday is fully yours on Wednesday, and some brokers restrict re-using unsettled cash. Plan sales a day ahead of when you need the money.

### A tiny worked illustration (illustrative, rounded)

You place a **market** order for 100 shares of a thinly traded stock at **9:31 a.m.**, one minute after the open, when the last trade printed at **$50.00**.

| | Quote at 9:31 | What happens |
|---|---|---|
| Best bid / best ask | $49.80 / $50.60 — a wide early spread | A market buy takes the **ask**: $50.60, not $50.00 |
| Shares available at $50.60 | 40 | Your remaining 60 shares fill at the *next* asks: $50.90, $51.10 |
| Average fill | ≈ **$50.98** | About **2% above** the price you saw |
| Cost of the order type | ≈ $98 on a $5,000 purchase | More than most annual fees — from one click |

The same order as a **limit at $50.20** would have filled partly or not at all — and either outcome beats overpaying 2% for the privilege of speed. Wait for the spread to narrow (often within 15–30 minutes of the open), or use a limit and let the market come to you.

> **Key idea:** A market order buys *certainty of execution*. A limit order buys *certainty of price*. As an investor with a plan, you almost always want the second.

---

## 7. Fractional shares and dollar-cost averaging

The IPS says "$400 on the 25th of every month." Two mechanics make that sentence executable:

- **Fractional shares** let you buy by *dollar amount* instead of share count — $400 of an ETF trading at $550 buys 0.727 shares. Without fractions, a monthly contribution can sit in cash for months waiting to afford one share.
- **Dollar-cost averaging (DCA)** — the same dollar amount on the same date, regardless of price (Lesson 6) — removes the "is now a good time?" question entirely. You buy more shares when prices are low and fewer when they are high, automatically, and you never have to be right about timing.

Set the contribution to run on payday, before the money reaches the account you spend from. A plan that requires a decision every month will eventually skip a month; a plan that runs itself will not.

*In the plugin:* `etf-analysis` — the next lesson — is how you choose the core holding those contributions flow into: cost, tracking, what you actually own, and overlap with anything else you hold.

---

## 8. The first-month checklist

Run this before the first order. Every box, in order.

- [ ] Emergency fund of 3–6 months of expenses is in a separate cash account
- [ ] No money that is needed within 3 years is in the investment account
- [ ] IPS written, one page, dated — with allocation bands, position limits, and the "will not do" list
- [ ] Risk capacity and risk tolerance both written down; portfolio planned to the lower one
- [ ] Account type chosen for the goal (US: taxable / traditional / Roth; non-US: broker chosen, **W-8BEN** signed, renewal year in the diary)
- [ ] Two brokers compared on commission, FX fee, fractional shares, tax form, protection scheme
- [ ] Contribution set to run automatically on payday
- [ ] Order defaults set to **limit** and **day**; pre-/after-market trading left off
- [ ] Rebalancing check dates and the annual IPS review are in the calendar
- [ ] The first purchase is the broad index core from the IPS, not an individual stock you read about this week

*In the plugin:* paste any output — a `portfolio-review`, an `etf-analysis`, this checklist — into `learning-coach` and it explains each item in plain words and asks what would change your mind.

---

## Check yourself

1. **Recall.** Name the three kinds of money that never go into stocks.
2. **Recall.** What does a limit order guarantee that a market order does not — and what does it *not* guarantee?
3. **Apply.** Your IPS sets stocks at 70% with a ±5 pp band. After a strong year stocks are 74% of the portfolio. Do you rebalance?
4. **Apply.** You are a non-US investor and you signed your W-8BEN in March 2024. In which year does it expire, and what happens if you forget to renew it?
5. **Judgment.** A friend says: "I have the capacity for 100% stocks — I'm 30 and have a stable job." What is the second question you ask before agreeing?

<details><summary>Answers</summary>

1. The emergency fund (3–6 months of expenses); money needed within about three years; borrowed money.
2. A limit order guarantees the *worst price you will accept*. It does not guarantee that the order fills at all.
3. No. 74% is inside the 65–75% band. You act only when a band is breached — that is the point of bands.
4. It is generally valid until the end of the third calendar year after signing — 31 December 2027. If it lapses, the broker withholds at the statutory non-resident rate rather than any treaty rate until a new form is on file.
5. "What did you do in March 2020 or during 2022?" — that is risk *tolerance*. Capacity says what he can afford; tolerance says what he will actually hold. The portfolio should be planned to the lower of the two.

</details>

---

## Key takeaways

- Decide what *not* to invest first: an emergency fund, no money needed within ~3 years, no borrowed money.
- Plan to the lower of risk **capacity** (what you can afford to lose) and risk **tolerance** (what you can afford to watch).
- Write a one-page IPS — goal, horizon, allocation with bands, contribution schedule, rebalancing rule, position limits, a "will not do" list — and change it only on a schedule, never during a drawdown.
- Learn the account containers: taxable vs. traditional vs. Roth for US taxpayers; for non-US investors, a suitable broker, the **W-8BEN** form (renew every three years), and dividends withheld at source.
- Compare two brokers on the cost that dominates *your* situation — FX fees for non-US investors, per-trade minimums for small US accounts.
- **Limit orders by default**; market orders trade price for speed, and at the open on a thin stock that can cost 2% in one click. Remember T+1 settlement when you need the cash.
- Fractional shares plus automatic dollar-cost averaging turn the IPS contribution line into a habit that does not require monthly willpower.

---

> **Next / Related:** Previous lesson — [Case Study: AMD](learning-case-amd.html). Next: [**ETFs & Index Investing**](learning-etfs.html) — choosing the core holding your contributions flow into. Or head back to the [Learning hub](learning.html), then [Choose a Skill](choose-a-skill.html) to put it to work. See also [Concepts](concepts.html) and the [Glossary](glossary.html).

*Educational content only. Not financial advice.*
