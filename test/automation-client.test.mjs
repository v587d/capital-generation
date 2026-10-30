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
      'IconAlarmClockOutlineRegular', 'IconChecklistOutlineRegular', 'IconChevronDownOutlineRegular',
      'IconChevronLeftOutlineRegular', 'IconChevronRightOutlineRegular', 'IconClockOutlineRegular', 'IconCopyOutlineRegular',
      'IconEditOutlineRegular', 'IconEllipsisOutlineRegular', 'IconFolderOpenOutlineRegular',
      'IconGaugeOutlineRegular', 'IconGlobeOutlineRegular', 'IconInfoOutlineRegular',
      'IconLightOutlineMedium', 'IconListPenOutlineRegular', 'IconPauseOutlineRegular', 'IconPlayOutlineRegular',
      'IconPlusOutlineRegular', 'IconRefreshOutlineRegular', 'IconRightUpOutlineRegular', 'IconSearchOutlineRegular',
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
  assert.equal((clientSource.match(/h\(Select, \{/g) ?? []).length, 5, '五个内联下拉直接使用 Select（频率、时区、工作区、分类）')
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
  assert.match(config, /useDraftIssues\(task, task\.id\)/, '配置页必须逐字段跟踪失焦状态')
  assert.match(config, /error: titleError/, '标题错误必须挂在标题字段')
  assert.match(config, /error: instructionError/, '指令错误必须挂在指令字段')
  assert.match(config, /onBlur: \(\) => touch\('title'\)/, '标题失焦即校验')
  assert.match(config, /onBlur: \(\) => touch\('instruction'\)/, '指令失焦即校验')
  assert.match(config, /onClick: submit/, '保存按钮走内联校验')
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

  assert.match(clientSource, /function draftIssues\(task\)/, '校验必须按字段返回问题集合')
  assert.match(clientSource, /function useDraftIssues\(task, resetKey\)/, '失焦状态必须有单处实现')
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
      done: '完成',
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
  assert.equal(byClass('capital-automation-skeletonrow').length, 4, '任务表先画出 4 行骨架')
  assert.equal(byClass('capital-automation-skeletontemplate').length, 3, '模板区先画出 3 张骨架卡')
  assert.equal(byClass('capital-automation-empty').length, 0, '数据未到时不得先渲染空状态')
  const text = nodes.filter((node) => typeof node === 'string').join('\n')
  assert.doesNotMatch(text, /还没有任务/, '首屏文案里不能出现「还没有任务」')
  assert.match(text, /读取中…/, '骨架屏必须给读屏留下加载文案')
})
