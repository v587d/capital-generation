import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { OCR_TOOL_NAME, RETRIEVAL_DENIED_TOOLS } from '../lib/agents/root-tool-policy.js'

/**
 * web_retriever 能力表与实现同步。
 *
 * 与 `test/data-collector-capabilities.test.mjs` 同族：README 首页只留三行概括，明细住在
 * `docs/web-retriever-capabilities.md`，靠人记得改必然漂移。2.2.0 那次 `web_retriever_search`
 * 改名成 `anysearch_search` 就同时动了工具、persona 与文档——文档漏改的症状是"用户照着表里
 * 一个不存在的名字去问"，所以这里把名字集合钉成测试。
 *
 * 名字的事实来源是 `src/agents/root-tool-policy.ts`（注释自称"出网工具名唯一一份事实来源"，
 * 13 个检索/查询 + `ocr` = 14），preset 与测试都从它取。
 */
const DOC = fileURLToPath(new URL('../docs/web-retriever-capabilities.md', import.meta.url))
const doc = readFileSync(DOC, 'utf8')

/** 只抓三张能力表的首列；「怎么用」那张的首列是粗体工作面名，天然不匹配。 */
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
    // 密钥列只许两档：本仓四把密钥之外的来源查询面全部零密钥，写"可选"这类模糊口径等于没写。
    assert.ok(['需要', '无'].includes(cells[3]), `${name} 的密钥列应写「需要」或「无」，实际是「${cells[3]}」`)
    assert.ok(cells[4].length > 0, `${name} 的参数列不应为空（无参数写「无参数」）`)
    assert.ok(cells[5].length > 0, `${name} 的用途列不应为空`)
  }
})

test('web_retriever 能力表：README 必须链接到它', () => {
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')
  assert.ok(readme.includes('docs/web-retriever-capabilities.md'), 'README 必须链接 docs/web-retriever-capabilities.md')
})
