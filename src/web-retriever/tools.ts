import type { Context } from '@deepseek-ai/cordis'
import { WebRetriever } from './retriever.js'
import type { WindCallResult, WindClient } from './wind-client.js'
import {
  MAX_ITEMS,
  SourceError,
  clsTelegraph,
  cninfoIrm,
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
import { sharedEastmoneyClient } from '../net/eastmoney-client.js'

interface ToolRuntimeLike { register(definition: unknown): () => void }
interface ToolExecLike {
  signal: AbortSignal
  /** 官方注入的调用方 session（recent_retrievals 回声按调用方 session 隔离）。 */
  agent?: { session?: { id?: string } }
}

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
 * 精准）两工具。wind 工具无条件注册——Key 缺失/服务不可用只影响调用结果（错误信封），
 * 不影响工具注册与子 Agent 创建。
 */
export function registerWebRetrieverTools(ctx: Context, retriever: WebRetriever, windClient: WindClient): void {
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
  ]

  for (const definition of definitions) {
    ctx.effect(() => tools.register(definition), `capital-generation.tool(${definition.name})`)
  }
}

// ── 具名来源的结构化查询工具 ────────────────────────────────────────────────
//
// 与上面四个工具的关系：search / fetch 是**检索**工作面（候选发现、按 URL 取正文），
// 这里是**查询**工作面（具名来源 + 业务参数 → 确定、有序、可翻页、同参可复现的结果集）。
// 九个来源各自是一次具体实现，没有配方注册表 / 通用适配层——见 `sources.ts` 文件头。

const SOURCE_RESULT_CAP = MAX_ITEMS
const SOURCE_PAGE_SIZE_MAX = 50

