/**
 * 真实 REST 冒烟：对**全部已注册** Fuyao capability 各发一次最小请求，逐条打印
 * HTTP 结果、上游 code 与输出护栏判定。
 *
 * 为什么要有它：单元测试全部替换了 fetch（合成响应），只能证明"契约与 mock 一致"，
 * 不能证明"上游现在真的可用、护栏不会误杀真实数据"。本脚本是可复核的证据来源。
 *
 *   node scripts/smoke-fuyao.mjs              # 用内置最小参数跑全部端点
 *   node scripts/smoke-fuyao.mjs --only fund  # 只跑 capability 含该子串的端点
 *   node scripts/smoke-fuyao.mjs --json       # 输出 JSON（便于留档）
 *
 * 凭据来源：DSH credentials 文件（~/.dsh/.credentials.yaml 的 refs.FUYAO_API_KEY）
 * 或环境变量 FUYAO_API_KEY。脚本**不打印密钥、不落盘任何响应数据**。
 * 注意：会真实消耗上游配额；顺序执行并留间隔，避免触发限流（code=4001）。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createFuyaoRestSources } from '../lib/sources/fuyao-rest.js'

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined
const asJson = args.includes('--json')

function resolveKey() {
  if (process.env.FUYAO_API_KEY) return process.env.FUYAO_API_KEY
  try {
    const text = readFileSync(`${homedir()}/.dsh/.credentials.yaml`, 'utf8')
    const matched = /^\s*FUYAO_API_KEY:\s*(.+?)\s*$/m.exec(text)
    if (matched) return matched[1].replace(/^["']|["']$/g, '')
  } catch {
    // 凭据文件不可读时走下面的报错分支
  }
  return undefined
}

/** 每个 capability 的最小合法请求；键必须覆盖全部已注册端点（缺了就报错，不静默跳过）。 */
const PARAMS = {
  ticker_search: { q: '贵州茅台', limit: 1 },
  ticker_list: { asset_type: 'a-share', limit: 1 },
  quote: { thscodes: '600519.SH' },
  history: { thscode: '600519.SH', interval: '1d', start: Date.UTC(2025, 0, 2), end: Date.UTC(2025, 1, 28) },
  trading_calendar: {},
  corporate_actions: { thscode: '600519.SH' },
  income_statement: { thscode: '600519.SH', period: 'annual', limit: 1 },
  balance_sheet: { thscode: '600519.SH', period: 'annual', limit: 1 },
  cash_flow: { thscode: '600519.SH', period: 'annual', limit: 1 },
  financial_indicators: { thscode: '300033.SZ', report: '2024-4' },
  valuation: { thscodes: '600519.SH' },
  auction: { thscodes: '600519.SH' },
  limit_up_pool: { page: 1, size: 5 },
  limit_down_pool: { page: 1, size: 5 },
  limit_break_pool: { page: 1, size: 5 },
  limit_up_ladder: {},
  skyrocket_list: { period: 'day' },
  hot_stock_list: { period: 'day' },
  hot_stock_history: { date: '2026-06-21' },
  hot_stock_rank_trend: { thscode: '300034.SZ', start_date: '2026-06-21', end_date: '2026-07-01' },
  anomaly_list: { tag_codes: 'LIMIT_UP' },
  anomaly_stock: { thscodes: '600519.SH' },
  dragon_tiger: {},
  auction_benchmark: {},
  index_catalog: { tag: 'industry' },
  index_constituents: { thscode: '000300.SH' },
  index_quote: { thscodes: '000001.SH,399001.SZ' },
  index_history: { thscode: '000001.SH', interval: '1d', start: Date.UTC(2025, 0, 2), end: Date.UTC(2025, 1, 28) },
  fund_profile: { thscode: '510300.SH' },
  fund_quote: { thscode: '510300.SH' },
  fund_history: { thscode: '510300.SH', start: Date.UTC(2025, 0, 2), end: Date.UTC(2025, 1, 28) },
  fund_nav: { thscode: '510300.SH', range: 'month' },
  fund_returns: { thscode: '510300.SH' },
  fund_drawdowns: { thscode: '510300.SH' },
  fund_holdings: { thscode: '510300.SH' },
  fund_asset_allocation: { thscode: '510300.SH' },
  fund_industry_allocation: { thscode: '025480.OF' },
  fund_stock_history: { thscode: '510300.SH', report_type: 'quarter', end_date: '2026-06-30' },
  fund_holders: { thscode: '161725.SZ' },
  fund_top_holders: { thscode: '510300.SH', limit: 10 },
  fund_manager: { manager_id: 'M000000001' },
  fund_company: { company_id: 'C00000001' },
  fund_performance_history: { thscode: '510300.SH', start: Date.UTC(2025, 0, 2), end: Date.UTC(2025, 1, 28) },
  fund_bond_history: { thscode: '510300.SH', report_type: 'quarter', end_date: '2026-06-30' },
  fund_stock_report_dates: { thscode: '510300.SH' },
  fund_bond_report_dates: { thscode: '510300.SH' },
  fund_manager_experience: { manager_id: 'M000000001' },
  fund_manager_style: { manager_id: 'M000000001' },
  fund_manager_performance: { manager_id: 'M000000001', range: 'year' },
  fund_income: { thscode: '510300.SH' },
  fund_balance: { thscode: '510300.SH' },
  fund_financial_indicators: { thscode: '510300.SH' },
  fund_indicator_line: { indexes: JSON.stringify([{ thscodes: ['510300.SH'], index_info: [{ index_id: 'rsi_pct' }] }]), time_range: JSON.stringify({ time_type: 'DAY_1' }) },
  fund_indicator_table: { indexes: JSON.stringify([{ index_id: 'rsi_pct' }]) },
  fund_dividends: { thscode: '510300.SH' },
  fund_offerings: { subscribe: 'active' },
  fund_quota_list: { tab: JSON.stringify(['remen']) },
  fund_quota_summary: { tab: JSON.stringify(['nazhi100']) },
  fund_diagnostics: { thscode: '510300.SH' },
  fund_backtest: { thscode: '000001.OF', buy_conditions: JSON.stringify({ indicator_code: 'rsi_pct', operator: '>', value: 0.5 }), sell_conditions: JSON.stringify({ indicator_code: 'rsi_pct', operator: '<', value: 0.3 }), buy_frequency_type: 'WEEKLY', max_buy_times: 5, per_buy_amount: 100 },
  fund_backtest_indicators: {},
}

