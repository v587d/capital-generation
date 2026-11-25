# returns_risk fixtures

每组 case 一份目录，`fixtures/` 不进发布包（`npm pack` 不含它），只随仓库走测试。

```text
<case>/
  datasets/<dataset_id>.json   # 一份 Dataset：rows（+ 可选 time_coverage / envelope）
  params.json                  # 传给 run_analysis 的 params
  expected.json                # golden：status / metrics / data_gaps
```

`expected.json` 是**手算**的，不是从模块输出里录的：指标由 `datasets/` 的价格按 `module.json`
的口径逐项算出来后写死（收益率、样本方差 ddof=1、252 年化、历史分位 VaR/CVaR）。改公式时先改
这里，再看模块是不是算错。数字口径：收益/波动/回撤/仓位比率保留 6 位小数，百分比在摘要里保留
2 位；`benchmark_overlap` 是重叠的**日收益数**，不是重叠价格点数。

| case | 覆盖 | 期望 |
|---|---|---|
| `normal` | 13 个收盘价 + 同日期基准（200→211）；`price_dataset_id` / `benchmark_dataset_id` 显式指名 | `completed`，12 个收益，beta 1.951821 / 相关 0.999876 |
| `no_benchmark` | 同一价格序列，不给基准 | `completed`，beta/相关缺席，limitations 披露"未提供基准" |
| `bad_rows` | 一行缺 close、一行 close=0、一行日期不是 ISO | `partial`，3 行跳过并点名，只用 4 个有效观测 |
| `ms_timezone` | `trade_date_ms` + `time_coverage` + `timezone=Asia/Shanghai` | `completed`，窗口 2024-01-02..2024-01-04（当地日期，不是 UTC 前一天） |
| `too_short` | 只有 2 个价格点 | `blocked`，不写 outputs |
| `duplicate` | 同一日期两行 | 运行前 `analysis_input_invalid`，点名重复日期 |

摘要里的数字必须能直接被锚点命中：百分比 2 位小数（`11.00%` 对应 0.11 的锚点 ×100），
倍数/比率 4 位小数（`26.0482`）。`risk_metrics.json` 里 `series[]` 是逐日收盘与收益，
每个指标都能从这组输入复算。
