# Fuyao 首批 endpoint contract fixture 清单

状态：Phase 0 清单，尚未接入 source
来源优先级：真实 REST > `docs/reference/fuyao/llm_full.md` > `ths_api.md`

本文件只记录首批端点的 fixture 范围和验证要求。它不是运行时 schema，也不替代上游契约。

## Fixture 目录建议

后续实现时建议按以下结构增加 fixture：

```text
test/fixtures/fuyao/
  ticker-list/
    success.json
    empty.json
    errors.json
  corporate-actions/
    success.json
    empty.json
    errors.json
  financials/
    income-success.json
    balance-success.json
    cash-flow-success.json
    null-values.json
    errors.json
  financial-indicators/
    success.json
    null-value.json
    errors.json
  valuation/
    success.json
    null-metrics.json
    empty.json
    errors.json
  auction/
    success.json
    not-ready.json
    errors.json
  special-data/
    limit-up-pool-success.json
    limit-up-pool-empty.json
    limit-up-ladder-success.json
  index/
    catalog-success.json
    constituents-success.json
    snapshot-success.json
    historical-success.json
    errors.json
```

每个成功 fixture 应保留上游 envelope 的 `code`、`message`、`request_id` 和 `data`。测试 source 时验证返回给 Dataset 层的是 `data`，但必须能在 source 内部观察到或保存 request metadata 的设计位置。fixture 不得包含真实 API Key。

## Endpoint registry

| capability | path | params | output shape | pagination | 来源定位 |
|---|---|---|---|---|---|
| `ticker_list` | `/api/meta/tickers/list` | `asset_type?`, `limit?`, `offset?` | `data.item[]` | offset/limit | `llm_full.md:977-1072` |
| `corporate_actions` | `/api/a-share/corporate-actions/adjustment-factors` | `thscode`, `from?`, `to?` | `data.thscode`, `data.ticker`, `data.item[]` | none | `llm_full.md:882-958` |
| `income_statement` | `/api/a-share/financials/income-statements` | `thscode`, `period`, `limit?` or `start+end` | `data.item[]` | limit or time range | `llm_full.md:1074-1218` |
| `balance_sheet` | `/api/a-share/financials/balance-sheets` | same financial params | `data.item[]` | limit or time range | `llm_full.md:1220-1292` |
| `cash_flow` | `/api/a-share/financials/cash-flow-statements` | same financial params | `data.item[]` | limit or time range | `llm_full.md:1294-1359` |
| `financial_indicators` | `/api/a-share/financials/indicators` | `thscode`, `report` | `data.abilities[].indicators[]` | none | `llm_full.md:2470-2549` |
| `valuation` | `/api/a-share/valuations/snapshot` | `thscodes` | `data.item[]` | max 100 tokens, no pages | `llm_full.md:7700-7779` |
| `auction` | `/api/a-share/auction/snapshot` | `thscodes`, `stage?` | `data.item[]` plus phase/status | max 100 tokens, no pages | `llm_full.md:1976-2052` |
| `limit_up_pool` | `/api/a-share/special-data/limit-up-pool` | `date_ms?`, `page?`, `size?`, `sort_field?`, `sort_dir?` | `data.pagination` + `data.item[]` | page/size | `llm_full.md:6931-7033` |
| `limit_up_ladder` | `/api/a-share/special-data/limit-up-ladder` | none | `data.window` + `data.item[]` nested boards | fixed 30-day window | `llm_full.md:7191-7269` |
| `index_catalog` | `/api/a-share-index/catalog/ths-index-list` | `tag?` | `data.item[]` | none | `llm_full.md:1466-1523` |
| `index_constituents` | `/api/a-share-index/constituents/ths-stock-list` | `thscode` | `data.item[]` | none | `llm_full.md:1528-1587` |
| `index_quote` | `/api/a-share-index/prices/snapshot` | `thscodes`, `limit?`, `offset?` ignored | `data.item[]` | none | `llm_full.md:1591-1646` |
| `index_history` | `/api/a-share-index/prices/historical` | `thscode`, `interval`, `start`, `end` | `data.item[]` plus `adjust:null` | time range | `llm_full.md:1651-1709` |

