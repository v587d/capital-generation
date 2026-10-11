/**
 * 契约巡检注册表的覆盖闸门（`docs/dev/tool-schema.md` §10.8）。
 *
 * 为什么钉这么死：注册表是**唯一**能回答「这条能力到底有没有在被巡检」的地方。
 * 漏一行的表现不是报错，而是"今天全绿"——与 §9.7 那次 61 颗同花顺能力静默不注册、
 * 整场进程不重试是同一族失效：静默的缺席看起来像存在。
 *
 * 全部离线：只 import `lib/` 读 schema，**不发任何网络请求**（网络巡检只在 schedule /
 * workflow_dispatch 跑，见设计 §10 第 7 条）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createFuyaoRestSources } from '../lib/sources/fuyao-rest.js'
import { createEastmoneySources } from '../lib/sources/eastmoney-http.js'
import { createTencentSources } from '../lib/sources/tencent-http.js'
import { createWindSources } from '../lib/sources/wind-mcp.js'
import {
  CONTRACT_PROBES, KNOWN_GAP_CODES, PROBE_FAMILIES, stateOf, secretRefOf, probesForTier, resolveTier,
  lastScheduledDue, previousScheduledDue, beijingDateOf, resolveDayShifts,
} from '../scripts/lib/contract-registry.mjs'
import { withResolvedDates } from '../scripts/lib/contract-probe.mjs'

/** 生产里真注册出来的 DataSource 能力全集——覆盖数的分母，不数注册表自己。 */
const registered = new Map()
for (const [factory, list] of [
  ['fuyao', createFuyaoRestSources(async () => 'coverage-check-only')],
  ['eastmoney', createEastmoneySources()],
  ['tencent', createTencentSources()],
  ['wind', createWindSources()],
]) {
  for (const source of list) {
    assert.ok(!registered.has(source.schema.capability), `能力 ${source.schema.capability} 被注册了两次`)
    registered.set(source.schema.capability, source)
  }
}

const sourceEntries = CONTRACT_PROBES.filter((entry) => entry.face === 'datasource')
/** 真会发请求的那些才谈得上参数合法：excluded 条目永远不出网，参数是空占位。 */
const liveSourceEntries = sourceEntries.filter((entry) => !entry.excluded)
const capabilitiesOf = (face) => CONTRACT_PROBES.filter((e) => e.face === face).map((e) => e.capability)

test('注册表覆盖住每一颗已注册能力：漏一行就红，且不许有多余行', () => {
  const covered = capabilitiesOf('datasource')
  const dupes = covered.filter((c, i) => covered.indexOf(c) !== i)
  assert.deepEqual(dupes, [], `注册表里这些能力出现不止一次：${dupes.join(', ')}`)
  const missing = [...registered.keys()].filter((c) => !covered.includes(c))
  assert.deepEqual(missing, [], `这些已注册能力没有巡检条目（新增端点要同时补一行，四态取一）：${missing.join(', ')}`)
  const unknown = covered.filter((c) => !registered.has(c))
  // 删能力是合法动作，所以这里不许把话只说一半：正确答案通常是**把注册表这一行一起删掉**，
  // 而不是"补一颗能力回去"——只报"多了行"不报往哪修，AI 就会去救错的那一侧。
  assert.deepEqual(unknown, [], `注册表指向不存在的能力：${unknown.join(', ')}。三选一——`
    + `① 改名了：把这一行的 capability 同步成新名；② 这条能力被删了：把这一行一起删掉（两边同时消失才对，`
    + `不要为了变绿把能力补回生产）；③ 想留下这条记录：改成 out() / dsOut() 的 excluded 并写理由与 since。`)
})

