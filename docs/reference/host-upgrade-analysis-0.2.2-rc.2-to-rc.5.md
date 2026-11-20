# 宿主升级分析报告：dsh 0.2.2-rc.2 → 0.2.2-rc.5

> **维护者文档**，不注入模型、不进 skill 目录。调查方式：只读——读 rc.5 包内的官方升级指南
> （`docs/upgrade-guide/`），把 `@deepseek-ai/dsh@0.2.2-rc.5` 装进临时 prefix 与本机 rc.2 实装逐包
> `sha256` 对比，`check:dsh` 对着 rc.5 跑 39 条账本；结论落地后再用 `smoke:boot` 真启动复核（§5）。
> 日期：2026-11-20，对应插件版本 **2.28.0**（§4.4 是随后同一轮的 2.29.0）。

## 0. 结论

1. **rc.2 → rc.5 对本仓没有结构性断裂。** 官方升级指南只有两条（rc.3 的拒答错误码、rc.4 的网页搜索
   默认提供方），两条都不消费；账本 39 条对 rc.5 全绿；`npm test` 1598 条全绿。
2. **其余差异是版本号抬升与新增功能面。** 325 颗 `@deepseek-ai/dsh*` 全部抬到 rc.5，其中只有
   28 颗有 manifest 之外的字节变化，绝大多数是新增 `deepseek-chat-import` 官方 bundle 的配套
   （新 remote 方法、附件归档、slot catalog 新座位），与本仓消费面不相交（§2）。
3. **代码零改动，只动 manifest 与文档。** 两个 dsh peer 精确 pin 到 rc.5（§4.1），devDependencies
   / lockfile 同步；三颗嵌套包与两个客户端版本常量、README / CONTRIBUTING / CI / 账本基线随版本抬。
4. **本机全局宿主未动**（仍是 rc.2）：本轮验证用临时 prefix 里的 rc.5 跑账本、全量测试与真启动，
   不动用户正在用的宿主进程；升级宿主本身是用户侧动作（§4.3）。

## 1. 基线

| 字段 | 升级前（2.27.2） | 升级后（2.28.0） |
|---|---|---|
| `peerDependencies["@deepseek-ai/dsh-skill"]` | `0.2.2-rc.2`（精确） | `0.2.2-rc.5`（精确） |
| `peerDependencies["@deepseek-ai/dsh-skill-filesystem"]` | `0.2.2-rc.2`（精确） | `0.2.2-rc.5`（精确） |
| `engines` | **未声明** | 不变（预检走 dsh peer） |
| `devDependencies`（三颗 dsh 包） | `^0.2.2-rc.2` | `^0.2.2-rc.5` |
| lockfile 里的 dsh 包 | 16 颗 rc.2 | 16 颗 rc.5，其余依赖零变动 |
| 本机全局宿主 | `0.2.2-rc.2` | 不变（验证走临时 prefix） |

## 2. 上游变化总表

官方升级指南（rc.5 包内 `docs/upgrade-guide/README.md`）：`v0.2.2-rc.3`、`v0.2.2-rc.4` 各有
一条，**没有 `v0.2.2-rc.2` 目录** ⇒ 从 rc.2 出发只需走这两步；`v0.2.2-rc.1` 一节在 2.22.0 已落地。

