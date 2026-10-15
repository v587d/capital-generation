---
name: sector-analysis
description: Analyze US market sectors and identify rotation opportunities
---

# Sector Analysis

## ⚠️ Data Verification — Do This Before Any Analysis

Before running any analysis, always retrieve the latest market data for the sectors you compare:

1. **Fetch current levels** — get the current price and 3-, 6- and 12-month performance of each sector ETF (XLK, XLF, …) and the S&P 500 through the host's own data path; delegate the request in a role-split host. Never assume a level from training data.
2. **Confirm key figures** — each sector's forward P/E and earnings-revision trend, as applicable to this skill.
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

Analyze US market sectors and identify sector rotation opportunities based on economic cycles.

## Read the Parts

Everything below the surface of this file lives in `references/`. Open a part with `read`,
one whole part at a time — the file names below are the only addressing this entry has.

- `references/10-sector-overview.md` — Sector Overview; Analysis Framework; Sector Rotation Strategy; Top Holdings Analysis; Sector Valuation Comparison Table; Sector Seasonality Calendar
- `references/11-sector-correlation-matrix.md` — Sector Correlation Matrix; Sector Momentum Scoring
- `references/12-peer-benchmarking-within-sector.md` — Peer Benchmarking Within Sector; Sector-Specific Risk Factors
- `references/13-consumer-staples.md` — (continued) Sector-Specific Risk Factors; Sector ETF Reference; Output; Standard Signal Output; Thesis Invalidation

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.