test('每条恰好落进一个状态：shadow 是叠在 tier 上的，excluded 不许带 tier', () => {
  for (const entry of CONTRACT_PROBES) {
    if (entry.excluded) {
      assert.equal(entry.tier, undefined, `${entry.capability} 是 excluded，不该还带 tier（会被误当真打）`)
      assert.equal(entry.shadow, undefined, `${entry.capability} 既 excluded 又 shadow，状态读不出来`)
      continue
    }
    // daily / weekly 是"什么时候打"，shadow 是"打了算不算"——两者正交，不是并列。
    assert.ok(['daily', 'weekly'].includes(entry.tier), `${entry.capability} 缺 tier：不真打的条目应该写成 excluded`)
    if (entry.shadow) assert.ok(!entry.knownCodes, `${entry.capability} 走影子就不该再叠 knownCodes，两层豁免叠起来没人读得懂`)
  }
})

test('excluded / shadow / 已知红都必须带出处：since + 理由，shadow 还要 revisit', () => {
  const today = new Date().toISOString().slice(0, 10)
  for (const entry of CONTRACT_PROBES) {
    if (entry.excluded) {
      assert.match(entry.excluded.since ?? '', /^\d{4}-\d{2}-\d{2}$/, `${entry.capability} 的 excluded.since 不是 YYYY-MM-DD`)
      assert.ok((entry.excluded.reason ?? '').length >= 8, `${entry.capability} 被排除了但没写理由`)
    }
    if (entry.shadow) {
      assert.match(entry.shadow.since ?? '', /^\d{4}-\d{2}-\d{2}$/, `${entry.capability} 的 shadow.since 不是 YYYY-MM-DD`)
      assert.ok((entry.shadow.evidence ?? '').length >= 8, `${entry.capability} 走影子但没写实测证据`)
      // 过期即红：没有出处的排除会烂到某天有人以为它正在被保护。
      assert.ok(entry.shadow.revisit, `${entry.capability} 走影子但没有 revisit 日期`)
      assert.ok(entry.shadow.revisit >= today, `${entry.capability} 的影子复核日 ${entry.shadow.revisit} 已过期——重新看一眼，或改成 active，别默默续期`)
    }
    for (const code of entry.knownCodes ?? []) {
      assert.ok(KNOWN_GAP_CODES.includes(code), `${entry.capability} 的 knownCodes 里有 ${code}，不在允许的数据缺口码内`)
    }
  }
})

test('每条 active/shadow 都有延迟预算，且是正有限数', () => {
  for (const entry of CONTRACT_PROBES.filter((e) => !e.excluded)) {
    assert.ok(Number.isFinite(entry.budgetMs) && entry.budgetMs > 0, `${entry.capability} 的 budgetMs 非法：${entry.budgetMs}`)
  }
})

/**
 * 参数进生产校验之前先过一遍 `resolveDayShifts`：runner 就是这么喂的，跳过这步等于验了一个
 * 生产永远拿不到的形状（相对窗在标记状态下根本不是字符串）。
 */
const ANCHOR = new Date('2026-10-11T20:00:00Z')   // 北京周一 04:00 那一档的名义时刻
/** requires 的 id 由 runner 运行时从真实响应解析；这里只要形状合法，⛔ 绝不发出去（§10.3）。 */
const ID_PLACEHOLDER = { manager_id: 'PLACEHOLDER_ID', company_id: 'PLACEHOLDER_ID', ticker: '000001.SZ' }
function requestShape(entry) {
  const params = resolveDayShifts(entry.params ?? {}, ANCHOR)
  if (!entry.requires) return params
  assert.ok(ID_PLACEHOLDER[entry.requires], `${entry.capability} 的 requires=${entry.requires} 没有占位值，补 ID_PLACEHOLDER`)
  return { ...params, [entry.requires]: ID_PLACEHOLDER[entry.requires] }
}

test('参数能过生产自己的 normalizeParams——拼错键名在 CI 就红，不等线上报 unsupported parameter', () => {
  for (const entry of liveSourceEntries) {
    const source = registered.get(entry.capability)
    assert.ok(source, `${entry.capability} 找不到对应 DataSource`)
    if (typeof source.normalizeParams === 'function') {
      try {
        source.normalizeParams(requestShape(entry))
      } catch (error) {
        assert.fail(`${entry.capability} 的巡检参数被生产 normalizeParams 拒了：${error.message}`)
      }
    }
  }
})

