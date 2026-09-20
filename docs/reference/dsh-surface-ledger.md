# DSH 接口账本与兼容性升级手册

> 本文件是**维护者文档**，不注入模型、不进 skill 目录。
> 配套探针：`npm run check:dsh`（`scripts/check-dsh-compat.mjs`）——本表的每条接口都有一条
> 对应的机器断言，上游漂移变成具名失败，而不是运行时静默失效。
> 方案背景见内部设计文档 `docs/design/chart-visualization.md`（**不随仓库发布**，仅维护者本地保留）。

## 为什么要账本

dsh 处于快速迭代期，"版本升级"与"大规模破坏性更新"是常态。本仓对上游的依赖分两类：

- **插件代码面**：`ctx.get('fs')` / `ctx.provide` / `ctx.tools.register` 这类 Cordis 通用服务
  —— 变更频率低，且失败是响亮的（挂载验证会点名）。
- **扩展面**：客户端 bundle 的组合与投递、Slot 注册协议、Slot key 与 owner props、
  宿主 HTTP 路由 —— 变更频率高，且**失败是静默或致命的**（图表不显示；或者 bundle 缺失
  时整个 web profile 起不来）。

本账本只针对第二类。原则：**依赖面越小越好，每条都要能被探测。**

## 账本

| ID | 接口 | 我们怎么用 | 探测方式 | 断裂症状 | 修复位置 |
|---|---|---|---|---|---|
| L1 | `package.json.dsh.client = { platform, inject, external, immediately }` | 给嵌套包 `chart-ui/`（`@v587d/capital-charts`）声明浏览器半边 | `dsh-package-manifest` 类型声明里断言四个字段仍在 | bundle 静默不进 `window.__DSH_BOOT__`，图表 UI 永不出现 | `chart-ui/package.json` |
| L2 | `exports["./client"]` 指向的预构建 bundle 存在且在 `files` 里 | 客户端半边代码的投递（主包与嵌套包都查） | 探针 + `test/packaging.test.mjs` 的 `npm pack` 断言 | **致命**：`ClientPackageCompositionError` 在注册表构造时抛出，web profile 起不来 | 两个 `package.json` 的 `files` |
| L3 | `ctx.slots.inject(name, cb)` + `ctx.slots.register({name,key}, Component)` | 把图表 view 注册进对话流 | 在 shipped bundle 里搜这两个调用的形状 | 图不渲染（可能只在控制台报错） | 客户端半边的 adapter |
| L4 | Slot key `tool.call.toolview` + `ToolCallOwnerProps.{callId,toolName,block,cwd,openFile,loadImage}` | 工具过程明细座位；`key` = 工具名，`block` 给参数与结果 | 在 shipped bundle 里搜 slot key 字符串与 props 字段名 | 图卡片静默回退成通用工具行，或仅在展开过程时可见 | 客户端半边 + `dsh-adapter` |
| L10 | Slot `conversation.chat.turnTail`（chain）+ `TurnTailOwnerProps.{turn,seq,openFile}` | **已不用于本仓图表呈现**（卡片通道 2026-09-18 移除）。保留此条目是因为官方「本轮文件改动 / 交付」行就在这个座位上——我们不再抢它 | 探针仅在 `dsh-client-ui-chat/lib/types/client/contract/slots.d.ts` 断言 slot kind 与 owner props 仍存在（防止上游改名时我们误判） | 与本仓无直接关联；若将来要再插自定义尾部内容，必须重新评估"抢座位"的后果 | —（本仓已无 turn-tail adapter） |
| L11 | `Session.append(type, data)`（**必须是 first-party 事件**）+ `ctx.sessions.get(id)` + `ctx.sessionProjections.stateOf(session, 'turnBoundary')` | 出图成功后由宿主往**根会话**追加官方 `deliverables/presented`，把 `chart.html` 登记为本轮交付物；事件不进 `deriveMessages()`，因此不污染模型上下文 | 在 `dsh-session/lib/index.js` 断言 `append(`、`deriveEventMessage` 的 `default: return null`，以及 **`"deliverables/presented"` 仍在 `KNOWN_SESSION_EVENT_TYPES` 闭集内**；在 `dsh-session-projection/lib/index.js` 断言 `stateOf(`；探针见 `check-dsh` L11 | 图表不出现在交付行（静默）；**最坏情况：写了一个闭集外的事件类型 → 整份会话冷加载被 fail-closed 拒绝（2026-09-18 实测事故）** | `src/chart/events.ts` |
| L12 | `agent/created` 事件（`this: Scoped<Agent>`，**路由键是 agent 对象本身**）+ `agent.ctx` + `tools.restrict({deny})` 的 scoped 语义 | 只在**根 Agent 自己的 scope** 上 deny `render_chart` / `subagent_visualization_specialist` / `prepare_chart_source`；子 Agent 是 standing 的兄弟 scope，不受影响。**监听必须注册在未打 scope 标签的 `ctx.root` 上**（`agentCarrier(agent) = scopeTarget(agent, agent)`，键是 agent 对象，standing-scope 的监听器按 `dsh-scope` 准入规则收不到 → 静默失效），再用 `agentPresets.composedPreset(agent.ctx)` 筛本 preset | 在 `dsh-agent/lib/types/runtime-types.d.ts` 断言 `'agent/created'`；在 `dsh-tools/lib/index.js` 断言 `tools.restrict() requires a scoped context`；在 `dsh-agent-presets/lib/index.js` 断言上游自己就在 `agent/created` 里用 `agent.ctx`；探针见 `check-dsh` L12 | 主 Agent 又能看到出图/孙 Agent 创建工具（**且不报错**，纯静默）；或在 standing 层误 deny 连 specialist 一起砍掉 | `src/agents/root-tool-policy.ts` |
| L13 | `ctx.connection.requestRejection(req) → 401 \| 403 \| undefined`（`HostConnectionService` / `HostConnectionHandle`；401 = 缺/过期浏览器 cookie，403 = Host/Origin 不受信） | `/capital-charts` 序列旁路挂在自注册的 `webServer` prefix 路由上，必须**主动**接入这道围栏，否则绕过平台认证（2026-09 review：任何本机进程/页面凭 `chart_id` 即可读 `series.json`）。`connection` 缺席（Electron/file:// 载体）时退化成无认证面的旧行为 | 在 `dsh-client-connection/lib/types/rpc.d.ts` 断言 `requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection` 与 `ConnectionRequestRejection = 401 \| 403 \| undefined`；探针见 `check-dsh` L13。本仓回归见 `test/chart-host.test.mjs`（401/403、fail closed、认证先于方法/路径） | 序列旁路静默变成无认证端点（本机任意进程可读会话图表）；上游若把围栏拆成别的名字，探针具名失败而不是运行时才暴露 | `chart-ui/index.js` 的 `apply()` + `createRouteHandler({ authorize })` |
| L14 | `ctx.on('agent/turn-stopping', ({agent, turn, signal}))`（`@mode serial`，在 `turn/end` **之前**派发，轮仍打开、可安全 `append`；`dsh-scope` 准入：agent-scoped 监听器只收该 agent，未打标签的 root 监听器收全部） | 决定**交付行落在哪一轮**：寄存的图表必须在 owner 那一轮**即将关闭**时写入，否则会被下一次 `turn/start` 提前落进空的过程轮（2026-09-20 实测 session `38bad3f9`：交付行落进 turn 5，总结答复在 turn 6）。事件名不在宿主 Context 的静态 `keyof Events` 里，按本仓惯例模糊注册；注册失败即退回 `turn/start` | 在 `dsh-agent/lib/types/runtime-types.d.ts` 断言 `'agent/turn-stopping'` 与 `payload.turn`；在 `dsh-agent-loop/lib/index.js` 断言 `dispatch.serial("agent/turn-stopping"` 且位于 `this.session.append("turn/end"` **之前**；探针见 `check-dsh` L14。本仓回归见 `test/chart-turn-events.test.mjs`（首选在场时 `turn/start` 不得抢跑 / 缺席时退回兜底） | 事件名消失或派发点挪到 `turn/end` 之后 → 交付行退回旧行为（落进过程轮）；注册失败**不会**丢图（`turn/start` 兜底接上），但会静默退回旧落点 | `src/chart/events.ts` 的 `onTurnStopping` + `src/index.ts` 的适配器 |
| L5 | `react` / `react/jsx-runtime` 是 shell 静态种子词 | 客户端 bundle 里 `require("react")` | 在 shipped bundle 里搜 `require("react")` | 浏览器里 require 失败，bundle 整体不执行 | 构建配置（`external`） |
| L6 | `ctx.webServer.register({ kind: 'exact'\|'prefix', path, handler })` | 提供 `/capital-charts/<id>.json` 序列通道 | `dsh-host-webserver` 类型声明里断言签名与 `WebRouteKind` | 取数 404 → 只剩"打开 HTML 文件"降级路径 | `chart-ui/index.js` 的路由注册 |
| L7 | 主题 = CSS 变量 `--dsw-*` | 图表颜色跟随明暗主题 | shipped CSS 里断言前缀仍在 | 图表与壳的主题脱节（浅色页面上的深色图） | 客户端半边样式 |
| L8 | 工具 `parameters` 根必须是 object 型 schema | 所有模型工具 | `test/apply-integration.test.mjs` 遍历 `apply()` 真实注册的全部工具 | **致命**：供应商在第一个 token 之前整体 400，每个 Capital 会话第 1 轮即失败 | 工具定义（用仓内 `jsonObject()`） |
| L9 | Loader 行名的**三条规则**：① `name` 不参与插值（只有 fiber 的 `config` 会）；② 只有**精确包名**或 **path-like**（`.`/`file:`/绝对路径）才会被认作客户端包，subpath 会被静默丢弃；③ 相对行名的解析基址是**本 patch 文件所在目录**，不是 profile 根 | `cordis.patch.yml` 的 `capital-charts` 行写成 `./chart-ui/index.js`，指向随包携带的嵌套包 | 在 `dsh-client-modules/lib/index.js` 里断言 `locatePkgJson` / path-like 判定 / `nearestPackage` 仍在；在 `cordis-plugin-include/lib/index.js` 里断言 `ctx.baseUrl = new URL('.', …)` 仍在；本仓回归断言见 `test/chart-composition.test.mjs` | **致命或静默**：`!!js` 进 `name` → 启动期 `name.startsWith is not a function`，profile 起不来；subpath 进 `name` → 客户端半边**静默消失**（不报错）；相对基址变了 → 行解析不到 | `cordis.patch.yml` 的行名（三条规则都写在行内注释里） |

