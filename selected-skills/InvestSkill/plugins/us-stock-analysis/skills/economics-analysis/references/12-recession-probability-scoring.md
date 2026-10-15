# Recession Probability Scoring

Part 3 of 3 for `economics-analysis` — Recession Probability Scoring; Output; Standard Signal Output; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Recession Probability Scoring

### New York Fed Recession Model

Based on the 3M10Y yield curve spread, the NY Fed publishes a monthly recession probability for the next 12 months.

| Probability Range | Interpretation                                |
|-------------------|-----------------------------------------------|
| 0–10%             | Expansion — very low recession risk           |
| 10–25%            | Low risk — monitor indicators                 |
| 25–50%            | Elevated — caution warranted                  |
| 50–75%            | High risk — recession likely within 12 months |
| > 75%             | Near-certain — defensive positioning required |

**Current NY Fed reading**: ____%

### Conference Board Leading Economic Index (LEI)

The LEI composite combines 10 leading indicators across financial markets, labor, manufacturing, and consumer expectations.

- **Consecutive monthly declines (3+)**: Strong recession warning
- **Year-over-year decline > 4%**: Historically aligned with recessions
- **LEI component breakdown**: Manufacturing hours, building permits, consumer expectations, credit spread, yield curve, stock prices, initial jobless claims

**Current LEI trend**: Rising / Flat / Declining

### Sahm Rule

**Sahm Rule Indicator** = Current 3-month average unemployment rate minus the minimum of the 3-month average unemployment rate over the prior 12 months.

- **Threshold: ≥ 0.5 percentage points** = Real-time recession signal with high historical accuracy
- Triggered in every US recession since 1970
- Works in real-time without revision lag that affects other indicators

**Current Sahm Indicator reading**: ____

### Custom Composite Recession Probability

Scoring model combining: Yield curve signal + LEI trend + Sahm Rule + Credit spreads + PMI momentum

| Zone           | Score Range  | Interpretation                                        |
|----------------|--------------|-------------------------------------------------------|
| Expansion      | 0–25%        | Risk-on appropriate; cyclicals, growth outperform     |
| Caution        | 25–50%       | Balanced positioning; reduce cyclical overweights     |
| High Risk      | 50–75%       | Defensive rotation; increase quality, reduce leverage |
| Near-Certain   | 75–100%      | Full defensive posture; cash, defensives, short vol   |

**Historical recession episodes and leading indicators:**

| Recession     | Yield Curve Inversion | LEI Decline | Sahm Trigger | S&P 500 Peak-to-Trough |
|---------------|-----------------------|-------------|--------------|------------------------|
| 2001 (Dot-com) | 2000                 | Yes         | Yes          | −49%                   |
| 2008 (GFC)     | 2006–2007            | Yes         | Yes          | −57%                   |
| 2020 (COVID)   | 2019                 | Yes         | Yes          | −34%                   |
| 2022–2023      | 2022–2023            | Yes         | No (so far)  | −25% (bear market)     |

---

## Output

Deliver concise economic assessment with:
- Current economic state summary
- Key risks and opportunities
- Sector and asset class implications
- Investment positioning recommendations

## Standard Signal Output

All analysis concludes with this standardized block:

```
## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH — thesis breaks if:**
- yield curve inverts >50bps AND leading indicators fall for 3 consecutive months
- [One or two more triggers drawn from this analysis's own drivers, each with a threshold]

**If signal is BEARISH — thesis breaks if:**
- yield curve normalizes AND PMI recovers above 52 for 2+ months
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


