# Workflow and Research Brief

Part 1 of 1 for `peter-lynch-skill` — the six steps, the research brief template, and failure handling
See `SKILL.md` for what to read and when; this part is procedure, not routing.

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
