# 第三方组件与许可（Third-Party Notices）

本文件集中列出 Capital Generation 随包分发、随包调用、或只在构建期使用的第三方组件：项目名、作者、
许可证、原始仓库，以及它在本插件里的位置。本文件随 npm 包一起发布；各组件的许可全文以仓库内文件为准
（下表"许可文本"列给出位置）。**这份清单不是手抄的**：仓库回归测试会把这里点名的仓内路径拿去问一次
真实打包器（写了却没发出去就红），也会按 catalog 现算核对首页的 Skill 总数，所以它与装出去的包同步。

## 随包分发的代码与内容

| 组件 | 作者 | 许可证 | 原始仓库 | 许可文本 | 可选 Skill / 快照内共 | 用在哪里 |
|---|---|---|---|---|---|---|
| Lightweight Charts™ 5.2.1（standalone 构建） | TradingView | Apache-2.0 | <https://github.com/tradingview/lightweight-charts> | `lib/chart/vendor/LICENSE` | — | 插件内所有可交互图表的渲染层；`VERSION.json` 记有该构建的 sha256，归属标识（attribution logo）保持开启，出图产物页脚打印版本与许可。同一份副本又被 tree-shake 链接进图表卡片的客户端 bundle，那份里不再单独带许可文件——以 vendor 目录这份为准 |
| Investment Skills Lexicon（`7235d34`，固定快照；路由段改写为纯 Markdown 映射） | finterm.ai | MIT | <https://github.com/finterm-ai/investment-skills> | `selected-skills/investment-skills/LICENSE` | 1 / 1 | 「精选 Skills」中的 `buffett-investment-framework` |
| China Stock Research Skills（`d49f1f3`，固定快照；共享的 source-registry 取数阶梯改写为证据类型口径） | spikeHongg | MIT | <https://github.com/spikeHongg/china-stock-research-skills> | `selected-skills/china-stock-research-skills/LICENSE` | 6 / 6 | 「精选 Skills」中的六颗 A 股研究 Skill：`financial-health`、`risk-warning-catalysts`、`valuation-investment-strategy`、`strategy-business-transition`、`industry-competition-moat`、`business-decomposition-order-quality`；上游的 orchestrator 不收录，已从本仓删除 |
| InvestSkill（`c3f2a17`，固定快照；补 `name` 字段 + 28 颗的取数口径改写，分析正文未改） | yennanliu | MIT | <https://github.com/yennanliu/InvestSkill> | `selected-skills/InvestSkill/LICENSE` | 28 / 28 | 「精选 Skills」中的 28 个美股 Skill（`fact-check`、`bear-case`、`10k-digest`、`stock-valuation`、`risk-stress-test`、`tax-lens` 等）；另六颗（编排、报告输出口、自带出图、三颗 alias 残片）不收录，已从本仓删除 |
| Peter Lynch Research（`e0eaf58`，固定快照；套一层 skills 目录 + 取数口径改写，方法论、预算与输出模板未改） | Szymon Nycz（仓库账号 `DjNero11`） | MIT | <https://github.com/DjNero11/peter-lynch-skill> | `selected-skills/peter-lynch-skill/LICENSE` | 1 / 1 | 「精选 Skills」中的 `peter-lynch-skill`（个股快筛与尽调工作流，美股与境外上市口径） |
| Trading Skills（`f1ae7d4`，固定快照；平铺掉上游的主题分组 + 取数与计算口径改写，判定档位、阈值与分析结论未改） | marian2js | MIT | <https://github.com/marian2js/trading-skills> | `selected-skills/trading-skills/LICENSE` | 13 / 13 | 「精选 Skills」中的 13 颗交易过程 Skill（`catalyst-map`、`watchlist-review`、`evidence-gap-check`、`thesis-validation`、`risk-reward-sanity-check`、`execution-plan-check`、`portfolio-concentration`、`journal-pattern-analyzer`、`post-trade-review`、`position-sizing`、`position-management`、`macro-event-analysis`、`market-regime-analysis`）；券商执行面那颗与其余不收录项已从本仓删除 |
| Claude for Financial Services CN（`d7585ca`，固定快照；改写 12 颗正文的取数层与出图口径，判定档位、报告骨架与分析结论未改） | jwangkun（`LICENSE` 的署名行还带着没去掉的方括号，六份 plugin manifest 另署 `Anthropic FSI China`；上游自称基于 Anthropic 官方仓库适配 A 股） | **Apache-2.0** | <https://github.com/jwangkun/claude-for-financial-services-cn> | `selected-skills/claude-for-financial-services-cn/LICENSE` | 12 / 12 | 「精选 Skills」中的 12 颗 A 股卖方研究 Skill（`china-earnings-analysis`、`china-earnings-preview`、`china-comps-analysis`、`china-dcf`、`china-sector-overview`、`china-catalyst-calendar`、`china-break-trace`、`china-variance-commentary`、`china-initiating-coverage`、`china-morning-note`、`china-thesis-tracker`、`china-idea-generation`）；正文本身就是取数目录的那颗、元技能与 alias 残片、按美股税制写的税损收割那颗、以及要求产出或读取工作簿与 deck 的十一颗都不收录，已从本仓删除；四份可运行的取数服务端连本仓都不进 |
| FinanceSkills（`b0c6239`，固定快照；改写 8 颗正文里"自己跑脚本 / 用代码算"那 16 段与一句点名宿主检索工具的护栏，公式、阈值与分析结论未改） | Ayotunde Oso（仓库账号 `GAJETOso`；`LICENSE` 版权行、`marketplace.json` 的 publisher 与上游 `AGENTS.md` 另署 **KOMVIA**） | MIT | <https://github.com/GAJETOso/financeskills> | `selected-skills/financeskills/LICENSE` | 8 / 8 | 「精选 Skills」中的 8 颗估值建模与偿债 / 行业专用财务 Skill（`wacc-computation`、`company-valuation`、`three-statement-modeling`、`credit-analysis`、`ecl-computation`、`banking-compliance`、`insurance-reserving`、`forensic-accounting`）；其余 40 颗按**领域外**排除（编制视角的会计作业、内部审计与内控、个人理财与美国 / 英国税制、加密资产、私有公司语境），已从本仓删除；上游自带的 43 份 python 计算脚本移到 `selected-skills/reference-algorithms/`（git-only，不随包、不执行），评测夹具与 MCP 服务端 / Stripe / Plaid 等账户连接器连本仓都不进 |

