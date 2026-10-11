# 第三方组件与许可（Third-Party Notices）

本文件集中列出 Capital Generation 随包分发、随包调用、或只在构建期使用的第三方组件：项目名、作者、
许可证、原始仓库，以及它在本插件里的位置。本文件随 npm 包一起发布；各组件的许可全文以仓库内文件为准
（下表"许可文本"列给出位置）。**这份清单不是手抄的**：仓库回归测试会把这里点名的仓内路径拿去问一次
真实打包器（写了却没发出去就红），也会按 catalog 现算核对首页的模块总数，所以它与装出去的包同步。

## 随包分发的代码与内容

| 组件 | 作者 | 许可证 | 原始仓库 | 许可文本 | 可选模块 / 快照内共 | 用在哪里 |
|---|---|---|---|---|---|---|
| Lightweight Charts™ 5.2.1（standalone 构建） | TradingView | Apache-2.0 | <https://github.com/tradingview/lightweight-charts> | `lib/chart/vendor/LICENSE` | — | 插件内所有可交互图表的渲染层；`VERSION.json` 记有该构建的 sha256，归属标识（attribution logo）保持开启 |
| Investment Skills Lexicon（`7235d34`，固定快照；仅改写路由段的一句前置条件与退路） | finterm.ai | MIT | <https://github.com/finterm-ai/investment-skills> | `selected-skills/investment-skills/LICENSE` | 1 / 1 | 「精选 Skills」中的 `buffett-investment-framework` |
| China Stock Research Skills（`d49f1f3`，未修改的固定快照） | spikeHongg | MIT | <https://github.com/spikeHongg/china-stock-research-skills> | `selected-skills/china-stock-research-skills/LICENSE` | 6 / 7 | 「精选 Skills」中的六颗 A 股模块：`financial-health`、`risk-warning-catalysts`、`valuation-investment-strategy`、`strategy-business-transition`、`industry-competition-moat`、`business-decomposition-order-quality`；快照内的 orchestrator 不开放（与本插件的角色路由冲突） |
| InvestSkill（`c3f2a17`，固定快照；补 `name` 字段 + 28 颗的取数口径改写，分析正文未改） | yennanliu | MIT | <https://github.com/yennanliu/InvestSkill> | `selected-skills/InvestSkill/LICENSE` | 28 / 34 | 「精选 Skills」中的 28 个美股模块（`fact-check`、`bear-case`、`10k-digest`、`stock-valuation`、`risk-stress-test`、`tax-lens` 等）；另六颗（编排、报告输出口、自带出图、三颗 alias 残片）留在快照里作为可审查材料 |
| Peter Lynch Research（`e0eaf58`，固定快照；套一层 skills 目录 + 取数口径改写，方法论、预算与输出模板未改） | Szymon Nycz（仓库账号 `DjNero11`） | MIT | <https://github.com/DjNero11/peter-lynch-skill> | `selected-skills/peter-lynch-skill/LICENSE` | 1 / 1 | 「精选 Skills」中的 `peter-lynch-skill`（个股快筛与尽调工作流，美股与境外上市口径） |
| Trading Skills（`f1ae7d4`，固定快照；平铺掉上游的主题分组 + 取数与计算口径改写，判定档位、阈值与分析结论未改） | marian2js | MIT | <https://github.com/marian2js/trading-skills> | `selected-skills/trading-skills/LICENSE` | 9 / 19 | 「精选 Skills」中的 9 颗交易过程模块（`catalyst-map`、`watchlist-review`、`evidence-gap-check`、`thesis-validation`、`risk-reward-sanity-check`、`execution-plan-check`、`portfolio-concentration`、`journal-pattern-analyzer`、`post-trade-review`）；券商执行面那颗不进发布包，其余排除项留在快照里作为材料 |

五份快照合计 **45 个可选模块**（首页「精选 Skills」那句里的两个数字与此同源，由回归测试按 catalog 现算钉住）。
它们的收录方式、上游 commit、维护状态与逐颗排除理由记在各自的 `UPSTREAM.md` 里，并且**默认全部关闭**，
只在使用者于配置页显式开启后才对新建的 Capital 会话可见。
上游自带的编排、报告与出图 skill 不进入可选清单（InvestSkill 的六颗与 Trading Skills 的九颗仍留在快照里作为可审查材料）：
前者与本插件既有的角色路由冲突，后两者与已删除的报告交付链路、以及"出图只走 `render_chart`"的约定冲突。
Trading Skills 另外排除的几类走的是同一批约定：券商 API 执行面（在对话里采集凭据、真实下单）不进可选清单、
也不进发布包；给仓位数字与持仓加减动作的模块按「买卖动作与仓位决策属于明确冲突」的既有口径排除；
把取数写死成"向用户点选付费服务商再自己调接口"的三颗不收录，本插件没有那些服务商的凭据，密钥只进凭据域。

