# SPEC: `data_collector` 子 Agent

> Capital Generation（Capital 模式）第一个子 Agent。  
> 本文档是实现契约，供后续 coding agent 直接按此落地。  
> 版本：Phase 1（2026-09）

> [!NOTICE]
> 1. 官方指的是 DSH 官方框架能力
---

## 1. 目标与非目标

### 1.1 目标

`data_collector` 是会话内的 **数据提取执行器**：

1. 接收主 Agent 通过官方 `send_message` 发来的数据请求。
2. 按 FIFO 串行执行：优先查内存缓存 → 未命中则调用自身挂载的数据获取能力（API / MCP / Skill）。
3. 结果写回共享缓存，并通过官方 `send_message` 把结构化回传给请求方。
4. 实时维护并暴露「当前最新数据 + schema」，供其他 Agent 查询（只读 `get_latest` / `list_schemas`）。

官方默认数据源：同花顺（fuyao.aicubes.cn REST + MCP）。  
社区可贡献其他数据源，通过各自独立的 `input_schema` 接入，**不做统一适配层**。

### 1.2 非目标（Phase 1 明确不做）

- 不使用 SQLite 或任何持久化存储（纯内存）。
- 不做多数据源字段映射 / 适配层。
- 不支持 out-of-process 子 Agent 共享本进程内存状态。
- 不索取、不存储账户密码、API Key、验证码等凭据（API Key 由运行环境注入，见 §6）。
- 不输出未经模型或回测支持的胜率、概率或收益承诺。
- 不提供自动下单能力。
- 不实现多并发执行（仅串行）。
- **不自研消息协议**：不做自定义广播、不做订阅表、没有 request_id（请求/回传以
  data_key + params 标识与对应，结果由 `request_data` 阻塞式直接返回）——
  不存在对账状态机。
  通信只依赖官方 dsh-subagent 原语（Inbox、`send_message`、结算通知、`agent/disposed`）。

---

## 2. 架构位置（DSH / Cordis）

```
Host plane
├── ctx.agents / ctx.subagents   ← 官方：live Agent 注册表、continuable 子 Agent、send_message
├── ctx.dataCollectorHub          ← 本插件注册的共享服务（队列 + 缓存 + 数据源目录 + 请求状态）
├── ctx.tools / MCP / skills      ← 数据获取能力挂载点
└── ...

Agent plane（每会话）
├── Main Agent（Capital 模式，persona = preset 的 dsh-persona 行）
└── data_collector（continuable 子 Agent，经 preset 的 subagent_data_collector
    专用委派行创建；persona/toolFilter 由该行 config 注入，主 Agent 不复制模板）
        ├── 持有 / 驱动 dataCollectorHub
        ├── 暴露模型可见 tools（request_data / get_latest / list_schemas）
        └── 通过官方 send_message 与主 Agent 通信
```

- **共享状态**必须放在 `ctx.dataCollectorHub`（preset 的 `capital-generation-scope`
  isolate realm 内注册），不能放在某个 Agent 的闭包里。
- in-process 的主 Agent 与所有子 Agent 共享同一份 Hub 实例。
- `data_collector` 以 **continuable** 子 Agent 形态存在，便于长期接收 `send_message` 并持续服务。
- **消息层不重复造轮子**：Hub 不持有 Agent 引用、不维护通知发送者、不做任何投递。
  回传由 `data_collector` 模型自己调用官方 `send_message` 完成。

### 2.1 拓扑决策记录（2026-09）

