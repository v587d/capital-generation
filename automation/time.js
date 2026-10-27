/**
 * Occurrence math for daily/weekly/monthly wall-clock triggers. Instants are the only stored
 * form; local dates never become the schedule identity. Nonexistent DST wall times are skipped
 * (the day has no such minute) and ambiguous ones resolve to the first occurrence.
 */
import { createHash } from 'node:crypto'

const formatterCache = new Map()

function formatterFor(timeZone) {
  let formatter = formatterCache.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

/** @returns {{year:number,month:number,day:number,hour:number,minute:number,second:number,date:string}} */
export function localPartsAt(instantMs, timeZone) {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs))
  const read = (type) => Number(parts.find((part) => part.type === type)?.value)
  const year = read('year')
  const month = read('month')
  const day = read('day')
  return {
    year,
    month,
    day,
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
    date: dateString(year, month, day),
  }
}

export function dateString(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseDateString(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`invalid date string: ${value}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

export function weekdayOf(date) {
  const parsed = typeof date === 'string' ? parseDateString(date) : date
  const day = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay()
  return day === 0 ? 7 : day
}

export function addDays(date, delta) {
  const parsed = typeof date === 'string' ? parseDateString(date) : date
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + delta))
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
    date: dateString(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
  }
}

function wallAsUtc(date, hour, minute) {
  return Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0, 0)
}

function sameWall(parts, date, hour, minute) {
  return parts.year === date.year
    && parts.month === date.month
    && parts.day === date.day
    && parts.hour === hour
    && parts.minute === minute
}

/**
 * Resolve one wall-clock minute in a zone. The offset probes around the wall minute cover both
 * sides of a transition; the earliest matching instant wins on a fall-back overlap.
 * @returns {number|undefined} epoch ms, or undefined when the local minute does not exist.
 */
export function zonedWallToInstant(date, hour, minute, timeZone) {
  const parsed = typeof date === 'string' ? parseDateString(date) : date
  const wall = wallAsUtc(parsed, hour, minute)
  const offsets = new Set()
  for (const probe of [wall - 86_400_000, wall, wall + 86_400_000]) {
    const parts = localPartsAt(probe, timeZone)
    offsets.add(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - probe)
  }
  // One refinement pass: a probe may itself sit on the other side of a transition.
  for (const offset of [...offsets]) {
    const parts = localPartsAt(wall - offset, timeZone)
    offsets.add(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - (wall - offset))
  }
  let best
  for (const offset of offsets) {
    const candidate = wall - offset
    if (!sameWall(localPartsAt(candidate, timeZone), parsed, hour, minute)) continue
    if (best === undefined || candidate < best) best = candidate
  }
  return best
}

export function parseClock(time) {
  const [hour, minute] = time.split(':').map(Number)
  return { hour, minute }
}

function matchesCadence(trigger, date) {
  if (trigger.cadence === 'daily') return true
  if (trigger.cadence === 'weekly') return trigger.weekdays.includes(weekdayOf(date))
  const parsed = typeof date === 'string' ? parseDateString(date) : date
  return parsed.day === trigger.dayOfMonth
}

function calendarVerdict(trigger, date, calendar) {
  if (trigger.tradingDaysOnly !== true) return true
  const answer = calendar?.isTradingDay?.(typeof date === 'string' ? date : date.date)
  // Fail closed: absence, a thrown provider, or an out-of-window date never falls back to Mon–Fri.
  return answer === true ? true : answer === false ? false : undefined
}

const DATE_LIMIT = 400

/**
 * @returns {{kind:'occurrence',instant:number,scheduledFor:string,localDate:string,scheduleVersion:string}
 *   | {kind:'calendar_unavailable',localDate:string}}
 */
export function previousOccurrenceAtOrBefore(trigger, atMs, options = {}) {
  const { hour, minute } = parseClock(trigger.time)
  const start = localPartsAt(atMs, trigger.timezone)
  for (let delta = 0; delta <= DATE_LIMIT; delta += 1) {
    const date = addDays(start.date, -delta)
    if (!matchesCadence(trigger, date)) continue
    const verdict = calendarVerdict(trigger, date, options.calendar)
    // The newest matching date decides: an unknown trading day fails closed instead of
    // silently running the previous trading day's occurrence late.
    if (verdict === undefined) return { kind: 'calendar_unavailable', localDate: date.date ?? date }
    if (!verdict) continue
    const instant = zonedWallToInstant(date, hour, minute, trigger.timezone)
    if (instant === undefined || instant > atMs) continue
    return occurrenceOf(trigger, instant, date)
  }
  return { kind: 'none' }
}

/** @returns same union as {@link previousOccurrenceAtOrBefore} */
export function nextOccurrence(trigger, afterMs, options = {}) {
  const { hour, minute } = parseClock(trigger.time)
  const start = localPartsAt(afterMs, trigger.timezone)
  for (let delta = 0; delta <= DATE_LIMIT; delta += 1) {
    const date = addDays(start.date, delta)
    if (!matchesCadence(trigger, date)) continue
    const verdict = calendarVerdict(trigger, date, options.calendar)
    if (verdict === undefined) return { kind: 'calendar_unavailable', localDate: date.date ?? date }
    if (!verdict) continue
    const instant = zonedWallToInstant(date, hour, minute, trigger.timezone)
    if (instant === undefined || instant <= afterMs) continue
    return occurrenceOf(trigger, instant, date)
  }
  return { kind: 'none' }
}

function occurrenceOf(trigger, instant, localDate) {
  return {
    kind: 'occurrence',
    instant,
    scheduledFor: new Date(instant).toISOString(),
    localDate: localDate.date ?? localDate,
    scheduleVersion: scheduleVersionOf(trigger),
  }
}

export function canonicalTrigger(trigger) {
  return JSON.stringify({
    kind: trigger.kind,
    cadence: trigger.cadence,
    time: trigger.time,
    timezone: trigger.timezone,
    weekdays: trigger.weekdays === undefined ? null : [...trigger.weekdays].sort((a, b) => a - b),
    dayOfMonth: trigger.dayOfMonth ?? null,
    tradingDaysOnly: trigger.tradingDaysOnly === true,
  })
}

/** Stable across process restarts and object-key order; a trigger edit changes the version. */
export function scheduleVersionOf(trigger) {
  return createHash('sha256').update(canonicalTrigger(trigger)).digest('hex').slice(0, 16)
}

export function occurrenceKeyOf(profileKey, taskId, scheduleVersion, scheduledFor) {
  return `${profileKey}:${taskId}:${scheduleVersion}:${scheduledFor}`
}

export function manualOccurrenceKeyOf(profileKey, runId) {
  return `${profileKey}:manual:${runId}`
}

/** Human display in the task zone; the stored value remains UTC. */
export function formatInZone(instantIso, timeZone) {
  const instant = Date.parse(instantIso)
  if (!Number.isFinite(instant)) return instantIso
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant))
}
