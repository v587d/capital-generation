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
| L10 | Slot `conversation.chat.turnTail`（0.1.7 起 kind 由 `chain` 变 `list`）+ `TurnTailOwnerProps.{turn,seq,openFile}` | **已不用于本仓图表呈现**（卡片通道 2026-09-18 移除）。保留此条目是因为官方「本轮文件改动 / 交付」行就在这个座位上——我们不再抢它 | 探针**已退休（n/a）**：0.1.7 把该槽 kind 从 `chain` 改成 `list`，而本仓自 2026-09-18 起不消费这个面，留着只会制造假失败 | 与本仓无直接关联；若将来要再插自定义尾部内容，必须重新评估"抢座位"的后果 | —（本仓已无 turn-tail adapter） |
| L11 | `Session.append(type, data)`（**必须是 first-party 事件**）+ `ctx.sessions.get(id)` + `ctx.sessionProjections.stateOf(session, 'turnBoundary')` | 出图成功后由宿主往**根会话**追加官方 `deliverables/presented`，把 `chart.html` 登记为本轮交付物；事件不进 `deriveMessages()`，因此不污染模型上下文 | 在 `dsh-session/lib/index.js` 断言 `append(`、`deriveEventMessage` 的 `default: return null`，以及 **`"deliverables/presented"` 仍在 `KNOWN_SESSION_EVENT_TYPES` 闭集内**；在 `dsh-session-projection/lib/index.js` 断言 `stateOf(`；探针见 `check-dsh` L11 | 图表不出现在交付行（静默）；**最坏情况：写了一个闭集外的事件类型 → 整份会话冷加载被 fail-closed 拒绝（2026-09-18 实测事故）** | `src/chart/events.ts` |
| L12 | `agent/created` 事件（`this: Scoped<Agent>`，**路由键是 agent 对象本身**）+ `agent.ctx` + `tools.restrict({deny})` 的 scoped 语义 | 只在**根 Agent 自己的 scope** 上 deny `render_chart` / `subagent_visualization_specialist` / `prepare_chart_source`；子 Agent 是 standing 的兄弟 scope，不受影响。**监听必须注册在未打 scope 标签的 `ctx.root` 上**（`agentCarrier(agent) = scopeTarget(agent, agent)`，键是 agent 对象，standing-scope 的监听器按 `dsh-scope` 准入规则收不到 → 静默失效），再用 `agentPresets.composedPreset(agent.ctx)` 筛本 preset | 在 `dsh-agent/lib/types/runtime-types.d.ts` 断言 `'agent/created'`；在 `dsh-tools/lib/index.js` 断言 `tools.restrict() requires a scoped context`；在 `dsh-tool-subagent/lib/index.js` 断言上游自己就在 `agent/created` 回调里以 `agent.ctx` 做 scoped 注入（0.1.5 的这条证据在 `dsh-agent-presets`，该包 0.1.7 已拆成 `dsh-agent-preset` + `dsh-agent-preset-registry`，`agentPresets.composedPreset` 服务面不变）；探针见 `check-dsh` L12 | 主 Agent 又能看到出图/孙 Agent 创建工具（**且不报错**，纯静默）；或在 standing 层误 deny 连 specialist 一起砍掉 | `src/agents/root-tool-policy.ts` |
| L13 | `ctx.connection.requestRejection(req) → 401 \| 403 \| undefined`（`HostConnectionService` / `HostConnectionHandle`；401 = 缺/过期浏览器 cookie，403 = Host/Origin 不受信） | `/capital-charts` 序列旁路挂在自注册的 `webServer` prefix 路由上，必须**主动**接入这道围栏，否则绕过平台认证（2026-09 review：任何本机进程/页面凭 `chart_id` 即可读 `series.json`）。`connection` 缺席（Electron/file:// 载体）时退化成无认证面的旧行为 | 在 `dsh-client-connection/lib/types/rpc.d.ts` 断言 `requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection` 与 `ConnectionRequestRejection = 401 \| 403 \| undefined`；探针见 `check-dsh` L13。本仓回归见 `test/chart-host.test.mjs`（401/403、fail closed、认证先于方法/路径） | 序列旁路静默变成无认证端点（本机任意进程可读会话图表）；上游若把围栏拆成别的名字，探针具名失败而不是运行时才暴露 | `chart-ui/index.js` 的 `apply()` + `createRouteHandler({ authorize })` |
| L14 | `ctx.on('agent/turn-stopping', ({agent, turn, signal}))`（`@mode serial`，在 `turn/end` **之前**派发，轮仍打开、可安全 `append`；`dsh-scope` 准入：agent-scoped 监听器只收该 agent，未打标签的 root 监听器收全部） | 决定**交付行落在哪一轮**：寄存的图表必须在 owner 那一轮**即将关闭**时写入，否则会被下一次 `turn/start` 提前落进空的过程轮（2026-09-20 实测 session `38bad3f9`：交付行落进 turn 5，总结答复在 turn 6）。事件名不在宿主 Context 的静态 `keyof Events` 里，按本仓惯例模糊注册；注册失败即退回 `turn/start` | 在 `dsh-agent/lib/types/runtime-types.d.ts` 断言 `'agent/turn-stopping'` 与 `payload.turn`；在 `dsh-agent-loop/lib/index.js` 断言 `dispatch.serial("agent/turn-stopping"` 且位于 `this.session.append("turn/end"` **之前**；探针见 `check-dsh` L14。本仓回归见 `test/chart-turn-events.test.mjs`（首选在场时 `turn/start` 不得抢跑 / 缺席时退回兜底） | 事件名消失或派发点挪到 `turn/end` 之后 → 交付行退回旧行为（落进过程轮）；注册失败**不会**丢图（`turn/start` 兜底接上），但会静默退回旧落点 | `src/chart/events.ts` 的 `onTurnStopping` + `src/index.ts` 的适配器 |
| L15 | settings / credentials 扩展面（**0.1.7 形态**）：profile 条目 Config 里标了 `.volatile()` 的字段被 `volatileForm` 投影成表单，`describe()` 里 `ns` **恒等于条目 id**；客户端 `ctx.configForms.get(条目 id)` / `whileServed([条目 id], register)`；Slot `plugins.row.config`（`kind: 'keyed'`，key = `rowConfigKey(包名, 行 id)` = `<包名>#<行 id>`，页面按**行 id** 取表单）；官方表单件 `SettingsForm` / `SettingsFormModel` / `SettingsSecretField` / `Switch`；`ctx.remote.credentials.describe/set` + 转发的 `credentials/reference-updated` / `settings/document-updated` |   `capital-config` 是 host 平面 settings 卡片：**不注册命名空间**，只把条目 Config 的字段标成 `.volatile()`（那一张卡片的可编辑面就是它）；浏览器半边按条目 id 读写该表单、把密钥写进 credentials 域；主插件经 `settings.describe()` 读同一条目的解析值覆盖自身配置 |   在 `dsh-settings` 断言 `settings: SettingsForms`、`describe(): SettingsDescriptor[]`、`function volatileForm(schema)`、"没有任何 volatile 字段 ⇒ `undefined`"、`ns: entry.options.id`、`is not volatile`；在 `dsh-client-ui-settings` 断言 `get<T>(entryId)` 与 `whileServed(namespaces, register)`；在 `dsh-client-ui-plugin-manager` 断言 `plugins.row.config` 仍 keyed、`rowConfigKey` 声明、`#` 分隔的实现与 `form: formFor(openRow.rowId)`；在 `dsh-client-ui-primitives` 断言 `SettingsFormModel` / `SettingsSecretSpec` / `SettingsSecretField`；在 `dsh-api-remotes` 断言两个事件仍转发、`credentials/describe` + `credentials/set` 仍在；探针见 `check:dsh` L15。**运行期反证**：`smoke:boot` 探针断言真实 boot 的 `settings.describe()` 里确有 `ns === 'capital-config'` 且 `retriever.localFetch.enabled` 是布尔，并读 `pluginManager.listBundles()` 确认该 bundle **确有 `capital-config` 这一行**（卡片座位）。本仓回归：`test/capital-config.test.mjs`（**四处条目 id 一致** + 槽 key + 两处 schema 默认值一致）与 `test/apply-integration.test.mjs`（条目值真的驱动装配、条目缺席时回落） |   **静默**：条目 id / 行 id / 槽 key 任一处漂移 → 卡片在 Plugins 页消失（零报错，用户以为"设置里没这个插件"）；字段漏标 `.volatile()` → 条目不进 describe 镜像，整张卡片读不到、写入被 `Config field "…" is not volatile` 拒绝；credentials remote/事件改名 → 密钥写不进去、状态徽标不刷新 |   `capital-config/index.js`（`SETTINGS_ENTRY_ID` + `.volatile()` 声明）、`capital-config/client.src.cjs`（`ENTRY_ID` / `SLOT_KEY`）、`cordis.patch.yml` 的行 id、`src/index.ts` 的 `settings.describe()` 消费 |
| L16 | 工具**返回值**按工具自己声明的 `output.schema` 校验：`createSuccessResult` → `snapshotToolValue` → `validateJsonSchemaValue(tool.output.schema, detached, "value")`，违反即 `ToolOutputError`（`INVALID_TOOL_OUTPUT`）；判据含 `required` 必须**存在且非 undefined**、`additionalProperties: false` 拒绝未声明字段、`oneOf` 必须**恰好**匹配一支 | 所有模型工具的返回值；本仓 `test/output-contract.mjs` 是这条规则的镜像断言 | 在 `dsh-tools/lib/index.js` 断言 `snapshotToolValue(...)` + `validateJsonSchemaValue(tool.output.schema, detached, "value")` 仍在、`additionalProperties === false` 仍被检查；在 `lib/types/json-schema.js` 断言 `validateJsonSchemaValue` 仍命名导出、`missing required property` 判据仍在；在 `lib/types/index.js` 断言 `ToolOutputError` 仍带 `INVALID_TOOL_OUTPUT`；探针见 `check:dsh` L16。本仓回归见 `test/time-tools.test.mjs` 的「输出契约」用例（两种形态）与 `test/data-junior-tools.test.mjs` / `test/describe-dataset.test.mjs` 的同类断言 | **致命且看起来像模型犯错**：本地 test 直接调 `execute` 绕过这层校验，于是多形态工具只要有一种形态少返回一个 `required` 字段，真机上该形态**每次调用都失败**（`returned invalid output: missing required property ...`），模型只看到一句 invalid output、往往重试同一条调用；2026-09-23 实测 `resolve_data_time_range` 的 capability 形态连败 3 次、子 Agent 整个卡住（会话 `cf464cb6`） | 工具定义的 `output.schema`（多形态工具用「全部属性可选 + `required` 只列各形态都返回的字段」）|
| L17 | `@deepseek-ai/dsh-agent-preset` **声明行**：`Config = PresetDefinition = { id, name?, description?, order?, plugins: EntryOptions[] }`；`dsh-agent-preset-registry` **既不扫目录也不接受 preset 路径**（`register(definition)` 是唯一入口，旧 `config.roots` 写法已消失） | `preset/capital-generation/agent.patch.yml` 用一颗 insert 行声明 Capital 预设；`config.id`（`capital-generation`）是**写进会话日志的身份**，历史会话靠它恢复。根收敛仍靠 `agentPresets.composedPreset(agent.ctx)` 筛本 preset | 在 `dsh-agent-preset/lib/types/index.d.ts` 断言 `export type Config = PresetDefinition` 与 `[EntryGroup.key] = true`；在 `dsh-agent-preset-registry/lib/types/definition.d.ts` 断言 `id` / `plugins` 两个字段；在 `.../types/index.d.ts` 断言 `agentPresets` 服务、`composedPreset(ctx)`、`register(definition)`，并**反向**断言没有 `roots`；探针见 `check:dsh` L17。**运行期反证**：`npm run smoke:boot` 的 boot 内探针读 `agentPresets.resolve('capital-generation').broken`（另用"重复声明同一 id"的反向对照证明这道闸门能失败）。本仓回归：`test/preset-rows.mjs` 是全仓唯一的装配读取器，`test/persona.test.mjs` / `test/dev-docs.test.mjs` / `test/chart-composition.test.mjs` 都从这颗声明行读 | **致命且滞后**：registry 改名或不再吃声明行 → `capital-generation` 根本不注册，启动期一切正常，直到用户打开历史会话才 `RemoteError: Unknown agent preset: capital-generation`（issue #3 的第二条根因）；`composedPreset` 改名 → 根收敛**静默**失效（主 Agent 又看见 `render_chart`） | `preset/capital-generation/agent.patch.yml`（行本身与 `config.id`）+ `src/agents/root-tool-policy.ts` |
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
- **DSH 的 web 抓取包（`ctx.web` / `dsh-web-fetch-http` / `dsh-tool-web`）**：`web_retriever_fetch`
  在 AnySearch 明确失败后的本机直连回退是**自研**实现，刻意不引这三个包，三条理由：
  ① `ctx.web` 是**单通道选择器**——只在 `WebRuntimeConfig.fetchProvider` 指定时用它，否则要求
  "恰好一个可用 provider"，**没有 per-call 选择**；而本机 profile 里 AnySearch 插件已把
  `fetchProvider` 钉成 `anysearch`，用它做回退等于把同一条失败的路再走一遍。
  ② 本包**运行期解析不到** DSH 的包：Node 从 `<repo>/lib` 逐级向上找 `node_modules`，而 DSH 的包在
  `~/.dsh/profiles/*/node_modules`，不在这条链上；要真用必须把 `dsh-web-fetch-http` 连同
  `dsh-web` / `dsh-timeout` / `dsh-http-proxy` / `ipaddr.js` / `undici` 写进本包依赖并与宿主版本对齐
  （版本漂移＝静默行为改变）。
  ③ 官方 provider **只回原始 HTML**（`WebFetchBody = { kind: 'html' | 'text' }`），转 markdown
  仍要自己做，并不省一半工作量。
  因此本方案**不新增任何 DSH 接口面**：`check:dsh` 的探针条数不因回退而增加，无需新增探针。
  本地回退的取舍、安全边界与已知局限见 `docs/design/web-retriever-local-fetch.md`。
