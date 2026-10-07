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
 *  - 出网复用 `lib/sources/fuyao-core.js` 与 `lib/sources/tencent-public-core.js`（**同一份实现**，
 *    AGENTS.md §9.7）；key 引用名从 `capital-config` 卡片读，不硬编码 `FUYAO_API_KEY`。
 *    两路上游按**行类**分工：A 股族走 Fuyao（要密钥），港美股走腾讯公开端点（不要密钥）——
 *    所以一路上游失败只降它自己那一路，`credential_missing` 的射程从"整块面板"缩到"A 股那一路"。
 *  - 报价按 `asset_type` 分流；ETF 上游只接受单只（实测 `code=1002`），所以逐只扇出，规模由清单
 *    上限（30）钉住、由 `REFRESH_CONCURRENCY` 收敛成约 8 波，总预算随条数走。港美股每个市场
 *    一次批量（≤50），比 A 股 ETF 逐只便宜。
 *  - 清单的读-改-写在**进程内串行**（`serialize`）：出网不进这一道，跨进程只到"同一键"为止，
 *    两条边界都写在 `serialize` 的注释里，不假装我们锁住了磁盘。
 */
import z from 'zod'
import { DEFAULT_FUYAO_BASE_URL, FuyaoError, fuyaoItems, fuyaoQuery, fuyaoRequest, fuyaoTimestamp } from '../lib/sources/fuyao-core.js'
// 港美股快照、指数点位与检索复用插件侧那一份内核（同一条节流链、同一张字段位序表、同一套守卫）：
// 复制第二份解析就是 AGENTS.md §9.7 那一族事故，`test/watchlist-quote.test.mjs` 有模块同一性探针。
import {
  fetchOffshoreIndexQuotes,
  fetchOffshoreQuotes,
  fetchSmartbox,
  normalizeHkCode,
} from '../lib/sources/tencent-public-core.js'

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
/**
 * 清单条目上限（2026-10-01 从 10 抬到 30：用户点名 10 条不可接受）。它同时是**一次刷新的
 * 请求个数上限**——ETF 上游只认单只，30 只全 ETF 就是 30 个请求，所以扇出必须并发（见
 * `REFRESH_CONCURRENCY`）并且总预算随条数走（见 `refreshBudgetFor`）；它也约束 `single`
 * 布局的整写体积。
 */
export const MAX_ITEMS = 30
/** ETF 扇出的并发路数：30 个单只请求压成约 8 波，正常网络一次刷新几秒内落地。 */
export const REFRESH_CONCURRENCY = 4
/** 搜索候选上限（一屏给这么多，倒逼用户缩小输入，不做分页）。 */
export const SEARCH_LIMIT = 20
/**
 * 每一路自己能拿到几条——`truncated` 那句"还有更多"按这一表判，不是按 `SEARCH_LIMIT` 判：
 * Fuyao `ticker_search` 的 `limit` 官方取值 1~50（默认 10），这里取到与显示上限齐平；
 * smartbox 实测**硬顶 10 条**（`&n=` / `&count=` / `&size=` / `&limit=` / `&max=` / `&hits=` 六种写法
 * 全无效，2026-10-07 逐条实测），多要也不会多给。所以某一路回满自己那一档，就是上游那侧被砍了。
 */
export const SEARCH_BRANCH_LIMITS = { 'a-share': 20, hk: 10, us: 10 }
/** A 股那一路的搜索白名单（Fuyao 与报价端点双端都有可靠支撑）；场外基金 / 北交所不进候选。
 * 港美股那两路各有自己的白名单（`SMARTBOX_STOCK_TYPES` + `SMARTBOX_INDEX_TYPE`），互不通用。 */
export const SEARCH_ASSET_TYPES = 'a-share,a-share-index,fund-etf'
const ASSET_TYPES = ['a-share', 'a-share-index', 'fund-etf', 'hk-stock', 'hk-index', 'us-stock', 'us-index']
/**
 * `exchange` 这一格存的是**市场**而不是交易所：A 股沿用 `SH`/`SZ`，港美股落 `HK`/`US`。
 * 具体交易所（美股的 `OQ` / `N` / `AM` / 粉单 `PS`）留在 canonical 代码里（`AAPL.OQ`）——
 * 这两个维度在三个市场里不是同一件事（港股没有交易所分裂、美股的点是级别码还是交易所在
 * 字面上分不开），塞进同一格就会有一格在说谎。
 */
const EXCHANGES = ['SH', 'SZ', 'HK', 'US']
const SEARCH_TIMEOUT_MS = 15_000
/**
 * smartbox 可用的市场段：只能是单值。实测 `t=hk,us` 这种列表形态回 `N` 哨兵——与"查无此票"
 * 同一个回文，所以段值必须是这里的常量，不能让一个拼错的值伪装成"没有匹配的标的"。
 */
const SMARTBOX_MARKETS = ['hk', 'us']
/** smartbox 的类型段白名单：`GP` 个股、`GP-FUND` 基金类（港美股 ETF 都落在这两档）、`ZS` 指数。 */
const SMARTBOX_STOCK_TYPES = ['GP', 'GP-FUND']
const SMARTBOX_INDEX_TYPE = 'ZS'
/** 指数码与美股身份码的形状判据：与内核 `normalizeOffshoreIndexCode` / `parseUsQuoteRows` 的守卫同一条
 * （尾段同样排除我们自己占用的四个市场标记，见下面 `KEY_FORMS` 里那条注释）。 */
const SMARTBOX_INDEX_CODE = /^[A-Z][A-Z0-9.]{1,9}$/u
const SMARTBOX_US_IDENTITY = /^[A-Z][A-Z.]{0,9}\.(?!SH$|SZ$|HK$|US$)[A-Z]{1,3}$/u
/**
 * 一次刷新的总预算：**随清单条数走**——`20s + 2.5s × 条数`，下界 45 秒、上界 90 秒。
 * 下界保住 10 条这一档与 2.5.2 的行为完全一致（20 + 2.5×10 = 45），抬到 30 条时不必把小清单
 * 一起拖长。预算在**每个工作线程领下一组之前**检查，所以真实上界是 `budget + 一次请求的超时`
 * （一次超时 = `SEARCH_TIMEOUT_MS`）；被预算切掉的行如实记 `refresh_timeout`——它们这次没被问过，
 * 不是"这个标的没有报价"。最坏情形（每只都撞超时）由并发路数收敛：30 只 ETF ≈ 8 波。
 */