| Quant Agent Skills（`03677d2`，固定快照；上游三颗自述的编排器不收录，只有两份跨市场选线口径按原文随包） | Jerry Wang（仓库账号 `Howard-Jerry`；上游 README 声明正文来自其个人量化系统，数据层尚未开源） | MIT | <https://github.com/Howard-Jerry/quant-agent-skills> | `selected-skills/quant-agent-skills/LICENSE` | 1 / 1 | 「精选 Skills」中的 `cross-market-listing-choice`（跨市场选线：A/H 与 ADR/HK）。**这颗的入口正文由本仓撰写**——上游那三颗都会接管会话路由并指挥公开版根本不附带的私有脚本，一颗都不能开放；随包的上游原文只有两份 overlay 口径文件（与所钉 commit 逐字节相同，核对方式与该快照的 `UPSTREAM.md` 里）；上游三颗与它的工程材料已从本仓删除 |

八份快照合计 **70 个可选 Skill**，也是仓内与包内仅有的 Skill 正文：上游快照原有 177 颗，其余 107 颗不收录、
已从本仓删除，差额与逐颗理由记在各自的 `UPSTREAM.md` 里。
首页「精选 Skills」那句里的两个数字与此同源，由回归测试按 catalog 现算钉住。
它们的收录方式、上游 commit、维护状态与逐颗排除理由记在各自的 `UPSTREAM.md` 里，并且**默认全部关闭**，
只在使用者于配置页显式开启后才对新建的 Capital 会话可见。
上游自带的编排、报告与出图 skill 不收录，已从本仓删除：前者与本插件既有的角色路由冲突，
后两者与已删除的报告交付链路、以及"出图只走 `render_chart`"的约定冲突。
第七份（FinanceSkills）排除的 40 颗走的是**另一条线**：不是执行面，也不是路由冲突，而是**领域外**——
上游自述服务对象是会计与企业财务人员，正文的角色是总账会计、集团报告会计、内控经理、FP&A 经理与
个人理财顾问，把账做对；本插件的使用者读别人披露的账。加密资产那颗（`crypto-accounting`）与本插件
不涉及的资产类别有关，个人理财与美国 / 英国税制那六颗与本插件的服务范围无关，两者都按这一条排除，
逐族理由记在该快照的 `UPSTREAM.md` 里。
Trading Skills 另外排除了几类：券商 API 执行面（在对话里采集凭据、真实下单）连本仓都不进；
接管会话路由的编排 Skill、把取数写死成"向用户点选付费服务商再自己调接口"的那几颗也不收录，
本插件没有那些服务商的凭据，密钥只进凭据域。给出仓位数字与持仓加减动作的几颗**收录**：本插件不收的是执行面，
不是正文里的结论形状——它们只算出数字、给出建议，动手那一侧永远是使用者。
`macro-event-analysis` 与 `market-regime-analysis` 原本不收录，2026-10 收敛为"只留 catalog"时先删掉
服务商接口页与取数段，再作为方法收录：它们的正文是事件传导与市场结构，不是取数配方。
第六颗排除得更多，因为它的取数层是**全量**的：63 份正文每一份都自带一节三档服务商阶梯
（含密钥申请去处与一个用环境变量决定"用哪家"的开关）、一段看起来能跑的伪调用，以及把服务商名写死的引用格式。
其中 `china-market-data` 整颗就是那份服务商工具目录，收录它等于在本插件既有的取数协议之外再造一条取数路由；
四份配套的服务端脚本（万得 / 同花顺 / AkShare / 新闻）与本插件不发布券商执行面是同一条线，连本仓都不进。
第八颗（Quant Agent Skills）排除的理由与前面每一颗都不一样：**不是措辞问题，是它指挥的东西根本不在仓里。**
上游三颗自述为编排器（接管会话路由、并行派生 5–6 个子代理再裁决），实测三颗入口点名的本地路径
10 / 32 / 16 个，公开版**一个都不存在**——作者自己写明数据层要到 v1.1 才开源。这类正文发给使用者，
得到的只是"教 Agent 去撞一条跑不通的指令"。所以我们从这颗只取两份口径文件（跨市场选线那两条 overlay，
正文只含纯文本代码块、零私有路径、零跨文件引用），收录那颗的入口流程由本仓自己写。
这也是本仓**第一次在外部快照里放一份自持正文**，许可口径因此要说清：MIT 只要求随包保留版权与许可声明，
不要求"被改过的文件带显著声明"（上面 Apache 那一份多出来的那条义务在这颗不适用），
而上游那两份原文我们一个字都没改，逐字节一致的核对方式记在该快照的 `UPSTREAM.md` 里。

