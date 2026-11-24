# financial_quality fixtures

每组 case 一份目录，`fixtures/` 不进发布包（`npm pack` 不含它），只随仓库走测试。

```text
<case>/
  datasets/<dataset_id>.json   # 一份 Dataset：rows + envelope + time_coverage（与 store 的 raw 读取同形）
  params.json                  # 传给 run_analysis 的 params
  expected.json                # golden：status / period / previous_period / metrics / data_gaps
```

`expected.json` 是**手算**的，不是从模块输出里录的：`metrics` 由 `datasets/` 的报表数值按
`module.json` 的公式逐项算出来后写死。改模块公式时先改这里，再看模块是不是算错。

| case | 覆盖 | 期望 |
|---|---|---|
| `normal` | 三张报表 × 两期，含 `total_current_liabilities` / `inventory` | `completed`，20 项指标 + 5 项环比，零缺口 |
| `a_share_series` | 与 `normal` 同数，但资产负债表只保留本仓 A 股接口的字段（无流动负债、无存货） | `partial`，`current_ratio` / `quick_ratio` 缺席并点名缺列 |
| `a_share_annual` | **真实 fuyao 形状**：`period` 列是常量 `annual`、报告期在 `period_end_ms` / `fiscal_year`；三期年报 | `partial`，报告期标签是日期（`2023-12-30`），`period: "2023"` 可选中 |
| `boundary` | 单期、负净资产、零利息费用 | `partial`，ROE/DuPont/现金转换/产权比率/利息覆盖全部缺席，不填 0 |
| `missing_income` | 只有资产负债表与现金流量表 | `blocked`，零指标、不写 outputs |
| `document` | 文档型 Dataset（无行数组） | 建快照时 `analysis_input_invalid`，不进执行面 |

数字口径：金额为原币元，比率保留 6 位小数；`normal` 的报表内部勾稽成立（资产 = 负债 + 权益、
经营 + 投资 + 筹资现金流 = 现金净增加），便于人工复算。
