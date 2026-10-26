import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SELECTED_SKILL_CATALOG, SELECTED_SKILL_SKILL_DIRS } from '../selected-skills/catalog.js'

/**
 * Structural gate for the selected-skill tree: the runtime side ships Markdown and provenance only.
 * Scripts, evaluation fixtures, upstream docs and non-catalog skills were removed on 2026-10; this
 * test keeps them out, and keeps the one git-only area (reference implementations) inert.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILLS = join(ROOT, 'selected-skills')
const ALGORITHMS = join(SKILLS, 'reference-algorithms')
const CATALOG_ROOT = join(ROOT, 'selected-skills')

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((item) => item.isDirectory() ? walk(join(dir, item.name)) : [join(dir, item.name)])

const repositories = [...new Set(SELECTED_SKILL_CATALOG.map((entry) => entry.repository))]
const catalogDirs = new Set(SELECTED_SKILL_CATALOG.map((entry) =>
  join(CATALOG_ROOT, entry.repository, SELECTED_SKILL_SKILL_DIRS[entry.repository], entry.name)))
const SHARED = join(CATALOG_ROOT, 'china-stock-research-skills', 'skills', 'shared')

test('结构闸门：运行时快照里只有 Markdown 与溯源文件', () => {
  for (const repository of repositories) {
    const root = join(SKILLS, repository)
    assert.ok(existsSync(root), `${repository} 目录不存在`)
    for (const file of walk(root)) {
      const name = basename(file)
      assert.ok(file.endsWith('.md') || name === 'LICENSE',
        `${repository} 里还有运行时树之外的文件：${file.slice(SKILLS.length + 1)}（脚本、夹具与站点材料都该从仓里删除）`)
    }
  }
})

test('结构闸门：仓内 skill 目录逐颗对得上 catalog，没有未登记的正文', () => {
  const found = new Set()
  for (const repository of repositories) {
    const root = join(SKILLS, repository)
    for (const file of walk(root)) {
      if (basename(file) !== 'SKILL.md') continue
      found.add(dirname(file))
    }
  }
  for (const dir of found) {
    assert.ok(catalogDirs.has(dir) || dir === SHARED || dir.startsWith(SHARED + '/'),
      `发现未登记的 skill 正文：${dir.slice(SKILLS.length + 1)}（非 catalog 正文不进仓，见 docs/dev/selected-skills.md §8.6）`)
  }
  for (const dir of catalogDirs) {
    assert.ok(existsSync(join(dir, 'SKILL.md')), `catalog 条目缺正文：${dir.slice(SKILLS.length + 1)}`)
  }
})

test('结构闸门：参考算法区只在 git 里，文件头写明不执行，且没有任何 I/O 能力', () => {
  assert.ok(existsSync(join(ALGORITHMS, 'README.md')), 'reference-algorithms/README.md 缺索引')
  const files = walk(ALGORITHMS)
  const scripts = files.filter((file) => file.endsWith('.py'))
  assert.ok(scripts.length >= 40, `参考算法只剩 ${scripts.length} 份，闸门接近空断言`)
  for (const file of files) {
    assert.ok(file.endsWith('.py') || file.endsWith('.md'),
      `参考算法区出现非算法文件：${file.slice(ALGORITHMS.length + 1)}`)
  }
  const FORBIDDEN_IMPORTS = /\b(?:import\s+(?:requests|urllib|http|socket|subprocess|ftplib|telnetlib|smtplib|asyncio)|from\s+(?:requests|urllib|http|socket|subprocess)\b|os\.system|os\.popen|os\.getenv|os\.environ|subprocess\.)/i
  const FORBIDDEN_IO = /\bopen\s*\(|\bwrite_text\b|\bwrite_bytes\b|\burlopen\b/i
  for (const file of scripts) {
    const text = readFileSync(file, 'utf8')
    const where = file.slice(ALGORITHMS.length + 1)
    assert.match(text.slice(0, 300), /Reference implementation — not executed\./,
      `${where} 缺文件头声明（参考实现、不执行、来源）`)
    const hit = text.match(FORBIDDEN_IMPORTS)
    assert.equal(hit, null, `${where} 带 I/O 或网络能力：${hit?.[0]}`)
    const io = text.match(FORBIDDEN_IO)
    assert.equal(io, null, `${where} 读写文件或取 URL：${io?.[0]}（参考算法只做算术）`)
  }
})
