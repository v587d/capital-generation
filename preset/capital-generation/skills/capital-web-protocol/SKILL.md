---
name: capital-web-protocol
description: Use in Capital mode when retrieving or presenting external material — the anysearch / wind_docs source boundary and the rule to pick a source before searching, the search-convergence heuristic and how to read provider_tally / recent_retrievals, the three mandatory Wind query elements, the wind-to-anysearch fallback, the automatic local-fetch fallback and its via / local-http provenance labeling, the numbered evidence reply format, and the official-domain verification checklist for securities sources. Required reading for the web_retriever child before its first retrieval.
---

# Capital 检索协议（完整版）

`web_retriever` 子 Agent 的工作细则；主 Agent 呈现检索结论时同样按第 5 节的回传格式保留来源标注。
persona 只保留硬规则（先定来源再动手、只用四个工具、一次一个 URL、无来源不作证据）；
本文件是其余细节。

## 1. 来源边界（两个 search_engine_provider）

| 来源 | 工具 | 性格 | 用途 |
|---|---|---|---|
| `wind_docs` | `wind_docs_announcements` / `wind_docs_news` | 精准（`public_document`） | 官方正式文件（公告/年报/招股书）与权威新闻的**默认第一选择** |
| `anysearch` | `web_retriever_search` / `web_retriever_fetch` | 广度 | 候选探索与线索、官方页面归属核验、Wind 覆盖之外的内容（监管政策原文、境外或非上市主体、市场传闻） |

- **先定来源再动手**：不要等 anysearch 空转后才想起 wind_docs；拿不准时先试 `wind_docs`，
  失败再降级 `anysearch`，不要反过来。
- `verified_official` 只能来自 `web_retriever_fetch` 的官方域名核验路径。
- 不调用官方名称为 `web_search` 或 `web_fetch` 的其他工具。

## 2. 搜索收敛（经验法则，不是硬性配额）

- 一次任务对同一个 `search_engine_provider` 的全部检索调用——anysearch 的
  `web_retriever_search`、wind_docs 的 `wind_docs_announcements` / `wind_docs_news` 都算——
  **一般 5 次以内就该收敛**。
- 动手前先想清楚要回答什么，规划少数几个高质量查询；每次变换查询条件前先自问"这次变化
  是否真的可能带来新来源"。
- 当新一轮检索的候选与已收集材料高度重叠，或已足以挑出完成任务所需的页面时，停止检索，
  转入逐个 fetch 与整理回传。
- 多标的、多主题的任务可以适度多搜，但每换一次条件前先盘点 `recent_retrievals`（已检索记录）
  与 `provider_tally`（各来源累计次数）：接近 5 次就该收敛收手。
- **偶尔超过 5 次不是错误**，要避免的是无收益的重复搜索。

## 3. Wind 查询要素

`wind_docs` 的 `query` 必须一次带齐三要素：

1. 公司实体（股票代码或公司全称，以主 Agent 委派消息为准）；
2. **文件类型或主题**；
3. **时间范围**。

禁止"公告 2026年9月"这类**无主体泛查询**。委派消息缺标的或代码时先回告主 Agent 补充，
不得自行猜测或省略实体。Wind 检索消耗积分：按需少量调用，不做批量撒网；`top_k` 按需给值，
不确定时保持默认。

## 4. 双来源纪律与降级

- `wind_docs` 返回内容视为"来源：万得 Wind 金融数据服务"的官方文档库检索结果，标注来源与
  时间口径后即可作为证据使用，不必再走官网核验。
- 同一份文件不得两边都取原文；两边都取必须是明说的交叉核验，且一份对一份。
- **Wind 失败降级**：`wind_docs` 返回 AUTH / RATE_LIMIT 等错误信封时**不得重试 wind**，
  直接转 `web_retriever_search` 发现公告线索并逐个 `web_retriever_fetch` 官方披露页，
  回传注明"Wind 不可用/未覆盖，来源为官网抓取"。
- 反向 fallback：anysearch 多轮探索仍找不到权威原文而 Wind 可用时，转 `wind_docs` 少走弯路。
- 换 provider 前先看 `recent_retrievals` / `provider_tally`：该诉求是否已被回答、已有材料是否
  覆盖、目标来源还剩多少余量；切换原因写进回传。检索收敛法则按 provider 各自计。

## 5. 回传格式（每条证据都要有来源）

- 回传的证据/情报逐条编号（情报1、情报2……），编号后紧跟来源标注。
- 有网页链接的用 markdown 链接：方括号里列出**全部来源**（检索 provider 与具体媒体/机构名
  都写上），**链接只放一条最权威的**即可，不必逐个贴链接。示例：
  `情报1：公司今日召开临时股东会审议借款议案。[AnySearch, 新浪财经, 证券之星](https://…)`
- 没有具体网页链接的证据（如 `wind_docs` 返回的公告/新闻正文），只标注来源与时间口径。示例：
  `情报2：公司2024年年报披露净利润同比下降。（来源：万得 Wind 金融数据服务，2026-09-11）`
  `wind_docs` 返回体内自带链接字段时可用那个链接；**不得编造链接**。
- 来源标注要区分：候选来源（搜索摘要，未点开）、已获取正文（fetch 过）、wind_docs 官方文档
  （来源：Wind）。**无来源的信息不得作为证据回传**；不编造来源。
- 失败项与未核验项同样编号列出并注明原因，不与已证实证据混排；同一来源服务多条情报时逐条
  重复标注，不要用"同上"。
- 主 Agent 向用户呈现时保留这些来源标注；网页数字只能标"媒体转述旁证"。
- `via: 'local-http'`（本机直连抓取）取得的正文，来源标注用「官网直抓」措辞
  （例如「AnySearch 受限，来源为本机直抓官网页面」），链接仍只放一条最权威的。

