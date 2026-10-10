/**
 * `get_watchlist` 的回包闸门（模型读用户自选股的那一路）。
 *
 * 钉的是三类实测教训，不是实现方便：
 *  - **"读不到"与"用户没有自选"必须是两种形状**（把失败渲染成空清单，模型就会回答"你还没加自选"）；
 *  - **持仓三态不许糊成一态**（未标记 / 标了没填比例 / 真填 0）；
 *  - **回包必须过自己声明的 output.schema 与体积预算**（宿主逐次校验，`tool-result-pruner`
 *    超阈值静默截尾——被截掉的正好是清单尾部那几只。§9.5 / §9.6 见 `AGENTS.md`，
 *    体积余量见 `docs/dev/data-roles.md` §1.5）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watchlistReceipt, watchlistToolDefinition } from '../lib/watchlist/tools.js'
import { dayDistance } from '../lib/time/tools.js'
import { assertToolOutput, collectUndeclaredRequired } from './output-contract.mjs'

const DAY_MS = 86_400_000
const NOW = 1_791_500_000_000 // 2026-10-09 前后；具体时刻不重要，断言只看两个日期的一致性

/**
 * 无损 JSON 探针（与 `test/describe-dataset.test.mjs` 的 `assertLosslessJson` 同型：
 * 宿主 `snapshotJsonValue` 见到自有 `undefined` / NaN / 空洞就整次失败）。
 */
function assertLosslessJson(value, path = '$') {
  if (value === undefined) assert.fail(`${path} 是 undefined——自有 undefined 不许带出工具层`)
  if (typeof value === 'number' && !Number.isFinite(value)) assert.fail(`${path} 是 ${value}，不是合法 JSON`)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) assert.fail(`${path}[${index}] 是空洞`)
      assertLosslessJson(value[index], `${path}[${index}]`)
    }
    return
  }
  if (value === null || typeof value !== 'object') return
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) assert.fail(`${path} 不是 plain object`)
  for (const [key, entry] of Object.entries(value)) assertLosslessJson(entry, `${path}.${key}`)
}

const row = (over = {}) => ({
  thscode: '300750.SZ',
  name: '宁德时代',
  asset_type: 'a-share',
  added_at: NOW - 12 * DAY_MS,
  ...over,
})

function executeWith(source) {
  return watchlistToolDefinition(source).execute({}, {})
}

test('持仓三态：未标记 / 标了没填比例 / 真填 0，回包三种写法各不相同', async () => {
  const receipt = watchlistReceipt([
    row(),
    row({ thscode: '600519.SH', name: '贵州茅台', holding: { weight_pct: null, marked_at: NOW - 3 * DAY_MS } }),
    row({ thscode: '000001.SZ', name: '平安银行', holding: { weight_pct: 0, marked_at: NOW - DAY_MS } }),
    row({ thscode: '00700.HK', name: '腾讯控股', asset_type: 'hk-stock', holding: { weight_pct: 37.5, marked_at: NOW - 40 * DAY_MS } }),
  ], 30, NOW)
  const [plain, blank, zero, marked] = receipt.items

  assert.equal(plain.held, false, '没有 holding 那一格 = 未持仓')
  assert.equal('weight_pct' in plain, false, '⛔ "根本不是仓位"的行不出现比例两格：30 行满载要留在体积预算内，而三态由 held 点名')
  assert.equal('holding_marked_date' in plain, false)

  assert.equal(blank.held, true)
  assert.equal(blank.weight_pct, null, '⛔ "标了持仓、比例没填"是 null，不是 0——写成 0% 等于替用户说了一句他没说的话')

  assert.equal(zero.weight_pct, 0, '⛔ 用户真填的 0 必须原样是 0，不许被当成"没填"改写成 null')

  assert.equal(marked.weight_pct, 37.5)
  assert.equal(typeof marked.holding_marked_date, 'string', '标记日期要给出去：主 Agent 靠它判断这句话说了多久')
  assert.equal(receipt.limit, 30, '上限跟着宿主回包走，不在这里抄一份常量')
})

test('行的顺序就是面板的顺序（置顶在前由服务端读法给出，这里不再排第二次）', async () => {
  const receipt = watchlistReceipt([
    row({ thscode: '00700.HK', name: '腾讯控股', asset_type: 'hk-stock', pinned_at: NOW - DAY_MS }),
    row({ thscode: '000001.SH', name: '上证指数' }),
  ], undefined, NOW)
  assert.deepEqual(receipt.items.map((item) => item.thscode), ['00700.HK', '000001.SH'])
})

test('名字里的不可见字符进模型之前必须剥掉；剥空了退回代码', async () => {
  const receipt = watchlistReceipt([
    row({ thscode: 'AAPL.OQ', name: 'Apple‮​', asset_type: 'us-stock' }),
    row({ thscode: 'TCEHY.PS', name: '​‍', asset_type: 'us-stock' }),
  ], undefined, NOW)
  assert.equal(receipt.items[0].name, 'Apple', '方向覆盖符与零宽符肉眼看不见，却能让用户核对的那句话与 Agent 收到的不一样')
  assert.equal(receipt.items[1].name, 'TCEHY.PS', '剥完是空的就退回代码，不放一个空字符串上去')
  assert.equal(receipt.limit, undefined, '宿主没给 limit 就不编一个数')
})

