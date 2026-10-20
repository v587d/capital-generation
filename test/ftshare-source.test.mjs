// Offline FTShare source regression: fixtures are verbatim live payloads and assertions pin only
// shapes seen in those payloads plus how producers must fail. Filters can fail silently upstream
// (0 rows, no error), so filtered requests re-check identity and date.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFtshareSources, createFtshareClient, FtshareError, FTSHARE_MIN_INTERVAL_MS } from '../lib/sources/ftshare-rest.js'

const BASE = 'https://market.ft.tech/gateway'
const FT_CAPABILITIES = [
  'ftshare_stock_daily_flow', 'ftshare_industry_daily_flow', 'ftshare_concept_daily_flow', 'ftshare_main_capital_flow',
  'ftshare_ashare_quote', 'ftshare_market_breadth', 'ftshare_daily_kline_snapshot', 'ftshare_prev_close', 'ftshare_trading_calendar',
  'ftshare_block_trades', 'ftshare_performance_forecast', 'ftshare_performance_express',
  'ftshare_sw_industry_overview', 'ftshare_sw_industry_metrics',
  'ftshare_limit_price', 'ftshare_dragon_tiger_seats', 'ftshare_holder_number', 'ftshare_index_weight', 'ftshare_convertible_bond_kline',
  'ftshare_lpr', 'ftshare_chinabond_yield', 'ftshare_shibor', 'ftshare_hibor', 'ftshare_financial_calendar',
  'ftshare_futures_contracts', 'ftshare_futures_contract_detail', 'ftshare_futures_kline', 'ftshare_futures_limit_price',
  'ftshare_futures_settle', 'ftshare_futures_warrant', 'ftshare_futures_weekly', 'ftshare_futures_index_kline',
  'ftshare_futures_member_rank', 'ftshare_bullion_price',
]
// Capabilities that actually page upstream; snapshots return one row per call.
const PAGED = [
  'ftshare_stock_daily_flow', 'ftshare_industry_daily_flow', 'ftshare_concept_daily_flow', 'ftshare_main_capital_flow', 'ftshare_ashare_quote', 'ftshare_daily_kline_snapshot',
  'ftshare_block_trades', 'ftshare_performance_forecast', 'ftshare_performance_express', 'ftshare_sw_industry_overview', 'ftshare_sw_industry_metrics',
  'ftshare_limit_price', 'ftshare_dragon_tiger_seats', 'ftshare_holder_number', 'ftshare_index_weight',
  'ftshare_chinabond_yield', 'ftshare_shibor', 'ftshare_hibor', 'ftshare_financial_calendar',
  // Futures list/detail ignore paging; the other futures capabilities page.
  'ftshare_futures_limit_price', 'ftshare_futures_settle', 'ftshare_futures_warrant', 'ftshare_futures_weekly',
  'ftshare_futures_index_kline', 'ftshare_futures_member_rank', 'ftshare_bullion_price',
]

function request(capability, params = {}) {
  return { capability, params, session: { id: 'session-1', header: { cwd: '/workspace/proj' } } }
}

const STOCK_FLOW_ROW = { code: '600519', name: '贵州茅台', trade_date: '2026-10-14', close_price: 1286, change_pct: 0.87, turnover_pct: 0.19, inflow: 18.76, outflow: 11.69, net_amount: 7.07, turnover_amount: 30.46 }
// Main-capital tiers: values are strings, identity carries a suffix, time is nanoseconds.
const MAIN_CAPITAL_ROW = { net_inflow_extra_large: '153016124.85', net_inflow_large: '201583302.13', net_inflow_main: '354599426.98', net_inflow_medium: '-59039404.45', net_inflow_small: '-295560022.53', symbol: '601857.SH', symbol_name: '中国石油', ts_nanos: 1791963000000000000 }
// Quote row: prices/amounts are strings, volume integer, change is a ratio.
const QUOTE_ROW = { amplitude: 0.022608695652173893, avg: 11.375433141201, bid_ask_ratio: 0.20918754068008172, board: 'XsheMain', change: '-0.09', change_rate: -0.007826086956521738, change_rate_day5: -0.031409168081494056, change_rate_day10: 0.005197779931283586, change_rate_day20: -0.0035804733211073267, change_rate_day60: 0.07732980832782552, change_rate_day120: 0.08863658047896193, change_rate_ytd: 0.04765402626021486, close: '11.41', float_a_shares: 19405684991, high: '11.52', listing_date: '1991-04-03', low: '11.26', market_cap: '221421526639.18', name: '平安银行', open: '11.5', pe_ttm: 5.1351, prev_close: '11.5', shares: 19405918198, st: false, status: 'Normal', symbol: '000001.SZ', symbol_id: '000001', tradable_a_market_cap: '221418865747.31', ts_millis: 1792053003000, turnover: '1719700511.61', turnover_rate: 0.007790330826771277, volume: 151176706 }
// Beijing exchange quote: Tencent rejects BJ, so this family is the second source.
const QUOTE_BJ_ROW = { amplitude: 0.039759939984996336, avg: 13.017701960804654, bid_ask_ratio: 0.6898721091650176, board: 'Bjse', change: '-0.35', change_rate: -0.026256564141035256, change_rate_day5: -0.06618705035971223, change_rate_day10: -0.08720112517580872, change_rate_day20: -0.0935754189944134, change_rate_day60: 0.1238095238095238, change_rate_day120: -0.17587301587301588, change_rate_ytd: -0.3257142857142857, close: '12.98', float_a_shares: 57593925, high: '13.3', listing_date: '2020-12-23', low: '12.77', market_cap: '1190006400', name: '安徽凤凰', open: '13.01', pe_ttm: 19.9163, prev_close: '13.33', shares: 91680000, st: false, status: 'Normal', symbol: '920000.BJ', symbol_id: '920000', tradable_a_market_cap: '747569146.5', ts_millis: 1792047602000, turnover: '5019717', turnover_rate: 0.006695272114203017, volume: 385607 }
const QUOTE_SUSPENDED_ROW = { amplitude: 0, avg: 0, bid_ask_ratio: 0, board: 'XsheMain', change: '0', change_rate: 0, change_rate_day5: 0.004081632653061224, change_rate_day10: 0.025, change_rate_day20: -0.042801556420233464, change_rate_day60: -0.22641509433962262, change_rate_day120: -0.3050847457627119, change_rate_ytd: -0.5119047619047619, close: '2.46', float_a_shares: 1596593800, high: null, listing_date: '1992-03-27', low: null, market_cap: '5923545703.68', name: '*ST康佳A', open: null, pe_ttm: null, prev_close: '2.46', shares: 2407945408, st: true, status: 'Suspended', symbol: '000016.SZ', symbol_id: '000016', tradable_a_market_cap: '3927620748', ts_millis: 1792053006000, turnover: '0', turnover_rate: 0, volume: 0 }
const KLINE_ROW = { trade_code: '000001.SZ', close: '11.5000', high: '11.7200', low: '11.4800', open: '11.5700', ts_millis: 1791961200000, ts_millis_open: 1791941400000, turnover: '1122283852.2300', volume: 96908192, turnover_rate: 0.004993804240610122 }
// data is the array itself; values are strings and rows carry no identity column.
const PREV_CLOSE_ROWS = [{ date: '2026-10-08', prev_close: '1258.62' }, { date: '2026-10-09', prev_close: '1255.79' }]
const BREADTH_ENVELOPE = { code: 200, message: 'success', data: {
  change_rate: 0,
  distribution: { flat: 38, down_0pct_to_1pct: 338, down_1pct_to_5pct: 3934, down_5pct_to_limited: 810, down_limited: 26, up_0pct_to_1pct: 157, up_1pct_to_5pct: 197, up_5pct_to_limited: 38, up_limited: 36 },
  prev_turnover: '0', status: 'closed', turnover: '1642255033207.72', volume: 106667826175,
} }
// trade_dates are numbers, and the range endpoints are echoed back.
const CALENDAR_ENVELOPE = { code: 200, message: 'success', data: { market: 'cn', start_date: 20261008, end_date: 20261014, trade_dates: [20261008, 20261009, 20261012, 20261013, 20261014] } }

const BLOCK_ROW = { buyer_name: '平安证券股份有限公司广州体育东路证券营业部', close: '1.13', date: '2026-10-13', name: '金科股份', premium_rate: -0.08849558, price: '1.03', seller_name: '国海证券股份有限公司四川分公司', symbol: '000656.SZ', volume: 500000 }
// Forecast: every value is a string except year; unit is passed through as given.
const FORECAST_ROW = { stock_code: '000001.SZ', stock_name: '平安银行', year: 2015, report_type: 'annual', report_type_cn: '年报', forecast_subject: '归属于上市公司股东的净利润', forecast_type: '略增', forecast_value_min: '20792060000', forecast_value_max: '22772250000', unit: '元', yoy_change_min: '5', yoy_change_max: '15', last_year_value: '19801960000', publish_date: '2016-01-21' }
// Missing-value encoding: min/max are 0 while yoy has a value.
const FORECAST_ZERO_ROW = { stock_code: '603369.SH', stock_name: '今世缘', year: 2025, report_type: 'annual', report_type_cn: '年报', forecast_subject: '营业收入', forecast_type: '预减', forecast_value_min: '0', forecast_value_max: '0', unit: '元', yoy_change_min: '5', yoy_change_max: '12', last_year_value: '11545705180.80', publish_date: '2025-04-30' }
const EXPRESS_ROW = { stock_code: '000001.SZ', stock_name: '平安银行', year: 2022, report_type: 'annual', report_type_cn: '年报', eps: '2.2000', total_revenue: '179895000000.0000', total_revenue_prev: '169383000000.0000', total_revenue_yoy: '6.2061', net_profit: '45516000000.0000', net_profit_prev: '36336000000.0000', net_profit_yoy: '25.2642', sh_netassets_ps: '22.3993', roe: '10.4712', publish_date: '2023-01-17' }
// Negative prior period: the formula gives -193.3661, upstream sends +193.3661; pass through signed.
const EXPRESS_LOSS_ROW = { stock_code: '688184.SH', stock_name: 'ST帕瓦', year: 2024, report_type: 'annual', report_type_cn: '年报', eps: '-4.5800', total_revenue: '948566000.0000', total_revenue_prev: '954269900.0000', total_revenue_yoy: '-0.5977', net_profit: '-726501500.0000', net_profit_prev: '-247643300.0000', net_profit_yoy: '193.3661', sh_netassets_ps: '12.6000', roe: '-35.7677', publish_date: '2025-04-30' }
// Shenwan overview: percentiles are percentages, not ratios.
const SW_OVERVIEW_ROW = { industryCode: '801010.SI', industryName: '农林牧渔', level: 1, parentIndustryName: null, constituentCount: '104', tradeDate: '2026-10-14', lyrPe: '30.380000', lyrPePercentile: '45.980000', ttmPe: '32.150000', ttmPePercentile: '52.870000', pb: '1.930000', pbPercentile: '7.980000', dvRatio: '2.260000', dvRatioPercentile: '92.190000' }
// totalMv is in 10k yuan and amount in 1k yuan (converted to yuan); quantiles are ratios.
const SW_METRICS_ROW = { industryCode: '801010.SI', industryName: '农林牧渔', tradeDate: '2026-08-03', lyrPe: '63.080000', lyrPeQuantile: '0.408890', ttmPe: '53.330000', ttmPeQuantile: '0.250720', pb: '4.710000', pbQuantile: '0.642820', dvRatio: '1.870000', dvRatioQuantile: '0.929780', dvTtm: '1.780000', dvTtmQuantile: '0.896390', addLyrPe: '22.500000', addLyrPeQuantile: '0.096160', addTtmPe: '28.240000', addTtmPeQuantile: '0.436750', addPb: '2.100000', addPbQuantile: '0.101890', addDvRatio: '2.310000', addDvTtm: '2.280000', turnoverRate: '2.220000', turnoverRateF: '3.600000', addTurnoverRate: '1.850000', addTurnoverRateF: '3.040000', turnoverRateFQuantile: '0.393440', totalMv: '119507651.490', closePrice: '10.790000', addClose: '21.530000', middleLyrPe: '42.280000', middleLyrPeQuantile: '0.300130', middleTtmPe: '34.500000', middleTtmPeQuantile: '0.180690', middlePb: '2.260000', middlePbQuantile: '0.175350', belowNetAssetPercent: '5.880000', belowNetAssetCount: '6', totalCount: '102', indexClose: '2428.200000', amount: '16234778.971', amountCongestion: '0.008100', amountCongestionQuantile: '0.035090' }
const SW_METRICS_NULL_ROW = { industryCode: '801010.SI', industryName: '农林牧渔', tradeDate: '2026-10-14', lyrPe: '62.790000', lyrPeQuantile: null, ttmPe: '59.650000', ttmPeQuantile: null, pb: '5.240000', pbQuantile: null, dvRatio: '1.810000', dvRatioQuantile: '0.918100', dvTtm: '1.720000', dvTtmQuantile: null, addLyrPe: '30.380000', addLyrPeQuantile: '0.459810', addTtmPe: '32.150000', addTtmPeQuantile: '0.528660', addPb: '1.930000', addPbQuantile: '0.079820', addDvRatio: '2.260000', addDvTtm: '2.230000', turnoverRate: '3.380000', turnoverRateF: '5.530000', addTurnoverRate: '2.180000', addTurnoverRateF: '3.510000', turnoverRateFQuantile: '0.747680', totalMv: null, closePrice: null, addClose: null, middleLyrPe: '43.390000', middleLyrPeQuantile: null, middleTtmPe: '44.930000', middleTtmPeQuantile: null, middlePb: '2.360000', middlePbQuantile: null, belowNetAssetPercent: '2.970000', belowNetAssetCount: null, totalCount: null, indexClose: '2528.820000', amount: null, amountCongestion: '0.016000', amountCongestionQuantile: '0.318960' }

const LIMIT_ROW = { down_limit: '9.340000', instrument_type: 'stock', pre_close: '13.330000', trade_date: 20261015, ts_code: '920000.BJ', up_limit: '17.320000' }
// A few rows have both limits null; that is a valid shape, not missing data.
const LIMIT_NULL_ROW = { down_limit: null, instrument_type: 'stock', pre_close: '17.370000', trade_date: 20261015, ts_code: '920162.BJ', up_limit: null }
// Limit prices are not two-decimal: 11.50 x 1.1 is sent as 12.649999.
const LIMIT_ODD_ROW = { down_limit: '10.350000', instrument_type: 'stock', pre_close: '11.500000', trade_date: 20261015, ts_code: '000001.SZ', up_limit: '12.649999' }
const SEAT_ROW = { change_rate: -0.1, close: '4.5', symbol: '600792.SH', top_buyers: [{ buy: '16431904', name: '国泰海通证券股份有限公司总部', net: '-10237621', sell: '26669525' }, { buy: '10506127', name: '高盛（中国）证券有限责任公司上海浦东新区世纪大道证券营业部', net: '-2100599', sell: '12606726' }], top_sellers: [{ buy: '16431904', name: '国泰海通证券股份有限公司总部', net: '-10237621', sell: '26669525' }, { buy: '0', name: '中信证券股份有限公司上海分公司', net: '-6249101', sell: '6249101' }], turnover: '408986899.0000' }
// Investor-class rows: fewer than 5 seats, and buy can exceed turnover.
const SEAT_CLASS_ROW = { change_rate: 0.00451282051282049, close: '48.97', symbol: '600343.SH', top_buyers: [{ buy: '67487960000', name: '机构', net: '1338671100', sell: '66149288900' }, { buy: '45127051700', name: '其他自然人', net: '-236102400', sell: '45363154100' }, { buy: '25657084000', name: '中小投资者', net: '-1093373600', sell: '26750457600' }, { buy: '3656462800', name: '沪股通', net: '-9195100', sell: '3665657900' }], top_sellers: [{ buy: '67487960000', name: '机构', net: '1338671100', sell: '66149288900' }, { buy: '45127051700', name: '其他自然人', net: '-236102400', sell: '45363154100' }, { buy: '25657084000', name: '中小投资者', net: '-1093373600', sell: '26750457600' }, { buy: '3656462800', name: '沪股通', net: '-9195100', sell: '3665657900' }], turnover: '7120896372.22' }
const HOLDER_ROW = { stock_code: '600519.SH', stock_name: '贵州茅台', publish_date: '2026-08-15', report_date: '2026-06-30', holder_num: 296404, holder_num_change_ratio: '21.8972', per_capita_circ_share: '4217.4923', per_capita_share_change_ratio: null, chip_concentration: null, close_price: '1185.49', per_capita_hold_amount: '4999794.9999645416', ten_holder_ratio: '67.6191', ften_holder_ratio: '67.6191' }
const HOLDER_OLD_ROW = { stock_code: '600519.SH', stock_name: '贵州茅台', publish_date: '2002-04-17', report_date: '2001-12-31', holder_num: 46194, holder_num_change_ratio: null, per_capita_circ_share: null, per_capita_share_change_ratio: null, chip_concentration: null, close_price: '0', per_capita_hold_amount: '0', ten_holder_ratio: '72.3079', ften_holder_ratio: null }
// Weight row: percentage string, plus an xlsx download hash the model must not see.
const WEIGHT_ROW = { component_code: '000001', component_name: '平安银行', date: '2026-09-30', index_code: '000300', url_hash: 'e5a11b970350c373a501ef57b6f0bfc97f0d413576336f21c3319133d3357980', weight: '0.453000' }
// data is an array; volume is in bonds (turnover/volume lands within [low, high]).
const CB_ROW = { close: '116.8380', high: '117.5000', low: '116.8010', open: '117.1980', ts_millis: 1786345200000, ts_millis_open: 1786325400000, turnover: '204117771.8300', volume: 1741950 }
const LPR_ROW = { date: '2026-09-20', lpr_1y: '3.0000', lpr_5y: '3.5000' }
// lpr_5y is entirely null before 2019-08-20, where the first non-null quote is 4.8500; 1y still uses the old 4.31.
const LPR_NULL_ROW = { date: '2019-08-19', lpr_1y: '4.3100', lpr_5y: null }
const LPR_5Y_FIRST_ROW = { date: '2019-08-20', lpr_1y: '4.2500', lpr_5y: '4.8500' }
const CHINABOND_GOV_ROW = { curve_name: '中债国债收益率曲线', trade_date: '2026-10-15', y_3m: 1.1618, y_6m: 1.1625, y_1y: 1.1803, y_3y: 1.2694, y_5y: 1.39, y_7y: 1.4866, y_10y: 1.6601, y_30y: 2.07 }
// The note curve's y_30y is always null; early rows leave out tenors that appear only later.
const CHINABOND_NOTE_ROW = { curve_name: '中债中短期票据收益率曲线(AAA)', trade_date: '2026-10-15', y_3m: 1.4322, y_6m: 1.4694, y_1y: 1.4794, y_3y: 1.5965, y_5y: 1.668, y_7y: 1.7807, y_10y: 1.9, y_30y: null }
const CHINABOND_EARLY_ROW = { curve_name: '中债中短期票据收益率曲线(AAA)', trade_date: '2006-12-25', y_3m: 2.97, y_6m: 3.12, y_1y: 3.4, y_3y: null, y_5y: null, y_7y: null, y_10y: null, y_30y: null }
const SHIBOR_ROW = { trade_date: '2026-10-15', on_rate: 1.266, w1: 1.346, w2: 1.3493, m1: 1.4111, m3: 1.43, m6: 1.4478, m9: 1.463, y1: 1.474 }
// HIBOR publishes 15 tenors; m4/m5/m7..m11 are always null, m12 is sent as 4.0.
const HIBOR_ROW = { trade_date: '2026-10-08', on_rate: 2.16821, w1: 2.38679, w2: 2.5, m1: 2.76494, m2: 2.9997, m3: 3.29816, m4: null, m5: null, m6: 3.54149, m7: null, m8: null, m9: null, m10: null, m11: null, m12: 4.0 }
// event_time is a seconds string; missing values are empty strings, never null.
const CALENDAR_EARNINGS_ROW = { stat_date: '2026-10-15', tab_type: 'earnings', event_time: '1791993600', region: '香港', event: '赣锋锂业', importance: '', actual_value: '0', forecast_value: '0', previous_value: '', link: '' }
const CALENDAR_MACRO_ROW = { stat_date: '2026-10-15', tab_type: 'general', event_time: '1792067400', region: '美国', event: '10月10日当周首次申请失业救济人数(万人)', importance: '3', actual_value: '19.9', forecast_value: '20', previous_value: '19.7', link: 'https://wallstreetcn.com/calendar/US121055/overview' }

