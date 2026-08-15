# 经验教训与契约事实（移植审查结论）

> 2026-08-15 | 来源：`pi-ext/pi-fin-prism` 全量代码审查（THS/Wind/MX 三源实测适配层：信封/路由/归一化/错误/门控/夹具）、`.clone/Financial-API`（同花顺官方仓库：docs/api 契约、CLI 31 命令、Python SDK、marketdb）、`.clone/wind-skills`（Wind 官方 MCP 契约：tool-manifest 34 工具、call-rules、SKILL）。
> 定位：设计文档（DATA_MODEL / DEGRADATION / DESIGN_REVIEW）未覆盖的**范围裁定、实测契约事实与坑清单**——写适配器前必读。冲突时设计文档优先；设计文档未覆盖处以此为准。

## 1. 范围裁定（2026-08-15 用户决策）

| 事项 | 裁定 | 说明 |
|---|---|---|
| 妙想 MX（东方财富） | **排除出数据源集** | 不再评估接入；其连带教训保留于 §5.3 |
| 研报全文/评级/目标价 | **本版本不覆盖** | THS/Wind/AKShare 均无研报全文（THS 官方能力边界明说无研报；Wind financial_docs 仅公告+新闻）。如需由用户另选数据源，设计不为此预留 |
| 全市场代码映射 | **稳定方案为必须**：THS ticker-list 权威 + 定期同步 | DESIGN_REVIEW 决策 5 落地为 P0 基础工程，不容有失；pi-fin-prism 的"shape 校验替代表"只能作补充告警（§2/§4），不能替代 |
| 契约稳定性 | **假设任何 vendor 的响应契约都可能不稳定** | 今天 Wind，明天别家（亿得之类）同样适用；§4 对策是适配器硬性要求，不是可选优化 |
| dump（全市场 Parquet） | **v0：下载落盘保存，不上库、不进 LLM** | 本版本无数据库工具，LLM 读不了；落盘策略见 §3.4，后续版本迭代 |

## 2. 已由实战验证、本项目保留的设计（不重复展开）

| pi-fin-prism 实战做法 | 本项目对应 | 备注 |
|---|---|---|
| 信封溯源不变量（source/tier/ts 永不剥离；unit/magnitude 不丢） | DATA_MODEL（source + degraded 必带） | 建议补可选 `tier`（free/quota/paid）标记配额消耗（§8 待确认） |
| 只归一化原语；复权/TTM/行业分类 caliber 只打标签不换算 | DATA_MODEL L1/L2/L3 | 已被实测验证（复权价跨源不可比，§6），维持 |
| 错误分类先行 + transient 判定；**adapter 绝不自己重试**，重试/failover 归路由 | DEGRADATION 判定表 | 一致；3002 语义补充见 §5.1、§8 |
| 数据驱动路由；唯一能力钉死单源；可用性门控 | DEGRADATION 主干+备用 | QUOTA 处理已升级为"门控跳过+降级提示"，门控 TTL 1 天（§8 已确认） |
| 同时点双源对账，分歧交 LLM 裁决，不自动修复 | DESIGN_REVIEW 决策 1 | 实测基准见 §6 |
| fixture 录制 + 回放测试；live-probe；契约漂移检查 | tests/golden（AKShare 已有规划） | THS/Wind 侧补漂移检查，见 §4 |
| 入参主参强校验，其余宽松透传 | 工具面稳定 schema（决策 9） | pi-fin-prism 教训：全宽松参数把语义责任推给 LLM + 靠路由重试兜底，不稳 |

## 3. THS 契约事实（官方核实）

### 3.1 协议

