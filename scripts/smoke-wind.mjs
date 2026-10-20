/**
 * Real Wind data-source check: runs the registered DataSource (transpose, units, epoch, guards)
 * so guards are verified against real payloads. spike-wind.mjs is the bare-protocol counterpart.
 * ⛔ Each call burns upstream credits: serial, one at a time; logs shapes and row counts only.
 */
import { parseArgs } from 'node:util'
import { createWindSources } from '../lib/sources/wind-mcp.js'
import { resolveCredential } from './lib/credentials.mjs'

const { values: flags } = parseArgs({
  options: {
    kline: { type: 'string' },
    minute: { type: 'string' },
    date: { type: 'string' },
    indicator: { type: 'string' },
    question: { type: 'string' },
  },
})

const apiKey = resolveCredential('WIND_API_KEY')
if (!apiKey) {
  console.error('WIND_API_KEY 未解析到（环境变量或 ~/.dsh/.credentials.yaml 的 refs）')
  process.exit(1)
}

const byCapability = new Map(createWindSources(async () => apiKey).map((source) => [source.schema.capability, source]))
const today = flags.date ?? new Date().toISOString().slice(0, 10)

/** Smoke plan: one call at a time; a specific flag narrows it down to one row. */
const probes = [
  flags.minute && {
    capability: 'wind_stock_kline',
    params: { code: flags.minute, start_date: today, end_date: today, period: 'm1' },
    note: `分钟档 ${flags.minute} @ ${today}：缺数与故障都表现为挂到 12 秒超时（§6.6）`,
  },
  !flags.minute && flags.kline && {
    capability: 'wind_stock_kline',
    params: { code: flags.kline, start_date: '2026-08-01', end_date: '2026-08-15', period: 'day' },
    note: '日 K：转置 + 单位原文 + 逐行偏移换 epoch',
  },
  flags.indicator && {
    capability: 'wind_edb_query',
    params: { indicator: flags.indicator, start_date: '2025-01-01', end_date: today },
    note: 'EDB 并行数组转置：date[] 与 value[] 必须等长',
  },
  flags.question && {
    capability: 'wind_edb_search',
    params: { question: flags.question },
    note: 'NL 检索：键集随指标族变化（实测汇率族没有 unit/currency）',
  },
]
const plan = probes.filter(Boolean).length > 0 ? probes.filter(Boolean) : [
  { capability: 'wind_edb_search', params: { question: '中国GDP相关指标' }, note: 'EDB 目录检索：只找码不取数' },
  { capability: 'wind_edb_query', params: { indicator: 'M0000612', start_date: '2025-01-01', end_date: today }, note: 'EDB 取数：中国 CPI 当月同比' },
  { capability: 'wind_stock_kline', params: { code: '600519.SH', start_date: '2026-08-01', end_date: '2026-08-15', period: 'day' }, note: '日 K：qfq + afdate 锁当日' },
]

function preview(row) {
  const entries = Object.entries(row)
  return entries.slice(0, 8).map(([key, value]) => `${key}=${typeof value === 'string' && value.length > 24 ? `${value.slice(0, 24)}…` : JSON.stringify(value)}`).join(' ')
}

let failures = 0
for (const item of plan) {
  const source = byCapability.get(item.capability)
  const started = Date.now()
  process.stdout.write(`${item.capability}  ${JSON.stringify(item.params)}\n  ${item.note}\n`)
  try {
    const { data } = await source.execute({ capability: item.capability, params: item.params, session: { id: 'smoke-wind', header: { cwd: process.cwd() } } }, AbortSignal.timeout(30_000))
    const rows = data
    if (!Array.isArray(rows)) throw new Error('数据源没有返回行数组')
    // 0 rows is a legal success (non-trading days return empty); say so instead of "got data".
    console.log(`  ✅ ${Date.now() - started}ms  ${rows.length === 0 ? '0 行（合法空结果：该区间没有行情/没有匹配）' : `${rows.length} 行`}`)
    if (rows.length > 0) console.log(`  首行 ${preview(rows[0])}\n  末行 ${preview(rows[rows.length - 1])}`)
  } catch (error) {
    failures += 1
    console.log(`  ❌ ${Date.now() - started}ms  code=${error.code ?? '(无)'} ${String(error.message).slice(0, 300)}`)
  }
}
console.log(`\n复核结束：${plan.length} 条，失败 ${failures} 条。积分按次消耗，重复运行前想清楚要验的那一条。`)
process.exit(failures > 0 && plan.length === failures ? 1 : 0)
