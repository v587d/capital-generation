---
name: capital-visualization-protocol
description: Use immediately after data_junior profile completion to run the mandatory visualization gate, dispatch chart-worthy tasks to visualization_specialist, choose bounded chart views and fields, prepare a chart_source_ref, or document a real skip/block/failure.
---

# Capital 可视化编排协议

本 skill 同时服务 data_junior 和 visualization_specialist，但两者职责不同：

```text
data_junior
  └─ 读取 profile，判断是否值得可视化，签发 chart_source_ref，等待 specialist

visualization_specialist
  └─ 读取有限 profile 事实，选择视图，调用 render_chart，返回 chart_ref
```

图表是呈现，不是分析。任何数值结论必须来自 data_junior 的 profile/query 或
data_collector 的结构化回传，不能通过观察图形推断。

## 1. 可视化决策 gate

profile 完成后只能选择以下四种状态之一：

```text
not_needed
recommended
blocked
failed
```

### 1.1 `not_needed`

以下情况通常不需要图表：

- 单个标量或少量 KPI；
- 只有一两行的简单结果；
- 没有趋势、比较、分布或集中度关系的数据；
- 文字表格已经比图表更清楚；
- 纯文本公告或资料摘要。

必须在回传中给出简短原因，不要为了满足“主动出图”而生成装饰性图表。

### 1.2 `recommended`

以下信号满足一个或多个，并且图表能明显改善理解时，可以可视化：

- 存在有足够点数的时间序列；
- 存在多期比较；
- 存在多个可比较的数值序列；
- 存在 OHLC 与 volume 组合；
- 存在类别排名、集中度或分布关系；
- 文字统计难以表达趋势、结构或相对变化。

推荐不是“看到时间字段就必画”。需要同时考虑点数、字段质量、缺失值和用户问题。

### 1.3 `blocked`

以下情况不得强行出图：

- profile 没有足够字段；
- 数据是文档型 Dataset，没有可呈现的行集合；
- 没有可用的时间、类别或数值字段；
- 用户问题要求的视图无法由现有字段表达；
- chart source token 无法安全签发。

### 1.4 `failed`

只有已经尝试了合法流程但工具或产物失败时使用：

- `prepare_chart_source` 失败；
- `render_chart` 返回明确错误；
- workspace 不可写；
- 图表旁路登记失败且无法提供可用产物。

不能把“懒得判断”或“没有加载 skill”写成 failed。

### 1.5 硬 gate 覆盖规则

以下情况不得选择 `not_needed`：用户明确要求图表，或 profile 已确认存在时间序列、OHLC+volume、多期比较或多个可比数值序列。此时必须选择 `recommended`，完成 `prepare_chart_source → subagent_visualization_specialist → one-shot barrier`；只有字段/数据实际不足才可 `blocked`，只有合法工具已经失败才可 `failed`。不要把“本 Agent 没有 render_chart”当作跳过理由，render_chart 属于 specialist 的受控工具。

`recommended` 回答的是“这份数据该不该被画出来”，不是“这次委派要不要出图”。委派 prompt 显式限定范围（如「只到 profile」「不要图」）时，仍按上面的判据给出 `recommended`，但**停在结论不出图**，并在回传里写明未执行是**委派收窄**——它既不是 `blocked`（字段不足）也不是 `failed`（工具失败），三者混淆会让主 Agent 把范围决定误读成能力结论。范围下一轮放开时无需重新 profile，按同一结论直接走 `prepare_chart_source` 即可。


### 2.1 描述后判断

data_junior 必须先完成：

```text
describe_dataset（默认：一次完成 inspect + profile + 可选 queries）
必要时用 inspect_dataset / profile_dataset / query_dataset 做单点复核
```

然后形成最小决策记录：

```text
decision
reasons
candidate_views
```

candidate views 只记录视图意图，例如：

```text
trend
comparison
volume
distribution
ranking
ohlc
```

不要在 profile 阶段生成 raw rows 或完整 chart payload。

### 2.2 推荐出图时签发 token

对每个当前 task/dataset：

```text
prepare_chart_source({ dataset_id, task_id })
```

只使用工具返回的 `chart_source_ref`。不要自己构造 token、路径或 `raw.json` 地址。

**一张图一个 token，且 token 有 15 分钟 TTL**：先定好要出哪几张图、每张用哪份 Dataset，
再一次性签发；**不要**因为改了视图方案就为同一个 dataset 重签（实测代价：多花 8.3K 字符思考，
还把剩下的窗口压得更短）。

传给 visualization_specialist 的内容只能包括：

- `task_id`；
- `profile_ref`；
- 有界 profile 事实；
- `chart_source_ref`；
- 用户问题和 candidate view；
- 输出要求。

禁止传递：

- 原始 rows；
- series 数组；
- 绝对路径；
- 任意脚本或 HTML；
- 未经 profile 允许的其他 Dataset。

**分工硬规则：spec 由 specialist 组装，data_junior 只交"要什么视图"。** `kind` / `x` / `series` /
`markers` / `title` 的取值由 specialist 读 `capital-chart-protocol` 决定；data_junior 的 prompt 只写
视图角色（主视图/辅助视图）、目标窗口与关心的字段名。实测偏离这条要付两笔账：一次 8.3K 字符的
思考（在替 specialist 算 spec 与标记位置），以及为同一个 dataset 重签 token。

