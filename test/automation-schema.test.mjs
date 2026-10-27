import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AutomationTaskSchema,
  TaskCreateSchema,
  TaskRecordSchema,
  assertCleanJson,
  resolveTaskRecord,
} from '../automation/schema.js'
import { BUILTIN_DEFINITIONS, BUILTIN_BY_ID } from '../automation/builtins.js'
import { sanitizeMessage } from '../automation/redact.js'
import {
  DEFAULT_AUTOMATION_SETTINGS,
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_TOOL_CALLS,
  MAX_MAX_STEPS,
  MAX_MAX_TOOL_CALLS,
} from '../automation/defaults.js'
import { Config as HostConfig } from '../config/index.js'
import { Config as MainConfig } from '../lib/index.js'

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

test('三个内置模板全部 dormant，默认触发直接落在交易日', () => {
  assert.equal(BUILTIN_DEFINITIONS.length, 3)
  assert.deepEqual(BUILTIN_DEFINITIONS.map((item) => item.id), ['morning-brief', 'post-close-filings', 'daily-review'])
  for (const definition of BUILTIN_DEFINITIONS) {
    assert.equal(definition.defaults.state, 'dormant')
    assert.equal(definition.defaults.trigger.kind, 'schedule')
    assert.equal(definition.defaults.trigger.timezone, 'Asia/Shanghai')
    assert.equal(definition.defaults.trigger.tradingDaysOnly, true)
    assert.equal(definition.defaults.cwdKind, 'profile')
    assert.ok(definition.defaults.instruction.includes('无人值守执行策略'))
  }
})

test('wire create schema 不接受 profile / owner / session / preset / cwd / state 这类服务端字段', () => {
  const base = {
    title: '测试任务',
    instruction: '做一件事',
    category: 'news',
    trigger: { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true },
    mode: 'news',
  }
  const parsed = TaskCreateSchema.parse(base)
  assert.equal(parsed.title, '测试任务')
  assert.equal(TaskCreateSchema.parse({ ...base, workspaceId: 'ws_1' }).workspaceId, 'ws_1')
  assert.equal(TaskCreateSchema.parse({ ...base, workspaceId: '' }).workspaceId, '', '空值表示默认工作区')
  for (const forbidden of ['profileKey', 'profileName', 'ownerId', 'sessionId', 'agentPreset', 'presetId', 'cwd', 'state', 'origin']) {
    assert.throws(() => TaskCreateSchema.parse({ ...base, [forbidden]: 'x' }), `\`${forbidden}\` 必须被 strict schema 拒绝`)
  }
})

test('触发闭集：无效时区、weekly 缺 weekdays、monthly day 29、daily 带 weekdays 全部拒绝', () => {
  const base = { kind: 'schedule', cadence: 'daily', time: '09:00', timezone: 'Asia/Shanghai', tradingDaysOnly: true }
  assert.throws(() => TaskCreateSchema.parse({ title: 't', instruction: 'i', category: 'news', mode: 'news', trigger: { ...base, timezone: 'Mars/Olympus' } }))
  assert.throws(() => TaskCreateSchema.parse({ title: 't', instruction: 'i', category: 'news', mode: 'news', trigger: { ...base, cadence: 'weekly' } }))
  assert.throws(() => TaskCreateSchema.parse({ title: 't', instruction: 'i', category: 'news', mode: 'news', trigger: { ...base, cadence: 'monthly', dayOfMonth: 29 } }))
  assert.throws(() => TaskCreateSchema.parse({ title: 't', instruction: 'i', category: 'news', mode: 'news', trigger: { ...base, weekdays: [1] } }))
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