const FUTURES_LIST_ROW = { exchange: 'CFFEX', future_type: null, product: 'IC', symbol: 'IC2610.CFE', symbol_cn_name: '中证500股指期货' }
const FUTURES_LIST_ROW_COPY = { exchange: 'CFFEX', future_type: 2, product: 'IC', symbol: 'IC2610.CFE', symbol_cn_name: '中证500股指期货' }
// delivery_date and last_trade_date hold rule text, not dates.
const FUTURES_DETAIL_ROW = { de_list_tdate: 20261015, delivery_date: '最后交易日后连续二个工作日', delivery_mean: '实物交割', delivery_site: '交易所指定交割仓库', exchange: 'SHFE', future_type: null, last_trade_date: '合约月份的15日(遇国家法定节假日顺延,春节月份等最后交易日交易所可另行调整并通知)', last_trade_date_hour: '', list_date: 20251016, margin_info: '最低交易保证金:合约价值的4%', mean_cal_value: 1, min_put_price_info: '1人民币元/千克', multiplier: 15, position_limit_info: '', price_fluctuation_info: '不超过上一交易日结算价±3%', price_unit: 15, product: 'AG', put_price: '人民币元/千克', spot_symbol: null, sub_type_code: 703001001, symbol: 'AG2610.SHF', symbol_cn_name: '白银', trade_date: 20261015, trade_hours_info: '上午9:00-11:30,下午13:30-15:00,下午21:00-次日2:30(夜盘)', trade_months_info: '1,2,3,4,5,6,7,8,9,10,11,12', trade_unit: '千克', type_code: 703001000, value_info: '' }
const FUTURES_KLINE_ROW = { symbol: 'cu2612', datetime: 1792047600000, trade_date: 20261015, open: 110200, high: 110290, low: 108260, close: 108290, volume: 75498, amount: 41189137900, vwap: 545565.9474423163, open_interest: 163309, dominant_contract: null, forward_factor: null, backward_factor: null }
const FUTURES_LIMIT_ROW = { trade_date: 20261015, ts_code: 'AD2610.SHF', name: '铸造铝合金2610', up_limit: '25165', down_limit: '21435', m_ratio: '20', cont: 'AD', exchange: 'SHFE' }
// CFFEX uses .CFX here but .CFE in the contract list; compare with the suffix stripped.
const FUTURES_LIMIT_ROW_CFFEX = { trade_date: 20261015, ts_code: 'IC2610.CFX', name: '中证500指数2610', up_limit: '7674.8', down_limit: '6279.6', m_ratio: '12', cont: 'IC', exchange: 'CFFEX' }
const FUTURES_SETTLE_ROW = { ts_code: 'AD2610.SHF', trade_date: 20261015, settle: '23000', trading_fee_rate: '0.05', trading_fee: '0', delivery_fee: '0', b_hedging_margin_rate: '0.2', s_hedging_margin_rate: '0.2', long_margin_rate: '0.2', short_margin_rate: '0.2', offset_today_fee: '0.025', exchange: 'SHFE' }
// Warrant unit is 张 (CZCE) or 吨 (SHFE) on the same page; location columns populate per exchange.
const WARRANT_ROW_CZCE = { trade_date: 20261015, symbol: 'CF', fut_name: '棉花', warehouse: '中储棉库尔勒', wh_id: '0330', pre_vol: '1', vol: '1', vol_chg: '0', area: null, year: '2526', grade: '2130', brand: null, place: '新疆', pd: null, is_ct: null, unit: '张', exchange: 'CZCE' }
const WARRANT_ROW_SHFE = { trade_date: 20261015, symbol: 'CU', fut_name: '铜', warehouse: '上港云仓安达', wh_id: null, pre_vol: '2315', vol: '4635', vol_chg: '2320', area: '上海', year: null, grade: null, brand: null, place: null, pd: null, is_ct: null, unit: '吨', exchange: 'SHFE' }
// Weekly row: upstream misspells the yoy key as amout_yoy, so it leaves here as amount_yoy_pct.
const FUTURES_WEEKLY_ROW = { exchange: 'CFFEX', prd: 'IC', name: '中证500股指期货', vol: 347502, vol_yoy: '6.6401934549', amount: '4958.3263736000', amout_yoy: '3.2722978028', cumvol: 32245753, cumvol_yoy: '62.7569551547', cumamt: '516120.6686184000', cumamt_yoy: '115.2038058534', open_interest: 314035, interest_wow: '15.0707569639', mc_close: '7111.0000000000', close_wow: '-2.7675226297', week: '202639', week_date: 20261009 }
// A week with no trading: quantities are 0 while every derived column is null.
const FUTURES_WEEKLY_ROW_IDLE = { exchange: 'CZCE', prd: 'JR', name: '粳稻', vol: 0, vol_yoy: null, amount: '0.0000000000', amout_yoy: null, cumvol: 0, cumvol_yoy: null, cumamt: '0.0000000000', cumamt_yoy: null, open_interest: 0, interest_wow: null, mc_close: null, close_wow: null, week: '202639', week_date: 20261009 }
// Nanhua index row: string date and string values, and high can sit below open.
const NANHUA_ROW = { code: 'AG_NH', trade_date: '20260928', open: '1758.7800', high: '1724.7500', low: '1649.3100', close: '1650.3000', pre_close: '1724.7500', change: '-74.4500', pct_chg: '-4.3166', vol: 420843, amount: '958.5600' }
// Member rank rows are all strings; an absent side leaves rank and value empty together.
const MEMBER_RANK_ROW = { exchange: 'cffex', variety_code: 'ic', contract_code: 'IC2610', trade_date: '2026-10-15', org_code: '10058975', member_name_abbr: '中信期货(代客)', volume_rank: '1', volume: '17904', volume_change: '-3858', lp_rank: '1', long_position: '5077', lp_change: '-2198', sp_rank: '1', short_position: '5167', sp_change: '-3798', nlp_rank: '', net_long_position: '', nlp_change: '', nsp_rank: '4', net_short_position: '90', nsp_change: '-1600', lp_up_rank: '25', lp_down_rank: '2', sp_up_rank: '26', sp_down_rank: '1', settle_price: '6750.8', lp_avg_price: '7486.8424', sp_avg_price: '7477.8163' }
const MEMBER_RANK_ROW_EMPTY = { exchange: 'cffex', variety_code: 'if', contract_code: 'IF2610', trade_date: '2026-10-15', org_code: '10074307', member_name_abbr: '宏源期货(代客)', volume_rank: '20', volume: '487', volume_change: '90', lp_rank: '', long_position: '', lp_change: '', sp_rank: '', short_position: '', sp_change: '', nlp_rank: '', net_long_position: '', nlp_change: '', nsp_rank: '', net_short_position: '', nsp_change: '', lp_up_rank: '15', lp_down_rank: '15', sp_up_rank: '10', sp_down_rank: '20', settle_price: '4139.2', lp_avg_price: '', sp_avg_price: '' }
const BULLION_ROW = { date: '2026-08-14', value: '940.72' }

// Snapshot envelope: data.items + data.trade_date, no paging fields.
function itemsSnapshot(items, over = {}) {
  return { code: 200, message: 'success', data: { items, trade_date: 20261015, ...over } }
}
// Futures kline envelope: data.items + data.total, with neither pageNum nor pages.
function itemsTotal(items, total = items.length) {
  return { code: 200, message: 'success', data: { items, total } }
}

// Records envelope: data.records + pageNum/pageSize/total/pages; stubs always echo page 1.
function paged(records, over = {}) {
  return { code: 200, message: 'success', data: { pageNum: 1, pageSize: records.length, total: records.length, pages: 1, records, ...over } }
}
// Items envelope: data.items + page/page_size/total_pages/total_items.
function itemsPaged(records, over = {}) {
  return { code: 200, message: 'success', data: { page: 1, page_size: records.length, total_pages: 1, total_items: records.length, items: records, ...over } }
}
// Disclosure envelope: items + total_items/total_pages, and no page/page_size echo.
function disclosurePaged(records, over = {}) {
  return { code: 200, message: 'success', data: { items: records, total_items: records.length, total_pages: 1, ...over } }
}
// Index weight envelope: rows under data.index_weights with total/page/page_size, no pages.
function weightsPaged(records, over = {}) {
  return { code: 200, message: 'success', data: { index_weights: records, total: records.length, page: 1, page_size: records.length, ...over } }
}
// Legal empty: a non-trading day or a pre-window request replies with data:null.
function nullEnvelope() {
  return { code: 200, message: 'success', data: null }
}

function jsonResponse(payload, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => payload }
}

// Swaps globalThis.fetch and restores it; records calls so a test can assert nothing was sent.
async function withFetch(handler, body) {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} })
    return handler(url, init)
  }
  try { return await body(calls) } finally { globalThis.fetch = originalFetch }
}

function sourceFor(capability) {
  const found = createFtshareSources(async () => 'test-key').find((source) => source.schema.capability === capability)
  assert.ok(found, `未注册能力 ${capability}`)
  return found
}

function minimalParams(capability) {
  if (capability === 'ftshare_prev_close') return { code: '600519.SH', start_date: '2026-10-08', end_date: '2026-10-14' }
  if (capability === 'ftshare_trading_calendar') return { start_date: '2026-10-08', end_date: '2026-10-14' }
  if (capability === 'ftshare_daily_kline_snapshot') return { trade_date: '2026-10-14' }
  if (capability === 'ftshare_ashare_quote') return {}
  if (capability === 'ftshare_market_breadth' || capability === 'ftshare_main_capital_flow') return {}
  if (capability === 'ftshare_block_trades') return {}
  if (capability === 'ftshare_performance_forecast' || capability === 'ftshare_performance_express') return { code: '000001.SZ' }
  if (capability === 'ftshare_sw_industry_overview') return { date: '2026-10-14' }
  if (capability === 'ftshare_sw_industry_metrics') return { industry_code: '801010.SI', start_date: '2026-08-03', end_date: '2026-08-03' }
  if (capability === 'ftshare_limit_price') return {}
  if (capability === 'ftshare_dragon_tiger_seats') return { date: '2026-10-14' }
  if (capability === 'ftshare_holder_number') return { code: '600519.SH' }
  if (capability === 'ftshare_index_weight') return { index_code: '000300' }
  if (capability === 'ftshare_convertible_bond_kline') return { code: '113042.SH', start_date: '2026-08-10', end_date: '2026-08-14' }
  if (capability === 'ftshare_lpr') return {}
  // Curve and lending-rate fixtures are dated 2026-10-15, so the window has to reach it.
  if (capability === 'ftshare_chinabond_yield' || capability === 'ftshare_shibor' || capability === 'ftshare_hibor') return { start_date: '2026-10-01', end_date: '2026-10-15' }
  // The calendar caps its window at a 3-day span, so it cannot take the default 6-day one.
  if (capability === 'ftshare_financial_calendar') return { start_date: '2026-10-15', end_date: '2026-10-17' }
  if (capability === 'ftshare_futures_contracts') return {}
  if (capability === 'ftshare_futures_contract_detail') return { symbol: 'AG2610.SHF' }
  if (capability === 'ftshare_futures_kline') return { symbol: 'CU2612.SHFE', start_date: '2026-10-08', end_date: '2026-10-15' }
  if (capability === 'ftshare_futures_limit_price') return { exchange: 'SHFE', trade_date: '2026-10-15' }
  if (capability === 'ftshare_futures_settle') return { exchange: 'SHFE', trade_date: '2026-10-15' }
  if (capability === 'ftshare_futures_warrant') return { trade_date: '2026-10-15' }
  if (capability === 'ftshare_futures_weekly') return { week: '202639' }
  if (capability === 'ftshare_futures_index_kline') return { code: 'AG_NH', start_date: '2026-08-17', end_date: '2026-10-15' }
  if (capability === 'ftshare_futures_member_rank') return { trade_date: '2026-10-15' }
  if (capability === 'ftshare_bullion_price') return { symbol: 'AU9999', start_date: '2026-08-01', end_date: '2026-08-14' }
  return { start_date: '2026-10-08', end_date: '2026-10-14' }
}

function envelopeFor(capability) {
  if (capability === 'ftshare_ashare_quote') return itemsPaged([QUOTE_ROW], { total_items: 5574 })
  if (capability === 'ftshare_daily_kline_snapshot') return paged([KLINE_ROW], { total: 5563 })
  if (capability === 'ftshare_main_capital_flow') return paged([MAIN_CAPITAL_ROW], { total: 5214 })
  if (capability === 'ftshare_market_breadth') return BREADTH_ENVELOPE
  if (capability === 'ftshare_prev_close') return { code: 200, message: 'success', data: PREV_CLOSE_ROWS }
  if (capability === 'ftshare_trading_calendar') return CALENDAR_ENVELOPE
  if (capability === 'ftshare_block_trades') return paged([BLOCK_ROW], { total: 90 })
  if (capability === 'ftshare_performance_forecast') return disclosurePaged([FORECAST_ROW], { total_items: 16 })
  if (capability === 'ftshare_performance_express') return disclosurePaged([EXPRESS_ROW], { total_items: 4 })
  if (capability === 'ftshare_sw_industry_overview') return paged([SW_OVERVIEW_ROW], { total: 497 })
  if (capability === 'ftshare_sw_industry_metrics') return paged([SW_METRICS_ROW], { total: 21 })
  if (capability === 'ftshare_limit_price') return itemsPaged([LIMIT_ROW], { total_items: 7587 })
  if (capability === 'ftshare_dragon_tiger_seats') return paged([SEAT_ROW], { total: 68, pages: 34 })
  if (capability === 'ftshare_holder_number') return itemsPaged([HOLDER_ROW], { total_items: 107 })
  if (capability === 'ftshare_index_weight') return weightsPaged([WEIGHT_ROW], { total: 300 })
  if (capability === 'ftshare_convertible_bond_kline') return { code: 200, message: 'success', data: [CB_ROW] }
  if (capability === 'ftshare_lpr') return { code: 200, message: 'success', data: [LPR_ROW, LPR_5Y_FIRST_ROW, LPR_NULL_ROW] }
  if (capability === 'ftshare_chinabond_yield') return paged([CHINABOND_GOV_ROW, CHINABOND_NOTE_ROW], { total: 18 })
  if (capability === 'ftshare_shibor') return paged([SHIBOR_ROW], { total: 6 })
  if (capability === 'ftshare_hibor') return paged([HIBOR_ROW], { total: 6 })
  if (capability === 'ftshare_financial_calendar') return paged([CALENDAR_EARNINGS_ROW, CALENDAR_MACRO_ROW], { total: 113 })
  if (capability === 'ftshare_futures_contracts') return itemsSnapshot([FUTURES_LIST_ROW, FUTURES_LIST_ROW_COPY])
  if (capability === 'ftshare_futures_contract_detail') return itemsSnapshot([FUTURES_DETAIL_ROW, { ...FUTURES_DETAIL_ROW, future_type: 2 }])
  if (capability === 'ftshare_futures_kline') return itemsTotal([FUTURES_KLINE_ROW], 198)
  if (capability === 'ftshare_futures_limit_price') return paged([FUTURES_LIMIT_ROW], { total: 301 })
  if (capability === 'ftshare_futures_settle') return paged([FUTURES_SETTLE_ROW], { total: 301 })
  if (capability === 'ftshare_futures_warrant') return paged([WARRANT_ROW_CZCE, WARRANT_ROW_SHFE], { total: 1469 })
  if (capability === 'ftshare_futures_weekly') return paged([FUTURES_WEEKLY_ROW, FUTURES_WEEKLY_ROW_IDLE], { total: 360 })
  if (capability === 'ftshare_futures_index_kline') return paged([NANHUA_ROW], { total: 38 })
  if (capability === 'ftshare_futures_member_rank') return paged([MEMBER_RANK_ROW, MEMBER_RANK_ROW_EMPTY], { total: 6911 })
  if (capability === 'ftshare_bullion_price') return paged([BULLION_ROW], { total: 635 })
  if (capability === 'ftshare_industry_daily_flow' || capability === 'ftshare_concept_daily_flow') {
    return paged([{ board_name: 'IT服务', trade_date: '2026-10-14', board_index: 11410.9, change_pct: -1.77, company_count: 129, inflow: 57.06, outflow: 72.88, net_amount: -15.82, leader_name: '华是科技', leader_change_pct: 4.12, leader_price: 69.04 }], { total: 90 })
  }
  return paged([STOCK_FLOW_ROW], { total: 5214 })
}

test('注册面：三十四颗能力都在，前缀与 source_label 一致，目录与详情两条口径都够格', () => {
  const sources = createFtshareSources(async () => 'unused')
  assert.deepEqual(sources.map((s) => s.schema.capability), FT_CAPABILITIES)
  for (const source of sources) {
    const capability = source.schema.capability
    assert.equal(source.schema.source_label, 'ftshare')
    assert.ok(source.schema.summary && source.schema.summary.length <= 60, `${capability} 的 summary 必须存在且够短（目录是发现入口）`)
    assert.ok((source.schema.description ?? '').length > 120, `${capability} 缺完整说明（单位/null/时间/截断口径都住这里）`)
    assert.equal(source.schema.input_schema.type, 'object', `${capability} 的 parameters 根必须是 object（§9.1）`)
    assert.ok(Array.isArray(source.schema.input_schema.required), `${capability} 的根必须显式写 required`)
  }
})