- Base `https://fuyao.aicubes.cn`，公开端点全 GET；请求头 `X-api-key`；**成功 = HTTP 200 且 `code==0`**；信封 `{code, message, request_id, data}`，业务错误时 `data` 为 `null`（不是空结果）
- 错误码：`1001` 缺参 / `1002` 参数无效 / `1003` 超范围 / `1004` 参数冲突（1xxx 可修复，不重试）；`2001` 未认证 / `2003` Key 无效（不重试不换源）；`3001` 标的不存在 / **`3002` 数据尚未准备（保留 request_id 与口径稍后再查，不得补零）** / `3004` 类型不支持该能力；`4001` 限流（退避）；`5001-5003` 服务端/上游异常（退避）
- 官方 SDK/CLI 重试码 = `{4001, 5001, 5002, 5003}`，指数退避上限 3 次；历史 K 超 10 年自动切片
- 代码必须带后缀（`.SH/.SZ/.BJ/.TI`），**纯 6 位代码不被接受**（实测 `Invalid thscode`）；时间戳为毫秒

### 3.2 端点面

- **34 REST** = meta 2 + 行情/公司行为 3 + 财务 4 + 估值 1 + 日历 1 + 指数板块 4 + 基金 7 + 特色 9 + dump 3
- **30 MCP 工具**（A股 17 / 指数 4 / meta 2 / 基金 7）；`anomaly-analysis-list` 仅 REST 无 MCP；dump 无独立 CLI 命令（只被 `data init/sync` 消费）
- 硬限制：
  - 个股/指数 K 线：单标的、窗口 ≤10 年、个股仅 `1d` 日线；`adjust=none|forward|backward`（默认 forward）
  - 估值：固定五项 `pe_ttm / pe_mrq / pb_mrq / ps_ttm / pcf_ttm`，批量 ≤100 原始 token（去重前计数，101 个重复代码也超限），**无历史、无自选指标**
  - 日历：无参，固定近一年窗口；热榜历史限近一年、区间 ≤1 年；异动仅当日
  - 指数成分仅当前、无历史；指数无复权概念；**指数/板块 thscode 用 `.TI`**（仅 THS 侧合法，见 §5.2）
  - 基金：ETF 历史 ≤5 年且无 adjust，LOF 无历史；`fund_type=otc|exchange|reits` 必填
  - **行情快照批量模式不含中文名**（要名称另走 meta）
  - 财务指标 `report` 参数用 `YYYY-1..4` 专用串；abilities 为数组（成长/盈利/偿债/运营/现金流 5 类）

### 3.3 能力边界（明确没有）

分钟K、tick、Level-2、港股、美股、期货、期权、宏观、新闻/公告原文、研报原文、历史估值、指数历史成分。

### 3.4 dump 与数据湖

- 3 个端点：`daily-k`（10 年日K，约 945 万行）/ `daily-k-10d`（近 10 交易日，约 25 万行增量）/ `adjustment-factors`（约 5.2 万行，**含配股 `allotment_ratio/allotment_price` 与转增 `per_share_transfer`；单股 corporate-actions 端点只有分红/送股**——本地复权计算必须走 dump）
- S3 预签 URL **约 5 分钟 TTL**，拿到立刻下载；OBS 存储 **HEAD 返回 XML，须用 GET + Range（206）断点续传**；3 次请求替代 ~5000 次逐股拉取
- Parquet schema 原生即 L2 形状：`thscode + currency + date_ms(Asia/Shanghai 零点) + volume(股) + turnover + adjusted=none`——THS 适配的物理转换几乎为零
- 官方 marketdb（P3 可整体采用，不必自创）：raw/calc/dim/stg 四层 + `_meta`(schema_version 校验) + `_import_batches`(导入审计)；复权方向 `forward_factor`（前复权，默认，**最新价对齐真实**）/ `backward_factor`（历史价对齐真实）；修复语义 = validate（8 项质量校验）诊断 + rebuild 视图/因子，**禁直接删库**；`data.lock` 进程排他锁；`--source auto|local|remote` 路由（本地历史优先、实时走远端）
- **v0 裁定**：dump 下载落盘保存即可（目录可配置，文件名带日期），不建索引、不上库、不进 LLM

## 4. 契约不稳定的设计对策（硬性要求）

