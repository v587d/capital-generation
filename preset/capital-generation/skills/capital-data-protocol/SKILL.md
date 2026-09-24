---
name: capital-data-protocol
description: Use when composing or reading a Capital data message — the exact data_request, dataset_ready, data_failed, profile_request, dataset_profile_completed, profile_failed, query_request, dataset_query_completed and query_failed payloads, field-by-field rules, force_refresh semantics, capability selection, retry discipline, and the disclosure fields an answer must carry.
---

# Capital 数据协议（完整版）

主 Agent 与 `data_collector` / `data_junior` 之间的消息载荷契约。三个角色的 persona 只保留
每轮都要生效的硬规则；字段级细节、示例与重试表在本文件。载荷即接口，字段名、数值、日期
一律不改写。

## 0. 谁读哪一节（三个角色动手前都应先加载本 skill）

| 角色 | 需要 | 说明 |
|---|---|---|
| 主 Agent | §1、§3、§4、§5 | 发请求、收回传、输出披露字段 |
| `data_collector` | §1、§1.1、§2、§5 | 收请求、能力发现两步、回传载荷、重试纪律 |
| `data_junior` | §3、§3.1、§4、§5 | 质检回传、数据缺口、受控查询、重试纪律 |

## 1. 数据请求（主 Agent → data_collector）

```json
{
  "type": "data_request",
  "task_id": "task_01J...",
  "description": "贵州茅台近一年日线",
  "capability": "history",
  "params": { "thscode": "600519.SH", "interval": "1d" },
  "force_refresh": false
}
```

| 字段 | 规则 |
|------|------|
| `type` | 固定 `data_request` |
| `task_id` | 同一任务复用同一个值，便于回传对账 |
| `description` | 用自然语言写清要什么数据；也可含标的、区间、频率 |
| `capability` | 可选。明确知道能力名时才指定；省略时由 `data_collector` 走下面 §1.1 的两步发现 |
| `params` | 按该 capability 的 `input_schema` 填写；标的使用完整代码（如 `600519.SH`），不自行拼接交易所后缀。腾讯 fallback 使用 `tencent_quote` / `tencent_kline`，不要改写成已有 `quote` / `history` |
| `force_refresh` | `false`/省略：宿主可复用当前 session 内未过期的 Dataset；`true`：强制重新取数并生成新的不可变 Dataset，**绝不覆盖旧文件** |

硬规则：

- 委派消息只带需求与参数，**不带任何内部数据源键名**，也不携带原始数据行。
- 能力名一律以 `list_capabilities` 返回的目录为准，不要编造。
- 一次请求一个能力、串行推进；单回合通常 1 个、最多 3 个、硬性不超过 5 个能力。
- `task_id` 由主 Agent 在本轮首次委派前确定；同一用户任务的 data_collector、data_junior 与 visualization 必须原样复用。data_collector 不得自行生成或改写 task_id，缺失时应拒绝请求并回告主 Agent。

## 1.1 能力发现（data_collector 侧：两步，且各只做一次）

| 步 | 工具 | 得到什么 | 调用纪律 |
|----|------|----------|----------|
| ① | `list_capabilities()` | 能力目录：`capability` + 一行 `summary` + `paginated` | **一个任务只调一次**；目录已在本 session 历史里，重复调用只会白占上下文 |
| ② | `describe_capability({ capability })` | 该能力的完整 `description` / `input_schema` / `output_schema` | 一次只传**一个**名字、**不传逗号**；同一个能力描述一次即可；要几个能力就分别调用几次 |

- 目录刻意不含参数与输出结构：全量 schema 约 23KB，会被工具结果剪枝器（阈值 8192）截断中间
  部分，导致排在中间的能力在发现阶段不可见。目录只负责"选哪个"，详情负责"怎么填"。
- **一个任务只调一次 `list_capabilities`**；**同一个能力只描述一次**，重复调用只会白占上下文。
- 不查 `input_schema` 就填 `params` 属于违规；`params` 的取值与约束一律以 `describe_capability` 为准。

`describe_capability` 的错误按 code 处置，不要盲目重试：

