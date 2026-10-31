# 宿主升级分析报告：dsh 0.2.1-rc.3 → 0.2.1-rc.5

> **维护者文档**，不注入模型、不进 skill 目录。调查方式：只读——GitHub compare API 取
> `dsh-v0.2.1-rc.3...dsh-v0.2.1-rc.5` 的 13 个 commit 与 300 个文件清单；npm 把 rc.5 装进临时
> prefix，与本机 rc.3 实装逐包 `diff -rq`；`check:dsh` 对着 rc.5 跑 37 条账本；最后升级本机
> npm-global 并用 `smoke:boot` 真启动复核。**本文同时记录 2.15.0 的执行结果**（验证数据见 §5）。
> 日期：2026-10-31。

## 0. 结论

1. **rc.4 / rc.5 对本仓扩展面（`docs/reference/dsh-surface-ledger.md` L1–L37）没有结构性断裂。**
   13 个 commit 里只有两类真实代码变更：ACP 模式诊断输出不再混入 stdout（rc.4），以及对话中
   思考内容的展示重做（rc.5）。本仓消费的 host 包——`dsh-app-boot` / `dsh-tools` /
   `dsh-host-webserver` / `dsh-agent-preset-registry` / `dsh-storage*` / `dsh-session*` /
   `dsh-subagent` / `dsh-agent-loop` / `dsh-deliverables` / `dsh-skill*` / `dsh-system-prompt` /
   `dsh-persona`——除 `package.json` 版本号外**零 diff**。
2. **唯一 API 级变化是 `conversation.chat.reasoning.body` 的 owner props**：新增 `readonly rawText: string`，
   `text` 的语义从"原始模型文本"改为"展示处理后的文本"（rc.5 #7484，附官方升级指南
   `docs/upgrade-guide/v0.2.1-rc.4/reasoning-body-props/`）。本仓三颗客户端 bundle 都不注册
   `conversation.chat.reasoning.*`，**零动作**。
3. **直升的阻断点仍是本仓自己的 manifest**：两个 `@deepseek-ai/dsh-*` peer 精确钉在 `0.2.1-rc.3`，
   rc.5 的兼容预检会判成不兼容，插件行在启动时被 `disabled`（只有 stderr 一行，界面上模式与工具
   整体消失）。2.15.0 已把 peer 精确 pin 到 `0.2.1-rc.5`，lockfile 与 devDependencies 同步。
4. **本机 npm-global 可以直接升**：rc.5 没有 `engines` 门槛，本机 Node 24.18.0 / npm 11.16.0
   满足；`npm install -g @deepseek-ai/dsh@0.2.1-rc.5` 一次成功，`dsh --version` 已是 rc.5。
   正在运行的宿主进程仍是 rc.3 的内存镜像，**需重启宿主**才切到 rc.5。

## 1. 基线

升级前（2.14.1）：

| 字段 | 值 | 说明 |
|---|---|---|
| `peerDependencies["@deepseek-ai/dsh-skill"]` | `0.2.1-rc.3`（精确） | 命中预检的 dsh peer |
| `peerDependencies["@deepseek-ai/dsh-skill-filesystem"]` | `0.2.1-rc.3`（精确） | 同上 |
| `peerDependencies["@deepseek-ai/cordis"]` | `^4.0.2` | 不匹配 `@deepseek-ai/dsh*`，不参与预检 |
| `engines` | **未声明** | 预检逐个查 dsh peer |
| `devDependencies` | `dsh-skill` / `dsh-skill-filesystem` / `dsh-system-prompt` = `^0.2.1-rc.3` | 仅类型侧与本地回归，随基线一起升 |
| 本机全局宿主 | `@deepseek-ai/dsh@0.2.1-rc.3` | `~/.npm-global` |
| 本机 profile | `web` / `capital` 均 `link:/home/shawn/projects/capital-generation` | 改工作区即改插件，无需重装 npm 包 |

