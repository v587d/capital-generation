# Fuyao data_collector 扩展设计

状态：Phase 0–3C 全部完成。`npm test` 全绿；61 个 capability 由 `npm run smoke:fuyao` 对真实 REST 逐条验证（结果见 §11.4）；能力总表见 `docs/data-collector-capabilities.md`；后续扩容受目录/详情体积预算约束（§11.2.3）
范围：data_collector 的 Fuyao REST JSON 接口扩展
不在范围：`/api/dump/**/download-url`、Parquet 下载、自动分页聚合、其他数据源接入

## 1. 目标与边界

本阶段只冻结协议、确认端点契约来源、登记实现顺序，不修改 `src/data-collector` 或 `src/sources/fuyao-rest.ts` 的运行行为。

已确认的运行边界：

- 首期一个上游请求生成一个 Dataset；不自动翻页、不在 source 内合并多个请求。
- `DatasetRef` 的外部字段和 `request_data` 输入/输出协议保持不变。
- `request_data` 仍然只返回 Dataset 元数据，不返回 raw rows、真实路径、API Key 或上游预签名 URL。
- 当前 Fuyao 数据源保留 FIFO，因为 Fuyao 源数据存在并发限制。
- FIFO 是当前 Fuyao 执行策略，不升级为所有未来数据源的全局架构约束；未来数据源可以使用自己的执行器、队列和限流策略。
- 未来若继续使用 `DataCollectorHub`，需要明确声明它是 provider-specific execution path，而不是所有 provider 的强制入口。
- 基金接口暂缓到端点契约核实完成后再接入。
- 三个 `/api/dump/**/download-url` 接口明确不属于本次扩展，也不注册为当前 JSON source。

## 2. 兼容协议冻结

以下内容视为已有兼容面，不在本次扩展中重命名或删除：

- capability：`ticker_search`、`quote`、`history`、`trading_calendar`
- `request_data` 入参：`capability`、`params`、`force_refresh`、`task_id`
- `request_data` 输出：当前 `DatasetRef` 字段白名单
- `list_capabilities`：**已于 §10.5 改为两级发现**——`list_capabilities()` 返回精简目录（`capability` / `summary` / `paginated`），`describe_capability({capability})` 返回单个能力的 `description` / `input_schema` / `output_schema`。旧的「目录即全量 schema」形态不再受支持。
- `artifact_ref` 格式：`workspace://capital-data/datasets/<dataset_id>`
- Dataset 格式：`json`、`json_rows`
- `force_refresh`、`task_id`、`params_digest` 的现有字段形态
- session scope、retention、workspace sandbox 和不可变 Dataset 语义

首期不把 pagination、provenance、request_id、download metadata 加入 `DatasetRef`。如果后续确实需要这些信息，优先作为 manifest 可选扩展，由 `inspect_dataset` 或新的描述工具按需返回；旧 manifest 必须继续可读。

## 3. 契约资料优先级

同一端点存在多个资料来源时，采用以下优先级：

1. 真实 REST 响应和错误行为（有 API Key 时用最小 smoke request 验证）。
2. `docs/reference/fuyao/llm_full.md` 中按端点整理的请求/响应契约。
3. `ths_api.md` 的摘要、能力矩阵和调用建议。
4. MCP 工具名只用于关联文档和内部 `name`，不直接成为模型可见 capability。

`ths_api.md` 仍保留为项目级能力索引，但不能覆盖 `llm_full.md` 中更具体的字段、参数和响应结构。

## 4. source 设计方向

后续实现将把 `fuyao-rest.ts` 中重复的 source 构造收敛为端点定义注册表。每个端点定义需要同时描述：

- `name`：内部 MCP/文档名称。
- `capability`：短、稳定、全局唯一的模型协议名。
- `path`：内部 REST 路径。
- `input_schema`：模型可见的静态参数契约。
- `normalizeParams`：trim、大小写、默认值和列表规范化。
- `validateParams`：范围、格式、跨字段互斥、单标的等运行时校验。
- `output_schema`：响应 envelope 和核心字段结构。
- `validateOutput`：只检查契约要求的字段存在性和类型，不把 `null` 转成 `0`。
- `pagination`：描述上游分页形态；首期只标记，不自动聚合。

参数必须在 Hub 计算 merge key 和 digest 前完成规范化，否则同一语义请求可能生成不同 Dataset。这个改动属于后续实现阶段，Phase 0 只冻结规则。**Phase 1 已实现该点**，见 §8.1。

输出 schema 允许保留未登记的上游扩展字段，但已登记的字段必须标明 nullable、单位和时间语义。缺失值必须透传为 `null`。

## 5. 首批候选 endpoint

首批只选择资料完整、单次响应可以直接保存为 JSON Dataset 的接口。建议 capability 如下：

| capability | REST endpoint | 形态 | Phase 0 状态 |
|---|---|---|---|
| `ticker_list` | `/api/meta/tickers/list` | offset/limit JSON rows | 文档契约已确认 |
| `corporate_actions` | `/api/a-share/corporate-actions/adjustment-factors` | 单标的事件 JSON rows | 文档契约已确认 |
| `income_statement` | `/api/a-share/financials/income-statements` | 单标的财务序列 | 文档契约已确认 |
| `balance_sheet` | `/api/a-share/financials/balance-sheets` | 单标的财务序列 | 文档契约已确认 |
| `cash_flow` | `/api/a-share/financials/cash-flow-statements` | 单标的财务序列 | 文档契约已确认 |
| `financial_indicators` | `/api/a-share/financials/indicators` | 单标的嵌套 JSON | 文档契约已确认，需区别于表格 rows |
| `valuation` | `/api/a-share/valuations/snapshot` | 批量 JSON rows | 文档契约已确认 |
| `auction` | `/api/a-share/auction/snapshot` | 批量 JSON rows | 文档契约已确认 |
| `limit_up_pool` | `/api/a-share/special-data/limit-up-pool` | page/size JSON rows | 文档契约已确认 |
| `limit_up_ladder` | `/api/a-share/special-data/limit-up-ladder` | 无参嵌套 JSON rows | 文档契约已确认 |
| `index_catalog` | `/api/a-share-index/catalog/ths-index-list` | 单 tag JSON rows | 文档契约已确认 |
| `index_constituents` | `/api/a-share-index/constituents/ths-stock-list` | 单指数 JSON rows | 文档契约已确认 |
| `index_quote` | `/api/a-share-index/prices/snapshot` | 必填代码列表 JSON rows | 文档契约已确认 |
| `index_history` | `/api/a-share-index/prices/historical` | 单指数时间窗 JSON rows | 文档契约已确认 |

