# SPEC: `data_collector` 子 Agent

> Capital Generation（Capital 模式）第一个子 Agent。  
> 本文档是实现契约，供后续 coding agent 直接按此落地。  
> 版本：Phase 1（2026-09，M1+M2 重构后）

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
- **不自研消息协议**：不做自定义广播、不做订阅表、不做 request_id 对账状态机。
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
        ├── 暴露模型可见 tools（request_data / get_request_status / get_latest / list_schemas）
        └── 通过官方 send_message 与主 Agent 通信
```

- **共享状态**必须放在 `ctx.dataCollectorHub`（preset 的 `capital-generation-scope`
  isolate realm 内注册），不能放在某个 Agent 的闭包里。
- in-process 的主 Agent 与所有子 Agent 共享同一份 Hub 实例。
- `data_collector` 以 **continuable** 子 Agent 形态存在，便于长期接收 `send_message` 并持续服务。
- **消息层不重复造轮子**：Hub 不持有 Agent 引用、不维护通知发送者、不做任何投递。
  回传由 `data_collector` 模型自己调用官方 `send_message` 完成。

### 2.1 拓扑决策记录（方案 A，2026-09 与用户确认，M1 修订）

- **消息图 = Agent 树**：官方 `sendMessage` 只允许相邻两层通信（直接父 / 直接 continuable 子），跨层必须沿树逐层中继。
- **单一父约束**：每个 continuable 子 Agent 有且只有一个直接 parent，不存在「多父共享同一个 child」的官方形态。
- **因此采用方案 A（树形执行器）**：`data_collector` 挂主 Agent 之下，未来的数据消费/分析子 Agent 均创建为 `data_collector` 的直接子（1 父 → N 子，官方允许）；需上报的结果沿树逐层上送。主 Agent 只做用户级最终调度，不做数据搬移。
- **多点消费不依赖血缘**：数据与缓存登记在共享 Hub（data_key + 参数变体），任何 Agent 都能用只读工具读共享缓存；写路径经 data_collector 统一入口（职责分工，非运行时强制——请求归属恒为调用者自身）。血缘只决定消息投递路径（相邻直发，不相邻经公共祖先转发），**不存在订阅与广播**：新需求 = 新消息，回传即唤醒。
- **工具层无邻接权限逻辑**：`request_data` 等工具的请求归属由官方 `exec.agent` 注入（恒为调用者），不接收 `requester_agent_id` / `target_agent_id` 参数，也没有「代理请求」概念。工具可见性不是权限隔离；真正的边界是官方原语本身（`send_message` 的 exact live sender + 相邻校验 + cold resume）。

---

## 3. 核心服务：`ctx.dataCollectorHub`

### 3.1 接口（实现契约）

```ts
interface DataCollectorHub {
  /** 入队。立即返回，不阻塞执行。 */
  enqueue(req: DataRequest): EnqueueResult

  /** 查询单个请求状态 */
  getStatus(requestId: string): RequestStatus | null

  /** 查询缓存中的最新数据；params 存在时精确匹配参数组合 */
  getLatest(dataKey: string, params?: Record<string, unknown>): CacheEntry | null

  /** 列出当前可用数据源 schema（来自已挂载的 API/MCP/Skill） */
  listSchemas(): SchemaDescriptor[]

  /** 注册一个数据源；返回 disposer */
  registerSource(source: DataSource): () => void
}

interface DataRequest {
  request_id: string          // 调用方生成，建议 uuid
  data_key: string            // 逻辑键，见 §4
  source_preference?: string[] // 优先具体 schema.name，如 ["get_a_share_prices_snapshot", "any"]；默认按 data_key 路由
  params: Record<string, unknown>  // 透传给具体数据源 tool 的参数
  force_refresh?: boolean     // 默认 false
  requester_agent_id: string  // 请求归属；由工具层以官方 exec.agent.id 注入，不接受模型传参
  schema_hint?: object        // 可选，期望结构提示
}

interface EnqueueResult {
  request_id: string
  status: "enqueued"
  position: number            // 当前队列中的位置（0 = 下一个执行）
}

type RequestStatus =
  | { status: "enqueued"; position: number }
  | { status: "running"; started_at: number }
  | { status: "completed"; result: CacheEntry; duration_ms: number }
  | { status: "failed"; error: string; duration_ms?: number }

interface CacheEntry {
  data_key: string
  data: unknown
  schema: object | null       // 尽量带上返回结构描述
  source: string              // 实际使用的 tool / mcp 名，如 "get_a_share_prices_snapshot"
  from_cache: boolean
  updated_at: number          // ms
  expires_at: number          // ms
  request_id?: string
}

