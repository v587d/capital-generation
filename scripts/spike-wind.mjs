/**
 * Wind structured MCP spike instrument, not a product surface. Capabilities may only be registered
 * after seeing real payloads (key names, parallel arrays, repeatability) — docs/dev/tool-schema.md
 * §10.2 / §10.6.
 * Key goes into the Bearer header only; ⛔ never printed and bodies are never written to disk.
 * Real calls burn credits: serial, one probe per question.
 */
import { parseArgs } from 'node:util'
import { createWindClient } from '../lib/web-retriever/wind-client.js'
import { resolveCredential } from './lib/credentials.mjs'

const ENDPOINTS = {
  stock_data: 'https://mcp.wind.com.cn/vserver_stock_data/mcp/',
  fund_data: 'https://mcp.wind.com.cn/vserver_fund_data/mcp/',
  index_data: 'https://mcp.wind.com.cn/vserver_index_data/mcp/',
  bond_data: 'https://mcp.wind.com.cn/vserver_bond_data/mcp/',
  financial_docs: 'https://mcp.wind.com.cn/vserver_financial_docs/mcp/',
  economic_data: 'https://mcp.wind.com.cn/vserver_economic_data/mcp/',
  analytics_data: 'https://mcp.wind.com.cn/vserver_analytics_data/mcp/',
}

const { values: flags, positionals } = parseArgs({
  options: {
    list: { type: 'boolean' },
    call: { type: 'string' },
    args: { type: 'string' },
    repeat: { type: 'string' },
    auth: { type: 'boolean' },
    full: { type: 'boolean' },
  },
  allowPositionals: true,
})

const apiKey = resolveCredential('WIND_API_KEY')
if (!apiKey) {
  console.error('WIND_API_KEY 未解析到（环境变量或 ~/.dsh/.credentials.yaml 的 refs）')
  process.exit(1)
}

const wanted = flags.auth ? 'auth' : flags.call ? 'call' : 'list'

async function rpc(endpoint, method, params) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed)
  let last
  for (const line of text.split(/\r?\n/)) if (line.startsWith('data: ')) last = line.slice(6)
  return JSON.parse(last)
}

const initializeParams = {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'capital-generation-spike', version: 'spike' },
}

/** Key-name risk flags: data_collector row keys must be ASCII snake_case (§10.6). */
function keyFlags(key) {
  const flags = []
  if (/[^\x20-\x7E]/.test(key)) flags.push(/[\uFF00-\uFFEF]/.test(key) ? '全角' : '非ASCII')
  if (/[:：]/.test(key)) flags.push('冒号')
  if (/\s/.test(key)) flags.push('空格')
  if (/[A-Z]/.test(key) && /[a-z]/.test(key)) flags.push('驼峰/混合大小写')
  return flags
}

function typeTag(value) {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'num'
  if (typeof value === 'string') return value === '' ? '空串' : `串(${value.length})`
  if (typeof value === 'boolean') return 'bool'
  if (Array.isArray(value)) return `数组(${value.length})`
  return '对象'
}