test('N 天前由回包里那两个日期算出，且时钟回拨不产生"负几天前"', async () => {
  const receipt = watchlistReceipt([
    row({ thscode: 'A.SH', holding: { weight_pct: 10, marked_at: NOW - 40 * DAY_MS } }),
    row({ thscode: 'B.SH', holding: { weight_pct: 20, marked_at: NOW + 5 * DAY_MS } }),
  ], undefined, NOW)
  assert.equal(receipt.items[0].holding_marked_age_days,
    dayDistance(receipt.items[0].holding_marked_date, receipt.as_of_date),
    '⛔ "几天前标的"必须由**回包里那两个日期**算出：模型不该拿 epoch 自己减（主 persona 的 TIME DISCIPLINE）')
  assert.equal(receipt.items[1].holding_marked_age_days, 0, '机器时钟回拨过会让"N 天前"变负数，下界取 0')
  assert.match(receipt.items[1].holding_marked_date, /^\d{4}-\d{2}-\d{2}$/u, '日期那一格仍给原值，异常照样看得见')
  assert.match(receipt.as_of_date, /^\d{4}-\d{2}-\d{2}$/u)
})

test('⛔ 服务没挂载 ≠ 用户没有自选：两种"没有内容"的回包形状必须不同', async () => {
  const missing = await executeWith(() => undefined)
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'watchlist_unavailable')
  assert.equal(missing.items, undefined, '失败回包里根本不许出现 items——那会把"读不到"说成"清单是空的"')
  assert.match(missing.message, /不是"用户没有自选股"/, '失败文案要点名这不该被当成空清单')

  const noMethod = await executeWith(() => ({}))
  assert.equal(noMethod.ok, false, '服务在但没有 list 方法，也是装配问题而不是空清单')
  assert.equal(noMethod.items, undefined)

  const none = await executeWith(() => ({ list: async () => ({ ok: true, items: [], limit: 30 }) }))
  assert.equal(none.ok, true)
  assert.equal(none.count, 0)
  assert.deepEqual(none.items, [], '这一次才是"用户确实一条自选都没有"')
})

test('存储抛错要响亮失败，上游 code 透出来，绝不退化成空清单', async () => {
  const thrown = await executeWith(() => ({
    list: async () => { throw Object.assign(new Error('invalid unit name'), { code: 'malformed-medium' }) },
  }))
  assert.equal(thrown.ok, false)
  assert.equal(thrown.code, 'store_unavailable')
  assert.match(thrown.message, /invalid unit name/, '上游原话要能定位，但不带密钥')
  assert.equal(thrown.items, undefined)

  const notOk = await executeWith(() => ({ list: async () => ({ ok: false, code: 'list_full' }) }))
  assert.equal(notOk.ok, false)
  assert.equal(notOk.code, 'store_unavailable')
})

test('两种形态都过自己声明的 output.schema，且漏一个字段必须变红（复刻事故形态）', async () => {
  const definition = watchlistToolDefinition(() => ({ list: async () => ({ ok: true, items: [row()], limit: 30 }) }))
  const success = await definition.execute({}, {})
  assert.doesNotThrow(() => assertToolOutput(definition, success), '成功形态必须满足声明')

  const failureDefinition = watchlistToolDefinition(() => undefined)
  const failure = await failureDefinition.execute({}, {})
  assert.doesNotThrow(() => assertToolOutput(failureDefinition, failure), '失败形态同样要满足声明')

  assert.deepEqual(collectUndeclaredRequired(definition.output.schema), [], 'required 里的键必须都在声明内')
  const stripped = { ...success }
  delete stripped.ok
  assert.throws(() => assertToolOutput(definition, stripped), /ok/,
    '反向对照：漏一个 required 字段必须红——否则这条闸门等于没写')
  assert.throws(() => assertToolOutput(definition, { ...success, quote_price: 1 }), /quote_price/,
    'additionalProperties:false：顶层多回一个未声明字段同样致命')
  const rowExtra = { ...success.items[0], quote: 1 }
  assert.throws(() => assertToolOutput(definition, { ...success, items: [rowExtra] }), /quote/,
    '行级同理：报价一格都不许带出（它会把本工具变成第三份行情来源）')

  assertLosslessJson(success)
  assertLosslessJson(failure)
})

test('⛔ 30 条满载回包必须留在体积预算内：超阈值是静默截尾，不是报错', async () => {
  const full = []
  for (let index = 0; index < 30; index += 1) {
    full.push(row({
      thscode: `${String(300000 + index).padStart(6, '0')}.SZ`,
      name: `标的名称-${index}`,
      holding: index % 3 === 0 ? { weight_pct: 3.25, marked_at: NOW - index * DAY_MS } : undefined,
      pinned_at: index === 0 ? NOW : undefined,
    }))
  }
  const text = JSON.stringify(watchlistReceipt(full, 30, NOW))
  const chars = [...text].length
  assert.ok(chars < 6_144, `满载回包 ${chars} 码点，超过本仓给工具结果的 6144 余量——pruner 会砍掉尾部那几只的持仓行`)
})

test('description 是模型侧唯一事实来源：四句必须说得出口的纪律都在里面', () => {
  // 面板与宿主的口径改了而这里没改，表现是"模型按一句已经不成立的话回答用户"，
  // 而且不会有任何测试红——所以钉的是**句子**，不是实现。
  const { description } = watchlistToolDefinition(() => undefined)
  assert.match(description, /\*\*只读\*\*/, '写入口只在面板里，这句得写出来')
  assert.match(description, /weight_pct:null/, '标了没填比例 ≠ 0%，这一档模型必须知道怎么读')
  assert.match(description, /指数不是一个可持有、可配比率的标的/, '⛔ 2026-10-09 改判：指数没有持仓入口，面板只给个股与场内基金')
  assert.match(description, /只做多、不算 put[\s\S]{0,40}120%/, '⛔ 合计上限这句要说得出：模型读到一叠 100% 时要知道面板本来就挡着 120，而不是替用户"补满 100%"')
  assert.match(description, /ok:true.*count:0|count:0/, '两种"没有内容"要分开说：读不到 ≠ 用户没有自选股')
})
