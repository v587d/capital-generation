/**
 * 客户端半边闸门（`capital-watchlist/client.js`）。
 *
 * 这一层最要紧的三条，都是"错了不报错、只是行为不对"的那种：
 *  1. 座位常驻——非 Capital 会话里组件也会 mount，所以 mount 必须零 fetch；
 *  2. 菜单行只留中文（行面不带英文别名；菜单过滤只匹配 label / detail，命令名走 bare-token Enter）；
 *  3. 无轮询：一次 `run()` 只出一批请求，之后没有任何后续请求。
 *
 * 沙箱只给官方 shell 里真有的四个模块（react / react/jsx-runtime / dsh-client-store /
 * dsh-client-ui-primitives），其它 require 一律抛错——运行期偷偷 require 一个上游包
 * 是本仓踩过两次的坑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../capital-watchlist/client.js', import.meta.url), 'utf8')

/** 排版用例反复用的一条有报价行（价格位数故意超出两位，好验证 toFixed 收口）。 */
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
/** 等过客户端搜索防抖（`SEARCH_DEBOUNCE_MS = 300`）。 */
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

/**
 * `useState` 的手写替身：这些用例是**直接调用组件函数**渲染的（没有 React 运行时），
 * 所以状态要真的能改——否则「点删除 → 出确认层 → 再点确认」这条链一步都走不了。
 * 每渲染一次把游标拨回 0，跟 React 每次 render 重置 hook 序同一口径。
 */
const hookState = []
let hookCursor = 0
const resetHooks = () => { hookCursor = 0 }
/** 每条用例一套干净的组件内状态（mount 里调，避免上一用例的 pendingRemove 漏进来）。 */
const freshHooks = () => { hookState.length = 0; hookCursor = 0 }

function factoryRequire(name) {
  if (name === 'react') {
    return {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
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
    // 面板用到的四个图标都必须在这一表里（官方 98 个 Icon* 之外的名字 stub 给不出来，
    // 渲染时就是 undefined 组件——所以有下面的"图标取得到"用例兜着）。
    const icon = () => ({ type: 'icon' })
    return {
      Modal: (props) => ({ type: 'Modal', props }),
      Button: (props) => ({ type: 'Button', props }),
      Toast: (props) => ({ type: 'Toast', props }),
      IconChecklistOutlineRegular: icon,
      IconCloseOutlineRegular: icon,
      IconSearchOutlineRegular: icon,
      IconRefreshOutlineRegular: icon,
      IconTrashOutlineRegular: icon,
    }
  }
  throw new Error(`客户端 bundle 不应在运行期 require("${name}")：shell 种子只有 react 与两个官方基线包`)
}

/** 把 createElement 造出来的树压成纯文本，好断言"面板上到底显示了什么"。 */
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  const props = node.props ?? {}
  // 函数组件要真的调用一次（否则 QuoteCell 这类子组件在文本里是空的），
  // 且要把 rest 参数形态的 children 并进 props——官方 createElement 就是这么送的。
  if (typeof node.type === 'function') {
    return textOf(node.type({ ...props, children: props.children ?? node.children ?? [] }))
  }
  // 我们的 stub 把 rest 参数放在 node.children，官方形态是 props.children：两处都走。
  const kids = [props.children ?? node.children ?? [], props.footer]
  return [props.placeholder, props.title, props['aria-label'], kids].map(textOf).join(' ')
}

/** 深度遍历：函数组件（QuoteCell / TypeTag）真调用一次才看得到它们内部的类名。 */
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

/** createElement 的 rest 参数形态：官方把 children 放在 props.children，stub 放在 node.children。 */
const childrenOf = (node) => node?.props?.children ?? node?.children ?? []

/** 按类名取节点（className 是空格分隔的多类，按整词匹配，不按 substring）。 */
function classNodes(tree, name) {
  const found = []
  walkNodes(tree, (node) => {
    if (typeof node.props?.className === 'string' && node.props.className.split(' ').includes(name)) found.push(node)
  })
  return found
}

/** 假客户端上下文：够 slots / locale / commandUi / sessions 四条注入路径用。 */
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
    // 假 locale 真的存字典：这样 label/description 的断言读的是文案本体，不是 key。
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