- **DSH 的 OCR / 文档解析能力**：`ocr`（§4.3 → `docs/dev/web-retriever.md`）直连第三方
  PaddleOCR AIStudio 的异步 job API，出网全部走**同一个**自研 `createHttpRequester`
  （不引 `ctx.web`，也不给 `HttpRequest` 加第二种出口实现）。这是一条**新的第三方出网依赖**，
  但**不是**新的 DSH 接口面——探针仍是 15 条。密钥只进 credentials 域（`PADDLE_OCR_TOKEN`），
  宿主没有"托管 OCR"这类服务可替代。

## 升级 runbook

1. 读上游发布说明 / diff，重点看：客户端模块组合、Slot 目录、`@deepseek-ai/dsh-tool-subagent`、
   `dsh-host-webserver`、**Loader 的行名解析（`locatePkgJson`）与 include 的 `baseUrl` 设置**。
2. `npm run check:dsh` —— 先看哪条账本失配。
3. 对照上表的"修复位置"改**本仓 adapter**；**不要为了变绿改探针**（探针断言的是上游事实，
   不是我们的措辞）。确属上游有意变更时，同时更新本文件与探针。
4. `npm test`（含打包测试与组合测试）。
5. **`npm run smoke:boot`** —— 在 workspace 内搭 scratch profile 并**真的把 dsh 跑起来**，一次跑两件事：
   - **正向**：复核 index.html 的 `__DSH_BOOT__` 里有 chart-ui / capital-config 的 bundle；并在 boot
     内由一颗一次性探针行读**运行期事实** —— `agentPresets.resolve('capital-generation')` 的
     `broken`（registry 会等 Host 树 settle 后逐行复核，`broken=null` 即预设子树全部可用）、
     `settings.describe()` 里有没有 `capital-config` 这条镜像（叶子漏 `.volatile()` 就是 absent），
     以及 `pluginManager.listBundles()` 里该 bundle **有没有 `capital-config` 那一行**（卡片座位）。
     这三项正是 issue #3 两个根因与"设置跑哪儿去了"的判据，**只在真启动里才可观测**。
   - **反向对照**：另起一颗 profile，**故意重复声明**同一个预设 id，确认失败特征真的会触发
     （实测 `Duplicate agent preset: capital-generation` + `1 entry did not activate`）。
     闸门抓不到的东西看起来就像通过 —— 上表 2026-09-15 那行说的就是这个。
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
8. **0.1.7 settings 卡片与预设的浏览器半边复核**（第 5 步的探针只能证明**宿主侧**那条链）：
   卡片**不在「设置」页**（`settings.plugin.item` 已被上游删除），点击路径是
   **侧栏「插件」→「已安装」的 `@v587d/capital-generation` → 「包含的组件」里的 `capital-config` 行
   → 行详情页的配置段**（`plugins.row.config` 的键 = `@v587d/capital-generation#capital-config`）。
   进去之后：四个密钥字段能存进 credentials 域并显示状态徽标，「本地直连回退」开关拨动后
   **刷新页面仍是那个值**（写进条目 config 且 `applies: live`）；然后**打开一条升级前出过图的旧
   Capital 会话** —— 头部记着 `"agentPreset":"capital-generation"` 的会话在本机有 263 份，
   读不回就是 issue #3 的原始症状（`Unknown agent preset`）。第 5 步的探针已经把"这一行存在吗"
   打出来了（`pluginManager.listBundles()` 的行清单），所以"找不到卡片"先回冒烟看那一行。
