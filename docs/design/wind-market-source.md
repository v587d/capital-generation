# 初步设计方案：引入 Wind（AliceMarket wind-mcp-skill）作为第二数据源

> 状态：**§6.7 改口后的 P1 已落地（2026-10-06）**，三条 capability 已注册。
> **§1–§3 与 §6 冲突处一律以 §6 为准**；§6.9 是第二轮真报文（推翻 §6.6.1 里"港美股分钟已证实"那一条），
> §7 是实现落点。**§7 之后的事实以代码为准**：参数面与护栏的真值住在
> `src/sources/wind-mcp.ts`，逐条说明走 `describe_capability`，本文件只留"为什么是这个形状"。
> §1 的结论抄自 gitee.com/WindAlice/AliceMarket `skills/wind-mcp-skill` 2.0.4 的文档，
> §6 与 §6.9 是打到 `mcp.wind.com.cn` 线上（server 1.25.0）的真报文。

---

## 1. 上游调研结论

### 1.1 是什么

- 运营方：万得艾思（深圳）科技有限公司（Wind 体系），门户 <https://aifinmarket.wind.com.cn>，API Key 在门户领取。
- 形态：7 个托管 MCP server（JSON-RPC 2.0 over HTTP，`initialize` → `tools/call`），`Authorization: Bearer <key>`，
  响应正文在 `content[0].text`（多为 JSON 字符串），兼容 SSE 行格式。
- 仓库未声明 LICENSE。**处置惯例已存在**：`wind-client.ts` 的协议蓝本（cli.mjs）一直是本地参考副本、不入库；
  本方案继续只抄「端点常量 + 错误码映射」这类事实，不搬运代码。

### 1.2 七个 server 与端点

| server_type | 端点 | 能力 |
| --- | --- | --- |
| stock_data | `https://mcp.wind.com.cn/vserver_stock_data/mcp/` | 股票筛选/行情/K线/**分钟**/档案/财务/**股东**/**事件**/技术/风险，覆盖 A股+港股+美股 |
| fund_data | `.../vserver_fund_data/mcp/` | 基金筛选/行情/K线/分钟/档案/财务/持仓/业绩/持有人/公司 |
| index_data | `.../vserver_index_data/mcp/` | 指数/板块 档案/基本面/技术/行情/K线/分钟 |
| bond_data | `.../vserver_bond_data/mcp/` | 债券档案/发债主体/行情估值/主体财务 |
| financial_docs | `.../vserver_financial_docs/mcp/` | 公告/新闻 RAG —— **已接入**（web_retriever 的 `wind_docs_*`） |
| economic_data | `.../vserver_economic_data/mcp/` | 宏观/行业/汇率 EDB 指标 |
| analytics_data | `.../vserver_analytics_data/mcp/` | NL→跨标的聚合/加权/排名（计费高，明确不建议常用） |

### 1.3 工具形态：两类，混合存在（关键发现）

1. **结构化参数工具**（输出形状稳定，可 guard）：
   - `get_stock_kline`：`windcode + begin_date/end_date + period(1min~1y) + count + aftype(0前/1后/2不复权) + issusp`；
   - `get_stock_quote`：分钟线（单日约 240 条，begin/end）；
   - `get_stock_price_indicators`：截面行情指标，`windcode` 逗号分隔**单次 ≤50**，`indexes` 逐字取自指标集文档；
   - `search_economic_indicator`（EDB 指标元信息）与 `query_economic_indicator_data`（时序，`beginDate+endDate` 或 `observation` 互斥；返回 `{meta, date[], value[]}` **并行数组**）。
2. **自然语言 `question` 工具**（后端 NER，输出结构不保证）：
   - `search_stocks`（NL 选股）、`get_stock_basicinfo` / `get_stock_fundamentals` / `get_stock_equity_holders` /
     `get_stock_events` / `get_stock_technicals` / `get_risk_metrics`，bond 域与 `analytics_data.get_financial_data` 同类。

### 1.4 计费、限流与响应归一化（纪律来源）

- **消耗积分**，429 = RATE_LIMIT。官方 skill 纪律：默认串行、先发探针、AUTH/RATE_LIMIT/后端错误不得重试、
  不得切 analytics_data 伪装覆盖。这与现行 `wind_docs_*`「AUTH/额度类错误不重试」纪律同源，可直接沿用。
- 成功响应里的后端字符串 `INVALID` 表示缺失/不适用，**必须按 null 处理，不得按 0 参与计算**；
  `excelTotalCount` 不可信，不得作为结果总数。
- 单次调用工具参数本身有批量上限（price_indicators ≤50 标的），与并发上限相互独立。

---

## 2. 与项目现状的对照

### 2.1 已有的可复用资产

