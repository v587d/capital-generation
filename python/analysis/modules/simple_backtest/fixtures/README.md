# simple_backtest fixtures

一组一份目录；`fixtures/` 不进发布包（`npm pack` 不含它），只随仓库走测试。

```text
<case>/
  datasets/<dataset_id>.json   # 一份价格 Dataset：rows 数组（date/close，+ 可选 time_coverage）
  params.json                  # 传给 run_analysis 的 params
  expected.json                # golden：status / metrics / data_gaps（+ trades / position / equity）；
                               #          输入错误 case 是 error.code / error.message_contains
```

`expected.json` 是**手算**的，不是从模块输出里录的：均线、信号、成交、净值与统计都按下面
「固定口径」逐根算出后写死。改口径时先改这里与 `module.json` 的 `assumptions`，再看模块是不是算错。

## 固定口径

- **输入**：一份价格序列；一行一个时间点。时间只解析两种形态：以 `YYYY-MM-DD` 开头的 ISO 日期，
  或有限的 epoch 毫秒（数值时间轴按 `timezone` 参数标注日历日，省略按 UTC）。价格必须是正数。
  时间无法解析或价格非正的行**跳过并计数**（`data_gaps` 点名），跳过后按剩余观测重排 bar 序号；
  同一日期出现多行是输入错误（不静默取一行），文档型 Dataset 也是输入错误。
- **信号**：`sma_cross` 用快/慢两条简单均线——快线在慢线**严格上方**做多、严格下方空仓、相等保持前一状态；
  `price_above_sma` 用一条均线——收盘价**严格高于**均线做多，否则空仓。均线 = 最近 `window` 根收盘的算术平均。
- **成交**：第 t 根收盘算出的目标仓位，在**第 t+1 根收盘**成交，因此第 t 根收盘永远不参与第 t 根的交易，
  也不存在「收盘价先知道、再回头成交」的用法。只做多、空仓两态，没有做空、杠杆与仓位管理。
- **净值**：`E[0] = initial_capital`；第 b 根（b ≥ 1）`E[b] = E[b-1] × (持仓则 close[b]/close[b-1] 否则 1) × (当根成交则 1 − fee_rate 否则 1)`。
  即：空仓日净值不变；持有期按收盘到收盘变化；**买入与卖出各扣一次单边 `fee_rate`**（`equity *= (1 − fee_rate)`，
  不按成交额另算）。买入成交当根只扣手续费、不吃当天涨跌（收盘才成交）。
- **仓位**：`position` 是**当日收盘后**的仓位（0/1）：买入成交当根起为 1，卖出成交当根起为 0。
  持有 bar 数 `exposure_bars` = `position == 1` 的根数；`exposure_ratio = exposure_bars / observations`。
- **交易**：一次完整往返（entry → exit）算一笔。`bars` = 该笔的持有 bar 数：平仓交易 = 卖出根 − 买入根；
  未平仓交易 = 最后一根 − 买入根 + 1（与 `exposure_bars` 同口径，所以 `Σ bars = exposure_bars`）。
  `price_return` 只用价格（exit 或最后收盘 / entry − 1）；`net_return` 只在平仓交易上给，
  = 卖出后净值 / 买入前净值 − 1（含两次手续费）。期末仍持有的交易标 `"open": true`，只给 `last_date` / `last_price` /
  `price_return`，**不计入胜率分母**，也不写假的 `net_return`。
- **胜率**：`win_rate` = `net_return > 0` 的平仓交易数 / `trade_count`（未舍入判断）；只有平仓交易时才有这个
  字段，一笔平仓交易都没有时**缺省并写缺口**（不写 0），状态随之降为 `partial`。
- **指标**：`observations` 有效观测数；`total_return = E[-1]/initial_capital − 1`；`buy_and_hold_return`
  = 同一段价格首尾收盘 `close[-1]/close[0] − 1`（未扣手续费，作为对照）；`max_drawdown` = 净值序列
  `min(E[b]/峰值 − 1)`，没有回撤时是 0；`final_equity = E[-1]`。金额/净值/比率都保留 6 位小数（四舍五入），
  摘要里的百分比保留 2 位。
- **状态**：有效观测 < `max(fast_window, slow_window) + 2` → `blocked`（不写 outputs，没有东西可复算）；
  跳过坏行或 win_rate 缺省等缺口 → `partial`；否则 `completed`。无有效观测 / 不是价格序列 / 参数不合法 →
  运行前（或模块入口处）`analysis_input_invalid`。
- **摘要**：数字可锚点命中（百分比 2 位小数、净值 6 位小数）；默认 `fee_rate=0` 时必须出现原文「未扣手续费」；
  所有摘要都写明「样本内回测、参数由调用方给定、未做参数寻优；不预测、不构成策略推荐」。
