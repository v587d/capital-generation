/**
 * Contract-probe runner. Only production execute()/validateOutput() (no second URL, no second field
 * list), only the shared process-wide throttles (two chains on one egress IP is no throttle), and
 * no retries (a retry turns one blip into two authoritative points).
 * ⛔ Output carries no secrets, query strings or response bodies: issues are public.
 */
import { createRequestThrottle } from '../../lib/net/throttle.js'
import { sharedEastmoneyThrottle, createEastmoneyClient } from '../../lib/net/eastmoney-client.js'
import { createFuyaoRestSources } from '../../lib/sources/fuyao-rest.js'
import { createFtshareSources } from '../../lib/sources/ftshare-rest.js'
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
  resolveDayShifts,
} from './contract-registry.mjs'

/** Only these verdicts open an issue; the list lives in the registry (pure data module). */
export { ISSUE_VERDICTS }

/** Same value as `LOCAL_FETCH_DEFAULTS.userAgent` in src/index.ts: probes take the user's path. */
const USER_AGENT = '@v587d/capital-generation'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Network / routing trouble — never an upstream contract failure, never an issue. */
const TRANSPORTISH = /fetch failed|UND_ERR|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket|timed out|TimeoutError|aborted|预算被中止/i
/** Providers format HTTP status into messages inconsistently, so accept several shapes. */
const HTTP_IN_MESSAGE = /HTTP\s*(\d{3})|http_(\d{3})|returned HTTP (\d{3})/

function httpStatusOf(error) {
  if (typeof error?.status === 'number') return error.status
  const matched = HTTP_IN_MESSAGE.exec(error?.message ?? '')
  return matched ? Number(matched[1] ?? matched[2] ?? matched[3]) : undefined
}

/** Fuyao business codes ride on HTTP 200 and only appear in the message text. */
function upstreamCodeOf(error) {
  const message = error?.message ?? ''
  return /Fuyao API error (\d+)/.exec(message)?.[1]
    ?? /code[=:\s]+(\d{4})/i.exec(message)?.[1]
    ?? (typeof error?.code === 'string' && /^\d{4}$/.test(error.code) ? error.code : undefined)
}

// Upstream says "no records for this ticker / range": a legal empty result, not a link fault.
// Mixing it into TRANSPORT drowns real faults; mixing it into GUARD sends people to fix a good map.
const EMPTY_RESULT_CODES = new Set(['eastmoney_no_billboard_data', 'NOT_FOUND'])
// Upstream rejected our params = the registry sample is wrong, i.e. our defect: let ENVELOPE file it.
const PARAM_REJECT_CODES = new Set(['eastmoney_invalid_ticker', 'tencent_invalid_param'])
// AnySearch reporting a target-side error (blocked, unsupported, too large): `/v1/extract` is intact.
// The probe measures AnySearch, not whether www.gov.cn is up that day.
const TARGET_SIDE_MARKERS = /extract_failed|target_blocked|unsupported_content|content_too_large|Unable to extract content/i

// Order is priority: structural failures first, then empty and slow. TRANSPORT is the fallback
// bucket — anything unrecognised is treated as our link's problem and opens no issue.
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

/** Locate the row array via `schema.rowShape`, the authoritative hint — don't guess. */
export function rowsOf(data, rowShape) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  for (const key of rowShape?.rowKeys ?? [rowShape?.rowKey ?? 'item', 'item']) {
    if (Array.isArray(data[key])) return data[key]
  }
  return []
}

/** Expected row keys come from `output_schema` — never a second field list. */
export function expectedRowKeys(outputSchema) {
  const item = outputSchema?.properties?.item ?? (outputSchema?.type === 'array' ? outputSchema : undefined)
  const props = item?.items?.properties ?? item?.properties
  return props ? Object.keys(props) : []
}

function diffKeys(expected, actual) {
  return { missing: expected.filter((k) => !actual.includes(k)), added: actual.filter((k) => !expected.includes(k)) }
}

