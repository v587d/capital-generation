# 宿主升级分析报告：dsh 0.2.1-rc.2 → 0.2.1-rc.3

> **维护者文档**，不注入模型、不进 skill 目录。调查方式：只读——GitHub compare API 取
> `dsh-v0.2.1-rc.2...dsh-v0.2.1-rc.3` 的 6 个 commit 与逐文件清单；npm 下载 rc.3 的 9 颗客户端包
> 解包做字串核对；本机 rc.2 实装逐包对照。**本文同时记录 2.12.0 的执行结果**（验证数据见 §5）。
> 日期：2026-10-26。

## 0. 结论

1. rc.3 对本仓扩展面（`docs/reference/dsh-surface-ledger.md` L1–L36）**没有结构性断裂**。host 侧
   `packages/tool` / `preset` / `session` / `storage` / `webserver` / `boot` 的运行期代码零改动，
   唯一被碰到的是 `api/session-controller` 的一条注释与 LLM 模型列表。
2. 升级 rc.3 的真正阻断点是**本仓自己的 manifest**：两个 `@deepseek-ai/dsh-*` peer 精确钉在
   `0.2.1-rc.2`，会被宿主的兼容性预检判成不兼容。`dsh plugin add/update` 拒绝安装；已装实例在启动时
   整行 `disabled`，只往 stderr 打一行——Web 端表现为 Capital 组合与全部工具凭空消失。
3. 这道闸门在 rc.2 就已存在，不是 rc.3 新增；rc.3 只是第一次让它对 2.11.1 触发。
   2.12.0 已把 peer 精确 pin 到 `0.2.1-rc.3` 并通过全部验证。

## 1. 基线

升级前（2.11.1）：

| 字段 | 值 | 说明 |
|---|---|---|
| `peerDependencies["@deepseek-ai/dsh-skill"]` | `0.2.1-rc.2`（精确） | 命中预检的 dsh peer |
| `peerDependencies["@deepseek-ai/dsh-skill-filesystem"]` | `0.2.1-rc.2`（精确） | 同上 |
| `peerDependencies["@deepseek-ai/cordis"]` | `^4.0.2` | 不匹配 `@deepseek-ai/dsh*`，不参与预检 |
| `engines` | **未声明** | 没有 `engines.dsh`，预检会逐个查 dsh peer |
| `devDependencies` | `dsh-skill` / `dsh-skill-filesystem` / `dsh-system-prompt` = `^0.2.1-rc.2` | 仅类型侧，需随基线一起升 |
| 嵌套包 `chart-ui` / `config` / `watchlist` | 无 `peerDependencies` | 作为 bundle component 被同一预检扫到，不会被拒 |

升级后（2.12.0）：两个 dsh peer 精确 pin `0.2.1-rc.3`，三颗 devDependency 与 lockfile 同步到 rc.3。

实际消费的客户端扩展面（rc.3 上逐条核对过，见 §2）：L1/L2 三颗嵌套包、L15 `plugins.bundle.config`、
L19 `conversation.input.overlay`（含 `inputActions`）、L23 `Menu` / `MenuItemButton`、L26
`plugins.detail.badge`、L27 `Switch`、L28 `SegmentedControl`、L4 `tool.call.toolview`、L11/L34 交付事件、
L22 菜单材质 token。**没有**消费导航入口、More 菜单、views 或任何新增槽。

宿主版本声明散落在 8 个文件（升级时同字改动）：`package.json`、`package-lock.json`、`README.md`、
`CONTRIBUTING.md`、`.github/workflows/test.yml`、`preset/capital-generation/README.md`、
`docs/dev/preset-persona.md`、`CHANGELOG.md`。`docs/design/*.md` 里的 rc.2 是历史记录，不改。

## 2. rc.3 变化总表

rc.3 只有 6 个 commit，release note 列了 3 条，实际还夹带了一条未上 note 的行为变更：

