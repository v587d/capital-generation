---
name: 10k-digest
description: Deep-read a 10-K annual report and output a structured markdown digest — abstract, section summaries, key metrics, and sourced references. Output in English or Traditional Chinese.
---

# 10-K Report Digest

## ⚠️ Data Verification — Do This Before Any Analysis

Before running the digest, confirm the filing details:

1. **Identify the filing** — confirm ticker, fiscal year-end, and exact 10-K filing date from SEC EDGAR.
2. **State your source** — note where the document came from (e.g., "SEC EDGAR, FY2024 10-K filed 2025-02-05") at the top of the output.
3. **Flag incomplete data** — if only partial sections are available, list what is missing before proceeding.

> ⚠️ **Source unavailable.** If the full 10-K cannot be retrieved, display this warning and proceed only with the sections provided.

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

Produce a clean, structured markdown document that distills a company's 10-K annual report into an abstract, per-section summaries, a digest of key metrics, and full source references. Designed for quick comprehension — not trading signals. Output language is selectable: English or Traditional Chinese (繁體中文).

## Read the Parts

Everything below the surface of this file lives in `references/`. **whole, with no line window** — quoting a rule or a template out of a slice of one is how a
file gets reported as read when it was only skimmed. The file names below are the only
addressing this entry has.

- `references/10-retrieving-the-filing.md` — 🔎 Retrieving the Filing — the Keyless EDGAR Path; How to Use; Output Document Structure
- `references/11-key-metrics-table.md` — (continued) Output Document Structure; References
- `references/12-language-mode.md` — Language Mode; File Output; Thesis Invalidation

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.
