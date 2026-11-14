# 能力目录容量：10,000 是否可行，以及九分片方案

> 2026-11-14。回答两个问题：① 6144 能否抬到 10000，DSH 宿主是否允许；② 若不该抬，目录怎么拆。
> **状态：已落地（2026-11-14）**——九主题分片、索引、taxonomy、skill 与测试已同步；`thresholdChars` 未动。
>
> **结论先行**：
> - **6144 不是 DSH 上限**，是本仓 `test/data-collector-hub.test.mjs` 的 CI 护栏；宿主唯一按字符数的
>   真实上限是 preset 自己挂的 `dsh-compaction-tool-result-pruner`，当前 `thresholdChars: 8192`。
> - **宿主允许抬到 10000**：`thresholdChars` 的 schema 只有 `min(1)`、没有 max，10000 能通过校验。
>   但**不能只把 6144 改成 10000**——那会让测试放行、宿主在压缩时把目录中段剪掉。
> - 若目录护栏要到 10000，pruner 至少要 **13334**（保持 25% 余量）；这是六个 preset 一起改、
>   全角色共用、还会同步放宽 skill 可见预算的动作，代价远大于收益。
> - **现在不需要抬**：143 条 / ≈5901 码点仍在 6144 内；把 15 条新能力的 summary 写到 ≤35 码点，
>   P2 可落在 ≈5750，低于 5800 重谈线。
> - 若长期要过 150 条，用**九个主题分片**：每片当前最大 1182 码点，10,000 总量下最大约 2006，
>   离 8192 很远。分片把"单条结果上限"与"能力总数"解耦，不需要改宿主配置。

---

## 1. 先把四道线分开

| 线 | 数值 | 性质 | 住在哪 |
|---|---:|---|---|
| 目录 CI 护栏 | 6144 码点 | **测试断言**，生产路径不检查；8192 的 75% | `test/data-collector-hub.test.mjs` |
| 宿主剪枝阈值 | 8192 码点 | **唯一按字符数的真实上限**；按**单条 tool result** 计，压缩触发后才回溯剪枝 | preset 的 `dsh-compaction-tool-result-pruner` |
| 单能力详情护栏 | 4096 码点 | **测试断言**；与目录预算独立 | 同测试文件 |
| spill 阈值 | 12500 token | 宿主 `dsh-spill-policy` 的逐条结果上限；超限把全文写文件、只回 head/tail + 路径 | 宿主 `dsh-base`，本项目未另配 |

两条必须记住的事实：

1. `list_capabilities` 返回的是**一条 tool result**。pruner 按条判断，不按会话总长判断。
   所以"一条 9000"和"九条各 1000"在宿主眼里完全不同：前者会被剪，后者不会。
2. 6144 是"永远不给它可切的机会"的自约束，不是"请求发不出去"的硬限制。越过 6144 只是越出自约束；
   真正被剪是在**单条结果越过 8192、且压缩触发之后**——这正是要避免的失败形态。

---

## 2. DSH 宿主到底允许什么

### 2.1 语法上：允许 10000

`@deepseek-ai/dsh-compaction-tool-result-pruner` 的 Config 是：

```ts
thresholdChars: z.number().step(1).min(1)   // 没有 max
headChars: z.number().step(1).min(0)
tailChars: z.number().step(1).min(0)
```

构造时只校验两件事：三个值是非负整数；`headChars + marker + tailChars ≤ thresholdChars`。
当前 marker 是 39 码点，`4096 + 39 + 1024 = 5159`，所以 `thresholdChars: 10000` 是合法配置。
宿主不会因为 10000 拒绝启动，也没有第二道按字符数的硬闸门。

但 preset 里不是一行，是**六个 preset 各一行**（root / collector / junior / specialist / retriever / analyst）。
项目文档记录该阈值是 instance-wide 的单一值、不能按 Agent 区分；改就要六处一起改，并补一条
"六处必须相等"的断言——现在没有这条断言。

