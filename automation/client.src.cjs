/**
 * Browser half of `@v587d/capital-automation`: the `capital-automation` main key plus the
 * adjacent sidebar row. The page owns no schedule identity and reads only the profile the
 * server put it in; `/capital-automation` is the only data source.
 */
const { createElement: h, useEffect, useRef, useState } = require('react')
const {
  IconAlarmClockOutlineRegular,
  IconChecklistOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconCloseOutlineRegular,
  IconClockOutlineRegular,
  IconCopyOutlineRegular,
  IconEditOutlineRegular,
  IconEllipsisOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconInfoOutlineRegular,
  IconNewChatOutlineRegular,
  IconPauseOutlineRegular,
  IconPlayOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconRightUpOutlineRegular,
  IconSearchOutlineRegular,
  IconSparkleRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  Menu,
  MenuItemButton,
  Modal,
  Switch,
} = require('@deepseek-ai/dsh-client-ui-primitives')
const {
  TASK_ICON_CATALOG,
  TASK_ICON_IDS,
  DEFAULT_CUSTOM_ICON,
  taskIconId,
} = require('./task-icons.js')

const ENTRY_NAME = 'capital-automation'
const ROUTE = '/capital-automation'
const PANEL_ID = 'capital-automation'
const STYLE_TAG = 'capital-automation-css'
const ACTIVE_RUN_STATUSES = ['queued', 'starting', 'running']
const FAILURE_RUN_STATUSES = ['failed', 'timed_out', 'blocked_requires_user', 'unknown_after_restart']
const SKIPPED_RUN_STATUSES = ['skipped_overlap', 'skipped_calendar_unavailable', 'missed']
const DEFAULT_LIMITS = { runTimeoutMinutes: 60, idleTimeoutMinutes: 5, maxSteps: 300, maxToolCalls: 1200 }
const WEEKDAYS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' },
]
const TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'Australia/Sydney',
]
const HISTORY_DAYS = 371
const HEATMAP_WEEKS = 53
const WEEKDAY_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const DETAIL_RECENT_RUN_LIMIT = 3
const TITLE_MAX_LENGTH = 12
const DESCRIPTION_MAX_LENGTH = 100
const INSTRUCTION_MAX_LENGTH = 12_000
const AUTOSAVE_DELAY_MS = 600
const BOARD_UI_KEY = 'capital-automation:board-ui:v3'
const BOARD_PANEL_KEYS = ['todo', 'stocks', 'gaps', 'health']
const BOARD_TODO_PERIODS = ['today', 'future', 'expired']
const BOARD_PANEL_IDS = {
  'capital-automation-todo': 'todo',
  'capital-automation-stocks': 'stocks',
  'capital-automation-gaps': 'gaps',
  'capital-automation-health': 'health',
}

const zh = {
  panel: 'CapGen 投研自动化',
  title: 'CapGen 投研自动化',
  subtitle: '定时投研，自动执行，结果可追溯',
  tabs: { board: '看板', tasks: '任务', runs: '运行' },
  board: {
    emptyTitle: '还没有任务简报',
    emptyHint: '在任务页点任务右侧的「运行」，跑完回来看板。',
    goTasks: '去任务页运行',
    goEnable: '去启用任务',
    newTask: '新建任务',
    statsBriefs: '本期简报',
    statsTodos: '今日 TODO',
    statsStocks: '标的',
    statsGaps: '缺口',
    statsIssues: '近 7 天异常',
    refresh: '刷新',
    range: '时间范围',
    range7: '最近 7 天',
    range14: '最近 14 天',
    range30: '最近 30 天',
    rangeAll: '全部',
    category: '分类',
    allCategories: '全部',
    briefTitle: '任务简报',
    todoTitle: 'TODO',
    hideRail: '收起右侧',
    showRail: '展开右侧',
    collapse: '收起',
    expand: '展开',
    briefPending: '正在生成任务简报…',
    briefFailed: '任务简报生成失败',
    briefSkipped: '这次运行没有可简报的结论',
    retry: '重试',
    retryQueued: '已重新提交任务简报',
    askLabel: '就这条简报提问',
    askPlaceholder: '快速提问…',
    askDialogTitle: '对话',
    askEmptyTitle: '暂无提问',
    askSubmit: '提问',
    askCollapse: '收起',
    askPending: '正在回答…',
    askFailed: '回答失败',
    askMore: '查看更多',
    stocksCount: '{n} 个标的',
    gapsCount: '{n} 个缺口',
    todoConfirm: '待确认',
    todoVerify: '待验证',
    todoTrack: '跟踪',
    todoAck: '确认',
    todoAckTitle: '确认并移除这条 TODO',
    todoAcked: '已确认，已从 TODO 移除',
    todoEmptyToday: '今天暂无待办',
    todoEmptyGroup: '暂无「{label}」待办',
    todoFilterLabel: '按日期筛选',
    dueToday: '今天',
    dueAsap: '尽快',
    dueNoDate: '未定',
    dueFuture: '将来',
    dueExpired: '已过期',
    showBasis: '查看依据',
    hideBasis: '收起依据',
    seenCount: '{n} 次运行提到',
    sourceRun: '来源',
    stockEmpty: '最近运行没有提到自选股',
    stockOther: '其他事件 {n} 只',
    stockTodoCount: '{n} 项待办',
    roleHolding: '持仓',
    roleWatch: '关注',
    roleEvent: '事件',
    roleRisk: '风险',
    gapEmpty: '最近运行没有报告数据缺口',
    gapCapability: '能力缺口',
    gapTransient: '本次未取到',
    gapConflict: '口径冲突',
    gapQuality: '数据质量',
    gapSeen: '{n} 次运行',
    gapAll: '查看全部',
    healthTitle: '运行健康',
    healthWindow: '最近 7 天',
    healthRuns: '运行',
    healthBriefs: '简报状态',
    healthScheduler: '调度器',
    healthSchedulerOk: '正常',
    healthSchedulerStandby: '本窗口待命',
    healthSchedulerBad: '不可用',
    healthCalendar: '交易日历',
    healthIssues: '异常',
    healthNoIssues: '最近 7 天没有异常运行',
    healthViewRuns: '查看运行',
    healthSucceeded: '成功',
    healthFailed: '失败',
    healthTimeout: '超时',
    healthMissed: '错过',
    healthUnknown: '中断/未知',
    healthBlocked: '需确认',
    healthActive: '进行中',
    healthBriefReady: '完成',
    healthBriefPending: '生成中',
    healthBriefFailed: '失败',
    healthBriefSkipped: '跳过',
    healthNoBrief: '没有已入队简报',
    healthRecovered: '已补跑',
    healthOpen: '打开 session',
    healthCalendarOk: '正常',
    healthCalendarBad: '不可用',
    loadError: '看板暂时不可用',
    rangeEmpty: '最近 14 天没有任务简报',
    viewAll: '查看全部时间',
    loadMore: '加载更早的简报',
    clearFilter: '清除筛选',
    categoryEmpty: '没有符合筛选的任务简报',
  },
  storageUnavailable: '存储不可用，页面只读',
  standbyBanner: '本窗口的定时任务已暂停：定时触发与手动运行不可用；若另一个 CapGen 窗口在运行，定时任务仍会由它执行。',
  storageBanner: '投研自动化存储暂时不可用：页面只读，调度器不会启动。',
  calendarBanner: '交易日历暂时不可用：仅交易日的任务会跳过，其他任务仍按设定时间运行。',
  calendarCoverageBanner: '交易日历只覆盖到 {through}：之后仅交易日的任务会跳过；交易所公布新一年安排后会自动接上。',
  calendarField: '交易日历',
  calendarSourceSzse: '深交所官方日历',
  calendarSourceBundled: '内置表',
  calendarSourceNone: '不可用',
  calendarThrough: '覆盖至 {date}',
  calendarUnknown: '未知',
  loadRetry: '重新读取',
  loading: '读取中…',
  empty: '还没有任务。',
  emptyTasksTitle: '还没有添加的任务',
  emptyTasksBody: '从下方添加一个内置模板，或新建一个自己的投研任务。',
  emptyNoTemplates: '还没有任务',
  emptyNoTemplatesBody: '点击右上角「新建任务」，创建第一个定时投研任务。',
  emptyFiltered: '没有匹配的任务。',
  clearFilter: '清除筛选',
  newTask: '新建任务',
  newTaskTitle: '新建投研任务',
  editTask: '编辑任务',
  allTasks: '全部任务',
  backToTasks: '所有任务',
  taskSection: '任务',
  taskSectionHint: '点击任务行查看详情、运行记录和配置。',
  templateSection: '模板',
  templateAdd: '添加',
  templateAdding: '添加中…',
  templateMeta: '内置模板',
  runningSection: '正在运行',
  runningSince: '开始于',
  cancelRun: '取消运行',
  searchPlaceholder: '搜索任务',
  filterAll: '全部',
  filterCustom: '我的任务',
  filterNews: '资讯',
  filterMarket: '行情',
  filterReview: '复盘',
  filterResearch: '研究',
  filterLabel: '筛选任务',
  category: { news: '资讯', market: '行情', review: '复盘', research: '研究', portfolio: '组合', monitor: '监控' },
  categoryField: '任务分类',
  categoryFixed: `'复制为我的任务'后，可调整任务分类。`,
  cadence: { daily: '每天', weekly: '每周', monthly: '每月', once: '单次' },
  stateLabel: '状态',
  state: { dormant: '未添加', active: '已启用', paused: '已暂停' },
  origin: { builtin: '内置模板', custom: '我的任务' },
  status: {
    queued: '排队中', starting: '启动中', running: '运行中', succeeded: '成功', failed: '失败',
    canceled: '已取消', timed_out: '超时', blocked_requires_user: '需要用户确认',
    unknown_after_restart: '重启后未知', skipped_overlap: '重叠跳过',
    skipped_calendar_unavailable: '日历不可用跳过', missed: '错过',
  },
  runNow: '立即运行',
  runStarted: '已提交运行',
  pause: '暂停',
  activate: '启用',
  add: '添加',
  hibernate: '休眠并恢复默认',
  copy: '复制为我的任务',
  remove: '删除任务',
  edit: '编辑',
  more: '更多操作',
  saving: '保存中…',
  processing: '处理中…',
  cancel: '取消',
  create: '创建任务',
  creating: '创建中…',
  titleRequired: '标题不能为空。',
  instructionRequired: '任务指令不能为空。',
  invalidLimit: '请输入有效数字。',
  invalidLimitRange: '请输入 {min}–{max} 的整数。',
  autosaveHint: '修改会自动保存',
  autosavePending: '等待保存…',
  autosaveSaved: '已自动保存',
  autosaveFailed: '保存失败',
  autosaveRetry: '重试',
  autosaveInvalid: '填写完整后自动保存',
  noDirty: '配置已同步',
  nextRun: '下次运行',
  nextRunDormant: '添加后开始调度',
  nextRunPaused: '启用后恢复调度',
  notScheduled: '当前不会自动运行',
  lastResult: '上次结果',
  lastRunEmpty: '运行后可在这里查看结果',
  never: '暂无',
  calendarUnavailable: '日历不可用',
  unread: '未读',
  overview: '概览',
  config: '配置',
  runs: '运行记录',
  notifications: '通知',
  descriptionField: '任务说明',
  titleField: '任务标题',
  iconField: '任务图标',
  iconPickHint: '点击图标更换',
  iconBuiltinHint: '内置模板的图标固定；复制为我的任务后可更换。',
  instructionField: '任务指令',
  instructionPlaceholder: '例如：读取今日自选股行情、公告与相关新闻，按「结论—证据—风险」整理成一份可复核的盘后复盘。',
  titlePlaceholder: '给这个任务起个名字',
  charCount: '{n}/{max}',
  descriptionPlaceholder: '一句话说明任务目标（可选）',
  triggerField: '触发器',
  cadenceField: '频率',
  triggerHint: '按设定时区的本地墙钟时间计算；仅交易日任务由交易日历判断周末与节假日。',
  triggerHintNatural: '按设定时区的本地墙钟时间计算：每天都触发，周末与节假日也运行。',
  triggerHintOnce: '单次任务只在指定日期运行一次；该日期不是交易日时，仅交易日设置会跳过本次运行。',
  timeField: '时间',
  timezoneField: '时区',
  weekdayField: '星期',
  dayField: '日期',
  monthlyField: '每月日期',
  monthlyFirst: '1 号',
  monthlyMid: '月中',
  monthlyLast: '月末',
  monthlyCustom: '自定义',
  customDayLabel: '第 {n} 日',
  dailyNatural: '每个自然日运行',
  dailyTrading: '每个交易日运行',
  onceHint: '只在这天运行一次',
  onceEnded: '单次任务已结束',
  onceEndedHint: '指定日期已过；修改日期或改成重复计划后可再次运行。',
  onceSkipped: '单次任务不会运行',
  onceSkippedHint: '指定日期不是交易日；关闭仅交易日或改选日期后再启用。',
  weekdayWorkdayQuick: '工作日',
  weekdayWeekendQuick: '周末',
  weekdayNone: '未选择',
  weekdayEvery: '每天',
  tradingDaysField: '仅交易日',
  weekdayRequired: '每周至少选择一天。',
  dateRequired: '请选择运行日期。',
  invalidDate: '请选择有效的日期。',
  invalidTime: '运行时间格式不正确，请选择 HH:mm。',
  invalidTimezone: '时区不能为空，请填写 IANA 时区。',
  invalidTimezoneValue: '时区不被识别，请填写有效的 IANA 时区。',
  filterNoRuns: '没有符合筛选条件的运行记录。',
  schedulePrefix: '下次',
  workspaceField: '工作区',
  workspaceDefault: '跟随默认工作区',
  workspaceMissing: '已移除的工作区（请重新选择）',
  workspaceUnavailable: '工作区服务暂时不可用，运行会退回默认目录。',
  limitsField: '运行上限',
  advanced: '高级设置',
  advancedHint: '预算覆盖整棵运行子树：子 Agent 与 PTC 派发都计入。',
  runTimeout: '最长运行（分钟）',
  idleTimeout: '空闲超时（分钟）',
  maxSteps: '最大步骤',
  maxToolCalls: '最大工具调用',
  notifyField: '通知',
  notifyInApp: '写入任务通知',
  notifyFailure: '失败、超时或需人工处理时',
  notifySuccess: '成功时通知',
  notifyHint: '只写入当前 profile 的任务通知中心；不会发送邮件或外部消息。',
  presetLabel: '运行模式',
  presetValue: '自动模式',
  presetHint: '所有运行固定使用自动模式。',
  budgetHint: '工具调用与步骤预算覆盖整棵运行子树：子 Agent 与 PTC 派发都计入。',
  environment: '执行环境',
  policyField: '无人值守策略',
  cwdKind: '工作区来源',
  techInfo: '技术信息',
  profileKey: 'profileKey',
  runHistory: '运行历史',
  last12Months: '最近 12 个月',
  runCount: '{n} 次运行',
  successCount: '{n} 成功',
  failureCount: '{n} 失败',
  activeCount: '{n} 进行中',
  historyEmpty: '最近 12 个月还没有运行记录。',
  heatLess: '少',
  heatMore: '多',
  heatFailed: '有失败',
  heatActive: '进行中',
  heatNoRuns: '没有运行',
  heatFuture: '尚未到来',
  heatSummary: '最近 12 个月共 {total} 次运行：{success} 成功，{failure} 失败。',
  historyViewAll: '查看全部运行',
  runFilterAll: '全部',
  runFilterActive: '进行中',
  runFilterSucceeded: '成功',
  runFilterFailed: '失败',
  runFilterLabel: '筛选运行记录',
  runsTitle: '运行',
  runsHint: '每次运行都使用新的 session；终态后才能打开 session。',
  runsEmptyTitle: '尚未运行',
  runsEmptyBody: '任务运行后，这里会显示状态、耗时与错误条数；结果与过程在 session 里。',
  runsEmptyAction: '去添加模板',
  runsLimitHint: '仅显示最近 {n} 条运行记录。',
  cancelRunConfirmTitle: '取消这次运行？',
  cancelRunConfirmBody: '取消会向当前运行发送停止信号；已经产生的中间结果会留在 session 里。',
  cancelRunConfirm: '确认取消',
  duration: '耗时',
  steps: '步骤',
  tools: '工具调用',
  errorTitle: '错误',
  errorDetailsLabel: '错误详情',
  showErrorDetails: '查看错误详情',
  hideErrorDetails: '收起错误详情',
  triggerManual: '手动',
  triggerScheduled: '定时',
  openSession: '打开 session',
  runSummaryFallback: '运行结束但没有摘要。',
  notificationsEmpty: '没有任务通知。',
  markRead: '全部标为已读',
  markTaskRead: '本任务标为已读',
  notificationsTitle: '任务通知',
  notificationsEntry: '任务通知',
  notificationsHint: '运行失败、超时、成功与交易日历问题会出现在这里。',
  notificationsUnread: '{n} 条未读',
  allRead: '全部已读',
  noNotifications: '没有未读或历史任务通知。',
  notificationOpenTask: '查看任务',
  systemStatus: '系统状态',
  systemActive: '定时调度正常',
  systemStandby: '本窗口待命，不启动新的定时运行',
  systemStarting: '定时调度启动中',
  systemStopped: '定时调度未运行',
  systemUnavailable: '定时调度不可用',
  systemCalendarOk: '交易日历正常',
  systemCalendarUnavailable: '交易日历不可用',
  systemDetails: '详情',
  systemHideDetails: '收起',
  systemLastStandby: '上次中断',
  systemNoStandby: '没有调度中断记录。',
  systemReasonLeaseHeld: '另一个 CapGen 窗口正在负责定时任务。',
  systemReasonLeaseLost: '本窗口的调度权已失效，可能已由另一个窗口接管。',
  systemReasonUnverified: '本窗口的调度权校验未通过。',
  systemTechnical: '技术信息',
  close: '关闭',
  confirmDeleteTitle: '删除这个任务？',
  confirmDeleteBody: '任务配置、运行记录与相关通知会一起删除，无法恢复。',
  confirmHibernateTitle: '休眠并恢复默认？',
  confirmHibernateBody: '当前对内置模板的修改会被清空，任务回到模板区；历史运行记录保留。',
  confirmDelete: '确认删除',
  confirmHibernate: '确认休眠',
  actionDone: '操作完成',
  created: '任务已创建',
  activated: '已启用「{title}」',
  added: '已添加「{title}」',
  paused: '已暂停「{title}」',
  copied: '已复制为「{title}」',
  deleted: '已删除「{title}」',
  hibernated: '已休眠「{title}」',
  runSubmitted: '已提交「{title}」运行',
  runCanceled: '已取消运行',
  markReadDone: '已标为已读',
  errorGeneric: '操作失败，请稍后重试。',
  needConfirm: '需要用户确认',
  schedulerBlocked: '本窗口的定时任务已暂停，暂时不能手动运行。',
  runBlocked: '任务正在运行，结束或取消后才能再次运行。',
  configWhileRunning: '任务正在运行；修改会在下一次运行时生效。',
  detailRecentRuns: '最近 {n} 次运行',
  detailNoRuns: '还没有运行记录。',
  detailAllRuns: '完整记录',
  detailTaskNotifications: '任务通知',
  taskRunsLimit: '这里显示当前任务最近 20 次运行；全部运行见「运行」页。',
  runErrors: '{n} 条错误',
  runNoErrors: '无错误',
  notificationFallbackFailed: '运行失败；打开对应任务或 session 查看详情。',
  notificationFallbackTimeout: '运行超时；打开对应任务或 session 查看详情。',
  notificationFallbackSuccess: '运行完成。',
  notificationFallbackStandby: '定时触发已暂停。',
  notificationFallbackCalendar: '暂时无法确认交易日，相关任务已跳过。',
  notificationFallbackSkipped: '本次计划已跳过。',
  statusLabel: '状态',
  triggerSummary: '日程',
  lastRun: '上次运行',
  neverRun: '尚未运行',
  relativeNow: '刚刚',
  nextRunUnavailable: '交易日历不可用，无法计算下一次运行。',
  copyHint: '复制后会生成一个暂停状态的自定义任务。',
  notificationTaskGone: '任务已不存在',
  noSelection: '从列表中选择一个任务。',
  details: '详情',
  actions: '操作',
  rosterCount: '{n} 个任务',
  dayOfMonth: '{n} 日',
  everyPrefix: '每',
  weeklyPrefix: '每周',
  monthlyPrefix: '每月',
  monthlyLastDay: '最后一天',
  dailyPrefix: '每天',
  oncePrefix: '单次',
  tradingSuffix: '（仅交易日）',
  sessionMissing: '没有可打开的 session',
}

