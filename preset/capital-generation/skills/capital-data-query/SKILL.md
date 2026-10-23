---
name: capital-data-query
description: Use when aggregating a Dataset or computing a derived number — the controlled QuerySpec (filters, group_by, aggregates, calendar time values, error codes) and data_junior's run_code programs for derived arithmetic. Volume 3 of the Capital data protocol; payloads in capital-data-protocol, profile facts and the time axis in capital-data-profile.
---

# Capital 数据协议 · 第三册：受控查询与派生算术

本册是数据协议的第三册（§3.3 run_code 只做派生算术 / §4 受控查询）。时间轴与 `time_facts` 在第二册
`capital-data-profile` §3.2，载荷契约与重试纪律在第一册 `capital-data-protocol`。

## 3.3 run_code：派生算术，不是第二条取数通道

只有 data_junior 有 `run_code`；主 Agent 读本节是为了理解回传格式，不要照着执行。它存在的唯一
理由是 `query_dataset` 的聚合只有 `count / min / max / avg / sum`——**变化量、增幅、CAGR、比值、
单位换算**这类派生指标没有宿主工具。数字必须从工具返回值直接取，不手抄、不整行复制、不中转到
别的语言。

**可以做的**（值来自工具返回对象，算完只返回结论）。第一段程序只读协议，`content` 必须打印出来，
只 `await` 等于没读；也不要和 describe 混在同一段：

```ts
const s = await tools.skill({ name: 'capital-data-profile' })
console.log(s.content)
```

```ts
const r = await tools.describe_dataset({ dataset_id, task_id })
const a = r.time_facts.first.close_price
const b = r.time_facts.last.close_price
return { pct: ((b - a) / a) * 100, from: a, to: b }
```

- `describe_dataset` 返回 `{status:'too_large', columns, hint}` 时，它在同一个程序里按 hint 用
  `columns_of_interest` 重发一次；这是返回值不是异常，别用 `catch` 接、也别另起一轮。
- 多份 Dataset 用 `Promise.all` 并发 describe（只有 `describe_dataset` 声明了并发安全）；
  `query_dataset` 串行，不要混进同一批。某份可能失败时用 `Promise.allSettled`。
- 一次程序只做一段事：先 `console.log(s.content)` 读协议，再 describe/算数，最后回传；
  不要把整份 profile 或多个工具结果 `return` 回去（外层结果会过 8192 剪枝）。
- 回传与 `data_gap` 用 `await tools.send_message({ agent_id, message })`；它返回 `{messageId}`，
  不结束本轮。`agent_id` 取系统提示里的 parent agent id。

**不许做的**（这是纪律，不是沙箱限制——沙箱只拦写，不拦读与网络）：

| 不许 | 为什么 | 正确做法 |
|---|---|---|
| 读 `capital-data/**`、`raw.json` | 原始行**永不**进入你的上下文；读了也算错 | 数值走 `describe_dataset` / `query_dataset` 的统计与聚合 |
| 读 `~/.dsh/**`、`sessions/**` | 那是宿主凭据与全部会话日志 | 不碰；需要元数据用工具回执 |
| 读 / 改 `preset/`、`src/`、`test/` | 那是装配与门禁本身 | 不碰 |
| `fetch` / 任何网络请求、`git clone`、`npm i`、`pip install` | 你的角色没有网络职责，外部材料只经主 Agent 转交 `web_retriever` | 缺外部事实就在回传里写明缺口 |
| 申请更高权限（`sandbox_permissions`） | 委派会话的审批固定为 `never`，必然失败 | 不要试；缺数据发 `data_gap` |

另外两条：

- **输出只留结论数字**：`run_code` 的外层结果同样会过剪枝器（>8192 字符中间段被剪掉），把中间
  过程或整份 profile 打印出来只会挤掉真正要看的东西；回传时注明算法与口径（如「按首末收盘价、
  未复权」）。只返回结论，不要 `return` 整份 profile。
- **时间窗仍归宿主**：窗口边界一律用 `time_facts.windows` / `resolve_data_time_range`
  （`capital-data-profile` §3.2），不要在程序里把日期算成毫秒——口径错了数字就全错。

`profile_dataset` 的统计项：数值字段的 count 与 sum（合计多少、覆盖多少条）、字符串字段的
`distinct_count` 与高频取值、字段类型（observed / contract）、缺失值与显式 null、类型冲突、
重复主键、时间范围、最小/最大/均值/分位数——**只报告可计算的部分**，数据不足就如实说明。


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
  里补 `*_iso`。写法、可用的 period 词表与禁止的算子见 `capital-data-profile` §3.2——**不要**自己把日期算成毫秒。
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