| code | 含义 | 正确动作 |
|------|------|----------|
| `capability_required` | 没给名字（缺失或空白） | 先调一次 `list_capabilities`，把目录里的名字原样传入 |
| `capability_invalid` | 不是字符串 / 超长 / 含逗号 | 改成单个字符串名字后重试一次；多个能力分多次调用 |
| `capability_unknown` | 名字不在目录里（错误信息会列出全部可用名字） | 从列出的名字里原文复制重来；不编造、不缩写、不改写 |
| `capability_catalog_empty` | 当前没有任何已注册能力（数据源未注册，常见原因是凭据未配置） | **不要重试**（此刻任何名字都会失败）；用 `dc_status` 读注册错误并如实回告主 Agent |
| `request_params_invalid` | `request_data` 的 `params` 不符合该能力契约（错误会保留具体字段原因） | 先按错误中的 capability 调 `describe_capability({"capability":"..."})`，重新读取 `input_schema`，修正后只重试一次；不要凭记忆猜参数。网络、超时、落盘错误不要走这条路径 |

## 2. 数据回传（data_collector → 主 Agent）

成功：

```json
{
  "type": "dataset_ready",
  "task_id": "task_01J...",
  "datasets": [
    {
      "dataset_id": "ds_01J...",
      "artifact_ref": "workspace://capital-data/datasets/ds_01J...",
      "format": "json_rows",
      "capability": "history",
      "source_label": "fuyao",
      "schema": { "columns": ["date_ms", "open_price", "high_price", "low_price", "close_price", "volume", "turnover"] },
      "row_count": 240,
      "captured_at": 1780000000000,
      "retention_until": 1780604800000
    }
  ]
}
```

失败：

```json
{ "type": "data_failed", "task_id": "task_01J...", "error": "...", "code": "..." }
```

硬规则：

- 回传必须携带结构化载荷；可以附表格或摘要，但**禁止只回传 markdown 汇总**。
- `dataset_id` / `artifact_ref` / `capability` / `source_label` / `schema` / `row_count` /
  `captured_at` / `retention_until` 按工具返回**原样填入**，字段名、数值、日期不改写。
- 载荷中不得出现原始数据行、内部数据源键名或文件绝对路径。
- 主 Agent 收到后把 DatasetRef 记入委派清单，后续引用一律原样转达 `artifact_ref`，
  不自行改写、不自行拼路径。
- Dataset 默认保留 **7 天**（以 `retention_until` 为准），到期后需重新取数。

## 3.0 读取 Dataset 的默认入口：`describe_dataset`

`data_junior` 读一份 Dataset 用 **`describe_dataset`**（一次调用完成 inspect + profile + 可选 queries），
**不要再走 `inspect_dataset → profile_dataset → query_dataset` 三步**——那三步只保留给单点复核。

```json
{
  "dataset_id": "ds_01J...",
  "task_id": "task_01J...",
  "columns_of_interest": ["close_price", "volume"],
  "queries": [
    { "group_by": ["report_type"], "aggregates": [{ "function": "count", "as": "n" }], "limit": 20 }
  ]
}
```

- **一次一份**：一次调用只传一个 `dataset_id`。本轮有多份数据时，**在同一条 assistant 消息里一次发完**
  多个调用（宿主会并发执行，结果一起返回），不要一份一份等。
- 返回 = inspect 元数据（`artifact_ref` / `capability` / `source_label` / `captured_at` / `retention_until` /
  `query_access.shape`）+ profile 四类事实（`statistics` / `categories` / `time_facts` / `structure`）+
  `profile_ref` + 每条 query 的 `result`，或该条自己的 `error`（单条失败不影响其余）。
- `shape = document` 时 queries **不执行**（宿主跳过并在 `warnings` 说明）；文档内容在 `document`。
- `columns_of_interest` 只对这些列返回 `statistics` / `categories` / `schema`（并同样收窄 `time_facts` 的首末值投影；时间列永远保留），是收窄结果体积的唯一手段。
- **体积闸门**：结果超过 7000 码点时返回
  `{"status":"too_large","profile_ref":"...","columns":[...],"hint":"..."}`，而不是超长载荷。
  按 hint 用 `columns_of_interest`（或减少 `queries`，一次最多 8 条）重发一次；文档型按 hint 直接调
  `profile_dataset`。**看到 `too_large` 不是失败**——它带着完整列名，用来让你收窄。