test('归一化必须幂等：第二遍的输入就是第一遍的输出（§10.7）', () => {
  for (const entry of liveSourceEntries) {
    // 覆盖闸门已经把"指向不存在的能力"点名报红了；这里再解引用就只会剩一条
    // `Cannot read properties of undefined` 的裸 TypeError——删了能力的人会被它带偏去"修测试"，
    // 而正确答案是删掉注册表那一行。缺席由上面那条负责，这里直接跳过。
    const source = registered.get(entry.capability)
    if (!source) continue
    if (typeof source.normalizeParams !== 'function') continue
    const once = source.normalizeParams(requestShape(entry))
    assert.deepEqual(source.normalizeParams(once), once, `${entry.capability} 的归一化不幂等`)
  }
})

test('dayShift 换算只认北京日历，跨月跨年都对，且不改入参', () => {
  // 2026-10-11T20:00Z 的 UTC 日是 10-11，北京日已经是 10-12——拿 UTC 日当"今天"会整周错一天。
  assert.deepEqual(resolveDayShifts({ end: { dayShift: 0 } }, ANCHOR), { end: '2026-10-12' })
  assert.deepEqual(resolveDayShifts({ a: { dayShift: -1 }, b: { dayShift: -30 }, n: 3 }, ANCHOR),
    { a: '2026-10-11', b: '2026-09-12', n: 3 }, '前一个自然日 / 往前 30 天都要落在北京日历上')
  // 跨年与向前推：北京 2027-01-01 那天往前一天是 2026-12-31，往后 90 天是 2027-04-01。
  const newYear = new Date('2026-12-31T20:00:00Z')
  assert.deepEqual(resolveDayShifts({ p: { dayShift: -1 }, q: { dayShift: 90 } }, newYear),
    { p: '2026-12-31', q: '2027-04-01' })
  // 数组与嵌套也要换（参数形状将来可能长出 filter 列表）。
  assert.deepEqual(resolveDayShifts({ list: [{ dayShift: -1 }], deep: { x: { dayShift: -2 } } }, ANCHOR),
    { list: ['2026-10-11'], deep: { x: '2026-10-10' } })
  // 不是标记的对象原样过去：宁可让它漏进生产校验炸响，也不要在巡检侧猜意图。
  const notMarker = { dayShift: -1, page: 1 }
  assert.deepEqual(resolveDayShifts({ p: notMarker }, ANCHOR), { p: notMarker })
  assert.equal(resolveDayShifts(undefined, ANCHOR), undefined, '没有参数的条目不该被造出一个 params')
  const input = { start: { dayShift: -30 } }
  resolveDayShifts(input, ANCHOR)
  assert.deepEqual(input, { start: { dayShift: -30 } }, '换算必须产出新对象，不许改注册表本身（注册表是共享的模块状态）')
  for (const bad of [{ dayShift: '3' }, { dayShift: 1.5 }, { dayShift: NaN }]) {
    assert.throws(() => resolveDayShifts({ d: bad }, ANCHOR), /dayShift/, `${JSON.stringify(bad)} 该响亮地炸`)
  }
})

