/**
 * Strict storage and wire schemas for the automation domain. Every object is a
 * `strictObject`: an unknown field is a write error, not something JSON will silently drop.
 * Run/notification records are disposable; task records are authoritative.
 */
import { z } from 'zod'
import {
  ACTIVE_RUN_STATUSES,
  MAX_DESCRIPTION_CHARS,
  MAX_ERROR_MESSAGE_CHARS,
  MAX_ERRORS_PER_RUN,
  MAX_INSTRUCTION_CHARS,
  MAX_MAX_STEPS,
  MAX_MAX_TOOL_CALLS,
  MAX_RUN_TIMEOUT_MINUTES,
  MAX_TITLE_CHARS,
  MIN_MAX_STEPS,
  MIN_MAX_TOOL_CALLS,
  MIN_RUN_TIMEOUT_MINUTES,
  RUN_STATUSES,
} from './defaults.js'

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Canonical UTC ISO instant; `Date.parse` alone accepts offsets and seconds variants. */
export const isoInstant = z.string().refine((value) => ISO_UTC.test(value) && new Date(value).toISOString() === value, {
  message: 'must be a canonical UTC ISO instant',
})

const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export function isValidTimeZone(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

export const timeZone = z.string().min(1).max(64).refine(isValidTimeZone, { message: 'must be a valid IANA time zone' })

/** Registered Workspace id; empty/absent means the profile's dedicated automation workspace. */
export const workspaceId = z.string().max(120)

export const TriggerSchema = z.strictObject({
  kind: z.literal('schedule'),
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  time: z.string().regex(TIME_OF_DAY, { message: 'must be HH:mm' }),
  timezone: timeZone,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  tradingDaysOnly: z.boolean(),
}).superRefine((trigger, ctx) => {
  if (trigger.cadence === 'weekly') {
    if (trigger.weekdays === undefined) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'weekly requires weekdays' })
    else if (new Set(trigger.weekdays).size !== trigger.weekdays.length) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'weekdays must be unique' })
    if (trigger.dayOfMonth !== undefined) ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'weekly must not carry dayOfMonth' })
  }
  if (trigger.cadence === 'monthly') {
    if (trigger.dayOfMonth === undefined) ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'monthly requires dayOfMonth' })
    if (trigger.weekdays !== undefined) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'monthly must not carry weekdays' })
  }
  if (trigger.cadence === 'daily') {
    if (trigger.weekdays !== undefined) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'daily must not carry weekdays' })
    if (trigger.dayOfMonth !== undefined) ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'daily must not carry dayOfMonth' })
  }
})

export const LimitsSchema = z.strictObject({
  runTimeoutMinutes: z.number().int().min(MIN_RUN_TIMEOUT_MINUTES).max(MAX_RUN_TIMEOUT_MINUTES),
  idleTimeoutMinutes: z.number().int().min(1).max(30),
  maxSteps: z.number().int().min(MIN_MAX_STEPS).max(MAX_MAX_STEPS),
  maxToolCalls: z.number().int().min(MIN_MAX_TOOL_CALLS).max(MAX_MAX_TOOL_CALLS),
})

export const NotificationsSchema = z.strictObject({
  inApp: z.boolean(),
  onFailure: z.boolean(),
  onSuccess: z.boolean(),
})

export const ExecutionModeSchema = z.enum(['news', 'market', 'review', 'research'])

/** User-writable configuration. Server-owned fields are deliberately absent. */
export const TaskConfigSchema = z.strictObject({
  category: z.enum(['news', 'market', 'review', 'research']),
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  description: z.string().max(MAX_DESCRIPTION_CHARS),
  trigger: TriggerSchema,
  instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS),
  mode: ExecutionModeSchema,
  cwdKind: z.literal('profile'),
  workspaceId: workspaceId.optional(),
  limits: LimitsSchema,
  notifications: NotificationsSchema,
})

export const TaskOverridesSchema = z.strictObject({
  category: z.enum(['news', 'market', 'review', 'research']).optional(),
  title: z.string().min(1).max(MAX_TITLE_CHARS).optional(),
  description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
  trigger: TriggerSchema.optional(),
  instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS).optional(),
  mode: ExecutionModeSchema.optional(),
  workspaceId: workspaceId.optional(),
  limits: LimitsSchema.optional(),
  notifications: NotificationsSchema.optional(),
})

export const TaskStateSchema = z.enum(['dormant', 'active', 'paused'])

