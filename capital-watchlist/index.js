/**
 * `@v587d/capital-watchlist` 的 host half。
 *
 * 用户自选股是**宿主级（跨 workspace）的用户侧资产**：清单与报价快照住在官方
 * `storage-domain` 域 `capital_watchlist`（`~/.dsh/storages/capital_watchlist.json`），
 * 浏览器半边经 `/capital-watchlist/*` 读写。出网只由用户动作触发（开面板一次 + 手动
 * 刷新按钮），没有轮询、没有定时器、没有自动重试。
 *
 * 三条纪律在这里落地：
 *  - ⛔ 认证围栏与 `/capital-charts` 同一写法（`connection.requestRejection`）——
 *    不接就是"任何本机进程凭路径即可读写用户的自选股"。
 *  - 出网复用 `lib/sources/fuyao-core.js`（**同一份实现**，AGENTS.md §9.7）；key 引用名
 *    从 `capital-config` 卡片读，不硬编码 `FUYAO_API_KEY`。
 *  - 报价按 `asset_type` 分流；ETF 上游只接受单只（实测 `code=1002`），所以逐只扇出，
 *    规模由清单上限钉死。
 */
import z from 'zod'
import { DEFAULT_FUYAO_BASE_URL, FuyaoError, fuyaoItems, fuyaoQuery, fuyaoRequest, fuyaoTimestamp } from '../lib/sources/fuyao-core.js'

export const name = 'capital-watchlist'

export const ROUTE_PATH = '/capital-watchlist'
/**
 * 域名走 storage 的 **unit name** 规则：`UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/`
 * （`@deepseek-ai/dsh-storage`），**连字符会被拒**——实测报
 * `malformed-medium：invalid unit name 'capital-watchlist'`。所以路由叫
 * `/capital-watchlist`，域却叫 `capital_watchlist`，落盘
 * `~/.dsh/storages/capital_watchlist.json`。这不是风格问题，是上游硬约束。
 */
export const DOMAIN_NAME = 'capital_watchlist'
/** 清单条目上限：既是 ETF 逐只扇出的规模上限，也约束 `single` 布局的整写体积。 */
export const MAX_ITEMS = 10
/** 搜索候选上限：倒逼用户缩小输入，不做分页。 */
export const SEARCH_LIMIT = 10
/** 本版标的范围（Fuyao 与报价端点双端都有可靠支撑）；场外基金 / 北交所不进候选。 */
export const SEARCH_ASSET_TYPES = 'a-share,a-share-index,fund-etf'
const ASSET_TYPES = ['a-share', 'a-share-index', 'fund-etf']
const EXCHANGES = ['SH', 'SZ']
const SEARCH_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 65_536
const MAX_QUERY_LENGTH = 64
/** 与 `capital-config` 卡片同一条目 id：0.1.7 起 settings 命名空间恒等于 profile 条目 id。 */
const CAPITAL_CONFIG_ENTRY_ID = 'capital-config'
const DEFAULT_CREDENTIAL_REF = 'FUYAO_API_KEY'

const ENDPOINTS = {
  search: '/api/meta/tickers/search',
  stock: '/api/a-share/prices/snapshot',
  index: '/api/a-share-index/prices/snapshot',
  fund: '/api/fund/market/snapshot',
}

/**
 * 播种条目：主要沪深指数，`thscode` 用 Fuyao 的规范化形态（带后缀），报价走 `index`
 * 端点。四条均已用 2026-09-28 真报文验证有值（`last_price` / `price_change_ratio_pct`）。
 */
export const SEED_ITEMS = [
  { thscode: '000001.SH', ticker: '000001', name: '上证指数', exchange: 'SH', asset_type: 'a-share-index' },
  { thscode: '399001.SZ', ticker: '399001', name: '深证成指', exchange: 'SZ', asset_type: 'a-share-index' },
  { thscode: '399006.SZ', ticker: '399006', name: '创业板指', exchange: 'SZ', asset_type: 'a-share-index' },
  { thscode: '000300.SH', ticker: '000300', name: '沪深300', exchange: 'SH', asset_type: 'a-share-index' },
]

const quoteSchema = z.object({
  price: z.number(),
  change_pct: z.number(),
  captured_at: z.number().int(),
  source_ts: z.number().int().nullable(),
})

