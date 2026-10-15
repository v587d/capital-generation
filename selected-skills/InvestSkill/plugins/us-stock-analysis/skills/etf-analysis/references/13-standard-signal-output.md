# Standard Signal Output

Part 4 of 4 for `etf-analysis` — Standard Signal Output
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Standard Signal Output

This skill measures **vehicle fitness, not market direction**, so state the mapping: `Signal: BULLISH` means the fund is a fit way to hold the stated exposure for this portfolio; `NEUTRAL` means it is acceptable but a cheaper, better-tracking, or less overlapping alternative exists (name it); `BEARISH` means do not use this wrapper (structure cap fired, redundant overlap, or a tracking gap that peers do not have). `Action: BUY` here means "this fund is fit for the purpose" — it is not a view on the asset class. Read *whether* to own the exposure from `sector-analysis` or `portfolio-review`, not from this block.

All analysis concludes with this standardized block:

```
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

**Note:** The Score above is the ETF Fitness Score, mapped onto the standard scale for cross-skill comparability. It rates *how fit this fund is as a vehicle for the stated exposure and portfolio* — not how attractive the exposure is. Confidence is LOW whenever the issuer factsheet was not retrieved or the overlap was computed from the top 10 only.

**Disclaimer:** Educational analysis only. Not financial advice. Fund facts change; verify every figure against the issuer's current factsheet and prospectus before acting.