test('龙虎榜两颗：窗跟着跑的那天走，单票代码从当天真榜单解析', () => {
  const market = CONTRACT_PROBES.find((e) => e.capability === 'eastmoney_top_buy_sell_market')
  const ticker = CONTRACT_PROBES.find((e) => e.capability === 'eastmoney_top_buy_sell_ticker')
  // 写死 end_date 的窗只会越来越旧，到点永久 EMPTY——上界必须是相对量，且必须是"过去"。
  for (const [name, entry] of [['market', market], ['ticker', ticker]]) {
    assert.equal(typeof entry.params.end_date.dayShift, 'number', `${name} 的 end_date 又写成死日期了`)
    assert.ok(entry.params.end_date.dayShift < 0, `${name} 的上界要取过去某日：04:00 打"今天"会拿到没数据的窗`)
    assert.ok(entry.params.start_date.dayShift < entry.params.end_date.dayShift, `${name} 的窗是倒的，必然空`)
  }
  assert.deepEqual(Object.keys(ticker.params).sort(), ['end_date', 'page', 'size', 'start_date'],
    'ticker 参数只能由运行时解析注入，写进注册表就是又编了一个 id（§10.3）')
  assert.equal(ticker.requires, 'ticker')
  assert.equal(ticker.resolveFrom.capability, 'eastmoney_top_buy_sell_market')
  assert.equal(ticker.resolveFrom.path, 'item.0.thscode', '要带市场后缀的 thscode，裸六位代码进不了生产的 normalizeTicker')
  assert.equal(CONTRACT_PROBES.filter((e) => e.requires === 'ticker').length, 1,
    'requires 的键名同时就是注入的参数名，两处用同一个键会解析到错的 provider')
  // provider 自己必须也在每天真打：解析走的是同一颗能力、同一份参数，不是第二条隐藏链路。
  const daily = probesForTier('daily')
  assert.ok(daily.some((e) => e.capability === 'eastmoney_top_buy_sell_market' && stateOf(e) !== 'excluded'),
    '龙虎榜单票依赖的那颗日档没在打，解析链路等于没被巡检过')
  assert.deepEqual(resolveDayShifts(ticker.resolveFrom.params, ANCHOR), resolveDayShifts(ticker.params, ANCHOR),
    'provider 与被注入条目的日期窗必须一模一样，否则"在榜"这个前提就断了')
  assert.deepEqual(market.expect, { minRows: 1 }, '全市场榜空了就是一次真失败，别让它混进 EMPTY 噪声')
})

/** 递归找还有没有没换算掉的标记。 */
const markersLeft = (value) => (Array.isArray(value) ? value.flatMap(markersLeft)
  : value && typeof value === 'object' ? (Object.keys(value).length === 1 && value.dayShift !== undefined
    ? [value.dayShift] : Object.values(value).flatMap(markersLeft)) : [])

test('runner 先把 dayShift 换成日期再走任何一步：漏掉它只有真发请求才会炸', () => {
  const billboard = CONTRACT_PROBES.filter((e) => e.capability.startsWith('eastmoney_top_buy_sell'))
  assert.equal(billboard.length, 2, '这两颗是标记参数的样本，注册表动了这里也要跟着看')
  const resolved = withResolvedDates(billboard, ANCHOR)
  for (const entry of resolved) {
    assert.deepEqual(markersLeft(entry), [], `${entry.capability} 还带着没换算的标记——生产校验拿到的是对象不是字符串`)
    assert.equal(entry.params.end_date, '2026-10-11', 'ANCHOR 是北京周一 04:00，前一个自然日 = 10-11')
  }
  const ticker = resolved.find((e) => e.capability === 'eastmoney_top_buy_sell_ticker')
  assert.deepEqual(markersLeft(ticker.resolveFrom.params), [], 'provider 的窗也要换算，否则解析那次请求带着标记出门')
  assert.deepEqual(ticker.resolveFrom.params, ticker.params, 'provider 与自己那份窗换算完必须一模一样')
  // 换算必须是"产出新条目"：CONTRACT_PROBES 是所有测试与 runner 共享的模块状态。
  const left = CONTRACT_PROBES.filter((e) => e.capability.startsWith('eastmoney_top_buy_sell')).flatMap(markersLeft)
  assert.ok(left.length >= 4 && left.every((days) => days === -30 || days === -1),
    `注册表本体被改写了：标记应当原样留着，实际剩下 ${JSON.stringify(left)}`)
  const all = withResolvedDates(CONTRACT_PROBES, ANCHOR)
  assert.equal(all.length, CONTRACT_PROBES.length, '换算不该增删条目')
  CONTRACT_PROBES.forEach((entry, index) => {
    if ('params' in entry) return
    assert.ok(!('params' in all[index]), `${entry.capability} 本来没有 params，换算不该造出一个 undefined 键`)
  })
  // 只验函数还不够：调用点被删掉的症状是"生产校验拿到一个对象"，而那只有真发请求才炸（§9.7 逐入口）。
  const runner = readFileSync(join(ROOT, 'scripts/lib/contract-probe.mjs'), 'utf8')
  assert.match(runner, /entries = withResolvedDates\(entries\)/,
    'runner 不再换算相对日期——注册表里的 dayShift 会原样漏进请求')
})

