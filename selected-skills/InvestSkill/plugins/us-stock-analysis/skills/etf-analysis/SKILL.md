---
name: etf-analysis
description: ETF / index-fund due diligence — expense ratio vs. category, tracking difference, liquidity, holdings concentration and tilt, overlap with your other positions, distribution and capital-gains history, structure warnings, and an ETF-vs-top-holdings comparison, scored as an ETF Fitness Score 0–10
---

# ETF Analysis — What You Actually Own, and What It Costs You

## ⚠️ Data Verification — Do This Before Any Analysis

Before running any analysis, always retrieve the latest fund data for the ticker:

1. **Fetch current price and NAV** — get the live price, the fund's net asset value, and the premium/discount to NAV through the host's own data path; delegate the request in a role-split host. Never assume a price from training data.
2. **Confirm the fund facts from the issuer** — expense ratio, index tracked, AUM, inception date, holdings count, top-10 weights, and distribution history come from the issuer's factsheet and prospectus, not from memory. Fund facts change: expense ratios get cut, indexes get swapped, funds get merged or closed.
3. **State your data source** — fill in the `Data & Sources` header (next section) so the origin, as-of date, retrieval path, and confidence of every figure are explicit at the top of the output.
4. **Stop on missing data** — if a figure cannot be retrieved through the host's data path, name what is missing and stop; the analysis does not run on remembered values:

> ⚠️ **Data unavailable.** <list the figures this analysis could not retrieve>. Those fields are reported as missing and are not estimated — retrieval is a precondition, not a nicety.

Never substitute a remembered value for a retrieved one. Getting the factsheet is the host data path's job — delegate it; asking the user is the last resort only where the host has no retrieval path at all.

---

## 📋 Data & Sources Header — Open Every Output With It

The first thing in the output is this provenance block, filled in — never left as placeholders. It is the standard documented on the [Data & Accuracy](https://yennanliu.github.io/InvestSkill/data-and-accuracy.html) page and the first thing `result-validator` looks for:

```
Data & Sources
  As of:      <date the figures represent, e.g. 2026-06-30>
  Source:     <primary docs — SEC EDGAR 10-K/10-Q, company IR, FRED, exchange data …>
  Retrieval:  <delegated retrieval | web/tool retrieval | pasted by user>
  Confidence: <HIGH | MEDIUM | LOW>
```

- Memory is not a retrieval path. A figure that was neither retrieved nor supplied by the user is reported as missing, never estimated — and never written into this block as if it had been retrieved.
- Mixed sources: list each with its own as-of date rather than blending them.
- Data the user pasted is reported as `pasted by user`; do not upgrade its confidence beyond what the user's own source supports.

---

## Read the Parts

Everything below the surface of this file lives in `references/`. **whole, with no line window** — quoting a rule or a template out of a slice of one is how a
file gets reported as read when it was only skimmed. The file names below are the only
addressing this entry has.

- `references/10-overview.md` — Overview; 1. Inputs; 2. Framework
- `references/11-phase-5-overlap-with.md` — (continued) 2. Framework
- `references/12-output-format.md` — 3. Output Format; Example; Notes; Thesis Invalidation
- `references/13-standard-signal-output.md` — Standard Signal Output

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.
