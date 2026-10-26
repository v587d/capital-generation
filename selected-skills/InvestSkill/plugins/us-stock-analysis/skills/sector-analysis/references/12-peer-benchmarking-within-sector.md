# Peer Benchmarking Within Sector

Part 3 of 4 for `sector-analysis` — Peer Benchmarking Within Sector; Sector-Specific Risk Factors
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Peer Benchmarking Within Sector

When analyzing a specific stock, compare it against its sector median to identify relative attractiveness. Use this template for every individual stock recommendation within a sector rotation context.

### Single Stock vs. Sector Median Template

```
Stock: [TICKER] — [Company Name]
Sector: [GICS Sector]
Comparison Date: [Date] | Source: [venue and document as returned by retrieval]

DIMENSION              STOCK VALUE    SECTOR MEDIAN    PREMIUM / DISCOUNT    SCORE (1-5)
─────────────────────────────────────────────────────────────────────────────────────────
VALUATION
  Forward P/E          [x.x]x         [x.x]x           [+/- x%]              [1-5]
  EV/EBITDA            [x.x]x         [x.x]x           [+/- x%]              [1-5]
  Price/Sales          [x.x]x         [x.x]x           [+/- x%]              [1-5]
  Price/Book           [x.x]x         [x.x]x           [+/- x%]              [1-5]
  Dividend Yield       [x.x]%         [x.x]%           [+/- x bps]           [1-5]

GROWTH
  Revenue Growth (TTM) [x.x]%         [x.x]%           [+/- x%]              [1-5]
  EPS Growth (FY est.) [x.x]%         [x.x]%           [+/- x%]              [1-5]
  Revenue Growth (3Y)  [x.x]%         [x.x]%           [+/- x%]              [1-5]

MARGINS & QUALITY
  Gross Margin         [x.x]%         [x.x]%           [+/- x bps]           [1-5]
  EBITDA Margin        [x.x]%         [x.x]%           [+/- x bps]           [1-5]
  Net Margin           [x.x]%         [x.x]%           [+/- x bps]           [1-5]
  ROIC                 [x.x]%         [x.x]%           [+/- x bps]           [1-5]
  ROE                  [x.x]%         [x.x]%           [+/- x bps]           [1-5]
  Debt/EBITDA          [x.x]x         [x.x]x           [+/- x%]              [1-5]
  FCF Yield            [x.x]%         [x.x]%           [+/- x bps]           [1-5]
─────────────────────────────────────────────────────────────────────────────────────────
COMPOSITE QUALITY SCORE                                                       [avg/5]
```

### Quality Score Interpretation

| Score | Interpretation |
|---|---|
| 4.5–5.0 | Sector leader — significant premium justified |
| 3.5–4.4 | Above-sector-average quality — moderate premium justified |
| 2.5–3.4 | In-line with sector — valuation should be at-market |
| 1.5–2.4 | Below-sector quality — discount warranted |
| 1.0–1.4 | Sector laggard — avoid unless deep value thesis exists |

**Scoring Convention:** For valuation metrics, cheaper = higher score (a stock trading at a discount to peers on P/E scores 5, a premium scores 1). For growth, margins, and quality metrics, higher is better.

---

## Sector-Specific Risk Factors

Each sector carries idiosyncratic risks beyond broad market beta. Always assess these in the context of the current macro and regulatory environment before establishing a position.

### Information Technology
- **Regulatory / Antitrust Risk:** Large-cap platforms (search, social, cloud) face ongoing EU Digital Markets Act enforcement, DOJ antitrust cases, and potential structural remedies. Headline risk can compress multiples even without earnings impact.
- **AI Disruption / Obsolescence Risk:** Generative AI rapidly changes competitive positioning — incumbents may be disrupted faster than traditional product cycles. Evaluate whether a company is a beneficiary or a target.
- **Semiconductor Supply Chain & Export Controls:** TSMC concentration, US-China export restrictions on advanced chips (EAR controls), and geopolitical risk in Taiwan can cause severe supply shocks.

### Healthcare
- **FDA Approval Risk / Clinical Trial Binary Events:** Drug pipeline stocks carry binary event risk at Phase 2/3 readouts and FDA PDUFA dates; a single rejection can cause 40–70% drawdowns.
- **Patent Cliff Risk:** Major pharmaceuticals face loss of exclusivity (LOE) on blockbuster drugs — revenue can fall 80%+ within 2 years of generic entry; assess pipeline coverage vs. patent expiry schedule.
- **Drug Pricing / CMS Negotiation:** IRA Medicare drug price negotiation and political pressure on list prices compress revenue visibility for large pharma and biotech.

### Financials
- **Interest Rate Sensitivity (NIM Compression):** Banks' net interest margins expand with rate hikes but compress when rates fall or the yield curve inverts; this is the single largest driver of bank earnings variability.
- **Credit Cycle Risk:** Loan loss provisions surge in recessions; commercial real estate (CRE) exposure is a persistent concern for regional banks. Monitor non-performing loan (NPL) ratios closely.
- **Regulatory Capital Requirements (Basel III/IV):** Evolving capital adequacy rules (CET1 requirements, stress test results) constrain buyback capacity and ROE generation for large banks.

### Consumer Discretionary
- **Consumer Balance Sheet Health:** This sector is most exposed to rising consumer debt, declining savings rates, and credit tightening — especially for big-ticket items (autos, appliances, travel).
- **Tariff and Import Cost Risk:** Heavy reliance on offshore manufacturing (apparel, electronics, footwear) means tariff escalation directly compresses margins before pricing power can respond.
- **Secular Shift in Spending (Physical vs. Digital):** Traditional retail faces ongoing structural displacement from e-commerce; under-differentiated brick-and-mortar operators face secular decline.

### Communication Services
- **Streaming Profitability Inflection Risk:** Media/streaming companies face pressure to convert subscriber growth to sustained free cash flow; content cost inflation and competition from tech giants compress margins.
- **Advertising Cyclicality:** Digital ad revenue is highly correlated with GDP growth and corporate spending budgets — falls sharply in recessions (Google, Meta ad revenue dropped 15–25% in prior downturns).
- **Spectrum Allocation and Infrastructure Costs:** Telecom operators face large, lumpy capex cycles tied to 5G and fiber buildouts, with uncertain return timelines and regulatory pricing constraints.

### Industrials
- **Government Defense/Infrastructure Budget Dependency:** Defense contractors and infrastructure-linked industrials are highly sensitive to Congressional appropriations, sequestration risk, and multi-year contract cancellations.
- **Supply Chain Disruption and Input Cost Inflation:** Aerospace and industrial machinery have long production cycles — shortages in specialty materials (titanium, rare earth components) or labor can cause years-long delivery delays.
- **Labor Cost Pressure and Union Risk:** Heavily unionized manufacturing sectors (aerospace, auto, rail) face periodic strike risk and multi-year wage escalation that can compress margins durably.


This section is not finished here: `Sector-Specific Risk Factors` continues in `references/13-consumer-staples.md`.
