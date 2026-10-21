import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChartArtifactRegistry } from '../lib/chart/artifact-ref.js'

const MAIN = { id: 'main-1', header: { cwd: '/workspace/proj' } }
const JUNIOR = { id: 'junior-1', header: { cwd: '/workspace/proj', parentSession: MAIN.id, origin: 'subagent' } }
const GRANDCHILD = { id: 'visual-1', header: { cwd: '/workspace/proj', parentSession: JUNIOR.id, origin: 'subagent' } }

function artifactInput(session = JUNIOR) {
  return {
    session,
    chart_id: 'ch_01',
    task_id: 'task-1',
    dataset_id: 'ds_01',
    source_label: '同花顺日线',
    captured_at: 1_700_000_000_000,
    kind: 'line',
    axis: 'time',
    title: '贵州茅台 日线',
    chart_url: '/capital-charts/ch_01.json',
    spec_path: 'capital-analysis/charts/ch_01/spec.json',
    series_path: 'capital-analysis/charts/ch_01/series.json',
    html_path: 'capital-analysis/charts/ch_01/chart.html',
  }
}

test('ChartArtifactRegistry：chart_ref 绑定 task 与 root session scope', () => {
  const registry = new ChartArtifactRegistry({
    now: () => 1_700_000_000_000,
    retentionMs: 1000,
    newRef: () => 'chart_ref_01',
  })
  const ref = registry.issue(artifactInput())

  assert.equal(ref.chart_ref, 'chart_ref_01')
  assert.equal(ref.task_id, 'task-1')
  assert.equal(ref.chart_url, '/capital-charts/ch_01.json')
  assert.equal(registry.resolve({ session: MAIN, chart_ref: ref.chart_ref, task_id: 'task-1' }).chart_id, 'ch_01')
  assert.throws(
    () => registry.resolve({ session: { id: MAIN.id, header: { cwd: '/workspace/other' } }, chart_ref: ref.chart_ref, task_id: 'task-1' }),
    (error) => error.code === 'chart_ref_scope_mismatch',
  )
  assert.throws(
    () => registry.resolve({ session: MAIN, chart_ref: ref.chart_ref, task_id: 'other-task' }),
    (error) => error.code === 'chart_ref_task_mismatch',
  )
  assert.throws(
    () => registry.resolve({ session: GRANDCHILD, chart_ref: ref.chart_ref, task_id: 'task-1' }),
    (error) => error.code === 'chart_ref_scope_mismatch',
  )
})

test('ChartArtifactRegistry：过期与非法 chart_ref 不泄漏内部记录', () => {
  let now = 1_700_000_000_000
  const registry = new ChartArtifactRegistry({
    now: () => now,
    retentionMs: 1000,
    newRef: () => 'chart_ref_02',
  })
  const ref = registry.issue(artifactInput())
  now += 1001

  assert.throws(
    () => registry.resolve({ session: MAIN, chart_ref: ref.chart_ref, task_id: 'task-1' }),
    (error) => error.code === 'chart_ref_invalid',
  )
  assert.throws(
    () => registry.resolve({ session: MAIN, chart_ref: 'not-a-chart-ref', task_id: 'task-1' }),
    (error) => error.code === 'chart_ref_invalid',
  )
  assert.equal(registry.size(), 0)
})

test('ChartArtifactRegistry.list：按 root scope / cwd / task 过滤，供最终交付步骤兜底', () => {
  let seq = 0
  const registry = new ChartArtifactRegistry({
    now: () => 1_700_000_000_000,
    newRef: () => `chart_list_${seq += 1}`,
  })
  const first = registry.issue({ ...artifactInput(), title: '任务一', created_at: 1_700_000_000_000 })
  const second = registry.issue({ ...artifactInput(), task_id: 'task-1', title: '任务一之二', created_at: 1_700_000_000_100 })
  registry.issue({ ...artifactInput(), task_id: 'task-2', title: '任务二', created_at: 1_700_000_000_200 })
  registry.issue({ ...artifactInput(), session: { id: MAIN.id, header: { cwd: '/workspace/other' } }, title: '别的工作区' })
  registry.issue({ ...artifactInput({ id: 'junior-other', header: { cwd: '/workspace/proj', parentSession: 'main-other', origin: 'subagent' } }), title: '别的会话' })

  const sameTask = registry.list({ session: MAIN, task_id: 'task-1' })
  assert.deepEqual(sameTask.map((ref) => ref.chart_ref), [first.chart_ref, second.chart_ref])
  assert.deepEqual(sameTask.map((ref) => ref.title), ['任务一', '任务一之二'])

  // No task filter = every chart of this session scope only (never another cwd / session).
  assert.equal(registry.list({ session: MAIN }).length, 3)
})

test('ChartArtifactRegistry：fork/branch 顶层会话的 parentSession 是 seed 谱系，不是委派', () => {
  const FORK_ROOT = { id: 'main-fork', header: { cwd: '/workspace/proj', parentSession: 'main-old', isSeeded: true } }
  const JUNIOR_FORK = { id: 'junior-fork', header: { cwd: '/workspace/proj', parentSession: FORK_ROOT.id, origin: 'subagent' } }
  const registry = new ChartArtifactRegistry({
    now: () => 1_700_000_000_000,
    newRef: () => 'chart_fork_1',
  })
  const ref = registry.issue(artifactInput(JUNIOR_FORK))

  // The branch is the user-facing root: it owns (and can present) charts its children rendered.
  assert.equal(registry.resolve({ session: FORK_ROOT, chart_ref: ref.chart_ref }).chart_id, 'ch_01')
  assert.deepEqual(registry.list({ session: FORK_ROOT, task_id: 'task-1' }).map((item) => item.chart_ref), [ref.chart_ref])
  // The old session it was forked from must not resolve it.
  assert.throws(
    () => registry.resolve({ session: { id: 'main-old', header: { cwd: '/workspace/proj' } }, chart_ref: ref.chart_ref }),
    (error) => error.code === 'chart_ref_scope_mismatch',
  )
  // Internal bookkeeping never rides along into model-visible receipts.
  assert.equal('owner_cwd' in ref, false, 'publicRecord 必须剥掉 owner_cwd')
})
