# Financial Glossary

> Plain-English definitions for every metric the InvestSkill frameworks emit. Each entry gives the formula, a rough "good vs. bad" range, and which skill surfaces it. Ranges are rules of thumb, not absolute rules — context (industry, growth stage, rates) always matters.

**Jump to:** [A](#a) · [B](#b) · [C](#c) · [D](#d) · [E](#e) · [F](#f) · [G](#g) · [I](#i) · [L](#l) · [M](#m) · [O](#o) · [P](#p) · [Q](#q) · [R](#r) · [S](#s) · [T](#t) · [U](#u) · [V](#v) · [W](#w) · [Y](#y)

---

## A

### Alpha
Return earned *above* what the market (or a benchmark) would predict for a given level of risk. Positive alpha = skill or edge; zero alpha = you just matched the market.
- **Surfaced by:** `portfolio-review`.

### Altman Z-Score
Bankruptcy-risk score combining five weighted ratios (working capital, retained earnings, EBIT, equity, sales — all relative to assets).
- **Good / bad:** > 3.0 safe · 1.8–3.0 grey zone · < 1.8 distress.
- **Surfaced by:** `financial-report-analyst`, `result-validator`.

### Anchoring
The bias of judging a stock by a reference price — usually what you paid — instead of what it is worth today. Antidote: "would I buy it at this price today?"
- **Good / bad:** A behavioral trap, not a metric. The written thesis and its triggers are the cure.
- **Surfaced by:** `thesis-tracker`, `position-ladder`, `learning-coach`.

### Asset Turnover
How efficiently a company converts assets into revenue. `Revenue ÷ Total Assets`.
- **Good / bad:** higher is better, but it's industry-specific (retail runs high, utilities low).
- **Surfaced by:** `fundamental-analysis`.

### AUM (Assets Under Management)
Total market value of the assets a fund holds. For an ETF, the first liquidity and viability check.
- **Good / bad:** > $1B comfortable · $100M–1B fine · < $100M closure risk and wider spreads.
- **Surfaced by:** `etf-analysis`.

---

## B

### Beat and Drop
A stock that beats consensus on the headline numbers yet falls after the print — because expectations were higher than consensus, guidance was cut, or the beat was low quality.
- **Good / bad:** Common in stocks that ran into earnings. The guide, not the print, moves the stock.
- **Surfaced by:** `earnings-preview`, `earnings-call-analysis`.

### Beta (β)
How much a stock moves relative to the market. β = 1 moves with the market; β > 1 is more volatile; β < 1 is calmer; negative β moves opposite.
- **Good / bad:** not good or bad — it sizes *risk*. High beta amplifies both gains and losses.
- **Surfaced by:** `dcf-valuation` (feeds WACC), `technical-analysis`, `portfolio-review`.

### Bid-Ask Spread
The gap between the highest price a buyer will pay and the lowest a seller will accept. A round-trip cost you pay on every trade.
- **Good / bad:** ≤ 0.05% of price for a liquid large cap or broad ETF · > 0.25% thin — use limit orders.
- **Surfaced by:** `etf-analysis`, `technical-analysis`.

### Book Value
Net assets on the balance sheet: `Total Assets − Total Liabilities`. The accounting "breakup" value of equity.
- **Surfaced by:** `stock-valuation`, `fundamental-analysis`.

### Burn Rate
How fast a company spends cash in excess of revenue, usually for pre-profit firms. Paired with **runway** (months of cash left).
- **Good / bad:** lower burn + longer runway is safer. Negative free cash flow with short runway is a red flag.
- **Surfaced by:** `financial-report-analyst`.

---

## C

### CAGR (Compound Annual Growth Rate)
The smoothed annual growth rate over a multi-year period. `(End ÷ Start)^(1/years) − 1`.
- **Surfaced by:** `dividend-analysis`, `fundamental-analysis`.

### Consensus Estimate
The average of published analyst forecasts for revenue, EPS, or guidance. The bar a company is measured against on earnings day.
- **Good / bad:** Not good or bad — the question is whether the *price* already assumes more than consensus.
- **Surfaced by:** `earnings-preview`, `stock-valuation`.

### Correlation
How closely two holdings move together, from −1 to +1. Diversification only works when correlations are low — and they rise toward 1 in a crash.
- **Good / bad:** < 0.5 between core holdings is real diversification · > 0.8 is the same bet twice.
- **Surfaced by:** `portfolio-review`, `risk-stress-test`.

### Current Ratio
Short-term liquidity: `Current Assets ÷ Current Liabilities`. Can the company cover the next 12 months of bills?
- **Good / bad:** > 1.5 comfortable · 1.0–1.5 adequate · < 1.0 potential strain.
- **Surfaced by:** `fundamental-analysis`, `financial-report-analyst`.

---

## D

### Days-to-Cover (Short Interest Ratio)
Days of normal trading volume it would take short sellers to buy back (cover) all shorted shares. `Shares Short ÷ Average Daily Volume`.
- **Good / bad:** higher = more squeeze fuel. > 5 days is notable; > 10 is high.
- **Surfaced by:** `short-interest`.

### DCF (Discounted Cash Flow)
Valuation method that projects future free cash flows and discounts them back to today's value using a discount rate (WACC). The output is an **intrinsic value** per share.
- **Surfaced by:** `dcf-valuation`, `stock-valuation`. See [Concepts → How intrinsic value works](concepts.html#how-intrinsic-value-works).

### Debt-to-Equity (D/E)
Leverage: `Total Debt ÷ Shareholders' Equity`. How much the company funds itself with debt vs. owner capital.
- **Good / bad:** < 1.0 conservative · 1.0–2.0 moderate · > 2.0 leveraged (industry-dependent — banks and utilities run high).
- **Surfaced by:** `fundamental-analysis`, `dividend-analysis`.

### Disposition Effect
The tendency to sell winners too early and hold losers too long, because realizing a loss hurts more than realizing a gain feels good.
- **Good / bad:** The most expensive bias for individual investors. Pre-committed exit rules are the antidote.
- **Surfaced by:** `thesis-tracker`, `position-ladder`, `learning-coach`.

### Dividend Coverage Ratio
How many times earnings (or free cash flow) cover the dividend. `EPS ÷ Dividend per Share`, or the FCF version.
- **Good / bad:** > 2x healthy · 1.5–2x adequate · < 1.2x fragile.
- **Surfaced by:** `dividend-analysis`.

### Dividend Payout Ratio
Share of earnings paid out as dividends. `Dividends ÷ Net Income`.
- **Good / bad:** < 60% generally sustainable · 60–80% watch · > 100% paying more than it earns (yield-trap warning).
- **Surfaced by:** `dividend-analysis`.

### Dividend Yield
Annual dividend as a percent of price. `Annual Dividend ÷ Price`.
- **Good / bad:** a very high yield (e.g., > 7%) is often a *warning*, not a gift — the market may expect a cut. See [yield trap](#yield-trap).
- **Surfaced by:** `dividend-analysis`.

### Drawdown / Max Drawdown
The fall from a peak to the following trough, as a percentage. Max drawdown is the worst such fall over a period — the number that decides whether you can hold on.
- **Good / bad:** Know it before you own it: a 50% drawdown needs a 100% gain to recover.
- **Surfaced by:** `risk-stress-test`, `portfolio-review`.

---

## E

### EBITDA
Earnings Before Interest, Taxes, Depreciation & Amortization — a proxy for operating cash generation that strips out capital structure and accounting choices.
- **Caution:** ignores real capital costs; "EBITDA is not cash flow."
- **Surfaced by:** `stock-valuation`, `fundamental-analysis`.

### EPS (Earnings Per Share)
Net income attributable to each share. `Net Income ÷ Shares Outstanding`. "Diluted EPS" includes options/convertibles.
- **Surfaced by:** nearly every fundamental skill.

### Estate Tax (Non-Resident)
US federal estate tax on **US-situs** assets — US-domiciled stocks and ETFs — held by a non-resident alien at death, above an exemption of only **$60,000**, at rates up to 40%, unless an estate-tax treaty applies.
- **Good / bad:** Treasuries, bank deposits, and non-US-domiciled funds (e.g. Irish UCITS) are outside the net. Not tax advice.
- **Surfaced by:** `tax-lens --non-us`.

### EV (Enterprise Value)
The whole-company price a buyer pays: `Market Cap + Total Debt − Cash`. Used instead of market cap so debt-heavy and cash-rich firms compare fairly.
- **Surfaced by:** `stock-valuation`.

### EV/EBITDA
Enterprise value relative to operating earnings — a capital-structure-neutral valuation multiple.
- **Good / bad:** < 10x often cheap · 10–15x fair · > 15x rich (sector-dependent).
- **Surfaced by:** `stock-valuation`.

### Ex-Dividend Date
The first day a stock trades *without* the right to the next dividend. Buy before it to receive the payment; the price typically drops by roughly the dividend on that day.
- **Good / bad:** Matters for the qualified-dividend holding-period test and for timing sales.
- **Surfaced by:** `dividend-analysis`, `tax-lens`, `catalyst-calendar`.

### Expense Ratio
A fund's annual fee as a percentage of assets, deducted from returns automatically. `Annual fund costs ÷ Average assets`.
- **Good / bad:** ≤ 0.10% for a broad index fund · 0.20–0.50% for specialty · > 0.75% needs a reason.
- **Surfaced by:** `etf-analysis`.

---

## F

### FCF (Free Cash Flow)
Cash left after operating expenses *and* capital spending. `Operating Cash Flow − CapEx`. The cash an owner could actually take out.
- **Good / bad:** consistently positive and growing is the gold standard. Negative FCF needs a growth story to justify it.
- **Surfaced by:** `dcf-valuation`, `fundamental-analysis`, `dividend-analysis`.

### FCF Yield
Free cash flow relative to market cap. `FCF ÷ Market Cap`. The cash-return version of an earnings yield.
- **Good / bad:** > 5% attractive · 3–5% fair · < 3% expensive.
- **Surfaced by:** `stock-valuation`.

---

## G

### Greeks (Options)
Sensitivities of an option's price: **Delta** (vs. underlying price), **Gamma** (rate of delta change), **Theta** (time decay), **Vega** (vs. volatility), **Rho** (vs. interest rates).
- **Surfaced by:** `options-analysis`.

### Gross Margin
Profit after the direct cost of goods. `(Revenue − COGS) ÷ Revenue`. A first read on pricing power.
- **Good / bad:** higher and stable signals a moat; falling margins signal competition.
- **Surfaced by:** `fundamental-analysis`, `competitor-analysis`.

### Guidance
Management's own forecast for the coming quarter or year, given with the earnings release. The stock reacts more to the guide than to the reported quarter.
- **Good / bad:** "Beat and raise" is the bullish case; "beat and lower" is the classic beat-and-drop.
- **Surfaced by:** `earnings-preview`, `earnings-call-analysis`.

---

## I

### Implied Move
The size of the earnings-day move the options market is pricing: roughly the at-the-money straddle price ÷ stock price for the first expiry after the print. Magnitude only — it says nothing about direction.
- **Good / bad:** Compare with the realized median move of past prints: implied ÷ realized > 1.2 means the event is expensively insured.
- **Surfaced by:** `earnings-preview`, `options-analysis`.

### Implied Volatility (IV)
The market's expected future volatility, baked into option prices. Higher IV = pricier options = bigger expected swings.
- **Surfaced by:** `options-analysis`.

### Interest Coverage Ratio
How easily operating earnings pay interest. `EBIT ÷ Interest Expense`.
- **Good / bad:** > 5x safe · 2–5x adequate · < 1.5x danger.
- **Surfaced by:** `financial-report-analyst`, `dividend-analysis`.

### Investment Policy Statement (IPS)
A one-page written contract with yourself: goal, horizon, target allocation with bands, contribution schedule, rebalancing rule, position limits, and the list of things you will not do.
- **Good / bad:** Exists and is reviewed on a date — or does not exist. `portfolio-review` grades a portfolio against it.
- **Surfaced by:** `portfolio-review`, `thesis-tracker`.

### IV Rank / IV Percentile
Where current implied volatility sits versus its own past year (0–100). Tells you if options are "expensive" or "cheap" relative to their own history.
- **Good / bad:** high IV rank favors *selling* premium; low favors *buying* it.
- **Surfaced by:** `options-analysis`.

---

## L

### Limit Order
An order to buy or sell only at a stated price or better. The default order type for an investor: it caps what you pay and cannot fill 2% away in a thin market.
- **Good / bad:** Use limit orders; reserve market orders for the most liquid names during regular hours, if at all.
- **Surfaced by:** `position-ladder` (rungs are resting limit orders).

---

## M

### Margin of Safety
The discount between a stock's price and its estimated intrinsic value. The buffer that protects you if your estimate is wrong.
- **Good / bad:** value investors often want 20–40%+ before buying.
- **Surfaced by:** `dcf-valuation`, `stock-eval`. See [Concepts → Margin of safety](concepts.html#margin-of-safety--position-sizing).

### Market Order
An order to buy or sell immediately at the best available price. Fast, but the fill price is whatever the book offers — costly on illiquid tickers, at the open, or in extended hours.
- **Good / bad:** Avoid unless the stock is deeply liquid and the market is open. See Limit Order.
- **Surfaced by:** —

### Moat
A durable competitive advantage that protects long-term profits — brand, network effects, switching costs, scale, or patents.
- **Good / bad:** wide > narrow > none. Shows up as persistently high ROIC and stable margins.
- **Surfaced by:** `competitor-analysis`, `stock-eval`. See [Concepts → Reading a moat](concepts.html#reading-a-moat).

---

## O

### Overlap (Holdings Overlap)
The share of an ETF that duplicates what you already own, computed as Σ min(weight in ETF, weight in your portfolio) over shared holdings.
- **Good / bad:** < 25% complementary · 25–60% partial · > 60% the same bet in a second wrapper.
- **Surfaced by:** `etf-analysis`, `portfolio-review`.

---

## P

### P/B (Price-to-Book)
Price relative to accounting net worth. `Price ÷ Book Value per Share`.
- **Good / bad:** most useful for asset-heavy/financial firms; < 1.0 can mean cheap *or* troubled.
- **Surfaced by:** `stock-valuation`.

### P/E (Price-to-Earnings)
Price per dollar of earnings. `Price ÷ EPS`. The most-quoted multiple; compare to the company's own history and peers, not in isolation.
- **Good / bad:** there is no universal "good" P/E — a 40x grower can be cheaper than a 10x decliner. Pair with growth (see PEG).
- **Surfaced by:** `stock-valuation`, `stock-eval`.

### P/S (Price-to-Sales)
Price per dollar of revenue. `Market Cap ÷ Revenue`. Useful for unprofitable or early-stage firms where P/E is meaningless.
- **Surfaced by:** `stock-valuation`.

### PEG Ratio
P/E adjusted for growth. `P/E ÷ Earnings Growth Rate (%)`. Puts fast and slow growers on the same footing.
- **Good / bad:** ~1.0 fairly priced · < 1.0 potentially cheap · > 2.0 expensive.
- **Surfaced by:** `stock-valuation`, `stock-eval`.

### Piotroski F-Score
A 0–9 checklist of fundamental health across profitability, leverage/liquidity, and operating efficiency. Each "yes" scores a point.
- **Good / bad:** 7–9 strong · 4–6 middling · 0–3 weak.
- **Surfaced by:** `stock-eval`, `fundamental-analysis`.

### Porter's Five Forces
A framework rating industry attractiveness across five pressures: competitive rivalry, supplier power, buyer power, threat of substitutes, threat of new entrants.
- **Surfaced by:** `competitor-analysis`.

### Pre-Mortem
Writing, before you buy, the paragraph that begins "It is twelve months later and this position lost 40% because…". Forces the most likely failure path into the open while it can still become an invalidation trigger.
- **Good / bad:** Every thesis file should have one.
- **Surfaced by:** `thesis-tracker`, `bear-case`.

### Process vs. Outcome
The 2×2 that separates a good decision from a good result: good decision / good outcome, good decision / bad outcome (bad luck — keep the process), bad decision / good outcome (the dangerous one — you learn the wrong lesson), bad decision / bad outcome.
- **Good / bad:** Judge yourself on the process column; the market decides the outcome column.
- **Surfaced by:** `thesis-tracker` (decision log), `learning-coach`.

---

## Q

### Qualified Dividend
A dividend taxed at the lower long-term capital-gains rates instead of ordinary rates. Requires an eligible payer and holding the stock **more than 60 days in the 121-day window** around the ex-dividend date. REIT dividends are generally not qualified.
- **Good / bad:** Qualified → lower tax; non-qualified → ordinary income. US rules; not tax advice.
- **Surfaced by:** `tax-lens`, `dividend-analysis`.

### Quick Ratio (Acid Test)
Stricter liquidity than current ratio — excludes inventory. `(Current Assets − Inventory) ÷ Current Liabilities`.
- **Good / bad:** > 1.0 comfortable.
- **Surfaced by:** `fundamental-analysis`.

---

## R

### Residual Income
Earnings above the cost of the equity capital used to produce them. Value is created only when returns exceed the cost of capital.
- **Surfaced by:** `stock-valuation`.

### ROA (Return on Assets)
Profit per dollar of assets. `Net Income ÷ Total Assets`. How well management uses the asset base.
- **Good / bad:** > 5% solid (industry-dependent).
- **Surfaced by:** `fundamental-analysis`.

### ROE (Return on Equity)
Profit per dollar of shareholder equity. `Net Income ÷ Equity`. Watch for ROE inflated by heavy debt.
- **Good / bad:** > 15% strong · 10–15% decent · < 10% weak.
- **Surfaced by:** `fundamental-analysis`, `stock-eval`.

### ROIC (Return on Invested Capital)
The cleanest profitability measure: returns on *all* capital (debt + equity) put to work. `NOPAT ÷ Invested Capital`. Compare to WACC — value is created only when **ROIC > WACC**.
- **Good / bad:** > 15% excellent · 10–15% good · below WACC = destroying value.
- **Surfaced by:** `stock-eval`, `fundamental-analysis`, `competitor-analysis`.

---

## S

### Settlement (T+1)
US stock trades settle one business day after the trade date: that is when shares are delivered and cash is final. Selling and immediately re-spending the proceeds can run into settlement rules in cash accounts.
- **Good / bad:** Know when your cash is actually available before placing the next order.
- **Surfaced by:** —

### Sharpe Ratio
Risk-adjusted return: excess return per unit of volatility. `(Return − Risk-free Rate) ÷ Std Dev`.
- **Good / bad:** > 1 good · > 2 very good · < 1 weak.
- **Surfaced by:** `portfolio-review`.

### Short Float (Short Interest %)
Percent of freely tradable shares sold short. `Shares Short ÷ Float`.
- **Good / bad:** > 10% elevated · > 20% high (crowded short, squeeze potential).
- **Surfaced by:** `short-interest`.

### Sortino Ratio
Like the Sharpe ratio, but penalizes only *downside* volatility: `(Return − Risk-free) ÷ Downside deviation`. Rewards portfolios whose swings are mostly upward.
- **Good / bad:** > 1 acceptable · > 2 strong. Compare against a benchmark over the same period.
- **Surfaced by:** `portfolio-review`, `risk-stress-test`.

### Specific Identification (Lot Selection)
Choosing *which* shares (tax lot) you sell — instead of the broker's default, usually FIFO. Must be designated at or before the trade. Lets you pick the lot that produces the gain or loss you want.
- **Good / bad:** Almost always better than FIFO for a partial sale of a long-held winner. US rules; not tax advice.
- **Surfaced by:** `tax-lens`, `position-ladder`.

### Support & Resistance
Price levels where buying (support) or selling (resistance) has historically clustered. Breaks of these levels are technical signals.
- **Surfaced by:** `technical-analysis`.

---

## T

### Tax-Loss Harvesting
Selling a position at a loss to offset realized gains (and up to a small amount of ordinary income), then holding a *similar but not substantially identical* replacement for 31 days to avoid a wash sale.
- **Good / bad:** Defers tax, does not eliminate it — the replacement's basis is lower. US rules; not tax advice.
- **Surfaced by:** `tax-lens`, `portfolio-review`.

### Terminal Value
In a DCF, the value of all cash flows *beyond* the explicit forecast period — often 60–80% of the total. Highly sensitive to the assumed perpetual growth rate.
- **Surfaced by:** `dcf-valuation`. See [Concepts → How intrinsic value works](concepts.html#how-intrinsic-value-works).

### Tracking Difference
A fund's actual return minus its index's return over a period. For a well-run index fund it is roughly −(expense ratio); anything worse is a gap to explain.
- **Good / bad:** ≈ −ER is fine · a gap beyond −(ER + 0.10%)/yr is a flag. Not the same as tracking error.
- **Surfaced by:** `etf-analysis`.

### Tracking Error
The *volatility* of the difference between a fund's returns and its index's returns — how consistently it tracks, not how much it lags. Low tracking error with a large tracking difference means a fund that reliably underperforms.
- **Good / bad:** < 0.10% annualized for a physical broad-market ETF is tight.
- **Surfaced by:** `etf-analysis`.

---

## U

### UCITS ETF
An ETF domiciled in the EU (most often Ireland) under the UCITS framework. For non-US investors it typically means 15% fund-level US withholding under the US–Ireland treaty, accumulating share classes, and no US estate-tax exposure — at a slightly higher fee and wider spreads. US persons should not buy them (PFIC rules).
- **Good / bad:** Often wins after tax for a no-treaty investor despite the higher TER. Not tax advice.
- **Surfaced by:** `tax-lens --non-us`, `etf-analysis`.

---

## V

### VaR / CVaR (Value at Risk / Conditional VaR)
VaR: the loss you would not expect to exceed over a horizon at a confidence level (e.g. 95%, one month). CVaR (expected shortfall): the *average* loss in the cases beyond VaR — the tail VaR ignores.
- **Good / bad:** Parametric VaR assumes normal returns and understates crashes; trust the historical scenario replay when they disagree.
- **Surfaced by:** `risk-stress-test`.

---

## W

### W-8BEN
The IRS form a non-US individual gives a broker to certify non-US status and claim any treaty rate on US-source income. Generally valid through the end of the third calendar year after signing; an expired form means statutory withholding.
- **Good / bad:** On file and current — or 30% (and possibly backup withholding). Not tax advice.
- **Surfaced by:** `tax-lens --non-us`.

### WACC (Weighted Average Cost of Capital)
The blended required return on a company's debt and equity — the discount rate in a DCF. `(E/V × Cost of Equity) + (D/V × Cost of Debt × (1−tax))`.
- **Good / bad:** not good/bad — it's the hurdle. A small WACC change swings intrinsic value a lot.
- **Surfaced by:** `dcf-valuation`.

### Wash Sale
A loss that is disallowed for US tax because the same or a substantially identical security was bought within **30 days before or after** the sale (a 61-day window) — in any of your accounts, including DRIP purchases and IRAs. The loss is added to the replacement shares' basis, not lost.
- **Good / bad:** Check the window before every loss sale. US rules; not tax advice.
- **Surfaced by:** `tax-lens`, `position-ladder`.

### Whisper Number
The unofficial, buy-side expectation for a company's results — usually above the published consensus for a stock that has been running. The bar the stock *actually* trades against. Always an estimate; label its source.
- **Good / bad:** A large whisper gap over consensus is how a headline "beat" becomes a drop.
- **Surfaced by:** `earnings-preview`.

### Withholding Tax
Tax taken out of a dividend before it reaches the investor. For a non-US holder of US stocks the statutory rate is **30%**, reduced only by an income-tax treaty claimed on a W-8BEN (Taiwan, Hong Kong, and Singapore have no US treaty). A 3.0% gross yield is 2.1% net at 30%.
- **Good / bad:** The single largest tax cost for most non-US dividend investors. Not tax advice.
- **Surfaced by:** `tax-lens --non-us`, `dividend-analysis`.

---

## Y

### Yield Trap
A stock with a tempting dividend yield that is unsustainable — the market has priced in a coming cut. Spotted via payout ratio > 100%, falling FCF, or rising debt.
- **Surfaced by:** `dividend-analysis`. See [Use Cases → The dividend investor](use-cases.html#the-dividend--income-investor).

---

> **See also:** [Concepts](concepts.html) for the mental models behind these metrics · [Choose a Skill](choose-a-skill.html) to find the right framework · [Data & Accuracy](data-and-accuracy.html) for how to trust the numbers.

*Educational reference only. Not financial advice.*
