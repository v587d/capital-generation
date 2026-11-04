---
name: capital-web-protocol
description: Use in Capital mode when retrieving external material — the announcement / anysearch / wind_docs source boundary and the rule to pick a source before searching, the search-convergence heuristic and how to read provider_tally / recent_retrievals, the three mandatory Wind query elements, the wind-to-anysearch fallback, and the automatic local-fetch fallback with its via / local-http provenance labeling. Volume 1 of the Capital retrieval protocol; how you label what you return lives in capital-web-evidence.
---

# Capital 检索协议 · 第一册：来源边界与收敛

> **定位**：本协议只定义来源边界、检索收敛与回传格式；10-K 精读、电话会纪要、逐条核验等方法在精选方法层。
> 任务同时命中且该方法在本角色目录中可用时，按名加载对应 Skill（如 `10k-digest` / `earnings-call-analysis` / `fact-check`）；
> 协议与方法正交：不要用本协议替代方法，也不要用方法改写本协议的来源纪律。
`web_retriever` 子 Agent 的工作细则；主 Agent 呈现检索结论时同样按 `capital-web-evidence` §5 的回传格式保留来源标注。
persona 只保留硬规则（先定来源再动手、只用这十六个工具、一次一个 URL、无来源不作证据）；
本文件是其余细节。

本协议共两册，§编号跨册连续：**本册**管"去哪取、怎么调"（§1 来源边界 / §2 收敛 / §3 Wind 三要素 /
§4 双来源降级），"取到的东西怎么标成证据"在 `capital-web-evidence`（§5 回传格式 / §6 官方域名核验 /
§7 抓取与失败处置 / §8 文档解析 `ocr`）。要给出编号证据、判定 `verified_official`、处理抓取失败或
解析 PDF，加载 `capital-web-evidence`。

## 1. 来源边界（两个搜索 provider + 十一个具名来源工具 + 文档解析）

**三类工作面，别混**：`search` / `fetch` 是**检索**（先发现候选，再按 URL 取正文）；
下面十一个工具是**来源查询**（具名来源 + 业务参数 → 确定、有序、可翻页、同参可复现的结果集）；
`ocr` 是**文档解析**（PDF / 图片 → markdown 正文，见 `capital-web-evidence` §8——它是这批工具里**唯一要 token** 的）。

| 来源 | 工具 | 性格 | 用途 |
|---|---|---|---|
| `eastmoney 公告` | `eastmoney_announcements` / `eastmoney_announcement_body` | 公告清单（零 key，A/H/US） | 公司公告列表与分页正文；**公告清单默认第一选择**，正文/PDF 可作权威引用（`authoritative_reprint`），官方域名核验另走巨潮/发行人 |
| `wind_docs` | `wind_docs_announcements` / `wind_docs_news` | 语义深研（`public_document`，**计费**） | 按语义找公告/新闻段落；**不是公告清单的可靠来源**（实测会漏最新、混入关联方） |
| `anysearch` | `anysearch_search` / `web_retriever_fetch` | 广度 | 候选探索与线索、官方页面归属核验、Wind 覆盖之外的内容（监管政策原文、境外或非上市主体、市场传闻） |
| `cls` | `cls_telegraph` | 来源查询（媒体） | 财联社 7×24 全市场快讯 |
| `wscn` | `wscn_lives` | 来源查询（媒体） | 华尔街见闻 7×24 快讯，按 `channel` + `cursor` 翻页 |
| `eastmoney` | `eastmoney_724` / `eastmoney_stock_news` / `eastmoney_reports` | 来源查询（媒体 / 券商研报） | 东财 7×24 快讯、个股新闻、个股研报列表 |
| `sina` | `sina_reports` | 来源查询（研报第二来源） | 新浪研报列表（**不含评级与目标价**） |
| `ths` | `ths_eps_forecast` | 来源查询（一致预期） | 同花顺机构一致预期 EPS（逐年：机构数 / 最小 / **均值** / 最大 / 行业平均） |
| `cninfo_irm` | `cninfo_irm` | 来源查询（巨潮，**深市**） | 互动易投资者问答：公司怎么回应某传闻/关切 |
| `sseinfo` | `sseinfo_qa` | 来源查询（上交所平台，**沪市**） | 上证e互动问答；不传 `code` 可看全市场 |

**互为备份的成对来源**：三个快讯来源（`cls_telegraph` / `wscn_lives` / `eastmoney_724`）三条不同源、
不同风控面，一条不可用另一条仍在——但东财会把它聚合到的财联社内容一并返回，**同一事件可能重复，
按标题去重**，不要当成两条独立证据。两个研报来源（`eastmoney_reports` / `sina_reports`）同理。