function sourceOutput(outcome: SourceOutcome, recent: RetrievalTrace[], tally: Record<string, number>): Record<string, unknown> {
  const items: SourceItem[] = outcome.items.slice(0, SOURCE_RESULT_CAP)
  return {
    provider: outcome.source,
    operation: outcome.operation,
    ok: true as const,
    count: items.length,
    ...(outcome.next_cursor !== undefined ? { next_cursor: outcome.next_cursor } : {}),
    ...(outcome.note !== undefined ? { note: outcome.note } : {}),
    items,
    recent_retrievals: recent,
    provider_tally: tally,
  }
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
 */
export function registerSourceTools(ctx: Context, localFetchOptions: LocalFetchOptions): void {
  const tools = ctx.get('tools') as ToolRuntimeLike | undefined
  if (!tools) return

  const echo = createRetrievalEcho()
  const transport = createSourceTransport(localFetchOptions)
  // 东财系三个工具（7×24 快讯 / 个股新闻 / 研报）**共用同一个节流器**：它们打到同一个上游、
  // 共用主机的出口 IP，各自限流等于没限（详见 sources.ts 的 EASTMONEY_MIN_INTERVAL_MS 注释）。
  // 东财系三个工具走**进程级共享**的东财客户端（`src/net/eastmoney-client.ts`）：
  // 节流器只有一份，和数据面（Hub 侧的 eastmoney_* 能力）共用同一个速率，避免同一 IP 两套限流。
  const eastmoneyClient = sharedEastmoneyClient()
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
        code: { type: 'string', description: '6 位股票代码（深市）' },
        page_size: { type: 'integer', description: `可选，每页条数 1~${SOURCE_PAGE_SIZE_MAX}，默认 20` },
        page_num: { type: 'integer', description: '可选，页码从 1 开始' },
      }, ['code']),
      output: { schema: envelope({}), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const code = requiredString(args.code, 'code', 6)
        if (!/^\d{6}$/u.test(code)) throw new Error('code must be a 6-digit stock code')
        const pageSize = integer(args.page_size, 'page_size', 1, SOURCE_PAGE_SIZE_MAX) ?? 20
        const pageNum = integer(args.page_num, 'page_num', 1, 1000) ?? 1
        return run(exec, 'cninfo_irm', 'questions', `code=${code} page=${pageNum}`, () =>
          cninfoIrm(transport, { code, pageSize, pageNum, signal: exec.signal }))
      },
    },
    {
      name: 'sseinfo_qa',
      description: '取上交所「上证e互动」投资者问答（沪市专用）。不传 code = 全市场最新问答；传沪市代码（60/68/900 开头）= 该公司问答。kind=answered 取最新已回复，kind=questions 取最新提问（含未回复，status=unanswered）。平台只开放近期问答（公司维度实测约近 1 个月），更早的翻页为空属正常。首次查某公司要先在公司列表里定位 uid（上游约 10–13 次请求，之后进程内缓存）。深市问答请改用 cninfo_irm。',
      parameters: jsonObject({
        code: { type: 'string', description: '可选，沪市 6 位代码；省略则取全市场' },
        kind: { type: 'string', enum: ['answered', 'questions'], description: '可选，answered=最新已回复（默认）/ questions=最新提问' },
        page: { type: 'integer', description: '可选，页码从 1 开始' },
        page_size: { type: 'integer', description: `可选，每页条数 1~${SOURCE_PAGE_SIZE_MAX}，默认 10` },
      }, []),
      output: { schema: envelope({}), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const code = args.code === undefined ? undefined : requiredString(args.code, 'code', 6)
        if (code !== undefined && !/^\d{6}$/u.test(code)) throw new Error('code must be a 6-digit stock code')
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
        code: { type: 'string', description: '6 位股票代码' },
        limit: { type: 'integer', description: '可选，返回条数 1~50，默认 20' },
      }, ['code']),
      output: { schema: envelope({}), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const code = requiredString(args.code, 'code', 6)
        if (!/^\d{6}$/u.test(code)) throw new Error('code must be a 6-digit stock code')
        const limit = integer(args.limit, 'limit', 1, SOURCE_RESULT_CAP) ?? 20
        return run(exec, 'eastmoney', 'stock_news', `code=${code} limit=${limit}`, () =>
          eastmoneyStockNews(eastmoneyClient, { code, limit, signal: exec.signal }))
      },
    },
    {
      name: 'eastmoney_reports',
      description: '取个股研报列表（东财研报库，按纯 6 位代码；带 SH/SZ 前缀会返回 0 条，本工具会先归一化）。返回日期/标题/机构/研究员/评级/评级变动与该篇研报的当年预测 EPS。⚠️ 列表不含摘要，正文在 PDF 里，而本机直连只处理文本（PDF 会被拒）——**web_retriever 拿不到研报正文**，需要正文请如实说明该边界，不得用标题当结论。券商观点属第三方预测，不是官方事实，回传时标注机构名与发布日期。',
      parameters: jsonObject({
        code: { type: 'string', description: '6 位股票代码' },
        page_size: { type: 'integer', description: '可选，每页条数 1~50，默认 20' },
        page: { type: 'integer', description: '可选，页码从 1 开始' },
      }, ['code']),
      output: { schema: envelope({ next_cursor: { type: 'string' } }), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const code = requiredString(args.code, 'code', 6)
        if (!/^\d{6}$/u.test(code)) throw new Error('code must be a 6-digit stock code')
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
        code: { type: 'string', description: '可选，6 位股票代码；省略则取全市场最新' },
        page: { type: 'integer', description: '可选，页码从 1 开始' },
      }, []),
      output: { schema: envelope({}), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const code = args.code === undefined ? undefined : requiredString(args.code, 'code', 6)
        if (code !== undefined && !/^\d{6}$/u.test(code)) throw new Error('code must be a 6-digit stock code')
        const page = integer(args.page, 'page', 1, 1000) ?? 1
        return run(exec, 'sina', code === undefined ? 'latest' : 'by_stock', code === undefined ? `page=${page}` : `code=${code} page=${page}`, () =>
          sinaReports(transport, { ...(code === undefined ? {} : { code }), page, signal: exec.signal }))
      },
    },
    {
      name: 'ths_eps_forecast',
      description: '取同花顺「机构一致预期 EPS」表（按 6 位代码）。每年一行：预测机构数 / 最小值 / **均值（即机构一致预期 EPS）** / 最大值 / 行业平均。用于"机构预计明年 EPS 多少、有几家机构在预测"。⚠️ 预测机构数偏少（<3 家）时一致预期参考价值有限，须把 institutions 一并向用户披露；这是一致预期（观点聚合），不是官方事实，也不是已实现业绩。',
      parameters: jsonObject({
        code: { type: 'string', description: '6 位股票代码' },
      }, ['code']),
      output: { schema: envelope({}), render },
      async execute(args: Record<string, unknown>, exec: ToolExecLike) {
        const code = requiredString(args.code, 'code', 6)
        if (!/^\d{6}$/u.test(code)) throw new Error('code must be a 6-digit stock code')
        return run(exec, 'ths', 'eps_forecast', `code=${code}`, () =>
          thsEpsForecast(transport, { code, signal: exec.signal }))
      },
    },
  ]

  for (const definition of definitions) {
    ctx.effect(() => tools.register(definition), `capital-generation.tool(${definition.name})`)
  }
}