const DATE_FIELDS = ['start_date', 'end_date', 'date', 'trade_date']
function dateParams(source) {
  return Object.keys(source.schema.input_schema.properties ?? {}).filter((key) => DATE_FIELDS.includes(key)).sort()
}

test('⛔ 日期口径不漏接（§1.3 / §9.7）：input_schema 里每个日期参数都要被时间契约认领，反之亦然', () => {
  // A date column left out of time_contract is normalized by neither layer and never probed.
  for (const capability of FT_CAPABILITIES) {
    const source = sourceFor(capability)
    const declared = dateParams(source)
    const contract = source.schema.time_contract
    if (declared.length === 0) {
      assert.equal(contract, undefined, `${capability} 一个日期参数都没有，却领了时间契约`)
      continue
    }
    assert.ok(contract, `${capability} 声明了 ${declared.join(' / ')} 却没有 time_contract`)
    assert.deepEqual([...contract.fields].sort(), declared, `${capability} 的 time_contract.fields 与参数面的日期列不一致`)
  }
})

test('⛔ 分页声明、参数面与出网参数三者必须一致（§9.7 逐入口核对）', () => {
  for (const capability of FT_CAPABILITIES) {
    const source = sourceFor(capability)
    const declaresPage = 'page' in (source.schema.input_schema.properties ?? {})
    const out = PAGED.includes(capability)
    assert.equal(source.schema.paginated, out, `${capability} 的 paginated 声明与实际取数方式不符`)
    assert.equal(declaresPage, out, `${capability}：paginated 与 input_schema 里的 page 必须同进同出`)
    if (out) {
      assert.ok(source.normalizeParams({ ...minimalParams(capability), page: 3 }).page === 3, `${capability} 收了 page 却在参数层丢掉`)
    } else {
      assert.throws(() => source.normalizeParams({ ...minimalParams(capability), page: 2 }), /unsupported parameter/, `${capability} 声明不分页却还收 page`)
    }
  }
})

test('⛔ 分页诚实：行按请求翻页取，页码与页数**不取信封回显**', async () => {
  // Page and pages must follow the request, not the envelope echo the stub always returns.
  const source = sourceFor('ftshare_stock_daily_flow')
  await withFetch(async () => jsonResponse(paged([{ ...STOCK_FLOW_ROW, code: '000007', trade_date: '2026-10-14' }], { total: 15637 })), async (calls) => {
    const result = await source.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-12', end_date: '2026-10-14', page: 2, size: 3 }), new AbortController().signal)
    assert.match(calls[0].url, /[?&]page=2(&|$)/, 'page 必须真的发给上游（实测生效：page 1/2/3 首行 000001 / 000007 / 000010）')
    assert.match(calls[0].url, /page_size=3/)
    assert.deepEqual(result.data.pagination, { page: 2, size: 1, pages: 5213, total: 15637 })
    assert.equal(result.data.item[0].code, '000007')
  })
  const quote = sourceFor('ftshare_ashare_quote')
  await withFetch(async () => jsonResponse(itemsPaged([{ ...QUOTE_BJ_ROW }], { total_items: 349 })), async (calls) => {
    const result = await quote.execute(request('ftshare_ashare_quote', { board: 'bjse', page: 4, size: 100 }), new AbortController().signal)
    assert.equal(calls[0].url.includes('/stocks/bjse'), true)
    assert.deepEqual(result.data.pagination, { page: 4, size: 1, pages: 4, total: 349 })
  })
})

test('execute：日度个股流按 YYYYMMDD 出线，行映射成 snake_case 且带单位后缀', async () => {
  const source = sourceFor('ftshare_stock_daily_flow')
  await withFetch(async () => jsonResponse(paged([STOCK_FLOW_ROW], { total: 5214 })), async (calls) => {
    const result = await source.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14', size: 300 }), new AbortController().signal)
    assert.match(calls[0].url, new RegExp(`^${BASE}/api/v1/market/data/ths-stock-daily-flow\\?`))
    assert.match(calls[0].url, /start_date=20261008/)
    assert.match(calls[0].url, /end_date=20261014/)
    assert.match(calls[0].url, /page_size=300/)
    assert.deepEqual(result.data.item, [{
      code: '600519', name: '贵州茅台',
      trade_date: '2026-10-14', trade_date_ms: Date.parse('2026-10-14T00:00:00+08:00'),
      close_price: 1286, change_pct: 0.87, turnover_pct: 0.19,
      inflow_yi: 18.76, outflow_yi: 11.69, net_amount_yi: 7.07, turnover_amount_yi: 30.46,
    }])
    // size is rows returned by this call; total counts rows inside the requested range.
    assert.deepEqual(result.data.pagination, { page: 1, size: 1, pages: 18, total: 5214 })
  })
})

test('execute：code 过滤器在请求边界退回裸 6 位；裸码歧义时才拒（600519 不歧义、000001 歧义）', async () => {
  const source = sourceFor('ftshare_stock_daily_flow')
  await withFetch(async () => jsonResponse(paged([STOCK_FLOW_ROW])), async (calls) => {
    await source.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14', code: '600519.SH' }), new AbortController().signal)
    assert.match(calls[0].url, /code=600519(&|$)/, '发给上游的必须是裸码')
    assert.doesNotMatch(calls[0].url, /\.SH/, '不要把市场后缀发给只认裸码的上游')
  })
  assert.equal(source.normalizeParams({ start_date: '2026-10-08', end_date: '2026-10-14', code: '600519' }).code, '600519')
  assert.throws(() => source.normalizeParams({ start_date: '2026-10-08', end_date: '2026-10-14', code: '000001' }), /ambiguous|exchange/)
})

test('⛔ 过滤没生效时必须在 producer 里失败，不许落一份「整市场」的错 Dataset', async () => {
  const stock = sourceFor('ftshare_stock_daily_flow')
  await withFetch(async () => jsonResponse(paged([{ ...STOCK_FLOW_ROW, code: '601398' }, STOCK_FLOW_ROW])), async () => {
    await assert.rejects(
      () => stock.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14', code: '600519.SH' }), new AbortController().signal),
      (error) => {
        assert.ok(error instanceof FtshareError)
        assert.equal(error.kind, 'invalid_response', '过滤没生效属于"上游改版/行为不一致"，不是参数错也不是空结果')
        assert.match(error.message, /600519/, error.message)
        assert.match(error.message, /截断样本/, '文案要说清这份返回其实是什么')
        return true
      },
    )
  })
  const industry = sourceFor('ftshare_industry_daily_flow')
  await withFetch(async () => jsonResponse(paged([{ board_name: '银行', trade_date: '2026-10-14', inflow: 1, outflow: 2, net_amount: -1 }])), async () => {
    await assert.rejects(
      () => industry.execute(request('ftshare_industry_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14', board_name: 'IT服务' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /board_name/); return true },
    )
  })
  await withFetch(async () => jsonResponse(paged([{ ...STOCK_FLOW_ROW, code: '601398' }, STOCK_FLOW_ROW])), async () => {
    const result = await stock.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal)
    assert.equal(result.data.item.length, 2)
  })
})

test('⛔ 返回日期落在请求区间之外时响亮失败（区间语义漂了比空结果更糟）', async () => {
  const stock = sourceFor('ftshare_stock_daily_flow')
  await withFetch(async () => jsonResponse(paged([{ ...STOCK_FLOW_ROW, trade_date: '2024-05-06' }])), async () => {
    await assert.rejects(
      () => stock.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal),
      (error) => {
        assert.equal(error.kind, 'invalid_response')
        assert.match(error.message, /2024-05-06/, '把错日期点名，模型才知道不是自己参数写错')
        assert.match(error.message, /2026-10-08\.\.2026-10-14/)
        return true
      },
    )
  })
  await withFetch(async () => jsonResponse(paged([{ ...STOCK_FLOW_ROW, trade_date: 20240506 }])), async () => {
    await assert.rejects(
      () => stock.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); return true },
    )
  })
  await withFetch(async () => jsonResponse(paged([STOCK_FLOW_ROW])), async () => {
    const result = await stock.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-14', end_date: '2026-10-14' }), new AbortController().signal)
    assert.equal(result.data.item.length, 1)
  })
})

test('execute：主力五档把字符串数值转成 number、纳秒转成毫秒轴并给出上海时区的日期与时刻', async () => {
  const source = sourceFor('ftshare_main_capital_flow')
  await withFetch(async () => jsonResponse(paged([MAIN_CAPITAL_ROW], { total: 5214 })), async (calls) => {
    const result = await source.execute(request('ftshare_main_capital_flow', { date: '2026-10-14', time: '15:30', size: 5 }), new AbortController().signal)
    assert.match(calls[0].url, /date=20261014/)
    assert.match(calls[0].url, /time=1530/)
    assert.match(calls[0].url, /page_size=5/)
    const row = result.data.item[0]
    assert.equal(row.thscode, '601857.SH', '身份沿用上游给的后缀写法，本层不替它猜交易所')
    assert.equal(row.ts_millis, 1791963000000, '纳秒必须换算成毫秒（本仓时间轴口径）')
    assert.equal(row.trade_date, '2026-10-14')
    assert.equal(row.slice_time, '15:30', '1791963000000 = 北京 15:30，不是 UTC 07:30')
    for (const key of ['net_inflow_super_large_yuan', 'net_inflow_large_yuan', 'net_inflow_main_yuan', 'net_inflow_medium_yuan', 'net_inflow_small_yuan']) {
      assert.equal(typeof row[key], 'number', `${key} 必须已从字符串转成数值，否则 query_dataset 的数值比较会静默不命中`)
    }
    // The tiers are 2-decimal strings, so the sums drift: compare with a tolerance, not strictEqual.
    assert.ok(Math.abs(row.net_inflow_main_yuan - (row.net_inflow_super_large_yuan + row.net_inflow_large_yuan)) < 1e-6, '主力 = 超大单 + 大单')
    assert.ok(Math.abs(row.net_inflow_main_yuan + row.net_inflow_medium_yuan + row.net_inflow_small_yuan) < 1e-6, '三档净额相加为 0')
    assert.doesNotMatch(JSON.stringify(result.data), /ts_nanos/, '纳秒原值不许透出')
  })
})

test('execute：date 与 time 都省略时不拼任何日期参数（打最新切片，实测为当日 15:30）', async () => {
  const source = sourceFor('ftshare_main_capital_flow')
  await withFetch(async () => jsonResponse(paged([MAIN_CAPITAL_ROW])), async (calls) => {
    await source.execute(request('ftshare_main_capital_flow', {}), new AbortController().signal)
    assert.doesNotMatch(calls[0].url, /date=/)
    assert.doesNotMatch(calls[0].url, /time=/)
  })
})

test('normalizeParams：日期、分页与截断长度的拒绝都在入队前，且文案带 parameter 字样好让工具层归类', () => {
  const source = sourceFor('ftshare_stock_daily_flow')
  const bad = [
    [{ start_date: '2026-10-08' }, /start_date|end_date/],
    [{ start_date: '20261008', end_date: '2026-10-14' }, /parameter start_date must be YYYY-MM-DD/],
    [{ start_date: '2026-02-30', end_date: '2026-10-14' }, /valid YYYY-MM-DD/],
    [{ start_date: '2026-10-14', end_date: '2026-10-08' }, /parameter start_date must not be later/],
    [{ start_date: '2026-10-08', end_date: '2026-10-14', size: 1001 }, /size must be an integer from 1 to 1000/],
    [{ start_date: '2026-10-08', end_date: '2026-10-14', size: 0 }, /size must be an integer from 1 to 1000/],
    [{ start_date: '2026-10-08', end_date: '2026-10-14', size: 1.5 }, /size must be an integer/],
    [{ start_date: '2026-10-08', end_date: '2026-10-14', page: 0 }, /page must be an integer >= 1/],
    [{ start_date: '2026-10-08', end_date: '2026-10-14', limit: 3 }, /unsupported parameter/],
  ]
  for (const [params, pattern] of bad) {
    assert.throws(() => source.normalizeParams(params), pattern, JSON.stringify(params))
  }
  // Messages must match the tool layer's /parameter|params/ classifier or the model gets a bare error.
  for (const [params] of bad) {
    try { source.normalizeParams(params) } catch (error) {
      assert.match(error.message, /parameter|params|unsupported parameter/, `归类会失败：${error.message}`)
    }
  }
  assert.deepEqual(source.normalizeParams({ start_date: '2026-10-08', end_date: '2026-10-14' }), { start_date: '2026-10-08', end_date: '2026-10-14', page: 1, size: 100 })
})

test('normalizeParams：幂等（§10.7）——normalize(normalize(x)) 必须与 normalize(x) 逐字相同', () => {
  for (const capability of FT_CAPABILITIES) {
    const source = sourceFor(capability)
    const once = source.normalizeParams(minimalParams(capability))
    assert.deepEqual(source.normalizeParams(once), once, `${capability} 的 normalize 不幂等：第二遍会拒自己第一遍的输出`)
  }
})

test('⛔ 主力五档的 size 上限是 500：实测 page_size=1000 静默只回 500 行，超限必须在参数层拒绝', () => {
  const source = sourceFor('ftshare_main_capital_flow')
  assert.throws(() => source.normalizeParams({ size: 501 }), /size must be an integer from 1 to 500/)
  assert.equal(source.normalizeParams({}).size, 100, '默认 100 行')
  assert.equal(source.normalizeParams({ size: 500 }).size, 500)
})


test('normalizeParams：切片时刻只认 15 分钟栅格；午间与休市后不是参数错', () => {
  const source = sourceFor('ftshare_main_capital_flow')
  assert.throws(() => source.normalizeParams({ time: '0935' }), /15-minute grid/)
  assert.throws(() => source.normalizeParams({ time: '9:30' }), /HHMM/)
  assert.equal(source.normalizeParams({ time: '10:15' }).time, '1015')
  assert.equal(source.normalizeParams({ time: '1530' }).time, '1530')
  assert.equal(source.normalizeParams({ time: '1200' }).time, '1200')
})

test('空结果与窗口：total=0 是合法空集，不抛错也不补零', async () => {
  const source = sourceFor('ftshare_stock_daily_flow')
  await withFetch(async () => jsonResponse(paged([], { total: 0, pages: 0 })), async () => {
    const result = await source.execute(request('ftshare_stock_daily_flow', { start_date: '2026-01-05', end_date: '2026-01-05' }), new AbortController().signal)
    assert.deepEqual(result.data.item, [])
    assert.equal(result.data.pagination.total, 0)
    assert.equal(source.validateOutput(result.data), true, '空 item 加 pagination 仍是合法形状')
  })
})

test('截断要看得见：一页装不下时 pagination 把差值原样带出去', async () => {
  const source = sourceFor('ftshare_stock_daily_flow')
  await withFetch(async () => jsonResponse(paged([STOCK_FLOW_ROW], { total: 15637 })), async () => {
    const result = await source.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-12', end_date: '2026-10-14', size: 3 }), new AbortController().signal)
    assert.equal(result.data.item.length, 1)
    assert.deepEqual(result.data.pagination, { page: 1, size: 1, pages: 5213, total: 15637 })
  })
})

test('错误信封两套都要认：403 套餐外用 msg 而非 message，理由必须原样带到模型眼前', async () => {
  const client = createFtshareClient(async () => 'test-key')
  await withFetch(async () => ({
    status: 403, ok: false,
    json: async () => ({ code: 403, data: { reason: '当前套餐无权访问该接口' }, msg: 'route_not_allowed' }),
  }), async () => {
    await assert.rejects(
      () => client.getJson('/api/v1/market/data/stock-capital-flows', new URLSearchParams(), new AbortController().signal),
      (error) => {
        assert.ok(error instanceof FtshareError)
        assert.equal(error.kind, 'plan_closed')
        assert.match(error.message, /当前套餐无权访问该接口/, '上游给的人话不许丢')
        assert.match(error.message, /不要重试/, '必须把"重试无意义"写进文案（Fuyao 2004 同一族）')
        return true
      },
    )
  })
})

test('错误归类：上游 400 / HTTP 429 / 未知业务码 / 缺 data 各归各位', async () => {
  const client = createFtshareClient(async () => 'test-key')
  await withFetch(async () => ({ status: 200, ok: true, json: async () => ({ code: 400, message: 'start_date must be YYYYMMDD', data: null }) }), async () => {
    await assert.rejects(() => client.getJson('/x', new URLSearchParams(), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_parameter'); assert.match(error.message, /YYYYMMDD/); return true })
  })
  await withFetch(async () => ({ status: 429, ok: false, json: async () => ({}) }), async () => {
    await assert.rejects(() => client.getJson('/x', new URLSearchParams(), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'rate_limited'); return true })
  })
  // Unknown business codes fall through to upstream_error; guessing them as parameter errors is forbidden.
  await withFetch(async () => ({ status: 200, ok: true, json: async () => ({ code: 100999, message: '数据量超出限制', data: null }) }), async () => {
    await assert.rejects(() => client.getJson('/x', new URLSearchParams(), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'upstream_error'); assert.equal(error.code, 100999); return true })
  })
  // A 200 with no data key is an upstream schema change: invalid_response, never an empty result (§10.8 GUARD).
  const source = sourceFor('ftshare_stock_daily_flow')
  await withFetch(async () => ({ status: 200, ok: true, json: async () => ({ code: 200, message: 'success' }) }), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); return true },
    )
  })
  await withFetch(async () => jsonResponse({ code: 200, message: 'success', data: { values: [{ symbol: '600519.SH' }] } }), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /records\/items/); return true },
    )
  })
})

test('缺凭据：明确报错且一次请求都不发', async () => {
  const source = sourceFor('ftshare_stock_daily_flow')
  const keyless = createFtshareSources(async () => undefined).find((s) => s.schema.capability === 'ftshare_stock_daily_flow')
  await withFetch(async () => { throw new Error('unexpected fetch') }, async (calls) => {
    await assert.rejects(
      () => keyless.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal),
      /FTSHARE_API_KEY is not configured/,
    )
    assert.deepEqual(calls, [], '没有 key 还发请求等于白烧上游配额')
    assert.equal(source.schema.capability, 'ftshare_stock_daily_flow')
  })
})

test('凭据每次调用现取：不把第一次的 rejection 记住（§9.7 装配期抢跑那一族）', async () => {
  let resolves = 0
  const sources = createFtshareSources(async () => { resolves += 1; return `key-${resolves}` })
  const stockFlow = sources.find((s) => s.schema.capability === 'ftshare_stock_daily_flow')
  await withFetch(async () => jsonResponse(paged([STOCK_FLOW_ROW])), async (calls) => {
    const params = { start_date: '2026-10-08', end_date: '2026-10-14' }
    await stockFlow.execute(request('ftshare_stock_daily_flow', params), new AbortController().signal)
    await stockFlow.execute(request('ftshare_stock_daily_flow', { ...params, size: 5 }), new AbortController().signal)
    assert.equal(resolves, 2, '两次调用必须各解析一次 key')
    assert.equal(calls[0].headers.FTSHARE_API_KEY, 'key-1')
    assert.equal(calls[1].headers.FTSHARE_API_KEY, 'key-2', '换了 key 必须立刻生效，不能记住第一次')
  })
})