升级后（2.15.0）：两个 dsh peer 精确 pin `0.2.1-rc.5`；三颗 devDependency 与 lockfile 同步到 rc.5
（lockfile 里 15 颗 `@deepseek-ai/dsh*` 一起抬，见 §4）。

## 2. rc.4 / rc.5 变化总表

compare 结果：13 个 commit、300 个文件；release note 只列两条（rc.4 的 ACP stdout 修复、rc.5 的
思考内容展示），实际代码变更面同样很小：

| 变更 | 上游落点 | 与本仓的关系 | 结论 |
|---|---|---|---|
| **ACP 诊断输出混入 stdout**（rc.4，#7168 / #7179） | `mcp-client`（资源列表诊断）、`llm-deepseek-account`（账号目录诊断）、`acp` / `acp-app`、`apps/cli` 的 ACP e2e | 本仓不用 ACP、不用 MCP | **零影响** |
| **思考内容展示重做**（rc.5，#7484） | `client/ui-chat` 的 `ReasoningContent` / `ReasoningRow` / 新增 `reasoning-text.ts` / `contract/slots.ts`、`client/ui-conversation` 的会话骨架与 locale、`experimental/client-ui-cot-translation` | 唯一 API 变化：`conversation.chat.reasoning.body` 的 owner props 新增 `rawText`，`text` 改为展示文本；`ReasoningContentInput` 不再继承 owner props。本仓不注册推理槽 | **零动作**（留官方升级指南互证） |
| **视图标签 tooltip 只在溢出时出现 / More 视图浮层固定**（rc.5） | `client/ui-conversation`、`client/ui-sidebar`、`client/ui-settings-*` | 本仓不注册这些槽 | **零影响** |
| **客户端 slot catalog 行号漂移** | `extensions/cordis-client-runner` 的 `slot-catalog.ts`（`source:` 行号） | 只是 catalog 元数据 | **无动作** |
| **客户端构建戳** | `client-modules` 的 `commit` 常量、`ui-settings-account/general/sidebar` 里的版本串 | 构建元数据 | **无动作** |
| **全量 package.json 版本抬升** | 上游所有包 | 15 颗进入本仓依赖图 | **必须同步 lockfile**，见 §4 |

静态边界核对（逐包 `diff -rq`，非 release note 推断）：把本机 rc.3 安装与 rc.5 临时安装的
`@deepseek-ai/*` 全量对比，**非 manifest 差异只落在** `dsh-client-ui-chat`、`dsh-client-ui-conversation`、
`dsh-client-ui-settings-account`、`dsh-client-ui-settings-general`、`dsh-client-ui-sidebar`、
`dsh-cordis-client-runner`、`dsh-experimental-client-ui-cot-translation`、`dsh-llm-deepseek-account`、
`dsh-mcp-client`、`dsh-client-modules`（后者只有 commit 串）。前四类里，除推理槽与版本串外没有
本仓消费的接口面。

## 3. 兼容闸门的精确机制

实现：`packages/boot/app-boot/src/plugin-compatibility.ts`（rc.3 / rc.4 / rc.5 一致）。