export const AutomationTaskSchema = z.strictObject({
  id: z.string().min(1).max(80),
  schemaVersion: z.literal(1),
  definitionVersion: z.number().int().min(0),
  origin: z.enum(['builtin', 'custom']),
  sourceBuiltinId: z.string().min(1).max(80).optional(),
  profileKey: z.string().min(1).max(80),
  profileName: z.string().min(1).max(200),
  state: TaskStateSchema,
  category: z.enum(['news', 'market', 'review', 'research']),
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  description: z.string().max(MAX_DESCRIPTION_CHARS),
  trigger: TriggerSchema,
  instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS),
  mode: ExecutionModeSchema,
  cwdKind: z.literal('profile'),
  workspaceId: workspaceId.optional(),
  limits: LimitsSchema,
  notifications: NotificationsSchema,
  overrides: TaskOverridesSchema.optional(),
  scheduleAnchorAt: isoInstant,
  lastHandledOccurrenceKey: z.string().max(300).optional(),
  lastScheduledFor: isoInstant.optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})

/** Durable builtin override row. Runtime fields (state, anchors) always sit on the record. */
export const TaskRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(80),
  origin: z.enum(['builtin', 'custom']),
  sourceBuiltinId: z.string().min(1).max(80).optional(),
  profileKey: z.string().min(1).max(80),
  profileName: z.string().min(1).max(200),
  state: TaskStateSchema,
  definitionVersion: z.number().int().min(0),
  custom: TaskConfigSchema.optional(),
  overrides: TaskOverridesSchema.optional(),
  scheduleAnchorAt: isoInstant,
  lastHandledOccurrenceKey: z.string().max(300).optional(),
  lastScheduledFor: isoInstant.optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})

export const RunErrorSchema = z.strictObject({
  at: isoInstant,
  phase: z.enum(['schedule', 'session', 'turn', 'tool', 'llm', 'timeout', 'storage']),
  severity: z.enum(['error', 'warning']),
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(MAX_ERROR_MESSAGE_CHARS),
  tool: z.string().max(80).optional(),
  callId: z.string().max(120).optional(),
})

export const RunRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(80),
  profileKey: z.string().min(1).max(80),
  taskId: z.string().min(1).max(80),
  taskTitle: z.string().min(1).max(MAX_TITLE_CHARS),
  trigger: z.enum(['scheduled', 'manual']),
  occurrenceKey: z.string().min(1).max(300),
  scheduleVersion: z.string().min(1).max(80).optional(),
  scheduledFor: isoInstant.optional(),
  status: z.enum(RUN_STATUSES),
  sessionId: z.string().min(1).max(120).optional(),
  sessionTitle: z.string().min(1).max(200).optional(),
  queuedAt: isoInstant,
  startedAt: isoInstant.optional(),
  finishedAt: isoInstant.optional(),
  durationMs: z.number().int().min(0).optional(),
  steps: z.number().int().min(0),
  toolCalls: z.number().int().min(0),
  blockedRequiresUser: z.boolean(),
  errors: z.array(RunErrorSchema).max(MAX_ERRORS_PER_RUN),
  summary: z.string().max(2_000).optional(),
})

export const AttemptRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(300),
  profileKey: z.string().min(1).max(80),
  taskId: z.string().min(1).max(80),
  runId: z.string().min(1).max(80),
  occurrenceKey: z.string().min(1).max(300),
  state: z.enum(['claimed', 'session_created', 'prompt_submitted', 'accepted', 'failed', 'unknown']),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})

export const NotificationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(80),
  profileKey: z.string().min(1).max(80),
  kind: z.enum(['run_failed', 'run_timeout', 'run_succeeded', 'scheduler_standby', 'calendar_unavailable', 'skipped']),
  title: z.string().min(1).max(120),
  message: z.string().max(MAX_ERROR_MESSAGE_CHARS),
  runId: z.string().min(1).max(80).optional(),
  taskId: z.string().min(1).max(80).optional(),
  createdAt: isoInstant,
  readAt: isoInstant.optional(),
})

export const OwnerRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profileKey: z.string().min(1).max(80),
  ownerId: z.string().min(1).max(120),
  fencingToken: z.string().min(1).max(120),
  leaseExpiresAt: isoInstant,
  heartbeatAt: isoInstant,
  schedulerState: z.enum(['active', 'standby']),
  updatedAt: isoInstant,
})

