# Quick Web Research Workflow

Quick Research is a triage workflow. It answers:

* SKIP
* WATCHLIST
* DEEP RESEARCH

The goal is not full due diligence. Gather only enough evidence for a
responsible screening decision.

This file is self-contained. Do not read `references/filing-rules.md` for
normal Quick Research. Quick uses reputable financial-data aggregator pages,
not regulator/XBRL extraction. Read filing rules only if the company identity
cannot be resolved without regulator context, or if an aggregator clearly mixes
ADR, secondary-listing, or specialized-financial-company data in a way that
blocks the screen.

## Minimum Source Rules

Use public summary sources for Quick Research. Preferred evidence types:

1. financial-data pages with multi-year statements and key ratios, where the
   page states each period and the reporting currency
2. market-data pages with a current quote, market capitalization, P/E,
   dividend, and 52-week range, timestamped
3. profile or quote pages that include a short business description, sector,
   industry, exchange, and country

Do not use annual report PDFs, full 10-K / 10-Q / 20-F extraction, filing
detail pages, company quarterly reports, or long investor-relations documents
for Quick Research. Those belong to Deep Research.

Never use anonymous blogs, forums, social media posts, or unsourced pages for
financial numbers. Do not use news articles as the primary source for standard
financial metrics when a structured summary table is available.

Every retrieval request must fill a Source Ledger slot, resolve a
decision-critical conflict, or support a triggered check. Do not ask for another
source out of curiosity.

Do not ask source-by-source per fiscal year or per metric when one summary table
can answer the question. Extract revenue, earnings per share (EPS), margins,
cash, debt, shares, dividends, buybacks, and cash-flow lines from the same
returned page set.

Before asking for a fourth source after the third Quick retrieval, ask internally:

* What decision-critical fact is missing?
* Can another section of an existing source answer it?
* Which evidence type above most plausibly contains the missing metric?

Ask for more only if another summary source is needed to complete the existing
Quick methodology responsibly.

If returned sources conflict, prefer the one that is more recent, more
complete, and more directly tied to the metric. Note material conflicts in the
brief. Do not resolve normal Quick conflicts by opening full filings; if the
conflict is decision-critical, ask for another summary source or move the
decision to WATCHLIST / DEEP RESEARCH with the conflict stated.

Every important number in the research brief must include metric, period/date,
value, currency/units, source ID(s), and label: `Reported`, `Calculated`, or
`Inference`.

Final report citations must use Source Ledger entries and this format:

`source: [Source name as returned](link returned by retrieval)`

## Budget

Practical default:

* **1-3 summary sources**
* **2-3 retrieval requests**
* **2-3 page reads**

Expand only when another source is needed for missing required Quick evidence,
ambiguous identity, live valuation, a possible fatal flaw, a triggered special
check, or a decision-critical conflict.

## Default Source Set

Use the smallest returned source set that completes the screen:

1. One source with financial statements or financial history.
2. One source with live valuation and market data.
3. One profile/summary source only if the first two do not cover identity,
   business description, sector, industry, or exchange.

Ownership, insider, competitor, or industry sources are allowed only when the
existing Quick methodology needs that evidence and it could affect conviction.

## Query Pack

Each line below is one evidence item to request from the host's retrieval
channel, not a page to open from here. Work through them in order and stop as
soon as the Source Ledger covers required Quick evidence:

* multi-year income statement, balance sheet, cash-flow and ratio history for
  the ticker
* current quote, market capitalization, P/E, dividend yield and 52-week range
* business description, sector, industry, exchange and country
* ownership and insider activity, only when a triggered check needs it
* competitor or industry comparison, only when a triggered check needs it

If the company has a non-US listing, add exchange, country, or reporting
currency. If the ticker is ambiguous, ask for ticker plus exchange name and
resolve the traded entity from the returned profile.

Ask for the return fields with the request: the figure, the period it covers,
the reporting currency, the retrieval path, and the source name and link. A
number that comes back without them does not enter the Source Ledger.

Do not run the full pack automatically.
