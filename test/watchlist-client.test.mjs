/**
 * Client-side gates for `watchlist/client.js`, run in a vm exposing only the official shell modules.
 * Mount stays fetch-free, menu copy stays Chinese-only, one run() emits one batch with no polling.
 * Unknown require, or a name outside the stub whitelist, throws rather than rendering nothing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../watchlist/client.js', import.meta.url), 'utf8')

/** Shared quoted row; the price keeps extra decimals so toFixed rounding is observable. */
const QUOTED = {
  thscode: '399001.SZ',
  ticker: '399001',
  name: '深证成指',
  exchange: 'SZ',
  asset_type: 'a-share-index',
  added_at: 1,
  source: 'seed',
  quote: { price: 12858.7532, change_pct: -3.440841, captured_at: 1790589000000, source_ts: 1 },
}
/** Outlasts the client's 300ms search debounce. */
const SEARCH_WAIT_MS = 400

function createSnapshotStore(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    set: (next) => { value = next; for (const fn of listeners) fn() },
    update: (mutator) => { mutator(value); for (const fn of listeners) fn() },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

function loadBundle(sandbox = {}) {
  let entry
  const appended = []
  const context = {
    window: { __ModuleLoader__: { load: (value) => { entry = value } }, confirm: () => true },
    document: {
      createElement: (tag) => ({
        tag,
        style: {},
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value },
        appendChild() {},
        remove() {},
      }),
      querySelector: () => null,
      head: { appendChild(node) { appended.push(node) } },
      body: {},
      addEventListener() {}, removeEventListener() {},
    },
    navigator: { userAgent: 'node', clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    Promise,
    AbortController,
    AbortSignal,
    URL,
    URLSearchParams,
    TextEncoder,
    fetch: sandbox.fetch ?? (async () => ({ ok: true, status: 200, text: async () => '{"ok":true,"items":[]}' })),
    ...sandbox,
  }
  context.__appended = appended
  runInNewContext(source, context)
  assert.ok(entry, 'bundle 必须调用 window.__ModuleLoader__.load 登记模块')
  entry.__appended = appended
  return entry
}

/** useState stub: components are invoked directly, so hook state must really mutate; the cursor resets per render, as React does. */
const hookState = []
let hookCursor = 0
const resetHooks = () => { hookCursor = 0 }
/** Clean component state per test (mount calls it so pendingRemove cannot leak across cases). */
const freshHooks = () => { hookState.length = 0; hookCursor = 0 }

function factoryRequire(name) {
  if (name === 'react') {
    return {
      createElement: (type, props, ...children) => {
        if (type === undefined) throw new Error('渲染了 undefined 组件（图标名 / 组件名不在 stub 白名单里）')
        return { type, props: props ?? {}, children }
      },
      useEffect: () => {},
      useState: (value) => {
        const index = hookCursor++
        if (!(index in hookState)) hookState[index] = value
        return [hookState[index], (next) => {
          hookState[index] = typeof next === 'function' ? next(hookState[index]) : next
        }]
      },
      useRef: () => ({ current: null }),
      useMemo: (factory) => factory(),
    }
  }
  if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore }
  if (name === '@deepseek-ai/dsh-client-ui-primitives') {
    // Whitelist mirrors the installed @deepseek-ai/dsh-client-ui-primitives export table; missing names throw and every icon carries a displayName so swaps are assertable.
    const icon = (name) => { const component = () => ({ type: 'icon' }); component.displayName = name; return component }
    const stub = {
      Modal: (props) => ({ type: 'Modal', props }),
      // Official Menu / MenuItemButton: portal and component-row semantics, props contract only.
      Menu: (props) => ({ type: 'Menu', props }),
      MenuItemButton: (props) => ({ type: 'MenuItemButton', props }),
      // Official Switch is button[role=switch] + aria-checked; contract: checked / onChange(next) / label / disabled / title / className.
      Switch: (props) => ({ type: 'Switch', props }),
      Button: (props) => ({ type: 'Button', props }),
      Toast: (props) => ({ type: 'Toast', props }),
      IconChecklistOutlineRegular: icon('IconChecklistOutlineRegular'),
      IconCloseOutlineRegular: icon('IconCloseOutlineRegular'),
      IconDatabaseOutlineRegular: icon('IconDatabaseOutlineRegular'),
      IconEllipsisOutlineRegular: icon('IconEllipsisOutlineRegular'),
      // The official set has no wallet/pie/coin icon, no hollow circle and no minus (stepper keys are text -/+). ⛔ Never fall back to IconCheckCircle*: a tick inside would lie in the unmarked state.
      IconGoalOutlineRegular: icon('IconGoalOutlineRegular'),
      IconListPenOutlineRegular: icon('IconListPenOutlineRegular'),
      IconPinOutlineRegular: icon('IconPinOutlineRegular'),
      IconSearchOutlineRegular: icon('IconSearchOutlineRegular'),
      IconRefreshOutlineRegular: icon('IconRefreshOutlineRegular'),
      IconTrashOutlineRegular: icon('IconTrashOutlineRegular'),
    }
    return new Proxy(stub, {
      get: (target, key) => {
        // ⛔ Any missing capitalised key throws, not only Icon*: an undefined component fails in a way that hides the bad name.
        if (typeof key === 'string' && /^[A-Z]/.test(key) && !(key in target)) {
          throw new Error(`官方 primitives 的 stub 白名单里没有 "${key}"（先对着宿主的 export 表确认，再补进来）`)
        }
        return target[key]
      },
    })
  }
  throw new Error(`客户端 bundle 不应在运行期 require("${name}")：shell 种子只有 react 与两个官方基线包`)
}

/** Flattens the createElement tree to text for the what-is-on-screen assertions. */
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  const props = node.props ?? {}
  // Invoke function components once and fold rest-arg children into props, as official createElement does.
  if (typeof node.type === 'function') {
    return textOf(node.type({ ...props, children: props.children ?? node.children ?? [] }))
  }
  const kids = [props.children ?? node.children ?? [], props.footer]
  return [props.placeholder, props.title, props['aria-label'], kids].map(textOf).join(' ')
}

/** Deep walk: function components must run once before their inner class names exist. */
function walkNodes(node, visit) {
  if (Array.isArray(node)) {
    for (const item of node) walkNodes(item, visit)
    return
  }
  if (node === null || node === undefined || typeof node !== 'object') return
  if (typeof node.type === 'function') {
    walkNodes(node.type({ ...node.props, children: node.props.children ?? node.children ?? [] }), visit)
    return
  }
  visit(node)
  walkNodes(node.props?.children ?? node.children ?? [], visit)
}

/** Official createElement puts children in props.children, the stub in node.children. */
const childrenOf = (node) => node?.props?.children ?? node?.children ?? []

/** Node lookup by whole-word className token, never substring. */
function classNodes(tree, name) {
  const found = []
  walkNodes(tree, (node) => {
    if (typeof node.props?.className === 'string' && node.props.className.split(' ').includes(name)) found.push(node)
  })
  return found
}

/** Menu stub nodes (type 'Menu'); the trigger lives in props.anchor, which walkNodes does not enter. */
function menuNodes(tree) {
  const found = []
  walkNodes(tree, (node) => { if (node.type === 'Menu') found.push(node) })
  return found
}

const moreButtonAt = (tree, index = 0) => menuNodes(tree)[index].props.anchor

const iconOf = (node) => {
  const first = childrenOf(node)[0]
  return typeof first?.type?.displayName === 'string' ? first.type.displayName : null
}

function selectFromMenu(render, id, index = 0) {
  moreButtonAt(render(), index).props.onClick()
  menuNodes(render())[index].props.onSelect(id)
  return render()
}

/** Component rows of the Menu children; MenuItemButton must be invoked once to appear, as walkNodes does. */
const menuChildren = (tree, index = 0) => childrenOf(menuNodes(tree)[index].props).map((node) => (
  typeof node?.type === 'function' ? node.type({ ...node.props, children: node.props.children ?? node.children ?? [] }) : node
))

const removeRow = (tree, index = 0) => menuChildren(tree, index).find((node) => node.type === 'MenuItemButton')

/** Stepper keys and readout, matched by document order (- left, + right): the dictionary is on the vm side, so reachable names are asserted against harness.zh. */
function stepButtons(tree, index = 0) {
  const stepper = classNodes(menuNodes(tree)[index].props.children, 'capital-watchlist-stepper')[0]
  if (stepper === undefined) return null
  const buttons = classNodes(stepper, 'capital-watchlist-stepperbtn')
  assert.equal(buttons.length, 2, '步进行必须正好两颗键（− 与 +）')
  return {
    down: buttons[0],
    up: buttons[1],
    readout: classNodes(stepper, 'capital-watchlist-stepperreadout')[0],
    stepper,
  }
}

/** Clicks 移除 in the row menu; that component row carries its own onSelect, not Menu.onSelect. */
function removeViaMenu(render, index = 0) {
  if (menuNodes(render())[index].props.open !== true) moreButtonAt(render(), index).props.onClick()
  removeRow(render(), index).props.onSelect()
  return render()
}

/** Fake client context covering the slots / locale / commandUi / sessions injection paths. */
function clientContext({ list } = {}) {
  const registrations = []
  const contributions = []
  const injected = []
  const sessions = { list: createSnapshotStore(list ?? { byId: {}, ids: [], phase: 'ready' }), refreshProjections: async (id) => { sessions.nudged.push(id) }, nudged: [] }
  const dictionaries = {}
  const ctx = {
    slots: {
      inject: (seat, callback) => { injected.push(seat); return callback() },
      register: (declaration, component) => { registrations.push({ declaration, component }); return () => {} },
    },
    // The fake locale really stores dictionaries, so copy assertions read text rather than keys.
    locale: {
      register: (ns, dicts) => { dictionaries[ns] = dicts; return () => {} },
      bind: (ns) => (key) => dictionaries[ns]?.zh?.[key] ?? key,
    },
    commandUi: { register: (contribution) => { contributions.push(contribution); return () => {} } },
    sessions,
    get: (name) => (name === 'commandUi' ? ctx.commandUi : name === 'sessions' ? ctx.sessions : name === 'slots' ? ctx.slots : name === 'locale' ? ctx.locale : undefined),
    inject: (names, callback) => callback(ctx),
    effect: (factory) => (typeof factory === 'function' ? factory() : undefined),
    provide: () => {},
    logger: { info: () => {}, error: () => {} },
    registrations,
    contributions,
    injected,
    dictionaries,
  }
  return ctx
}

function mount(options = {}) {
  freshHooks()
  const ctx = clientContext(options.ctx ?? {})
  const mod = loadBundle(options).factory(factoryRequire)
  mod.apply(ctx)
  return { ctx, mod }
}

/** The stylesheet actually injected into head: style cases read what the browser gets, not client.src.cjs (comments get stripped there). */
function mountedCss(options = {}) {
  freshHooks()
  const entry = loadBundle(options)
  entry.factory(factoryRequire).apply(clientContext(options.ctx ?? {}))
  const nodes = entry.__appended
  assert.equal(nodes.length, 1, '样式一次注入即完成（多挂一份就是泄漏）')
  return nodes[0].textContent
}

test('bundle 身份：id 等于包名，导出 name / inject / apply', () => {
  const entry = loadBundle()
  assert.equal(entry.id, '@v587d/watchlist')
  const mod = entry.factory(factoryRequire)
  assert.equal(mod.name, 'capital-watchlist')
  assert.deepEqual([...mod.inject].sort(), ['commandUi', 'locale', 'sessions', 'slots'])
  assert.equal(typeof mod.apply, 'function')
})

