# Analysis Framework(continued)

Part 2 of 3 for `short-interest` — Analysis Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### 4. Bearish Thesis Evaluation

Understand why short sellers are positioned against the company:

**Common Short Thesis Categories**
- **Accounting concerns**: Revenue recognition irregularities, off-balance-sheet liabilities, undisclosed related-party transactions (Hindenburg Research, Muddy Waters Research methodologies)
- **Business model deterioration**: Loss of competitive advantage, customer churn, unit economics breakdown
- **Competition threats**: New entrant disrupting market, margin compression from rivals
- **Regulatory or legal risk**: Pending investigations, product liability, antitrust exposure
- **Valuation excess**: Momentum short — stock priced for perfection with no margin of safety (SPAC shorts, meme stocks)
- **Structural decline**: Industry secular headwinds, obsolescence risk, debt spiral

**Short Seller Credibility Assessment**
- Known activist short sellers (Hindenburg, Citron, Muddy Waters, Gotham City): publish detailed reports, track record publicly known
- Hedge fund shorts (13F disclosures): disclosed quarterly, often fundamental/valuation-based
- Anonymous internet posts: low credibility, but sometimes contain legitimate leads
- Evaluate track record: success rate of prior short thesis for identified short seller

**Counterarguments to Short Thesis**
- What data would disprove the bearish case?
- Has management addressed the concerns publicly?
- Are there independent analysts or auditors refuting the claims?
- Is there a fundamental value floor (book value, sum-of-parts) that limits downside?
- Has the stock already priced in the worst-case scenario?

### 5. Options Market Signal Integration

Read options positioning as a forward-looking indicator of expected moves:

**Put/Call Ratio Analysis**
- Put/Call open interest ratio > 1.5: heavy hedging or speculative bearish bet
- Put/Call volume ratio spike: institutional protection buying (precedes downside)
- Call/Put ratio spike: aggressive bullish buying or short hedge activity
- Compare current ratio vs. 30/60/90-day average to identify anomalies

**Implied Volatility Skew**
- **Negative skew (normal for stocks)**: OTM put IV > OTM call IV — market pricing asymmetric downside
- **Skew steepening**: increasing fear of downside, shorts adding OTM put protection
- **Skew flattening or reversal**: call buying exceeds put buying — squeeze setup or bullish catalyst anticipated
- Track 25-delta put IV minus 25-delta call IV as skew measure

**Large Options Activity Signals**
- Large OTM put purchases (protective hedges from longs or speculative shorts)
- Heavy OTM call buying near key resistance: anticipation of short squeeze catalyst
- Gamma exposure at strikes: dealer hedging requirements create mechanical price pressure at specific levels
- Unusual options activity 1-5 days before price move: informed positioning

### 6. Technical Analysis of Short Positions

**Short Seller Cost Basis Estimation**
- Average price of shares shorted (based on short interest trend vs. stock price timeline)
- Are shorts currently at a profit (stock below average short price) or a loss (stock above)?
- Underwater shorts = trapped shorts = higher squeeze probability as losses mount

**Key Price Levels for Short Positioning**
- Resistance zones where shorts typically initiate positions
- Prior failed breakout levels (shorts cluster above failed resistance)
- 52-week high: shorts often add above if they believe stock is overvalued
- Volume-weighted average price of recent short interest build

**Short Covering Patterns in Price Action**
- Sharp V-reversal on elevated volume with no obvious news: forced covering
- Gap-up openings held and extended: short sellers unable to lean on stock
- Failure to break below support despite negative sentiment: shorts losing control
- Morning spike followed by day-long grind higher: staggered covering through session

**Support Levels Affecting Covering Triggers**
- Key technical support: breakdown below = shorts add, hold = shorts must cover
- 200-day moving average: institutional reference level where shorts reconsider
- Prior consolidation zones: base building = shorts squeezed out on breakout

### 7. Reporting Schedule and Data Lag

**FINRA Short Interest Reporting Calendar**
- Short interest is reported as of the 15th and last business day of each month
- Data published approximately 4-5 business days after the settlement date
- Result: up to a 2-week data lag between actual positioning and publicly available data
- Critical caveat: short interest data reflects past positioning, not current

**Exchange-Reported Short Interest**
- NYSE and NASDAQ publish their own short interest data on similar schedules
- Cross-reference exchange data with FINRA for completeness
- Real-time short volume (vs. short interest) available daily from FINRA and exchanges

**Using Short Volume Data for Fresher Signal**
- Daily short volume (available same day via FINRA Rule 4560): not equal to short interest
- Short volume / total volume ratio: measures daily bearish activity direction
- Short volume ratio > 50% sustained over multiple days: active selling pressure
- Limitation: covers only on-exchange transactions, misses OTC activity

### 8. Risk Considerations

**Risks for Short Sellers**
- Unlimited loss potential: no cap on how high a stock can rise
- Borrow recall: prime broker can force position closure on short notice
- Dividend obligation: short sellers must pay dividends to the shares they borrowed
- Regulatory restrictions: short sale restriction (SSR) rule triggers when stock falls 10% in a day, restricting short sales
- Crowded short: many shorts in same name = all exit simultaneously on negative news = violent squeeze

**Risks for Long Traders Playing Squeeze**
- Crowded momentum trade: late entrants face no new buyers once squeeze exhausts
- Fundamental deterioration: short thesis may be correct — stock declines post-squeeze
- Entry timing risk: squeezes can reverse violently once covering is complete
- Borrow constraints: difficulty exiting short at target because all brokers pulling borrow simultaneously
- Regulatory risk: market manipulation scrutiny for coordinated squeeze activity

**Position Sizing Guidelines**
- Short squeeze plays: high risk/high reward, size accordingly (1-3% of portfolio maximum)
- Risk is binary: squeeze fully materializes or fundamental thesis plays out
- Define exit criteria before entry — both upside target and stop-loss level


This section is not finished here: `Analysis Framework` continues in `references/12-data-sources.md`.
