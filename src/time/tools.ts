import type { Context } from '@deepseek-ai/cordis'

type ToolRuntimeLike = { register(definition: unknown): () => void }
type ToolExecLike = { signal: AbortSignal }

const jsonObject = (properties: Record<string, unknown> = {}, required: string[] = []): object =>
  ({ type: 'object', properties, required, additionalProperties: false })

function render(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  // ToolOutputDefinition.render(args, value)：第一参是入参、第二参才是返回值。
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

/** 数据接口时间参数的唯一模型可见契约；不从自然语言 description 反推规则。 */
const DATA_TIME_CONTRACTS: Record<string, DataTimeContract> = {
  history: { kind: 'epoch_range', fields: ['start', 'end'], maxDays: TEN_YEAR_DAYS },
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
  auction_benchmark: { kind: 'date', fields: ['date'], warning: '显式日期必须是交易日；工具不会自动回退到最近交易日' },
  limit_up_pool: { kind: 'date_ms', fields: ['date_ms'], warning: 'date_ms 必须对应交易日；工具不会自动回退到最近交易日' },
  limit_down_pool: { kind: 'date_ms', fields: ['date_ms'], warning: 'date_ms 必须对应交易日；工具不会自动回退到最近交易日' },
  limit_break_pool: { kind: 'date_ms', fields: ['date_ms'], warning: 'date_ms 必须对应交易日；工具不会自动回退到最近交易日' },
  fund_stock_history: { kind: 'date', fields: ['end_date'], warning: 'end_date 必须是可用报告期截止日；如需确认，请先查询 fund_stock_report_dates' },
  fund_bond_history: { kind: 'date', fields: ['end_date'], warning: 'end_date 必须是可用报告期截止日；如需确认，请先查询 fund_bond_report_dates' },
  fund_nav: { kind: 'enum_range', fields: ['range'], enumValues: ['week', 'month', 'tmonth', 'hyear', 'year', 'twoyear', 'tyear', 'fyear'], enumMap: { last_7_days: 'week', last_1_month: 'month', last_3_months: 'tmonth', last_6_months: 'hyear', last_1_year: 'year', last_2_years: 'twoyear', last_3_years: 'tyear', last_5_years: 'fyear' } },
  fund_manager_performance: { kind: 'enum_range', fields: ['range'], enumValues: ['month', 'tmonth', 'year', 'nowyear', 'now'], enumMap: { last_1_month: 'month', last_3_months: 'tmonth', last_1_year: 'year', current_year: 'nowyear', since_inception: 'now' } },
  web_retriever_search: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  wind_docs_announcements: { kind: 'date_range', fields: ['start_date', 'end_date'] },
  wind_docs_news: { kind: 'date_range', fields: ['start_date', 'end_date'] },
}

export function getDataTimeContract(capability: string): DataTimeContract | undefined {
  const contract = DATA_TIME_CONTRACTS[capability]
  return contract ? { ...contract, fields: [...contract.fields], ...(contract.enumValues ? { enumValues: [...contract.enumValues] } : {}), ...(contract.enumMap ? { enumMap: { ...contract.enumMap } } : {}) } : undefined
}

/** 校验并规范化 IANA 时区名；undefined 表示宿主本地时区。'UTC'/'GMT' 为合法特殊值。 */
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

/** 宿主进程的本地 IANA 时区名。 */
export function localTimeZone(): string {
  return new Intl.DateTimeFormat('en-US').resolvedOptions().timeZone
}

function two(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 把 Intl 的 timeZoneName（"GMT+08:00" / "GMT-05:00" / "GMT"）规范化为
 * "+08:00" / "-05:00" / "+00:00"。解析失败返回 null，调用方回退到差值算法。
 */
function normalizeUtcOffset(timeZoneName: string): string | null {
  if (timeZoneName === 'GMT' || timeZoneName === 'UTC') return '+00:00'
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(timeZoneName)
  if (!match) return null
  return `${match[1]}${two(Number(match[2]))}:${match[3] ?? '00'}`
}

/**
 * 差值法计算某 IANA 时区在 now 时刻的 UTC 偏移毫秒数（timeZoneName 缺失时的回退）。
 */
function zoneOffsetMsByDiff(now: number, zone: string): number {
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

/** 当前时刻读数（内部纯函数，便于测试）：now 为 epoch 毫秒。 */
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
 * 注册时间工具（会话组作用域：主 Agent 与所有子 Agent 均可见，与数据工具同一
 * 注册通道）。模型知识截止日期不是当前时间；涉及"今天/现在/此刻/周几"的判断
 * 必须先调用本工具，绝不凭记忆猜测。
 */
export function registerTimeTool(ctx: Context): void {
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
  ctx.effect(() => tools.register(dataTimeRangeDefinition()), 'capital-generation.tool(resolve_data_time_range)')
}

type DateParts = { year: number; month: number; day: number }

function dateParts(value: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('period dates must use YYYY-MM-DD')
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  if (parts.year < 1990) throw new Error(`date is outside the supported range: ${value}`)
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day) throw new Error(`invalid calendar date: ${value}`)
  return parts
}

function dateText(parts: DateParts): string { return `${String(parts.year).padStart(4, '0')}-${two(parts.month)}-${two(parts.day)}` }

function shiftDate(value: string, unit: 'day' | 'week' | 'month' | 'quarter' | 'year', amount: number): string {
  const source = dateParts(value)
  if (unit === 'day' || unit === 'week') {
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

function dayDistance(start: string, end: string): number {
  const from = dateParts(start); const to = dateParts(end)
  return Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000)
}

function resolvePeriod(period: unknown, anchor: string): { start: string; end: string } {
  if (period && typeof period === 'object' && !Array.isArray(period)) {
    const spec = period as Record<string, unknown>
    if (!['day', 'week', 'month', 'quarter', 'year'].includes(String(spec.unit)) || typeof spec.count !== 'number' || !Number.isSafeInteger(spec.count) || spec.count < 1) throw new Error('period object must be { unit: day|week|month|quarter|year, count: positive integer }')
    const unit = spec.unit as 'day' | 'week' | 'month' | 'quarter' | 'year'
    const count = spec.count as number
    return { start: shiftDate(anchor, unit, -(unit === 'day' || unit === 'week' ? count - 1 : count)), end: anchor }
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
  return { start: shiftDate(anchor, unit, -(unit === 'day' || unit === 'week' ? count - 1 : count)), end: anchor }
}

function enumPeriod(contract: DataTimeContract, period: unknown): string {
  if (typeof period !== 'string') throw new Error('this capability requires a named period such as last_3_months')
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
  if (contract.kind === 'enum_range') return { capability, format: 'enum', timezone: zone, params: { [contract.fields[0]]: enumPeriod(contract, args.period) }, warnings: [] }
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
  const queryHint = capability.startsWith('web_') || capability.startsWith('wind_') ? `${resolved.start} 至 ${resolved.end}` : undefined
  return {
    capability,
    format: contract.kind === 'epoch_range' ? 'epoch_ms' : contract.kind === 'nested_epoch_range' ? 'epoch_ms_json' : contract.kind === 'date_ms' ? 'date_ms' : 'date_string',
    timezone: zone,
    range: { start_date: resolved.start, end_date: resolved.end, start_epoch_ms: startEpoch, end_epoch_ms: endEpoch },
    params,
    ...(queryHint ? { query_hint: queryHint } : {}),
    warnings: contract.warning ? [contract.warning] : [],
  }
}

function dataTimeRangeDefinition() {
  return {
    name: 'resolve_data_time_range',
    description: '把数据能力的相对时间要求直接转换为可传给 request_data 的规范时间参数。必须传 capability 与 period；不要自行计算时间戳。默认按 Asia/Shanghai 自然日边界输出。支持 today、yesterday、YYYY、current_year、previous_year、last_N_days/weeks/months/years，或 {unit,count}。交易日与基金报告期不会自动猜测，结果中的 warnings 必须遵守。',
    parameters: jsonObject({ capability: { type: 'string', description: '数据能力名，或 web_retriever_search / wind_docs_announcements / wind_docs_news' }, period: { oneOf: [{ type: 'string' }, { type: 'object', properties: { unit: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'] }, count: { type: 'integer', minimum: 1 } }, required: ['unit', 'count'], additionalProperties: false }] }, anchor_date: { type: 'string', description: '可选锚点日期 YYYY-MM-DD；省略时使用当前 Asia/Shanghai 日期' }, timezone: { type: 'string', description: '可选 IANA 时区；数据接口默认 Asia/Shanghai' } }, ['capability', 'period']),
    output: { schema: jsonObject({ capability: { type: 'string' }, format: { type: 'string' }, timezone: { type: 'string' }, range: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] }, params: { type: 'object', additionalProperties: true }, query_hint: { type: 'string' }, warnings: { type: 'array', items: { type: 'string' } } }, ['capability', 'format', 'timezone', 'params', 'warnings']), render },
    async execute(args: Record<string, unknown>, _exec: ToolExecLike): Promise<Record<string, unknown>> { return resolveDataTimeRange(args) },
}
}