以下接口不属于首批实现：

- `limit_down_pool`、`limit_break_pool`：可在同一分页模型确认后接入。
- 其他 special-data 榜单：待端点级契约核对。
- 全部 fund 接口：待逐 endpoint 参数、字段和报告期规则核对。
- 三个 market dump：本次明确排除。

## 6. 已登记的契约冲突

### 6.1 ticker_list

`ths_api.md` 描述了 `exchange` 过滤和默认 `SH,SZ`；`llm_full.md` 的端点契约没有 `exchange`，并说明省略 `asset_type` 时返回全部类型。

Phase 0 决策：以 `llm_full.md` 的端点契约为准，首期不向 source 增加文档未确认的 `exchange` 参数。需要 A 股范围时显式传 `asset_type=a-share`。

已确认约束：

- `asset_type` 可为逗号分隔的规范资产类型。
- `limit` 最大 10000，默认 1000。
- `offset` 默认 0。
- 调用方需要自行按页请求；本项目首期不自动聚合。
- 返回字段包括 `thscode`、`ticker`、`name`、`exchange`、`asset_type`、`currency` 及日期字段。

### 6.2 financial_indicators

`ths_api.md` 把该接口描述为财务指标平铺序列，并列举 `roe`、`roa` 等字段；`llm_full.md` 的具体契约是：

- 参数为 `thscode` 和 `report`。
- `report` 格式为 `yyyy-1` 到 `yyyy-4`。
- 返回 `data.abilities[]`。
- 每个 ability 内有 `indicators[]`，字段为 `index_id` 和 `value`。
- `value` 是原始数值字符串，也可能为 `null`，不能强制转换为 number。

Phase 0 决策：按嵌套 JSON 保存，不能套用 `envelopeData(item[])` 的普通 rows schema，也不把 `value` 转数字。

### 6.3 valuation

`ths_api.md` 中的字段名与 `llm_full.md` 不一致。具体契约使用：

- `pe_ttm`
- `pe_mrq`
- `pb_mrq`
- `ps_ttm`
- `pcf_ttm`

接口最多接受 100 个原始代码 token，服务端按请求顺序去重，缺失指标以 `null` 返回，不补零。

Phase 0 决策：以 `llm_full.md` 字段为准，不实现 `pe_lyr`、`pb`、`dividend_yield_pct` 等尚未在端点文档确认的字段。

### 6.4 financial statements

三张报表共用参数契约：

- `thscode` 必填，单标的，不接受逗号。
- `period` 为 `annual` 或 `quarterly`。
- `limit` 与 `start/end` 二选一。
- `start`、`end` 必须成对传入。
- `limit` 范围为 1 到 20，默认 4。
- 时间窗口不超过 10 年。
- `report_date_ms` 是披露日，`period_end_ms` 是报告期末，二者都保留。
- 金额为原币元，`basic_eps` 为元/股。
- 未披露字段为 `null`，不补零。

### 6.5 limit_up_pool

该接口不是普通 `total/item` 分页，而是：

```json
{
  "timestamp": 0,
  "pagination": { "total": 0, "pages": 0, "size": 50, "page": 1 },
  "item": []
}
```

参数为 `date_ms`、`page`、`size`、`sort_field`、`sort_dir`。首期保存原始 envelope，不自动翻页；`pagination.total` 不等于当前 Dataset 的 `row_count`。

### 6.6 index endpoints

`llm_full.md` 明确：

- `thscode` 会 trim 和 uppercase。
- 指数 catalog 的 `tag` 有白名单，默认 `cn_concept`，无分页。
- constituents 单次只接受一个指数代码。
- index snapshot 必须传 `thscodes`，`limit/offset` 仅签名对齐且无效。
- index historical 无 `adjust` 和 `offset`，只接受 `interval=1d` 及 start/end，窗口不超过 10 年。

这些规则不能直接复制现有 A 股 quote/history 的参数 schema，需要单独定义。

## 7. Dataset 形态规则

- 普通 `data.item[]` 响应：`json_rows`。
- `financial_indicators`、`limit_up_ladder` 等嵌套业务对象：根据真实响应保存为 `json` 或包含 envelope 的 `json_rows`，不强行扁平化。
- `data=null`、缺失 `item` 或响应结构不符合端点契约：请求失败，不落盘。
- 上游字段新增时，只要不破坏已确认字段，允许保留原始扩展字段。
- 上游 `request_id` 目前不进入 `DatasetRef`；后续如需追踪，放入 manifest 可选扩展。

## 8. 分期实施

### Phase 0：本文件和契约清单

- 冻结边界和兼容协议。
- 定点核对 `llm_full.md`。
- 记录端点冲突和优先级。
- 为首批端点建立 contract fixture 规范。

### Phase 1：现有 source 硬化（已完成）

- 4 个 capability 名、模型可见字段与旧协议均未变。
- 代码、时间、范围、枚举、互斥与未知参数校验已落地。
- 参数规范化与 digest 一致性已落地（见 §8.1）。
- envelope/output guard 已加强（见 §8.2）。
- 未改变 Hub 的 Fuyao FIFO 行为。

### Phase 2：首批 endpoint source（已完成）

- 首批 14 个 capability 已按 contract fixture 注册（见 §10.1）。
- 每个请求只产生一个 Dataset；不自动分页，不引入新数据源到 Hub。
- 每个端点独立完成请求、schema、参数语义与输出护栏，并有对应测试。
- 遗留一个待评审问题：能力目录体积超过剪枝阈值（§10.5）。

### Phase 3：后续 JSON 接口

- 补齐 special-data 其余端点。
- 按接口逐个核对基金契约后接入。
- 仅在真实契约明确后增加 capability。

## 9. Phase 1 实施记录

### 9.1 参数规范化契约（`DataSource.normalizeParams`）

