# 3. Output Format

Part 3 of 4 for `earnings-preview` — 3. Output Format; Example; Notes; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## 3. Output Format

1. **Data & Sources** header (above), including the confirmed date/time and the consensus as-of date
2. **Setup in three lines** — the bar (consensus vs. whisper vs. prior guide), what the price assumes, and how this stock has treated beats
3. **Expectation stack** table (Phase 1)
4. **8-quarter history** table and its three summary lines (Phase 2)
5. **What is priced in** — the implied-growth sentence and the positioning read (Phase 3)
6. **Implied vs. realized move** table and the position-size finding (Phase 4)
7. **KPIs to watch**, with the one number that decides the reaction (Phase 5)
8. **Scenario grid** with probabilities and position rules (Phase 6)
9. **What not to do** (Phase 7)
10. **Thesis Invalidation** and the **Investment Signal block** (below), with the Earnings Setup Score
11. **Hand-off line** — *"After the print: paste the release and transcript into `earnings-call-analysis`; then run `thesis-tracker --update`."*

---

## Example

```
User: earnings-preview NVDA — reports Aug 27 after the close. I hold 40 shares at $118;
      ladder ceiling is 60. Consensus and the last 8 quarters are pasted below. [pasted]

The assistant opens with the Data & Sources header (IR page for the date, pasted
consensus dated Aug 20, live straddle), then the setup in three lines: consensus has
been revised up 6% in 90 days and the whisper sits ~3% above it, so a consensus-level
beat will read as a miss; at the current price and a 3-year median forward multiple the
stock needs ~35% forward EPS growth against a consensus of ~30%, so the price already
assumes a beat-and-raise; the stock beat both lines in 8 of 8 quarters but fell the next
day in 3 of them — every time the guide midpoint was below the whisper.

The implied move is ±7.8% against a realized median of ±6.1% (ratio 1.28 — the event is
over-insured). The KPI that decides the reaction is data-center revenue growth versus
the ~40% whisper, then the next-quarter guide midpoint; gross margin is the tiebreaker.

Scenario grid: beat & raise 45% (hold; no add — the ladder's next rung is $105, far
below), beat & lower 35% (trim 10 shares into strength only if the guide cut names
demand, not supply), miss 20% (the exit trigger is the thesis-tracker file's ≥40% DC
growth KPI, not a price). What not to do: no adding into the print at 40 shares with a
60 ceiling and an implied move that reaches $112 on the downside.

Earnings Setup Score 4.6 / 10 — NEUTRAL: the bar is high and largely priced, but the
stock has rewarded beats and the downside is over-insured. Signal block, then the
hand-off to earnings-call-analysis and thesis-tracker --update.
```

---

## Notes

- **Confirm the date from the company, not a calendar aggregator.** Estimated dates are wrong often enough to matter — an implied move measured on the wrong expiry is meaningless.
- **Consensus is a moving target.** Restate the as-of date next to every consensus figure; a number from three weeks ago is not the bar the stock will trade against.
- **Whisper is labeled an estimate every time it appears.** A range with a rationale beats a false-precision point.
- **The score is about the event, not the company.** A great business can have a poor setup (crowded, fully priced) and a mediocre one a good setup (washed out, low bar). Say which is which; do not blend them.
- **Position rules must respect `position-ladder`'s ceiling and `thesis-tracker`'s triggers** when those exist. This skill never raises a ceiling or overrides an exit trigger.
- **After the print, close the loop.** `earnings-call-analysis` on the transcript, then `thesis-tracker --update`, then record in its decision log which scenario occurred and whether the pre-set rule was followed. That log is what makes the next preview better.

## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH (asymmetric setup for a holder) — the read breaks if:**
- Consensus or the whisper is revised up by more than ~3% (EPS) in the final week — the bar has moved and Phases 1 and 3 must be redone
- The stock rallies more than the implied move *before* the print (a pre-announcement, a peer's blowout, a sector re-rating) — the relief has been taken in advance
- A peer reports first and reveals the KPI in Phase 5 is deteriorating industry-wide

**If signal is BEARISH (good news fully priced, poor beat history) — the read breaks if:**
- The stock sells off into the print by more than the implied move on no company news — the bar has been reset lower
- Consensus is cut ahead of the print (the company or its peers guided down) — a beat against a lowered bar is not the same setup, and Phase 7's warning applies in reverse
- Short interest rises sharply into the event — positioning has flipped and the reaction distribution with it

**Re-run this analysis when:**
- [ ] The print itself — this analysis expires at the release; run `earnings-call-analysis` on the transcript and `thesis-tracker --update` on the numbers
- [ ] Consensus, the guide, or the confirmed date changes
- [ ] The stock moves more than half the implied move before the event
- [ ] A direct peer reports
- [ ] The options-implied move changes by more than 20% relative (repricing of the event)


