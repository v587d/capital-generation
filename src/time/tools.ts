import type { Context } from '@deepseek-ai/cordis'
import { resolveDatasetTimeWindow, type PeriodInput } from '../data-collector/time-axis.js'
import type { TimeAxisSnapshot } from '../data-collector/store.js'
import { authorizedSession } from '../tool-exec.js'
import { DATASET_READING_PRESET_IDS } from '../preset-ids.js'

type ToolRuntimeLike = { register(definition: unknown): () => void }
/** Framework places the caller session at `exec.agent.session` (see src/tool-exec.ts). */
type ToolExecLike = { signal: AbortSignal; agent?: { session?: { id?: string; header?: { cwd?: string; parentSession?: string } } } }

export interface TimeAxisReader {
  describeTimeAxis(input: { session: unknown; dataset_id: string; time_column?: string; signal?: AbortSignal }): Promise<TimeAxisSnapshot | undefined>
}

const jsonObject = (properties: Record<string, unknown> = {}, required: string[] = []): object =>
  ({ type: 'object', properties, required, additionalProperties: false })

function render(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  // ToolOutputDefinition.render(args, value): the first parameter is the input, the second the output.
  return [{ type: 'text', text: JSON.stringify(value) }]
}

const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/

export type DataTimeContractKind = 'epoch_range' | 'date_range' | 'date' | 'date_ms' | 'enum_range' | 'nested_epoch_range'

export interface DataTimeContract {
  kind: DataTimeContractKind
  fields: string[]
  maxDays?: number
  enumValues?: string[]
  enumMap?: Record<string, string>
  warning?: string
}

const LAST_YEAR_DAYS = 366
const TEN_YEAR_DAYS = 3660
const FIVE_YEAR_DAYS = 1830

/** Retrieval capabilities that get a `query_hint`; keep this explicit (renames break prefix matching). */
const RETRIEVAL_HINT_CAPABILITIES = new Set([
  'anysearch_search',
  'web_retriever_fetch',
  'wind_docs_announcements',
  'wind_docs_news',
])

