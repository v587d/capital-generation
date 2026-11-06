# 宿主升级分析报告：dsh 0.2.1-rc.5 → 0.2.2-rc.1

> **维护者文档**，不注入模型、不进 skill 目录。调查方式：只读——GitHub release note 与
> `compare/dsh-v0.2.1-rc.5...dsh-v0.2.2-rc.1`（2623 commits）；npm 把 0.2.2-rc.1 装进工作区临时
> prefix，与本机 rc.5 实装逐包对照；`check:dsh` 对着新宿主跑 37 条账本；最后升级本机 npm-global
> 并用 `npm test` + `smoke:boot` 真启动复核。**本文同时记录 2.18.0 的执行结果与实机业务复核**（验证数据见 §5 / §5.1）。
> 日期：2026-11-06。

## 0. 结论

1. **0.2.2-rc.1 是一次结构性版本，不是一个补丁。** 上游把“工具呈现方式”从一颗选择器拆成
   `@deepseek-ai/dsh-tool-executor-native` / `-ptc` 两个 executor，把工具调用管线与并发调度从
   `dsh-tools/lib/index.js` 拆到 `lib/pipeline.js`，把 `tools.guard` 与 `tools.layers` 拆成两个
   ScopedLayers，并重做了交付卡重放。本仓 37 条账本里 **7 条**因此失配（L6 / L11 / L12 / L16 /
   L30 / L31 / L35），全部按上游事实改 adapter 或改探针，**没有一条是靠删断言变绿的**。
2. **唯一会让整颗 preset 静默消失的断点是 `dsh-tool-subagent-control/list-agents` subpath 被删。**
   0.2.2 把 `send_message` / `interrupt_agent` / `list_agents` 一起放进主入口；旧 preset 里那一行
   子路径行装载失败 → 根 preset `broken` → 根侧所有族行 `fiberState=null`，界面上只剩角色 preset。
   2.18.0 删掉该行，并让叶子角色照样只拿 `send_message`。
3. **PTC 的声明面换了。** 0.2.1 的 `@deepseek-ai/dsh-agent-tool-presentation`（`mode: ptc` +
   `presentAs`）在 0.2.2 只剩 **Deprecated** 兼容壳；`tool-presentation` 行改为直接挂
   `@deepseek-ai/dsh-tool-executor-ptc`（`maxParallelSubCalls: 10`），行 id 不变，宿主
   `ptc-runtime` 仍由 `dsh-base` 提供。旧壳仍能跑，但继续用它等于把升级卡在一个已弃用的面上。
4. **委派行 Config 的 `modelSelectionSettings` 拆成 `modelSelection` + `modelDiscovery`。** 本仓
   preset 从未写这两个键，所以装配零动作；但账本、探针与文档必须跟着改，否则下一个人会按旧键写。
5. **交付卡改为重放整轮。** `presentedForClosing` 去掉了 `file.seq < owner.seq` 过滤，收尾回复
   之后写入的 `deliverables/presented` 也会显示。本仓仍在收尾流 `finish` 帧写入——那里是
   “这轮是纯文本收尾”的唯一判定点，不再是为了躲 seq 截断。
6. **宿主基线必须精确 pin。** 兼容预检仍是 `semver.satisfies(runtime, range, { includePrerelease:
   true })`；2.18.0 的两个 dsh peer 精确 pin `0.2.2-rc.1`，`^0.2.1-rc.5` 会放进未测的 0.2.2 系列。
7. **本机 Node 24.18.0 满足新门槛（≥24.9）**；`npm install -g @deepseek-ai/dsh@0.2.2-rc.1` 一次
   成功，`dsh --version` 已是 `0.2.2-rc.1`。运行中的宿主进程仍是旧内存镜像，**需重启宿主**。

## 1. 基线

升级前（2.17.0）：

| 字段 | 值 | 说明 |
|---|---|---|
| `peerDependencies["@deepseek-ai/dsh-skill"]` | `0.2.1-rc.5`（精确） | 命中预检的 dsh peer |
| `peerDependencies["@deepseek-ai/dsh-skill-filesystem"]` | `0.2.1-rc.5`（精确） | 同上 |
| `peerDependencies["@deepseek-ai/cordis"]` | `^4.0.2` | 不匹配 `@deepseek-ai/dsh*`，不参与预检 |
| `devDependencies` | three dsh packages = `^0.2.1-rc.5`；cordis `^4.0.2`；schemastery `^3.18.4` | 类型侧与本地回归 |
| 本机全局宿主 | `@deepseek-ai/dsh@0.2.1-rc.5` | `~/.npm-global` |
| 本机 profile | `web` / `capital` 均 `link:/home/shawn/projects/capital-generation` | 改工作区即改插件 |

