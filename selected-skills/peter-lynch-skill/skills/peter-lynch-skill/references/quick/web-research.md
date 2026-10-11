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

## Quick Evidence Needed

A Quick decision normally needs:

* identity verified from an aggregator profile, exchange-style quote page, or
  reputable market-data page
* simple business model
* one concrete growth driver
* revenue and earnings per share (EPS) direction
* cash-flow quality signal
* balance-sheet risk signal
* live valuation snapshot
* recent trend evidence from aggregator financials, trailing twelve-month
  metrics, recent quarterly data, or an aggregator news/earnings summary
* triggered special evidence only if methodology requires it

Do not mark required Quick evidence as `unknown` merely to save tokens. If one
aggregator lacks a required Quick metric, ask for another reputable aggregator.

If a clear fatal flaw is verified, stop gathering optional data and write the
SKIP decision.

Fatal flaw examples:

* dangerous leverage
* heavy dilution
* persistently negative free cash flow without credible investment explanation
* severe revenue / EPS deterioration with no credible stabilization evidence
* valuation obviously excessive relative to weak growth

## Core Extraction

Gather from the Source Ledger first. Ask for a new source only when the current
ledger cannot answer a required screening item.

### Identity

Gather:

* company name
* ticker / exchange
* country / region
* sector / industry
* company website from an aggregator profile, if available
* short business description

### Business Model

Gather:

* what the company sells
* main customers
* main products / services
* main geographies
* main segment or product mix if easily available
* one specific 3-5 year growth driver

Avoid vague drivers such as “innovation,” “AI,” “digital transformation,”
“brand strength,” or “large market opportunity” unless tied to revenue, margins,
or EPS.

### Revenue, EPS, And Margins

Gather:

* revenue trend, preferably 5 years
* diluted EPS trend, preferably 5 years
* 2-year revenue and EPS growth
* major drops, spikes, or recoveries
* gross, operating, or net margin direction if available

Do not build a full margin table unless immediately available.

### Cash Flow Quality

Gather:

* operating cash flow, preferably 3-5 years
* capital expenditures, preferably 3-5 years
* free cash flow, preferably 3-5 years
* whether free cash flow broadly confirms net income
* whether net income rises while operating cash flow or free cash flow weakens

Free cash flow = operating cash flow - capital expenditures.

### Balance Sheet Safety

Gather:

* cash and cash equivalents
* short-term borrowings
* current portion of long-term debt
* long-term debt
* shareholders' equity
* interest expense if available

Use interest-bearing debt only:

`Total interest-bearing debt = short-term borrowings + current portion of long-term debt + long-term debt`

Debt-to-equity means:

`interest-bearing debt / shareholders' equity`

### Valuation Snapshot

Use one market-data source by default.

Gather:

* current share price
* market capitalization
* trailing P/E
* forward P/E if available
* PEG if available
* EV/EBITDA if available
* 52-week range

If forward P/E, PEG, EV/EBITDA, or another methodology-relevant valuation
metric is missing from the current source, use another reputable aggregator.
Do not omit a valuation metric merely to save tokens.

### Recent Trend Check

Prefer aggregator trailing twelve-month data, recent quarterly financials, or
earnings/news summaries as a combined source for:

* revenue growth or decline
* EPS / profit trend
* margin pressure or recovery
* guidance cut, warning, or major deterioration

Do not ask for a separate source per recent-trend metric if one aggregator
source covers them.

## Triggered Extra Evidence

Do not ask for every possible detail. Ask for extra only when methodology
needs it.

### Cyclicality

Triggered by large EPS/margin swings or clearly cyclical industry.

Gather up to 10-year EPS history if easily available. If not, use 5-year data
and lower conviction.

### Turnaround

Triggered by 2+ years of EPS decline, revenue contraction plus margin
compression, or EPS 30%+ below prior peak.

Gather stabilization evidence, liquidity, debt risk, margin recovery evidence,
and whether valuation already prices in recovery.

### Fast Growth

Triggered by 2-year EPS compound annual growth rate (CAGR) of 20%+.

Check whether revenue confirms EPS growth, whether growth came from buybacks or
cost cuts, and whether valuation is reasonable.

### Slow Growth / Mature

Triggered by low EPS growth and mature business profile.

Gather dividend per share, dividend consistency, dividend cuts, buybacks, and
whether valuation is low enough to justify interest.

### Asset Angle

Triggered by net-cash, asset-heavy, real-estate, subsidiary, equity-stake, or
large book-value-discount situations.

Gather asset evidence only if it could materially affect downside or the
decision.

## Bonus Evidence

Only collect after the core screen is not a clear SKIP. Use aggregator sources
for bonus evidence.

Bonus examples:

* recent corporate insider buying in the last 6 months
* active buybacks reducing share count
* institutional ownership below 30%
* buybacks near 52-week lows
* stock price near or below net cash per share

## Quick Research Brief

Compile a compact internal brief before writing:

```md
## Quick Research Brief

### Identity
- Company:
- Ticker / exchange:
- Country / reporting currency:
- Sector / industry:
- Aggregator identity/profile URL:

### Source Ledger
- [S1] [source label]: [URL] — [period/date] — [what it supports] — [quality]
- [S2] [source label]: [URL] — [period/date] — [what it supports] — [quality]
- [S3] [source label]: [URL] — [period/date] — [what it supports] — [quality]
- [S4 optional] [source label]: [URL] — [period/date] — [what it supports] — [quality]

### Business Model
- What it sells:
- Main customers/geographies:
- Specific 3-5 year growth driver:
- Evidence label:
- Source ID(s):

### Screening Financials
- Revenue trend:
- EPS trend:
- Margin trend:
- Operating cash flow / free cash flow signal:
- Balance sheet signal:

### Live Valuation
- Data gathered:
- Share price:
- Market cap:
- Trailing P/E:
- Forward P/E:
- PEG or growth proxy:
- EV/EBITDA:
- 52-week range:
- Source ID(s):

### Recent Trend Check
- Latest period:
- Revenue/profit/margin trend:
- Guidance cut, warning, or deterioration:
- Source ID(s):

### Diagnostic Triggers
- Cyclicality:
- Turnaround:
- Fast growth:
- Slow-growth / mature:
- Asset angle:

### Fatal Flaw Candidates
- [candidate] — [evidence]

### Bonus Points
- [bonus item or none found]

### Missing Decision-Critical Data
- [item] — [sources checked]

### Decision
- SKIP / WATCHLIST / DEEP RESEARCH:
- Main reason:
- Revisit trigger, if WATCHLIST:
```

The final Quick report must be based on this brief, not raw retrieval results.