| 变更 | 上游落点 | 与本仓关系 | 结论 |
|---|---|---|---|
| **拒答错误码 `MALFORMED_RESPONSE` → `CONTENT_REFUSED`**（rc.3） | `dsh-llm`（`ErrorCode` 新增一项）、`dsh-llm-deepseek` 的 `translate()`、`dsh-session-persistence-jsonl` 的错误码表、`dsh-repeat-tool-reminder` / `dsh-tmux-context` 的副本 | 本仓只把 `turn/end` 的 `error.code` 原样记进自动化运行记录（`automation/runner.js` 的 `outcomeError`），从不按码分支，也不写 `MALFORMED_RESPONSE` | **零动作**：拒答会记成 `CONTENT_REFUSED` + 宿主原文，比原来的 `MALFORMED_RESPONSE` 更准 |
| **网页搜索默认不再钉 `deepseek-search-api`**（rc.4） | `dsh-base/cordis.patch.yml` 的 `web` 行删掉 `searchProvider`；`dsh-web` 按模型路由选提供方（DeepSeek 模型走旧版 Messages 搜索） | 本仓自带检索面（AnySearch / Wind / 具名来源 / 本地直连）；宿主搜索工具不挂在 Capital 的 preset 行上（`web_fetch` 另在根侧按名 deny，`web_search` 由人设禁用），不读 `ctx.web` | **零影响**：Capital 会话的网络面不走宿主那条 |
| **新增 `deepseek-chat-import` 官方 bundle** | `dsh-official-bundles` 三张清单、`dsh-api-session-controller` 的 remote catalog、`dsh-session-log-export` 的附件归档 | 官方可选 bundle，本仓不装、不引用 | **零影响** |
| **新增 slot `sidebar.session.action`（HOC）** | `dsh-client-ui-sidebar` / `dsh-cordis-client-runner` 的 slot catalog；`source:` 行号漂移 | 本仓注册的六格座位（`tool.call.toolview` / `plugins.bundle.config` / `plugins.detail.badge` / `conversation.input.overlay` / `main` / `sidebar.panellist`）逐格对照 rc.5 catalog，**kind 与 scope 全部不变** | **零动作** |
| **工作区选择器重构**（`WorkspacePickerFactory`） | `dsh-client-ui-workspace` | 本仓不注册 `workspace.*` 座位 | **零影响** |
| **插件页客户端重编译** | `dsh-client-ui-plugin-manager` 的 `lib/client.js` | 逐项核对本仓依赖的两处（L15 / L26 因 primitives / slots 编进 `dsh-web-frontend/dist` 按设计 n/a，只能读产物）：`plugins.bundle.config` 仍是 keyed 且门槛仍是 `configured: ledger.bundles.has(openPkg.name)`，`plugins.detail.badge` 仍渲染在版本标签之后 | **零动作** |
| **构建戳 / 版本串** | `dsh-client-modules` 的 `commit` 常量、各客户端 bundle 的版本串 | 构建元数据 | **零动作** |
| **全量 package.json 抬升** | 上游 325 颗包 | 16 颗进入本仓依赖图 | **必须同步 lockfile**（§4.2） |

静态核对（逐包 `sha256`，不是从发布说明推断）：非 manifest 差异只落在
`dsh-agent-preset`（skill 文档）、`dsh-api-remotes`（只有构建戳，标识符集合逐字相同）、
`dsh-api-session-controller`（新 remote 方法）、`dsh-base`、`dsh-client-modules`、
`dsh-client-ui-{directory-picker-browse,directory-picker-native,plugin-manager,settings-account,settings-general,settings-web-search,sidebar,workspace}`、
`dsh-cordis-client-runner`、`dsh-experimental-liveshare`、`dsh-llm`、`dsh-llm-deepseek`、
`dsh-official-bundles`、`dsh-repeat-tool-reminder`、`dsh-session-log-export`、
`dsh-session-persistence-jsonl`、`dsh-tmux-context`、`dsh-tool-cordis`、`dsh-tool-web`、`dsh-web`、
`dsh-web-deepseek-api`（只有 README）、`dsh-web-frontend`（前端产物）、`dsh-web-search-deepseek`。
其中本仓消费的包——`dsh-tools`、`dsh-session`、`dsh-client-ui-deliverables`、
`dsh-client-ui-primitives`、`dsh-client-ui-tool`、`dsh-client-ui-conversation`、
`dsh-client-ui-commands`、`dsh-settings`、`dsh-client-ui-settings`、`dsh-persona`、`dsh-skill`、
`dsh-skill-filesystem`、`dsh-system-prompt`、`dsh-agent*`、`dsh-subagent*`、`dsh-tool-subagent*`、
`dsh-host-webserver`、`dsh-client-connection`、`dsh-storage*`、`dsh-tool-fs`、`dsh-tool-present`、
`dsh-ptc-runtime`、`dsh-tool-executor-*`、`dsh-config-editor`、`dsh-schedule`——**除版本号外零 diff**。

## 3. 兼容闸门的判定

实现仍是 `@deepseek-ai/dsh-app-boot` 的 `evaluatePluginCompatibility(manifest)`：有 `engines.dsh`
就只认它，否则逐个检查 `@deepseek-ai/dsh*` peer（`includePrerelease: true`）。本机对 rc.5 实测：

```
runtime 0.2.2-rc.5
compat undefined        # evaluatePluginCompatibility(package.json) 无 issue
```

