import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AskCreateSchema,
  AskRecordSchema,
  AutomationTaskSchema,
  TaskCategorySchema,
  TaskConfigSchema,
  TaskCreateSchema,
  TaskOverridesSchema,
  TaskPatchSchema,
  TaskRecordSchema,
  TaskBriefSchema,
  NotificationSchema,
  TodoAckSchema,
  TodoConfirmSchema,
  TodoDecisionSchema,
  TodoWatchSchema,
  assertCleanJson,
  resolveTaskRecord,
} from '../automation/schema.js'
import { BUILTIN_DEFINITIONS, BUILTIN_BY_ID } from '../automation/builtins.js'
import { sanitizeMessage } from '../automation/redact.js'
import { DEFAULT_CUSTOM_ICON, TASK_ICON_IDS } from '../automation/task-icons.js'
import {
  DEFAULT_AUTOMATION_SETTINGS,
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_TOOL_CALLS,
  MAX_MAX_STEPS,
  MAX_MAX_TOOL_CALLS,
} from '../automation/defaults.js'
import { Config as HostConfig } from '../config/index.js'
import { Config as MainConfig } from '../lib/index.js'
import { normalizeAutomationSettings } from '../automation/settings.js'

const record = {
  schemaVersion: 1,
  id: 'bt_x',
  origin: 'builtin',
  sourceBuiltinId: 'morning-brief',
  profileKey: 'p_x',
  profileName: 'web',
  state: 'active',
  definitionVersion: 1,
  overrides: { title: '我的早报' },
  scheduleAnchorAt: '2026-10-27T00:00:00.000Z',
  createdAt: '2026-10-27T00:00:00.000Z',
  updatedAt: '2026-10-27T00:00:00.000Z',
}

// The template owns the scan boundary, window and deliverable; category shape, data discipline
// and the unattended policy belong to the runner. Too short drifts into "生成一份复盘", too long
// starts duplicating the prompt the runner already builds.
const MIN_INSTRUCTION_CHARS = 120
const MAX_INSTRUCTION_CHARS = 260

test('十六个内容模板 dormant + 一个 TODO 核验任务 active，指令写清边界、窗口与交付', () => {
  assert.equal(BUILTIN_DEFINITIONS.length, 17)
  assert.deepEqual(BUILTIN_DEFINITIONS.map((item) => item.id), [
    'us-close',
    'pre-open-filings',
    'morning-brief',
    'midday-snapshot',
    'post-close-filings',
    'hk-close',
    'daily-review',
    'todo-verifier-close',
    'us-premarket',
    'portfolio-weekly',
    'watchlist-weekly',
    'sector-weekly',
    'research-topics',
    'earnings-tracker',
    'week-ahead-calendar',
    'market-weekly',
    'portfolio-risk-monthly',
  ])
  for (const definition of BUILTIN_DEFINITIONS) {
    const { instruction, description } = definition.defaults
    const length = Array.from(instruction).length
    assert.equal(definition.defaults.state, definition.id === 'todo-verifier-close' ? 'active' : 'dormant')
    assert.equal(definition.defaults.trigger.kind, 'schedule')
    assert.equal(definition.defaults.trigger.timezone, 'Asia/Shanghai')
    assert.equal(typeof definition.defaults.trigger.tradingDaysOnly, 'boolean', `${definition.id} 必须显式声明是否只看交易日`)
    assert.equal(definition.defaults.cwdKind, 'profile')
    assert.equal('mode' in definition.defaults, false, '输出侧重已并入任务分类，内置定义不能保留 mode')
    assert.ok(length >= MIN_INSTRUCTION_CHARS, `${definition.id} 的指令只有 ${length} 字：边界、覆盖范围与交付要写清，不能只留主题句`)
    assert.ok(length <= MAX_INSTRUCTION_CHARS, `${definition.id} 的指令 ${length} 字过长：数据纪律与运行策略由 runner 提供，不要复制`)
    assert.doesNotMatch(instruction, /数据与来源纪律/, `${definition.id} 不应再复制自动模式的数据纪律`)
    assert.doesNotMatch(instruction, /无人值守执行策略/, `${definition.id} 不应再复制运行策略`)
    assert.doesNotMatch(instruction, /get_watchlist|anysearch|web_retriever|data_collector|data_junior/, `${definition.id} 不应点名工具或角色：工具面由运行模式决定`)
    assert.match(instruction, /^只/, `${definition.id} 的指令要以「只」开头，先收紧扫描与交付范围`)
    assert.match(instruction, /自选股|候选 TODO/, `${definition.id} 必须点明扫描主体是自选股或候选 TODO`)
    assert.doesNotMatch(instruction, /全市场|权重股|行业龙头|所有行业|全部行业|活跃股/, `${definition.id} 不能要求全市场或非自选股的扫描`)
    assert.doesNotMatch(description, /全市场|权重股|行业龙头|所有行业|全部行业|活跃股/, `${definition.id} 的模板说明不能承诺全市场覆盖`)
    assert.match(instruction, /不写|不做|不扫|不重复|不展开|不补|不列|不猜|不硬凑|不拿|不单独成节|不要编造/, `${definition.id} 要写清不做什么，任务之间靠边界区分`)
    assert.match(description, /自选股/, `${definition.id} 的模板说明要点名自选股`)
    assert.ok(Array.from(description).length <= 100, `${definition.id} 的模板说明超过 100 字，页面会截断`)
  }
})