function installStyles() {
  if (typeof document === 'undefined' || document.querySelector(`style[data-${STYLE_TAG}]`)) return () => {}
  const style = document.createElement('style')
  style.setAttribute(`data-${STYLE_TAG}`, 'true')
  style.textContent = `
    .capital-automation-page, .capital-automation-modal { --ca-card: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1)); --ca-line: var(--dsw-alias-border-l3, var(--dsw-alias-border-l1)); --ca-line-soft: var(--dsw-alias-border-l2, var(--dsw-alias-border-l1)); --ca-table-line: var(--ca-line); --ca-muted: var(--dsw-alias-label-tertiary); --ca-caption: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); --ca-hover: var(--dsw-alias-interactive-bg-hover); --ca-field: var(--dsw-alias-bg-module-platform); --ca-business: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); --ca-success: var(--dsw-alias-state-success-primary); --ca-error: var(--dsw-alias-state-error-primary); --ca-warn: var(--dsw-alias-state-warn-label); --ca-business-text: var(--ca-business); --ca-success-text: var(--ca-success); --ca-error-text: var(--ca-error); --ca-warn-text: var(--ca-warn); --ca-heat-0: #262626; --ca-heat-1: #1b5e3a; --ca-heat-2: #2f8a56; --ca-heat-3: #40b366; --ca-heat-4: #56d364; --ca-heat-fail: #f85149; }
    body:not([data-ds-dark-theme]) .capital-automation-page, body:not([data-ds-dark-theme]) .capital-automation-modal { --ca-line: #0000001f; --ca-line-soft: #0000001a; --ca-table-line: #00000026; --ca-muted: #5d626a; --ca-caption: #6a6f77; --ca-hover: #eef1f5; --ca-field: #f7f8fa; --ca-business: #2f63d6; --ca-success: #16a34a; --ca-error: #dc2626; --ca-warn: #d97706; --ca-business-text: #2f63d6; --ca-success-text: #15803d; --ca-error-text: #c81e1e; --ca-warn-text: #b45309; --ca-tag-news: #2f6fd0; --ca-tag-market: #a85a08; --ca-tag-review: #6d4ac4; --ca-tag-research: #0f766e; --ca-tag-portfolio: #4d7c0f; --ca-tag-monitor: #0e7490; --ca-tag-custom: #b3246d; --ca-heat-0: #eef1f4; --ca-heat-1: #b7e4c0; --ca-heat-2: #74c98a; --ca-heat-3: #3ba55c; --ca-heat-4: #1f7a3a; --ca-heat-fail: #cf222e; }
    .capital-automation-page { display: flex; flex-direction: column; min-height: 0; height: 100%; color: var(--dsw-alias-label-primary); }
    .capital-automation-head { flex: none; padding: 18px 0 0; }
    .capital-automation-headinner { box-sizing: border-box; width: min(1080px, 100%); margin: 0 auto 5px; padding: 0 clamp(20px, 3vw, 36px); }
    .capital-automation-topbar { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 12px 18px; min-width: 0; }
    .capital-automation-brand { display: flex; align-items: center; gap: 10px; min-width: 0; justify-self: start; }
    .capital-automation-brandmark { flex: none; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 9px; color: #fff; background: linear-gradient(135deg, #4f8cff, #7c3aed); box-shadow: inset 0 1px 0 rgba(255,255,255,.24); }
    .capital-automation-brand h1 { margin: 0; font-size: 17px; line-height: 24px; font-weight: 600; letter-spacing: .1px; white-space: nowrap; }
    .capital-automation-tabs { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border: .5px solid var(--ca-line-soft); border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--ca-card)); box-shadow: inset 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); justify-self: center; }
    .capital-automation-tab { height: 28px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: var(--ca-muted); font: inherit; font-size: 12.5px; font-weight: 500; line-height: 28px; cursor: pointer; transition: background .15s, color .15s, box-shadow .15s; }
    .capital-automation-tab:hover:not([aria-selected="true"]) { background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); color: var(--dsw-alias-label-primary); }
    .capital-automation-tab[aria-selected="true"] { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.18), 0 2px 8px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent); }
    .capital-automation-tab:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: 2px; }
    .capital-automation-topactions { display: flex; align-items: center; gap: 8px; justify-self: end; }
    .capital-automation-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; border: .5px solid var(--ca-line-soft); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12.5px; line-height: 20px; white-space: nowrap; cursor: pointer; transition: background .15s, border-color .15s, color .15s, opacity .15s; }
    .capital-automation-btn:hover:not(:disabled) { background: var(--ca-hover); color: var(--dsw-alias-label-primary); }
    .capital-automation-btn[data-variant="primary"] { border-color: transparent; background: var(--ca-business); color: var(--dsw-alias-bg-base); }
    .capital-automation-btn[data-variant="primary"]:hover:not(:disabled) { background: var(--ca-business); color: var(--dsw-alias-bg-base); filter: brightness(1.08); }
    .capital-automation-templatefoot .capital-automation-btn[data-variant="primary"] { min-width: 54px; padding: 0 12px; font-weight: 600; box-shadow: inset 0 1px 0 rgba(255,255,255,.16), 0 1px 2px rgba(0,0,0,.16); }
    .capital-automation-templatefoot .capital-automation-btn[data-variant="primary"]:hover:not(:disabled) { box-shadow: inset 0 1px 0 rgba(255,255,255,.16), 0 2px 8px color-mix(in srgb, var(--ca-business) 32%, transparent); }
    .capital-automation-btn[data-variant="contrast"] { border-color: transparent; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); }
    .capital-automation-btn[data-variant="contrast"]:hover:not(:disabled) { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); opacity: .88; }
    .capital-automation-btn[data-variant="ghost"] { border-color: transparent; background: transparent; color: var(--ca-muted); }
    .capital-automation-btn[data-variant="ghost"]:hover:not(:disabled) { background: var(--ca-hover); color: var(--dsw-alias-label-primary); }
    .capital-automation-btn[data-variant="danger"] { border-color: transparent; background: var(--ca-error); color: var(--dsw-alias-bg-base); }
    .capital-automation-btn[data-variant="danger"]:hover:not(:disabled) { background: var(--ca-error); color: var(--dsw-alias-bg-base); filter: brightness(1.08); }
    .capital-automation-btn[data-size="sm"] { height: 28px; padding: 0 10px; font-size: 12px; }
    .capital-automation-btn[data-size="icon"] { width: 30px; height: 30px; padding: 0; border-radius: 9px; }
    .capital-automation-btn:disabled { opacity: .42; cursor: not-allowed; }
    .capital-automation-iconbtn { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--ca-muted); cursor: pointer; }
    .capital-automation-iconbtn:hover:not(:disabled) { background: var(--ca-hover); color: var(--dsw-alias-label-primary); }
    .capital-automation-iconbtn:disabled { opacity: .4; cursor: not-allowed; }
    .capital-automation-count { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: var(--ca-business); color: var(--dsw-alias-bg-base); font-size: 10px; line-height: 16px; }
    .capital-automation-banner { box-sizing: border-box; width: min(1080px, 100%); margin: 12px auto 0; padding: 10px 13px; border: .5px solid var(--ca-line-soft); border-radius: 12px; background: var(--ca-card); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 19px; }
    .capital-automation-banner[data-tone="warn"] { border-color: color-mix(in srgb, var(--ca-warn) 38%, var(--ca-line-soft)); color: var(--ca-warn-text); }
    .capital-automation-banner[data-tone="error"] { border-color: color-mix(in srgb, var(--ca-error) 38%, var(--ca-line-soft)); color: var(--ca-error-text); }
    .capital-automation-banner .capital-automation-btn { margin-left: 8px; vertical-align: middle; }
    .capital-automation-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; }
    .capital-automation-container { box-sizing: border-box; width: min(1080px, 100%); margin: 0 auto; padding: 20px clamp(20px, 3vw, 36px) 72px; }
    .capital-automation-card { box-sizing: border-box; border: .5px solid var(--ca-line); border-radius: 16px; background: var(--ca-card); }
    .capital-automation-history { position: relative; padding: 18px 20px 14px; }
    .capital-automation-historyhead { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px 18px; }
    .capital-automation-historytitle { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
    .capital-automation-historytitle h2 { margin: 0; font-size: 14px; line-height: 22px; font-weight: 600; }
    .capital-automation-historytitle span { color: var(--ca-muted); font-size: 12px; line-height: 20px; }
    .capital-automation-historystats { display: flex; align-items: center; gap: 14px; color: var(--ca-muted); font-size: 12px; line-height: 20px; }
    .capital-automation-historystat { display: inline-flex; align-items: center; gap: 5px; font-variant-numeric: tabular-nums; }
    .capital-automation-historystat[data-tone="ok"] { color: var(--ca-success-text); }
    .capital-automation-historystat[data-tone="error"] { color: var(--ca-error-text); }
    .capital-automation-historystat[data-tone="active"] { color: var(--ca-business-text); }
    .capital-automation-statusdot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
    .capital-automation-historylink { display: inline-flex; align-items: center; gap: 2px; height: 24px; padding: 0 6px; border: 0; border-radius: 7px; background: transparent; color: var(--ca-muted); font: inherit; font-size: 12px; cursor: pointer; }
    .capital-automation-historylink:hover { background: var(--ca-hover); color: var(--dsw-alias-label-primary); }
    .capital-automation-heatmap { display: flex; align-items: flex-start; gap: 8px; margin-top: 16px; }
    .capital-automation-heatweekdays { flex: none; display: grid; grid-template-rows: repeat(7, 1fr); gap: 3px; width: 28px; padding-top: 22px; color: var(--ca-caption); font-size: 10.5px; line-height: 1; align-self: stretch; }
    .capital-automation-heatweekday { display: flex; align-items: center; }
    .capital-automation-heatscroll { flex: 1 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden; padding-bottom: 2px; scrollbar-width: thin; }
    .capital-automation-heatscroll[data-faded="true"] { -webkit-mask-image: linear-gradient(to right, transparent 0, #000 18px); mask-image: linear-gradient(to right, transparent 0, #000 18px); }
    .capital-automation-heatcanvas { min-width: 620px; }
    .capital-automation-heatmonths { display: grid; grid-template-columns: repeat(${HEATMAP_WEEKS}, minmax(0, 1fr)); gap: 3px; height: 16px; margin-bottom: 6px; }
    .capital-automation-heatmonth { color: var(--ca-caption); font-size: 10.5px; line-height: 16px; white-space: nowrap; letter-spacing: .01em; }
    .capital-automation-heatgrid { display: grid; grid-template-columns: repeat(${HEATMAP_WEEKS}, minmax(0, 1fr)); grid-template-rows: repeat(7, auto); grid-auto-flow: column; gap: 3px; }
    .capital-automation-heatcell { display: block; min-width: 0; aspect-ratio: 1; border-radius: 2.5px; background: var(--ca-heat-0); box-shadow: inset 0 0 0 .5px color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); transition: background .12s, box-shadow .12s, outline-color .12s; }
    .capital-automation-heatcell[data-level="1"] { background: var(--ca-heat-1); }
    .capital-automation-heatcell[data-level="2"] { background: var(--ca-heat-2); }
    .capital-automation-heatcell[data-level="3"] { background: var(--ca-heat-3); }
    .capital-automation-heatcell[data-level="4"] { background: var(--ca-heat-4); }
    .capital-automation-heatcell[data-future="true"] { opacity: .45; }
    .capital-automation-heatcell[data-failed="true"] { box-shadow: inset 0 0 0 1.5px var(--ca-heat-fail); }
    .capital-automation-heatcell[data-active="true"] { box-shadow: inset 0 0 0 1.5px var(--ca-business); animation: capital-automation-heatpulse 1.8s ease-in-out infinite; }
    .capital-automation-heatcell:hover { outline: 1px solid var(--dsw-alias-label-primary); outline-offset: 1px; }
    .capital-automation-heattip { position: absolute; z-index: 5; min-width: 128px; max-width: 220px; padding: 7px 9px; border: .5px solid var(--ca-line); border-radius: 9px; background: var(--dsw-alias-bg-layer-3, var(--ca-card)); box-shadow: 0 8px 22px rgba(0, 0, 0, .28); color: var(--dsw-alias-label-primary); pointer-events: none; transform: translate(-50%, -100%); }
    .capital-automation-heattipdate { display: block; font-size: 11.5px; font-weight: 600; line-height: 16px; white-space: nowrap; }
    .capital-automation-heattipmeta { display: block; margin-top: 2px; color: var(--ca-muted); font-size: 11px; line-height: 16px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .capital-automation-heatfoot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 14px; margin-top: 8px; color: var(--ca-caption); font-size: 11px; line-height: 16px; }
    .capital-automation-heatrange { font-variant-numeric: tabular-nums; }
    .capital-automation-heatlegend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 5px; }
    .capital-automation-heatlegendlabel { color: var(--ca-caption); }
    .capital-automation-heatsample { width: 10px; height: 10px; border-radius: 2px; background: var(--ca-heat-0); box-shadow: inset 0 0 0 .5px color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); }
    .capital-automation-heatsample[data-level="1"] { background: var(--ca-heat-1); }
    .capital-automation-heatsample[data-level="2"] { background: var(--ca-heat-2); }
    .capital-automation-heatsample[data-level="3"] { background: var(--ca-heat-3); }
    .capital-automation-heatsample[data-level="4"] { background: var(--ca-heat-4); }
    .capital-automation-heatkey { display: inline-flex; align-items: center; gap: 5px; margin-right: 7px; }
    .capital-automation-heatfailbox { width: 10px; height: 10px; border-radius: 2px; background: var(--ca-heat-0); box-shadow: inset 0 0 0 1.5px var(--ca-heat-fail); }
    .capital-automation-heatactivebox { width: 10px; height: 10px; border-radius: 2px; background: var(--ca-heat-0); box-shadow: inset 0 0 0 1.5px var(--ca-business); }
    @keyframes capital-automation-heatpulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
    @media (prefers-reduced-motion: reduce) { .capital-automation-heatcell[data-active="true"] { animation: none; } }
    .capital-automation-section { margin-top: 26px; }
    .capital-automation-sectionhead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-bottom: 10px; }
    .capital-automation-sectionhead h2 { margin: 0; font-size: 14px; line-height: 22px; font-weight: 600; }
    .capital-automation-sectionhead > span { color: var(--ca-muted); font-size: 12px; line-height: 18px; }
    .capital-automation-sectiontools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; }
    .capital-automation-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
    .capital-automation-filter { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 10px; border: 0; border-radius: 999px; background: transparent; color: var(--ca-muted); font: inherit; font-size: 12px; line-height: 28px; cursor: pointer; transition: background .15s, color .15s, box-shadow .15s; }
    .capital-automation-filtercount { display: inline-flex; align-items: center; justify-content: center; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 999px; background: color-mix(in srgb, currentColor 13%, transparent); font-size: 10.5px; line-height: 17px; font-variant-numeric: tabular-nums; }
    .capital-automation-filter[aria-pressed="true"] .capital-automation-filtercount { background: var(--ca-business); color: var(--dsw-alias-bg-base); }
    .capital-automation-filter:hover { background: var(--ca-hover); color: var(--dsw-alias-label-primary); }
    .capital-automation-filter[aria-pressed="true"] { background: color-mix(in srgb, var(--ca-business) 11%, var(--ca-card)); box-shadow: inset 0 0 0 .5px color-mix(in srgb, var(--ca-business) 28%, transparent); color: var(--ca-business-text); font-weight: 600; }
    .capital-automation-filter:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: 1px; }
    .capital-automation-search { box-sizing: border-box; display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 9px; border: .5px solid var(--ca-line-soft); border-radius: 999px; background: var(--ca-card); color: var(--ca-muted); }
    .capital-automation-search:focus-within { border-color: var(--ca-business); }
    .capital-automation-search input { width: 128px; min-width: 0; padding: 0; border: 0; outline: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; }
    .capital-automation-search input::placeholder { color: var(--ca-caption); }
    .capital-automation-running { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-bottom: 10px; padding: 12px 14px; border: .5px solid color-mix(in srgb, var(--ca-business) 30%, var(--ca-line)); border-radius: 14px; background: color-mix(in srgb, var(--ca-business) 7%, var(--ca-card)); }
    .capital-automation-runningrow { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; width: 100%; min-width: 0; }
    .capital-automation-runningactions { display: flex; flex: none; align-items: center; gap: 8px; margin-left: auto; }
    .capital-automation-live { display: inline-flex; align-items: center; gap: 6px; color: var(--ca-business-text); font-size: 12px; }
    .capital-automation-livedot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: capital-automation-pulse 1.6s ease-in-out infinite; }
    @keyframes capital-automation-pulse { 0%, 100% { opacity: 1; box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 30%, transparent); } 50% { opacity: .55; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 0%, transparent); } }
    @media (prefers-reduced-motion: reduce) { .capital-automation-livedot { animation: none; } .capital-automation-skeleton { animation: none; } }
    .capital-automation-table { overflow: hidden; border: .5px solid var(--ca-table-line); border-radius: 16px; background: var(--ca-card); }
    .capital-automation-thead { display: grid; grid-template-columns: minmax(0, 1fr) 36px; align-items: center; padding-right: 18px; border-bottom: .5px solid var(--ca-table-line); background: color-mix(in srgb, var(--dsw-alias-label-primary) 3.5%, var(--ca-card)); color: var(--ca-muted); font-size: 11.5px; font-weight: 500; letter-spacing: .02em; line-height: 16px; }
    .capital-automation-theadmain { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(110px, .85fr) minmax(128px, .95fr) 88px; gap: 14px; padding: 9px 0 9px 16px; }
    .capital-automation-trow { display: grid; grid-template-columns: minmax(0, 1fr) 36px; align-items: stretch; padding-right: 18px; border-top: .5px solid var(--ca-table-line); transition: background .15s; }
    .capital-automation-trow:first-of-type { border-top: 0; }
    .capital-automation-trow:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--ca-card)); }
    .capital-automation-trowmain { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(110px, .85fr) minmax(128px, .95fr) 88px; align-items: center; gap: 14px; min-width: 0; padding: 11px 0 11px 16px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .capital-automation-trowmain:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: -2px; }
    .capital-automation-trowmenu { display: flex; align-items: center; justify-content: center; }
    .capital-automation-cell { min-width: 0; }
    .capital-automation-identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .capital-automation-glyph { flex: none; display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: #fff; box-shadow: inset 0 1px 0 rgba(255,255,255,.22); }
    .capital-automation-glyph[data-tone="news"] { background: linear-gradient(135deg, #5b9dff, #2563eb); }
    .capital-automation-glyph[data-tone="market"] { background: linear-gradient(135deg, #ffbd4a, #f97316); }
    .capital-automation-glyph[data-tone="review"] { background: linear-gradient(135deg, #b18cff, #7c3aed); }
    .capital-automation-glyph[data-tone="research"] { background: linear-gradient(135deg, #39d7a8, #0d9488); }
    .capital-automation-glyph[data-tone="portfolio"] { background: linear-gradient(135deg, #84cc16, #4d7c0f); }
    .capital-automation-glyph[data-tone="monitor"] { background: linear-gradient(135deg, #06b6d4, #0e7490); }
    .capital-automation-glyph[data-tone="custom"] { background: linear-gradient(135deg, #f472b6, #db2777); }
    .capital-automation-identitytext { min-width: 0; }
    .capital-automation-tasktitlerow { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; }
    .capital-automation-tasktitlerow .capital-automation-tasktags { flex: 0 1 auto; flex-wrap: wrap; max-width: 100%; margin-top: 0; }
    .capital-automation-tasktitle { display: block; flex: 0 1 auto; min-width: 0; overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 13.5px; line-height: 20px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
    .capital-automation-taskdesc { display: block; overflow: hidden; margin-top: 1px; color: var(--ca-muted); font-size: 11.5px; line-height: 17px; text-overflow: ellipsis; white-space: nowrap; }
    .capital-automation-tasktags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 3px; }
    .capital-automation-tag { display: inline-flex; align-items: center; gap: 4px; max-width: 13em; overflow: hidden; padding: 1px 6px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); color: var(--ca-muted); font-size: 11px; font-weight: 500; line-height: 17px; white-space: nowrap; }
    .capital-automation-tag[data-tone="news"] { color: #6ba6ff; }
    .capital-automation-tag[data-tone="market"] { color: #ffb45c; }
    .capital-automation-tag[data-tone="review"] { color: #b79aff; }
    .capital-automation-tag[data-tone="research"] { color: #56d9b4; }
    .capital-automation-tag[data-tone="portfolio"] { color: #a3e635; }
    .capital-automation-tag[data-tone="monitor"] { color: #22d3ee; }
    .capital-automation-tag[data-tone="custom"] { color: #f79bc3; }
    body:not([data-ds-dark-theme]) .capital-automation-tag { background: color-mix(in srgb, currentColor 9%, var(--ca-card)); }
    body:not([data-ds-dark-theme]) .capital-automation-tag[data-tone="news"] { color: var(--ca-tag-news); }
    body:not([data-ds-dark-theme]) .capital-automation-tag[data-tone="market"] { color: var(--ca-tag-market); }
    body:not([data-ds-dark-theme]) .capital-automation-tag[data-tone="review"] { color: var(--ca-tag-review); }
    body:not([data-ds-dark-theme]) .capital-automation-tag[data-tone="research"] { color: var(--ca-tag-research); }
    body:not([data-ds-dark-theme]) .capital-automation-tag[data-tone="portfolio"] { color: var(--ca-tag-portfolio); }
    body:not([data-ds-dark-theme]) .capital-automation-tag[data-tone="monitor"] { color: var(--ca-tag-monitor); }
    body:not([data-ds-dark-theme]) .capital-automation-tag[data-tone="custom"] { color: var(--ca-tag-custom); }
    .capital-automation-schedule { display: block; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
    .capital-automation-schedulesub { display: block; margin-top: 1px; color: var(--ca-caption); font-size: 11px; line-height: 16px; }
    .capital-automation-nextmain { display: block; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
    .capital-automation-nextsub { display: block; margin-top: 1px; color: var(--ca-caption); font-size: 11px; line-height: 16px; }
    .capital-automation-state { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; height: 22px; padding: 0 8px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); color: var(--ca-muted); font-size: 11px; line-height: 22px; white-space: nowrap; }
    .capital-automation-state[data-state="active"] { color: var(--ca-success-text); }
    .capital-automation-state[data-state="paused"] { color: var(--ca-warn-text); }
    .capital-automation-state[data-state="running"] { color: var(--ca-business-text); }
    .capital-automation-state[data-state="dormant"] { color: var(--ca-muted); }
    body:not([data-ds-dark-theme]) .capital-automation-state { background: color-mix(in srgb, currentColor 9%, var(--ca-card)); }
    .capital-automation-statedot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex: none; }
    .capital-automation-state[data-state="running"] .capital-automation-statedot, .capital-automation-runstatus[data-status="running"] .capital-automation-rundot { animation: capital-automation-pulse 1.6s ease-in-out infinite; }
    .capital-automation-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 42px 20px; border: .5px dashed var(--ca-line); border-radius: 16px; color: var(--ca-muted); text-align: center; }
    .capital-automation-emptyicon { display: grid; place-items: center; width: 38px; height: 38px; margin-bottom: 4px; border-radius: 12px; background: var(--dsw-alias-bg-module-platform); color: var(--ca-caption); }
    .capital-automation-empty h3 { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13.5px; font-weight: 500; line-height: 20px; }
    .capital-automation-empty p { max-width: 460px; margin: 0; font-size: 12px; line-height: 18px; }
    .capital-automation-empty .capital-automation-btn { margin-top: 8px; }
    .capital-automation-loading { display: flex; flex-direction: column; pointer-events: none; }
    .capital-automation-skeletonlabel { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .capital-automation-skeleton { display: block; flex: none; max-width: 100%; border-radius: 6px; background: var(--dsw-alias-bg-skeleton); animation: capital-automation-breathe 1.8s ease-in-out infinite; }
    .capital-automation-skeletonheat { margin-top: 16px; padding-left: 36px; }
    .capital-automation-skeletonmonths { display: grid; grid-template-columns: repeat(${HEATMAP_WEEKS}, minmax(0, 1fr)); gap: 3px; height: 16px; margin-bottom: 6px; }
    .capital-automation-skeletonmonths > .capital-automation-skeleton { width: 22px; height: 8px; border-radius: 3px; }
    .capital-automation-skeletongrid { display: grid; grid-template-columns: repeat(${HEATMAP_WEEKS}, minmax(0, 1fr)); grid-template-rows: repeat(7, auto); grid-auto-flow: column; gap: 3px; }
    .capital-automation-skeletongrid > .capital-automation-skeleton { width: 100%; aspect-ratio: 1; border-radius: 2.5px; }
    .capital-automation-skeletonstack { display: flex; flex: 1 1 auto; flex-direction: column; gap: 6px; min-width: 0; }
    .capital-automation-skeletonrow .capital-automation-trowmain { min-height: 57px; cursor: default; }
    .capital-automation-skeletonrow .capital-automation-cell[data-cell] { display: flex; flex-direction: column; gap: 5px; }
    .capital-automation-skeletonrun .capital-automation-runline { min-height: 20px; }
    .capital-automation-skeletonrun .capital-automation-runmetaline { min-height: 17px; }
    .capital-automation-skeletontemplatemain { display: flex; align-items: flex-start; gap: 11px; min-width: 0; }
    @keyframes capital-automation-breathe { 0% { opacity: 1; } 40% { opacity: .55; } 80%, 100% { opacity: 1; } }
    .capital-automation-templates { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
    .capital-automation-template { box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; min-height: 152px; padding: 15px 16px 13px; border: .5px solid var(--ca-line); border-radius: 16px; background: var(--ca-card); transition: border-color .15s, background .15s; }
    .capital-automation-template:hover { border-color: color-mix(in srgb, var(--ca-business) 28%, var(--ca-line)); background: color-mix(in srgb, var(--ca-hover) 55%, var(--ca-card)); }
    .capital-automation-templatemain { display: flex; align-items: flex-start; gap: 11px; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .capital-automation-templatemain:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: 4px; border-radius: 8px; }
    .capital-automation-templatebody { min-width: 0; }
    .capital-automation-templatetitlerow { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; }
    .capital-automation-templatetitlerow .capital-automation-tag { flex: none; }
    .capital-automation-templatebody strong { display: block; min-width: 0; color: var(--dsw-alias-label-primary); font-size: 13.5px; line-height: 20px; font-weight: 500; }
    .capital-automation-templatedesc { display: -webkit-box; overflow: hidden; margin-top: 3px; color: var(--ca-muted); font-size: 12px; line-height: 18px; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .capital-automation-templatefoot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; }
    .capital-automation-templatemeta { display: inline-flex; align-items: center; gap: 4px; color: var(--ca-caption); font-size: 11px; line-height: 16px; }
    .capital-automation-detailbar { display: flex; align-items: center; min-height: 34px; margin: 0 0 6px; }
    .capital-automation-back { display: inline-flex; align-items: center; gap: 2px; height: 30px; margin-left: -8px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; color: var(--ca-muted); font: inherit; font-size: 12.5px; cursor: pointer; }
    .capital-automation-back:hover { background: var(--ca-hover); color: var(--dsw-alias-label-primary); }
    .capital-automation-hero { display: flex; align-items: flex-start; gap: 14px; padding: 2px 0 18px; border-bottom: .5px solid var(--ca-line); }
    .capital-automation-herobody { flex: 1 1 auto; min-width: 0; }
    .capital-automation-herotitle { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .capital-automation-herotitle h2 { margin: 0; font-size: 22px; line-height: 30px; font-weight: 600; letter-spacing: .1px; overflow-wrap: anywhere; }
    .capital-automation-herodesc { max-width: 760px; margin: 5px 0 0; color: var(--ca-muted); font-size: 12.5px; line-height: 19px; }
    .capital-automation-heroactions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; flex: none; padding-top: 2px; }
    .capital-automation-detailtabs { display: flex; align-items: center; gap: 26px; overflow-x: auto; overflow-y: hidden; border-bottom: .5px solid var(--ca-line); }
    .capital-automation-detailtab { position: relative; flex: none; height: 42px; padding: 0 1px; border: 0; background: transparent; color: var(--ca-muted); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; }
    .capital-automation-detailtab:hover { color: var(--dsw-alias-label-primary); }
    .capital-automation-detailtab[aria-selected="true"] { color: var(--ca-business-text); font-weight: 600; }
    .capital-automation-detailtab[aria-selected="true"]:after { content: ""; position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; border-radius: 2px; background: var(--ca-business-text); }
    .capital-automation-detailtab:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: -2px; border-radius: 4px; }
    .capital-automation-detailbody { display: flex; flex-direction: column; gap: 16px; padding-top: 18px; }
    .capital-automation-overview { display: flex; flex-direction: column; gap: 16px; }
    .capital-automation-statgrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .capital-automation-stat { display: flex; flex-direction: column; gap: 4px; min-height: 78px; padding: 13px 14px; border: .5px solid var(--ca-line); border-radius: 14px; background: var(--ca-card); }
    body:not([data-ds-dark-theme]) .capital-automation-card, body:not([data-ds-dark-theme]) .capital-automation-table, body:not([data-ds-dark-theme]) .capital-automation-template, body:not([data-ds-dark-theme]) .capital-automation-stat { box-shadow: 0 1px 2px rgba(15,17,21,.035), 0 10px 28px rgba(15,17,21,.025); }
    .capital-automation-runmeta, .capital-automation-statvalue, .capital-automation-notificationtime { font-variant-numeric: tabular-nums; }
    .capital-automation-statlabel { color: var(--ca-muted); font-size: 11px; line-height: 16px; }
    .capital-automation-statvalue { color: var(--dsw-alias-label-primary); font-size: 15px; line-height: 22px; font-weight: 500; overflow-wrap: anywhere; }
    .capital-automation-statvalue[data-tone="ok"] { color: var(--ca-success-text); }
    .capital-automation-statvalue[data-tone="error"] { color: var(--ca-error-text); }
    .capital-automation-statvalue[data-tone="running"] { color: var(--ca-business-text); }
    .capital-automation-statvalue[data-tone="warn"] { color: var(--ca-warn-text); }
    .capital-automation-statsub { color: var(--ca-caption); font-size: 11px; line-height: 16px; }
    .capital-automation-panel { padding: 16px 18px; }
    .capital-automation-panelhead { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin-bottom: 12px; }
    .capital-automation-panelhead h3 { margin: 0; font-size: 13.5px; line-height: 20px; font-weight: 600; }
    .capital-automation-panelhead .capital-automation-btn { margin-left: auto; }
    .capital-automation-panelhead .capital-automation-select { margin-left: auto; }
    .capital-automation-panelhead .capital-automation-btn[data-variant="ghost"] { padding-right: 0; }
    .capital-automation-kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px 18px; }
    .capital-automation-kvitem { min-width: 0; }
    .capital-automation-kvlabel { display: block; color: var(--ca-caption); font-size: 11px; line-height: 16px; }
    .capital-automation-kvvalue { display: block; margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 19px; overflow-wrap: anywhere; }
    .capital-automation-policy { color: var(--ca-muted); font-size: 12px; line-height: 19px; }
    .capital-automation-policy p { margin: 0; }
    .capital-automation-policy p + p { margin-top: 5px; }
    .capital-automation-hint { margin: 0; color: var(--ca-muted); font-size: 11.5px; line-height: 18px; }
    .capital-automation-hint[data-tone="error"] { color: var(--ca-error-text); }
    .capital-automation-notice { margin: 0; color: var(--ca-success-text); font-size: 12px; line-height: 18px; }
    .capital-automation-error { margin: 0; color: var(--ca-error-text); font-size: 12px; line-height: 18px; }
    .capital-automation-toast { position: fixed; bottom: 26px; left: 50%; z-index: 1300; max-width: min(520px, calc(100vw - 40px)); transform: translateX(-50%); padding: 8px 15px; border: .5px solid var(--ca-line-soft); border-radius: 999px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); box-shadow: 0 8px 26px rgba(0,0,0,.22); font-size: 12px; line-height: 18px; }
    .capital-automation-form { display: flex; flex-direction: column; gap: 16px; }
    .capital-automation-instructionrow { display: grid; grid-template-columns: minmax(320px, 1fr) minmax(420px, 520px); align-items: stretch; gap: 16px; }
    .capital-automation-instructionside { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .capital-automation-formgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .capital-automation-titlerow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, 210px); align-items: start; gap: 12px; }
    .capital-automation-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .capital-automation-fieldhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
    .capital-automation-fieldlabel { color: var(--ca-muted); font-size: 11.5px; line-height: 17px; }
    .capital-automation-fieldhint { color: var(--ca-caption); font-size: 11px; line-height: 16px; font-variant-numeric: tabular-nums; }
    .capital-automation-glyphbtn { display: inline-flex; flex: none; align-items: center; gap: 4px; padding: 0; border: 0; border-radius: 14px; background: transparent; cursor: pointer; }
    .capital-automation-glyphbtn:hover:not(:disabled) .capital-automation-glyph { box-shadow: inset 0 1px 0 rgba(255,255,255,.22), 0 0 0 2px color-mix(in srgb, var(--ca-business) 52%, transparent); }
    .capital-automation-glyphbtn:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: 2px; }
    .capital-automation-glyphbtn:disabled { cursor: not-allowed; opacity: .55; }
    .capital-automation-glyphbtnchevron { display: grid; flex: none; place-items: center; width: 12px; color: var(--ca-muted); }
    .capital-automation-glyphbtn:hover:not(:disabled) .capital-automation-glyphbtnchevron { color: var(--ca-business-text); }
    .capital-automation-iconrow { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .capital-automation-iconrowbody { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    /* The menu is portaled to body, outside the page's --ca-* scope; use host tokens. */
    .capital-automation-iconmenu { box-sizing: border-box; width: 400px; max-width: calc(100vw - 24px); padding: 10px; }
    .capital-automation-iconmenu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(32px, 1fr)); gap: 6px; }
    button.capital-automation-iconmenu-item { box-sizing: border-box; display: inline-grid; place-items: center; width: 100%; max-width: 34px; aspect-ratio: 1; justify-self: center; padding: 0; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; transition: background .15s, border-color .15s, color .15s; }
    button.capital-automation-iconmenu-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
    button.capital-automation-iconmenu-item[data-selected="true"] { border-color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); }
    button.capital-automation-iconmenu-item:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
    button.capital-automation-iconmenu-item:disabled { opacity: .4; cursor: not-allowed; }
    .capital-automation-field input { box-sizing: border-box; width: 100%; padding: 0 10px; border: .5px solid var(--ca-line-soft); border-radius: 10px; background: var(--ca-field); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; line-height: 32px; }
    .capital-automation-field input { height: 34px; }
    .capital-automation-texteditor { color: var(--dsw-alias-label-primary); font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; outline: 0; cursor: text; }
    .capital-automation-field .capital-automation-texteditor { box-sizing: border-box; flex: 1 1 auto; min-height: 110px; padding: 9px 10px; border: .5px solid var(--ca-line-soft); border-radius: 10px; background: var(--ca-field); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; line-height: 19px; white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; outline: 0; cursor: text; }
    .capital-automation-field .capital-automation-texteditor.capital-automation-descriptioninput { flex: none; height: 58px; min-height: 58px; }
    .capital-automation-texteditor:empty:before { content: attr(data-placeholder); color: var(--ca-caption); pointer-events: none; }
    .capital-automation-field .capital-automation-texteditor:hover { border-color: var(--ca-line); }
    .capital-automation-field .capital-automation-texteditor:focus-visible { border-color: var(--ca-business); outline: 2px solid color-mix(in srgb, var(--ca-business) 22%, transparent); outline-offset: 0; }
    .capital-automation-field[data-invalid="true"] .capital-automation-texteditor { border-color: color-mix(in srgb, var(--ca-error) 58%, var(--ca-line-soft)); }
    .capital-automation-field[data-invalid="true"] .capital-automation-texteditor:focus-visible { border-color: var(--ca-error); outline-color: color-mix(in srgb, var(--ca-error) 22%, transparent); }
    .capital-automation-field .capital-automation-texteditor[contenteditable="false"] { color: var(--ca-muted); opacity: .8; cursor: not-allowed; }
    .capital-automation-field input:hover { border-color: var(--ca-line); }
    .capital-automation-field input:focus-visible { border-color: var(--ca-business); outline: 2px solid color-mix(in srgb, var(--ca-business) 22%, transparent); outline-offset: 0; }
    .capital-automation-field[data-invalid="true"] input { border-color: color-mix(in srgb, var(--ca-error) 58%, var(--ca-line-soft)); }
    .capital-automation-field[data-invalid="true"] input:focus-visible { border-color: var(--ca-error); outline-color: color-mix(in srgb, var(--ca-error) 22%, transparent); }
    .capital-automation-field input:disabled { color: var(--ca-muted); opacity: .8; }
    .capital-automation-fielderror { color: var(--ca-error-text); font-size: 11px; line-height: 16px; }
    .capital-automation-select { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; height: 34px; padding: 0 10px 0 12px; border: 0; border-radius: 10px; background: var(--ca-field); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; line-height: 20px; text-align: left; cursor: pointer; transition: background .15s, opacity .15s; }
    .capital-automation-select:hover:not(:disabled) { background: var(--ca-hover); }
    .capital-automation-select[data-block="true"] { width: 100%; }
    .capital-automation-select[data-size="sm"] { height: 28px; padding: 0 8px 0 9px; border-radius: 8px; font-size: 11.5px; }
    .capital-automation-select:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: 0; }
    .capital-automation-select:disabled { opacity: .5; cursor: not-allowed; }
    .capital-automation-selectvalue { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .capital-automation-select > svg { flex: none; color: var(--ca-muted); }
    .capital-automation-formactions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 14px; border-top: .5px solid var(--ca-line); }
    .capital-automation-formactions[data-sticky="true"] { position: sticky; bottom: -1px; z-index: 2; margin-top: 2px; padding: 12px 0 4px; background: var(--dsw-alias-bg-base); }
    .capital-automation-formstatus { margin-right: auto; color: var(--ca-caption); font-size: 11.5px; line-height: 18px; }
    .capital-automation-autosavestate { min-width: 0; max-width: min(520px, 70%); overflow: hidden; color: var(--ca-caption); font-size: 11.5px; line-height: 18px; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
    .capital-automation-autosavestate[data-tone="ok"] { color: var(--ca-success-text); }
    .capital-automation-autosavestate[data-tone="error"] { color: var(--ca-error-text); }
    .capital-automation-triggerbox { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border: .5px solid var(--ca-line); border-radius: 14px; background: var(--ca-field); }
    .capital-automation-triggerbox[data-invalid="true"] { border-color: color-mix(in srgb, var(--ca-error) 52%, var(--ca-line)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ca-error) 9%, transparent); }
    .capital-automation-triggerhead { display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
    .capital-automation-triggerhead > .capital-automation-triggerfield:first-child { flex: 1 1 auto; min-width: 0; }
    .capital-automation-triggerhead > .capital-automation-triggerfield:last-child { flex: none; }
    .capital-automation-triggerfield { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
    .capital-automation-triggerfield .capital-automation-select { flex: none; width: 96px; height: 32px; padding: 0 8px 0 10px; border: .5px solid var(--ca-line-soft); border-radius: 9px; background: var(--ca-card); font-size: 12.5px; }
    .capital-automation-triggerfield .capital-automation-select:hover:not(:disabled) { border-color: var(--ca-line); background: var(--ca-card); }
    .capital-automation-triggerlabel { color: var(--ca-muted); font-size: 11.5px; line-height: 16px; white-space: nowrap; }
    .capital-automation-triggerbox input.capital-automation-triggertime, .capital-automation-triggerbox input.capital-automation-triggerdate { box-sizing: border-box; flex: none; width: 112px; height: 32px; padding: 0 8px; border: .5px solid var(--ca-line-soft); border-radius: 10px; background: var(--ca-card); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; font-variant-numeric: tabular-nums; line-height: normal; transition: border-color .15s, box-shadow .15s; }
    .capital-automation-triggerbox input.capital-automation-triggerdate { flex: 0 1 146px; width: 146px; min-width: 120px; }
    .capital-automation-triggerbox input.capital-automation-triggertime:hover:not(:disabled), .capital-automation-triggerbox input.capital-automation-triggerdate:hover:not(:disabled) { border-color: var(--ca-line); }
    .capital-automation-triggerbox input.capital-automation-triggertime:focus-visible, .capital-automation-triggerbox input.capital-automation-triggerdate:focus-visible { border-color: var(--ca-business); outline: 2px solid color-mix(in srgb, var(--ca-business) 22%, transparent); outline-offset: 0; }
    .capital-automation-triggerbox input.capital-automation-triggertime[data-invalid="true"], .capital-automation-triggerbox input.capital-automation-triggerdate[data-invalid="true"] { border-color: color-mix(in srgb, var(--ca-error) 58%, var(--ca-line-soft)); }
    .capital-automation-triggerbox input.capital-automation-triggertime[data-invalid="true"]:focus-visible, .capital-automation-triggerbox input.capital-automation-triggerdate[data-invalid="true"]:focus-visible { border-color: var(--ca-error); outline-color: color-mix(in srgb, var(--ca-error) 22%, transparent); }
    .capital-automation-triggerbox input.capital-automation-triggertime:disabled, .capital-automation-triggerbox input.capital-automation-triggerdate:disabled { opacity: .5; cursor: not-allowed; }
    body[data-ds-dark-theme] .capital-automation-triggertime, body[data-ds-dark-theme] .capital-automation-triggerdate { color-scheme: dark; }
    body:not([data-ds-dark-theme]) .capital-automation-triggertime, body:not([data-ds-dark-theme]) .capital-automation-triggerdate { color-scheme: light; }
    .capital-automation-triggerdetail { display: flex; flex: 1 1 auto; align-items: center; gap: 6px; min-width: 0; min-height: 32px; }
    .capital-automation-triggerdetail > .capital-automation-triggerfield { flex: 1 1 auto; min-width: 0; }
    .capital-automation-triggerdetail .capital-automation-triggerpick { flex: 1 1 auto; width: auto; min-width: 0; max-width: 190px; height: 32px; padding: 0 8px 0 10px; border: .5px solid var(--ca-line-soft); border-radius: 9px; background: var(--ca-card); font-size: 12px; }
    .capital-automation-triggerdetail .capital-automation-triggerpick:hover:not(:disabled) { border-color: var(--ca-line); background: var(--ca-card); }
    .capital-automation-monthpick [role="menu"] [role="menu"] { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2px; width: 196px; min-width: 0; max-height: 252px; overflow-y: auto; padding: 6px; }
    .capital-automation-monthpick [role="menu"] [role="menu"] button { justify-content: center; min-width: 0; min-height: 26px; padding: 3px 4px; font-size: 12px; line-height: 18px; }
    .capital-automation-triggersettings { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding-top: 12px; border-top: .5px solid var(--ca-line); }
    .capital-automation-triggerzone { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
    .capital-automation-triggersettings .capital-automation-select { max-width: 190px; height: 28px; padding: 0 8px 0 10px; border: .5px solid var(--ca-line-soft); border-radius: 9px; background: var(--ca-card); font-size: 11.5px; }
    .capital-automation-triggersettings .capital-automation-select:hover:not(:disabled) { border-color: var(--ca-line); background: var(--ca-card); }
    .capital-automation-triggerswitch { display: inline-flex; flex: none; align-items: center; gap: 7px; color: var(--dsw-alias-label-secondary); font-size: 12px; cursor: pointer; user-select: none; }
    .capital-automation-triggererrors { display: flex; flex-direction: column; gap: 4px; }
    .capital-automation-switch { display: inline-flex; align-items: center; gap: 7px; color: var(--ca-muted); font-size: 12px; }
    .capital-automation-advanced { border-top: .5px solid var(--ca-line); padding-top: 12px; }
    .capital-automation-advanced summary { color: var(--ca-muted); font-size: 12px; line-height: 18px; cursor: pointer; user-select: none; }
    .capital-automation-advanced summary:hover { color: var(--dsw-alias-label-primary); }
    .capital-automation-advancedbody { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; }
    .capital-automation-switchlist { display: flex; flex-direction: column; }
    .capital-automation-switchrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 38px; padding: 3px 0; border-bottom: .5px solid var(--ca-line); }
    .capital-automation-switchrow:last-child { border-bottom: 0; }
    .capital-automation-switchrow span { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
    .capital-automation-switchrow small { display: block; margin-top: 1px; color: var(--ca-caption); font-size: 11px; line-height: 16px; }
    .capital-automation-runs { display: flex; flex-direction: column; }
    .capital-automation-run { padding: 13px 0; border-bottom: .5px solid var(--ca-line); }
    .capital-automation-run:first-child { padding-top: 0; }
    .capital-automation-run:last-child { padding-bottom: 0; border-bottom: 0; }
    .capital-automation-runhead { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 16px; min-width: 0; }
    .capital-automation-runmain { min-width: 0; }
    .capital-automation-runline { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-width: 0; }
    .capital-automation-runtitle { color: var(--dsw-alias-label-primary); font-size: 12.5px; line-height: 20px; font-weight: 500; overflow-wrap: anywhere; }
    .capital-automation-runmaintitle { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .capital-automation-runmaintitle:hover { color: var(--ca-business-text); }
    .capital-automation-runmetaline { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin-top: 4px; }
    .capital-automation-runmeta { color: var(--ca-caption); font-size: 11px; line-height: 17px; }
    .capital-automation-runactions { display: flex; align-items: center; gap: 8px; flex: none; }
    .capital-automation-runstatus { display: inline-flex; align-items: center; gap: 5px; color: var(--ca-muted); font-size: 11.5px; font-weight: 500; line-height: 18px; }
    .capital-automation-runstatus[data-status="succeeded"] { color: var(--ca-success-text); }
    .capital-automation-runstatus[data-status="failed"], .capital-automation-runstatus[data-status="timed_out"], .capital-automation-runstatus[data-status="blocked_requires_user"], .capital-automation-runstatus[data-status="unknown_after_restart"] { color: var(--ca-error-text); }
    .capital-automation-runstatus[data-status="queued"], .capital-automation-runstatus[data-status="starting"], .capital-automation-runstatus[data-status="running"] { color: var(--ca-business-text); }
    .capital-automation-runstatus[data-status="skipped_overlap"], .capital-automation-runstatus[data-status="skipped_calendar_unavailable"], .capital-automation-runstatus[data-status="missed"] { color: var(--ca-warn-text); }
    .capital-automation-rundot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex: none; }
    .capital-automation-runspacer { flex: 1 1 auto; }
    .capital-automation-runerrorbadge { box-sizing: border-box; display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 8px; border: .5px solid color-mix(in srgb, currentColor 38%, var(--ca-line)); border-radius: 999px; background: color-mix(in srgb, currentColor 8%, var(--ca-card)); color: var(--ca-warn-text); font: inherit; font-size: 11px; font-weight: 500; line-height: 18px; white-space: nowrap; cursor: pointer; }
    .capital-automation-runerrorbadge:hover { background: color-mix(in srgb, currentColor 14%, var(--ca-card)); }
    .capital-automation-runerrorbadge[data-tone="error"] { color: var(--ca-error-text); }
    .capital-automation-runerrorbadge svg:last-child { transition: transform .15s; }
    .capital-automation-runerrorbadge[aria-expanded="true"] svg:last-child { transform: rotate(90deg); }
    .capital-automation-runerrors { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; padding: 9px 11px; border: .5px solid var(--ca-line); border-radius: 10px; background: var(--ca-field); }
    .capital-automation-runerror { display: grid; grid-template-columns: 6px minmax(0, 1fr) auto; align-items: start; gap: 8px; color: var(--ca-muted); font-size: 11.5px; line-height: 17px; }
    .capital-automation-runerrordot { width: 6px; height: 6px; margin-top: 5px; border-radius: 50%; background: var(--ca-warn); flex: none; }
    .capital-automation-runerror[data-severity="error"] .capital-automation-runerrordot { background: var(--ca-error); }
    .capital-automation-runerrormessage { min-width: 0; overflow-wrap: anywhere; }
    .capital-automation-runerrorcode { max-width: 220px; overflow: hidden; color: var(--ca-caption); font-size: 10.5px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
    .capital-automation-notification { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 11px 0; border: 0; border-bottom: .5px solid var(--ca-line); background: transparent; color: inherit; font: inherit; text-align: left; }
    .capital-automation-notification:last-child { border-bottom: 0; }
    .capital-automation-notification[data-clickable="true"] { cursor: pointer; }
    .capital-automation-notification[data-clickable="true"]:hover { color: var(--dsw-alias-label-primary); }
    .capital-automation-notificationicon { display: inline-grid; place-items: center; width: 28px; height: 28px; margin-top: 1px; border-radius: 9px; background: var(--dsw-alias-bg-module-platform); color: var(--ca-muted); flex: none; }
    .capital-automation-notificationicon[data-tone="error"] { color: var(--ca-error-text); }
    .capital-automation-notificationicon[data-tone="warn"] { color: var(--ca-warn-text); }
    .capital-automation-notificationbody { min-width: 0; }
    .capital-automation-notificationtitle { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); font-size: 12.5px; line-height: 19px; font-weight: 500; }
    .capital-automation-notificationmessage { display: -webkit-box; overflow: hidden; margin-top: 2px; color: var(--ca-muted); font-size: 11.5px; line-height: 18px; overflow-wrap: anywhere; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
    .capital-automation-notificationtime { display: block; margin-top: 3px; color: var(--ca-caption); font-size: 11px; line-height: 16px; }
    .capital-automation-systemstatus { margin-top: 22px; padding: 12px 0 4px; border-top: .5px solid var(--ca-line); color: var(--ca-caption); font-size: 11px; line-height: 17px; }
    .capital-automation-systemline { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .capital-automation-systemtoggle { border: 0; padding: 0; background: transparent; color: var(--ca-muted); font: inherit; cursor: pointer; }
    .capital-automation-systemtoggle:hover { color: var(--dsw-alias-label-primary); text-decoration: underline; }
    .capital-automation-systemdetail { margin-top: 6px; color: var(--ca-muted); }
    .capital-automation-systemdetail p { margin: 2px 0; }
    .capital-automation-systemdetail summary { color: var(--ca-caption); cursor: pointer; }
    .capital-automation-modal { width: min(720px, calc(100vw - 32px)); max-width: min(720px, calc(100vw - 32px)); max-height: calc(100dvh - 40px); }
    .capital-automation-modal-wizard { width: min(600px, calc(100vw - 32px)); max-width: min(600px, calc(100vw - 32px)); }
    .capital-automation-modal-content { max-height: calc(100dvh - 128px); overflow: auto; }
    .capital-automation-modal-narrow { width: min(480px, calc(100vw - 32px)); max-width: min(480px, calc(100vw - 32px)); }
    .capital-automation-wizard { display: flex; flex-direction: column; gap: 14px; }
    .capital-automation-modalheadline { display: flex; align-items: center; gap: 10px; }
    .capital-automation-modaltitleinput { flex: 1 1 auto; min-width: 0; height: 42px; padding: 0 12px; border: .5px solid var(--ca-line-soft); border-radius: 12px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font: inherit; font-size: 15px; font-weight: 500; }
    .capital-automation-modaltitleinput:focus-visible { border-color: var(--ca-business); outline: 2px solid color-mix(in srgb, var(--ca-business) 22%, transparent); outline-offset: 0; }
    .capital-automation-modalheadline[data-invalid="true"] .capital-automation-modaltitleinput { border-color: color-mix(in srgb, var(--ca-error) 58%, var(--ca-line-soft)); }
    .capital-automation-formlabel { display: block; margin-bottom: 6px; color: var(--ca-muted); font-size: 11.5px; line-height: 17px; }
    .capital-automation-promptfield { display: flex; flex-direction: column; gap: 5px; }
    .capital-automation-promptfield[data-invalid="true"] .capital-automation-promptbox { border-color: color-mix(in srgb, var(--ca-error) 58%, var(--ca-line)); }
    .capital-automation-promptbox { overflow: hidden; border: .5px solid var(--ca-line); border-radius: 16px; background: var(--dsw-alias-bg-module-platform); }
    .capital-automation-promptbox .capital-automation-texteditor { box-sizing: border-box; width: 100%; height: 120px; min-height: 120px; padding: 13px 14px; border: 0; border-radius: 0; background: transparent; font-size: 13px; line-height: 21px; }
    .capital-automation-promptbox .capital-automation-texteditor:focus-visible { outline: 0; }
    .capital-automation-prompttoolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border-top: .5px solid var(--ca-line); }
    .capital-automation-prompttoolbar label, .capital-automation-toolbarfield { display: inline-flex; align-items: center; gap: 5px; color: var(--ca-muted); font-size: 11.5px; }
    .capital-automation-prompttoolbar .capital-automation-select { max-width: 168px; background: var(--ca-card); }
    .capital-automation-prompttoolbar .capital-automation-presetchip { margin-left: auto; }
    .capital-automation-presetchip { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border-radius: 999px; background: color-mix(in srgb, var(--ca-business) 12%, var(--ca-card)); color: var(--ca-business-text); font-size: 11px; font-weight: 500; white-space: nowrap; }
    .capital-automation-checklist { display: flex; flex-direction: column; gap: 2px; }
    .capital-automation-technical { margin-top: 14px; padding-top: 12px; border-top: .5px solid var(--ca-line); color: var(--ca-caption); font-size: 11px; line-height: 17px; }
    .capital-automation-technicaltitle { margin: 0 0 7px; color: var(--ca-muted); font-size: 11.5px; line-height: 17px; font-weight: 500; }
    .capital-automation-technical dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; }
    .capital-automation-technical dt { color: var(--ca-caption); }
    .capital-automation-technical dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--ca-muted); }
    .capital-automation-page :focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: 2px; }
    .capital-automation-trowmain:focus-visible, .capital-automation-template .capital-automation-btn:focus-visible { outline-offset: 2px; }
    @media (max-width: 1000px) {
      .capital-automation-theadmain, .capital-automation-trowmain { grid-template-columns: minmax(0, 1.7fr) minmax(110px, .9fr) 88px; }
      .capital-automation-theadmain > :nth-child(3), .capital-automation-cell[data-cell="next"] { display: none; }
      .capital-automation-statgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 960px) {
      .capital-automation-instructionrow { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 760px) {
      .capital-automation-head { padding-top: 14px; }
      .capital-automation-topbar { display: flex; flex-wrap: wrap; gap: 10px; }
      .capital-automation-brand { flex: 1 1 auto; }
      .capital-automation-tabs { order: 3; width: 100%; max-width: 320px; margin: 0 auto; justify-content: center; }
      .capital-automation-topactions { margin-left: auto; }
      .capital-automation-theadmain, .capital-automation-trowmain { grid-template-columns: minmax(0, 1fr) 80px; gap: 10px; }
      .capital-automation-theadmain > :nth-child(2), .capital-automation-theadmain > :nth-child(3), .capital-automation-cell[data-cell="schedule"], .capital-automation-cell[data-cell="next"] { display: none; }
      .capital-automation-tasktitlerow .capital-automation-tasktags { gap: 3px; }
      .capital-automation-tasktitlerow .capital-automation-tag { padding: 0 5px; font-size: 10px; line-height: 16px; }
      .capital-automation-hero { flex-wrap: wrap; }
      .capital-automation-heroactions { width: 100%; padding-left: 58px; }
      .capital-automation-runhead { grid-template-columns: minmax(0, 1fr); }
      .capital-automation-runactions { justify-content: flex-start; }
      .capital-automation-templates { grid-template-columns: 1fr; }
      .capital-automation-sectiontools { width: 100%; margin-left: 0; }
    }
    @media (max-width: 560px) {
      .capital-automation-triggerhead { flex-wrap: wrap; gap: 10px 12px; }
      .capital-automation-triggerhead > .capital-automation-triggerfield:first-child { flex: 1 1 100%; flex-wrap: wrap; }
      .capital-automation-triggerdetail { flex: 1 1 100%; }
      .capital-automation-triggerhead > .capital-automation-triggerfield:last-child { flex: 1 1 100%; justify-content: flex-start; }
      .capital-automation-monthpick [role="menu"] [role="menu"] { right: auto; left: 0; }
    }
    @media (max-width: 520px) {
      .capital-automation-brand h1 { font-size: 16px; }
      .capital-automation-titlerow { grid-template-columns: minmax(0, 1fr); }
      .capital-automation-topactions .capital-automation-btn:not([data-variant="contrast"]) { width: auto; min-width: 32px; padding: 0 8px; }
      .capital-automation-topactions .capital-automation-btn[data-variant="contrast"] { width: 32px; padding: 0; }
      .capital-automation-topactions .capital-automation-btn .capital-automation-btnlabel { display: none; }
      .capital-automation-statgrid { grid-template-columns: 1fr; }
      .capital-automation-heroactions { padding-left: 0; }
      .capital-automation-modal-content { max-height: calc(100dvh - 112px); }
    }

    .capital-automation-board { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .capital-automation-boardtoolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
    .capital-automation-boardtools { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
    .capital-automation-boardactions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-left: auto; }
    .capital-automation-boardstats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
    .capital-automation-boardstat { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-height: 62px; padding: 10px 12px; border: .5px solid var(--ca-line); border-radius: 12px; background: var(--ca-card); color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background .15s, border-color .15s; }
    .capital-automation-boardstat:hover { background: color-mix(in srgb, var(--ca-hover) 58%, var(--ca-card)); border-color: color-mix(in srgb, var(--ca-business) 24%, var(--ca-line)); }
    .capital-automation-boardstat:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: 1px; }
    .capital-automation-boardstatlabel { color: var(--ca-muted); font-size: 11.5px; line-height: 17px; }
    .capital-automation-boardstat strong { color: var(--dsw-alias-label-primary); font-size: 18px; line-height: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .capital-automation-boardgrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 340px); align-items: start; gap: 20px; min-width: 0; }
    .capital-automation-boardgrid[data-rail="closed"] { grid-template-columns: minmax(0, 1fr); }
    .capital-automation-boardmain { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .capital-automation-briefcard { box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; padding: 16px 18px 13px; border: .5px solid var(--ca-line); border-radius: 16px; background: var(--ca-card); min-width: 0; }
    .capital-automation-briefhead { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 8px 14px; }
    .capital-automation-brieftitle { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 7px; min-width: 0; }
    .capital-automation-brieftitle h3 { margin: 0; color: var(--dsw-alias-label-primary); font-size: 13.5px; line-height: 20px; font-weight: 600; overflow-wrap: anywhere; }
    .capital-automation-brieftime { color: var(--ca-caption); font-size: 11.5px; line-height: 18px; font-variant-numeric: tabular-nums; }
    .capital-automation-briefcard h4 { margin: 0; color: var(--dsw-alias-label-primary); font-size: 18px; line-height: 27px; font-weight: 600; letter-spacing: .1px; overflow-wrap: anywhere; }
    .capital-automation-briefbody { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
    .capital-automation-brieftext { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 1.68; overflow-wrap: anywhere; }
    .capital-automation-briefstate { display: flex; flex-direction: column; gap: 7px; color: var(--ca-muted); font-size: 12.5px; line-height: 19px; }
    .capital-automation-briefheadactions { display: flex; align-items: center; gap: 6px; }
    .capital-automation-askdock { display: flex; flex-direction: column; gap: 8px; min-width: 0; margin-top: 1px; padding-top: 10px; border-top: .5px solid var(--ca-line); }
    .capital-automation-askinput { box-sizing: border-box; flex: 1 1 auto; min-width: 0; height: 34px; padding: 0 11px; border: .5px solid var(--ca-line-soft); border-radius: 10px; background: var(--ca-field); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; line-height: 20px; outline: 0; }
    .capital-automation-askinput::placeholder { color: var(--ca-caption); }
    .capital-automation-askinput:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: 1px; }
    .capital-automation-askinput:disabled { opacity: .62; cursor: not-allowed; }
    .capital-automation-askthread { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .capital-automation-askuser { display: block; align-self: flex-end; max-width: min(100%, 620px); padding: 7px 10px; border: .5px solid color-mix(in srgb, var(--ca-business) 26%, var(--ca-line-soft)); border-radius: 12px 12px 4px 12px; background: color-mix(in srgb, var(--ca-business) 11%, var(--ca-field)); }
    .capital-automation-askquestion { margin: 0; color: var(--dsw-alias-label-primary); font-size: 12.5px; line-height: 18px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
    .capital-automation-askreply { display: flex; flex-direction: column; gap: 5px; align-self: stretch; padding: 8px 10px; border: .5px solid var(--ca-line); border-left: 2px solid var(--ca-business); border-radius: 4px 12px 12px 12px; background: var(--ca-field); }
    .capital-automation-askreply[data-status="failed"] { border-left-color: var(--ca-error); }
    .capital-automation-askpreview { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
    .capital-automation-askfull { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .capital-automation-askhint { margin: 0; color: var(--ca-muted); font-size: 12px; line-height: 19px; }
    .capital-automation-askaction { align-self: flex-end; margin-top: 1px; }
    .capital-automation-askaction[data-expanded="true"] { color: var(--ca-muted); }
    .capital-automation-askerror { margin: 0; color: var(--ca-error-text); font-size: 11.5px; line-height: 18px; overflow-wrap: anywhere; }
    .capital-automation-modal-chat { width: min(640px, calc(100vw - 32px)); max-width: min(640px, calc(100vw - 32px)); }
    .capital-automation-chatshell { display: flex; flex-direction: column; height: min(640px, calc(100dvh - 40px)); max-height: calc(100dvh - 40px); min-height: 360px; overflow: hidden; border-radius: 16px; background: var(--ca-card); }
    .capital-automation-chathead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px 6px; }
    .capital-automation-chaticonbtn { display: grid; flex: none; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
    .capital-automation-chaticonbtn:hover { background: var(--ca-hover); }
    .capital-automation-chaticonbtn:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: 1px; }
    .capital-automation-chatscroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 2px 18px 12px; }
    .capital-automation-chatcontext { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 10px; padding: 8px 0 14px; }
    .capital-automation-chatcontextbody { min-width: 0; }
    .capital-automation-chatcontexthead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
    .capital-automation-chatcontexthead strong { color: var(--dsw-alias-label-primary); font-size: 13.5px; line-height: 20px; font-weight: 600; }
    .capital-automation-chatcontextmeta { color: var(--ca-caption); font-size: 11.5px; line-height: 18px; }
    .capital-automation-chatcontext h3 { margin: 5px 0 0; color: var(--dsw-alias-label-primary); font-size: 16px; line-height: 24px; font-weight: 600; letter-spacing: .1px; overflow-wrap: anywhere; }
    .capital-automation-chatcontexttext { margin: 5px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .capital-automation-chatthread { margin-left: 18px; padding: 12px 0 4px 30px; border-left: 2px solid var(--ca-line); }
    .capital-automation-chatempty { margin-left: 18px; padding: 12px 0 4px 30px; border-left: 2px solid var(--ca-line); }
    .capital-automation-chatempty p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
    .capital-automation-chatcomposer { display: flex; align-items: center; gap: 8px; padding: 10px 16px 14px; border-top: .5px solid var(--ca-line); }
    .capital-automation-chatcomposer .capital-automation-askinput { height: 38px; }
    .capital-automation-chatsend { flex: none; height: 36px; padding: 0 16px; font-weight: 600; }
    .capital-automation-chaterror { padding: 8px 0 0; }
    .capital-automation-briefstate[data-tone="error"] { color: var(--ca-error-text); }
    .capital-automation-briefstate p { margin: 0; }
    .capital-automation-briefactions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 2px; }
    .capital-automation-boardrail { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .capital-automation-boardrail[hidden] { display: none; }
    .capital-automation-boardrail .capital-automation-panel { min-width: 0; }
    .capital-automation-boardrail .capital-automation-panelhead { margin-bottom: 8px; }
    .capital-automation-boardrail .capital-automation-panel[data-collapsed="true"] { padding-bottom: 13px; }
    .capital-automation-boardrail .capital-automation-panel[data-collapsed="true"] .capital-automation-panelhead { margin-bottom: 0; }
    .capital-automation-paneltoggle { display: inline-flex; align-items: center; gap: 6px; margin: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .capital-automation-paneltoggle:hover { color: var(--dsw-alias-label-primary); }
    .capital-automation-paneltoggle:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: 3px; border-radius: 4px; }
    .capital-automation-panelchevron { flex: none; color: var(--ca-caption); transition: transform .15s; }
    .capital-automation-panelchevron[data-open="false"] { transform: rotate(-90deg); }
    .capital-automation-panelbody[hidden] { display: none; }
    .capital-automation-boardempty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; min-height: min(440px, calc(100dvh - 260px)); padding: 44px 24px; border: .5px dashed var(--ca-line); border-radius: 20px; background: var(--ca-card); color: var(--ca-muted); text-align: center; }
    .capital-automation-boardemptyicon { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 14px; background: color-mix(in srgb, var(--ca-business) 12%, var(--ca-card)); color: var(--ca-business-text); }
    .capital-automation-boardempty h2 { margin: 3px 0 0; color: var(--dsw-alias-label-primary); font-size: 20px; line-height: 28px; font-weight: 600; }
    .capital-automation-boardempty p { max-width: 520px; margin: 0; font-size: 13px; line-height: 20px; }
    .capital-automation-boardemptyhint { color: var(--ca-caption); font-size: 11.5px !important; line-height: 18px !important; }
    .capital-automation-boardemptyactions { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; margin-top: 6px; }
    .capital-automation-todolist, .capital-automation-stocktodos, .capital-automation-gaplist, .capital-automation-gaprow { list-style: none; margin: 0; padding: 0; }
    .capital-automation-todoitem { padding: 8px 0; border-top: .5px solid var(--ca-line); }
    .capital-automation-todoitem:first-child { border-top: 0; }
    .capital-automation-todoline { display: flex; flex-direction: column; align-items: stretch; gap: 5px; min-width: 0; }
    .capital-automation-todotop { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
    .capital-automation-todokind { display: inline-flex; flex: none; align-items: center; justify-content: center; min-height: 20px; padding: 0 5px; border-radius: 5px; background: var(--dsw-alias-bg-module-platform); color: var(--ca-muted); font-size: 10px; line-height: 20px; white-space: nowrap; }
    .capital-automation-todokind[data-kind="confirm"] { color: var(--ca-warn-text); }
    .capital-automation-todokind[data-kind="verify"] { color: var(--ca-business-text); }
    .capital-automation-todokind[data-kind="track"] { color: var(--ca-success-text); }
    .capital-automation-todotitle { flex: none; width: 100%; min-width: 0; padding: 0; border: 0; background: transparent; font: inherit; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; font-weight: 600; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
    .capital-automation-todotitle:hover, .capital-automation-gaptitle:hover { color: var(--ca-business-text); }
    .capital-automation-todotitle:focus-visible, .capital-automation-gaptitle:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: 2px; border-radius: 4px; }
    .capital-automation-basiscaret { display: inline-flex; align-items: center; margin-left: 4px; color: var(--ca-muted); vertical-align: -2px; transform: rotate(-90deg); transition: transform .16s ease; }
    .capital-automation-todotitle[aria-expanded="true"] .capital-automation-basiscaret, .capital-automation-gaptitle[aria-expanded="true"] .capital-automation-basiscaret { transform: rotate(0deg); }
    .capital-automation-tododesc { margin: 3px 0 0; color: var(--ca-muted); font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }
    .capital-automation-todometa { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 3px; color: var(--ca-caption); font-size: 11px; line-height: 17px; }
    .capital-automation-tododetail { margin: 6px 0 0; padding: 7px 9px; border-left: 2px solid var(--ca-line); background: var(--ca-field); border-radius: 0 7px 7px 0; }
    .capital-automation-tododetail blockquote { margin: 0; color: var(--ca-muted); font-size: 11.5px; line-height: 19px; overflow-wrap: anywhere; }
    .capital-automation-todosource { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 5px 8px; margin-top: 5px; color: var(--ca-caption); font-size: 11px; line-height: 17px; }
    .capital-automation-stockrow { border-top: .5px solid var(--ca-line); }
    .capital-automation-stockrow:first-of-type { border-top: 0; }
    .capital-automation-stockmain { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 7px; width: 100%; padding: 8px 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .capital-automation-stockmain:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ca-business)); outline-offset: -2px; }
    .capital-automation-stockname { color: var(--dsw-alias-label-primary); font-size: 12.5px; line-height: 19px; font-weight: 600; }
    .capital-automation-stockcode { color: var(--ca-caption); font-size: 11px; line-height: 17px; }
    .capital-automation-stockroles { display: inline-flex; flex-wrap: wrap; gap: 3px; }
    .capital-automation-stockrole { display: inline-flex; align-items: center; padding: 0 5px; border-radius: 4px; background: var(--dsw-alias-bg-module-platform); color: var(--ca-muted); font-size: 10px; line-height: 17px; }
    .capital-automation-stockrole[data-role="holding"] { color: var(--ca-success-text); }
    .capital-automation-stockrole[data-role="risk"] { color: var(--ca-error-text); }
    .capital-automation-stockrole[data-role="event"] { color: var(--ca-warn-text); }
    .capital-automation-stocknote { flex: 1 1 100%; color: var(--ca-muted); font-size: 12px; line-height: 19px; overflow-wrap: anywhere; }
    .capital-automation-stockmeta { display: flex; flex-wrap: wrap; gap: 4px 9px; color: var(--ca-caption); font-size: 11px; line-height: 17px; }
    .capital-automation-stocktodos { margin: 0 0 7px; padding: 0 0 0 8px; border-left: 2px solid var(--ca-line); }
    .capital-automation-stocktodos li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 8px; padding: 3px 0; color: var(--ca-muted); font-size: 11.5px; line-height: 18px; }
    .capital-automation-gaprow { padding: 8px 0; border-top: .5px solid var(--ca-line); }
    .capital-automation-gaprow:first-child { border-top: 0; }
    .capital-automation-gaphead { display: flex; align-items: flex-start; gap: 6px; min-width: 0; }
    .capital-automation-gapkind { display: inline-flex; flex: none; align-items: center; justify-content: center; min-height: 20px; padding: 0 5px; border-radius: 5px; background: var(--dsw-alias-bg-module-platform); color: var(--ca-muted); font-size: 10px; line-height: 20px; white-space: nowrap; }
    .capital-automation-gapkind[data-kind="capability"] { color: var(--ca-warn-text); }
    .capital-automation-gapkind[data-kind="conflict"] { color: var(--ca-error-text); }
    .capital-automation-gapkind[data-kind="quality"] { color: var(--ca-warn-text); }
    .capital-automation-gaptitle { flex: 1 1 auto; min-width: 0; padding: 0; border: 0; background: transparent; font: inherit; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; font-weight: 600; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
    .capital-automation-gapdesc { margin: 3px 0 0; color: var(--ca-muted); font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }
    .capital-automation-healthgrid { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 10px; align-items: baseline; }
    .capital-automation-healthkey { color: var(--ca-caption); font-size: 11.5px; line-height: 19px; }
    .capital-automation-healthval { color: var(--dsw-alias-label-primary); font-size: 12.5px; line-height: 19px; overflow-wrap: anywhere; }
    .capital-automation-healthval[data-tone="warn"] { color: var(--ca-warn-text); }
    .capital-automation-healthval[data-tone="bad"] { color: var(--ca-error-text); }
    .capital-automation-healthempty { margin: 9px 0 0; color: var(--ca-muted); font-size: 12px; line-height: 19px; }
    .capital-automation-healthissues { list-style: none; margin: 10px 0 0; padding: 0; border-top: .5px solid var(--ca-line); }
    .capital-automation-healthissues li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 8px; padding: 7px 0; border-bottom: .5px solid var(--ca-line); color: var(--ca-muted); font-size: 12px; line-height: 19px; }
    .capital-automation-healthissues li:last-child { border-bottom: 0; }
    .capital-automation-healthissue { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; }
    .capital-automation-healthissuetitle { color: var(--dsw-alias-label-primary); font-size: 12.5px; line-height: 19px; font-weight: 600; }
    .capital-automation-healthissuestatus { font-size: 11px; line-height: 17px; }
    .capital-automation-healthissuestatus[data-tone="bad"], .capital-automation-statusdot[data-tone="bad"] { color: var(--ca-error-text); }
    .capital-automation-healthissuestatus[data-tone="warn"], .capital-automation-statusdot[data-tone="warn"] { color: var(--ca-warn-text); }
    .capital-automation-healthrecovered { color: var(--ca-success-text); font-size: 11px; line-height: 17px; }
    .capital-automation-board .capital-automation-tag { font-size: 10px; line-height: 16px; }
    .capital-automation-boardmore { align-self: center; margin: 2px 0 6px; }
    @media (max-width: 860px) {
      .capital-automation-boardgrid { grid-template-columns: minmax(0, 1fr); gap: 14px; }
      .capital-automation-boardrail { order: 2; }
      .capital-automation-boardstats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 560px) {
      .capital-automation-boardtoolbar { align-items: flex-start; }
      .capital-automation-boardstats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .capital-automation-boardempty { min-height: 320px; padding: 32px 16px; }
      .capital-automation-briefcard { padding: 14px 14px 12px; }
      .capital-automation-briefcard h4 { font-size: 17px; line-height: 25px; }
    }
  `
  document.head.appendChild(style)
  return () => style.remove()
}