| 资产 | 状态 | 对本方案的意义 |
| --- | --- | --- |
| `src/web-retriever/wind-client.ts` | 已实现：零依赖 JSON-RPC + SSE 解析 + 三层业务错误解包 + 退避重试 + AUTH/RATE_LIMIT/NETWORK/BACKEND/INVALID 分类 | **唯一缺的是 endpoint 可参数化**（当前硬编码 financial_docs 端点）。改造成多 server 是一次性小改 |
| `wind_docs_*` 双工具 + 检索纪律 | 已在用，Key 解析（credentials/env）成熟 | 同一 Key、同一积分池；web_retriever 与市场数据共用时需要在回执中带来源标注 |
| Hub `DataSource` 契约 | `schema + execute + validateOutput + normalizeParams`，`rowShape` 显式声明行数组位置 | 第二数据源就是再实现一批 `DataSource`；`rowShape`/文档型 Dataset 先例（`financial_indicators`、`fund_backtest`）都在 |
| 能力两级发现 | `list_capabilities`（目录 ≤6144 字符预算）+ `describe_capability` | 目录预算是**硬约束**：当前 61 端点 ≈ 4.8k 字符，余量约 1.3k；`paginated` 字段已预留 |
| data_junior / Dataset 纪律 | 只看 DatasetRef，不感知数据源 | **双源对子 Agent 全透明**，编排层几乎零改动 |

### 2.2 Wind 相对 fuyao 的真实增量（决定首批上什么）

| 数据 | fuyao 现状 | Wind | 优先级 |
| --- | --- | --- | --- |
| 宏观/行业/汇率 EDB 时序 | **无**（上游明说宏观不在公开能力内） | economic_data | **P0**，唯一来源 |
| 分钟行情 | 无（明说不公开分钟 K） | get_stock_quote | **P0**，唯一来源 |
| 港股 / 美股 | 无（仅 A 股） | stock_data 覆盖 A/HK/US | **P0** |
| 周/月/年 K、复权口径选择 | 只有日 K + 复权因子 | get_stock_kline period/aftype | P1 |
| 债券域 | 无 | bond_data | P1 |
| 股本/股东/限售解禁 | 无 | get_stock_equity_holders | P1（NL 工具） |
| 公司事件（分红/增减持/解禁/ST/诉讼） | 部分（corporate_actions 只有除权除息） | get_stock_events | P1（NL 工具） |
| NL 选股（条件反查代码） | 无 | search_stocks | P2（NL 工具） |
| 批量截面行情/估值 | 有（quote/valuation 快照，多标的） | get_stock_price_indicators（≤50/次） | P2，重复度高，仅当需要 Wind 口径对账 |
| 基金 | **全覆盖且口径细** | fund_data 大量重叠 | 暂不接，fuyao 优先 |
| 技术指标/风险指标（MACD、Beta、VaR…） | 无（且 data_analyst 未启用，本地无计算路径） | get_stock_technicals / get_risk_metrics | **谨慎**：口径黑盒、NL 入参，数据可核查性差；如上，description 必须写明口径不可本地复算 |

结论：**不要做 fuyao 的镜像**。Wind 的接入原则是「补 fuyao 明确没有的」，重叠能力继续走 fuyao（结构稳定、REST、无积分焦虑）。

---

## 3. 设计方案

### 3.1 总体形状

```text
src/web-retriever/wind-client.ts      # 改造：endpoint 参数化（多 server 复用同一传输/解包/重试）
src/sources/wind-mcp.ts               # 新增：Wind 数据源端点定义表（与 fuyao-rest.ts 同构）
src/data-collector/hub.ts             # 不改：registerSources 追加 wind 来源即可
preset skills（capital-data-protocol）# 增补：Wind 来源的路由规则、来源标注、积分纪律
test/wind-mcp-source.test.mjs         # 新增：契约 + guard 用官方示例回归
```

- 模型侧 capability 命名：`wind_` 前缀 + 域名（`wind_stock_kline`、`wind_stock_minute`、`wind_edb_query`…），
  保持 capability 全局唯一；`data_key` 由 `buildDataKey('wind', kind, resource)` 内部生成，不进模型协议。
- `SchemaDescriptor.source_label: 'Wind（万得）'`，让 request_data 回执自带来源标注。

### 3.2 wind-client.ts 改造（最小侵入）

```ts
// 现状：DEFAULT_WIND_ENDPOINT 硬编码 financial_docs
// 改造：createWindClient({ endpoint }) 已支持传端点 → 增加 WIND_SERVER_ENDPOINTS 常量表
//       （七条，逐字抄自 cli.mjs SERVERS），web_retriever 与 wind-mcp 源各自构造自己的 client 实例
export const WIND_SERVER_ENDPOINTS = {
  financial_docs: 'https://mcp.wind.com.cn/vserver_financial_docs/mcp/',
  stock_data: 'https://mcp.wind.com.cn/vserver_stock_data/mcp/',
  economic_data: 'https://mcp.wind.com.cn/vserver_economic_data/mcp/',
  /* fund/index/bond/analytics 二期按需补 */
} as const
```

保持每次调用重解析 Key、无会话态、超时与重试现状不变。**注意**：wind-client 现有 initialize→tools/call
每调用各一次（无会话复用），接市场域后单次取数变两次 RTT，可接受；不要为省 RTT 引入会话缓存（与 anysearch engines 无状态策略一致）。

