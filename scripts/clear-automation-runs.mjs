#!/usr/bin/env node
/**
 * Local maintenance helper (not shipped): clear CapGen automation run history.
 *
 * The automation domain is an in-memory authoritative, whole-file JSON unit: a live
 * dsh process republishes its snapshot on every heartbeat, so editing the file while
 * any process is up is overwritten. Stop every dsh process for this DSH_HOME first,
 * or use `--wait` from an external terminal and stop them afterwards.
 *
 * Usage:
 *   node scripts/clear-automation-runs.mjs                 # refuse if dsh is live
 *   node scripts/clear-automation-runs.mjs --wait          # wait up to 10 min, then clear
 *   node scripts/clear-automation-runs.mjs --dry-run       # show what would be removed
 *   node scripts/clear-automation-runs.mjs --force         # skip live checks (will be overwritten)
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const force = args.has('--force')
const wait = args.has('--wait')
const keepNotifications = args.has('--keep-notifications')

const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const storagePath = join(home, 'storages', 'capital_automation.json')
const locksDir = join(home, 'storages', 'capital-automation-locks')
const ports = [3080, 8888]

function fail(message) {
  console.error(`clear-automation-runs: ${message}`)
  process.exit(1)
}

function liveLeases() {
  if (!existsSync(locksDir)) return []
  const live = []
  for (const entry of readdirSync(locksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const root = join(locksDir, entry.name)
    let children = []
    try {
      children = readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory())
    } catch {
      continue
    }
    for (const child of children) {
      try {
        const record = JSON.parse(readFileSync(join(root, child.name, 'owner.json'), 'utf8'))
        if (Number.isFinite(record.expiresAt) && record.expiresAt > Date.now() + 5_000) {
          live.push({ profileKey: record.profileKey, ownerId: record.ownerId, expiresAt: record.expiresAt })
        }
      } catch {
        // A half-written lease is not proof of a live scheduler.
      }
    }
  }
  return live
}

async function livePorts() {
  const live = []
  for (const port of ports) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) })
      live.push(port)
    } catch {
      // Connection refused/timeout means the GUI is down.
    }
  }
  return live
}

async function blockers() {
  const leases = liveLeases()
  const openPorts = await livePorts()
  return { leases, openPorts }
}

async function waitForQuiet(timeoutMs = 10 * 60_000) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const current = await blockers()
    if (current.leases.length === 0 && current.openPorts.length === 0) return
    if (Date.now() > deadline) {
      fail(`等待超时：${JSON.stringify(current)} 仍存活；先停止 dsh 再运行。`)
    }
    console.error(`等待 dsh 退出… 活跃 lease=${current.leases.length} 端口=${current.openPorts.join(',') || '-'}`)
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
}

if (!existsSync(storagePath)) fail(`找不到存储文件：${storagePath}`)

if (!force) {
  if (wait) await waitForQuiet()
  const current = await blockers()
  if (current.leases.length > 0 || current.openPorts.length > 0) {
    fail(`dsh 仍在运行（端口 ${current.openPorts.join(',') || '-'}，活跃 lease ${current.leases.length} 个）。`
      + '先停掉所有 dsh 实例，或用 --wait 在外部终端等待，或 --force 强制（会被内存快照覆盖）。')
  }
}

const raw = readFileSync(storagePath, 'utf8')
let document
try {
  document = JSON.parse(raw)
} catch (error) {
  fail(`存储文件不是合法 JSON，拒绝覆盖：${String(error)}`)
}
if (document === null || typeof document !== 'object' || typeof document.tables !== 'object' || document.tables === null) {
  fail('存储文件缺少 tables，拒绝覆盖。')
}

const tables = document.tables
const counts = {
  runs: Object.keys(tables.runs ?? {}).length,
  attempts: Object.keys(tables.attempts ?? {}).length,
  notifications: keepNotifications ? 0 : Object.keys(tables.notifications ?? {}).length,
}

if (dryRun) {
  console.log(`dry-run: 将删除 runs=${counts.runs} attempts=${counts.attempts} notifications=${counts.notifications}`)
  console.log(`存储文件：${storagePath}`)
  process.exit(0)
}

const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const backupPath = `${storagePath}.bak-${stamp}`
copyFileSync(storagePath, backupPath)

tables.runs = {}
tables.attempts = {}
if (!keepNotifications) tables.notifications = {}

const tempPath = `${storagePath}.tmp-${process.pid}`
writeFileSync(tempPath, JSON.stringify(document), { mode: 0o600 })
chmodSync(tempPath, 0o600)
renameSync(tempPath, storagePath)

const verify = JSON.parse(readFileSync(storagePath, 'utf8'))
if (Object.keys(verify.tables?.runs ?? {}).length !== 0) fail('写入后验证失败：runs 仍非空。')

console.log(`已清空：runs=${counts.runs} attempts=${counts.attempts} notifications=${counts.notifications}`)
console.log(`保留：tasks、meta、global`)
console.log(`备份：${backupPath}`)
console.log('现在启动 dsh；页面上的运行记录会重新从空表读取。')
