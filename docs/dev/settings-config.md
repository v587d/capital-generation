# settings 配置纪律（`capital-config`，host 平面）

> 索引见仓库根 `AGENTS.md` §5。改 `config/`、`cordis.patch.yml` 的 insert 行或设置卡片
> 字段之前读这里。§编号沿用 `AGENTS.md` 的全局命名空间。
>
> 本节按 **DSH 0.1.7** 的 settings 面重写（0.1.5 的 `settings.register` / `settingsScope` /
> `settings.plugin.item` 整条链路已被上游删除，issue #3 就是没跟上这次变更）。

## 5.1 挂载：条目 id 就是命名空间

- **为什么独立嵌套包**：卡片属 host 平面（bundle 必须在页面启动那一刻进 boot graph），主插件行
  在 preset / session 平面；由 `cordis.patch.yml` insert 行挂载，行名必须 path-like 相对路径
  （坑见该文件注释与账本）。这颗行的目录与包名自 2026-10-14 起是 `config/` = `@v587d/config`，**与行 id 无关**：id 才是命名空间，动它就等于改掉用户已保存的配置。⛔ 但**改目录名也不免费**：`dsh-config-editor` 每次保存都把**当时解析出的模块路径**连同 `id` 一起盖进 profile 的用户层 `cordis.patch.yml`（`{ id, name, config }`），而 `cordis-plugin-include` 遇 `name` 不匹配是**整行跳过**（默认日志连那句 `name mismatch … skipping` 的 warn 都不落到终端），条目静默回落 schema 默认——2.7.11 就是这样把用户已勾选的精选 Skills 打回默认值的（A/B 实测与恢复口径见账本 2026-10-14 行）。再要动这颗行的目录名，先写迁移说明，别当纯改名。
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
- **两处同字链**：条目 id 是 **四处同字**——`cordis.patch.yml` 的行 id ≡ `config/index.js`
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
  settings 里只存 **ref 名**（`fuyaoCredentialRef` / `ftshareCredentialRef` / `retriever.*.credentialRef`）。卡片把五把
  密钥声明成 `SettingsFormModel` 的 write-only secrets：值从不随响应出网，控件只报"已配置/未配置"。
- **即时写入的偏好**包括回退开关 `retriever.localFetch.enabled`、精选模式 `selectedSkillsMode`（`manual` / `auto`）和 catalog 中每个选用 Skill 的开关（例如 `selectedSkills.buffettFramework`、`selectedSkills.financialHealth`）：都走 `scope.mutate([{ op: 'set', path, value }])`（`set(field)` 只支持顶层字段），并由条目快照渲染；写被拒时不翻转并显示提示。「精选 Skills」那一格先是一颗**智能装载 Skills** 开关（默认关）：关着时下方才显示筛选条与清单，打开后两者一起隐藏，由模型按提问挑选。「Skill 特点」与「适用预设」**两行筛选条都在清单上方**，各带「全部」；两个维度同时选中取交集，计数按另一维度的当前选择现算（点它会显示几行），特点顺序按全量条数固定、不随筛选跳位。预设名用选择器里的五个：自动模式 / 行情专家 / 资讯专员 / 分析师 / 绘图专员；行情专家与绘图专员不加载精选 Skills，仍列出但置灰。清单每行以**技能名本身**作打开原文的按钮（不再有「复制技能名」与「详情」按钮），名字右侧依次是 Skill 特点标签（中性色）与适用预设标签（信息色），不再单独占一行；简述、触发句与关键词共用一套字号/行高（`dl` 两列：何时使用 / 关键词）。**已开启的行排在清单最前面**、组内保持 catalog 顺序，但这份顺序**只在进入这一格的那一刻定一次**（存的是那一刻的 key 名单，不是开关的实时状态）：拨开关当场不挪行——把用户手底下那一行抽走比不置顶更糟，切走再切回来才置顶。不显示 slug `<code>`、状态、维护者、提交/复查日期或风险提示。开启后在**下一条指令**即生效（每轮 `agent/pre-step` 重读并刷新目录，无需新建会话）；selected skill provider 只注册到 Capital 根 Agent 自己的 scope，子 Agent 不继承。
- **主插件读回**：`src/index.ts` 的 `readCapitalSettings` 三级取数——`settings.describe()`（已应用视图）
  → `configEditor.entries()` 的条目保存层（describe() 在条目 fiber 未挂好的窗口会**整个跳过条目**，
  已保存的值仍在保存层）→ preset 兜底且**可辨认**（`source === 'preset'`，"读不到"不许伪装成"用户
  全关"）。服务引用一律**调用期现取**（装配期捕获会押注 boot 注册顺序，2026-10-13 精选 Skills 事故）。
  取到值再用自己的 `Config(...)` 过一遍——**两处 schema 默认值必须逐字一致**。回归：`test/capital-config.test.mjs`（deepEqual + 按上游 `plainConfig` 摊平取值单元）与 `test/apply-integration.test.mjs`（三级读取、服务晚到、条目值真的驱动装配）。