`DataCollectorHub` 新增可选钩子 `DataSource.normalizeParams(params)`：

- **调用时机**：`hub.request()` 入口，早于 in-flight merge key 与 `params_digest` 的计算；execute 内部再调用一次（直接调用 source 时也生效），因此必须**幂等**。
- **语义**：`fuyao-rest.ts` 的 `normalize` 一次完成「未知参数拦截 → 必填检查 → 语义校验 → 规范化」。未知参数必须在重建参数对象之前拦截，否则拼写错误会被静默丢弃。
- **抛错语义**：抛错即请求在**入队前**失败——不解析凭据、不发请求、不落盘、不占用队列。
- **兼容性**：未声明 `normalizeParams` 的数据源行为与之前完全一致（既有测试的 digest、合并、复用、超时断言全部不变）；未知 capability 不做处理，仍由执行阶段抛统一的 `no data source is registered for capability ...`。
- **收益**：`600519.sh` 与 ` 600519.SH , 600519.SH` 归一到同一份参数，命中同一个 Dataset，不再各写一份。

各端点的规范化口径：

| capability | 规范化 | 校验 |
|---|---|---|
| `ticker_search` | `q` trim；`exchange` 大写；`asset_type` 小写、拆分、去重、保序 | `q` 必填且去空白后 1~512 字符；`exchange` ∈ SH/SZ/BJ；`asset_type` ∈ 7 类白名单；`limit` 1~50 |
| `quote` | `thscodes` trim、大写、按序去重；**带 `thscodes` 时丢弃 `limit`/`offset`**（上游在该模式下忽略分页，保留会造出语义等价的多个 Dataset） | 代码必须匹配 `^\d{6}\.(SH\|SZ\|BJ)$`；`limit >= 1`；`offset >= 0` |
| `history` | `thscode` 单只、trim、大写；`start`/`end` 取整 | `thscode` 不接受逗号；`interval` 仅 `1d`；`end >= start`；窗口 ≤ 10 年（本地保守取 3660 天）；`adjust` ∈ none/forward/backward；`offset >= 0` |
| `trading_calendar` | 无参数 | 任何入参都被拒绝（`unsupported parameter`） |

### 9.2 输出护栏口径

`validateOutput` 从"字段是否存在"升级为"结构是否可用"，并保持保守（宁可放过、不可误杀合法数据）：

- `data` 必须是对象（非数组、非 null）；`item` 必须是数组（空数组合法）。
- `timestamp` / `total` 可缺席或为 `null`；出现时必须是可用的整数。
- 行必须是对象；已登记字段**缺失即判契约不符**（缺失与显式 `null` 语义不同）。
- 显式 `null` 一律放行——上游用 `null` 表示"未披露/无数据"，语义与 `0` 不同，不得补零。
- 数值字段接受有限数值**或数值字符串**（上游历史上存在 decimal 序列化为字符串的情况）；`text` 字段要求字符串。
- 已登记字段：`ticker_search` = thscode/name；`quote` = last_price；`history` = date_ms/close_price；`trading_calendar` = date_ms/date。

### 9.3 明确不做（本阶段）

- 不新增 endpoint / capability（首批 14 个留给 Phase 2）。
- 不做自动翻页、不做多页聚合。
- 不改 `DatasetRef`、`request_data`、`list_capabilities` 的外部协议。
- 不改 Fuyao 的 FIFO 串行策略；不引入重试/退避与 QPS 分组（留给后续阶段单独评估）。
- 不把 `request_id` 写进 DatasetRef（仍只在错误信息中透出）。

### 9.4 测试基线

`npm test`：124 项全绿（Phase 1 前为 104 通过 / 7 失败）。新增覆盖：

- 规范化幂等性（逐 capability）与归一后"只取数一次、复用同一 Dataset"的端到端用例。
- 裸代码、逗号单标的、`end < start`、超 10 年窗口、范围越界、枚举非法、必填缺失、未知参数。
- 非法参数发生在解析凭据与发请求之前（断言 fetch 与 credentials 调用次数为 0）。
- 输出护栏：字段缺失、行非对象、类型不符、`data=null`、`timestamp` 非法、空结果合法、`null` 放行。

### 9.5 附带修复：persona 断言不再锁措辞

**结论先行**：那 7 个长期失败的用例不是"harness 把 `text` 改成了别的字段"。实测本机
`@deepseek-ai/dsh-persona@0.1.5-rc.1` 的配置契约是 `prefix`（另有可选 `suffix` /
`complete` / `includeRuntimeContext`），从来没有 `text`；测试原本就在读 `config.prefix`。
失败根因是**主 persona 正文被重写**，而断言锁死了旧原句。

改法（避免同类问题复发）：

1. persona 文本读取收敛为带诊断的 `readPersonaText()`：字段找不到时立刻报出实际 `config`
   字段名与候选清单，而不是让下游冒出 7 个互不相关的"未匹配"。
2. 新增"字段契约跟随本机 harness 版本"用例：定位已安装的 `dsh-persona` 类型声明并断言
   `prefix: string` 仍存在；定位不到时降级为诊断输出，不误判失败。
3. 正文断言改为**断规则、不锁措辞**：`assertRuleAny()` 接受若干等价说法，任一命中即通过；
   全部落空说明规则真的消失了。
4. 三条硬规则在重写中丢失，**补回人设**（而不是删断言）：委派工具名清单
   （`subagent_data_collector` / `subagent_data_junior` / `subagent_web_retriever`）、
   `data_collector 不得创建或指挥 data_junior`、`工具可见性不是权限隔离`。
5. 两条被移位的断言改放在规则实际所在处：`请求归属恒为调用者自身` → data_collector persona；
   载荷名（`*_request` / `dataset_ready` / `*_completed` / `*_failed`）→ skill
   `capital-data-protocol` 与子 persona（主 persona 只保留"指向契约出处"）。

## 10. Phase 2 实施记录

状态：14 个新 capability 已注册并测试，`npm test` 138 项全绿；并已对 17 个端点做真实 REST 冒烟（见 §10.4）。

### 10.0 真实 REST 冒烟结果（2026-09 实测）

对全部 17 个可请求端点各发一次最小请求（顺序执行、间隔 300ms，未触发限流）：

