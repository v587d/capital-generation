---
name: options-analysis
description: Analyze options Greeks, implied volatility, and strategy selection for US stocks
---

# Options Analysis

## Evidence request

通过宿主数据契约请求：期权链（行权价、到期、IV、持仓量）、行情序列（复权口径与 as-of）。

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

Comprehensive analysis of options Greeks, implied volatility dynamics, strategy selection, and risk/reward frameworks for US-listed equity options. Designed to help identify optimal strategies based on market outlook, volatility environment, and underlying stock context.

**Risk Disclaimer**: Options involve significant leverage and can result in the loss of the entire premium paid or, for short options, losses substantially exceeding the initial credit received. This analysis is for educational and informational purposes only and does not constitute financial advice.

## Read the Parts

Everything below the surface of this file lives in `references/`. **whole, with no line window** — quoting a rule or a template out of a slice of one is how a
file gets reported as read when it was only skimmed. The file names below are the only
addressing this entry has.

- `references/10-analysis-framework.md` — Analysis Framework
- `references/11-implied-volatility-iv-analysis.md` — (continued) Analysis Framework
- `references/12-earnings-play-analysis.md` — (continued) Analysis Framework
- `references/13-data-sources.md` — (continued) Analysis Framework; Input Formats; Output; Standard Signal Output; Thesis Invalidation

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.
