# H-Share / Hong Kong Market Adapter

Use for Hong Kong listed stocks, pure H-shares, red chips, HK-only listings, and
ADR/HK companies when the HK line is the primary security being evaluated.

## Market-Specific Data Sources

- `data_platform/hk_report_collector.py` or
  `data_platform.hk_report_collector.collect_hk_reports(<5-digit code>)`.
- yfinance for analyst consensus, price, target-price range, and basic
  financial fallback.
- AAStocks for broker-news style target-price and rating-change leads.
- Local RRS/Zsxq overseas report store, searched by Chinese name, English name,
  ticker variants, products, customers, and supply-chain keywords.
- HK filings and company IR when available.
- dfcfw/Eastmoney-hosted broker PDFs only as supplemental PDF evidence, stored
  as an independent RRS source such as `eastmoney_pdf_<infoCode>`.

## Required Evidence

Pure HK/ADR without A-share thesis key must not be forced through A-share
Eastmoney reportapi. Record:

```text
eastmoney_not_applicable_hk
```

Then run the HK branch:

```bash
PYTHONPATH={{QUANT_ROOT}} \
python data_platform/hk_report_collector.py <5-digit-hk-code>
```

or call `collect_hk_reports(<5-digit-hk-code>)` from Python.

Do not call `python data_platform/hk_report_collector.py --help`: this legacy
script treats the first positional argument as a ticker and may try to collect a
fake `--help` security. Use an actual numeric HK code such as `00148` or call
the Python function directly.

## HK-Specific Checks

- Normalize ticker variants: `00700.HK`, `700.HK`, `0700.HK`, `00700`, Chinese
  name, English name, ADR ticker if any.
- Before writing triggers/watchlist/verdict, prove alias convergence in both
  directions. For HK names with leading-zero ambiguity, test the five-digit
  canonical code, the trading-display four-digit code, no-suffix forms, Chinese
  name, English issuer name, and common short names with `resolve(...)`, then
  confirm `reverse_aliases(<canonical five-digit .HK code>)` contains the
  relevant variants. If any forward lookup misses, update
  `common/stock_alias_map.json` and the HK legacy-equivalent set before closing
  the L3.
- Persist both `canonical_code` and `queue_original_code` in workflow evidence
  when the research queue used a display ticker such as `0148.HK` but the
  project SSoT is `00148.HK`. After canonical trigger upsert, also mark the
  original queue code complete with `scripts/research_queue_complete.py` or
  equivalent `ResearchQueue.mark_complete(...)`; otherwise the queue can keep a
  stale `RESEARCH_DUE` row.
- If the stock was promoted from a concept/industry subject, truth-sync same
  stock rows in that subject/watchlist/bridge from `RESEARCH_QUEUE` to the
  completed L3 wait-state. Do not leave the theme row saying "pending L3" after
  the single-stock package is closed.
- Split coverage into `direct_company_coverage`, `summary_or_news`,
  `industry_cross_read`, and `keyword_leads`.
- HK collector output is often broker-news summary, not full report text. It can
  identify revision leads but cannot by itself carry a full valuation thesis.
- yfinance can be a fallback but must be labeled as such when it supplies
  financials or consensus.
- When annual and quarterly rows share the same `YYYY1231` period, prefer annual
  rows for annual sequence analysis.
- HKD amounts stay HKD in study math. HK Stock Connect CNY settlement is a note,
  not a replacement for original HKD proceeds.

## HK Completion Evidence

The workflow evidence or closeout proof must show:
- `eastmoney_not_applicable_hk` or A-share branch evidence if a real A-share key
  exists;
- HK collector result, yfinance consensus/fallback status, and failed-source
  list if any;
- RRS/Zsxq overseas search terms and reading ledger;
- direct vs cross-read split;
- currency basis for price, market cap, target price, and trade ledger.