| 变更 | 上游落点 | 与本仓的关系 | 结论 |
|---|---|---|---|
| **导航入口自定义 + More 菜单**（#6247） | 新包 `@deepseek-ai/dsh-client-ui-entry-customization` 默认加载；`sidebar.panellist.actions`、`conversation.session.header.views.actions`、`sidebar.right.tab.guide.actions` 三个新 actions 槽 | 全仓无 `navigation` / `panellist` / `views.` 注册 | 无代码动作；用户会看到新入口，答疑时说明不是本插件加的 |
| **New Session 复用空白会话 + 按 preset 跳过**（#6247 夹带，guide 目录名写成 `v0.2.1-rc.2`，实际 rc.2 tag 里没有该文件） | `ui-workspace/src/client/navigation.ts`、`ui-agent-preset` | 用户选 Capital 组合时命中：复用到的 blank 若 Agent 仍加载，会保留**创建时**的 preset 组合 | 文档 + 验证动作，见 R2 |
| **analytics**（#6600） | `product-analytics`、`ui-agent-preset`、`ui-sidebar`、`ui-settings-general` | 仅 Desktop 上报且默认开、无用户开关；`analyticsMode()` 对自定义 preset 返回 `'other'`，事件又被 `to !== 'other'` 挡掉 | **零影响**，也不会把 `capital-generation` 这个 id 上报出去 |
| **More 菜单修正**（#6883） | `ui-primitives`、`ui-conversation`、`ui-sidebar*` | `Menu` 新增可选 `current` / `minWidthFromAnchor`，`MenuItemButton` 新增可选 `current` | 全部可选，现有调用不改 |
| **DeepSeek 模型列表**（#6944） | `llm-deepseek` / `-api-key` / `-account` | 本仓不配置模型、代码里不写死模型名 | 只影响宿主模型选择器；README 推荐语可复核 |
| **兼容预检 × 版本钉**（**非 rc.3 新增**，rc.2 已有同一实现） | `dsh-app-boot` + `dsh-plugin-manager` | 直接命中本包 manifest | **必须动作**，见 §3 |

边界核对（逐 commit 文件清单）：`#6247` 的 219 个文件里只有 1 个 host 侧运行期文件
（`api/session-controller/.../service.ts`，仅注释一行）与 1 份 skill 参考文档；`#6600` / `#6883` 全在
`packages/client/*`；`#6944` 全在 `packages/llm/*`。`core` / `tools` / `preset` / `session` / `storage` /
`webserver` 包无任何 diff——L12、L14、L16、L17、L20、L30、L31 这组承重面不受影响。

静态核对（rc.3 发布包逐字比对，非文档推断）：
`plugins.bundle.config`（4 处，含 `renderSlot("plugins.bundle.config", { view: "page" }, { entryKey: pkg.name })`
与 `configured: ledger.bundles.has(openPkg.name)`）、`plugins.detail.badge`（4 处，仍渲染在 `versionTag` 之后）、
`data-plugin-config/rows/detail`、`conversation.input.overlay`（2 处）、`inputActions`（11 处）、
`captureInsertion`、`insertText` 全部原样存在。`ui-plugin-manager` 只新增 `openList()`；
`ui-conversation` 只新增 `conversation.session.header.views.actions`。

## 3. 兼容闸门的精确机制

实现：`packages/boot/app-boot/src/plugin-compatibility.ts`（rc.2 与 rc.3 内容一致）。

规则：

