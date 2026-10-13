# U.S. Equity Market Adapter

Use for U.S. listed common stocks and U.S. primary listings. Use the ADR/HK
overlay when the company also has a Hong Kong listing or when a foreign private
issuer filing path is materially different from domestic U.S. issuers.

## Market-Specific Data Sources

- `data_platform/sec_edgar_collector.py` for SEC EDGAR filings already supported
  locally: `10-K`, `10-Q`, `8-K`, `13F-HR`, and `Form 4`.
- `data_platform/yfinance_analyst_collector.py` for analyst recommendation
  trend, target prices, EPS/revenue estimates, EPS trend, and growth estimates.
- Local RRS/Zsxq overseas reports for direct company coverage and cross-read.
- FRED/macro data when rates, FX, employment, inflation, liquidity, or sector
  cycle are load-bearing.
- Company IR when SEC coverage is not enough or the issuer uses non-U.S. filing
  forms not yet covered by the local collector.

## Required Preflight

SEC collection requires a valid identity:

```bash
export SEC_IDENTITY="name email@example.com"
```

Then collect filings through the local collector. Use project wrappers when
available; otherwise call the collector module directly and verify saved RRS
rows with `source="sec_edgar"`.

```bash
PYTHONPATH={{QUANT_ROOT}} \
python data_platform/sec_edgar_collector.py --ticker <TICKER> --forms 10-K,10-Q,8-K --limit 5 --text
```

Run or cite yfinance analyst collection and verify saved RRS rows with
`source="yfinance"`.

```bash
PYTHONPATH={{QUANT_ROOT}} \
python data_platform/yfinance_analyst_collector.py --ticker <TICKER>
```

## U.S.-Specific Checks

- Eastmoney dual-store proof is not applicable. Do not block a U.S. stock for
  lacking A-share Eastmoney coverage.
- If the user explicitly asks to pull Eastmoney domestic reports, run or cite the
  A-share collector attempt and record the boundary as
  `eastmoney_not_applicable_us_stock` with the command/result. Example:
  `research_report_collector.py --code MRVL --text --json` returns `MRVL: 0 篇`
  and `akshare 拉取 MRVL 失败: 'infoCode'`; this is an A-share collector coverage
  boundary, not proof that no overseas reports exist.
- Filing coverage must be dated and form-specific. A 10-K does not replace a
  later 10-Q or 8-K when the thesis depends on recent results or events.
- If the local SEC collector fails because ticker-to-CIK mapping, supported
  forms, or text extraction is incomplete, record a bounded failure such as
  `sec_ticker_cik_mapping_limit` or `collector_failed_fallback_used`, then cite
  official SEC/company IR URLs. Do not write "no SEC disclosure" unless the
  official filing surfaces were also checked.
- If `data_platform/.sec_edgar_progress/checkpoint.json` records a U.S. ticker
  with `count=0`, treat that as collector-attempt evidence only. It can come from
  local SEC/CIK/TLS extraction failure. It does not prove the issuer lacks SEC
  disclosure, and it must be paired with official SEC/IR fallback URLs before
  closeout.
- For event-driven U.S. L3 names, `_public_signal_matrix_YYYYMMDD.{md,json}`
  must include event expectation-delta fields for load-bearing announcements:
  `pre_event_expectation`, `priced_in_view`, `actual_disclosure`, `delta_class`,
  and `action_boundary`. A `BEAT` order announcement can support a trigger, but
  it is not a buy signal until the action boundary ties it to revenue, margin,
  cash-flow, dilution, or other trade-eligibility proof.
- For foreign private issuer ADRs, many important filings are `20-F` and `6-K`.
  If local EDGAR collector support is absent, mark the limitation explicitly and
  use company IR / ADR-HK overlay as fallback evidence.
- Separate GAAP and non-GAAP metrics. SBC, restructuring charges, acquisition
  adjustments, tax effects, and diluted share count changes must be explicit
  before using EPS or FCF per share.
- For software/platform businesses, check deferred revenue, RPO, NRR/DBNRR,
  billings, backlog, and segment margins when available.
