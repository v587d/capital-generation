import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createFuyaoRestSources } from '../lib/sources/fuyao-rest.js'
import { DataCollectorHub } from '../lib/data-collector/hub.js'

/**
 * 能力总表与实现同步。
 *
 * 表是给人看的能力清单（README 链接它），手工维护必然漂移；这里把"文档 == 实现"
 * 变成一条测试：新增端点却忘了更新 docs/data-collector-capabilities.md 时，
 * 失败信息会直接点名缺了哪个 capability。
 */
const DOC = fileURLToPath(new URL('../docs/data-collector-capabilities.md', import.meta.url))
const table = readFileSync(DOC, 'utf8')

/** 只抓分组能力表的首列（覆盖范围表的首列不是单独的 capability 名，天然不匹配）。 */
const documented = [...table.matchAll(/^\|\s`([a-z0-9_]+)`\s\|/gm)].map((match) => match[1])

function registered() {
  const hub = new DataCollectorHub({ store: { async save() { throw new Error('unused') } } })
  for (const source of createFuyaoRestSources(async () => 'unused')) hub.registerSource(source)
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
    assert.match(cells[2], /^`\/api\//, `${capability} 的端点列应为 \`/api/...\``)
    assert.ok(cells[3].length > 0, `${capability} 的参数列不应为空（无参数写「无参数」）`)
    assert.equal(cells[4], hub.describeCapability(capability).paginated ? '是' : '否', `${capability} 的分页列与实现不一致`)
    assert.ok(cells[5].length > 0, `${capability} 的用途列不应为空`)
    // 必填参数必须在表里带 * 标记，避免读者误以为全部可选
    const required = hub.describeCapability(capability).input_schema.required ?? []
    for (const name of required) {
      assert.ok(cells[3].includes(`\`${name}\`\\*`), `${capability} 的必填参数 ${name} 在表里缺少 * 标记`)
    }
  }
})

test('能力总表：README 必须链接到它', () => {
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')
  assert.ok(readme.includes('docs/data-collector-capabilities.md'), 'README 必须链接 docs/data-collector-capabilities.md')
})
