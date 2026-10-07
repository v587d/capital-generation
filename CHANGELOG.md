# Changelog

本文件是 Capital Generation 的完整变更历史（README 只保留最近一版摘要，GitHub Release
说明从这里对应段落复制）。

**版本号口径（本仓实践）**：
- **第三位（patch）**：不破坏既有工具 / 配置 / 会话的新增与修复（如 2.1.1、2.1.2）。
- **第二位（minor）**：有需要用户知晓的行为变更，且段内附迁移说明（如 2.1.0 的图表呈现通道重做、2.2.0 的数据源与检索来源扩容、2.4.0 的**必须换宿主版本**——本插件自己的工具与数据契约没变，所以只抬第二位）。

## [2.6.2] - 2026-10-07

新增一份示例报告（[假期后研判报告](docs/sample/假期后研判报告.md)），README 首页的样例链接指向它；
顺带把安装与升级说明里两处**说不准**的地方改对。**工具入参、数据能力、配置字段与会话日志格式都没变**，
无需迁移，宿主仍要求 `0.2.0-rc.2`。

### Changed

- **README**：首页样例链接换成新报告；桌面端「添加插件」补上直接填 `v587d/capital-generation`
  这一种写法（实测可用）；FAQ 新增「刚发布的新版本装不到」——桌面端取包会**跳过刚发布不久的版本**
  （宿主侧包管理器的发布冷却策略，实测静默降级到上一版），这一条此前被写成了"镜像延迟"，不准确。
- **发版后自动通知 npmmirror 同步**。桌面端经国内镜像取 npm 包，而镜像同步是异步的：2.6.1 那次实测
  镜像恰好在官方源出现新版本**前两秒**完成过一次同步，之后十几小时没再碰这个包。CI 发版成功后 PUT
  一次 sync 端点（owner 的标准动作，无需鉴权，实测约 25 秒生效）；同步失败不判红——官方源已可用，
  镜像晚点追上只是延迟。

## [2.6.1] - 2026-10-06

这一版只动**发版这条路本身**：从"本机手动 `npm publish`"改成"推 tag 由 CI 发"。包内容、工具入参、
数据能力、配置字段与会话日志格式**全都没变**，无需迁移，宿主仍要求 `0.2.0-rc.2`。

### Changed

- **发版走 GitHub Actions。**推 `v<X.Y.Z>` tag 触发构建 + 测试 + 发布。身份用 npm 的 Trusted
  Publishing（OIDC），仓库里不存 npm token：临时 token 七天到期，到期的表现不是"提示要换 token"，
  而是发版当夜红一条谁都发不动的构建。代价是发版主路径搬进了 CI。
- **npm 页面自此带 provenance**，能回答"这个 tarball 是哪次构建产生的"——手动发布答不上这一问，
  而 2.6.0 那次连"发没发成功"都要回头翻日志（registry 回的是 `202 处理中`，不是 `201`）。
- 发版通道带两道 registry **自己不会报错**的闸门：① tag 与 `package.json` 版本不一致时，发出去的
  是旧代码而按 `#vX` 安装的用户拿到的也是旧代码；② 已在 registry 上的版本改为跳过，否则"手动发过
  再跑 CI"和任何一次 rerun 都会撞 `E409`，且红得看不出原因。
- README 的「安装插件」补上 npm 那条路（`dsh plugin --profile web add @v587d/capital-generation`），
  与原有 `github:` 一条并列：前者取已发布版本，后者取仓库当前代码。两条装到的东西一致——构建是
  确定性的，仓库里已提交的 `lib/` 与 CI 现构建的结果逐字节相同（本版实测）。
- `package.json` 补 `repository` / `homepage` / `bugs` 三项（此前全缺：npm 页面不显示仓库链接）。

## [2.6.0] - 2026-10-06

这一版按顺序做了两件互为前提的事：**先解开能力目录与单能力详情的体积**，再把 `data_collector` 从
**69 个 capability 扩到 92 个**（东方财富 5 → 21、腾讯公开 HTTP 3 → 7、Wind 金融数据服务 0 → 3）。
顺序不是审美：69 条那一档目录已占上限的 **90%**、最宽的那条详情 **95%**，再补任何一条都可能
"注册成功却静默看不见"——用户问得到、Agent 答错。新增的 23 条**全部先打真报文再写契约**；Wind 另配
一台真报文仪器（约 24 次 + 第二轮 8 次），线上 server 与设计蓝本不一致的七处一律按报文定形。

**迁移**：只有一处**模型侧**协议形状变了——`list_capabilities` 的回包从 JSON 数组改成一行一条
`capability|summary|paginated` 的纯文本。**工具名、`request_data` / `describe_capability` 的入参、
四把密钥与凭据引用名、Dataset 目录结构、会话日志格式、图表交付通道都没变**；仓内 persona 与 skill
已同步，只有仓外脚本若按 JSON 解析那份目录才需要改读法。已存密钥不必重填，无需换宿主版本，仍要求
`0.2.0-rc.2`。Wind 那三条按次消耗上游积分，没配 `WIND_API_KEY` 时其余 89 条照常。

### Added

- **容量第 0 步：目录改紧凑行编码、详情改字段字典**（`src/data-collector/hub.ts` + `tools.ts`）。
  目录实测 5530 → **2435** 字符（69 条那一档，均摊 80 → 35 字符/条），根因是 JSON 键名与标点占了
  58% 的字节，余量从"再放 7 条"变成"再放 100 条以上"；`describe_capability` 用 `output_fields`
  逐行字典（`路径:类型[:说明]`，`?` 为可空、`[].` 为数组元素字段）替代逐列 JSON Schema，把详情体积
  与列数**解耦**（最大详情 3891 → 2771——45 列的两融与 72 列的可转债第一次注册就会打穿 4096）。
  权威声明仍住 `output_schema`，护栏与宿主返回值校验照旧：字典只是投影，不是第二份真相。分隔符
  `|` 与换行由生产者转义——撞车属于"错了不报错、只是话说错"，模型会把一条能力读成两条。
- **东财宏观九条**（`eastmoney_cpi` / `_ppi` / `_gdp` / `_pmi` / `_money_supply` / `_rmb_loan` /
  `_customs_trade` / `_retail_sales` / `_deposit_reserve`）：补的是当时最大的整块空白（Fuyao 全文
  零命中宏观指标），零新增密钥与依赖、共用既有东财节流客户端，数据深度 2006–2010 年起、最新到
  2026-09。每表先取 200 行统计缺键与 null 分布再写契约：社零 15/200 为 null、存准率公告 30/58 为
  null，一律按可空声明、**null 不补 0**；新增人民币贷款出现 -5896 的负值是事实，描述里明令不得当
  脏数据过滤；海关进出口金额**单位无法定档**（千美元与万元人民币两种解释都能对上公开量级其一），
  所以不承诺单位、禁止换算成元或美元写进结论，要绝对额改走网页检索面的官方材料。
- **沪深港通两条**（`eastmoney_mutual_flow` / `eastmoney_mutual_quota`）：真报文复核推翻了设计文档里
  "沪深港通金额字段全为 null"的记录——停止披露买卖明细的只有**北向**三档，南向四项金额都有值。
  渠道身份不靠记忆：用上游自标的 `MUTUAL_TYPE_NAME` 加同日成交额加法核对（001+003=005、002+004=006
  在 2026-09-30 精确成立）后写成枚举。`mutual_quota` 实测全表只有当日四条、无历史，因此注册成不分页 +
  60 秒新鲜度的快照，并发现**同一列跨方向单位不一致**（北向 52000 = 520 亿元、南向 42000000000 =
  420 亿元），producer 判不了，只能在描述里禁止跨方向比较。
- **东财资金与筹码五条**：`eastmoney_main_capital_snapshot`（补 Fuyao `code=2004` 永久关闭的 A 股
  主力资金，但上游只滚动保留**最近一个交易日**的全市场截面 ⇒ 注册成快照、参数面没有日期，给了就
  `unsupported parameter` 响亮拒绝，描述写死"不要按日期循环请求"，否则模型会把 `9201` 空结果当取数
  失败反复重试）、`eastmoney_dividend_plan`（送转与派息按**每 10 股**口径承诺，标度证据来自上游自己的
  原文 `plan_profile`「10派280.2423元(含税)」配 `PRETAX_BONUS_RMB=280.2423`；原文一并保留可对照）、
  `eastmoney_holder_number_snapshot`（上游只有最新一期 ⇒ 截面能力；`END_DATE` 报告期与
  `HOLD_NOTICE_DATE` 披露日**分列**，实测茅台 2026-06-30 / 2026-08-15）、`eastmoney_margin_trading`
  （取用 42 列，口径由上游自己的加减关系证明：`RZRQYE = RZYE + RQYE`、`RZJME = RZMRE - RZCHE` 等
  实测两只票精确成立；推不出唯一解释的列命名带 `_raw` 且只允许同列比较）、
  `eastmoney_convertible_bond_list`（72 列**实测不含行情**：转债现价 / 正股现价 / 最新转股价 / PBV
  一类 1059/1059 恒 null，转股溢价率恒为占位值 100 ⇒ 只取 29 列发行条款，丢弃的列在描述里点名，
  免得恒 null 被读成取数失败；`BOND_EXPIRE` 是**实际存续年数**不是合同期限）。
