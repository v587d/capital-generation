import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { DEFAULT_MAX_STEPS, DEFAULT_MAX_TOOL_CALLS } from '../automation/defaults.js'
import { BUILTIN_DEFINITIONS } from '../automation/builtins.js'
import {
  BUILTIN_TASK_ICONS,
  DEFAULT_CUSTOM_ICON,
  TASK_ICON_CATALOG,
  TASK_ICON_IDS,
} from '../automation/task-icons.js'

/**
 * Executes the built automation client bundle in a minimal DOM sandbox. The browser-only apply
 * path is where `style.dataset[own-hyphenated-name]` once threw and left the whole web boot in
 * `loading`; a source-level assertion cannot see that class of failure.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(ROOT, 'automation', 'client.js'), 'utf8')
const clientSource = readFileSync(join(ROOT, 'automation', 'client.src.cjs'), 'utf8')
const iconsSource = readFileSync(join(ROOT, 'automation', 'task-icons.js'), 'utf8')

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
    // Effects only run in the mount-payload test; keep their timers inert there.
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    URLSearchParams,
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
      'IconAlarmClockOutlineRegular', 'IconChecklistOutlineRegular', 'IconChevronDownOutlineRegular',
      'IconChevronLeftOutlineRegular', 'IconChevronRightOutlineRegular', 'IconClockOutlineRegular', 'IconCopyOutlineRegular',
      'IconEditOutlineRegular', 'IconEllipsisOutlineRegular', 'IconFolderOpenOutlineRegular',
      'IconInfoOutlineRegular',
      'IconPauseOutlineRegular', 'IconPlayOutlineRegular',
      'IconPlusOutlineRegular', 'IconRefreshOutlineRegular', 'IconRightUpOutlineRegular', 'IconSearchOutlineRegular',
      'IconSparkleRegular', 'IconTrashOutlineRegular', 'IconWarningOutlineRegular',
      'Menu', 'MenuItemButton', 'Modal', 'Switch',
    ]
    return Object.fromEntries(names.map((key) => [key, empty]))
  }
  throw new Error(`客户端 bundle 不应在运行期 require("${name}")`)
}

test('任务图标：内置模板一一对应，目录图标互不重复且都能渲染', () => {
  const ids = BUILTIN_DEFINITIONS.map((definition) => definition.id)
  assert.ok(ids.length >= 16, '内置模板少于 16 个，图标覆盖断言会变得过松')
  assert.deepEqual(ids.filter((id) => BUILTIN_TASK_ICONS[id] === undefined), [], '新增内置模板时必须同步 automation/task-icons.js')
  assert.deepEqual(Object.keys(BUILTIN_TASK_ICONS).filter((id) => !ids.includes(id)), [], 'task-icons.js 里出现了已经不存在的内置模板')
  for (const [builtinId, iconId] of Object.entries(BUILTIN_TASK_ICONS)) {
    assert.ok(TASK_ICON_CATALOG[iconId] !== undefined, `${builtinId} 指向了目录里不存在的图标 ${iconId}`)
  }
  assert.ok(TASK_ICON_IDS.length >= 16, '用户可选图标少于内置模板数，选择面过窄')
  assert.ok(TASK_ICON_IDS.includes(DEFAULT_CUSTOM_ICON), '自定义任务默认图标必须在目录里')
  const sources = Object.values(TASK_ICON_CATALOG).map((icon) => icon.source)
  assert.equal(new Set(sources).size, sources.length, '目录里不能出现重复的上游图标')
  const paths = Object.values(TASK_ICON_CATALOG).map((icon) => icon.d)
  assert.equal(new Set(paths).size, paths.length, '目录里不能出现重复的路径')
  for (const [id, icon] of Object.entries(TASK_ICON_CATALOG)) {
    assert.ok(icon.label.length > 0, `${id} 缺少选择器里的中文标签`)
    assert.match(icon.d, /^M/, `${id} 的路径必须以 M 开头`)
    assert.doesNotMatch(icon.d, /[<>]/, `${id} 的路径里不能夹带标签`)
  }
  assert.match(source, /viewBox:"0 0 24 24"/, '客户端 bundle 必须已编译进图标渲染器；改完源码要重跑 build:automation-client')
})

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
  assert.match(clientSource, /presetHint: '所有运行固定使用自动模式。'/, '页面只保留固定的运行模式提示')
  assert.doesNotMatch(clientSource, /modeField|modeHint|zh\.mode\b|task\.mode|draft\.mode/, '输出侧重点选已删除，任务分类是唯一类型入口')
  assert.match(source, /presetValue:/, '页面必须显示固定的运行模式')
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
  assert.match(clientSource, /api\.notifications\(\)/, '页面必须读取任务级通知，任务失败与超时才可见')
  assert.match(clientSource, /notificationsEntry: '任务通知'/, '顶部入口必须叫任务通知，不能把调度状态也叫通知')
  assert.match(clientSource, /function SystemStatus\(/, '调度状态必须有独立的低调系统状态区')
  assert.match(clientSource, /lastStandbyCode/, '系统状态必须读取最近一次调度中断的用户可读原因')
  assert.doesNotMatch(clientSource, /调度器待命与交易日历问题会出现在这里/, '任务通知说明不能把调度待命混进来')
  assert.match(clientSource, /disabled: busy \|\| disabled \|\| task\.notifications\.inApp !== true/, '关闭写入任务通知后，失败/成功开关必须置灰')
  assert.match(clientSource, /disabled: draft\.notifications\.inApp !== true/, '新建任务里的失败/成功开关也必须跟随总开关置灰')
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
  assert.match(clientSource, /function TaskGlyph/, '任务必须走独立的 TaskGlyph 渲染器')
  assert.match(clientSource, /taskIconId\(task\)/, '任务与看板必须共用 task-icons 的图标解析器')
  assert.match(iconsSource, /builtinTaskIcon\(task\?\.sourceBuiltinId\)/, '内置任务图标必须按 sourceBuiltinId 一一映射')
  assert.match(iconsSource, /task\?\.origin === 'custom'/, '自定义任务必须读自己保存的 icon')
  assert.match(iconsSource, /hasOwnProperty\.call\(TASK_ICON_CATALOG, id\)\) return id/, '新建草稿也要用已选图标，不能只看 origin')
  assert.match(clientSource, /function IconPickerTrigger/, '任务图标必须是点击后弹出的选择器')
  assert.match(clientSource, /h\(Menu, \{[\s\S]*?anchor: h\('button'/, '图标选择器必须复用宿主 Menu 的锚点与收起行为')
  assert.match(clientSource, /listClassName: 'capital-automation-iconmenu'/, '图标菜单必须能单独定宽（portal 出去后作用域选择器够不到）')
  assert.match(clientSource, /portal: true/, '图标菜单必须 portal，避免被弹窗内容裁切')
  assert.match(clientSource, /role: 'menuitemradio'/, '菜单里的每个图标必须是 menuitemradio')
  assert.match(clientSource, /'aria-checked': active \? 'true' : 'false'/, '每个图标必须暴露选中态')
  assert.match(clientSource, /onClick: \(\) => \{ onChange\(id\); setOpen\(false\) \}/, '选中图标后必须收起菜单')
  assert.match(clientSource, /h\(IconPickerTrigger, \{ task: draft, size: 42/, '新建任务弹窗必须用图标瓦片作为弹出触发器')
  assert.match(clientSource, /task\.origin === 'custom'[\s\S]{0,120}?h\(IconPickerTrigger, \{/, '自定义任务的配置页必须能改图标')
  assert.match(clientSource, /iconPickHint: '点击图标更换'/, '触发器必须说明点击图标可更换')
  assert.match(clientSource, /capital-automation-glyphbtnchevron/, '下拉箭头必须挂在图标右侧')
  assert.doesNotMatch(clientSource, /glyphbtnbadge/, '下拉箭头不能再压在图标右下角')
  assert.doesNotMatch(clientSource, /任务会在后台新建一个 session 执行/, '新建弹窗不再保留这句运行说明')
  assert.doesNotMatch(clientSource, /IconPickerField|capital-automation-iconpicker|role: 'radiogroup'/, '图标备选不能再常驻页面')
  assert.match(clientSource, /icon: DEFAULT_CUSTOM_ICON/, '新建任务的草稿必须带默认图标')
  assert.match(clientSource, /task\.origin === 'builtin' \? \{\} : \{ icon:/, '内置任务 PATCH 不能携带 icon，否则会被 overrides strict schema 拒绝')
  assert.match(clientSource, /strokeWidth: 2/, 'Tabler 图标沿用 2px 描边，缩到 17px 仍可辨认')
  assert.doesNotMatch(clientSource, /category === 'market'\) return IconGaugeOutlineRegular/, '图标不能继续按分类共用一个 DSH 图标')
  assert.doesNotMatch(clientSource, /IconLightOutlineMedium/, '早间资讯的 Light 特判已由目录图标取代')
  assert.doesNotMatch(clientSource, /function taskGlyph/, '旧的分类图标映射已删除')
  assert.match(clientSource, /\['all', 'custom', 'news', 'market', 'review', 'research', 'portfolio', 'monitor'\]/, '任务筛选必须覆盖新增的组合与监控分类')
  assert.match(clientSource, /portfolio: '组合', monitor: '监控'/, '分类标签必须有组合与监控')
  assert.match(clientSource, /data-tone="portfolio"[\s\S]*data-tone="monitor"/, '新增分类必须有配色，不能落到默认地球色')
  assert.match(clientSource, /\.sort\(compareTemplates\)/, '模板卡必须按频率与时间排序，12 个模板不能按 id 散落')
  assert.match(clientSource, /zh\.templateAdding : zh\.templateAdd/, '模板卡按钮文案是「添加 / 添加中」')
  assert.match(clientSource, /state: \{ dormant: '未添加'/, '模板未加入任务列表时状态显示「未添加」')
  assert.doesNotMatch(clientSource, /templateEnable|templateEnabling|去启用模板|启用一个内置模板/, '模板添加动作不再写成启用')
  assert.match(clientSource, /capital-automation-filtercount/, '筛选计数必须渲染成圆圈数字')
  assert.match(clientSource, /'data-variant': detail\.task\.state === 'active' \? 'primary' : undefined/, '已启用任务以「立即运行」为主按钮')
  assert.match(clientSource, /'data-variant': detail\.task\.state === 'active' \? undefined : 'primary'/, '未添加模板或暂停任务以「添加」/「启用」为主按钮，不能只靠 hover 区分')
  assert.match(clientSource, /capital-automation-tasktitlerow \.capital-automation-tasktags/, '分类与来源标签必须和任务标题同排')
  assert.match(clientSource, /function clipTagLabel\(label, limit = 12\)/, '任务标签文案上限必须是 12 个字')
  assert.doesNotMatch(clientSource, /templateSectionHint|templateCount/, '模板区标题不再带说明和数量')
  assert.match(clientSource, /capital-automation-history/, '运行页必须有运行历史概览')
  assert.equal((clientSource.match(/h\(RunHistoryCard,/g) ?? []).length, 1, '运行历史只保留在运行页，任务页不再渲染')
  assert.match(clientSource, /capital-automation-heatgrid/, '运行历史必须是按周排列的贡献热力图')
  assert.match(clientSource, /capital-automation-heatcell/, '热力图必须渲染每日格子')
  assert.match(clientSource, /data-level/, '热力图必须按运行次数分档着色')
  assert.match(clientSource, /data-failed/, '热力图必须标出有失败的日期')
  assert.match(clientSource, /capital-automation-heattip/, '热力图必须有悬停详情')
  assert.match(clientSource, /--ca-heat-4/, '热力档位必须有明暗主题各自的色阶')
  assert.match(clientSource, /runs\/history/, '热力图必须读取按日聚合的历史接口')
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
  assert.match(clientSource, /const scheduleHint = detail\.task\.trigger\.cadence === 'once'\s*\n\s*\? zh\.triggerHintOnce/, '单次任务的概览提示必须说明只运行一次')
  assert.match(clientSource, /detail\.task\.trigger\.tradingDaysOnly === true \? zh\.triggerHint : zh\.triggerHintNatural/, '概览的日程提示必须区分仅交易日与每日')
  const triggerStart = clientSource.indexOf('function TriggerFields(props)')
  const triggerEnd = clientSource.indexOf('function SwitchRow(props)', triggerStart)
  assert.ok(triggerStart >= 0 && triggerEnd > triggerStart, '必须能定位触发器组件')
  const trigger = clientSource.slice(triggerStart, triggerEnd)
  assert.doesNotMatch(trigger, /capital-automation-triggerclock/, '「触发器 + 每周」已经说明这是定时设置，行首时钟图标只是装饰')
  assert.doesNotMatch(trigger, /IconGlobeOutlineRegular/, '时区由文字标签说明，不再挂地球图标')
  assert.doesNotMatch(trigger, /triggerHintNatural/, '触发器不再常驻墙钟与节假日长提示')
  assert.doesNotMatch(trigger, /list: 'capital-automation-timezones'/, '时区不能继续用 datalist 输入')
  assert.match(trigger, /timezoneOptions\(trigger\.timezone\)/, '时区必须由下拉选项提供')
  assert.match(trigger, /className: 'capital-automation-triggerhead'/, '频率与时间必须排在同一行')
  assert.doesNotMatch(trigger, /capital-automation-triggerword/, '侧栏放不下规则短语，孤立的「在 / 于」必须去掉')
  assert.match(trigger, /capital-automation-triggerlabel/, '星期、日期、时区必须有各自的标签')
  assert.doesNotMatch(trigger, /capital-automation-triggersummary/, '规则本身已经说明日程，不再重复摘要')
  assert.doesNotMatch(clientSource, /capital-automation-timezones/, 'datalist 节点必须随输入框一起删除')
  assert.match(clientSource, /onRequestConfirm/, '删除 / 休眠必须经过确认动作，不能直接提交')
  assert.match(clientSource, /notificationMessage/, '空消息通知必须有可读回退，不能只显示标题')
  assert.doesNotMatch(clientSource, /nextTaskList\[0\]/, '初始加载不能自动选中第一项，应停在任务概览')
  assert.match(clientSource, /const initialLoading = meta === null && loadError\.length === 0/, '首次数据返回前必须识别为加载中，不能把空数组当成没有任务')
  assert.match(clientSource, /tasksPending\s*\n\s*\? h\(TaskDashboardSkeleton\)/, '任务页首屏必须渲染骨架屏')
  assert.match(clientSource, /runsPending\s*\n\s*\? h\(RunsSkeleton\)/, '运行页首屏必须渲染骨架屏')
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

test('下拉统一为宿主设置同款：胶囊按钮 + Menu，不再渲染原生 select', () => {
  assert.doesNotMatch(clientSource, /h\('select'/, '原生 select 的按钮与系统菜单无法跟随宿主主题')
  const start = clientSource.indexOf('function Select(props)')
  const end = clientSource.indexOf('function NumberField', start)
  const block = clientSource.slice(start, end)
  assert.ok(start >= 0 && end > start, '必须有独立的 Select 组件')
  assert.match(block, /IconChevronDownOutlineRegular/, '按钮必须带宿主同款下箭头')
  assert.match(block, /'aria-haspopup': 'menu'/, '按钮必须声明弹出菜单')
  assert.match(block, /h\(Menu, \{/, '菜单必须复用宿主的 Menu 浮层')
  assert.match(block, /selectedId: currentValue/, '菜单必须标出当前选中项')
  assert.equal((clientSource.match(/h\(Select, \{/g) ?? []).length, 9, '九个内联下拉使用 Select（频率、时区、工作区、分类、看板范围、看板分类、TODO 日期、个股标签）')
  assert.equal((clientSource.match(/h\(SelectField, \{/g) ?? []).length, 2, '两个表单整行下拉使用 SelectField')
  assert.match(clientSource, /\.capital-automation-select \{[^}]*background: var\(--ca-field\)/, '下拉按钮必须用宿主设置同款的填充胶囊')
  assert.match(clientSource, /\.capital-automation-select:hover:not\(:disabled\)/, '胶囊必须有 hover 反馈')
})

test('任务详情按状态收敛：头部去重、状态化卡片、配置页字段内联校验', () => {
  const detailStart = clientSource.indexOf('function TaskDetailPage(props)')
  const detailEnd = clientSource.indexOf('function NewTaskModal(props)', detailStart)
  assert.ok(detailStart >= 0 && detailEnd > detailStart, '必须能定位任务详情组件')
  const detail = clientSource.slice(detailStart, detailEnd)
  assert.doesNotMatch(detail, /\$\{zh\.nextRun\}/, '详情头不再重复「下次运行」，只由概览卡展示')
  assert.doesNotMatch(detail, /\$\{zh\.lastResult\}/, '详情头不再重复「上次结果」，只由概览卡展示')
  assert.doesNotMatch(detail, /zh\.origin\.(?:builtin|custom)/, '详情头不再重复来源标签，来源留在状态卡')
  assert.doesNotMatch(detail, /configBuiltinHint/, '内置模板覆盖说明不再常驻详情头')
  assert.doesNotMatch(detail, /capital-automation-herometa/, '详情头不再保留分类 / 日程摘要行')
  assert.doesNotMatch(detail, /capital-generation/, '用户界面不出现内部 preset id')
  assert.match(detail, /h\(IconPlayOutlineRegular, \{ size: 14 \}\), zh\.runNow/, '「立即运行」必须带播放图标')
  assert.match(detail, /h\(activationIcon\(detail\.task\), \{ size: 14 \}\), activationLabel\(detail\.task\)/, '「添加 / 启用 / 暂停」必须带对应状态图标')
  assert.match(detail, /onGoRuns: \(\) => onTab\('runs'\)/, '「完整记录」必须留在本任务的运行记录页签')
  assert.doesNotMatch(detail, /onOpenAllRuns/, '任务详情不应把用户带去全局运行页')
  assert.match(detail, /onCancelRun: onRequestCancelRun,[\s\S]*?onOpenSession: openSession/, '概览必须接上取消与打开 session 的回调')

  const overviewStart = clientSource.indexOf('function OverviewTab(props)')
  const overviewEnd = clientSource.indexOf('function ConfigTab(props)', overviewStart)
  assert.ok(overviewStart >= 0 && overviewEnd > overviewStart, '必须能定位概览组件')
  const overview = clientSource.slice(overviewStart, overviewEnd)
  assert.doesNotMatch(overview, /zh\.triggerField|zh\.timezoneField/, '概览不再重复整块日程明细')
  assert.doesNotMatch(overview, /h\('h3', null, zh\.triggerSummary\)/, '概览不再有与四张卡重复的「日程」面板')
  assert.match(overview, /const next = nextRunView\(detail\.task\)/, '下次运行必须按任务状态收敛')
  assert.match(overview, /const last = lastRunView\(latest, detail\.task\.trigger\.timezone\)/, '上次结果必须按运行状态收敛')
  assert.match(overview, /'data-tone': last\.tone/, '失败 / 运行中 / 跳过状态必须带到上次结果卡')
  assert.match(overview, /scheduleText/, '日程卡必须带「仅交易日」限定')
  assert.match(overview, /title: scheduleHint/, '日程卡必须保留交易日历说明的悬停提示')
  assert.match(overview, /zh\.detailRecentRuns\.replace\('\{n\}', String\(DETAIL_RECENT_RUN_LIMIT\)\)/, '「最近运行」必须写明固定条数')
  assert.match(overview, /runs: detail\.runs\.slice\(0, DETAIL_RECENT_RUN_LIMIT\)/, '标题条数必须与实际 slice 共用同一个常量')
  assert.match(overview, /onCancel: onCancelRun/, '概览的活动运行必须能取消')
  assert.match(overview, /onOpenSession,/, '概览的终态运行必须能打开 session')
  assert.doesNotMatch(overview, /zh\.policyText|zh\.budgetHint/, '执行环境不再堆叠内部策略说明')
  assert.match(overview, /h\('section', \{ className: 'capital-automation-technical' \}/, '技术信息直接展开，不再需要开合按钮')
  assert.match(overview, /capital-automation-technicaltitle/, '技术信息保留小标题')
  assert.doesNotMatch(overview, /h\('details'/, '技术信息不应再有展开 / 收起按钮')
  assert.doesNotMatch(overview, /zh\.version/, '技术信息不再显示版本号')

  const configStart = overviewEnd
  const configEnd = clientSource.indexOf('function NotificationsTab(props)', configStart)
  const config = clientSource.slice(configStart, configEnd)
  assert.doesNotMatch(config, /capital-automation-formnote/, '配置页不再常驻内置模板覆盖说明')
  assert.doesNotMatch(config, /configBuiltinHint/, '删除会让人困惑的内置模板覆盖说明')
  assert.match(config, /useDraftIssues\(task, task\.id, meta\)/, '配置页必须逐字段跟踪失焦状态')
  assert.match(config, /error: titleError/, '标题错误必须挂在标题字段')
  assert.match(config, /error: instructionError/, '指令错误必须挂在指令字段')
  assert.match(config, /onBlur: \(\) => \{ touch\('title'\); flush\(\) \}/, '标题失焦即校验并提交自动保存')
  assert.match(config, /onBlur: \(\) => \{ touch\('instruction'\); flush\(\) \}/, '指令失焦即校验并提交自动保存')
  assert.doesNotMatch(config, /onClick: submit/, '配置页不再有保存按钮')
  assert.doesNotMatch(config, /zh\.save\b|zh\.saved\b|zh\.dirty\b/, '配置页不再渲染手动保存相关文案')
  assert.match(config, /zh\.autosaveHint/, '配置页必须说明修改会自动保存')
  assert.match(config, /zh\.autosaveSaved/, '配置页必须给出已自动保存的反馈')
  assert.match(config, /onClick: retry/, '自动保存失败时必须能手动重试')
  assert.match(config, /className: 'capital-automation-autosavestate'/, '自动保存状态必须有独立落点')
  assert.doesNotMatch(config, /clear\(\); reset\(\)/, '配置页不再有取消并回滚按钮')
  assert.doesNotMatch(config, /zh\.required/, '必填错误不能合并成一条顶部提示')
  assert.match(config, /className: 'capital-automation-titlerow'/, '任务分类必须和任务标题同行')
  assert.match(config, /maxLength: TITLE_MAX_LENGTH/, '任务标题必须有字数上限')
  assert.match(config, /className: 'capital-automation-texteditor capital-automation-descriptioninput'/, '任务说明必须是固定高度文本框')
  assert.match(config, /maxLength: DESCRIPTION_MAX_LENGTH/, '任务说明必须有字数上限')
  assert.doesNotMatch(config, /h\('textarea'/, '任务说明不能退回可拖拽的原生 textarea')
  assert.doesNotMatch(config, /hint: task\.origin === 'builtin' \? zh\.categoryFixed/, '分类固定说明不能常驻为一行字')
  assert.match(config, /title: task\.origin === 'builtin' \? zh\.categoryFixed : undefined/, '分类固定说明改为悬停提示')
  assert.match(config, /note: zh\.charCount/, '字数提示必须进入字段标题行')
  assert.doesNotMatch(config, /hint: zh\.charCount/, '字数提示不能继续占用字段下方')
  assert.match(config, /className: 'capital-automation-instructionrow'/, '任务指令与右侧配置必须同一行')
  assert.match(config, /className: 'capital-automation-instructionside'/, '右侧配置必须有独立容器')
  assert.match(config, /const instructionSide = h\('div'[\s\S]*?zh\.workspaceField[\s\S]*?zh\.triggerField/, '工作区与触发器必须垂直排列在任务指令右侧')
  assert.match(config, /h\(PlainTextEditor, \{[\s\S]*?className: 'capital-automation-texteditor'[\s\S]*?ariaLabel: zh\.instructionField/, '任务指令必须是固定高度纯文本编辑框')
  assert.doesNotMatch(config, /rows: 14/, '任务指令不能再靠 textarea 行数撑高度')
  assert.doesNotMatch(config, /h\('textarea'/, '任务指令不能使用原生 textarea')
  const advancedStart = config.indexOf("const advanced = h('details'")
  const advancedEnd = config.indexOf('const notificationRows', advancedStart)
  assert.ok(advancedStart >= 0 && advancedEnd > advancedStart, '必须能定位高级设置块')
  assert.doesNotMatch(config.slice(advancedStart, advancedEnd), /zh\.workspaceField/, '工作区不能继续留在高级设置里')
  assert.match(clientSource, /\.capital-automation-instructionrow \{ display: grid; grid-template-columns: minmax\(320px, 1fr\) minmax\(420px, 520px\); align-items: stretch;/, '任务指令右侧两栏必须加宽并等高')
  assert.match(clientSource, /@media \(max-width: 960px\) \{[\s\S]*?\.capital-automation-instructionrow \{ grid-template-columns: minmax\(0, 1fr\); \}/, '窄屏时右侧配置必须回落到任务指令下方')
  assert.match(clientSource, /\.capital-automation-field \.capital-automation-texteditor \{ box-sizing: border-box; flex: 1 1 auto;/, '任务指令编辑框必须撑满右侧栏高度')
  assert.match(clientSource, /function PlainTextEditor\(props\)/, '固定高度编辑框必须有单处实现')
  assert.match(clientSource, /contentEditable: disabled === true \? 'false' : 'true'/, '编辑框必须是 contenteditable，不能退回 textarea')
  assert.match(clientSource, /onPaste:/, '粘贴必须转成纯文本')
  assert.doesNotMatch(clientSource, /capital-automation-field textarea|h\('textarea'/, '客户端不能再渲染原生 textarea')

  assert.match(clientSource, /function draftIssues\(task, meta\)/, '校验必须按字段返回问题集合')
  assert.match(clientSource, /function useDraftIssues\(task, resetKey, meta\)/, '失焦状态必须有单处实现')
  assert.match(clientSource, /const AUTOSAVE_DELAY_MS = 600/, '自动保存必须有防抖窗口')
  assert.match(clientSource, /function TaskDetailPage\(props\)[\s\S]*?api\.patch\(taskId, payload\)/, '配置修改必须走同一个 PATCH 保存')
  assert.match(clientSource, /saveInFlightRef/, '自动保存必须串行，不能并发覆盖')
  assert.match(clientSource, /saveTimerRef/, '自动保存必须清掉旧计时器')
  assert.match(clientSource, /samePayload\(current, nextSaved\)/, '详情刷新不能覆盖用户未保存的编辑')
  assert.match(clientSource, /payloadKey\(current\) === previousAcked/, '外部刷新只在本地没有未保存编辑时接管草稿')
  assert.match(clientSource, /void flushRef\.current\?\.\(\)/, '切换页签 / 离开页面时必须冲刷待保存修改')
  assert.match(clientSource, /kind === 'hibernate' \|\| kind === 'delete'[\s\S]*?await flushBeforeAction\(\)/, '休眠 / 删除前必须等自动保存收口，避免旧保存复活覆盖层')
  assert.match(clientSource, /capital-automation-autosavestate/, '自动保存状态必须有独立样式')
  assert.match(clientSource, /function FieldHead\(props\)/, '字段标题行必须有独立实现')
  assert.match(clientSource, /h\(FieldHead, \{ label, note, error \}\),\n    children,/, '标题行必须排在输入之前')
  assert.match(clientSource, /\.capital-automation-fieldhead \{ display: flex/, '标题行必须能横排字数与错误')
  assert.match(clientSource, /\.capital-automation-fieldhint \{/, '字数提示必须有独立样式')
  assert.match(clientSource, /categoryFixed: `'复制为我的任务'后，可调整任务分类。`/, '分类说明改为复制后可调')
  assert.match(clientSource, /titleField: '任务标题'/, '标题字段文案改为「任务标题」')
  assert.match(clientSource, /descriptionField: '任务说明'/, '说明字段文案改为「任务说明」')
  assert.match(clientSource, /const TITLE_MAX_LENGTH = 12/, '任务标题上限为 12 个字')
  assert.match(clientSource, /const DESCRIPTION_MAX_LENGTH = 100/, '任务说明上限为 100 个字')
  assert.match(clientSource, /titleRequired: '标题不能为空。'/, '标题必填错误必须单独成句')
  assert.match(clientSource, /instructionRequired: '任务指令不能为空。'/, '指令必填错误必须单独成句')
  assert.doesNotMatch(clientSource, /validateDraft/, '校验不能退回保存时单条顶部错误')
  assert.match(clientSource, /\.capital-automation-fielderror \{ color: var\(--ca-error-text\)/, '字段错误必须标红且与标题同行')
  assert.match(clientSource, /capital-automation-field\[data-invalid="true"\] input/, '无效字段必须标红边框')

  assert.match(clientSource, /function nextRunView\(task\)/, '下次运行的状态归一只能有一处实现')
  assert.match(clientSource, /state === 'dormant'\) return \{ value: zh\.nextRunDormant, sub: zh\.notScheduled \}/, '未添加模板不得显示会被跳过的日期')
  assert.match(clientSource, /state === 'paused'\) return \{ value: zh\.nextRunPaused, sub: zh\.notScheduled \}/, '暂停任务不得显示会被跳过的日期')
  assert.match(clientSource, /function lastRunView\(run, timeZone\)/, '上次结果的文案与色阶只能有一处实现')
  assert.match(clientSource, /SKIPPED_RUN_STATUSES/, '跳过与错过必须和失败分开着色')
  assert.match(clientSource, /const next = nextRunView\(task\)/, '任务行的下次运行同样按状态收敛，不能只在详情页修')
  assert.doesNotMatch(clientSource, /const nextLabel = task\.nextRunLocal/, '任务行不能继续直接展示计算出的下次运行')
  assert.match(clientSource, /capital-automation-statvalue\[data-tone="warn"\]/, '概览警告色必须有样式落点')
  assert.match(clientSource, /h\(IconPlusOutlineRegular, \{ size: 12 \}\),\s*busy \? zh\.templateAdding : zh\.templateAdd/, '模板卡的「添加」也要带图标')
  assert.match(clientSource, /const DETAIL_RECENT_RUN_LIMIT = 3/, '概览固定展示 3 条最近运行')
  assert.match(clientSource, /detailRecentRuns: '最近 \{n\} 次运行'/, '「最近运行」标题必须带条数')
  assert.match(clientSource, /detailAllRuns: '完整记录'/, '概览链接文案是「完整记录」')
  assert.match(clientSource, /presetLabel: '运行模式'/, '预设行对用户只写「运行模式」')
  assert.match(clientSource, /presetValue: '自动模式'/, '预设值只写「自动模式」')
  assert.doesNotMatch(clientSource, /capital-generation/, '内部 preset id 不得出现在用户界面')
  assert.match(clientSource, /\.capital-automation-panelhead \.capital-automation-btn\[data-variant="ghost"\] \{ padding-right: 0; \}/, '标题行链接必须和右侧操作对齐')

  const runRowStart = clientSource.indexOf('function RunRow(props)')
  const runRowEnd = clientSource.indexOf('function RunList(props)', runRowStart)
  assert.ok(runRowStart >= 0 && runRowEnd > runRowStart, '必须能定位运行行组件')
  const runRow = clientSource.slice(runRowStart, runRowEnd)
  const metaAt = runRow.indexOf("className: 'capital-automation-runmetaline'")
  const stepsAt = runRow.indexOf('${zh.steps}', metaAt)
  const badgeAt = runRow.indexOf('errorBadge', metaAt)
  const actionsAt = runRow.indexOf("className: 'capital-automation-runactions'", badgeAt)
  assert.ok(metaAt >= 0 && stepsAt > metaAt && badgeAt > stepsAt, '错误条数必须排在「工具调用」后面')
  assert.ok(actionsAt > badgeAt, '右侧操作必须排在错误条数之后')
  assert.doesNotMatch(runRow.slice(actionsAt), /runerrorbadge/, '右侧只留打开 session / 取消运行，不再和错误徽标挤在一起')
  assert.match(runRow.slice(actionsAt), /zh\.openSession/, '终态运行的右侧应是「打开 session」')
  assert.match(runRow.slice(actionsAt), /'data-variant': 'primary'[^]*?zh\.openSession/, '打开 session 必须比错误提醒更醒目')
  assert.match(runRow.slice(actionsAt), /h\(IconRightUpOutlineRegular, \{ size: 13 \}\)[^]*?zh\.openSession/, '打开 session 必须带外链图标')
})

test('触发器组件：规则选项嵌在频率与时间之间，按单选/多选呈现', () => {
  const start = clientSource.indexOf('function WeekdaySelect(props)')
  const end = clientSource.indexOf('function SwitchRow(props)', start)
  assert.ok(start >= 0 && end > start, '必须能定位触发器组件')
  const fnSource = clientSource.slice(start, end)
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children })
  const Menu = (props) => h('menu-stub', props, props.anchor)
  const factory = new Function(
    'h', 'Select', 'Switch', 'Menu', 'IconChevronDownOutlineRegular', 'useState', 'useEffect',
    'zh', 'WEEKDAYS', 'normalizeTrigger', 'triggerChanged', 'timezoneOptions',
    `${fnSource}\nreturn TriggerFields`,
  )
  const TriggerFields = factory(
    h,
    (props) => h('select', props),
    (props) => h('switch', props),
    Menu,
    () => null,
    (value) => [value, () => {}],
    () => {},
    {
      cadence: { daily: '每天', weekly: '每周', monthly: '每月', once: '单次' },
      cadenceField: '频率',
      triggerField: '触发器',
      timeField: '时间',
      timezoneField: '时区',
      weekdayField: '星期',
      dayField: '日期',
      monthlyField: '每月日期',
      monthlyFirst: '1 号',
      monthlyMid: '月中',
      monthlyLast: '月末',
      monthlyCustom: '自定义',
      dailyNatural: '每个自然日运行',
      dailyTrading: '每个交易日运行',
      onceHint: '只在这天运行一次',
      dayOfMonth: '第 {n} 天',
      tradingDaysField: '仅交易日',
      weekdayWorkdayQuick: '工作日',
      weekdayWeekendQuick: '周末',
      weekdayNone: '未选择',
      weekdayEvery: '每天',
    },
    [{ value: 1, label: '一' }, { value: 2, label: '二' }, { value: 3, label: '三' }, { value: 4, label: '四' }, { value: 5, label: '五' }, { value: 6, label: '六' }, { value: 7, label: '日' }],
    (trigger) => trigger,
    (cadence, trigger) => ({ ...trigger, cadence }),
    (current) => [current, 'Asia/Shanghai', 'UTC'].map((value) => ({ value, label: value })),
  )
  const render = (trigger) => TriggerFields({
    trigger,
    onChange() {},
    disabled: false,
    meta: { calendar: { available: true } },
    errorFor: () => undefined,
    touch() {},
  })
  const base = { kind: 'schedule', cadence: 'daily', time: '08:30', timezone: 'Asia/Shanghai', tradingDaysOnly: true }
  const classes = (nodes, name) => nodes.filter((node) => node !== null && typeof node === 'object' && node.props.className === name)
  const hasClass = (nodes, name) => nodes.filter((node) => typeof node?.props?.className === 'string' && node.props.className.split(/\s+/).includes(name))
  const selects = (nodes) => nodes.filter((node) => node !== null && typeof node === 'object' && node.type === 'select')

  const daily = flatten(render(base))
  const dailySelects = selects(daily)
  const timeInputs = daily.filter((node) => node !== null && typeof node === 'object' && node.type === 'input' && node.props.type === 'time')
  assert.equal(dailySelects.length, 2, '每天模式是频率下拉 + 时区下拉，不再混用分段按钮')
  assert.equal(dailySelects.filter((node) => node.props.label === '频率').length, 1, '频率必须用单选下拉表达')
  assert.equal(dailySelects.find((node) => node.props.label === '频率').props.options.length, 4, '频率下拉必须包含每天/每周/每月/单次')
  assert.equal(timeInputs.length, 1, '每天模式必须渲染一个时间输入框')
  assert.equal(classes(daily, 'capital-automation-cadencebtn').length, 0, '频率不能再渲染成可多选的分段 tab')
  const timezone = dailySelects.find((node) => node.props.label === '时区')
  assert.ok(timezone, '时区下拉必须真的出现')
  assert.ok(timezone.props.options.some((option) => option.value === 'Asia/Shanghai'), '时区下拉必须带可选项')
  const dailyHead = classes(daily, 'capital-automation-triggerhead')[0]
  assert.ok(dailyHead, '频率、规则与时间必须排在同一个头部行')
  assert.match(dailyHead.children[0].props.className, /capital-automation-triggerfield/, '头部第一项必须是频率字段')
  assert.ok(dailyHead.children[0].children.some((node) => node?.props?.className === 'capital-automation-triggerdetail'), '规则区必须嵌在频率字段内部')
  const dailyDetail = classes(daily, 'capital-automation-triggerdetail')[0]
  assert.equal(dailyDetail.children.filter(Boolean).length, 0, '每天中间必须空着')
  assert.equal(classes(daily, 'capital-automation-triggerfield').length, 2, '每天只有频率与时间两个可见字段')

  const weekly = flatten(render({ ...base, cadence: 'weekly', weekdays: [1, 3, 5] }))
  const weeklyPick = hasClass(weekly, 'capital-automation-triggerpick')[0]
  assert.ok(weeklyPick, '每周必须渲染一个可展开的星期选择器')
  assert.match(weeklyPick.props['aria-label'], /星期：一、三、五/, '星期选择器必须回显已选星期')
  const weeklyMenu = weekly.find((node) => node?.type === 'menu-stub')
  assert.ok(weeklyMenu, '星期选择器必须复用宿主 Menu')
  assert.equal(weeklyMenu.props.items.filter((item) => item.type !== 'separator').length, 9, '每周菜单必须包含 7 天和工作日/周末快捷项')
  assert.deepEqual(weeklyMenu.props.selectedIds, ['weekday-1', 'weekday-3', 'weekday-5'], '星期必须是可多选的勾选集合')
  assert.equal(weeklyMenu.props.footer, undefined, '多选菜单靠失焦 / Esc 关闭，不需要「完成」项')
  assert.equal(classes(weekly, 'capital-automation-triggerfield').length, 3, '每周是频率、星期、时间三个字段')

  const monthly = flatten(render({ ...base, cadence: 'monthly', dayOfMonth: 29 }))
  const monthlyPick = hasClass(monthly, 'capital-automation-triggerpick')[0]
  assert.ok(monthlyPick, '每月必须渲染日期选择器')
  assert.match(monthlyPick.props['aria-label'], /每月日期：第 29 天/, '自定义月日必须回显到选择器')
  const monthlyMenu = monthly.find((node) => node?.type === 'menu-stub')
  assert.ok(monthlyMenu, '每月日期必须复用宿主 Menu')
  assert.equal(monthlyMenu.props.selectedId, 'custom', '自定义日期必须标在「自定义」项')
  assert.deepEqual(monthlyMenu.props.items.slice(0, 3).map((item) => item.label), ['1 号', '月中', '月末'], '每月只给 1 号、月中、月末三个预设')
  const custom = monthlyMenu.props.items.find((item) => item.id === 'custom')
  assert.equal(custom.submenu.length, 31, '自定义必须级联 1–31 日')
  assert.match(clientSource, /\.capital-automation-monthpick \[role="menu"\] \[role="menu"\] \{ display: grid;/, '1–31 日级联必须用网格，不能拉成一列长菜单')

  const monthlyLast = flatten(render({ ...base, cadence: 'monthly', dayOfMonth: 'last' }))
  const lastPick = hasClass(monthlyLast, 'capital-automation-triggerpick')[0]
  assert.match(lastPick.props['aria-label'], /每月日期：月末/, '月末必须能单独选中')
  assert.equal(monthlyLast.find((node) => node?.type === 'menu-stub').props.selectedId, 'last', '月末必须标在「月末」项')

  const once = flatten(render({ ...base, cadence: 'once', date: '2027-06-30' }))
  const dateInput = once.find((node) => node !== null && typeof node === 'object' && node.type === 'input' && node.props.type === 'date')
  assert.ok(dateInput, '单次模式必须渲染日期输入框')
  assert.equal(dateInput.props.value, '2027-06-30', '单次日期必须回显')
  assert.equal(dateInput.props.title, '只在这天运行一次', '单次日期必须带一次性说明')
  assert.equal(classes(once, 'capital-automation-triggerfield').length, 3, '单次是频率、日期、时间三个字段')
  assert.equal(classes(once, 'capital-automation-weekday').length + classes(once, 'capital-automation-monthlychip').length, 0, '规则不能再展开成整行按钮')
})

test('新建任务弹窗收窄到 600px，且每周菜单不再有「完成」项', () => {
  assert.match(clientSource, /\.capital-automation-modal-wizard \{ width: min\(600px, calc\(100vw - 32px\)\); max-width: min\(600px, calc\(100vw - 32px\)\); \}/, '新建任务弹窗宽度必须是 600px')
  assert.match(clientSource, /className: 'capital-automation-modal capital-automation-modal-wizard'/, '只有新建任务弹窗使用 600px 宽度')
  assert.doesNotMatch(clientSource, /weekday-done/, '每周多选菜单不能再渲染「完成」兜底项')
})

test('单次触发器的默认日期避开周末，仅交易日开关才有意义', () => {
  const start = clientSource.indexOf('function dateStringFromParts(')
  const end = clientSource.indexOf('function normalizeTrigger(', start)
  assert.ok(start >= 0 && end > start, '必须能定位日期辅助函数')
  const helpers = new Function(`${clientSource.slice(start, end)}; return { nextWeekdayOnOrAfter, defaultOnceDate, onceHasPassed }`)()
  assert.equal(helpers.nextWeekdayOnOrAfter('2026-10-31'), '2026-11-02', '周六默认推到周一')
  assert.equal(helpers.nextWeekdayOnOrAfter('2026-11-02'), '2026-11-02', '工作日保持不动')
  const defaultDate = helpers.defaultOnceDate('Asia/Shanghai', true)
  const weekday = new Date(`${defaultDate}T00:00:00Z`).getUTCDay()
  assert.ok(weekday !== 0 && weekday !== 6, '仅交易日开启时默认单次日期不能是周末')
  assert.equal(helpers.onceHasPassed({ cadence: 'once', date: '2000-01-01', time: '00:00', timezone: 'UTC' }), true, '过期单次任务必须标为已结束')
  assert.equal(helpers.onceHasPassed({ cadence: 'once', date: '2999-01-01', time: '00:00', timezone: 'UTC' }), false, '未来单次任务不能误报已结束')
  assert.match(clientSource, /return onceHasPassed\(task\.trigger\)/, '过期与不可运行必须分开呈现')
})

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
  assert.equal(byClass('capital-automation-skeletonrow').length, 0, '默认看板首屏不再画任务表骨架')
  assert.equal(byClass('capital-automation-briefcard').length, 2, '看板首屏先画 2 张简报骨架')
  assert.equal(byClass('capital-automation-boardstat').length, 5, '看板首屏先画 5 格统计骨架')
  assert.equal(byClass('capital-automation-history').length, 0, '看板首屏不包含运行历史')
  assert.equal(byClass('capital-automation-skeletontemplate').length, 0, '看板首屏不包含模板骨架')
  assert.equal(byClass('capital-automation-empty').length, 0, '数据未到时不得先渲染空状态')
  const text = nodes.filter((node) => typeof node === 'string').join('\n')
  assert.doesNotMatch(text, /还没有任务/, '首屏文案里不能出现「还没有任务」')
  assert.match(text, /读取中…/, '骨架屏必须给读屏留下加载文案')
})

test('进入页面只请求 /meta 与 /board，任务 / 运行 / 通知留到打开页签再取', async () => {
  const createElement = (type, props, ...children) => ({ type, props: { ...(props ?? {}) }, children })
  const effects = []
  const reactStub = {
    createElement,
    useEffect: (callback) => { effects.push(callback) },
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useRef: (value) => ({ current: value }),
  }
  const mod = loadBundle().factory((name) => name === 'react' ? reactStub : factoryRequire(name))
  let page
  mod.apply({
    get: () => undefined,
    effect: (callback) => { callback(); return () => {} },
    slots: {
      inject: (slot, callback) => { assert.ok(['main', 'sidebar.panellist'].includes(slot)); return callback() },
      register: (declaration, component) => {
        if (declaration.name === 'main') page = component
        return () => {}
      },
    },
    logger: { info() {} },
  })
  const calls = []
  const responses = {
    meta: { storage: { state: 'ready' }, scheduler: { state: 'active' }, notifications: { unread: 2 } },
    board: { ok: true, empty: false, cards: [], todos: [], stocks: [], gaps: [], stats: {}, health: {} },
  }
  const api = new Proxy({}, {
    get: (_target, name) => (...args) => {
      calls.push([String(name), ...args])
      return Promise.resolve(responses[String(name)] ?? {})
    },
  })
  const previousDocument = globalThis.document
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  try {
    page({ api, openSession() {} })
    const cleanups = effects.map((callback) => callback()).filter((value) => typeof value === 'function')
    await new Promise((resolve) => setImmediate(resolve))
    cleanups.forEach((cleanup) => cleanup())
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
  const entry = calls.map(([name]) => name).sort()
  assert.deepEqual(entry, ['board', 'meta'], `入口只该取页面壳与看板，实际请求：${entry.join(', ')}`)
})


test('进入页面只取页面壳与看板，任务 / 运行 / 通知按页签懒加载', () => {
  assert.match(clientSource, /async function loadTasks\(\)/, '任务必须有独立的加载入口')
  assert.match(clientSource, /async function loadRuns\(\)/, '运行必须有独立的加载入口')
  assert.match(clientSource, /async function loadNotifications\(\)/, '任务通知必须有独立的加载入口')
  assert.match(clientSource, /const pending = \[loadMeta\(\)\]/, '刷新/轮询的底包只能是页面壳 /meta')
  assert.match(clientSource, /if \(selectedIdRef\.current !== null \|\| tabRef\.current === 'tasks'\) pending\.push\(loadTasks\(\)\)/, '只有任务页签或任务详情才加载任务')
  assert.match(clientSource, /if \(tabRef\.current === 'runs'\) pending\.push\(loadRuns\(\)\)/, '只有运行页签才加载运行与历史')
  assert.match(clientSource, /if \(inboxRef\.current\) pending\.push\(loadNotifications\(\)\)/, '只有任务通知弹窗打开时才加载通知列表')
  assert.match(clientSource, /if \(tab === 'tasks'\) \{\s*\n\s*void loadMeta\(\)\s*\n\s*void loadTasks\(\)/, '切到任务页签才首次拉取任务')
  assert.match(clientSource, /if \(tab === 'runs'\) \{\s*\n\s*void loadMeta\(\)\s*\n\s*void loadRuns\(\)/, '切到运行页签才首次拉取运行')
  assert.match(clientSource, /if \(inbox\) void loadNotifications\(\)/, '打开任务通知才拉取通知')
  assert.match(clientSource, /value\?\.notifications\?\.unread/, '未读徽标必须跟页面壳一起返回，不能为此拉整份通知')
  assert.doesNotMatch(clientSource, /api\.meta\(\)[\s\S]{0,120}api\.tasks\(\)/, '入口不得把任务和页面壳捆在同一批请求里')
  assert.doesNotMatch(clientSource, /api\.runs\(''?\+?'\?limit=200'\)[\s\S]{0,120}api\.notifications\(\)/, '入口不得把运行和通知捆在同一批请求里')
  assert.match(clientSource, /void refresh\(\)\s*\n\s*\}, 30_000\)/, '页面轮询间隔不得短于 30 秒')
  assert.doesNotMatch(clientSource, /void refresh\(\)\s*\n\s*\}, 15_000\)/, '15 秒全量轮询必须移除')
  assert.match(clientSource, /meta\?\.scheduler\?\.state !== 'standby'/, '调度器待命时才需要加快页面壳轮询')
  assert.match(clientSource, /void loadMeta\(\)\s*\n\s*\}, 10_000\)/, '待命时页面壳每 10 秒重读一次，租约交接后提示自动消失')
  assert.match(clientSource, /function readBoardSnapshot\(query\)/, '看板必须有跨挂载快照，重新进入先画旧数据')
  assert.match(clientSource, /function writeBoardSnapshot\(query, value\)/, '每次成功取数都要更新快照')
  assert.match(clientSource, /const snapshot = before === null \? readBoardSnapshot\(query\) : null/, '看板首帧必须先读快照再后台校正')
  assert.match(clientSource, /requestIdleCallback\(startWarm, \{ timeout: 4_000 \}\)/, '应用空闲时预取默认看板，首次打开不再等请求')
  assert.match(clientSource, /window\.__CA_LAST_TIMING__ = \{/, '必须提供 click→mount 与 mount→board 的只读计时对象')
  assert.match(clientSource, /const TIME_FORMATTERS = new Map\(\)/, 'Intl 格式化器必须缓存，不能每张卡新建')
})


test('看板：默认首页、空态引导手动运行、五个模块与无历史回填', () => {
  assert.match(clientSource, /tabs: \{ board: '看板', tasks: '任务', runs: '运行' \}/, '页签必须先是看板')
  assert.match(clientSource, /\['board', 'tasks', 'runs'\]\.map/, 'Header 顺序必须是看板/任务/运行')
  assert.match(clientSource, /useState\('board'\)/, '打开页面默认停在看板')
  assert.match(clientSource, /function BoardEmpty\(/, '看板必须有独立空态')
  assert.doesNotMatch(clientSource, /不会自动跑，也不会补历史运行/, '空态不再常驻这段说明')
  assert.match(clientSource, /hasActiveTasks \? zh\.board\.goTasks : zh\.board\.goEnable/, '空态 CTA 必须按任务状态给文案')
  assert.match(clientSource, /onGoTasks: \(\) => switchTab\('tasks'\)/, '空态 CTA 只切任务页')
  assert.doesNotMatch(clientSource, /backfill|补生成|摘要未生成/, '看板不提供历史回填/补生成入口')
  assert.match(clientSource, /board\?\.empty === true/, '空态只看后端 empty，不用 0 统计冒充')
  assert.match(clientSource, /function BriefCard\(/, '必须有任务简报卡')
  const briefStart = clientSource.indexOf('function BriefCard(props)')
  const briefEnd = clientSource.indexOf('function BoardSkeleton(props)', briefStart)
  assert.ok(briefStart >= 0 && briefEnd > briefStart, '必须能定位简报卡组件')
  const briefCard = clientSource.slice(briefStart, briefEnd)
  assert.match(briefCard, /'data-size': 'icon',\s*title: zh\.openSession,\s*'aria-label': zh\.openSession,/, '卡片右上角只留图标按钮，靠 title / aria-label 交代动作')
  assert.match(briefCard, /h\(IconRightUpOutlineRegular, \{ size: 14 \}\)/, '打开 session 图标沿用外链箭头')
  assert.doesNotMatch(briefCard, /onClick: openSession \}, zh\.openSession\)/, '失败 / 跳过态卡内不再保留文字版打开 session')
  assert.doesNotMatch(briefCard, /openLink/, '简报卡只留右上角图标，不再生成文字版打开 session 按钮')
  assert.match(briefCard, /const identity = typeof card\.icon === 'string' \? card : \(task \?\? card\)/, '旧 /board 载荷没有图标时必须回退到任务列表')
  assert.match(briefCard, /h\(Glyph, \{ task: identity, size: 24, radius: 8, glyphSize: 14 \}\),\s*h\('h3'/, '简报卡标题左侧必须复用任务的身份图标')
  assert.match(clientSource, /task: taskById\.get\(card\.taskId\)/, '简报卡必须按 taskId 关联任务图标')
  assert.match(clientSource, /h\(BoardPage, \{\s*board,\s*tasks,/, '看板必须拿到任务列表以兼容旧 board 载荷')
  assert.match(clientSource, /\.capital-automation-btn\[data-size="icon"\] \{ width: 30px; height: 30px;/, '图标按钮必须复用方形尺寸规则')
  assert.match(clientSource, /function TodoPanel\(/, '必须有 TODO 面板')
  assert.match(clientSource, /function StockRadar\(/, '必须有自选股雷达')
  assert.match(clientSource, /function DataHealthPanel\(/, '必须有数据体检')
  const gapStart = clientSource.indexOf('function GapRow(props)')
  const gapEnd = clientSource.indexOf('function DataHealthPanel(props)', gapStart)
  assert.ok(gapStart >= 0 && gapEnd > gapStart, '必须能定位数据体检行组件')
  const gapRow = clientSource.slice(gapStart, gapEnd)
  assert.doesNotMatch(gapRow, /capital-automation-gapkind|boardGapLabel/, '数据体检行不再显示能力缺口分类标签')
  assert.doesNotMatch(clientSource, /gapCapability|gapTransient|gapConflict|gapQuality/, '分类标签文案必须一起移除')
  assert.match(gapRow, /'data-size': 'icon',\s*title: zh\.openSession,\s*'aria-label': zh\.openSession,/, '缺口依据行的打开 session 只留图标按钮')
  assert.match(gapRow, /h\(IconRightUpOutlineRegular, \{ size: 14 \}\)/, '缺口打开 session 沿用 TODO 的外链箭头')
  assert.doesNotMatch(gapRow, /\}, zh\.openSession\)/, '缺口依据行不再保留文字版打开 session')
  assert.match(clientSource, /function RunHealthPanel\(/, '必须有运行健康')
  assert.match(clientSource, /capital-automation-boardgrid/, '桌面看板必须是主栏 + 右栏')
  assert.match(clientSource, /@media \(max-width: 860px\)[\s\S]*?capital-automation-boardgrid \{ grid-template-columns: minmax\(0, 1fr\)/, '窄屏看板必须单列')
  assert.doesNotMatch(clientSource, /AI 简报，以原文为准/, '简报卡不再重复 AI 免责声明')
  assert.doesNotMatch(clientSource, /capital-automation-brieffoot/, '简报卡不再保留 footer 行')
  assert.doesNotMatch(clientSource, /zh\.board\.itemsCount/, '简报卡不再显示待办/标的计数')
  assert.doesNotMatch(clientSource, /aiBadge|capital-automation-briefai|capital-automation-briefpartial|capital-automation-briefmeta/, 'AI 简报标识、截断标记与旧 meta 行全部移除')
  assert.doesNotMatch(clientSource, /function AskBar\(/, '旧的常驻输入框组件必须移除')
  assert.match(clientSource, /function AskDock\(/, '每张简报卡需要挂追问入口')
  assert.match(clientSource, /function AskDialog\(/, '点击聊天 icon 必须打开对话弹窗')
  assert.match(clientSource, /function AskExchange\(/, '问答必须抽成可复用的对话项')
  assert.match(clientSource, /IconNewChatOutlineRegular/, '入口必须是聊天 icon')
  assert.match(clientSource, /className: 'capital-automation-briefheadactions'/, '聊天 icon 必须放在卡片头部动作区')
  assert.match(clientSource, /onClick: \(\) => setAskOpen\(true\)/, '聊天 icon 必须打开对话弹窗')
  assert.match(clientSource, /className: 'capital-automation-askinput'/, '输入框只应出现在弹窗里')
  assert.doesNotMatch(briefCard, /capital-automation-askinput/, '简报卡本体不再常驻输入框')
  assert.match(clientSource, /api\.askBrief\(card\.runId, text, browserTimeZone\(\)\)/, '弹窗提交必须写回该卡片对应的 run')
  assert.match(clientSource, /api\.askStatus\(latest\.id\)/, '回答中必须轮询状态')
  assert.match(clientSource, /api\.askHistory\(card\.runId\)/, '打开弹窗时必须读取该 run 的全部追问')
  assert.doesNotMatch(clientSource, /askLoadMore|capital-automation-chathistory|capital-automation-askitem/, '历史一次返回，不做分页')
  assert.doesNotMatch(clientSource, /askUserLabel|askReplyLabel|capital-automation-askwho|capital-automation-askreplyhead|capital-automation-askstate/, '去掉「你问」「回答」文字标签')
  assert.match(clientSource, /className: 'capital-automation-askuser'/, '用户提问必须独立成气泡')
  assert.match(clientSource, /className: 'capital-automation-askreply'/, '回复必须独立成块')
  assert.doesNotMatch(clientSource, /capital-automation-askresult|capital-automation-askanswer/, '旧的未区分问答的 DOM 必须移除')
  assert.match(clientSource, /\.capital-automation-askuser \{[^}]*align-self: flex-end/, '用户提问必须右对齐，和回复分开')
  assert.match(clientSource, /\.capital-automation-askreply \{[^}]*border-left: 2px solid var\(--ca-business\)/, '回复块必须有左侧强调线')
  assert.match(clientSource, /\.capital-automation-askreply\[data-status="failed"\] \{[^}]*border-left-color: var\(--ca-error\)/, '失败的回复块改用错误色强调')
  assert.match(clientSource, /\.capital-automation-askpreview \{[^}]*-webkit-line-clamp: 3/, '回复预览默认 3 行后截断')
  assert.match(clientSource, /\.capital-automation-askfull \{[^}]*white-space: pre-wrap/, '展开后必须显示完整回复并保留换行')
  assert.match(clientSource, /api\.askAnswer\(ask\.id\)/, '查看更多必须读取完整回答')
  assert.match(clientSource, /zh\.board\.askCollapse/, '展开后必须有收起')
  const askStart = clientSource.indexOf('function AskExchange(props)')
  const askEnd = clientSource.indexOf('function AskDialog(props)', askStart)
  assert.ok(askStart >= 0 && askEnd > askStart, '必须能定位对话项组件')
  const askExchange = clientSource.slice(askStart, askEnd)
  assert.match(askExchange, /api\.askAnswer\(ask\.id\)/, '查看更多只在对话项内展开完整回复')
  assert.doesNotMatch(askExchange, /onOpenSession/, '查看更多不再跳转 session')
  assert.match(askExchange, /capital-automation-askuser[\s\S]*capital-automation-askquestion/, '问题只能出现在用户气泡里')
  assert.match(askExchange, /capital-automation-askreply[\s\S]*capital-automation-askpreview/, '默认预览只能出现在回复块里')
  const dialogStart = clientSource.indexOf('function AskDialog(props)')
  const dialogEnd = clientSource.indexOf('function AskDock(props)', dialogStart)
  assert.ok(dialogStart >= 0 && dialogEnd > dialogStart, '必须能定位对话弹窗组件')
  const askDialog = clientSource.slice(dialogStart, dialogEnd)
  assert.match(askDialog, /headless: true/, '对话弹窗必须用 headless Modal 自定义 X 式头部')
  assert.match(askDialog, /className: 'capital-automation-chaticonbtn'[\s\S]{0,160}IconCloseOutlineRegular/, '关闭按钮在左上角')
  assert.doesNotMatch(askDialog, /askCount|chatcount/, '对话数量不再显示')
  assert.match(askDialog, /className: 'capital-automation-chaticonbtn'[\s\S]{0,180}IconRightUpOutlineRegular/, '打开 session 与关闭按钮共用同一图标按钮样式')
  assert.match(askDialog, /title: zh\.openSession,[\s\S]{0,120}'aria-label': zh\.openSession/, '打开 session 图标必须有提示与无障碍名称')
  assert.match(askDialog, /className: 'capital-automation-chatcontext'/, '弹窗顶部必须展示来源简报（X 式父帖）')
  assert.match(askDialog, /h\(Glyph, \{ task: identity \?\? card, size: 38, radius: 999/, '父帖必须有任务头像')
  assert.match(askDialog, /asks\.map\(\(item\) => h\('div', \{ key: item\.id, className: 'capital-automation-chatexchange' \}/, '弹窗必须按时间列出全部问答')
  assert.match(askDialog, /h\(AskExchange, \{ ask: item, api \}\)/, '每条历史记录都要复用同一个问答项')
  assert.doesNotMatch(askDialog, /askLoadMore|chathistory/, '对话弹窗不再分页加载历史')
  assert.match(clientSource, /askEmptyTitle: '暂无提问'/, '空对话只显示「暂无提问」')
  assert.doesNotMatch(clientSource, /askEmptyHint|在下方输入问题/, '空对话不再追加解释句')
  assert.match(askDialog, /className: 'capital-automation-chatcomposer'/, '弹窗底部必须有输入区')
  assert.match(askDialog, /zh\.board\.askSubmit/, '底部必须用文字「提问」按钮')
  assert.match(clientSource, /h\(AskDock, \{\s*card,\s*identity,\s*api,\s*onOpenSession,\s*open: askOpen/, '每张简报卡都挂追问入口与弹窗')
  assert.match(briefCard, /h\(AskDock, \{\s*card,\s*identity,\s*api,\s*onOpenSession,\s*open: askOpen/, '追问入口必须在简报卡内')
  assert.match(clientSource, /api\.board\(/, '客户端必须请求 /board')
  assert.match(clientSource, /api\.retryBrief\(/, '失败简报必须有单条重试入口')
  assert.match(clientSource, /className: 'capital-automation-todotitle',\s*'aria-expanded'/, 'TODO 标题本身就是依据展开入口')
  const todoStart = clientSource.indexOf('function TodoRow(props)')
  const todoEnd = clientSource.indexOf('function BoardPanelHead(props)', todoStart)
  assert.ok(todoStart >= 0 && todoEnd > todoStart, '必须能定位 TODO 行组件')
  const todoRow = clientSource.slice(todoStart, todoEnd)
  assert.match(todoRow, /'data-size': 'icon',\s*title: zh\.openSession,\s*'aria-label': zh\.openSession,/, 'TODO 依据行的打开 session 只留图标按钮，靠 title / aria-label 交代动作')
  assert.match(todoRow, /const sources = Array\.isArray\(item\.sources\)/, '合并条目必须读取全部来源')
  assert.match(todoRow, /sources\.map\(\(entry, index\)/, '依据面板必须逐条列出全部来源，不能只显示最新一条')
  assert.match(todoRow, /key: entry\.runId/, '每条来源必须用自己的 runId 做 key')
  assert.match(todoRow, /h\(IconRightUpOutlineRegular, \{ size: 14 \}\)/, 'TODO 打开 session 沿用简报卡的外链箭头')
  assert.doesNotMatch(todoRow, /\}, zh\.openSession\)/, 'TODO 依据行不再保留文字版打开 session')
  assert.doesNotMatch(clientSource, /capital-automation-todobasis/, 'TODO 行不再单列依据按钮')
  assert.match(todoRow, /capital-automation-todowatch/, 'TODO 行必须显示自动核验状态')
  assert.doesNotMatch(todoRow, /capital-automation-todokind/, 'TODO 行只保留一个状态标签，不再并列 kind 标签')
  assert.match(todoRow, /capital-automation-todowatchmsg/, '触发必须有独立说明行')
  assert.doesNotMatch(todoRow, /handoffReason/, '待人工处理不再显示通用交接说明')
  assert.match(todoRow, /className: 'capital-automation-todomenu'/, '待人工处理右侧改为更多操作按钮')
  assert.match(todoRow, /'aria-haspopup': 'menu'/, '更多操作必须打开菜单')
  assert.match(todoRow, /id: 'confirm'/, '菜单必须包含已确认')
  assert.match(todoRow, /const archived = period === 'expired'/, '历史行必须进入归档展示')
  assert.match(todoRow, /const status = archived \? 'expired' : boardTodoStatus\(item\)/, '历史行统一显示已过期状态')
  assert.match(todoRow, /const actionable = !archived && boardTodoCheckable\(status\)/, '历史行不再提供操作菜单')
  assert.match(todoRow, /const pastDue = typeof item\.dueAt === 'string' && item\.dueAt < localDateKey\(new Date\(\)\)/, '过期条目不能再转入自动校验')
  assert.match(todoRow, /const autoAvailable = !archived && !pastDue && boardTodoAutoAvailable\(item, status\)/, '过期条目的自动分支必须禁用')
  assert.match(todoRow, /'data-archived': 'true'/, '历史行必须有独立样式属性')
  assert.match(todoRow, /if \(archived\) \{[\s\S]{0,1600}capital-automation-historytitle/, '历史行标题独占一行，点击展开依据')
  assert.match(todoRow, /const tags = !archived && watchLabel\.length > 0/, '历史行不再显示 watch 状态标签')
  assert.match(todoRow, /capital-automation-historyconclusion/, '历史行第二行必须给出结论标签')
  assert.match(todoRow, /todoManualAt|todoCheckedAt/, '历史行必须给出人工处理或核验日期')
  assert.doesNotMatch(todoRow, /capital-automation-todooutcome/, '历史行不再显示旧的过期结果标签')
  assert.match(todoRow, /id: 'auto'/, '菜单必须包含转入自动校验')
  assert.match(todoRow, /id: 'defer'/, '菜单必须包含忽略')
  assert.doesNotMatch(todoRow, /todoAckTitle|todowatchcheck|'✓'/, '已确认标签不再附带对勾标记')
  assert.match(todoRow, /id: 'auto-unavailable'/, '不支持自动校验时必须展示禁用原因')
  assert.doesNotMatch(todoRow, /role: 'checkbox'/, '不再使用单个勾选框收口')
  assert.match(clientSource, /watchTriggered: '已触发'/, '触发态必须有明确标签')
  assert.match(clientSource, /watchNeedsHuman: '待人工处理'/, '人工交接统一为待人工处理')
  assert.match(clientSource, /watchResolved: '已确认'/, '确认后必须显示已确认')
  assert.match(clientSource, /watchDeferred: '已忽略'/, '忽略后的状态标签必须是已忽略')
  assert.match(clientSource, /function boardTodoVerifierHint\(tasks\)/, '核验状态必须能列出具体核验任务')
  assert.match(clientSource, /TODO_VERIFIER_IDS = new Set\(\['todo-verifier-close'\]\)/, '核验任务集合必须与自动核验一致')
  assert.match(clientSource, /if \(typeof item\.ackedAt === 'string'/, '确认态必须按 ackedAt 收口')
  assert.match(clientSource, /if \(typeof item\.deferredAt === 'string'/, '忽略态必须按 deferredAt 收口')
  assert.doesNotMatch(clientSource, /todoAttention|capital-automation-todocount/, 'TODO 标题不再提示待处理条数')
  assert.match(clientSource, /item\.todoId !== undefined\s*\?\s*\(\) => onOpenTodo\(item\)/, 'TODO 通知必须直接回到看板')
  assert.match(clientSource, /function openTodoFromNotification\(/, '通知中心必须能处理 TODO 通知')
  assert.match(clientSource, /capital-automation-healthissues/, '运行健康必须列异常')
  const healthStart = clientSource.indexOf('function RunHealthPanel(props)')
  const healthEnd = clientSource.indexOf('function BoardPage(props)', healthStart)
  assert.ok(healthStart >= 0 && healthEnd > healthStart, '必须能定位运行健康组件')
  const healthPanel = clientSource.slice(healthStart, healthEnd)
  assert.match(healthPanel, /'data-size': 'icon',\s*title: zh\.openSession,\s*'aria-label': zh\.openSession,/, '运行健康异常行的打开 session 只留图标按钮')
  assert.match(healthPanel, /h\(IconRightUpOutlineRegular, \{ size: 14 \}\)/, '运行健康打开 session 沿用外链箭头')
  assert.doesNotMatch(healthPanel, /zh\.board\.healthOpen/, '运行健康不再保留文字版打开 session')
  assert.doesNotMatch(clientSource, /healthOpen:/, '运行健康的打开 session 文案必须一起移除')
  assert.doesNotMatch(clientSource, /capital-automation-board[\s\S]{0,2000}api\.run\(/, '看板空态/卡片不能自动运行任务')
})

test('看板右侧：默认展开，可整体收起，四个面板各自折叠', () => {
  assert.match(source, /capital-automation-paneltoggle/, '改完源码必须重建 client.js')
  assert.match(clientSource, /hideRail: '收起右侧'/, '工具栏必须有整体收起入口')
  assert.match(clientSource, /showRail: '展开右侧'/, '工具栏必须有整体展开入口')
  assert.match(clientSource, /useState\(\(\) => readBoardUi\(\)\.rail !== false\)/, '右侧默认展开，只有用户主动收起才持久化')
  assert.match(clientSource, /'data-rail': railOpen === true \? 'open' : 'closed'/, '右栏收起时主栏必须占满宽度')
  assert.match(clientSource, /hidden: railOpen !== true/, '右栏收起时必须隐藏')
  assert.match(clientSource, /typeof localStorage === 'undefined'/, 'localStorage 不可用时不得破坏看板')
  assert.match(clientSource, /function BoardPanel\(/, '右栏面板必须有统一折叠容器')
  assert.match(clientSource, /className: 'capital-automation-paneltoggle'/, '面板标题必须可点击折叠')
  assert.match(clientSource, /'aria-controls': `\$\{id\}-body`/, '折叠按钮必须指向面板正文')
  assert.match(clientSource, /hidden: open !== true/, '折叠后面板正文必须隐藏')
  assert.match(clientSource, /\.capital-automation-paneltoggle\[aria-expanded="false"\] \.capital-automation-panelchevron \{ transform: rotate\(-90deg\)/, '收起后箭头必须转向')
  assert.doesNotMatch(clientSource, /panelchevron\[data-open=/, '图标组件不会转发 data-open，箭头方向不能再用它控制')
  assert.match(clientSource, /const flags = \{ todo: true, stocks: true, gaps: false, health: false \}/, '首屏默认展开 TODO 与自选股雷达，其余面板折叠')
  assert.doesNotMatch(clientSource, /capital-automation-todotabs/, 'TODO 不再保留筛选胶囊行')
  assert.doesNotMatch(clientSource, /counts\.confirm} \//, 'TODO 标题行不再显示 1 / 3 / 1 计数')
  assert.match(clientSource, /\.capital-automation-todoline \{ display: flex; flex-direction: column;/, 'TODO 类型标签独占一行，标题必须在标签下方')
  assert.match(clientSource, /\.capital-automation-todotop \{ display: flex; align-items: center; justify-content: space-between;/, '类型标签与确认操作同排，标题不在这一行')
  assert.match(clientSource, /className: 'capital-automation-todotop'/, 'TODO 行必须分成标签/操作行与标题行')
  assert.match(clientSource, /className: 'capital-automation-todotitle'/, 'TODO 标题必须占满整行')
  assert.match(clientSource, /className: 'capital-automation-tododesc'/, 'TODO 说明必须全宽显示')
  assert.match(clientSource, /\.capital-automation-todotitle \{[^}]*color: var\(--dsw-alias-label-primary\); font-size: 13px; line-height: 20px; font-weight: 600/, 'TODO 标题必须高对比并加大行高')
  const todoRowStart = clientSource.indexOf('function TodoRow(props)')
  const todoRowEnd = clientSource.indexOf('function BoardPanelHead(props)', todoRowStart)
  assert.ok(todoRowStart >= 0 && todoRowEnd > todoRowStart, '必须能定位 TODO 行组件')
  const todoRowSource = clientSource.slice(todoRowStart, todoRowEnd)
  assert.doesNotMatch(todoRowSource, /capital-automation-basiscaret/, 'TODO 卡片不再画展开箭头：标题本身就是入口，长标题折行时也不会多出一行箭头')
  assert.doesNotMatch(todoRowSource, /capital-automation-todotitletext/, '标题文字不再单独成盒，不必给箭头预留位置')
  assert.match(todoRowSource, /className: 'capital-automation-todotitle',\s*'aria-expanded'/, '去掉箭头后标题仍要带 aria-expanded')
  assert.match(clientSource, /\.capital-automation-tododesc \{[^}]*font-size: 12px; line-height: 20px/, 'TODO 说明必须加大行距')
  assert.match(clientSource, /className: 'capital-automation-todomenu'/, 'TODO 行必须有更多操作按钮')
  assert.match(clientSource, /todoAcked: '已确认'/, '确认成功后必须给出明确回执')
  assert.match(clientSource, /api\.decideTodo\(item\.id, action\)/, '决定必须写回服务端，不能只改本地状态')
  assert.match(clientSource, /onDecideTodo: \(item, action\) => \{ decideTodo\(item, action\) \}/, '看板必须把决定动作接到 TODO 行')
  assert.match(clientSource, /optimisticDecisionRef\.current\.set\(item\.id, \{ action, at \}\)/, '点击后先本地应用决定，不等网络回执')
  assert.match(clientSource, /setBoard\(\(current\) => applyTodoDecision\(current, item\.id, action, at\)\)/, '决定后本地立即更新看板')
  assert.doesNotMatch(clientSource, /capital-automation-todocheckspin/, '决定不能等网络回执转圈')
  assert.match(clientSource, /'data-decided': decided \? 'true' : undefined/, '已决定行必须有收起态属性')
  assert.match(clientSource, /function boardTodoEntries\(todos, now = new Date\(\)\)/, '今日 TODO 排序必须复用统一归档逻辑')
  assert.match(clientSource, /\.capital-automation-todoitem\[data-decided="true"\]/, '已决定行必须有收起样式')
  assert.match(clientSource, /\.capital-automation-todotags \{[^}]*flex: none;/, '标签容器不能被长标题压缩，否则标签和标题会被挤到一起')
  assert.match(clientSource, /\[data-decided="true"\] \.capital-automation-todotop, \.capital-automation-todoitem\[data-archived="true"\] \.capital-automation-todotop \{ justify-content: flex-start; gap: 10px; \}/, '已决定/归档行的标签与标题间距必须固定，不被 space-between 拉开')
  assert.match(clientSource, /\[data-decided="true"\], \.capital-automation-todoitem\[data-archived="true"\] \{ padding: 7px 0; opacity: \.72; border-top: 0; \}/, '已决定/归档行之间不再重复画分隔线')
  assert.match(clientSource, /:not\(\[data-decided="true"\]\):not\(\[data-archived="true"\]\) \+ \.capital-automation-todoitem\[data-decided="true"\] \{ border-top: \.5px solid var\(--ca-line\); \}/, '第一条已决定行必须与上面的待处理项分隔，历史行不参与')
  assert.match(clientSource, /\.capital-automation-stockname \{[^}]*color: var\(--dsw-alias-label-primary\); font-size: 12\.5px; line-height: 19px; font-weight: 600/, '自选股名称必须高亮')
  assert.match(clientSource, /\.capital-automation-stocknote \{[^}]*font-size: 12px; line-height: 19px/, '自选股说明必须加大行距')
  assert.doesNotMatch(clientSource, /capital-automation-gapmain/, '数据体检也不能保留 54px 左栏')
  assert.match(clientSource, /className: 'capital-automation-gaplist'/, '缺口列表必须有类名，不能吃浏览器默认 ul 缩进')
  assert.match(clientSource, /\.capital-automation-gaplist[^}]*margin: 0; padding: 0/, '缺口列表必须与面板内容左对齐')
  assert.match(clientSource, /\.capital-automation-gaptitle \{[^}]*color: var\(--dsw-alias-label-primary\); font-size: 13px; line-height: 20px; font-weight: 600/, '缺口标题必须高亮')
  const gapRowStart = clientSource.indexOf('function GapRow(props)')
  const gapRowEnd = clientSource.indexOf('function DataHealthPanel(props)', gapRowStart)
  assert.ok(gapRowStart >= 0 && gapRowEnd > gapRowStart, '必须能定位数据缺口行组件')
  const gapRowSource = clientSource.slice(gapRowStart, gapRowEnd)
  assert.doesNotMatch(gapRowSource, /capital-automation-basiscaret/, '数据能力缺口也不再画展开箭头：标题本身就是入口')
  assert.match(gapRowSource, /className: 'capital-automation-gaptitle',\s*'aria-expanded'/, '去掉箭头后缺口标题仍要带 aria-expanded')
  assert.match(clientSource, /\.capital-automation-gapdesc \{[^}]*font-size: 12px; line-height: 20px/, '缺口说明必须加大行距')
  assert.match(clientSource, /\.capital-automation-healthgrid \{ display: grid; grid-template-columns: max-content minmax\(0, 1fr\)/, '运行健康必须用标签/值两列对齐')
  assert.match(clientSource, /\.capital-automation-healthval \{[^}]*color: var\(--dsw-alias-label-primary\); font-size: 12\.5px; line-height: 19px/, '运行健康值必须高对比')
  assert.match(clientSource, /\.capital-automation-healthissuetitle \{[^}]*color: var\(--dsw-alias-label-primary\); font-size: 12\.5px; line-height: 19px; font-weight: 600/, '异常行任务名必须高亮')
  assert.doesNotMatch(clientSource, /capital-automation-healthline/, '运行健康不再用整段 label：value 拼接')
  assert.match(clientSource, /action: h\('div', \{ className: 'capital-automation-todofilters' \},[\s\S]{0,600}options: boardTodoFilterOptions\(\)/, 'TODO 标题栏必须有日期档位筛选')
  assert.match(clientSource, /const \[filter, setFilter\] = useState\('today'\)/, 'TODO 默认只看今天/尽快')
  assert.match(clientSource, /const BOARD_TODO_PERIODS = \['today', 'future', 'expired'\]/, 'TODO 只保留今天/尽快、将来、已过期三档')
  assert.doesNotMatch(clientSource, /dueTomorrow|dueThisWeek|dueLater|todoFilterAll/, '不再保留明天/本周/以后筛选')
  assert.match(clientSource, /className: 'capital-automation-todolist'/, 'TODO 必须平铺，不再按日期分组')
  assert.match(clientSource, /\.capital-automation-todolist[^}]*margin: 0; padding: 0/, 'TODO 列表必须去掉浏览器默认缩进')
  assert.doesNotMatch(clientSource, /capital-automation-todogroup/, 'TODO 不再显示日期分组标题')
  assert.match(clientSource, /showDue: true/, '三个筛选档位下都显示行内日期')
  assert.match(clientSource, /todoEmptyToday: '今天暂无待办'/, '当天没有待办时必须有暂无话术')
  assert.match(clientSource, /filter === 'today'\s*\? zh\.board\.todoEmptyToday/, '今天档位的空态必须用当天话术')
  assert.match(clientSource, /function boardTodoDueLabel\(/, 'TODO 行内日期必须由统一 helper 计算')
  assert.match(clientSource, /const jumpTo = \(id\) =>/, '统计锚点必须能打开目标面板')
  assert.match(clientSource, /setRailOpen\(true\)[\s\S]{0,160}\[key\]: true/, '统计锚点必须先展开右栏和目标面板')
  assert.doesNotMatch(clientSource, /useEffect\(\(\) => \{\s*saveBoardUi/, '首屏渲染不能把默认状态写成用户偏好')
})

test('个股动态：标签筛选、默认 12 条、展开全部、标签释义、跟进数一致与条目直达 session', () => {
  assert.match(clientSource, /statsStocks: '个股动态'/, '统计卡改为个股动态')
  assert.match(clientSource, /statsStocksNew: '新增'/, '统计卡必须显示当天新增个股')
  assert.match(clientSource, /stockTitle: '个股动态'/, '右栏模块不再用「标的」')
  assert.match(clientSource, /stocksCount: '共 \{n\} 只'/, '右上角计数改用「只」')
  assert.match(clientSource, /const BOARD_STOCK_PAGE_SIZE = 12/, '个股默认只显示 12 条')
  assert.match(clientSource, /BOARD_STOCK_ROLES = \['holding', 'risk', 'event', 'watch', 'other'\]/, '筛选与标签顺序固定为持仓/风险/事件/关注/其他')
  assert.match(clientSource, /function boardStockFilterOptions\(\)/, '标题栏必须提供按标签筛选')
  assert.match(clientSource, /options: boardStockFilterOptions\(\)/, '筛选选项必须接到 Select')
  assert.match(clientSource, /value: 'all', label: zh\.board\.stockFilterAll/, '筛选默认全部')
  assert.match(clientSource, /stockShowAll: '展开全部 \{n\} 只'/, '隐藏的个股必须有展开全部入口')
  assert.match(clientSource, /showAll \? filtered : filtered\.slice\(0, BOARD_STOCK_PAGE_SIZE\)/, '展开前只切出前 12 条')
  assert.match(clientSource, /stockTodoCount: '\{n\} 条待跟进'/, '「待办」改为与展开条目一致的「待跟进」')
  assert.match(clientSource, /stockTodoCountHint/, '「N 条待跟进」必须有含义解释')
  assert.match(clientSource, /title: boardRoleTitle\(role\)/, '标签必须带 hover 释义')
  assert.match(clientSource, /roleHoldingHint: /, '持仓标签必须有释义')
  assert.match(clientSource, /roleRiskHint: /, '风险标签必须有释义')
  assert.match(clientSource, /roleEventHint: /, '事件标签必须有释义')
  assert.match(clientSource, /roleWatchHint: /, '关注标签必须有释义')
  assert.match(clientSource, /roleOtherHint: /, '其他标签必须有释义')
  assert.match(clientSource, /if \(role === 'other'\) return zh\.board\.roleOther/, '其他标签必须有自己的名词')
  const stockStart = clientSource.indexOf('function StockRow(props)')
  const stockEnd = clientSource.indexOf('function StockRadar(props)', stockStart)
  assert.ok(stockStart >= 0 && stockEnd > stockStart, '必须能定位个股行组件')
  const stockRow = clientSource.slice(stockStart, stockEnd)
  assert.match(stockRow, /const related = Array\.isArray\(stock\.items\)/, '展开列表必须直接用服务端随个股返回的条目')
  assert.match(stockRow, /const followUpCount = Array\.isArray\(stock\.items\) \? stock\.items\.length/, '计数必须与展开条目同源')
  assert.match(stockRow, /followUpCount > 0/, '数量为 0 时不显示跟进标签')
  assert.match(stockRow, /onClick: \(\) => onOpenSession\(item\.sessionId\)/, '点击跟进条目直接打开来源 session')
  assert.doesNotMatch(stockRow, /\}, zh\.openSession\)/, '个股跟进条目不再保留文字版打开 session')
  assert.match(stockRow, /boardEntrySymbolKey\(item\) === stockKey/, '旧载荷回退时仍按合并后的标的键匹配')
  assert.match(clientSource, /\.capital-automation-stocktodo:hover \{[^}]*color: var\(--ca-business-text\)/, '可点击的跟进条目 hover 必须变蓝')
  assert.match(clientSource, /\.capital-automation-stockmain:hover \.capital-automation-stockname[^}]*color: var\(--ca-business-text\)/, '可展开的个股行 hover 必须变蓝')
  assert.match(source, /capital-automation-stocktodo/, '改完源码必须重建 client.js')
})

test('TODO 日期归并：今天/尽快、将来、已过期，未来日期不单独成档', () => {
  const start = clientSource.indexOf('function boardTodoPeriod')
  const end = clientSource.indexOf('function boardTodoGroupLabel', start)
  assert.ok(start >= 0 && end > start, '必须能定位 TODO 日期归档函数')
  const localDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const boardTodoPeriod = new Function('localDateKey', `${clientSource.slice(start, end)}; return boardTodoPeriod`)(localDateKey)
  const now = new Date(2026, 10, 7, 10, 0, 0)
  const at = (day) => new Date(2026, 10, day, 9, 0, 0).toISOString()
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-07' }, now), 'today', '当天到期属于今天')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-06' }, now), 'expired', '过期日期保留')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-07', watch: { status: 'triggered', checkedAt: at(7) } }, now), 'today', '当天触发的条目留在今天')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-06', watch: { status: 'triggered', checkedAt: at(6) } }, now), 'expired', '隔天触发的条目收入历史 TODO')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-08', watch: { status: 'triggered', checkedAt: at(7) } }, now), 'today', '触发早于到期日时，仍保留到到期日')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-06', watch: { status: 'triggered' } }, now), 'expired', '没有触发时间的旧记录按到期日归档')
  assert.equal(boardTodoPeriod({ watch: { status: 'triggered' } }, now), 'today', '没有日期与触发时间的旧记录保守留在今天')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-06', watch: { status: 'needs_human' } }, now), 'expired', '待人工条目到期后归档')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-06', watch: { status: 'expired' } }, now), 'expired', '已过期条目不回到今天')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-06', ackedAt: at(7), watch: { status: 'resolved', resolvedFrom: 'needs_human' } }, now), 'today', '确认后的待人工条目仍留在今天显示已确认')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-06', ackedAt: at(6), watch: { status: 'resolved', resolvedFrom: 'needs_human' } }, now), 'expired', '隔天确认的条目按原日期归档')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-06', deferredAt: at(7), watch: { status: 'resolved', resolvedFrom: 'needs_human' } }, now), 'today', '忽略的条目当天仍留在今天')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-06', deferredAt: at(7), watch: { status: 'resolved', resolvedFrom: 'watching' } }, now), 'today', '从自动核验转忽略的过期项当天仍留在今天')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-06', deferredAt: at(6), watch: { status: 'resolved', resolvedFrom: 'needs_human' } }, now), 'expired', '隔天忽略的条目按原日期归档')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-06', watch: { status: 'watching', autoRequestedAt: at(7) } }, now), 'expired', '过期后自动请求不再覆盖到期日')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-06', watch: { status: 'watching' } }, now), 'expired', '普通自动核验过期项不强行留在今天')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-08' }, now), 'future', '明天归入将来')
  assert.equal(boardTodoPeriod({ dueAt: '2026-11-18' }, now), 'future', '更远日期收入将来，到当天才浮到今天')
  assert.equal(boardTodoPeriod({ dueLabel: '尽快', finishedAt: at(7) }, now), 'today', '当天生成的“尽快”归入今天优先队列')
  assert.equal(boardTodoPeriod({ dueLabel: '尽快', finishedAt: at(6), watch: { status: 'watching' } }, now), 'today', '有 watch 的“尽快”在 72 小时内仍留在今天')
  assert.equal(boardTodoPeriod({ dueLabel: '尽快', finishedAt: at(6), watch: { status: 'expired' } }, now), 'expired', 'watch 已停止的“尽快”归档')
  assert.equal(boardTodoPeriod({ dueLabel: '尽快', finishedAt: at(6) }, now), 'future', '没有 watch 的旧“尽快”留在将来')
  assert.equal(boardTodoPeriod({ ackedAt: at(6), dueLabel: '尽快', watch: { status: 'resolved' } }, now), 'expired', '隔天已决定的无日期条目也归档')
  assert.equal(boardTodoPeriod({ dueLabel: '马上', finishedAt: at(7) }, now), 'today', '当天生成的“马上”归入今天优先队列')
  assert.equal(boardTodoPeriod({ dueLabel: '今天', finishedAt: at(7) }, now), 'today', '当天生成的“今天”仍然有效')
  assert.equal(boardTodoPeriod({ dueLabel: '今天', finishedAt: at(6) }, now), 'expired', '隔夜的“今天”必须转为已过期')
  assert.equal(boardTodoPeriod({ dueLabel: '明天' }, now), 'future', '旧的明天标签归入将来')
  assert.equal(boardTodoPeriod({ dueLabel: '本周' }, now), 'future', '旧的本周标签归入将来')
  assert.equal(boardTodoPeriod({}, now), 'future', '没有时间点属于将来')

  const dueStart = clientSource.indexOf('function boardTodoDueLabel')
  const dueEnd = clientSource.indexOf('const TODO_VERIFIER_IDS', dueStart)
  assert.ok(dueStart >= 0 && dueEnd > dueStart, '必须能定位 TODO 行内日期函数')
  const boardTodoDueLabel = new Function('zh', `${clientSource.slice(dueStart, dueEnd)}; return boardTodoDueLabel`)({
    board: { dueToday: '今天', dueAsap: '尽快', dueNoDate: '未定', dueFuture: '将来' },
  })
  assert.match(clientSource, /statsTodos: '今天 TODO'/, '顶部统计必须与默认的今日视图同口径')
  assert.match(clientSource, /statsTodoManual: '人工'/, '今天 TODO 必须拆出人工数')
  assert.match(clientSource, /statsTodoAuto: '自动'/, '今天 TODO 必须拆出自动数')
  assert.match(clientSource, /function boardTodoTodaySplit\(todos, now = new Date\(\)\)/, '今日 TODO 计数与人工/自动拆分必须复用同一套归档逻辑')
  assert.match(clientSource, /todos: todoToday\.total, todosManual: todoToday\.manual, todosAuto: todoToday\.auto/, '顶部 TODO 数字必须换成今日档数量并带上拆分')
  assert.equal(boardTodoDueLabel({ dueLabel: '尽快' }, 'today'), '尽快')
  assert.equal(boardTodoDueLabel({ dueAt: '2026-11-08' }, 'future'), '11-08', '将来档有具体日期时直接显示日期')
  assert.equal(boardTodoDueLabel({ dueLabel: '本周' }, 'future'), '未定', '将来档没有具体日期时显示未定')
  assert.match(clientSource, /dueFuture: '将来'/, '第二档的筛选项必须叫「将来」')
  assert.match(clientSource, /historyTodo: '历史 TODO'/, '第三档的筛选项必须叫「历史 TODO」')
  assert.doesNotMatch(clientSource, /dueEventDate|dueHint|到这天会自动进入/, '不再保留事件日文案与悬停提示')
  assert.equal(boardTodoDueLabel({ dueAt: '2026-11-06' }, 'expired'), '', '历史行不再显示日期 chip，日期由日期选择器承担')
})

test('TODO 决定：先本地收起，已决定行排到今天最后', () => {
  const entriesStart = clientSource.indexOf('function boardTodoEntries')
  const entriesEnd = clientSource.indexOf('function boardTodoIsOpen', entriesStart)
  assert.ok(entriesStart >= 0 && entriesEnd > entriesStart, '必须能定位 TODO 排序函数')
  const boardTodoEntries = new Function(
    'BOARD_TODO_PERIODS',
    'boardTodoPeriod',
    `${clientSource.slice(entriesStart, entriesEnd)}; return boardTodoEntries`,
  )(['today', 'future', 'expired'], (item) => item.period)

  const ordered = boardTodoEntries([
    { id: 'acked-old', period: 'today', ackedAt: '2026-11-11T01:00:00.000Z' },
    { id: 'open-1', period: 'today' },
    { id: 'deferred', period: 'today', deferredAt: '2026-11-11T01:30:00.000Z' },
    { id: 'acked-new', period: 'today', ackedAt: '2026-11-11T02:00:00.000Z' },
    { id: 'open-2', period: 'today' },
    { id: 'expired-old', period: 'expired', dueAt: '2026-11-04' },
    { id: 'expired-new', period: 'expired', dueAt: '2026-11-10' },
    { id: 'expired-undated', period: 'expired', lastSeenAt: '2026-11-01T00:00:00.000Z' },
  ])
  assert.deepEqual(
    ordered.filter((entry) => entry.period === 'today').map((entry) => entry.item.id),
    ['open-1', 'open-2', 'acked-old', 'deferred', 'acked-new'],
    '未决定项留在上面，已决定项按决定时间排到今天最后',
  )
  assert.deepEqual(
    ordered.filter((entry) => entry.period === 'expired').map((entry) => entry.item.id),
    ['expired-new', 'expired-old', 'expired-undated'],
    '已过期按到期日倒序，无日期项排最后',
  )

  const helperStart = clientSource.indexOf('function boardTodoIsOpen')
  const helperEnd = clientSource.indexOf('function boardTodoFilterOptions', helperStart)
  assert.ok(helperStart >= 0 && helperEnd > helperStart, '必须能定位 TODO 决定本地状态函数')
  const boardEntrySymbolKey = (entry) => entry.symbolKey ?? entry.symbol
  const helpers = new Function(
    'boardEntrySymbolKey',
    `${clientSource.slice(helperStart, helperEnd)}; return { applyTodoDecision, restoreBoardTodoState }`,
  )(boardEntrySymbolKey)

  const watch = { status: 'needs_human', resolvedFrom: null, checkedAt: null, evidence: '证据', source: '来源' }
  const before = {
    todos: [{ id: 'todo-1', symbol: '300803.SZ', symbolKey: '300803.SZ', title: '指南针', sessionId: 'session-1', watch }],
    stocks: [{ symbolKey: '300803.SZ', items: [{ id: 'todo-1', title: '指南针', sessionId: 'session-1' }], todoCount: 1 }],
    stats: { todos: 1 },
  }
  const at = '2026-11-11T03:00:00.000Z'
  const confirmed = helpers.applyTodoDecision(before, 'todo-1', 'confirm', at)
  assert.equal(confirmed.todos[0].ackedAt, at, '点击后必须立即写入本地确认时间')
  assert.equal(confirmed.todos[0].decision, 'confirmed', '必须记录确认决定')
  assert.equal(confirmed.todos[0].watch.status, 'resolved', 'watch 必须立即收口为 resolved')
  assert.equal(confirmed.todos[0].watch.resolvedFrom, 'needs_human', '决定前状态必须留档')
  assert.equal(confirmed.stocks[0].todoCount, 0, '个股跟进数必须立即扣除')
  assert.equal(confirmed.stats.todos, 0, '今日 TODO 统计必须立即扣除')
  assert.equal(helpers.applyTodoDecision(confirmed, 'todo-1', 'confirm', at), confirmed, '重复确认不能再次扣减')

  const deferred = helpers.applyTodoDecision(confirmed, 'todo-1', 'defer', '2026-11-11T03:10:00.000Z')
  assert.equal(deferred.todos[0].ackedAt, undefined, '改判忽略必须撤掉确认时间')
  assert.equal(deferred.todos[0].deferredAt, '2026-11-11T03:10:00.000Z', '改判忽略必须写入忽略时间')
  assert.equal(deferred.todos[0].decision, 'deferred', '改判忽略必须记录决定')
  assert.equal(deferred.stocks[0].todoCount, 0, '确认改忽略不重复扣减')
  assert.equal(deferred.stats.todos, 0, '确认改忽略不重复扣减')

  const auto = helpers.applyTodoDecision(deferred, 'todo-1', 'auto', '2026-11-11T03:20:00.000Z')
  assert.equal(auto.todos[0].decision, undefined, '转自动必须撤掉人工决定')
  assert.equal(auto.todos[0].ackedAt, undefined, '转自动必须撤掉确认时间')
  assert.equal(auto.todos[0].deferredAt, undefined, '转自动必须撤掉忽略时间')
  assert.equal(auto.todos[0].watch.status, 'watching', '转自动必须立即显示自动核验中')
  assert.equal(auto.todos[0].watch.autoRequestedAt, '2026-11-11T03:20:00.000Z', '转自动必须记录请求时间')
  assert.equal(auto.stocks[0].todoCount, 1, '转自动必须恢复个股跟进数')
  assert.equal(auto.stats.todos, 1, '转自动必须恢复今日统计')

  const restored = helpers.restoreBoardTodoState(confirmed, 'todo-1', { ackedAt: undefined, deferredAt: undefined, decision: undefined, watch })
  assert.equal(restored.todos[0].ackedAt, undefined, '写回失败必须撤回本地决定')
  assert.equal(restored.todos[0].watch.status, 'needs_human', '写回失败必须恢复原状态')
  assert.equal(restored.stocks[0].todoCount, 1, '写回失败必须恢复个股跟进数')
  assert.equal(restored.stats.todos, 1, '写回失败必须恢复今日统计')
})

test('TODO 决定菜单：track / 已触发 / 美股不提供自动校验', () => {
  const start = clientSource.indexOf('function boardTodoAutoAvailable')
  const end = clientSource.indexOf('function boardCategoryOptions', start)
  assert.ok(start >= 0 && end > start, '必须能定位自动校验可用性函数')
  const helpers = new Function(`${clientSource.slice(start, end)}; return { boardTodoAutoAvailable, boardTodoAutoReason }`)()
  const { boardTodoAutoAvailable, boardTodoAutoReason } = helpers
  assert.equal(boardTodoAutoAvailable({ kind: 'track', watch: null }, 'tracking'), false, 'track 只给确认/忽略')
  assert.equal(boardTodoAutoAvailable({ kind: 'confirm', watch: { autoEligible: true } }, 'needs_human'), true, 'confirm 可转入自动')
  assert.equal(boardTodoAutoAvailable({ kind: 'verify', watch: { autoEligible: true } }, 'resolved'), true, '已决定项可改判为自动')
  assert.equal(boardTodoAutoAvailable({ kind: 'verify', watch: { autoEligible: false } }, 'needs_human'), false, '服务端标记不可自动时不展示')
  assert.equal(boardTodoAutoAvailable({ kind: 'verify', watch: { autoEligible: true } }, 'triggered'), false, '已触发只给确认/忽略')
  assert.equal(boardTodoAutoAvailable({ kind: 'verify', watch: { autoEligible: true } }, 'watching'), false, '自动核验中不重复转入')
  assert.equal(boardTodoAutoReason({ kind: 'track', watch: null }, 'tracking'), '', 'track 不展示自动校验条目')
  assert.equal(
    boardTodoAutoReason({ kind: 'verify', watch: { autoEligible: false, autoIneligibleReason: 'us_symbol' } }, 'needs_human'),
    '美股暂不支持',
    '美股必须给出禁用原因',
  )
  assert.equal(
    boardTodoAutoReason({ kind: 'verify', watch: { autoEligible: false, autoIneligibleReason: 'triggered' } }, 'triggered'),
    '条件已触发',
    '已触发项必须说明原因',
  )
  assert.equal(
    boardTodoAutoReason({ kind: 'verify', watch: { autoEligible: false, autoIneligibleReason: 'expired' } }, 'needs_human'),
    '已过期',
    '过期项必须说明原因',
  )
})

test('历史 TODO：按日归档、结论标签与日期选择器', () => {
  const start = clientSource.indexOf('function boardTodoDecision')
  const end = clientSource.indexOf('function boardTodoWatchLabel', start)
  assert.ok(start >= 0 && end > start, '必须能定位 TODO 结果函数')
  const localDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const zh = {
    board: {
      todoManualConfirm: '手动确认',
      todoManualDefer: '手动忽略',
      todoNotTriggered: '未触发',
      todoInsufficient: '证据不足',
      todoUnverified: '未完成核验',
      todoTrackEnded: '跟踪结束',
      todoStale: '已停止跟踪',
      watchTriggered: '已触发',
      historyExpired: '已过期',
    },
  }
  const { boardTodoConclusion, boardTodoHistoryDate, formatMonthDay } = new Function(
    'zh',
    'localDateKey',
    `${clientSource.slice(start, end)}; return { boardTodoConclusion, boardTodoHistoryDate, formatMonthDay }`,
  )(zh, localDateKey)

  assert.deepEqual(
    boardTodoConclusion({ decision: 'confirmed', ackedAt: '2026-11-11T01:00:00.000Z' }),
    { label: '手动确认', at: '2026-11-11T01:00:00.000Z', kind: 'manual', tone: 'success' },
  )
  assert.equal(boardTodoConclusion({ decision: 'deferred', deferredAt: '2026-11-11T01:00:00.000Z' }).label, '手动忽略')
  assert.equal(
    boardTodoConclusion({ kind: 'track', watch: { status: 'expired', expiredReason: 'not_verified' } }).label,
    '跟踪结束',
    'track 优先显示跟踪结束',
  )
  assert.equal(boardTodoConclusion({ watch: { status: 'triggered', checkedAt: '2026-11-11T01:00:00.000Z' } }).label, '已触发')
  assert.equal(boardTodoConclusion({ watch: { status: 'expired', expiredReason: 'not_triggered' } }).label, '未触发')
  assert.equal(boardTodoConclusion({ watch: { status: 'expired', expiredReason: 'no_data' } }).label, '证据不足')
  assert.equal(
    boardTodoConclusion({ watch: { status: 'expired', expiredReason: 'no_data', checkedAt: '2026-11-11T09:13:22.305Z' } }).at,
    '2026-11-11T09:13:22.305Z',
    '核验过的证据不足必须保留核验时间',
  )
  const unverified = boardTodoConclusion({ watch: { status: 'expired', expiredReason: 'not_verified' } })
  assert.equal(unverified.label, '未完成核验', '没有核验结论不能写成证据不足')
  assert.equal(unverified.at, undefined, '未核验没有核验时间，不能硬塞日期')
  assert.match(clientSource, /watchChecked: '自动核验于 \{time\}'/, '今日行也要写明结论来自自动核验')
  assert.match(clientSource, /todoCheckedAt: '自动核验于 \{date\}'/, '历史行必须写明结论来自自动核验')
  assert.equal(boardTodoConclusion({ watch: { status: 'expired', expiredReason: 'not_confirmed' } }).label, '已过期')
  assert.equal(boardTodoConclusion({ watch: { status: 'expired', expiredReason: 'stale' } }).label, '已停止跟踪')
  assert.equal(boardTodoConclusion({}).label, '已过期', '没有任何结论的到期项显示已过期')

  assert.equal(boardTodoHistoryDate({ dueAt: '2026-11-10', ackedAt: '2026-11-11T01:00:00.000Z' }), '2026-11-10', 'dueAt 优先')
  assert.equal(boardTodoHistoryDate({ ackedAt: '2026-11-11T01:00:00.000Z' }), '2026-11-11', '无 dueAt 时用人工处理日')
  assert.equal(boardTodoHistoryDate({ watch: { checkedAt: '2026-11-11T01:00:00.000Z' } }), '2026-11-11', '再退回核验日')
  assert.equal(boardTodoHistoryDate({ lastSeenAt: '2026-11-11T01:00:00.000Z' }), '2026-11-11', '最后退回最后提及日')
  assert.equal(formatMonthDay('2026-11-11'), '11-11')

  assert.match(clientSource, /function HistoryDatePicker/, '历史档必须有日期选择器')
  assert.match(clientSource, /useState\(yesterdayDateKey\)/, '历史日期默认昨天')
  assert.match(clientSource, /minDate: board\?\.range\?\.from \?\? null/, '日期选择器只能选当前看板范围内')
  assert.match(clientSource, /filter === 'expired'\s*\? h\(HistoryDatePicker/, '日期选择器只在历史档出现')
  assert.match(clientSource, /disabled: cell\.key > max \|\| \(typeof min === 'string' && min\.length > 0 && cell\.key < min\)/, '不能选择今天、未来或范围外')
  assert.match(clientSource, /capital-automation-datepick-grid/, '日期选择器必须用月历网格')
  assert.match(clientSource, /'data-period': filter/, '历史列表必须标记当前档位')
  assert.match(
    clientSource,
    /\.capital-automation-todolist\[data-period="expired"\] > \.capital-automation-todoitem \{ border-top: 0; \}/,
    '历史行之间不再画横线',
  )
  assert.match(clientSource, /todoEmptyHistory: '\{date\} 暂无历史 TODO'/, '历史空态必须带所选日期')
})

test('看板工具栏：去掉标题，筛选靠左、动作靠右', () => {
  assert.doesNotMatch(clientSource, /capital-automation-boardtitle/, '看板工具栏不再显示页面标题与生成时间')
  assert.match(clientSource, /capital-automation-boardtoolbar' \},\s*h\('div', \{ className: 'capital-automation-boardtools' \}/, '时间范围/分类必须是工具栏第一组、贴左')
  assert.match(clientSource, /className: 'capital-automation-boardactions'[\s\S]{0,400}zh\.board\.refresh/, '刷新与收起右侧单独成组')
  assert.match(clientSource, /\.capital-automation-boardtools \{[^}]*gap: 7px; \}/, '筛选组不再 margin-left:auto')
  assert.match(clientSource, /\.capital-automation-boardactions \{[^}]*margin-left: auto/, '动作组靠右')
})

test('看板简报时间：平铺卡片、相对时间、完整时间留在 title', () => {
  assert.match(source, /capital-automation-brieftime/, '改完源码必须重建 client.js')
  assert.doesNotMatch(source, /capital-automation-briefgroup/, '旧日期组样式不能留在 bundle')
  const start = clientSource.indexOf('function boardRelativeTime')
  const end = clientSource.indexOf('function boardTodoPeriod', start)
  assert.ok(start >= 0 && end > start, '必须能定位相对时间函数')
  const relative = new Function('zh', `${clientSource.slice(start, end)}; return boardRelativeTime`)({ relativeNow: '刚刚' })
  const now = Date.parse('2026-11-04T12:00:00+08:00')
  assert.equal(relative('2026-11-04T11:59:30+08:00', now), '刚刚')
  assert.equal(relative('2026-11-04T11:55:00+08:00', now), '5分钟前')
  assert.equal(relative('2026-11-04T09:00:00+08:00', now), '3小时前')
  assert.equal(relative('2026-11-03T12:00:00+08:00', now), '1天前')
  assert.equal(relative('2026-10-28T12:00:00+08:00', now), '1周前')
  assert.equal(relative('2026-10-05T12:00:00+08:00', now), '1个月前')
  assert.equal(relative('2025-11-04T12:00:00+08:00', now), '1年前')
  assert.equal(relative('not-a-date', now), '')
  assert.doesNotMatch(clientSource, /boardGroupCards|boardDayLabel|boardDateKey|boardClock/, '简报不再按日期分组')
  assert.match(clientSource, /h\('time', \{[\s\S]{0,140}title: exactTime/, '每张卡片必须把完整时间放进 title')
  assert.match(clientSource, /cards\.map\(\(card\) => h\(BriefCard/, '简报必须平铺，不再插日期组标题')
})

test('顶部统计：今天/总量、人工/自动、当天新增与点击高亮', () => {
  assert.match(clientSource, /statsBriefsToday: '今天简报'/, '简报统计拆出今天')
  assert.match(clientSource, /statsBriefsTotal: '总简报'/, '简报统计保留范围总量')
  assert.match(clientSource, /statsTodoManual: '人工'/, 'TODO 统计拆出人工')
  assert.match(clientSource, /statsTodoAuto: '自动'/, 'TODO 统计拆出自动')
  assert.match(clientSource, /statsGaps: '数据能力缺口'/, '缺口统计改名')
  assert.match(clientSource, /statsIssuesToday: '今天运行异常'/, '异常统计只数今天')
  assert.match(clientSource, /label: \[zh\.board\.statsBriefsToday, ' \/ ', zh\.board\.statsBriefsTotal\]/, '简报标签为 今天 / 总')
  assert.match(clientSource, /label: \[zh\.board\.statsTodos, ' : ', zh\.board\.statsTodoManual, ' \/ ', zh\.board\.statsTodoAuto\]/, 'TODO 标签为 今天 : 人工 / 自动')
  assert.match(clientSource, /label: \[zh\.board\.statsStocks, ' \/ ', zh\.board\.statsStocksNew\]/, '个股标签为 动态 / 新增')
  assert.match(clientSource, /label: \[zh\.board\.statsGaps, ' \/ ', zh\.board\.statsGapsNew\]/, '缺口标签为 能力缺口 / 新增')
  assert.match(clientSource, /value: stats\?\.briefsToday \?\? 0/, '今天简报必须读服务端当天计数')
  assert.match(clientSource, /value: stats\?\.briefs \?\? 0 \},\s*\]/, '总简报只读')
  assert.match(clientSource, /value: stats\?\.stocksNewToday \?\? 0/, '个股新增必须读服务端当天新增')
  assert.match(clientSource, /value: stats\?\.gapsNewToday \?\? 0/, '缺口新增必须读服务端当天新增')
  assert.match(clientSource, /value: stats\?\.issuesToday \?\? 0/, '运行异常必须读服务端当天异常')
  assert.match(clientSource, /\.capital-automation-boardstatvalue \{[^}]*gap: 0 2px;/, '数字之间必须留出间隔')
  assert.match(clientSource, /\.capital-automation-boardstatvalue \.capital-automation-boardstatsep \{ padding: 0 3px; \}/, '斜杠与冒号左右要留出空隙')

  const splitStart = clientSource.indexOf('function boardTodoTodaySplit')
  const splitEnd = clientSource.indexOf('function boardTodoGroupLabel', splitStart)
  assert.ok(splitStart >= 0 && splitEnd > splitStart, '必须能定位 TODO 今日计数拆分函数')
  const boardTodoTodaySplit = new Function(
    'boardTodoStatus',
    'boardTodoPeriod',
    `${clientSource.slice(splitStart, splitEnd)}; return boardTodoTodaySplit`,
  )((item) => item.status, (item) => item.period)
  assert.deepEqual(boardTodoTodaySplit([
    { status: 'watching', period: 'today' },
    { status: 'needs_human', period: 'today' },
    { status: 'triggered', period: 'today' },
    { status: 'tracking', period: 'today' },
    { status: 'watching', period: 'future' },
    { status: 'resolved', period: 'today' },
  ]), { total: 4, manual: 3, auto: 1 }, '人工/自动按自动核验状态拆分，已确认与未来项不计入')

  assert.match(clientSource, /const BOARD_BRIEF_HIGHLIGHT_MS = 3_000/, '高亮必须持续 3 秒')
  assert.match(clientSource, /setTimeout\(\(\) => setBriefHighlight\(0\), BOARD_BRIEF_HIGHLIGHT_MS\)/, '3 秒后必须恢复默认边框')
  assert.match(clientSource, /onHighlightTodayBriefs: \(\) => setBriefHighlight/, '今天简报数字必须可点击触发高亮')
  assert.match(clientSource, /highlighted: highlightToken > 0 && boardCardIsToday\(card, today\)/, '只高亮今天的简报卡片')
  assert.match(clientSource, /'data-highlight': highlighted === true \? 'true' : undefined/, '高亮必须落到卡片属性')
  assert.match(clientSource, /\.capital-automation-briefcard\[data-highlight="true"\] \{ border-color: var\(--ca-business\)/, '高亮只改边框色')
  assert.match(source, /data-highlight/, '改完源码必须重建 client.js')
})
