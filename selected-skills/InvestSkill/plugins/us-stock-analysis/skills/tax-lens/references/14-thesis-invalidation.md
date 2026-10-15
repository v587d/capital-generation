# Thesis Invalidation

Part 5 of 5 for `tax-lens` — Thesis Invalidation; Standard Signal Output
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH (tax-efficient as specified) — the assessment breaks if:**
- A purchase of the same security lands inside the 61-day window (DRIP, a ladder rung, an assignment) and washes a loss the plan relied on
- The user's bracket, filing status, or residency changes — every rate in the table moves with it
- A rule the analysis leaned on changes (rate brackets, the wash-sale scope, treaty status, the estate exemption) — re-run against the new tax year

**If signal is BEARISH (tax-inefficient as specified) — the assessment breaks if:**
- The market moves enough that the tax saving from waiting is smaller than the price risk of waiting — the "wait N days" table shows the break-even fall; below it, sell
- The user has offsetting losses or a low-income year that changes the character math (a 0% long-term bracket year makes realizing gains *desirable*)
- The broker confirms specific-ID designation or a treaty rate the analysis assumed was unavailable

**Re-run this analysis when:**
- [ ] A short-term lot is within 60 days of turning long-term
- [ ] Before any sale at a loss, and 31 days after it (the window closes)
- [ ] Each ex-dividend date for holdings where the qualified test is close
- [ ] Year-end (harvest window) and the new tax year (indexed thresholds)
- [ ] W-8BEN expiry year, a change of residence, or a change in treaty status (`--non-us`)

## Standard Signal Output

This skill measures **tax efficiency of the action or portfolio as specified, not the merit of the investment**, so state the mapping: `Signal: BULLISH` means proceed as planned from a tax standpoint; `NEUTRAL` means the same trade should be done differently (lot choice, timing, account); `BEARISH` means the action as specified is tax-inefficient (a wash, a short-term gain days from long-term, a large avoidable withholding or estate exposure). `Action: BUY / HOLD / SELL` refers to **the tax plan** — adopt it / adjust it / abandon it — never to the stock. Read the investment view from `stock-eval`, `dividend-analysis`, or `etf-analysis`.

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

**Note:** The Score above is the Tax Efficiency Score, mapped onto the standard scale for cross-skill comparability. It rates *how much of the pre-tax result the plan keeps* — not how attractive the security is. Confidence is capped at MEDIUM whenever the user's bracket, residency, or lot dates were assumed rather than supplied.

**Disclaimer:** Educational analysis only. Not financial advice, and **not tax advice** — an illustration of how the rules generally work, for a stated tax year, on the user's own numbers. Tax law changes and depends on facts this skill cannot see. Confirm with a qualified tax professional before acting.


