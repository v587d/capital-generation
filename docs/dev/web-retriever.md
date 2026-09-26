# web_retriever 纪律

> 索引见仓库根 `AGENTS.md` §4。改 `src/web-retriever/`、`src/ocr/`、`src/net/` 或九个具名来源之前读这里。
> §编号沿用 `AGENTS.md` 的全局命名空间。

## 4.1 工作面与分工

- **模型侧纪律不在本文**（同一份规则抄三处迟早失真）：硬规则在主 / 子 persona，细则在 skill
  `capital-web-protocol`——两者都由 `test/persona.test.mjs` 断言（体积上限 + 要点逐条 pattern：
  搜索摘要只是候选、`verified_official` 授予条件、Wind 三要素、5 次收敛、回传引用、双向
  fallback、官方域名核验清单）。本节只留**维护者结构事实**。
- **三类工作面**：**检索** = `anysearch_search` / `wind_docs_*` / `web_retriever_fetch`；
  **来源查询** = 九个具名工具（`cls_telegraph` / `wscn_lives` / `cninfo_irm` / `sseinfo_qa` /
  `eastmoney_724` / `eastmoney_stock_news` / `eastmoney_reports` / `sina_reports` /
  `ths_eps_forecast`）——全部公开端点、零 key、本机直连出网。实现 `src/web-retriever/sources.ts`，
  验收记录 `docs/design/web-retriever-source-expansion.md`。**新增来源只改一处名单**
  （`RETRIEVAL_DENIED_TOOLS`，§8.4 → `preset-persona.md`）就要进这九个的注册面。
  **文档解析** = `ocr`（§4.3）：与前两面的关键差别是它**要 token**（`PADDLE_OCR_TOKEN`），
  所以"零 key、装好即可用"那句话对它不成立。

## 4.2 本地回退（AnySearch 失败后的本机直连）

- **触发**：AnySearch **明确失败**且"值得换路"且**回退开关开启**时，工具内部**自动**本机直连同
  一页面（HTML → GFM markdown）——**不是模型要做的第二次调用**，不占"最多重试一次"额度。开关 =
  设置卡片「允许启动本地提取网页内容」（默认开启，写入路径与 `applies:'restart'` 见 §5.2 →
  `settings-config.md`）；**同时支配九个具名来源**：关闭时工具仍在注册面但每次响亮失败
  （`DISABLED`）。
- **不回退的三类**：`INVALID_URL` / `UNSUPPORTED_CONTENT` / `ABORTED`（调用方取消**原样抛出，
  绝不降级成失败信封**；回退前另有 `signal` 已取消即不发请求的硬闸门）。
- **回执必须标注来源**：`via`（`anysearch` / `local-http`）、`fallback`、`truncated`、`local_error`；
  `via === 'local-http'` 时回传要写明「AnySearch 受限，来源为本机直抓官网页面」，`verified_official`
  核验记录写明走的哪条路。
- **直抓边界**：只处理公开文本页面（HTML/文本/JSON/XML），超长是**截断**不是失败。**不做内容
  启发式**、**不做 IP 钉死**（DNS 重绑是与 `dsh-search-first` 同口径的显式接受取舍，见
  `docs/design/web-retriever-local-fetch.md`）。
- **展示链接与出口校验两套策略**：出口用 `validateUrl`（会抛）；条目里的 url 用 `safeUrl`（不抛，
  判空即**丢字段不丢条目**）——只收 http(s)，拒空白/控制符/超长/`user:pass@` 凭据：这些串会变成
  用户可点的链接，而凭据伪装（`https://真域名@evil/`）SSRF 闸门看不见（它只校验真实 host）。
- **具名来源输出预算**：`SOURCE_OUTPUT_BUDGET_CHARS`（6144 = 剪枝阈值 75%，与 §1.5 同口径）内的
  条目才装进 `items`，`count` 只说真放下的条数、省略写进 `note`——**声明与正文不一致比报错
  危险**。阈值真值在 preset `compaction` 组 `tool-result-pruner` 子行，`test/persona.test.mjs`
  钉住两处不得背离。
- **不可见字符一律剥**（`stripInvisibleText`）：零宽 / 双向覆盖 / C0-C1 / BOM 删除保序——
  Trojan Source 字符会改变行的显示顺序，让关键词检查认不出被伪装的指令。顺序固定"先解码实体、
  后剥不可见字符与标签"；`\n` `\r` `\t` 保留。
- **代码语法归一化属于工具**：九个来源的 `code` 一律先过 `bareAshareDigits` → 纯 6 位（实测东财
  研报库对带前缀写法返回 0 条）。检索面刻意放宽数据面歧义规则（裸 `000001` 可用），市场错配由
  上游 0 条 + `note` 回答。
- **正文入口属于列表工具**：`eastmoney_reports` 的条目带 `pdf_url`（`H3_<infoCode>_1.pdf`，
  2026-09-25 实测三个不同年份的 `infoCode` 全部 `200 application/pdf`、无需 Referer）与
  `attach_pages`。派生只认**形状**（`^AP\d{6,}$` 才拼，认不出就不给这个字段）：让模型自己拼链接
  等于把"编一条看起来真的 URL"写进协议，而 `ocr` 这条路没有 `pdf_url` 就只剩偶然搜到的直链。
  代价要认：每条多约 85 字符，挤出的是 `items` 里靠后的几条（`count` / `note` 会如实说）。