### 2.2 设计上：只改 6144 是不允许的

| 目录护栏 | pruner 阈值 | 余量 | 结果 |
|---:|---:|---:|---|
| 6144 | 8192 | 2048（25%） | 现状，正确 |
| **10000** | **8192** | **−1808** | **禁止**：测试放行，宿主剪回，中间能力静默消失 |
| 7500 | 10000 | 2500（25%） | 等价于"把阈值抬到 10000"，但护栏不是 10000 |
| 10000 | 13334 | 3334（25%） | 真正的"护栏 10000"，六处 + 全角色 + skill 预算一起动 |

若目标只是"目录能到 10000 而不被剪"，正确的最小改动是 **pruner 10000 / 护栏 7500**，
不是"护栏 10000 / pruner 8192"。后者是把测试从"提前拦"改成"事后追认"，与本仓
`测试先失败而不是运行时静默截断` 的纪律相反。

### 2.3 抬到 10000 的真实代价

1. **六处同改**：root / collector / junior / specialist / retriever / analyst 各一行；
   少改一处，行为取决于哪一行最后生效，属于不可预测的配置漂移。
2. **全角色共用**：pruner 不认工具名，也没有按 Agent 豁免的口子。抬了之后，`data_junior`
   的宽表查询结果、`web_retriever` 的正文、所有 skill 加载都一起变宽。
   目录本身只对 `capital-data-collector` 开放（`DATA_COLLECTION_PRESET_IDS`），
   所以 10,000 的直接读取成本是**每个 collector 任务一次**；但抬阈值付的是全角色的账。
3. **skill 可见预算同步放宽**：`test/preset-rows.mjs` 的 `loadBudget()` 直接拿
   `thresholdChars - 512` 当 `visibleChars`；抬到 13334，persona / selected-skills 的
   "单册必须完整可见"上限就从 7680 变成 12822。这是隐藏耦合，不是只影响目录。
4. **剪枝的减压作用变弱**：pruner 的价值是"压缩触发时先丢掉不重要的中段，可能因此不用摘要"。
   阈值越高，它越晚介入，compaction 越可能直接摘要整段历史——目录反而更早被摘要掉。
5. **只多买约 95 条**：按当前均摊 40.8 码点/条，10000 约 245 条；6144 约 150 条。
   本次路线图终点 143 条，150 已经够；10000 买的是"以后可能用得上"的余量，不是当前缺口。
6. **详情 4096 不受影响**：目录抬到 10000，单能力详情仍是 4096。宽表（SEC filings、
   global kline、event calendar）该压还得压，分片/抬阈值都不解决。

---

## 3. 容量账：现在到底差多少

### 3.1 当前构成

| 指标 | 实测 |
|---|---:|
| 已注册 capability | 128 |
| 目录总码点 | 5226 |
| 名字 | 2388（45.7%） |
| 摘要 | 2327（44.5%） |
| 分隔符与换行 | 511（9.8%） |
| 均摊 | 40.8 码点/条 |

6144 / 40.8 ≈ **150 条**；10000 / 40.8 ≈ **245 条**。
P2 终点 143 条 / ≈5901 码点 = 6144 的 96.0%，**仍在护栏内，但只剩约 6 条的余量**。

### 3.2 P2 可以不出线

15 条 collector 新能力（3 个 web 来源不占目录）按 45 码点/条约 +675；按 35 码点/条约 +525。

- 若新能力 summary 写到 ≤35：`5226 + 525 ≈ 5751`，低于 5800 重谈线。
- 再把现有最长的 5 条 summary 各压 5 码点：约 5726。
- 若整体均摊压到 35：143 条约 5005，相当于多出约 25 条的余量。

所以 **P2 不需要抬阈值，也不需要分片**；先把新能力的 summary 写短，是最便宜的一步。

### 3.3 详情是另一道闸