- 单点复核（只看元数据 / 只要一份完整 profile / 补一条查询）仍可用 `inspect_dataset`、`profile_dataset`、
  `query_dataset`。

## 3. 质检请求与回传（主 Agent ↔ data_junior）

请求：

```json
{
  "type": "profile_request",
  "task_id": "task_01J...",
  "dataset_ids": ["ds_01J..."],
  "question": "检查数据质量并给出基础统计"
}
```

- `dataset_ids` 一律取 `dataset_ready` 回传中的 `dataset_id` 原样值。
- 只带 DatasetRef 标识与问题描述，**绝不带原始数据行**。

回传：

```json
{
  "type": "dataset_profile_completed",
  "task_id": "task_01J...",
  "dataset_id": "ds_01J...",
  "profile_ref": "workspace://capital-data/profiles/p_01J...",
  "row_count": 240,
  "columns": ["date", "open", "high", "low", "close", "volume"],
  "schema": {
    "close": { "contract_type": "number", "inferred_type": "number", "missing_count": 0, "null_count": 0, "invalid_count": 0 }
  },
  "validation": { "status": "pass", "violations": [] },
  "quality": { "missing_values": 0, "duplicate_rows": 0, "time_ordered": true },
  "warnings": []
}
```

- `schema` 是字段类型和计数的有限摘要；完整 profile 以 `profile_ref` 为准，不把完整 profile 或 raw rows 放进消息。
- `validation.status=fail` 表示 profile 发现结构化 violations，不表示原始 Dataset 被删除或不可用。

失败：`{ "type": "profile_failed", "task_id": "task_01J...", "error": "...", "code": "..." }`

`profile_dataset` 的四类事实（回传时按需引用，不要把整份 profile 抄进消息）：

| 事实块 | 回答什么问题 |
|--------|--------------|
| `statistics`（count/sum/min/max/mean/分位数） | 合计多少、覆盖多少条、区间与集中度 |
| `categories`（distinct_count + 最多 5 个高频取值） | 有哪些类别、分布如何；`truncated=true` 表示未列全 |
| `time_facts`（覆盖范围 + 首行/末行取值 + `axis` + `windows`） | 最新值、区间涨跌，以及**这份数据的时间轴怎么读**（见 §3.2）。**必须**用 `first`/`last`；min/max 只是区间极值，把它讲成走势就是编造 |
| `structure`（路径 + total_elements 或 sampled_elements） | 嵌套里一共有多少条。对象字段用 `.name`、数组元素用 `[]`，未抽样时例如 `sub_tab[].fund_list` 的 `total_elements=40` 就是 40 只基金；若出现 `sampled_elements=50`，只能说明实际检查了 50 项，不是完整数量 |

### 3.2 时间轴：日历由宿主换算，不要自己算毫秒

`time_facts` 除覆盖范围与首末行外，还给出**这份数据的时间轴怎么读**：

| 字段 | 含义 | 怎么用 |
|---|---|---|
| `axis.value_format` | `epoch_ms`（毫秒整数时间列）/ `date_string`（已是 `YYYY-MM-DD`）/ `unknown`（推断不出：先 inspect 或显式传 `time_column`） | `unknown` 时不要假设粒度 |
| `axis.time_zone` / `axis.utc_offset` | 该列**自身观测到**的时区偏移（如 `Asia/Shanghai` / `+08:00`） | 判断"某天"的边界一律按它，不要按 UTC 猜 |
| `axis.aligned_to` | `local_midnight` = 取值是当地 00:00 的瞬间（A 股日线的 `date_ms` 就是这样） | 这种列的"当天"要用 `>= 当天午夜` 且 `<= 当天日末` 两个条件才算 |
| `covered_from_iso` / `covered_to_iso` | 覆盖范围的可读日期 | 回答"数据到哪天"，不要再做 epoch→日期换算 |
| `windows[]` | 近 1 月 / 近 3 月 / 近 1 年 / 年初至今的现成边界：`value_ge`、`value_le`（可直接填进 filter）与 `data_from`、`data_to`（该窗口在数据里**真实存在**的首末日期） | 命中就直接用；`data_from` 已把非交易日夹到相邻交易日 |

