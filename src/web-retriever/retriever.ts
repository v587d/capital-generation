import {
  AnySearchError,
  normalizeFetchResponse,
  normalizeSearchResponse,
  shouldFallbackToLocalFetch,
} from './engines.js'
import type { AnySearchClient, AnySearchErrorCode, SearchResult } from './engines.js'
import { LocalFetchError } from './local-fetch.js'
import type { LocalFetchErrorCode } from './local-fetch.js'

/** Which path produced the body; always `'anysearch'` when `ok:false`. */
export type FetchVia = 'anysearch' | 'local-http'

/** The AnySearch failure that triggered fallback. */
export interface FetchFallbackNote {
  from: 'anysearch'
  code: AnySearchErrorCode
  error: string
}

/** Why local fetching failed; only when fallback ran and also failed. */
export interface FetchLocalErrorNote {
  code: LocalFetchErrorCode
  error: string
}

/** `web_retriever_fetch` receipt; `truncated` covers any truncation path. */
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

/** Structural fetcher; omitting it disables fallback (decided in `src/index.ts`). */
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

/** Caller cancellation must rethrow, never become a failure envelope. */
function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('request aborted')
}

/** Stateless AnySearch adapter: no cache, queue, turn or corpus index. */
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
      // "Fetched but empty" is equivalent to failure and is fallback-eligible.
      trigger = {
        from: 'anysearch',
        code: 'UPSTREAM',
        error: normalized.error ?? 'fetch returned no content',
      }
    } catch (error) {
      // Caller cancel: rethrow, no fallback.
      if (error instanceof AnySearchError && error.code === 'ABORTED') throw error
      const code: AnySearchErrorCode = error instanceof AnySearchError ? error.code : 'UPSTREAM'
      const message = errorText(error)
      // Invalid URL / unsupported content: local would reject too, fallback is wasted.
      if (!shouldFallbackToLocalFetch(code)) {
        return { url, ok: false, via: 'anysearch', code, error: message }
      }
      trigger = { from: 'anysearch', code, error: message }
    }

    // Hard cancel gate before fallback: never spend another request on an abandoned result.
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
      // Cancel raised on the local side also rethrows as-is.
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
