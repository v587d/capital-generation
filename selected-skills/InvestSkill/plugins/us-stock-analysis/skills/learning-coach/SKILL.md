---
name: learning-coach
description: Explains any InvestSkill output like a mentor — every metric in plain words, why it matters, its good / bad range, and the lesson that teaches it — then asks 3–5 Socratic questions and "what would change your mind?". --level beginner / intermediate, --lang zh-TW, and a --quiz mode that drills a Learning lesson
---

# Learning Coach — Understand the Analysis You Just Got

## Evidence request

通过宿主数据契约请求：使用者提供的输入（成交、持仓或论点记录）。

缺哪个字段就点名并停止该字段下的分析；用户粘贴的材料标 `pasted by user`。


## ⚠️ Data Verification — Do This Before Any Analysis

Before explaining anything, check the material you were handed:

1. **Do not re-fetch data** — explain the figures as they appear in the pasted analysis, and flag any that look stale (as-of date older than 90 days), unsourced (no `Data & Sources` header), or internally inconsistent (a score that does not match its own signal band). Teaching from bad numbers teaches bad habits.
2. **Confirm key figures** — where the pasted analysis states a metric without its inputs (a P/E with no price or EPS), say so; do not invent the missing inputs to make the explanation tidier.
3. **State your data source** — fill in the `Data & Sources` header (next section) so the origin, as-of date, retrieval path, and confidence of every figure are explicit at the top of the output.
4. **Flag stale data explicitly** — if the pasted analysis carries a live-data warning or names no retrieval path at all, display this before proceeding:

> ⚠️ **Data unavailable.** <list the figures this analysis could not retrieve>. Those fields are reported as missing and are not estimated — retrieval is a precondition, not a nicety.

If the pasted analysis simply has **no as-of date**, do not assume it came from memory: write `As of: unknown` in the reproduced header, set Confidence to LOW, and warn that freshness cannot be verified — the figures may be current or stale, and the reader should find out which before acting.

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

For this skill: **reproduce the pasted analysis's own header** at the top of the explanation. If the analysis has none, write one that says `Source: the pasted analysis (no provenance stated)`, `Retrieval: pasted by user`, `Confidence: LOW` — and make the missing header the first thing you teach (see Phase 1).

---

## Read the Parts

Everything below the surface of this file lives in `references/`. **whole, with no line window** — quoting a rule or a template out of a slice of one is how a
file gets reported as read when it was only skimmed. The file names below are the only
addressing this entry has.

- `references/10-overview.md` — Overview; 1. Modes; 2. Inputs; 3. Framework — Explain Mode
- `references/11-phase-2-explanation-card.md` — (continued) 3. Framework — Explain Mode; 4. Framework — Quiz Mode (`--quiz <lesson>`); Quiz — <Lesson name>  (5 questions · --level <level>); Answers
- `references/12-output-format.md` — 5. Output Format; Example; Notes; Thesis Invalidation
- `references/13-standard-signal-output.md` — Standard Signal Output

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.
