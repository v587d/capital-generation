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
      const manifests = ['package.json', 'chart-ui/package.json', 'capital-config/package.json']
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
    why: '最终图表必须位于收尾 assistant 内容之后且不受 compact tool process 折叠；该 slot 是 DSH 的官方 turn-tail 扩展面。',
    run() {
      const file = join(PKG('dsh-client-ui-chat'), 'lib/types/client/contract/slots.d.ts')
      const text = readIfPresent(file)
      if (text === undefined) return { status: FAIL, detail: `读不到 ${file}` }
      const checks = [
        ['conversation.chat.turnTail', /conversation\.chat\.turnTail/],
        ['kind chain', /'conversation\.chat\.turnTail':\s*\{\s*kind:\s*'chain'/s],
        ['TurnTailOwnerProps.turn', /interface TurnTailOwnerProps[\s\S]*?turn:\s*TurnLocation/],
        ['TurnTailOwnerProps.seq', /interface TurnTailOwnerProps[\s\S]*?seq:\s*number/],
      ]
      const missing = checks.filter(([, pattern]) => !pattern.test(text)).map(([label]) => label)
      return missing.length === 0
        ? { status: PASS, detail: 'turn-tail chain 与 owner props 仍可用' }
        : { status: FAIL, detail: `turn-tail 契约变了：${missing.join(' / ')}` }
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
      const presetsFile = join(PKG('dsh-agent-presets'), 'lib/index.js')
      const presets = readIfPresent(presetsFile)
      if (presets === undefined) return { status: FAIL, detail: `读不到 ${presetsFile}` }

      const checks = [
        ["'agent/created'(this: Scoped<Agent>, payload: { agent })", /'agent\/created'\(this: Scoped<Agent>/, types, agentTypes],
        ['payload 带 agent（监听器据此拿 agent.ctx）', /'agent\/created'\(this: Scoped<Agent>, payload: \{[\s\S]{0,120}agent: Agent/, types, agentTypes],
        ['tools.restrict() 要求 scoped context（agent.ctx）', /tools\.restrict\(\) requires a scoped context/, tools, toolsFile],
        ['restrict 走 layer.restrictions.append（作用域层过滤）', /layer\.restrictions\.append\(compiled\)/, tools, toolsFile],
        ['上游自己在 agent/created 里用 agent.ctx', /ctx\.on\("agent\/created"[\s\S]{0,240}agent\.ctx/, presets, presetsFile],
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
    title: 'settings / credentials 扩展面：settings.register(ns, schema, {base, applies}) + settingsScope.bind + settings.plugin.item(keyed) + credentials remote',
    why: 'capital-config 是 host 平面 settings 卡片：host 靠 settings.register 注册命名空间（这个命名空间同时是 settings.plugin.item 的派发键），'
      + '浏览器半边靠 settingsScope.bind({namespace}) 读命名空间、靠 remote.credentials.describe/set 写密钥。任一处改名都不报错——'
      + '卡片会静默消失或密钥写不进去，用户只会以为"设置里根本没有这个插件"。',
    run() {
      const settingsFile = join(PKG('dsh-settings'), 'lib/types/index.d.ts')
      const settings = readIfPresent(settingsFile)
      if (settings === undefined) return { status: FAIL, detail: `读不到 ${settingsFile}` }
      const contractFile = join(PKG('dsh-client-ui-settings'), 'lib/types/client/settings-contract.d.ts')
      const contract = readIfPresent(contractFile)
      if (contract === undefined) return { status: FAIL, detail: `读不到 ${contractFile}` }
      const scopeFile = join(PKG('dsh-client-ui-settings'), 'lib/types/client/settings-scope.d.ts')
      const scope = readIfPresent(scopeFile)
      if (scope === undefined) return { status: FAIL, detail: `读不到 ${scopeFile}` }
      const slotFile = join(PKG('dsh-client-ui-settings-plugins'), 'lib/types/client/slot-contract.d.ts')
      const slot = readIfPresent(slotFile)
      if (slot === undefined) return { status: FAIL, detail: `读不到 ${slotFile}` }
      const eventsFile = join(PKG('dsh-api-remotes'), 'lib/types/remote-events.d.ts')
      const events = readIfPresent(eventsFile)
      if (events === undefined) return { status: FAIL, detail: `读不到 ${eventsFile}` }
      const remoteFile = join(PKG('dsh-api-remotes'), 'lib/client.js')
      const remote = readIfPresent(remoteFile)
      if (remote === undefined) return { status: FAIL, detail: `读不到 ${remoteFile}` }

      const checks = [
        ['ctx.settings 服务声明', /settings:\s*SettingsProvider/, settings, settingsFile],
        ['settings.register(ns, schema, options) 签名', /register<[\s\S]{0,120}schema:\s*z<T>[\s\S]{0,80}SettingsRegisterOptions<T>/, settings, settingsFile],
        ["SettingsApplies = 'live' | 'restart'", /SettingsApplies\s*=\s*'live'\s*\|\s*'restart'/, settings, settingsFile],
        ['SettingsRegisterOptions.base', /base\?:\s*Partial<T>/, settings, settingsFile],
        ['SettingsRegisterOptions.applies', /applies\?:\s*SettingsApplies/, settings, settingsFile],
        ['SettingsScopeSpec.namespace', /namespace:\s*string/, contract, contractFile],
        ['settingsScope.bind(spec)', /bind<T>\(spec:\s*SettingsScopeSpec<T>\):\s*SettingsScope<T>/, scope, scopeFile],
        ['ctx.settingsScope 服务', /settingsScope:\s*SettingsScopeBinder/, scope, scopeFile],
        ["slot settings.plugin.item 是 keyed", /'settings\.plugin\.item':\s*\{\s*kind:\s*'keyed'/, slot, slotFile],
        ['credential 变更事件被转发到客户端', /"credentials\/reference-updated"/, events, eventsFile],
        ['settings 文档更新事件被转发到客户端', /"settings\/document-updated"/, events, eventsFile],
        ['credentials/describe remote', /credentials\/describe/, remote, remoteFile],
        ['credentials/set remote', /credentials\/set/, remote, remoteFile],
      ]
      const missing = checks.filter(([, pattern, text]) => !pattern.test(text)).map(([label, , , file]) => `${label}（${file}）`)
      return missing.length === 0
        ? { status: PASS, detail: 'settings 命名空间注册 / 客户端 scope / keyed 卡片槽 / credentials remote 都仍在' }
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