- manifest 有 `engines.dsh` → **只认它**，忽略 `peerDependencies`；
- 否则逐个检查 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` peer，
  `semver.satisfies(runtime, range, { includePrerelease: true })`；
- 不满足 → `PluginCompatibility`；`dsh plugin add/update` 直接拒绝，启动 profile 时该行 `disabled`。

宿主的实际判定（本机 rc.5，2026-10-31 实测）：

```
runtime 0.2.1-rc.5
compat undefined        # evaluatePluginCompatibility(package.json) 无 issue
```

semver 实测（`includePrerelease: true`）：

| 范围 | `0.2.1-rc.3` | `0.2.1-rc.4` | `0.2.1-rc.5` | `0.2.1` | `0.2.2-alpha.2` |
|---|---|---|---|---|---|
| `0.2.1-rc.3`（2.14.1 现状） | ✅ | ❌ | ❌ | ❌ | ❌ |
| `^0.2.1-rc.3` | ✅ | ✅ | ✅ | ✅ | ✅（太宽） |
| `0.2.1-rc.5`（2.15.0 采用） | ❌ | ❌ | ✅ | ❌ | ❌ |
| `^0.2.1-rc.5` | ❌ | ❌ | ✅ | ✅ | ✅ |
| `>=0.2.1-rc.3 <0.2.2-0` | ✅ | ✅ | ✅ | ✅ | ❌ |

`^0.2.1-rc.5` 在 includePrerelease 下会放进未测的 `0.2.2-alpha.*`，因此**继续精确 pin**；与
2.12.0 的判断一致。

## 4. 2.15.0 的采用方案

### 4.1 peer 策略：精确 pin（沿用方案 B）

| 方案 | 范围 | 优点 | 代价 |
|---|---|---|---|
| A | `>=0.2.1-rc.3 <0.2.2-0` | 同时支持 rc.3 / rc.4 / rc.5 | 每一档都要真机回归；provider 仍只来自插件依赖树，可能与宿主跨版本组合 |
| **B（采用）** | `0.2.1-rc.5` | 只认实测过的 rc.5；与 2.7.0 起的精确 pin 惯例一致 | rc.3 / rc.4 用户装不了 2.15.0，必须升宿主 |
| C | `engines.dsh` | 一条声明 | 一旦存在就完全忽略 peerDependencies；npm 仍按 peer 报错，不推荐 |

决定性理由仍是**运行时值导入**：`src/agents/selected-skills-provider.ts` 从
`@deepseek-ai/dsh-skill-filesystem` 导入 `FileSystemSkillProvider`，provider 类来自插件自己的
依赖树；声明多版本支持就等于允许"插件的 rc.5 provider 接宿主 rc.3 的 skill 服务"。

### 4.2 已改文件

| 文件 | 动作 |
|---|---|
| `package.json` | 两个 dsh peer → `0.2.1-rc.5`；三颗 devDependency → `^0.2.1-rc.5`；`version` → `2.15.0` |
| `package-lock.json` | 15 颗 `@deepseek-ai/dsh*` 的 version / resolved / integrity / 相互引用 → rc.5；其余依赖不动 |
| `chart-ui/` `config/` `watchlist/` `automation/package.json` | 嵌套包版本 → `2.15.0` |
| `README.md` | 基线徽章与 NOTE、版本徽章、FAQ 的版本示例 |
| `CONTRIBUTING.md` | 开发环境准备的基线句 |
| `.github/workflows/test.yml` | `npm install -g @deepseek-ai/dsh@0.2.1-rc.5` |
| `preset/capital-generation/README.md` | "实测 dsh 0.2.1-rc.5" |
| `docs/dev/preset-persona.md` | §8.1 标题里的实测版本 |
| `CHANGELOG.md` | 新增 2.15.0 段与迁移说明 |
| `src/web-retriever/local-fetch.ts` / `wind-client.ts` | 两个客户端版本常量 → `2.15.0`（测试钉住与 package.json 一致） |
| `.gitignore` | 放行本文件，随仓库入库 |

不需要动：`scripts/check-dsh-compat.mjs` 的 37 条探针（全部仍然成立）、`docs/reference/dsh-surface-ledger.md`
（没有形状变化）、三颗嵌套包的 peer、`docs/design/*.md` 的历史记录。

### 4.3 用户侧的升级顺序

先升宿主，再更新插件（2.15.0 要求 rc.5）。反过来做，插件先被禁用，需要再执行一次
`dsh plugin --profile <profile> update @v587d/capital-generation` 才能恢复；缺少 stderr 的桌面端尤其
容易卡住。应急通道是 `dsh plugin allow-version`，但它只豁免 manifest 检查，运行时导入仍跨版本。

## 5. 验证结果（2026-10-31，本机）

**本机宿主升级**：`npm install -g @deepseek-ai/dsh@0.2.1-rc.5` →
`dsh --version` = `0.2.1-rc.5`；`npm ls -g --depth=0` 只剩一颗 `@deepseek-ai/dsh@0.2.1-rc.5`。

| 检查 | 结果 |
|---|---|
| `npm run check:dsh`（对 rc.5） | **37 / 37 条**账本通过（L15/L19/L22/L23/L24/L26/L27/L28 因 primitives 编进 `dsh-web-frontend/dist` 按设计为 n/a） |
| `npm test`（对 rc.5） | **1316 / 1317** 通过；唯一红项是 `test/release-version.test.mjs` 的"README 链接必须被 git 跟踪"，命中的是工作树里**既有的未跟踪** `docs/sample/指南针Q3暴跌探因.md`（README 的样例链接在本轮之前就已改到它），与宿主升级无关 |
| `npm run smoke:boot`（对 rc.5） | 通过：预设 `broken=null`、选择器三模式、20/20 族行 ACTIVE、12 行 bundle 组件、`/capital-watchlist` / `/capital-automation` / `/capital-skills` 的 401/200 围栏、PTC、3 颗身份闸门全部在场 |
| 兼容预检 | `evaluatePluginCompatibility(package.json)` → `undefined` |
| 时序 | 升级后第一次 `smoke:boot` 与全量 `npm test` 并发运行，探针先于族行收敛打印（"never started"）；随后单独连跑 3 次全绿。按 CPU 争用下的时序抖动记录，不当作功能面异常 |

未做：浏览器手工点选（配置卡片三格 tab、自选股弹窗、图表卡片、思考内容新样式）。重启宿主后按
README 的手工清单过一遍即可。

## 6. 残余风险

| ID | 风险 | 建议 |
|---|---|---|
| R1 | **升级顺序倒置**：先升宿主、插件仍是 2.14.1，启动时被 `disabled`，桌面端只看到模式消失 | CHANGELOG / README 已写清顺序与恢复命令；发布说明点名"先升宿主再更新插件" |
| R2 | **运行中的宿主仍是旧内存镜像**：文件已换成 rc.5，GUI 进程还是 rc.3，客户端静态资源与 boot 图可能代际不一致 | 升级后立即重启宿主；不要在同一进程里继续开新会话 |
| R3 | **推理槽的 `rawText` 契约**：本仓当前不注册 `conversation.chat.reasoning.*`；未来若加自定义推理渲染或翻译包装，必须按 rc.5 契约读 `rawText` / `text` | 加槽时把这条写进设计与回归；不要沿用 rc.3 的 `text = 原始文本` 假设 |
| R4 | **peer 范围放宽后的假绿**：`^0.2.1-rc.3` 之类写法会放进未测的 rc.4 / rc.5 / `0.2.2-alpha.*` | 保持精确 pin；每轮宿主升级先跑 `check:dsh` + `smoke:boot` 再改版本 |
| R5 | **npm 11 的 allow-scripts 拦截**：本次全局安装提示 5 个包（`dsh-subprocess-local` / `koffi` / `node-pty` / `@google/genai` / `protobufjs`）的安装脚本未执行。本机 Linux 上 `koffi` 与 `node-pty` 均可正常 `require`，`node-pty` 的 `spawn-helper` 仅 macOS 需要 | macOS / Windows 升级时如遇终端工具报错，执行 `npm approve-scripts` 后重装，或手工补 `spawn-helper` 可执行位 |
| R6 | **rc.3 / rc.4 兼容性不再声明**：2.15.0 在 rc.3 / rc.4 上会被预检拒绝 | 发布说明写明"必须 rc.5"；需要旧宿主的用户留在 2.14.1 |