- **审计文件**：`outputs/simple_backtest.json` 记录 `parameters` / `window` / `statistics`（= 结果 metrics）/
  `series`（逐日 `close` / `sma_fast` / 可选 `sma_slow` / `signal` / `position` / `equity`）/ `trades` / `data_gaps`。
  `signal` 是第 t 根算出的目标仓位（窗口未满时为 null），`position` 是成交后的收盘仓位。

## 逐 case

| case | 覆盖 | 期望 |
|---|---|---|
| `normal_sma_cross` | 10 根价格，fast 2 / slow 3，`fee_rate=0.001`；一次完整往返 + 一笔未平仓 | `completed`；total −5.0671%、final 0.949329、maxDD −5.0671%、trade_count 1、win_rate 0、exposure 4/10 |
| `price_above_sma` | 7 根价格，fast 2；先下后上再回落，一次完整往返；默认手续费 0 | `completed`；total −2.9126%、exposure 2/7、win_rate 0；摘要原文「未扣手续费」 |
| `no_trades` | 单调上涨 5 根 + `price_above_sma` fast 2：第 3 根买入后一直持有到期末，没有平仓交易 | `partial`；trade_count 0 → win_rate 缺省 + 缺口；未平仓 1 笔（entry 102、last 104）；exposure 3/5 |
| `flat` | 恒定价格 5 根：收盘价从**不严格高于**均线，从不触发 | `partial`；total/B&H/maxDD 全 0、exposure 0、trade_count 0、win_rate 缺省 + 缺口 |
| `insufficient` | 3 根价格 + slow 5：required = 5+2 = 7 | `blocked`；metrics `{}`，缺口说明不足，不写 outputs |
| `bad_rows` | 8 行中 2 行坏：`2024/06/05` 不是 ISO 日期、`2024-06-11` 缺 close；剩 6 个有效观测 | `partial`；跳过 2 行并点名；total −2.9126%、exposure 2/6 |
| `invalid_rule` | `rule=momentum_reversal` 不在 enum | **启动 Python 前**被宿主参数校验拒绝：`analysis_input_invalid`，不产生 module run |
| `missing_columns` | 只有 date/volume，没有价格列 | 模块内 `analysis_input_invalid`：自动识别失败时列出可用价格列名；指名 `price_dataset_id` 时点名找不到价格列 |

## 手算过程（`normal_sma_cross`）

价格与两根均线（SMA2 / SMA3，6 位小数）：

| 日期 | close | SMA2 | SMA3 | 信号（t 收盘） | 仓位（收盘后） |
|---|---|---|---|---|---|
| 2024-01-02 | 100 | — | — | — | 0 |
| 2024-01-03 | 102 | 101 | — | — | 0 |
| 2024-01-04 | 104 | 103 | 102 | 1 | 0 |
| 2024-01-05 | 103 | 103.5 | 103 | 1 | 1（01-04 的信号在 01-05 收盘买入） |
| 2024-01-08 | 101 | 102 | 102.666667 | 0 | 1 |
| 2024-01-09 | 99 | 100 | 101 | 0 | 0（01-08 的信号在 01-09 收盘卖出） |
| 2024-01-10 | 101 | 100 | 100.333333 | 0 | 0 |
| 2024-01-11 | 105 | 103 | 101.666667 | 1 | 0 |
| 2024-01-12 | 107 | 106 | 104.333333 | 1 | 1（01-11 的信号在 01-12 收盘买入） |
| 2024-01-15 | 106 | 106.5 | 106 | 1 | 1（未平仓，期末标记） |

净值（`initial_capital=1`、`fee_rate=0.001`，`×0.999` 即扣一次单边手续费）：

- E0 = E1 = E2 = 1
- E3 = 1 × 0.999 = 0.999（01-05 买入）
- E4 = 0.999 × 101/103 = 0.979602（01-08 持仓）
- E5 = E4 × 99/101 × 0.999 = 0.999² × 99/103 = 0.959244（01-09 先吃当日收益、再扣卖出费）
- E6 = E7 = 0.959244（空仓不变）
- E8 = 0.959244 × 0.999 = 0.958284（01-12 买入）
- E9 = 0.958284 × 106/107 = 0.949329（01-15 未平仓按收盘标记）

交易 1：entry 2024-01-05 @103（index 3），exit 2024-01-09 @99（index 5）；`bars = 5−3 = 2`（01-05→01-08、
01-08→01-09 两个收盘到收盘区间）；`price_return = 99/103−1 = −0.038835`；`net_return = 0.959244/1−1 = −0.040756`。
交易 2（未平仓）：entry 2024-01-12 @107（index 8），`bars = 10−8 = 2`，`price_return = 106/107−1 = −0.009346`。