/** Wind tables are `{columns:[{name,type}], rows:[[scalar]]}`: rows are arrays, not objects. */
function dumpTables(value, path = '$', out = []) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const columns = value.columns
    const rows = value.rows
    if (Array.isArray(columns) && Array.isArray(rows) && columns.every((c) => c && typeof c === 'object' && 'name' in c)) {
      const names = columns.map((column) => column.name)
      const widths = new Set([names.length, ...rows.map((row) => (Array.isArray(row) ? row.length : -1))])
      const nulls = rows.map((row) => (Array.isArray(row) ? row.filter((cell) => cell === null || (typeof cell === 'string' && /INVALID/i.test(cell))).length : -1))
      const cellTypes = new Set(rows.flat().map(typeTag))
      out.push(`\n表 ${path}  ${rows.length} 行 × ${names.length} 列  列名宽=[${widths.has(names.length) ? '与行数一致' : `不一致：${[...widths]}`}]  空格/INVALID 每行=${nulls.join(',') || 0}  单元类型=${[...cellTypes].join('/')}`)
      out.push(`  列名: ${names.map((name) => `${name}${keyFlags(name).length ? `⚠️[${keyFlags(name).join('+')}]` : ''}`).join(' | ')}`)
      // An empty table (non-trading day / no data) is a legal success — don't crash the probe.
      if (rows.length === 0) out.push('  （0 行：columns 仍给出，unit 见下）')
      else {
        out.push(`  首行: ${JSON.stringify(rows[0]).slice(0, 260)}`)
        if (rows.length > 1) out.push(`  末行: ${JSON.stringify(rows[rows.length - 1]).slice(0, 260)}`)
      }
      const unit = value.unit
      if (unit && typeof unit === 'object') {
        const entries = Object.entries(unit)
        out.push(`  unit(${entries.length} 项): ${entries.slice(0, 10).map(([key, cell]) => `${JSON.stringify(key)}=${JSON.stringify(cell)}`).join(' ').slice(0, 300)}`)
        out.push(`  unit 键名风险: ${[...new Set(entries.flatMap(([key]) => keyFlags(key)))].join('+') || '无'}`)
      }
    }
    for (const [key, item] of Object.entries(value)) dumpTables(item, `${path}.${key}`, out)
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => dumpTables(item, `${path}[${index}]`, out))
  }
  return out
}

function surveyRows(value, path = '$', rows = []) {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const columns = new Map()
      for (const row of value) {
        for (const [key, cell] of Object.entries(row)) {
          const entry = columns.get(key) ?? { types: new Set(), nulls: 0, invalid: 0, samples: [] }
          entry.types.add(typeTag(cell))
          if (cell === null) entry.nulls += 1
          if (typeof cell === 'string' && /INVALID/i.test(cell)) entry.invalid += 1
          if (entry.samples.length < 2 && cell !== null) {
            entry.samples.push((typeof cell === 'object' ? JSON.stringify(cell) : String(cell)).slice(0, 160))
          }
          columns.set(key, entry)
        }
      }
      rows.push({ path, count: value.length, columns })
    }
    value.forEach((item, index) => surveyRows(item, `${path}[${index}]`, rows))
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) surveyRows(item, `${path}.${key}`, rows)
  }
  return rows
}

function topLevelShape(value, path = '$', out = []) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (item && typeof item === 'object') {
        out.push(`${path}.${key} = ${Array.isArray(item) ? `数组(${item.length})` : '对象'}`)
        if (!Array.isArray(item)) topLevelShape(item, `${path}.${key}`, out)
      } else out.push(`${path}.${key} = ${typeTag(item)}${Array.isArray(item) ? '' : ` ${JSON.stringify(item)}`.slice(0, 80)}`)
    }
  } else if (Array.isArray(value)) out.push(`${path} = 数组(${value.length})`)
  return out
}

