import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createFuyaoRestSources } from '../lib/sources/fuyao-rest.js'
import { createTencentSources } from '../lib/sources/tencent-http.js'
import { createEastmoneySources } from '../lib/sources/eastmoney-http.js'
import { createWindSources } from '../lib/sources/wind-mcp.js'
import { createFtshareSources } from '../lib/sources/ftshare-rest.js'
import { DataCollectorHub } from '../lib/data-collector/hub.js'

/**
 * Keeps the hand-maintained capability document in sync with the implementation; a new endpoint
 * without a doc update fails and names the missing capability.
 */
const DOC = fileURLToPath(new URL('../docs/data-collector-capabilities.md', import.meta.url))
const table = readFileSync(DOC, 'utf8')

/** Only the first column of capability tables (the coverage table's first column is not a bare name). */
const documented = [...table.matchAll(/^\|\s`([a-z0-9_]+)`\s\|/gm)].map((match) => match[1])

function registered() {
  const hub = new DataCollectorHub({ store: { async save() { throw new Error('unused') } } })
  for (const source of [...createFuyaoRestSources(async () => 'unused'), ...createTencentSources(), ...createEastmoneySources(), ...createWindSources(async () => 'unused'), ...createFtshareSources(async () => 'unused')]) hub.registerSource(source)
  return hub
}

test('能力总表：doc 列出的 capability 与实现完全一致（不多不少）', () => {
  const hub = registered()
  const actual = hub.capabilityNames()
  assert.equal(new Set(documented).size, documented.length, '总表里出现了重复的 capability 行')
  const missing = actual.filter((capability) => !documented.includes(capability))
  const extra = documented.filter((capability) => !actual.includes(capability))
  assert.deepEqual(missing, [], `总表缺少这些已注册 capability：${missing.join(', ')}`)
  assert.deepEqual(extra, [], `总表列出了未注册的 capability：${extra.join(', ')}`)
  assert.ok(table.includes(`当前共 **${actual.length} 个 capability**`), `总表开头的数量说明应写成「当前共 ${actual.length} 个 capability」`)
})

test('能力总表：每个 capability 都带端点路径、参数列与非空用途', () => {
  const hub = registered()
  for (const capability of hub.capabilityNames()) {
    const row = table.split('\n').find((line) => line.startsWith(`| \`${capability}\` |`))
    assert.ok(row, `${capability} 缺少表格行`)
    const cells = row.split('|').map((cell) => cell.trim())
    assert.ok(cells[2].startsWith('`/api/') || cells[2].startsWith('`/tencent/') || cells[2].startsWith('`/eastmoney/') || cells[2].startsWith('`/wind/') || cells[2].startsWith('`/ftshare/'), `${capability} 的端点列应为 Fuyao、Tencent、Eastmoney、Wind 或 FTShare 路径`)
    assert.ok(cells[3].length > 0, `${capability} 的参数列不应为空（无参数写「无参数」）`)
    assert.equal(cells[4], hub.describeCapability(capability).paginated ? '是' : '否', `${capability} 的分页列与实现不一致`)
    assert.ok(cells[5].length > 0, `${capability} 的用途列不应为空`)
    // Required params must carry a * marker so readers do not assume all are optional.
    const required = hub.describeCapability(capability).input_schema.required ?? []
    for (const name of required) {
      assert.ok(cells[3].includes(`\`${name}\`\\*`), `${capability} 的必填参数 ${name} 在表里缺少 * 标记`)
    }
  }
})

test('能力总表：README 必须链接到它，写了能力总数就得与实现一致', () => {
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')
  assert.ok(readme.includes('docs/data-collector-capabilities.md'), 'README 必须链接 docs/data-collector-capabilities.md')
  // A count on the landing page drifts as capabilities grow, sending users to ask for one that does
  // not exist; check only when a count is stated -- the page need not state one.
  const stated = readme.match(/(\d+)[\s*]*个\s*数据收集能力/)
  if (stated === null) return
  assert.equal(Number(stated[1]), registered().capabilityNames().length,
    'README 首页写的「数据收集能力」数量与实现注册的条数不一致——扩容或收敛之后两处要一起改（或把首页那个数字去掉）')
})
