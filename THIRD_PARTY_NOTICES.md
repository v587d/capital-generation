# 第三方组件与许可（Third-Party Notices）

本文件集中列出 Capital Generation 随包分发或调用的第三方组件：项目名、作者、许可证与原始仓库。
本文件随 npm 包一起发布。各组件的许可全文以仓库内文件为准（下表"许可文本"列给出位置）。

## 随包分发的代码与内容

| 组件 | 作者 | 许可证 | 原始仓库 | 许可文本 | 用在哪里 |
|---|---|---|---|---|---|
| Lightweight Charts™ 5.2.1（standalone 构建） | TradingView | Apache-2.0 | <https://github.com/tradingview/lightweight-charts> | `lib/chart/vendor/LICENSE` | 插件内所有可交互图表的渲染层；`VERSION.json` 记有该构建的 sha256，归属标识（attribution logo）保持开启 |
| Investment Skills Lexicon（`7235d34`，未修改的固定快照） | finterm.ai | MIT | <https://github.com/finterm-ai/investment-skills> | `selected-skills/investment-skills/LICENSE` | 「精选 Skills」中的 `buffett-investment-framework` |
| China Stock Research Skills（`d49f1f3`，未修改的固定快照） | spikeHongg | MIT | <https://github.com/spikeHongg/china-stock-research-skills> | `selected-skills/china-stock-research-skills/LICENSE` | 「精选 Skills」中的 `financial-health`、`risk-warning-catalysts`、`valuation-investment-strategy`、`strategy-business-transition`、`industry-competition-moat`、`business-decomposition-order-quality` |

两份 Skill 快照的收录方式、上游 commit、维护状态与排除项逐条记在各自的 `UPSTREAM.md` 里；它们**默认全部关闭**，
只在使用者于配置页显式开启后才对新建的 Capital 会话可见，上游自带的脚本一律不作为可执行面引入。
上游自带的编排 skill（`china-stock-research-orchestrator`）不进入可选清单，因为它与本插件既有的角色路由冲突。

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
本文件不构成对任何第三方项目、数据源或其观点的背书；两份 Skill 快照里的方法论与结论属于原作者，
使用前请自行复核来源，尤其不要把按美股语境写的框架直接当作 A 股规则。