const itemSchema = z.object({
  thscode: z.string().regex(/^\d{6}\.(SH|SZ)$/u),
  ticker: z.string().min(1),
  name: z.string().min(1),
  exchange: z.enum(EXCHANGES),
  asset_type: z.enum(ASSET_TYPES),
  added_at: z.number().int(),
  source: z.enum(['seed', 'user']),
  quote: quoteSchema.nullable(),
  /**
   * 置顶时刻（用户动作写入；缺省 = 未置顶，读法见 `rowsOf`）。
   * **可选是刻意的**：磁盘上已有的 v1 记录没有这一格，写成必填会把整份清单判成
   * `invalid-record`（域在加载边界逐条校验，读一次就 `store_unavailable`），而新写的记录
   * 永远带它——两个方向的兼容因此都不需要迁移、也不需要抬 domain version。
   */
  pinned_at: z.number().int().optional(),
})

/**
 * 域声明。`defineDomain` 只是同一个 spec 的恒等校验器，host 半边因此不 import dsh 的
 * 运行时包、只 import `zod`——与 `capital-config` 只 import schemastery 是同一条纪律
 * （少一个上游耦合面；域名与版本号由下面的常量与 schema 自己保证）。
 */
export const domainSpec = {
  name: DOMAIN_NAME,
  version: 1,
  layout: 'single',
  global: {
    schema: z.object({ seeded_at: z.number().int(), schema: z.literal(1) }),
    // `seeded_at: 0` = 从未播种。用户删空后不重建，靠的就是这个非 0 的戳。
    initial: { seeded_at: 0, schema: 1 },
  },
  tables: { items: { valueSchema: itemSchema } },
}

/** 规范化 `thscode`：trim + 大写；只接受 6 位数字 + `.SH`/`.SZ`（裸代码一律拒绝）。 */
export function normalizeThscode(value) {
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim().toUpperCase()
  return /^\d{6}\.(SH|SZ)$/u.test(cleaned) ? cleaned : undefined
}

/**
 * `FuyaoError.kind` → 本路由自己的错误码。`perItem` 决定"这个标的取不到"还是"服务不通"：
 * 逐条失败绝不能升格成整批失败，整批失败也绝不能伪装成某一条的缺口。
 */
export function watchlistErrorCode(error, { perItem = false } = {}) {
  if (!(error instanceof FuyaoError)) return perItem ? 'quote_unavailable' : 'fuyao_unavailable'
  switch (error.kind) {
    case 'credential_missing':
      return 'credential_missing'
    case 'rate_limited':
      return 'rate_limited'
    case 'invalid_parameter':
      return perItem ? 'quote_unavailable' : 'invalid_query'
    case 'capability_closed':
    case 'http_error':
    case 'upstream_error':
    default:
      return perItem ? 'quote_unavailable' : 'fuyao_unavailable'
  }
}

/**
 * 清单读法（KvTable 只有 `entries()`，没有 `values()`）+ 置顶排序，**只有这一份实现**：
 * 带 `pinned_at` 的排前面（后置顶的在前），其余保持表里的插入顺序（用原始下标兜底，
 * 比较稳定）。持久化文件里的键序**不动**——顺序是"读"出来的，不是"写"进去的：
 * 官方单文件后端是 Map，`put` 已有键保留原位置，靠删了重插来改顺序会把整份 JSON 写 N 遍。
 */
function rowsOf(table) {
  return [...table.entries()]
    .map(([, value], index) => ({ value, index }))
    .sort((left, right) => {
      const a = left.value.pinned_at ?? null
      const b = right.value.pinned_at ?? null
      if (a !== null && b !== null && a !== b) return b - a
      if (a !== null && b === null) return -1
      if (a === null && b !== null) return 1
      return left.index - right.index
    })
    .map((entry) => entry.value)
}

function candidateOf(row) {
  const thscode = typeof row.thscode === 'string' ? row.thscode : ''
  return {
    thscode,
    ticker: typeof row.ticker === 'string' && row.ticker.length > 0 ? row.ticker : thscode.split('.')[0],
    name: typeof row.name === 'string' && row.name.length > 0 ? row.name : thscode,
    exchange: typeof row.exchange === 'string' && row.exchange.length > 0 ? row.exchange.toUpperCase() : (thscode.split('.')[1] ?? ''),
    asset_type: typeof row.asset_type === 'string' ? row.asset_type : '',
  }
}

function quoteOf(row, sourceTs, capturedAt) {
  const price = typeof row.last_price === 'number' ? row.last_price : Number(row.last_price)
  if (!Number.isFinite(price)) return undefined
  const pct = typeof row.price_change_ratio_pct === 'number' ? row.price_change_ratio_pct : Number(row.price_change_ratio_pct)
  return {
    price,
    change_pct: Number.isFinite(pct) ? pct : 0,
    captured_at: capturedAt,
    source_ts: typeof sourceTs === 'number' ? sourceTs : null,
  }
}