### 刻意不依赖的东西

- **Typert Remote / `/api/<ns>`**：shipped 包用它做 client→host 调用，但那是 DSH 仓内 codegen
  生成的 reflection 元数据，外部包拿不到，且与版本强耦合。我们自己注册 HTTP 路由（L6）。
- **`ctx.theme` API**：只读 CSS 变量，省掉一个接口。
- **运行期向已在浏览器里跑起来的页面投递新 entry**：boot graph 在 index.html 渲染时确定，
  HMR 的 `graph` 帧被显式忽略且那条链路 dev-only。所以客户端行必须挂在 **host 平面**
  （页面启动时就存在），不能挂在 preset/session 行上。这条约束一旦被上游修改（即真能运行期
  投递），我们只是**多了一个选择**，不会因此损坏。

## 升级 runbook

1. 读上游发布说明 / diff，重点看：客户端模块组合、Slot 目录、`@deepseek-ai/dsh-tool-subagent`、
   `dsh-host-webserver`、**Loader 的行名解析（`locatePkgJson`）与 include 的 `baseUrl` 设置**。
2. `npm run check:dsh` —— 先看哪条账本失配。
3. 对照上表的"修复位置"改**本仓 adapter**；**不要为了变绿改探针**（探针断言的是上游事实，
   不是我们的措辞）。确属上游有意变更时，同时更新本文件与探针。
