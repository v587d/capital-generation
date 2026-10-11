/**
 * 看门狗的心跳判据（`lib/contract-report.mjs` 的 `heartbeatVerdict` / `isWatchdogAlarm`）。
 *
 * 这个文件存在的理由很具体：在旧的北京 07:00 档上，探针实际 10:48 与 10:13 才落地，而看门狗名义
 * 09:30 就要判——**按"本档该跑了没跑"这个口径，那两天每一天都会开出一张假告警**，当时没开，
 * 纯粹因为看门狗自己迟到了 6 小时（比探针还晚）。把 07:00 提前到 04:00 只是把名义余量从 2.5 小时
 * 涨到 5.5 小时，仍然是在赌谁迟到得更少；判上一档才是把余量变成一整天，而 `schedule` 的迟到没有上界。
 *
 * 全部离线：喂真实的 run 记录形状（`event` / `created_at` / `status` / `conclusion`），不打网络。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { lastScheduledDue, previousScheduledDue } from '../scripts/lib/contract-registry.mjs'
import { WATCHDOG_MARKER, heartbeatVerdict, isWatchdogAlarm } from '../scripts/lib/contract-report.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// 2026-10-08 那次手动 dispatch 因 `.mjs` 里写了 TS 语法而整只脚本没被任何 import 覆盖（CI 才炸）。
const watchdog = readFileSync(join(ROOT, 'scripts/contract-watchdog.mjs'), 'utf8')

/** 真实抓取的两条 schedule 记录（run #3 / #4），加上当天那两次 workflow_dispatch。 */
const REAL_RUNS = [
  { event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-10-10T02:13:56Z' },
  { event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-10-09T02:48:52Z' },
  { event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: '2026-10-09T00:07:31Z' },
  { event: 'workflow_dispatch', status: 'completed', conclusion: 'failure', created_at: '2026-10-08T07:22:26Z' },
]

/** 只保留"那一刻已经存在"的记录——把后来的记录一起塞进去等于不给误报留机会，测了个寂寞。 */
const visibleAt = (at) => REAL_RUNS.filter((run) => new Date(run.created_at) <= new Date(at))

test('实测回放：真实迟到的 schedule 记录，看门狗在每一个名义时刻都该判正常', () => {
  for (const at of ['2026-10-10T01:30:00Z', '2026-10-11T01:30:00Z', '2026-10-12T01:30:00Z']) {
    const runs = visibleAt(at)
    assert.ok(runs.some((run) => run.event === 'schedule'), `${at} 之前没有 schedule 记录，这条用例没内容`)
    const verdict = heartbeatVerdict(runs, new Date(at))
    assert.ok(verdict.ok, `${at}：due ${verdict.due.toISOString()}，${runs.filter((r) => r.event === 'schedule').length} 条`
      + '迟到的 schedule 记录摆在那里，判"巡检未运行"就是误报')
  }
})

test('判上一档：被检查那一档至少已经过去一整天，迟到要迟满 24h 才会被当成没跑', () => {
  for (let d = 0; d < 7; d += 1) {
    const now = new Date(Date.UTC(2026, 9, 4 + d, 1, 30))   // 看门狗的名义时刻，每一天都过一遍
    const due = previousScheduledDue(now)
    const ageHours = (now - due) / 3_600_000
    assert.ok(ageHours >= 24, `UTC 星期 ${d}：due ${due.toISOString()} 距 ${now.toISOString()} 只有 ${ageHours.toFixed(1)}h，`
      + '探针按实测迟到 3~4 小时就会被误判——判据必须落在"上一档"')
  }
})

test('本档口径只剩 5.5 小时余量，同一刻它会误报而上一档不会', () => {
  const now = new Date('2026-10-12T01:30:00Z')       // 看门狗名义时刻 = 北京周一 09:30
  const slot = lastScheduledDue(now)               // 本档 = 北京周一 04:00（UTC 周日 20:00）
  const prev = previousScheduledDue(now)           // 上一档 = 北京周六 04:00
  assert.equal(slot.toISOString(), '2026-10-11T20:00:00.000Z')
  assert.equal(prev.toISOString(), '2026-10-09T20:00:00.000Z')
  // 实测迟到已经用掉 3.2~3.8 小时，剩下这点余量经不起一个高负载的整点；schedule 的迟到没有上界。
  assert.equal((now - slot) / 3_600_000, 5.5, '本档口径的余量 = 探针允许迟到的上限，改排程小时要连这条一起想清楚')
  assert.ok((now - prev) / 3_600_000 >= 24, '上一档口径：要迟满一整天才算没跑')
  const runs = visibleAt(now)
  assert.equal(runs.some((run) => run.event === 'schedule' && new Date(run.created_at) >= slot), false,
    '本档口径在这一刻判"没跑"——周一那次可能只是还在路上，这就是过去误报的形状')
  assert.ok(heartbeatVerdict(runs, now).ok, '上一档口径：认北京周六那个迟到 6h13m 的 02:13 记录算心跳')
  // 反例：调度器真死了——北京周三 09:30 时可见记录还停在上周六，上一档口径也必须报出来。
  const dead = '2026-10-14T01:30:00Z'
  assert.equal(heartbeatVerdict(visibleAt(dead), new Date(dead)).ok, false,
    '欠了两档还判正常，这条规则就只剩吞警报这一个功能了')
})

test('只有手动 dispatch 不算心跳：人替它跑一次，不是调度器活着', () => {
  const dispatchOnly = REAL_RUNS.filter((run) => run.event === 'workflow_dispatch')
  const verdict = heartbeatVerdict(dispatchOnly, new Date('2026-10-12T01:30:00Z'))
  assert.equal(verdict.ok, false, '两次成功的手动补跑不能证明 schedule 还活着')
  assert.equal(verdict.newest, undefined, 'newest 只能来自 schedule——否则正文会写"最近一次 6 小时前"把停摆洗白')
})

test('跑挂了的那次照样是心跳：红是另一个信道，别让天天红的巡检在看门狗这里判成没跑', () => {
  const runs = [{ event: 'schedule', status: 'completed', conclusion: 'failure', created_at: '2026-10-11T21:02:00Z' }]
  const verdict = heartbeatVerdict(runs, new Date('2026-10-12T01:30:00Z'))
  assert.ok(verdict.ok, '调度器确实触发了；harness 坏没坏该由那次运行自己红')
})

test('一条记录都没有 = 报警；due 取的是上一档不是本档', () => {
  const verdict = heartbeatVerdict([], new Date('2026-10-12T01:30:00Z'))
  assert.equal(verdict.ok, false)
  assert.equal(verdict.due.toISOString(), '2026-10-09T20:00:00.000Z', '北京周一 09:30 该判的是北京周六 04:00 那一档')
})

test('newest 不信 API 的返回顺序，取 schedule 里最晚的那条', () => {
  const unordered = [REAL_RUNS[1], REAL_RUNS[3], REAL_RUNS[0], REAL_RUNS[2]]
  assert.equal(heartbeatVerdict(unordered, new Date('2026-10-12T01:30:00Z')).newest.created_at,
    '2026-10-10T02:13:56Z', '取错"最近一次"会让告警正文里的年龄数字骗人')
})

test('isWatchdogAlarm 只认领看门狗自己开的单', () => {
  assert.ok(isWatchdogAlarm({ title: `${WATCHDOG_MARKER}：data-source-contract.yml 在上一档排程后没有 schedule 记录` }))
  assert.ok(!isWatchdogAlarm({ title: '数据源契约巡检 2026-10-08：2 项不合格（HTTP_STATUS）· 海外视角' }),
    '巡检日报单归 publish 脚本按能力逐条复核后再关，看门狗不许顺手收掉')
  assert.ok(!isWatchdogAlarm({ title: `${WATCHDOG_MARKER}（带 PR 引用）`, pull_request: {} }), 'PR 不是单')
  assert.ok(!isWatchdogAlarm({}), '没有标题的响应项不该被当成告警单去关')
})

test('脚本只消费 lib 里的判据，不自己再算一遍心跳（§9.7 一份实现）', () => {
  assert.match(watchdog, /heartbeatVerdict/, '看门狗脚本绕开 lib 自己判心跳 = 这份规则没有离线测试覆盖')
  assert.doesNotMatch(watchdog, /SLACK_HOURS|slackHours/,
    '"若干小时内跑过"这种准点窗口已经废了：一次手动 dispatch 就能把整周停摆遮过去')
  assert.doesNotMatch(watchdog, /lastScheduledDue/,
    '脚本里出现 lastScheduledDue = 又回到"判本档"的准点口径，那正是误报的源头；要判就通过 lib 用上一档')
  // 自愈：健康时关掉仍开着的自家告警（publish 明确拒绝关这种单，两边都以为对方收拾就永远挂着）。
  assert.match(watchdog, /state_reason: 'closed'|state: 'closed'/, '健康分支要有关单的动作，不是只打一行日志')
})
