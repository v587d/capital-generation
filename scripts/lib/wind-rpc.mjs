/**
 * Protocol-level Wind MCP JSON-RPC (initialize / tools/list), shared by spike-wind and the probe.
 * Intentionally not the production wind-client: its callTool is initialize + tools/call, and the
 * second round trip is billable. ⛔ Never log the authorization header or response bodies.
 */

export const WIND_BASE = 'https://mcp.wind.com.cn'

export const WIND_INITIALIZE_PARAMS = {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'capital-generation', version: 'contract-probe' },
}

/** Upstream answers either plain JSON or SSE; take the last `data:` line. */
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
      // A redirect would replay the Bearer header to another origin.
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
