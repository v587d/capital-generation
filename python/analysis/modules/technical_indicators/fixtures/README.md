# technical_indicators fixtures

每组 case 一份目录，`fixtures/` 不进发布包（`.npmignore` 排除），只随仓库走测试。

```text
<case>/
  datasets/<dataset_id>.json   # 一份 Dataset：rows（+ 可选 time_coverage / shape）
  params.json                  # 传给 run_analysis 的 params
  expected.json                # golden：status / metrics / data_gaps；输入错误时是 error
```

`expected.json` 是**手算**的，不是从模块输出里录的：指标由 `datasets/` 的价格按
`module.json` 的公式用有理数精确计算后写死（见下面「normal 手算过程」），再与模块实现逐项
对齐。改公式时先改这里，再看模块是不是算错。数字口径：价格与指标保留 6 位小数；摘要里
保留 4 位小数（锚点可按 2–4 位小数命中）。

指标只在窗口完整时给出，否则 `metrics` 里没有该键、`data_gaps` 点名所需/实际根数、
`outputs` 的逐 bar 序列里该指标为 `null`。窗口要求：SMA / BOLL 需要 n 根，EMA 需要 n 根，
RSI 需要 n+1 根，MACD 需要 slow+signal 根（EMAs 齐），ATR 需要 n+1 根（TR 从第 2 根起，
首值取前 n 个 TR 的均值）。

| case | 覆盖 | 期望 |
|---|---|---|
| `normal` | 10 根带 high/low 的收盘价；SMA [2,3]、EMA [3]、RSI 3、MACD 2/3/2、BOLL 3×2、ATR 3；`price_dataset_id` 省略（自动识别唯一价格序列） | `completed`，11 项指标值 + 12 个相对/交叉状态，摘要与审计文件逐项可复算 |
| `insufficient` | 3 根收盘价；SMA [2,5] + EMA [3]（SMA2 / EMA3 可算，SMA5 窗口不足） | `partial`，`sma_5` 缺席，缺口点名「需要 5 根收盘价，实际 3 根」；SMA2 / EMA3 照常给出 |
| `all_insufficient` | 2 根带 high/low 的收盘价；SMA 5、EMA 10、RSI 14、MACD 12/26/9、BOLL 20、ATR 14 全部窗口不足 | `blocked`，6 条缺口逐组点名，不写 outputs |
| `bad_rows` | 11 行里一行 close=0、一行日期不是合法 ISO（2024-13-40）、一行 close=-3 | `partial`，跳过 3 行并逐行点名，用剩余 8 个有效观测算 SMA2 / ATR3 |
| `missing_ohlc` | 5 根只有 date/close 的收盘价；请求 SMA 2 + ATR 3 | `partial`，ATR 缺口点名缺 high/low 两列，SMA2 照常计算 |
| `duplicate` | 同一日期 2024-01-03 两行 | 运行前 `analysis_input_invalid`，点名重复日期 |
| `unrelated` | 只有 date/revenue 的行，没有价格列 | 运行前 `analysis_input_invalid`，点名「没有可识别的价格序列」 |
| `no_params` | 没有任何 Dataset、params 为空 | 运行前 `analysis_input_invalid`，点名「指标参数」；一个指标参数都不给就不启动计算 |
| `document` | `shape="document"` 的 Dataset | 运行前 `analysis_input_invalid`，说明只吃表格价格序列（宿主建快照时通常已先拒） |

`normal` 的指标组都在一份 10 根序列上算完，因此它同时是「自动识别价格列 / 时间列」「逐 bar
null 起点」「交叉状态」的正例；`insufficient` / `missing_ohlc` 覆盖「缺口不影响其它指标」，
`bad_rows` 覆盖「坏行跳过而不是当 0」。

## normal 手算过程

收盘价（第 1–10 根）：`10, 11, 12, 11, 13, 14, 13, 15, 16, 15`
high：`10.5, 11.5, 12.5, 11.8, 13.5, 14.5, 13.6, 15.5, 16.5, 15.4`
low：`9.5, 10.5, 11.5, 10.2, 12.5, 13.5, 12.4, 14.5, 15.5, 14.4`

**SMA**：最新值取最近 n 根均值。
`SMA2 = (16 + 15) / 2 = 15.5`；`SMA3 = (15 + 16 + 15) / 3 = 46/3 = 15.333333`。
逐 bar 序列里前 1 根（SMA2）/前 2 根（SMA3）为 `null`。