需要 `windows` 之外的窗口（任意区间、某年某月、历年 10 月）时：

1. 调 `resolve_data_time_range`，传 `dataset_id` + `period`（可选 `anchor_date`）；它按该 Dataset
   时间列自身的偏移返回 `bounds.bound_ge` / `bounds.bound_le` 与 `range`、`data` 日期；
2. 把 `bound_ge` / `bound_le` 原样填进 filter，**不要**自己把日期算成毫秒。

`query_dataset` 的 filter 也**直接接受日历写法**（宿主按同一套偏移换算）：

```jsonc
// 三种写法都表示"从 2026-08-23 起"，选一种即可
{ "column": "date_ms", "operator": ">=", "value": "2026-08-23" }
{ "column": "date_ms", "operator": ">=", "value": "2026-08" }
{ "column": "date_ms", "operator": ">=", "value": { "period": "last_1_month" } }
```

- `>=` 取该日当地午夜、`<=` 取该日当地日末、`=` 自动展开成"这一天"的上下界；省略锚点的
  `period` 以该 Dataset 最后一天为准（数据陈旧时相对期不会落空）；
- 结果里时间列会附一列 `*_iso` 可读日期（原值保留，不替换）；
- `>`、`<`、`!=`、`in` 配日期串会报 `query_type_conflict`：日期只有"整天"语义，用它们等于
  悄悄换一天；要哪几天就直接写 `>=` / `<=`。

**硬规则：看到 epoch 毫秒要经过加减乘除才能得出结论时，就是走错了路。** 时间换算一律交给
`time_facts.axis`、`windows` 与 `resolve_data_time_range`；自己心算毫秒既慢又必然算错口径。

文档型 Dataset（顶层是文档对象、没有行数组，如财务指标、回测结果）：`profile_dataset` 返回
`structure` 结构摘要 + `document` 有界内容（`$` 是文档根），**没有**行列统计，也不包含行数据专用的 `schema`/`validation`；`query_dataset`
对它无效。`document.truncated=true` 时必须按 `omitted` 逐条说明省略了哪个路径、保留多少、
省略多少，不得只说「已截断」。

硬规则：字段按工具返回原样填入；统计项只报告可计算的部分，数据不足如实说明；
profile 失败不影响原始 Dataset，可按指示重试。

### 3.3 bash：派生算术的兜底，不是第二条取数通道

只有 data_junior 有 `bash`。它存在的唯一理由是 `query_dataset` 的聚合只有
`count / min / max / avg / sum`——**变化量、增幅、CAGR、比值、单位换算**这类派生指标没有宿主
工具，硬心算既慢又容易错。

**可以做的**（拿手里已有的数字算）：

```bash
node -e 'const a=98.2,b=120.5; console.log(((b-a)/a*100).toFixed(2))'   # 区间涨幅
python3 -c "print((120.5/98.2)**(252/60)-1)"                            # 年化
```

**不许做的**（这是纪律，不是沙箱限制——沙箱只拦写，不拦读与网络）：

| 不许 | 为什么 | 正确做法 |
|---|---|---|
| 读 `capital-data/**`、`raw.json` | 原始行**永不**进入你的上下文（AGENTS.md §1.2）；而且工具结果会被剪枝成 head+tail，读了也算错 | 数值走 `describe_dataset` / `query_dataset` 的统计与聚合 |
| 读 `~/.dsh/**`、`sessions/**` | 那是宿主凭据与全部会话日志 | 不碰；需要元数据用工具回执 |
| 读 / 改 `preset/`、`src/`、`test/` | 那是装配与门禁本身 | 不碰 |
| `curl` / `wget` / 任何网络请求、`git clone`、`npm i`、`pip install` | 你的角色没有网络能力，外部材料只经主 Agent 转交 `web_retriever` | 缺外部事实就在回传里写明缺口 |
| 申请更高权限（`sandbox_permissions`） | 委派会话的审批策略被框架固定为 `never`，必然失败 | 不要试；缺数据发 `data_gap` |

另外两条：

