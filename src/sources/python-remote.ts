/**
 * Python-only data sources (private runtime + repo-vendored packages).
 *
 * Every capability is fixed to one reviewed script under `python/scripts/`; the runner is injected at
 * assembly time and only touches the runtime when a capability is called (§9.7: external state stays
 * call-time, failures are not memoized). Rows coming back from Python are re-validated and mapped
 * field by field here — raw dicts never reach a Dataset as-is.
 */
import type { DataRequest, DataSource, SchemaDescriptor } from '../data-collector/hub.js'
import { buildDataKey } from '../data-collector/hub.js'

export type PythonDataScript =
  | 'baostock_valuation_history'
  | 'baostock_stock_basic'
  | 'pbc_social_financing'

export interface PythonScriptRunRequest {
  script: PythonDataScript
  params: Record<string, unknown>
  signal?: AbortSignal
}

export interface PythonScriptRunResult {
  rows: unknown[]
  pythonVersion?: string
  durationMs?: number
}

/** Injected by the host: `PythonRuntimeManager.runDataScript` fits this shape. */
export type PythonScriptRunner = (request: PythonScriptRunRequest) => Promise<PythonScriptRunResult>

export const MAX_BASIC_CODES = 50
export const MAX_SOCIAL_FINANCING_MONTHS = 120

/** Runtime-side codes that mean "install/fix the analysis environment", not "the request was bad". */
const RUNTIME_DOWN_CODES = new Set([
  'data-runtime-not-ready',
  'runtime-not-ready',
  'unsupported-platform',
  'pack-invalid',
  'pnpm-missing',
  'permission',
])

const RUNTIME_HINT = '需要私有 Python 运行时（插件设置 → 分析环境 → 安装 base pack）'

/** Shanghai-local trading day, no time part. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u
const BAOSTOCK_CODE_PATTERN = /^(sh|sz)\.(\d{6})$/u

type Params = Record<string, unknown>
type JsonRecord = Record<string, unknown>

interface ValuationRow {
  date: string
  code: string
  close: number | null
  pe_ttm: number | null
  pb_mrq: number | null
  ps_ttm: number | null
  pcf_ncf_ttm: number | null
  turnover_rate_pct: number | null
  trade_status: number | null
  is_st: number | null
}

interface BasicRow {
  code: string
  name: string
  ipo_date: string | null
  out_date: string | null
  type: number | null
  status: number | null
}

interface SocialFinancingRow {
  month: string
  afre_total: number | null
  rmb_loans: number | null
  fx_loans: number | null
  entrusted_loans: number | null
  trust_loans: number | null
  undiscounted_bankers_acceptance: number | null
  corporate_bonds: number | null
  government_bonds: number | null
  equity_financing: number | null
  abs_by_depository: number | null
  loans_written_off: number | null
}

function fail(message: string): never {
  throw new Error(message)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKnownParameters(values: Params, allowed: string[]): void {
  for (const key of Object.keys(values)) {
    if (!allowed.includes(key) && values[key] !== undefined) {
      fail(`unknown parameter ${key} (allowed: ${allowed.join(', ')})`)
    }
  }
}

function text(value: unknown, name: string, maxLength = 64): string {
  if (typeof value !== 'string') fail(`parameter ${name} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length === 0) fail(`parameter ${name} must not be empty`)
  if (trimmed.length > maxLength) fail(`parameter ${name} must be at most ${maxLength} characters`)
  return trimmed
}

/** `600519` / `600519.SH` / `sh.600519` → `sh.600519`; Beijing and B-share segments are refused. */
function normalizeAshareCode(value: unknown, name: string): string {
  const raw = text(value, name, 16).toLowerCase()
  if (raw.includes('bj')) {
    fail(`parameter ${name} rejects Beijing Stock Exchange (北交所) codes: BaoStock answers 10004011 股票代码未标识sh或sz; use a Shanghai/Shenzhen A-share code`)
  }
  const match = /^(?:(sh|sz)\.)?(\d{6})(?:\.(sh|sz))?$/u.exec(raw)
  if (match === null) {
    fail(`parameter ${name} must be an A-share code such as 600519, 600519.SH or sh.600519`)
  }
  const supplied = match[1] ?? match[3]
  const digits = match[2]
  let market: 'sh' | 'sz'
  if (digits.startsWith('60') || digits.startsWith('68')) market = 'sh'
  else if (digits.startsWith('00') || digits.startsWith('30')) market = 'sz'
  else if (digits[0] === '4' || digits[0] === '8' || digits.startsWith('92')) {
    fail(`parameter ${name} rejects Beijing Stock Exchange (北交所) codes (4/8/92 segments); BaoStock answers 10004011 股票代码未标识sh或sz`)
  } else if (digits.startsWith('90') || digits.startsWith('20')) {
    fail(`parameter ${name}: ${digits} is a B-share segment, which BaoStock does not cover (measured: sh.900901 / sz.200002 return 0 rows)`)
  } else {
    fail(`parameter ${name}: ${digits} is not a Shanghai/Shenzhen A-share stock code (expected 60xxxx/68xxxx or 00xxxx/30xxxx)`)
  }
  if (supplied !== undefined && supplied !== market) {
    fail(`parameter ${name}: ${digits} is a ${market.toUpperCase()} code, not ${supplied.toUpperCase()}`)
  }
  return `${market}.${digits}`
}