9. **运行期依赖（本地直连回退引入）**：本插件现在有真正的运行期依赖（`turndown` /
   `@joplin/turndown-plugin-gfm`，均为纯 JS），升级/安装必须让它们一起装进去 ——
   `dsh plugin --profile web update @v587d/capital-generation`（或 `add`）之后**重启进程**
   （ESM 缓存 + profile 行在启动时确定）。若 `web_retriever_fetch` 报"找不到模块"，
   按「恢复手册」重装插件，**不要**手动往 profile 里塞包。

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

本地直连回退是**可选增强**：依赖缺失（或配置 `retriever.localFetch.enabled: false`）时的表现是
"回退不可用、AnySearch 失败仍如实回传"，**不是**整个插件或会话起不来——这一点必须与图表
bundle 缺失的**致命失败**区分开。

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
| 2026-09-20 | 0.1.5-rc.2 | 真机复核：① 交付行点开 → 右侧 iframe 渲染自包含图表；② 重启后历史会话可正常加载。**新发现落点问题**：交付行出现在中间过程轮 —— 实测 session `38bad3f9`：三张图在 turn 4/5 之间寄存，旧规则在下一次 `turn/start` 立刻冲刷，落进过程轮 turn 5，而总结答复在 turn 6。新增 **L14**（`agent/turn-stopping`，在 `turn/end` 之前派发、轮仍打开）作为首选冲刷时机，`turn/start` 降为兜底 |
| 2026-09-20 | 0.1.5-rc.2 | **交付呈现通道端到端打通（真机确认）**。连查四轮，最终由**落盘 trace**（`capital-analysis/charts/<id>/deliverable-trace.txt`）定位真根因：`src/index.ts` 用**对象展开**组装交付 ctx，而 cordis Context 的 `get`/`on`/`effect` 挂在**原型**上 ⇒ `ctx.get` 丢失 ⇒ `buildChartEventPublisher` 首行抛 `ctx.get is not a function` ⇒ 被 `tool.ts` 的 `catch {}` 吞掉 ⇒ **`publish()` 从未执行**（该通道自加入起就没真正跑过）。改为逐项显式转发；并修掉四个连带缺陷（owner 归档键 / turn-stopping 注册失败未回退 / 队列实例级 / 发布器非单例）。真机日志：`图表已寄存 … owner=session-bac05ffe… lastTurn=4 寄存 1 张` → `图表已登记为本轮交付 … turn=5`，卡片出现在 turn 5。复查：23 个会话**冷加载 0 失败、闭集外事件 0**。`npm test`（338）与 `check:dsh`（14）覆盖 |
| 2026-09-20 | 0.1.5-rc.2 | 交付通道诊断**默认关闭**（`CAPITAL_CHART_TRACE=1` 才输出进度日志 + 落盘 `deliverable-trace.txt`）：调试产物不进对外版本的终端与 workspace。失败用的 `warn` 不受开关影响。新增 `npm run verify:sessions`（真实后端逐份冷加载 + 闭集词汇表核对，区分历史遗留与新回归） |
| 2026-09-21 | 0.1.5-rc.2 | 新增 **L15**：`capital-config` settings 卡片的整条扩展面（host `settings.register` / 客户端 `settingsScope.bind` / `settings.plugin.item` keyed 槽 / credentials remote + 转发事件）纳入账本与 `check:dsh`（14 → 15 条）。本仓回归：`test/capital-config.test.mjs` 断言 host 命名空间 ≡ 客户端键、两处 schema 默认值一致；`smoke:boot` 同时复核 `capital-config` 与 `capital-charts` 两个 bundle 进 boot graph |
| 2026-09-21 | 0.1.5-rc.2 | 本地直连回退（Task 1–11）：`web_retriever_fetch` 在 AnySearch 明确失败后**自动**本机直连抓取，回执新增 `via` / `fallback` / `truncated` / `local_error`。**不新增 DSH 接口面**（刻意不引 `ctx.web` / `dsh-web-fetch-http` / `dsh-tool-web`），`check:dsh` 仍为 15 条全绿；新增两个纯 JS 运行期依赖（`turndown` / `@joplin/turndown-plugin-gfm`）；两处 schema 的 `retriever.localFetch` 默认值一致由 `test/capital-config.test.mjs` 守着；SSRF 闸门/取消语义/回退矩阵由 `test/web-retriever-*.test.mjs` 覆盖 |
| 2026-09-26 | **0.1.7-rc.2** | **破坏性升级适配（issue #3）**：**L15 整条重写**（`settings.register` / `settingsScope` / `settings.plugin.item` 被上游删除 ⇒ 改为条目 Config 的 `.volatile()` 投影 + `configForms.get/whileServed` + `plugins.row.config`，命名空间就是 profile 条目 id）；**新增 L17**（预设改由 `@deepseek-ai/dsh-agent-preset` 声明行注册，registry 不再扫目录 / 不收 `roots`）；**L10 探针退休**（该槽 kind 由 chain 变 list，本仓早已不消费）；**L12 证据文件**从 `dsh-agent-presets` 改到 `dsh-tool-subagent`。卡片改用官方表单件（`SettingsForm` / `SettingsFormModel` / `SettingsSecretField` / `Switch`，外链图标已被删）。运行期依赖 `@deepseek-ai/schemastery` 抬到 **^3.18.4**（`.volatile()` 的最低版本），`capital-config/package.json` 的 `dsh.client.inject` 从 settings-plugins 换到 **plugin-manager**。`npm test`（614）与 `check:dsh`（17）覆盖 |
| 2026-09-26 | 0.1.7-rc.2 | `npm run smoke:boot` **扩成两条腿**（runbook 第 5 步）：正向在 boot graph 里加一颗一次性探针行，读运行期的 `agentPresets.resolve('capital-generation')`（实测 `broken=null` ⇒ 预设子树无不可用行）与 `settings.describe()`（实测含 `capital-config`，`retriever.localFetch.enabled=true`）与 `pluginManager.listBundles()`（实测该 bundle 的行 = `capital-config, capital-charts, preset-capital-generation`，即卡片座位真的存在）；反向另起 profile **重复声明**同一预设 id，实测被 `Duplicate agent preset` + `1 entry did not activate` 抓到 —— 证明这条闸门**能失败**。历史会话侧只核到"头部记的 id 就是 `capital-generation`、且 registry 解析得开"（本机 263 份记着该 id）；**卡片在浏览器里的可见/可写与旧会话真正打开仍待人工复核**（第 8 步）。`npm test`（614）+ `check:dsh`（17）全绿 |
| 2026-09-26 | 0.1.7-rc.2 | **真机整体冒烟 8/8**（真实 profile + 真实 workspace，非 scratch）：版本与时钟、bash 与文件沙箱、三个 skill 连续加载、子 Agent 编排（预检 → 创建 → 中途消息 → 结算）、数据链路（`resolve_data_time_range → describe_capability → request_data` 一次成功）、质检链路（`describe_dataset` 一次出 profile，validation=pass）、网页检索（anysearch 收敛 + fetch，`via=anysearch` 未触发本机回退）、图表渲染（主路径与 `prepare_chart_source → visualization_specialist` one-shot 双通道落盘，warnings 空）。**未覆盖**：插件页卡片可见/可写、升级前旧会话恢复（本次跑的都是新会话）——即上面第 8 步。**副产物**：真机暴露"主 Agent 要求停在 profile、可视化 gate 仍自动出图"的范围冲突，已按 `docs/dev/data-roles.md` §1.1 与 skill 的委派收窄规则双侧写清，并由 `test/persona.test.mjs` 钉住 |