- **输出只留结论数字**：bash 的工具结果同样会过剪枝器（>8192 字符中间段被剪掉），把中间过程
  打印出来只会挤掉真正要看的东西；回传时注明算法与口径（如「按首末收盘价、未复权」）。
- **时间窗仍归宿主**：窗口边界一律用 `time_facts.windows` / `resolve_data_time_range`
  （§3.2），不要用 `date` 命令自己造边界——口径错了数字就全错，而且没人会发现。

`profile_dataset` 的统计项：数值字段的 count 与 sum（合计多少、覆盖多少条）、字符串字段的
`distinct_count` 与高频取值、字段类型（observed / contract）、缺失值与显式 null、类型冲突、
重复主键、时间范围、最小/最大/均值/分位数——**只报告可计算的部分**，数据不足就如实说明。

## 3.1 数据缺口（data_junior → 主 Agent，中途主动发起）

data_junior 发现「问题需要的那份数据还没取」时（不是「数据里没有」），不等回合结束，
直接用 `send_message` 发一次：

```json
{
  "type": "data_gap",
  "task_id": "task_01J...",
  "dataset_id": "ds_01J...",
  "need": "该指数在 2025-06-30 的成分股权重明细",
  "reason": "现有 Dataset 只有指数点位，没有成分字段",
  "suggested_capability": "index_constituents",
  "blocking": true
}
```

| 字段 | 规则 |
|------|------|
| `type` | 固定 `data_gap` |
| `task_id` / `dataset_id` | 必须带：主 Agent 可能同时在等多个回传，靠这两个字段对上号 |
| `need` | 用自然语言写清缺什么数据（标的、区间、口径） |
| `reason` | 说明为什么现有 Dataset 不够，避免主 Agent 重复取已有的数据 |
| `suggested_capability` | 可选。只能是**手上 DatasetRef 里出现过的 capability 原值**，或整个省略；不要为了填空编造能力名 |
| `blocking` | `true` = 不补齐无法继续，可以停在本轮等回信；`false` = 还有别的能先做 |

硬规则：

- `data_gap` 是请求不是结论。发出后不得把「无法确认」当终局；同一条缺口只发一次。
- 子 Agent **不得自行取数**，也不得直接找 `data_collector`：取数一律由主 Agent 中继。
- 主 Agent 处置：按委派清单复用对应角色取数 → 把新 DatasetRef 用 `send_message` 发回
  **同一个**子 Agent（禁止新建同角色）→ 它接着做完。同参数的重新取数会命中宿主复用，
  不会重复访问上游，所以该重取就重取。
- 取数失败时主 Agent 必须回一条失败消息（`data_failed` 或说明性文本）给它，
  不能让它一直等：框架没有超时与订阅机制。
- **结束本轮 ≠ 任务完成。** 等数据的子 Agent 会先结束回合，结算通知里那句
  「finished and will do no further work unless you send it more」在此时是误导；
  清单里标为「等数据」的子 Agent，收到结算通知后不要认定完成、也不要新建。
- 只有确认「数据里确实没有该字段」时才回传能力边界，并写明是数据没有、不是没拿到数据。

## 4. 受控查询（主 Agent ↔ data_junior）

请求：

```json
{
  "type": "query_request",
  "task_id": "task_01J...",
  "dataset_id": "ds_01J...",
  "query": {
    "dataset_id": "ds_01J...",
    "select": ["symbol", "rows", "avg_close"],
    "filters": [{ "column": "close_price", "operator": ">", "value": 100 }],
    "group_by": ["symbol"],
    "aggregates": [
      { "function": "count", "as": "rows" },
      { "function": "avg", "column": "close_price", "as": "avg_close" }
    ],
    "order_by": [{ "column": "avg_close", "direction": "desc" }],
    "limit": 100
  }
}
```

