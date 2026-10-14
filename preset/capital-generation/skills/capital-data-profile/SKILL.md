---
name: capital-data-profile
description: Use when reading a Dataset back — describe_dataset as the default entry, the profile payload and its four fact blocks, data_gap requests, and the time axis (axis, windows, calendar filters). Volume 2 of the Capital data protocol; delegation and per-Dataset receipts live in capital-data-protocol, QuerySpec and derived arithmetic in capital-data-query.
---

# Capital 数据协议 · 第二册：读回 Dataset、缺口与时间轴

本册是数据协议的第二册（§3.0 / §3 / §3.1 / §3.2）。委派与逐份回传在第一册 `capital-data-protocol`，
受控查询与派生算术在第三册 `capital-data-query`；三册 §编号连续，跨册引用照原编号点名。

**重试那张表（§5）住在第一册** `capital-data-protocol`，本册不重复它：参数类按 `input_schema` 修正后重试、
瞬时与执行超时重试 1 次、同一请求重试 2 次仍失败就回传 `failed` 并注明已重试。

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
- 主 Agent 可以在 collector 继续取数时逐份委派 data_junior，显式说「只到 profile」（包括必要的受控 queries）；后续只送新到的 dataset_id，不重做已完成的 profile。等 `data_collection_completed` 和补数据回执后，再指示同一个 junior 综合已有结果并完成可视化 gate。

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