function normalizeDate(value: unknown, name: string): string {
  const raw = text(value, name, 10)
  const match = DATE_PATTERN.exec(raw)
  if (match === null) fail(`parameter ${name} must be a calendar date in YYYY-MM-DD form`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    fail(`parameter ${name} is not a real calendar date: ${raw}`)
  }
  if (year < 1990 || year > 2100) fail(`parameter ${name} must be between 1990 and 2100`)
  return raw
}

function normalizeValuationParams(params: unknown): Params {
  const values = isRecord(params) ? params : fail('params must be an object')
  assertKnownParameters(values, ['code', 'start_date', 'end_date'])
  const code = normalizeAshareCode(values.code, 'code')
  const startDate = normalizeDate(values.start_date, 'start_date')
  const endDate = normalizeDate(values.end_date, 'end_date')
  if (startDate > endDate) fail('parameter start_date must not be later than end_date')
  return { code, start_date: startDate, end_date: endDate }
}

function normalizeBasicParams(params: unknown): Params {
  const values = isRecord(params) ? params : fail('params must be an object')
  assertKnownParameters(values, ['codes'])
  if (!Array.isArray(values.codes)) fail('parameter codes must be an array of A-share codes')
  if (values.codes.length === 0) fail('parameter codes must contain at least one code')
  if (values.codes.length > MAX_BASIC_CODES) fail(`parameter codes accepts at most ${MAX_BASIC_CODES} codes per request`)
  const codes: string[] = []
  for (const item of values.codes) {
    const code = normalizeAshareCode(item, 'codes')
    if (!codes.includes(code)) codes.push(code)
  }
  if (codes.length > MAX_BASIC_CODES) fail(`parameter codes accepts at most ${MAX_BASIC_CODES} distinct codes per request`)
  return { codes }
}

function normalizeSocialFinancingParams(params: unknown): Params {
  const values = isRecord(params) ? params : fail('params must be an object')
  assertKnownParameters(values, ['months'])
  const months = values.months
  if (months === undefined) return {}
  if (typeof months !== 'number' || !Number.isSafeInteger(months)) fail('parameter months must be an integer')
  if (months < 1 || months > MAX_SOCIAL_FINANCING_MONTHS) {
    fail(`parameter months must be between 1 and ${MAX_SOCIAL_FINANCING_MONTHS}`)
  }
  return { months }
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`脚本返回的 ${field} 不是有限数字（${JSON.stringify(value)}）`)
  }
  return value
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null
  return requiredNumber(value, field)
}

function optionalInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail(`脚本返回的 ${field} 不是整数（${JSON.stringify(value)}）`)
  }
  return value
}

function optionalFlag(value: unknown, field: string): number | null {
  const flag = optionalInteger(value, field)
  if (flag !== null && flag !== 0 && flag !== 1) fail(`脚本返回的 ${field} 不是 0/1（${JSON.stringify(value)}）`)
  return flag
}

function rowAt(value: unknown, index: number, capability: string): JsonRecord {
  if (!isRecord(value)) fail(`${capability} 脚本返回的第 ${index + 1} 行不是对象`)
  return value
}

function dateCell(value: unknown, field: string): string {
  if (typeof value !== 'string' || DATE_PATTERN.exec(value) === null) {
    fail(`脚本返回的 ${field} 不是 YYYY-MM-DD（${JSON.stringify(value)}）`)
  }
  return value
}

