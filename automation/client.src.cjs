/**
 * Browser half of `@v587d/capital-automation`: a host-plane page at the `capital-automation`
 * main key plus the adjacent sidebar row. No turn-tail slot, no custom session events, and no
 * official `schedules` identity. Requests go to our own `/capital-automation` route; the page
 * only reads the one profile the server put it in and never sends a profile or owner field.
 */
const { createElement: h, useEffect, useRef, useState } = require('react')
const { IconChecklistOutlineRegular, Modal, Switch } = require('@deepseek-ai/dsh-client-ui-primitives')

const ENTRY_NAME = 'capital-automation'
const ROUTE = '/capital-automation'
const PANEL_ID = 'capital-automation'
const STYLE_TAG = 'capital-automation-css'

const zh = {
  panel: 'CapGen 投研自动化',
  title: 'CapGen 投研自动化',
  subtitle: '独立于官方「自动化任务」的定时投研任务、运行记录与通知',
  profile: '当前 profile',
  scheduler: '调度器',
  schedulerActive: '运行权已取得',
  schedulerStandby: '未取得运行权（只读）',
  schedulerStarting: '启动中',
  schedulerStopped: '已停止',
  calendar: '交易日历',
  calendarOk: '可用',
  calendarMissing: '不可用（交易日任务会跳过）',
  storageUnavailable: '存储不可用，页面只读',
  loading: '读取中…',
  empty: '还没有任务。',
  noSelection: '从左侧选择一个任务。',
  newTask: '新建任务',
  groups: { running: '运行中', news: '资讯', market: '行情', review: '复盘', research: '研究', custom: '我的任务' },
  stateLabel: '状态',
  state: { dormant: '休眠', active: '启用', paused: '暂停' },
  status: {
    queued: '排队中', starting: '启动中', running: '运行中', succeeded: '成功', failed: '失败',
    canceled: '已取消', timed_out: '超时', blocked_requires_user: '需要用户确认',
    unknown_after_restart: '重启后未知', skipped_overlap: '重叠跳过',
    skipped_calendar_unavailable: '日历不可用跳过', missed: '错过',
  },
  mode: { news: '资讯', market: '行情', review: '复盘', research: '研究' },
  cadence: { daily: '每天', weekly: '每周', monthly: '每月' },
  nextRun: '下次运行',
  lastResult: '上次结果',
  unread: '未读',
  never: '暂无',
  overview: '概览',
  config: '配置',
  runs: '运行记录',
  policy: '执行策略',
  notifications: '通知',
  titleField: '标题',
  descriptionField: '说明',
  instructionField: '任务指令',
  triggerField: '触发',
  timeField: '时间',
  timezoneField: '时区',
  weekdayField: '星期（ISO 1–7）',
  dayField: '每月几号（1–28）',
  tradingDaysField: '仅交易日',
  modeField: '输出侧重',
  modeHint: '只影响输出结构，不改变 Agent preset；所有运行固定使用 Capital 自动模式。',
  presetLabel: 'Agent preset',
  presetValue: 'capital-generation（自动模式）',
  workspaceField: '工作区',
  workspaceDefault: '跟随默认工作区',
  workspaceMissing: '已移除的工作区（请重新选择）',
  workspaceUnavailable: '工作区服务暂时不可用，运行会退回默认目录。',
  limitsField: '运行上限',
  runTimeout: 'wall-clock（分钟）',
  idleTimeout: '空闲超时（分钟）',
  maxSteps: '最大步骤',
  maxToolCalls: '最大工具调用',
  notifyField: '通知',
  notifyInApp: '应用内通知',
  notifyFailure: '失败时通知',
  notifySuccess: '成功时通知',
  save: '保存',
  saving: '保存中…',
  saved: '已保存',
  activate: '启用',
  pause: '暂停',
  hibernate: '休眠并恢复默认',
  copy: '复制为我的任务',
  remove: '删除',
  runNow: '手动运行',
  cancelRun: '取消运行',
  openSession: '打开 session',
  detail: '详情',
  close: '关闭',
  create: '创建',
  back: '上一步',
  next: '下一步',
  step1: '基本信息',
  step2: '触发',
  step3: '执行',
  required: '标题、指令不能为空。',
  inboxEmpty: '没有通知。',
  markRead: '全部已读',
  noRuns: '还没有运行记录。',
  duration: '耗时',
  steps: '步骤',
  tools: '工具调用',
  errorTitle: '错误',
  policyText: '固定 preset：capital-generation（Capital 自动模式）；cwd：任务选定的工作区，'
    + '未选择时使用 CapGen 投研自动化工作区；只允许 Capital 角色工具族；'
    + '无人值守运行禁止提问、写文件与 shell 提权。',
  budgetHint: '工具调用与步骤预算覆盖整棵运行子树：子 Agent 与 PTC 派发都计入。',
  errorGeneric: '操作失败，请稍后重试。',
  needConfirm: '需要用户确认',
}

