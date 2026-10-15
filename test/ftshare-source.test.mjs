/**
 * FTShare（非凸科技）source 的离线回归（`src/sources/ftshare-rest.ts`）。
 *
 * fixture 全部来自 2026-10-15 的**真报文实测**（不是供应商文档的转述）：字段名、类型、
 * 日期写法、分页信封与错误信封都按当时返回原样写死。改这些形状属于"上游改版"，
 * 必须连同本文件的断言一起改（§10：未验不注册，验过的不许漂）。
 *
 * 全部离线：只把 `globalThis.fetch` 换成桩，不发任何真实请求（真打走 `contract:probe`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFtshareSources, createFtshareClient, FtshareError, FTSHARE_MIN_INTERVAL_MS } from '../lib/sources/ftshare-rest.js'

const BASE = 'https://market.ft.tech/gateway'

function request(capability, params = {}) {
  return { capability, params, session: { id: 'session-1', header: { cwd: '/workspace/proj' } } }
}

/** 真报文样本：同花顺个股日度资金流（注意 `code` 是裸 6 位、日期是 ISO、数值是 number）。 */
const STOCK_FLOW_ROW = { code: '600519', name: '贵州茅台', trade_date: '2026-10-14', close_price: 1286, change_pct: 0.87, turnover_pct: 0.19, inflow: 18.76, outflow: 11.69, net_amount: 7.07, turnover_amount: 30.46 }
/** 真报文样本：盘中主力五档。数值是**字符串**、身份带后缀、时间是**纳秒**。 */
const MAIN_CAPITAL_ROW = { net_inflow_extra_large: '52103064.81', net_inflow_large: '-2817181.62', net_inflow_main: '49285883.19', net_inflow_medium: '-48721885.76', net_inflow_small: '-563997.43', symbol: '600519.SH', symbol_name: '贵州茅台', ts_nanos: 1791963000000000000 }

function paged(records, over = {}) {
  return {
    code: 200, message: 'success',
    data: { pageNum: 1, pageSize: records.length, total: records.length, pages: 1, records, ...over },
  }
}

function jsonResponse(payload, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => payload }
}

/** 换掉 fetch 并在结束时复原；同时返回调用记录，好断言"一次都没发出去"。 */
async function withFetch(handler, body) {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} })
    return handler(url, init)
  }
  try { return await body(calls) } finally { globalThis.fetch = originalFetch }
}

function sourceFor(capability) {
  const found = createFtshareSources(async () => 'test-key').find((source) => source.schema.capability === capability)
  assert.ok(found, `未注册能力 ${capability}`)
  return found
}

test('注册面：四颗能力都在，capability 前缀与 source_label 一致', () => {
  const sources = createFtshareSources(async () => 'unused')
  assert.deepEqual(sources.map((s) => s.schema.capability), [
    'ftshare_stock_daily_flow', 'ftshare_industry_daily_flow', 'ftshare_concept_daily_flow', 'ftshare_main_capital_flow',
  ])
  for (const source of sources) {
    assert.equal(source.schema.source_label, 'ftshare')
    assert.ok(source.schema.summary && source.schema.summary.length <= 60, `${source.schema.capability} 的 summary 必须存在且够短（目录是发现入口）`)
    assert.ok((source.schema.description ?? '').length > 120, `${source.schema.capability} 缺完整说明（单位/null/时间/分页口径都住这里）`)
    assert.equal(source.schema.input_schema.type, 'object', `${source.schema.capability} 的 parameters 根必须是 object（§9.1）`)
    assert.ok(Array.isArray(source.schema.input_schema.required), `${source.schema.capability} 的根必须显式写 required`)
  }
})