**协议排除的视图要记为 limitation，不要改方案重签。** 需要"归一化对比 / 多源叠加"（例如个股与
指数同图）时：当前能力不支持，按"图表跟着 Dataset 一对一"拆成各自独立的单源图，并在回传的
`warnings` 里写明「归一化叠加对比不支持，已拆为 N 张单源图」。不要为此重新 `prepare_chart_source`，
也不要自造归一化序列。

## 3. visualization_specialist 选图规则

### 3.1 视图选择

| 目标 | 首选 kind | 典型字段 |
|---|---|---|
| 时间趋势 | `line` / `area` | 时间字段 + 一个或多个数值字段 |
| 多期逐期比较 | `column` | 期间/类别字段 + 数值字段 |
| OHLC 行情 | `candlestick` | 真实时间字段 + open/high/low/close |
| OHLC 柱 | `bar` | 真实时间字段 + open/high/low/close |
| 成交量辅助 | `volume` | 与 OHLC 同行的成交量字段 |
| 类别排名 | `column` / `bar` | 类别 + 已受控聚合的数值 |
| 分布 | `column` | 先由 data_junior 提供区间计数，再绘制 |

`bar` 不是普通单值柱状图；普通单值柱状图使用 `column`。

没有经过受控聚合的原始高基数类别不要直接画成拥挤图表。

### 3.2 字段选择

- 字段名必须来自 profile 或工具错误中的可用字段；
- 不根据中文语义猜不存在的字段；
- `candlestick` / `bar` 必须拥有完整 OHLC 和真实时间字段；
- 同一图最多选择 6 条数值序列；
- 多序列只有在单位和比较意义相近时才放在一张图；
- 单位不同或量级差异过大时拆成多个 chart plan；
- volume 只有在数据语义确实是成交量时才使用，不要把任意数量字段标成 volume。

### 3.3 图表数量

第一版每个 profile 最多生成 4 张图，并优先选择信息增益最高的视图：

1. 用户问题直接要求的主视图；
2. 能解释主视图的辅助视图；
3. 风险或异常视图；
4. 只有确实有必要时才增加第四张。

不要为了达到数量上限而重复绘制同一信息。

## 4. 调用 render_chart

第一次调用前加载：

```text
skill capital-chart-protocol
```

使用 `chart_source_ref` 和当前 `task_id`：

```jsonc
{
  "chart_source_ref": "cs_01J...",
  "task_id": "task_01J...",
  "spec": {
    "kind": "line",
    "x": "trade_date",
    "series": [
      { "field": "close", "label": "收盘价" }
    ],
    "title": "近一年收盘价走势"
  }
}
```

不要把 chart source token 改写成 `dataset_id` 或 workspace path。

成功后只保留：

```text
chart_ref
chart_id
kind / axis
points / original_points / downsampled
warnings
必要的标题和视图角色
```

不要转发：

```text
series.json
raw rows
chart.html 内容
绝对路径
```

如果收到 `chart_source_expired` 或 `chart_source_scope_mismatch`，不要猜 token，
应把当前 specialist 标为 failed，由 data_junior 如实汇总。

如果收到 `chart_spec_invalid` 或 `chart_field_not_found`，只根据错误中的 allowed/available
信息修正一次；第二次仍失败则回传 failed，不要循环试错。

## 5. one-shot barrier 与回传

visualization_specialist 是前台 one-shot：

- 不调用 `send_message`；
- 不创建下游 Agent；
- 不启动 background Job；
- 最终结果直接返回给 data_junior。

data_junior 必须等本批次所有 specialist 都有终态：

```text
rendered
skipped
failed
```

之后才向主 Agent发送一次结构化汇总，至少包括：

```text
task_id
dataset_id
profile_ref
visualization.decision
visualization.pending = 0
charts[].chart_ref
warnings / failures
```

图表成功后，data_junior 回传 `chart_ref`；图表失败、blocked 或 not_needed 也必须回传明确的终态、warnings/failures 和 task_id，不能让主 Agent把“无图表”误解为流程未完成。

**呈现由宿主完成，不需要任何 Agent 再做什么**：`render_chart` 成功时宿主会把这张图登记为
**本轮交付物**（官方 `deliverables/presented`），用户在收尾的「本轮文件改动 / 交付」行点开
`chart.html`，右侧即渲染可交互图表。因此 data_junior 与 specialist **都不得**在回传里罗列图表文件、
路径或 HTML，主 Agent 也不在正文里重复这些内容。

**图表跟着 Dataset 一对一，宁多勿叠**：一个 `chart_source_ref` 对应一张图；需要多个视图就出多张
（各自独立的 `render_chart`）。不要试图把多个来源、多种单位或需要归一化的序列叠进一张图 ——
当前能力也不支持（无多源合并、无归一化字段），叠出来的图用户只会更晕。

## 6. 安全与来源

- 图表只展示已授权 Dataset；
- 不使用图表替代 profile/query 数值事实；
- 不把网页数字伪装成 Dataset 事实；
- 不在回传或正文里罗列图表文件路径、HTML 或 series；
- 不索取凭据；
- 不自动下单；
- 不输出收益、胜率或准确率承诺。
