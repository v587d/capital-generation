import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { locateNpmCli } from '../scripts/lib/run-tool.mjs'

/**
 * 打包闸门。
 *
 * 为什么必须有这条测试：浏览器侧的静态资源（vendored 图表库）**不会**被 tsc 搬运，
 * 漏掉的表现不是"图表难看"，而是运行时 `loadVendoredChartLibrary()` 抛错、
 * 图表 HTML 里少一段脚本。而将来 Step 3 的客户端 bundle 一旦漏发，
 * 上游会以 `ClientPackageCompositionError` 让**整个 web profile 起不来**。
 *
 * 所以这里断言的不是"文件存在"，而是"**发布出去的那个包里**文件存在"——用
 * `npm pack --dry-run --json` 的实际文件清单，而不是源码目录里看一眼。
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function packedFilePaths() {
  // 不经 shell 启动 npm：Windows 上 `npm` 是 `.cmd` 垫片，`spawnSync('npm')` → ENOENT 且
  // `stderr` 是空的（原断言只插值 stderr，于是失败被报成一句没有原因的话）；
  // `spawnSync('npm.cmd')` → EINVAL；`shell: true` 配 args 是 DEP0190 弃用形态。
  // npm 本身就是 Node CLI，所以直接交给当前进程的 node 跑它的 cli.js。
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
    'capital-config/package.json',
    'capital-config/index.js',
    'capital-config/client.js',
    'capital-watchlist/package.json',
    'capital-watchlist/index.js',
    'capital-watchlist/client.js',
    'preset/capital-generation/agent.patch.yml',
    'preset/capital-generation/skills/capital-chart-protocol/SKILL.md',
    'cordis.patch.yml',
  ]) {
    assert.ok(paths.has(required), `发布清单里缺少 ${required}（npm run build 是否跑过？files 列表是否漏了？）`)
  }

  // 许可证必须随包发布：Apache-2.0 的 NOTICE 义务。
  const license = [...paths].find((path) => path.endsWith('chart/vendor/LICENSE'))
  assert.ok(license, 'vendored 图表库的 LICENSE 必须随包发布')

  // `dsh.bundle.patch` 现在是**数组**（主 patch + 预设声明行）：漏发其中任何一个的表现不是
  // 报错，而是"预设根本没注册"——历史会话恢复时 Unknown agent preset。
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const declared = manifest.dsh?.bundle?.patch
  const patches = Array.isArray(declared) ? declared : declared ? [declared] : []
  assert.ok(patches.length >= 2, `预设行搬到 agent.patch.yml 后，patch 至少要有两颗文件，实际：${patches.join(', ') || '(空)'}`)
  for (const relative of patches) {
    const packed = relative.replace(/^\.\//, '')
    assert.ok(paths.has(packed), `dsh.bundle.patch 指向的 ${packed} 不在发布清单里（装配整行会静默不生效）`)
  }

  // 反向断言：本地研发文档不进包（.gitignore 之外的第二道闸门）。
  for (const path of paths) {
    assert.equal(path.startsWith('docs/'), false, `研发文档不应随包发布：${path}`)
  }
  t.diagnostic(`发布清单 ${paths.size} 个文件`)
})

test('打包闸门：声明 dsh.client 的包，其客户端 bundle 必须真的在包里', () => {
  // 主包与随包携带的嵌套包都要查：漏发 chart-ui/client.js 会让整个 web profile 起不来。
  const manifests = ['package.json', 'chart-ui/package.json', 'capital-config/package.json', 'capital-watchlist/package.json']
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

    // 发布清单这一侧只用 posix 比：`npm pack --json` 返回的是 `chart-ui/client.js`，而
    // join() 给本机分隔符——Windows 上 has() 永远落空（2026-09-30 双端 CI 实测的唯一红）。
    const packedPath = join(owner, resolved).replace(/^\.\//, '').split(sep).join('/')
    assert.ok(paths.has(packedPath), `${packedPath} 不在发布清单里；bundle 缺失会让整个 web profile 起不来`)
  }

  assert.ok(checked >= 1, '至少 chart-ui 应声明 dsh.client；一个都没检查到说明测试失效了')
})

/**
 * 插件显示名的闸门（账本 L25）。
 *
 * 卡片与详情页主标题的唯一来源是宿主按 `<包名>/locale/<语言>.json` 读到的 `meta.title`，
 * 而这条链**三个断点全都静默**（症状一律是"又变回 @v587d/capital-generation 了"）：
 *  1. `en.json` 是宿主扫目录的**入口**——解析不到它就根本不读这个目录（`readPluginMeta` 里
 *     `englishPath === undefined ? new Map() : dictionariesOf(englishPath, …)`），只加 `zh.json` 等于没加。
 *  2. 目录里**每一个** `*.json` 都要按语言 id 命名且能解析；多一个无关文件就让整份 meta
 *     变成 `{ error }`，显示名整体回落且不报错。
 *  3. 读的是**导出资源**不是磁盘路径：漏 `exports["./locale/*.json"]` 或 `files` 里的 `locale`，
 *     本地跑得好、装出去就没有。
 */
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

  // 卡片只画 meta.title，npm 包名从此不再出现在「已安装」列表里 —— README 让用户找包名就是错的路标。
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  assert.ok(!/已安装的\s*`@v587d\/capital-generation`/u.test(readme),
    'README 还在让用户到「已安装」列表里找 npm 包名，但卡片显示的是 locale meta.title')
  assert.match(readme, /已安装的 \*\*Capital Generation\*\*/u,
    'README 的指路措辞要与卡片显示名同源（zh 界面是 meta.title「Capital Generation（证券研究）」的前半）')
})
