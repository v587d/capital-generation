# 3. Framework(continued)

Part 3 of 4 for `fact-check` — 3. Framework; References; 4. Output Format; Example
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### Phase 5 — Consistency and honesty of the report itself

- **Numbers vs. narrative** — does the text say what the tables say? ("margins expanding" next to a table where they fell)
- **Internal contradictions** — the same figure quoted two ways in two sections.
- **Signal vs. score** — the signal box's Score must sit in the band its Signal implies (≥ 6.0 BULLISH · 4.0–5.9 NEUTRAL · < 4.0 BEARISH); a mismatch is a red flag, not a rounding issue.
- **The report's `Data & Sources` header vs. what was verifiable** — a header claiming `Retrieval: web/tool retrieval · Confidence: HIGH` over a report whose figures cannot be traced is itself a finding. Quote the header and state whether the verification supports it.
- **Fabricated or unopenable citations** in the report — a reference that does not exist, or a page/Item that does not contain the figure, is the most serious finding this skill can make. Say so plainly.

### Phase 6 — Re-issue the report with citations

Produce the corrected copy (or the diff, if asked):

- Every `✅` figure gets an inline citation `[n]`; every `🔁 agrees` figure gets the citation of its inputs plus `(recomputed)`.
- Every `⚠️` figure is corrected **in place**, with the original struck through: ~~$5.9B~~ **$6.12B** [1] — and a one-line note on the cause. Never silently change a number.
- Every `❓` figure is marked `[?]` and left as written. Every `🕒` figure keeps its citation and gains `(as of <date>; current: <value> [m])`.
- Qualitative claims whose evidence failed are marked `[unsupported]`.
- A **References** section closes the report:

```
## References
[1] Zephyr Robotics Inc., Form 10-K for FY ended 2026-03-31 — Item 8, Consolidated Statements of Operations, p. 54 (SEC EDGAR, accession 0000000000-26-000000; retrieved 2026-06-30)
[2] Same filing — Item 8, Consolidated Statements of Cash Flows, p. 58
[3] Zephyr Robotics Q4 FY2026 earnings release, 2026-05-14 — segment table (company IR)
[4] Form 4, filed 2026-05-19 — CFO open-market purchase (SEC EDGAR)
[5] User-supplied: price and shares outstanding as of 2026-06-30 close (pasted by user; not independently verified)
```

Each reference names the document, the exact location, the as-of or filing date, and how it was retrieved. If the environment cannot produce a URL or accession number, say so rather than inventing one.

### Phase 7 — Verification Score (0–10)

The headline number measures **how much of the report is demonstrably true**, not whether the report's conclusion is right.

| Component | Weight | 10 looks like | 0 looks like |
|-----------|--------|---------------|--------------|
| Coverage | 30% | ≥ 95% of claims `✅` or `🔁 agrees` | < 40% |
| Signal-driving accuracy | 30% | Every signal-driving claim verified within tolerance | A signal-driving claim off by > 5% or from the wrong period |
| Recomputation | 15% | Every derived figure agrees | Derived figures disagree or cannot be rebuilt from the report's own inputs |
| Source quality | 15% | All Tier 1, specific locations | Mostly secondary or user-supplied only |
| Freshness | 10% | Every as-of date matches the report's claim and is < 90 days old for market data | Stale figures presented as current |

**Hard caps** (state any that fires): a signal-driving `⚠️` **or `🔁 disagrees`** with delta > 5% → **max 4.0** · more than half the claims `❓` → **max 5.0** · the report's own `Data & Sources` header overstates its retrieval or confidence → **max 6.0** · **any fabricated or unopenable citation found in the report → 0.0**. Always print a `Caps fired:` line under the score (`none`, or the list) so a capped 4.0 is never mistaken for an earned 4.0 — **a report whose score was capped by a signal-driving mismatch is a failed verification regardless of the number.**

Map onto the standard bands: **≥ 6.0** the report's inputs are sound (BULLISH on the *report*) · **4.0–5.9** usable with the listed corrections (NEUTRAL) · **< 4.0** do not rely on it — re-run the analysis with verified inputs (BEARISH). Hand the score and the ledger to `result-validator`, whose Data Quality dimension should not exceed what this score supports.

---

## 4. Output Format

1. `Data & Sources` header — the sources *used to verify*, with retrieval path
2. **Verification summary** — one line: `N claims · V verified · R recomputed (r agree) · M mismatch · U unverifiable · S stale · Verification Score X.X · Caps fired: none | <list>`
3. **Signal-driving claims first** — the 3–5 that matter, each with verdict, source, and delta
4. **Claim ledger** — the full table from Phase 1 with verdict, source tier, location, as-of
5. **Mismatches in detail** — original · source value · delta · likely cause · what the corrected figure does to the report's conclusion
6. **Recomputation table** — Phase 4, arithmetic shown
7. **Report consistency findings** — Phase 5, including the judgment on the report's own header
8. **Corrected report with citations** (or `--diff` output) and the **References** section
9. **Thesis Invalidation** — what would change these verdicts (below)
10. **Investment Signal block** — mirrors the report's signal with the verification verdict attached (below)

---

## Example

```
User: [pastes a stock-eval output on ZEPH that concludes BULLISH 7.4 / 10] Verify every number
      and add sources. Here is the FY2026 10-K excerpt and the Q4 release. [pasted]

The assistant lists 23 claims, flags 5 as signal-driving (revenue growth, gross margin, FCF,
net cash, forward P/E). Verifies 17 against the 10-K and the release with Item/statement/page
locations; recomputes 6 derived figures — all agree except one: the report's "24× forward P/E"
is 48.20 ÷ 1.99, i.e. the *trailing* multiple on FY2026 diluted EPS; no forward estimate is
cited, so the claim becomes ⚠️ MISMATCH (label) with the corrected wording "24.2× trailing";
consensus forward EPS would be needed for the forward figure → ❓ until supplied. Two claims
are 🕒 STALE: the price and market cap are from a date 40 days before the report. One
qualitative claim ("dominant share of warehouse robotics") cites no evidence → [unsupported].
The report's own header said "Retrieval: web/tool retrieval · Confidence: HIGH"; 17/23 verified
supports MEDIUM, so that is noted. No fabricated citations. Verification Score 6.8 — the report's
inputs are sound; the signal stands with the valuation sentence corrected. Emits the corrected
report with [1]–[9] inline and a References section, and hands the ledger to result-validator.
```

---