- **sseinfo uid 定位有总时限**（`SSE_UID_LOCATE_TIMEOUT_MS` 60s，入参可覆盖）：超时 `TIMEOUT`
  并提示改走全市场问答——**上游慢**与调用方取消是两回事，不得混成一个信封。
- **不新增 DSH 依赖**：抓取器自研（不引 `ctx.web` 等）；解析只用纯 JS `turndown` + gfm 插件。
  因为开关可关，工具 description 与 skill 的回退措辞必须**条件化**（"已启用时自动回退"），
  不得写成无条件承诺。

## 4.3 文档解析面（`ocr`：PDF / 图片 → markdown）

实现在 `src/ocr/`（`client.ts` 上游作业 / `markdown.ts` 排版归一与页索引 / `store.ts` 落盘），
工具定义住在 `src/web-retriever/tools.ts` 的同一份 `definitions` 里（共用检索回执那套
`recent_retrievals` / `provider_tally` 收尾）。上游是 PaddleOCR AIStudio 的**异步 job** API。

- **一个工具四形态**（§9.2 边界归一化，不是一个工具名三个入口）：`url`（公网 `.pdf` 直链，
  上游去取，本机不落字节）/ `file`（workspace 相对路径的本地 pdf 或图片，multipart 上传）/
  `job_id` + `doc_id`（续查，**不重复提交、不重复计费**）/ `doc_id` + `pages` \| `query`
  （纯本地读落盘产物，零出网）。
- **长任务靠声明，不靠后台**：工具自带 `timeoutMs: 240_000`，`dsh-tool-call-timeout-policy`
  据此给 `exec.signal` 挂 deadline；客户端**自有**等待预算 200s（`retriever.paddleOcr.pollBudgetMs`
  可覆盖）必须**小于**声明值，留出不确定返回与写盘的余量。预算耗尽**不是失败**：回
  `{status:'pending', job_id, doc_id}`，模型照 `hint` 再调一次。委派侧无需改造——
  `subagent_web_retriever` 本来就是 `backgroundMode: continuable`（立即返回、结算时收 notice）。
- **产物一律落盘** `capital-data/ocr/<doc_id>/{document.md,meta.json}`（§3 布局），先写正文
  再写 meta ⇒ **meta 的在场即代表完整**；半件产物下次按未缓存重写，不把 `doc_id` 永久锁死。
  `doc_id` 是**内容寻址**的（`sha1(输入 + model + charts)` 前 12 位），同文档二次调用直接回读。
  回执只给 `workspace://` 的 opaque `artifact_ref` 与 `page_entries` 索引，**绝不外泄绝对路径**。
- **`pages` 只影响读，不影响算价**（job 总是整篇跑，上游口径 100 页），这一点必须写在工具
  `description` 里，否则模型以为翻页能省钱。`refresh: true` 才强制重跑——实测同一份 PDF 两次
  给出过 18% 与 19% 的不同数字，**重跑不是独立验证**，引用必须带 `doc_id` 与 `created_at`。
- **回执预算与具名来源同口径**（`SOURCE_OUTPUT_BUDGET_CHARS` 6144）：整篇装得下才给全文，
  超了就只给页索引 + 首页，正文靠 `pages` / `query` 取回。裁剪一律**整项**进整项出，
  绝不给半页、绝不静默截断文档。
- **引擎 flag 只传官方示例证明过的三个键**（`useChartRecognition` 由 `charts` 暴露，其余钉死
  `false`）：未知键在上游被**静默忽略**，`mergeTables` / `prettifyMarkdown` 在 jobs API 上是否
  生效无法证明，所以不拿没验证过的开关换"看起来能配"的假象——表格噪音靠 `markdown.ts`
  自己处理（实测 15 页研报 60% 字符是单元格 `style='…'` 样板，归一化后降到四分之一）。
- **出网仍只有一份实现**（§9.7）：job 提交、轮询、结果 JSONL 全部走扩展后的
  `createHttpRequester`（`HttpRequest.body` 支持 `FormData`、`maxBytes` 可逐请求覆盖），
  本地字节走 `store.readWorkspaceBytes`（上限 `OCR_MAX_SOURCE_BYTES` 32 MiB）。
  `url` 入参必须过同一份 `assertPublicUrlTarget`：私有 / 保留地址与 IP 字面量一律拒——
  本机不能变成"把内网 URL 交给第三方去戳"的通道。
- **不受 `localFetch.enabled` 支配**（与 anysearch / wind 同侧）：那个开关的文案是"允许启动
  本地提取网页内容"，管的是 HTML 回退；把 `ocr` 挂上去等于违背用户同意时划下的边界。
  缺 token 只让调用响亮失败（`NO_CREDENTIAL`，指明卡片位置），工具**无条件注册**——
  少一个 key 就少十四个工具名，会让子 Agent 创建期报错。
- **根侧收敛的例外**：`ocr` **不进** `RETRIEVAL_DENIED_TOOLS`（主 Agent 要能解析用户
  `@xxx.pdf` 推进来的本地文档），改由 `rootOcrGuardReason` 只拒它的 `url` 形态；
  通用 `subagent` 的 `toolFilter.deny` 则连本地形态一起拿掉。名字级 deny 做不到这个区分。
- **密钥**：`PADDLE_OCR_TOKEN` 每次调用现解（credentials 优先、环境变量同名回退，与 Wind 同
  口径），永不出现在回执 / 日志 / 错误串（错误只点名 ref）。