test('家族只能是限速分组里那几个，且每个家族都有条目', () => {
  for (const entry of CONTRACT_PROBES) {
    assert.ok(PROBE_FAMILIES.includes(entry.family), `${entry.capability} 的 family=${entry.family} 不在 PROBE_FAMILIES 里`)
  }
  for (const family of PROBE_FAMILIES) {
    assert.ok(CONTRACT_PROBES.some((e) => e.family === family), `家族 ${family} 一条都没有，要么补条目要么从 PROBE_FAMILIES 删掉`)
  }
})

test('能力名全表唯一（跨 face）', () => {
  const all = capabilitiesOf('datasource').concat(capabilitiesOf('probe'))
  const dupes = all.filter((c, i) => all.indexOf(c) !== i)
  assert.deepEqual(dupes, [], `重名会让 runner 分派到错的那一条：${dupes.join(', ')}`)
})

test('tier 取档：daily 只打日档，full 打日档+周档，excluded 永不出现', () => {
  const daily = probesForTier('daily')
  const full = probesForTier('full')
  assert.ok(daily.length > 0 && full.length > daily.length, '取档结果不合理')
  assert.ok(daily.every((e) => e.tier === 'daily'), 'daily 档里混进了非日档条目')
  assert.ok(full.every((e) => e.tier === 'daily' || e.tier === 'weekly'), 'full 档里混进了 excluded')
  assert.ok(!daily.some((e) => e.excluded) && !full.some((e) => e.excluded), 'excluded 条目绝不该被取到')
  assert.ok(daily.every((e) => ['active', 'shadow'].includes(stateOf(e))), '取到的档位里状态读不出来')
})

test('档位换算只认北京时区——cron 的星期是 UTC，读 runner 本地时间会错位一天', () => {
  // UTC 周五 20:00 = 北京周六 04:00：全量档那条 cron 真正触发的时刻。
  assert.equal(resolveTier(new Date(Date.UTC(2026, 9, 9, 20, 0, 0))), 'full', '北京周六必须打全量')
  // UTC 周四 20:00 = 北京周五 04:00：工作日档的触发时刻。
  assert.equal(resolveTier(new Date(Date.UTC(2026, 9, 8, 20, 0, 0))), 'daily')
  // UTC 周六 01:00 = 北京周六 09:00（调度迟到或手动补跑的情形，仍然是周六 → 仍打全量）。
  assert.equal(resolveTier(new Date(Date.UTC(2026, 9, 10, 1, 0, 0))), 'full')
  // UTC 周日 20:00 = 北京周一 04:00。
  assert.equal(resolveTier(new Date(Date.UTC(2026, 9, 11, 20, 0, 0))), 'daily')
  // 北京周六 00:59（UTC 周五 16:59）：跨 UTC 午夜不许把周六判成周五，否则全量档静默不跑。
  assert.equal(resolveTier(new Date(Date.UTC(2026, 9, 9, 16, 59, 0))), 'full', 'UTC 周五 16:59 = 北京周六 00:59')
  // ⚠️ 迟到把全量档推过北京午夜（>20h）才会翻成 daily——`schedule` 实测迟到 3~4 小时，余量足够。
})

