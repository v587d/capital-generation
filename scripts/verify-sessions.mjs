#!/usr/bin/env node
/**
 * 会话日志**可加载性**复核（发布前 / 改交付通道后必跑）。
 *
 * 为什么必须有它：2026-09-18 的事故里，非 first-party 的会话事件类型会被读取侧
 * `validateStoredEvents()` fail-closed 拒绝，**整份会话打不开**——而且写入时完全静默，
 * 单测也覆盖不到（单测只看我们自己的 payload，不看真实日志能否被真实后端冷加载）。
 * 这里用已安装的 dsh 的 jsonl 后端逐份 open+read，核对两件事：
 *   ① 每份会话都能冷加载（原始事故的判据）；
 *   ② 日志里没有 `KNOWN_SESSION_EVENT_TYPES` 闭集之外、且未标 ignorable 的事件类型。
 *
 * **历史遗留 vs 新回归**：修复前写入的会话（含 `capital/chart-rendered`）是已知遗留，
 * 不该让这个闸门永远红。判据用"最后一份成功登记交付的会话"作为修复落地的水位线：
 * 水位线**之后**的会话出问题才算失败（那意味着新代码又写坏了日志）。
 *
 * 用法：
 *   node scripts/verify-sessions.mjs [--since <ISO>] [--dir <sessions 根>] [--strict]
 *   npm run verify:sessions
 * 退出码：0 通过；1 发现新回归；2 找不到 dsh（跳过，不在无 dsh 的环境里造假失败）。
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { dirname, join } from 'node:path'

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const STRICT = process.argv.includes('--strict')

/** 在 PATH 里找 dsh 可执行文件并回溯到包根（与 check-dsh-compat.mjs 同一套逻辑）。 */
function locateDshPackage() {
  if (process.env.DSH_PACKAGE_DIR) return process.env.DSH_PACKAGE_DIR
  const isWin = process.platform === 'win32'
  for (const dir of (process.env.PATH ?? '').split(isWin ? ';' : ':')) {
    if (!dir) continue
    for (const name of isWin ? ['dsh.cmd', 'dsh'] : ['dsh']) {
      const candidate = join(dir, name)
      if (!existsSync(candidate)) continue
      let current = dirname(realpathSync(candidate))
      for (let depth = 0; depth < 4; depth += 1) {
        const manifest = join(current, 'package.json')
        if (existsSync(manifest)) {
          try {
            if (JSON.parse(readFileSync(manifest, 'utf8')).name === '@deepseek-ai/dsh') return current
          } catch { /* 继续向上找 */ }
        }
        current = dirname(current)
      }
    }
  }
  return undefined
}

const DSH_DIR = locateDshPackage()
if (!DSH_DIR) {
  console.error('verify-sessions: 找不到已安装的 dsh（设置 DSH_PACKAGE_DIR 可启用），跳过。')
  process.exit(2)
}

const NESTED = join(DSH_DIR, 'node_modules', '@deepseek-ai')
const dshHome = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
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

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
/** 多帧 zstd：逐帧解（Node 的 zstd 解码只吃第一帧）。 */
function decode(file) {
  const buffer = readFileSync(file)
  const offsets = []
  let cursor = 0
  while ((cursor = buffer.indexOf(MAGIC, cursor)) >= 0) { offsets.push(cursor); cursor += MAGIC.length }
  offsets.push(buffer.length)
  let text = ''
  for (let i = 0; i < offsets.length - 1; i += 1) {
    try { text += zstdDecompressSync(buffer.subarray(offsets[i], offsets[i + 1])).toString('utf8') } catch { /* 巧合 magic */ }
  }
  const events = []
  for (const line of text.split('\n')) { if (!line) continue; try { events.push(JSON.parse(line)) } catch { /* 截断残行 */ } }
  return events
}

// 收集候选会话
const records = []
if (existsSync(sessionsRoot)) {
  for (const workspace of readdirSync(sessionsRoot)) {
    const workspacePath = join(sessionsRoot, workspace)
    try { if (!statSync(workspacePath).isDirectory()) continue } catch { continue }
    for (const id of readdirSync(workspacePath)) {
      const file = join(workspacePath, id, 'session.v3.jsonl.zstd')
      let stat
      try { stat = statSync(file) } catch { continue }
      if (stat.size === 0 || stat.mtimeMs < since) continue
      records.push({ id, mtime: stat.mtimeMs, file })
    }
  }
}

// 先解一遍，找出"修复水位线"：最后一份含 deliverables/presented 的会话写入时间
const decoded = records.map((record) => ({ ...record, events: decode(record.file) }))
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

  // 水位线之前的算历史遗留；之后（或 --strict）算新回归
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