**四处对上游正文的改写都是合规改写，不是编辑**：上游 skill 写给"什么工具都在手边"的宿主——前三份成规模地要求
分析角色自己去 `web search` 取实时行情，其中两份还留着"取不到就凭印象估一个"的逃生口；最新这份一次 `web search`
都没写，但伸手取数换了形态：`curl` 付费服务商的接口、认领对话里给过的 API 凭据，以及"能跑代码的宿主就去用共享
python 模块"。本插件的取数只有一个入口（交给负责取数的角色），统计量交给数据侧，凭据不进对话，
而"用记忆里的数字继续分析"没有任何工具会拦，所以只能改在正文里。
改了什么、影响几篇，逐条记在对应快照的 `UPSTREAM.md`；改写结果由仓库自带的回归测试逐条复查。
方法论、评分表、输出模板与分析结论一字未改。

## 随包发布的是什么

每份快照在 npm 包里只带**运行时正文与溯源**：那颗 skill 的 `SKILL.md` 与其附属文件、`LICENSE` 原件、
以及本仓写的 `UPSTREAM.md`。上游仓库的其他材料（README 及其变体、它自己的 CI 与 workflow、静态站与成图、
roadmap 与贡献指南、站点体检记录、给别的宿主用的接线配置）由该快照目录里的 `.npmignore` 挡在包外——
那份文件是排除口径的唯一声明处，回归测试逐颗读它并拿发布清单反查（目录规则与文件规则两类都问）。
全量快照完整住在 git，`github:` 安装与"当时是哪个 commit"的复核都不受影响。

上游自带的可执行面文件（`framework.py`、`install.sh`、`Makefile`、`openai.yaml`）**照旧随包保留作为可审查材料**：
本插件的根角色没有 shell，provider 与工具面只读取文档、从不执行它们，正文里也不许出现"跑这个脚本"的指令
（有方法论入口的那颗同时写明了没有 shell 时直接读哪份附属文件）。不进可选清单的 skill 同样随包保留，
但运行时读不到：技能注册的名单与原文旁路的文件名都是按可选清单现算的闭集。

## npm 运行时依赖

| 包 | 声明版本 | 许可证 | 用途 |
|---|---|---|---|
| `@deepseek-ai/schemastery` | ^3.18.4 | MIT | 工具参数的 JSON Schema 构造 |
| `zod` | ^4.5.4 | MIT | 配置与持久化结构的校验 |
| `turndown` | ^7.2.4 | MIT | 网页材料 HTML → Markdown |
| `@joplin/turndown-plugin-gfm` | ^1.0.68 | MIT | 同上，表格等 GFM 扩展 |

图表 UI、设置卡片与自选股这三个随包携带的嵌套包复用同一批运行时依赖（前者不带依赖，
后两者分别只用 schemastery 与 zod），不各带一份副本。

## 由宿主提供、不随本包分发

`@deepseek-ai/cordis`（`^4.0.2`）、`@deepseek-ai/dsh-skill` 与 `@deepseek-ai/dsh-skill-filesystem`
（均 `0.2.0-rc.2`）由 DSH 宿主提供，本插件只声明依赖。
三个客户端 bundle（图表卡片、设置卡片、自选股）在构建时把 `react`、`react-dom`、
`@deepseek-ai/dsh-client-store` 与 `@deepseek-ai/dsh-client-ui-primitives` 留成 external：
本插件既不打进去也不声明它们，运行时由宿主页面提供。宿主的许可见 <https://github.com/deepseek-ai>。

## 构建期使用、不随包分发

| 包 | 声明版本 | 许可证 | 构建期用途 |
|---|---|---|---|
| `typescript` | ^5.0.0（实测 5.9.3） | Apache-2.0 | 把仓内 TypeScript 源码编译为随包发布的 lib 产物 |
| `esbuild` | ^0.28.2 | MIT | 打三个客户端 bundle；上面那四个 external 就是它留出来的 |
| `js-yaml` | ^5.4.1 | MIT | 解析与校验 preset 的 patch 声明 |
| `lightweight-charts` | 5.2.1 | Apache-2.0 | 构建期把 standalone 副本 vendored 进 lib/chart/vendor 目录，随包发布的是那份副本（见上表） |
| `@deepseek-ai/dsh-system-prompt` | ^0.2.0-rc.2 | MIT | 只用它的类型面（一处 `import type`），编译产物里不留引用 |

## 外部数据与检索服务

以下服务由使用者自备密钥调用，**不是代码依赖，也不受上表许可约束**；接口条款、额度与数据版权归各服务方所有：
同花顺 Fuyao 结构化数据接口、Wind Alice 金融信披文档检索、AnySearch 网页搜索与提取、
PaddleOCR 文档解析，以及东方财富、腾讯的公开行情接口与若干具名公开来源。
本插件不重新分发这些服务的原始数据，图表与结论所依据的数据集只保存在使用者本机，默认保留 7 天。
本插件也不接入券商接口：可选清单里没有任何下单、改单或读取账户的能力，密钥一律只进宿主的凭据域。

## 本插件自身

Capital Generation 的原创代码与文档以 MIT 许可发布，见仓库根的 `LICENSE`。
本文件不构成对任何第三方项目、数据源或其观点的背书；五份 Skill 快照里的方法论与结论属于原作者，
使用前请自行复核来源，尤其不要把按美股语境写的框架直接当作 A 股规则。
交易过程类的模块（第五份）提供的是下单前的检查与下单后的复盘方法，本插件不据它们下单、不改单，也不给仓位数字。
