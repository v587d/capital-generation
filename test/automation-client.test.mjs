import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { DEFAULT_MAX_STEPS, DEFAULT_MAX_TOOL_CALLS } from '../automation/defaults.js'

/**
 * Executes the built automation client bundle in a minimal DOM sandbox. The browser-only apply
 * path is where `style.dataset[own-hyphenated-name]` once threw and left the whole web boot in
 * `loading`; a source-level assertion cannot see that class of failure.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(ROOT, 'automation', 'client.js'), 'utf8')
const clientSource = readFileSync(join(ROOT, 'automation', 'client.src.cjs'), 'utf8')

function element() {
  const dataset = new Proxy({}, {
    set(target, property, value) {
      if (String(property).includes('-')) throw new SyntaxError(`invalid DOMStringMap property: ${String(property)}`)
      target[property] = value
      return true
    },
  })
  return {
    dataset,
    style: {},
    setAttribute() {},
    appendChild() {},
    remove() {},
  }
}

function loadBundle() {
  let entry
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { entry = value } } },
    document: {
      createElement: () => element(),
      querySelector: () => null,
      head: { appendChild() {} },
    },
    console,
  }
  runInNewContext(source, sandbox)
  assert.ok(entry, 'bundle 必须调用 window.__ModuleLoader__.load 登记模块')
  return entry
}

function factoryRequire(name, createElement) {
  if (name === 'react') {
    return {
      createElement: createElement ?? (() => ({})),
      useEffect() {},
      useState: (value) => [value, () => {}],
      useRef: () => ({ current: null }),
    }
  }
  if (name === '@deepseek-ai/dsh-client-ui-primitives') {
    const empty = () => null
    const names = [
      'IconAlarmClockOutlineRegular', 'IconChecklistOutlineRegular', 'IconChevronLeftOutlineRegular',
      'IconChevronRightOutlineRegular', 'IconClockOutlineRegular', 'IconCopyOutlineRegular',
      'IconEditOutlineRegular', 'IconEllipsisOutlineRegular', 'IconFolderOpenOutlineRegular',
      'IconGaugeOutlineRegular', 'IconGlobeOutlineRegular', 'IconInfoOutlineRegular',
      'IconLightOutlineMedium', 'IconListPenOutlineRegular', 'IconPauseOutlineRegular', 'IconPlayOutlineRegular',
      'IconPlusOutlineRegular', 'IconRefreshOutlineRegular', 'IconSearchOutlineRegular',
      'IconSparkleRegular', 'IconTrashOutlineRegular', 'IconWarningOutlineRegular',
      'Menu', 'MenuItemButton', 'Modal', 'Switch',
    ]
    return Object.fromEntries(names.map((key) => [key, empty]))
  }
  throw new Error(`客户端 bundle 不应在运行期 require("${name}")`)
}

test('客户端 bundle：apply 在真实 DOM 形状下不抛错，注册 main 与 sidebar.panellist', () => {
  const mod = loadBundle().factory(factoryRequire)
  assert.equal(mod.name, 'capital-automation')
  assert.deepEqual([...mod.inject], ['slots'])
  const registrations = []
  const logs = []
  assert.doesNotThrow(() => mod.apply({
    get: (name) => (name === 'uiWorkspace' ? { openSession() {} } : undefined),
    effect: (callback) => { callback(); return () => {} },
    slots: {
      inject: (slot, callback) => { assert.ok(['main', 'sidebar.panellist'].includes(slot)); return callback() },
      register: (declaration, component) => { registrations.push({ declaration, component }); return () => {} },
    },
    logger: { info: (message) => { logs.push(message) } },
  }))
  assert.deepEqual(registrations.map((item) => item.declaration.name), ['main', 'sidebar.panellist'])
  assert.equal(registrations[0].declaration.key, 'capital-automation')
  assert.equal(registrations[1].declaration.id, 'capital-automation')
  assert.ok(logs.length > 0)
  assert.equal(source.includes('dataset['), false, '样式键必须走 setAttribute，DOMStringMap 不接受带连字符的属性名')
  assert.doesNotMatch(source, /zh\.state\s*\)/, '状态字典对象不能直接作为 React child（error #31）')
  assert.doesNotMatch(source, /zh\.status\s*\)/, '状态字典对象不能直接作为 React child（error #31）')
  assert.match(source, /workspaceField/, '任务详情必须能选择工作区')
  assert.match(source, /workspaceId:/, '工作区 id 必须进入任务请求')
  assert.match(source, /modeHint:/, '输出侧重需要说明它不改变 preset')
  assert.match(source, /presetValue:/, '页面必须显示固定的 Agent preset')
  assert.match(source, /budgetHint:/, '页面必须说明预算覆盖子 Agent 与 PTC 派发')
  assert.match(
    clientSource,
    new RegExp(`maxSteps: ${DEFAULT_MAX_STEPS}, maxToolCalls: ${DEFAULT_MAX_TOOL_CALLS}`),
    '新建任务向导的默认预算必须跟 defaults.js 一致',
  )
  assert.doesNotMatch(clientSource, /if \(selectedId === null && nextTasks\.tasks\.length > 0\) setSelectedId/, '轮询不能捕获初始 selectedId 并强制跳回首项')
  assert.match(clientSource, /const selectedIdRef = useRef\(null\)/, '选中任务必须通过 ref 供轮询与异步回调读取最新值')
  assert.match(clientSource, /const refreshInFlightRef = useRef\(null\)/, '刷新请求必须单飞，避免慢请求叠加')
  assert.match(clientSource, /requestSequence !== refreshSequenceRef\.current/, '刷新结果必须做版本校验')
  assert.match(clientSource, /requestSequence !== detailSequenceRef\.current/, '详情结果必须做版本校验')
  assert.match(clientSource, /onChanged: async \(taskId\)/, '刷新回调必须携带被操作任务 id')
  assert.match(clientSource, /await onChanged\(detail\.task\.id\)/, '操作完成后只应由 act 统一刷新一次')
  assert.doesNotMatch(clientSource, /api\.run\(task\.id\); await onChanged\(\)/, '手动运行不能重复刷新')
  assert.doesNotMatch(clientSource, /api\.action\(task\.id, '(?:activate|pause|hibernate|copy)'\); await onChanged\(\)/, '任务动作不能重复刷新')
  assert.doesNotMatch(clientSource, /api\.cancel\(run\.id\); await onChanged\(\)/, '取消运行不能重复刷新')
  assert.match(clientSource, /typeof patch === 'function' \? patch\(current\) : patch/, '设置草稿更新必须基于最新 state 合并')
  assert.match(clientSource, /AbortController/, 'API 请求必须有可取消的超时边界')
  assert.match(clientSource, /20_000/, 'API 请求超时必须保持在有界值')
  assert.match(clientSource, /visibilityState !== 'hidden'/, '页面隐藏时不得继续轮询')
  assert.match(clientSource, /visibilitychange/, '页面恢复可见时应立即刷新')
  assert.match(clientSource, /api\.runs\(/, '运行页必须读取 /runs，而不是只依赖任务详情')
  assert.match(clientSource, /capital-automation-runmetaline/, '运行行必须把时间、耗时与步骤放在标题下一行')
  assert.match(clientSource, /capital-automation-runningactions/, '运行中任务的取消与详情必须成组靠右，不能跟在元数据后面')
  {
    const runlineAt = clientSource.indexOf("className: 'capital-automation-runline'")
    const titleAt = clientSource.indexOf('capital-automation-runtitle', runlineAt)
    const statusAt = clientSource.indexOf('h(RunStatus', runlineAt)
    assert.ok(runlineAt >= 0 && titleAt > runlineAt && statusAt > titleAt, '运行状态必须排在任务标题之后')
  }
  assert.match(clientSource, /setErrorsOpen/, '错误条数徽标必须可点击展开错误详情')
  assert.match(clientSource, /capital-automation-runerrors/, '展开的错误详情必须有独立的行内容器')
  assert.match(clientSource, /api\.notifications\(\)/, '页面必须读取 profile 级通知，standby 通知才可见')
  assert.match(clientSource, /task\.origin === 'builtin' && task\.state === 'dormant'/, '休眠的内置任务必须进入模板区')
  assert.match(clientSource, /capital-automation-template/, '模板区必须有可添加卡片')
  {
    const cardAt = clientSource.indexOf('function TemplateCard')
    const titleRowAt = clientSource.indexOf("className: 'capital-automation-templatetitlerow'", cardAt)
    const categoryAt = clientSource.indexOf('categoryLabel(task.category)', titleRowAt)
    assert.ok(cardAt >= 0 && titleRowAt > cardAt && categoryAt > titleRowAt, '模板卡标题必须带分类标签，和任务行保持一致')
    const enableAt = clientSource.indexOf("'data-variant': 'primary', onClick: () => onEnable(task)", titleRowAt)
    assert.ok(enableAt > categoryAt, '模板卡的添加按钮必须是品牌色实心主按钮，不能只靠 hover 区分')
  }
  assert.match(clientSource, /function activationLabel\(task\)/, '模板添加与暂停恢复必须共用一处动作文案')
  assert.match(clientSource, /task\?\.state === 'dormant' \? zh\.add : zh\.activate/, '模板的激活动作叫「添加」，暂停任务仍叫「启用」')
  assert.match(clientSource, /task\?\.state === 'dormant' \? IconPlusOutlineRegular : IconPlayOutlineRegular/, '「添加」用加号图标，和「立即运行」的播放图标区分')
  assert.match(clientSource, /task\?\.sourceBuiltinId === 'morning-brief'\) return IconLightOutlineMedium/, '早间资讯必须用 Light 图标，不能和盘后公告共用地球图标')
  assert.match(clientSource, /zh\.templateAdding : zh\.templateAdd/, '模板卡按钮文案是「添加 / 添加中」')
  assert.match(clientSource, /state: \{ dormant: '未添加'/, '模板未加入任务列表时状态显示「未添加」')
  assert.doesNotMatch(clientSource, /templateEnable|templateEnabling|去启用模板|启用一个内置模板/, '模板添加动作不再写成启用')
  assert.match(clientSource, /capital-automation-filtercount/, '筛选计数必须渲染成圆圈数字')
  assert.match(clientSource, /'data-variant': detail\.task\.state === 'active' \? 'primary' : undefined/, '已启用任务以「立即运行」为主按钮')
  assert.match(clientSource, /'data-variant': detail\.task\.state === 'active' \? undefined : 'primary'/, '未添加模板或暂停任务以「添加」/「启用」为主按钮，不能只靠 hover 区分')
  assert.match(clientSource, /capital-automation-tasktitlerow \.capital-automation-tasktags/, '分类与来源标签必须和任务标题同排')
  assert.match(clientSource, /function clipTagLabel\(label, limit = 12\)/, '任务标签文案上限必须是 12 个字')
  assert.doesNotMatch(clientSource, /templateSectionHint|templateCount/, '模板区标题不再带说明和数量')
  assert.match(clientSource, /capital-automation-history/, '页面必须有运行历史概览')
  assert.match(clientSource, /capital-automation-runerrorbadge/, '运行行出现错误时必须显示徽标')
  assert.match(clientSource, /zh\.runErrors\.replace\('\{n\}'/, '错误徽标必须显示条数')
  assert.match(clientSource, /'aria-expanded': errorsOpen/, '错误徽标必须暴露展开状态')
  assert.match(clientSource, /errorsOpen && errorCount > 0/, '错误详情默认收起，点击后才展开')
  assert.match(clientSource, /capital-automation-runerrormessage/, '展开后必须能读到具体错误消息')
  assert.match(clientSource, /body:not\(\[data-ds-dark-theme\]\)/, '浅色样式必须跟随主题属性，不能用媒体查询（显式浅色在深色系统下也要生效）')
  assert.match(clientSource, /--ca-table-line/, '表格分隔线必须有独立的对比度 token，不能直接复用卡片边框')
  assert.match(clientSource, /\.capital-automation-tab\[aria-selected="true"\] \{ background: var\(--dsw-alias-label-primary\)/, '页签选中态必须是高对比实心底色，浅色与深色都不能只靠浅阴影区分')
  assert.doesNotMatch(clientSource, /capital-automation-statusline/, '技术性 profile / 调度器 / 日历状态条不应常驻页面顶部')
  assert.match(clientSource, /detailOpen \? null : h\(Header/, '任务详情不应重复全局页头')
  assert.match(clientSource, /capital-automation-detailbar/, '任务详情必须有独立的返回条')
  assert.match(clientSource, /meta\.calendar\?\.available === false/, '交易日历不可用时应给出可操作提示，而不是常驻状态点')
  assert.match(clientSource, /calendarCoverageBanner/, '交易日历覆盖不足 30 天时必须提前告警，而不是等到跨年后才发现')
  assert.match(clientSource, /calendarLabel\(meta\?\.calendar\)/, '任务详情必须能读到日历来源与覆盖截止日')
  assert.match(clientSource, /triggerHintNatural/, '关闭仅交易日后，提示文案不能再说周末与节假日由日历判断')
  assert.match(clientSource, /onRequestConfirm/, '删除 / 休眠必须经过确认动作，不能直接提交')
  assert.match(clientSource, /notificationMessage/, '空消息通知必须有可读回退，不能只显示标题')
  assert.doesNotMatch(clientSource, /nextTaskList\[0\]/, '初始加载不能自动选中第一项，应停在任务概览')
  assert.match(clientSource, /const initialLoading = meta === null && loadError\.length === 0/, '首次数据返回前必须识别为加载中，不能把空数组当成没有任务')
  assert.match(clientSource, /initialLoading\s*\n\s*\? h\(TaskDashboardSkeleton\)/, '任务页首屏必须渲染骨架屏')
  assert.match(clientSource, /initialLoading\s*\n\s*\? h\(RunsSkeleton\)/, '运行页首屏必须渲染骨架屏')
  assert.match(clientSource, /--dsw-alias-bg-skeleton/, '骨架屏必须使用官方 skeleton token')
  assert.match(clientSource, /\.capital-automation-skeleton \{ animation: none; \}/, '减少动效时必须停掉骨架屏呼吸动画')
})

/** Evaluates function components the way React would, so the real first-paint tree is assertable. */
function flatten(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  if (typeof node !== 'object') {
    out.push(node)
    return out
  }
  if (typeof node.type === 'function') {
    flatten(node.type(node.props), out)
    return out
  }
  out.push(node)
  for (const child of node.children) flatten(child, out)
  return out
}

