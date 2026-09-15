---
name: capital-chart-protocol
description: Use before calling render_chart — the full chart spec vocabulary (kind, x, series, ohlc, volume, markers, range), field-selection rules, time-axis vs category-axis behaviour, the downsampling and marker-snapping semantics, every chart_* error code and how to fix it in one retry, and what the receipt does and does not contain.
---

# Capital 图表协议（render_chart 完整版）

`render_chart` 的工具 schema 只留最小面（`dataset_id` / `path` / `spec` / `title`），
图表 DSL 的完整语义在本文件按需加载 —— 这样"可视化能力"不占用每轮上下文。

## 0. 一句话边界

图表是**呈现**，不是分析。任何写进结论的数字仍必须来自 `profile_dataset` / `query_dataset`
或 `data_collector` 的结构化回传；不要用图去"看出"首末值、涨跌幅或分位数。

## 1. 调用形状

```jsonc
{
  "dataset_id": "ds_01J...",        // 与 path 二选一
  "path": "capital-data/datasets/ds_.../raw.json",  // workspace 相对路径
  "spec": { "kind": "candlestick", "x": "trade_date", "ohlc": {...}, "volume": "volume" },
  "title": "贵州茅台 近一年日线"     // 可选，覆盖 spec.title
}
```

- **来源二选一**，同时给或都不给都会得到 `chart_source_invalid`。
- `path` 只接受 workspace 相对路径：绝对路径、`..`、反斜杠一律拒绝。
- 数据形状：顶层数组，或含行数组的对象（`item` / `items` / `data` / `rows` / `list` / `records` / `result`
  优先；只有一个其它数组键时也接受；**多个歧义候选会报错让你自己先裁好**）。

## 2. spec 字段

| 字段 | 取值 | 说明 |
|---|---|---|
| `kind` | `line` \| `area` \| `column` \| `candlestick` \| `bar` | 必填。见下方"kind 与数据形状" |
| `x` | 字段名 | 横轴字段。**能解析成时间的值越多越可能走时间轴**；否则自动降级为分类轴并用它的取值做刻度 |
| `series` | `["close"]` 或 `[{field,label,type}]` | `line/area/column` 必填，1–6 条；`type` ∈ `line`(默认) / `area` / `column` |
| `ohlc` | `{open,high,low,close}` | `candlestick` / `bar` 必填；此时也必须给 `x` |
| `volume` | 字段名或 `{field}` | 可选副图；同一行有 OHLC 时按 A 股习惯标涨红跌绿 |
| `markers` | `[{time\|index, text, position?}]` | 可选，≤50 个；`position` 取 `aboveBar`（默认）/`belowBar`/`inBar` |
| `range` | `{from?,to?}` | 可选；日期字符串或 epoch |
| `title` | 字符串 | 可选 |

### kind 与数据形状必须匹配（宿主硬校验，写错会得到可自愈的错误）

| kind | 图表库序列 | 需要的数据 | 用在哪 |
|---|---|---|---|
| `line` / `area` | LineSeries / AreaSeries | 单值：`series` 字段选择 | 走势、对比、累计曲线 |
| `column` | HistogramSeries | 单值：`series` 字段选择 | 逐期对比（营收、成交量） |
| `candlestick` | CandlestickSeries | **OHLC 四字段** + 真实时间列 | K 线 |
| `bar` | BarSeries | **OHLC 四字段** + 真实时间列 | 美式 OHLC 柱 |

两条容易踩的坑：

- **`bar` 不是"柱状图"**。它指 OHLC 柱，必须给 `ohlc`。单值柱状图请用 `column`；
  给错会收到 `chart_spec_invalid` 并明确指向 `column`。
- **本库没有统计分箱直方图**。`column`（含别名 `histogram`）画的是着色柱，不做分箱。
  真的要画分布，先用 `query_dataset` 把数据分箱成"区间 + 计数"，再用 `column` 画那两列。

