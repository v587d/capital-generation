/**
 * Sole construction point for AnySearch / Wind / local fetch / PaddleOCR / WebRetriever.
 * Search, source and OCR rows reuse it; copies would drift defaults, credential
 * resolution and OCR budgets. Registers no tools or services.
 */
import { createAnySearchClient, envKey } from './web-retriever/engines.js'
import { createHttpRequester, createLocalFetcher } from './web-retriever/local-fetch.js'
import { createWindClient, type WindClient } from './web-retriever/wind-client.js'
import { createPaddleOcrClient, type PaddleOcrClient } from './ocr/client.js'
import { WebRetriever, type LocalFetcherLike } from './web-retriever/retriever.js'
import {
  PADDLE_OCR_DEFAULTS,
  resolveLocalFetchConfig,
  type LocalFetchConfig,
  type RetrieverConfig,
} from './retriever-config.js'

interface CredentialContext {
  get(name: string): unknown
}

/** credentials first, env var fallback; resolve per call, never cache (boot-time races). */
export async function resolveRetrieverCredential(ctx: CredentialContext, ref: string): Promise<string | undefined> {
  try {
    const credentials = ctx.get('credentials') as {
      resolve?: (name: string) => Promise<{ value?: string } | undefined>
    } | undefined
    const resolved = await credentials?.resolve?.(ref)
    if (resolved?.value) return resolved.value
  } catch {
    // Fall back to the env var when the credentials service is unavailable.
  }
  return envKey(ref)
}

/** Wind ref + per-call resolver; `wind_docs` and `wind_*` market data share the key. */
export function createWindCredentialResolver(
  ctx: CredentialContext,
  credentialRef = 'WIND_API_KEY',
): { credentialRef: string; resolve: () => Promise<string | undefined> } {
  const ref = credentialRef || 'WIND_API_KEY'
  return { credentialRef: ref, resolve: () => resolveRetrieverCredential(ctx, ref) }
}

export interface RetrieverRuntime {
  retriever: WebRetriever
  windClient: WindClient
  ocrClient: PaddleOcrClient
  localFetchConfig: Required<LocalFetchConfig>
  resolveWindApiKey: () => Promise<string | undefined>
  /** Reference name only (for logs/diagnostics), never the secret. */
  windCredentialRef: string
  /** Present only when localFetch.enabled is true. */
  localFetch?: LocalFetcherLike
}

/**
 * `config` is the raw, unvalidated object from preset/settings, so every default must be
 * applied here rather than relying on Schemastery.
 */
export function createRetrieverRuntime(ctx: CredentialContext, config: RetrieverConfig = {}): RetrieverRuntime {
  const credentialRef = config.credentialRef || 'ANYSEARCH_API_KEY'
  const client = createAnySearchClient(
    config.baseURL || undefined,
    () => resolveRetrieverCredential(ctx, credentialRef),
  )

  const windDocs = config.windDocs ?? {}
  const windCredential = createWindCredentialResolver(ctx, windDocs.credentialRef)
  const windCredentialRef = windCredential.credentialRef
  const resolveWindApiKey = windCredential.resolve
  const windClient = createWindClient({
    endpoint: windDocs.endpoint || undefined,
    timeoutMs: windDocs.timeoutMs || undefined,
    resolveApiKey: resolveWindApiKey,
  })

  const localFetchConfig = resolveLocalFetchConfig(config.localFetch)
  const localFetch = localFetchConfig.enabled
    ? createLocalFetcher({
        timeoutMs: localFetchConfig.timeoutMs,
        maxBytes: localFetchConfig.maxBytes,
        maxContentChars: localFetchConfig.maxContentChars,
        maxRedirects: localFetchConfig.maxRedirects,
        userAgent: localFetchConfig.userAgent,
      })
    : undefined

  const paddleOcrConfig = config.paddleOcr ?? {}
  const paddleOcrCredentialRef = paddleOcrConfig.credentialRef || PADDLE_OCR_DEFAULTS.credentialRef
  const ocrClient = createPaddleOcrClient({
    endpoint: paddleOcrConfig.endpoint || undefined,
    model: paddleOcrConfig.model || undefined,
    ...(paddleOcrConfig.pollBudgetMs ? { waitBudgetMs: paddleOcrConfig.pollBudgetMs } : {}),
    resolveToken: () => resolveRetrieverCredential(ctx, paddleOcrCredentialRef),
    // Reuse the local-fetch requester (URL/IP gates, size and timeout caps). 120s because
    // PDF multipart upload and whole-document JSONL exceed the 30s web-page budget.
    request: createHttpRequester({
      timeoutMs: 120_000,
      maxBytes: 1_048_576,
      maxContentChars: 1_048_576,
      maxRedirects: localFetchConfig.maxRedirects,
      userAgent: localFetchConfig.userAgent,
    }).request,
  })

  return {
    retriever: new WebRetriever(client, localFetch),
    windClient,
    ocrClient,
    localFetchConfig,
    resolveWindApiKey,
    windCredentialRef,
    ...(localFetch === undefined ? {} : { localFetch }),
  }
}