const BOARD_SNAPSHOT_MAX_AGE_MS = 30 * 60_000
let boardSnapshot = null
let warmStarted = false
let lastBoardFetchAt = 0
let lastClickAt = 0

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  // Capture fires before any panel handler, so the page can report click → mount (shell cost).
  document.addEventListener('click', () => {
    lastClickAt = typeof performance === 'undefined' ? Date.now() : performance.now()
  }, true)
}

function readBoardSnapshot(query) {
  if (boardSnapshot === null || boardSnapshot.query !== query) return null
  if (Date.now() - boardSnapshot.at > BOARD_SNAPSHOT_MAX_AGE_MS) return null
  return boardSnapshot.value
}

function writeBoardSnapshot(query, value) {
  // Entry always starts at the default view; a filtered board must not evict its snapshot.
  if (query !== boardQueryOf('14', 'all', null)) return
  boardSnapshot = { query, at: Date.now(), value }
}

function createApi() {
  async function request(path, options = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined
    const timeout = setTimeout(() => controller?.abort(), options.timeoutMs ?? 20_000)
    let response
    let payload
    try {
      response = await fetch(`${ROUTE}${path}`, {
        method: options.method ?? 'GET',
        credentials: 'same-origin',
        headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        ...(options.keepalive === true ? { keepalive: true } : {}),
        ...(controller === undefined ? {} : { signal: controller.signal }),
      })
      try {
        payload = await response.json()
      } catch {
        throw new Error(zh.errorGeneric)
      }
    } finally {
      clearTimeout(timeout)
    }
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.message ?? zh.errorGeneric)
      error.code = payload?.code
      throw error
    }
    return payload
  }

  /**
   * Boot-time idle prefetch: it only seeds the snapshot. The page still fetches a fresh board
   * on open, so a snapshot is never mistaken for a revalidated payload.
   */
  async function warm() {
    if (warmStarted) return
    const query = boardQueryOf('14', 'all', null)
    if (readBoardSnapshot(query) !== null) return
    if (Date.now() - lastBoardFetchAt < 10_000) return
    warmStarted = true
    lastBoardFetchAt = Date.now()
    try {
      writeBoardSnapshot(query, await request(`/board${query}`))
    } catch {
      warmStarted = false
    }
  }

  return {
    meta: () => request('/meta'),
    tasks: () => request('/tasks'),
    detail: (id) => request(`/tasks/${encodeURIComponent(id)}`),
    create: (body) => request('/tasks', { method: 'POST', body }),
    patch: (id, body) => request(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body, keepalive: true }),
    remove: (id) => request(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    action: (id, action) => request(`/tasks/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
    run: (id) => request(`/tasks/${encodeURIComponent(id)}/run`, { method: 'POST' }),
    cancel: (id) => request(`/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
    runs: (query = '') => request(`/runs${query}`),
    history: (query = '') => request(`/runs/history${query}`),
    board: (query = '') => {
      lastBoardFetchAt = Date.now()
      return request(`/board${query}`)
    },
    warm,
    confirmTodo: (id) => request('/board/todos/confirm', { method: 'POST', body: { id } }),
    retryBrief: (runId) => request(`/board/briefs/${encodeURIComponent(runId)}/retry`, { method: 'POST' }),
    askBrief: (runId, question, timeZone) => request(`/board/briefs/${encodeURIComponent(runId)}/ask`, {
      method: 'POST',
      body: { question, timeZone },
      timeoutMs: 60_000,
    }),
    askStatus: (askId) => request(`/board/asks/${encodeURIComponent(askId)}`),
    askAnswer: (askId) => request(`/board/asks/${encodeURIComponent(askId)}/answer`),
    notifications: () => request('/notifications'),
    markRead: (body) => request('/notifications/read', { method: 'POST', body }),
  }
}

function statusLabel(status) {
  return zh.status[status] ?? status
}

function stateLabel(state) {
  return zh.state[state] ?? state
}

function activationLabel(task) {
  if (task?.state === 'active') return zh.pause
  return task?.state === 'dormant' ? zh.add : zh.activate
}

function activationIcon(task) {
  if (task?.state === 'active') return IconPauseOutlineRegular
  return task?.state === 'dormant' ? IconPlusOutlineRegular : IconPlayOutlineRegular
}

function activationNotice(task) {
  return (task?.state === 'dormant' ? zh.added : zh.activated).replace('{title}', task?.title ?? '')
}

function categoryLabel(category) {
  return zh.category[category] ?? category
}

function clipTagLabel(label, limit = 12) {
  const text = String(label ?? '')
  const chars = Array.from(text)
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : text
}

function calendarLabel(calendar) {
  if (calendar === null || calendar === undefined || calendar.available === false) return zh.calendarSourceNone
  const source = calendar.source === 'szse'
    ? zh.calendarSourceSzse
    : calendar.source === 'bundled' ? zh.calendarSourceBundled : zh.calendarSourceNone
  const through = calendar.through ?? zh.calendarUnknown
  return `${source} · ${zh.calendarThrough.replace('{date}', through)}`
}

function isActiveRun(run) {
  return run !== null && run !== undefined && ACTIVE_RUN_STATUSES.includes(run.status)
}

function isFailureStatus(status) {
  return FAILURE_RUN_STATUSES.includes(status)
}

function toneOf(task) {
  return task?.origin === 'custom' ? 'custom' : (task?.category ?? 'news')
}

// Twelve templates cannot stay in record-id order: read them daily → weekly → monthly, then by
// day and wall-clock time, so the card grid matches how the user plans the week.
const CADENCE_RANK = { daily: 0, weekly: 1, monthly: 2, once: 3 }
function firstWeekday(trigger) {
  const days = Array.isArray(trigger?.weekdays) ? trigger.weekdays : []
  return days.length === 0 ? 0 : Math.min(...days)
}
function compareTemplates(left, right) {
  const rank = (CADENCE_RANK[left.trigger?.cadence] ?? 9) - (CADENCE_RANK[right.trigger?.cadence] ?? 9)
  if (rank !== 0) return rank
  const day = firstWeekday(left.trigger) - firstWeekday(right.trigger)
  if (day !== 0) return day
  return String(left.trigger?.time ?? '').localeCompare(String(right.trigger?.time ?? ''))
    || String(left.title).localeCompare(String(right.title))
}

function iconDefinition(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(TASK_ICON_CATALOG, id)
    ? TASK_ICON_CATALOG[id]
    : undefined
}

function taskIcon(task) {
  return iconDefinition(taskIconId(task)) ?? TASK_ICON_CATALOG[DEFAULT_CUSTOM_ICON]
}

// Tabler glyphs are a 24 grid with 2px strokes; the tile supplies size and color so one drawing
// works on every category tone.
function TaskGlyph(props) {
  const { task, size } = props
  const icon = taskIcon(task)
  return h('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, h('path', { d: icon.d }))
}

function Glyph(props) {
  const { task, size = 34, large = false, radius, glyphSize } = props
  const edge = large ? 44 : size
  return h('span', {
    className: 'capital-automation-glyph',
    'data-tone': toneOf(task),
    style: { width: edge, height: edge, borderRadius: radius ?? (large ? 13 : 10) },
  }, h(TaskGlyph, { task, size: glyphSize ?? (large ? 22 : 17) }))
}

function IconPickerTrigger(props) {
  const { task, size = 38, large = false, onChange, disabled } = props
  const [open, setOpen] = useState(false)
  const selectedId = taskIconId(task)
  const selected = iconDefinition(selectedId) ?? TASK_ICON_CATALOG[DEFAULT_CUSTOM_ICON]
  useEffect(() => {
    if (disabled === true && open) setOpen(false)
  }, [disabled, open])
  // The host Menu owns the portal, outside-click, Escape and button walk; the grid is only content.
  return h(Menu, {
    open,
    anchor: h('button', {
      type: 'button',
      className: 'capital-automation-glyphbtn',
      disabled,
      'aria-label': `${zh.iconField}：${selected.label}，点击更换`,
      'aria-haspopup': 'menu',
      'aria-expanded': open ? 'true' : 'false',
      title: zh.iconPickHint,
      onClick: () => setOpen((current) => !current),
    },
    h(Glyph, { task, size, large }),
    h('span', { className: 'capital-automation-glyphbtnchevron', 'aria-hidden': 'true' },
      h(IconChevronDownOutlineRegular, { size: 12 }))),
    items: [],
    onClose: () => setOpen(false),
    align: 'start',
    side: 'bottom',
    portal: true,
    listClassName: 'capital-automation-iconmenu',
  }, h('div', { className: 'capital-automation-iconmenu-grid' },
    TASK_ICON_IDS.map((id) => {
      const icon = TASK_ICON_CATALOG[id]
      const active = id === selectedId
      return h('button', {
        key: id,
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': active ? 'true' : 'false',
        'aria-label': icon.label,
        title: icon.label,
        className: 'capital-automation-iconmenu-item',
        'data-selected': active ? 'true' : undefined,
        onClick: () => { onChange(id); setOpen(false) },
      }, h('svg', {
        viewBox: '0 0 24 24',
        width: 18,
        height: 18,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }, h('path', { d: icon.d })))
    })))
}

function StateBadge(props) {
  const { state, running } = props
  const label = running ? zh.status.running : stateLabel(state)
  const value = running ? 'running' : state
  return h('span', { className: 'capital-automation-state', 'data-state': value },
    h('span', { className: 'capital-automation-statedot' }),
    label)
}

const TIME_FORMATTERS = new Map()
const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

function formatTime(value, options = {}) {
  if (typeof value !== 'string' || value.length === 0) return zh.never
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const key = `${options.short === true ? 'short' : 'full'}|${options.timeZone ?? ''}`
  let formatter = TIME_FORMATTERS.get(key)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('zh-CN', {
      year: options.short === true ? undefined : 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      ...(typeof options.timeZone === 'string' && options.timeZone.length > 0 ? { timeZone: options.timeZone } : {}),
    })
    TIME_FORMATTERS.set(key, formatter)
  }
  return formatter.format(date)
}

function formatShortTime(value, timeZone) {
  return formatTime(value, { short: true, timeZone })
}

function formatDuration(ms) {
  if (typeof ms !== 'number' || ms < 0) return zh.never
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function formatRelative(value) {
  if (typeof value !== 'string' || value.length === 0) return ''
  const target = Date.parse(value)
  if (Number.isNaN(target)) return ''
  const diff = target - Date.now()
  const abs = Math.abs(diff)
  if (abs < 45_000) return zh.relativeNow
  const units = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
  ]
  const formatter = RELATIVE_TIME_FORMAT
  for (const [unitMs, unit] of units) {
    if (abs >= unitMs || unit === 'minute') return formatter.format(Math.round(diff / unitMs), unit)
  }
  return ''
}

function weekdayText(trigger) {
  return (trigger.weekdays ?? []).slice().sort((left, right) => left - right)
    .map((day) => WEEKDAYS.find((item) => item.value === day)?.label ?? '')
    .join('、')
}

