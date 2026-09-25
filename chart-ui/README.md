# @v587d/capital-charts

Capital 模式的图表前端组件。**它不是独立安装的包**——它是 `@v587d/capital-generation`
随包携带的嵌套包，由后者 `cordis.patch.yml` 里的 `insert` 行以 host 平面挂载。

## 为什么是一个嵌套包，而不是主包的一部分

三个约束叠在一起，只有这一种结构能同时满足：

1. **一个包 = 一份客户端 bundle**。`dsh-client-modules` 把"同一个包名出现在多个 active
   Loader source"判为组合错误，所以"工具行（preset 平面）+ 图表 UI 行（host 平面）"
   不可能塞进同一个包。
2. **客户端 bundle 必须挂在 host 平面**。boot graph 在 `index.html` 渲染那一刻确定，
   运行期新增的 entry 没有送达浏览器的通道。挂在 preset 行上的客户端 bundle 到不了
   已经打开的页面。
3. **用户只装一次**。本包被主包的 `files` 收录、随同一个 tarball 发布，patch 行用
   **相对本 patch 目录的字面量路径** `./chart-ui/index.js` 挂载，不依赖 profile 的
   `node_modules` 能按裸名解析到它（pnpm 的 isolated 布局下传递依赖解析不到）。

## 行名的三条规则（都踩过，别再踩）

| 规则 | 写错的后果 |
|---|---|
| `name` **不参与 `!!js` 插值**（只有 fiber 的 `config` 会） | 启动期 `name.startsWith is not a function`，**整个 profile 起不来** |
| `name` 只认**精确包名**或 **path-like**（`.` / `file:` / 绝对路径） | subpath 会被 `locatePkgJson` 静默丢弃：profile 能起，但**图表 UI 永远不出现且无报错** |
| 相对行名的解析基址是 **patch 文件所在目录**，不是 profile 根 | 行解析不到，profile 起不来 |

因此 `cordis.patch.yml` 里写的是 `./chart-ui/index.js`（`cordis-plugin-include` 会把
baseUrl 设为本 patch 文件所在目录）；`locatePkgJson` 随后按"最近的 package.json"归属，
包身份为 `@v587d/capital-charts`。

回归断言在 `test/chart-composition.test.mjs`（既复刻那两条守卫，也真的解析并导入一次）；
真实启动验证是 `npm run smoke:boot`。

## 文件

| 文件 | 说明 |
|---|---|
| `index.js` | 宿主半边：`capitalCharts` 服务 + `/capital-charts/<chart_id>.json` 序列路由。纯 JS、零构建 |
| `client.src.cjs` | 浏览器半边源码：只注册 `tool.call.toolview['render_chart']` 过程明细卡片（取数 → 渲染 → “打开”自包含 HTML）。**不再有 turn-tail 卡片**——呈现改走官方交付通道，见下 |
| `client.js` | 浏览器半边**构建产物**：`npm run build:client` 用 esbuild 打包生成。`lightweight-charts` 内联（无页面全局）、`react` external |
| `package.json` | `dsh.client` 声明（`platform: web`）+ `exports["./client"]` |

## 构建

```sh
npm run build:client   # 生成 chart-ui/client.js（`npm run build` / `npm test` 会先跑它）
```

产物形状与 shipped 客户端一致：`window.__ModuleLoader__.load({ id, factory })`，工厂是 CommonJS。
`client.js` 是**提交进仓库**的构建产物（本包随主包发布，用户装的是打好的文件）；
`client.src.cjs` 与构建脚本 `scripts/build-client.mjs` 才是维护面。

## 为什么需要构建步骤

设计（内部设计文档 `docs/design/chart-visualization.md` §9，**不随仓库发布**）要求客户端**不产生页面全局**，所以
`lightweight-charts` 走打包进来的 ESM 模块（tree-shake 后内联），而不是 UMD 全局——
避免与官方或其它插件带的同库不同版本互相覆盖。运行时（`src/chart/runtime.ts`，与自包含
HTML 逐字节同源）以字符串形式在构建期落成真实模块，**不在浏览器里 eval**（避开 CSP）。