- **消息图 = Agent 树**：官方 `sendMessage` 只允许相邻两层通信（直接父 / 直接 continuable 子），跨层必须沿树逐层中继。
- **单一父约束**：每个 continuable 子 Agent 有且只有一个直接 parent，不存在「多父共享同一个 child」的官方形态。
- **支持混合拓扑**：子 Agent 可按职责和依赖关系灵活挂载。数据消费类子 Agent（依赖 Hub 数据）建议创建为 `data_collector` 的直接子（1 父 → N 子，官方允许），结果沿树逐层上送；独立子 Agent（如网页研究、新闻监控、量化分析）可直接挂在主 Agent 之下。主 Agent 负责用户级最终调度与跨子 Agent 的任务编排。
- **多点消费不依赖血缘**：数据与缓存登记在共享 Hub（data_key + 参数变体），任何 Agent 都能用只读工具读共享缓存；写路径经 data_collector 统一入口（职责分工，非运行时强制——请求归属恒为调用者自身）。血缘只决定消息投递路径（相邻直发，不相邻经公共祖先转发），**不存在订阅与广播**：新需求 = 新消息，回传即唤醒。
- **工具层无邻接权限逻辑**：`request_data` 等工具的请求归属由官方 `exec.agent` 注入（恒为调用者），不接收 `requester_agent_id` / `target_agent_id` 参数，也没有「代理请求」概念。工具可见性不是权限隔离；真正的边界是官方原语本身（`send_message` 的 exact live sender + 相邻校验 + cold resume）。
> 工具层不负责校验调用者身份，只做事。消息层由官方负责，校验身份和相邻关系（拒绝跨级请求）。权限层由官方负责，由`toolFilter`控制工具可见性。

---

## 3. 核心服务：`ctx.dataCollectorHub`

### 3.1 接口（实现契约）

```ts
interface DataCollectorHub {
  /** 入队并阻塞等待执行完成；成功返回 CacheEntry，失败抛错。 */
  request(req: DataRequest, options?: { signal?: AbortSignal }): Promise<CacheEntry>

  /** 查询缓存中的最新数据；params 存在时精确匹配参数组合 */
  getLatest(dataKey: string, params?: Record<string, unknown>): CacheEntry | null

  /** 列出当前可用数据源 schema（来自已挂载的 API/MCP/Skill） */
  listSchemas(): SchemaDescriptor[]

  /** 注册一个数据源；返回 disposer */
  registerSource(source: DataSource): () => void
}

interface DataRequest {
  data_key: string            // 规范身份证键，见 §4（必须来自 list_schemas，模型不造句）
  source_preference?: string[] // 可选过滤：具体 schema.name 最优先；provider 令牌（如 "fuyao.api"、"ths" 兼容别名）；"any" = 仅按 data_key 匹配
  params: Record<string, unknown>  // 透传给具体数据源 tool 的参数（对象维度：代码/日期/周期等）
  force_refresh?: boolean     // 默认 false
  requester_agent_id: string  // 请求归属；由工具层以官方 exec.agent.id 注入，不接受模型传参
  schema_hint?: object        // 可选，期望结构提示
}

interface CacheEntry {
  data_key: string
  data: unknown
  schema: object | null       // 尽量带上返回结构描述
  source: string              // 实际使用的 tool / mcp 名，如 "get_a_share_prices_snapshot"
  from_cache: boolean
  updated_at: number          // ms
  expires_at: number          // ms
}

interface SchemaDescriptor {
  name: string                // tool / mcp tool 名
  source: string              // "api:fuyao" | "mcp:..." | "skill:..." | "api:..."
  data_key: string            // 规范身份证：provider.kind.resource（斜杠/冒号→点），注册时由 buildDataKey 生成，全注册表唯一
  ttl_ms?: number             // 该源缓存存活时长声明；缺省用 Hub 默认 TTL
  input_schema: object
  output_schema?: object
  description?: string
}
```

> **Hub 的非职责（曾走过的弯路，见 §12 避坑清单）**：不提供 `subscribe`/
> `unsubscribe`/通知回调（不做任何 Agent 投递）、不提供 `cancel`（取消走官方
> `interrupt_agent`）、不维护 Agent 生命周期与身份（归官方 `ctx.agents`）。

### 3.2 执行策略（Phase 1）

- **严格串行 FIFO**：同一时刻只执行一个请求。
- 相同 `data_key` + 相同 `params`（深比较或稳定 hash）的并发请求可合并：只执行一次，结果回传给所有等待者（每个等待者各自拿到自己的 Promise 结算）。
- 队列最大长度：默认 `50`。超过时 `request()` 直接抛错（不入队）。
- 单请求执行超时：默认 `30_000` ms。超时抛错（错误文本 `request timed out`），由调用方（data_collector）如实回传 `failed`。