test('任务分类闭集：组合与监控走后端同一份枚举', () => {
  assert.deepEqual([...TaskCategorySchema.options], ['news', 'market', 'review', 'research', 'portfolio', 'monitor'])
})

test('新增模板的日程与职责固定：港美股、组合、监控、研究与盘中各有明确窗口', () => {
  const cases = [
    { id: 'us-close', title: '美股收盘', category: 'market', cadence: 'weekly', time: '07:00', weekdays: [2, 3, 4, 5, 6], tradingDaysOnly: false, matches: [/三大指数/, /盘后异动/, /这些标的的当日财报/, /休市/] },
    { id: 'midday-snapshot', title: '午间快照', category: 'market', cadence: 'daily', time: '11:35', tradingDaysOnly: true, matches: [/11:35/, /涨跌停家数/, /采集时间/] },
    { id: 'todo-verifier-close', title: 'TODO 核验', category: 'monitor', cadence: 'daily', time: '17:00', tradingDaysOnly: true, matches: [/候选 TODO/, /insufficient/, /JSON/] },
    { id: 'hk-close', title: '港股收盘', category: 'market', cadence: 'daily', time: '16:30', tradingDaysOnly: true, matches: [/恒生/, /HSAHP/, /最近已披露交易日/, /休市/] },
    { id: 'us-premarket', title: '美股盘前', category: 'market', cadence: 'weekly', time: '20:30', weekdays: [1, 2, 3, 4, 5], tradingDaysOnly: false, matches: [/盘前/, /不扫非自选股的财报/, /未取到/, /休市/] },
    { id: 'portfolio-weekly', title: '组合周报', category: 'portfolio', cadence: 'weekly', time: '10:00', weekdays: [6], tradingDaysOnly: false, matches: [/标记的持仓/, /集中度相对上周的变化/, /不补满 100%/] },
    { id: 'watchlist-weekly', title: '自选股周检', category: 'monitor', cadence: 'weekly', time: '14:00', weekdays: [6], tradingDaysOnly: false, matches: [/可以移出/, /催化剂/, /不做选题与核查计划/] },
    { id: 'sector-weekly', title: '行业周报', category: 'market', cadence: 'weekly', time: '20:00', weekdays: [6], tradingDaysOnly: false, matches: [/所在行业/, /行业 β/, /不写市场级两融/] },
    { id: 'research-topics', title: '研究选题', category: 'research', cadence: 'weekly', time: '14:00', weekdays: [7], tradingDaysOnly: false, matches: [/3 个/, /核心问题/, /不复述分诊名单/] },
    { id: 'earnings-tracker', title: '财报跟踪', category: 'research', cadence: 'weekly', time: '16:00', weekdays: [7], tradingDaysOnly: false, matches: [/一致预期/, /下一场披露/, /不硬凑/] },
    { id: 'week-ahead-calendar', title: '下周事件日历', category: 'monitor', cadence: 'weekly', time: '18:00', weekdays: [7], tradingDaysOnly: false, matches: [/财报预约/, /解禁/, /待确认/] },
    { id: 'market-weekly', title: '市场周报', category: 'market', cadence: 'weekly', time: '20:00', weekdays: [7], tradingDaysOnly: false, matches: [/沪深300/, /只写市场状态对自选股/, /缺口/] },
    { id: 'portfolio-risk-monthly', title: '组合风险月报', category: 'portfolio', cadence: 'monthly', time: '20:30', dayOfMonth: 'last', tradingDaysOnly: false, matches: [/集中度水平/, /未评估/, /不重列周报的收益归因/] },
  ]
  for (const item of cases) {
    const { defaults } = BUILTIN_BY_ID.get(item.id)
    assert.ok(defaults, `缺少模板 ${item.id}`)
    assert.equal(defaults.title, item.title)
    assert.equal(defaults.category, item.category)
    assert.equal(defaults.trigger.cadence, item.cadence)
    assert.equal(defaults.trigger.time, item.time)
    assert.equal(defaults.trigger.tradingDaysOnly, item.tradingDaysOnly)
    if (item.weekdays !== undefined) assert.deepEqual(defaults.trigger.weekdays, item.weekdays)
    if (item.dayOfMonth !== undefined) assert.equal(defaults.trigger.dayOfMonth, item.dayOfMonth)
    for (const pattern of item.matches) assert.match(defaults.instruction, pattern, `${item.id} 缺少 ${pattern}`)
  }
})

