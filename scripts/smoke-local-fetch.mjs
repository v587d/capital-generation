#!/usr/bin/env node
/**
 * Real-network smoke for the local fetch fallback (manual, not part of `npm test`).
 * These URLs are the regression corpus: pages AnySearch cannot read, where plain fetch succeeding
 * is enough. Any page failing is not a script failure — exit 0 unless the script itself crashes;
 * DNS-only failures print SKIPPED and also exit 0. URLs: argv, then the fixture file, then gov.cn.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createLocalFetcher,
  LOCAL_FETCH_CLIENT_VERSION,
  LocalFetchError,
} from '../lib/web-retriever/local-fetch.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FIXTURE = join(ROOT, 'scripts', 'local-fetch-fixture.txt')
const DEFAULT_URLS = ['https://www.gov.cn/']

function loadUrls() {
  const args = process.argv.slice(2).filter((value) => value && !value.startsWith('-'))
  if (args.length > 0) return { urls: args, source: 'argv' }
  try {
    const urls = readFileSync(FIXTURE, 'utf8')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
    if (urls.length > 0) return { urls, source: FIXTURE }
  } catch {
    // No fixture: fall back to the default URL.
  }
  return { urls: DEFAULT_URLS, source: 'default' }
}

const fetcher = createLocalFetcher({
  timeoutMs: 30_000,
  maxBytes: 524_288,
  maxContentChars: 100_000,
  maxRedirects: 5,
  userAgent: `capital-generation-local-fetch-smoke/${LOCAL_FETCH_CLIENT_VERSION}`,
})

const { urls, source } = loadUrls()
console.log(`smoke-local-fetch: URL 来源 = ${source}，共 ${urls.length} 条`)
console.log(`smoke-local-fetch: client version = ${LOCAL_FETCH_CLIENT_VERSION}`)
console.log('')

const rows = []
const failureCounts = new Map()
let readable = 0
let dnsFailures = 0

for (const [index, url] of urls.entries()) {
  const startedAt = Date.now()
  const label = `[${index + 1}/${urls.length}]`
  try {
    const result = await fetcher.fetch(url)
    const elapsed = Date.now() - startedAt
    const hasTable = /^\|.*\|$/mu.test(result.markdown)
    readable += 1
    rows.push({
      index: index + 1, url, result: 'OK', http: result.status,
      title: (result.title ?? '').slice(0, 60), chars: result.markdown.length,
      truncated: result.truncated, table: hasTable, ms: elapsed,
    })
    console.log(`${label} OK   ${url}`)
    console.log(`      final_url=${result.url}`)
    console.log(`      http=${result.status} chars=${result.markdown.length} truncated=${result.truncated} gfm_table=${hasTable} ms=${elapsed}`)
    console.log(`      title=${(result.title ?? '(none)').slice(0, 60)}`)
    console.log(`      preview=${result.markdown.slice(0, 200).replace(/\s+/gu, ' ')}`)
  } catch (error) {
    const elapsed = Date.now() - startedAt
    const code = error instanceof LocalFetchError ? error.code : 'UNEXPECTED'
    failureCounts.set(code, (failureCounts.get(code) ?? 0) + 1)
    if (code === 'DNS') dnsFailures += 1
    rows.push({
      index: index + 1, url, result: code, http: '-', title: '-',
      chars: 0, truncated: false, table: false, ms: elapsed,
    })
    console.log(`${label} ${code}   ${url}`)
    console.log(`      error=${error instanceof Error ? error.message : String(error)}`)
  }
  console.log('')
}

console.log('序号 | URL | 结果 | HTTP | title | 字符数 | 截断 | GFM表 | 耗时ms')
for (const row of rows) {
  console.log(`${row.index} | ${row.url} | ${row.result} | ${row.http} | ${row.title} | ${row.chars} | ${row.truncated} | ${row.table} | ${row.ms}`)
}
console.log('')

if (urls.length > 0 && readable === 0 && dnsFailures === urls.length) {
  console.log('smoke-local-fetch: SKIPPED（无网络）')
} else {
  console.log(`smoke-local-fetch: 可读 ${readable} / 共 ${urls.length}`)
  if (failureCounts.size > 0) {
    const distribution = [...failureCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, count]) => `${code}×${count}`)
      .join(', ')
    console.log(`smoke-local-fetch: 失败错误码分布 = ${distribution}`)
  }
}