当前最大详情 `ftshare_sw_industry_metrics` 3901 / 4096（95.2%），第二 `eastmoney_convertible_bond_list`
3738，第三 `ftshare_ashare_quote` 3668。18 条新能力里若有宽表，必须在 4096 内；
目录分片不会给详情让出任何空间。

---

## 4. 九分片方案

### 4.1 为什么分片键不是"市场"

按市场切，当前盘子是：

| 市场 | 条数 | 码点 | 占比 |
|---|---:|---:|---:|
| A 股 | 59 | 2392 | 45.8% |
| 基金 | 33 | 1182 | 22.6% |
| 宏观/利率 | 15 | 642 | 12.3% |
| 期货/商品 | 10 | 512 | 9.8% |
| 跨境/全球 | 5 | 245 | 4.7% |
| 港股 | 3 | 124 | 2.4% |
| 美股 | 3 | 123 | 2.4% |

市场分类**适合做任务路由与覆盖报表**，但不适合做分片键：A 股一片占 46%，10,000 总量下约 4580
（6144 的 75%），13,000 左右就撞线；港股/美股各只有 3 条，切出来是碎片。
市场保留为 `markets` 标签，分片键改用**主题**——主题盘子更均衡，且与"用户要什么数据"直接对应。

### 4.2 九个分片（当前实测）

| topic | 中文 | 条数 | 码点 | 占比 | 典型能力 |
|---|---|---:|---:|---:|---|
| `quote` | 行情与指数 | 21 | 824 | 15.8% | `quote`、`history`、`tencent_hk_quote`、`index_history` |
| `flow` | 资金与筹码 | 25 | 1056 | 20.2% | `dragon_tiger`、`eastmoney_margin_trading`、`ftshare_main_capital_flow` |
| `financials` | 财务与估值 | 10 | 430 | 8.2% | `income_statement`、`valuation`、`ftshare_sw_industry_metrics` |
| `fund` | 基金 | 33 | 1182 | 22.6% | `fund_nav`、`fund_holdings`、`fund_backtest` |
| `events` | 公告与公司行为 | 3 | 118 | 2.3% | `corporate_actions`、`eastmoney_dividend_plan` |
| `macro` | 宏观与利率 | 15 | 642 | 12.3% | `eastmoney_cpi`、`ftshare_lpr`、`wind_edb_query` |
| `futures` | 期货与商品 | 10 | 512 | 9.8% | `ftshare_futures_kline`、`ftshare_futures_settle` |
| `cross` | 跨境与全球 | 5 | 245 | 4.7% | `eastmoney_mutual_flow`、`ftshare_trading_calendar`、`wind_stock_kline` |
| `meta` | 日历与元数据 | 6 | 209 | 4.0% | `ticker_search`、`index_catalog`、`ftshare_index_weight` |

最大片 `fund` 1182，是 6144 的 19.2%、8192 的 14.4%。**当前任何一片都远低于宿主阈值。**

P2 的 15 条 collector 新能力按主题落位后（估算，按 45 码点/条）：

| topic | 条数 | 码点 | 新增 |
|---|---:|---:|---|
| `quote` | 26 | ≈1049 | G1/G2/H1/U1/A4 |
| `flow` | 27 | ≈1146 | A3/H3 |
| `financials` | 11 | ≈475 | U4 |
| `fund` | 33 | 1182 | — |
| `events` | 4 | ≈163 | A2 |
| `macro` | 17 | ≈732 | G3/M1 |
| `futures` | 11 | ≈557 | F1 |
| `cross` | 5 | 245 | — |
| `meta` | 9 | ≈344 | U3/X1/A5 |

### 4.3 协议

```
list_capabilities()                  → 九行索引：topic | 中文 | 条数 | 码点 | 2 个例子
list_capabilities({ topic: "flow" }) → 该片的 capability|summary|paginated 行
```

- **无参数只返回索引**，当前 545 码点，不返回能力行。索引每行带条数与例子，让"我该看哪片"可判断，
  不用猜。
