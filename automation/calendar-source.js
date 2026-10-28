/**
 * Scheduler calendar backed by the exchange's published closure calendar (SSE/SZSE share it),
 * fetched from SZSE's keyless month JSON. Fetched months win over the bundled table; an
 * unpublished month falls back to it, and an uncovered date stays `undefined` (fail-closed).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createTradingCalendar } from './calendar.js'
import { sanitizeMessage } from './redact.js'

const SZSE_MONTH_URL = 'https://www.szse.cn/api/report/exchange/onepersistenthour/monthList'
const CACHE_VERSION = 1
const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_REFRESH_MS = 24 * 60 * 60_000
const FAILURE_RETRY_MS = 30 * 60_000
const UNPUBLISHED_RETRY_MS = 6 * 60 * 60_000
const INITIAL_WAIT_MS = 5_000
const DEFAULT_HORIZON_DAYS = 400
const BACKFILL_DAYS = 62
const CONCURRENCY = 4
const MAX_BODY_CHARS = 256 * 1024
const OFFSET_SHANGHAI_MS = 8 * 60 * 60_000
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const USER_AGENT = '@v587d/capital-generation'

function shanghaiDate(instant) {
  return new Date(instant + OFFSET_SHANGHAI_MS).toISOString().slice(0, 10)
}

function monthOf(date) {
  return date.slice(0, 7)
}

function daysInMonth(month) {
  const [year, value] = month.split('-').map(Number)
  return new Date(Date.UTC(year, value, 0)).getUTCDate()
}

function addDays(date, delta) {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + delta))
  return next.toISOString().slice(0, 10)
}

function monthRange(from, to) {
  const months = []
  let [year, month] = from.split('-').map(Number)
  const [lastYear, lastMonth] = to.split('-').map(Number)
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return months
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/** @returns {{kind:'ok',days:Map<string,boolean>}|{kind:'unpublished'}|{kind:'invalid',reason:string}} */
function parseMonth(month, body) {
  if (body === null || typeof body !== 'object' || !Array.isArray(body.data)) {
    return { kind: 'invalid', reason: 'response shape' }
  }
  const rows = body.data
  if (rows.length === 0) return { kind: 'unpublished' }
  if (rows.length !== daysInMonth(month)) return { kind: 'invalid', reason: `expected ${daysInMonth(month)} rows, got ${rows.length}` }
  const days = new Map()
  let trading = 0
  for (const row of rows) {
    const date = row?.jyrq
    if (typeof date !== 'string' || !DATE_PATTERN.test(date) || monthOf(date) !== month) {
      return { kind: 'invalid', reason: 'row date does not match month' }
    }
    if (days.has(date)) return { kind: 'invalid', reason: 'duplicate row' }
    const flag = row?.jybz
    if (flag !== '0' && flag !== '1') return { kind: 'invalid', reason: 'row flag is not 0/1' }
    days.set(date, flag === '1')
    if (flag === '1') trading += 1
  }
  if (trading === 0) return { kind: 'invalid', reason: 'no trading day in month' }
  return { kind: 'ok', days }
}

async function fetchMonth(month, options) {
  const { fetchImpl, timeoutMs, signal } = options
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal !== undefined && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, timeout])
    : timeout
  const response = await fetchImpl(`${SZSE_MONTH_URL}?month=${encodeURIComponent(month)}`, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    signal: combined,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const type = response.headers?.get?.('content-type') ?? ''
  if (!type.includes('json')) throw new Error(`unexpected content-type ${type || '(none)'}`)
  const text = await response.text()
  if (text.length > MAX_BODY_CHARS) throw new Error('response too large')
  return parseMonth(month, JSON.parse(text))
}

