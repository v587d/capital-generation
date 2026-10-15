# Interpretation Guidelines

Part 3 of 3 for `insider-trading` — Interpretation Guidelines; Usage Examples; Integration Notes; Standard Signal Output; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Interpretation Guidelines

### When Insider Buying is STRONGLY Bullish
1. Multiple insiders buying in 1-2 week period
2. CEO making unusually large purchase
3. Buying after significant stock decline (>20%)
4. Insiders buying with personal cash (not option exercises)
5. First-time buyers or return to buying after long gap

### When Insider Buying is MODERATELY Bullish
1. Single insider making meaningful purchase
2. Regular accumulation pattern
3. Buying at all-time highs (conviction in further growth)
4. Board member purchases

### When Insider Selling is LESS Concerning
1. 10b5-1 pre-arranged plan sales
2. Small percentage of holdings (<5%)
3. Regular quarterly pattern
4. Diversification after large stock appreciation
5. Tax payments or estate planning

### When Insider Selling is CONCERNING
1. Clustered selling by multiple executives
2. CEO/CFO selling >25% of holdings
3. Selling despite stock decline
4. No 10b5-1 plan indicated
5. Selling shortly before negative news

### Signal Reliability Factors
- **Sample size**: More insiders trading = stronger signal
- **Magnitude**: Larger $ amounts = stronger signal
- **Timing**: Unusual timing = stronger signal
- **Context**: Contrarian trades (buying weakness) = stronger signal
- **Track record**: Historically accurate insiders = stronger signal

## Usage Examples

### Example 1: Basic Analysis
```
User: /insider-trading NVDA

Claude: Pulls the last 6 months of NVDA Form 4 filings and reports net
open-market buys vs. sells, separates 10b5-1 plan sales from discretionary
trades, flags clustered buying, and closes with the signal block.
```

### Example 2: Before Earnings
```
User: /insider-trading AAPL --period "before-earnings"

Claude: Examines trading in the 30–60 days before the most recent earnings
release and states whether anything beyond scheduled 10b5-1 sales occurred.
```

### Example 3: Red Flag Detection
```
User: /insider-trading ABC --focus red-flags

Claude: Checks each red-flag pattern above (large % of holdings sold,
clustered director exits, selling into a decline) and reports which fired,
with the filing dates that support each.
```

## Integration Notes

- Combine with /stock-eval for complete due diligence
- Use /institutional-ownership for full insider + institutional picture
- Feed analysis to /report-generator for visual charts of insider activity
- Best used monthly or after significant insider filing activity
- Particularly valuable when analyzing small-mid cap stocks (insiders have more edge)

## Standard Signal Output

All analysis concludes with this standardized block:

```
## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH — thesis breaks if:**
- 3+ insiders file Form 4 sells within a 30-day window OR CEO sells >5% of holdings
- [One or two more triggers drawn from this analysis's own drivers, each with a threshold]

**If signal is BEARISH — thesis breaks if:**
- CEO/CFO initiate new purchases >$1M within 30 days
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

**Score Guide**: 8.0–10.0 Strongly Bullish | 6.0–7.9 Moderately Bullish | 4.0–5.9 Neutral | 2.0–3.9 Moderately Bearish | 0.0–1.9 Strongly Bearish
**Confidence**: HIGH (strong data, clear signals) | MEDIUM (mixed signals) | LOW (limited data, conflicting signals)
**Horizon**: SHORT-TERM (1 week–3 months) | MEDIUM-TERM (3 months–1 year) | LONG-TERM (1+ years)

**Disclaimer:** Educational analysis only. Not financial advice.


