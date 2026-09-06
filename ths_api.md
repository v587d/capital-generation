基于同花顺金融数据开放平台（**Fuyao API**，官方文档：[https://fuyao.aicubes.cn/docs/api-reference/overview/](https://fuyao.aicubes.cn/docs/api-reference/overview/)），为您整理出的一份**具体的、生产级 API 开发与接入参考文档**。

这份文档将全站分散的 50+ 个核心 REST 接口及 MCP 工具链按照**架构规范、元数据、行情、财务、盘面特色、指数板块、公募基金**等模块进行了系统化归类，补齐了各接口的请求方法、参数说明、数据结构与开发实践避坑指南。

---

# 同花顺金融数据 API 开发参考文档 (v1.0)

## 1. 架构与通用协议规范

### 1.1 服务基础信息
- **Base URL**: `https://fuyao.aicubes.cn`
- **通讯协议**: HTTPS, 传输编码 UTF-8
- **时间与时区**: 所有时间戳统一为 **毫秒级 Unix 时间戳（`long`）**，时区固定为 **`Asia/Shanghai`**
- **币种与数值**: 价格默认按原始计价币种（A股恒为 `CNY`）；**涨跌幅、占比、换手率等统一为百分比数值原值**（如返回 `8.88` 表示 `+8.88%`）
- **代码规范（thscode）**: 标的必须使用**完整交易所后缀代码**（如 `600519.SH`、`000001.SZ`、`886042.TI`、`025480.OF`），**严禁省略后缀**。

### 1.2 鉴权方式
所有标准 `/api/**` 请求必须在 HTTP Request Header 中注入 API Key：
```http
X-api-key: <your-api-key>
```
> **注**：缺少、无效返回 `code: 2001`；无该 Capability 权限返回 `code: 2003`。

### 1.3 统一响应信封 (`ApiResponse`)
无论请求成功还是业务报错，所有接口统一返回 **HTTP Status 200**，业务执行状态经由响应信封的 `code` 字段进行判定：

```json
{
  "code": 0,
  "message": "success",
  "request_id": "a1b2c3d4e5f6789012345678abcdef01",
  "data": {
    "timestamp": 1716105600000,
    "total": 100,
    "item": [ ... ]
  }
}
```

#### 信封字段说明
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `code` | `integer` | 业务状态码。`0` 表示成功，非 `0` 表示业务异常。 |
| `message` | `string` | 业务状态或错误详细描述。 |
| `request_id` | `string` | 单次调用的全局追踪 ID（排查问题请携带此 ID）。 |
| `data` | `object \| null` | 业务数据主体。异常时可能为 `null`。 |
| `data.timestamp` | `long` | 数据上游就绪时间戳（毫秒）。无有效时间时为响应时间戳。 |
| `data.item` | `array` | 核心业务记录列表。即使单条记录也封装为数组。 |

### 1.4 全局业务错误码表
| 状态码 (`code`) | 含义 | 触发典型场景 |
| :--- | :--- | :--- |
| **0** | 成功 | 请求成功返回有效数据。 |
| **1001** | 缺少必填参数 | `thscode`、`start`、`end`、`q`、`fund_type` 等漏传。 |
| **1002** | 参数格式错误 | `thscode` 包含非法字符/多传逗号，或日期时间格式不合规。 |
| **1003** | 参数取值越界 | 枚举非法、`limit <= 0`，或历史查询时间窗口超过上限（如超过 10 年）。 |
| **1004** | 参数逻辑冲突 | 财务接口同时传 `start/end` 与 `limit`；时间范围只传单边（半开区间）。 |
| **2001** | 未认证 | `X-api-key` 请求头缺失或凭据无效。 |
| **2003** | 权限不足 | 当前 API Key 尚未开通该数据接口的能力权限。 |
| **3001** | 标的不存在 | 代码表中未检索到对应的股票、基金或指数。 |
| **3002** | 数据未就绪 | 标的有效但底层数据源尚未生成或同步该指标。 |
| **3004** | 标的类型不支持 | 尝试对非股票标的调用股票专用财务/行情接口。 |
| **4001** | 频率超限 (Rate Limit) | 超过约定的每秒请求频次（QPS 阈值）。 |
| **5001** | 服务内部错误 | 后端服务器发生未捕获异常。 |
| **5002** | 上游服务超时 | 底层行情或金融数据库响应超时。 |
| **5003** | 数据源不可用 | 上游数据节点维护或不可达。 |

---

## 2. 基础元数据模块 (Meta)

在进入任何行情或业务分析前，必须通过本模块将中文名称或纯数字代码**消歧**为标准 `thscode`。

### 2.1 标的检索与消歧
- **端点**: `GET /api/meta/tickers/search`
- **MCP Tool**: `get_meta_tickers_search`
- **说明**: 支持按 `thscode`、纯 `ticker`、中文名或英文简称做跨市场检索消歧。

#### Query 请求参数
| 参数 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `q` | `string` | **是** | — | 检索关键字（如 `贵州茅台`、`600519`、`宁德时代`） |
| `exchange` | `string` | 否 | — | 交易所过滤：`SH` / `SZ` / `BJ` |
| `asset_type`| `string` | 否 | — | 资产类型过滤，逗号分隔：`a-share`、`a-share-index`、`forex`、`fund-otc`、`fund-etf`、`fund-lof`、`fund-reits` |
| `limit` | `integer`| 否 | 10 | 返回条数上限，最大 50 |

#### `data.item[]` 返回字段
- `thscode` (`string`): 完整代码，如 `600519.SH`。
- `ticker` (`string`): 纯数字代码，如 `600519`。
- `name` (`string`): 标的规范化展示名称。
- `exchange` (`string`): 所属交易所（`SH` / `SZ` / `BJ`）。
- `asset_type` (`string`): 资产分类（如 `a-share`）。
- `currency` (`string`): 结算货币（如 `CNY`）。

---

### 2.2 标的代码表批量获取
- **端点**: `GET /api/meta/tickers/list`
- **MCP Tool**: `get_meta_tickers_list`
- **说明**: 批量分页拉取指定市场或资产类别的全量标的字典。

#### Query 请求参数
| 参数 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `asset_type`| `string` | 否 | `a-share` | 资产类型，枚举同上 |
| `exchange` | `string` | 否 | `SH,SZ` | 交易所逗号分隔 |
| `limit` | `integer`| 否 | 1000 | 分页大小（上限 10,000） |
| `offset` | `integer`| 否 | 0 | 分页游标偏移量 |

---

## 3. A股行情与复权模块 (Prices & Actions)

### 3.1 行情快照 (Snapshot)
- **端点**: `GET /api/a-share/prices/snapshot`
- **MCP Tool**: `get_a_share_prices_snapshot`
- **模式说明**:
  1. **指定标的批量查询**: 传入 `thscodes`（逗号分隔），忽略分页。
  2. **全市场遍历模式**: 省略 `thscodes`，使用 `limit` 与 `offset` 遍历全 A 股。

#### Query 请求参数
| 参数 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `thscodes` | `string` | 否 | — | 多个完整代码（如 `600519.SH,000001.SZ`） |
| `limit` | `integer` | 否 | 100 | 全市场模式分页大小 |
| `offset` | `integer` | 否 | 0 | 全市场模式分页游标 |

#### `data.item[]` 返回字段
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `thscode` | `string` | 标的代码，如 `600519.SH` |
| `ticker` | `string` | 标的纯代码，如 `600519` |
| `last_price` | `number` | 最新成交价（单位：元） |
| `price_change` | `number` | 相对前收盘价的涨跌金额 |
| `price_change_ratio_pct` | `number` | 当日涨跌幅（单位：%） |
| `open_price` | `number` | 当日开盘价 |
| `high_price` | `number` | 当日最高价 |
| `low_price` | `number` | 当日最低价 |
| `prev_price` | `number` | 昨日收盘价 |
| `volume` | `number` | 当日累计成交量（股） |
| `turnover` | `number` | 当日累计成交额（元） |

> **开发提示**: 行情快照接口为追求低延迟，不包含股票中文名 `name`。如需渲染看板，请提前使用 Meta 接口预存或关联映射。

---

### 3.2 历史 K 线 (Historical K-Line)
- **端点**: `GET /api/a-share/prices/historical`
- **MCP Tool**: `get_a_share_prices_historical`
- **约束**: **单次仅支持查询单只标的**（不可传逗号）；查询时间跨度 `end - start` **不可超过 10 年**。

#### Query 请求参数
| 参数 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `thscode` | `string` | **是** | — | 单只标的代码（如 `600519.SH`） |
| `interval`| `string` | **是** | `1d` | K 线周期，当前固定支持 `1d`（日线） |
| `start` | `long` | **是** | — | 起始毫秒时间戳 |
| `end` | `long` | **是** | — | 截止毫秒时间戳（`end >= start`） |
| `adjust` | `string` | 否 | `forward` | 复权模式：`none` (不复权) / `forward` (前复权) / `backward` (后复权) |
| `offset` | `integer`| 否 | 0 | 分页偏移量 |

#### `data.item[]` 返回字段
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `date_ms` | `long` | K 线所在自然日的毫秒戳 (00:00:00) |
| `open_price` | `number` | 开盘价 |
| `high_price` | `number` | 最高价 |
| `low_price` | `number` | 最低价 |
| `close_price`| `number` | 收盘价 |
| `volume` | `number` | 成交量（股） |
| `turnover` | `number` | 成交额（元） |

---

### 3.3 除复权事件流 (Corporate Actions)
- **端点**: `GET /api/a-share/corporate-actions/adjustment-factors`
- **MCP Tool**: `get_a_share_corporate_actions_adjustment_factors`
- **说明**: 获取现金分红、送转股、配股事件流，供客户端精确计算因子。
- **参数**: `thscode` (必填), `from` (格式 `YYYY-MM-DD`, 可选), `to` (可选)。
- **核心字段**: `ex_date_ms` (除权除息日时间戳), `dividend_per_share` (每股分红派息), `per_share_bonus` (每股送转股比例)。

---

### 3.4 全市场离线数据导出 (Market Dumps)
- **端点**:
  - 10 年全市场日K: `GET /api/dump/market-dumps/daily-k/download-url`
  - 近 10 交易日日K: `GET /api/dump/market-dumps/daily-k-10d/download-url`
  - 全量复权因子: `GET /api/dump/market-dumps/adjustment-factors/download-url`
- **说明**: 返回 AWS S3 格式的预签名下载短链接（有效期 5 分钟），数据以 Parquet 列式存储文件提供，适合批量离线回测，避免对单股接口高频轮询。

---

## 4. A股财务数据模块 (Financials)

支持按**最近 N 期模式**（互斥传 `limit`）或**时间区间模式**（互斥传 `start + end`）拉取，数据按 `period_end_ms` 逆序排列。

### 4.1 合并利润表 (Income Statement)
- **端点**: `GET /api/a-share/financials/income-statements`
- **MCP Tool**: `get_a_share_financials_income_statements`

#### Query 请求参数
| 参数 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `thscode` | `string` | **是** | — | 标的代码（如 `600519.SH`） |
| `period` | `string` | **是** | `annual` | 报告期类别：`annual`（仅年报/Q4）/ `quarterly`（包含季报、中报、三季报） |
| `limit` | `integer` | 否 | 4 | 最近 N 期（范围 `1..20`），与 `start/end` 互斥 |
| `start` | `long` | 否 | — | 起始报告期毫秒时间戳（需配合 `end` 共同传入） |
| `end` | `long` | 否 | — | 结束报告期毫秒时间戳（窗口跨度 `<= 10` 年） |

#### 核心输出字段 (`data.item[]`)
- `fiscal_year` (`int`): 会计年度（如 `2024`）
- `fiscal_period` (`string`): 会计期间（如 `Q1`、`Q2`、`Q3`、`FY`）
- `report_date_ms` (`long`): 财报实际披露公告日时间戳
- `period_end_ms` (`long`): 报告期会计截止日时间戳（如 12 月 31 日）
- `currency` (`string`): 记账币种（`CNY`）
- `operating_income` (`number`): 营业总收入
- `operating_profit` (`number`): 营业利润
- `net_profit` (`number`): 净利润
- `parent_holder_net_profit` (`number`): 归属于母公司股东的净利润
- `basic_eps` (`number`): 基本每股收益（元/股）

---

### 4.2 合并资产负债表 (Balance Sheet)
- **端点**: `GET /api/a-share/financials/balance-sheets`
- **MCP Tool**: `get_a_share_financials_balance_sheets`
- **参数规则**: 同利润表（支持 `period=annual|quarterly` 与 `limit`）。
- **核心输出字段**:
  - `total_assets`: 资产总计
  - `total_liabilities`: 负债合计
  - `total_equity`: 所有者权益合计
  - `accounts_receivable`: 应收账款
  - `inventories`: 存货
  - `cash_and_cash_equivalents`: 货币资金与现金等价物
  - `total_debt`: 总带息负债

---

### 4.3 合并现金流量表 (Cash Flow Statement)
- **端点**: `GET /api/a-share/financials/cash-flow-statements`
- **MCP Tool**: `get_a_share_financials_cash_flow_statements`
- **参数规则**: 同利润表。
- **核心输出字段**:
  - `act_cash_flow_net`: 经营活动产生的现金流量净额
  - `invest_cash_flow_net`: 投资活动产生的现金流量净额
  - `financing_cash_flow_net`: 筹资活动产生的现金流量净额
  - `pay_fixed_assets_etc_cash`: 购建固定资产、无形资产和其他长期资产支付的现金（资本开支）
  - `pay_dividends_profits_interest_cash`: 分配股利、利润或偿付利息支付的现金
  - `cash_equivalents_net_addition`: 现金及现金等价物净增加额

---

### 4.4 财务指标综合数据 (Financial Indicators)
- **端点**: `GET /api/a-share/financials/indicators`
- **MCP Tool**: `get_a_share_financials_indicators`
- **说明**: 获取指定标的的成长、盈利、偿债、营运和现金流五类预计算衍生财务指标。
- **关键字段**: 净资产收益率（`roe`）、总资产收益率（`roa`）、毛利率（`gross_profit_margin`）、净利率（`net_profit_margin`）、资产负债率（`debt_to_assets_ratio`）、流动比率、速动比率等。

---

## 5. 估值、集合竞价与交易日历模块

### 5.1 A股估值快照 (Valuations Snapshot)
- **端点**: `GET /api/a-share/valuations/snapshot`
- **MCP Tool**: `get_a_share_valuations_snapshot`
- **参数**: `thscodes`（逗号分隔，1-100 个代码）。
- **核心输出字段**:
  - `pe_ttm`: 市盈率 (TTM)
  - `pe_lyr`: 市盈率 (静态/LYR)
  - `pb`: 市净率
  - `ps_ttm`: 市销率 (TTM)
  - `dividend_yield_pct`: 股息率（%）
  - `market_cap`: 总市值（元）
  - `float_market_cap`: 流通市值（元）

---

### 5.2 集合竞价快照 (Auction Snapshot)
- **端点**: `GET /api/a-share/auction/snapshot`
- **MCP Tool**: `get_a_share_auction_snapshot`
- **参数**:
  - `thscodes` (必填): 逗号分隔的股票列表。
  - `stage` (可选): 阶段，`live` (实时盘口) 或 `final` (9:25 最终撮合形态，默认 `final`)。
- **核心输出字段**:
  - `auction_price`: 竞价成交价
  - `auction_pct`: 竞价涨跌幅（%）
  - `auction_volume`: 竞价匹配成交量（股）
  - `auction_amount`: 竞价成交金额（元）
  - `auction_unmatched`: 竞价未匹配委托量（股）
  - `auction_turnover_pct`: 竞价换手率（%）
  - `auction_volume_ratio`: 竞价量比

---

### 5.3 短线风向标竞价基准
- **端点**: `GET /api/a-share/auction/short-term-benchmark`
- **MCP Tool**: `get_a_share_auction_short_term_benchmark`
- **参数**: `date` (格式 `YYYY-MM-DD`，可选，默认当日)。
- **说明**: 追踪集合竞价异动突出的短线风向标股票，返回带有标签（如 `["高开", "放量"]`）的精选池。

---

### 5.4 A股交易日历 (Calendar)
- **端点**: `GET /api/a-share/calendar/trading-days`
- **MCP Tool**: `get_a_share_calendar_trading_days`
- **说明**: 无入参，固定返回近一年（365天）的所有合法开市交易日序列。
- **核心输出字段**:
  - `item[]`: 包含 `date_ms`（交易日零点毫秒戳）与可读字符串 `date`（如 `"20250620"`）。

---

## 6. 短线与盘面特色数据模块 (Special Data)

### 6.1 涨停股票池 (Limit-up Pool)
- **端点**: `GET /api/a-share/special-data/limit-up-pool`
- **MCP Tool**: `get_a_share_special_data_limit_up_pool`
- **说明**: 盘面复盘核心接口，按交易日返回收盘或日内的 A 股涨停股票及连板信息。

#### Query 请求参数
| 参数 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `date_ms` | `long` | 否 | 当日零点 | 交易日毫秒时间戳（省略时回退至今日） |
| `page` | `integer` | 否 | 1 | 分页页码（`>= 1`） |
| `size` | `integer` | 否 | 50 | 每页条数（`1..200`） |
| `sort_field` | `enum` | 否 | `last_price` | 排序字段：`last_price`、`continue_day_cnt`、`seal_money`、`limit_up_time` |
| `sort_dir` | `enum` | 否 | `desc` | 排序方向：`asc` / `desc` |

#### `data.item[]` 核心字段
- `thscode` / `ticker` / `name`: 股票代码与简称
- `last_price` (`number`): 当前/收盘价
- `price_change_ratio_pct` (`number`): 涨幅百分比
- `limit_up_time` (`string`): 首次涨停时间（格式 `HH:mm`）
- `limit_up_reason` (`string`): 涨停核心驱动因素（如 `"存储芯片"`）
- `continue_day_cnt` (`int`): 连续涨停板天数（如 `3`）
- `continue_day_text` (`string`): 连板文字展示（如 `"3连板"`、`"5天4板"`）
- `seal_money` (`number`): 当前封单金额（元）
- `max_seal_money` (`number`): 日内最高封单金额（元）

---

### 6.2 跌停股票池与炸板池
- **跌停池**: `GET /api/a-share/special-data/limit-down-pool`
  - 核心字段：`first_limit_time`（首次跌停时间）、`last_limit_time`（最终跌停时间）、`turnover_ratio_pct`（换手率）。
- **炸板池**: `GET /api/a-share/special-data/limit-break-pool`
  - 核心字段：`open_times`（盘中开板破板次数）、`turnover_ratio_pct`、`turnover`。

---

### 6.3 连板天梯矩阵 (Limit-up Ladder)
- **端点**: `GET /api/a-share/special-data/limit-up-ladder`
- **MCP Tool**: `get_a_share_special_data_limit_up_ladder`
- **说明**: 无需入参。返回近 30 个交易日、按高度板分层的结构矩阵（2板、3板、4板、5板、6板、7板及以上）。
- **结构**: `data.item[].boards` 包含 `two_board`、`three_board`、`four_board`、`five_board`、`six_board`、`seven_over` 数组。

---

### 6.4 榜单与市场热度
- **A股飙升榜**: `GET /api/a-share/special-data/skyrocket-list`
- **实时热股榜**: `GET /api/a-share/special-data/hot-stock-list`
- **历史热股榜**: `GET /api/a-share/special-data/hot-stock-list-history`
- **热股排名趋势**: `GET /api/a-share/special-data/hot-stock-rank-trend`
- **A股个股当日异动原因**: `GET /api/a-share/special-data/anomaly-analysis-stock`
  - 配合自选股监控，返回同花顺盘面异动归因事实（`anomaly_reason`）。
- **A股龙虎榜**: `GET /api/a-share/special-data/dragon-tiger-list`
  - 参数：`board_type` (`all` 全榜 / `org` 机构专用席位 / `hot_money` 知名游资席位)、`date` (`YYYY-MM-DD`)。

---

## 7. 指数与板块模块 (A-share Index)

### 7.1 同花顺指数目录与分类
- **端点**: `GET /api/a-share-index/catalog/ths-index-list`
- **MCP Tool**: `get_a_share_index_catalog_ths_index_list`
- **Query 参数**: `tag` (分类标签，如 `cn_concept` 概念板块、`industry` 行业指数等)。
- **说明**: 查询同花顺特色概念/行业指数代码（如白酒概念 `886042.TI`）。

---

### 7.2 指数成分股列表 (Constituents)
- **端点**: `GET /api/a-share-index/constituents/ths-stock-list`
- **MCP Tool**: `get_a_share_index_constituents_ths_stock_list`
- **Query 参数**: `thscode`（指数代码，如 `000300.SH` 沪深300，或 `886042.TI` 概念指数）。
- **说明**: 输出该指数当前的成分股 `thscode` 清单及权重（如有）。

---

### 7.3 指数行情快照与历史走势
- **指数快照**: `GET /api/a-share-index/prices/snapshot`
  - 参数：`thscodes`（如 `000001.SH,399001.SZ,886042.TI`）。
- **指数历史K线**: `GET /api/a-share-index/prices/historical`
  - 参数：`thscode`、`interval` (`1d`)、`start`、`end`。

---

## 8. 公募基金模块 (Fund)

多数基金接口支持场外基金、ETF/LOF 与 REITs，使用 `(fund_type, thscode)` 定位标的。

### 8.1 基金接口通用定位规则
- **`fund_type`**: `otc` (场外开放式基金) / `exchange` (场内交易型基金: ETF、LOF) / `reits` (公募REITs)
- **`thscode`**: 完整基金代码，如 `025480.OF`、`510300.SH`、`161725.SZ`、`508000.SH`

### 8.2 核心接口矩阵
| 业务分类 | REST 端点 | MCP Tool | 说明 |
| :--- | :--- | :--- | :--- |
| **基本资料** | `GET /api/fund/profile/detail` | `get_fund_profile_detail` | 基金名称、成立日期、管理人、投资类型 |
| **重仓持仓** | `GET /api/fund/portfolio/holdings` | `get_fund_portfolio_holdings` | 定期披露的前十大重仓股票、债券持仓明细 |
| **资产配置** | `GET /api/fund/portfolio/asset-allocation` | `get_fund_portfolio_asset_allocation` | 股票、债券、现金、其他资产配置比例 |
| **行业配置** | `GET /api/fund/portfolio/industry-allocation` | `get_fund_portfolio_industry_allocation` | 行业敞口与持仓行业占比 |
| **历史股票持仓** | `GET /api/fund/portfolio/stock-history` | `get_fund_portfolio_stock_history` | 历史各期披露的全量股票持仓列表 |
| **历史净值** | `GET /api/fund/performance/nav` | `get_fund_performance_nav` | 单位净值、累计净值、复权净值序列 |
| **阶段收益** | `GET /api/fund/performance/returns` | `get_fund_performance_returns` | 近1周/1月/3月/6月/1年/今年以来/成立以来收益率 |
| **回撤指标** | `GET /api/fund/performance/drawdowns` | `get_fund_performance_drawdowns` | 各区间历史最大回撤与回撤区间 |
| **持有人结构** | `GET /api/fund/holders/detail` | `get_fund_holders_detail` | 机构投资者、个人投资者与内部员工持有比例 |
| **前十大持有人** | `GET /api/fund/holders/top` | `get_fund_holders_top` | 机构/个人大持有人名称及持有份额 |
| **基金经理详情** | `GET /api/fund/managers/detail` | `get_fund_managers_detail` | 按 `manager_id` 查询经理简历、从业年限与管理规模 |
| **基金公司详情** | `GET /api/fund/companies/detail` | `get_fund_companies_detail` | 按 `company_id` 查询公募公司规模与基金只数 |
| **场内行情快照** | `GET /api/fund/market/snapshot` | `get_fund_market_snapshot` | ETF/LOF 场内实时行情快照 |
| **ETF历史日线** | `GET /api/fund/market/historical` | `get_fund_market_historical` | 场内 ETF 历史日 K 线数据 |

---

## 9. AI Agent / MCP 工具协议集成指南

同花顺 API 原生提供 **MCP (Model Context Protocol) Tools** 支持，将上述能力无缝接入 Claude Desktop、Cursor、Windsurf、QClaw 等 AI Agent 环境。

### 9.1 MCP Server 端点清单
| 服务名称 | MCP Endpoint (SSE/HTTP) | 涵盖范围 |
| :--- | :--- | :--- |
| `fuyao-meta` | `https://fuyao.aicubes.cn/mcp/meta` | 标的搜索消歧、全市场代码表遍历 |
| `fuyao-a-share` | `https://fuyao.aicubes.cn/mcp/a-share` | 个股行情、K线、财务、估值、竞价、特色数据 |
| `fuyao-a-share-index`| `https://fuyao.aicubes.cn/mcp/a-share-index` | 指数目录、指数成分股、板块行情与K线 |
| `fuyao-fund` | `https://fuyao.aicubes.cn/mcp/fund` | 基金资料、净值、业绩、持仓、经理与ETF行情 |

### 9.2 Agent 配置范例 (`claude_desktop_config.json` 或 `mcp.json`)
```json
{
  "mcpServers": {
    "fuyao-meta": {
      "type": "http",
      "url": "https://fuyao.aicubes.cn/mcp/meta",
      "headers": {
        "X-api-key": "YOUR_API_KEY"
      }
    },
    "fuyao-a-share": {
      "type": "http",
      "url": "https://fuyao.aicubes.cn/mcp/a-share",
      "headers": {
        "X-api-key": "YOUR_API_KEY"
      }
    },
    "fuyao-a-share-index": {
      "type": "http",
      "url": "https://fuyao.aicubes.cn/mcp/a-share-index",
      "headers": {
        "X-api-key": "YOUR_API_KEY"
      }
    },
    "fuyao-fund": {
      "type": "http",
      "url": "https://fuyao.aicubes.cn/mcp/fund",
      "headers": {
        "X-api-key": "YOUR_API_KEY"
      }
    }
  }
}
```

### 9.3 Agent 经典调用链路（以“分析白酒概念龙头股行情”为例）
1. **消歧与找板块**: 调 `fuyao-a-share-index: get_a_share_index_catalog_ths_index_list`，通过关键词 `"白酒"` 定位代码 `886042.TI`。
2. **提取成分股**: 调 `fuyao-a-share-index: get_a_share_index_constituents_ths_stock_list(thscode="886042.TI")` 获取成分股列表。
3. **批量拉取快照**: 调 `fuyao-a-share: get_a_share_prices_snapshot(thscodes="600519.SH,000858.SZ,...")` 取日内实时报价并排序。
4. **穿透财务体检**: 调 `fuyao-a-share: get_a_share_financials_income_statements(thscode="600519.SH", period="quarterly", limit=4)` 查看近 4 期季报营收利润。

---

## 10. 常用开发语言调用范例

### 10.1 Python 生产级封装客户端
```python
import time
import requests
from typing import Any, Dict, List, Optional

class FuyaoClient:
    def __init__(self, api_key: str, base_url: str = "https://fuyao.aicubes.cn"):
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "X-api-key": api_key,
            "User-Agent": "Fuyao-SDK/1.0"
        }

    def _request(self, method: str, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        response = requests.request(method, url, headers=self.headers, params=params, timeout=15)
        response.raise_for_status()
        
        result = response.json()
        if result.get("code") != 0:
            raise RuntimeError(f"Fuyao API Error [{result.get('code')}]: {result.get('message')} (RequestId: {result.get('request_id')})")
        return result.get("data", {})

    def search_ticker(self, keyword: str, asset_type: str = "a-share") -> List[Dict[str, Any]]:
        """标的消歧搜索"""
        data = self._request("GET", "/api/meta/tickers/search", {"q": keyword, "asset_type": asset_type, "limit": 5})
        return data.get("item", [])

    def get_price_snapshot(self, thscodes: List[str]) -> List[Dict[str, Any]]:
        """批量获取股票实时行情快照"""
        data = self._request("GET", "/api/a-share/prices/snapshot", {"thscodes": ",".join(thscodes)})
        return data.get("item", [])

    def get_historical_kline(self, thscode: str, start_ms: int, end_ms: int, adjust: str = "forward") -> List[Dict[str, Any]]:
        """获取单只股票历史日K线"""
        params = {
            "thscode": thscode,
            "interval": "1d",
            "start": start_ms,
            "end": end_ms,
            "adjust": adjust
        }
        data = self._request("GET", "/api/a-share/prices/historical", params)
        return data.get("item", [])

    def get_income_statements(self, thscode: str, limit: int = 4, period: str = "quarterly") -> List[Dict[str, Any]]:
        """获取财务利润表多期数据"""
        data = self._request("GET", "/api/a-share/financials/income-statements", {
            "thscode": thscode,
            "period": period,
            "limit": limit
        })
        return data.get("item", [])

if __name__ == "__main__":
    CLIENT = FuyaoClient(api_key="your_secret_api_key_here")
    
    # 1. 查找贵州茅台代码
    tickers = CLIENT.search_ticker("贵州茅台")
    if tickers:
        thscode = tickers[0]["thscode"]
        print(f"找到标的: {tickers[0]['name']} -> {thscode}")

        # 2. 查询实时快照
        quotes = CLIENT.get_price_snapshot([thscode, "000001.SZ"])
        print("行情快照:", quotes)

        # 3. 读取近 4 期财报利润表
        financials = CLIENT.get_income_statements(thscode, limit=4)
        for item in financials:
            print(f"报告期: {item['fiscal_year']} {item['fiscal_period']}, 营收: {item['operating_income']}, 归母净利: {item['parent_holder_net_profit']}")
```

### 10.2 cURL 终端调用速查
```bash
# 1. 标的检索消歧
curl 'https://fuyao.aicubes.cn/api/meta/tickers/search?q=贵州茅台&limit=5' \
  -H 'X-api-key: your-api-key'

# 2. 批量股票行情快照
curl 'https://fuyao.aicubes.cn/api/a-share/prices/snapshot?thscodes=600519.SH,000001.SZ' \
  -H 'X-api-key: your-api-key'

# 3. 单股历史日K线（前复权，近1年）
curl 'https://fuyao.aicubes.cn/api/a-share/prices/historical?thscode=600519.SH&interval=1d&start=1716105600000&end=1747641600000&adjust=forward' \
  -H 'X-api-key: your-api-key'

# 4. 今日涨停股票池（按涨停时间升序）
curl 'https://fuyao.aicubes.cn/api/a-share/special-data/limit-up-pool?page=1&size=50&sort_field=limit_up_time&sort_dir=asc' \
  -H 'X-api-key: your-api-key'

# 5. 指数成分股清单（沪深300）
curl 'https://fuyao.aicubes.cn/api/a-share-index/constituents/ths-stock-list?thscode=000300.SH' \
  -H 'X-api-key: your-api-key'

# 6. ETF行情快照
curl 'https://fuyao.aicubes.cn/api/fund/market/snapshot?thscodes=510300.SH,159919.SZ' \
  -H 'X-api-key: your-api-key'
```

---

## 11. 开发者最佳实践与避坑指南

1. **切勿自行拼接市场后缀**：
   A 股存在北交所（`.BJ`）、科创板（`.SH`）、创业板（`.SZ`），且同代码在指数与个股间可能重叠。**严禁通过纯数字拼接交易所**，必须使用 `/api/meta/tickers/search` 消歧后再请求业务数据。
2. **避免大批量长周期 K 线的逐只轮询**：
   全市场约 5000+ 只股票，若使用循环调用 `prices/historical` 将触发严重的 QPS 限流（`code: 4001`）。如需全市场离线回测或数年深度计算，请优先调用 `/api/dump/market-dumps/*` 下载 Parquet 文件本地加载。
3. **财报对齐遵循披露日原则**：
   财务序列中的 `period_end_ms` 是账期结束日（例如 12 月 31 日），但实际投资回测或事实归因必须使用 `report_date_ms`（财报实际公告披露日），以防发生前瞻偏差（Look-ahead Bias）。
4. **空数据语义处理**：
   接口字段缺失时返回 `null`，开发时**不可直接强转为 `0`**（例如封单额为 `0` 与未封板/无数据语义完全不同；财报同比指标为 `null` 代表未披露或基期为负）。
5. **安全与密钥凭据隔离**：
   严禁将 `X-api-key` 写入单文件 HTML 或静态前端客户端代码中，建议通过后端反向代理或环境变量注入。