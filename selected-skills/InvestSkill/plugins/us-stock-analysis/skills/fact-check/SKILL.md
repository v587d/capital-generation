---
name: fact-check
description: Claim-level verification of any report or data set — extract every figure and factual claim, check each against a primary source (a statutory filing, an official statistics release, exchange data, issuer material, or the user's own document), recompute derived numbers, mark ✅ verified / ⚠️ mismatch / ❓ unverifiable, and re-issue the report with inline citations and a References section; Verification Score 0–10
---

# Fact Check — Verify the Numbers, Cite the Sources

## Evidence request

通过宿主数据契约请求：披露文件（公告、年报或招股书，带回出处与文档日期）。

缺哪个字段就点名并停止该字段下的分析；用户粘贴的材料标 `pasted by user`。


## ⚠️ Data Verification — Do This Before Any Analysis

Before verifying anything, establish what data each claim actually needs:

1. **Fetch current price only where a claim needs it** — market claims (price, market cap, yield, multiples "today") are checked against a live quote for the report's as-of date and today's, obtained through the host's own data path (delegate it in a role-split host). Reported figures, historical comparisons, and `--recompute` runs need **no** live quote — do not request one, and do not let its absence block them. Never assume a price from training data.
2. **Confirm key figures** — for this skill the "key figures" are the *sources themselves*: the filing (10-K / 10-Q / 8-K / proxy / Form 4 / 13F), the issuer release, the official statistics release, the exchange or issuer data, or the document the user pasted. Retrieve or request them before judging a single claim. A claim checked against memory is not checked.
3. **State your data source** — fill in the `Data & Sources` header (next section) so the origin, as-of date, retrieval path, and confidence of every figure are explicit at the top of the output.
4. **Flag stale data explicitly** — if a live quote is needed for a market claim and unavailable, display this warning before proceeding, and mark those claims `❓` or `🕒` rather than guessing:

> ⚠️ **Data unavailable.** <list the figures this analysis could not retrieve>. Those fields are reported as missing and are not estimated — retrieval is a precondition, not a nicety.

The warning describes the *inputs actually used*: when every claim was checked against user-supplied documents, say so instead of implying estimates were involved. Never substitute a remembered value for a retrieved one — a figure the host's data path could not produce stays `❓` and is named as missing.

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

For this skill the header describes the **sources used to verify**, not the report being verified — the report's own header is quoted and judged in Phase 5.

---

## Read the Parts

Everything below the surface of this file lives in `references/`. **whole, with no line window** — quoting a rule or a template out of a slice of one is how a
file gets reported as read when it was only skimmed. The file names below are the only
addressing this entry has.

- `references/10-overview.md` — Overview; 1. Modes; 2. Inputs; 3. Framework
- `references/11-phase-2-source-hierarchy.md` — (continued) 3. Framework
- `references/12-phase-5-consistency.md` — (continued) 3. Framework; References; 4. Output Format; Example
- `references/13-notes.md` — Notes; Thesis Invalidation; Standard Signal Output

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.