const REFRESH_BUDGET_BASE_MS = 20_000
const REFRESH_BUDGET_PER_ITEM_MS = 2_500
const REFRESH_BUDGET_FLOOR_MS = 45_000
const REFRESH_BUDGET_CEIL_MS = 90_000
/** 一次刷新的总预算：`options.refreshBudgetMs` 给了就用给的，没给按这次要问的条数算。 */
export function refreshBudgetFor(count) {
  return Math.min(REFRESH_BUDGET_CEIL_MS, Math.max(REFRESH_BUDGET_FLOOR_MS, REFRESH_BUDGET_BASE_MS + REFRESH_BUDGET_PER_ITEM_MS * count))
}
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
 * A 股那三档报价模板（**一字未动**地沿用 2.6 的行为：同一端点、同一批 / 逐只形状、同一套参数白名单）。
 * `currency` 这一格是全仓唯一写 `CNY` 的地方，指数档故意不写（点位无量纲，R9）。
 */
const FUYAO_TEMPLATES = [
  ['a-share', { path: ENDPOINTS.stock, allowed: ['thscodes'], batch: true, scope: 'a-share', currency: 'CNY' }],
  ['a-share-index', { path: ENDPOINTS.index, allowed: ['thscodes'], batch: true, scope: 'a-share' }],
  ['fund-etf', { path: ENDPOINTS.fund, allowed: ['thscode'], batch: false, scope: 'a-share', currency: 'CNY' }],
]

/**
 * 港美股四档的规格：一个市场一族行类 = 一次批量（清单上限 30，实测的 ≤50 之内用不到分片）。
 * `index` 决定走内核哪一个取数编排（两市的字段位序表都在内核里，面板不抄第二份）；
 * `withCurrency` 只在个股档为真——指数档即便上游在同一列塞了 `HKD` / `USD` 也不收（§3.5）。
 */
const OFFSHORE_SPECS = [
  { assetType: 'hk-stock', market: 'hk', index: false, withCurrency: true, scope: 'hk' },
  { assetType: 'hk-index', market: 'hk', index: true, withCurrency: false, scope: 'hk' },
  { assetType: 'us-stock', market: 'us', index: false, withCurrency: true, scope: 'us' },
  { assetType: 'us-index', market: 'us', index: true, withCurrency: false, scope: 'us' },
]

/**
 * 一组港美股代码 → 内核的取数入参。
 *
 * canonical 键**不能**直接当请求写法：美股的键是上游回显的带后缀身份（`AAPL.OQ`），而快照只认
 * 不带后缀的那个写法（实测 `usAAPL.OQ` 整行不回、`usAAPL` 回）。这里的剥法与内核参数层的
 * `normalizeUsCode` **不是同一条规则**，也不能是同一条：参数层要在"级别码"（BRK.B）与
 * "交易所码"（BABA.N）之间猜，所以单字母尾段必须留着；而面板存的就是回显身份，最后一个点号
 * 之后那一段**已知**是交易所码，剥掉即可，不用猜、也不用多一轮请求。
 * 剥完仍不认识的那几只由内核的三轮写法回退保兜（`BRK.B` → 没回行再退 `BRK`）。
 */
function offshoreGroup(spec, keys) {
  const codeByKey = new Map()
  const failures = []
  for (const thscode of keys) {
    const stem = stemOf(thscode)
    const code = spec.market === 'us' && !spec.index ? stem.replace(/\.[A-Z]{2,3}$/u, '') : stem
    if (!/^(?:\d{5}|[A-Z][A-Z0-9.]{1,9})$/u.test(code)) {
      // 指不到一个可请求的写法：这一条不进组、照实记 `quote_unavailable`，绝不拿半截代码去问
      // （键形状本该挡住这种行，走到这里说明磁盘上的键与形状表已经不对账了）。
      failures.push({ thscode, code: 'quote_unavailable' })
      continue
    }
    codeByKey.set(thscode, code)
  }
  if (codeByKey.size === 0) return { group: undefined, failures }
  return { group: { ...spec, kind: 'tencent', keys: [...codeByKey.keys()], codes: [...new Set(codeByKey.values())] }, failures }
}

/** 回包第 2 位（上游自己的身份）→ 本仓的 canonical 键。港股两个市场标记本来就是我们加的。 */
function offshoreKeyOf(row, group) {
  const code = typeof row.code === 'string' ? row.code.trim().toUpperCase() : ''
  if (code.length === 0) return ''
  if (group.market === 'hk') return `${code}.HK`
  return group.index ? `${code}.US` : code
}

/**
 * 播种条目：三个市场各给一根"今天有没有开盘"的标尺。A 股那条走 Fuyao 的 `index` 端点，
 * 恒指走腾讯港股指数窄表，纳指/标普走腾讯美股指数窄表——四条均已用 2026-10-07 真报文验证
 * 有值（`usINX` 是标普在腾讯的写法，`SPX` / `usSSPX` 不回指数，见设计文档 P18 / P19）。
 * 2026-10-07 由用户定为这四条，替换掉原先的深证成指 / 创业板指 / 沪深300。
 * ⚠ 只对新域生效：老用户磁盘上仍是旧四条，**不补种、不替换**（清单是用户资产，
 * 我们没有任何依据替他改掉三行）。
 */
export const SEED_ITEMS = [
  { thscode: '000001.SH', ticker: '000001', name: '上证指数', exchange: 'SH', asset_type: 'a-share-index' },
  { thscode: 'HSI.HK', ticker: 'HSI', name: '恒生指数', exchange: 'HK', asset_type: 'hk-index' },
  { thscode: 'IXIC.US', ticker: 'IXIC', name: '纳斯达克', exchange: 'US', asset_type: 'us-index' },
  { thscode: 'INX.US', ticker: 'INX', name: '标普500', exchange: 'US', asset_type: 'us-index' },
]

/**
 * 五种 canonical 键形状（设计文档 §3.4）。**判序有语义**，不是写法偏好：
 * `HSI.HK` 若先落进字母分支、`.US` 若排在个股分支之后，都会得到一行"能加进清单、永远取不到数"
 * 的条目（更糟的是取到**别人的**数，见 P19 的 `SSPX.AM`——它的 stem 与那只 ETF 完全相等）。
 * 所以这一张表就是 `keyFormOf()` 的遍历顺序，顺序即规则；改顺序必须先回答"哪两串会互相吃掉"。
 * 第一档 `a-share` 是唯一一"形"对多"类"（个股 / 指数 / ETF 同形），故 `assetTypes` 是集合：
 * 这一族的 `asset_type` 只能来自搜索侧给的值，形状只负责否证。
 */