- **腾讯港股与美股四条**（`tencent_hk_quote` / `tencent_us_quote` / `tencent_hk_kline` /
  `tencent_us_kline`）：逐列核验后确认**不能复用 A 股那张字段表**——同一列位在不同市场不是同一个
  意思：币种 A 股没有、港股在第 75 位、美股在第 35 位；成交额在港股**指数行**是万元而个股行是元
  （所以指数代码拒收，两种量纲不许进同一列）。三处口径是被样本推翻后才定下来的：换手率分母按苹果
  推是"流通股本"，加进 GOOGL / BRK.B 才发现上游给的是总股本；52 周高低与日线序列对不上就**不收录**，
  指回 K 线自己算；美股写法由上游裁决（快照只认不带后缀、K 线只认带正确后缀，而 `BRK.B` 的点号既是
  级别码又可能是交易所码 ⇒ 两位以上尾段直接剥、单字母先照原样问）。覆盖缺口照 `tencent_ticks` 拒
  北交所的先例写明并在参数层拒绝：港美股无分钟线、不支持日期区间（实测 `start`/`end` 被忽略、照样回
  最近 640 条 ⇒ 直接拒绝而不是静默忽略）、美股不提供 hfq。主机轮换收成一份实现，港美股入口对
  `bad params` **一次即停**——套用"空返回就换机并拉黑 120 秒"会把写错的参数算成机房故障，一次污染
  三个入口。
- **Wind 三条**（`src/sources/wind-mcp.ts`，托管 MCP，**按次消耗上游积分**）：`wind_edb_search`
  （指标找码）、`wind_edb_query`（按日期区间取宏观/行业/汇率序列——**EDB 是本仓唯一来源**）、
  `wind_stock_kline`（日/周/月与 1–30 分钟，A股+港股+美股，每根带成交额、换手与均价）。接入前用
  `scripts/spike-wind.mjs` 打真报文，线上 server 1.25.0 与蓝本 2.0.4 不一致的七处全部按报文定形：
  `rows` 是**标量数组不是行对象**、`columns[].type` 恒写 `string` 因而数值由本仓解析（解析不了就
  响亮失败）、K 线**没有 CLOSE 列**（`MATCH` 就是收盘价）、时间写法一张表三种且每行带自己的交易所
  偏移（整段按 +08:00 处理会把美股错位 12 小时）。参数面逐项有报文：`adjust` 只给 `none`/`qfq`
  （后复权是"以 afdate 为锚向未来放大"，锚取当日时历史逐位等于不复权——**名字骗人**，拒绝）、
  `period` 只放开打过报文的七档（60 分钟两次都挂到超时）、不提供 `count` 与 EDB 的 `observation`
  （给 3 期只回 2 期）、逗号多码直接拒（蓝本写"多个代码用逗号分隔"，线上挂满 60 秒）。超时预算按
  "随时可能挂"而非按健康响应设计：健康回执 0.59–2.3 秒，单次上游取 **12 秒**，病态请求在 Hub 给出
  无信息的 `request timed out` 之前先由数据源给出**带原因**的 `wind_upstream_timeout`。与
  `wind_docs_*` 共用同一份 `wind-client.ts` 与同一把 `WIND_API_KEY`，注册只看结构、Key 留到调用期解析。
- **两台仪器与一份共用实现**：`scripts/spike-wind.mjs`（`--auth` 逐 server 握手、`--list` 取真实工具面，
  两者**不计费**；`--call <server>::<tool> --repeat N` 打印形状、键名、单位、null 计数与重复调用差异；
  不落盘正文、不打印 Key）、`npm run smoke:wind`（走**已注册的 DataSource**，护栏与解析一起复核，默认
  三条各一次）、`scripts/lib/credentials.mjs`（env → credentials 文件的两级解析收成一份，
  `smoke:fuyao` 一并改用——再抄一遍就是重复实现那一族）。

### Changed

- **归属判据先于补录**（`capital-orchestration` / `capital-web-protocol` / `capital-data-protocol`
  三个 skill）：路由表加四问过筛，并写明**终判据是错法**——collector 失败给响亮错误码、retriever 失败
  是"抓到什么算什么"，所以凡要写进用户结论的数字一律委派 `data_collector`；网页检索面新增"要数值序列
  或表格就停手回告"，并把 Wind 积分限定在"免费来源覆盖不了看趋势"那一刻（数据面那三条的路由措辞还没动，
  见「已知未决」）。事后迁移等于重写契约，所以这条排在补录任何新源之前落地。
- **研发约定新增两条**（`docs/dev/tool-schema.md` §10.6 / §10.7）：行键一律 ASCII snake_case
  （机理：全角/半角复现不一致就匹配零行，而 `query_type_conflict` 只拦类型冲突，于是变成静默空结果），
  以及归一化跑两遍 ⇒ **键名不许改、必须幂等**。`AGENTS.md` §10 的指针升到 §10.1–§10.7。
- **`resolve_data_time_range` 的能力表随补录同步**：东财新加的 13 条日期区间（含"区间过滤的是除权日 /
  起息日 / 报告期"这类 warning，宏观九条一律不设区间上限以便翻到 2010 年以前）、Wind 两条
  （`wind_edb_query` 不设上限，`wind_stock_kline` 十年上限 + 分钟档 10 天 warning）。
- **`query_hint` 从 `wind_` 前缀判据改成显式点名能力**：前缀会把"时间写在 question 里"的提示语发给
  带真实日期参数的取数能力，等于邀请模型把日期塞进自然语言。
- **文档同步**：能力总表重新生成（92 条，新增 Wind 分组、"Wind 按次计费"与"Wind 不接哪几类及理由"），
  网页检索能力表补一条边界（本面只有公告与新闻两个 Wind 工具，数值序列在数据能力表）；README 的 Wind
  密钥用途随之改写。

### Fixed

- **⛔ 四条东财能力的单票过滤被本仓自己的第二遍归一化拒掉**（`dividend_plan` / `margin_trading`
  完全不可用，`main_capital_snapshot` / `holder_number_snapshot` 只能取全市场截面）。机理：
  `normalizeParams` 按设计跑**两遍**（Hub 入队前一次，`createSource` 的 execute 内再一次），而这四条
  在归一化里把 `ticker` **改名**成内部叫法 `thscode`，第二遍的 `assertKnown` 只认声明过的 `ticker`，
  护栏于是拒了自己规范化出来的键。修复是就地归一化（键名不动、只换值）并修五处读取点。
  **为什么 766 个测试全绿却漏了**：原来那条幂等回归只手抄两条样例，新能力进不了覆盖，且所有单测都
  直接调 `source.execute`（只跑一遍），没有一条走过 Hub。新增 `test/source-normalize-contract.test.mjs`
  把它做成**结构不变量**：样例覆盖数必须等于注册数（缺能力即失败，不静默少测）、归一化不得发明
  `input_schema` 没声明的键、双跑幂等、并走 Hub 真实入口断言单票 filter 确实到达上游。写它的当场
  就抓出第二处错。
- **字段字典把 enum 字段错标成 `json`**：只有 `enum` 没写 `type` 的字段此前在 `output_fields` 里被标成
  `json`，模型会以为取值开放；现在按取值推断类型并在说明段列出 `取值 a/b`，skill 同步写了这条读法并配回归。
- **真报文仪器自己会被空表打崩**：`rows: []` 时探针直接取 `rows[0]`。缺数与故障是两条分支，
  仪器少一条就等于把"没有数据"读成"上游坏了"。

### 已知未决（本版不改代码）

- **Wind 的港美股分钟线仍未证实**：分钟档每一档都有过真报文，但那些回执都是 **A 股**的代码；港美股
  分钟只在另一条上游工具（`get_stock_quote`）上取到过报文，而本能力走的 `get_stock_kline` 只给出过
  A 股分钟（含一次 653ms 就快回的空表）。`stock_data` 那台在这一轮里连续挂满 60 秒，连前一天正常的
  港股日线也挂。稳定之后用 `npm run smoke:wind -- --minute 00700.HK --date <最近交易日>` 复验。
- **积分成本仍不可见**：门户没读到余额与单次消耗，`request_data` 也没有计费概念。现在只有两条硬约束
  兜着——计费类错误一律不自动重试、同一请求在缓存新鲜度内复用已落盘的 Dataset（宏观 6 小时、K 线
  1 分钟）；用量本身无人可读。数据面"免费来源优先"的路由措辞属下一轮（见下条）。
- `issusp`（停牌行是否出现）、周/月根的标签日口径、长区间 Dataset 在 profile 那一侧的表现，都按
  "未验不注册"留在真报文之后；`capital-data-protocol` 里 Wind 的路由措辞与来源标注属下一轮。
- 东财与腾讯的覆盖缺口按**参数层拒绝**处理（港股指数代码、美股 hfq、港美股分钟线），不是运行时兜底；
  照 `tencent_ticks` 拒北交所的先例，拒绝比静默降级诚实。

**验证**：`npm test` 788/788（含 19 条 Wind 真报文回归、新的归一化契约表与发版闸门）、
`npm run check:dsh` 25/25、`npm run smoke:boot` 真起进程挂载无 broken。扩容之后两道体积闸门实测：
目录 **3434 / 6144 字符（56%）**，这一道回到了有余量的档位；单能力详情最大 **3738 / 4096（91%）**
——可转债那张（72 列里只取 29 列），仍贴着上限，下一张更宽的表要么先按 §10.6 收敛列数、要么把说明写短。

## [2.5.4] - 2026-10-05

这一版只动**设置卡片的落点与说法**：填密钥从"点三下"变成"点一下"（卡片搬到插件主页自己的「配置」段），
五条提示重写、"官方文档"贴到每个密钥名右侧，插件在「插件」页终于有了一个中文名字。**工具入参、数据能力、
配置字段的 schema 与凭据引用名（`FUYAO_API_KEY` 那四个）、会话日志格式都没变**——已存的密钥不必重填，
历史会话照常读。无需迁移，宿主仍要求 `0.2.0-rc.2`。

### Changed

- **⛔ 设置卡片的座位从行级搬到组合包级。**原先要「插件」→ 本包 →「包含的组件」里点 `capital-config`
  那一行才看到表单（三跳），"设置藏得太深"是这一版收到的主要反馈。现在卡片坐在
  `plugins.bundle.config`（key = 组合包名），打开插件主页就在描述与「包含的组件」之间。**`capital-config`
  那一行没有删**：它仍是 settings 命名空间的来源（条目 id 四处同字那条链不变），只是不再充当座位。
  判据一句话：每深一跳就多一次"设置里没这个插件"。
