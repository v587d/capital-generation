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

One skill, two workflows. Answers either:

- **Quick:** Is this company worth 2–5 hours of deeper research? (~450 words, SKIP / WATCHLIST / DEEP RESEARCH)
- **Deep:** Full due-diligence report (up to 3000 words, attractiveness score X / 10 — how consistent and well-supported the thesis reads, not a forecast of performance)

All data comes from **the host's own retrieval path** — no API keys, no bundled scripts, no user-provided PDFs. In a host that splits roles, gathering it is not this skill's job: write the exact brief (ticker or company, the fields needed, the as-of date, the source tier) and hand it to the host's retrieval channel, then work only from what comes back. Time-sensitive market data must be freshly gathered and dated. Every retrieved claim in the final report must be cited with a link.

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

The source tiers below (aggregator profile pages, SEC / regulator filings, annual reports) are US and overseas-listing conventions. In an A-share session the same analysis must be asked for in A-share terms instead — disclosure platforms, no Form 4 / 13F, no wash-sale rules — and that is decided by the host's retrieval channel, not by this skill.

Do **not** ask the user for an annual report PDF or API keys.

## Workflow overview

Copy this checklist and track progress:

```
Task Progress:
- [ ] Step 1: Route (quick or deep)
- [ ] Step 2: Read workflow-specific web research guide
- [ ] Step 3: Gather data and compile structured research brief
- [ ] Step 4: Read workflow prompts
- [ ] Step 5: Write report from the brief only
- [ ] Step 6: Append disclaimer
```

### Step 1: Route

Select **Quick** or **Deep** using the routing table above.

### Step 2: Read workflow-specific web research guide

Read only the workflow-specific web guide:

- **Quick:** [references/quick/web-research.md](references/quick/web-research.md)
- **Deep:** [references/deep/web-research.md](references/deep/web-research.md)

Read [references/filing-rules.md](references/filing-rules.md) only when regulator/XBRL data, ADRs, secondary listings, specialized financial companies, or accounting-basis issues matter. Do not read it for normal Quick Research unless the Quick web guide specifically triggers it.

### Step 3: Gather data and compile research brief

Asking the host's own retrieval path for the data (in a host that splits roles: delegate it with the brief, do not browse from here):

1. Follow the **workflow-specific** source plan, retrieval brief, stopping rule, and research brief template in `references/quick/web-research.md` or `references/deep/web-research.md`.
2. Respect the workflow-specific default budgets unless an override in that workflow guide is triggered — the budget is how many sources you ask the channel for, not how many you go and open yourself:
   - **Quick:** practical default of 1-3 reputable aggregator sources, 2-3 retrieval queries, and 2-3 page fetches; expand only when another aggregator is needed to complete the existing Quick methodology.
   - **Deep:** 5-7 sources, 6-8 retrieval queries, 7-10 page/document fetches, with the default source set kept as small as the report can support.
3. For **Quick**: gather the minimum viable evidence needed for a responsible SKIP / WATCHLIST / DEEP RESEARCH decision, then stop.
4. For **Deep**: follow the annual report discovery procedure in `references/deep/web-research.md` — ask for the latest full annual report on the company's investor relations site (HTML or PDF); regulator filings are the fallback.
5. Do not ask for a separate retrieval per fiscal year for normal historical metrics. For Quick, use aggregator tables. For Deep, use the annual report, 10-K / 20-F, regulator filing, or regulator facts feed as the historical base.
6. Do not print research narration, retrieval play-by-play, or the full research brief unless the user asks for it.
7. Capture period, currency, units, date gathered, and source ID(s) for every important number and claim. Each source ID must resolve to a URL in the Source Ledger. Filing labels may be included, but they do not replace a ledger URL.
8. Do **not** invent financial data.

### Step 4: Read workflow prompts

**Quick path** — read both before writing:

- [references/quick/system-prompt.md](references/quick/system-prompt.md)
- [references/quick/methodology.md](references/quick/methodology.md)

**Deep path** — read both before writing:

- [references/deep/system-prompt.md](references/deep/system-prompt.md)
- [references/deep/methodology.md](references/deep/methodology.md)

### Step 5: Write report

Use the research brief as the only factual context for the report. Do not include the full research brief in the final report unless the user asks for it.

Every final report must cite sources with links:

- Any company description, financial number, valuation metric, market data point, management claim, industry claim, competitor claim, ownership claim, or news/update claim needs a source.
- Use source lines directly below the relevant bullet or paragraph: `source: [Source name](https://...)`.
- Multiple sources may be separated with semicolons.
- Do not cite a source that is not in the research brief Source Ledger.
- Expand any internal source IDs from the brief into full linked `source:` lines in the final report.
- Source lines do not count toward Quick or Deep word limits.

Internally prefix the analysis context with:

```
Data gathered: YYYY-MM-DD

## Research brief

{full research brief markdown}
```

### Step 6: Append disclaimer

Read [references/disclaimer.md](references/disclaimer.md) only when the report body is ready. After the report body, add a horizontal rule and append the full contents of the disclaimer.

## Failure handling

- If the host's retrieval path returns nothing for a field you need: name the missing fields and stop the analysis that depends on them — do not fabricate data.
- If a ticker cannot be resolved: inform the user clearly.
- If the annual report cannot be found after all fallbacks in `references/deep/web-research.md`: note the gap in the research brief and proceed using other verified sources — do **not** ask the user for a PDF.
- If a specific metric is unverified: say you do not know; do not estimate or invent numbers.
- If retrieved claims lack source ID(s) that resolve to Source Ledger URL(s): do not include them in the report.
- If live market data cannot be verified from the current source: for Quick, ask the channel for another reputable aggregator; for Deep, use the workflow's market-data fallback rules. Do not use stale or unsourced values.