### 3.3 Phase 1（最小可用）：只上结构化参数工具

首批 5 个 capability：

| capability | 上游工具 | 关键设计点 |
| --- | --- | --- |
| `wind_stock_kline` | `get_stock_kline` | 参数直映射（windcode/begin_date/end_date/period/aftype/issusp/count）；`input_schema` 枚举写死 period；description 写明：港股美股代码 `AAPL.O`/`00700.HK` 直查；**不猜交易所后缀** |
| `wind_stock_minute` | `get_stock_quote` | begin/end 可选（缺省最新交易日）；description 警告跨日体积放大，长区间改用 kline 的分钟 period |
| `wind_price_indicators` | `get_stock_price_indicators` | `windcodes` 拆分 ≤50 强制分批由**调用方**（模型）负责，schema 上 `maxItems` 语义写成 ≤50；indexes 默认省略走上游默认值，指定时必须逐字来自指标集文档 |
| `wind_edb_search` | `search_economic_indicator` | 只找指标不取数；返回 metrics 元信息数组 |
| `wind_edb_query` | `query_economic_indicator_data` | beginDate+endDate 与 observation **互斥**；返回 `{meta, date[], value[]}` 并行数组 |

**EDB 并行数组的落库形状（关键决策）**：`date[]`/`value[]` 不是行数组，直接存会让 data_junior 读不到行。
处理原则「谁产出谁归一」：`execute()` 内把 `{meta, date[], value[]}` **转置为行数组**
`[{ code, name, unit, source, freq, date, value }]`（多指标时拼接），`rowShape.rowKey: 'rows'` 显式声明，
guard 按转置后形状校验。原 meta 写进文档层字段。**上游原始 JSON 仍原样存 raw.json，转置发生在产出层**（Dataset store 的行视图与 raw 分离，符合现有「行数组位置由数据源声明」的精神）。

**护栏（guard）纪律**：官方 skill 文档中的返回示例写进回归测试；`INVALID → null` 在产出层执行并生成
`warnings: [{code: 'BACKEND_INVALID_AS_NULL', count}]`；**不读 excelTotalCount 判完整性**；
空结果（非交易日分钟线返回空）是合法成功，不是错误。

**错误处理**：wind-client 五类错误码 → Hub 错误信封；AUTH/RATE_LIMIT/BACKEND **不自动重试**，
description 写明「不要反复重试，积分计费」（同 fuyao 5003 纪律）；仅 NETWORK 走既有退避重试。

### 3.4 Phase 2：NL 工具走「文档型 Dataset」路线

`search_stocks`、`get_stock_equity_holders`、`get_stock_events`、`bond` 域等 `{question}` 工具：

- `input_schema` 就是 `{ question: string }`（≤500 字符，同 wind_docs 三要素纪律：实体 + 指标 + 时间）；
  params_digest 对 question 字符串做 trim + 空白归一后计算，**同 question 复用同一 Dataset**。
- 输出顶层是文档对象、行结构由后端 NER 决定 → 按**文档型 Dataset**落库（先例：`financial_indicators`、`fund_backtest`），
  不强行声明 rowShape；data_junior 的 `document` 有界回传通道天然适配。
- `description` 必须写明：结果结构以后端实际返回为准、单位以返回体元数据（`data.unit`）为准、
  **数值口径不可本地复算**（尤其 technicals/risk_metrics），引用时注明「来源：万得 Wind 金融数据服务」。

### 3.5 Phase 3：编排与协议整合

- `preset/capital-generation/skills/capital-data-protocol/SKILL.md` 增补：
  - 路由规则：**宏观 EDB / 分钟行情 / 港美股 / 债券 / 股东事件 → wind；A 股基础行情/财务/基金/特色数据 → fuyao 优先**；
    同一数据双源都有时不得混用口径出同一结论。
  - 来源标注沿用现有措辞：「来源：万得 Wind 金融数据服务」。
  - 积分纪律：市场域 wind 调用同样「按需少量、AUTH/RATE_LIMIT 不重试、失败转 fuyao 或明示缺口」。
- `data_gap` / data_junior / visualization gate **零改动**（对子 Agent 双源透明）。
- 主 persona 路由表若列 capability 名单，只加 `wind_` 前缀说明，不逐个枚举（防 persona 膨胀，规则外迁 skill）。

### 3.6 目录预算与测试

- 预算：Phase 1 新增 5 个端点 ≈ +400 字符（61→66，约 5.2k），6144 预算内可容纳；Phase 2 再加约 5~8 个时会逼近上限，
  届时启用已预留的 `paginated` 目录分页，而不是上调 pruner 阈值（阈值改了是全会话一起改）。
- 测试（对照验收纪律逐条落实）：
  1. `npm test` 全绿；`npm run docs:capabilities` 重新生成总表（断言文档与实现一致）；
  2. guard 用官方 skill 文档示例回归——**先拿示例验证护栏，护栏杀官方示例 = 事故**；
  3. `test/apply-integration.test.mjs` 的根 object 断言自动覆盖新工具（新工具必须经 apply() 注册）；
  4. 新增 hub 用例：EDB 转置 rowShape、question 归一化幂等、INVALID→null 警告、错误码分类；
  5. 冒烟：`npm run smoke:wind`（可选、需真实 Key），逐条报告上游回执与 guard 判定；冒烟内不做并发探针以外的批量调用。

