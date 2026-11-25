# valuation_sensitivity fixtures

参数型模块（不读 Dataset），每组 case 只有 `params.json` + `expected.json`；`fixtures/` 不进发布包。

```text
<case>/
  params.json     # projections / wacc 或 CAPM 六参数 / terminal_growth / net_debt / shares_outstanding / grids
  expected.json   # golden：status / metrics / data_gaps / sensitivity / grid_cells
```

失败 case（`invalid_growth` / `invalid_capm`）只有 `params.json`：运行前就被拒，没有 golden 结果。

`expected.json` 是**手算**的，不是从模块输出里录的：金额与每股按下文公式算出后保留 6 位小数
（整数写整数形态），格点同理。改公式时先改这里，再看模块是不是算错。`grid_cells` 以
`"wacc,terminal_growth"` 为键记下**全部**格点的每股模型值（`grid_null` 里无定义的那格是 `null`），
至少覆盖中心格与一个角格，便于逐格复算。

## 公式与口径

- 预测期 FCF 为 `projections[0..n-1]`，第 t 期（t = 1..n）现金流为 `FCF_t`。
- `mid_year=false`：`PV_t = FCF_t/(1+wacc)^t`；`mid_year=true`：`PV_t = FCF_t/(1+wacc)^(t−0.5)`。
- 终值：`TV_n = FCF_n × (1+g)/(wacc−g)`；`PV_TV = TV_n/(1+wacc)^n`，`mid_year=true` 时指数同样按
  **n−0.5**（终值与最后一期同口径，不额外提前一期），写进 `methodology_log` 与
  `outputs/dcf_sensitivity.json` 的 `discounting`。
- `EV = ΣPV_t + PV_TV`；`股权价值 = EV − net_debt − minority_interest`；`每股模型值 = 股权价值/shares_outstanding`。
- `terminal_value`（metrics）是**折现后**的 TV 现值，`terminal_value_nominal` 才是 TV_n；
  `terminal_value_share = PV_TV/EV`，所以是 0–1 的比率。
- 缺省口径：`minority_interest` 省略按 0 扣除并在 `methodology_log` 披露；`wacc_grid` /
  `terminal_growth_grid` 省略时取 `wacc ±1pp` / `g ±1pp` 的标准点（g 的点必须 < wacc，不满足的点不生成），
  结果里 `parameters.*_grid_source = "default"`。标准点是假设区间，不是置信区间。
- 显式网格逐值校验：wacc 列必须 > 0、growth 行必须 ≥ 0，按升序排列且不允许重复；格点上
  `wacc ≤ g` 时该格写 `null` 并进 `data_gaps`（不写 0 冒充），`status` 变 `partial`。
- `sensitivity.wacc_1pp_value_per_share` / `growth_1pp_value_per_share` 是**中心格与 +1pp 相邻格的差分**
  （相邻格的每股模型值另存于 `wacc_plus_1pp_cell_value_per_share` / `growth_plus_1pp_cell_value_per_share`）。
  `null_cells` 是整张表的 null 格数。
- `net_debt` / `shares_outstanding` 是股权桥的可选输入：缺 `net_debt` 时只算到 EV，缺
  `shares_outstanding` 时只算到股权价值；对应指标、桥字段与整张网格写 `null`，进 `data_gaps` 并置
  `partial`（不按 0 处理，也不猜股本）。
- 全部数字用浮点按上述公式计算，展示时保留 6 位小数；`wacc` / `terminal_growth` 是小数（0.02 = 2%），
  摘要里按 ×100 保留 2 位百分比。

## 手算样例（`normal`）

`projections = 100/110/121`，`wacc = 0.10`，`g = 0.02`，`net_debt = 200`，`shares = 100`，年末折现。

中心格（wacc 0.10、g 0.02）：

```text
PV1 = 100/1.10      =  90.909091
PV2 = 110/1.10^2    =  90.909091
PV3 = 121/1.10^3    =  90.909091      ΣPV = 272.727273
TV3 = 121×1.02/(0.10−0.02) = 123.42/0.08 = 1542.75
PV_TV = 1542.75/1.10^3 = 1159.090909
EV = 272.727273 + 1159.090909 = 1431.818182
股权 = 1431.818182 − 200 = 1231.818182；每股 = 1231.818182/100 = 12.318182
```

