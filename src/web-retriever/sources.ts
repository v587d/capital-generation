/**
 * Named sources: source + business params -> ordered, pageable, reproducible rows.
 * Each stays a concrete implementation (no recipe registry); all egress goes
 * through `createHttpRequester` (SSRF/DNS/redirect/size guards, AGENTS.md §9.7).
 */

import { createHttpRequester, safeUrl } from './local-fetch.js'
import { stripInvisibleText } from './html-markdown.js'
import type { EastmoneyClient, EastmoneyTransport } from '../net/eastmoney-client.js'
import type { LocalFetchOptions } from './local-fetch.js'

/** Upstream name used in error envelopes and as the `provider_tally` key. */
export type SourceId = 'cls' | 'wscn' | 'cninfo_irm' | 'sseinfo' | 'eastmoney' | 'ths' | 'sina'

export const SOURCE_IDS: readonly SourceId[] = ['cls', 'wscn', 'cninfo_irm', 'sseinfo', 'eastmoney', 'ths', 'sina']

/** Per-item text cap; item count is capped separately by each tool's limit. */
export const MAX_ITEM_CHARS = 1200

/** Max items per output (must match the tool schema maximum). */
export const MAX_ITEMS = 50

export interface SourceItem {
  [key: string]: string | number | null
}

export interface SourceOutcome {
  source: SourceId
  operation: string
  items: SourceItem[]
  /** Upstream cursor for the next page; absent when there is none. */
  next_cursor?: string
  /** Record upstream scope / known gaps so an empty result is not read as fact. */
  note?: string
}

export class SourceError extends Error {
  constructor(
    readonly source: SourceId,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SourceError'
  }
}

const REQUEST_TIMEOUT_MS = 20_000

/** Named sources return API payloads, not web pages: the 100k-char HTML cap cuts a 50-item
 * CLS telegraph body (measured 106,106 chars) into invalid JSON. Size for JSON, not HTML. */
export const SOURCE_MAX_BYTES = 1_048_576
export const SOURCE_MAX_CHARS = 262_144

type Requester = ReturnType<typeof createHttpRequester>

/** No `@types/node` here, so hash via runtime `process.getBuiltinModule`. */
interface HashLike {
  update(data: string | Uint8Array): HashLike
  digest(encoding: 'hex'): string
}

function createHash(algorithm: string): HashLike | undefined {
  const processLike = (globalThis as {
    process?: { getBuiltinModule?: (id: string) => { createHash?: (name: string) => HashLike } }
  }).process
  return processLike?.getBuiltinModule?.('node:crypto')?.createHash?.(algorithm)
}

/** Built per source-tool call; lazy transport, configured timeout. */
export function createSourceTransport(options: LocalFetchOptions): Requester {
  return createHttpRequester({
    ...options,
    timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS,
    // Never lower the JSON ceiling to the HTML setting: a truncated body cannot be parsed.
    maxBytes: Math.max(options.maxBytes, SOURCE_MAX_BYTES),
    maxContentChars: Math.max(options.maxContentChars, SOURCE_MAX_CHARS),
  })
}

/**
 * Eastmoney shares the other sources' egress gate; throttling stays process-wide.
 * Coded `LocalFetchError`s pass through unwrapped so ABORTED is not downgraded.
 */
export function createGatedEastmoneyTransport(requester: Requester): EastmoneyTransport {
  return async (url, init) => {
    const outcome = await requester.request(
      { url, ...(init.headers === undefined ? {} : { headers: init.headers }) },
      init.signal,
    )
    return {
      status: outcome.status,
      text: async () => outcome.text,
      json: async () => JSON.parse(outcome.text) as unknown,
    }
  }
}

/** Link cap: a link is a reference, not the bulk of the output budget. */
const ITEM_URL_MAX_CHARS = 500

function clip(text: unknown): string {
  if (typeof text !== 'string') return ''
  // Same as fetched body: strip invisibles, then clip.
  const trimmed = stripInvisibleText(text).trim()
  return trimmed.length > MAX_ITEM_CHARS ? `${trimmed.slice(0, MAX_ITEM_CHARS)}…` : trimmed
}

/** Drop the field (not the item) for non-http(s), control chars, credentials or length. */
function itemUrl(value: unknown): string {
  return safeUrl(value, ITEM_URL_MAX_CHARS)
}

