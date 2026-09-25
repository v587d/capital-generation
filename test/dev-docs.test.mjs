// 研发文档层（AGENTS.md + docs/dev/）的结构闸门。
//
// 为什么存在：AGENTS.md 上一版手工维护一份"哪节被谁引用"的清单，代码注释一改就失真；
// 拆分到 docs/dev/ 之后，指针跨文件了，靠人记必然漏。这里把三件事钉成测试：体积（注入
// 预算与"尾部静默消失"）、索引与正文一致（内容搬走但索引没改 = 文档说谎）、指针可解析
// （§编号与「章节名」引用指向真实存在的节）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as yamlLoad } from 'js-yaml'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const DEV_DIR = 'docs/dev'
// 行数上限来自"一份 md 不超过 150 行"的拆分约定；字节上限 = preset 注入闸门
// （agent-instructions 的 maxBytes: 16384）的 75%，与 §1.5 / §4.1 的输出预算同一口径。
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

/** 全仓文档层的 §定义：整数节只在根定义（详情文件可重复父节做标题），小数节全局唯一。 */
const defined = new Set(rootHeadings)
const decimalOwners = new Map()
for (const [file, list] of devHeadings) {
  for (const h of list) {
    if (!h.includes('.')) {
      assert.ok(rootHeadings.includes(h), `${file} 的 ## ${h} 在 AGENTS.md 里没有对应的顶层节`)
      continue
    }
    assert.ok(!decimalOwners.has(h), `§${h} 同时在 ${decimalOwners.get(h)} 与 ${file} 里定义——§编号是全仓唯一命名空间`)
    decimalOwners.set(h, file)
    defined.add(h)
  }
}

const lineCount = (text) => text.replace(/\n$/, '').split('\n').length
const filesToScan = []
const walk = (dir) => {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', 'lib', '.git', '.review', DEV_DIR].includes(rel)) walk(rel)
    } else if (/\.(ts|mjs|js|cjs|yml|yaml)$/.test(entry.name) || (entry.name.endsWith('.md') && rel !== 'AGENTS.md')) {
      filesToScan.push(rel)
    }
  }
}
for (const dir of ['src', 'test', 'scripts', 'chart-ui', 'capital-config', 'preset', 'docs']) walk(dir)

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
  const rows = yamlLoad(read('preset/capital-generation/agent.cordis.yml').replace(/!!js\s+/g, ''))
  const instructions = rows.find((row) => row?.id === 'agent-instructions')
  assert.ok(instructions, 'preset 必须有 agent-instructions 行')
  const maxBytes = instructions.config?.maxBytes
  assert.equal(maxBytes, 16384, '注入预算改动要有明确设计决策（放大掩盖膨胀，缩小会截断尾部规则）')
  assert.ok(Buffer.byteLength(agentsText, 'utf8') <= maxBytes, 'AGENTS.md 超出注入预算，尾部规则会静默消失')
})

test('AGENTS.md 保留十个顶层节，§编号不因拆分而漂移', () => {
  for (let n = 1; n <= 10; n += 1) {
    assert.ok(rootHeadings.includes(String(n)), `AGENTS.md 缺少顶层 §${n}（代码注释按 §编号与章节名引用，不许删或改号）`)
  }
})

test('§0 阅读路径表与 docs/dev/ 正文一一对应', () => {
  const table = [...agentsText.matchAll(/\|[^|\n]*\|\s*`(docs\/dev\/[a-z-]+\.md)`（([^）]*)）\s*\|/g)]
  assert.ok(table.length > 0, 'AGENTS.md 必须保留 §0 阅读路径表')
  const listed = new Map()
  for (const [, file, numbers] of table) {
    assert.ok(existsSync(join(ROOT, file)), `索引指向不存在的 ${file}`)
    listed.set(file, numbers.match(/§(\d+(?:\.\d+)?)/g)?.map((s) => s.slice(1)) ?? [])
  }
  assert.deepEqual(
    [...listed.keys()].sort(),
    [...devTexts.keys()].sort(),
    '索引表与 docs/dev/ 文件清单必须一致（新文档要进表，删文档要一起删行）',
  )
  for (const [file, numbers] of listed) {
    assert.deepEqual(
      [...numbers].sort(),
      devHeadings.get(file).slice().sort(),
      `${file} 的索引行与实际小节不符（内容搬进/搬出要同步索引）`,
    )
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
    for (const line of text.split('\n')) {
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
  // 受众分离：persona / skill 是使用者 Agent 的运行时指令，docs/dev 与 AGENTS.md 是研发约定。
  // 这条断言挡掉"为腾 AGENTS.md 空间把内容搬进 persona"的反向操作。
  const skillFiles = readdirSync(join(ROOT, 'preset/capital-generation/skills'))
    .flatMap((dir) => [join('preset/capital-generation/skills', dir, 'SKILL.md')])
    .filter((rel) => existsSync(join(ROOT, rel)))
  for (const rel of skillFiles) {
    assertNotDevRef(read(rel), rel)
  }
  assert.ok(skillFiles.length >= 5, `skills/ 下应有五个长协议 SKILL.md，实际：${skillFiles.join(', ')}`)
  const rows = yamlLoad(read('preset/capital-generation/agent.cordis.yml').replace(/!!js\s+/g, ''))
  const texts = []
  for (const row of rows) {
    const config = row?.config
    if (typeof config === 'string') {
      for (const line of config.split('\n')) {
        const match = line.match(/^\s*(?:persona|prefix|text):\s*(.*)$/)
        if (match && match[1].trim()) texts.push(match[1])
      }
    } else if (config && typeof config === 'object') {
      for (const field of ['persona', 'prefix', 'text']) {
        if (typeof config[field] === 'string') texts.push(config[field])
      }
    }
  }
  assert.ok(texts.length >= 4, `应至少抓到主 persona 与三个子 persona，实际 ${texts.length} 段`)
  for (const text of texts) assertNotDevRef(text, 'agent.cordis.yml persona')
})

function assertNotDevRef(text, label) {
  assert.ok(!/AGENTS\.md|docs\/dev\//.test(text), `${label} 引用了 AGENTS.md / docs/dev/——研发约定不许搬进模型运行时文本`)
}
