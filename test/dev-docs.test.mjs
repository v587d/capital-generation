// Structure gate for the docs layer: injected size (over budget truncates the tail silently),
// index/body agreement, and file-qualified §pointers resolving to a real section in a real file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allPresets } from './preset-rows.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const DEV_DIR = 'docs/dev'
// MAX_LINES = one-md-file split convention; MAX_AGENTS_BYTES = 75% of the injection gate.
const MAX_LINES = 150
const MAX_AGENTS_BYTES = 12288

const agentsText = read('AGENTS.md')
const devFiles = readdirSync(join(ROOT, DEV_DIR)).filter((f) => f.endsWith('.md')).sort()
assert.ok(devFiles.length >= 5, `${DEV_DIR}/ 应有多份详情文档，实际：${devFiles.join(', ')}`)
const devTexts = new Map(devFiles.map((f) => [`${DEV_DIR}/${f}`, read(`${DEV_DIR}/${f}`)]))

const HEADING = /^#{2,3}[ \t]+(\d+(?:\.\d+)?)(?:\.[ \t]|[ \t])[^\n]*$/gm
const headingsOf = (text) => [...text.matchAll(HEADING)].map((m) => m[1])
const rootHeadings = headingsOf(agentsText)
const devHeadings = new Map([...devTexts].map(([file, text]) => [file, headingsOf(text)]))

// §definitions: integer sections live only in AGENTS.md, detail files only in decimals, one carrier each.
const defined = new Set(rootHeadings)
const decimalOwners = new Map()
for (const [file, list] of devHeadings) {
  for (const h of list) {
    // An integer section here would mean two carriers for one section: split into §N.1… and keep the integer in the root.
    assert.ok(h.includes('.'), `${file} 定义了整数节 ## ${h}——整数节只住 AGENTS.md，这里按 §${h}.1… 拆小节`)
    assert.ok(!decimalOwners.has(h), `§${h} 同时在 ${decimalOwners.get(h)} 与 ${file} 里定义——§编号是全仓唯一命名空间`)
    decimalOwners.set(h, file)
    defined.add(h)
  }
}

// Index-cell §forms: `§4.2`, `§9.1–§9.6` (hyphen expands to the contiguous range).
function expandIndexCell(cell) {
  const out = []
  for (const m of cell.matchAll(/§(\d+(?:\.\d+)?)(?:–§?(\d+(?:\.\d+)?))?/g)) {
    out.push(m[1])
    if (!m[2]) continue
    const [parent, from] = m[1].split('.')
    const [toParent, to] = m[2].split('.')
    assert.equal(toParent, parent, `索引区间 ${m[0]} 跨了父节`)
    for (let n = Number(from) + 1; n <= Number(to); n += 1) out.push(`${parent}.${n}`)
  }
  return out
}

// Split must accept CRLF: `.` does not match `\r`, so line-anchored patterns miss every CR-terminated line.
const lines = (text) => text.split(/\r?\n/)
// lineCount: under CRLF each entry keeps a trailing `\r`, so counts need no fixup.
const lineCount = (text) => text.replace(/\n$/, '').split('\n').length
const filesToScan = []
const walk = (dir) => {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    // rel uses `/` only: join() yields `docs\dev` on Windows, never equal to the literals below, so docs/dev/
    // would be scanned as a root doc and every line-count / pointer report would be a false alarm.
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (!['node_modules', 'lib', '.git', '.review', DEV_DIR].includes(rel)) walk(rel)
    } else if (/\.(ts|mjs|js|cjs|yml|yaml)$/.test(entry.name) || (entry.name.endsWith('.md') && rel !== 'AGENTS.md')) {
      filesToScan.push(rel)
    }
  }
}
for (const dir of ['src', 'test', 'scripts', 'chart-ui', 'config', 'watchlist', 'automation', 'preset', 'docs']) walk(dir)

const scanTexts = new Map(filesToScan.map((rel) => [rel, read(rel)]))

test('AGENTS.md 与 docs/dev/*.md 守住体积闸门', () => {
  const bytes = Buffer.byteLength(agentsText, 'utf8')
  assert.ok(lineCount(agentsText) <= MAX_LINES, `AGENTS.md ${lineCount(agentsText)} 行 > ${MAX_LINES}：新内容进 docs/dev/，不要塞根索引`)
  assert.ok(bytes <= MAX_AGENTS_BYTES, `AGENTS.md ${bytes} 字节 > ${MAX_AGENTS_BYTES}：注入闸门会截断尾部规则，把详情搬进 docs/dev/`)
  for (const [file, text] of devTexts) {
    assert.ok(lineCount(text) <= MAX_LINES, `${file} ${lineCount(text)} 行 > ${MAX_LINES}：再拆一份，不要长回去`)
  }
})

