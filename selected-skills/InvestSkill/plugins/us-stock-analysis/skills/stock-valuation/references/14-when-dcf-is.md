# Deep DCF Modeling(continued)

Part 5 of 5 for `stock-valuation` — Deep DCF Modeling; Input Formats; Output Summary; Standard Signal Output; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### When DCF Is (and Isn't) the Right Tool

**When DCF is most reliable**:
- Stable, mature businesses with predictable, consistent FCF
- Asset-light businesses with high FCF conversion (e.g., software, consumer brands)
- Companies with 10+ years of FCF generation history
- Businesses where future cash flows are reasonably bounded (regulated utilities, subscription SaaS)

**When DCF is less reliable (use relative valuation instead)**:
- Early-stage growth companies with no positive FCF yet — value lies in future optionality
- Highly cyclical businesses where normalizing FCF requires significant judgment
- Financial companies (banks, insurance, REITs) — use Price/Book, Price/Earnings, or dividend discount models instead
- Companies with lumpy or unpredictable capex cycles
- Turnaround situations where the path to profitability is uncertain

---

## Input Formats

```bash
# Auto-calculate from public financial data
/stock-valuation AAPL

# Specify methods to use
/stock-valuation MSFT --methods dcf,cca,ev-ebitda

# Full multi-method analysis with visual output
/stock-valuation NVDA --full --visual

# Quick single-method valuation
/stock-valuation GOOGL --method dcf --quick

# Custom assumption overrides
/stock-valuation AMZN --growth 15% --wacc 9% --terminal 2.5%

# Compare multiple stocks
/stock-valuation AAPL,MSFT,GOOGL --compare

# With peer set specification
/stock-valuation META --peers SNAP,PINS,TWTR,RDDT
```

---

## Output Summary

Complete valuation report including:

1. **Business Summary**: One-paragraph description of the business model and competitive position
2. **Method Selection Rationale**: Why each method was selected or excluded
3. **DCF Analysis**: Full 10-year projections, WACC decomposition, sensitivity table (3 scenarios)
4. **Comparable Company Analysis**: Peer table with multiples and implied values
5. **Multiple-Based Valuations**: EV/EBITDA, P/E, P/FCF implied ranges
6. **Football Field Chart**: Visual range of all methods
7. **Composite Intrinsic Value**: Weighted average across all methods
8. **Margin of Safety Assessment**: Discount/premium to current price
9. **Risk-Adjusted Expected Return**: Scenario-weighted expected return calculation
10. **Key Valuation Risks**: What assumptions could most materially change the outcome
11. **Analyst Consensus Comparison**: How model compares to Street consensus

---

## Standard Signal Output

All analysis concludes with this standardized block:

```
## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH — thesis breaks if:**
- intrinsic value declines >20% on updated assumptions OR multiple compression vs. peers worsens
- [One or two more triggers drawn from this analysis's own drivers, each with a threshold]

**If signal is BEARISH — thesis breaks if:**
- all 5 valuation methods show >20% upside at current price simultaneously
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