- `query` 是固定 JSON QuerySpec，不是 SQL、表达式或脚本；`query_request` 消息可以原样作为 `query_dataset` 工具参数传入，宿主会展开其中的 `query`；也可直接传扁平 QuerySpec。`type` / `task_id` 只属于消息 envelope，不进入实际执行 QuerySpec。
- 只支持 `=`、`!=`、`>`、`>=`、`<`、`<=`、`in`、`is_null`、`not_null`，以及 `count`、`min`、`max`、`avg`、`sum`。
- 必须有 `group_by` 或聚合；`select` 可省略，省略时默认返回分组列与聚合别名；显式 `select` 只能引用分组列或聚合别名。禁止 join、window、having、自定义函数和 raw rows 投影。
- 默认 `error_policy=skip_with_warning`：过滤或数值聚合遇到不兼容脏值时排除该值并在 `warnings` 披露；需要类型全量一致时显式使用 `error_policy=strict`。
- 数组/对象字段（`select`、`group_by`、`aggregates`、`order_by`、`filters`）传**真正的 JSON 数组**，不要序列化成字符串再传；`limit` 传数字。宿主对字符串化的 JSON 做了宽容解析（实测模型很常这么传），但不要依赖它。
- **时间列筛选写日历，不写毫秒**：`date_ms` 这类 epoch 列的 filter 值可直接写 `"2026-08-23"`、
  `"2026-08"`、`"2026"` 或 `{ "period": "last_1_month" }`，宿主按该列自身偏移换算边界并自动在结果
  里补 `*_iso`。写法、可用的 period 词表与禁止的算子见 §3.2——**不要**自己把日期算成毫秒。
  同一条 QuerySpec 在 **`describe_dataset` 的 `queries` 与 `query_dataset` 里完全等价**（同一份归一、
  同样的错误码），不必因为"想确认某个入口行不行"而重复试。
- `query_dataset` 取不到原始行：`select` 只能引用分组列或聚合别名，所以「首末/最新值」要用
  profile 的 `time_facts`——`time_facts` 已经给了首末行取值，不要用 query 去取。
- `query_dataset` 是受控分组/聚合透视查询，不是通用 raw.json 读取器，也不替代基础描述性 profile。对市场指数、指数组成、基金重仓股等不适合当前 QuerySpec 的数据，不要强行改写查询；不足以回答时如实回传能力边界。自定义查询脚本和自定义执行脚本属于后续 `data_analyst`，不得转移给 data_junior。

完成回传：

```json
{
  "type": "dataset_query_completed",
  "task_id": "task_01J...",
  "dataset_id": "ds_01J...",
  "query_result": {
    "columns": ["symbol", "rows", "avg_close"],
    "rows": [{ "symbol": "600519.SH", "rows": 20, "avg_close": 1680.5 }],
    "matched_row_count": 20,
    "group_count": 1,
    "returned_count": 1,
    "limit": 100,
    "warnings": []
  }
}
```

失败：`{ "type": "query_failed", "task_id": "task_01J...", "dataset_id": "ds_01J...", "error": "...", "code": "query_type_conflict" }`

- `query_result.rows` 只能是有限分组键与聚合结果，不得出现未聚合 Dataset row、文件路径、内部路由键或凭据。

## 5. 重试纪律


| 错误类型 | 例子 | 处理 |
|----------|------|------|
| 参数类 | 缺参、格式错、枚举越界 | 对照 `input_schema` 的 enum/description 修正后重试 |
| 瞬时类 | 限流、上游超时、网络 | 重试 1 次 |
| 执行超时 | 约 30 秒超时 | 重试 1 次 |
| 数据源/环境 | 无可用数据源、workspace 只读、落盘失败（`workspace_not_writable`） | 不回退、不假装成功，如实回传 `error`/`code` |
| 网页获取 | 网络或服务错误 | 最多重试 1 次，仍失败如实回传 |

底线：绝不幻觉填充数据，绝不用编造的来源补位，绝不声称数据已保存；
同一请求重试 2 次仍失败就回传 `failed` 并注明已重试，不再继续。

## 5. 输出必须披露的字段

- `capability`、`source_label`、抓取时间 `captured_at`；
- 交易日 / 报告期、时区；
- 缺失字段与数据截止时间；
- 情景假设标注为条件假设，不是统计概率或收益承诺。

原始数据行永远不进入主 Agent 的上下文：主 Agent 只拿到 DatasetRef、profile_ref 与元数据。
与第三方网页比对仅用于异常抽样核对，不把任何单一来源表述成绝对真实。