test('execute：日度个股流按 YYYYMMDD 出线，行映射成 snake_case 且带单位后缀', async () => {
  const source = sourceFor('ftshare_stock_daily_flow')
  await withFetch(async () => jsonResponse(paged([STOCK_FLOW_ROW])), async (calls) => {
    const result = await source.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14', page: 2, size: 300 }), new AbortController().signal)
    assert.match(calls[0].url, new RegExp(`^${BASE}/api/v1/market/data/ths-stock-daily-flow\\?`))
    assert.match(calls[0].url, /start_date=20261008/)
    assert.match(calls[0].url, /end_date=20261014/)
    assert.match(calls[0].url, /page=2&page_size=300$/)
    assert.deepEqual(result.data.item, [{
      code: '600519', name: '贵州茅台',
      trade_date: '2026-10-14', trade_date_ms: Date.parse('2026-10-14T00:00:00+08:00'),
      close_price: 1286, change_pct: 0.87, turnover_pct: 0.19,
      inflow_yi: 18.76, outflow_yi: 11.69, net_amount_yi: 7.07, turnover_amount_yi: 30.46,
    }])
    assert.deepEqual(result.data.pagination, { page: 1, size: 1, pages: 1, total: 1 })
  })
})

test('execute：code 过滤器在请求边界退回裸 6 位；裸码歧义时才拒（600519 不歧义、000001 歧义）', async () => {
  const source = sourceFor('ftshare_stock_daily_flow')
  await withFetch(async () => jsonResponse(paged([STOCK_FLOW_ROW])), async (calls) => {
    await source.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14', code: '600519.SH' }), new AbortController().signal)
    assert.match(calls[0].url, /code=600519(&|$)/, '发给上游的必须是裸码')
    assert.doesNotMatch(calls[0].url, /\.SH/, '不要把市场后缀发给只认裸码的上游')
  })
  // 交易所唯一确定的裸 6 位（6 开头 = 沪市）归一是安全的，本仓 parseSecurityCode 就按这条规则做。
  assert.equal(source.normalizeParams({ start_date: '2026-10-08', end_date: '2026-10-14', code: '600519' }).code, '600519')
  // ⛔ 裸 000xxx 在上证指数与深市个股之间有歧义：必须在参数层响亮拒绝，不许替模型猜一个市场。
  assert.throws(() => source.normalizeParams({ start_date: '2026-10-08', end_date: '2026-10-14', code: '000001' }), /ambiguous|exchange/)
})

test('execute：主力五档把字符串数值转成 number、纳秒转成毫秒轴并给出上海时区的日期与时刻', async () => {
  const source = sourceFor('ftshare_main_capital_flow')
  await withFetch(async () => jsonResponse(paged([MAIN_CAPITAL_ROW])), async (calls) => {
    const result = await source.execute(request('ftshare_main_capital_flow', { page: 1, size: 5 }), new AbortController().signal)
    assert.match(calls[0].url, /page_size=5/)
    const row = result.data.item[0]
    assert.equal(row.thscode, '600519.SH', '身份沿用上游给的后缀写法，本层不替它猜交易所')
    assert.equal(row.ts_millis, 1791963000000, '纳秒必须换算成毫秒（本仓时间轴口径）')
    assert.equal(row.trade_date, '2026-10-14')
    assert.equal(row.slice_time, '15:30', '1791963000000 = 北京 15:30，不是 UTC 07:30')
    for (const key of ['net_inflow_super_large_yuan', 'net_inflow_large_yuan', 'net_inflow_main_yuan', 'net_inflow_medium_yuan', 'net_inflow_small_yuan']) {
      assert.equal(typeof row[key], 'number', `${key} 必须已从字符串转成数值，否则 query_dataset 的数值比较会静默不命中`)
    }
    // 上游这两条恒等式是"单位=元"的实证依据（实测单日 5214 行违例 0，指两位小数精度内），
    // 这里钉住映射不改变它。**不用 strictEqual**：浮点相加会多出 5e-8，那是 IEEE 的账，不是上游的。
    assert.ok(Math.abs(row.net_inflow_main_yuan - (row.net_inflow_super_large_yuan + row.net_inflow_large_yuan)) < 1e-6, '主力 = 超大单 + 大单')
    assert.ok(Math.abs(row.net_inflow_main_yuan + row.net_inflow_medium_yuan + row.net_inflow_small_yuan) < 1e-6, '三档净额相加为 0')
    assert.doesNotMatch(JSON.stringify(result.data), /ts_nanos/, '纳秒原值不许透出')
  })
})

