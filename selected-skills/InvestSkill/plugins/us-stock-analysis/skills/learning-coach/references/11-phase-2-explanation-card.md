# 3. Framework — Explain Mode(continued)

Part 2 of 4 for `learning-coach` — 3. Framework — Explain Mode; 4. Framework — Quiz Mode (`--quiz <lesson>`); Quiz — <Lesson name>  (5 questions · --level <level>); Answers
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### Phase 2 — Explanation card, one per metric

Use this card for every metric you explain. Beginner level fills every row; intermediate may drop **Plain words** when the term is basic.

```
▸ <Metric name>  ·  value in this analysis: <as stated>
  Plain words     one sentence a non-finance friend would follow
  Why it matters  what decision it informs, and what happens to the thesis if it is wrong
  Good / bad      the general range, then the range for THIS sector or business model
  In this case    what the stated value says about this company, in one line
  Learn it        <Lesson name>
                  Glossary        <term>
```

Rules for the card:
- **Ranges are sector-relative.** A 30% operating margin is superb for a retailer and ordinary for enterprise software; a P/E of 12 is cheap for a compounder and fair for a utility. Always give both the generic range and the sector range, and say which one applies.
- **One formula at most, and only if it aids understanding** (e.g. `FCF = operating cash flow − capex`). Show it with the analysis's own numbers when they are present.
- **Never restate the analysis's judgment as your own.** "The analysis rates the moat WIDE because…" — not "the moat is wide."
- **Order the cards by influence on the signal**, not by their order in the pasted text.

Mapping metrics to lessons (use these slugs):

| Metric family | Lesson | Slug |
|---------------|--------|------|
| Revenue, margins, EPS, cash flow, balance-sheet items | Statements | `learning-statements` |
| ROIC, ROE, Piotroski F-Score, accruals, moat, capital allocation | Quality | `learning-quality` |
| P/E, P/S, EV/EBITDA, DCF, WACC, terminal growth, fair-value range | Valuation | `learning-valuation` |
| Beta, moving averages, RSI, MACD, short interest, implied volatility, insider / 13F flows | Market | `learning-market` |
| Position size, concentration, correlation, drawdown, VaR, rebalancing | Portfolio | `learning-portfolio` |
| Signal block, thesis, invalidation triggers, catalysts, "when to sell" | Playbook | `learning-playbook` |
| The whole loop on one real company | Case AMD | `learning-case-amd` |
| Compounding, risk vs. return, what a stock *is* | Foundations | `learning-foundations` |

### Phase 3 — How the pieces connect

One paragraph, no more than six sentences: which two or three metrics carried the signal, which ones argued against it, and how the original skill weighed them. Name the trade-off explicitly ("high quality, but the price already assumes it"). This is the paragraph the reader should be able to repeat from memory tomorrow.

### Phase 4 — Common misreadings

List the three to five errors beginners make with *this kind* of output. Draw from this bank and add skill-specific ones:

- Treating a high score or `Action: BUY` as an order to buy today, rather than as one input to a position decision (`position-ladder`, `portfolio-review` decide size and timing).
- Reading the signal box without reading the `Data & Sources` header above it — the box inherits the header's confidence.
- Confusing a low P/E with cheapness (a low multiple on falling earnings is a value trap — see the PFE run in the Cookbook) or a high P/E with expensiveness (growth can justify it; the reverse-DCF in `stock-valuation` says whether it does).
- Reading `Confidence: HIGH` as "high probability the stock goes up" — it means the *data* was strong and the signals agreed, not that the outcome is likely.
- Taking a `bear-case` output as a balanced verdict — it is deliberately one-sided by design.
- Treating a DCF fair value as a fact rather than the output of stated assumptions (change the terminal growth by 1% and watch the value move).
- Anchoring on the average cost or the entry price — the market does not know what you paid.
- Reading `Horizon: LONG-TERM` as permission to stop checking — the Thesis Invalidation section says when to look again.

### Phase 5 — The Socratic ladder

Three to five questions, each harder than the last, each answerable from the pasted analysis plus the cards above. Do not answer them; end the ladder with the standing question.

| Rung | Type | Example shape |
|------|------|---------------|
| 1 | Recall | "Which single metric in this analysis most supports the BULLISH call, and what is its value?" |
| 2 | Interpretation | "The analysis says gross margin is 75% *and* expanding. What does an expanding margin tell you that a high margin alone does not?" |
| 3 | Connection | "If revenue growth slowed to 10% next year but margins held, which of the analysis's conclusions would survive and which would not?" |
| 4 | Judgment | "The valuation section says the price assumes 25% growth for five years. Is that plausible for a company this size? What would you need to see to believe it?" |
| 5 | Transfer | "Take the same three metrics and apply them to a competitor you know. Does the comparison change how you read this company?" |
| — | **Standing question** | **"What would change your mind?"** — answer with the analysis's own Thesis Invalidation triggers; if it has none, write three. |

---

## 4. Framework — Quiz Mode (`--quiz <lesson>`)

Five questions on one Learning lesson, in this fixed mix:

| # | Type | Design rule |
|---|------|-------------|
| 1 | Recall | A definition or a "which statement is true" — answerable straight from the lesson |
| 2 | Recall | A second core term, ideally the one beginners confuse with the first |
| 3 | Calculation | Give a tiny, fully specified data set (three to five numbers) and ask for one computed value — e.g. "Revenue $200M, COGS $120M, opex $50M: what is the operating margin?" Show the worked solution in the answers |
| 4 | Judgment | Two companies described in two lines each; ask which the lesson's framework prefers and *why* |
| 5 | Judgment / transfer | A situation where the naive reading and the correct reading differ (the value-trap pattern, the buyback that hides dilution, the beta that understates risk) |

Format:

```
## Quiz — <Lesson name>  (5 questions · --level <level>)

1. …
2. …
3. … (data: …)
4. …
5. …

## Answers
1. <answer> — <one-line why>
2. …
3. <worked calculation> = <result>
4. …
5. …

**Re-read:** <Lesson name> → <section or concept>, and the Glossary entry for <term>.
```

Never pull questions from outside the named lesson; the point is to confirm the lesson landed, not to test breadth. In `--lang zh-TW` write questions and answers in Traditional Chinese with English metric names in brackets.

---


