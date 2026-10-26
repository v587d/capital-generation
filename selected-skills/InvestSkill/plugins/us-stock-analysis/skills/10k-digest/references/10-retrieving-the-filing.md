# 🔎 Evidence Request and the Filing

Part 1 of 3 for `10k-digest` — 🔎 Evidence Request and the Filing; How to Use; Output Document Structure
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## 🔎 Evidence request

This skill fetches nothing by itself. When the user gives only a ticker, request the filing through the host data contract and record what came back in the `Data & Sources` header:

- **What to ask for** — the latest annual report for the ticker (10-K; a foreign private issuer files 20-F; a 10-K/A is an amendment), the fiscal year it covers, the filing date, the accession number, and the document itself: Item 1, 1A, 7, 7A, 8, 9A, 3, and Items 10–13 when incorporated by reference.
- **What the request must carry** — ticker, fiscal year or "latest", the sections needed, and the as-of date. Ask once; do not send the retrieval role after one section at a time.
- **What comes back** — the document plus provenance: venue, document name, filing date, accession or the link the retrieval returned. Put those in the cover block and in References. A link is evidence only when the retrieval actually returned it.
- **Structured statement data** — when the retrieval also returns tagged statement facts, cite them as the confirmation of the figures read from Item 8, and keep the filing itself as the primary source.

The retrieval role owns the mechanics (identifier lookup, filing index, document fetch, structured statement data, full-text search). This skill does not repeat them, and the analysis role never searches or downloads by itself.

A request brief that works:

```
Ticker: AAPL
Evidence: latest annual report (10-K), fiscal year 2024
Sections: Item 1, 1A, 7, 7A, 8, 9A, 3, Items 10–13 if incorporated
Return: document text, venue, filing date, accession, link
As-of: 2025-02-05
```

Substitute the ticker, fiscal year and section list; leave the return fields unchanged. If the issuer files 20-F, write "20-F" instead of "10-K" and the same fields apply. Ask for the whole filing once rather than one Item at a time: the digest compares sections against each other, and a section-by-section fetch loses the cross-references the filing relies on.

**If the host has no retrieval path at all** → `Retrieval: pasted by user`. Ask for the sections needed and say which ones are missing.

**If nothing comes back** → show the ⚠️ *Source unavailable* warning and digest only what the user provided. What is absent stays absent: no accession number, figure or date is filled in from memory. A summary site is never a substitute for the filing itself.

---

## How to Use

```
# Analyze by ticker (requests the latest 10-K through the host data contract, or asks you to paste it)
/10k-digest AAPL

# Paste 10-K text directly
/10k-digest [paste 10-K sections here]

# Specify fiscal year
/10k-digest MSFT FY2024

# Output in Traditional Chinese
/10k-digest NVDA --lang zh-TW

# Save output to file
/10k-digest GOOGL --output googl-10k-digest.md
```

---

## Output Document Structure

The skill produces a single markdown document with the following sections in order.

---

### 1. Cover Block

```
# [Company Name] ([TICKER]) — 10-K Digest
**Fiscal Year:** [FY20XX ending MM/DD/YYYY]
**Filed:** [Filing date]
**Source:** [venue, document, filing date, accession or link returned by retrieval]
**Prepared:** [Today's date]
**Language:** English | 繁體中文
```

---

### 2. Abstract

A 3–5 sentence executive summary of the entire 10-K. Cover:
- What the company does (core business in one sentence)
- Year-over-year financial performance headline (revenue, profit, FCF)
- The single most important strategic development disclosed in this filing
- The most material risk disclosed
- Overall filing tone (transparent / cautious / optimistic)

---

### 3. Section Summaries

Summarize each major 10-K section. For each section, write 2–4 sentences capturing the substance — not just restating headings.

#### 3.1 Business Overview (Item 1)
- Core products/services and revenue model
- Key markets and customer segments
- Significant changes to business described in this filing (new products, acquisitions, divestitures)

#### 3.2 Risk Factors (Item 1A)
- Total number of risk factors disclosed
- Top 3 risks by disclosure prominence (listed first, given most space, or new this year)
- Any risks added or removed vs. prior filing (state "N/A if prior not available")
- One-line assessment: are risks standard boilerplate or specific and material?

#### 3.3 Selected Financial Data / Properties (Items 1B–2)
- Key quantitative highlights from Selected Financial Data if present
- Material properties or facilities disclosed

#### 3.4 Management's Discussion & Analysis — MD&A (Item 7)
- Revenue: total and YoY growth; organic vs. inorganic split if stated
- Gross margin and operating margin trend
- Management's stated explanation for performance changes
- Forward-looking statements: what management guided or projected
- Liquidity summary: cash position, debt level, upcoming maturities

#### 3.5 Financial Statements (Items 8)
- Revenue, net income, EPS (GAAP) — current year vs. prior year
- Operating cash flow and free cash flow (OCF minus capex)
- Total assets, total debt, shareholders' equity
- Auditor name and opinion type (unqualified / qualified / adverse)
- Any restatements or material changes in accounting policy noted

#### 3.6 Quantitative Disclosures about Market Risk (Item 7A)
- Primary market risks disclosed (interest rate, FX, commodity)
- Sensitivity disclosures if provided (e.g., "1% rate rise = $X impact")

#### 3.7 Controls and Procedures (Item 9A)
- Management's conclusion on effectiveness of internal controls
- Any material weaknesses or significant deficiencies disclosed

#### 3.8 Legal Proceedings (Item 3)
- Active material litigation or regulatory matters
- Estimated financial exposure if disclosed

#### 3.9 Executive Compensation & Governance (Items 10–13, from Proxy if incorporated)
- CEO/CFO compensation summary
- Board composition notes (independence, tenure)
- Any significant governance changes

---


This section is not finished here: `Output Document Structure` continues in `references/11-key-metrics-table.md`.