/** src <-> bundle gate: without npm run build:watchlist-client every behavioural case here stays green, so dictionary values and CSS rules are matched against the bundle. */
test('⛔ 源码已改、bundle 还是旧的：字典值与 CSS 规则必须在 client.js 里逐字命中', () => {
  const srcSource = readFileSync(new URL('../watchlist/client.src.cjs', import.meta.url), 'utf8')
  const srcBlock = (needle, endNeedle) => {
    const start = srcSource.indexOf(needle)
    const end = srcSource.indexOf(endNeedle, start + needle.length)
    assert.ok(start >= 0 && end > start, `读不到 src 里的 ${needle}`)
    return srcSource.slice(start + needle.length, end)
  }

  const { ctx } = mount()
  const dictionaries = ctx.dictionaries['capital.watchlist']
  for (const language of ['zh', 'en']) {
    const fromSrc = {}
    for (const match of srcBlock(`const ${language} = {`, '\n}').matchAll(/^ {2}'?([A-Za-z0-9_.]+)'?: '((?:[^'\\]|\\.)*)',/gm)) {
      fromSrc[match[1]] = match[2].replace(/\\'/g, "'")
    }
    assert.ok(Object.keys(fromSrc).length > 20, `${language} 字典从 src 里只解析出 ${Object.keys(fromSrc).length} 条——解析式该修了`)
    for (const [key, value] of Object.entries(fromSrc)) {
      assert.equal(dictionaries[language][key], value,
        `⛔ ${language}.${key} 源码与 bundle 不一致：跑 npm run build:watchlist-client`)
    }
  }

  const css = mountedCss()
  const cssSource = srcBlock('const CSS = `', '\n`')
  // ⛔ A backtick or ${ inside a CSS comment closes the template string early: esbuild still passes and the bundle loses the rest of the stylesheet.
  assert.equal(/`|\$\{/.test(cssSource), false, 'CSS 模板里的注释不许用反引号 / `${`：要引用类名就写裸名字')
  for (const line of cssSource.split('\n')) {
    if (!line.includes('{') || !line.includes('}')) continue
    if (line.trimStart().startsWith('/*') || line.startsWith(' ')) continue
    assert.equal(css.includes(line), true, `⛔ CSS 规则没进 bundle：跑 npm run build:watchlist-client（${line.slice(0, 60)}…）`)
  }
  // Total rule count must match as well - per-rule presence checks miss a truncated section.
  assert.equal(cssSource.match(/^\.[a-z]/gm).length, cssSource.split('\n').filter((line) => /^\.[a-z]/.test(line) && css.includes(line)).length,
    '⛔ src 里的样式规则并非全部落到 bundle')
})

test('注册两条：overlay 座位的 list entry + 一条 commandUi contribution', () => {
  const { ctx } = mount()
  assert.deepEqual(ctx.injected, ['conversation.input.overlay'], '弹窗只占 conversation.input.overlay')
  assert.equal(ctx.registrations.length, 1)
  const declaration = ctx.registrations[0].declaration
  assert.equal(declaration.name, 'conversation.input.overlay')
  assert.equal(declaration.id, 'capital-watchlist-dialog')
  assert.equal(declaration.locale, 'capital.watchlist')
  assert.equal(ctx.contributions.length, 1)

  const contribution = ctx.contributions[0]
  assert.equal(contribution.name, 'watchlist')
  assert.equal(contribution.label(), '自选股')
  assert.equal(typeof contribution.icon, 'function', '图标从官方图标集取（IconChecklistOutlineRegular，清单语义）')
  assert.equal(contribution.ui.kind, 'action')
})

test('菜单行不带英文别名：行面只留中文，typed 路径靠命令名（bare token）', () => {
  const { ctx } = mount()
  const contribution = ctx.contributions[0]
  // The official filter matches label/detail only; the typed path works off the bare token equal to contribution.name.
  assert.equal(contribution.description().includes('watchlist'), false, `行面上又出现别名词了：${contribution.description()}`)
  assert.equal(contribution.label(), '自选股')
  assert.equal(contribution.description(), '添加 / 查看 / 删除自选股')
  assert.equal(contribution.name, 'watchlist', '命令名是 `/watchlist`↵ 的唯一凭据，不能被本地化改名带跑')
})

test('available：只有 agentPreset 为 capital-generation 的会话为真', () => {
  const capital = clientContext({ list: { ids: ['s1'], byId: { s1: { id: 's1', projectionValues: { agentPreset: 'capital-generation' } } }, phase: 'ready' } })
  const standard = clientContext({ list: { ids: ['s2'], byId: { s2: { id: 's2', projectionValues: { agentPreset: 'standard' } } }, phase: 'ready' } })
  const mod = loadBundle().factory(factoryRequire)
  mod.apply(capital)
  mod.apply(standard)

  assert.equal(capital.contributions[0].available({ sessionId: 's1' }), true)
  assert.equal(standard.contributions[0].available({ sessionId: 's2' }), false, '极简 / 标准模式不许出现这一行')
  assert.equal(standard.contributions[0].available({ sessionId: 'unknown' }), false, '未知会话按缺席处理（宁可少一行，不可入侵别的模式）')
})

test('投影未落地时催读一次（不轮询、不重复催）', async () => {
  const cold = clientContext({ list: { ids: ['s3'], byId: { s3: { id: 's3' } }, phase: 'ready' } })
  const mod = loadBundle().factory(factoryRequire)
  mod.apply(cold)
  const contribution = cold.contributions[0]
  assert.equal(contribution.available({ sessionId: 's3' }), false, '读不到 preset 就先隐藏')
  contribution.available({ sessionId: 's3' })
  contribution.available({ sessionId: 's3' })
  await Promise.resolve()
  assert.equal(cold.sessions.nudged.filter((id) => id === 's3').length, 1, '每个会话最多催读一次')
})

test('⛔ mount 零 fetch：非 Capital 会话里组件也 mount，但不许发任何请求', () => {
  const calls = []
  const { ctx } = mount({ fetch: async (url) => { calls.push(url); return { ok: true, status: 200, text: async () => '{"ok":true,"items":[]}' } } })
  const injected = ctx.registrations[0].declaration.inject('s1')
  assert.ok(injected.hooks.dialog, '开合状态必须走 hooks（createSnapshotStore），useState 收不到 run() 的信号')
  const Component = ctx.registrations[0].component
  Component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t: (key) => key })
  assert.deepEqual(calls, [], 'mount 与 render（未打开）期间一次请求都不许发')
})

test('run() 才出网：一次 /list + 一次 /refresh，之后没有任何后续请求', async () => {
  const calls = []
  const respond = (url) => ({
    ok: true,
    status: 200,
    text: async () => (url.includes('/search') ? '{"ok":true,"items":[]}' : url.includes('/refresh')
      ? '{"ok":true,"items":[{"thscode":"000001.SH","ticker":"000001","name":"上证指数","exchange":"SH","asset_type":"a-share-index","added_at":1,"source":"seed","quote":{"price":3823.62,"change_pct":-1.665222,"captured_at":2,"source_ts":1}}],"refreshed_at":2,"failures":[]}'
      : '{"ok":true,"items":[{"thscode":"000001.SH","ticker":"000001","name":"上证指数","exchange":"SH","asset_type":"a-share-index","added_at":1,"source":"seed","quote":null}],"seeded_at":1}'),
  })
  const { ctx } = mount({ fetch: async (url) => { calls.push(String(url)); return respond(String(url)) } })
  const session = { sessionId: 's1' }
  // ActionSpec.run returns void, so wait for the macrotask.
  ctx.contributions[0].ui.run(session)
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(calls.map((url) => url.replace('/capital-watchlist', '')), ['/list', '/refresh'], '打开面板就完成一次数据请求，顺序是先清单后报价')
  const after = calls.length
  await new Promise((resolve) => setTimeout(resolve, 400))
  assert.equal(calls.length, after, '⛔ 无轮询：400ms（超过搜索防抖）之后仍不许有任何请求')
  assert.ok(calls.every((url) => url.startsWith('/capital-watchlist/')))
})

test('刷新按钮共用同一个闸门：并发只出网一次', async () => {
  const calls = []
  const { ctx } = mount({ fetch: async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => '{"ok":true,"items":[],"refreshed_at":1,"failures":[]}' } } })
  const injected = ctx.registrations[0].declaration.inject('s9')
  const surface = injected.surface
  await Promise.all([surface.refresh(), surface.refresh()])
  assert.equal(calls.filter((url) => url.includes('/refresh')).length, 1)
})

test('整批失败跟在「刷新报价」下面、逐条失败走行内：两种失败不混成一个', async () => {
  const failedRow = { thscode: '000001.SH', ticker: '000001', name: '上证指数', exchange: 'SH', asset_type: 'a-share-index', added_at: 1, source: 'seed', quote: null }
  const refreshBody = `{"ok":true,"items":[${JSON.stringify(failedRow)}],"refreshed_at":null,"failures":[{"thscode":"000001.SH","code":"quote_unavailable"}],"error":{"code":"rate_limited","message":"限流"}}`
  const { ctx } = mount({
    fetch: async (url) => ({
      ok: true,
      status: 200,
      text: async () => (String(url).includes('/refresh') ? refreshBody : `{"ok":true,"items":[${JSON.stringify(failedRow)}],"seeded_at":1}`),
    }),
  })
  const injected = ctx.registrations[0].declaration.inject('s10')
  // Land a real refreshed_at first: otherwise the footer-must-not-advance assertion is untested (initial value is already null).
  injected.surface.patch({ open: true, loading: false, items: [failedRow], refreshed_at: 1790589000000 })
  await injected.surface.refresh()
  const state = injected.hooks.dialog.getSnapshot()
  assert.equal(state.error.code, 'rate_limited', '整批失败进 error')
  assert.equal(state.failures['000001.SH'], 'quote_unavailable', '逐条失败只落在那一行')
  assert.equal(state.items.length, 1, '失败不许把清单清空')
  assert.equal(state.refreshed_at, 1790589000000, '⛔ 一条都没落地（宿主回 null）时，页脚那行仍报最后一次真取到数的时刻')

  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  resetHooks()
  const tree = ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })

  const footcol = classNodes(tree, 'capital-watchlist-footcol')[0]
  assert.ok(footcol, '底部左列装着刷新按钮与它自己的失败行')
  assert.equal(childrenOf(footcol).length, 2, '左列两行：按钮 + 失败行')
  assert.match(textOf(classNodes(footcol, 'capital-watchlist-notice')[0]), /行情服务限流/)
  assert.equal(classNodes(footcol, 'capital-watchlist-refresh').length, 1, '失败行与刷新按钮同列（红 = 数据不可信那一档）')
  assert.equal(textOf(classNodes(tree, 'capital-watchlist-search')[0]).includes('行情服务限流'), false, '⛔ 输入框那一带不画整批失败')
  const notice = classNodes(tree, 'capital-watchlist-notice')[0]
  assert.equal(notice.props.role, 'alert')
  assert.equal(notice.props['data-code'], 'rate_limited')

  const price = classNodes(tree, 'capital-watchlist-quotefailed')[0]
  assert.equal(textOf(price).trim(), '—', '没有值的失败行画破折号')
  assert.equal(classNodes(tree, 'capital-watchlist-stale').length, 0, '从来没有值 ≠ 陈旧值，两态不混')
  assert.equal(classNodes(tree, 'capital-watchlist-refresh')[0].props.disabled, false, '失败不锁按钮（本轮不做冷却）')
})

test('⛔「其他标的仍是上一次成功快照」只在确实还有别的标的时才说', async () => {
  const rowA = { thscode: '000001.SH', ticker: '000001', name: '上证指数', exchange: 'SH', asset_type: 'a-share-index', added_at: 1, source: 'seed', quote: { price: 3823.62, change_pct: -1.66, captured_at: 1790589000000, source_ts: 1 } }
  const rowB = { ...QUOTED, thscode: '399001.SZ', ticker: '399001', name: '深证成指' }
  const refreshBody = (codes) => `{"ok":true,"items":[${[rowA, rowB].map((row) => JSON.stringify(row)).join(',')}],"refreshed_at":null,"failures":${JSON.stringify(codes.map((thscode) => ({ thscode, code: 'refresh_timeout' })))},"error":{"code":"refresh_timeout","message":"超时"}}`
  const { ctx } = mount({
    fetch: async (url) => ({ ok: true, status: 200, text: async () => (String(url).includes('/refresh') ? refreshBody([rowA.thscode, rowB.thscode]) : `{"ok":true,"items":[${[rowA, rowB].map((row) => JSON.stringify(row)).join(',')}],"seeded_at":1}`) }),
  })
  const injected = ctx.registrations[0].declaration.inject('s-suffix')
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const noticeText = () => {
    resetHooks()
    const tree = ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
    return textOf(classNodes(tree, 'capital-watchlist-notice')[0])
  }

  injected.surface.patch({ open: true, loading: false, items: [rowA, rowB] })
  await injected.surface.refresh()
  let said = noticeText()
  assert.match(said, /刷新超时/)
  assert.equal(said.includes('上一次成功快照'), false, '⛔ 全批失败不许挂"其他标的仍是…"')

  const half = (url) => (String(url).includes('/refresh')
    ? { ok: true, status: 200, text: async () => refreshBody([rowA.thscode]) }
    : { ok: true, status: 200, text: async () => `{"ok":true,"items":[${[rowA, rowB].map((row) => JSON.stringify(row)).join(',')}],"seeded_at":1}` })
  const other = mount({ fetch: half })
  const injectedB = other.ctx.registrations[0].declaration.inject('s-suffix-half')
  injectedB.surface.patch({ open: true, loading: false, items: [rowA, rowB] })
  await injectedB.surface.refresh()
  resetHooks()
  const treeB = other.ctx.registrations[0].component({ ...injectedB, useDialog: (selector) => selector(injectedB.hooks.dialog.getSnapshot()), t: (key) => other.ctx.dictionaries['capital.watchlist'].zh[key] ?? key })
  assert.match(textOf(classNodes(treeB, 'capital-watchlist-notice')[0]), /其他标的仍是上一次成功快照/, '有没被波及的行时这句仍然要说（它挡的是"当成实时价"）')

  const none = { thscode: '600000.SH', ticker: '600000', name: '浦发银行', exchange: 'SH', asset_type: 'a-share', added_at: 1, source: 'user', quote: null }
  const dead = mount({ fetch: async () => ({ ok: false, status: 503, text: async () => '{"ok":false,"code":"fuyao_unavailable","message":"x"}' }) })
  const injectedC = dead.ctx.registrations[0].declaration.inject('s-suffix-dead')
  injectedC.surface.patch({ open: true, loading: false, items: [none] })
  await injectedC.surface.refresh()
  resetHooks()
  const treeC = dead.ctx.registrations[0].component({ ...injectedC, useDialog: (selector) => selector(injectedC.hooks.dialog.getSnapshot()), t: (key) => dead.ctx.dictionaries['capital.watchlist'].zh[key] ?? key })
  const saidC = textOf(classNodes(treeC, 'capital-watchlist-notice')[0])
  assert.match(saidC, /A 股行情暂时取不到/, '⛔ 服务名字要说清是哪一路：2.6 起 `fuyao_unavailable` 只管 A 股那一路')
  assert.equal(saidC.includes('上一次成功快照'), false, '⛔ 一行旧值都没有，"上一次成功快照"就是编的')
})

test('刷新失败 ≠ 没有价：上一次成功的快照照画（降一档色 + tooltip 说是哪一刻的）', async () => {
  const staleRow = { ...QUOTED, thscode: '000001.SH', ticker: '000001', name: '上证指数', quote: { price: 3823.62, change_pct: -1.665222, captured_at: 1790589000000, source_ts: 1 } }
  const refreshBody = `{"ok":true,"items":[${JSON.stringify(staleRow)}],"refreshed_at":null,"failures":[{"thscode":"000001.SH","code":"rate_limited"}],"error":{"code":"rate_limited","message":"限流"}}`
  const { ctx } = mount({
    fetch: async (url) => ({ ok: true, status: 200, text: async () => (String(url).includes('/refresh') ? refreshBody : `{"ok":true,"items":[${JSON.stringify(staleRow)}],"seeded_at":1}`) }),
  })
  const injected = ctx.registrations[0].declaration.inject('s-stale')
  injected.surface.patch({ open: true, loading: false, items: [staleRow] })
  await injected.surface.refresh()
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  resetHooks()
  const tree = ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })

  const row = classNodes(tree, 'capital-watchlist-row')[0]
  const rowText = textOf(row)
  assert.match(rowText, /3823\.62/, '⛔ 后端只覆写成功的那几条：本次失败不许把已有的上一次快照画成「—」')
  assert.match(rowText, /-1\.67%/, '涨跌幅也照画')
  assert.equal(rowText.includes('—'), false, '手上有值就不画破折号')
  assert.equal(classNodes(row, 'capital-watchlist-quotefailed').length, 0, '有旧值是"陈旧"那一档，不是"没有数据"')
  assert.equal(classNodes(row, 'capital-watchlist-stale').length, 2, '最新价与涨跌幅两行都降一档色')
  assert.equal(classNodes(row, 'capital-watchlist-up').length + classNodes(row, 'capital-watchlist-down').length, 0, '红涨绿跌是"当前"的语义，陈旧值不借用')
  const quoteCell = classNodes(row, 'capital-watchlist-quote')[0]
  assert.match(quoteCell.props.title, /行情服务限流/, 'tooltip 说清这一行为什么陈旧')
  assert.match(quoteCell.props.title, /上一次快照 09-28/, '并给出它是哪一刻的快照（底部那行时间是整批共用的，不替单行背书）')
})

test('搜索失败占下拉的 hint 位（替换「没有匹配的标的」）；添加失败不随改字消失', async () => {
  const candidate = { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', in_list: false }
  const { ctx } = mount({
    fetch: async (url) => {
      const target = String(url)
      if (target.includes('/search')) return { ok: false, status: 429, text: async () => '{"ok":false,"code":"rate_limited","message":"限流"}' }
      if (target.includes('/add')) return { ok: false, status: 409, text: async () => '{"ok":false,"code":"list_full","limit":30,"message":"满了"}' }
      return { ok: true, status: 200, text: async () => '{"ok":true,"items":[],"seeded_at":1}' }
    },
  })
  const injected = ctx.registrations[0].declaration.inject('s-searcherr')
  const surface = injected.surface
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  surface.patch({ open: true, loading: false })

  surface.onQueryChange('宁德')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  const tree = render()
  const hints = classNodes(tree, 'capital-watchlist-hint')
  assert.equal(hints.length, 1, 'hint 槽只有一条：搜索失败**替换**了「没有匹配的标的」，不是并排多一条')
  assert.match(textOf(hints[0]), /行情服务限流/)
  assert.equal(hints[0].props['data-code'], 'rate_limited')
  assert.equal(hints[0].props.role, 'alert')
  assert.match(hints[0].props.className, /capital-watchlist-searcherror/, '搜索失败是黄档（动作没成）')
  assert.equal(textOf(tree).includes('没有匹配的标的'), false, '⛔ 不许一边说限流、一边说"没有这个票"——那等于把服务故障说成用户查错')
  assert.equal(injected.hooks.dialog.getSnapshot().addError, null, '搜索失败走 searchError，不污染添加那条通道')

  await surface.add(candidate)
  assert.equal(injected.hooks.dialog.getSnapshot().addError.code, 'list_full')
  surface.onQueryChange('宁德时代')
  const after = injected.hooks.dialog.getSnapshot()
  assert.equal(after.addError.code, 'list_full', '⛔ 改一个字不许把 list_full 抹掉')
  assert.equal(after.searchError, null, '改字清的是上一次搜索的失败（新的在途请求已经取代它）')
  assert.match(textOf(classNodes(render(), 'capital-watchlist-adderror')[0]), /自选股最多 30 条/, '那句上限的数字跟着宿主回包的 limit 走')
  surface.patch({ addError: { code: 'list_full' } })
  const bare = textOf(classNodes(render(), 'capital-watchlist-adderror')[0])
  assert.match(bare, /自选股已达上限，先删一条再加/)
  assert.equal(bare.includes('{max}'), false, '⛔ 模板占位符不许漏到屏幕上')
  surface.patch({ addError: { code: 'list_full', limit: 30 } })
  assert.match(textOf(classNodes(render(), 'capital-watchlist-adderror')[0]), /最多 30 条/)
})

test('credential_missing 有独立文案位（不混进"查询失败"）', async () => {
  const { ctx } = mount({ fetch: async () => ({ ok: false, status: 503, text: async () => '{"ok":false,"code":"credential_missing","message":"x"}' }) })
  const injected = ctx.registrations[0].declaration.inject('s11')
  await injected.surface.refresh()
  assert.equal(injected.hooks.dialog.getSnapshot().error.code, 'credential_missing')
})

test('⛔ 读清单失败不许渲染成「还没有自选股」', async () => {
  // The host reports domain failures as store_unavailable rather than an empty list; the client must not render that as 还没有自选股.
  const calls = []
  const { ctx } = mount({ fetch: async (url) => { calls.push(String(url)); return { ok: false, status: 503, text: async () => '{"ok":false,"code":"store_unavailable","message":"x"}' } } })
  const injected = ctx.registrations[0].declaration.inject('s-loaderr')
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  injected.surface.open()
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))

  const state = injected.hooks.dialog.getSnapshot()
  assert.equal(state.loadError.code, 'store_unavailable')
  assert.equal(state.loading, false, '读失败也要收掉「正在读取清单…」')
  assert.deepEqual(calls, ['/capital-watchlist/list'], '⛔ 清单都没读到，不许再花一次出网去刷报价')

  resetHooks()
  const tree = ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  const empty = classNodes(tree, 'capital-watchlist-empty')[0]
  assert.match(textOf(empty), /自选股存储不可用/)
  assert.equal(empty.props.role, 'alert')
  assert.equal(classNodes(empty, 'capital-watchlist-loaderror').length, 1, '那一格走"数据不可信"的红档，不是空清单的次要灰')
  assert.equal(textOf(tree).includes('还没有自选股'), false, '一次 503 不能说成"你还没添加过东西"')
})

test('200 但不是一份 {ok:true}：一段 HTML / 一个空对象都不许当成空清单', async () => {
  const { ctx } = mount({ fetch: async () => ({ ok: true, status: 200, text: async () => '<!doctype html><html><body>…</body></html>' }) })
  const injected = ctx.registrations[0].declaration.inject('s-html200')
  await injected.surface.load().catch(() => {})
  const state = injected.hooks.dialog.getSnapshot()
  assert.equal(state.loadError.code, 'fuyao_unavailable', '成功判据是正文里的 ok:true，不是 HTTP 状态')
})

test('401 / 403 有自己的文案位：登录失效不许说成「行情暂时取不到」', async () => {
  // Fence rejections come back text/plain with no JSON code, so the status code is the only signal.
  for (const status of [401, 403]) {
    const { ctx } = mount({ fetch: async () => ({ ok: false, status, text: async () => 'unauthorized' }) })
    const injected = ctx.registrations[0].declaration.inject(`s-auth-${status}`)
    const zh = ctx.dictionaries['capital.watchlist'].zh
    const t = (key) => zh[key] ?? key
    await injected.surface.refresh()
    assert.equal(injected.hooks.dialog.getSnapshot().error.code, 'unauthorized', `${status} 归 unauthorized`)

    injected.surface.patch({ open: true, loading: false })
    resetHooks()
    const tree = ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
    assert.match(textOf(classNodes(tree, 'capital-watchlist-notice')[0]), /登录状态已失效/)
    assert.equal(/行情暂时取不到/.test(textOf(tree)), false, '⛔ 把认证失效说成服务不可用 = 让用户等一个不会自己恢复的错误（两路的句子都不许出现）')
  }
})

test('删掉一行之后「已达上限」那句当场消失；歧义那条与移除失败都不许跟着消失', async () => {
  const rowA = { thscode: '000001.SH', ticker: '000001', name: '上证指数', exchange: 'SH', asset_type: 'a-share-index', added_at: 1, source: 'seed', quote: null }
  const rowB = { thscode: '399001.SZ', ticker: '399001', name: '深证成指', exchange: 'SZ', asset_type: 'a-share-index', added_at: 1, source: 'seed', quote: null }
  const { ctx } = mount({
    fetch: async (url) => (String(url).includes('/remove')
      ? { ok: true, status: 200, text: async () => '{"ok":true,"removed":true}' }
      : { ok: true, status: 200, text: async () => '{"ok":true,"items":[],"seeded_at":1}' }),
  })
  const injected = ctx.registrations[0].declaration.inject('s-adderr-clear')
  const surface = injected.surface
  const snapshot = () => injected.hooks.dialog.getSnapshot()

  surface.patch({ open: true, loading: false, items: [rowA, rowB], addError: { code: 'list_full' } })
  await surface.remove(rowA.thscode)
  assert.equal(snapshot().addError, null, '清单腾出一格，"先删一条再加"当场不再成立')

  surface.patch({ items: [rowA, rowB], addError: { code: 'ambiguous' } })
  await surface.remove(rowA.thscode)
  assert.equal(snapshot().addError.code, 'ambiguous', 'ambiguous 讲的是上一次添加的歧义，与空位无关')
})

test('移除没成功时不许顺手清掉「已达上限」（清单其实一格都没腾出来）', async () => {
  const rowA = { thscode: '000001.SH', ticker: '000001', name: '上证指数', exchange: 'SH', asset_type: 'a-share-index', added_at: 1, source: 'seed', quote: null }
  const { ctx } = mount({ fetch: async () => ({ ok: false, status: 503, text: async () => '{"ok":false,"code":"store_unavailable"}' }) })
  const injected = ctx.registrations[0].declaration.inject('s-adderr-keep')
  const surface = injected.surface
  surface.patch({ open: true, loading: false, items: [rowA], addError: { code: 'list_full' } })
  await surface.remove(rowA.thscode)
  const snapshot = injected.hooks.dialog.getSnapshot()
  assert.deepEqual(snapshot.items.map((item) => item.thscode), [rowA.thscode], '失败要把行弹回去')
  assert.equal(snapshot.addError.code, 'list_full', '格子没真的腾出来，那句话就还成立')
})

test('两套语言的 key 必须齐平（新加文案不许只写中文）', () => {
  const { ctx } = mount()
  const dictionaries = ctx.dictionaries['capital.watchlist']
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort())
})

test('面板排版：headless 官方卡片 + 420 宽 + 类型徽标 + 两位小数 + 底部一行共用更新时间，且没有复制按钮', async () => {
  const listBody = `{"ok":true,"items":[${JSON.stringify(QUOTED)}],"seeded_at":1}`
  const refreshBody = `{"ok":true,"items":[${JSON.stringify(QUOTED)}],"refreshed_at":1790589000000,"failures":[]}`
  const { ctx } = mount({ fetch: async (url) => ({ ok: true, status: 200, text: async () => (String(url).includes('/refresh') ? refreshBody : listBody) }) })
  const injected = ctx.registrations[0].declaration.inject('s-layout')
  injected.surface.open()
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))

  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  resetHooks()
  const tree = ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  const text = textOf(tree)

  assert.ok(source.includes('width: min(420px, 92vw)'), '弹窗宽度定在 420px')
  assert.equal(tree.props.open, true, '打开态由 store 驱动，Modal 收到的是 open: true')
  assert.equal(tree.props.headless, true, '遮罩 / Esc / 焦点归官方 Modal，内部几何归插件（官方 .dialog/.body 是散列类，CSS 够不着）')
  assert.equal(tree.props.className, 'capital-watchlist-dialog', '宽度靠这个 class 打在 dialog 上')
  assert.equal(tree.props.shortcutModal, 'watchlist', 'shortcutModal 必须显式取值：未命名对话框会阻塞应用级命令')
  assert.equal(tree.props.closeLabel, undefined, 'headless 之后没有官方关闭按钮，closeLabel 不该再传')
  assert.equal(tree.props.footer, undefined, 'headless 之后 footer 槽不存在：刷新与时间是正文最后一行')
  assert.equal(tree.props.description, undefined, '正文顶部不再占一段说明')
  assert.equal(text.includes('清单存在本机'), false, '那句说明整行去掉')
  assert.match(text, /更新时间/, '更新时间落底部那一行')
  assert.match(text, /刷新报价/, '刷新动词就在更新时间左边')
  assert.equal((text.match(/09-28/g) ?? []).length, 1, '时间只出现一次（逐行重复是噪音）')
  assert.match(text, /12858\.75/, '最新价两位小数')
  assert.equal(text.includes('12858.7532'), false, '原始位数不许漏出来')
  assert.match(text, /-3\.44%/, '涨跌幅两位小数')
  assert.equal(classNodes(tree, 'capital-watchlist-down').length, 1, '跌是绿（A 股口径：红涨绿跌）')
  assert.ok(text.includes('A指'), '徽标说市场 × 品种：六档（A股 / 港股 / 美股 + A指 / 港指 / 美指），场内 ETF 并入 A股')
  assert.equal(classNodes(tree, 'capital-watchlist-tag-cn').length, 1, '类型画成徽标（A 股那一档）')
  const codeline = classNodes(tree, 'capital-watchlist-codeline')
  assert.equal(codeline.length, 1, '代码与徽标同行（一行数据一个 codeline）')
  assert.match(textOf(codeline[0]), /399001/, '代码在 codeline 里')
  assert.match(textOf(codeline[0]), /A指/, '徽标在代码右侧（同一行容器）')
  assert.equal(classNodes(codeline[0], 'capital-watchlist-tag-cn').length, 1, '徽标就住在 codeline 里，不再单占一列')
  assert.equal(text.includes('种子'), false, '不再区分种子与自选')
  assert.equal(text.includes('复制清单'), false, '复制清单不进面板（只留 surface 后门）')
  assert.equal(source.includes('window.confirm'), false, '⛔ 不用系统级 confirm 做二次确认')

  const menu = menuNodes(tree)[0]
  assert.equal(typeof menu, 'object', '每行一个官方 Menu 锚点')
  assert.equal(moreButtonAt(tree).props['aria-haspopup'], 'menu')
  assert.equal(moreButtonAt(tree).props['aria-expanded'], false, '未展开时 aria-expanded 为假')
  assert.equal(menu.props.portal, true, '清单区是滚动容器：菜单必须 portal 到 body，否则被裁')
  assert.equal(menu.props.align, 'end', '菜单贴右缘展开（贴着「更多」键）')

  // Head and data rows share one grid class or they stop lining up.
  const grids = classNodes(tree, 'capital-watchlist-grid')
  assert.equal(grids.length, 2, '表头一行 + 数据一行，共用同一个 grid 类')
  const head = classNodes(tree, 'capital-watchlist-head')[0]
  const cells = childrenOf(head).slice(0, 3)
  assert.equal(cells.length, 3, '名称 / 最新价·涨跌幅 / 操作 三格（「操作」跨在预测 + 复盘 + 更多之上）')
  assert.deepEqual(childrenOf(cells[2]), [zh.colAction], '三个动作列头顶写「操作」，不再留空')
  for (const cell of cells) {
    const name = cell.props?.className
    if (name === undefined) continue
    assert.ok(['capital-watchlist-quote', 'capital-watchlist-headaction'].includes(name), `表头格只许借右对齐或跨度（拿到的是「${name}」）`)
  }
  assert.match(mountedCss(), /\.capital-watchlist-headaction \{ text-align: right; \}/, '「操作」贴在最后一列上居右（2026-10-01 用户点名：居中读起来像列名）')
  // Right-aligned numbers put the gap to the action area in that cell's padding-right; the head borrows the class to follow, nowrap keeps it on one line.
  assert.match(mountedCss(), /\.capital-watchlist-quote \{[^}]*padding-right: 12px/, '报价与动作区之间那口气只有这一个来源')
  assert.match(mountedCss(), /\.capital-watchlist-head \{[^}]*white-space: nowrap/, '表头标签不参与换行')
  // The confirm layer stays mounted but closed (fade in/out, visibility:hidden drops it from Tab order). ⛔ exactly one layer: holding moved into the row menu, no second mask.
  const layers = classNodes(tree, 'capital-watchlist-confirm')
  assert.equal(layers.length, 1, '常驻遮罩层只有"移除确认"这一层')
  for (const layer of layers) {
    assert.equal(layer.props.className.includes('capital-watchlist-confirm-open'), false, '没点动作时这一层是收起的')
    assert.equal(layer.props['aria-hidden'], 'true')
  }
  assert.equal(classNodes(tree, 'capital-watchlist-stepper').length, 0, '菜单收起时不画比例步进器')
  assert.equal(classNodes(tree, 'capital-watchlist-holdingtag').length, 0, '⛔ 持仓徽标那一族已经废掉：行上标持仓只有名称标红一条路')
})

test('🔴 浅色模式闸门：面板 CSS 只准用"两套主题都读得出"的 token 角色', () => {
  // CSS comments ship to the browser, so the gate looks at declarations only or its own token names would trip it.
  const css = mountedCss().replace(/\/\*[\s\S]*?\*\//g, ' ')
  // docs/web-styling: functional CSS must not select by theme - the fix is a different role token, not a light override.
  assert.doesNotMatch(css, /--dsw-alias-label-dimmed/, 'dimmed 在浅色等于隐形，承载信息的文字一律 tertiary / secondary')
  assert.doesNotMatch(css, /background:\s*var\(--dsw-alias-bg-layer-1\)/, 'layer-1 在浅色与卡片同白，控件底面走 bg-module-platform')
  assert.doesNotMatch(css, /1px solid var\(--dsw-alias-border/, '中性 border 该是 0.5px 发丝线')
  for (const surface of ['dropdown', 'confirmbox']) {
    const rule = (css.match(new RegExp(`\\.capital-watchlist-${surface} \\{[^}]*\\}`)) ?? [])[0]
    assert.ok(rule, `拿不到 .capital-watchlist-${surface} 规则`)
    assert.match(rule, /border:\s*0/, `${surface} 该按高层级表面画：border:0`)
    assert.match(rule, /box-shadow:\s*var\(--dsw-elevation-/, `${surface} 该用官方 elevation 投影分离`)
  }
  assert.doesNotMatch(css, /box-shadow:[^;}]*--dsw-alias-bg-mask/, '遮罩色不是影子的颜色')
  // --dsw-specific-menu is translucent fill only; the official pairing is --dsw-menu-backdrop-filter, otherwise rows show through the dropdown.
  const dropdownRule = (css.match(/\.capital-watchlist-dropdown \{[^}]*\}/) ?? [])[0]
  assert.match(dropdownRule, /background:\s*var\(--dsw-specific-menu\)/, '下拉该用官方菜单材质')
  assert.match(dropdownRule, /backdrop-filter:\s*var\(--dsw-menu-backdrop-filter\)/, '菜单填充必须配官方菜单模糊')
  assert.match(dropdownRule, /--dsw-elevation-stroke-color:\s*var\(--dsw-alias-border-l1\)/, '浅色菜单描边重绑最浅的 l1')
  // Modal masks are the opposite case: translucent black fill, no blur of the background.
  assert.doesNotMatch((css.match(/\.capital-watchlist-confirm \{[^}]*\}/) ?? [])[0], /backdrop-filter/, '模态遮罩不模糊背景')
  assert.equal((css.match(/[^-]backdrop-filter:/g) ?? []).length, 1, '模糊只许下拉那一处')
  // Scrollbars belong to ui-theme scrollbar.css; components only rebind --dsh-scrollbar-thumb (a dialog is a high surface -> l2).
  assert.doesNotMatch(css, /scrollbar-width|scrollbar-color|::-webkit-scrollbar/, '滚动条归 ui-theme scrollbar.css，组件只重绑变量')
  assert.match(css, /--dsh-scrollbar-thumb:\s*var\(--dsw-alias-scrollbar-bg-l2\)/)
  assert.match(css, /outline:\s*var\(--dsw-focus-ring-width\) solid var\(--dsw-focus-ring-color/)
  for (const control of ['close', 'clear', 'option', 'filterbtn', 'more', 'predict', 'review', 'refresh', 'confirmbtn', 'stepperbtn']) {
    assert.match(css, new RegExp(`\\.capital-watchlist-${control}:focus-visible`), `${control} 缺键盘焦点环`)
  }
  assert.match(css, /\.capital-watchlist-dropdown \{[^}]*display: flex;[^}]*overflow: hidden/, '下拉本体不再自己滚，改成列容器')
  assert.match(css, /\.capital-watchlist-filter \{[^}]*flex: none;/, '⛔ 筛选头必须 flex: none（钉在顶）')
  assert.match(css, /\.capital-watchlist-options \{[^}]*overflow-y: auto;/, '滚动的只有选项那一层')
  assert.match(css, /\.capital-watchlist-hint \{[^}]*flex: none;/, '⛔ hint 也不许被压扁（它没有 overflow，压扁就是文字被裁）')
  const dropdownMax = /\.capital-watchlist-dropdown \{[^}]*max-height: (\d+)px/.exec(css)?.[1]
  const listMin = /\.capital-watchlist-list-open \{[^}]*min-height: (\d+)px/.exec(css)?.[1]
  assert.equal(dropdownMax, listMin, '⛔ 下拉 max-height 与 list-open min-height 必须同值：不等就被卡片 overflow:hidden 裁掉一截')
  assert.ok(Number(dropdownMax) > 246, '浮层要比旧的 246px 高，否则一屏行数上不去')
  assert.match(css, /\.capital-watchlist-option \{[^}]*padding: 6px 12px;/, '⛔ 候选行压到一屏能装 5~6 行的高度')
  // ⛔ Row dimming must read aria-disabled: real :disabled throws focus to body, onBlur sees a click outside and closes the dropdown.
  assert.match(css, /\.capital-watchlist-addbtn \{[^}]*color-mix\(in srgb, var\(--dsw-alias-state-business-primary\) 12%/u, '⛔ 「添加」要醒目：沿用「刷新报价」那颗 verb 按钮的淡底配方')
  assert.match(css, /\.capital-watchlist-addbtn\[data-state="added"\] \{[^}]*background: transparent;/u, '⛔ 「已添加」要暗：透明底 + tertiary 字')
  assert.match(css, /\.capital-watchlist-option\[aria-disabled="true"\] \{[^}]*opacity:/u, '⛔ 候选行降档读 aria-disabled')
  assert.equal(css.includes('.capital-watchlist-option:disabled'), false, '⛔ 候选行不许再用真 :disabled（用了就会收起下拉）')
  // 50% / 999px radii need corner-shape: round or the global superellipse distorts them.
  assert.equal((css.match(/border-radius:\s*(?:50%|999px)/g) ?? []).length, (css.match(/corner-shape:\s*round/g) ?? []).length)
  // bg-skeleton is only 4% in light theme; the official pattern pairs it with a breathing animation.
  assert.match(css, /\.capital-watchlist-skeleton[^}]*animation:/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^@]*\.capital-watchlist-skeleton \{ animation: none/)
  const literals = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  assert.deepEqual([...new Set(literals)].sort(), ['#17a063', '#d1493f'], `面板 CSS 里出现了新的颜色字面量：${literals}`)
  assert.equal(literals.length, 2)
})

test('输入 → 下拉候选：整行就是"添加"，已在清单的那条标已添加并禁用；点框外收起', async () => {
  const candidates = [
    { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', in_list: false },
    { thscode: '000905.SH', ticker: '000905', name: '中证500', exchange: 'SH', asset_type: 'a-share-index', in_list: true },
  ]
  const calls = []
  const { ctx } = mount({
    fetch: async (url) => {
      calls.push(String(url))
      return { ok: true, status: 200, text: async () => (String(url).includes('/search') ? `{"ok":true,"items":${JSON.stringify(candidates)},"truncated":false}` : '{"ok":true,"items":[]}') }
    },
  })
  const injected = ctx.registrations[0].declaration.inject('s-dropdown')
  const surface = injected.surface
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  surface.open()
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(classNodes(render(), 'capital-watchlist-dropdown').length, 0, '空输入不挂下拉')

  surface.onQueryChange('宁德')
  assert.equal(injected.hooks.dialog.getSnapshot().dropdownOpen, true, '有输入才展开下拉')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  let tree = render()
  assert.equal(classNodes(tree, 'capital-watchlist-option').length, 2, '候选两条，一行一条')
  const text = textOf(tree)
  assert.match(text, /宁德时代/)
  assert.match(text, /已添加/, '已在清单的候选标已添加（幂等，不重复写库）')
  assert.equal(classNodes(tree, 'capital-watchlist-option')[1].props['aria-disabled'], true, '已添加那条整行不可点（⛔ 用 aria-disabled：真 disabled 会把焦点踢到 body ⇒ onBlur 判点到框外、收起下拉）')
  assert.equal(classNodes(tree, 'capital-watchlist-option')[0].props['aria-disabled'], false)
  // The dark-theme stroke is flipped by the host [data-menu-material] rule; without the attribute the menu keeps an invisible l1 edge.
  assert.equal(classNodes(tree, 'capital-watchlist-dropdown')[0].props['data-menu-material'], 'translucent', '下拉要挂官方半透明菜单材质属性')

  // ⛔ After picking a candidate the dropdown stays open and the query stays: closing would force retyping for the next symbol.
  classNodes(tree, 'capital-watchlist-option')[0].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(calls.some((url) => url.includes('/add')), `点候选要走 /add（实际请求：${calls.join(' ')}）`)
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  tree = render()
  assert.equal(injected.hooks.dialog.getSnapshot().dropdownOpen, true, '⛔ 添加完下拉还开着：不然"连续添加"根本无从谈起')
  assert.equal(injected.hooks.dialog.getSnapshot().query, '宁德', '输入框里的词不动（同一个词也因此不会被重发）')
  assert.equal(classNodes(tree, 'capital-watchlist-option')[0].props['aria-disabled'], true, '刚加的这条当场标已添加、不可点（幂等，点不进第二次）')

  surface.onQueryChange('宁德')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  tree = render()
  const card = classNodes(tree, 'capital-watchlist-card')[0]
  const search = classNodes(tree, 'capital-watchlist-search')[0]
  search.props.onBlur({ relatedTarget: null, currentTarget: { contains: () => false } })
  assert.equal(injected.hooks.dialog.getSnapshot().dropdownOpen, false, '焦点离开搜索段就收起下拉')
  assert.equal(injected.hooks.dialog.getSnapshot().candidates.length, 2, '收起只是折叠，不清候选')
  surface.onQueryChange('宁德')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  search.props.onBlur({ relatedTarget: 'INSIDE', currentTarget: { contains: (node) => node === 'INSIDE' } })
  assert.equal(injected.hooks.dialog.getSnapshot().dropdownOpen, true, '焦点还在搜索段内就不许收起')
  assert.equal(typeof card.props.onKeyDown, 'function', 'Esc 的归属判据挂在卡片上')
  assert.ok(classNodes(render(), 'capital-watchlist-searchicon').length === 1, '搜索框带放大镜（官方图标集）')
})

test('搜索三条闸：IME 合成期不出网、同一个词不重发、清空即归零', async () => {
  const candidate = { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', in_list: false }
  const calls = []
  const { ctx } = mount({
    fetch: async (url) => {
      calls.push(String(url))
      return { ok: true, status: 200, text: async () => (String(url).includes('/search') ? `{"ok":true,"items":[${JSON.stringify(candidate)}],"truncated":false}` : '{"ok":true,"items":[]}') }
    },
  })
  const injected = ctx.registrations[0].declaration.inject('s-throttle')
  const surface = injected.surface
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  const searches = () => calls.filter((url) => url.includes('/search')).length
  const settle = async () => { await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS)) }
  surface.patch({ open: true, loading: false })

  // Before commit the IME fires input events per letter; those fragments are neither searchable nor what the user meant.
  const input = childrenOf(classNodes(render(), 'capital-watchlist-field')[0]).find((node) => node.type === 'input')
  assert.equal(typeof input.props.onCompositionStart, 'function', '合成开始要让 surface 知道')
  assert.equal(typeof input.props.onCompositionEnd, 'function', '上屏那一刻才是查询')
  input.props.onCompositionStart()
  for (const fragment of ['n', 'ni', 'nin', 'ning']) input.props.onChange({ target: { value: fragment } })
  await settle()
  assert.equal(searches(), 0, '⛔ 合成片段一条也不许出网')
  assert.equal(injected.hooks.dialog.getSnapshot().composing, true, '合成状态住 store：下拉那句要看得见它')
  const composingHint = textOf(classNodes(render(), 'capital-watchlist-hint')[0])
  assert.match(composingHint, /输入完成后自动搜索/, '合成期那句说的是下一步，不是结果')
  assert.equal(composingHint.includes('没有匹配的标的'), false, '⛔ 没查过 ≠ 查了没有：合成期不许报「没有匹配的标的」')

  input.props.onCompositionEnd({ target: { value: '宁' } })
  assert.equal(injected.hooks.dialog.getSnapshot().composing, false, '上屏那一刻复位')
  assert.match(textOf(classNodes(render(), 'capital-watchlist-hint')[0]), /搜索中/, '防抖未到也说"搜索中"，不说"没有匹配"')
  await settle()
  assert.equal(searches(), 1, '上屏才出网，一次')

  surface.onQueryChange('宁')
  await settle()
  assert.equal(searches(), 1, '与上一次真正发出的词相同就不再出网')
  surface.onQueryChange('宁德')
  const mid = injected.hooks.dialog.getSnapshot()
  assert.equal(mid.candidates.length, 0, '⛔ 词一换，上一个词的候选立刻撤走：下拉里不许留着能被点错的那一行')
  assert.equal(mid.pendingSearch, true, '当前这个词一次回包都没有：hint 归"搜索中"，不归"没有匹配"')
  await settle()
  assert.equal(searches(), 2, '换词照发：闸只压次数，不压功能')

  let tree = render()
  assert.equal(classNodes(tree, 'capital-watchlist-clear').length, 1, '有输入才画清空键')
  const clear = classNodes(tree, 'capital-watchlist-clear')[0]
  assert.equal(clear.props.title, '清空输入')
  let prevented = false
  clear.props.onMouseDown({ preventDefault: () => { prevented = true } })
  assert.equal(prevented, true, '按下清空键不吃输入框焦点（清完接着打字）')
  let before = calls.length
  clear.props.onClick()
  await settle()
  assert.equal(calls.length, before, '清空不触发任何请求')
  const state = injected.hooks.dialog.getSnapshot()
  assert.equal(state.query, '', '清空键真的把输入抹了')
  assert.equal(state.dropdownOpen, false, '清空即收起下拉')
  assert.equal(state.candidates.length, 0, '清空把候选一起归零，不留上一次的候选')
  assert.equal(classNodes(render(), 'capital-watchlist-clear').length, 0, '空框不画清空键')

  surface.onQueryChange('宁德')
  await settle()
  assert.equal(searches(), 3, '清空后重打同一个词还得再查一次（去重只记"上一次发出去的那个词"）')

  surface.onQueryChange('   ')
  assert.equal(injected.hooks.dialog.getSnapshot().dropdownOpen, false, '只敲空格等同没输入，不挂下拉')
  await settle()
  assert.equal(searches(), 3, '空格不出网')
})

test('⛔ 输入法丢掉 compositionend：最后一个 input 事件（isComposing=false）必须把搜索解开闩', async () => {
  // Resetting on compositionend alone latched search off for good whenever an IME dropped that event, silently; isComposing on the native input event cannot be lost.
  const calls = []
  const candidate = { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', in_list: false }
  const { ctx } = mount({
    fetch: async (url) => {
      calls.push(String(url))
      return { ok: true, status: 200, text: async () => (String(url).includes('/search') ? `{"ok":true,"items":[${JSON.stringify(candidate)}],"truncated":false}` : '{"ok":true,"items":[]}') }
    },
  })
  const injected = ctx.registrations[0].declaration.inject('s-ime-lost')
  const surface = injected.surface
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  const settle = async () => { await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS)) }
  surface.patch({ open: true, loading: false })
  const input = childrenOf(classNodes(render(), 'capital-watchlist-field')[0]).find((node) => node.type === 'input')

  // compositionstart always fires; third-party IMEs can drop compositionend when a candidate is picked from their window.
  input.props.onCompositionStart()
  for (const fragment of ['ning', 'ningd', 'ningde']) input.props.onChange({ target: { value: fragment }, isComposing: true })
  await settle()
  assert.equal(calls.filter((url) => url.includes('/search')).length, 0, '合成片段照旧不出网')
  assert.equal(injected.hooks.dialog.getSnapshot().composing, true, '没上屏就还是合成期')
  assert.match(textOf(classNodes(render(), 'capital-watchlist-hint')[0]), /输入完成后自动搜索/, '合成期那句说的是下一步')

  input.props.onChange({ target: { value: '宁德时代' }, isComposing: false })
  await settle()
  assert.equal(injected.hooks.dialog.getSnapshot().composing, false, '⛔ 上屏那一下的 isComposing=false 就是复位，不需要 compositionend')
  assert.equal(calls.filter((url) => url.includes('/search')).length, 1, '⛔ 搜索没被闩死：这一下照常出网一次')
  assert.equal(injected.hooks.dialog.getSnapshot().pendingSearch, false, '回包落地就不再算"待查"')
  assert.equal(classNodes(render(), 'capital-watchlist-option').length, 1, '候选画出来了')

  // 没有匹配的标的 is only owed after a real empty reply.
  const empty = mount({ fetch: async () => ({ ok: true, status: 200, text: async () => '{"ok":true,"items":[],"truncated":false}' }) })
  const other = empty.ctx.registrations[0].declaration.inject('s-nohit')
  const otherT = (key) => (empty.ctx.dictionaries['capital.watchlist'].zh[key] ?? key)
  const otherRender = () => {
    resetHooks()
    return empty.ctx.registrations[0].component({ ...other, useDialog: (selector) => selector(other.hooks.dialog.getSnapshot()), t: otherT })
  }
  other.surface.patch({ open: true, loading: false })
  other.surface.onQueryChange('zzz')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS / 2))
  assert.equal(other.hooks.dialog.getSnapshot().pendingSearch, true, '请求还在途：此刻还没有资格说"没有匹配"')
  assert.match(textOf(classNodes(otherRender(), 'capital-watchlist-hint')[0]), /搜索中/, '在途那一段下拉说"搜索中"')
  assert.equal(textOf(otherRender()).includes('没有匹配的标的'), false, '⛔ 一次回包都没落地就报"没有匹配"，是把没查说成查了')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  assert.match(textOf(classNodes(otherRender(), 'capital-watchlist-hint')[0]), /没有匹配的标的/, '查过了、回包为空，这时才说"没有匹配"')
})

test('选中候选 = 添加完顺手整批刷一次：新行当场有价，不留「未刷新」', async () => {
  const stored = { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', added_at: 1, source: 'user', quote: null }
  const priced = { ...stored, quote: { price: 211.52, change_pct: 1.234, captured_at: 2, source_ts: 1 } }
  const candidate = { thscode: stored.thscode, ticker: stored.ticker, name: stored.name, exchange: stored.exchange, asset_type: stored.asset_type, in_list: false }
  const calls = []
  let inStore = false
  const { ctx } = mount({
    fetch: async (url) => {
      const path = String(url).split('?')[0].replace('/capital-watchlist', '').split('?')[0]
      calls.push(path)
      if (path.includes('/search')) return { ok: true, status: 200, text: async () => `{"ok":true,"items":[${JSON.stringify(candidate)}],"truncated":false}` }
      if (path.includes('/add')) {
        inStore = true
        return { ok: true, status: 200, text: async () => '{"ok":true}' }
      }
      if (path.includes('/refresh')) {
        return { ok: true, status: 200, text: async () => (inStore ? `{"ok":true,"items":[${JSON.stringify(priced)}],"refreshed_at":2,"failures":[]}` : '{"ok":true,"items":[],"refreshed_at":2,"failures":[]}') }
      }
      return { ok: true, status: 200, text: async () => (inStore ? `{"ok":true,"items":[${JSON.stringify(stored)}],"seeded_at":1}` : '{"ok":true,"items":[]}') }
    },
  })
  const injected = ctx.registrations[0].declaration.inject('s-addrefresh')
  const surface = injected.surface
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  surface.open()
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  surface.onQueryChange('宁德时代')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))

  classNodes(render(), 'capital-watchlist-option')[0].props.onClick()
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(calls, ['/list', '/refresh', '/search', '/add', '/list', '/refresh'],
    `添加之后的出网顺序必须是"再读清单 + 整批刷报价"（实际：${calls.join(' ')}）`)
  const row = classNodes(render(), 'capital-watchlist-row')[0]
  const quoted = textOf(childrenOf(row))
  assert.match(quoted, /211\.52/, '新行当场就有最新价')
  assert.match(quoted, /\+1\.23%/, '涨跌幅也有（红涨）')
  assert.equal(quoted.includes('未刷新'), false, '⛔ 刚加进来的标的不能停在「未刷新」')
})

test('删除二次确认：行内「更多」→ 移除只出确认层，确认才打 /remove，取消不打', async () => {
  const row = { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', added_at: 1, source: 'user', quote: null }
  const calls = []
  const { ctx } = mount({ fetch: async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => (String(url).includes('/list') ? `{"ok":true,"items":[${JSON.stringify(row)}],"seeded_at":1}` : `{"ok":true,"items":[${JSON.stringify(row)}],"refreshed_at":1,"failures":[]}`) } } })
  const injected = ctx.registrations[0].declaration.inject('s-confirm')
  const surface = injected.surface
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  surface.open()
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))

  let tree = render()
  const more = moreButtonAt(tree)
  assert.equal(more.props['aria-label'], '更多 宁德时代', '行内按钮的可达名点名标的')
  assert.equal(more.props.className, 'capital-watchlist-more', '行内键从 trash 换成省略号')

  more.props.onClick()
  tree = render()
  const menu = menuNodes(tree)[0]
  assert.equal(menu.props.open, true, '点「更多」展开这一行的菜单')
  assert.deepEqual([...menu.props.items].map((entry) => entry.id), ['pin'], '数据行只有「置顶」：持仓那一簇得住 children（它要带键，也不能顺手收这张菜单）')
  assert.equal(menu.props.items[0].disabled, true, '只有一行时「置顶」没有位移，置灰')
  assert.equal(menu.props.selectedIds, undefined, '持仓态不借官方那道尾勾：它是那颗开关的 aria-checked')
  const checkrow = checkRow(tree)
  assert.equal(checkrow.type, 'div', '⛔ 行本身不可点：标记与取消只能碰那颗开关')
  assert.equal(checkrow.props.role, 'group', '行是 group（menu 允许的合法子角色），那颗 switch 挂在它里面')
  assert.equal(checkrow.props['aria-label'], '持仓')
  assert.equal(iconOf(classNodes(menu.props.children, 'capital-watchlist-checkicon')[0]), 'IconDatabaseOutlineRegular',
    '行首是 Database 那一摞圆盘（24 支候选画成真实 SVG 比过；官方集里没有钱包/饼图/公文包/硬币，也不许退回画着勾的 CheckCircle）')
  assert.equal(textOf(checkLabel(tree)).trim(), '持仓', '行标签就两个字（用户点名"标记持仓改成持仓"）')
  const toggle = holdingSwitch(tree)
  assert.equal(toggle.props.checked, false, '默认关')
  assert.equal(toggle.props.label, '持仓', '开关的可达名与行标签同一个词（字典里只有一个 key）')
  assert.equal(toggle.props.disabled, false)
  const remove = removeRow(tree)
  assert.ok(remove, '「移除」是菜单里的官方组件行（MenuItemButton），不是第三条数据行')
  assert.equal(remove.props.danger, true, '「移除」是破坏性行（danger）')
  assert.equal(remove.props.separatorBefore, true, '⛔ 移除与持仓那一簇之间必须有一根发丝线（2026-10-09 用户点名：太近会点错）')
  assert.equal(textOf(remove).trim(), '移除')
  assert.equal(menuChildren(tree).length, 2, '未标记时 children 是持仓行 + 移除（没有比例行）')
  assert.deepEqual(calls.filter((url) => url.includes('/remove') || url.includes('/pin') || url.includes('/holding')), [], '只展开菜单，一个请求都不许发')

  moreButtonAt(render()).props.onClick()
  assert.equal(injected.hooks.dialog.getSnapshot().rowMenu, null, '再点「更多」收起菜单')

  tree = removeViaMenu(render)
  const confirm = classNodes(tree, 'capital-watchlist-confirm')[0]
  assert.ok(confirm.props.className.includes('capital-watchlist-confirm-open'), '选移除只展开确认层')
  assert.match(textOf(confirm), /宁德时代 · 300750/, '确认文案带上被移除的那一条（名称 + 代码）')
  assert.equal(injected.hooks.dialog.getSnapshot().rowMenu, null, '确认层展开时菜单已收起')
  assert.deepEqual(calls.filter((url) => url.includes('/remove')), [], '确认层展开时一次 /remove 都不许发')

  // Esc belongs to the confirm layer - the host Modal's document listener never sees the event.
  let stopped = false
  classNodes(tree, 'capital-watchlist-card')[0].props.onKeyDown({ key: 'Escape', stopPropagation: () => { stopped = true } })
  assert.equal(stopped, true, '确认层开着时 Esc 必须被截住')
  tree = render()
  assert.equal(classNodes(tree, 'capital-watchlist-confirm')[0].props.className.includes('capital-watchlist-confirm-open'), false, 'Esc 关掉确认层')
  assert.equal(injected.hooks.dialog.getSnapshot().open, true, '弹窗本体还开着')

  classNodes(removeViaMenu(render), 'capital-watchlist-confirmbtn').filter((n) => n.props.className.includes('confirmdanger') === false)[0].props.onClick()
  assert.deepEqual(calls.filter((url) => url.includes('/remove')), [], '取消一个请求都不发')

  // Confirm calls /remove (optimistic; surface.remove rolls back on failure).
  removeViaMenu(render)
  classNodes(render(), 'capital-watchlist-confirmdanger')[0].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.filter((url) => url.includes('/remove')).length, 1, '确认那一下才真删')
  assert.equal(classNodes(render(), 'capital-watchlist-confirm')[0].props.className.includes('capital-watchlist-confirm-open'), false, '确认后收起确认层')
})
test('⛔ 确认层开着时关掉面板：重开必须是干净清单，不是上一轮的「确认移除」', async () => {
  // Close keeps the component mounted (return null), so pendingRemove must live in the store: a stale one reopens as a confirm over a symbol the user never touched.
  const row = { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', added_at: 1, source: 'user', quote: null }
  const calls = []
  const { ctx } = mount({ fetch: async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => `{"ok":true,"items":[${JSON.stringify(row)}],"seeded_at":1,"refreshed_at":1,"failures":[]}` } } })
  const injected = ctx.registrations[0].declaration.inject('s-confirm-reopen')
  const surface = injected.surface
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  const settle = async () => { for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0)) }

  surface.open()
  await settle()
  removeViaMenu(render)
  assert.ok(classNodes(render(), 'capital-watchlist-confirm')[0].props.className.includes('capital-watchlist-confirm-open'), '确认层开着')

  surface.close() // 点遮罩 / 宿主 Modal 的 onClose 走的就是这一条
  surface.open()
  await settle()

  const tree = render()
  assert.equal(classNodes(tree, 'capital-watchlist-confirm')[0].props.className.includes('capital-watchlist-confirm-open'), false,
    '⛔ 重开时确认层必须收起——它带着上一轮那一行开着，就是在诱导用户删错东西')
  assert.equal(injected.hooks.dialog.getSnapshot().pendingRemove, null, '待移除那一行必须随开合归零')
  classNodes(tree, 'capital-watchlist-confirmdanger')[0].props.onClick()
  await settle()
  assert.deepEqual(calls.filter((url) => url.includes('/remove')), [], '残留的确认键就算被点到，也不许发出 /remove')
})

test('⛔ 首刷还在途时点候选：新行不许停在「未刷新」', async () => {
  // The single refresh gate hands out the in-flight promise, and that batch was fetched for the previous row set - the new row would sit at 未刷新 under a footer claiming a fresh time.
  const stored = { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', added_at: 1, source: 'user', quote: null }
  const priced = { ...stored, quote: { price: 211.52, change_pct: 1.234, captured_at: 2, source_ts: 1 } }
  const candidate = { thscode: stored.thscode, ticker: stored.ticker, name: stored.name, exchange: stored.exchange, asset_type: stored.asset_type, in_list: false }
  const calls = []
  let inStore = false
  let refreshes = 0
  // Hold the first refresh on a manual gate: with a 300ms debounce a timing gap tests latency, not the collapse.
  let releaseFirst
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })
  const { ctx } = mount({
    fetch: async (url) => {
      const path = String(url).split('?')[0].replace('/capital-watchlist', '')
      calls.push(path)
      if (path.includes('/search')) return { ok: true, status: 200, text: async () => `{"ok":true,"items":[${JSON.stringify(candidate)}],"truncated":false}` }
      if (path.includes('/add')) {
        inStore = true
        return { ok: true, status: 200, text: async () => '{"ok":true}' }
      }
      if (path.includes('/refresh')) {
        refreshes += 1
        // First refresh lands after /add: the reply contains the new row but never asked for it - quote null and absent from failures.
        if (refreshes === 1) {
          await firstGate
          return { ok: true, status: 200, text: async () => (inStore ? `{"ok":true,"items":[${JSON.stringify(stored)}],"refreshed_at":2,"failures":[]}` : '{"ok":true,"items":[],"refreshed_at":2,"failures":[]}') }
        }
        return { ok: true, status: 200, text: async () => `{"ok":true,"items":[${JSON.stringify(priced)}],"refreshed_at":3,"failures":[]}` }
      }
      return { ok: true, status: 200, text: async () => (inStore ? `{"ok":true,"items":[${JSON.stringify(stored)}],"seeded_at":1}` : '{"ok":true,"items":[]}') }
    },
  })
  const injected = ctx.registrations[0].declaration.inject('s-add-while-refreshing')
  const surface = injected.surface
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }

  surface.open()
  for (let round = 0; round < 3; round += 1) await new Promise((resolve) => setTimeout(resolve, 0)) // 首刷起飞、卡在闸门外
  surface.onQueryChange('宁德时代')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  classNodes(render(), 'capital-watchlist-option')[0].props.onClick() // 添加落在首刷的在途窗口里
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  releaseFirst() // 首刷此刻才落地：它的回包里新行报价为 null
  for (let round = 0; round < 30; round += 1) await new Promise((resolve) => setTimeout(resolve, 5))

  // The point is order, not count: without the follow-up the only refresh predates /add.
  assert.ok(refreshes >= 2, `添加之后必须补发一次刷新（实际 /refresh 次数 ${refreshes}）`)
  assert.ok(calls.lastIndexOf('/refresh') > calls.indexOf('/add'),
    `⛔ 最后一次 /refresh 必须排在 /add 之后（实际顺序：${calls.join(' ')}）`)
  const quoted = textOf(childrenOf(classNodes(render(), 'capital-watchlist-row')[0]))
  assert.match(quoted, /211\.52/, '新行当场就有最新价')
  assert.equal(quoted.includes('未刷新'), false, '⛔ 刚加进来的标的不能停在「未刷新」')
})

test('⛔ 添加已经落库之后清单读不回来：不许报成「添加失败」，也不许再点一次', async () => {
  // One try block let a post-add /list failure print an add-failure line, telling the user to retry an add that had already landed.
  const stored = { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', added_at: 1, source: 'user', quote: null }
  const candidate = { thscode: stored.thscode, ticker: stored.ticker, name: stored.name, exchange: stored.exchange, asset_type: stored.asset_type, in_list: false }
  const calls = []
  let added = false
  const { ctx } = mount({
    fetch: async (url) => {
      const path = String(url).split('?')[0].replace('/capital-watchlist', '')
      calls.push(path)
      if (path.includes('/search')) return { ok: true, status: 200, text: async () => `{"ok":true,"items":[${JSON.stringify(candidate)}],"truncated":false}` }
      if (path.includes('/add')) {
        added = true
        return { ok: true, status: 200, text: async () => '{"ok":true}' }
      }
      // Everything after /add fails: the domain is temporarily unavailable.
      return { ok: false, status: 503, text: async () => '{"ok":false,"code":"store_unavailable","message":"x"}' }
    },
  })
  const injected = ctx.registrations[0].declaration.inject('s-add-then-list-fails')
  const surface = injected.surface
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key

  surface.patch({ open: true, loading: false })
  await surface.add(candidate)
  const state = injected.hooks.dialog.getSnapshot()
  assert.equal(added, true, '这一次 /add 是真成功')
  assert.equal(state.addError, null, '⛔ 添加成功之后的读失败不许写进"添加"那一格（那句话会教用户再点一次）')
  assert.equal(state.loadError.code, 'store_unavailable', '读清单的失败有自己的位置')
  assert.equal(state.error.code, 'store_unavailable', '刷报价的失败走页脚那条红字')
  assert.equal(calls.filter((path) => path.includes('/add')).length, 1, '一次添加只有一次 /add')

  resetHooks()
  const tree = ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(state), t })
  assert.equal(classNodes(tree, 'capital-watchlist-adderror').length, 0, '面板上不画"添加失败"那一句')
  assert.match(textOf(classNodes(tree, 'capital-watchlist-loaderror')[0]), /自选股存储不可用/)
})

test('置顶：菜单选「置顶」把该行提到第一行（乐观 + /pin），失败回滚', async () => {
  const first = { thscode: '000001.SH', ticker: '000001', name: '上证指数', exchange: 'SH', asset_type: 'a-share-index', added_at: 1, source: 'seed', quote: null }
  const second = { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', added_at: 2, source: 'user', quote: null }
  const calls = []
  let pinFails = false
  const { ctx } = mount({
    fetch: async (url) => {
      const target = String(url)
      if (target.includes('/pin')) {
        calls.push('/pin')
        if (pinFails) return { ok: false, status: 503, text: async () => '{"ok":false,"code":"store_unavailable","message":"x"}' }
        return { ok: true, status: 200, text: async () => `{"ok":true,"items":[${JSON.stringify({ ...second, pinned_at: 9 })},${JSON.stringify(first)}]}` }
      }
      if (target.includes('/list')) return { ok: true, status: 200, text: async () => `{"ok":true,"items":[${JSON.stringify(first)},${JSON.stringify(second)}],"seeded_at":1}` }
      return { ok: true, status: 200, text: async () => `{"ok":true,"items":[${JSON.stringify(first)},${JSON.stringify(second)}],"refreshed_at":1,"failures":[]}` }
    },
  })
  const injected = ctx.registrations[0].declaration.inject('s-pin')
  const surface = injected.surface
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  // ⚠️ items come from JSON.parse inside the vm (cross-realm): copy out before deepEqual.
  const codes = () => [...injected.hooks.dialog.getSnapshot().items.map((row) => row.thscode)]
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  surface.open()
  for (let round = 0; round < 5; round += 1) await settle()

  let tree = render()
  assert.deepEqual(menuNodes(tree).map((menu) => menu.props.open), [false, false], '初始两行的菜单都收着')
  assert.equal(menuNodes(tree)[0].props.items[0].disabled, true, '第一行的「置顶」置灰')
  assert.equal(menuNodes(tree)[1].props.items[0].disabled, false, '第二行可以置顶')
  // ⛔ Index rows have no holding switch at all: row 0 is a-share-index, row 1 an A-share, so this is the shape of that gate.
  assert.equal(menuNodes(tree)[0].props.items.length, 1, '两行的数据行都只有「置顶」（持仓行不住在这儿）')
  assert.equal(checkRow(tree, 0), undefined, '指数行没有持仓行')
  assert.equal(checkRow(tree, 1).type, 'div', '个股行有，且整行不可点（只有那颗开关改状态）')

  tree = selectFromMenu(render, 'pin', 1)
  await settle()
  assert.deepEqual(calls, ['/pin'], `置顶只打一次 /pin（实际：${calls.join(' ')}）`)
  assert.deepEqual(codes(), ['300750.SZ', '000001.SH'], '置顶的行到了第一行')
  assert.equal(injected.hooks.dialog.getSnapshot().rowMenu, null, '选中后菜单收起')
  assert.equal(menuNodes(tree)[0].props.items[0].disabled, true, '新的第一行「置顶」置灰')
  assert.equal(menuNodes(tree)[1].props.items[0].disabled, false)

  // Rollback follows the remove contract: order returns to the pre-click state.
  pinFails = true
  const before = codes()
  selectFromMenu(render, 'pin', 1)
  await settle()
  assert.deepEqual(codes(), before, '写入失败时顺序回滚到点击前')
})

test('刷新中价格是 skeleton，不是「未刷新」也不是 —', async () => {
  const row = { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', added_at: 1, source: 'user', quote: null }
  const { ctx } = mount({
    fetch: async (url) => ({
      ok: true,
      status: 200,
      text: async () => (String(url).includes('/refresh')
        ? `{"ok":true,"items":[${JSON.stringify(row)}],"refreshed_at":1790589000000,"failures":[]}`
        : `{"ok":true,"items":[${JSON.stringify(row)}],"seeded_at":1}`),
    }),
  })
  const injected = ctx.registrations[0].declaration.inject('s-skeleton')
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  // Park on list-arrived / quotes-in-flight (open()'s two steps): refreshing=true with quote=null.
  injected.surface.patch({ open: true, loading: false, refreshing: true, items: [row], failures: {} })
  const tree = (() => { resetHooks(); return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t }) })()
  assert.equal(classNodes(tree, 'capital-watchlist-skeleton').length, 2, '价格与涨跌幅各一条 skeleton')
  // The footer may read 未刷新 when the batch never refreshed; the price cell must not.
  const quoteCell = classNodes(tree, 'capital-watchlist-row')[0]
  assert.equal(textOf(childrenOf(quoteCell)).includes('未刷新'), false, '在途时不许把 skeleton 写成"未刷新"')
  assert.equal(moreButtonAt(tree).props.disabled, false, '刷新在途不影响行内「更多」键')
})

test('行内「预测」与「复盘」：各追加自己那句话、不发送、不替换草稿；没插成功就不收面板', () => {
  const inserted = []
  let place = true
  const inputActions = {
    // Standard inputActions for session-scope seats: captureInsertion yields the revision-tagged cursor, insertText writes into the Lexical editor. setDraft / submit being called here is a bug.
    captureInsertion: () => ({ start: 4, end: 4, draftRev: 7 }),
    insertText: (text, span) => { inserted.push({ text, span }); return place },
    setDraft: () => { throw new Error('⛔ 行内动作不许整段替换用户已经敲了一半的草稿') },
    submit: () => { throw new Error('⛔ 行内动作不许替用户发送') },
  }
  const { ctx } = mount({ fetch: async () => ({ ok: true, status: 200, text: async () => `{"ok":true,"items":[${JSON.stringify(QUOTED)}],"seeded_at":1}` }) })
  const injected = ctx.registrations[0].declaration.inject('s-review')
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const open = () => injected.surface.patch({ open: true, loading: false, items: [QUOTED] })
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t, inputActions })
  }
  const rowOf = (tree) => classNodes(tree, 'capital-watchlist-row')[0]
  const buttonIn = (tree, name) => classNodes(rowOf(tree), name)[0]
  open()

  // Document order is the Tab order. ⛔ Collect in one walk: looking names up one by one yields the name list itself and can never fail.
  const WATCH = ['capital-watchlist-namewrap', 'capital-watchlist-quote', 'capital-watchlist-rowactions', 'capital-watchlist-predict', 'capital-watchlist-review', 'capital-watchlist-actions']
  const order = []
  walkNodes(rowOf(render()), (node) => {
    const classes = typeof node.props?.className === 'string' ? node.props.className.split(' ') : []
    const hit = classes.find((name) => WATCH.includes(name))
    if (hit !== undefined) order.push(hit)
  })
  assert.deepEqual(order, ['capital-watchlist-namewrap', 'capital-watchlist-quote', 'capital-watchlist-rowactions', 'capital-watchlist-predict', 'capital-watchlist-review', 'capital-watchlist-actions'])
  // Head and rows are separate grids, so only fixed-px columns keep their edges aligned.
  assert.match(mountedCss(), /grid-template-columns: 1fr 92px 84px/, '两枚图标键 + 「更多」挤进最后一列，宽度跟着内容定死')
  assert.match(mountedCss(), /\.capital-watchlist-rowactions \{[^}]*justify-content: flex-end/, '动作簇贴右缘：表头「操作」与它同一条边线')
  assert.match(mountedCss(), /\.capital-watchlist-namewrap \{[^}]*min-width: 0/, '名称格必须能收缩：长名称靠 ellipsis 兜，不许顶宽列')
  assert.equal(mountedCss().includes('capital-watchlist-nameline'), false, '动作挪走之后 nameline 就是死样式：留着等于面板上多一个没人渲染的类')
  assert.match(mountedCss(), /\.capital-watchlist-review, \.capital-watchlist-predict \{[^}]*background: transparent/, '图标键与「更多」同笔：透明底、无描边')
  // ⛔ Iconised means no visible words: the text may live only in title and aria-label.
  for (const name of ['capital-watchlist-predict', 'capital-watchlist-review']) {
    const words = childrenOf(buttonIn(render(), name)).filter((child) => typeof child === 'string')
    assert.deepEqual(words, [], `${name} 的可见内容必须是图标，不是字`)
  }
  assert.equal(iconOf(buttonIn(render(), 'capital-watchlist-predict')), 'IconGoalOutlineRegular', '预测 = 靶心')
  assert.equal(iconOf(buttonIn(render(), 'capital-watchlist-review')), 'IconListPenOutlineRegular', '复盘 = 带笔的清单')
  assert.equal(iconOf(moreButtonAt(render())), 'IconEllipsisOutlineRegular', '「更多」仍是省略号')
  assert.equal(buttonIn(render(), 'capital-watchlist-predict').props.disabled, false, '两枚按钮都可用')

  // Take the button before clicking: success closes the panel and the component returns null.
  const predictButton = buttonIn(render(), 'capital-watchlist-predict')
  assert.equal(predictButton.props.title, zh.predictTip, 'tooltip 走字典：图标化之后，这一句就是它唯一的说明')
  assert.equal(predictButton.props['aria-label'], `${zh.predict} ${QUOTED.name}`, '读屏标签 = 动作 + 标的名')
  predictButton.props.onClick()
  assert.equal(inserted.length, 1)
  // Wording belongs to the dictionary (<kind>PromptPrefix / <kind>PromptSuffix); this pins only the shape: name (thscode + kind).
  assert.equal(inserted[0].text, `${zh.predictPromptPrefix}深证成指 (399001.SZ · ${zh.kindIndex})${zh.predictPromptSuffix}`)
  assert.match(inserted[0].text, /399001\.SZ/, 'thscode 必须在句子里：Agent 靠它认标的')
  assert.match(inserted[0].text, new RegExp(`· ${zh.kindIndex}\\)`), '⛔ 句子中间是**品种**那一族，不是徽标的市场词：Agent 靠它选端点（股票 / 指数 / 场内基金是三个上游），市场由 thscode 自己带')
  assert.deepEqual(inserted[0].span, { start: 4, end: 4, draftRev: 7 }, 'captureInsertion 的 span 必须原样交回（revision 守卫在官方那边）')
  assert.equal(injected.hooks.dialog.getSnapshot().open, false, '写进去了就收面板，让用户在输入框里看这句话、自己点发送')

  open()
  const reviewButton = buttonIn(render(), 'capital-watchlist-review')
  assert.equal(reviewButton.props.title, zh.reviewTip, '复盘的 tooltip 也走字典')
  assert.equal(reviewButton.props['aria-label'], `${zh.review} ${QUOTED.name}`, '读屏标签 = 动作 + 标的名')
  reviewButton.props.onClick()
  assert.equal(inserted.length, 2)
  assert.equal(inserted[1].text, `${zh.reviewPromptPrefix}深证成指 (399001.SZ · ${zh.kindIndex})${zh.reviewPromptSuffix}`)
  assert.notEqual(inserted[1].text, inserted[0].text, '⛔ 预测与复盘不许插同一句话')
  assert.equal(injected.hooks.dialog.getSnapshot().open, false)

  // Insert refused (draft changed or editor locked): keep the panel open so the click stays visible and repeatable.
  open()
  place = false
  buttonIn(render(), 'capital-watchlist-review').props.onClick()
  assert.equal(inserted.length, 3)
  assert.equal(injected.hooks.dialog.getSnapshot().open, true, '⛔ 没插成功不许收面板——那等于悄悄丢掉用户这一下')
})

test('⛔ 客户端不碰被禁的通道：turn-tail 卡片、自造会话事件、报告旁路、typed remote', () => {
  for (const forbidden of ['turnTail', 'capital/chart-rendered', 'capital-reports', 'final_report', 'deliverables/presented', 'dsh-api-remotes', 'ctx.remote']) {
    assert.equal(source.includes(forbidden), false, `客户端不应出现 ${forbidden}`)
  }
})

/** Display normalisation (design §5 / R9): currency follows money only, so an index row fed a real currency reply must render no cell at all. */
const MARKET_ROWS = [
  { thscode: '00700.HK', ticker: '00700', name: '腾讯控股', exchange: 'HK', asset_type: 'hk-stock', added_at: 1, source: 'user', quote: { price: 420.8, change_pct: -1.73, captured_at: 1790589000000, source_ts: null, source_time: '2026-10-07 14:06:13', currency: 'HKD' } },
  { thscode: '80700.HK', ticker: '80700', name: '腾讯控股r', exchange: 'HK', asset_type: 'hk-stock', added_at: 1, source: 'user', quote: { price: 359.4, change_pct: -1.53, captured_at: 1790589000000, source_ts: null, source_time: '2026-10-07 14:03:39', currency: 'CNY' } },
  { thscode: 'AAPL.OQ', ticker: 'AAPL', name: '苹果', exchange: 'US', asset_type: 'us-stock', added_at: 1, source: 'user', quote: { price: 333.63, change_pct: 0.22, captured_at: 1790589000000, source_ts: null, source_time: '2026-10-06 16:00:01', currency: 'USD' } },
  { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', added_at: 1, source: 'user', quote: { price: 291.99, change_pct: -0.51, captured_at: 1790589000000, source_ts: 1790586416000, currency: 'CNY' } },
  { thscode: '510300.SH', ticker: '510300', name: '沪深300ETF', exchange: 'SH', asset_type: 'fund-etf', added_at: 1, source: 'user', quote: { price: 4.417, change_pct: -2.17, captured_at: 1790589000000, source_ts: 1790586418000, currency: 'CNY' } },
  // Both index rows carry an upstream currency (HKD / USD): neither may draw it.
  { thscode: 'HSI.HK', ticker: 'HSI', name: '恒生指数', exchange: 'HK', asset_type: 'hk-index', added_at: 1, source: 'seed', quote: { price: 24163.05, change_pct: -0.48, captured_at: 1790589000000, source_ts: null, source_time: '2026-10-07 14:06:21', currency: 'HKD' } },
  { thscode: 'IXIC.US', ticker: 'IXIC', name: '纳斯达克', exchange: 'US', asset_type: 'us-index', added_at: 1, source: 'seed', quote: { price: 27599.89, change_pct: 0.45, captured_at: 1790589000000, source_ts: null, source_time: '2026-10-06 18:34:12', currency: 'USD' } },
]

function mountRows(rows, key) {
  const body = `{"ok":true,"items":${JSON.stringify(rows)},"seeded_at":1}`
  const { ctx } = mount({ fetch: async () => ({ ok: true, status: 200, text: async () => body }) })
  const injected = ctx.registrations[0].declaration.inject(key)
  injected.surface.open()
  return { ctx, injected }
}

test('⛔ 面板不画币种（喂带 HKD / USD / CNY 的回包），三市徽标各一色', async () => {
  const { ctx, injected } = mountRows(MARKET_ROWS, 's-currency')
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  resetHooks()
  const tree = ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })

  // Currency is still stored (watchlist-quote cases own that); this pins only that the panel shows none.
  assert.equal(classNodes(tree, 'capital-watchlist-currency').length, 0, '⛔ 一个币种格都不许有（个股、ETF、指数都没有）')
  const drawn = textOf(tree)
  for (const marker of ['HKD', 'USD', 'CNY', '¥', '$']) {
    assert.equal(drawn.includes(marker), false, `面板上不许出现 ${marker}：币种由用户按市场读，不由面板标注`)
  }
  assert.equal(drawn.includes('24163.05'), true, '点位照画')
  assert.equal(drawn.includes('420.80'), true, '价格照画——去掉币种不等于去掉报价')

  assert.equal(classNodes(tree, 'capital-watchlist-tag-cn').length, 2, 'A股 + 场内 ETF 同属 A 股那一档（ETF 的报价就是二级市场价格）')
  assert.equal(classNodes(tree, 'capital-watchlist-tag-hk').length, 3, '两只港股个股 + 恒生指数共用港那一档')
  assert.equal(classNodes(tree, 'capital-watchlist-tag-us').length, 2, '一只美股个股 + 纳斯达克共用美那一档')
  for (const label of ['港股', '美股', 'A股', '港指', '美指']) {
    assert.ok(drawn.includes(label), `徽标文字要落字：${label}`)
  }
  assert.equal(classNodes(tree, 'capital-watchlist-tag').some((node) => textOf(node).includes('ETF')), false,
    '⛔ ETF 不再是一档徽标：它并进 A股，品种那一层只进递进输入框那句话（那行名字里本来就带 ETF，所以判据只看徽标节点）')

  // The three tints must come from three different state-* families; the hex values themselves belong to the theme package.
  const css = readFileSync(new URL('../watchlist/client.src.cjs', import.meta.url), 'utf8')
  const families = ['cn', 'hk', 'us'].map((market) => {
    const rule = css.split('\n').find((line) => line.startsWith('.capital-watchlist-tag-' + market + ' {'))
    assert.ok(rule, '底色规则 .capital-watchlist-tag-' + market + ' 不见了（徽标会退化成没有底的字）')
    const family = /state-([a-z]+)-(?:primary|label|tertiary)/u.exec(rule)
    assert.ok(family, '.capital-watchlist-tag-' + market + ' 没走 state-* token：自造色值要过颜色字面量白名单那道闸门')
    return family[1]
  })
  assert.deepEqual(families, ['error', 'warn', 'success'], 'A=error(红) / 港=warn(琥珀) / 美=success(绿)')
  assert.equal(new Set(families).size, 3, '⛔ 三个市场三个色族：撞族就是用户点名的那一症')
})

test('交易所当地时间进 tooltip，A 股那一路不画这一句（没有就不编）', async () => {
  const { ctx, injected } = mountRows(MARKET_ROWS, 's-exchange-time')
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  resetHooks()
  const tree = ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  const quotes = classNodes(tree, 'capital-watchlist-quote')
  const titles = quotes.map((node) => node.props.title ?? '')
  assert.ok(titles.some((title) => title.includes('交易所时间 2026-10-06 16:00:01')), '美股行说得出美东那个时刻')
  assert.ok(titles.some((title) => title.includes('交易所时间 2026-10-07 14:06:13')), '港股行说得出 HKT 那个时刻')
  assert.equal(titles.filter((title) => title.includes('交易所时间')).length, 5,
    '⛔ 只有带 source_time 的行画这一句：A 股那两路（个股 / ETF）没有原串，不换算、不编一句')
  assert.equal(titles.some((title) => /T.*[+-]\d\d:\d\d/.test(title)), false, '不许把当地时间改写成带时区偏移的样子（那是换算）')
})

test('候选行画完整 canonical 代码：`00700.HK` 与 `000700.SZ` 并列时用户点得对', async () => {
  const candidates = [
    { thscode: '00700.HK', ticker: '00700', name: '腾讯控股', exchange: 'HK', asset_type: 'hk-stock', in_list: false },
    { thscode: '000700.SZ', ticker: '000700', name: '模塑科技', exchange: 'SZ', asset_type: 'a-share', in_list: true },
    { thscode: 'TCEHY.PS', ticker: 'TCEHY', name: '腾讯控股(ADR)', exchange: 'US', asset_type: 'us-stock', in_list: false },
    { thscode: 'HSI.HK', ticker: 'HSI', name: '恒生指数', exchange: 'HK', asset_type: 'hk-index', in_list: false },
  ]
  const { ctx } = mount({
    fetch: async (url) => ({ ok: true, status: 200, text: async () => (String(url).includes('/search') ? `{"ok":true,"items":${JSON.stringify(candidates)},"truncated":false}` : '{"ok":true,"items":[]}') }),
  })
  const injected = ctx.registrations[0].declaration.inject('s-candcode')
  const surface = injected.surface
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  surface.open()
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  surface.onQueryChange('00700')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  const tree = render()
  // ⛔ Root-cause regression: real disabled on an option row throws focus to body, onBlur reads relatedTarget null as a click outside and closes the dropdown.
  for (const row of classNodes(tree, 'capital-watchlist-option')) {
    assert.equal(row.props.disabled, undefined, '⛔ 候选行不许用真 disabled：它会踢掉焦点 → onBlur 收起下拉')
  }
  const codes = classNodes(tree, 'capital-watchlist-optioncode').map((node) => textOf(node).trim())
  assert.deepEqual(codes, ['00700.HK', '000700.SZ', 'TCEHY.PS', 'HSI.HK'],
    '⛔ 第二行是完整 canonical 代码，不是裸 ticker：搜「恒生指数」会同时回 HSI / HSIGTR / HSINTR 三条真指数，只有代码列能核对')
  assert.deepEqual(classNodes(tree, 'capital-watchlist-tag').map((node) => textOf(node).trim()), ['港股', 'A股', '美股', '港指'],
    '徽标贴在代码右边，与自选股清单第一列同一套排法')
  assert.deepEqual(classNodes(tree, 'capital-watchlist-addbtn').map((node) => textOf(node).trim()), ['添加', '已添加', '添加', '添加'],
    '⛔ 右侧是动词胶囊：在清单里那条写「已添加」——「已添加」不再塞进代码行（代码 + 徽标才是第二行要读的两样）')
  // Title is the full security name: CSS truncates long US names, only the native tooltip gives them whole.
  assert.deepEqual(classNodes(tree, 'capital-watchlist-option').map((node) => node.props.title), ['腾讯控股', '模塑科技', '腾讯控股(ADR)', '恒生指数'],
    '⛔ title 一律是证券全称（旧版写「添加」，那句 affordance 已经由右侧胶囊说了）')
})

test('某一路检索挂了：候选照常给其余路，下拉那一行点名挂掉的那一路', async () => {
  const candidates = [{ thscode: '00700.HK', ticker: '00700', name: '腾讯控股', exchange: 'HK', asset_type: 'hk-stock', in_list: false }]
  const { ctx } = mount({
    fetch: async (url) => ({
      ok: true,
      status: 200,
      text: async () => (String(url).includes('/search')
        ? `{"ok":true,"items":${JSON.stringify(candidates)},"truncated":false,"partial":[{"market":"a-share","code":"credential_missing"}]}`
        : '{"ok":true,"items":[]}'),
    }),
  })
  const injected = ctx.registrations[0].declaration.inject('s-partial')
  const surface = injected.surface
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  surface.open()
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  surface.onQueryChange('腾讯')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  const tree = render()
  assert.equal(classNodes(tree, 'capital-watchlist-option').length, 1, 'R12：A 股那一路挂了不没收港美股的候选')
  const hint = classNodes(tree, 'capital-watchlist-searcherror')
  assert.equal(hint.length, 1)
  assert.equal(hint[0].props['data-market'], 'a-share')
  assert.equal(hint[0].props.role, 'status', '半边失败不占 alert（那是留给"这一屏说不了话"的那一档）')
  assert.match(textOf(hint[0]), /A 股检索不可用：未配置 Fuyao 密钥/)
  assert.equal(classNodes(tree, 'capital-watchlist-notice').length, 0, '⛔ 居中/页脚那一条整块失败的红字不许亮')
})

test('placeholder 与 noHit 不再写死"沪深 A 股 / 指数 / ETF"三口', () => {
  const { ctx } = mount()
  const dictionaries = ctx.dictionaries['capital.watchlist']
  for (const locale of ['zh', 'en']) {
    const dict = dictionaries[locale]
    for (const key of ['searchPlaceholder', 'noHit']) {
      assert.match(dict[key], /A.?股|A-share/iu, `${locale}.${key} 要说清支持 A 股`)
      assert.match(dict[key], /港股|美股|HK|US/u, `${locale}.${key} 要带上港美股（入口统一的那句话）`)
    }
    for (const key of ['typeAShare', 'typeHkStock', 'typeUsStock', 'typeAIndex', 'typeHkIndex', 'typeUsIndex',
      'kindStock', 'kindIndex', 'kindEtf']) {
      assert.equal(typeof dict[key], 'string', `${locale} 缺徽标/品种文案 ${key}`)
      if (locale === 'en') assert.equal(/[\u4e00-\u9fff]/.test(dict[key]), false, `英文界面的 ${key} 不许夹中文`)
    }
    assert.equal(dict.typeEtf, undefined, '⛔ ETF 不再是徽标那一族（场内 ETF 并入 A股）；它只该活在 kindEtf 里')
  }
})

test('下拉筛选头：默认「全部」、按市场切档只改显示（不出网）、计数说清三市各多少条', async () => {
  const candidates = [
    { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', in_list: false },
    { thscode: '600519.SH', ticker: '600519', name: '贵州茅台', exchange: 'SH', asset_type: 'a-share', in_list: false },
    { thscode: '00700.HK', ticker: '00700', name: '腾讯控股', exchange: 'HK', asset_type: 'hk-stock', in_list: false },
    { thscode: 'AAPL.OQ', ticker: 'AAPL', name: '苹果', exchange: 'US', asset_type: 'us-stock', in_list: false },
  ]
  const calls = []
  const { ctx } = mount({
    fetch: async (url) => {
      calls.push(String(url))
      return { ok: true, status: 200, text: async () => (String(url).includes('/search') ? `{"ok":true,"items":${JSON.stringify(candidates)},"truncated":false}` : '{"ok":true,"items":[]}') }
    },
  })
  const injected = ctx.registrations[0].declaration.inject('s-filter')
  const surface = injected.surface
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  surface.open()
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  surface.onQueryChange('x')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))

  let tree = render()
  assert.equal(classNodes(tree, 'capital-watchlist-option').length, 4, '默认全部 ⇒ 三市都画出来')
  const buttons = classNodes(tree, 'capital-watchlist-filterbtn')
  assert.deepEqual(buttons.map((node) => textOf(node).replace(/\s+/gu, '')), ['全部4', 'CN2', 'HK1', 'US1'], '计数是各市场的真实条数')
  assert.deepEqual(buttons.map((node) => node.props['aria-pressed']), [true, false, false, false], '选中态只写在 aria-pressed 上')
  assert.equal(classNodes(tree, 'capital-watchlist-filter').length, 1, '筛选头是一行 group')
  const searchesAfterFirst = calls.filter((url) => url.includes('/search')).length

  buttons[2].props.onClick()
  tree = render()
  assert.deepEqual(textOf(tree).match(/00700\.HK|300750\.SZ|600519\.SH|AAPL\.OQ/g), ['00700.HK'], 'HK 档只留港股那一行')
  assert.equal(injected.hooks.dialog.getSnapshot().marketFilter, 'hk', '档位住 store（面板重开会回「全部」）')
  assert.equal(injected.hooks.dialog.getSnapshot().dropdownOpen, true, '切档不收下拉')
  assert.equal(calls.filter((url) => url.includes('/search')).length, searchesAfterFirst, '⛔ 切档不出网：候选是一次拿全的')

  // An empty tab must say 这个市场下没有匹配的标的, not 没有匹配的标的; the truly-empty case needs its own reply set below.
  const empty = mount({
    fetch: async (url) => ({ ok: true, status: 200, text: async () => (String(url).includes('/search') ? `{"ok":true,"items":${JSON.stringify(candidates.slice(0, 2))},"truncated":false}` : '{"ok":true,"items":[]}') }),
  })
  const injectedB = empty.ctx.registrations[0].declaration.inject('s-filter-empty')
  const tB = (key) => empty.ctx.dictionaries['capital.watchlist'].zh[key] ?? key
  injectedB.surface.open()
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  injectedB.surface.onQueryChange('x')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  injectedB.surface.setMarketFilter('hk')
  resetHooks()
  const treeB = empty.ctx.registrations[0].component({ ...injectedB, useDialog: (selector) => selector(injectedB.hooks.dialog.getSnapshot()), t: tB })
  assert.equal(classNodes(treeB, 'capital-watchlist-option').length, 0, 'HK 档下这两条 A 股都不可见')
  assert.match(textOf(treeB), /这个市场下没有匹配的标的/, '⛔ 空档说的是"这一档没有"，不是"没有匹配"')
  assert.equal(textOf(treeB).includes('没有匹配的标的（A股'), false, 'noHit 那句不许同时出现')

  // An unknown filter value is ignored rather than blanking the dropdown.
  injectedB.surface.setMarketFilter('zz')
  assert.equal(injectedB.hooks.dialog.getSnapshot().marketFilter, 'hk')
})

test('⛔ 连续添加：加完一条下拉不收起、输入不动，在途只禁它自己那一条', async () => {
  const candidates = [
    { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', in_list: false },
    { thscode: '000905.SH', ticker: '000905', name: '中证500', exchange: 'SH', asset_type: 'a-share-index', in_list: false },
  ]
  const calls = []
  const { ctx } = mount({
    fetch: async (url) => {
      const target = String(url)
      calls.push(target)
      if (target.includes('/add')) return { ok: true, status: 200, text: async () => '{"ok":true,"item":{}}' }
      if (target.includes('/search')) return { ok: true, status: 200, text: async () => `{"ok":true,"items":${JSON.stringify(candidates)},"truncated":false}` }
      return { ok: true, status: 200, text: async () => '{"ok":true,"items":[],"refreshed_at":null,"failures":[]}' }
    },
  })
  const injected = ctx.registrations[0].declaration.inject('s-continuous')
  const surface = injected.surface
  const t = (key) => ctx.dictionaries['capital.watchlist'].zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  const adds = () => calls.filter((url) => url.includes('/add')).length
  surface.open()
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  surface.onQueryChange('x')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))

  let tree = render()
  classNodes(tree, 'capital-watchlist-option')[0].props.onClick()
  tree = render()
  const inflight = classNodes(tree, 'capital-watchlist-option')
  assert.equal(inflight[0].props['aria-disabled'], true, '在途那一条先拦住自己（防双击同一行）')
  assert.equal(inflight[1].props['aria-disabled'], false, '⛔ 其余候选不禁：连续添加的窗口就在这一刻')

  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  tree = render()
  assert.equal(injected.hooks.dialog.getSnapshot().dropdownOpen, true, '⛔ 加完下拉不收起（收起就得重敲一遍词）')
  assert.equal(injected.hooks.dialog.getSnapshot().query, 'x', '输入框的词不动')
  assert.equal(adds(), 1)
  assert.equal(classNodes(tree, 'capital-watchlist-option')[0].props['aria-disabled'], true, '第一条已标「已添加」（幂等）')
  assert.equal(classNodes(tree, 'capital-watchlist-option')[1].props['aria-disabled'], false, '第二条还点得进去')
  assert.deepEqual(classNodes(tree, 'capital-watchlist-addbtn').map((node) => node.props['data-state']), ['added', 'idle'],
    '两态写在 data-state 上，样式读它')
  // ⛔ Disabled must mean no request: re-clicking an 已添加 row may not add another /add.
  const before = adds()
  classNodes(tree, 'capital-watchlist-option')[0].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(adds(), before, '⛔ 已添加那条点多少次都不再出网（guard 在渲染处，aria-disabled 只管视觉）')
  assert.equal(injected.hooks.dialog.getSnapshot().dropdownOpen, true, '点已添加那条也不许把下拉弄没')

  classNodes(tree, 'capital-watchlist-option')[1].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  assert.equal(adds(), 2, '⛔ 连续两次添加：是两笔 /add，不是同一条点了两次')
  const snapshot = injected.hooks.dialog.getSnapshot()
  assert.equal(snapshot.dropdownOpen, true, '两次都加完，下拉始终开着')
  assert.equal(snapshot.candidates.every((row) => row.in_list === true), true, '两条都标已添加')
})

test('⛔ "没有更多"住在滚动区末尾（跟着内容滚），文案里不再有"候选不止这些"', async () => {
  const candidates = [
    { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', in_list: false },
    { thscode: '000905.SH', ticker: '000905', name: '中证500', exchange: 'SH', asset_type: 'a-share-index', in_list: false },
  ]
  const { ctx } = mount({
    fetch: async (url) => ({ ok: true, status: 200, text: async () => (String(url).includes('/search') ? `{"ok":true,"items":${JSON.stringify(candidates)},"truncated":true}` : '{"ok":true,"items":[]}') }),
  })
  const injected = ctx.registrations[0].declaration.inject('s-endhint')
  const surface = injected.surface
  const t = (key) => ctx.dictionaries['capital.watchlist'].zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  surface.open()
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  surface.onQueryChange('x')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  const tree = render()

  const dropdown = classNodes(tree, 'capital-watchlist-dropdown')[0]
  const options = classNodes(tree, 'capital-watchlist-options')[0]
  const hints = classNodes(tree, 'capital-watchlist-endhint')
  assert.equal(hints.length, 1, 'truncated=true 就要画这一句')
  assert.equal(classNodes(options, 'capital-watchlist-endhint').length, 1, '⛔ 它是滚动区的子节点 ⇒ 滚到底才看得见（不冻结）')
  assert.equal(childrenOf(dropdown).includes(hints[0]), false, '⛔ 不许是浮层的直接子节点：那就等于钉在底部的常驻横幅')
  const text = textOf(hints[0]).replace(/\s+/gu, '')
  assert.equal(text, '没有更多，请输入准确的证券代码或名称。', '文案按 2026-10-08 的改写：不再说"候选不止这些"（此刻一行都没藏）')
  assert.equal(textOf(tree).includes('候选不止这些'), false, '旧文案一个字都不许留下')

  surface.setMarketFilter('hk')
  const filtered = render()
  assert.equal(classNodes(filtered, 'capital-watchlist-endhint').length, 0, '空档不画"没有更多"')
  assert.match(textOf(filtered), /这个市场下没有匹配的标的/)
})

// Holding family: marking may not lie (null != 0), marked_at is the host clock, late replies and failures touch only their own row, indexes have no entry while legacy holdings still clear, total weight caps at 120% (long only), one action is exactly one /holding.

const heldRow = (over = {}) => ({
  thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share',
  added_at: 1, source: 'user', quote: null, ...over,
})
const indexRow = (over = {}) => ({
  thscode: 'HSI.HK', ticker: 'HSI', name: '恒生指数', exchange: 'HK', asset_type: 'hk-index',
  added_at: 1, source: 'seed', quote: null, ...over,
})

/** Shared holding harness: records every /holding body; respond can override any reply. */
function holdingHarness(sessionId, options = {}) {
  const posts = []
  const posted = []
  // stored as an array puts several rows on screen; rollback cases need another row to watch.
  const rows = Array.isArray(options.stored) ? [...options.stored] : [options.stored ?? heldRow()]
  const payload = `[${rows.map((row) => JSON.stringify(row)).join(',')}]`
  const first = JSON.stringify(rows[0])
  const { ctx } = mount({
    fetch: async (url, init) => {
      const target = String(url)
      const path = target.replace('/capital-watchlist', '').split('?')[0]
      if (init?.body !== undefined) {
        posted.push(path)
        if (path === '/holding') {
          const raw = String(init.body)
          posts.push({ path, body: JSON.parse(raw), raw })
        }
      }
      const override = options.respond?.(path, posts)
      if (override !== undefined) return override
      if (path.includes('/holding')) return { ok: true, status: 200, text: async () => `{"ok":true,"item":${first}}` }
      if (path.includes('/list')) return { ok: true, status: 200, text: async () => `{"ok":true,"items":${payload},"seeded_at":1,"limit":30}` }
      return { ok: true, status: 200, text: async () => `{"ok":true,"items":${payload},"refreshed_at":1,"failures":[]}` }
    },
  })
  const injected = ctx.registrations[0].declaration.inject(sessionId)
  const zh = ctx.dictionaries['capital.watchlist'].zh
  const t = (key) => zh[key] ?? key
  const render = () => {
    resetHooks()
    return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t })
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { ctx, injected, surface: injected.surface, posts, posted, render, settle, zh, state: () => injected.hooks.dialog.getSnapshot() }
}

/** Opens the more menu of a row. */
function openMore(harness, index = 0) {
  moreButtonAt(harness.render(), index).props.onClick()
  return harness.render()
}

/** The holding row inside the Menu children. ⛔ Not a button: both states keep the same container, icon and label, and only the switch changes state. */
const checkRow = (tree, index = 0) => classNodes(menuNodes(tree)[index].props.children, 'capital-watchlist-checkrow')[0]
const checkLabel = (tree, index = 0) => classNodes(menuNodes(tree)[index].props.children, 'capital-watchlist-checklabel')[0]

/** The row's official Switch stub: it carries no className, so match by type. */
function holdingSwitch(tree, index = 0) {
  const found = []
  walkNodes(menuNodes(tree)[index].props.children, (node) => { if (node.type === 'Switch') found.push(node) })
  assert.equal(found.length, 1, `第 ${index} 行的菜单里必须正好一颗开关（找到 ${found.length} 颗）`)
  return found[0]
}

/** Flips row index's switch: on = mark holding (weight unset), off = clear. */
function flipSwitch(harness, next, index = 0) {
  openMore(harness, index)
  holdingSwitch(harness.render(), index).props.onChange(next)
  return harness.render()
}

const markViaMenu = (harness, index = 0) => flipSwitch(harness, true, index)
/** Clear holding - the only exit; the row itself is not clickable. */
const clearViaMenu = (harness, index = 0) => flipSwitch(harness, false, index)

/** Presses a stepper key by document order (reachable names come from harness.zh). */
function pressStep(harness, which, index = 0) {
  const buttons = stepButtons(harness.render(), index)
  if (buttons === null) throw new Error('菜单里没有步进行')
  buttons[which].props.onClick()
  return harness.render()
}

test('勾选行：点整行当场标上（比例是 null 不是 0），菜单不关，比例行读这一格的剩余额度', async () => {
  const harness = holdingHarness('s-hold-check', {
    respond: (path) => (path.includes('/holding')
      ? { ok: true, status: 200, text: async () => `{"ok":true,"item":${JSON.stringify(heldRow({ holding: { weight_pct: null, marked_at: 7 } }))}}` }
      : undefined),
  })
  harness.surface.open()
  for (let round = 0; round < 5; round += 1) await harness.settle()

  assert.equal(classNodes(harness.render(), 'capital-watchlist-name-held').length, 0, '没标过就不标红（标了就是替用户报了个仓位）')
  assert.equal(holdingSwitch(harness.render()).props.checked, false, '未标：开关在"关"这一档')
  assert.equal(classNodes(harness.render(), 'capital-watchlist-stepper').length, 0, '没开不给比例行')

  const before = harness.posted.length
  const tree = markViaMenu(harness)
  assert.equal(harness.posted.length, before + 1, '⛔ 开一下开关就是那一次写：只多一个 /holding，不多不少')
  assert.deepEqual(harness.posts.map((post) => post.body), [{ thscode: '300750.SZ', weight_pct: null }])
  assert.match(harness.posts[0].raw, /"weight_pct":null/, '⛔ 提交的是 null：写成 0 等于替用户报了一个"零仓位"')
  assert.equal(harness.state().pendingRemove, null, '它标的是持仓，不是移除确认')
  assert.equal(harness.state().rowMenu, '300750.SZ', '⛔ 开完菜单必须还开着：接下来还要在这儿调比例，收起就是把用户刚点的东西拿走')
  assert.equal(classNodes(tree, 'capital-watchlist-confirm').length, 1, '⛔ 面板里不许长出第二层常驻遮罩（持仓这件事全在菜单里）')
  assert.equal(holdingSwitch(tree).props.checked, true, '已标：开关在"开"这一档')
  assert.equal(classNodes(tree, 'capital-watchlist-box').length, 0, '⛔ 自己画的空环那一族已经废掉，不许长回来')
  const step = stepButtons(tree)
  assert.ok(step, '开上之后比例行出现在同一张菜单里')
  assert.equal(textOf(step.readout).trim(), '0~100', '不设默认值：没填就显示剩余额度（此刻其余持仓为 0 ⇒ 满额 100）')
  assert.equal(classNodes(tree, 'capital-watchlist-stepperplaceholder').length, 1, 'placeholder 降一档颜色：它是一句提示，不是一个数')
  assert.equal(step.down.props.disabled, true, '没填那一档 − 点不动（按它只会得到一个假的 0）')
  assert.equal(step.up.props.disabled, false)
  assert.equal(textOf(checkLabel(tree)).trim(), '持仓', '行标签不因状态改口：标没标由那颗开关说')
  assert.equal(menuChildren(tree).length, 3, 'children 三行：持仓 + 比例 + 移除')
})

test('已标过的行：名称标红 + tooltip 说自报占比；只有那颗开关能取消', async () => {
  const marked = heldRow({ holding: { weight_pct: 20, marked_at: 5 } })
  const harness = holdingHarness('s-hold-marked', {
    stored: marked,
    respond: (path) => (path.includes('/holding')
      ? { ok: true, status: 200, text: async () => `{"ok":true,"item":${JSON.stringify(heldRow())}}` }
      : undefined),
  })
  harness.surface.open()
  for (let round = 0; round < 5; round += 1) await harness.settle()

  const name = classNodes(harness.render(), 'capital-watchlist-name')[0]
  assert.ok(name.props.className.includes('capital-watchlist-name-held'), '标过持仓的行：名称标红')
  // Held red is the same red as an up move, so the fact needs a second, colour-free channel.
  assert.match(name.props.title, /宁德时代 300750 · 持仓 20%/, 'tooltip 带上自报占比（原样给，不补成 20.00%）')
  assert.equal(classNodes(harness.render(), 'capital-watchlist-holdingtag').length, 0, '徽标那一族已经废掉：不许再长回来')
  assert.equal(classNodes(harness.render(), 'capital-watchlist-tag').length, 1, '类型徽标仍只有市场那一枚，持仓不借它的 class')

  // ⛔ Only the switch clears: the row is one non-clickable container in both states, so nothing shifts.
  openMore(harness)
  const label = checkLabel(harness.render())
  assert.equal(label.type, 'span', '名称是静态字：不是按钮')
  assert.equal(label.props.onClick, undefined, '⛔ 点名称不许取消持仓')
  const row = checkRow(harness.render())
  assert.equal(row.type, 'div', '⛔ 整行不是按钮：开与关都只能碰那颗开关')
  assert.equal(row.props.onClick, undefined, '行上没有可点的东西——两态形状一致，因此不会位移')
  assert.equal(holdingSwitch(harness.render()).props.checked, true, '已标那一态：开关在"开"，状态由它自己说')
  assert.equal(harness.posts.length, 0, '展开菜单与看名称，一次请求都不许发')

  const tree = clearViaMenu(harness)
  assert.deepEqual(harness.posts.map((post) => post.body), [{ thscode: '300750.SZ', clear: true }], '取消持仓走那颗开关，只打那一条路由')
  assert.equal(classNodes(tree, 'capital-watchlist-name')[0].props.className.includes('capital-watchlist-name-held'), false, '取消之后红名跟着退')
  assert.equal(classNodes(tree, 'capital-watchlist-row').length, 1, '⛔ 取消持仓不是"移除自选"：那一行还在清单里')
  assert.equal(stepButtons(tree), null, '关开关让比例那一行一起消失（它挂在"已标"上，不留一颗点不动的键）')
  assert.equal(holdingSwitch(tree).props.checked, false, '取消之后开关回到"关"，那一行仍是同一形状')
})

test('步进 = 一次一档、一次一个 /holding；body 是 {thscode, weight_pct}，标记时刻以宿主回包为准', async () => {
  const saved = heldRow({ holding: { weight_pct: 10, marked_at: 999 } })
  const harness = holdingHarness('s-hold-step', {
    respond: (path) => (path.includes('/holding')
      ? { ok: true, status: 200, text: async () => `{"ok":true,"item":${JSON.stringify(saved)}}` }
      : undefined),
  })
  harness.surface.open()
  for (let round = 0; round < 5; round += 1) await harness.settle()
  markViaMenu(harness)
  const posts = harness.posts.length

  pressStep(harness, 'up')
  for (let round = 0; round < 5; round += 1) await harness.settle()
  assert.equal(harness.posts.length, posts + 1, `一档只打一次（实际多出 ${harness.posts.length - posts}）`)
  assert.deepEqual(harness.posts[harness.posts.length - 1].body, { thscode: '300750.SZ', weight_pct: 10 }, '没填的那一格第一次按 + 落 10，不是 1、也不是 0')
  const stored = harness.state().items[0]
  assert.equal(stored.holding.weight_pct, 10)
  assert.equal(stored.holding.marked_at, 999, '⛔ 标记时刻归宿主——乐观那一格用的是浏览器钟，回包落地必须覆盖它')
  assert.equal(textOf(stepButtons(harness.render()).readout).trim(), '10%', '读数跟着宿主那一条走')
  assert.match(classNodes(harness.render(), 'capital-watchlist-name')[0].props.title, /持仓 10%/, 'tooltip 当场跟着更新（失败才弹回去）')
})

test('⛔ 步进边界：0 是用户真填的数、100 到顶置灰、37.5 不吸附', async () => {
  const harness = holdingHarness('s-hold-bounds', { stored: heldRow({ holding: { weight_pct: 0, marked_at: 7 } }) })
  harness.surface.open()
  for (let round = 0; round < 5; round += 1) await harness.settle()
  const tree = openMore(harness)
  const step = stepButtons(tree)
  assert.equal(textOf(step.readout).trim(), '0%', '"填了 0"与"没填"是两句话：这一档读 0%，不读那句剩余额度')
  assert.equal(classNodes(tree, 'capital-watchlist-stepperplaceholder').length, 0, '有数就不许挂 placeholder 那一档颜色')
  assert.equal(step.down.props.disabled, true, '0 已经是下界')
  assert.equal(step.up.props.disabled, false)

  const atTop = holdingHarness('s-hold-top', { stored: heldRow({ holding: { weight_pct: 100, marked_at: 7 } }) })
  atTop.surface.open()
  for (let round = 0; round < 5; round += 1) await atTop.settle()
  const top = stepButtons(openMore(atTop))
  assert.equal(top.up.props.disabled, true, '100 是上界')
  assert.equal(top.down.props.disabled, false)
  pressStep(atTop, 'up')
  await atTop.settle()
  assert.deepEqual(atTop.posts, [], '置灰的键点不动：宿主永远收不到一个 110')

  // No snapping: a stored 37.5 steps to 47.5 rather than being straightened for the user.
  const odd = holdingHarness('s-hold-odd', { stored: heldRow({ holding: { weight_pct: 37.5, marked_at: 7 } }) })
  odd.surface.open()
  for (let round = 0; round < 5; round += 1) await odd.settle()
  assert.equal(textOf(stepButtons(openMore(odd)).readout).trim(), '37.5%', '原样读，不四舍五入到 40')
  pressStep(odd, 'up')
  await odd.settle()
  assert.deepEqual(odd.posts[0].body, { thscode: '300750.SZ', weight_pct: 47.5 }, '⛔ 把用户写过的 37.5 掰成 40 就是替他说了句话')
})

test('⛔ 合计封顶 120%：其余持仓吃掉额度之后 + 置灰，placeholder 说的就是剩余额度', async () => {
  // Long only, no put, so this cell's cap is min(100, 120 - other holdings) - the same subtraction as watchlist/holding-rules.js.
  const rows = [
    heldRow(),
    heldRow({ thscode: '600519.SH', ticker: '600519', name: '贵州茅台', exchange: 'SH', holding: { weight_pct: 100, marked_at: 3 } }),
  ]
  const harness = holdingHarness('s-hold-budget', {
    stored: rows,
    // Fake host writes the body back with the real three states: clear drops the cell, empty stores null, a number is taken as given.
    respond: (path, posts) => (path.includes('/holding')
      ? {
        ok: true,
        status: 200,
        text: async () => {
          const body = posts[posts.length - 1].body
          const item = { ...rows.find((row) => row.thscode === body.thscode) }
          if (body.clear === true) delete item.holding
          else item.holding = { weight_pct: body.weight_pct ?? null, marked_at: 10 + posts.length }
          return `{"ok":true,"item":${JSON.stringify(item)}}`
        },
      }
      : undefined),
  })
  harness.surface.open()
  for (let round = 0; round < 5; round += 1) await harness.settle()

  markViaMenu(harness, 0)
  await harness.settle()
  assert.equal(harness.posts[0].body.weight_pct, null, '勾选本身不占额度：其余已经 100% 也照样标得上')
  assert.equal(textOf(stepButtons(harness.render(), 0).readout).trim(), '0~20', '没填就显示这一格还剩 20（120 减其余 100）')

  pressStep(harness, 'up', 0)
  await harness.settle()
  assert.deepEqual(harness.posts[1].body, { thscode: '300750.SZ', weight_pct: 10 })
  pressStep(harness, 'up', 0)
  await harness.settle()
  assert.equal(textOf(stepButtons(harness.render(), 0).readout).trim(), '20%', '按到额度顶就停在这儿：不是 30')

  const step = stepButtons(harness.render(), 0)
  assert.equal(step.up.props.disabled, true, '⛔ 额度用完：+ 置灰，而不是"按了没反应"')
  assert.equal(step.up.props.title, '0~20', '那颗灰键自己说上限是多少')
  assert.equal(step.down.props.disabled, false, '往回走永远通（改小不受额度管）')
  const posts = harness.posts.length
  pressStep(harness, 'up', 0)
  await harness.settle()
  assert.equal(harness.posts.length, posts, '置灰的键点不动：宿主永远收不到会破 120 的那一档')
  assert.equal(harness.state().items[1].holding.weight_pct, 100, '另一只的账不受这次点击影响')
})

test('⛔ 菜单几何：列表固定宽度、行按 border-box 算——开开关不许位移，也不许长出横向滚动条', async () => {
  // Device-side shift and horizontal scrollbar share one root: the official .list only sets min-width and this menu opens align:end, so a new row widens it. Synthetic trees cannot see pixels - this pins the CSS shape.
  const css = mountedCss().replace(/\/\*[\s\S]*?\*\//g, ' ')
  assert.match(css, /\.capital-watchlist-rows \{ width: \d+px; \}/, '⛔ 菜单列表必须是固定 width（min-width 会跟着内容长）')
  assert.equal(/\.capital-watchlist-rows \{[^}]*min-width/.test(css), false, 'min-width 一回来，两态宽度就不一样')
  assert.match(css, /\.capital-watchlist-checkrow \{ box-sizing: border-box;[^}]*width: 100%/, '持仓行必须 border-box 才塞得进列表内容盒')
  assert.match(css, /\.capital-watchlist-stepper \{ box-sizing: border-box;[^}]*width: 100%/, '比例行同上')
  // Official .item is width:100% + padding with no box-sizing (no global reset here): contain the 16px in this list instead of restyling upstream classes.
  assert.match(css, /\.capital-watchlist-rows button \{ box-sizing: border-box; \}/, '菜单里的官方行也要按 border-box 算宽')
  const width = Number(/\.capital-watchlist-rows \{ width: (\d+)px/.exec(css)[1])
  assert.ok(width >= 240 && width <= 360, `列表宽度 ${width}px 得装得下最宽那一行，又不顶破官方 max-width: 360px`)

  const harness = holdingHarness('s-hold-geometry')
  harness.surface.open()
  for (let round = 0; round < 5; round += 1) await harness.settle()
  const off = checkRow(openMore(harness))
  assert.equal(off.type, 'div', '未标：行是容器')
  markViaMenu(harness)
  await harness.settle()
  const on = checkRow(harness.render())
  assert.equal(on.type, off.type, '⛔ 两态同一形状：形状一变，align:end 就把整块菜单挪了')
  assert.equal(on.props.className, off.props.className, '类名也不许跟着状态换（换的就是那 16px 的位移）')
  assert.equal(iconOf(classNodes(menuNodes(harness.render())[0].props.children, 'capital-watchlist-checkicon')[0]),
    'IconDatabaseOutlineRegular', '开上之后行首还是那一摞圆盘（不许换成画着勾的那两支）')
})

test('⛔ 连点之后晚到的回包不许把行改回旧比例（seq 闸门）', async () => {
  // Writes are serialised on the server but replies are not ordered: a late reply would rewind the row and start the next step from the wrong value.
  const stamps = { 20: 111, 30: 222 }
  const gates = []
  const harness = holdingHarness('s-hold-race', {
    stored: heldRow({ holding: { weight_pct: 10, marked_at: 7 } }),
    respond: (path, posts) => {
      if (!path.includes('/holding')) return undefined
      const weight = posts[posts.length - 1].body.weight_pct
      return new Promise((resolve) => {
        gates.push(() => resolve({ ok: true, status: 200, text: async () => `{"ok":true,"item":${JSON.stringify(heldRow({ holding: { weight_pct: weight, marked_at: stamps[weight] } }))}}` }))
      })
    },
  })
  harness.surface.open()
  for (let round = 0; round < 5; round += 1) await harness.settle()
  openMore(harness)

  pressStep(harness, 'up')
  pressStep(harness, 'up')
  await harness.settle()
  assert.equal(gates.length, 2, '两下 = 两条 /holding 在途')
  assert.deepEqual(harness.posts.map((post) => post.body.weight_pct), [20, 30], '乐观值跟着点击走，第二次从 20 起步')

  gates[1]() // 后按的那一次先回
  for (let round = 0; round < 5; round += 1) await harness.settle()
  assert.equal(harness.state().items[0].holding.weight_pct, 30)

  gates[0]() // 先按的那一次**晚**到
  for (let round = 0; round < 5; round += 1) await harness.settle()
  const row = harness.state().items[0]
  assert.equal(row.holding.weight_pct, 30, '⛔ 旧回包不许把行改回 20')
  assert.equal(row.holding.marked_at, 222, '连标记时刻也不许被旧回包顶掉')
  assert.equal(textOf(stepButtons(harness.render()).readout).trim(), '30%', '屏上读的就是用户最后要的那个值')
})

test('⛔ 失败只弹回那一行：连点失败回到最近一次宿主确认值，别的行不动', async () => {
  // Restoring the whole array is the trap: one failed step would rewind other rows' confirmed adds, holdings and pins.
  const other = { thscode: '600519.SH', ticker: '600519', name: '贵州茅台', exchange: 'SH', asset_type: 'a-share', added_at: 2, source: 'user', quote: null, holding: { weight_pct: 40, marked_at: 8 } }
  const stored = heldRow({ holding: { weight_pct: 10, marked_at: 7 } })
  const harness = holdingHarness('s-hold-rollback', {
    stored: [stored, other],
    respond: (path) => (path.includes('/holding')
      ? { ok: false, status: 503, text: async () => '{"ok":false,"code":"store_unavailable","message":"x"}' }
      : undefined),
  })
  harness.surface.open()
  for (let round = 0; round < 5; round += 1) await harness.settle()
  openMore(harness)

  pressStep(harness, 'up')
  assert.equal(harness.state().items[0].holding.weight_pct, 20, '乐观：请求在途时先按新值画')
  await harness.settle()
  await harness.settle()
  const rows = harness.state().items
  assert.equal(rows[0].holding.weight_pct, 10, '没写成库就该弹回最近一次宿主确认的 10，而不是停在 20')
  assert.equal(rows[0].holding.marked_at, 7, '弹回的是宿主那一条，连标记时刻一起回来')
  assert.equal(rows[1].holding.weight_pct, 40, '⛔ 别的行一点都不许被这次失败波及')
})

test('⛔ 指数没有持仓入口；一条遗留的指数持仓仍然退得掉、仍然标红', async () => {
  // The gate is the one in watchlist/holding-rules.js; red here means the two halves drifted apart.
  const rows = [
    indexRow(),
    { thscode: '000001.SH', ticker: '000001', name: '上证指数', exchange: 'SH', asset_type: 'a-share-index', added_at: 2, source: 'seed', quote: null },
    { thscode: 'INX.US', ticker: 'INX', name: '标普500', exchange: 'US', asset_type: 'us-index', added_at: 3, source: 'seed', quote: null },
    { thscode: '510300.SH', ticker: '510300', name: '沪深300ETF', exchange: 'SH', asset_type: 'fund-etf', added_at: 4, source: 'user', quote: null },
  ]
  const harness = holdingHarness('s-hold-index', { stored: rows })
  harness.surface.open()
  for (let round = 0; round < 5; round += 1) await harness.settle()
  rows.forEach((row, index) => {
    openMore(harness, index)
    assert.deepEqual([...menuNodes(harness.render())[index].props.items].map((entry) => entry.id), ['pin'],
      `${row.asset_type} 的数据行只有「置顶」（勾选行不住在 items 里）`)
  })
  const marked = (index) => checkRow(harness.render(), index) !== undefined
  assert.equal(marked(0), false, '恒指：没有勾选行')
  assert.equal(marked(1), false, '上证指数：没有勾选行')
  assert.equal(marked(2), false, '标普500：没有勾选行')
  assert.equal(marked(3), true, '场内 ETF 是可以持有的券，勾选行照给')
  assert.equal(menuChildren(harness.render(), 0).length, 1, '指数行少一行，children 就只剩移除')
  assert.equal(removeRow(harness.render(), 0).props.separatorBefore, true, '少一行也要有那根发丝线（分隔的是持仓那一簇与移除）')
})

test('⛔ 改判前标上的指数持仓：仍然标红、仍然给取消出口——只按类型画就会把人锁死', async () => {
  // Index holdings exist from before the type gate and from hand-edited JSON: rendering purely by isHoldable would leave them unred and unclearable while get_watchlist still reads them as positions.
  const legacy = indexRow({ holding: { weight_pct: 40, marked_at: 5 } })
  const harness = holdingHarness('s-hold-legacy', {
    stored: legacy,
    respond: (path) => (path.includes('/holding')
      ? { ok: true, status: 200, text: async () => `{"ok":true,"item":${JSON.stringify(indexRow())}}` }
      : undefined),
  })
  harness.surface.open()
  for (let round = 0; round < 5; round += 1) await harness.settle()

  assert.ok(classNodes(harness.render(), 'capital-watchlist-name')[0].props.className.includes('capital-watchlist-name-held'), '红名照画：这一格在域里，读屏与主 Agent 看到的都是同一句话')
  const tree = clearViaMenu(harness)
  assert.deepEqual(harness.posts.map((post) => post.body), [{ thscode: 'HSI.HK', clear: true }], '取消出口给得出（那枚实心圆圈就是它）')
  assert.equal(classNodes(tree, 'capital-watchlist-name')[0].props.className.includes('capital-watchlist-name-held'), false, '取消之后红名退掉')
  assert.equal(stepButtons(tree), null, '但遗留的指数持仓没有调档那一行：类型不成立，不给它继续写比例的入口')
})

test('⛔ 步进器开着时关掉面板：重开必须是干净清单，不是上一轮那只票的菜单', async () => {
  // The seat stays mounted (close returns null), so rowMenu resets on close: the stepper loses its seat and the red names left on screen are host truth, not draft.
  const harness = holdingHarness('s-hold-reopen', { stored: heldRow({ holding: { weight_pct: 30, marked_at: 7 } }) })
  harness.surface.open()
  for (let round = 0; round < 5; round += 1) await harness.settle()
  openMore(harness)
  assert.ok(stepButtons(harness.render()), '步进器开着')

  harness.surface.close()
  assert.equal(harness.state().rowMenu, null, '关面板时菜单一起收：它现在是步进器唯一的座位')
  harness.surface.open()
  for (let round = 0; round < 5; round += 1) await harness.settle()

  const tree = harness.render()
  // The stub Menu records props even when closed, so this pins the open flag itself - the stepper seat is that closed menu.
  assert.equal(menuNodes(tree)[0].props.open, false, '重开时菜单是收着的，步进器没有座位')
  assert.equal(classNodes(tree, 'capital-watchlist-confirm').length, 1)
  assert.equal(classNodes(tree, 'capital-watchlist-confirm').length, 1, '常驻遮罩层仍然只有移除那一张')
})

test('⛔ 刷新落回整张清单时，在途的持仓写不许再改它（seq 账目跟着作废）', async () => {
  // A refresh reply is host truth (writes are serialised there): every /holding reply still in flight afterwards must be dropped.
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const harness = holdingHarness('s-hold-refresh', {
    stored: heldRow({ holding: { weight_pct: 10, marked_at: 7 } }),
    respond: (path) => (path.includes('/holding')
      ? gate.then(() => ({ ok: true, status: 200, text: async () => `{"ok":true,"item":${JSON.stringify(heldRow({ holding: { weight_pct: 20, marked_at: 55 } }))}}` }))
      : undefined),
  })
  harness.surface.open()
  for (let round = 0; round < 5; round += 1) await harness.settle()
  openMore(harness)

  pressStep(harness, 'up')
  assert.equal(harness.state().items[0].holding.weight_pct, 20, '乐观：在途时先按新值画')

  await harness.surface.refresh()
  for (let round = 0; round < 5; round += 1) await harness.settle()
  assert.equal(harness.state().items[0].holding.weight_pct, 10, '刷新回包是宿主真值：屏上回到它')

  release()
  for (let round = 0; round < 5; round += 1) await harness.settle()
  assert.equal(harness.state().items[0].holding.weight_pct, 10, '⛔ 那条旧回执晚到了，不许把 20 又画回去')
  assert.equal(harness.state().items[0].holding.marked_at, 7)
})

test('两套字典都要有持仓这一族，且英文界面不许画中文类型词', () => {
  const harness = holdingHarness('s-hold-dict')
  const zh = harness.ctx.dictionaries['capital.watchlist'].zh
  const en = harness.ctx.dictionaries['capital.watchlist'].en
  for (const key of ['holdingWeightLabel', 'holdingStepper', 'holdingStepUp', 'holdingStepDown', 'holdingName']) {
    assert.ok(typeof zh[key] === 'string' && zh[key].length > 0, `zh 缺 ${key}`)
    assert.ok(typeof en[key] === 'string' && en[key].length > 0, `en 缺 ${key}`)
  }
  // ⛔ The form-era keys, plus the three later removed ones, must stay gone: keeping holdingMenu would re-open verb-shaped row labels.
  for (const gone of ['holdingTitle', 'holdingHint', 'holdingBadNumber', 'holdingSave', 'holdingCancel',
    'holdingUnmark', 'holdingMenuMarked', 'holdingBadge', 'holdingWeightPlaceholder', 'holdingDescSuffix',
    'holdingUnset', 'holdingRange', 'holdingMenu']) {
    assert.equal(zh[gone], undefined, `zh 里还留着 ${gone}`)
    assert.equal(en[gone], undefined, `en 里还留着 ${gone}`)
  }
  // Row label, switch accessible name and tooltip share one key: one edit moves all three.
  assert.equal(zh.holdingName, '持仓')
  // The weight row title is the user-named wording 持仓比例; the old phrase may not leak back in anywhere.
  assert.equal(zh.holdingWeightLabel, '持仓比例')
  assert.equal(zh.holdingStepper.startsWith(zh.holdingWeightLabel), true, '开关悬停那句必须与行标题同词')
  assert.equal(Object.values(zh).some((value) => value.includes('占组合')), false, '「占组合比例」这一族说法已经作废')
  assert.equal(/标记|mark/i.test(zh.holdingName + en.holdingName), false, '行标签是名词，不带"标记"这个动词')
  // 0~N is computed remaining allowance, not copy, so it lives in code and both languages match by construction.
  assert.equal(Object.values(zh).some((value) => /未填/.test(value)), false, 'zh 里不许再出现"未填"这个词')
  assert.equal(Object.values(en).some((value) => /not set/i.test(value)), false, 'en 里不许再出现 Not set')
})
