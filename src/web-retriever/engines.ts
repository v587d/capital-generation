/**
 * AnySearch 的最小 REST 客户端。
 *
 * web_retriever 目前只支持一个后端，因此不预留多引擎注册表、动态 loader 或
 * provider 目录。未来真正接入第二个后端时，再根据实际差异抽象接口。
 */

export interface SearchHit {
  url: string
  title?: string
  snippet?: string
  content?: string
}

export interface SearchResult {
  query: string
  ok: boolean
  sources: SearchHit[]
  error?: string
}

export interface FetchResult {
  url: string
  ok: boolean
  title?: string
  content?: string
  truncated?: boolean
  error?: string
}

/** AnySearch 失败的结构化错误码。取值与拼写是下游回退判据的契约，勿随意改动。 */
export type AnySearchErrorCode =
  | 'ABORTED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'HTTP'
  | 'INVALID_RESPONSE'
  | 'INVALID_URL'
  | 'TARGET_BLOCKED'
  | 'CONTENT_TOO_LARGE'
  | 'UNSUPPORTED_CONTENT'
  | 'UPSTREAM'

/** AnySearch 上游 error_code → 本地错误码映射。对齐官方 fetch-provider 的 webErrorCode 表。 */
const ERROR_CODE_MAP: Record<string, AnySearchErrorCode> = {
  invalid_extract_url: 'INVALID_URL',
  extract_target_blocked: 'TARGET_BLOCKED',
  extract_content_too_large: 'CONTENT_TOO_LARGE',
  extract_unsupported_content: 'UNSUPPORTED_CONTENT',
  extract_timeout: 'TIMEOUT',
}

/** 带结构化错误码的 AnySearch 失败；message 沿用既有拼法，保证既有断言仍通过。 */
export class AnySearchError extends Error {
  readonly code: AnySearchErrorCode
  readonly upstreamCode?: string
  readonly status?: number

  constructor(
    code: AnySearchErrorCode,
    path: string,
    detail: string,
    extra?: { upstreamCode?: string; status?: number },
  ) {
    super(`AnySearch ${path} error: ${detail}`)
    this.name = 'AnySearchError'
    this.code = code
    if (extra?.upstreamCode !== undefined) this.upstreamCode = extra.upstreamCode
    if (extra?.status !== undefined) this.status = extra.status
  }
}

/**
 * AnySearch 失败后是否值得改走本机直连回退。
 * 只有调用方取消、URL 非法与内容类型不受支持三类不回退；其余都回退。
 */
export function shouldFallbackToLocalFetch(code: AnySearchErrorCode): boolean {
  return code !== 'ABORTED' && code !== 'INVALID_URL' && code !== 'UNSUPPORTED_CONTENT'
}

export interface AnySearchClient {
  search(request: { query: string; max_results?: number }, signal?: AbortSignal): Promise<unknown>
  extract(request: { url: string }, signal?: AbortSignal): Promise<unknown>
}

export const DEFAULT_BASE_URL = 'https://api.anysearch.com'
export const REQUEST_TIMEOUT_MS = 60_000
export const MAX_CONTENT_CHARS = 20_000

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function responseData(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>
  }
  return record
}

export function normalizeSearchHit(raw: unknown): SearchHit | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.url !== 'string' || record.url.length === 0) return null
  return {
    url: record.url,
    ...(typeof record.title === 'string' && record.title ? { title: record.title } : {}),
    ...(typeof record.snippet === 'string' && record.snippet ? { snippet: record.snippet } : {}),
    ...(typeof record.content === 'string' && record.content
      ? { content: record.content.slice(0, MAX_CONTENT_CHARS) }
      : {}),
  }
}

export function normalizeSearchResponse(query: string, raw: unknown): SearchResult {
  const data = responseData(raw)
  if (!data || !Array.isArray(data.results)) {
    return { query, ok: false, sources: [], error: 'AnySearch returned an invalid search response' }
  }
  return {
    query,
    ok: true,
    sources: data.results
      .map(normalizeSearchHit)
      .filter((hit): hit is SearchHit => hit !== null),
  }
}

