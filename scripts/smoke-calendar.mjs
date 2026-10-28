#!/usr/bin/env node
/**
 * Live check for the keyless SZSE calendar. Not part of `npm test`: it touches the network
 * and exists to verify the upstream shape/coverage before a release.
 */
import { createCalendarSource } from '../automation/calendar-source.js'

const calendar = createCalendarSource({ logger: console })
try {
  await calendar.refresh({ force: true })
  const status = calendar.status()
  console.log(JSON.stringify(status, null, 2))
  for (const date of ['2026-10-01', '2026-10-28', '2027-01-04']) {
    console.log(`${date} trading=${String(calendar.isTradingDay(date))}`)
  }
  if (status.available !== true) {
    console.error('calendar: 今天不可判定，检查上游或内置表覆盖')
    process.exitCode = 1
  }
} finally {
  calendar.dispose()
}