## Required validation cases

### Common

- Missing required parameter -> local validation error before network call.
- Unknown parameter -> local validation error.
- Empty string and whitespace-only required values -> local validation error.
- Upstream `code != 0` preserves code, message and request_id in the source error.
- HTTP non-2xx error is distinct from business envelope error.
- `data.item=[]` is valid when the endpoint permits an empty result.
- `null` values remain `null`.
- No fixture or test may assert that missing financial values become zero.

### Codes and CSV lists

- Single-code endpoints reject comma-containing values.
- Codes are trimmed and uppercased before the digest/request.
- A-share codes require the documented suffix.
- Index codes allow `.SH`, `.SZ` and `.TI` according to endpoint documentation.
- Batch endpoints reject malformed tokens and enforce documented maximum token counts.
- Duplicate batch tokens follow the documented server behavior; normalization must not silently change the expected response order.

### Time and financial parameters

- `from/to` use `YYYY-MM-DD` for corporate actions.
- `start/end` use safe integer millisecond timestamps for financial and historical endpoints.
- `start` and `end` must appear together.
- `end >= start`.
- Financial `limit` is 1..20.
- Financial `limit` cannot coexist with `start/end`.
- Financial windows cannot exceed 10 years.
- `financial_indicators.report` accepts only `yyyy-1` through `yyyy-4`.

### Pagination

- `ticker_list` preserves explicit `offset/limit` as one Dataset request.
- `limit_up_pool` preserves `page/size` and the nested `pagination` object.
- No source silently issues a second page request.
- `pagination.total` is not used as the saved Dataset `row_count`.
- A short page is returned as-is; page aggregation is out of scope.

## Output contract assertions

The first implementation should assert the following minimum fields without rejecting unrelated upstream additions:

- `ticker_list`: `thscode`, `ticker`, `name`, `exchange`, `asset_type`, `currency`.
- `corporate_actions`: top-level `thscode`, `ticker`; item `ticker`, `ex_date_ms`, `dividend_per_share`, `per_share_bonus`.
- Financial statements: common period fields plus endpoint-specific fields; numeric fields may be `null`.
- `financial_indicators`: `thscode`, `report`, `abilities`; each ability has `ability` and `indicators`; each indicator has `index_id` and nullable string `value`.
- `valuation`: `thscode`, `ticker`, nullable `name`, `pe_ttm`, `pe_mrq`, `pb_mrq`, `ps_ttm`, `pcf_ttm`.
- `auction`: `thscode`, `ticker`, `name`, auction fields; nullable values remain nullable; `data_status` and `auction_phase` are preserved.
- `limit_up_pool`: `pagination.total/pages/size/page`; item code/name/price/limit-up/board/seal fields.
- `limit_up_ladder`: `window` and item `date` plus all six board arrays.
- `index_catalog`: `thscode`, `name`.
- `index_constituents`: `thscode`, `ticker`, `name`.
- `index_quote`: same price snapshot fields as the documented index response.
- `index_history`: `date_ms`, OHLC, `volume`, `turnover`; top-level `adjust` is `null`.

## Real REST smoke-test plan

When a valid credential is available, use one minimal request per endpoint and record only:

- HTTP status.
- request URL path and non-secret query shape.
- response envelope keys.
- response `code`, `message`, `request_id` presence.
- data shape, item count and representative field names.
- whether empty results use `item: []` or another valid empty shape.

Do not commit raw credentials, full high-volume responses, or presigned URLs. Smoke-test output should be summarized into fixture files with sanitized identifiers if needed.

## Exit criteria for Phase 0

- Every endpoint in the registry has a source line reference.
- Every `ths_api.md` versus `llm_full.md` conflict is recorded in the design document.
- Fixture categories exist before source implementation begins.
- Tests can distinguish a valid empty Dataset from an invalid response shape.
- No automatic pagination, DatasetRef field expansion, fund implementation or dump implementation is hidden inside Phase 0.
