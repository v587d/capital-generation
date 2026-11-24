---
name: capital-analysis-validation
description: Use before submitting a Capital AnalysisArtifact — the pre-submit self-check, number-anchor and precision rules, reference checks, the three validation tiers, the size budget, and the concrete fix for each rejection code.
---

# 提交前自检（完整版）

`submit_analysis` 是唯一出口，宿主会**确定性**校验：结论里的数字有没有锚点、引用是否存在、
失效条件有没有、体积有没有超。这一册是提交前的最后一道自检；综合写法在 `capital-analysis-synthesis`。

## 1. 十项自检（逐条过，别跳）

1. `snapshot_id` 与 `analysis_id` 相同，且是本次快照。
2. `status` 与实际缺口一致：有缺口不写 completed。
3. `evidence_level=insufficient` 时 `status` 不是 completed。
4. `invalidation_conditions` 至少一条，且文本里出现某个 `claim_id` 或 `calculation_id`。
5. `assumptions`/方法说明已在 `scenarios[].assumptions`、`limitations`、`methods_used` 里落地。
6. 每个数字在 `headline` / `thesis` / claims / 失效条件里都能被锚点或计算命中。
7. `evidence_refs` 都在快照的 evidence 里；锚点 `source.ref` 都在快照或本次 `calculations` 里。
8. `methods_used` 的模块 id 与版本与 `run_analysis` 返回的一致。
9. `limitations` 非空；`alternative_explanations` 尽量非空。
10. 序列化后 ≤20000 字符（单条 statement ≤600、claims 每侧 ≤20、scenarios ≤8）。

## 2. 数字锚点怎么算命中

被扫的字段：`headline`、`thesis`、每条 claim 的 `statement`、每条 `invalidation_conditions`。
对每个数字 token，命中任一即通过：

1. 与某个 `number_anchors[].value` 在声明的 `precision` 内相等；
2. 等于某个 `calculations[].value`；
3. 等于某个锚点的 `value × 100`（比率与百分比互写，容差同 precision）；
4. 属于豁免集：年份（19xx/20xx）、"第 N 期/条"里的整数、单位换算常数（1e4/1e6/1e8/1e12）、
   标识符里的数字（`claim_1`、`FY2025`）。

**precision 的算法**：容差 = 0.5 × 10^-precision，默认 4（即 ±0.00005）。

- 你写 `0.1823` → 锚点 `0.1823`、`precision: 4` 命中；写 `18.23%` 时按 `value × 100` 命中。
- 你把数字四舍五入成两位小数（`18.23%`、`1.41 倍`），就把 `precision` 声明成 2；不声明就按 4 算，
  会被判成"没有来源"。
- 比率类数字**优先写 4-6 位小数或原样引用 metrics**，最省事：`0.044444` 直接配 `0.044444`。

## 3. 引用核对

| 引用 | 必须存在于 |
|---|---|
| `claim.evidence_refs[]` | 快照的 `evidence[].source_id` |
| `claim.number_anchors[].source.ref` | 快照的 dataset_id / profile_id / evidence source_id，或本次 `calculations[].calculation_id` |
| `methods_used[].module_id` + `module_version` | 已登记的模块与版本 |
| `analysis_id` / `snapshot_id` | 本次快照 |

引用不存在的表现是 `analysis_validation_failed`，错误里会点名是哪一条的哪个 id。**不要**改成
不引用就重发——那只会把硬拒变成语义缺失。

## 4. 三级校验

| 级别 | 触发 | 后果 |
|---|---|---|
| **Tier 1 硬拒** | 结论字段数字无锚点；refs 不存在；缺失效条件；schema 不符（未知字段、claims 每侧 >20、scenarios >8）；体积超限；非无损 JSON | 不落盘，返回具名 issue |
| **Tier 2 警告** | `metrics`/`calculations` 数字无锚点；`confidence` 缺 basis；`limitations` 为空；情景缺假设；失效条件不引用任何 claim/计算；peer 有未回执项 | 落盘但 `validation.status=warning`，`status` 最多 `partial` |
| **Tier 3 提示** | 没有替代解释；长度/风格建议 | 只计入 issues，不改状态 |

## 5. 体积预算

整体 ≤20000 字符；`headline` ≤300、`thesis` ≤1200、单条 `statement` ≤600、每侧 claims ≤20、`scenarios` ≤8。
超限错误会点名**哪一段最大**（headline / thesis / support_claims / calculations / …），按它压缩，
不要盲目删结论。压缩优先级：删重复论据 > 合并同类 claim > 缩短 statement > 砍 thesis。

## 6. 常见拒绝与修法

| 错误里看到 | 实际原因 | 怎么修 |
|---|---|---|
| `number_without_anchor`（headline） | 摘要里写了没锚点的数字 | 给该数字加锚点，或把摘要里的数字去掉 |
| `number_without_anchor`（claims[i]） | claim 的 statement 有未锚定数字 | 同上；重算的指标补 `calculations` 条目 |
| `evidence_ref_missing` | 引用了快照里没有的证据 | 删掉引用，或让 lead 补证据后重建快照 |
| `anchor_ref_missing` | 锚点指向不存在的 dataset/profile/计算 | 改成真实 id，或把该数字写成定性表述 |
| `invalidation_missing` | 没写失效条件 | 补一条可观察、引用 claim_id 的条件 |
| `analysis_result_too_large` | 超过字段或整体上限 | 按错误点名的段落压缩 |
| `analysis_validation_failed`（schema） | 多字段、缺字段、枚举值不对 | 严格按产物字段表，不加自造字段 |
| `confidence_basis_missing`（警告） | 有 confidence 没依据 | 每条 claim 补一句依据 |

## 7. 提交之后

- `status=accepted` + `validation.status=pass` → 产物已落盘，可以发回执。
- `validation.status=warning` → 已落盘但被降级为 `partial`：把 warning 里的要点写进给 lead 的回执，
  不要当没发生。
- 被拒（`analysis_validation_failed` / `analysis_result_too_large`）→ 按 issue 改，**不重发同一份产物**；
  连续两次被同一条拒，就把它当作结论质量不足，降级或 blocked。

## 8. 这条校验管不到什么

- 它只校验"能提取到的数字"有没有锚点，**不证明全文没有编造**：文字里的定性表述不在范围内。
- 它不校验推理是否成立，也不校验锚点数值本身是否算对——那是模块与你的责任。
- 因此：锚点齐 ≠ 结论对。写结论时仍然要按 `capital-analysis-synthesis` 的反证与冲突要求自查。