interface SchemaDescriptor {
  name: string                // tool / mcp tool 名
  source: string              // "ths" | "mcp:..." | "skill:..." | "api:..."
  input_schema: object
  output_schema?: object
  data_key_patterns?: string[] // 末尾 * 表示前缀匹配
  description?: string
}
```

> M1 删除项：`subscribe` / `unsubscribe` / 通知回调（Hub 不再做任何 Agent 投递）、
> `cancel`（取消走官方 `interrupt_agent`）、`cleanupAgent` / collector 身份登记
> （Agent 生命周期归官方 registry，不再由 Hub 维护）。

### 3.2 执行策略（Phase 1）

- **严格串行 FIFO**：同一时刻只执行一个请求。
- 相同 `data_key` + 相同 `params`（深比较或稳定 hash）的并发请求可合并：只执行一次，结果状态回传给所有等待的 `request_id`。
- 队列最大长度：默认 `50`。超过时 `enqueue` 直接返回失败（不入队）。
- 单请求超时：默认 `30_000` ms。超时标记 `failed`（状态可经 `get_request_status` 查询）。

### 3.3 缓存与回收（简单方案）

- 结构：`Map<string, CacheEntry>`，key = `data_key + ":" + stableHash(params)`。
- **TTL**：写入时设置 `expires_at = now + ttl_ms`。  
  默认 TTL：
  - 行情快照类：`60_000` ms
  - 历史 K 线 / 财务等：`300_000` ms
  - 可通过配置覆盖。
- **最大条目数**：默认 `500`。超过时删除 `updated_at` 最旧的条目。
- **懒清理**：在 `getLatest` / 写入时顺带删除已过期条目。不强制后台定时器。
- 请求状态表带 `maxRequestRecords` 上限（默认 1000），只淘汰已结算记录，防无界增长。

---

## 4. `data_key` 约定

逻辑键，用于缓存与订阅，建议格式：

```
<universe>.<category>.<identity>[.<qualifier>]
```

示例：

| data_key | 含义 |
|----------|------|
| `a-share.prices.snapshot.600519.SH` | 贵州茅台快照 |
| `a-share.prices.historical.600519.SH.day` | 茅台日 K |
| `a-share.financials.income.600519.SH` | 茅台利润表 |
| `a-share.special.limit-up-pool.20260905` | 某日涨停池 |
| `meta.tickers.search.茅台` | 标的检索 |

调用方应尽量稳定、可复用。Hub 不强制校验格式，只做字符串键。

---

## 5. 官方通信（只用 DSH 原语，不自研协议）

### 5.1 请求进入方式

优先顺序：

1. **`send_message`** 到 `data_collector` 的 agent_id，消息体为结构化 JSON 文本（见 §5.3）。
2. 模型可见 tool：`request_data`（内部调用 `hub.enqueue`）——请求归属恒为
   当前调用 Agent，由官方 `exec.agent` 注入；`data_collector` 处理委派时用它，
   其他 Agent 未经委派纪律不应直接用它。

### 5.2 回传

- `data_collector` 完成提取后，用官方工具 `send_message` 把载荷发给请求方
  （通常是直接父级 = 主 Agent）。官方 Inbox 负责消息持久化与唤醒：请求方
  在下一个 step/turn 边界收到消息；continuable 子 Agent 结束还有官方结算通知
  自动唤醒父 Agent。
- **不存在 Hub 自动投递**：Hub 不持有 Agent 引用，也不发送任何消息。
- 失败同样通过 `send_message` 回传 `status: "failed"` 载荷；`get_request_status`
  可查询原始执行状态（含 error）。

### 5.3 消息载荷（send_message 载荷建议；这是数据请求/回传格式约定，不是消息路由协议）

**请求（主 Agent → data_collector）**

```json
{
  "type": "data_request",
  "data_key": "a-share.prices.snapshot.600519.SH",
  "source_preference": ["get_a_share_prices_snapshot", "any"],
  "params": { "thscodes": "600519.SH" },
  "force_refresh": false
}
```

**完成回传（data_collector → 主 Agent）**

```json
{
  "type": "data_updated",
  "request_id": "uuid（collector 入队时保存的 request_id，便于引用）",
  "data_key": "a-share.prices.snapshot.600519.SH",
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

> request_id 仅作回传引用与状态查询，**不构成对账状态机**：唤醒由官方结算
> 通知 / Inbox 保证，request_id 不是投递凭证。

### 5.4 发现与生命周期（官方语义，M3 对齐）

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
- Hub 默认按 `data_key` 与 source schema 的 `data_key_patterns` 做确定性路由；`source_preference` 中的具体 `schema.name` 优先级最高，provider（如 `api:fuyao`，`ths` 为兼容别名）只用于过滤候选。候选不唯一或无匹配时必须失败，不能静默调用第一个注册源。
- 鉴权：Fuyao API Key 仅通过命名凭据 `FUYAO_API_KEY` 或 DSH credentials 注入，**禁止**使用泛化的 `API_KEY`，也禁止在对话中索取或回显完整 Key。

### 6.2 官方同花顺能力映射（Phase 1 优先挂载）

来源：[同花顺金融数据 API](https://fuyao.aicubes.cn/docs/)（REST + MCP 同源）。

| 类别 | 代表 MCP Tool / 能力 | 典型 params | 建议 data_key 模式 |
|------|----------------------|-------------|-------------------|
| 行情快照 | `get_a_share_prices_snapshot` | `thscodes` | `a-share.prices.snapshot.<code>` |
| 历史 K 线 | `get_a_share_prices_historical` | `thscode`, 周期等 | `a-share.prices.historical.<code>.<period>` |
| 交易日历 | `get_a_share_calendar_trading_days` | （无或少参） | `a-share.calendar.trading_days` |
| 除复权 | `get_a_share_corporate_actions_adjustment_factors` | `thscode` | `a-share.corporate_actions.<code>` |
| 利润表 | `get_a_share_financials_income_statements` | `thscode` + 期数/区间 | `a-share.financials.income.<code>` |
| 资产负债表 | `get_a_share_financials_balance_sheets` | 同上 | `a-share.financials.balance.<code>` |
| 现金流量表 | `get_a_share_financials_cash_flow_statements` | 同上 | `a-share.financials.cashflow.<code>` |
| 财务指标 | `get_a_share_financials_indicators` | `thscode` + 报告期 | `a-share.financials.indicators.<code>` |
| 指数快照 | `get_a_share_index_prices_snapshot` | `thscodes` | `a-share.index.snapshot.<code>` |
| 指数历史 K | `get_a_share_index_prices_historical` | `thscode` 等 | `a-share.index.historical.<code>.<period>` |
| 指数目录 | `get_a_share_index_catalog_ths_index_list` | `tag` | `a-share.index.catalog.<tag>` |
| 指数成分 | `get_a_share_index_constituents_ths_stock_list` | `thscode` | `a-share.index.constituents.<code>` |
| 涨停池 | `get_a_share_special_data_limit_up_pool` | 交易日 | `a-share.special.limit_up_pool.<date>` |
| 跌停池 | `get_a_share_special_data_limit_down_pool` | 交易日 | `a-share.special.limit_down_pool.<date>` |
| 炸板池 | `get_a_share_special_data_limit_break_pool` | 交易日 | `a-share.special.limit_break_pool.<date>` |
| 连板天梯 | `get_a_share_special_data_limit_up_ladder` | — | `a-share.special.limit_up_ladder` |
| 热股榜 | `get_a_share_special_data_hot_stock_list` | — | `a-share.special.hot_stock_list` |
| 龙虎榜 | `get_a_share_special_data_dragon_tiger_list` | 交易日等 | `a-share.special.dragon_tiger.<date>` |
| 标的检索 | `get_meta_tickers_search` | 名称/代码片段 | `meta.tickers.search.<query>` |
| 估值快照 | `get_a_share_valuations_snapshot` | `thscodes` | `a-share.valuations.snapshot.<codes>` |

Phase 1 实现时可先挂载 **行情快照 + 历史 K 线 + 标的检索 + 交易日历** 四类，其余按需扩展。  
MCP 与 REST 语义一致；优先走 MCP 工具挂载（官方 `@deepseek-ai/dsh-mcp-client`），若环境仅有 REST 则封装为 Cordis tool，`input_schema` 与官方文档对齐。

### 6.3 社区扩展

新增数据源 = 新增 tool / MCP server / Skill，并在 preset 中挂载到 Capital 会话作用域。  
`listSchemas()` 自动反映当前挂载集合。无需改 Hub 核心逻辑。

---

## 7. 模型可见 Tools（data_collector 对外）

| Tool 名 | 作用 | 备注 |
|---------|------|------|
| `request_data` | 入队提取请求 | 内部 → `hub.enqueue`，返回 `EnqueueResult`；**请求归属恒为调用者（官方 exec.agent），不接受 requester_agent_id** |
| `get_request_status` | 查请求状态 | → `hub.getStatus` |
| `get_latest` | 查缓存最新数据 | → `hub.getLatest`；可传 params 精确匹配缓存变体；只读，任何 Agent 可用 |
| `list_schemas` | 列出可用数据源 schema | → `hub.listSchemas`；只读，任何 Agent 可用 |
| `dc_status` | 诊断（凭据 present/source、已注册源、最近注册错误） | 注入 diagnostics 时注册；不泄露密钥值 |

所有 tool 的 `input_schema` 必须完整、自描述，便于其他 Agent 直接调用。

> **挂载边界（当前实现）**：DSH 当前版本将本节工具注册在 Capital 会话组作用域，
> 主 Agent 也可能看见；数据请求经 data_collector 委派是职责分工（单一数据执行点、
> 统一缓存纪律），不是运行时强制。工具层不做任何 Agent 邻接校验——工具本就是
> 共享会话内的通用能力，边界由官方原语（send_message 的 exact live sender + 相邻
> 校验）与 persona 委派纪律共同构成。子 Agent 侧的可见集已由 preset 的
> `subagent_data_collector` 行 `toolFilter.allow` 收敛（send_message + 数据工具）；
> 主 Agent 侧的可见范围如需进一步收紧，留给 per-agent `agent.ctx` 注册（官方
> dsh-tools 支持的 per-agent 变体路径），不作为本 SPEC Phase 1 强制项。

---

## 8. Persona 承载与要点（M2 后的官方装配）

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
  求交集，收敛为 `send_message` + `request_data`/`get_request_status`/
  `get_latest`/`list_schemas`/`dc_status`。子 Agent 是叶子执行器。

data_collector 人设必须包含的要点：

- 你是 Capital 模式的 **数据收集执行器** 子 Agent，不是分析师或下单员。
- 职责：接收数据请求 → 排队串行提取 → 缓存 → 用官方 `send_message` 回传结果。
- 只使用已挂载的 API / MCP / Skill，不编造数据；失败时明确返回错误。
- 不索取凭据，不输出收益承诺，不自动下单。
- 优先使用缓存；`force_refresh` 时才强制拉源。
- 与主 Agent 通信使用结构化 JSON 载荷（见 §5.3）；没有订阅、没有 requester_agent_id
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
2. 请求经 `request_data` 或 `send_message` 进入后，严格 FIFO 串行执行。
3. 缓存命中时不调用外部数据源，并正确设置 `from_cache: true`。
4. 回传通过官方 `send_message` 送达：data_collector 完成提取后向直接父级发送
   结构化载荷；Hub 自身不做任何 Agent 投递。
5. TTL + 最大条目数回收生效，无内存无界增长。
6. 至少打通同花顺「行情快照」与「标的检索」两条路径（MCP 或 REST tool）。
7. 失败路径返回明确 `error`，不幻觉填充数据。
8. 不引入 SQLite 或任何磁盘持久化。
9. 工具层不接收 `requester_agent_id` / `target_agent_id`，不依赖任何非官方
   Agent 字段（如 `parentId` / `directAgentIds`）；请求归属只来自 `exec.agent`。

---

## 11. 后续 Phase（本 SPEC 不实现，仅记录）

- Phase 2：可选接入官方 `@deepseek-ai/dsh-storage-sqlite` 做缓存/队列快照。
- Phase 2：按数据源有限并发、更完善的请求合并。
- Phase 3：社区数据源（东财、万得等）通过 schema 接入；官方 MCP client 接入
  同花顺 MCP；分析型子 Agent 模板（数据消费端）沉淀；数据工具在主 Agent 侧
  的 per-agent `agent.ctx` 可见性收紧（官方 per-agent 注册路径）。

---

## 12. 参考

- Capital Generation README（仓库根目录）
- DSH subagent：`ctx.subagents`、`send_message`、`list_agents`、`interrupt_agent`、
  `startContinuable`（官方实现见 `@deepseek-ai/dsh-subagent/lib/index.js`）
- 同花顺文档：https://fuyao.aicubes.cn/docs/  
  聚合：https://fuyao.aicubes.cn/llms.txt 、 https://fuyao.aicubes.cn/llms-full.txt
- DSH storage-sqlite（Phase 1 不用）：`@deepseek-ai/dsh-storage-sqlite`