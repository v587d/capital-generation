# web_retriever 双来源接入设计：Wind 官方文档检索（wind-client）

状态：**已实施**（插件/preset/文档/测试全部落地，`npm test` 111 项全绿）。
剩余为上线验证：真 Key 探针（§10.1）、挂载 inventory 复核（§10.2）、Capital 实测会话（§10.4）。
范围：插件侧 wind-client 适配器与检索工具、web_retriever persona 双来源纪律、toolFilter/AGENTS.md/skill 同步。

---

## 0. 结论速览

1. web_retriever 升级为**双 provider**：`anysearch`（广度：候选发现 + 官方页面核验）与 `wind_docs`（精准度：官方正式文件与权威新闻检索，`public_document` 定位）。
2. 接入方式：插件内**自研 HTTP 适配器**（`src/web-retriever/wind-client.ts`，~100 行、零依赖），直连 Wind 的 JSON-RPC 端点。**不引入 MCP 框架/SDK**，不使用 `dsh-mcp-client` 行，不依赖 Wind CLI。
3. 注册**无条件**（Key 缺失也注册）：toolFilter 名字恒存在，子 Agent 创建永不被 Wind 状态绑架；Wind 故障一律降级为**调用级错误信封**，由 persona 规则驱动 fallback 到 anysearch。
4. 搜索收敛与查重全部为 **persona 软规则**（经验法则按 provider 各自计），工具层只提供结构性支撑：统一信封 + `recent_retrievals` 回声（纯提醒，不拦截）。

## 1. 背景与问题

- web_retriever 是 REPL 式子 Agent，`web_retriever_search` 此前无任何收敛约束，实测会无上限换词搜索。已落地的对策是 persona 内经验法则（一次任务对一个 search_engine_provider 一般 5 次以内收敛；软约束，偶尔超出可接受）。
- 现接入 Wind Alice 的金融文档 MCP 服务（marketplace 商品 `vserver_financial_info`，endpoint 为 `vserver_financial_docs` 域），与 anysearch 在"公告/新闻"上天然重叠，需要边界与查重管理，避免双路重复取材。

## 2. 决策记录（含否决方案与原因）

| 议题 | 决定 | 否决的选项与原因 |
|---|---|---|
| 搜索上限 | persona 软规则（经验法则） | 工具层硬预算（task_id 计数器）：动静大、把软需求做成了硬约束 |
| "一次上级请求"界定 | 不再需要（无硬预算即无需 task_id 锚定） | task_id 协议、`subagent/start` 事件重置 |
| 接入机制 | 插件内适配器（方案 B） | ① `dsh-mcp-client` 原生行（方案 A）：MCP 工具名动态注册，`tools.restrict()` 在子 Agent 创建窗口校验未知名会抛错——Wind 不可用/Key 失效时 **web_retriever 整个角色创建失败**（工具级故障放大为角色级）；② 跑 Wind CLI：需给检索 Agent 开 bash（权限放大）或宿主 exec（外部安装依赖 + CLI 自动更新副作用） |
| 协议 | 手写 JSON-RPC（零依赖 fetch） | MCP 官方 SDK：无必要；端点只接受 JSON-RPC `initialize`/`tools/call`，不存在平铺 REST——但 JSON-RPC 只是线格式，~100 行 HTTP 客户端即可，与 `fuyao-rest.ts`/`engines.ts` 同构 |
| 文件命名 | `wind-client.ts`（`createWindClient`） | `wind-mcp.ts`：名字让人误以为引入了 MCP 框架；线格式说明放文件头注释 |

## 3. 双 provider 边界

