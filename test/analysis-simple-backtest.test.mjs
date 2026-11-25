import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analysisModuleById, listAnalysisModules } from '../lib/analysis/registry.js'
import { resetAnalysisRuntimeState, runModuleOnSnapshot } from '../lib/analysis/runtime.js'
import { AnalysisError } from '../lib/analysis/types.js'
import {
  expectedOf, moduleRunDir, readJson, runCase, runtimeFrom, runtimeReady, setupCase,
} from './analysis-fixture-harness.mjs'

/**
 * `simple_backtest` is the "one price series + one caller-chosen rule" shape: a signal computed at
 * bar t's close is executed at bar t+1's close, so no future close ever enters the equity curve.
 * Goldens are hand-computed from `fixtures/` inputs (see fixtures/README.md), never recorded from
 * module output; every fixture number is reproducible from the formulas documented there.
 */
const FIXTURES = fileURLToPath(new URL('../python/analysis/modules/simple_backtest/fixtures/', import.meta.url))
const MODULE = 'simple_backtest'
const caseDir = (name) => join(FIXTURES, name)
const SESSION = { id: 'session-analysis-simple-backtest', header: { cwd: '/workspace' } }

function runDirect(workspace, params) {
  return runModuleOnSnapshot({
    writer: workspace.store,
    runtime: runtimeFrom(),
    session: SESSION,
    snapshot: workspace.record,
    module: analysisModuleById(MODULE),
    params,
  })
}

async function caseParams(name) {
  return readJson(join(caseDir(name), 'params.json'))
}

function rejectsWith(expected, pattern) {
  return (error) => error instanceof AnalysisError
    && error.code === expected.code
    && expected.message_contains.every((fragment) => error.message.includes(fragment))
    && (pattern === undefined || pattern.test(error.message))
}

async function assertNoOutputs(root, record) {
  const modulesDir = join(root, record.paths.dir, 'modules')
  if (!existsSync(modulesDir)) return
  for (const runId of await readdir(modulesDir)) {
    assert.equal(existsSync(join(modulesDir, runId, 'outputs')), false, '输入错误不写 outputs：没有可复算的净值曲线')
  }
}

