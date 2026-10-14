# Deep Web Research Workflow · Part 4 of 4

Part 4/4 of `references/deep/web-research.md` — split so each part arrives complete in one `read`; see `references/deep/web-research-1.md` for the whole guide.

## Phase 5: Live Market Data

Use one market-data source first.

Gather:

* current share price
* market cap
* trailing P/E
* forward P/E
* PEG
* EV/EBITDA
* dividend yield
* 52-week range

Fallback order:

1. primary exchange quote page
2. company investor-relations stock quote page
3. major financial data publisher
4. another reputable market-data source

Add a second market-data source if the first is missing a methodology-required
metric, appears stale, conflicts with another source, or cannot be fetched.

If forward P/E, PEG, EV/EBITDA, or another valuation metric remains unavailable
after one reputable market-data source and one reasonable fallback, mark it
`not found` and record the sources checked.

## Deep Research Brief

Before writing, compile a structured internal brief:

```md

## Deep Research Brief

### Source Ledger
- [S1] [source label]: [URL] — [period/date] — [what it supports] — [quality]
- [S2] [source label]: [URL] — [period/date] — [what it supports] — [quality]
- [S3] [source label]: [URL] — [period/date] — [what it supports] — [quality]
- [S4] [source label]: [URL] — [period/date] — [what it supports] — [quality]
- [S5] [source label]: [URL] — [period/date] — [what it supports] — [quality]
- [S6 optional] [source label]: [URL] — [period/date] — [what it supports] — [quality]

### Annual-Report Base
- Summary from Annual-Report Base:
- Key verified financial facts:
- Key verified business facts:
- Key management risks:

### Live Valuation Facts
- Data gathered:
- Share price:
- Market cap:
- Trailing P/E:
- Forward P/E:
- PEG:
- EV/EBITDA:
- Dividend yield:
- 52-week range:
- Source ID(s):

### External Interpretation Findings
- Industry cyclicality:
- Competitors / market share:
- Peer margins:
- Pricing power:
- Macro sensitivity:
- Regulatory or technology disruption risk:
- Insider transactions:
- Institutional ownership:
- Management ownership:
- Recession resilience:
- Source ID(s):

### Methodology Coverage
- Section 1 Business model and understandability:
- Section 2 Diagnostic profile:
- Section 3 Long-term track record:
- Section 4 Balance sheet and financial safety:
- Section 5 Cash flow and earnings quality:
- Section 6 Growth drivers and room to grow:
- Section 7 Competitive position:
- Section 8 Valuation:
- Section 9 Triggered special modules:
- Section 10 Final score inputs:

### Calculations and Inferences
- [calculation or inference]:
- Inputs:
- Formula / reasoning:
- Source ID(s):

### Source Conflicts
- [conflict or none]:
- Resolution:

### Unknowns and Lower-Conviction Areas
- [item]:
- Sources checked:
```

## Deep Validation Before Writing

Confirm:

* company identity verified from official or exchange source
* latest full annual report located, or the gap explicitly noted
* every important number and claim has source ID(s)
* every methodology section has enough evidence for a concise answer
* historical facts came from filings / annual report first
* live valuation came from market source, not filing
* no figures invented to fill gaps
* interpretation claims are grounded in evidence

When evidence is incomplete, say `unknown`, `not disclosed`, or `not found`,
and record the source path checked. Do not omit a methodology-required item
silently.