- manifest 有 `engines.dsh` → **只认它**，忽略 `peerDependencies`；
- 否则逐个检查 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` peer，
  `semver.satisfies(runtime, range, { includePrerelease: true })`；
- 不满足 → `PluginCompatibility`，`name@version` + 运行时版本都参与豁免记账。

三个失败面：

| 场景 | 行为 | 用户看到什么 |
|---|---|---|
| `dsh plugin add/update <本包>` | 预检候选 manifest，不兼容即 **exit 1**（`incompatible-version`），回滚 profile manifest + lockfile | 安装被拒，提示升级插件或 `allow-version` |
| 启动 profile | `prepareProfileEntries` 把该行 `disabled` | 只有 stderr 一行 `dsh: disabling profile plugin ...`；Web/桌面看就是插件消失 |
| 其它安装操作 | 未触碰的依赖只警告，不阻塞 | stderr 警告 |

`dsh plugin allow-version` 可按 `name@version + 运行时版本` 精确豁免，是用户的应急通道，不是修复方案。

宿主的实际判定（本机 rc.3，2026-10-26 实测）：升级前 2.11.1 返回
`requirements: { "dsh-skill": "0.2.1-rc.2", "dsh-skill-filesystem": "0.2.1-rc.2" }, exempted: false`；
peer 改到 rc.3 后返回 `undefined`（兼容）。

semver 实测（宿主自带的 semver，`includePrerelease: true`）：

| 范围 | `0.2.1-rc.2` | `0.2.1-rc.3` | `0.2.1` | `0.2.2-alpha.1` |
|---|---|---|---|---|
| `0.2.1-rc.2`（2.11.1 现状） | ✅ | ❌ | ❌ | ❌ |
| `^0.2.1-rc.2` | ✅ | ✅ | ✅ | ✅（太宽） |
| `0.2.1-rc.3`（2.12.0 采用） | ❌ | ✅ | ❌ | ❌ |
| `^0.2.1-rc.3` | ❌ | ✅ | ✅ | ✅ |
| `>=0.2.1-rc.2 <0.2.2-0` | ✅ | ✅ | ✅ | ❌ |

注意 `^0.2.1-rc.2` 在 `includePrerelease` 下会放进 `0.2.2-alpha.1`——下一轮未测的 prerelease 也能装上，
这在 pre-1.0 的 dsh 上是假绿。

## 4. 2.12.0 的采用方案

### 4.1 peer 策略：精确 pin（方案 B）

| 方案 | 范围 | 优点 | 代价 |
|---|---|---|---|
| A | `>=0.2.1-rc.2 <0.2.2-0` | rc.2 / rc.3 双支持 | 需对 rc.2 再补一次真机回归；且插件运行时导入的 provider 会固定成 rc.3，与 rc.2 宿主服务跨版本组合 |
| **B（采用）** | `0.2.1-rc.3` | 语义干净，只认测过的 rc.3；与 2.7.0 起的精确 pin 惯例一致 | rc.2 用户从此装不了新版；等于强制升宿主 |
| C | `engines.dsh` | 一条声明 | 一旦存在就**完全忽略** peerDependencies，npm 仍按 peer 报错；且让"构建对 rc.3、跑在旧宿主"失去拦截。不推荐单独用 |

选 B 的决定性理由是运行时导入：`src/agents/selected-skills-provider.ts` 里
`import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'` 是**值导入**，
provider 类来自插件自己的依赖树。声明 rc.2 支持意味着 rc.3 的 provider 接 rc.2 的 `skill` 服务——
这正是本仓"同版本实测"纪律要避免的跨版本组合。

### 4.2 已改文件

| 文件 | 动作 |
|---|---|
| `package.json` | 两个 dsh peer → `0.2.1-rc.3`；三颗 devDependency → `^0.2.1-rc.3`；`version` → `2.12.0` |
| `package-lock.json` | 只重写 14 颗 `@deepseek-ai/dsh*` 的 version/resolved/integrity 与相互引用，其余依赖不动 |
| `README.md` | Baseline 徽章、版本徽章、第 40 行基线句、FAQ 里的版本示例 |
| `CONTRIBUTING.md` | 第 108 行基线句 |
| `.github/workflows/test.yml` | 第 59 行 `npm install -g @deepseek-ai/dsh@0.2.1-rc.3` |
| `preset/capital-generation/README.md` | 第 26 行"实测 dsh 0.2.1-rc.3" |
| `docs/dev/preset-persona.md` | §8.1 标题里的实测版本 |
| `CHANGELOG.md` | 新增 2.12.0 段，含迁移说明 |
| `src/web-retriever/local-fetch.ts` / `wind-client.ts` | 两个客户端版本常量 → `2.12.0`（测试钉住与 package.json 一致） |
| `chart-ui/` `config/` `watchlist/package.json` | 嵌套包版本 → `2.12.0` |

不需要动：三颗嵌套包的 peer、`scripts/check-dsh-compat.mjs` 的探针、`docs/design/*.md`。

### 4.3 用户侧的升级顺序

先升宿主，再更新插件（2.12.0 要求 rc.3）。反过来做，插件先被禁用，需要再执行一次
`dsh plugin --profile <profile> update @v587d/capital-generation` 才能恢复；缺少 stderr 的桌面端尤其容易卡住。
应急通道是 `dsh plugin allow-version` 对 `@v587d/capital-generation@2.11.1` + rc.3 精确豁免，但那只豁免
manifest 检查，运行时导入仍与宿主跨版本。

## 5. 验证结果（2026-10-26，本机）

宿主升级：`npm install -g @deepseek-ai/dsh@0.2.1-rc.3` → `dsh --version` = `0.2.1-rc.3`。

