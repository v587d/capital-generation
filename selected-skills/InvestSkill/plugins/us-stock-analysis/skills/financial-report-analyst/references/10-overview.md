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

### Evidence request — the filing

When the user names a ticker instead of pasting text, this skill still fetches nothing by itself. Ask the host data contract for the primary document and mark `Retrieval: delegated retrieval`:

- **What to ask for** — the filing the analysis is about: form (`10-K` annual, `10-Q` quarterly, `8-K` for the results release, `DEF 14A` proxy; `20-F` / `6-K` for foreign private issuers), the fiscal period, the filing date, the accession number, and the sections to read.
- **What comes back** — the document, the exhibit list when the release is an exhibit, and provenance: venue, document, date, accession or the link the retrieval returned.
- **Cross-checks** — when tagged statement facts come back with the filing, use them to confirm the figures read from Item 8 and say which you used.

For `--compare-prior`, ask for the prior-period filing of the same form in the same request. Cite the accession number and filing date in the `Data & Sources` header. The retrieval role owns identifier lookup and document access; this skill never searches or downloads by itself.

Only where the host has no retrieval path at all, ask the user to paste the sections and mark `Retrieval: pasted by user`. If neither is available, the figures stay missing: report the gap under the ⚠️ warning instead of lowering confidence on an estimate.

When the results release arrives as an exhibit rather than the filing itself, say so and name the exhibit in the citation; an 8-K exhibit and the 10-Q that follows it are different documents with different review levels, and a figure lifted from one cannot be attributed to the other. Read the sections in the order the request returned them, and quote the page or Item you are reading — a section summary that cannot be traced back to a page is not usable evidence for the ratios that follow, and it cannot be re-checked by anyone reading the answer later.

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
