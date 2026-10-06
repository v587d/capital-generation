# web_retriever 能力

> 本表由 `test/web-retriever-capabilities.test.mjs` 断言与实现同步：表里第一列的工具名必须与
> `src/agents/root-tool-policy.ts` 注册的工具集**完全一致**（不多不少）。新增工具却忘了更新本表，
> 测试会点名缺了哪个。

当前共 **14 个工具**，分布在三个工作面：检索 4 个、具名来源查询 9 个、文档解析 1 个。
参数后带 **\*** 表示必填。除标注「需要」的三把密钥外，其余全部走公开端点、**零密钥**。

## 怎么用

`web_retriever` 是主 Agent 的直属下级，负责一切外部**非结构化**数据。三个工作面是不同问题，不要混用：

| 工作面 | 回答的问题 | 特征 |
|---|---|---|
| **检索** | 「哪儿可能有这件事？」 | 开放查询 → 发现候选来源，再按 URL 取正文；结果是候选，不等于已核验事实 |
| **来源查询** | 「某个具名来源现在有什么？」 | 来源 + 业务参数 → 确定、有序、可翻页、同参可复现的结果集 |
| **文档解析** | 「这份 PDF 的正文写了什么？」 | 文档 → markdown，逐页可读、可关键词定位 |

1. 主 Agent 委派 `subagent_web_retriever`，只传需求与时间范围，不传原始网页。
2. 官方公告与权威新闻**优先** `wind_docs_*`（Wind 文档库，返回即带来源与时间口径，可直接作证据）；
   第三方媒体报道只能作旁证。
3. 需要"某来源最新一整批"时用来源查询面，并按回执 `next_cursor` / `page` 翻到没有为止。
4. 遇到 PDF 是能力边界不是故障：`web_retriever_fetch` 只处理文本页面，正文一律改道 `ocr`。

## 检索面（4）

| 工具 | 上游 | 密钥 | 主要参数 | 用途 |
|---|---|---|---|---|
| `anysearch_search` | AnySearch | 需要 | `query`* `max_results` | 全网检索，发现候选来源与线索（一次一个查询，1~20 条） |
| `web_retriever_fetch` | AnySearch → 本机直连 | 需要 | `url`* | 取一个 http(s) 页面的正文；AnySearch 失败且回退开关开启时自动改本机直连，回执 `via` 标明实际来源。证券任务的官方归属核验只能经本工具完成 |
| `wind_docs_announcements` | Wind Alice | 需要 | `query`* `top_k` | 上市公司公告、年报、季报、招股书等**官方文件**正文（query 必须一次带齐公司实体 + 文件类型 + 时间范围三要素；消耗积分，按需少量调用） |
| `wind_docs_news` | Wind Alice | 需要 | `query`* `top_k` | 权威财经新闻（同上三要素；不含发行人官方公告与券商研报；同样按次消耗积分） |

## 来源查询面（9）

全部公开端点、**零密钥**。媒体来源（财联社 / 华尔街见闻 / 东财）只能作「媒体转述旁证」，不得标 `verified_official`。

