# Deep Web Research Workflow · Part 3 of 4

Part 3/4 of `references/deep/web-research.md` — split so each part arrives complete in one `read`; see `references/deep/web-research-1.md` for the whole guide.

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