// Decode entities before stripping tags, then strip until stable: the reverse order
// turns escaped `<system>` text into live tags (prompt injection surface).
function stripHtml(fragment: string): string {
  let text = stripInvisibleText(fragment)
    .replace(/&nbsp;/gu, ' ')
    .replace(/&#39;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
  for (let round = 0; round < 3; round += 1) {
    const stripped = text
      .replace(/<br\s*\/?>/giu, '\n')
      .replace(/<\/p>/giu, '\n')
      .replace(/<[^>]+>/gu, '')
    if (stripped === text) break
    text = stripped
  }
  return text
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function cstStamp(seconds: number): string {
  const date = new Date(seconds * 1000 + 8 * 3600 * 1000)
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} CST`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseJson(text: string, source: SourceId, what: string, truncated = false): unknown {
  // A truncated body always fails JSON.parse with a syntax error; name the real cause instead.
  if (truncated) {
    throw new SourceError(source, 'INVALID_RESPONSE', `${what} 超过本机响应体上限被截断，无法解析；请降低 limit 或缩小查询范围`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new SourceError(source, 'INVALID_RESPONSE', `${what} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
}

function requireRows(value: unknown, source: SourceId, what: string): unknown[] {
  if (!Array.isArray(value)) throw new SourceError(source, 'INVALID_RESPONSE', `${what} 不是数组（上游结构可能已变）`)
  return value
}

function clipItems<T>(items: T[]): T[] {
  return items.length > MAX_ITEMS ? items.slice(0, MAX_ITEMS) : items
}

/** Upstream numbers may be strings (precision); parse by value, unknown => null. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const CLS_URL = 'https://www.cls.cn/v1/roll/get_roll_list'
const CLS_REFERER = 'https://www.cls.cn/'

/** Local sign `md5(sha1(query sorted by key))`; no API key, so the model passes params, never URLs. */
export function clsSign(params: Record<string, string>): string {
  const query = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&')
  const sha1 = createHash('sha1')
  const md5 = createHash('md5')
  if (sha1 === undefined || md5 === undefined) {
    throw new SourceError('cls', 'UPSTREAM', '运行时缺少 node:crypto，无法计算财联社签名')
  }
  return md5.update(sha1.update(query).digest('hex')).digest('hex')
}

export async function clsTelegraph(
  transport: Requester,
  input: { limit: number; signal?: AbortSignal },
): Promise<SourceOutcome> {
  const params: Record<string, string> = {
    appName: 'CailianpressWeb',
    os: 'web',
    sv: '7.7.5',
    last_time: '',
    refresh_type: '1',
    rn: String(input.limit),
  }
  const query = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&')
  const outcome = await transport.request(
    { url: `${CLS_URL}?${query}&sign=${clsSign(params)}`, headers: { referer: CLS_REFERER } },
    input.signal,
  )
  const body = asRecord(parseJson(outcome.text, 'cls', '财联社响应', outcome.truncated))
  if (!body) throw new SourceError('cls', 'INVALID_RESPONSE', '财联社响应不是对象')
  if (body.errno !== 0) {
    throw new SourceError('cls', 'UPSTREAM', `财联社返回 errno=${String(body.errno)}（上游口径变更或风控）`)
  }
  const data = asRecord(body.data)
  const rows = requireRows(data?.roll_data, 'cls', '财联社 data.roll_data')
  const items: SourceItem[] = []
  for (const raw of rows) {
    const row = asRecord(raw)
    if (!row) continue
    // Promos/ads are not telegraphs; keep them out of evidence.
    if (row.in_roll === false || row.is_ad === true) continue
    const ctime = typeof row.ctime === 'number' ? row.ctime : undefined
    if (ctime === undefined) throw new SourceError('cls', 'INVALID_RESPONSE', '财联社条目缺 ctime（时间认不出时宁可失败，不给空时间列）')
    const brief = typeof row.brief === 'string' ? row.brief : ''
    const title = typeof row.title === 'string' && row.title.trim() !== '' ? row.title : brief
    items.push({
      id: typeof row.id === 'number' || typeof row.id === 'string' ? row.id : null,
      time: cstStamp(ctime),
      title: clip(title),
      content: clip(typeof row.content === 'string' && row.content.trim() !== '' ? row.content : brief),
      url: itemUrl(row.shareurl),
    })
  }
  return {
    source: 'cls',
    operation: 'telegraph',
    items: clipItems(items),
    ...(items.length > MAX_ITEMS ? { note: `已截断为前 ${MAX_ITEMS} 条` } : {}),
  }
}

const WSCN_URL = 'https://api-one-wscn.awtmt.com/apiv1/content/lives'

export async function wscnLives(
  transport: Requester,
  input: { channel: string; limit: number; cursor?: string; signal?: AbortSignal },
): Promise<SourceOutcome> {
  const params = new URLSearchParams({ channel: input.channel, limit: String(input.limit) })
  if (input.cursor !== undefined) params.set('cursor', input.cursor)
  const outcome = await transport.request(
    { url: `${WSCN_URL}?${params.toString()}` },
    input.signal,
  )
  const body = asRecord(parseJson(outcome.text, 'wscn', '华尔街见闻响应', outcome.truncated))
  if (!body) throw new SourceError('wscn', 'INVALID_RESPONSE', '华尔街见闻响应不是对象')
  if (body.code !== 20000) {
    throw new SourceError('wscn', 'UPSTREAM', `华尔街见闻返回 code=${String(body.code)}`)
  }
  const data = asRecord(body.data)
  const rows = requireRows(data?.items, 'wscn', '华尔街见闻 data.items')
  const items: SourceItem[] = []
  for (const raw of rows) {
    const row = asRecord(raw)
    if (!row) continue
    const stamp = row.display_time
    if (typeof stamp !== 'number' || !Number.isFinite(stamp)) {
      throw new SourceError('wscn', 'INVALID_RESPONSE', '华尔街见闻条目 display_time 不是数字')
    }
    items.push({
      id: typeof row.id === 'number' || typeof row.id === 'string' ? row.id : null,
      time: cstStamp(stamp),
      title: clip(row.title),
      content: clip(row.content_text),
      // score is wscn's importance (observed 1-3, higher = more important).
      importance: typeof row.score === 'number' ? row.score : null,
      url: itemUrl(row.uri) || (typeof row.id === 'number' ? `https://wallstreetcn.com/livenews/${row.id}` : ''),
    })
  }
  const next = data?.next_cursor
  return {
    source: 'wscn',
    operation: 'lives',
    items: clipItems(items),
    ...(typeof next === 'string' || typeof next === 'number' ? { next_cursor: String(next) } : {}),
  }
}

const IRM_KEYWORD_URL = 'https://irm.cninfo.com.cn/newircs/index/queryKeyboardInfo'
const IRM_QUESTION_URL = 'https://irm.cninfo.com.cn/newircs/company/question'

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString()
}

/**
 * Two steps: `keyWord=code` -> `secid` (orgId) -> questions; step two must be POST
 * (GET on the same URL returns 405). Shenzhen only; SSE questions via `sseinfo_qa`.
 */
export async function cninfoIrm(
  transport: Requester,
  input: { code: string; pageSize: number; pageNum: number; signal?: AbortSignal },
): Promise<SourceOutcome> {
  const keyword = await transport.request(
    { url: IRM_KEYWORD_URL, method: 'POST', body: formBody({ keyWord: input.code }) },
    input.signal,
  )
  const keywordBody = asRecord(parseJson(keyword.text, 'cninfo_irm', '互动易代码查询响应', keyword.truncated))
  const matches = Array.isArray(keywordBody?.data) ? keywordBody.data : []
  const first = asRecord(matches[0])
  const orgId = typeof first?.secid === 'string' ? first.secid : undefined
  if (orgId === undefined) {
    throw new SourceError('cninfo_irm', 'NOT_FOUND', `互动易查不到 ${input.code}（该代码不在深市，或代码有误）`)
  }
  const params = new URLSearchParams({
    _t: '1',
    stockcode: input.code,
    orgId,
    pageSize: String(input.pageSize),
    pageNum: String(input.pageNum),
    keyWord: '',
    startDay: '',
    endDay: '',
  })
  const page = await transport.request(
    { url: `${IRM_QUESTION_URL}?${params.toString()}`, method: 'POST', body: '' },
    input.signal,
  )
  const pageBody = asRecord(parseJson(page.text, 'cninfo_irm', '互动易问答响应', page.truncated))
  const rows = requireRows(pageBody?.rows, 'cninfo_irm', '互动易 rows')
  const total = typeof pageBody?.total === 'number' ? pageBody.total : undefined
  const items: SourceItem[] = []
  for (const raw of rows) {
    const row = asRecord(raw)
    if (!row) continue
    const stamp = row.pubDate
    if (typeof stamp !== 'number' || !Number.isFinite(stamp)) {
      throw new SourceError('cninfo_irm', 'INVALID_RESPONSE', '互动易条目 pubDate 不是毫秒时间戳')
    }
    const answer = typeof row.attachedContent === 'string' ? clip(row.attachedContent) : ''
    const question = clip(row.mainContent)
    items.push({
      code: typeof row.stockCode === 'string' ? row.stockCode : input.code,
      company: typeof row.companyShortName === 'string' ? row.companyShortName : '',
      question,
      answer,
      // Empty answer and "not answered yet" are different facts.
      status: answer === '' ? 'unanswered' : 'answered',
      answerer: typeof row.attachedAuthor === 'string' ? row.attachedAuthor : '',
      time: cstStamp(stamp / 1000),
    })
  }
  return {
    source: 'cninfo_irm',
    operation: 'questions',
    items: clipItems(items),
    note: `深市专用：互动易对沪市公司返回 0 条，沪市问答请用 sseinfo_qa${total === undefined ? '' : `；公司累计问答 ${total} 条`}`,
  }
}

const SSE_BASE = 'https://sns.sseinfo.com'
const SSE_REFERER = `${SSE_BASE}/`
const SSE_KIND: Record<string, number> = { answered: 11, questions: 10 }
/** Fixed sentence returned past the last company-list page. */
const SSE_COMPANY_END = '没有任何上市公司的信息'
const SSE_EMPTY_NOTE = /class="m_feed_note"[^>]*>[^<]*(暂无|暂时没有)[^<]*</u

/**
 * Company list page: 32 companies, ascending by code. uid and code come from the same
 * `<a>` element, so cross-item mispairing is structurally impossible (a windowed regex
 * either misses rows or pairs across them).
 */
