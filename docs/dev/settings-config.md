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
- **可编辑性是 schema 事实，不是注册出来的命名空间**：`dsh-settings` 只把活动 profile 条目
  Config 里标了 `.volatile()` 的字段投影成表单（`volatileForm`），且 `ns` **恒等于条目 id**。
  ⛔ 一个 volatile 字段都没有 ⇒ `volatileForm` 返回 `undefined`，该条目**不进** describe 镜像；
  写非 volatile 路径被 `Config field "…" is not volatile` 拒绝（那样就还是只能改 profile 文件）。
  `.volatile()` 要 schemastery ≥ 3.18.4，两处清单都跟着抬。
- **四处 id 同字 + 一处槽 key**：`cordis.patch.yml` 的行 id ≡ `capital-config/index.js` 的
  `SETTINGS_ENTRY_ID` ≡ `src/index.ts` 的 `CAPITAL_CONFIG_ENTRY_ID` ≡ `client.src.cjs` 的
  `ENTRY_ID`；卡片坐落 Plugins 页该行的 keyed 槽 `plugins.row.config`，key 是
  `<包名>#<行 id>`（上游 `rowConfigKey`）。页面本身按**行 id** 取表单，所以条目 id 就是这条链的
  座位号。任一处漂移的表现都不是报错，而是**卡片静默消失**（用户以为"设置里没这个插件"）。
  回归 `test/capital-config.test.mjs` 的四处对齐用例。

## 5.2 存储边界：密钥、回退开关、两处 schema 一致

- **密钥进 credentials 域，不进 settings 文档**：Key 经 `ctx.remote.credentials.set` 写入，
  settings 里只存 **ref 名**（`fuyaoCredentialRef` / `retriever.*.credentialRef`）。卡片把四个
  密钥声明成 `SettingsFormModel` 的 write-only secrets：值从不随响应出网，控件只报"已配置/未配置"。
- **唯一写进配置的偏好**是回退开关 `retriever.localFetch.enabled`：点即保存，走
  `scope.mutate([{ op: 'set', path: ['retriever', 'localFetch', 'enabled'], value }])`
  （`set(field)` 只支持顶层字段）。开关严格由条目快照渲染 ⇒ 写被拒（revision 冲突等）时**不翻转**，
  并自己补一句 `role="status"` 提示；它不进草稿流，所以不影响密钥的保存/放弃。0.1.7 的
  `applies` 恒为 `live`，"生效"仍是**新 Capital 会话**（主插件在 `apply()` 时读一次）。
- **主插件读回**：`src/index.ts` 经 `settings.describe()` 按条目 id 取解析值，再用自己的
  `Config(...)` 过一遍——**两处 schema（`src/index.ts` 与 `capital-config/index.js`）默认值必须
  逐字一致**，否则字段在边界被静默改写。回归：`test/capital-config.test.mjs`（deepEqual +
  按上游 `plainConfig` 摊平取值单元）与 `test/apply-integration.test.mjs`（条目值真的驱动装配、
  条目缺席/抛错时回落 preset 配置）。

## 5.3 改完之后

- **只用官方表单件**：`SettingsForm` / `SettingsSecretField` / `Switch`
  （`@deepseek-ai/dsh-client-ui-primitives`），服务面是 `ctx.configForms` 的
  `get(条目 id)` + `whileServed([条目 id], register)`。0.1.7 的 primitives 删掉了外链图标
  （接口文档链接因此是纯文字），`SettingsForm` 在卸载时自行丢弃草稿（没有 discard 控件）。
  整条链路已入账本 **L15**：`npm run check:dsh` 逐条探测，上游漂移是具名失败，不是"卡片某天不见了"。
- **改客户端源码后必须 `npm run build`**（含 `build:config-client`）并**刷新页面**：bundle 缺失
  会让整个 web profile 起不来。改完跑 `npm test` + `npm run check:dsh`。

## 5.4 用户在哪儿找到这张卡片

0.1.7 把第三方插件的可编辑面从「设置」页**整体搬到了「插件」页**（`settings.plugin.item` 已被上游
删除，设置页那一栏现在只剩官方的 `settings.plugins.tab`）。点击路径：

**侧栏「插件」→「已安装」里点开 `@v587d/capital-generation` → 「包含的组件」里点 `capital-config`
那一行 → 行详情页下方的配置段**。同包里另外两行是 `capital-charts`（图表 UI）与
`preset-capital-generation`（预设声明），它们没有 volatile 字段，点进去自然没有表单——**这不是坏了**。

行清单来自宿主 `pluginManager.listBundles()`；`npm run smoke:boot` 的 boot 内探针把它连同
"有没有 `capital-config` 这一行"一起打印，所以"卡片没座位"在冒烟里就是具名失败，不必等用户找不到
才发现。找不到卡片时的排查顺序：① 冒烟里行清单有没有 `capital-config`（座位）；② 条目在不在
`settings.describe()`（§5.1 的 volatile 投影）；③ 浏览器有没有**刷新**（bundle 在页面加载时确定，
宿主重启不换已打开页面的那份）。
