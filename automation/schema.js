/**
 * Strict storage and wire schemas for the automation domain. Every object is a
 * `strictObject`: an unknown field is a write error, not something JSON will silently drop.
 * Run/notification records are disposable; task records are authoritative.
 */
import { z } from 'zod'
import {
  ACTIVE_RUN_STATUSES,
  DEFAULT_AUTOMATION_SETTINGS,
  MAX_DESCRIPTION_CHARS,
  MAX_ASK_PREVIEW_CHARS,
  MAX_ASK_QUESTION_CHARS,
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
import { TASK_ICON_IDS } from './task-icons.js'

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Canonical UTC ISO instant; `Date.parse` alone accepts offsets and seconds variants. */
export const isoInstant = z.string().refine((value) => ISO_UTC.test(value) && new Date(value).toISOString() === value, {
  message: 'must be a canonical UTC ISO instant',
})

const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isCalendarDate(value) {
  if (typeof value !== 'string') return false
  const match = CALENDAR_DATE.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

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
  cadence: z.enum(['daily', 'weekly', 'monthly', 'once']),
  time: z.string().regex(TIME_OF_DAY, { message: 'must be HH:mm' }),
  timezone: timeZone,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  // `last` is the only value that cannot be expressed as a fixed day; 29–31 simply skip
  // months that do not have that day.
  dayOfMonth: z.union([z.number().int().min(1).max(31), z.literal('last')]).optional(),
  date: z.string().refine(isCalendarDate, { message: 'must be a valid YYYY-MM-DD date' }).optional(),
  tradingDaysOnly: z.boolean(),
}).superRefine((trigger, ctx) => {
  if (trigger.cadence === 'weekly') {
    if (trigger.weekdays === undefined) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'weekly requires weekdays' })
    else if (new Set(trigger.weekdays).size !== trigger.weekdays.length) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'weekdays must be unique' })
    if (trigger.dayOfMonth !== undefined) ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'weekly must not carry dayOfMonth' })
    if (trigger.date !== undefined) ctx.addIssue({ code: 'custom', path: ['date'], message: 'weekly must not carry date' })
  }
  if (trigger.cadence === 'monthly') {
    if (trigger.dayOfMonth === undefined) ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'monthly requires dayOfMonth' })
    if (trigger.weekdays !== undefined) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'monthly must not carry weekdays' })
    if (trigger.date !== undefined) ctx.addIssue({ code: 'custom', path: ['date'], message: 'monthly must not carry date' })
  }
  if (trigger.cadence === 'once') {
    if (trigger.date === undefined) ctx.addIssue({ code: 'custom', path: ['date'], message: 'once requires date' })
    if (trigger.weekdays !== undefined) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'once must not carry weekdays' })
    if (trigger.dayOfMonth !== undefined) ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'once must not carry dayOfMonth' })
  }
  if (trigger.cadence === 'daily') {
    if (trigger.weekdays !== undefined) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'daily must not carry weekdays' })
    if (trigger.dayOfMonth !== undefined) ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'daily must not carry dayOfMonth' })
    if (trigger.date !== undefined) ctx.addIssue({ code: 'custom', path: ['date'], message: 'daily must not carry date' })
  }
})

export const LimitsSchema = z.strictObject({
  runTimeoutMinutes: z.number().int().min(MIN_RUN_TIMEOUT_MINUTES).max(MAX_RUN_TIMEOUT_MINUTES),
  idleTimeoutMinutes: z.number().int().min(1).max(30),
  maxSteps: z.number().int().min(MIN_MAX_STEPS).max(MAX_MAX_STEPS),
  maxToolCalls: z.number().int().min(MIN_MAX_TOOL_CALLS).max(MAX_MAX_TOOL_CALLS),
})

/**
 * Stored records were written under older bounds. Clamp on read instead of rejecting the record:
 * the domain validates every row on load, so one out-of-range task would otherwise take the whole
 * table down. Writes still go through the strict `LimitsSchema`.
 */