### 3.3 缓存与回收（简单方案）

- 结构：`Map<string, CacheEntry>`，key = `data_key + ":" + stableHash(params)`。
- **TTL（声明式）**：写入时设置 `expires_at = now + ttl`，取值为
  `source.schema.ttl_ms`（数据源注册时声明）→ 未声明则 `options.ttlFor(dataKey)`
  → 兜底 `defaultTtlMs`（默认 `300_000`）。**不再按 data_key 字符串里的
  snapshot/valuations 子串猜分类**（编造键下必然失效的教训）。
  fuyao 四源声明：快照/检索 `60_000`，历史 K / 交易日历 `300_000`。
- **最大条目数**：默认 `500`。超过时删除 `updated_at` 最旧的条目。
- **懒清理**：在 `getLatest` / 写入时顺带删除已过期条目。不强制后台定时器。
- **无请求状态表**：阻塞式 `request()` 直接用 Promise 结算，不存在请求记录表，
  也就没有无界增长问题（队列本身有 `maxQueueLength` 上限）。

---

## 4. `data_key` 约定（规范身份证键）

`data_key` 是**数据源端点的规范身份证**，不是模型造句的逻辑键。它由数据源注册
代码生成（`buildDataKey(provider, kind, resource)`，见 §3.1），任何 Agent 从
`list_schemas` 抄写使用，**不自行拼接/编造**。

格式：

```
<provider>.<kind>.<resource>
```

- `<provider>`：数据提供方，如 `fuyao`、`alice`；
- `<kind>`：接入方式，如 `api` / `mcp` / `skill`；
- `<resource>`：端点路径（REST）或 MCP 工具名。**斜杠 `/` 与冒号 `:` 一律
  规范化映射为 `.`**（连续分隔符合并、去首尾点），保证任何平台都能直接当
  文件名/路径段使用。

Phase 1 已注册身份证（fuyao REST）：

| 规范 data_key | 端点（原始路径）| 含义 | ttl_ms |
|---|---|---|---|
| `fuyao.api.api.meta.tickers.search` | `/api/meta/tickers/search` | 标的检索消歧 | （未挂载，挂载后生成） |
| `fuyao.api.api.a-share.prices.snapshot` | `/api/a-share/prices/snapshot` | A 股行情快照 | （未挂载，挂载后生成） |
| `fuyao.api.api.a-share.prices.historical` | `/api/a-share/prices/historical` | 历史日 K | （未挂载，挂载后生成） |
| `fuyao.api.api.a-share.calendar.trading-days` | `/api/a-share/calendar/trading-days` | 交易日历 | （未挂载，挂载后生成） |

说明：

- **对象维度（标的代码、日期、周期等）进 `params`，不进 data_key**——data_key
  只标识"哪个端点"，同一端点的不同标的共享同一把钥匙，缓存按
  `data_key + stableHash(params)` 命中。
- 主 Agent 的委派消息**不带 data_key**（只带需求描述与 params）；由
  data_collector 用 `list_schemas` 选端点并抄写规范键，回传时把 data_key
  原样带回，主 Agent 记录后可用于 `get_latest` 复用或转派其他 Agent 复核。
- **路由**：`request_data` 的 data_key 与已注册身份证**精确相等**匹配；
  匹配不到立即报错（"no data source for ..."），不存在静默不命中的灰色状态。
  `registerSource` 校验身份证全注册表唯一（撞键即注册失败）。
- **稳定性要求**：data_key 是固定的注册表常量，**不要追加 `.latest` 等变体
  后缀**（变体键 = 新缓存槽，缓存永远命中不了）；需要最新值用
  `force_refresh: true` 即可。
- **每条委派请求的端点上限**（引导/硬性）：data_collector 按需求选端点，
  通常 1 个、最多 3 个（引导），硬性不超过 5 个；与需求无关的端点一律不调用。

---

## 5. 官方通信（只用 DSH 原语，不自研协议）

### 5.1 请求进入方式

