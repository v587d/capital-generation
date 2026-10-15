# Analysis Framework(continued)

Part 3 of 4 for `options-analysis` — Analysis Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### 5. Earnings Play Analysis

**IV Crush Dynamics**
- IV rises steadily in the 2-4 weeks before earnings as uncertainty increases
- On the day after earnings announcement, IV collapses 30-50% (volatility crush)
- This crush destroys long premium value even if the stock moves significantly
- Short premium strategies capture this crush but face the binary event risk

**Expected Move Calculation**
```
Expected Move (EM) = ATM Straddle Price / Stock Price × 100

Example: Stock at $100, ATM straddle costs $7.00
Expected Move = 7.0 / 100 × 100 = 7.0%
Market implying 68% probability stock stays within +/-$7 of current price
```

**Historical Earnings Move Analysis**
- Compare actual historical earnings moves vs. expected move at time of earnings
- If stock regularly moves ≥ 1.5x the expected move: favor buying straddle/strangle (breakeven likely exceeded)
- If stock regularly moves < 0.7x the expected move: favor selling premium (iron condor, short strangle)
- Look at last 8 quarterly earnings reactions for statistically meaningful sample

**Earnings Straddle Setup**
- Buy ATM call + ATM put with same strike and expiration just before earnings
- Profit if stock moves more than combined cost of both options (breakeven points = strike ± total premium)
- Risk: theta decay into earnings + IV crush if move is below expected move
- Optimal entry: 7-14 days before earnings (balances theta risk vs. IV run-up capture)

**Defined Risk Earnings Structures**
- **Long strangle**: OTM call + OTM put, cheaper than straddle, requires larger move to profit
- **Broken wing butterfly**: Define maximum risk, profit if stock pins near current level, smaller debit
- **Earnings iron condor**: Sell wings around expected move, profit if stock stays within range

### 6. Risk Management

**Maximum Loss Scenarios by Strategy**
- Long call / Long put: Max loss = premium paid (100% of investment)
- Bull/Bear spread: Max loss = net debit paid
- Iron condor: Max loss = wing width minus total credit received
- Short straddle / strangle: Max loss = theoretically unlimited (capped by stock going to zero for puts)
- Covered call: Max loss = stock cost basis minus premium received (stock declining to zero)

**Position Sizing**
- Long options premium risk: limit to 2-5% of portfolio per trade (entire premium can be lost)
- Short premium, **defined-risk** (credit spreads, iron condors, iron butterflies): max loss = spread width − credit; size so that max loss is 1-3% of portfolio
- Short premium, **undefined-risk** (short straddles, short strangles, naked puts/calls): loss is not capped by a spread width — size on a stress loss instead: assume a 2-standard-deviation move (or the stock's worst historical earnings gap, whichever is larger) and keep that loss to 1-3% of portfolio; keep buying-power reduction under 20% of the account; and never carry an undefined-risk position through earnings without a pre-set exit level
- Never let a single options position represent more than 10% of total portfolio market value
- For speculative OTM long options: size even smaller (0.5-1%) given low probability of profit

**Delta Hedging for Complex Positions**
- Monitor portfolio delta daily for active options books
- Adjust underlying stock position to maintain target delta exposure (delta-neutral if desired)
- Frequency of hedging: daily for near-expiry positions, weekly for longer-dated positions
- Hedging costs: transaction costs erode gamma scalping profits; only hedge on meaningful delta drift

**Rolling Positions**
- When to roll: option approaching expiration with significant unrealized gain or at risk of assignment
- Rolling out: buy to close current expiration, sell to open further expiration (extends duration)
- Rolling out and up/down: change both expiration and strike
- Roll mechanics: attempt to collect additional credit (for short options) or minimal debit

**Stop-Loss Guidelines**
- Long options (debit): consider closing when position loses 50% of premium paid
- Short options (credit): consider closing when position reaches 2x the credit received (200% of max profit in losses)
- Hard rule: never let a defined-risk spread reach maximum loss without reassessment

**Common Mistakes to Avoid**
- Holding long OTM options to expiration hoping for recovery (usually expires worthless)
- Selling naked short puts or calls without understanding assignment risk
- Ignoring bid/ask spread in illiquid options (wide spread = immediate cost)
- Over-leveraging via too many contracts on speculative OTM options
- Forgetting earnings/ex-dividend dates that create event risk on existing positions

### 7. Options Chain Reading Guide

**Key Chain Columns**
- **Bid / Ask**: Market-maker buy price and sell price — execute near midpoint for better fills
- **Last trade price**: Often stale; use bid/ask midpoint for current value
- **Volume**: Contracts traded today — high volume = active interest, easier to fill
- **Open Interest (OI)**: Total outstanding contracts — high OI = liquidity and tight spreads
- **IV per strike**: Varies by strike (shows skew visually across the chain)
- **Delta, Gamma, Theta, Vega**: Displayed per-contract for each strike

**Bid/Ask Spread Importance**
- Wide bid/ask spread = illiquid options = avoid or expect significant slippage
- Good liquidity threshold: bid/ask spread < 10% of option midprice
- Actively traded tickers (AAPL, SPY, QQQ): penny-wide spreads on ATM options
- Small-cap or low-volume stocks: may have $0.50+ spreads that erode profitability

**Open Interest Accumulation as Price Levels**
- Strikes with very high OI often act as price magnets (max pain theory) near expiration
- Institutional hedging clusters at round number strikes (every $5 or $10 increments)
- Dealer gamma exposure at high-OI strikes: dealers hedge dynamically, creating mechanical buying/selling pressure
- Max pain price: strike at which maximum total options value expires worthless

**Volume vs. OI Interpretation**
- Volume > OI: New positions being opened (not just rolls of existing positions)
- Volume << OI: Trading is closing or rolling existing positions
- Large single print on low-OI strike: new speculative or informed position (unusual activity alert)
- Volume spike with no news: potential informed positioning ahead of catalyst


This section is not finished here: `Analysis Framework` continues in `references/13-data-sources.md`.