### 3.7 不做什么（明确边界）

- 不接 fund_data（与 fuyao 高度重叠且 fuyao 口径更细）；不把 `analytics_data` 注册成常规 capability（计费高、
  官方明确不建议，仅在未来确有跨标的聚合需求时单独评审）。
- 不做本地 K 线缓存/marketdb 式建库——保持「内存只留 in-flight、Dataset 7 天保留」的现状。
- 不在模型协议暴露 server_type；server_type 是宿主路由细节（同 data_key 不进协议同理）。

---

## 4. 风险与开放问题

1. **积分成本不可见**：request_data 无计费概念。缓解：source_label 标注 + skill 纪律；可选二期在回执里加
   `provider: 'wind'` 字段方便用户对账。**需要用户提供 Key 并接受积分消耗后才可冒烟。**
2. **NL 工具的可复现性**：同 question 后端 NER/口径可能漂移，Dataset 复用（params_digest）语义要写清：
   复用的是「该次返回」，force_refresh 才重取。
3. **双源口径冲突**：同一指标（如 PE）fuyao 与 Wind 数值可能有口径差。协议里写死「同一结论不得混源拼口径」。
4. **上游无 LICENSE 仓库**：只读文档与常量、不拷代码；cli.mjs 参考副本延续不入库惯例。
5. **目录预算**：Phase 2 前需决策是否启用 paginated 目录（实现已留字段，但分页 UI/协议未经实测）。

## 5. 工作量粗估

| 阶段 | 内容 | 粗估 |
| --- | --- | --- |
| Phase 1 | client 参数化 + 5 端点定义 + EDB 转置 + guard/测试 + docs | 1~2 天 |
| Phase 2 | NL 工具 3~5 个 + 文档型 Dataset 适配 + 测试 | 1 天 |
| Phase 3 | skill/协议增补 + 冒烟 + 真机会话验证 | 0.5~1 天 |

---

## 6. 真报文 spike（2026-10-05，`WIND_API_KEY`，线上 server 1.25.0）

仪器是 `scripts/spike-wind.mjs`（Key 解析与 `smoke-fuyao.mjs` 共用 `scripts/lib/credentials.mjs`）：

```bash
node scripts/spike-wind.mjs --auth                 # 逐 server initialize
node scripts/spike-wind.mjs --list                 # 逐 server tools/list（不计费）
node scripts/spike-wind.mjs --call stock_data::get_stock_kline --args '{...}' --repeat 2
```

它打印的是**形状与键名**（列名、类型混排、null/INVALID 计数、unit 键、重复调用差异），不落盘正文、不打印 Key。
本节每条结论都能用上面第三行复现；共约 24 次真实调用。

### 6.1 连通性与真实工具面

六个 server 应答 `wind-mcp-streamable-http-stateless 1.25.0`；**`analytics_data` 连 `initialize` 都挂满 60 秒**，
`tools/list` 同样超时——§3.7「不接 analytics」现在有实测背书（不是"不建议"，是不可用）。

| server | 工具数 | 结构化参数工具 | NL `question` 工具 |
| --- | --- | --- | --- |
| stock_data | 10 | `get_stock_kline` / `get_stock_quote` / `get_stock_price_indicators` | 7（basicinfo / fundamentals / equity_holders / events / technicals / risk_metrics / search_stocks）|
| fund_data | 10 | kline / quote / price_indicators | 7 |
| index_data | 6 | kline / quote / price_indicators | 3 |
| bond_data | 4 | **无** | 4（全部 NL）|
| economic_data | 2 | **无**（见下） | 2 |
| financial_docs | 2 | — | 2（`query`，已接入）|

**推翻 §1.3 的第一处**：EDB 两个工具都以 `question` 打头，`beginDate/endDate/observation` 只是修饰，
不存在"按指标码取数"的独立参数。但实测**指标代码可以直接当 `question`**：
`question:"M0000612"` 与 `question:"中国 CPI 当月同比"` 回**同一份序列**（同 meta、同 date[]、同 value[]）——
所以确定性靠"先 search 拿 code，再按 code 取数"两步拿到，不是靠 NL 稳定。

**第二处**：线上 `query_economic_indicator_data` 的 schema 还有 `targetMagnitude` / `targetCurrency` /
`targetFrequency`（枚举含 十万分之一…年度），而蓝本 `call-rules.json`（schema_version 18）的 `allowed`
里根本没有这三个键——上游文档与线上已经漂移。这三个键**未实测，不进入我们的参数面**。

### 6.2 形状：表格工具回的不是行对象

统一形状 `data.{columns:[{name,type}], rows:[[标量]], unit:{}}`；NL 与 search_stocks 多套一层 `data.data[i]`。
三件事由此决定 producer 的工作量：

