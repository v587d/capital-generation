/**
 * 数据源契约巡检 runner（设计见 `docs/design/data-source-contract-probe.md`）。
 *
 * 三条不可让的规矩，都是本仓付过学费的：
 * 1. **只走生产的 `execute()` / `validateOutput()`**，本文件不出现第二个 URL、第二份字段清单。
 * 2. **限速复用进程级单例**（`sharedEastmoneyThrottle` / `tencentThrottle`）——同一个出口 IP 上
 *    两份独立节流等于没节流（`src/net/eastmoney-client.ts:6-8`）。
 * 3. **不重试**。生产侧对 429 的一致态度是「分类，不是控制回路的输入」；重试会把一次抖动
 *    变成两个都看起来很权威的数据点。
 *
 * ⛔ 输出里不许出现密钥、完整 query string 或响应正文——Issue 是公开的（设计 §6.2）。
 */
import { createRequestThrottle } from '../../lib/net/throttle.js'
import { sharedEastmoneyThrottle, createEastmoneyClient } from '../../lib/net/eastmoney-client.js'
import { createFuyaoRestSources } from '../../lib/sources/fuyao-rest.js'
import { createEastmoneySources } from '../../lib/sources/eastmoney-http.js'
import { createTencentSources } from '../../lib/sources/tencent-http.js'
import {
  createSourceTransport, createGatedEastmoneyTransport,
  clsTelegraph, wscnLives, cninfoIrm, sseinfoQa,
  eastmoneyFastNews, eastmoneyStockNews, eastmoneyReports, sinaReports, thsEpsForecast,
} from '../../lib/web-retriever/sources.js'
import { createAnySearchClient } from '../../lib/web-retriever/engines.js'
import { createWindRpc, WIND_BASE } from './wind-rpc.mjs'
import { resolveCredential } from './credentials.mjs'
import {
  probesForTier, secretRefOf, stateOf, PROVIDER_GAP_MS, FUYAO_PROBE_GAP_MS, ISSUE_VERDICTS,
} from './contract-registry.mjs'

/** 只有这三类判据开 Issue；定义在注册表里，这里转出是为了让 runner 与报告共用一个名字。 */
export { ISSUE_VERDICTS }

/** 与 `src/index.ts` 的 `LOCAL_FETCH_DEFAULTS.userAgent` 同值——巡检走用户走的那条路。 */
const USER_AGENT = '@v587d/capital-generation'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 看起来像网络/路由问题的错误——它不是上游契约失败，绝不进 Issue。 */
const TRANSPORTISH = /fetch failed|UND_ERR|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket|timed out|TimeoutError|aborted|预算被中止/i
/** 各家把 HTTP 状态写在消息里，形态不统一，所以几种写法都认。 */
const HTTP_IN_MESSAGE = /HTTP\s*(\d{3})|http_(\d{3})|returned HTTP (\d{3})/

function httpStatusOf(error) {
  if (typeof error?.status === 'number') return error.status
  const matched = HTTP_IN_MESSAGE.exec(error?.message ?? '')
  return matched ? Number(matched[1] ?? matched[2] ?? matched[3]) : undefined
}

/** Fuyao 的业务码骑在 HTTP 200 上，只出现在消息文本里（`fuyao-core.ts` 抛的形态）。 */
function upstreamCodeOf(error) {
  const message = error?.message ?? ''
  return /Fuyao API error (\d+)/.exec(message)?.[1]
    ?? /code[=:\s]+(\d{4})/i.exec(message)?.[1]
    ?? (typeof error?.code === 'string' && /^\d{4}$/.test(error.code) ? error.code : undefined)
}

/**
 * 上游明确说"这个标的 / 这个区间就是没有记录"——合法空结果，不是链路故障。
 * 混进 TRANSPORT 会让真故障被噪声淹没；混进 GUARD 会让人去改没坏的映射表。
 */
const EMPTY_RESULT_CODES = new Set(['eastmoney_no_billboard_data', 'NOT_FOUND'])
/** 参数被上游拒了 = 注册表里的样本不对，是我方缺陷；归进 ENVELOPE 让它开单，别藏在噪声里。 */
const PARAM_REJECT_CODES = new Set(['eastmoney_invalid_ticker', 'tencent_invalid_param'])
/**
 * AnySearch **替目标站**报的错：取不到正文、目标封了、内容类型不支持、超长。
 * 这些说明 `/v1/extract` 端点本身契约完好——它正确地把一个下游问题报了回来。
 * 巡检测的是 AnySearch，不是 www.gov.cn 那天开不开门；把它算成失败就是每天看一条无法修的警报。
 */
