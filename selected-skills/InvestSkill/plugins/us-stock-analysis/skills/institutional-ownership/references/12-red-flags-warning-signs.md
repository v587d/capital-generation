# Analysis Framework(continued)

Part 3 of 4 for `institutional-ownership` — Analysis Framework; Input Formats; Output; Interpretation Guidelines; Usage Examples; Integration Notes; Standard Signal Output
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### 10. Red Flags & Warning Signs

Identify concerning patterns in institutional ownership:

**High-Severity Red Flags**
- Multiple smart money managers exiting simultaneously
- Decreasing ownership despite rising stock price (selling into strength)
- Activist investor exiting after failed campaign
- Large holders selling >50% of position
- Net institutional selling for 3+ consecutive quarters

**Medium-Severity Red Flags**
- Increasing number of holder exits (even if small positions)
- Declining portfolio weights across multiple holders
- No new institutional buyers despite attractive valuation
- High turnover among holders (low retention)

**Positive Signals**
- Smart money buying during market selloff
- New positions from value-oriented long-term holders
- Activist entering with specific value-creation plan
- Increasing high-conviction holdings (>5% of portfolio)
- Multiple quarters of consistent net institutional buying

## Input Formats

### Format 1: Ticker Symbol
```
User: /institutional-ownership AAPL

Claude retrieves latest 13F data and analyzes recent changes
```

### Format 2: Specific Holder Tracking
```
User: /institutional-ownership TSLA --track "Berkshire,ARK,Scion"

Claude focuses on specific institutional holders' activity
```

### Format 3: Custom Data Analysis
```
User: /institutional-ownership --data

[Paste the 13F data table or export you have]

Claude analyzes provided institutional holdings data
```

## Output

Provide comprehensive institutional ownership analysis report with:

### 1. Executive Summary
- **Overall Institutional Sentiment**: Bullish / Neutral / Bearish
- **Confidence Level**: High / Medium / Low
- **Key Findings**: 3-5 most important insights
- **Investment Signal**: Buy / Hold / Sell indication
- **Smart Money Direction**: Net buying / selling

### 2. Ownership Overview
- Current institutional ownership %
- Trend over last 4 quarters
- Number of holders and change
- Total value held

### 3. Top 10 Holders
Detailed table with position sizes, changes, and portfolio weights

### 4. Recent Activity Summary
- New positions count and notable investors
- Increased positions (>25% increases)
- Decreased positions (>25% decreases)
- Eliminated positions

### 5. Smart Money Tracker
Notable investors' activity with signal strength assessment

### 6. Ownership Concentration
- Top 3/10/25 holder concentration
- Turnover and stability metrics
- Assessment of ownership structure

### 7. Activist & Strategic Holdings
Any activist investors or strategic stakeholders (>5% ownership)

### 8. High-Conviction Holders
Institutions with >5% portfolio weight in this stock

### 9. Performance Correlation
Stock performance during periods of institutional buying/selling

### 10. Red Flags & Positive Signals
- Warning signs identified
- Bullish indicators present
- Severity assessment

### 11. Investment Implications
- Overall assessment and confidence
- Key bullish factors from institutional data
- Key bearish factors or concerns
- Recommended action
- Key levels/catalysts to monitor

### 12. Data Sources & Timing
- 13F filing quarter analyzed
- Number of 13F filings reviewed
- Any data limitations or gaps

## Interpretation Guidelines

### When Institutional Buying is STRONGLY Bullish
1. Smart money managers initiating or significantly increasing (>50%)
2. Multiple value investors buying same stock
3. Activist investor initiating with specific value-creation plan
4. Net institutional buying for 3+ consecutive quarters
5. Buying during market weakness (contrarian signal)

### When Institutional Buying is MODERATELY Bullish
1. Increasing ownership trend (1-2 quarters)
2. Growing number of institutional holders
3. New positions from credible active managers
4. Increasing portfolio weights across multiple holders

### When Institutional Selling is LESS Concerning
1. Index fund rebalancing (mechanical selling)
2. Profit-taking after significant appreciation
3. Small position eliminations (<1% of portfolio)
4. Single quarter of selling after long accumulation
5. Sector rotation or style drift

### When Institutional Selling is CONCERNING
1. Smart money managers exiting completely
2. Activist investors giving up and selling
3. Selling during stock decline (lack of confidence)
4. Multiple quarters of net institutional selling
5. Decreasing number of holders

### Signal Reliability Factors
- **Quality of holders**: Smart money > Index funds
- **Conviction level**: High portfolio weights = stronger signal
- **Consistency**: Multiple quarters of buying/selling = stronger
- **Context**: Buying weakness or selling strength = stronger signal
- **Magnitude**: Large position changes = stronger signal

## Usage Examples

### Example 1: Basic Analysis
```
User: /institutional-ownership NVDA

Claude: Reads the latest quarter's 13F filings and reports the change in
institutional ownership, new and exited holders, and the largest adds and
trims by named manager, then closes with the signal block.
```

### Example 2: Smart Money Tracking
```
User: /institutional-ownership META --smart-money

Claude: Restricts the holder analysis to the smart-money list above and
reports each manager's position change for the quarter.
```

### Example 3: Comparative Analysis
```
User: /institutional-ownership AAPL MSFT GOOGL --compare

Claude: Runs the same ownership-trend and smart-money checks on each ticker
and ranks them by net institutional accumulation.
```

## Integration Notes

- Combine with /insider-trading for complete ownership analysis
- Use with /stock-eval for comprehensive due diligence
- Leave chart-ready tables in the answer; the host chart channel renders them (this plugin has no report export)
- Best used quarterly after 13F filing deadlines (May, Aug, Nov, Feb)
- Particularly valuable for small-mid cap stocks where institutional buying can be catalyst
- Less meaningful for mega-caps where ownership changes are primarily index-driven

## Standard Signal Output

All analysis concludes with this standardized block:

```