test('agent-instructions 的 maxBytes 与本文体积匹配，且不被擅自放大', () => {
  // Every preset carries its own agent-instructions row, so this gate runs per preset: an enlarged budget truncates silently.
  const instructions = allPresets()
    .flatMap((preset) => (preset.config.plugins ?? []).filter((row) => row?.id === 'agent-instructions').map((row) => ({ presetId: preset.config.id, row })))
  assert.ok(instructions.length >= 2, `agent-instructions 行应覆盖每颗 preset，实际 ${instructions.length} 行`)
  for (const { presetId, row } of instructions) {
    const maxBytes = row.config?.maxBytes
    assert.equal(maxBytes, 16384, `${presetId} 的注入预算改动要有明确设计决策（放大掩盖膨胀，缩小会截断尾部规则）`)
    assert.ok(Buffer.byteLength(agentsText, 'utf8') <= maxBytes, `${presetId}: AGENTS.md 超出注入预算，尾部规则会静默消失`)
  }
})

test('AGENTS.md 顶层节连续，§编号不因拆分而漂移', () => {
  const ints = rootHeadings.filter((h) => !h.includes('.')).map(Number)
  for (let n = 1; n <= Math.max(...ints); n += 1) {
    assert.ok(ints.includes(n), `AGENTS.md 缺少顶层 §${n}（代码注释按 §编号与章节名引用，不许删或改号）`)
  }
})

test('§0 阅读路径表与 docs/dev/ 正文一一对应', () => {
  const table = [...agentsText.matchAll(/\|[^|\n]*\|\s*`(docs\/dev\/[a-z-]+\.md)`（([^）]*)）\s*\|/g)]
  assert.ok(table.length > 0, 'AGENTS.md 必须保留 §0 阅读路径表')
  const listed = new Map()
  for (const [, file, numbers] of table) {
    assert.ok(existsSync(join(ROOT, file)), `索引指向不存在的 ${file}`)
    const cell = expandIndexCell(numbers)
    for (const h of cell) {
      assert.ok(h.includes('.'), `索引行给 ${file} 写了整数节 §${h}——整数节属于 AGENTS.md，行里只列该文件的小节`)
    }
    listed.set(file, cell)
  }
  assert.deepEqual(
    [...listed.keys()].sort(),
    [...devTexts.keys()].sort(),
    '索引表与 docs/dev/ 文件清单必须一致（新文档要进表，删文档要一起删行）',
  )
  for (const [file, numbers] of listed) {
    const cell = [...numbers].sort()
    const actual = devHeadings.get(file).sort()
    assert.deepEqual(cell, actual, `${file} 的索引行与实际小节不符（内容搬进/搬出要同步索引；整数节属于 AGENTS.md，不写在行里）`)
  }
})

test('§编号规则：整数节只在 AGENTS.md 索引，小数节按父节从 .1 连续编号', () => {
  // Numbering is the repo-wide pointer namespace, so this checks self-consistency rather than citations:
  // one carrier per decimal (asserted at definition time), and decimals contiguous from .1 per parent
  // across carriers — a hole means a section was deleted without renumbering, or a list item never
  // became a section. Continuity spans carriers: §8.3 and §9.7 live in the root file itself.
  const byParent = new Map()
  const collect = (file, list) => {
    for (const h of list) {
      if (!h.includes('.')) continue
      const [parent, child] = h.split('.')
      const bucket = byParent.get(parent) ?? []
      const clash = bucket.find((k) => k.child === Number(child))
      assert.ok(!clash, `§${parent}.${child} 同时在 ${clash?.file} 与 ${file} 里定义——§编号是全仓唯一命名空间`)
      bucket.push({ child: Number(child), file })
      byParent.set(parent, bucket)
    }
  }
  collect('AGENTS.md', rootHeadings)
  for (const [file, list] of devHeadings) collect(file, list)
  for (const [parent, kids] of byParent) {
    assert.ok(rootHeadings.includes(parent), `§${parent} 的小节存在，但 AGENTS.md 没有 §${parent} 顶层节`)
    kids.sort((a, b) => a.child - b.child)
    kids.forEach((k, i) => {
      assert.equal(k.child, i + 1, `§${parent} 的小节不连续：期望 §${parent}.${i + 1}，实际是 §${parent}.${k.child}（${k.file}）——补编号或整体重编，不要留洞`)
    })
  }
})

