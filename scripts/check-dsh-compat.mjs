#!/usr/bin/env node
/**
 * DSH 接口契约探针。
 *
 * 背景：dsh 处于快速迭代期，本插件对上游的依赖面必须**可探测**，而不是等运行时
 * 静默失效。本脚本对**本机已安装的 dsh**逐条断言 docs/reference/dsh-surface-ledger.md
 * 里的接口账本；上游漂移在这里变成一条点名"哪个接口 / 期望什么 / 现在是什么"的失败，
 * 而不是"图表某天不显示了"。
 *
 * 同型先例：test/persona.test.mjs 的「字段契约跟随本机版本」用例（历史教训：
 * dsh-persona 的字段改名叠加正文重写，让 8 个用例长期失败而无人察觉）。
 *
 * 用法：
 *   npm run check:dsh
 *   DSH_PACKAGE_DIR=/path/to/@deepseek-ai/dsh npm run check:dsh
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const PASS = 'pass'
const FAIL = 'fail'
const NA = 'n/a'

/** 在 PATH 里找 dsh 可执行文件，回溯到它的包根（bin 指向 <pkg>/lib/bin.js）。 */
function locateDshPackage() {
  if (process.env.DSH_PACKAGE_DIR) return process.env.DSH_PACKAGE_DIR
  const isWin = process.platform === 'win32'
  for (const dir of (process.env.PATH ?? '').split(isWin ? ';' : ':')) {
    if (!dir) continue
    for (const name of isWin ? ['dsh.cmd', 'dsh'] : ['dsh']) {
      const candidate = join(dir, name)
      if (!existsSync(candidate)) continue
      let current = dirname(realpathSync(candidate))
      for (let depth = 0; depth < 4; depth += 1) {
        const manifest = join(current, 'package.json')
        if (existsSync(manifest)) {
          try {
            if (JSON.parse(readFileSync(manifest, 'utf8')).name === '@deepseek-ai/dsh') return current
          } catch {
            // 继续向上找
          }
        }
        current = dirname(current)
      }
    }
  }
  return undefined
}

const DSH_DIR = locateDshPackage()
if (!DSH_DIR) {
  console.error('check-dsh-compat: 找不到已安装的 dsh。把它的包目录写进 DSH_PACKAGE_DIR 后重试，例如：')
  console.error('  DSH_PACKAGE_DIR=$(dirname $(dirname $(readlink -f $(which dsh)))) npm run check:dsh')
  process.exit(2)
}

