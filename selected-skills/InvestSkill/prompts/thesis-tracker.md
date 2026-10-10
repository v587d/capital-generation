# Thesis Tracker — Write It Down, Then Check It

## ⚠️ Data Verification — Do This Before Any Analysis

Before running any analysis, always retrieve the latest market data for the ticker:

1. **Fetch current price** — use web search or ask the user for the live price, 52-week range, and market cap. Never assume a price from training data.
2. **Confirm key figures** — the current value of every KPI the thesis names (revenue growth, margin, FCF, net debt, subscriber count, …). A thesis check against stale KPIs is worse than no check: it produces false confidence.
3. **State your data source** — fill in the `Data & Sources` header (next section) so the origin, as-of date, retrieval path, and confidence of every figure are explicit at the top of the output.
4. **Flag stale data explicitly** — if live data is unavailable, display this warning before proceeding:

> ⚠️ **Live data unavailable.** The following analysis uses training-data estimates which may be significantly out of date. Verify all prices and metrics before making any decisions.

Never silently substitute training-data estimates for current prices. When in doubt, ask the user to paste the latest quote.

---

## 📋 Data & Sources Header — Open Every Output With It

The first thing in the output is this provenance block, filled in — never left as placeholders. It is the standard documented on the [Data & Accuracy](https://yennanliu.github.io/InvestSkill/data-and-accuracy.html) page and the first thing `result-validator` looks for:

```
Data & Sources
  As of:      <date the figures represent, e.g. 2026-06-30>
  Source:     <primary docs — SEC EDGAR 10-K/10-Q, company IR, FRED, exchange data …>
  Retrieval:  <pasted by user | web/tool retrieval | model memory>
  Confidence: <HIGH | MEDIUM | LOW>
```

- `Retrieval: model memory` must be paired with `Confidence: LOW` — memory is a placeholder until confirmed against a primary source.
- Mixed sources: list each with its own as-of date rather than blending them.
- Data the user pasted is reported as `pasted by user`; do not upgrade its confidence beyond what the user's own source supports.

---

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
| **Close** | `thesis-tracker NVDA --close "sold — trigger 2 fired"` | Mark the thesis closed with the exit reason and final P&L; keep the file for `trade-postmortem` |

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

### Phase 5 — The pre-mortem

One paragraph, written in the past tense, dated twelve months out:

> *"It is <date + 12 months>. The position lost 40%. Looking back, the reason was…"*

This forces the most probable failure path into the open while it can still be wired into a trigger. If the pre-mortem names a cause that no trigger would catch, add the trigger.

### Phase 6 — Update: re-test everything (`--update`)

On every update:

1. Refresh the **Current / Date** columns of every KPI from the newest data the user supplies or the assistant can retrieve. Never carry a stale value forward silently — mark it `stale` with its date.
2. Re-test every **trigger**: fired / not fired / cannot assess (say why).
3. Re-read the **thesis paragraph** against what actually happened. Did the mechanism play out, stall, or go the other way?
4. Return exactly one **status**. Apply the rules top-down; the first that matches wins:

| Status | Rule |
|--------|------|
| **BROKEN** | Two or more KPIs breached on *current* data, *or* any exit-trigger fired, *or* the core mechanism has been falsified (the thing that had to happen did not, and the reason is structural) |
| **WEAKENED** | One KPI breached *or* one review-trigger fired *or* the mechanism is behind schedule — the thesis is still possible but the evidence has moved against it |
| **INSUFFICIENT EVIDENCE** | Fewer than half the KPIs could be refreshed with data dated after the last check, and no trigger could be assessed. Nothing is known to have broken — but nothing has been confirmed either. Name the KPIs that need data, and do **not** carry the previous status forward |
| **INTACT** | Every KPI is within threshold **on data dated after the last check**; no trigger fired; mechanism on track. A stale KPI cannot support INTACT — at best it leaves the status at INSUFFICIENT EVIDENCE |

An INSUFFICIENT EVIDENCE status does not change the file's last confirmed status line; it is recorded in the decision log (`checked — insufficient evidence — <KPIs missing>`) and the next-check date is moved to when the data will exist (usually the next filing).

5. Name **the specific line that changed** — the KPI, its old value, its new value, and the threshold. A status without a line is an opinion.
6. Append a **decision log** row. The log records what the user *did* and *why*, priced and dated, and names the skill that informed it. It is the raw material for `trade-postmortem`.

**Status is not a signal.** WEAKENED does not mean sell; it means the next check moves up and the position should not be added to. BROKEN means the reason for owning it is gone — what to do about that is a `position-ladder` / tax question, but *adding* is off the table. INSUFFICIENT EVIDENCE means the honest answer is "I don't know yet" — treat it like WEAKENED for position management (no adding) until the data arrives.

### Phase 7 — Thesis Health Score (0–10)

The headline number, used for the signal block. It measures **how well the thesis is holding up against its own tests**, not how attractive the stock is.

| Component | Weight | 10 looks like | 0 looks like |
|-----------|--------|---------------|--------------|
| KPI adherence | 40% | All KPIs inside threshold with margin | Majority breached |
| Trigger status | 30% | None fired | Exit trigger fired |
| Mechanism progress | 20% | Phase 1 "what has to happen" is visibly happening | Falsified |
| Evidence freshness | 10% | Every KPI dated within the last quarter | KPIs stale or unverifiable |

Map — the same bands as the standard Score Guide: **≥ 6.0 → INTACT · 4.0–5.9 → WEAKENED · < 4.0 → BROKEN.** INSUFFICIENT EVIDENCE is not scored from the table above — report the score as `n/a` in the file and use **5.0** in the signal block (NEUTRAL, Confidence LOW) so it stays comparable across skills. If the rule table in Phase 6 and the score disagree, the *rule table wins* and the score is adjusted to match — the score summarizes the rules, it does not override them.

---

## 4. The Saved File — Contract

`output/thesis/<TICKER>.md`. Keep the section order and the pipe tables exactly; `--update` and `--review` parse them.

```
# Thesis · <TICKER> · opened YYYY-MM-DD · status INTACT | WEAKENED | BROKEN | INSUFFICIENT EVIDENCE | CLOSED
Data & Sources · as of YYYY-MM-DD · <sources> · <retrieval> · <confidence>

## Thesis
<one paragraph: what has to happen · why the market is wrong · why now>
Horizon: <n> months   Entry: $<price> on YYYY-MM-DD   Size: <shares or % of portfolio>   Ceiling: <from position-ladder, if any>

## KPIs
| KPI | Threshold | Source | Current | Date | Status |
|-----|-----------|--------|---------|------|--------|
| … | … | … | … | … | ✓ / ✗ / stale |

## Triggers
| If | Then | Source | Status |
|----|------|--------|--------|
| … | review / trim / exit | bear-case · stock-eval · user | not fired / FIRED YYYY-MM-DD |

## Catalysts
| Date | Event | Expected impact | Evidence for / against |
|------|-------|-----------------|------------------------|

## Pre-mortem
"It is YYYY-MM-DD. This lost 40% because …"

## Next check
YYYY-MM-DD — <reason: earnings / catalyst / 90-day>

## Decision log
| Date | Action | Price | Reason | Informed by |
|------|--------|-------|--------|-------------|
| YYYY-MM-DD | opened | $… | … | stock-eval, bear-case |
```

---

## 5. Output Format

**Open mode**
1. `Data & Sources` header
2. The sharpened thesis paragraph, with a one-line note on what was changed from the user's draft and why
3. The KPI table, the trigger table, the catalyst list, the pre-mortem, the next-check date
4. The complete saved file in a fenced block (and confirmation of the path it was written to)
5. Thesis Invalidation and the Investment Signal block

**Update mode**
1. `Data & Sources` header
2. **Status line first**: `NVDA · WEAKENED · 2026-08-29 — Gross margin 68.1% (was 75.5%) breached the ≥ 70% threshold`
3. KPI table with old → new values and ✓/✗; trigger table with fired/not fired
4. What the change means for the Phase 1 mechanism, in three sentences
5. The updated file (fenced) with the new decision-log row
6. Thesis Invalidation and the Investment Signal block

**Review mode** — one table: ticker · status · score · next check · overdue? · last decision.

---

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
- **Closed files are inputs to `trade-postmortem`.** Do not delete them.
- File paths and the `output/` convention follow `full-report`. Where the environment cannot write, print the file.

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
