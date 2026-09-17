/**
 * `@v587d/capital-charts` browser half.
 *
 * Two surfaces:
 *  1. `conversation.chat.turnTail` — 本轮图表卡片。数据来自宿主追加的
 *     `capital/chart-rendered` 会话事件（该事件不是 surface 事件，永不进模型上下文），
 *     图表序列经 `/capital-charts/<chart_id>.json` 旁路取，不进任何 Agent 上下文。
 *  2. `tool.call.toolview['render_chart']` — 图表生成过程的明细卡片（子会话里也能看）。
 *
 * The turn-tail selector MUST return null when the closing turn has no chart,
 * otherwise it would take the single chain seat away from the shipped
 * deliverables row (chain = first non-null select wins).
 */
const { useEffect, useRef, useState, createElement: h } = require('react')
const LightweightCharts = require('lightweight-charts')
const { __capitalChart } = require('./client.runtime.gen.cjs')

const TOOLVIEW_SLOT = 'tool.call.toolview'
const TURN_TAIL_SLOT = 'conversation.chat.turnTail'
const CHART_EVENT = 'capital/chart-rendered'
const CHARTS_KEY = 'capital-turn-charts'

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

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * One turn-local chart accumulator.
 *
 * Data-only Definition: it publishes `capital-turn-charts` on the Turn, which
 * the turn-tail selector reads.
 *
 * 回合归属由宿主保证：`render_chart` 只在**回合打开时**写事件，回合之间出图会先寄存、
 * 等 owner 的下一个 `turn/start` 才写入（见 src/chart/events.ts）。这里再加一道安全网：
 * 事件的 turn 必须**已经开过**，否则不认领——DSH 的 conversation engine 不允许一个 context
 * 先收到 update 再收到它的 start（`received an update before its start Match`），
 * 宁可少一张卡片，也不能让客户端投影抛错。
 */
function turnChartsDefinition() {
  let lastStartedTurn = 0
  return {
    kind: CHARTS_KEY,
    match: (event) => {
      if (event.type === 'turn/start') {
        const turn = event.data.turn
        if (Number.isSafeInteger(turn)) lastStartedTurn = turn
        return { id: String(turn), role: 'start' }
      }
      if (event.type === CHART_EVENT && isRecord(event.data) && Number.isSafeInteger(event.data.turn)) {
        if (event.data.turn > lastStartedTurn) return null
        return { id: String(event.data.turn), role: 'update' }
      }
      return null
    },
    start: (context, match) => ({ turn: match.event.data.turn, charts: [] }),
    update: (context, match) => {
      const event = match.event
      const state = context.state === undefined ? { turn: event.data.turn, charts: [] } : context.state
      const data = event.data
      if (typeof data.chart_id !== 'string' || data.chart_id.length === 0) return state
      if (state.charts.some((chart) => chart.chart_id === data.chart_id)) return state
      const chart = {
        seq: event.seq,
        chart_id: data.chart_id,
        title: typeof data.title === 'string' && data.title.length > 0 ? data.title : '图表',
        kind: typeof data.kind === 'string' ? data.kind : '',
        points: Number.isSafeInteger(data.points) ? data.points : 0,
        chart_url: typeof data.chart_url === 'string' ? data.chart_url : null,
        html_path: typeof data.html_path === 'string' ? data.html_path : '',
      }
      return { ...state, charts: [...state.charts, chart] }
    },
    buildLocationData: (context, scope, previous) => {
      if (scope !== 'turn' || context.state === undefined) return null
      if (
        previous?.kind === 'turn'
        && previous.turn === context.state.turn
        && previous.key === CHARTS_KEY
        && previous.value.charts === context.state.charts
      ) return previous
      return {
        kind: 'turn',
        turn: context.state.turn,
        key: CHARTS_KEY,
        value: { charts: context.state.charts },
      }
    },
  }
}

/**
 * Claim the turn tail only when the closing turn registered charts.
 * Any other turn must decline (null) so the shipped deliverables row keeps its seat.
 */
function selectTurnCharts(owner) {
  const data = owner.turn.data.get(CHARTS_KEY)
  if (!data || !Array.isArray(data.charts)) return null
  const charts = data.charts.filter((chart) => chart.seq < owner.seq)
  return charts.length === 0 ? null : { charts }
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

const CARD_STYLE = {
  margin: '12px 0 0',
  padding: '10px 12px 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: '8px',
  background: 'var(--dsw-alias-bg-layer-1)',
}

function ChartCard(props) {
  const chart = props.chart
  const { value: payload, error } = useJson(chart.chart_url)
  const openHtml = () => {
    if (chart.html_path) props.openFile(chart.html_path)
  }
  let body
  if (!chart.chart_url) {
    body = h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', padding: '12px 0' } },
      '图表数据通道不可用；点「打开图表」查看自包含文件。')
  } else if (error) {
    body = h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', padding: '12px 0' } },
      `图表数据取不到（${error}）；点「打开图表」查看自包含文件。`)
  } else if (!payload) {
    body = h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', padding: '12px 0' } }, '正在加载图表…')
  } else {
    body = h(ChartCanvas, { payload })
  }
  return h(
    'section',
    { className: 'capital-turn-chart', 'data-chart-id': chart.chart_id, style: CARD_STYLE },
    h(
      'header',
      { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', marginBottom: '6px' } },
      h('strong', { style: { fontSize: '13px' } }, chart.title),
      h(
        'button',
        {
          type: 'button',
          onClick: openHtml,
          title: '在新窗口打开可交互图表（自包含 HTML）',
          style: { font: 'inherit', fontSize: '12px', background: 'none', border: 'none', color: 'var(--dsw-alias-link)', cursor: 'pointer', padding: 0 },
        },
        '打开图表',
      ),
    ),
    body,
    h('div', { style: { color: 'var(--dsw-alias-label-caption)', fontSize: '11px', marginTop: '4px' } },
      `${chart.kind || 'chart'}${chart.points > 0 ? ` · ${chart.points} 点` : ''}`),
  )
}

/**
 * The turn-tail card: one interactive chart per registered chart event, in the
 * order the pictures were rendered. It sits right after the closing assistant
 * message, so the user reads the conclusion first and then inspects the chart
 * that supports it.
 */
function TurnChartsView(props) {
  const charts = Array.isArray(props.matched?.charts) ? props.matched.charts : []
  return h(
    'section',
    { className: 'capital-turn-charts', 'data-turn-charts': '1', style: { margin: '16px 0 4px' } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', marginBottom: '2px' } },
      h('strong', { style: { fontSize: '14px' } }, '本轮图表'),
      h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, `${charts.length} 张`),
    ),
    charts.map((chart) => h(ChartCard, { key: chart.chart_id, chart, openFile: props.openFile })),
  )
}

/** 工具过程明细：保留在子会话与展开视图里，不再承担唯一入口。 */
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
  ctx.uiConversation.events.register(turnChartsDefinition())
  ctx.slots.inject(TURN_TAIL_SLOT, () => ctx.slots.register({ name: TURN_TAIL_SLOT, select: selectTurnCharts }, TurnChartsView))
  ctx.slots.inject(TOOLVIEW_SLOT, () => ctx.slots.register({ name: TOOLVIEW_SLOT, key: 'render_chart' }, ChartView))
  ctx.logger?.info?.('capital-charts: 客户端半边已挂载（turn-tail 本轮图表 + render_chart toolview）')
}

exports.name = 'capital-charts'
exports.inject = ['slots', 'uiConversation']
exports.apply = apply
exports.ChartView = ChartView
exports.TurnChartsView = TurnChartsView