export function normalizeFetchResponse(url: string, raw: unknown): FetchResult {
  const data = responseData(raw)
  if (!data) return { url, ok: false, error: 'AnySearch returned an invalid fetch response' }
  const title = typeof data.title === 'string' && data.title ? data.title : undefined
  const sourceContent = typeof data.content === 'string' && data.content ? data.content : undefined
  const content = sourceContent ? sourceContent.slice(0, MAX_CONTENT_CHARS) : undefined
  const truncated = sourceContent !== undefined && sourceContent.length > MAX_CONTENT_CHARS
  if (!title && !content) return { url, ok: false, error: 'fetch returned no content' }
  return {
    url,
    ok: true,
    ...(title ? { title } : {}),
    ...(content ? { content } : {}),
    ...(truncated ? { truncated: true } : {}),
  }
}

export function envKey(name: string): string | undefined {
  const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return processLike?.env?.[name] || undefined
}

/** 创建 AnySearch REST 客户端；API key 每次请求重新解析，不缓存。 */
export function createAnySearchClient(
  baseURL = DEFAULT_BASE_URL,
  resolveApiKey: () => Promise<string | undefined> = async () => envKey('ANYSEARCH_API_KEY'),
): AnySearchClient {
  const root = baseURL.replace(/\/+$/, '')
  try {
    const url = new URL(`${root}/v1/search`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('baseURL must use http or https')
    }
  } catch (error) {
    throw new Error(`invalid AnySearch baseURL: ${errorText(error)}`)
  }

  async function request(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new AnySearchError('ABORTED', path, 'request aborted')
    const timeout = new AbortController()
    const onAbort = () => timeout.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      timeout.abort(new Error('AnySearch request timed out'))
    }, REQUEST_TIMEOUT_MS)
    const fail = (
      code: AnySearchErrorCode,
      detail: string,
      extra?: { upstreamCode?: string; status?: number },
    ) => new AnySearchError(code, path, detail, extra)
    try {
      const apiKey = await resolveApiKey()
      const headers: Record<string, string> = {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'dsh/0.1.4',
        'x-anysearch-client': 'dsh/0.1.4',
      }
      if (apiKey) headers.authorization = `Bearer ${apiKey}`
      let response: Response
      try {
        response = await fetch(`${root}${path}`, {
          method: 'POST',
          redirect: 'error',
          headers,
          body: JSON.stringify(body),
          signal: timeout.signal,
        })
      } catch (error) {
        if (timedOut) throw fail('TIMEOUT', 'request timed out')
        if (signal?.aborted) throw fail('ABORTED', 'request aborted')
        throw fail('NETWORK', errorText(error))
      }
      const text = await response.text()
      let parsed: Record<string, unknown> | undefined
      try {
        const value = JSON.parse(text)
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          parsed = value as Record<string, unknown>
        }
      } catch {
        // 非 JSON 响应转成下面的明确错误。
      }
      const code = parsed?.code
      const message = typeof parsed?.message === 'string' && parsed.message ? parsed.message : undefined
      const errorCode = typeof parsed?.error_code === 'string' ? parsed.error_code : undefined
      const detail = () => errorCode
        ? `${message ?? 'request failed'} (${errorCode})`
        : (message ?? `HTTP ${response.status}`)
      const upstream = errorCode ? { upstreamCode: errorCode } : {}
      if (response.status === 401 || response.status === 403) {
        throw fail('AUTH', detail(), { ...upstream, status: response.status })
      }
      if (response.status === 429) {
        throw fail('RATE_LIMIT', detail(), { ...upstream, status: response.status })
      }
      if (!response.ok) {
        throw fail('HTTP', detail(), { ...upstream, status: response.status })
      }
      if (!parsed) throw fail('INVALID_RESPONSE', 'invalid JSON response')
      if (code !== undefined && code !== 0) {
        const mapped = errorCode ? (ERROR_CODE_MAP[errorCode] ?? 'UPSTREAM') : 'UPSTREAM'
        throw fail(mapped, detail(), upstream)
      }
      return parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  return {
    search: (requestArgs, signal) => request('/v1/search', requestArgs, signal),
    extract: (requestArgs, signal) => request('/v1/extract', requestArgs, signal),
  }
}