1. **`send_message`** 到 `data_collector` 的 agent_id，消息体为结构化 JSON 文本（见 §5.3）。
2. 模型可见 tool：`request_data`（内部调用 `hub.request`，**阻塞等待执行完成**：
   缓存命中立即返回，执行超时/失败抛错）——请求归属恒为当前调用 Agent，由官方
   `exec.agent` 注入；`data_collector` 处理委派时用它，其他 Agent 未经委派纪律
   不应直接用它。

### 5.2 回传

- `data_collector` 完成提取后，用官方工具 `send_message` 把载荷发给请求方
  （通常是直接父级 = 主 Agent）。官方 Inbox 负责消息持久化与唤醒：请求方
  在下一个 step/turn 边界收到消息；continuable 子 Agent 结束还有官方结算通知
  自动唤醒父 Agent。
- **不存在 Hub 自动投递**：Hub 不持有 Agent 引用，也不发送任何消息。
- 失败同样通过 `send_message` 回传 `status: "failed"` 载荷；`error` 直接来自
  `request_data` 的报错（执行超时 / 无可用数据源 / 数据源错误 / 参数错误等），
  没有独立的状态查询通道——回传即结果。

### 5.3 消息载荷（send_message 载荷建议；这是数据请求/回传格式约定，不是消息路由协议）

**请求（主 Agent → data_collector，不带 data_key；data_key 由 dc 选端点后从 list_schemas 抄写）**

```json
{
  "type": "data_request",
  "description": "贵州茅台最新行情快照",
  "source_preference": ["get_a_share_prices_snapshot", "any"],
  "params": { "thscodes": "600519.SH" },
  "force_refresh": false
}
```

**完成回传（data_collector → 主 Agent；data_key 为 request_data 返回的规范身份证）**

```json
{
  "type": "data_updated",
  "data_key": "fuyao.api.api.a-share.prices.snapshot",
  "status": "completed",
  "source": "get_a_share_prices_snapshot",
  "from_cache": false,
  "data": { ... },
  "schema": { ... },
  "updated_at": 1725532800000,
  "expires_at": 1725532860000
}
```

失败时 `status: "failed"`，带 `error` 字段，无 `data`。

> **不存在 request_id**：请求与回传以 `data_key`（+params）标识与对应，载荷里的
> data/schema/source/from_cache/updated_at/expires_at 取自 `request_data` 的返回
> （按原样填入，不改写）；data_key 必须与 `list_schemas` 返回的规范键一致，
> 主 Agent 记录后可据其 `get_latest` 复用或转派复核；唤醒由官方结算通知 /
> Inbox 保证，回传即结果。

### 5.4 发现与生命周期（官方语义）

- `data_collector` 由主 Agent 经 `subagent_data_collector` 工具**直接创建**
  （背景默认，continuable），创建时记住官方返回的 durable `subagentId`；
  官方在子 Agent 结算时自动给主 Agent 推送结算通知，**不需要创建前检查，
  也不需要轮询**。
- 官方 `list_agents` 是**回忆工具**（工具描述原文：*"Use it to recall which
  ones you started, not to poll for completion"*），只在会话恢复后不确定时
  使用；返回 `running / idle / ready` 三态，`ready` 表示子 Agent 仅存在于
  持久化存储——`send_message` 到 `ready` 目标会自动冷恢复。
- 因此恢复的会话**首查 `list_agents` 可能非空**：「必返回为空」不是可依赖的
  断言；有则 send_message 复用（冷恢复自动发生），无则创建。

---

## 6. 数据获取能力（Tools / MCP / Skill）

### 6.1 原则

- 每个数据源能力使用**自己的 `input_schema`**，不做统一字段适配。
- Hub 按 `data_key` 与源声明的规范身份证**精确匹配**路由（注册时身份证唯一，
  见 §4）；`source_preference` 只做过滤：具体 `schema.name` 优先级最高，
  provider 令牌（如 `fuyao.api`，`ths` 为兼容别名）次之，`any` 表示仅按
  data_key 匹配。无匹配或候选不唯一时必须失败，不能静默调用任何源。
