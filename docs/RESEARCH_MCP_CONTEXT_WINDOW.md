# MCP 上下文窗口优化研究 (Research Brief)

> 2026-08-15 | 提出: 用户 (DSH 会话实测) | 状态: **待研究** — 本文只陈述事实与假设,
> 不下结论; 预计缩减量等数字均为假设, 未经实验验证, 一律不得引用为事实。
> 用途: 供独立研究 agent 开展专项调研; 结论产出后回写 PLAN-0.3.0.md §9.2。
> 所属仓库: capital-generation (DSH 金融数据 MCP 插件, 11 个 `fin_data__*` 工具)。

## 1. 背景 (Background)

capital-generation 以 MCP 形式向 DSH 会话中的 LLM 提供金融数据工具。LLM 每轮对话
都会携带工具注册面 (工具列表/schema/描述) 与历史工具结果, 两者共同消耗上下文窗口。
用户实测: **两轮对话 10 个 steps 消耗 5 万+ tokens**, 其中 tool result 近 4 万、
tool schema 近 1 万。上下文窗口是 DSH 会话的硬资源: 占用过高 → 会话变短、成本上升、
LLM 对关键信息的注意力被稀释、长任务中途被迫压缩/截断。

本研究的目的是:**在"工具 schema 冻结"与"降级可观测"两条红线之内**, 找到可验证的
token 优化手段, 并给出精确测量方法 (不能用字符数粗估代替真实 tokenizer 测量)。

## 2. 问题分解 (为什么消耗大)

token 消耗分三个独立层面, 应分开研究:

| 层面 | 构成 | 特性 |
|---|---|---|
| A. 工具注册面 | 11 个工具的 name + description + 参数 schema + server instructions | 每轮注入 (是否每轮? 待验证) |
| B. 工具结果 | 每次 call_tool 返回的 JSON (rows/全文/字段) | 一次调用体积大, 且留在历史中 |
| C. 会话累积 | 多轮 × (A + B) | 线性放大 |

每个层面内部还有子问题: schema 结构冗余 (title/重复字段)? 结果字段冗余
(逐行重复公共字段)? 数据本身大 (公告全文/K线大窗口)? 协议层重复 (MCP 传输包装)?

## 3. 证据 (Evidence)

> 测量方法声明: 以下 token 数为**字符粗估** (中文字符=1 token, 其他字符/4),
> 用于发现量级差异; 精确数字必须用真实 tokenizer (如 tiktoken cl100k_base /
> DSH 所用模型的 tokenizer) 复测。原始复测方法见 §8。

**事实 (已实测, 2026-08-15, 本仓库当前代码)**:

1. **工具注册面**: 11 工具 schema+description 合计 ≈ 1373 tokens/轮 (粗估)。
   明细: search_symbols 103 / get_quote 90 / get_klines 151 / get_financials 115 /
   get_calendar 29 / get_special_data 140 / get_announcements 111 / get_edb 119 /
   reconcile 161 / get_fund_data 192 / get_index_data 162。
   其中 description 占比约 1/3 (合计 ~450), schema 约 2/3。
2. **Kline 结果**: 30 根日K ≈ 3165 tokens (12,363 字符), 即 **~100 tokens/根**。
   单根 Kline 渲染含 symbol/date_ms/open/high/low/close/volume/turnover/currency/
   period/adjust/source/tier/degraded/extra 全字段 — 其中 symbol/currency/period/
   adjust/source/tier/degraded 在批内逐根重复。按此量级外推: 1 年日K ≈ 2.5 万,
   **10 年窗口 ≈ 24 万 (单次调用即可打爆上下文)**。
3. **announcements 结果**: content 为公告全文逐字透传。600519 单条 8,466 字符
   ≈ 2100 tokens; top_k=10 全量可达 2-4 万 tokens。对照: 300803 同期 5 条仅 131
   字符 — **全文长度因标的面差异极大** (公告内容天然长短不一)。