const clampedInt = (min, max) => z.number().int().transform((value) => Math.min(max, Math.max(min, value)))
const StoredLimitsSchema = z.strictObject({
  runTimeoutMinutes: clampedInt(MIN_RUN_TIMEOUT_MINUTES, MAX_RUN_TIMEOUT_MINUTES),
  idleTimeoutMinutes: clampedInt(1, 30),
  maxSteps: clampedInt(MIN_MAX_STEPS, MAX_MAX_STEPS),
  maxToolCalls: clampedInt(MIN_MAX_TOOL_CALLS, MAX_MAX_TOOL_CALLS),
})

export const NotificationsSchema = z.strictObject({
  inApp: z.boolean(),
  onFailure: z.boolean(),
  onSuccess: z.boolean(),
})

export const TaskCategorySchema = z.enum(['news', 'market', 'review', 'research', 'portfolio', 'monitor'])
export const TaskIconIdSchema = z.enum(TASK_ICON_IDS)

/** User-writable configuration. Server-owned fields are deliberately absent. */
export const TaskConfigSchema = z.strictObject({
  category: TaskCategorySchema,
  icon: TaskIconIdSchema.optional(),
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  description: z.string().max(MAX_DESCRIPTION_CHARS),
  trigger: TriggerSchema,
  instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS),
  // Legacy pre-v3 duplicate of `category`; accepted only so old records still open.
  mode: TaskCategorySchema.optional(),
  cwdKind: z.literal('profile'),
  workspaceId: workspaceId.optional(),
  limits: LimitsSchema.optional(),
  notifications: NotificationsSchema,
})

export const TaskOverridesSchema = z.strictObject({
  category: TaskCategorySchema.optional(),
  title: z.string().min(1).max(MAX_TITLE_CHARS).optional(),
  description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
  trigger: TriggerSchema.optional(),
  instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS).optional(),
  // Legacy pre-v3 duplicate of `category`; never written by current code.
  mode: TaskCategorySchema.optional(),
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
  icon: TaskIconIdSchema.optional(),
  profileKey: z.string().min(1).max(80),
  profileName: z.string().min(1).max(200),
  state: TaskStateSchema,
  category: TaskCategorySchema,
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  description: z.string().max(MAX_DESCRIPTION_CHARS),
  trigger: TriggerSchema,
  instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS),
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

const StoredTaskConfigSchema = TaskConfigSchema.extend({ limits: StoredLimitsSchema.optional() })
const StoredTaskOverridesSchema = TaskOverridesSchema.extend({ limits: StoredLimitsSchema.optional() })

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
  custom: StoredTaskConfigSchema.optional(),
  overrides: StoredTaskOverridesSchema.optional(),
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

/** Durable turn boundary: recovery must distinguish an interrupted turn from a finished one. */
export const TurnStateSchema = z.strictObject({
  phase: z.enum(['running', 'ended']),
  turn: z.number().int().min(0),
  status: z.enum(RUN_STATUSES).optional(),
  at: isoInstant,
}).superRefine((state, ctx) => {
  if (state.phase === 'ended' && state.status === undefined) {
    ctx.addIssue({ code: 'custom', message: 'ended turn state requires status' })
  }
  if (state.phase === 'running' && state.status !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'running turn state must not carry status' })
  }
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
  turnState: TurnStateSchema.optional(),
  queuedAt: isoInstant,
  startedAt: isoInstant.optional(),
  finishedAt: isoInstant.optional(),
  durationMs: z.number().int().min(0).optional(),
  steps: z.number().int().min(0),
  toolCalls: z.number().int().min(0),
  blockedRequiresUser: z.boolean(),
  errors: z.array(RunErrorSchema).max(MAX_ERRORS_PER_RUN),
  summary: z.string().max(2_000).optional(),
  /** Candidate snapshot handed to a TODO verifier run; keeps late arrivals out of its results. */
  verificationTodoIds: z.array(z.string().min(1).max(200)).max(40).optional(),
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
  kind: z.enum([
    'run_failed',
    'run_timeout',
    'run_succeeded',
    'scheduler_standby',
    'calendar_unavailable',
    'skipped',
    'todo_triggered',
    'todo_needs_human',
  ]),
  title: z.string().min(1).max(120),
  message: z.string().max(MAX_ERROR_MESSAGE_CHARS),
  runId: z.string().min(1).max(80).optional(),
  taskId: z.string().min(1).max(80).optional(),
  todoId: z.string().min(1).max(200).optional(),
  createdAt: isoInstant,
  readAt: isoInstant.optional(),
})

