import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEastmoneySources } from '../lib/sources/eastmoney-http.js'
import { createTencentSources } from '../lib/sources/tencent-http.js'
import { createWindSources } from '../lib/sources/wind-mcp.js'
import { DataCollectorHub } from '../lib/data-collector/hub.js'

const signal = new AbortController().signal
const session = { id: 'normalize-contract', header: { cwd: '/workspace/project' } }

/**
 * 公开 HTTP 与 MCP 面每条能力的最小合法参数（Fuyao 那 61 条的同一张表在
 * `scripts/smoke-fuyao.mjs` 的 `PARAMS`，两边口径一致：缺了就失败，不静默跳过）。
 */
const SAMPLES = {
  eastmoney_top_buy_sell_market: { start_date: '2026-09-01', end_date: '2026-09-24' },
  eastmoney_top_buy_sell_ticker: { ticker: '600519.SH', start_date: '2026-09-01', end_date: '2026-09-24' },
  eastmoney_lockup_expiry: { start_date: '2026-09-01', end_date: '2026-09-30' },
  eastmoney_sector_rotation: { board_type: 'industry', sort_field: 'change_pct' },
  eastmoney_cashflow_rotation: { board_type: 'concept' },
  eastmoney_cpi: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_ppi: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_gdp: { start_date: '2025-01-01', end_date: '2026-09-30' },
  eastmoney_pmi: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_money_supply: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_rmb_loan: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_customs_trade: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_retail_sales: { start_date: '2026-01-01', end_date: '2026-09-30' },
  eastmoney_deposit_reserve: { start_date: '2021-01-01', end_date: '2026-09-30' },
  eastmoney_mutual_flow: { start_date: '2026-09-01', end_date: '2026-09-30', channel: 'sh_stock_connect' },
  eastmoney_main_capital_snapshot: { ticker: '600519.SH' },
  eastmoney_dividend_plan: { ticker: '600519.SH', start_date: '2020-01-01', end_date: '2026-09-30' },
  eastmoney_holder_number_snapshot: { ticker: '600519.SH' },
  eastmoney_mutual_quota: {},
  eastmoney_margin_trading: { ticker: '600519.SH', start_date: '2026-09-01', end_date: '2026-09-30' },
  eastmoney_convertible_bond_list: { start_date: '2026-01-01', end_date: '2026-09-30', stock_code: '600519' },
  tencent_quote: { codes: ['600519.SH', '000001.SZ'] },
  tencent_kline: { code: '600519.SH', period: 'day', adjust: 'none', count: 5 },
  tencent_ticks: { code: '600519.SH' },
  tencent_hk_quote: { codes: ['00700'] },
  tencent_us_quote: { codes: ['AAPL'] },
  tencent_hk_kline: { code: '00700', period: 'day', adjust: 'none', count: 5 },
  tencent_us_kline: { code: 'AAPL.OQ', period: 'day', adjust: 'none', count: 5 },
  wind_edb_search: { question: '中国GDP相关指标' },
  wind_edb_query: { indicator: 'M5567876', start_date: '2025-01-01', end_date: '2025-12-31' },
  wind_stock_kline: { code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15' },
}

const sources = [...createEastmoneySources(), ...createTencentSources(), ...createWindSources(async () => 'secret')]

test('参数样例表必须覆盖全部已注册的公开 HTTP 能力：新增没登记就失败，不静默少测', () => {
  const registered = sources.map((source) => source.schema.capability).sort()
  assert.deepEqual(registered, Object.keys(SAMPLES).sort(), 'SAMPLES 与注册表不一致：缺样例的能力不会被下面的归一化回归覆盖')
})

/**
 * 归一化会被跑**两遍**：Hub 入队前一次（merge key 与 digest 用规范化参数，hub.ts 的
 * normalizeRequest），`createSource` 的 execute 内再一次（直连调用也要生效）。所以两条硬不变量：
 * ① 输出的键必须是模型声明过的键——把 `ticker` 改名成内部叫法 `thscode` 会让第二遍撞在
 *   自己的 `assertKnown` 上，报出 `unsupported parameter: thscode`，而这条能力的参数明明合法
 *   （2026-10-05 实测：融资融券/分红/主力资金/股东户数四条的单票过滤全因此失效）；
 * ② 幂等——第二遍的输入就是第一遍的输出，必须原样返回。
 */
test('公开 HTTP 与 MCP 归一化：不发明未声明的键，且双跑幂等', () => {
  for (const source of sources) {
    const capability = source.schema.capability
    const declared = Object.keys(source.schema.input_schema.properties ?? {}).sort()
    const once = source.normalizeParams(SAMPLES[capability])
    assert.deepEqual(Object.keys(once).filter((key) => !declared.includes(key)), [],
      `${capability} 归一化发明了模型没声明的键：Hub 的第二遍归一化会把它当非法参数拒掉`)
    assert.deepEqual(source.normalizeParams(once), once, `${capability} normalizeParams 必须幂等（Hub 与 execute 各跑一次）`)
  }
})

test('走 Hub 的真实入口：原始 ticker 参数一路落到上游 filter，不在第二遍归一化被拒', async () => {
  const originalFetch = globalThis.fetch
  const requested = []
  globalThis.fetch = async (url) => {
    requested.push(new URL(String(url)))
    return { ok: true, status: 200, json: async () => ({ success: true, code: 0, result: { pages: 0, count: 0, data: [] } }) }
  }
  const hub = new DataCollectorHub({ store: { async save() { return {} }, async findLatest() { return undefined } } })
  for (const source of createEastmoneySources()) hub.registerSource(source)
  const cases = [
    ['eastmoney_margin_trading', { ticker: '600519.SH', start_date: '2026-09-01', end_date: '2026-09-30' }, /600519/],
    ['eastmoney_dividend_plan', { ticker: '600519.SH', start_date: '2020-01-01', end_date: '2026-09-30' }, /600519\.SH/],
    ['eastmoney_main_capital_snapshot', { ticker: '600519.SH' }, /600519\.SH/],
    ['eastmoney_holder_number_snapshot', { ticker: '600519.SH' }, /600519\.SH/],
  ]
  try {
    for (const [capability, params, filterPattern] of cases) {
      requested.length = 0
      // 空结果是真数据缺口，会抛数据侧错误；这里要钉的是**没有**参数侧错误、且请求真的带上了这只票。
      await hub.request({ capability, params, session }, { signal }).catch(() => undefined)
      assert.equal(requested.length, 1, `${capability} 必须走到上游，而不是在归一化阶段就被拒`)
      const filter = requested[0].searchParams.get('filter') ?? ''
      assert.match(filter, filterPattern, `${capability} 的单票过滤必须带上请求的代码，收到 filter=${filter}`)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})
