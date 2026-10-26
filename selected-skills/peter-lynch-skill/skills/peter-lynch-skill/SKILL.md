---
name: peter-lynch-skill
description: >-
  Peter Lynch-style stock research from a ticker or company name: quick
  screening or deep due diligence with linked web citations. Use when the user
  asks for quick research, screening, an initial look, deep research, due
  diligence, full analysis, valuation context, an attractiveness score, or a
  SKIP / WATCHLIST / DEEP RESEARCH decision.
license: MIT
metadata:
  author: Szymon Nycz
  version: "1.0"
---

# Peter Lynch Research

## Evidence request

通过宿主数据契约请求：财务报表（三表与附注，注明期间与 as-of）、行情序列（复权口径与 as-of）、披露文件（公告、年报或招股书，带回出处与文档日期）。

缺哪个字段就点名并停止该字段下的分析；用户粘贴的材料标 `pasted by user`。


One skill, two workflows. Answers either:

- **Quick:** Is this company worth 2–5 hours of deeper research? (~450 words, SKIP / WATCHLIST / DEEP RESEARCH)
- **Deep:** Full due-diligence report (up to 3000 words, attractiveness score X / 10 — how consistent and well-supported the thesis reads, not a forecast of performance)

All data comes from **the host's own retrieval path** — no credentials, no bundled scripts, no user-provided PDFs. In a host that splits roles, gathering it is not this skill's job: write the exact brief (ticker or company, the fields needed, the as-of date, the source tier) and hand it to the host's retrieval channel, then work only from what comes back. Time-sensitive market data must be freshly gathered and dated. Every retrieved claim in the final report must be cited with a link.

Use different source depth by workflow:

- **Quick:** aggregator-only screening. Use reputable financial-data aggregator pages by default; do not open annual report PDFs, full 10-K / 10-Q / 20-F filings, SEC filing detail pages, company quarterly reports, or long investor-relations documents.
- **Deep:** official-source due diligence. Use annual reports, filings, company results, and official investor materials as the factual base; use aggregators mainly for valuation and market-data gaps.

Operate with strict evidence-budget discipline. The goal is high-quality research from the smallest reliable source set, not exhaustive browsing. Do not narrate research progress or intermediate retrieval reasoning in the final answer.

## Routing

Determine the workflow from the user's message:

| Trigger keywords | Workflow |
|------------------|----------|
| quick research, screening, filter, initial look, worth researching | **Quick** |
| deep research, due diligence, full analysis, attractiveness score, score / 10 | **Deep** |

- If intent is **ambiguous**, ask one question: *"Quick screening (~450 words) or deep due diligence (~3000 words)?"*
- If still unclear after one exchange, default to **Quick**.

## Required inputs

- `company_symbol` or `company_name` — ticker (e.g. `MSFT`, `ASML.AS`, `VOD.L`) or company name. If the user gives only a brand, company name, or ambiguous ticker, resolve the traded entity before analysis. For Quick, use reputable aggregator profile / quote pages. For Deep, use official, exchange, or regulator sources.
- `exchange` or `country` — optional hint for global tickers

If neither a company nor ticker can be inferred from the request, ask one concise clarification question.

The source tiers in `references/10-workflow.md` (aggregator profile pages, SEC / regulator filings, annual reports) are US and overseas-listing conventions. In an A-share session the same analysis must be asked for in A-share terms instead — disclosure platforms, no Form 4 / 13F, no wash-sale rules — and that is decided by the host's retrieval channel, not by this skill.

Do **not** ask the user for an annual report PDF or for credentials.

## Read the Parts

Everything below the surface of this file lives in `references/`. Open a part with `read`,
resolved against this skill's base directory, and open it **whole — with no line window**:
reporting a rule or a template out of a slice of a part is how a file gets described as read
when it was only skimmed. Each part is sized to arrive complete in one `read`. If a receipt
shows `[... tool result middle pruned ...]`, re-read it with `offset` before concluding
anything is missing.

- `references/10-workflow.md` — Workflow overview; Research brief; Failure handling

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.