function optionalDateCell(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  return dateCell(value, field)
}

function baostockCodeCell(value: unknown, field: string): string {
  if (typeof value !== 'string' || BAOSTOCK_CODE_PATTERN.exec(value) === null) {
    fail(`脚本返回的 ${field} 不是 BaoStock 代码形态（${JSON.stringify(value)}）`)
  }
  return value
}

function mapValuationRows(data: unknown): ValuationRow[] {
  if (!Array.isArray(data)) fail('baostock_valuation_history 脚本没有返回行数组')
  return data.map((item, index) => {
    const row = rowAt(item, index, 'baostock_valuation_history')
    return {
      date: dateCell(row.date, 'date'),
      code: baostockCodeCell(row.code, 'code'),
      close: optionalNumber(row.close, 'close'),
      pe_ttm: optionalNumber(row.pe_ttm, 'pe_ttm'),
      pb_mrq: optionalNumber(row.pb_mrq, 'pb_mrq'),
      ps_ttm: optionalNumber(row.ps_ttm, 'ps_ttm'),
      pcf_ncf_ttm: optionalNumber(row.pcf_ncf_ttm, 'pcf_ncf_ttm'),
      turnover_rate_pct: optionalNumber(row.turnover_rate_pct, 'turnover_rate_pct'),
      trade_status: optionalFlag(row.trade_status, 'trade_status'),
      is_st: optionalFlag(row.is_st, 'is_st'),
    }
  })
}

function mapBasicRows(data: unknown): BasicRow[] {
  if (!Array.isArray(data)) fail('baostock_stock_basic 脚本没有返回行数组')
  return data.map((item, index) => {
    const row = rowAt(item, index, 'baostock_stock_basic')
    if (typeof row.name !== 'string' || row.name.trim().length === 0) {
      fail(`脚本返回的第 ${index + 1} 行 name 不是非空字符串`)
    }
    return {
      code: baostockCodeCell(row.code, 'code'),
      name: row.name,
      ipo_date: optionalDateCell(row.ipo_date, 'ipo_date'),
      out_date: optionalDateCell(row.out_date, 'out_date'),
      type: optionalInteger(row.type, 'type'),
      status: optionalInteger(row.status, 'status'),
    }
  })
}

function monthCell(value: unknown, field: string): string {
  if (typeof value !== 'string' || MONTH_PATTERN.exec(value) === null) {
    fail(`脚本返回的 ${field} 不是 YYYY-MM（${JSON.stringify(value)}）`)
  }
  return value
}

const SOCIAL_FINANCING_FIELDS = [
  'afre_total',
  'rmb_loans',
  'fx_loans',
  'entrusted_loans',
  'trust_loans',
  'undiscounted_bankers_acceptance',
  'corporate_bonds',
  'government_bonds',
  'equity_financing',
  'abs_by_depository',
  'loans_written_off',
] as const

function mapSocialFinancingRows(data: unknown): SocialFinancingRow[] {
  if (!Array.isArray(data)) fail('pbc_social_financing 脚本没有返回行数组')
  const rows = data.map((item, index) => {
    const row = rowAt(item, index, 'pbc_social_financing')
    const mapped = { month: monthCell(row.month, 'month') } as SocialFinancingRow
    for (const field of SOCIAL_FINANCING_FIELDS) {
      mapped[field] = optionalNumber(row[field], field)
    }
    return mapped
  })
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].month <= rows[index - 1].month) {
      fail(`脚本返回的社融月份不是严格升序：${rows[index - 1].month} → ${rows[index].month}`)
    }
  }
  return rows
}

function numberOrNullSchema(description: string): object {
  return { oneOf: [{ type: 'number' }, { type: 'null' }], description }
}

function flagOrNullSchema(description: string): object {
  return { oneOf: [{ type: 'integer', enum: [0, 1] }, { type: 'null' }], description }
}