| 检查 | 结果 |
|---|---|
| `npm run check:dsh` | **36 / 36 条**账本通过（rc.3 实装；L19/L22/L23/L24/L26/L27/L28 因宿主把 primitives 编进 `dsh-web-frontend/dist` 而按设计为 n/a） |
| `npm test` | **1215 / 1215** 通过（含 build；TypeScript 对 rc.3 类型编译通过） |
| `npm run smoke:boot` | 通过：预设 `broken=null`、选择器三模式、20/20 族行 ACTIVE、11 行 bundle 组件、`/capital-watchlist` 与 `/capital-skills` 的 401/200 围栏、PTC 与 3 颗身份闸门全部在场 |
| 兼容预检 | `evaluatePluginCompatibility(package.json)` 返回 `undefined` |
| `git diff --check` | 干净 |

未做：浏览器手工点选（配置卡片三格 tab、自选股弹窗、图表卡片）。如需桌面端/浏览器确认，重启宿主后
按 README 的手工清单过一遍即可。

## 6. 残余风险

| ID | 风险 | 建议 |
|---|---|---|
| R1 | **升级顺序倒置**：用户先升宿主，2.11.1 在启动时被 `disabled`，只有 stderr，桌面端看不见 | CHANGELOG/README 已写清顺序；发布说明点明"先更新插件再升宿主"或反之的恢复命令 |
| R2 | **复用 blank 保留旧 preset 组合**：更新插件后点 New Session，若复用到的 blank Agent 仍加载，看到的还是旧组合 | 沿用"更新插件后重启宿主"，并在本次升级说明里点名 New Session；上游 guide 明确要求改 preset 定义后重启 Host |
| R3 | **peer 范围放宽后的假绿**：`^0.2.1-rc.2` 这类写法会放进未测的 `0.2.2-alpha.*` | 保持精确 pin；每轮宿主升级先跑 `check:dsh` + `smoke:boot` 再改版本 |
| R4 | **模型列表跟随 `/models`**：内置目录与线上列表不一致时，宿主模型选择器内容会变 | 只复核 README 推荐语，不写死模型 id；本仓无代码动作 |
| R5 | **More 菜单 / 导航入口自定义**：用户会把新入口误认为本插件功能，或找不到原来的插件配置入口 | 文档答疑；配置卡片座位（`plugins.bundle.config`）已核对未变，不需要迁移说明 |
| R6 | **rc.2 兼容性不再声明**：2.12.0 在 rc.2 上会被预检拒绝 | 发布说明写明"必须 rc.3"；需要继续支持 rc.2 的用户留在 2.11.1 |

## 7. 总体判断

rc.3 是**UI 增量版**，本仓扩展面零断裂，升级成本集中在版本闸门与发布顺序：改 manifest、升版本、
跑五步验证即可，没有代码适配项。不要因为"只是 UI 更新"就跳过 `check:dsh`——闸门的失败形态是静默禁用，
在桌面端连报错都看不到。也不要顺手补 rc.3 新槽（导航入口、More 菜单、views actions）：本仓没有对应需求，
按账本"依赖面越小越好、每条都要能被探测"的原则，新增消费前先问能不能被 `check:dsh` 探测。

## 附录 A：rc.3 commit 清单

| SHA | 标题 | 文件数 | 与本仓的关系 |
|---|---|---|---|
| `5ff29190` | `feat(ui): add navigation entry customization (#6247)` | 219 | 导航入口 + More 菜单 + blank 复用；仅 1 个 host 侧注释文件 |
| `67516495` | `feat(analytics): track navigation entries and preset selections (#6600)` | 51 | 全客户端；自定义 preset 记 `other` 且不上报 |
| `39d29038` | `fix(ui): separate navigation pins from selection and show menu icons (#6883)` | 50 | 全客户端；`Menu` 仅加可选 props |
| `c48f8523` | `feat(llm): follow the official /models listing on the DeepSeek API-key route (#6944)` | 57 | 全 `packages/llm/*`；本仓不消费 |
| `d02ea370` | `release(dsh): 0.2.1-rc.3` | — | 版本提交 |
| `1f81c047` | Merge PR #6999 | — | 合并提交 |

## 附录 B：发布包静态核对项

对 rc.3 的 `dsh-client-ui-{plugin-manager,conversation,agent-preset,sidebar,sidebar-right,commands,deliverables,tool}`
与 `dsh-web-frontend` 解包后逐字搜过：`plugins.bundle.config`、`plugins.detail.badge`、
`conversation.input.overlay`、`conversation.session.header.views.actions`、`data-plugin-{config,rows,detail}`、
`openList`、`minWidthFromAnchor`、`SettingsFormModel`、`SettingsSecretField`、`--dsw-menu-backdrop-filter`、
`[data-menu-material]`。除 `openList` 与 `views.actions` 为新增外，其余全部在场且形状未变。