4. `npm test`（含打包测试与组合测试）。
5. **`npm run smoke:boot`** —— 在 workspace 内搭 scratch profile 并**真的把 dsh 跑起来**，
   同时复核 index.html 的 `__DSH_BOOT__` 里有 chart-ui 的 bundle。
   **这一步不能省**：`--dump-config` 只打印组合后的配置，既不做 `!!js` 插值也不导入任何行，
   证明不了"能起来"。2026-09-15 的事故正是漏在这里——dump 看着完全正常，真实启动直接失败
   （`!!js` 进了 `name`），后来又发现 subpath 写法会让客户端半边静默消失，也是靠这一步才暴露。
6. 组合树核对（可选，与第 5 步互补）：`dsh --profile web --dump-config`，确认
   `# == @v587d/capital-generation` 段里有那条 insert 行。该命令会**写** profile 目录下的
   `cordis.yml`，受限沙箱里会 `EROFS`；只做只读核验时改用 scratch profile
   （`DSH_HOME=<workspace 内目录> dsh --profile scratch --dump-config`）。
7. 真实会话复核（**必须重启 dsh 进程**，ESM 缓存与 host 平面行都在启动时确定）：
   首轮工具表里**没有** `render_chart` / `final_report` / `subagent_visualization_specialist`
   （root 收敛生效），而 `visualization_specialist` 子会话的工具表里**有** `render_chart`；
   回执里 `chart_url` 非 null；浏览器控制台出现
   `capital-charts: 客户端半边已挂载（render_chart toolview；呈现走官方交付通道）`；
   跑一次带时间序列的任务，确认主会话日志里出现 `"type":"deliverables/presented"`（载荷含
   `files[].path` = 该图的 `chart.html`），**且日志里不出现任何非 first-party 事件类型**
   （出现即会让这份会话冷加载失败）；收尾的「本轮文件改动 / 交付」行点开该文件能在右侧渲染图表。
   **改了 `chart-ui/` 或 `src/` 之后，浏览器页面必须刷新**：客户端 bundle 在页面加载时确定，
   宿主重启不会换掉已打开页面里的那份 bundle（表现：图表不出现，且控制台无报错）。

