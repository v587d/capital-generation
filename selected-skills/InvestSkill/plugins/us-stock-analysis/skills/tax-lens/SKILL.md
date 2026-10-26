---
name: tax-lens
description: US tax mechanics for a position or portfolio — short- vs. long-term treatment, wash-sale window check, qualified-dividend holding-period test, lot selection (specific-ID vs. FIFO), tax-loss-harvesting pairs, account placement, estimated annual tax drag — plus a --non-us module (W-8BEN, dividend withholding and treaty rates, capital-gains treatment, US estate-tax exposure, UCITS alternatives). Educational only, never tax advice
---

# Tax Lens — What You Actually Keep

## Evidence request

通过宿主数据契约请求：持仓与成本（使用者提供）、使用者提供的输入（成交、持仓或论点记录）。

缺哪个字段就点名并停止该字段下的分析；用户粘贴的材料标 `pasted by user`。


> ⚠️ **This is not tax advice.** Tax law changes, thresholds are indexed, and the right answer depends on facts this skill cannot see (filing status, state, residency, other income, treaty position). Every output of this skill must open **and** close with: *"Educational illustration of how the rules generally work — confirm with a qualified tax professional before acting."* If the user asks for a filing position, a specific dollar liability to rely on, or anything about a jurisdiction outside the US mechanics described here, say so and stop.

## ⚠️ Data Verification — Do This Before Any Analysis

Before running any analysis, always retrieve the latest market data for the ticker:

1. **Fetch current price** — get the live price, 52-week range, and market cap through the host's own data path. In a host that splits roles, delegate the request with an exact brief (ticker, fields, as-of date) rather than searching from this step. Never assume a price from training data.
2. **Confirm key figures** — for this skill: each lot's acquisition date, cost basis, and share count; the ex-dividend dates involved; the current tax-year brackets and thresholds (long-term capital-gains brackets, the net investment income tax threshold, the annual capital-loss limit, the non-resident estate-tax exemption). Thresholds are indexed or legislated — state the tax year you are using and ask the user to confirm.
3. **State your data source** — fill in the `Data & Sources` header (next section) so the origin, as-of date, retrieval path, and confidence of every figure are explicit at the top of the output.
4. **Stop on missing data** — if a figure cannot be retrieved through the host's data path, name what is missing and stop; the analysis does not run on remembered values:

> ⚠️ **Data unavailable.** <list the figures this analysis could not retrieve>. Those fields are reported as missing and are not estimated — retrieval is a precondition, not a nicety.

Never substitute a remembered value for a retrieved one. Getting the number is the host data path's job — delegate it; asking the user to paste is the last resort only where the host has no retrieval path at all.

---

## 📋 Data & Sources Header — Open Every Output With It

Immediately after the not-tax-advice banner (which is always line one), the output carries this provenance block, filled in — never left as placeholders. It is the standard `result-validator` looks for first:

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

For this skill the `Source:` line must also name the **tax year** and the rule sources used (IRS publications 550 / 519 / 559, the Form W-8BEN instructions, the relevant treaty table) — rules, like prices, have an as-of date.

---

## Read the Parts

Everything below the surface of this file lives in `references/`. **whole, with no line window** — quoting a rule or a template out of a slice of one is how a
file gets reported as read when it was only skimmed. The file names below are the only
addressing this entry has.

- `references/10-overview.md` — Overview; 1. Modes; 2. Inputs; 3. Framework — US mode
- `references/11-phase-3-dividends-qualified.md` — (continued) 3. Framework — US mode
- `references/12-framework-non-us-module.md` — 4. Framework — `--non-us` module (non-resident alien holding US stocks)
- `references/13-scoring-tax-efficiency-score.md` — 5. Scoring — Tax Efficiency Score (0–10); 6. Output Format; Example; Notes
- `references/14-thesis-invalidation.md` — Thesis Invalidation; Standard Signal Output

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.
