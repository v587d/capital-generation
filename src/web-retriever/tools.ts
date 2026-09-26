import type { Context } from '@deepseek-ai/cordis'
import { WebRetriever } from './retriever.js'
import type { WindCallResult, WindClient } from './wind-client.js'
import {
  MAX_ITEMS,
  SourceError,
  clsTelegraph,
  cninfoIrm,
  createGatedEastmoneyTransport,
  createSourceTransport,
  eastmoneyFastNews,
  eastmoneyReports,
  eastmoneyStockNews,
  sinaReports,
  sseinfoQa,
  thsEpsForecast,
  wscnLives,
} from './sources.js'
import type { SourceId, SourceItem, SourceOutcome } from './sources.js'
import type { LocalFetchOptions } from './local-fetch.js'
import { assertPublicUrlTarget } from './local-fetch.js'
import { createEastmoneyClient, sharedEastmoneyThrottle } from '../net/eastmoney-client.js'
import { bareAshareDigits } from '../sources/security-code.js'
import { callerSession, type AgentExecutionLike } from '../tool-exec.js'
import { DatasetStoreError, type SessionLike, type WorkspaceDatasetStore } from '../data-collector/store.js'
import { OcrError, type PaddleOcrClient } from '../ocr/client.js'
import { locateQuery, parsePageRange, selectPages, type OcrDocument, type OcrPageEntry } from '../ocr/markdown.js'
import {
  OCR_DOC_ID_PATTERN,
  buildArtifactMeta,
  deriveOcrDocId,
  ocrArtifactRef,
  readOcrArtifact,
  readOcrSourceBytes,
  writeOcrArtifact,
  OcrArtifactError,
  type OcrArtifact,
  type OcrArtifactMeta,
} from '../ocr/store.js'

interface ToolRuntimeLike { register(definition: unknown): () => void }
/**
 * exec 形状**只认框架那一份**（`src/tool-exec.ts`）：`ocr` 要拿调用方 session 去落盘，
 * 如果这里自造一个只有 `id` 的形状，本地测试就会绕过 `header.cwd` 这条真实路径
 * （AGENTS.md §9.7 的第 2 条事故正是 session 读取漏接框架形状）。
 */
type ToolExecLike = AgentExecutionLike

const MAX_QUERY_LENGTH = 500
const MAX_URL_LENGTH = 2048
const MAX_RESULTS = 20
const RECENT_TRACE_LIMIT = 8
const TRACE_TEXT_CLIP = 200

interface RetrievalTrace { provider: string; tool: string; query: string; at: number; via?: string }

const jsonObject = (properties: Record<string, unknown> = {}, required: string[] = []): object => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
  { type: 'text', text: JSON.stringify(value) },
]