`^0.2.2-rc.5` 在 includePrerelease 下会放进未测的 `0.2.2-rc.6` / `0.2.3-*`，因此两个 peer 继续
**精确 pin**（与 2.15.0 / 2.22.0 同一判据：`src/agents/selected-skills-provider.ts` 从
`@deepseek-ai/dsh-skill-filesystem` 导入 `FileSystemSkillProvider`，provider 类来自插件自己的依赖树，
声明多版本支持等于允许跨版本组合）。devDependencies 用 `^`：它们只喂类型与本地回归。

## 4. 采用方案（2.28.0）

### 4.1 已改文件

| 文件 | 动作 |
|---|---|
| `package.json` | 两个 dsh peer → `0.2.2-rc.5`；三颗 devDependency → `^0.2.2-rc.5`；`version` → `2.28.0` |
| `package-lock.json` | 16 颗 `@deepseek-ai/dsh*` 的 version / resolved / integrity → rc.5，其余依赖零变动 |
| `chart-ui/` `config/` `watchlist/` `automation/package.json` | 嵌套包版本 → `2.28.0` |
| `src/web-retriever/local-fetch.ts` / `wind-client.ts` | `LOCAL_FETCH_CLIENT_VERSION` / `WIND_CLIENT_VERSION` → `2.28.0` |
| `README.md` | DSH 基线徽章与 NOTE、版本徽章、FAQ 的版本示例 |
| `CONTRIBUTING.md` / `.github/workflows/test.yml` | 基线句与 `npm install -g @deepseek-ai/dsh@0.2.2-rc.5` |
| `preset/capital-generation/README.md` / `docs/dev/preset-persona.md` | 人设承载的"实测版本" |
| `docs/reference/dsh-surface-ledger.md` | 已验证基线新增 2026-11-20 一行 |
| `CHANGELOG.md` | 新增 2.28.0 段与迁移说明 |
| `test/python-runtime-manager.test.mjs` | 清掉继承来的 `DSH_HOME`（§5 的假红），不是断言改动 |
| `.gitignore` | 放行本文件 |

不需要动：`scripts/check-dsh-compat.mjs` 的 39 条探针（逐条仍成立）、`docs/dev/*` 的其余事实、
三颗嵌套包的 `dsh.client` 声明、persona 与 8 份 skill 的措辞。

### 4.2 lockfile 的重算口径

旧 lockfile 里 rc.2 的 `dsh-skill-filesystem` 声明 `peer dsh-skill@0.2.2-rc.2`，与根上的 `^0.2.2-rc.5`
正面冲突，`npm install` 会报 `ERESOLVE` 而不是自己换树。做法：备份旧 lockfile → 删掉 →
`npm install` 重新解析 → 与旧文件比对，确认**只有 16 颗 dsh 包**的 version / resolved / integrity
变了，其余条目逐字相同（本轮实测如此），再把旧文件删除。不要用 `--legacy-peer-deps` 绕过：那会让
peer 树（`dsh-llm` / `dsh-scope` / `dsh-fs` / …）停在旧版本，而测试是通过它们跑真实类型的。

### 4.3 用户侧顺序

先升宿主（`npm i -g @deepseek-ai/dsh@0.2.2-rc.5` 或桌面端更新），再更新插件；然后**重启宿主**
——运行中的进程仍是旧版内存镜像。2.28.0 在 rc.2 上会被预检拒绝（peer 精确 pin），所以不要先升插件。

### 4.4 2.29.0：支持窗口改成同一 minor（issue #20）

rc.5 发布当天有用户（issue #20）在 Desktop rc.5 上装 2.27.1 被拒载：精确 pin 的代价是**每出一个宿主 rc
就要跟发一版插件**，中间任何一天宿主自动更新，插件就整体消失。`engines.dsh` 让宿主只认一个区间，
所以支持窗口从「一个 rc」改成「一条 minor 线」：

- 根 `package.json`：`engines.dsh = ">=0.2.2-rc.5 <0.2.3-0"`；两个 dsh peer 写**同一区间**（peer 只影响
  安装期解析，不一致就会出现"装得上、启动被拒"或反过来）。
- 不采纳 issue 建议的 `<0.3.0`：那会把 0.2.3～0.2.9 这些没测过、可能真断的 minor 一起放进来。
  `<0.2.3-0` 把"下一个 minor 的预发布"也排除在外。
- 用 rc.5 真实的 `evaluatePluginCompatibility` 复核（探针 L40 固化）：`0.2.2-rc.5` / `rc.6` / `0.2.2`
  放行，`0.2.3-rc.1` / `0.3.0-rc.1` 拒绝；有 `engines.dsh` 时 peer 写不可能满足的值也照样放行
  （证明 engines 单独决定），去掉 engines 后同一 peer 立刻被拦（证明兜底方向没变）。
