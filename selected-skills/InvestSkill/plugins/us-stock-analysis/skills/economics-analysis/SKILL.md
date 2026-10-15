---
name: economics-analysis
description: Analyze US economic indicators and their impact on markets
---

# US Economics Analysis

## ⚠️ Data Verification — Do This Before Any Analysis

Before running any analysis, retrieve the latest release of every indicator you use:

1. **Fetch current readings** — get the latest value and release date of each indicator (FRED, BLS, BEA, ISM, the Fed) through the host's own data path; delegate the request in a role-split host. Never assume a reading from training data; indicators are revised and re-released on a schedule.
2. **Confirm key figures** — the policy rate, the 2s10s spread, the latest CPI/PCE, payrolls and unemployment, and PMI, each with its release date.
3. **State your data source** — fill in the `Data & Sources` header (next section) so the origin, as-of date, retrieval path, and confidence of every figure are explicit at the top of the output.
4. **Stop on missing data** — if a figure cannot be retrieved through the host's data path, name what is missing and stop; the analysis does not run on remembered values:

> ⚠️ **Data unavailable.** <list the figures this analysis could not retrieve>. Those fields are reported as missing and are not estimated — retrieval is a precondition, not a nicety.

Never substitute a remembered value for a retrieved one. Getting the print is the host data path's job — delegate it; asking the user is the last resort only where the host has no retrieval path at all.

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

Analyze US economic conditions and their implications for investment decisions.

## Read the Parts

Everything below the surface of this file lives in `references/`. Open a part with `read`,
one whole part at a time — the file names below are the only addressing this entry has.

- `references/10-key-economic-indicators.md` — Key Economic Indicators; Analysis Framework; Yield Curve Analysis
- `references/11-credit-market-indicators.md` — Credit Market Indicators; Global Macro Comparison
- `references/12-recession-probability-scoring.md` — Recession Probability Scoring; Output; Standard Signal Output; Thesis Invalidation

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.
