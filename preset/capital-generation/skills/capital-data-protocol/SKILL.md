---
name: capital-data-protocol
description: Use when composing or reading a Capital data message — data_request, per-Dataset dataset_ready / data_failed / data_collection_completed, the two-step capability discovery, retry discipline and disclosure fields. Volume 1 of the Capital data protocol; reading a Dataset back lives in capital-data-profile, QuerySpec and derived arithmetic in capital-data-query.
---

# Capital 数据协议 · 第一册：委派与逐份回传

主 Agent 与 `data_collector` / `data_junior` 之间的消息载荷契约。三个角色的 persona 只保留
每轮都要生效的硬规则；字段级细节、示例与重试表在本文件。载荷即接口，字段名、数值、日期
一律不改写。

本协议共三册，§编号跨册连续：**本册**管委派与逐份回传（§0 / §1 / §1.1 / §2 / §5），
读回 Dataset 在 `capital-data-profile`（§3.0 / §3 / §3.1 / §3.2），受控查询与派生算术在
`capital-data-query`（§3.3 / §4）。写了 `profile_request` 或 `query_request` 却没读对应那一册，
等于凭记忆填载荷字段。

## 0. 谁读哪一节（三个角色动手前先加载对应那一册）

| 角色 | 需要 | 说明 |
|---|---|---|
| 主 Agent | §1、§3、§4、§5 | 发请求、收回传、输出披露字段（§3 / §3.1 / §3.2 在 `capital-data-profile`，§3.3 / §4 在 `capital-data-query`） |
| `data_collector` | §1、§1.1、§2、§5 | 收请求、能力发现两步、回传载荷、重试纪律（本册即够） |
| `data_junior` | §3、§3.1、§4、§5 | 质检回传、数据缺口、受控查询、重试纪律（§3 系在 `capital-data-profile`，§3.3 / §4 在 `capital-data-query`，§5 在本册） |

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
| `params` | 按该 capability 的 `input_schema` 填写；标的使用完整代码（如 `600519.SH`），不自行拼接交易所后缀。腾讯 fallback 使用 `tencent_quote` / `tencent_kline`，不要改写成已有 `quote` / `history` |
| `force_refresh` | `false`/省略：宿主可复用当前 session 内未过期且满足该能力缓存新鲜度的 Dataset；`true`：强制重新取数并生成新的不可变 Dataset，**绝不覆盖旧文件**。用户要求“现在/最新”的快照时传 `true`；保留 7 天不代表行情仍是最新 |

硬规则：

- 委派消息只带需求与参数，**不带任何内部数据源键名**，也不携带原始数据行。
- 能力名一律以 `list_capabilities` 返回的目录为准，不要编造。
- 本角色只收结构化行集：公告 / 研报 / 新闻**正文**不是数据集的内容，回告主 Agent 改走 `web_retriever`；
  行上的标题、简称这类标注字段算数据，整篇正文不算。
- 一次 `request_data` 只请求一个能力，按已发现的依赖与证据价值串行推进；**没有单回合能力数量上限**。先确定问题所需事实与缺口，再按来源、资产类型、时间粒度挑相关能力；不为凑数量遍历目录。遇到 `data_gap` 可继续补数，数据充分或上游不可用时停止。
- 含义相近的能力不自动互换：例如 Fuyao `history` 仅日线，腾讯 `tencent_kline` 支持近期分钟线；按 `describe_capability` 核对粒度、字段与单位，来源切换须写进回传。
- `task_id` 由主 Agent 在本轮首次委派前确定；同一用户任务的 data_collector、data_junior 与 visualization 必须原样复用。data_collector 不得自行生成或改写 task_id，缺失时应拒绝请求并回告主 Agent。

## 1.1 能力发现（data_collector 侧：两步，且各只做一次）

| 步 | 工具 | 得到什么 | 调用纪律 |
|----|------|----------|----------|
| ① | `list_capabilities()` | 纯文本能力目录：**一行一条** `capability\|summary\|paginated`（1=分页、0=不分页） | **一个任务只调一次**；目录已在本 session 历史里，重复调用只会白占上下文 |
| ② | `describe_capability({ capability })` | 该能力的完整 `description` / `input_schema` / `output_fields`（逐行字段字典） | 一次只传**一个**名字、**不传逗号**；同一个能力描述一次即可；要几个能力就在**同一条消息里一次发出多个调用**（纯读、可并发），不要一份一份等 |

- 读目录时**按行切**：一行就是一条能力，取第一个 `|` 前面的部分当 `capability` 原样复制；摘要里出现的
  `\|`、`\n` 是转义字符，不是分隔符。
- `output_fields` 每行是 `字段路径:类型[:说明]`：后缀 `?` 表示上游可能给 `null`，`[].` 表示该字段在数组
  元素上（`item[].thscode`），说明段写 `取值 a/b` 时该字段只允许这几个值。按它写 `query_dataset` 的
  `select` / `filters` 列名，大小写与下划线原样照抄。
- 目录刻意不含参数与输出结构：全量 schema 约 23KB，会被工具结果剪枝器（阈值 8192）截断中间
  部分，导致排在中间的能力在发现阶段不可见。目录只负责"选哪个"，详情负责"怎么填"。