const key = resolveKey()
if (!key) {
  console.error('未找到凭据：请设置 FUYAO_API_KEY，或在 ~/.dsh/.credentials.yaml 的 refs 下配置 FUYAO_API_KEY。')
  process.exit(2)
}

const sources = createFuyaoRestSources(async () => key)
const missing = sources.map((source) => source.schema.capability).filter((capability) => !(capability in PARAMS))
if (missing.length > 0) {
  console.error(`冒烟参数表缺少这些已注册 capability（新增端点时必须同步补上）：${missing.join(', ')}`)
  process.exit(2)
}

// manager_id / company_id 无法编造（编造的 id 会得到 code=5003，而不是参数错误），
// 因此先从基金基本资料里解析真实标识，再让依赖它们的端点使用。
const identifiers = { manager_id: undefined, company_id: undefined }
const profileSource = sources.find((source) => source.schema.capability === 'fund_profile')
for (let attempt = 0; attempt < 3 && !identifiers.manager_id; attempt += 1) {
  try {
    const output = await profileSource.execute({ capability: 'fund_profile', params: PARAMS.fund_profile, session: { id: 'smoke' } }, new AbortController().signal)
    const row = output.data?.item?.[0]
    identifiers.manager_id = row?.manager_info?.[0]?.manager_id
    identifiers.company_id = row?.company_id
  } catch (error) {
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
  }
}
// 解析不出真实标识时，依赖它的端点必须显式 SKIP——用编造 id 跑出来的 5003 是脚本自身
// 的问题，不能伪装成上游故障写进报告。
const MANAGER_DEPENDENT = ['fund_manager', 'fund_manager_experience', 'fund_manager_style', 'fund_manager_performance']
const skip = new Set()
if (identifiers.manager_id) {
  for (const capability of MANAGER_DEPENDENT) PARAMS[capability] = { ...PARAMS[capability], manager_id: identifiers.manager_id }
} else {
  for (const capability of MANAGER_DEPENDENT) skip.add(capability)
}
if (identifiers.company_id) PARAMS.fund_company = { company_id: identifiers.company_id }

const rows = []
for (const source of sources) {
  const capability = source.schema.capability
  if (only && !capability.includes(only)) continue
  if (skip.has(capability)) {
    rows.push({ capability, ok: true, skipped: true, code: null, guard: null, rows: null, ms: 0 })
    continue
  }
  await new Promise((resolve) => setTimeout(resolve, 400))
  const started = Date.now()
  try {
    const output = await source.execute({ capability, params: PARAMS[capability], session: { id: 'smoke' } }, new AbortController().signal)
    const data = output.data
    const rowCount = Array.isArray(data) ? data.length : data && Array.isArray(data.item) ? data.item.length : null
    rows.push({ capability, ok: true, code: 0, guard: source.validateOutput(data), rows: rowCount, ms: Date.now() - started })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = /Fuyao API error (\d+)/.exec(message)?.[1] ?? null
    rows.push({ capability, ok: false, code, guard: null, error: message.slice(0, 140), ms: Date.now() - started })
  }
}

const failed = rows.filter((row) => !row.ok)
const guardFailed = rows.filter((row) => row.ok && row.guard === false)
const skipped = rows.filter((row) => row.skipped)
const attempted = rows.length - skipped.length

if (asJson) {
  console.log(JSON.stringify({ at: new Date().toISOString(), total: rows.length, attempted, skipped: skipped.length, failed: failed.length, guardFailed: guardFailed.length, rows }, null, 2))
} else {
  for (const row of rows) {
    const status = row.skipped ? 'SKIP' : row.ok ? (row.guard ? 'OK  ' : 'GUARD-FAIL') : `ERR ${row.code ?? ''}`
    console.log(`${status.padEnd(11)} ${row.capability.padEnd(30)} rows=${String(row.rows ?? '-').padEnd(6)} ${row.ok ? '' : row.error ?? ''}`)
  }
  console.log(`\n合计 ${rows.length} 个端点：实跑 ${attempted}，成功 ${attempted - failed.length}，上游失败 ${failed.length}，护栏误杀 ${guardFailed.length}${skipped.length > 0 ? `，跳过 ${skipped.length}（缺少可解析的 manager_id）` : ''}`)
}
process.exitCode = failed.length > 0 || guardFailed.length > 0 ? 1 : 0
