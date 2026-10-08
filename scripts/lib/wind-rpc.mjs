/**
 * Wind MCP 的**协议级** JSON-RPC（`initialize` / `tools/list`）——两处共用的一份实现：
 * `scripts/spike-wind.mjs` 与契约巡检。
 *
 * 为什么单独一份而不是用生产的 `src/web-retriever/wind-client.ts`：那颗客户端只暴露
 * `callTool`，而 `callTool` 是 `initialize` + `tools/call` **两次往返**，第二次就是计费调用。
 * 巡检要的是**不计费**的协议面（设计 §10 第 1 条），两者刻意不是一回事，别互相顶替。
 *
 * ⛔ 只返回解析后的对象，任何调用方都不许把 `authorization` 头或响应正文写进日志。
 */

export const WIND_BASE = 'https://mcp.wind.com.cn'

export const WIND_INITIALIZE_PARAMS = {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'capital-generation', version: 'contract-probe' },
}

/** 响应可能是 plain JSON，也可能是 SSE（取最后一条 `data:`）——上游两种都发过。 */
export function parseRpcPayload(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed)
  let last
  for (const line of text.split(/\r?\n/)) if (line.startsWith('data: ')) last = line.slice(6)
  if (last === undefined) throw new Error('Wind 响应既不是 JSON 也不是 SSE')
  return JSON.parse(last)
}

export function createWindRpc({ endpoint, resolveApiKey, timeoutMs = 60_000 }) {
  let nextId = 1
  async function rpc(method, params) {
    const apiKey = await resolveApiKey()
    if (!apiKey) throw new Error('WIND_API_KEY 未解析到（环境变量或 ~/.dsh/.credentials.yaml 的 refs）')
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      // 重定向会把 Bearer 带到第二个 origin 上去，等于凭据外流。
      redirect: 'error',
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      const error = new Error(`Wind ${method} 返回 HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    const payload = parseRpcPayload(await response.text())
    if (payload?.error) {
      const error = new Error(`Wind ${method} 业务错误：${payload.error.message ?? JSON.stringify(payload.error)}`)
      error.rpcCode = payload.error.code
      throw error
    }
    return payload?.result
  }
  return {
    initialize: () => rpc('initialize', WIND_INITIALIZE_PARAMS),
    toolsList: () => rpc('tools/list', {}),
  }
}
