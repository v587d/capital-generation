# settings 配置纪律（`capital-config`，host 平面）

> 索引见仓库根 `AGENTS.md` §5。改 `capital-config/`、`cordis.patch.yml` 的 insert 行或设置卡片
> 字段之前读这里。§编号沿用 `AGENTS.md` 的全局命名空间。

## 5.1 挂载与命名空间

- **为什么独立嵌套包**：卡片属 host 平面（bundle 必须在页面启动那一刻进 boot graph），主插件行
  在 preset / session 平面；由 `cordis.patch.yml` insert 行挂载，行名必须 path-like 相对路径
  （坑见该文件注释与账本）。
- **命名空间 = 卡片座位**：`SETTINGS_NAMESPACE`（`capital-generation`）同时是 host 注册命名空间
  与浏览器半边 `settings.plugin.item` 键；设置页渲染**交集**，**改名必须两处同改**（host 与
  `client.src.cjs` 的 `NS`），否则卡片**静默消失**（零报错）。回归 `test/capital-config.test.mjs`。

## 5.2 存储边界：密钥、回退开关、两处 schema 一致

- **密钥进 credentials 域，不进 settings 文档**：Key 经 `ctx.remote.credentials.set` 写入；
  settings 只存 **ref 名**。**唯一写例外**：回退开关 `~/.dsh/settings.yaml` 的
  `capital-generation.retriever.localFetch.enabled`（`applies:'restart'` ⇒ 新会话生效）由卡片用
  `scope.mutate` 嵌套路径即时写（`set()` 只支持顶层字段）。主插件读同一命名空间并再 `Config(...)`
  校验——**两处 schema（`src/index.ts` 与 `capital-config/index.js`）默认值必须逐字一致**，否则
  字段在边界被静默改写。回归同上。

## 5.3 改完之后

- **扩展面已入账本 L15**：`settings.register` / `settingsScope.bind` / `remote.credentials.*`
  全部由 `npm run check:dsh` 逐条探测；上游漂移是具名失败，不是"卡片某天不见了"。
- **改客户端源码后必须 `npm run build`**（含 `build:config-client`）并**刷新页面**：bundle 缺失
  会让整个 web profile 起不来。改完跑 `npm test` + `npm run check:dsh`。
