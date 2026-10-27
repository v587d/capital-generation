/**
 * Fail-closed A-share trading calendar. The holiday list is an explicit exchange schedule, not a
 * Mon–Fri guess: a date outside the published window returns `undefined`, and the scheduler
 * records `skipped_calendar_unavailable` instead of running.
 *
 * Sources: SSE 2026 market-closure notice (上证公告〔2025〕45号 + the 2026 mid-autumn/national-day
 * notice). Update this table when the exchange publishes the next year; do not infer holidays.
 */
const CN_HOLIDAYS_2026 = new Set([
  // New Year
  '2026-01-01', '2026-01-02', '2026-01-03',
  // Spring Festival
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  // Qingming
  '2026-04-04', '2026-04-05', '2026-04-06',
  // Labour Day
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  // Dragon Boat
  '2026-06-19', '2026-06-20', '2026-06-21',
  // Mid-Autumn
  '2026-09-25', '2026-09-26', '2026-09-27',
  // National Day
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
])

const PUBLISHED = new Map([
  [2026, { holidays: CN_HOLIDAYS_2026, through: '2026-12-31' }],
])


function weekdayOf(date) {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return weekday === 0 ? 7 : weekday
}

export function createTradingCalendar(options = {}) {
  const published = options.published ?? PUBLISHED
  return {
    isTradingDay(date) {
      const year = Number(String(date).slice(0, 4))
      const entry = published.get(year)
      if (entry === undefined) return undefined
      if (weekdayOf(date) >= 6) return false
      return !entry.holidays.has(date)
    },
    /** The first date the table cannot answer; callers show this instead of pretending. */
    status(at = new Date()) {
      const today = at.toISOString().slice(0, 10)
      if (this.isTradingDay(today) === undefined) {
        return { available: false, source: 'CN-A-share-2026', through: null, firstUnknown: today }
      }
      const years = [...published.keys()].sort((a, b) => a - b)
      const last = years.at(-1)
      return {
        available: true,
        source: 'CN-A-share-2026',
        through: `${last}-12-31`,
        firstUnknown: `${last + 1}-01-01`,
      }
    },
  }
}

export const tradingCalendar = createTradingCalendar()