## 6. 官方证券来源域名核验

当任务涉及股票、证券、基金、监管机构、交易所、清算机构、上市公司或发行人的可信来源时，
只核验官方网址和域名。

- 仅使用 `web_retriever_fetch` 访问官方监管机构、交易所、清算机构、发行人、基金管理人、
  官方披露系统或官方数据接口页面。
- 不得使用搜索摘要、财经媒体、聚合网站、百科、论坛、社交媒体、域名评级网站或模型记忆作为
  证据；不得调用 `web_retriever_search` 替代 `web_retriever_fetch`。
- 不得仅凭机构名称、域名后缀、网页外观或搜索结果判断官方归属。必须通过 fetch 页面确认机构
  名称、域名归属和具体业务用途。
- 主域名、子域名、API 域名、披露系统域名和下载域名必须**分别核验**；官方页面跳转或链接到
  第三方域名，不代表该域名自动属于官方。
- 只有官方页面能够直接证明归属和用途时，才能标记为 `verified_official`；否则标记为
  `unverified` 或 `not_verified`，不得猜测或列入白名单。
- 每个已核验域名输出：机构、司法辖区、机构类型、规范化域名、官方网址、核验用途、可信原因、
  核验状态、证据网址、抓取时间和使用限制。
- 将"已核验官方白名单"和"候选/未核验域名"分开；没有充分证据时明确写"未核验"，不得为了
  完整性补全域名。
- 域名属于官方机构，不等于该域名下所有数据都适合作为最终证券研究证据；实际使用不得超出已
  核验的业务范围。
- 本机直抓**不改变** `verified_official` 的授予条件（仍只属于官方域名核验路径）；但核验记录里
  要写明该页面是经 AnySearch 清洗还是本机直抓取得的（看回执 `via` 字段）。

## 7. 抓取与失败处置

- 网页抓取成功后回传 URL、标题、正文和抓取结果；正文过长时按工具返回内容为准，不自行补全。
- **自动本机回退（不是你的第二次调用）**：`web_retriever_fetch` 在 AnySearch 明确失败且"值得换路"、
  **且本机直连回退已启用**（设置卡片开关「允许启动本地提取网页内容」，默认开启）时，会**自动**改由
  本机直连抓取该页面；你不需要、也不应该为此再调用一次工具。未启用时 AnySearch 失败即回传失败，
  照常按失败处置，不要为此改用其他抓取途径。回执里的 `via` 标明正文来源：
  `via: 'anysearch'` = AnySearch 清洗正文；`via: 'local-http'` = 本机直连抓取。
- **来源标注义务**：`local-http` ⇒ 来源标注用「官网直抓」措辞（必须写明
  「AnySearch 受限，来源为本机直抓官网页面」），并保留 `fallback.code` 作为 AnySearch 失败原因；
  `via: 'anysearch'` 时按第 5 节现状标注。
- **本机直抓的能力边界**（不要以为它万能）：只处理公开可访问的文本页面（HTML / 文本 / JSON / XML）；
  PDF 与二进制、需登录页面、内网地址仍会失败。正文超长时是**截断**（回执 `truncated: true`），不是失败。
- **失败是工具错误，不是"正常返回"**：抓取失败时 `web_retriever_fetch` 以**工具错误**（`isError`）返回，
  错误正文就是一份 JSON 回执（`ok: false` + `error` + `code` + `local_error` + `fallback` + 检索回声）。
  **不要把它当成抓取成功**——先读 `local_error.code` / `code` 判明原因，再如实回传；不得编造标题或正文。
- **与"最多重试一次"的关系**：自动回退**不算**你的第二次重试。模型层面的"重试一次"只适用于两条路
  都失败之后的显式重试；网络或服务错误**最多重试一次**，仍失败则如实回传，并与其他已证实证据分开编号。
- 搜索摘要只能用于发现候选来源，不能作为证券事实证据；报告中区分候选来源、已获取正文、
  未核验内容和失败原因，不编造缺失信息。

### 7.1 WAF 挑战型站点：如实报错，改走 Wind

有些站点（政府网站尤其多）挂在 **WAF 的 JavaScript 挑战**后面。识别特征：

- 回执 `local_error.code = 'HTTP'` 且消息是 **HTTP 521**（也可能是 403 / 503）；
- 响应头带 `X-Via-Jsl`（加速乐 / Jiasule）、`Set-Cookie: __jsluid_h=...`；
- 正文不是文章，而是一段**裸 `<script>`**（内容是 `document.cookie=...__jsl_clearance...`）。

**原理**：服务器要求客户端**执行 JavaScript** 算出通行证 cookie 再重新请求。浏览器会自动完成这一步，
而本机直抓是纯 HTTP 客户端，**不执行脚本**，所以永远拿不到正文。它**不是**超时、不是缺响应头、
也不是重定向问题——**重试无用**（第二次只会拿到 20KB 以上的混淆脚本，需要 `window` / `document` 才能跑）。

**处置（硬规则）**：

1. **不重试、不尝试绕过**：不分析混淆脚本、不猜 cookie、不靠换 UA 碰运气。
2. 如实回传：该 URL **未取得正文**，与其他已证实证据分开编号，域名核验状态写「未核验」。
3. **改走 Wind**：同一份官方文件或权威新闻优先用 `wind_docs_announcements` / `wind_docs_news` 取
   （`public_document`），标注「来源：万得 Wind 金融数据服务」与时间口径后即可作为证据。
   Wind 也查不到时，再试同一内容的**其他官方入口**（中国政府网、部委主站镜像等），
   并在回传里注明替代来源与原 URL 的关系。
4. 不要因为一条被墙就放弃整个任务：把这一条标为「来源不可达」，其余结论照常给出。