test('盘前公告只收自选股，按开盘前优先级给动作', () => {
  const { instruction, trigger, title } = BUILTIN_BY_ID.get('pre-open-filings').defaults
  assert.equal(title, '盘前公告')
  assert.equal(trigger.time, '08:00', '盘前公告要在开盘前留出阅读时间')
  for (const kind of ['业绩预告', '重组并购', '重大合同', '增减持', '回购', '股权激励', '停复牌', '分红']) {
    assert.match(instruction, new RegExp(kind), `盘前公告缺少「${kind}」这一类`)
  }
  assert.match(instruction, /上一交易日 16:00 后至运行时刻/, '盘前公告只收隔夜增量，16:00 是当日公告的收口点')
  assert.match(instruction, /A 股、港股、美股/, '盘前公告必须覆盖全部自选股市场，不能只做 A 股')
  assert.match(instruction, /分开逐只过/, '盘前公告要按市场分开逐只过自选股，不能只看指数或只看 A 股')
  assert.match(instruction, /每只都要有结论/, '自选股逐只要给结论，不能把港股/美股标成不适用')
  assert.match(instruction, /开盘前必看/, '晚间披露要按开盘前优先级分级')
  assert.match(instruction, /开盘前要做的动作/, '盘前公告要落到动作，而不是再抄一遍公告摘要')
  assert.match(instruction, /不写行情、外盘与宏观/, '盘前公告只写公告，不复述行情、外盘与宏观')
  assert.match(instruction, /未取到/, '取不到公告要明说，不能写成没有公告')
})

test('早间资讯只做开盘前的信息面，公告明细交给盘前公告', () => {
  const { instruction } = BUILTIN_BY_ID.get('morning-brief').defaults
  assert.match(instruction, /3 件事/, '开头要给出最该知道的几件事，避免读完才知道重点')
  for (const bucket of ['隔夜外盘', '商品', '汇率', '宏观', '自选股', '披露', '解禁', '股东大会']) {
    assert.match(instruction, new RegExp(bucket), `早间资讯缺少「${bucket}」这一档`)
  }
  assert.match(instruction, /公告明细交给盘前公告/, '早间资讯不能重复盘前公告的公告明细')
  assert.match(instruction, /不写个股行情与复盘/, '早间资讯不做个股行情与复盘')
  assert.match(instruction, /逐只核过/, '自选股要逐只核对，没有新信息再并成一句')
  assert.match(instruction, /不复述美股收盘的读数、结论与验证点/, '早间资讯不能重复美股收盘的结论')
  assert.match(instruction, /未取到/, '取不到的档必须明说，不能省略成"没有"')
  assert.match(instruction, /写「无」/, '确实没有要写「无」，让用户知道这一档查过')
})

test('当日公告仍定在 16:00，产出次日复核清单并交代披露截止', () => {
  const { instruction, trigger, title } = BUILTIN_BY_ID.get('post-close-filings').defaults
  assert.equal(title, '当日公告', '「盘后」会让人以为当晚公告已出齐，改叫当日公告')
  assert.equal(trigger.time, '16:00', '当日公告仍在收盘后 16:00 运行')
  for (const kind of ['业绩预告', '重组并购', '重大合同', '增减持', '回购', '股权激励', '停复牌', '分红']) {
    assert.match(instruction, new RegExp(kind), `当日公告缺少「${kind}」这一类`)
  }
  assert.match(instruction, /窗口为当日 00:00 至运行时刻/, '当日公告要写死当日窗口，避免把隔夜披露再扫一遍')
  assert.match(instruction, /16:00 后的披露留给次日盘前公告/, '16:00 后的披露归盘前公告，两份清单不重叠')
  assert.match(instruction, /分开逐只过/, '当日公告也要按市场分开逐只过自选股')
  assert.match(instruction, /次日必须处理/, '公告要按次日复核优先级分级')
  assert.match(instruction, /信息截止时刻/, '16:00 披露窗口未完，必须写明信息截止时刻')
  assert.match(instruction, /暂未披露/, '截止后待披露的部分要单列，不能当成没有公告')
  assert.match(instruction, /不写行情与市场综述/, '当日公告不写行情与市场综述')
  assert.match(instruction, /取不到写「未取到」/, '取不到公告要明说，不能写成没有公告')
})

test('每日复盘以自选股为主体，只把指数与板块当背景', () => {
  const { instruction } = BUILTIN_BY_ID.get('daily-review').defaults
  assert.match(instruction, /只复盘自选股/, '复盘必须点明自选股是主体')
  assert.match(instruction, /近 20 日区间/, '要给出可核对的位置基准，不能只说"表现"')
  assert.match(instruction, /驱动/, '异动要写驱动因素，不能只列涨跌幅')
  assert.match(instruction, /风险信号/, '复盘的异常与风险要单独交代，不能只报涨跌')
  assert.match(instruction, /需优先复核/, '结果要分级，便于用户决定先看谁')
  assert.match(instruction, /不单独成节/, '指数与板块轮动只能当个股背景')
  assert.match(instruction, /触发价或触发事件/, '明日观察条件要可验证')
  assert.match(instruction, /不复述公告原文与盘面快照/, '复盘不能把公告和午间快照再抄一遍')
})

