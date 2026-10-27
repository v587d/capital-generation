import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { locateNpmCli } from '../scripts/lib/run-tool.mjs'

/**
 * Packaging gate: the assertion is "present in the published tarball" (`npm pack --dry-run --json`),
 * not "present in the source tree". Vendored browser assets are not moved by tsc, and a missing
 * client bundle keeps the whole web profile from starting.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function packedFilePaths() {
  // Launch npm through this process's node: the Windows `npm` shim is a `.cmd` (ENOENT, empty stderr),
  // `npm.cmd` hits EINVAL and `shell: true` with args is a deprecated form.
  const { cli, searched } = locateNpmCli()
  assert.ok(cli !== undefined,
    `定位不到 npm-cli.js，无法问真实打包器"发出去的文件有哪些"。搜过这些路径：\n${searched.join('\n')}`)
  const result = spawnSync(process.execPath, [cli, 'pack', '--dry-run', '--json', '--cache', './.npm-cache'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  })
  assert.equal(result.status, 0,
    `npm pack --dry-run 失败（status=${String(result.status)} signal=${result.signal ?? 'none'}）：\n${result.stderr}\n`
    + `入口：${cli}\n启动本身：${result.error === undefined ? 'ok' : `${result.error.code ?? ''} ${result.error.message}`}`)
  const report = JSON.parse(result.stdout)
  assert.ok(Array.isArray(report) && report.length === 1, 'npm pack --dry-run --json 应返回一个包的报告')
  return new Set(report[0].files.map((file) => file.path))
}

test('打包闸门：vendored 图表库与构建产物都在发布清单里', (t) => {
  const paths = packedFilePaths()

  for (const required of [
    'lib/index.js',
    'lib/chart/tool.js',
    'lib/chart/runtime.js',
    'lib/chart/vendor/lightweight-charts.standalone.production.js',
    'lib/chart/vendor/VERSION.json',
    'lib/chart/vendor/LICENSE',
    'chart-ui/package.json',
    'chart-ui/index.js',
    'chart-ui/client.js',
    'config/package.json',
    'config/index.js',
    'config/client.js',
    'watchlist/package.json',
    'watchlist/index.js',
    // Shared type table: imported by the host half, inlined by the browser half — missing kills /capital-watchlist.
    'watchlist/holding-rules.js',
    'watchlist/client.js',
    // A listed LICENSE that is not shipped loses the attribution duty.
    'THIRD_PARTY_NOTICES.md',
    // Automation host bundle: a missing client half is fatal to the web profile, and a missing
    // host half silently removes the page and its scheduler.
    'automation/package.json',
    'automation/index.js',
    'automation/client.js',
    'automation/defaults.js',
    'automation/workspaces.js',
    'preset/capital-generation/agent.patch.yml',
    'preset/capital-generation/skills/capital-chart-protocol/SKILL.md',
    // Persona duty lines load skills by name, so every protocol book is named individually here.
    'preset/capital-generation/skills/capital-data-protocol/SKILL.md',
    'preset/capital-generation/skills/capital-data-profile/SKILL.md',
    'preset/capital-generation/skills/capital-data-query/SKILL.md',
    'preset/capital-generation/skills/capital-web-protocol/SKILL.md',
    'preset/capital-generation/skills/capital-web-evidence/SKILL.md',
    'cordis.patch.yml',
  ]) {
    assert.ok(paths.has(required), `发布清单里缺少 ${required}（npm run build 是否跑过？files 列表是否漏了？）`)
  }

  // Apache-2.0 NOTICE duty: the vendored license must ship.
  const license = [...paths].find((path) => path.endsWith('chart/vendor/LICENSE'))
  assert.ok(license, 'vendored 图表库的 LICENSE 必须随包发布')

  // `dsh.bundle.patch` is an array (host patch + preset declaration line); a missing entry leaves the preset unregistered.
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const declared = manifest.dsh?.bundle?.patch
  const patches = Array.isArray(declared) ? declared : declared ? [declared] : []
  assert.ok(patches.length >= 2, `预设行搬到 agent.patch.yml 后，patch 至少要有两颗文件，实际：${patches.join(', ') || '(空)'}`)
  for (const relative of patches) {
    const packed = relative.replace(/^\.\//, '')
    assert.ok(paths.has(packed), `dsh.bundle.patch 指向的 ${packed} 不在发布清单里（装配整行会静默不生效）`)
  }

  // Reverse gate: local dev docs must not ship (second gate after .gitignore).
  for (const path of paths) {
    assert.equal(path.startsWith('docs/'), false, `研发文档不应随包发布：${path}`)
  }
  t.diagnostic(`发布清单 ${paths.size} 个文件`)
})

test('打包闸门：selected-skills 的运行时半边逐条落在发布清单里', async () => {
  // The provider imports the catalog by in-package relative path and derives each skills root from it
  // (src/agents/selected-skills-provider.ts): a missing entry only shows as "checked, never appears".
  const paths = packedFilePaths()
  const { SELECTED_SKILL_CATALOG, SELECTED_SKILL_SKILL_DIRS } = await import('../selected-skills/catalog.js')
  assert.ok(SELECTED_SKILL_CATALOG.length >= 1, 'catalog 一条都没有，这条闸门就变成空断言了')

  for (const required of ['selected-skills/catalog.js', 'selected-skills/filter.js', 'selected-skills/routing.js', 'selected-skills/README.md']) {
    assert.ok(paths.has(required), `发布清单里缺少 ${required}（settings 卡片与 provider 都 import catalog / routing）`)
  }

  // Every catalog repository needs a registered skills root, or the provider cannot resolve its path.
  for (const entry of SELECTED_SKILL_CATALOG) {
    assert.ok(SELECTED_SKILL_SKILL_DIRS[entry.repository],
      `catalog 条目 ${entry.key} 的仓库 ${entry.repository} 没有 skills 根登记（SELECTED_SKILL_SKILL_DIRS）`)
  }

  for (const entry of SELECTED_SKILL_CATALOG) {
    const skillPath = `selected-skills/${entry.repository}/${SELECTED_SKILL_SKILL_DIRS[entry.repository]}/${entry.name}/SKILL.md`
    assert.ok(paths.has(skillPath),
      `catalog 登记了 ${entry.key}（${entry.name}），但包里找不到 ${skillPath} —— 用户勾上这一格也不会生效`)
  }

  // MIT snapshots ship with their license and provenance record (see selected-skills/README.md).
  const repositories = [...new Set(SELECTED_SKILL_CATALOG.map((entry) => entry.repository))]
  for (const repository of repositories) {
    for (const provenance of ['LICENSE', 'UPSTREAM.md']) {
      const path = `selected-skills/${repository}/${provenance}`
      assert.ok(paths.has(path), `上游快照的 ${path} 必须随包发布（MIT 的署名义务与"哪个 commit"的溯源）`)
    }
  }

  // Runtime tree allowlist: the package carries provenance plus the Markdown a role can actually
  // load — catalog skill bodies and the `shared/` reference bodies those bodies link to. Scripts,
  // evaluation fixtures, upstream docs and non-catalog skills all fail here, not just "most" of them.
  const rootFiles = new Set([
    'selected-skills/catalog.js',
    'selected-skills/filter.js',
    'selected-skills/routing.js',
    'selected-skills/README.md',
    'selected-skills/ROUTING.md',
  ])
  const allowedRuntime = (path) => {
    if (!path.startsWith('selected-skills/')) return true
    if (rootFiles.has(path)) return true
    if (path.startsWith('selected-skills/china-stock-research-skills/skills/shared/')) return path.endsWith('.md')
    if (/^selected-skills\/[^/]+\/(?:LICENSE|UPSTREAM\.md)$/.test(path)) return true
    for (const entry of SELECTED_SKILL_CATALOG) {
      const prefix = `selected-skills/${entry.repository}/${SELECTED_SKILL_SKILL_DIRS[entry.repository]}/${entry.name}/`
      if (path.startsWith(prefix)) return path.endsWith('.md')
    }
    return false
  }
  const strays = [...paths].filter((path) => !allowedRuntime(path)).sort()
  assert.deepEqual(strays, [],
    '发布包里出现运行时树之外的文件（脚本、评测夹具、非 catalog skill、reference-algorithms 都算）：\n'
    + strays.join('\n'))
})

test('打包闸门：声明 dsh.client 的包，其客户端 bundle 必须真的在包里', () => {
  // Check the main package and every nested package: a missing client bundle stops the web profile.
  const manifests = ['package.json', 'chart-ui/package.json', 'config/package.json', 'watchlist/package.json']
  const paths = packedFilePaths()
  let checked = 0

  for (const relativeManifest of manifests) {
    const manifest = JSON.parse(readFileSync(join(ROOT, relativeManifest), 'utf8'))
    if (manifest.dsh?.client === undefined) continue
    checked += 1

    const relative = manifest.exports?.['./client']
    const resolved = typeof relative === 'string' ? relative : relative?.default
    assert.equal(typeof resolved, 'string', `${manifest.name} 声明了 dsh.client 就必须有 exports["./client"]`)

    const owner = dirname(relativeManifest)
    const onDisk = join(ROOT, owner, resolved)
    assert.ok(existsSync(onDisk), `exports["./client"] 指向的文件不存在：${owner}/${resolved}`)

    // Compare in posix form: `npm pack --json` always returns `/` paths, join() uses the host separator.
    const packedPath = join(owner, resolved).replace(/^\.\//, '').split(sep).join('/')
    assert.ok(paths.has(packedPath), `${packedPath} 不在发布清单里；bundle 缺失会让整个 web profile 起不来`)
  }

  assert.ok(checked >= 1, '至少 chart-ui 应声明 dsh.client；一个都没检查到说明测试失效了')
})

// Plugin display name = meta.title from <package>/locale/<language>.json; all three links fail silently.
// en.json is the entry the host scans for, every other *.json must be a valid language id (one stray file
// voids the whole meta), and reads target exported resources — `exports` / `files` omissions bite only after install.
test('插件显示名：根包 locale meta 必须能被宿主读到，且 README 指路的名字跟着它', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(manifest.exports?.['./locale/*.json'], './locale/*.json',
    '宿主用 ESM 解析器读 <包名>/locale/<语言>.json；exports 漏这条 = 显示名静默回落成 npm 包名')
  assert.ok((manifest.files ?? []).includes('locale'),
    'files 里没有 locale：发出去的包不带它，安装侧同样静默回落')

  const files = readdirSync(join(ROOT, 'locale')).filter((name) => name.endsWith('.json'))
  assert.ok(files.includes('en.json'), '缺 locale/en.json —— 它是宿主扫目录的入口，缺它则所有语言都不生效')
  for (const name of files) {
    assert.match(name, /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*\.json$/u,
      `locale/${name} 的文件名不是语言 id：宿主对整份 meta 抛错并回落到包名`)
    const meta = JSON.parse(readFileSync(join(ROOT, 'locale', name), 'utf8')).meta
    assert.ok(typeof meta?.title === 'string' && meta.title.trim() !== '', `locale/${name} 缺少非空 meta.title`)
    assert.ok(typeof meta?.description === 'string' && meta.description.trim() !== '', `locale/${name} 缺少非空 meta.description`)
  }

  const paths = packedFilePaths()
  for (const name of files) {
    assert.ok(paths.has(`locale/${name}`), `locale/${name} 不在发布清单里（files 是否漏了 locale？）`)
  }

  // Cards draw only meta.title, so the README must not send users looking for the npm package name.
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  assert.ok(!/已安装的\s*`@v587d\/capital-generation`/u.test(readme),
    'README 还在让用户到「已安装」列表里找 npm 包名，但卡片显示的是 locale meta.title')
  assert.match(readme, /已安装的 \*\*Capital Generation\*\*/u,
    'README 的指路措辞要与卡片显示名同源（zh 界面是 meta.title「Capital Generation（证券研究）」的前半）')
})

test('打包闸门：第三方清单点名的文件必须真的随包发布', () => {
  // The notices file is the only external answer for "whose work, what license": ask the packer about every path it names.
  const notices = readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  // Backticks also hold npm package names like `@deepseek-ai/cordis`: slashed, but not repo paths.
  const named = [...new Set(
    [...notices.matchAll(/`([^`]+)`/g)]
      .map((match) => match[1])
      .filter((value) => value.includes('/') && !value.startsWith('@') && !value.includes(' ')),
  )]
  assert.ok(named.length >= 3, `第三方清单只点名了 ${named.length} 个仓内路径，多半是格式被改坏了`)
  const paths = packedFilePaths()
  // The notices also documents the one git-only area (reference implementations): it names it on
  // purpose, so exempt exactly that path and keep every other named path verified against the packer.
  const GIT_ONLY = ['selected-skills/reference-algorithms/']
  const missing = named.filter((value) => !GIT_ONLY.includes(value) && !paths.has(value))
  assert.deepEqual(missing, [], `第三方清单点名了不随包发布的路径：${missing.join(', ')}`)
})
