/**
 * 东财（eastmoney.com）**共享网络面**：全进程一个节流器、一条请求路径。
 *
 * ## 为什么需要它（2026-09-24 核实）
 *
 * 本仓的东财出口一度是**两份互不知情的实现**：`src/data-collector` 侧经由
 * `src/sources/eastmoney-http.ts` 的裸 `fetch`（无 sleep、无队列），web_retriever 侧是我新加的
 * 第二个客户端。两份独立节流 = 同一个出口 IP 上两个速率，等于没限。
 *
 * 社区实测的东财风控阈值是「每秒 >5 次 / 单 IP 并发 ≥10 / 1 分钟 ≥200 次 / 5 分钟 ≥300 次 →
 * 临时封 IP」，参考实践因此要求 `em_get()` 串行 + 限流。本仓 `DataCollectorHub` 的 FIFO 只保证
 * "同一时刻只跑一个请求"，**不含最小间隔**——串行 ≠ 节流，连打十个请求仍是一秒十次。
 *
 * ## 分层（刻意如此，不要合并）
 *
 * - **数据面**按「可复用性」分两处，这是有意的：
 *   - 可复用的**数值/分页**端点（行情、财务、资金流）走 `DataCollectorHub`，落成不可变 Dataset ——
 *     那里 Dataset 复用是**收益**；
 *   - 流式的**文本**来源（快讯、个股新闻、研报）走 web_retriever 的具名来源工具 ——
 *     那里 Dataset 复用是**语义错误**（"最新 20 条快讯"不是可复用快照）。
 * - **网络面**只有这一份：两条数据面都从这里取请求路径与节流器，**共享同一个 process 级实例**。
 *   这正是"切勿一刀切"的落点：切的判据是**可复用性**（数据面），不是 provider，也不是网络面。
 *
 * ## 边界
 *
 * 本模块**不**做 SSRF 出口校验，但**出口校验在哪一份实现里**必须说清楚：
 * - web_retriever 侧的三个 `eastmoney_*` 工具通过 `createEastmoneyClient({ transport })`
 *   注入 `createHttpRequester` 的闸门实现（DNS 公网 IP 校验 + 手动重定向重校验 + 大小/超时上限），
 *   与其余六个来源共用同一份出口治理；
 * - 数据面（Hub 侧能力）用默认 transport（裸 `fetch`）：URL 全部是代码内常量 + 白名单参数，
 *   模型不能投喂任意 URL，这是既有行为。
 * 闸门只有 `createHttpRequester` 一份实现；本层只加节流与状态归类，不复制第二套校验
 * （AGENTS.md §9.7）。
 */

import { createRequestThrottle } from './throttle.js'

/**
 * 东财系请求的**共享最小间隔**（毫秒）。
 *
 * 1000ms = 1 次/秒，低于「>5 次/秒」阈值，并同时满足「1 分钟 200 次 / 5 分钟 300 次」这类累计窗口口径。
 */
export const EASTMONEY_MIN_INTERVAL_MS = 1000

const DEFAULT_USER_AGENT = 'Mozilla/5.0'

export interface EastmoneyFetchInit {
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface EastmoneyResponse {
  status: number
  /** 注入式 transport（闸门适配层）可以不提供 headers。 */
  headers?: Headers
  text: string
}

export interface EastmoneyClient {
  /**
   * 发一个东财请求并读回正文。**只负责**：串行 + 最小间隔、合并请求头、发请求、读正文、
   * 把 HTTP 错误状态归类成带 `status` 的错误。
   *
   * 刻意**不**解析 JSON、不定义错误码：两个调用方的错误码语义不同（数据面是
   * `eastmoney_http_error` / `eastmoney_rate_limit`，web_retriever 是 `SourceError` 的
   * `UPSTREAM` / `NETWORK`），在这一层统一会覆盖掉调用方自己的契约。
   */
  fetchText(url: string, init?: EastmoneyFetchInit): Promise<EastmoneyResponse>
  /**
   * 同上，但把响应解析成 JSON。
   *
   * 为什么与 `fetchText` 分开而不是让调用方自己 `JSON.parse(text)`：数据面的既有测试用具
   * **只有 `json()` 没有 `text()`** 的假 Response。走 `response.json()` 既保持数据面原有形状，
   * 也让"解析失败"能在这一层被归成同一种错误（调用方仍可自行决定错误码）。
   */
  fetchJson(url: string, init?: EastmoneyFetchInit): Promise<unknown>
}

/**: 传输层错误。`status` 只在"上游返回了 HTTP 错误状态"时给出。 */
export class EastmoneyTransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'EastmoneyTransportError'
  }
}