**五处对上游正文的改写都是合规改写，不是编辑**：上游 skill 写给"什么工具都在手边"的宿主——前三份成规模地要求
分析角色自己去 `web search` 取实时行情，其中两份还留着"取不到就凭印象估一个"的逃生口；第五份一次 `web search`
都没写，但伸手取数换了形态：`curl` 付费服务商的接口、认领对话里给过的 API 凭据，以及"能跑代码的宿主就去用共享
python 模块"；第六颗（本颗）把形态摊成全量：每份正文自带一节按付费程度排开的数据服务商阶梯、一个决定"这次用哪家"
的环境变量开关、一段看起来能跑的取数伪调用，并把服务商名写死在引用格式里。本插件的取数只有一个入口
（交给负责取数的角色），统计量交给数据侧，凭据不进对话，
而"用记忆里的数字继续分析"没有任何工具会拦，所以只能改在正文里。
本颗改写后的正文另要如实说一句：**一致预期那一类字段本插件取不到**（本插件的结构化数据面没有盈利预测条目），
所以差异与情景只能写在公司自己披露的区间、历史与使用者自己的先前口径上，并标明是哪一种基线。
改了什么、影响几篇，逐条记在对应快照的 `UPSTREAM.md`；改写结果由仓库自带的回归测试逐条复查。
方法论、评分表、输出模板与分析结论一字未改。

**本颗是八份里唯一的 Apache-2.0 快照**（其余七份为 MIT），许可义务也因此多一条：Apache-2.0 第 4 条 (b) 款要求
"修改过的文件本身带上显著声明"，而不只是在他处说明。所以被改写的那 12 份正文在标题下各留了一句可见的改动声明，
点名所钉 commit 并指回该快照的 `UPSTREAM.md`；这颗快照在本仓只保留这 12 份，其余正文已删除。上游没有 `NOTICE` 文件，
因此随包保留 `LICENSE` 原件与这份清单即可。