- **卡片话术与排布**：① 「官方文档」不再是提示里的一句话，而是贴在密钥名右侧的链接（新标签页打开、
  带右上角斜箭头图标），四条提示因此各省一行；② 去掉「必填 / 选填」——这四个密钥**现在全都是选填**，
  缺哪个只是对应能力不可用，其他照常；③ 五条提示统一收成"… 保存后新 Capital 模式会话生效"（原先写
  "新会话"，用户会去开一个普通会话，然后发现没生效）；④ 本机直连与 PaddleOCR 两段说明重写，只说
  开启之后会发生什么；⑤ 回退开关移到四个密钥之后——它不是密钥，夹在密钥行中间会被读成第五个 Key。
- **插件在「插件」页有了中文名字**：卡片与详情页主标题从 `@v587d/capital-generation` 变成
  「Capital Generation（证券研究）」（英文界面是 "Capital Generation"）。DSH 读显示名只有一个入口——
  `<裸包名>/locale/<语言>.json` 里的 `meta.title`，所以根包补了 `locale/{en,zh}.json` 与
  `exports["./locale/*.json"]`（`icon` 早就在生效，只是以前没人给它名字）。
- README 的指路措辞随之改：**列表卡片只显示标题，不再显示 npm 包名**（详情页仍以小灰字给出包名）。

### Fixed

- **`npm run check:dsh` 把"探针没返回结果"当成通过**：异步探针漏了 `return`、或返回了错形状时，过滤器只看
  `status === 'fail'`，于是那条接口等于没探——账本要防的正是这种"看起来很全、实际没人探"。现在没有合法
  `status` 一律判失败并点名（同一族：谎报绿灯的体检脚本，见 2.5.2）。

### 已知未决（本版不改代码）

- 「包含的组件」那三行仍显示 `file:///…` 安装路径。这不是漏配：行级显示名走的是**同一个** `readPluginMeta`，
  但它要求行名是**裸包名**，而 patch 装载时会把 `./` 开头的行名就地改写成 `file://` URL，宿主再也拿不到包名。
  要变好看只有把三颗嵌套目录发成真包——`file:` 依赖在 pnpm 下会**直接装不上**（实测
  `ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND`，tarball 与 git 两种安装形态都失败），而且即使标题变好，页面仍会把
  路径以小灰字列出来。方向是提给上游：让 `readPluginMeta` 对 path-like 行名先回落到最近的 package.json
  （`dsh-client-modules` 里已有 `nearestPackage`）。判据与实测都记在接口账本的 L25。

## [2.5.3] - 2026-10-01

这一版只动**自选股**：先把清单上限从 10 条抬到 30 条（10 条对真实自选盘不够用），再把发版前那轮整体
review 里"错了不报错、只是话说错"的十二处一并收口。**模型工具表、数据能力、设置卡片、会话日志格式
都没变**；自选股那几个本机路由只多不少——超限的回包现在多带一个 `limit`，报价快照里"没有涨跌"这一档
从假的 `0.00` 变成诚实的"没有"。无需迁移，宿主仍要求 `0.2.0-rc.2`。

### Changed

- **自选股上限 10 → 30 条。**满了照旧拒绝添加，但那句提示里的数字改由服务端给（面板不再中英文各抄
  一份"10"，抬上限不会只改红一边）。首次打开仍播种 4 条主要指数，因此实际可加 26 条。
- **报价刷新提速。**同花顺不接受逗号多值的场内基金，只能逐只问；上限抬到 30 之后改成 4 路并发，
  并把一次刷新的总预算改成随清单条数走（10 条这一档与上一版完全同时长，30 条封顶 90 秒）。预算用完
  时还没被问到的那些行如实标"刷新超时"，不冒充"这个标的没有报价"。
- **「预测」「复盘」两枚按钮图标化，并移进「操作」那一列。**原先是两枚铺满整格的描边方块（"太宽、
  显得笨、且挤"），现在与「更多」同栏成簇，字面只留在鼠标悬停提示与读屏标签里。图标换成语义更近的
  两支：靶心（那句话要的是未来走势与关键点位）、带笔的清单（对着已发生的行情写一遍）。
- **表头「操作」居右**，报价列与动作区之间留口固定，整行不再一边挤一边空。
- **英文界面的类型徽标不再画中文**（原先股票 / 指数 / ETF 三档写死中文字样，绕过了双语口径）。

### Fixed

- **⛔ 停牌 / 未开盘的标的一次刷新就被写成「+0.00%」。**上游用 `null` 表示"这个数没有"，旧版把它兜成
  0，于是刷新用假的零顶掉了上一次真实的涨跌、页脚照报"刷新于此刻"、还不记任何失败。现在画破折号并
  降到陈旧那一档的灰，配一句"暂无涨跌数据"。
- **⛔ 关掉面板再打开，第一屏是「确定将上一轮那只票移除吗？」。**移除的确认层原先住在组件内部，而座位
  是常驻的（关闭不卸载），于是它跨开合活了下来，顺手一按就删掉这次根本没打算动的标的。状态搬进面板
  自己的存储，开新面板一并归零。
- **⛔ 刚添加的标的停在「未刷新」，页脚却显示刚刚刷过。**那次刷新被折叠进了为**上一批**标的出的在途
  请求，回包里没有新行。现在落地后核对"没报价、也没记失败"就补发一次真刷新；只在用户添加这一下动作里
  发生，不轮询、不自动重试。
- **⛔ 拼音还没上屏就说「没有匹配的标的」，换个词还能点到上一个票。**合成期与"还在查"这两档各有自己
  的说法（「输入完成后自动搜索」「搜索中…」），"没有匹配的标的"只在当前这个词真有一次空回包之后才
  出现；改词立刻撤走上一个词的候选，晚到的回包也丢掉。另有输入法会丢掉上屏事件，现在按输入事件自带的
  合成标记复位，搜索不会再被永久闩死。
- **⛔ 整批失败时写着「其他标的仍是上一次成功快照」。**全批一起失败（上游整体挂掉就是这样）时没有
  "其他"，那句会把"这份数据整体不可信"说成"只有几行有问题"。现在只在确实还有没被波及的行时才说。
- **⛔ 添加已经成功，面板却说"没加成"。**清单读回来失败原先被算进"添加失败"那句黄字，用户照着再点
  一次就是把同一只票往满了的清单上再撞一次。读失败与刷新失败各回自己的位置。
- **⛔ 多窗口 / 并发点击能把清单写成 31 条，或把刚删掉的行写回来。**改清单的动作改成串一条进程内队列，
  判上限与写库落在同一段锁里；刷新的写回逐条重读当前清单再写，只覆盖报价那一格。跨进程（两个宿主
  进程）仍是最坏情形"后写的整份覆盖前写的"，这一版声明的是进程内边界，不是多窗口安全。
- **上游标的名里的零宽与方向控制字符现在会被剥掉**，面板、悬停提示与递进输入框那句话读到的同一个名字
  ——这类字符肉眼看不见，却能让"你核对过的那句"和"实际发出去的那句"顺序不同。
- **认证围栏接线有了回归**：`/capital-watchlist/*` 必须把宿主的请求拒绝面接上，否则它是本机任意进程
  可读写的无认证端点；这条从此由测试钉在真实注册路径上，而不只是代码里写着。

## [2.5.2] - 2026-09-30

桌面端复测通过后，这一版做三件事：给"看不见的失效"装眼睛、修掉一个谎报平安的体检脚本、清掉名单里
两颗当前宿主根本不存在的名字。**工具入参、数据能力、设置卡片、会话日志格式都没变**；`dc_status`
的回执**多**一格 `root_tool_policy`（纯新增，读不到它的消费者不受影响）。无需迁移，宿主仍要求
`0.2.0-rc.2`。

### Added

- **根 Agent 工具收敛的现场记录**：`dc_status` 现在带 `root_tool_policy`，逐条给出
  `preset_id / outcome / denied / failed`。装它的起因是桌面端那次实测：探针报 17 颗 `restrict()`
  都没抛错，而真发给模型的工具表里那 17 颗**一颗不少**——三条可能出口（registry 读不到 /
  `composedPreset` 判错 / 逐名抛错被 catch 跳过）当时**一条痕迹都不留**，而桌面端不落盘
  `ctx.logger`，所以唯一的 warn 等于没有。这已经是同一族第二次踩（上一次是同花顺注册失败只留一行
  warn）。记录只留最近 8 条、只记根 Agent（子 Agent 是绝大多数 `agent/created` 的来源，会把唯一
  有意义的那行挤掉）；判定仍旧只有一份，读数是诊断口径。**回执里有没有这个字段本身也是装机判据**。

### Fixed

- **⛔ `npm run verify:sessions` 在 v4 宿主上绿着空转**：它把会话文件名硬编码成
  `session.v3.jsonl.zstd`，而 `0.2.0-rc.2` 写的是 v4 ⇒ 本机 store 里 384 份 v3 + 47 份 v4，它
  **一份今天的会话都没读到**，输出却是"检查 0 份会话 … ✅ 全部可冷加载"。这类坏法的特点是不报错：
  宿主格式换代那天起，这道核对就不再核对任何东西。现在按 `session.v<N>` 挑版本号最大那份
  （`scripts/lib/session-files.mjs`），**扫到 0 份直接 exit 2 并明说"闸门没有核对任何东西"**，
  另补 4 条按真实文件名建目录的回归（v3-only / v4-only / 两代并存 / 只有锁文件 / 0 字节）。
  本机复跑：现在读到今天真实的 7 份会话。

### Changed

- `web_search` / `web_fetch` 从 `ROOT_AGENT_DENIED_TOOLS` 清掉：双端实测（Linux 根会话 22 颗、
  桌面端 40 颗的工具表）里都没有这两个名字，`restrict()` 对它们只会抛错被跳过。留着不伤人，代价是
  每次现场记录都固定多两条 `failed`——而 `failed` 正是用来分辨"真有名字 deny 不动"的，长期挂噪音
  等于自己把信号磨钝。**宿主若把它们挂进根作用域就该加回**，加的地方是逐名 restrict，**不是** preset
  的 `toolFilter`（那里写未注册名字的表现是"创建子 Agent 失败"）。