升级后（2.18.0）：两个 dsh peer 精确 pin `0.2.2-rc.1`；三颗 devDependency 与 lockfile 同步；
cordis → `~4.1.0`，schemastery → `^3.19.0`。

## 2. 上游变化总表（与本仓相关的部分）

| 变更 | 上游落点 | 与本仓的关系 | 结论 |
|---|---|---|---|
| **工具执行面拆成 executor 插件** | 新增 `dsh-tool-executor-native` / `dsh-tool-executor-ptc`；`dsh-tools` 用 `setExecutor()` 按 scope 选最近一层 | junior 的 `tool-presentation` 行；根/其他角色继承部署级 native | **改 preset**：直接挂 PTC executor；探针 L35 重写 |
| **presentation 选择器弃用** | `dsh-agent-tool-presentation` 只剩兼容壳，`mode` + `presentAs` 不再推荐 | 本仓不再使用 | **零运行期依赖**；探针断言其 manifest 标 Deprecated |
| **工具管线与并发调度拆包** | `snapshotToolValue` / `validateJsonSchemaValue` / `executionMode` / 并发池 → `dsh-tools/lib/pipeline.js`、`lib/shared-*.js` | L16 / L30 的探针落点 | **改探针**；并发语义未变（严格 `true` 才 parallel、默认 10） |
| **`tools.guard` 与 `tools.layers` 分家** | `tools.guards` 是独立 ScopedLayers | smoke 读 `tools.layers.global.guards` | **改 smoke 探针**为 `tools.guards.global.guards`；三颗身份闸门仍在场 |
| **`webServer.register` 收联合路由** | `register(route: WebRoute \| WebResourceRoute)` | 我们只用 handler 分支 | **改探针**；路由行为不变 |
| **委派行 Config 改名** | `modelSelectionSettings` → `modelSelection` + `modelDiscovery` | preset 未使用这两个键 | **改账本/探针**；旧键被 zod 静默剥掉 |
| **`tool-subagent-control` 主入口合并** | 主入口注册 `send_message` / `interrupt_agent` / `list_agents`；`/list-agents` subpath 删除 | 根 preset 的独立 list-agents 行 | **删行**；角色侧把 `list_agents` 加进兄弟 deny |
| **交付卡重放整轮** | `presentedForClosing` 去掉 `file.seq < owner.seq` | 图表交付写入点与文档 | **行为不变**；改注释、账本、探针 |
| **Session Projection 注册 API 异步化** | `sessionProjections.register()` 返回 Promise/handle | 本仓只读 `stateOf`，不注册 | **零动作** |
| **Cordis 4.1 / Loader 1.1 / Include 1.1** | 配置访问、条目变更、持久化统一 | `ctx.effect` / `ctx.inject` / `ctx.get` / `ctx.root` | **零动作**（单元测试与 smoke 都过） |
| **官方组合包列表移到 `dsh-official-bundles`** | `dsh-app-boot` 不再导出该表 | 本仓不读官方组合包列表 | **零动作** |
| **自动化任务改为宿主级管理** | 宿主 automation 插件 | 本仓 `capital-automation` 是独立 bundle、自有路由与域 | **零动作**（smoke 的 16 任务 / 看板照常） |
| **Node.js 最低 24.9** | `engines` | 本机 24.18.0 | 满足；README/CHANGELOG 已写 |
| **locale 扩到 de/es/fr/ja/pt/ru** | 各包 locale | 本仓只读英文/中文按钮文案 | **零动作** |

静态边界核对（逐包 `diff -rq`，非 manifest 差异）：本仓真正消费的 host 包里，`dsh-skill` /
`dsh-skill-filesystem` / `dsh-system-prompt` 的**公开类型零 diff**；`dsh-agent-preset` 的
`composedPreset` / `select` 时机不变（L32 仍绿）；`dsh-storage-domain` / `dsh-settings` 的公开面
不变（L15/L20 仍 n/a 或绿）；`dsh-tool-fs` 的四颗工具名与 `read` 包络不变（L29 绿）。

## 3. 兼容闸门的精确机制

