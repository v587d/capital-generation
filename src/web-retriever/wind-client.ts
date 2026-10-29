/**
 * Wind financial-document client: JSON-RPC 2.0 (MCP wire protocol) over plain
 * HTTP. initialize -> tools/call, no session state, no SDK.
 */

export const DEFAULT_WIND_ENDPOINT = 'https://mcp.wind.com.cn/vserver_financial_docs/mcp/'
export const WIND_REQUEST_TIMEOUT_MS = 60_000
export const WIND_MAX_CONTENT_CHARS = 20_000

/**
 * Hosted MCP servers (`server_type` -> URL). `analytics_data` is listed to record
 * that it exists but is unusable (initialize hangs), so no data source uses it.
 */
export const WIND_SERVER_ENDPOINTS = {
  stock_data: 'https://mcp.wind.com.cn/vserver_stock_data/mcp/',
  fund_data: 'https://mcp.wind.com.cn/vserver_fund_data/mcp/',
  index_data: 'https://mcp.wind.com.cn/vserver_index_data/mcp/',
  bond_data: 'https://mcp.wind.com.cn/vserver_bond_data/mcp/',
  financial_docs: DEFAULT_WIND_ENDPOINT,
  economic_data: 'https://mcp.wind.com.cn/vserver_economic_data/mcp/',
  analytics_data: 'https://mcp.wind.com.cn/vserver_analytics_data/mcp/',
} as const

export type WindServerType = keyof typeof WIND_SERVER_ENDPOINTS

/**
 * Error classes drive fallback: AUTH=missing/invalid key; RATE_LIMIT=429;
 * NETWORK=network/5xx/timeout; BACKEND=API/business; INVALID=unparseable.
 */
export type WindErrorCode = 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'BACKEND' | 'INVALID'

export interface WindCallResult {
  ok: boolean
  /** Parsed JSON result; string fields clipped to WIND_MAX_CONTENT_CHARS. */
  data?: unknown
  /** Non-JSON body passed through (<= WIND_MAX_CONTENT_CHARS). */
  content?: string
  content_chars?: number
  error?: string
  code?: WindErrorCode
}

/** Must match `package.json` version; a test pins the two together. */
export const WIND_CLIENT_VERSION = '2.13.2'

export interface WindClient {
  callTool(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<WindCallResult>
}

export interface WindClientOptions {
  endpoint?: string
  /** Re-resolve the key on every call, never cache it. */
  resolveApiKey: () => Promise<string | undefined>
  /** Per-request timeout (initialize and tools/call separately); default 60000. */
  timeoutMs?: number
  /** Network-error retry delays; default [300, 1000], shortened only in tests. */
  retryDelaysMs?: number[]
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class WindTransportError extends Error {
  constructor(readonly code: WindErrorCode, message: string) {
    super(message)
  }
}

/** HTTP status -> error class; anything else is NETWORK. */
const HTTP_ERROR_CODES: Record<number, WindErrorCode> = {
  401: 'AUTH',
  429: 'RATE_LIMIT',
  500: 'NETWORK',
  502: 'NETWORK',
  503: 'NETWORK',
  504: 'NETWORK',
}

const RETRY_ATTEMPTS = 3
const DEFAULT_RETRY_DELAYS_MS = [300, 1_000]

function normalizeEndpoint(endpoint?: string): string {
  const raw = (endpoint ?? DEFAULT_WIND_ENDPOINT).trim()
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('endpoint must use http or https')
    }
  } catch (error) {
    throw new Error(`invalid Wind endpoint: ${errorText(error)}`)
  }
  return raw
}

/** Body may be pure JSON or SSE (last `data:` line). */
function parseResponsePayload(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // Not a JSON object: fall through to the SSE parse below.
    }
  }
  let last: string | undefined
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data: ')) last = line.slice('data: '.length)
  }
  if (last !== undefined) {
    try {
      return JSON.parse(last)
    } catch (error) {
      throw new Error(`SSE data 行 JSON 解析失败：${errorText(error)}；原文前 200 字符：${text.slice(0, 200)}`)
    }
  }
  throw new Error(`响应格式无法识别（既非 JSON 也非 SSE）；原文前 200 字符：${text.slice(0, 200)}`)
}

/** Deep-clip long string fields, preserving structure. */
function trimDeep(value: unknown, maxChars: number): unknown {
  if (typeof value === 'string') return value.length > maxChars ? value.slice(0, maxChars) : value
  if (Array.isArray(value)) return value.map((item) => trimDeep(item, maxChars))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = trimDeep(item, maxChars)
    }
    return out
  }
  return value
}

function firstContentText(result: Record<string, unknown>): string | undefined {
  const content = result.content
  if (!Array.isArray(content) || content.length === 0) return undefined
  const first = content[0]
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const record = first as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') return record.text
  }
  return undefined
}

/** Render a JSON-RPC error field as text. */
function rpcErrorText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>
  if (record.error === undefined || record.error === null) return undefined
  const error = record.error
  if (typeof error === 'string' && error) return error
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string' && message) return message
  }
  return JSON.stringify(error).slice(0, 2_000)
}

/**
 * Wind wraps business errors inside content[0].text JSON, so unpack a second time:
 * mcp_tool_error_code / error{} / data.code.
 */