/** Derived task brief. One per successful run; storage validates it on every open. */
export const BriefItemSchema = z.strictObject({
  kind: z.enum(['confirm', 'verify', 'track']),
  title: z.string().min(1).max(40),
  detail: z.string().max(120).optional(),
  symbol: z.string().max(20).optional(),
  trigger: z.string().max(80).optional(),
  dueAt: z.string().refine(isCalendarDate, { message: 'must be a valid YYYY-MM-DD date' }).optional(),
  dueLabel: z.string().max(20).optional(),
  sourceQuote: z.string().min(1).max(160),
})

export const BriefStockSchema = z.strictObject({
  symbol: z.string().min(1).max(20),
  name: z.string().min(1).max(40),
  roles: z.array(z.enum(['holding', 'watch', 'event', 'risk'])).min(1).max(3),
  note: z.string().max(80).optional(),
  nextAt: z.string().refine(isCalendarDate, { message: 'must be a valid YYYY-MM-DD date' }).optional(),
})

export const BriefGapSchema = z.strictObject({
  kind: z.enum(['capability', 'transient', 'conflict', 'quality']),
  topic: z.string().min(2).max(24),
  detail: z.string().min(1).max(100),
  sourceQuote: z.string().min(1).max(160),
})

export const TaskBriefSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profileKey: z.string().min(1).max(80),
  runId: z.string().min(1).max(80),
  taskId: z.string().min(1).max(80),
  sessionId: z.string().min(1).max(120).optional(),
  status: z.enum(['pending', 'ready', 'failed', 'skipped']),
  headline: z.string().min(4).max(24).optional(),
  plain: z.string().min(40).max(200).optional(),
  items: z.array(BriefItemSchema),
  stocks: z.array(BriefStockSchema).max(8),
  gaps: z.array(BriefGapSchema),
  coverage: z.enum(['full', 'partial']).optional(),
  model: z.string().max(120).optional(),
  promptVersion: z.number().int().min(1).max(99),
  sourceHash: z.string().regex(/^[a-f0-9]{16}$/).optional(),
  error: z.string().max(300).optional(),
  lastError: z.string().max(300).optional(),
  lastErrorAt: isoInstant.optional(),
  attempts: z.number().int().min(0).max(5),
  generatedAt: isoInstant.optional(),
  updatedAt: isoInstant,
}).superRefine((brief, ctx) => {
  if (brief.status === 'ready') {
    if (brief.headline === undefined) ctx.addIssue({ code: 'custom', path: ['headline'], message: 'ready brief requires headline' })
    if (brief.plain === undefined) ctx.addIssue({ code: 'custom', path: ['plain'], message: 'ready brief requires plain' })
  } else if (brief.status === 'failed') {
    if (brief.error === undefined) ctx.addIssue({ code: 'custom', path: ['error'], message: 'failed brief requires error' })
  } else if (brief.headline !== undefined || brief.plain !== undefined) {
    ctx.addIssue({ code: 'custom', message: `${brief.status} brief must not carry headline/plain` })
  }
})

/**
 * User decision on an aggregated TODO. Briefs stay read-only; the decision only suppresses
 * the version the user saw. A later run mentioning the same item produces a newer `lastSeenAt`
 * and the item shows up again.
 */
export const TodoAckSchema = z.strictObject({
  schemaVersion: z.literal(1),
  profileKey: z.string().min(1).max(80),
  todoId: z.string().min(1).max(200),
  /** Legacy field name: this is the decision timestamp for both confirmed and deferred. */
  confirmedAt: isoInstant,
  decision: z.enum(['confirmed', 'deferred']).optional(),
})

