# portfolio_stress fixtures

组合历史情景回放：每个持仓一份价格序列 Dataset + 调用方给的静态权重，按已发生的窗口逐持仓算区间收益，
再加权成组合收益与贡献、只用权重算集中度。每组 case 一份目录，`fixtures/` 不进发布包（`npm pack` 不含它），
只随仓库走测试。

```text
<case>/
  datasets/<dataset_id>.json   # 一份 Dataset：rows（+ 可选 time_coverage / envelope）
  params.json                  # positions / windows（+ 可选 price_column / time_column / timezone）
  expected.json                # golden：status / metrics / data_gaps（输入错误型 case 无此文件）
```

`expected.json` 是**手算**的，不是从模块输出里录的：每个数字都能由 `datasets/` 的收盘价与
`params.json` 的权重/窗口按 `module.json` 的口径复算（区间收益 = 窗口内最后一个可用收盘 ÷
第一个可用收盘 − 1；组合收益 = Σ 权重 × 持仓收益；贡献 = 权重 × 持仓收益；HHI = Σ w²）。
数字口径：比率指标保留 6 位小数，摘要里的百分比保留 2 位小数；`window_<n>_return` 的序号是
**输入顺序**（第 1 个窗口 → `window_1_return`），算不出的窗口**不写**该 metric 并写 `data_gaps`。

窗口口径：窗口内至少 2 个可用价格，同一根 bar 不能既当起点又当终点；窗口起点早于该持仓序列覆盖、
或终点晚于覆盖，该持仓在该窗口写缺口——**不向前/后借日期**。同一窗口里任一持仓算不出，
该窗口 `portfolio_return` 为 `null` 并写缺口，**不按剩余权重重归一化**。

| case | 覆盖 | 期望 |
|---|---|---|
| `normal` | 3 个持仓（0.5 / 0.3 / 0.2）+ 2 个窗口，全部落在覆盖内 | `completed`，两个窗口的 Σ贡献 = 组合收益 |
| `ms_timezone` | 两个持仓都是 `trade_date_ms` epoch 毫秒 + `time_coverage`，`timezone=Asia/Shanghai` | `completed`，窗口 2024-01-02..05（当地日期；按 UTC 会少一天） |
| `weights_not_one` | 权重 0.6 + 0.3 = 0.9 | 运行前（任何价格计算之前）`analysis_input_invalid` |
| `missing_window` | ds_bond 从 2024-02-05 才有数据；第 1 个窗口 2024-02-01 起 | `partial`：第 1 个窗口 null + 缺口，第 2 个窗口照常 |
| `too_short_window` | 第 1 个窗口（03-04..03-05）每个持仓只框进 1 个可用价格 | `partial`：该窗口 null，缺口点名窗口与数据集 |
| `bad_rows` | ds_equity 一行缺 close、一行 close=0、一行缺日期 | `partial`：跳过 3 行并点名，窗口用剩余有效价格照常算 |
| `duplicate_position` | `positions` 里同一 dataset_id 出现两次 | 运行前 `analysis_input_invalid`，点名数据集 |
| `unrelated` | 行只有 `date` + `revenue`，没有价格列 | 运行前 `analysis_input_invalid`，点名数据集 |
| `blocked` | 两个窗口分别整体早于 / 晚于序列覆盖 | `blocked`：不写 `outputs/`，只留计数、集中度与缺口 |

手算明细：

- `normal` 第 1 个窗口（2024-01-02..05）：equity 105/100−1 = 5.00%、bond 101.5/100−1 = 1.50%、
  gold 203/200−1 = 1.50%；组合 = 0.5×5.00% + 0.3×1.50% + 0.2×1.50% = 3.25%，
  贡献 0.025 / 0.0045 / 0.003（合计 0.0325）；第 2 个窗口（01-08..10）：equity 121/110−1 = 10.00%、
  bond 102/100−1 = 2.00%、gold 190/200−1 = −5.00%；组合 = 5.00% + 0.60% − 1.00% = 4.60%，
  贡献 0.05 / 0.006 / −0.01（合计 0.046）；HHI = 0.5² + 0.3² + 0.2² = 0.38，最大权重 0.50。
- `missing_window` 第 2 个窗口：equity 110/102−1 = 7.843137%、bond 104/100−1 = 4.00%；
  组合 = 0.7×7.843137% + 0.3×4.00% = 6.690196% → 0.066902（6 位小数）。
- `too_short_window` 第 2 个窗口：equity 108/100−1 = 8.00%、bond 52/50−1 = 4.00%；
  组合 = 0.6×8.00% + 0.4×4.00% = 6.40% → 0.064。
- `bad_rows`：ds_equity 剩 100 / 102 / 104，104/100−1 = 4.00%；bond 52/50−1 = 4.00%；组合 = 4.00%。
- `ms_timezone`：equity 106/100−1 = 6.00%、bond 52/50−1 = 4.00%，组合 = 5.00%；epoch 毫秒按
  `timezone=Asia/Shanghai` 标日后才覆盖 2024-01-02..05（按 UTC 会标成 2024-01-01..04，端点不同）。
- `blocked`：metrics 只有 `positions_count` / `windows_count` / `hhi` / `max_weight`（0.5 / 0.5 / 0.5 / 0.5），
  没有 `window_*_return` / `worst_*` / `best_*`。

`outputs/portfolio_stress.json` 是审计文件：`parameters`、`method`（每条公式的口径）、每个持仓的
`coverage`（首末日期与价格）、逐窗口逐持仓的 `first_date` / `first_price` / `last_date` / `last_price` /
`return` / `contribution`、窗口 `portfolio_return` 与 `contribution_sum`、`metrics` / `concentration`、
`data_gaps`。
摘要里的数字可直接被锚点命中：百分比 2 位小数（`3.25%` 对应 0.0325），权重最大写成 `50.00%` 时
锚点是 0.50；摘要必须带「历史窗口回放（不是假设情景、不预测未来）」的限定语。