- 代价说清：放宽后若某个 rc 真改了消费面，故障形态从「整块拒载」变成「某个功能报错或静默退化」
  （见 §0 之后的四类表现）。缓解是三道：L40 钉闸门语义、`capital-runtime` 挂载期对未验证宿主往 stderr 打一条
  warn（`ctx.logger` 的 exporter 只收进启动诊断、不落终端，所以走 `console.warn`；检测不到就静默）、
  每个宿主 rc 仍按 §8.3 跑 `check:dsh` + `npm test` + `smoke:boot` 后才抬基线。
- 边界：minor 换代（0.2.3、0.3.0）仍然要适配并发一版；`src/host-version.ts` 的
  `VERIFIED_DSH_VERSION` 是"逐项验证到哪"的唯一事实，改它必须同步 `test/host-version.test.mjs`
  与账本基线。

## 5. 验证结果（2026-11-20，本机）

验证对象是装进 `.scratch-rc5/host` 的 `@deepseek-ai/dsh@0.2.2-rc.5`（`npm install --prefix` 的
hoisted 布局，另补一条 `node_modules` 软链让账本的 `<dsh>/node_modules/@deepseek-ai/*` 读法成立）。
本机全局宿主保持 rc.2，未升级、未重启。

| 检查 | 结果 |
|---|---|
| `npm run check:dsh`（`DSH_PACKAGE_DIR` 指 rc.5） | **39 条账本全部通过**：29 条实测 + 10 条按设计 n/a（L8 由 `apply-integration` 覆盖、L10 探针退休、L15/L19/L22/L23/L24/L26/L27/L28 的 primitives / slots 编进 `dsh-web-frontend/dist`） |
| `npm test`（同上） | **1598 / 1598** 通过，0 跳过（dsh-compat 用例真的读到了包目录） |
| 兼容预检 | `evaluatePluginCompatibility(package.json)` → `undefined` |
| `npm run smoke:boot` | 通过：预设 `broken=null`、13 行 bundle 组件、20/20 族行 ACTIVE、PTC 行与 runtime 都在、4 颗身份闸门、`/capital-watchlist` `/capital-automation` `/capital-skills` 的 401/200 围栏与闭集、settings 条目 `capital-config`、重复声明预设的反向对照仍会失败 |
| 静态对比 | 325 颗包逐文件 `sha256`；非 manifest 变化见 §2 |

**一条环境坑（已修）**：直接在本会话里跑 `npm test` 时，6 条 `test/python-runtime-manager.test.mjs`
会红——`PythonRuntimeManager` 的 `resolveDshHome` 让 `$DSH_HOME` **优先于** `dshHome` 选项，而 DSH
会话里该变量指向真实 `~/.dsh`，于是夹具把缓存建到用户目录（`~/.dsh/cache/test/python-runtime`）。
`env -u DSH_HOME` 后 7/7 通过；改为测试文件顶部清掉该变量，夹具回到临时 home，CI 行为不变。

## 6. 残余风险

| ID | 风险 | 建议 |
|---|---|---|
| R1 | **升级顺序倒置**：插件先更新、宿主还是 rc.2 ⇒ 启动时该 bundle 被预检 `disabled`，界面上模式整体消失 | CHANGELOG / README 的 Migration 已写明先升宿主、再更新插件、再重启 |
| R2 | **宿主进程代际不一致**：文件已是 rc.5、GUI 仍是旧进程 | 升级后立即重启；不要在旧进程里继续开新会话 |
| R3 | **搜索默认值的观感差异**：用户在**非 Capital** 模式里用 DSH 自带 `web_search` 时，DeepSeek 模型改走 Messages 搜索（按 token 计费、附一条 `web/deepseek-search-llm-request` 事件） | 与本插件无关（Capital 会话不用宿主搜索）；要回旧行为在「设置 → 网页搜索」里选回 DeepSeek Search API |
| R4 | **拒答码只记不译**：自动化运行记录会显示 `CONTENT_REFUSED` 与宿主原文 | 用户可见文案暂不特判；若以后要中文化，只在展示层加映射，别改码 |
| R5 | **浏览器侧未复核**：本轮没有在 rc.5 上做浏览器手工点选（配置卡片五格、自选股面板、图表卡片） | 重启宿主后按 README 手工清单过一遍；DOM 与槽位契约由 1598 条测试与 39 条探针覆盖 |