浏览器半边的契约测试在 `test/chart-client.test.mjs`：把 bundle 放进最小 DOM 沙箱真的执行
工厂函数，断言它只按工具名注册 toolview、**不再持有任何图表专属会话投影或 turn-tail 抢占**、
库已内联、react 保持 external、不依赖页面全局。

## 数据通道

图表序列**不进模型上下文**：`render_chart`（preset 平面）把序列写进 workspace 产物并
把**已解析好的绝对路径**登记到 `capitalCharts` 服务；浏览器半边按回执里的 `chart_url`
取数。路由只读登记过的文件，URL 里没有用户可控的路径成分。

**认证围栏（2026-09 review 修复）**：DSH 的 `webServer` 路由分发**不做认证**——认证由
route owner 自己负责，平台自己的 `/api` 与首页分别走 `connection.requestRejection()` 与
`authorizeIndex()`，上游 deliverables 的注释也写着 "inside Connection's authentication fence"。
本路由以前直接 `webServer.register(...)`，等于开了一个无认证端点：任何本机进程或页面只要
拿到 `chart_id` 就能读 `series.json`（`chart_id` 随机只降低命中率，不是访问控制）。
现在 `apply()` 把 `ctx.get('connection').requestRejection(req)` 接进 handler：

- 未认证 → 401，Host/Origin 不受信 → 403，且**认证先于方法与路径判定**（与 `/api` 一致，
  未认证探测拿不到"路由存在 / chart_id 是否存在"的信息）；
- `authorize` 抛错时 fail closed（401），不退化放行；
- 没有 `connection` 服务的组合（Electron/file:// 这类没有浏览器认证面的载体）才退回旧行为。

上游接口账本见 `docs/reference/dsh-surface-ledger.md` 的 **L13**，探针 `npm run check:dsh`；
本仓回归在 `test/chart-host.test.mjs`。

**已知遗留**：登记表是进程级 500 条 LRU，而 standing composition 进程内只有一个实例
（所有 Capital 会话共享），因此会话 B 大量出图会淘汰会话 A 的 URL（A 的图仍在盘上但卡片 404）。
修法（按 owner 分区 / 给条目加过期并同步撤销）尚未实施，记录在案。


## 本轮呈现（官方交付通道）

出图成功后，**宿主**（`@v587d/capital-generation` 的 `render_chart`）会往"用户正在看的根会话"
追加一条**官方** `deliverables/presented` 事件，把 `capital-analysis/charts/<chart_id>/chart.html`
登记为**本轮交付物**：

- 载荷只有官方契约字段：`turn` / `callId`（`capital-chart:<chart_id>` 句柄）/ `files[]`
  （工作区相对 `html_path` + 标题）——绝不含 rows、series、HTML 或绝对路径；
- 用户在收尾的官方「本轮文件改动 / 交付」行点开该文件，右侧由官方
  `dsh-client-ui-sidebar-documentpreview` 的 script-enabled iframe 渲染自包含图表；
- 非 surface 事件不进 `deriveMessages()`，所以**不污染模型上下文**；
- 图表跟着 Dataset 一对一：需要多个视图就出多张，不做多源叠图。

**为什么不再自建卡片（2026-09-18 事故）**：卡片需要一条自定义会话事件承载，而会话日志的事件
词汇表是**闭集**、读取侧 fail-closed，且 `Session.append` 无法设置 `ignorable`——自定义事件写进日志后
会让**整份会话在冷加载时打不开**（实测 6 份会话 `failed to observe session`）。所以客户端不再持有
任何图表专属会话投影，**turn-tail 卡片通道已整体移除**；回归断言在 `test/chart-client.test.mjs`。
详见 `src/chart/events.ts` 头部、`docs/dev/chart-presentation.md` §6.1 与
`docs/dev/chart-delivery-events.md` §6.3。

`tool.call.toolview['render_chart']` 保留为工具过程明细（子会话与展开视图可见），
经 `/capital-charts/<chart_id>.json` 旁路取数渲染，**不经**会话事件。
