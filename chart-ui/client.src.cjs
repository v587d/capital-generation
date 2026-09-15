/**
 * `@v587d/capital-charts` 浏览器半边的**源码**。
 *
 * 构建产物是 `chart-ui/client.js`（`scripts/build-client.mjs` 用 esbuild 打包）：
 *  - `lightweight-charts` 的 ESM 构建被 tree-shake 后**内联**进 bundle，
 *    因此不产生页面全局，不会与其它插件带的同库不同版本互相覆盖；
 *  - `react` / `react/jsx-runtime` 保持 external，由客户端的 `require` 提供（shell 静态种子）。
 *
 * 为什么是 CommonJS 入口：客户端模块表的工厂函数就是 CommonJS（`module` / `exports` / `require`），
 * 入口保持 `exports.apply = …` 形态可以原样进 bundle，产物的形状与 shipped 客户端一致。
 *
 * 与自包含 HTML 的唯一区别是**图表库从哪来**：这里用打包进来的 ESM 模块，
 * HTML 用 UMD 全局；两者都把库作为第三个参数交给同一段运行时（`__capitalChart.render`）。
 */
const { useEffect, useRef, useState, createElement: h } = require('react')
const LightweightCharts = require('lightweight-charts')
const { __capitalChart } = require('./client.runtime.gen.cjs')

const TOOLVIEW_SLOT = 'tool.call.toolview'

/**
 * 从已结算的工具节点里取回执。
 *
 * 回执是工具 `output.render` 产出的文本块（JSON 字符串），只有元数据、没有数据行；
 * 序列本体走 `chart_url` 旁路，浏览器单独 fetch。
 */
function readReceipt(block) {
  if (!block || block.kind !== 'tool-result') return undefined
  const items = Array.isArray(block.content) ? block.content : []
  for (const item of items) {
    if (item && item.type === 'text' && typeof item.text === 'string') {
      try {
        const parsed = JSON.parse(item.text)
        if (parsed && typeof parsed === 'object') return parsed
      } catch {
        // 不是回执文本，继续找下一个块。
      }
    }
  }
  return undefined
}

/** 图表画布：把 fetch 到的序列交给共享运行时，卸载时销毁图表。 */
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
        // 已被宿主卸载。
      }
    }
  }, [props.payload])
  return h('div', { ref: holder, 'data-chart-canvas': '1', style: { width: '100%', height: '320px' } })
}

/** 对话流里的 `render_chart` 卡片：取数 → 渲染 → “放大”进右栏文档 tab。 */
function ChartView(props) {
  const block = props.block
  const settled = Boolean(block) && block.kind === 'tool-result'
  const failed = settled && block.isError
  const receipt = settled ? readReceipt(block) : undefined
  const url = receipt && typeof receipt.chart_url === 'string' ? receipt.chart_url : null
  const [payload, setPayload] = useState(null)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    if (!url) return undefined
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    let active = true
    fetch(url, controller ? { cache: 'no-store', signal: controller.signal } : { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
      .then((value) => {
        if (active) setPayload(value)
      })
      .catch((error) => {
        if (active) setLoadError(String((error && error.message) || error))
      })
    return () => {
      active = false
      if (controller) controller.abort()
    }
  }, [url])

  if (!settled) {
    return h('div', { className: 'capital-chart', 'data-state': 'running' }, '正在生成图表…')
  }
  if (failed || !receipt) {
    return h('div', { className: 'capital-chart', 'data-state': 'error' }, '图表生成失败。')
  }

  const openHtml = () => {
    if (typeof receipt.html_path === 'string') props.openFile(receipt.html_path)
  }
  const head = h(
    'div',
    {
      className: 'capital-chart-head',
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '8px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)',
      },
    },
    h('span', null, typeof receipt.title === 'string' && receipt.title.length > 0 ? receipt.title : '图表'),
    h(
      'button',
      {
        type: 'button', onClick: openHtml,
        style: { font: 'inherit', background: 'none', border: 'none', color: 'var(--dsw-alias-link)', cursor: 'pointer', padding: 0 },
      },
      '放大',
    ),
  )

  let body
  if (url === null) {
    body = h('div', { className: 'capital-chart-note' }, '图表已生成；点“放大”打开可交互文件。')
  } else if (loadError !== null) {
    body = h('div', { className: 'capital-chart-note' }, `图表数据取不到（${loadError}），可点“放大”打开自包含文件。`)
  } else {
    body = h(ChartCanvas, { payload })
  }

  return h('div', { className: 'capital-chart', 'data-state': 'ok', style: { margin: '8px 0' } }, head, body)
}

function apply(ctx) {
  ctx.slots.inject(TOOLVIEW_SLOT, () =>
    ctx.slots.register({ name: TOOLVIEW_SLOT, key: 'render_chart' }, ChartView),
  )
  // 这行日志是 runbook（dsh-surface-ledger.md）判断“bundle 真的到了浏览器”的锚点。
  ctx.logger?.info?.('capital-charts: 客户端半边已挂载（render_chart toolview 已注册）')
}

exports.name = 'capital-charts'
exports.inject = ['slots']
exports.apply = apply
exports.ChartView = ChartView
