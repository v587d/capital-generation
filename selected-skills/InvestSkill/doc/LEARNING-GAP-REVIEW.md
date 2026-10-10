# InvestSkill — Learning Track Gap Review

*Review date: 2026-09-24 · Reviewed at main `48d72fc` (after PR #28) · Learning track: 8 lessons · Concepts: 7 topics · Glossary: 44 terms · Use Cases: 5 journeys*

> **Question asked.** What does a person need to know to be a *good* investor in the US stock market — practical, doable foundations, not theory — and how much of it does the site's Learn section already teach?
>
> 繁體中文版：[LEARNING-GAP-REVIEW-zh-TW.md](LEARNING-GAP-REVIEW-zh-TW.md) · Related: [IMPROVEMENT-ROADMAP.md](IMPROVEMENT-ROADMAP.md) §5.1–5.3 · Shipped in [PR #29](https://github.com/yennanliu/InvestSkill/pull/29)

---

## 1. Where the Learn section stands

**Strong — the analytical core.** Lessons 1–8 teach *how to analyze a company* from first principles, bilingually: what a share is → the three statements and free cash flow → ROIC vs. WACC, moats, capital allocation → DCF, multiples, margin of safety → technicals, insider / institutional / short / options signals, macro → allocation, sizing, rebalancing, behavioral pitfalls → a written professional loop (thesis, plan, trade ticket, tracking, sell discipline) run twice on real companies (Apple, AMD). Concepts, the Glossary, Use Cases, and Data & Accuracy round it out. This part does not need more content.

**Weak — the operational foundations.** Almost nothing on what a person meets in the first month of actually investing: opening the right account, placing an order, building an ETF core, understanding what tax does to the return, what happens in earnings season, and what losing looks like. Both capstones end in BUY.

---

## 2. What a good US-stock investor should know — coverage map

✅ covered · ⚠️ touched on · ❌ missing (before this PR)

### A. Before the first trade

| Know | Doable action | Site |
|------|---------------|------|
| Goal, horizon, risk *capacity* vs. risk *tolerance* | Write a one-page Investment Policy Statement (IPS): allocation, contribution and rebalancing rules, position limits, "what I will not do" | ❌ |
| Account types and what they mean for tax | US: taxable / traditional IRA / Roth. Non-US: W-8BEN, withholding at source, the $60k estate-tax exemption | ❌ |
| Broker and costs | Commissions, FX fees, spreads, margin rates; compare two before opening | ⚠️ (bid/ask in Lesson 1) |
| Order types and settlement | Market vs. limit (default to limit), stop, extended-hours risk, T+1 | ❌ |
| Money you don't invest | 3–6 months of expenses first | ❌ |
| An ETF core | Expense ratio, tracking difference, overlap, leveraged / inverse decay | ❌ (skill exists: `etf-analysis`) |
| Staged entry / DCA | Fixed date, fixed amount, written into the IPS | ✅ |

### B. Reading a company — ✅
Three statements, FCF, red flags, ROIC vs. WACC, moats, capital allocation, Piotroski / Altman. The best part of the site.

### C. Judging price — ✅, one gap
Multiples, DCF assumptions, margin of safety, triangulation. Missing: what *market expectations* are — consensus, guidance, whisper, "what's priced in" ⚠️.

### D. Reading the market and events — ✅, one gap
Trend / MAs / RSI, Form 4, 13F, short interest, options signals, the macro dials. Missing: **how earnings season works** ❌ — calendar, BMO / AMC, beat-and-drop, implied move, what not to do into a print (skill exists: `earnings-preview`).

### E. Portfolio and risk — ✅, two gaps
Allocation, sizing, rebalancing, correlation, Sharpe, DCA, behavioral pitfalls, checklist. Missing:
- **Taxes** ❌ — short vs. long-term, the 61-day wash-sale window, the qualified-dividend test, harvesting, lot selection; for non-US investors, withholding / estate tax / UCITS. The gap between what you earn and what you keep — not a sentence on it (skill exists: `tax-lens`).
- **Stress test and max drawdown** ⚠️ — know what the portfolio does in 2008 / 2020 / 2022 before sizing (skill exists: `risk-stress-test`; Lesson 6 has a recap only).

### F. Process and discipline — ✅, four gaps
Thesis, trading plan, tracking, sell discipline (Lesson 7 is excellent). Missing:
- **A losing or "pass" case** ❌ — both capstones end in BUY; the Cookbook's PFE value trap and UPST no-trade are ready-made.
- **Psychology in depth** ⚠️ — disposition effect, anchoring, FOMO, pre-mortem, process vs. outcome.
- **Journal template and post-mortem** ⚠️ — one example in Lesson 7, no reusable template (the `thesis-tracker` file format is one).
- **Self-check quizzes** ❌ — no lesson ends with questions (`learning-coach --quiz` can already generate them).

### G. Data and trust — ✅
Data & Accuracy: source hierarchy, spotting hallucinated numbers, `fact-check` → `result-validator`.

---

## 3. The minimum viable foundation — twelve things, in order

For someone who has just opened an account:

1. Keep 3–6 months of expenses out of the market; write a one-page IPS (goal, horizon, allocation, contribution rule, what you will not do).
2. Choose the account type; non-US: sign the W-8BEN and remember two numbers — 30% and $60,000.
3. Learn the limit order. Always use the limit order.
4. Build the core with ETFs: expense ratio, tracking difference, overlap with what you already hold.
5. Read the three statements; be able to compute FCF = operating cash flow − capex.
6. Judge a business by ROIC vs. WACC and the direction of gross margin.
7. Read P/E, EV/EBITDA, P/FCF — and know what each multiple *assumes*.
8. Understand consensus and guidance; know what not to do around an earnings date.
9. Write the thesis and its invalidation triggers before every trade.
10. Write the position cap, the rebalancing date, and the stop-adding gate.
11. Know what the portfolio would have lost in 2008 / 2020 / 2022; revisit item 10.
12. Re-check the thesis quarterly; run the wash-sale and holding-period check before every sale.

---

## 4. What this PR ships

| Item | Files | Fills |
|------|-------|-------|
| **Lesson 9 · Before Your First Trade** — goals, risk capacity vs. tolerance, IPS template, account types (US + non-US), choosing a broker, order types, T+1, first-month checklist | `LEARNING-SETUP(-zh-TW).md` | A |
| **Lesson 10 · ETFs & Index Investing** — expense ratio, tracking difference vs. error, liquidity, what you own, overlap, core-satellite, structure warnings, the UCITS pointer | `LEARNING-ETFS(-zh-TW).md` | A |
| **Lesson 11 · Taxes & Account Types** — short vs. long-term, wash sale, qualified dividends, lots, harvesting, placement; a full non-US section (W-8BEN, withholding, no-treaty case, capital gains, estate tax, UCITS) | `LEARNING-TAXES(-zh-TW).md` | E |
| **Lesson 12 · Earnings Season, Explained** — the cycle, consensus / guidance / whisper, beat-and-drop, implied move, what's priced in, reading a release, the scenario grid, what not to do | `LEARNING-EARNINGS(-zh-TW).md` | C, D |
| **Lesson 13 · Psychology & Process** — process vs. outcome, the biases and their antidotes, pre-mortem, checklists, journal template, sell rules, drawdowns | `LEARNING-PSYCHOLOGY(-zh-TW).md` | F |
| **Case Study · When the Answer Is No** — PFE value trap and UPST no-trade, from the Cookbook's live runs | `LEARNING-CASE-PASS(-zh-TW).md` | F |
| **Self-check quizzes** in every new lesson and case | — | F |
| **Glossary +32 terms** (44 → 76) — expense ratio, tracking difference/error, AUM, bid-ask spread, overlap, wash sale, qualified dividend, specific identification, tax-loss harvesting, W-8BEN, withholding tax, estate tax (non-resident), UCITS, ex-dividend date, consensus, guidance, whisper number, implied move, beat-and-drop, drawdown, VaR / CVaR, Sortino, correlation, IPS, limit / market order, T+1 settlement, disposition effect, anchoring, pre-mortem, process vs. outcome | `GLOSSARY(-zh-TW).md` | all |
| Learning hub restructured into **Part I — Analyze a business (1–8)** and **Part II — Practical foundations (9–13 + case)**; nav, language toggle, search index | `LEARNING(-zh-TW).md`, `build-site.js` | — |

Lesson numbering: the roadmap (§5.1) numbered ETFs as Lesson 9. This PR adds *Before Your First Trade* as Lesson 9 first, so ETFs = 10, Taxes = 11, Earnings = 12, Psychology = 13. Existing lessons 1–8 keep their URLs.

---

## 5. Still open after this PR

- Roadmap §5.1 Lessons "Macro & the Fed Cycle" and "Options for Stock Investors" — the material exists in Lesson 5; a dedicated lesson each is a nice-to-have, not a gap.
- Self-check quizzes for Lessons 1–8 (the new lessons have them; `learning-coach --quiz` covers the old ones on demand).
- A standalone **Non-US Investor Guide** page (§5.4) — Lesson 11's non-US section is the core of it; the page would add brokers and FX.
- The printable cheat sheet (§5.4) and lesson progress / reading time (§5.5).
- The zh-TW Skill Reference index (§5.6).

*Recommendations and educational content only. Not financial or tax advice.*