- **带 topic 返回该片**，行格式与今天完全一致，`describe_capability` 不用改。
- **未知 topic** 返回 `capability_scope_invalid`，错误里列出九个 topic + 条数 + 例子；
  不允许返回空字符串或"没有该能力"。
- **一个任务只调一次索引**；按问题需要取片，**不设片数上限**：复杂/跨资产问题建议第一步九片全取，
  单一资产按需取；多个 topic 在**同一条消息里批量发出**（`list_capabilities` 已标 `concurrencySafe: true`，
  框架会并发派发）。片数是结果，不是配额；单片 <2048 才是体积预算。
- **不提供 `topic=all`**：九片全取用**九个独立调用**；`all` 会把九片合成一条 10k 结果，剪枝按单条算，
  到 10k 时会被截断。分开取，单条边界还在。
- `describe_capability` 继续按名字全局解析；即使模型没列某片，只要能说出名字仍可拿到契约。
  `capability_unknown` 的错误回九行索引（含例子），不再把全部名字列出来。
- **诊断口同样受约束**：`dc_status` 只回 `registered_capability_count` 与九片 `registered_topics`，
  不回全量名字。否则目录到 10k 时一颗诊断工具会重新制造约 300k 的单条结果，分片被旁路。

### 4.4 分类元数据

不把 topic 写进 128 个 source 定义，而是集中一张表：

```ts
// src/data-collector/catalog-taxonomy.ts
export const CATALOG_TOPICS = ['quote', 'flow', 'financials', 'fund', 'events', 'macro', 'futures', 'cross', 'meta'] as const
export type CatalogTopic = (typeof CATALOG_TOPICS)[number]

export const CATALOG_TAXONOMY: Record<string, CatalogTopic> = { /* 128 条，一条一项 */ }
```

组装测试校验：每个已注册 capability 恰好一项；没有孤儿项；topic 合法。
缺项直接失败并点名 capability，不会静默落进某个默认片。

v1 只落 topic；市场分类保留在缺口文档的覆盖报表里。等确实需要"按市场过滤"时再加
`markets` 数组，避免现在维护两套会互相漂移的标签。

### 4.5 预算与测试

| 对象 | 软目标 | 硬上限 | 说明 |
|---|---:|---:|---|
| 索引 | 1024 | 2048 | 九行 + 例子，当前 545 |
| 单片 | 2048 | 4096 | 当前最大 1182；10,000 总量下最大约 2006 |
| 全目录（不合成单条） | — | — | 需要时可九片全取；不生成单条全目录结果 |

测试至少六条：

1. 每个已注册 capability 在 taxonomy 里恰好一项；没有多余项。
2. 九片行数之和 = 注册数；九片码点之和（加分隔符）= 当前 `capabilityDirectory()`。
3. 每片 < 2048（规划软目标）；测试硬断言 < 4096（超过即红）。
4. 索引 < 1024；索引里的条数、码点与分片实测一致（不能写死过期数字）。
5. 未知 topic 抛 `capability_scope_invalid`，错误里含全部 topic。
6. 无参数返回索引、带 topic 返回分片——两种形态各一条断言，不能靠版本记忆。
7. 九片可以全取：九个调用合起来 = 128 条、不重不漏（`test/apply-integration.test.mjs`）。

### 4.6 容量模型

按当前主题占比外推（不是承诺，是量级）：

| 目录总量 | 最大片（约） | 占 2048 软目标 | 占 4096 硬上限 | 判断 |
|---:|---:|---:|---:|---|
| 5,901（P2） | 1,231 | 60% | 30% | 舒适 |
| 10,000 | 2,006 | 98% | 49% | 可行，接近软目标 |
| 15,000 | 3,009 | 147% | 73% | 需抬软目标或再拆 fund/flow |
| 20,000 | 4,012 | 196% | 98% | 接近硬上限 |
| 25,000 | 5,015 | 245% | 122% | 硬上限已破 |

