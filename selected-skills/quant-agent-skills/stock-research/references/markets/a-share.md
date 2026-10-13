# A-Share Market Adapter

Use for A-share listed securities and for A+H companies when the A-share thesis
or A-share execution path is being evaluated.

## Market-Specific Data Sources

- Core market and financial tables through existing DB accessors and
  `collect-data`.
- Eastmoney research report list, text, and PDF fallback through
  `data_platform/research_report_collector.py`.
- Eastmoney RRS to `research_report` reconciliation through
  `scripts/sync_rrs_eastmoney_to_research_report.py`.
- Company announcements through `data_platform/cninfo_collector.py` and, when
  the collector misses a known event, a code + announcement-keyword PDF fallback.
  Download the official or exchange-hosted PDF/TXT into `data_platform/cninfo_output/`
  and ingest it into RRS with an S0/company-announcement source note.
- `report_rc` / `analyst_report_rc` for EPS, target price, and revision
  direction when available.
- `a-stock-data` for capital-flow and A-share microstructure signals:
  northbound, margin financing, block trades, LHB, holder count, unlocks,
  dividends, policy/calendar signals.

## Required Evidence

Run from project root:

```bash
PYTHONPATH={{QUANT_ROOT}} \
python data_platform/research_report_collector.py --code <code6> --text --save

python scripts/sync_rrs_eastmoney_to_research_report.py --code <code6> --name <name> --dry-run
python scripts/sync_rrs_eastmoney_to_research_report.py --code <code6> --name <name>
python scripts/sync_rrs_eastmoney_to_research_report.py --code <code6> --name <name> --dry-run
```

Hard pass requires the second dry-run to show:
- `missing_in_research_report=0`
- `short_content_to_refresh=0`

If `ModuleNotFoundError: auto_research` or `common` appears, fix
`PYTHONPATH` and rerun. That is not evidence that the stock has no reports.

For event-driven L2+/L3, also run the announcement leg:

```bash
PYTHONPATH={{QUANT_ROOT}} \
python data_platform/cninfo_collector.py --code <ts_code> \
  --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD> --category 临时公告 \
  --download-pdfs
```

If this returns 0 rows but the thesis is triggered by an order, bid award,
customer, litigation, financing, project, or other disclosure event, do not
write "no announcement". Run a second pass with `<code6> + <company name> +
<event keyword> + 公告/PDF` over exchange/CNINFO-style sources or already known
public PDF URLs. Persist the PDF/TXT locally, ingest it into RRS as
`company_announcement_pdf` or `cninfo_fallback`, and cite the local path or
`info_code` in `_public_signal_matrix_YYYYMMDD` and `_rrs_search_YYYYMMDD`.

## A-Share-Specific Checks

- Treat domestic broker ratings as structurally biased; rating count is not a
  bullish thesis. EPS/TP revision path and full text assumptions matter.
- For CDR or suspicious EPS units, downgrade raw EPS/forward PE and use market
  cap/normalized earnings, SOTP, or another routed valuation basis.
- For corporate-action windows, state price, share count, and EPS basis; mixed
  post-right/pre-right PE cannot carry entry price.
- A-share microstructure can affect timing and risk, not company-level EV by
  itself.

## New-Listing / IPO-Day Fast Path (v2.43, 2026-07-28 长鑫科技首日实证)

For IPO day-one or first-week A-share L3 (无涨跌幅前 5 日):

1. **Code resolution when `stock_basic` misses the new stock**: query
   `concept_member` (`con_name LIKE '%名称%'`) — THS concept tagging lands days
   BEFORE `stock_basic` refresh. Then patch both:
   - `common/stock_alias_map.json` (+中文名/简称/英文/代码 self-map), verify
     `resolve()` converges for every alias;
   - `stock_basic` targeted single-row insert via `pro.stock_basic(ts_code=...)`
     (`check_refresh_stock_basic` skips when <7d stale).
2. **Financials**: Tushare `fina_indicator` usually has prospectus-period rows
   (6+ periods incl. latest quarter) even when `income/balancesheet/cashflow`
   are empty. Persist them; mark `financial_tables_degraded_new_listing`;
   absolute income/balance/cash-flow numbers must come from the prospectus (S0).
3. **S0 filings**: `cninfo_collector` often returns 0 rows for fresh IPOs →
   announcement-list fallback: query eastmoney notice API
   (`np-anotice-stock.eastmoney.com/api/security/ann?stock_list=<code6>`), then
   download `https://pdf.dfcfw.com/pdf/H2_<art_code>_1.pdf` for 招股说明书 +
   上市公告书, persist under `data_platform/cninfo_output/`, ingest RRS as
   `company_announcement_pdf`.
4. **Load-bearing IPO structure from 上市公告书**: issue price / new shares /
   total shares (pre/post greenshoe) / day-1 free float % / lockup ladder
   (网下 70% 6mo, 跟投 24mo, 员工资管 36mo, 战配 12-36mo, 原始股东 12-36mo) /
   发行 PE vs industry mean / strategic placement actual vs planned.
5. **First-day price action is a market-pricing fact, never a buy trigger**:
   no-limit debut + huge turnover + high PE/PB/PS ≠ `BEAT`. Unheld default is
   `WAIT_EVENT`/`WAIT_PRICE` with `current_new_money_pct=0`; trigger actions
   only `re_research`/`watch`.
6. **Minority-interest check for JV-fab structures**: if key subsidiaries are
   <50% directly owned (一致行动协议 control), profit leakage to minorities will
   widen as those subsidiaries ramp — 归母 is the only correct valuation basis.

## A-Share Completion Evidence

The workflow evidence or closeout proof must show:
- DB and report coverage status;
- Eastmoney dual-store dry-run/write/dry-run result;
- S0 announcement collection result; when fallback was needed, the fallback
  query, PDF/TXT local path, and RRS `info_code`;
- full-text reading ledger split into `direct_company_coverage`,
  `summary_or_news`, `industry_cross_read`, and `keyword_leads`;
- A-share signal checks used or explicitly not applicable;
- no reader-facing provider fallback wording such as `腾讯实时兜底快照`, `兜底价`,
  or `周六兜底`.
