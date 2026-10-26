---
name: portfolio-review
description: Review and analyze investment portfolio performance and allocation
---

# Portfolio Review

## Evidence request

通过宿主数据契约请求：持仓与成本（使用者提供）、行情序列（复权口径与 as-of）。

缺哪个字段就点名并停止该字段下的分析；用户粘贴的材料标 `pasted by user`。


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

Comprehensive portfolio analysis and optimization recommendations.

## Read the Parts

Everything below the surface of this file lives in `references/`. **whole, with no line window** — quoting a rule or a template out of a slice of one is how a
file gets reported as read when it was only skimmed. The file names below are the only
addressing this entry has.

- `references/10-phase-1-portfolio-snapshot.md` — Phase 1 — Portfolio Snapshot; Phase 2 — Performance Analysis; Phase 3 — Asset Allocation Review; Phase 4 — Holdings Review; Phase 5 — Concentration Risk Scoring
- `references/11-phase-6-correlation-diversification.md` — Phase 6 — Correlation & Diversification Analysis; Phase 7 — Tax-Loss Harvesting Opportunities; Phase 8 — Factor Exposure Analysis
- `references/12-phase-9-rebalancing-decision.md` — Phase 9 — Rebalancing Decision Framework; Phase 10 — Drawdown & Risk Budget Analysis; Phase 11 — Optimization Recommendations; Output Format
- `references/13-data-verification.md` — Data Verification; Thesis Invalidation; Standard Signal Output

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.
