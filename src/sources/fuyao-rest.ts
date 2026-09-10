import type { Context } from '@deepseek-ai/cordis'
import type { DataRequest, DataSource, SchemaDescriptor } from '../data-collector/hub.js'
import { buildDataKey } from '../data-collector/hub.js'

const DEFAULT_BASE_URL = 'https://fuyao.aicubes.cn'
type ApiEnvelope = { code?: number; message?: string; request_id?: string; data?: unknown }
type CredentialLike = { resolve(ref: string): Promise<{ value: string } | undefined> }

/** 每次执行时解析 API Key 的注入点：符合 credentials 服务「按次解析、不跨操作缓存」的约定。 */
export type FuyaoApiKeyResolver = () => Promise<string | undefined>

function objectSchema(properties: Record<string, object>, required: string[] = [], description?: string): object {
  return { type: 'object', properties, required, additionalProperties: false, ...(description ? { description } : {}) }
}

function queryValue(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

function validateInputSchema(inputSchema: object, values: Record<string, unknown>, allowed: string[]): void {
  const schema = inputSchema as { required?: unknown; properties?: Record<string, { type?: string; enum?: unknown[] }> }
  const required = Array.isArray(schema.required) ? schema.required : []
  for (const name of required) {
    const value = values[String(name)]
    if (value === undefined || value === null || value === '') throw new Error(`missing required parameter: ${String(name)}`)
  }
  for (const name of Object.keys(values)) {
    if (!allowed.includes(name)) throw new Error(`unsupported parameter: ${name}`)
    const descriptor = schema.properties?.[name]
    const value = values[name]
    if (descriptor?.type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) {
      throw new Error(`parameter ${name} must be an integer`)
    }
    if (descriptor?.type === 'string' && typeof value !== 'string') throw new Error(`parameter ${name} must be a string`)
    if (descriptor?.enum && !descriptor.enum.includes(value)) throw new Error(`parameter ${name} has an invalid value`)
  }
}

function queryParams(request: DataRequest, allowed: string[]): URLSearchParams {
  const params = new URLSearchParams()
  for (const name of allowed) {
    const value = queryValue(request.params[name])
    if (value !== undefined) {
      const encoded = String(value)
      if (encoded.length > 2048) throw new Error(`parameter ${name} exceeds maximum length`)
      params.set(name, encoded)
    }
  }
  return params
}

async function callFuyao(baseUrl: string, apiKey: string, path: string, params: URLSearchParams, signal: AbortSignal, outputSchema: object): Promise<{ data: unknown; schema: object }> {
  const query = params.toString()
  const response = await fetch(`${baseUrl}${path}${query ? `?${query}` : ''}`, { headers: { 'X-api-key': apiKey, Accept: 'application/json' }, signal })
  if (!response.ok) throw new Error(`Fuyao HTTP error ${response.status}`)
  const envelope = await response.json() as ApiEnvelope
  if (envelope.code !== 0) throw new Error(`Fuyao API error ${envelope.code ?? 'unknown'}: ${envelope.message ?? 'request failed'}${envelope.request_id ? ` (request_id: ${envelope.request_id})` : ''}`)
  return { data: envelope.data ?? null, schema: outputSchema }
}

function source(name: string, capability: string, description: string, input_schema: object, output_schema: object, path: string, allowed: string[], baseUrl: string, resolveApiKey: FuyaoApiKeyResolver, paginated = false): DataSource {
  const schema: SchemaDescriptor = {
    capability,
    name,
    source: 'api:fuyao',
    // 内部数据源身份证（provider.kind.resource）：宿主路由/审计用，不进入模型协议。
    data_key: buildDataKey('fuyao', 'api', path),
    source_label: 'fuyao',
    paginated,
    description,
    input_schema,
    output_schema,
  }
  return {
    schema,
    validateOutput: (data) => validateEnvelopeFields(data, REQUIRED_OUTPUT_FIELDS[name] ?? []),
    execute: async (request, signal) => {
      validateInputSchema(input_schema, request.params, allowed)
      const apiKey = await resolveApiKey()
      if (!apiKey) throw new Error(`FUYAO_API_KEY is not configured; data source ${name} is unavailable`)
      return callFuyao(baseUrl, apiKey, path, queryParams(request, allowed), signal, output_schema)
    },
  }
}

const envelopeData = (item: object): object => ({ type: 'object', properties: { timestamp: { type: 'integer' }, total: { type: 'integer' }, item }, additionalProperties: true })
const searchOutput = envelopeData({ type: 'array', items: { type: 'object', properties: { thscode: { type: 'string' }, ticker: { type: 'string' }, name: { type: 'string' }, exchange: { type: 'string' }, asset_type: { type: 'string' }, currency: { type: 'string' } }, additionalProperties: true } })
const snapshotOutput = envelopeData({ type: 'array', items: { type: 'object', properties: { thscode: { type: 'string' }, ticker: { type: 'string' }, last_price: { type: 'number' }, price_change: { type: 'number' }, price_change_ratio_pct: { type: 'number' }, open_price: { type: 'number' }, high_price: { type: 'number' }, low_price: { type: 'number' }, prev_price: { type: 'number' }, volume: { type: 'number' }, turnover: { type: 'number' } }, additionalProperties: true } })
const klineOutput = envelopeData({ type: 'array', items: { type: 'object', properties: { date_ms: { type: 'integer' }, open_price: { type: 'number' }, high_price: { type: 'number' }, low_price: { type: 'number' }, close_price: { type: 'number' }, volume: { type: 'number' }, turnover: { type: 'number' } }, additionalProperties: true } })
const calendarOutput = envelopeData({ type: 'array', items: { type: 'object', properties: { date_ms: { type: 'integer' }, date: { type: 'string' } }, additionalProperties: true } })

const REQUIRED_OUTPUT_FIELDS: Record<string, string[]> = {
  get_meta_tickers_search: ['thscode', 'name'],
  get_a_share_prices_snapshot: ['last_price'],
  get_a_share_prices_historical: ['date_ms', 'close_price'],
  get_a_share_calendar_trading_days: ['date_ms', 'date'],
}

function validateEnvelopeFields(data: unknown, requiredFields: string[]): boolean {
  if (!requiredFields.length) return true
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const item = (data as { item?: unknown }).item
  if (!Array.isArray(item)) return false
  return item.every((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false
    return requiredFields.every((field) => field in row)
  })
}

export function createFuyaoRestSources(resolveApiKey: FuyaoApiKeyResolver, baseUrl = DEFAULT_BASE_URL): DataSource[] {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '')
  return [
    source(
      'get_meta_tickers_search', 'ticker_search',
      '按名称、代码或简称检索并消歧为完整 thscode（禁止自行拼接交易所后缀，先消歧再请求业务数据）。q 必填；exchange 取值 SH/SZ/BJ；asset_type 逗号分隔。',
      objectSchema({
        q: { type: 'string', description: '检索关键字：中文名、纯 ticker 或完整 thscode（如 贵州茅台 / 600519 / 600519.SH）' },
        exchange: { type: 'string', description: '交易所过滤：SH / SZ / BJ' },
        asset_type: { type: 'string', description: '资产类型过滤（逗号分隔）：a-share、a-share-index、forex、fund-otc、fund-etf、fund-lof、fund-reits' },
        limit: { type: 'integer', description: '返回条数上限，默认 10，最大 50' },
      }, ['q']),
      searchOutput, '/api/meta/tickers/search', ['q', 'exchange', 'asset_type', 'limit'], cleanBaseUrl, resolveApiKey,
    ),
    source(
      'get_a_share_prices_snapshot', 'quote',
      '获取 A 股行情快照。两种模式：①指定标的：thscodes 传逗号分隔的完整代码（如 600519.SH,000001.SZ），忽略分页；②全市场遍历：省略 thscodes，用 limit/offset。快照不含股票名称。',
      objectSchema({
        thscodes: { type: 'string', description: '逗号分隔的完整交易所代码（如 600519.SH,000001.SZ），需先经 ticker_search 消歧' },
        limit: { type: 'integer', description: '全市场模式分页大小，默认 100' },
        offset: { type: 'integer', description: '全市场模式分页游标，默认 0' },
      }),
      snapshotOutput, '/api/a-share/prices/snapshot', ['thscodes', 'limit', 'offset'], cleanBaseUrl, resolveApiKey, true,
    ),
    source(
      'get_a_share_prices_historical', 'history',
      '获取单只标的历史日 K 线。thscode 必须是单只（不可逗号）；interval 当前固定支持 1d（日线）；start/end 为毫秒级 Unix 时间戳（Asia/Shanghai），end >= start，跨度不超过 10 年；adjust 默认 forward（前复权）。',
      objectSchema({
        thscode: { type: 'string', description: '单只标的完整代码（如 600519.SH），不可多只/逗号' },
        interval: { type: 'string', enum: ['1d'], description: 'K 线周期，当前固定支持 1d（日线）' },
        start: { type: 'integer', description: '起始毫秒级 Unix 时间戳（Asia/Shanghai，例如 2026-08-31 00:00:00 为 1788134400000 量级）' },
        end: { type: 'integer', description: '截止毫秒级 Unix 时间戳；end >= start；单次跨度不超过 10 年' },
        adjust: { type: 'string', enum: ['none', 'forward', 'backward'], description: '复权模式：none 不复权 / forward 前复权（默认）/ backward 后复权' },
        offset: { type: 'integer', description: '分页偏移，默认 0' },
      }, ['thscode', 'interval', 'start', 'end']),
      klineOutput, '/api/a-share/prices/historical', ['thscode', 'interval', 'start', 'end', 'adjust', 'offset'], cleanBaseUrl, resolveApiKey, true,
    ),
    source(
      'get_a_share_calendar_trading_days', 'trading_calendar',
      '获取近一年（365 天）A 股交易日历；无需任何参数。返回 item[]：date_ms 为交易日零点毫秒戳，date 为 YYYYMMDD 字符串。',
      objectSchema({}),
      calendarOutput, '/api/a-share/calendar/trading-days', [], cleanBaseUrl, resolveApiKey,
    ),
  ]
}

export async function resolveFuyaoApiKey(ctx: Context): Promise<string | undefined> {
  const credentials = ctx.get('credentials') as CredentialLike | undefined
  if (credentials) {
    for (const ref of ['FUYAO_API_KEY']) {
      const resolved = await credentials.resolve(ref)
      if (resolved?.value) return resolved.value
    }
  }
  const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return processLike?.env?.FUYAO_API_KEY
}