- **一条已知未决，本版不改代码**：同一行 `restrict()` 在 Linux / Web 生效（实测那 17 颗在根会话
  工具表里 0 可见），在 Windows 桌面端**不抛错却整条空转**。它没有 scope 参数、靠 `scopeOf(this.ctx)`
  决定落点，桌面端（Electron 打包的 `dsh-desktop-host`）解析到的层与根 Agent 的链路不同。本仓
  **按宿主产品形态差异对待，不写平台特判**；在此之前桌面端的主 Agent 仍可能自己动手跑 shell / 出图 /
  检索（取数那一侧因为拒绝发生在工具层 `delegatedSession`，照常兜得住）。真要收口，方向是改走
  `tools.guard()`（按 `exec.agent` 取链路，与实例绑哪层无关）。

## [2.5.1] - 2026-09-30

桌面端（Windows 携带的 DSH `0.2.0-rc.2`）实机跑出来的**两处装配失效**，都只在真实宿主里发作：
一条是因为测试的假 ctx 认证了**错的 cordis 规则**，一条是因为假凭据服务永远"立刻就有值"。
**本版已在桌面端实机复测通过**（2026-09-30）：插件页四行全部运行、自选股增删与报价刷新正常、
子 Agent 取到同花顺数据。自此 README 的 `desktop` 徽章是有实测背书的，不再是"随宿主同源"的推定。
工具入参、数据能力契约、设置卡片、会话日志格式**都没变**；旧会话与磁盘上的已有数据**无需迁移**。
唯一对外可见的收窄：`dc_status` 回执少了 `registration_error` 一格（没有任何消费方读它，它本身
就是这次误导的来源，详见下面第二条）。

### Fixed

- **⛔ 插件页里 `capital-charts` 与 `capital-watchlist` 两行 异常**：`cannot get property "webServer" without inject`。
  两行原先写的是"先 `ctx.get('webServer')` 探测，有值就直接调用"。`ctx.get` 能解析出值**不代表**属性访问
  合法——cordis 的属性代理只认"本层声明过 `inject`"（`ReflectService` 找不到就抛这句）。桌面端的 webServer
  在本行之前已就绪，于是走"直接调用"那条并当场炸；web profile 里它还没就绪，反而躲过了。两行现在一律
  `ctx.inject(['webServer'], registerRoute)`：已就绪立刻挂路由，还没出现就一直等（本行保持激活），
  两种装配顺序都对。回归把假 ctx 换成**会按真实规则抛错**的那一份（`test/cordis-fake.mjs`），并给
  `capital-watchlist` 的 `apply()` 补上此前完全缺席的两条顺序断言——这条能漏过 699 个用例，缺的就是覆盖面。
- **⛔ 同花顺 61 颗能力在桌面端整场进程静默缺席**：注册那颗 effect 原先以"装配期读到 `FUYAO_API_KEY`"为
  准入门槛，读不到就 `return`——**不重试、不补注册**，于是能力目录只剩 8 颗。宿主凭据 provider 在
  `[Service.init]` 里**先 yield 把服务发布出去、之后才 `await loadInitial()` 装载快照**（实测
  `dsh-credentials-local/lib/index.js:441-446`），所以装配期那一次 `resolve()` 返回 `undefined`
  **且不抛错**；桌面端启动忙，两轮都输了这个竞态，Linux 只是每次都赢。同一条链路上走**调用期**解析的
  自选股在同一进程里照样取到了 fuyao 行情——这个反差正是它没被立刻发现的原因。现在注册只看结构，
  key 判定留在每次取数（`createFuyaoRestSources` 本来就带 `resolveApiKey`）：缺 key 的表现从"能力凭空消失、
  错误只说未注册的能力"换成"取数那一刻点名 `FUYAO_API_KEY` 失败"，凭据装载完同一进程自愈，README
  那句「卡片里粘贴保存即可，**无需重启**」到这一步才真的成立。**顺带否掉一个直觉修法**：给 `inject`
  加 `credentials` 治不了这个病——`inject` 等的是服务发布，而服务那一刻已经发布了，缺的是文件内容。
- **`dc_status` 不再自相矛盾**：同一份回执里能同时出现 `api_key.present=true / source=file` 与
  `registration_error=未配置`，把人直接引向"是不是我 key 配错了"（上一轮排查就是这么被带偏的）。
  注册与凭据时刻解耦之后这条字段没有意义，连同两处给模型看的文案一起收掉
  （`capability_catalog_empty` 错误正文、`capital-data-protocol` 的错误处置表现在都说明**缺凭据不会让目录变空**）。

## [2.5.0] - 2026-09-30

本版**跟随 DSH `0.2.0-rc.2`**（Windows 桌面端携带的就是这一版），补齐自选股每行的操作，并把
跨平台（Windows + Linux）的第一层验收做实。**对停在 0.1.7 的用户是破坏性的**：本版只在
`0.2.0-rc.2` 上验过，请先升宿主。工具入参、数据能力、图表呈现、会话日志格式与设置卡片**都没变**。

### Added

- **每行「更多」菜单**（置顶 / 移除）改用官方 `Menu` primitive 且 `portal: true`。三种坏法都**不抛错、
  只用起来不对**：就地渲染会被清单的 `overflow` 容器裁掉（最后几行点开什么都看不见）；Escape 不在
  capture 阶段截住，按 Esc 关掉的是**整个面板**（官方 Modal 的层栈监听只看 `defaultPrevented`）；
  `portal` 层级掉到模态之下，菜单画在遮罩里——看得见影子、点不着。这三条钉成接口账本 **L23** 与
  `check-dsh` 探针（`z-index` 做数值比较，不只断"存在"）。
- **置顶**：持久化里只多一格**可选**的 `pinned_at`。写成必填会让磁盘上已有的记录在加载边界被判
  `invalid-record`（读一次就 `store_unavailable`）；顺序由 `rowsOf` **读**出来而不写回键序（官方单文件
  后端是 Map，`put` 已有键保留原位置，靠删了重插改顺序会把整份 JSON 重写 N 遍）。因此**无需迁移、
  也不抬 domain version**。

### Fixed

- **⛔ Windows 上那道 shell 闸门是死代码**：`bashGuardReason()` 原先只认 `'bash'`，而 preset 里 shell
  是**平台成对**挂载的两行（Linux `bash` / Windows `pwsh`）⇒ 在 Windows 上「只对被委派的子会话开放」与
  「拦掉必然批不了的沙箱升级」两层判定**一次都不触发，且不报错**。根侧 deny 本来就点名了 `pwsh`，
  所以主 Agent 那条还活着，漏的是子会话侧。现在 shell 名字只有一份定义（`SHELL_TOOL_NAMES`），deny 与
  guard 同源；两条拒绝文案改成「shell 工具（bash / pwsh）」——两端都会读到这两句，只写一个名字会让
  另一端的模型以为另一个工具没被管。回归按"逐入口对等断言"补：每条判定对两个名字各跑一遍，另有一条
  断言「preset 挂的每一行 shell，deny 与 guard 都必须认」。
- **打包闸门失败时说不清原因**：Windows 上 `npm` 是 `.cmd` 垫片，`spawnSync('npm')` → ENOENT 而
  `stderr` 是空的，原断言只插值 `stderr`，于是失败被报成一句没有原因的话（`'npm.cmd'` 则是 EINVAL，
  `shell: true` 配 args 是 DEP0190 弃用形态）。改成用当前进程的 node 直接跑 `npm-cli.js` 与 dsh 的
  `lib/bin.js`，定位逻辑只在 `scripts/lib/run-tool.mjs` 一份（npm 的两种真实布局都覆盖：官方安装包住在
  node 旁边，发行版把 `/usr/bin/npm` 链到 `/usr/lib/node_modules`），并把 `result.error` 写进断言。
- **persona 字段名核对在 Windows 上从来没生效**：`.split(':')` 拆 PATH 会把
  `C:\Program Files;C:\Windows` 拆成 `['C','\Program Files;C','\Windows']` ⇒ 永远找不到类型声明 ⇒
  静默降级成"跳过核对"。改用 `node:path` 的 `delimiter`，连平台分支都不必写。
- **`URL.pathname` 被当文件路径用**：Windows 上它是 `/D:/…`（多一个前导斜杠），拿去读文件全落空，
  2 条用例红；对齐仓库里其余用例的 `fileURLToPath`。

### Changed / 0.2.0-rc.2 的验证方式

- 抬基线前先在**临时目录**装一份同号 dsh，用 `DSH_PACKAGE_DIR` 指着它跑，不碰本机全局安装：
  `check:dsh` **23 条全部通过**（并反证过给错路径会成片"读不到"，不是静默回落）；`smoke:boot` 用它
  **真起了一个进程**——预设 `broken=null`，`persona` / 两条 subagent 行 / `capital-generation` 四行
  `state=2`，三颗客户端 bundle 都在，`/capital-watchlist/list` 围栏匿名 401、带 cookie 200，重复声明
  预设的反向对照命中。`dsh-persona` 的类型里 `prefix` / `suffix` / `complete` /
  `includeRuntimeContext` 都还在。
- devDep `@deepseek-ai/dsh-system-prompt` 跟到 `^0.2.0-rc.2`：semver 对 `0.x` 的规则让 `^0.1.2-rc.1`
  **跨不到** `0.2.0`，留着旧声明等于在一个用户机器上不存在的 system prompt 版本上做类型解析。
  `@deepseek-ai/cordis` 顺带解析到 `4.0.4`，与桌面端携带的同字。
- **观察到的 0.2.0 行为差**（只此一条）：boot 探针的 stdout 比"已监听"晚到，`smoke-boot` 因此先打一句
  「（探针未打印）」才收到探针行。判据读的是累积 output，结论不受影响。
