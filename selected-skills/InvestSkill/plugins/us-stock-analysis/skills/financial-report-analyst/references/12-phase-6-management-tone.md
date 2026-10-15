# Step-by-Step Analysis Framework(continued)

Part 3 of 4 for `financial-report-analyst` — Step-by-Step Analysis Framework; Output Format; Input Formats Accepted; Standard Signal Output
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### Phase 6: Management Tone and Language Analysis

Apply natural language analysis to management's own words:

**6.1 Tone Scoring**

Rate management's tone across key sections:

```
Tone Assessment:
Section              Tone Score (1=Very Negative → 5=Very Positive)    Key Language
──────────────────────────────────────────────────────────────────────────────────
MD&A Overview
Revenue Discussion
Margin Discussion
Guidance Language
Risk Factors Framing
CEO Letter (if present)
──────────────────────────────────────────────────────────────────────────────────
Overall Tone:        [Score] / 5
Change vs. Prior:    More Positive / Same / More Negative
```

**6.2 Hedging Language Flags**

Flag specific hedging phrases that indicate uncertainty:
- "We believe" / "we expect" / "we anticipate" — standard forward-looking
- "We cannot assure" / "there can be no assurance" — heightened uncertainty
- "Significant uncertainty" / "material uncertainty" — near-crisis language
- Passive voice for negative news ("challenges were experienced") vs. active voice for positives
- Increasing use of "headwinds," "challenging environment," "softness"

**6.3 Management Credibility Tracking**

```
Guidance Accuracy Scorecard (prior 4 quarters):
Period    Revenue Guidance    Actual    Beat/Miss    Margin Guidance    Actual    Beat/Miss
Q-4
Q-3
Q-2
Q-1
──────────────────────────────────────────────────────────────────────────────────────────
Batting Average: ___  Beat Rate: ___  Avg. Miss: ___
```

---

### Phase 7: Year-over-Year Comparison (for Quarterly Reports)

For 10-Q analysis, compare against the same quarter prior year AND the sequential prior quarter:

```
YoY and Sequential Comparison:
Metric          Current Q    Prior Q (seq)    Prior Year Q    YoY %    QoQ %
Revenue
Gross Margin
Operating Income
EPS (GAAP)
FCF
```

Identify if trends are:
- Accelerating (sequential improvement + YoY beats)
- Stable (sequential flat, YoY in-line)
- Decelerating (sequential miss, YoY still positive)
- Deteriorating (both sequential and YoY misses)

---

### Phase 8: Insider Activity (from Proxy/Form 4 Data)

Cross-reference with available SEC Form 4 data around the filing date:
- CEO/CFO buying on the open market (strong signal — insiders rarely buy for tax purposes)
- Bulk insider selling at prices below historical averages (negative signal)
- New 10b5-1 plan adoptions (scheduled selling — less informative than open market)
- Executive departures disclosed in proxy or 8-K (CFO exits especially significant)

---

## Output Format

### Executive Summary (1-2 paragraphs)

High-level verdict on the filing quality and key takeaways for investors. Address: Is this a better or worse filing than prior periods? What is the single most important thing an investor should take away?

### Financial Health Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│  FINANCIAL REPORT ANALYSIS — [TICKER] [Filing Type] [Period]   │
├────────────────────────┬────────────────────────────────────────┤
│ Revenue Growth         │ [%] YoY   [Organic vs. Acquired]       │
│ Gross Margin           │ [%]  (vs. prior: [%]  Δ [bps])         │
│ Operating Margin       │ [%]  (vs. prior: [%]  Δ [bps])         │
│ FCF Margin             │ [%]  (FCF Conversion: [%])              │
│ Net Debt / (Cash)      │ $[M]  (Debt/EBITDA: [x])               │
│ DSO                    │ [days]  (vs. prior: [days])             │
│ Management Tone        │ [Positive / Neutral / Cautious]         │
├────────────────────────┼────────────────────────────────────────┤
│ Filing Quality Score   │ [Score] / 10                           │
│ Earnings Quality Score │ [Score] / 10                           │
│ Balance Sheet Score    │ [Score] / 10                           │
└────────────────────────┴────────────────────────────────────────┘
```

### Key Insights (Bulleted)

**Positives (Bullish Signals):**
- [Specific insight with page/section reference from filing]

**Negatives (Bearish Signals):**
- [Specific insight with page/section reference from filing]

**Neutral / Watch Items:**
- [Items requiring monitoring but not yet actionable]

### Red Flags and Anomalies

| # | Red Flag | Severity | Where Found | Implication |
|---|----------|----------|-------------|-------------|
| 1 | | HIGH/MED/LOW | | |

### Accounting Quality Score

| Criterion | Score (0–3) | Notes |
|-----------|-------------|-------|
| Revenue recognition clarity | | |
| Non-GAAP reconciliation quality | | |
| FCF conversion rate | | |
| Working capital trends | | |
| Footnote transparency | | |
| Auditor opinion | | |
| Related party transactions | | |
| **Total** | **/21** | |

Score guide: 18–21 = High quality | 12–17 = Average | <12 = Scrutinize further

---

## Input Formats Accepted

```bash
# Paste raw text from 10-K or 10-Q sections
/financial-report-analyst [paste filing text]

# Analyze specific section of a recent filing
/financial-report-analyst AAPL 10-K --section md&a
/financial-report-analyst MSFT 10-Q --section risk-factors
/financial-report-analyst NVDA 10-K --section cash-flow

# Full report analysis (all sections)
/financial-report-analyst GOOGL 10-K --full

# Compare current vs prior filing
/financial-report-analyst META 10-K --compare-prior

# Quick earnings press release analysis
/financial-report-analyst AMZN --press-release [paste text]

# Proxy statement analysis
/financial-report-analyst TSLA --proxy
```

---

## Standard Signal Output

All analysis concludes with this standardized block:

```