**来源边界，不要越过**：

- **公告清单先 `eastmoney_announcements`，不是 `wind_docs`**：实测同一公司、同一时间窗，Wind 的
  自然语言检索会漏掉最新公告、把关联方/别家公司的文件排进来；东财列表是发行人限定的完整列表。
  东财列表只给标题/时间/`art_code`/链接，正文用 `eastmoney_announcement_body` 按 `page` + `offset`
  读完（每页约 5,000 字符，单次最多 4,000 字符）。
- **东财公告是权威转载**：正文/PDF 可作公告事实的权威引用，标
  「公告原文（东财转载，`authoritative_reprint`）」；`verified_official` 仍只给官方域名核验，
  不因换源放宽。正文 `is_ai_summary=0` 且 `done=true` 才叫全文，否则标部分正文/摘要。
  美股公告正文常为空（只有 `pdf_url`/附件）：PDF 交 `ocr`，`.html` 用 `web_retriever_fetch`，不得把标题当正文；港股正文是繁体原文。
- `eastmoney_reports` / `sina_reports` 的列表**不含正文**（只有标题 / 机构 / 研究员 / 日期 / 评级）。
  东财的每条还直接给出 `pdf_url`（该篇研报 PDF 直链）与 `attach_pages`——**这不是死路：把那条
  `pdf_url` 原样交 `ocr` 解析**（`capital-web-evidence` §8），不要自己去拼或改链接。`ocr` 也拿不到时如实说明这个
  边界，**不要用标题当结论**。
- `ths_eps_forecast` 是**一致预期**（观点聚合），不是官方事实、也不是已实现业绩。
  `institutions`（预测机构数）< 3 时参考价值有限，回传时必须把机构数一并向用户披露。
- `sina_reports` **不含评级与目标价**；需要这些改用 `eastmoney_reports`。

- **先定来源再动手**：公告清单先 `eastmoney_announcements`，不要等 anysearch 空转后才想起；
  公告引用用东财正文/PDF（`authoritative_reprint`），官方域名核验才走官网 fetch；需要按语义找一段话、
  或东财覆盖不到时才用 `wind_docs`（计费）。
- `verified_official` 只能来自 `web_retriever_fetch` 的官方域名核验路径。九个媒体/互动/研报来源
  （快讯、新闻、研报、问答）只能作旁证；东财公告是**权威转载**，可按 `authoritative_reprint`
  引用公告事实，但不标 `verified_official`，也不降为媒体旁证。
- 不调用官方名称为 `web_search` 或 `web_fetch` 的其他工具。

### 1.1 来源查询的纪律（与检索不同）

- **结果集是确定的**：`该翻页就翻到没有`。回执带 `count`；`wscn_lives` 翻页把 `next_cursor`
  原样传回 `cursor`。不要因为一次返回条数少就换来源重搜。
- **空结果是真事实**：`cninfo_irm` 返回 0 条说明该公司近一个月确实没有问答；平台只开放近期
  问答（公司维度约近 1 个月）。**不要把"没有问答"写成"无法确认"**。
- **深沪不可互换**：互动易只覆盖深市（沪市实测返回 0 条），沪市问答必须用 `sseinfo_qa`；
  **北交所两个平台都没有**。传错市场会拿到空表，那不是数据缺口。
- **`status` 字段是事实不是缺口**：`answered` = 公司已回复（`answer` 有正文）；
  `unanswered` = 尚未回复（`answer` 为空）。未回复本身就是要回传的信息。
- **回执 `note` 必须读**：它写明上游口径、覆盖范围与被丢弃的条目（如上游把别的公司数据混进来
  时按条过滤的条数），据此判断结果可信度。
- **单条正文有长度上限**（约 1200 字符，超出以 `…` 结尾）：需要完整原文时用回执里的 `url`
  走 `web_retriever_fetch`，不要凭截断片段下结论。少数条目的 `url` 会被**整段丢掉**（链接不成话：
  非 http(s) 协议、含控制符、`https://真域名@假域名/` 这类凭据伪装、超长）——条目本身仍是证据，
  照常回传来源与媒体名，不要因为缺链接就丢弃这条。
- **一次调用有总输出预算**（约 6 千字符）：`count` 等于**真放进回执的条数**，被省略的条数写在
  `note`（"省略其后 N 条"）。要更多就调小 `limit` 或按 `next_cursor` / `page` 翻页继续取——
  **不要把"这次只回了 17 条"读成"上游一共只有 17 条"**。
- **代码写法随意**：`600519` / `SH600519` / `600519.SH` 归一化成同一个查询（上游只认纯 6 位），
  格式写错不会静默变成空结果。