| 工具 | 来源 | 密钥 | 主要参数 | 用途 |
|---|---|---|---|---|
| `cls_telegraph` | 财联社 | 无 | `limit` | 7×24 全市场快讯（直连 cls.cn v1，签名本地计算）；与 `wscn_lives` / `wind_docs_news` 互为独立备份 |
| `wscn_lives` | 华尔街见闻 | 无 | `channel`* `limit` `cursor` | 7×24 快讯，按频道（`global-channel` 要闻 / `a-stock-channel` A 股）+ 游标翻页，`importance` 取上游 score |
| `eastmoney_724` | 东方财富 | 无 | `limit` | 7×24 全球快讯，与上面两条三条独立来源互为备份；会聚合到财联社内容，同一事件按标题去重 |
| `eastmoney_stock_news` | 东方财富 | 无 | `code`* `limit` | 个股新闻。上游间歇风控时只返回股民资料，本工具按「文章列表键是否存在」区分**风控**与**该股确实没有新闻** |
| `eastmoney_reports` | 东方财富 | 无 | `code`* `page_size` `page` | 个股研报列表：评级、评级变动、逐篇当年预测 EPS，并给出每条 `pdf_url` 直链与 `attach_pages`。列表不含摘要，正文只在 PDF 里 → 交 `ocr` |
| `sina_reports` | 新浪 | 无 | `code` `page` | 研报第二来源（不传 `code` 取全市场最新）；只有标题 / 类型 / 日期 / 机构 / 研究员，**不含评级与目标价** |
| `ths_eps_forecast` | 同花顺 | 无 | `code`* | 机构一致预期 EPS，逐年一行：预测机构数 / 最小 / **均值** / 最大 / 行业平均。机构数 <3 家时须一并披露 |
| `cninfo_irm` | 巨潮互动易 | 无 | `code`* `page_size` `page_num` | **深市**投资者问答：投资者提问 + 公司回复，用于「公司怎么回应某传闻」。`unanswered` 是事实不是缺口 |
| `sseinfo_qa` | 上证e互动 | 无 | `code` `kind` `page` `page_size` | **沪市**投资者问答；不传 `code` 看全市场最新。平台只开放近期问答（公司维度约近 1 个月） |

## 文档解析面（1）

| 工具 | 上游 | 密钥 | 形态 | 用途 |
|---|---|---|---|---|
| `ocr` | PaddleOCR AIStudio | 需要 | 四选一：`url` / `file` / `job_id`+`doc_id` / `doc_id`+（`pages` 或 `query`） | 把 PDF 研报 / 公告正文或图片解析成 markdown。一次调用只走一种形态 |

- `url`：公网 `.pdf` 直链（本机不抓文件，由上游取；不接受内网地址与 IP 字面量）。
- `file`：session workspace 内的相对路径（pdf / png / jpg / jpeg / webp / bmp / tiff），
  用户 `@xxx.pdf` 推给主 Agent 的文档可直接解析。
- `job_id` + `doc_id`：续查上一次 `status: pending` 的作业，**不重复提交、不再花钱**。
- `doc_id` + `pages`（`"2-4,9"`，一次最多 8 页）或 `query`（关键词定位，回命中片段与页号）：
  纯本地读已落盘正文，零出网。

⚠️ 作业**整篇一次算完、按整篇计费**：`pages` 只影响读、不影响算价，也不会更便宜。产物一律落
`capital-data/ocr/<doc_id>/`，同一份文档重复调用命中 `doc_id` 缓存直接回读（`refresh: true` 才强制重跑，
重跑会再花一次）。引用必须写 `doc_id` 与页号——**不得把标题当正文引用，不得把 PDF 链接当正文来源标注**。

## 边界与纪律

- **数值序列不在本面**：本表里 Wind 只有公告与新闻两个检索工具；宏观 / 行业 / 汇率指标与按日期区间
  取的历史 K 线住在 [data_collector 能力表](data-collector-capabilities.md)（`wind_edb_search` /
  `wind_edb_query` / `wind_stock_kline`）。要一个数值序列就停手回告主 Agent，**不要从新闻正文里抄数**
  ——正文里的数字没有可核对的口径与时间轴。Wind 那五个工具**都按次消耗上游积分**：免费覆盖
  （Fuyao 61 条 + 腾讯 7 条 + 东财 21 张）打不到的东西才值得花。
- **深沪不可互换**：互动易只覆盖深市、上证e互动只覆盖沪市，实测沪市公司查互动易返回 0 条；
  **北交所两个平台都没有**。
- **空结果是真事实**：来源查询面回 0 条且 `note` 未报风控，就是"确实没有"，不是缺口、不必重试。
- **该翻页就翻到没有**：`next_cursor` / `page` 传回上一页回执，直到空页为止。
- **上游风控 ≠ 没有内容**：报错按结构化错误码归类（`AUTH` / `RATE_LIMIT` / `NETWORK` / `UPSTREAM`），
  遇风控换来源或隔几分钟再试，不要重试同一路径。
- 回传格式、`provider_tally` 与核验口径见
  [capital-web-protocol](../preset/capital-generation/skills/capital-web-protocol/SKILL.md)。
