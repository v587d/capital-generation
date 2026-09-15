# DSH 接口账本与兼容性升级手册

> 本文件是**维护者文档**，不注入模型、不进 skill 目录。
> 配套探针：`npm run check:dsh`（`scripts/check-dsh-compat.mjs`）——本表的每条接口都有一条
> 对应的机器断言，上游漂移变成具名失败，而不是运行时静默失效。
> 方案背景见 `docs/design/chart-visualization.md`。

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
| L4 | Slot key `tool.call.toolview` + `ToolCallOwnerProps.{callId,toolName,block,cwd,openFile,loadImage}` | 唯一的对话流内嵌座位；`key` = 工具名，`block` 给参数与结果 | 在 shipped bundle 里搜 slot key 字符串与 props 字段名 | 图卡片静默回退成通用工具行 | 客户端半边 + `dsh-adapter` |
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
   首轮工具表里有 `render_chart`；回执里 `chart_url` 非 null；浏览器控制台出现
   `capital-charts: 客户端半边已挂载（render_chart toolview 已注册）`；
   让模型画一张图，确认对话流里在该工具卡片位置出现可交互图、跟随明暗主题。

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
| 2026-09-15 | 0.1.5-rc.1 | L1–L7、L9 全部通过；L2 已对 `chart-ui/` 生效；L8 由 `npm test` 覆盖 |
| 2026-09-15 | 0.1.5-rc.1 | `npm run smoke:boot` 通过：scratch profile 完成 boot，且 index.html 的 `__DSH_BOOT__` 含 chart-ui bundle（`./chart-ui/index.js` 写法） |
| 2026-09-15 | 0.1.5-rc.1 | Step 3 客户端 bundle 由 `scripts/build-client.mjs`（esbuild）生成；`test/chart-client.test.mjs` 在最小 DOM 沙箱执行工厂函数，确认注册 `tool.call.toolview['render_chart']`、库内联、无页面全局 |
| 2026-09-15 | 0.1.5-rc.1 | **真实会话已复核**：`render_chart` 出图后对话流内嵌卡片与右栏文件都能渲染 —— 反证 `chart_url` 非空、toolview 已挂载、preset 平面能消费 host 平面 `capitalCharts`（L6 与跨平面消费成立） |

## 事故记录

| 日期 | 症状 | 根因 | 修法 |
|---|---|---|---|
| 2026-09-15 | 用户重启后 **dsh web 完全起不来**：`failed to import loader entry capital-charts ([object Object]): name.startsWith is not a function` | 把 `!!js` 表达式写进了 patch 行的 `name`；loader 只对 fiber 的 `config` 插值，`name` 原样进 ESM import | 行名改字面量；新增回归断言「任何行的 `name` 都必须是字面量字符串」 |
| 2026-09-15 | 行名改成 subpath 后 profile 能起，但**客户端半边静默消失**（图表 UI 永远不出现，无任何报错） | `locatePkgJson` 对「非 path-like 且非精确包名」直接 `return undefined`，这颗行被当成"不是客户端包" | 行名改成相对本 patch 目录的 path-like 写法 `./chart-ui/index.js`；新增断言复刻这条守卫 |
| 2026-09-15 | 以上两条**都没被当时的验证发现** | 用 `dsh --dump-config` 当验证手段——它只打印配置，不做插值也不导入任何行 | 新增 `npm run smoke:boot`：真启动 + 复核 `__DSH_BOOT__`；写进 runbook 第 5 步，标注"不能省" |