function monthlySummary(trigger) {
  if (trigger.dayOfMonth === 'last') return '每月最后一天'
  return `每月 ${trigger.dayOfMonth ?? 1} 日`
}

function scheduleSummary(trigger) {
  if (trigger === null || trigger === undefined) return zh.never
  const suffix = trigger.tradingDaysOnly === true ? zh.tradingSuffix : ''
  if (trigger.cadence === 'weekly') return `${zh.weeklyPrefix}${weekdayText(trigger)} ${trigger.time}${suffix}`
  if (trigger.cadence === 'monthly') return `${monthlySummary(trigger)} ${trigger.time}${suffix}`
  if (trigger.cadence === 'once') return `${formatDateLabel(trigger.date)} ${trigger.time}${suffix}`
  return `${zh.dailyPrefix} ${trigger.time}${suffix}`
}

function scheduleRangeSummary(trigger) {
  if (trigger?.cadence === 'weekly') return `${zh.weeklyPrefix}${weekdayText(trigger)}`
  if (trigger?.cadence === 'monthly') return monthlySummary(trigger)
  if (trigger?.cadence === 'once') return formatDateLabel(trigger.date)
  return zh.dailyPrefix
}

// Dormant/paused tasks still carry a computed nextRunLocal, but that instant will not fire until
// the task is activated; don't present it as a pending schedule.
function nextRunView(task) {
  if (task?.state === 'dormant') return { value: zh.nextRunDormant, sub: zh.notScheduled }
  if (task?.state === 'paused') return { value: zh.nextRunPaused, sub: zh.notScheduled }
  if (task?.trigger?.cadence === 'once' && !task.nextRunAt && task.nextRunUnavailable !== true) {
    return onceHasPassed(task.trigger)
      ? { value: zh.onceEnded, sub: zh.onceEndedHint }
      : { value: zh.onceSkipped, sub: zh.onceSkippedHint }
  }
  const value = task?.nextRunLocal ?? (task?.nextRunUnavailable ? zh.calendarUnavailable : zh.never)
  const sub = task?.nextRunAt ? formatRelative(task.nextRunAt) : (task?.nextRunUnavailable ? zh.nextRunUnavailable : zh.never)
  return { value, sub }
}

function lastRunView(run, timeZone) {
  if (run === null || run === undefined) return { value: zh.neverRun, sub: zh.lastRunEmpty }
  const active = isActiveRun(run)
  const parts = [formatShortTime(run.queuedAt, timeZone)]
  if (!active && typeof run.durationMs === 'number') parts.push(formatDuration(run.durationMs))
  const errors = Array.isArray(run.errors) ? run.errors.length : 0
  if (errors > 0) parts.push(zh.runErrors.replace('{n}', String(errors)))
  let tone
  if (run.status === 'succeeded') tone = 'ok'
  else if (isFailureStatus(run.status)) tone = 'error'
  else if (active) tone = 'running'
  else if (SKIPPED_RUN_STATUSES.includes(run.status)) tone = 'warn'
  return { value: statusLabel(run.status), sub: parts.filter(Boolean).join(' · '), tone }
}

function workspaceOptions(meta, current) {
  const options = [{ id: '', title: zh.workspaceDefault }]
  const list = Array.isArray(meta?.workspaces) ? meta.workspaces : []
  for (const item of list) {
    if (typeof item?.id !== 'string' || item.id.length === 0) continue
    options.push({ id: item.id, title: item.default === true ? `${item.title}（默认）` : item.title })
  }
  if (typeof current === 'string' && current.length > 0 && !options.some((item) => item.id === current)) {
    options.push({ id: current, title: zh.workspaceMissing })
  }
  return options
}

function workspaceTitle(meta, id) {
  if (typeof id !== 'string' || id.length === 0) return zh.workspaceDefault
  return workspaceOptions(meta, id).find((item) => item.id === id)?.title ?? zh.workspaceMissing
}

function timezoneOptions(current) {
  const zone = String(current ?? '').trim()
  const zones = zone.length > 0 && !TIMEZONES.includes(zone) ? [zone, ...TIMEZONES] : TIMEZONES
  return zones.map((value) => ({ value, label: value }))
}

function dateStringFromParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.toISOString().slice(0, 10)
}

function zonedToday(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const read = (type) => Number(parts.find((part) => part.type === type)?.value)
    return dateStringFromParts(read('year'), read('month'), read('day'))
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function tomorrowInZone(timeZone) {
  const [year, month, day] = zonedToday(timeZone).split('-').map(Number)
  return dateStringFromParts(year, month, day + 1)
}

function nextWeekdayOnOrAfter(value) {
  let current = value
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const weekday = new Date(`${current}T00:00:00Z`).getUTCDay()
    if (weekday !== 0 && weekday !== 6) return current
    const [year, month, day] = current.split('-').map(Number)
    current = dateStringFromParts(year, month, day + 1)
  }
  return current
}

/** A default single-run date must not land on a weekend while trading-only is on. */
function defaultOnceDate(timeZone, tradingDaysOnly) {
  const tomorrow = tomorrowInZone(timeZone)
  return tradingDaysOnly === true ? nextWeekdayOnOrAfter(tomorrow) : tomorrow
}

function zonedNowParts(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date())
    const read = (type) => Number(parts.find((part) => part.type === type)?.value)
    return {
      date: dateStringFromParts(read('year'), read('month'), read('day')),
      minutes: read('hour') * 60 + read('minute'),
    }
  } catch {
    const now = new Date()
    return { date: now.toISOString().slice(0, 10), minutes: now.getUTCHours() * 60 + now.getUTCMinutes() }
  }
}

/** Distinguishes an expired single run from a future date that the calendar will skip. */
function onceHasPassed(trigger) {
  if (trigger?.cadence !== 'once' || !isValidDateInput(trigger.date)) return false
  const now = zonedNowParts(trigger.timezone)
  if (trigger.date !== now.date) return trigger.date < now.date
  const [hour, minute] = String(trigger.time ?? '').split(':').map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false
  return now.minutes >= hour * 60 + minute
}

function isValidDateInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function formatDateLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (match === null) return String(value ?? '')
  return `${Number(match[1])} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`
}

function normalizeTrigger(trigger) {
  const cadence = Object.prototype.hasOwnProperty.call(zh.cadence, trigger?.cadence) ? trigger.cadence : 'daily'
  const next = {
    kind: 'schedule',
    cadence,
    time: trigger?.time ?? '09:00',
    timezone: trigger?.timezone ?? 'Asia/Shanghai',
    tradingDaysOnly: trigger?.tradingDaysOnly === true,
  }
  if (next.cadence === 'weekly') next.weekdays = (trigger?.weekdays ?? [1, 3, 5]).slice().sort((left, right) => left - right)
  if (next.cadence === 'monthly') {
    const day = trigger?.dayOfMonth
    next.dayOfMonth = day === 'last' || (Number.isInteger(day) && day >= 1 && day <= 31) ? day : 1
  }
  if (next.cadence === 'once') {
    next.date = typeof trigger?.date === 'string' ? trigger.date : defaultOnceDate(next.timezone, next.tradingDaysOnly)
  }
  return next
}

function triggerChanged(cadence, trigger) {
  const next = normalizeTrigger({ ...trigger, cadence })
  if (cadence === 'weekly' && (next.weekdays ?? []).length === 0) next.weekdays = [1, 3, 5]
  return next
}

/** New-task limits start from the settings card; leaving them untouched keeps the task inherited. */
function defaultLimits(meta) {
  const settings = meta?.execution?.settings
  return {
    runTimeoutMinutes: settings?.runTimeoutMinutes ?? DEFAULT_LIMITS.runTimeoutMinutes,
    idleTimeoutMinutes: settings?.idleTimeoutMinutes ?? DEFAULT_LIMITS.idleTimeoutMinutes,
    maxSteps: settings?.maxSteps ?? DEFAULT_LIMITS.maxSteps,
    maxToolCalls: settings?.maxToolCalls ?? DEFAULT_LIMITS.maxToolCalls,
  }
}

function defaultDraft(meta) {
  return {
    title: '我的投研任务',
    description: '',
    instruction: '',
    category: 'research',
    icon: DEFAULT_CUSTOM_ICON,
    trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true },
    workspaceId: '',
    limits: defaultLimits(meta),
    notifications: { inApp: meta?.execution?.settings?.inAppNotifications !== false, onFailure: true, onSuccess: false },
  }
}

function draftPayload(task) {
  return {
    title: String(task.title ?? '').trim(),
    description: task.description ?? '',
    instruction: task.instruction ?? '',
    category: task.category,
    ...(task.origin === 'builtin' ? {} : { icon: task.icon ?? DEFAULT_CUSTOM_ICON }),
    trigger: normalizeTrigger(task.trigger),
    workspaceId: task.workspaceId ?? '',
    limits: task.limits,
    notifications: task.notifications,
  }
}

function payloadKey(task) {
  return JSON.stringify(draftPayload(task))
}

function samePayload(left, right) {
  return payloadKey(left) === payloadKey(right)
}

function cloneTask(task) {
  return {
    ...task,
    trigger: normalizeTrigger(task.trigger),
    limits: { ...task.limits },
    notifications: { ...task.notifications },
  }
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function localDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function addLocalDays(date, delta) {
  const next = new Date(date)
  next.setDate(next.getDate() + delta)
  return next
}

function startOfLocalWeek(date) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start
}

function parseLocalDateKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''))
  if (match === null) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function historyBucketMap(history) {
  const buckets = new Map()
  for (const bucket of history?.days ?? []) {
    if (typeof bucket?.date === 'string') buckets.set(bucket.date, bucket)
  }
  return buckets
}

function heatLevel(total) {
  if (total <= 0) return 0
  if (total === 1) return 1
  if (total === 2) return 2
  if (total <= 4) return 3
  return 4
}

function buildHeatmap(history) {
  const byDate = historyBucketMap(history)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const first = addLocalDays(startOfLocalWeek(today), -7 * (HEATMAP_WEEKS - 1))
  const weeks = []
  let total = 0
  let success = 0
  let failure = 0
  let active = 0
  for (let weekIndex = 0; weekIndex < HEATMAP_WEEKS; weekIndex += 1) {
    const weekStart = addLocalDays(first, weekIndex * 7)
    const days = []
    let label = null
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = addLocalDays(weekStart, dayIndex)
      const key = localDateKey(date)
      const bucket = byDate.get(key)
      const dayTotal = Number.isFinite(bucket?.total) ? bucket.total : 0
      total += dayTotal
      success += Number.isFinite(bucket?.success) ? bucket.success : 0
      failure += Number.isFinite(bucket?.failure) ? bucket.failure : 0
      active += Number.isFinite(bucket?.active) ? bucket.active : 0
      if (date.getDate() === 1) label = `${date.getMonth() + 1}月`
      days.push({
        date: key,
        total: dayTotal,
        success: Number.isFinite(bucket?.success) ? bucket.success : 0,
        failure: Number.isFinite(bucket?.failure) ? bucket.failure : 0,
        active: Number.isFinite(bucket?.active) ? bucket.active : 0,
        level: heatLevel(dayTotal),
        future: date.getTime() > today.getTime(),
      })
    }
    weeks.push({ key: localDateKey(weekStart), label, days })
  }
  // A trailing window starts mid-month; label it only when the next month is far enough away.
  const firstLabelIndex = weeks.findIndex((week) => week.label !== null)
  if (weeks[0].label === null && firstLabelIndex >= 3) weeks[0].label = `${first.getMonth() + 1}月`
  return {
    weeks,
    total: Number.isFinite(history?.total) ? history.total : total,
    success: Number.isFinite(history?.success) ? history.success : success,
    failure: Number.isFinite(history?.failure) ? history.failure : failure,
    active,
    first: localDateKey(first),
    last: localDateKey(addLocalDays(first, HEATMAP_WEEKS * 7 - 1)),
  }
}

function formatHeatDay(key) {
  const parts = parseLocalDateKey(key)
  if (parts === null) return String(key ?? '')
  const date = new Date(parts.year, parts.month - 1, parts.day)
  return `${parts.year}年${parts.month}月${parts.day}日 ${WEEKDAY_SHORT[date.getDay()]}`
}

function formatHeatRange(first, last) {
  const left = parseLocalDateKey(first)
  const right = parseLocalDateKey(last)
  if (left === null || right === null) return ''
  return `${left.year}.${pad2(left.month)} – ${right.year}.${pad2(right.month)}`
}

function heatDayMeta(day) {
  if (day.future) return zh.heatFuture
  if (day.total === 0) return zh.heatNoRuns
  const parts = [zh.runCount.replace('{n}', String(day.total))]
  if (day.success > 0) parts.push(zh.successCount.replace('{n}', String(day.success)))
  if (day.failure > 0) parts.push(zh.failureCount.replace('{n}', String(day.failure)))
  if (day.active > 0) parts.push(zh.activeCount.replace('{n}', String(day.active)))
  return parts.join(' · ')
}

function eventTone(kind) {
  if (kind === 'run_failed' || kind === 'run_timeout') return 'error'
  if (kind === 'scheduler_standby' || kind === 'calendar_unavailable') return 'warn'
  return 'neutral'
}

function notificationMessage(item) {
  if (typeof item.message === 'string' && item.message.length > 0) return item.message
  if (item.kind === 'run_failed') return zh.notificationFallbackFailed
  if (item.kind === 'run_timeout') return zh.notificationFallbackTimeout
  if (item.kind === 'run_succeeded') return zh.notificationFallbackSuccess
  if (item.kind === 'scheduler_standby') return zh.notificationFallbackStandby
  if (item.kind === 'calendar_unavailable') return zh.notificationFallbackCalendar
  if (item.kind === 'skipped') return zh.notificationFallbackSkipped
  return ''
}

function draftIssues(task, meta) {
  const issues = {}
  if (String(task.title ?? '').trim().length === 0) issues.title = zh.titleRequired
  if (String(task.instruction ?? '').trim().length === 0) issues.instruction = zh.instructionRequired
  const trigger = task.trigger ?? {}
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trigger.time ?? '')) issues.time = zh.invalidTime
  const timezone = String(trigger.timezone ?? '').trim()
  if (timezone.length === 0) issues.timezone = zh.invalidTimezone
  else {
    try {
      new Intl.DateTimeFormat('zh-CN', { timeZone: timezone })
    } catch {
      issues.timezone = zh.invalidTimezoneValue
    }
  }
  if (trigger.cadence === 'weekly' && (trigger.weekdays ?? []).length === 0) issues.weekdays = zh.weekdayRequired
  if (trigger.cadence === 'once') {
    if (typeof trigger.date !== 'string' || trigger.date.length === 0) issues.date = zh.dateRequired
    else if (!isValidDateInput(trigger.date)) issues.date = zh.invalidDate
  }
  const limits = task.limits ?? {}
  for (const key of ['runTimeoutMinutes', 'idleTimeoutMinutes', 'maxSteps', 'maxToolCalls']) {
    const value = limits[key]
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      issues[key] = zh.invalidLimit
      continue
    }
    const range = meta?.execution?.limits?.[key]
    if (Array.isArray(range) && range.length === 2 && (value < range[0] || value > range[1])) {
      issues[key] = zh.invalidLimitRange.replace('{min}', String(range[0])).replace('{max}', String(range[1]))
    }
  }
  return issues
}

/**
 * Tracks which fields the user has left so errors appear on blur, then update live.
 * `resetKey` clears that state when the edited task or modal session changes.
 */
function useDraftIssues(task, resetKey, meta) {
  const [touched, setTouched] = useState({})
  const issues = draftIssues(task, meta)
  useEffect(() => { setTouched({}) }, [resetKey])
  const errorFor = (field) => (touched[field] === true ? issues[field] : undefined)
  const touch = (field) => setTouched((current) => (current[field] === true ? current : { ...current, [field]: true }))
  const touchAll = () => setTouched((current) => {
    const next = { ...current }
    for (const field of Object.keys(issues)) next[field] = true
    return next
  })
  return { issues, errorFor, touch, touchAll }
}

function limitValue(meta, key, fallback) {
  const range = meta?.execution?.limits?.[key]
  return Array.isArray(range) && range.length === 2 ? range : fallback
}

function RunHistoryCard(props) {
  const { history, onViewAll, showLink = true } = props
  const model = buildHeatmap(history)
  const { total, success, failure, active, weeks } = model
  const cardRef = useRef(null)
  const scrollRef = useRef(null)
  const [tip, setTip] = useState(null)

  useEffect(() => {
    const node = scrollRef.current
    if (node === null) return undefined
    node.scrollLeft = node.scrollWidth
    const syncFade = () => { node.dataset.faded = node.scrollLeft > 1 ? 'true' : 'false' }
    node.addEventListener('scroll', syncFade, { passive: true })
    syncFade()
    return () => node.removeEventListener('scroll', syncFade)
  }, [])

  function showTip(day, event) {
    const card = cardRef.current
    if (card === null || event === undefined) return
    const cell = event.currentTarget.getBoundingClientRect()
    const base = card.getBoundingClientRect()
    const half = 110
    const left = Math.min(Math.max(cell.left - base.left + cell.width / 2, half), Math.max(half, base.width - half))
    setTip({ day, left, top: cell.top - base.top - 7 })
  }

  const monthLabels = weeks.map((week, index) => week.label === null ? null : h('span', {
    key: week.key,
    className: 'capital-automation-heatmonth',
    style: index >= HEATMAP_WEEKS - 2
      ? { gridColumn: index + 1, justifySelf: 'end' }
      : { gridColumn: index + 1 },
  }, week.label))

  const cells = weeks.flatMap((week) => week.days.map((day) => h('span', {
    key: day.date,
    className: 'capital-automation-heatcell',
    'data-level': day.level,
    'data-future': day.future ? 'true' : undefined,
    'data-failed': day.failure > 0 ? 'true' : undefined,
    'data-active': day.active > 0 ? 'true' : undefined,
    title: `${formatHeatDay(day.date)} · ${heatDayMeta(day)}`,
    onMouseEnter: (event) => showTip(day, event),
  })))

  return h('section', { ref: cardRef, className: 'capital-automation-card capital-automation-history', 'aria-label': zh.runHistory },
    h('div', { className: 'capital-automation-historyhead' },
      h('div', { className: 'capital-automation-historytitle' },
        h('h2', null, zh.runHistory),
        h('span', null, zh.last12Months)),
      h('div', { className: 'capital-automation-historystats' },
        h('span', { className: 'capital-automation-historystat', 'data-tone': 'ok' },
          h('span', { className: 'capital-automation-statusdot' }),
          zh.successCount.replace('{n}', String(success))),
        h('span', { className: 'capital-automation-historystat', 'data-tone': 'error' },
          h('span', { className: 'capital-automation-statusdot' }),
          zh.failureCount.replace('{n}', String(failure))),
        active > 0
          ? h('span', { className: 'capital-automation-historystat', 'data-tone': 'active' },
            h('span', { className: 'capital-automation-statusdot' }),
            zh.activeCount.replace('{n}', String(active)))
          : null,
        showLink && onViewAll !== undefined
          ? h('button', { type: 'button', className: 'capital-automation-historylink', onClick: onViewAll },
            zh.runCount.replace('{n}', String(total)),
            h(IconChevronRightOutlineRegular, { size: 13 }))
          : h('span', { className: 'capital-automation-historystat' }, zh.runCount.replace('{n}', String(total))))),
    h('div', { className: 'capital-automation-heatmap' },
      h('div', { className: 'capital-automation-heatweekdays', 'aria-hidden': 'true' },
        [0, 1, 2, 3, 4, 5, 6].map((index) => h('span', { key: index, className: 'capital-automation-heatweekday' },
          index === 0 ? '周一' : index === 2 ? '周三' : index === 4 ? '周五' : ''))),
      h('div', { ref: scrollRef, className: 'capital-automation-heatscroll' },
        h('div', { className: 'capital-automation-heatcanvas' },
          h('div', { className: 'capital-automation-heatmonths', 'aria-hidden': 'true' }, monthLabels),
          h('div', {
            className: 'capital-automation-heatgrid',
            role: 'img',
            'aria-label': zh.heatSummary
              .replace('{total}', String(total))
              .replace('{success}', String(success))
              .replace('{failure}', String(failure)),
            onMouseLeave: () => setTip(null),
          }, cells)))),
    h('div', { className: 'capital-automation-heatfoot' },
      h('span', { className: 'capital-automation-heatrange' },
        total === 0 ? zh.historyEmpty : formatHeatRange(model.first, model.last)),
      h('div', { className: 'capital-automation-heatlegend' },
        active > 0
          ? h('span', { className: 'capital-automation-heatkey' },
            h('span', { className: 'capital-automation-heatactivebox' }),
            zh.heatActive)
          : null,
        failure > 0
          ? h('span', { className: 'capital-automation-heatkey' },
            h('span', { className: 'capital-automation-heatfailbox' }),
            zh.heatFailed)
          : null,
        h('span', { className: 'capital-automation-heatlegendlabel' }, zh.heatLess),
        [0, 1, 2, 3, 4].map((level) => h('span', { key: level, className: 'capital-automation-heatsample', 'data-level': level })),
        h('span', { className: 'capital-automation-heatlegendlabel' }, zh.heatMore))),
    tip === null ? null : h('div', {
      className: 'capital-automation-heattip',
      role: 'tooltip',
      style: { left: `${tip.left}px`, top: `${tip.top}px` },
    },
    h('span', { className: 'capital-automation-heattipdate' }, formatHeatDay(tip.day.date)),
    h('span', { className: 'capital-automation-heattipmeta' }, heatDayMeta(tip.day))))
}

function RunStatus(props) {
  const { status } = props
  return h('span', { className: 'capital-automation-runstatus', 'data-status': status },
    h('span', { className: 'capital-automation-rundot' }),
    statusLabel(status))
}

function RunRow(props) {
  const { run, task, onCancel, onOpenSession, onOpenTask, busy } = props
  const active = isActiveRun(run)
  const errorCount = Array.isArray(run.errors) ? run.errors.length : 0
  const [errorsOpen, setErrorsOpen] = useState(false)
  const errorPanelId = `capital-automation-run-errors-${run.id}`
  const errorBadge = errorCount > 0
    ? h('button', {
      type: 'button',
      className: 'capital-automation-runerrorbadge',
      'data-tone': isFailureStatus(run.status) ? 'error' : 'warn',
      'aria-expanded': errorsOpen ? 'true' : 'false',
      'aria-controls': errorPanelId,
      'aria-label': `${zh.runErrors.replace('{n}', String(errorCount))}，${errorsOpen ? zh.hideErrorDetails : zh.showErrorDetails}`,
      title: errorsOpen ? zh.hideErrorDetails : zh.showErrorDetails,
      onClick: () => setErrorsOpen((current) => !current),
    },
    h(IconWarningOutlineRegular, { size: 12 }),
    zh.runErrors.replace('{n}', String(errorCount)),
    h(IconChevronRightOutlineRegular, { size: 12 }))
    : null
  return h('div', { className: 'capital-automation-run' },
    h('div', { className: 'capital-automation-runhead' },
      h('div', { className: 'capital-automation-runmain' },
        h('div', { className: 'capital-automation-runline' },
          task !== undefined && onOpenTask !== undefined
            ? h('button', { type: 'button', className: 'capital-automation-runtitle capital-automation-runmaintitle', onClick: () => onOpenTask(task.id) }, task.title)
            : h('span', { className: 'capital-automation-runtitle' }, run.taskTitle),
          h(RunStatus, { status: run.status })),
        h('div', { className: 'capital-automation-runmetaline' },
          h('span', { className: 'capital-automation-runmeta' }, `${formatShortTime(run.queuedAt, task?.trigger?.timezone)} · ${run.trigger === 'manual' ? zh.triggerManual : zh.triggerScheduled}`),
          typeof run.durationMs === 'number' ? h('span', { className: 'capital-automation-runmeta' }, `${zh.duration} ${formatDuration(run.durationMs)}`) : null,
          h('span', { className: 'capital-automation-runmeta' }, `${zh.steps} ${run.steps} · ${zh.tools} ${run.toolCalls}`),
          errorBadge)),
      h('div', { className: 'capital-automation-runactions' },
        active && typeof onCancel === 'function'
          ? h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', 'data-variant': 'danger', disabled: busy, onClick: () => onCancel(run) }, zh.cancelRun)
          : run.sessionId && onOpenSession
            ? h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', 'data-variant': 'primary', onClick: () => onOpenSession(run.sessionId) },
              h(IconRightUpOutlineRegular, { size: 13 }),
              zh.openSession)
            : null)),
    errorsOpen && errorCount > 0
      ? h('div', { id: errorPanelId, className: 'capital-automation-runerrors', role: 'region', 'aria-label': zh.errorDetailsLabel },
        run.errors.map((item, index) => h('div', { key: `${run.id}-error-${index}`, className: 'capital-automation-runerror', 'data-severity': item.severity },
          h('span', { className: 'capital-automation-runerrordot' }),
          h('span', { className: 'capital-automation-runerrormessage' }, item.message),
          item.code ? h('code', { className: 'capital-automation-runerrorcode', title: item.code }, item.code) : null)))
      : null)
}

function RunList(props) {
  const { runs, tasks, onCancel, onOpenSession, onOpenTask, busy, compact } = props
  const taskMap = new Map(tasks.map((task) => [task.id, task]))
  if (runs.length === 0) {
    if (compact) return h('p', { className: 'capital-automation-hint' }, zh.detailNoRuns)
    return h('div', { className: 'capital-automation-empty' },
      h('span', { className: 'capital-automation-emptyicon' }, h(IconClockOutlineRegular, { size: 19 })),
      h('h3', null, zh.detailNoRuns),
      h('p', null, zh.runsEmptyBody))
  }
  return h('div', { className: 'capital-automation-runs' },
    runs.map((run) => h(RunRow, {
      key: run.id,
      run,
      task: taskMap.get(run.taskId),
      onCancel,
      onOpenSession,
      onOpenTask,
      busy,
    })))
}

function NotificationsButton(props) {
  const { unread, onClick } = props
  return h('button', {
    type: 'button',
    className: 'capital-automation-btn',
    'data-variant': 'ghost',
    onClick,
    title: zh.notificationsEntry,
    'aria-label': zh.notificationsEntry,
  },
  h(IconAlarmClockOutlineRegular, { size: 14 }),
  h('span', { className: 'capital-automation-btnlabel' }, zh.notificationsEntry),
  unread > 0 ? h('span', { className: 'capital-automation-count' }, String(unread > 99 ? '99+' : unread)) : null)
}

function systemStatusReason(code) {
  if (code === 'lease_held') return zh.systemReasonLeaseHeld
  if (code === 'owner_unverified') return zh.systemReasonUnverified
  return zh.systemReasonLeaseLost
}

/** Profile-level scheduling state lives here, not in the task inbox. */
function SystemStatus(props) {
  const { meta } = props
  const [open, setOpen] = useState(false)
  if (meta === null || meta === undefined) return null
  const scheduler = meta.scheduler ?? {}
  const state = scheduler.state
  const summary = state === 'active'
    ? zh.systemActive
    : state === 'standby'
      ? zh.systemStandby
      : state === 'starting'
        ? zh.systemStarting
        : state === 'stopped'
          ? zh.systemStopped
          : zh.systemUnavailable
  const calendarSummary = meta.calendar?.available === false ? zh.systemCalendarUnavailable : zh.systemCalendarOk
  const lastStandbyAt = scheduler.lastStandbyAt
  return h('section', { className: 'capital-automation-systemstatus', 'aria-label': zh.systemStatus },
    h('div', { className: 'capital-automation-systemline' },
      h('span', null, `${zh.systemStatus}：${summary} · ${calendarSummary}`),
      h('button', {
        type: 'button',
        className: 'capital-automation-systemtoggle',
        'aria-expanded': open ? 'true' : 'false',
        onClick: () => setOpen((value) => !value),
      }, open ? zh.systemHideDetails : zh.systemDetails)),
    open
      ? h('div', { className: 'capital-automation-systemdetail' },
        lastStandbyAt
          ? h('p', null, `${zh.systemLastStandby}：${formatShortTime(lastStandbyAt)} · ${systemStatusReason(scheduler.lastStandbyCode)}`)
          : h('p', null, zh.systemNoStandby),
        lastStandbyAt && scheduler.lastStandbyReason
          ? h('details', null,
            h('summary', null, zh.systemTechnical),
            h('p', null, scheduler.lastStandbyReason))
          : null)
      : null)
}

function Header(props) {
  const { tab, onTab, onNewTask, unread, onOpenInbox } = props
  return h('header', { className: 'capital-automation-head' },
    h('div', { className: 'capital-automation-headinner' },
      h('div', { className: 'capital-automation-topbar' },
        h('div', { className: 'capital-automation-brand' },
          h('span', { className: 'capital-automation-brandmark', 'aria-hidden': 'true' }, h(IconChecklistOutlineRegular, { size: 16 })),
          h('h1', null, zh.title)),
        h('div', { className: 'capital-automation-tabs', role: 'tablist', 'aria-label': zh.title },
          ['board', 'tasks', 'runs'].map((value) => h('button', {
            key: value,
            type: 'button',
            role: 'tab',
            className: 'capital-automation-tab',
            'aria-selected': tab === value ? 'true' : 'false',
            onClick: () => onTab(value),
          }, zh.tabs[value]))),
        h('div', { className: 'capital-automation-topactions' },
          h(NotificationsButton, { unread, onClick: onOpenInbox }),
          h('button', { type: 'button', className: 'capital-automation-btn', 'data-variant': 'contrast', onClick: onNewTask, title: zh.newTask, 'aria-label': zh.newTask },
            h(IconPlusOutlineRegular, { size: 14 }),
            h('span', { className: 'capital-automation-btnlabel' }, zh.newTask))))))
}