- 当次覆盖 17 个端点（Phase 1 的 4 个 + Phase 2 的 13 个；**A 股行情快照 `quote` 当时漏跑**，已在 §11.4 的全量冒烟中补上）。**17/17 HTTP 成功**，业务 `code` 全为 0；**17/17 输出护栏判定通过**——没有假阴性，说明"主标识严格、指标宽容"的校准没有误杀真实响应。
- 实测行字段与 `llm_full.md` 编码的契约**逐字段一致**，其中关键修正如资产负债表 `assets_total` / `total_debt` / `holder_equity_total`（而不是 `ths_api.md` 摘要的 `total_assets` / `total_liabilities` / `total_equity`）得到确认。
- 值得记录的真实形态：
  - `financial_indicators` 无 `item[]`，是 `{thscode, report, abilities}`——与"嵌套响应落成 `json`"的 `shapeOf` 行为吻合。
  - `limit_up_pool` 在非涨停时点返回 `item: []` 但**仍带 `pagination`**，护栏按合法空结果放行。
  - `history` / `index_history` 顶层还带 `thscode` / `interval` / `adjust`（护栏不校验这些附加字段，允许上游扩展）。
  - `index_catalog(tag=industry)` 返回 320 条，`index_constituents(000300.SH)` 返回 300 条，`trading_calendar` 返回 242 个交易日——都是单次全量、无分页。
- 原始响应体**未落库**：属瞬时行情数据，且本次目的是校验契约与护栏，不是采集样本。

### 10.1 端点登记表（capability → 内部 MCP 名 → 路径）

| capability | 内部 name | path | 分页 |
|---|---|---|---|
| `ticker_list` | `get_meta_tickers_list` | `/api/meta/tickers/list` | offset/limit |
| `corporate_actions` | `get_a_share_corporate_actions_adjustment_factors` | `/api/a-share/corporate-actions/adjustment-factors` | 无 |
| `income_statement` | `get_a_share_financials_income_statements` | `/api/a-share/financials/income-statements` | 无（limit 或时间窗） |
| `balance_sheet` | `get_a_share_financials_balance_sheets` | `/api/a-share/financials/balance-sheets` | 无（limit 或时间窗） |
| `cash_flow` | `get_a_share_financials_cash_flow_statements` | `/api/a-share/financials/cash-flow-statements` | 无（limit 或时间窗） |
| `financial_indicators` | `get_a_share_financials_indicators` | `/api/a-share/financials/indicators` | 无 |
| `valuation` | `get_a_share_valuations_snapshot` | `/api/a-share/valuations/snapshot` | 无 |
| `auction` | `get_a_share_auction_snapshot` | `/api/a-share/auction/snapshot` | 无 |
| `limit_up_pool` | `get_a_share_special_data_limit_up_pool` | `/api/a-share/special-data/limit-up-pool` | page/size |
| `limit_up_ladder` | `get_a_share_special_data_limit_up_ladder` | `/api/a-share/special-data/limit-up-ladder` | 无（固定 30 日窗口） |
| `index_catalog` | `get_a_share_index_catalog_ths_index_list` | `/api/a-share-index/catalog/ths-index-list` | 无（单 tag 全量） |
| `index_constituents` | `get_a_share_index_constituents_ths_stock_list` | `/api/a-share-index/constituents/ths-stock-list` | 无 |
| `index_quote` | `get_a_share_index_prices_snapshot` | `/api/a-share-index/prices/snapshot` | 无 |
| `index_history` | `get_a_share_index_prices_historical` | `/api/a-share-index/prices/historical` | 无（时间窗） |

`paginated: true` 只标给真正有翻页语义的四个：`quote`、`history`、`ticker_list`、`limit_up_pool`。

### 10.2 参数语义决策（可复核）

1. **不注入上游默认值**：省略参数与显式传默认值是两种请求形态，各自 digest 稳定。把上游默认值写进本地代码，会让 digest 的含义随上游默认值漂移而悄悄改变；代价只是 `{}` 与 `{limit:1000}` 会各存一份 Dataset，属可接受成本。
2. **`quote` 传 `thscodes` 时丢弃 `limit`/`offset`**（用户已确认）：上游在该模式下忽略分页，保留会造出语义等价的多个 Dataset。**重新评估触发条件**：上游改为在指定标的模式下也按 limit/offset 截断，或快照接口新增真正的分页语义时，改回透传并补测试。
3. **财务三表两模式互斥**：`limit`（1..20）与 `start+end` 成对出现互斥；同时给、只给单边都本地拒绝。`period` 按文档"必需"处理，不省略（避免依赖上游默认值）。
4. **枚举大小写统一归一**：小写枚举（`interval`/`adjust`/`period`/`stage`/`sort_field`/`sort_dir`/`tag`/`asset_type`）统一 `toLowerCase()`，`exchange` 统一 `toUpperCase()`；`LIVE` 与 `live` 是同一个请求。
5. **指数代码与 A 股代码分开校验**：指数端点允许 `.SH`/`.SZ`/`.BJ`/`.TI`（同花顺板块），A 股端点只允许 `.SH`/`.SZ`/`.BJ`。
6. **接口差异按端点文档，不做签名对齐**：`index_quote` 不暴露 `limit`/`offset`（文档明说无效），`index_history` 不暴露 `adjust`/`offset`（指数无复权语义），传了即本地拒绝。
7. **批量上限按去重前的原始 token 数校验**（`valuation`/`auction` 各 100），与文档口径一致；去重后再算会放过 101 个重复代码的请求。
8. **`corporate_actions` 的 `from`/`to` 允许单边省略**（文档两个参数各自可选），但都给出时要求 `to >= from`；日期既校验格式也校验日历有效性（`2025-02-30` 被拒）。

### 10.3 输出护栏口径（Phase 2 起统一）

