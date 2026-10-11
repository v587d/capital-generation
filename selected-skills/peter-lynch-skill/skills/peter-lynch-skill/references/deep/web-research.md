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

`source: [Source name](https://...)`

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

## Phase 2: Find Latest Full Annual Report

Use annual-report discovery targets first — each line below is one thing to ask
the host's retrieval channel for, worked through in order and stopped once a
complete, current annual report or equivalent full-year filing is in the ledger:

* `"{company name}" investor relations annual report site:{company-domain}`
* `"{company name}" annual report {current year OR prior year} investor relations`
* `"{company name}" 10-K site:sec.gov`
* `"{company name}" 20-F site:sec.gov`
* `"{ticker}" SEC 10-K 20-F annual report`
* `"{company name}" annual report PDF`
* `"{company name}" integrated report`

Selection rules:

* Must be a full annual report or equivalent full-year filing.
* Prefer the most recent completed fiscal year.
* Do not use quarterly or interim reports unless no annual report exists.
* The company name must match the entity being researched.

If found:

* record title, fiscal year, format, URL, sections used, and fetch limitations
* have the host's retrieval path read the document — in a host that splits
  roles, hand over the URL and work from the text that comes back (a PDF is
  parsed by the retrieval role, not opened from here)
* extract all normal historical financial facts before external gap-fill requests
* do not fetch separate annual-report pages for each year unless the latest
  annual report lacks a required historical table
* do not ask for separate sources per statement line, ratio,
  dividend, buyback, or historical year already covered by the annual report

If not found after the reasonable source paths above:

* note `Annual report: not found`
* continue with regulator filings and verified market sources
* do not ask the user to upload a PDF

If a PDF cannot be fetched, prefer HTML annual report, XBRL filing, SEC filing
page, exchange filing page, or investor-relations annual-report landing page.

## Phase 3: Extract Annual-Report Base

Extract targeted sections first:

* business overview
* segment and geography data
* income statement
* balance sheet
* cash flow statement
* debt, liquidity, lease, pension, and goodwill notes when material
* share count, buyback, dividend, and capital-allocation notes
* management discussion and analysis
* risk factors relevant to triggered concerns

Record report-ready facts:

* identity and business description
* revenue, gross profit, operating income, net income, EPS
* operating cash flow, capital expenditures, free cash flow
* cash, debt, equity, liabilities, shares outstanding
* segment revenue and segment profit if disclosed
* geography breakdown if disclosed
* dividend history
* buybacks / repurchases
* share issuance / dilution
* principal risks and management commentary

Use filings and annual reports as the primary source for historical financial
facts. Do not replace them with third-party data unless official sources are
missing or unclear.

## Annual-Report Base Template

Use this internal template:

```md
## Annual-Report Base

### Identity
- Legal company name:
- Ticker / exchange:
- Country of incorporation / reporting:
- Reporting currency:
- Fiscal year end:
- Investor relations URL:

### Annual Report / Filing Details
- Title:
- Fiscal year:
- Format:
- URL:
- Filing form/accession/section:
- Sections used:
- Fetch limitations:

### Business Description
- Business model:
- Products/services:
- Customers:
- Geographies:
- Segments:
- Source ID(s):

### Historical Financials
| Metric | Period | Value | Currency/units | Label | Source ID(s) |
|---|---:|---:|---|---|---|
| Revenue | | | | Reported | |
| Gross profit | | | | Reported | |
| Operating income | | | | Reported | |
| Net income | | | | Reported | |
| Diluted EPS | | | | Reported | |

### Cash Flow
| Metric | Period | Value | Currency/units | Label | Source ID(s) |
|---|---:|---:|---|---|---|
| Operating cash flow | | | | Reported | |
| Capital expenditures | | | | Reported | |
| Free cash flow | | | | Calculated | |

### Balance Sheet
| Metric | Period | Value | Currency/units | Label | Source ID(s) |
|---|---:|---:|---|---|---|
| Cash and equivalents | | | | Reported | |
| Short-term borrowings | | | | Reported | |
| Current portion of long-term debt | | | | Reported | |
| Long-term debt | | | | Reported | |
| Total interest-bearing debt | | | | Calculated | |
| Shareholders' equity | | | | Reported | |
| Diluted shares outstanding | | | | Reported | |

### Segment and Geography Data
- Segment revenue/profit:
- Geography revenue/profit:
- Concentration notes:
- Source ID(s):

### Capital Allocation
- Dividends:
- Buybacks:
- Share issuance/dilution:
- Major capital expenditure:
- Source ID(s):

### Management Commentary and Risks
- Growth drivers:
- Margin drivers:
- Principal risks:
- Invalidation points:
- Source ID(s):

### Methodology Coverage Checklist
- Business model, segments, geography, hype check:
- Diagnostic profile inputs: cyclicality, turnaround, growth profile, maturity, asset angle:
- Track record: revenue, EPS, predictability, margins, ROE, share count:
- Balance sheet: debt, net debt, interest coverage, current ratio, receivables, inventory, net cash, pensions, leases, goodwill:
- Cash flow: net income vs operating cash flow, free cash flow, capex, dividends:
- Growth: drivers, contribution %, duplication model, whitespace, unit economics:
- Competition: industry structure, competitors, peer margins, market share, pricing power:
- Ownership: institutional ownership, management ownership, insider buying:
- Valuation: share price, market cap, trailing P/E, forward P/E, PEG, EV/EBITDA, dividend yield, 52-week range, historical comparison if available:
- Triggered modules: cyclicality, turnaround, asset angle, stalwart resilience, fast-growth quality, mature income:
- Final score inputs:

### Missing Methodology Items
- [item] — [not disclosed / not found / not applicable] — [source path checked]
```

Keep one evolving research brief. Do not create duplicate annual-report briefs.

## Phase 4: External Gap-Fill Searches

After the annual-report base is built, map the brief against the Methodology
Coverage Checklist. Ask the host's retrieval channel for targeted external
sources covering any methodology-required gap that the annual report or filing
did not answer:

* `"{company name}" latest quarterly results guidance`
* `"{ticker}" market cap PE forward PE PEG EV EBITDA 52 week range`
* `"{company name}" insider buying institutional ownership`
* `"{company name}" market share competitors industry outlook`
* `"{company name}" pricing power margins competitors`
* `"{company name}" dividend buyback share repurchase`
* `"{company name}" recession EPS dividend history`
* `"{company name}" peer margins competitors operating margin`
* `"{company name}" market share industry report`

Do not run this pack automatically. Ask only for the sources needed to complete
the methodology coverage checklist.

Use external sources for questions not fully covered by the annual report:

* industry cyclicality
* competitor comparison
* market share trends
* pricing power
* customer retention / churn if relevant
* macro sensitivity
* regulatory changes
* technology disruption risk
* expected industry growth
* insider transactions
* institutional ownership
* management ownership and compensation alignment
* recession resilience
* peer margins
* live valuation metrics

For ownership, check the annual report or filing package first. If ownership is
missing or incomplete there, use proxy, governance, regulator, exchange, or
reputable ownership data sources.

Do not add external sources for historical financial facts, segment facts, cash
flow, debt, dividends, buybacks, or management discussion when the annual report
or filing already covers them.

Competitor, market-share, industry, ownership, and peer-valuation requests are
required when those fields are not already covered by the existing source
ledger. Keep them targeted and stop when the methodology field has enough
evidence for a concise judgment.

For latest quarterly or interim results, use this fallback order:

1. company earnings release or trading update
2. quarterly / half-year report
3. regulator filing or exchange announcement
4. reputable financial news only if primary sources are blocked, unavailable,
   or do not contain the required decision-critical item

Do not use news or analyst commentary for recent financial numbers when a
company or regulator source is available.

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