test('任务说明与任务指令同口径：说明里承诺的交付，指令必须兑现', () => {
  const mirrors = {
    'us-close': '盘后异动',
    'pre-open-filings': '开盘前必看',
    'morning-brief': '3 件事',
    'midday-snapshot': '上午收盘',
    'post-close-filings': '信息截止时刻',
    'hk-close': 'AH 溢价',
    'daily-review': '观察条件',
    'todo-verifier-close': '候选 TODO',
    'us-premarket': '今晚最该盯',
    'portfolio-weekly': '收益贡献',
    'watchlist-weekly': '可以移出',
    'sector-weekly': '行业 β',
    'research-topics': '研究选题',
    'earnings-tracker': '一致预期',
    'week-ahead-calendar': '事件日历',
    'market-weekly': '市场级读数',
    'portfolio-risk-monthly': '未评估',
  }
  for (const [id, term] of Object.entries(mirrors)) {
    const { description, instruction } = BUILTIN_BY_ID.get(id).defaults
    assert.ok(description.includes(term), `${id} 的模板说明没有写到「${term}」`)
    assert.ok(instruction.includes(term), `${id} 的指令没有兑现说明里的「${term}」`)
  }
})

test('模板之间不共用交付词：每个任务有只属于自己的输出锚点', () => {
  const anchors = {
    'us-close': '盘后异动',
    'pre-open-filings': '开盘前必看',
    'morning-brief': '今早最该知道',
    'midday-snapshot': '11:35',
    'post-close-filings': '信息截止时刻',
    'hk-close': 'AH 溢价',
    'daily-review': '近 20 日区间',
    'todo-verifier-close': 'insufficient',
    'us-premarket': '今晚最该盯',
    'portfolio-weekly': '收益贡献',
    'watchlist-weekly': '可以移出',
    'sector-weekly': '行业 β',
    'research-topics': '可证伪',
    'earnings-tracker': '一致预期',
    'week-ahead-calendar': '待确认',
    'market-weekly': '市场状态',
    'portfolio-risk-monthly': '未评估',
  }
  for (const [id, anchor] of Object.entries(anchors)) {
    assert.ok(BUILTIN_BY_ID.get(id).defaults.instruction.includes(anchor), `${id} 缺少自己的输出锚点「${anchor}」`)
    for (const definition of BUILTIN_DEFINITIONS) {
      if (definition.id === id) continue
      assert.equal(definition.defaults.instruction.includes(anchor), false,
        `${definition.id} 与 ${id} 共用「${anchor}」，两个任务会写出同一段内容`)
    }
  }
})

test('wire create schema 不接受 profile / owner / session / preset / cwd / state 这类服务端字段', () => {
  const base = {
    title: '测试任务',
    instruction: '做一件事',
    category: 'news',
    trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true },
  }
  const parsed = TaskCreateSchema.parse(base)
  assert.equal(parsed.title, '测试任务')
  assert.equal(TaskCreateSchema.parse({ ...base, workspaceId: 'ws_1' }).workspaceId, 'ws_1')
  assert.equal(TaskCreateSchema.parse({ ...base, workspaceId: '' }).workspaceId, '', '空值表示默认工作区')
  for (const forbidden of ['profileKey', 'profileName', 'ownerId', 'sessionId', 'agentPreset', 'presetId', 'cwd', 'state', 'origin', 'mode']) {
    assert.throws(() => TaskCreateSchema.parse({ ...base, [forbidden]: 'x' }), `\`${forbidden}\` 必须被 strict schema 拒绝`)
  }
})

test('任务图标：目录内可选、未知值被拒，内置覆盖层不接受图标', () => {
  assert.ok(TASK_ICON_IDS.length >= 16, '可选图标不能少于内置模板数')
  assert.ok(TASK_ICON_IDS.includes(DEFAULT_CUSTOM_ICON), '自定义任务默认图标必须在目录里')
  const trigger = { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true }
  const config = {
    category: 'research',
    icon: 'star',
    title: '测试任务',
    description: '',
    instruction: '做一件事',
    cwdKind: 'profile',
    trigger,
    limits: { runTimeoutMinutes: 30, idleTimeoutMinutes: 5, maxSteps: 300, maxToolCalls: 1200 },
    notifications: { inApp: true, onFailure: true, onSuccess: false },
  }
  assert.equal(TaskConfigSchema.parse(config).icon, 'star')
  assert.throws(() => TaskConfigSchema.parse({ ...config, icon: 'not-in-catalog' }), '未知图标必须被枚举拒绝')
  assert.throws(() => TaskOverridesSchema.parse({ icon: 'star' }), '内置模板的图标固定，overrides 不能写 icon')
  assert.equal(TaskCreateSchema.parse({ title: 't', instruction: 'i', category: 'news', trigger, icon: 'bell' }).icon, 'bell')
  assert.equal(TaskPatchSchema.parse({ icon: 'target' }).icon, 'target')
  assert.throws(() => TaskCreateSchema.parse({ title: 't', instruction: 'i', category: 'news', trigger, icon: 'bogus' }))
})