所以九分片的**结构容量约 15,000–20,000 码点**（受 4096 硬上限约束），
而**舒适容量约 10,000 码点**（受 2048 软目标约束）。真正的天花板还不是字符，是 token 与注意力：
10,000 码点中英混排大致 4k–8k token（无固定换算），已经接近一次任务发现面的合理上限；
到 15,000 码点时，即使每片都没被剪，模型读九片的成本也会明显上升。
这是成本提示，不是片数禁令：问题需要全量时仍可九片全取，不能为了省 token 漏能力。

### 4.7 新源接入的容量纪律：以 Longbridge 为例

Longbridge OpenAPI 是**私有长连接 + Protobuf**，官方有 Node SDK（`longbridge` 的 `QuoteContext`），
不是 HTTP JSON。接入它要新增一个 transport/adapter，不是往 `src/sources/*.ts` 加几条 URL；这是一次
独立 spike，不应和目录分片混在一起。

行情概览列了约 20 个 pull 接口。若按 1:1 注册，会一次加 20 条，而且 A/HK/US 各来一套就是 60 条——
这是分片也救不回来的"按市场复制"错误。正确形态是**一条能力用 symbol 收三市场**：

| 建议能力 | 覆盖 | 落在 |
|---|---|---|
| `longbridge_quote` | A/HK/US 实时、美股盘前/盘后/夜盘 | `quote` |
| `longbridge_kline` | A/HK/US 历史 K 线 | `quote` |
| `longbridge_intraday` | 分时 | `quote` |
| `longbridge_trades` | 成交明细 | `quote` |
| `longbridge_capital_flow` | 当日资金流向/分布 | `flow` |
| `longbridge_depth` / `longbridge_brokers` | 盘口/经纪队列（LV2 付费） | `quote` |
| `longbridge_trading_days` | 各市场交易日/时段 | `meta` |

6–8 条 ≈ 240–320 码点，落在 `quote`/`flow`/`meta`，每片仍 <2048。**分片已经把"未来加源"的容量
风险移走；真正的风险变成 transport 与权限，而不是目录长度。**

权限上别把"能连"当"免费全量"：基础行情是开通 OpenAPI 后自动获得的美/A 实时 + 港股 BMP
（约 15 分钟延迟）；港股 LV1、LV2 盘口与经纪队列是行情商城单独购买的。接入前先验：港股是否只给
延迟、盘前盘后字段是否随 `enable_overnight` 返回、限流与断线重连。它和现有腾讯/东财重叠的部分
（A 股快照/日线）不重复注册，优先补缺口：美股盘前盘后、港股实时/盘口、经纪队列、资金流。
>
> **新源准入规则**：先写一张 ≤8 条的 capability 清单，每条用 symbol/市场参数覆盖多市场；
> 超过 8 条先合并，不要直接按端点或按市场注册。分片能吸收数量，但吸收不了"同一件事注册三遍"。

---

## 5. 落地与运行纪律

### 5.1 已落地（2026-11-14）

- `src/data-collector/catalog-taxonomy.ts`：128 条能力 → 九主题的显式映射；缺项/孤儿项由测试点名。
- `DataCollectorHub.catalogIndex()` / `catalogTopicEntries()` / `capabilityDirectory(topic)`；
  `list_capabilities({ topic? })` 无参数返回索引，带 topic 返回该片。
- `test/data-collector-hub.test.mjs`：taxonomy 完整、索引 <1024、单片 <2048 软目标 / <4096 硬上限、
  九片条数之和 = 128、索引头与分片实测一致。
- `test/data-collector-tools.test.mjs` / `test/apply-integration.test.mjs`：索引、分片、未知 topic
  `capability_scope_invalid`、条数之和。
- `capital-data-protocol` skill、`docs/data-collector-capabilities.md`、`docs/dev/data-roles.md` 同步；
  `thresholdChars` 仍是 8192。