export function parseCompanyList(content: string): Array<{ code: string; uid: string }> {
  const pairs: Array<{ code: string; uid: string }> = []
  for (const match of content.matchAll(/<a\b(?:(?!<\/a>)[\s\S])*?<\/a>/gu)) {
    const element = match[0]
    const uid = /uid=['"]?(\d+)['"]?/u.exec(element)
    const code = /company\/(\d{6})\.png/u.exec(element)
    if (uid !== null && code !== null) pairs.push({ uid: uid[1], code: code[1] })
  }
  return pairs.sort((left, right) => left.code.localeCompare(right.code))
}

// Code -> uid via doubling + binary search over the ascending list; the caches hold
// page metadata only (no content) and stay size-capped.
const SSE_UID_CACHE_LIMIT = 200
const sseUidCache = new Map<string, string>()
const ssePageCache = new Map<number, Array<{ code: string; uid: string }>>()

export function resetSseCachesForTest(): void {
  sseUidCache.clear()
  ssePageCache.clear()
}

async function sseCompanyPage(transport: Requester, page: number, signal?: AbortSignal) {
  const cached = ssePageCache.get(page)
  if (cached !== undefined) return cached
  const outcome = await transport.request(
    { url: `${SSE_BASE}/allcompany.do`, method: 'POST', body: formBody({ code: '0', order: '2', areaId: '0', page: String(page) }), headers: { referer: SSE_REFERER } },
    signal,
  )
  const body = asRecord(parseJson(outcome.text, 'sseinfo', '上证e互动公司列表响应', outcome.truncated))
  const content = typeof body?.content === 'string' ? body.content : undefined
  if (content === undefined) {
    throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动公司列表第 ${page} 页没有 content 字符串（页面结构可能已变）`)
  }
  const pairs = parseCompanyList(content)
  if (pairs.length === 0 && page === 1) {
    throw new SourceError('sseinfo', 'INVALID_RESPONSE', '上证e互动公司列表第 1 页解析出 0 家公司（页面格式可能已变）')
  }
  if (pairs.length === 0 && !content.includes(SSE_COMPANY_END)) {
    throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动公司列表第 ${page} 页既没有公司也没有末页提示（页面格式可能已变）`)
  }
  // Verify ordering before binary search: parseCompanyList sorts, so this catches
  // duplicate codes (mispairing); fail loudly rather than locate the wrong uid.
  assertAscending(pairs, page)
  if (ssePageCache.size >= SSE_UID_CACHE_LIMIT) {
    // Evict only the oldest entry: clearing all would drop the uid just resolved.
    const oldest = ssePageCache.keys().next().value
    if (oldest !== undefined) ssePageCache.delete(oldest)
  }
  ssePageCache.set(page, pairs)
  return pairs
}