/** Derived tracking state for one TODO item; briefs and acks stay the source of truth. */
export const TodoWatchSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(80),
  profileKey: z.string().min(1).max(80),
  todoId: z.string().min(1).max(200),
  kind: z.enum(['confirm', 'verify']),
  status: z.enum(['watching', 'triggered', 'needs_human', 'resolved', 'expired']),
  resolvedFrom: z.enum(['watching', 'triggered', 'needs_human', 'expired']).optional(),
  title: z.string().min(1).max(40),
  detail: z.string().max(120).optional(),
  symbol: z.string().max(20).optional(),
  trigger: z.string().max(80).optional(),
  dueAt: z.string().refine(isCalendarDate, { message: 'must be a valid YYYY-MM-DD date' }).optional(),
  firstSeenAt: isoInstant,
  lastSeenAt: isoInstant,
  checkedAt: isoInstant.optional(),
  /** Set when the user asks the verifier to try this item again; cleared on the next verdict. */
  autoRequestedAt: isoInstant.optional(),
  /** Why the watch ended without a user decision; only valid while status is `expired`. */
  expiredReason: z.enum(['not_triggered', 'no_data', 'not_verified', 'not_confirmed', 'stale']).optional(),
  verdict: z.enum(['triggered', 'not_triggered', 'insufficient']).optional(),
  evidence: z.string().max(300).optional(),
  source: z.string().max(300).optional(),
  handoffReason: z.string().max(160).optional(),
  evidenceRunId: z.string().min(1).max(80).optional(),
  evidenceSessionId: z.string().min(1).max(120).optional(),
  notifiedAt: isoInstant.optional(),
  notifiedStatus: z.enum(['triggered', 'needs_human']).optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
}).superRefine((watch, ctx) => {
  if (watch.status === 'triggered' && watch.evidence === undefined) {
    ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'triggered watch requires evidence' })
  }
  if (watch.status === 'needs_human' && watch.handoffReason === undefined) {
    ctx.addIssue({ code: 'custom', path: ['handoffReason'], message: 'needs_human watch requires handoffReason' })
  }
  if (watch.expiredReason !== undefined && watch.status !== 'expired') {
    ctx.addIssue({ code: 'custom', path: ['expiredReason'], message: 'expiredReason is only valid on expired watches' })
  }
})

/**
 * One board follow-up. The question and its first finished turn live here; the Session remains
 * the full transcript. `baselineSeq` is the log cursor before the prompt, so a later lazy read
 * can tell this answer apart from the run's original assistant message.
 */
export const AskRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(80),
  profileKey: z.string().min(1).max(80),
  runId: z.string().min(1).max(120),
  sessionId: z.string().min(1).max(120),
  question: z.string().trim().min(1).max(MAX_ASK_QUESTION_CHARS),
  baselineSeq: z.number().int().min(-1),
  status: z.enum(['running', 'ready', 'failed']),
  preview: z.string().min(1).max(MAX_ASK_PREVIEW_CHARS).optional(),
  error: z.string().max(300).optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
  finishedAt: isoInstant.optional(),
}).superRefine((ask, ctx) => {
  if (ask.status === 'ready') {
    if (ask.preview === undefined) ctx.addIssue({ code: 'custom', path: ['preview'], message: 'ready ask requires preview' })
    if (ask.finishedAt === undefined) ctx.addIssue({ code: 'custom', path: ['finishedAt'], message: 'ready ask requires finishedAt' })
  } else if (ask.status === 'failed') {
    if (ask.error === undefined) ctx.addIssue({ code: 'custom', path: ['error'], message: 'failed ask requires error' })
    if (ask.finishedAt === undefined) ctx.addIssue({ code: 'custom', path: ['finishedAt'], message: 'failed ask requires finishedAt' })
  } else if (ask.preview !== undefined || ask.error !== undefined || ask.finishedAt !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'running ask must not carry preview/error/finishedAt' })
  }
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
  icon: TaskIconIdSchema.optional(),
  description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
  instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS),
  category: TaskCategorySchema,
  trigger: TriggerSchema,
  workspaceId: workspaceId.optional(),
  limits: LimitsSchema.optional(),
  notifications: NotificationsSchema.optional(),
})