const STATUS_ORDER = ['queued', 'starting', 'running', 'succeeded', 'failed', 'canceled', 'timed_out', 'blocked_requires_user', 'unknown_after_restart', 'skipped_overlap', 'skipped_calendar_unavailable', 'missed']

function installStyles() {
  if (typeof document === 'undefined' || document.querySelector(`style[data-${STYLE_TAG}]`)) return () => {}
  const style = document.createElement('style')
  style.setAttribute(`data-${STYLE_TAG}`, 'true')
  style.textContent = `
    .capital-automation-page { display: flex; flex-direction: column; gap: 14px; min-height: 0; height: 100%; padding: 20px 24px 24px; color: var(--dsw-alias-label-primary); }
    .capital-automation-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .capital-automation-title { margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: .2px; }
    .capital-automation-sub { margin: 2px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
    .capital-automation-meta { display: flex; flex-wrap: wrap; gap: 6px 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 20px; }
    .capital-automation-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); }
    .capital-automation-badge[data-ok="false"] { color: var(--dsw-alias-state-warn-label); }
    .capital-automation-badge[data-ok="true"] { color: var(--dsw-alias-state-success-primary); }
    .capital-automation-banner { padding: 10px 14px; border: .5px solid var(--dsw-alias-state-error-primary); border-radius: 10px; color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-state-error-tertiary, transparent); font-size: 12px; line-height: 18px; }
    .capital-automation-body { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 16px; min-height: 0; flex: 1 1 auto; }
    .capital-automation-list { display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow: auto; padding-right: 4px; }
    .capital-automation-group { display: flex; flex-direction: column; gap: 4px; }
    .capital-automation-group-title { margin: 0; padding: 4px 2px; color: var(--dsw-alias-label-tertiary); font-size: 11px; font-weight: 600; letter-spacing: .3px; }
    .capital-automation-task { display: flex; flex-direction: column; gap: 3px; width: 100%; padding: 10px 12px; border: .5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .capital-automation-task[aria-selected="true"] { border-color: var(--dsw-alias-brand-primary); box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary); }
    .capital-automation-task:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .capital-automation-task-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .capital-automation-task-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }
    .capital-automation-task-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
    .capital-automation-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); }
    .capital-automation-dot[data-run="true"] { background: var(--dsw-alias-state-business-primary); }
    .capital-automation-count { flex: none; min-width: 16px; padding: 0 5px; border-radius: 999px; background: var(--dsw-alias-state-business-primary); color: #fff; font-size: 10px; line-height: 16px; text-align: center; }
    .capital-automation-detail { display: flex; flex-direction: column; gap: 14px; min-width: 0; overflow: auto; padding: 4px 4px 8px; }
    .capital-automation-card { border: .5px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
    .capital-automation-card h3 { margin: 0; font-size: 14px; font-weight: 600; }
    .capital-automation-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .capital-automation-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .capital-automation-field > span { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
    .capital-automation-field input, .capital-automation-field select, .capital-automation-field textarea { width: 100%; box-sizing: border-box; padding: 7px 9px; border: .5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; }
    .capital-automation-field textarea { min-height: 120px; resize: vertical; }
    .capital-automation-field input:focus-visible, .capital-automation-field select:focus-visible, .capital-automation-field textarea:focus-visible, .capital-automation-btn:focus-visible, .capital-automation-task:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
    .capital-automation-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .capital-automation-btn { padding: 5px 11px; border: .5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
    .capital-automation-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .capital-automation-btn[data-primary="true"] { border-color: transparent; background: var(--dsw-alias-brand-primary); color: #fff; }
    .capital-automation-btn[data-danger="true"] { color: var(--dsw-alias-state-error-primary); }
    .capital-automation-btn:disabled { opacity: .5; cursor: not-allowed; }
    .capital-automation-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 17px; }
    .capital-automation-notice { margin: 0; color: var(--dsw-alias-state-success-primary); font-size: 12px; line-height: 18px; }
    .capital-automation-error { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
    .capital-automation-run { display: flex; flex-direction: column; gap: 4px; padding: 9px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
    .capital-automation-run:last-child { border-bottom: 0; }
    .capital-automation-run-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }
    .capital-automation-run-status { font-weight: 600; }
    .capital-automation-run-status[data-status="failed"], .capital-automation-run-status[data-status="timed_out"], .capital-automation-run-status[data-status="blocked_requires_user"] { color: var(--dsw-alias-state-error-primary); }
    .capital-automation-run-status[data-status="succeeded"] { color: var(--dsw-alias-state-success-primary); }
    .capital-automation-run-meta { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
    .capital-automation-error-item { color: var(--dsw-alias-state-error-primary); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; }
    .capital-automation-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 2px 0; }
    .capital-automation-switch-row span { font-size: 12px; }
    .capital-automation-wizard { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
    .capital-automation-steps { display: flex; gap: 6px; }
    .capital-automation-step { flex: 1 1 auto; padding: 5px 8px; border-radius: 8px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-tertiary); font-size: 11px; text-align: center; }
    .capital-automation-step[data-active="true"] { background: var(--dsw-alias-brand-primary); color: #fff; }
    .capital-automation-empty { padding: 28px 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; text-align: center; }
    @media (max-width: 780px) { .capital-automation-body { grid-template-columns: 1fr; } }
  `
  document.head.appendChild(style)
  return () => style.remove()
}