test('触发闭集：月内日期支持 1–31 与月末，单次必须有合法日期，跨频率字段互斥', () => {
  const base = { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true }
  const task = (trigger) => ({ title: 't', instruction: 'i', category: 'news', trigger })
  assert.throws(() => TaskCreateSchema.parse(task({ ...base, timezone: 'Mars/Olympus' })))
  assert.throws(() => TaskCreateSchema.parse(task({ ...base, cadence: 'weekly' })))
  assert.throws(() => TaskCreateSchema.parse(task({ ...base, cadence: 'monthly', dayOfMonth: 32 })))
  assert.throws(() => TaskCreateSchema.parse(task({ ...base, cadence: 'monthly', dayOfMonth: 0 })))
  assert.equal(TaskCreateSchema.parse(task({ ...base, cadence: 'monthly', dayOfMonth: 29 })).trigger.dayOfMonth, 29)
  assert.equal(TaskCreateSchema.parse(task({ ...base, cadence: 'monthly', dayOfMonth: 'last' })).trigger.dayOfMonth, 'last')
  assert.throws(() => TaskCreateSchema.parse(task({ ...base, cadence: 'once' })))
  assert.throws(() => TaskCreateSchema.parse(task({ ...base, cadence: 'once', date: '2027-02-30' })))
  assert.throws(() => TaskCreateSchema.parse(task({ ...base, cadence: 'once', date: '2027-06-30', dayOfMonth: 1 })))
  assert.equal(TaskCreateSchema.parse(task({ ...base, cadence: 'once', date: '2027-06-30' })).trigger.date, '2027-06-30')
  assert.throws(() => TaskCreateSchema.parse(task({ ...base, weekdays: [1] })))
  assert.throws(() => TaskCreateSchema.parse(task({ ...base, date: '2027-06-30' })))
})

test('旧 mode 字段只为读取兼容，解析后的任务不再暴露输出侧重', () => {
  const parsed = resolveTaskRecord({ ...record, overrides: { title: '我的早报', mode: 'market' } }, BUILTIN_BY_ID.get('morning-brief'))
  assert.equal(parsed.title, '我的早报')
  assert.equal('mode' in parsed, false)
  assert.equal(parsed.overrides.mode, undefined)
})

test('严格 JSON：undefined、NaN、空洞数组都不是可存储值', () => {
  assert.throws(() => assertCleanJson({ value: undefined }), /undefined/)
  assert.throws(() => assertCleanJson({ value: Number.NaN }), /non-finite/)
  const sparse = []
  sparse[1] = 1
  assert.throws(() => assertCleanJson(sparse), /sparse/)
  assert.throws(() => assertCleanJson({ when: new Date() }), /non-plain/)
})

test('任务记录拒绝未声明字段；解析顺序是内置定义 -> 用户覆盖 -> 运行时 state', () => {
  const parsed = resolveTaskRecord(record, BUILTIN_BY_ID.get('morning-brief'))
  assert.equal(parsed.title, '我的早报')
  assert.equal(parsed.state, 'active')
  assert.equal(parsed.trigger.time, '08:30')
  assert.equal(AutomationTaskSchema.safeParse(parsed).success, true)
  assert.throws(() => TaskRecordSchema.parse({ ...record, extra: true }), /Unrecognized key|unrecognized/i)
})

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')
function plainConfig(value) {
  if (value === null || typeof value !== 'object') return value
  if (VOLATILE_WRITE in value) return plainConfig(value.get())
  if (Array.isArray(value)) return value.map(plainConfig)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainConfig(child)]))
}

test('automation/defaults.js 与两处配置 schema 的默认值不漂移', () => {
  for (const schema of [HostConfig, MainConfig]) {
    assert.deepEqual(plainConfig(schema({})).automation, DEFAULT_AUTOMATION_SETTINGS, '默认值必须只在 defaults.js 有一份真值，两处 schema 跟着它')
  }
})

test('默认工作区设置只接受字符串 id：空值保留专属默认，非字符串回落而不是写进设置', () => {
  assert.equal(normalizeAutomationSettings({ defaultWorkspaceId: ' ws_project ' }).defaultWorkspaceId, 'ws_project')
  assert.equal(normalizeAutomationSettings({ defaultWorkspaceId: '' }).defaultWorkspaceId, '')
  assert.equal(normalizeAutomationSettings({ defaultWorkspaceId: 42 }).defaultWorkspaceId, '')
  assert.equal(normalizeAutomationSettings({}).defaultWorkspaceId, '')
})