## 随包发布的是什么

每份快照在 npm 包里只带**运行时正文与溯源**：catalog 登记的那几颗 skill 的 `SKILL.md`、它们引用的 references
与 assets 附属 Markdown、`LICENSE` 原件，以及本仓写的 `UPSTREAM.md`；A 股那六颗还带它们逐条链接的 shared 目录。
除此之外的文件一律不在仓里：非 catalog skill、上游脚本与取数服务端、评测夹具、
CI 与静态站、给别的宿主用的接线配置都已删除，删除清单与理由记在各自的 `UPSTREAM.md`。
打包闸门按这份白名单反查发布清单（出现任何白名单之外的文件就红），
所以"运行时树里只有 Markdown"是断言，不是约定。

纯公式的参考实现单独住在 `selected-skills/reference-algorithms/`：43 份 calculate 与 trading 的共享计算模块，
git-only、不随包、任何角色都不执行，文件头写明来源与"不执行"，`README.md` 是按算法
查原 skill 的索引。它们留在这里只为将来升级公式或移植到宿主的计算面；skill 正文只写"把算式写进答复、
需要算力时委派 `data_junior`"，不指向这些文件。

## npm 运行时依赖

| 包 | 声明版本 | 许可证 | 用途 |
|---|---|---|---|
| `@deepseek-ai/schemastery` | ^3.18.4 | MIT | 工具参数的 JSON Schema 构造 |
| `zod` | ^4.5.4 | MIT | 配置与持久化结构的校验 |
| `turndown` | ^7.2.4 | MIT | 网页材料 HTML → Markdown |
| `@joplin/turndown-plugin-gfm` | ^1.0.68 | MIT | 同上，表格等 GFM 扩展 |

图表 UI、设置卡片与自选股这三个随包携带的嵌套包复用同一批运行时依赖（前者不带依赖，
后两者分别只用 schemastery 与 zod），不各带一份副本。

**这张表列的是本插件直接声明的运行时依赖**。它们从 npm registry 拉取的传递依赖不在此逐条列名——那些包的
许可由各自作者在其包内声明，安装时随各包自带的 `LICENSE` 走。需要点名的一处：`turndown` 带一个
**BSD-2-Clause** 的传递依赖 `@mixmark-io/domino`（2.2.0，版权行是 The Mozilla Foundation），
它是本插件依赖树里唯一非 MIT 的传递依赖，其版权声明与免责条款随该包原文保留。

## 由宿主提供、不随本包分发

`@deepseek-ai/cordis`（`^4.0.2`）、`@deepseek-ai/dsh-skill` 与 `@deepseek-ai/dsh-skill-filesystem`
（均 `0.2.0-rc.2`）由 DSH 宿主提供，本插件只声明依赖。

三个客户端 bundle 在构建时把宿主已有的模块留成 external，**三个并不完全相同**（以各自构建脚本为准）：
图表卡片只留 `react` 与 react 的 jsx-runtime 入口，设置卡片另留 `react-dom`、
`@deepseek-ai/dsh-client-store` 与 `@deepseek-ai/dsh-client-ui-primitives`，自选股卡片留
`react`、react 的 jsx-runtime 入口与后两者。留出来的东西本插件既不打进去也不声明，运行时由宿主页面提供。

三个客户端还引用一组**由宿主在运行时注入**的界面模块（`@deepseek-ai/dsh-client-ui-conversation`、
`-locale`、`-ui-settings`、`-plugin-manager`、`-api-remotes`、`-api-session-controller`、`-ui-commands`）：
它们既不在本插件的依赖声明里，也不在 external 清单里，只在宿主注入的上下文里存在。宿主的许可见
<https://github.com/deepseek-ai>。

## 构建期使用、不随包分发