const KEY_FORMS = [
  { form: 'a-share', regex: /^\d{6}\.(SH|SZ)$/u, assetTypes: ['a-share', 'a-share-index', 'fund-etf'] },
  { form: 'hk-stock', regex: /^\d{5}\.HK$/u, assetTypes: ['hk-stock'] },
  { form: 'hk-index', regex: /^[A-Z][A-Z.]{0,9}\.HK$/u, assetTypes: ['hk-index'] },
  { form: 'us-index', regex: /^[A-Z]{2,8}\.US$/u, assetTypes: ['us-index'] },
  // 尾段排除 `SH` / `SZ` / `HK` / `US` 这四个**我们自己占用的市场标记**：不放行的话
  // `ABCDEF.SH` 会同时命中"美股身份"那一档（`[A-Z]{1,3}` 装得下任何两个字母），
  // 于是一个不存在的键能进清单、还能去敲腾讯的门。交易所码本身的取值域不归我们发明
  // （实测有 OQ / N / AM / PS，内核 `parseUsQuoteRows` 因此只约束长度），这一条只收自己的账。
  { form: 'us-stock', regex: /^[A-Z][A-Z.]{0,9}\.(?!SH$|SZ$|HK$|US$)[A-Z]{1,3}$/u, assetTypes: ['us-stock'] },
]
/** 命中即返回；不返回"最像的那档"——判不中就是不是我们认得的键。 */
export function keyFormOf(thscode) {
  if (typeof thscode !== 'string') return null
  return KEY_FORMS.find((entry) => entry.regex.test(thscode)) ?? null
}
const KEY_REGEX = /^(?:\d{6}\.(?:SH|SZ)|\d{5}\.HK|[A-Z][A-Z.]{0,9}\.HK|[A-Z]{2,8}\.US|[A-Z][A-Z.]{0,9}\.(?!SH$|SZ$|HK$|US$)[A-Z]{1,3})$/u
/**
 * `not_found` 那句话里要说清"这一档支持什么"（市场名从键的形状读，不写死"沪深 A 股 / 指数 /
 * 场内 ETF"——那句在港美股进来之后会指错路）。指数两档要把"写法不许猜"写进用户看得见的句子：
 * 实测 `usSPX` / `usNDQ` / `usSSPX` 都不回指数（最后那个回了一只真 ETF 且不报错），
 * 只有搜索回来的那一串才被腾讯认。
 */
const FORM_SCOPE_TEXT = {
  'a-share': '沪深 A 股 / 指数 / 场内 ETF',
  'hk-stock': '港股现货',
  'hk-index': '港股指数，写法只认搜索回来的那个',
  'us-stock': '美股与在美 ADR',
  'us-index': '美股指数，写法只认搜索回来的那个（标普是 INX、纳斯达克是 IXIC）',
}

const quoteSchema = z.object({
  price: z.number(),
  /**
   * 涨跌可以是**没有**：上游用 `null` 表示"这个数没有"（停牌、未开盘），此时最新价仍然有值。
   * 早先这里写死 `z.number()`，于是 `quoteOf` 拿 `pct ?? 0` 兜底——停牌标的被画成「+0.00%」，
   * 一次刷新把上一次真实的涨跌顶掉、页脚照报"刷新于此刻"、还不记任何失败。金融应用里
   * "没有这个数"和"这个数是零"必须分开；客户端把 null 画成破折号并降到陈旧那一档的灰。
   */
  change_pct: z.number().nullable(),
  captured_at: z.number().int(),
  source_ts: z.number().int().nullable(),
  /**
   * 币种**只跟着钱走**：个股与 ETF 每份回包都带（港美股从上游那一列读、A 股由本文件唯一一处写
   * `CNY`），指数族一律不落——点位是无量纲的数，腾讯确实在指数行的同一位塞了 `HKD` / `USD`，
   * 画上去等于替上游说了一句它没说的话（设计文档 §3.5 / R9）。
   * 取值域**不是闭集**：这个列归上游所有（今天已看见 `HKD` / `USD` / `CNY` 三种，`-R` 柜台就是
   * CNY 报价的港股），我们不拥有它，所以只限形状不限内容，面板对不认识的币种照字面画。
   */
  currency: z.string().min(1).max(8).optional(),
  /**
   * 交易所**当地时间**的原串（`2026-10-05 16:08:09`，HKT / 美东），只有港美股那一路有；
   * `source_ts`（epoch）只由 Fuyao 信封填。两者不互相伪造、也不互相换算——换算要用到我们没有的
   * 偏移表与夏令时口径（§7-N4）。页脚那句"刷新于此刻"讲的仍是我们的取数时刻（`captured_at`）。
   */
  source_time: z.string().max(32).nullable().optional(),
})