test('simple_backtest 登记在静态 registry，manifest 声明回测口径与来源', async () => {
  const ids = listAnalysisModules().map((entry) => entry.manifest.id)
  assert.ok(ids.includes(MODULE), 'simple_backtest 必须在静态 registry 的 id 白名单里（不扫目录）')
  assert.equal(analysisModuleById(MODULE)?.manifest.id, MODULE)

  const entry = analysisModuleById(MODULE)
  assert.equal(entry.manifest.version, '1.0.0')
  assert.deepEqual([...entry.manifest.roles], ['senior_analyst'])
  assert.deepEqual([...entry.manifest.capabilities], ['dataset.read'], '只读 Dataset；不声明未使用的能力')
  assert.equal(entry.manifest.input_schema.additionalProperties, false, '参数未知字段必须被拒')
  assert.deepEqual(entry.manifest.input_schema.properties.rule.enum, ['sma_cross', 'price_above_sma'])
  assert.equal(entry.manifest.input_schema.properties.fast_window.minimum, 2)
  assert.equal(entry.manifest.input_schema.properties.slow_window.minimum, 2)
  assert.equal(entry.manifest.input_schema.required.includes('slow_window'), false,
    'slow_window 只对 sma_cross 必填，由模块按 rule 校验（schema 无法表达跨字段依赖）')
  assert.ok(entry.manifest.assumptions.length >= 5, 'manifest 必须显式列出假设')
  assert.ok(entry.manifest.assumptions.some((line) => line.includes('未扣手续费')), '默认无手续费必须原文披露')
  assert.ok(entry.manifest.applicability.length >= 3, 'manifest 必须写明适用条件')
  assert.equal(entry.manifest.provenance.source_type, 'original')
  assert.equal(entry.manifest.provenance.license, 'MIT')

  const license = await readFile(join(FIXTURES, '..', 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/u)
  assert.match(license, /v587d/u)
})

test('normal_sma_cross：交叉信号 t+1 收盘成交、双边手续费，golden 与审计文件逐项对上', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('normal_sma_cross'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('normal_sma_cross'), moduleId: MODULE })

  assert.equal(outcome.status, expected.status)
  assert.deepEqual(outcome.metrics, expected.metrics, '指标必须与手算 golden 完全一致（含 6 位小数舍入）')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps, 'completed 不应有缺口')
  assert.match(outcome.summary, /区间收益 -5\.07%/u)
  assert.match(outcome.summary, /买入持有 6\.00%/u)
  assert.match(outcome.summary, /最大回撤 -5\.07%/u)
  assert.match(outcome.summary, /期末净值 0\.949329/u)
  assert.match(outcome.summary, /完整往返 1 笔、胜率 0\.00%、未平仓 1 笔/u)
  assert.match(outcome.summary, /持有占比 40\.00%（4\/10 根）/u)
  assert.match(outcome.summary, /单边手续费 0\.10%/u)
  assert.match(outcome.summary, /样本内回测、参数由调用方给定、未做参数寻优；不预测、不构成策略推荐/u)
  assert.doesNotMatch(outcome.summary, /未扣手续费/u, 'fee_rate=0.001 时不能声称未扣手续费')
  assert.deepEqual([...outcome.assumptions], [...analysisModuleById(MODULE).manifest.assumptions],
    '结果里的假设必须与 manifest 承诺的逐字一致，否则 describe 与 run 会互相矛盾')

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'simple_backtest.json'))
  assert.equal(payload.price_dataset_id, 'ds_price')
  assert.equal(payload.time_column, 'date')
  assert.equal(payload.price_column, 'close')
  assert.equal(payload.rule, 'sma_cross')
  assert.deepEqual(payload.parameters, {
    rule: 'sma_cross', fast_window: 2, slow_window: 3, initial_capital: 1, fee_rate: 0.001, timezone: 'UTC',
  })
  assert.deepEqual(payload.window, { start: '2024-01-02', end: '2024-01-15', observations: 10, skipped_rows: 0 })
  assert.deepEqual(payload.statistics, expected.metrics, '审计文件的统计必须与结果 metrics 同源')
  assert.deepEqual(payload.trades, expected.trades, '交易记录的日期、价格、净收益与 bars 必须与手算一致')
  assert.deepEqual(payload.series.map((row) => row.position), expected.position)
  assert.deepEqual(payload.series.map((row) => row.equity), expected.equity, '逐日净值必须与手算一致')
  assert.equal(payload.series[2].signal, 1, '第 3 根收盘用 SMA2 103 > SMA3 102 算出做多信号')
  assert.equal(payload.series[2].position, 0, '出信号当根不成交')
  assert.equal(payload.series[3].position, 1, '下一根（01-05）收盘才买入')
  assert.ok(Math.abs(payload.series[3].equity - 0.999) < 1e-12, '买入当根只扣 0.1% 手续费，不吃当天涨跌')
  assert.equal(payload.series[0].sma_fast, null, '窗口未满时均线是 null，不填默认值')
  assert.equal(payload.series[2].sma_slow, 102)
  assert.deepEqual(payload.data_gaps, [])

  const stored = await readJson(join(dir, 'result.json'))
  assert.deepEqual(stored.result.outputs, [{ name: 'simple_backtest', ref: 'output:simple_backtest' }])
})

test('price_above_sma：单均线规则，default 参数原样披露「未扣手续费」', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('price_above_sma'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('price_above_sma'), moduleId: MODULE })

  assert.equal(outcome.status, 'completed')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /区间收益 -2\.91%/u)
  assert.match(outcome.summary, /买入持有 0\.00%/u)
  assert.match(outcome.summary, /最大回撤 -2\.91%/u)
  assert.match(outcome.summary, /持有占比 28\.57%（2\/7 根）/u)
  assert.match(outcome.summary, /单边手续费 0（未扣手续费）/u)
  assert.match(outcome.summary, /完整往返 1 笔、胜率 0\.00%/u)
  assert.doesNotMatch(outcome.summary, /未平仓/u, '这笔交易在期末前已平仓')
  assert.ok(outcome.limitations.some((line) => line.includes('未扣手续费')), '默认资金成本必须在限制里披露')

  const { dir } = await moduleRunDir(root, record)
  const stored = await readJson(join(dir, 'result.json'))
  assert.ok(stored.result.methodology_log.some((line) => line.includes('第 t+1 根收盘成交')),
    '方法日志必须写明成交时点，否则净值无法复算')
  const payload = await readJson(join(dir, 'outputs', 'simple_backtest.json'))
  assert.deepEqual(payload.parameters, {
    rule: 'price_above_sma', fast_window: 2, slow_window: null, initial_capital: 1, fee_rate: 0, timezone: 'UTC',
  })
  assert.deepEqual(payload.trades, expected.trades)
  assert.equal(payload.trades[0].net_return, -0.029126, 'fee_rate=0 时净收益等于价格收益')
  assert.deepEqual(payload.series.map((row) => row.position), expected.position)
  assert.deepEqual(payload.series.map((row) => row.equity), expected.equity)
  assert.equal('sma_slow' in payload.series[0], false, 'price_above_sma 只输出一条均线')
})