1. **行是标量数组**，必须按 `columns[i].name` 转置成行对象才能进 Dataset（§3.3 里给 EDB 写的
   "并行数组转置"其实是**全部表格工具的通用要求**，不止 EDB）。
2. **类型口径逐工具不同**：`get_stock_kline` / `get_stock_quote` 的**所有数值都是字符串**
   （`"1318.00"`、`"2302823753"`），而 `get_stock_price_indicators`、EDB、NL 工具回真 number；
   同时 `columns[].type` 一律写 `string`——**类型元数据不可信**，producer 必须自己解析并在解析失败时响亮失败（§9.5）。
3. **空结果是合法成功**：非交易日 2026-10-01..03 回 `ok=true`、`rows=[]`、`unit=null`，`columns` 仍给 10 项。
   guard 不许把 0 行判成失败，但要认得"薄表"（不存在的代码 `999999.SZ` 回过一行只有 `Wind代码` + `最新交易日` 两列）。

### 6.3 键名与单位（§10.6 的落点）

- **两套列名口径**：K 线/分钟是大写 ASCII（`TIME OPEN MATCH HIGH LOW TURNOVER VOLUME CHANGEHANDRATE AVPRICE`，
  **没有 CLOSE 列——`MATCH` 就是收盘价**）；`price_indicators` 与全部 NL 工具是**中文列名**
  （`最新交易日` / `Wind代码` / `2025年年度归母净利润`），`unit` 的键更恶劣：`"HIGH 单位："`——**空格 + 全角冒号**。
- **NL 工具的列名由 `question` 决定**（问什么列名就是什么），所以它的输出面**无法声明 `output_schema` 字段字典**——
  这一条直接否掉 §3.4 的"NL 走文档型 Dataset 再注册"：行键是问题文本的函数，`query_dataset` 的点列名、
  profile 的类型推断、§9.6 的 schema 满足性全都无处锚定。
- 单位能闭合，靠的是报文自身的算术：`AVPRICE × VOLUME = TURNOVER` 逐行成立
  （1,313.34 × 1,753,404 ≈ 2,302,823,753；分钟行 1,282.32 × 104,700 ≈ 134,258,950）→
  **VOLUME 单位是股**（⚠️ 腾讯 A 股 K 线的 volume 单位是**手**，同一指标两名两值，跨源比必须先换）；
  换手率 `CHANGEHANDRATE` 无 unit 项，用两个独立交易日反推分母同为 12.4–12.5 亿股
  （1,753,404 ÷ 0.1403%、3,215,644 ÷ 0.26%）→ **百分数原值**，不是小数占比。
  NL 财务的单位逐列写在 `columns[].unit`（亿元 / 亿港元），这是唯一带单位自述的一族。

### 6.4 时间：一张表里三种写法

K 线与分钟带偏移且是**交易所当地**（A股/港股 `+08:00`、美股 `-04:00`）；EDB 的 `date[]` 是
`"20260731"` 紧凑串；`price_indicators` 同表并存 `最新交易日="20260930"` 与 `交易时间="2026-09-30T15:30:28+08:00"`，
而**美股那一行两者不一致**（交易日 20261002、时间戳 2026-10-05T08:02-04:00——盘前实时值挂在上一收盘日下面）。
结论：时间轴取哪一列必须逐能力定死；epoch 一律**逐行按该行自带偏移**换算（`query-time.ts` 的轴只有一个 `time_zone`，
把美股整段当 +08:00 会错位 12 小时）。

### 6.5 `period` 与复权：蓝本映射表不能照抄

- 线上同时接受数字码与 CLI 写法（`period:"10"` 与 `"1d"` 回同一结果）。
- **未识别的 `period` 不报错，直接挂满 60 秒**（`"bogus"` 实测）；`aftype` 反而会秒回
  `Invalid value '9' for field 'aftype'`。⇒ `period` 必须由我们的 `input_schema` 锁枚举，
  且**每放一档都要一次真报文**——这是本次唯一能杀死请求的入口参数。
- 实测通过的档：`10` 日 / `11` 周（首根 2024-01-05，周五=周尾标签）/ `12` 月（2024-01-31）/
  `1` 1分钟 / `3` 5分钟（09:35）/ `5` 15分钟（09:45）/ `6` 30分钟（10:00）。
  **`7`（60分钟）两次都挂**（含窄区间单日重试）→ 不提供；`4` 10分钟、`8` 120分钟、`9` 240分钟、
  `13` 年、`14` 季、`15` 半年未测 → 不提供。
- 复权：`aftype:"2"` 不复权稳定；`"0"` 前复权**必须给 `afdate`，且 `afdate` 不早于区间**——
  不给 afdate 挂 60s，`afdate` 早于区间也挂 60s；实测 `afdate=2026-10-05` 把 2024-01-02 的收盘
  从 1685.01 压到 1531.22（×0.9087，与累计分红同量级）✓。`"1"` 后复权是**以 `afdate` 为锚向未来放大**：
  `afdate=2024-01-02` 时 2026-09-08 收盘 11321.36（÷1309.30 = 8.65 倍 ✓），但 `afdate=今天` 时
  2024 的棒**逐位等于不复权**——把 hfq 的锚默认成"今天"就是给一个名字骗人的序列（腾讯美股 hfq 同款事故）。
  ⇒ **只提供 `none` 与 `qfq`（`afdate` 由我们锁成当日）**，`hfq` 明确拒绝并写明理由。