function innerBusinessError(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const record = data as Record<string, unknown>
  const toolErrorCode = record.mcp_tool_error_code
  if (typeof toolErrorCode === 'number' && toolErrorCode !== 0) {
    return typeof record.mcp_tool_error_msg === 'string' && record.mcp_tool_error_msg
      ? record.mcp_tool_error_msg
      : JSON.stringify(record).slice(0, 2_000)
  }
  if (record.error && typeof record.error === 'object' && !Array.isArray(record.error)) {
    const nested = record.error as Record<string, unknown>
    if (nested.code !== undefined || nested.message !== undefined) {
      return (typeof nested.message === 'string' && nested.message) || JSON.stringify(nested).slice(0, 2_000)
    }
  }
  if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
    const nested = record.data as Record<string, unknown>
    const numeric = typeof nested.code === 'number'
      ? nested.code
      : typeof nested.code === 'string' && /^\d+$/.test(nested.code.trim())
        ? Number(nested.code.trim())
        : null
    const success = numeric === null || numeric === 0 || (numeric >= 200 && numeric < 300)
    if (!success) {
      return (typeof nested.message === 'string' && nested.message) || JSON.stringify(nested).slice(0, 2_000)
    }
  }
  return undefined
}

/** JSON-RPC result -> WindCallResult, including isError and inner business errors. */
function interpretResult(payload: unknown): WindCallResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, code: 'INVALID', error: 'Wind 返回不可解析（非 JSON-RPC 对象）' }
  }
  const rpcError = rpcErrorText(payload)
  if (rpcError) return { ok: false, code: 'BACKEND', error: rpcError }
  const result = (payload as Record<string, unknown>).result
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { ok: false, code: 'INVALID', error: 'Wind 返回缺少 result' }
  }
  const resultRecord = result as Record<string, unknown>
  if (resultRecord.isError === true) {
    const text = firstContentText(resultRecord)
    return { ok: false, code: 'BACKEND', error: text ?? JSON.stringify(resultRecord).slice(0, 2_000) }
  }
  const innerText = firstContentText(resultRecord)
  if (innerText === undefined) {
    return { ok: false, code: 'INVALID', error: 'Wind 返回缺少 content[0].text 文本' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(innerText)
  } catch {
    parsed = undefined
  }
  if (parsed === undefined) {
    const content = innerText.slice(0, WIND_MAX_CONTENT_CHARS)
    return { ok: true, content, content_chars: content.length }
  }
  const businessError = innerBusinessError(parsed)
  if (businessError) return { ok: false, code: 'BACKEND', error: businessError }
  return { ok: true, data: trimDeep(parsed, WIND_MAX_CONTENT_CHARS) }
}

/** Endpoint is validated at construction so config errors surface immediately. */
export function createWindClient(options: WindClientOptions): WindClient {
  const endpoint = normalizeEndpoint(options.endpoint)
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : WIND_REQUEST_TIMEOUT_MS
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  let nextId = 1

  async function postOnce(method: string, params: unknown, apiKey: string, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new WindTransportError('NETWORK', 'Wind 请求已取消')
    const controller = new AbortController()
    const onExternalAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onExternalAbort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('Wind request timed out'))
    }, timeoutMs)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
        signal: controller.signal,
      })
      if (!response.ok) {
        await response.text().catch(() => '')
        throw new WindTransportError(HTTP_ERROR_CODES[response.status] ?? 'NETWORK', `Wind HTTP ${response.status}`)
      }
      return parseResponsePayload(await response.text())
    } catch (error) {
      if (timedOut) throw new WindTransportError('NETWORK', `Wind 请求超时（${timeoutMs}ms）`)
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onExternalAbort)
    }
  }

  /** Retry network errors with backoff; HTTP status errors and caller cancels do not retry. */
  async function postRpc(method: string, params: unknown, apiKey: string, signal?: AbortSignal): Promise<unknown> {
    let lastError: unknown
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await postOnce(method, params, apiKey, signal)
      } catch (error) {
        if (error instanceof WindTransportError) throw error
        if (signal?.aborted) throw error
        lastError = error
        if (attempt < RETRY_ATTEMPTS) {
          const delayMs = retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)]
          if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }
    }
    throw new WindTransportError('NETWORK', `Wind 请求失败（已重试 ${RETRY_ATTEMPTS - 1} 次）：${errorText(lastError)}`)
  }

  return {
    async callTool(toolName, args, signal) {
      try {
        const apiKey = await options.resolveApiKey()
        if (!apiKey) {
          return { ok: false, code: 'AUTH', error: 'Wind API Key 未配置（credentials 与环境变量均未提供）' }
        }
        const initialized = await postRpc('initialize', {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'capital-generation', version: WIND_CLIENT_VERSION },
        }, apiKey, signal)
        const initError = rpcErrorText(initialized)
        if (initError) return { ok: false, code: 'BACKEND', error: initError }
        const payload = await postRpc('tools/call', {
          name: toolName,
          arguments: args,
          _meta: { clientVersion: WIND_CLIENT_VERSION },
        }, apiKey, signal)
        return interpretResult(payload)
      } catch (error) {
        if (error instanceof WindTransportError) {
          return { ok: false, code: error.code, error: error.message }
        }
        return { ok: false, code: 'INVALID', error: `Wind 调用失败：${errorText(error)}` }
      }
    },
  }
}