test('开工前闸门要的凭据集合：只有真会发请求的条目才把 key 拉进检查范围', () => {
  const needed = new Set(probesForTier('daily').map(secretRefOf).filter(Boolean))
  assert.ok(needed.has('FUYAO_API_KEY'), 'daily 档至少要 FUYAO_API_KEY')
  assert.ok(needed.has('WIND_API_KEY'), 'daily 档的协议探针要 WIND_API_KEY')
  assert.ok(!needed.has('PADDLE_OCR_TOKEN'), 'PADDLE_OCR_TOKEN 只属于 weekly/excluded——缺它不该让日常巡检红（设计 §6.4）')
  for (const entry of CONTRACT_PROBES.filter((e) => !e.excluded)) {
    const ref = secretRefOf(entry)
    if (ref) assert.match(ref, /^[A-Z][A-Z0-9_]*$/, `${entry.capability} 的 secret 名不像环境变量：${ref}`)
  }
})

/**
 * CI 那道壳也要钉：注册表与 workflow 是两个载体，靠人记"两边要同步"必然漂移（§9.7 逐入口验证）。
 * 这里读 `.github/workflows/data-source-contract.yml` 正文，只钉两条会静默失效的耦合。
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const workflow = readFileSync(join(ROOT, '.github/workflows/data-source-contract.yml'), 'utf8')

test('每个档位要的凭据都在 workflow 里显式映射了：secrets 不会自动进环境', () => {
  const required = new Set(
    [...probesForTier('daily'), ...probesForTier('full')].map(secretRefOf).filter(Boolean))
  assert.ok(required.size >= 3, `凭据集合不该这么小：${[...required].join(', ')}`)
  for (const ref of [...required].sort()) {
    assert.match(
      workflow,
      new RegExp(`^\\s*${ref}: \\$\\{\\{ secrets\\.${ref} \\}\\}$`, 'm'),
      `workflow 没把 ${ref} 映射进巡检步骤的 env——assertCredentials() 会在发出任何请求之前把 job 判红，`
      + '而"CI 天天红、本地怎么跑都好"正是最难查的那类故障',
    )
  }
})

test('cron 与 resolveTier / 北京时间咬合：北京周一~周六都在 04:00，小时或星期写错都会错档', () => {
  const crons = [...workflow.matchAll(/- cron:\s*'([^']+)'/g)].map((m) => m[1])
  // 工作日与周六共用同一个 UTC 小时（20:00），所以一条 cron 就够。要拆回两条，
  // 连 `SCHEDULE_UTC` 与下面那些 hour 断言一起想清楚——别只改 YAML 那一侧。
  assert.equal(crons.length, 1, `04:00 这一档工作日与周六同刻，一条 cron 足够；实际 ${crons.length} 条`)
  const byBeijingDay = new Map()
  for (const cron of crons) {
    const [minute, hour, , , dow] = cron.split(' ')
    assert.equal(minute, '0', '分钟字段必须是整点')
    for (let day = 0; day < 7; day += 1) {
      if (!expandCronDay(day, dow)) continue
      // 2026-10-04 是周日：day 偏移后就是那周的 UTC 星期 day。
      const fired = new Date(Date.UTC(2026, 9, 4 + day, Number(hour), Number(minute)))
      assert.equal(fired.getUTCDay(), day, `锚点日期算错了星期（${fired.toISOString()}）`)
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai', weekday: 'short', hour: 'numeric', hour12: false,
      }).formatToParts(fired)
      const of = (type) => Number(parts.find((p) => p.type === type).value)
      const beijing = parts.find((p) => p.type === 'weekday').value
      const seen = byBeijingDay.get(beijing)
      assert.ok(!seen || (seen.tier === resolveTier(fired) && seen.hour === of('hour')),
        `北京${beijing}被两条 cron 打出不同时间或档位（${JSON.stringify(seen)} / ${of('hour')} ${resolveTier(fired)}）`)
      byBeijingDay.set(beijing, { tier: resolveTier(fired), hour: of('hour') })
    }
  }
  assert.deepEqual([...byBeijingDay.keys()].sort(), ['Fri', 'Mon', 'Sat', 'Thu', 'Tue', 'Wed'],
    '北京周一到周六都要有排程（周日不跑）')
  for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
    assert.equal(byBeijingDay.get(day).tier, 'daily', `北京${day}应该只打 daily 档`)
    assert.equal(byBeijingDay.get(day).hour, 4, `北京${day}要在 04:00 打（UTC 侧写成前一天 20:00，退一天）`)
  }
  assert.equal(byBeijingDay.get('Sat').tier, 'full', '只有北京周六打全量')
  assert.equal(byBeijingDay.get('Sat').hour, 4, '北京周六也 04:00：全量档实测约 3 分钟跑完，没有理由留在 07:00')
  // 04:00 买的是什么：实测 schedule 迟到 3~4 小时，04:00 + 4h ≈ 北京 08:00，还在 09:30 开盘之前。
  // 迟到没有上界，所以这条断言只是钉"意图"，任何逻辑都不许建立在"刚好 4 点"上（看门狗判上一档）。
})

/** cron 的星期字段：`0-4`、`5`、`*`、逗号列表都算一下（本仓只用到前两种，但别写死）。 */
function expandCronDay(day, field) {
  if (field === '*') return true
  return field.split(',').some((part) => {
    const [from, to] = part.includes('-') ? part.split('-').map(Number) : [Number(part), Number(part)]
    return day >= from && day <= to
  })
}