/**
 * 面板样式本体：`installStyles` 经 `ctx.effect` 注进 head 的那一段字符串。
 * 样式类用例读**浏览器真正拿到的这一段**，不读 `client.src.cjs`——源码注释会被压掉，
 * 而 token 名是唯一要紧的东西。
 */
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
  assert.equal(entry.id, '@v587d/capital-watchlist')
  const mod = entry.factory(factoryRequire)
  assert.equal(mod.name, 'capital-watchlist')
  assert.deepEqual([...mod.inject].sort(), ['commandUi', 'locale', 'sessions', 'slots'])
  assert.equal(typeof mod.apply, 'function')
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
  // 2026-09-29 用户点名删掉 description 尾巴上的 `watchlist`：那一版是为了让 `/watch` 过滤得到这行
  // （官方的 `filterOptions` 只匹配 label / detail，命令名不参与），代价是每个中文用户都看见行尾
  // 多出一个英文单词。删了不影响 typed 路径——Enter 认的是与注册名完全相等的 bare token。
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
  // 官方 ActionSpec.run 返回 void（打开面板是动作，不是请求），所以这里等宏任务落地。
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

test('整批失败居中显示、逐条失败走行内：两种失败不混成一个', async () => {
  const refreshBody = '{"ok":true,"items":[{"thscode":"000001.SH","ticker":"000001","name":"上证指数","exchange":"SH","asset_type":"a-share-index","added_at":1,"source":"seed","quote":null}],"refreshed_at":2,"failures":[{"thscode":"000001.SH","code":"quote_unavailable"}],"error":{"code":"rate_limited","message":"限流"}}'
  const { ctx } = mount({
    fetch: async (url) => ({
      ok: true,
      status: 200,
      text: async () => (String(url).includes('/refresh') ? refreshBody : '{"ok":true,"items":[],"seeded_at":1}'),
    }),
  })
  const injected = ctx.registrations[0].declaration.inject('s10')
  await injected.surface.refresh()
  const state = injected.hooks.dialog.getSnapshot()
  assert.equal(state.error.code, 'rate_limited', '整批失败进 error（面板居中醒目显示）')
  assert.equal(state.failures['000001.SH'], 'quote_unavailable', '逐条失败只落在那一行')
  assert.equal(state.items.length, 1, '失败不许把清单清空')
})

test('credential_missing 有独立文案位（不混进"查询失败"）', async () => {
  const { ctx } = mount({ fetch: async () => ({ ok: false, status: 503, text: async () => '{"ok":false,"code":"credential_missing","message":"x"}' }) })
  const injected = ctx.registrations[0].declaration.inject('s11')
  await injected.surface.refresh()
  assert.equal(injected.hooks.dialog.getSnapshot().error.code, 'credential_missing')
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
  assert.ok(text.includes('指数'), '类型列：指数 / 股票 / ETF')
  assert.equal(classNodes(tree, 'capital-watchlist-tag-index').length, 1, '类型列画成徽标')
  assert.equal(text.includes('种子'), false, '不再区分种子与自选')
  assert.equal(text.includes('复制清单'), false, '复制清单不进面板（只留 surface 后门）')
  assert.equal(source.includes('window.confirm'), false, '⛔ 不用系统级 confirm 做二次确认')

  // 表头与数据行必须共用同一个 grid class，否则又会各自排版、串行。
  const grids = classNodes(tree, 'capital-watchlist-grid')
  assert.equal(grids.length, 2, '表头一行 + 数据一行，共用同一个 grid 类')
  // 表头四格不许借数据列的类（那是 14px 与 label-primary，混用一张表头三种字号）。
  const head = classNodes(tree, 'capital-watchlist-head')[0]
  const cells = childrenOf(head).slice(0, 4)
  assert.equal(cells.length, 4, '名称 / 类型 / 最新价·涨跌幅 / 删除 四格')
  for (const cell of cells) {
    const name = cell.props?.className
    if (name === undefined) continue
    assert.equal(name, 'capital-watchlist-quote', `表头格只许借右对齐（拿到的是「${name}」）`)
  }
  // 关闭层常驻但收起：常驻挂载才有淡入淡出，visibility:hidden 的子节点天然退出 Tab 序。
  const confirm = classNodes(tree, 'capital-watchlist-confirm')
  assert.equal(confirm.length, 1, '确认层只有一层，且默认挂载')
  assert.equal(confirm[0].props.className.includes('capital-watchlist-confirm-open'), false, '未点删除时确认层是收起的')
  assert.equal(confirm[0].props['aria-hidden'], 'true')
})

