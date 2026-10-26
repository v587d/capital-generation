# Overview

Part 1 of 3 for `thesis-tracker` — Overview; 1. Modes; 2. Inputs; 3. Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Overview

Every other framework in the catalog answers a question *today*: is it cheap, is the moat real, is the chart constructive, what does the bear say. None of them remembers the answer. Three months later the investor is left with a position, a vague feeling, and no record of what they expected to happen — which is exactly the state in which people average down on a broken story or sell a working one on a bad week.

**This skill turns an analysis into a contract with your future self.** It produces a single saved file per ticker that states, in falsifiable terms, *why* the position exists, *which numbers* have to keep being true, *what* would prove the idea wrong, and *when* the next check is due. Then, on `--update`, it re-reads that file against current data and hands back one word — **INTACT**, **WEAKENED**, or **BROKEN** (or **INSUFFICIENT EVIDENCE** when the data to decide is not there) — together with the specific line that changed.

It fills the gap between Playbook steps 1 (write the thesis), 9 (monitor), and 10 (know when to sell) in the Learning track, which today have no skill behind them.

**What it is not.** It is not a valuation, a screen, or a timing tool. It imports its KPIs and triggers *from* the other skills (`stock-eval` for quality metrics, `stock-valuation` for the fair-value range, `bear-case` for the thesis-killers, `catalyst-calendar` for dates, `position-ladder` for the share-count ceiling) and holds them to account. Run the analysis skills first; run this one to write down what they concluded.

---

## 1. Modes

| Mode | Invocation | What it does |
|------|------------|--------------|
| **Open** | `thesis-tracker NVDA` (+ pasted analyses, or none) | Interview the user, draft the thesis file, save it to `output/thesis/NVDA.md` |
| **Update** | `thesis-tracker NVDA --update` (+ current data or a fresh analysis) | Re-read the saved file, refresh every KPI, re-test every trigger, return INTACT / WEAKENED / BROKEN (or INSUFFICIENT EVIDENCE), append to the decision log |
| **Review** | `thesis-tracker --review` (no ticker) | Read every file in `output/thesis/`, list status and next-check date per ticker, flag anything overdue or sitting at INSUFFICIENT EVIDENCE |
| **Close** | `thesis-tracker NVDA --close "sold — trigger 2 fired"` | Mark the thesis closed with the exit reason and final P&L; keep the file for `post-trade-review` |

If the environment cannot write files, output the complete thesis file as a fenced block and tell the user to save it at the stated path — the *contract* matters, not the storage.

---

## 2. Inputs

| Input | Required | Default if unstated |
|-------|----------|---------------------|
| Ticker | ✅ for Open, Update, Close · not used by Review (it reads every file) | — |
| The thesis in the user's own words | ✅ for Open | ask — never invent a thesis for the user |
| Entry price and date, position size | recommended | record as "not stated" |
| Prior analyses (`stock-eval`, `bear-case`, `stock-valuation`, …) | optional | derive KPIs from the thesis text |
| Horizon | optional | 12 months |
| Existing thesis file | ✅ for Update / Close | — |

**The user writes the thesis; the skill sharpens it.** If the stated thesis is not falsifiable ("great company, will go up"), push back with the three questions in Phase 1 until it is. A thesis that cannot be wrong cannot be tracked.

---

## 3. Framework

### Phase 1 — Sharpen the thesis (Open)

Reduce the thesis to **one paragraph** that answers, in order:

1. **What has to happen** to the business for this to work (the mechanism — not "the stock goes up")
2. **Why the market is wrong** today — what is mispriced, and why the user sees it and the marginal buyer does not
3. **Why now** — the catalyst, the regime, or the price that makes this a decision today instead of in a year

Reject any paragraph that only restates the company description. Test: *could a reasonable bear read this and know exactly what to disagree with?*

### Phase 2 — Pick the KPIs (3–5, no more)

Each KPI is a number the thesis *depends on*, with a **threshold** below or above which the thesis is in trouble, and a **source** that can be checked next quarter.

| KPI | Threshold | Why it matters to *this* thesis | Source | Current | Date |
|-----|-----------|--------------------------------|--------|---------|------|
| e.g. Data-center revenue growth (YoY) | ≥ 40% | The multiple assumes hyperscaler capex keeps compounding | 10-Q segment table | 112% | 2026-05-28 |
| e.g. Gross margin | ≥ 70% | Pricing power is the moat claim; margin is its footprint | 10-Q | 75.5% | 2026-05-28 |
| e.g. Net cash | > $0 | Rules out balance-sheet stress in a downturn | 10-Q | +$38B | 2026-05-28 |

Rules:
- Prefer KPIs from the **financial statements** over sentiment or price-based ones. Price is the output, not an input to the thesis.
- **One valuation KPI is allowed** (e.g. forward P/E ≤ 35 or price within `stock-valuation`'s fair-value range) so that "the thesis is right but fully priced" is a detectable state.
- If a KPI has no threshold, it is a curiosity, not a KPI. Remove it.
- Import thresholds from the analyses that produced them when available (`stock-eval` quality gates, `dividend-analysis` payout ceiling, `short-interest` squeeze levels).

### Phase 3 — Write the invalidation triggers

Triggers are **events**, not feelings. Each one names the observation and the action it obliges:

```
Triggers   | if <observable event or KPI breach>        → <action: review / trim / exit>
```

Draw them from three places, in this order of authority:
1. **The Thesis Invalidation sections** of every analysis skill already run on the ticker — copy them in verbatim, they were written for exactly this
2. **The `bear-case` Thesis-Killers** — the bear's best arguments become the bull's triggers
3. **The user's own "I would sell if…"** — written down while calm

A KPI breach is a *review* trigger by default; two simultaneous breaches, or any breach of the thesis's core mechanism (Phase 1, item 1), is an *exit* trigger. Price alone is never an exit trigger unless the user is explicitly running a stop-loss discipline — write that down too, so it is a rule and not a reaction.

### Phase 4 — Catalysts and the next check

List the dated events that will *produce new evidence* for or against the thesis (earnings, product cycles, regulatory decisions, lock-up expiries, FOMC when the thesis is rate-sensitive). Import from `catalyst-calendar` when available. The **next-check date** is the earliest of: the next catalyst, the next earnings release, or 90 days.


This section is not finished here: `3. Framework` continues in `references/11-phase-5-the-pre.md`.
