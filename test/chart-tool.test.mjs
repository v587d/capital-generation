import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkspaceDatasetStore } from '../lib/data-collector/store.js'
import { renderChart, registerChartTool } from '../lib/chart/tool.js'

/**
 * render_chart 的端到端契约（假 fs + 真 store，因此沙箱归属校验是真的在跑）。
 *
 * 这里钉住三条**不可回退**的性质：
 *  1. 回执里没有原始数据 —— 图表工具不污染上下文，这条一旦破了整个方案就失去意义；
 *  2. 产物是自包含的 —— 离线可开，不依赖 DSH 运行时，是上游破坏性更新时的降级底线；
 *  3. 主 Agent 能读到自己子 Agent 采到的 Dataset（session 作用域同源）。
 */

const WORKSPACE = '/workspace/proj'
const MAIN = { id: 'main-1', header: { cwd: WORKSPACE } }
const COLLECTOR = { id: 'child-1', header: { cwd: WORKSPACE, parentSession: 'main-1' } }
const exec = () => ({ agent: { session: MAIN }, signal: new AbortController().signal })
const execAs = (session) => ({ agent: { session }, signal: new AbortController().signal })

/** 与 test/data-collector-store.test.mjs 同源的极简 in-memory fake fs。 */
function fakeFs() {
  const files = new Map()
  const dirs = new Set()
  const norm = (path) => {
    const parts = []
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') parts.pop()
      else parts.push(part)
    }
    return '/' + parts.join('/')
  }
  return {
    files,
    dirs,
    async resolve(path, opts = {}) {
      const cwd = opts.cwd ?? '/'
      const absolute = path.startsWith('/') ? path : `${cwd.replace(/\/$/, '')}/${path}`
      const normalized = norm(absolute)
      return { targetKey: `key:${normalized}`, displayPath: normalized }
    },
    contains(parent, child) {
      return child.displayPath === parent.displayPath || child.displayPath.startsWith(`${parent.displayPath}/`)
    },
    async writeText(target, content, expected) {
      if (expected?.kind === 'createIfAbsent' && this.files.has(target.displayPath)) {
        const error = new Error('already exists')
        error.code = 'FS_NOT_OBSERVED'
        throw error
      }
      const segments = target.displayPath.split('/').filter(Boolean)
      for (let index = 1; index < segments.length; index += 1) this.dirs.add('/' + segments.slice(0, index).join('/'))
      this.files.set(target.displayPath, content)
      return { operation: 'create' }
    },
    async readText(target) {
      if (!this.files.has(target.displayPath)) {
        const error = new Error('missing')
        error.code = 'FS_NOT_FOUND'
        throw error
      }
      return this.files.get(target.displayPath)
    },
  }
}

const sandboxPolicy = { resolve: () => ({ mode: 'workspace-write', workspaceRoot: WORKSPACE }) }

function makeStore() {
  const fs = fakeFs()
  return { fs, store: new WorkspaceDatasetStore({ fs, sandboxPolicy }) }
}

