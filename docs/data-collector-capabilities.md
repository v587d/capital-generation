# data_collector 能力总表

> 本表由 `npm run docs:capabilities` 从 Fuyao、Tencent、Eastmoney 与 Wind source 定义生成，并由 `test/data-collector-capabilities.test.mjs` 断言与实现同步：新增端点若忘了重新生成，测试会失败。

当前共 **94 个 capability**：同花顺 Fuyao 61 个，腾讯公开 HTTP 9 个，东方财富 HTTP 21 个，Wind 金融数据服务 3 个。参数后带 **\*** 表示必填。

**复核方式**：Fuyao 能力可用 `npm run smoke:fuyao` 真实复核；Tencent 能力使用最小 smoke fixture 或按需真实请求复核；Eastmoney 能力使用固定 fixture，并按需执行公开网页 JSON smoke；Wind 能力用 `npm run smoke:wind` 真实复核（需要 `WIND_API_KEY`，**按次消耗上游积分**）。

## 怎么用

data_collector 是唯一持有结构化行情/财务数据入口的子 Agent，主 Agent 与用户都不直接接触原始数据：

1. 主 Agent 通过 `subagent_data_collector` 委派需求（只传需求与参数，不传原始数据）。
2. data_collector 按问题涉及的事实选能力，不设单回合数量上限；先调一次 `list_capabilities` 取回精简目录（一行一条 `capability|summary|paginated`），再逐个 `describe_capability` 核对 `input_schema` 与返回字段的逐行字典 `output_fields`，用 `request_data` 逐份取数。
3. 宿主把上游原始数据**立即持久化**为不可变 Dataset（workspace 内、默认保留 7 天）；每份 DatasetRef（含缓存命中、分页的每页）由 collector 立即通知主 Agent，全部请求结束另发终结消息。原始行永不进入任何 Agent 的上下文；主 Agent 可在取下一份期间把已到的数据交给 data_junior。
4. 需要看数据内容或基础统计时，由兄弟子 Agent `data_junior` 用 `describe_dataset` 完成 profile 与受控 query，回传 `profile_ref`。

## 通用约定

- **代码必须带市场后缀**：A 股 `600519.SH`、指数 `000300.SH` 或 `886042.TI`、基金 `025480.OF` 或 `510300.SH`。禁止自行拼接后缀，先用 `ticker_search` 消歧。
- **时间戳**统一为毫秒级 Unix 时间戳（`Asia/Shanghai`）；日期字符串统一 `yyyy-MM-dd`。
- **百分比口径不统一，引用前必须看 `describe_capability` 详情**：行情/财务/持仓类多为「百分数原值」（`8.88` 表示 8.88%），但龙虎榜的 `change` / `net_rate` 是小数形式，基金回测 `metrics` 的口径文档自相矛盾。
- **Wind 来源按次计费**：Wind 那三条（宏观/行业/汇率 EDB 与按区间取的 K 线）每次真实取数都消耗上游积分，凭据缺失、限流与后端错误一律不自动重试；同一请求在缓存新鲜度内复用已落盘的 Dataset（宏观 6 小时、K 线 1 分钟）。
- **Wind 的参数面按真报文逐档放开**（未验不注册在这里同样生效）：`wind_stock_kline` 的 `adjust` 只给 `none`/`qfq`——后复权实测是"以 afdate 为锚向未来放大"，锚取当日时历史逐位等于不复权（名字骗人），故拒绝；`period` 只放打过真报文的七档（1/5/15/30 分钟与日/周/月，60 分钟两次都挂到超时）；`count` 与 EDB 的 `observation`（"取最近 N 期"）实测语义与上游返回不一致，都不提供，只按日期区间取。
- **`null` 一律不补零**：上游用 `null` 表示未披露或无数据，语义与 `0` 不同。
- **金额单位多处文档未给出**（尤其基金各页），一律按原值转述，不擅自换算。
- 参数在**入队前**完成规范化与校验（大小写、空白、逗号列表去重、区间/互斥/枚举），失败即本地报错，不发请求、不落盘。
- 每个端点的完整说明（单位、可空性、时间与分页口径、已知上游缺口）都在 `describe_capability` 返回的 `description` 里。

## 不在覆盖范围