test('execute：date 与 time 都省略时不拼任何日期参数（打最新切片）', async () => {
  const source = sourceFor('ftshare_main_capital_flow')
  await withFetch(async () => jsonResponse(paged([MAIN_CAPITAL_ROW])), async (calls) => {
    await source.execute(request('ftshare_main_capital_flow', {}), new AbortController().signal)
    assert.doesNotMatch(calls[0].url, /date=/)
    assert.doesNotMatch(calls[0].url, /time=/)
  })
})

test('normalizeParams：日期、分页与切片时刻的拒绝都在入队前，且文案带 parameter 字样好让工具层归类', () => {
  const source = sourceFor('ftshare_stock_daily_flow')
  const bad = [
    [{ start_date: '2026-10-08' }, /start_date|end_date/],
    [{ start_date: '20261008', end_date: '2026-10-14' }, /parameter start_date must be YYYY-MM-DD/],
    [{ start_date: '2026-02-30', end_date: '2026-10-14' }, /valid YYYY-MM-DD/],
    [{ start_date: '2026-10-14', end_date: '2026-10-08' }, /parameter start_date must not be later/],
    [{ start_date: '2026-10-08', end_date: '2026-10-14', size: 1001 }, /size must be an integer from 1 to 1000/],
    [{ start_date: '2026-10-08', end_date: '2026-10-14', page: 0 }, /page must be an integer/],
    [{ start_date: '2026-10-08', end_date: '2026-10-14', limit: 3 }, /unsupported parameter/],
  ]
  for (const [params, pattern] of bad) {
    assert.throws(() => source.normalizeParams(params), pattern, JSON.stringify(params))
  }
  // ⛔ 这些消息必须能被 `request_params_invalid` 的判据接住（tools.ts 按 /parameter|params/ 识别），
  // 否则模型看到的是裸错误而不是"回读 describe_capability 再改"。
  for (const [params] of bad) {
    try { source.normalizeParams(params) } catch (error) {
      assert.match(error.message, /parameter|params|unsupported parameter/, `归类会失败：${error.message}`)
    }
  }
})

test('normalizeParams：切片时刻只认 15 分钟栅格；午间与休市后不是参数错', () => {
  const source = sourceFor('ftshare_main_capital_flow')
  // 实测：0935 被上游 400 拒（消息却写成 "time format must be HHMM"，名字骗人），1130/1300/1530 有数。
  assert.throws(() => source.normalizeParams({ time: '0935' }), /15-minute grid/)
  assert.throws(() => source.normalizeParams({ time: '9:30' }), /HHMM/)
  assert.equal(source.normalizeParams({ time: '10:15' }).time, '1015')
  assert.equal(source.normalizeParams({ time: '1530' }).time, '1530')
  // 午间切片语法合法、上游回 total=0 —— 那是休市的事实，不许在这一层被拒、也不许被当成取数失败。
  assert.equal(source.normalizeParams({ time: '1200' }).time, '1200')
})

test('空结果与窗口：total=0 是合法空集，不抛错也不补零', async () => {
  const source = sourceFor('ftshare_stock_daily_flow')
  await withFetch(async () => jsonResponse(paged([], { total: 0, pages: 0 })), async () => {
    const result = await source.execute(request('ftshare_stock_daily_flow', { start_date: '2026-01-05', end_date: '2026-01-05' }), new AbortController().signal)
    assert.deepEqual(result.data.item, [])
    assert.equal(result.data.pagination.total, 0)
    assert.equal(source.validateOutput(result.data), true, '空 item 加 pagination 仍是合法形状')
  })
})