### 6.6 可复现性

同参数重复调用**逐字节一致**：`get_stock_kline`（2 次）、`query_economic_indicator_data`（2 次）、
`get_stock_fundamentals`（2 次）。不稳定的只有非法输入——`999999.SZ` 一次回两列薄行、一次挂 60 秒，
`NOTACODE` 回 `未识别到有效的金融标的:NOTACODE`（秒回）。另外两条代码写法事实：港股输入 `00700.HK` 被收、
**输出回 `0700.HK`**（不补前导零）；美股 `AAPL.O` 与 `AAPL.N` 回**完全相同**的行 → **交易所后缀不参与解析**，
双市场代码（BRK.B 一类）有认错标的的风险，description 必须写明白。

**但"该日没有数据"表现为挂死，不是空表**：`00700.HK` 的分钟线在 `2026-09-30` 正常回行
（09:30 一根，成交额 565,675,727 港元 / 成交量 1,317,177 股 / 换手 0.0145%），而 `2026-10-02` 与
`2026-10-05` **两次都挂满 60 秒**；同期港股日线正常、A 股分钟正常、`AAPL.O` 的 `2026-10-02` 分钟也正常
（09:30 一根，成交额 186,769,935）。⇒ 分钟数据的落地各市场有延迟，而**缺数与故障在线上不可区分**
（都是 60 秒超时）。这条决定实现：分钟档必须用**显著短于** `WIND_REQUEST_TIMEOUT_MS` 的超时，
且回执要能表达"该日该市场分钟未取到"，不许伪装成网络故障诱导用户重试（§10.4 同一族）。

### 6.6.1 与已注册腾讯四条的真实差集（"Wind 补港美股"这个说法要收回）

`tencent_hk_quote` / `tencent_us_quote` / `tencent_hk_kline` / `tencent_us_kline` 已经占了港美股的快照与
日/周/月线，所以 `get_stock_kline` **不是市场覆盖上的突破**。对齐后只剩三点，每点都带边界：

| 差集 | 腾讯现状（注册时写进 description 的原话） | Wind 实测 | 边界 |
| --- | --- | --- | --- |
| 港美股**分钟线** | 「⛔ 没有分钟线（实测 hk 走 mkline 连接失败、走 proxy 主机回 code -1）」 | A股/港股/美股 1min 均取到真报文 | 近端日期缺数表现为挂死（§6.6） |
| **按日期区间**取历史 | 港美股「不支持日期区间…只有 count 1..640」 | `begin_date`/`end_date` 生效 | 640 根之前的历史只有 Wind 拿得到 |
| 美股 K 线的成交额与换手 | 「美股 K 线只有 OHLCV」（qfq 与 none 两个入口都只回六列） | 每根带 TURNOVER / VOLUME / CHANGEHANDRATE / AVPRICE | 币种与量纲要按市场标 |

**不算增量的**：复权（腾讯港股 qfq/hfq/none 都有、美股有 qfq，而 Wind 的 hfq 锚点语义危险、本就不准备放）；
快照（腾讯 + 东财截面已覆盖）；A 股分钟（腾讯 `m1/m5/m15/m30/m60` 已在）。
真正的唯一来源从头到尾是 **EDB 宏观/行业/汇率**（fuyao 无宏观、东财只有我们补的那 9 张 CN 表、腾讯不做宏观），
与港美股无关。§6.7 的排序按此改：EDB 两条 P0，`wind_stock_kline` 降 P1 且理由改写成"分钟 + 区间 + 美股成交额"。

### 6.7 首批接入结论（改口后的 Phase 1）

§3.3 那份"5 条"里有两条不该上、该上的又少一条：

| capability | 上游工具 | 增量 | 参数面（逐项实测） | producer 要做 |
| --- | --- | --- | --- | --- |
| `wind_edb_search` | `search_economic_indicator` | fuyao 无宏观；东财宏观只有我们那 9 张 CN 表 | `question`（NL） | 唯一能**直接落**的一族键：`code/name/unit/source/updateDate/beginDate/endDate/freq` 全是 ASCII camelCase |
| `wind_edb_query` | `query_economic_indicator_data` | 同上，且覆盖行业/汇率/全球 | `indicator`（代码或 NL，二选一语义已在 §6.1 实测）、`start_date`/`end_date`；**拒绝 `observation`**（给 3 只回 2 期） | 并行数组转置 + 紧凑日期 + meta 展开 |
| `wind_stock_kline`（P1） | `get_stock_kline` | **不是市场覆盖**（港美股日线与快照腾讯已有）：只剩 §6.6.1 那三点——港美股分钟、按区间取 640 根之前的历史、美股 K 线的成交额与换手 | `code`、`start_date`/`end_date`、`period` ∈ 实测六档、`adjust` ∈ none/qfq | 转置 + 字符串→数值 + 逐行偏移换 epoch + `MATCH→close` 等映射表 + 分钟档独立短超时 |

