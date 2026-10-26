# Deep Web Research Workflow · Part 2 of 4

Part 2/4 of `references/deep/web-research.md` — split so each part arrives complete in one `read`; see `references/deep/web-research-1.md` for the whole guide.

## Phase 2: Find Latest Full Annual Report

Use annual-report discovery targets first — each line below is one thing to ask
the host's retrieval channel for, worked through in order and stopped once a
complete, current annual report or equivalent full-year filing is in the ledger:

* the issuer's own annual report, current or prior fiscal year
* the annual report filed with the regulator (10-K, or 20-F for a foreign private issuer)
* the integrated report or equivalent full-year disclosure, when the issuer publishes one
* the prior year's annual report, for period-over-period comparison

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