test('预算默认值能容纳一个真实多 Agent 任务，同时保留硬上限', () => {
  assert.ok(DEFAULT_MAX_STEPS >= 300, '默认步骤不能低于普通多 Agent 任务的实际用量')
  assert.ok(DEFAULT_MAX_TOOL_CALLS >= 1_000, '默认工具调用必须覆盖子 Agent 与 PTC 派发')
  assert.ok(MAX_MAX_STEPS > DEFAULT_MAX_STEPS)
  assert.ok(MAX_MAX_TOOL_CALLS > DEFAULT_MAX_TOOL_CALLS)
})

test('错误文本脱敏：token、绝对路径、控制字符不进存储', () => {
  const output = sanitizeMessage('Bearer abcdefghijklmnop /home/shawn/secret/file \u0007 sk-1234567890abcdef')
  assert.doesNotMatch(output, /abcdefghijklmnop/)
  assert.doesNotMatch(output, /\/home\/shawn/)
  assert.doesNotMatch(output, /\u0007/)
  assert.match(output, /\[redacted\]|\[path\]/)
})

test('旧任务上限越界：写入仍被新边界拒绝，读回按新边界收敛而不是整表读崩', () => {
  const trigger = { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true }
  const legacy = {
    category: 'research',
    title: '旧任务',
    description: '',
    instruction: '做一件事',
    cwdKind: 'profile',
    trigger,
    limits: { runTimeoutMinutes: 30, idleTimeoutMinutes: 5, maxSteps: 50, maxToolCalls: 9_000 },
    notifications: { inApp: true, onFailure: true, onSuccess: false },
  }
  assert.throws(() => TaskConfigSchema.parse(legacy), '新建 / 修改仍按新边界拒绝')
  const stored = TaskRecordSchema.parse({
    schemaVersion: 1,
    id: 'task_old',
    origin: 'custom',
    profileKey: 'p_x',
    profileName: 'web',
    state: 'active',
    definitionVersion: 1,
    custom: legacy,
    scheduleAnchorAt: '2026-10-27T00:00:00.000Z',
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z',
  })
  assert.deepEqual(stored.custom.limits, {
    runTimeoutMinutes: 30,
    idleTimeoutMinutes: 5,
    maxSteps: 100,
    maxToolCalls: 5_000,
  }, '存储层的旧值收进新边界，任务表还能整张打开')
  assert.equal(resolveTaskRecord(stored).limits.maxSteps, 100)
})

test('任务上限是覆盖层：没单独设置就跟随通用设置，设置过才盖过它', () => {
  const defaults = { runTimeoutMinutes: 75, idleTimeoutMinutes: 7, maxSteps: 400, maxToolCalls: 1_500 }
  assert.deepEqual(
    resolveTaskRecord(record, BUILTIN_BY_ID.get('morning-brief'), defaults).limits,
    defaults,
    '内置任务没单独改过上限时，用通用设置的当前值',
  )
  const overridden = {
    ...record,
    overrides: {
      ...record.overrides,
      limits: { runTimeoutMinutes: 30, idleTimeoutMinutes: 5, maxSteps: 300, maxToolCalls: 1_200 },
    },
  }
  assert.equal(
    resolveTaskRecord(overridden, BUILTIN_BY_ID.get('morning-brief'), defaults).limits.runTimeoutMinutes,
    30,
    '任务单独改过的上限优先',
  )

  const trigger = { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true }
  const config = {
    category: 'research',
    title: '自定义任务',
    description: '',
    instruction: '做一件事',
    cwdKind: 'profile',
    trigger,
    notifications: { inApp: true, onFailure: true, onSuccess: false },
  }
  assert.equal(TaskConfigSchema.safeParse(config).success, true, '自定义任务的 limits 可以省略')
  const custom = {
    schemaVersion: 1,
    id: 'task_x',
    origin: 'custom',
    profileKey: 'p_x',
    profileName: 'web',
    state: 'active',
    definitionVersion: 1,
    custom: config,
    scheduleAnchorAt: '2026-10-27T00:00:00.000Z',
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z',
  }
  assert.deepEqual(resolveTaskRecord(custom, undefined, defaults).limits, defaults, '自定义任务没给上限也继承通用设置')
  const own = {
    ...custom,
    custom: { ...config, limits: { runTimeoutMinutes: 40, idleTimeoutMinutes: 5, maxSteps: 300, maxToolCalls: 1_200 } },
  }
  assert.equal(resolveTaskRecord(own, undefined, defaults).limits.runTimeoutMinutes, 40, '自定义任务自己的上限优先')
})