不接（每条都给得出理由）：`get_stock_price_indicators`（中文键快照，腾讯/东财同位已覆盖，`indexes`
没有指标集文档、口径无法验）；**全部 NL 工具**（§6.3：列名是 question 的函数，schema 无处锚定）；
bond 四工具（全 NL）；fund/index（与 fuyao 重叠且未测）；`analytics_data`（不可用）。
分钟线不单独立 capability——与 `period` 走同一条 `wind_stock_kline`，避免同一序列两个入口（§9.7）。

### 6.8 spike 没回答的（注册前还要验）

1. **积分成本仍不可见**：门户没读到余额/单次消耗，`request_data` 也没有计费概念。注册前要先定"额度类错误
   怎么回、回给谁"，否则一次 NL 选股烧掉的量无人知晓。
2. `count` 的负值（从区间末往前取 N 条）与 0（全区间）只按蓝本理解，未实测；周/月根的**标签日口径**
   （周尾周五 / 月末）需要一根根核对才能写进 description。
3. 分钟线的**近端可用性**没定性：港股 `2026-10-02`/`10-05` 两次挂死而同标的同期日线正常、美股
   `10-02` 分钟正常——像落地延迟而不是市场不支持，但要再多打几只标的与几个交易日才敢写进 description。
   实现无论结论如何都要按"可能挂"设计（分钟档独立短超时 + 回执区分"未取到"与"网络故障"）。
4. `issusp`（停牌行是否出现）未验；薄表判定规则要在 guard 里定死并配真报文回归。
5. 长区间体积：320 根日 K 的 Dataset 大小与 data_junior profile 表现，注册后要跑一轮真实子 Agent。


### 6.9 第二轮真报文（2026-10-06，注册前把两个常量定在证据上，8 次）

`node scripts/spike-wind.mjs --list` 那部分不计费，逐条复现见下（同一仪器，正文仍不落盘）：

| 请求 | 结果 | 由此定死的事 |
| --- | --- | --- |
| `economic_data::search_economic_indicator` `question:"人民币兑美元汇率 指标"` | **2210ms 健康**，3 行 7 列 | ⛔ **键集随指标族变化**：这一族只有 `code/name/source/updateDate/beginDate/endDate/freq`，**没有 `unit`/`magnitude`/`currency`**（§6.7 说的"GDP 那套 ASCII 键"不是全集）。NL 还把"人民币兑美元"匹配成 **美元兑人民币**（source 美联储 / 台湾统计局）——反向口径 |
| `economic_data::query_economic_indicator_data` `question:"M0000612,M5567876"` + 区间 | **挂满 60 秒** | ⛔ 蓝本 `references_economic.md` 的"多个代码用英文逗号分隔"**线上不成立**。参数面一次只接受一个指标，逗号在参数层直接拒 |
| 同上 `question:"M0000612"` + 区间 | **590ms 健康**，`{metrics:[{meta,date[],value[]}]}`，20 期 | 单码取数是快路径；`date[]` 紧凑串 + `value[]` 真 number（§6.2 第 2 条再证一次：`columns[].type` 那套不可信用不到 EDB 上） |
| `stock_data::get_stock_kline` `600519.SH` `period:"1"` `2026-10-02` | **653ms 快回 `rows=[]`** | ⛔ 修正 §6.6 的普遍性：**A 股缺日（国庆休市）表现为空表，不是挂死**。"没有数据"至少分两种形态，实现必须两条都接住 |
| `00700.HK` `period:"1"` `2026-09-30` / `2026-09-18` | **两次都挂满 60 秒** | §6.6 那句"港股 09-30 分钟正常回行"是 **`get_stock_quote`** 那条路；`get_stock_kline` 的分钟档今天没给出过港股分钟 |
| `AAPL.O` `period:"1"` `2026-09-18` | **挂满 60 秒** | 同上：美股分钟走 kline 这条路今天**未证实** |
| `00700.HK` `period:"10"` `2026-09-01..30` | **挂满 60 秒**（而 §6.5/§6.6 昨天记录"同期港股日线正常"） | `stock_data` 的**可用性本身**在观察窗口内不稳定（§6.6 的 `999999.SZ` "一次回薄行、一次挂死"是同一件事的另一面） |

三条结论改掉了 §6.6.1/§6.7 的三处说法：

1. **"港美股分钟线"从"已实测取到真报文"降级为"未证实"**。§6.6.1 差集表第一点靠的是
   `get_stock_quote` 的回执，而本方案走的是 `get_stock_kline` 的 `period` —— 同一段分钟数据
   两个入口，只有前者有报文。分钟档仍然提供（七档每档都有过真报文，见 §6.5），但
   description 不许写"港美股分钟已验证"，只写"近端日期可能取不到，且取不到时表现为挂到超时"。