- **文案与排布口径**（改动要有对应用户诉求，别顺手加回）：五个 Key **一律不写"必填 / 选填"**——本项目
  不依赖任何单一数据源；每条 Key 提示都点名"新自动模式会话生效"；本机直连与 PaddleOCR 的说明
  各不超过两句；文档链接只写"官方文档"＋右上角斜上箭头，落在标签右边同一行。**排布是三格 tab**
  （`数据源` / `精选 Skills` / `包含的组件`，默认落 `数据源`）：tab 条**取代**当年 `h4 数据源` +
  `h5 精选 Skills` 那两级标题（h5 挂在 h4 底下会把平级的两块说成父子），格内顺序仍照旧——五个密钥 →
  保存 → 回退开关。标题体系之外只有**一个计数**：第三格是行数（唯一来源 `remote.pluginManager.listBundles()`，
  **读不到就只写标题、绝不画 0**，失败不缓存、切格即重试——AGENTS.md §9.7 ⑤ 那条）。第二格 tab **只写「精选 Skills」**，不再拼已开启数或「自动」；数量改由上方筛选条逐格给出（按另一维度的当前选择现算）。密钥草稿活在 DOM
  里而保存按钮可能在看不见的格子里，所以草稿在场时第一格改口「数据源 未保存」。
  ⛔ **三格的「tab 条 → 首行文字」必须等距**（2026-10-10 实测那一档是 24px；第三格靠一条负 margin 顶到
  同一档）：不等距就是每切一格跳一次；**面板只有一个子元素时 flex `gap` 不发生作用**，那 24px 得自己补。
  第三格画面上不写「组件清单在下方」那句（点这一格看到的就是清单），句子改挂 `.capital-config-sr-only`——
  `aria-controls` 指的这块面板不许是空的。回归 `test/capital-config.test.mjs` 的文案、两维筛选与计数、渲染顺序、
  tab/计数、上方筛选布局与样式表形状断言；等距那个数只能在浏览器里量（见账本当日行）。

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
- **点技能名打开的是官方 `Modal`（非 headless），原文走一条自注册的本机路由**：header、标题、关闭按钮、Esc、
  点遮罩关闭与焦点归还都归它，我们只给 `open`/`onClose`/`title`/`closeLabel`/`description`（slug 挂在
  `description`）与正文；`open` 为假时它自己 `return null` ⇒ 68 行各挂一颗也不占 DOM。事实与自选股弹窗同属
  一颗组件，一起探在 **L19**。⛔ **开合必须是点击**：先前用的 `HoverCard` 只认 `onPointerEnter` + 500ms 计时，
  且**点锚点会把它关掉**——"点名字没反应、也不报错"是那个控件的语义（2026-10-10 实机），不是 handler 写错。
  ① 取数挂在 `onPointerEnter` / `onFocus`（悬停预热 ⇒ 点开那一瞬就有内容）与 `onClick` 上，**没悬停也没点击
  就一份都不取**（68 份合计约 325 KB，打进 bundle 就是每次开插件页都付一遍）；② 它 portal 到 body 且默认只有
  `min(380px, 100%)` ⇒ 宽度由一条**带元素名**的选择器 `div.capital-config-skill-modal` 覆掉（光类名与官方
  散列类同权重，押"我们的样式后注入"是巧合不是契约）；③ 正文自己 `max-height` + `overflow: auto`，标题与
  关闭按钮留在原位，34 KB 的原文也读得到底。地址由 `SKILL_DOC_ROUTE` 拼出，与 host 那半边**同字**（客户端
  import 不到那一层 ⇒ `test/capital-config-skill-docs.test.mjs` 对着两侧产物比；漂移 = 点名字永远读不到且
  零报错）。失败文案分**两句**：回包里有我们那份 `{ error }` ⇒ 路由活着、这条快照读不到；回包不是我们的形状
  ⇒ **宿主进程里就没有这条路由**（点名"重启 DSH，刷新页面没有用"——客户端 bundle 每次开页换新，host 半边要重启才重新 import）。
