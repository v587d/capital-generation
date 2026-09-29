/**
 * Fuyao REST 的最小请求内核：**零 import 的叶子模块**。
 *
 * 为什么单独一份：host 平面的嵌套包（`capital-watchlist/index.js`）与插件侧的数据能力
 * （`fuyao-rest.ts`）必须共用同一套 base URL、鉴权头、信封 `code` 判定与错误文案——
 * "同一知识只有一份实现"（AGENTS.md §9.7）。这一层一旦被别的模块拖进来，host 半边
 * 就会顺带加载整棵插件依赖树，所以这里不放校验器、能力定义、也不放任何类型依赖。
 *
 * 错误文案逐字保持历史形态（Agent 与用户看到的字符串不能因抽取而漂移）；结构化的
 * `kind` / `code` 是给自选股那一类需要映射成自己错误码的消费者用的。
 */

export const DEFAULT_FUYAO_BASE_URL = 'https://fuyao.aicubes.cn'

/** 单值参数长度上限；与历史 `MAX_PARAM_LENGTH` 同值。 */
export const FUYAO_MAX_PARAM_LENGTH = 2048

export type FuyaoApiEnvelope = { code?: number; message?: string; request_id?: string; data?: unknown }
export type FuyaoParams = Record<string, unknown>

/** 失败归类：`http_429` 与 `code=4001` 都是限流，`closed` 是能力级不可用（重试无意义）。 */
export type FuyaoFailureKind = 'credential_missing' | 'rate_limited' | 'capability_closed' | 'invalid_parameter' | 'http_error' | 'upstream_error'

export class FuyaoError extends Error {
  readonly kind: FuyaoFailureKind
  readonly status?: number
  readonly code?: number
  readonly requestId?: string

  constructor(kind: FuyaoFailureKind, message: string, details: { status?: number; code?: number; requestId?: string } = {}) {
    super(message)
    this.name = 'FuyaoError'
    this.kind = kind
    this.status = details.status
    this.code = details.code
    this.requestId = details.requestId
  }
}

export function normalizeFuyaoBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '')
}

/** 只带上声明过的参数；类型与长度不符就拒，绝不把拼写错误的键悄悄发上去。 */
export function fuyaoQuery(params: FuyaoParams, allowed: string[]): URLSearchParams {
  const search = new URLSearchParams()
  for (const name of allowed) {
    const value = params[name]
    if (value === undefined) continue
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new FuyaoError('invalid_parameter', `parameter ${name} must be a string, a number or a boolean`)
    }
    const encoded = String(value)
    if (encoded.length > FUYAO_MAX_PARAM_LENGTH) throw new FuyaoError('invalid_parameter', `parameter ${name} exceeds maximum length`)
    search.set(name, encoded)
  }
  return search
}

/**
 * 发一次 Fuyao 请求并返回信封。调用方自己决定如何消费 `data`；
 * 非 0 信封、非 2xx HTTP、2004 能力封闭都以 `FuyaoError` 抛出，文案与历史一致。
 */
export async function fuyaoRequest(input: {
  baseUrl: string
  apiKey: string | undefined
  path: string
  search: URLSearchParams
  signal: AbortSignal
}): Promise<FuyaoApiEnvelope> {
  if (!input.apiKey) {
    throw new FuyaoError('credential_missing', 'FUYAO_API_KEY is not configured')
  }
  const query = input.search.toString()
  const response = await fetch(`${normalizeFuyaoBaseUrl(input.baseUrl)}${input.path}${query ? `?${query}` : ''}`, {
    headers: { 'X-api-key': input.apiKey, Accept: 'application/json' },
    signal: input.signal,
  })
  if (response.status === 429) {
    throw new FuyaoError('rate_limited', `Fuyao HTTP error 429`, { status: 429 })
  }
  if (!response.ok) throw new FuyaoError('http_error', `Fuyao HTTP error ${response.status}`, { status: response.status })
  const envelope = await response.json() as FuyaoApiEnvelope
  // 2004 = 该能力是同花顺 AI 客户端专用，未开放外部接入（实测 capital-flow / high-frequency 均如此）。
  // 这是能力级不可用，不是瞬时故障：错误文案必须让调用方停止重试，否则会白烧配额与回合。
  if (envelope.code === 2004) {
    throw new FuyaoError('capability_closed', 'Fuyao API error 2004: 该数据能力为同花顺 AI 客户端专用，当前未开放外部接入；不要重试，改用其他能力或如实告知用户该能力不可用', { code: 2004, requestId: envelope.request_id })
  }
  // 4001 = 频率超限（官方口径：避免立即连续重试）。
  if (envelope.code === 4001) {
    throw new FuyaoError('rate_limited', `Fuyao API error 4001: ${envelope.message ?? 'request failed'}${envelope.request_id ? ` (request_id: ${envelope.request_id})` : ''}`, { code: 4001, requestId: envelope.request_id })
  }
  // 1002 / 1003 = 参数格式与取值域（自选股要靠它区分"这个标的取不到"与"请求写错了"）。
  if (envelope.code === 1002 || envelope.code === 1003) {
    throw new FuyaoError('invalid_parameter', `Fuyao API error ${envelope.code}: ${envelope.message ?? 'request failed'}${envelope.request_id ? ` (request_id: ${envelope.request_id})` : ''}`, { code: envelope.code, requestId: envelope.request_id })
  }
  if (envelope.code !== 0) {
    throw new FuyaoError('upstream_error', `Fuyao API error ${envelope.code ?? 'unknown'}: ${envelope.message ?? 'request failed'}${envelope.request_id ? ` (request_id: ${envelope.request_id})` : ''}`, { code: envelope.code, requestId: envelope.request_id })
  }
  return envelope
}

/** 行数组位置：这些端点的行都在 `data.item` 下（信封里 `data` 可能为 null）。 */
export function fuyaoItems(envelope: FuyaoApiEnvelope): FuyaoParams[] {
  const data = envelope.data as FuyaoParams | null | undefined
  const rows = data?.item
  return Array.isArray(rows) ? rows as FuyaoParams[] : []
}

/** `data.timestamp`（毫秒）；无有效数据时上游给 null，不补零。 */
export function fuyaoTimestamp(envelope: FuyaoApiEnvelope): number | null {
  const data = envelope.data as FuyaoParams | null | undefined
  return typeof data?.timestamp === 'number' ? data.timestamp : null
}
