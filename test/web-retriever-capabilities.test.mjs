import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { OCR_TOOL_NAME, RETRIEVAL_DENIED_TOOLS } from '../lib/agents/root-tool-policy.js'

// The capability doc drifts unless pinned: a stale row means the user asks for a tool name that no
// longer exists. Name truth is src/agents/root-tool-policy.ts (RETRIEVAL_DENIED_TOOLS + OCR_TOOL_NAME
// = 14); preset, doc and this test all read from that one table.
const DOC = fileURLToPath(new URL('../docs/web-retriever-capabilities.md', import.meta.url))
const doc = readFileSync(DOC, 'utf8')

// Matches only the three capability tables' first column; the 「怎么用」 table holds a bolded surface name there.
const documented = [...doc.matchAll(/^\|\s`([a-z0-9_]+)`\s\|/gm)].map((match) => match[1])
const registered = [...RETRIEVAL_DENIED_TOOLS, OCR_TOOL_NAME]

test('web_retriever 能力表：doc 列出的工具与实现完全一致（不多不少）', () => {
  assert.equal(new Set(documented).size, documented.length, `能力表里有重复的工具行：${documented.join(', ')}`)
  const missing = registered.filter((name) => !documented.includes(name))
  const extra = documented.filter((name) => !registered.includes(name))
  assert.deepEqual(missing, [], `能力表缺少这些已注册工具：${missing.join(', ')}`)
  assert.deepEqual(extra, [], `能力表列出了未注册的工具（改名没跟上，或写错了名字）：${extra.join(', ')}`)
  assert.ok(doc.includes(`当前共 **${registered.length} 个工具**`), `表开头的数量说明应写成「当前共 ${registered.length} 个工具」`)
})

test('web_retriever 能力表：每个工具都带上游、密钥口径与非空用途', () => {
  for (const name of registered) {
    const row = doc.split('\n').find((line) => line.startsWith(`| \`${name}\` |`))
    assert.ok(row, `${name} 缺少表格行`)
    const cells = row.split('|').map((cell) => cell.trim())
    assert.equal(cells.length, 7, `${name} 的表格行应是「工具 | 上游 | 密钥 | 参数 | 用途」五列：${row}`)
    assert.ok(cells[2].length > 0, `${name} 的上游列不应为空`)
    // Two allowed values only: besides this repo's four keys every other source is keyless; "optional" is not an answer.
    assert.ok(['需要', '无'].includes(cells[3]), `${name} 的密钥列应写「需要」或「无」，实际是「${cells[3]}」`)
    assert.ok(cells[4].length > 0, `${name} 的参数列不应为空（无参数写「无参数」）`)
    assert.ok(cells[5].length > 0, `${name} 的用途列不应为空`)
  }
})

test('web_retriever 能力表：README 必须链接到它，写了工具总数就得与实现一致', () => {
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')
  assert.ok(readme.includes('docs/web-retriever-capabilities.md'), 'README 必须链接 docs/web-retriever-capabilities.md')
  // README's 「共计 14 个网页检索能力」 count drifts with tool changes; checked only when present.
  const stated = readme.match(/(\d+)[\s*]*个\s*网页检索能力/)
  if (stated === null) return
  assert.equal(Number(stated[1]), registered.length,
    'README 首页写的「网页检索能力」数量与实现注册的工具数不一致——增删工具后两处要一起改（或把首页那个数字去掉）')
})
