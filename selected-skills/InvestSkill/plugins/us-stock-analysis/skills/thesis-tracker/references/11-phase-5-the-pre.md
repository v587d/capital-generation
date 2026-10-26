# 3. Framework(continued)

Part 2 of 3 for `thesis-tracker` — 3. Framework; 4. The Saved File — Contract; Thesis; KPIs; Triggers; Catalysts; Pre-mortem; Next check; Decision log; 5. Output Format
See `SKILL.md` for what to read and when; this part is procedure, not routing.

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
6. Append a **decision log** row. The log records what the user *did* and *why*, priced and dated, and names the skill that informed it. It is the raw material for `post-trade-review`.

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