1. **双形状解析**：vendor 响应可能整体换形状（Wind EDB 已实测换过一次：`indicators[].series` → columnar `data[].{meta,date[],value[]}`）——解析器兼容新旧两种形状，旧 fixture 保留
2. **契约漂移检查**：以官方机器可读契约为基准做端点 diff（THS: `https://fuyao.aicubes.cn/llms-full.txt`；pi-fin-prism `/fin verify-contracts` 模式，注意 `/api` 前缀省略属别名匹配）
3. **fixture 录制 + 回放**：真实 key 录一次脱敏 cassette，CI 只回放；live-probe 脚本定期对照线上
4. **错误上下文完整**：vendor + endpoint + status + code + request_id 全带；`3002`/`NO_RESULTS` 类要保留 request_id 供后续排查
5. **判定表外置**：错误码 → `FinError.kind` 映射、配额判定（文本嗅探类：Wind 用 `/积分|配额|quota/` 正则匹配 message，脆弱但实用）一律进 `error_map.yaml` 配置，不进代码
6. **单位/字段以响应元数据为准，未知不猜**：Wind 有 `unit/magnitude` 元数据；THS 靠字段名约定打标；**源不给币种元数据时宁可不填，不硬编码**（pi-fin-prism 曾把无后缀 MX 报价硬归 CNY，是已知坑）
7. **空值纪律**：`null` = 未披露/无值，禁止补零、禁止模拟数据（`3002` 尤其）；0 值混入真实值时要告警（Wind 市净率 0.000 陷阱，§5.2）

## 5. 坑清单（实测）

### 5.1 THS

- **日期区间是 `(start, end]` 左开右闭**：start 当日被排除（K线/财务/指数K均实测，start=2025-12-31 会吞掉 12-31 财报）→ 适配器把 start 回拨一个自然日（inclusiveStart）
- **裸 6 位码被拒**：股票后缀规则 `6→.SH、0/3→.SZ、4/8/9→.BJ` 只对股票成立；可转债/ETF/指数必须查映射表，不许猜
- **指数权威码（实测 ticker-list）**：上证指数=`000001.SH`（ticker `1A0001`）、沪深300=`000300.SH`（ticker `1B0300`）——**不是 `.TI`**；`.TI/.BI` 是板块/概念码（883xxx/885xxx）。pi-fin-prism 曾假设"上证指数=000001.TI"是错的；symbol 映射以 THS ticker-list 为准即可，且 SH 指数 ticker 不是裸码（`1B0300`），解析必须建 thscode 数字前缀索引
- **429 是间歇性的**（8 并发 0.1s 全过实测）→ 指数退避（200ms×2，cap 3）足够，无需全局节流

### 5.2 Wind

- **免费 tier 市净率返回字面 `0.000`**（不报错，实测茅台 PB≈6.3 却得 0.000）；市销率/市现率/PEG 直接拒绝 → **PB 只信 THS（`pb_mrq`）**；估值默认只问 `市盈率(TTM)`
- **`aftype` 无不复权字面量**（`none→0`，0=前复权）→ Wind 的"未复权"不是真未复权，**Wind 行不可当 unadjusted 用**（Wind 本就不参与对账，双保险）
- **`000001.TI`（上证指数）被 Wind 静默读成平安银行**且币种变 JPY → 指数必须用 windcode（`000001.SH`）；`.TI` 只在 THS 侧合法——symbol 表必须按源区分语义
- 指数行用 `最新成交价`、个股用 `最新收盘价`；`indexes` 参数会**替换字段集**（要涨跌幅就丢 OHLC）
- quote 分钟序列**仅当日单日**（非跨日）；周/月/季 K 被钳到日线（240min 上限）——多周期 K 只有日线是真的
- EDB 两段式 search→fetch（**长句搜不到，用指标简称**，如"中国GDP"）；`executionMode` 有中文别名（仅搜索/仅提数/搜索并提数）；日期参数三风格（`begin/end` 分钟行情、`begin_date/end_date` K线、`beginDate/endDate` EDB）
- 并发纪律：**默认串行、先探针后扩散、上限 10**；价格指标批量 ≤50 代码
- 错误信封带 `correction`（change_only + agent_action）可驱动自动重查（v1 候选，v0 只记录）
- 配额：免费 1000 积分/天 ≈ 1 积分/请求；耗尽 → 门控跳过 + 降级提示；**门控 TTL 1 天（对齐每日积分重置），到期自动恢复**（§8 已确认）