function PageBanners(props) {
  const { meta, loadError, onRetry } = props
  const banners = []
  if (meta?.storage?.state === 'unavailable') {
    banners.push(h('div', { key: 'storage', className: 'capital-automation-banner', 'data-tone': 'error', role: 'alert' },
      `${zh.storageBanner}${meta.storage.error ? `：${meta.storage.error}` : ''}`))
  }
  const schedulerState = meta?.scheduler?.state
  if (meta !== null && meta !== undefined && meta.storage?.state !== 'unavailable' && (schedulerState === 'standby' || schedulerState === 'stopped')) {
    banners.push(h('div', { key: 'standby', className: 'capital-automation-banner', 'data-tone': 'warn', role: 'status' }, zh.standbyBanner))
  }
  const calendarUnavailable = meta !== null && meta !== undefined && meta.calendar?.available === false
  if (meta !== null && meta !== undefined && meta.storage?.state !== 'unavailable' && calendarUnavailable) {
    banners.push(h('div', { key: 'calendar', className: 'capital-automation-banner', 'data-tone': 'warn', role: 'status' }, zh.calendarBanner))
  }
  const calendarCoverage = meta?.calendar?.coverageDays
  if (meta !== null && meta !== undefined && meta.storage?.state !== 'unavailable' && !calendarUnavailable
    && typeof calendarCoverage === 'number' && calendarCoverage >= 0 && calendarCoverage < 30) {
    banners.push(h('div', { key: 'calendar-coverage', className: 'capital-automation-banner', 'data-tone': 'warn', role: 'status' },
      zh.calendarCoverageBanner.replace('{through}', meta.calendar.through ?? zh.calendarUnknown)))
  }
  if (loadError.length > 0) {
    banners.push(h('div', { key: 'load', className: 'capital-automation-banner', 'data-tone': 'error', role: 'alert' },
      loadError,
      h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', onClick: onRetry }, zh.loadRetry)))
  }
  if (banners.length === 0) return null
  return h('div', { className: 'capital-automation-headinner', style: { paddingBottom: 0 } }, banners)
}

function FilterButton(props) {
  const { active, count, label, onClick } = props
  return h('button', {
    type: 'button',
    className: 'capital-automation-filter',
    'aria-pressed': active ? 'true' : 'false',
    onClick,
  },
  h('span', { className: 'capital-automation-filterlabel' }, label),
  count > 0 ? h('span', { className: 'capital-automation-filtercount' }, String(count)) : null)
}

function TaskTags(props) {
  const { task } = props
  const tags = [[categoryLabel(task.category), toneOf(task)]]
  if (task.origin === 'builtin') tags.push([zh.origin.builtin, undefined])
  if (task.origin === 'custom') tags.push([zh.origin.custom, undefined])
  return h('span', { className: 'capital-automation-tasktags' },
    tags.map(([label, tone]) => h('span', {
      key: label,
      className: 'capital-automation-tag',
      'data-tone': tone,
      title: label,
    }, clipTagLabel(label))))
}

function TaskActionsMenu(props) {
  const { task, open, onToggle, onClose, onEdit, onAction, onRequestConfirm, canRun, running, busy, disabled, align = 'end' } = props
  const toggleId = task.state === 'active' ? 'pause' : 'activate'
  const blocked = busy || disabled === true
  const items = [
    { id: 'edit', label: zh.edit, icon: h(IconEditOutlineRegular, { size: 14 }), disabled: busy },
    { id: toggleId, label: activationLabel(task), icon: h(activationIcon(task), { size: 14 }), disabled: blocked },
    { id: 'run', label: zh.runNow, icon: h(IconPlayOutlineRegular, { size: 14 }), disabled: blocked || !canRun || running },
    ...(task.origin === 'builtin' ? [{ id: 'copy', label: zh.copy, icon: h(IconCopyOutlineRegular, { size: 14 }), disabled: blocked }] : []),
  ]
  const children = []
  if (task.origin === 'builtin' && task.state !== 'dormant') {
    children.push(h(MenuItemButton, {
      key: 'hibernate',
      separatorBefore: true,
      icon: h(IconRefreshOutlineRegular, { size: 14 }),
      disabled: blocked || running,
      onSelect: () => {
        onClose()
        onRequestConfirm('hibernate', task)
      },
    }, zh.hibernate))
  }
  if (task.origin === 'custom') {
    children.push(h(MenuItemButton, {
      key: 'remove',
      danger: true,
      separatorBefore: true,
      icon: h(IconTrashOutlineRegular, { size: 14 }),
      disabled: blocked || running,
      onSelect: () => {
        onClose()
        onRequestConfirm('delete', task)
      },
    }, zh.remove))
  }
  return h(Menu, {
    open,
    anchor: h('button', {
      type: 'button',
      className: 'capital-automation-iconbtn',
      disabled: busy,
      title: zh.more,
      'aria-label': `${zh.more}：${task.title}`,
      'aria-haspopup': 'menu',
      'aria-expanded': open ? 'true' : 'false',
      onClick: onToggle,
    }, h(IconEllipsisOutlineRegular, { size: 16 })),
    items,
    children,
    onSelect: (id) => {
      onClose()
      if (id === 'edit') {
        onEdit(task.id)
        return
      }
      onAction(task, id)
    },
    onClose,
    align,
    portal: true,
  })
}

function TaskRow(props) {
  const { task, onOpen, menuOpen, onMenuToggle, onMenuClose, onEdit, onAction, onRequestConfirm, canRun, busy, mutationsDisabled } = props
  const run = task.lastRun
  const running = isActiveRun(run)
  const next = nextRunView(task)
  return h('div', { className: 'capital-automation-trow' },
    h('button', { type: 'button', className: 'capital-automation-trowmain', onClick: () => onOpen(task.id) },
      h('span', { className: 'capital-automation-cell capital-automation-identity' },
        h(Glyph, { task }),
        h('span', { className: 'capital-automation-identitytext' },
          h('span', { className: 'capital-automation-tasktitlerow' },
            h('span', { className: 'capital-automation-tasktitle' }, task.title),
            h(TaskTags, { task }),
            (task.unread ?? 0) > 0 ? h('span', { className: 'capital-automation-count', title: zh.unread }, String(task.unread)) : null),
          h('span', { className: 'capital-automation-taskdesc' }, task.description || zh.subtitle))),
      h('span', { className: 'capital-automation-cell', 'data-cell': 'schedule' },
        h('span', { className: 'capital-automation-schedule' }, scheduleSummary(task.trigger)),
        h('span', { className: 'capital-automation-schedulesub' }, task.trigger?.timezone ?? '')),
      h('span', { className: 'capital-automation-cell', 'data-cell': 'next' },
        h('span', { className: 'capital-automation-nextmain' }, next.value),
        h('span', { className: 'capital-automation-nextsub' }, next.sub)),
      h('span', { className: 'capital-automation-cell' },
        h(StateBadge, { state: task.state, running }))),
    h('div', { className: 'capital-automation-trowmenu' },
      h(TaskActionsMenu, {
        task,
        open: menuOpen,
        onToggle: onMenuToggle,
        onClose: onMenuClose,
        onEdit,
        onAction,
        onRequestConfirm,
        canRun,
        running,
        busy,
        disabled: mutationsDisabled,
      })))
}

function TaskTable(props) {
  const { tasks, onOpen, onAction, onRequestConfirm, onEdit, schedulerActive, storageReady, busyTaskId } = props
  const [menuTaskId, setMenuTaskId] = useState(null)
  const canRun = storageReady && schedulerActive
  return h('div', { className: 'capital-automation-table', 'aria-label': zh.taskSection },
    h('div', { className: 'capital-automation-thead' },
      h('div', { className: 'capital-automation-theadmain' },
        h('span', null, zh.taskSection),
        h('span', null, zh.triggerSummary),
        h('span', null, zh.nextRun),
        h('span', null, zh.stateLabel)),
      h('span', null)),
    tasks.map((task) => h(TaskRow, {
      key: task.id,
      task,
      onOpen,
      menuOpen: menuTaskId === task.id,
      onMenuToggle: () => setMenuTaskId((current) => current === task.id ? null : task.id),
      onMenuClose: () => setMenuTaskId(null),
      onEdit,
      onAction,
      onRequestConfirm,
      canRun,
      busy: busyTaskId === task.id,
      mutationsDisabled: !storageReady,
    })))
}

function TemplateCard(props) {
  const { task, onOpen, onEnable, busy, disabled } = props
  return h('article', { className: 'capital-automation-template' },
    h('button', { type: 'button', className: 'capital-automation-templatemain', onClick: () => onOpen(task.id) },
      h(Glyph, { task, size: 38 }),
      h('span', { className: 'capital-automation-templatebody' },
        h('span', { className: 'capital-automation-templatetitlerow' },
          h('strong', null, task.title),
          h('span', {
            className: 'capital-automation-tag',
            'data-tone': toneOf(task),
            title: categoryLabel(task.category),
          }, clipTagLabel(categoryLabel(task.category)))),
        h('span', { className: 'capital-automation-templatedesc' }, task.description || zh.subtitle))),
    h('div', { className: 'capital-automation-templatefoot' },
      h('span', { className: 'capital-automation-templatemeta' },
        h(IconClockOutlineRegular, { size: 12 }),
        `${zh.templateMeta} · ${scheduleSummary(task.trigger)}`),
      h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', 'data-variant': 'primary', onClick: () => onEnable(task), disabled: busy || disabled },
        h(IconPlusOutlineRegular, { size: 12 }),
        busy ? zh.templateAdding : zh.templateAdd)))
}

function EmptyState(props) {
  const { title, body, action, actionLabel, icon } = props
  return h('div', { className: 'capital-automation-empty' },
    h('span', { className: 'capital-automation-emptyicon' }, h(icon ?? IconChecklistOutlineRegular, { size: 19 })),
    h('h3', null, title),
    h('p', null, body),
    action && actionLabel ? h('button', { type: 'button', className: 'capital-automation-btn', onClick: action }, actionLabel) : null)
}

// Skeleton mirrors the real dashboard/runs layout so the first paint never claims "no tasks".
function SkeletonBlock(props) {
  const { width = '100%', height = 10, radius = 6 } = props
  return h('span', {
    className: 'capital-automation-skeleton',
    style: { width, height, borderRadius: radius },
    'aria-hidden': 'true',
  })
}

function SkeletonHistory() {
  return h('section', { className: 'capital-automation-card capital-automation-history', 'aria-hidden': 'true' },
    h('div', { className: 'capital-automation-historyhead' },
      h('div', { className: 'capital-automation-historytitle' },
        h(SkeletonBlock, { width: 92, height: 14 }),
        h(SkeletonBlock, { width: 52, height: 11 })),
      h('div', { className: 'capital-automation-historystats' },
        h(SkeletonBlock, { width: 64, height: 12 }),
        h(SkeletonBlock, { width: 64, height: 12 }),
        h(SkeletonBlock, { width: 56, height: 12 }))),
    h('div', { className: 'capital-automation-skeletonheat' },
      h('div', { className: 'capital-automation-skeletonmonths' },
        Array.from({ length: 12 }, (_, index) => h('span', {
          key: index,
          className: 'capital-automation-skeleton',
          style: { gridColumn: 1 + index * 4, width: 22, height: 8 },
        }))),
      h('div', { className: 'capital-automation-skeletongrid' },
        Array.from({ length: HEATMAP_WEEKS * 7 }, (_, index) => h('span', {
          key: index,
          className: 'capital-automation-skeleton',
        })))),
    h('div', { className: 'capital-automation-heatfoot' },
      h(SkeletonBlock, { width: 108, height: 9 }),
      h(SkeletonBlock, { width: 96, height: 9 })))
}

function SkeletonSectionHead(props) {
  const { trailing = [210, 132] } = props
  return h('div', { className: 'capital-automation-sectionhead' },
    h(SkeletonBlock, { width: 78, height: 14 }),
    h(SkeletonBlock, { width: 210, height: 11 }),
    trailing.length === 0 ? null : h('div', { className: 'capital-automation-sectiontools' },
      trailing.map((width, index) => h(SkeletonBlock, { key: index, width, height: index === 0 ? 28 : 30, radius: 999 }))))
}

function SkeletonTaskRow() {
  return h('div', { className: 'capital-automation-trow capital-automation-skeletonrow', 'aria-hidden': 'true' },
    h('div', { className: 'capital-automation-trowmain' },
      h('span', { className: 'capital-automation-cell capital-automation-identity' },
        h(SkeletonBlock, { width: 34, height: 34, radius: 10 }),
        h('span', { className: 'capital-automation-skeletonstack' },
          h(SkeletonBlock, { width: '52%', height: 12 }),
          h(SkeletonBlock, { width: '82%', height: 9 }),
          h(SkeletonBlock, { width: 92, height: 16, radius: 999 }))),
      h('span', { className: 'capital-automation-cell', 'data-cell': 'schedule' },
        h(SkeletonBlock, { width: '64%', height: 10 }),
        h(SkeletonBlock, { width: '42%', height: 8 })),
      h('span', { className: 'capital-automation-cell', 'data-cell': 'next' },
        h(SkeletonBlock, { width: '58%', height: 10 }),
        h(SkeletonBlock, { width: '36%', height: 8 })),
      h('span', { className: 'capital-automation-cell' },
        h(SkeletonBlock, { width: 52, height: 22, radius: 999 }))),
    h('div', { className: 'capital-automation-trowmenu' },
      h(SkeletonBlock, { width: 18, height: 18, radius: 6 })))
}

function SkeletonTaskTable(props) {
  const { rows = 4 } = props
  return h('div', { className: 'capital-automation-table', 'aria-hidden': 'true' },
    h('div', { className: 'capital-automation-thead' },
      h('div', { className: 'capital-automation-theadmain' },
        h(SkeletonBlock, { width: '52%', height: 9 }),
        h(SkeletonBlock, { width: '58%', height: 9 }),
        h(SkeletonBlock, { width: '56%', height: 9 }),
        h(SkeletonBlock, { width: 44, height: 9 })),
      h('span', null)),
    Array.from({ length: rows }, (_, index) => h(SkeletonTaskRow, { key: index })))
}

function SkeletonTemplateCard() {
  return h('div', { className: 'capital-automation-template capital-automation-skeletontemplate', 'aria-hidden': 'true' },
    h('div', { className: 'capital-automation-skeletontemplatemain' },
      h(SkeletonBlock, { width: 38, height: 38, radius: 11 }),
      h('div', { className: 'capital-automation-skeletonstack' },
        h(SkeletonBlock, { width: '58%', height: 11 }),
        h(SkeletonBlock, { width: '100%', height: 9 }),
        h(SkeletonBlock, { width: '76%', height: 9 }))),
    h('div', { className: 'capital-automation-templatefoot' },
      h(SkeletonBlock, { width: 118, height: 11 }),
      h(SkeletonBlock, { width: 64, height: 28, radius: 999 })))
}

function SkeletonRunRow() {
  return h('div', { className: 'capital-automation-run capital-automation-skeletonrun', 'aria-hidden': 'true' },
    h('div', { className: 'capital-automation-runhead' },
      h('div', { className: 'capital-automation-runmain' },
        h('div', { className: 'capital-automation-runline' },
          h(SkeletonBlock, { width: 168, height: 11 }),
          h(SkeletonBlock, { width: 54, height: 10, radius: 999 })),
        h('div', { className: 'capital-automation-runmetaline' },
          h(SkeletonBlock, { width: 86, height: 9 }),
          h(SkeletonBlock, { width: 58, height: 9 }),
          h(SkeletonBlock, { width: 104, height: 9 }))),
      h('div', { className: 'capital-automation-runactions' },
        h(SkeletonBlock, { width: 64, height: 26, radius: 999 }))))
}

function LoadingSkeleton(props) {
  const { children } = props
  // aria-busy on the live region would suppress its announcement until false; it unmounts instead.
  return h('div', { className: 'capital-automation-loading', 'aria-busy': 'true' },
    h('span', {
      className: 'capital-automation-skeletonlabel',
      role: 'status',
      'aria-live': 'polite',
    }, zh.loading),
    children)
}

function TaskDashboardSkeleton() {
  return h(LoadingSkeleton, null,
    h('section', { className: 'capital-automation-section', style: { marginTop: 0 } },
      h(SkeletonSectionHead),
      h(SkeletonTaskTable, { rows: 4 })),
    h('section', { className: 'capital-automation-section' },
      h(SkeletonSectionHead, { trailing: [64] }),
      h('div', { className: 'capital-automation-templates' },
        [0, 1, 2].map((index) => h(SkeletonTemplateCard, { key: index })))))
}

function RunsSkeleton() {
  return h(LoadingSkeleton, null,
    h(SkeletonHistory),
    h('section', { className: 'capital-automation-section' },
      h(SkeletonSectionHead, { trailing: [260] }),
      h('section', { className: 'capital-automation-card capital-automation-panel' },
        h('div', { className: 'capital-automation-runs' },
          [0, 1, 2, 3].map((index) => h(SkeletonRunRow, { key: index }))))))
}

function TaskDashboard(props) {
  const { tasks, templates, runs, onOpenTask, onNewTask, onEnableTemplate, onAction, onRequestConfirm, onEdit, onRequestCancelRun, schedulerActive, storageReady, busyTaskId } = props
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const runningTasks = tasks.filter((task) => isActiveRun(task.lastRun))
  const templatesAvailable = templates.filter((task) => !isActiveRun(task.lastRun))
  const roster = tasks.filter((task) => !isActiveRun(task.lastRun) && !(task.origin === 'builtin' && task.state === 'dormant'))
  const visible = roster.filter((task) => {
    if (filter === 'custom' && task.origin !== 'custom') return false
    if (filter !== 'all' && filter !== 'custom' && task.category !== filter) return false
    if (query.trim().length === 0) return true
    const needle = query.trim().toLowerCase()
    return `${task.title} ${task.description ?? ''} ${task.instruction ?? ''}`.toLowerCase().includes(needle)
  })
  const filterCounts = {
    all: roster.length,
    custom: roster.filter((task) => task.origin === 'custom').length,
    news: roster.filter((task) => task.category === 'news').length,
    market: roster.filter((task) => task.category === 'market').length,
    review: roster.filter((task) => task.category === 'review').length,
    research: roster.filter((task) => task.category === 'research').length,
    portfolio: roster.filter((task) => task.category === 'portfolio').length,
    monitor: roster.filter((task) => task.category === 'monitor').length,
  }
  const filters = ['all', 'custom', 'news', 'market', 'review', 'research', 'portfolio', 'monitor']
  return h('div', null,
    h('section', { className: 'capital-automation-section', style: { marginTop: 0 } },
      h('div', { className: 'capital-automation-sectionhead' },
        h('h2', null, zh.taskSection),
        h('span', null, zh.taskSectionHint),
        h('div', { className: 'capital-automation-sectiontools' },
          h('div', { className: 'capital-automation-filters', role: 'group', 'aria-label': zh.filterLabel },
            filters.map((value) => h(FilterButton, {
              key: value,
              label: value === 'all' ? zh.filterAll : value === 'custom' ? zh.filterCustom : categoryLabel(value),
              count: filterCounts[value],
              active: filter === value,
              onClick: () => setFilter(value),
            }))),
          h('label', { className: 'capital-automation-search' },
            h(IconSearchOutlineRegular, { size: 13 }),
            h('input', {
              type: 'search',
              value: query,
              placeholder: zh.searchPlaceholder,
              'aria-label': zh.searchPlaceholder,
              onChange: (event) => setQuery(event.target.value),
            })))),
      runningTasks.length > 0
        ? h('div', { className: 'capital-automation-running', role: 'status' },
          runningTasks.map((task) => h('div', { key: task.id, className: 'capital-automation-runningrow' },
            h('span', { className: 'capital-automation-live' },
              h('span', { className: 'capital-automation-livedot' }),
              zh.status.running),
            h(Glyph, { task, size: 28 }),
            h('button', { type: 'button', className: 'capital-automation-tasktitle', style: { padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }, onClick: () => onOpenTask(task.id) }, task.title),
            h('span', { className: 'capital-automation-runmeta' }, `${zh.runningSince} ${formatRelative(task.lastRun.startedAt ?? task.lastRun.queuedAt)} · ${zh.steps} ${task.lastRun.steps} · ${zh.tools} ${task.lastRun.toolCalls}`),
            h('span', { className: 'capital-automation-runningactions' },
              h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', 'data-variant': 'danger', onClick: () => onRequestCancelRun(task, task.lastRun) }, zh.cancelRun),
              h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', onClick: () => onOpenTask(task.id) }, zh.details)))))
        : null,
      visible.length > 0
        ? h(TaskTable, {
          tasks: visible,
          onOpen: onOpenTask,
          onAction,
          onRequestConfirm,
          onEdit,
          schedulerActive,
          storageReady,
          busyTaskId,
        })
        : roster.length === 0
          ? runningTasks.length > 0
            ? null
            : h(EmptyState, {
              title: templatesAvailable.length > 0 ? zh.emptyTasksTitle : zh.emptyNoTemplates,
              body: templatesAvailable.length > 0 ? zh.emptyTasksBody : zh.emptyNoTemplatesBody,
              action: templatesAvailable.length === 0 ? onNewTask : undefined,
              actionLabel: templatesAvailable.length === 0 ? zh.newTask : undefined,
            })
          : h(EmptyState, {
            title: zh.emptyFiltered,
            body: zh.emptyTasksBody,
            action: () => { setFilter('all'); setQuery('') },
            actionLabel: zh.clearFilter,
          })),
    templatesAvailable.length > 0
      ? h('section', { className: 'capital-automation-section' },
        h('div', { className: 'capital-automation-sectionhead' },
          h('h2', null, zh.templateSection)),
        h('div', { className: 'capital-automation-templates' },
          templatesAvailable.map((task) => h(TemplateCard, {
            key: task.id,
            task,
            onOpen: onOpenTask,
            onEnable: onEnableTemplate,
            busy: busyTaskId === task.id,
            disabled: !storageReady,
          }))))
      : null)
}

function WeekdaySelect(props) {
  const { value, onChange, disabled } = props
  const [open, setOpen] = useState(false)
  const selected = Array.isArray(value) ? value : []
  const has = (day) => selected.includes(day)
  const exact = (days) => selected.length === days.length && days.every(has)
  const workday = exact([1, 2, 3, 4, 5])
  const weekend = exact([6, 7])
  const everyDay = exact(WEEKDAYS.map((day) => day.value))
  const summary = selected.length === 0
    ? zh.weekdayNone
    : everyDay
      ? zh.weekdayEvery
      : workday
        ? zh.weekdayWorkdayQuick
        : weekend
          ? zh.weekdayWeekendQuick
          : WEEKDAYS.filter((day) => has(day.value)).map((day) => day.label).join('、')
  useEffect(() => {
    if (disabled === true && open) setOpen(false)
  }, [disabled, open])
  const items = [
    { id: 'workday', label: zh.weekdayWorkdayQuick },
    { id: 'weekend', label: zh.weekdayWeekendQuick },
    { type: 'separator', id: 'weekday-separator' },
    ...WEEKDAYS.map((day) => ({ id: `weekday-${day.value}`, label: `周${day.label}` })),
  ]
  const selectedIds = [
    ...selected.map((day) => `weekday-${day}`),
    ...(workday ? ['workday'] : []),
    ...(weekend ? ['weekend'] : []),
  ]
  const pick = (id) => {
    if (id === 'workday') { onChange([1, 2, 3, 4, 5]); return }
    if (id === 'weekend') { onChange([6, 7]); return }
    const day = Number(id.slice('weekday-'.length))
    if (!WEEKDAYS.some((item) => item.value === day)) return
    const next = has(day) ? selected.filter((item) => item !== day) : [...selected, day].sort((left, right) => left - right)
    if (next.length > 0) onChange(next)
  }
  return h(Menu, {
    open,
    anchor: h('button', {
      type: 'button',
      className: 'capital-automation-select capital-automation-triggerpick',
      disabled,
      'aria-label': `${zh.weekdayField}：${summary}`,
      'aria-haspopup': 'menu',
      'aria-expanded': open ? 'true' : 'false',
      title: `${zh.weekdayField}：${summary}`,
      onClick: () => setOpen((current) => !current),
    },
    h('span', { className: 'capital-automation-selectvalue' }, summary),
    h(IconChevronDownOutlineRegular, { size: 14 })),
    items,
    selectedIds,
    onSelect: pick,
    onClose: () => setOpen(false),
    align: 'start',
    portal: true,
  })
}

function MonthlySelect(props) {
  const { value, onChange, disabled } = props
  const [open, setOpen] = useState(false)
  const day = value === 'last' ? 'last' : Number(value ?? 1)
  const summary = day === 'last'
    ? zh.monthlyLast
    : day === 1
      ? zh.monthlyFirst
      : day === 15
        ? zh.monthlyMid
        : zh.dayOfMonth.replace('{n}', String(day))
  const selectedId = day === 'last' ? 'last' : day === 1 ? 'first' : day === 15 ? 'mid' : 'custom'
  useEffect(() => {
    if (disabled === true && open) setOpen(false)
  }, [disabled, open])
  const items = [
    { id: 'first', label: zh.monthlyFirst },
    { id: 'mid', label: zh.monthlyMid },
    { id: 'last', label: zh.monthlyLast },
    {
      id: 'custom',
      label: zh.monthlyCustom,
      submenu: Array.from({ length: 31 }, (_, index) => ({
        id: `monthly-day-${index + 1}`,
        label: zh.dayOfMonth.replace('{n}', String(index + 1)),
      })),
    },
  ]
  const pick = (id) => {
    if (id === 'first') { onChange(1); setOpen(false); return }
    if (id === 'mid') { onChange(15); setOpen(false); return }
    if (id === 'last') { onChange('last'); setOpen(false); return }
    if (id.startsWith('monthly-day-')) {
      onChange(Number(id.slice('monthly-day-'.length)))
      setOpen(false)
    }
  }
  return h(Menu, {
    open,
    className: 'capital-automation-monthpick',
    anchor: h('button', {
      type: 'button',
      className: 'capital-automation-select capital-automation-triggerpick',
      disabled,
      'aria-label': `${zh.monthlyField}：${summary}`,
      'aria-haspopup': 'menu',
      'aria-expanded': open ? 'true' : 'false',
      title: `${zh.monthlyField}：${summary}`,
      onClick: () => setOpen((current) => !current),
    },
    h('span', { className: 'capital-automation-selectvalue' }, summary),
    h(IconChevronDownOutlineRegular, { size: 14 })),
    items,
    selectedId,
    onSelect: pick,
    onClose: () => setOpen(false),
    align: 'start',
    portal: false,
  })
}

function TriggerFields(props) {
  const { trigger, onChange, disabled, meta, errorFor, touch, onFlush } = props
  const update = (patch) => onChange(normalizeTrigger({ ...trigger, ...patch }))
  const setCadence = (cadence) => onChange(triggerChanged(cadence, trigger))

  const issue = (field) => (typeof errorFor === 'function' ? errorFor(field) : undefined)
  const touchField = (field) => { if (typeof touch === 'function') touch(field) }
  const commit = () => { if (typeof onFlush === 'function') onFlush() }
  const timeError = issue('time')
  const timezoneError = issue('timezone')
  const weekdayError = issue('weekdays')
  const dateError = issue('date')
  const errors = [timeError, timezoneError, weekdayError, dateError]
    .filter((message) => typeof message === 'string' && message.length > 0)
  const cadenceOptions = Object.entries(zh.cadence).map(([value, label]) => ({ value, label }))

  return h('div', {
    className: 'capital-automation-triggerbox',
    'data-cadence': trigger.cadence,
    'data-invalid': errors.length > 0 ? 'true' : undefined,
  },
  h('div', { className: 'capital-automation-triggerhead' },
    h('div', { className: 'capital-automation-triggerfield' },
      h('span', { className: 'capital-automation-triggerlabel' }, zh.cadenceField),
      h(Select, {
        value: trigger.cadence,
        options: cadenceOptions,
        onChange: setCadence,
        disabled,
        label: zh.cadenceField,
      }),
      h('div', { className: 'capital-automation-triggerdetail', 'data-cadence': trigger.cadence },
        trigger.cadence === 'weekly'
          ? h('div', { className: 'capital-automation-triggerfield' },
            h('span', { className: 'capital-automation-triggerlabel' }, zh.weekdayField),
            h(WeekdaySelect, {
              value: trigger.weekdays ?? [],
              onChange: (weekdays) => update({ weekdays }),
              disabled,
            }))
          : trigger.cadence === 'monthly'
            ? h('div', { className: 'capital-automation-triggerfield' },
              h('span', { className: 'capital-automation-triggerlabel' }, zh.dayField),
              h(MonthlySelect, {
                value: trigger.dayOfMonth ?? 1,
                onChange: (dayOfMonth) => update({ dayOfMonth }),
                disabled,
              }))
            : trigger.cadence === 'once'
              ? h('div', { className: 'capital-automation-triggerfield' },
                h('span', { className: 'capital-automation-triggerlabel' }, zh.dayField),
                h('input', {
                  type: 'date',
                  className: 'capital-automation-triggerdate',
                  value: trigger.date ?? '',
                  disabled,
                  title: zh.onceHint,
                  'aria-label': zh.dayField,
                  'aria-invalid': dateError ? 'true' : undefined,
                  'data-invalid': dateError ? 'true' : undefined,
                  onChange: (event) => update({ date: event.target.value }),
                  onBlur: () => { touchField('date'); commit() },
                }))
              : null)),
    h('div', { className: 'capital-automation-triggerfield' },
      h('span', { className: 'capital-automation-triggerlabel' }, zh.timeField),
      h('input', {
        type: 'time',
        className: 'capital-automation-triggertime',
        value: trigger.time,
        disabled,
        'aria-label': zh.timeField,
        'aria-invalid': timeError ? 'true' : undefined,
        'data-invalid': timeError ? 'true' : undefined,
        onChange: (event) => update({ time: event.target.value }),
        onBlur: () => { touchField('time'); commit() },
      }))),
  h('div', { className: 'capital-automation-triggersettings' },
    h('span', { className: 'capital-automation-triggerzone' },
      h('span', { className: 'capital-automation-triggerlabel' }, zh.timezoneField),
      h(Select, {
        value: trigger.timezone,
        options: timezoneOptions(trigger.timezone),
        onChange: (timezone) => update({ timezone }),
        disabled,
        label: zh.timezoneField,
        size: 'sm',
        align: 'end',
      })),
    h('label', { className: 'capital-automation-triggerswitch' },
      h(Switch, {
        checked: trigger.tradingDaysOnly === true,
        onChange: (value) => update({ tradingDaysOnly: value }),
        label: zh.tradingDaysField,
        disabled,
      }),
      h('span', null, zh.tradingDaysField))),
  errors.length > 0
    ? h('div', { className: 'capital-automation-triggererrors' },
      errors.map((message) => h('span', { key: message, className: 'capital-automation-fielderror', role: 'alert' }, message)))
    : null,
  meta?.calendar?.available === false ? h('p', { className: 'capital-automation-hint' }, zh.nextRunUnavailable) : null)
}

function SwitchRow(props) {
  const { label, hint, checked, onChange, disabled } = props
  return h('div', { className: 'capital-automation-switchrow' },
    h('div', null,
      h('span', null, label),
      hint ? h('small', null, hint) : null),
    h(Switch, { checked: checked === true, onChange, label, disabled }))
}

function FieldHead(props) {
  const { label, note, error } = props
  const invalid = typeof error === 'string' && error.length > 0
  return h('span', { className: 'capital-automation-fieldhead' },
    h('span', { className: 'capital-automation-fieldlabel' }, label),
    invalid
      ? h('span', { className: 'capital-automation-fielderror', role: 'alert' }, error)
      : note ? h('span', { className: 'capital-automation-fieldhint' }, note) : null)
}

/**
 * Fixed-height plain-text box. A native textarea brings a resize handle and browser chrome that
 * break the two-column height contract, so the editable surface is a contenteditable div; paste is
 * forced to plain text and maxLength is applied on input.
 */
function PlainTextEditor(props) {
  const { value, onChange, onBlur, placeholder, disabled, ariaLabel, invalid, className, maxLength } = props
  const ref = useRef(null)
  const limit = typeof maxLength === 'number' ? maxLength : undefined
  useEffect(() => {
    const node = ref.current
    if (node === null || node === undefined) return
    const next = value ?? ''
    if (document.activeElement !== node && node.innerText !== next) node.innerText = next
  }, [value])
  const read = (node) => (node.innerText ?? '').replace(/\r\n?/g, '\n')
  const commit = (node) => {
    let text = read(node)
    if (limit !== undefined && Array.from(text).length > limit) {
      text = Array.from(text).slice(0, limit).join('')
      node.innerText = text
      const range = document.createRange()
      range.selectNodeContents(node)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    if (text.length === 0 && node.innerHTML !== '') node.innerHTML = ''
    onChange(text)
  }
  return h('div', {
    ref,
    className,
    contentEditable: disabled === true ? 'false' : 'true',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': ariaLabel,
    'aria-invalid': invalid ? 'true' : undefined,
    'data-placeholder': placeholder,
    spellCheck: false,
    suppressContentEditableWarning: true,
    onInput: (event) => commit(event.currentTarget),
    onBlur: (event) => { commit(event.currentTarget); if (typeof onBlur === 'function') onBlur() },
    onPaste: (event) => {
      const text = event.clipboardData?.getData('text/plain')
      if (typeof text !== 'string') return
      event.preventDefault()
      const selection = window.getSelection()
      if (selection === null || selection.rangeCount === 0) return
      selection.deleteFromDocument()
      const range = selection.getRangeAt(0)
      const node = document.createTextNode(text)
      range.insertNode(node)
      range.setStartAfter(node)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      commit(event.currentTarget)
    },
  })
}

function Field(props) {
  const { label, hint, note, error, children } = props
  const invalid = typeof error === 'string' && error.length > 0
  return h('label', { className: 'capital-automation-field', 'data-invalid': invalid ? 'true' : undefined },
    h(FieldHead, { label, note, error }),
    children,
    hint ? h('span', { className: 'capital-automation-hint' }, hint) : null)
}

/**
 * DSH General-settings style selector: a filled pill plus the shared Menu surface.
 * Native <select> is intentionally avoided so light/dark themes follow host tokens.
 */
function Select(props) {
  const { value, options, onChange, disabled, label, block, size, align = 'start', title } = props
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const items = options.map((option) => ({
    id: String(option.value),
    label: option.label,
    disabled: option.disabled === true,
  }))
  const currentValue = String(value ?? '')
  const current = items.find((item) => item.id === currentValue) ?? items[0]
  useEffect(() => {
    if (disabled === true && open) setOpen(false)
  }, [disabled, open])
  const closeMenu = () => setOpen(false)
  const selectValue = (id) => {
    setOpen(false)
    triggerRef.current?.focus?.({ preventScroll: true })
    if (id !== currentValue) onChange(id)
  }
  const trigger = h('button', {
    ref: triggerRef,
    type: 'button',
    className: 'capital-automation-select',
    'data-block': block === true ? 'true' : undefined,
    'data-size': size,
    disabled,
    'aria-label': current?.label ? `${label}：${current.label}` : label,
    'aria-haspopup': 'menu',
    'aria-expanded': open ? 'true' : 'false',
    title: title ?? current?.label,
    onClick: () => setOpen((currentOpen) => !currentOpen),
  },
  h('span', {
    className: 'capital-automation-selectvalue',
    title: title ?? current?.label,
  }, current?.label ?? ''),
  h(IconChevronDownOutlineRegular, { size: size === 'sm' ? 12 : 14 }))
  return h(Menu, {
    open,
    anchor: trigger,
    items,
    selectedId: currentValue,
    onSelect: selectValue,
    onClose: closeMenu,
    align,
    portal: true,
  })
}

function SelectField(props) {
  const { label, hint, note, error, ariaLabel, block = true, title, ...rest } = props
  const invalid = typeof error === 'string' && error.length > 0
  return h('div', { className: 'capital-automation-field', title, 'data-invalid': invalid ? 'true' : undefined },
    h(FieldHead, { label, note, error }),
    h(Select, { ...rest, label: ariaLabel ?? label, block, title }),
    hint ? h('span', { className: 'capital-automation-hint' }, hint) : null)
}

function NumberField(props) {
  const { label, value, min, max, disabled, onChange, error, onBlur } = props
  return h(Field, { label, error },
    h('input', {
      type: 'number',
      min,
      max,
      value,
      disabled,
      'aria-invalid': error ? 'true' : undefined,
      onChange: (event) => onChange(Number(event.target.value)),
      onBlur,
    }))
}

function RunFilters(props) {
  const { value, counts, onChange } = props
  const options = [
    ['all', zh.runFilterAll],
    ['active', zh.runFilterActive],
    ['succeeded', zh.runFilterSucceeded],
    ['failed', zh.runFilterFailed],
  ]
  return h('div', { className: 'capital-automation-filters', role: 'group', 'aria-label': zh.runFilterLabel },
    options.map(([id, label]) => h(FilterButton, {
      key: id,
      label,
      count: counts[id],
      active: value === id,
      onClick: () => onChange(id),
    })))
}

function RunsPage(props) {
  const { runs, history, tasks, onCancel, onOpenSession, onOpenTask, onGoTasks, onNewTask, busy } = props
  const [filter, setFilter] = useState('all')
  const counts = {
    all: runs.length,
    active: runs.filter((run) => isActiveRun(run)).length,
    succeeded: runs.filter((run) => run.status === 'succeeded').length,
    failed: runs.filter((run) => isFailureStatus(run.status)).length,
  }
  const visible = runs.filter((run) => {
    if (filter === 'active') return isActiveRun(run)
    if (filter === 'succeeded') return run.status === 'succeeded'
    if (filter === 'failed') return isFailureStatus(run.status)
    return true
  })
  return h('div', null,
    h(RunHistoryCard, { history, showLink: false }),
    h('section', { className: 'capital-automation-section' },
      h('div', { className: 'capital-automation-sectionhead' },
        h('h2', null, zh.runsTitle),
        h('span', null, zh.runsHint),
        h('div', { className: 'capital-automation-sectiontools' },
          h(RunFilters, { value: filter, counts, onChange: setFilter }))),
      runs.length === 0
        ? h('div', { className: 'capital-automation-empty' },
          h('span', { className: 'capital-automation-emptyicon' }, h(IconClockOutlineRegular, { size: 19 })),
          h('h3', null, zh.runsEmptyTitle),
          h('p', null, zh.runsEmptyBody),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
            h('button', { type: 'button', className: 'capital-automation-btn', onClick: onGoTasks }, zh.runsEmptyAction),
            h('button', { type: 'button', className: 'capital-automation-btn', 'data-variant': 'primary', onClick: onNewTask }, zh.newTask)))
        : visible.length === 0
          ? h(EmptyState, { title: zh.emptyFiltered, body: zh.filterNoRuns, action: () => setFilter('all'), actionLabel: zh.clearFilter })
          : h('section', { className: 'capital-automation-card capital-automation-panel' },
            h(RunList, { runs: visible, tasks, onCancel, onOpenSession, onOpenTask, busy }),
            runs.length >= 200 ? h('p', { className: 'capital-automation-hint', style: { paddingTop: 10 } }, zh.runsLimitHint.replace('{n}', '200')) : null)))
}

function OverviewTab(props) {
  const { detail, meta, onGoRuns, onCancelRun, onOpenSession } = props
  const latest = detail.runs[0]
  const next = nextRunView(detail.task)
  const last = lastRunView(latest, detail.task.trigger.timezone)
  const anyRunning = detail.runs.some((run) => isActiveRun(run))
  const stateText = anyRunning ? zh.status.running : stateLabel(detail.task.state)
  const originLabel = detail.task.origin === 'builtin' ? zh.origin.builtin : zh.origin.custom
  const scheduleText = `${scheduleRangeSummary(detail.task.trigger)}${detail.task.trigger.tradingDaysOnly === true ? ` · ${zh.tradingDaysField}` : ''}`
  const scheduleHint = detail.task.trigger.cadence === 'once'
    ? zh.triggerHintOnce
    : detail.task.trigger.tradingDaysOnly === true ? zh.triggerHint : zh.triggerHintNatural
  return h('div', { className: 'capital-automation-overview' },
    h('div', { className: 'capital-automation-statgrid' },
      h('div', { className: 'capital-automation-stat' },
        h('span', { className: 'capital-automation-statlabel' }, zh.stateLabel),
        h('span', { className: 'capital-automation-statvalue', 'data-tone': anyRunning ? 'running' : undefined }, stateText),
        h('span', { className: 'capital-automation-statsub' }, originLabel)),
      h('div', { className: 'capital-automation-stat' },
        h('span', { className: 'capital-automation-statlabel' }, zh.nextRun),
        h('span', { className: 'capital-automation-statvalue' }, next.value),
        h('span', { className: 'capital-automation-statsub' }, next.sub)),
      h('div', { className: 'capital-automation-stat' },
        h('span', { className: 'capital-automation-statlabel' }, zh.lastResult),
        h('span', { className: 'capital-automation-statvalue', 'data-tone': last.tone }, last.value),
        h('span', { className: 'capital-automation-statsub' }, last.sub)),
      h('div', { className: 'capital-automation-stat', title: scheduleHint },
        h('span', { className: 'capital-automation-statlabel' }, zh.triggerSummary),
        h('span', { className: 'capital-automation-statvalue' }, scheduleText),
        h('span', { className: 'capital-automation-statsub' }, `${detail.task.trigger.time} · ${detail.task.trigger.timezone}`))),
    h('section', { className: 'capital-automation-card capital-automation-panel' },
      h('div', { className: 'capital-automation-panelhead' },
        h('h3', null, zh.detailRecentRuns.replace('{n}', String(DETAIL_RECENT_RUN_LIMIT))),
        h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', 'data-variant': 'ghost', onClick: onGoRuns },
          zh.detailAllRuns,
          h(IconChevronRightOutlineRegular, { size: 13 }))),
      h(RunList, {
        runs: detail.runs.slice(0, DETAIL_RECENT_RUN_LIMIT),
        tasks: [detail.task],
        onCancel: onCancelRun,
        onOpenSession,
        compact: true,
      })),
    h('section', { className: 'capital-automation-card capital-automation-panel' },
      h('div', { className: 'capital-automation-panelhead' },
        h('h3', null, zh.environment)),
      h('div', { className: 'capital-automation-kv' },
        h('div', { className: 'capital-automation-kvitem' },
          h('span', { className: 'capital-automation-kvlabel' }, zh.presetLabel),
          h('span', { className: 'capital-automation-kvvalue' }, zh.presetValue)),
        h('div', { className: 'capital-automation-kvitem' },
          h('span', { className: 'capital-automation-kvlabel' }, zh.workspaceField),
          h('span', { className: 'capital-automation-kvvalue' }, workspaceTitle(meta, detail.task.workspaceId))),
        h('div', { className: 'capital-automation-kvitem' },
          h('span', { className: 'capital-automation-kvlabel' }, zh.categoryField),
          h('span', { className: 'capital-automation-kvvalue' }, categoryLabel(detail.task.category)))),
      h('section', { className: 'capital-automation-technical' },
        h('h4', { className: 'capital-automation-technicaltitle' }, zh.techInfo),
        h('dl', null,
          h('dt', null, zh.profileKey),
          h('dd', { title: 'profileKey 是 profile 名称的稳定哈希；与 session 标题里的 run id 无关。' }, meta?.profile?.key ?? '—'),
          h('dt', null, zh.presetLabel),
          h('dd', null, zh.presetValue),
          h('dt', null, zh.policyField),
          h('dd', null, meta?.execution?.policy ?? 'automation-v1'),
          h('dt', null, zh.cwdKind),
          h('dd', { title: '当前固定为 profile（专属自动化工作区）；没有 storage 等其他来源。' }, meta?.execution?.cwdKind ?? 'profile'),
          h('dt', null, 'profile 名称'),
          h('dd', null, meta?.profile?.name ?? '—'),
          h('dt', null, zh.calendarField),
          h('dd', null, calendarLabel(meta?.calendar))))))
}

function ConfigTab(props) {
  const { draft, setDraft, meta, busy, dirty, saveState, saveError, retry, onFlush, disabled } = props
  const task = draft
  const { errorFor, touch } = useDraftIssues(task, task.id, meta)
  const titleError = errorFor('title')
  const instructionError = errorFor('instruction')
  const set = (patch) => setDraft((current) => ({
    ...current,
    ...(typeof patch === 'function' ? patch(current) : patch),
  }))
  const flush = () => { if (typeof onFlush === 'function') onFlush() }
  const timeoutRange = limitValue(meta, 'runTimeoutMinutes', [5, 120])
  const idleRange = limitValue(meta, 'idleTimeoutMinutes', [1, 30])
  const stepsRange = limitValue(meta, 'maxSteps', [100, 2000])
  const toolsRange = limitValue(meta, 'maxToolCalls', [100, 5000])
  const instructionEditor = h(Field, { label: zh.instructionField, error: instructionError },
    h(PlainTextEditor, {
      className: 'capital-automation-texteditor',
      value: task.instruction,
      maxLength: INSTRUCTION_MAX_LENGTH,
      disabled: busy || disabled,
      placeholder: zh.instructionPlaceholder,
      ariaLabel: zh.instructionField,
      invalid: instructionError ? true : undefined,
      onChange: (instruction) => set({ instruction }),
      onBlur: () => { touch('instruction'); flush() },
    }))
  const instructionSide = h('div', { className: 'capital-automation-instructionside' },
    h(SelectField, {
      label: zh.workspaceField,
      value: task.workspaceId ?? '',
      options: workspaceOptions(meta, task.workspaceId).map((option) => ({ value: option.id, label: option.title })),
      disabled: busy || disabled,
      onChange: (workspaceId) => set({ workspaceId }),
    }),
    meta?.workspaceError ? h('p', { className: 'capital-automation-hint', 'data-tone': 'error' }, zh.workspaceUnavailable) : null,
    h('div', null,
      h('span', { className: 'capital-automation-formlabel' }, zh.triggerField),
      h(TriggerFields, { trigger: task.trigger, disabled: busy || disabled, onChange: (trigger) => set({ trigger }), meta, errorFor, touch, onFlush: flush })))
  const advanced = h('details', { className: 'capital-automation-advanced' },
    h('summary', null, zh.advanced),
    h('div', { className: 'capital-automation-advancedbody' },
      h('div', { className: 'capital-automation-formgrid' },
        h(NumberField, { label: zh.runTimeout, value: task.limits.runTimeoutMinutes, min: timeoutRange[0], max: timeoutRange[1], disabled: busy || disabled, error: errorFor('runTimeoutMinutes'), onBlur: () => { touch('runTimeoutMinutes'); flush() }, onChange: (value) => set((current) => ({ limits: { ...current.limits, runTimeoutMinutes: value } })) }),
        h(NumberField, { label: zh.idleTimeout, value: task.limits.idleTimeoutMinutes, min: idleRange[0], max: idleRange[1], disabled: busy || disabled, error: errorFor('idleTimeoutMinutes'), onBlur: () => { touch('idleTimeoutMinutes'); flush() }, onChange: (value) => set((current) => ({ limits: { ...current.limits, idleTimeoutMinutes: value } })) }),
        h(NumberField, { label: zh.maxSteps, value: task.limits.maxSteps, min: stepsRange[0], max: stepsRange[1], disabled: busy || disabled, error: errorFor('maxSteps'), onBlur: () => { touch('maxSteps'); flush() }, onChange: (value) => set((current) => ({ limits: { ...current.limits, maxSteps: value } })) }),
        h(NumberField, { label: zh.maxToolCalls, value: task.limits.maxToolCalls, min: toolsRange[0], max: toolsRange[1], disabled: busy || disabled, error: errorFor('maxToolCalls'), onBlur: () => { touch('maxToolCalls'); flush() }, onChange: (value) => set((current) => ({ limits: { ...current.limits, maxToolCalls: value } })) })),
      h('p', { className: 'capital-automation-hint' }, zh.budgetHint)))
  const notificationRows = h('div', null,
    h('span', { className: 'capital-automation-formlabel' }, zh.notifyField),
    h('div', { className: 'capital-automation-switchlist' },
      h(SwitchRow, { label: zh.notifyInApp, checked: task.notifications.inApp, disabled: busy || disabled, onChange: (value) => set((current) => ({ notifications: { ...current.notifications, inApp: value } })) }),
      h(SwitchRow, { label: zh.notifyFailure, checked: task.notifications.onFailure, disabled: busy || disabled || task.notifications.inApp !== true, onChange: (value) => set((current) => ({ notifications: { ...current.notifications, onFailure: value } })) }),
      h(SwitchRow, { label: zh.notifySuccess, checked: task.notifications.onSuccess, disabled: busy || disabled || task.notifications.inApp !== true, onChange: (value) => set((current) => ({ notifications: { ...current.notifications, onSuccess: value } })) })),
    h('p', { className: 'capital-automation-hint' }, zh.notifyHint))
  const state = disabled
    ? 'disabled'
    : dirty && (saveState === 'idle' || saveState === 'saved')
      ? 'pending'
      : !dirty && saveState === 'pending'
        ? 'idle'
        : saveState
  const statusText = state === 'saving'
    ? zh.saving
    : state === 'error'
      ? `${zh.autosaveFailed}：${saveError || zh.errorGeneric}`
      : state === 'invalid'
        ? zh.autosaveInvalid
        : state === 'pending'
          ? zh.autosavePending
          : state === 'saved'
            ? zh.autosaveSaved
            : zh.noDirty
  const statusTone = state === 'error' ? 'error' : state === 'saved' ? 'ok' : undefined
  return h('div', { className: 'capital-automation-form' },
    h('div', { className: 'capital-automation-titlerow' },
      h(Field, {
        label: zh.titleField,
        error: titleError,
        note: zh.charCount.replace('{n}', String(Array.from(task.title ?? '').length)).replace('{max}', String(TITLE_MAX_LENGTH)),
      },
      h('input', {
        value: task.title,
        maxLength: TITLE_MAX_LENGTH,
        disabled: busy || disabled,
        'aria-invalid': titleError ? 'true' : undefined,
        onChange: (event) => set({ title: event.target.value }),
        onBlur: () => { touch('title'); flush() },
      })),
      h(SelectField, {
        label: zh.categoryField,
        title: task.origin === 'builtin' ? zh.categoryFixed : undefined,
        value: task.category,
        options: Object.entries(zh.category).map(([value, label]) => ({ value, label })),
        disabled: busy || disabled || task.origin === 'builtin',
        onChange: (category) => set({ category }),
      })),
    task.origin === 'custom'
      ? h('div', { className: 'capital-automation-iconrow' },
        h(IconPickerTrigger, {
          task,
          size: 38,
          disabled: busy || disabled,
          onChange: (icon) => set({ icon }),
        }),
        h('div', { className: 'capital-automation-iconrowbody' },
          h('span', { className: 'capital-automation-formlabel' }, zh.iconField),
          h('span', { className: 'capital-automation-hint' }, `${taskIcon(task).label} · ${zh.iconPickHint}`)))
      : h('p', { className: 'capital-automation-hint' }, zh.iconBuiltinHint),
    h(Field, {
      label: zh.descriptionField,
      note: zh.charCount.replace('{n}', String(Array.from(task.description ?? '').length)).replace('{max}', String(DESCRIPTION_MAX_LENGTH)),
    },
    h(PlainTextEditor, {
      className: 'capital-automation-texteditor capital-automation-descriptioninput',
      value: task.description ?? '',
      maxLength: DESCRIPTION_MAX_LENGTH,
      disabled: busy || disabled,
      placeholder: zh.descriptionPlaceholder,
      ariaLabel: zh.descriptionField,
      onChange: (description) => set({ description }),
      onBlur: flush,
    })),
    h('div', { className: 'capital-automation-instructionrow' },
      instructionEditor,
      instructionSide),
    advanced,
    notificationRows,
    h('div', { className: 'capital-automation-formactions', 'data-sticky': 'true' },
      h('span', { className: 'capital-automation-formstatus' }, disabled ? zh.storageUnavailable : zh.autosaveHint),
      state === 'disabled'
        ? null
        : h('span', {
          className: 'capital-automation-autosavestate',
          role: 'status',
          'data-tone': statusTone,
          title: state === 'error' ? saveError : undefined,
        }, statusText),
      state === 'error'
        ? h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', disabled: busy || disabled, onClick: retry }, zh.autosaveRetry)
        : null))
}

function NotificationsTab(props) {
  const { detail, busy, onMarkTaskRead } = props
  const items = detail.notifications
  const unread = items.filter((item) => item.readAt === undefined).length
  return h('section', { className: 'capital-automation-card capital-automation-panel' },
    h('div', { className: 'capital-automation-panelhead' },
      h('h3', null, zh.detailTaskNotifications),
      unread > 0
        ? h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', disabled: busy, onClick: onMarkTaskRead }, zh.markTaskRead)
        : null),
    items.length === 0
      ? h('p', { className: 'capital-automation-hint' }, zh.notificationsEmpty)
      : h('div', null, items.map((item) => h(NotificationItem, { key: item.id, item }))))
}

function NotificationItem(props) {
  const { item, onClick, onOpenTask } = props
  const clickable = typeof onClick === 'function' && item.taskId !== undefined
  const tag = clickable ? 'button' : 'div'
  return h(tag, {
    type: clickable ? 'button' : undefined,
    className: 'capital-automation-notification',
    'data-clickable': clickable ? 'true' : 'false',
    onClick: clickable ? onClick : undefined,
  },
  h('span', { className: 'capital-automation-notificationicon', 'data-tone': eventTone(item.kind) },
    eventTone(item.kind) === 'error' ? h(IconWarningOutlineRegular, { size: 15 }) : eventTone(item.kind) === 'warn' ? h(IconInfoOutlineRegular, { size: 15 }) : h(IconAlarmClockOutlineRegular, { size: 15 })),
  h('span', { className: 'capital-automation-notificationbody' },
    h('span', { className: 'capital-automation-notificationtitle' },
      item.title,
      item.readAt === undefined ? h('span', { className: 'capital-automation-count' }, zh.unread) : null),
    h('span', { className: 'capital-automation-notificationmessage' }, notificationMessage(item)),
    h('span', { className: 'capital-automation-notificationtime' }, formatShortTime(item.createdAt))),
  onOpenTask !== undefined && item.taskId !== undefined
    ? h('span', { className: 'capital-automation-hint' }, zh.notificationOpenTask)
    : null)
}

function DetailBar(props) {
  return h('div', { className: 'capital-automation-detailbar' },
    h('button', { type: 'button', className: 'capital-automation-back', onClick: props.onBack },
      h(IconChevronLeftOutlineRegular, { size: 14 }),
      zh.backToTasks))
}

function TaskDetailPage(props) {
  const { detail, meta, api, onChanged, openSession, tab, onTab, onRequestConfirm, onRequestCancelRun, schedulerActive, storageReady } = props
  const [draft, setDraft] = useState(null)
  const [savedTask, setSavedTask] = useState(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState('idle')
  const [saveError, setSaveError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const lastTaskIdRef = useRef(null)
  const activeTaskIdRef = useRef(null)
  const draftRef = useRef(null)
  const savedTaskRef = useRef(null)
  const ackedPayloadRef = useRef(null)
  const failedPayloadRef = useRef(null)
  const saveTimerRef = useRef(null)
  const saveInFlightRef = useRef(false)
  const saveQueuedRef = useRef(false)
  const savePromiseRef = useRef(null)
  const flushRef = useRef(null)
  const storageReadyNow = storageReady !== false
  activeTaskIdRef.current = detail.task?.id ?? null

  const updateDraft = (patch) => {
    const current = draftRef.current
    if (current === null) return
    const next = {
      ...current,
      ...(typeof patch === 'function' ? patch(current) : patch),
    }
    draftRef.current = next
    setDraft(next)
  }

  useEffect(() => {
    const server = detail.task
    if (!server) {
      savedTaskRef.current = null
      ackedPayloadRef.current = null
      setSavedTask(null)
      setDraft(null)
      draftRef.current = null
      return
    }
    const nextSaved = cloneTask(server)
    const previousAcked = ackedPayloadRef.current
    savedTaskRef.current = nextSaved
    ackedPayloadRef.current = payloadKey(nextSaved)
    setSavedTask(nextSaved)
    const current = draftRef.current
    if (current === null || current.id !== nextSaved.id) {
      draftRef.current = nextSaved
      setDraft(nextSaved)
      return
    }
    if (samePayload(current, nextSaved)) return
    // Hibernate clears overrides on the server; discard a local draft that a failed save
    // could otherwise resurrect after the task returns to its template defaults.
    if (nextSaved.state === 'dormant' && current.state !== 'dormant') {
      draftRef.current = nextSaved
      setDraft(nextSaved)
      return
    }
    // A poll or another action must not clobber edits the user has not saved yet.
    if (previousAcked !== null && payloadKey(current) === previousAcked) {
      draftRef.current = nextSaved
      setDraft(nextSaved)
    }
  }, [detail])

  useEffect(() => {
    const id = detail.task?.id ?? null
    if (lastTaskIdRef.current === id) return
    lastTaskIdRef.current = id
    setNotice('')
    setError('')
    setSaveState('idle')
    setSaveError('')
    failedPayloadRef.current = null
  }, [detail])

  useEffect(() => {
    if (draft === null || savedTask === null || storageReadyNow === false) return undefined
    if (samePayload(draft, savedTask)) {
      setSaveState((state) => (state === 'pending' || state === 'invalid' || state === 'error' ? 'idle' : state))
      return undefined
    }
    if (busy) return undefined
    if (Object.keys(draftIssues(draft, meta)).length > 0) {
      setSaveState('invalid')
      return undefined
    }
    if (failedPayloadRef.current !== null && payloadKey(draft) === failedPayloadRef.current) {
      setSaveState('error')
      return undefined
    }
    setSaveState((state) => (state === 'saving' ? state : 'pending'))
    saveTimerRef.current = setTimeout(() => { void flushRef.current?.() }, AUTOSAVE_DELAY_MS)
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [draft, savedTask, busy, storageReadyNow, meta])

  useEffect(() => {
    if (tab === 'config') return
    void flushRef.current?.()
  }, [tab])

  useEffect(() => () => { void flushRef.current?.() }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const onHide = () => { if (document.visibilityState === 'hidden') void flushRef.current?.() }
    document.addEventListener?.('visibilitychange', onHide)
    return () => document.removeEventListener?.('visibilitychange', onHide)
  }, [])

  if (draft === null) return h('p', { className: 'capital-automation-empty' }, zh.loading)
  const task = draft
  const running = detail.runs.some((run) => isActiveRun(run))
  const activeRun = detail.runs.find((run) => isActiveRun(run))
  const unread = detail.notifications.filter((item) => item.readAt === undefined).length
  const dirty = savedTask === null ? false : !samePayload(draft, savedTask)
  const canRun = storageReadyNow && schedulerActive === true && !running

  async function act(name, action, success) {
    if (busy) return
    setBusy(name)
    setError('')
    try {
      await action()
      await onChanged(detail.task.id)
      setNotice(success)
    } catch (failure) {
      setError(failure.message ?? zh.errorGeneric)
    } finally {
      setBusy('')
    }
  }

  async function flush() {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true
      return savePromiseRef.current ?? undefined
    }
    const current = draftRef.current
    const base = savedTaskRef.current
    if (current === null || base === null || storageReadyNow === false) return
    if (samePayload(current, base)) {
      setSaveState((state) => (state === 'saving' ? state : 'idle'))
      return
    }
    if (Object.keys(draftIssues(current, meta)).length > 0) {
      setSaveState('invalid')
      return
    }
    const payload = draftPayload(current)
    const taskId = current.id
    saveInFlightRef.current = true
    saveQueuedRef.current = false
    setSaveState('saving')
    setSaveError('')
    const savePromise = (async () => {
      try {
        const result = await api.patch(taskId, payload)
        if (activeTaskIdRef.current !== taskId) {
          void onChanged?.(taskId)
          return
        }
        const serverTask = result?.task
        const nextSaved = serverTask === undefined ? cloneTask({ ...base, ...payload }) : cloneTask(serverTask)
        savedTaskRef.current = nextSaved
        ackedPayloadRef.current = payloadKey(nextSaved)
        failedPayloadRef.current = null
        setSavedTask(nextSaved)
        setSaveState('saved')
        void onChanged?.(taskId)
      } catch (failure) {
        if (activeTaskIdRef.current === taskId) {
          failedPayloadRef.current = payloadKey(current)
          setSaveState('error')
          setSaveError(failure?.message ?? zh.errorGeneric)
        }
      } finally {
        saveInFlightRef.current = false
        const latest = draftRef.current
        const baseNow = savedTaskRef.current
        const queued = saveQueuedRef.current
        saveQueuedRef.current = false
        if (queued || (latest !== null && baseNow !== null && latest.id === baseNow.id && !samePayload(latest, baseNow) && failedPayloadRef.current === null)) {
          saveTimerRef.current = setTimeout(() => { void flushRef.current?.() }, 0)
        }
      }
    })()
    savePromiseRef.current = savePromise
    try {
      await savePromise
    } finally {
      if (savePromiseRef.current === savePromise) savePromiseRef.current = null
    }
  }
  flushRef.current = flush

  function retrySave() {
    failedPayloadRef.current = null
    setSaveError('')
    void flushRef.current?.()
  }

  async function flushBeforeAction() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await flushRef.current?.()
      const current = draftRef.current
      const base = savedTaskRef.current
      if (current === null || base === null) return true
      if (samePayload(current, base)) return true
      if (Object.keys(draftIssues(current, meta)).length > 0) return false
      if (failedPayloadRef.current !== null) return false
    }
    return false
  }

  async function toggleState() {
    const next = detail.task.state === 'active' ? 'pause' : 'activate'
    await act(next, async () => {
      await api.action(detail.task.id, next)
    }, next === 'pause' ? zh.paused.replace('{title}', detail.task.title) : activationNotice(detail.task))
  }

  async function runNow() {
    if (!(await flushBeforeAction())) {
      const current = draftRef.current
      setError(current !== null && Object.keys(draftIssues(current, meta)).length > 0 ? zh.autosaveInvalid : zh.autosaveFailed)
      return
    }
    await act('run', async () => {
      await api.run(detail.task.id)
    }, zh.runSubmitted.replace('{title}', detail.task.title))
  }

  async function markTaskRead() {
    const ids = detail.notifications.filter((item) => item.readAt === undefined).map((item) => item.id)
    if (ids.length === 0) return
    await act('read-notifications', async () => {
      await api.markRead({ ids })
    }, zh.markReadDone)
  }

  async function copyTask() {
    if (!(await flushBeforeAction())) {
      const current = draftRef.current
      setError(current !== null && Object.keys(draftIssues(current, meta)).length > 0 ? zh.autosaveInvalid : zh.autosaveFailed)
      return
    }
    await act('copy', async () => {
      await api.action(detail.task.id, 'copy')
    }, zh.copied.replace('{title}', detail.task.title))
  }

  const runButton = running
    ? h('button', {
      type: 'button',
      className: 'capital-automation-btn',
      'data-variant': 'danger',
      disabled: busy || !storageReadyNow || activeRun === undefined,
      onClick: () => { if (activeRun !== undefined) onRequestCancelRun(activeRun) },
    }, zh.cancelRun)
    : h('button', {
      type: 'button',
      className: 'capital-automation-btn',
      'data-variant': detail.task.state === 'active' ? 'primary' : undefined,
      disabled: busy || !canRun,
      title: schedulerActive === false ? zh.schedulerBlocked : running ? zh.runBlocked : undefined,
      onClick: () => { void runNow() },
    }, h(IconPlayOutlineRegular, { size: 14 }), zh.runNow)

  return h('div', null,
    h('div', { className: 'capital-automation-hero' },
      h(Glyph, { task, large: true }),
      h('div', { className: 'capital-automation-herobody' },
        h('div', { className: 'capital-automation-herotitle' },
          h('h2', null, detail.task.title),
          h(StateBadge, { state: detail.task.state, running }),
          unread > 0 ? h('span', { className: 'capital-automation-count', title: zh.unread }, String(unread)) : null),
        h('p', { className: 'capital-automation-herodesc' }, detail.task.description || zh.subtitle)),
      h('div', { className: 'capital-automation-heroactions' },
        runButton,
        running
          ? null
          : h('button', {
            type: 'button',
            className: 'capital-automation-btn',
            'data-variant': detail.task.state === 'active' ? undefined : 'primary',
            disabled: busy || !storageReadyNow,
            onClick: () => { void toggleState() },
          }, h(activationIcon(detail.task), { size: 14 }), activationLabel(detail.task)),
        h(TaskActionsMenu, {
          task: detail.task,
          open: menuOpen,
          onToggle: () => setMenuOpen((current) => !current),
          onClose: () => setMenuOpen(false),
          onEdit: () => { setMenuOpen(false); onTab('config') },
          onAction: (target, id) => {
            if (id === 'run') void runNow()
            else if (id === 'copy') void copyTask()
            else if (id === 'activate' || id === 'pause') void toggleState()
          },
          onRequestConfirm: (kind, target) => {
            setMenuOpen(false)
            // A pending autosave must not land after hibernate clears the overrides.
            if (kind === 'hibernate' || kind === 'delete') {
              void (async () => {
                await flushBeforeAction()
                onRequestConfirm(kind, target)
              })()
              return
            }
            onRequestConfirm(kind, target)
          },
          canRun,
          running,
          busy: busy.length > 0,
          disabled: !storageReadyNow,
          align: 'end',
        }))),
    h('div', { className: 'capital-automation-detailtabs', role: 'tablist', 'aria-label': zh.details },
      [['overview', zh.overview], ['config', zh.config], ['runs', zh.runs], ['notifications', zh.notifications]].map(([id, label]) => h('button', {
        key: id,
        type: 'button',
        role: 'tab',
        className: 'capital-automation-detailtab',
        'aria-selected': tab === id ? 'true' : 'false',
        onClick: () => onTab(id),
      }, label))),
    notice.length > 0 || error.length > 0
      ? h('div', { style: { paddingTop: 12 } },
        notice.length > 0 ? h('p', { className: 'capital-automation-notice', role: 'status' }, notice) : null,
        error.length > 0 ? h('p', { className: 'capital-automation-error', role: 'alert' }, error) : null)
      : null,
    running ? h('p', { className: 'capital-automation-hint', style: { paddingTop: 10 } }, zh.configWhileRunning) : null,
    h('div', { className: 'capital-automation-detailbody' },
      tab === 'overview' ? h(OverviewTab, {
        detail,
        meta,
        onGoRuns: () => onTab('runs'),
        onCancelRun: onRequestCancelRun,
        onOpenSession: openSession,
      }) : null,
      tab === 'config' ? h(ConfigTab, {
        draft,
        setDraft: updateDraft,
        meta,
        busy,
        dirty,
        saveState,
        saveError,
        retry: retrySave,
        onFlush: () => { void flushRef.current?.() },
        disabled: !storageReadyNow,
      }) : null,
      tab === 'runs' ? h('section', { className: 'capital-automation-card capital-automation-panel' },
        h('div', { className: 'capital-automation-panelhead' },
          h('h3', null, zh.runs),
          h('span', { className: 'capital-automation-hint' }, zh.taskRunsLimit)),
        h(RunList, {
          runs: detail.runs,
          tasks: [detail.task],
          onCancel: (run) => onRequestCancelRun(run),
          onOpenSession: openSession,
          busy: busy.length > 0,
        })) : null,
      tab === 'notifications' ? h(NotificationsTab, {
        detail,
        busy: busy.length > 0,
        onMarkTaskRead: () => { void markTaskRead() },
      }) : null))
}

function NewTaskModal(props) {
  const { open, onClose, api, onCreated, meta } = props
  const [draft, setDraft] = useState(() => defaultDraft(meta))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { issues, errorFor, touch, touchAll } = useDraftIssues(draft, open, meta)
  const titleError = errorFor('title')
  const instructionError = errorFor('instruction')
  useEffect(() => {
    if (!open) return
    setDraft(defaultDraft(meta))
    setBusy(false)
    setError('')
  }, [open])
  const set = (patch) => setDraft((current) => ({
    ...current,
    ...(typeof patch === 'function' ? patch(current) : patch),
  }))
  const timeoutRange = limitValue(meta, 'runTimeoutMinutes', [5, 120])
  const idleRange = limitValue(meta, 'idleTimeoutMinutes', [1, 30])
  const stepsRange = limitValue(meta, 'maxSteps', [100, 2000])
  const toolsRange = limitValue(meta, 'maxToolCalls', [100, 5000])
  async function create() {
    if (Object.keys(issues).length > 0) {
      touchAll()
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload = await api.create(draftPayload(draft))
      onCreated(payload?.task?.id ?? null)
    } catch (failure) {
      setError(failure.message ?? zh.errorGeneric)
    } finally {
      setBusy(false)
    }
  }
  if (!open) return null
  return h(Modal, {
    open,
    onClose: () => { if (!busy) onClose() },
    title: zh.newTaskTitle,
    closeLabel: zh.close,
    className: 'capital-automation-modal capital-automation-modal-wizard',
    contentClassName: 'capital-automation-modal-content',
    footer: h('div', { className: 'capital-automation-formactions', style: { borderTop: 0, paddingTop: 0 } },
      h('button', { type: 'button', className: 'capital-automation-btn', disabled: busy, onClick: onClose }, zh.cancel),
      h('button', { type: 'button', className: 'capital-automation-btn', 'data-variant': 'primary', disabled: busy || meta?.storage?.state === 'unavailable', onClick: create }, busy ? zh.creating : zh.create)),
  },
  h('div', { className: 'capital-automation-wizard' },
    h('div', { className: 'capital-automation-modalheadline', 'data-invalid': titleError ? 'true' : undefined },
      h(IconPickerTrigger, { task: draft, size: 42, onChange: (icon) => set({ icon }) }),
      h('input', {
        className: 'capital-automation-modaltitleinput',
        value: draft.title,
        maxLength: TITLE_MAX_LENGTH,
        placeholder: zh.titlePlaceholder,
        'aria-label': zh.titleField,
        'aria-invalid': titleError ? 'true' : undefined,
        onChange: (event) => set({ title: event.target.value }),
        onBlur: () => touch('title'),
      })),
    titleError ? h('span', { className: 'capital-automation-fielderror', role: 'alert' }, titleError) : null,
    h(Field, {
      label: zh.descriptionField,
      note: zh.charCount.replace('{n}', String(Array.from(draft.description ?? '').length)).replace('{max}', String(DESCRIPTION_MAX_LENGTH)),
    },
    h('input', {
      value: draft.description,
      maxLength: DESCRIPTION_MAX_LENGTH,
      placeholder: zh.descriptionPlaceholder,
      onChange: (event) => set({ description: event.target.value }),
    })),
    h('div', null,
      h('span', { className: 'capital-automation-formlabel' }, zh.triggerField),
      h(TriggerFields, { trigger: draft.trigger, onChange: (trigger) => set({ trigger }), meta, errorFor, touch })),
    h('div', null,
      h('span', { className: 'capital-automation-formlabel' }, zh.instructionField),
      h('div', { className: 'capital-automation-promptfield', 'data-invalid': instructionError ? 'true' : undefined },
        h('div', { className: 'capital-automation-promptbox' },
          h(PlainTextEditor, {
            className: 'capital-automation-texteditor',
            value: draft.instruction,
            maxLength: INSTRUCTION_MAX_LENGTH,
            placeholder: zh.instructionPlaceholder,
            ariaLabel: zh.instructionField,
            invalid: instructionError ? true : undefined,
            onChange: (instruction) => set({ instruction }),
            onBlur: () => touch('instruction'),
          }),
          h('div', { className: 'capital-automation-prompttoolbar' },
            h('div', { className: 'capital-automation-toolbarfield' },
              h(IconFolderOpenOutlineRegular, { size: 13 }),
              h('span', null, zh.workspaceField),
              h(Select, {
                value: draft.workspaceId ?? '',
                options: workspaceOptions(meta, draft.workspaceId).map((option) => ({ value: option.id, label: option.title })),
                onChange: (workspaceId) => set({ workspaceId }),
                label: zh.workspaceField,
                size: 'sm',
                align: 'end',
              })),
            h('div', { className: 'capital-automation-toolbarfield' },
              h('span', null, zh.categoryField),
              h(Select, {
                value: draft.category,
                options: Object.entries(zh.category).map(([value, label]) => ({ value, label })),
                onChange: (category) => set({ category }),
                label: zh.categoryField,
                size: 'sm',
                align: 'end',
              })),
            h('span', { className: 'capital-automation-presetchip', title: zh.presetHint },
              h(IconSparkleRegular, { size: 12 }),
              zh.presetValue))),
        instructionError ? h('span', { className: 'capital-automation-fielderror', role: 'alert' }, instructionError) : null)),
    meta?.workspaceError ? h('p', { className: 'capital-automation-hint', 'data-tone': 'error' }, zh.workspaceUnavailable) : null,
    h('details', { className: 'capital-automation-advanced' },
      h('summary', null, zh.advanced),
      h('div', { className: 'capital-automation-advancedbody' },
        h('div', { className: 'capital-automation-formgrid' },
          h(NumberField, { label: zh.runTimeout, value: draft.limits.runTimeoutMinutes, min: timeoutRange[0], max: timeoutRange[1], error: errorFor('runTimeoutMinutes'), onBlur: () => touch('runTimeoutMinutes'), onChange: (value) => set((current) => ({ limits: { ...current.limits, runTimeoutMinutes: value } })) }),
          h(NumberField, { label: zh.idleTimeout, value: draft.limits.idleTimeoutMinutes, min: idleRange[0], max: idleRange[1], error: errorFor('idleTimeoutMinutes'), onBlur: () => touch('idleTimeoutMinutes'), onChange: (value) => set((current) => ({ limits: { ...current.limits, idleTimeoutMinutes: value } })) }),
          h(NumberField, { label: zh.maxSteps, value: draft.limits.maxSteps, min: stepsRange[0], max: stepsRange[1], error: errorFor('maxSteps'), onBlur: () => touch('maxSteps'), onChange: (value) => set((current) => ({ limits: { ...current.limits, maxSteps: value } })) }),
          h(NumberField, { label: zh.maxToolCalls, value: draft.limits.maxToolCalls, min: toolsRange[0], max: toolsRange[1], error: errorFor('maxToolCalls'), onBlur: () => touch('maxToolCalls'), onChange: (value) => set((current) => ({ limits: { ...current.limits, maxToolCalls: value } })) })),
        h('p', { className: 'capital-automation-hint' }, zh.advancedHint))),
    h('div', null,
      h('span', { className: 'capital-automation-formlabel' }, zh.notifyField),
      h('div', { className: 'capital-automation-switchlist' },
        h(SwitchRow, { label: zh.notifyInApp, checked: draft.notifications.inApp, onChange: (value) => set((current) => ({ notifications: { ...current.notifications, inApp: value } })) }),
        h(SwitchRow, { label: zh.notifyFailure, checked: draft.notifications.onFailure, disabled: draft.notifications.inApp !== true, onChange: (value) => set((current) => ({ notifications: { ...current.notifications, onFailure: value } })) }),
        h(SwitchRow, { label: zh.notifySuccess, checked: draft.notifications.onSuccess, disabled: draft.notifications.inApp !== true, onChange: (value) => set((current) => ({ notifications: { ...current.notifications, onSuccess: value } })) })),
      h('p', { className: 'capital-automation-hint' }, zh.notifyHint)),
    error.length > 0 ? h('p', { className: 'capital-automation-error', role: 'alert' }, error) : null))
}

function ConfirmModal(props) {
  const { confirm, busy, error, onCancel, onConfirm } = props
  const open = confirm !== null
  const cancelling = confirm?.kind === 'cancel-run'
  const deleting = confirm?.kind === 'delete'
  const title = cancelling ? zh.cancelRunConfirmTitle : deleting ? zh.confirmDeleteTitle : zh.confirmHibernateTitle
  const body = cancelling ? zh.cancelRunConfirmBody : deleting ? zh.confirmDeleteBody : zh.confirmHibernateBody
  const confirmLabel = cancelling ? zh.cancelRunConfirm : deleting ? zh.confirmDelete : zh.confirmHibernate
  return h(Modal, {
    open,
    onClose: () => { if (!busy) onCancel() },
    title,
    closeLabel: zh.close,
    className: 'capital-automation-modal capital-automation-modal-narrow',
    footer: h('div', { className: 'capital-automation-formactions', style: { borderTop: 0, paddingTop: 0 } },
      h('button', { type: 'button', className: 'capital-automation-btn', disabled: busy, onClick: onCancel }, zh.cancel),
      h('button', {
        type: 'button',
        className: 'capital-automation-btn',
        'data-variant': 'danger',
        disabled: busy,
        onClick: onConfirm,
      }, busy ? zh.processing : confirmLabel)),
  },
  h('div', null,
    h('p', { className: 'capital-automation-policy' }, body),
    error.length > 0 ? h('p', { className: 'capital-automation-error', role: 'alert', style: { marginTop: 8 } }, error) : null))
}

function InboxModal(props) {
  const { open, onClose, notifications, onMarkAllRead, onOpenTask, busy } = props
  const unread = notifications.filter((item) => item.readAt === undefined).length
  return h(Modal, {
    open,
    onClose,
    title: zh.notificationsTitle,
    closeLabel: zh.close,
    className: 'capital-automation-modal',
    contentClassName: 'capital-automation-modal-content',
    footer: h('div', { className: 'capital-automation-formactions', style: { borderTop: 0, paddingTop: 0 } },
      h('span', { className: 'capital-automation-formstatus' },
        unread > 0 ? zh.notificationsUnread.replace('{n}', String(unread)) : notifications.length > 0 ? zh.allRead : zh.notificationsEmpty),
      h('button', { type: 'button', className: 'capital-automation-btn', disabled: busy || unread === 0, onClick: onMarkAllRead }, zh.markRead),
      h('button', { type: 'button', className: 'capital-automation-btn', 'data-variant': 'primary', onClick: onClose }, zh.close)),
  },
  notifications.length === 0
    ? h('div', { className: 'capital-automation-empty' },
      h('span', { className: 'capital-automation-emptyicon' }, h(IconAlarmClockOutlineRegular, { size: 19 })),
      h('h3', null, zh.notificationsEmpty),
      h('p', null, zh.notificationsHint))
    : h('div', null,
      h('p', { className: 'capital-automation-hint', style: { marginBottom: 4 } }, zh.notificationsHint),
      notifications.map((item) => h(NotificationItem, {
        key: item.id,
        item,
        onOpenTask: onOpenTask,
        onClick: item.taskId === undefined ? undefined : () => onOpenTask(item.taskId),
      }))))
}

function browserTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof zone === 'string' && zone.length > 0 ? zone : 'Asia/Shanghai'
  } catch {
    return 'Asia/Shanghai'
  }
}

function boardRelativeTime(value, now = Date.now()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Math.max(0, now - date.getTime())
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  const month = 30 * day
  const year = 365 * day
  if (diff < minute) return zh.relativeNow
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`
  if (diff < day) return `${Math.floor(diff / hour)}小时前`
  if (diff < week) return `${Math.floor(diff / day)}天前`
  if (diff < month) return `${Math.floor(diff / week)}周前`
  if (diff < year) return `${Math.floor(diff / month)}个月前`
  return `${Math.floor(diff / year)}年前`
}

function boardTodoPeriod(item, now = new Date()) {
  const today = localDateKey(now)
  if (typeof item.dueAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueAt)) {
    if (item.dueAt < today) return 'expired'
    if (item.dueAt === today) return 'today'
    // Future dates are not today's action items; they become today on the date itself.
    return 'future'
  }
  const label = typeof item.dueLabel === 'string' ? item.dueLabel.trim() : ''
  const seen = typeof item.finishedAt === 'string' ? new Date(item.finishedAt) : null
  const seenToday = seen !== null && !Number.isNaN(seen.getTime()) && localDateKey(seen) === today
  if (['尽快', '马上', '现在'].includes(label)) return seenToday ? 'today' : 'future'
  if (['今天', '今日'].includes(label)) return seenToday ? 'today' : 'expired'
  return 'future'
}

function boardTodoTodayCount(todos, now = new Date()) {
  return todos.filter((item) => boardTodoPeriod(item, now) === 'today').length
}

function boardTodoGroupLabel(period) {
  if (period === 'today') return zh.board.dueToday
  if (period === 'expired') return zh.board.dueExpired
  return zh.board.dueFuture
}

function boardTodoFilterOptions() {
  return BOARD_TODO_PERIODS.map((period) => ({ value: period, label: boardTodoGroupLabel(period) }))
}

function boardTodoDueLabel(item, period) {
  const date = typeof item.dueAt === 'string' && item.dueAt.length >= 10 ? item.dueAt.slice(5) : ''
  if (period === 'today') {
    const label = typeof item.dueLabel === 'string' ? item.dueLabel.trim() : ''
    return ['尽快', '马上', '现在'].includes(label) && date.length === 0 ? zh.board.dueAsap : zh.board.dueToday
  }
  if (period === 'expired') return date ? `${zh.board.dueExpired} · ${date}` : zh.board.dueExpired
  return date || zh.board.dueNoDate
}

function boardTodoKindLabel(kind) {
  if (kind === 'confirm') return zh.board.todoConfirm
  if (kind === 'verify') return zh.board.todoVerify
  return zh.board.todoTrack
}

function boardCategoryOptions() {
  return [{ value: 'all', label: zh.board.allCategories }].concat(
    Object.entries(zh.category).map(([value, label]) => ({ value, label })),
  )
}

function boardRangeOptions() {
  return [
    { value: '7', label: zh.board.range7 },
    { value: '14', label: zh.board.range14 },
    { value: '30', label: zh.board.range30 },
    { value: 'all', label: zh.board.rangeAll },
  ]
}

function boardQueryOf(range, category, before) {
  const params = new URLSearchParams()
  params.set('days', range)
  params.set('tz', browserTimeZone())
  params.set('limit', '30')
  if (category !== 'all') params.set('category', category)
  if (typeof before === 'string' && before.length > 0) params.set('before', before)
  return `?${params.toString()}`
}

function readBoardUi() {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(BOARD_UI_KEY) ?? '{}')
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveBoardUi(patch) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(BOARD_UI_KEY, JSON.stringify({ ...readBoardUi(), ...patch }))
  } catch {
    // A blocked localStorage must not break the board.
  }
}

function boardPanelFlags(value) {
  const saved = value !== null && typeof value === 'object' ? value : null
  const flags = { todo: true, stocks: true, gaps: false, health: false }
  if (saved === null) return flags
  for (const key of BOARD_PANEL_KEYS) flags[key] = saved[key] === true
  return flags
}

function boardPanelKey(id) {
  return BOARD_PANEL_IDS[id] ?? null
}

function BoardEmpty(props) {
  const { hasActiveTasks, storageReady, onGoTasks, onNewTask } = props
  return h('section', { className: 'capital-automation-boardempty', 'aria-labelledby': 'capital-automation-boardempty-title' },
    h('span', { className: 'capital-automation-boardemptyicon', 'aria-hidden': 'true' }, h(IconSparkleRegular, { size: 22 })),
    h('h2', { id: 'capital-automation-boardempty-title' }, zh.board.emptyTitle),
    storageReady === false ? h('p', null, zh.storageBanner) : null,
    h('div', { className: 'capital-automation-boardemptyactions' },
      h('button', {
        type: 'button',
        className: 'capital-automation-btn',
        'data-variant': 'primary',
        disabled: storageReady === false,
        onClick: onGoTasks,
      }, hasActiveTasks ? zh.board.goTasks : zh.board.goEnable),
      h('button', {
        type: 'button',
        className: 'capital-automation-btn',
        disabled: storageReady === false,
        onClick: onNewTask,
      }, zh.board.newTask)),
    h('p', { className: 'capital-automation-boardemptyhint' }, zh.board.emptyHint))
}

function BoardStats(props) {
  const { stats, onJump } = props
  const items = [
    { id: 'capital-automation-briefs', label: zh.board.statsBriefs, value: stats?.briefs ?? 0 },
    { id: 'capital-automation-todo', label: zh.board.statsTodos, value: stats?.todos ?? 0 },
    { id: 'capital-automation-stocks', label: zh.board.statsStocks, value: stats?.stocks ?? 0 },
    { id: 'capital-automation-gaps', label: zh.board.statsGaps, value: stats?.gaps ?? 0 },
    { id: 'capital-automation-health', label: zh.board.statsIssues, value: stats?.issues7d ?? 0 },
  ]
  const jump = (id) => {
    if (typeof document === 'undefined') return
    const node = document.getElementById(id)
    if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  const activate = typeof onJump === 'function' ? onJump : jump
  return h('div', { className: 'capital-automation-boardstats', role: 'group', 'aria-label': zh.board.title },
    items.map((item) => h('button', {
      key: item.id,
      type: 'button',
      className: 'capital-automation-boardstat',
      onClick: () => activate(item.id),
    }, h('span', { className: 'capital-automation-boardstatlabel' }, item.label), h('strong', null, String(item.value)))))
}

function BoardToolbar(props) {
  const { range, category, loading, onRange, onCategory, onRefresh, railOpen, onToggleRail } = props
  return h('div', { className: 'capital-automation-boardtoolbar' },
    h('div', { className: 'capital-automation-boardtools' },
      h(Select, {
        value: range,
        options: boardRangeOptions(),
        onChange: onRange,
        label: zh.board.range,
        size: 'sm',
      }),
      h(Select, {
        value: category,
        options: boardCategoryOptions(),
        onChange: onCategory,
        label: zh.board.category,
        size: 'sm',
      })),
    h('div', { className: 'capital-automation-boardactions' },
      h('button', {
        type: 'button',
        className: 'capital-automation-btn',
        'data-size': 'sm',
        disabled: loading === true,
        onClick: onRefresh,
        title: zh.board.refresh,
        'aria-label': zh.board.refresh,
      }, h(IconRefreshOutlineRegular, { size: 13 }), h('span', { className: 'capital-automation-btnlabel' }, zh.board.refresh)),
      h('button', {
        type: 'button',
        className: 'capital-automation-btn',
        'data-size': 'sm',
        'aria-expanded': railOpen === true ? 'true' : 'false',
        'aria-controls': 'capital-automation-boardrail',
        onClick: onToggleRail,
      },
      h(railOpen === true ? IconChevronRightOutlineRegular : IconChevronLeftOutlineRegular, { size: 13 }),
      h('span', { className: 'capital-automation-btnlabel' }, railOpen === true ? zh.board.hideRail : zh.board.showRail))))
}

function AskExchange(props) {
  const { ask, api } = props
  const [expanded, setExpanded] = useState(false)
  const [full, setFull] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setExpanded(false)
    setFull('')
    setTruncated(false)
    setLoading(false)
    setError('')
  }, [ask?.id])

  async function toggle() {
    if (expanded) {
      setExpanded(false)
      return
    }
    if (full.length > 0) {
      setExpanded(true)
      return
    }
    if (typeof api?.askAnswer !== 'function') {
      setError(zh.errorGeneric)
      return
    }
    setLoading(true)
    setError('')
    try {
      const payload = await api.askAnswer(ask.id)
      if (typeof payload?.answer === 'string' && payload.answer.length > 0) {
        setFull(payload.answer)
        setTruncated(payload.truncated === true)
        setExpanded(true)
      } else {
        setError(zh.errorGeneric)
      }
    } catch (failure) {
      setError(failure?.message ?? zh.errorGeneric)
    } finally {
      setLoading(false)
    }
  }

  const ready = ask.status === 'ready'
  const canExpand = ready && typeof ask.preview === 'string' && ask.preview.endsWith('…')
  const fullText = expanded && full.length > 0
  return h('div', { className: 'capital-automation-askthread', 'data-status': ask.status },
    h('div', { className: 'capital-automation-askuser' },
      h('p', { className: 'capital-automation-askquestion', title: ask.question }, ask.question)),
    h('div', { className: 'capital-automation-askreply', 'data-status': ask.status },
      ready
        ? h('p', { className: fullText ? 'capital-automation-askfull' : 'capital-automation-askpreview' },
          fullText ? full : (ask.preview ?? ''))
        : ask.status === 'failed'
          ? h('p', { className: 'capital-automation-askerror' }, ask.error ?? zh.board.askFailed)
          : h('p', { className: 'capital-automation-askhint', role: 'status' }, zh.board.askPending),
      canExpand
        ? h('button', {
          type: 'button',
          className: 'capital-automation-btn capital-automation-askaction',
          'data-size': 'sm',
          'data-variant': 'ghost',
          'data-expanded': fullText ? 'true' : 'false',
          disabled: loading,
          onClick: toggle,
        }, loading ? zh.loading : fullText ? zh.board.askCollapse : zh.board.askMore,
        loading || fullText ? null : h(IconChevronDownOutlineRegular, { size: 12 }))
        : null,
      error.length > 0 ? h('p', { className: 'capital-automation-askerror', role: 'alert' }, error) : null,
      truncated ? h('p', { className: 'capital-automation-askhint' }, '回答过长，已截断；完整内容请打开 session 查看。') : null))
}

function AskDialog(props) {
  const { open, onClose, card, identity, ask, api, question, onQuestionChange, onSubmit, busy, error, onOpenSession } = props
  const inputRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const timer = setTimeout(() => inputRef.current?.focus?.(), 0)
    return () => clearTimeout(timer)
  }, [open])
  if (!open) return null
  const brief = card.brief
  const status = brief?.status ?? 'pending'
  const sessionId = card.sessionId
  const openSession = typeof onOpenSession === 'function' && typeof sessionId === 'string' && sessionId.length > 0
    ? () => onOpenSession(sessionId)
    : null
  const trigger = card.trigger === 'manual' ? zh.triggerManual : zh.triggerScheduled
  const relativeTime = boardRelativeTime(card.finishedAt)
  const exactTime = formatTime(card.finishedAt)
  const running = ask?.status === 'running'
  let context
  if (status === 'ready') {
    context = h('div', null,
      h('h3', null, brief.headline),
      h('p', { className: 'capital-automation-chatcontexttext' }, brief.plain))
  } else if (status === 'failed') {
    context = h('div', null,
      h('p', { className: 'capital-automation-chatcontexttext' }, zh.board.briefFailed),
      h('p', { className: 'capital-automation-askhint' }, brief?.error ?? zh.errorGeneric))
  } else if (status === 'skipped') {
    context = h('p', { className: 'capital-automation-chatcontexttext' }, zh.board.briefSkipped)
  } else {
    context = h('p', { className: 'capital-automation-chatcontexttext' }, zh.board.briefPending)
  }
  return h(Modal, {
    open,
    headless: true,
    onClose,
    title: zh.board.askDialogTitle,
    closeLabel: zh.close,
    className: 'capital-automation-modal capital-automation-modal-chat',
  },
  h('div', { className: 'capital-automation-chatshell' },
    h('header', { className: 'capital-automation-chathead' },
      h('button', {
        type: 'button',
        className: 'capital-automation-chaticonbtn',
        title: zh.close,
        'aria-label': zh.close,
        onClick: onClose,
      }, h(IconCloseOutlineRegular, { size: 18 })),
      openSession
        ? h('button', {
          type: 'button',
          className: 'capital-automation-chaticonbtn',
          title: zh.openSession,
          'aria-label': zh.openSession,
          onClick: openSession,
        }, h(IconRightUpOutlineRegular, { size: 18 }))
        : null),
    h('div', { className: 'capital-automation-chatscroll' },
      h('div', { className: 'capital-automation-chatcontext' },
        h(Glyph, { task: identity ?? card, size: 38, radius: 999, glyphSize: 18 }),
        h('div', { className: 'capital-automation-chatcontextbody' },
          h('div', { className: 'capital-automation-chatcontexthead' },
            h('strong', null, card.taskTitle),
            h('span', { className: 'capital-automation-chatcontextmeta' },
              `${categoryLabel(card.category)} · ${trigger} · `,
              h('time', { dateTime: card.finishedAt, title: exactTime }, relativeTime))),
          context)),
      ask !== null
        ? h('div', { className: 'capital-automation-chatthread' }, h(AskExchange, { key: ask.id, ask, api }))
        : h('div', { className: 'capital-automation-chatempty' },
          h('p', null, zh.board.askEmptyTitle)),
      error.length > 0 ? h('p', { className: 'capital-automation-askerror', role: 'alert' }, error) : null),
    h('form', { className: 'capital-automation-chatcomposer', onSubmit },
      h('input', {
        ref: inputRef,
        type: 'text',
        className: 'capital-automation-askinput',
        value: question,
        maxLength: 500,
        enterKeyHint: 'send',
        placeholder: running ? zh.board.askPending : zh.board.askPlaceholder,
        'aria-label': zh.board.askLabel,
        disabled: busy || running,
        onChange: (event) => onQuestionChange(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Enter' && event.nativeEvent?.isComposing === true) event.preventDefault()
        },
      }),
      h('button', {
        type: 'submit',
        className: 'capital-automation-btn capital-automation-chatsend',
        'data-variant': 'primary',
        disabled: busy || running || question.trim().length === 0,
      }, busy ? zh.processing : zh.board.askSubmit))))
}

function AskDock(props) {
  const { card, identity, api, onOpenSession, open, onClose } = props
  const [latest, setLatest] = useState(card.ask ?? null)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const incoming = card.ask ?? null

  useEffect(() => {
    setLatest((current) => {
      // A board refresh can trail a just-created/resolved local ask; never drop or roll it back.
      if (incoming === null) return current
      if (current === null || current.id !== incoming.id) {
        if (current !== null && String(current.createdAt ?? '') > String(incoming.createdAt ?? '')) return current
        return incoming
      }
      if (current.status !== 'running' && incoming.status === 'running') return current
      return incoming
    })
  }, [incoming?.id, incoming?.status, incoming?.preview, incoming?.error])

  useEffect(() => {
    if (!open) return
    setQuestion('')
    setError('')
  }, [open])

  useEffect(() => {
    if (latest === null || latest.status !== 'ready' || typeof api?.askStatus !== 'function') return undefined
    if (typeof latest.preview !== 'string' || !latest.preview.endsWith('…') || Array.from(latest.preview).length > 80) return undefined
    let cancelled = false
    api.askStatus(latest.id).then((payload) => {
      if (!cancelled && payload?.ask) setLatest(payload.ask)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [latest?.id, latest?.status, latest?.preview, api])

  useEffect(() => {
    if (latest === null || latest.status !== 'running' || typeof api?.askStatus !== 'function') return undefined
    let cancelled = false
    let timer
    const poll = async () => {
      try {
        const payload = await api.askStatus(latest.id)
        if (cancelled) return
        if (payload?.ask) setLatest(payload.ask)
      } catch {
        // The dialog shows the actionable error; the card preview keeps its last known state.
      } finally {
        if (!cancelled) timer = setTimeout(poll, 2_000)
      }
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [latest?.id, latest?.status, api])

  async function submit(event) {
    event.preventDefault()
    const text = question.trim()
    const running = latest?.status === 'running'
    if (text.length === 0 || busy || running) return
    if (typeof api?.askBrief !== 'function') {
      setError(zh.errorGeneric)
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload = await api.askBrief(card.runId, text, browserTimeZone())
      if (payload?.ask) {
        setLatest(payload.ask)
        setQuestion('')
      } else {
        setError(zh.errorGeneric)
      }
    } catch (failure) {
      setError(failure?.message ?? zh.errorGeneric)
    } finally {
      setBusy(false)
    }
  }

  const requestClose = () => {
    if (!busy) onClose()
  }
  const dialog = h(AskDialog, {
    open,
    onClose: requestClose,
    card,
    identity,
    ask: latest,
    api,
    question,
    onQuestionChange: setQuestion,
    onSubmit: submit,
    busy,
    error,
    onOpenSession,
  })
  if (latest === null) return dialog
  return h('div', { className: 'capital-automation-askdock' },
    h(AskExchange, { key: latest.id, ask: latest, api }),
    dialog)
}

function BriefCard(props) {
  const { card, task, api, onOpenSession, onRetry, retrying } = props
  const [askOpen, setAskOpen] = useState(false)
  // Older /board payloads omit icon/origin; the task list carries the same identity.
  const identity = typeof card.icon === 'string' ? card : (task ?? card)
  const brief = card.brief
  const status = brief?.status ?? 'pending'
  const titleId = `capital-automation-brief-${card.runId}`
  const sessionId = card.sessionId
  const openSession = sessionId ? () => onOpenSession(sessionId) : null
  const openIcon = openSession
    ? h('button', {
      type: 'button',
      className: 'capital-automation-btn',
      'data-size': 'icon',
      title: zh.openSession,
      'aria-label': zh.openSession,
      onClick: openSession,
    }, h(IconRightUpOutlineRegular, { size: 14 }))
    : null
  const askIcon = sessionId
    ? h('button', {
      type: 'button',
      className: 'capital-automation-btn',
      'data-size': 'icon',
      title: zh.board.askDialogTitle,
      'aria-label': `${zh.board.askDialogTitle}：${card.taskTitle ?? ''}`,
      onClick: () => setAskOpen(true),
    }, h(IconNewChatOutlineRegular, { size: 14 }))
    : null
  const openLink = openSession
    ? h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', onClick: openSession }, zh.openSession)
    : null
  const trigger = card.trigger === 'manual' ? zh.triggerManual : zh.triggerScheduled
  const relativeTime = boardRelativeTime(card.finishedAt)
  const exactTime = formatTime(card.finishedAt)
  let body
  if (status === 'ready') {
    body = h('div', { className: 'capital-automation-briefbody' },
      h('h4', null, brief.headline),
      h('p', { className: 'capital-automation-brieftext' }, brief.plain))
  } else if (status === 'failed') {
    body = h('div', { className: 'capital-automation-briefstate', 'data-tone': 'error' },
      h('p', null, zh.board.briefFailed),
      h('p', { className: 'capital-automation-hint' }, brief?.error ?? zh.errorGeneric),
      h('div', { className: 'capital-automation-briefactions' },
        h('button', {
          type: 'button',
          className: 'capital-automation-btn',
          'data-size': 'sm',
          disabled: retrying === true,
          onClick: () => onRetry(card.runId),
        }, retrying === true ? zh.processing : zh.board.retry),
        openLink))
  } else if (status === 'skipped') {
    body = h('div', { className: 'capital-automation-briefstate' },
      h('p', null, zh.board.briefSkipped),
      h('div', { className: 'capital-automation-briefactions' }, openLink))
  } else {
    body = h('div', { className: 'capital-automation-briefstate' },
      h(SkeletonBlock, { width: '72%', height: 14 }),
      h(SkeletonBlock, { width: '100%', height: 10 }),
      h(SkeletonBlock, { width: '88%', height: 10 }),
      h('p', { className: 'capital-automation-hint' }, zh.board.briefPending))
  }
  return h('article', { className: 'capital-automation-briefcard', 'data-status': status, 'aria-labelledby': titleId },
    h('div', { className: 'capital-automation-briefhead' },
      h('div', { className: 'capital-automation-brieftitle' },
        h(Glyph, { task: identity, size: 24, radius: 8, glyphSize: 14 }),
        h('h3', { id: titleId }, card.taskTitle),
        h('span', { className: 'capital-automation-tag', 'data-tone': card.category }, categoryLabel(card.category)),
        h('span', { className: 'capital-automation-tag' }, trigger),
        h('time', {
          className: 'capital-automation-brieftime',
          dateTime: card.finishedAt,
          title: exactTime,
        }, relativeTime)),
      h('div', { className: 'capital-automation-briefheadactions' }, askIcon, openIcon)),
    body,
    h(AskDock, {
      card,
      identity,
      api,
      onOpenSession,
      open: askOpen,
      onClose: () => setAskOpen(false),
    }))
}

function BoardSkeleton(props) {
  const { railOpen = false } = props
  return h('div', { className: 'capital-automation-loading', 'aria-busy': 'true' },
    h('span', { className: 'capital-automation-skeletonlabel', role: 'status', 'aria-live': 'polite' }, zh.loading),
    h('div', { className: 'capital-automation-board' },
    h('div', { className: 'capital-automation-boardtoolbar' },
      h('div', { className: 'capital-automation-boardtools' }, h(SkeletonBlock, { width: 82, height: 28, radius: 999 }), h(SkeletonBlock, { width: 72, height: 28, radius: 999 })),
      h('div', { className: 'capital-automation-boardactions' }, h(SkeletonBlock, { width: 58, height: 28, radius: 999 }), h(SkeletonBlock, { width: 84, height: 28, radius: 999 }))),
    h('div', { className: 'capital-automation-boardstats' },
      Array.from({ length: 5 }, (_, index) => h('div', { key: index, className: 'capital-automation-boardstat' }, h(SkeletonBlock, { width: 46, height: 9 }), h(SkeletonBlock, { width: 24, height: 16 })))),
    h('div', { className: 'capital-automation-boardgrid', 'data-rail': railOpen === true ? 'open' : 'closed' },
      h('section', { className: 'capital-automation-boardmain' },
        [0, 1].map((index) => h('div', { key: index, className: 'capital-automation-briefcard' },
          h('div', { className: 'capital-automation-brieftitle' },
            h(SkeletonBlock, { width: 24, height: 24, radius: 8 }),
            h(SkeletonBlock, { width: '48%', height: 12 })),
          h(SkeletonBlock, { width: '80%', height: 16 }),
          h(SkeletonBlock, { width: '100%', height: 10 }),
          h(SkeletonBlock, { width: '92%', height: 10 })))),
      railOpen === true
        ? h('aside', { className: 'capital-automation-boardrail' },
          h('div', { className: 'capital-automation-card capital-automation-panel' },
            h(SkeletonBlock, { width: 68, height: 14 }),
            h(SkeletonBlock, { width: '100%', height: 10 }),
            h(SkeletonBlock, { width: '86%', height: 10 })))
        : null)))
}

function BriefFeed(props) {
  const { cards, tasks, api, loading, error, onOpenSession, onRetry, retryingRunId, onViewAll, onClearFilter, onLoadMore, hasMore, loadingMore, railOpen } = props
  if (loading === true) return h(BoardSkeleton, { railOpen })
  if (typeof error === 'string' && error.length > 0) {
    return h('section', { className: 'capital-automation-boardmain', id: 'capital-automation-briefs' },
      h('div', { className: 'capital-automation-banner', 'data-tone': 'error', role: 'alert' }, error))
  }
  if (cards.length === 0) {
    return h('section', { className: 'capital-automation-boardmain', id: 'capital-automation-briefs' },
      h('div', { className: 'capital-automation-empty' },
        h('span', { className: 'capital-automation-emptyicon' }, h(IconChecklistOutlineRegular, { size: 19 })),
        h('h3', null, zh.board.rangeEmpty),
        h('p', null, zh.board.emptyHint),
        h('div', { className: 'capital-automation-boardemptyactions' },
          onViewAll ? h('button', { type: 'button', className: 'capital-automation-btn', onClick: onViewAll }, zh.board.viewAll) : null,
          onClearFilter ? h('button', { type: 'button', className: 'capital-automation-btn', onClick: onClearFilter }, zh.board.clearFilter) : null)))
  }
  const taskById = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [task.id, task]))
  return h('section', { className: 'capital-automation-boardmain', id: 'capital-automation-briefs', 'aria-label': zh.board.briefTitle },
    cards.map((card) => h(BriefCard, {
      key: card.runId,
      card,
      task: taskById.get(card.taskId),
      api,
      onOpenSession,
      onRetry,
      retrying: retryingRunId === card.runId,
    })),
    hasMore
      ? h('button', {
        type: 'button',
        className: 'capital-automation-btn capital-automation-boardmore',
        disabled: loadingMore === true,
        onClick: onLoadMore,
      }, loadingMore === true ? zh.loading : zh.board.loadMore)
      : null)
}

function TodoRow(props) {
  const { item, period, showDue = true, onOpenSession, onAck, acking = false, ackDisabled = false } = props
  const [open, setOpen] = useState(false)
  const quote = item.sourceQuote ?? item.sources?.[0]?.sourceQuote
  const due = showDue === true ? boardTodoDueLabel(item, period) : ''
  const source = {
    taskTitle: item.taskTitle,
    finishedAt: item.finishedAt,
    sessionId: item.sessionId ?? item.sources?.[0]?.sessionId,
  }
  const meta = []
  if (due) meta.push(h('span', { key: 'due' }, due))
  if (item.seenCount > 1) meta.push(h('span', { key: 'seen' }, zh.board.seenCount.replace('{n}', String(item.seenCount))))
  const basisAction = open ? zh.board.hideBasis : zh.board.showBasis
  const basisCaret = h('span', { className: 'capital-automation-basiscaret', 'aria-hidden': 'true' }, h(IconChevronDownOutlineRegular, { size: 12 }))
  return h('li', { className: 'capital-automation-todoitem' },
    h('div', { className: 'capital-automation-todoline' },
      h('div', { className: 'capital-automation-todotop' },
        h('span', { className: 'capital-automation-todokind', 'data-kind': item.kind }, boardTodoKindLabel(item.kind)),
        h('button', {
          type: 'button',
          className: 'capital-automation-btn',
          'data-size': 'sm',
          title: zh.board.todoAckTitle,
          'aria-label': `${zh.board.todoAckTitle}：${item.title}`,
          disabled: ackDisabled === true,
          onClick: () => onAck(item),
        }, acking === true ? zh.processing : zh.board.todoAck)),
      h('button', {
        type: 'button',
        className: 'capital-automation-todotitle',
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': `${item.title}，${basisAction}`,
        title: basisAction,
        onClick: () => setOpen((value) => !value),
      }, item.title, basisCaret)),
    item.detail ? h('p', { className: 'capital-automation-tododesc' }, item.detail) : null,
    meta.length > 0 ? h('div', { className: 'capital-automation-todometa' }, meta) : null,
    open
      ? h('div', { className: 'capital-automation-tododetail' },
        h('blockquote', null, quote),
        source
          ? h('div', { className: 'capital-automation-todosource' },
            h('span', null, `${zh.board.sourceRun}：${source.taskTitle} · ${formatShortTime(source.finishedAt)}`),
            source.sessionId
              ? h('button', {
                type: 'button',
                className: 'capital-automation-btn',
                'data-size': 'icon',
                title: zh.openSession,
                'aria-label': zh.openSession,
                onClick: () => onOpenSession(source.sessionId),
              }, h(IconRightUpOutlineRegular, { size: 14 }))
              : null)
          : null)
      : null)
}

function BoardPanelHead(props) {
  const { id, title, open, onToggle, meta, action } = props
  return h('div', { className: 'capital-automation-panelhead' },
    h('h3', null,
      h('button', {
        type: 'button',
        className: 'capital-automation-paneltoggle',
        'aria-expanded': open === true ? 'true' : 'false',
        'aria-controls': `${id}-body`,
        'aria-label': `${title}（${open === true ? zh.board.collapse : zh.board.expand}）`,
        title: open === true ? zh.board.collapse : zh.board.expand,
        onClick: onToggle,
      },
      h('span', null, title),
      h(IconChevronDownOutlineRegular, {
        size: 14,
        className: 'capital-automation-panelchevron',
        'data-open': open === true ? 'true' : 'false',
      }))),
    meta ?? null,
    action ?? null)
}

function BoardPanel(props) {
  const { id, title, open, onToggle, meta, action, children } = props
  return h('section', {
    className: 'capital-automation-card capital-automation-panel',
    id,
    'data-collapsed': open === true ? 'false' : 'true',
  },
  h(BoardPanelHead, { id, title, open, onToggle, meta, action }),
  h('div', {
    id: `${id}-body`,
    className: 'capital-automation-panelbody',
    hidden: open !== true,
  }, children))
}

function TodoPanel(props) {
  const { todos, onOpenSession, onAckTodo, ackingTodoId, open, onToggle } = props
  const [filter, setFilter] = useState('today')
  const now = new Date()
  const entries = todos.map((item) => ({ item, period: boardTodoPeriod(item, now) }))
  entries.sort((left, right) => BOARD_TODO_PERIODS.indexOf(left.period) - BOARD_TODO_PERIODS.indexOf(right.period))
  const visible = entries.filter((entry) => entry.period === filter)
  const emptyText = filter === 'today'
    ? zh.board.todoEmptyToday
    : zh.board.todoEmptyGroup.replace('{label}', boardTodoGroupLabel(filter))
  return h(BoardPanel, {
    id: 'capital-automation-todo',
    title: zh.board.todoTitle,
    open,
    onToggle,
    action: h(Select, {
      value: filter,
      options: boardTodoFilterOptions(),
      onChange: setFilter,
      size: 'sm',
      label: zh.board.todoFilterLabel,
      align: 'end',
    }),
  },
  visible.length === 0
    ? h('p', { className: 'capital-automation-hint' }, emptyText)
    : h('ul', { className: 'capital-automation-todolist' }, visible.map((entry) => h(TodoRow, {
      key: entry.item.id,
      item: entry.item,
      period: entry.period,
      showDue: true,
      onOpenSession,
      onAck: onAckTodo,
      acking: ackingTodoId === entry.item.id,
      ackDisabled: ackingTodoId !== null && ackingTodoId !== undefined,
    }))))
}

function boardRoleLabel(role) {
  if (role === 'holding') return zh.board.roleHolding
  if (role === 'watch') return zh.board.roleWatch
  if (role === 'event') return zh.board.roleEvent
  return zh.board.roleRisk
}

function StockRow(props) {
  const { stock, todos, onOpenSession } = props
  const [open, setOpen] = useState(false)
  const related = todos.filter((item) => item.symbol === stock.symbol)
  return h('div', { className: 'capital-automation-stockrow' },
    h('button', {
      type: 'button',
      className: 'capital-automation-stockmain',
      'aria-expanded': open ? 'true' : 'false',
      onClick: () => setOpen((value) => !value),
    },
    h('span', { className: 'capital-automation-stockname' }, stock.name),
    h('span', { className: 'capital-automation-stockcode' }, stock.symbol),
    h('span', { className: 'capital-automation-stockroles' },
      stock.roles.map((role) => h('span', { key: role, className: 'capital-automation-stockrole', 'data-role': role }, boardRoleLabel(role)))),
    stock.note ? h('span', { className: 'capital-automation-stocknote' }, stock.note) : null,
    h('span', { className: 'capital-automation-stockmeta' },
      stock.nextAt ? h('span', null, stock.nextAt) : null,
      stock.todoCount > 0 ? h('span', null, zh.board.stockTodoCount.replace('{n}', String(stock.todoCount))) : null)),
    open && related.length > 0
      ? h('ul', { className: 'capital-automation-stocktodos' }, related.map((item) => h('li', { key: item.id },
        h('span', null, item.title),
        item.sessionId ? h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', onClick: () => onOpenSession(item.sessionId) }, zh.openSession) : null)))
      : null)
}

function StockRadar(props) {
  const { stocks, todos, total, onOpenSession, open, onToggle } = props
  const hidden = Math.max(0, (total ?? stocks.length) - stocks.length)
  return h(BoardPanel, {
    id: 'capital-automation-stocks',
    title: zh.board.statsStocks,
    open,
    onToggle,
    meta: stocks.length === 0 ? null : h('span', { className: 'capital-automation-hint' }, zh.board.stocksCount.replace('{n}', String(total ?? stocks.length))),
  },
  stocks.length === 0
    ? h('p', { className: 'capital-automation-hint' }, zh.board.stockEmpty)
    : stocks.map((stock) => h(StockRow, { key: stock.symbol, stock, todos, onOpenSession })),
  hidden > 0 ? h('p', { className: 'capital-automation-hint' }, zh.board.stockOther.replace('{n}', String(hidden))) : null)
}

function boardGapLabel(kind) {
  if (kind === 'capability') return zh.board.gapCapability
  if (kind === 'conflict') return zh.board.gapConflict
  if (kind === 'quality') return zh.board.gapQuality
  return zh.board.gapTransient
}

function GapRow(props) {
  const { gap, onOpenSession } = props
  const [open, setOpen] = useState(false)
  const source = gap.sources?.[0]
  const basisAction = open ? zh.board.hideBasis : zh.board.showBasis
  return h('li', { className: 'capital-automation-gaprow' },
    h('div', { className: 'capital-automation-gaphead' },
      h('span', { className: 'capital-automation-gapkind', 'data-kind': gap.kind }, boardGapLabel(gap.kind)),
      h('button', {
        type: 'button',
        className: 'capital-automation-gaptitle',
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': `${gap.topic}，${basisAction}`,
        title: basisAction,
        onClick: () => setOpen((value) => !value),
      }, gap.topic, h('span', { className: 'capital-automation-basiscaret', 'aria-hidden': 'true' }, h(IconChevronDownOutlineRegular, { size: 12 })))),
    h('p', { className: 'capital-automation-gapdesc' }, gap.detail),
    open
      ? h('div', { className: 'capital-automation-tododetail' },
        h('blockquote', null, source?.sourceQuote ?? gap.sourceQuote),
        source ? h('p', { className: 'capital-automation-hint' }, `${source.taskTitle} · ${formatShortTime(source.finishedAt)}`) : null,
        source?.sessionId ? h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', onClick: () => onOpenSession(source.sessionId) }, zh.openSession) : null)
      : null)
}

function DataHealthPanel(props) {
  const { gaps, total, onOpenSession, open, onToggle } = props
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? gaps : gaps.slice(0, 5)
  return h(BoardPanel, {
    id: 'capital-automation-gaps',
    title: zh.board.statsGaps,
    open,
    onToggle,
  },
  gaps.length === 0
    ? h('p', { className: 'capital-automation-hint' }, zh.board.gapEmpty)
    : h('ul', { className: 'capital-automation-gaplist' }, visible.map((gap) => h(GapRow, { key: gap.id, gap, onOpenSession }))),
  (total ?? gaps.length) > visible.length
    ? h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', onClick: () => setShowAll(true) }, zh.board.gapAll)
    : null)
}

function healthIssueTone(status) {
  if (status === 'failed' || status === 'timed_out' || status === 'unknown_after_restart') return 'bad'
  if (status === 'missed' || status === 'blocked_requires_user') return 'warn'
  return null
}

function RunHealthPanel(props) {
  const { health, onGoRuns, onOpenSession, open, onToggle } = props
  const runs = health?.runs ?? {}
  const briefs = health?.briefs ?? {}
  const runParts = [
    ['healthSucceeded', runs.succeeded ?? 0],
    ['healthFailed', runs.failed ?? 0],
    ['healthTimeout', runs.timedOut ?? 0],
    ['healthMissed', runs.missed ?? 0],
    ['healthUnknown', runs.unknown ?? 0],
    ['healthBlocked', runs.blocked ?? 0],
    ['healthActive', runs.active ?? 0],
  ].filter(([, value]) => value > 0)
  const briefParts = [
    ['healthBriefReady', briefs.ready ?? 0],
    ['healthBriefPending', briefs.pending ?? 0],
    ['healthBriefFailed', briefs.failed ?? 0],
    ['healthBriefSkipped', briefs.skipped ?? 0],
  ].filter(([, value]) => value > 0)
  const countText = (parts) => parts.length === 0 ? '0' : parts.map(([key, value]) => `${zh.board[key]} ${value}`).join(' · ')
  const schedulerState = health?.scheduler?.state
  const scheduler = schedulerState === 'active' ? zh.board.healthSchedulerOk : schedulerState === 'standby' ? zh.board.healthSchedulerStandby : zh.board.healthSchedulerBad
  const schedulerHint = schedulerState === 'active' ? zh.systemActive : schedulerState === 'standby' ? zh.systemStandby : zh.systemUnavailable
  const schedulerTone = schedulerState === 'active' ? null : schedulerState === 'standby' ? 'warn' : 'bad'
  const calendar = health?.calendar?.available === false ? zh.board.healthCalendarBad : zh.board.healthCalendarOk
  const calendarTone = health?.calendar?.available === false ? 'bad' : null
  return h(BoardPanel, {
    id: 'capital-automation-health',
    title: zh.board.healthTitle,
    open,
    onToggle,
    meta: h('span', { className: 'capital-automation-hint' }, zh.board.healthWindow),
    action: h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', onClick: onGoRuns }, zh.board.healthViewRuns),
  },
  h('div', { className: 'capital-automation-healthgrid' },
    h('span', { className: 'capital-automation-healthkey' }, zh.board.healthRuns),
    h('span', { className: 'capital-automation-healthval' }, countText(runParts)),
    h('span', { className: 'capital-automation-healthkey' }, zh.board.healthBriefs),
    h('span', { className: 'capital-automation-healthval' }, countText(briefParts)),
    h('span', { className: 'capital-automation-healthkey' }, zh.board.healthScheduler),
    h('span', { className: 'capital-automation-healthval', 'data-tone': schedulerTone ?? undefined, title: schedulerHint }, scheduler),
    h('span', { className: 'capital-automation-healthkey' }, zh.board.healthCalendar),
    h('span', { className: 'capital-automation-healthval', 'data-tone': calendarTone ?? undefined }, calendar)),
  health?.issueCount > 0
    ? h('ul', { className: 'capital-automation-healthissues' }, (health.recentIssues ?? []).map((issue) => {
      const tone = healthIssueTone(issue.status)
      return h('li', { key: issue.runId },
        h('span', { className: 'capital-automation-healthissue', title: issue.message || undefined },
          h('span', { className: 'capital-automation-statusdot', 'data-tone': tone ?? undefined }),
          h('span', { className: 'capital-automation-healthissuetitle' }, issue.taskTitle),
          h('span', { className: 'capital-automation-healthissuestatus', 'data-tone': tone ?? undefined }, statusLabel(issue.status)),
          issue.recoveredByRunId ? h('span', { className: 'capital-automation-healthrecovered' }, zh.board.healthRecovered) : null),
        issue.sessionId ? h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', onClick: () => onOpenSession(issue.sessionId) }, zh.board.healthOpen) : null)
    }))
    : h('p', { className: 'capital-automation-healthempty' }, zh.board.healthNoIssues))
}

function BoardPage(props) {
  const {
    board, tasks, api, loading, error, range, category, onRange, onCategory, onRefresh,
    onOpenSession, onRetryBrief, retryingRunId, onLoadMore, loadingMore, onGoTasks, onNewTask, onGoRuns,
    onAckTodo, ackingTodoId, hasActiveTasks, storageReady,
  } = props
  const [railOpen, setRailOpen] = useState(() => readBoardUi().rail !== false)
  const [openPanels, setOpenPanels] = useState(() => boardPanelFlags(readBoardUi().panels))
  const [pendingJump, setPendingJump] = useState(null)

  useEffect(() => {
    if (typeof pendingJump !== 'string') return undefined
    const timer = setTimeout(() => {
      if (typeof document !== 'undefined') {
        const node = document.getElementById(pendingJump)
        if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }
      setPendingJump(null)
    }, 0)
    return () => clearTimeout(timer)
  }, [pendingJump])

  const togglePanel = (key) => {
    setOpenPanels((current) => {
      const next = { ...current, [key]: current[key] !== true }
      saveBoardUi({ panels: next })
      return next
    })
  }

  const toggleRail = () => {
    setRailOpen((value) => {
      const next = value !== true
      saveBoardUi({ rail: next })
      return next
    })
  }

  const jumpTo = (id) => {
    const key = boardPanelKey(id)
    if (key !== null) {
      setRailOpen(true)
      saveBoardUi({ rail: true })
      setOpenPanels((current) => {
        if (current[key] === true) return current
        const next = { ...current, [key]: true }
        saveBoardUi({ panels: next })
        return next
      })
    }
    setPendingJump(id)
  }

  if (loading === true && board === null) return h(BoardSkeleton, { railOpen })
  if (error.length > 0 && board === null) {
    return h('div', { className: 'capital-automation-board' },
      h('div', { className: 'capital-automation-banner', 'data-tone': 'error', role: 'alert' },
        `${zh.board.loadError}：${error}`,
        h('button', { type: 'button', className: 'capital-automation-btn', 'data-size': 'sm', onClick: onRefresh }, zh.loadRetry)))
  }
  if (board?.empty === true) {
    return h('div', { className: 'capital-automation-board' },
      error.length > 0 ? h('div', { className: 'capital-automation-banner', 'data-tone': 'error', role: 'alert' }, error) : null,
      h(BoardEmpty, { hasActiveTasks, storageReady, onGoTasks, onNewTask }))
  }
  const boardStats = board?.stats === undefined
    ? undefined
    : { ...board.stats, todos: boardTodoTodayCount(board?.todos ?? []) }
  return h('div', { className: 'capital-automation-board' },
    h(BoardToolbar, {
      range,
      category,
      loading,
      onRange,
      onCategory,
      onRefresh,
      railOpen,
      onToggleRail: toggleRail,
    }),
    error.length > 0 ? h('div', { className: 'capital-automation-banner', 'data-tone': 'error', role: 'alert' }, error) : null,
    h(BoardStats, { stats: boardStats, onJump: jumpTo }),
    h('div', {
      className: 'capital-automation-boardgrid',
      'data-rail': railOpen === true ? 'open' : 'closed',
    },
      h(BriefFeed, {
        cards: board?.cards ?? [],
        tasks,
        api,
        loading: loading === true && board === null,
        error: '',
        onOpenSession,
        onRetry: onRetryBrief,
        retryingRunId,
        onViewAll: range === 'all' ? undefined : () => onRange('all'),
        onClearFilter: category === 'all' ? undefined : () => onCategory('all'),
        onLoadMore,
        hasMore: board?.nextBefore !== null && board?.nextBefore !== undefined,
        loadingMore,
        railOpen,
      }),
      h('aside', {
        id: 'capital-automation-boardrail',
        className: 'capital-automation-boardrail',
        hidden: railOpen !== true,
      },
        h(TodoPanel, {
          todos: board?.todos ?? [],
          onOpenSession,
          onAckTodo,
          ackingTodoId,
          open: openPanels.todo,
          onToggle: () => togglePanel('todo'),
        }),
        h(StockRadar, {
          stocks: board?.stocks ?? [],
          todos: board?.todos ?? [],
          total: board?.stats?.stocks,
          onOpenSession,
          open: openPanels.stocks,
          onToggle: () => togglePanel('stocks'),
        }),
        h(DataHealthPanel, {
          gaps: board?.gaps ?? [],
          total: board?.stats?.gaps,
          onOpenSession,
          open: openPanels.gaps,
          onToggle: () => togglePanel('gaps'),
        }),
        h(RunHealthPanel, {
          health: board?.health,
          onGoRuns,
          onOpenSession,
          open: openPanels.health,
          onToggle: () => togglePanel('health'),
        }))))
}

function AutomationPage(props) {
  const { api, openSession } = props
  const [meta, setMeta] = useState(null)
  const [tasks, setTasks] = useState([])
  const [runs, setRuns] = useState([])
  const [history, setHistory] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [board, setBoard] = useState(null)
  const [boardLoading, setBoardLoading] = useState(true)
  const [boardError, setBoardError] = useState('')
  const [boardRange, setBoardRange] = useState('14')
  const [boardCategory, setBoardCategory] = useState('all')
  const [retryingBriefId, setRetryingBriefId] = useState(null)
  const [ackingTodoId, setAckingTodoId] = useState(null)
  const [boardLoadingMore, setBoardLoadingMore] = useState(false)
  const [unread, setUnread] = useState(0)
  const [tasksReady, setTasksReady] = useState(false)
  const [runsReady, setRunsReady] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [tab, setTab] = useState('board')
  const [detailTab, setDetailTab] = useState('overview')
  const [wizard, setWizard] = useState(false)
  const [inbox, setInbox] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [busyTaskId, setBusyTaskId] = useState(null)
  const [inboxBusy, setInboxBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')
  const mountedRef = useRef(false)
  const tasksRef = useRef([])
  const tabRef = useRef('board')
  const inboxRef = useRef(false)
  const selectedIdRef = useRef(null)
  const refreshInFlightRef = useRef(null)
  const metaInFlightRef = useRef(null)
  const tasksInFlightRef = useRef(null)
  const runsInFlightRef = useRef(null)
  const notificationsInFlightRef = useRef(null)
  const refreshSequenceRef = useRef(0)
  const detailSequenceRef = useRef(0)
  const boardSequenceRef = useRef(0)
  const scrollRef = useRef(null)
  const mountedAtRef = useRef(typeof performance === 'undefined' ? 0 : performance.now())
  const timingRecordedRef = useRef(false)
  // Polls and visibility wake-ups close over the first render; the current tab must be a ref.
  tabRef.current = tab
  inboxRef.current = inbox

  useEffect(() => {
    if (notice.length === 0) return undefined
    const timer = setTimeout(() => setNotice(''), 3_200)
    return () => clearTimeout(timer)
  }, [notice])

  async function loadMeta() {
    if (metaInFlightRef.current !== null) return metaInFlightRef.current
    const request = (async () => {
      try {
        const value = await api.meta()
        if (!mountedRef.current) return
        setMeta(value)
        if (typeof value?.notifications?.unread === 'number') setUnread(value.notifications.unread)
        setLoadError('')
      } catch (error) {
        if (mountedRef.current) setLoadError(error.message ?? zh.errorGeneric)
      }
    })()
    metaInFlightRef.current = request
    try {
      await request
    } finally {
      if (metaInFlightRef.current === request) metaInFlightRef.current = null
    }
  }

  function reconcileSelection(nextTaskList) {
    const currentId = selectedIdRef.current
    const nextId = currentId !== null && nextTaskList.some((task) => task.id === currentId) ? currentId : null
    if (nextId === currentId) return
    selectedIdRef.current = nextId
    detailSequenceRef.current += 1
    setDetail(null)
    setSelectedId(nextId)
    if (nextId === null) setDetailTab('overview')
  }

  async function loadTasks() {
    if (tasksInFlightRef.current !== null) return tasksInFlightRef.current
    const request = (async () => {
      try {
        const body = await api.tasks()
        if (!mountedRef.current) return
        const nextTaskList = Array.isArray(body.tasks) ? body.tasks : []
        tasksRef.current = nextTaskList
        setTasks(nextTaskList)
        reconcileSelection(nextTaskList)
        setLoadError('')
      } catch (error) {
        if (mountedRef.current) setLoadError(error.message ?? zh.errorGeneric)
      } finally {
        if (mountedRef.current) setTasksReady(true)
      }
    })()
    tasksInFlightRef.current = request
    try {
      await request
    } finally {
      if (tasksInFlightRef.current === request) tasksInFlightRef.current = null
    }
  }

  async function loadRuns() {
    if (runsInFlightRef.current !== null) return runsInFlightRef.current
    const request = (async () => {
      try {
        const [nextRuns, nextHistory] = await Promise.all([
          api.runs('?limit=200'),
          api.history(`?days=${HISTORY_DAYS}&tz=${encodeURIComponent(browserTimeZone())}`),
        ])
        if (!mountedRef.current) return
        setRuns(Array.isArray(nextRuns.runs) ? nextRuns.runs : [])
        setHistory(nextHistory ?? null)
        setLoadError('')
      } catch (error) {
        if (mountedRef.current) setLoadError(error.message ?? zh.errorGeneric)
      } finally {
        if (mountedRef.current) setRunsReady(true)
      }
    })()
    runsInFlightRef.current = request
    try {
      await request
    } finally {
      if (runsInFlightRef.current === request) runsInFlightRef.current = null
    }
  }

  async function loadNotifications() {
    if (notificationsInFlightRef.current !== null) return notificationsInFlightRef.current
    const request = (async () => {
      try {
        const body = await api.notifications()
        if (!mountedRef.current) return
        setNotifications(Array.isArray(body.notifications) ? body.notifications : [])
        setUnread(typeof body.unread === 'number' ? body.unread : 0)
        setLoadError('')
      } catch (error) {
        if (mountedRef.current) setLoadError(error.message ?? zh.errorGeneric)
      }
    })()
    notificationsInFlightRef.current = request
    try {
      await request
    } finally {
      if (notificationsInFlightRef.current === request) notificationsInFlightRef.current = null
    }
  }

  /**
   * Fetches the page shell plus the visible slice only. Tasks, runs and notifications belong
   * to their tabs and loaders and are fetched when that tab is opened.
   */
  async function refresh() {
    if (refreshInFlightRef.current !== null) return refreshInFlightRef.current
    const requestSequence = refreshSequenceRef.current + 1
    refreshSequenceRef.current = requestSequence
    const request = (async () => {
      const pending = [loadMeta()]
      if (selectedIdRef.current !== null || tabRef.current === 'tasks') pending.push(loadTasks())
      if (tabRef.current === 'runs') pending.push(loadRuns())
      if (inboxRef.current) pending.push(loadNotifications())
      await Promise.all(pending)
      if (!mountedRef.current || requestSequence !== refreshSequenceRef.current) return
    })()
    refreshInFlightRef.current = request
    try {
      await request
    } finally {
      if (refreshInFlightRef.current === request) refreshInFlightRef.current = null
    }
  }

  async function loadBoard(nextRange = boardRange, nextCategory = boardCategory, before = null) {
    const query = boardQueryOf(nextRange, nextCategory, before)
    const snapshot = before === null ? readBoardSnapshot(query) : null
    const requestSequence = boardSequenceRef.current + 1
    boardSequenceRef.current = requestSequence
    if (before === null) {
      // A cached board paints immediately; the request below still revalidates it.
      if (snapshot === null) setBoardLoading(true)
      else {
        setBoard(snapshot)
        setBoardLoading(false)
      }
    }
    try {
      const value = await api.board(query)
      if (!mountedRef.current || requestSequence !== boardSequenceRef.current) return
      if (before === null) {
        setBoard(value)
        writeBoardSnapshot(query, value)
      } else setBoard((current) => current === null
        ? value
        : { ...value, cards: [...current.cards, ...value.cards] })
      setBoardError('')
    } catch (error) {
      if (mountedRef.current && requestSequence === boardSequenceRef.current) {
        setBoardError(error.message ?? zh.board.loadError)
      }
    } finally {
      if (mountedRef.current && requestSequence === boardSequenceRef.current) setBoardLoading(false)
    }
  }

  async function loadMoreBoard() {
    if (board?.nextBefore === null || board?.nextBefore === undefined || boardLoadingMore) return
    setBoardLoadingMore(true)
    try {
      await loadBoard(boardRange, boardCategory, board.nextBefore)
    } finally {
      setBoardLoadingMore(false)
    }
  }

  async function retryBrief(runId) {
    if (retryingBriefId !== null) return
    setRetryingBriefId(runId)
    setBoardError('')
    try {
      await api.retryBrief(runId)
      setNotice(zh.board.retryQueued)
      await loadBoard(boardRange, boardCategory)
    } catch (error) {
      setBoardError(error.message ?? zh.errorGeneric)
    } finally {
      setRetryingBriefId(null)
    }
  }

  async function ackTodo(item) {
    if (ackingTodoId !== null) return
    setAckingTodoId(item.id)
    setBoardError('')
    try {
      await api.confirmTodo(item.id)
      setBoard((current) => {
        if (current === null) return current
        const removed = (current.todos ?? []).find((entry) => entry.id === item.id)
        if (removed === undefined) return current
        const todos = current.todos.filter((entry) => entry.id !== item.id)
        const stocks = (current.stocks ?? []).map((stock) =>
          removed.symbol !== undefined && stock.symbol === removed.symbol
            ? { ...stock, todoCount: Math.max(0, (stock.todoCount ?? 0) - 1) }
            : stock)
        return {
          ...current,
          todos,
          stocks,
          stats: current.stats === undefined
            ? current.stats
            : { ...current.stats, todos: Math.max(0, (current.stats.todos ?? 0) - 1) },
        }
      })
      setNotice(zh.board.todoAcked)
      void loadBoard(boardRange, boardCategory)
    } catch (error) {
      setBoardError(error.message ?? zh.errorGeneric)
    } finally {
      setAckingTodoId(null)
    }
  }

  async function loadDetail(id) {
    const requestSequence = detailSequenceRef.current + 1
    detailSequenceRef.current = requestSequence
    try {
      const value = await api.detail(id)
      if (!mountedRef.current || requestSequence !== detailSequenceRef.current || selectedIdRef.current !== id) return
      setDetail(value)
    } catch (error) {
      if (mountedRef.current && requestSequence === detailSequenceRef.current && selectedIdRef.current === id) {
        setLoadError(error.message ?? zh.errorGeneric)
      }
    }
  }

  function scrollToTop() {
    const node = scrollRef.current
    if (node !== null && typeof node.scrollTo === 'function') node.scrollTo({ top: 0, behavior: 'auto' })
  }

  function selectTask(id, nextTab = 'overview') {
    selectedIdRef.current = id
    detailSequenceRef.current += 1
    setDetailTab(nextTab)
    setDetail(null)
    setSelectedId(id)
    setTab('tasks')
    scrollToTop()
  }

  function backToTasks() {
    selectedIdRef.current = null
    detailSequenceRef.current += 1
    setDetail(null)
    setSelectedId(null)
    setDetailTab('overview')
    scrollToTop()
  }

  function switchTab(nextTab) {
    if (nextTab === tab && nextTab === 'tasks' && selectedIdRef.current !== null) return
    if ((nextTab === 'board' || nextTab === 'runs') && selectedIdRef.current !== null) {
      selectedIdRef.current = null
      detailSequenceRef.current += 1
      setDetail(null)
      setSelectedId(null)
    }
    setTab(nextTab)
    scrollToTop()
  }

  function requestConfirm(kind, task, run) {
    setConfirmError('')
    setConfirm({ kind, task, run })
  }

  async function performTaskAction(task, action) {
    if (busyTaskId !== null) return
    setBusyTaskId(task.id)
    setLoadError('')
    try {
      if (action === 'run') {
        await api.run(task.id)
        setNotice(zh.runSubmitted.replace('{title}', task.title))
      } else if (action === 'copy') {
        const payload = await api.action(task.id, 'copy')
        setNotice(zh.copied.replace('{title}', task.title))
        if (payload?.task?.id) {
          await refresh()
          selectTask(payload.task.id, 'config')
          return
        }
      } else {
        await api.action(task.id, action)
        setNotice(action === 'pause' ? zh.paused.replace('{title}', task.title) : activationNotice(task))
      }
      await refresh()
      if (selectedIdRef.current === task.id) await loadDetail(task.id)
    } catch (failure) {
      setLoadError(failure.message ?? zh.errorGeneric)
    } finally {
      setBusyTaskId(null)
    }
  }

  async function enableTemplate(task) {
    await performTaskAction(task, 'activate')
  }

  async function confirmAction() {
    if (confirm === null || confirmBusy) return
    const { kind, task } = confirm
    setConfirmBusy(true)
    setConfirmError('')
    try {
      if (kind === 'cancel-run') {
        await api.cancel(confirm.run.id)
        setNotice(zh.runCanceled)
      } else if (kind === 'delete') {
        await api.remove(task.id)
        setNotice(zh.deleted.replace('{title}', task.title))
      } else {
        await api.action(task.id, 'hibernate')
        setNotice(zh.hibernated.replace('{title}', task.title))
      }
      setConfirm(null)
      setConfirmError('')
      await refresh()
      if (selectedIdRef.current === task.id) await loadDetail(task.id)
    } catch (failure) {
      setConfirmError(failure.message ?? zh.errorGeneric)
    } finally {
      setConfirmBusy(false)
    }
  }

  async function markAllRead() {
    if (inboxBusy) return
    setInboxBusy(true)
    try {
      await api.markRead({ all: true })
      setUnread(0)
      setNotice(zh.markReadDone)
      await refresh()
    } catch (failure) {
      setLoadError(failure.message ?? zh.errorGeneric)
    } finally {
      setInboxBusy(false)
    }
  }

  async function openTaskById(taskId) {
    if (!tasksRef.current.some((task) => task.id === taskId)) await loadTasks()
    if (tasksRef.current.some((task) => task.id === taskId)) selectTask(taskId)
  }

  async function openTaskFromNotification(taskId) {
    setInbox(false)
    await openTaskById(taskId)
  }

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh()
    }, 30_000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener?.('visibilitychange', onVisibilityChange)
    return () => {
      mountedRef.current = false
      refreshSequenceRef.current += 1
      detailSequenceRef.current += 1
      refreshInFlightRef.current = null
      clearInterval(timer)
      document.removeEventListener?.('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (tab === 'tasks') {
      void loadMeta()
      void loadTasks()
    } else if (tab === 'runs') {
      void loadMeta()
      void loadRuns()
    }
    return undefined
  }, [tab])

  useEffect(() => {
    if (inbox) void loadNotifications()
    return undefined
  }, [inbox])

  // A restart hands the lease over only after the previous owner's 90s lease expires, and the
  // scheduler retries on its next tick. While standby, poll the shell faster so the banner
  // clears itself instead of waiting for the normal 30s refresh.
  useEffect(() => {
    if (meta?.scheduler?.state !== 'standby') return undefined
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void loadMeta()
    }, 10_000)
    return () => clearInterval(timer)
  }, [meta?.scheduler?.state])

  useEffect(() => {
    if (tab !== 'board') return undefined
    void loadBoard(boardRange, boardCategory)
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void loadBoard(boardRange, boardCategory)
    }, 30_000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadBoard(boardRange, boardCategory)
    }
    document.addEventListener?.('visibilitychange', onVisibilityChange)
    return () => {
      boardSequenceRef.current += 1
      clearInterval(timer)
      document.removeEventListener?.('visibilitychange', onVisibilityChange)
    }
  }, [tab, boardRange, boardCategory])

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null)
      detailSequenceRef.current += 1
      return undefined
    }
    setDetail(null)
    void loadDetail(selectedId)
    return () => { detailSequenceRef.current += 1 }
  }, [selectedId])

  // Read-only diagnostics: `window.__CA_LAST_TIMING__` separates shell cost (click → mount)
  // from this page's cost (mount → board painted).
  useEffect(() => {
    if (board === null || timingRecordedRef.current) return undefined
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return undefined
    const frame = requestAnimationFrame(() => {
      const mountedAt = mountedAtRef.current
      if (mountedAt === 0) return
      timingRecordedRef.current = true
      const elapsed = performance.now() - mountedAt
      window.__CA_LAST_TIMING__ = {
        clickToMountMs: lastClickAt > 0 && mountedAt - lastClickAt < 30_000 ? Math.round(mountedAt - lastClickAt) : null,
        mountToBoardMs: Math.round(elapsed),
        at: new Date().toISOString(),
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [board])

  const schedulerActive = meta?.scheduler?.state === 'active'
  const storageReady = meta?.storage?.state !== 'unavailable'
  const templates = tasks
    .filter((task) => task.origin === 'builtin' && task.state === 'dormant')
    .sort(compareTemplates)
  const selectedTask = tasks.find((task) => task.id === selectedId)
  const detailOpen = tab === 'tasks' && selectedId !== null
  // The shell (`/meta`) and the board are the entry payload; other tabs report "loading"
  // until their first lazy fetch lands, so an unvisited tab never shows a false empty state.
  const initialLoading = meta === null && loadError.length === 0
  const tasksPending = initialLoading || !tasksReady
  const runsPending = initialLoading || !runsReady

  return h('div', { className: 'capital-automation-page' },
    detailOpen ? null : h(Header, {
      tab,
      onTab: switchTab,
      onNewTask: () => setWizard(true),
      unread,
      onOpenInbox: () => setInbox(true),
    }),
    h(PageBanners, { meta, loadError, onRetry: () => { void refresh() } }),
    h('div', { className: 'capital-automation-scroll', ref: scrollRef },
      h('div', { className: 'capital-automation-container' },
        tab === 'board'
          ? h(BoardPage, {
            board,
            tasks,
            api,
            loading: boardLoading,
            error: boardError,
            range: boardRange,
            category: boardCategory,
            onRange: setBoardRange,
            onCategory: setBoardCategory,
            onRefresh: () => { void loadBoard(boardRange, boardCategory) },
            onOpenSession: openSession,
            onRetryBrief: (runId) => { void retryBrief(runId) },
            retryingRunId: retryingBriefId,
            onAckTodo: (item) => { void ackTodo(item) },
            ackingTodoId,
            onLoadMore: () => { void loadMoreBoard() },
            loadingMore: boardLoadingMore,
            onGoTasks: () => switchTab('tasks'),
            onNewTask: () => setWizard(true),
            onGoRuns: () => switchTab('runs'),
            hasActiveTasks: tasks.some((task) => task.state === 'active'),
            storageReady,
          })
          : tab === 'tasks'
            ? selectedId !== null
            ? h('div', null,
              h(DetailBar, { onBack: backToTasks }),
              detail === null
                ? h('div', { className: 'capital-automation-empty' }, zh.loading)
                : h(TaskDetailPage, {
                  detail,
                  meta,
                  api,
                  openSession,
                  tab: detailTab,
                  onTab: setDetailTab,
                  onRequestConfirm: requestConfirm,
                  onRequestCancelRun: (run) => requestConfirm('cancel-run', selectedTask ?? { id: run.taskId, title: run.taskTitle }, run),
                  schedulerActive,
                  storageReady,
                  onChanged: async (taskId) => {
                    await refresh()
                    const id = taskId ?? selectedIdRef.current
                    if (id !== null && selectedIdRef.current === id) await loadDetail(id)
                  },
                }))
            : tasksPending
              ? h(TaskDashboardSkeleton)
              : h(TaskDashboard, {
                tasks,
                templates,
                runs,
                onOpenTask: selectTask,
                onNewTask: () => setWizard(true),
                onEnableTemplate: (task) => { void enableTemplate(task) },
                onAction: (task, action) => { void performTaskAction(task, action) },
                onRequestConfirm: requestConfirm,
                onEdit: (id) => selectTask(id, 'config'),
                onRequestCancelRun: (task, run) => requestConfirm('cancel-run', task, run),
                schedulerActive,
                storageReady,
                busyTaskId,
              })
          : runsPending
            ? h(RunsSkeleton)
            : h(RunsPage, {
              runs,
              history,
              tasks,
              onCancel: (run) => requestConfirm('cancel-run', { id: run.taskId, title: run.taskTitle }, run),
              onOpenSession: openSession,
              onOpenTask: (id) => { void openTaskById(id) },
              onGoTasks: () => switchTab('tasks'),
              onNewTask: () => setWizard(true),
              busy: confirmBusy,
            }), detailOpen || tab === 'board' ? null : h(SystemStatus, { meta }))),
    h(NewTaskModal, {
      open: wizard,
      onClose: () => setWizard(false),
      api,
      meta,
      onCreated: async (taskId) => {
        setWizard(false)
        setNotice(zh.created)
        await loadTasks()
        if (taskId !== null && tasksRef.current.some((task) => task.id === taskId)) selectTask(taskId)
      },
    }),
    h(InboxModal, {
      open: inbox,
      onClose: () => setInbox(false),
      notifications,
      onMarkAllRead: () => { void markAllRead() },
      onOpenTask: (taskId) => { void openTaskFromNotification(taskId) },
      busy: inboxBusy,
    }),
    h(ConfirmModal, {
      confirm,
      busy: confirmBusy,
      error: confirmError,
      onCancel: () => { if (!confirmBusy) { setConfirm(null); setConfirmError('') } },
      onConfirm: () => { void confirmAction() },
    }),
    notice.length > 0 ? h('div', { className: 'capital-automation-toast', role: 'status' }, notice) : null)
}

function AutomationIcon() {
  return h(IconChecklistOutlineRegular, { width: 18, height: 18 })
}

function apply(ctx) {
  const api = createApi()
  const openSession = (sessionId) => {
    try {
      const workspace = ctx.get('uiWorkspace')
      workspace?.openSession?.(sessionId)
    } catch {
      // Session navigation is optional; the run detail stays readable without it.
    }
  }
  ctx.effect(() => installStyles(), `${ENTRY_NAME}: styles`)
  // Warm the default board while the app idles so the first open has no data wait. A page
  // that opens later still revalidates; a page that never opens costs one request.
  if (typeof window !== 'undefined' && typeof location !== 'undefined') {
    const startWarm = () => { void api.warm() }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(startWarm, { timeout: 4_000 })
    else setTimeout(startWarm, 2_000)
  }
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    inject: () => ({ api, openSession }),
  }, AutomationPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 11,
    label: () => zh.panel,
  }, AutomationIcon))
  ctx.logger?.info?.(`${ENTRY_NAME}: 客户端半边已挂载（页面 + 侧栏入口）`)
}

exports.name = ENTRY_NAME
exports.inject = ['slots']
exports.apply = apply