test('限流：并发进来也要拉成一条链，相邻请求间隔不小于 FTSHARE_MIN_INTERVAL_MS', async () => {
  const source = sourceFor('ftshare_stock_daily_flow')
  const params = { start_date: '2026-10-08', end_date: '2026-10-14' }
  // withFetch must be awaited: an unawaited stub resolves immediately and the throttle test passes falsely.
  const stamps = []
  await withFetch(async () => { stamps.push(Date.now()); return jsonResponse(paged([STOCK_FLOW_ROW])) }, async () => {
    await Promise.all([
      source.execute(request('ftshare_stock_daily_flow', { ...params, size: 3 }), new AbortController().signal),
      source.execute(request('ftshare_stock_daily_flow', { ...params, size: 4 }), new AbortController().signal),
      source.execute(request('ftshare_stock_daily_flow', { ...params, size: 5 }), new AbortController().signal),
    ])
  })
  assert.equal(stamps.length, 3)
  // 5ms tolerance absorbs the skew between the throttle stamp taken before the task and the one inside fetch.
  const gaps = [stamps[1] - stamps[0], stamps[2] - stamps[1]]
  for (const [i, gap] of gaps.entries()) {
    assert.ok(gap >= FTSHARE_MIN_INTERVAL_MS - 5, `串行 ≠ 节流：第 ${i + 1} 发实测间隔 ${gap}ms < ${FTSHARE_MIN_INTERVAL_MS}ms`)
  }
})

test('输出契约：三十四颗能力返回的每一个列名都必须在声明的 output_schema 里（§9.6）', async () => {
  for (const capability of FT_CAPABILITIES) {
    const source = sourceFor(capability)
    await withFetch(async () => jsonResponse(envelopeFor(capability)), async () => {
      const result = await source.execute(request(capability, minimalParams(capability)), new AbortController().signal)
      const declared = Object.keys(result.schema.properties.item.items.properties)
      assert.ok(result.data.item.length > 0, `${capability} 这份 fixture 一行都没映射出来`)
      for (const emitted of Object.keys(result.data.item[0])) {
        assert.ok(declared.includes(emitted), `${capability} 返回了未声明的列 ${emitted}`)
      }
      // §9.5: lossless JSON, so no undefined or NaN may leave the tool layer.
      const serialized = JSON.stringify(result.data)
      assert.doesNotMatch(serialized, /NaN|undefined/)
      assert.equal(source.validateOutput(result.data), true)
    })
  }
})

test('日期列两种写法都要归一：ISO 与 YYYYMMDD 出同一套 trade_date + 毫秒轴', async () => {
  const source = sourceFor('ftshare_concept_daily_flow')
  await withFetch(async () => jsonResponse(paged([
    { board_name: 'A', trade_date: '2026-10-14', inflow: 1, outflow: 2, net_amount: -1 },
    { board_name: 'B', trade_date: 20261014, inflow: 3, outflow: 4, net_amount: -1 },
  ])), async () => {
    const result = await source.execute(request('ftshare_concept_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal)
    for (const row of result.data.item) {
      assert.equal(row.trade_date, '2026-10-14', `${row.board_name} 的日期没归一`)
      assert.equal(row.trade_date_ms, Date.parse('2026-10-14T00:00:00+08:00'))
    }
    assert.equal(result.data.item[0].leader_name, null, '上游缺列要给 null，不许补成空串或 0')
  })
})

test('报价面：board 只走白名单路径段、身份发 symbol_id 表达式、排序发已验的五档', async () => {
  const source = sourceFor('ftshare_ashare_quote')
  await withFetch(async () => jsonResponse(itemsPaged([QUOTE_ROW], { total_items: 5574 })), async (calls) => {
    const result = await source.execute(request('ftshare_ashare_quote', { board: 'xshe', code: '000001.SZ', sort_field: 'change_ratio', sort_order: 'desc', page: 2, size: 50 }), new AbortController().signal)
    assert.match(calls[0].url, /\/api\/v1\/market\/data\/daec\/stocks\/xshe\?/)
    assert.match(calls[0].url, /filter=symbol_id\+%3D\+%22000001%22/, 'filter 由本层用已验的 6 位数字拼，模型看不见表达式')
    assert.match(calls[0].url, /order_by=change_rate\+desc/)
    assert.match(calls[0].url, /page=2/)
    assert.match(calls[0].url, /page_size=50/)
    const [row] = result.data.item
    assert.equal(row.thscode, '000001.SZ')
    assert.equal(row.ticker, '000001', '裸 6 位身份单独给一列，下游不用自己截')
    assert.equal(row.close, 11.41, '字符串价格必须转成数值')
    assert.equal(row.turnover_yuan, 1719700511.61)
    assert.equal(row.volume_shares, 151176706)
    assert.equal(row.market_cap_yuan, 221421526639.18)
    assert.equal(row.st, false)
    assert.equal(row.quote_time_ms, 1792053003000)
    assert.ok(Math.abs(row.change_ratio - row.change_yuan / row.prev_close) < 1e-12, 'change_ratio = change ÷ prev_close（上游是派生列不是独立披露）')
    assert.ok(Math.abs(row.avg_price - row.turnover_yuan / row.volume_shares) < 1e-6)
  })
  await withFetch(async () => jsonResponse(itemsPaged([QUOTE_ROW])), async (calls) => {
    await source.execute(request('ftshare_ashare_quote', {}), new AbortController().signal)
    assert.match(calls[0].url, /\/stocks\/all\?/)
    assert.doesNotMatch(calls[0].url, /order_by=/)
    assert.doesNotMatch(calls[0].url, /filter=/)
  })
  // Upstream knows only xshg/xshe/bjse/all ("unsupported stock board ys; expected xshg/xshe/bjse/all"); the path segment must never carry a caller string.
  for (const board of ['ys', 'zz', 'ChinaStock', 'BJ']) {
    assert.throws(() => source.normalizeParams({ board }), /board must be one of/, board)
  }
  assert.equal(source.normalizeParams({ board: 'ALL' }).board, 'all', '大小写与空白在参数层归一，不发出去再被上游 400')
  assert.throws(() => source.normalizeParams({ sort_field: 'market_cap' }), /sort_field must be one of/)
  assert.throws(() => source.normalizeParams({ sort_order: 'desc' }), /requires sort_field/)
  assert.throws(() => source.normalizeParams({ sort_field: 'close', sort_order: 'DESC' }), /sort_order must be asc or desc/)
  assert.throws(() => source.normalizeParams({ size: 1001 }), /size must be an integer from 1 to 1000/)
})

test('⛔ 报价面含北交所，且停牌票的 open/high/low 是 null 不是 0', async () => {
  const source = sourceFor('ftshare_ashare_quote')
  await withFetch(async () => jsonResponse(itemsPaged([QUOTE_BJ_ROW], { total_items: 349 })), async (calls) => {
    const result = await source.execute(request('ftshare_ashare_quote', { board: 'bjse' }), new AbortController().signal)
    assert.match(calls[0].url, /\/stocks\/bjse/)
    const [row] = result.data.item
    assert.equal(row.thscode, '920000.BJ', '北证身份带 .BJ 后缀原样透出（本仓腾讯那一路拒 BJ，这条是唯一的第二家）')
    assert.equal(row.board, 'Bjse')
    assert.equal(row.close, 12.98)
  })
  await withFetch(async () => jsonResponse(itemsPaged([QUOTE_SUSPENDED_ROW], { total_items: 5574 })), async () => {
    const [row] = (await source.execute(request('ftshare_ashare_quote', {}), new AbortController().signal)).data.item
    assert.equal(row.status, 'Suspended')
    assert.equal(row.st, true)
    assert.equal(row.open, null, '停牌没有当日开盘价：null 是事实，补 0 会造出一个假的价')
    assert.equal(row.high, null)
    assert.equal(row.low, null)
    assert.equal(row.close, 2.46)
    assert.equal(row.pe_ttm, null, '亏损/无 PE 的票上游直接给 null，本层不补')
  })
  await withFetch(async () => jsonResponse(itemsPaged([{ ...QUOTE_ROW, symbol: '600000.SH', symbol_id: '600000' }], { total_items: 5574 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_ashare_quote', { code: '000001.SZ' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /symbol_id/); return true },
    )
  })
})

test('日 K 截面：YYYYMMDD 出线、行内日期由 ts_millis 补、size 上限押在上游给的 500', async () => {
  const source = sourceFor('ftshare_daily_kline_snapshot')
  await withFetch(async () => jsonResponse(paged([KLINE_ROW], { total: 5563 })), async (calls) => {
    const result = await source.execute(request('ftshare_daily_kline_snapshot', { trade_date: '2026-10-14', page: 12, size: 500 }), new AbortController().signal)
    assert.match(calls[0].url, new RegExp(`^${BASE}/api/v1/market/data/stock-candlesticks-daily\\?`))
    assert.match(calls[0].url, /trade_date=20261014/, '上游只认 YYYYMMDD')
    assert.match(calls[0].url, /page=12/)
    assert.match(calls[0].url, /page_size=500/)
    const [row] = result.data.item
    assert.equal(row.thscode, '000001.SZ')
    assert.equal(row.ticker, '000001')
    assert.equal(row.trade_date, '2026-10-14', '日轴由上游 ts_millis（该日 15:00）按上海时区补出')
    assert.equal(row.trade_date_ms, Date.parse('2026-10-14T00:00:00+08:00'))
    assert.equal(row.open, 11.57)
    assert.equal(row.close, 11.5, '字符串价格转数值')
    assert.equal(row.turnover_yuan, 1122283852.23)
    assert.equal(row.turnover_ratio, 0.004993804240610122, '⛔ 比例值不是百分数（0.499%），与日度族的 turnover_pct 不是一套')
    assert.equal(row.session_open_ms, 1791941400000)
    assert.equal(row.close_time_ms, 1791961200000)
    assert.deepEqual(result.data.pagination, { page: 12, size: 1, pages: 12, total: 5563 })
  })
  // Upstream caps this endpoint's page_size at 1-500; do not widen it to the family default 1000.
  assert.throws(() => source.normalizeParams({ trade_date: '2026-10-14', size: 501 }), /size must be an integer from 1 to 500/)
  assert.equal(source.normalizeParams({ trade_date: '2026-10-14' }).size, 100)
  assert.throws(() => source.normalizeParams({ size: 100 }), /parameter trade_date must be YYYY-MM-DD/, 'trade_date 必填：这条没有"默认今天"那种兜底')
})

test('⛔ 日 K 截面：回来的日期不是请求那一天时必须失败（否则错日期会按请求日期落库）', async () => {
  const source = sourceFor('ftshare_daily_kline_snapshot')
  await withFetch(async () => jsonResponse(paged([{ ...KLINE_ROW, ts_millis: 1791874800000 }], { total: 5563 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_daily_kline_snapshot', { trade_date: '2026-10-14' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /2026-10-13/); return true },
    )
  })
  await withFetch(async () => jsonResponse(paged([KLINE_ROW, { ...KLINE_ROW, trade_code: '999999.SZ', ts_millis: null }], { total: 5563 })), async () => {
    const result = await source.execute(request('ftshare_daily_kline_snapshot', { trade_date: '2026-10-14' }), new AbortController().signal)
    assert.equal(result.data.item.length, 1)
    assert.equal(result.data.pagination.size, 1)
  })
  await withFetch(async () => ({ status: 400, ok: false, json: async () => ({ code: 400, message: '参数无效：trade_date 不是交易日', data: null }) }), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_daily_kline_snapshot', { trade_date: '2026-10-11' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_parameter'); assert.match(error.message, /交易日/); return true },
    )
  })
})

test('昨收价：data 直接是数组、身份由本层按请求补写、发给上游的是 canonical 短后缀', async () => {
  const source = sourceFor('ftshare_prev_close')
  await withFetch(async () => jsonResponse({ code: 200, message: 'success', data: PREV_CLOSE_ROWS }), async (calls) => {
    const result = await source.execute(request('ftshare_prev_close', { code: 'SH600519', start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal)
    assert.match(calls[0].url, /\/api\/v1\/market\/data\/daec\/history\/prev-closes\?/)
    assert.match(calls[0].url, /symbol=600519\.SH/, '上游认 canonical 写法，SH600519 这类写法必须先在参数层归一')
    assert.match(calls[0].url, /since=20261008/)
    assert.match(calls[0].url, /until=20261014/)
    assert.deepEqual(result.data.item, [
      { thscode: '600519.SH', trade_date: '2026-10-08', trade_date_ms: Date.parse('2026-10-08T00:00:00+08:00'), prev_close: 1258.62 },
      { thscode: '600519.SH', trade_date: '2026-10-09', trade_date_ms: Date.parse('2026-10-09T00:00:00+08:00'), prev_close: 1255.79 },
    ])
    assert.deepEqual(result.data.pagination, { page: 1, size: 2, pages: 1, total: 2 })
  })
  await withFetch(async () => jsonResponse({ code: 200, message: 'success', data: [{ date: '2026-10-14', prev_close: '13.83' }] }), async (calls) => {
    await source.execute(request('ftshare_prev_close', { code: '920000.BJ', start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal)
    assert.match(calls[0].url, /symbol=920000\.BJ/)
  })
})

test('⛔ 昨收价：日期区间被吞时响亮失败（这一族的响应里没有身份列，日期是唯一的核对点）', async () => {
  const source = sourceFor('ftshare_prev_close')
  await withFetch(async () => jsonResponse({ code: 200, message: 'success', data: [{ date: '2020-01-02', prev_close: '1200.00' }] }), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_prev_close', { code: '600519.SH', start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /2020-01-02/); assert.match(error.message, /2026-10-08\.\.2026-10-14/); return true },
    )
  })
  await withFetch(async () => jsonResponse({ code: 200, message: 'success', data: PREV_CLOSE_ROWS }), async () => {
    const result = await source.execute(request('ftshare_prev_close', { code: '600519.SH', start_date: '2026-10-08', end_date: '2026-10-09' }), new AbortController().signal)
    assert.equal(result.data.item.length, 2)
  })
  await withFetch(async () => jsonResponse({ code: 200, message: 'success', data: [{ date: '2026-10-12', prev_close: '14.19' }] }), async () => {
    const result = await source.execute(request('ftshare_prev_close', { code: '920000.BJ', start_date: '2026-10-10', end_date: '2026-10-14' }), new AbortController().signal)
    assert.equal(result.data.item[0].trade_date, '2026-10-12')
  })
})

test('快照：恒零占位列不收录、九档摊平并与报价面对账、scope 是请求标签而不是上游披露', async () => {
  const source = sourceFor('ftshare_market_breadth')
  await withFetch(async () => jsonResponse(BREADTH_ENVELOPE), async (calls) => {
    const result = await source.execute(request('ftshare_market_breadth', { scope: 'ChinaStock' }), new AbortController().signal)
    assert.match(calls[0].url, /\/api\/v1\/market\/data\/daec\/market\/snapshot\?scope=ChinaStock$/)
    const [row] = result.data.item
    assert.equal(row.scope, 'ChinaStock')
    assert.equal(row.market_status, 'closed')
    assert.equal(row.turnover_yuan, 1642255033207.72, '字符串金额必须转成数值')
    assert.equal(row.volume_shares, 106667826175)
    assert.equal(row.up_limited + row.up_5pct_to_limited + row.up_1pct_to_5pct + row.up_0pct_to_1pct + row.flat
      + row.down_0pct_to_1pct + row.down_1pct_to_5pct + row.down_5pct_to_limited + row.down_limited, 5574)
    const serialized = JSON.stringify(result.data)
    assert.doesNotMatch(serialized, /prev_turnover|change_rate/, '占位列不许带出')
  })
  await withFetch(async () => jsonResponse({ code: 200, message: 'success', data: { status: 'closed', turnover: '1' } }), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_market_breadth', {}), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /distribution/); return true },
    )
  })
  assert.throws(() => source.normalizeParams({ scope: 'ChinaBond' }), /parameter scope must be one of/)
  assert.throws(() => source.normalizeParams({ size: 10 }), /unsupported parameter/, '一次一行，分页参数在这条上没有意义')
})

test('交易日历：数字日期归一成 ISO + 毫秒轴，market 默认 cn 且只认 cn / hk', async () => {
  const source = sourceFor('ftshare_trading_calendar')
  await withFetch(async () => jsonResponse(CALENDAR_ENVELOPE), async (calls) => {
    const result = await source.execute(request('ftshare_trading_calendar', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal)
    assert.match(calls[0].url, /\/api\/v1\/market\/data\/time\/trading-calendar\?market=cn/)
    assert.match(calls[0].url, /start_date=20261008&end_date=20261014$/)
    assert.deepEqual(result.data.item.map((row) => row.trade_date), ['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'])
    assert.equal(result.data.item[0].trade_date_ms, Date.parse('2026-10-08T00:00:00+08:00'))
    assert.equal(result.data.item[0].market, 'cn')
    assert.equal(result.data.pagination.total, 5)
  })
  assert.throws(() => source.normalizeParams({ start_date: '2026-10-08', end_date: '2026-10-14', market: 'us' }), /market must be cn or hk/)
  assert.throws(() => source.normalizeParams({ start_date: '2026-10-08', end_date: '2026-10-14', scope: 'ChinaStock' }), /unsupported parameter/)
  await withFetch(async () => jsonResponse({ code: 200, message: 'success', data: { market: 'cn', trade_dates: [19970101] } }), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_trading_calendar', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /outside/); return true },
    )
  })
})

test('execute：大宗交易一笔一行，价格字符串转数值、溢价率**原样是比例值**', async () => {
  const source = sourceFor('ftshare_block_trades')
  await withFetch(async () => jsonResponse(paged([BLOCK_ROW], { total: 90 })), async (calls) => {
    const result = await source.execute(request('ftshare_block_trades', { date: '2026-10-13', size: 3 }), new AbortController().signal)
    assert.match(calls[0].url, /\/api\/v1\/market\/data\/block-trades\?date=20261013/)
    assert.match(calls[0].url, /page_size=3/)
    assert.deepEqual(result.data.item, [{
      thscode: '000656.SZ', ticker: '000656', name: '金科股份',
      trade_date: '2026-10-13', trade_date_ms: Date.parse('2026-10-13T00:00:00+08:00'),
      deal_price_yuan: 1.03, close_yuan: 1.13, volume_shares: 500000, premium_ratio: -0.08849558,
      buyer_name: '平安证券股份有限公司广州体育东路证券营业部', seller_name: '国海证券股份有限公司四川分公司',
    }])
    // premium_rate = (deal − close) ÷ close as a ratio, truncated to 8 decimals, so compare at 1e-8.
    const row = result.data.item[0]
    assert.ok(Math.abs((row.deal_price_yuan - row.close_yuan) / row.close_yuan - row.premium_ratio) < 1e-8)
    assert.ok(Math.abs(row.premium_ratio) < 1, '本层不许把它换算成百分数带出去')
    assert.deepEqual(result.data.pagination, { page: 1, size: 1, pages: 30, total: 90 })
  })
})

