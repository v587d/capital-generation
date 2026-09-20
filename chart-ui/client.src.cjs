/**
 * `@v587d/capital-charts` browser half.
 *
 * 单一 surface：`tool.call.toolview['render_chart']` —— 图表生成过程的明细卡片
 * （子会话与展开视图里都能看）。数据经 `/capital-charts/<chart_id>.json` 旁路取，
 * 不进任何 Agent 上下文。
 *
 * ⚠️ 这里**没有** turn-tail 卡片，且不要再加回来（2026-09-18 事故，实测根因）：
 * 内嵌卡片依赖宿主往会话里追加自定义事件 `capital/chart-rendered`，而会话日志的事件
 * 词汇表是闭集——`Session.append` 无法设置 `ignorable`，非 first-party 事件写进去之后，
 * **整份会话在冷加载时会被 fail-closed 拒绝**（6 份会话 `failed to observe session`）。
 * 现在图表以官方 `deliverables/presented` 登记为「本轮交付」，用户在收尾的交付行点开
 * `chart.html`，由官方 document preview 的 script-enabled iframe 渲染自包含图表
 * （见 src/chart/events.ts）。**呈现走官方通道，客户端不再需要任何图表专属投影。**
 */
const { useEffect, useRef, useState, createElement: h } = require('react')
const LightweightCharts = require('lightweight-charts')
const { __capitalChart } = require('./client.runtime.gen.cjs')

const TOOLVIEW_SLOT = 'tool.call.toolview'

function readReceipt(block) {
  if (!block || block.kind !== 'tool-result') return undefined
  const items = Array.isArray(block.content) ? block.content : []
  for (const item of items) {
    if (item && item.type === 'text' && typeof item.text === 'string') {
      try {
        const parsed = JSON.parse(item.text)
        if (parsed && typeof parsed === 'object') return parsed
      } catch {
        // Not the structured receipt; continue scanning.
      }
    }
  }
  return undefined
}

function ChartCanvas(props) {
  const holder = useRef(null)
  useEffect(() => {
    const node = holder.current
    if (!node || !props.payload) return undefined
    let chart
    try {
      chart = __capitalChart.render(node, props.payload, LightweightCharts)
    } catch (error) {
      node.textContent = '图表渲染失败：' + String((error && error.message) || error)
    }
    return () => {
      try {
        if (chart && typeof chart.remove === 'function') chart.remove()
      } catch {
        // The host removed the card.
      }
    }
  }, [props.payload])
  return h('div', { ref: holder, 'data-chart-canvas': '1', style: { width: '100%', height: '320px' } })
}

function useJson(url) {
  const [value, setValue] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    setValue(null)
    setError(null)
    if (!url) return undefined
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    let active = true
    fetch(url, controller ? { cache: 'no-store', signal: controller.signal } : { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
      .then((next) => {
        if (active) setValue(next)
      })
      .catch((reason) => {
        if (active) setError(String((reason && reason.message) || reason))
      })
    return () => {
      active = false
      if (controller) controller.abort()
    }
  }, [url])
  return { value, error }
}

/** 工具过程明细：保留在子会话与展开视图里。 */
function ChartView(props) {
  const block = props.block
  const settled = Boolean(block) && block.kind === 'tool-result'
  const failed = settled && block.isError
  const receipt = settled ? readReceipt(block) : undefined
  const url = receipt && typeof receipt.chart_url === 'string' ? receipt.chart_url : null
  const { value: payload, error: loadError } = useJson(url)

  if (!settled) return h('div', { className: 'capital-chart', 'data-state': 'running' }, '正在生成图表…')
  if (failed || !receipt) return h('div', { className: 'capital-chart', 'data-state': 'error' }, '图表生成失败。')

  const openHtml = () => {
    if (typeof receipt.html_path === 'string') props.openFile(receipt.html_path)
  }
  const head = h(
    'div',
    { className: 'capital-chart-head', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
    h('span', null, typeof receipt.title === 'string' && receipt.title.length > 0 ? receipt.title : '图表'),
    h('button', { type: 'button', onClick: openHtml, title: '打开自包含图表文件', style: { font: 'inherit', background: 'none', border: 'none', color: 'var(--dsw-alias-link)', cursor: 'pointer', padding: 0 } }, '打开'),
  )

  let body
  if (url === null) body = h('div', { className: 'capital-chart-note' }, '图表已生成；点“打开”查看可交互文件。')
  else if (loadError !== null) body = h('div', { className: 'capital-chart-note' }, `图表数据取不到（${loadError}），可点“打开”查看自包含文件。`)
  else if (payload === null) body = h('div', { className: 'capital-chart-note', 'data-state': 'loading' }, '正在加载图表数据…')
  else body = h(ChartCanvas, { payload })
  return h('div', { className: 'capital-chart', 'data-state': 'ok', style: { margin: '8px 0' } }, head, body)
}

function apply(ctx) {
  ctx.slots.inject(TOOLVIEW_SLOT, () => ctx.slots.register({ name: TOOLVIEW_SLOT, key: 'render_chart' }, ChartView))
  ctx.logger?.info?.('capital-charts: 客户端半边已挂载（render_chart toolview；呈现走官方交付通道）')
}

exports.name = 'capital-charts'
exports.inject = ['slots']
exports.apply = apply
exports.ChartView = ChartView
