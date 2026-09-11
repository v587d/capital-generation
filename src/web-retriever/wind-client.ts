/**
 * Wind 金融文档检索客户端（JSON-RPC over HTTP，零依赖）。
 *
 * 线格式为 JSON-RPC 2.0（即 MCP 线协议）：initialize → tools/call，无会话态、
 * 无 SDK、无框架依赖——与 fuyao-rest / anysearch engines 同构的普通 HTTP 客户端。
 * 协议蓝本（Wind 官方 CLI）：github.com/Wind-Alice/AliceMarket 的
 * skills/wind-mcp-skill/scripts/cli.mjs（本地参考副本在 docs/reference/，不入库）。
 */

export const DEFAULT_WIND_ENDPOINT = 'https://mcp.wind.com.cn/vserver_financial_docs/mcp/'
export const WIND_REQUEST_TIMEOUT_MS = 60_000
export const WIND_MAX_CONTENT_CHARS = 20_000

/**
 * 错误分类（persona/主 Agent 依据它决定 fallback）：
 * AUTH=Key 缺失或无效；RATE_LIMIT=429；NETWORK=网络错误/5xx/超时；
 * BACKEND=接口层与业务错误；INVALID=响应不可解析。
 */
export type WindErrorCode = 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'BACKEND' | 'INVALID'

export interface WindCallResult {
  ok: boolean
  /** 成功且正文可解析为 JSON 时：Wind 返回结果（字符串字段裁剪到 WIND_MAX_CONTENT_CHARS）。 */
  data?: unknown
  /** 成功但正文非 JSON 时：原文透传（≤WIND_MAX_CONTENT_CHARS）。 */
  content?: string
  content_chars?: number
  error?: string
  code?: WindErrorCode
}

export interface WindClient {
  callTool(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<WindCallResult>
}

export interface WindClientOptions {
  endpoint?: string
  /** 每次调用重新解析 Key，不缓存（与 anysearch engines 同策略）。 */
  resolveApiKey: () => Promise<string | undefined>
  /** 单次请求超时毫秒（initialize 与 tools/call 各自适用）；默认 60000。 */
  timeoutMs?: number
  /** 网络错误重试间隔毫秒；默认 [300, 1000]，仅供测试注入缩短。 */
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

/** HTTP 状态 → 错误分类（蓝本 HTTP_ERROR_MAP；其余状态一律 NETWORK）。 */
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

/** 响应可能是纯 JSON 或 SSE（取最后一个 data: 行）；蓝本 parseSSE 的等价实现。 */
function parseResponsePayload(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // 非 JSON 对象落到下面的 SSE 解析。
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

/** 深度裁剪：对象/数组内的字符串字段超过上限时截断（保持结构；超长响应另有 harness 剪枝兜底）。 */
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

/** JSON-RPC error 字段 → 可读文本。 */
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
 * 三层业务错误解包（蓝本 mcpRequest 后半段）：Wind 把业务错误包在 content[0].text
 * 的 JSON 字符串里，必须二次解析——mcp_tool_error_code / error{} / data.code 三种形态。
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

/** JSON-RPC result → WindCallResult：含 isError 与内层业务错误解包。 */
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

/** 创建 Wind 文档检索客户端；端点在构造时校验（配置错误立即暴露，与 anysearch 同策略）。 */
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

  /** 网络级错误按退避重试；HTTP 状态错误与调用方取消不重试（蓝本同款行为）。 */
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
          clientInfo: { name: 'capital-generation', version: '0.1.0' },
        }, apiKey, signal)
        const initError = rpcErrorText(initialized)
        if (initError) return { ok: false, code: 'BACKEND', error: initError }
        const payload = await postRpc('tools/call', {
          name: toolName,
          arguments: args,
          _meta: { clientVersion: '0.1.0' },
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