function requiredString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`)
  if (value.length > maxLength) throw new Error(`${name} exceeds maximum length ${maxLength}`)
  return value
}

function validHttpUrl(value: unknown): string {
  const url = requiredString(value, 'url', MAX_URL_LENGTH)
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('only http(s) URLs are allowed')
  } catch (error) {
    throw new Error(`url must be a valid http(s) URL: ${error instanceof Error ? error.message : String(error)}`)
  }
  return url
}

function integer(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

/**
 * 检索回声：按调用方 session 维护两类只读信息——
 * 1. recent_retrievals：最近几次检索流水（跨 anysearch 与 wind_docs，上限 RECENT_TRACE_LIMIT），
 *    供模型在换 provider 前盘点已搜过什么、避免重复搜索；
 * 2. provider_tally：各 provider 的累计调用次数（不封顶），让"每个 provider 一般 5 次收敛"
 *    的经验法则变成看得见的计数器。
 * 两者都是纯提醒不拦截；内存态、不落盘，随会话消亡。WebRetriever / WindClient 保持无状态。
 */
interface RetrievalEcho {
  recent: RetrievalTrace[]
  tally: Record<string, number>
  /** 刚写入的流水条目（存储态引用），供调用方回填 fetch 的 `via`。 */
  entry: RetrievalTrace
  /** 重新快照当前流水；回填 `entry.via` 后用它取最新的 recent_retrievals。 */
  snapshot: () => RetrievalTrace[]
}

function createRetrievalEcho() {
  const traces = new Map<string, RetrievalTrace[]>()
  const tallies = new Map<string, Map<string, number>>()
  return (exec: ToolExecLike, entry: RetrievalTrace): RetrievalEcho => {
    const key = exec.agent?.session?.id ?? 'default'
    const list = traces.get(key) ?? []
    const stored: RetrievalTrace = { ...entry, query: entry.query.slice(0, TRACE_TEXT_CLIP) }
    list.push(stored)
    while (list.length > RECENT_TRACE_LIMIT) list.shift()
    traces.set(key, list)
    const counts = tallies.get(key) ?? new Map<string, number>()
    counts.set(entry.provider, (counts.get(entry.provider) ?? 0) + 1)
    tallies.set(key, counts)
    const tally: Record<string, number> = {}
    for (const provider of [...counts.keys()].sort()) tally[provider] = counts.get(provider) as number
    const snapshot = (): RetrievalTrace[] => list.map((item) => ({ ...item }))
    return { recent: snapshot(), tally, entry: stored, snapshot }
  }
}

function searchOutput(result: Awaited<ReturnType<WebRetriever['search']>>, recent: RetrievalTrace[], tally: Record<string, number>): Record<string, unknown> {
  return {
    provider: 'anysearch',
    query: result.query,
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
    sources: result.sources.slice(0, MAX_RESULTS),
    recent_retrievals: recent,
    provider_tally: tally,
  }
}

function fetchOutput(result: Awaited<ReturnType<WebRetriever['fetch']>>, recent: RetrievalTrace[], tally: Record<string, number>): Record<string, unknown> {
  return {
    provider: 'anysearch',
    url: result.url,
    ok: result.ok,
    via: result.via,
    ...(result.title ? { title: result.title } : {}),
    ...(result.content ? { content: result.content, content_chars: result.content.length } : {}),
    ...(result.truncated ? { truncated: true } : {}),
    ...(result.code ? { code: result.code } : {}),
    ...(result.fallback ? { fallback: result.fallback } : {}),
    ...(result.local_error ? { local_error: result.local_error } : {}),
    ...(result.error ? { error: result.error } : {}),
    recent_retrievals: recent,
    provider_tally: tally,
  }
}

/**
 * 把失败回执变成**工具错误**。
 *
 * 为什么必须抛而不是正常返回：DSH 用 `isError` 表达工具失败，而 `dsh-tools` 的
 * `createSuccessResult` 硬编码 `isError: false`——**返回值没有任何办法标记失败**，
 * 唯一通道是从 `execute` 抛出（`dispatchToolBody` 的 catch → `toolErrorResult`，
 * 产出 `{ text: "Error: …", isError: true, error: { message } }`）。官方
 * `web_fetch` / `web_search` 就是抛 `WebError`。
 *
 * 2026-09 实测缺陷：本工具此前把失败做成 `ok:false` 信封**正常返回**，于是子 Agent
 * 会话日志里 7 次实际失败的抓取全部记成 `isError: false`，UI 与模型都当成成功，
 * 任何基于 `isError` 的重试/统计/压缩逻辑也一并失效。
 *
 * 抛出的消息带**完整结构化回执**，所以 `via` / `fallback` / `local_error` /
 * `recent_retrievals` / `provider_tally` 与来源标注协议字段一个都不丢。
 *
 * 范围：只覆盖 `web_retriever_fetch`（本地回退所在工具）。`anysearch_search`
 * 与两个 `wind_docs_*` 工具的错误信号是同一类问题，但按 2026-09 决定**不在本次改动**
 * 内，审计与后续安排见 `docs/design/tool-result-error-signal.md`。
 */
function throwToolFailure(payload: Record<string, unknown>): never {
  throw new Error(JSON.stringify(payload))
}

function windOutput(tool: string, query: string, result: WindCallResult, recent: RetrievalTrace[], tally: Record<string, number>): Record<string, unknown> {
  return {
    provider: 'wind_docs',
    tool,
    query,
    ok: result.ok,
    ...(result.data !== undefined ? { data: result.data } : {}),
    ...(result.content !== undefined ? { content: result.content, content_chars: result.content.length } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.code ? { code: result.code } : {}),
    recent_retrievals: recent,
    provider_tally: tally,
  }
}

const WIND_ANNOUNCEMENTS_TOOL = 'wind_docs_announcements'
const WIND_NEWS_TOOL = 'wind_docs_news'
const WIND_ANNOUNCEMENTS_UPSTREAM = 'get_company_announcements'
const WIND_NEWS_UPSTREAM = 'get_financial_news'

/**
 * 注册 web_retriever 的检索工具：anysearch（广度）两工具 + wind_docs（public_document
 * 精准）两工具 + `ocr`（文档解析）一工具。wind 与 ocr 都**无条件注册**——Key 缺失/服务
 * 不可用只影响调用结果（错误信封），不影响工具注册与子 Agent 创建。
 *
 * `ocr` 与 `datasetStore` 共用 workspace 落盘，而检索回声（`recent_retrievals` /
 * `provider_tally`）**必须**与另外四个工具共享同一份闭包，所以它在这同一个 `definitions`
 * 数组里注册，不另起一个注册函数。
 */
export function registerWebRetrieverTools(
  ctx: Context,
  retriever: WebRetriever,
  windClient: WindClient,
  ocr: OcrToolDependencies,
): void {
  const tools = ctx.get('tools') as ToolRuntimeLike | undefined
  if (!tools) return

  const echo = createRetrievalEcho()
  const trace = (exec: ToolExecLike, provider: string, tool: string, query: string) =>
    echo(exec, { provider, tool, query, at: Date.now() })

  const definitions = [
    {
      name: 'anysearch_search',
      description: '使用 anysearch 检索网页（广度优先）：发现候选来源与线索，结果仅作为候选，不等于已核验事实。一次只提交一个查询。需要读取网页正文或核验官方归属时，必须逐个调用 web_retriever_fetch。',
      parameters: jsonObject({
        query: { type: 'string', description: '单个网页检索词，最多 500 字符' },
        max_results: { type: 'integer', description: '可选，返回来源数 1~20' },
      }, ['query']),
      output: { schema: { type: 'object', additionalProperties: true }, render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const query = requiredString(args.query, 'query', MAX_QUERY_LENGTH)
        const maxResults = integer(args.max_results, 'max_results', 1, MAX_RESULTS)
        const { recent, tally } = trace(exec, 'anysearch', 'anysearch_search', query)
        return searchOutput(await retriever.search(query, maxResults, exec.signal), recent, tally)
      },
    },
    {
      name: 'web_retriever_fetch',
      description: '使用 anysearch 抓取一个网页正文（一次只能提交一个 http(s) URL）。AnySearch 失败且值得换路、本机直连回退已启用（设置卡片开关，默认开启）时，会自动改由本机直连抓取该页面，不需要再次调用；未启用时 AnySearch 失败即回传失败。回执里的 via 标明正文来源：anysearch = AnySearch 清洗正文，local-http = 本机直连抓取。本机直连只处理公开可访问的文本页面（HTML/文本/JSON/XML），PDF、二进制与需登录页面仍会失败；正文超长时是截断（truncated: true），不是失败。证券任务的 verified_official 核验只能经本工具完成：只允许抓取已由官方页面直接证明归属和用途的官方来源域名，不得 fetch 全部搜索结果。',
      parameters: jsonObject({
        url: { type: 'string', description: '单个 http(s) URL；证券任务必须是已核验的官方来源 URL' },
      }, ['url']),
      output: { schema: { type: 'object', additionalProperties: true }, render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const url = validHttpUrl(args.url)
        const { entry, snapshot, tally } = trace(exec, 'anysearch', 'web_retriever_fetch', url)
        const result = await retriever.fetch(url, exec.signal)
        entry.via = result.via
        const payload = fetchOutput(result, snapshot(), tally)
        // 失败必须变成工具错误（isError: true），不能做成"正常返回的失败信封"。
        if (result.ok === false) throwToolFailure(payload)
        return payload
      },
    },
    {
      name: WIND_ANNOUNCEMENTS_TOOL,
      description: '检索 Wind 官方文档库中的上市公司公告、年报、季报、招股书等正式文件（public_document，官方文件内容的首选来源）。query 必须一次带齐三要素：公司实体（股票代码或公司全称）、文件类型、时间范围；禁止“公告 2026年9月”这类无主体泛查询。返回内容标注“来源：万得 Wind 金融数据服务”与时间口径后即可作为证据使用，不必再走官网核验；第三方媒体报道不在此范围。消耗积分，按需少量调用；返回 AUTH/RATE_LIMIT 等错误时不得重试本工具，改用 anysearch_search 发现公告线索并 web_retriever_fetch 官方披露页。',
      parameters: jsonObject({
        query: { type: 'string', description: '自然语言检索要求；必须包含公司实体（股票代码或公司全称）、文件类型与时间范围三要素，最多 500 字符' },
        top_k: { type: 'integer', description: '可选，返回相关文档最大数量 1~10，默认 5' },
      }, ['query']),
      output: { schema: { type: 'object', additionalProperties: true }, render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const query = requiredString(args.query, 'query', MAX_QUERY_LENGTH)
        const topK = integer(args.top_k, 'top_k', 1, 10)
        const { recent, tally } = trace(exec, 'wind_docs', WIND_ANNOUNCEMENTS_TOOL, query)
        const result = await windClient.callTool(
          WIND_ANNOUNCEMENTS_UPSTREAM,
          { query, ...(topK === undefined ? {} : { top_k: topK }) },
          exec.signal,
        )
        return windOutput(WIND_ANNOUNCEMENTS_TOOL, query, result, recent, tally)
      },
    },
    {
      name: WIND_NEWS_TOOL,
      description: '检索 Wind 官方文档库中的财经新闻（public_document，权威新闻内容的首选来源）。query 必须一次带齐三要素：公司实体或主题、新闻类型、时间范围；禁止无主体泛查询。返回内容标注“来源：万得 Wind 金融数据服务”与时间口径后即可作为证据使用；发行人官方公告与券商研报不在此范围。消耗积分，按需少量调用；返回 AUTH/RATE_LIMIT 等错误时不得重试本工具，改用 anysearch_search + web_retriever_fetch。',
      parameters: jsonObject({
        query: { type: 'string', description: '自然语言检索要求；必须包含公司实体或主题、新闻类型与时间范围三要素，最多 500 字符' },
        top_k: { type: 'integer', description: '可选，返回相关文档最大数量 1~10，默认 5' },
      }, ['query']),
      output: { schema: { type: 'object', additionalProperties: true }, render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const query = requiredString(args.query, 'query', MAX_QUERY_LENGTH)
        const topK = integer(args.top_k, 'top_k', 1, 10)
        const { recent, tally } = trace(exec, 'wind_docs', WIND_NEWS_TOOL, query)
        const result = await windClient.callTool(
          WIND_NEWS_UPSTREAM,
          { query, ...(topK === undefined ? {} : { top_k: topK }) },
          exec.signal,
        )
        return windOutput(WIND_NEWS_TOOL, query, result, recent, tally)
      },
    },
    {
      name: 'ocr',
      timeoutMs: OCR_TOOL_TIMEOUT_MS,
      description: '把一份 PDF 或图片解析成模型可读的 markdown（PaddleOCR 文档解析，需要 Token）。一次调用只走一种形态：url=公网 .pdf 直链（本机不抓文件，由上游取）；file=session workspace 内的相对路径（pdf/png/jpg/jpeg/webp/bmp/tiff，@mention 带来的开头 @ 可省）；job_id + doc_id=继续等上一次 status:pending 回执里的作业（**不重复提交、不再花钱**）；doc_id=读已落盘的结果，可配 pages（"1-3" / "5" / "2-4,9"，一次最多 8 页）或 query（关键词定位，回命中片段与页号）。⚠️ 作业**整篇一次算完**：pages 只影响读、不影响算价，也不会更便宜；同一份文档重复调用会命中 doc_id 缓存、不再出网。结果一律落 capital-data/ocr/<doc_id>/，回执在预算内给全文、超预算只给页索引与第 1 页。没有 Token、解析失败或文档超页时须如实说明边界：不得把标题当正文引用，不得把 PDF 链接当正文来源标注（正文来自解析结果，引用写 doc_id 与页号）。',
      parameters: jsonObject({
        url: { type: 'string', description: '公网可达的 .pdf 直链（http/https，不含凭据，不接受内网地址与 IP 字面量）' },
        file: { type: 'string', description: 'session workspace 内的相对路径，例如 refs/贵州茅台研报.pdf' },
        job_id: { type: 'string', description: '上一次回执 status:pending 里的 job_id；必须与同一回执的 doc_id 一起传' },
        doc_id: { type: 'string', description: '解析结果标识（形如 ocr_1a2b3c4d5e6f），来自回执' },
        pages: { type: 'string', description: '配合 doc_id 读取的页区间，1 起始闭区间，例如 "2-4,9"；一次最多 8 页' },
        query: { type: 'string', description: `配合 doc_id 的关键词定位，最多 ${OCR_MAX_QUERY_CHARS} 字符` },
        limit: { type: 'integer', description: `query 命中数上限 1~${OCR_MAX_QUERY_LIMIT}，默认 ${OCR_DEFAULT_QUERY_LIMIT}` },
        charts: { type: 'boolean', description: '可选，是否启用图表识别（默认 true）；只影响 url/file 形态的这一次提交' },
        refresh: { type: 'boolean', description: '可选，忽略缓存重新解析（默认 false）；只接受与 url/file 同时传，重跑会再花一次 job' },
      }, []),
      output: { schema: { type: 'object', additionalProperties: true }, render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        return runOcr(ocr, trace, args, exec)
      },
    },
  ]

  for (const definition of definitions) {
    ctx.effect(() => tools.register(definition), `capital-generation.tool(${definition.name})`)
  }
}

// ── 文档解析面：ocr（PDF / 图片 → markdown，产物一律落盘）───────────────────
//
// 与前两组的分工：search / fetch 是**检索**工作面，具名来源是**查询**工作面，`ocr` 是
// **解析**工作面——把一个已经确定的文档变成模型可读的正文。它因此不绑任何具体来源
// （谁的 `.pdf` 直链都能喂进来），也**不受 `localFetch.enabled` 支配**：那道开关的字面
// 语义是"允许本机直连提取网页内容"，而这里的文件由上游解析服务取，用户同意的是另一件事
// （Token 卡片）。判据写在 `docs/dev/web-retriever.md` §4.3。

const OCR_TOOL_TIMEOUT_MS = 240_000
/** 一次 `pages` 读取的页数上限：与"整篇一次算完"配对，限制的是**回集体积**，不是算力。 */
const OCR_MAX_PAGES_PER_READ = 8
const OCR_QUERY_WINDOW_CHARS = 320
const OCR_MAX_QUERY_CHARS = 64
const OCR_DEFAULT_QUERY_LIMIT = 5
const OCR_MAX_QUERY_LIMIT = 20
const OCR_LOCAL_SUFFIXES = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff']
const PDF_URL_SUFFIX = /\.pdf$/iu

/** `ocr` 的两项依赖：上游客户端 + workspace 落盘（与 Dataset 共用同一份实现）。 */
export interface OcrToolDependencies {
  store: WorkspaceDatasetStore
  client: PaddleOcrClient
  /** 注入以便测试钉住 `created_at`。 */
  now?: () => number
  /**
   * 注入以便测试：`url` 形态的公网性闸门默认走**真实 DNS**（与本机直连同一份实现，§9.7），
   * 生产路径不传。生产代码里没有任何调用方给它赋值——它只是把 DNS 这一步挪出断言范围。
   */
  resolveAddresses?: LocalFetchOptions['resolveAddresses']
}

type OcrTrace = (exec: ToolExecLike, provider: string, tool: string, query: string) => RetrievalEcho

/** 回执统一的错误码（`OcrError` 的码 + 工具侧才可能出现的码）。 */
type OcrFailureCode =
  | 'NO_CREDENTIAL'
  | 'UPSTREAM'
  | 'JOB_FAILED'
  | 'RESULT_INVALID'
  | 'TOO_MANY_PAGES'
  | 'TIMEOUT'
  | 'BLOCKED_URL'
  | 'INVALID_INPUT'
  | 'DOC_NOT_FOUND'
  | 'STORE_UNAVAILABLE'

/** 工具侧自己判定出来的失败（参数形态、缓存缺失），带一条能照做的 hint。 */
class OcrToolError extends Error {
  constructor(readonly code: OcrFailureCode, message: string, readonly hint?: string) {
    super(message)
    this.name = 'OcrToolError'
  }
}

function isAbortError(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code
  return code === 'ABORTED' || (error instanceof Error && error.name === 'AbortError')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 半件产物（meta 在、正文不在）怎么修：把**能照抄的那一次调用**写进 hint。
 *
 * 指认来自 meta，不来自调用方——`doc_id` 是内容寻址的，用同一个 source 重跑必然落回同一个
 * `doc_id`，所以这条 hint 是无脑可执行的。认不出 source 形态时只说"重新解析一次"，不编参数。
 */
function artifactRepair(sourceKind: 'url' | 'file' | 'job' | undefined, source: string | undefined): string {
  const prefix = sourceKind === 'url' ? 'url:' : sourceKind === 'file' ? 'file:' : undefined
  if (source === undefined || prefix === undefined || !source.startsWith(prefix)) {
    return '把当初解析它用的 url 或 file 再传一次，并带 refresh: true 强制重跑'
  }
  const argument = JSON.stringify(source.slice(prefix.length))
  return `再调一次 { ${prefix.slice(0, -1)}: ${argument}, refresh: true } 重新解析（doc_id 由内容寻址，重跑落回同一个产物）`
}

/**
 * 三条实现各自的异常（`OcrToolError` / `OcrError` / 出口闸门 / `DatasetStoreError`）
 * 翻成**一套**回执码。认不出的仍退回 `INVALID_INPUT` 并照抄消息——绝不假装知道上游
 * 或宿主失败的原因。
 */
function ocrFailure(error: unknown): { code: OcrFailureCode; error: string; hint?: string } {
  if (error instanceof OcrToolError) {
    return { code: error.code, error: error.message, ...(error.hint ? { hint: error.hint } : {}) }
  }
  if (error instanceof OcrError) return { code: error.code, error: error.message }
  if (error instanceof OcrArtifactError) {
    // 产物坏了不是调用方传错了：说成 INVALID_INPUT 会把模型推到"换个参数再猜"，
    // 而正确的下一步只有一条——拿 meta 里的 source 重跑那一次解析。
    return { code: 'RESULT_INVALID', error: error.message, hint: artifactRepair(error.sourceKind, error.source) }
  }
  const code = (error as { code?: unknown } | undefined)?.code
  if (code === 'INVALID_URL' || code === 'BLOCKED_URL' || code === 'DNS') {
    return {
      code: 'BLOCKED_URL',
      error: errorMessage(error),
      hint: 'url 必须是公网可达的 http(s) .pdf 直链：不含凭据，也不是内网地址或 IP 字面量',
    }
  }
  if (error instanceof DatasetStoreError) {
    if (code === 'dataset_not_found') {
      return { code: 'INVALID_INPUT', error: errorMessage(error) }
    }
    if (code === 'workspace_path_invalid') {
      return {
        code: 'INVALID_INPUT',
        error: errorMessage(error),
        hint: 'file 只能是 session workspace 内的相对路径（绝对路径、盘符与 .. 一律拒绝）',
      }
    }
    if (code === 'dataset_too_large') {
      return { code: 'TOO_MANY_PAGES', error: errorMessage(error), hint: '这份文档超出读取上限，换更小的文件或按页取材' }
    }
    return {
      code: 'STORE_UNAVAILABLE',
      error: errorMessage(error),
      hint: '落盘需要 session 的 workspace cwd 与可写权限（写到 capital-data/ocr/）',
    }
  }
  return { code: 'INVALID_INPUT', error: errorMessage(error) }
}

interface OcrRequest {
  mode: 'url' | 'file' | 'resume' | 'read'
  /** 检索回声里显示的一行指认（url / 相对路径 / job_id / doc_id）。 */
  label: string
  url?: string
  file?: string
  job_id?: string
  doc_id?: string
  pages?: string
  query?: string
  limit?: number
  charts: boolean
  refresh: boolean
}

function flag(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') throw new OcrToolError('INVALID_INPUT', `${name} must be a boolean`)
  return value
}

function optionalString(value: unknown, name: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  return requiredString(value, name, maxLength)
}

function requireDocId(value: unknown): string {
  const docId = requiredString(value, 'doc_id', 64)
  if (!OCR_DOC_ID_PATTERN.test(docId)) {
    throw new OcrToolError('INVALID_INPUT', `doc_id 形状不对：${docId}`, 'doc_id 形如 ocr_1a2b3c4d5e6f，取上一次回执里的原值')
  }
  return docId
}

/**
 * 四形态的**边界归一化**（`docs/dev/tool-schema.md` §9.2：多形态靠可选属性 + 归一化，一个工具名）。
 *
 * 歧义一律响亮拒绝而不是"挑一个"：`url` + `file` 同时给、`pages` 配 `query`、`refresh`
 * 配 `doc_id`——静默选边会让模型以为自己要的东西还在。
 */
function ocrRequest(args: Record<string, unknown>): OcrRequest {
  const present = (key: string): boolean => args[key] !== undefined && args[key] !== null && args[key] !== ''
  const given = ['url', 'file', 'job_id', 'doc_id'].filter(present)
  if (given.length === 0) {
    throw new OcrToolError('INVALID_INPUT', '必须给出 url / file / job_id(+doc_id) / doc_id 之一', '解析新文档传 url 或 file；读已解析的文档传 doc_id')
  }
  const charts = flag(args.charts, 'charts', true)
  const refresh = flag(args.refresh, 'refresh', false)
  const pages = optionalString(args.pages, 'pages', 64)
  const query = optionalString(args.query, 'query', OCR_MAX_QUERY_CHARS)
  const limit = integer(args.limit, 'limit', 1, OCR_MAX_QUERY_LIMIT)
  if (pages !== undefined && query !== undefined) {
    throw new OcrToolError('INVALID_INPUT', 'pages 与 query 只能给一个', '先 query 定位到页，再 pages 整页读')
  }
  if (given.includes('job_id')) {
    if (!given.includes('doc_id')) {
      throw new OcrToolError('INVALID_INPUT', 'job_id 必须与同一回执里的 doc_id 一起传', '续查一个已提交作业：{ job_id, doc_id }')
    }
    if (given.length > 2) throw new OcrToolError('INVALID_INPUT', `续查时不要再传 ${given.filter((key) => key !== 'job_id' && key !== 'doc_id').join('/')}`)
    if (pages !== undefined || query !== undefined) {
      throw new OcrToolError('INVALID_INPUT', '作业还没解析完，没有页可读', '先只传 job_id + doc_id 等到 status:done')
    }
    const jobId = requiredString(args.job_id, 'job_id', 128)
    return { mode: 'resume', label: jobId, job_id: jobId, doc_id: requireDocId(args.doc_id), charts, refresh }
  }
  if (given.length > 1) throw new OcrToolError('INVALID_INPUT', `一次只走一种形态，收到 ${given.join(' + ')}`)
  const mode = given[0]
  if (mode === 'doc_id') {
    if (refresh || !charts) {
      throw new OcrToolError('INVALID_INPUT', 'refresh / charts 只对 url 或 file 形态有意义', '重跑请重新传 url 或 file，并带 refresh: true')
    }
    if (limit !== undefined && query === undefined) throw new OcrToolError('INVALID_INPUT', 'limit 只在 query 形态下有意义的')
    const docId = requireDocId(args.doc_id)
    return { mode: 'read', label: docId, doc_id: docId, ...(pages === undefined ? {} : { pages }), ...(query === undefined ? {} : { query }), ...(limit === undefined ? {} : { limit }), charts, refresh }
  }
  if (pages !== undefined || query !== undefined || limit !== undefined) {
    throw new OcrToolError('INVALID_INPUT', '新解析时还没有页可读', `先拿到回执里的 doc_id，再用 { doc_id, ${pages !== undefined ? 'pages' : 'query'} } 读`)
  }
  if (mode === 'url') {
    const url = requiredString(args.url, 'url', MAX_URL_LENGTH)
    return { mode: 'url', label: url, url, charts, refresh }
  }
  const file = requiredString(args.file, 'file', 512)
  return { mode: 'file', label: file, file, charts, refresh }
}

/** 本地文档路径：剥掉 `@mention` 带进来的开头 `@`，再按后缀放行（真正的归属校验在 store）。 */
function normalizeLocalPath(value: string): string {
  const raw = value.startsWith('@') ? value.slice(1).trim() : value.trim()
  const suffix = (raw.includes('.') ? raw.slice(raw.lastIndexOf('.') + 1) : '').toLowerCase()
  if (!OCR_LOCAL_SUFFIXES.includes(suffix)) {
    throw new OcrToolError('INVALID_INPUT', `file 只接受 ${OCR_LOCAL_SUFFIXES.join('/')} 文档，收到 "${raw}"`, 'PDF 直链请改用 url 形态')
  }
  return raw
}

function pageIndex(document: OcrDocument, withHeadings: boolean): Array<Record<string, unknown>> {
  return document.pages.map((entry) => ({
    page: entry.page,
    chars: entry.chars,
    ...(withHeadings && entry.heading !== undefined ? { heading: entry.heading } : {}),
  }))
}

function fitsBudget(payload: Record<string, unknown>): boolean {
  return JSON.stringify(payload).length <= SOURCE_OUTPUT_BUDGET_CHARS
}

function echoFields(echo: RetrievalEcho): { recent_retrievals: RetrievalTrace[]; provider_tally: Record<string, number> } {
  return { recent_retrievals: echo.recent, provider_tally: echo.tally }
}

function metaFields(meta: OcrArtifactMeta, cached: boolean): Record<string, unknown> {
  return {
    provider: 'paddleocr',
    status: 'done',
    ok: true,
    doc_id: meta.doc_id,
    artifact_ref: ocrArtifactRef(meta.doc_id),
    cached,
    model: meta.model,
    created_at: meta.created_at,
    pages: meta.pages,
    chars: meta.chars,
    tables: meta.tables,
    source_kind: meta.source_kind,
    ...(meta.source === undefined ? {} : { source: meta.source }),
    ...(meta.images > 0
      ? { images: { count: meta.images, note: '上游图片链是临时地址，本仓不下载；图形内容以文字与表格呈现' } }
      : {}),
  }
}

/** 排版噪音的量化说明：证明"变小"是剥样式，不是被截断。 */
function cleanupNote(meta: OcrArtifactMeta): string | undefined {
  if (meta.style_chars_removed === 0 && meta.tables === 0) return undefined
  const parts: string[] = []
  if (meta.style_chars_removed > 0) parts.push(`已剥掉 ${meta.style_chars_removed} 个排版噪音字符`)
  if (meta.tables > 0) parts.push(`${meta.tables} 张 HTML 表已转成 markdown 表格`)
  return parts.join('；')
}

/**
 * `done` 回执的装载：整篇放得下就给全文，否则给页索引 + 第 1 页；连索引都放不下就只给
 * 边界说明。**永不半路截断**——截断的正文会被当成完整正文引用，比少给一页危险。
 */
function doneReceipt(artifact: OcrArtifact, input: { cached: boolean; elapsed_ms?: number; echo: RetrievalEcho }): Record<string, unknown> {
  const { meta, document } = artifact
  const cleanup = cleanupNote(meta)
  const base = {
    ...metaFields(meta, input.cached),
    ...(input.elapsed_ms === undefined ? {} : { elapsed_ms: input.elapsed_ms }),
    ...echoFields(input.echo),
  }
  const full = { ...base, content: document.document, content_chars: meta.chars, ...(cleanup === undefined ? {} : { note: cleanup }) }
  if (fitsBudget(full)) return full
  const index = pageIndex(document, true)
  const first = document.pages[0]
  const pageOne = first === undefined
    ? undefined
    : { page: first.page, chars: first.chars, ...(first.heading === undefined ? {} : { heading: first.heading }), text: document.document.slice(first.start, first.end) }
  const withIndex = { ...base, index, note: budgetNote(meta, cleanup, false) }
  // 判断装载用的是**那一条**note：换措辞后再测会让"放不下"变成"其实放不下"（多 3 个字符也算越界）。
  const withPageOne = pageOne === undefined ? undefined : { ...withIndex, page_one: pageOne, note: budgetNote(meta, cleanup, true) }
  if (withPageOne && fitsBudget(withPageOne)) return withPageOne
  if (fitsBudget(withIndex)) return withIndex
  const brief = { ...base, index: pageIndex(document, false) }
  if (fitsBudget(brief)) {
    return { ...brief, note: `${meta.pages} 页整篇超出预算：只给页号与字数，用 pages 或 query 取正文` }
  }
  return { ...base, note: `${meta.pages} 页超出预算，连页索引都放不下：用 pages="1-${OCR_MAX_PAGES_PER_READ}" 分段读，或用 query 定位` }
}

/**
 * 超预算时的那句说明必须**算得过来**：早先写的是"整篇 N 字符超出预算 6144"，而 5717 < 6144
 * 也是这句话——被装的从来不只是正文，还有信封与页索引。说成"正文 + 回执装不进"才是事实。
 */
function budgetNote(meta: OcrArtifactMeta, cleanup: string | undefined, withPageOne: boolean): string {
  const line = `整篇正文 ${meta.chars} 字符连同回执装不进 ${SOURCE_OUTPUT_BUDGET_CHARS} 字符预算：这里给${withPageOne ? '页索引与首页' : '页索引'}，正文用 pages 或 query 取（不再出网、不再花钱）`
  return cleanup === undefined ? line : `${line}；${cleanup}`
}

function pendingReceipt(input: {
  doc_id: string
  job_id: string
  progress?: { extracted_pages: number; total_pages: number }
  elapsed_ms: number
  echo: RetrievalEcho
}): Record<string, unknown> {
  return {
    provider: 'paddleocr',
    status: 'pending',
    ok: true,
    doc_id: input.doc_id,
    job_id: input.job_id,
    elapsed_ms: input.elapsed_ms,
    ...(input.progress === undefined ? {} : { extracted_pages: input.progress.extracted_pages, total_pages: input.progress.total_pages }),
    hint: '作业仍在跑（整篇算完才出结果，已花费这一次提交）。再调一次 ocr，**同时**传这个 job_id 与 doc_id：不会重复提交、不再花钱。',
    ...echoFields(input.echo),
  }
}

/** `pages` 形态：整页给，放不下就**整页**从尾部让路（不切半页）。 */
function pagesReceipt(input: {
  artifact: OcrArtifact
  requested: number[]
  explicit: boolean
  echo: RetrievalEcho
}): Record<string, unknown> {
  const { meta, document } = input.artifact
  const envelope = (excerpts: Array<Record<string, unknown>>, omitted: number[]) => ({
    ...metaFields(meta, true),
    ...echoFields(input.echo),
    pages_requested: input.requested,
    excerpts,
    ...(omitted.length > 0 ? { omitted_pages: omitted } : {}),
  })
  const excerpts: Array<Record<string, unknown>> = []
  let omitted: number[] = []
  for (const entry of selectPages(document, input.requested)) {
    const item: Record<string, unknown> = {
      page: entry.page,
      chars: entry.chars,
      ...(entry.heading === undefined ? {} : { heading: entry.heading }),
      text: entry.text,
    }
    // 第一条永不因预算丢弃以外的理由跳过：单页就超预算时宁可空手报错，也不给半页。
    if (!fitsBudget(envelope([...excerpts, item], []))) {
      omitted = input.requested.slice(excerpts.length)
      break
    }
    excerpts.push(item)
  }
  const notes: string[] = []
  if (!input.explicit) notes.push(`没传 pages，默认回第 1 页；全篇 ${meta.pages} 页，用 pages 或 query 继续读`)
  if (omitted.length > 0) notes.push(`预算 ${SOURCE_OUTPUT_BUDGET_CHARS} 字符：第 ${omitted.join('/')} 页未放入，单独取回或改用 query`)
  return {
    ...envelope(excerpts, omitted),
    ...(notes.length > 0 ? { note: notes.join('；') } : {}),
  }
}

/** `query` 形态：命中窗口从尾部裁，永不给出半截列表还假装完整。 */
function queryReceipt(input: { artifact: OcrArtifact; query: string; limit: number; echo: RetrievalEcho }): Record<string, unknown> {
  const { meta, document } = input.artifact
  const found = locateQuery(document, input.query, input.limit, OCR_QUERY_WINDOW_CHARS)
  const hits: Array<Record<string, unknown>> = []
  let omitted = 0
  for (const hit of found) {
    const item = { page: hit.page, excerpt: hit.excerpt }
    if (!fitsBudget({ ...metaFields(meta, true), ...echoFields(input.echo), hits: [...hits, item] })) {
      omitted = found.length - hits.length
      break
    }
    hits.push(item)
  }
  const notes = [`全篇 ${meta.pages} 页里命中 ${found.length} 处，显示 ${hits.length} 处`]
  if (omitted > 0) notes.push(`因预算省略其后 ${omitted} 处：调小 limit，或用 pages 取整页`)
  if (hits.length === 0) notes.push('没有命中不等于文档里没有这个主题：换关键词，或按 pages 通读')
  return {
    ...metaFields(meta, true),
    ...echoFields(input.echo),
    query: input.query,
    hit_count: hits.length,
    hits,
    note: notes.join('；'),
  }
}

/** 解析完成后的统一出口：落盘（内容寻址、默认不覆盖）→ 回执。 */
async function persistAndReceipt(
  deps: OcrToolDependencies,
  input: {
    session: SessionLike
    signal: AbortSignal
    doc_id: string
    source?: string
    source_kind: OcrArtifactMeta['source_kind']
    charts?: boolean
    job_id: string
    document: OcrDocument
    refresh: boolean
    elapsed_ms: number
    echo: RetrievalEcho
  },
): Promise<Record<string, unknown>> {
  const meta = buildArtifactMeta({
    doc_id: input.doc_id,
    ...(input.source === undefined ? {} : { source: input.source }),
    source_kind: input.source_kind,
    ...(input.charts === undefined ? {} : { charts: input.charts }),
    job_id: input.job_id,
    model: deps.client.model,
    document: input.document,
    createdAt: new Date((deps.now ?? Date.now)()).toISOString(),
  })
  try {
    await writeOcrArtifact(deps.store, { session: input.session, meta, document: input.document, signal: input.signal, overwrite: input.refresh })
  } catch (error) {
    // 两个会话同时在解析同一份文档：后写的撞 createIfAbsent。读回先写的那份即可——
    // 内容寻址保证两者同文，把它报成失败只是把一次成功说成错误。
    if (input.refresh) throw error
    const existing = await readOcrArtifact(deps.store, { session: input.session, doc_id: input.doc_id, signal: input.signal })
    if (!existing) throw error
    return doneReceipt(existing, { cached: true, echo: input.echo })
  }
  return doneReceipt({ meta, document: input.document }, { cached: false, elapsed_ms: input.elapsed_ms, echo: input.echo })
}

/**
 * 失败回执：`{provider, status:'error', ok:false, code, error, hint?}` + 已知的 `doc_id` /
 * `job_id` / 检索回声。
 *
 * 形态归一化（`ocrRequest`）的失败**同样**要走这里：那一层的 `hint` 是"下一步该传什么"，
 * 抛裸 `Error` 就只剩一句中文，模型照旧会再猜一次。回声此时还没有（连请求都无法指认），
 * 所以缺省不带，而不是硬编一个空标签冒充。
 *
 * `spent` 是**本次调用已经产生花费**的指认：`url`/`file` 形态的 `doc_id` 是算出来的、
 * `job_id` 是提交回来的，都不在入参里。失败时把它们交回去，模型才能走"只传 job_id + doc_id
 * 续查"那条不花钱的路；不给就等于把一次已经付费的作业丢在半路。
 */
function ocrErrorReceipt(
  error: unknown,
  input: { requested?: OcrRequest; echo?: RetrievalEcho; spent?: { doc_id?: string; job_id?: string } },
): Record<string, unknown> {
  const docId = input.requested?.doc_id ?? input.spent?.doc_id
  const jobId = input.requested?.job_id ?? input.spent?.job_id
  return {
    provider: 'paddleocr',
    status: 'error',
    ok: false,
    ...ocrFailure(error),
    ...(docId === undefined ? {} : { doc_id: docId }),
    ...(jobId === undefined ? {} : { job_id: jobId }),
    ...(input.echo === undefined ? {} : echoFields(input.echo)),
  }
}

async function runOcr(
  deps: OcrToolDependencies,
  trace: OcrTrace,
  args: Record<string, unknown>,
  exec: ToolExecLike,
): Promise<Record<string, unknown>> {
  let requested: OcrRequest
  try {
    requested = ocrRequest(args)
  } catch (error) {
    throwToolFailure(ocrErrorReceipt(error, {}))
  }
  const spent: { doc_id?: string; job_id?: string } = {}
  const echo = trace(exec, 'paddleocr', 'ocr', requested.label)
  try {
    const session = callerSession(exec)
    const signal = exec.signal
    if (requested.mode === 'read') {
      const artifact = await readOcrArtifact(deps.store, { session, doc_id: requested.doc_id as string, signal })
      if (!artifact) {
        throw new OcrToolError('DOC_NOT_FOUND', `没有 doc_id ${requested.doc_id} 的解析结果`, '先用 url 或 file 解析，或核对回执里的 doc_id')
      }
      if (requested.query !== undefined) {
        return queryReceipt({ artifact, query: requested.query, limit: requested.limit ?? OCR_DEFAULT_QUERY_LIMIT, echo })
      }
      if (requested.pages !== undefined) {
        const pages = parsePageRange(requested.pages, artifact.document.pages.length)
        if (pages.length > OCR_MAX_PAGES_PER_READ) {
          throw new OcrToolError('INVALID_INPUT', `一次最多读 ${OCR_MAX_PAGES_PER_READ} 页，收到 ${pages.length} 页`, '缩小 pages 区间，或改用 query 定位')
        }
        return pagesReceipt({ artifact, requested: pages, explicit: true, echo })
      }
      return doneReceipt(artifact, { cached: true, echo })
    }
    if (requested.mode === 'resume') {
      const docId = requested.doc_id as string
      const existing = await readOcrArtifact(deps.store, { session, doc_id: docId, signal })
      if (existing) return doneReceipt(existing, { cached: true, echo })
      const outcome = await deps.client.wait(requested.job_id as string, signal)
      if (outcome.status === 'pending' || !outcome.document) {
        return pendingReceipt({ doc_id: docId, job_id: outcome.job_id, ...(outcome.progress ? { progress: outcome.progress } : {}), elapsed_ms: outcome.elapsed_ms, echo })
      }
      return await persistAndReceipt(deps, {
        session,
        signal,
        doc_id: docId,
        source_kind: 'job',
        job_id: outcome.job_id,
        document: outcome.document,
        refresh: false,
        elapsed_ms: outcome.elapsed_ms,
        echo,
      })
    }
    // 解析形态：先算 doc_id，命中缓存就**一次都不出网**。
    const target = requested.mode === 'url'
      ? await pdfUrlTarget(requested.url as string, signal, deps.resolveAddresses)
      : await localFileTarget(deps, requested.file as string, session, signal)
    const docId = deriveOcrDocId(target.seed, deps.client.model, requested.charts)
    spent.doc_id = docId
    if (!requested.refresh) {
      const cached = await readOcrArtifact(deps.store, { session, doc_id: docId, signal })
      if (cached) return doneReceipt(cached, { cached: true, echo })
    }
    const jobId = await deps.client.submit({ ...target.submit, charts: requested.charts, signal })
    spent.job_id = jobId
    const outcome = await deps.client.wait(jobId, signal)
    if (outcome.status === 'pending' || !outcome.document) {
      return pendingReceipt({ doc_id: docId, job_id: jobId, ...(outcome.progress ? { progress: outcome.progress } : {}), elapsed_ms: outcome.elapsed_ms, echo })
    }
    return await persistAndReceipt(deps, {
      session,
      signal,
      doc_id: docId,
      source: target.source,
      source_kind: target.sourceKind,
      charts: requested.charts,
      job_id: jobId,
      document: outcome.document,
      refresh: requested.refresh,
      elapsed_ms: outcome.elapsed_ms,
      echo,
    })
  } catch (error) {
    // 取消原样抛出：那是调用方的意志，不能被降级成一条"看起来像上游坏了"的错误信封。
    if (isAbortError(error)) throw error
    throwToolFailure(ocrErrorReceipt(error, { requested, echo, spent }))
  }
}

/** 一种解析入参的三件东西：算 `doc_id` 的种子、进 meta 的指认、给上游的提交体。 */
interface OcrParseTarget {
  seed: string | Uint8Array
  source: string
  sourceKind: 'url' | 'file'
  submit: { fileUrl?: string; file?: { bytes: Uint8Array; filename: string } }
}

/**
 * `url` 形态：出口闸门复用本机直连那一份实现（形态 + 主机公网性），再收 `.pdf` 后缀。
 * 本机**不抓**这个文件——上游替我们取，所以这里没有体积上限，只有 SSRF 面。
 */
async function pdfUrlTarget(
  value: string,
  signal: AbortSignal,
  resolveAddresses?: OcrToolDependencies['resolveAddresses'],
): Promise<OcrParseTarget> {
  const url = await assertPublicUrlTarget(value, signal, resolveAddresses)
  const pathname = new URL(url).pathname
  if (!PDF_URL_SUFFIX.test(pathname)) {
    throw new OcrToolError('BLOCKED_URL', `url 指向的不是 .pdf（路径以 ${pathname.slice(-16) || '/'} 结尾）`, '上游只解析 PDF；网页正文走 web_retriever_fetch')
  }
  return { seed: `url:${url}`, source: `url:${url}`, sourceKind: 'url', submit: { fileUrl: url } }
}

/** `file` 形态：读出字节 + 指认（`source` 只记 workspace 相对路径，绝不记绝对路径）。 */
async function localFileTarget(
  deps: OcrToolDependencies,
  value: string,
  session: SessionLike,
  signal: AbortSignal,
): Promise<OcrParseTarget> {
  const path = normalizeLocalPath(value)
  const { bytes, filename } = await readOcrSourceBytes(deps.store, { session, path, signal })
  return { seed: bytes, source: `file:${path}`, sourceKind: 'file', submit: { file: { bytes, filename } } }
}

// ── 具名来源的结构化查询工具 ────────────────────────────────────────────────
//
// 与上面四个工具的关系：search / fetch 是**检索**工作面（候选发现、按 URL 取正文），
// 这里是**查询**工作面（具名来源 + 业务参数 → 确定、有序、可翻页、同参可复现的结果集）。
// 九个来源各自是一次具体实现，没有配方注册表 / 通用适配层——见 `sources.ts` 文件头。

const SOURCE_RESULT_CAP = MAX_ITEMS
const SOURCE_PAGE_SIZE_MAX = 50

/** 六个带 code 的工具共用这一句"能写什么"，描述的写法与校验的实现因此不会各说各话。 */
const CODE_FORMS = '（也可写 SH600519 / 600519.SH，会归一化成 6 位）'

/**
 * 一次具名来源输出的字符预算：取宿主 tool-result 剪枝阈值的 75%。
 * 阈值配在 `preset/capital-generation/agent.cordis.yml` 的 `thresholdChars: 8192`
 * （由 `test/persona.test.mjs` 钉住与本常量同源）。超过阈值的工具结果在会话历史里会被
 * `dsh-compaction-tool-result-pruner` 换成 head 4096 + `[... middle pruned ...]` + tail 1024，
 * 也就是**中间条目被无声吃掉**，而留在头部的 `count` 还写着原来的条数。
 * 留 25% 余量的做法与数据面能力目录的预算同一口径（`test/data-collector-hub.test.mjs`）。
 */
export const SOURCE_OUTPUT_BUDGET_CHARS = 6144

/** 预算里为"承认省略了几条"那句话预留的体积：不预留的话，加上这句话反而会再次越界。 */
const TRUNCATION_NOTE_RESERVE = 200

function sourceOutput(outcome: SourceOutcome, recent: RetrievalTrace[], tally: Record<string, number>): Record<string, unknown> {
  const candidates = outcome.items.slice(0, SOURCE_RESULT_CAP)
  const envelope = (items: SourceItem[], omitted: number) => {
    const notes = outcome.note === undefined ? [] : [outcome.note]
    if (omitted > 0) {
      notes.push(`输出预算 ${SOURCE_OUTPUT_BUDGET_CHARS} 字符：本次只放了前 ${items.length} 条，省略其后 ${omitted} 条${
        outcome.next_cursor === undefined ? '（请缩小 limit 或翻页重查）' : '（用 next_cursor 继续翻页）'}`)
    }
    return {
      provider: outcome.source,
      operation: outcome.operation,
      ok: true as const,
      count: items.length,
      ...(outcome.next_cursor !== undefined ? { next_cursor: outcome.next_cursor } : {}),
      ...(notes.length > 0 ? { note: notes.join('；') } : {}),
      items,
      recent_retrievals: recent,
      provider_tally: tally,
    }
  }
  // 按上游顺序**从尾部裁**，不跳着放：跳着放会让"同参数同结果"失效，count 也不再是前缀长度。
  let taken = 0
  let used = JSON.stringify(envelope([], 0)).length + TRUNCATION_NOTE_RESERVE
  for (const item of candidates) {
    const cost = JSON.stringify(item).length + (taken > 0 ? 1 : 0)
    if (taken > 0 && used + cost > SOURCE_OUTPUT_BUDGET_CHARS) break
    used += cost
    taken += 1
  }
  let items = candidates.slice(0, taken)
  let payload = envelope(items, candidates.length - items.length)
  // 兜底自检：算术里已经预留了截断说明的体积，真超了（note 本身很长）就再退一条，
  // 宁可少一条也不把整份结果交给剪枝器切成头尾两截。
  while (items.length > 1 && JSON.stringify(payload).length > SOURCE_OUTPUT_BUDGET_CHARS) {
    items = items.slice(0, -1)
    payload = envelope(items, candidates.length - items.length)
  }
  return payload
}

/**
 * 失败也做成**工具错误**（`isError`），与 `web_retriever_fetch` 同一口径：
 * 宿主用 `isError` 表达失败，正常返回无法标记失败（见 `throwToolFailure` 注释）。
 * 抛出的消息带完整结构化回执，`recent_retrievals` / `provider_tally` 一个不丢。
 */
function throwSourceFailure(source: SourceId, operation: string, error: unknown, recent: RetrievalTrace[], tally: Record<string, number>): never {
  const code = error instanceof SourceError ? error.code : 'NETWORK'
  throwToolFailure({
    provider: source,
    operation,
    ok: false,
    code,
    error: error instanceof Error ? error.message : String(error),
    recent_retrievals: recent,
    provider_tally: tally,
  })
}

function sourceItemsText(items: SourceItem[]): string {
  return items.length === 0 ? '（0 条）' : `${items.length} 条`
}

/**
 * 注册九个具名来源工具（provider + operation 命名）。
 *
 * 为什么单独一个注册函数：这九个工具只依赖 HTTP 传输（`local-fetch` 的出口校验），
 * 不依赖 AnySearch / Wind；任何一路的配置缺失都不应连带影响另外几路的注册。
 *
 * `enabled`（设置卡片「允许启动本地提取网页内容」）**同时支配这九个工具的执行**：
 * 关闭时工具仍在注册面（不静默消失），但每次调用响亮失败并说明开关位置——
 * 卡片文案的字面语义对模型与用户都成立，用户同意不被旁路。
 */
export function registerSourceTools(ctx: Context, localFetchOptions: LocalFetchOptions & { enabled?: boolean }): void {
  const tools = ctx.get('tools') as ToolRuntimeLike | undefined
  if (!tools) return

  const echo = createRetrievalEcho()
  const transport = createSourceTransport(localFetchOptions)
  // 东财系三个工具（7×24 快讯 / 个股新闻 / 研报）**共用同一个节流器**：它们打到同一个上游、
  // 共用主机的出口 IP，各自限流等于没限（详见 `src/net/eastmoney-client.ts`）。
  // 与数据面共享**同一份进程级节流**（`sharedEastmoneyThrottle()`），但 transport 注入
  // 闸门实现（`createHttpRequester`）：出口校验、逐跳重定向重校验、大小/超时上限与其余
  // 六个来源同一份（此前走裸 fetch，是"声称一份、实际两份"的事故形态，AGENTS.md §9.7）。
  const eastmoneyClient = createEastmoneyClient({
    userAgent: localFetchOptions.userAgent,
    throttle: sharedEastmoneyThrottle(),
    transport: createGatedEastmoneyTransport(transport),
  })
  const trace = (exec: ToolExecLike, provider: SourceId, tool: string, query: string) =>
    echo(exec, { provider, tool, query, at: Date.now() })

  const itemsProperties = {
    type: 'array',
    description: '按上游返回顺序排列的条目；字段随 operation 不同，含时间与来源链接',
    items: { type: 'object', additionalProperties: true },
  }
  const envelope = (properties: Record<string, unknown>) => ({
    type: 'object',
    additionalProperties: true,
    properties: {
      provider: { type: 'string' },
      operation: { type: 'string' },
      ok: { type: 'boolean' },
      count: { type: 'integer' },
      items: itemsProperties,
      ...properties,
      recent_retrievals: { type: 'array' },
      provider_tally: { type: 'object' },
    },
  })

  async function run(
    exec: ToolExecLike,
    provider: SourceId,
    operation: string,
    label: string,
    produce: () => Promise<SourceOutcome>,
  ): Promise<Record<string, unknown>> {
    const { recent, tally } = trace(exec, provider, `${provider}_${operation}`, label)
    if (localFetchOptions.enabled === false) {
      throwSourceFailure(provider, operation, new SourceError(provider, 'DISABLED',
        '本机直连已被设置关闭（卡片「允许启动本地提取网页内容」）；本工具全部条目都需本机 HTTP，开关打开后新会话可用'), recent, tally)
    }
    let outcome: SourceOutcome
    try {
      outcome = await produce()
    } catch (error) {
      // 调用方取消**原样抛出**，绝不降级成失败信封：取消不是"这个来源查不到"，
      // 而把它写成 ok:false 会让上层以为来源失败（与 web_retriever_fetch 同口径）。
      // 传输层抛的是 `LocalFetchError('ABORTED')`，来源层抛的是 `SourceError('ABORTED')`。
      const code = error instanceof SourceError ? error.code : (error as { code?: string })?.code
      if (code === 'ABORTED' || (error instanceof Error && error.name === 'AbortError')) throw error
      throwSourceFailure(provider, operation, error, recent, tally)
    }
    return sourceOutput(outcome, recent, tally)
  }

  const definitions = [
    {
      name: 'cls_telegraph',
      description: '取财联社 7×24 全市场快讯（直连 cls.cn v1 接口，签名由本工具本地计算，零 key）。这是**确定性来源查询**而非检索：返回最近 limit 条快讯，含时间、标题、正文与原文链接。财联社是媒体来源，内容只能作为「媒体转述旁证」，不得标 verified_official；官方公告请用 wind_docs_announcements。与 wscn_lives / wind_docs_news 互为独立备份。',
      parameters: jsonObject({
        limit: { type: 'integer', description: '可选，返回快讯条数 1~50，默认 20' },
      }, []),
      output: { schema: envelope({}), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const limit = integer(args.limit, 'limit', 1, SOURCE_RESULT_CAP) ?? 20
        return run(exec, 'cls', 'telegraph', `limit=${limit}`, () =>
          clsTelegraph(transport, { limit, signal: exec.signal }))
      },
    },
    {
      name: 'wscn_lives',
      description: '取华尔街见闻 7×24 快讯（确定性来源查询，按频道 + 游标翻页）。channel 常用 global-channel（要闻）/ a-stock-channel（A 股）；importance 取见闻的 score 字段（实测 1~3，越大越重要）。时间为北京时间。翻页把回执的 next_cursor 原样传回 cursor。媒体来源，只能作为「媒体转述旁证」，不得标 verified_official。',
      parameters: jsonObject({
        channel: { type: 'string', description: '频道名，形如 global-channel / a-stock-channel' },
        limit: { type: 'integer', description: '可选，返回条数 1~50，默认 20' },
        cursor: { type: 'string', description: '可选，上一页回执里的 next_cursor' },
      }, ['channel']),
      output: { schema: envelope({ next_cursor: { type: 'string' } }), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const channel = requiredString(args.channel, 'channel', 64)
        if (!/^[a-z0-9-]+-channel$/u.test(channel)) throw new Error("channel must look like 'global-channel' / 'a-stock-channel'")
        const limit = integer(args.limit, 'limit', 1, SOURCE_RESULT_CAP) ?? 20
        const cursor = args.cursor === undefined ? undefined : requiredString(args.cursor, 'cursor', 64)
        return run(exec, 'wscn', 'lives', `channel=${channel} limit=${limit}`, () =>
          wscnLives(transport, { channel, limit, ...(cursor === undefined ? {} : { cursor }), signal: exec.signal }))
      },
    },
    {
      name: 'cninfo_irm',
      description: '取巨潮「互动易」投资者问答（深市专用）：投资者提问 + 公司回复。用于回答"公司怎么回应某传闻/关切"。code 传 6 位股票代码。status=answered 表示公司已回复（answer 有正文），unanswered 表示尚未回复——这是事实而非缺口。实测沪市公司返回 0 条，沪市请用 sseinfo_qa；北交所两个平台都没有。上游返回空表时 note 会写明覆盖范围。',
      parameters: jsonObject({
        code: { type: 'string', description: `6 位股票代码（深市）${CODE_FORMS}` },
        page_size: { type: 'integer', description: `可选，每页条数 1~${SOURCE_PAGE_SIZE_MAX}，默认 20` },
        page_num: { type: 'integer', description: '可选，页码从 1 开始' },
      }, ['code']),
      output: { schema: envelope({}), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const code = bareAshareDigits(args.code)
        const pageSize = integer(args.page_size, 'page_size', 1, SOURCE_PAGE_SIZE_MAX) ?? 20
        const pageNum = integer(args.page_num, 'page_num', 1, 1000) ?? 1
        return run(exec, 'cninfo_irm', 'questions', `code=${code} page=${pageNum}`, () =>
          cninfoIrm(transport, { code, pageSize, pageNum, signal: exec.signal }))
      },
    },
    {
      name: 'sseinfo_qa',
      description: '取上交所「上证e互动」投资者问答（沪市专用）。不传 code = 全市场最新问答；传沪市代码（60/68/900 开头）= 该公司问答。kind=answered 取最新已回复，kind=questions 取最新提问（含未回复，status=unanswered）。平台只开放近期问答（公司维度实测约近 1 个月），更早的翻页为空属正常。首次查某公司要先在公司列表里定位 uid（上游约 10–13 次请求，之后进程内缓存；整段定位有 60 秒总时限，超时回 code=TIMEOUT——那是上游慢，不是这次调用被取消，隔一会儿再试或先查全市场）。深市问答请改用 cninfo_irm。',
      parameters: jsonObject({
        code: { type: 'string', description: `可选，沪市 6 位代码${CODE_FORMS}` },
        kind: { type: 'string', enum: ['answered', 'questions'], description: '可选，answered=最新已回复（默认）/ questions=最新提问' },
        page: { type: 'integer', description: '可选，页码从 1 开始' },
        page_size: { type: 'integer', description: `可选，每页条数 1~${SOURCE_PAGE_SIZE_MAX}，默认 10` },
      }, []),
      output: { schema: envelope({}), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const code = args.code === undefined ? undefined : bareAshareDigits(args.code)
        const kind = args.kind === undefined ? 'answered' : requiredString(args.kind, 'kind', 16)
        if (kind !== 'answered' && kind !== 'questions') throw new Error("kind must be 'answered' or 'questions'")
        const page = integer(args.page, 'page', 1, 1000) ?? 1
        const pageSize = integer(args.page_size, 'page_size', 1, SOURCE_PAGE_SIZE_MAX) ?? 10
        return run(exec, 'sseinfo', code === undefined ? `market_${kind}` : `company_${kind}`, code === undefined ? `kind=${kind}` : `code=${code} kind=${kind}`, () =>
          sseinfoQa(transport, { ...(code === undefined ? {} : { code }), kind, page, pageSize, signal: exec.signal }))
      },
    },
    {
      name: 'eastmoney_724',
      description: '取东方财富 7×24 全球财经快讯（确定性来源查询）。与 cls_telegraph / wscn_lives 是三条独立来源，互为备份（不同源、不同风控面，一条不可用另一条仍在）。返回时间/标题/摘要/链接。注意：东财会把它聚合到的财联社内容一并返回，同一事件可能与其他来源重复，按标题去重。媒体来源，只能作旁证，不得标 verified_official。',
      parameters: jsonObject({
        limit: { type: 'integer', description: '可选，返回条数 1~50，默认 20' },
      }, []),
      output: { schema: envelope({}), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const limit = integer(args.limit, 'limit', 1, SOURCE_RESULT_CAP) ?? 20
        return run(exec, 'eastmoney', 'fast_news', `limit=${limit}`, () =>
          eastmoneyFastNews(eastmoneyClient, { limit, signal: exec.signal }))
      },
    },
    {
      name: 'eastmoney_stock_news',
      description: '取某只股票的东方财富新闻列表（确定性来源查询，按 6 位代码）。用于"这只票最近有什么新闻"。回执含时间/标题/正文片段/媒体/链接。⚠️ 上游对部分 IP 会间歇风控，此时只返回股民资料而无文章列表——本工具按"文章列表键是否存在"区分，报错说明是风控而非"该股没有新闻"；遇到该错误隔几分钟或换网络再试，不要重试同一路径。媒体来源，只能作旁证。',
      parameters: jsonObject({
        code: { type: 'string', description: `6 位股票代码${CODE_FORMS}` },
        limit: { type: 'integer', description: '可选，返回条数 1~50，默认 20' },
      }, ['code']),
      output: { schema: envelope({}), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const code = bareAshareDigits(args.code)
        const limit = integer(args.limit, 'limit', 1, SOURCE_RESULT_CAP) ?? 20
        return run(exec, 'eastmoney', 'stock_news', `code=${code} limit=${limit}`, () =>
          eastmoneyStockNews(eastmoneyClient, { code, limit, signal: exec.signal }))
      },
    },
    {
      name: 'eastmoney_reports',
      description: '取个股研报列表（东财研报库，按 6 位代码；上游只认纯数字——实测带 SH/SZ 前缀返回 0 条，所以 `SH600519` / `600519.SH` 这类写法由本工具先归一化成 6 位再查）。返回日期/标题/机构/研究员/评级/评级变动与该篇研报的当年预测 EPS，并给出每条的 `pdf_url`（研报 PDF 直链）与 `attach_pages`。⚠️ 列表**不含摘要**：正文只在 PDF 里，`web_retriever_fetch` 拿到 PDF 会失败（本机直连只处理文本），要正文把那条 `pdf_url` 交 `ocr` 解析。`ocr` 也不可用时才如实说明该边界，**不得用标题当结论**。券商观点属第三方预测，不是官方事实，回传时标注机构名与发布日期。',
      parameters: jsonObject({
        code: { type: 'string', description: `6 位股票代码${CODE_FORMS}` },
        page_size: { type: 'integer', description: '可选，每页条数 1~50，默认 20' },
        page: { type: 'integer', description: '可选，页码从 1 开始' },
      }, ['code']),
      output: { schema: envelope({ next_cursor: { type: 'string' } }), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const code = bareAshareDigits(args.code)
        const pageSize = integer(args.page_size, 'page_size', 1, SOURCE_RESULT_CAP) ?? 20
        const pageNo = integer(args.page, 'page', 1, 1000) ?? 1
        return run(exec, 'eastmoney', 'reports', `code=${code} page=${pageNo}`, () =>
          eastmoneyReports(eastmoneyClient, { code, pageSize, pageNo, signal: exec.signal }))
      },
    },
    {
      name: 'sina_reports',
      description: '取新浪研报列表（研报第二来源，与 eastmoney_reports 互为备份）。不传 code 取全市场最新一页（约 40 条）；传 6 位代码只看该股（本工具会自动补交易所前缀——实测缺前缀时科创板会返回假空页）。只给标题/类型/日期/机构/研究员/详情页链接，**不含评级与目标价**（需要这些用 eastmoney_reports）。上游空页是 HTTP 200 且与"确实没有研报"同形，本工具已按行数与空页提示双重判定区分。',
      parameters: jsonObject({
        code: { type: 'string', description: `可选，6 位股票代码；省略则取全市场最新${CODE_FORMS}` },
        page: { type: 'integer', description: '可选，页码从 1 开始' },
      }, []),
      output: { schema: envelope({}), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const code = args.code === undefined ? undefined : bareAshareDigits(args.code)
        const page = integer(args.page, 'page', 1, 1000) ?? 1
        return run(exec, 'sina', code === undefined ? 'latest' : 'by_stock', code === undefined ? `page=${page}` : `code=${code} page=${page}`, () =>
          sinaReports(transport, { ...(code === undefined ? {} : { code }), page, signal: exec.signal }))
      },
    },
    {
      name: 'ths_eps_forecast',
      description: '取同花顺「机构一致预期 EPS」表（按 6 位代码）。每年一行：预测机构数 / 最小值 / **均值（即机构一致预期 EPS）** / 最大值 / 行业平均。用于"机构预计明年 EPS 多少、有几家机构在预测"。⚠️ 预测机构数偏少（<3 家）时一致预期参考价值有限，须把 institutions 一并向用户披露；这是一致预期（观点聚合），不是官方事实，也不是已实现业绩。',
      parameters: jsonObject({
        code: { type: 'string', description: `6 位股票代码${CODE_FORMS}` },
      }, ['code']),
      output: { schema: envelope({}), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const code = bareAshareDigits(args.code)
        return run(exec, 'ths', 'eps_forecast', `code=${code}`, () =>
          thsEpsForecast(transport, { code, signal: exec.signal }))
      },
    },
  ]

  for (const definition of definitions) {
    ctx.effect(() => tools.register(definition), `capital-generation.tool(${definition.name})`)
  }
}