| 包 | 声明版本 | 许可证 | 构建期用途 |
|---|---|---|---|
| `typescript` | ^5.0.0（实测 5.9.3） | Apache-2.0 | 把仓内 TypeScript 源码编译为随包发布的 lib 产物 |
| `esbuild` | ^0.28.2 | MIT | 打三个客户端 bundle；上面留成 external 的那些就是它分出来的 |
| `js-yaml` | ^5.4.1 | MIT | 解析与校验 preset 的 patch 声明 |
| `lightweight-charts` | 5.2.1 | Apache-2.0 | 构建期把 standalone 副本 vendored 进 lib/chart/vendor 目录，随包发布的是那份副本（见上表） |
| `@deepseek-ai/dsh-system-prompt` | ^0.2.0-rc.2 | MIT | 只用它的类型面（一处 `import type`），编译产物里不留引用 |

## 外部数据与检索服务

以下服务**不是代码依赖，也不受上表许可约束**；接口条款、额度与数据版权归各服务方所有。分两组列全：

**需要使用者自备密钥的五项**（对应首页「数据源」卡片里的那五格，密钥一律只进宿主的凭据域）：

- **同花顺 Fuyao** —— 结构化数据：行情、财务、基金与指数，以及自选股报价。
- **Wind Alice** —— 三个能力面：公告与新闻等信披文档检索、宏观 / 行业 / 汇率等指标（EDB）、按日期区间取的
  历史 K 线；它在代码里还声明了几个未接入的端点，本插件不调用。按次消耗你在服务方的额度。
- **AnySearch** —— 网页搜索与正文提取。
- **PaddleOCR（百度 AIStudio）** —— PDF 与图片的文字解析。注意解析结果不是从作业接口直接返回的：
  本插件按服务方给的**预签名地址**到它的对象存储主机取回结果（与提交作业的不是同一台主机），
  取回后只落在使用者本机。
- **FTShare（非凸科技）** —— 结构化数据的第二家上游口径：A 股行情与日 K 截面、主力资金流（个股 / 行业 /
  概念）、涨跌停价、龙虎榜席位、股东人数、指数成分权重、可转债行情、大宗交易、业绩预告与快报、交易日历，
  以及 LPR / SHIBOR / HIBOR / 中债收益率曲线等利率长尾。免费档按次限流（服务方标 10 QPS / 突发 20），
  本插件用进程级节流链把节奏压在这条线内。

**公开口径的来源**（无需密钥，但同样受各服务方的条款与数据版权约束）：东方财富（宏观与个股数据、公告与
研报列表、7×24 快讯与新闻）、腾讯（公开行情与历史 K 线、代码检索）、新浪（研报列表）、财联社（电报）、
华尔街见闻（直播与快讯）、巨潮互动易（深市投资者问答）、上证 e互动（沪市投资者问答）、以及同花顺公开站点
（每股收益预测等公开口径）。

本插件不重新分发这些服务的原始数据，图表与结论所依据的数据集只保存在使用者本机，默认保留 7 天。
本插件也不接入券商接口：可选清单里没有任何下单、改单或读取账户的能力。

## 本插件自身

Capital Generation 的原创代码与文档以 MIT 许可发布，见仓库根的 `LICENSE`。
本文件不构成对任何第三方项目、数据源或其观点的背书；七份 Skill 快照里的方法论与结论属于原作者，
使用前请自行复核来源，尤其不要把按美股语境写的框架直接当作 A 股规则——反过来也一样，
第六份是按中国大陆卖方与机构研究惯例（中金 / 中信 / 华泰体例、申万与中信行业分类、CAS 科目、涨跌停与北向资金）写的，
不能当作境外市场的口径。
交易过程类的 Skill（第五份）给的是下单前的检查与下单后的复盘方法，其中也包含仓位数字与持仓加减建议；
第六份的报告模板以投资评级、目标价与多空方向收尾。这些都停留在文字与图表上，属于方法推演而不是订单：
本插件没有券商接口，不据它们下单、不改单，也不会替使用者执行任何一笔。
第七份（FinanceSkills）给的是折现率、估值区间、偿债与债务容量、减值覆盖率、银行资本比率、保险准备金
与账务异常线索：口径按 IFRS / US GAAP 与国际精算、巴塞尔惯例写，其中 `banking-compliance` 的资本阈值
是巴塞尔原值（4.5% / 6% / 8%），境内适用《商业银行资本管理办法》另有最低线与附加资本，**不能当境内合规
判断用**；`forensic-accounting` 给出的"疑似"清单是排查线索，不构成舞弊认定，也不构成审计意见或法律意见。
这些数字同样是方法推演的产物，不承诺表现，动手那一侧永远是使用者。