| 诉求 | 路径 | 定位 |
|---|---|---|
| 官方正式文件（公告/年报/季报/招股书）与权威新闻**内容** | `wind_docs_announcements` / `wind_docs_news` | **public_document**：官方文档库检索结果，**标注来源即可作为证据使用，不走核验仪式**；义务仅两条——标注"来源：万得 Wind 金融数据服务"+ 披露时间口径 |
| 探索：不知道看什么、发现候选与线索 | `web_retriever_search` | 广度：候选来源，不作证据 |
| 官方页面原文 + 归属核验 | `web_retriever_fetch` | **`verified_official` 唯一授予路径**（逐域名核验仪式只属于此路径，不变） |
| 域外内容：监管政策原文、境外/非上市主体、市场传闻 | anysearch | wind docs 明确不覆盖 |

> 边界原则（源自评审结论）：wind 强调官方正式文件的准确率，无需过度 verify；anysearch 强调来源广度，准确性不保证。web_retriever 同时需要精准度与广度。

## 4. Fallback 设计（矩阵是默认路径，不是禁令）

写入 web_retriever persona：

> - **按诉求选 provider，不按习惯**：官方文件/权威新闻内容优先 wind_docs；探索候选、官方页面核验、域外内容用 anysearch。同一份文件不得两边都取原文；两边都取必须是明说的交叉核验，且一份对一份。
> - **矩阵是首选路径，不是禁令**：前一路径失败、覆盖不足或工具报错时允许切换，但必须说明切换原因；切换后按新 provider 自己的收敛法则计次。
> - **降级（wind → anysearch）**：wind 返回 `AUTH` / `RATE_LIMIT` / 额度类错误信封时**不重试该 provider**，直接转 anysearch（search 发现线索 → fetch 官方披露页）；回传如实标注"wind 不可用/未覆盖，来源为官网抓取"。
> - **升级（anysearch → wind）**：anysearch 多轮探索仍找不到权威原文、或任务明确需要精准文档时，若 wind 可用则转 wind。
> - **切换前先看 `recent_retrievals`**：fallback 最容易把对方已完成的发现流程重跑一遍，先盘点再动手。

## 5. 检索回声：`recent_retrievals` + `provider_tally`（工具层结构支撑，纯提醒不拦截）

- 所有检索类工具（anysearch search/fetch、wind 两工具）的返回统一附加两组回显：
  - `recent_retrievals: [{ provider, tool, query, at }, …]`（最近 8 条流水，含本次）；
  - `provider_tally: { <provider>: 累计次数 }`（按调用方 session 累计、不封顶、字母序）。
- 状态位置：**tools 层闭包**（流水环形缓冲 + 计数表），`exec.agent.session.id` 作 key；内存态、不落盘、随会话消亡。`WebRetriever` 与 wind client 保持无状态。
- 作用：跨 provider 查重从"靠模型记忆"变成"看得见自己搜过什么"；`provider_tally` 让"每 provider 一般 5 次收敛"的经验法则有了可见计数器——模型每次调用都能看到"wind_docs 已用 5"，软法则不再靠心算。
- 实测补充（2026-09）：首轮上线发现模型超 5 次而不自知，根因是只有流水没有计数——`provider_tally` 因此追加，性质与回声一致（提醒不拦截）。

## 6. 实现规格

### 6.1 文件与工具

| 件 | 内容 |
|---|---|
| `src/web-retriever/wind-client.ts`（新） | `createWindClient({ endpoint, resolveApiKey, timeoutMs })`：JSON-RPC over HTTP；`initialize` → `tools/call`（与 CLI 同款最小握手，无 session 态）；SSE/纯 JSON 双形态解析；三层错误解包；网络错误 3 次退避重试（300ms/1s）；`normalizeWindResponse` 裁剪到 20k 字符。文件头注释注明"线格式为 JSON-RPC（MCP 线协议），零依赖，协议蓝本见 `docs/reference/wind-mcp-skill/`" |
| `src/web-retriever/tools.ts` | 注册 `wind_docs_announcements` / `wind_docs_news`；统一信封（两 provider 输出都加 `provider` 字段）；`recent_retrievals` 回声 |
| `src/index.ts` | `RetrieverConfig.windDocs` 配置与装配；Key 解析走 `credentials.resolve(credentialRef)` → env 回退（与 FUYAO/ANYSEARCH 同模式） |