| 模块 | 原因 |
|---|---|
| A 股主力资金 `capital-flow/*` | 上游返回 `code=2004`：同花顺 AI 客户端专用，未开放外部接入 |
| 高频动向 `high-frequency/*` | 同上（`code=2004`） |
| 全市场 Parquet 导出 `dump/market-dumps/*` | 预签名链接 + Parquet 二进制，需独立的下载/落盘链路，本阶段不接入 |
| 期货 `futures/*`、期权 `options/*` | 与本 preset 的产品定位不符（角色边界只覆盖股票/指数/基金），共 30 个端点主动排除。**注意**：`ticker_search` / `ticker_list` 仍可按官方契约检索 `futures` / `options` 代码（元数据域全量放开），但本 preset 不提供它们的行情/财务数据端点 |
| 基金新闻 `fund/news/article-list` | 非结构化内容，已由 `web_retriever` 的检索能力覆盖 |
| Wind 的自然语言工具（选股 / 档案 / 财务 / 事件 / 风险，bond 域与 `analytics_data` 同类） | 返回哪些列**由 `question` 的措辞决定**，同一问法换个说法就换一套列——输出契约无处锚定，护栏等于没有。数值需求走 `wind_edb_search` / `wind_edb_query` / `wind_stock_kline`，公告与新闻正文才用 NL 工具（在 `web_retriever` 的 `wind_docs_*`） |
| Wind 行情指标截面 `get_stock_price_indicators` | 中文键快照，腾讯与东财同位能力已覆盖；`indexes` 没有可核对的指标集文档，口径无法验 |
| Wind 基金 / 指数 / 债券 server 与 `analytics_data` | 与 Fuyao 重叠且未打真报文；`analytics_data` 实测连 `initialize` 都超时（不可用），不得用它伪装其他覆盖 |

## 元数据（代码表与消歧）

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `ticker_search` | `/api/meta/tickers/search` | `q`\* `exchange` `asset_type` `limit` | 否 | 名称或代码检索消歧为完整 thscode |
| `ticker_list` | `/api/meta/tickers/list` | `asset_type` `limit` `offset` | 是 | 按资产类型分页拉取标的代码表 |

## A 股行情与公司行为

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `quote` | `/api/a-share/prices/snapshot` | `thscodes` `limit` `offset` | 是 | A 股行情快照（指定标的或全市场分页） |
| `history` | `/api/a-share/prices/historical` | `thscode`\* `interval`\* `start`\* `end`\* `adjust` `offset` | 是 | 单只标的日 K 线（可复权，窗口 ≤10 年） |
| `trading_calendar` | `/api/a-share/calendar/trading-days` | 无参数 | 否 | 近一年 A 股交易日历 |
| `corporate_actions` | `/api/a-share/corporate-actions/adjustment-factors` | `thscode`\* `from` `to` | 否 | 单只标的除复权事件流（分红/送转） |

## A 股财务

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `income_statement` | `/api/a-share/financials/income-statements` | `thscode`\* `period`\* `limit` `start` `end` | 否 | 合并利润表多期序列 |
| `balance_sheet` | `/api/a-share/financials/balance-sheets` | `thscode`\* `period`\* `limit` `start` `end` | 否 | 合并资产负债表多期序列 |
| `cash_flow` | `/api/a-share/financials/cash-flow-statements` | `thscode`\* `period`\* `limit` `start` `end` | 否 | 合并现金流量表多期序列 |
| `financial_indicators` | `/api/a-share/financials/indicators` | `thscode`\* `report`\* | 否 | 单期五类财务指标（成长/盈利/偿债/营运/现金流） |

## 估值与集合竞价

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `valuation` | `/api/a-share/valuations/snapshot` | `thscodes`\* | 否 | 批量估值快照（PE/PB/PS/PCF） |
| `auction` | `/api/a-share/auction/snapshot` | `thscodes`\* `stage` | 否 | 集合竞价快照（实时盘口或终态） |
| `auction_benchmark` | `/api/a-share/auction/short-term-benchmark` | `date` | 否 | 短线风向标竞价基准（带标签的精选池） |