const itemSchema = z.object({
  thscode: z.string().regex(KEY_REGEX),
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

/** 规范化 canonical 键：trim + 大写，只接受 §3.4 的五种形状。裸代码一律拒绝——`AAPL` 少了交易所段就
 * 没法和回显身份核对，`000001` 到底是指数还是平安银行由上游裁决、不由我们猜。 */
export function normalizeThscode(value) {
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim().toUpperCase()
  return KEY_REGEX.test(cleaned) ? cleaned : undefined
}

/**
 * 取"最后一个点号之前"那一段。**⛔ 不许用 `split('.')[0]` / `split('.')[1]`**：
 * `BRK.B.N` 会拆成 `['BRK','B','N']`——实测那是一级股票（伯克希尔 B）而不是畸形代码。
 * 这一串同时是三处共用的"检索/请求写法"：smartbox 只认它（把 canonical 键原样丢过去一律回
 * `N` 哨兵，2026-10-07 实测 `TCEHY.PS` / `00700.HK` / `HSI.HK` / `IXIC.US` 全部不回行），
 * 美指数用 `IXIC.US` → `IXIC` 也正好是腾讯认的写法（回显是 `.IXIC`，差一个前导点）。
 */
export function stemOf(thscode) {
  const dot = thscode.lastIndexOf('.')
  return dot > 0 ? thscode.slice(0, dot) : thscode
}

/** 键所属市场（`SH` / `SZ` / `HK` / `US`），只从形状的**尾段**取，不从中间的点号取。 */
function marketOfKey(thscode) {
  const dot = thscode.lastIndexOf('.')
  return dot > 0 ? thscode.slice(dot + 1) : ''
}

/**
 * 这一行归哪一路报价：`'fuyao'` 或 `'tencent'`（后者带市场）。判据是**键的形状**而不是 `asset_type`
 * 那一格——形状由 `KEY_FORMS` 的判序给出，与加进来时用的是同一份判据，磁盘上被人手改过的
 * `asset_type` 不能让一行港股悄悄流进 Fuyao 端点（那边根本不认它）。
 */
function quoteRoute(item) {
  const entry = keyFormOf(item.thscode)
  if (entry === null) return undefined
  return entry.assetTypes.includes(item.asset_type) ? entry : undefined
}

/**
 * 上游错误 → 本路由自己的错误码。`perItem` 决定"这个标的取不到"还是"这一路不通"：
 * 逐条失败绝不能升格成整批失败，整批失败也绝不能伪装成某一条的缺口。
 *
 * `source` 决定**哪一家**不通：两路的处置动作完全不同——Fuyao 那一路要去看密钥卡片，
 * 腾讯那一路无密钥可查（公开端点，只可能是上游或网络）。混成一条就是叫用户去配一个
 * 本来不需要的 key。腾讯侧的判定读内核挂在 Error 上的 `code`（`tencent_*`）：这一家
 * 没有"凭据"与"限流"之外的可处置区分，所以报文畸形与传输失败在**批级**都说成
 * `tencent_unavailable`，不假装我们能指出是哪一只。
 */
export function watchlistErrorCode(error, { perItem = false, source = 'fuyao' } = {}) {
  if (source === 'tencent') return perItem ? 'quote_unavailable' : (error?.code === 'tencent_rate_limit' ? 'rate_limited' : 'tencent_unavailable')
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

/** Fuyao 候选行 → 本面板的候选形状。 */
function candidateOf(row) {
  const thscode = typeof row.thscode === 'string' ? row.thscode : ''
  return {
    thscode,
    ticker: typeof row.ticker === 'string' && row.ticker.length > 0 ? row.ticker : stemOf(thscode),
    name: typeof row.name === 'string' && row.name.length > 0 ? row.name : thscode,
    // ⛔ 市场优先取上游给的值（Fuyao 给 `exchange`、smartbox 给市场段），字符串推导只当兜底，
    // 且只能取**最后一个**点号之后：`BRK.B.N` 用 `split('.')[1]` 会取出 `'B'`。
    exchange: typeof row.exchange === 'string' && row.exchange.length > 0 ? row.exchange.toUpperCase() : marketOfKey(thscode),
    asset_type: typeof row.asset_type === 'string' ? row.asset_type : '',
  }
}

/**
 * smartbox 一行候选 → 本面板的候选形状；判不成立回 `undefined`（**不进候选**，不报错）。
 *
 * 两条闸门叠在一起用（设计文档 §3.6）：类型白名单收掉衍生品，键形状收掉"类型说的和形状
 * 不是一回事"的行。市场段由调用方给（`t=hk` / `t=us` 各一次请求），所以这里不再从 `row.market`
 * 猜——实测 `t=hk&q=纳指` 十条里七条是窝轮，白名单必须事后收而不是指望上游收。
 * 名称直接用上游给的（smartbox 的 `~` 第 3 位已是解过 `\uXXXX` 的正文）。
 */
function offshoreCandidateOf(row, market) {
  if (typeof row?.code !== 'string' || row.code.length === 0) return undefined
  if (!SMARTBOX_STOCK_TYPES.includes(row.type) && row.type !== SMARTBOX_INDEX_TYPE) return undefined
  const isIndex = row.type === SMARTBOX_INDEX_TYPE
  // 实测美指数行给的是 `ixic`（不带上游回显时那个前导点）；两种写法都收，判形状后统一成裸码。
  const code = row.code.trim().toUpperCase().replace(/^\./u, '')
  const stem = isIndex
    ? (SMARTBOX_INDEX_CODE.test(code) ? code : undefined)
    : market === 'hk'
      ? fiveDigitHk(code)
      : (SMARTBOX_US_IDENTITY.test(code) ? code : undefined)
  if (stem === undefined) return undefined
  // 美股个股的键**就是**上游回显的身份（`TCEHY.PS` / `BRK.B.N`，实测 smartbox 每行都带后缀），
  // 不再补市场标记；其余四档都补（港股上游只回 `00700` / `HSI`，`.HK` 本来就是我们加的）。
  const thscode = market === 'us' && !isIndex ? stem : `${stem}.${market === 'hk' ? 'HK' : 'US'}`
  const assetType = market === 'hk' ? (isIndex ? 'hk-index' : 'hk-stock') : isIndex ? 'us-index' : 'us-stock'
  const entry = keyFormOf(thscode)
  // ⛔ 形状与类型必须互相认账：`ZS` 行给成个股形状（或反过来）说明这一行不是我们能表达的行类，
  // 收进清单就是一行"加得进去、永远取不到数"的条目。宁可少一条候选。
  if (entry === null || !entry.assetTypes.includes(assetType)) return undefined
  const name = typeof row.name === 'string' && row.name.length > 0 ? row.name : thscode
  return { thscode, ticker: stemOf(thscode), name, exchange: market === 'hk' ? 'HK' : 'US', asset_type: assetType }
}

/** 港股代码的"5 位左补零"只有一份实现（内核 `normalizeHkCode`）；判不成立回 `undefined`，不抛。 */
function fiveDigitHk(code) {
  try {
    return normalizeHkCode(code, 'smartbox.code')
  } catch {
    return undefined
  }
}

/**
 * 上游用 `null` 表示"这个数没有"（本仓 `fuyao-rest.ts` 的 `matchesField` 就是为此放行 null 的，
 * 理由是不能让一个指标缺失打挂整份数据）。这里绝不能拿 `Number()` 硬转：`Number(null)` 是 **0**，
 * 停牌 / 未开盘的标的会被写成一份"0.00 元、涨跌 0%"的新快照——顶掉上一次成功的值、页脚照报
 * "刷新于此刻"、还不记任何失败。数字字符串照收（与 `matchesField` 的 number 分支同口径）。
 */
function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function quoteOf(row, sourceTs, capturedAt, currency) {
  const price = numberValue(row.last_price)
  if (price === undefined) return undefined
  const pct = numberValue(row.price_change_ratio_pct)
  const quote = {
    price,
    // **没有涨跌就是没有**，不许补 0：`0` 在 A 股口径里是一个真值（今日平盘），把它写成
    // 停牌 / 未开盘的标的，等于伪造一份"横盘"的新快照顶掉上一次的真涨跌，还不记任何失败。
    // 客户端读到 null 画破折号（与"取不到报价"同一档，而不是红/绿/平三档里的平）。
    change_pct: pct ?? null,
    captured_at: capturedAt,
    source_ts: typeof sourceTs === 'number' ? sourceTs : null,
  }
  // 全仓**唯一**一处写 `CNY` 的地方：Fuyao 的快照回包里没有币种这一列，而面板要每只个股与 ETF
  // 都说清币种（R9）。指数族不写——点位无量纲。港美股那一路的币种从回包取，见 `offshoreQuoteOf`。
  if (currency !== undefined) quote.currency = currency
  return quote
}

/**
 * 腾讯回包一行 → 报价。三条口径与 A 股那一路不同，都在设计文档 §3.5：
 *  - **涨跌**：港股/美股停牌与半日市上游回的是 `+0.00%`（实测 `hk00465`），判据只用内核算好的
 *    `is_stale`（成交额 0 且现价等于昨收）落成 `null`，不自建"接近 0 就当没有"的猜测。
 *    指数行没有 `is_stale` 这一格（内核不给成交额），所以平盘的指数照实回 `0.00`——那是真值。
 *  - **币种**：只有个股/ETF 读 `[75]` / `[35]`（实测 `-R` 柜台那批是 `CNY`，按市场猜必错）；
 *    指数族一律不写，上游在同一位置塞了 `HKD` / `USD` 也不接（点位不是钱）。
 *  - **时刻**：`source_time` 存交易所当地原串，`source_ts`（epoch）留给 Fuyao 那一路，两边不互相
 *    伪造、不换算时区。
 */
function offshoreQuoteOf(row, capturedAt, { withCurrency }) {
  const price = numberValue(row.price)
  if (price === undefined) return undefined
  const stale = row.is_stale === true
  const pct = stale ? undefined : numberValue(row.change_pct)
  const quote = {
    price,
    change_pct: pct ?? null,
    captured_at: capturedAt,
    source_ts: null,
    source_time: typeof row.quote_time === 'string' ? row.quote_time : null,
  }
  const currency = withCurrency && typeof row.currency === 'string' ? row.currency.trim().toUpperCase() : ''
  if (currency.length > 0) quote.currency = currency
  return quote
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
 * @param options.refreshBudgetMs - 一次刷新的总预算；省略时按这次要问的条数算（`refreshBudgetFor`）。
 */
export function createWatchlistService(options = {}) {
  const {
    openDomain,
    resolveApiKey = async () => undefined,
    credentialRef = () => DEFAULT_CREDENTIAL_REF,
    baseUrl = DEFAULT_FUYAO_BASE_URL,
    now = () => Date.now(),
    timeoutMs = SEARCH_TIMEOUT_MS,
    refreshBudgetMs,
  } = options

  let domainPromise
  /** 全局单闸门：开面板与手动刷新共用；后来者等同一次结果，而不是并排放第二个请求。 */
  let refreshing = null

  /**
   * 域只开一次，但**开失败的痕迹不许留下**。`storageDomain` 是 `dsh-storage-domain` 在自己
   * `inject(backendServices, …)` 的回调里才 provide 的——host 平面这一行的预热完全可能跑在它前面，
   * 把 rejection memoize 住就等于"装配期抢跑一次，功能锁到进程结束"（AGENTS.md §9.7 ⑤ 的形状，
   * 与 webServer 那条同一个族）。facility 的 `open()` 失败时已经 `reserved.delete`，所以重试安全。
   */
  const domain = () => {
    if (domainPromise === undefined) {
      const opening = Promise.resolve().then(() => openDomain())
      domainPromise = opening
      opening.catch(() => {
        if (domainPromise === opening) domainPromise = undefined
      })
    }
    return domainPromise
  }
  const table = async () => (await domain()).table('items')

  /**
   * 清单的**读-改-写串行队列**（进程内）。同进程的多个窗口打的是同一条路由、同一份内存域，
   * 所以它们互相看得见；但这里原本没有互斥：`add` 的上限检查发生在最长 15 秒的上游搜索**之前**，
   * 两个并发 `/add` 都先通过 `size >= MAX_ITEMS`、再各写一条 → 清单能写成 31 条（2.5.2 是 11 条）。
   * 刷新写回拿批次快照整条覆写、撤销并发删除与置顶，也是同一族（下面 `doRefresh` 里逐键重读那一处）。
   *
   * 出网**不进**这一道：只有"读当前记录 → 改 → 落盘"这几步排队。否则一次预算 90 秒的刷新会把
   * 用户随后的删除与置顶全堵在门外，而那正是这次审查里用户体验最差的一条。
   *
   * ⛔ 射程只有本进程。跨进程（桌面端 App 与本机的另一个宿主 profile）共用同一个
   * `~/.dsh/storages/capital_watchlist.json`，官方原子写只保证文件不撕裂、不保证不丢更新；
   * 清单必须走官方 storage-domain，本仓不许自建文件锁或文件路径，所以这里的边界是**如实收窄**
   * 而不是解决：写回改成逐键重读之后，跨进程丢失面从"整张清单"缩到"同一只标的的报价那一格"。
   */
  let queue = Promise.resolve()
  function serialize(task) {
    const run = queue.then(task, task)
    // 队列本身不能被一次失败堵住：吞掉这一环的 rejection，让后来者照常跑。
    queue = run.then(() => {}, () => {})
    return run
  }

  async function ensureSeeded() {
    const opened = await domain()
    return serialize(async () => {
      const items = opened.table('items')
      if (opened.global.get().seeded_at !== 0 || items.size > 0) return
      const stamp = now()
      for (const seed of SEED_ITEMS) {
        await items.put(seed.thscode, { ...seed, added_at: stamp, source: 'seed', quote: null })
      }
      await opened.global.set({ seeded_at: stamp, schema: 1 })
    })
  }

  async function callFuyao(path, params, allowed) {
    const ref = credentialRef() || DEFAULT_CREDENTIAL_REF
    const apiKey = await resolveApiKey(ref)
    return fuyaoRequest({ baseUrl, apiKey, path, search: fuyaoQuery(params, allowed), signal: AbortSignal.timeout(timeoutMs) })
  }

  /**
   * 一次输入三路并发：Fuyao `ticker_search` 一笔（`asset_type` 白名单照旧，`limit` 随显示上限抬到
   * 20——官方参数面 1~50，不是我们自己放宽的）\+ smartbox 两笔（`t=hk` / `t=us`，各硬顶 10 条）。
   * 为什么 smartbox 不共用一次 `t=all`：实测 `t=all&q=富通`
   * 回 9 条 A 股 + 1 条 hk + **0 条 us**，`q=00700` 只回 1 条 hk——共用一次会让"美股这一档根本没进
   * 候选"从偶发变成常态，那是"入口统一"最直接的反面（设计文档 P17 / §3.2）。
   * 每一路各自失败只进 `partial`，**只有三路全挂**才整块失败：没配 Fuyao 密钥时港美股照常可加
   * 可刷（R12），`credential_missing` 的射程因此从整块面板缩到 A 股那一路。
   */
  async function search(query) {
    const q = typeof query === 'string' ? query.trim() : ''
    if (q.length === 0 || q.length > MAX_QUERY_LENGTH) {
      return { ok: false, code: 'invalid_query', message: '输入为空或过长' }
    }
    // 先碰存储再出网：域打不开时 `/search` 不该白烧一次上游配额（候选也根本写不进清单）。
    // 存储失败因此从这一路也走响亮那条（路由层的逐次 catch → store_unavailable），不靠预热闩住。
    const items = await table()
    // `SMARTBOX_MARKETS` 是常量表，`t` 的值没有第二条来路：实测上游对不认识的 `t` 回的是 `N`
    // 哨兵——与"查无此票"同一个回文，拼错一次就是静默少一路（§3.6）。
    const branches = await Promise.all([searchAShare(q), ...SMARTBOX_MARKETS.map((market) => searchOffshore(q, market))])
    const failures = branches.filter((branch) => branch.ok !== true)
    if (failures.length === branches.length) {
      // 全挂才占用居中位。代码挑"用户还能动手"的那一路：密钥 → 限流 → 服务不通。
      const worst = worstProblem(failures)
      return { ok: false, code: worst.code, message: messageFor(worst.code, 'all'), scope: 'all' }
    }
    const merged = mergeCandidates(branches.filter((branch) => branch.ok === true).flatMap((branch) => branch.rows), q)
    const result = {
      ok: true,
      items: merged.slice(0, SEARCH_LIMIT).map((row) => ({ ...row, in_list: items.get(row.thscode) !== undefined })),
      // 两种"还有更多"都要说实话：某一路自己回满了**它那一档**的上限（上游那侧被砍），或合并后
      // 超过一屏（我们这一侧被砍）。两档数字不同，所以逐路按 `SEARCH_BRANCH_LIMITS` 判。
      truncated: merged.length > SEARCH_LIMIT || branches.some((branch) => branch.ok === true && branch.rows.length >= SEARCH_BRANCH_LIMITS[branch.market]),
    }
    if (failures.length > 0) result.partial = failures.map((failure) => ({ market: failure.market, code: failure.code }))
    return result
  }

  /** A 股那一路。⛔ 不许拿港美股那两条白名单顺手再过滤一遍：这边已有 `asset_type` + 键形状两道闸。 */
  async function searchAShare(q) {
    try {
      const envelope = await callFuyao(ENDPOINTS.search, { q, asset_type: SEARCH_ASSET_TYPES, limit: SEARCH_BRANCH_LIMITS['a-share'] }, ['q', 'asset_type', 'limit'])
      // 后缀也要收口：实测 `q=宁德时代` 会带回 `885789.TI 宁德时代概念`（同花顺指数），
      // 它既不在本版报价范围、也过不了域 schema——不挡掉就是"添加"那一下 500。
      return { ok: true, market: 'a-share', rows: fuyaoItems(envelope).map(candidateOf).filter((row) => ASSET_TYPES.includes(row.asset_type) && normalizeThscode(row.thscode) !== undefined) }
    } catch (error) {
      return { ok: false, market: 'a-share', code: watchlistErrorCode(error) }
    }
  }

  /** smartbox 那两路之一：类型白名单 + 键形状一起收，衍生品（窝轮 `QZ`）不进候选。 */
  async function searchOffshore(q, market) {
    try {
      const found = await fetchSmartbox(q, market, AbortSignal.timeout(timeoutMs))
      return { ok: true, market, rows: found.map((row) => offshoreCandidateOf(row, market)).filter((row) => row !== undefined) }
    } catch (error) {
      return { ok: false, market, code: watchlistErrorCode(error, { source: 'tencent' }) }
    }
  }

  /**
   * 合并三路：按 canonical 键去重（同一只票从任一路加过，另一路那条也标"已添加"），
   * **输入完全等于代码的行排最前**（比对到 stem：`00700` 要认 `00700.HK`、`TCEHY` 要认 `TCEHY.PS`），
   * 其余保持上游顺序（A 股 → 港 → 美）。`Array.prototype.sort` 是稳定排序，同分不换序。
   */
  function mergeCandidates(rows, q) {
    const seen = new Map()
    for (const row of rows) {
      if (row.thscode.length > 0 && !seen.has(row.thscode)) seen.set(row.thscode, row)
    }
    const needle = q.trim().toUpperCase()
    return [...seen.values()].sort((left, right) => exactness(right, needle) - exactness(left, needle))
  }
  function exactness(row, needle) {
    if (needle.length === 0) return 0
    if (row.thscode === needle) return 2
    return stemOf(row.thscode) === needle ? 1 : 0
  }

  /** 三路全挂时挑一句最能指导动作的错误码。 */
  function worstErrorCode(codes) {
    for (const candidate of ['credential_missing', 'rate_limited', 'invalid_query', 'fuyao_unavailable', 'tencent_unavailable']) {
      if (codes.includes(candidate)) return candidate
    }
    return codes[0] ?? 'fuyao_unavailable'
  }

  async function list() {
    await ensureSeeded()
    const opened = await domain()
    return { ok: true, items: rowsOf(opened.table('items')), seeded_at: opened.global.get().seeded_at }
  }

  async function add(input) {
    await ensureSeeded()
    const items = await table()
    // `limit` 跟着回包走：客户端那句「最多 N 条，先删一条再加」不许自己抄一份数字（2.5.2 就是
    // 服务端常量 10 + 中文字典写死"10"两处各写一遍，抬上限只会改红一边）。
    const full = () => ({ ok: false, code: 'list_full', limit: MAX_ITEMS, message: `自选股最多 ${MAX_ITEMS} 条，先删一条再加` })

    // 先到上限就不出网（一次搜索也是配额）；**这挡不住并发**，锁里还要再验一次，见下。
    if (items.size >= MAX_ITEMS) return full()

    const direct = input?.thscode
    if (direct !== undefined && direct !== null && direct !== '') {
      const thscode = normalizeThscode(direct)
      if (thscode === undefined) {
        return { ok: false, code: 'invalid_query', message: '代码格式不符：要带市场或交易所后缀的完整代码，例如 300750.SZ / 00700.HK / HSI.HK / AAPL.OQ / IXIC.US' }
      }
      const entry = keyFormOf(thscode)
      // 存在性核对用**上游认的那个写法**问：A 股沿用带后缀的完整代码（Fuyao 那侧本来就是它给的身份），
      // 港美股只能问 stem——实测把 canonical 键原样丢给 smartbox 一律回 `N` 哨兵（`00700.HK`、
      // `TCEHY.PS`、`HSI.HK`、`IXIC.US` 全都不回行），拿它当"查无此票"会把一只真票判成不存在。
      const found = await search(entry.form === 'a-share' ? thscode : stemOf(thscode))
      if (!found.ok) return found
      const hit = found.items.find((row) => row.thscode === thscode)
      if (hit === undefined) return { ok: false, code: 'not_found', message: `该标的不在本版支持范围（${FORM_SCOPE_TEXT[entry.form] ?? '可检索的证券代码'}）` }
      return serialize(() => {
        // 出网最长 15 秒，这期间别的窗口可能已经填满：上限必须在"读 size → put"这一段的锁内复查。
        if (items.size >= MAX_ITEMS) return full()
        return write(hit, items)
      })
    }

    const found = await search(input?.q)
    if (!found.ok) return found
    if (found.items.length === 0) return { ok: false, code: 'not_found', message: '没有找到该标的' }
    if (found.items.length > 1) return { ok: false, code: 'ambiguous', message: '命中多条，请从候选里选一条', candidates: found.items }
    return serialize(() => {
      if (items.size >= MAX_ITEMS) return full()
      return write(found.items[0], items)
    })
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
    return serialize(async () => ({ ok: true, removed: await items.delete(thscode) }))
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
    // 读 → 改 → 写在同一环里：否则"取到旧记录"与"put 回去"之间正好删了这一行，
    // 置顶会把刚删掉的标的连同它的旧报价一起写回来（和刷新写回同一族，见 `doRefresh`）。
    return serialize(async () => {
      const existing = items.get(thscode)
      if (existing === undefined) return { ok: false, code: 'not_found', message: '该标的不在自选清单里' }
      await items.put(thscode, { ...existing, pinned_at: now() })
      return { ok: true, items: rowsOf(items) }
    })
  }

  /** 一个分组 = 一次快照请求（只有场内 ETF 那一档是逐只）；单组失败只记该组，不拖垮其它组。 */
  function fetchGroup(group) {
    return group.kind === 'tencent' ? fetchOffshoreGroup(group) : fetchFuyaoGroup(group)
  }

  async function fetchFuyaoGroup(group) {
    const capturedAt = now()
    let envelope
    try {
      envelope = await callFuyao(group.path, group.params, group.allowed)
    } catch (error) {
      const code = watchlistErrorCode(error, { perItem: true })
      const batch = batchLevelCode(error)
      return {
        byCode: new Map(),
        failures: group.keys.map((thscode) => ({ thscode, code })),
        batchError: batch !== undefined ? { code: batch, scope: group.scope } : undefined,
      }
    }
    const sourceTs = fuyaoTimestamp(envelope)
    const byCode = new Map()
    for (const row of fuyaoItems(envelope)) {
      const thscode = typeof row.thscode === 'string' ? row.thscode : ''
      const quote = quoteOf(row, sourceTs, capturedAt, group.currency)
      if (thscode !== '' && quote !== undefined) byCode.set(thscode, quote)
    }
    return {
      byCode,
      failures: group.keys.filter((thscode) => !byCode.has(thscode)).map((thscode) => ({ thscode, code: 'quote_unavailable' })),
      batchError: undefined,
    }
  }

  /**
   * 港美股一档 = 该市场这一族的一次批量（清单上限 30，永远在实测的 ≤50 之内）。
   * 取数与守卫全部走内核（同一节流链、同一张字段位序表）；这一层只负责**身份核对**：
   * 回包第 2 位推回来的 canonical 键必须正是我们问出去的那一只，否则这一行**不落价**，
   * 让它照实落在 `quote_unavailable`（设计文档 §3.4 / §3.9 第 4 点：实测 `usSSPX` 会回一只
   * 真 ETF 且不报错，只比 stem 抓不住，形状由内核的守卫给、身份由这一句"必须是问出去的那只"给）。
   * 这一句同时就是日志：面板那一格写着"取不到报价"，用户看得见，不存在静默丢弃。
   */
  async function fetchOffshoreGroup(group) {
    const capturedAt = now()
    let rows
    try {
      const signal = AbortSignal.timeout(timeoutMs)
      rows = group.index ? await fetchOffshoreIndexQuotes(group.market, group.codes, signal) : await fetchOffshoreQuotes(group.market, group.codes, signal)
    } catch (error) {
      const batch = batchLevelCode(error, 'tencent')
      return {
        byCode: new Map(),
        failures: group.keys.map((thscode) => ({ thscode, code: watchlistErrorCode(error, { perItem: true, source: 'tencent' }) })),
        batchError: batch !== undefined ? { code: batch, scope: group.scope } : undefined,
      }
    }
    const requested = new Set(group.keys)
    const byCode = new Map()
    for (const row of rows) {
      const thscode = offshoreKeyOf(row, group)
      if (!requested.has(thscode)) continue
      const quote = offshoreQuoteOf(row, capturedAt, { withCurrency: group.withCurrency })
      if (quote !== undefined) byCode.set(thscode, quote)
    }
    return {
      byCode,
      failures: group.keys.filter((thscode) => !byCode.has(thscode)).map((thscode) => ({ thscode, code: 'quote_unavailable' })),
      batchError: undefined,
    }
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
    // 这份快照**只用来决定这次要问哪些代码**，不是写回的基底（写回逐键重读，见下）。
    const batch = rowsOf(items)
    if (batch.length === 0) return { ok: true, items: [], refreshed_at: null, failures: [] }

    // 七档分组：A 股个股 / A 股指数各一次逗号批量、场内 ETF 逐只、港个股与港指数各一次批量、
    // 美个股与美指数各一次批量。分派判据是**键的形状与 `asset_type` 互相认账**（同一张 `KEY_FORMS`
    // 表，与加入清单时同一条），不认账的行不进任何一组、照实记 `quote_unavailable`——
    // 磁盘上被人改过的那一格不能让一行港股流进 Fuyao 端点（那边根本不认它，反之亦然）。
    const groups = []
    const failures = []
    const keysByType = new Map()
    for (const row of batch) {
      if (quoteRoute(row) === undefined) {
        failures.push({ thscode: row.thscode, code: 'quote_unavailable' })
        continue
      }
      const list = keysByType.get(row.asset_type)
      if (list === undefined) keysByType.set(row.asset_type, [row.thscode])
      else list.push(row.thscode)
    }
    for (const [assetType, template] of FUYAO_TEMPLATES) {
      const keys = keysByType.get(assetType) ?? []
      if (keys.length === 0) continue
      if (!template.batch) {
        for (const thscode of keys) groups.push({ kind: 'fuyao', path: template.path, allowed: template.allowed, params: { thscode }, keys: [thscode], scope: template.scope, currency: template.currency })
      } else {
        groups.push({ kind: 'fuyao', path: template.path, allowed: template.allowed, params: { thscodes: keys.join(',') }, keys, scope: template.scope, currency: template.currency })
      }
    }
    for (const spec of OFFSHORE_SPECS) {
      const keys = keysByType.get(spec.assetType) ?? []
      if (keys.length === 0) continue
      const { group, failures: unwritable } = offshoreGroup(spec, keys)
      for (const failure of unwritable) failures.push(failure)
      if (group !== undefined) groups.push(group)
    }

    const budgetMs = refreshBudgetMs ?? refreshBudgetFor(batch.length)
    const startedAt = now()
    const results = new Array(groups.length)
    // `cursor` 的自增在单线程里是原子的：每个工作线程领到一个**独占**的组号。
    let cursor = 0
    const worker = async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        if (index >= groups.length) return
        // 0 号组永远跑（否则一次都刷不动）；之后每领一组先看预算：超了就停在这里，
        // 剩下的行如实记 refresh_timeout——它们这次没被问过，不是"没有报价"。
        if (index > 0 && now() - startedAt >= budgetMs) return
        results[index] = await fetchGroup(groups[index])
      }
    }
    await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, groups.length) }, () => worker()))

    // 按**组序**归并，不按完成序：回包里的 failures 顺序是断言与面板读法的依赖，
    // 并发不能把它变成"谁先回来谁在前"。
    const quotes = new Map()
    const problems = []
    let failedGroups = 0
    for (let index = 0; index < groups.length; index += 1) {
      const result = results[index]
      if (result === undefined) {
        for (const thscode of groups[index].keys) failures.push({ thscode, code: 'refresh_timeout' })
        continue
      }
      for (const [thscode, quote] of result.byCode) quotes.set(thscode, quote)
      for (const failure of result.failures) failures.push(failure)
      if (result.batchError !== undefined) {
        failedGroups += 1
        problems.push(result.batchError)
      }
    }

    // 写回整段进串行队列，并且**逐键重读当前记录**，只换 quote 那一格：
    // 拿批次快照整条覆写会撤销刷新在途期间用户的两个动作——刚删的标的被原样写回来
    // （还重新占掉一格），刚置顶的被旧记录里的空 pinned_at 盖掉、静默掉回原位。
    // 面板一打开就自动刷新，所以这扇窗几乎每次都开着；ETF 逐只扇出时它最宽。
    const written = await serialize(async () => {
      let count = 0
      for (const [thscode, quote] of quotes) {
        const fresh = items.get(thscode)
        if (fresh === undefined) continue // 在途被删：不复活、不占格。
        await items.put(thscode, { ...fresh, quote })
        count += 1
      }
      return { count, items: rowsOf(items) }
    })
    // 一条都没落地就不报"刷新于此刻"：页脚那个时间讲的是最后一次**真取到数**的时刻，
    // 跟着一次全失败的点击往前走，就成了每一行都陈旧、只有页脚是新的（客户端据此保留上一个值）。
    const result = { ok: true, items: written.items, refreshed_at: written.count > 0 ? now() : null, failures }
    // ⛔ `scope` 的语义纪律：**只有整块一次都没成功**（每个分组都报了批级失败）才允许 `all`，
    // 面板据此决定要不要占用居中位。把"半边失败"说成"服务不可用"就是面板对用户说谎。
    if (problems.length > 0) {
      const worst = worstProblem(problems)
      const scope = failedGroups === groups.length && groups.length > 0 ? 'all' : worst.scope
      result.error = { code: worst.code, message: messageFor(worst.code, scope), scope }
    }
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

