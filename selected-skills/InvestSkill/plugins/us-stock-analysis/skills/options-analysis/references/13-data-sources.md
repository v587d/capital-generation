# Analysis Framework(continued)

Part 4 of 4 for `options-analysis` — Analysis Framework; Input Formats; Output; Standard Signal Output; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### 8. Data Sources

**Primary Trading Platforms with Full Greeks**
- **Thinkorswim (TD Ameritrade / Schwab)**: Comprehensive options chain, Greeks, IV analysis, probability cones
- **Interactive Brokers (IBKR)**: Options analytics, volatility trader tools, probability of expiring
- **Tastytrade**: Options-specific platform, IV rank/percentile, theta decay tracking

**Free Analytics Tools**
- **Market Chameleon**: IV rank, IV percentile, term structure, earnings IV history — all free
- **Barchart Options**: Options flow, unusual activity, Greeks by strike (free tier available)
- **Options Profit Calculator (optionsprofitcalculator.com)**: Visual P&L diagrams for strategies (free)
- **Power E*TRADE**: Options analytics and strategy builder

**Options Flow and Unusual Activity**
- **Unusual Whales**: Options flow tracking, dark pool data, unusual activity scanner
- **Flowalgo**: Real-time unusual options activity alerts (premium)
- **Cheddar Flow**: Institutional options flow visualization

**Reference Data**
- **Options Clearing Corporation (OCC)**: Volume and OI data, contract specifications
- **CBOE**: VIX data, volatility indices, SPX/SPY options data

## Input Formats

### Format 1: Greeks Analysis
```
User: /options-analysis AAPL --greeks

Claude analyzes ATM and key strikes across near-term expirations, summarizes Greeks profile
```

### Format 2: Strategy Recommendation
```
User: /options-analysis TSLA --strategy bullish

Claude evaluates current IV environment, selects optimal bullish strategies, provides specific setups
```

### Format 3: Earnings Play Analysis
```
User: /options-analysis NVDA --earnings

Claude computes expected move, reviews historical earnings reactions, recommends earnings strategy
```

### Format 4: IV Analysis
```
User: /options-analysis SPY --iv

Claude provides full IV analysis: IVR, IVP, term structure, skew, HV comparison
```

## Output

Provide a comprehensive options analysis report with the following sections:

### 1. Options Overview
```
Underlying:              [TICKER]
Current Price:           $XXX.XX
ATM Implied Volatility:  XX.X%
IV Rank (IVR):           XX%    (52-wk Range: XX% - XX%)
IV Percentile (IVP):     XX%
Historical Volatility:   XX.X%  (30-day realized)
IV vs. HV:               X.Xx   (Overpriced / Underpriced)
Next Earnings:           [Date] (XX days)
```

### 2. Greeks Summary (ATM Nearest Expiry)
```
Strike:       $XXX       Expiry: [Date]    DTE: XX
─────────────────────────────────────────
Call Greeks:  Delta +X.XX | Gamma X.XX | Theta -$X.XX/day | Vega $X.XX/1%IV
Put Greeks:   Delta -X.XX | Gamma X.XX | Theta -$X.XX/day | Vega $X.XX/1%IV
─────────────────────────────────────────
Expected Move (±1σ to expiry): $X.XX (X.X%)
```

### 3. IV Analysis Summary
- IV vs. HV assessment (are options cheap or expensive?)
- IVR/IVP interpretation with action bias
- Term structure shape (contango vs. backwardation)
- Skew assessment and directional implication
- If near earnings: IV run-up remaining and expected crush magnitude

### 4. Recommended Strategies (Top 2-3)

For each recommended strategy:
- Strategy name and structure (which strikes, which expiry)
- Rationale (why this strategy fits current IV and outlook)
- Max profit / Max loss
- Breakeven price(s)
- Probability of profit (from delta approximation)
- Ideal outcome scenario

### 5. Key Levels for Options
- Strike clustering (high OI strikes = market-recognized levels)
- Support / resistance relevant to spread placement
- Max pain price for nearest monthly expiry

### 6. Entry and Exit Guidelines
- Suggested entry timing (DTE target, IV condition to trigger entry)
- Profit target: close at X% of max profit (e.g., 50% for iron condors, 75% for short spreads)
- Stop-loss trigger
- Adjustment plan if position moves against you

### 7. Upcoming Catalyst Calendar
- Earnings date and expected move (if applicable)
- Ex-dividend date (assignment risk for short calls)
- Any scheduled corporate events (investor day, product launch, FDA decision)

## Standard Signal Output

All analysis concludes with this standardized block:

```
## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH — thesis breaks if:**
- IV Rank drops below 10 suggesting complacency AND put/call ratio inverts bearishly
- [One or two more triggers drawn from this analysis's own drivers, each with a threshold]

**If signal is BEARISH — thesis breaks if:**
- unusual call buying >3x average AND IV skew flips to call premium
- [One or two more triggers drawn from this analysis's own drivers, each with a threshold]

**Re-run this analysis when:**
- [ ] Next earnings release
- [ ] Price moves ±15% from current level
- [ ] 60 days have elapsed
- [ ] Material news event (acquisition, leadership change, regulatory decision)

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

**Disclaimer:** Educational analysis only. Not financial advice.


