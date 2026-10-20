// Cross-platform static gate: pins "only breaks on Windows" shapes. Scans shapes, not behavior;
// when it goes red, fix the code, not the test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Generated artifacts are skipped: `lib/`, `*/client.js`, and gitignored runtime bundles.
const SKIP_DIRS = new Set(['node_modules', '.git', '.review', '.tmp-boot', '.tmp-debug', 'vendor'])
const SKIP_FILES = new Set(['client.js', 'client.runtime.gen.cjs'])
const isSource = (name) => /\.(ts|mjs|cjs|js)$/.test(name)

const sources = new Map()
const walk = (dir) => {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    // join() yields `src\agents` on Windows, which would break the `src/` prefix rules.
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(rel)
    } else if (isSource(entry.name) && !SKIP_FILES.has(entry.name)) {
      sources.set(rel, readFileSync(join(ROOT, rel), 'utf8'))
    }
  }
}
for (const dir of ['src', 'test', 'scripts', 'chart-ui', 'config', 'watchlist']) walk(dir)

test('跨平台闸门确实扫到了源码（扫描范围失效就等于没有闸门）', () => {
  assert.ok(sources.size >= 100, `只扫到 ${sources.size} 个源码文件，多半是目录清单或后缀写错了`)
  for (const must of ['src/index.ts', 'scripts/lib/run-tool.mjs', 'chart-ui/index.js']) {
    assert.ok(sources.has(must), `扫描范围漏了 ${must}`)
  }
})

// Runs one rule line by line, skipping comments that quote the banned shape.
function find(check) {
  const found = []
  for (const [rel, text] of sources) {
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue
      const why = check(line, rel)
      if (why) found.push(`${rel}:${i + 1}  ${why}\n        ${trimmed}`)
    }
  }
  return found
}

test('URL 的 pathname 不是文件路径', () => {
  // Windows: `new URL('..', import.meta.url).pathname` is `/D:/...`, so existsSync is false.
  // Only import.meta.url is pinned; http URL pathnames are legitimate. Keyword is assembled so
  // this line does not trip its own rule.
  const IMETA = 'import.meta' + '.url'
  const found = find((line) =>
    (line.includes(IMETA) && /\.pathname\b/.test(line) && !/fileURLToPath\(/.test(line))
      ? '把 import.meta.url 转成本地路径必须走 fileURLToPath()：.pathname 在 Windows 上是 /D:/…'
      : undefined)
  assert.deepEqual(found, [], '用 URL 当路径 = Windows 上打不开文件：\n' + found.join('\n'))
})

test('起子进程不许按命令名起 Node CLI', () => {
  // `npm` / `dsh` are `.cmd` shims: spawnSync('npm') gives ENOENT, 'npm.cmd' gives EINVAL. Only
  // `spawn(process.execPath, …)` works; shell args are DEP0190 (unescaped).
  const NATIVE_EXE = new Set(['git'])
  const found = find((line) => {
    if (/\bshell:\s*true\b/.test(line)) return '不许把参数交给 shell 拼接（DEP0190 弃用形态，参数不转义）'
    const out = []
    for (const m of line.matchAll(/\b(?:spawn|spawnSync|execFile|execFileSync)\(\s*([^,\n)]+)/g)) {
      const first = m[1].trim()
      const bare = first.replace(/^['"]|['"]$/g, '')
      if (first === 'process.execPath') continue
      if (NATIVE_EXE.has(bare)) continue
      out.push(`第一实参是 ${first}：只允许 process.execPath 或白名单里的真 exe（${[...NATIVE_EXE].join(' / ')}）`)
    }
    return out.length > 0 ? out.join('；') : undefined
  })
  assert.deepEqual(found, [], '裸命令名起不了 Node CLI：\n' + found.join('\n'))
  // An unexamined allowlist rots into "anything passes".
  for (const name of NATIVE_EXE) {
    const stillUsed = [...sources.values()].some((text) => new RegExp(`\\bspawn\\w*\\(\\s*['"]${name}['"]`).test(text))
    assert.ok(stillUsed, `白名单里的 ${name} 已经没有调用点，删掉那一项（留着就是在给未来的裸调用放行）`)
  }
})

test('PATH 与 HOME 不许各处自己解释', () => {
  // PATH separates with `;` on Windows; HOME usually does not exist, so join('', '.dsh') turns
  // relative and "checked 0 sessions" still reports ok.
  const PATH_OWNER = 'scripts/lib/run-tool.mjs'
  const bad = find((line, rel) => {
    if (rel === PATH_OWNER) return undefined
    if (/process\.env\.PATH\b/.test(line)) return `读 PATH 要走 pathDirs()（唯一实现在 ${PATH_OWNER}），自己拆会漏掉 Windows 的 \`;\``
    if (/process\.env\.HOME\b/.test(line)) return '用 node:os 的 homedir()：Windows 上没有 HOME'
    return undefined
  })
  assert.deepEqual(bad, [], '出现第二份 PATH/HOME 解释：\n' + bad.join('\n'))
  assert.ok(sources.get(PATH_OWNER).includes('delimiter'), `${PATH_OWNER} 必须用 node:path 的 delimiter 拆 PATH`)
})

test('按结构解析磁盘文本的正则不许写死换行符', () => {
  // A hard-coded newline misses CRLF SKILL.md and reports "no frontmatter", blaming the file.
  // Backslashes are assembled because this test file is inside its own scan.
  const B = String.raw`\\`
  const CR = String.raw`\r`
  const FENCE = new RegExp(`(?:---${B}r\\?${B}n|---${B}n|${B}r\\?${B}n---|${B}n---)`, 'g')
  const bad = find((line) => {
    for (const m of line.matchAll(FENCE)) {
      if (!m[0].includes(CR)) return '围栏旁边的换行要写成可选 CR：Windows 工作区的文件带 CRLF'
    }
    return undefined
  })
  assert.deepEqual(bad, [], '解析 frontmatter 的正则不容忍 CRLF：\n' + bad.join('\n'))
})

test('src 与 scripts 里不许有平台分支', () => {
  // A platform branch means one half was never tested; preset rows (bash/pwsh slots) are assembly
  // syntax and out of scope.
  const bad = find((line, rel) =>
    (rel.startsWith('src/') || rel.startsWith('scripts/')) && /process\.platform\b/.test(line)
      ? '平台分支：改成 delimiter / 候选名清单 / execPath，让同一份代码两端都跑得通'
      : undefined)
  assert.deepEqual(bad, [], '出现平台分支：\n' + bad.join('\n'))
})