test('lastScheduledDue：北京周一~周六 04:00 才该跑，周日那一档不存在', () => {
  const iso = (d) => d.toISOString()
  // UTC 周四 20:30 = 北京周五 04:30，就是这一档自己。
  assert.equal(iso(lastScheduledDue(new Date('2026-10-08T20:30:00Z'))), '2026-10-08T20:00:00.000Z')
  // UTC 周五 01:30 = 北京周五 09:30（看门狗名义时刻）→ 回看今早 04:00 那一档。
  assert.equal(iso(lastScheduledDue(new Date('2026-10-09T01:30:00Z'))), '2026-10-08T20:00:00.000Z')
  // UTC 周五 20:30 = 北京周六 04:30：全量档自己，档位不同但同一小时。
  assert.equal(iso(lastScheduledDue(new Date('2026-10-09T20:30:00Z'))), '2026-10-09T20:00:00.000Z')
  // UTC 周六 01:30 = 北京周日 09:30：北京周日不排程，最近应跑仍是北京周六那档，不许误报"没跑"。
  assert.equal(iso(lastScheduledDue(new Date('2026-10-10T01:30:00Z'))), '2026-10-09T20:00:00.000Z')
  // UTC 周六 20:30 = 北京周日 04:30：这一档根本不该存在，回看周六。
  assert.equal(iso(lastScheduledDue(new Date('2026-10-10T20:30:00Z'))), '2026-10-09T20:00:00.000Z')
  // UTC 周日 01:30 = 北京周日 09:30（看门狗）：仍然只欠到北京周六那一档。
  assert.equal(iso(lastScheduledDue(new Date('2026-10-11T01:30:00Z'))), '2026-10-09T20:00:00.000Z')
  // UTC 周一 01:30 = 北京周一 09:30：今早 04:00 = UTC 周日 20:00 那一档。
  assert.equal(iso(lastScheduledDue(new Date('2026-10-12T01:30:00Z'))), '2026-10-11T20:00:00.000Z')
})

/**
 * 看门狗用的是**上一档**，不是最近应跑那一档。这里的用例就是把 2026-10-09/10 两天的实测
 * 钉住：探针名义 07:00、实际 10:48 与 10:13 落地，而看门狗名义 09:30 就要判——
 * 按最近应跑判，那一刻心跳为 0，会开出一张假告警。判上一档之后，迟到的那条照样算心跳。
 */