/** Create/patch wire schemas: no profile, owner, session, preset or cwd field exists at all. */
export const TaskCreateSchema = z.strictObject({
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
  instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS),
  category: z.enum(['news', 'market', 'review', 'research']),
  trigger: TriggerSchema,
  mode: ExecutionModeSchema,
  workspaceId: workspaceId.optional(),
  limits: LimitsSchema.optional(),
  notifications: NotificationsSchema.optional(),
})

export const TaskPatchSchema = z.strictObject({
  title: z.string().min(1).max(MAX_TITLE_CHARS).optional(),
  description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
  instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS).optional(),
  category: z.enum(['news', 'market', 'review', 'research']).optional(),
  trigger: TriggerSchema.optional(),
  mode: ExecutionModeSchema.optional(),
  workspaceId: workspaceId.optional(),
  limits: LimitsSchema.optional(),
  notifications: NotificationsSchema.optional(),
})

export const NotificationsReadSchema = z.strictObject({
  ids: z.array(z.string().min(1).max(80)).max(200).optional(),
  all: z.boolean().optional(),
}).refine((value) => value.all === true || (value.ids !== undefined && value.ids.length > 0), {
  message: 'either all=true or a non-empty ids array is required',
})

export const BuiltinDefaultsSchema = z.strictObject({
  state: z.literal('dormant'),
  category: z.enum(['news', 'market', 'review', 'research']),
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  description: z.string().max(MAX_DESCRIPTION_CHARS),
  trigger: TriggerSchema,
  instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS),
  mode: ExecutionModeSchema,
  cwdKind: z.literal('profile'),
  limits: LimitsSchema,
  notifications: NotificationsSchema,
})

export const BuiltinDefinitionSchema = z.strictObject({
  id: z.string().min(1).max(80),
  version: z.number().int().min(1),
  category: z.enum(['news', 'market', 'review', 'research']),
  defaults: BuiltinDefaultsSchema,
})

/** Reject values JSON would silently change: undefined, NaN/Infinity, holes, non-object members. */
export function assertCleanJson(value, path = '$') {
  if (value === undefined) throw new TypeError(`undefined is not allowed at ${path}`)
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`non-finite number at ${path}`)
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError(`unsupported value at ${path}`)
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new TypeError(`sparse array hole at ${path}[${index}]`)
      assertCleanJson(value[index], `${path}[${index}]`)
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) throw new TypeError(`non-plain object at ${path}`)
    for (const [key, item] of Object.entries(value)) assertCleanJson(item, `${path}.${key}`)
  }
}

export function parseStrict(schema, value, label) {
  try {
    assertCleanJson(value)
  } catch (error) {
    throw new SchemaError('invalid_record', `${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue?.path?.length ? ` at ${issue.path.join('.')}` : ''
    throw new SchemaError('invalid_record', `${label}${where}: ${issue?.message ?? 'invalid value'}`)
  }
  return result.data
}

export class SchemaError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SchemaError'
    this.code = code
  }
}

export function isActiveRun(status) {
  return ACTIVE_RUN_STATUSES.includes(status)
}

/** Merge order: code definition -> legal user override -> server runtime fields. */
export function resolveTaskRecord(record, definition) {
  const base = record.origin === 'builtin'
    ? definition?.defaults
    : record.custom
  if (base === undefined) throw new SchemaError('invalid_record', `task ${record.id} has no resolvable base configuration`)
  const overrides = record.overrides ?? {}
  const merged = {
    ...base,
    ...overrides,
    state: record.state,
  }
  const task = {
    id: record.id,
    schemaVersion: 1,
    definitionVersion: record.definitionVersion,
    origin: record.origin,
    ...(record.sourceBuiltinId === undefined ? {} : { sourceBuiltinId: record.sourceBuiltinId }),
    profileKey: record.profileKey,
    profileName: record.profileName,
    ...merged,
    ...(record.overrides === undefined ? {} : { overrides: record.overrides }),
    scheduleAnchorAt: record.scheduleAnchorAt,
    ...(record.lastHandledOccurrenceKey === undefined ? {} : { lastHandledOccurrenceKey: record.lastHandledOccurrenceKey }),
    ...(record.lastScheduledFor === undefined ? {} : { lastScheduledFor: record.lastScheduledFor }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
  return parseStrict(AutomationTaskSchema, task, 'automation task')
}