- **一个任务只调一次 `list_capabilities`**；**同一个能力只描述一次**，重复调用只会白占上下文。
- `list_capabilities` 与 `describe_capability` 都是**纯读**：本轮要看几个能力，就在**同一条消息里一次发出
  这几个 `describe_capability` 调用**，它们在框架并发池里并行执行、在同一个下一步一起返回；一份一份等
  等于把一次往返付成 N 次。这不改变上一条"每个能力只描述一次"，也不改变"一次只传一个名字"。
- 不查 `input_schema` 就填 `params` 属于违规；`params` 的取值与约束一律以 `describe_capability` 为准。

`describe_capability` 的错误按 code 处置，不要盲目重试：

| code | 含义 | 正确动作 |
|------|------|----------|
| `capability_required` | 没给名字（缺失或空白） | 先调一次 `list_capabilities`，把目录里的名字原样传入 |
| `capability_invalid` | 不是字符串 / 超长 / 含逗号 | 改成单个字符串名字后重试一次；多个能力分多次调用 |
| `capability_unknown` | 名字不在目录里（错误信息会列出全部可用名字） | 从列出的名字里原文复制重来；不编造、不缩写、不改写 |
| `capability_catalog_empty` | 当前没有任何已注册能力（数据源注册没生效；**缺凭据不会让目录变空**，只会在取数那一刻点名凭据失败） | **不要重试**（此刻任何名字都会失败）；用 `dc_status` 核对 `registered_capabilities` 与 `api_key`，如实回告主 Agent |
| `request_params_invalid` | `request_data` 的 `params` 不符合该能力契约（错误会保留具体字段原因） | 先按错误中的 capability 调 `describe_capability({"capability":"..."})`，重新读取 `input_schema`，修正后只重试一次；不要凭记忆猜参数。网络、超时、落盘错误不要走这条路径 |

## 2. 逐份回传（data_collector → 主 Agent）

每次 `request_data` 返回后立即 `send_message`，成功时每条只含**一份** DatasetRef（缓存命中也一样）：

```json
{
  "type": "dataset_ready",
  "task_id": "task_01J...",
  "request_index": 1,
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

某次请求最终失败也立即回告（`request_index` 从本次委派的 1 开始，翻页或重复能力也各占一次）：

```json
{ "type": "data_failed", "task_id": "task_01J...", "request_index": 2, "capability": "history", "error": "request timed out" }
```

所有请求处理完后**另发一条**终结消息，即使全部失败也必须发：

```json
{
  "type": "data_collection_completed",
  "task_id": "task_01J...",
  "dataset_ids": ["ds_01J..."],
  "failed": [{ "request_index": 2, "capability": "history", "error": "request timed out" }],
  "gaps": ["尚未取得该标的的历史分钟线"]
}
```

硬规则：

- 回传必须携带结构化载荷；可以附表格或摘要，但**禁止只回传 markdown 汇总**。
- 每份成功 Dataset（含缓存命中）立刻通知主 Agent，下一次 `request_data` 不必等 data_junior 处理完；分页若每页都调用 `request_data`，每页分别通知。终结消息只汇总 id / 失败 / 缺口，不重复塞 DatasetRef，也不由 data_collector 直接找 data_junior。
- `data_failed` 只结束该次请求；只有 `data_collection_completed` 才结束本次委派。未发出终结消息前，主 Agent 不得把任意一次进度通知或子 Agent 结算当作取数完成。若 junior 在已结算后发 `data_gap`，主 Agent 再次委派同一个 collector，此次补数也须逐份回传并另发终结消息。
- 每个 `data_failed` 和终结消息里的失败项必须包含真实 `error`，只有工具返回了 `code` 才附带原值，不能把错误文本编造成 code。
- `dataset_id` / `artifact_ref` / `capability` / `source_label` / `schema` / `row_count` /
  `captured_at` / `retention_until` 按工具返回**原样填入**，字段名、数值、日期不改写。
- 载荷中不得出现原始数据行、内部数据源键名或文件绝对路径。
- 主 Agent 收到后把 DatasetRef 记入委派清单，后续引用一律原样转达 `artifact_ref`，
  不自行改写、不自行拼路径。
- Dataset 默认保留 **7 天**（以 `retention_until` 为准），到期后需重新取数。

## 5. 重试纪律


| 错误类型 | 例子 | 处理 |
|----------|------|------|
| 参数类 | 缺参、格式错、枚举越界 | 对照 `input_schema` 的 enum/description 修正后重试 |
| 瞬时类 | 限流、上游超时、网络 | 重试 1 次 |
| 执行超时 | 约 30 秒超时 | 重试 1 次 |
| 数据源/环境 | 无可用数据源、workspace 只读、落盘失败（`workspace_not_writable`） | 不回退、不假装成功，如实回传 `error`/`code` |
| 网页获取 | 网络或服务错误 | 最多重试 1 次，仍失败如实回传 |

底线：绝不幻觉填充数据，绝不用编造的来源补位，绝不声称数据已保存；
同一请求累计最多重试 2 次，仍失败就回传 `failed` 并注明已重试，不再继续。

## 5. 输出必须披露的字段

- `capability`、`source_label`、抓取时间 `captured_at`；
- 交易日 / 报告期、时区；
- 缺失字段与数据截止时间；
- 情景假设标注为条件假设，不是统计概率或收益承诺。

原始数据行永远不进入主 Agent 的上下文：主 Agent 只拿到 DatasetRef、profile_ref 与元数据。
与第三方网页比对仅用于异常抽样核对，不把任何单一来源表述成绝对真实。
