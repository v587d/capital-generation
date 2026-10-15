# Overview

Part 1 of 4 for `financial-report-analyst` — Overview; How to Use; Step-by-Step Analysis Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Overview

Official filings are the primary source of truth for company analysis. Unlike financial data terminals (which aggregate selected metrics), the actual 10-K and 10-Q contain management's own words, full footnote disclosures, legal risk factors, and accounting policy choices that are invisible in summary data feeds. This skill teaches you to read between the lines of official documents and convert dense regulatory language into actionable investment insights.

---

## How to Use

Provide the report in one of these ways:

```
# Paste report text directly
/financial-report-analyst [paste 10-K or 10-Q sections]

# Reference a specific ticker for the most recent filing
/financial-report-analyst AAPL 10-K

# Analyze a specific section
/financial-report-analyst MSFT 10-Q --section risk-factors

# Full deep-dive analysis
/financial-report-analyst NVDA 10-K --full

# Comparative: compare current vs prior period filing
/financial-report-analyst GOOGL --compare-prior
```

### Retrieving the filing — the keyless EDGAR path

When the user names a ticker instead of pasting text, this skill still fetches nothing by itself. Get the primary document from SEC EDGAR (free, no API key) **through the host's retrieval path — delegate it in a role-split host** — and mark `Retrieval: delegated retrieval`:

1. **Ticker → CIK:** `https://www.sec.gov/files/company_tickers.json` — match `ticker` (`BRK-B` for `BRK.B`), zero-pad `cik_str` to 10 digits.
2. **Filings index:** `https://data.sec.gov/submissions/CIK##########.json` — in `filings.recent`, the arrays `form` · `filingDate` · `reportDate` · `accessionNumber` · `primaryDocument` line up by index. Pick the newest row whose `form` is the one asked for: `10-K` (annual; `20-F` for foreign private issuers), `10-Q` (quarterly; `6-K` for foreign issuers), `8-K` (earnings release is usually Exhibit 99.1 in the filing folder), `DEF 14A` (proxy).
3. **Document:** `https://www.sec.gov/Archives/edgar/data/<CIK without leading zeros>/<accessionNumber without dashes>/<primaryDocument>` — the full filing as HTML. The folder's `<accessionNumber>-index.htm` lists every exhibit.
4. **Statement facts (to cross-check Item 8):** `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`.

Identify yourself with a `User-Agent` header (`Name email`) and stay under 10 requests per second. For `--compare-prior`, take the second-newest row of the same form. Cite accession number and filing date in the `Data & Sources` header.

Only where the host has no retrieval path at all, ask the user to paste the sections and mark `Retrieval: pasted by user` — the repository's helper scripts are not part of this plugin and are never run from here. If neither is available, the figures stay missing: report the gap under the ⚠️ warning instead of lowering confidence on an estimate.

---

## Step-by-Step Analysis Framework

### Phase 1: Document Orientation

Before diving into numbers, understand what kind of document this is and what period it covers:

- **Filing Type**: 10-K (annual), 10-Q (quarterly), 8-K (material event), DEF 14A (proxy), S-1 (IPO)
- **Fiscal Period**: Year-end or quarter-end date, fiscal year convention
- **Auditor**: External auditor name and audit opinion type (unqualified, qualified, adverse, disclaimer)
- **Auditor Change**: Any change in auditor is a major red flag — investigate immediately
- **Filing Date**: Note if filed late (extension requests = warning signal)
- **Restatements**: Any prior period restatements disclosed in current filing

---

### Phase 2: Management Discussion & Analysis (MD&A) Deep Read

The MD&A is management's own narrative explanation of results. Read it critically — management has incentives to highlight positives and minimize negatives.

**2.1 Revenue Analysis**

Extract and analyze from MD&A:

```
Revenue Breakdown Table:
Segment/Product Line    Current Period    Prior Period    YoY Change %    Commentary
─────────────────────────────────────────────────────────────────────────────────────
[Segment 1]
[Segment 2]
[Geographic: Americas]
[Geographic: EMEA]
[Geographic: APAC]
─────────────────────────────────────────────────────────────────────────────────────
Total Revenue
```

Key questions to answer from MD&A:
- What does management cite as the primary growth drivers? Are these sustainable or one-time?
- Is growth organic (volume/price) or inorganic (acquisitions)? Separate these explicitly.
- What is the mix shift between high-margin and low-margin products/services?
- Is management guiding to acceleration or deceleration? Are they vague or specific?
- What is the backlog, remaining performance obligations (RPO), or deferred revenue trend?

**2.2 Margin Analysis**

```
Margin Trend Table:
Metric              Current Period    Prior Period    QoQ or YoY    Explanation from MD&A
──────────────────────────────────────────────────────────────────────────────────────
Gross Margin %
Operating Margin %
Net Margin %
Adjusted EBITDA %   (if disclosed)
FCF Margin %        (Operating CF - Capex)
──────────────────────────────────────────────────────────────────────────────────────
```

Red flags in margin discussion:
- Non-GAAP exclusions growing faster than GAAP expenses (SBC, restructuring)
- Gross margin compression attributed to "product mix" without specifics
- COGS increases described only in absolute terms, not as % of revenue
- Operating leverage claims not reflected in actual operating margin expansion

**2.3 Liquidity and Capital Resources**

From the Liquidity section of MD&A, extract:
- Cash and equivalents position (end of period)
- Revolving credit facility (drawn / undrawn capacity)
- Upcoming debt maturities (12-month and 3-year look-ahead)
- Operating cash flow generated in period
- Free cash flow (OCF minus capex)
- Capital allocation priorities stated by management
- Share repurchase authorization remaining
- Dividend policy changes

**2.4 Forward-Looking Statements Analysis**

Catalog management's specific guidance language:

```
Guidance Item         Specific Language Used        Strength (Specific/Vague/Hedged)
────────────────────────────────────────────────────────────────────────────────────
Revenue Guidance
Margin Guidance
Capex Guidance
Hiring/Headcount
Product Launch Timing
────────────────────────────────────────────────────────────────────────────────────
```

Flag: When management shifts from specific numerical guidance to directional language ("we expect continued growth"), this is a meaningful signal of reduced confidence.

---


This section is not finished here: `Step-by-Step Analysis Framework` continues in `references/11-phase-3-financial-statement.md`.