- **跨平台验收口径**（写在这里，因为它决定以后怎么算"过"）：两端测试**条数必须相同**、不许用平台分支
  跳断言；平台分支只允许出现在 shell 可执行名、子进程启动方式与 PATH 分隔符三处。检出层换行符归一
  （`.gitattributes` + renormalize）与静态闸门排在下一批，因为它们会改到以 CRLF 入库的 blob、需要两端
  各自重新检出。

### 迁移

**先把宿主升到 `0.2.0-rc.2`** 再装本版：

```bash
npm i -g @deepseek-ai/dsh@0.2.0-rc.2
```

Windows 桌面端携带的就是这一版，**但本版的桌面端装配路径还在验收中**（清单见
`docs/design/windows-desktop-acceptance.md`，那一层此前零覆盖）——这里不声称"Windows 产品形态已跑通"。
插件侧无工具改名、无入参变化、无新增密钥；自选股旧记录不用动（`pinned_at` 缺省即未置顶）。

## [2.4.1] - 2026-09-29

**新增用户自选股**（宿主级清单 + 输入框 `/` 菜单弹窗），并补上两处会让主 Agent「提前下结论」与
「看不清」的洞。无破坏性变更：工具入参、数据能力、设置卡片与会话日志格式都没变，**不新增密钥**。

### Added

- **自选股面板（`capital-watchlist/`，第三颗 host 平面行）**：一个用户侧资产，不是 Agent 能力。
  入口是输入框 `/`（与 `+` 同一份菜单）「指令」小节的 `自选股` 一行，**只在 Capital 会话出现**
  （`available(session)` 读 `projectionValues.agentPreset`；极简 / 标准模式下这些会话常驻的 overlay
  组件必须 mount 零请求、关闭即 `return null`）。点开是官方 `Modal` 样式的面板：搜索、添加、删除、
  打开即刷新、手动「刷新报价」。
- **清单跨 workspace**：走官方 `dsh-storage-domain`，域名 `capital_watchlist`，落盘
  `~/.dsh/storages/capital_watchlist.json`——不在任何 workspace 目录内，在 A 目录加的票换到 B 目录
  的新会话仍然看得到。⚠️ 上游 unit name 规则 `^[a-z][a-z0-9_]*$` **拒连字符**，所以路由叫
  `/capital-watchlist`、域却叫 `capital_watchlist`，这不是风格问题。
- **默认不空面板**：域首次创建时播种 4 条主要沪深指数（上证 / 深证成指 / 创业板指 / 沪深300，
  均已用真报文验证有值）；用户删空后**不重建**。清单上限 **10** 条，超出回 `list_full`
  并提示「先删一条再加」——这个上限同时也是 ETF 逐只扇出的规模约束。
- **搜索**：Fuyao `ticker_search`，标的范围锁 `a-share` / `a-share-index` / `fund-etf`
  （场外基金与北交所不进候选），候选最多 10 条、不分页（倒逼缩小输入）。输 `300750` 与输
  `宁德时代` 都能命中并显示 `300750.SZ 宁德时代`；多命中时列候选由用户选。
- **报价按 `asset_type` 分三端点**：A 股与指数走批量快照（`thscodes` 一次带走），ETF 逐只扇出
  （≤10 个请求，串行且有界）；快照带 `captured_at`。键值与 `data_collector` 同一把
  `FUYAO_API_KEY`，不新增密钥。
- **出网只由用户动作触发**：打开面板一次批量刷新（清单为空则只读本地、**零出网**）、点「刷新报价」、
  选中候选添加（同一动作里 `/add` → `/list` → `/refresh`，新行当场有价、不停在「未刷新」）。
  **无轮询、无自动重试**——全组件唯一的定时器是搜索防抖；同一时刻只允许一个 in-flight 刷新，
  期间按钮禁用。搜索那一路另有三条事件闸（尾部防抖 / IME 合成期不发 / 同词不重发）+ 单条在途。
- **删除用面板内确认**，不用 `window.confirm`（原生弹窗在宿主样式体系之外）。
- **浏览器只与 loopback 宿主路由对话**：`/capital-watchlist/*` 接官方
  `connection.requestRejection`（trusted-Host 403 + 签名 cookie 401）；**Fuyao 密钥永不进浏览器**，
  key 解析、信封判定与错误映射全在宿主半边。
- **模型侧零变化**：不新增任何工具（**没有** `read_watchlist`），persona / skill / 能力目录一字不改
  ——自选股是用户资产，Agent 既读不到也写不动。
- **`src/sources/fuyao-core.ts`**：把上面那套 key 解析 / 信封 / 错误映射从 `fuyao-rest` 抽成零 import
  的叶子内核，宿主半边 `import '../lib/sources/fuyao-core.js'` 用**同一份**实现（本仓首例跨包相对
  导入，因此配了一支**模块同一性探针**——真出现第二份就失败，AGENTS.md §9.7）。
- **插件图标** `assets/cg-icon.png`（`package.json` 的 `icon`），生成脚本
  `scripts/pad-png-icon.mjs`（纯 `zlib`，把源图补成方形 PNG，不引图像库）。

### Fixed

- **主 Agent 会在子 Agent 尚未结算时给出结论**：`capital-orchestration` §6 新增「结算对账表」——
  想写最终结论前先逐行列出本回合委派过的每个子 Agent 的 `✓/✗`，判据只有一条：**✗ 只能被结算通知
  翻正**。子 Agent 的 `send_message` 回传正文无论写得多像完成（「7/7 profile 完成」「pending = 0」）
  都不构成 ✓，那是工单不是生命周期事件；有任意一行 ✗ 就只写等待行。配套把 collector 的
  `dataset_ready` 明确成**进度**：到一份就登记并转发给同一个 `data_junior`（先限定「只到 profile」），
  收到 `data_collection_completed` 才算取数结束。
- **行情快照类 Dataset 可被无限期复用**：`SchemaDescriptor` 新增宿主内部字段 `cacheMaxAgeMs`，
  9 个时效能力（`quote` / `valuation` / `auction` / `index_quote` / `fund_quote` / `tencent_quote` /
  `tencent_kline` / 东财板块行情与资金流）声明 **60s** 上限，超龄的复用会重新取数；非时效类不声明，
  仍只受 Dataset 保留期约束。
- **浅色模式看不清**：面板此前按深色一套颜色写死（`label-dimmed` 在白卡上只有 1.26:1；
  `bg-layer-1/2/3` 在浅色**同为纯白**，控件因此毫无反差），现全部改走 `--dsw-alias-*` 角色 token，
  反差用 `bg-module-platform`、警示文字用 `state-warn-label`。红涨绿跌只能用**一档字面值**
  （`#d1493f` / `#17a063`）——宿主从不逐元素声明 `color-scheme`，`light-dark()` 在这里不可用。
- **搜索备选下拉「透视出底下的自选股清单」**（深浅两色都有）：官方半透明菜单材质
  `--dsw-specific-menu`（浅 `#f8f9fa94` = 58%、深 `#43454a73` = 45%，只有 macOS 才近不透明）
  **必须**与 `backdrop-filter: var(--dsw-menu-backdrop-filter)` **成对**声明，上一版只取了填充没取
  模糊。补齐配对，并给下拉节点挂 `data-menu-material="translucent"`（官方 `MenuSurface` 的挂法）
  让宿主把深色那档描边翻成 `border-l3`——不自写主题选择器。闸门同时拆成两条分开的钉（模糊只许下拉
  那一处、模态**遮罩**必须没有模糊），并登记成账本 **L22** + 探针：这类断裂的症状是"下拉读不出"
  且不报错，正是探针该拦的静默退化。

### Changed

- **`/` 菜单行去掉尾部英文别名**：`添加 / 查看 / 删除自选股`（原行尾还挂着一个 `watchlist`）。
  别名当初是给过滤面用的（菜单过滤是 `label` / `detail` 的大小写不敏感 substring，**命令名不参与**），
  但 typed 路径走的是另一条面——`matchEnter` 把 bare token 直接查进贡献表，与过滤面无关，所以
  `/watchlist`↵ 照开、不受改名影响。这条支撑已并进 **L18** 探针：上游哪天把 Enter 改成"先过过滤面
  再落命令"，别名就会重新变成必需项，症状是 `/watchlist`↵ 静默退化成发了一句普通消息。
- **README**：新增「📌 自选股（用户级清单）」小节（两张实机截图）与「🧭 多 Agent 编排（截图）」小节
  （官方「任务管理」树状图，补齐此前委派层级只有文字描述的缺口）；话术精简。
- **`.gitignore` 封死 `*.jsonl`**：会话日志曾误入库，现已摘出并拦住。

### 迁移

从 2.4.0 升级**无迁移**：无工具改名、无入参变化、无新增密钥。唯一的安装动作是多了一颗 host 平面行，
装完需**重启 DSH web profile** 才装配生效；自选股入口与设置卡片（`capital-config`）仍在老位置。

## [2.4.0] - 2026-09-26

