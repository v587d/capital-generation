# Analysis Framework(continued)

Part 3 of 3 for `short-interest` — Analysis Framework; Input Formats; Output; Standard Signal Output; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### 9. Data Sources

**Short Interest Data**
- **FINRA Short Interest Data**: finra.org/investors/short-sale-volume-data (official, free, twice-monthly)
- **NYSE Short Interest Reports**: NYSE-listed stocks, semi-monthly
- **NASDAQ Short Interest Reports**: NASDAQ-listed stocks, semi-monthly
- **Shortvolume.com**: Free daily short volume data by ticker

**Screeners and Analytics**
- **Finviz**: Short float % in stock screener (sortable, free)
- **Market Chameleon**: Short interest trend charts, borrow rate tracking
- **Iborrowdesk.com**: Free near-real-time borrow rate data from Interactive Brokers and TD Ameritrade

**Premium Short Data**
- **S3 Partners**: Professional-grade short analytics, real-time borrow rates, predictive short interest
- **Interactive Brokers Stock Loan Availability**: Borrow rate and availability for account holders
- **Bloomberg Terminal**: SRFD function for comprehensive short interest data

## Input Formats

### Format 1: Single Stock Analysis
```
User: /short-interest GME

Claude retrieves current short float, DTC, borrow rate, and computes Squeeze Score
```

### Format 2: Squeeze Potential Scan
```
User: /short-interest --scan squeeze-potential

Claude screens for stocks meeting high Squeeze Score criteria (short float >20%, DTC >10, catalyst present)
```

### Format 3: Sector Short Analysis
```
User: /short-interest --sector technology

Claude identifies most shorted technology stocks and evaluates comparative squeeze potential
```

## Output

Provide a comprehensive short interest analysis report with the following sections:

### 1. Short Interest Summary
```
Ticker:                  [TICKER]
Short Float %:           XX.X%       (Threshold: >20% = High)
Short Interest (shares): XX,XXX,XXX
Days to Cover (DTC):     X.X days    (Threshold: >10 = Elevated)
Borrow Rate:             X.X%        (Classification: Easy/Hard/Extreme)
Short Interest Trend:    Increasing / Stable / Decreasing
Last Reporting Date:     [Date]      (Note: ~2-week lag)
```

### 2. Squeeze Score Breakdown
```
Component                     Condition          Points
Short float > 20%             YES / NO           X/3
DTC > 10 days                 YES / NO           X/2
Recent positive catalyst       YES / NO           X/2
Price above 50-day MA         YES / NO           X/1
Float < 50M shares            YES / NO           X/1
Borrow rate > 5%              YES / NO           X/1
                              TOTAL SCORE:       X/10

Squeeze Probability: Low / Moderate / High / Very High / Extreme
```

### 3. Short Thesis Summary
- Primary bear thesis (1-3 sentence summary of why shorts are positioned here)
- Source of short thesis (activist report, valuation, fundamental deterioration)
- Short seller credibility assessment

### 4. Counter-Thesis
- Key arguments that could prove shorts wrong
- Fundamental floor (book value, earnings power)
- Upcoming catalysts that could force covering

### 5. Options Market Context
- Put/Call ratio vs. 30-day average
- IV skew assessment (steep put skew vs. flat)
- Any unusual options activity flagged

### 6. Technical Setup
- Is stock above or below 50/200-day moving average?
- Key support and resistance levels
- Is price action consistent with squeeze initiation or continued decline?

### 7. Risk/Reward Assessment
- For long (squeeze play): upside target, stop-loss, probability-weighted expected return
- For short (bearish thesis): downside target, covering trigger, maximum loss scenario

### 8. Monitoring Triggers
- Short interest change threshold that would upgrade or downgrade squeeze probability
- Catalyst calendar (earnings date, product event, regulatory decision)
- Borrow rate level that signals imminent covering pressure
- Price level that would technically confirm squeeze initiation

## Standard Signal Output

All analysis concludes with this standardized block:

```
## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH — thesis breaks if:**
- short float rises above 20% AND days-to-cover increases >10 without a catalyst
- [One or two more triggers drawn from this analysis's own drivers, each with a threshold]

**If signal is BEARISH — thesis breaks if:**
- short float drops below 3% AND squeeze signals activate (borrow rate >50%)
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


