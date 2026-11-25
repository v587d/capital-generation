# comps_valuation fixtures

一份 peers 横截面（一行一家公司）+ 可选一份 subject 横截面（一行）；`fixtures/` 不进发布包，
只随仓库走测试。

```text
<case>/
  datasets/<dataset_id>.json   # peers / subject 表：ticker + market_cap + net_profit + 可选金额列
  params.json                  # peers_dataset_id / subject_dataset_id（多份同型表时必须指名）
  expected.json                # golden：status / metrics / data_gaps
```

`expected.json` 是**手算**的：每个倍数 = 分子 / 分母，中位数按排序后取中间值（偶数个取中间两个
平均），分母 ≤ 0 的行退出对应样本。改公式时先改这里，再看模块是不是算错。倍数保留 6 位小数。

| case | 覆盖 | 期望 |
|---|---|---|
| `normal` | 5 家 peers 全列 + 1 家 subject；所有倍数都有样本 | `completed`：P/E 中位数 20、P/B 2、P/S 1.25、EV/EBITDA 12；标的溢价 +10%/+10%/+60%/0% |
| `negative_earnings` | 4 家 peers，其中一家净利润为负 | `completed`：P/E 只用 3 家（中位数 20），负值不进中位数；其余倍数 4 家 |
| `missing_optional` | 只有 market_cap + net_profit 两列 | `partial`：只算 P/E（中位数 20），P/B、P/S、EV/EBITDA 各写一条缺口 |
| `single_peer` | 只有 1 家 peer | `completed`：中位数等于该家数值，limitations 写明样本不足 |
| `duplicate_ticker` | 同一 ticker 两行 | 运行前 `analysis_input_invalid`（一行只能是一家公司） |
| `not_comps` | 只有价格 Dataset | 运行前 `analysis_input_invalid`（不是 peers 表） |
| `subject_multi_row` | subject 表有两行 | 运行前 `analysis_input_invalid`（横截面一次只比一只标的） |
| `ambiguous` | peers 与 subject 都以显式 id 缺失的形态出现 | 运行前 `analysis_input_invalid`（不猜哪份是 peers） |

`normal` 的 P/E：五家都是 20 倍，中位数 20；标的 2200/100 = 22 倍，较中位数溢价 10%。
P/S 的五个样本为 1.25、2、1、1.25、1.333333，中位数 1.25；标的 2200/1100 = 2，溢价 60%。
