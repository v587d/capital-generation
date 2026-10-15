# Step-by-Step Analysis Framework(continued)

Part 2 of 4 for `financial-report-analyst` — Step-by-Step Analysis Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### Phase 3: Financial Statement Deep Dive

**3.1 Income Statement Quality Assessment**

```
Line Item Analysis:
                    Current    Prior    Change    Quality Note
Revenue             $          $        %
COGS                $          $        %
Gross Profit        $          %GP
R&D                 $          %Rev
S&M                 $          %Rev
G&A                 $          %Rev
Operating Income    $          %OM
Interest Expense    $          $
Tax Rate            %          %
Net Income (GAAP)   $
EPS (GAAP)          $
Non-GAAP EPS        $         Reconciliation items: ___
```

Quality checks:
- **Revenue recognition policy**: Has it changed? Check footnotes for ASC 606 adoption details
- **Channel stuffing signals**: Receivables growing faster than revenue (days sales outstanding expanding)
- **Deferred revenue**: Growing (positive — customers paying ahead) or shrinking (negative)
- **Tax rate**: Unusually low tax rate often driven by one-time benefits; normalize for comparison

**3.2 Balance Sheet Analysis**

```
Balance Sheet Health Check:
Asset Quality:
  Cash & Equivalents:         $___  (% of total assets)
  Accounts Receivable:        $___  DSO: ___ days  (vs. prior: ___)
  Inventory:                  $___  DIO: ___ days  (vs. prior: ___)
  Goodwill & Intangibles:     $___  (% of total assets) — impairment risk?
  Other Long-Term Assets:     $___

Liability Structure:
  Short-Term Debt:            $___  (due within 12 months)
  Long-Term Debt:             $___
  Total Debt:                 $___
  Net Debt/(Cash):            $___
  Interest Coverage Ratio:    ___x  (EBIT / Interest Expense)
  Debt/EBITDA:                ___x

Equity Quality:
  Retained Earnings Trend:    Growing / Declining / Negative
  Treasury Stock:             $___  (buyback history)
  AOCI:                       $___  (pension obligations, FX hedges)
```

Balance sheet red flags:
- Goodwill > 30% of total assets without clear acquisition rationale
- Accounts receivable growing 2x+ faster than revenue (aggressive recognition)
- Inventory build in a demand-softening environment
- Off-balance sheet operating lease obligations (check footnotes — ASC 842)
- Underfunded pension liabilities buried in AOCI

**3.3 Cash Flow Statement — The Truth Teller**

The cash flow statement is the hardest to manipulate. Always reconcile GAAP net income to operating cash flow:

```
Cash Flow Quality Analysis:
Operating Cash Flow:          $___
Less: Capex:                  $___
Free Cash Flow:               $___  FCF Margin: __%
FCF Conversion Rate:          ___   (FCF / Net Income — should be >80% for quality businesses)

Working Capital Changes:
  AR Change (use/source):     $___
  Inventory Change:           $___
  AP Change:                  $___
  Deferred Revenue Change:    $___
  Net Working Capital Impact: $___

SBC Add-Back:                 $___  (% of Revenue — >5% is dilutive)
D&A Add-Back:                 $___  (% of Revenue — maintenance capex proxy)
```

Cash flow quality flags:
- FCF significantly below net income (earnings quality problem)
- Large working capital builds consuming cash (inventory/AR growth)
- SBC >5% of revenue — real dilution not reflected in GAAP net income
- Capex below depreciation for multiple years (under-investment in assets)

---

### Phase 4: Risk Factors Analysis

The Risk Factors section (Item 1A in 10-K) is legally required to disclose material risks. Read for:

**4.1 New vs. Removed Risk Factors**

Compare current filing's risk factors against the prior period:

```
Risk Factor Changes:
NEW Risks Added (first appearance):
  1. [Risk title] — [Category: Business/Regulatory/Macro/Competition/Cyber/Legal]
  2. ...

REMOVED Risks (previously disclosed, now gone):
  1. [What was removed] — [Why might this be significant?]

ELEVATED Risks (same risk, but expanded disclosure or moved higher in list):
  1. [Risk title] — [What changed in the language]
```

Risk categories to flag as highest priority:
- **Regulatory/Legal**: New government investigations, pending litigation, regulatory changes
- **Customer Concentration**: Single customer >10% of revenue disclosed
- **Technology/Competition**: Specific competitor named as existential threat
- **Going Concern**: Doubt about ability to continue as a going concern (immediate red flag)
- **Debt Covenant**: Risk of violating debt covenants disclosed
- **Cybersecurity**: New material cyber incident disclosures (Item 1.05 of 8-K)

**4.2 Litigation and Legal Proceedings**

From footnotes and Item 3 (Legal Proceedings):
- Active lawsuits with >$X million exposure
- SEC or DOJ investigations
- Tax disputes and uncertain tax positions
- Environmental liabilities
- Patent litigation (key for tech and pharma)

---

### Phase 5: Accounting Policy and Footnote Analysis

Footnotes contain what management would prefer investors not to focus on.

**5.1 Critical Accounting Estimates**

Management must disclose "critical accounting estimates" — areas where judgment most affects reported results:

```
Critical Estimate Review:
  Revenue Recognition:   [Policy and any changes]
  Goodwill Impairment:   [Testing methodology, headroom]
  Stock-Based Comp:      [Fair value models, assumptions]
  Deferred Tax Assets:   [Valuation allowance — any new allowances = warning]
  Contingent Liabilities: [What is and isn't accrued]
  Pension/OPEB:          [Return assumption, discount rate]
```

**5.2 Related Party Transactions**

Any transactions between the company and executives, board members, or major shareholders. These require heightened scrutiny for potential conflicts of interest.

**5.3 Segment Reporting**

When companies add or remove reporting segments, investigate:
- Was a previously disclosed segment merged with another? (Often hides underperformance)
- Were goodwill allocations shifted between segments? (Can delay impairment)
- New segment disclosures can reveal previously hidden growth drivers

---


This section is not finished here: `Step-by-Step Analysis Framework` continues in `references/12-phase-6-management-tone.md`.