const valuationRowSchema = {
  type: 'object',
  properties: {
    date: { type: 'string', description: '交易日（上海时区日轴）' },
    code: { type: 'string', description: 'BaoStock 形态代码，如 sh.600519' },
    close: numberOrNullSchema('不复权收盘价（adjustflag=3）'),
    pe_ttm: numberOrNullSchema('市盈率 TTM；负值代表亏损，不能直接排序；null=该日无估值'),
    pb_mrq: numberOrNullSchema('市净率 MRQ；null=该日无估值'),
    ps_ttm: numberOrNullSchema('市销率 TTM；null=该日无估值'),
    pcf_ncf_ttm: numberOrNullSchema('市现率 TTM（NCF）；null=该日无估值'),
    turnover_rate_pct: numberOrNullSchema('换手率百分数原值（0.2731 = 0.2731%，不是 0.002731）'),
    trade_status: flagOrNullSchema('1=正常交易 0=停牌'),
    is_st: flagOrNullSchema('1=ST/*ST 0=正常；逐日历史标记'),
  },
  required: ['date', 'code', 'close', 'pe_ttm', 'pb_mrq', 'ps_ttm', 'pcf_ncf_ttm', 'turnover_rate_pct', 'trade_status', 'is_st'],
  additionalProperties: false,
}

const basicRowSchema = {
  type: 'object',
  properties: {
    code: { type: 'string', description: 'BaoStock 形态代码，如 sh.600519' },
    name: { type: 'string', description: '证券简称' },
    ipo_date: { oneOf: [{ type: 'string' }, { type: 'null' }], description: '上市日 YYYY-MM-DD' },
    out_date: { oneOf: [{ type: 'string' }, { type: 'null' }], description: '退市日 YYYY-MM-DD；在市标的为 null（上游给空字符串）' },
    type: numberOrNullSchema('证券类型：1=股票 2=指数 4=可转债 5=ETF（本能力只接受股票号段，正常为 1）'),
    status: numberOrNullSchema('1=上市 0=退市'),
  },
  required: ['code', 'name', 'ipo_date', 'out_date', 'type', 'status'],
  additionalProperties: false,
}

const socialFinancingRowSchema = {
  type: 'object',
  properties: {
    month: { type: 'string', description: '统计月份 YYYY-MM（月频）' },
    afre_total: numberOrNullSchema('社会融资规模增量（亿元）'),
    rmb_loans: numberOrNullSchema('人民币贷款（亿元）'),
    fx_loans: numberOrNullSchema('外币贷款折合人民币（亿元）'),
    entrusted_loans: numberOrNullSchema('委托贷款（亿元）'),
    trust_loans: numberOrNullSchema('信托贷款（亿元）'),
    undiscounted_bankers_acceptance: numberOrNullSchema('未贴现银行承兑汇票（亿元）'),
    corporate_bonds: numberOrNullSchema('企业债券（亿元）'),
    government_bonds: numberOrNullSchema('政府债券（亿元）'),
    equity_financing: numberOrNullSchema('非金融企业境内股票融资（亿元）'),
    abs_by_depository: numberOrNullSchema('存款类金融机构资产支持证券（亿元）'),
    loans_written_off: numberOrNullSchema('贷款核销（亿元）'),
  },
  required: ['month', ...SOCIAL_FINANCING_FIELDS],
  additionalProperties: false,
}

function objectSchema(properties: Record<string, object>, required: string[]): object {
  return { type: 'object', properties, required, additionalProperties: false }
}

function sourceDescriptor(
  capability: string,
  script: PythonDataScript,
  rest: Pick<SchemaDescriptor, 'name' | 'summary' | 'description' | 'input_schema' | 'output_schema' | 'cacheMaxAgeMs'>,
): SchemaDescriptor {
  return {
    capability,
    name: rest.name,
    source: `python:script.${script}`,
    data_key: buildDataKey('python', 'script', capability),
    source_label: 'python',
    paginated: false,
    cacheMaxAgeMs: rest.cacheMaxAgeMs,
    rowShape: { rootArray: true },
    summary: rest.summary,
    description: rest.description,
    input_schema: rest.input_schema,
    output_schema: rest.output_schema,
  }
}

/** Keep the runtime error code on the wrapped failure so the tool layer can classify it. */
function wrapFailure(capability: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
  const wrapped = new Error(code !== undefined && RUNTIME_DOWN_CODES.has(code)
    ? `${capability}: ${RUNTIME_HINT}：${message}`
    : `${capability} 的固定 Python 脚本失败：${message}`)
  if (code !== undefined) (wrapped as Error & { code?: string }).code = code
  return wrapped
}