/** 传输器返回的最小响应形状（真实 `Response` 天然满足；闸门适配层按此构造）。 */
export interface EastmoneyTransportResponse {
  status: number
  headers?: Headers
  text(): Promise<string>
  json(): Promise<unknown>
}

/** 可注入传输器：默认裸 `fetch`（数据面），web_retriever 侧注入 SSRF 闸门实现。 */
export type EastmoneyTransport = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<EastmoneyTransportResponse>

export function createEastmoneyClient(options: {
  userAgent?: string
  minIntervalMs?: number
  /** 注入进程级共享节流器时 `minIntervalMs` 失效（节流只该有一份）。 */
  throttle?: <T>(task: () => Promise<T>) => Promise<T>
  transport?: EastmoneyTransport
} = {}): EastmoneyClient {
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT
  const throttle = options.throttle ?? createRequestThrottle(options.minIntervalMs ?? EASTMONEY_MIN_INTERVAL_MS)
  const transport = options.transport ?? createEastmoneyTransport()

  /** 节流 + 发请求 + 状态判定：两条读取路径（text / json）共用这一份，避免状态判定被复制。 */
  const send = (url: string, init: EastmoneyFetchInit): Promise<EastmoneyTransportResponse> => throttle(async () => {
    if (init.signal?.aborted) {
      const error = new Error('eastmoney request aborted')
      error.name = 'AbortError'
      throw error
    }
    let response: EastmoneyTransportResponse
    try {
      response = await transport(url, {
        headers: { 'user-agent': userAgent, ...(init.headers ?? {}) },
        ...(init.signal === undefined ? {} : { signal: init.signal }),
      })
    } catch (error) {
      // 取消原样抛出（`AbortError`），调用方据此区分"网络失败"与"调用方不要了"。
      if (error instanceof Error && error.name === 'AbortError') throw error
      // 已带分类 `code` 的错误（如闸门注入的 `LocalFetchError`：ABORTED/TIMEOUT/REDIRECT…）
      // 原样抛出：再包一层会把"取消"降级成网络失败（docs/dev/web-retriever.md §4.2），也丢掉失败原因。
      if (typeof (error as { code?: unknown })?.code === 'string') throw error
      throw new EastmoneyTransportError(`eastmoney request failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    // 按 `status` 判定而不是 `response.ok`：本仓多处测试的假 Response 只提供 status/text/json，
    // 用 `ok` 会让它们在 200 上误判成失败（真实的 fetch Response 两者都有）。
    if (response.status >= 400) {
      throw new EastmoneyTransportError(`eastmoney returned HTTP ${response.status}`, response.status)
    }
    return response
  })

  return {
    async fetchText(url, init = {}) {
      const response = await send(url, init)
      return { status: response.status, headers: response.headers, text: await response.text() }
    },
    async fetchJson(url, init = {}) {
      return await (await send(url, init)).json()
    },
  }
}

function createEastmoneyTransport(): EastmoneyTransport {
  return (url, init) => globalThis.fetch(url, init)
}

let sharedThrottle: (<T>(task: () => Promise<T>) => Promise<T>) | undefined

/**
 * **进程级共享节流器**：数据面与 web_retriever 侧可能各持一个客户端实例（transport 不同），
 * 但东财风控按出口 IP 计，节流必须仍只有一份。两侧客户端都从这里取。
 */
export function sharedEastmoneyThrottle(): <T>(task: () => Promise<T>) => Promise<T> {
  sharedThrottle ??= createRequestThrottle(EASTMONEY_MIN_INTERVAL_MS)
  return sharedThrottle
}

let shared: EastmoneyClient | undefined

/**
 * **进程级单例**（数据面用，默认裸 fetch transport）：所有默认客户端共享同一个节流器，
 * 等于回到"两份独立限流"的老问题的解法。宿主进程内所有东财请求都应经这里或
 * 显式注入 `sharedEastmoneyThrottle()` 的实例。
 */
export function sharedEastmoneyClient(): EastmoneyClient {
  shared ??= createEastmoneyClient({ throttle: sharedEastmoneyThrottle() })
  return shared
}
