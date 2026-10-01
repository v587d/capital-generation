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
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { locateDshPackage } from './lib/run-tool.mjs'

const PASS = 'pass'
const FAIL = 'fail'
const NA = 'n/a'

// 定位 dsh 包根的实现只在 scripts/lib/run-tool.mjs 有一份（smoke-boot 要用同一个包根的
// lib/bin.js 起进程；两份 finder 迟早分叉，症状是"一端探到了、另一端说找不到"）。

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
      const manifests = ['package.json', 'chart-ui/package.json', 'capital-config/package.json', 'capital-watchlist/package.json']
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
    id: 'L10',
    title: 'Slot conversation.chat.turnTail + TurnTailOwnerProps',
    why: '该槽本是为「最终图表落在收尾正文之后」而接的官方 turn-tail 扩展面。',
    run() {
      // 2026-09-18 起本包不再使用 turn-tail 通道（AGENTS.md §7：连同自定义会话事件类型一起
      // 移除，禁止恢复），0.1.7 又把它的 kind 从 chain 改成 list——一个我们不消费的面的
      // 形状漂移不该再让 check:dsh 变红。守卫在 test/chart-client.test.mjs：客户端包只留
      // tool.call.toolview 卡片与 slots inject。上游若再次改名，无需动本仓。
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
        // 关键不变量（2026-09-18 事故）：交付事件必须仍在**闭集**词汇表里。掉出去 =
        // 写出的日志在冷加载时被 fail-closed 拒绝，整份会话打不开。
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
    title: 'agent/created（Scoped<Agent>）+ agent.ctx + tools.restrict 的 scoped 语义',
    why: '根 Agent 的 render_chart / 孙 Agent 创建工具只能靠"在它自己的 agent scope 上 deny"拿掉；事件消失、agent.ctx 不可用或 restrict 变成 context-global，都会让主 Agent 重新拿到这些入口（或在 standing 层误伤 specialist）。',
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
        // 0.1.7：原先借 dsh-agent-presets 的实现做旁证，该包已被 agent-preset-registry 取代且
        // 不再监听 agent/created；dsh-tool-subagent 是同一条不变量的现役使用者（拿到 created
        // agent 后用**它自己的 ctx** 装 scoped 运行时——不是 ctx.root）。
        ['上游自己在 agent/created 里拿 created agent', /"agent\/created",\s*(?:async\s*)?\(\{ agent/, subagent, subagentFile],
        ['并经由该 agent 自己的 ctx 注入 scoped 运行时', /\w\.ctx\.inject\(\[/, subagent, subagentFile],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: 'agent/created + agent.ctx + scoped restrict 仍可用（root 收敛机制成立）' }
        : { status: FAIL, detail: `根 Agent 收敛机制的接口变了：${missing.join(' / ')}（见账本 L12）` }
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
        // 顺序是关键：必须在 append("turn/end") 之前，否则轮已关闭（实测间距约 560 字符）。
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
    title: 'settings / credentials 扩展面：条目 Config 的 .volatile() 投影（ns = 条目 id）+ configForms.get/whileServed + plugins.row.config(keyed) + credentials remote',
    why: 'capital-config 是 host 平面 settings 卡片。0.1.7 起命名空间**不再注册**：可编辑面是 profile 条目 Config schema 里 '
      + '.volatile() 字段的投影（`volatileForm` 在一个 volatile 字段都没有时返回 undefined，该条目就**不进** describe 镜像），'
      + '且 `ns` 恒等于 `entry.options.id`；浏览器半边靠 `ctx.configForms.get(条目 id)` 读写、靠 Plugins 页的 keyed 槽 `plugins.row.config`（'
      + 'key = `<包名>#<行 id>`）坐落、靠 `remote.credentials.describe/set` 写密钥。条目 id / 行 id / 槽 key 任一处改名都不报错——'
      + '卡片静默消失或密钥写不进去，用户只会以为"设置里根本没有这个插件"。',
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
      const ledgerFile = join(PKG('dsh-client-ui-plugin-manager'), 'lib/types/client/config-ledger.d.ts')
      const ledger = readIfPresent(ledgerFile)
      if (ledger === undefined) return { status: FAIL, detail: `读不到 ${ledgerFile}` }
      const pmPageFile = join(PKG('dsh-client-ui-plugin-manager'), 'lib/client.js')
      const pmPage = readIfPresent(pmPageFile)
      if (pmPage === undefined) return { status: FAIL, detail: `读不到 ${pmPageFile}` }
      const modelFile = join(PKG('dsh-client-ui-primitives'), 'lib/types/settings-form/form-model.d.ts')
      const model = readIfPresent(modelFile)
      if (model === undefined) return { status: FAIL, detail: `读不到 ${modelFile}` }
      const fieldsFile = join(PKG('dsh-client-ui-primitives'), 'lib/types/settings-form/fields.d.ts')
      const fields = readIfPresent(fieldsFile)
      if (fields === undefined) return { status: FAIL, detail: `读不到 ${fieldsFile}` }
      const eventsFile = join(PKG('dsh-api-remotes'), 'lib/types/remote-events.d.ts')
      const events = readIfPresent(eventsFile)
      if (events === undefined) return { status: FAIL, detail: `读不到 ${eventsFile}` }
      const remoteFile = join(PKG('dsh-api-remotes'), 'lib/client.js')
      const remote = readIfPresent(remoteFile)
      if (remote === undefined) return { status: FAIL, detail: `读不到 ${remoteFile}` }

      const checks = [
        // ── host 半边：可编辑性是 schema 事实，不是注册出来的命名空间 ──
        ['ctx.settings 服务（SettingsForms）', /settings:\s*SettingsForms/, hostTypes, hostTypesFile],
        ['settings.describe() 返回条目投影', /describe\(options\?: SettingsDescribeOptions\): SettingsDescriptor\[\]/, hostTypes, hostTypesFile],
        ['volatileForm(schema) 仍在', /function volatileForm\(schema\)/, hostImpl, hostImplFile],
        ['没有任何 volatile 字段 ⇒ 条目不进镜像', /Object\.keys\(dict\)\.length === 0 \? void 0 : z\.object\(dict\)/, hostImpl, hostImplFile],
        ['命名空间恒等于 profile 条目 id', /ns: entry\.options\.id/, hostImpl, hostImplFile],
        ['写非 volatile 路径被响亮拒绝', /is not volatile/, hostImpl, hostImplFile],
        // ── 浏览器半边：按条目 id 寻表单，按 served 门控注册 ──
        ['ctx.configForms.get(entryId)', /get<T>\(entryId: string\): ConfigForm<T>/, form, formFile],
        ['ctx.configForms.whileServed(namespaces, register)', /whileServed\(namespaces: readonly string\[\], register:/, form, formFile],
        ["slot plugins.row.config 是 keyed", /'plugins\.row\.config':\s*\{\s*kind:\s*'keyed'/s, slot, slotFile],
        ['槽 key 由 rowConfigKey(bundle, rowId) 给出', /declare function rowConfigKey\(bundle: string, rowId: string\)/, ledger, ledgerFile],
        ['槽 key 的分隔符仍是 `<包名>#<行 id>`', /function rowConfigKey\(bundle, rowId\) \{\s*return `\$\{bundle\}#\$\{rowId\}`/, pmPage, pmPageFile],
        ['Plugins 页按**行 id** 取表单（⇒ 命名空间必须等于行 id）', /form: formFor\(openRow\.rowId\)/, pmPage, pmPageFile],
        ['SettingsFormModel（暂存 + revision 围栏写）', /declare class SettingsFormModel/, model, modelFile],
        ['write-only 密钥控件的 spec 形状', /interface SettingsSecretSpec/, model, modelFile],
        ['SettingsSecretField（只报"是否已配置"）', /declare function SettingsSecretField/, fields, fieldsFile],
        ['credential 变更事件被转发到客户端', /"credentials\/reference-updated"/, events, eventsFile],
        ['settings 文档更新事件被转发到客户端', /"settings\/document-updated"/, events, eventsFile],
        ['credentials/describe remote', /credentials\/describe/, remote, remoteFile],
        ['credentials/set remote', /credentials\/set/, remote, remoteFile],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: '条目 volatile 投影 / 命名空间=条目 id / configForms 读写 / keyed 行配置槽 / credentials remote 都仍在' }
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
      // 反向断言：旧的"registry 指目录"写法不许回来（它现在会静默不注册，issue #3）。
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
    title: '座位 conversation.input.overlay（kind list / scope session）与官方 Modal 的 props / headless 卡片底板',
    why: '自选股弹窗挂在这个座位上，而座位是**常驻**的（客户端 bundle 在 host 平面，与 preset 无关）：上游改 kind/scope 或改 Modal props，症状是弹窗打不开或刷新按钮落点失效。面板用 `headless: true` 自绘全部几何，所以**卡片底板**（`.dialog` 的 background / radius / overflow / flex）也进了账目：官方散列类够不着，这四条漂了只能靠这条探针点名。',
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
      const overlay = /'conversation\.input\.overlay': \{\s*kind: 'list';\s*scope: 'session';/.test(slots)
      const props = ['open', 'onClose', 'title', 'closeLabel', 'footer', 'contentClassName', 'shortcutModal', 'headless']
      const missingProps = props.filter((name) => !new RegExp(`\\b${name}\\??:`).test(modal))
      // headless 卡片只拿到 .dialog 这一块底板：底色 / 圆角 / 阴影 / overflow 归官方，几何归我们。
      // 这四条里任何一条漂了，面板就会变成"没有底的浮层"或"圆角外沿漏内容"。
      const card = [
        ['background 仍来自 layer-2 token', /background: var\(--dsw-alias-bg-layer-2\)/],
        ['圆角仍来自 panel token', /border-radius: var\(--dsw-radius-panel\)/],
        ['卡片仍是 overflow:hidden（确认层与滚动区靠它裁边）', /overflow: hidden/],
        ['卡片仍是 flex column（我们把 padding 收到 0）', /display: flex;\s*flex-direction: column/],
      ]
      const missingCard = card.filter(([label, pattern]) => !pattern.test(modalCss)).map(([label]) => label)
      const missing = []
      if (!overlay) missing.push(`overlay 座位不再是 list/session（${slotsFile}）`)
      if (/headerActions|[aA]ctions\?:/.test(modal)) missing.push(`Modal 出现了 header 动作位，刷新工具条落点要重看（${modalFile}）`)
      if (missingProps.length > 0) missing.push(`Modal 缺 props：${missingProps.join(' / ')}（${modalFile}）`)
      if (missingCard.length > 0) missing.push(`headless 卡片底板变了：${missingCard.join(' / ')}（${modalCssFile}）`)
      return missing.length === 0
        ? { status: PASS, detail: "overlay 座位仍是 list/session，Modal props 与 headless 卡片底板未变（无 header 动作位）" }
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
        // 域名规则是实测坑：连字符 → `malformed-medium：invalid unit name`
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
    title: '行内「更多」菜单用官方 Menu primitive：props 面（open / anchor / items / onSelect / onClose / align / side / portal）、条目字段（id / label / icon / danger / disabled）、portal 列表压在模态之上、Escape 在 capture 阶段被菜单吃掉',
    why: '自选股每行的「置顶 / 移除」菜单就是它。三件事都不会抛错、只会用起来不对：① 清单区是 overflow:auto 的滚动容器，非 portal 的就地浮层会被裁掉（最后几行点开什么都看不见）；② 官方 Modal 的 Escape 是 document 上的层栈监听，菜单若不在 capture 阶段 preventDefault，按 Esc 会把整个面板关掉；③ portal 列表的 z-index 掉到模态遮罩之下时，菜单画在遮罩里——看得见影子、点不着。',
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
        ['数据行仍是 role="menuitem" 的 button（id / label / icon / danger / disabled 由 items 驱动）', /entry\.danger === true && css\$\d+\.danger/, text],
        ['portal 模式仍把列表挂到 document.body（否则被清单的 overflow 裁掉）', /portal \? list !== false && createPortal\(list, document\.body\)/, text],
        ['Escape 仍由菜单在 capture 阶段处理（Modal 的层栈检查 event.defaultPrevented）', /document\.addEventListener\("keydown", onEscape, true\)/, text],
        ['外点收起仍是 pointerdown（点别的行/弹窗内容即关，不用我们补监听）', /document\.addEventListener\("pointerdown", onPointerDown\)/, text],
        ['条目里的 disabled 仍会禁用整行（第一行的「置顶」靠它置灰）', /disabled: entry\.disabled/, text],
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
