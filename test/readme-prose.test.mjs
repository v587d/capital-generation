import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SELECTED_SKILL_CATALOG } from '../selected-skills/catalog.js'

/**
 * README is user-facing, not repository-facing.
 *
 * Detect internal pointer shapes rather than exact wording: implementation identifiers belong in
 * AGENTS.md/docs/dev. Fenced commands are user instructions and are skipped.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const readme = readFileSync(`${ROOT}README.md`, 'utf8')
const prose = readme.replace(/^```[\s\S]*?^```[ \t]*$/gm, '')

/** Internal-identifier shapes and where they should live instead. */
const JARGON = [
  [/§\d/g, '§编号是 AGENTS.md 与 docs/dev/ 的指针命名空间，读者那边没有这份文档'],
  [/docs\/dev\/\S*/g, 'docs/dev/ 是研发详情层，不该出现在首页链接里'],
  [/\bctx\.\w/g, '`ctx.*` 是插件内部 API'],
  [/\b\w+_(?:ref|id)\b/g, '`*_ref` / `*_id` 是工具之间的内部引用名'],
  [/\b(?:src|preset|scripts)\/[\w./-]+/g, '仓内源码路径是实现细节，读者改不到'],
  [/\b(?:toolFilter|isConcurrencySafe|SAFE_RESULT_CHARS|FiberState|DatasetRef|persona|one-shot|continuable|volatile|boot graph|host 平面|agent-instructions|maxBytes)\b/g, '实现层标识'],
]

for (const [pattern, reason] of JARGON) {
  test(`README 不写研发黑话：${reason}`, () => {
    const hits = [...prose.matchAll(pattern)].map((match) => match[0])
    assert.deepEqual(hits, [], `README 里出现了「${hits.join('、')}」——${reason}。要留给读者的写法：说这件事的**结果**（用户会看到什么、要做什么），需要细节就链接 docs 里那几份能力表。`)
  })
}

test('README 的黑话闸门不许被整体注释掉', () => {
  // Require patterns so clearing the list cannot silently pass.
  assert.ok(JARGON.length >= 5, `黑话形状清单只剩 ${JARGON.length} 条，低于 5 条即视为被削减`)
  assert.ok(prose.includes('# Capital Generation'), 'README 正文本身应可读（标题行缺失多半是文件被截断）')
})

test('README「精选 Skills」的项目数与 Skill 数跟着 catalog 走', () => {
  // Card count is derived from catalog; pinned numeric copy drifts silently (§9.7). Wording changes are not the gate.
  const projects = new Set(SELECTED_SKILL_CATALOG.map(({ repository }) => repository)).size
  const line = prose.split('\n').find((text) => text.includes('**精选 Skills：**'))
  assert.ok(line, 'README 里找不到「精选 Skills」那行')
  const stated = line.match(/(\d+) 个开源项目、共 (\d+) 个\s*(?:Skill|可选模块)/)
  assert.ok(stated, `那行要写成"N 个开源项目、共 M 个 Skill"（catalog 现算是 ${projects} / ${SELECTED_SKILL_CATALOG.length}）`)
  assert.equal(Number(stated[1]), projects, `首页写的开源项目数是 ${stated[1]}，catalog 现算是 ${projects}`)
  assert.equal(Number(stated[2]), SELECTED_SKILL_CATALOG.length,
    `首页写的 Skill 总数是 ${stated[2]}，catalog 现算是 ${SELECTED_SKILL_CATALOG.length}（接新快照时两处一起改）`)
})

const PLUGIN_PAGE_DOCS = ['plugin-page/README.zh.md', 'plugin-page/README.en.md']

test('插件页详情文档是索引页：不写研发黑话，也不复制会随版本变的事实', () => {
  for (const file of PLUGIN_PAGE_DOCS) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    const pageProse = text.replace(/^```[\s\S]*?^```[ \t]*$/gm, '')
    for (const [pattern, reason] of JARGON) {
      const hits = [...pageProse.matchAll(pattern)].map((match) => match[0])
      assert.deepEqual(hits, [],
        `${file} 出现了「${hits.join('、')}」——${reason}。插件页只写用户可见内容，细节链到 README。`)
    }
    const versions = [...pageProse.matchAll(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/gu)].map((match) => match[0])
    assert.deepEqual(versions, [],
      `${file} 写了具体版本号（${versions.join('、')}）：版本号会随发版变，应链到 CHANGELOG。`)
    const counts = [...pageProse.matchAll(/\b(?:128|70|16)\s*(?:个|项|条|张)/gu)].map((match) => match[0])
    assert.deepEqual(counts, [],
      `${file} 写了会变的能力/模板/Skill 数量（${counts.join('、')}）：应链到能力表。`)
    assert.ok(text.includes('https://github.com/v587d/capital-generation'),
      `${file} 缺少指向 README/CHANGELOG 的绝对链接`)
  }
})