/**
 * 自选股服务本体：域打开、key 解析、Fuyao base URL 全部注入，于是 store / route / 出网
 * 三组断言都不必碰真实文件系统与真实网络。
 *
 * @param options.openDomain - `() => Promise<Domain>`（host 里是 `storageDomain.open`）。
 * @param options.resolveApiKey - `(ref: string) => Promise<string | undefined>`。
 * @param options.credentialRef - `() => string`，取自 `capital-config` 卡片。
 * @param options.baseUrl - Fuyao base URL；省略时用内核里的官方默认值。
 * @param options.now - 时间源（测试可注入）。
 */
export function createWatchlistService(options = {}) {
  const {
    openDomain,
    resolveApiKey = async () => undefined,
    credentialRef = () => DEFAULT_CREDENTIAL_REF,
    baseUrl = DEFAULT_FUYAO_BASE_URL,
    now = () => Date.now(),
    timeoutMs = SEARCH_TIMEOUT_MS,
  } = options

  let domainPromise
  /** 全局单闸门：开面板与手动刷新共用；后来者等同一次结果，而不是并排放第二个请求。 */
  let refreshing = null

  const domain = () => {
    if (domainPromise === undefined) domainPromise = Promise.resolve().then(() => openDomain())
    return domainPromise
  }
  const table = async () => (await domain()).table('items')

  async function ensureSeeded() {
    const opened = await domain()
    const items = opened.table('items')
    if (opened.global.get().seeded_at !== 0 || items.size > 0) return
    const stamp = now()
    for (const seed of SEED_ITEMS) {
      await items.put(seed.thscode, { ...seed, added_at: stamp, source: 'seed', quote: null })
    }
    await opened.global.set({ seeded_at: stamp, schema: 1 })
  }

  async function callFuyao(path, params, allowed) {
    const ref = credentialRef() || DEFAULT_CREDENTIAL_REF
    const apiKey = await resolveApiKey(ref)
    return fuyaoRequest({ baseUrl, apiKey, path, search: fuyaoQuery(params, allowed), signal: AbortSignal.timeout(timeoutMs) })
  }

  async function search(query) {
    const q = typeof query === 'string' ? query.trim() : ''
    if (q.length === 0 || q.length > MAX_QUERY_LENGTH) {
      return { ok: false, code: 'invalid_query', message: '输入为空或过长' }
    }
    let envelope
    try {
      envelope = await callFuyao(ENDPOINTS.search, { q, asset_type: SEARCH_ASSET_TYPES, limit: SEARCH_LIMIT }, ['q', 'asset_type', 'limit'])
    } catch (error) {
      const code = watchlistErrorCode(error)
      return { ok: false, code, message: messageFor(code) }
    }
    const items = await table()
    // 后缀也要收口：实测 `q=宁德时代` 会带回 `885789.TI 宁德时代概念`（同花顺指数），
    // 它既不在本版报价范围、也过不了域 schema——不挡掉就是"添加"那一下 500。
    const rows = fuyaoItems(envelope)
      .map(candidateOf)
      .filter((row) => ASSET_TYPES.includes(row.asset_type) && normalizeThscode(row.thscode) !== undefined)
    return {
      ok: true,
      items: rows.map((row) => ({ ...row, in_list: items.get(row.thscode) !== undefined })),
      truncated: rows.length >= SEARCH_LIMIT,
    }
  }

  async function list() {
    await ensureSeeded()
    const opened = await domain()
    return { ok: true, items: rowsOf(opened.table('items')), seeded_at: opened.global.get().seeded_at }
  }

  async function add(input) {
    await ensureSeeded()
    const items = await table()
    if (items.size >= MAX_ITEMS) return { ok: false, code: 'list_full', message: `自选股最多 ${MAX_ITEMS} 条，先删一条再加` }

    const direct = input?.thscode
    if (direct !== undefined && direct !== null && direct !== '') {
      const thscode = normalizeThscode(direct)
      if (thscode === undefined) return { ok: false, code: 'invalid_query', message: '代码格式不符：需要 6 位数字 + 交易所后缀' }
      const found = await search(thscode)
      if (!found.ok) return found
      const hit = found.items.find((row) => row.thscode === thscode)
      if (hit === undefined) return { ok: false, code: 'not_found', message: '该标的不在本版支持范围（沪深 A 股 / 指数 / 场内 ETF）' }
      return write(hit, items)
    }

    const found = await search(input?.q)
    if (!found.ok) return found
    if (found.items.length === 0) return { ok: false, code: 'not_found', message: '没有找到该标的' }
    if (found.items.length > 1) return { ok: false, code: 'ambiguous', message: '命中多条，请从候选里选一条', candidates: found.items }
    return write(found.items[0], items)
  }

  async function write(candidate, items) {
    const existing = items.get(candidate.thscode)
    if (existing !== undefined) return { ok: true, item: existing, idempotent: true }
    const item = {
      thscode: candidate.thscode,
      ticker: candidate.ticker,
      name: candidate.name,
      exchange: candidate.exchange,
      asset_type: candidate.asset_type,
      added_at: now(),
      source: 'user',
      quote: null,
    }
    await items.put(item.thscode, item)
    return { ok: true, item }
  }

  async function remove(input) {
    await ensureSeeded()
    const items = await table()
    const thscode = normalizeThscode(input?.thscode)
    if (thscode === undefined) return { ok: false, code: 'invalid_query', message: '代码格式不符' }
    return { ok: true, removed: await items.delete(thscode) }
  }

  /**
   * 置顶 = 给这一条打一个 `pinned_at` 时间戳；排序归 `rowsOf`（后置顶的在前）。
   * 不把"键挪到最前"当成实现：顺序是读法的一部分，写进去就要求整表重写。
   * 重复置顶是幂等的用户动作（只是把时间戳推新，行不会跳走），`not_found` 则响亮失败。
   */
  async function pin(input) {
    await ensureSeeded()
    const items = await table()
    const thscode = normalizeThscode(input?.thscode)
    if (thscode === undefined) return { ok: false, code: 'invalid_query', message: '代码格式不符' }
    const existing = items.get(thscode)
    if (existing === undefined) return { ok: false, code: 'not_found', message: '该标的不在自选清单里' }
    await items.put(thscode, { ...existing, pinned_at: now() })
    return { ok: true, items: rowsOf(items) }
  }

  /** 一个 asset_type 分组 = 一次快照请求；单组失败只记该组，不拖垮其它组。 */
  async function fetchGroup(group, failures) {
    const capturedAt = now()
    let envelope
    try {
      envelope = await callFuyao(group.path, group.params, group.allowed)
    } catch (error) {
      const code = watchlistErrorCode(error, { perItem: true })
      for (const thscode of group.codes) failures.push({ thscode, code })
      const batch = batchLevelCode(error)
      return { byCode: new Map(), batchError: batch !== undefined ? { code: batch, message: messageFor(batch) } : undefined }
    }
    const sourceTs = fuyaoTimestamp(envelope)
    const byCode = new Map()
    for (const row of fuyaoItems(envelope)) {
      const thscode = typeof row.thscode === 'string' ? row.thscode : ''
      const quote = quoteOf(row, sourceTs, capturedAt)
      if (thscode !== '' && quote !== undefined) byCode.set(thscode, quote)
    }
    for (const thscode of group.codes) {
      if (!byCode.has(thscode)) failures.push({ thscode, code: 'quote_unavailable' })
    }
    return { byCode, batchError: undefined }
  }

  /**
   * 单闸门：开面板、手动刷新、以及添加完那一次顺手刷新共用；并发只发一次出网。
   * 复位必须发生在**同一条 settle 链**里（`.finally` 挂在 doRefresh 上），否则刚刷完再点
   * 一次会拿到上一次的结果——用户看到的症状是"点了刷新没反应"。
   */
  function refresh() {
    if (refreshing !== null) return refreshing
    const running = doRefresh().finally(() => {
      if (refreshing === running) refreshing = null
    })
    refreshing = running
    return running
  }

  async function doRefresh() {
    await ensureSeeded()
    const opened = await domain()
    const items = opened.table('items')
    const rows = rowsOf(items)
    if (rows.length === 0) return { ok: true, items: [], refreshed_at: null, failures: [] }

    const groups = []
    for (const [assetType, group] of [
      ['a-share', { path: ENDPOINTS.stock, allowed: ['thscodes'], batch: true }],
      ['a-share-index', { path: ENDPOINTS.index, allowed: ['thscodes'], batch: true }],
      ['fund-etf', { path: ENDPOINTS.fund, allowed: ['thscode'], batch: false }],
    ]) {
      const codes = rows.filter((row) => row.asset_type === assetType).map((row) => row.thscode)
      if (codes.length === 0) continue
      if (!group.batch) {
        for (const thscode of codes) groups.push({ path: group.path, allowed: group.allowed, params: { thscode }, codes: [thscode] })
      } else {
        groups.push({ path: group.path, allowed: group.allowed, params: { thscodes: codes.join(',') }, codes })
      }
    }

    const failures = []
    const quotes = new Map()
    let batchError
    for (const group of groups) {
      const result = await fetchGroup(group, failures)
      for (const [thscode, quote] of result.byCode) quotes.set(thscode, quote)
      if (result.batchError !== undefined) batchError = result.batchError
    }

    const current = new Map(rows.map((row) => [row.thscode, row]))
    for (const [thscode, quote] of quotes) {
      const row = current.get(thscode)
      if (row === undefined) continue
      await items.put(thscode, { ...row, quote })
    }
    // 一条都没落地就不报"刷新于此刻"：页脚那个时间讲的是最后一次**真取到数**的时刻，
    // 跟着一次全失败的点击往前走，就成了每一行都陈旧、只有页脚是新的（客户端据此保留上一个值）。
    const result = { ok: true, items: rowsOf(items), refreshed_at: quotes.size > 0 ? now() : null, failures }
    if (batchError !== undefined) result.error = batchError
    return result
  }

  return {
    list,
    search,
    add,
    remove,
    pin,
    refresh,
    async close() {
      const opened = await domainPromise
      domainPromise = undefined
      if (opened?.close !== undefined) await opened.close()
    },
  }
}

