# earnings_bridge fixtures

一份利润表序列 Dataset（不是宽表），本期与上一期由 `period_end_ms` / `period` 选出；`fixtures/` 不进
发布包，只随仓库走测试。

```text
<case>/
  datasets/<dataset_id>.json   # 利润表序列：operating_income + net_profit（+ profit_total / income_tax_expense）
  params.json                  # 传给 run_analysis 的 params（可为空对象）
  expected.json                # golden：status / metrics / data_gaps
```

`expected.json` 是**手算**的，不是从模块输出里录的。两个恒等式：

```text
收入/净利率： ΔNP = ΔRevenue × margin_prev + Revenue_prev × Δmargin + ΔRevenue × Δmargin
税前/税率：   ΔNP = ΔProfit_total × (1 − tax_prev) − Profit_total_prev × Δtax − ΔProfit_total × Δtax
```

三项之和必须回到净利润差额（残差写进 metrics）。金额为原币整数元，比率保留 6 位小数。

| case | 覆盖 | 期望 |
|---|---|---|
| `normal` | 两期：营收 1000→1200 亿、净利率 10%→15%（净利润 100→180 亿）；利润总额 125→200 亿、税率 20%→10% | `completed`：收入效应 +20 亿、净利率效应 +50 亿、交互 +10 亿；税前效应 +60 亿、税率效应 +12.5 亿、交互 +7.5 亿 |
| `negative_pretax` | 上期利润总额为负 | `partial`：收入/净利率分解照常，税前/税率分解写缺口 |
| `single_period` | 只有一期 | `blocked`：没有上一期可比 |
| `zero_revenue` | 上期营业收入为 0 | `partial`：收入/净利率分解写缺口（净利率无经济含义），税前/税率分解照常 |
| `duplicate_period` | 同一报告期两行 | 运行前 `analysis_input_invalid` |
| `unrelated` | 只有价格 Dataset | 运行前 `analysis_input_invalid`（不是利润表） |

`normal` 的复算：ΔRevenue=200 亿，margin_prev=0.10 → 收入效应 20 亿；Δmargin=0.05，
Revenue_prev=1000 亿 → 净利率效应 50 亿；交互 200×0.05=10 亿；合计 80 亿 = 180−100。
税前：ΔProfit_total=75 亿 ×(1−0.20)=60 亿；−200 亿×(−0.10)=+12.5 亿；ΔProfit_total×(−Δtax)=+7.5 亿；
合计 80 亿。改公式时先改这里，再看模块是不是算错。