test('任务简报 schema：ready 必须有 headline/plain，failed 必须有 error，pending 不带正文', () => {
  const base = {
    schemaVersion: 1,
    profileKey: 'p_x',
    runId: 'run_x',
    taskId: 'task_x',
    status: 'pending',
    items: [],
    stocks: [],
    gaps: [],
    promptVersion: 1,
    attempts: 0,
    updatedAt: '2026-11-04T00:00:00.000Z',
  }
  assert.equal(TaskBriefSchema.parse(base).status, 'pending')
  assert.throws(() => TaskBriefSchema.parse({ ...base, headline: '有内容' }), 'pending 不能带正文')
  assert.throws(() => TaskBriefSchema.parse({ ...base, status: 'ready' }), 'ready 必须有 headline/plain')
  const ready = {
    ...base,
    status: 'ready',
    headline: '科技股又跌了，救兵还没到',
    plain: '昨晚美国科技股继续下跌，市场怕的是它们之前涨得太贵。国内出了稳市场的新办法，但真正买股票的钱还没进来。今天开盘先看科技股能不能止跌，不然大盘还会被它们拖着走。',
  }
  assert.equal(TaskBriefSchema.parse(ready).status, 'ready')
  assert.equal(TaskBriefSchema.parse({
    ...ready,
    items: Array.from({ length: 9 }, (_, index) => ({ kind: 'track', title: `事项 ${index + 1}`, sourceQuote: `原文 ${index + 1}` })),
  }).items.length, 9, 'items 不再限制 6 条')
  assert.equal(TaskBriefSchema.parse({
    ...ready,
    gaps: Array.from({ length: 9 }, (_, index) => ({ kind: 'capability', topic: `缺口 ${index + 1}`, detail: '数据源没有该字段。', sourceQuote: '数据源没有该字段' })),
  }).gaps.length, 9, 'gaps 不再限制 6 条')
  assert.throws(() => TaskBriefSchema.parse({ ...base, status: 'failed' }), 'failed 必须有 error')
  assert.throws(() => TaskBriefSchema.parse({ ...base, status: 'pending', items: [{ kind: 'verify', title: 'x', sourceQuote: 'y', dueAt: '2026-02-30' }] }), '非法日期必须被拒')
  assert.throws(() => TaskBriefSchema.parse({ ...base, unknown: true }), '未知字段必须被拒')
})

test('TODO 确认 schema：记录严格且只收 id，不写 brief', () => {
  const ack = {
    schemaVersion: 1,
    profileKey: 'p_x',
    todoId: 'verify|300803.SZ|收盘价站回 44.01',
    confirmedAt: '2026-11-07T00:00:00.000Z',
  }
  assert.equal(TodoAckSchema.parse(ack).todoId, ack.todoId)
  assert.equal(TodoAckSchema.parse({ ...ack, decision: 'deferred' }).decision, 'deferred')
  assert.throws(() => TodoAckSchema.parse({ ...ack, decision: 'auto' }), '用户决定只能是确认或忽略')
  assert.throws(() => TodoAckSchema.parse({ ...ack, unknown: true }), '未知字段必须被拒')
  assert.throws(() => TodoAckSchema.parse({ ...ack, confirmedAt: '2026-11-07T00:00:00Z' }), '确认时间必须是规范 UTC')
  assert.throws(() => TodoAckSchema.parse({ ...ack, todoId: 'x'.repeat(201) }), 'TODO id 超长必须被拒')
  assert.equal(TodoConfirmSchema.parse({ id: ack.todoId }).id, ack.todoId)
  assert.throws(() => TodoConfirmSchema.parse({}), '缺少 id 必须被拒')
  assert.throws(() => TodoConfirmSchema.parse({ id: 'x', extra: true }), '未知字段必须被拒')
  assert.equal(TodoDecisionSchema.parse({ id: ack.todoId, action: 'auto' }).action, 'auto')
  assert.throws(() => TodoDecisionSchema.parse({ id: ack.todoId, action: 'unknown' }), '未知决定必须被拒')
  assert.throws(() => TodoDecisionSchema.parse({ id: ack.todoId, action: 'auto', extra: true }), '未知字段必须被拒')
})