- **严格**：行的主标识与结构字段——`thscode`、连板天梯的 `date`、财务的 `period`/`fiscal_year`/`fiscal_period`/`period_end_ms`/`report_date_ms`，以及顶层容器（`pagination`、`window`、`boards`、`abilities`）。缺失即判契约不符。
- **宽容（`?`）**：数值/附属字段允许缺失或为 `null`，出现时类型必须正确。理由：上游指标随发布增减，单个指标缺失不等于结构损坏，而"整份 Dataset 因一个指标缺失被拒"会直接阻断用户任务。
- **`null` 一律放行**：上游用 `null` 表示未披露/无数据，语义与 `0` 不同，绝不补零。
- **财务指标 `value` 保持字符串**：`financial_indicators` 的 `value` 是数据源原始数值字符串（保留精度与尾随小数位），转成 number 会被判契约不符。
- **Phase 1 四个端点的核心价格字段（`last_price`/`close_price`）保持严格**：它们是该端点唯一的主输出且已有测试覆盖；本次不回溯修改已评审过的行为。若后续要与新口径统一，属一次性小改动。

### 10.4 契约来源与 fixture 现状（如实记录）

- 字段名以 `llm_full.md` 的端点契约优先：例如资产负债表用 `assets_total`/`total_debt`/`holder_equity_total`，而不是 `ths_api.md` 摘要里的 `total_assets`/`total_liabilities`（测试里有"不得使用未确认字段名"的反向断言）。该判断已由 §10.0 的真实冒烟证实。
- **本阶段没有落盘 `test/fixtures/fuyao/*.json`**：契约断言以测试内联 envelope 承载，真实响应也只在 §10.0 记录了结构结论。原因是不把瞬时行情/财务数值提交进仓库；若将来需要回归用 fixture，应另行脱敏并标注抓取时间与来源。

### 10.5 能力发现改两级（已实施，原为待决问题）

**问题**：`list_capabilities` 返回全部 18 个能力（含 `input_schema` + `output_schema`）实测 **23385 字符**；preset 的 `tool-result-pruner` 是 `thresholdChars: 8192 / headChars: 4096 / tailChars: 1024`，语义是**替换超限工具结果的中间部分**。后果是 data_collector 调 `list_capabilities` 只能看到目录头部约 4 个能力与尾部一个，中间的能力（如 `valuation`、`auction`、`limit_up_pool`）在发现阶段不可见——恰好破坏"capability 一律以 list_capabilities 返回为准"的纪律。

**决策（用户确认）**：拆成两个工具，一个工具一种返回形状。

| 工具 | 入参 | 返回 | 实测体积 |
|---|---|---|---|
| `list_capabilities()` | 无 | `{capability, summary, paginated}[]` | 18 项 **1386 字符**（原 23385） |
| `describe_capability({capability})` | 一个能力名 | `{capability, summary, paginated, description, input_schema, output_schema}` | 最大 **2273 字符**（`income_statement`） |

**为什么是两个工具而不是一个双形态工具**：双形态的 output schema 只能是 `oneOf`，模型得先判断"这次拿到的是哪种形状"，渲染与断言也要分支；两个工具各自形状单一，且两个调用的体积都能结构性封顶——本次的失败模式在两处都不可能复现。

**为什么详情一次只收一个名字**：批量（`capabilities: [str]`）会让单次体积回到 4–7KB（3 个能力）甚至更多，等于把刚修掉的问题请回来。

**为什么不把能力名做成工具签名里的 enum**：签名在每一轮的 tool list 里都在付费，而目录一个任务只读一次；且签名是静态的，能力是动态的（凭据缺失时 source 根本不注册），签名会说谎。目录是能力名唯一的事实来源。

**为什么不把参数名放进目录**：那会诱导模型不看 `input_schema` 就填 `params`。目录只负责"选哪个"，详情负责"怎么填"。

**调用纪律（写进 dc persona 与 `capital-data-protocol` skill）**：目录一个任务只调一次；同一个能力只描述一次；不传逗号；结果已在本 session 历史里，重复调用只白占上下文。

**`describe_capability` 的分类错误**（用户要求：不返回模糊 error）：

| code | 触发 | 引导 |
|---|---|---|
| `capability_required` | 缺失 / 空白 | 先调一次 `list_capabilities`，把目录里的名字原样传入 |
| `capability_invalid` | 非字符串 / 超长 / 含逗号 | 改成单个字符串名字后重试一次；多个能力分多次调用 |
| `capability_unknown` | 名字不在目录 | 错误信息里**列出全部可用能力名**，要求原文复制、不编造/缩写/改写 |
| `capability_catalog_empty` | 目录为空（数据源未注册） | **明确不要重试**（此刻任何名字都失败），用 `dc_status` 读注册错误并回告主 Agent |

**结构护栏（比调高阈值更符合"不静默降级"）**：新增测试断言——目录 JSON < 6144 字符、单个能力详情 < 4096 字符。以后加能力时先在**测试**里失败，而不是运行时静默截断。

### 10.6 预算口径调研（实测本机 dsh 0.1.5-rc.1，2026-09）

用户提出"能否只给 data_collector 提高预算、主 Agent 不动"。读安装包后的结论：**DSH 没有按 Agent 区分剪枝预算的配置路径**，但也不需要——我们此前把两个数字混为一谈了。

| 数字 | 来源 | 含义 |
|---|---|---|
| **8192** | `dsh-compaction-tool-result-pruner` 的 `thresholdChars`（preset 配置值） | **真实上限**：单条工具结果超过它才被剪枝 |
| 4096（原值） | 本设计的测试预算 | 自己留的安全余量，**不是** DSH 约束 |

证据：

1. `ToolResultPruner.Config` 只有 `thresholdChars` / `headChars` / `tailChars` 三个字段；全仓 `grep thresholdChars` **只命中这一个包**，没有环境变量或 settings 入口。
2. 剪枝判定逐条结果：`if (totalChars <= thresholdChars) return null`；**没有工具白名单/豁免名单/scope 维度**。
3. `compaction-basic` 通过 `this.ctx.get('toolResultPruner')` 取**同一实例**，`compactIfNeeded(agent, …)` 只是用它处理不同 agent 的 session；子 Agent 经 `composeFrom` 加入父 Agent 的**同一份 standing composition**（官方文档：拿到 "that exact instance — the same plugin objects"），故主 Agent 与全部子 Agent 共用一组预算。
4. `dsh-tool-subagent` 的 config 只有 `provider/toolName/backgroundMode/agentOptions(provider/model/reasoningEffort/maxTokens)/persona/toolFilter/maxDepth`，**无任何 compaction 字段**。