test('首次打开在 /meta 返回前显示骨架屏，而不是「还没有任务」', () => {
  const createElement = (type, props, ...children) => {
    const next = { ...(props ?? {}) }
    if (children.length === 1) next.children = children[0]
    else if (children.length > 1) next.children = children
    return { type, props: next, children }
  }
  const mod = loadBundle().factory((name) => factoryRequire(name, createElement))
  const registrations = []
  mod.apply({
    get: () => undefined,
    effect: (callback) => { callback(); return () => {} },
    slots: {
      inject: (slot, callback) => { assert.ok(['main', 'sidebar.panellist'].includes(slot)); return callback() },
      register: (declaration, component) => { registrations.push({ declaration, component }); return () => {} },
    },
    logger: { info() {} },
  })
  const nodes = flatten(registrations[0].component({ api: {}, openSession() {} }))
  const byClass = (name) => nodes.filter((node) => node !== null && typeof node === 'object' && typeof node.props.className === 'string' && node.props.className.split(/\s+/).includes(name))
  assert.equal(byClass('capital-automation-skeletonlabel').length, 1, '读屏必须听到一次「读取中」')
  assert.ok(byClass('capital-automation-loading').length > 0, '首屏必须是骨架屏容器')
  assert.equal(byClass('capital-automation-skeletonlabel')[0].props.role, 'status', '加载文案必须暴露为状态')
  assert.equal(byClass('capital-automation-loading')[0].props['aria-busy'], 'true', '骨架屏必须标记 aria-busy')
  assert.equal(byClass('capital-automation-skeletonrow').length, 4, '任务表先画出 4 行骨架')
  assert.equal(byClass('capital-automation-skeletontemplate').length, 3, '模板区先画出 3 张骨架卡')
  assert.equal(byClass('capital-automation-empty').length, 0, '数据未到时不得先渲染空状态')
  const text = nodes.filter((node) => typeof node === 'string').join('\n')
  assert.doesNotMatch(text, /还没有任务/, '首屏文案里不能出现「还没有任务」')
  assert.match(text, /读取中…/, '骨架屏必须给读屏留下加载文案')
})