- **⛔ `/capital-skills/<名>.md` 是文件读旁路，三条底线**：① 认证围栏接 `connection.requestRejection`
  （与 `/capital-charts`、`/capital-watchlist` 同一写法，§6.1 那条），被拒时**连一次读盘都不许发生**；
  ② **闭集**——请求里的名字只当 `SKILL_DOCS` 这张表的键用，路径按 catalog × `SELECTED_SKILL_SKILL_DIRS`
  在模块加载时现算成 `Map<名, file: URL>`，不参与任何拼接，所以 `%2F..%2F` 只会落到"表里没这个名字"，且这张表**只到 `SKILL.md` 一份**（分层条目的 `references/` 分册不接进来，卡片看原文只看入口册）；
  ③ 超限（`MAX_SKILL_DOC_BYTES`）**整份 413 拒绝、绝不截断**，且 `cache-control: no-store`——快照会随
  上游更新，缓存住就是拿旧原文说"这是原文"。路由经 `ctx.inject(['webServer'], …)` 挂（探测式写法会把
  正确性押在装配顺序上，2026-09-30 桌面端就是这么炸的两颗行）。**不新增 bundle 行**：它挂在已有的
  `capital-config` host 行上，所以「包含的组件」那个数字不变。
- **⛔ 第二格的筛选条与清单不许冒出第二个滚动容器**：筛选条属于页面流，`.capital-config-filters` /
  `.capital-config-selected-list` 只要有一条 `overflow` 非 visible，就会多出一个滚动面，长清单里
  筛选条再也回不到视线；样式表形状闸钉着这一条（连同两行群组名、22px chip、第三格那条负 margin
  的写法）。
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
第一格 **数据源**（五把 Key + 本机直连回退）；第二格 **精选 Skills**——顶部一颗「智能装载 Skills」
开关（默认关），关着时下面才是两行筛选条（Skill 特点 / 适用预设，各带「全部」与"点它会显示几行"）
加清单；打开后筛选条与清单一起收起。点**技能名**打开 `SKILL.md` 原文，名字右边是特点标签与适用预设
标签，已开启的行排在清单最前；第三格 **包含的组件**（带行数）——那一格的内容就是页面下方宿主自己画的
行清单，切过去它才显形（§5.1 / §5.3）。

「包含的组件」里的四行（`capital-config` / `capital-charts` / `capital-watchlist` /
`preset-capital-generation`）本身**没有**行级配置控件——可编辑面只有卡片这一份，不在行详情页里，
这是设计而非故障。`capital-config` 那一行仍在：它是 settings 命名空间的来源（§5.1），只是不再充当座位。
它同时是第三格那个数字的来路（`pluginManager.listBundles()` 里我们这个包的 `rows.length`），
也是 `/capital-skills` 那条原文旁路的宿主（§5.3）。

排查顺序也据此改：① 条目在不在 `settings.describe()`（§5.1 的 volatile 投影，不在就整张卡片读不到）；
② 冒烟里行清单有没有 `capital-config`（`pluginManager.listBundles()`，取数通道）且**行数与第三格那个
数字对不对得上**（数字缺席 = 那次读没成，不是"没有组件"）；③ 浏览器有没有
**刷新**（bundle 在页面加载时确定，宿主重启不换已打开页面的那份）；④ 技能名点开说"原文读不到"就先看
`/capital-skills/<名>.md` 的回包：404 `skill_not_catalogued` = catalog 与快照目录对不上（§8.6 的
`docs:capabilities` 那类漂移），401 = 认证围栏（正常，说明不是匿名可访问），200 但卡片空 = 前端取数
没接上。座位是注册出来的：包名那一路（§5.1 的 `BUNDLE_NAME`）漂了，`configured` 为假 ⇒ 配置段整块不出现，零报错。
