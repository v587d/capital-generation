# 10. Input Formats

Part 4 of 4 for `competitor-analysis` — 10. Input Formats; 11. Visualization Support; Output; Standard Signal Output; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## 10. Input Formats

```
# Single company analysis
/competitor-analysis AAPL

# With specific sector context for more targeted analysis
/competitor-analysis MSFT --sector "cloud computing"

# With specified peer group for benchmarking
/competitor-analysis NVDA --peers AMD,INTC,QCOM

# Moat analysis only (faster, focused output)
/competitor-analysis GOOGL --moat-only

# Full analysis with visual output for /report-generator
/competitor-analysis AMZN --visual
```

---

## 11. Visualization Support

When `--visual` flag is used, include chart data tables for report generation:

### Porter's Five Forces Radar Chart
**Chart Type**: Radar/spider chart
```
Force                   Score (1-5)
Competitive Rivalry     [value]
New Entrant Threat      [value]
Supplier Power          [value]
Buyer Power             [value]
Substitute Threat       [value]
```

### Competitive Benchmarking Chart
**Chart Type**: Grouped bar chart
```
Metric          [Company]   [Comp 1]   [Comp 2]   [Comp 3]   Industry Avg
Gross Margin    [%]         [%]        [%]        [%]        [%]
ROIC            [%]         [%]        [%]        [%]        [%]
Revenue Growth  [%]         [%]        [%]        [%]        [%]
```

### Moat Score Components Bar Chart
**Chart Type**: Horizontal bar chart with weighted scores
```
Component               Weighted Score
Moat Source Strength    [value × 0.25]
Moat Durability         [value × 0.20]
Competitive Position    [value × 0.20]
Industry Attractiveness [value × 0.15]
Pricing Power           [value × 0.10]
Innovation Positioning  [value × 0.10]
─────────────────────────────────────
Composite Moat Score:   [X.X / 10]
```

---

## Output

Provide a comprehensive competitive analysis report with:
- Executive Summary (moat assessment, competitive position, trend — 3 sentences)
- Moat Identification (sources present, width, trend, durability estimate)
- Porter's Five Forces Analysis with individual force scores and industry attractiveness score
- Market Share Analysis and 3-year trend
- Competitive Benchmarking table vs. top 3–5 peers
- Innovation & Disruption Assessment
- Pricing Power Analysis
- Management Competitive Quality
- Composite Moat Score Card
- Investment Implications (how moat assessment affects valuation, key competitive risks, bull/bear case for competitive position)

### Enhanced Output (with --visual flag)
- All standard sections above
- Porter's Five Forces radar chart data
- Competitive benchmarking grouped bar chart data
- Moat score components horizontal bar chart data
- Chart specifications for HTML report generation via `/report-generator`

## Standard Signal Output

All analysis concludes with this standardized block:

```
## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH — thesis breaks if:**
- well-funded competitor enters core market OR key customer (>15% revenue) lost
- [One or two more triggers drawn from this analysis's own drivers, each with a threshold]

**If signal is BEARISH — thesis breaks if:**
- moat-widening acquisition announced OR key competitor files bankruptcy
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


