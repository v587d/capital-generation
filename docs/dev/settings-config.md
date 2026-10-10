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
- **「包含的组件」是宿主的格子，我们没有能替换它的座位**：包页在 `div.detailSections` 里连着画
  两格——`section[data-plugin-config]`（我们的卡片）与 `section[data-plugin-rows]`（宿主的行清单，
  行开关 / 状态点 / 「共 N 个 · 运行 N」都在它那里，`plugins.detail.section` 只能在它**之后**追加）。
  卡片顶上的第三格 tab 不重画那份清单，只切它的可见性：见 §5.3 的两条 `:has()` 与方向性纪律。

## 5.2 存储边界：密钥、选用开关、两处 schema 一致

- **密钥进 credentials 域，不进 settings 文档**：Key 经 `ctx.remote.credentials.set` 写入，
  settings 里只存 **ref 名**（`fuyaoCredentialRef` / `retriever.*.credentialRef`）。卡片把四个
  密钥声明成 `SettingsFormModel` 的 write-only secrets：值从不随响应出网，控件只报"已配置/未配置"。
- **即时写入的偏好**包括回退开关 `retriever.localFetch.enabled` 和 catalog 中每个选用 Skill 的开关（例如 `selectedSkills.buffettFramework`、`selectedSkills.financialHealth`）：都走 `scope.mutate([{ op: 'set', path, value }])`（`set(field)` 只支持顶层字段），并由条目快照渲染；写被拒时不翻转并显示提示。「精选 Skills」那一格是**左右两列**：左列按能力标签筛选——**没有**「按能力筛选」那句字面提示（名字只挂在 `role=group` 的 `aria-label` 上），标签**按条数从高到低**排，「全部」不参与排序恒在第一格，每个标签后面是"点它会显示几行"（按 catalog 现算，随滚动 `sticky` 钉在左边）；右列是清单，每行显示技能名、简述、上游仓库链接、能力标签与**详情**，**复制技能名**只给已开启的行（那串名字是给会话用的，没开的复制了也用不上；「详情」不留这道闸门——开之前正是要读原文的时候），**已开启的行排在清单最前面**、组内保持 catalog 顺序，但这份顺序**只在进入这一格的那一刻定一次**（存的是那一刻的 key 名单，不是开关的实时状态）：拨开关当场不挪行——把用户手底下那一行抽走比不置顶更糟，切走再切回来才置顶；tab 上那个 `已开启/总数` 仍然实时（数字当场不说谎，位置不必当场动）。不显示 slug `<code>`（名字靠复制按钮给，无障碍名与悬停提示必须带着它）、不显示状态、维护者、提交/复查日期或风险提示。开启后生效于之后新建的 Capital root Agent；selected skill provider 只注册到 Agent 自己的 scope，子 Agent 不继承。
- **主插件读回**：`src/index.ts` 经 `settings.describe()` 按条目 id 取解析值，再用自己的
  `Config(...)` 过一遍——**两处 schema（`src/index.ts` 与 `capital-config/index.js`）默认值必须
  逐字一致**，否则字段在边界被静默改写。回归：`test/capital-config.test.mjs`（deepEqual +
  按上游 `plainConfig` 摊平取值单元）与 `test/apply-integration.test.mjs`（条目值真的驱动装配、
  条目缺席/抛错时回落 preset 配置）。
- **文案与排布口径**（改动要有对应用户诉求，别顺手加回）：四个 Key **一律不写"必填 / 选填"**——本项目
  不依赖任何单一数据源；每条 Key 提示都点名"新 Capital **模式**会话生效"；本机直连与 PaddleOCR 的说明
  各不超过两句；文档链接只写"官方文档"＋右上角斜上箭头，落在标签右边同一行。**排布是三格 tab**
  （`数据源` / `精选 Skills` / `包含的组件`，默认落 `数据源`）：tab 条**取代**当年 `h4 数据源` +
  `h5 精选 Skills` 那两级标题（h5 挂在 h4 底下会把平级的两块说成父子），格内顺序仍照旧——四个密钥 →
  保存 → 回退开关。标题体系之外的两枚**计数**：第二格 `已开启/总数`（分子来自条目快照，分母
  `SELECTED_SKILL_CATALOG.length`），第三格是行数（唯一来源 `remote.pluginManager.listBundles()`，
  **读不到就只写标题、绝不画 0**，失败不缓存、切格即重试——AGENTS.md §9.7 ⑤ 那条）。密钥草稿活在 DOM
  里而保存按钮可能在看不见的格子里，所以草稿在场时第一格改口「数据源 未保存」。
  ⛔ **三格的「tab 条 → 首行文字」必须等距**（2026-10-10 实测那一档是 24px；第三格靠一条负 margin 顶到
  同一档）：不等距就是每切一格跳一次；**面板只有一个子元素时 flex `gap` 不发生作用**，那 24px 得自己补。
  第三格画面上不写「组件清单在下方」那句（点这一格看到的就是清单），句子改挂 `.capital-config-sr-only`——
  `aria-controls` 指的这块面板不许是空的。回归 `test/capital-config.test.mjs` 的文案、筛选、渲染顺序、
  tab/计数、左右布局与样式表形状断言；等距那个数只能在浏览器里量（见账本当日行）。