## 盘面特色数据

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `limit_up_pool` | `/api/a-share/special-data/limit-up-pool` | `date_ms` `page` `size` `sort_field` `sort_dir` | 是 | 按交易日分页的涨停/连板股票池 |
| `limit_up_ladder` | `/api/a-share/special-data/limit-up-ladder` | 无参数 | 否 | 近 30 日连板天梯矩阵 |
| `limit_down_pool` | `/api/a-share/special-data/limit-down-pool` | `date_ms` `page` `size` `sort_field` `sort_dir` | 是 | 按交易日分页的跌停股票池 |
| `limit_break_pool` | `/api/a-share/special-data/limit-break-pool` | `date_ms` `page` `size` `sort_field` `sort_dir` | 是 | 按交易日分页的炸板（涨停破板）股票池 |
| `skyrocket_list` | `/api/a-share/special-data/skyrocket-list` | `period` | 否 | A 股热度飙升榜 Top30（日榜/小时榜） |
| `hot_stock_list` | `/api/a-share/special-data/hot-stock-list` | `period` | 否 | A 股热股榜 Top30（24 小时/小时级） |
| `hot_stock_history` | `/api/a-share/special-data/hot-stock-list-history` | `date`\* | 否 | 按自然日的历史热股榜排行（最多 30 条） |
| `hot_stock_rank_trend` | `/api/a-share/special-data/hot-stock-rank-trend` | `thscode`\* `start_date`\* `end_date`\* | 否 | 单只 A 股的热榜排名走势（日线点位） |
| `anomaly_list` | `/api/a-share/special-data/anomaly-analysis-list` | `tag_codes` | 否 | 当日个股异动原因列表（可按标签过滤） |
| `anomaly_stock` | `/api/a-share/special-data/anomaly-analysis-stock` | `thscodes`\* | 否 | 按股票批量查询当日异动原因 |
| `dragon_tiger` | `/api/a-share/special-data/dragon-tiger-list` | `board_type` `date` | 否 | A 股龙虎榜（全部/机构榜/游资榜，不分页） |

## 指数

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `index_catalog` | `/api/a-share-index/catalog/ths-index-list` | `tag` | 否 | 同花顺指数目录（概念/区域/特色/行业） |
| `index_constituents` | `/api/a-share-index/constituents/ths-stock-list` | `thscode`\* | 否 | 单个指数的成分股清单 |
| `index_quote` | `/api/a-share-index/prices/snapshot` | `thscodes`\* | 否 | 指数行情快照（批量） |
| `index_history` | `/api/a-share-index/prices/historical` | `thscode`\* `interval`\* `start`\* `end`\* | 否 | 单只指数日 K 线（窗口 ≤10 年） |

## 基金 · 基本资料与场内行情

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `fund_profile` | `/api/fund/profile/detail` | `thscode`\* | 否 | 基金基本资料（规模/净值/经理/费率） |
| `fund_quote` | `/api/fund/market/snapshot` | `thscode`\* | 否 | 场内基金（ETF）行情快照 |
| `fund_history` | `/api/fund/market/historical` | `thscode`\* `interval` `start`\* `end`\* | 否 | 场内基金（ETF）历史日 K 线 |

## 基金 · 业绩与净值

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `fund_nav` | `/api/fund/performance/nav` | `thscode`\* `range` `nav_type` | 否 | 基金历史净值（单位/复权，按区间） |
| `fund_returns` | `/api/fund/performance/returns` | `thscode`\* | 否 | 基金阶段收益与同类排名 |
| `fund_drawdowns` | `/api/fund/performance/drawdowns` | `thscode`\* | 否 | 基金各区间最大回撤 |
| `fund_performance_history` | `/api/fund/performance/indicators-historical` | `thscode`\* `start`\* `end`\* | 否 | 基金净值指标历史（RSI/唐奇安/估值分位） |

## 基金 · 持仓与配置

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `fund_holdings` | `/api/fund/portfolio/holdings` | `thscode`\* | 否 | 基金重仓持仓（定期披露，非实时） |
| `fund_asset_allocation` | `/api/fund/portfolio/asset-allocation` | `thscode`\* | 否 | 基金资产配置比例（按报告期） |
| `fund_industry_allocation` | `/api/fund/portfolio/industry-allocation` | `thscode`\* | 否 | 基金行业配置比例（按报告期） |
| `fund_stock_history` | `/api/fund/portfolio/stock-history` | `thscode`\* `report_type`\* `end_date`\* | 否 | 基金历史股票持仓（按报告期与截止日） |
| `fund_bond_history` | `/api/fund/portfolio/bond-history` | `thscode`\* `report_type`\* `end_date`\* | 否 | 基金历史债券持仓（按报告期） |
| `fund_stock_report_dates` | `/api/fund/portfolio/stock-report-dates` | `thscode`\* `report_type` | 否 | 基金股票持仓的可用报告期清单 |
| `fund_bond_report_dates` | `/api/fund/portfolio/bond-report-dates` | `thscode`\* `report_type` | 否 | 基金债券持仓的可用报告期清单 |