2. **`query_economic_indicator_data` 一次只能取一个指标**，多指标要靠调用方分次取再按 `code` 拼。
   §3.3 里"多指标时拼接"的实现照做，但那是**防御性**的（NL 问句可能命中多个指标），不是并发取数的许可。
3. **超时预算按"随时可能挂"设计，而不是按健康响应设计**：健康回执 0.59–2.3 秒，而病态一律挂满 60 秒。
   Hub 的执行超时是 30 秒（`DataCollectorHub.requestTimeoutMs` 默认值，本方案不动它），而 `callTool`
   每次要走 `initialize` + `tools/call` 两跳——所以数据域的单次上游预算取 **12 秒**：健康请求有 5 倍余量，
   病态请求在 Hub 给出无信息的 `request timed out` 之前，先由 producer 给出**带原因的** `wind_upstream_timeout`
   （§6.6 要求的"不许伪装成网络故障"就落在这句话上）。

---

## 7. P1 实现落点（2026-10-06）

```text
src/web-retriever/wind-client.ts   # +WIND_SERVER_ENDPOINTS（七台端点表，事实不搬代码）
src/sources/wind-mcp.ts            # 新增：三条 DataSource + 表格/并行数组转置 + 单位与 epoch
src/index.ts                       # wind 源注册（与 wind_docs 共用调用期 Key 解析器，注册不看 Key）
src/time/tools.ts                  # +wind_edb_query / wind_stock_kline 时间契约；
                                   #  query_hint 从 `wind_` 前缀改成显式点名（前缀会把提示语发给
                                   #  带真实日期参数的取数能力，邀请模型把日期塞进 question）
scripts/spike-wind.mjs             # 修：空 rows 的表会把探针自己打崩（缺数≠故障，两条分支都要能跑）
scripts/smoke-wind.mjs             # 新增：npm run smoke:wind，走**已注册的 DataSource** 复核护栏
test/wind-mcp-source.test.mjs      # 真报文回归（19 条用例）
docs/data-collector-capabilities.md# 92 条（Wind 三条进新分组）
```

参数面（逐项都有真报文，拒绝项都给得出理由）：

| capability | 参数 | 拒绝的 |
| --- | --- | --- |
| `wind_edb_search` | `question`（≤500） | 其余一切（线上 schema 只这一个键） |
| `wind_edb_query` | `indicator`（单码/单问句，≤200）、`start_date`+`end_date` 必填 | `observation`（给 3 期只回 2 期）、逗号多码（§6.9 挂 60s） |
| `wind_stock_kline` | `code`（自带后缀）、`start_date`+`end_date` 必填、`period` ∈ 七档、`adjust` ∈ none/qfq | `hfq`（锚点语义危险）、60min（两次都挂）、`count`（正负/零未实测）、无后缀代码、qfq+分钟、分钟档 >10 天、qfq 的未来 end_date |

行键全部 ASCII snake_case（§10.6 的映射表在 `wind-mcp.ts` 里就是那几行）：`MATCH→close`、
`CHANGEHANDRATE→turnover_rate_pct`、`AVPRICE→avg_price`、`updateDate→update_date`、
`beginDate/endDate→series_begin_date/series_end_date`（避开与请求窗口混淆）。时间轴一条规矩：
K 线用 `time_ms`（**逐行按该行自带偏移**，美股 -04:00 不套北京时间），EDB 用 `report_date` +
`report_date_ms`（按 Asia/Shanghai 零点，与东财那九张宏观表同口径）；行键的**顺序**也钉了测试，
因为 `pickTimeColumn` 取的是第一个像日期的列，`update_date` 排在前面的话 profile 会把
"指标更新日期"当成序列时间轴。

两条与 §3.3 的偏差，都是"没有通道就不承诺"：

- **没做 `warnings: [{code:'BACKEND_INVALID_AS_NULL'}]`**。Dataset 的行视图里塞不进一条
  Dataset 级警告，而 `request_data` 的回执只有 DatasetRef——承诺一个不存在的通道就是
  §10.6 第 3 条点名的事故形状。`INVALID→null` 照做，只在 description 里说明。
- **没做 `wind_price_indicators` 与全部 NL 工具**（§6.3/§6.7 已定），NL 那条路在
  `output_schema` 无处锚定，文档型 Dataset 也不是行情数据的形状。

未收口（下次动 Wind 时先读这里）：① 港美股分钟仍**未证实**，等 `stock_data` 稳定后用
`npm run smoke:wind -- --minute 00700.HK --date <最近交易日>` 复验；② 空表那份回文的
`columns` 有 10 项而 §6.3 只列出 9 个列名，**第 10 列是什么至今没读到**（producer 在 0 行时不读列名，
所以不影响实现，但 description 里"薄表"的判定规则只覆盖有行的情况）；③ 积分成本仍不可见
（§6.8 第 1 条原样成立）；④ `issusp`、周/月根标签日口径、长区间体积都按 §6.8 待验。
Phase 3（`capital-data-protocol` 的路由规则与来源标注措辞）未动，属下一轮。