实现仍是 `packages/boot/app-boot/src/plugin-compatibility.ts`：

- manifest 有 `engines.dsh` → **只认它**，忽略 `peerDependencies`；
- 否则逐个检查 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` peer，
  `semver.satisfies(runtime, range, { includePrerelease: true })`；
- 不满足 → `PluginCompatibility`；`dsh plugin add/update` 直接拒绝，启动 profile 时该行 `disabled`。

实测（本机 0.2.2-rc.1，2026-11-06）：`evaluatePluginCompatibility(package.json)` → `undefined`。
semver 仍是老结论：`^0.2.1-rc.5` 在 includePrerelease 下会放进未测的 0.2.2 系列，**继续精确 pin**。

## 4. 2.18.0 的采用方案

### 4.1 已改文件

| 文件 | 动作 |
|---|---|
| `package.json` | 两个 dsh peer → `0.2.2-rc.1`；cordis → `~4.1.0`；三颗 dsh devDep → `^0.2.2-rc.1`；schemastery → `^3.19.0`；`version` → `2.18.0` |
| `package-lock.json` | 17 颗 `@deepseek-ai/*` 的 version / resolved / integrity / 相互引用同步；新增 `dsh-fs-patch` |
| `chart-ui/` `config/` `watchlist/` `automation/package.json` | 嵌套包版本 → `2.18.0` |
| `preset/capital-generation/agent.patch.yml` | `tool-presentation` 行改挂 `@deepseek-ai/dsh-tool-executor-ptc`（`maxParallelSubCalls: 10`）；删 `tool-subagent-list-agents` 子路径行 |
| `src/agents/role-tool-policy.ts` | `SIBLING_DENIED_TOOLS` 加 `list_agents`（主入口把它焊进每颗角色）；注释同步 |
| `src/chart/delivery.ts` / `src/present-entry.ts` / `src/chart/present-tool.ts` | 交付卡“只重放收尾消息之前”的注释改为 0.2.2 的整轮语义；写入点理由改为“收尾轮判定” |
| `scripts/check-dsh-compat.mjs` | L6 / L11 / L12 / L16 / L30 / L31 / L35 七条探针按新落点重写 |
| `scripts/smoke-boot.mjs` | guard 层读取面改 `tools.guards.global.guards` |
| `test/ptc-preset.test.mjs` / `test/persona.test.mjs` | PTC 行改 executor；角色 deny 两颗；行组合断言同步 |
| `scripts/verify-sessions.mjs` / `test/session-files.test.mjs` | 0.2.2 的 JSONL 后端改为插件 `apply`；脚本挂载后取 `sessionPersistence`，并加导出面回归 |
| `test/role-tool-policy.test.mjs` | 逐名 deny 的计数从 1 改为 `SIBLING_DENIED_TOOLS.length`；guard 用例覆盖 `list_agents` |
| `src/web-retriever/local-fetch.ts` / `wind-client.ts` | 客户端版本常量 → `2.18.0` |
| `README.md` / `CONTRIBUTING.md` / `.github/workflows/test.yml` | 基线徽章、正文、CI 安装版本 → `0.2.2-rc.1` / `2.18.0` |
| `preset/capital-generation/README.md`、`docs/dev/*.md`、`docs/reference/dsh-surface-ledger.md` | PTC、list-agents、并发/输出校验落点、交付重放同步 |
| `CHANGELOG.md` | 新增 2.18.0 段与迁移说明 |

不需要动：`src/tool-exec.ts`（授权判据）、数据源与 Dataset 契约、settings 卡片结构、
`/capital-*` 路由围栏、自动化存储与调度、`vendor/`。

### 4.2 用户侧的升级顺序

先升宿主，再更新插件（2.18.0 要求 0.2.2-rc.1）。反过来做，插件先被兼容预检禁用，需要再执行一次
`dsh plugin --profile <profile> update @v587d/capital-generation` 才能恢复；桌面端缺少 stderr
时尤其容易卡住。应急通道仍是 `dsh plugin allow-version`，但它只豁免 manifest 检查，运行时导入
仍跨版本。

## 5. 验证结果（2026-11-06，本机）

**本机宿主升级**：`npm install -g @deepseek-ai/dsh@0.2.2-rc.1` → `dsh --version` =
`0.2.2-rc.1`；`npm ls -g --depth=0` 只剩一颗 `@deepseek-ai/dsh@0.2.2-rc.1`。

| 检查 | 结果 |
|---|---|
| `npm run check:dsh`（对 0.2.2-rc.1） | **37 / 37** 条账本通过 |
| `npm test`（对 0.2.2-rc.1） | **1392 / 1392** 通过（含 2.18.0 版本闸门、两处 deny 计数修复与 1 条 JSONL 后端导出面回归） |
| `npm run smoke:boot` | 通过：`broken=null`、20/20 族行 ACTIVE、12 行 bundle 组件、3/3 身份闸门、PTC executor 行 `fiberState=2`、`ptcRuntime=present`、settings 条目 present、三条路由围栏 401/200 |
| 兼容预检 | `evaluatePluginCompatibility(package.json)` → `undefined` |
| 运行中的 GUI | 2026-11-06 09:57 用户重启 `dsh web`；新进程（PID 10097）`dsh --version` = `0.2.2-rc.1`，`plugin_manager.list_bundles()` 报本 bundle `2.18.0` / enabled；`~/.dsh/storages/capital-automation-locks` 与 `capital_automation.json` 在 09:57–09:58 写入，说明 web profile 里的本插件已加载并运行 |

未做：自选股弹窗、图表卡片内联渲染（交付事件与自包含 HTML 已实测，见 §5.1）、思考内容样式。

### 5.1 2.18.0 实机业务复核（2026-11-06）

`smoke:boot` 只证明行能激活；这一轮在独立 scratch web profile 上跑真实会话：只挂
`dsh-base` + `dsh-web-app` + `capital-generation` 2.18.0，独立 `DSH_HOME` 与 credentials 副本，
用真实 `/api/session/create` + `/api/session/prompt` 驱动 Agent，UI 用 headless Chromium 打开
同一 profile。**不复用用户真实 profile 的会话数据。**

| 业务路径 | 实测证据 | 结论 |
|---|---|---|
| 自动模式（取数） | 600519.SH 最近 3 个交易日 → `fuyao` 2 份 Dataset（7/8 行）、`capital-data/datasets/<id>/raw.json` 落盘 | ✅ |
| 分析师 / PTC | `data_junior` 12 段 `run_code`；`describe_dataset` / `query_dataset` / `prepare_chart_source` / `send_message` 在 PTC 内均执行；`tool/ptc-dispatch` 事件成对出现 | ✅ 0.2.2 executor 行与宿主 runtime 相接 |
| 出图与交付 | `render_chart` → `chart_9f02…`、`capital-analysis/charts/ch_3449…/`（HTML 224K，headless Chromium 实渲 7 点折线）；根会话 turn 2 写入 1 条 `deliverables/presented` | ✅ 收尾流写入点仍成立 |
| 叶子工具面 | collector：`request_data` / `send_message`；junior：仅 `run_code`；specialist：`render_chart`；三者均无 `list_agents` | ✅ 0.2.2 焊入主入口的 `list_agents` 被逐名 deny 掉 |
| 资讯专员 | `capital-web-retriever` 会话：`eastmoney_announcements` 先返回 0（窗口内无公告，合法空结果），放宽窗口返回 5 条并正确标注 `authoritative_reprint` / `not_verified` | ✅ 零密钥来源与空结果语义未变 |
| 设置卡片 | 真实 UI：bundle 详情页四格 tab（Data Sources / Research automation / Selected Skills / Components 12）与凭据状态正常 | ✅ |
| 投研自动化 | 真实 UI：看板、任务/运行 tab、单 scheduler lease 提示；`/capital-automation/meta` 在 scratch 下 `tasks=16/16`、`storage=ready` | ✅（scoped host 下 scheduler 暂停是单 lease 的预期行为） |
| 会话闸门 | `npm run verify:sessions -- --strict` 对 6 份 scratch 会话：1 份含交付事件，0 份闭集外事件，0 份冷加载失败 | ✅（修复后，见下） |

**本轮新发现与原因**

| 现象 | 直接原因 | 归类 |
|---|---|---|
| `npm run verify:sessions` 启动即 `TypeError: Backend is not a constructor` | 0.2.2 的 `@deepseek-ai/dsh-session-persistence-jsonl` 把默认导出的后端类换成插件 `apply`；脚本仍 `new Backend(...)`。`check:dsh` 没有这条账本、`npm test` 也不调用该脚本，所以 37/37 与 1391/1391（修复前）都绿而闸门已失效 | **升级漏改，已修**：改为挂载到裸 `Context` 后取 `sessionPersistence`；新增 `test/session-files.test.mjs` 用例钉住 `apply` 导出面 |
| 重启 scratch 宿主后 `/capital-charts/<id>.json` 返回 404 | chart host 的登记表是进程级 500 条 LRU，不落盘；重启后旧 `chart_id` 查不到 | **已知遗留，与 0.2.2 无关**：交付事件里的自包含 HTML 仍是权威产物，卡片会退回「打开」文件 |
| `data_junior` 一次 `dataset_not_found` | 模型把 `ds_e35590f2-…-e2fdc16e7689` 抄成 `…-e2dfc16e7689`（`e2fd`/`e2df` 顺序颠倒） | **模型笔误，不是插件**：主 Agent 用 `bash` 核对目录名后经 `send_message` 纠正，junior 重试成功 |
| scratch UI 一开始看不到本 bundle 与设置卡片 | 手写 scratch profile 只在 `dsh.profile.bundles` 里列了包，没有写 `dependencies`，`pluginManager` 因此报 `installed:false`；补上 `link:` 依赖后卡片正常出现在 Installed plugins | **测试环境构造**，不是产品回归 |
| 真实 `web` profile 启动日志有一条 `patch: name mismatch for "capital-config"` | 用户层 `cordis.patch.yml` 还留着已重命名的 `capital-config/index.js` 旧行；后一条 `config/index.js` 覆盖生效 | **配置债**，无功能影响；建议删掉旧行 |

**结论**：0.2.2-rc.1 上本插件的主业务链（取数 → Dataset → PTC 分析 → 出图 → 官方交付；资讯专员；
设置卡片；自动化看板）实机走通，叶子工具面与 deny 生效；唯一阻断性回归是 `verify:sessions`
的宿主导出面漏改，已修复并补回归。剩余未人工点选的面只有自选股弹窗、图表卡片内联渲染和思考样式。

## 6. 残余风险

| ID | 风险 | 建议 |
|---|---|---|
| R1 | **升级顺序倒置**：先升宿主、插件仍是 2.17.0，启动时被 `disabled`，桌面端只看到模式消失 | CHANGELOG / README 已写清顺序与恢复命令；发布说明点名“先升宿主再更新插件” |
| R2 | **运行中的宿主仍是旧内存镜像**：文件已换成 0.2.2、插件已改成 2.18.0，但 GUI 进程没重启时仍是旧 preset（0.2.2 的 linked plugin 由 Plugin Manager 报 `restart-required: unmanaged-plugin`） | 升级后立即重启宿主；不要在同一进程里继续开新会话。2.18.0 验收已在重启后的进程上复核（见 §5） |
| R3 | **旧 presentation 选择器**：`dsh-agent-tool-presentation` 仍能跑，但已标 Deprecated；第三方配置若继续写 `mode: ptc`，未来版本可能移除 | 2.18.0 已迁到 executor 行；账本 L35 断言旧包 manifest 标 Deprecated，移除时会具名失败 |
| R4 | **`list_agents` 的角色可见性**：0.2.2 把它焊进 control 行主入口；本仓用逐名 deny 减掉，手动打开的角色会话仍靠调用级 guard | 回归 `test/role-tool-policy.test.mjs`；若上游改回 subpath 或拆成员开关，先重判 deny 名单 |
| R5 | **peer 范围放宽后的假绿**：`^0.2.1-rc.5` 之类写法会放进未测的 0.2.2 alpha / rc | 保持精确 pin；每轮宿主升级先跑 `check:dsh` + `smoke:boot` 再改版本 |
| R6 | **npm 11 的 allow-scripts 拦截**：全局安装提示 5 个包（`dsh-subprocess-local` / `koffi` / `node-pty` / `@google/genai` / `protobufjs`）的安装脚本未执行。Linux 上 `koffi` 与 `node-pty` 均可正常 `require`，`node-pty` 的 `spawn-helper` 仅 macOS 需要 | macOS / Windows 升级时如遇终端工具报错，执行 `npm approve-scripts` 后重装，或手工补 `spawn-helper` 可执行位 |
| R7 | **Python PTC SDK**：0.2.2 的 PTC executor 同时带 TS / Python SDK；本仓只用 `run_code` 的 TS 形态，Python 分支未实测 | junior 的 skill 与 persona 已限定 `tools.*` 写法；不要引入 Python 运行时假设 |
