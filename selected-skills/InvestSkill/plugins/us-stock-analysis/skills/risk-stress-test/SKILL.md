---
name: risk-stress-test
description: Portfolio and position risk report — beta-weighted exposure, historical scenario replay (2008, March 2020, 2022 rate shock, 2025 tariff shock), parametric VaR / CVaR at 95 / 99 %, max-drawdown estimate, correlation-spike scenario, rate / USD / oil sensitivity, liquidity (days to exit at 20 % of ADV), and a Risk Budget Score 0–10
---

# Risk Stress Test — How Much Could This Portfolio Lose?

## ⚠️ Data Verification — Do This Before Any Analysis

Before running any analysis, always retrieve the latest market data for the ticker:

1. **Fetch current price** — get the live price of every holding through the host's own data path (delegate it in a role-split host, with ticker, fields and as-of date in the brief), so weights are computed on today's values, not on cost basis. Never assume a price from training data.
2. **Confirm the risk inputs** — for each holding: 1-year beta to SPY, annualized volatility (σ), 30-day average daily volume (ADV) in shares and dollars, sector, and the current weight. These are the raw material of every number below; if they are missing, ask for them or state the proxy used (sector ETF beta / σ) next to the figure.
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

## Read the Parts

Everything below the surface of this file lives in `references/`. Open a part with `read`,
one whole part at a time — the file names below are the only addressing this entry has.

- `references/10-overview.md` — Overview; 1. Inputs; 2. Framework
- `references/11-phase-4-correlation-spike.md` — (continued) 2. Framework; 3. Output Format; Example
- `references/12-notes.md` — Notes; Thesis Invalidation; Standard Signal Output

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.