角格（wacc 0.09、g 0.03）：

```text
PV1 = 100/1.09   = 91.743119
PV2 = 110/1.09^2 = 92.584799
PV3 = 121/1.09^3 = 93.434201      ΣPV = 277.762120
TV3 = 121×1.03/(0.09−0.03) = 124.63/0.06 = 2077.166667
PV_TV = 2077.166667/1.09^3 = 1603.953785
EV = 1881.715905；股权 = 1681.715905；每股 = 16.817159
```

+1pp 差分：wacc 0.11 时每股 10.705498，差分 = 10.705498 − 12.318182 = −1.612684；g 0.03 时
每股 14.103896，差分 = +1.785714。其余 7 格同法逐格算在 `expected.json` 的 `grid_cells` 里。

## CAPM 推导（`capm`）

`Ke = 0.03 + 1.2×0.05 = 0.09`；`WACC = (1−0.3)×0.09 + 0.3×0.05×(1−0.25) = 0.063 + 0.01125 = 0.07425`。
再用该 WACC 按同一 DCF 公式算（`projections = 100/110/121`、g = 0.02、net_debt 200、shares 100）：

```text
PV1 = 100/1.07425  = 93.088201
PV2 = 110/1.07425^2 = 95.319545
PV3 = 121/1.07425^3 = 97.604375      ΣPV = 286.012121
TV3 = 121×1.02/(0.07425−0.02) = 2275.023041；PV_TV = 1835.142159
EV = 2121.154280；股权 = 1921.154280；每股 = 19.211543
```

省略 grids 时默认轴：wacc `[0.06425, 0.07425, 0.08425]`、g `[0.01, 0.02, 0.03]`（都 < wacc）。

## 其余 case

`mid_year` 与 `normal` 同参数，只把指数换成 `t−0.5`（终值 `n−0.5`）：每期 PV 均为
`100/1.1^0.5 = 95.346259`（110、121 同样），`ΣPV = 286.038777`，`PV_TV =
1542.75/1.1^2.5 = 1215.664801`，EV `1501.703578`，每股 `13.017036`。与年末折现的 `12.318182` 不同，
证明指数确实改变结果。

`net_cash`：`net_debt = −150`（净现金）、`minority_interest = 25`，所以股权 = EV + 150 − 25 = EV + 125：
EV `1502.759508` → 股权 `1627.759508` → 每股 `16.277595`（若把符号搞反会得到 `1177.759508`）。

## 表格

| case | 覆盖 | 期望 |
|---|---|---|
| `normal` | 3 期 FCF、wacc 10%、g 2%、净负债 200、股本 100；显式 3×3 网格 | `completed`，EV 1431.818182、每股 12.318182，9 格全有值 |
| `capm` | 不给 wacc；rf 3% / beta 1.2 / ERP 5% / Kd 5% / tax 25% / debt_weight 30% → WACC 7.425%；省略 grids | `completed`，默认 3×3 网格，EV 2121.154280、每股 19.211543 |
| `mid_year` | 同 `normal`，`mid_year=true`，每期指数 t−0.5、终值 n−0.5 | `completed`，EV 1501.703578、每股 13.017036（≠ 年末口径） |
| `net_cash` | `net_debt=-150` 净现金 + `minority_interest=25`；省略 grids | `completed`，股权 = EV+125，每股 16.277595 |
| `grid_null` | 显式网格含 wacc 0.03 ≤ g 0.03 的格点 | `partial`，该格 null 并点名缺口；其余 8 格有值，中心格与 +1pp 差分仍可算 |
| `invalid_growth` | `wacc = terminal_growth = 0.08` | 运行前 `analysis_input_invalid`：Gordon 终值分母 ≤ 0 |
| `invalid_capm` | 不给 wacc，CAPM 缺 `cost_of_debt` / `tax_rate` / `debt_weight` | 运行前 `analysis_input_invalid`，点名缺的三个参数 |

`outputs/dcf_sensitivity.json` 记录 `parameters`、CAPM 分量（用了才有）、`discounting` 指数口径、
逐年 `projections[].fcf/present_value`、`terminal_value`、EV→股权 `bridge`、完整 `sensitivity.cells`
（每格 `wacc` / `terminal_growth` / `value_per_share`，null 写 null）与 `assumptions`。