const TARGET_SIDE_MARKERS = /extract_failed|target_blocked|unsupported_content|content_too_large|Unable to extract content/i

/**
 * 把一次调用的结果归进闭集判据。顺序即优先级：先认结构失败，再谈空与慢。
 * `TRANSPORT` 是最后的兜底——凡是认不出别的，都当成"我们这条链路的问题"，不开单。
 */
export function classify({ error, guardOk, rowCount, minRows, ms, budgetMs, identityMismatch, knownCodes = [] }) {
  if (error) {
    const message = String(error.message ?? '')
    const code = upstreamCodeOf(error)
    if (code) return knownCodes.includes(code) ? 'PASS' : 'ENVELOPE'
    if (EMPTY_RESULT_CODES.has(error.code)) return 'EMPTY'
    if (PARAM_REJECT_CODES.has(error.code)) return 'ENVELOPE'
    if (TARGET_SIDE_MARKERS.test(message)) return 'PASS'
    const status = httpStatusOf(error)
    if (status === 429 || /rate_limit/i.test(String(error.code ?? ''))) return 'HTTP_STATUS'
    if (status && !TRANSPORTISH.test(message)) return 'HTTP_STATUS'
    return 'TRANSPORT'
  }
  if (guardOk === false || identityMismatch) return 'GUARD'
  if (rowCount === 0 && minRows > 0) return 'EMPTY'
  if (ms > budgetMs) return 'SLOW'
  return 'PASS'
}

/** 行数组在哪：照 `schema.rowShape` 这道权威提示找，不猜。 */
export function rowsOf(data, rowShape) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  for (const key of rowShape?.rowKeys ?? [rowShape?.rowKey ?? 'item', 'item']) {
    if (Array.isArray(data[key])) return data[key]
  }
  return []
}

/** 从 `output_schema` 取期望行键——字段判据的"期望"那一侧，不另写一份。 */
export function expectedRowKeys(outputSchema) {
  const item = outputSchema?.properties?.item ?? (outputSchema?.type === 'array' ? outputSchema : undefined)
  const props = item?.items?.properties ?? item?.properties
  return props ? Object.keys(props) : []
}

function diffKeys(expected, actual) {
  return { missing: expected.filter((k) => !actual.includes(k)), added: actual.filter((k) => !expected.includes(k)) }
}

/** 按点路径取嵌套值（`item.0.manager_info.0.manager_id`），取不到返回 undefined。 */
function pickPath(root, path) {
  return path.split('.').reduce((node, token) => (node == null ? node : node[token]), root)
}

function buildSources() {
  const fuyaoKey = resolveCredential('FUYAO_API_KEY')
  const map = new Map()
  for (const source of [...createFuyaoRestSources(async () => fuyaoKey), ...createEastmoneySources(), ...createTencentSources()]) {
    map.set(source.schema.capability, source)
  }
  return map
}

const abortSignal = () => new AbortController().signal

function buildProbeTable() {
  const transport = createSourceTransport({ enabled: true, timeoutMs: 30_000, userAgent: USER_AGENT })
  // 与生产同一份进程级节流 + 同一个闸门 transport：巡检测的是用户走的那条路，不是第二条路。
  const eastmoneyClient = createEastmoneyClient({
    userAgent: USER_AGENT,
    throttle: sharedEastmoneyThrottle(),
    transport: createGatedEastmoneyTransport(transport),
  })
  const anysearch = createAnySearchClient(undefined, async () => resolveCredential('ANYSEARCH_API_KEY'))
  return {
    cls_telegraph: () => clsTelegraph(transport, { limit: 3, signal: abortSignal() }),
    wscn_lives: (p) => wscnLives(transport, { ...p, signal: abortSignal() }),
    cninfo_irm: (p) => cninfoIrm(transport, { ...p, signal: abortSignal() }),
    sseinfo_qa: (p) => sseinfoQa(transport, { ...p, signal: abortSignal() }),
    sseinfo_qa_company: (p) => sseinfoQa(transport, { ...p, signal: abortSignal() }),
    eastmoney_724: (p) => eastmoneyFastNews(eastmoneyClient, { ...p, signal: abortSignal() }),
    eastmoney_stock_news: (p) => eastmoneyStockNews(eastmoneyClient, { ...p, signal: abortSignal() }),
    eastmoney_reports: (p) => eastmoneyReports(eastmoneyClient, { ...p, signal: abortSignal() }),
    sina_reports: (p) => sinaReports(transport, { ...p, signal: abortSignal() }),
    ths_eps_forecast: (p) => thsEpsForecast(transport, { ...p, signal: abortSignal() }),
    anysearch_search: (p) => anysearch.search(p, abortSignal()),
    anysearch_extract: (p) => anysearch.extract(p, abortSignal()),
  }
}

