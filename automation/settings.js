/**
 * Settings resolution at call time, in the documented order:
 * code defaults -> deployment row values -> current profile user settings -> task override.
 * The task override is applied by the task record, not here.
 */
import { readCapitalEntry } from '../lib/capital-settings.js'
import {
  DEFAULT_AUTOMATION_SETTINGS,
  MAX_IDLE_TIMEOUT_MINUTES,
  MAX_MAX_STEPS,
  MAX_MAX_TOOL_CALLS,
  MAX_RUN_TIMEOUT_MINUTES,
  MAX_TICK_MS,
  MIN_IDLE_TIMEOUT_MINUTES,
  MIN_MAX_STEPS,
  MIN_MAX_TOOL_CALLS,
  MIN_RUN_TIMEOUT_MINUTES,
  MIN_TICK_MS,
} from './defaults.js'

function intIn(value, minimum, maximum, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(number)))
}

export function normalizeAutomationSettings(value = {}, fallback = DEFAULT_AUTOMATION_SETTINGS) {
  const source = value ?? {}
  return {
    tickMs: intIn(source.tickMs, MIN_TICK_MS, MAX_TICK_MS, fallback.tickMs),
    runTimeoutMinutes: intIn(source.runTimeoutMinutes, MIN_RUN_TIMEOUT_MINUTES, MAX_RUN_TIMEOUT_MINUTES, fallback.runTimeoutMinutes),
    idleTimeoutMinutes: intIn(source.idleTimeoutMinutes, MIN_IDLE_TIMEOUT_MINUTES, MAX_IDLE_TIMEOUT_MINUTES, fallback.idleTimeoutMinutes),
    maxSteps: intIn(source.maxSteps, MIN_MAX_STEPS, MAX_MAX_STEPS, fallback.maxSteps),
    maxToolCalls: intIn(source.maxToolCalls, MIN_MAX_TOOL_CALLS, MAX_MAX_TOOL_CALLS, fallback.maxToolCalls),
    inAppNotifications: source.inAppNotifications === undefined ? fallback.inAppNotifications : source.inAppNotifications !== false,
  }
}

export function resolveAutomationSettings(ctx, deployment = {}) {
  let user
  try {
    user = readCapitalEntry(ctx).value?.automation
  } catch {
    user = undefined
  }
  const deployed = normalizeAutomationSettings(deployment)
  return normalizeAutomationSettings(user, deployed)
}