function pickPath(root, path) {
  return path.split('.').reduce((node, token) => (node == null ? node : node[token]), root)
}

function buildSources() {
  const fuyaoKey = resolveCredential('FUYAO_API_KEY')
  const ftshareKey = resolveCredential('FTSHARE_API_KEY')
  const map = new Map()
  for (const source of [...createFuyaoRestSources(async () => fuyaoKey), ...createEastmoneySources(), ...createTencentSources(), ...createFtshareSources(async () => ftshareKey)]) {
    map.set(source.schema.capability, source)
  }
  return map
}

const abortSignal = () => new AbortController().signal

function buildProbeTable() {
  const transport = createSourceTransport({ enabled: true, timeoutMs: 30_000, userAgent: USER_AGENT })
  // Same process-wide throttle and gated transport as production: the probe takes the user's path.
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

/** Wind protocol probe: initialize + tools/list only, never billable data calls. */
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

// Families run in egress order: finish one provider before starting the next.
// ⛔ This list and the registry's `PROBE_FAMILIES` are two lists; a missing family silently probes
// nothing. test/contract-registry.test.mjs pins the coverage.
export const FAMILY_ORDER = ['fuyao', 'eastmoney', 'tencent', 'retriever', 'anysearch', 'wind', 'ftshare']

/**
 * ⚠️ Never wrap eastmoney / tencent / named sources in another throttle: their execute() already runs
 * through sharedEastmoneyThrottle() / tencentThrottle. Wrapping the singleton again self-locks
 * (outer task holds the chain waiting for the inner one queued behind it) and the first probe hangs.
 */
const NO_PACE = (task) => task()

function pacerFor(family) {
  // Production fuyao is bare fetch with no min spacing (Hub serializes); no Hub here, so add a floor.
  if (family === 'fuyao') return createRequestThrottle(FUYAO_PROBE_GAP_MS)
  if (family === 'eastmoney' || family === 'tencent' || family === 'retriever' || family === 'ftshare') return NO_PACE
  return createRequestThrottle(1_000)
}

// Missing key must fail before any request: AnySearch answers 200 with real results without a key,
// so letting it run would be a false green.
export function assertCredentials(entries) {
  const needed = [...new Set(entries.map(secretRefOf).filter(Boolean))].sort()
  const missing = needed.filter((ref) => !resolveCredential(ref))
  if (missing.length > 0) {
    throw new Error(`缺少凭据：${missing.join(', ')}。请到仓库 Settings → Secrets and variables → Actions 补上。`
      + '（本次档位在发任何请求之前就该停——红 = 我方配置问题，Issue = 上游问题，两个信道不混。）')
  }
  return needed
}

/** Never invent manager_id / company_id: resolve from a real response, else mark dependents SKIPPED. */
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
      // The most useful column in an issue: expected vs actual keys, names only, no values.
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

// `dayShift` markers become dates exactly once per run: runner, id resolution and report must all
// see plain strings (resolving twice can yield two different "todays" around UTC midnight).
export function withResolvedDates(entries, runAt = new Date()) {
  return entries.map((entry) => ({
    ...entry,
    ...(entry.params ? { params: resolveDayShifts(entry.params, runAt) } : {}),
    ...(entry.resolveFrom
      ? { resolveFrom: { ...entry.resolveFrom, params: resolveDayShifts(entry.resolveFrom.params, runAt) } }
      : {}),
  }))
}

export async function runContractProbes({ tier = 'daily', only, family, log = (text) => console.error(text) } = {}) {
  let entries = probesForTier(tier)
  if (family) entries = entries.filter((entry) => entry.family === family)
  if (only) entries = entries.filter((entry) => entry.capability.includes(only))
  // trading_calendar first: it decides how every later EMPTY should be read.
  entries = [...entries].sort((a, b) => Number(b.capability === 'trading_calendar') - Number(a.capability === 'trading_calendar'))
  entries = withResolvedDates(entries)

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
    // ⛔ Only this list opens issues; TRANSPORT / SLOW / EMPTY stay in the summary.
    failing,
  }
}