export function createPythonSources(runner: PythonScriptRunner): DataSource[] {
  const run = async (script: PythonDataScript, params: Params, signal: AbortSignal): Promise<unknown[]> => {
    let result: PythonScriptRunResult
    try {
      result = await runner({ script, params, signal })
    } catch (error) {
      throw wrapFailure(script, error)
    }
    if (!isRecord(result) || !Array.isArray(result.rows)) {
      fail(`${script}: runner 没有返回 rows 数组`)
    }
    return result.rows
  }

  return [
    {
      schema: sourceDescriptor('baostock_valuation_history', 'baostock_valuation_history', {
        name: 'get_baostock_valuation_history',
        summary: 'BaoStock 日频历史估值：PE/PB/PS/PCF + 换手率 + 停牌/ST',
        description: 'BaoStock（TCP 私有协议）日频估值历史，一次取回单只沪深股票一段区间内的每日估值与交易状态。⛔ 需私有 Python 运行时（插件设置 → 分析环境 → 安装 base pack）；运行时缺失或脚本失败在调用期响亮报错，不会静默返回空表。代码接受 600519 / 600519.SH / sh.600519（大小写不敏感），内部归一为 BaoStock 形态 sh.600519；⛔ 不支持北交所（4/8/92 号段，服务端 10004011），参数层直接拒绝；B 股（900/200 号段）BaoStock 不覆盖（实测 sh.900901 / sz.200002 返回 0 行），同样拒绝。start_date / end_date 必填且为 YYYY-MM-DD，start_date 不得晚于 end_date。字段口径（实测）：close 为不复权收盘价（adjustflag=3）；pe_ttm/pb_mrq/ps_ttm/pcf_ncf_ttm 为 PE(TTM)/PB(MRQ)/PS(TTM)/PCF(NCF,TTM)，**负值代表亏损，不能直接排序**，停牌日或无估值时该字段为 null（不是 0）；turnover_rate_pct 是**百分数原值**（0.2731 = 0.2731%，不是小数比例）；trade_status 1=正常交易、0=停牌；is_st 是逐日历史 ST 标记（1=ST/*ST），可用于还原「当时是不是 ST」。服务端无区间/行数上限（实测 2000-01-01..2026-11-21 的 600519 共 6,121 行、1991 起全历史 8,696 行都能一次返回）；区间内没有交易日（周末、节假日、未来日期）返回空数组，是合法空结果、不是取数失败。date 是上海时区交易日，按升序排列。',
        input_schema: objectSchema({
          code: { type: 'string', description: '沪深股票代码，接受 600519 / 600519.SH / sh.600519；北交所与 B 股拒绝' },
          start_date: { type: 'string', description: '起始交易日 YYYY-MM-DD（含）' },
          end_date: { type: 'string', description: '结束交易日 YYYY-MM-DD（含）' },
        }, ['code', 'start_date', 'end_date']),
        output_schema: { type: 'array', items: valuationRowSchema },
        cacheMaxAgeMs: 6 * 60 * 60 * 1000,
      }),
      normalizeParams: normalizeValuationParams,
      validateOutput: (data: unknown) => {
        try {
          mapValuationRows(data)
          return true
        } catch {
          return false
        }
      },
      execute: async (request: DataRequest, signal: AbortSignal) => {
        const params = normalizeValuationParams(request.params)
        const rows = mapValuationRows(await run('baostock_valuation_history', params, signal))
        for (const row of rows) {
          if (row.code !== params.code) fail(`baostock_valuation_history 返回了其他代码的行：${row.code} != ${String(params.code)}`)
        }
        return { data: rows, schema: { type: 'array', items: valuationRowSchema } }
      },
    },
    {
      schema: sourceDescriptor('baostock_stock_basic', 'baostock_stock_basic', {
        name: 'get_baostock_stock_basic',
        summary: 'BaoStock 上市日/退市日/证券类型/上市状态（批量 1..50）',
        description: 'BaoStock（TCP 私有协议）标的的基本信息：上市日、退市日、证券类型与上市状态，批量 1..50 只逐个查询后按请求顺序合并。⛔ 需私有 Python 运行时（插件设置 → 分析环境 → 安装 base pack）；运行时缺失在调用期响亮报错。codes 接受 600519 / 600519.SH / sh.600519，内部归一；⛔ 不支持北交所（4/8/92 号段）与 B 股（900/200 号段 BaoStock 无记录）。⛔ **整批原子失败**：任一只代码服务端没有记录（实测 sh.900901 B 股 error_code=0 但返回 0 行）就整批报错并点名缺失代码，不返回「少了几行」的结果——缺口必须由调用方看见。字段口径（实测）：code 为 BaoStock 形态；name 为证券简称；ipo_date 为上市日；out_date 为退市日，**在市标的返回 null**（上游给空字符串，本层映射为 null，不是字段缺失）；type 1=股票 2=指数 4=可转债 5=ETF（本能力只接受沪深股票号段，正常为 1）；status 1=上市 0=退市。',
        input_schema: objectSchema({
          codes: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_BASIC_CODES,
            items: { type: 'string', description: '沪深股票代码，如 600519.SH' },
            description: `1..${MAX_BASIC_CODES} 只沪深股票代码；重复项会去重，任一只无记录则整批失败`,
          },
        }, ['codes']),
        output_schema: { type: 'array', items: basicRowSchema },
        cacheMaxAgeMs: 24 * 60 * 60 * 1000,
      }),
      normalizeParams: normalizeBasicParams,
      validateOutput: (data: unknown) => {
        try {
          mapBasicRows(data)
          return true
        } catch {
          return false
        }
      },
      execute: async (request: DataRequest, signal: AbortSignal) => {
        const params = normalizeBasicParams(request.params)
        const requested = params.codes as string[]
        const rows = mapBasicRows(await run('baostock_stock_basic', params, signal))
        const seen = new Set(rows.map((row) => row.code))
        const missing = requested.filter((code) => !seen.has(code))
        if (missing.length > 0) fail(`baostock_stock_basic 没有返回这些代码：${missing.join(', ')}`)
        if (rows.length !== requested.length) fail(`baostock_stock_basic 返回行数 ${rows.length} 与请求代码数 ${requested.length} 不一致`)
        return { data: rows, schema: { type: 'array', items: basicRowSchema } }
      },
    },
    {
      schema: sourceDescriptor('pbc_social_financing', 'pbc_social_financing', {
        name: 'get_pbc_social_financing',
        summary: '人民银行社会融资规模增量（月度，亿元，2022-01 起）',
        description: '人民银行官网「社会融资规模增量统计表」的月度数据（月频，不是日频信号）。⛔ 需私有 Python 运行时（插件设置 → 分析环境 → 安装 base pack）；链路是索引页 → 年份页 →「社会融资规模」专题页 → 第一个 xlsx 附件（openpyxl 解析），任一级结构变化都会响亮报错。单位统一为**亿元**（官方表头「单位：亿元人民币」），**不是万亿元**。参数 months 省略 = 最新年份的全部已发布月份；months=N 时从最新已发布月份往前回溯最多 N 个月（跨年自动取多年）。⛔ 可用历史从 **2022-01** 起：2021 及更早年份的专题页只挂 `.xls`（旧版二进制），本通道的 openpyxl 读不了，因此 months 要得再长也只返回已有月份、不报错。⛔ 未发布月份整行丢弃：表里未发布的月份只有月份、没有数值，本层按 afre_total 为空整行丢弃，不会把 12 行当 12 个月。⛔ Excel 会吃掉 10 月的尾零（`2026.10` 读成浮点 `2026.1`），本层按「单个小数位一律是 x0 月」逐行解析（1 月始终写作 `.01`），跨年工作簿不会错位。afre_total 是**社融增量合计**，不等于其余 10 个分项相加（表内还有未列出的「其他融资」），不要用分项和冒充合计。数值缺失用 null，不补 0。',
        input_schema: objectSchema({
          months: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_SOCIAL_FINANCING_MONTHS,
            description: `回溯最近 N 个月（1..${MAX_SOCIAL_FINANCING_MONTHS}）；省略 = 最新年份的全部已发布月份`,
          },
        }, []),
        output_schema: { type: 'array', items: socialFinancingRowSchema },
        cacheMaxAgeMs: 6 * 60 * 60 * 1000,
      }),
      normalizeParams: normalizeSocialFinancingParams,
      validateOutput: (data: unknown) => {
        try {
          mapSocialFinancingRows(data)
          return true
        } catch {
          return false
        }
      },
      execute: async (request: DataRequest, signal: AbortSignal) => {
        const params = normalizeSocialFinancingParams(request.params)
        const rows = mapSocialFinancingRows(await run('pbc_social_financing', params, signal))
        const months = params.months
        if (typeof months === 'number' && rows.length > months) {
          fail(`pbc_social_financing 返回 ${rows.length} 行，超过请求的 ${months} 个月`)
        }
        return { data: rows, schema: { type: 'array', items: socialFinancingRowSchema } }
      },
    },
  ]
}
