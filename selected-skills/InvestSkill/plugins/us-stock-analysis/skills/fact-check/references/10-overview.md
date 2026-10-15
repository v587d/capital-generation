# Overview

Part 1 of 4 for `fact-check` — Overview; 1. Modes; 2. Inputs; 3. Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Overview

Every InvestSkill analysis opens with a `Data & Sources` header, and `result-validator` scores whether sources are "cited or identifiable". Neither answers the question a careful reader actually has: **is this specific number true, and where exactly does it come from?** A report can carry an honest header, a tidy methodology, and a consistent signal — and still be built on a revenue figure from the wrong fiscal year, a margin computed on non-GAAP earnings, or a share count that was stale when the model wrote it.

This skill closes that gap at the level of the individual claim. It takes any report — an InvestSkill output, a broker note, a spreadsheet, a paragraph from a forum post — pulls out **every figure and factual assertion**, checks each one against a **primary source**, **recomputes** every derived number from verified inputs, and hands back three things: a claim ledger with a verdict per claim (✅ verified · ⚠️ mismatch · ❓ unverifiable · 🔁 recomputed · 🕒 stale), a **corrected copy of the report with inline citations and a References section**, and a **Verification Score 0–10** that `result-validator` can consume as the evidence behind its Data Quality dimension.

**Division of labour.** `result-validator` asks *is this analysis well built?* (methodology, consistency, risk coverage, transparency). `fact-check` asks *are the inputs true?* Run this one first when the stakes are real; the validator's score means little if the numbers underneath it are wrong. `learning-coach` then explains the result to a beginner.

**What it is not.** It does not re-run the analysis, form its own view on the stock, or change the report's signal. It never invents a source to make a claim look verified: an unverifiable claim stays `❓`, and a claim that cannot be traced is more honestly left uncited than given a plausible-looking reference. Fabricating a citation is the one failure mode that makes this skill worse than useless — it is a hard-cap-to-zero offence in the score.

---

## 1. Modes

| Mode | Invocation | What it does |
|------|------------|--------------|
| **Verify** (default) | paste the report (+ sources, or permission to retrieve them) | Full ledger, recomputation, consistency check, corrected report with citations, Verification Score |
| **Cite** | `--cite-only` + the report + its sources | Attach inline citations and a References section to figures the sources confirm; no recomputation, no score beyond coverage — for a report you already trust but need to make traceable |
| **Recompute** | `--recompute` + the report | Only the arithmetic: rebuild every derived figure from the reported inputs and flag disagreements — fast, needs no external source |
| **Diff** | `--diff` + two versions of a report or two data sets | Which figures changed, by how much, and whether the change is a restatement, a period roll, or an error |

If a source cannot be retrieved in the environment, the skill says which claims that blocks and leaves them `❓`; asking the user for the document is only for a host with no retrieval path. It never fills the gap from memory.

## 2. Inputs

| Input | Required | Default if unstated |
|-------|----------|---------------------|
| The report or data to check (pasted, or a file) | ✅ | — |
| Sources: pasted filing text / IR release / data table, URLs, or permission to retrieve | ✅ for Verify and Cite | ask; without sources every claim is `❓` and the score is capped |
| Ticker and fiscal calendar (FY end month) | recommended | infer from the report; state it — half of all "mismatches" are fiscal-year confusions |
| Tolerance for market data (price, market cap) | optional | ±1% and same trading day |
| Which claims are **signal-driving** (the 3–5 numbers the report's conclusion rests on) | optional | infer from the report's own signal box and thesis; state the choice |
| Output form: corrected copy vs. annotated diff | optional | corrected copy with strike-through of originals |

---

## 3. Framework

### Phase 1 — Extract every claim into a ledger

Read the report once and list **every** checkable statement — not just the headline numbers. One row per claim:

| # | Claim (as written) | Value · unit · period | Type | Signal-driving? | Where in report |
|---|--------------------|-----------------------|------|-----------------|-----------------|
| 1 | "Revenue grew 20% to $6.12B in FY2026" | $6,120M · FY2026 · +20% YoY | reported (filing) | ✅ | §2 Financial Health |
| 2 | "FCF of $930M" | $930M · FY2026 | derived (OCF − capex) | ✅ | §2 |
| 3 | "trades at 24× forward earnings" | 24.2× · as of ? | market × estimate | ✅ | §3 Valuation |
| 4 | "CFO bought $1.2M of stock in May" | $1.2M · 2026-05 | fact (Form 4) | — | §5 Insider |
| 5 | "top customer is 18% of revenue" | 18% · FY2026 | reported (10-K risk factors) | — | §1 |

**Claim types** decide which source can verify them: *reported* (a figure stated in a filing or release), *derived* (computed from reported figures — must be recomputed, not just matched), *market* (price, market cap, yield — needs an as-of date), *estimate* (consensus, guidance — needs the source and date of the estimate), *macro* (rates, CPI — FRED / BLS series and vintage), *fact* (an event: a filing, a transaction, an appointment), *qualitative* (a characterization — "dominant", "improving" — checked for whether the cited evidence supports it, never marked verified on its own).

Mark the **signal-driving** claims. They carry more weight in the score and a mismatch on one of them changes the report's standing.


This section is not finished here: `3. Framework` continues in `references/11-phase-2-source-hierarchy.md`.
