# 第三方组件与许可（Third-Party Notices）

本文件集中列出 Capital Generation 随包分发或调用的第三方组件：项目名、作者、许可证与原始仓库。
本文件随 npm 包一起发布。各组件的许可全文以仓库内文件为准（下表"许可文本"列给出位置）。

## 随包分发的代码与内容

| 组件 | 作者 | 许可证 | 原始仓库 | 许可文本 | 用在哪里 |
|---|---|---|---|---|---|
| Lightweight Charts™ 5.2.1（standalone 构建） | TradingView | Apache-2.0 | <https://github.com/tradingview/lightweight-charts> | `lib/chart/vendor/LICENSE` | 插件内所有可交互图表的渲染层；`VERSION.json` 记有该构建的 sha256，归属标识（attribution logo）保持开启 |
| Investment Skills Lexicon（`7235d34`，固定快照；仅改写路由段的一句前置条件与退路） | finterm.ai | MIT | <https://github.com/finterm-ai/investment-skills> | `selected-skills/investment-skills/LICENSE` | 「精选 Skills」中的 `buffett-investment-framework` |
| China Stock Research Skills（`d49f1f3`，未修改的固定快照） | spikeHongg | MIT | <https://github.com/spikeHongg/china-stock-research-skills> | `selected-skills/china-stock-research-skills/LICENSE` | 「精选 Skills」中的 `financial-health`、`risk-warning-catalysts`、`valuation-investment-strategy`、`strategy-business-transition`、`industry-competition-moat`、`business-decomposition-order-quality` |
| InvestSkill（`c3f2a17`，固定快照；补 `name` 字段 + 28 颗的取数口径改写，分析正文未改） | yennanliu | MIT | <https://github.com/yennanliu/InvestSkill> | `selected-skills/InvestSkill/LICENSE` | 「精选 Skills」中的 28 个美股模块（`fact-check`、`bear-case`、`10k-digest`、`stock-valuation`、`risk-stress-test`、`tax-lens` 等） |
| Peter Lynch Research（`e0eaf58`，固定快照；套一层 skills 目录 + 取数口径改写，方法论、预算与输出模板未改） | Szymon Nycz（仓库账号 `DjNero11`） | MIT | <https://github.com/DjNero11/peter-lynch-skill> | `selected-skills/peter-lynch-skill/LICENSE` | 「精选 Skills」中的 `peter-lynch-skill`（个股快筛与尽调工作流，美股与境外上市口径） |

四份 Skill 快照的收录方式、上游 commit、维护状态与排除项逐条记在各自的 `UPSTREAM.md` 里；它们**默认全部关闭**，
只在使用者于配置页显式开启后才对新建的 Capital 会话可见，上游自带的脚本一律不作为可执行面引入。
上游自带的编排、报告与出图 skill 不进入可选清单（六颗仍留在快照里作为可审查材料）：前者与本插件既有的角色
路由冲突，后两者与已删除的报告交付链路、以及"出图只走 `render_chart`"的约定冲突。

**三处对上游正文的改写都是合规改写，不是编辑**：上游 skill 写给"什么工具都在手边"的宿主，成规模地要求
分析角色自己去 `web search` 取实时行情；前两份还留着"取不到就凭印象估一个"的逃生口，最新这份没有这个
逃生口，但取数归属同样要改。本插件的取数只有一个入口（交给负责取数的
角色），而"用记忆里的数字继续分析"没有任何工具会拦，所以只能改在正文里。
改了什么、影响几篇，逐条记在对应快照的 `UPSTREAM.md`；改写结果由仓库自带的回归测试逐条复查。
方法论、评分表、输出模板与分析结论一字未改。

## npm 运行时依赖

| 包 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| `@deepseek-ai/schemastery` | 3.18.4 | MIT | 工具参数的 JSON Schema 构造 |
| `zod` | 4.5.4 | MIT | 配置与持久化结构的校验 |
| `turndown` | 7.2.4 | MIT | 网页材料 HTML → Markdown |
| `@joplin/turndown-plugin-gfm` | 1.0.68 | MIT | 同上，表格等 GFM 扩展 |

## 由宿主提供、不随本包分发

`@deepseek-ai/cordis`（`^4.0.2`）、`@deepseek-ai/dsh-skill` 与 `@deepseek-ai/dsh-skill-filesystem`
（均 `0.2.0-rc.2`）由 DSH 宿主提供，本插件只声明依赖。宿主的许可见 <https://github.com/deepseek-ai>。

## 外部数据与检索服务

以下服务由使用者自备密钥调用，**不是代码依赖，也不受上表许可约束**；接口条款、额度与数据版权归各服务方所有：
同花顺 Fuyao 结构化数据接口、Wind Alice 金融信披文档检索、AnySearch 网页搜索与提取、
PaddleOCR 文档解析，以及东方财富、腾讯的公开行情接口与若干具名公开来源。
本插件不重新分发这些服务的原始数据，图表与结论所依据的数据集只保存在使用者本机，默认保留 7 天。

## 本插件自身

Capital Generation 的原创代码与文档以 MIT 许可发布，见仓库根的 `LICENSE`。
本文件不构成对任何第三方项目、数据源或其观点的背书；四份 Skill 快照里的方法论与结论属于原作者，
使用前请自行复核来源，尤其不要把按美股语境写的框架直接当作 A 股规则。
