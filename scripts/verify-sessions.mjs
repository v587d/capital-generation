#!/usr/bin/env node
/**
 * Session-log loadability check (run before release and after changing the delivery path).
 * A non-first-party event type makes the reader fail closed and the whole session unopenable, with
 * no warning at write time. Opens every session via the installed jsonl backend and checks it cold
 * loads and contains no event type outside KNOWN_SESSION_EVENT_TYPES unless marked ignorable.
 * Sessions written before the last delivered session are known legacy, not new regressions.
 * Exit: 0 pass, 1 new regression, 2 no dsh found (skip, don't fake a failure).
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { locateDshPackage } from './lib/run-tool.mjs'
import { findSessionRecords } from './lib/session-files.mjs'
import { readSessionEvents } from './lib/session-events.mjs'

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const STRICT = process.argv.includes('--strict')

const DSH_DIR = locateDshPackage()
if (!DSH_DIR) {
  console.error('verify-sessions: 找不到已安装的 dsh（设置 DSH_PACKAGE_DIR 可启用），跳过。')
  process.exit(2)
}

const NESTED = join(DSH_DIR, 'node_modules', '@deepseek-ai')
// homedir(), not process.env.HOME: on Windows HOME is unset, `join('', '.dsh')` gives a relative
// path, the directory is missing and 0 sessions would be reported as a pass.
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const sessionsRoot = argValue('--dir', join(dshHome, 'sessions'))
const since = Date.parse(argValue('--since', (() => {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString()
})()))

const require = createRequire(join(NESTED, 'dsh-session-persistence-jsonl/package.json'))
const cordis = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
const Backend = (await import(pathToFileURL(join(NESTED, 'dsh-session-persistence-jsonl/lib/index.js')).href)).default

const sessionSrc = readFileSync(join(NESTED, 'dsh-session/lib/index.js'), 'utf8')
const KNOWN = new Set(
  sessionSrc.match(/const KNOWN_SESSION_EVENT_TYPES = new Set\(\[([\s\S]*?)\]\)/)[1]
    .match(/"[^"]+"/g).map((token) => token.slice(1, -1)),
)

// Version-agnostic: pick the newest session.v<N> (see scripts/lib/session-files.mjs).
const records = findSessionRecords(sessionsRoot, since)
if (records.length === 0) {
  // Zero sessions is not a pass: a hardcoded v3 once scanned 0 on a v4 host and still printed OK.
  console.log(`verify-sessions: ${sessionsRoot} 下自 ${new Date(since).toISOString()} 没有读到任何会话 ⇒ 闸门**没有核对任何东西**（不是通过）。`)
  console.log('  先确认宿主写的是哪种文件名（session.v<N>.jsonl[.zstd]），或用 --dir 指一个确有会话的 store、--since 放宽时间窗。')
  process.exit(2)
}

// Decode first to find the write watermark: the last session containing deliverables/presented.
const decoded = records.map((record) => ({ ...record, events: readSessionEvents(record.file) }))
const watermark = decoded
  .filter((record) => record.events.some((event) => event.type === 'deliverables/presented'))
  .reduce((max, record) => Math.max(max, record.mtime), 0)

const backendCtx = new cordis.Context()
const backend = new Backend(backendCtx, { root: sessionsRoot, compression: 'zstd' })

const legacy = []
const regressions = []
let deliverableSessions = 0

for (const record of decoded) {
  const { id, events, mtime } = record
  const unknown = [...new Set(events
    .filter((event) => event.type !== 'session' && typeof event.type === 'string' && !KNOWN.has(event.type) && event.ignorable !== true)
    .map((event) => event.type))]
  const delivered = events.filter((event) => event.type === 'deliverables/presented')
  if (delivered.length > 0) {
    deliverableSessions += 1
    console.log(`★ ${id} 交付事件 ${delivered.length} 条，turns=[${delivered.map((event) => event.data?.turn).join(',')}]`)
  }

  let loadError
  try {
    const handle = await backend.open(id, 'read')
    await handle.read(0, Number.MAX_SAFE_INTEGER)
    await handle.close()
  } catch (error) {
    loadError = `${error.constructor.name}: ${String(error.message).slice(0, 140)}`
  }
  if (unknown.length === 0 && loadError === undefined) continue

  // Before the watermark = legacy; after it (or with --strict) = new regression.
  const isLegacy = !STRICT && watermark > 0 && mtime < watermark
  const target = isLegacy ? legacy : regressions
  target.push({ id, unknown, loadError })
}

if (legacy.length > 0) {
  console.log(`\n【历史遗留】${legacy.length} 份（修复前写入，已知问题，不影响发布判定）`)
  for (const item of legacy) {
    console.log(`  ⚠ ${item.id}${item.unknown.length ? ` 闭集外类型: ${item.unknown.join(',')}` : ''}${item.loadError ? ` 冷加载失败: ${item.loadError}` : ''}`)
  }
}

console.log(`\n检查 ${decoded.length} 份会话（自 ${new Date(since).toISOString()}）｜含交付事件 ${deliverableSessions} 份｜历史遗留 ${legacy.length} 份｜新回归 ${regressions.length} 份`)
if (regressions.length === 0) {
  console.log('✅ 水位线之后的会话全部可冷加载，且无闭集外事件类型')
  process.exit(0)
}
console.log('❌ 发现新回归（修复后的代码又写出了不可加载的日志）：')
for (const item of regressions) {
  console.log(`  ❌ ${item.id}${item.unknown.length ? ` 闭集外类型: ${item.unknown.join(',')}` : ''}${item.loadError ? ` 冷加载失败: ${item.loadError}` : ''}`)
}
process.exit(1)