function createApi() {
  async function request(path, options = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined
    const timeout = setTimeout(() => controller?.abort(), 20_000)
    let response
    let payload
    try {
      response = await fetch(`${ROUTE}${path}`, {
        method: options.method ?? 'GET',
        credentials: 'same-origin',
        headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
  return {
    meta: () => request('/meta'),
    tasks: () => request('/tasks'),
    detail: (id) => request(`/tasks/${encodeURIComponent(id)}`),
    create: (body) => request('/tasks', { method: 'POST', body }),
    patch: (id, body) => request(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    remove: (id) => request(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    action: (id, action) => request(`/tasks/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
    run: (id) => request(`/tasks/${encodeURIComponent(id)}/run`, { method: 'POST' }),
    cancel: (id) => request(`/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
    runs: (query = '') => request(`/runs${query}`),
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

function formatTime(value) {
  if (typeof value !== 'string' || value.length === 0) return zh.never
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

function formatDuration(ms) {
  if (typeof ms !== 'number' || ms < 0) return zh.never
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function groupTasks(tasks) {
  const groups = new Map()
  const running = tasks.filter((task) => task.lastRun && ['queued', 'starting', 'running'].includes(task.lastRun.status))
  if (running.length > 0) groups.set('running', running)
  const seen = new Set(running.map((task) => task.id))
  for (const task of tasks) {
    if (seen.has(task.id)) continue
    const key = task.origin === 'custom' ? 'custom' : (task.category === 'market' ? 'market' : task.category === 'review' ? 'review' : task.category === 'research' ? 'research' : 'news')
    const bucket = groups.get(key) ?? []
    bucket.push(task)
    groups.set(key, bucket)
  }
  return groups
}

function TaskRow(props) {
  const { task, selected, onSelect } = props
  const run = task.lastRun
  const isRunning = run && ['queued', 'starting', 'running'].includes(run.status)
  return h('button', {
    type: 'button',
    className: 'capital-automation-task',
    'aria-selected': selected ? 'true' : 'false',
    onClick: () => onSelect(task.id),
  },
  h('span', { className: 'capital-automation-task-row' },
    h('span', { className: 'capital-automation-dot', 'data-run': isRunning ? 'true' : 'false' }),
    h('span', { className: 'capital-automation-task-title' }, task.title),
    task.unread > 0 ? h('span', { className: 'capital-automation-count' }, String(task.unread)) : null,
    h('span', { className: 'capital-automation-task-meta' }, stateLabel(task.state))),
  h('span', { className: 'capital-automation-task-meta' },
    h('span', null, `${zh.nextRun}: ${task.nextRunLocal ?? (task.nextRunUnavailable ? zh.calendarMissing : zh.never)}`),
    h('span', null, `${zh.lastResult}: ${run ? statusLabel(run.status) : zh.never}`)))
}

function SwitchRow(props) {
  return h('div', { className: 'capital-automation-switch-row' },
    h('span', null, props.label),
    h(Switch, { checked: props.checked === true, onChange: props.onChange, label: props.label, disabled: props.disabled }))
}

function TriggerFields(props) {
  const { trigger, onChange, disabled } = props
  const set = (patch) => onChange({ ...trigger, ...patch })
  return h('div', { className: 'capital-automation-grid' },
    h('label', { className: 'capital-automation-field' },
      h('span', null, '节奏'),
      h('select', {
        value: trigger.cadence,
        disabled,
        onChange: (event) => {
          const cadence = event.target.value
          set({
            cadence,
            ...(cadence === 'weekly' ? { weekdays: trigger.weekdays ?? [1, 3, 5] } : { weekdays: undefined }),
            ...(cadence === 'monthly' ? { dayOfMonth: trigger.dayOfMonth ?? 1 } : { dayOfMonth: undefined }),
          })
        },
      },
        Object.entries(zh.cadence).map(([value, label]) => h('option', { key: value, value }, label)))),
    h('label', { className: 'capital-automation-field' },
      h('span', null, zh.timeField),
      h('input', { type: 'time', value: trigger.time, disabled, onChange: (event) => set({ time: event.target.value }) })),
    h('label', { className: 'capital-automation-field' },
      h('span', null, zh.timezoneField),
      h('input', { type: 'text', value: trigger.timezone, disabled, onChange: (event) => set({ timezone: event.target.value }) })),
    h('label', { className: 'capital-automation-field' },
      h('span', null, zh.tradingDaysField),
      h(Switch, { checked: trigger.tradingDaysOnly === true, onChange: (value) => set({ tradingDaysOnly: value }), label: zh.tradingDaysField, disabled })),
    trigger.cadence === 'weekly' ? h('label', { className: 'capital-automation-field' },
      h('span', null, zh.weekdayField),
      h('input', {
        type: 'text',
        value: (trigger.weekdays ?? []).join(','),
        disabled,
        onChange: (event) => set({ weekdays: event.target.value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item >= 1 && item <= 7) }),
      })) : null,
    trigger.cadence === 'monthly' ? h('label', { className: 'capital-automation-field' },
      h('span', null, zh.dayField),
      h('input', { type: 'number', min: 1, max: 28, value: trigger.dayOfMonth ?? 1, disabled, onChange: (event) => set({ dayOfMonth: Number(event.target.value) }) })) : null)
}

function TaskDetail(props) {
  const { detail, meta, api, onChanged, openSession } = props
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setDraft(detail.task ? { ...detail.task, trigger: { ...detail.task.trigger }, limits: { ...detail.task.limits }, notifications: { ...detail.task.notifications } } : null)
    setNotice('')
    setError('')
  }, [detail])

  if (draft === null) return h('p', { className: 'capital-automation-empty' }, zh.loading)
  const task = draft
  const storageReady = meta?.storage?.state !== 'unavailable'
  const running = detail.runs.some((run) => ['queued', 'starting', 'running'].includes(run.status))
  const set = (patch) => setDraft((current) => ({
    ...current,
    ...(typeof patch === 'function' ? patch(current) : patch),
  }))

  async function act(name, action) {
    if (busy) return
    setBusy(name)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(zh.saved)
      await onChanged(detail.task.id)
    } catch (failure) {
      setError(failure.message ?? zh.errorGeneric)
    } finally {
      setBusy('')
    }
  }

  async function save() {
    await act('save', async () => {
      const body = {
        title: task.title.trim(),
        description: task.description ?? '',
        instruction: task.instruction,
        category: task.category,
        trigger: task.trigger,
        mode: task.mode,
        workspaceId: task.workspaceId ?? '',
        limits: task.limits,
        notifications: task.notifications,
      }
      if (body.title.length === 0 || body.instruction.trim().length === 0) throw new Error(zh.required)
      await api.patch(task.id, body)
    })
  }

  return h('div', { className: 'capital-automation-detail' },
    h('section', { className: 'capital-automation-card' },
      h('h3', null, zh.overview),
      h('div', { className: 'capital-automation-grid' },
        h('div', { className: 'capital-automation-field' }, h('span', null, zh.stateLabel), h('strong', null, stateLabel(task.state))),
        h('div', { className: 'capital-automation-field' }, h('span', null, zh.nextRun), h('strong', null, detail.task.nextRunLocal ?? zh.never)),
        h('div', { className: 'capital-automation-field' }, h('span', null, zh.lastResult), h('strong', null, detail.runs[0] ? statusLabel(detail.runs[0].status) : zh.never)),
        h('div', { className: 'capital-automation-field' }, h('span', null, '来源'), h('strong', null, task.origin === 'builtin' ? '内置模板' : '我的任务'))),
      h('div', { className: 'capital-automation-actions' },
        h('button', { type: 'button', className: 'capital-automation-btn', 'data-primary': 'true', disabled: busy || !storageReady, onClick: () => act('run', async () => { await api.run(task.id) }) }, zh.runNow),
        task.state === 'active'
          ? h('button', { type: 'button', className: 'capital-automation-btn', disabled: busy || !storageReady, onClick: () => act('pause', async () => { await api.action(task.id, 'pause') }) }, zh.pause)
          : h('button', { type: 'button', className: 'capital-automation-btn', disabled: busy || !storageReady, onClick: () => act('activate', async () => { await api.action(task.id, 'activate') }) }, zh.activate),
        task.origin === 'builtin' && task.state !== 'dormant'
          ? h('button', { type: 'button', className: 'capital-automation-btn', disabled: busy || running || !storageReady, onClick: () => act('hibernate', async () => { await api.action(task.id, 'hibernate') }) }, zh.hibernate)
          : null,
        task.origin === 'builtin'
          ? h('button', { type: 'button', className: 'capital-automation-btn', disabled: busy || !storageReady, onClick: () => act('copy', async () => { await api.action(task.id, 'copy') }) }, zh.copy)
          : h('button', { type: 'button', className: 'capital-automation-btn', 'data-danger': 'true', disabled: busy || running || !storageReady, onClick: () => act('remove', async () => { await api.remove(task.id) }) }, zh.remove)),
      notice.length > 0 ? h('p', { className: 'capital-automation-notice' }, notice) : null,
      error.length > 0 ? h('p', { className: 'capital-automation-error' }, error) : null),

    h('section', { className: 'capital-automation-card' },
      h('h3', null, zh.config),
      h('label', { className: 'capital-automation-field' }, h('span', null, zh.titleField), h('input', { value: task.title, disabled: busy, onChange: (event) => set({ title: event.target.value }) })),
      h('label', { className: 'capital-automation-field' }, h('span', null, zh.descriptionField), h('textarea', { value: task.description ?? '', disabled: busy, onChange: (event) => set({ description: event.target.value }) })),
      h('label', { className: 'capital-automation-field' }, h('span', null, zh.instructionField), h('textarea', { value: task.instruction, disabled: busy, onChange: (event) => set({ instruction: event.target.value }) })),
      h('h3', null, zh.triggerField),
      h(TriggerFields, { trigger: task.trigger, disabled: busy, onChange: (trigger) => set({ trigger }) }),
      h('div', { className: 'capital-automation-grid' },
        h('label', { className: 'capital-automation-field' }, h('span', null, zh.workspaceField),
          h('select', { value: task.workspaceId ?? '', disabled: busy, onChange: (event) => set({ workspaceId: event.target.value }) },
            workspaceOptions(meta, task.workspaceId).map((option) => h('option', { key: option.id, value: option.id }, option.title)))),
        h('label', { className: 'capital-automation-field' }, h('span', null, zh.modeField),
          h('select', { value: task.mode, disabled: busy, onChange: (event) => set({ mode: event.target.value }) },
            Object.entries(zh.mode).map(([value, label]) => h('option', { key: value, value }, label)))),
        h('label', { className: 'capital-automation-field' }, h('span', null, zh.runTimeout),
          h('input', { type: 'number', min: 5, max: 120, value: task.limits.runTimeoutMinutes, disabled: busy, onChange: (event) => set((current) => ({ limits: { ...current.limits, runTimeoutMinutes: Number(event.target.value) } })) })),
        h('label', { className: 'capital-automation-field' }, h('span', null, zh.idleTimeout),
          h('input', { type: 'number', min: 1, max: 30, value: task.limits.idleTimeoutMinutes, disabled: busy, onChange: (event) => set((current) => ({ limits: { ...current.limits, idleTimeoutMinutes: Number(event.target.value) } })) })),
        h('label', { className: 'capital-automation-field' }, h('span', null, zh.maxSteps),
          h('input', { type: 'number', min: 10, max: 2000, value: task.limits.maxSteps, disabled: busy, onChange: (event) => set((current) => ({ limits: { ...current.limits, maxSteps: Number(event.target.value) } })) })),
        h('label', { className: 'capital-automation-field' }, h('span', null, zh.maxToolCalls),
          h('input', { type: 'number', min: 10, max: 6000, value: task.limits.maxToolCalls, disabled: busy, onChange: (event) => set((current) => ({ limits: { ...current.limits, maxToolCalls: Number(event.target.value) } })) }))),
      h('p', { className: 'capital-automation-hint' }, zh.modeHint),
      meta?.workspaceError ? h('p', { className: 'capital-automation-error' }, zh.workspaceUnavailable) : null,
      h('h3', null, zh.notifyField),
      h(SwitchRow, { label: zh.notifyInApp, checked: task.notifications.inApp, disabled: busy, onChange: (value) => set((current) => ({ notifications: { ...current.notifications, inApp: value } })) }),
      h(SwitchRow, { label: zh.notifyFailure, checked: task.notifications.onFailure, disabled: busy, onChange: (value) => set((current) => ({ notifications: { ...current.notifications, onFailure: value } })) }),
      h(SwitchRow, { label: zh.notifySuccess, checked: task.notifications.onSuccess, disabled: busy, onChange: (value) => set((current) => ({ notifications: { ...current.notifications, onSuccess: value } })) }),
      h('div', { className: 'capital-automation-actions' },
        h('button', { type: 'button', className: 'capital-automation-btn', 'data-primary': 'true', disabled: busy || !storageReady, onClick: save }, busy === 'save' ? zh.saving : zh.save))),

    h('section', { className: 'capital-automation-card' },
      h('h3', null, zh.runs),
      detail.runs.length === 0 ? h('p', { className: 'capital-automation-hint' }, zh.noRuns) : null,
      detail.runs.map((run) => h('div', { key: run.id, className: 'capital-automation-run' },
        h('div', { className: 'capital-automation-run-head' },
          h('span', { className: 'capital-automation-run-status', 'data-status': run.status }, statusLabel(run.status)),
          h('span', { className: 'capital-automation-run-meta' }, `${formatTime(run.queuedAt)} · ${run.trigger === 'manual' ? '手动' : '定时'}`),
          typeof run.durationMs === 'number' ? h('span', { className: 'capital-automation-run-meta' }, `${zh.duration} ${formatDuration(run.durationMs)}`) : null,
          h('span', { className: 'capital-automation-run-meta' }, `${zh.steps} ${run.steps} · ${zh.tools} ${run.toolCalls}`),
          ['queued', 'starting', 'running'].includes(run.status)
            ? h('button', { type: 'button', className: 'capital-automation-btn', 'data-danger': 'true', disabled: busy, onClick: () => act(`cancel-${run.id}`, async () => { await api.cancel(run.id) }) }, zh.cancelRun)
            : run.sessionId && openSession
              ? h('button', { type: 'button', className: 'capital-automation-btn', onClick: () => openSession(run.sessionId) }, zh.openSession)
              : null),
        run.sessionTitle ? h('span', { className: 'capital-automation-run-meta' }, run.sessionTitle) : null,
        run.summary ? h('span', { className: 'capital-automation-run-meta' }, run.summary) : null,
        run.errors.map((item, index) => h('span', { key: `${run.id}-${index}`, className: 'capital-automation-error-item' }, `${item.code}: ${item.message}`)))),

    h('section', { className: 'capital-automation-card' },
      h('h3', null, zh.policy),
      h('p', { className: 'capital-automation-hint' }, zh.policyText),
      h('p', { className: 'capital-automation-hint' }, zh.budgetHint),
      h('p', { className: 'capital-automation-hint' }, `profileKey: ${meta?.profile?.key ?? '-'} · ${zh.presetLabel}: ${zh.presetValue} · cwdKind: profile`)),

    h('section', { className: 'capital-automation-card' },
      h('div', { className: 'capital-automation-actions' },
        h('h3', null, zh.notifications),
        detail.notifications.some((item) => item.readAt === undefined)
          ? h('button', { type: 'button', className: 'capital-automation-btn', disabled: busy, onClick: () => act('read-notifications', async () => { await api.markRead({ all: true }) }) }, zh.markRead)
          : null),
      detail.notifications.length === 0 ? h('p', { className: 'capital-automation-hint' }, zh.inboxEmpty) : null,
      detail.notifications.map((item) => h('div', { key: item.id, className: 'capital-automation-run' },
        h('div', { className: 'capital-automation-run-head' },
          h('strong', null, item.title),
          h('span', { className: 'capital-automation-run-meta' }, formatTime(item.createdAt))),
        h('span', { className: 'capital-automation-run-meta' }, item.message))))))
}

function NewTaskWizard(props) {
  const { open, onClose, api, onCreated, meta } = props
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    instruction: '',
    category: 'research',
    trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true },
    mode: 'research',
    workspaceId: '',
    limits: { runTimeoutMinutes: 30, idleTimeoutMinutes: 5, maxSteps: 300, maxToolCalls: 1200 },
    notifications: { inApp: true, onFailure: true, onSuccess: false },
  })
  useEffect(() => {
    if (!open) return
    setStep(0)
    setError('')
    setBusy(false)
    setDraft({
      title: '',
      description: '',
      instruction: '',
      category: 'research',
      trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true },
      mode: 'research',
      workspaceId: '',
      limits: { runTimeoutMinutes: 30, idleTimeoutMinutes: 5, maxSteps: 300, maxToolCalls: 1200 },
      notifications: { inApp: true, onFailure: true, onSuccess: false },
    })
  }, [open])
  const set = (patch) => setDraft((current) => ({
    ...current,
    ...(typeof patch === 'function' ? patch(current) : patch),
  }))
  async function create() {
    if (draft.title.trim().length === 0 || draft.instruction.trim().length === 0) { setError(zh.required); return }
    setBusy(true)
    setError('')
    try {
      await api.create({
        title: draft.title.trim(),
        description: draft.description,
        instruction: draft.instruction,
        category: draft.category,
        trigger: draft.trigger,
        mode: draft.mode,
        workspaceId: draft.workspaceId ?? '',
        limits: draft.limits,
        notifications: draft.notifications,
      })
      onCreated()
    } catch (failure) {
      setError(failure.message ?? zh.errorGeneric)
    } finally {
      setBusy(false)
    }
  }
  if (!open) return null
  return h(Modal, {
    open,
    onClose,
    title: zh.newTask,
    closeLabel: zh.close,
    footer: h('div', { className: 'capital-automation-actions' },
      step > 0 ? h('button', { type: 'button', className: 'capital-automation-btn', onClick: () => setStep(step - 1), disabled: busy }, zh.back) : null,
      step < 2
        ? h('button', { type: 'button', className: 'capital-automation-btn', 'data-primary': 'true', onClick: () => setStep(step + 1), disabled: busy }, zh.next)
        : h('button', { type: 'button', className: 'capital-automation-btn', 'data-primary': 'true', onClick: create, disabled: busy || meta?.storage?.state === 'unavailable' }, busy ? zh.saving : zh.create)),
  },
  h('div', { className: 'capital-automation-wizard' },
    h('div', { className: 'capital-automation-steps' },
      [zh.step1, zh.step2, zh.step3].map((label, index) => h('span', { key: label, className: 'capital-automation-step', 'data-active': index === step ? 'true' : 'false' }, `${index + 1}. ${label}`))),
    step === 0 ? h('div', { className: 'capital-automation-grid' },
      h('label', { className: 'capital-automation-field' }, h('span', null, zh.titleField), h('input', { value: draft.title, onChange: (event) => set({ title: event.target.value }) })),
      h('label', { className: 'capital-automation-field' }, h('span', null, zh.descriptionField), h('textarea', { value: draft.description, onChange: (event) => set({ description: event.target.value }) })),
      h('label', { className: 'capital-automation-field' }, h('span', null, zh.instructionField), h('textarea', { value: draft.instruction, onChange: (event) => set({ instruction: event.target.value }) }))) : null,
    step === 1 ? h('div', null,
      h(TriggerFields, { trigger: draft.trigger, onChange: (trigger) => set({ trigger }) }),
      h('p', { className: 'capital-automation-hint' }, '交易日历不可用时任务会记为 skipped_calendar_unavailable，不按周一至周五猜测运行。')) : null,
    step === 2 ? h('div', null,
      h('div', { className: 'capital-automation-grid' },
        h('label', { className: 'capital-automation-field' }, h('span', null, zh.workspaceField),
          h('select', { value: draft.workspaceId ?? '', onChange: (event) => set({ workspaceId: event.target.value }) },
            workspaceOptions(meta, draft.workspaceId).map((option) => h('option', { key: option.id, value: option.id }, option.title)))),
        h('label', { className: 'capital-automation-field' }, h('span', null, zh.modeField),
          h('select', { value: draft.mode, onChange: (event) => set({ mode: event.target.value }) },
            Object.entries(zh.mode).map(([value, label]) => h('option', { key: value, value }, label)))),
        h('label', { className: 'capital-automation-field' }, h('span', null, zh.runTimeout), h('input', { type: 'number', min: 5, max: 120, value: draft.limits.runTimeoutMinutes, onChange: (event) => set((current) => ({ limits: { ...current.limits, runTimeoutMinutes: Number(event.target.value) } })) })),
        h('label', { className: 'capital-automation-field' }, h('span', null, zh.idleTimeout), h('input', { type: 'number', min: 1, max: 30, value: draft.limits.idleTimeoutMinutes, onChange: (event) => set((current) => ({ limits: { ...current.limits, idleTimeoutMinutes: Number(event.target.value) } })) })),
        h('label', { className: 'capital-automation-field' }, h('span', null, zh.maxSteps), h('input', { type: 'number', min: 10, max: 2000, value: draft.limits.maxSteps, onChange: (event) => set((current) => ({ limits: { ...current.limits, maxSteps: Number(event.target.value) } })) })),
        h('label', { className: 'capital-automation-field' }, h('span', null, zh.maxToolCalls), h('input', { type: 'number', min: 10, max: 6000, value: draft.limits.maxToolCalls, onChange: (event) => set((current) => ({ limits: { ...current.limits, maxToolCalls: Number(event.target.value) } })) }))),
      h('p', { className: 'capital-automation-hint' }, zh.modeHint),
      meta?.workspaceError ? h('p', { className: 'capital-automation-error' }, zh.workspaceUnavailable) : null,
      h(SwitchRow, { label: zh.notifyInApp, checked: draft.notifications.inApp, onChange: (value) => set((current) => ({ notifications: { ...current.notifications, inApp: value } })) }),
      h(SwitchRow, { label: zh.notifyFailure, checked: draft.notifications.onFailure, onChange: (value) => set((current) => ({ notifications: { ...current.notifications, onFailure: value } })) }),
      h(SwitchRow, { label: zh.notifySuccess, checked: draft.notifications.onSuccess, onChange: (value) => set((current) => ({ notifications: { ...current.notifications, onSuccess: value } })) })) : null,
    error.length > 0 ? h('p', { className: 'capital-automation-error' }, error) : null))
}

function AutomationPage(props) {
  const { api, openSession } = props
  const [meta, setMeta] = useState(null)
  const [tasks, setTasks] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [wizard, setWizard] = useState(false)
  const [loadError, setLoadError] = useState('')
  const mountedRef = useRef(false)
  const selectedIdRef = useRef(null)
  const refreshInFlightRef = useRef(null)
  const refreshSequenceRef = useRef(0)
  const detailSequenceRef = useRef(0)

  async function refresh() {
    if (refreshInFlightRef.current !== null) return refreshInFlightRef.current
    const requestSequence = refreshSequenceRef.current + 1
    refreshSequenceRef.current = requestSequence
    const request = (async () => {
      try {
        const [nextMeta, nextTasks] = await Promise.all([api.meta(), api.tasks()])
        if (!mountedRef.current || requestSequence !== refreshSequenceRef.current) return
        const nextTaskList = Array.isArray(nextTasks.tasks) ? nextTasks.tasks : []
        setMeta(nextMeta)
        setTasks(nextTaskList)
        setLoadError('')
        const currentId = selectedIdRef.current
        const nextId = currentId !== null && nextTaskList.some((task) => task.id === currentId)
          ? currentId
          : (nextTaskList[0]?.id ?? null)
        if (nextId !== currentId) {
          selectedIdRef.current = nextId
          detailSequenceRef.current += 1
          setDetail(null)
          setSelectedId(nextId)
        }
      } catch (error) {
        if (mountedRef.current && requestSequence === refreshSequenceRef.current) {
          setLoadError(error.message ?? zh.errorGeneric)
        }
      }
    })()
    refreshInFlightRef.current = request
    try {
      await request
    } finally {
      if (refreshInFlightRef.current === request) refreshInFlightRef.current = null
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

  function selectTask(id) {
    if (selectedIdRef.current === id) return
    selectedIdRef.current = id
    detailSequenceRef.current += 1
    setDetail(null)
    setSelectedId(id)
  }

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh()
    }, 15_000)
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
    if (selectedId === null) {
      setDetail(null)
      detailSequenceRef.current += 1
      return undefined
    }
    setDetail(null)
    void loadDetail(selectedId)
    return () => { detailSequenceRef.current += 1 }
  }, [selectedId])

  const groups = groupTasks(tasks)
  const schedulerState = meta?.scheduler?.state
  const storageReady = meta?.storage?.state !== 'unavailable'
  return h('div', { className: 'capital-automation-page' },
    h('header', { className: 'capital-automation-head' },
      h('div', null,
        h('h1', { className: 'capital-automation-title' }, zh.title),
        h('p', { className: 'capital-automation-sub' }, zh.subtitle)),
      h('div', { className: 'capital-automation-meta' },
        h('span', { className: 'capital-automation-badge' }, `${zh.profile}: ${meta?.profile?.name ?? '—'}`),
        h('span', { className: 'capital-automation-badge', 'data-ok': schedulerState === 'active' ? 'true' : 'false' },
          `${zh.scheduler}: ${schedulerState === 'active' ? zh.schedulerActive : schedulerState === 'standby' ? zh.schedulerStandby : schedulerState === 'stopped' ? zh.schedulerStopped : zh.schedulerStarting}`),
        h('span', { className: 'capital-automation-badge', 'data-ok': meta?.calendar?.available === true ? 'true' : 'false' },
          `${zh.calendar}: ${meta?.calendar?.available === true ? zh.calendarOk : zh.calendarMissing}`),
        h('span', { className: 'capital-automation-badge' }, `v${meta?.version ?? '—'}`),
        h('button', { type: 'button', className: 'capital-automation-btn', 'data-primary': 'true', disabled: !storageReady, onClick: () => setWizard(true) }, zh.newTask))),
    !storageReady && meta ? h('div', { className: 'capital-automation-banner' }, `${zh.storageUnavailable}${meta.storage?.error ? `：${meta.storage.error}` : ''}`) : null,
    loadError.length > 0 ? h('p', { className: 'capital-automation-error' }, loadError) : null,
    h('div', { className: 'capital-automation-body' },
      h('aside', { className: 'capital-automation-list' },
        tasks.length === 0 ? h('p', { className: 'capital-automation-empty' }, zh.empty) : null,
        [...groups.entries()].map(([key, bucket]) => h('section', { key, className: 'capital-automation-group' },
          h('h2', { className: 'capital-automation-group-title' }, zh.groups[key] ?? key),
          bucket.map((task) => h(TaskRow, { key: task.id, task, selected: task.id === selectedId, onSelect: selectTask }))))),
      h('main', { className: 'capital-automation-detail' },
        detail === null ? h('p', { className: 'capital-automation-empty' }, zh.noSelection) : null,
        detail !== null ? h(TaskDetail, {
          detail,
          meta,
          api,
          openSession,
          onChanged: async (taskId) => {
            await refresh()
            const id = taskId ?? selectedIdRef.current
            if (id !== null && selectedIdRef.current === id) await loadDetail(id)
          },
        }) : null)),
    h(NewTaskWizard, {
      open: wizard,
      onClose: () => setWizard(false),
      api,
      meta,
      onCreated: async () => {
        setWizard(false)
        await refresh()
      },
    }))
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
