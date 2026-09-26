# Changelog

本文件是 Capital Generation 的完整变更历史（README 只保留最近一版摘要，GitHub Release
说明从这里对应段落复制）。

**版本号口径（本仓实践）**：
- **第三位（patch）**：不破坏既有工具 / 配置 / 会话的新增与修复（如 2.1.1、2.1.2）。
- **第二位（minor）**：有需要用户知晓的行为变更，且段内附迁移说明（如 2.1.0 的图表呈现通道重做、2.2.0 的数据源与检索来源扩容）。

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
