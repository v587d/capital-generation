# settings 配置纪律（`capital-config`，host 平面）

> 索引见仓库根 `AGENTS.md` §5。改 `capital-config/`、`cordis.patch.yml` 的 insert 行或设置卡片
> 字段之前读这里。§编号沿用 `AGENTS.md` 的全局命名空间。
>
> 本节按 **DSH 0.1.7** 的 settings 面重写（0.1.5 的 `settings.register` / `settingsScope` /
> `settings.plugin.item` 整条链路已被上游删除，issue #3 就是没跟上这次变更）。

## 5.1 挂载：条目 id 就是命名空间

- **为什么独立嵌套包**：卡片属 host 平面（bundle 必须在页面启动那一刻进 boot graph），主插件行
  在 preset / session 平面；由 `cordis.patch.yml` insert 行挂载，行名必须 path-like 相对路径
  （坑见该文件注释与账本）。
- **⛔ 座位只有包级一处**：卡片注册进 `plugins.bundle.config`（`kind: 'keyed'`，key = **组合包的
  包名**）。这是本项目对**所有**可编辑配置的固定落点——新增字段只改条目 Config 的 `.volatile()`
  投影，**不开第二个座位**。不用行级 `plugins.row.config`（key `<包名>#<行 id>`）：那把座位埋在
  「包含的组件」里再往下一层，填一次密钥点三下，且同包的 `capital-charts` /
  `preset-capital-generation` 没有表单、点进去是死路。配置是「这个插件」的属性，不是某一行的属性。
- **可编辑性是 schema 事实，不是注册出来的命名空间**：`dsh-settings` 只把活动 profile 条目
  Config 里标了 `.volatile()` 的字段投影成表单（`volatileForm`），且 `ns` **恒等于条目 id**。
  ⛔ 一个 volatile 字段都没有 ⇒ `volatileForm` 返回 `undefined`，该条目**不进** describe 镜像；
  写非 volatile 路径被 `Config field "…" is not volatile` 拒绝（那样就还是只能改 profile 文件）。
  `.volatile()` 要 schemastery ≥ 3.18.4，两处清单都跟着抬。
- **两处同字链**：条目 id 是 **四处同字**——`cordis.patch.yml` 的行 id ≡ `capital-config/index.js`
  的 `SETTINGS_ENTRY_ID` ≡ `src/index.ts` 的 `CAPITAL_CONFIG_ENTRY_ID` ≡ `client.src.cjs` 的
  `ENTRY_ID`（它决定 `configForms.get()` 取得到取不到）。包名是**另一条链**：`client.src.cjs` 的
  `BUNDLE_NAME` ≡ 根 `package.json` 的 `name`，页面按 `entryKey: pkg.name` 渲染该段，且
  `configured: ledger.bundles.has(pkg.name)`——**没注册就整块不出现**。两条链任一处漂移的表现都不
  是报错，而是**卡片静默消失**（用户以为"设置里没这个插件"）。回归
  `test/capital-config.test.mjs` 的对齐用例（含"代码里不许再出现 `plugins.row.config`"）。
- **包级座位不给 form**：页面只为行级配置注入 `form`（`formFor(openRow.rowId)`），包级只传
  `view: 'page'`。本卡片本来就只消费自己 `inject()` 出来的 hooks 与动作，不碰页面注入，所以
  搬迁不需要补任何服务面。

## 5.2 存储边界：密钥、回退开关、两处 schema 一致

- **密钥进 credentials 域，不进 settings 文档**：Key 经 `ctx.remote.credentials.set` 写入，
  settings 里只存 **ref 名**（`fuyaoCredentialRef` / `retriever.*.credentialRef`）。卡片把四个
  密钥声明成 `SettingsFormModel` 的 write-only secrets：值从不随响应出网，控件只报"已配置/未配置"。
- **唯一写进配置的偏好**是回退开关 `retriever.localFetch.enabled`：点即保存，走
  `scope.mutate([{ op: 'set', path: ['retriever', 'localFetch', 'enabled'], value }])`
  （`set(field)` 只支持顶层字段）。开关严格由条目快照渲染 ⇒ 写被拒（revision 冲突等）时**不翻转**，
  并自己补一句 `role="status"` 提示；它不进草稿流，所以不影响密钥的保存/放弃。0.1.7 的
  `applies` 恒为 `live`，"生效"仍是**新 Capital 模式会话**（主插件在 `apply()` 时读一次）。
