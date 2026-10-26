# Notes

Part 4 of 4 for `fact-check` — Notes; Thesis Invalidation; Standard Signal Output
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Notes

- **Run it before `result-validator`, not instead of it.** This skill checks the inputs; the validator checks the reasoning built on them. The validator's Data Quality score should never exceed what the Verification Score supports.
- **Every InvestSkill report is a candidate**, but so is anything else the user brings — a broker note, a newsletter, a spreadsheet, a screenshot transcribed to text. The ledger discipline is the same.
- **Unverifiable is not false.** The corrected copy must never read as if a `❓` claim were refuted. The honest output for a claim without a source is the claim, unchanged, with `[?]`.
- **Fiscal calendars cause most false mismatches.** Establish the fiscal year end and the period each table covers before comparing anything.
- **Do not fabricate a reference to fill a gap.** No accession number, page, or URL that was not actually seen. If the environment cannot retrieve, report the claim as blocked — do not fall back to memory.
- **Pairs with**: `result-validator` (consumes the score), `learning-coach` (explains the ledger to a beginner), `10k-digest` and `financial-report-analyst` (produce well-cited inputs in the first place), `thesis-tracker` (verify the KPI values before recording them at a check); re-run this ledger on the composite before it goes into the final answer.

## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH (the report's inputs verified) — the verdicts break if:**
- A new filing restates a figure the report relied on (an 8-K or an amended 10-K/A) — every `✅` on that figure becomes `🕒` until re-checked
- A signal-driving figure that was verified at Tier 2 (secondary) is later contradicted by the primary document
- The market-data as-of dates pass 90 days — verified prices become stale prices, and the valuation claims built on them lose their `✅`

**If signal is BEARISH (the report's inputs did not verify) — the verdicts break if:**
- The user supplies the source that turns the `❓` claims into `✅` — the ledger is re-run, not amended by hand
- A mismatch is traced to a period or definition difference the report actually disclosed elsewhere (then it is a labelling issue, not a wrong number — downgrade to a note)
- The report is re-issued by its author with the corrected figures, in which case fact-check the new version, not the old

**Re-run this analysis when:**
- [ ] The company files its next 10-Q / 10-K, or any 8-K restating prior figures
- [ ] The report is edited or re-generated
- [ ] 90 days pass on any market-data claim
- [ ] Before the report is shared, published, or used to size a position
- [ ] `result-validator` scores Data Quality above what the ledger supports

## Standard Signal Output

This skill does **not** form a view on the stock. `Score` is always the **Verification Score**, and `Confidence` is capped at the tier it supports (≥ 8.0 HIGH · 6.0–7.9 MEDIUM · < 6.0 LOW). The other fields depend on the outcome:

- **Verification passed** (Score ≥ 4.0 **and no signal-driving cap fired** — `Caps fired: none`, or only the coverage / header caps): Signal, Horizon, Action, and Conviction **mirror the verified report's own**, and a line under the box states `Mirrors the report's signal — quoted, not re-derived`. If a signal-driving claim mismatched by more than 5%, add `Signal not supported at stated confidence — re-run the analysis with verified inputs`.
- **Verification failed** (Score < 4.0, **or** the signal-driving mismatch cap fired — even if the capped score reads exactly 4.0 — or a fabricated citation → 0): the box does **not** carry the report's Signal or Action forward — an unsupported BUY must not survive into the verification result. Fill `Signal: NEUTRAL · Action: HOLD · Conviction: WEAK · Confidence: LOW`, and under the box write `Verification failed — the report's own signal (BULLISH / BUY, quoted) is not supported by its inputs; do not act on it`.
- For a report with no signal block, fill Signal / Action / Conviction with `n/a`.

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

**Note:** The Score above is the Verification Score — *how much of the report is demonstrably true* — mapped onto the standard scale for cross-skill comparability. When verification passes, Signal, Horizon, Action, and Conviction are the verified report's own, quoted unchanged; when it fails, they are replaced by NEUTRAL / HOLD / WEAK so that no unsupported call is carried forward.

**Disclaimer:** Educational analysis only. Not financial advice. Verification is limited to the sources available at run time; an unverifiable claim is neither confirmed nor refuted.


