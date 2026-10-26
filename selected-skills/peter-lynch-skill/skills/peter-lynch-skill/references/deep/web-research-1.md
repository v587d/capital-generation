# Deep Web Research Workflow

Deep Research is full due diligence. Source gathering must be complete enough
to support every section of `references/deep/methodology.md`.

The annual report / filing layer is the factual base, but it is not expected to
answer every methodology question. Use targeted external sources to fill
methodology-required gaps such as live valuation, peer context, ownership,
insider activity, industry structure, recession resilience, and recent
post-period updates.

This file is self-contained. Read `references/filing-rules.md` only when
regulator/XBRL data, ADRs, secondary listings, specialized financial companies,
or accounting-basis issues matter.

## Minimum Source Rules

Use sources in this order:

1. company investor relations, annual report, 10-K / 20-F, latest results
2. regulatory filings, exchange filings, official announcements
3. exchange or reputable financial data pages
4. established financial media or reputable industry sources

Never use anonymous blogs, forums, social media posts, or unsourced pages as the
sole source for financial numbers.

Every retrieval request must fill a Source Ledger slot, resolve a source conflict,
support a triggered module, or fill a required methodology field. Do not ask for
another source out of curiosity.

Do not ask source-by-source per fiscal year or per metric when an annual
report, latest results release, or filing can answer the question. Extract
revenue, earnings per share (EPS), margins, cash, debt, interest expense,
shares, dividends, buybacks, and cash-flow lines from the primary source.

Before asking for a seventh source after the sixth Deep retrieval, ask internally:

* What methodology-required fact is missing?
* Can an existing source answer it?
* Can the item be marked `unknown`, `not found`, or `not disclosed` without
  lowering report completeness?

Ask for more when the missing item is required by the methodology and cannot be
answered from existing sources. Use `unknown`, `not found`, or `not disclosed`
only after at least one appropriate source path has been checked, or when the
item is not applicable.

If sources conflict, use filings / annual reports for historical facts, market
sources for live valuation, and the most recent official company or regulator
source for post-period updates.

Every important number in the research brief must include metric, period/date,
value, currency/units, source ID(s), and label: `Reported`, `Calculated`, or
`Inference`.

Final report citations must use Source Ledger URLs and this format:

`source: [Source name as returned](link returned by retrieval)`

## Budget

Starting budget:

* **7-10 sources**
* **8-12 retrieval requests**
* **10-16 page/document fetches**

This is a starting budget, not a hard cap. Expand it when methodology-required
facts are still missing, identity is ambiguous, the annual report / filing is
blocked, live market data is incomplete, sources conflict, or legal,
regulatory, solvency, fraud, commodity, geopolitical, or technology-disruption
risk is triggered.

## Default Source Set

For most public companies, start with:

1. latest annual report / 10-K / 20-F
2. latest quarterly, half-year, earnings release, or trading update
3. one reputable live market-data page
4. proxy / ownership / governance source for institutional ownership,
   management ownership, insider purchases, and compensation alignment
5. one external industry / competitor source for market structure, peer
   margins, cyclicality, pricing power, and market-share context
6. one legal, regulatory, commodity, geopolitical, or technology-risk source
   when the annual report or business model indicates that the risk is material

Add sources beyond this when they fill a missing methodology field, resolve a
conflict, or support a triggered module.

## Core Principle

Build the report from two layers:

1. **Annual report / filings layer**: historical financials, segments,
   geography, debt, cash flow, shares, buybacks, dividends, risks, management
   discussion.
2. **External completion layer**: live valuation, industry cyclicality, market
   share, peer margins, pricing power, competitive positioning, macro
   sensitivity, ownership, insider activity, recession resilience,
   forward-looking growth drivers, and special risks not fully answered by
   filings.

Do not use news or analyst commentary as a replacement for audited historical
financials.

## Phase 1: Resolve Identity

Identify:

* legal company name
* ticker / primary exchange
* country of incorporation / reporting
* official website / investor relations URL
* latest fiscal year end

If identity is unclear, resolve it through official or exchange sources before
asking for more sources.