- **主插件读回**：`src/index.ts` 经 `settings.describe()` 按条目 id 取解析值，再用自己的
  `Config(...)` 过一遍——**两处 schema（`src/index.ts` 与 `capital-config/index.js`）默认值必须
  逐字一致**，否则字段在边界被静默改写。回归：`test/capital-config.test.mjs`（deepEqual +
  按上游 `plainConfig` 摊平取值单元）与 `test/apply-integration.test.mjs`（条目值真的驱动装配、
  条目缺席/抛错时回落 preset 配置）。
- **文案与排布口径**（改动要有对应用户诉求，别顺手加回）：四个 Key **一律不写"必填 / 选填"**——本项目
  不依赖任何单一数据源；每条提示都点名"新 Capital **模式**会话生效"；本机直连与 PaddleOCR 的说明
  各不超过两句；文档链接只写"官方文档"＋右上角斜上箭头，落在标签右边同一行。回退开关排在四个密钥
  **之后**（它不是密钥，夹在中间会被读成第五个 Key），且与官方 `.field` 同一套间距（`padding: 12px 0`
  ＋ 顶部 0.5px 分隔线）。回归 `test/capital-config.test.mjs` 的文案闸门与渲染顺序断言。

## 5.3 改完之后

- **只用官方表单件**：`SettingsForm` / `SettingsSecretField` / `Switch` / `IconRightUpOutlineRegular`
  （`@deepseek-ai/dsh-client-ui-primitives`），服务面是 `ctx.configForms` 的
  `get(条目 id)` + `whileServed([条目 id], register)`。`SettingsForm` 在卸载时自行丢弃草稿（没有
  discard 控件）。
- **文档链接落在官方 head 行里**：`SettingsSecretField` 的 `label` 只收字符串，节点塞不进去，所以
  挂载后取 `label` 的父节点（head 行）把 `<a>` **`createPortal`** 进去（`react-dom` 在客户端模块表里，
  `dsh-context` 同法），摆位靠两条元素选择器（`.capital-config-secret-row label { flex: 0 1 auto }`
  与 `label ~ span { order: 1; margin-left: auto }`）——官方 head 是 flex 且 `label` 吃掉整行。
  找不到 head 就退回本行末尾（位置退化、链接不丢）。这四条前提都进了账本 L15 探针。
  整条链路已入账本 **L15**：`npm run check:dsh` 逐条探测，上游漂移是具名失败，不是"卡片某天不见了"。
- **改客户端源码后必须 `npm run build`**（含 `build:config-client`）并**刷新页面**：bundle 缺失
  会让整个 web profile 起不来。改完跑 `npm test` + `npm run check:dsh`。

## 5.4 用户在哪儿找到这张卡片

0.1.7 把第三方插件的可编辑面从「设置」页**整体搬到了「插件」页**（`settings.plugin.item` 已被上游
删除，设置页那一栏现在只剩官方的 `settings.plugins.tab`）。点击路径只有两跳：

**侧栏「插件」→「已安装」里点开 `@v587d/capital-generation`（卡片显示的是 `locale/zh.json` 的
`meta.title`，不是 npm 包名，见账本 L25）→ 描述与「包含的组件」之间的「配置」段**。

「包含的组件」里的四行（`capital-config` / `capital-charts` / `capital-watchlist` /
`preset-capital-generation`）现在**都没有**配置控件——卡片不在行详情页里，这是设计而非故障。
`capital-config` 那一行仍在：它是 settings 命名空间的来源（§5.1），只是不再充当座位。

排查顺序也据此改：① 条目在不在 `settings.describe()`（§5.1 的 volatile 投影，不在就整张卡片读不到）；
② 冒烟里行清单有没有 `capital-config`（`pluginManager.listBundles()`，取数通道）；③ 浏览器有没有
**刷新**（bundle 在页面加载时确定，宿主重启不换已打开页面的那份）。座位是注册出来的：
包名那一路（§5.1 的 `BUNDLE_NAME`）漂了，`configured` 为假 ⇒ 配置段整块不出现，零报错。
