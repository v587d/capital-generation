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

Use reputable aggregator sources for Quick Research. Preferred source types:

1. financial-data aggregators with multi-year statements and key ratios, such
   as Yahoo Finance, MarketWatch, Macrotrends, StockAnalysis, GuruFocus, or
   similar public financial-data pages
2. market-data aggregators with quote, market capitalization, P/E, dividend,
   and 52-week range data, such as CompaniesMarketCap, Nasdaq, Yahoo Finance,
   MarketWatch, StockAnalysis, GuruFocus, or similar pages
3. aggregator or quote/profile pages that include a short business description,
   sector, industry, exchange, and country

Do not use annual report PDFs, full 10-K / 10-Q / 20-F extraction, SEC filing
detail pages, company quarterly reports, or long investor-relations documents
for Quick Research. Those belong to Deep Research.

Never use anonymous blogs, forums, social media posts, or unsourced pages for
financial numbers. Do not use news articles as the primary source for standard
financial metrics when an aggregator table is available.

Every retrieval request must fill a Source Ledger slot, resolve a
decision-critical conflict, or support a triggered check. Do not ask for another
source out of curiosity.

Do not ask source-by-source per fiscal year or per metric when one
aggregator table can answer the question. Extract revenue, earnings per share
(EPS), margins, cash, debt, shares, dividends, buybacks, and cash-flow lines
from aggregator pages.

Before asking for a fourth source after the third Quick retrieval, ask internally:

* What decision-critical fact is missing?
* Can another section of an existing aggregator source answer it?
* Which reputable aggregator is most likely to contain the missing metric?

Ask for more only if another aggregator is needed to complete the existing Quick
methodology responsibly.

If aggregator sources conflict, prefer the source that is more recent, more
complete, and more directly tied to the metric. Note material conflicts in the
brief. Do not resolve normal Quick conflicts by opening full filings; if the
conflict is decision-critical, ask for another reputable aggregator or move the
decision to WATCHLIST / DEEP RESEARCH with the conflict stated.

Every important number in the research brief must include metric, period/date,
value, currency/units, source ID(s), and label: `Reported`, `Calculated`, or
`Inference`.

Final report citations must use Source Ledger URLs and this format:

`source: [Source name](https://...)`

## Budget

Practical default:

* **1-3 aggregator sources**
* **2-3 retrieval requests**
* **2-3 page fetches**

Expand only when another reputable aggregator is needed for missing required
Quick evidence, ambiguous identity, live valuation, a possible fatal flaw, a
triggered special check, or a decision-critical conflict.

## Default Source Set

Use the smallest aggregator source set that completes the screen:

1. One aggregator with financial statements or financial history.
2. One aggregator with live valuation and market data.
3. One aggregator profile/summary source only if the first two do not cover
   identity, business description, sector, industry, or exchange.

Ownership, insider, competitor, or industry aggregator sources are allowed only
when the existing Quick methodology needs that evidence and it could affect
conviction.

## Query Pack

Each line below is one thing to ask the host's retrieval channel for, not a page
to go and open from here. Work through them in order and stop as soon as the
Source Ledger covers required Quick evidence:

* `"{ticker}" Yahoo Finance financials statistics profile`
* `"{ticker}" StockAnalysis financials balance sheet cash flow ratios`
* `"{ticker}" MarketWatch financials income balance sheet cash flow`
* `"{ticker}" Macrotrends revenue EPS cash flow debt`
* `"{ticker}" CompaniesMarketCap market cap PE ratio dividend 52 week range`
* `"{ticker}" Nasdaq quote financials institutional insider`

If the company has a non-US listing, add exchange, country, or reporting
currency. If the ticker is ambiguous, ask for ticker plus exchange name and use
aggregator profile pages to resolve the traded entity.

Do not run the full pack automatically.