function diffPaths(a, b, path = '$', out = []) {
  if (out.length >= 12) return out
  const sameType = typeof a === typeof b && Array.isArray(a) === Array.isArray(b)
  if (!sameType) return out.push(`${path}: ${typeTag(a)} → ${typeTag(b)}`), out
  if (a === b) return out
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${path}: 长度 ${a.length} → ${b.length}`)
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) diffPaths(a[i], b[i], `${path}[${i}]`, out)
    return out
  }
  if (a && typeof a === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in a)) out.push(`${path}.${key}: 缺失 → 新增`)
      else if (!(key in b)) out.push(`${path}.${key}: 存在 → 缺失`)
      else diffPaths(a[key], b[key], `${path}.${key}`, out)
    }
  } else out.push(`${path}: ${JSON.stringify(a).slice(0, 30)} → ${JSON.stringify(b).slice(0, 30)}`)
  return out
}

const clients = new Map()
function clientFor(server) {
  if (!clients.has(server)) {
    clients.set(server, createWindClient({ endpoint: ENDPOINTS[server], resolveApiKey: async () => apiKey }))
  }
  return clients.get(server)
}

if (wanted === 'auth') {
  for (const [server, endpoint] of Object.entries(ENDPOINTS)) {
    const started = Date.now()
    try {
      const payload = await rpc(endpoint, 'initialize', initializeParams)
      const info = payload?.result?.serverInfo
      console.log(`OK    ${server.padEnd(16)} ${Date.now() - started}ms  serverInfo=${JSON.stringify(info ?? payload?.error ?? '(无)').slice(0, 120)}`)
    } catch (error) {
      console.log(`FAIL  ${server.padEnd(16)} ${Date.now() - started}ms  ${error.message}`)
    }
  }
  process.exit(0)
}

if (wanted === 'list') {
  const only = positionals[0]
  for (const [server, endpoint] of Object.entries(ENDPOINTS)) {
    if (only && server !== only) continue
    try {
      await rpc(endpoint, 'initialize', initializeParams)
      const payload = await rpc(endpoint, 'tools/list', {})
      const tools = payload?.result?.tools
      if (!Array.isArray(tools)) {
        console.log(`\n### ${server}: tools/list 无 result.tools → ${JSON.stringify(payload).slice(0, 200)}`)
        continue
      }
      console.log(`\n### ${server}: ${tools.length} 个工具`)
      for (const tool of tools) {
        const schema = tool.inputSchema ?? {}
        const required = new Set(schema.required ?? [])
        const props = Object.entries(schema.properties ?? {}).map(([name, def]) => {
          const type = def?.type ?? (def?.enum ? 'string' : '?')
          const enumText = Array.isArray(def?.enum) ? `{${def.enum.slice(0, 8).join('/')}${def.enum.length > 8 ? '…' : ''}}` : ''
          return `${name}${required.has(name) ? '*' : ''}:${type}${enumText}`
        })
        console.log(`  ${tool.name.padEnd(30)} ${props.join(' ')}`)
        if (flags.full) console.log(`    描述 ${(tool.description ?? '').replace(/\s+/g, ' ').slice(0, 300)}`)
      }
    } catch (error) {
      console.log(`\n### ${server}: ${error.message}`)
    }
  }
  process.exit(0)
}

const [server, tool] = flags.call.split('::')
if (!ENDPOINTS[server] || !tool) {
  console.error('--call 需要 <server>::<tool>，server 取 ' + Object.keys(ENDPOINTS).join(' / '))
  process.exit(1)
}
const callArgs = flags.args ? JSON.parse(flags.args) : {}
const repeat = Number(flags.repeat ?? 1)
const results = []
for (let attempt = 1; attempt <= repeat; attempt += 1) {
  const started = Date.now()
  const outcome = await clientFor(server).callTool(tool, callArgs)
  const ms = Date.now() - started
  console.log(`\n=== ${server}::${tool} 第 ${attempt}/${repeat} 次  ${ms}ms  ok=${outcome.ok} code=${outcome.code ?? '-'} chars=${JSON.stringify(outcome.data ?? outcome.content ?? '').length}`)
  if (!outcome.ok) {
    console.log(`    错误: ${(outcome.error ?? '').slice(0, 400)}`)
    continue
  }
  const payload = outcome.data ?? outcome.content
  results.push(payload)
  console.log(topLevelShape(payload).slice(0, 40).join('\n'))
  console.log(dumpTables(payload).join('\n'))
  const rows = surveyRows(payload)
  if (rows.length === 0) console.log('（没有元素为对象的数组——可能是并行数组或纯文档，见上面的形状）')
  for (const group of rows.slice(0, 6)) {
    console.log(`\n行数组 ${group.path}  ${group.count} 行  ${group.columns.size} 列`)
    for (const [key, entry] of group.columns) {
      const risky = keyFlags(key)
      console.log(`  ${key.padEnd(26)} ${[...entry.types].join('/').padEnd(16)} null=${entry.nulls} INVALID=${entry.invalid}${risky.length ? `  ⚠️${risky.join('+')}` : ''}  ${entry.samples.join(' | ').slice(0, 60)}`)
    }
  }
}
if (results.length === 2) {
  const differences = diffPaths(results[0], results[1])
  console.log(`\n=== 同参数重复调用：${differences.length === 0 ? '完全一致（可复现）' : `${differences.length} 处差异`}`)
  for (const line of differences) console.log(`  ${line}`)
}