## 5.3 改完之后

- **只用官方表单件**：`SettingsForm` / `SettingsSecretField` / `SegmentedControl` / `Switch` /
  `Modal` / `writeClipboard` / `IconRightUpOutlineRegular`（`@deepseek-ai/dsh-client-ui-primitives`），
  服务面是 `ctx.configForms` 的 `get(条目 id)` + `whileServed([条目 id], register)`。`SettingsForm` 在卸载时自行丢弃草稿（没有
  discard 控件）。
- **⛔ 三块面板全部挂载，不在屏的用 `hidden` 收起，不是不渲染**：`SettingsForm` 卸载即丢草稿
  （`dsh-client-ui-primitives/lib/index.js` 里那个 unmount `discard.current()`），只渲染活动格的话
  用户填了密钥瞄一眼另一格回来就没了。面板类**不许声明裸 `display`**——作者 `display` 会盖掉 UA 的
  `[hidden]{display:none}`，等于 hidden 失效：35 颗开关与密钥输入框看不见却仍在 Tab 序里，控件对
  自己说谎。`display` 只写在 `:not([hidden])` / `[hidden]` 两条里，样式表形状有源码闸。
- **tab 条不自造**：`SegmentedControl` 是**完全受控**件，自带 `role=tablist`/`role=tab`、roving
  `tabIndex`、←→↑↓/Home/End 走位与焦点跟随，卡片一律不补 `onKeyDown`（补了就是双重选择）。它按
  `` `${id}-${option.value}-panel` `` 发 `aria-controls`（写在它的 `.d.ts` 注释里，是文档化契约），
  所以三块面板的 `id` 必须逐字跟着这两个模板长——**包括第三块**：第三块的内容是宿主那段清单（在下方
  显形），面板本身只留一句读屏侧的话（`.capital-config-sr-only`，`position: absolute` ⇒ 零布局贡献），
  `aria-controls` 指的正是这块。悬空 id 与空面板都不报错，只有读屏用户付账。入账本 **L28**。
- **「详情」点开的是官方 `Modal`（非 headless），原文走一条自注册的本机路由**：header、标题、关闭按钮、Esc、
  点遮罩关闭与焦点归还都归它，我们只给 `open`/`onClose`/`title`/`closeLabel`/`description`（slug 挂在
  `description`）与正文；`open` 为假时它自己 `return null` ⇒ 35 行各挂一颗也不占 DOM。事实与自选股弹窗同属
  一颗组件，一起探在 **L19**。⛔ **开合必须是点击**：先前用的 `HoverCard` 只认 `onPointerEnter` + 500ms 计时，
  且**点锚点会把它关掉**——"点详情没反应、也不报错"是那个控件的语义（2026-10-10 实机），不是 handler 写错。
  ① 取数挂在 `onPointerEnter` / `onFocus`（悬停预热 ⇒ 点开那一瞬就有内容）与 `onClick` 上，**没悬停也没点击
  就一份都不取**（35 份合计约 750 KB，打进 bundle 就是每次开插件页都付一遍）；② 它 portal 到 body 且默认只有
  `min(380px, 100%)` ⇒ 宽度由一条**带元素名**的选择器 `div.capital-config-skill-modal` 覆掉（光类名与官方
  散列类同权重，押"我们的样式后注入"是巧合不是契约）；③ 正文自己 `max-height` + `overflow: auto`，标题与
  关闭按钮留在原位，34 KB 的原文也读得到底。地址由 `SKILL_DOC_ROUTE` 拼出，与 host 那半边**同字**（客户端
  import 不到那一层 ⇒ `test/capital-config-skill-docs.test.mjs` 对着两侧产物比；漂移 = 「详情」永远读不到且
  零报错）。失败文案分**两句**：回包里有我们那份 `{ error }` ⇒ 路由活着、这条快照读不到；回包不是我们的形状
  ⇒ **宿主进程里就没有这条路由**（点名"重启 DSH，刷新页面没有用"——客户端 bundle 每次开页换新，host 半边要重启才重新 import）。