### 6.2 模型工具

- `wind_docs_announcements`：参数 `query`（必填，≤500 字，自然语言检索要求，应含公司实体/公告类型/时间要素）、`top_k`（可选，1~10，默认 5）。
- `wind_docs_news`：同上。
- 上游映射：`get_company_announcements` / `get_financial_news`（契约见上游仓库 `wind-mcp-skill/references/financial-docs.md`，本地参考副本在 `docs/reference/`（不入库）；上游无结构化参数，`query` 即 NL）。

### 6.3 输出信封（与 anysearch 对齐）

```jsonc
// 成功：Wind 返回体原样透传在 data（上游返回结构不是固定 {title,content} 列表，
// 不做臆测性改字段；仅对超长字符串字段做 ≤20k 裁剪，保持结构）。
{ "provider": "wind_docs", "tool": "wind_docs_announcements", "query": "…",
  "ok": true, "data": { /* Wind 解析后的返回体 */ },
  "recent_retrievals": [ … ] }
// 成功但正文非 JSON：原文透传
{ "provider": "wind_docs", "tool": "…", "query": "…", "ok": true,
  "content": "…(≤20k)", "content_chars": 12345, "recent_retrievals": [ … ] }
// 失败（不抛错，错误信封驱动 fallback）
{ "provider": "wind_docs", "tool": "…", "query": "…", "ok": false,
  "error": "…", "code": "AUTH | RATE_LIMIT | NETWORK | BACKEND | INVALID",
  "recent_retrievals": [ … ] }
```

- `code` 语义：`AUTH`=401/Key 缺失；`RATE_LIMIT`=429；`NETWORK`=网络与 5xx；`BACKEND`=接口层错误原文；`INVALID`=响应不可解析。
- anysearch 两工具输出同步加 `provider: "anysearch"` 与 `recent_retrievals`（测试同步更新）。

### 6.4 注册策略与 Key

- **无条件注册**四个检索工具：Key 缺失不跳过注册（区别于 fuyao 数据源的 skip 策略）——保证 toolFilter 名字恒存在，子 Agent 创建与 Wind 状态解耦；无 Key/401 时调用返回 `AUTH` 错误信封，由子 Agent 如实回传。
- Key：DSH credentials `WIND_API_KEY` 优先，环境变量回退。**Key 不进仓库**；评审中经聊天通道出现过的 Key 建议配置后轮换。

### 6.5 超时与上限

- 默认超时 60s（`windDocs.timeoutMs` 可配）。 diverge 自 CLI 的 600s：RAG 检索不应以 10 分钟计，与 anysearch `REQUEST_TIMEOUT_MS` 对齐。
- 内容裁剪 20k 字符，与 `engines.ts` 的 `MAX_CONTENT_CHARS` 一致。

### 6.6 线格式要点（协议蓝本：Wind 官方 CLI `skills/wind-mcp-skill/scripts/cli.mjs`，上游仓库 `github.com/Wind-Alice/AliceMarket`；本地参考副本在 `docs/reference/wind-mcp-skill/`，已 gitignore 不随仓库发布）

1. 请求头：`Authorization: Bearer <key>`、`Accept: application/json, text/event-stream`、`Content-Type: application/json`。
2. `initialize`（protocolVersion `2025-03-26`）→ `tools/call`；不发 `notifications/initialized`、不复用 session（照抄 CLI 已验证行为）。
3. 响应可能为 SSE 或纯 JSON：取最后一个 `data:` 行解析。
4. 三层错误解包：`payload.error` → `result.isError`（`content[0].text`）→ `content[0].text` 内层 JSON 的 `mcp_tool_error_code` / `error{}` / `data.code`。
5. 实施期用真 Key 实测"跳过 `initialize` 直接 `tools/call`"：可行则省一次往返；不可行保留（多一次 POST，无状态）。**实施时保留了 initialize**（无 Key 环境无法实测跳过；待 §10.1 真 Key 探针时顺带验证）。