test('previousScheduledDue：看门狗判上一档，探针迟到几小时都不该被当成没跑', () => {
  const iso = (d) => d.toISOString()
  // 北京周一 09:30（UTC 周一 01:30）：本档（北京周一 04:00）此刻可能还没落地，改判北京周六那档。
  assert.equal(iso(previousScheduledDue(new Date('2026-10-12T01:30:00Z'))), '2026-10-09T20:00:00.000Z')
  // 北京周二 09:30：判北京周一那一档——迟到 6 小时（UTC 周一 02:00 落地）也在 due 之后，算心跳。
  assert.equal(iso(previousScheduledDue(new Date('2026-10-13T01:30:00Z'))), '2026-10-11T20:00:00.000Z')
  // 北京周日 09:30：上一档同样是北京周六（周日本来就没排程），不许因为"今天没档"而报错。
  assert.equal(iso(previousScheduledDue(new Date('2026-10-11T01:30:00Z'))), '2026-10-09T20:00:00.000Z')
  // 实测回放：due = UTC 周五 20:00，run created_at = UTC 周六 02:13（迟到 6h13m）→ 算心跳。
  const due = previousScheduledDue(new Date('2026-10-10T01:30:00Z'))
  assert.ok(new Date('2026-10-10T02:13:56Z') >= due, '迟到 6 小时的 schedule 记录必须算心跳')
  // 反向：调度器真死了，上一档之后什么都没有——这才是要报警的时刻。
  assert.ok(due < new Date('2026-10-10T01:30:00Z'), '判据必须已经过期一整天，否则又回到比迟到的老坑')
})

test('beijingDateOf：报告与 Issue 标题按北京切日，否则每天的单都盖着前一天', () => {
  // 北京 04:00 = UTC 前一天 20:00；直接 at.slice(0,10) 会把 10-10 那次巡检写成 10-09。
  assert.equal(beijingDateOf('2026-10-09T20:00:00.000Z'), '2026-10-10', '北京周六 04:00 那档')
  assert.equal(beijingDateOf('2026-10-11T20:00:00.000Z'), '2026-10-12', '北京周一 04:00 那档')
  assert.equal(beijingDateOf('2026-10-09T15:59:00.000Z'), '2026-10-09', '北京 23:59 还在当天')
  assert.equal(beijingDateOf(new Date('2026-10-09T02:48:52Z')), '2026-10-09', '迟到 4 小时那次实测')
})

test('lastScheduledDue 与 workflow 的 cron 必须同构（星期与小时都要一致）', () => {
  // 排程真值在 YAML、推算在注册表，两份载体一分叉就两种结局：天天误报，或整周静默遮丑。
  const crons = [...workflow.matchAll(/- cron:\s*'([^']+)'/g)].map((m) => m[1])
  const slotHour = new Map()
  for (const cron of crons) {
    const [, hour, , , dow] = cron.split(' ')
    for (let d = 0; d < 7; d += 1) {
      if (!expandCronDay(d, dow)) continue
      assert.ok(!slotHour.has(d), `UTC 星期 ${d} 被两条 cron 重复排程，lastScheduledDue 只会认第一条`)
      slotHour.set(d, Number(hour))
    }
  }
  for (const [d, hour] of slotHour) {
    const slot = Date.UTC(2026, 9, 4 + d, hour)   // 2026-10-04 是 UTC 周日
    assert.equal(lastScheduledDue(new Date(slot + 30 * 60_000)).getTime(), slot,
      `UTC 星期 ${d} 的 ${hour}:00 那一档 cron 排了，lastScheduledDue 却判成别的时间——SCHEDULE_UTC 没跟着改`)
  }
  assert.ok(!slotHour.has(6), 'UTC 周六（北京周日）不该有排程')
  // 那一天空着就是空着：lastScheduledDue 不许在没排程的 UTC 星期上凭空造出一档。
  const ghostDay = [0, 1, 2, 3, 4, 5, 6].find((d) => !slotHour.has(d))
  assert.ok(ghostDay !== undefined, '一周七天都排了程——北京周日那一档被凭空造出来了')
  const ghost = Date.UTC(2026, 9, 4 + ghostDay, [...slotHour.values()][0], 30)
  assert.ok(lastScheduledDue(new Date(ghost)).getTime() < ghost,
    `UTC 星期 ${ghostDay}（北京周日）cron 没排，lastScheduledDue 却把它当成"应跑已过"`)
})
