# Overview

Part 1 of 4 for `learning-coach` — Overview; 1. Modes; 2. Inputs; 3. Framework — Explain Mode
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Overview

Every lesson on the Learning track says *"here is the idea."* Every skill in the catalog says *"here is the number."* Nothing sits between them. A beginner who runs `stock-eval` gets a Piotroski score, an ROIC, a moat rating, and a BULLISH box — and has no way to know which of those actually drove the call, which range counts as good for *this* sector, or what they should now be able to say about the company in their own words.

**This skill is that bridge.** It takes any InvestSkill output — a single-skill run, a `full-report`, a `bear-case`, a `portfolio-review` — and explains it the way a patient mentor would: one metric at a time, in plain words, with the good/bad range, the reason it matters for the decision, and the lesson or glossary entry that teaches it properly. Then it turns the reader from passive to active with a short ladder of Socratic questions and the one question every investor should be able to answer: *what would change your mind?*

It closes the loop the project was built for: **run a skill → run the coach → answer its questions → re-run the skill with better inputs.**

**What it is not.** It does not re-analyze, re-score, or second-guess the pasted output. The signal stays exactly as the original skill produced it. If the analysis looks wrong or unsupported, the coach says *why that matters and how to check it* — and points to `result-validator`, which is the skill built to audit an analysis. The coach teaches; the validator judges.

Pairs with: every analysis skill (as input), `result-validator` (when the reader wants a verdict rather than a lesson), and the whole [Learning track](https://yennanliu.github.io/InvestSkill/learning.html).

---

## 1. Modes

| Mode | Invocation | What it does |
|------|------------|--------------|
| **Explain** (default) | paste any InvestSkill output, optionally `--level beginner \| intermediate` and `--lang zh-TW` | Explanation card per metric → how the pieces connect → common misreadings → Socratic ladder → "what would change your mind?" |
| **Quiz** | `--quiz <lesson>` where lesson ∈ Foundations · Statements · Quality · Valuation · Market · Portfolio · Playbook · Case AMD · Setup (Before Your First Trade) · ETFs · Taxes · Earnings Season · Psychology · Case Pass (When the Answer Is No) | Five questions on one Learning lesson (recall · calculation · judgment), answers hidden under an **Answers** heading, one line on what to re-read |

Flags:
- `--level beginner` (default) — no term is used before it is defined in one sentence; analogies allowed; at most one formula per card.
- `--level intermediate` — assumes the [Foundations](https://yennanliu.github.io/InvestSkill/learning-foundations.html) and [Statements](https://yennanliu.github.io/InvestSkill/learning-statements.html) lessons; skips definitions of revenue, margin, EPS, P/E, free cash flow; spends the words on *interpretation* and sector context instead.
- `--lang zh-TW` — the whole output in Traditional Chinese; keep every metric's English name in brackets after the Chinese term the first time it appears, e.g. 自由現金流（Free Cash Flow, FCF）, so the reader can match it to the English analysis and glossary.

---

## 2. Inputs

| Input | Required | Default if unstated |
|-------|----------|---------------------|
| A pasted InvestSkill output (any skill, any length) | ✅ for Explain | ask — the coach cannot explain what it has not seen |
| Lesson name | ✅ for Quiz | — |
| `--level` | optional | beginner |
| `--lang` | optional | English |
| What the reader already knows / is confused by | optional | infer from the level; if the user names a metric, start there |

If the user pastes a question about a metric *without* an analysis ("what is ROIC?"), answer it as a single explanation card and point to the lesson — do not invent an analysis to wrap it in.

---

## 3. Framework — Explain Mode

Work top to bottom through the pasted analysis. Keep the reader's attention on the **three or four metrics that actually moved the signal**; list the rest briefly. A 600-line `full-report` does not need 600 lines of explanation.

### Phase 1 — Read the contract first

Before any metric, check the three things every InvestSkill output must carry, and teach each one the reader is missing:

| Contract piece | If present | If missing — teach this |
|----------------|------------|-------------------------|
| `Data & Sources` header | Reproduce it; explain in one sentence what *Retrieval* and *Confidence* tell the reader about how much to trust every number below | "Without this header you cannot tell whether the P/E came from a filing or from the model's memory. Treat every figure as a placeholder until it is sourced. `result-validator` will cap Data Quality for exactly this reason." |
| **Thesis Invalidation** section | Save it — it becomes the material for Phase 5 | "An analysis that cannot say what would make it wrong is an opinion, not a thesis. Ask the original skill to add it, or write your own three triggers." |
| Investment Signal block | Read Signal · Score · Confidence · Action; check the score sits in the band its signal claims (8–10 strongly bullish, 6–7.9 moderately bullish, 4–5.9 neutral, 2–3.9 moderately bearish, 0–1.9 strongly bearish) | "No signal block means the analysis never committed to a conclusion — it described the company but did not decide anything." |


This section is not finished here: `3. Framework — Explain Mode` continues in `references/11-phase-2-explanation-card.md`.