- **⛔ `/capital-skills/<名>.md` 是文件读旁路，三条底线**：① 认证围栏接 `connection.requestRejection`
  （与 `/capital-charts`、`/capital-watchlist` 同一写法，§6.1 那条），被拒时**连一次读盘都不许发生**；
  ② **闭集**——请求里的名字只当 `SKILL_DOCS` 这张表的键用，路径按 catalog × `SELECTED_SKILL_SKILL_DIRS`
  在模块加载时现算成 `Map<名, file: URL>`，不参与任何拼接，所以 `%2F..%2F` 只会落到"表里没这个名字"；
  ③ 超限（`MAX_SKILL_DOC_BYTES`）**整份 413 拒绝、绝不截断**，且 `cache-control: no-store`——快照会随
  上游更新，缓存住就是拿旧原文说"这是原文"。路由经 `ctx.inject(['webServer'], …)` 挂（探测式写法会把
  正确性押在装配顺序上，2026-09-30 桌面端就是这么炸的两颗行）。**不新增 bundle 行**：它挂在已有的
  `capital-config` host 行上，所以「包含的组件」那个数字不变。
- **⛔ 第二格的左右两列不许冒出第二个滚动容器**：筛选器 `position: sticky` 的参照是**最近的滚动容器**，
  `.capital-config-selected-layout` / `.capital-config-selected-list` 只要有一条 `overflow` 非 visible，
  参照就换到自己身上，筛选器不再跟着页面滚——不报错，只是"吸顶坏了"。样式表形状闸钉着这一条
  （连同 sticky 必须有 `top`、第三格那条负 margin 的写法）。
- **⛔ 收起宿主「包含的组件」的两条规则只许写正面式**：`installStyles` 里
  `[data-plugin-detail="<包名>"]:has(.capital-config-card[data-capital-config-tab="sources"]) section[data-plugin-rows] { display: none }`
  与 `…"skills"…` 那一条，**各自成规则**（CSS 整条作废，逗号并条会被无关失败连坐），并且不许出现
  `:not([data-capital-config-tab="components"])` 这种否定式判据——那等于"一个拼错的属性值就把用户的
  行清单藏了起来"。于是所有失配方向（无 `:has()` 的引擎、宿主改名、老宿主没这段、卡片没被 `whileServed`
  放行、条目还在 `loading`、属性值意外）都落在**宿主段落照常可见**那一侧：宁可短暂重复，不能丢数据。
  回到可见一侧的结构保证是 tab 条不在任何面板里、永远收不到 `hidden`。锚点用 `data-plugin-detail`
  而不是 `data-plugin-config`：**行详情页**把这个属性挂在容器 div 上，同名不同形。包名从 `BUNDLE_NAME`
  插值 ⇒ 包名同字链（§5.1）现在管着槽 key、页面选择器、npm 地址三处。
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
`meta.title`，不是 npm 包名，见账本 L25）→ 描述与「包含的组件」之间的「配置」段**，进去就停在
第一格 **数据源**（四把 Key + 本机直连回退）；第二格 **精选 Skills**（带 `已开启/总数`）——左边按能力
筛选（每个标签带"点它会显示几行"、按条数从高到低，滚动时钉在左边），右边是清单，每行有开关与**详情**
（点开看 `SKILL.md` 原文，已开启的那几行排在清单最前），**复制技能名**只出现在已开启的那几行；第三格
**包含的组件**（带行数）——那一格的内容就是页面下方宿主自己画的
行清单，切过去它才显形（§5.1 / §5.3）。

「包含的组件」里的四行（`capital-config` / `capital-charts` / `capital-watchlist` /
`preset-capital-generation`）本身**没有**行级配置控件——可编辑面只有卡片这一份，不在行详情页里，
这是设计而非故障。`capital-config` 那一行仍在：它是 settings 命名空间的来源（§5.1），只是不再充当座位。
它同时是第三格那个数字的来路（`pluginManager.listBundles()` 里我们这个包的 `rows.length`），
也是 `/capital-skills` 那条原文旁路的宿主（§5.3）。

排查顺序也据此改：① 条目在不在 `settings.describe()`（§5.1 的 volatile 投影，不在就整张卡片读不到）；
② 冒烟里行清单有没有 `capital-config`（`pluginManager.listBundles()`，取数通道）且**行数与第三格那个
数字对不对得上**（数字缺席 = 那次读没成，不是"没有组件"）；③ 浏览器有没有
**刷新**（bundle 在页面加载时确定，宿主重启不换已打开页面的那份）；④ 「详情」说"原文读不到"就先看
`/capital-skills/<名>.md` 的回包：404 `skill_not_catalogued` = catalog 与快照目录对不上（§8.6 的
`docs:capabilities` 那类漂移），401 = 认证围栏（正常，说明不是匿名可访问），200 但卡片空 = 前端取数
没接上。座位是注册出来的：包名那一路（§5.1 的 `BUNDLE_NAME`）漂了，`configured` 为假 ⇒ 配置段整块不出现，零报错。
