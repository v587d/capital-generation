# kline_quality fixtures

一组一份目录，`fixtures/` 不进发布包（`npm pack` 不含它），只随仓库走测试。

```text
<case>/
  datasets/<dataset_id>.json   # 一份 Dataset：rows 数组（+ 可选 time_coverage / envelope）
  params.json                  # 传给 run_analysis 的 params
  expected.json                # golden：正常/边界 case 是 status / metrics / data_gaps；
                               #          输入错误 case 是 error.code / error.message_contains
```

`expected.json` 是**手算**的，不是从模块输出里录的：每行按 `module.json` 的合法性定义逐条判过，
指标由 `datasets/` 的 bar 直接算出后写死。改规则时先改这里，再看模块是不是算错。数字口径：
价格 6 位小数，计数是整数；摘要里的百分比保留 2 位（`50.00%` 对应 0.5 的锚点 ×100）。

## 逐行判据（`rejected[].reason` 是稳定命名，按此顺序取第一条命中的）

| reason | 判据 |
|---|---|
| `time_unparseable` | 时间列不是 `YYYY-MM-DD` 开头的 ISO 日期，也不是有限的 epoch 毫秒 |
| `price_invalid` | `open/high/low/close` 任一不是有限数字或 ≤ 0 |
| `high_below_max` | `high < max(open, close, low)`（含 `high < low` 与 `open > high` 两种形态） |
| `low_above_min` | `low > min(open, close, high)` |
| `duplicate_date` | 同一交易日出现多行：保留**输入序中第一条通过前四项校验的行**，其余行以本原因拒绝并计数 |

软标记不改价格、不删 bar：`suspect_jump` = 清洗序列相邻两根 bar 的收盘涨跌幅绝对值**严格大于**
`jump_threshold`（默认 0.5）；`volume_missing` = `volume` 缺失、非数字或 ≤ 0，该 bar 的 `volume`
不进清洗序列，也不当作 0 参与统计。状态：有硬拒绝或 `suspect_jump` → `partial`；只有
`volume_missing` 不算降级（停牌日 volume=0 按正常 bar 保留，`normal` 就是 `completed`）；
清洗后没有合法 bar → `blocked`。

## 指标口径

| metric | 含义 |
|---|---|
| `rows_total` / `rows_cleaned` / `rejected_rows` | 输入行数 / 通过硬校验的 bar 数 / 被拒绝的行数 |
| `suspect_rows` | 相邻收盘涨跌幅绝对值严格大于 `jump_threshold` 的 bar 数（保留在清洗序列） |
| `volume_missing_rows` | `volume` 缺失、非数字或 ≤ 0 的 bar 数（无 `volume` 列时为 0，见 limitations） |
| `duplicate_dates` / `rejected_duplicate_date` | 重复日期数 / 因此被拒绝的行数（同一行的两个口径） |
| `trading_days` | 清洗序列覆盖的交易日数（一根 bar 一天，等于 `rows_cleaned`；单列供下游按交易日口径取用） |
| `max_abs_daily_change` | 清洗序列相邻收盘涨跌幅绝对值的最大值（6 位小数；不足 2 根 bar 时为 0） |
| `jump_threshold` | 本次实际生效的阈值（默认 0.5），原样写进结果 |
| `rejected_<reason>` | 每个稳定原因各一个整数计数，见上表 |
| `first_date` / `last_date` / `first_close` / `last_close` | 清洗序列首尾日期与收盘价；清洗后没有合法 bar 时不出现 |

审计文件 `outputs/kline_quality.json`：`columns` / `time_axis` / `parameters` / `window` /
`statistics`（= 结果 metrics）/ `rejected`（逐条 `index` + `reason` + 原值，时间无法解析时没有 `date`）/
`suspects`（`index` / `date` / `previous_close` / `close` / `change`）/ `volume_missing` /
`series`（清洗后完整序列；`volume` 只在为正数时出现）/ `data_gaps`。

## case

| case | 覆盖 | 期望 |
|---|---|---|
| `normal` | 6 根干净日 K，其中 2024-01-04 `volume=0` | `completed`，`volume_missing_rows=1`，`max_abs_daily_change=0.014778` |
| `noisy` | 10 行：`high < max(open,close,low)` 两行（含 `open>high` 与 `high<low`）、`low > min(...)` 一行、`close=0` 一行、重复日期一行、`2024/01/11` 日期一行、一行缺 volume | `partial`，清洗 4 根 bar；拒绝 6 行，逐原因计数与 `data_gaps` 对上 |
| `jump` | 5 根 bar，2024-01-04 收 163.2 对前收 102 = +60% | `partial`，`suspect_rows=1`（默认阈值 0.5），该 bar 保留在 `series` |
| `jump_threshold` | 与 `jump` 同一组 bar，`jump_threshold=0.7` | `completed`：0.6 不大于 0.7，不标可疑；阈值原样写进 metrics |
| `ms_timezone` | `trade_date_ms` epoch 毫秒 + `time_coverage` + `timezone=Asia/Shanghai` | `completed`，日期标注为 2024-01-02..2024-01-04（当地日期，不是 UTC 前一天） |
| `no_volume` | 完全没有 `volume` 列（可选列） | `completed`，`volume_missing_rows=0`，limitations 说明未做成交量体检 |
| `all_rejected` | 3 行分别被 `price_invalid` / `high_below_max` / `time_unparseable` 拒绝 | `blocked`，`rows_cleaned=0`；审计文件仍写出全部拒绝行 |
| `document` | 文档型 Dataset（`shape=document`） | 模块内 `analysis_input_invalid`：不把文档当表格 |
| `missing_columns` | 只有 `date/close/volume`，没有 OHLC 四列 | 模块内 `analysis_input_invalid` 并点名缺的列 |

`normal` 的相邻涨跌幅：102/101−1 = 0.009901、101.5/102−1 = −0.004902、103/101.5−1 = 0.014778、
104/103−1 = 0.009709、105/104−1 = 0.009615，最大绝对值 0.014778（6 位舍入）。

`noisy` 清洗后剩 2024-01-02/03/10/12 四根（收 101/102/105/108），相邻最大 105/102−1 = 0.029412；
`duplicate_dates=1` 与 `rejected_duplicate_date=1` 是同一行的两个口径（重复日期数 / 因此拒绝的行数）。
2024-01-03 那行没有 volume，`volume_missing[0]` 因此没有 `volume` 键（缺值不是 0）。

`jump` 的 163.2/102−1 在双精度下是 0.5999999999999999，严格大于 0.5 所以标可疑；
`jump_threshold=0.7` 时同一根 bar 不超阈值，状态回到 `completed` —— **阈值是调用方参数，不是固定结论**。

`no_volume` 验证 `volume` 是可选的：没有这列时不是每根 bar 都被标 `volume_missing`，而是整段不做成交量体检
（只写 limitations）。

`ms_timezone` 的 1704124800000 是 2024-01-01T16:00:00Z，在 Asia/Shanghai 是 2024-01-02 08:00，
所以窗口起点是 2024-01-02；按 UTC 标注会落到 01-01，测试用这条钉住 `timezone` 参数。

`document` / `missing_columns` 在快照建好之后、Python 起算之前失败（`analysis_input_invalid`），
不产出 `outputs`：没有可复算的清洗序列。`document` 的 `datasets/*.json` 只是文档型输入的声明，
测试里把暂存视图的 `shape` 改成 `document` 来走模块的防御分支（真实宿主在建快照时就拒文档型）。
