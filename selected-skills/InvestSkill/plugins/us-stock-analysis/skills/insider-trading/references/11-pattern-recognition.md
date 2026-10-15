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

### 10. Data Sources & Research Tools

Reference the following sources for insider trading data:

**Primary Source - SEC EDGAR**
- Form 4 filings: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=4&company=[TICKER]
- Form 3 filings: Initial beneficial ownership
- Form 5 filings: Annual statements
- File within 2 business days of transaction (Form 4)

**Aggregator Websites**
- **OpenInsider.com**: Free, comprehensive database with filters
  - Cluster analysis tools
  - Screeners for significant transactions
  - Historical data back 10+ years

- **SEC Form 4 Tracker**: Real-time Form 4 monitoring
- **Finviz Insider**: Basic insider data with visualizations
- **GuruFocus Insider**: Premium insider analysis

**Premium Tools**
- **Bloomberg Terminal**: Comprehensive insider data and analytics
- **FactSet**: Insider transaction database
- **S&P Capital IQ**: Detailed ownership and transaction data

**Key Data Points to Extract**
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

Claude retrieves recent Form 4 data from SEC EDGAR and analyzes
```

### Format 2: Specific Time Period
```
User: /insider-trading TSLA --period 2024-Q4

Claude focuses on Q4 2024 insider transactions
```

### Format 3: Custom Data Paste
```
User: /insider-trading --data

[Paste Form 4 data table or CSV from OpenInsider/SEC]

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


