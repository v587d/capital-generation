import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AutomationTaskSchema,
  TaskCategorySchema,
  TaskConfigSchema,
  TaskCreateSchema,
  TaskOverridesSchema,
  TaskPatchSchema,
  TaskRecordSchema,
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

// Coverage and deliverable belong in the template; category shape, data discipline and the
// unattended policy belong to the runner. Too short drifts into "生成一份复盘", too long starts
// duplicating the prompt the runner already builds.
const MIN_INSTRUCTION_CHARS = 120
const MAX_INSTRUCTION_CHARS = 260

test('十六个内置模板全部 dormant，指令只写覆盖范围与交付', () => {
  assert.equal(BUILTIN_DEFINITIONS.length, 16)
  assert.deepEqual(BUILTIN_DEFINITIONS.map((item) => item.id), [
    'us-close',
    'pre-open-filings',
    'morning-brief',
    'midday-snapshot',
    'post-close-filings',
    'hk-close',
    'daily-review',
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
    assert.equal(definition.defaults.state, 'dormant')
    assert.equal(definition.defaults.trigger.kind, 'schedule')
    assert.equal(definition.defaults.trigger.timezone, 'Asia/Shanghai')
    assert.equal(typeof definition.defaults.trigger.tradingDaysOnly, 'boolean', `${definition.id} 必须显式声明是否只看交易日`)
    assert.equal(definition.defaults.cwdKind, 'profile')
    assert.equal('mode' in definition.defaults, false, '输出侧重已并入任务分类，内置定义不能保留 mode')
    assert.ok(length >= MIN_INSTRUCTION_CHARS, `${definition.id} 的指令只有 ${length} 字：覆盖范围与交付要写清，不能只留主题句`)
    assert.ok(length <= MAX_INSTRUCTION_CHARS, `${definition.id} 的指令 ${length} 字过长：数据纪律与运行策略由 runner 提供，不要复制`)
    assert.doesNotMatch(instruction, /数据与来源纪律/, `${definition.id} 不应再复制自动模式的数据纪律`)
    assert.doesNotMatch(instruction, /无人值守执行策略/, `${definition.id} 不应再复制运行策略`)
    assert.doesNotMatch(instruction, /get_watchlist|anysearch|web_retriever|data_collector|data_junior/, `${definition.id} 不应点名工具或角色：工具面由运行模式决定`)
    assert.match(description, /自选股/, `${definition.id} 的模板说明要点名自选股`)
    assert.ok(Array.from(description).length <= 100, `${definition.id} 的模板说明超过 100 字，页面会截断`)
  }
})

test('任务分类闭集：组合与监控走后端同一份枚举', () => {
  assert.deepEqual([...TaskCategorySchema.options], ['news', 'market', 'review', 'research', 'portfolio', 'monitor'])
})

test('新增模板的日程与职责固定：港美股、组合、监控、研究与盘中各有明确窗口', () => {
  const cases = [
    { id: 'us-close', title: '美股收盘', category: 'market', cadence: 'weekly', time: '07:00', weekdays: [2, 3, 4, 5, 6], tradingDaysOnly: false, matches: [/三大指数/, /盘后异动/, /休市/] },
    { id: 'midday-snapshot', title: '午间快照', category: 'market', cadence: 'daily', time: '11:35', tradingDaysOnly: true, matches: [/11:35/, /涨跌停/, /采集时间/] },
    { id: 'hk-close', title: '港股收盘', category: 'market', cadence: 'daily', time: '16:30', tradingDaysOnly: true, matches: [/恒生/, /AH 溢价/, /休市/] },
    { id: 'us-premarket', title: '美股盘前', category: 'market', cadence: 'weekly', time: '20:30', weekdays: [1, 2, 3, 4, 5], tradingDaysOnly: false, matches: [/盘前/, /未取到/, /休市/] },
    { id: 'portfolio-weekly', title: '组合周报', category: 'portfolio', cadence: 'weekly', time: '10:00', weekdays: [6], tradingDaysOnly: false, matches: [/标记的持仓/, /集中度/, /不补满 100%/] },
    { id: 'watchlist-weekly', title: '自选股周检', category: 'monitor', cadence: 'weekly', time: '14:00', weekdays: [6], tradingDaysOnly: false, matches: [/可以移出/, /催化剂/, /合并成一组/] },
    { id: 'sector-weekly', title: '行业周报', category: 'market', cadence: 'weekly', time: '20:00', weekdays: [6], tradingDaysOnly: false, matches: [/行业周报/, /资金集中度/, /景气/] },
    { id: 'research-topics', title: '研究选题', category: 'research', cadence: 'weekly', time: '14:00', weekdays: [7], tradingDaysOnly: false, matches: [/3 个/, /核心问题/, /核查/] },
    { id: 'earnings-tracker', title: '财报跟踪', category: 'research', cadence: 'weekly', time: '16:00', weekdays: [7], tradingDaysOnly: false, matches: [/一致预期/, /财报预约/, /不要硬凑/] },
    { id: 'week-ahead-calendar', title: '下周事件日历', category: 'monitor', cadence: 'weekly', time: '18:00', weekdays: [7], tradingDaysOnly: false, matches: [/财报预约/, /解禁/, /待确认/] },
    { id: 'market-weekly', title: '市场周报', category: 'market', cadence: 'weekly', time: '20:00', weekdays: [7], tradingDaysOnly: false, matches: [/板块轮动/, /市场状态/, /缺口/] },
    { id: 'portfolio-risk-monthly', title: '组合风险月报', category: 'portfolio', cadence: 'monthly', time: '20:30', dayOfMonth: 'last', tradingDaysOnly: false, matches: [/集中度/, /未评估/, /不填 0/] },
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

test('盘前公告在 08:00 补晚间披露，按开盘前优先级排', () => {
  const { instruction, trigger, title } = BUILTIN_BY_ID.get('pre-open-filings').defaults
  assert.equal(title, '盘前公告')
  assert.equal(trigger.time, '08:00', '盘前公告要在开盘前留出阅读时间')
  for (const kind of ['业绩预告', '重组并购', '重大合同', '增减持', '回购', '股权激励', '停复牌', '分红']) {
    assert.match(instruction, new RegExp(kind), `盘前公告缺少「${kind}」这一类`)
  }
  assert.match(instruction, /上一交易日收盘后至运行时刻/, '盘前公告要覆盖 16:00 到开盘前的窗口')
  assert.match(instruction, /A 股、港股、美股/, '盘前公告必须覆盖全部自选股市场，不能只做 A 股')
  assert.match(instruction, /不得只做 A 股/, '盘前公告要明确禁止只做 A 股')
  assert.match(instruction, /每只股票都要有结论/, '自选股逐只要给结论，不能把港股/美股标成不适用')
  assert.match(instruction, /开盘前必看/, '晚间披露要按开盘前优先级分级')
  assert.match(instruction, /只写公告/, '盘前公告不复述隔夜外盘与大盘行情')
  assert.match(instruction, /未取到/, '取不到公告要明说，不能写成没有公告')
})

test('早间资讯按档覆盖盘前事实，缺档不许静默跳过', () => {
  const { instruction } = BUILTIN_BY_ID.get('morning-brief').defaults
  assert.match(instruction, /3 件事/, '开头要给出最该知道的几件事，避免读完才知道重点')
  for (const bucket of ['隔夜外盘', '大宗商品', '汇率', '宏观', '自选股', '披露', '解禁', '股东大会']) {
    assert.match(instruction, new RegExp(bucket), `早间资讯缺少「${bucket}」这一档`)
  }
  assert.match(instruction, /未取到/, '取不到的档必须明说，不能省略成"没有"')
  assert.match(instruction, /写「无」/, '确实没有要写「无」，让用户知道这一档查过')
  assert.match(instruction, /逐只过/, '自选股要逐只核对，不能只报有消息的')
})

test('当日公告仍定在 16:00，产出次日复核清单并交代披露截止', () => {
  const { instruction, trigger, title } = BUILTIN_BY_ID.get('post-close-filings').defaults
  assert.equal(title, '当日公告', '「盘后」会让人以为当晚公告已出齐，改叫当日公告')
  assert.equal(trigger.time, '16:00', '当日公告仍在收盘后 16:00 运行')
  for (const kind of ['业绩预告', '重组并购', '重大合同', '增减持', '回购', '股权激励', '停复牌', '分红']) {
    assert.match(instruction, new RegExp(kind), `当日公告缺少「${kind}」这一类`)
  }
  assert.match(instruction, /次日必须处理/, '公告要按次日复核优先级分级')
  assert.match(instruction, /信息截止时刻/, '16:00 披露窗口未完，必须写明信息截止时刻')
  assert.match(instruction, /暂未披露/, '截止后待披露的部分要单列，不能当成没有公告')
})

test('每日复盘以自选股为主体，只把指数与板块当背景', () => {
  const { instruction } = BUILTIN_BY_ID.get('daily-review').defaults
  assert.match(instruction, /主体是自选股/, '复盘必须点明自选股是主体')
  assert.match(instruction, /近 20 日区间/, '要给出可核对的位置基准，不能只说"表现"')
  assert.match(instruction, /驱动/, '异动要写驱动因素，不能只列涨跌幅')
  assert.match(instruction, /风险信号/, '复盘的异常与风险要单独交代，不能只报涨跌')
  assert.match(instruction, /需优先复核/, '结果要分级，便于用户决定先看谁')
  assert.match(instruction, /不单独成节/, '指数与板块轮动只能当个股背景')
  assert.match(instruction, /触发点/, '明日观察条件要可验证')
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
