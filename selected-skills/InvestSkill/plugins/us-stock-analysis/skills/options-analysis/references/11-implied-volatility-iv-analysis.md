# Analysis Framework(continued)

Part 2 of 4 for `options-analysis` — Analysis Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### 3. Implied Volatility (IV) Analysis

**IV vs. Historical Volatility (HV)**
- **IV (Implied Volatility)**: Forward-looking volatility derived from current option prices — reflects market's expectation of future price swings
- **HV (Historical Volatility)**: Realized past volatility measured over 20, 30, or 60 days
- **IV > HV**: Options are expensive relative to recent realized movement — favor selling premium (credit strategies)
- **IV < HV**: Options are cheap relative to recent realized movement — favor buying premium (debit strategies)
- **IV/HV ratio**: >1.2 = meaningfully overpriced, <0.8 = meaningfully underpriced

**IV Rank (IVR)**
```
Formula: IVR = (Current IV - 52-Week Low IV) / (52-Week High IV - 52-Week Low IV) × 100

Example: Current IV 35%, 52-wk Low 20%, 52-wk High 60%
IVR = (35 - 20) / (60 - 20) × 100 = 37.5%

IVR Interpretation:
>70%    Very High — IV near 52-week highs, strongly favor selling premium
50-70%  High — elevated IV, lean toward selling premium
30-50%  Moderate — mixed, direction-dependent strategies
<30%    Low — IV near 52-week lows, favor buying premium or debit spreads
<15%    Very Low — cheapest options of the year, consider long volatility
```

**IV Percentile (IVP)**
- Definition: Percentage of trading days in the past 252 days where IV was lower than the current reading
- IVP 80% = IV is higher today than on 80% of trading days in the past year
- More statistically robust than IVR because IVR can be skewed by a single outlier high or low
- IVP > 50%: favor selling premium | IVP < 30%: favor buying premium

**IV Term Structure**
- **Contango (normal)**: Near-term IV < far-term IV — calm near-term environment, uncertainty longer-dated
- **Backwardation (inverted)**: Near-term IV > far-term IV — acute fear or event in immediate future
- Steep backwardation: market pricing major near-term risk (earnings miss, regulatory event, macro shock)
- Calendar spread opportunity: sell high near-term IV, buy lower far-term IV (take advantage of backwardation)

**IV Skew Analysis**
- **Put skew**: OTM put IV > OTM call IV — standard condition in equity markets (portfolio protection demand)
- **Steep negative skew**: Market pricing significant downside protection — fear elevated, consider selling OTM puts
- **Skew reversal (call skew)**: OTM call IV > OTM put IV — squeeze expectation, binary upside event anticipated
- **Risk reversal metric**: 25-delta put IV minus 25-delta call IV. Higher value = steeper put skew.
- Skew changes directionally: steepening skew = increasing fear, flattening skew = reducing downside concern

**Volatility Crush (Post-Event IV Collapse)**
- IV systematically rises into known binary events: earnings, FDA decisions, investor days, FOMC
- IV collapses immediately after the event as uncertainty resolves — regardless of the price move direction
- Average IV crush on earnings: 30-50% drop in IV on the day following announcement
- Implication: long premium strategies must have a move that exceeds the expected move to profit; short premium strategies profit even if stock moves, as long as within expected range

### 4. Strategy Selector

Select the optimal strategy based on market outlook and IV environment:

**Bullish Strategies**

| Strategy | When to Use | IV Preference | Max Profit | Max Loss |
|----------|------------|---------------|------------|----------|
| Buy Call | Strongly bullish, conviction directional bet | Low IV (IVR <30%) | Unlimited | Premium paid |
| Bull Call Spread | Moderately bullish, reduce cost, cap profit | Any IV | Strike spread minus debit | Debit paid |
| Cash-Secured Put | Bullish/neutral, willing to own stock at lower price | High IV (IVR >50%) | Premium collected | Strike minus premium |
| Covered Call | Bullish/neutral, income on existing position | High IV (IVR >50%) | Premium + upside to strike | Stock cost minus premium |

**Bearish Strategies**

| Strategy | When to Use | IV Preference | Max Profit | Max Loss |
|----------|------------|---------------|------------|----------|
| Buy Put | Strongly bearish, protection or directional bet | Low IV (IVR <30%) | Strike minus premium | Premium paid |
| Bear Put Spread | Moderately bearish, reduce cost, define risk | Any IV | Strike spread minus debit | Debit paid |
| Bear Call Spread | Bearish/neutral, sell premium with defined max loss | High IV (IVR >50%) | Credit received | Strike spread minus credit |

**Neutral and Volatility Strategies**

| Strategy | When to Use | IV Preference | Max Profit | Max Loss |
|----------|------------|---------------|------------|----------|
| Iron Condor | Neutral price, range-bound | High IV (IVR >50%) | Full credit | Wing spread minus credit |
| Iron Butterfly | Neutral, max decay at single price point | High IV (IVR >50%) | Full credit | Wing spread minus credit |
| Short Straddle | Neutral, sell both call and put ATM | Very High IV | Full credit | Unlimited (uncapped) |
| Long Straddle | Expecting large move, unknown direction | Low IV (IVR <20%) | Unlimited | Both premiums paid |
| Long Strangle | Large move expected, OTM for lower cost | Low IV (IVR <20%) | Unlimited | Both premiums paid |

**Strategy Selection Matrix**

```
                        IV High (IVR >50%)       IV Low (IVR <20%)
─────────────────────────────────────────────────────────────────────
Strongly Bullish:       Bull Call Spread          Buy Call
Mildly Bullish:         Cash-Secured Put          Bull Call Spread
Neutral:                Iron Condor               Long Straddle / Strangle
Mildly Bearish:         Bear Call Spread          Bear Put Spread
Strongly Bearish:       Bear Put Spread           Buy Put
High Volatility:        Short Straddle            Long Straddle
Low Conviction:         Iron Condor               Calendar Spread
─────────────────────────────────────────────────────────────────────
```


This section is not finished here: `Analysis Framework` continues in `references/12-earnings-play-analysis.md`.