test('🔴 浅色模式闸门：面板 CSS 只准用"两套主题都读得出"的 token 角色', () => {
  // CSS 注释随 bundle 一起进浏览器，闸门只看声明体——否则注释里写的 token 名会自己触发自己。
  const css = mountedCss().replace(/\/\*[\s\S]*?\*\//g, ' ')
  // 浅底实测：--dsw-alias-label-dimmed = #e1e5ee 压在白卡片上 1.26:1，bg-layer-1 与卡片同为纯白。
  // 官方口径（docs/web-styling）是**功能 CSS 不得写主题选择器**——明暗两套值由 token 自己翻，
  // 所以修法是换角色 token，而不是给面板补一套 light 覆盖。
  assert.doesNotMatch(css, /--dsw-alias-label-dimmed/, 'dimmed 在浅色等于隐形，承载信息的文字一律 tertiary / secondary')
  assert.doesNotMatch(css, /background:\s*var\(--dsw-alias-bg-layer-1\)/, 'layer-1 在浅色与卡片同白，控件底面走 bg-module-platform')
  // 中性边框与分隔线一律 0.5px（官方：0.5px 画成一个设备像素；状态色 border 才保持 1px）。
  assert.doesNotMatch(css, /1px solid var\(--dsw-alias-border/, '中性 border 该是 0.5px 发丝线')
  // 浮层材质：官方口径是 border:0 + elevation 描边投影，不拿遮罩色 bg-mask 当影子。
  for (const surface of ['dropdown', 'confirmbox']) {
    const rule = (css.match(new RegExp(`\\.capital-watchlist-${surface} \\{[^}]*\\}`)) ?? [])[0]
    assert.ok(rule, `拿不到 .capital-watchlist-${surface} 规则`)
    assert.match(rule, /border:\s*0/, `${surface} 该按高层级表面画：border:0`)
    assert.match(rule, /box-shadow:\s*var\(--dsw-elevation-/, `${surface} 该用官方 elevation 投影分离`)
  }
  assert.doesNotMatch(css, /box-shadow:[^;}]*--dsw-alias-bg-mask/, '遮罩色不是影子的颜色')
  // 半透明菜单材质是**成对**的：--dsw-specific-menu 浅 58% / 深 45%（只有 macOS 近不透明），
  // 官方要求画它的表面同时声明 --dsw-menu-backdrop-filter（blur40 + saturate150）；只拿填充
  // 不拿模糊，浮层底下的清单行会直接透视上来（MenuSurface .material 与会话侧 .media 都是这一对）。
  const dropdownRule = (css.match(/\.capital-watchlist-dropdown \{[^}]*\}/) ?? [])[0]
  assert.match(dropdownRule, /background:\s*var\(--dsw-specific-menu\)/, '下拉该用官方菜单材质')
  assert.match(dropdownRule, /backdrop-filter:\s*var\(--dsw-menu-backdrop-filter\)/, '菜单填充必须配官方菜单模糊')
  // 深色那档描边（l3）由宿主的 [data-menu-material] 规则翻——功能 CSS 不得写主题选择器。
  assert.match(dropdownRule, /--dsw-elevation-stroke-color:\s*var\(--dsw-alias-border-l1\)/, '浅色菜单描边重绑最浅的 l1')
  // 模态遮罩**相反**：官方口径是黑色半透明填充、不模糊背景（--dsw-mask-blur 在浅色就是 none）。
  assert.doesNotMatch((css.match(/\.capital-watchlist-confirm \{[^}]*\}/) ?? [])[0], /backdrop-filter/, '模态遮罩不模糊背景')
  assert.equal((css.match(/[^-]backdrop-filter:/g) ?? []).length, 1, '模糊只许下拉那一处')
  // 滚动条：只在容器上重绑 --dsh-scrollbar-thumb（对话框属高层级表面 → l2），不写组件专用选择器。
  assert.doesNotMatch(css, /scrollbar-width|scrollbar-color|::-webkit-scrollbar/, '滚动条归 ui-theme scrollbar.css，组件只重绑变量')
  assert.match(css, /--dsh-scrollbar-thumb:\s*var\(--dsw-alias-scrollbar-bg-l2\)/)
  // 键盘焦点：官方变量表达式（宿主按主题与输入模态管环色），每个可聚焦控件都要覆盖到。
  assert.match(css, /outline:\s*var\(--dsw-focus-ring-width\) solid var\(--dsw-focus-ring-color/)
  for (const control of ['close', 'clear', 'option', 'remove', 'refresh', 'confirmbtn']) {
    assert.match(css, new RegExp(`\\.capital-watchlist-${control}:focus-visible`), `${control} 缺键盘焦点环`)
  }
  // 正圆 / 胶囊必须配 corner-shape: round，否则被全局超级椭圆平滑拧变形（官方 corner-shape spec 强制配对）。
  assert.equal((css.match(/border-radius:\s*(?:50%|999px)/g) ?? []).length, (css.match(/corner-shape:\s*round/g) ?? []).length)
  // 骨架条：浅色下 bg-skeleton 只有 4%，官方同款是配呼吸动画一起用的。
  assert.match(css, /\.capital-watchlist-skeleton[^}]*animation:/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^@]*\.capital-watchlist-skeleton \{ animation: none/)
  // 颜色字面量只许红涨绿跌两处（涨跌语义不在宿主调色板里），其余一律 token。
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

  // 未输入：下拉不在（清单区不被浮层盖住）。
  assert.equal(classNodes(render(), 'capital-watchlist-dropdown').length, 0, '空输入不挂下拉')

  surface.onQueryChange('宁德')
  assert.equal(injected.hooks.dialog.getSnapshot().dropdownOpen, true, '有输入才展开下拉')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  let tree = render()
  assert.equal(classNodes(tree, 'capital-watchlist-option').length, 2, '候选两条，一行一条')
  const text = textOf(tree)
  assert.match(text, /宁德时代/)
  assert.match(text, /已添加/, '已在清单的候选标已添加（幂等，不重复写库）')
  assert.equal(classNodes(tree, 'capital-watchlist-option')[1].props.disabled, true, '已添加那条整行禁用')
  assert.equal(classNodes(tree, 'capital-watchlist-option')[0].props.disabled, false)
  // 半透明菜单材质的深色描边（l3）由宿主的 [data-menu-material] 规则翻——功能 CSS 不许写主题选择器，
  // 属性没挂上就等于深色下只剩浅得看不见的 l1 描边。
  assert.equal(classNodes(tree, 'capital-watchlist-dropdown')[0].props['data-menu-material'], 'translucent', '下拉要挂官方半透明菜单材质属性')

  // 点候选 = 添加：打 /add，随后收起下拉并重新读清单。
  classNodes(tree, 'capital-watchlist-option')[0].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(calls.some((url) => url.includes('/add')), `点候选要走 /add（实际请求：${calls.join(' ')}）`)
  assert.equal(injected.hooks.dialog.getSnapshot().dropdownOpen, false, '添加完收起下拉（输入框也已清空）')

  // 点到框外：blur 落在搜索段之外 → 收起，但候选不清空。
  surface.onQueryChange('宁德')
  await new Promise((resolve) => setTimeout(resolve, SEARCH_WAIT_MS))
  tree = render()
  const card = classNodes(tree, 'capital-watchlist-card')[0]
  const search = classNodes(tree, 'capital-watchlist-search')[0]
  search.props.onBlur({ relatedTarget: null, currentTarget: { contains: () => false } })
  assert.equal(injected.hooks.dialog.getSnapshot().dropdownOpen, false, '焦点离开搜索段就收起下拉')
  assert.equal(injected.hooks.dialog.getSnapshot().candidates.length, 2, '收起只是折叠，不清候选')
  // 焦点收进候选行自己（鼠标点行的那一下）不算离开：候选行就住在搜索段里。
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

  // 上屏之前，输入法逐字母敲的是 input 事件：那串拼音片段既查不出东西，也不可能是用户要的词。
  const input = childrenOf(classNodes(render(), 'capital-watchlist-field')[0]).find((node) => node.type === 'input')
  assert.equal(typeof input.props.onCompositionStart, 'function', '合成开始要让 surface 知道')
  assert.equal(typeof input.props.onCompositionEnd, 'function', '上屏那一刻才是查询')
  input.props.onCompositionStart()
  for (const fragment of ['n', 'ni', 'nin', 'ning']) input.props.onChange({ target: { value: fragment } })
  await settle()
  assert.equal(searches(), 0, '⛔ 合成片段一条也不许出网')

  input.props.onCompositionEnd({ target: { value: '宁' } })
  await settle()
  assert.equal(searches(), 1, '上屏才出网，一次')

  surface.onQueryChange('宁')
  await settle()
  assert.equal(searches(), 1, '与上一次真正发出的词相同就不再出网')
  surface.onQueryChange('宁德')
  await settle()
  assert.equal(searches(), 2, '换词照发：闸只压次数，不压功能')

  // 清空：有字才有 X，点它一次请求都不发，并把这一轮搜索的痕迹全抹掉。
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

test('删除二次确认：点行内移除只出确认层，确认才打 /remove，取消不打', async () => {
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
  const removeBtn = classNodes(tree, 'capital-watchlist-remove')[0]
  assert.equal(removeBtn.props['aria-label'], '移除 宁德时代', '行内按钮的可达名点名标的')
  removeBtn.props.onClick()
  tree = render()
  const confirm = classNodes(tree, 'capital-watchlist-confirm')[0]
  assert.ok(confirm.props.className.includes('capital-watchlist-confirm-open'), '点移除只展开确认层')
  assert.match(textOf(confirm), /宁德时代 · 300750/, '确认文案带上被移除的那一条（名称 + 代码）')
  assert.deepEqual(calls.filter((url) => url.includes('/remove')), [], '确认层展开时一次 /remove 都不许发')

  // Esc 归确认层：先关确认层，不吃掉整个弹窗（官方 Modal 的 document 监听收不到这个事件）。
  let stopped = false
  classNodes(tree, 'capital-watchlist-card')[0].props.onKeyDown({ key: 'Escape', stopPropagation: () => { stopped = true } })
  assert.equal(stopped, true, '确认层开着时 Esc 必须被截住')
  tree = render()
  assert.equal(classNodes(tree, 'capital-watchlist-confirm')[0].props.className.includes('capital-watchlist-confirm-open'), false, 'Esc 关掉确认层')
  assert.equal(injected.hooks.dialog.getSnapshot().open, true, '弹窗本体还开着')

  // 取消：不发请求，行还在。
  classNodes(tree, 'capital-watchlist-remove')[0].props.onClick()
  tree = render()
  classNodes(tree, 'capital-watchlist-confirmbtn').filter((n) => n.props.className.includes('confirmdanger') === false)[0].props.onClick()
  assert.deepEqual(calls.filter((url) => url.includes('/remove')), [], '取消一个请求都不发')

  // 确认：走 /remove（乐观删除，失败由 surface.remove 自己回滚）。
  classNodes(render(), 'capital-watchlist-remove')[0].props.onClick()
  classNodes(render(), 'capital-watchlist-confirmdanger')[0].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.filter((url) => url.includes('/remove')).length, 1, '确认那一下才真删')
  assert.equal(classNodes(render(), 'capital-watchlist-confirm')[0].props.className.includes('capital-watchlist-confirm-open'), false, '确认后收起确认层')
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
  // 手工停在"清单已到、报价在途"这一刻（open() 的两步之间），看的是 refreshing=true 且 quote=null。
  injected.surface.patch({ open: true, loading: false, refreshing: true, items: [row], failures: {} })
  const tree = (() => { resetHooks(); return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t }) })()
  assert.equal(classNodes(tree, 'capital-watchlist-skeleton').length, 2, '价格与涨跌幅各一条 skeleton')
  // 只看那一格：底部一行报"未刷新"是对的（整批从没刷过），价格位上画它才是把在途说成没数据。
  const quoteCell = classNodes(tree, 'capital-watchlist-row')[0]
  assert.equal(textOf(childrenOf(quoteCell)).includes('未刷新'), false, '在途时不许把 skeleton 写成"未刷新"')
  assert.equal(classNodes(tree, 'capital-watchlist-remove')[0].props.disabled, false, '刷新在途不影响行内按钮')
})

test('⛔ 客户端不碰被禁的通道：turn-tail 卡片、自造会话事件、报告旁路、typed remote', () => {
  for (const forbidden of ['turnTail', 'capital/chart-rendered', 'capital-reports', 'final_report', 'deliverables/presented', 'dsh-api-remotes', 'ctx.remote']) {
    assert.equal(source.includes(forbidden), false, `客户端不应出现 ${forbidden}`)
  }
})