- For buyback-driven EPS growth, split operating income growth from share-count
  shrink.
- For global revenue, state FX basis and geographic/segment exposure.
- For mega-cap or rate-sensitive equities, FRED/macro is often an input to
  discount rate and multiple, not a standalone thesis.
- Reconcile yfinance saved rows to curated evidence ids. A standard successful
  yfinance analyst run often saves separate rows for recommendation trend,
  target price, revenue estimates, EPS estimates, EPS trend, and growth
  estimates. If workflow evidence says 6 rows were saved, the report index and
  closeout proof must show 6 ids or state why a row was excluded.

## U.S. Three-Tool Adapter (Ironclad-22 Refresh)

Ironclad-22 requires rerunning `forward_pe_snapshot`, `compute_sotp`, and
`classify_earnings_base` on any L3 refresh. These tools' local backends read
A-share `fina_indicator` or H-share `hk_fina_indicator` tables, which do not
exist for U.S. equities. Use these yfinance-equivalent implementations and
document the U.S. adapter explicitly in the deep-study file:

- `forward_pe_snapshot`: use yfinance analyst collector forward EPS
  (FY1/FY2, e.g. 2027E EPS 8.851) as the forward anchor. Do not use TTM EPS as
  the valuation anchor for rapidly scaling earnings. State the forward PE
  multiple and the 12-18m horizon explicitly.
- `compute_sotp`: mark N/A when the company is a single-segment business (e.g.
  integrated power+cooling). SOTP applies to diversified multi-segment
  conglomerates only; do not force a single-segment U.S. name into SOTP.
- `classify_earnings_base`: infer `secular_growth` / `cyclical` / `one_off`
  from yfinance revenue/EPS growth estimates and segment narrative. State the
  classification and the gm_ratio / growth-slope basis.

Record `us_equity_three_tool_adapter=yfinance_equivalent` in workflow evidence
when this path is used, so the refresh is auditable and not mistaken for
skipping ironclad-22.

## U.S. Completion Evidence

The workflow evidence or closeout proof must show:
- SEC forms collected, dates, and RRS persistence status, or a documented filing
  fallback;
- yfinance analyst dataset fields collected and saved or explicit failure;
- Eastmoney domestic API status when the user requested it, usually
  `eastmoney_not_applicable_us_stock`;
- local overseas report searches by ticker, company name, product, customer,
  and peer terms;
- direct company coverage split from cross-read;
- event-driven public-signal matrix rows with expectation, priced-in view,
  actual disclosure, delta class, and action boundary when orders, filings,
  customer wins, capacity, product-route changes, or earnings drive the thesis;
- current price, market cap, currency, share-count, GAAP/non-GAAP basis, and
  estimate date;
- action semantics in USD terms and portfolio ledger currency basis.

## Reference Smoke

`MRVL.US` on 2026-06-16 is the first completed U.S. L3 smoke for this adapter:
yfinance saved 6 analyst rows, local RRS returned direct/cross-read overseas
coverage, Eastmoney A-share collection was recorded as
`eastmoney_not_applicable_us_stock`, official Marvell IR/SEC URLs covered a
local SEC collector failure, real six-agent evidence was captured, research-loop
accepted the U.S. ticker, Vault sync matched 12 files, and
`quality_gate_check.py` returned `160/160 PASS`.

`AAOI.US` on 2026-06-16 is the second completed U.S. L3 closeout reference:
yfinance saved 6 analyst rows; local overseas RRS found no direct top-bank AAOI
company coverage, but separated 6 direct yfinance rows from 88 industry/peer
cross-read samples; Eastmoney A-share collection was recorded as
`eastmoney_not_applicable_us_stock`; the SEC collector checkpoint wrote
`count=0` for 10-K/10-Q/8-K and was treated as
`collector_failed_fallback_used`, with official SEC/IR URLs carrying disclosure;
the public-signal matrix was upgraded with expectation-delta fields; research
loop returned `WAIT_EVENT`, Vault sync matched 13 files, and
`quality_gate_check.py` returned `160/160 PASS`.