function assertAscending(pairs: Array<{ code: string; uid: string }>, page: number): void {
  for (let index = 1; index < pairs.length; index += 1) {
    if (pairs[index - 1].code >= pairs[index].code) {
      throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动公司列表第 ${page} 页不是按代码升序（配对可能错位，拒绝据此定位 uid）`)
    }
  }
}

/**
 * One uid lookup = 10-13 serial requests, so no per-request timeout can bound it;
 * `uidLocateBudgetMs` exists only so tests can shorten this.
 */
export const SSE_UID_LOCATE_TIMEOUT_MS = 60_000

interface Deadline {
  signal: AbortSignal
  /** Only a fired timer counts as exceeded; caller aborts must rethrow as-is. */
  exceeded: () => boolean
  dispose: () => void
}

/** Total deadline for a chain of serial requests, combined with caller cancel. */
function startDeadline(outer: AbortSignal | undefined, budgetMs: number): Deadline {
  const controller = new AbortController()
  let fired = false
  const timer = setTimeout(() => {
    fired = true
    controller.abort(new Error(`deadline after ${budgetMs}ms`))
  }, budgetMs)
  const onOuterAbort = () => controller.abort(outer?.reason)
  if (outer) {
    if (outer.aborted) onOuterAbort()
    else outer.addEventListener('abort', onOuterAbort, { once: true })
  }
  return {
    signal: controller.signal,
    exceeded: () => fired && outer?.aborted !== true,
    dispose: () => {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onOuterAbort)
    },
  }
}

/**
 * Cache layering: pages feed the binary search, the uid cache holds only the resolved
 * code — caching scanned pages there would evict it and turn success into NOT_FOUND.
 */
export async function resolveSseCompanyUid(transport: Requester, code: string, signal?: AbortSignal): Promise<string> {
  const cached = sseUidCache.get(code)
  if (cached !== undefined) return cached

  let high = 1
  // Doubling phase: first page whose last code >= target, or an empty page.
  for (let guard = 0; guard < 16; guard += 1) {
    const pairs = await sseCompanyPage(transport, high, signal)
    if (pairs.length === 0 || pairs[pairs.length - 1].code >= code) break
    high *= 2
  }
  let low = 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const pairs = await sseCompanyPage(transport, mid, signal)
    if (pairs.length === 0 || code < pairs[0].code) {
      high = mid - 1
      continue
    }
    if (code > pairs[pairs.length - 1].code) {
      low = mid + 1
      continue
    }
    const hit = pairs.find((pair) => pair.code === code)
    if (hit !== undefined) {
      if (sseUidCache.size >= SSE_UID_CACHE_LIMIT) {
        const oldest = sseUidCache.keys().next().value
        if (oldest !== undefined) sseUidCache.delete(oldest)
      }
      sseUidCache.set(code, hit.uid)
      return hit.uid
    }
    break
  }
  throw new SourceError('sseinfo', 'NOT_FOUND', `上证e互动没有 ${code}（该公司不在上交所，或已退市）`)
}

/** Split Q/A on the reply block class; per-item id markers differ between the two list kinds. */
export function parseSseFeed(text: string): SourceItem[] {
  const items: SourceItem[] = []
  const chunks = text.split(/<div class="m_feed_item[^"]*" id="item-/u).slice(1)
  for (const chunk of chunks) {
    const numbered = /^(\d+)/u.exec(chunk)
    if (!numbered) {
      throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动条目 id 不是数字（页面结构可能已变）：${chunk.slice(0, 60)}`)
    }
    const itemId = numbered[1]
    const [askPart, answerPart = ''] = chunk.split('class="m_feed_detail m_qa"')
    const question = /<div class="m_feed_txt"[^>]*>\s*<a[^>]*>:(.*?)\((\d{6})\)<\/a>(.*?)<\/div>/su.exec(askPart)
    const askTime = /<div class="m_feed_from"[^>]*>\s*<span>([^<]+)<\/span>/u.exec(askPart)
    if (!question || !askTime) {
      throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动第 ${itemId} 条结构改变，无法解析问题或时间`)
    }
    let answer = ''
    let answerTime = ''
    if (answerPart !== '') {
      const body = /<div class="m_feed_txt"[^>]*>(.*?)<\/div>/su.exec(answerPart)
      const when = /<div class="m_feed_from"[^>]*>\s*<span>([^<]+)<\/span>/u.exec(answerPart)
      if (!body || !when) {
        throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动第 ${itemId} 条有回复块但解析不出回复内容或时间`)
      }
      answer = clip(stripHtml(body[1]))
      answerTime = sseTime(when[1]) ?? ''
      if (answerTime === '') {
        throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动第 ${itemId} 条的回复时间认不出：${when[1]}`)
      }
    }
    const questionTime = sseTime(askTime[1])
    if (questionTime === undefined) {
      throw new SourceError('sseinfo', 'INVALID_RESPONSE', `上证e互动第 ${itemId} 条的提问时间认不出：${askTime[1]}`)
    }
    items.push({
      id: itemId,
      code: question[2],
      question: clip(stripHtml(question[3])),
      answer,
      status: answer === '' ? 'unanswered' : 'answered',
      time: questionTime,
      answer_time: answerTime,
    })
  }
  return items
}

const BEIJING_OFFSET_MS = 8 * 3600 * 1000
const ONE_DAY_MS = 86_400_000
const SSE_DAY_WORD_DAYS: Record<string, number> = { 今天: 0, 昨天: 1, 前天: 2 }
const SSE_ELAPSED_MS: Record<string, number> = { 秒: 1_000, 分钟: 60_000, 小时: 3_600_000, 天: ONE_DAY_MS }

/** Beijing wall clock carried in UTC fields, so UTC getters read as Beijing local time. */
function beijingClock(now: Date): Date {
  return new Date(now.getTime() + BEIJING_OFFSET_MS)
}

function beijingStamp(at: Date): string {
  return new Date(at.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** "HH:MM" from numeric fields; undefined means the label is not a real clock time. */
function clockText(hour: number, minute: number): string | undefined {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? `${pad2(hour)}:${pad2(minute)}` : undefined
}

function realDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= (lengths[month - 1] ?? 0)
}

/**
 * Normalize a feed label to Beijing "YYYY-MM-DD HH:MM"; unknown shapes return undefined so
 * the caller fails the page instead of carrying a blank column. The site mixes absolute
 * question times with relative reply times ("昨天 18:22"): every form must parse or one row
 * fails the page. Relative forms use Beijing wall clock, never host local time.
 */
export function sseTime(text: string, now: Date = new Date()): string | undefined {
  const label = text.trim()
  const absolute = /(\d{4})\s*[年\-/]\s*(\d{1,2})\s*[月\-/]\s*(\d{1,2})\s*日?\s*(\d{1,2}):(\d{2})/u.exec(label)
  if (absolute !== null) {
    const [year, month, day] = [Number(absolute[1]), Number(absolute[2]), Number(absolute[3])]
    const time = clockText(Number(absolute[4]), Number(absolute[5]))
    return time === undefined || !realDate(year, month, day)
      ? undefined
      : `${absolute[1]}-${pad2(month)}-${pad2(day)} ${time}`
  }
  const wall = beijingClock(now)
  const dayWord = /^(今天|昨天|前天)\s*(\d{1,2}):(\d{2})$/u.exec(label)
  if (dayWord !== null) {
    const time = clockText(Number(dayWord[2]), Number(dayWord[3]))
    if (time === undefined) return undefined
    wall.setUTCDate(wall.getUTCDate() - SSE_DAY_WORD_DAYS[dayWord[1]])
    return `${wall.toISOString().slice(0, 10)} ${time}`
  }
  // Month-day without a year: more than a day ahead means last year ("12-31" seen in January).
  const monthDay = /^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/u.exec(label)
  if (monthDay !== null) {
    const [month, day] = [Number(monthDay[1]), Number(monthDay[2])]
    const time = clockText(Number(monthDay[3]), Number(monthDay[4]))
    if (time === undefined || !realDate(wall.getUTCFullYear(), month, day)) return undefined
    let year = wall.getUTCFullYear()
    const candidate = Date.UTC(year, month - 1, day, Number(monthDay[3]), Number(monthDay[4]))
    if (candidate - wall.getTime() > ONE_DAY_MS) {
      if (!realDate(year - 1, month, day)) return undefined
      year -= 1
    }
    return `${String(year)}-${pad2(month)}-${pad2(day)} ${time}`
  }
  const elapsed = /^(\d+)\s*(秒|分钟|小时|天)前$/u.exec(label)
  if (elapsed !== null) {
    const when = new Date(now.getTime() - Number(elapsed[1]) * SSE_ELAPSED_MS[elapsed[2]])
    return Number.isNaN(when.getTime()) ? undefined : beijingStamp(when)
  }
  // 「刚刚」has no minute precision: use the current minute; otherwise fail (no guessing).
  if (label === '刚刚' || label === '刚才') return beijingStamp(now)
  // Clock only means today in Beijing.
  const clockOnly = /^(\d{1,2}):(\d{2})$/u.exec(label)
  if (clockOnly !== null) {
    const time = clockText(Number(clockOnly[1]), Number(clockOnly[2]))
    return time === undefined ? undefined : `${wall.toISOString().slice(0, 10)} ${time}`
  }
  return undefined
}

export async function sseinfoQa(
  transport: Requester,
  input: { code?: string; kind: string; page: number; pageSize: number; signal?: AbortSignal; uidLocateBudgetMs?: number },
): Promise<SourceOutcome> {
  const type = SSE_KIND[input.kind]
  let text: string
  if (input.code === undefined) {
    const params = new URLSearchParams({
      type: String(type),
      pageSize: String(input.pageSize),
      lastid: '-1',
      show: '1',
      page: String(input.page),
    })
    const outcome = await transport.request({ url: `${SSE_BASE}/ajax/feeds.do?${params.toString()}`, headers: { referer: SSE_REFERER } }, input.signal)
    text = outcome.text
  } else {
    const budgetMs = input.uidLocateBudgetMs ?? SSE_UID_LOCATE_TIMEOUT_MS
    const deadline = startDeadline(input.signal, budgetMs)
    let uid: string
    try {
      uid = await resolveSseCompanyUid(transport, input.code, deadline.signal)
    } catch (error) {
      // Deadline expiry means upstream is slow, not that the caller cancelled:
      // map it to TIMEOUT or the tool layer reports ABORTED.
      if (deadline.exceeded()) {
        throw new SourceError('sseinfo', 'TIMEOUT', `上证e互动公司 uid 定位超过 ${Math.round(budgetMs / 1000)}s（一次定位需 10–13 个串行请求）；稍后重试，或先用不带 code 的 sseinfo_qa 取全市场问答`)
      }
      throw error
    } finally {
      deadline.dispose()
    }
    const params = new URLSearchParams({
      typeCode: 'company',
      type: String(type),
      pageSize: String(input.pageSize),
      uid,
      page: String(input.page),
    })
    const outcome = await transport.request(
      { url: `${SSE_BASE}/ajax/userfeeds.do?${params.toString()}`, method: 'POST', body: '', headers: { referer: SSE_REFERER } },
      input.signal,
    )
    text = outcome.text
  }
  const parsed = parseSseFeed(text)
  // Zero rows plus no 「暂无」 note means the page structure changed.
  if (parsed.length === 0 && !SSE_EMPTY_NOTE.test(text)) {
    throw new SourceError('sseinfo', 'INVALID_RESPONSE', '上证e互动页面既没有问答也没有「暂无」提示（结构可能已变）')
  }
  const notes: string[] = []
  let items = parsed
  if (input.code !== undefined) {
    // Upstream drift (a page can carry rows for other codes): drop + note, don't fail the call.
    const foreign = parsed.filter((item) => item.code !== input.code)
    items = parsed.filter((item) => item.code === input.code)
    if (foreign.length > 0) {
      notes.push(`已丢弃 ${foreign.length} 条非 ${input.code} 的问答（上游返回了 ${[...new Set(foreign.map((item) => String(item.code)))].join('/')}，疑似上游数据漂移）`)
    }
    if (items.length === 0 && foreign.length > 0) {
      throw new SourceError('sseinfo', 'INVALID_RESPONSE', `${input.code} 本次返回的问答全部属于其他公司（上游数据漂移），已全部丢弃且无可用条目`)
    }
    notes.push('平台只开放近期问答（公司维度实测约近 1 个月）；北交所公司两个平台都没有')
  }
  return {
    source: 'sseinfo',
    operation: input.code === undefined ? `market_${input.kind}` : `company_${input.kind}`,
    items: clipItems(items),
    ...(notes.length > 0 ? { note: notes.join('；') } : {}),
  }
}

const EM_724_URL = 'https://np-weblist.eastmoney.com/comm/web/getFastNewsList'
const EM_REFERER = 'https://kuaixun.eastmoney.com/'

/**
 * Independent CLS/WSCN backup; success `code` is the string "1". The server aggregates
 * CLS content, so title dedupe is the caller's job.
 */
export async function eastmoneyFastNews(
  client: EastmoneyClient,
  input: { limit: number; signal?: AbortSignal },
): Promise<SourceOutcome> {
  const params = new URLSearchParams({
    client: 'web',
    biz: 'web_724',
    fastColumn: '102',
    sortEnd: '',
    pageSize: String(input.limit),
    req_trace: emTraceId(),
  })
  const outcome = await client.fetchText(`${EM_724_URL}?${params.toString()}`, {
    headers: { referer: EM_REFERER },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  const body = asRecord(parseJson(outcome.text, 'eastmoney', '东财 7×24 响应'))
  const data = asRecord(body?.data)
  if (String(body?.code ?? '') !== '1') {
    throw new SourceError('eastmoney', 'UPSTREAM', `东财 7×24 返回 code=${String(body?.code)}（上游口径变更或风控）`)
  }
  const rows = requireRows(data?.fastNewsList, 'eastmoney', '东财 7×24 data.fastNewsList')
  const items: SourceItem[] = []
  for (const raw of rows) {
    const row = asRecord(raw)
    if (!row) continue
    items.push({
      time: clip(row.showTime),
      title: clip(row.title),
      content: clip(row.summary),
      url: itemUrl(row.url),
    })
  }
  return { source: 'eastmoney', operation: 'fast_news', items: clipItems(items) }
}

/** Random string eastmoney asks for; absence would not break correctness. */
function emTraceId(): string {
  return `${Date.now().toString(16)}-${Math.floor(Math.random() * 1e16).toString(16)}`
}

const EM_STOCK_NEWS_URL = 'https://search-api-web.eastmoney.com/search/jsonp'
const EM_SO_REFERER = 'https://so.eastmoney.com/'

/**
 * A missing `cmsArticleWebOld` key is intermittent upstream throttling, not "no news"
 * (which is a present-but-empty array); report UPSTREAM on the missing key.
 */
export async function eastmoneyStockNews(
  client: EastmoneyClient,
  input: { code: string; limit: number; signal?: AbortSignal },
): Promise<SourceOutcome> {
  const inner = JSON.stringify({
    uid: '',
    keyword: input.code,
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: input.limit, preTag: '', postTag: '' } },
  })
  const params = new URLSearchParams({ cb: 'jQuery_news', param: inner })
  const outcome = await client.fetchText(`${EM_STOCK_NEWS_URL}?${params.toString()}`, {
    headers: { referer: EM_SO_REFERER },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  const open = outcome.text.indexOf('(')
  const close = outcome.text.lastIndexOf(')')
  if (open < 0 || close <= open) {
    throw new SourceError('eastmoney', 'INVALID_RESPONSE', '东财个股新闻不是 JSONP 形态（上游结构可能已变）')
  }
  const body = asRecord(parseJson(outcome.text.slice(open + 1, close), 'eastmoney', '东财个股新闻响应'))
  const result = asRecord(body?.result)
  const articles = result?.cmsArticleWebOld
  if (!Array.isArray(articles)) {
    throw new SourceError(
      'eastmoney',
      'UPSTREAM',
      `东财个股新闻未返回文章列表（result 键：${Object.keys(result ?? {}).join('/') || '无'}）——通常是上游对该 IP 的间歇风控，隔几分钟或换网络再试，别当成"该股没有新闻"`,
    )
  }
  const items: SourceItem[] = []
  for (const raw of articles) {
    const row = asRecord(raw)
    if (!row) continue
    items.push({
      time: clip(row.date),
      title: clip(stripHtml(typeof row.title === 'string' ? row.title : '')),
      content: clip(stripHtml(typeof row.content === 'string' ? row.content : '')),
      media: clip(row.mediaName),
      url: itemUrl(row.url),
    })
  }
  return { source: 'eastmoney', operation: 'stock_news', items: clipItems(items) }
}

const EM_REPORT_URL = 'https://reportapi.eastmoney.com/report/list'
const EM_DATA_REFERER = 'https://data.eastmoney.com/'
const EM_PDF_BASE = 'https://pdf.dfcfw.com/pdf/'

// PDF link = `H3_<infoCode>_1.pdf`; an unknown shape means no link — a fabricated one
// could point at someone else's document.
function emReportPdfUrl(infoCode: unknown): string | undefined {
  return typeof infoCode === 'string' && /^AP\d{6,}$/u.test(infoCode) ? `${EM_PDF_BASE}H3_${infoCode}_1.pdf` : undefined
}

/**
 * No abstract in the list; the per-item PDF link is the only path to the text (via `ocr`).
 * Only bare 6-digit codes work (a prefixed code returns hits=0); EPS fields are strings.
 */
export async function eastmoneyReports(
  client: EastmoneyClient,
  input: { code: string; pageSize: number; pageNo: number; signal?: AbortSignal },
): Promise<SourceOutcome> {
  const params = new URLSearchParams({
    industryCode: '*',
    pageSize: String(input.pageSize),
    industry: '*',
    rating: '*',
    ratingChange: '*',
    beginTime: '2000-01-01',
    endTime: '2030-01-01',
    pageNo: String(input.pageNo),
    fields: '',
    qType: '0',
    orgCode: '',
    code: input.code,
    rcode: '',
    p: String(input.pageNo),
    pageNum: String(input.pageNo),
    pageNumber: String(input.pageNo),
  })
  const outcome = await client.fetchText(`${EM_REPORT_URL}?${params.toString()}`, {
    headers: { referer: EM_DATA_REFERER },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  const body = asRecord(parseJson(outcome.text, 'eastmoney', '东财研报响应'))
  const rows = Array.isArray(body?.data) ? body.data : []
  const totalPage = typeof body?.TotalPage === 'number' ? body.TotalPage : 1
  const hits = typeof body?.hits === 'number' ? body.hits : rows.length
  const items: SourceItem[] = []
  for (const raw of rows) {
    const row = asRecord(raw)
    if (!row) continue
    const pdfUrl = emReportPdfUrl(row.infoCode)
    items.push({
      date: typeof row.publishDate === 'string' ? row.publishDate.slice(0, 10) : '',
      title: clip(row.title),
      org: clip(row.orgSName),
      researcher: clip(row.researcher),
      rating: clip(row.emRatingName),
      rating_change: typeof row.ratingChange === 'number' ? row.ratingChange : null,
      eps_this_year: toNumber(row.predictThisYearEps),
      eps_next_year: toNumber(row.predictNextYearEps),
      info_code: clip(row.infoCode),
      ...(pdfUrl === undefined ? {} : { pdf_url: pdfUrl }),
      attach_pages: typeof row.attachPages === 'number' && Number.isFinite(row.attachPages) ? row.attachPages : null,
    })
  }
  return {
    source: 'eastmoney',
    operation: 'reports',
    items: clipItems(items),
    ...(totalPage > input.pageNo ? { next_cursor: String(input.pageNo + 1) } : {}),
    note: `东财研报库共 ${hits} 篇；列表不含摘要，正文在各条的 pdf_url（研报 PDF）里，交 ocr 解析（整篇一次算完）`,
  }
}


const EM_ANNOUNCEMENT_LIST_URL = 'https://np-anotice-stock.eastmoney.com/api/security/ann'
const EM_ANNOUNCEMENT_BODY_URL = 'https://np-cnotice-stock.eastmoney.com/api/content/ann'
const EM_ANNOUNCEMENT_REFERER = 'https://data.eastmoney.com/'
const EM_ANNOUNCEMENT_PAGE_SIZE = 100

/** Scan cap: a 7-day watchlist window rarely needs more; the note must say when it is hit. */
const EM_ANNOUNCEMENT_MAX_SCAN_PAGES = 5

export type AnnouncementMarket = 'A' | 'H' | 'U'

export interface NormalizedAnnouncementCode {
  code: string
  market: AnnouncementMarket
}

/**
 * Accept the forms users actually paste (`600519.SH` / `SH600519` / `0700.HK` / `AAPL.O`).
 * The market is inferred only from an unambiguous shape; a mixed list is rejected rather
 * than silently sent to one `ann_type`.
 */
export function normalizeAnnouncementCode(value: unknown, market: AnnouncementMarket | 'auto' = 'auto'): NormalizedAnnouncementCode {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (raw.length === 0) throw new Error('announcement code is required')
  if (raw.length > 32) throw new Error(`announcement code is too long: ${raw.slice(0, 32)}…`)
  const suffix = /\.(SH|SZ|BJ|HK|O|N|US)$/u.exec(raw)?.[1]
  let body = suffix === undefined ? raw : raw.slice(0, -(suffix.length + 1))
  const prefix = /^(SH|SZ|BJ|HK)(?=\d)/u.exec(body)?.[1]
  if (prefix !== undefined) body = body.slice(prefix.length)
  if (body.length === 0) throw new Error(`announcement code is empty after removing prefix/suffix: ${raw}`)
  const suffixMarket: AnnouncementMarket | undefined = suffix === undefined && prefix === undefined
    ? undefined
    : suffix === 'HK' || prefix === 'HK' ? 'H'
      : suffix === 'O' || suffix === 'N' || suffix === 'US' ? 'U'
        : 'A'
  const shaped: AnnouncementMarket | undefined = /^\d{6}$/u.test(body)
    ? 'A'
    : /^\d{1,5}$/u.test(body)
      ? 'H'
      : /^[A-Z][A-Z0-9.-]{0,9}$/u.test(body) && !body.includes('..')
        ? 'U'
        : undefined
  if (shaped === undefined) throw new Error(`announcement code shape not recognized: ${raw}`)
  if (suffixMarket !== undefined && suffixMarket !== shaped && !(suffixMarket === 'A' && shaped === 'H')) {
    throw new Error(`announcement code ${raw} has a suffix for ${suffixMarket} but a ${shaped} code; pass the right market or fix the code`)
  }
  const target = market === 'auto' ? (suffixMarket ?? shaped) : market
  if (target === 'A' && !/^\d{6}$/u.test(body)) throw new Error(`A-share announcement code must be six digits: ${raw}`)
  if (target === 'H') {
    if (!/^\d{1,5}$/u.test(body)) throw new Error(`HK announcement code must be 1–5 digits: ${raw}`)
    body = body.padStart(5, '0')
  }
  if (target === 'U' && !(/^[A-Z][A-Z0-9.-]{0,9}$/u.test(body) && !body.includes('..'))) {
    throw new Error(`US announcement ticker is invalid: ${raw}`)
  }
  return { code: body, market: target }
}

export function normalizeAnnouncementCodes(values: unknown, market: AnnouncementMarket | 'auto' = 'auto'): { codes: string[]; market: AnnouncementMarket } {
  if (!Array.isArray(values) || values.length === 0) throw new Error('codes must be a non-empty array')
  if (values.length > 50) throw new Error('codes accepts at most 50 codes per call')
  const normalized = values.map((value) => normalizeAnnouncementCode(value, market))
  const markets = new Set(normalized.map((item) => item.market))
  if (markets.size !== 1) {
    throw new Error('codes must be from one market per call (A / H / U); split mixed lists and call once per market')
  }
  return { codes: [...new Set(normalized.map((item) => item.code))], market: normalized[0]!.market }
}

function announcementDate(value: string, field: string): string {
  const text = value.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new Error(`parameter ${field} must be YYYY-MM-DD`)
  const check = new Date(`${text}T00:00:00Z`)
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== text) {
    throw new Error(`parameter ${field} must be a valid YYYY-MM-DD date`)
  }
  return text
}

function announcementRowDate(row: Record<string, unknown>): { date: string; publishedAt: string } {
  const display = typeof row.display_time === 'string' ? row.display_time.trim() : ''
  const notice = typeof row.notice_date === 'string' ? row.notice_date.trim() : ''
  const raw = display || notice
  if (raw.length < 10) throw new SourceError('eastmoney', 'INVALID_RESPONSE', '东财公告条目缺少 display_time / notice_date')
  const date = raw.slice(0, 10)
  const check = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== date) {
    throw new SourceError('eastmoney', 'INVALID_RESPONSE', `东财公告条目的时间不可解析：${JSON.stringify(raw.slice(0, 40))}`)
  }
  return { date, publishedAt: display || notice }
}

function announcementOwner(row: Record<string, unknown>, codes: string[]): { code: string; name: string } {
  const list = Array.isArray(row.codes) ? row.codes : []
  for (const raw of list) {
    const item = asRecord(raw)
    const code = typeof item?.stock_code === 'string' ? item.stock_code.trim() : ''
    if (codes.includes(code)) {
      return { code, name: typeof item?.short_name === 'string' ? item.short_name : '' }
    }
  }
  const first = asRecord(list[0])
  return {
    code: typeof first?.stock_code === 'string' ? first.stock_code : codes[0]!,
    name: typeof first?.short_name === 'string' ? first.short_name : '',
  }
}

/**
 * Eastmoney republishes issuer announcements; it is a complete issuer-scoped list by day,
 * whereas Wind's NL RAG is semantic and can miss the newest item. The list is the primary
 * path for "what was disclosed"; the authoritative PDF remains cninfo / the issuer.
 */
export async function eastmoneyAnnouncements(
  client: EastmoneyClient,
  input: {
    codes: string[]
    market: AnnouncementMarket
    startDate: string
    endDate: string
    cursor: number
    pageSize: number
    signal?: AbortSignal
  },
): Promise<SourceOutcome> {
  const start = announcementDate(input.startDate, 'start_date')
  const end = announcementDate(input.endDate, 'end_date')
  if (start > end) throw new Error('parameter start_date must not be later than end_date')
  const byArtCode = new Map<string, SourceItem>()
  let totalHits = 0
  let scannedPages = 0
  let reachedOlder = false
  let oldestScanned: string | undefined
  for (let page = 1; page <= EM_ANNOUNCEMENT_MAX_SCAN_PAGES; page += 1) {
    const params = new URLSearchParams({
      sr: '-1',
      page_size: String(EM_ANNOUNCEMENT_PAGE_SIZE),
      page_index: String(page),
      ann_type: input.market,
      client_source: 'web',
      stock_list: input.codes.join(','),
    })
    const outcome = await client.fetchText(`${EM_ANNOUNCEMENT_LIST_URL}?${params.toString()}`, {
      headers: { referer: EM_ANNOUNCEMENT_REFERER },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const body = asRecord(parseJson(outcome.text, 'eastmoney', '东财公告列表响应'))
    const data = asRecord(body?.data)
    if (!data) throw new SourceError('eastmoney', 'INVALID_RESPONSE', '东财公告列表缺少 data（上游结构可能已变）')
    if (data.list !== null && data.list !== undefined && !Array.isArray(data.list)) {
      throw new SourceError('eastmoney', 'INVALID_RESPONSE', '东财公告列表 data.list 不是数组（上游结构可能已变）')
    }
    const rows = Array.isArray(data.list) ? data.list : []
    totalHits = typeof data.total_hits === 'number' ? data.total_hits : rows.length
    scannedPages = page
    for (const raw of rows) {
      const row = asRecord(raw)
      if (!row) continue
      const { date, publishedAt } = announcementRowDate(row)
      if (oldestScanned === undefined || date < oldestScanned) oldestScanned = date
      if (date < start) {
        reachedOlder = true
        continue
      }
      if (date > end) continue
      const artCode = typeof row.art_code === 'string' ? row.art_code.trim() : ''
      if (artCode.length === 0) throw new SourceError('eastmoney', 'INVALID_RESPONSE', '东财公告条目缺少 art_code')
      if (byArtCode.has(artCode)) continue
      const owner = announcementOwner(row, input.codes)
      const category = Array.isArray(row.columns)
        ? row.columns.map((column) => (asRecord(column)?.column_name)).filter((name): name is string => typeof name === 'string').join('/')
        : ''
      const item: SourceItem = {
        code: owner.code,
        name: clip(owner.name),
        market: input.market,
        date,
        published_at: publishedAt,
        title: clip(stripHtml(typeof row.title === 'string' ? row.title : '')),
        category: clip(category),
        art_code: clip(artCode),
        url: itemUrl(`https://data.eastmoney.com/notices/detail/${owner.code}/${artCode}.html`),
      }
      byArtCode.set(artCode, item)
    }
    if (reachedOlder || rows.length < EM_ANNOUNCEMENT_PAGE_SIZE || page * EM_ANNOUNCEMENT_PAGE_SIZE >= totalHits) break
  }
  const sorted = [...byArtCode.values()].sort((left, right) => {
    const byTime = String(right.published_at ?? '').localeCompare(String(left.published_at ?? ''))
    return byTime !== 0 ? byTime : String(right.date ?? '').localeCompare(String(left.date ?? ''))
  })
  const offset = Number.isSafeInteger(input.cursor) && input.cursor >= 0 ? input.cursor : 0
  const items = sorted.slice(offset, offset + input.pageSize)
  const windowOutOfRange = !reachedOlder && oldestScanned !== undefined && oldestScanned > end
  const notes = ['东财公告是官方披露的转载；正文/PDF 可作公告事实的权威引用（authoritative_reprint），verified_official 仍只给官方域名；正文用 eastmoney_announcement_body；窗口按 display_time（北京时间）过滤']
  if (sorted.length === 0 && !windowOutOfRange) notes.push('窗口内没有公告（合法空结果；东财列表只覆盖最近若干页）')
  if (windowOutOfRange) {
    notes.push(`窗口未被覆盖：只扫描到最近 ${scannedPages * EM_ANNOUNCEMENT_PAGE_SIZE} 条（最早 ${oldestScanned}），所请求窗口早于此；请缩小日期/代码范围，或改用巨潮 PDF`)
  }
  if (offset + items.length < sorted.length) {
    notes.push(`窗口内共 ${sorted.length} 条，本次返回第 ${offset + 1}–${offset + items.length} 条；继续翻页传 cursor=${offset + items.length}`)
  }
  if (!reachedOlder && !windowOutOfRange && totalHits > scannedPages * EM_ANNOUNCEMENT_PAGE_SIZE) {
    notes.push(`本次只扫描前 ${scannedPages * EM_ANNOUNCEMENT_PAGE_SIZE} 条，窗口内可能仍有更早公告；请缩小日期窗或代码数`)
  }
  return {
    source: 'eastmoney',
    operation: 'announcements',
    items: clipItems(items),
    ...(offset + items.length < sorted.length ? { next_cursor: String(offset + items.length) } : {}),
    note: notes.join('；'),
  }
}