## 基金 · 持有人与管理人

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `fund_holders` | `/api/fund/holders/detail` | `thscode`\* `merge_scope` | 否 | 基金持有人结构（机构/个人/员工占比） |
| `fund_top_holders` | `/api/fund/holders/top` | `thscode`\* `limit` | 否 | 基金前十大持有人（含多报告期） |
| `fund_manager` | `/api/fund/managers/detail` | `manager_id`\* | 否 | 基金经理详情（履历/年化/雷达对比） |
| `fund_company` | `/api/fund/companies/detail` | `company_id`\* | 否 | 基金公司详情（规模/基金只数） |
| `fund_manager_experience` | `/api/fund/managers/experience` | `manager_id`\* | 否 | 基金经理获奖、重仓与从业经历 |
| `fund_manager_style` | `/api/fund/managers/investment-style` | `manager_id`\* | 否 | 基金经理投资风格（理念/行业偏好） |
| `fund_manager_performance` | `/api/fund/managers/performance` | `manager_id`\* `range`\* | 否 | 基金经理区间收益与同类/基准对比 |

## 基金 · 财务、指标与诊断

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `fund_income` | `/api/fund/financials/income-statements` | `thscode`\* | 否 | 基金利润表（按报告期） |
| `fund_balance` | `/api/fund/financials/balance-sheets` | `thscode`\* | 否 | 基金资产负债表（按报告期） |
| `fund_financial_indicators` | `/api/fund/financials/indicators` | `thscode`\* | 否 | 基金财务指标（净值/利润/增长率） |
| `fund_indicator_line` | `/api/fund/indicators/line` | `indexes`\* `time_range`\* | 否 | 基金指标画线序列（多指标多标的） |
| `fund_indicator_table` | `/api/fund/indicators/table` | `code_selectors` `indexes` `page_info` `sort` | 是 | 基金指标表格查询（分页/排序） |
| `fund_diagnostics` | `/api/fund/diagnostics/detail` | `thscode`\* | 否 | 基金诊断（多维画像与同类对比） |

## 基金 · 分红、募集与额度

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `fund_dividends` | `/api/fund/corporate-actions/dividends` | `thscode`\* | 否 | 基金分红记录（每 10 份口径） |
| `fund_offerings` | `/api/fund/offerings/list` | `subscribe`\* | 否 | 基金募集列表（当前/即将募集） |
| `fund_quota_list` | `/api/fund/quota/list` | `tab`\* `buy` | 否 | QDII 额度分类与基金明细（三层嵌套） |
| `fund_quota_summary` | `/api/fund/quota/summary` | `tab`\* | 否 | QDII 额度分类汇总 |

## 基金 · 在线回测

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `fund_backtest` | `/api/fund/backtest/result` | `thscode`\* `buy_conditions`\* `sell_conditions`\* `buy_frequency_type`\* `max_buy_times`\* `per_buy_amount`\* | 否 | 基金在线回测（策略/基准/曲线） |
| `fund_backtest_indicators` | `/api/fund/backtest/indicators` | 无参数 | 否 | 回测可用指标清单（无参数） |

## 腾讯公开 HTTP（fallback）

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `tencent_quote` | `/tencent/quote` | `codes`\* | 否 | 腾讯实时行情、估值、涨跌停和 ETF 快照 |
| `tencent_kline` | `/tencent/kline` | `code`\* `period` `adjust` `start` `end` `count` | 否 | 腾讯日周月复权和分钟 K 线 |
| `tencent_ticks` | `/tencent/ticks` | `code`\* | 否 | 腾讯最近交易日分笔成交明细 |
| `tencent_hk_quote` | `/tencent/hk_quote` | `codes`\* | 否 | 腾讯港股实时快照（港元，无涨跌停） |
| `tencent_us_quote` | `/tencent/us_quote` | `codes`\* | 否 | 腾讯美股快照（美元，交易所当地时间） |
| `tencent_hk_index_quote` | `/tencent/hk_index_quote` | `codes`\* | 否 | 腾讯港股指数实时点位（无量纲，不含成交与市值） |
| `tencent_us_index_quote` | `/tencent/us_index_quote` | `codes`\* | 否 | 腾讯美股指数点位（无量纲，收盘值为真值） |
| `tencent_hk_kline` | `/tencent/hk_kline` | `code`\* `period` `adjust` `count` | 否 | 腾讯港股日周月 K 线（成交量以股计） |
| `tencent_us_kline` | `/tencent/us_kline` | `code`\* `period` `adjust` `count` | 否 | 腾讯美股日周月 K 线（前复权或不复权） |

## 东方财富 HTTP（沪深港通）

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `eastmoney_mutual_flow` | `/eastmoney/mutual_flow` | `start_date`\* `end_date`\* `channel` `page` `size` | 是 | 沪深港通成交额与额度状态（按渠道日频） |
| `eastmoney_mutual_quota` | `/eastmoney/mutual_quota` | 无参数 | 否 | 北上南下当日额度与休市状态快照 |

