# 3. Framework(continued)

Part 2 of 4 for `fact-check` — 3. Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### Phase 2 — Source hierarchy

Only a source the reader could open verifies a claim. Rank what you use, and record the tier in the ledger:

| Tier | Sources | Verifies |
|------|---------|----------|
| **1 — Primary** | SEC EDGAR filings (10-K, 10-Q, 8-K, DEF 14A, Form 4, 13F, S-1), the company's own IR release or presentation, FRED / BLS / BEA series, the exchange's or ETF issuer's published data, IRS publications, the fund prospectus / factsheet | reported figures, facts, macro, fund data |
| **1 — User-supplied** | The document the user pasted (a filing excerpt, a broker statement, a data export) | its own figures — labelled `user-supplied` so the reader knows verification stops at the user's document |
| **2 — Secondary** | Reputable financial data vendors and press explicitly quoting a primary document, consensus aggregators for estimates | market data and estimates, with the vendor and date recorded; a reported figure verified only at Tier 2 is marked `✅ (secondary)` |
| **3 — Not a source** | Model memory, forum posts, uncited summaries, a second AI output | nothing — a claim matched only against these stays `❓` |

Prefer the most specific location: Item and Note number, statement line, table, page. "The 10-K" is a document, not a citation.

**Retrieving a Tier-1 source without an API key.** Once retrieval is approved, go straight to SEC EDGAR rather than a summary site — in a role-split host, hand the URL and the fields needed to the agent that owns retrieval rather than fetching here: resolve the CIK from `https://www.sec.gov/files/company_tickers.json` (zero-pad `cik_str` to 10 digits); list filings from `https://data.sec.gov/submissions/CIK##########.json`, where `filings.recent.form` / `filingDate` / `reportDate` / `accessionNumber` / `primaryDocument` line up by index (`10-K`, `10-Q`, `8-K`, `DEF 14A`, `4` for insider transactions — Form 4s are filed under the issuer's CIK as well as the insider's — and `20-F` / `6-K` for foreign issuers); open the document at `https://www.sec.gov/Archives/edgar/data/<CIK without leading zeros>/<accession without dashes>/<primaryDocument>`; and cross-check statement figures against the tagged facts at `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`. Send an identifying `User-Agent` and stay under 10 requests per second. Record `Retrieval: web/tool retrieval`, the accession number and the filing date. **Institutional holdings are the exception to the issuer-CIK route:** Form `13F-HR` is filed by the investment *manager*, so it never appears under the target company's CIK. Resolve the manager (from the claim: "Vanguard holds 8.9%") to *its* CIK, list its `13F-HR` filings, and verify the position in the information table by the target's CUSIP — or use EDGAR full-text search (`https://www.sec.gov/edgar/search/#/q=%22<company or CUSIP>%22&forms=13F-HR`) to find which managers report the security. A 13F verifies one manager's position at one quarter-end; an aggregate "institutional ownership %" is a secondary-source figure and is marked `✅ (secondary)` at best. Only where the host has no retrieval path at all, ask the user to paste the document and mark `Retrieval: pasted by user` — the repository's helper scripts are not part of this plugin and are never run from here. A source that could not be retrieved leaves its claims `❓`; it is never filled from memory.

### Phase 3 — Verify each claim

For each ledger row, locate the figure in the source, compare, and assign one verdict:

| Verdict | Meaning | Rule |
|---------|---------|------|
| ✅ **VERIFIED** | The source states the figure | Reported figures: exact, or rounding within 0.5%. Market data: same trading day and within the stated tolerance. Percentages: within 0.1 pp. Record source · location · as-of |
| ⚠️ **MISMATCH** | The source states a different figure | Record the source value, the delta (absolute and %), and the **likely cause** — the usual suspects: wrong fiscal year or quarter; TTM vs. fiscal year; GAAP vs. adjusted; basic vs. diluted shares; a restated prior period; a currency or unit slip (thousands vs. millions); a stale price |
| ❓ **UNVERIFIABLE** | No Tier 1–2 source available | Say what source would settle it. This is *not* "false" — never let the corrected report read as if the claim were disproven |
| 🔁 **RECOMPUTED** | A derived figure rebuilt from verified inputs | Show the arithmetic (Phase 4); mark `agrees` or `disagrees (report X, recomputed Y)` |
| 🕒 **STALE** | Verified, but the as-of date is older than the report implies or than 90 days | Verified figure, wrong vintage — give the current value alongside |

A qualitative claim is judged only on whether the evidence the report cites for it holds; it is never `✅` on its own.

### Phase 4 — Recompute every derived figure

Never accept a derived number by matching it to a secondary source that may have made the same mistake. Rebuild it from verified inputs and show the work:

```
Free cash flow      = OCF − capex                          1,240 − 310            = 930   ✓ report 930
Gross margin        = gross profit ÷ revenue               3,550 ÷ 6,120          = 58.0% ✓ report 58%
Revenue growth      = rev / prior rev − 1                  6,120 ÷ 5,100 − 1      = 20.0% ✓
Net debt            = total debt − cash                    800 − 1,650            = −850  (net cash) ✓
Market cap          = price × shares outstanding           48.20 × 412            = 19,858   (shares outstanding at the price date — not the diluted count used for EPS)
Enterprise value    = market cap + debt − cash             19,858 + 800 − 1,650   = 19,008
P/E (trailing)      = price ÷ diluted EPS                  48.20 ÷ 1.99           = 24.2× ✓ report "24× forward" ✗ — trailing, not forward
FCF yield           = FCF ÷ market cap                     930 ÷ 19,858           = 4.7%
Payout (FCF basis)  = dividends paid ÷ FCF                 165 ÷ 930              = 17.7%
```

Standard checks: FCF, margins, growth rates, per-share figures (which share count?), P/E · P/S · EV/EBITDA · P/FCF (trailing vs. forward, and whose estimate), net debt and EV, payout and yield, ROE / ROIC (state the denominator), any score or weighted composite in the report (do the weights sum to 100%? does the weighted sum match?). Where the report's definition is ambiguous, say so rather than picking one silently.


This section is not finished here: `3. Framework` continues in `references/12-phase-5-consistency.md`.