统计：`total_return = 0.949329−1 = −0.050671`；`buy_and_hold = 106/100−1 = 0.06`；净值峰值始终是 1，
`max_drawdown = 0.949329−1 = −0.050671`；`trade_count = 1`（只数平仓）；`win_rate = 0/1 = 0`；
`exposure_bars = 4`（01-05、01-08、01-12、01-15 收盘持仓），`exposure_ratio = 4/10 = 0.4`。

## 手算过程（`price_above_sma`）

| 日期 | close | SMA2 | close > SMA2 | 仓位（收盘后） |
|---|---|---|---|---|
| 2024-02-01 | 100 | — | — | 0 |
| 2024-02-02 | 98 | 99 | 否 | 0 |
| 2024-02-05 | 96 | 97 | 否 | 0 |
| 2024-02-06 | 99 | 97.5 | 是 | 0（02-06 的信号在 02-07 收盘买入） |
| 2024-02-07 | 103 | 101 | 是 | 1 |
| 2024-02-08 | 101 | 102 | 否 | 1（02-08 的信号在 02-09 收盘卖出） |
| 2024-02-09 | 100 | 100.5 | 否 | 0 |

`fee_rate=0`：E0..E4 = 1；E5 = 101/103 = 0.980583；E6 = 0.980583 × 100/101 = 100/103 = 0.970874。
`total_return = 100/103−1 = −0.029126`；`buy_and_hold = 100/100−1 = 0`；`max_drawdown = −0.029126`；
`exposure_bars = 2`（02-07、02-08），`exposure_ratio = 2/7 = 0.285714`；交易 1 net = 100/103−1 = −0.029126。

## 手算过程（`no_trades` / `flat`）

`no_trades`：SMA2 依次 100.5、101.5、102.5、103.5；close 101/102/103/104 全程严格高于均线，信号从
03-05（index 1）起为 1，03-06（index 2）收盘以 102 买入后没有卖出信号。E2 = 1、E3 = 103/102 = 1.009804、
E4 = 104/102 = 1.019608 → `total_return = 0.019608`、`buy_and_hold = 0.04`、`max_drawdown = 0`、
`exposure_ratio = 3/5 = 0.6`。没有平仓交易 → `trade_count = 0`、`win_rate` 缺省 + 缺口，状态 `partial`；
未平仓交易 `bars = 5−2 = 3`，`price_return = 104/102−1 = 0.019608`。

`flat`：close 恒为 100，SMA2 恒为 100，「严格高于」永不成立 → 信号全程 0、从不买入；净值恒为 1，
`total_return = buy_and_hold = max_drawdown = 0`、`exposure_ratio = 0`、`trade_count = 0`、win_rate 缺省 + 缺口。

## 手算过程（`bad_rows`）

跳过 `2024/06/05`（非 ISO 日期）与 `2024-06-11`（缺 close）后，剩下 6 个有效观测：
100（06-03）、98（06-04）、99（06-06）、103（06-07）、101（06-12）、100（06-13）。SMA2 = 99、98.5、101、102、100.5；
信号：98<99→0、99>98.5→1、103>101→1、101<102→0、100<100.5→0。06-06 的信号在 06-07 收盘以 103 买入，
06-12 的信号（101<102）在 06-13 收盘以 100 卖出：`total_return = 100/103−1 = −0.029126`、
`exposure_ratio = 2/6 = 0.333333`、`max_drawdown = −0.029126`、`trade_count = 1`、`win_rate = 0`。
缺口原文点名两行：`2024/06/05、2024-06-11`。

## 手算过程（`insufficient`）

3 个有效观测；`sma_cross` fast 2 / slow 5 要先把慢线窗口填满（第 5 根才出信号）、下一根才成交（第 6 根），
再有一根才产生净值变动（第 7 根），所以 required = max(2, 5) + 2 = 7 > 3 → `blocked`，
`metrics = {}`，不写 `outputs/`。

## 错误 case

- `invalid_rule`：`rule` 不在 manifest enum 里，宿主在写 request / 启动 Python **之前**按 `input_schema`
  拒绝（`analysis_input_invalid`，消息含 `params.rule` 与两个合法取值），不会产生 module run 目录。
- `missing_columns`：没有价格列。不给 `price_dataset_id` 时自动识别失败，消息列出
  `close/adj_close/close_price/price/nav`；显式指名 Dataset 时消息是「找不到价格列」并给出可选列。
  两者都是模块内的 `analysis_input_invalid`，不产出 `outputs`。