/** Wind 协议级探针：initialize + tools/list，**不计费**（取数级刻意不接，设计 §10 第 1 条）。 */
async function runWindProtocol(entry) {
  const rpc = createWindRpc({
    endpoint: `${WIND_BASE}/${entry.server}/mcp/`,
    resolveApiKey: async () => resolveCredential('WIND_API_KEY'),
    timeoutMs: entry.abortMs ?? entry.budgetMs,
  })
  await rpc.initialize()
  const listed = await rpc.toolsList()
  return Array.isArray(listed?.tools) ? listed.tools : []
}

/** 家族顺序 = 出网顺序：一家打完再换下一家，绝不让两家的请求交错。 */
const FAMILY_ORDER = ['fuyao', 'eastmoney', 'tencent', 'retriever', 'anysearch', 'wind']

/**
 * ⚠️ 东财 / 腾讯 / 具名来源**绝不能再包一层节流**：它们的 `execute()` 内部已经过
 * `sharedEastmoneyThrottle()` / `tencentThrottle` 那条链了。把同一个单例套在自己外面 =
 * 外层任务占着链等内层完成、内层排在同一条约链的后头等外层让位——**自锁**，
 * 表现是第一条探针就永久挂住（实测踩过）。这些家的节奏由生产代码负责，巡检只负责别添乱。
 */
const NO_PACE = (task) => task()

function pacerFor(family) {
  // Fuyao 生产侧是裸 fetch、没有任何最小间隔（只靠 Hub 串行），巡检进程里没有 Hub，所以自己加地板。
  if (family === 'fuyao') return createRequestThrottle(FUYAO_PROBE_GAP_MS)
  if (family === 'eastmoney' || family === 'tencent' || family === 'retriever') return NO_PACE
  return createRequestThrottle(1_000)
}

/**
 * 开工前凭据闸门：缺 key 就红，**一个请求都不发**。
 * 理由不是"少发几个请求"——是 AnySearch 缺 key 照样返回 200 + 真结果，让它跑起来就是假绿。
 */
export function assertCredentials(entries) {
  const needed = [...new Set(entries.map(secretRefOf).filter(Boolean))].sort()
  const missing = needed.filter((ref) => !resolveCredential(ref))
  if (missing.length > 0) {
    throw new Error(`缺少凭据：${missing.join(', ')}。请到仓库 Settings → Secrets and variables → Actions 补上。`
      + '（本次档位在发任何请求之前就该停——红 = 我方配置问题，Issue = 上游问题，两个信道不混。）')
  }
  return needed
}

/** Fuyao 的 manager_id / company_id 不许编造：从真实响应解析，解析不出就把依赖它的条目记 SKIPPED。 */
async function resolveIdentifiers(entries, sources, log) {
  const found = {}
  for (const ref of new Set(entries.map((e) => e.requires).filter(Boolean))) {
    const provider = entries.find((e) => e.requires === ref)?.resolveFrom
    const source = provider ? sources.get(provider.capability) : undefined
    if (!source) continue
    for (let attempt = 0; attempt < 3 && found[ref] === undefined; attempt += 1) {
      try {
        const output = await source.execute(
          { capability: source.schema.capability, params: provider.params, session: { id: 'contract-probe' } },
          new AbortController().signal,
        )
        found[ref] = pickPath(output.data, provider.path)
      } catch (error) {
        if (attempt === 2) log(`  ${ref} 解析失败：${String(error.message).slice(0, 100)}`)
        await sleep(1_500 * (attempt + 1))
      }
    }
    if (found[ref] === undefined) log(`  解析不出 ${ref}：依赖它的条目一律记 SKIPPED（编造 id 会得到 5003，那是脚本问题不是上游故障）`)
  }
  return found
}

