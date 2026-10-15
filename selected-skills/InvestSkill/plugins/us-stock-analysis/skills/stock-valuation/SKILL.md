---
name: stock-valuation
description: Multi-method stock valuation using DCF, comparable company analysis, EV multiples, and residual income models
---

# Stock Valuation

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

Derive a rigorous intrinsic value estimate using multiple independent valuation methodologies, then triangulate to a single probability-weighted target price. Never rely on a single method — cross-validation across DCF, comparable company analysis (CCA), EV/EBITDA, and residual income models builds conviction and exposes assumption fragility.

## Read the Parts

Everything below the surface of this file lives in `references/`. Open a part with `read`,
one whole part at a time — the file names below are the only addressing this entry has.

- `references/10-overview.md` — Overview; When to Use Each Method; Method 1: Discounted Cash Flow (DCF)
- `references/11-method-2-comparable-company.md` — Method 2: Comparable Company Analysis (CCA); Method 3: EV/EBITDA Multiple Valuation; Method 4: Price/Earnings (P/E) Valuation; Method 5: Residual Income / Economic Value Added
- `references/12-football-field-summary-valuation.md` — Football Field Summary — Valuation Range; Margin of Safety Framework; Risk-Adjusted Expected Return; Analyst Consensus vs. Intrinsic Value; Deep DCF Modeling
- `references/13-terminal-value-two-methods.md` — (continued) Deep DCF Modeling
- `references/14-when-dcf-is.md` — (continued) Deep DCF Modeling; Input Formats; Output Summary; Standard Signal Output; Thesis Invalidation

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.