/** 一个"像行情"的 Dataset：涨跌与成交量都取有辨识度的哨兵值，便于断言回执没泄漏。 */
const SENTINEL = 987654.321
function historyRows(count = 90) {
  return Array.from({ length: count }, (_value, index) => ({
    trade_date: new Date(Date.UTC(2025, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
    open: SENTINEL + index,
    high: SENTINEL + index + 1,
    low: SENTINEL + index - 1,
    close: SENTINEL + index + 0.5,
    volume: 1_000_000 + index,
  }))
}

async function saveDataset(store, rows) {
  return store.save({
    session: COLLECTOR,
    capability: 'history',
    params_digest: 'digest-1',
    source_label: '同花顺 日线',
    format: 'json_rows',
    schema: { rowShape: 'array' },
    row_count: rows.length,
    data: rows,
  })
}

test('render_chart：dataset 来源产出三件产物，回执不含任何原始数据', async () => {
  const { fs, store } = makeStore()
  const ref = await saveDataset(store, historyRows())
  const receipt = await renderChart({ store }, {
    dataset_id: ref.dataset_id,
    spec: { kind: 'candlestick', x: 'trade_date', ohlc: { open: 'open', high: 'high', low: 'low', close: 'close' }, volume: 'volume', title: '日线' },
  }, exec())

  assert.equal(receipt.kind, 'candlestick')
  assert.equal(receipt.axis, 'time')
  assert.equal(receipt.points, 90)
  assert.equal(receipt.has_volume, true)
  assert.equal(receipt.dataset_id, ref.dataset_id)
  assert.equal(receipt.source_label, '同花顺 日线')
  assert.equal(receipt.chart_url, null, '宿主平面路由属于 Step 2，当前应如实为 null')
  assert.equal(receipt.markers, 0)

  for (const name of ['spec.json', 'series.json', 'chart.html']) {
    const path = `${WORKSPACE}/capital-analysis/charts/${receipt.chart_id}/${name}`
    assert.ok(fs.files.has(path), `应写出产物 ${path}`)
  }
  assert.equal(receipt.html_path, `capital-analysis/charts/${receipt.chart_id}/chart.html`)

  // 最硬的一条不变量：回执里不能出现任何数据值，也不能出现计划外的字段。
  // 用"键集合恰好等于合同"来钉住，而不是靠关键词黑名单（`has_volume` 这种合法字段
  // 会误伤黑名单）。任何未来新增的字段都必须先改这条断言——也就是先想清楚它会不会带数据。
  const serialized = JSON.stringify(receipt)
  assert.equal(serialized.includes(String(SENTINEL)), false, '回执泄漏了数据点')
  assert.deepEqual(Object.keys(receipt).sort(), [
    'axis', 'captured_at', 'chart_id', 'chart_ref', 'chart_url', 'dataset_id', 'downsampled', 'has_volume',
    'html_path', 'kind', 'markers', 'original_points', 'points', 'series_labels', 'series_path',
    'source_label', 'spec_path', 'title', 'warnings',
  ])
})

test('render_chart：chart.html 自包含（内联库与数据，无外部请求）', async () => {
  const { fs, store } = makeStore()
  const ref = await saveDataset(store, historyRows())
  const receipt = await renderChart({ store }, {
    dataset_id: ref.dataset_id,
    spec: { kind: 'line', x: 'trade_date', series: [{ field: 'close', label: '收盘' }] },
  }, exec())

  const html = fs.files.get(`${WORKSPACE}/${receipt.html_path}`)
  assert.ok(html.startsWith('<!doctype html>'))
  assert.match(html, /TradingView Lightweight Charts/, '必须内联 vendored 图表库')
  assert.match(html, /__capitalChart/)
  assert.equal(/<script[^>]+src=/.test(html), false, '不允许外部脚本')
  assert.equal(/(src|href)\s*=\s*["']https?:/i.test(html), false, '不允许外部资源引用')
  // 深色模式与主题变量随 HTML 自带，脱开 DSH 也能正常显示。
  assert.match(html, /prefers-color-scheme: dark/)
  // 数据确实内联了，而且是 JSON 转义过的（不会提前闭合脚本标签）。
  assert.match(html, /"chart_id":"ch_/)
})

test('render_chart：主 Agent 可读自己子 Agent 采到的 Dataset，且 index 轴可用', async () => {
  const { store } = makeStore()
  const ref = await saveDataset(store, [
    { sector: '白酒', revenue: 100 },
    { sector: '银行', revenue: 200 },
  ])
  const receipt = await renderChart({ store }, {
    dataset_id: ref.dataset_id,
    spec: { kind: 'column', x: 'sector', series: [{ field: 'revenue', label: '营收' }] },
  }, exec())

  assert.equal(receipt.axis, 'index', 'x 不是时间列时应自动降级为分类轴')
  assert.deepEqual(receipt.series_labels, ['营收'])
})

test('render_chart：workspace 相对路径来源（用户本地 JSON）', async () => {
  const { fs, store } = makeStore()
  fs.files.set(`${WORKSPACE}/my-data.json`, JSON.stringify({ code: 0, item: [{ d: '2025-01-01', v: 1 }, { d: '2025-01-02', v: 2 }] }))

  const receipt = await renderChart({ store }, {
    path: 'my-data.json',
    spec: { kind: 'area', x: 'd', series: ['v'], title: '本地数据' },
  }, exec())
  assert.equal(receipt.dataset_id, null)
  assert.equal(receipt.points, 2)
})

test('render_chart：来源与路径边界都被显式拒绝', async () => {
  const { fs, store } = makeStore()
  const ref = await saveDataset(store, historyRows(3))

  await assert.rejects(
    () => renderChart({ store }, { dataset_id: ref.dataset_id, path: 'x.json', spec: { kind: 'line', series: ['close'] } }, exec()),
    (error) => error.code === 'chart_source_invalid',
  )
  await assert.rejects(
    () => renderChart({ store }, { spec: { kind: 'line', series: ['close'] } }, exec()),
    (error) => error.code === 'chart_source_invalid',
  )
  // 目录穿越：形态校验直接拒绝，绝不落到沙箱那一层再说。
  await assert.rejects(
    () => renderChart({ store }, { path: '../outside.json', spec: { kind: 'line', series: ['close'] } }, exec()),
    (error) => error.code === 'workspace_path_invalid',
  )
  await assert.rejects(
    () => renderChart({ store }, { path: '/etc/passwd', spec: { kind: 'line', series: ['close'] } }, exec()),
    (error) => error.code === 'workspace_path_invalid',
  )
  await assert.rejects(
    () => renderChart({ store }, { path: 'missing.json', spec: { kind: 'line', series: ['close'] } }, exec()),
    (error) => error.code === 'dataset_not_found',
  )
  // Dataset 不可跨 session 作用域读取：另一个主会话读不到。
  await assert.rejects(
    () => renderChart({ store }, { dataset_id: ref.dataset_id, spec: { kind: 'line', series: ['close'] } }, execAs({ id: 'other-main', header: { cwd: WORKSPACE } })),
    (error) => error.code === 'dataset_session_mismatch',
  )
  await assert.rejects(
    () => renderChart({ store }, { path: 'my-data.json', spec: { kind: 'line', series: ['v'] } }, execAs(COLLECTOR)),
    (error) => error.code === 'chart_source_scope_mismatch',
    'delegated callers must not use path as a chart source',
  )
  assert.equal(fs.files.size > 0, true)
})

test('render_chart：字段名写错时错误文本带候选字段，可一次改对', async () => {
  const { store } = makeStore()
  const ref = await saveDataset(store, historyRows(5))
  await assert.rejects(
    () => renderChart({ store }, { dataset_id: ref.dataset_id, spec: { kind: 'line', x: 'trade_date', series: ['close_price'] } }, exec()),
    (error) => error.code === 'chart_field_not_found' && /available fields:/.test(error.message) && /close/.test(error.message),
  )
})

test('注册后的 render_chart：Dataset/文件错误转换成模型可读 JSON 信封', async () => {
  const { store } = makeStore()
  let definition
  registerChartTool({
    get: (name) => name === 'tools' ? { register: (value) => { definition = value; return () => {} } } : undefined,
    effect: (callback) => callback(),
  }, { store })

  await assert.rejects(
    () => definition.execute({ path: 'missing.json', spec: { kind: 'line', series: ['close'] } }, exec()),
    (error) => {
      const envelope = JSON.parse(error.message)
      return error.code === 'chart_source_not_found'
        && envelope.error === 'chart_source_not_found'
        && envelope.cause === 'dataset_not_found'
    },
  )
})

test('图表协议 skill 必须真实存在（工具 description 让模型去加载它）', () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const file = `${root}/preset/capital-generation/skills/capital-chart-protocol/SKILL.md`
  assert.ok(existsSync(file), '缺少 skills/capital-chart-protocol/SKILL.md：工具 description 指向的协议不存在，模型会去加载一个空名字')

  const text = readFileSync(file, 'utf8')
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)
  assert.ok(frontmatter, 'skill 必须有 YAML frontmatter')
  assert.match(frontmatter[1], /name:\s*capital-chart-protocol/)
  const description = /description:\s*(.+)/.exec(frontmatter[1])
  assert.ok(description && description[1].length > 40, 'skill 需要一句可路由的 description')
  assert.ok(text.length > 500, 'skill 正文过短，协议细节不应留在工具 description 里')
  // 协议里点名的错误码必须与实现一致，避免"文档写了但代码没有"。
  for (const code of ['chart_source_invalid', 'chart_field_not_found', 'chart_spec_invalid', 'chart_no_rows', 'chart_too_large']) {
    assert.match(text, new RegExp(code), `skill 应说明 ${code}`)
  }
  // kind 与数据形状的对应关系是模型最容易写错的地方，必须在协议里成表出现。
  for (const needle of ['column', 'candlestick', 'bar', 'OHLC']) {
    assert.match(text, new RegExp(needle), `skill 应说明 kind 与数据形状的对应（缺 ${needle}）`)
  }
})

test('render_chart：host 平面服务在场时登记序列并回 chart_url（仍不含任何数据）', async () => {
  const { store } = makeStore()
  const ref = await saveDataset(store, historyRows(10))
  const published = []
  const receipt = await renderChart({
    store,
    charts: () => ({
      publish: (input) => {
        published.push(input)
        return `/capital-charts/${input.chartId}.json`
      },
    }),
  }, { dataset_id: ref.dataset_id, spec: { kind: 'line', x: 'trade_date', series: ['close'] } }, exec())

  assert.equal(published.length, 1)
  assert.equal(published[0].chartId, receipt.chart_id)
  assert.equal(
    published[0].filePath,
    `${WORKSPACE}/capital-analysis/charts/${receipt.chart_id}/series.json`,
    '登记给路由的必须是已解析好的**绝对**路径（路由不做任何路径拼接）',
  )
  assert.equal(receipt.chart_url, `/capital-charts/${receipt.chart_id}.json`)
  assert.equal(JSON.stringify(receipt).includes(String(SENTINEL)), false, '登记旁路不得把数据带进回执')
})

test('render_chart：旁路登记失败不阻断出图，降级为只有文件路径并披露', async () => {
  const { fs, store } = makeStore()
  const ref = await saveDataset(store, historyRows(10))
  const receipt = await renderChart({
    store,
    charts: () => ({ publish: () => { throw new Error('route offline') } }),
  }, { dataset_id: ref.dataset_id, spec: { kind: 'line', x: 'trade_date', series: ['close'] } }, exec())

  assert.equal(receipt.chart_url, null)
  assert.ok(receipt.warnings.some((warning) => /序列旁路登记失败/.test(warning)))
  assert.ok(fs.files.has(`${WORKSPACE}/${receipt.html_path}`), '图已经落盘，不能因为登记失败就丢掉产物')
})

test('render_chart：旁路服务惰性解析，后到的 host 服务在下一次调用即生效', async () => {
  const { store } = makeStore()
  const ref = await saveDataset(store, historyRows(10))
  let service
  const input = { store, charts: () => service }
  const before = await renderChart(input, { dataset_id: ref.dataset_id, spec: { kind: 'line', x: 'trade_date', series: ['close'] } }, exec())
  assert.equal(before.chart_url, null, '服务缺席时降级为只有文件路径')
  service = { publish: (value) => `/capital-charts/${value.chartId}.json` }
  const after = await renderChart(input, { dataset_id: ref.dataset_id, spec: { kind: 'line', x: 'trade_date', series: ['close'] } }, exec())
  assert.equal(after.chart_url, `/capital-charts/${after.chart_id}.json`, '服务后到时不应被一次性解析固化为 null')
})