## 东方财富 HTTP（宏观指标）

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `eastmoney_cpi` | `/eastmoney/cpi` | `start_date`\* `end_date`\* `page` `size` | 是 | CPI 居民消费价格指数（月度，全国/城市/农村） |
| `eastmoney_ppi` | `/eastmoney/ppi` | `start_date`\* `end_date`\* `page` `size` | 是 | PPI 工业生产者出厂价格指数（月度） |
| `eastmoney_gdp` | `/eastmoney/gdp` | `start_date`\* `end_date`\* `page` `size` | 是 | GDP 国内生产总值与三次产业（季度累计） |
| `eastmoney_pmi` | `/eastmoney/pmi` | `start_date`\* `end_date`\* `page` `size` | 是 | PMI 采购经理人指数（制造业与非制造业） |
| `eastmoney_money_supply` | `/eastmoney/money_supply` | `start_date`\* `end_date`\* `page` `size` | 是 | M0/M1/M2 货币供应量（月度） |
| `eastmoney_rmb_loan` | `/eastmoney/rmb_loan` | `start_date`\* `end_date`\* `page` `size` | 是 | 新增人民币贷款（月度，含负值） |
| `eastmoney_customs_trade` | `/eastmoney/customs_trade` | `start_date`\* `end_date`\* `page` `size` | 是 | 海关进出口金额与同比环比（月度） |
| `eastmoney_retail_sales` | `/eastmoney/retail_sales` | `start_date`\* `end_date`\* `page` `size` | 是 | 社会消费品零售总额（月度） |
| `eastmoney_deposit_reserve` | `/eastmoney/deposit_reserve` | `start_date`\* `end_date`\* `page` `size` | 是 | 存款准备金率调整事件（历次） |

## 东方财富 HTTP（资金与筹码）

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `eastmoney_top_buy_sell_market` | `/eastmoney/top_buy_sell_market` | `start_date`\* `end_date`\* `page` `size` | 是 | 东财全市场龙虎榜汇总 |
| `eastmoney_top_buy_sell_ticker` | `/eastmoney/top_buy_sell_ticker` | `ticker`\* `start_date`\* `end_date`\* `page` `size` | 是 | 东财单票龙虎榜汇总 |
| `eastmoney_lockup_expiry` | `/eastmoney/lockup_expiry` | `start_date`\* `end_date`\* `page` `size` | 是 | 东财限售解禁日历 |
| `eastmoney_sector_rotation` | `/eastmoney/sector_rotation` | `board_type` `sort_field` `page` `size` | 是 | 东财板块行情排名快照 |
| `eastmoney_cashflow_rotation` | `/eastmoney/cashflow_rotation` | `board_type` `page` `size` | 是 | 东财板块资金流快照 |
| `eastmoney_main_capital_snapshot` | `/eastmoney/main_capital_snapshot` | `ticker` `sort_field` `sort_order` `page` `size` | 是 | 东财个股主力资金快照（仅最近交易日） |
| `eastmoney_dividend_plan` | `/eastmoney/dividend_plan` | `ticker`\* `start_date`\* `end_date`\* `page` `size` | 是 | 东财分红送配方案明细（按个股与除权日） |
| `eastmoney_holder_number_snapshot` | `/eastmoney/holder_number_snapshot` | `ticker` `sort_field` `sort_order` `page` `size` | 是 | 东财股东户数最新一期截面 |
| `eastmoney_margin_trading` | `/eastmoney/margin_trading` | `ticker`\* `start_date`\* `end_date`\* `page` `size` | 是 | 个股融资融券明细（按票与交易日） |
| `eastmoney_convertible_bond_list` | `/eastmoney/convertible_bond_list` | `start_date`\* `end_date`\* `bond_code` `stock_code` `page` `size` | 是 | 东财可转债发行清单与条款要素（按起息日） |

## Wind 金融数据服务（MCP）

| capability | 端点 | 主要参数 | 分页 | 用途 |
|---|---|---|---|---|
| `wind_edb_search` | `/wind/edb_search` | `question`\* | 否 | Wind EDB 宏观/行业/汇率指标检索（只找码不取数） |
| `wind_edb_query` | `/wind/edb_query` | `indicator`\* `start_date`\* `end_date`\* | 否 | Wind EDB 指标时间序列（宏观/行业/汇率，按日期区间） |
| `wind_stock_kline` | `/wind/stock_kline` | `code`\* `start_date`\* `end_date`\* `period` `adjust` | 否 | Wind 日周月与 1–30 分钟 K 线（按日期区间，A股+港股+美股） |
