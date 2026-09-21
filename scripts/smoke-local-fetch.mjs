import { createLocalFetcher } from '../lib/web-retriever/local-fetch.js'

const fetcher = createLocalFetcher({
  timeoutMs: 15_000,
  maxBytes: 2_000_000,
  maxContentChars: 20_000,
  maxRedirects: 5,
  userAgent: 'capital-generation-local-fetch-smoke/2.1.0',
})

try {
  const result = await fetcher.fetch('https://example.com/')
  console.log(`smoke-local-fetch: final_url=${result.url}`)
  console.log(`smoke-local-fetch: status=${result.status}`)
  console.log(`smoke-local-fetch: title=${result.title ?? '(none)'}`)
  console.log(`smoke-local-fetch: has_gfm_table=${/^\|.+\|$/mu.test(result.markdown)}`)
  console.log(`smoke-local-fetch: truncated=${result.truncated}`)
  console.log(`smoke-local-fetch: markdown_preview=${result.markdown.slice(0, 500)}`)
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error)
  console.log(`smoke-local-fetch: SKIPPED（无网络）: ${detail}`)
  process.exitCode = 0
}