test('错误信封两套都要认：403 套餐外用 msg 而非 message，理由必须原样带到模型眼前', async () => {
  const client = createFtshareClient(async () => 'test-key')
  await withFetch(async () => ({
    status: 403, ok: false,
    json: async () => ({ code: 403, data: { reason: '当前套餐无权访问该接口' }, msg: 'route_not_allowed' }),
  }), async () => {
    await assert.rejects(
      () => client.getJson('/api/v1/market/data/stock-capital-flows', new URLSearchParams(), new AbortController().signal),
      (error) => {
        assert.ok(error instanceof FtshareError)
        assert.equal(error.kind, 'plan_closed')
        assert.match(error.message, /当前套餐无权访问该接口/, '上游给的人话不许丢')
        assert.match(error.message, /不要重试/, '必须把"重试无意义"写进文案（Fuyao 2004 同一族）')
        return true
      },
    )
  })
})

test('错误归类：上游 400 / HTTP 429 / 缺凭据各归各位', async () => {
  const client = createFtshareClient(async () => 'test-key')
  await withFetch(async () => ({ status: 200, ok: true, json: async () => ({ code: 400, message: 'start_date must be YYYYMMDD', data: null }) }), async () => {
    await assert.rejects(() => client.getJson('/x', new URLSearchParams(), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_parameter'); assert.match(error.message, /YYYYMMDD/); return true })
  })
  await withFetch(async () => ({ status: 429, ok: false, json: async () => ({}) }), async () => {
    await assert.rejects(() => client.getJson('/x', new URLSearchParams(), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'rate_limited'); return true })
  })
  // 200 但信封里没有 data：这是"上游改版"的形态，必须归成 invalid_response，
  // 不许退化成空结果——巡检靠的就是这一声（§10.8 的 GUARD 同源）。
  const source = sourceFor('ftshare_stock_daily_flow')
  await withFetch(async () => ({ status: 200, ok: true, json: async () => ({ code: 200, message: 'success' }) }), async () => {
    await assert.rejects(
      () => source.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal),
      (error) => { assert.equal(error.kind, 'invalid_response'); return true },
    )
  })
})

test('缺凭据：明确报错且一次请求都不发', async () => {
  const source = sourceFor('ftshare_stock_daily_flow')
  const keyless = createFtshareSources(async () => undefined).find((s) => s.schema.capability === 'ftshare_stock_daily_flow')
  await withFetch(async () => { throw new Error('unexpected fetch') }, async (calls) => {
    await assert.rejects(
      () => keyless.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal),
      /FTSHARE_API_KEY is not configured/,
    )
    assert.deepEqual(calls, [], '没有 key 还发请求等于白烧上游配额')
    assert.equal(source.schema.capability, 'ftshare_stock_daily_flow')
  })
})