### 5.3 MX 连带教训（源已排除，教训保留）

- NL 网关类源的隐含成本：实体识别噪音（同名跨市场股票：宁德时代→03750.HK）、数据时滞（数据时点滞后查询时刻可达分钟级）、无契约静默失败（HTTP 成功但空结果）、免费配额小易耗尽
- **通用结论：数据时点(asOf) ≠ 查询时点(ts) 对所有源成立；对账只比数据时点**（DATA_MODEL 已补充）
- 免费新增源也要评估维护成本（无版本契约、响应形状漂移、配额不可预测）

### 5.4 AKShare / 东财（2026-08-15 实测，双 IP 四客户端验证）

- **东财对高价值行情接口（push2his 历史K、push2 实时报价）有 IP 级限频/风控**：概率性放行、冷却期长（小时级）、反复探测会刷新封锁；失败形态是 TCP 层 `ConnectionError/RemoteDisconnected`（连接被掐断，无 HTTP 响应），与"接口变更"（4xx/5xx/JSON 解析错）可明确区分
- 实测覆盖两种出口 IP（代理节点、直连）与四种客户端（curl/requests/httpx/akshare）→ 与 akshare 代码无关；社区长期记录同一问题（akshare issue #6092/#6100）
- 同会话内其他东财主机（datacenter-web 财务指标、push2ex 板块）与全部新浪/腾讯源**稳定可用**
- **已验证的备用上游**（同为 akshare 白名单函数，本环境可用）：新浪 `stock_zh_a_daily`（日K，支持复权）、腾讯 `stock_zh_a_hist_tx`（日K）——kline 兜底备用方案（v0.1.1 计划，见 PLAN §6）
- 教训：AKShare 兜底源会间歇性整体不可用是常态（DEGRADATION 已写"免费源会变成最先挂的源"）；对高频接口要防"探测即触发封锁"（重试间隔放大、成功后即停）

## 6. 对账实测基准

- PE(TTM) 三源一致：ths 20.48 / wind 20.47 / mx 20.48（<0.2%）→ **同 caliber 估值可对账**；0.5% 阈值有实测依据（不限于未复权 OHLC）
- 复权价跨源不可比（PB：ths MRQ 6.25 vs mx 7.18，口径不同）→ 验证 DESIGN_REVIEW P0-1（对账只限未复权，Wind 只作基准）
- 数据时滞 → 对账必须用数据时点，不是查询时点

## 7. 已知缺口与待决策

| 项 | 状态 |
|---|---|
| 基金域（THS 7 端点：净值/收益/持仓/持有人/场内行情） | 未规划，待决策 |
| Wind fund/index/analytics 域（24 个工具） | pi-fin-prism 未接线；做 Wind 适配器时决策是否全量 |
| 指数历史成分 | THS 只给当前成分，无历史 |
| 研报 | §1 裁定不覆盖 |
| 分钟K/公告/新闻/宏观 | 归 Wind（与 DEGRADATION 一致）；分钟K 注意 §5.2 边界（仅当日分钟序列） |

## 8. 已采纳的小改动（2026-08-15 用户确认）

1. DEGRADATION QUOTA 行：改为"**门控跳过该源 + 降级提示**"（pi-fin-prism 实测：配额耗尽自动 `Disable<exceed upper limit>`，路由跳过并记录降级，比报错平滑）；**门控 TTL = 1 天**（对齐 Wind 每日积分重置；到期自动恢复 Enable，再次耗尽再次降级——不允许"降级一次后永久按降级处理"）
2. DEGRADATION 判定表补 `3002`（暂不可得）：归 NO_DATA 但注明"保留 request_id，稍后可重试，不得补零/模拟"
3. 信封补充可选 `tier` 字段（free/quota/paid）：Wind 配额消耗对模型可见
4. `source` 取值规范：对外一律用规范名 `同花顺` / `Wind` / `AKShare`（不缩写；Wind 首字母大写 W），内部 vendor id 可用缩写（已写入 DEGRADATION.md 可观测性）