test('TODO 跟踪 schema：状态、触发证据与人工交接必填，未知字段被拒', () => {
  const base = {
    schemaVersion: 1,
    id: 'tw_x',
    profileKey: 'p_x',
    todoId: 'verify|300803.SZ|收盘价站回 44.01',
    kind: 'verify',
    status: 'watching',
    title: '指南针收盘能否站回 44.01',
    dueAt: '2026-11-07',
    firstSeenAt: '2026-11-04T00:00:00.000Z',
    lastSeenAt: '2026-11-04T00:00:00.000Z',
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
  }
  assert.equal(TodoWatchSchema.parse(base).status, 'watching')
  assert.equal(TodoWatchSchema.parse({ ...base, autoRequestedAt: '2026-11-04T02:00:00.000Z' }).autoRequestedAt, '2026-11-04T02:00:00.000Z')
  assert.throws(() => TodoWatchSchema.parse({ ...base, autoRequestedAt: '2026-11-04T02:00:00Z' }), '自动核验请求时间必须是规范 UTC')
  assert.throws(() => TodoWatchSchema.parse({ ...base, status: 'triggered' }), '触发态必须有证据')
  assert.equal(TodoWatchSchema.parse({
    ...base,
    status: 'triggered',
    checkedAt: '2026-11-04T08:00:00.000Z',
    verdict: 'triggered',
    evidence: '收盘 44.55 元，站回 44.01。',
    source: 'eastmoney_quote · 2026-11-04 15:00',
  }).source, 'eastmoney_quote · 2026-11-04 15:00')
  assert.throws(() => TodoWatchSchema.parse({
    ...base,
    status: 'needs_human',
  }), '人工交接必须有原因')
  assert.equal(TodoWatchSchema.parse({
    ...base,
    status: 'needs_human',
    handoffReason: '只有你知道仓位。',
  }).status, 'needs_human')
  assert.equal(TodoWatchSchema.parse({
    ...base,
    status: 'resolved',
    resolvedFrom: 'needs_human',
  }).resolvedFrom, 'needs_human')
  assert.equal(TodoWatchSchema.parse({
    ...base,
    status: 'expired',
    expiredReason: 'no_data',
  }).expiredReason, 'no_data')
  assert.throws(() => TodoWatchSchema.parse({ ...base, status: 'expired', expiredReason: 'unknown' }), '过期原因必须是闭集')
  assert.throws(() => TodoWatchSchema.parse({ ...base, status: 'watching', expiredReason: 'no_data' }), '过期原因只能出现在 expired 状态')
  assert.throws(() => TodoWatchSchema.parse({ ...base, status: 'resolved', resolvedFrom: 'resolved' }), 'resolvedFrom 不接受自身')
  assert.throws(() => TodoWatchSchema.parse({ ...base, kind: 'track' }), '跟踪类不进入自动核验')
  assert.throws(() => TodoWatchSchema.parse({ ...base, dueAt: '2026-02-30' }), '非法日期必须被拒')
  assert.throws(() => TodoWatchSchema.parse({ ...base, unknown: true }), '未知字段必须被拒')

  const notification = {
    schemaVersion: 1,
    id: 'ntf_x',
    profileKey: 'p_x',
    kind: 'todo_triggered',
    title: '已触发：指南针收盘能否站回 44.01',
    message: '收盘 44.55 元，站回 44.01。',
    todoId: base.todoId,
    createdAt: '2026-11-04T08:00:00.000Z',
  }
  assert.equal(NotificationSchema.parse(notification).todoId, base.todoId)
  assert.throws(() => NotificationSchema.parse({ ...notification, kind: 'todo_unknown' }), '通知 kind 是闭集')
})

test('看板追问 schema：running / ready / failed 三态的必填与禁填字段', () => {
  const base = {
    schemaVersion: 1,
    id: 'ask_x',
    profileKey: 'p_x',
    runId: 'run_x',
    sessionId: 'session_x',
    question: '成交量怎么看？',
    baselineSeq: 10,
    status: 'running',
    createdAt: '2026-11-09T00:00:00.000Z',
    updatedAt: '2026-11-09T00:00:00.000Z',
  }
  assert.equal(AskRecordSchema.parse(base).status, 'running')
  assert.throws(() => AskRecordSchema.parse({ ...base, preview: '抢先' }), 'running 不能带 preview')
  assert.throws(() => AskRecordSchema.parse({ ...base, status: 'ready' }), 'ready 必须有 preview/finishedAt')
  assert.equal(AskRecordSchema.parse({
    ...base,
    status: 'ready',
    preview: '先看成交量。',
    finishedAt: '2026-11-09T00:01:00.000Z',
  }).preview, '先看成交量。')
  assert.equal(AskRecordSchema.parse({
    ...base,
    status: 'ready',
    preview: '字'.repeat(160),
    finishedAt: '2026-11-09T00:01:00.000Z',
  }).preview.length, 160)
  assert.throws(() => AskRecordSchema.parse({
    ...base,
    status: 'ready',
    preview: '字'.repeat(161),
    finishedAt: '2026-11-09T00:01:00.000Z',
  }), '160 字上限必须保留')
  assert.throws(() => AskRecordSchema.parse({ ...base, status: 'failed' }), 'failed 必须有 error/finishedAt')
  assert.equal(AskRecordSchema.parse({
    ...base,
    status: 'failed',
    error: '回答被中止。',
    finishedAt: '2026-11-09T00:01:00.000Z',
  }).status, 'failed')
  assert.throws(() => AskRecordSchema.parse({ ...base, unknown: true }), '未知字段必须被拒')
  assert.equal(AskCreateSchema.parse({ question: '  成交量怎么看？  ' }).question, '成交量怎么看？')
  assert.throws(() => AskCreateSchema.parse({ question: 'x', extra: true }), '未知字段必须被拒')
  assert.throws(() => AskCreateSchema.parse({ question: 'x'.repeat(501) }), '问题超长必须被拒')
})