/** 只有会把**整批**都打挂的失败才升格成 batch error（限流 / 没配 key / 某一家服务不通）。 */
function batchLevelCode(error, source = 'fuyao') {
  const code = watchlistErrorCode(error, { source })
  return ['credential_missing', 'rate_limited', 'fuyao_unavailable', 'tencent_unavailable'].includes(code) ? code : undefined
}

/**
 * 多路失败时挑一句最能指导动作的：密钥缺失是唯一"用户现在就能自己修"的，其次是限流，
 * 最后才是服务不通。`scope` 跟着这一条走（谁最该被修，就报谁的射程）。
 */
const ERROR_CODE_PRIORITY = ['credential_missing', 'rate_limited', 'invalid_query', 'fuyao_unavailable', 'tencent_unavailable']
function worstProblem(problems) {
  for (const code of ERROR_CODE_PRIORITY) {
    const found = problems.find((problem) => problem.code === code)
    if (found !== undefined) return found
  }
  return problems[0]
}

/** 错误码 → 用户看得见的一句话。`scope` 只用来决定"行情服务"要不要点名是哪一路（A 股 / 港美股）。 */
function messageFor(code, scope) {
  if (code === 'credential_missing') return '未配置 Fuyao 密钥：在「插件」页的 Capital 模式卡片里填 API Key（只影响 A 股那一路，港美股照常用）'
  if (code === 'rate_limited') return '行情服务限流，请稍后再试'
  if (code === 'invalid_query') return '输入不被接受'
  if (code === 'tencent_unavailable') return scope === 'a-share' ? '行情服务暂时不可用，请稍后再试' : '港美股行情暂时取不到，请稍后再试'
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
  tencent_unavailable: 502,
  store_unavailable: 503,
}

