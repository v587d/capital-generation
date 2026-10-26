---
name: industry-map
description: Map an industry's supply / value chain as a directed graph — upstream to downstream — to locate a company's position, find chokepoints and margin pools, and surface second-order investment ideas
---

# Industry Map — Supply & Value Chain

## Evidence request

通过宿主数据契约请求：行业数据（产量、价格、政策，注明来源与日期）、披露文件（公告、年报或招股书，带回出处与文档日期）。

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

Draw an industry's supply and value chain as a directed graph — from raw inputs upstream all the way down to the end user — so you can take a **bird's-eye view of a business**, see where a company sits in the flow, understand where value and pricing power concentrate today, and reason about where they will migrate next.

## Read the Parts

Everything below the surface of this file lives in `references/`. **whole, with no line window** — quoting a rule or a template out of a slice of one is how a
file gets reported as read when it was only skimmed. The file names below are the only
addressing this entry has.

- `references/10-overview.md` — Overview; 1. The Value Chain Model; 2. Step 1 — Define the Scope; 3. Step 2 — Build the Chain Map (the graph)
- `references/11-step-3-position-locator.md` — 4. Step 3 — Position Locator; 5. Step 4 — Chokepoint & Bottleneck Analysis; 6. Step 5 — Value-Pool & Margin Migration; 7. Step 6 — Concentration & Supply-Chain Risk; 8. Step 7 — Investment Idea Generation; 9. Worked Example — AI Compute Stack; 10. Input Formats
- `references/12-visualization-support.md` — 11. Visualization Support; Output; Standard Signal Output; Thesis Invalidation

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.