const DATA_TIME_CONTRACTS: Record<string, DataTimeContract> = {
  history: { kind: 'epoch_range', fields: ['start', 'end'], maxDays: TEN_YEAR_DAYS },
  tencent_kline: { kind: 'date_range', fields: ['start', 'end'], maxDays: TEN_YEAR_DAYS, warning: '腾讯 K 线的 start/end 仅支持日/周/月；分钟线只能取最近 count 根' },
  index_history: { kind: 'epoch_range', fields: ['start', 'end'], maxDays: TEN_YEAR_DAYS },
  income_statement: { kind: 'epoch_range', fields: ['start', 'end'], maxDays: TEN_YEAR_DAYS },
  balance_sheet: { kind: 'epoch_range', fields: ['start', 'end'], maxDays: TEN_YEAR_DAYS },
  cash_flow: { kind: 'epoch_range', fields: ['start', 'end'], maxDays: TEN_YEAR_DAYS },
  fund_history: { kind: 'epoch_range', fields: ['start', 'end'], maxDays: FIVE_YEAR_DAYS },
  fund_performance_history: { kind: 'epoch_range', fields: ['start', 'end'] },
  fund_indicator_line: { kind: 'nested_epoch_range', fields: ['time_range'], warning: 'time_range 只是该接口的时间片段；indexes 仍须按能力契约另行提供' },
  corporate_actions: { kind: 'date_range', fields: ['from', 'to'] },
  hot_stock_rank_trend: { kind: 'date_range', fields: ['start_date', 'end_date'], maxDays: LAST_YEAR_DAYS },
  hot_stock_history: { kind: 'date', fields: ['date'], maxDays: LAST_YEAR_DAYS },
  dragon_tiger: { kind: 'date', fields: ['date'], maxDays: LAST_YEAR_DAYS, warning: '显式日期必须是交易日；工具不会自动回退到最近交易日' },
  eastmoney_top_buy_sell_market: { kind: 'date_range', fields: ['start_date', 'end_date'], maxDays: LAST_YEAR_DAYS },
  eastmoney_top_buy_sell_ticker: { kind: 'date_range', fields: ['start_date', 'end_date'], maxDays: LAST_YEAR_DAYS },
  eastmoney_lockup_expiry: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  // Macro series filter by reporting period, not a day count: no maxDays, so they can reach before 2010.
  eastmoney_cpi: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  eastmoney_ppi: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  eastmoney_gdp: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  eastmoney_pmi: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  eastmoney_money_supply: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  eastmoney_rmb_loan: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  eastmoney_customs_trade: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  eastmoney_retail_sales: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  eastmoney_deposit_reserve: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: '存准率是**调整事件表**：区间里没有调整就是真实空结果，不是取数失败，不要重试' },
  eastmoney_mutual_flow: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  eastmoney_dividend_plan: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: '区间过滤的是**除权除息日**，不是报告期' },
  eastmoney_margin_trading: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: '两融披露沪市比深市快一个交易日：跨市场同日比较前先对齐到共同日期' },
  eastmoney_convertible_bond_list: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: '区间过滤的是**起息日**（实测与网上申购日恒等），不是上市日也不是摘牌日' },
  auction_benchmark: { kind: 'date', fields: ['date'], warning: '显式日期必须是交易日；工具不会自动回退到最近交易日' },
  limit_up_pool: { kind: 'date_ms', fields: ['date_ms'], warning: 'date_ms 必须对应交易日；工具不会自动回退到最近交易日' },
  limit_down_pool: { kind: 'date_ms', fields: ['date_ms'], warning: 'date_ms 必须对应交易日；工具不会自动回退到最近交易日' },
  limit_break_pool: { kind: 'date_ms', fields: ['date_ms'], warning: 'date_ms 必须对应交易日；工具不会自动回退到最近交易日' },
  fund_stock_history: { kind: 'date', fields: ['end_date'], warning: 'end_date 必须是可用报告期截止日；如需确认，请先查询 fund_stock_report_dates' },
  fund_bond_history: { kind: 'date', fields: ['end_date'], warning: 'end_date 必须是可用报告期截止日；如需确认，请先查询 fund_bond_report_dates' },
  fund_nav: { kind: 'enum_range', fields: ['range'], enumValues: ['week', 'month', 'tmonth', 'hyear', 'year', 'twoyear', 'tyear', 'fyear'], enumMap: { last_7_days: 'week', last_1_month: 'month', last_3_months: 'tmonth', last_6_months: 'hyear', last_1_year: 'year', last_2_years: 'twoyear', last_3_years: 'tyear', last_5_years: 'fyear' } },
  fund_manager_performance: { kind: 'enum_range', fields: ['range'], enumValues: ['month', 'tmonth', 'year', 'nowyear', 'now'], enumMap: { last_1_month: 'month', last_3_months: 'tmonth', last_1_year: 'year', current_year: 'nowyear', since_inception: 'now' } },
  anysearch_search: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  wind_docs_announcements: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  wind_docs_news: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  wind_edb_query: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  wind_stock_kline: {
    kind: 'date_range',
    fields: ['start_date', 'end_date'],
    maxDays: TEN_YEAR_DAYS,
    warning: '分钟档（m1/m5/m15/m30）区间上限 10 天，超出会在参数层被拒；adjust=qfq 时 end_date 不得晚于当日（afdate 由本能力锁成当日）',
  },
  // FTShare daily flow keeps only ~45 trading days; maxDays would reject legal requests as the window rolls, so warn only.
  ftshare_stock_daily_flow: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: '上游只保留最近约 45 个交易日：早于窗口的日期返回 total=0，是合法空结果、不是取数失败，不要换日期循环重试' },
  ftshare_industry_daily_flow: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: '上游只保留最近约 45 个交易日：早于窗口的日期返回 total=0，是合法空结果、不是取数失败' },
  ftshare_concept_daily_flow: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: '上游只保留最近约 45 个交易日：早于窗口的日期返回 total=0，是合法空结果、不是取数失败' },
  ftshare_main_capital_flow: { kind: 'date', fields: ['date'], warning: 'date 必须是交易日；省略时取上游最新切片（实测为当日 15:30 那一次）' },
  ftshare_daily_kline_snapshot: { kind: 'date', fields: ['trade_date'], warning: 'trade_date 必须是**交易日**：非交易日会在参数层响亮失败（实测上游 400「trade_date 不是交易日」），未来交易日返回 total=0；当日截面收盘后即可取（实测 2026-10-15 15:51 打 20261015 已回 5565 行）' },
  ftshare_prev_close: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: '历史窗口起点实测在 2022-04（2016 / 2018 / 2020 / 2021 全年区间都回空数组、不报错）；早年请用 history 或 tencent_kline' },
  ftshare_trading_calendar: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  ftshare_block_trades: { kind: 'date', fields: ['date'], warning: 'date 必须是交易日；省略 = 上游最新有数的一天，**当日入库时刻不固定**（实测 2026-10-15 19:32 打 date=当天 total=0，同一晚 20:03 重打已有 80 行）——傍晚拿到当天为空先按「还没入库」理解，不是取数失败、不要循环重试。历史不连续：实测 2016-01-04（交易日历确认是交易日）整天为 0' },
  ftshare_sw_industry_overview: { kind: 'date', fields: ['date'], warning: 'date 必填且必须是交易日（非交易日与未来日期回 total=0，合法空）。⛔ 窗口实测只到最近约 94 个交易日：2026-10-15 实测最早有数的是 2026-05-28，更早的交易日全部 total=0——那是窗口外，不要换日期重试；更早序列请用 ftshare_sw_industry_metrics' },
  ftshare_sw_industry_metrics: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: '最早一天实测 2021-05-31（更早区间回 total=0、不报错）；start_date 晚于 end_date 也是静默空，本层已在参数层拒。⛔ 聚合列有断供：amount / total_mv / constituent_count / close_price / below_net_asset_count 与多数 *_quantile 实测自 2026-08-26 起为 null（2026-10-14 仍为 null，但 PE/PB/股息率有值），三级行业的 amount / index_close / 拥挤度恒为 null——null 不是 0，别补值也别循环重试' },
  // `fields` order is contractual: period becomes fields[0]/fields[1], so date_range must be [start, end].
  ftshare_limit_price: { kind: 'date_range', fields: ['start_date', 'end_date', 'date'], warning: '单票区间模式：start_date / end_date 必须与 code 一起给（实测只给区间不给标的 → 400「start_date/end_date 需配合 symbol 使用」），跨度不超过 3 年（实测 2020..2026 → 400）。全市场模式用 date（单日）。⛔ 混用 date 与区间上游 400；非交易日、未来日期与早于窗口的日期都只回 total=0、不报错（实测 600519.SH 2009 全年空、2010-01-04 起有数）' },
  ftshare_dragon_tiger_seats: { kind: 'date', fields: ['date'], warning: 'date 必填且必须是交易日：上游本来允许省略（回"最新快照"），但响应行里**没有日期列**，所以这颗能力要求显式日期来写时间轴。实测非交易日 / 未来日期 / 早于窗口都回 data:null（合法空、不是失败）；窗口起点实测在 2022-01-04（2021-12-31 及更早为空），分不清是滚动还是固定起点' },
  ftshare_index_weight: { kind: 'date', fields: ['date'], warning: 'date 是**权重采集期**且必须精确命中：实测 2026-06-15 / 2026-09-30 各回该期，而 2026-10-01 / 2026-01-01 这种没有采集的日期 total=0（**不会**回退到最近一期）；省略时取最新一期。请按数据里出现过的 collect_date 挑期，别按自然日猜' },
  ftshare_convertible_bond_kline: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: '⛔ 跨度上限是 12 个自然月，本层不换算成天数闸门（换算规则未核出）：实测 364 天的区间正常、365 天被上游 400「日 K 及以上周期查询范围不能超过 12 个自然月」。start_date 晚于 end_date 在参数层拒（上游同样 400）。要更长序列请分段取，注意周/月/年档是按请求区间内日 K 聚合的，窗口没盖满周期那根不完整' },
  ftshare_chinabond_yield: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: 'start_date / end_date 必填。⛔ 三条曲线各自起点不同（实测同一 2002-2010 窗口内：国债 2006-03-01、中短期票据 2006-12-25、商业银行普通债 2009-12-24），早于某条曲线起点只是那一行缺席，是合法空、不是失败、不要按年份重试；起点是滚动还是固定未核出' },
  ftshare_shibor: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: 'start_date / end_date 必填。历史起点实测在 2006-10-08（2006 全年 63 行、首行就是它；2006-01-01..06-30、07-01..09-30、1999 与 2004 全年都 0 行）；周末、节假日与未发布日没有行，上游不插值也不前值填充，所以序列天然不连续' },
  ftshare_hibor: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: 'start_date / end_date 必填。实测 2010 全年 249 行（首行 2010-01-04）、2000-01-01..2001-12-31 两年 0 行，起点是否滚动未核出；香港假日与未发布日没有行。⛔ m4 / m5 / m7..m11 七档实测整列为 null（HIBOR 只公布部分期限），null 不是 0，别补值' },
  ftshare_financial_calendar: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: '⛔ 单次窗上限是 3 天差（实测 4 天就 400「时间范围不能超过3天」，本层在参数层拒）——要更长区间请分段请求，本层不循环取。覆盖是**滚动窗**：实测 2026-08-03 / 09-01 / 09-15 / 10-05 / 10-12 / 10-19 / 10-26 各日都有事件（40 / 59 / 45 / 37 / 21 / 25 / 10 行），2026-11-02 与 11-16 / 12-01 / 2026-01-05 回空数组（total=0），2020 / 2023 / 2024 / 2025 里的整天直接回 data:null——边界随日期前移；两种空都是合法空，不要换日期重试' },
  // futures_weekly has no contract: its only parameter is a YYYYWW week code, not a date field.
  ftshare_futures_contracts: { kind: 'date', fields: ['trade_date'], warning: 'trade_date 省略 = 上游按 CST 取**前一交易日**。⛔ 当日在 20:20 前是**合法拒绝**：实测 2026-10-16 上午打 trade_date=20261016 → 400「当日期货数据将在上海时间 20:20 后开放查询」，那不是取数故障、不要重试' },
  ftshare_futures_contract_detail: { kind: 'date', fields: ['trade_date'], warning: '同上：省略 = 前一交易日，当日 20:20 前 400（实测与清单那颗同一句话）。`symbol` 是短后缀全码（AG2610.SHF），大小写都收；认不出的代码不回错、只回空 items' },
  ftshare_futures_kline: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: '⛔ 跨度上限 12 个自然月，本层不换算成天数闸门（实测 300 天正常、365 与 399 天被上游 400「日 K 及以上周期查询范围不能超过 12 个自然月」拒）。只给 end_date 不给 start_date 在参数层拒（上游同样 400）。周/月/季是区间内日 K 聚合的，窗口没盖满周期那一根不完整。当日在收盘前是 200 + 0 行（不是那句 20:20 的 400）' },
  ftshare_futures_limit_price: { kind: 'date_range', fields: ['start_date', 'end_date', 'trade_date'], warning: '单日 trade_date 或区间二选一，混给在参数层拒。⛔ 当日实测是 **200 + total=0**（合法空），与清单那颗的 400 不同。区间模式实测行按 trade_date **降序**给，最新一天在第一页' },
  ftshare_futures_settle: { kind: 'date_range', fields: ['start_date', 'end_date', 'trade_date'], warning: '单日或区间二选一；⛔ **区间跨度上限 31 天**（实测超一天就 400「start_date and end_date must be at most 31 days apart」，本层在参数层拦），要更长序列请分段取。当日实测 200 + total=0' },
  ftshare_futures_warrant: { kind: 'date_range', fields: ['start_date', 'end_date', 'trade_date'], warning: 'trade_date / 区间 / symbol 至少给一个（实测全空 400「证券代码、交易日期、开始日期或结束日期至少需要提供一个」）。一日全市场实测 1469 行。当日实测 200 + total=0（20:20 前本就还没有当日仓单）' },
  ftshare_futures_index_kline: { kind: 'date_range', fields: ['start_date', 'end_date', 'trade_date'], warning: 'code 与 trade_date 至少给一个；传 trade_date 是**单日截面**、区间参数被忽略（实测只回 1 行）。区间实测按 trade_date 升序、20260817..20261015 共 total=38' },
  ftshare_futures_member_rank: { kind: 'date_range', fields: ['start_date', 'end_date', 'trade_date'], warning: '三个日期参数可叠加（AND）。⛔ 不给任何日期 = 全表实测 1,435,879 行，一次返回必然超闸：请至少给 trade_date，最好再加 contract_code（实测一日 6911 行、单合约 20 行）' },
  ftshare_bullion_price: { kind: 'date_range', fields: ['start_date', 'end_date'], warning: 'start_date / end_date 在本层是必填（实测上游对缺 `symbol`、缺 `page` 都回 400 点名缺哪一样）。⛔ 序列停在 2026-08 中旬：实测 AU9999 大窗首行 2026-08-14、XAUUSD 2026-08-12，按"最近一周"打永远 total=0——那是上游没有新数据，不是取数失败。返回按日期降序' },
}