async function mapLimit(items, limit, work) {
  const results = new Array(items.length)
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index
      index += 1
      results[current] = await work(items[current])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 * @param {string} [options.cacheFile]
 * @param {string} [options.cacheDir]
 * @param {ReturnType<typeof createTradingCalendar>} [options.fallback]
 * @param {{warn?: Function, info?: Function}} [options.logger]
 */
export function createCalendarSource(options = {}) {
  const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args))
  const now = options.now ?? (() => Date.now())
  const fallback = options.fallback ?? createTradingCalendar()
  const logger = options.logger
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const refreshMs = options.refreshMs ?? DEFAULT_REFRESH_MS
  const horizonDays = options.horizonDays ?? DEFAULT_HORIZON_DAYS
  const cacheFile = options.cacheFile ?? (options.cacheDir === undefined ? undefined : join(options.cacheDir, 'szse.json'))

  /** @type {Map<string, {days: Map<string, boolean>, fetchedAt: number}>} */
  const remote = new Map()
  let loaded = false
  let loading
  let refreshing
  let lastAttemptAt = 0
  let lastError = null
  let disposed = false
  let controller

  function targetMonths() {
    const today = shanghaiDate(now())
    return monthRange(monthOf(addDays(today, -BACKFILL_DAYS)), monthOf(addDays(today, horizonDays)))
  }

  function isTradingDay(date) {
    if (typeof date !== 'string' || !DATE_PATTERN.test(date)) return undefined
    const entry = remote.get(monthOf(date))
    if (entry !== undefined && entry.days.size > 0) {
      if (entry.days.has(date)) return entry.days.get(date) === true
    }
    return fallback.isTradingDay(date)
  }

  function fetchedAtOf() {
    let latest
    for (const entry of remote.values()) {
      if (latest === undefined || entry.fetchedAt > latest) latest = entry.fetchedAt
    }
    return latest
  }

  function status(at = new Date(now())) {
    const instant = at instanceof Date ? at.getTime() : Number(at)
    const today = shanghaiDate(Number.isFinite(instant) ? instant : now())
    const todayKnown = isTradingDay(today) !== undefined
    let through = null
    let firstUnknown = null
    let cursor = today
    for (let index = 0; index < 500; index += 1) {
      if (isTradingDay(cursor) === undefined) {
        firstUnknown = cursor
        break
      }
      through = cursor
      cursor = addDays(cursor, 1)
    }
    const entry = remote.get(monthOf(today))
    const source = entry !== undefined && entry.days.has(today) ? 'szse' : todayKnown ? 'bundled' : 'none'
    const fetchedAt = fetchedAtOf()
    const coverageDays = through === null
      ? 0
      : Math.max(0, Math.round((Date.parse(`${through}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000))
    return {
      available: todayKnown,
      source,
      through,
      firstUnknown,
      coverageDays,
      fetchedAt: fetchedAt === undefined ? null : new Date(fetchedAt).toISOString(),
      stale: fetchedAt !== undefined && now() - fetchedAt > refreshMs * 2,
      refreshing: refreshing !== undefined,
      lastError: lastError === null ? null : lastError,
    }
  }

  async function load() {
    if (loading !== undefined) return loading
    if (loaded) return
    loaded = true
    if (cacheFile === undefined) return
    loading = (async () => {
      let text
      try {
        text = await readFile(cacheFile, 'utf8')
      } catch (error) {
        if (error?.code !== 'ENOENT') logger?.warn?.(`capital-automation: 交易日历缓存读取失败：${sanitizeMessage(String(error))}`)
        return
      }
      let data
      try {
        data = JSON.parse(text)
      } catch {
        return
      }
      if (data?.version !== CACHE_VERSION || data.months === null || typeof data.months !== 'object') return
      for (const [month, entry] of Object.entries(data.months)) {
        if (!MONTH_PATTERN.test(month) || entry === null || typeof entry !== 'object') continue
        const fetchedAt = Date.parse(entry.fetchedAt)
        if (!Number.isFinite(fetchedAt)) continue
        const days = new Map()
        const rows = entry.days !== null && typeof entry.days === 'object' ? entry.days : {}
        for (const [date, flag] of Object.entries(rows)) {
          if (!DATE_PATTERN.test(date) || monthOf(date) !== month) continue
          if (flag !== 0 && flag !== 1) continue
          days.set(date, flag === 1)
        }
        if (days.size !== 0 && days.size !== daysInMonth(month)) continue
        remote.set(month, { days, fetchedAt })
      }
    })().finally(() => { loading = undefined })
    return loading
  }

  async function writeCache() {
    if (cacheFile === undefined || disposed) return
    const months = {}
    for (const [month, entry] of remote) {
      months[month] = {
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
        days: Object.fromEntries([...entry.days].map(([date, trading]) => [date, trading ? 1 : 0])),
      }
    }
    const temporary = `${cacheFile}.${process.pid}.tmp`
    try {
      await mkdir(dirname(cacheFile), { recursive: true })
      await writeFile(temporary, JSON.stringify({ version: CACHE_VERSION, savedAt: new Date(now()).toISOString(), months }), 'utf8')
      await rename(temporary, cacheFile)
    } catch (error) {
      logger?.warn?.(`capital-automation: 交易日历缓存写入失败：${sanitizeMessage(String(error))}`)
    }
  }

  async function refresh({ force = false } = {}) {
    if (disposed) return status()
    if (refreshing !== undefined) return refreshing
    refreshing = (async () => {
      await load()
      if (disposed) return status()
      const stamp = now()
      const pending = targetMonths().filter((month) => {
        const entry = remote.get(month)
        if (force) return true
        if (entry === undefined) return true
        const age = stamp - entry.fetchedAt
        return entry.days.size === 0 ? age >= UNPUBLISHED_RETRY_MS : age >= refreshMs
      })
      let changed = false
      let failures = 0
      if (pending.length > 0) {
        controller = new AbortController()
        const signal = controller.signal
        const results = await mapLimit(pending, CONCURRENCY, async (month) => {
          try {
            return { month, parsed: await fetchMonth(month, { fetchImpl, timeoutMs, signal }) }
          } catch (error) {
            return { month, error }
          }
        })
        if (disposed) return status()
        for (const result of results) {
          if (result.error !== undefined) {
            failures += 1
            lastError = `${result.month}: ${sanitizeMessage(String(result.error?.message ?? result.error))}`
            continue
          }
          if (result.parsed.kind === 'ok') {
            remote.set(result.month, { days: result.parsed.days, fetchedAt: stamp })
            changed = true
          } else if (result.parsed.kind === 'unpublished') {
            remote.set(result.month, { days: new Map(), fetchedAt: stamp })
            changed = true
          } else {
            failures += 1
            lastError = `${result.month}: ${result.parsed.reason}`
          }
        }
        if (failures === 0) lastError = null
      } else {
        lastError = null
      }
      lastAttemptAt = now()
      if (changed) {
        await writeCache()
        const snapshot = status()
        logger?.info?.(`capital-automation: 交易日历已刷新（${snapshot.source}，覆盖至 ${snapshot.through ?? '未知'}）`)
      }
      return status()
    })().finally(() => { refreshing = undefined })
    return refreshing
  }

  function refreshIfStale() {
    if (disposed || refreshing !== undefined) return
    const stamp = now()
    const interval = lastError === null ? refreshMs : FAILURE_RETRY_MS
    const due = lastAttemptAt === 0 || stamp - lastAttemptAt >= interval
    if (!due) {
      const retry = targetMonths().some((month) => {
        const entry = remote.get(month)
        return entry !== undefined && entry.days.size === 0 && stamp - entry.fetchedAt >= UNPUBLISHED_RETRY_MS
      })
      if (!retry) return
    }
    void refresh().catch(() => {})
  }

  async function ready() {
    await load()
    const today = shanghaiDate(now())
    if (isTradingDay(today) !== undefined) {
      void refresh().catch(() => {})
      return
    }
    await Promise.race([refresh().catch(() => {}), delay(INITIAL_WAIT_MS)])
  }

  function pendingRefresh() {
    return refreshing !== undefined
  }

  function dispose() {
    disposed = true
    controller?.abort()
  }

  return { isTradingDay, status, load, ready, refresh, refreshIfStale, pendingRefresh, dispose }
}
