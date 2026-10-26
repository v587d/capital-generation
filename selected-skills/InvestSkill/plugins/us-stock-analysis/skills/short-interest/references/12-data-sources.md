# Analysis Framework(continued)

Part 3 of 3 for `short-interest` — Analysis Framework; Input Formats; Output; Standard Signal Output; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### 9. Evidence to request

Ask the host data contract for the short-side evidence and say which reporting date each item belongs to:

- **Settlement-dated short interest** — short interest, average daily volume and days-to-cover for each twice-monthly settlement date, with the exchange that published it
- **Short volume** — daily short volume and total volume, if the host returns it; it is not the same measure as short interest and must not be substituted for it
- **Borrow data** — borrow fee and lendable supply, with the timestamp and the venue that quoted it
- **Float and share count** — the issuer's latest reported share count and float, since short-float percentages are computed against it
- **Filings context** — a shelf or convert issuance that could explain a hedging-related short position

Label a third-party screen or an estimated borrow fee as secondary. A settlement date that did not come back stays blank rather than being interpolated from the neighbouring dates.

## Input Formats

### Format 1: Single Stock Analysis
```
User: /short-interest GME

The agent requests current short float, DTC and borrow rate through the host data contract, then computes the Squeeze Score
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


