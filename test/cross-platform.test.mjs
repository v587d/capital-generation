// 跨平台静态闸门：把"只在 Windows 上炸"的几类写法钉进测试，让它在提交当天就红。
//
// 为什么存在：2026-09-30 用真 Windows node（从 WSL 调 `C:\Program Files\nodejs\node.exe`）复现了
// 8 处失败，成因集中在四件事：把 posix 字符串假设带到本机分隔符/换行符上、把 `URL` 的 pathname
// 当文件路径、按命令名起子进程、自己拆 PATH。逐条修完再靠人记住下一处别写错，等于等下次分发再炸。
//
// 这里扫的是**形状**不是行为，所以每条规则都对应一次实测失败或一处静默失效；白名单里的每一项
// 都写明了为什么可以留。新增违规时改代码，不要改这条测试——它红着的价值高于绿着。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 扫描范围 = 手写的源码。`lib/` 与 `*/client.js` 是构建产物（tsc / scripts/build-*-client.mjs
// 生成，每次 npm run build 覆盖），报在那里改不动也不该改；`client.runtime.gen.cjs` 正常会被
// finally 删掉，脚本异常退出时会残留（.gitignore 就是为它留的），一样不在规则管辖内。
const SKIP_DIRS = new Set(['node_modules', '.git', '.review', '.tmp-boot', '.tmp-debug', 'vendor'])
const SKIP_FILES = new Set(['client.js', 'client.runtime.gen.cjs'])
const isSource = (name) => /\.(ts|mjs|cjs|js)$/.test(name)

const sources = new Map()
const walk = (dir) => {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    // rel 只用 `/` 拼：join() 在 Windows 上产出 `src\agents`，而下面的规则比的是 `src/` 前缀。
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(rel)
    } else if (isSource(entry.name) && !SKIP_FILES.has(entry.name)) {
      sources.set(rel, readFileSync(join(ROOT, rel), 'utf8'))
    }
  }
}
for (const dir of ['src', 'test', 'scripts', 'chart-ui', 'capital-config', 'capital-watchlist']) walk(dir)

/** 闸门自己也不能"扫到 0 个文件还报通过"——那正是它要防的失效形态。 */
test('跨平台闸门确实扫到了源码（扫描范围失效就等于没有闸门）', () => {
  assert.ok(sources.size >= 100, `只扫到 ${sources.size} 个源码文件，多半是目录清单或后缀写错了`)
  for (const must of ['src/index.ts', 'scripts/lib/run-tool.mjs', 'chart-ui/index.js']) {
    assert.ok(sources.has(must), `扫描范围漏了 ${must}`)
  }
})

/**
 * 逐行跑规则；注释行跳过（`run-tool.mjs` 与 persona 测试里都有"解释为什么不能那样写"的注释，
 * 把它们算成违规会让规则失去可信度）。返回 `文件:行号  原因` 清单。
 */
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
  // Windows 上 `new URL('..', import.meta.url).pathname` 给 `/D:/Projects/…`（多一个前导斜杠，
  // 且带 URI 编码），existsSync 直接 false。要本地路径就用 fileURLToPath。
  // 只钉 import.meta.url 那一类：`new URL(httpUrl).pathname` 读网页 URL 是对的（data_collector、
  // web_retriever 都在用），不在本规则内。
  // 关键词拼装：这一行若同时出现两个被禁形状，闸门就把自己判成违规了。
  const IMETA = 'import.meta' + '.url'
  const found = find((line) =>
    (line.includes(IMETA) && /\.pathname\b/.test(line) && !/fileURLToPath\(/.test(line))
      ? '把 import.meta.url 转成本地路径必须走 fileURLToPath()：.pathname 在 Windows 上是 /D:/…'
      : undefined)
  assert.deepEqual(found, [], '用 URL 当路径 = Windows 上打不开文件：\n' + found.join('\n'))
})

test('起子进程不许按命令名起 Node CLI', () => {
  // `npm` / `dsh` 在 Windows 上是 `.cmd` 垫片：`spawnSync('npm')` → ENOENT 且 stderr 空（失败
  // 被报成一句没有原因的断言），`spawnSync('npm.cmd')` → EINVAL（Node 对 .bat/.cmd 强制要 shell）。
  // 唯一没有引号问题的写法是 `spawn(process.execPath, [<cli.js>, ...])`；把参数交给 shell 再拼接
  // 是 DEP0190 弃用形态（参数不转义），所以那个选项一起禁。
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
  // 白名单不查"还在用吗"就会腐烂成"什么都能过"。
  for (const name of NATIVE_EXE) {
    const stillUsed = [...sources.values()].some((text) => new RegExp(`\\bspawn\\w*\\(\\s*['"]${name}['"]`).test(text))
    assert.ok(stillUsed, `白名单里的 ${name} 已经没有调用点，删掉那一项（留着就是在给未来的裸调用放行）`)
  }
})

test('PATH 与 HOME 不许各处自己解释', () => {
  // 同一个能力两份实现，就是 AGENTS.md §9.7 那次事故的形状：PATH 分隔符 Windows 是 `;`，
  // 自己 `.split(':')` 会把整条 PATH 拆成碎串，症状不是报错而是"永远找不到 → 跳过核对"；
  // `process.env.HOME` 在 Windows 上通常不存在，`join('', '.dsh')` 变成相对路径，
  // 于是"检查了 0 份会话"照样报 ✅。
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
  // frontmatter 的围栏是**结构边界**：换行写死时，Windows 工作区里带 CRLF 的 SKILL.md 匹配
  // 不上，报出来是"skill 没有 frontmatter"——指向错的文件，而不是换行符。要写成可选 CR。
  // 反斜杠用拼装而不是字面量：这个文件也在自己的扫描范围里，写下被禁形状就会被自己判违规
  // （留"扫描豁免"的口子等于给未来的违规放行，所以宁可绕一下）。
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
  // 平台差异一律用**同时容纳两种形状**的写法表达：`node:path` 的 `delimiter`、可执行名清单
  // 同时含 `dsh` 与 `dsh.cmd`、`process.execPath`。写 `if (process.platform === 'win32')`
  // 就意味着本机只测过一半，而另一半没人测（正是这条闸门要防的）。
  // 例外住在 preset 行里（bash/pwsh 槽位必须按平台选名），那是 harness 的装配语法，不在本规则内。
  const bad = find((line, rel) =>
    (rel.startsWith('src/') || rel.startsWith('scripts/')) && /process\.platform\b/.test(line)
      ? '平台分支：改成 delimiter / 候选名清单 / execPath，让同一份代码两端都跑得通'
      : undefined)
  assert.deepEqual(bad, [], '出现平台分支：\n' + bad.join('\n'))
})