别名容忍：`x` 也可写 `time` / `time_field`；`series` 也可写 `fields` / `y`；`ohlc` 也可写 `candles`；
`range.from/to` 也可写 `start/end`；`markers` 的 `time` 也可写 `date`；`kind` 的
`histogram` 等价于 `column`，`candles` / `candle` 等价于 `candlestick`。整个 `spec` 或其中的
数组/对象**可以直接传 JSON 字符串**（模型常见传法，宿主会解析）。

## 3. 时间口径（确定，不随宿主时区变化）

| 取值 | 解释 |
|---|---|
| `2025-01-02` | 业务日；轴上原样显示，不做时区换算 |
| `2025-01-02 08:00:00`（无时区） | 按 **UTC** 解释 |
| `2025-01-02T08:00:00+08:00` | 按给出偏移解释 |
| 数字 / 纯数字字符串，≥ 1e11 | epoch **毫秒** |
| 数字 / 纯数字字符串，< 1e11 | epoch **秒** |

无法解析的行会被丢弃并计入 `warnings.skipped_rows`；时间列**必须**有值。
时间轴会被强制升序去重（库的要求），发生重排/去重时 `warnings` 会如实披露。

## 4. 有界化语义（必须会读 warnings）

- 最多保留 **2000** 个点；超出由宿主做 LTTB 下采样，**主序列、K 线、成交量副图共用同一组时间下标**，
  不会错位。`meta.downsampled=true` 时结论里应注明"已下采样，非全量"。
- **标记点会吸附到最近的保留时间点**，不会因为下采样而消失。
- 数值口径与 Dataset 一致：数字，或 Dataset schema 允许的数字字符串；空值/非数值被丢弃并计入 `warnings`。
- 分类轴按**行序**编号，刻度用 `x` 的原始取值（没有 `x` 时显示行号）。

## 5. 错误码与一次改对

| 错误码 | 含义 | 怎么改 |
|---|---|---|
| `chart_source_invalid` | 来源不是恰好一个；或 JSON 对象有多个候选行数组 | 只给 `dataset_id` 或 `path` 之一；多个数组时先自己裁出目标数组 |
| `chart_source_not_found` / `dataset_not_found` | 路径不存在或 Dataset 不可见 | 核对路径 / dataset_id 是否属于本会话作用域、是否已过期 |
| `chart_spec_invalid` | spec 结构问题（kind 非法、candlestick 缺 `x`、markers 超限…） | 按错误文本里的 `allowed` 改 |
| `chart_field_not_found` | 字段名不在数据里 | 错误文本会列出**可用字段**（最多 15 个），直接改用列出的名字 |
| `chart_no_rows` | 没有可画的行 | 换来源，或先确认时间列/区间 |
| `chart_too_large` | 超出 16MB 或 20 万行上限 | 先缩小 `range`，或改用更小的 Dataset |
| `chart_write_failed` / `workspace_not_writable` | 产物落盘失败 | 检查当前工作区权限；不要反复重试 |

一次改对是设计目标：错误文本里已经包含修正所需的最小信息。

## 6. 产物与回执

产物写进 `capital-analysis/charts/<chart_id>/`：

- `chart.html` —— **自包含**单文件（内联图表库与数据），离线可开；回执里的 `html_path` 就是它。
- `series.json` —— 归一化后的载荷（重绘或调试用）。
- `spec.json` —— 归一化后的 spec 与来源（可复现）。

回执**只有元数据**：`chart_id`、`kind`、`axis`、`points`/`original_points`/`downsampled`、
`series_labels`、`has_volume`、`markers`、来源标注（`dataset_id`/`source_label`/`captured_at`）、
三个产物路径、`warnings`。**没有任何数据行** —— 序列不进上下文，这正是这套设计的意义。

向用户呈现时：图已经在对话流里；若还要点击展开，用 `present` 声明 `html_path`，
用户可在右栏文档面板里交互查看。结论的文字部分仍需自己写清来源与口径。