test('no_trades：单调上涨 + price_above_sma 只有一笔未平仓交易 → trade_count 0、win_rate 缺省 + 缺口', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('no_trades'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('no_trades'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.equal('win_rate' in outcome.metrics, false, '没有平仓交易时胜率必须缺省，不写 0')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /完整往返 0 笔（没有平仓交易，胜率无定义）/u)
  assert.match(outcome.summary, /未平仓 1 笔/u)
  assert.match(outcome.summary, /有 1 项缺口，见 data_gaps/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'simple_backtest.json'))
  assert.deepEqual(payload.trades, expected.trades)
  assert.equal(payload.trades[0].open, true)
  assert.equal('exit_date' in payload.trades[0], false, '未平仓交易没有卖出日期')
  assert.equal('net_return' in payload.trades[0], false, '未平仓交易不写假的已实现净收益')
  assert.deepEqual(payload.series.map((row) => row.position), expected.position)
  assert.deepEqual(payload.series.map((row) => row.equity), expected.equity)
})

test('flat：恒定价格从不触发，净值与买入持有都是 0、回撤 0、没有交易', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('flat'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('flat'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial', 'win_rate 缺省是缺口，状态降为 partial')
  assert.deepEqual(outcome.metrics, expected.metrics)
  assert.equal(outcome.metrics.total_return, 0)
  assert.equal(outcome.metrics.max_drawdown, 0)
  assert.equal(outcome.metrics.exposure_ratio, 0)
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /区间收益 0\.00%/u)
  assert.match(outcome.summary, /最大回撤 0\.00%/u)
  assert.match(outcome.summary, /持有占比 0\.00%（0\/5 根）/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'simple_backtest.json'))
  assert.deepEqual(payload.trades, [])
  assert.deepEqual(payload.series.map((row) => row.position), expected.position)
  assert.deepEqual(payload.series.map((row) => row.equity), expected.equity)
  assert.equal(payload.series[0].signal, null, '第一根窗口未满：没有信号')
  assert.ok(payload.series.slice(1).every((row) => row.signal === 0), 'close 严格高于均线才做多：恒定价永不触发')
})

test('bad_rows：坏行跳过并点名，剩余观测重新计算 → partial', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('bad_rows'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('bad_rows'), moduleId: MODULE })

  assert.equal(outcome.status, 'partial')
  assert.deepEqual(outcome.metrics, expected.metrics, '跳过坏行后只算剩下的 6 个有效观测')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /有效观测 6 个，跳过 2 行/u)
  assert.match(outcome.summary, /区间收益 -2\.91%/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'simple_backtest.json'))
  assert.deepEqual(payload.window, { start: '2024-06-03', end: '2024-06-13', observations: 6, skipped_rows: 2 })
  assert.deepEqual(payload.series.map((row) => row.date),
    ['2024-06-03', '2024-06-04', '2024-06-06', '2024-06-07', '2024-06-12', '2024-06-13'],
    '跳过坏行后按剩余观测重排 bar 序号')
  assert.deepEqual(payload.trades, expected.trades)
})

test('insufficient：有效观测 < max 窗口 + 2 → blocked，不写 outputs', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('insufficient'))
  const { root, record, outcome } = await runCase({ caseDir: caseDir('insufficient'), moduleId: MODULE })

  assert.equal(outcome.status, 'blocked')
  assert.deepEqual(outcome.metrics, expected.metrics, 'blocked 不给任何指标')
  assert.deepEqual([...outcome.data_gaps], expected.data_gaps)
  assert.match(outcome.summary, /样本不足，未回测/u)
  assert.match(outcome.summary, /需要 max 窗口 \+ 2 = 7 个有效观测/u)
  const { dir } = await moduleRunDir(root, record)
  assert.equal(existsSync(join(dir, 'outputs')), false, 'blocked 结果不写 outputs：没有东西可复算')
})

