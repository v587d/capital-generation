# 🔎 Retrieving the Filing — the Keyless EDGAR Path

Part 1 of 3 for `10k-digest` — 🔎 Retrieving the Filing — the Keyless EDGAR Path; How to Use; Output Document Structure
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## 🔎 Retrieving the Filing — the Keyless EDGAR Path

This skill fetches nothing by itself. When the user gives only a ticker, obtain the 10-K in one of three ways and record which one in the `Data & Sources` header:

**A. Retrieval through the host (the normal path)** → `Retrieval: delegated retrieval`. In a role-split host, delegate the fetch to the agent that owns web retrieval — this step never searches from the analysis role itself. Every step is free and needs no API key:

1. **Ticker → CIK** — `https://www.sec.gov/files/company_tickers.json`: find the entry whose `ticker` matches (write `BRK-B` for `BRK.B`) and zero-pad its `cik_str` to 10 digits.
2. **Filings index** — `https://data.sec.gov/submissions/CIK##########.json`: inside `filings.recent` the arrays `form`, `filingDate`, `reportDate`, `accessionNumber` and `primaryDocument` are aligned by index. Take the newest row whose `form` is `10-K` (foreign private issuers file `20-F` instead; a `10-K/A` is an amendment). The top-level `fiscalYearEnd` is `MMDD`.
3. **The document** — `https://www.sec.gov/Archives/edgar/data/<CIK without leading zeros>/<accessionNumber without dashes>/<primaryDocument>`: the complete filing as HTML (inline XBRL). The filing's index page is the same folder plus `<accessionNumber>-index.htm`; cite that URL and the accession number in the References.
4. **Structured statement data (optional)** — `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`: every US-GAAP fact the company has tagged, by concept and period. Use it to confirm the figures read from Item 8.
5. **Full-text search (optional)** — `https://www.sec.gov/edgar/search/#/q=%22<phrase>%22&forms=10-K` when a filing has to be located by phrase rather than ticker.

Send a `User-Agent` header that identifies the requester (the SEC requires it, e.g. `Name email@example.com`) and stay under 10 requests per second. Never substitute a summary site for the filing itself.

**B. Only if the host has no retrieval path at all** → `Retrieval: pasted by user`. Ask the user for the sections needed. The repository's own fetch helpers are optional, keyless, and live outside this plugin — they are never run from here.

**C. Neither** → show the ⚠️ *Source unavailable* warning and digest only what the user provided. What is absent stays absent: no accession number, figure or date is filled in from memory.

---

## How to Use

```
# Analyze by ticker (retrieves the latest 10-K via the EDGAR path above, or asks you to paste it)
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
**Source:** SEC EDGAR — [Direct URL to filing]
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