- **首次实机运行（2026-11-14，自选股周检）**：1 次索引 + 3 片（quote/financials/events；这是任务需要三片，不是上限），
  实测 545 / 824 / 430 / 118 码点，最大 824；无 `capability_scope_invalid`、无重复索引。
- 同场发现 `dc_status` 原本回 128 个名字的 4,160 字符清单，模型据此跳过了 flow 片；已改成
  `registered_capability_count` + 九片 `registered_topics`，诊断口不再能绕过分片。
- 同场度量：能力发现合计约 1.9k 字符（索引 + 3 片），22 次 `describe_capability` 约 37k 字符。
  目录已经很小，下一道预算在详情，不在目录。
- **第二次实机（跨市场风险简报）**：索引 + **九片全取**，10 次 `list_capabilities` 共 5,910 字符，
  单片最大 1,216；`dc_status` 1,815 字符（只剩 count + 九片汇总）；无 `capability_unknown`。
  macro 片在第 62 步才补（用于回答美国财政部/初请/FOMC 缺口），已加"复杂/跨资产问题第一步九片全取"的启发式。

### 5.2 运行纪律

- 新能力先登记 topic；缺登记测试红，不会静默落进 `meta`。
- 每片接近 2048：先压 summary，再拆片；不要加回 `topic=all`，那会重新制造单条 10k 结果。
- 到 10,000 总量：最大片约 2006，仍 <4096；到 15,000 再拆 fund/flow。
- 不抬 `thresholdChars`；抬它的完整步骤见 5.3，只作为最后手段。

### 5.3 如果坚持抬到 10000

按这个顺序做，缺一不可：

1. 六个 preset 的 `thresholdChars` 全部改成 **13334**（不是 10000），`headChars` 4096、`tailChars` 1024
   保持；`4096 + 39 + 1024 = 5159 ≤ 13334`。
2. 目录护栏改成 **10000**（75% of 13334），并保留"目录 < pruner"的硬断言。
3. 补一条测试：六个 preset 的 `thresholdChars` 必须相等；少改一处就红。
4. 重跑 `test/persona.test.mjs`、`test/selected-skills-content.test.mjs`：`visibleChars` 会从 7680
   变成 12822，现有"skill 必须完整可见"的断言会放宽，需要重新确认没有超长 skill 混进来。
5. 接受详情仍是 4096、spill 仍是 12500 token、全角色都变宽这三个事实。
6. 重新测量 10,000 码点目录在 collector 会话里的实际 token 与压缩行为；不要只看字符数。

**不推荐把 10000 作为第一步**：它只多买约 95 条，却同时放宽了目录、工具结果、skill 三个预算，
而本次路线图 143 条连 6144 都没用完。

---

## 6. 风险

- **猜 topic**：分片后模型可能选错片，误报"没有该能力"。缓解：索引带条数与例子；未知 topic 响亮报错；
  `describe_capability` 全局可解析；`capability_unknown` 提示所属 topic。
- **压缩仍会摘要**：分片只防"单条结果被中间剪"，不防 compaction 把整段历史摘要掉。
  所以索引要可重复调用，且 skill 要写"缺片时先回索引"。
- **taxonomy 漂移**：143 条集中一张表，新增/改名必须同步；靠注册期校验与测试，不靠记忆。
- **summary 压太短**：35 码点可能丢单位/口径；压之前先列"必须保留"的三类信息（市场、频率、单位）。
- **默认行为翻转**：无参数从全目录变索引是一次协议变更，必须版本化并在 skill/文档/测试三处同时改。

---

## 7. 一句话回答

**DSH 允许 10000，但不能只改 6144；只改护栏等于把静默剪枝放进来。**
现在 143 条不需要抬，也不需要拆；把 summary 写短即可。真要长期扩容，用九主题分片：
每片 2,048 软目标 / 4,096 硬上限，10,000 总量下最大片约 2,006，宿主 8192 根本碰不到。