const PKG = (name) => join(DSH_DIR, 'node_modules', '@deepseek-ai', name)
/** 读文本；文件不存在返回 undefined（探针据此报 fail 并说明缺了什么）。 */
function readIfPresent(path) {
  try {
    if (!statSync(path).isFile()) return undefined
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** 探头：一个接口一条，返回 { id, title, status, detail }。 */
const probes = [
  {
    id: 'L1',
    title: 'dsh.client 声明字段（platform / inject / external / immediately）',
    why: '我们给图表 UI 包声明浏览器半边就靠这四个字段；改名会让 bundle 静默不进 __DSH_BOOT__。',
    run() {
      const file = join(PKG('dsh-package-manifest'), 'lib/types/types.d.ts')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}` }
      const fields = ['platform', 'inject', 'external', 'immediately']
      const missing = fields.filter((field) => !new RegExp(`\\b${field}\\??:`).test(text))
      return missing.length === 0
        ? { status: PASS, detail: `dsh-package-manifest 仍声明 ${fields.join(' / ')}` }
        : { status: FAIL, detail: `dsh-package-manifest 不再声明字段：${missing.join(' / ')}（文件 ${file}）` }
    },
  },
  {
    id: 'L2',
    title: '声明 dsh.client 的包（主包与随包携带的嵌套包），exports["./client"] 必须真实存在且在 files 里',
    why: 'bundle 缺失会让 ClientPackageCompositionError 在注册表构造时抛出——整个 web profile 起不来，不是图表坏掉。',
    run() {
      const manifests = ['package.json', 'chart-ui/package.json']
      const declared = []
      for (const relativeManifest of manifests) {
        const manifestPath = join(process.cwd(), relativeManifest)
        if (!existsSync(manifestPath)) continue
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (manifest.dsh?.client === undefined) continue
        declared.push(relativeManifest)
        const owner = dirname(relativeManifest)
        const relative = manifest.exports?.['./client']
        const resolved = typeof relative === 'string' ? relative : relative?.default
        if (typeof resolved !== 'string') return { status: FAIL, detail: `${relativeManifest}: 声明了 dsh.client 却没有 exports["./client"]` }
        if (!existsSync(join(process.cwd(), owner, resolved))) {
          return { status: FAIL, detail: `${relativeManifest}: exports["./client"] 指向的文件不存在：${resolved}` }
        }
        // 嵌套包由主包的 files 决定是否随包发布，所以两种归属都要认。
        const rootManifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
        const packedPath = join(owner, resolved).replace(/^\.\//, '')
        const shipped = (manifest.files ?? []).some((entry) => resolved === entry || resolved.startsWith(`${entry}/`))
          || (rootManifest.files ?? []).some((entry) => packedPath === entry || packedPath.startsWith(`${entry}/`))
        if (!shipped) return { status: FAIL, detail: `${packedPath} 存在但不在 files 列表里，发布后客户端 bundle 会丢失` }
      }
      return declared.length === 0
        ? { status: NA, detail: '本仓当前没有声明 dsh.client 的包' }
        : { status: PASS, detail: `${declared.join(' / ')} 的客户端 bundle 都存在且会随包发布` }
    },
  },
  {
    id: 'L3',
    title: '客户端 Slot 注册协议 slots.inject(name, cb) + slots.register({name,key}, Component)',
    why: '图表 view 挂在会话作用域的 keyed slot 上，注册协议变了图就不渲染。',
    run() {
      const file = join(PKG('dsh-client-ui-tool'), 'lib/client.js')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}` }
      const hasInject = /slots\.inject\(/.test(text)
      const hasRegister = /slots\.register\(\{/.test(text)
      if (hasInject && hasRegister) return { status: PASS, detail: 'shipped bundle 仍用 slots.inject + slots.register({...}, Component)' }
      return { status: FAIL, detail: `协议形状变了（slots.inject=${hasInject}, slots.register({...})=${hasRegister}），文件 ${file}` }
    },
  },
  {
    id: 'L4',
    title: 'Slot key tool.call.toolview 与 ToolCallOwnerProps 字段',
    why: '这是我们唯一的对话流内嵌座位；key 或 props 改名，图卡片会静默回退成通用工具行。',
    run() {
      const file = join(PKG('dsh-client-ui-tool'), 'lib/client.js')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}` }
      if (!text.includes('tool.call.toolview')) return { status: FAIL, detail: `shipped bundle 里已搜不到 slot key "tool.call.toolview"（文件 ${file}）` }
      const props = ['callId', 'toolName', 'openFile', 'cwd']
      const missing = props.filter((prop) => !new RegExp(`\\b${prop}\\b`).test(text))
      return missing.length === 0
        ? { status: PASS, detail: `tool.call.toolview 仍在，owner props ${props.join(' / ')} 均可解析` }
        : { status: FAIL, detail: `owner props 改名或消失：${missing.join(' / ')}` }
    },
  },
  {
    id: 'L5',
    title: 'react / react/jsx-runtime 仍是 shell 静态种子',
    why: '客户端 bundle 以 require("react") 取壳实例；种子词消失会让 bundle 在浏览器里 require 失败。',
    run() {
      const file = join(PKG('dsh-client-ui-tool'), 'lib/client.js')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}` }
      const missing = ['react', 'react/jsx-runtime'].filter((spec) => !text.includes(`require("${spec}")`))
      return missing.length === 0
        ? { status: PASS, detail: 'react 与 react/jsx-runtime 仍是可 require 的种子词' }
        : { status: FAIL, detail: `shipped bundle 不再 require：${missing.join(' / ')}` }
    },
  },
  {
    id: 'L6',
    title: 'host 侧 webServer.register({ kind, path, handler })',
    why: '图表序列走我们自己的 HTTP 路由（数据不进模型上下文）；签名变了取数通道就断。',
    run() {
      const file = join(PKG('dsh-host-webserver'), 'lib/types/index.d.ts')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}` }
      const checks = [
        ['register(route: WebRoute)', /register\(\s*route:\s*WebRoute\s*\)/],
        ["kind: WebRouteKind", /kind:\s*WebRouteKind/],
        ['WebRouteKind = exact | prefix', /WebRouteKind\s*=\s*'exact'\s*\|\s*'prefix'/],
      ]
      const missing = checks.filter(([, pattern]) => !pattern.test(text)).map(([label]) => label)
      return missing.length === 0
        ? { status: PASS, detail: 'register(route: WebRoute) 与 exact|prefix 仍在' }
        : { status: FAIL, detail: `签名或类型变了：${missing.join(' / ')}` }
    },
  },
  {
    id: 'L7',
    title: '主题仍是 CSS 变量（--dsw-alias-*），无需 theme API',
    why: '我们主动把主题依赖降成纯 CSS 变量；若变量前缀改名，图表会与壳的明暗主题脱节。',
    run() {
      const file = join(PKG('dsh-client-ui-tool'), 'lib/client.js')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}` }
      return text.includes('--dsw-')
        ? { status: PASS, detail: 'shipped CSS 仍以 --dsw-* 变量取主题' }
        : { status: FAIL, detail: 'shipped bundle 里已搜不到 --dsw-* 变量前缀' }
    },
  },
  {
    id: 'L8',
    title: '本仓「工具 parameters 根必须是 object」不变量',
    why: '2026-09-14 事故：根级 oneOf 让每个 Capital 会话在第 1 轮第 1 步整体 400。',
    run() {
      return { status: NA, detail: '由 test/apply-integration.test.mjs 覆盖（npm test）；此处不重复断言' }
    },
  },
  {
    id: 'L9',
    title: 'Loader 行名三条规则：name 不插值 / 只认精确包名或 path-like / 相对基址是 patch 所在目录',
    why: 'capital-charts 行依赖这三条同时成立：用 !!js 会让 profile 起不来，用 subpath 会让客户端半边静默消失，相对基址变了会让行解析不到。',
    run() {
      const modulesFile = join(PKG('dsh-client-modules'), 'lib/index.js')
      const modules = readIfPresent(modulesFile)
      if (modules === undefined) return { status: FAIL, detail: `读不到 ${modulesFile}` }
      const includeFile = join(PKG('cordis-plugin-include'), 'lib/index.js')
      const include = readIfPresent(includeFile)
      if (include === undefined) return { status: FAIL, detail: `读不到 ${includeFile}` }

      const checks = [
        { label: 'locatePkgJson', pattern: /locatePkgJson/, text: modules, file: modulesFile },
        { label: 'path-like 判定（startsWith("file:") / isAbsolute）', pattern: /startsWith\("file:"\)|isAbsolute\(loaderName\)/, text: modules, file: modulesFile },
        { label: '按最近 package.json 认定包名（nearestPackage）', pattern: /nearestPackage/, text: modules, file: modulesFile },
        { label: 'include 把相对基址设为 patch 文件所在目录', pattern: /ctx\.baseUrl\s*=\s*new URL\(/, text: include, file: includeFile },
      ]
      const missing = checks.filter((check) => !check.pattern.test(check.text)).map((check) => `${check.label}（${check.file}）`)
      return missing.length === 0
        ? { status: PASS, detail: '行名解析的三条规则都还在（name 字面量 + path-like + patch 目录基址）' }
        : { status: FAIL, detail: `行名解析规则变了：${missing.join(' / ')}（cordis.patch.yml 的 capital-charts 行依赖它；见账本 L9 的三条规则）` }
    },
  },
]

const results = []
for (const probe of probes) {
  let outcome
  try {
    outcome = probe.run()
  } catch (error) {
    outcome = { status: FAIL, detail: `探针自身抛错：${error instanceof Error ? error.message : String(error)}` }
  }
  results.push({ ...probe, ...outcome })
}

const label = { [PASS]: 'PASS', [FAIL]: 'FAIL', [NA]: ' n/a' }
console.log(`check-dsh-compat: dsh @ ${DSH_DIR}`)
console.log('')
for (const result of results) {
  console.log(`  [${label[result.status]}] ${result.id}  ${result.title}`)
  console.log(`         ${result.detail}`)
  if (result.status === FAIL) console.log(`         为什么重要：${result.why}`)
}

const failures = results.filter((result) => result.status === FAIL)
console.log('')
if (failures.length > 0) {
  console.error(`check-dsh-compat: ${failures.length} 个接口契约失配（${failures.map((f) => f.id).join(', ')}）。`)
  console.error('处理顺序：先读 docs/reference/dsh-surface-ledger.md 找到对应接口的修复位置，')
  console.error('再改本仓的 adapter，不要先改测试。')
  process.exit(1)
}
console.log(`check-dsh-compat: ${results.length} 条接口账本全部通过。`)