export interface AnnouncementBody {
  source: 'eastmoney'
  operation: 'announcement_body'
  art_code: string
  page: number
  offset: number
  page_chars: number
  total_pages: number
  is_ai_summary: boolean
  content: string
  next_offset?: number
  next_page?: number
  done: boolean
  pdf_url?: string
  title?: string
  notice_date?: string
  note?: string
}

/**
 * The detail API returns at most 5,000 characters per `page_index`; `page_size` is the
 * total page count, so `done` is knowable without fetching a sentinel page. US filings
 * often return an empty body while still carrying a PDF — that is a fact, not an error.
 */
export async function eastmoneyAnnouncementBody(
  client: EastmoneyClient,
  input: { artCode: string; page: number; offset: number; limit: number; signal?: AbortSignal },
): Promise<AnnouncementBody> {
  const artCode = input.artCode.trim().toUpperCase()
  if (!/^AN\d{6,}$/u.test(artCode)) throw new Error('art_code must look like AN202611021831320924')
  if (!Number.isSafeInteger(input.page) || input.page < 1) throw new Error('page must be a positive integer')
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) throw new Error('offset must be a non-negative integer')
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error('limit must be a positive integer')
  const page = input.page
  const params = new URLSearchParams({ art_code: artCode, client_source: 'web', page_index: String(page) })
  const outcome = await client.fetchText(`${EM_ANNOUNCEMENT_BODY_URL}?${params.toString()}`, {
    headers: { referer: EM_ANNOUNCEMENT_REFERER },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  const body = asRecord(parseJson(outcome.text, 'eastmoney', '东财公告正文响应'))
  const data = asRecord(body?.data)
  if (!data) throw new SourceError('eastmoney', 'NOT_FOUND', `东财公告正文没有 art_code=${artCode} 的数据（公告不存在或上游结构已变）`)
  const content = stripHtml(typeof data.notice_content === 'string' ? data.notice_content : '')
  const pageCount = Number(data.page_size)
  const totalPages = Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : 1
  const pdfUrl = itemUrl(data.attach_url_web ?? data.attach_url)
  const title = clip(data.notice_title)
  const noticeDate = clip(data.notice_date)
  const aiSummary = Number(data.is_ai_summary) === 1
  const base: Omit<AnnouncementBody, 'content' | 'done'> = {
    source: 'eastmoney',
    operation: 'announcement_body',
    art_code: artCode,
    page,
    offset: input.offset,
    page_chars: content.length,
    total_pages: totalPages,
    is_ai_summary: aiSummary,
    ...(pdfUrl.length > 0 ? { pdf_url: pdfUrl } : {}),
    ...(title.length > 0 ? { title } : {}),
    ...(noticeDate.length > 0 ? { notice_date: noticeDate } : {}),
  }
  if (content.length === 0) {
    return {
      ...base,
      content: '',
      done: true,
      note: `该公告正文接口没有返回文本（美股公告常见；若为 A/H 公告，可能是上游结构变更）；正文在附件：PDF 交 ocr，.html 用 web_retriever_fetch，别把标题当正文${
        aiSummary ? '；东财标记为 AI 摘要（is_ai_summary=1），不是全文' : ''
      }`,
    }
  }
  if (page > totalPages) {
    return { ...base, content: '', done: true, note: `page 超过总页数 ${totalPages}（该公告只有 ${totalPages} 页）` }
  }
  if (input.offset >= content.length) {
    const nextPage = page < totalPages ? page + 1 : undefined
    return {
      ...base,
      content: '',
      ...(nextPage === undefined ? {} : { next_page: nextPage }),
      done: nextPage === undefined,
      note: nextPage === undefined ? '已到文末' : `本页已读完；下一页传 page=${nextPage}、offset=0`,
    }
  }
  const limit = Math.min(input.limit, 4_000)
  const slice = content.slice(input.offset, input.offset + limit)
  const nextOffset = input.offset + slice.length < content.length ? input.offset + slice.length : undefined
  const nextPage = nextOffset === undefined && page < totalPages ? page + 1 : undefined
  const done = nextOffset === undefined && nextPage === undefined
  const notes: string[] = []
  if (totalPages > 1) notes.push(`全文共 ${totalPages} 页（每页约 5,000 字符）；用 next_offset / next_page 继续读`)
  if (aiSummary) notes.push('东财标记为 AI 摘要（is_ai_summary=1），不是公告全文；全文用 pdf_url + ocr')
  if (pdfUrl.length > 0) notes.push('附件直链在 pdf_url（可能是 .html；PDF 交 ocr，HTML 用 web_retriever_fetch）；verified_official 仍只给官方域名')
  return {
    ...base,
    content: slice,
    ...(nextOffset === undefined ? {} : { next_offset: nextOffset }),
    ...(nextPage === undefined ? {} : { next_page: nextPage }),
    done,
    ...(notes.length === 0 ? {} : { note: notes.join('；') }),
  }
}

const SINA_REPORT_URL = 'https://vip.stock.finance.sina.com.cn/q/go.php/vReport_List/kind'
const SINA_REFERER = 'https://finance.sina.com.cn/'

/**
 * Always add the exchange prefix: bare codes get a fake empty page for STAR/ChiNext.
 * That page is HTTP 200 and looks like "no reports", so also verify the numbered row count.
 */
export async function sinaReports(
  transport: Requester,
  input: { code?: string; page: number; signal?: AbortSignal },
): Promise<SourceOutcome> {
  const params = new URLSearchParams()
  let url: string
  if (input.code === undefined) {
    url = `${SINA_REPORT_URL}/lastest/index.phtml`
    params.set('p', String(input.page))
  } else {
    url = `${SINA_REPORT_URL}/search/index.phtml`
    params.set('symbol', sinaSymbol(input.code))
    params.set('t1', 'all')
    params.set('p', String(input.page))
  }
  const outcome = await transport.request(
    { url: `${url}?${params.toString()}`, headers: { referer: SINA_REFERER }, encoding: 'gbk' },
    input.signal,
  )
  const text = outcome.text
  const emptyPage = text.includes('没有找到相关内容')
  const numbered = (text.match(/<tr>\s*<td>\d+<\/td>/gu) ?? []).length
  const rowPattern = /<tr>\s*<td>\d+<\/td>\s*<td class="tal f14">\s*<a[^>]*?title="([^"]*)"[^>]*?href="([^"]*?\/rptid\/(\d+)\/[^"]*)"[^>]*>[\s\S]*?<\/a>\s*<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gu
  const items: SourceItem[] = []
  for (const match of text.matchAll(rowPattern)) {
    const href = match[2]
    // Occasionally protocol-relative (`//host/...`): promote to https, one link form.
    const url = itemUrl(href.startsWith('//') ? `https:${href}` : href)
    items.push({
    // Column order from the page header: type is col 4, date is col 5.
    date: clip(match[5]),
      title: clip(stripHtml(match[1])),
      type: clip(match[4]),
      org: clip(stripHtml(match[6])),
      researcher: clip(stripHtml(match[7])),
      report_id: match[3],
      url,
    })
  }
  // Every numbered row must parse; mismatch means the page structure changed.
  if (items.length !== numbered) {
    throw new SourceError('sina', 'INVALID_RESPONSE', `新浪研报页有 ${numbered} 行带序号、只解析出 ${items.length} 条（页面行结构可能已变）`)
  }
  if (items.length === 0 && !emptyPage) {
    throw new SourceError('sina', 'INVALID_RESPONSE', '新浪研报页没有研报也没有「没有找到相关内容」提示（页面结构可能已变）')
  }
  return {
    source: 'sina',
    operation: input.code === undefined ? 'latest' : 'by_stock',
    items: clipItems(items),
    ...(items.length === 0 ? { note: '上游明确返回「没有找到相关内容」：该标的近期无研报，或已翻过末页' } : {}),
  }
}

