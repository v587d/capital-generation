---
name: capital-data-protocol
description: Use when composing or reading a Capital data message — the exact data_request, dataset_ready, data_failed, profile_request, dataset_profile_completed and profile_failed payloads, field-by-field rules, force_refresh semantics, capability selection, retry discipline, and the disclosure fields an answer must carry.
---

# Capital 数据协议（完整版）

主 Agent 与 `data_collector` / `data_junior` 之间的消息载荷契约。主 persona 只保留硬规则摘要；
字段级细节、示例与重试表在本文件。载荷即接口，字段名、数值、日期一律不改写。

## 1. 数据请求（主 Agent → data_collector）

```json
{
  "type": "data_request",
  "task_id": "task_01J...",
  "description": "贵州茅台近一年日线",
  "capability": "history",
  "params": { "thscode": "600519.SH", "interval": "1d" },
  "force_refresh": false
}
```

| 字段 | 规则 |
|------|------|
| `type` | 固定 `data_request` |
| `task_id` | 同一任务复用同一个值，便于回传对账 |
| `description` | 用自然语言写清要什么数据；也可含标的、区间、频率 |
| `capability` | 可选。明确知道能力名时才指定；省略时由 `data_collector` 走下面 §1.1 的两步发现 |
| `params` | 按该 capability 的 `input_schema` 填写；标的使用完整代码（如 `600519.SH`），不自行拼接交易所后缀 |
| `force_refresh` | `false`/省略：宿主可复用当前 session 内未过期的 Dataset；`true`：强制重新取数并生成新的不可变 Dataset |

硬规则：

- 委派消息只带需求与参数，**不带任何内部数据源键名**，也不携带原始数据行。
- 能力名一律以 `list_capabilities` 返回的目录为准，不要编造。
- 一次请求一个能力、串行推进；单回合通常 1 个、最多 3 个、硬性不超过 5 个能力。

## 1.1 能力发现（data_collector 侧：两步，且各只做一次）

| 步 | 工具 | 得到什么 | 调用纪律 |
|----|------|----------|----------|
| ① | `list_capabilities()` | 能力目录：`capability` + 一行 `summary` + `paginated` | **一个任务只调一次**；目录已在本 session 历史里，重复调用只会白占上下文 |
| ② | `describe_capability({ capability })` | 该能力的完整 `description` / `input_schema` / `output_schema` | 一次只传**一个**名字、**不传逗号**；同一个能力描述一次即可；要几个能力就分别调用几次 |

- 目录刻意不含参数与输出结构：18 个端点的完整 schema 约 23KB，会被工具结果剪枝器截断中间部分，
  导致排在中间的能力在发现阶段不可见。目录只负责"选哪个"，详情负责"怎么填"。
- 不查 `input_schema` 就填 `params` 属于违规；`params` 的取值与约束一律以 `describe_capability` 为准。

`describe_capability` 的错误按 code 处置，不要盲目重试：

| code | 含义 | 正确动作 |
|------|------|----------|
| `capability_required` | 没给名字（缺失或空白） | 先调一次 `list_capabilities`，把目录里的名字原样传入 |
| `capability_invalid` | 不是字符串 / 超长 / 含逗号 | 改成单个字符串名字后重试一次；多个能力分多次调用 |
| `capability_unknown` | 名字不在目录里（错误信息会列出全部可用名字） | 从列出的名字里原文复制重来；不编造、不缩写、不改写 |
| `capability_catalog_empty` | 当前没有任何已注册能力（数据源未注册，常见原因是凭据未配置） | **不要重试**（此刻任何名字都会失败）；用 `dc_status` 读注册错误并如实回告主 Agent |

## 2. 数据回传（data_collector → 主 Agent）

成功：

```json
{
  "type": "dataset_ready",
  "task_id": "task_01J...",
  "datasets": [
    {
      "dataset_id": "ds_01J...",
      "artifact_ref": "workspace://capital-data/datasets/ds_01J...",
      "format": "json_rows",
      "capability": "history",
      "source_label": "fuyao",
      "schema": { "columns": ["date_ms", "open_price", "high_price", "low_price", "close_price", "volume", "turnover"] },
      "row_count": 240,
      "captured_at": 1780000000000,
      "retention_until": 1780604800000
    }
  ]
}
```

失败：

```json
{ "type": "data_failed", "task_id": "task_01J...", "error": "...", "code": "..." }
```

硬规则：

- 回传必须携带结构化载荷；可以附表格或摘要，但**禁止只回传 markdown 汇总**。
- `dataset_id` / `artifact_ref` / `capability` / `source_label` / `schema` / `row_count` /
  `captured_at` / `retention_until` 按工具返回**原样填入**，字段名、数值、日期不改写。
- 载荷中不得出现原始数据行、内部数据源键名或文件绝对路径。
- 主 Agent 收到后把 DatasetRef 记入委派清单，后续引用一律原样转达 `artifact_ref`，
  不自行改写、不自行拼路径。

## 3. 质检请求与回传（主 Agent ↔ data_junior）

请求：

```json
{
  "type": "profile_request",
  "task_id": "task_01J...",
  "dataset_ids": ["ds_01J..."],
  "question": "检查数据质量并给出基础统计"
}
```

- `dataset_ids` 一律取 `dataset_ready` 回传中的 `dataset_id` 原样值。
- 只带 DatasetRef 标识与问题描述，**绝不带原始数据行**。

回传：

```json
{
  "type": "dataset_profile_completed",
  "task_id": "task_01J...",
  "dataset_id": "ds_01J...",
  "profile_ref": "workspace://capital-data/profiles/p_01J...",
  "row_count": 240,
  "columns": ["date", "open", "high", "low", "close", "volume"],
  "quality": { "missing_values": 0, "duplicate_rows": 0, "time_ordered": true },
  "warnings": []
}
```

失败：`{ "type": "profile_failed", "task_id": "task_01J...", "error": "...", "code": "..." }`

硬规则：字段按工具返回原样填入；统计项只报告可计算的部分，数据不足如实说明；
profile 失败不影响原始 Dataset，可按指示重试。

## 4. 重试纪律

| 错误类型 | 例子 | 处理 |
|----------|------|------|
| 参数类 | 缺参、格式错、枚举越界 | 对照 `input_schema` 的 enum/description 修正后重试 |
| 瞬时类 | 限流、上游超时、网络 | 重试 1 次 |
| 执行超时 | 约 30 秒超时 | 重试 1 次 |
| 数据源/环境 | 无可用数据源、workspace 只读、落盘失败（`workspace_not_writable`） | 不回退、不假装成功，如实回传 `error`/`code` |
| 网页获取 | 网络或服务错误 | 最多重试 1 次，仍失败如实回传 |

底线：绝不幻觉填充数据，绝不用编造的来源补位，绝不声称数据已保存；
同一请求重试 2 次仍失败就回传 `failed` 并注明已重试，不再继续。

## 5. 输出必须披露的字段

- `capability`、`source_label`、抓取时间 `captured_at`；
- 交易日 / 报告期、时区；
- 缺失字段与数据截止时间；
- 情景假设标注为条件假设，不是统计概率或收益承诺。

原始数据行永远不进入主 Agent 的上下文：主 Agent 只拿到 DatasetRef、profile_ref 与元数据。
与第三方网页比对仅用于异常抽样核对，不把任何单一来源表述成绝对真实。
