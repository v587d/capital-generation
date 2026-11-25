# scenario_sensitivity fixtures

参数型模块（不读 Dataset），每组 case 只有 `params.json` + `expected.json`；`fixtures/` 不进发布包。

```text
<case>/
  params.json     # target_name / factors / grid / scenarios / model / grid_mode
  expected.json   # golden：status / metrics / data_gaps
```

`expected.json` 是**手算**的：目标值 = 因子的显式恒等式取值（product：Π factor^exponent；
sum：Σ factor×exponent），再由 `outputs/scenarios.json` 的 `factors` 与逐行覆盖复算。不是概率、
不是预测，也不含任何插值。

| case | 覆盖 | 期望 |
|---|---|---|
| `normal_grid` | revenue 1000 × net_margin 0.2；full 网格 3×3；3 个具名情景（基准情景两个因子都继承） | `completed`，base 200，情景区间 162–242，9 格 |
| `oat_division` | ROE = net_profit 50 × equity^-1（equity 250）；oat 扫描 equity 200/250/300 | `completed`，base 0.2，区间 0.166667–0.25 |
| `sum_weighted` | profit = revenue 1000 - cost 600（sum 模型，权重 1 / -1）；扫描 cost | `completed`，base 400，区间 350–450 |
| `zero_base` | net_margin 基准 0，情景修复到 10% / 20% | `partial`，delta_pct 为 null 并写缺口（不写 0 冒充百分比） |
| `invalid_negative` | 负基准 + 小数指数 | 运行前 `analysis_input_invalid`（只允许整数指数） |
| `invalid_scenario` | 情景里出现未声明因子 | 运行前 `analysis_input_invalid`（不静默忽略） |

`outputs/scenarios.json` 记录 target 的 `expression`（如 `revenue × net_margin`）、每个情景的
`values` / `inherited` / `target` / `delta` / `delta_pct`，以及每一格对应的因子取值。
