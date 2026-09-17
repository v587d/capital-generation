import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChartArtifactRegistry } from '../lib/chart/artifact-ref.js'

const MAIN = { id: 'main-1', header: { cwd: '/workspace/proj' } }
const JUNIOR = { id: 'junior-1', header: { cwd: '/workspace/proj', parentSession: MAIN.id } }
const GRANDCHILD = { id: 'visual-1', header: { cwd: '/workspace/proj', parentSession: JUNIOR.id } }

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