**截断语义**（决定失败模式）：超限时保留 `headChars` 4096 + `tailChars` 1024，中间替换为 `PRUNE_MARKER`——目录被截断时**中间段能力消失**，头部与尾部保留。

**结论与处置**：把测试预算从 4096 提到 **6144（8192 的 75%）**，保留 2048 字符余量；`summary` 一字未改，preset 的剪枝配置一字未动（主 Agent 行为不受影响）。当前 42 个端点 3306 字符（40.4%），每端点约 79 字符，6144 预算约可容纳 **78 个端点**。若将来确实需要超过 8192，只有三条路：上调 preset 阈值（会影响主 Agent）、把目录拆成多个工具、或改紧凑编码。

**未采用的备选**：保持返回不变并调高 `thresholdChars`（协议零改动，但每次数据任务多付约 6k token，且能力继续增长时仍会触顶）；压缩 `output_schema` 字段类型（实测仍约 12KB，只能缓解）。

**改动面（子 Agent 影响仅 dc）**：`hub.ts` 新增 `listCapabilities()` 精简目录 / `capabilityNames()` / `describeCapability()`；`SchemaDescriptor` 增加可选 `summary`（缺失时退回描述首句，第三方数据源仍可用）；`fuyao-rest.ts` 18 个端点各补一行 `summary`；`tools.ts` 注册 `describe_capability` 并改 `list_capabilities` 输出；preset 的 dc `toolFilter.allow` 加 `describe_capability` 且 dc persona 补两步发现与错误码处置；skill `capital-data-protocol` 新增 §1.1。data_junior 的 allow 里没有这两个工具，主 Agent 仍被禁止直调。

## 11. Phase 3 实施记录

### 11.0 范围修正：文档实际覆盖 91 个端点，且部分能力永久不可用

对 `llm_full.md` 做全量路径提取后，实际端点数是 **91 个**（`ths_api.md` 只列了 44 个），Phase 2 结束时未实现 73 个，分布在 a-share 特色/资金/高频、fund 十余个子模块、futures、options。

**关键发现：其中一类端点永久不可用，必须排除而不是"实现成看起来能用"。** 文档在主力资金与高频动向模块标注了"该能力暂未开放外部接入"，真实请求给出决定性证据：

| 端点 | 真实响应 |
|---|---|
| `/api/a-share/capital-flow/snapshot` | `code=2004`，message：「该数据为同花顺AI客户端专用…」 |
| `/api/a-share/capital-flow/historical` | `code=2004` |
| `/api/a-share/high-frequency/intraday` | `code=2004` |
| `futures|options/calendar/session-timeline` | 文档标注"计划在后续版本接入同花顺AI客户端" |

**`code 2004` 因此升级为一等错误语义**：`callFuyao` 对 2004 单独映射为"该能力为同花顺 AI 客户端专用、当前未开放外部接入；**不要重试**，改用其他能力或如实告知用户该能力不可用"。这属于能力级不可用而非瞬时故障，若当成普通错误会被反复重试，白烧配额与回合。

**长期排除清单**（不实现、不注册、不写进 persona 能力表）：`capital-flow/*`（2）、`high-frequency/*`（2）、`futures|options/calendar/session-timeline`（2）、`/api/dump/**/download-url`（3，Phase 0 已排除）。

### 11.1 Phase 3A：a-share 特色数据与竞价基准（已完成，已真实冒烟）

新增 10 个 capability，全部经真实请求确认可用、输出护栏 10/10 判定通过：

| capability | path | 分页 | 冒烟结果 |
|---|---|---|---|
| `limit_down_pool` | `/api/a-share/special-data/limit-down-pool` | page/size | 通过（当日 0 条，合法空结果） |
| `limit_break_pool` | `/api/a-share/special-data/limit-break-pool` | page/size | 通过（当日 0 条） |
| `skyrocket_list` | `/api/a-share/special-data/skyrocket-list` | 无 | 通过（30 条） |
| `hot_stock_list` | `/api/a-share/special-data/hot-stock-list` | 无 | 通过（30 条） |
| `hot_stock_history` | `/api/a-share/special-data/hot-stock-list-history` | 无 | 通过（30 条） |
| `hot_stock_rank_trend` | `/api/a-share/special-data/hot-stock-rank-trend` | 时间窗 | 通过（11 个点位） |
| `anomaly_list` | `/api/a-share/special-data/anomaly-analysis-list` | 无 | 通过（当日 0 条） |
| `anomaly_stock` | `/api/a-share/special-data/anomaly-analysis-stock` | 无 | 通过（当日 0 条） |
| `dragon_tiger` | `/api/a-share/special-data/dragon-tiger-list` | 无（固定全量） | 通过（63 条） |
| `auction_benchmark` | `/api/a-share/auction/short-term-benchmark` | 无 | 通过（当日 0 条） |

**探针纠正了 `ths_api.md` 的四处参数错误**（文档摘要不可当契约的又一例证）：

- `hot-stock-list-history` 的 `date` 是**必填**（漏传 `code=1001`，错误信息点明参数名）；
- `hot-stock-rank-trend` 的 `thscode` 是**必填**，且另需 `start_date` + `end_date`；
- `anomaly-analysis-stock` 用复数 `thscodes`（去重前最多 50 个 token）；
- `fund/market/snapshot` 用**单数** `thscode`（`ths_api.md` 写的是 `thscodes`）。

**护栏与口径要点**：

- 新增 `array` 字段类型与 `itemKey`：龙虎榜的行数组叫 `stock_items` 而不是 `item`，且 `stock_items` 与 `hot_money_items` 两类榜单**都存在**（互斥填充为空数组），故两者都以 `array` 严格校验。
- `heat`（飙升榜/热股榜热度值）是上游原始**字符串**，转成 number 会被判契约不符。
- 跌停池与炸板池共用分页参数但 **`sort_field` 白名单不同**，不能共用枚举（跌停池无 `open_times`、炸板池无 `last_limit_time`），测试对两条白名单分别断言。
- 异动标签大小写不敏感、去重保序、**空 token 拒绝**（上游对空 token 与未知标签都返回 1002）。
- 龙虎榜的 `change` 与 `net_rate` 是**小数形式**（`0.09994` 表示 9.994%），与行情接口的百分数原值口径不同——已写进 description，这是最容易误读的字段语义之一。

