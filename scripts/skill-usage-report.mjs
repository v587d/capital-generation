#!/usr/bin/env node
/**
 * Read-only selected-skill usage report. Counts successful `skill` loads from
 * durable session logs (native tool calls, PTC dispatches and `/name`
 * injections), groups them by root session, and checks whether the root's last
 * answer names every method the tree actually loaded. No model self-report is
 * trusted. Exit 0 by default; `--strict` exits 1 when a final answer misses a
 * loaded name; exit 2 when the store has no matching session.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import { findSessionRecords, findWorkspaceSessionRecords, workspaceSlug } from './lib/session-files.mjs'
import { readSessionEvents } from './lib/session-events.mjs'
import { buildUsageTrees, summarizeSession } from './lib/skill-usage.mjs'
import { SELECTED_SKILL_CATALOG } from '../selected-skills/catalog.js'
import { SELECTED_SKILL_ROLES } from '../selected-skills/routing.js'

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const SESSIONS_ROOT = argValue('--dir', join(DSH_HOME, 'sessions'))
const CWD = argValue('--cwd', process.cwd())
const ALL_WORKSPACES = process.argv.includes('--all-workspaces')
const AS_JSON = process.argv.includes('--json')
const CATALOG = process.argv.includes('--catalog')
const STRICT = process.argv.includes('--strict')
const LATEST = Number(argValue('--latest', '5'))
// Users copy `session-…` from logs; the stored id is compared bare.
const SESSION_PREFIX = argValue('--session', undefined)?.replace(/^session-/, '')
const SINCE = Date.parse(argValue('--since', '1970-01-01T00:00:00.000Z'))

const CATALOG_NAMES = new Set(SELECTED_SKILL_CATALOG.map(({ name }) => name))
const ROLE_BY_PRESET = {
  'capital-generation': 'main',
  'capital-data-junior': 'data_junior',
  'capital-web-retriever': 'web_retriever',
  'capital-data-analyst': 'data_analyst',
  'capital-data-collector': 'data_collector',
  'capital-visualization-specialist': 'visualization_specialist',
}
const ROLE_LABEL = {
  ...Object.fromEntries(Object.entries(SELECTED_SKILL_ROLES).map(([role, label]) => [role, label.zh])),
  data_analyst: '数据分析（保留）',
  data_collector: '数据采集',
  visualization_specialist: '可视化',
}
const shortId = (id) => String(id ?? '').replace(/^session-/, '').slice(0, 8)
const roleOf = (session) => ROLE_BY_PRESET[session.preset] ?? session.preset ?? session.origin
const roleLabel = (role) => ROLE_LABEL[role] ?? role
const timeOf = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString() : '-')
const catalogCount = (names) => {
  const total = names.length
  const selected = names.filter((name) => CATALOG_NAMES.has(name)).length
  return { total, selected, protocol: total - selected }
}

const scanRoot = ALL_WORKSPACES ? SESSIONS_ROOT : join(SESSIONS_ROOT, workspaceSlug(CWD))
const records = ALL_WORKSPACES
  ? findSessionRecords(SESSIONS_ROOT, Number.isFinite(SINCE) ? SINCE : 0)
  : findWorkspaceSessionRecords(scanRoot, Number.isFinite(SINCE) ? SINCE : 0)
if (records.length === 0) {
  console.error(`skill-usage-report: ${scanRoot} 下没有匹配的会话。`)
  console.error('  用 --dir 指会话 store，或 --all-workspaces；工作目录必须与会话一致。')
  process.exit(2)
}

const sessions = []
for (const record of records) {
  let events
  try {
    events = readSessionEvents(record.file)
  } catch {
    continue
  }
  sessions.push(summarizeSession(record, events, CATALOG_NAMES))
}

let trees = buildUsageTrees(sessions)
if (SESSION_PREFIX !== undefined) {
  trees = trees.filter((tree) => tree.sessions.some((session) => {
    const id = String(session.id ?? '').replace(/^session-/, '')
    return id.startsWith(SESSION_PREFIX) || id.includes(SESSION_PREFIX)
  }))
  if (trees.length === 0) {
    console.error(`skill-usage-report: 找不到会话 ${SESSION_PREFIX}。`)
    process.exit(2)
  }
}
const latest = Number.isFinite(LATEST) && LATEST > 0 ? Math.floor(LATEST) : 5
trees = trees.slice(0, latest)

const totals = new Map()
for (const tree of trees) {
  for (const skill of tree.skills) {
    const row = totals.get(skill.name) ?? { name: skill.name, count: 0, sessions: 0, roles: new Set() }
    row.count += skill.count
    row.sessions += skill.sessions
    for (const role of skill.roles) row.roles.add(role)
    totals.set(skill.name, row)
  }
}

const report = {
  store: scanRoot,
  scannedSessions: sessions.length,
  catalogSize: CATALOG_NAMES.size,
  trees: trees.map((tree) => ({
    rootSession: tree.root.id,
    preset: tree.root.preset,
    updatedAt: timeOf(tree.updatedAt),
    sessions: tree.sessions.map((session) => ({
      session: session.id,
      role: roleOf(session),
      preset: session.preset,
      catalog: catalogCount(session.catalog),
      skills: session.skills,
    })),
    skills: tree.skills,
    finalAnswer: tree.finalAnswer,
  })),
  totals: [...totals.values()]
    .map((row) => ({ name: row.name, count: row.count, sessions: row.sessions, roles: [...row.roles].sort() }))
    .sort((left, right) => left.name.localeCompare(right.name)),
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`skill-usage-report: ${scanRoot}`)
  console.log(`扫描 ${report.scannedSessions} 份会话，catalog ${report.catalogSize} 颗；显示最近 ${trees.length} 棵根会话。`)
  for (const tree of report.trees) {
    console.log(`\n=== ${tree.rootSession}  preset=${tree.preset ?? '-'}  ${tree.updatedAt} ===`)
    for (const session of tree.sessions) {
      const used = session.skills.length === 0
        ? '（未加载精选方法）'
        : session.skills.map((skill) => `\`${skill.name}\`×${skill.count}`).join('、')
      const origin = session.session === tree.rootSession ? '根' : '子'
      console.log(`  ${origin} ${roleLabel(session.role).padEnd(10)} ${shortId(session.session)}  ${used}`)
      if (CATALOG && session.catalog.total > 0) {
        console.log(`     目录：精选 ${session.catalog.selected} / 内置 ${session.catalog.protocol} / 共 ${session.catalog.total}`)
      }
    }
    if (tree.finalAnswer.total === 0) {
      console.log('  最终答复点名：本轮无精选方法。')
    } else if (tree.finalAnswer.missing.length === 0) {
      console.log(`  最终答复点名：${tree.finalAnswer.cited}/${tree.finalAnswer.total} ✅`)
    } else {
      console.log(`  最终答复点名：${tree.finalAnswer.cited}/${tree.finalAnswer.total} ❌ 缺：${tree.finalAnswer.missing.map((name) => `\`${name}\``).join('、')}`)
    }
  }
  console.log(`\n合计（${trees.length} 棵根会话，用到 ${report.totals.length} 颗）：`)
  if (report.totals.length === 0) {
    console.log('  （没有精选 Skill 的实际加载记录）')
  }
  for (const row of report.totals) {
    console.log(`  \`${row.name}\`  ${String(row.count).padStart(3)} 次 · ${row.sessions} 会话 · ${row.roles.map((role) => roleLabel(ROLE_BY_PRESET[role] ?? role)).join(' / ')}`)
  }
}

if (STRICT && report.trees.some((tree) => tree.finalAnswer.missing.length > 0)) process.exit(1)
