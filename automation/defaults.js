/**
 * Automation deployment defaults. Read once at the call site (`settings.js`), never frozen into
 * the scheduler at mount time: the settings card may change between ticks.
 */
export const DEFAULT_TICK_MS = 60_000
export const MIN_TICK_MS = 30_000
export const MAX_TICK_MS = 3_600_000

export const DEFAULT_RUN_TIMEOUT_MINUTES = 30
export const MIN_RUN_TIMEOUT_MINUTES = 5
export const MAX_RUN_TIMEOUT_MINUTES = 120

export const DEFAULT_IDLE_TIMEOUT_MINUTES = 5
export const MIN_IDLE_TIMEOUT_MINUTES = 1
export const MAX_IDLE_TIMEOUT_MINUTES = 30

// Real multi-agent research runs use hundreds of tool calls (subagent calls included). These
// limits bound runaway loops, not normal work; wall-clock and idle remain the primary guards.
export const DEFAULT_MAX_STEPS = 300
export const MIN_MAX_STEPS = 10
export const MAX_MAX_STEPS = 2_000

export const DEFAULT_MAX_TOOL_CALLS = 1_200
export const MIN_MAX_TOOL_CALLS = 10
export const MAX_MAX_TOOL_CALLS = 6_000

export const DEFAULT_OWNER_LEASE_MS = 90_000
export const MIN_OWNER_LEASE_MS = 30_000
export const MAX_OWNER_LEASE_MS = 600_000

export const DEFAULT_CATCH_UP_MS = 10 * 60_000
export const CANCEL_GRACE_MS = 15_000
export const QUIET_SETTLE_MS = 750

export const MAX_RUNS_PER_TASK = 200
export const MAX_RUNS_PER_PROFILE = 2_000
export const MAX_NOTIFICATIONS_PER_PROFILE = 200
export const MAX_ERRORS_PER_RUN = 20

export const MAX_TITLE_CHARS = 120
export const MAX_DESCRIPTION_CHARS = 500
export const MAX_INSTRUCTION_CHARS = 12_000
export const MAX_ERROR_MESSAGE_CHARS = 500
export const MAX_REQUEST_BODY_BYTES = 64 * 1024

export const DEFAULT_AUTOMATION_SETTINGS = {
  tickMs: DEFAULT_TICK_MS,
  runTimeoutMinutes: DEFAULT_RUN_TIMEOUT_MINUTES,
  idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
  maxSteps: DEFAULT_MAX_STEPS,
  maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
  inAppNotifications: true,
}

export const RUN_STATUSES = [
  'queued',
  'starting',
  'running',
  'succeeded',
  'failed',
  'canceled',
  'timed_out',
  'blocked_requires_user',
  'unknown_after_restart',
  'skipped_overlap',
  'skipped_calendar_unavailable',
  'missed',
]

export const ACTIVE_RUN_STATUSES = ['queued', 'starting', 'running']
export const TERMINAL_RUN_STATUSES = RUN_STATUSES.filter((status) => !ACTIVE_RUN_STATUSES.includes(status))

// A finished turn can be settled from its durable checkpoint; `unknown_after_restart`
// stays the fallback for runs with no provable turn boundary.
export const SETTLED_RUN_STATUSES = ['succeeded', 'failed', 'canceled', 'timed_out', 'blocked_requires_user']