### 11.2 Phase 3B：公募基金核心 14 端点（已完成，已真实冒烟）

新增 14 个 capability，真实请求 **14/14 护栏判定通过**：`fund_profile`、`fund_quote`、`fund_history`、`fund_nav`、`fund_returns`、`fund_drawdowns`、`fund_holdings`、`fund_asset_allocation`、`fund_industry_allocation`、`fund_stock_history`、`fund_holders`、`fund_top_holders`、`fund_manager`、`fund_company`。

**探针推翻了 `ths_api.md` 对基金模块的核心假设**：

| `ths_api.md` 的说法 | 实测事实 |
|---|---|
| 用 `(fund_type, thscode)` 定位，`fund_type` 取 otc/exchange/reits | **`fund_type` 不是任何请求参数**（全文只在另一个端点的**响应**里出现过一次）；14 个端点全部只用**单数 `thscode`**（带 `.OF`/`.SH`/`.SZ` 后缀）。上游会静默忽略未知参数，本地不忽略：传 `fund_type` 会被拒绝（有回归测试钉住） |
| `market/snapshot` 用 `thscodes`（复数、逗号列表） | 实际是**单数 `thscode`**，且**仅支持 ETF**；LOF/场外/REITs 返回 `code=3004` |
| 历史行情窗口与 A 股同口径 | 基金场内历史的窗口上限是 **5 个自然年**（不是 10 年），已用独立常量 `MAX_FUND_HISTORY_WINDOW_MS` 与测试区分 |
| `managers/detail`、`companies/detail` 按基金查询 | 分别只认 **`manager_id`** 与 **`company_id`**（可从 `fund_profile` 的 `manager_info[].manager_id` 与 `company_id` 取得）；用 `thscode` 查属于协议错误 |

**其它关键实测结论**（都写进了 description，因为模型最容易在这里误读）：

- `holders/top` 的 `limit` 取值 1~10（实测 0 / 11 / 201 均返回 1003），但它**限定的是报告期数而不是返回行数**——limit=10 时返回 10 个报告期共 99 行。引用条数必须用 `item` 实际长度。
- `fund_nav` 有 `range`（8 个区间）与 `nav_type`（`unit` / `adj` / `unit,adj`）两个可选参数；**未通过 `nav_type` 请求的字段不输出**，且 `nav_date` 是**毫秒时间戳**而非日期字符串；复权净值不等同于累计净值。
- `fund_stock_history` 的 `report_type` 上游**未公开枚举**（实测 `quarter` 有数据；`annual`/`half` 返回 `5003` 表示上游无该类型数据而非参数错误），因此本地**不做枚举白名单**，避免误拒上游新增类型；`rank` 仅前十大返回 1~10，其余为 `null`。
- `fund_industry_allocation` 并非所有基金都有数据：实测部分 ETF 返回 `code=5003`（上游数据源无该基金行业配置），属数据缺失而非参数错误，已在描述里说明不要重试到超时。
- `fund_manager` 的收益率口径**文档自相矛盾**（分组说明称百分数原值，官方示例却是小数形式 `0.05096597`）：描述里明确要求按原值转述并注明口径未确认，不得自行换算。
- 多处金额/份额单位（`fund_scale`、`scale`、`position_capital`、`market_value`、`hold_share`、`avg_holder_share`、`volume`、`turnover`）**文档未给出**：一律按原值转述，不擅自标成"亿元/元"。
- 标的类型不在本地判定范围：`.SH` 既是个股也是场内 ETF 的后缀，格式上无法区分，`600519.SH` 会通过本地校验，由上游按真实类型返回 3004/3001（有测试记录这一边界）。

### 11.2.2 Phase 3C：基金进阶 19 端点（已完成，已真实冒烟）

新增 19 个 capability（`fund_performance_history` … `fund_backtest_indicators`），真实冒烟 **18/19 护栏通过**，唯一未过的是上游数据缺口（见下）。`fund/news/article-list` 按用户决定**不接入**（非结构化内容已由 `web_retriever` 覆盖）。

**这一批暴露的三类结构问题（都已修）**：

1. **`data` 本身是数组的响应**：`quota/summary`、`quota/list`、`backtest/indicators` 没有 `{timestamp, item[]}` 信封。原护栏 `isRecord(data)` 直接把它们判为不符。修法：`GuardSpec` 新增 `dataArray`，并让 **custom-only 校验器完全接管顶层形状判断**（此前 `custom` 在 `isRecord` 之后才执行，导致三层嵌套的 `quota/list` 永远走不到自定义校验）。
2. **「保留上游结构」的字段**：文档把基金诊断的 `dimensions`/`resilience` 写成 object，实测是**数组**，`probabilities`/`ranges` 是 **null**。新增 `json` / `json?` 字段类型：只拒绝 `undefined`，其余一律放行（对象、数组、标量、null），描述里明确要求按原样转述、不假设内部键名。
3. **URL 编码 JSON 传参**（5 个端点）：新增 `jsonParam`，做「可解析 + 顶层形状正确 + 长度受限」校验，并用 `canonicalJson`（递归按键排序）重新序列化，使**键序不同的等价 JSON 归一到同一个 digest**。回测的 `buy_conditions`/`sell_conditions` 按文档口径接受**对象或数组**（`object-or-array`），不再只放行对象。

**值得记录的上游事实**：

- `managers/performance` 的 `range` 枚举**只有 5 个值**（month / tmonth / year / nowyear / now），与 `fund_nav` 的 8 值枚举不同——两者不能共用白名单（有测试钉住）。
- `offerings/list` 的 `subscribe` 是 `active|upcoming` 枚举，实测传 `1`/`0`/日期都返回 1003。
- `quota/*` 的 `tab` 是 **URL 编码的 JSON 数组字符串**（如 `["remen"]`），分类值由上游判定；`quota/summary` 的五个字段**全部是字符串**。
- `fund_indicator_table` 对多只基金实测均返回 `code=5003` 数据源不可用（参数被接受，属上游数据源缺口），已在描述里写明「不要反复重试」，护栏由单测覆盖。
- `fund_backtest` 的响应日期是 `yyyy-MM-dd` 字符串（不是毫秒），`curve_points` 兼容数组或对象。
- `indicators/line` 与 `indicators/table` 的响应是三层的（`time_range` 时间轴 + `indexes` 元信息 + `data[]` 序列），护栏是自定义校验器。

