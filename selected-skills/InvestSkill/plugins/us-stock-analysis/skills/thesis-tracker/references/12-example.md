# Example

Part 3 of 3 for `thesis-tracker` — Example; Notes; Thesis Invalidation; Standard Signal Output
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Example

```
User: thesis-tracker NVDA — I bought at $118 on 2026-05-30. Thesis: data-center demand
      compounds for at least two more years and the market is still pricing a one-off cycle.
      Here are my stock-eval and bear-case outputs. [pasted]

The assistant sharpens the paragraph (adds "why now": hyperscaler FY27 capex guides due in
the next two prints), sets four KPIs (DC revenue growth ≥ 40%, gross margin ≥ 70%, net cash > 0,
forward P/E ≤ 35), imports three triggers from the bear-case Thesis-Killers (a top-3 customer
announcing in-house silicon at scale; export-control expansion to a second major market;
inventory days > 120), lists the next two earnings dates and one export-policy decision as
catalysts, writes the pre-mortem ("…because the 2027 capex guides came in flat and the
multiple compressed before revenue did"), and saves output/thesis/NVDA.md with status INTACT
and a next check on the August print.

User: thesis-tracker NVDA --update [pastes the August 10-Q highlights]

The assistant returns: NVDA · WEAKENED · 2026-08-29 — Gross margin 68.1% (was 75.5%) breached
the ≥ 70% threshold; the other three KPIs hold; no trigger fired. Notes that the pricing-power
leg of the thesis is the one under pressure, moves the next check to the October analyst day,
and appends the log row "2026-08-29 · hold, no add · $131 · margin breach under review".
```

---

## Notes

- **Run the analysis skills first.** This skill is a notebook with rules; it is only as good as the analyses it summarizes. Open with at least `stock-eval` and `bear-case` in hand.
- **Never write the thesis for the user.** Sharpen, question, and structure — but the conviction has to be theirs or the file will not be believed when it says BROKEN.
- **Hold the KPI count at five.** More KPIs means more noise and a guaranteed breach every quarter; the thesis becomes permanently WEAKENED and the status stops carrying information.
- **A WEAKENED status blocks adding, not holding.** Pair with `position-ladder`, whose thesis-break gate is meant to read this status.
- **Closed files are inputs to `post-trade-review`.** Do not delete them.
- Keep the `output/` convention described above. Where the environment cannot write, print the file.

## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH (thesis INTACT) — it turns WEAKENED or BROKEN if:**
- Any KPI in the file crosses its threshold at the next check (name the KPI closest to its threshold today and by how much)
- Any trigger in the file fires — the trigger table *is* the invalidation list for this thesis
- The core mechanism stalls for two consecutive checks even with KPIs technically inside threshold (the numbers hold but the story does not)

**If signal is BEARISH (thesis BROKEN) — the verdict is wrong if:**
- The breached KPI was a one-off (a charge, a reclassification, a timing shift) and reverts within one quarter — say what evidence would show that
- The fired trigger was mis-specified (it caught a symptom that turned out not to matter to the mechanism) — rewrite the trigger rather than ignore it
- The user's original thesis was narrower than the one written down — re-open with the honest, narrower version

**Re-run this analysis when:**
- [ ] The next-check date in the file arrives
- [ ] Any catalyst in the file occurs
- [ ] Price moves ±20% from the entry or the last check (a check, not a reaction)
- [ ] A new `bear-case` or `stock-eval` run produces triggers the file lacks
- [ ] 90 days have elapsed since the last update

## Standard Signal Output

This skill measures **thesis health, not stock direction**, so state the mapping: `Signal: BULLISH` means the thesis is INTACT (the reason for owning it holds); `NEUTRAL` means WEAKENED (hold, do not add, check sooner) — or INSUFFICIENT EVIDENCE, in which case `Confidence: LOW` and `Action: HOLD` are mandatory; `BEARISH` means BROKEN (the reason for owning it is gone). `Action: BUY` here means "the thesis supports continuing to hold or ladder within the stated ceiling" — never "buy without limit." Read the direction of the stock from `stock-eval` or `bear-case`, not from this block.

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

**Note:** The Score above is the Thesis Health Score, mapped onto the standard scale for cross-skill comparability. It rates *how well the written thesis is surviving its own tests* — not how attractive the stock is.

**Disclaimer:** Educational analysis only. Not financial advice. A thesis file is a record of the user's reasoning, not a recommendation to hold, add to, or sell any position.


