---
name: position-ladder
description: Plan a staged position — entry ladder, share-count floor/ceiling, and the trim/re-add cycle that lowers average cost — with lot accounting, wash-sale checks, total-return honesty, and a thesis-break exit gate
---

# Position Ladder — Staged Entry & Cost-Basis Management

## Evidence request

通过宿主数据契约请求：持仓与成本（使用者提供）、行情序列（复权口径与 as-of）。

缺哪个字段就点名并停止该字段下的分析；用户粘贴的材料标 `pasted by user`。


## ⚠️ Data Verification — Do This Before Any Analysis

Before running any analysis, always retrieve the latest market data for the ticker:

1. **Fetch current price** — get the live price, 52-week range, and market cap through the host's own data path. In a host that splits roles, delegate the request with an exact brief (ticker, fields, as-of date) rather than searching from this step. Never assume a price from training data.
2. **Confirm key figures** — recent earnings, revenue, key ratios (P/E, P/S, etc.) as applicable to this skill.
3. **State your data source** — fill in the `Data & Sources` header (next section) so the origin, as-of date, retrieval path, and confidence of every figure are explicit at the top of the output.
4. **Stop on missing data** — if a figure cannot be retrieved through the host's data path, name what is missing and stop; the analysis does not run on remembered values:

> ⚠️ **Data unavailable.** <list the figures this analysis could not retrieve>. Those fields are reported as missing and are not estimated — retrieval is a precondition, not a nicety.

Never substitute a remembered value for a retrieved one. Getting the number is the host data path's job — delegate it; asking the user to paste is the last resort only where the host has no retrieval path at all.

---

## 📋 Data & Sources Header — Open Every Output With It

The first thing in the output is this provenance block, filled in — never left as placeholders. It is the standard `result-validator` looks for first:

```
Data & Sources
  As of:      <date the figures represent, e.g. 2026-06-30>
  Source:     <venue, document, date — as returned by retrieval>
  Retrieval:  <delegated retrieval | web/tool retrieval | pasted by user>
  Confidence: <HIGH | MEDIUM | LOW>
```

- Memory is not a retrieval path. A figure that was neither retrieved nor supplied by the user is reported as missing, never estimated — and never written into this block as if it had been retrieved.
- Mixed sources: list each with its own as-of date rather than blending them.
- Data the user pasted is reported as `pasted by user`; do not upgrade its confidence beyond what the user's own source supports.

---

## ⚠️ Read This First — This Is Scenario Modeling, Not a Recommendation

This framework is **more prescriptive than the rest of the InvestSkill catalog**: it outputs specific price levels and share counts. Every number it produces is a **conditional plan under stated assumptions**, not an instruction to trade.

Three honest claims must appear in every output:

1. **Lowering average cost is not the same as making money.** Average cost is an accounting anchor and a psychological one — it is not a return metric. Trimming a high-cost lot mechanically lowers the number without creating a dollar of wealth. Always report **total return and realized P&L alongside average cost**, and show the buy-and-hold comparison.
2. **This is volatility harvesting.** The strategy monetizes oscillation around a level. It **outperforms in a range-bound / mean-reverting tape and underperforms in a strong trend** — in either direction. A stock that only goes up leaves the ladder underfilled; a stock that only goes down fills it and keeps falling.
3. **Position control is the actual edge.** The hard ceiling on share count — "stop adding at N shares, no matter what" — is what converts averaging down from an unbounded liability into a bounded, pre-sized bet. Without the cap, this is not a strategy; it is a mechanism for concentrating capital into losers.

State all three, then produce the plan. Never present the ladder as a way to guarantee a recovery.

---

## Read the Parts

Everything below the surface of this file lives in `references/`. **whole, with no line window** — quoting a rule or a template out of a slice of one is how a
file gets reported as read when it was only skimmed. The file names below are the only
addressing this entry has.

- `references/10-overview.md` — Overview; 1. Inputs; 2. Phase 1 — Position Control (控倉): Set the Bounds First; 3. Phase 2 — Build the Entry Ladder
- `references/11-phase-3-the-trim.md` — 4. Phase 3 — The Trim / Re-Add Cycle; 5. Phase 4 — Lot Accounting, Taxes & Wash Sales; 6. Phase 5 — Reality Check: Total Return vs. Average Cost
- `references/12-phase-6-the-thesis.md` — 7. Phase 6 — The Thesis-Break Gate; 8. Scenario Presets; 9. Worked Example
- `references/13-input-formats.md` — 10. Input Formats; 11. Output Format; Notes; Signal Output; Thesis Invalidation

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.
