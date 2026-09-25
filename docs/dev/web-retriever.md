# web_retriever 纪律

> 索引见仓库根 `AGENTS.md` §4。改 `src/web-retriever/`、`src/net/` 或九个具名来源之前读这里。
> §编号沿用 `AGENTS.md` 的全局命名空间。

## 4.1 工作面与分工

- **模型侧纪律不在本文**（同一份规则抄三处迟早失真）：硬规则在主 / 子 persona，细则在 skill
  `capital-web-protocol`——两者都由 `test/persona.test.mjs` 断言（体积上限 + 要点逐条 pattern：
  搜索摘要只是候选、`verified_official` 授予条件、Wind 三要素、5 次收敛、回传引用、双向
  fallback、官方域名核验清单）。本节只留**维护者结构事实**。
- **两类工作面**：**检索** = `anysearch_search` / `wind_docs_*` / `web_retriever_fetch`；
  **来源查询** = 九个具名工具（`cls_telegraph` / `wscn_lives` / `cninfo_irm` / `sseinfo_qa` /
  `eastmoney_724` / `eastmoney_stock_news` / `eastmoney_reports` / `sina_reports` /
  `ths_eps_forecast`）——全部公开端点、零 key、本机直连出网。实现 `src/web-retriever/sources.ts`，
  验收记录 `docs/design/web-retriever-source-expansion.md`。**新增来源只改一处名单**
  （`RETRIEVAL_DENIED_TOOLS`，§8.4 → `preset-persona.md`）就要进这九个的注册面。

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
- **sseinfo uid 定位有总时限**（`SSE_UID_LOCATE_TIMEOUT_MS` 60s，入参可覆盖）：超时 `TIMEOUT`
  并提示改走全市场问答——**上游慢**与调用方取消是两回事，不得混成一个信封。
- **不新增 DSH 依赖**：抓取器自研（不引 `ctx.web` 等）；解析只用纯 JS `turndown` + gfm 插件。
  因为开关可关，工具 description 与 skill 的回退措辞必须**条件化**（"已启用时自动回退"），
  不得写成无条件承诺。
