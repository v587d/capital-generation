/**
 * Watchdog heartbeat verdicts. On the old 07:00 Beijing slot, probes landed at 10:48 and 10:13
 * while the watchdog judged at 09:30, so "this slot has not run yet" would have false-alarmed
 * daily; it only stayed quiet because the watchdog itself was late. Judging the previous slot
 * turns the margin into a full day, since schedule lateness has no bound. Fully offline.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { lastScheduledDue, previousScheduledDue } from '../scripts/lib/contract-registry.mjs'
import { WATCHDOG_MARKER, heartbeatVerdict, isWatchdogAlarm } from '../scripts/lib/contract-report.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// A TS-only syntax error in a `.mjs` once escaped every import until CI ran the script.
const watchdog = readFileSync(join(ROOT, 'scripts/contract-watchdog.mjs'), 'utf8')

/** Two real schedule records (run #3 / #4) plus that day's two workflow_dispatch runs. */
const REAL_RUNS = [
  { event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-10-10T02:13:56Z' },
  { event: 'schedule', status: 'completed', conclusion: 'success', created_at: '2026-10-09T02:48:52Z' },
  { event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: '2026-10-09T00:07:31Z' },
  { event: 'workflow_dispatch', status: 'completed', conclusion: 'failure', created_at: '2026-10-08T07:22:26Z' },
]

/** Only records that already existed at that instant; including later ones would hide false alarms. */
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
    const now = new Date(Date.UTC(2026, 9, 4 + d, 1, 30))   // Nominal watchdog instant, every weekday.
    const due = previousScheduledDue(now)
    const ageHours = (now - due) / 3_600_000
    assert.ok(ageHours >= 24, `UTC 星期 ${d}：due ${due.toISOString()} 距 ${now.toISOString()} 只有 ${ageHours.toFixed(1)}h，`
      + '探针按实测迟到 3~4 小时就会被误判——判据必须落在"上一档"')
  }
})

test('本档口径只剩 5.5 小时余量，同一刻它会误报而上一档不会', () => {
  const now = new Date('2026-10-12T01:30:00Z')       // Nominal watchdog instant = Beijing Monday 09:30.
  const slot = lastScheduledDue(now)               // This slot = Beijing Monday 04:00 (UTC Sunday 20:00).
  const prev = previousScheduledDue(now)           // Previous slot = Beijing Saturday 04:00.
  assert.equal(slot.toISOString(), '2026-10-11T20:00:00.000Z')
  assert.equal(prev.toISOString(), '2026-10-09T20:00:00.000Z')
  // Observed lateness already consumed 3.2-3.8h; that margin cannot absorb a busy top of hour, and schedule lateness has no bound.
  assert.equal((now - slot) / 3_600_000, 5.5, '本档口径的余量 = 探针允许迟到的上限，改排程小时要连这条一起想清楚')
  assert.ok((now - prev) / 3_600_000 >= 24, '上一档口径：要迟满一整天才算没跑')
  const runs = visibleAt(now)
  assert.equal(runs.some((run) => run.event === 'schedule' && new Date(run.created_at) >= slot), false,
    '本档口径在这一刻判"没跑"——周一那次可能只是还在路上，这就是过去误报的形状')
  assert.ok(heartbeatVerdict(runs, now).ok, '上一档口径：认北京周六那个迟到 6h13m 的 02:13 记录算心跳')
  // Counter-case: the scheduler really died -- at Beijing Wednesday 09:30 the newest visible record is still Saturday's.
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
  // Self-heal: close still-open own alarms when healthy (publish refuses to close them, so each side would assume the other did).
  assert.match(watchdog, /state_reason: 'closed'|state: 'closed'/, '健康分支要有关单的动作，不是只打一行日志')
})
