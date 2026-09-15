#!/usr/bin/env node
/**
 * 离线图表 demo：不进 DSH、不依赖会话，直接跑通"数据 → 载荷 → 自包含 HTML"这条链路。
 *
 * 用途：
 *  - **肉眼验收**：`npm run demo:chart` 之后用浏览器打开输出的 HTML，确认配色、副图、
 *    标记点、明暗主题都符合预期（这一步在开发 Step 3 的对话流内嵌视图时同样要用）；
 *  - 在没有 dsh 会话的机器上复现渲染问题。
 *
 * 注意：这里**不**经过 WorkspaceDatasetStore（那是宿主侧、受沙箱约束的落盘路径）。
 * demo 只验证渲染链路，落盘用普通 fs 写到指定目录。
 *
 * 用法：node scripts/chart-demo.mjs [输出目录]   默认 ./capital-analysis/charts/demo
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildStandaloneHtml, loadVendoredChartLibrary } from '../lib/chart/html.js'
import { buildChartPayload } from '../lib/chart/series.js'
import { normalizeChartSpec } from '../lib/chart/spec.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = resolve(process.argv[2] ?? join(ROOT, 'capital-analysis', 'charts', 'demo'))

/** 合成一段"像行情"的日线：几何随机游走 + 周期，只为把图形铺开看，不代表任何真实标的。 */
function syntheticHistory(days = 260) {
  const rows = []
  let close = 100
  for (let index = 0; index < days; index += 1) {
    const time = Date.UTC(2024, 0, 2) + index * 86_400_000
    const drift = Math.sin(index / 21) * 1.6 + Math.sin(index / 5) * 0.5
    const open = close
    close = Math.max(5, close + drift)
    rows.push({
      trade_date: new Date(time).toISOString().slice(0, 10),
      open: Number(open.toFixed(2)),
      high: Number((Math.max(open, close) + 0.8).toFixed(2)),
      low: Number((Math.min(open, close) - 0.8).toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.round(1_200_000 + Math.abs(drift) * 900_000 + (index % 11) * 30_000),
    })
  }
  return rows
}

const charts = [
  {
    file: 'candlestick.html',
    rows: syntheticHistory(),
    spec: {
      kind: 'candlestick',
      x: 'trade_date',
      ohlc: { open: 'open', high: 'high', low: 'low', close: 'close' },
      volume: 'volume',
      markers: [
        { time: '2024-04-26', text: '发布年报', position: 'aboveBar' },
        { time: '2024-11-15', text: '分红除权', position: 'belowBar' },
      ],
      title: '日线 · 成交量（合成数据，仅用于检查渲染）',
    },
  },
  {
    file: 'lines.html',
    rows: Array.from({ length: 12 }, (_value, index) => ({
      period: `2024-${String(index + 1).padStart(2, '0')}`,
      revenue: 40 + Math.sin(index / 2) * 8 + index,
      profit: 6 + Math.sin(index / 3) * 3 + index * 0.4,
    })),
    spec: {
      kind: 'line',
      x: 'period',
      series: [
        { field: 'revenue', label: '营业收入', type: 'line' },
        { field: 'profit', label: '净利润', type: 'area' },
      ],
      title: '多序列 · 分类轴（合成数据）',
    },
  },
]

const library = loadVendoredChartLibrary()
mkdirSync(outDir, { recursive: true })
for (const chart of charts) {
  const payload = buildChartPayload({
    chart_id: `demo_${chart.file.replace(/\.html$/, '')}`,
    spec: normalizeChartSpec(chart.spec),
    rows: chart.rows,
    meta: { source_kind: 'path', source_label: '合成数据（scripts/chart-demo.mjs）' },
  })
  const html = buildStandaloneHtml({ payload, library, generatedAt: Date.now() })
  const target = join(outDir, chart.file)
  writeFileSync(target, html)
  console.log(`chart-demo: ${target}  (${payload.meta.points} 点, kind=${payload.kind}, axis=${payload.axis})`)
}
console.log(`\n用浏览器打开上面的文件即可查看。图表库 v${library.version}（${library.license}）。`)