4. **用户侧实测**: 两轮 10 steps ≈ 5 万+ tokens (DSH 会话统计, tool result ≈ 4 万,
   tool schema ≈ 1 万)。

**假设 (未验证, 待研究确认)**:

- H1: DSH 每轮对话都完整注入 11 个工具面 (→ 10 steps 工具面 ≈ 1.4 万, 与用户感知吻合)
- H2: DSH/推理服务端存在 KV-cache 或上下文压缩, 工具面前缀是否命中缓存未知
- H3: schema 中 FastMCP 自动生成的 title (与参数名重复) 等冗余占比可观
- H4: 其他工具结果 (financials NL 多表 / special 榜单 50 行 / EDB observation=100 /
  reconcile 报告行 / 分钟线 240 行/日) 的体积画像未测, 可能是隐藏大头
- H5: "渲染压缩/描述精简可省 X%" 的一切具体数字 — **均为推测, 无实验依据**

## 4. 目的 (Objectives)

我们希望达到的目的 (按优先级, 均需可度量):

1. **减少重复**: 工具注册面能否缓存/静态化, 避免每轮全量注入 (研究 DSH 机制与协议层能力)
2. **减少冗余**: 结果渲染去重 (公共字段外提/列式), schema 去冗余 (title 等)
3. **减少不必要**: description/instructions 精简为行动指令; 工具描述引导 LLM 避免
   大窗口/大 top_k 调用 (如 get_klines 明示"窗口 ≤1 年", announcements 明示 top_k 影响)
4. **边界可控**: 对天然巨大的结果 (公告全文/长K线) 做截断+标注, 但不降低可用性
5. **建立度量**: 一套可复现的 token 测量方法 (真实 tokenizer), 每次改动前后对比,
   防止回归

**红线 (不可违反)**:
- 工具名与参数 schema 冻结 (AGENTS.md 硬规则; DSH KV-cache 前缀稳定性依赖) —
  优化只减字数/减结构冗余, 不改参数名、不改语义
- 降级可观测 (docs/DEGRADATION.md): 任何截断必须显式标注, 禁止静默丢数据
- 数据质量不降: 截断不得影响关键字段 (价格/日期/标识); 全文类内容保留 url 兜底

## 5. 可对比/类比方向 (Directions)

供研究参考的方向 (每个方向给出对比对象与问题):

1. **MCP 生态实践**: 官方 mcp SDK 的 FastMCP schema 生成机制 (title 冗余可否关闭?);
   社区知名 MCP server (参考实现) 如何控制 description 长度与工具数量;
   MCP 协议是否有 ListTools 缓存/增量能力 (协议版本演进)
2. **LLM 工具生态**: OpenAI function calling / Anthropic tool use 官方文档对
   schema 精简与描述写作的建议 (它们如何量化工具面成本); 工具数量 vs 质量的权衡研究
3. **金融数据插件对照**: OpenBB (标准化输出 + 分页/大结果策略)、ccxt (数百交易所
   工具爆炸的教训: 动态生成 vs 静态面)、Tushare/万得原生 (结果体积 vs 可用性取舍)
4. **渲染格式**: JSON vs 紧凑表格/CSV vs 列式数组的 token 效率实测对比;
   公共字段外提 (表头/元数据一次) 的收益; 浮点精度截断 (保留 2-4 位小数) 的收益
5. **上下文压缩技术**: 学术/工程上的 prompt 蒸馏、KV-cache 压缩、上下文摘要
   (LLMLingua 等) 在 tool 调用场景的适用性; DSH 自身是否提供会话压缩/rollup
6. **缓存可能性** (独立小节, 见 §6)

## 6. 缓存可能性 (Caching)

需要专门研究的问题清单:

1. **DSH 侧工具面缓存**: DSH 每轮是否注入完整工具列表? 是否依赖 KV-cache 前缀命中
   (这正是工具 schema 冻结的初衷 — AGENTS.md)? 前缀稳定时 KV-cache 命中率如何?
   DSH 是否有会话级压缩/rollup 机制? 这些信息决定了"工具面成本"是否真实存在
2. **推理服务端 KV-cache**: DSH 所用模型服务的 KV cache 实现 (自动前缀缓存?),
   工具 schema 冻结对前缀命中的实际收益 — 可向 DSH 开发侧求证或实测
3. **MCP 协议层**: ListTools 结果是否可被 DSH 静态化 (工具面冻结时列表是静态的);
   initialize 握手信息量
4. **结果层缓存 (已有)**: 路由层已实现结果缓存 (快照 30s / K线当日 TTL, LRU) —
   但 LLM 通常不会重复相同参数调用, 缓存对 LLM 场景的实际命中率低; 是否需要
   面向 LLM 的结果摘要缓存 (同一数据源的紧凑版) — 属研究方向而非结论
5. **跨会话**: 工具面静态 JSON 预生成供 DSH 引用是否可行 (取决于 DSH 的 MCP client 机制)

## 7. 研究问题清单 (Research Questions)

1. DSH 每轮实际注入工具面的 token 数? 有无缓存/压缩? 精确测量方法 (DSH 侧可观测性)?
2. 本仓库工具面 token 的精确构成 (用真实 tokenizer): title 冗余占比 / description 占比 /
   instructions 占比; FastMCP 可配置项能否去除 title
3. 全部 11 工具 × 典型调用的 result token 画像 (含 kline 大窗口、minutes、announcements
   长文、financials NL 多表、special 榜单、EDB、reconcile、fund/index) — 找出真正的大头
4. 渲染压缩方案设计与实测: 列式/表头外提/紧凑数组/浮点截断 各自的 token 收益与
   对 LLM 可读性的影响 (需真实 tokenizer + LLM 理解度测试)
5. 截断边界: announcements content 截断长度阈值、标注格式、url 兜底的可用性验证;
   K线窗口引导 (工具描述措辞) 对 LLM 调用行为的实际影响
6. KV-cache 前缀稳定约束下 schema 精简的可行空间 (减字不减结构的量化边界)
7. 其他 MCP 生态的实践基线 (哪个知名 server 的工具面 token 最小? 怎么做?)

## 8. 相关代码位置与复测方法 (Entry Points)

代码:
- `servers/mcp_data.py` — 11 工具注册 (FastMCP @mcp.tool)、`render_envelope` 结果渲染、
  `instructions` 长文本
- `core/domain/models.py` — Kline/Quote/Announcement 等模型字段 (渲染体积来源)
- `core/domain/routing.py` — 结果缓存 (Cache TTL/LRU)
- `config/` — chains/error_map/reconcile 等
- `docs/DEGRADATION.md` — 降级可观测红线; `AGENTS.md` — schema 冻结红线

复测方法 (当前粗估的来源, 可改进):
1. stdio 起 server: `uv run python -m servers.mcp_data`
2. `ClientSession.list_tools()` → 序列化 name/description/inputSchema → 字符统计
3. 真实调用 `call_tool(...)` → `res.content[0].text` → 字符统计
4. 精确化: 用真实 tokenizer (tiktoken cl100k_base 或 DSH 实际模型 tokenizer) 替换粗估;
   记录每工具每调用类型的 token 基线, 供后续改动前后 diff

## 9. 已知事实边界与禁忌

- 本文 §3"事实"是 2026-08-15 单日单机测量, 量级可信, 精确值需复测
- §3"假设"与任何"预计缩减 X%"一律不得作为决策依据, 必须实验验证
- 不引入第三方依赖来"猜"token (tokenizer 要与 DSH 实际模型一致才有意义)
- 不破坏: 工具 schema 冻结、降级可观测、数据质量、DSH KV-cache 前缀稳定性