export function getDataTimeContract(capability: string): DataTimeContract | undefined {
  const contract = DATA_TIME_CONTRACTS[capability]
  return contract ? { ...contract, fields: [...contract.fields], ...(contract.enumValues ? { enumValues: [...contract.enumValues] } : {}), ...(contract.enumMap ? { enumMap: { ...contract.enumMap } } : {}) } : undefined
}

export function resolveTimeZone(timeZone: unknown): string | undefined {
  if (timeZone === undefined) return undefined
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) {
    throw new Error('timezone must be an IANA name string (e.g. "Asia/Shanghai")')
  }
  if (timeZone !== 'UTC' && timeZone !== 'GMT' && !IANA_TIME_ZONE.test(timeZone)) {
    throw new Error('timezone must be an IANA name string (e.g. "Asia/Shanghai")')
  }
  let resolved: string
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone
  } catch {
    throw new Error(`unsupported IANA timezone: ${JSON.stringify(timeZone)}`)
  }
  return resolved
}

export function localTimeZone(): string {
  return new Intl.DateTimeFormat('en-US').resolvedOptions().timeZone
}

function two(value: number): string {
  return String(value).padStart(2, '0')
}

/** Normalize Intl "GMT+08:00" to "+08:00"; null means fall back to the difference method. */
function normalizeUtcOffset(timeZoneName: string): string | null {
  if (timeZoneName === 'GMT' || timeZoneName === 'UTC') return '+00:00'
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(timeZoneName)
  if (!match) return null
  return `${match[1]}${two(Number(match[2]))}:${match[3] ?? '00'}`
}

