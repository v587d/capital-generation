# statement_integrity fixtures

三张报表各一份 Dataset（raw store 形状），按 `period_end_ms` 对齐同一报告期；`fixtures/` 不进发布包，
只随仓库走测试。

```text
<case>/
  datasets/<dataset_id>.json   # 一份 Dataset：rows（+ 可选 time_coverage）
  params.json                  # 传给 run_analysis 的 params（可为空对象）
  expected.json                # golden：status / metrics / data_gaps
```

`expected.json` 是**手算**的，不是从模块输出里录的：每条勾稽按 `module.json` 的恒等式与容差公式
（|差异| ≤ tolerance_abs + tolerance_ratio × max(|左边|, |右边|)，默认 0.1%）算出来后写死。改公式时
先改这里，再看模块是不是算错。数字口径：金额为原币整数元，`*_residual_ratio` 保留 6 位小数。

| case | 覆盖 | 期望 |
|---|---|---|
| `normal` | 两期资产负债表 + 2024 利润表/现金流量表；恒等式、现金流对账、留存收益滚动全部精确成立 | `completed`，3 项校验全过、零缺口 |
| `imbalance` | 同 `normal`，但 2024 资产 3000 亿 ≠ 负债 1200 亿 + 权益 1794 亿（差 6 亿 = 0.20%） | `completed`，资产负债恒等式未通过（容差 0.10%），另两项通过 |
| `real_a_share` | **真实 fuyao 形状**：`period` 列是常量 `annual`，资产负债表没有 retained_earnings / surplus_reserve / dividends 列 | `partial`，两项校验通过，留存收益滚动写缺口 |
| `fx_reconciliation` | 现金流三项合计 250 亿，另有汇率影响 15 亿，现金净增加额 265 亿 | `partial`，只有计入 `effect_of_exchange_rate_changes` 才对平；留存收益滚动写缺口 |
| `missing_balance` | 只有利润表与现金流量表 | `partial`，现金流对账通过，恒等式与留存收益滚动写缺口 |
| `duplicate_period` | 资产负债表同一报告期两行 | 运行前 `analysis_input_invalid`（不猜用哪一行） |
| `unrelated` | 只有一份价格 Dataset，没有任何报表 | 运行前 `analysis_input_invalid` |

`normal` 的留存收益滚动：80 + 24 − 5 − (21 − 20) = 98（十亿元），与 2024 期末留存收益一致；
`imbalance` 的 6 亿差异是 300 − 119.4 − 180 的结果，占基准 0.20%，超过默认 0.10% 容差。
容差可被 `params.tolerance_ratio` 覆盖（测试里用 0.01 验证同一份 `imbalance` 会判通过）。