**EMA(3)**：平滑系数 `2/(3+1) = 1/2`，首值用前 3 根均值 `(10+11+12)/3 = 11`（第 3 根），
之后 `EMA = 前值 + 0.5 × (收盘 − 前值)`：
`11 → 11 → 12 → 13 → 13 → 14 → 15 → 15`，最新 `EMA3 = 15.0`。

**RSI(3)**：Wilder 平滑。前 3 个变动 `+1, +1, -1` → 平均涨 `2/3`、平均跌 `1/3`，
`RS = 2`，`RSI = 100 − 100/(1+2) = 66.666667`（第 4 根）。之后每次：
`平均涨 = (前平均涨×2 + 本期涨)/3`，平均跌同理，`RS = 平均涨/平均跌`。
逐根：`66.666667 → 83.333333 → 87.878788 → 62.365591 → 79.885057 → 85.090522 → 61.296509`。
最新一根变动为 `-1`，此时 `平均涨 = 1598/2187`、`平均跌 = 1009/2187`，
`RS = 1598/1009`，`RSI = 100 − 100/(1 + 1598/1009) = 159800/2607 = 61.296509`。

**MACD(2/3/2)**：`EMA2` 系数 `2/3`，首值 `(10+11)/2 = 10.5`（第 2 根）；`EMA3` 首值 `11`（第 3 根）。
最新两根 EMA2 = `15.153864`、EMA3 = `15.0`，所以 `MACD = 0.153864`。
signal 是 MACD 序列上的 EMA(2)：MACD 从第 3 根开始（`0.5, 0.166667, …`），
首值取前 2 个 MACD 均值 `(0.5 + 0.166667)/2 = 0.333333`（第 4 根），
最新 `signal = 0.242798`；`hist = 0.153864 − 0.242798 = -0.088935`。
MACD 组要求 `slow + signal = 5` 根，本组 10 根满足。

**BOLL(3, 2)**：中轨 = `SMA3 = 46/3`。最近 3 根 `15, 16, 15` 的**总体**方差（除以 n=3）：
`((15−46/3)² + (16−46/3)² + (15−46/3)²)/3 = (1/9 + 4/9 + 1/9)/3 = 2/9`，
标准差 `√(2/9) = 0.471405`。上轨 `46/3 + 2×0.471405 = 16.276142`，
下轨 `46/3 − 2×0.471405 = 14.390524`。

**ATR(3)**：TR 从第 2 根起（无前收），TR = max(high−low, |high−前收|, |low−前收|)：
`1.5, 1.5, 1.8, 2.5, 1.5, 1.6, 2.5, 1.5, 1.6`。
首值 ATR 在第 4 根 = 前 3 个 TR 均值 `(1.5+1.5+1.8)/3 = 1.6`；之后
`ATR = (前 ATR×2 + 本期 TR)/3`：
`1.9 → 1.766667 → 1.711111 → 1.974074 → 1.816049 → 1.744033`，最新 `ATR3 = 1.744033`。

**交叉/相对状态**（最新一根）：`SMA2 15.5 > SMA3 15.333333` → `sma_2_above_sma_3 = true`；
上一根 `SMA2[9]=15.5`、`SMA3[9]=14.666667` 也已是上方，所以最新一根没有向上/向下穿越
（`sma_2_crossed_above_sma_3 = false`、`sma_2_crossed_below_sma_3 = false`）。
收盘 15 低于 SMA2 / SMA3 / EMA3 / 布林中轨，`close_above_*` 全为 false；
MACD 低于 signal（上一根曾高于），`macd_above_signal = false`、`macd_crossed_below_signal = true`。

## 状态与摘要口径

- `status`：请求的指标全部算成 → `completed`；有窗口缺口或跳过坏行 → `partial`；一项指标都
  算不成 → `blocked`（不写 outputs，理由与 `returns_risk` 一致：没有可复算的指标）；不是
  表格 / 完全无有效行 / 有效观测少于 2 个 → `analysis_input_invalid`，不产生结果。
- `metrics` 每项保留 6 位小数，并带 `close`、`observations` 与布尔状态（如
  `sma_5_above_sma_20`）；窗口不足的指标不出现在 `metrics` 里，`outputs.series` 中为 `null`。
- `summary` 的数值保留 2–4 位小数，能被宿主锚点命中，并固定写明「指标是复盘条件，不是买卖
  信号或方向预测」；不出现评级、目标价、收益承诺。
- `outputs/technical_indicators.json` 写参数、窗口、逐 bar 序列、指标元数据（公式 / 窗口 /
  所需根数）与 `data_gaps`。超过 `MAX_SERIES_BARS = 2000` 根时只写最近 2000 根（指标仍按完整
  序列计算），并在 `limitations` 披露。