test('invalid_rule：rule 不在 enum 时在启动 Python 之前被宿主参数校验拒绝', async () => {
  const expected = await expectedOf(caseDir('invalid_rule'))
  const workspace = await setupCase({ caseDir: caseDir('invalid_rule'), moduleId: MODULE })
  const params = await caseParams('invalid_rule')
  await assert.rejects(
    () => runDirect(workspace, params),
    rejectsWith(expected.error, /params\.rule/u),
    'enum 校验由宿主 input_schema 完成，不应等到模块内才失败',
  )
  assert.equal(existsSync(join(workspace.root, workspace.record.paths.dir, 'modules')), false,
    '参数校验失败不创建 module run')
})

test('参数契约：未声明字段在启动 Python 前被拒，sma_cross 的 slow_window 约束在模块入口校验', async (t) => {
  const workspace = await setupCase({ caseDir: caseDir('normal_sma_cross'), moduleId: MODULE })
  const baseParams = await caseParams('normal_sma_cross')
  await assert.rejects(
    () => runDirect(workspace, { ...baseParams, debug: true }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /未声明的字段/u.test(error.message),
    'additionalProperties=false：未知参数不能被静默忽略',
  )

  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  await assert.rejects(
    () => runDirect(workspace, { rule: 'sma_cross', fast_window: 2 }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /sma_cross 需要 slow_window/u.test(error.message),
    'sma_cross 缺 slow_window 必须在计算前拒绝',
  )
  await assert.rejects(
    () => runDirect(workspace, { rule: 'sma_cross', fast_window: 2, slow_window: 2 }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /slow_window=2 必须大于 fast_window=2/u.test(error.message),
    'slow_window 必须严格大于 fast_window',
  )
  await assert.rejects(
    () => runDirect(workspace, {
      rule: 'sma_cross', fast_window: 2, slow_window: 3, price_dataset_id: 'ds_price', price_column: 'vwap',
    }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /price_column=vwap 不在 Dataset 的列里/u.test(error.message)
      && /close/u.test(error.message),
    '指名了不存在的价格列时要点名，而不是静默换一列',
  )
})

test('missing_columns：没有价格列时模块内 analysis_input_invalid，并列出现有列', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('missing_columns'))
  const params = await caseParams('missing_columns')
  const workspace = await setupCase({ caseDir: caseDir('missing_columns'), moduleId: MODULE })

  await assert.rejects(
    () => runDirect(workspace, params),
    rejectsWith(expected.error, /没有可识别的价格序列 Dataset/u),
    '自动识别失败时必须列出可用价格列名',
  )
  await assert.rejects(
    () => runDirect(workspace, { ...params, price_dataset_id: 'ds_prices' }),
    (error) => error instanceof AnalysisError
      && error.code === 'analysis_input_invalid'
      && /找不到价格列/u.test(error.message)
      && /volume/u.test(error.message),
    '显式指名 Dataset 时要点名缺价格列并给出可选列',
  )
  await assertNoOutputs(workspace.root, workspace.record)
})

test('initial_capital 只缩放净值规模，不改变收益率', async (t) => {
  if (!(await runtimeReady())) return t.skip('私有 Python runtime 未准备')
  resetAnalysisRuntimeState()
  const expected = await expectedOf(caseDir('price_above_sma'))
  const params = { ...(await caseParams('price_above_sma')), initial_capital: 1000 }
  const { root, record, outcome } = await runCase({ caseDir: caseDir('price_above_sma'), moduleId: MODULE, params })

  assert.equal(outcome.status, 'completed')
  assert.equal(outcome.metrics.total_return, expected.metrics.total_return, 'initial_capital 不改变收益率')
  assert.equal(outcome.metrics.final_equity, 970.873786, '1000 × 100/103 = 970.873786')
  assert.match(outcome.summary, /期末净值 970\.873786/u)

  const { dir } = await moduleRunDir(root, record)
  const payload = await readJson(join(dir, 'outputs', 'simple_backtest.json'))
  assert.equal(payload.parameters.initial_capital, 1000)
  assert.equal(payload.series.at(-1).equity, 970.873786)
})
