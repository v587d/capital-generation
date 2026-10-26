# 5. Output Format

Part 3 of 4 for `learning-coach` — 5. Output Format; Example; Notes; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## 5. Output Format

**Explain mode**
1. `Data & Sources` header (the pasted analysis's own, or the LOW-confidence substitute)
2. **One-line orientation** — which skill produced this, what question it answers, and its signal as stated
3. **Contract check** (Phase 1) — only the pieces that are missing get a paragraph; present pieces get one line each
4. **Explanation cards** (Phase 2), ordered by influence on the signal — three to six full cards, the remaining metrics in a compact table (metric · value · one-line meaning · lesson)
5. **How the pieces connect** (Phase 3)
6. **Common misreadings** (Phase 4)
7. **Socratic ladder** (Phase 5), ending with **What would change your mind?**
8. **Next step** — one line: which lesson to read next, and which skill to run to test the reader's new question
9. Thesis Invalidation (the reader's version — below) and the Investment Signal block, **mirroring the pasted analysis's signal unchanged**, with the Learning Coach note

**Quiz mode** — the quiz block from `## 4. Framework — Quiz Mode` (`11-phase-2-explanation-card.md`), then the Thesis Invalidation section below and the signal block in `13-standard-signal-output.md` (signal fields may be `n/a` — a quiz has no analysis to mirror; say so in the note).

---

## Example

```
User: [pastes a stock-eval output for a semiconductor company: Piotroski 8/9, ROIC 34%,
      gross margin 75% expanding, forward P/E 38, moat WIDE, signal BULLISH 7.8/10,
      Confidence HIGH, Data & Sources header present, Thesis Invalidation present]
      Explain this to me — I'm new to this.

The assistant reproduces the Data & Sources header, notes all three contract pieces are
present, then writes five cards ordered by influence: ROIC (plain words: "for every $100 the
company invests in itself, it earns $34 a year"; good/bad: >15% strong generally, >25% elite
for semis; Learn it: Quality lesson), gross margin and its trend, the Piotroski F-Score
(what 8 of 9 means and which test it failed), forward P/E of 38 (generic: high; sector: the
upper half for growth semis; "the price already assumes the growth continues"), and the WIDE
moat rating (which of the five moat sources the analysis relied on). The connecting paragraph
says quality metrics carried the call and valuation argued against it, and that the 7.8 is
"quality strong enough to pay up for, but not cheap." Misreadings: 7.8 is not a buy order;
HIGH confidence describes the data, not the odds; P/E 38 is not automatically expensive.
The ladder ends: "What would change your mind?" — and quotes the analysis's own three
invalidation triggers (margin below 70%, growth below 40%, a top customer moving in-house).
Next step: read the Valuation lesson, then run stock-valuation to see what growth the
price implies. The signal block repeats BULLISH · 7.8 · HIGH unchanged.

User: --quiz Valuation --level beginner

The assistant writes five questions on the Valuation lesson — two definitions (intrinsic
value vs. price; what a discount rate is), one calculation (FCF $500M, 20 shares of 50M...
"what is FCF per share, and at a 5% FCF yield what price does that imply?" → $10/share,
$200), one two-company judgment (same P/E, different growth — which is cheaper?), and one
trap (a low P/E on earnings that just halved). Answers under the Answers heading with the
calculation worked out. Re-read: Valuation → "price vs. value", Glossary → FCF yield.
```

---

## Notes

- **Explain, don't re-analyze.** If the reader wants to know whether the analysis is *right*, send them to `result-validator`; if they want the opposite view, to `bear-case`. The coach's value is that it never changes the answer — it changes what the reader understands about it.
- **Match the level honestly.** A beginner who receives an intermediate explanation learns nothing; an intermediate reader who receives definitions of revenue stops reading. When unsure, ask one question about what they already know before writing.
- **Sector ranges are the hardest part and the most valuable.** Always state which sector's norms you are using and why; when the pasted analysis names peers, use them.
- **Quote the analysis, cite the lesson.** Every card should point at where in the pasted text the number came from and where on the site the concept is taught — the reader should be able to check both.
- **Traditional Chinese output** follows the Learning track's own zh-TW pages (`learning-zh-tw.html`, `glossary-zh-tw.html`); link those instead of the English pages when `--lang zh-TW` is set.
- Long inputs: a composite answer may contain fifteen modules. Explain the composite and the three modules with the largest weight fully; summarize the rest in the compact table and offer to expand any one on request.

## Thesis Invalidation

This skill explains a reading rather than making a call, so what can be invalidated is **the learner's understanding**. After the explanation, state when it stops being valid:

**The explanation no longer applies if:**
- The analysis is re-run and any of the three signal-driving metrics changes band (the cards were written for these values — re-run the coach on the new output rather than re-reading the old one)
- The `Data & Sources` header dates the figures more than 90 days back, or a newer filing has landed since (the meaning of a metric does not age; its value does)
- The pasted analysis is later shown by `result-validator` to have a data or arithmetic error — an explanation of a wrong number is still wrong, however clear
- The reader has moved from beginner to intermediate — the beginner cards now under-explain interpretation and over-explain definitions; re-run at the higher level

**The learner's own reading is invalidated if they cannot:**
- Name the two or three metrics that drove the signal, without looking
- State the good / bad range for the key metric *in this sector*
- Answer "what would change your mind?" with a specific, observable trigger

**Re-run this coach when:**
- [ ] The underlying analysis is re-run (next earnings, price move ±15%, material news)
- [ ] The reader finishes the lesson the cards pointed to — a second pass should feel different
- [ ] The reader runs a *different* skill on the same company (the connections paragraph changes)
- [ ] 60 days have elapsed and the reader wants to check what stuck (use `--quiz`)