/**
 * 路由：GET 走 query，POST 走 JSON body。
 *
 * @param service - `createWatchlistService` 的返回。
 * @param options.authorize - `(req) => 401 | 403 | undefined`，接 `connection.requestRejection`。
 */
export function createRouteHandler(service, options = {}) {
  const { authorize } = options

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
      send(res, 503, { ok: false, code: 'store_unavailable', message: '自选股存储不可用', cause: storeCause(error) })
    }
  }
}

/**
 * 存储侧失败的对外一句话：code 与 message 都要留。只留 code 运维看的是天书（实测
 * `malformed-medium` 单独出现时完全指不出是哪份介质、哪一步），只留 message 又丢掉
 * `backend-not-found` / `invalid-record` 这类可定位的判据。
 */
function storeCause(error) {
  return [error?.code, error?.message ?? error].filter(Boolean).join('：') || 'unknown'
}

function sendBusiness(res, result) {
  if (result.ok === true) return send(res, 200, result)
  return send(res, FAILURE_STATUS[result.code] ?? 400, result)
}

export function apply(ctx) {
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

  // 预热一次只为了把"域打不开"写进启动日志。它**不设闩**：真正的响亮失败在每条路由的逐次
  // catch 里（`store_unavailable`），而预热跑在装配期，此刻 `storageDomain` 完全可能还没
  // provide——把这一次失败当结论钉住，就是"抢跑一次锁到进程结束"（见 `domain()`）。
  service.list().catch((error) => {
    ctx.logger?.error?.(`capital-watchlist: 域预热失败，下一次动作会重试（${storeCause(error)}）`)
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
          handler: createRouteHandler(service, { authorize }),
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