test('凭据每次调用现取：不把第一次的 rejection 记住（§9.7 装配期抢跑那一族）', async () => {
  let resolves = 0
  const sources = createFtshareSources(async () => { resolves += 1; return `key-${resolves}` })
  const stockFlow = sources.find((s) => s.schema.capability === 'ftshare_stock_daily_flow')
  await withFetch(async () => jsonResponse(paged([STOCK_FLOW_ROW])), async (calls) => {
    await stockFlow.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal)
    await stockFlow.execute(request('ftshare_stock_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal)
    assert.equal(resolves, 2, '两次调用必须各解析一次 key')
    assert.equal(calls[0].headers.FTSHARE_API_KEY, 'key-1')
    assert.equal(calls[1].headers.FTSHARE_API_KEY, 'key-2', '换了 key 必须立刻生效，不能记住第一次')
  })
})

test('限流：并发进来也要拉成一条链，相邻请求间隔不小于 FTSHARE_MIN_INTERVAL_MS', async () => {
  const source = sourceFor('ftshare_stock_daily_flow')
  const stamps = []
  await withFetch(async () => { stamps.push(Date.now()); return jsonResponse(paged([STOCK_FLOW_ROW])) }, async () => {
    const params = { start_date: '2026-10-08', end_date: '2026-10-14' }
    // 框架会把同一消息里的多个工具调用放进并发池：这里一次丢三发。
    await Promise.all([
      source.execute(request('ftshare_stock_daily_flow', params), new AbortController().signal),
      source.execute(request('ftshare_stock_daily_flow', { ...params, page: 2 }), new AbortController().signal),
      source.execute(request('ftshare_stock_daily_flow', { ...params, page: 3 }), new AbortController().signal),
    ])
    assert.equal(stamps.length, 3)
    assert.ok(stamps[1] - stamps[0] >= FTSHARE_MIN_INTERVAL_MS - 5, `串行 ≠ 节流：实测间隔 ${stamps[1] - stamps[0]}ms < ${FTSHARE_MIN_INTERVAL_MS}ms`)
    assert.ok(stamps[2] - stamps[1] >= FTSHARE_MIN_INTERVAL_MS - 5, `实测间隔 ${stamps[2] - stamps[1]}ms`)
  })
})

test('输出契约：返回的每一个列名都必须在声明的 output_schema 里（§9.6）', async () => {
  const cases = [
    ['ftshare_stock_daily_flow', 'ths-stock-daily-flow', STOCK_FLOW_ROW, { start_date: '2026-10-08', end_date: '2026-10-14' }],
    ['ftshare_industry_daily_flow', 'ths-industry-daily-flow', { board_name: 'IT服务', trade_date: '2026-10-14', board_index: 11410.9, change_pct: -1.77, company_count: 129, inflow: 57.06, outflow: 72.88, net_amount: -15.82, leader_name: '华是科技', leader_change_pct: 4.12, leader_price: 69.04 }, { start_date: '2026-10-08', end_date: '2026-10-14' }],
    ['ftshare_concept_daily_flow', 'ths-concept-daily-flow', { board_name: '2026三季报预增', trade_date: '20261014', board_index: 983.812, change_pct: -1.09, company_count: 43, inflow: 173.81, outflow: 213.54, net_amount: -39.73, leader_name: null, leader_change_pct: null, leader_price: null }, { start_date: '2026-10-08', end_date: '2026-10-14' }],
    ['ftshare_main_capital_flow', 'stock-capital-flows', MAIN_CAPITAL_ROW, {}],
  ]
  for (const [capability, , row] of cases) {
    const source = sourceFor(capability)
    await withFetch(async () => jsonResponse(paged([row])), async () => {
      const result = await source.execute(request(capability, cases.find((c) => c[0] === capability)[3]), new AbortController().signal)
      const declared = Object.keys(result.schema.properties.item.items.properties)
      for (const emitted of Object.keys(result.data.item[0])) {
        assert.ok(declared.includes(emitted), `${capability} 返回了未声明的列 ${emitted}`)
      }
      // §9.5：无损 JSON——undefined 与 NaN 一律不许带出。
      const serialized = JSON.stringify(result.data)
      assert.doesNotMatch(serialized, /NaN|undefined/)
      assert.equal(source.validateOutput(result.data), true)
    })
  }
})

test('日期列两种写法都要归一：ISO 与 YYYYMMDD 出同一套 trade_date + 毫秒轴', async () => {
  const source = sourceFor('ftshare_concept_daily_flow')
  await withFetch(async () => jsonResponse(paged([
    { board_name: 'A', trade_date: '2026-10-14', inflow: 1, outflow: 2, net_amount: -1 },
    { board_name: 'B', trade_date: 20261014, inflow: 3, outflow: 4, net_amount: -1 },
  ])), async () => {
    const result = await source.execute(request('ftshare_concept_daily_flow', { start_date: '2026-10-08', end_date: '2026-10-14' }), new AbortController().signal)
    for (const row of result.data.item) {
      assert.equal(row.trade_date, '2026-10-14', `${row.board_name} 的日期没归一`)
      assert.equal(row.trade_date_ms, Date.parse('2026-10-14T00:00:00+08:00'))
    }
    assert.equal(result.data.item[0].leader_name, null, '上游缺列要给 null，不许补成空串或 0')
  })
})
