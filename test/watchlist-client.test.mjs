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
      createElement: (type, props, ...children) => {
        // 渲染一个取不到的组件必须当场炸：真 React 里这是崩溃，这里静默通过的话，用例只会
        // 呈现"按钮不见了"这种断不出根因的红。
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
    // 这一份是**白名单**，不是官方包的全集：名字对着宿主里装的
    // `@deepseek-ai/dsh-client-ui-primitives` 的 export 表抄（面板用的九个 Icon* 全在里面）。
    // 取不到的名字当场抛错——上一版让 destructuring 拿到 `undefined` 静默通过，症状是"面板上
    // 那枚按钮不见了"，测试红得看不出根因；图标名写错在真 React 里是崩溃，在这里必须是失败。
    // 每支图标带自己的名字（displayName）：用例因此能断言"这一枚按钮画的是哪支图标"，而不只是
    // "画了个图标"——上一版所有图标共用一个匿名函数，换错图标测不出来。
    const icon = (name) => { const component = () => ({ type: 'icon' }); component.displayName = name; return component }
    const stub = {
      Modal: (props) => ({ type: 'Modal', props }),
      // 行内「更多」菜单：真身是官方 Menu primitive（portal + 模态层语义），这里只留 props 契约。
      Menu: (props) => ({ type: 'Menu', props }),
      Button: (props) => ({ type: 'Button', props }),
      Toast: (props) => ({ type: 'Toast', props }),
      IconChecklistOutlineRegular: icon('IconChecklistOutlineRegular'),
      IconCloseOutlineRegular: icon('IconCloseOutlineRegular'),
      IconEllipsisOutlineRegular: icon('IconEllipsisOutlineRegular'),
      IconGoalOutlineRegular: icon('IconGoalOutlineRegular'),
      IconListPenOutlineRegular: icon('IconListPenOutlineRegular'),
      IconPinOutlineRegular: icon('IconPinOutlineRegular'),
      IconSearchOutlineRegular: icon('IconSearchOutlineRegular'),
      IconRefreshOutlineRegular: icon('IconRefreshOutlineRegular'),
      IconTrashOutlineRegular: icon('IconTrashOutlineRegular'),
    }
    return new Proxy(stub, {
      get: (target, key) => {
        if (typeof key === 'string' && key.startsWith('Icon') && !(key in target)) {
          throw new Error(`官方图标集里没有 "${key}" 这个名字（先对着宿主的 export 表确认，再补进 stub 白名单）`)
        }
        return target[key]
      },
    })
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

/**
 * 行内「更多」菜单的节点（stub 出来的 `type` 是字符串 `'Menu'`）。
 * 触发器住在 `props.anchor` 里——`walkNodes` 只走 children，进不去 props 上的子树。
 */
function menuNodes(tree) {
  const found = []
  walkNodes(tree, (node) => { if (node.type === 'Menu') found.push(node) })
  return found
}

/** 第 `index` 行的「更多」触发器（一行一个 Menu，顺序就是行序）。 */
const moreButtonAt = (tree, index = 0) => menuNodes(tree)[index].props.anchor

/** 这一枚按钮里画的是**哪一支**图标（stub 给每支图标挂了 displayName，换错图标就会红）。 */
const iconOf = (node) => {
  const first = childrenOf(node)[0]
  return typeof first?.type?.displayName === 'string' ? first.type.displayName : null
}

/** 点开第 `index` 行的菜单并选一条：`openMoreMenu` 之后照常 `render()` 取新树。 */
function selectFromMenu(render, id, index = 0) {
  moreButtonAt(render(), index).props.onClick()
  menuNodes(render())[index].props.onSelect(id)
  return render()
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

/**
 * src ↔ bundle 的同步闸门。`client.src.cjs` 要经 `npm run build:watchlist-client` 才变成浏览器
 * 真正加载的 `client.js`——**改了源码忘了 build，本文件所有行为断言都不会红**（2026-09-30 实测：
 * 面板上没有新按钮，一路查下去是 bundle 还停在上一轮）。这里把源码的字典值与 CSS 规则逐条拿到
 * bundle 这一侧对账，失配就点名要跑哪条命令。
 */
test('⛔ 源码已改、bundle 还是旧的：字典值与 CSS 规则必须在 client.js 里逐字命中', () => {
  const srcSource = readFileSync(new URL('../capital-watchlist/client.src.cjs', import.meta.url), 'utf8')
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
  // ⛔ CSS 住在一个模板字符串里：注释里出现一个反引号（或 `${`）就把这段字符串**提前收口**，
  // 剩下的样式变成代码——esbuild 常常照样通过，症状是 bundle 里凭空少一段样式（本仓 2026-10-01 两次踩中）。
  assert.equal(/`|\$\{/.test(cssSource), false, 'CSS 模板里的注释不许用反引号 / `${`：要引用类名就写裸名字')
  for (const line of cssSource.split('\n')) {
    if (!line.includes('{') || !line.includes('}')) continue
    if (line.trimStart().startsWith('/*') || line.startsWith(' ')) continue
    assert.equal(css.includes(line), true, `⛔ CSS 规则没进 bundle：跑 npm run build:watchlist-client（${line.slice(0, 60)}…）`)
  }
  // 段的**总量**也要对得上：只查"每条规则都在"会漏掉"整段被截断"（上面那条反引号事故的第二半）。
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
  // 先有一次真的落过地：否则"全批失败时页脚不许往前走"这条断言等于没测（初值本来就是 null）。
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

  // 位置：报错跟着它的动词走。此前红字飘在输入框下方，离「刷新报价」隔了一整张表。
  const footcol = classNodes(tree, 'capital-watchlist-footcol')[0]
  assert.ok(footcol, '底部左列装着刷新按钮与它自己的失败行')
  assert.equal(childrenOf(footcol).length, 2, '左列两行：按钮 + 失败行')
  assert.match(textOf(classNodes(footcol, 'capital-watchlist-notice')[0]), /行情服务限流/)
  assert.equal(classNodes(footcol, 'capital-watchlist-refresh').length, 1, '失败行与刷新按钮同列（红 = 数据不可信那一档）')
  assert.equal(textOf(classNodes(tree, 'capital-watchlist-search')[0]).includes('行情服务限流'), false, '⛔ 输入框那一带不画整批失败')
  const notice = classNodes(tree, 'capital-watchlist-notice')[0]
  assert.equal(notice.props.role, 'alert')
  assert.equal(notice.props['data-code'], 'rate_limited')

  // 这一行从来没有过值 → 红色 `—`（数据不可信），原因在 tooltip。
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

  // 两行都失败 = 满屏都陈旧：这时"其他标的仍是上一次成功快照"是假话，它把"整体不可信"
  // 说成了"只有几行有问题"。
  injected.surface.patch({ open: true, loading: false, items: [rowA, rowB] })
  await injected.surface.refresh()
  let said = noticeText()
  assert.match(said, /刷新超时/)
  assert.equal(said.includes('上一次成功快照'), false, '⛔ 全批失败不许挂"其他标的仍是…"')

  // 一行失败、一行这次真取到了数 → "其他"确实存在，后缀回来。
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

  // 出网整个失败（一次都没成）：屏上没有旧快照时同样不许说"仍是上一次成功快照"。
  const none = { thscode: '600000.SH', ticker: '600000', name: '浦发银行', exchange: 'SH', asset_type: 'a-share', added_at: 1, source: 'user', quote: null }
  const dead = mount({ fetch: async () => ({ ok: false, status: 503, text: async () => '{"ok":false,"code":"fuyao_unavailable","message":"x"}' }) })
  const injectedC = dead.ctx.registrations[0].declaration.inject('s-suffix-dead')
  injectedC.surface.patch({ open: true, loading: false, items: [none] })
  await injectedC.surface.refresh()
  resetHooks()
  const treeC = dead.ctx.registrations[0].component({ ...injectedC, useDialog: (selector) => selector(injectedC.hooks.dialog.getSnapshot()), t: (key) => dead.ctx.dictionaries['capital.watchlist'].zh[key] ?? key })
  const saidC = textOf(classNodes(treeC, 'capital-watchlist-notice')[0])
  assert.match(saidC, /行情服务暂时不可用/)
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

  // 添加失败（清单已满）讲的是清单，与输入框里是什么字无关。
  await surface.add(candidate)
  assert.equal(injected.hooks.dialog.getSnapshot().addError.code, 'list_full')
  surface.onQueryChange('宁德时代')
  const after = injected.hooks.dialog.getSnapshot()
  assert.equal(after.addError.code, 'list_full', '⛔ 改一个字不许把 list_full 抹掉')
  assert.equal(after.searchError, null, '改字清的是上一次搜索的失败（新的在途请求已经取代它）')
  assert.match(textOf(classNodes(render(), 'capital-watchlist-adderror')[0]), /自选股最多 30 条/, '那句上限的数字跟着宿主回包的 limit 走')
  // 没有 `limit` 的回包（旧宿主）不许把 `{max}` 原样印在面板上：退成一句不带数字的话。
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
  // 服务端为了不骗用户，专门把域失败报成 store_unavailable（而不是空清单）。客户端这一路
  // 曾经只把 loading 关掉、items 留空 → 面板显示"还没有自选股，用上面的输入框添加。"
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

test('401 / 403 有自己的文案位：登录失效不许说成「行情服务暂时不可用」', async () => {
  // host 侧被围栏挡下时回的是 text/plain（没有 JSON code），状态码是唯一的判据。
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
    assert.equal(textOf(tree).includes('行情服务暂时不可用'), false, '⛔ 把认证失效说成服务不可用 = 让用户等一个不会自己恢复的错误')
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
  assert.ok(text.includes('指数'), '类型徽标：指数 / 股票 / ETF')
  assert.equal(classNodes(tree, 'capital-watchlist-tag-index').length, 1, '类型画成徽标')
  // 类型从独立一列并进名称列第二行（2026-09-29 用户反馈"类型这一列挺累赘"）：
  // 代码与徽标同处一个 codeline，间距由 CSS 的 gap 负责；行内只此一处徽标。
  const codeline = classNodes(tree, 'capital-watchlist-codeline')
  assert.equal(codeline.length, 1, '代码与徽标同行（一行数据一个 codeline）')
  assert.match(textOf(codeline[0]), /399001/, '代码在 codeline 里')
  assert.match(textOf(codeline[0]), /指数/, '徽标在代码右侧（同一行容器）')
  assert.equal(classNodes(codeline[0], 'capital-watchlist-tag-index').length, 1, '徽标就住在 codeline 里，不再单占一列')
  assert.equal(text.includes('种子'), false, '不再区分种子与自选')
  assert.equal(text.includes('复制清单'), false, '复制清单不进面板（只留 surface 后门）')
  assert.equal(source.includes('window.confirm'), false, '⛔ 不用系统级 confirm 做二次确认')

  // 行内动作只剩一个「更多」键（删除降级成菜单里的一条）：它必须是官方 Menu 的锚点。
  const menu = menuNodes(tree)[0]
  assert.equal(typeof menu, 'object', '每行一个官方 Menu 锚点')
  assert.equal(moreButtonAt(tree).props['aria-haspopup'], 'menu')
  assert.equal(moreButtonAt(tree).props['aria-expanded'], false, '未展开时 aria-expanded 为假')
  assert.equal(menu.props.portal, true, '清单区是滚动容器：菜单必须 portal 到 body，否则被裁')
  assert.equal(menu.props.align, 'end', '菜单贴右缘展开（贴着「更多」键）')

  // 表头与数据行必须共用同一个 grid class，否则又会各自排版、串行。
  const grids = classNodes(tree, 'capital-watchlist-grid')
  assert.equal(grids.length, 2, '表头一行 + 数据一行，共用同一个 grid 类')
  // 表头三格不许借数据列的类（那是 14px 与 label-primary，混用一张表头三种字号）。
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
  // 数字右对齐 → 收笔位置永远贴着一列的右缘，所以"离按钮远一点"只能由这一格的 padding-right 给；
  // 表头借同一个类跟着左移，标签才与它底下的数字对齐。nowrap 是这 12px 的配套：吃掉宽度后
  // 「最新价 / 涨跌幅」不许换行把表头撑成两行。
  assert.match(mountedCss(), /\.capital-watchlist-quote \{[^}]*padding-right: 12px/, '报价与动作区之间那口气只有这一个来源')
  assert.match(mountedCss(), /\.capital-watchlist-head \{[^}]*white-space: nowrap/, '表头标签不参与换行')
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
  for (const control of ['close', 'clear', 'option', 'more', 'predict', 'review', 'refresh', 'confirmbtn']) {
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

test('⛔ 输入法丢掉 compositionend：最后一个 input 事件（isComposing=false）必须把搜索解开闩', async () => {
  // 上一版的复位只挂在 compositionend 上：那一格状态在 surface 的实例字段里，渲染看不见，
  // 事件一丢就永久为真——症状是输入框再也查不出任何东西，而且**任何地方都不报错**。
  // 现在认原生 `input` 事件自带的 `isComposing`：它由浏览器逐事件给出，丢不掉。
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

  // 真实浏览器：compositionstart 一定来，丢的是**上屏那一下的 compositionend**（某些第三方输入法
  // 在候选窗里直接选词时就是这样）。每个 input 事件都带着自己的 isComposing，这一个丢不掉。
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

  // noHit 那一档留给"真的查过、真的没有"：空回包之后再说"没有匹配的标的"才是诚实的。
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

  // 点「更多」只展开菜单：菜单里是「置顶 / 移除」，此刻一个请求都不许发。
  more.props.onClick()
  tree = render()
  const menu = menuNodes(tree)[0]
  assert.equal(menu.props.open, true, '点「更多」展开这一行的菜单')
  assert.deepEqual([...menu.props.items].map((entry) => entry.id), ['pin', 'remove'], '菜单两条：置顶 + 移除')
  assert.deepEqual([...menu.props.items].map((entry) => entry.label), ['置顶', '移除'])
  assert.equal(menu.props.items[0].disabled, true, '只有一行时「置顶」没有位移，置灰')
  assert.equal(menu.props.items[1].danger, true, '「移除」是破坏性行（danger）')
  assert.deepEqual(calls.filter((url) => url.includes('/remove') || url.includes('/pin')), [], '只展开菜单，一个请求都不许发')

  // 再点一次同一个键：收起（同一个键既开又关）。
  moreButtonAt(render()).props.onClick()
  assert.equal(injected.hooks.dialog.getSnapshot().rowMenu, null, '再点「更多」收起菜单')

  // 选「移除」才进确认层（删除逻辑与旧版一致：面板内二次确认 + /remove）。
  tree = selectFromMenu(render, 'remove')
  const confirm = classNodes(tree, 'capital-watchlist-confirm')[0]
  assert.ok(confirm.props.className.includes('capital-watchlist-confirm-open'), '选移除只展开确认层')
  assert.match(textOf(confirm), /宁德时代 · 300750/, '确认文案带上被移除的那一条（名称 + 代码）')
  assert.equal(injected.hooks.dialog.getSnapshot().rowMenu, null, '选中之后菜单收起')
  assert.deepEqual(calls.filter((url) => url.includes('/remove')), [], '确认层展开时一次 /remove 都不许发')

  // Esc 归确认层：先关确认层，不吃掉整个弹窗（官方 Modal 的 document 监听收不到这个事件）。
  let stopped = false
  classNodes(tree, 'capital-watchlist-card')[0].props.onKeyDown({ key: 'Escape', stopPropagation: () => { stopped = true } })
  assert.equal(stopped, true, '确认层开着时 Esc 必须被截住')
  tree = render()
  assert.equal(classNodes(tree, 'capital-watchlist-confirm')[0].props.className.includes('capital-watchlist-confirm-open'), false, 'Esc 关掉确认层')
  assert.equal(injected.hooks.dialog.getSnapshot().open, true, '弹窗本体还开着')

  // 取消：不发请求，行还在。
  classNodes(selectFromMenu(render, 'remove'), 'capital-watchlist-confirmbtn').filter((n) => n.props.className.includes('confirmdanger') === false)[0].props.onClick()
  assert.deepEqual(calls.filter((url) => url.includes('/remove')), [], '取消一个请求都不发')

  // 确认：走 /remove（乐观删除，失败由 surface.remove 自己回滚）。
  selectFromMenu(render, 'remove')
  classNodes(render(), 'capital-watchlist-confirmdanger')[0].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.filter((url) => url.includes('/remove')).length, 1, '确认那一下才真删')
  assert.equal(classNodes(render(), 'capital-watchlist-confirm')[0].props.className.includes('capital-watchlist-confirm-open'), false, '确认后收起确认层')
})
test('⛔ 确认层开着时关掉面板：重开必须是干净清单，不是上一轮的「确认移除」', async () => {
  // 面板关闭走的是 `return null`（座位常驻，组件不卸载），所以"待移除哪一行"必须住 store：
  // 住在 useState 上就跨开合活下来。用户的遭遇是——点遮罩把面板收掉、下次 /watchlist 重开，
  // 第一屏是一层「确定将上一轮那只票移除吗？」压在清单上，顺手一按删掉的是这次根本没动的标的。
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
  selectFromMenu(render, 'remove')
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
  // 单闸门"同一时刻只允许一次刷新在途"的实现是：有在途就把**那一个** promise 交出去。
  // 开面板自动刷的那一批是为上一批标的出的网，回包里没有刚加的这只——于是新行停在「未刷新」，
  // 而页脚的时间却显示刚刚刷过。清单里有 ETF 时首刷要跑几十秒，这个窗口宽到用户必然撞上。
  const stored = { thscode: '300750.SZ', ticker: '300750', name: '宁德时代', exchange: 'SZ', asset_type: 'a-share', added_at: 1, source: 'user', quote: null }
  const priced = { ...stored, quote: { price: 211.52, change_pct: 1.234, captured_at: 2, source_ts: 1 } }
  const candidate = { thscode: stored.thscode, ticker: stored.ticker, name: stored.name, exchange: stored.exchange, asset_type: stored.asset_type, in_list: false }
  const calls = []
  let inStore = false
  let refreshes = 0
  // 首刷用**手动闸门**卡住，而不是 setTimeout：300ms 的搜索防抖比任何现实的延迟都长，
  // 用时间差造窗口，测出来的其实是"延迟够不够小"，不是折叠本身（第一版就这么假绿过）。
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
        // 第一次是开面板那一轮：闸门卡住，它**在添加之后**才落地。宿主按当刻的清单回包——
        // 新行在里面，但这一行没被问过：报价 null、failures 里也没有它（"没被问过"的形状）。
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

  // 关键不是次数，是**顺序**：补发的那一次必须发生在 /add 之后。没有补发，整场就只有开面板
  // 那一次刷新（它在 /add 之前），新行永远停在报价为空的那一档。
  assert.ok(refreshes >= 2, `添加之后必须补发一次刷新（实际 /refresh 次数 ${refreshes}）`)
  assert.ok(calls.lastIndexOf('/refresh') > calls.indexOf('/add'),
    `⛔ 最后一次 /refresh 必须排在 /add 之后（实际顺序：${calls.join(' ')}）`)
  const quoted = textOf(childrenOf(classNodes(render(), 'capital-watchlist-row')[0]))
  assert.match(quoted, /211\.52/, '新行当场就有最新价')
  assert.equal(quoted.includes('未刷新'), false, '⛔ 刚加进来的标的不能停在「未刷新」')
})

test('⛔ 添加已经落库之后清单读不回来：不许报成「添加失败」，也不许再点一次', async () => {
  // 上一版整段在一个 try 里：`/add` 已经成功写进域，紧跟着的 `/list` 一次 503 就被 catch
  // 抓住，面板于是画出"自选股已达上限"式的黄字（addError 走的是**添加**这句话的槽位）。
  // 用户看到的是一句"没加成"，实际东西已经在清单里——照着那句话再点一次，就是把同一只票
  // 往满了的清单上再撞一次。读失败有自己的位置（列表那一片的 `loadError`），不占添加那句话。
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
      // 添加之后的读清单 / 刷报价全挂：域暂时不可用。
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
  // ⚠️ 清单数组来自 vm 里的 JSON.parse（跨 realm）：断言前先摊回测试这一侧的同型数组。
  const codes = () => [...injected.hooks.dialog.getSnapshot().items.map((row) => row.thscode)]
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  surface.open()
  for (let round = 0; round < 5; round += 1) await settle()

  // 第一行没有可置顶的位移 → 它的「置顶」置灰；第二行可以。
  let tree = render()
  assert.deepEqual(menuNodes(tree).map((menu) => menu.props.open), [false, false], '初始两行的菜单都收着')
  assert.equal(menuNodes(tree)[0].props.items[0].disabled, true, '第一行的「置顶」置灰')
  assert.equal(menuNodes(tree)[1].props.items[0].disabled, false, '第二行可以置顶')

  tree = selectFromMenu(render, 'pin', 1)
  await settle()
  assert.deepEqual(calls, ['/pin'], `置顶只打一次 /pin（实际：${calls.join(' ')}）`)
  assert.deepEqual(codes(), ['300750.SZ', '000001.SH'], '置顶的行到了第一行')
  assert.equal(injected.hooks.dialog.getSnapshot().rowMenu, null, '选中后菜单收起')
  // 位移之后第一行换成刚置顶的那条：置灰跟着行序走，不是跟着标的走。
  assert.equal(menuNodes(tree)[0].props.items[0].disabled, true, '新的第一行「置顶」置灰')
  assert.equal(menuNodes(tree)[1].props.items[0].disabled, false)

  // 失败回滚：宿主写不进域时行得弹回点击前的顺序（与删除同一条口径）。
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
  // 手工停在"清单已到、报价在途"这一刻（open() 的两步之间），看的是 refreshing=true 且 quote=null。
  injected.surface.patch({ open: true, loading: false, refreshing: true, items: [row], failures: {} })
  const tree = (() => { resetHooks(); return ctx.registrations[0].component({ ...injected, useDialog: (selector) => selector(injected.hooks.dialog.getSnapshot()), t }) })()
  assert.equal(classNodes(tree, 'capital-watchlist-skeleton').length, 2, '价格与涨跌幅各一条 skeleton')
  // 只看那一格：底部一行报"未刷新"是对的（整批从没刷过），价格位上画它才是把在途说成没数据。
  const quoteCell = classNodes(tree, 'capital-watchlist-row')[0]
  assert.equal(textOf(childrenOf(quoteCell)).includes('未刷新'), false, '在途时不许把 skeleton 写成"未刷新"')
  assert.equal(moreButtonAt(tree).props.disabled, false, '刷新在途不影响行内「更多」键')
})

test('行内「预测」与「复盘」：各追加自己那句话、不发送、不替换草稿；没插成功就不收面板', () => {
  const inserted = []
  let place = true
  const inputActions = {
    // 框架发给每个 session scope 座位组件的标准件：captureInsertion 拿带 revision 的光标位，
    // insertText 按那个 span 插进官方 Lexical 编辑器。setDraft / submit 在这里一旦被调用就是错。
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

  // 位置就是需求本身（2026-10-01 用户第四轮点名「放进操作列」）：三个动作同住最后一列，
  // document order 就是 Tab 序，所以这一条同时钉的是键盘走位。
  // ⛔ 遍历必须**一次走完按文档序收**：上一版是"按名单逐个名字各遍历一次"，收出来的数组
  // 永远等于名单本身——把报价挪到名称前面它都不会红。
  const WATCH = ['capital-watchlist-namewrap', 'capital-watchlist-quote', 'capital-watchlist-rowactions', 'capital-watchlist-predict', 'capital-watchlist-review', 'capital-watchlist-actions']
  const order = []
  walkNodes(rowOf(render()), (node) => {
    const classes = typeof node.props?.className === 'string' ? node.props.className.split(' ') : []
    const hit = classes.find((name) => WATCH.includes(name))
    if (hit !== undefined) order.push(hit)
  })
  assert.deepEqual(order, ['capital-watchlist-namewrap', 'capital-watchlist-quote', 'capital-watchlist-rowactions', 'capital-watchlist-predict', 'capital-watchlist-review', 'capital-watchlist-actions'])
  // 三列：名称 / 报价 / 动作那一簇。列宽必须是定值 px——表头与数据行是两个独立 grid 容器，
  // 只有定值才让两行的列边线对齐（写成 auto 表头就跟着数据串行）。
  assert.match(mountedCss(), /grid-template-columns: 1fr 92px 84px/, '两枚图标键 + 「更多」挤进最后一列，宽度跟着内容定死')
  assert.match(mountedCss(), /\.capital-watchlist-rowactions \{[^}]*justify-content: flex-end/, '动作簇贴右缘：表头「操作」与它同一条边线')
  assert.match(mountedCss(), /\.capital-watchlist-namewrap \{[^}]*min-width: 0/, '名称格必须能收缩：长名称靠 ellipsis 兜，不许顶宽列')
  assert.equal(mountedCss().includes('capital-watchlist-nameline'), false, '动作挪走之后 nameline 就是死样式：留着等于面板上多一个没人渲染的类')
  assert.match(mountedCss(), /\.capital-watchlist-review, \.capital-watchlist-predict \{[^}]*background: transparent/, '图标键与「更多」同笔：透明底、无描边')
  // ⛔ 图标化 = 画面上不许出现字样（用户点名"不要显示中文，tooltip 提示"）。字面只许活在
  // title 与 aria-label 里；谁把 t('predict') 放回 children，这条就红。
  for (const name of ['capital-watchlist-predict', 'capital-watchlist-review']) {
    const words = childrenOf(buttonIn(render(), name)).filter((child) => typeof child === 'string')
    assert.deepEqual(words, [], `${name} 的可见内容必须是图标，不是字`)
  }
  // 图标选的是**语义直**的那两支（用户点名上一对"一个表跳转、一个表时间，联想太丰富"）：
  // 靶心 = 那句话要的是未来点位；带笔的清单 = 对着已发生的行情写一遍。
  assert.equal(iconOf(buttonIn(render(), 'capital-watchlist-predict')), 'IconGoalOutlineRegular', '预测 = 靶心')
  assert.equal(iconOf(buttonIn(render(), 'capital-watchlist-review')), 'IconListPenOutlineRegular', '复盘 = 带笔的清单')
  // 「更多」触发器住在 Menu 的 `props.anchor` 里（classNodes 走不到，见 moreButtonAt 的注释）。
  assert.equal(iconOf(moreButtonAt(render())), 'IconEllipsisOutlineRegular', '「更多」仍是省略号')
  assert.equal(buttonIn(render(), 'capital-watchlist-predict').props.disabled, false, '两枚按钮都可用')

  // 先取到按钮再点：点成功会收面板，那时组件 `return null`，树里已经没有这一格了。
  const predictButton = buttonIn(render(), 'capital-watchlist-predict')
  assert.equal(predictButton.props.title, zh.predictTip, 'tooltip 走字典：图标化之后，这一句就是它唯一的说明')
  assert.equal(predictButton.props['aria-label'], `${zh.predict} ${QUOTED.name}`, '读屏标签 = 动作 + 标的名')
  predictButton.props.onClick()
  assert.equal(inserted.length, 1)
  // 句子归文案（字典 `<kind>PromptPrefix` / `<kind>PromptSuffix`），这里只钉**形状**：
  // 名称 (thscode · 类型) 三段齐全、顺序如此、前后缀逐字取自字典——改措辞不许惊动这条用例。
  assert.equal(inserted[0].text, `${zh.predictPromptPrefix}深证成指 (399001.SZ · 指数)${zh.predictPromptSuffix}`)
  assert.match(inserted[0].text, /399001\.SZ/, 'thscode 必须在句子里：Agent 靠它认标的')
  assert.match(inserted[0].text, /· 指数\)/, '类型必须在句子里：股票 / 指数 / ETF 是三个不同的上游端点')
  assert.deepEqual(inserted[0].span, { start: 4, end: 4, draftRev: 7 }, 'captureInsertion 的 span 必须原样交回（revision 守卫在官方那边）')
  assert.equal(injected.hooks.dialog.getSnapshot().open, false, '写进去了就收面板，让用户在输入框里看这句话、自己点发送')

  // 复盘是同一形状、另一句话：两个按钮不许递出同一句请求。
  open()
  const reviewButton = buttonIn(render(), 'capital-watchlist-review')
  assert.equal(reviewButton.props.title, zh.reviewTip, '复盘的 tooltip 也走字典')
  assert.equal(reviewButton.props['aria-label'], `${zh.review} ${QUOTED.name}`, '读屏标签 = 动作 + 标的名')
  reviewButton.props.onClick()
  assert.equal(inserted.length, 2)
  assert.equal(inserted[1].text, `${zh.reviewPromptPrefix}深证成指 (399001.SZ · 指数)${zh.reviewPromptSuffix}`)
  assert.notEqual(inserted[1].text, inserted[0].text, '⛔ 预测与复盘不许插同一句话')
  assert.equal(injected.hooks.dialog.getSnapshot().open, false)

  // 插不进去（草稿在这一下变了 / 正在提交锁住编辑器）：面板保持打开，用户看得见这一行，再点一次就是。
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