- **公告分页与盘前窗口**：`eastmoney_announcements` 按 `display_time`（北京时间）过滤，翻页把回执的
  `next_cursor` 原样传回 `cursor`；`eastmoney_announcement_body` 先按 `next_offset` 读完本页，
  再按 `next_page` 翻下一页。**盘前公告先把自选股按 A 股、港股、美股分成三组，每组一次批量传
  `codes`（≤50），三组都要查；混合代码会报错。不得只做 A 股，也不得把港股/美股标成「不适用」**。
  `start_date` 取各自市场的上一交易日（收盘后披露的 `display_time` 仍是当日），`end_date` 取运行日；
  只查运行日会漏掉昨晚盘后披露。美股 `display_time` 也是北京时间，`notice_date` 可能是美股当地日，
  窗口以 `published_at` 为准；08:00 运行覆盖的是美股上一交易日收盘后的盘后披露，不是当晚美股盘前
  （完整盘前交给 20:30 任务）。港股正文是繁体，美股正文常为空；附件是 PDF 交 `ocr`，是 `.html` 用
  `web_retriever_fetch`。
- **`sseinfo_qa` 的 `code=TIMEOUT` 是上游慢**（按公司定位要串行翻 10+ 页），不是这一轮被取消：
  稍后重试，或先用不带 `code` 的调用取全市场问答再按代码筛。
- 这十一个工具的失败是**工具错误**（`isError`），不是"正常返回的失败信封"；`code` 取值见回执
  （`UPSTREAM` 上游报错 / `INVALID_RESPONSE` 上游结构变了 / `NOT_FOUND` 标的不存在 /
  `NETWORK` 网络失败 / `TIMEOUT` 上游慢到超过总时限）。**结构变更类错误不要重试**，如实回传。

### 1.2 遇到结构化数值诉求就停手

网页这一侧只能给出"某篇文章里的数字"：单位、缺失值含义、时间口径都没人承诺，上游改版就是静默变样。
委派消息要的是**可比对的数值序列或表格**（行情、财务、宏观指标、持股与榜单）时，立即回告主 Agent
"这份该走 `data_collector`"，不要用网页数字凑一张表，也不要抓取后自行解析、补齐成结构化数据冒充取数结果。
叙事材料（公告、研报、新闻正文）留在本角色，那正是内容本身；已经取到的行里带一个标题字段，不算叙事。

Wind 结构化查询同样是**花积分的**：先看 `data_collector` 的免费能力能不能覆盖"看趋势"这一步，
只有需要 Wind 口径或研报级准确度时才用积分。

## 2. 搜索收敛（经验法则，不是硬性配额）

- 一次任务对同一个 `search_engine_provider` 的全部检索调用——anysearch 的
  `anysearch_search`、wind_docs 的 `wind_docs_announcements` / `wind_docs_news` 都算——
  **一般 5 次以内就该收敛**。
- 动手前先想清楚要回答什么，规划少数几个高质量查询；每次变换查询条件前先自问"这次变化
  是否真的可能带来新来源"。
- 当新一轮检索的候选与已收集材料高度重叠，或已足以挑出完成任务所需的页面时，停止检索，
  转入逐个 fetch 与整理回传。
- 多标的、多主题的任务可以适度多搜，但每换一次条件前先盘点 `recent_retrievals`（已检索记录）
  与 `provider_tally`（各来源累计次数）：接近 5 次就该收敛收手。
- **偶尔超过 5 次不是错误**，要避免的是无收益的重复搜索。

## 3. Wind 查询要素（仅深研）

公告清单不要用本节，先走 `eastmoney_announcements`。只有确实用 `wind_docs` 时，`query` 才必须一次带齐三要素：

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
- **公告清单失败降级**：`eastmoney_announcements` 失败先转巨潮/官网（`cninfo_irm` 只覆盖问答，
  公告正文优先东财正文/PDF，官方域名核验才走官网 fetch），再转 `anysearch_search` 发现线索并逐个
  `web_retriever_fetch` 官方披露页；回传注明实际路径。
- **Wind 失败降级**：`wind_docs` 返回 AUTH / RATE_LIMIT 等错误信封时**不得重试 wind**，
  直接转 `eastmoney_announcements`/`anysearch_search` 发现公告线索并逐个 `web_retriever_fetch`
  官方披露页，回传注明"Wind 不可用/未覆盖，来源为官网抓取"。
- 反向 fallback：anysearch 多轮探索仍找不到公告原文而 Wind 可用时，转 `wind_docs` 少走弯路。
- 换 provider 前先看 `recent_retrievals` / `provider_tally`：该诉求是否已被回答、已有材料是否
  覆盖、目标来源还剩多少余量；切换原因写进回传。检索收敛法则按 provider 各自计。