## 事故记录

| 日期 | 症状 | 根因 | 修法 |
|---|---|---|---|
| 2026-09-15 | 用户重启后 **dsh web 完全起不来**：`failed to import loader entry capital-charts ([object Object]): name.startsWith is not a function` | 把 `!!js` 表达式写进了 patch 行的 `name`；loader 只对 fiber 的 `config` 插值，`name` 原样进 ESM import | 行名改字面量；新增回归断言「任何行的 `name` 都必须是字面量字符串」 |
| 2026-09-15 | 行名改成 subpath 后 profile 能起，但**客户端半边静默消失**（图表 UI 永远不出现，无任何报错） | `locatePkgJson` 对「非 path-like 且非精确包名」直接 `return undefined`，这颗行被当成"不是客户端包" | 行名改成相对本 patch 目录的 path-like 写法 `./chart-ui/index.js`；新增断言复刻这条守卫 |
| 2026-09-18 | 升级到 0.1.5-rc.2 后，**凡出过图的会话 100% 打不开**：`failed to observe session … contains event type "capital/chart-rendered" (seq N) unknown to this harness and not marked ignorable; refusing to interpret the log` | 本仓自造会话事件类型 `capital/chart-rendered`。会话日志词汇表是**闭集**（`KNOWN_SESSION_EVENT_TYPES` 由 harness 仓库自己的 `SessionEventMap` 生成），读取侧 `validateStoredEvents()` fail-closed，而 `Session.append` 只转发 `sourceEventSeqs`/`surfaceOp`——**调用方无法设置 `ignorable`**。于是自定义事件"写时静默通过、冷加载时整份会话打不开"。**与版本无关**：rc.1/rc.2 的 `dsh-session-persistence` 逐字节相同（sha256 一致），只是升级必然重启，把一直存在的隐患暴露了（6 份会话中 4 份是升级前写的）。上游同类报告见 [discussion #5474](https://github.com/deepseek-ai/deepseek-harness/discussions/5474)，维护者裁定"事件名注册面"设计上被否决，正解是给 `append` 加 `{ ignorable: true }` | 图表呈现改用 **first-party `deliverables/presented`**（`dsh-tool-present` 用的同一类型，任何版本都认得），客户端不再注册任何图表专属会话投影；新增两道回归：`test/chart-turn-events.test.mjs`（append 只能使用已核验为 first-party 的常量）+ 探针 L11（该类型仍在闭集内） |
| 2026-09-26 | 用户升级到 0.1.7-rc.2 后 `dsh web` **打开即失败**：`web boot: 1 entry did not activate / @v587d/capital-config: pending (waiting for service: settingsScope)`；同时历史 Capital 会话恢复报 `RemoteError: Unknown agent preset: capital-generation`（第三方报告即 issue #3） | 两条同族的"上游删了旧扩展面、我们还按 0.1.5 写"：① settings 整条注册通道（`settings.register` / `settingsScope.bind` / `settings.plugin.item`）被删除，可编辑性改成**条目 Config 的 `.volatile()` 投影**、命名空间恒等于 profile 条目 id；② 预设挂载改成 `@deepseek-ai/dsh-agent-preset` **声明行**，registry 既不扫目录也不接受 `config.roots` —— 于是那颗 insert 行根本没注册预设，症状延后到"打开历史会话"才出现。**我们自己的探测缺口**：`smoke:boot` 只复核 bundle 进 `__DSH_BOOT__`，不检查**预设**激活；`check:dsh` 的 L15 探针当时断言的正是被删掉的那三个名字 | 按 0.1.7 契约重写卡片两侧（L15 探针同步）+ 预设迁到声明行并**新增 L17**；把四处 id（patch 行 id / host / 主插件 / 浏览器半边）与槽 key 钉进 `test/capital-config.test.mjs`；`test/packaging.test.mjs` 增加"`dsh.bundle.patch` 数组里每颗文件都在发布清单里"的闸门；`scripts/smoke-boot.mjs` 补上这两件：boot 内探针行（resolve + describe）与"重复声明预设"的反向对照（第 5 步）|
| 2026-09-15 | 以上两条**都没被当时的验证发现** | 用 `dsh --dump-config` 当验证手段——它只打印配置，不做插值也不导入任何行 | 新增 `npm run smoke:boot`：真启动 + 复核 `__DSH_BOOT__`；写进 runbook 第 5 步，标注"不能省" |
