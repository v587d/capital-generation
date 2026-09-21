import {
  AnySearchError,
  normalizeFetchResponse,
  normalizeSearchResponse,
  shouldFallbackToLocalFetch,
} from './engines.js'
import type { AnySearchClient, AnySearchErrorCode, SearchResult } from './engines.js'
import { LocalFetchError } from './local-fetch.js'
import type { LocalFetchErrorCode } from './local-fetch.js'

/** 最终产出这份正文的来源；`ok:false` 时恒为 `'anysearch'`（主路）。 */
export type FetchVia = 'anysearch' | 'local-http'

/** 触发回退的那次 AnySearch 失败；永远只描述 AnySearch 侧。 */
export interface FetchFallbackNote {
  from: 'anysearch'
  code: AnySearchErrorCode
  error: string
}

/** 本地抓取自己失败的原因；只在"回退被尝试且本地也失败"时出现。 */
export interface FetchLocalErrorNote {
  code: LocalFetchErrorCode
  error: string
}

/**
 * `web_retriever_fetch` 的回执。
 *
 * - `via`：最终产出这份正文的来源；`ok:false` 时恒为 `'anysearch'`（主路）。
 * - `fallback`：触发回退的那次 AnySearch 失败，永远只描述 AnySearch 侧
 *   （回退成功与"回退尝试后本地也失败"两种情形都会出现）。
 * - `local_error`：本地抓取自己失败的原因，只在"回退被尝试且本地也失败"时出现。
 *   `fallback.error` 是 AnySearch 的错、`local_error.error` 是本地的错，两者不重复。
 * - `truncated`：正文被截断过（AnySearch 侧截断、本地字节截断、本地字符截断、转换省略，任一为真）。
 */
export interface FetchResult {
  url: string
  ok: boolean
  via: FetchVia
  title?: string
  content?: string
  truncated?: boolean
  fallback?: FetchFallbackNote
  error?: string
  code?: AnySearchErrorCode
  local_error?: FetchLocalErrorNote
}

/**
 * 本地抓取器的结构类型。构造函数不传 `localFetch` 即"不启用回退"，
 * 由 `src/index.ts` 按配置决定是否传入。
 */
export interface LocalFetcherLike {
  fetch(url: string, signal?: AbortSignal): Promise<{
    url: string
    status: number
    title?: string
    markdown: string
    truncated: boolean
  }>
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 调用方取消必须原样抛出，不能被降级成"失败信封"。 */
function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('request aborted')
}

/** 无状态的 AnySearch 适配器：不缓存、不排队、不维护回合或材料索引。 */
export class WebRetriever {
  constructor(
    private readonly client: AnySearchClient,
    private readonly localFetch?: LocalFetcherLike,
  ) {}

  async search(query: string, maxResults?: number, signal?: AbortSignal): Promise<SearchResult> {
    const raw = await this.client.search({
      query,
      ...(maxResults === undefined ? {} : { max_results: maxResults }),
    }, signal)
    return normalizeSearchResponse(query, raw)
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    let trigger: FetchFallbackNote
    try {
      const raw = await this.client.extract({ url }, signal)
      const normalized = normalizeFetchResponse(url, raw)
      if (normalized.ok) {
        return {
          url,
          ok: true,
          via: 'anysearch',
          ...(normalized.title ? { title: normalized.title } : {}),
          ...(normalized.content ? { content: normalized.content } : {}),
          ...(normalized.truncated ? { truncated: true } : {}),
        }
      }
      // "取到了但没有内容"与失败等价，按可回退失败处理。
      trigger = {
        from: 'anysearch',
        code: 'UPSTREAM',
        error: normalized.error ?? 'fetch returned no content',
      }
    } catch (error) {
      // 调用方取消：原样抛出，不回退、不吞。
      if (error instanceof AnySearchError && error.code === 'ABORTED') throw error
      const code: AnySearchErrorCode = error instanceof AnySearchError ? error.code : 'UPSTREAM'
      const message = errorText(error)
      // 非法 URL / 不支持的二进制：本机同样会拒，回退只是白跑一次。
      if (!shouldFallbackToLocalFetch(code)) {
        return { url, ok: false, via: 'anysearch', code, error: message }
      }
      trigger = { from: 'anysearch', code, error: message }
    }

    // 回退前的取消闸门（硬）：调用方已经不要这个结果了，绝不再发一次网络请求。
    if (signal?.aborted) throw abortError(signal)
    if (!this.localFetch) {
      return { url, ok: false, via: 'anysearch', code: trigger.code, error: trigger.error }
    }

    try {
      const local = await this.localFetch.fetch(url, signal)
      return {
        url: local.url,
        ok: true,
        via: 'local-http',
        ...(local.title ? { title: local.title } : {}),
        content: local.markdown,
        ...(local.truncated ? { truncated: true } : {}),
        fallback: trigger,
      }
    } catch (error) {
      // 本地抓取侧的取消同样原样抛出。
      if (error instanceof LocalFetchError && error.code === 'ABORTED') throw error
      const localMessage = errorText(error)
      const localCode: LocalFetchErrorCode = error instanceof LocalFetchError ? error.code : 'HTTP'
      return {
        url,
        ok: false,
        via: 'anysearch',
        code: trigger.code,
        error: `AnySearch 失败：${trigger.error}；本地直抓也失败：${localMessage}`,
        fallback: trigger,
        local_error: { code: localCode, error: localMessage },
      }
    }
  }
}