/** UTC offset from formatted parts; fallback when timeZoneName is unavailable. */
export function zoneOffsetMsByDiff(now: number, zone: string): number {
  const fields = {
    year: 'numeric' as const, month: '2-digit' as const, day: '2-digit' as const,
    hour: '2-digit' as const, minute: '2-digit' as const, second: '2-digit' as const,
    hourCycle: 'h23' as const,
  }
  const read = (parts: Intl.DateTimeFormatPart[]): number => {
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>
    return Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second))
  }
  const utcParts = new Intl.DateTimeFormat('en-US', { ...fields, timeZone: 'UTC' }).formatToParts(now)
  const zoneParts = new Intl.DateTimeFormat('en-US', { ...fields, timeZone: zone }).formatToParts(now)
  return read(zoneParts) - read(utcParts)
}

export function readClock(now: number, timeZone?: string): Record<string, unknown> {
  const zone = resolveTimeZone(timeZone) ?? localTimeZone()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', weekday: 'long', timeZoneName: 'longOffset',
  })
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value])) as Record<string, string>
  let utcOffset = parts.timeZoneName ? normalizeUtcOffset(parts.timeZoneName) : null
  if (utcOffset === null) {
    const offsetMs = zoneOffsetMsByDiff(now, zone)
    const sign = offsetMs < 0 ? '-' : '+'
    const abs = Math.abs(offsetMs)
    utcOffset = `${sign}${two(Math.floor(abs / 3_600_000))}:${two(Math.floor((abs % 3_600_000) / 60_000))}`
  }
  const offsetMinutes = (utcOffset.startsWith('-') ? -1 : 1) * (Number(utcOffset.slice(1, 3)) * 60 + Number(utcOffset.slice(4, 6)))
  return {
    iso_local: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${utcOffset}`,
    iso_utc: new Date(now).toISOString(),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    weekday: parts.weekday,
    timezone: zone,
    utc_offset: utcOffset,
    utc_offset_minutes: offsetMinutes,
    epoch_ms: now,
  }
}

/**
 * Two time tools, not role-gated: get_local_datetime is the clock reading, resolve_data_time_range
 * is conversion. Dataset-mode authorization is enforced at call time by src/tool-exec.ts.
 */
export function registerTimeTool(ctx: Context, store?: TimeAxisReader): void {
  const tools = ctx.get('tools') as ToolRuntimeLike | undefined
  if (!tools) return
  const definition = {
    name: 'get_local_datetime',
    description:
      '获取当前真实日期时间的权威读数：宿主机器时钟 + IANA 时区（本地时区名与 UTC 偏移）。' +
      '模型知识截止日期绝不是当前时间；凡涉及"今天/现在/最新/此刻/周几/多少天前"的判断或时间戳换算，' +
      '必须先调用本工具取得当前时刻，涉及数据接口时间范围时改用 resolve_data_time_range，不要自行换算。可选 timezone 参数可指定 IANA 时区显示。',
    parameters: jsonObject({ timezone: { type: 'string', description: '可选 IANA 时区名（如 "Asia/Shanghai"）；缺省为宿主本地时区' } }),
    output: {
      schema: jsonObject({
        iso_local: { type: 'string' },
        iso_utc: { type: 'string' },
        date: { type: 'string' },
        time: { type: 'string' },
        weekday: { type: 'string' },
        timezone: { type: 'string' },
        utc_offset: { type: 'string' },
        utc_offset_minutes: { type: 'integer' },
        epoch_ms: { type: 'integer' },
      }, ['iso_local', 'iso_utc', 'date', 'time', 'weekday', 'timezone', 'utc_offset', 'utc_offset_minutes', 'epoch_ms']),
      render,
    },
    async execute(args: Record<string, unknown>, _exec: ToolExecLike): Promise<Record<string, unknown>> {
      return readClock(Date.now(), resolveTimeZone(args.timezone))
    },
  }
  ctx.effect(() => tools.register(definition), 'capital-generation.tool(get_local_datetime)')
  ctx.effect(() => tools.register(dataTimeRangeDefinition(ctx, store)), 'capital-generation.tool(resolve_data_time_range)')
}

type DateParts = { year: number; month: number; day: number }

/**
 * Sole period normalization: literal windows, {unit,count}, and stringified {unit,count} (models
 * really send that). undefined means the caller omitted period.
 */
export function periodInputOf(value: unknown): string | { unit: string; count: number } | undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.length === 0) return undefined
    if (text.startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(text)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const spec = parsed as Record<string, unknown>
          if (typeof spec.unit === 'string' && Number.isSafeInteger(spec.count)) return { unit: spec.unit, count: Number(spec.count) }
        }
      } catch {
        // Unparseable text is passed through as a literal window so the resolver can list supported forms.
      }
    }
    return text
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const spec = value as Record<string, unknown>
    if (typeof spec.unit === 'string' && Number.isSafeInteger(spec.count)) return { unit: spec.unit, count: Number(spec.count) }
  }
  return undefined
}

export function dateParts(value: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('period dates must use YYYY-MM-DD')
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  if (parts.year < 1990) throw new Error(`date is outside the supported range: ${value}`)
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day) throw new Error(`invalid calendar date: ${value}`)
  return parts
}

function dateText(parts: DateParts): string { return `${String(parts.year).padStart(4, '0')}-${two(parts.month)}-${two(parts.day)}` }

export function shiftDate(value: string, unit: 'day' | 'week' | 'month' | 'quarter' | 'year', amount: number): string {
  const source = dateParts(value)
  if (unit === 'day' || unit === 'week') {
    // Weeks are 7 days; the inclusive-anchor adjustment happens in resolvePeriod, in one place only.
    const date = new Date(Date.UTC(source.year, source.month - 1, source.day))
    date.setUTCDate(date.getUTCDate() + amount * (unit === 'week' ? 7 : 1))
    return dateText({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() })
  }
  const totalMonths = source.year * 12 + source.month - 1 + amount * (unit === 'quarter' ? 3 : unit === 'year' ? 12 : 1)
  const year = Math.floor(totalMonths / 12)
  const month = totalMonths % 12 + 1
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return dateText({ year, month, day: Math.min(source.day, lastDay) })
}

function localDateAt(epoch: number, zone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(epoch).map((part) => [part.type, part.value])) as Record<string, string>
  return `${parts.year}-${parts.month}-${parts.day}`
}

function zonedDateEpoch(value: string, zone: string, endOfDay = false): number {
  const parts = dateParts(value)
  const base = Date.UTC(parts.year, parts.month - 1, parts.day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  return base - zoneOffsetMsByDiff(base, zone)
}

/** Whole days between two dates, computed at UTC midnight so timezone/DST cannot shift it (one implementation). */
export function dayDistance(start: string, end: string): number {
  const from = dateParts(start); const to = dateParts(end)
  return Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000)
}

function resolvePeriod(input: unknown, anchor: string): { start: string; end: string } {
  const period = periodInputOf(input)
  if (period && typeof period === 'object' && !Array.isArray(period)) {
    const spec = period as Record<string, unknown>
    if (!['day', 'week', 'month', 'quarter', 'year'].includes(String(spec.unit)) || typeof spec.count !== 'number' || !Number.isSafeInteger(spec.count) || spec.count < 1) throw new Error('period object must be { unit: day|week|month|quarter|year, count: positive integer }')
    const unit = spec.unit as 'day' | 'week' | 'month' | 'quarter' | 'year'
    const count = spec.count as number
    // Inclusive anchor: only `day` steps back one less.
    return { start: shiftDate(anchor, unit, unit === 'day' ? -(count - 1) : -count), end: anchor }
  }
  if (typeof period !== 'string' || period.trim().length === 0) throw new Error('period is required')
  const value = period.trim().toLowerCase()
  if (/^\d{4}$/.test(value)) return { start: `${value}-01-01`, end: `${value}-12-31` }
  if (value === 'today') return { start: anchor, end: anchor }
  if (value === 'yesterday') { const date = shiftDate(anchor, 'day', -1); return { start: date, end: date } }
  if (value === 'current_year') return { start: `${dateParts(anchor).year}-01-01`, end: anchor }
  if (value === 'previous_year') { const year = dateParts(anchor).year - 1; return { start: `${year}-01-01`, end: `${year}-12-31` } }
  const match = /^last_(\d+)_(day|days|week|weeks|month|months|year|years)$/.exec(value)
  if (!match) throw new Error('unsupported period; use today, yesterday, YYYY, current_year, previous_year, last_N_days/weeks/months/years, or {unit,count}')
  const count = Number(match[1]); const unit = match[2].replace(/s$/, '') as 'day' | 'week' | 'month' | 'year'
  // Same inclusive-anchor rule; subtracting in both shiftDate and here would make last_1_week empty.
  return { start: shiftDate(anchor, unit, unit === 'day' ? -(count - 1) : -count), end: anchor }
}

/**
 * Shared single-window resolver; also accepts all, ytd and YYYY-MM. Object periods go to
 * resolvePeriod as-is.
 */
export function resolveZonedPeriod(input: unknown, anchor: string): { start: string; end: string } {
  dateParts(anchor)
  const period = periodInputOf(input)
  if (period === undefined) throw new Error('period is required; use today, yesterday, YYYY, YYYY-MM, ytd, current_year, previous_year, all, last_N_days/weeks/months/years, or {unit,count}')
  if (typeof period !== 'string') return resolvePeriod(period, anchor)
  const value = period.toLowerCase()
  if (value === 'all') return { start: '1990-01-01', end: anchor }
  if (value === 'ytd') return { start: `${dateParts(anchor).year}-01-01`, end: anchor }
  const month = /^(\d{4})-(\d{2})$/.exec(value)
  if (month) {
    const year = Number(month[1]); const monthIndex = Number(month[2])
    if (monthIndex < 1 || monthIndex > 12) throw new Error(`invalid month in period: ${period}`)
    const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
    return { start: `${month[1]}-${month[2]}-01`, end: `${month[1]}-${month[2]}-${String(lastDay).padStart(2, '0')}` }
  }
  return resolvePeriod(period, anchor)
}

function enumPeriod(contract: DataTimeContract, period: unknown): string {  if (typeof period !== 'string') throw new Error('this capability requires a named period such as last_3_months')
  const value = contract.enumMap?.[period.toLowerCase()]
  if (!value || !contract.enumValues?.includes(value)) throw new Error(`unsupported period for this capability; allowed values: ${Object.keys(contract.enumMap ?? {}).join(', ')}`)
  return value
}

export function resolveDataTimeRange(args: Record<string, unknown>, now = Date.now()): Record<string, unknown> {
  const capability = typeof args.capability === 'string' ? args.capability.trim() : ''
  if (!capability) throw new Error('capability is required')
  const contract = getDataTimeContract(capability)
  if (!contract) throw new Error(`unsupported time capability: ${capability}`)
  const zone = resolveTimeZone(args.timezone) ?? 'Asia/Shanghai'
  if (contract.kind === 'enum_range') {
    return { mode: 'capability', capability, format: 'enum', timezone: zone, params: { [contract.fields[0]]: enumPeriod(contract, args.period) }, warnings: [] }
  }
  const anchor = typeof args.anchor_date === 'string' ? args.anchor_date.trim() : localDateAt(now, zone)
  dateParts(anchor)
  const resolved = resolvePeriod(args.period, anchor)
  const distance = dayDistance(resolved.start, resolved.end)
  if (contract.maxDays !== undefined && distance > contract.maxDays) throw new Error(`${capability} period exceeds the ${contract.maxDays} day interface limit`)
  const startEpoch = zonedDateEpoch(resolved.start, zone)
  const endEpoch = zonedDateEpoch(resolved.end, zone, true)
  const params: Record<string, unknown> = {}
  if (contract.kind === 'epoch_range') { params.start = startEpoch; params.end = endEpoch }
  else if (contract.kind === 'nested_epoch_range') params.time_range = JSON.stringify({ time_type: 'DAY_1', start: startEpoch, end: endEpoch })
  else if (contract.kind === 'date_range') { params[contract.fields[0]] = resolved.start; params[contract.fields[1]] = resolved.end }
  else if (contract.kind === 'date_ms') params.date_ms = zonedDateEpoch(resolved.end, zone)
  else params[contract.fields[0]] = resolved.end
  // Explicit set, not prefixes: renames silently drop the hint, and wind_* includes date-taking
  // capabilities that must not receive an "X to Y" hint.
  const queryHint = RETRIEVAL_HINT_CAPABILITIES.has(capability) ? `${resolved.start} 至 ${resolved.end}` : undefined
  return {
    mode: 'capability',
    capability,
    format: contract.kind === 'epoch_range' ? 'epoch_ms' : contract.kind === 'nested_epoch_range' ? 'epoch_ms_json' : contract.kind === 'date_ms' ? 'date_ms' : 'date_string',
    timezone: zone,
    range: { start_date: resolved.start, end_date: resolved.end, start_epoch_ms: startEpoch, end_epoch_ms: endEpoch },
    params,
    ...(queryHint ? { query_hint: queryHint } : {}),
    warnings: contract.warning ? [contract.warning] : [],
  }
}

function dataTimeRangeDefinition(pluginCtx: unknown, store?: TimeAxisReader) {
  return {
    name: 'resolve_data_time_range',
    description: '解析时间窗，**两种形态**，绝不自行换算时间戳。① 取数形态：传 capability + period，输出可直接交给 request_data 的时间参数；② Dataset 分析形态：传 dataset_id（可选 time_column）+ period 或 anchor_date，按**该 Dataset 时间列自身的时区偏移**输出可直接用于 query_dataset filters 的边界（bounds.bound_ge/bound_le）与人类可读日期（range/data）。period 支持 today、yesterday、YYYY、YYYY-MM、ytd、current_year、previous_year、all、last_N_days/weeks/months/years，或 {unit,count}。anchor_date 省略时：取数形态用当前 Asia/Shanghai 日期，Dataset 形态用该 Dataset 的最后一天（相对期因此不会因数据陈旧而落空）。交易日与基金报告期不会自动猜测，结果中的 warnings 必须遵守。',
    parameters: jsonObject({
      capability: { type: 'string', description: '形态①：数据能力名，或 anysearch_search / wind_docs_announcements / wind_docs_news' },
      dataset_id: { type: 'string', description: '形态②：已授权的 dataset_id；给出时按该 Dataset 的时间轴解析（此时忽略 capability）。该形态只对**有 Dataset 读权限的人设**（如数据角色）开放' },
      time_column: { type: 'string', description: '形态②可选：显式指定时间列；省略时宿主按列名与取值形态探测' },
      period: { oneOf: [{ type: 'string' }, { type: 'object', properties: { unit: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'] }, count: { type: 'integer' } }, required: ['unit', 'count'], additionalProperties: false }] },
      anchor_date: { type: 'string', description: '可选锚点日期 YYYY-MM-DD；省略时取数形态用当前 Asia/Shanghai 日期，Dataset 形态用该 Dataset 的最后一天' },
      timezone: { type: 'string', description: '可选 IANA 时区；数据接口默认 Asia/Shanghai' },
    }, ['period']),
    output: {
      schema: jsonObject({
        capability: { type: 'string' },
        mode: { type: 'string' },
        format: { type: 'string' },
        timezone: { type: 'string' },
        time_column: { type: 'string' },
        period: { type: 'string' },
        range: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
        data: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
        bounds: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
        bounds_are_intraday: { type: 'boolean' },
        dataset: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
        params: { type: 'object', additionalProperties: true },
        query_hint: { type: 'string' },
        warnings: { type: 'array', items: { type: 'string' } },
      }, ['mode', 'format', 'timezone', 'warnings']),
      render,
    },
    async execute(args: Record<string, unknown>, exec: ToolExecLike): Promise<Record<string, unknown>> {
      const datasetId = typeof args.dataset_id === 'string' ? args.dataset_id.trim() : ''
      if (datasetId.length === 0) return resolveDataTimeRange(args)
      if (!store) throw new Error('Dataset time-range mode is unavailable: the Dataset store is not mounted in this session')
      // The session is at `exec.agent.session`, not `exec.session`; dataset mode uses the Dataset read
      // authorization boundary (the main agent only uses capability mode).
      const session = authorizedSession(pluginCtx, exec, 'resolve_data_time_range', DATASET_READING_PRESET_IDS)
      const snapshot = await store.describeTimeAxis({
        session,
        dataset_id: datasetId,
        time_column: typeof args.time_column === 'string' && args.time_column.length > 0 ? args.time_column : undefined,
        signal: exec.signal,
      })
      if (snapshot === undefined) {
        throw new Error(`Dataset ${datasetId} has no detectable time column; pass time_column explicitly or inspect the Dataset first`)
      }
      return resolveDatasetTimeWindow({
        dataset_id: datasetId,
        axis: snapshot.axis,
        dates: snapshot.dates,
        // Object periods must reach the resolver, or `{unit:"year",count:2}` silently degrades to all.
        period: periodInputOf(args.period),
        anchorDate: typeof args.anchor_date === 'string' ? args.anchor_date.trim() : undefined,
        zone: resolveTimeZone(args.timezone),
      }) as unknown as Record<string, unknown>
    },
  }
}
