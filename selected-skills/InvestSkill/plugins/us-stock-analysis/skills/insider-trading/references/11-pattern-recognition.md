# Analysis Framework(continued)

Part 2 of 3 for `insider-trading` — Analysis Framework; Input Formats; Output
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### 8. Pattern Recognition

Identify meaningful patterns in trading activity:

**Bullish Patterns**
- Clustered buying by multiple insiders within 1-2 weeks
- First-time purchases by long-tenured executives
- Buying during period of stock weakness or negative sentiment
- Insiders increasing position size significantly (>25%)
- CEO making largest purchase of tenure

**Bearish Patterns**
- Clustered selling by multiple insiders
- CEO or CFO selling large percentage of holdings
- First-time sells by insiders who previously only bought
- Selling despite stock decline (urgency to exit)
- Executive departures followed by sales

**Neutral Patterns**
- Regular quarterly option exercises and sells
- Small percentage sells for diversification (<5% of holdings)
- Tax payment share forfeitures
- Routine 10b5-1 plan executions
- Gift transfers to family trusts

### 9. Red Flags & Warning Signs

Identify concerning patterns:

**High-Severity Red Flags**
- CEO or CFO selling >50% of holdings
- Clustered selling before earnings miss or guidance cut
- Trading during blackout window
- Late Form 4 filing (>2 days) without explanation
- Pattern of selling before negative news

**Medium-Severity Red Flags**
- Increasing rate of insider selling
- Multiple executives selling simultaneously
- Selling despite recent insider buying by others
- Large sales shortly after option vesting
- Board member resignations followed by sales

**Context Matters**
- Insider selling is common and often benign
- Check for 10b5-1 plans (pre-arranged sales)
- Consider personal circumstances (divorce, estate planning)
- Look at historical patterns for that individual
- Assess whether selling is proportional to holdings

### 10. Evidence to request

Ask the host data contract for insider filings and their fields:

- **Filings** — Forms 3, 4 and 5 for the issuer and for the insiders named in the claim; a Form 4 is due within two business days of the transaction
- **Return fields** — insider name and title, transaction date, filing date, shares bought or sold, price per share, shares owned after the transaction, transaction code (P, S, M, …), and any 10b5-1 plan footnote
- **Aggregates** — an insider-sentiment or cluster score is a secondary figure unless it names the filings it was computed from; label it as such

Request by issuer and by insider, not by vendor. A filing that cannot be retrieved stays missing; do not fill the row from a summary site or from memory. When only an aggregate is available, show the filings it claims to summarise next to it — if the aggregate cannot name them, it cannot support a conviction call.

**Fields the analysis needs**
- Insider name and title
- Transaction date and filing date
- Shares bought/sold
- Price per share
- Shares owned after transaction
- Transaction code (P, S, M, etc.)
- Form 4 footnotes (10b5-1 plan indicator)

## Input Formats

### Format 1: Ticker Symbol
```
User: /insider-trading AAPL

The agent requests recent Form 4 data through the host data contract and analyzes it
```

### Format 2: Specific Time Period
```
User: /insider-trading TSLA --period 2024-Q4

Claude focuses on Q4 2024 insider transactions
```

### Format 3: Custom Data Paste
```
User: /insider-trading --data

[Paste the Form 4 data table or export you have]

Claude analyzes provided data
```

## Output

Provide comprehensive insider trading analysis report with:

### 1. Executive Summary
- **Overall Insider Sentiment**: Bullish / Neutral / Bearish
- **Confidence Level**: High / Medium / Low
- **Key Takeaways**: 3-5 most important findings
- **Investment Signal**: Buy / Hold / Sell indication
- **Time Period Analyzed**: [Date range]

### 2. Transaction Summary Table
```
Period: Last 6 Months
Total Transactions: [N]
Total Buy Transactions: [N] ($[Amount])
Total Sell Transactions: [N] ($[Amount])
Net Insider Activity: $[Amount]
Net Sentiment Score: [+0.XX or -0.XX]
```

### 3. Significant Transactions (Top 10)
Detailed table with context for each major transaction

### 4. Insider Category Breakdown
Analysis by executive officers, board members, and major shareholders

### 5. Ownership Trend Analysis
Current ownership % and historical trend (4 quarters)

### 6. Timing & Pattern Analysis
- Stock price context during trading periods
- Identified bullish or bearish patterns
- Seasonal or cyclical factors

### 7. Red Flags & Concerns
- List any identified warning signs
- Severity assessment
- Recommended monitoring

### 8. Comparison to Peers
Brief comparison of insider sentiment vs. industry peers (if available)

### 9. Historical Context
- How current activity compares to historical baseline
- Notable changes in behavior
- Track record of insider signals

### 10. Investment Implications
- Overall assessment and confidence level
- Key bullish factors from insider activity
- Key bearish factors or concerns
- Recommended action
- Monitoring plan for future activity

### 11. Data Sources Used
- SEC EDGAR filings referenced
- Date range of analysis
- Number of Form 4 filings reviewed