export const TaskPatchSchema = z.strictObject({
  title: z.string().min(1).max(MAX_TITLE_CHARS).optional(),
  icon: TaskIconIdSchema.optional(),
  description: z.string().max(MAX_DESCRIPTION_CHARS).optional(),
  instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS).optional(),
  category: TaskCategorySchema.optional(),
  trigger: TriggerSchema.optional(),
  workspaceId: workspaceId.optional(),
  limits: LimitsSchema.optional(),
  notifications: NotificationsSchema.optional(),
})

export const TodoConfirmSchema = z.strictObject({
  id: z.string().min(1).max(200),
})

export const TodoDecisionSchema = z.strictObject({
  id: z.string().min(1).max(200),
  action: z.enum(['confirm', 'defer', 'auto']),
})

export const AskCreateSchema = z.strictObject({
  question: z.string().trim().min(1).max(MAX_ASK_QUESTION_CHARS),
  timeZone: timeZone.optional(),
})

export const NotificationsReadSchema = z.strictObject({
  ids: z.array(z.string().min(1).max(80)).max(200).optional(),
  all: z.boolean().optional(),
  scope: z.enum(['task', 'system', 'all']).optional(),
}).refine((value) => value.all === true || (value.ids !== undefined && value.ids.length > 0), {
  message: 'either all=true or a non-empty ids array is required',
})

export const BuiltinDefaultsSchema = z.strictObject({
  // Content templates ship dormant; the TODO verifier is an operational task and ships active.
  state: z.enum(['dormant', 'active']),
  category: TaskCategorySchema,
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  description: z.string().max(MAX_DESCRIPTION_CHARS),
  trigger: TriggerSchema,
  instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS),
  cwdKind: z.literal('profile'),
  limits: LimitsSchema,
  notifications: NotificationsSchema,
})

export const BuiltinDefinitionSchema = z.strictObject({
  id: z.string().min(1).max(80),
  version: z.number().int().min(1),
  category: TaskCategorySchema,
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

function withoutLegacyMode(value) {
  if (value === undefined || value.mode === undefined) return value
  const { mode: _legacyMode, ...rest } = value
  return rest
}

/** Merge order: code definition -> legal user override -> server runtime fields. */
export function resolveTaskRecord(record, definition, defaultLimits) {
  const base = record.origin === 'builtin'
    ? definition?.defaults
    : record.custom
  if (base === undefined) throw new SchemaError('invalid_record', `task ${record.id} has no resolvable base configuration`)
  const overrides = withoutLegacyMode(record.overrides)
  // Task limits are an override layer: only an explicitly saved object wins. Otherwise the
  // profile-level defaults (the settings card) are used, then the code defaults.
  const explicitLimits = record.origin === 'builtin' ? overrides?.limits : record.custom?.limits
  const fallbackLimits = defaultLimits ?? base.limits ?? {
    runTimeoutMinutes: DEFAULT_AUTOMATION_SETTINGS.runTimeoutMinutes,
    idleTimeoutMinutes: DEFAULT_AUTOMATION_SETTINGS.idleTimeoutMinutes,
    maxSteps: DEFAULT_AUTOMATION_SETTINGS.maxSteps,
    maxToolCalls: DEFAULT_AUTOMATION_SETTINGS.maxToolCalls,
  }
  const merged = {
    ...withoutLegacyMode(base),
    ...(overrides ?? {}),
    state: record.state,
    limits: explicitLimits ?? fallbackLimits,
  }
  const cleanOverrides = overrides === undefined || Object.keys(overrides).length === 0 ? undefined : overrides
  const task = {
    id: record.id,
    schemaVersion: 1,
    definitionVersion: record.definitionVersion,
    origin: record.origin,
    ...(record.sourceBuiltinId === undefined ? {} : { sourceBuiltinId: record.sourceBuiltinId }),
    profileKey: record.profileKey,
    profileName: record.profileName,
    ...merged,
    ...(cleanOverrides === undefined ? {} : { overrides: cleanOverrides }),
    scheduleAnchorAt: record.scheduleAnchorAt,
    ...(record.lastHandledOccurrenceKey === undefined ? {} : { lastHandledOccurrenceKey: record.lastHandledOccurrenceKey }),
    ...(record.lastScheduledFor === undefined ? {} : { lastScheduledFor: record.lastScheduledFor }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
  return parseStrict(AutomationTaskSchema, task, 'automation task')
}