/**
 * Always prefix the exchange; order matters: BJ segments (43/83/87/920) start with 9/4
 * and must be tested before `9 => sh`; only 900xxx is Shanghai B.
 */
export function sinaSymbol(code: string): string {
  if (/^(920|43|83|87)/u.test(code)) return `bj${code}`
  if (/^(6|9)/u.test(code)) return `sh${code}`
  if (/^(0|2|3)/u.test(code)) return `sz${code}`
  if (/^4/u.test(code)) return `bj${code}`
  return code
}

const THS_EPS_URL = 'https://basic.10jqka.com.cn/new'
const THS_REFERER = 'https://basic.10jqka.com.cn/'

/**
 * The page declares text/html without charset but is GBK, so decode explicitly
 * (`encoding` is source-only, never a model input). Of its 32 tables, pick the one
 * with 每股收益/均值 headers; the mean is the consensus EPS.
 */
export async function thsEpsForecast(
  transport: Requester,
  input: { code: string; signal?: AbortSignal },
): Promise<SourceOutcome> {
  const outcome = await transport.request(
    { url: `${THS_EPS_URL}/${input.code}/worth.html`, headers: { referer: THS_REFERER }, encoding: 'gbk' },
    input.signal,
  )
  const html = outcome.text
  // Match by header text, not table position; accept ZH/EN spellings.
  const table = [...html.matchAll(/<table[\s\S]*?<\/table>/gu)]
    .find((match) => /每股收益|EPS|每股收益\(元\)/iu.test(match[0]) && /均值|mean/iu.test(match[0]))
  if (table === undefined) {
    throw new SourceError('ths', 'INVALID_RESPONSE', '同花顺页面里没有含「每股收益 / 均值」列的表格（页面结构可能已变）')
  }
  const items: SourceItem[] = []
  for (const rowMatch of table[0].matchAll(/<tr[\s\S]*?<\/tr>/gu)) {
    const cells = [...rowMatch[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gu)]
      .map((cell) => stripHtml(cell[1]).replace(/\s+/gu, ' ').trim())
    const year = cells[0] ?? ''
    if (!/^\d{4}$/u.test(year)) continue
    const num = (value: string | undefined): number | null => {
      const parsed = Number(value)
      return value === undefined || value === '' || !Number.isFinite(parsed) ? null : parsed
    }
    items.push({
      year,
      institutions: num(cells[1]),
      eps_min: num(cells[2]),
      // Mean = consensus EPS, the core output.
      eps_mean: num(cells[3]),
      eps_max: num(cells[4]),
      industry_average: num(cells[5]),
    })
  }
  if (items.length === 0) {
    throw new SourceError('ths', 'INVALID_RESPONSE', '同花顺一致预期表没有解析出任何年度行（页面结构可能已变）')
  }
  const institutionCount = /共有\s*<strong>(\d+)<\/strong>\s*家机构/u.exec(html)
  return {
    source: 'ths',
    operation: 'eps_forecast',
    items: clipItems(items),
    note: `${institutionCount === null ? '' : `页面摘要：${institutionCount[1]} 家机构作出预测；`}eps_mean 即机构一致预期 EPS；预测机构数偏少（<3）时一致预期参考价值有限——请把 institutions 一并向用户披露`,
  }
}