test('文档层内部的 §指针全部可解析', () => {
  const sources = [['AGENTS.md', agentsText], ...devTexts]
  for (const [file, text] of sources) {
    for (const [, num] of text.matchAll(/§(\d+(?:\.\d+)?)/g)) {
      assert.ok(defined.has(num), `${file} 里的 §${num} 在 AGENTS.md 与 docs/dev/ 里都没有对应小节`)
    }
  }
})

test('代码与文档里的文件限定指针指向真实的节与真实的文件', () => {
  for (const [file, text] of scanTexts) {
    for (const line of lines(text)) {
      const agents = line.match(/AGENTS\.md[^\n]{0,24}§(\d+(?:\.\d+)?)/)
      if (agents) {
        assert.ok(
          rootHeadings.includes(agents[1]),
          `${file} 写的是 AGENTS.md §${agents[1]}，但该节已迁到 docs/dev/：${line.trim()}`,
        )
      }
      for (const dev of line.matchAll(/docs\/dev\/([a-z-]+\.md)(?:[^\n]{0,3}?§(\d+(?:\.\d+)?))?/g)) {
        assert.ok(existsSync(join(ROOT, DEV_DIR, dev[1])), `${file} 指向不存在的 docs/dev/${dev[1]}`)
        if (dev[2]) {
          assert.ok(
            devHeadings.get(`${DEV_DIR}/${dev[1]}`)?.includes(dev[2]),
            `${file} 写的是 docs/dev/${dev[1]} §${dev[2]}，该文件里没有这一节`,
          )
        }
      }
    }
  }
})

test('「章节名」式引用不因改名而失效', () => {
  const headingText = [agentsText, ...devTexts.values()]
    .flatMap((text) => [...text.matchAll(/^#{1,3}[ \t]+[^\n]+$/gm)].map((m) => m[0]))
    .join('\n')
  for (const [file, text] of scanTexts) {
    for (const quoted of text.matchAll(/「([^」]{2,24}?(?:纪律|闸门|布局|豁免))」/g)) {
      assert.ok(headingText.includes(quoted[1]), `${file} 引用的「${quoted[1]}」不再是任何小节的标题`)
    }
  }
})

test('研发文档不外泄进使用者 Agent 的运行时文本', () => {
  // Audience split: persona / skill is runtime text, so maintainer docs never get moved into it.
  const skillFiles = readdirSync(join(ROOT, 'preset/capital-generation/skills'))
    .flatMap((dir) => [join('preset/capital-generation/skills', dir, 'SKILL.md')])
    .filter((rel) => existsSync(join(ROOT, rel)))
  for (const rel of skillFiles) {
    assertNotDevRef(read(rel), rel)
  }
  assert.ok(skillFiles.length >= 5, `skills/ 下应有长协议与任务 SKILL.md（≥5，实际数量以目录为准），实际：${skillFiles.join(', ')}`)
  // Walk all presets: role personas live in their own presets and are the easiest to leak doc voice into.
  const rows = allPresets().flatMap((preset) => preset.config.plugins ?? [])
  const texts = []
  for (const row of rows) {
    const config = row?.config
    if (typeof config === 'string') {
      for (const line of lines(config)) {
        const match = line.match(/^\s*(?:persona|prefix|text):\s*(.*)$/)
        if (match && match[1].trim()) texts.push(match[1])
      }
    } else if (config && typeof config === 'object') {
      for (const field of ['persona', 'prefix', 'text']) {
        if (typeof config[field] === 'string') texts.push(config[field])
      }
    }
  }
  assert.ok(texts.length >= 6, `应抓到主 persona 与全部角色 persona（现共六段），实际 ${texts.length} 段：${texts.length}`)
  for (const text of texts) assertNotDevRef(text, 'agent.patch.yml persona')
})

function assertNotDevRef(text, label) {
  assert.ok(!/AGENTS\.md|docs\/dev\//.test(text), `${label} 引用了 AGENTS.md / docs/dev/——研发约定不许搬进模型运行时文本`)
}
