#!/usr/bin/env node
/**
 * Probes the installed dsh against docs/reference/dsh-surface-ledger.md, turning upstream drift into
 * a named failure instead of a silent runtime break. DSH_PACKAGE_DIR overrides the install location.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { locateDshPackage } from './lib/run-tool.mjs'

const PASS = 'pass'
const FAIL = 'fail'
const NA = 'n/a'

/** Repo root: L25 reads our own plugin metadata through the host's meta reader. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// One dsh locator only (scripts/lib/run-tool.mjs); two finders drift.

const DSH_DIR = locateDshPackage()
if (!DSH_DIR) {
  console.error('check-dsh-compat: 找不到已安装的 dsh。把它的包目录写进 DSH_PACKAGE_DIR 后重试，例如：')
  console.error('  DSH_PACKAGE_DIR=$(dirname $(dirname $(readlink -f $(which dsh)))) npm run check:dsh')
  process.exit(2)
}

const PKG = (name) => join(DSH_DIR, 'node_modules', '@deepseek-ai', name)
/** Reads text, undefined when absent, so probes can name the missing path. */
function readIfPresent(path) {
  try {
    if (!statSync(path).isFile()) return undefined
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Since 0.2.1 the ui-primitives / ui-slots packages are bundled into dsh-web-frontend/dist, so probes
 * measuring their .d.ts / CSS would stay red; mark them n/a only when the frontend confirms it.
 */
const BUNDLED_UI_REASON = (() => {
  try {
    const frontendManifest = JSON.parse(readFileSync(join(PKG('dsh-web-frontend'), 'package.json'), 'utf8'))
    const devDependencies = frontendManifest.devDependencies ?? {}
    const packages = ['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots']
    if (!packages.every((name) => typeof devDependencies[name] === 'string')) return undefined
    if (!packages.every((name) => !existsSync(join(DSH_DIR, 'node_modules', name)))) return undefined
    if (!existsSync(join(PKG('dsh-web-frontend'), 'dist', 'assets'))) return undefined
    return `0.2.1 起 ${packages.join(' / ')} 编进 dsh-web-frontend/dist（devDependencies ${packages.map((name) => devDependencies[name]).join(' / ')}），不再有各自可读的 .d.ts / CSS / index.js；本探针在 0.2.1 标 n/a，升级到重新拆包的版本会恢复实测`
  } catch {
    return undefined
  }
})()
const BUNDLED_UI_PROBES = new Set(['L15', 'L19', 'L22', 'L23', 'L24', 'L26', 'L27', 'L28'])

/** One probe per surface, returning { id, title, status, detail }. */
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
      const manifests = ['package.json', 'chart-ui/package.json', 'config/package.json', 'watchlist/package.json']
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
        // Nested packages ship via the root package's files list, so accept either owner.
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
    id: 'L10',
    title: 'Slot conversation.chat.turnTail + TurnTailOwnerProps',
    why: '该槽本是为「最终图表落在收尾正文之后」而接的官方 turn-tail 扩展面。',
    run() {
      // Retired with the turn-tail channel (AGENTS.md §7): we consume no part of it, so its shape
      // drift must not turn check:dsh red. test/chart-client.test.mjs keeps the client scope honest.
      return { status: NA, detail: '本包已摘除 turn-tail 通道（AGENTS.md §7），该面不再消费；探针退休' }
    },
  },
  {
    id: 'L11',
    title: '会话日志 first-party 事件（Session.append）+ ctx.sessions.get + sessionProjections.stateOf',
    why: '图表以官方 `deliverables/presented` 登记为本轮交付（2026-09-18 起不再自造事件类型）；append 变成 surface-only、`deliverables/presented` 掉出已知词汇表、deriveEventMessage 开始透传未知类型（污染上下文）、或 stateOf 改名，都会静默失效。',
    run() {
      const sessionFile = join(PKG('dsh-session'), 'lib/index.js')
      const session = readIfPresent(sessionFile)
      if (session === undefined) return { status: FAIL, detail: `读不到 ${sessionFile}` }
      const projectionFile = join(PKG('dsh-session-projection'), 'lib/index.js')
      const projection = readIfPresent(projectionFile)
      if (projection === undefined) return { status: FAIL, detail: `读不到 ${projectionFile}` }

      const checks = [
        ['Session.append(type, data)', /append\(type, data/, session, sessionFile],
        ['ctx.sessions 服务', /super\(ctx, "sessions"\)/, session, sessionFile],
        ['sessions.get(id)', /get\(id\)/, session, sessionFile],
        ['非 surface 事件不进消息历史（deriveEventMessage default: return null）', /default: return null/, session, sessionFile],
        ['sessionProjections.stateOf(session, key)', /stateOf\(/, projection, projectionFile],
        // Key invariant: the delivery event must stay in the closed vocabulary, or written logs are
        // rejected at cold load and the whole session becomes unopenable.
        ['deliverables/presented 属于 KNOWN_SESSION_EVENT_TYPES', /"deliverables\/presented"/, session, sessionFile],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: 'append / sessions.get / stateOf 都还在，deliverables/presented 仍在闭集词汇表内，非 surface 事件不进消息历史' }
        : { status: FAIL, detail: `图表交付通道的接口变了：${missing.join(' / ')}（见账本 L11）` }
    },
  },
  {
    id: 'L12',
    title: 'agent/created（Scoped<Agent>）+ agent.ctx + tools.restrict 的 scoped 语义（根侧 deny / 角色侧逐名兄弟 deny）',
    why: '根 Agent 的出图入口、以及 0.2.1 起每颗角色残留的那一格（D0 之后工具面由 preset 挂的行组合表达，'
      + '运行期只剩 `tool-subagent-control` 焊进来的 `interrupt_agent` 要靠 restrict 减掉），都只能靠"在它自己的'
      + ' agent scope 上 restrict"来实现；事件消失、agent.ctx 不可用、restrict 变成 context-global，'
      + '或"restriction 只过滤继承层"这条语义反转，都会让主 Agent 重新拿到出图工具、或让那一次 deny 静默不生效'
      + '（角色看得见本该减掉的名字）。'
      + '同一颗探针还断言委派行**不再**接受 `persona` / `toolFilter`——0.2.1 起"按名字划工具面"在装配层没有格子，'
      + '这正是 D0 把工具面搬到行组合、只保留这一格残留的理由。',
    run() {
      const agentTypes = join(PKG('dsh-agent'), 'lib/types/runtime-types.d.ts')
      const types = readIfPresent(agentTypes)
      if (types === undefined) return { status: FAIL, detail: `读不到 ${agentTypes}` }
      const toolsFile = join(PKG('dsh-tools'), 'lib/index.js')
      const tools = readIfPresent(toolsFile)
      if (tools === undefined) return { status: FAIL, detail: `读不到 ${toolsFile}` }
      const subagentFile = join(PKG('dsh-tool-subagent'), 'lib/index.js')
      const subagent = readIfPresent(subagentFile)
      if (subagent === undefined) return { status: FAIL, detail: `读不到 ${subagentFile}` }

      const checks = [
        ["'agent/created'(this: Scoped<Agent>, payload: { agent })", /'agent\/created'\(this: Scoped<Agent>/, types, agentTypes],
        ['payload 带 agent（监听器据此拿 agent.ctx）', /'agent\/created'\(this: Scoped<Agent>, payload: \{[\s\S]{0,120}agent: Agent/, types, agentTypes],
        ['tools.restrict() 要求 scoped context（agent.ctx）', /tools\.restrict\(\) requires a scoped context/, tools, toolsFile],
        ['restrict 走 layer.restrictions.append（作用域层过滤）', /layer\.restrictions\.append\(compiled\)/, tools, toolsFile],
        ['restriction 只过滤继承层，不碰本层自注册（逐名 deny 不误伤本行注册工具的前提）', /A restriction filters what a scope inherits[\s\S]{0,160}never what its OWN layer registers/, tools, toolsFile],
        ['preset 的工具对 agent scope 是"祖先贡献"（角色侧那份 deny 筛得掉它们的依据）', /presets moved them onto the agent plane they became an ANCESTOR[\s\S]{0,80}contribution/, tools, toolsFile],
        // 0.1.7: dsh-agent-presets was replaced by agent-preset-registry; dsh-tool-subagent is the
        // current user of the same invariant (it scopes the created agent's own ctx, not ctx.root).
        ['上游自己在 agent/created 里拿 created agent', /"agent\/created",\s*(?:async\s*)?\(\{ agent/, subagent, subagentFile],
        ['并经由该 agent 自己的 ctx 注入 scoped 运行时', /\w\.ctx\.inject\(\[/, subagent, subagentFile],
        ['0.2.1 起委派行拒绝 persona / toolFilter（名字级收敛只剩 agent scope 这一格）', /const field of \["persona", "toolFilter"\][\s\S]{0,200}is no longer supported/, subagent, subagentFile],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: 'agent/created + agent.ctx + scoped restrict 仍可用（根收敛与角色那格兄弟 deny 共用这一格，委派行已不接受 toolFilter）' }
        : { status: FAIL, detail: `工具面收敛机制的接口变了：${missing.join(' / ')}（见账本 L12）` }
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
  {
    id: 'L14',
    title: "agent/turn-stopping（该轮即将关闭，轮仍打开）→ 决定交付行落在哪一轮",
    why: '图表在回合之间产生时要寄存，等 owner 那一轮**即将关闭**再写；若退回"下一次 turn/start 就写"，'
      + '交付行会落进空的过程轮（2026-09-20 实测 session 38bad3f9：落进 turn 5，总结答复在 turn 6）。'
      + '事件名消失，或派发点被挪到 turn/end 之后（此时轮已关闭、append 会挂到下一轮），本仓都不再有正确落点。',
    run() {
      const typesFile = join(PKG('dsh-agent'), 'lib/types/runtime-types.d.ts')
      const types = readIfPresent(typesFile)
      if (types === undefined) return { status: FAIL, detail: `读不到 ${typesFile}` }
      const loopFile = join(PKG('dsh-agent-loop'), 'lib/index.js')
      const loop = readIfPresent(loopFile)
      if (loop === undefined) return { status: FAIL, detail: `读不到 ${loopFile}` }

      const checks = [
        ["声明 'agent/turn-stopping'", /'agent\/turn-stopping'\(/, types, typesFile],
        ['payload 带 turn（交付行归属轮号）', /'agent\/turn-stopping'\(this: Scoped<Agent>, payload: \{[\s\S]{0,160}turn: number/, types, typesFile],
        ['@mode serial（轮仍打开时同步派发）', /@mode serial[\s\S]{0,600}'agent\/turn-stopping'\(/, types, typesFile],
        ['agent loop 真的派发它', /dispatch\.serial\("agent\/turn-stopping"/, loop, loopFile],
        // Order matters: must precede append("turn/end"), after which the turn is closed.
        ['派发在 turn/end 之前', /dispatch\.serial\("agent\/turn-stopping"[\s\S]{0,1200}session\.append\("turn\/end"/, loop, loopFile],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: 'agent/turn-stopping 仍在 turn/end 之前派发，交付行有正确落点' }
        : { status: FAIL, detail: `交付行的落点钩子变了：${missing.join(' / ')}（见账本 L14；不要把冲刷退回 turn/start，那会落进过程轮）` }
    },
  },
  {
    id: 'L13',
    title: 'host 侧认证围栏 connection.requestRejection(req) → 401 | 403 | undefined',
    why: '/capital-charts 是自注册的 webServer prefix 路由，Web 载体本身不做认证（认证由 route owner 自负）；'
      + '不接这道围栏，任何本机进程/页面凭 chart_id 就能读会话图表序列（2026-09 review 复现为 200）。',
    run() {
      const file = join(PKG('dsh-client-connection'), 'lib/types/rpc.d.ts')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}` }
      const checks = [
        ['ConnectionRequestRejection = 401 | 403 | undefined', /ConnectionRequestRejection\s*=\s*401\s*\|\s*403\s*\|\s*undefined/],
        ['requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection', /requestRejection\(\s*request:\s*ConnectionTrustRequest\s*\)\s*:\s*ConnectionRequestRejection/],
      ]
      const missing = checks.filter(([, pattern]) => !pattern.test(text)).map(([label]) => label)
      return missing.length === 0
        ? { status: PASS, detail: '认证围栏接口仍在（trusted-Host 403 + 浏览器 cookie 401）' }
        : { status: FAIL, detail: `认证围栏接口变了：${missing.join(' / ')}（见账本 L13；chart-ui 序列路由依赖它，不能退回无认证端点）` }
    },
  },
  {
    id: 'L15',
    title: 'settings / credentials 扩展面：条目 Config 的 .volatile() 投影（ns = 条目 id）+ configForms.get/whileServed + plugins.bundle.config(keyed, key = 包名) + credentials remote',
    why: 'capital-config 是 host 平面 settings 卡片。0.1.7 起命名空间**不再注册**：可编辑面是 profile 条目 Config schema 里 '
      + '.volatile() 字段的投影（`volatileForm` 在一个 volatile 字段都没有时返回 undefined，该条目就**不进** describe 镜像），'
      + '且 `ns` 恒等于 `entry.options.id`；浏览器半边靠 `ctx.configForms.get(条目 id)` 读写、靠 Plugins 页的 keyed 槽 '
      + '`plugins.bundle.config`（key = **组合包包名**，页面按 `pkg.name` 渲染且只给 `view: page`）坐落、靠 '
      + '`remote.credentials.describe/set` 写密钥。条目 id 与包名任一处改名都不报错——卡片静默消失或密钥写不进去，'
      + '用户只会以为"设置里根本没有这个插件"。',
    run() {
      const hostTypesFile = join(PKG('dsh-settings'), 'lib/types/index.d.ts')
      const hostTypes = readIfPresent(hostTypesFile)
      if (hostTypes === undefined) return { status: FAIL, detail: `读不到 ${hostTypesFile}` }
      const hostImplFile = join(PKG('dsh-settings'), 'lib/index.js')
      const hostImpl = readIfPresent(hostImplFile)
      if (hostImpl === undefined) return { status: FAIL, detail: `读不到 ${hostImplFile}` }
      const formFile = join(PKG('dsh-client-ui-settings'), 'lib/types/client/config-form.d.ts')
      const form = readIfPresent(formFile)
      if (form === undefined) return { status: FAIL, detail: `读不到 ${formFile}` }
      const slotFile = join(PKG('dsh-client-ui-plugin-manager'), 'lib/types/client/slot-contract.d.ts')
      const slot = readIfPresent(slotFile)
      if (slot === undefined) return { status: FAIL, detail: `读不到 ${slotFile}` }
      const pmPageFile = join(PKG('dsh-client-ui-plugin-manager'), 'lib/client.js')
      const pmPage = readIfPresent(pmPageFile)
      if (pmPage === undefined) return { status: FAIL, detail: `读不到 ${pmPageFile}` }
      const modelFile = join(PKG('dsh-client-ui-primitives'), 'lib/types/settings-form/form-model.d.ts')
      const model = readIfPresent(modelFile)
      if (model === undefined) return { status: FAIL, detail: `读不到 ${modelFile}` }
      const fieldsFile = join(PKG('dsh-client-ui-primitives'), 'lib/types/settings-form/fields.d.ts')
      const fields = readIfPresent(fieldsFile)
      if (fields === undefined) return { status: FAIL, detail: `读不到 ${fieldsFile}` }
      // The docs link portals into the official head row and positions via element selectors, so
      // that row's DOM/CSS shape is our dependency.
      const widgetsFile = join(PKG('dsh-client-ui-primitives'), 'lib/index.js')
      const widgets = readIfPresent(widgetsFile)
      if (widgets === undefined) return { status: FAIL, detail: `读不到 ${widgetsFile}` }
      const iconsFile = join(PKG('dsh-client-ui-primitives'), 'lib/types/icons/index.d.ts')
      const icons = readIfPresent(iconsFile)
      if (icons === undefined) return { status: FAIL, detail: `读不到 ${iconsFile}` }
      const fieldsCssFile = join(PKG('dsh-client-ui-primitives'), 'lib/settings-form/fields.module.css')
      const fieldsCss = readIfPresent(fieldsCssFile)
      if (fieldsCss === undefined) return { status: FAIL, detail: `读不到 ${fieldsCssFile}` }
      const eventsFile = join(PKG('dsh-api-remotes'), 'lib/types/remote-events.d.ts')
      const events = readIfPresent(eventsFile)
      if (events === undefined) return { status: FAIL, detail: `读不到 ${eventsFile}` }
      const remoteFile = join(PKG('dsh-api-remotes'), 'lib/client.js')
      const remote = readIfPresent(remoteFile)
      if (remote === undefined) return { status: FAIL, detail: `读不到 ${remoteFile}` }

      const checks = [
        // Host half: editability is a schema fact, not a registered namespace.
        ['ctx.settings 服务（SettingsForms）', /settings:\s*SettingsForms/, hostTypes, hostTypesFile],
        ['settings.describe() 返回条目投影', /describe\(options\?: SettingsDescribeOptions\): SettingsDescriptor\[\]/, hostTypes, hostTypesFile],
        ['volatileForm(schema) 仍在', /function volatileForm\(schema\)/, hostImpl, hostImplFile],
        ['没有任何 volatile 字段 ⇒ 条目不进镜像', /Object\.keys\(dict\)\.length === 0 \? void 0 : z\.object\(dict\)/, hostImpl, hostImplFile],
        ['命名空间恒等于 profile 条目 id', /ns: entry\.options\.id/, hostImpl, hostImplFile],
        ['写非 volatile 路径被响亮拒绝', /is not volatile/, hostImpl, hostImplFile],
        // Browser half: find forms by entry id, register behind the served gate.
        ['ctx.configForms.get(entryId)', /get<T>\(entryId: string\): ConfigForm<T>/, form, formFile],
        ['ctx.configForms.whileServed(namespaces, register)', /whileServed\(namespaces: readonly string\[\], register:/, form, formFile],
        ["slot plugins.bundle.config 是 keyed", /'plugins\.bundle\.config':\s*\{\s*kind:\s*'keyed'/s, slot, slotFile],
        ['组合包页面按**包名**渲染配置段，且只给 view: page（不给 form）', /renderSlot\("plugins\.bundle\.config", \{ view: "page" \}, \{ entryKey: pkg\.name \}\)/, pmPage, pmPageFile],
        ['没人按包名注册 ⇒ 整块配置段不出现（座位是注册出来的）', /configured: ledger\.bundles\.has\(openPkg\.name\)/, pmPage, pmPageFile],
        ['包级座位的 key 进 ledger 投影', /bundles: keysOf\("plugins\.bundle\.config"\)/, pmPage, pmPageFile],
        // Card third tab: no slot can replace "contained components", so we gate visibility by DOM shape.
        ['「包含的组件」那一格仍叫 section[data-plugin-rows]（收起/放行就认这一个）', /"data-plugin-rows": true/, pmPage, pmPageFile],
        ['包页仍把配置段与组件段画成同一容器的兄弟两格（我们的选择器靠这条相邻关系）', /"data-plugin-config": true,[\s\S]{0,300}?\(RowsSection,/, pmPage, pmPageFile],
        ['包页根节点仍带 data-plugin-detail="<包名>"（样式表用它把规则限定在自己那一页）', /"data-plugin-detail": pkg\.name/, pmPage, pmPageFile],
        ['pluginManager/listBundles 这颗 remote 仍被装配（tab 上的行数只有这一个来源）', /pluginManager\/listBundles/, remote, remoteFile],
        ['SettingsFormModel（暂存 + revision 围栏写）', /declare class SettingsFormModel/, model, modelFile],
        ['write-only 密钥控件的 spec 形状', /interface SettingsSecretSpec/, model, modelFile],
        ['SettingsSecretField（只报"是否已配置"）', /declare function SettingsSecretField/, fields, fieldsFile],
        ['head 行仍是 flex（文档链接 portal 进去才摆得对）', /\.head \{[^}]*display: flex/, fieldsCss, fieldsCssFile],
        ['官方 label 会吃掉整行（我们要收成 0 1 auto 才让链接贴其右）', /\.label \{[^}]*flex: 1/, fieldsCss, fieldsCssFile],
        ['徽标仍是 label 的同级 span（`label ~ span` 的前提）', /jsx\("label", \{[^}]*\}\), jsx\("span", \{/, widgets, widgetsFile],
        ['右上角斜上箭头图标仍在导出里', /export declare const IconRightUpOutlineRegular/, icons, iconsFile],
        ['credential 变更事件被转发到客户端', /"credentials\/reference-updated"/, events, eventsFile],
        ['settings 文档更新事件被转发到客户端', /"settings\/document-updated"/, events, eventsFile],
        ['credentials/describe remote', /credentials\/describe/, remote, remoteFile],
        ['credentials/set remote', /credentials\/set/, remote, remoteFile],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: '条目 volatile 投影 / 命名空间=条目 id / configForms 读写 / keyed 包级配置槽 / credentials remote / 组件段 DOM 形状与 listBundles 都仍在' }
        : { status: FAIL, detail: `settings 卡片链路的接口变了：${missing.join(' / ')}（见账本 L15；改本仓 adapter，不要改探针）` }
    },
  },
  {
    id: 'L16',
    title: '工具返回值按 output.schema 校验：createSuccessResult → snapshotToolValue + validateJsonSchemaValue',
    why: '2026-09-23 事故（会话 cf464cb6）：resolve_data_time_range 的 capability 形态返回值里没有 mode，'
      + '而 output.schema 把 mode 列进 required —— 本地 test 直接调 execute 绕过这层校验，真机上每次调用都是 '
      + 'ToolOutputError: missing required property "value.mode"，模型重试 3 次同一条调用后卡死。'
      + '本仓 test/output-contract.mjs 是这条规则的镜像断言；上游若不再按 output.schema 校验返回值，镜像就该退休，'
      + '所以这里逐条探测：漂移必须是一条具名失败。',
    run() {
      const toolsIndex = readIfPresent(join(PKG('dsh-tools'), 'lib/index.js'))
      if (toolsIndex === undefined) return { status: FAIL, detail: `读不到 ${join(PKG('dsh-tools'), 'lib/index.js')}` }
      const jsonSchema = readIfPresent(join(PKG('dsh-tools'), 'lib/types/json-schema.js'))
      if (jsonSchema === undefined) return { status: FAIL, detail: `读不到 ${join(PKG('dsh-tools'), 'lib/types/json-schema.js')}` }
      const errorTypes = readIfPresent(join(PKG('dsh-tools'), 'lib/types/index.js'))
      if (errorTypes === undefined) return { status: FAIL, detail: `读不到 ${join(PKG('dsh-tools'), 'lib/types/index.js')}` }
      const checks = [
        ['validateJsonSchemaValue 仍是命名导出', /export function validateJsonSchemaValue\(schema, value, path/, jsonSchema, 'json-schema.js'],
        ['返回值 snapshot 后按 output.schema 校验',
          /snapshotToolValue\([\s\S]{0,160}validateJsonSchemaValue\(tool\.output\.schema,\s*detached,\s*"value"\)/, toolsIndex, 'index.js'],
        ['违反声明抛 ToolOutputError（INVALID_TOOL_OUTPUT）',
          /class ToolOutputError[\s\S]{0,400}INVALID_TOOL_OUTPUT/, errorTypes, 'types/index.js'],
        ['required 缺失判据是"不存在或 undefined"', /missing required property/, jsonSchema, 'json-schema.js'],
        ['additionalProperties: false 拒绝未声明字段', /additionalProperties\s*===\s*false/, toolsIndex, 'index.js'],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: '返回值仍按 output.schema 校验（required / additionalProperties / oneOf），镜像断言成立' }
        : { status: FAIL, detail: `工具输出校验链变了：${missing.join(' / ')}（见账本 L16 与 test/output-contract.mjs；上游若取消这层校验，先改探针再改镜像）` }
    },
  },
  {
    id: 'L17',
    title: '预设声明面：@deepseek-ai/dsh-agent-preset 声明行（Config = PresetDefinition{id, plugins}）+ registry 不吃 roots + agentPresets.composedPreset',
    why: 'issue #3 的第二条根因：0.1.7 把预设挂载从"registry 行 config.roots 指目录"换成"一颗声明行"，'
      + 'registry 既不扫目录也不接受路径。这一面漂移最阴——启动期什么都正常，直到用户点开历史会话才 '
      + 'RemoteError: Unknown agent preset: capital-generation（config.id 是写进会话日志的身份）。'
      + '同时 src/agents/root-tool-policy.ts 靠 agentPresets.composedPreset(agent.ctx) 筛本 preset，'
      + '那个方法改名就是根收敛静默失效（主 Agent 又看见 render_chart）。',
    run() {
      const presetTypesFile = join(PKG('dsh-agent-preset'), 'lib/types/index.d.ts')
      const presetTypes = readIfPresent(presetTypesFile)
      if (presetTypes === undefined) return { status: FAIL, detail: `读不到 ${presetTypesFile}` }
      const definitionFile = join(PKG('dsh-agent-preset-registry'), 'lib/types/definition.d.ts')
      const definition = readIfPresent(definitionFile)
      if (definition === undefined) return { status: FAIL, detail: `读不到 ${definitionFile}` }
      const registryTypesFile = join(PKG('dsh-agent-preset-registry'), 'lib/types/index.d.ts')
      const registryTypes = readIfPresent(registryTypesFile)
      if (registryTypes === undefined) return { status: FAIL, detail: `读不到 ${registryTypesFile}` }
      const checks = [
        ['声明行的 config 就是 PresetDefinition', /export type Config = PresetDefinition/, presetTypes, presetTypesFile],
        ['声明行把子行收进 EntryGroup（保留表达式到子插件激活）', /EntryGroup\.key\] = true/, presetTypes, presetTypesFile],
        ['PresetDefinition.id（写进会话日志的身份）', /readonly id: string/, definition, definitionFile],
        ['PresetDefinition.plugins（行数组 = 旧 agent.cordis.yml）', /readonly plugins: readonly/, definition, definitionFile],
        ['registry 服务名仍是 agentPresets', /agentPresets:\s*AgentPresetRegistry/, registryTypes, registryTypesFile],
        ['root 收敛用的 composedPreset(ctx) 仍在', /composedPreset\(ctx: Context\): string \| undefined/, registryTypes, registryTypesFile],
        ['registry 仍按声明注册（register(definition)）', /register\(definition: PresetDefinition\)/, registryTypes, registryTypesFile],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      // Reverse assertion: the old "registry points at a directory" form must not return (it now
      // registers nothing, silently).
      if (/roots\b/.test(definition) || /roots\b/.test(registryTypes)) {
        missing.push(`registry 又出现 roots 字段（${registryTypesFile}；0.1.7 的声明式挂载与之互斥）`)
      }
      return missing.length === 0
        ? { status: PASS, detail: '预设声明行 / PresetDefinition.id / composedPreset 都仍在，且 registry 无 roots' }
        : { status: FAIL, detail: `预设声明面变了：${missing.join(' / ')}（见账本 L17；历史会话恢复依赖它，改本仓装配行不要改探针）` }
    },
  },
  {
    id: 'L18',
    title: '客户端命令贡献面 ctx.commandUi.register(CommandContribution) 与菜单过滤的匹配字段',
    why: '自选股入口就是这一行：`available(session)` 每次候选重新求值（只在 Capital 会话出现的唯一判据），而菜单过滤只匹配 label/detail——上游把匹配字段改掉，`/watch` 就再也过滤不到别名（行在，搜不到）。',
    run() {
      const contractFile = join(PKG('dsh-client-ui-commands'), 'lib/types/client/contract.d.ts')
      const contract = readIfPresent(contractFile)
      if (contract === undefined) return { status: FAIL, detail: `读不到 ${contractFile}` }
      const shellFile = join(PKG('dsh-client-ui-commands'), 'lib/client.js')
      const shell = readIfPresent(shellFile)
      if (shell === undefined) return { status: FAIL, detail: `读不到 ${shellFile}` }
      const checks = [
        ['贡献项接口仍在（name/label/description/icon/available/ui）', /export interface CommandContribution \{/, contract, contractFile],
        ['available 以 ClientSessionContext 为准入判据', /available\(session: ClientSessionContext\): boolean/, contract, contractFile],
        ['action 形态的 run(session)', /run\(session: ClientSessionContext\): void/, contract, contractFile],
        ['register(contribution) 返回 disposer', /register\(contribution: CommandContribution\): \(\) => void/, contract, contractFile],
        ['菜单过滤仍只对 label 与 detail 做大小写不敏感 substring', /o\.label\.toLowerCase\(\)\.includes\(query\)/, shell, shellFile],
        ['typed 路径仍按注册名直查贡献项（bare token，不靠过滤面）', /this\.live\.contributions\.get\(typedName\)/, shell, shellFile],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: 'commandUi 贡献面、过滤字段与 bare-token 直查都仍在（所以菜单行可以只留中文，`/watchlist`↵ 照开）' }
        : { status: FAIL, detail: `命令贡献面变了：${missing.join(' / ')}（见账本 L18；改 capital-watchlist 客户端半边，不要改探针）` }
    },
  },
  {
    id: 'L19',
    title: '座位 conversation.input.overlay（kind list / scope session）与官方 Modal 的 props / headless 卡片底板 / 非 headless 的开合与标题面',
    why: '自选股弹窗挂在这个座位上，而座位是**常驻**的（客户端 bundle 在 host 平面，与 preset 无关）：上游改 kind/scope 或改 Modal props，症状是弹窗打不开或刷新按钮落点失效。面板用 `headless: true` 自绘全部几何，所以**卡片底板**（`.dialog` 的 background / radius / overflow / flex）也进了账目：官方散列类够不着，这四条漂了只能靠这条探针点名。'
      + '「精选 Skills」的「详情」用的是**非 headless** 的同一颗组件（官方给 header、标题、关闭按钮、Esc 与遮罩），'
      + '所以"关着时返回 null""closeLabel 落在关闭按钮上""description 仍渲染"也是我们的账：35 行各挂一个浮层'
      + '就是把卡片埋掉，而默认 380px 那一档宽度是「详情」必须自己覆掉的东西。',
    run() {
      const slotsFile = join(PKG('dsh-client-ui-conversation'), 'lib/types/client/contract/slots.d.ts')
      const slots = readIfPresent(slotsFile)
      if (slots === undefined) return { status: FAIL, detail: `读不到 ${slotsFile}` }
      const modalFile = join(PKG('dsh-client-ui-primitives'), 'lib/types/Modal.d.ts')
      const modal = readIfPresent(modalFile)
      if (modal === undefined) return { status: FAIL, detail: `读不到 ${modalFile}` }
      const modalCssFile = join(PKG('dsh-client-ui-primitives'), 'lib/Modal.module.css')
      const modalCss = readIfPresent(modalCssFile)
      if (modalCss === undefined) return { status: FAIL, detail: `读不到 ${modalCssFile}` }
      const implFile = join(PKG('dsh-client-ui-primitives'), 'lib/index.js')
      const impl = readIfPresent(implFile)
      if (impl === undefined) return { status: FAIL, detail: `读不到 ${implFile}` }
      const overlay = /'conversation\.input\.overlay': \{\s*kind: 'list';\s*scope: 'session';/.test(slots)
      const props = ['open', 'onClose', 'title', 'closeLabel', 'footer', 'contentClassName', 'shortcutModal', 'headless']
      const missingProps = props.filter((name) => !new RegExp(`\\b${name}\\??:`).test(modal))
      // A headless card only gets the .dialog base: backdrop / radius / shadow / overflow are the
      // host's, geometry is ours. Any drift leaves an edgeless overlay or content outside the radius.
      const card = [
        ['background 仍来自 layer-2 token', /background: var\(--dsw-alias-bg-layer-2\)/],
        ['圆角仍来自 panel token', /border-radius: var\(--dsw-radius-panel\)/],
        ['卡片仍是 overflow:hidden（确认层与滚动区靠它裁边）', /overflow: hidden/],
        ['卡片仍是 flex column（我们把 padding 收到 0）', /display: flex;\s*flex-direction: column/],
      ]
      const missingCard = card.filter(([label, pattern]) => !pattern.test(modalCss)).map(([label]) => label)
      // The "details" panel depends on these five: match string literals, never css$NN hashes.
      const chrome = [
        ['关着时返回 null（35 行「详情」不许各挂一个浮层）', /if \(!open\) return null/, impl, implFile],
        ['对话框语义仍由 aria-modal 给出（标题走 aria-label，我们只出 title）', /"aria-modal": "true"/, impl, implFile],
        ['关闭按钮的无障碍名仍取 closeLabel（不给就是颗空按钮）', /"aria-label": closeLabel/, impl, implFile],
        ['点遮罩仍走 onClose（Esc 归 useModalLayer，我们自己不再写 keydown）', /onClick: onClose/, impl, implFile],
        ['slug 放在 description 上：那句还在', /optional supporting sentence under the title/, modal, modalFile],
        ['默认宽度仍是 380px 那一档（「详情」的宽度是我们自己覆的，漂了要重看那条）', /width: min\(380px, 100%\)/, modalCss, modalCssFile],
      ]
      const missingChrome = chrome.filter(([, pattern, source]) => !pattern.test(source))
        .map(([label, , source]) => `${label}（${source}）`)
      const missing = []
      if (!overlay) missing.push(`overlay 座位不再是 list/session（${slotsFile}）`)
      if (/headerActions|[aA]ctions\?:/.test(modal)) missing.push(`Modal 出现了 header 动作位，刷新工具条落点要重看（${modalFile}）`)
      if (missingProps.length > 0) missing.push(`Modal 缺 props：${missingProps.join(' / ')}（${modalFile}）`)
      if (missingCard.length > 0) missing.push(`headless 卡片底板变了：${missingCard.join(' / ')}（${modalCssFile}）`)
      if (missingChrome.length > 0) missing.push(...missingChrome)
      return missing.length === 0
        ? { status: PASS, detail: "overlay 座位仍是 list/session，Modal props、headless 卡片底板与非 headless 的开合/标题面都未变（无 header 动作位）" }
        : { status: FAIL, detail: `弹窗座位或外壳变了：${missing.join(' / ')}（见账本 L19）` }
    },
  },
  {
    id: 'L20',
    title: 'storage-domain：ctx.storageDomain.open(spec) / Domain.close() / single 布局 / 必填 backend 路由',
    why: '自选股清单与报价快照的唯一持久化面。三条静默断裂：facility 改名或不再 open（功能整个不可用）、`Domain.close()` 语义变化（我们打开的域没人关）、上游默认后端漂移（清单落到别的介质，用户以为数据没了）。',
    run() {
      const indexFile = join(PKG('dsh-storage-domain'), 'lib/types/index.d.ts')
      const index = readIfPresent(indexFile)
      if (index === undefined) return { status: FAIL, detail: `读不到 ${indexFile}` }
      const domainFile = join(PKG('dsh-storage-domain'), 'lib/types/domain.d.ts')
      const domain = readIfPresent(domainFile)
      if (domain === undefined) return { status: FAIL, detail: `读不到 ${domainFile}` }
      const specFile = join(PKG('dsh-storage-domain'), 'lib/types/spec.d.ts')
      const spec = readIfPresent(specFile)
      if (spec === undefined) return { status: FAIL, detail: `读不到 ${specFile}` }
      const storageFile = join(PKG('dsh-storage'), 'lib/index.js')
      const storage = readIfPresent(storageFile)
      if (storage === undefined) return { status: FAIL, detail: `读不到 ${storageFile}` }
      const checks = [
        ['服务名仍是 storageDomain（DomainFacility）', /storageDomain: DomainFacility/, index, indexFile],
        ['open(spec) 返回 handle（Promise）', /open<S extends DomainSpec>\(spec: S\): Promise<Domain<S>>/, index, indexFile],
        ['backend 仍是必填（我们不 patch 上游那一行的 config）', /backend: string/, index, indexFile],
        ['handle 由调用方关（Domain.close()）', /close\(\): Promise<void>/, domain, domainFile],
        ['single 布局仍是默认（整份 JSON 原子写）', /layout\?: 'single' \| 'per-record'/, spec, specFile],
        ['声明入口 defineDomain / domainTable 仍在', /export declare function defineDomain/, spec, specFile],
        // Domain name rule learned the hard way: a hyphen fails as `malformed-medium: invalid unit name`.
        ['unit name 规则仍是小写字母 / 数字 / 下划线', "UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/", storage, storageFile],
      ]
      const missing = checks.filter(([, pattern, text]) => (typeof pattern === 'string' ? !text.includes(pattern) : !pattern.test(text))).map(([label, , , file]) => `${label}（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: 'storage-domain 的 open/close/backend/layout 四项都仍在' }
        : { status: FAIL, detail: `storage-domain 面变了：${missing.join(' / ')}（见账本 L20；capital-watchlist 的持久化依赖它）` }
    },
  },
  {
    id: 'L21',
    title: '客户端读会话 preset：ctx.sessions.list 快照里的 byId[].projectionValues.agentPreset',
    why: '`available(session)` 只拿到 sessionId（ClientSessionContext 的全体就一个字段），所以「只在 Capital 会话出现」这条判据必须走 sessions 快照投影。上游把投影键改名或把字段从行里去掉，症状是自选股行**在所有会话都不出现**（静默）。',
    run() {
      const sessionsFile = join(PKG('dsh-api-session-controller'), 'lib/types/client/contract/sessions.d.ts')
      const sessions = readIfPresent(sessionsFile)
      if (sessions === undefined) return { status: FAIL, detail: `读不到 ${sessionsFile}` }
      const serviceFile = join(PKG('dsh-api-session-controller'), 'lib/types/client/sessions/service.d.ts')
      const service = readIfPresent(serviceFile)
      if (service === undefined) return { status: FAIL, detail: `读不到 ${serviceFile}` }
      const registryFile = join(PKG('dsh-agent-preset-registry'), 'lib/types/types.d.ts')
      const registry = readIfPresent(registryFile)
      if (registry === undefined) return { status: FAIL, detail: `读不到 ${registryFile}` }
      const checks = [
        ['sessions 服务面暴露 list 快照', /list: ObservableSnapshot<SessionListState>/, sessions, sessionsFile],
        ['投影可催读（缺席时不轮询、只催一次）', /refreshProjections\(sessionId: SessionId\)/, sessions, sessionsFile],
        ['byId 行仍在（我们的读法：byId[sessionId]?.projectionValues?.agentPreset）', /byId: Record<SessionId, SessionSummary>/, service, serviceFile],
        ['projectionValues 仍是可选字段（未落地时整段缺席）', /projectionValues\?:/, service, serviceFile],
        ['投影键仍是 agentPreset', /agentPreset: string \| null/, registry, registryFile],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: 'sessions 快照投影与 agentPreset 键都仍在' }
        : { status: FAIL, detail: `会话投影读取面变了：${missing.join(' / ')}（见账本 L21；capital-watchlist 的 available 判据依赖它）` }
    },
  },
  {
    id: 'L22',
    title: '半透明菜单材质是一对：--dsw-specific-menu + --dsw-menu-backdrop-filter（深色描边由宿主按 [data-menu-material] 翻）',
    why: '自选股下拉浮在自己的清单行上。填充本身是半透明的（安装态浅 58% / 深 45%），可读性全靠配套的模糊；上游把模糊 token 改名或撤掉 [data-menu-material] 那条深色描边规则，症状是"下拉和底下的清单高度重叠"——正是 2026-09-29 用户报的那一条，功能 CSS 里不许写主题选择器，所以我们只能靠这个钩子拿深色的 l3 描边。',
    run() {
      const themeFile = join(PKG('dsh-client-ui-theme'), 'lib/client.js')
      const theme = readIfPresent(themeFile)
      if (theme === undefined) return { status: FAIL, detail: `读不到 ${themeFile}` }
      const surfaceFile = join(PKG('dsh-client-ui-primitives'), 'lib/MenuSurface.module.css')
      const surface = readIfPresent(surfaceFile)
      if (surface === undefined) return { status: FAIL, detail: `读不到 ${surfaceFile}` }
      const checks = [
        ['菜单模糊仍是 blur（我们照它配对声明）', /--dsw-menu-backdrop-filter:blur\(/, theme],
        ['填充 token 仍在且是半透明（var 引用或带 alpha 的字面量）', /--dsw-specific-menu:var\(--dsw-menu-surface-fill\)|--dsw-specific-menu:#[0-9a-f]{6}[0-9a-f]{2}/i, theme],
        ['深色描边钩子仍在（[data-menu-material] → border-l3）', /\[data-menu-material\]\{--dsw-elevation-stroke-color:var\(--dsw-alias-border-l3\)\}/, theme],
        ['官方菜单面仍是「填充 + backdrop-filter」成对写法（我们的用法有据）', /backdrop-filter:\s*var\(--dsw-menu-backdrop-filter\)/, surface],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label]) => label)
      return missing.length === 0
        ? { status: PASS, detail: '菜单材质的填充、模糊与深色描边钩子都在（改名会静默让下拉透视出底下的清单行）' }
        : { status: FAIL, detail: `菜单材质契约变了：${missing.join(' / ')}（见账本 L22；capital-watchlist 的下拉可读性依赖它）` }
    },
  },
  {
    id: 'L23',
    title: '行内「更多」菜单用官方 Menu primitive：props 面（open / anchor / items / children / selectedIds / onSelect / onClose / align / side / portal / listClassName）、条目字段（id / label / icon / danger / disabled）、组件行 MenuItemButton（danger / separatorBefore）、portal 列表压在模态之上、Escape 在 capture 阶段被菜单吃掉',
    why: '自选股每行的「置顶 / 标记持仓 / 移除」菜单就是它。这些事都不会抛错、只会用起来不对：① 清单区是 overflow:auto 的滚动容器，非 portal 的就地浮层会被裁掉（最后几行点开什么都看不见）；② 官方 Modal 的 Escape 是 document 上的层栈监听，菜单若不在 capture 阶段 preventDefault，按 Esc 会把整个面板关掉；③ portal 列表的 z-index 掉到模态遮罩之下时，菜单画在遮罩里——看得见影子、点不着；④ 持仓的比例步进行靠的是**组件行排在数据行之后**这一条（官方把 `children` 接在 `items.map(...)` 后面），换成"children 在前"或"不渲染 children"，步进器就会掉到「移除」下面，或者干脆没了座位；⑤ 勾选态靠 `selectedIds` + 尾部那道勾，破坏行靠 `MenuItemButton` 的 `separatorBefore` 发丝线。',
    run() {
      const file = join(PKG('dsh-client-ui-primitives'), 'lib/index.js')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}` }
      const menuCss = readIfPresent(join(PKG('dsh-client-ui-primitives'), 'lib/Menu.module.css'))
      const modalCss = readIfPresent(join(PKG('dsh-client-ui-primitives'), 'lib/Modal.module.css'))
      if (menuCss === undefined || modalCss === undefined) return { status: FAIL, detail: '读不到 Menu.module.css / Modal.module.css' }
      const menuZ = Number(/\n\.portal \{[^}]*z-index:\s*(\d+)/.exec(menuCss)?.[1])
      const modalZ = Number(/\n\.root \{[^}]*z-index:\s*(\d+)/.exec(modalCss)?.[1])
      const checks = [
        ['Menu 仍带 open / anchor / items / onSelect / onClose / align / side / portal 这组 props', /function Menu\(\{ open, anchor, items = \[\],[\s\S]{0,400}?align = "start",[\s\S]{0,200}?portal = false/, text],
        ['数据行仍是 role="menuitem" 的 button（id / label / icon / danger / disabled 由 items 驱动）', /entry\.danger === true && css\$\w+\.danger/, text],
        ['portal 模式仍把列表挂到 document.body（否则被清单的 overflow 裁掉）', /portal \? list !== false && createPortal\(list, document\.body\)/, text],
        ['Escape 仍由菜单在 capture 阶段处理（Modal 的层栈检查 event.defaultPrevented）', /document\.addEventListener\("keydown", onEscape, true\)/, text],
        ['外点收起仍是 pointerdown（点别的行/弹窗内容即关，不用我们补监听）', /document\.addEventListener\("pointerdown", onPointerDown\)/, text],
        ['条目里的 disabled 仍会禁用整行（第一行的「置顶」与步进到界的 −/+ 靠它置灰）', /disabled: entry\.disabled/, text],
        // Four more dependencies introduced when holding moved into the menu.
        ['组件行仍排在数据行**之后**（步进行贴着「标记持仓」、发丝线在「移除」上，靠的就是这一条）', /\[\s*items\.map\(renderEntry\),\s*children\s*\]/, text],
        ['selectedIds 仍能点亮多行，选中行仍带尾部那道勾（selection 默认 check）', /const selected = entry\.id === selectedId \|\| selectedIds\?\.includes\(entry\.id\) === true/, text],
        ['勾选态仍是渲染 IconCheckOutlineRegular（改名或换成 fill 就是"标没标"看不出来）', /selected && selection === "check" && jsx\(IconCheckOutlineRegular/, text],
        ['MenuItemButton 仍导出、仍吃 separatorBefore / danger / onSelect（「移除」那一颗就是它）', /function MenuItemButton\(\{[\s\S]{0,220}?separatorBefore = false[\s\S]{0,80}?\}\)/, text],
        ['separatorBefore 仍画一条 role="separator" 的发丝线（掉了「移除」就又贴回持仓那一簇）', /role: "separator"/, text],
        ['方向键走位仍只跳过 disabled（步进键置灰后不该把焦点踢出列表）', /list\.querySelectorAll\("button:not\(:disabled\)"\)/, text],
        ['listClassName 仍被接受（菜单是 portal 出去的，卡片作用域的选择器够不到它）', /function Menu\(\{[\s\S]{0,900}?listClassName \}\)/, text],
      ]
      const missing = checks.filter(([, pattern, source]) => !pattern.test(source)).map(([label]) => label)
      if (!Number.isFinite(menuZ) || !Number.isFinite(modalZ)) missing.push('取不到 .portal / .root 的 z-index')
      else if (menuZ <= modalZ) missing.push(`portal 列表的 z-index（${menuZ}）不再高于模态（${modalZ}）`)
      return missing.length === 0
        ? { status: PASS, detail: `Menu primitive 的 props / 条目字段 / portal 层级（${menuZ} > ${modalZ}）/ Escape 归属都仍在` }
        : { status: FAIL, detail: `行内菜单依赖的 Menu primitive 契约变了：${missing.join(' / ')}（见账本 L23；capital-watchlist 的行内菜单依赖它）` }
    },
  },
  {
    id: 'L24',
    title: 'session scope 座位的框架标准件：SessionStandardProps 里的 inputActions（captureInsertion / insertText / setDraft / submit），按座位 scope 选',
    why: '自选股面板每行的「预测」与「复盘」要把一句话**追加**进当前会话的输入框，用的是框架送给每个 session scope 组件的标准件，不是我们自己 inject 的 facility。三条都会**静默**失效：① 座位 scope 从 `session` 变 `session-maybe`（或标准件改名）→ 组件拿到 undefined，点按钮什么都不发生；② `insertText` 的返回值语义变（不再"没插进去就 false"）→ 面板收起来了、话却没进输入框，用户以为发出去了；③ `captureInsertion` 的 revision 守卫消失 → 异步插入会覆盖用户随后敲的内容。',
    run() {
      const slotsFile = join(PKG('dsh-client-ui-slots'), 'lib/types/index.d.ts')
      const slots = readIfPresent(slotsFile)
      if (slots === undefined) return { status: FAIL, detail: `读不到 ${slotsFile}` }
      const seatFile = join(PKG('dsh-client-ui-conversation'), 'lib/types/client/contract/slots.d.ts')
      const seat = readIfPresent(seatFile)
      if (seat === undefined) return { status: FAIL, detail: `读不到 ${seatFile}` }
      const inputFile = join(PKG('dsh-client-ui-conversation'), 'lib/types/client/contract/input.d.ts')
      const input = readIfPresent(inputFile)
      if (input === undefined) return { status: FAIL, detail: `读不到 ${inputFile}` }
      const checks = [
        ['标准件仍按 scope 选（session → SessionStandardProps）', /ScopeStandardProps<S extends SlotScope> = \(S extends 'session' \? SessionStandardProps/, slots, slotsFile],
        ['标准件的定义仍是"送给每个 session scope 座位组件"', /delivered to every session-scope slot component/, slots, slotsFile],
        ['conversation 的合并面里 inputActions 是标准件之一', /inputActions: InputActions;/, seat, seatFile],
        ['我们坐的那一格仍是 session scope（标准件因此才会送达）', /'conversation\.input\.overlay': \{\s*kind: 'list';\s*scope: 'session';/, seat, seatFile],
        ['公开动作面仍带 captureInsertion（revision 守卫的来源）', /captureInsertion\(\): TokenSpan;/, input, inputFile],
        ['insertText 仍是"插不进去回 false"（面板收不收全靠它）', /insertText\(text: string, span: TokenSpan\): boolean;/, input, inputFile],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: '标准件送达条件、overlay 座位的 scope 与 insertText / captureInsertion 签名都仍在' }
        : { status: FAIL, detail: `写输入框的那条面变了：${missing.join(' / ')}（见账本 L24；capital-watchlist 的「预测 / 复盘」依赖它）` }
    },
  },
  {
    id: 'L25',
    title: '插件显示名：宿主按 <裸包名>/locale/<语言>.json 读 meta.title / meta.description，icon 读 manifest.icon',
    why: '「插件」页卡片与详情页主标题的**唯一**来源（`packageText()` 的回落链是 `meta.title ?? 包名`）。'
      + '三个断点全都静默、没有一条会报错：① 上游改 locale 目录约定或 `meta` 键名 ⇒ 标题回落成 `@v587d/capital-generation`；'
      + '② 上游不再按**裸包名**解析（改成别的锚点）⇒ 同上；③ 本仓 `exports["./locale/*.json"]` 或 `files` 漏一项'
      + '⇒ 本地看着对、用户装出去是包名。所以这里除了正则，还**直接调宿主的 readPluginMeta 读我们自己的包**——'
      + '三种漂移都会在这里点名，而不是等用户发现"插件改名字了"。',
    async run() {
      const bootFile = join(PKG('dsh-app-boot'), 'lib/index.js')
      const boot = readIfPresent(bootFile)
      if (boot === undefined) return { status: FAIL, detail: `读不到 ${bootFile}` }
      const pmFile = join(PKG('dsh-plugin-manager'), 'lib/index.js')
      const pm = readIfPresent(pmFile)
      if (pm === undefined) return { status: FAIL, detail: `读不到 ${pmFile}` }
      const pageFile = join(PKG('dsh-client-ui-plugin-manager'), 'lib/client.js')
      const page = readIfPresent(pageFile)
      if (page === undefined) return { status: FAIL, detail: `读不到 ${pageFile}` }
      const manifestTypesFile = join(PKG('dsh-package-manifest'), 'lib/types/types.d.ts')
      const manifestTypes = readIfPresent(manifestTypesFile)
      if (manifestTypes === undefined) return { status: FAIL, detail: `读不到 ${manifestTypesFile}` }

      const checks = [
        ['locale 入口仍是 `<specifier>/locale/en.json`（en 缺失 = 整个目录都不读）', /optionalResourcePath\(`\$\{specifier\}\/locale\/en\.json`, parentURL\)/, boot, bootFile],
        ['语言文件里取的仍是 `meta.title` / `meta.description`', /title: textOf\(meta\?\.title/, boot, bootFile],
        ['bundle 侧按**包名** + 包根 package.json 调用', /readPluginMeta\(info\.name \?\? name, pathToFileURL\(join\(dir, "package\.json"\)\)\.href\)/, pm, pmFile],
        ['卡片标题的回落链仍是 `meta.title ?? 包名`', /title: pkg\.meta\?\.title === void 0 \? pkg\.name : resolveText\(pkg\.meta\.title\)/, page, pageFile],
        ['`PluginLocalizedMeta.title` 仍是 LocalizedText', /readonly title\?: LocalizedText;/, manifestTypes, manifestTypesFile],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      if (missing.length > 0) {
        return { status: FAIL, detail: `显示名的上游约定变了：${missing.join(' / ')}（见账本 L25；改本仓的 locale/exports，不要改探针）` }
      }

      // Upstream shape is not enough: our own package must actually be readable (a missing exports /
      // files / locale entry only shows up as "the name is the package name again").
      const bootModule = await import(pathToFileURL(bootFile).href)
      if (typeof bootModule.readPluginMeta !== 'function') {
        return { status: FAIL, detail: `dsh-app-boot 不再导出 readPluginMeta（${bootFile}）` }
      }
      const own = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
      const meta = bootModule.readPluginMeta(own.name, pathToFileURL(join(ROOT, 'package.json')).href)
      if (meta === undefined) {
        return { status: FAIL, detail: `宿主读不到本包 ${own.name} 的显示元数据：locale/en.json 是否没被 exports 暴露、或没进 files？` }
      }
      if (meta.error !== undefined) {
        return { status: FAIL, detail: `宿主读本包元数据报错（整份 meta 会被丢弃、标题回落成包名）：${meta.error}` }
      }
      const zh = JSON.parse(readFileSync(join(ROOT, 'locale/zh.json'), 'utf8')).meta
      if (meta.title?.zh !== zh.title || meta.description?.zh !== zh.description) {
        return { status: FAIL, detail: `宿主读到的中文显示名与 locale/zh.json 不一致：${JSON.stringify(meta.title)} / ${JSON.stringify(meta.description)}` }
      }
      if (typeof meta.icon !== 'string' || !meta.icon.startsWith('data:')) {
        return { status: FAIL, detail: `icon 没被读成 data URL（package.json 的 icon 字段或文件本身有问题）：${String(meta.icon).slice(0, 40)}` }
      }
      return { status: PASS, detail: `locale/*.json 与 icon 仍按裸包名可读，本包实测标题「${meta.title.zh}」` }
    },
  },
  {
    id: 'L26',
    title: '详情页标题右侧的 badges 座位：plugins.detail.badge（list, root, owner = { subject }）+ 包页在版本标签之后渲染它',
    why: 'capital-config 往这一格注册 GitHub / npm 两枚外链。两条漂移方向都不报错：① 槽改名或页面不再渲染它'
      + ' ⇒ 链接整组静默消失；② `subject` 的形状变（`kind` 取值改名、`pkg.name` 改名）⇒ 我们的"只认本包"闸门判不出来，'
      + '于是把本插件的链接挂到**别人的**包页 / 行页 / 官方插件页上——同一格座位由这三类详情页共用，越界比消失严重。'
      + '另：list 座位缺 `options.id` 上游直接抛，注册形状也在这里钉住。',
    run() {
      const slotFile = join(PKG('dsh-client-ui-plugin-manager'), 'lib/types/client/slot-contract.d.ts')
      const slot = readIfPresent(slotFile)
      if (slot === undefined) return { status: FAIL, detail: `读不到 ${slotFile}` }
      const pageFile = join(PKG('dsh-client-ui-plugin-manager'), 'lib/client.js')
      const page = readIfPresent(pageFile)
      if (page === undefined) return { status: FAIL, detail: `读不到 ${pageFile}` }
      const slotsImplFile = join(PKG('dsh-client-ui-slots'), 'lib/index.js')
      const slotsImpl = readIfPresent(slotsImplFile)
      if (slotsImpl === undefined) return { status: FAIL, detail: `读不到 ${slotsImplFile}` }
      const checks = [
        ['座位仍是 list + root + owner = PluginDetailProps', /'plugins\.detail\.badge': \{\s*kind: 'list';\s*scope: 'root';\s*owner: PluginDetailProps;/, slot, slotFile],
        ['owner 送的仍是 subject 一个字段', /readonly subject: PluginsSubject;/, slot, slotFile],
        ['bundle 那一支仍带 pkg，且 pkg 有 name（我们的闸门就读它）', /readonly kind: 'bundle';\s*readonly pkg: PluginPackageRef;/, slot, slotFile],
        ['PluginPackageRef.name 仍是包名', /readonly name: string;/, slot, slotFile],
        ['包页仍渲染这一格，且拿到的是 { subject }', /renderSlot\("plugins\.detail\.badge", \{ subject \}\)/, page, pageFile],
        ['这一格画在版本标签之后（不是另起一行）', /versionTag[\s\S]{0,600}renderSlot\("plugins\.detail\.badge"/, page, pageFile],
        ['list 注册仍强制要求 id（缺了当场抛，不是静默）', /list slot "\$\{options\.name\}" requires options\.id/, slotsImpl, slotsImplFile],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: 'badges 座位的契约、包页渲染点与 list 注册的 id 要求都仍在' }
        : { status: FAIL, detail: `标题右侧那格变了：${missing.join(' / ')}（见账本 L26；capital-config 的两枚外链依赖它）` }
    },
  },
  {
    id: 'L27',
    title: '官方 Switch primitive：props 面（checked / onChange / label / disabled / title / className）、它是 button[role="switch"] 且**视觉状态读 aria-checked**、onChange 收到的是下一个状态',
    why: '自选股每行那颗「持仓」开关就是它（住在 capital-watchlist 的 Menu children 里，见 L23）。四种漂移都不报错：'
      + '① 改成非受控、或 onChange 改收事件对象 ⇒ 我们那句 `next ? markHolding : clearHolding` 点错方向，'
      + '开关自己动了而域里什么都没写；② 视觉不再跟着 aria-checked 走（改用平行 class 或内部 state）⇒ 读屏与屏上'
      + '各说一套，而这一行我们**不画任何勾选态图标**，状态只有它一处能说；③ 换成非 button 元素或 role 改名 ⇒ '
      + '菜单那条 `querySelectorAll("button:not(:disabled)")` 的键盘走位不再包含它，键盘上 Tab 出去就回不来；'
      + '④ 导出名漂出 primitives ⇒ 组件拿到 undefined，那一整行不渲染。',
    run() {
      const file = join(PKG('dsh-client-ui-primitives'), 'lib/index.js')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}` }
      const cssFile = join(PKG('dsh-client-ui-primitives'), 'lib/Switch.module.css')
      const css = readIfPresent(cssFile)
      if (css === undefined) return { status: FAIL, detail: `读不到 ${cssFile}` }
      const checks = [
        ['Switch 仍从包根导出（我们 require 的就是包根）', /export \{[^}]*\bSwitch\b[^}]*\}/, file],
        ['props 面仍是 checked / onChange / label / disabled / title / className 这六个', /function Switch\(\{ checked, onChange, label, disabled = false, title, className \}\)/, file],
        ['它仍是 button[role="switch"]，可达名走 aria-label（菜单的键盘走位靠 button 这一条）', /jsx\("button", \{\s*type: "button",\s*role: "switch",\s*"aria-checked": checked,\s*"aria-label": label,\s*title,\s*disabled,/, file],
        ['onChange 收到的仍是**下一个**状态（不是事件、不是当前值）', /onClick: \(\) => \{\s*onChange\(!checked\);/, file],
        ['开与关的配色仍读 aria-checked（不是平行 class、不是内部 state）', /\.switch\[aria-checked='true'\] \{\s*background: var\(--dsw-alias-brand-primary\)/, cssFile],
        ['滑块位移同样读 aria-checked：视觉状态与读屏状态同一个来源', /\.switch\[aria-checked='true'\] \.thumb \{\s*transform: translateX\(16px\)/, cssFile],
        ['焦点环由它自己声明（我们不替它补，也不该再挂一条同名规则）', /\.switch:focus-visible \{\s*outline: var\(--dsw-focus-ring-width\)/, cssFile],
      ]
      const missing = checks.filter(([, pattern, source]) => !pattern.test(readIfPresent(source) ?? '')).map(([label]) => label)
      return missing.length === 0
        ? { status: PASS, detail: 'Switch 的 props 面 / role+aria-checked 驱动视觉 / onChange(next) / 自带焦点环都仍在（36×20 那颗胶囊）' }
        : { status: FAIL, detail: `官方 Switch 契约变了：${missing.join(' / ')}（见账本 L27；capital-watchlist 的「持仓」开关依赖它）` }
    },
  },
  {
    id: 'L28',
    title: '官方 SegmentedControl：props 面（id / value / options / onChange / label / disabled / className）、它自己发 tablist+tab 与 `<id>-<value>-panel` 的 aria-controls、roving tabIndex 与 ←→/Home/End 走位',
    why: 'settings 卡片顶上的三格（数据源 / 精选 Skills / 包含的组件）就是它。四种漂移都不报错：'
      + '① `aria-controls` 的 id 方案一改（换分隔符、换顺序、改成内部生成），我们三块面板的 `id` 与 '
      + '`aria-labelledby` 全部对不上——**第三块面板指的就是宿主那段清单**，读屏用户点「跳到面板」落到空处；'
      + '② roving tabIndex 没了 ⇒ 每格都进 Tab 序，一条 tablist 六个停靠点；③ 键盘走位改语义或不再跳过 '
      + 'disabled 项 ⇒ 方向键与卡片行为分叉（我们自己不补 onKeyDown，补了就是双重选择）；④ 视觉选中态或'
      + '焦点环换载体（不再读 `aria-selected`）⇒ 屏上与读屏各说一套。另外它是**完全受控**件（value 由我们'
      + '持有），改成自持状态就会与卡片根的 `data-capital-config-tab` 两套真相——那属性正驱动着收起宿主'
      + '「包含的组件」那两条 `:has()` 规则（见 L15）。',
    run() {
      const file = join(PKG('dsh-client-ui-primitives'), 'lib/index.js')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}` }
      const cssFile = join(PKG('dsh-client-ui-primitives'), 'lib/SegmentedControl.module.css')
      const css = readIfPresent(cssFile)
      if (css === undefined) return { status: FAIL, detail: `读不到 ${cssFile}` }
      const typesFile = join(PKG('dsh-client-ui-primitives'), 'lib/types/SegmentedControl.d.ts')
      const types = readIfPresent(typesFile)
      if (types === undefined) return { status: FAIL, detail: `读不到 ${typesFile}` }
      const checks = [
        ['SegmentedControl 仍从包根导出（我们 require 的就是包根）', /export \{[^}]*\bSegmentedControl\b[^}]*\}/, text, file],
        ['props 面仍是 id / value / options / onChange / label / disabled / className 这七个', /function SegmentedControl\(\{ id, value, options, onChange, label, disabled = false, className \}\)/, text, file],
        ['它仍是 role="tablist" 且带 aria-label（我们只给名字，不自造 tablist）', /role: "tablist",\s*"aria-label": label/, text, file],
        ['每格仍是 role="tab" + aria-selected', /role: "tab",\s*"aria-selected": active/, text, file],
        ['aria-controls 仍是 `<id>-<value>-panel`（三块面板的 id 就是照它写的）', /"aria-controls": `\$\{id\}-\$\{option\.value\}-panel`/, text, file],
        ['roving tabIndex：只有选中那格进 Tab 序', /tabIndex: active \? 0 : -1/, text, file],
        ['方向键走位仍在（我们不自带 onKeyDown，两套会打架）', /function isWalkKey\(key\) \{\s*return key === "ArrowLeft" \|\| key === "ArrowRight"/, text, file],
        ['Home / End 落在**可用**项上（跳过 disabled 的语义）', /if \(key === "Home"\) return enabled\[0\];/, text, file],
        ['选中态视觉仍读 aria-selected（与读屏同一个来源）', /\.tab\[aria-selected='true'\]/, css, cssFile],
        ['焦点环由它自己声明', /\.tab:focus-visible/, css, cssFile],
        ['id 方案写在 `.d.ts` 的 props 注释里（这条契约是文档化的，不是抄来的）', /<id>-<value>-panel/, types, typesFile],
      ]
      const missing = checks.filter(([, pattern, source]) => !pattern.test(source)).map(([label, , , source]) => `${label}（${source}）`)
      return missing.length === 0
        ? { status: PASS, detail: 'SegmentedControl 的 props 面 / tablist+aria-controls id 方案 / roving tabIndex / 键盘走位 / aria-selected 驱动视觉都仍在' }
        : { status: FAIL, detail: `官方 SegmentedControl 契约变了：${missing.join(' / ')}（见账本 L28；改本仓 adapter，不要改探针）` }
    },
  },
  {
    id: 'L29',
    title: '宿主文件口 `@deepseek-ai/dsh-tool-fs`：四颗工具名（read / write / edit / read_image）与 `read` 的回执包络（`<path>`/`<type>`/`<content>` + 每行 `N: ` 行号）+ 三条读取上限常量',
    why: '2026-10-15 决策「开 read、同时保留 bash」把这一行测进依赖面：preset 挂 `tool-fs` 一行，'
      + '主 Agent 用 `read` 读精选 Skill 的方法论分册与工作区文件（`write` / `edit` 由视图层 deny + '
      + '全局写口闸门两层拦）。三种漂移都静默：① 工具改名或 `read_image` 从条件注册变成无条件注册 ⇒ '
      + '`ROOT_AGENT_DENIED_TOOLS` 与 `src/agents/role-tool-policy.ts` 的角色 allow 清单里那几个名字'
      + '对不上（根侧逐名 `restrict` 只是跳过，角色侧整批失败 = 该角色完全不收敛）；② 回执不再带行号或换一套包装 ⇒ '
      + '`test/selected-skills-content.test.mjs` 的 `readEnvelopeChars` 与整册预算（240 字符路径 + '
      + '每行 `N: `）全部算错方向，分册会在使用者看不见的地方被剪中段；③ 三条上限改小 '
      + '（`READ_LIMIT` / `READ_MAX_BYTES` / `READ_MAX_LINE_LENGTH`）⇒ 一册读不全而工具不报错，'
      + '模型拿到的是截断的正文。',
    run() {
      const file = join(PKG('dsh-tool-fs'), 'lib/index.js')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}（宿主换了这颗文件口包？账本 L29 与根侧名单、角色 allow 清单要一起改）` }
      const checks = [
        ['read 回执仍带 `<path>` 包装（readEnvelopeChars 按它算预算）', /<path>/, text, file],
        ['read 回执仍带 `<content>` 包装（同上）', /<content>/, text, file],
        ['行数上限常量仍在（一册读不全的隐性截断层）', /READ_LIMIT/, text, file],
        ['单行长度上限常量仍在', /READ_MAX_LINE_LENGTH/, text, file],
        ['字节上限常量仍在', /READ_MAX_BYTES/, text, file],
      ]
      const missing = checks.filter(([, pattern, source]) => !pattern.test(source))
        .map(([label, , , source]) => `${label}（${source}）`)
      const renamed = ['read', 'write', 'edit', 'read_image']
        .filter((name) => !new RegExp(`name: ["']${name}["']`).test(text))
      if (renamed.length) missing.push(`工具名 ${renamed.join(' / ')} 不再在这颗包里按原名注册（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: '四颗工具名、read 的 <path>/<content> 包络与三条读取上限都仍在' }
        : { status: FAIL, detail: `宿主文件口契约变了：${missing.join(' / ')}（见账本 L29；改本仓名单与包络建模，不要改探针）` }
    },
  },
  {
    id: 'L30',
    title: '框架并发池的分类器契约：`ToolDefinition.isConcurrencySafe?(args)` —— **只有严格返回 `true` 才判 parallel**，未声明 / 非 true / 抛错 / 工具不可见一律 exclusive（fail-closed）；调度门是 exclusive 要求 `inFlight.size === 0`、parallel 可凑到 `maxParallel`（`maxParallelSubCalls` 默认 10）',
    why: '`docs/dev/data-roles.md` §1.1 把整条"省往返"路线押在这一个判定上：不合并多份结果、不做 digest 与裁剪阶梯，'
      + '而是让模型在同一条消息里发多个调用、由框架放进有界并发池。消费这条的三处都在本仓'
      + '（`describe_dataset`、`list_capabilities`、`describe_capability`），而 `request_data` 刻意**不**声明'
      + '——Hub 的执行器是 FIFO 串行，上游节流与 in-flight 合并都建立在"一次执行一条"上。四种漂移都静默：'
      + '① 字段改名（换成 `concurrency` 之类）⇒ `executionMode()` 读不到我们裸 definition 上的声明，'
      + '三处纯读工具退回串行，一次多能力任务的往返从 1 变 N，没有任何报错；② 语义从"默认 exclusive"'
      + '翻成"默认 parallel"⇒ 没声明的 `request_data` 会并行起来，FTShare 10 QPS / Fuyao 节流地板这类'
      + '按串行写的约束当场失效；③ 严格 `=== true` 放宽成 truthy ⇒ 返回值形状一改， exclusive 变成 parallel'
      + '（方向与 ① 相反，同样静默）；④ 池上限降到 1 ⇒ "一条消息发 N 个"退化回串行，而 skill 里的纪律'
      + '还在教模型那么发。真机回证 **2026-10-16 已补上**：一次性 headless 探针（两颗除声明与否外逐字相同的'
      + '假工具、各挂 700 毫秒）跑三种批次——已声明三颗在 1 毫秒内一起派发、整批 706 毫秒；未声明三颗严格 '
      + 'call→result 交替、整批 1426 毫秒；混发三条各自独占、整批 2116 毫秒（池在第一颗未声明的调用处断开）。'
      + '0.1.5-rc.1 的 `executionMode` 源码与今天同为 fail-closed，所以默认串行这条不是本版才有的行为。',
    run() {
      const file = join(PKG('dsh-tools'), 'lib/index.js')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}（框架换了并发池的实现位置？账本 L30 要跟着改）` }
      const typesFile = join(PKG('dsh-tools'), 'lib/types/index.d.ts')
      const types = readIfPresent(typesFile)
      if (types === undefined) return { status: FAIL, detail: `读不到 ${typesFile}` }
      const checks = [
        ['ToolDefinition 仍带这条可选并发声明', /isConcurrencySafe\?\(args: unknown\): boolean;/, types, typesFile],
        ['未声明就是 exclusive（fail-closed 的方向：默认串行）', /if \(!tool\?\.isConcurrencySafe\) return \{ kind: "exclusive" \};/, text, file],
        ['仍然只有严格 === true 才判 parallel', /tool\.isConcurrencySafe\(exec\.arguments\) === true \? \{ kind: "parallel" \}/, text, file],
        ['分类器抛错回落 exclusive（不吞成 parallel）', /catch \{\s*return \{ kind: "exclusive" \};/, text, file],
        ['调度门仍是"exclusive 要空池、parallel 到 maxParallel"', /mode === "exclusive" \? inFlight\.size === 0 : inFlight\.size < maxParallel/, text, file],
        ['并发池默认上限仍是 10（改成 1 就等于把模型的批量纪律作废）', /maxParallelSubCalls = value \?\? 10/, text, file],
      ]
      const missing = checks.filter(([, pattern, source]) => !pattern.test(source))
        .map(([label, , , source]) => `${label}（${source}）`)
      return missing.length === 0
        ? { status: PASS, detail: '并发分类器仍是"严格 true 才 parallel、其余 fail-closed"，池默认上限 10' }
        : { status: FAIL, detail: `框架并发池契约变了：${missing.join(' / ')}（见账本 L30；改本仓的并发声明与 skill 纪律，不要改探针）` }
    },
  },
  {
    id: 'L31',
    title: '委派行 Config 的**闭集**（`dsh-tool-subagent`）：provider / toolName / modelSelectionSettings / agentOptions / agentPreset / allowedAgentPresets / maxDepth，且 agentPreset 押在 agent-presets 服务与 provider 能力上',
    why: '0.2.1 迁移的直接教训：persona 与 toolFilter 从这颗 Config 移出后，**旧键不会报错、只会被 zod 静默剥掉**'
      + '（L12 当时是绿的，装配却已经在按 0.2.0 的形状写）。preset 里每颗委派行都靠 `agentPreset` 指向角色 preset，'
      + '角色 preset 的名字与 `ROLE_PRESET_IDS` 同字——这三处（Config 键闭集、agent-presets 服务、provider 的'
      + ' agentPreset 能力）任一漂移，症状都是"委派行还在、选不到角色"或"孩子拿到父级整张工具表"。',
    run() {
      const file = join(PKG('dsh-tool-subagent'), 'lib/index.js')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}（宿主换了这颗委派工具包？账本 L31 要跟着改）` }
      const checks = [
        ['Config 仍收 provider / toolName / modelSelectionSettings / agentOptions 四件', /const Config = z\.object\(\{\s*provider: z\.string\(\)\.required\(\),\s*toolName: z\.string\(\)\.default\("subagent"\),\s*modelSelectionSettings: z\.boolean\(\)\.default\(false\),\s*agentOptions: z\.object\(/, text, file],
        ['agentPreset / allowedAgentPresets 仍是字符串型（角色 preset 的选法）', /agentPreset: z\.string\(\)\.min\(1\),\s*allowedAgentPresets: z\.array\(z\.string\(\)\.min\(1\)\)\.min\(1\)/, text, file],
        ['maxDepth 仍接受自然数或 "provider-managed"', /maxDepth: z\.union\(\[z\.natural\(\)\.max\(Number\.MAX_SAFE_INTEGER\), z\.const\("provider-managed"\)\]/, text, file],
        ['allowedAgentPresets 必须包含 agentPreset（两份名单的一致性由它自己拦）', /agentPreset must be included in allowedAgentPresets/, text, file],
        ['选角色押在 agent-presets 服务上（服务缺席即抛错，不静默降级）', /agent preset selection requires the agent-presets service/, text, file],
        ['provider 不支持独立选角色时抛错（fork 后端继承父上下文）', /does not support independent agent preset selection/, text, file],
      ]
      const missing = checks.filter(([, pattern, source]) => !pattern.test(source))
        .map(([label, , , source]) => `${label}（${source}）`)
      return missing.length === 0
        ? { status: PASS, detail: '委派行 Config 闭集与 agentPreset 的三道前置校验都仍在（persona / toolFilter 的拒绝面见 L12）' }
        : { status: FAIL, detail: `委派行的 Config 契约变了：${missing.join(' / ')}（见账本 L31；改 preset 与 role-tool-policy，不要改探针）` }
    },
  },
  {
    id: 'L32',
    title: '人设绑定的两个时机：委派 child 在创建时 composeFrom，手开会话在 agent/created **之后** select → recompose → append',
    why: '本仓一切按人设的判据都在**调用期**现读 composedPreset(exec.agent.ctx)，三颗身份闸门全局装在插件 ctx 上，'
      + '不挂在 agent/created 上——依据就是这个时机差：手选 preset 的会话是先建 Agent、后换人设，created 那一刻读到的还是创建默认值。'
      + '2026-10-19 真机实测：装在 created 上的 `ocr` url 形态闸门对手开 Capital 一次都没触发（同一进程里被委派的 web_retriever 正常）。'
      + '上游若把 select 挪到 created 之前，"按 agent 装闸门"重新变得可行；若改成重建 Agent（先 dispose 再 created），'
      + 'L12 那两处 restrict 会拿到已死的 ctx——两种漂移都要求重判安装位置，所以钉顺序而不是只钉名字。',
    run() {
      const file = join(PKG('dsh-agent-preset-registry'), 'lib/index.js')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}` }
      const checks = [
        ['委派子 Agent 在创建时并入父的 revision（这一支的 created 时机是"身份已定"）', /composeFrom\(ctx, parent\) \{[\s\S]{0,520}this\.join\(ctx, key, generation\)/, text, file],
        ['手开走 select(agent, agentPreset)：入参是一个已建好的 Agent（有 .ctx / .session / .id）', /async select\(agent, agentPreset\) \{[\s\S]{0,900}agent\.session\.append\("agent-preset\/selected"/, text, file],
        ['⛔ 顺序：recompose(agent.ctx) 在 append("agent-preset/selected") 之前（即 created 之后身份才落定）', /await this\.recompose\(agent\.ctx, agentPreset\);[\s\S]{0,120}agent\.session\.append\("agent-preset\/selected"/, text, file],
        ['recompose 的实体 = mount + 广播 tools/change（工具面真的换掉了）', /async recompose\(ctx, id\) \{[\s\S]{0,200}this\.owner\.emit\("tools\/change"\)/, text, file],
        ['读当前身份的唯一口径 composedPreset(ctx)（本仓 preset-claim 依赖它）', /composedPreset\(ctx\) \{[\s\S]{0,120}return this\.generationFor\(ctx\)\?\.mount\.presetId/, text, file],
        ['会话 header 只是**起始** preset，当前值靠该事件推进（投影 init / apply 两份口径不同）', /key: "agentPreset",[\s\S]{0,240}init: \(header\) => header\.agentPreset \?\? null,[\s\S]{0,120}event\.type === "agent-preset\/selected"/, text, file],
      ]
      const missing = checks.filter(([, pattern, source]) => !pattern.test(source))
        .map(([label, , , source]) => `${label}（${source}）`)
      return missing.length === 0
        ? { status: PASS, detail: '人设绑定时机未变：委派=创建期、手开=created 之后 ⇒ 身份判据只能现读、闸门只能全局装' }
        : { status: FAIL, detail: `人设绑定的时机变了：${missing.join(' / ')}（见账本 L32；先重判三颗 guard 的安装位置，再动探针）` }
    },
  },
  {
    id: 'L33',
    title: 'Cordis 服务解析的不对称：`ctx.<name>` 抛错，`ctx.get(name)` 静默返回 undefined（host 平面行必须声明 inject）',
    why: 'capital-policy 是 host 平面行，它要 `tools.guard()` 面来装三颗身份闸门。这条不对称意味着'
      + '**不声明 inject 时装配不会失败**：属性访问抛错被我们的 try/catch 吞掉、`get` 直接给 undefined，'
      + '于是闸门"装了但不在场"，零报错。2026-10-15 的 fs 写口 guard 就是这么静默空转了 4 天'
      + '（被 tool-fs 的行级 write:false 掩护住），2026-10-19 才由三条真机测试暴露。'
      + '上游若把 `get` 也改成抛错，或让属性访问静默返回 undefined，我们这条依赖（"声明 inject + 读不到就 warn"）都要重判。',
    run() {
      const file = join(PKG('cordis'), 'lib/index.js')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}` }
      const checks = [
        ['属性访问未 inject ⇒ 抛错', /cannot get property "\$\{prop\}" without inject/, text, file],
        ['非 runtime fiber 走 `reflect.get(prop, false)` ⇒ 返回 undefined，不抛错', /return ctx\.reflect\.get\(prop, false\)/, text, file],
        ['required 服务在 inactive context 里才是响亮错误（另一种方向，别混为一说）', /cannot get required service/, text, file],
      ]
      const missing = checks.filter(([, pattern, source]) => !pattern.test(source))
        .map(([label, , , source]) => `${label}（${source}）`)
      return missing.length === 0
        ? { status: PASS, detail: '两种失败方向都在（属性抛错 / get 静默 undefined）⇒ host 平面行必须声明 inject，读不到服务要 warn' }
        : { status: FAIL, detail: `Cordis 服务解析的失败方向变了：${missing.join(' / ')}（见账本 L33；先检查 capital-policy 的 inject 与三颗 guard 的 warn，再动探针）` }
    },
  },
]

const results = []
for (const probe of probes) {
  let outcome
  try {
    if (BUNDLED_UI_REASON !== undefined && BUNDLED_UI_PROBES.has(probe.id)) {
      outcome = { status: NA, detail: BUNDLED_UI_REASON }
    } else {
      // Awaiting a sync probe yields itself; with async probes (L25 imports the host meta reader) a
      // rejected promise would otherwise surface as `outcome === undefined` and pass silently.
      outcome = await probe.run()
    }
  } catch (error) {
    outcome = { status: FAIL, detail: `探针自身抛错：${error instanceof Error ? error.message : String(error)}` }
  }
  // A probe without a status is not a pass: a forgotten return or wrong shape would otherwise slip
  // past the FAIL filter and leave the ledger looking complete while probing nothing.
  if (outcome === undefined || ![PASS, FAIL, NA].includes(outcome.status)) {
    outcome = { status: FAIL, detail: `探针没有返回 {status, detail}，实际拿到：${JSON.stringify(outcome) ?? String(outcome)}` }
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
