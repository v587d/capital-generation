# Filing, XBRL, And Specialized Company Rules

Read this file only when using regulator/XBRL data, analyzing ADRs or secondary
listings, comparing accounting bases, or researching specialized financial
companies.

## Regulator And XBRL Data

Direct regulator pages and no-key regulator JSON endpoints are acceptable web
sources when fetched by the host agent, such as SEC company submissions and
companyfacts pages.

When using XBRL or regulator fact feeds:

* Cite the filing form, fiscal period, accession number, filing date, and URL.
* Do not select a value only because it appears in the newest filing.
* Distinguish reported-period values from comparative prior-year values repeated
  inside a newer filing.
* Prefer facts whose `end`, `frame`, fiscal year, fiscal period, and form match
  the period being analyzed.
* For full-year figures, prefer annual facts from the latest 10-K, 20-F, annual
  report, or equivalent full-year filing.
* For quarterly updates, use the current quarter or year-to-date fact
  intentionally and label which one it is.
* If a concept has multiple values for the same period, reconcile using the
  annual report statement label, note disclosure, or filing context before using
  it.

## Accounting Basis

For non-US issuers, record the accounting basis used, such as International
Financial Reporting Standards (IFRS), US Generally Accepted Accounting
Principles (US GAAP), or local generally accepted accounting principles.

Do not mix accounting bases in a trend unless the brief explicitly explains the
reconciliation.

## ADRs And Secondary Listings

For American depositary receipts (ADRs) or secondary listings:

* state whether valuation metrics refer to the ADR, ordinary share, or primary
  listing
* record quote currency
* record ADR ratio if it affects per-share comparisons
* do not mix per-ADR and per-ordinary-share figures without reconciling them

## Specialized Financial Companies

For banks, insurers, brokers, asset managers, and similar financial companies,
mark the balance sheet as specialized.

Do not treat deposits, policyholder reserves, client assets, or total
liabilities as ordinary industrial debt.

Collect sector-specific safety metrics when available, such as:

* regulatory capital
* solvency ratio
* net interest margin
* combined ratio
* assets under management

Lower conviction if standard debt-to-equity tests do not apply cleanly.
