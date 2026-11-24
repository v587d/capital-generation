---
name: capital-analysis-synthesis
description: Use when writing the conclusion layer of a Capital analysis — turning module metrics and evidence into claims (fact / observation / inference / hypothesis), counter-claims, alternative explanations, contradictions, scenarios and invalidation conditions, and assembling the AnalysisArtifact fields around them.
---

# 结论综合（完整版）

跑完模块、准备写产物时看这一册。它管**结论怎么组织**；数字锚点与提交校验在
`capital-analysis-validation`。

## 1. 产物长什么样

`submit_analysis` 的参数就是最终产物，字段是固定的（多一个字段会被 schema 拒）：

| 字段 | 内容 | 硬要求 |
|---|---|---|
| `analysis_id` / `task_id` / `snapshot_id` | 快照返回的 id | `snapshot_id` 必须等于 `analysis_id` |
| `status` | `completed` / `partial` / `blocked` | 有缺口写 partial/blocked |
| `evidence_level` | `sufficient` / `limited` / `insufficient` | insufficient 时 status 不能 completed |
| `headline` | 一句话结论（≤300 字符） | 数字要能追到锚点 |
| `thesis` | 主判断与依据（≤1200 字符） | 同上 |
| `support_claims` / `counter_claims` | 正反论据数组 | 每条 ≤600 字符 |
| `alternative_explanations` | 还能怎么解释同一组数据 | 空数组会记提示 |
| `contradictions` | 来源/口径之间的冲突 | 有冲突必须写 |
| `calculations` | 引用模块指标的计算记录 | id/模块/版本/指标/值/单位 |
| `scenarios` | 情景（≤8） | 每个必须有 `assumptions` |
| `invalidation_conditions` | 能推翻主判断的条件 | 至少一条，且引用 claim_id 或 calculation_id |
| `unresolved_gaps` | 还没解决的数据缺口 | 与 `data_gaps` 呼应 |
| `limitations` | 口径、样本、方法限制 | 不能为空 |
| `methods_used` | 用了哪个模块什么版本 | 必须与 registry 一致 |
| `peer_exchanges` | 与同行的补计算往返 | 有未回执项不能 completed |

**没有独立的 `assumptions` 字段**：模块假设在 `run_analysis` 返回的 `assumptions` 里，产物侧用
`scenarios[].assumptions`、`limitations`、`unresolved_gaps` 承接，不要自造字段。

## 2. claims 怎么写

四类 `type`，按证据强度从高到低：

- `fact`：可直接核对的事实（"2024 年报披露营业收入 1000 亿元，来源 ev_annual_2024"）。
- `observation`：从数据里算出来的观察（"毛利率 18.00%，较上期提升 1.33 个百分点"）。
- `inference`：有依据的推断（"毛利率提升主要来自产品结构，而非成本下降"）。
- `hypothesis`：待验证的假设（"若原材料价格维持，毛利率有望保持"）。

每条 claim 必填：

```json
{ "claim_id": "claim_margin_trend", "type": "observation",
  "statement": "毛利率 18.00%，较上期提升 1.33 个百分点",
  "evidence_refs": ["ev_annual_2024"],
  "number_anchors": [{ "value": 0.18, "unit": "ratio", "period": "2024-4",
                       "source": { "kind": "dataset", "ref": "ds_income" }, "precision": 6 }],
  "confidence": "medium", "confidence_basis": "由利润表直接计算，与现金流量表交叉无矛盾",
  "falsifier": "若下期毛利率回落至本期以下，该观察不再成立" }
```

- `confidence` 必须带 `confidence_basis`（一句话说明依据），否则记警告。
- `falsifier` 不是必填，但写出来会显著提高可审阅性。
- `claim_id` 起可读的名字（`claim_<主题>`），后面失效条件与回执都要引用它。
- 一条 claim 只讲一件事；把两个判断塞进一条 `statement`，审阅时无法分别推翻。

## 3. 正反两方都要写

- `support_claims` 支持主判断，`counter_claims` 明确反对或削弱主判断的证据。
- 只有正方的产物是**宣传**不是研究：至少写一条真实存在的反证，哪怕结论仍是同一方向。
- 反证不能写成"但是总体向好"这种垫话；要写清它在什么条件下会占上风。
- 没有反证可写时，在 `limitations` 里说明检索范围（"在已检索范围内未发现相反披露"），不要假装穷尽。

## 4. 替代解释与冲突

- `alternative_explanations`：同一组数据还能怎么解释（收入确认时点、并表范围、汇率、会计政策变更）。
  这是产物的"防自大"字段，空着会被记提示。
- `contradictions`：两个来源打架时**先写冲突再写结论**，写清哪个来源、差多少、可能的解释。
  冲突被摘要吞掉，是这类产物最常见的事故。

## 5. 情景与敏感性

- `scenarios` ≤8 条，每条必须有非空 `assumptions`（否则记警告）：写假设、触发器与结果方向，不写假精度。
- 情景不是预测：不输出概率、目标价或收益承诺，除非有可复现模型并披露样本与失效条件。
- 敏感性只对模块支持参数变化的指标做；模块没给的敏感性不要编。

## 6. 失效条件（最容易被拒的一条）

- `invalidation_conditions` 至少一条，且必须引用某个 `claim_id` 或 `calculation_id`——
  不引用就无法核对它推翻的是哪条判断（记警告）。
- 好的失效条件是可观察、可证伪的："若 2025 年中报毛利率低于本期且经营现金流/净利润低于 1，主判断失效。"
- 坏的失效条件："若出现重大不利变化"——不可观察，等于没写。

## 7. status 与 evidence_level

| 证据等级 | 允许的 status | 说明 |
|---|---|---|
| `sufficient` | completed / partial | 关键输入齐、无未解释冲突 |
| `limited` | completed / partial | 有缺口但已点名，结论已降级 |
| `insufficient` | partial / blocked | 不能写 completed |

- 有任何 Tier 2 警告，宿主会把产物降级为 `partial` 并标 `validation.status = "warning"`。
- `blocked` 是诚实结果：写清缺什么、谁补、补上后能得出什么结论。

## 8. headline 与 thesis

- `headline` 一句话给结论方向 + 最关键的 1-2 个数字；`thesis` 展开依据与条件。
- 两者都是**给主 Agent 复述**的：不写"见上文""如上"，每句自身可读。
- 数字写法与锚点一一对应：写 18.00% 就备好 0.18 的锚点（`capital-analysis-validation`）。
- 不出现评级、目标价、买入/卖出建议；判断用"财务质量/偿债能力/现金转换"这类可核查的口径词。

## 9. 回执里的 peer_exchanges

- 每条往返写 `{ "peer": "data-junior", "type": "analysis_calculation_request", "request_id": "...", "answered": true|false }`。
- 当前阶段全中继，通常为空数组；将来直连时按实际往返填，**有 `answered:false` 就不能写 completed**。