/** 只有会把整批都打挂的失败才升格成 batch error（限流 / 没配 key / 服务不通）。 */
function batchLevelCode(error) {
  const code = watchlistErrorCode(error)
  return code === 'credential_missing' || code === 'rate_limited' || code === 'fuyao_unavailable' ? code : undefined
}

function messageFor(code) {
  if (code === 'credential_missing') return '未配置 Fuyao 密钥：在「插件」页的 Capital 模式卡片里填 API Key'
  if (code === 'rate_limited') return '行情服务限流，请稍后再试'
  if (code === 'invalid_query') return '输入不被接受'
  return '行情服务暂时不可用，请稍后再试'
}

/** 读 `capital-config` 条目里用户配的 Fuyao 引用名；没有 settings 的载体回退默认名。 */
export function readCredentialRef(ctx) {
  try {
    const settings = ctx.get('settings')
    const value = settings?.describe?.().find((entry) => entry.ns === CAPITAL_CONFIG_ENTRY_ID)?.value
    const ref = value?.fuyaoCredentialRef
    return typeof ref === 'string' && ref.trim().length > 0 ? ref.trim() : DEFAULT_CREDENTIAL_REF
  } catch {
    return DEFAULT_CREDENTIAL_REF
  }
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

const FAILURE_STATUS = {
  invalid_query: 400,
  not_found: 404,
  ambiguous: 409,
  list_full: 409,
  credential_missing: 503,
  rate_limited: 429,
  fuyao_unavailable: 502,
  store_unavailable: 503,
}

/**
 * 路由：GET 走 query，POST 走 JSON body。
 *
 * @param service - `createWatchlistService` 的返回。
 * @param options.authorize - `(req) => 401 | 403 | undefined`，接 `connection.requestRejection`。
 * @param options.storeError - `() => unknown`：域打开失败的记录，非空时所有路由改口
 *   `store_unavailable`（响亮失败，不返回空清单骗用户"没有自选"）。
 */
export function createRouteHandler(service, options = {}) {
  const { authorize, storeError } = options

  return async function handler(req, res) {
    if (typeof authorize === 'function') {
      let rejection
      try {
        rejection = authorize(req)
      } catch {
        rejection = 401
      }
      if (rejection !== undefined && rejection !== null) {
        res.statusCode = rejection
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
    }

    const method = req?.method ?? 'GET'
    if (method !== 'GET' && method !== 'POST') {
      send(res, 405, { ok: false, code: 'method_not_allowed', message: '只支持 GET / POST' })
      return
    }

    let pathname
    let searchParams
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      pathname = url.pathname.slice(ROUTE_PATH.length)
      searchParams = url.searchParams
    } catch {
      send(res, 400, { ok: false, code: 'invalid_query', message: 'bad request' })
      return
    }

    const stored = storeError === undefined ? undefined : storeError()
    if (stored !== undefined && stored !== null) {
      send(res, 503, { ok: false, code: 'store_unavailable', message: '自选股存储不可用', cause: String(stored) })
      return
    }

    let input = {}
    if (method === 'POST') {
      try {
        input = await readBody(req)
      } catch {
        send(res, 400, { ok: false, code: 'invalid_query', message: '请求体不是合法 JSON' })
        return
      }
    }

    try {
      if (method === 'POST' && pathname === '/add') return sendBusiness(res, await service.add(input))
      if (method === 'POST' && pathname === '/remove') return sendBusiness(res, await service.remove(input))
      if (method === 'POST' && pathname === '/pin') return sendBusiness(res, await service.pin(input))
      if (method === 'POST' && pathname === '/refresh') {
        // 刷新是"部分成功 + 逐条失败"的形态：整批失败也带 items 与 error 回来，
        // 面板按 error.code 居中显示，绝不清空列表。
        return send(res, 200, await service.refresh())
      }
      if (method === 'GET' && pathname === '/list') return send(res, 200, await service.list())
      if (method === 'GET' && pathname === '/search') return sendBusiness(res, await service.search(searchParams.get('q') ?? ''))
      send(res, 404, { ok: false, code: 'not_found', message: 'unknown watchlist route' })
    } catch (error) {
      send(res, 503, { ok: false, code: 'store_unavailable', message: '自选股存储不可用', cause: String(error?.message ?? error) })
    }
  }
}

function sendBusiness(res, result) {
  if (result.ok === true) return send(res, 200, result)
  return send(res, FAILURE_STATUS[result.code] ?? 400, result)
}

export function apply(ctx) {
  let storeFailure = null

  const service = createWatchlistService({
    openDomain: () => {
      let storage
      try {
        storage = ctx.get('storageDomain')
      } catch {
        storage = undefined
      }
      if (storage?.open === undefined) throw new Error('storageDomain facility is not mounted')
      return storage.open(domainSpec)
    },
    credentialRef: () => readCredentialRef(ctx),
    resolveApiKey: async (ref) => {
      const credentials = ctx.get('credentials')
      if (credentials?.resolve !== undefined) {
        const resolved = await credentials.resolve(ref)
        if (resolved?.value) return resolved.value
      }
      return globalThis.process?.env?.[ref]
    },
  })

  ctx.provide('capitalWatchlist', service)

  // 预热一次：域打开失败要响亮（所有路由改口 store_unavailable），但不许带崩整个 profile 启动。
  // cause 里同时留 code 与 message——只有 code 的话，运维时看到的是天书（实测：malformed-medium
  // 单独出现时完全指不出是哪份介质、哪一步）。
  service.list().catch((error) => {
    storeFailure = [error?.code, error?.message].filter(Boolean).join('：') || 'domain-open-failed'
    ctx.logger?.error?.(`capital-watchlist: 域打开失败，功能不可用（${storeFailure}）`)
  })

  /**
   * 认证围栏：解析 host 平面的 `connection`（web profile 由 `dsh-client-connection`
   * 提供），把它的 `requestRejection` 接到本路由上——trusted-Host（403）+ 签名 cookie（401）。
   * 惰性解析：`connection` 与本行的挂载先后不由我们决定。
   */
  const authorize = (req) => {
    let connection
    try {
      connection = ctx.get('connection')
    } catch {
      return 401
    }
    if (connection === undefined || connection === null) return undefined
    if (typeof connection.requestRejection !== 'function') return undefined
    return connection.requestRejection(req)
  }

  const registerRoute = (webCtx) => {
    webCtx.effect(
      () => {
        const dispose = webCtx.webServer.register({
          kind: 'prefix',
          path: ROUTE_PATH,
          handler: createRouteHandler(service, { authorize, storeError: () => storeFailure }),
        })
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      },
      'capital-watchlist: route',
    )
  }
  // 只走 inject：`ctx.get('webServer')` 有值不代表 `ctx.webServer` 属性可访问（cordis 只认
  // "本层声明过 inject"）。先探测再直接调用 = 把正确性押在装配顺序上，桌面端就是这么炸的
  // （2026-09-30 实机，与 capital-charts 同一处形状）。
  ctx.inject(['webServer'], registerRoute)

  // 域是我们打开的，就得自己关（facility 只在自己卸载时兜底）；同名重复 open 会 already-open。
  ctx.effect(() => () => {
    service.close().catch(() => {})
  }, 'capital-watchlist: domain')

  ctx.logger?.info?.('capital-watchlist: 自选股服务与 /capital-watchlist 路由已挂载')
}