## 恢复手册（装坏了怎么回到可用）

客户端 bundle 缺失会让 **web profile 起不来**。因为图表前端组件是**主包随包携带的嵌套包**
（不是独立依赖），恢复动作就是移除主包：

```sh
dsh plugin --profile web remove @v587d/capital-generation
```

本机 profile 用 `link:` 安装时，等价动作是把 `@v587d/capital-generation` 从
`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 里注释掉。

要**只**停用图表 UI 而保留 Capital 模式其余能力：注释掉 `cordis.patch.yml` 里的
`- insert:` 块（那一行就是唯一的挂载点），`render_chart` 仍可用，只是回执里
`chart_url` 变成 `null`、只剩文件路径——这正是"旁路可选"的设计意图。

## 打包与恢复演练（Step 5：2026-09-15，dsh 0.1.5-rc.1）

| 步骤 | 操作 | 结果 |
|---|---|---|
| 打包 | `npm pack --dry-run` | 57 个文件 / unpacked ≈993KB；`chart-ui/client.js`、`lib/chart/vendor/lightweight-charts.standalone.production.js`、`preset/.../capital-chart-protocol/SKILL.md`、`cordis.patch.yml` 全部在包内 |
| 复现致命失败 | 临时移走 `chart-ui/client.js` → `npm run smoke:boot` | ❌ `ClientPackageCompositionError`：`packageName: '@v587d/capital-charts'`、`clientPath: .../chart-ui/client.js`，**整个 web profile 起不来** |
| 恢复 | 放回 `chart-ui/client.js` → `npm run smoke:boot` | ✅ boot 成功，`__DSH_BOOT__` 含 chart-ui bundle |

结论：客户端 bundle 缺失的失败模式与恢复路径均已实测；该闸门由 `test/packaging.test.mjs`
在 `npm test` 里持续守门。**注意**：嵌套包的 `files` 字段**不会**被主包的
`files: ["chart-ui"]` 继承，所以 `chart-ui/client.src.cjs`（源码，无害）也会随包发布——
新增 `chart-ui/` 文件时据此判断分发范围。

## 已验证基线

| 日期 | dsh 版本 | 结论 |
|---|---|---|
| 2026-09-15 | 0.1.5-rc.1 | L1–L7、L9–L10 全部通过；L2 已对 `chart-ui/` 生效；L8 由 `npm test` 覆盖 |
| 2026-09-15 | 0.1.5-rc.1 | `npm run smoke:boot` 通过：scratch profile 完成 boot，且 index.html 的 `__DSH_BOOT__` 含 chart-ui bundle（`./chart-ui/index.js` 写法） |
| 2026-09-15 | 0.1.5-rc.1 | 客户端 bundle 由 `scripts/build-client.mjs`（esbuild）生成；`test/chart-client.test.mjs` 在最小 DOM 沙箱执行工厂函数，确认注册 `conversation.chat.turnTail`、`tool.call.toolview['render_chart']`、库内联、无页面全局 |
| 2026-09-17 | 0.1.5-rc.1 | 设计修订（本文件 L11/L12）：`final_report` 整条链路删除；主 Agent 的 `render_chart` 改由 root scope 收敛拿掉；图表改走 `capital/chart-rendered` 事件 + turn-tail。`npm test` 与 `check:dsh` 覆盖新面 |
| 2026-09-17 | 0.1.5-rc.1 | **首次真机复核发现两条 L11/L12 的落地错**：① `agent/created` 的 carrier key 是 agent 对象，注册在 standing scope 上的监听器收不到（主 Agent 工具表照旧有 `render_chart`，无任何报错）→ 改注册在 `ctx.root`；② 主 Agent 等子 Agent 时**先结束自己的回合**，出图发生在两个回合之间，`turnBoundary.lastTurn` 指向已结束的回合 → 卡片挂错回合。改为"回合没打开就寄存，等下一个 `turn/start` 再写"（`session/event` 观察者 + 微任务，避开 `Session.append` 的 reentrancy 守卫） |
| 2026-09-15 | 0.1.5-rc.1 | **真实会话已复核**：`render_chart` 出图后对话流内嵌卡片与右栏文件都能渲染 —— 反证 `chart_url` 非空、toolview 已挂载、preset 平面能消费 host 平面 `capitalCharts`（L6 与跨平面消费成立） |
| 2026-09-18 | 0.1.5-rc.1 → rc.2 | 设计修订（本文件 L10/L11）：图表呈现改走**官方 `deliverables/presented`**，客户端 turn-tail 卡片通道整体移除；L11 探针新增"`deliverables/presented` 仍在闭集词汇表内"断言。`npm test`（332）与 `check:dsh`（13）覆盖新面 |
| 2026-09-20 | 0.1.5-rc.2 | 真机复核通过（用户会话）：① 交付行点开 → 右侧 iframe 渲染自包含图表；② 重启后历史会话可正常加载（冷加载不再被拒）。**新发现落点问题**：交付行出现在中间过程轮而非总结轮 —— 实测 session `38bad3f9`：三张图在 turn 4/5 之间寄存，旧规则在下一次 `turn/start` 立刻冲刷，落进过程轮 turn 5，而总结答复在 turn 6。新增 **L14**（`agent/turn-stopping`，在 `turn/end` 之前派发、轮仍打开）作为首选冲刷时机，`turn/start` 降为兜底；`npm test`（333）与 `check:dsh`（14）覆盖 |

## 事故记录

| 日期 | 症状 | 根因 | 修法 |
|---|---|---|---|
| 2026-09-15 | 用户重启后 **dsh web 完全起不来**：`failed to import loader entry capital-charts ([object Object]): name.startsWith is not a function` | 把 `!!js` 表达式写进了 patch 行的 `name`；loader 只对 fiber 的 `config` 插值，`name` 原样进 ESM import | 行名改字面量；新增回归断言「任何行的 `name` 都必须是字面量字符串」 |
| 2026-09-15 | 行名改成 subpath 后 profile 能起，但**客户端半边静默消失**（图表 UI 永远不出现，无任何报错） | `locatePkgJson` 对「非 path-like 且非精确包名」直接 `return undefined`，这颗行被当成"不是客户端包" | 行名改成相对本 patch 目录的 path-like 写法 `./chart-ui/index.js`；新增断言复刻这条守卫 |
| 2026-09-18 | 升级到 0.1.5-rc.2 后，**凡出过图的会话 100% 打不开**：`failed to observe session … contains event type "capital/chart-rendered" (seq N) unknown to this harness and not marked ignorable; refusing to interpret the log` | 本仓自造会话事件类型 `capital/chart-rendered`。会话日志词汇表是**闭集**（`KNOWN_SESSION_EVENT_TYPES` 由 harness 仓库自己的 `SessionEventMap` 生成），读取侧 `validateStoredEvents()` fail-closed，而 `Session.append` 只转发 `sourceEventSeqs`/`surfaceOp`——**调用方无法设置 `ignorable`**。于是自定义事件"写时静默通过、冷加载时整份会话打不开"。**与版本无关**：rc.1/rc.2 的 `dsh-session-persistence` 逐字节相同（sha256 一致），只是升级必然重启，把一直存在的隐患暴露了（6 份会话中 4 份是升级前写的）。上游同类报告见 [discussion #5474](https://github.com/deepseek-ai/deepseek-harness/discussions/5474)，维护者裁定"事件名注册面"设计上被否决，正解是给 `append` 加 `{ ignorable: true }` | 图表呈现改用 **first-party `deliverables/presented`**（`dsh-tool-present` 用的同一类型，任何版本都认得），客户端不再注册任何图表专属会话投影；新增两道回归：`test/chart-turn-events.test.mjs`（append 只能使用已核验为 first-party 的常量）+ 探针 L11（该类型仍在闭集内） |
| 2026-09-15 | 以上两条**都没被当时的验证发现** | 用 `dsh --dump-config` 当验证手段——它只打印配置，不做插值也不导入任何行 | 新增 `npm run smoke:boot`：真启动 + 复核 `__DSH_BOOT__`；写进 runbook 第 5 步，标注"不能省" |