## 7. 配置（`agent.cordis.yml` → `capital-generation.config.retriever`）

```yaml
retriever:
  baseURL: ''            # anysearch（现状不变）
  credentialRef: ANYSEARCH_API_KEY
  windDocs:
    endpoint: 'https://mcp.wind.com.cn/vserver_financial_docs/mcp/'
    credentialRef: WIND_API_KEY
    timeoutMs: 60000
```

## 8. preset 与文档同步改动

| 位置 | 改动 |
|---|---|
| web_retriever 行 `toolFilter.allow` | += `wind_docs_announcements`、`wind_docs_news`（稳定名，测试 deepEqual 同步） |
| web_retriever persona | §3 边界矩阵 + §4 fallback 规则 + 积分纪律（Wind 检索消耗积分，按需少量调用）+ 启动自检扩展（wind 工具调用报 `AUTH`/额度类错误时如实回传，不重试不假装） |
| 主 persona | 禁直连清单补"以及 wind_docs 系列"（外部检索一律经子 Agent，规则不变、清单点名） |
| skill `capital-orchestration` | §7 异常分支：子 Agent 回传 wind `AUTH`/额度类失败 → 主 Agent 如实告知用户 Wind 能力暂不可用，本轮材料改由 anysearch 承担；**不重试 Wind、不换 Key** |
| `AGENTS.md` | web_retriever 纪律节：public_document 边界（wind 结果标注来源即用、核验仪式仅属 fetch 路径）+ 双 provider 收敛与 fallback 摘要 |

## 9. 测试计划

| 文件 | 断言 |
|---|---|
| `test/wind-client.test.mjs`（新） | 请求体形态（JSON-RPC envelope、Bearer 头）；SSE 与纯 JSON 双解析；三层错误解包各分支；401/429/5xx → code 映射；3 次退避；超时；20k 裁剪 |
| `test/web-retriever-tools.test.mjs` | 四工具注册齐全；wind 工具参数校验（query 必填 ≤500、top_k 1~10）；统一信封含 provider；`recent_retrievals` 跨工具累计、按调用方 session 隔离、上限 8；**Key 缺失仍注册**；wind 调用失败返回 ok:false 错误信封而非抛错 |
| `test/persona.test.mjs` | toolFilter deepEqual 更新（6 项）；persona 新要点：public_document、来源标注、fallback 三规则、积分纪律、`recent_retrievals` 盘点 |

## 10. 验证清单（实施完成后）

1. 配置 `WIND_API_KEY` 后实测一次真实 `get_company_announcements` 调用，核对信封与来源标注；顺手实测"跳过 initialize"（§6.6.5）。
2. 挂载验证：`compositionInventory()` 全部 active；`standingKeyFor('capital-generation')` 成功。
3. `npm test` 全绿。
4. 开 Capital 会话实测：web_retriever 工具表含 6 项；一次双 provider 混合任务（wind 取公告 + anysearch 官网核验）观察路由、fallback 与回传分组；断 Key 场景观察 `AUTH` 信封 → 降级 anysearch 的行为。

## 11. 风险与后续演进

- **Key 生命周期**：额度用尽/过期表现为 `AUTH`/额度类信封，链路自动降级 anysearch，仅损失精准度不损失可用性——这是 B 方案的核心收益，勿回退。
- **工具清单漂移**：我们按名直连上游两个工具，Wind 若改名即失败（错误信封可见）。变更频率低（契约发布制）；届时改 `wind-client.ts` 一处映射。
- **扩展域**：stock/fund/index/bond/economic/analytics 六域属结构化数据，未来接入走 **data_collector 的 hub source 体系**（`fuyao-rest` 模式），不进 web_retriever——路由表按诉求分流，web_retriever 保持"文档与网页材料"定位。
- **REST 化**：Wind 将来若提供平铺 REST/OpenAPI，仅替换 `wind-client.ts` 内部实现，工具名/信封/persona 全部不动。