本版是**跟随 DSH `0.1.7-rc.2` 的适配版**（[issue #3](https://github.com/v587d/capital-generation/issues/3)）。
**破坏性**：本插件需要 **DSH ≥ 0.1.7**——装在 0.1.5 上会 `web boot: 1 entry did not activate`。
工具入参、数据能力、图表呈现与会话日志格式**都没有变化**。

### ⚠️ 破坏性变更：上游删了两条通道，我们跟着搬家

| | 2.3.0（DSH 0.1.5-rc.2） | 2.4.0（DSH 0.1.7-rc.2） |
|---|---|---|
| 设置卡片 | `settings.register` 命名空间 + 客户端 `settingsScope.bind` + `settings.plugin.item` keyed 槽，坐在「设置 → 插件 → 插件配置 → Capital 模式」 | 条目 Config 里标 `.volatile()` 的字段由 DSH 自动投影成表单，**命名空间恒等于 profile 条目 id**；卡片坐在**「插件」页**该 bundle 的 `capital-config` 行详情里 |
| 预设挂载 | registry 行 `config.roots` 指向 preset 目录 | 一颗 `@deepseek-ai/dsh-agent-preset` **声明行**（`config = { id, name, description, order, plugins }`）；registry 既不扫目录也不接受 `roots` |
| 保存后何时生效 | 重启 profile | 新开的 Capital 会话即生效（`applies` 恒为 `live`，主插件在装配时读一次） |

升级前若直接装本版到 0.1.5 上，症状是两条：`dsh web` 打开即失败
（`@v587d/capital-config: pending (waiting for service: settingsScope)`），以及历史 Capital 会话恢复报
`RemoteError: Unknown agent preset: capital-generation`。

### Changed

- **设置卡片整条链路按 0.1.7 契约重写**：改用官方表单件 `SettingsForm` / `SettingsFormModel` /
  `SettingsSecretField` / `Switch`，服务面是 `ctx.configForms` 的 `get(条目 id)` + `whileServed(...)`。
  四个密钥字段（Fuyao / AnySearch / Wind Alice / PaddleOCR）与「允许启动本地提取网页内容」开关
  **语义不变**；密钥仍只进 credentials 域，配置里只存引用名，值从不随响应出网。
  0.1.7 的 primitives 删掉了外链图标 ⇒ 「接口文档」链接改为纯文字。
- **预设迁到声明行**：`preset/capital-generation/` 的装配从 `preset.yml` + `agent.cordis.yml`
  合成一颗 `@deepseek-ai/dsh-agent-preset` 声明行 `agent.patch.yml`（`plugins` 就是原来的行数组）。
- **运行期依赖**：`@deepseek-ai/schemastery` 抬到 `^3.18.4`（`.volatile()` 的最低版本）；
  `capital-config` 的 `dsh.client.inject` 从 `dsh-client-ui-settings-plugins` 换到
  `dsh-client-ui-plugin-manager`（插件页现在归它所有）。

### Fixed

- **历史 Capital 会话恢复**：`capital-generation` 这个预设现在真的注册得上（旧写法在 0.1.7 下
  静默不注册，只有打开历史会话才暴露）。
- **可视化 gate 覆盖主 Agent 的「停在 profile」**：委派 prompt 写明「只到 profile」时，
  `data_junior` 仍给 `recommended` 结论但**不出图**，并把未出图标注为**委派收窄**（不是数据不支持、
  也不是被拦）；想常规出图就别写这句。两侧规则由 `test/persona.test.mjs` 钉住。

### Added

- **扩展面账本**：新增 **L17**（预设声明面：`PresetDefinition` / `composedPreset` / registry 无
  `roots`）；**L15** 探针按新契约重写；**L10** 探针退休（该槽 kind 由 `chain` 变 `list`，本仓
  早已不消费，留着只会制造假失败）；**L12** 证据文件从 `dsh-agent-presets` 换到 `dsh-tool-subagent`。
  `npm run check:dsh` 16 → **17 条**。
- **`npm run smoke:boot` 扩成两条腿**：正向在真实 boot graph 里挂一颗一次性探针行，读运行期的
  `agentPresets.resolve('capital-generation').broken`、`settings.describe()` 的条目镜像，以及
  `pluginManager.listBundles()` 里该 bundle **有没有 `capital-config` 那一行**（卡片座位）；
  反向另起一个 profile **重复声明**同一预设 id，确认这道闸门会失败而不是永远绿。

### 迁移

- 先升级 DSH 到 `0.1.7-rc.2`（或更高），再 `dsh plugin --profile web add github:v587d/capital-generation`
  并重启 profile。留在 0.1.5 的话请继续用 2.3.0。
- **API Key 不用重填**：值本来就存在 credentials 域（`~/.dsh/.credentials.yaml`），升级后卡片
  直接显示「已配置密钥」。
- **偏好要重设一次**：旧命名空间下的值随上游一起退休了（那份全局 settings 文件已被 0.1.7 改名为
  `settings.yaml.imported`，不再被读取），所以若曾**关掉**过「允许启动本地提取网页内容」，升级后
  会回到默认（开启），需要在新卡片里再关一次。

## [2.3.0] - 2026-09-26

**web_retriever 新增第三类工作面「文档解析」（`ocr` 工具，13 → 14 个工具）**：

- **无破坏性变更**：没有工具改名、没有入参变化，既有调用方式全部不变；唯一要用户知晓的是
  `ocr` 需要**新申请一个可选密钥**（PaddleOCR AIStudio Token，免费额度）——不填则只有 `ocr`
  响亮报错（`NO_CREDENTIAL`，指明卡片位置），其余能力不受影响。
- 研报正文不再是死路：`eastmoney_reports` 条目现在直接给出 `pdf_url` 直链，交 `ocr` 即可拿到正文。

### Added

- **`ocr` 工具（PDF / 图片 → markdown，`src/ocr/`）**：上游是 PaddleOCR AIStudio 的异步 job API，
  一个工具四种形态——`url`（公网 `.pdf` 直链，本机不抓文件、由上游取）/ `file`（session workspace
  内的本地 pdf 或图片，`@mention` 推进来的文档直接可解析）/ `job_id` + `doc_id`（续查未跑完的作业，
  **不重复提交、不重复计费**）/ `doc_id` + `pages` \| `query`（纯本地读已落盘正文，零出网）。
  ⚠️ 作业**整篇一次算完**（上游口径最多 100 页、按整篇计费），`pages` 只影响读、不影响算价。
- **产物一律落盘** `capital-data/ocr/<doc_id>/{document.md,meta.json}`：`doc_id` 内容寻址，
  同一份文档重复调用直接回读缓存、不再出网（`refresh: true` 才强制重跑）；回执只给
  `workspace://` 的 opaque `artifact_ref` 与页索引（每页字符数与首个标题），超输出预算时
  靠 `pages`（一次最多 8 页）或 `query`（关键词定位）取回正文，整页进整页出。
- **长任务不占死会话**：工具声明 `timeoutMs: 240000`，客户端自有等待预算 200s（可在设置里
  `retriever.paddleOcr.pollBudgetMs` 覆盖）；预算耗尽**不是失败**，回 `status: 'pending'` 带
  `job_id` / `doc_id`，照 `hint` 再调一次续查即可。
- **`PADDLE_OCR_TOKEN` 密钥**：设置卡片新增第四字段「PaddleOCR 文档解析 Token」（中英文案齐备），
  或直接写进 `~/.dsh/.credentials.yaml`；每次调用现解（credentials 优先、环境变量同名回退，与
  Wind 同口径），密钥永不出现在回执 / 日志 / 错误串。`ocr` **无条件注册**、**不受**
  「允许启动本地提取网页内容」开关支配（那个开关管的是 HTML 本机回退）。
- **`eastmoney_reports` 条目新增 `pdf_url` 与 `attach_pages`**：正文入口由列表工具直接给出，
  派生只认 `^AP\d{6,}$` 形状（认不出就不给字段），模型不需要也不应该自己拼链接。
- **主 Agent 可解析本地文档**：`ocr` 是根侧工具收敛的唯一例外——不进 deny 名单，改由调用级
  guard（`installRootOcrGuard`）只拒它的 `url` 形态；用户 `@xxx.pdf` 推进工作目录的文档主 Agent
  可直接解析，外部 PDF 链接仍必须委派 `web_retriever`。通用 `subagent` 连本地形态一起 deny。
- **网络面同步扩容（仍只有一份实现）**：`HttpRequest.body` 支持 `FormData`（multipart 上传）、
  `maxBytes` / `maxContentChars` 可逐请求覆盖（OCR 结果 JSONL 不挤网页正文的 512 KB 额度）、
  4xx/5xx 响应体摘录进错误信息（上游 `{"code":10004,"msg":"文件格式不支持"}` 这类缘由模型
  才可能据此换路）、新增 `assertPublicUrlTarget`（`url` 形态复用同一份公网 IP 闸门，本机不做
  "把内网 URL 交给第三方去戳"的通道）、store 新增 `readWorkspaceBytes`（超上限响亮失败，
  不返回截断结果）。

### Changed

- **`web_retriever` persona 与 `capital-web-protocol` skill**：工具清单 13 → 14，新增第 8 节
  「文档解析纪律」（何时动 `ocr`、四形态一次只走一种、`pending` 续查不重传 `url`、`pages` 不省钱、
  引用必须写 `doc_id` 与页号、**不得把 PDF 链接当"已读到正文"的证据**、重跑不是独立验证——实测
  同一份 PDF 两次给出过 18% 与 19% 的不同数字）。
- **「研报正文取不到」这条硬边界移除**：`eastmoney_reports` / `sina_reports` 的条目说明改为
  「把 `pdf_url` 原样交 `ocr`」；`web_retriever_fetch` 拿到 PDF 仍是能力边界不是故障，改道 `ocr`。
- **主 Agent persona**：「外部检索只经 web_retriever 回传」补上唯一例外——工作目录里的本地
  PDF / 图片可直接 `ocr` 解析，外部链接仍走委派。
- **markdown 归一化在工具侧做**：上游表格带约 60% 的单元格 `style='…'` 排版样板（实测 15 页
  研报），归一为 markdown 管道表后降到约四分之一；引擎侧未经验证的 flag（`mergeTables` /
  `prettifyMarkdown`）一律不传——上游对未知键是静默忽略，不给"看起来能配"的假象。

## [2.2.0] - 2026-09-24

**2.1.2 以来最大的一次能力扩容，有一处工具改名需迁移**：

- **改名**：`web_retriever_search` → **`anysearch_search`**（按 provider 命名，与 `wind_docs_*` 同口径）。
  任何自定义 prompt、外部脚本或审计脚本里出现 `web_retriever_search` 的地方改读 `anysearch_search`；
  工具**能力**与入参完全一致，只是名字变了。`web_retriever_fetch` **不改名**——它是一条
  AnySearch→本机直连的**回退链**，回执里的 `via` 标明实际来源，按传输命名会与该字段自相矛盾。
  既有 `wind_docs_announcements` / `wind_docs_news`、以及 `request_data` / `list_capabilities` /
  `describe_capability` 等数据面工具的名字与入参均不变，其余升级无需改调用方式。
- **扩容**：`data_collector` **61 → 69 个 capability**（新增腾讯 3 个 + 东财 5 个，全部公开端点、
  **无需新增密钥**）；`web_retriever` 新增**九个具名来源查询工具**（此前只有 anysearch 与 wind_docs
  两个 provider、4 个检索工具）；东财请求收敛到**一个进程级共享客户端**，数据面与 web 面共用同一个
  节流器。

### Added

- **`data_collector` 新增八个 capability（61 → 69）**（`src/sources/tencent-http.ts`、
  `src/sources/eastmoney-http.ts`；均走公开端点、零密钥，注册进同一个 `DataCollectorHub`，与 Fuyao
  能力共用 `list_capabilities` → `describe_capability` → `request_data` 的两步发现与落盘链路）：
  - **腾讯公开 HTTP 三个（行情 fallback）**：`tencent_quote`（实时行情、估值、涨跌停和 ETF 快照）、
    `tencent_kline`（日/周/月复权与 1~60 分钟 K 线）、`tencent_ticks`（最近交易日分笔成交明细）。
  - **东方财富 HTTP 五个（资金与筹码）**：`eastmoney_top_buy_sell_market`（全市场龙虎榜汇总）、
    `eastmoney_top_buy_sell_ticker`（单票龙虎榜汇总）、`eastmoney_lockup_expiry`（限售解禁日历）、
    `eastmoney_sector_rotation`（板块行情排名快照）、`eastmoney_cashflow_rotation`（板块资金流快照）。
  - **时间契约同步**：`tencent_kline`（`start`/`end` 仅日/周/月，分钟线只能取最近 `count` 根）与三个
    东财日期区间能力进 `DATA_TIME_CONTRACTS`，`resolve_data_time_range` 可直接产出这些能力的入参；
    `capital-data-protocol` skill 同步提示腾讯 fallback 的能力名（`tencent_quote` / `tencent_kline`，
    不要改写成已有 `quote` / `history`）。
  - **能力总表重新生成**：`npm run docs:capabilities` 从 Fuyao / Tencent / Eastmoney 三份 source
    定义生成 `docs/data-collector-capabilities.md`，测试断言「文档 == 实现」；能力目录体积仍留在
    DSH 剪枝阈值（8192）以内。
- **`web_retriever` 九个具名来源查询工具**（`src/web-retriever/sources.ts`，provider + feature 命名，
  全部公开端点、零 key）：`cls_telegraph`（财联社 7×24 快讯，`sign = md5(sha1(排序 query 串))`
  本地计算）、`wscn_lives`（华尔街见闻快讯，`channel` + `cursor` 翻页）、`eastmoney_724`
  （东财 7×24 快讯，与前两条互为备份）、`cninfo_irm`（巨潮互动易问答，深市，两步 POST）、
  `sseinfo_qa`（上证e互动问答，沪市，公司列表二分定位 uid）、`eastmoney_stock_news`（个股新闻）、
  `eastmoney_reports`（个股研报列表，含评级与逐篇预测 EPS）、`sina_reports`（研报第二来源，
  不含评级与目标价）、`ths_eps_forecast`（同花顺机构一致预期 EPS，逐年给出机构数 / 最小 /
  **均值** / 最大 / 行业平均）。它们与 `search` / `fetch` 是**两个不同工作面**：后者是检索
  （发现候选、按 URL 取正文），前者是**查询**（具名来源 + 业务参数 → 确定、有序、可翻页、同参可复现
  的结果集）。回执带 `provider` / `operation` / `count` / `next_cursor` / `note`，并计入
  `provider_tally`（按来源分别计数），"同一 provider 5 次内收敛"的经验法则因此自动覆盖到新来源。
- **东财共享网络面**（`src/net/eastmoney-client.ts` + `src/net/throttle.ts`）：进程级单例 + 串行最小
  间隔（350ms ≈ 2.9 次/秒）。数据面（Hub 的 `eastmoney_*` 能力）与 web_retriever 侧**共用同一个
  节流器**，不各建 HTTP 出口——东财按**出口 IP** 风控（社区实测 >5 次/秒、1 分钟 ≥200 次、
  5 分钟 ≥300 次即临时封禁），两套独立限流等于没有限流。
  ⚠️ `DataCollectorHub` 的 FIFO 只保证"同一时刻一个请求"，**不含最小间隔**：串行 ≠ 节流。
- **`createHttpRequester`**（`src/web-retriever/local-fetch.ts`）：出口校验（URL 合法性 + DNS 公网
  IP 闸门 + 重定向重校验 + 大小/超时上限 + 取消语义）抽出为共用实现，`createLocalFetcher` 与九个
  来源工具走同一条路径，不新增第二份网络实现；**不引** `ctx.web` / `dsh-tool-web`。
- **`HttpRequest.encoding`**（`local-fetch.ts`）：允许来源实现声明正文编码（同花顺一致预期页是 GBK
  而响应头不带 charset），**不暴露给模型**。

### Changed

- **`web_retriever_search` → `anysearch_search`**（46 处引用、11 个文件同步：工具注册、persona、
  skill、`resolve_data_time_range` 的能力表、测试与设计文档）。
- **`web_retriever` persona 与 `capital-web-protocol` skill**：来源边界表扩到两个 provider +
  九个具名来源工具，新增「来源查询纪律」（该翻页就翻到没有、空结果是真事实、深沪不可互换、
  `status` 是事实不是缺口、`note` 必读、单条正文约 1200 字符上限与截断提示、失败码含义）；
  persona 保持瘦身，工具清单与细则进 skill。
- **`data_junior` 的 `# BASH DISCIPLINE` 补回软约束**：写明 bash 只做纯计算兜底（不是取数通道）、
  不联网、不读文件、不碰 `capital-data` 路径、时间窗仍优先 `resolve_data_time_range`。
- **分层判据（写进注释与文档，供后续维护者）**：数据面按**可复用性**切——数值/分页端点走 Hub
  （Dataset 复用是收益），流式文本来源走 web_retriever（Dataset 复用是语义错误）；
  **网络面只有一份**。判据不是 provider。

### Fixed

- **本机直连不再改写 JSON 正文**：此前所有正文一律交给 markdown 转换器，导致数组括号变
  `\[ ... \]`（`JSON.parse` 不再成立）、字段名 `content_text` 变 `content\_text`（按字段名读取
  不可靠）、`<script>` 内容被当标签删除（数据丢失）。现在 JSON 按**正文**判定并原文直通
  （不再只看响应头），HTML 仍照旧转 markdown。
- **接受 `json/javascript` 等 script 类 MIME**：严格按 `application/json` 判定会把正常返回 JSON 的
  接口（如上证e互动的公司列表）误判成 `UNSUPPORTED_CONTENT_TYPE`。
- **上证e互动公司列表按 `<a>` 元素解析**：窗口式正则（`uid=…[\s\S]{0,N}?…png`）在真实页面上会
  跨条目错配（实测把 `600369` 配成上一条的 `uid=65`）——"能跑但错"的映射比报错危险得多。
- **上证e互动时间支持三类写法**：`2026年09月24日 09:30` / `昨天 18:16` / `2分钟前`、`1小时前`。
  只认绝对写法会让"最新提问"列表**整次失败**（真机冒烟实测）。
- **uid 缓存层次**：不再把扫描到的整页代码灌进 uid 缓存（那会在一次解析内塞满容量并淘汰掉正在解析
  的代码，症状是"单次成功、再查同码却 NOT_FOUND"）。
- **九个来源工具的调用方取消原样抛出**（`ABORTED`），不降级成 `ok:false` 失败信封。
- **东财研报的预测 EPS 恒为 null**：上游该字段是**字符串**（`'1.0700000000'`），按 `typeof === 'number'`
  判定会静默当成缺失。现在按值转换（`toFloat`），并补 `eps_next_year`。
- **新浪研报的日期与类型两列写反**：按页面表头实测为「序号 / 标题 / 报告类型 / 发布日期 / 机构 /
  研究员」，此前产出 `date:"公司"` / `type:"2026-09-01"`——每列都有值却整行错位。
- **新浪研报的个股查询缺交易所前缀**：实测 `688017` 纯 6 位返回**假空页**（HTTP 200 且与"没有研报"
  同形），必须 `sh688017`。北交所新号段 `920xxx` 必须先于 `9 → sh` 判定，否则会被发到上交所。
  （参考实践把空页归因于"限流、必须间隔 6 秒"；本仓实测间隔 0 连续 4 次全部成功，真实原因是缺前缀。）
- **`eastmoney_stock_news` 区分风控与真无新闻**：上游对部分 IP 间歇风控时只返回 `passportWeb` 而无
  `cmsArticleWebOld`，按**键是否存在**判定并报错，不再静默返回空表。
- **同花顺一致预期页是 GBK 而响应头不带 charset**：按 UTF-8 解会产生 11,800 个替换字符、中文与正则
  全部失效；现由来源实现显式声明 `gbk`。同时表定位改为认表头（中英兼容），不再依赖固定位置。
- **东财请求的 UA**：共享客户端统一带浏览器特征 UA（上游对空 UA / 无浏览器特征有风控）。

## [2.1.2] - 2026-09-23

非破坏性新增：`data_junior` 多了一个默认入口 `describe_dataset`；`time_facts` 增字段、
`resolve_data_time_range` 增一种形态（原形态行为不变）、`query_dataset` 的 filter 多接受一种日期写法。
从 2.1.1 升级无需迁移：既有调用方式全部照旧，只有两处结果比以前更"紧"——日期串配
`>` / `<` / `!=` / `in` 由静默跳过改为报错，`columns_of_interest` 现在也收窄 `time_facts`
的首末值（详见 Fixed）。

### Added

- **`describe_dataset`：读一份 Dataset 的默认入口**（`src/data-collector/describe.ts`）。一次调用完成
  inspect（元数据与 `query_access.shape`）+ profile（四类事实、写入 `profile_ref`）+ 可选的受控 `queries`，
  取代默认流程里的 `inspect_dataset → profile_dataset → query_dataset` 三步往返（三步保留给单点复核）。
  一次只处理一个 `dataset_id`，多份数据在同一条 assistant 消息里一次发完即可并发执行、结果一起返回；
  document 型由宿主跳过 `queries` 并在 `warnings` 说明；结果超过 7000 码点不再返回超长载荷，改回
  `{status:"too_large", profile_ref, columns, hint}`，让调用方按 `columns_of_interest` 收窄后重发一次
  （**看到 `too_large` 不是失败**，它带着完整列名）。
- **时间轴：日历由宿主换算**（`src/data-collector/time-axis.ts`）。`time_facts` 现在除覆盖范围
  与首末行外，还给出 `covered_from_iso` / `covered_to_iso`、`axis`（`value_format` / `time_zone` /
  `utc_offset` / `aligned_to`，按**该列自身观测到的**偏移推断）与 `windows[]`（近 1 月 / 近 3 月 /
  近 1 年 / 年初至今的 `value_ge` / `value_le` 与 `data_from` / `data_to`）。
- **`query_dataset` 的 filter 直接接受日历写法**：`YYYY-MM-DD` / `YYYY-MM` / `YYYY` /
  `{ "period": "last_1_month" }`，宿主按该列偏移归一；结果自动补 `*_iso` 可读时间列。
  相对期省略锚点时以该 Dataset 最后一天为准。
- **`resolve_data_time_range` 新增 Dataset 形态**：传 `dataset_id`（可选 `time_column`）+ `period`
  时，按该 Dataset 的时间轴输出 `bounds` / `range` / `data` / `dataset`，边界可直接填进
  `query_dataset` 的 filter。传 `capability + period` 的原形态行为不变。

### Changed

- **`data_junior` 的 persona 与两份 skill 改以新入口为准**：读 Dataset 默认 `describe_dataset`
  （多份在同一条消息里并发，`columns_of_interest` 是收窄结果体积的唯一手段），
  `inspect_dataset` / `profile_dataset` / `query_dataset` 降为单点复核；同时给可视化协议补两条硬规则——
  `chart_source_ref` 一张图一个 token（15 分钟 TTL，不为同一 Dataset 重签），spec 由
  `visualization_specialist` 组装、`data_junior` 只交"要什么视图"，协议排除的视图记为 limitation
  而不是改方案重签。

### Fixed

- **`describe_dataset` 内嵌 queries 的时间筛选与 `query_dataset` 行为不一致（2026-09-23，真机会话 `66fa9666`）**：
  日期串归一最初只接在 `query_dataset` 上，内嵌 queries 直连引擎，于是同一回合里模型看到两种行为——
  `query_dataset` 的 `">=": "2026-09"` 正确按区间筛，而内嵌的 `">=": "2026"` 被引擎当**数字 2026** 比较
  （243 行全中、`days_2026: 243` 静默错数）、`">=": "2026-07"` 被 `skip_with_warning` 整条跳过（0 行）。
  归一实现已收敛到 `src/data-collector/query-time.ts`，两个入口共用；内嵌结果同样补 `*_iso` 可读时间列。
- **`resolve_data_time_range` 的 Dataset 形态对任何调用方都报 "requires an authorized session"（同一起事故）**：
  该形态把 session 读成 `exec.session`，而框架一直放在 `exec.agent.session`。现在 session 读取收敛到
  `src/tool-exec.ts` 一份实现（`dataset-tools.ts` 与 `time/tools.ts` 共用，且**不提供** `exec.session` 兜底）；
  Dataset 形态同时按 Dataset 系列工具的边界收敛为"只对**被委派**的子 Agent 开放"，主 Agent 仍可用取数形态。
- **`columns_of_interest` 现在也收窄 `time_facts` 的首末值投影**：此前它只影响
  `statistics`/`categories`/`schema`，而 `first`/`last` 仍带每个数值列（7 列日线 = 每个投影 7 个键），
  与参数在描述里的承诺不符。时间列永远保留（首末值的时间坐标）；实测收窄到 2 列时由 7/7 键变为 3/3 键。
- **`resolve_data_time_range` 的 capability 形态每次调用都失败（2026-09-23，真机会话 `cf464cb6`）**：
  `mode` 此前被列入工具 `output.schema` 的 `required`，却只在 Dataset 形态返回它 —— 宿主的
  `createSuccessResult` 会按 `output.schema` 校验返回值，于是 capability 形态稳定抛
  `ToolOutputError: returned invalid output: missing required property "value.mode"`。
  `data_collector` 与 `web_retriever` 都受影响，模型把同一条调用重试 3 次后卡死。
  现在两种形态都返回 `mode` / `format` / `timezone` / `warnings` 这四个共有字段（Dataset 形态另带
  非交易日提示），`required` 只列它们。
- **`period` 被序列化成 JSON 字符串时解析不了**：`'{"unit":"year","count":2}'` 掉进
  `unsupported period`（两个子 Agent 各自白跑一轮）。现在字符串化的 `{unit,count}` 与对象形态等价；
  Dataset 形态也不再丢掉对象形态的 period（此前会静默退化成"全部历史"）。
- **日期串落到数值时间列不再静默放行**：旧行为下 `skip_with_warning` 会把这条 filter 整条跳过
  （`filter X skipped incompatible value`），于是"筛选消失、返回全量"却看起来成功。
  现在 `>` / `<` / `!=` / `in` 配日期串一律 `query_type_conflict`，并说明改用 `>=` / `<=`。
- **`last_N_week` 的空窗口**：`shiftDate` 的 `amount * 7` 与调用方的 `count - 1` 叠加，
  使 `last_1_week` 退化成 0 天。现在周就是 7 天，"含锚点当天"只减一次。
- 秒级 epoch 或混合类型的时间列不再被误判成"日粒度毫秒"（`MIN_EPOCH_MS` 量级闸门）；
  时间轴探针只读前 500 行；窗口覆盖不到任何行时报错并回显数据覆盖范围。

## [2.1.1] - 2026-09-22

非破坏性版本：只增不改，从 2.1.0 升级无需迁移。

### Added

- **设置卡片**：设置 → 插件 → 插件配置 → Capital 模式，可视化配置 `FUYAO_API_KEY` /
  `ANYSEARCH_API_KEY` / `WIND_API_KEY`（等价于手写 `~/.dsh/.credentials.yaml`，两种方式并存）。
  同一卡片新增 **「允许启动本地提取网页内容」** 开关（`retriever.localFetch.enabled`，默认开启）。
- **AnySearch fetch 失败自动回退本机直连**：开关开启时，AnySearch `fetch` 失败（超时、
  上游错误、正文清洗失败等）会自动改由本机 HTTP 直连抓取该页面，HTML 经 turndown 转为
  GFM Markdown；回执 `via` 字段标注正文来源（`anysearch` | `local-http`），可审计。
  回退带 SSRF 门控，仅处理公开可访问的文本页面（HTML/文本/JSON/XML）；PDF、二进制与
  需登录页面不回退，仍原样失败。开关关闭时行为与 2.1.0 完全一致。
- AnySearch 失败按结构化错误码归类（`AUTH` / `RATE_LIMIT` / `TIMEOUT` / `UPSTREAM` 等），
  错误信封携带上游语义而非笼统失败。
- 新增 `npm run smoke:local-fetch`：本地 fixture 与真实网络双通道验证回退链路。

### Changed

- 本机直连默认 User-Agent 由裸版本号改为产品标识 `@v587d/capital-generation`
  （裸版本号是 WAF 眼里的典型爬虫特征）；显式配置的 UA 不受影响。

## [2.1.0] - 2026-09-20

本版是**图表呈现通道的定点重做**：修掉「打开历史会话失败」的根因，并把图表交付
交回 DSH 官方机制。**没有工具/接口层面的破坏性变更**，但呈现行为与 2.0.0 不同。

### ⚠️ 行为变更：图表不再内嵌在答复里

| | 2.0.0 | 2.1.0 |
|---|---|---|
| 呈现位置 | 主 Agent 答复里**直接内嵌的图表** | 收尾的**「本轮文件改动 / 交付」行** |
| 查看方式 | 页面内直接渲染 | 点开该行的 `chart.html`，右侧面板渲染可交互图表 |
| 承载机制 | 自定义会话事件 `capital/chart-rendered` + 客户端内嵌渲染 | 官方 `deliverables/presented` + 官方文档预览 |

降级路径不变：`chart.html` 自包含（内联图表库与数据），可离线打开、零外部请求。

### 🐞 修复：升级到 dsh 0.1.5-rc.2 后，出过图的会话 100% 打不开

根因（实测，非版本回归）：会话日志的事件词汇表是**闭集**，读取侧
`validateStoredEvents()` fail-closed——自定义事件 `capital/chart-rendered` 写入时静默
通过、冷加载时整份会话被拒（`unknown to this harness`）。rc.1 与 rc.2 的会话持久化包
逐字节相同，只是升级必然重启，把一直存在的隐患暴露出来。

修复：不再发明事件类型，图表呈现改用官方 first-party 通道 `deliverables/presented`，
并连带修掉交付链路上的一串缺陷（发布器进程级单例、待登记队列按会话归档、交付行在
`agent/turn-stopping` 冲刷等），交付通道首次真正跑通。

**已知残留**：带旧自定义事件的历史会话在新版本下**仍然打不开**（上游无 ignorable
逃生口，无法回填迁移）；新版本起产生的会话不受影响。

## [2.0.0] - 2026-09-17

### Added

- `visualization_specialist` 图表管线：`data_junior` 可视化 gate 按需创建 one-shot
  子 Agent，经 `render_chart` 生成自包含 HTML 图表（内联 Lightweight Charts v5.2.1），
  序列数据经旁路路由直达渲染、不进模型上下文；含抗上游漂移账本。

## 1.x（`v1-final`，2026-09-14）

早期版本，无独立变更记录，见 [Git 历史](https://github.com/v587d/capital-generation/commits/master)。