test('⛔ 大宗交易：省略 date 就不发 date；回来的不是请求那一天时失败；size 与 symbol 都在参数层拦', async () => {
  const source = sourceFor('ftshare_block_trades')
  await withFetch(async () => jsonResponse(paged([BLOCK_ROW], { total: 90 })), async (calls) => {
    await source.execute(request('ftshare_block_trades', {}), new AbortController().signal)
    assert.doesNotMatch(calls[0].url, /[?&]date=/)
  })
  await withFetch(async () => jsonResponse(paged([BLOCK_ROW], { total: 90 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_block_trades', { date: '2026-10-14' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /2026-10-13/); return true },
    )
  })
  assert.throws(() => source.normalizeParams({ size: 501 }), /size must be an integer from 1 to 500/)
  assert.throws(() => source.normalizeParams({ symbol: '000002.SZ' }), /unsupported parameter/)
})

test('预告与快报：modeA 把代码转成上游的带后缀写法，modeB 只发 year + report_type', async () => {
  const forecast = sourceFor('ftshare_performance_forecast')
  await withFetch(async () => jsonResponse(disclosurePaged([FORECAST_ROW], { total_items: 16 })), async (calls) => {
    const result = await forecast.execute(request('ftshare_performance_forecast', { code: '000001.SZ' }), new AbortController().signal)
    assert.match(calls[0].url, /stock_code=000001\.SZ/)
    assert.doesNotMatch(calls[0].url, /year=|report_type=/, 'modeA 不该带报告期参数')
    assert.equal(result.data.item[0].forecast_value_min, 20792060000, '上游用字符串给数值，本层必须转 number')
    assert.equal(result.data.item[0].yoy_change_max_pct, 15)
    assert.equal(result.data.item[0].unit, '元', '单位跟着行走，不在本层硬编码')
    assert.equal(result.data.item[0].publish_date_ms, Date.parse('2016-01-21T00:00:00+08:00'))
    assert.equal(result.data.pagination.pages, 1, '⛔ modeA 上游不翻页：把 page 算进 pages 会让模型翻第二页拿到重复的一整份')
    assert.equal(result.data.pagination.total, result.data.item.length, 'modeA 的 total 就是返回的行数（实测单票全量一次给完）')
    assert.doesNotMatch(calls[0].url, /page=/, 'modeA 不该把分页参数发出去')
  })
  await withFetch(async () => jsonResponse(disclosurePaged([{ ...FORECAST_ROW, year: 2024, report_type: 'q1' }], { total_items: 229, total_pages: 77 })), async (calls) => {
    await forecast.execute(request('ftshare_performance_forecast', { year: 2024, report_type: 'q1', page: 2, size: 3 }), new AbortController().signal)
    assert.match(calls[0].url, /year=2024&report_type=q1&page=2&page_size=3/)
    assert.doesNotMatch(calls[0].url, /stock_code=/)
  })
  assert.throws(() => forecast.normalizeParams({ code: '000001.SZ', year: 2024, report_type: 'annual' }), /二选一/)
  assert.throws(() => forecast.normalizeParams({ year: 2024 }), /必须同时给 year 与 report_type/)
  // Upstream maps report_type aliases silently (q4 to annual, h1 to q2), so the parameter layer must not.
  for (const alias of ['q4', 'Q4', 'h1', 'zzz']) {
    assert.throws(() => forecast.normalizeParams({ year: 2024, report_type: alias }), /report_type must be one of/, `${alias} 必须被拒`)
  }
  assert.throws(() => forecast.normalizeParams({ code: '000001' }), /ambiguous|exchange/, '裸 000001 有歧义：不许替模型猜市场')
  assert.equal(forecast.normalizeParams({ code: '600519.XSHG' }).code, '600519.SH', '聚宽写法归一成上游认识的短后缀（实测直接发 XSHG 只回 0 行）')
})

test('⛔ 预告 modeB：year 或 report_type 没生效时必须失败（这一族的过滤失败是静默的）', async () => {
  const forecast = sourceFor('ftshare_performance_forecast')
  await withFetch(async () => jsonResponse(disclosurePaged([{ ...FORECAST_ROW, year: 2015 }], { total_items: 3150 })), async () => {
    await assert.rejects(
      () => forecast.execute(request('ftshare_performance_forecast', { year: 2024, report_type: 'annual' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /year/); return true },
    )
  })
  await withFetch(async () => jsonResponse(disclosurePaged([{ ...FORECAST_ROW, year: 2024, report_type: 'q3' }], { total_items: 3150 })), async () => {
    await assert.rejects(
      () => forecast.execute(request('ftshare_performance_forecast', { year: 2024, report_type: 'annual' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /report_type/); return true },
    )
  })
})

test('⛔ 预告的 0 与快报的反号：原样透出，本层不做"好心"修正', async () => {
  const forecast = sourceFor('ftshare_performance_forecast')
  await withFetch(async () => jsonResponse(disclosurePaged([FORECAST_ZERO_ROW], { total_items: 3368 })), async () => {
    const row = (await forecast.execute(request('ftshare_performance_forecast', { code: '603369.SH' }), new AbortController().signal)).data.item[0]
    assert.equal(row.forecast_value_min, 0)
    assert.equal(row.forecast_value_max, 0)
    assert.equal(row.yoy_change_min_pct, 5)
    assert.equal(row.last_year_value, 11545705180.8)
  })
  const express = sourceFor('ftshare_performance_express')
  await withFetch(async () => jsonResponse(disclosurePaged([EXPRESS_LOSS_ROW], { total_items: 1192 })), async () => {
    const row = (await express.execute(request('ftshare_performance_express', { code: '688184.SH' }), new AbortController().signal)).data.item[0]
    const calc = (row.net_profit_yuan - row.net_profit_prev_yuan) / Math.abs(row.net_profit_prev_yuan) * 100
    assert.ok(calc < 0, '本期与上期都为负且本期更亏 ⇒ 算式是负数')
    assert.equal(row.net_profit_yoy_pct, 193.3661, '上游字段照原样带出，改符号是分析层的事，且必须写清口径')
    // Upstream rounds the reading to 4 decimals, hence the 1e-4 tolerance.
    assert.ok(Math.abs(calc + row.net_profit_yoy_pct) < 1e-4)
  })
  await withFetch(async () => jsonResponse(disclosurePaged([EXPRESS_LOSS_ROW], { total_items: 4 })), async () => {
    await assert.rejects(
      () => express.execute(request('ftshare_performance_express', { code: '000001.SZ' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /688184\.SH/); return true },
    )
  })
})

test('申万总览：camelCase 归一 snake_case，分位是百分数原样，一级行业 parent 是 null', async () => {
  const source = sourceFor('ftshare_sw_industry_overview')
  await withFetch(async () => jsonResponse(paged([SW_OVERVIEW_ROW], { total: 497 })), async (calls) => {
    const result = await source.execute(request('ftshare_sw_industry_overview', { date: '2026-10-14', level: 1, size: 3 }), new AbortController().signal)
    assert.match(calls[0].url, /\/api\/v1\/market\/data\/sw-industry\/overview\?date=20261014&level=1&page=1&page_size=3/)
    assert.deepEqual(result.data.item, [{
      industry_code: '801010.SI', industry_name: '农林牧渔', level: 1, parent_industry_name: null,
      constituent_count: 104, trade_date: '2026-10-14', trade_date_ms: Date.parse('2026-10-14T00:00:00+08:00'),
      pe_lyr: 30.38, pe_lyr_percentile: 45.98, pe_ttm: 32.15, pe_ttm_percentile: 52.87,
      pb: 1.93, pb_percentile: 7.98, dividend_yield_pct: 2.26, dividend_yield_percentile: 92.19,
    }])
    assert.ok(result.data.item[0].pe_lyr_percentile > 1)
    assert.equal(result.data.pagination.pages, 166, '实测 497 ÷ 3 = 166 页')
  })
  assert.throws(() => source.normalizeParams({ date: '2026-10-14', level: 4 }), /level must be 1, 2 or 3/, '实测越界 level 静默回 0 行')
  assert.throws(() => source.normalizeParams({ date: '2026-10-14', size: 501 }), /size must be an integer from 1 to 500/, '实测 1000 静默按 500（文档写的 200 不是上限）')
  assert.throws(() => source.normalizeParams({ size: 3 }), /parameter date must be YYYY-MM-DD/)
})

test('申万日度：amount 千元 / total_mv 万元换算成元，null 保持 null 不补 0', async () => {
  const source = sourceFor('ftshare_sw_industry_metrics')
  await withFetch(async () => jsonResponse(paged([SW_METRICS_ROW], { total: 21 })), async (calls) => {
    const result = await source.execute(request('ftshare_sw_industry_metrics', { industry_code: '801010.SI', start_date: '2026-08-01', end_date: '2026-08-31', size: 3 }), new AbortController().signal)
    assert.match(calls[0].url, /industry_code=801010\.SI&start_date=20260801&end_date=20260831/)
    const row = result.data.item[0]
    assert.equal(Object.keys(row).length, 43, '上游 42 列 + 本层补的 trade_date_ms')
    assert.equal(row.amount_yuan, 16234778971, '16234778.971 千元 → 元')
    assert.equal(row.total_mv_yuan, 1195076514900, '119507651.49 万元 → 元')
    assert.equal(row.pe_lyr, 63.08)
    assert.equal(row.pe_lyr_quantile, 0.40889, '分位是比例值，原样透出')
    assert.equal(row.w_pe_lyr, 22.5, '上游 add* 前缀 = 市值加权，本层改名为 w_*')
    assert.equal(row.constituent_count, 102)
    assert.equal(row.below_net_asset_count, 6)
    const onTotalMv = row.amount_yuan / row.total_mv_yuan * 100
    assert.ok(onTotalMv > 0.2 && onTotalMv < 5, `总市值口径换手 ${onTotalMv}% 不像话`)
    assert.ok(onTotalMv < row.turnover_rate_pct, '换手率是流通市值口径 ⇒ 必高于按总市值折出的')
    assert.deepEqual(result.data.pagination, { page: 1, size: 1, pages: 7, total: 21 })
  })
  await withFetch(async () => jsonResponse(paged([SW_METRICS_NULL_ROW], { total: 1 })), async () => {
    const result = await source.execute(request('ftshare_sw_industry_metrics', { industry_code: '801010.SI', start_date: '2026-10-14', end_date: '2026-10-14' }), new AbortController().signal)
    const row = result.data.item[0]
    assert.equal(row.amount_yuan, null)
    assert.equal(row.total_mv_yuan, null)
    assert.equal(row.constituent_count, null)
    assert.equal(row.pe_lyr_quantile, null)
    assert.equal(row.pe_lyr, 62.79, '同一行的 PE 本身仍有值')
    assert.equal(JSON.parse(JSON.stringify(row)).amount_yuan, null)
    assert.doesNotMatch(JSON.stringify(result.data), /NaN|undefined/)
    assert.equal(source.validateOutput(result.data), true)
  })
})

test('⛔ 申万日度：代码写法、level、区间方向与 size 上限都在参数层拦下', () => {
  const source = sourceFor('ftshare_sw_industry_metrics')
  const base = { start_date: '2026-08-01', end_date: '2026-08-31' }
  assert.throws(() => source.normalizeParams({ ...base, industry_code: '801010' }), /\.SI suffix/, '实测不带后缀只回 0 行、不回错')
  assert.throws(() => source.normalizeParams({ ...base, industry_code: '801010.SH' }), /\.SI suffix/)
  assert.throws(() => source.normalizeParams({ ...base, industry_code: '801010.SI', start_date: '2026-08-31', end_date: '2026-08-01' }), /start_date must not be later/)
  assert.throws(() => source.normalizeParams({ ...base, industry_code: '801010.SI', level: 1 }), /unsupported parameter: level/, '传错 layer 会静默回空，这颗能力根本不收它')
  assert.throws(() => source.normalizeParams({ ...base, industry_code: '801010.SI', size: 201 }), /size must be an integer from 1 to 200/)
  assert.equal(source.normalizeParams({ ...base, industry_code: '801010.si' }).industry_code, '801010.SI')
})

test('⛔ 申万日度：行业代码没生效或日期出区间时失败（两种失败上游都是静默的）', async () => {
  const source = sourceFor('ftshare_sw_industry_metrics')
  const params = { industry_code: '801010.SI', start_date: '2026-08-01', end_date: '2026-08-31' }
  await withFetch(async () => jsonResponse(paged([{ ...SW_METRICS_ROW, industryCode: '801030.SI' }], { total: 21 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_sw_industry_metrics', params), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /801030\.SI/); return true },
    )
  })
  await withFetch(async () => jsonResponse(paged([{ ...SW_METRICS_ROW, tradeDate: '2025-01-02' }], { total: 21 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_sw_industry_metrics', params), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /outside/); return true },
    )
  })
})

test('⛔ size 上限按上游逐颗对齐：1000 / 500 / 200 / 100 / 50 / 4000 六种都在，不许一视同仁', () => {
  const CAPS = {
    ftshare_stock_daily_flow: 1000, ftshare_industry_daily_flow: 1000, ftshare_concept_daily_flow: 1000, ftshare_ashare_quote: 1000,
    ftshare_main_capital_flow: 500, ftshare_daily_kline_snapshot: 500, ftshare_block_trades: 500,
    ftshare_performance_forecast: 500, ftshare_performance_express: 500, ftshare_sw_industry_overview: 500,
    ftshare_sw_industry_metrics: 200,
    // Limit price 1000, seats 500, holder number 1000, index weight 100: over-cap page sizes clamp silently.
    ftshare_limit_price: 1000, ftshare_dragon_tiger_seats: 500, ftshare_holder_number: 1000, ftshare_index_weight: 100,
    // Curves and lending rates cap at 1000, the calendar at 500; ⛔ LPR is absent because it takes no parameters.
    ftshare_chinabond_yield: 1000, ftshare_shibor: 1000, ftshare_hibor: 1000, ftshare_financial_calendar: 500,
    // Warrant / weekly / settle clamp silently to 4000; ⛔ futures limit price stops at 50 (SHFE 400s on whole pages past it: "missing pre-settlement price").
    ftshare_futures_warrant: 4000, ftshare_futures_weekly: 4000, ftshare_futures_settle: 4000,
    ftshare_futures_member_rank: 500, ftshare_futures_index_kline: 200, ftshare_bullion_price: 1000, ftshare_futures_limit_price: 50,
  }
  for (const [capability, max] of Object.entries(CAPS)) {
    const source = sourceFor(capability)
    const base = minimalParams(capability)
    assert.equal(source.normalizeParams({ ...base, size: max }).size, max, `${capability} 的上限 ${max} 本身必须放行`)
    assert.throws(() => source.normalizeParams({ ...base, size: max + 1 }), new RegExp(`size must be an integer from 1 to ${max}`),
      `${capability} 超限必须在参数层拒：上游要么静默截断、要么 400，两种都不许模型以为拿到了整页`)
    assert.equal(source.schema.input_schema.properties.size.maximum, max, `${capability} 的 input_schema 要把同一个上限写出来`)
  }
})

test('涨跌停价：全市场单日按请求翻页、字符串价转数值、null 与"带尾巴的涨停价"都原样保留', async () => {
  const source = sourceFor('ftshare_limit_price')
  await withFetch(async () => jsonResponse(itemsPaged([LIMIT_ROW, LIMIT_NULL_ROW, LIMIT_ODD_ROW], { total_items: 7587 })), async (calls) => {
    const result = await source.execute(request('ftshare_limit_price', { date: '2026-10-15', instrument_type: 'stock', page: 2, size: 1000 }), new AbortController().signal)
    assert.match(calls[0].url, new RegExp(`^${BASE}/api/v1/market/data/stk-limit\\?`))
    assert.match(calls[0].url, /trade_date=20261015/, '上游日期是 YYYYMMDD')
    assert.match(calls[0].url, /instrument_type=stock/)
    assert.match(calls[0].url, /page=2(&|$)/)
    assert.match(calls[0].url, /page_size=1000/, '实测 1000 可用（文档写最大 500，2000 会被静默夹断成 1000）')
    assert.deepEqual(result.data.item[0], {
      thscode: '920000.BJ', trade_date: '2026-10-15', trade_date_ms: Date.parse('2026-10-15T00:00:00+08:00'),
      instrument_type: 'stock', pre_close_yuan: 13.33, up_limit_yuan: 17.32, down_limit_yuan: 9.34,
    })
    assert.equal(result.data.item[1].up_limit_yuan, null, '⛔ 实测同日有 3 行上下限同时 null（920162.BJ 等），必须原样保留而不是补 0')
    assert.equal(result.data.item[2].up_limit_yuan, 12.649999, '⛔ 涨停价不是交易所口径的两位小数：11.50×1.1=12.65 而上游给 12.649999（同日 852/5576 只如此），本层不取整')
    assert.deepEqual(result.data.pagination, { page: 2, size: 3, pages: 8, total: 7587 })
  })
})

test('涨跌停价：区间/混用/裸码/枚举都在参数层拒，写法归一成短后缀', () => {
  const source = sourceFor('ftshare_limit_price')
  assert.throws(() => source.normalizeParams({ start_date: '2026-01-01', end_date: '2026-02-01' }), /require code/)
  assert.throws(() => source.normalizeParams({ code: '600519.SH', date: '2026-10-15', start_date: '2026-01-01' }), /provided together/)
  assert.throws(() => source.normalizeParams({ code: '600519.SH', date: '2026-10-15', start_date: '2026-01-01', end_date: '2026-02-01' }), /cannot combine with start_date/)
  assert.throws(() => source.normalizeParams({ code: '000001', date: '2026-10-15' }), /ambiguous/, '上游把裸 000001 当深市个股，本层不替模型猜')
  assert.throws(() => source.normalizeParams({ date: '2026-10-15', instrument_type: 'index' }), /must be one of stock \/ etf \/ cb/)
  assert.equal(source.normalizeParams({ code: '600519.XSHG', date: '2026-10-15' }).code, '600519.SH')
  assert.equal(source.normalizeParams({ code: '920001.BJ' }).code, '920001.BJ')
  assert.equal(source.normalizeParams({ code: '600519.SH', start_date: '2026-01-01', end_date: '2026-02-01' }).end_date, '2026-02-01')
})

test('涨跌停价：身份与日期回到 producer 里核，核不过就响亮失败', async () => {
  const source = sourceFor('ftshare_limit_price')
  await withFetch(async () => jsonResponse(itemsPaged([LIMIT_ROW], { total_items: 1 })), async (calls) => {
    await source.execute(request('ftshare_limit_price', { code: '920000.BJ', date: '2026-10-15' }), new AbortController().signal)
    assert.match(calls[0].url, /symbol=920000\.BJ/)
  })
  await withFetch(async () => jsonResponse(itemsPaged([{ ...LIMIT_ROW, ts_code: '600000.SH' }], { total_items: 1 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_limit_price', { code: '920000.BJ', date: '2026-10-15' }), new AbortController().signal),
      (error) => error instanceof FtshareError && /dropped the code filter/.test(error.message),
    )
  })
  await withFetch(async () => jsonResponse(itemsPaged([{ ...LIMIT_ROW, trade_date: 20261016 }], { total_items: 7587 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_limit_price', { date: '2026-10-15' }), new AbortController().signal),
      /outside the requested/,
    )
  })
})

test('龙虎榜席位：两组嵌套原样映射、change_ratio 是比例值、日期由请求补写', async () => {
  const source = sourceFor('ftshare_dragon_tiger_seats')
  await withFetch(async () => jsonResponse(paged([SEAT_ROW], { total: 68, pageNum: 1, pages: 34 })), async (calls) => {
    const result = await source.execute(request('ftshare_dragon_tiger_seats', { date: '2026-10-15', page: 2, size: 50 }), new AbortController().signal)
    assert.match(calls[0].url, /date=20261015/)
    assert.match(calls[0].url, /page=2(&|$)/)
    assert.equal(result.data.item[0].thscode, '600792.SH')
    assert.equal(result.data.item[0].trade_date, '2026-10-15', '⛔ 响应行内没有日期列，这一列是本层按请求补写的')
    assert.equal(result.data.item[0].trade_date_ms, Date.parse('2026-10-15T00:00:00+08:00'))
    assert.equal(result.data.item[0].change_ratio, -0.1, '⛔ 比例值（−0.1 = −10%），与日度族的 change_pct 不是一套、不换算')
    assert.equal(result.data.item[0].close_yuan, 4.5)
    assert.equal(result.data.item[0].turnover_yuan, 408986899)
    assert.deepEqual(result.data.item[0].top_buyers[0], { name: '国泰海通证券股份有限公司总部', buy_yuan: 16431904, sell_yuan: 26669525, net_yuan: -10237621 })
    assert.equal(result.data.item[0].top_sellers[1].net_yuan, -6249101)
    assert.deepEqual(result.data.pagination, { page: 2, size: 1, pages: 2, total: 68 })
  })
  await withFetch(async () => jsonResponse(paged([SEAT_CLASS_ROW], { total: 64 })), async () => {
    const result = await source.execute(request('ftshare_dragon_tiger_seats', { date: '2025-12-31' }), new AbortController().signal)
    const row = result.data.item[0]
    assert.equal(row.top_buyers.length, 4, '上游缺名次不补位（实测 2025-12-31 的 600343.SH 两边都只有 4 条）')
    assert.deepEqual(row.top_buyers.map((seat) => seat.name), ['机构', '其他自然人', '中小投资者', '沪股通'])
    assert.ok(row.top_buyers[0].buy_yuan > row.turnover_yuan, '⛔ 分类口径行的买入额可以大于当日成交额：不许拿 buy ÷ turnover 算占比')
    assert.deepEqual(row.top_buyers, row.top_sellers, '这一行两组的內容完全相同，是上游原文而不是本层映射出错')
  })
})

test('席位：date 必填（响应里没有日期列）、symbol 不给座位、size 押在实测的 500', () => {
  const source = sourceFor('ftshare_dragon_tiger_seats')
  assert.throws(() => source.normalizeParams({}), /parameter date must be YYYY-MM-DD/)
  assert.throws(() => source.normalizeParams({ date: '2026-10-14', symbol: '600792.SH' }), /unsupported parameter/, '实测上游收到 symbol 不报错也不过滤，这个座位是假过滤器')
  assert.throws(() => source.normalizeParams({ date: '2026-10-14', size: 501 }), /1 to 500/)
  assert.equal(source.schema.paginated, true)
})

test('⛔ data:null 是合法空而不是坏信封；缺 data 键才必须响亮失败', async () => {
  const seats = sourceFor('ftshare_dragon_tiger_seats')
  await withFetch(async () => jsonResponse(nullEnvelope()), async () => {
    const result = await seats.execute(request('ftshare_dragon_tiger_seats', { date: '2026-10-11' }), new AbortController().signal)
    assert.deepEqual(result.data.item, [], '非交易日上游回 data:null（实测），那是日历事实不是取数失败')
    assert.deepEqual(result.data.pagination, { page: 1, size: 0, pages: 1, total: 0 })
  })
  await withFetch(async () => jsonResponse({ code: 200, message: 'success' }), async () => {
    await assert.rejects(
      () => seats.execute(request('ftshare_dragon_tiger_seats', { date: '2026-10-14' }), new AbortController().signal),
      /missing data/,
    )
  })
})

test('股东人数：单票一次给全且不发 page，is_last 才翻页；null 与 0 都不改', async () => {
  const source = sourceFor('ftshare_holder_number')
  await withFetch(async () => jsonResponse(itemsPaged([HOLDER_ROW, HOLDER_OLD_ROW], { total_items: 2 })), async (calls) => {
    const result = await source.execute(request('ftshare_holder_number', { code: '600519.sh' }), new AbortController().signal)
    assert.match(calls[0].url, /stock_code=600519\.SH/, '实测小写后缀上游静默回 0 行，本层必须先归一')
    assert.doesNotMatch(calls[0].url, /page=/, '⛔ 单票模式上游不翻页（实测 page=2 / page_size=10 都照样给全部 107 期），发了等于把一份完整历史说成两页')
    assert.deepEqual(result.data.item[0], {
      thscode: '600519.SH', stock_name: '贵州茅台', publish_date: '2026-08-15', report_date: '2026-06-30',
      report_date_ms: Date.parse('2026-06-30T00:00:00+08:00'), holder_num: 296404, holder_num_change_pct: 21.8972,
      per_capita_circ_share: 4217.4923, per_capita_share_change_pct: null, chip_concentration: null,
      close_price_yuan: 1185.49, per_capita_hold_amount_yuan: 4999794.9999645416, ten_holder_pct: 67.6191, ften_holder_pct: 67.6191,
    })
    assert.equal(result.data.item[1].close_price_yuan, 0, '实测早期行 close_price 原样是 0（不是 null）：0 不是价格，本层不替它改成 null')
    assert.equal(result.data.item[1].holder_num_change_pct, null)
    assert.deepEqual(result.data.pagination, { page: 1, size: 2, pages: 1, total: 2 })
  })
  await withFetch(async () => jsonResponse(itemsPaged([HOLDER_ROW], { total_items: 5926 })), async (calls) => {
    const result = await source.execute(request('ftshare_holder_number', { is_last: true, page: 3, size: 500 }), new AbortController().signal)
    assert.match(calls[0].url, /is_last=true/)
    assert.doesNotMatch(calls[0].url, /stock_code=/)
    assert.deepEqual(result.data.pagination, { page: 3, size: 1, pages: 12, total: 5926 })
  })
})

test('股东人数：都不给、混给、静默写法与假过滤器座位都在参数层拒', () => {
  const source = sourceFor('ftshare_holder_number')
  assert.throws(() => source.normalizeParams({}), /one of code \/ is_last is required/, '实测什么都不给时上游回 total_items=0 且不报错')
  assert.throws(() => source.normalizeParams({ code: '600519.SH', is_last: true }), /mutually exclusive/)
  assert.throws(() => source.normalizeParams({ code: '000001' }), /ambiguous/)
  assert.throws(() => source.normalizeParams({ code: '600519.SH', report_date: '2026-06-30' }), /unsupported parameter/, '⛔ 实测上游收到 report_date 不报错也不过滤，那一句"我按报告期筛过了"是假的')
  assert.throws(() => source.normalizeParams({ is_last: 'zzz' }), /is_last must be a boolean/)
  assert.equal(source.normalizeParams({ code: '000001.XSHE' }).code, '000001.SZ')
})

test('指数权重：第四套信封 index_weights、权重按百分数透出、url_hash 不带出', async () => {
  const source = sourceFor('ftshare_index_weight')
  await withFetch(async () => jsonResponse(weightsPaged([WEIGHT_ROW], { total: 300, page: 3, page_size: 100 })), async (calls) => {
    const result = await source.execute(request('ftshare_index_weight', { index_code: '000300.SH', date: '2026-09-30', page: 3, size: 100 }), new AbortController().signal)
    assert.match(calls[0].url, /index_code=000300(&|$)/, '⛔ 上游对带后缀写法静默回 0 行（实测），本层折成裸码再发')
    assert.match(calls[0].url, /date=20260930/)
    assert.deepEqual(result.data.item[0], {
      index_code: '000300', collect_date: '2026-09-30', collect_date_ms: Date.parse('2026-09-30T00:00:00+08:00'),
      component_code: '000001', component_name: '平安银行', weight_pct: 0.453,
    })
    assert.equal('url_hash' in result.data.item[0], false, 'xlsx 下载 hash 不属于模型可见面')
    assert.deepEqual(result.data.pagination, { page: 3, size: 1, pages: 3, total: 300 })
  })
  await withFetch(async () => jsonResponse(weightsPaged([{ ...WEIGHT_ROW, date: '2026-06-15' }], { total: 300 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_index_weight', { index_code: '000300', date: '2026-09-30' }), new AbortController().signal),
      /dropped the date filter/,
    )
  })
  await withFetch(async () => jsonResponse(weightsPaged([{ ...WEIGHT_ROW, index_code: '000905' }], { total: 500 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_index_weight', { index_code: '000300' }), new AbortController().signal),
      /dropped the index_code filter/,
    )
  })
})

test('指数权重：写法归一与"不许替用户换指数"，size 上限 100（实测静默夹断）', () => {
  const source = sourceFor('ftshare_index_weight')
  assert.equal(source.normalizeParams({ index_code: '000300.SH' }).index_code, '000300')
  assert.equal(source.normalizeParams({ index_code: '399001.SZ' }).index_code, '399001')
  assert.throws(() => source.normalizeParams({ index_code: '000001.SZ' }), /conflicts/, '折成裸码就是上证综指（实测 2230 只成分），等于本层替用户换了一个指数')
  assert.throws(() => source.normalizeParams({ index_code: '801010.SI' }), /six-digit index code/, '申万码带 .SI，不在这一族（实测 801010 也回 0 行）')
  assert.throws(() => source.normalizeParams({ index_code: '000300', size: 101 }), /1 to 100/)
  assert.throws(() => source.normalizeParams({ size: 3 }), /index_code/)
})

test('可转债 K 线：毫秒边界按北京时间、ts_millis 推日期、量纲是张、写法归一', async () => {
  const source = sourceFor('ftshare_convertible_bond_kline')
  await withFetch(async () => jsonResponse({ code: 200, message: 'success', data: [CB_ROW] }), async (calls) => {
    const result = await source.execute(request('ftshare_convertible_bond_kline', { code: '113042', period: 'DAY', adjust: 'None', start_date: '2026-08-10', end_date: '2026-08-14', limit: 5 }), new AbortController().signal)
    const url = new URL(calls[0].url)
    assert.equal(url.searchParams.get('since_ts_millis'), String(Date.parse('2026-08-10T00:00:00+08:00')), '起始按北京时间整日 00:00')
    assert.equal(url.searchParams.get('until_ts_millis'), String(Date.parse('2026-08-14T23:59:59+08:00')), '截止按北京时间整日 23:59:59')
    assert.equal(url.searchParams.get('interval_unit'), 'day', '上游对 period 大小写不敏感、对 adjust 敏感，本层统一转小写')
    assert.equal(url.searchParams.get('adjust_kind'), 'none')
    assert.equal(url.searchParams.get('symbol'), '113042', '实测裸码与带正确后缀逐字节相同，本层不猜交易所')
    assert.equal(result.data.item[0].trade_date, '2026-08-10', 'ts_millis 是这根 K 的结束时刻（15:00 北京 = 07:00 UTC），日期必须按 +08:00 推')
    assert.deepEqual(result.data.item[0], {
      thscode: '113042', trade_date: '2026-08-10', trade_date_ms: 1786345200000, ts_millis: 1786345200000, ts_millis_open: 1786325400000,
      open_yuan: 117.198, high_yuan: 117.5, low_yuan: 116.801, close_yuan: 116.838, turnover_yuan: 204117771.83, volume_tickets: 1741950,
    })
    const row = result.data.item[0]
    const avg = row.turnover_yuan / row.volume_tickets
    assert.ok(avg >= row.low_yuan && avg <= row.high_yuan, `均价 ${avg} 应当落在 [${row.low_yuan}, ${row.high_yuan}]，否则 volume 不是张`)
    assert.deepEqual(result.data.pagination, { page: 1, size: 1, pages: 1, total: 1 }, '没有分页信封，pagination 由本层合成')
  })
  await withFetch(async () => jsonResponse({ code: 200, message: 'success', data: [{ ...CB_ROW, ts_millis: Date.parse('2026-09-01T07:00:00Z') }] }), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_convertible_bond_kline', { code: '113042.SH', start_date: '2026-08-10', end_date: '2026-08-14' }), new AbortController().signal),
      /outside the requested/,
    )
  })
})

test('可转债 K 线：不做首位猜测、复权与周期枚举、limit 与区间方向都拦', () => {
  const source = sourceFor('ftshare_convertible_bond_kline')
  const base = { code: '113042', start_date: '2026-08-10', end_date: '2026-08-14' }
  assert.equal(source.normalizeParams({ ...base, code: '113042.SH' }).code, '113042.SH')
  assert.equal(source.normalizeParams({ ...base, code: '113042.XSHG' }).code, '113042.SH')
  assert.equal(source.normalizeParams({ ...base, code: '126001.SH' }).code, '126001.SH', '⛔ 126 段老沪债不能被"11 开头才是沪市"那套首位规则误杀')
  assert.throws(() => source.normalizeParams({ ...base, period: 'minute' }), /must be one of day \/ week \/ month \/ year/, '分钟档是另一个端点（实测上游点名指路）')
  assert.throws(() => source.normalizeParams({ ...base, adjust: 'qfq' }), /must be one of none \/ forward \/ backward/)
  assert.throws(() => source.normalizeParams({ ...base, limit: 0 }), /limit must be an integer/, '实测 limit=0 静默回 0 行，会被读成"这只券没有行情"')
  assert.throws(() => source.normalizeParams({ code: base.code, start_date: '2026-08-14', end_date: '2026-08-10' }), /not be later/)
  assert.throws(() => source.normalizeParams({ ...base, end_date: undefined }), /end_date must be YYYY-MM-DD/)
  assert.throws(() => source.normalizeParams({ ...base, interval_value: 2 }), /unsupported parameter/, '实测 interval_value 对日档不改变结果，不给这个座位')
  assert.throws(() => source.normalizeParams({ ...base, page: 2 }), /unsupported parameter/)
})

test('LPR：一颗参数都没有、一次给完全历史；多发参数在参数层拒', async () => {
  const source = sourceFor('ftshare_lpr')
  assert.deepEqual(source.schema.input_schema, { type: 'object', properties: {}, required: [], additionalProperties: false })
  assert.equal(source.schema.paginated, false)
  await withFetch(async () => jsonResponse({ code: 200, message: 'success', data: [LPR_ROW, LPR_5Y_FIRST_ROW, LPR_NULL_ROW] }), async (calls) => {
    const result = await source.execute(request('ftshare_lpr', {}), new AbortController().signal)
    assert.equal(calls.length, 1)
    // Appending any query string would pretend to filter what upstream ignores.
    assert.equal(calls[0].url, `${BASE}/api/v1/market/data/economic/china-lpr`)
    assert.deepEqual(result.data.item[0], {
      trade_date: '2026-09-20', trade_date_ms: Date.parse('2026-09-20T00:00:00+08:00'), lpr_1y_pct: 3, lpr_5y_pct: 3.5,
    })
    assert.equal(result.data.item[1].lpr_5y_pct, 4.85, '实测 5y 那档的首个非空就是 2019-08-20 的 4.8500')
    assert.equal(result.data.item[2].lpr_5y_pct, null, '⛔ 2019-08-20 之前整列为 null（实测 2125 / 2661 行），null 不是 0')
    assert.deepEqual(result.data.pagination, { page: 1, size: 3, pages: 1, total: 3 }, '全量给完就是 1 页，不许按 100 行的默认值编出页数')
  })
  for (const params of [{ start_date: '2026-01-01', end_date: '2026-10-01' }, { page: 2 }, { size: 10 }, { date: '2026-09-20' }]) {
    assert.throws(() => source.normalizeParams(params), /unsupported parameter/, JSON.stringify(params))
  }
  assert.throws(() => source.normalizeParams({ start_date: '2026-01-01' }), /静默忽略/, '拒绝的理由要说清是上游吞参数，不是我们没有这个口径')
  assert.deepEqual(source.normalizeParams({}), {})
})

test('中债收益率曲线：枚举把精确匹配搬到参数层、曲线名回 producer 里核、null 期限原样透出', async () => {
  const source = sourceFor('ftshare_chinabond_yield')
  await withFetch(async () => jsonResponse(paged([CHINABOND_GOV_ROW], { total: 6 })), async (calls) => {
    const result = await source.execute(request('ftshare_chinabond_yield', { start_date: '2026-10-01', end_date: '2026-10-15', curve_name: '中债国债收益率曲线', page: 1, size: 1000 }), new AbortController().signal)
    assert.match(calls[0].url, new RegExp(`^${BASE}/api/v1/market/data/chinabond-yield-daily\\?`))
    assert.match(calls[0].url, /start_date=20261001(&|$)/)
    assert.match(calls[0].url, /page_size=1000/, '实测上限 1000，1001 是响亮 400「page_size must be between 1 and 1000」')
    assert.equal(decodeURIComponent(calls[0].url).includes('curve_name=中债国债收益率曲线'), true, '曲线名要真的发出去')
    assert.deepEqual(result.data.item[0], {
      curve_name: '中债国债收益率曲线', trade_date: '2026-10-15', trade_date_ms: Date.parse('2026-10-15T00:00:00+08:00'),
      y_3m_pct: 1.1618, y_6m_pct: 1.1625, y_1y_pct: 1.1803, y_3y_pct: 1.2694, y_5y_pct: 1.39, y_7y_pct: 1.4866, y_10y_pct: 1.6601, y_30y_pct: 2.07,
    })
    assert.deepEqual(result.data.pagination, { page: 1, size: 1, pages: 1, total: 6 }, '实测同一三天窗里每条曲线各 6 行（三条合计 18 行）')
  })
  await withFetch(async () => jsonResponse(paged([CHINABOND_NOTE_ROW, CHINABOND_EARLY_ROW], { total: 2 })), async () => {
    const result = await source.execute(request('ftshare_chinabond_yield', { start_date: '2002-01-01', end_date: '2026-10-15' }), new AbortController().signal)
    assert.equal(result.data.item[0].y_30y_pct, null)
    assert.equal(result.data.item[1].y_10y_pct, null, '期限点是随日期长出来的：票据曲线 2006-12-25 那一行只有三档有值')
  })
  await withFetch(async () => jsonResponse(paged([CHINABOND_NOTE_ROW], { total: 1 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_chinabond_yield', { start_date: '2026-10-01', end_date: '2026-10-15', curve_name: '中债国债收益率曲线' }), new AbortController().signal),
      (error) => error instanceof FtshareError && /dropped the curve_name filter/.test(error.message),
    )
  })
  await withFetch(async () => jsonResponse(paged([{ ...CHINABOND_GOV_ROW, trade_date: '2026-10-16' }], { total: 1 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_chinabond_yield', { start_date: '2026-10-01', end_date: '2026-10-15' }), new AbortController().signal),
      /outside the requested/,
    )
  })
})

test('中债收益率曲线：三条枚举、空白写法、方向与日期写法都在参数层拦', () => {
  const source = sourceFor('ftshare_chinabond_yield')
  const base = { start_date: '2026-10-01', end_date: '2026-10-15' }
  assert.equal(source.normalizeParams({ ...base, curve_name: '中债国债收益率曲线' }).curve_name, '中债国债收益率曲线')
  // Unknown names reply 0 rows, blank ones 400 ("curve_name must not be blank"); both are rejected here.
  for (const curve of ['中债国债', 'USDT', ' 中债国债收益率曲线 ', '']) {
    assert.throws(() => source.normalizeParams({ ...base, curve_name: curve }), /must be exactly one of/, JSON.stringify(curve))
  }
  assert.throws(() => source.normalizeParams({ start_date: '2026-10-15', end_date: '2026-10-01' }), /must not be later/)
  assert.throws(() => source.normalizeParams({ start_date: '20261001', end_date: '2026-10-15' }), /parameter start_date must be YYYY-MM-DD/, '上游要 YYYYMMDD、本层收 ISO，带横杠的写法在归一化这一层完成')
  assert.throws(() => source.normalizeParams({ end_date: '2026-10-15' }), /parameter start_date must be YYYY-MM-DD/)
  assert.equal(source.schema.input_schema.properties.curve_name.enum.length, 3, '⛔ 实测只有三条曲线（2002 起的窗口逐页取满也只这三条），枚举多写一条就是编造')
})

test('SHIBOR 与 HIBOR 同形不同档：列名逐字对齐报文，不许把另一路的期限表套过来', async () => {
  const shibor = sourceFor('ftshare_shibor')
  await withFetch(async () => jsonResponse(paged([SHIBOR_ROW], { total: 6 })), async (calls) => {
    const result = await shibor.execute(request('ftshare_shibor', { start_date: '2026-10-01', end_date: '2026-10-15' }), new AbortController().signal)
    assert.match(calls[0].url, new RegExp(`^${BASE}/api/v1/market/data/shibor-daily\\?`))
    assert.deepEqual(result.data.item[0], {
      trade_date: '2026-10-15', trade_date_ms: Date.parse('2026-10-15T00:00:00+08:00'),
      on_rate_pct: 1.266, w1_pct: 1.346, w2_pct: 1.3493, m1_pct: 1.4111, m3_pct: 1.43, m6_pct: 1.4478, m9_pct: 1.463, y1_pct: 1.474,
    })
    assert.deepEqual(result.data.pagination, { page: 1, size: 1, pages: 1, total: 6 })
  })
  const hibor = sourceFor('ftshare_hibor')
  await withFetch(async () => jsonResponse(paged([HIBOR_ROW], { total: 6 })), async (calls) => {
    const result = await hibor.execute(request('ftshare_hibor', { start_date: '2026-10-01', end_date: '2026-10-15' }), new AbortController().signal)
    assert.match(calls[0].url, /\/api\/v1\/market\/data\/hibor-daily\?/)
    const row = result.data.item[0]
    assert.equal(Object.keys(row).length, 17, '一行 = 日期两列 + 十五档，一档不多一档不少')
    assert.equal(row.m4_pct, null, '⛔ m4 / m5 / m7..m11 七档实测整列为 null（HIBOR 就公布这些档），不是缺数据、不许补 0')
    assert.equal(row.m12_pct, 4, '上游写 4.0，透出是数值 4')
    assert.equal(row.on_rate_pct, 2.16821)
    assert.equal('y1_pct' in row, false, '⛔ HIBOR 没有 y1 这一档：把 SHIBOR 的表套过来等于编一个不存在的读数')
  })
  await withFetch(async () => jsonResponse(paged([{ ...SHIBOR_ROW, trade_date: '2026-11-01' }], { total: 1 })), async () => {
    await assert.rejects(
      () => shibor.execute(request('ftshare_shibor', { start_date: '2026-10-01', end_date: '2026-10-15' }), new AbortController().signal),
      /outside the requested/, '周末与未发布日没有行是上游事实，但区间外的行一定是上游改版'
    )
  })
})

test('SHIBOR / HIBOR 的参数面：日期必填、方向拦下、没有的座位一个不给', () => {
  for (const capability of ['ftshare_shibor', 'ftshare_hibor']) {
    const source = sourceFor(capability)
    const base = { start_date: '2026-10-01', end_date: '2026-10-15' }
    assert.throws(() => source.normalizeParams({ end_date: '2026-10-15' }), /parameter start_date must be YYYY-MM-DD/)
    assert.throws(() => source.normalizeParams({ start_date: '2026-10-15', end_date: '2026-10-01' }), /must not be later/)
    assert.throws(() => source.normalizeParams({ ...base, tenor: '3m' }), /unsupported parameter/, '期限是宽表列、不是过滤器（实测上游没有这个参数）')
    assert.equal(source.normalizeParams(base).size, 100)
  }
})

test('财经日历：秒转毫秒 + 北京时刻，importance 归一整数、空串归一 null、读数保持文本', async () => {
  const source = sourceFor('ftshare_financial_calendar')
  await withFetch(async () => jsonResponse(paged([CALENDAR_EARNINGS_ROW, CALENDAR_MACRO_ROW], { total: 113 })), async (calls) => {
    const result = await source.execute(request('ftshare_financial_calendar', { start_date: '2026-10-15', end_date: '2026-10-17', size: 500 }), new AbortController().signal)
    assert.match(calls[0].url, new RegExp(`^${BASE}/api/v1/market/data/finance/financial-calendar/wallstreetcn\\?`))
    assert.match(calls[0].url, /start_date=20261015(&|$)/)
    assert.match(calls[0].url, /page_size=500/, '实测真实上限 500（文档写 200），传 1000 会被静默夹成 500')
    assert.deepEqual(result.data.item[0], {
      stat_date: '2026-10-15', stat_date_ms: Date.parse('2026-10-15T00:00:00+08:00'),
      event_time_ms: 1791993600000, event_time_beijing: '2026-10-15 00:00',
      tab_type: 'earnings', region: '香港', event: '赣锋锂业',
      importance: null, actual_value: '0', forecast_value: '0', previous_value: null, link: null,
    })
    assert.equal(result.data.item[0].event_time_ms, 1791993600 * 1000, '⛔ 上游给的是**秒**：直接当毫秒会差三个数量级')
    assert.equal(result.data.item[0].actual_value, '0', '⛔ 财报占位的 0 原样透出，它不是"实际值为零"')
    assert.deepEqual(result.data.item[1], {
      stat_date: '2026-10-15', stat_date_ms: Date.parse('2026-10-15T00:00:00+08:00'),
      event_time_ms: 1792067400000, event_time_beijing: '2026-10-15 20:30',
      tab_type: 'general', region: '美国', event: '10月10日当周首次申请失业救济人数(万人)',
      importance: 3, actual_value: '19.9', forecast_value: '20', previous_value: '19.7', link: 'https://wallstreetcn.com/calendar/US121055/overview',
    })
    assert.equal(typeof result.data.item[1].actual_value, 'string', '⛔ 单位随事件本身变（万人 / % / 点…），本层不转数值也不换算')
    assert.deepEqual(result.data.pagination, { page: 1, size: 2, pages: 1, total: 113 })
  })
  await withFetch(async () => jsonResponse(nullEnvelope()), async () => {
    const result = await source.execute(request('ftshare_financial_calendar', { start_date: '2023-01-09', end_date: '2023-01-09' }), new AbortController().signal)
    assert.deepEqual(result.data.item, [])
    assert.deepEqual(result.data.pagination, { page: 1, size: 0, pages: 1, total: 0 })
  })
  await withFetch(async () => jsonResponse(paged([{ ...CALENDAR_MACRO_ROW, stat_date: '2026-10-20' }], { total: 1 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_financial_calendar', { start_date: '2026-10-15', end_date: '2026-10-17' }), new AbortController().signal),
      /outside the requested/, '上游对窗口的遵守只能回来核：核不过就是改版，不许落错日期的盘',
    )
  })
})

test('⛔ 财经日历的 3 天窗是硬闸门：4 天在参数层拒，本层不替模型分段循环取', () => {
  const source = sourceFor('ftshare_financial_calendar')
  assert.equal(source.normalizeParams({ start_date: '2026-10-15', end_date: '2026-10-18' }).end_date, '2026-10-18', '实测 3 天差上游通过')
  for (const end_date of ['2026-10-19', '2026-10-20', '2026-12-31']) {
    assert.throws(() => source.normalizeParams({ start_date: '2026-10-15', end_date }), /spans \d+ days/, end_date)
  }
  assert.throws(() => source.normalizeParams({ start_date: '2026-10-18', end_date: '2026-10-15' }), /must not be later/, '实测上游同样 400「结束时间不能早于开始时间」')
  assert.throws(() => source.normalizeParams({ start_date: '2026-10-15', end_date: '2026-10-17', size: 501 }), /1 to 500/)
  assert.throws(() => source.normalizeParams({ start_date: '2026-10-15', end_date: '2026-10-17', size: 0 }), /1 to 500/, '实测 page_size=0 静默只回 1 行（信封还回显 pageSize=1），会被读成"这一天只有一个事件"')
  assert.throws(() => source.normalizeParams({ start_date: '2026-10-15', end_date: '2026-10-17', region: '美国' }), /unsupported parameter/, '上游没有地区参数，这个过滤器是假的')
})

test('期货清单快照：items + 回显交易日补写时间轴、两份 future_type 副本原样都带出、没有分页座位', async () => {
  const source = sourceFor('ftshare_futures_contracts')
  await withFetch(async () => jsonResponse(itemsSnapshot([FUTURES_LIST_ROW, FUTURES_LIST_ROW_COPY])), async (calls) => {
    const result = await source.execute(request('ftshare_futures_contracts', { trade_date: '2026-10-15' }), new AbortController().signal)
    assert.match(calls[0].url, new RegExp(`^${BASE}/api/v1/market/data/futures/futures-lists\\?trade_date=20261015$`))
    assert.deepEqual(result.data.item, [
      { symbol: 'IC2610.CFE', exchange: 'CFFEX', product: 'IC', contract_name: '中证500股指期货', future_type: null, trade_date: '2026-10-15', trade_date_ms: Date.parse('2026-10-15T00:00:00+08:00') },
      { symbol: 'IC2610.CFE', exchange: 'CFFEX', product: 'IC', contract_name: '中证500股指期货', future_type: 2, trade_date: '2026-10-15', trade_date_ms: Date.parse('2026-10-15T00:00:00+08:00') },
    ], '同一只合约的两份副本原样都带出：本层不替模型去重，也不悄悄丢掉 null 那一份')
    assert.deepEqual(result.data.pagination, { page: 1, size: 2, pages: 1, total: 2 })
  })
  await withFetch(async () => jsonResponse(itemsSnapshot([FUTURES_LIST_ROW], { trade_date: 20261015 })), async (calls) => {
    const result = await source.execute(request('ftshare_futures_contracts', {}), new AbortController().signal)
    assert.equal(calls[0].url.includes('trade_date'), false, '省略时一个日期参数都不发')
    assert.equal(result.data.item[0].trade_date, '2026-10-15', '行内没有日期列，时间轴只能取 data.trade_date 的回显')
  })
  assert.throws(() => source.normalizeParams({ page: 2 }), /unsupported parameter/, '实测 page_size=10 仍回全量 1812 行：分页座位是假的')
})

test('期货合约要素：规则文字改名成 *_rule、被丢弃的列不带出、symbol 大小写都收且发给上游是大写', async () => {
  const source = sourceFor('ftshare_futures_contract_detail')
  await withFetch(async () => jsonResponse(itemsSnapshot([FUTURES_DETAIL_ROW, { ...FUTURES_DETAIL_ROW, future_type: 2 }])), async (calls) => {
    const result = await source.execute(request('ftshare_futures_contract_detail', { trade_date: '2026-10-15', symbol: 'ag2610.shf' }), new AbortController().signal)
    assert.match(calls[0].url, /symbol=AG2610.SHF/, '上游大小写不敏感（实测小写也命中），本层统一转大写发出去')
    assert.match(calls[0].url, /trade_date=20261015/)
    const row = result.data.item[0]
    assert.equal(row.delivery_date_rule, '最后交易日后连续二个工作日', '⛔ 这一列装的是规则文字：改名后它不会被当成日期列')
    assert.equal(row.last_trade_date_rule.startsWith('合约月份的15日'), true)
    assert.equal(row.list_date, '2025-10-16'); assert.equal(row.list_date_ms, Date.parse('2025-10-16T00:00:00+08:00'))
    assert.equal(row.delist_date, '2026-10-15')
    assert.equal(row.quote_unit, '人民币元/千克', 'put_price 是报价单位文字，命名成 quote_unit 免得读成价格')
    assert.equal(row.trade_unit, '千克'); assert.equal(row.multiplier, 15)
    assert.equal(row.spot_symbol, null, '空串与 null 都不补值')
    for (const dropped of ['price_unit', 'mean_cal_value', 'type_code', 'sub_type_code', 'value_info', 'position_limit_info', 'last_trade_date_hour']) {
      assert.ok(!(dropped in row), `${dropped} 是本层按实测丢弃的列（口径未披露或整列为空串），不许悄悄带出`)
    }
  })
  await withFetch(async () => jsonResponse(itemsSnapshot([])), async () => {
    const result = await source.execute(request('ftshare_futures_contract_detail', { symbol: 'ZZZZ9999.SHF' }), new AbortController().signal)
    assert.deepEqual(result.data.item, [])
  })
  await withFetch(async () => jsonResponse(itemsSnapshot([{ ...FUTURES_DETAIL_ROW, symbol: 'AU2612.SHF' }])), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_futures_contract_detail', { symbol: 'AG2610.SHF' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /symbol/); return true },
    )
  })
  assert.throws(() => source.normalizeParams({ symbol: '600519.SH' }), /期货合约代码/, '个股代码不许打到这里（实测上游对认不出的写法只回空）')
})

test('期货 K 线：后缀映射表把四颗短后缀换成 CTP 全称、裸码放行、银行间响亮拒', () => {
  const source = sourceFor('ftshare_futures_kline')
  assert.equal(source.normalizeParams({ symbol: 'AG2610.SHF' }).symbol, 'AG2610.SHFE')
  assert.equal(source.normalizeParams({ symbol: 'IC2610.CFE' }).symbol, 'IC2610.CFFEX')
  assert.equal(source.normalizeParams({ symbol: 'IC2610.CFX' }).symbol, 'IC2610.CFFEX', '涨跌停与结算那颗把中金所写成 .CFX，也得能打到 K 线')
  assert.equal(source.normalizeParams({ symbol: 'AP610.ZCE' }).symbol, 'AP610.CZCE', '同一所三种拼法实测都存在')
  assert.equal(source.normalizeParams({ symbol: 'LC2610.GFE' }).symbol, 'LC2610.GFEX')
  assert.equal(source.normalizeParams({ symbol: 'A2611.DCE' }).symbol, 'A2611.DCE')
  assert.equal(source.normalizeParams({ symbol: 'A2611' }).symbol, 'A2611', '实测裸码上游认（219 行），但它没有交易所身份，本层不补')
  assert.equal(source.normalizeParams({ symbol: 'cu2612.shfe' }).symbol, 'CU2612.SHFE', '实测大小写不敏感，本层统一大写')
  // Interbank varieties are listed but have no quote endpoint (.NIB 400s); reject by name.
  assert.throws(() => source.normalizeParams({ symbol: 'ADBC10_2612.IB' }), /银行间/, '银行间债券远期不在这颗上游')
  assert.throws(() => source.normalizeParams({ symbol: 'AG2610.XYZ' }), /认不出/)
})

test('期货 K 线：interval 白名单、end 不许单独给、limit 0 与负数都拦、日期只收串', () => {
  const source = sourceFor('ftshare_futures_kline')
  for (const interval of ['daily', 'weekly', 'monthly', 'quarterly', 'DAILY']) {
    assert.ok(['daily', 'weekly', 'monthly', 'quarterly'].includes(source.normalizeParams({ symbol: 'CU2612.SHFE', interval }).interval), interval)
  }
  // Unknown interval spellings reply 200 with 0 rows, so passing them through would fake an empty range.
  for (const interval of ['1d', '1w', 'week', 'day', '1M', '1Q', '60m', '1h', '']) {
    assert.throws(() => source.normalizeParams({ symbol: 'CU2612.SHFE', interval }), /interval must be one of/, interval)
  }
  assert.throws(() => source.normalizeParams({ symbol: 'CU2612.SHFE', end_date: '2026-10-15' }), /end_date 不能单独给/)
  assert.throws(() => source.normalizeParams({ symbol: 'CU2612.SHFE', start_date: '2026-10-15', end_date: '2026-10-08' }), /must not be later/)
  assert.throws(() => source.normalizeParams({ symbol: 'CU2612.SHFE', limit: 0 }), /limit must be an integer >= 1/, '实测 limit=0 回 1 行而 total 仍报 198')
  assert.throws(() => source.normalizeParams({ symbol: 'CU2612.SHFE', limit: -5 }), /limit must be an integer >= 1/)
  assert.throws(() => source.normalizeParams({ symbol: 'CU2612.SHFE', start_date: 20260906 }), /YYYY-MM-DD/, '⛔ 上游要毫秒整数，把 YYYYMMDD 直接转过去实测回 0 行，所以本层只收日期串')
  assert.equal(source.normalizeParams({ symbol: 'CU2612.SHFE', start_date: '2026-10-08' }).start_date, '2026-10-08', '实测只给 start 上游照样返回')
})

test('期货 K 线执行：日期换毫秒、身份按剥后缀比、total 用上游那个而不是行数', async () => {
  const source = sourceFor('ftshare_futures_kline')
  await withFetch(async () => jsonResponse(itemsTotal([FUTURES_KLINE_ROW], 198)), async (calls) => {
    const result = await source.execute(request('ftshare_futures_kline', { symbol: 'CU2612.SHF', interval: 'daily', start_date: '2026-10-08', end_date: '2026-10-15', limit: 500 }), new AbortController().signal)
    assert.match(calls[0].url, /symbol=CU2612\.SHFE/, '发给上游的是映射后的全称后缀（实测短后缀 400）')
    assert.match(calls[0].url, new RegExp(`start=${Date.parse('2026-10-08T00:00:00+08:00')}`))
    assert.match(calls[0].url, new RegExp(`end=${Date.parse('2026-10-15T23:59:59+08:00')}`))
    assert.deepEqual(result.data.item, [{
      contract: 'CU2612.SHFE', symbol: 'cu2612', trade_date: '2026-10-15', trade_date_ms: Date.parse('2026-10-15T00:00:00+08:00'),
      bar_time_ms: 1792047600000, open_price: 110200, high_price: 110290, low_price: 108260, close_price: 108290,
      volume_lots: 75498, turnover_yuan: 41189137900, vwap_per_lot_yuan: 545565.9474423163, open_interest_lots: 163309,
    }])
    assert.deepEqual(result.data.pagination, { page: 1, size: 1, pages: 1, total: 198 }, '⛔ limit 截断要看得见：上游报的区间根数不能被子丢')
    for (const dropped of ['dominant_contract', 'forward_factor', 'backward_factor']) assert.ok(!(dropped in result.data.item[0]), `${dropped} 实测 194 行全 null，不收录`)
  })
  await withFetch(async () => jsonResponse(itemsTotal([{ ...FUTURES_KLINE_ROW, symbol: 'cu2610' }], 198)), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_futures_kline', { symbol: 'CU2612.SHFE', start_date: '2026-10-08', end_date: '2026-10-15' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /cu2612|CU2612/, error.message); return true },
      '行里的 symbol 是去后缀小写写法，核身份要比剥掉后缀的那一半',
    )
  })
  await withFetch(async () => jsonResponse(itemsTotal([{ ...FUTURES_KLINE_ROW, trade_date: 20260901 }], 198)), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_futures_kline', { symbol: 'CU2612.SHFE', start_date: '2026-10-08', end_date: '2026-10-15' }), new AbortController().signal),
      /outside the requested/,
    )
  })
})

test('期货涨跌停：exchange 必填、单日与区间互斥、页宽 50 是实测上限', () => {
  const source = sourceFor('ftshare_futures_limit_price')
  assert.throws(() => source.normalizeParams({ trade_date: '2026-10-15' }), /exchange/, '实测缺失上游 400「缺少必填参数：交易所」')
  assert.equal(source.normalizeParams({ exchange: 'shfe', trade_date: '2026-10-15' }).exchange, 'SHFE')
  assert.throws(() => source.normalizeParams({ exchange: 'CFX', trade_date: '2026-10-15' }), /must be one of/, '行里出现 .CFX 写法，但 exchange 这一档只认六家常规名')
  assert.throws(() => source.normalizeParams({ exchange: 'SHFE', trade_date: '2026-10-15', start_date: '2026-10-08' }), /二选一/)
  assert.throws(() => source.normalizeParams({ exchange: 'SHFE' }), /至少要给一组/)
  assert.throws(() => source.normalizeParams({ exchange: 'SHFE', start_date: '2026-10-08' }), /必须同时给/)
  assert.equal(source.normalizeParams({ exchange: 'SHFE', trade_date: '2026-10-15', size: 50 }).size, 50)
  assert.throws(() => source.normalizeParams({ exchange: 'SHFE', trade_date: '2026-10-15', size: 51 }), /1 to 50/, '实测 SHFE 60 起整页 400「missing pre-settlement price」')
  assert.equal(source.normalizeParams({ exchange: 'SHFE', trade_date: '2026-10-15', ts_code: 'ag2610.shf' }).ts_code, 'AG2610.SHF')
  assert.equal(source.normalizeParams({ exchange: 'SHFE', trade_date: '2026-10-15', cont: 'ag' }).cont, 'AG')
})

test('期货涨跌停执行：字符串价转数值、m_ratio 改名带百分数口径、行内 .CFX 也核得住', async () => {
  const source = sourceFor('ftshare_futures_limit_price')
  await withFetch(async () => jsonResponse(paged([FUTURES_LIMIT_ROW], { total: 301 })), async (calls) => {
    const result = await source.execute(request('ftshare_futures_limit_price', { exchange: 'SHFE', trade_date: '2026-10-15', page: 2, size: 50 }), new AbortController().signal)
    assert.match(calls[0].url, /exchange=SHFE&.*trade_date=20261015|trade_date=20261015.*exchange=SHFE/)
    assert.match(calls[0].url, /page=2&page_size=50|page_size=50.*page=2/)
    assert.deepEqual(result.data.item, [{
      ts_code: 'AD2610.SHF', exchange: 'SHFE', product: 'AD', contract_name: '铸造铝合金2610',
      trade_date: '2026-10-15', trade_date_ms: Date.parse('2026-10-15T00:00:00+08:00'),
      up_limit_price: 25165, down_limit_price: 21435, m_ratio_pct: 20,
    }])
    assert.deepEqual(result.data.pagination, { page: 2, size: 1, pages: 7, total: 301 })
  })
  await withFetch(async () => jsonResponse(paged([FUTURES_LIMIT_ROW_CFFEX], { total: 28 })), async () => {
    const result = await source.execute(request('ftshare_futures_limit_price', { exchange: 'CFFEX', trade_date: '2026-10-15' }), new AbortController().signal)
    assert.equal(result.data.item[0].ts_code, 'IC2610.CFX')
    assert.equal(result.data.item[0].exchange, 'CFFEX', '行里的 exchange 列本来就是全称写法，核身比的是它')
  })
  await withFetch(async () => jsonResponse(paged([{ ...FUTURES_LIMIT_ROW, ts_code: 'AG2612.SHF' }], { total: 301 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_futures_limit_price', { exchange: 'SHFE', trade_date: '2026-10-15', ts_code: 'AG2610.SHFE' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /ts_code/); return true },
      '发给上游的是长后缀、行里给的是短后缀：核身必须比剥后缀的半边，否则正确返回会被判成过滤没生效',
    )
  })
})

test('期货结算参数：31 天区间是硬闸门、保证金率按小数比例转数值、fee 四列原样不带单位后缀', async () => {
  const source = sourceFor('ftshare_futures_settle')
  assert.equal(source.normalizeParams({ exchange: 'SHFE', start_date: '2026-09-15', end_date: '2026-10-15' }).end_date, '2026-10-15', '实测 31 天以内通过')
  assert.throws(() => source.normalizeParams({ exchange: 'SHFE', start_date: '2026-09-10', end_date: '2026-10-15' }), /不能超过 31 天/, '实测 35 天上游 400「at most 31 days apart」')
  await withFetch(async () => jsonResponse(paged([FUTURES_SETTLE_ROW], { total: 301 })), async (calls) => {
    const result = await source.execute(request('ftshare_futures_settle', { exchange: 'SHFE', trade_date: '2026-10-15', ts_code: 'AD2610.SHF', size: 4000 }), new AbortController().signal)
    assert.match(calls[0].url, /page_size=4000/, '实测 5000 被静默夹到 4000，所以上限要真发得出去')
    const row = result.data.item[0]
    assert.equal(row.settle_price, 23000)
    assert.deepEqual([row.long_margin_rate, row.b_hedging_margin_rate], [0.2, 0.2], '四档保证金率是**小数比例**（0.2 = 20%）')
    assert.deepEqual([row.trading_fee_rate, row.trading_fee, row.delivery_fee, row.offset_today_fee], [0.05, 0, 0, 0.025], '⛔ 这四列单位未披露：原样透出、键名不加单位后缀')
  })
})

test('期货仓单：至少一个条件、unit 随行原样带出、两种单位混在一页不视为异常', async () => {
  const source = sourceFor('ftshare_futures_warrant')
  assert.throws(() => source.normalizeParams({}), /至少要给一个条件|至少/)
  await withFetch(async () => jsonResponse(paged([WARRANT_ROW_CZCE, WARRANT_ROW_SHFE], { total: 1469 })), async () => {
    const result = await source.execute(request('ftshare_futures_warrant', { trade_date: '2026-10-15' }), new AbortController().signal)
    assert.deepEqual(result.data.item.map((row) => row.unit), ['张', '吨'], '⛔ 同一页里两种单位都有，任何相加都要先按 unit 分组')
    const cotton = result.data.item[0]
    assert.deepEqual([cotton.prev_warrant_volume, cotton.warrant_volume, cotton.warrant_change], [1, 1, 0])
    assert.equal(cotton.warehouse_id, '0330'); assert.equal(cotton.place, '新疆'); assert.equal(cotton.area, null)
    const copper = result.data.item[1]
    assert.ok(!('pd' in copper) && !('is_ct' in copper), '实测五所 463 行全 null 的两列不收录')
    assert.deepEqual([copper.warehouse_id, copper.area, copper.year_label], [null, '上海', null], '列位随交易所而不随数据缺口')
  })
  assert.equal(source.normalizeParams({ exchange: 'gfex', trade_date: '2026-10-15' }).exchange, 'GFEX')
  assert.throws(() => source.normalizeParams({ exchange: 'CFFEX', trade_date: '2026-10-15' }), /must be one of/, '中金所不发仓单（实测五所有行、这一家没有座位）')
})

test('期货周报：上游拼错的 amout_yoy 改名透出、无成交行的 null 不补 0、周码只收 YYYYWW', async () => {
  const source = sourceFor('ftshare_futures_weekly')
  await withFetch(async () => jsonResponse(paged([FUTURES_WEEKLY_ROW, FUTURES_WEEKLY_ROW_IDLE], { total: 360 })), async (calls) => {
    const result = await source.execute(request('ftshare_futures_weekly', { week: '202639' }), new AbortController().signal)
    assert.match(calls[0].url, /week=202639/)
    const ic = result.data.item[0]
    assert.equal(ic.amount_yoy_pct, 3.2722978028, '⛔ 上游键名是 amout_yoy（少一个 n），本层改名成 amount_yoy_pct 透出')
    assert.ok(!('amout_yoy' in ic))
    assert.deepEqual([ic.volume_lots, ic.amount_yi, ic.cum_amount_yi], [347502, 4958.3263736, 516120.6686184])
    assert.equal(ic.week_date, '2026-10-09', 'week_date 是周期截止日（实测 202639 落在周五，202637 落在周四），不许按自然周推')
    assert.equal(ic.week_date_ms, Date.parse('2026-10-09T00:00:00+08:00'))
    const idle = result.data.item[1]
    assert.deepEqual([idle.volume_lots, idle.open_interest_lots], [0, 0], '当周无成交的那一行数量确实是 0')
    assert.deepEqual([idle.volume_yoy_pct, idle.amount_yoy_pct, idle.week_close_price, idle.close_wow_pct], [null, null, null, null], '而派生列是 null：0 与 null 在这张表里是两件事')
  })
  assert.throws(() => source.normalizeParams({ week: '2026-39' }), /YYYYWW/, '实测别的写法上游 400「week must use YYYYWW format」')
  assert.throws(() => source.normalizeParams({}), /至少要给一个/)
  assert.throws(() => source.normalizeParams({ week: '202639', start_week: '202638' }), /二选一/)
  assert.equal(source.normalizeParams({ prd: 'cu,al' }).prd, 'CU,AL', '实测逗号分隔可用（CU,AL + 两周 → 4 行）')
  // prd is multi-valued, so the returned identity check has to compare a set.
  await withFetch(async () => jsonResponse(paged([{ ...FUTURES_WEEKLY_ROW, prd: 'AL' }, { ...FUTURES_WEEKLY_ROW, prd: 'CU' }], { total: 4 })), async () => {
    const ok = await source.execute(request('ftshare_futures_weekly', { prd: 'CU,AL', start_week: '202638', end_week: '202641' }), new AbortController().signal)
    assert.equal(ok.data.item.length, 2)
  })
  await withFetch(async () => jsonResponse(paged([{ ...FUTURES_WEEKLY_ROW, prd: 'ZN' }], { total: 4 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_futures_weekly', { prd: 'CU,AL' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /prd/); return true },
    )
  })
  await withFetch(async () => jsonResponse(paged([{ ...FUTURES_WEEKLY_ROW, week: '202650' }], { total: 4 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_futures_weekly', { start_week: '202638', end_week: '202641' }), new AbortController().signal),
      /outside the requested/, '周码定宽，字典序就是时间序：越界必须响',
    )
  })
})

test('南华指数：high < open 原样带出不修、金额列按亿元命名、code 与 trade_date 至少一个', async () => {
  const source = sourceFor('ftshare_futures_index_kline')
  assert.throws(() => source.normalizeParams({ start_date: '2026-08-17', end_date: '2026-10-15' }), /code 与 trade_date 至少/)
  await withFetch(async () => jsonResponse(paged([NANHUA_ROW], { total: 38 })), async (calls) => {
    const result = await source.execute(request('ftshare_futures_index_kline', { code: 'ag_nh', start_date: '2026-08-17', end_date: '2026-10-15' }), new AbortController().signal)
    assert.match(calls[0].url, /code=AG_NH/, '指数代码统一大写发给上游')
    const row = result.data.item[0]
    assert.ok(row.high < row.open, '⛔ 实测 30 行里就有 1 行 high < open：聚合指数不保证高低自洽，本层不修也不报错')
    assert.deepEqual([row.open, row.high, row.low, row.close, row.pre_close], [1758.78, 1724.75, 1649.31, 1650.3, 1724.75])
    assert.deepEqual([row.change_value, row.change_pct], [-74.45, -4.3166], 'change ≡ close − pre_close、pct_chg 是百分数（实测 30/30 成立）')
    assert.equal(row.amount_yi, 958.56, '文档写「千元」，实测那条对不上：见 description 的 CU_NH 交叉核对')
    assert.equal(row.trade_date, '2026-09-28', '行内日期是字符串 YYYYMMDD，本层归一并给毫秒轴')
  })
  assert.throws(() => source.normalizeParams({ code: 'AG_NH', size: 201 }), /1 to 200/, '实测 201 → 响亮 400「page_size must be between 1 and 200」')
})

test('会员持仓排名：GFEX 换成上游的 gfe、品种转小写、空串转 null 且排名与数值同时空', async () => {
  const source = sourceFor('ftshare_futures_member_rank')
  assert.equal(source.normalizeParams({ exchange: 'GFEX', trade_date: '2026-10-15' }).exchange, 'gfe', '⛔ 实测 GFEX 与 gfex 都静默 0 行，上游真名是 gfe')
  assert.equal(source.normalizeParams({ exchange: 'shfe' }).exchange, 'shfe')
  assert.equal(source.normalizeParams({ variety_code: 'AG' }).variety_code, 'ag', '实测大写 AG 回 0 行、小写有数')
  assert.equal(source.normalizeParams({ contract_code: 'ag2610' }).contract_code, 'AG2610', '合约码实测大写命中')
  await withFetch(async () => jsonResponse(paged([MEMBER_RANK_ROW, MEMBER_RANK_ROW_EMPTY], { total: 6911 })), async (calls) => {
    const result = await source.execute(request('ftshare_futures_member_rank', { exchange: 'CFFEX', trade_date: '2026-10-15', size: 500 }), new AbortController().signal)
    assert.match(calls[0].url, /exchange=cffex/)
    assert.match(calls[0].url, /trade_date=2026-10-15/, '这一族的日期实测两种写法都收，本层原样发带横杠那种')
    const first = result.data.item[0]
    assert.equal(first.member_name, '中信期货(代客)')
    assert.deepEqual([first.volume_rank, first.volume_lots, first.volume_change], [1, 17904, -3858])
    assert.deepEqual([first.net_long_rank, first.net_long_position, first.net_long_change], [null, null, null], '空串 = 这一行没有这个口径，不补 0')
    assert.deepEqual([first.net_short_rank, first.net_short_position], [4, 90])
    assert.deepEqual([first.settle_price, first.long_avg_price], [6750.8, 7486.8424])
    assert.equal(first.trade_date_ms, Date.parse('2026-10-15T00:00:00+08:00'))
    const empty = result.data.item[1]
    assert.deepEqual([empty.long_rank, empty.long_position, empty.short_rank, empty.short_position, empty.net_short_position], [null, null, null, null, null], '两头都没有的那一行仍然带着增减仓排名与结算价')
    assert.deepEqual([empty.long_increase_rank, empty.long_decrease_rank, empty.short_increase_rank, empty.short_decrease_rank], [15, 15, 10, 20])
    assert.deepEqual([empty.long_avg_price, empty.short_avg_price], [null, null])
  })
  await withFetch(async () => jsonResponse(paged([{ ...MEMBER_RANK_ROW, exchange: 'dce' }], { total: 1 })), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_futures_member_rank', { exchange: 'CFFEX', trade_date: '2026-10-15' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /exchange/); return true },
    )
  })
  await withFetch(async () => jsonResponse(paged([MEMBER_RANK_ROW_EMPTY], { total: 1 })), async (calls) => {
    await assert.rejects(
      () => source.execute(request('ftshare_futures_member_rank', { variety_code: 'IC', trade_date: '2026-10-15' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); assert.match(error.message, /variety_code/); return true },
      '品种过滤被吞时同样要响：实测大写 IC 上游只回 0 行，所以本层转成 ic 之后还要回来核这一列',
    )
    assert.match(calls[0].url, /variety_code=ic/)
  })
})

test('贵金属：五样参数都得到、size 上限 1000、降序行原样、单位不进列名', async () => {
  const source = sourceFor('ftshare_bullion_price')
  assert.throws(() => source.normalizeParams({ symbol: 'AU9999', end_date: '2026-08-14' }), /start_date must be YYYY-MM-DD/)
  assert.throws(() => source.normalizeParams({ start_date: '2026-08-01', end_date: '2026-08-14' }), /symbol 不能为空/)
  assert.throws(() => source.normalizeParams({ symbol: 'AU9999', start_date: '2026-08-14', end_date: '2026-08-01' }), /must not be later/)
  assert.throws(() => source.normalizeParams({ symbol: 'AU9999', start_date: '2026-08-01', end_date: '2026-08-14', size: 1001 }), /1 to 1000/, '实测 1001 静默夹到 1000（回显 pageSize=1000）')
  await withFetch(async () => jsonResponse(paged([BULLION_ROW], { total: 635 })), async (calls) => {
    const result = await source.execute(request('ftshare_bullion_price', { symbol: 'au9999', start_date: '2026-08-01', end_date: '2026-08-14', page: 2, size: 10 }), new AbortController().signal)
    assert.match(calls[0].url, /symbol=AU9999/)
    assert.match(calls[0].url, /start_date=20260801.*end_date=20260814/, '发给上游的是 YYYYMMDD')
    assert.deepEqual(result.data.item, [{ quote_date: '2026-08-14', quote_date_ms: Date.parse('2026-08-14T00:00:00+08:00'), price_value: 940.72 }])
    assert.deepEqual(result.data.pagination, { page: 2, size: 1, pages: 64, total: 635 })
    assert.ok(!('price_yuan' in result.data.item[0] && !('price_cny_per_gram' in result.data.item[0])), '⛔ 单位上游未披露：列名里不许出现任何一种单位')
  })
})