async function runOne({ entry, sources, probes, identifiers }) {
  const base = { capability: entry.capability, family: entry.family, tier: entry.tier, state: stateOf(entry), budgetMs: entry.budgetMs }
  if (entry.requires && identifiers[entry.requires] === undefined) {
    return { ...base, verdict: 'SKIPPED', ms: 0, detail: `解析不出 ${entry.requires}` }
  }
  const params = entry.requires ? { ...entry.params, [entry.requires]: identifiers[entry.requires] } : { ...entry.params }
  const abortMs = entry.abortMs ?? Math.max(entry.budgetMs, 30_000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('probe budget exhausted')), abortMs)
  const started = Date.now()
  try {
    let rows
    let guardOk = true
    let expected = []
    if (entry.face === 'datasource') {
      const source = sources.get(entry.capability)
      const output = await source.execute({ capability: entry.capability, params, session: { id: 'contract-probe' } }, controller.signal)
      rows = rowsOf(output.data, source.schema.rowShape)
      guardOk = source.validateOutput ? source.validateOutput(output.data) : true
      expected = expectedRowKeys(source.schema.output_schema)
    } else if (entry.family === 'wind') {
      rows = await runWindProtocol(entry)
    } else {
      const run = probes[entry.capability]
      if (typeof run !== 'function') throw new Error(`注册表里有 ${entry.capability}，但 runner 的 probeTable 没有对应实现`)
      const outcome = await run(params)
      rows = Array.isArray(outcome?.items) ? outcome.items : Array.isArray(outcome?.results) ? outcome.results : Array.isArray(outcome) ? outcome : []
    }
    const ms = Date.now() - started
    const actual = rows.length > 0 && typeof rows[0] === 'object' ? Object.keys(rows[0]) : []
    const identity = entry.expect?.identity
    return {
      ...base, ms, rows: rows.length,
      verdict: classify({
        guardOk, rowCount: rows.length, minRows: entry.expect?.minRows ?? 0, ms,
        budgetMs: entry.budgetMs, knownCodes: entry.knownCodes,
        identityMismatch: identity ? rows[0]?.[identity.field] !== identity.value : false,
      }),
      // 这是 Issue 里最能缩短修复时间的一栏：期望键 vs 实得键，只有键名，没有值。
      keyDiff: expected.length > 0 && actual.length > 0 ? diffKeys(expected, actual) : undefined,
      actualKeys: expected.length === 0 && actual.length > 0 ? actual.slice(0, 12) : undefined,
    }
  } catch (error) {
    const aborted = controller.signal.aborted
    const wrapped = aborted ? Object.assign(new Error(`超出 ${abortMs}ms 预算被中止`), { code: 'TIMEOUT' }) : error
    return {
      ...base, ms: Date.now() - started,
      verdict: classify({ error: wrapped, budgetMs: entry.budgetMs, knownCodes: entry.knownCodes }),
      code: typeof wrapped?.code === 'string' ? wrapped.code : undefined,
      httpStatus: httpStatusOf(wrapped), upstreamCode: upstreamCodeOf(wrapped),
      detail: String(wrapped?.message ?? wrapped).slice(0, 160),
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function runContractProbes({ tier = 'daily', only, family, log = (text) => console.error(text) } = {}) {
  let entries = probesForTier(tier)
  if (family) entries = entries.filter((entry) => entry.family === family)
  if (only) entries = entries.filter((entry) => entry.capability.includes(only))
  // trading_calendar 排最前：它决定后面所有 EMPTY 该怎么解释。
  entries = [...entries].sort((a, b) => Number(b.capability === 'trading_calendar') - Number(a.capability === 'trading_calendar'))

  const needed = assertCredentials(entries)
  log(`档位 ${tier}：${entries.length} 条真打；需要凭据 ${needed.join(', ') || '（无）'}`)

  const sources = buildSources()
  const probes = buildProbeTable()
  const identifiers = await resolveIdentifiers(entries, sources, log)

  const results = []
  for (const family of FAMILY_ORDER) {
    const group = entries.filter((entry) => entry.family === family)
    if (group.length === 0) continue
    const pace = pacerFor(family)
    log(`── ${family}（${group.length} 条）`)
    for (const entry of group) {
      const result = await pace(() => runOne({ entry, sources, probes, identifiers }))
      results.push(result)
      const tag = result.state === 'shadow' ? `${result.verdict}→影子` : result.verdict
      log(`  ${tag.padEnd(15)} ${String(result.ms).padStart(6)}ms  ${result.capability}${result.detail ? `  ${result.detail}` : ''}`)
    }
    await sleep(PROVIDER_GAP_MS)
  }

  const active = results.filter((r) => r.state === 'active')
  const failing = active.filter((r) => ISSUE_VERDICTS.includes(r.verdict))
  return {
    at: new Date().toISOString(), tier, results,
    counts: {
      total: results.length,
      pass: active.filter((r) => r.verdict === 'PASS').length,
      slow: active.filter((r) => r.verdict === 'SLOW').length,
      empty: active.filter((r) => r.verdict === 'EMPTY').length,
      transport: active.filter((r) => r.verdict === 'TRANSPORT').length,
      skipped: active.filter((r) => r.verdict === 'SKIPPED').length,
      shadow: results.filter((r) => r.state === 'shadow').length,
      failing: failing.length,
    },
    // ⛔ 只有这一份进 Issue；TRANSPORT / SLOW / EMPTY 一律留在 summary，不开单。
    failing,
  }
}
