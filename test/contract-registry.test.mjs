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
} from '../scripts/lib/contract-registry.mjs'

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

test('参数能过生产自己的 normalizeParams——拼错键名在 CI 就红，不等线上报 unsupported parameter', () => {
  for (const entry of liveSourceEntries) {
    const source = registered.get(entry.capability)
    assert.ok(source, `${entry.capability} 找不到对应 DataSource`)
    // requires 的 id 由 runner 在运行时从真实响应解析；这里塞占位值只为走通 schema 校验，
    // ⛔ 它绝不会被发出去（本文件一个请求都不发），编造 id 上线是 §10.3 明令禁止的。
    const params = entry.requires ? { ...entry.params, [entry.requires]: 'PLACEHOLDER_ID' } : entry.params
    if (typeof source.normalizeParams === 'function') {
      try {
        source.normalizeParams(params)
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
    const params = entry.requires ? { ...entry.params, [entry.requires]: 'PLACEHOLDER_ID' } : entry.params
    const once = source.normalizeParams(params)
    assert.deepEqual(source.normalizeParams(once), once, `${entry.capability} 的归一化不幂等`)
  }
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
  // UTC 周五 23:00 = 北京周六 07:00：这正是 workflow 里那条 cron 真正触发的时刻。
  assert.equal(resolveTier(new Date(Date.UTC(2026, 9, 9, 23, 0, 0))), 'full', '北京周六必须打全量')
  // UTC 周四 23:00 = 北京周五 07:00。
  assert.equal(resolveTier(new Date(Date.UTC(2026, 9, 8, 23, 0, 0))), 'daily')
  // UTC 周六 01:00 = 北京周六 09:00（手动补跑的情形）。
  assert.equal(resolveTier(new Date(Date.UTC(2026, 9, 10, 1, 0, 0))), 'full')
  // UTC 周日 23:00 = 北京周一 07:00。
  assert.equal(resolveTier(new Date(Date.UTC(2026, 9, 11, 23, 0, 0))), 'daily')
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

test('cron 与 resolveTier 咬合：UTC 星期/小时写错，北京周六那档全量就永远打不到', () => {
  const crons = [...workflow.matchAll(/- cron:\s*'([^']+)'/g)].map((m) => m[1])
  assert.equal(crons.length, 2, `工作日与周六要各一条 cron，实际 ${crons.length} 条`)
  // 北京周一到周六的档位，由每条 cron 的 (UTC 小时, UTC 星期) 反推——只有周六必须是 full。
  const tierByBeijingDay = new Map()
  for (const cron of crons) {
    const [minute, hour, , , dow] = cron.split(' ')
    assert.equal(minute, '0', '分钟字段必须是整点')
    assert.equal(hour, '23', '北京 07:00 只能写成 UTC 23:00（退一天）；写 7 会变成北京 15:00')
    for (let day = 0; day < 7; day += 1) {
      if (!expandCronDay(day, dow)) continue
      // 2026-10-04 是周日：day 偏移后就是那周的 UTC 星期 day。
      const fired = new Date(Date.UTC(2026, 9, 4 + day, Number(hour), Number(minute)))
      assert.equal(fired.getUTCDay(), day, `锚点日期算错了星期（${fired.toISOString()}）`)
      const beijing = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(fired)
      const tier = resolveTier(fired)
      const seen = tierByBeijingDay.get(beijing)
      assert.ok(seen === undefined || seen === tier, `北京${beijing}被两条 cron 打出不同档位（${seen} / ${tier}）`)
      tierByBeijingDay.set(beijing, tier)
    }
  }
  assert.deepEqual([...tierByBeijingDay.keys()].sort(), ['Fri', 'Mon', 'Sat', 'Thu', 'Tue', 'Wed'],
    '北京周一到周六都要有排程（周日不跑）')
  assert.equal(tierByBeijingDay.get('Sat'), 'full', '只有北京周六打全量')
  for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
    assert.equal(tierByBeijingDay.get(day), 'daily', `北京${day}应该只打 daily 档`)
  }
})

/** cron 的星期字段：`0-4`、`5`、`*`、逗号列表都算一下（本仓只用到前两种，但别写死）。 */
function expandCronDay(day, field) {
  if (field === '*') return true
  return field.split(',').some((part) => {
    const [from, to] = part.includes('-') ? part.split('-').map(Number) : [Number(part), Number(part)]
    return day >= from && day <= to
  })
}
