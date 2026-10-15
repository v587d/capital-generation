# Analysis Framework

Part 1 of 3 for `insider-trading` — Analysis Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Analysis Framework

### 1. Transaction Summary (Last 6-12 Months)

Provide overview of insider trading activity:

**Transaction Counts**
- Total transactions: [Number]
- Buys: [Number] ([%] of total)
- Sells: [Number] ([%] of total)
- Exercises/Awards: [Number] (non-market transactions)

**Transaction Volume**
- Total value traded: $[Amount]
- Buy volume: $[Amount]
- Sell volume: $[Amount]
- Net insider sentiment: $[Net Amount] (Buy - Sell)

**Active Period Analysis**
- Most active month: [Month]
- Clustered activity periods: [Dates]
- Quiet periods: [Dates]

### 2. Insider Sentiment Analysis

Calculate and interpret net insider sentiment:

**Net Sentiment Calculation**
```
Net Sentiment = (Buy $ - Sell $) / (Buy $ + Sell $)

Ranges:
+0.5 to +1.0  = Strongly Bullish
+0.2 to +0.5  = Moderately Bullish
-0.2 to +0.2  = Neutral
-0.5 to -0.2  = Moderately Bearish
-1.0 to -0.5  = Strongly Bearish
```

**Sentiment Context**
- Current sentiment vs. historical baseline
- Sentiment trend (improving/deteriorating)
- Significance level (number and size of transactions)
- Comparison to peer company insiders

**Reliability Factors**
- Sample size (number of insiders trading)
- Transaction size relative to holdings
- Timing relative to information events
- Consistency across multiple insiders

### 3. Significant Transactions

Highlight meaningful insider trades:

**Criteria for Significance**
- Transaction size > $1 million
- Position change > 10% of holdings
- Unusual timing (near lows/highs, before announcements)
- CEO or CFO transactions
- Multiple insiders trading in same direction within short period

**For Each Significant Transaction**

| Date | Insider | Position | Transaction | Shares | Value | % of Holdings | Price | Notes |
|------|---------|----------|-------------|--------|-------|---------------|-------|-------|
| [Date] | [Name] | [Title] | Buy/Sell | [#] | $[Amount] | [%] | $[Price] | [Context] |

**Transaction Analysis**
- **Bullish Signals**: Large insider buys, clustered buying, CEO purchases, buying near 52-week lows
- **Bearish Signals**: Large insider sells, clustered selling, executive selling before bad news
- **Neutral Signals**: Small routine sells for diversification, 10b5-1 plan executions

### 4. Insider Categories

Analyze transactions by insider role:

**Executive Officers (CEO, CFO, COO)**
- Highest signal value due to information access
- Large transactions particularly meaningful
- Sales less concerning if part of regular compensation

**Board of Directors**
- Independent directors' purchases carry strong signals
- Less frequent trading but often meaningful
- May have strategic visibility beyond operations

**Major Shareholders (>10% owners)**
- Often have board seats or strategic influence
- Large transactions can move markets
- Sales may be for portfolio rebalancing

**Other Insiders (VPs, Senior Managers)**
- Weaker signal but useful in aggregate
- Clustered activity more meaningful than individual trades
- May indicate operational knowledge

### 5. Transaction Types & SEC Forms

Interpret different transaction codes:

**Form 4 Transaction Codes**
- **P (Purchase)**: Open market buy - BULLISH SIGNAL
- **S (Sale)**: Open market sell - BEARISH SIGNAL (but often routine)
- **M (Exercise)**: Option exercise - Neutral
- **F (Tax Payment)**: Shares surrendered for taxes - Neutral
- **A (Award)**: Stock grant/award - Neutral
- **G (Gift)**: Gift transfer - Neutral
- **D (Disposition)**: Return to company - Neutral

**Form 3 vs. Form 4 vs. Form 5**
- **Form 3**: Initial statement of beneficial ownership (new insider)
- **Form 4**: Changes in ownership (filed within 2 business days)
- **Form 5**: Annual statement of changes (deferred reporting)

**10b5-1 Trading Plans**
- Pre-arranged trading plans to avoid insider trading allegations
- Marked in filings if transaction was under 10b5-1
- Less signal value than discretionary trades
- Look for plan adoption/termination patterns

### 6. Ownership Trends

Track changes in insider ownership percentage:

**Current Ownership Structure**
- Total insider ownership: [%]
- CEO ownership: [%]
- Top 5 insiders combined: [%]

**Ownership Trend (12 months)**
```
Quarter        Total Insider %    Change from Prior
[Qn YYYY]          [%]              [±%]
[Qn-1 YYYY]        [%]              [±%]
[Qn-2 YYYY]        [%]              [±%]
[Qn-3 YYYY]        [%]              [±%]
```

**Interpretation**
- **Increasing ownership**: Insiders accumulating = Bullish
- **Stable ownership**: Confidence maintained = Neutral to Bullish
- **Decreasing ownership**: Distribution = Bearish (but check reasons)

**Skin in the Game Assessment**
- High insider ownership (>20%): Strong alignment
- Medium ownership (10-20%): Adequate alignment
- Low ownership (<10%): Weaker alignment
- CEO ownership relative to compensation

### 7. Timing Analysis

Evaluate timing of insider transactions:

**Relative to Stock Price**
- Buying near 52-week lows: Strong bullish signal
- Buying after significant decline: Contrarian confidence
- Selling near 52-week highs: Less bearish (profit-taking)
- Selling before decline: Red flag if not disclosed later

**Relative to Information Events**
- Before earnings release
- Before major announcements (M&A, product launches)
- During blackout periods (should be restricted)
- After significant news (reaction to public information)

**Seasonal Patterns**
- Post-earnings window trading (common)
- Year-end tax-loss selling
- Quarterly option exercise cycles
- Annual equity grant patterns

**Red Flag Timing**
- Trading during supposed blackout periods
- Selling shortly before bad news announcement
- Exercising and immediately selling (vs. holding)
- Rapid succession of sells by multiple insiders


This section is not finished here: `Analysis Framework` continues in `references/11-pattern-recognition.md`.