- 鉴权：Fuyao API Key 仅通过命名凭据 `FUYAO_API_KEY` 或 DSH credentials 注入，**禁止**使用泛化的 `API_KEY`，也禁止在对话中索取或回显完整 Key。

### 6.2 官方同花顺能力映射（Phase 1 优先挂载）

来源：[同花顺金融数据 API](https://fuyao.aicubes.cn/docs/)（REST + MCP 同源）。

| 类别 | 代表 MCP Tool / 能力 | 典型 params | 规范 data_key（挂载后按 §4 规则生成） |
|------|----------------------|-------------|-------------------|
| 行情快照 | `get_a_share_prices_snapshot` | `thscodes` | fuyao.api.api.a-share.prices.snapshot |
| 历史 K 线 | `get_a_share_prices_historical` | `thscode`, 周期等 | fuyao.api.api.a-share.prices.historical |
| 交易日历 | `get_a_share_calendar_trading_days` | （无或少参） | fuyao.api.api.a-share.calendar.trading-days |
| 除复权 | `get_a_share_corporate_actions_adjustment_factors` | `thscode` | （未挂载，挂载后生成） |
| 利润表 | `get_a_share_financials_income_statements` | `thscode` + 期数/区间 | （未挂载，挂载后生成） |
| 资产负债表 | `get_a_share_financials_balance_sheets` | 同上 | （未挂载，挂载后生成） |
| 现金流量表 | `get_a_share_financials_cash_flow_statements` | 同上 | （未挂载，挂载后生成） |
| 财务指标 | `get_a_share_financials_indicators` | `thscode` + 报告期 | （未挂载，挂载后生成） |
| 指数快照 | `get_a_share_index_prices_snapshot` | `thscodes` | （未挂载，挂载后生成） |
| 指数历史 K | `get_a_share_index_prices_historical` | `thscode` 等 | （未挂载，挂载后生成） |
| 指数目录 | `get_a_share_index_catalog_ths_index_list` | `tag` | （未挂载，挂载后生成） |
| 指数成分 | `get_a_share_index_constituents_ths_stock_list` | `thscode` | （未挂载，挂载后生成） |
| 涨停池 | `get_a_share_special_data_limit_up_pool` | 交易日 | （未挂载，挂载后生成） |
| 跌停池 | `get_a_share_special_data_limit_down_pool` | 交易日 | （未挂载，挂载后生成） |
| 炸板池 | `get_a_share_special_data_limit_break_pool` | 交易日 | （未挂载，挂载后生成） |
| 连板天梯 | `get_a_share_special_data_limit_up_ladder` | — | （未挂载，挂载后生成） |
| 热股榜 | `get_a_share_special_data_hot_stock_list` | — | （未挂载，挂载后生成） |
| 龙虎榜 | `get_a_share_special_data_dragon_tiger_list` | 交易日等 | （未挂载，挂载后生成） |
| 标的检索 | `get_meta_tickers_search` | 名称/代码片段 | fuyao.api.api.meta.tickers.search |
| 估值快照 | `get_a_share_valuations_snapshot` | `thscodes` | （未挂载，挂载后生成） |

Phase 1 实现时可先挂载 **行情快照 + 历史 K 线 + 标的检索 + 交易日历** 四类，其余按需扩展。  
MCP 与 REST 语义一致；优先走 MCP 工具挂载（官方 `@deepseek-ai/dsh-mcp-client`），若环境仅有 REST 则封装为 Cordis tool，`input_schema` 与官方文档对齐。

### 6.3 社区扩展

新增数据源 = 新增 tool / MCP server / Skill，并在 preset 中挂载到 Capital 会话作用域。  
`listSchemas()` 自动反映当前挂载集合。无需改 Hub 核心逻辑。

---

## 7. 模型可见 Tools（data_collector 对外）

| Tool 名 | 作用 | 备注 |
|---------|------|------|
| `request_data` | 请求数据并阻塞等待执行完成（缓存命中立即返回） | 内部 → `hub.request`，返回 CacheEntry，失败抛错（error 文本）；**data_key 必须取自 `list_schemas` 的规范身份证，不自行造句**；**请求归属恒为调用者（官方 exec.agent），不接受 requester_agent_id**；不存在 request_id 与状态查询 |
| `get_latest` | 查缓存最新数据 | → `hub.getLatest`；data_key 为规范身份证，可传 params 精确匹配缓存变体；只读，任何 Agent 可用 |
| `list_schemas` | 列出可用数据源 schema（含规范 data_key、可选 ttl_ms） | → `hub.listSchemas`；只读，任何 Agent 可用 |
| `dc_status` | 诊断（凭据 present/source、已注册源、最近注册错误） | 注入 diagnostics 时注册；不泄露密钥值 |

所有 tool 的 `input_schema` 必须完整、自描述，便于其他 Agent 直接调用。

> **挂载边界（当前实现）**：本节工具注册在 Capital 会话组作用域，主 Agent
> 也可能看见；数据请求经 data_collector 委派是职责分工（单一数据执行点、
> 统一缓存纪律），不是运行时强制。工具层不做任何 Agent 邻接校验——工具本就
> 是共享会话内的通用能力，边界由官方原语（send_message 的 exact live sender +
> 相邻校验）与 persona 委派纪律共同构成。子 Agent 侧的可见集已由 preset 的
> `subagent_data_collector` 行 `toolFilter.allow` 收敛（send_message + 数据工具）。

---

## 8. Persona 承载与要点（官方装配）

提示文本**不在插件代码中**，全部由 preset 承载：

- **主控人设**：preset 的 `@deepseek-ai/dsh-persona` 行（`deployment:persona` 节，
  order 0，支持官方 `{{model}}`/`{{cwd}}` 变量）。插件的 `customPersona` 配置只
  追加独立节 `capital:user-customization`（order 100，长度上限 8000，末尾追加
  不可覆盖的英文 SAFETY REMINDER）；该节不占用 `deployment:persona` 名，因此
  `agent.cordis.yml` 中**必须**保留 `@deepseek-ai/dsh-persona` 行。
- **data_collector 人设**：preset 的 `subagent_data_collector` 专用委派行
  （`@deepseek-ai/dsh-tool-subagent`）的 `config.persona`。官方 dsh-subagent 在
  创建/冷恢复子 Agent 时把它注册为子 Agent 作用域的 `deployment:persona` 节
  （最近 scope 胜出，覆盖主 Agent 人设），并把父 Agent id 注入初始 prompt；
  主 Agent 创建时**不复制模板**，prompt 只写委托上下文。
- **data_collector 工具边界**：`config.toolFilter.allow` 与继承的 preset 工具集
  求交集，收敛为 `send_message` + `request_data`/`get_latest`/
  `list_schemas`/`dc_status`。子 Agent 是叶子执行器。

data_collector 人设必须包含的要点：

- 你是 Capital 模式的 **数据收集执行器** 子 Agent，不是分析师或下单员。
- 职责：接收数据请求 → 按需求挑选相关端点（通常 1 个、最多 3 个，硬性
  不超过 5 个）→ 串行提取 → 缓存 → 用官方 `send_message` 回传结果。
- 只使用已挂载的 API / MCP / Skill **及其规范的 data_key**（抄写自
  `list_schemas`，不编造键名），不编造数据；失败时明确返回错误。
- 不索取凭据，不输出收益承诺，不自动下单。
- 优先使用缓存；`force_refresh` 时才强制拉源。
- 与主 Agent 通信使用结构化 JSON 载荷（见 §5.3）；主 Agent 的委派消息不带
  data_key（由你选端点并带回规范 data_key）；没有订阅、没有 requester_agent_id
  ——请求归属恒为调用者自身。

自定义用户 persona（`customPersona`）只能影响表达风格与呈现，不能覆盖上述安全、
职责、权限、数据溯源和工具边界；实现还必须在其后追加不可覆盖的安全提醒，并限制文本长度。

---

## 9. 安全边界（与 Capital 模式一致）

- 自定义 persona 是附加文本，不替换核心安全约束。
- 不索取或保存账户密码、API key、验证码等凭据。
- 不输出未经实际模型或回测支持的胜率、概率或收益承诺。
- 不提供自动下单能力。
- 回传内容默认仅含公开行情与基本面类数据。

---

## 10. Phase 1 验收标准

1. `ctx.dataCollectorHub` 已注册，in-process 多 Agent 共享同一实例。
2. 请求经 `request_data`（阻塞式）或 `send_message` 委派后，严格 FIFO 串行执行；
   `request_data` 等待执行完成，缓存命中立即返回。
3. 缓存命中时不调用外部数据源，并正确设置 `from_cache: true`。
4. 回传通过官方 `send_message` 送达：data_collector 完成提取后向直接父级发送
   结构化载荷；Hub 自身不做任何 Agent 投递。
5. TTL + 最大条目数回收生效，无内存无界增长；TTL 取自数据源 `ttl_ms` 声明，
   不依赖 data_key 字符串猜测。
6. 至少打通同花顺「行情快照」与「标的检索」两条路径（MCP 或 REST tool）。
7. 失败路径返回明确 `error`，不幻觉填充数据；执行超时（默认 30s）抛错
   `request timed out`。
8. 不引入 SQLite 或任何磁盘持久化。
9. 工具层不接收 `requester_agent_id` / `target_agent_id`，不依赖任何非官方
   Agent 字段（如 `parentId` / `directAgentIds`）；请求归属只来自 `exec.agent`。
10. 不存在 `request_id`：`request_data` 不接受、不返回任何请求 id，也没有状态
    查询工具/状态表——结果要么直接返回，要么抛错。
11. data_key 为规范身份证：`request_data` 的 data_key 必须与 `list_schemas`
    返回的某个已注册键精确相等（伪造键报 "no data source"），注册表内
    身份证唯一（重复注册报错）；TTL 与路由都不再依赖键名猜测。
12. 委派消息不带 data_key：主 Agent 只传描述 + params；data_collector 按需求
    选端点，一条委派请求的端点用量通常 1 个、最多 3 个（引导）、硬性不超过
    5 个（人设纪律，Hub 不计数）。

---

## 11. 后续 Phase（本 SPEC 不实现，仅记录）

- Phase 2：可选接入官方 `@deepseek-ai/dsh-storage-sqlite` 做缓存/队列快照。
- Phase 2：按数据源有限并发、更完善的请求合并。
- Phase 3：社区数据源（东财、万得等）通过 schema 接入；官方 MCP client 接入
  同花顺 MCP（替换自研 `sources/fuyao-rest.ts`）；分析型子 Agent 模板（数据
  消费端）沉淀；数据工具在主 Agent 侧的 per-agent `agent.ctx` 可见性收紧
  （官方 per-agent 注册路径，见 §12 第 3/7 条）。

---

## 12. 失败经验与禁入区（给未来自己与 AI 的避坑清单）

> 下面是本项目真实走过的弯路。**禁止**回到这些做法；每条给出「当时做法 →
> 为什么错 → 官方正确姿势」。

| # | 曾经的做法（已删除）| 为什么错 | 官方正确姿势 |
|---|---|---|---|
| 1 | 自研「消息总线」：Hub 持订阅表、按 data_key 自动向"请求方+订阅者"广播 `data_updated`；notifier 维护私有 Agent 注册表 + "代理请求"启发式识别发送者 | 与官方 Inbox/sendMessage/结算通知重复；运行期踩 exact-live-sender 边界，只能靠"由主 Agent 协调转发"等 plan-B 文案兜底；约 700 行代码最终全删 | 通信只用官方原语；回传 = 子 Agent 模型的一次 `send_message`；唤醒 = 官方结算通知 |
| 2 | 工具层自研「邻接权限」：`requester_agent_id`/`target_agent_id` 参数 + `isAuthorizedTarget` 依赖非官方字段 `parentId`/`directAgentIds` | 权限在真实运行时对子 Agent 方向静默失效（字段不存在）；测试用自己拼的 fake exec，**测的是假契约** | 请求归属只用官方 `exec.agent.id`（模型伪造不了）；权限校验归官方服务层（exact live sender + 相邻校验 + cold resume）|
| 3 | 用 persona 纪律冒充权限：要求主 Agent"必须遵守委派纪律、不直接调用数据工具"，工具层却人人可见 | Prompt 约束不是权限；工具可见性不等于权限隔离（SPEC 自己都写了这句话）| 边界 = 官方原语 + `toolFilter.allow`（子 Agent 白名单）+ 职责分工；如需主 Agent 不可见，走 per-agent `agent.ctx` 注册 |
| 4 | 人设写进插件代码，并占用官方 `deployment:persona` 节名 | 与官方 `@deepseek-ai/dsh-persona` 行重复注册冲突（README 只能写"别加 persona 行"的告警——这是症状不是设计）| 人设进 preset 声明式行；自定义/附加文本用独立节名（如 `capital:user-customization`）|
| 5 | 让主 Agent 模型把 DATA_COLLECTOR_PERSONA **长模板复制进 prompt** 创建子 Agent | 模型可能截断/改写，子 Agent 人设漂移 | 官方 `config.persona` 在子 Agent 作用域注入（descriptor 持久化，冷恢复一致）|
| 6 | "首次必查 `list_agents` 且**必返回为空**，再创建" | 官方无此要求；恢复的会话首查可能返回 `ready`（仅存于持久化）——必空断言是假的 | 直接创建 + 记住官方返回的 `subagentId`；`list_agents` 只用于回忆（官方：recall, not poll），有则 send_message 复用（自动冷恢复）|
| 7 | 用**猜测的 Agent 结构**写实现与测试（`parentId`/`directAgentIds`、fake `ctx.subagents`）| 测试绿 ≠ 运行时真；官方契约变了就静默失效 | 以官方类型/服务为唯一真相：`exec.agent`、`ctx.agents`、`session.header.parentSession`、`ctx.subagents.sendMessage` 签名 |
| 8 | 兼容 facade 层堆积（`src/` 根目录放 2 行转发文件）| 增加理解成本、误导读者 | 直接改引用，不留转发层 |
| 9 | 仓库卫生缺失：`lib/`、`node_modules/`、`SPEC.md:Zone.Identifier` 与源码混放、无 git | 无法追溯、打包污染 | `git init` + `.gitignore`（`lib/`、`node_modules/`、`*.tgz`、`*.log`、`*.Zone.Identifier`）|
| 10 | （行为教训，非代码）模型为"最新"请求使用 `force_refresh` + **每次新 `data_key` 变体**（`.latest`）| 变体键 = 新缓存槽，缓存永远不命中，Hub 缓存价值归零 | persona / 协议要求稳定 `data_key`；要最新值用 `force_refresh: true`（见 §4）|
| 11 | （行为教训，非代码）让**主 Agent 造句 data_key**（真实会话产物如 `guide_needle_realtime_20260907`，还为此在主↔子之间反复 send_message 对键） | 主 Agent 无数据领域知识 → 编造键 → 路由匹配不到、缓存键与任何端点无关、按键名猜的 TTL 分类全部失效 | data_key 由数据源注册代码生成（规范身份证，provider.kind.resource），`list_schemas` 展示、dc 抄写；主 Agent 委派只传描述 + params，回传再记录身份证（见 §4/§5.3）|

**总原则**：官方已有原语的地方不重造（消息、权限、生命周期、persona 注入、
工具注册）；自研只保留领域价值（缓存/去重/路由/输出契约）与数据源接入层。

---

## 13. 参考

- `ARCHITECTURE.md`（仓库根目录）：官方 vs 自研完整划分、源码出处行号、Mermaid 图
- Capital Generation README（仓库根目录）
- DSH subagent：`ctx.subagents`、`send_message`、`list_agents`、`interrupt_agent`、
  `startContinuable`（官方实现见 `@deepseek-ai/dsh-subagent/lib/index.js`）
- 同花顺文档：https://fuyao.aicubes.cn/docs/  
  聚合：https://fuyao.aicubes.cn/llms.txt 、 https://fuyao.aicubes.cn/llms-full.txt
- DSH storage-sqlite（Phase 1 不用）：`@deepseek-ai/dsh-storage-sqlite`