### 11.2.3 仍未接入的基金端点

Phase 3C 之后，fund 模块只剩 `news/article-list`（按决定不接入）。**Fund 模块接入完成。**

**目录体积**：61 个端点时能力目录 **4878 字符**（测试预算 6144，DSH 剪枝阈值 8192），约用掉预算的 79%；最大单能力详情 3891 字符（详情预算 4096，已接近上限）。继续扩容前需要先处理这两条预算（精简 summary、改紧凑编码或拆详情）。

### 11.3 futures / options：建议不接入

两个模块共 30 个端点，技术上多为 `code=0` 可用，但与产品定位不符：本 preset 的角色边界与 persona 路由只覆盖股票、指数、基金（`AGENTS.md` 角色边界未出现期货/期权），且 `data_collector` 的能力表会被无关能力稀释（目录是发现入口，越杂越难选）。建议保持排除，若将来要做期货/期权研究，作为独立 preset 或独立 capability 命名空间另立。

### 11.4 可复现的真实 REST 冒烟与独立复核（2026-09）

**背景**：此前「已真实冒烟」只存在于会话记录里，仓库无法复核；单元测试又全部替换了 `fetch`，只能证明「契约与 mock 一致」。一份独立测试报告（luna）据此指出该声明不可验证，并列出 10 条问题。

**修正一：让冒烟可复现。** 新增 `scripts/smoke-fuyao.mjs` 与 `npm run smoke:fuyao`：对**全部已注册** capability 各发一次最小请求，逐条输出上游 `code` 与输出护栏判定，支持 `--only <子串>` 与 `--json`。脚本内置「参数表必须覆盖全部端点」的自检（新增端点忘了补参数会直接报错），且**不打印密钥、不落盘响应数据**。它会先从基金基本资料解析真实 `manager_id`/`company_id`——编造的 id 会得到 `5003`，那是脚本自身的问题，不能伪装成上游故障（解析不出时显式 SKIP）。

**全量冒烟结果**：61 个端点，实跑 61，成功 58，上游失败 3（均为 `code=5003` 数据源不可用：`fund_manager_style`、`fund_manager_performance` 依赖特定经理的上游画像，`fund_indicator_table` 为上游数据源缺口），**护栏误杀 0**。

**修正二：luna 报告 10 条的核实结论与处置**（逐条核实，不采信结论本身）：

| # | 报告结论 | 核实 | 处置 |
|---|---|---|---|
| ① | `fund_returns` 拒绝官方合法响应 | **属实**：官方示例只有 8 个 `return_*`，**没有 `return_week`**，而护栏把它设为必需 | 全部字段改可选，另用自定义校验要求「至少命中一个收益/排名族字段」；新增以官方示例为输入的回归测试 |
| ② | 共享 manifest lookup 绑定首个调用者的取消信号 | **属实**：`cacheLookups` 的 Promise 传入了首个调用者的 `signal` | `findLatest` 不再接收任何调用者信号；新增「首调用者取消后其余调用者仍完成」的并发测试 |
| ③ | 错误 code 未结构化穿过 Hub | **属实**：`DatasetStoreError.code` 被拍成纯文本 Error | Hub 重新包装时保留 `code`；断言 `error.code === 'workspace_not_writable'`，并断言普通错误不会被伪造 code |
| ④ | `fund_indicator_table` 分页标记错误 | **属实**：有 `page_info` 却未标 `paginated` | 补 `paginated: true` 并重生成能力总表 |
| ⑤ | `anomaly_list.tag_codes` 声明为单值 enum | **属实**：实现支持逗号 OR，schema 却给单值 enum | 移除 enum，合法值写入描述并注明可组合；新增「不得带单值 enum」的测试 |
| ⑥ | `ticker_search` 未实现文档声明的交易所/资产类型 | **属实**：文档支持 11 个交易所与 futures/options，本地只放行 3 个与 7 类，且与 `ticker_list` 不一致 | 按官方契约全量放开（**元数据域**）；描述与总表明确「期货/期权仅可消歧，本 preset 不提供其数据端点」 |
| ⑦ | 基金行情 `timestamp` 的 schema 不允许 null | **属实**：运行时放行 null，但 `envelopeData` 声明为 integer | envelope 的 `timestamp`/`total` 改为 `integer \| null` |
| ⑧ | 「61 个均已冒烟」不可复核 + 计数冲突 | **属实**（Phase 2 那轮实为 17 个、漏了 `quote`；无 fixture；真实源测试均为合成响应） | 见上文「修正一」；§10.0 的计数与遗漏已如实更正 |
| ⑨ | `apply()` 装配路径无集成测试 | **属实**：此前无任何测试调用 `apply()` | 新增 `test/apply-integration.test.mjs`：有 Key 时注册 61 个源与完整工具表、无 Key 时工具仍可见且 `dc_status` 说明原因、credentials 优先于环境变量、customPersona 注册独立节 |
| ⑩ | 设计文档仍保留旧 `list_capabilities` 协议 | **属实**：§2 仍写 5 字段全量形态 | 已改为两级发现并注明旧形态不再支持 |

**结论修正**：此前「61 个端点均已真实冒烟」的表述**证据不足**——当时的证据只存在于会话记录里。现在的准确表述是：61 个 capability 已注册、参数/输出契约有 mock 测试、**并可由 `npm run smoke:fuyao` 对真实 REST 复核**（2026-09 实测：58 成功 / 3 上游 5003 / 护栏误杀 0）。

## 12. 完成标准

Phase 0 只有在以下条件满足后才进入实现：

- 首批 endpoint 的参数和输出契约都有来源行号。
- `ths_api.md` 与 `llm_full.md` 冲突项都有明确决策。
- 旧 `DatasetRef`、`request_data` 和 `list_capabilities` 协议没有被扩展性设计破坏。
- dump、自动翻页、基金和其他数据源的边界被明确排除或延后。
- contract fixture 可以直接驱动后续 source 单测，而不是只作为说明文档。
