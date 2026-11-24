# Capital Generation `senior_analyst` 开发设计文档

**状态：**设计稿 v2（已按 2026-11-24 评审拍板修订），未实施
**目标：**交付一个可用、可验证、可审计的 `senior_analyst`，首版不引入社区模块安装、公共 catalog 或任意第三方代码执行。
**适用 Agent：**后续负责 preset、角色通信、分析运行时、Python 模块、Skill 与测试的研发 Agent。

> **修订说明（v1 → v2）**：v1 存在 3 个阻断项（设计权属未声明、装配面缺件、授权判据与数据契约缺位）
> 与 7 个重大项（直连语义缺失、契约内部矛盾、数字溯源无算法、§15 缺件、阶段顺序、门禁失真、
> 文档预算）。v2 保留 v1 的方向与全部已核实事实，按 §0 的决策记录重写受影响章节。
> 评审证据以仓库 `7e1306e`（v2.30.1）与 DSH `0.2.2-rc.5` 为准。

---

## 0. 决策记录（2026-11-24 拍板）

八项决策由产品负责人拍板，后续实现不再逐项复议；需要变更时改本节并同步回归。

| 编号 | 决策点 | 结论 | 影响面 |
|---|---|---|---|
| **D1** | 执行模型 | **首版固定审查模块**（模型只能选 `module_id` + `params`）。"可编辑 `analysis.py` + 平台 shell"**延期到 Phase 6 决策点**，不标永久放弃；重新开启的前置条件见 §13.5 | §1.2、§6.1、§8、§13 |
| **D2** | 角色直连 | **广域直连**（按 §5.2 邻接表），便于材料/计算随时互通；**唯一保留**：`senior` 不得绕过 lead 直接发起新取数/新检索（范围闸门在 lead） | §5、§6.2、§14.2 |
| **D3** | senior 出图 | **首版不出图**。需要图时由 lead 另派 `data-junior` 基于原始 Dataset 重做，必须带 senior 的 method/params 摘要并披露口径差异。受控出图列 Phase 6 | §1.2、§6.1、§17 |
| **D4** | 首版模块范围 | **Phase 2 只上 `financial_quality` 一个模块端到端**；Phase 5 加 `returns_risk` + `scenario_sensitivity`；其余进 P1 | §9、§17 |
| **D5** | 提交校验强度 | **分级**：结论性字段硬拒（不落盘），过程性字段警告并降级 `validation.status` | §11.4、§12.2 |
| **D6** | 是否进选择器 | **内部角色**，不进 preset picker；卡片名仍为「高级分析师」，只能被 lead 委派 | §4.5、§15 |
| **D7** | run 保留期 | **跟随输入**：`expires_at = min(run_created_at + 7d, earliest input retention_until)`；`artifact.json` / `run.json` 长期保留，`inputs/` 副本随过期 | §7.5 |
| **D8** | 评测门槛 | **7 个固定案例 + 人工逐案 pass/fail**；不做百分比阈值，指标只作趋势记录 | §18.3 |

---

## 0.1 取代关系（必须读）

本文件**取代** [data-analyst-architecture.md](data-analyst-architecture.md) 中关于**首版执行模型**的部分。
两份文件的关系必须显式记录，否则实现者会按两套互斥方案各做一半：

| 主题 | 旧设计（`data-analyst-architecture.md`） | 本设计 v2 | 处置 |
|---|---|---|---|
| 执行模型 | 模型可编辑并运行 `analysis.py`（[:16](data-analyst-architecture.md#L16)、[:254](data-analyst-architecture.md#L254)） | 仓库内审查过的固定模块（§8） | **取代**（Phase 6 重新评估） |
| 工具面 | 平台 shell + dataset/profile/time + chart token + specialist 创建（[:303-306](data-analyst-architecture.md#L303-L306)） | `tools/analysis` + `tools/time` + `skill` + `send_message`（§6.1） | **取代** |
| 出图 | 自签 token + 委派 one-shot specialist（[:304-305](data-analyst-architecture.md#L304-L305)） | 首版不出图（D3） | **取代** |
| run 布局 | `manifest.json` + `inputs/<alias>/` + `attempts/<id>/`（[:245-264](data-analyst-architecture.md#L245-L264)） | `snapshot.json` + `inputs/{datasets,profiles,evidence}/` + `modules/<module_run_id>/`（§7.3） | **取代** |
| 错误码 | `python_runtime_unavailable` / `analysis_script_failed` / `analysis_shape_unsupported`（[:399-407](data-analyst-architecture.md#L399-L407)） | §10.7；运行时不可用复用 `python_runtime_unavailable`，其余用 `analysis_*` | **取代**（保留 `python_runtime_unavailable`） |
| 拓扑 | 主 Agent 中继；analyst 可建 specialist（[:428-433](data-analyst-architecture.md#L428-L433)） | 根直系叶子 + 广域直连（§5） | **取代** |
| 私有 python-runtime 结论 | 插件私有运行时、按需安装、pinned pack（[:7-10](data-analyst-architecture.md#L7-L10)） | 完全沿用 | **保留** |
| 按需激活 / `analysis_data_request` 补数回路 | [:428](data-analyst-architecture.md#L428)、[:330-352](data-analyst-architecture.md#L330-L352) | 沿用，补数经 lead（§5.3） | **保留** |
| 不设单任务数据量硬上限 | [:413](data-analyst-architecture.md#L413) | 沿用 | **保留** |
| run 目录可审计 / 可复算 | [:266](data-analyst-architecture.md#L266) | 沿用（保留期见 D7） | **保留** |
| 全量 shell 与 DSH 权限档 | [:20](data-analyst-architecture.md#L20)、[:96](data-analyst-architecture.md#L96) | 首版无 shell；该结论**延期**而非作废 | **延期** |

**同时作废的基线陈述**（实现时必须同步改，否则文档自相矛盾）：

- [data-roles.md](../dev/data-roles.md#L146) §1.8 角色树写「`data-analyst` 未来挂在 `data-junior` 之下」——**错误**。
  `sessionScopeFor(session) = parentSession || session.id`（`src/data-collector/store.ts:1002-1005`），
  挂在 junior 下会拿到 junior 的 scope，读不到 collector 落盘的 Dataset。senior **必须**是根直系。
- [preset-persona.md](../dev/preset-persona.md#L136-L139) §8.4 记录的恢复前置条件「shell 槽位加行并重定沙箱写边界」——
  按 D1 首版不成立，改为「`tools/analysis` 族行 + 固定模块」。
- `AGENTS.md` §1 的一句话版「角色是叶子，互通经主 Agent」——按 D2 改为「角色是叶子（不创建子 Agent），
  互通按 §5.2 邻接表；取数/检索仍只经 lead」。这是 ⛔ 级改动，按 `AGENTS.md` §8.3 同步断言。

---

## 1. 目标与非目标

### 1.1 目标

1. 将预留的 `data_analyst` 升级并改名为 `senior_analyst`（身份迁移规则见 §4.3）。
2. 建立"证据约束下的研究综合与反方验证"角色，而不是更强的取数员或报告写手。
3. 允许直系子 Agent 之间按显式邻接表直接传递引用和计算结果，减少主 Agent 中继。
4. 基于已有私有 Python 运行时，建立受控分析模块 registry。
5. 分析产物可追溯、可复算、可证伪、可审计。
6. 主 Agent 仍负责最终用户答复，不恢复 `final_report` 或独立报告通道。

### 1.2 非目标

首版明确不做：

- 社区模块安装、公共 catalog、模块市场；
- 模型任意提交 `analysis.py`（D1；Phase 6 重新评估）；
- 未审查第三方代码直接执行；
- 独立 HTML/Markdown 报告产物；
- senior 出图或创建子 Agent（D3）；
- 交易、下单、仓位执行；
- 真人扮演投票、多空辩论赛；
- 新数据源或第二套取数通道；
- 完整回测、因子挖掘、机器学习；
- 期权、银行、保险等高度专用模型；
- 新设置页或复杂 UI。

---

## 2. 核心设计原则

1. **角色边界优先于能力数量。**
2. **原始 rows 永不进入模型上下文。**
3. **分析模块只消费宿主暂存的授权输入。**
4. **协议兼容不等于默认可信。**
5. **persona 定硬规则，skill 定流程，工具定可执行边界。**
6. **关键校验由宿主确定性完成，不依赖模型自觉。**
7. **主 Agent 是范围闸门、补数协调者和最终写作者。**
8. **首版只允许仓库内审查过的固定模块。**
9. **所有分析绑定输入快照和版本。**
10. **证据不足时允许 `partial / blocked / insufficient`，不强迫输出结论。**
11. **直连不改变收尾判据**：peer 往返必须体现在回执里，根仍以 `analysis_result` 为收尾凭据（§5.6）。
12. **越权判据只有一处实现**：工具授权走 `src/tool-exec.ts`，消息目标走 `src/agents/messaging-policy.ts`；
    两者都是**路由纪律**，不是安全边界。

---

## 3. 当前基线（2026-11-24 核实）

### 3.1 已有能力

- `data_collector`：结构化取数、Dataset 落盘、DatasetRef。
- `data_junior`：profile、受控聚合查询、统计、假设建模、可视化 gate。
- `web_retriever`：公告、新闻、研报、OCR 与来源核验。
- `visualization_specialist`：唯一出图角色，挂在 `data-junior` 下。
- Python 私有运行时（`pythonRuntime` host 服务）：
  - 四个 target：Windows x64、macOS x64/arm64、Linux x64（Win10 1809 / macOS 12 / glibc 2.28 起）；
  - 锁定 Python **3.13.17**、numpy **2.4.6**、pandas **3.0.6**、python-dateutil **2.9.0.post0**、
    six **1.17.0**、tzdata **2026.6**；`parquet` 可选 pack 提供 pyarrow **25.0.1**；
  - `runDataScript()`：固定脚本（`python/scripts/`，名字正则 `^[a-z0-9_]+$`）+ 一次性 run 目录 +
    超时/取消/进程树终止，返回 `{rows, pythonVersion, durationMs}`；
  - 超时默认 60s（`probeTimeoutMs`），但 `request_data` 传输层 30s 先 abort，实际约 30s。
- Dataset/profile 引用与 session scope（`sessionScopeFor` 见 §0.1）。
- 根级 `wait_for_agents` 与结算对账。
- **70 颗**精选方法 Skill 与角色化路由（catalog 70 / routing 70）。
- `capital-analysis/runs/`：**仅文档预留**。`automation/storage.js` 已把它作为存储统计类别
  （`RETAINED_DIR = 'capital-analysis'`、`ANALYSIS_GROUPS` 含 `runs`），但**没有任何代码创建或写入该目录**。

### 3.2 关键约束

- `config.id` 是历史会话身份，不能随意改（DSH 0.2.2-rc.5 已核验：改名后历史会话 `agent-preset/not-found`）。
- 工具参数根必须是 `jsonObject()` 形状的 object（供应商契约；宿主不校验，见 `docs/dev/tool-schema.md` §9.1）。
- 工具输出必须严格满足 `output.schema`（宿主 `ToolOutputError`，账本 L16）。
- 原始 rows 只能留在 Dataset/分析 worker 内。
- 不新增自定义会话事件类型；不恢复 `final_report`。
- 当前 Python 运行时**不是** OS sandbox（`python-runtime.md` §0 第 6 条）。
- `selected-skills/reference-algorithms/` 是 git-only、不执行；生产模块必须复制/适配到
  `python/analysis/modules/` 并保留 LICENSE。
- 改 preset/host 行后必须 `npm test` + `npm run check:dsh`（`AGENTS.md` §8.3）。

### 3.3 已知会变红的既有断言（实现前先读）

| 断言 | 位置 | 为什么变红 |
|---|---|---|
| `read_profile` 未注册 | `test/persona.test.mjs:1325` | 本设计新增该工具 |
| analyst persona 含「经主 Agent 中继」 | `test/persona.test.mjs:1330` | D2 改变该规则 |
| `subagent_senior_analyst` 行 disabled | `test/persona.test.mjs`「Phase 0 只锁契约」 | Phase 3 启用 |
| 委派工具名清单 | `test/persona.test.mjs:804` | 改名 `subagent_senior_analyst` |
| `DATASET_READING_PRESET_IDS` 含 analyst | `test/family-entries.test.mjs:112-118` | senior 不挂 dataset-read 行，需移除 |
| 精选角色 pill 名称/数量 | `test/selected-skill-filter.test.mjs`、`test/capital-config.test.mjs` | 新增独立角色键 |
| preset roster 精确清单 | `test/preset-roster.test.mjs:19` | D6 加入内部角色 |

> **规则**：这些断言**只能改写成新事实，不能删**（`AGENTS.md` §8.3 第 2 条）。
>
> **进度（2026-11-24）**：身份与行契约那几行已在 Phase 0 改写成新事实；剩下的是 persona 文案
> （Phase 3）与 D2 邻接表（Phase 4）。

### 3.4 文档预算（硬闸门）

- `AGENTS.md` 当前 **12,270 字节 / 上限 12,288**（`test/dev-docs.test.mjs:16-18`），**只剩 18 字节**。
- `docs/dev/*.md` 单文件 **150 行**上限；`data-roles.md` / `tool-schema.md` / `automation.md` 已顶满，
  `preset-persona.md` 149 行。
- 结论：**任何"往 data-roles.md 加一段"的改法都不可行**。拆分方案见 §16。

---

## 4. 角色定位与身份迁移

### 4.1 新角色定义

```text
senior_analyst / senior-analyst
```

职责：

- 接收 DatasetRef、profile_ref、证据快照与研究问题；
- 选择并调用受控分析模块；
- 解释假设、方法、冲突与敏感性；
- 构造支持证据、反证、替代解释和失效条件；
- 返回结构化 `AnalysisArtifact`；
- 不直接取数、不直接检索、不读原始 rows、不出图、不写最终报告、不交易、不创建子 Agent。

### 4.2 角色拓扑

```text
lead
  ├── data-collector
  ├── data-junior
  │     └── chart-<n> (visualization_specialist)
  ├── web-retriever
  └── senior-analyst       ← 根直系子 Agent、叶子节点
        └── 不创建任何子 Agent
```

`senior-analyst` **必须**是根直系（理由见 §0.1 的 scope 事实）。

### 4.3 身份迁移策略

首版采用"语义改名、稳定 preset id"：

| 层 | 首版值 | 用途 |
|---|---|---|
| 用户显示名 | 高级分析师 | preset 卡片文本（不进 picker，见 D6） |
| 角色语义键 | `senior_analyst` | 文档、模块 manifest `roles`、selected-skills 角色键 |
| Agent 树内名字 | `senior-analyst` | `list_agents` / `send_message` 目标名 |
| 委派工具 | `subagent_senior_analyst` | 主 preset 的 `toolName` |
| preset `config.id` | **保留 `capital-data-analyst`** | 会话日志身份，不能改 |
| 旧角色键 `data_analyst` | 仅作 selected-skills 兼容别名 → `senior_analyst` | 历史配置兼容 |

原因：`capital-data-analyst` 已写入历史会话，直接改名会导致历史会话无法恢复（DSH 行为已核验）。

> ⛔ **四处同字**：`senior_analyst`（语义键）/ `senior-analyst`（树内名）/ `capital-data-analyst`（preset id）
> 是三个不同层的合法值，**不得互相替代**。`test/persona.test.mjs` 必须有一处把这张表钉死；
> 任一漂移的表现是"委派行静默少一整族工具"或"send_message 目标永远拒"（`docs/dev/settings-config.md` §5.1 同类事故）。

### 4.4 角色可见性

D6：senior 是**内部角色**，不进 preset picker。实现：

- `src/preset-ids.ts` 的 `INTERNAL_ROLE_PRESET_IDS` 增加 `ROLE_PRESET_IDS.analyst`（现只含 junior/specialist）；
- preset 卡片 `name` 仍写「高级分析师」，`order` 与内部角色同级（5/6 之后）；
- `test/preset-roster.test.mjs` 的精确清单同步。

> 不进 picker 不影响"用户显示名"——`data-junior` 卡片叫「分析师」同样不进 picker，是既有先例。

### 4.5 主 Agent 路由

- 单点事实问题不派 senior。
- 单一公司完整投研、重大事件影响、财报/估值质量复核、组合风险综合等任务按需派 senior。
- senior 不是每轮强制预检角色。
- 主 Agent 仍负责最终写作、图表交付和用户交互。

---

## 5. 子 Agent 直连（D2）

### 5.1 DSH 能力结论（0.2.2-rc.5 已核验）

同一 subagent tree 内，宿主支持：兄弟互发、跨分支发送、根→孙、孙→根、空闲目标恢复
（`steer`/`followup` 起新一轮）、消息持久记录真实 `senderSessionId`。`send_message` 只返回
`messageId`，不是同步 RPC。`interrupt_agent` 仍是祖先专属（service 层 `UNAUTHORIZED`）。

宿主的授权判据只有"同树 + 非自己 + 发送者存活 + 目标 continuable"，
**没有任何发送者→目标边策略**——边策略完全由本插件加。

> 两个必须承认的限制：
> 1. `tools.guard` 是同步的，读不到 `resolveName` 结果；目标解析是异步的。所以边闸门只能看**字符串**。
> 2. `send_message` 的目标参数把"任意非斜杠串"当作 session id 透传（`dsh-subagent/src/index.ts:331-347`）。
>    因此名字形状策略**不是硬边界**：已知深孙的 session id 在形状上与直系名不可区分。
>    本设计把它定位为**路由纪律**（防误发、防模型乱发），不写成安全边界。

### 5.2 允许边（首版邻接表）

| 发送方 | 允许目标 | 内容 |
|---|---|---|
| `lead` | 仅直系子 Agent | 任务、范围、补数决定 |
| `data-collector` | `data-junior`、`senior-analyst`、`lead` | DatasetRef、dataset_ready、data_failed |
| `data-junior` | `senior-analyst`、`lead` | profile_ref、聚合结果、计算引用 |
| `web-retriever` | `senior-analyst`、`lead` | 带来源的结构化证据 |
| `senior-analyst` | `data-junior`、`lead` | 补计算请求、analysis_result |
| `visualization-specialist` | 无 | 维持现状 |

**唯一保留的闸门（D2 注）**：`senior-analyst` **不得**直接向 `data-collector` / `web-retriever`
发起新取数或新检索——新数据/新检索一律经 `lead`（范围闸门，见 §5.3）。
senior 对 `data-junior` 只能请求"用已有 Dataset/profile 做计算"，不能请求"去拿新数据"。

### 5.3 不允许的直连

- senior 直接要求 collector 新取数、retriever 新检索（范围闸门）；
- junior 通过 senior 绕过 lead 扩大任务范围（senior 收到越界请求应回 `analysis_blocked` 并点名）；
- 兄弟互相 `interrupt_agent`（`interrupt_agent` 仍只归祖先，宿主层已拒）；
- specialist 直连任何角色；
- 任意全树聊天（未在 §5.2 表内的边一律拒）。

### 5.4 消息契约

所有直连消息使用 JSON 字符串：

```json
{
  "protocol": "capital.agent.message/v1",
  "type": "analysis_input_ready",
  "task_id": "task_...",
  "analysis_id": "analysis_...",
  "payload": {}
}
```

关键消息类型：

- `dataset_ready` / `data_failed`（collector → junior / senior / lead）
- `analysis_input_ready`（junior / retriever → senior）
- `analysis_calculation_request` / `analysis_calculation_result`（senior ↔ junior）
- `analysis_data_request`（senior → lead，补数；沿用旧设计 §6.2 的载荷）
- `analysis_blocked`（senior → lead）
- `analysis_result`（senior → lead，小回执）

> **信封没有宿主校验**。原则 6"关键校验由宿主完成"对消息信封**不成立**：`send_message` 的 guard
> 只判目标，不解析 `message` 内容。因此：
> - 信封是**模型侧约定**，靠 persona + skill 两侧断言；
> - 真正需要确定性保证的信息（refs、数字、状态）必须走**工具返回值**，不能只走消息；
> - 不要在文档或 persona 里把信封写成"宿主会校验"。

### 5.5 名称与发现

首版不开放角色 `list_agents`：

- 主 Agent 创建角色时把固定名字写入 prompt；
- 历史无名角色由主 Agent 用 session id 中继（**仅 lead 可用**；peer 边只认固定名字，见 §5.7）；
- 继续 deny `interrupt_agent`、`list_agents`；senior 另外 deny `wait_agent`（它是叶子，没有子 Agent
  可等；这三个名字是 `tool-subagent-control` 行焊进来的，只能调用级 deny，不能 `restrict`）；
  `wait_agent` **只加在 analyst 的角色面上**，不动 `SIBLING_DENIED_TOOLS` 共享常量——
  `data-junior` 有 specialist 子 Agent，一起禁会破坏它的出图 barrier；
- 只放开 `send_message` 的目标边。

### 5.6 收尾判据（直连的代价，必须实现）

直连改变了收尾对账的假设，以下四条缺一不可：

1. **`peer_exchanges[]` 进回执**：senior 的 `analysis_result` 必须列出本次全部 peer 往返
   （`{peer, type, request_id, answered: true|false}`）。**存在 `answered:false` 的 peer 请求时，
   senior 不得写 `status: completed`**（只能 `partial`/`blocked`）。
2. **peer 往返预算**：同一 `task_id` 下，senior→junior 的补计算往返**最多 3 次**；超出回
   `analysis_blocked` + `peer_budget_exhausted`，由 lead 裁决。禁止无界互发。
3. **`waiting_peer` 状态**：对账表（`capital-orchestration` §6.1）新增一行。子 Agent 空闲但在等
   peer 回执时，结算通知**不等于完成**；只有 lead 收到该子 Agent 的最终回执（`analysis_result`
   或 `profile_ref` 等）才可记为完成。
4. **唤醒账本**：`src/agents/settled-wake.ts` 的 `admitted` 集合只认"向根投递过 relay 的子 Agent"。
   只跟 peer 通信的子 Agent 不会被 admit，其结算通知可能把已收尾的根再唤醒一轮。
   **这是噪声不是数据丢失**（最多多一个空轮），首版接受；若实测频繁，再评估把 peer relay
   计入 admit 条件。文档与测试都要写明这一点，不要假装已解决。

### 5.7 Dataset scope

`sessionScopeFor(session) = parentSession || session.id`（`src/data-collector/store.ts:1002-1005`）。
根的所有直系子 Agent 共享根 scope，因此 collector/junior/senior 之间可以直接传 DatasetRef。

- senior 必须保持根直系，不能挂到 junior 下（否则 scope 变成 junior，读不到 collector 的 Dataset）。
- peer 边只认固定名字；历史无名 child 无法被 peer 边寻址，只能由 lead 中继。

---

## 6. Senior Analyst 工作流

```text
lead 明确任务与 task_id（写入 scope / 完成条件 / 是否需要图）
  ↓
collector / retriever / junior 并行准备材料（可直连送达）
  ↓
collector → junior / senior：DatasetRef
retriever → senior：证据
junior → senior：profile/query refs
  ↓
senior 创建 AnalysisSnapshot（宿主生成 analysis_id）
  ↓
senior 选择分析模块并执行（run_analysis）
  ↓
（可选，最多 3 轮）senior → junior：补计算请求 → 结果
  ↓
senior 综合 claims / 反证 / 冲突 / 情景 / 失效条件
  ↓
submit_analysis 校验并持久化 AnalysisArtifact
  ↓
senior → lead：analysis_result 小回执（含 peer_exchanges）
  ↓
lead 写自足最终答复
```

### 6.1 senior 的工具面（精确清单）

**挂载的族行**：

| 行 | 带来的工具 |
|---|---|
| `tools/analysis`（新增） | `create_analysis_snapshot`、`read_profile`、`list_analysis_modules`、`describe_analysis_module`、`run_analysis`、`submit_analysis` |
| `tools/time` | `get_local_datetime`、`resolve_data_time_range` |
| `tools/selected-skills`（`config.role: senior_analyst`） | 无模型工具；注册 `capital:selected-skills` 与 `capital:data-contract` 两段 system prompt |
| `tool-skill` | `skill` |
| `tool-subagent-control` | `send_message`（同行的 `interrupt_agent` / `list_agents` / `wait_agent` 逐名 deny） |

**不挂**：

- `tools/dataset-read`（`describe_dataset` / `inspect_dataset` / `profile_dataset` / `query_dataset`）；
- `tools/collect`、检索族行、`tools/ocr`；
- `tools/chart-render` / `tools/chart-source`；
- shell（`bash` / `pwsh`）与 PTC（`tool-executor-ptc`）；
- 任何子 Agent 创建工具。

**授权实现**：分析工具的调用者判据**必须**复用 `src/tool-exec.ts` 的 `authorizedSession` /
`authorizeToolSession`（`docs/dev/time-axis.md` §1.3 ⛔：工具授权判据只有一份实现）。
`src/preset-ids.ts` 增加 `ANALYSIS_PRESET_IDS = [ROLE_PRESET_IDS.analyst]`；
`DATASET_READING_PRESET_IDS` 移除 analyst（senior 不再挂 dataset-read 行）。

### 6.2 主 Agent 路由与直连纪律

- 单点事实问题不派 senior。
- 单一公司完整投研、重大事件影响、财报/估值质量复核、组合风险综合等任务按需派 senior。
- 主 Agent 是**范围闸门**：senior 的 `analysis_data_request` 只转交 brief 内的请求。
- **senior 未结算（未收到 `analysis_result`）时不得写最终结论。**
- 主 Agent 仍负责最终写作、图表交付和用户交互。

---

## 7. AnalysisSnapshot 设计

### 7.1 目的

将分散的 DatasetRef、profile、证据与研究约束冻结为一个不可变分析输入版本。

### 7.2 输入

```text
task_id
question
instrument
purpose: observe | research | holding_review
horizon
depth: quick | standard | deep
as_of
data_cutoff
dataset_refs[]
profile_refs[]
evidence[]
prior_analysis_refs[]
constraints
```

> `analysis_id` **不在输入里**：由宿主生成（`analysis_<ULID>`）。模型不能指定 id，
> 否则可以复用/覆盖别人的 run（`docs/dev/tool-schema.md` §10.3「冒烟复核的 id 不得编造」同源）。

`evidence[]` 为有界结构化项（单条 ≤ 2 KiB，总量 ≤ 20 条）：

```json
{
  "source_id": "...",
  "kind": "filing | news | research | user_material",
  "title": "...",
  "source": "...",
  "published_at": "...",
  "url": "...",
  "excerpt": "...",
  "verification": "verified_official | unverified | not_verified"
}
```

不接收完整 PDF/网页正文，正文仍由 `web_retriever`/OCR 侧管理。

### 7.3 存储

```text
capital-analysis/runs/<analysis_id>/
  snapshot.json
  run.json
  inputs/
    datasets/<dataset_id>.json
    profiles/<profile_id>.json
    evidence/<evidence_id>.json
  modules/<module_run_id>/
    request.json
    result.json
    outputs/
    logs/
  artifact.json
```

- `snapshot.json` 只存引用、覆盖范围、限制和指纹，**不存原始 rows**。
- `inputs/` 是宿主暂存的授权副本，只供固定 worker 读取；`snapshot.json` 记录每份副本的
  sha256、来源 ref 与保留期。
- 模型只能看到 `analysis_snapshot_ref` 与小摘要。
- 目录由 `tools/analysis` 首次写入时按需创建（`capital-analysis/runs/` 目前只是文档预留，
  没有任何代码创建它，见 §3.1）。

### 7.4 指纹：拆成两层

v1 把"输入指纹"和"运行指纹"混在一起，导致"snapshot 指纹包含模块版本"在时序上不可能
（snapshot 早于模块选择）。v2 拆分：

- **`input_fingerprint`**（`create_analysis_snapshot` 时算一次）：
  DatasetRef 的 `dataset_id / params_digest / captured_at`、profile 的 `profile_id / created_at`、
  evidence 的 `source_id / 内容 hash / as_of`、分析协议版本、`as_of`、关键约束。
- **`run_fingerprint`**（`run_analysis` 时算）：`input_fingerprint` + `module_id` + `module_version`
  + `params_digest`。

**缓存语义（v1 只有一种）**：同一 snapshot 内，`run_fingerprint` 相同的已完成 module_run 可复用，
不重复执行；`run.json` 记录 `reused_from`。**跨 snapshot 不复用**（避免"输入变了还拿旧结果"）。

**过期语义**：`expires_at = min(snapshot_created_at + 7d, earliest input retention_until)`
（D7）。`run_analysis` / `submit_analysis` 在 `now > expires_at` 时返回 `analysis_snapshot_expired`。

> v1 的验收「snapshot 输入变化后旧分析失效」在冻结副本布局下无法发生，已改写为：
> 输入/模块/参数任一变化 → `run_fingerprint` 不同 → 不复用（§18.2 #7）。

### 7.5 保留期（D7）

- `expires_at` 如上；到期后 `snapshot.json` 标记 `expired`、`inputs/` 不再被读取。
  **2026-11-24 决定：不实现物理清理**——分析产物只进存储统计（`analysis.categories.runs`），
  不提供删除入口；到期是逻辑失效，不是删除。
- **长期保留**：`artifact.json` + `run.json`（含两层指纹、模块版本、参数摘要、时间线）。
  审计与复算靠这两份摘要，不靠原始副本。
- v1 **不承诺物理清理**（与旧设计一致：`retention_until` 首先是逻辑失效时间）。
  `automation/storage.js` 已把 `capital-analysis/runs` 纳入存储统计，清理实现另立任务。

---

## 8. 受控分析模块协议

### 8.1 首版范围

- 只支持仓库内审查过的 Python 模块；
- 不做动态安装、目录扫描或社区代码执行；
- 保留鸭子协议结构，未来可在不改变工具面的情况下扩展模块。

### 8.2 模块目录

```text
python/analysis/modules/<module_id>/
  module.json
  module.py
  LICENSE
  fixtures/            # 不进 npm 发布包（见 §15.3）
```

### 8.3 Manifest

```json
{
  "id": "financial_quality",
  "version": "1.0.0",
  "entrypoint": "module.py",
  "runtime": "python",
  "description": "财务比率、盈利质量与偿债能力",
  "roles": ["senior_analyst"],
  "capabilities": ["dataset.read", "profile.read"],
  "required_fields": [],
  "input_schema": {},
  "output_schema": {},
  "assumptions": [],
  "applicability": [],
  "limits": {
    "timeout_ms": 30000,
    "max_input_rows": 200000,
    "max_output_bytes": 1048576,
    "max_log_bytes": 65536
  },
  "provenance": {
    "source_type": "adapted",
    "repository": "GAJETOso/financeskills",
    "commit": "b0c6239...",
    "license": "MIT"
  }
}
```

`capabilities` 是**强制白名单**：`context.read_dataset` / `read_profile` / `read_evidence`
在调用前检查 manifest 是否声明对应能力，未声明 → `analysis_module_not_applicable`。
（v1 的 capabilities 是装饰项，v2 起变成真判据；实现时不要只写不查。）

`roles` 用**语义键** `senior_analyst`（不是 preset id），映射表见 §4.3。

### 8.4 Python 鸭子接口

```python
def analyze(request: dict, context) -> dict:
    ...
```

不要求继承基类。

`context` 只提供：

```python
context.read_dataset(dataset_id)     # -> DatasetView（见 §8.5）
context.read_profile(profile_id)     # -> dict（宿主已校验 session/关联/未过期）
context.read_evidence(evidence_id)   # -> dict（snapshot 内证据项）
context.write_output(name, value)    # -> ref；写 modules/<id>/outputs/<name>.json
context.log(message)                 # -> None；写 logs/，超过 max_log_bytes 截断并标记
```

**不提供**：任意路径、网络客户端、凭据、子进程、环境变量读取、其他会话数据。

> 必须说清：**"不提供"不等于"不可能"**。Python 进程内仍可 `import socket` / `os.environ`
> （后者已被 `pythonChildEnv` 清空到 run 目录）。首版的真实控制是**模块随包发布 + 代码审查 +
> registry 白名单**，不是运行时拦截。§12.3 不把这写成安全边界。

### 8.5 数据契约（host ↔ module 的唯一接口）

`context.read_dataset(dataset_id)` 返回：

```python
{
  "shape": "rows" | "document",
  "columns": [{"name": str, "type": str, "nullable": bool}],
  "row_count": int,
  "rows": list[dict],            # 仅 shape="rows" 且在 max_input_rows 内
  "envelope": dict | null,       # envelope 型 Dataset 的根级标量（trade_date 等）
  "time_axis": {"column": str, "unit": str, "tz": str} | null,
  "truncated": bool,
  "source": {"dataset_id": str, "captured_at": int, "params_digest": str}
}
```

规则（实现时必须逐条落）：

- 行数组位置由 Dataset manifest 的 `row_key` 决定（`src/data-collector/store.ts` 已有该字段，
  与 `docs/dev/data-roles.md` §1.5「行数组位置由数据源声明」同源），**不靠 `data.item` 猜**。
- `document` 型 Dataset 返回 `shape="document"`、`rows=[]`；模块必须显式处理或返回
  `analysis_input_invalid`，不得把文档当表格。
- 超过 `max_input_rows` 时返回前 N 行并置 `truncated=true`；模块必须把截断写进 `limitations`，
  **不得静默按截断样本下结论**。
- 读取走 `WorkspaceDatasetStore` 的授权与 `MAX_RAW_READ_BYTES`（16 MiB）；超限 → `analysis_input_invalid`
  并点名是哪份 Dataset。
- 授权判据复用 `authorizedSession`（§6.1），**不新写第二份**。

### 8.6 Request

```json
{
  "protocol": "capital.analysis/v1",
  "task_id": "...",
  "analysis_id": "...",
  "module_run_id": "...",
  "snapshot_id": "...",
  "as_of": "2026-11-24",
  "inputs": {
    "datasets": [],
    "profiles": [],
    "evidence": []
  },
  "params": {}
}
```

### 8.7 Result

```json
{
  "status": "completed | partial | blocked | failed",
  "summary": "...",
  "metrics": {},
  "claims": [],
  "assumptions": [],
  "methodology_log": [],
  "sensitivity": {},
  "limitations": [],
  "data_gaps": [],
  "outputs": []
}
```

硬要求：

- lossless JSON（无 `undefined` / `NaN` / `Infinity` / 数组空洞）；
- 未知字段拒绝；
- 大数据只写 `outputs/`（`max_output_bytes`）；
- 失败必须带稳定 error code（§10.7）；
- `status: failed` 的 result 也要落盘（供审计），但**不得**生成可提交的 artifact。

### 8.8 Registry

首版使用静态 registry：

```text
src/analysis/registry.ts
```

每个模块显式登记（`id → manifest + entry`），不扫描目录。registry 是模块白名单与版本事实来源；
`list_analysis_modules` / `describe_analysis_module` 只读它。

---

## 9. 首批分析模块与分期（D4）

### 9.1 Phase 2 唯一模块（端到端打样）

| 模块 | 能力 | 参考 |
|---|---|---|
| `financial_quality` | 利润率、ROE/DuPont、现金转换、杠杆、利息覆盖、营运资本 | FinanceSkills `financial-analysis`、`credit-analysis`（MIT） |

选它的理由：输入只需标准财务报表字段，输出天然包含"可溯源数字 + 假设 + 缺口"，
能一次性打穿协议/worker/校验/审计/失败路径全链路。

> **实现口径（Phase 2）**：三张报表是**三份 Dataset**，模块按列签名（利润表 `operating_income`+`net_profit`、
> 资产负债表 `assets_total`+`holder_equity_total`、现金流量表 `act_cash_flow_net`）识别，按 `period_end_ms`
> （缺则 `period`）对齐同一报告期。**不要求预先拼成一张宽表**：本仓没有任何入口能产出宽表，若模块要求宽表，
> 真实会话里根本跑不起来。语义识别 + 报告期对齐是模块自己的职责，缺一份报表就写缺口。

### 9.2 Phase 5 扩展

| 模块 | 能力 | 参考 |
|---|---|---|
| `returns_risk` | 收益率、年化波动、最大回撤、beta、相关、VaR/CVaR | FinanceSkills `risk-assessment`、Trading Skills calculations |
| `scenario_sensitivity` | 通用参数网格、情景对比、假设追踪 | 本仓实现 |

`returns_risk` 覆盖"序列"形状，`scenario_sensitivity` 覆盖"假设网格"形状——两种输入形状
与 `financial_quality` 的"横截面财务"互补，扩完这三颗，模块协议的三种形态才算验证过。

### 9.3 P1（Phase 6 之后）

- `statement_integrity`（三表平衡、现金勾稽、留存收益滚动）
- `valuation_sensitivity`（DCF、CAPM/WACC、EV→股权桥、终值与 WACC 敏感性）
- `kline_quality`（OHLC 清洗、异常 bar 拒绝、缺失成交量不当零）
- `comps_valuation` / `earnings_bridge` / `portfolio_stress` / `technical_indicators` / `simple_backtest`

### 9.4 暂不做

- 通用因子挖掘；机器学习；期权定价；银行/保险专用模型；私人市场估值；税务优化；
- 任何直接取数模块。

### 9.5 模块质量要求

每个模块必须：

- 固定来源与 commit，保留 `LICENSE`，进 `THIRD_PARTY_NOTICES.md`；
- 有正常/边界/失败 fixtures 与 golden case；
- 显式列出假设与 `applicability`；
- 缺数据返回缺口，不填默认值；
- 不输出硬评级或目标价；
- 不用固定阈值伪装研究结论；
- 输出严格满足 `output_schema`（宿主校验，非自述）。

`analysis_validate` 是**宿主 TS 实现**（`src/analysis/validation.ts`），不是 Python 模块，
不登记进 registry，不出现在 `list_analysis_modules` 里。

---

## 10. 工具设计

所有工具必须经 `apply()` 注册，进入 `test/family-rows.mjs` 的行契约与 `test/family-entries.test.mjs`
的入口表；参数根为 object，返回满足 `output.schema` 且为无损 JSON。

### 10.1 `create_analysis_snapshot`

输入：

```json
{
  "task_id": "...",
  "question": "...",
  "instrument": "...",
  "dataset_refs": [],
  "profile_refs": [],
  "evidence": [],
  "as_of": "...",
  "constraints": {}
}
```

输出：

```json
{
  "analysis_snapshot_ref": "...",
  "analysis_id": "...",
  "input_fingerprint": "...",
  "expires_at": "...",
  "coverage": {},
  "limitations": []
}
```

- `analysis_id` 由宿主生成；
- refs 逐份校验（session scope + 存在 + 未过期 + 副本已写），任一失败整次失败并点名；
- 返回只含 ref 与摘要，不回 rows。

### 10.2 `read_profile`

输入：

```json
{
  "profile_ref": "...",
  "columns_of_interest": []
}
```

输出：

- `profile_ref`；
- 有界 profile facts（复用 `store.ts` 的 profile 读取与授权，**不新写第二份**）；
- 单次返回受 `SAFE_RESULT_CHARS = 7000` 同一道体积闸门约束（超限返回小回执 + hint）；
- 不返回原始 rows。

### 10.3 `list_analysis_modules`

返回 senior 当前可用模块（只读 registry）：

- id/version、描述、输入依赖、适用条件、provenance、limits；
- 输出 ≤ 4096 字符（`docs/dev/data-roles.md` §1.5 的分片预算同口径），超限按主题分片或返回索引。

### 10.4 `describe_analysis_module`

输入 `module_id`，返回完整 `input_schema` / `output_schema` / 假设 / 能力 / limits。
未知 id → `analysis_module_not_found`。

### 10.5 `run_analysis`

输入：

```json
{
  "analysis_snapshot_ref": "...",
  "module_id": "financial_quality",
  "params": {}
}
```

输出：

```json
{
  "analysis_run_ref": "...",
  "module_id": "...",
  "module_version": "...",
  "status": "completed | partial | blocked | failed",
  "summary": "...",
  "metrics": {},
  "assumptions": [],
  "limitations": [],
  "data_gaps": [],
  "validation": {
    "status": "pass | warning",
    "issues": []
  },
  "reused": false
}
```

- `params` 必须符合模块 `input_schema`；
- `run_fingerprint` 命中已完成 run → 直接复用（`reused: true`），不重复执行；
- 并发：同一 snapshot 下 `run_analysis` **串行**（宿主加锁）；不同 snapshot 可并行，
  但全局同时最多 **2 个** Python 分析进程（复用 `pythonRuntime` 的进程管理，另加信号量）。

### 10.6 `submit_analysis`

输入：最终 `AnalysisArtifact`（§11）。**体积预算**：序列化后 ≤ 20000 字符；
单字段上限 `headline` ≤ 300、`thesis` ≤ 1200、每条 `statement` ≤ 600、`claims` ≤ 20 条、
`scenarios` ≤ 8 条。超限 → `analysis_result_too_large`，错误里点名**是哪一段超了**，
模型据此压缩而不是盲目重发。

输出：

```json
{
  "analysis_ref": "...",
  "status": "accepted",
  "validation": {
    "status": "pass | warning",
    "issues": []
  }
}
```

- 硬校验失败（§11.4 Tier 1）→ 拒绝持久化，返回具名 issue 列表；
- 警告级 issue → 持久化，`validation.status = "warning"`，artifact `status` 最多 `partial`。

### 10.7 错误码

| code | 含义 |
|---|---|
| `analysis_snapshot_invalid` | refs 非法/不属于本 scope/副本缺失 |
| `analysis_snapshot_expired` | 超过 `expires_at` |
| `analysis_ref_unauthorized` | 调用者 preset 不是 `capital-data-analyst`（`tool-exec` 判） |
| `analysis_module_not_found` | registry 无此 id |
| `analysis_module_not_applicable` | 能力未声明/适用条件不满足/缺必需字段 |
| `analysis_input_invalid` | 输入形状不支持（如 document 当表格、超 16 MiB） |
| `analysis_runtime_not_ready` | 私有 Python runtime 未准备（底层 `python_runtime_unavailable`） |
| `analysis_timeout` | 模块超时 |
| `analysis_cancelled` | 被取消 |
| `analysis_output_invalid` | 结果不满足 schema / 非无损 JSON |
| `analysis_result_too_large` | 提交体积超限 |
| `analysis_validation_failed` | 硬校验未过 |
| `analysis_peer_budget_exhausted` | peer 往返超预算（§5.6） |

> 授权失败复用既有 `dataset_session_mismatch` 语义还是新增 `analysis_ref_unauthorized`，
> 实现时二选一并只留一处；不要两套错误同时出现。
>
> **已选（Phase 1 实现）**：复用 `dataset_session_mismatch`。`analysis_ref_unauthorized` 只留在本表，
> 代码里不出现第二套判据或第二个码。

---

## 11. AnalysisArtifact 最终契约

```json
{
  "analysis_id": "...",
  "task_id": "...",
  "snapshot_id": "...",
  "status": "completed | partial | blocked",
  "evidence_level": "sufficient | limited | insufficient",
  "headline": "...",
  "thesis": "...",
  "support_claims": [],
  "counter_claims": [],
  "alternative_explanations": [],
  "contradictions": [],
  "calculations": [],
  "scenarios": [],
  "invalidation_conditions": [],
  "unresolved_gaps": [],
  "limitations": [],
  "methods_used": [],
  "peer_exchanges": [],
  "validation": {
    "status": "pass | warning | fail",
    "issues": []
  }
}
```

每条 claim：

```json
{
  "claim_id": "...",
  "type": "fact | observation | inference | hypothesis",
  "statement": "...",
  "evidence_refs": [],
  "number_anchors": [],
  "confidence": "low | medium | high",
  "confidence_basis": "...",
  "falsifier": "...",
  "limitations": []
}
```

`number_anchors` 与 `calculations` 的形状（v1 缺定义，v2 定死）：

```json
{
  "value": 0.1823,
  "unit": "ratio",
  "period": "FY2025",
  "source": { "kind": "dataset | profile | evidence | computation", "ref": "ds_... / profile_... / ev_... / calc_..." },
  "precision": 4
}
```

```json
{
  "calculation_id": "calc_...",
  "module_id": "financial_quality",
  "module_version": "1.0.0",
  "metric": "roe",
  "value": 0.1823,
  "unit": "ratio",
  "params_digest": "..."
}
```

### 11.1 硬规则

- 证据不足允许 `insufficient`；`evidence_level = insufficient` 时 `status` 只能是 `partial` / `blocked`；
- `status = completed` 要求 `evidence_level ∈ {sufficient, limited}` 且 `validation.status = "pass"`；
- 不把证据充分度写成胜率；
- 至少一条能推翻主判断的条件（`invalidation_conditions` 非空，且至少一条引用 claim/计算）；
- 不机械给所有维度打分；
- 没有可复现模型不输出概率、目标价或收益承诺；
- 每条 claim 的 `confidence` 必须带 `confidence_basis`（一句话说明依据），否则计警告。

### 11.2 数字溯源算法（宿主确定性校验）

`submit_analysis` 对以下字段做**数值 token 提取**：`headline`、`thesis`、
每条 `support_claims/counter_claims.statement`、每条 `invalidation_conditions`。

对每个 token，按顺序匹配，命中任一即通过：

1. 与某个 `number_anchor.value` 在声明 `precision` 内相等；
2. 等于某个 `calculations[].value`；
3. 等于某个 anchor 的 `value × 100`（百分比与比率互写，容差同 precision）；
4. 属于豁免集：年份（19xx/20xx）、序号/期数（≤ 20 的整数且紧邻"第/期/条"）、
   单位换算常数（如 1e8、1e4）。

未命中 → `number_without_anchor` issue，严重级别按 §11.4 分级。

> 只校验"能提取到的数字"。散文里的定性表述不在范围内——**不要**声称这条校验能证明
> 全文无编造，它只保证"结论里的数字有锚点"。

### 11.3 引用校验

- `evidence_refs` 必须能在 snapshot 的 `evidence[]` 里找到；
- `number_anchors[].source.ref` 必须能在 snapshot 的 datasets/profiles/evidence 或本次
  `calculations[]` 里找到；
- `methods_used[].module_id/version` 必须是 registry 里已登记的版本；
- 任一不满足 → `analysis_validation_failed`。

### 11.4 校验分级（D5）

| 级别 | 触发 | 处置 |
|---|---|---|
| **Tier 1 硬拒** | 结论性字段（`headline`/`thesis`/`support_claims`/`counter_claims`/`invalidation_conditions`）的数字无锚点；refs 不存在；缺 `invalidation_conditions`；缺 `assumptions`/`methodology_log`；schema 不符/非无损 JSON | 不落盘，返回 `analysis_validation_failed` + 具名 issues |
| **Tier 2 警告** | `calculations`/`metrics` 的数字无锚点；`confidence` 缺 basis；`limitations` 为空；scenario 缺假设；peer_exchanges 有未回执项 | 落盘，`validation.status = "warning"`，artifact `status` 最多 `partial` |
| **Tier 3 提示** | 长度/风格建议 | 落盘，计入 issues，不影响状态 |

---

## 12. 宿主校验

### 12.1 运行前

- 调用者是 `capital-data-analyst` preset（`src/tool-exec.ts` 的 `authorizedSession`）；
- refs 属于当前根 session scope 且副本存在；
- snapshot 未过期（`now <= expires_at`）；
- 模块存在、`roles` 含 `senior_analyst`、`capabilities` 覆盖本次需要的读取；
- 参数符合模块 `input_schema`；
- 必需字段覆盖（`required_fields`）；
- Python runtime 在**调用期**可用（不 memoize 装配期探测结果）；
- 模块来源与版本已在 registry 登记。

### 12.2 运行后

- 输出严格满足 `output_schema`，无 `undefined / NaN / Infinity`；
- refs 必须存在于 snapshot；
- 数字溯源按 §11.2 执行；
- 期间、单位、币种、时区一致（跨 Dataset 比对 `time_axis`）；
- 假设非空、methodology log 非空；
- 数据缺口不得被默认值填平（`data_gaps` 与 `metrics` 不得同时声称完整）；
- 大结果不得进入工具返回（`max_output_bytes`，超限只回 ref）。

### 12.3 安全说明

当前 Python 不是 OS sandbox。因此首版：

- 只执行仓库固定模块（registry 白名单，无目录扫描）；
- 运行期清洗环境（`pythonChildEnv`：`-I -B -u`、HOME/TMP 指向 run 目录、剥离 `PYTHON*`/`PIP_*`/`LD_*`/`DYLD_*`）；
- 超时、取消、输出上限、日志上限；
- **不把代码审查/静态扫描称为安全边界**——它们是发布流程，不是运行时能力；
- 模块仍可 `import socket`、可访问网络（现有数据脚本也如此），这一点必须如实写进 README。

真正执行未审查代码前，必须引入容器/VM/远端 runner（Phase 6 的前置条件之一）。

---

## 13. Python 运行时扩展

### 13.1 装配形态：只加一个族行，不加 host 行

v1 提议新增 host-plane 服务行 `capital-analysis`；v2 **取消**。理由：

- 工具只在 senior 一个 preset 里挂，`apply()` 每次挂载一份即可，没有跨 preset 共享状态需求；
- host 行会把工具注册到全局，反而迫使 `ROOT_AGENT_DENIED_TOOLS` 与每个角色 `allowTools` 都改一遍；
- `pythonRuntime` 本来就是 host 服务，preset scope 里 `ctx.get('pythonRuntime')` 可达
  （collector 的 `tools/collect` 行就是这么用的）。

因此：**`package.json` 只加 `exports["./tools/analysis"]`，`cordis.patch.yml` 不动。**

### 13.2 Worker：扩展现有 `python/worker.py`，不新建文件

`python/worker.py` 已有 `probe` / `run` 两个子命令（`run` 执行 run 目录里的固定脚本）。
新增第三个子命令 `analysis`：

- 加载 `<module_dir>/module.py`（由宿主传入绝对路径，模块来自 registry，不接受模型输入）；
- 构造受限 `AnalysisContext`（§8.4）；
- 调用 `analyze(request, context)`；
- 写 `result.json` 与 `outputs/`；
- stdout/stderr 进 `logs/`；
- 不参与控制协议。

**不新建 `python/analysis_worker.py`，也不新建 `python/analysis/worker.py`**——v1 的三处路径
不一致（§13.2 / §15.1）在这里收敛为一处。理由：另起文件会复制 probe/环境/site-packages 引导逻辑。

### 13.3 与 `runDataScript` 的关系

复用（均已核实存在）：

- 私有解释器与 pack 解析（`resolve(['base'])`）；
- `--site-packages` 注入（含 `python/vendor`）；
- `pythonChildEnv` 清洗后的子环境；
- `runWorker` 的超时 / 取消 / 进程树终止（POSIX `kill(-pid)`、Windows `taskkill /T /F`）；
- 固定脚本复制与 `-I -B -u` 启动形状。

不复用：

- **返回 rows 的契约**（`runDataScript` 返回 `{rows,...}`，分析只返回摘要 + ref）；
- **删除 run 目录的生命周期**（`runDataScript` 在 `finally` 里 `rm -rf`，分析 run 必须保留）；
- **数据源脚本目录**（`python/scripts/` 是取数脚本，分析模块在 `python/analysis/modules/`）。

实现落点：在 `src/python-runtime/manager.ts` 新增 `runAnalysisModule(options)`，
与 `runDataScript` 并列、共用 `resolveDataRuntime` / `runWorker` / `pythonChildEnv`；
**不允许**从 `src/analysis/` 直接 spawn（会踩 `test/cross-platform.test.mjs` 的 SPAWN_OWNERS）。

### 13.4 取消语义的已知缺口

现有实现：超时 → SIGTERM 后 2s SIGKILL；**abort（取消）只发 SIGTERM，不升级 SIGKILL**
（`src/python-runtime/probe.ts:62-69`）。分析模块可能比数据脚本更长，因此 `runAnalysisModule`
需要补一条：abort 后 5s 未退出则 SIGKILL（并记录 `killed_hard: true`）。
这是对现有 manager 的小改动，不是新机制。

### 13.5 Phase 6 重新评估可编辑脚本的前置条件

按 D1，只有以下三条同时成立才重新评估"模型可编辑 `analysis.py` + shell"：

1. 固定模块链路在至少一个产品形态端到端验收（含审计与保留期）；
2. 有容器/VM/远端 runner 或明确的"可信本机执行"授权模型；
3. 评测集证明"固定模块 + 参数"确实覆盖不了真实需求（有 bad case 证据，不是感觉）。

三条不成立就继续固定模块路线，不因"看起来更强"而重启。

---

## 14. Persona 与 Skill

### 14.1 Senior Persona

必须包含：

- 角色定位（研究综合与反方验证，不是取数员/写手）；
- 第一条 duty：加载 `capital-senior-analysis`；
- 只接收引用与有界证据；不取数、不检索、不读 rows；
- 模块只选 `module_id` + `params`，不改模块代码；
- 缺数据发 `analysis_data_request` 给 lead（不是直接找 collector/retriever）；
- 补计算可直连 `data-junior`，往返最多 3 次；
- 最终提交 `AnalysisArtifact`，回执带 `peer_exchanges`；
- 叶子边界：不创建子 Agent、不出图。

### 14.2 主 Persona

增加：

- senior 按需路由（不每轮预检）；
- 复用 `senior-analyst`（不新建同角色）；
- 直连通信规则（§5.2 邻接表，主 Agent 仍是范围闸门）；
- `analysis_data_request` 范围闸门；
- senior 未结算时不得写最终结论；
- 需要图时另派 junior 并带 senior 的 method/params 摘要（D3 口径披露）；
- 最终答复仍由主 Agent 写。

### 14.3 其他角色 Persona

- collector：DatasetRef 可直接发 junior / senior / lead；
- retriever：证据可直接发 senior / lead；
- junior：profile/计算可直接发 senior；**不得**通过 senior 扩范围；
- specialist：仍不发消息；
- 所有角色：**新数据/新检索仍回 lead**。

### 14.4 Skill 分册（四册，各自被 duty 点名）

| 分册 | 内容 | 由哪条 duty 点名 |
|---|---|---|
| `capital-senior-analysis` | 总流程、角色边界、直连纪律、提交门 | senior duty 0（第一条） |
| `capital-analysis-evidence` | snapshot、证据状态与缺口、补数请求载荷 | senior duty 2（建 snapshot 前） |
| `capital-analysis-synthesis` | claims、反证、冲突、情景、失效条件 | senior duty 4（综合前） |
| `capital-analysis-validation` | 数字锚点、引用核对、Tier 分级、提交前自检 | senior duty 5（提交前） |

> v1 只点名了第一册，其余三册会退化成"想起来才生效"（`preset-persona.md` §8.2 的判据）。
> 四册必须各自有 duty 行指向；`test/persona.test.mjs` 加断言。

体积：每册 `正文 + 512 ≤ 8192`（渲染包装 512，可见 7680；`test/preset-rows.mjs` 的
`SKILL_RENDER_OVERHEAD`）。正文按 frontmatter 剥离后计。

### 14.5 精选方法路由

`selected-skills/routing.js`：

- `SELECTED_SKILL_ROLES` 增加 `senior_analyst`（执行角色键，现为 main/data_junior/web_retriever 三个）；
- `SELECTED_SKILL_ROLE_ALIASES` 的 `data_analyst` 从 `'data_junior'` 改为 `'senior_analyst'`
  （旧配置继续可用）；
- `SELECTED_SKILL_PRESETS` 增加 senior 项（否则 `test/selected-skill-filter.test.mjs` 的
  "每个执行角色都要有 preset 显示名"必红）；
- `selected-skills/ROUTING.md` 的 70 行角色列同步。

首批分配：

- senior：研究框架、证据综合、估值解释、bear case、thesis validation、财报点评、首次覆盖；
- junior：具体计算、统计、技术指标、筛选、组合计算；
- retriever：文档深读与事实核验；
- main：最终综合与写作。

同一方法只设一个主要执行 owner。

### 14.6 `capital:data-contract` 的角色差异

`src/data-contract.ts` 的静态正文写的是"结构化数据 → 委派 data_collector / 网页 → 委派
web_retriever / 计算 → 委派 data_junior"。senior **没有委派权**，这段对它是错的。

改法：`dataContractSection()` 增加角色参数，senior 变体改为
「你的输入由 `AnalysisSnapshot` 提供；需要新数据 → `analysis_data_request` 给 lead；
需要补计算 → 直连 `data-junior`；不自己访问 URL/API/数据库/终端」。
`test/apply-integration.test.mjs` 的 `capital:data-contract` 断言同步。

---

## 15. 文件与装配变更清单

### 15.1 新增

```text
src/analysis-entry.ts                  # 族行入口：apply() 注册 6 个工具（对应 ./tools/analysis）
src/analysis/
  types.ts
  schemas.ts
  registry.ts
  snapshot.ts
  runtime.ts                           # 只调用 pythonRuntime.runAnalysisModule，不直接 spawn
  tools.ts
  validation.ts
  storage.ts
  data-contract.ts                     # read_dataset/profile/evidence 契约（§8.5）

python/analysis/modules/financial_quality/
  module.json
  module.py
  LICENSE
  fixtures/

preset/capital-generation/skills/
  capital-senior-analysis/SKILL.md
  capital-analysis-evidence/SKILL.md
  capital-analysis-synthesis/SKILL.md
  capital-analysis-validation/SKILL.md

docs/dev/senior-analysis.md            # 新 §1.9：senior 边界 + 直连语义（拆册方案见 §16）

test/analysis-protocol.test.mjs
test/analysis-runtime.test.mjs
test/analysis-tools.test.mjs
test/analysis-validation.test.mjs
test/analysis-modules.test.mjs
test/senior-analyst.test.mjs
```

> 入口命名按仓库约定：族行入口是 `src/<family>-entry.ts` 平铺（16 个先例），
> `package.json` 加 `exports["./tools/analysis"] → ./lib/analysis-entry.js`。
> **不加** host 行、不加 `./analysis` 导出（§13.1）。

### 15.2 修改

**装配与授权**

- `preset/capital-generation/agent.patch.yml`（角色 preset 行、委派行、工具行、`disabled` 状态）
- `package.json`（`exports["./tools/analysis"]`；`files` 已含 `python`，无需改）
- `src/preset-ids.ts`（`INTERNAL_ROLE_PRESET_IDS` + analyst；`DATASET_READING_PRESET_IDS` − analyst；
  `ANALYSIS_PRESET_IDS` 新增）
- `src/tool-exec.ts`（分析工具授权接入 `authorizedSession`，不新写判据）
- `src/agents/messaging-policy.ts`（`ROLE_MESSAGE_TARGETS` 改为 §5.2 邻接表；拒语改写）
- `src/agents/role-tool-policy.ts`（analyst 的 `allowTools`；analyst 的 `denySiblings` 追加 `wait_agent`，
  不动 `SIBLING_DENIED_TOOLS` 共享常量）
- `src/agents/selected-skills-provider.ts`（角色键与 preset 映射）
- `src/data-contract.ts`（§14.6 角色变体）
- `src/python-runtime/manager.ts`（`runAnalysisModule` + abort 升级 SIGKILL）
- `python/worker.py`（`analysis` 子命令 + 文档串）
- `selected-skills/routing.js` + `selected-skills/ROUTING.md`（§14.5）
- `src/index.ts`（仅单体载体需要；host 行方案已取消）
- `src/runtime.ts`（仅在需要跨 preset 共享时；预计不需要）

**测试**

- `test/family-rows.mjs`（`CAPITAL_ROW_TOOLS` 加 `tools/analysis` 六颗）
- `test/family-entries.test.mjs`（`ENTRIES`/`APPLIERS` 加入口；`DATASET_READING_PRESET_IDS` 双向断言）
- `test/persona.test.mjs`（§3.3 五处 + 四册 duty 断言 + 角色键映射表）
- `test/messaging-policy.test.mjs`（邻接表全矩阵：允许边放行、禁止边拒绝）
- `test/role-tool-policy.test.mjs`（analyst 面 + `wait_agent` deny）
- `test/session-identity.test.mjs`（第 4 个授权入口的对等断言）
- `test/preset-roster.test.mjs`（D6 内部角色）
- `test/selected-skill-routing.test.mjs`（角色键、70 行表、计数）
- `test/selected-skills-provider.test.mjs`（`data_analyst → senior_analyst` 别名）
- `test/selected-skill-filter.test.mjs` / `test/capital-config.test.mjs`（pill 名称/数量）
- `test/packaging.test.mjs`（分析模块、LICENSE、`THIRD_PARTY_NOTICES.md` 进包；fixtures 不进包）
- `test/cross-platform.test.mjs`（`runAnalysisModule` 的 spawn 形状纳入 SPAWN_OWNERS）
- `test/dev-docs.test.mjs`（新增 `docs/dev/senior-analysis.md` 的 §1.9 与 AGENTS.md 索引行）
- `test/readme-prose.test.mjs`（README 角色叙事）

**文档**

- 腾位与拆册方案见 §16；`AGENTS.md` 本身只加 §0 索引行、改 §1 一句话版
- `docs/dev/data-roles.md`（§1.1 analyst 条、§1.4 中继边界、§1.8 角色树）
- `docs/dev/senior-analysis.md`（新增，§1.9）
- `docs/dev/preset-persona.md`（§8.4 恢复前置条件、§8.5 七处齐改）
- `docs/dev/selected-skill-index.md`（§8.7 角色表）
- `docs/dev/selected-skills.md`（角色注册段）
- `docs/dev/bash-gate.md`（补一句：senior 无 shell，`capital-analysis/runs/` 的写权限由分析族行承担）
- `docs/agent-roles.md`（角色表）
- `docs/design/data-analyst-architecture.md`（顶部加取代声明，指向本文件 §0.1）
- `docs/design/python-runtime.md`（`analysis` 子命令、run 目录保留语义）
- `preset/capital-generation/README.md`
- `README.md`（角色叙事与"五个角色"计数）
- `THIRD_PARTY_NOTICES.md`（P0 模块来源与 LICENSE）
- `scripts/skill-usage-report.mjs`（preset→role 映射与中文标签）
- 引用「`data_analyst` 未启用」的 4 个任务 skill：
  `capital-event-impact`、`capital-data-query`、`capital-equity-research`、`capital-portfolio-review`

### 15.3 发布包边界

- `package.json` 的 `files` 已含整个 `python/`，模块自动随包；**但 `fixtures/` 必须排除**
  （golden case 可能含真实行情数据，会把包撑大且有数据合规问题）：
  在 `python/analysis/modules/*/fixtures/` 加 `.npmignore`，并在 `test/packaging.test.mjs`
  加"fixtures 不在 tarball"的反向断言。
- `LICENSE` 必须进包（MIT 要求保留版权声明），由 `packaging.test.mjs` 逐模块断言。

---

## 16. 文档预算与拆分方案（M7）

现状：`AGENTS.md` 只剩 18 字节；`data-roles.md` / `tool-schema.md` / `automation.md` 已顶 150 行。
按 §15.2 直接"往 data-roles.md 加一段"会先撞闸门。

**方案**：

1. 新增 `docs/dev/senior-analysis.md`，承载 §1.9（senior 边界 + §5 直连语义的维护者细节）。
   `data-roles.md` 的 §1.1 analyst 条压缩为一句 + 指针（净减 ~6 行），§1.8 角色树改一行。
2. `AGENTS.md` §1 表格加一行 `| senior 边界、直连邻接表 | docs/dev/senior-analysis.md（§1.9）|`
   （约 +90 字节）。腾位：把 §4「web_retriever 纪律」的 5 行压成 2 行（正文已在
   `web-retriever.md`），净腾 ~150 字节。
3. `AGENTS.md` §1 一句话版与 §0 硬约束条目改写（直连规则），字数与原文持平。
4. 若仍超：`AGENTS.md` §2 的项目结构树删掉 `vendor/`、`assets/` 两行（约 40 字节）。

**执行顺序**：先改 `docs/dev`（不占 AGENTS.md），再腾位、最后改 AGENTS.md；
每步跑 `node --test test/dev-docs.test.mjs`。

---

## 17. 分阶段开发任务

> v1 的阶段顺序把"直连"放在 senior 存在之前（Phase 1 就要测 retriever→senior），
> 无法验收。v2 改为：**先让 senior 在纯中继下跑通，再开直连**。

### Phase 0：契约与身份（不启用 senior）

1. 定义 AnalysisSnapshot / AnalysisArtifact / module manifest / worker 协议 schema。
2. 身份迁移：preset 改名（`config.id` 保留）、`INTERNAL_ROLE_PRESET_IDS`、selected-skills 角色键。
3. 新增 `src/analysis-entry.ts` 骨架 + `package.json` 导出 + `family-rows` / `family-entries` 登记。
4. 文档拆分与索引腾位（§16）；`AGENTS.md` 只加 §0 索引行、改 §1 一句话版。

**验收**：旧会话仍能解析；`agentPresets.resolve()` 无 broken（`smoke:boot`）；身份/行契约测试全绿。

### Phase 1：分析核心（senior 可跑，但只经中继）

1. `create_analysis_snapshot` / `read_profile` / `list/describe_analysis_module` / `submit_analysis`。
2. `runAnalysisModule` + `worker.py analysis` 子命令 + 取消升级。
3. 宿主校验（§12）与 artifact 持久化 + 保留期标记。
4. 授权接入 `tool-exec.ts`。

**验收**：无 runtime 时响亮失败（`analysis_runtime_not_ready`）；有 runtime 时能跑一个 hello 模块；
输出严格符合 schema；硬校验能拒。

> **进度（2026-11-24）**：已实现并全绿——`src/analysis/{storage,snapshot,registry,validation,runtime,tools}.ts`、
> `python/worker.py analysis`、`python/analysis/modules/hello/`、`manager.runAnalysisModule`（取消升级为
> SIGTERM→5s→SIGKILL）、`probe.ts` 的 abort 升级。测试：`test/analysis-{protocol,runtime,tools}.test.mjs`。

### Phase 2：首个模块端到端（D4）

1. 迁移并适配 `financial_quality` + fixtures + golden case + LICENSE + provenance。
2. 走通"snapshot → run → artifact → 校验 → 落盘"全链路，含全部失败路径
   （缺数据、NaN、超时、schema 不符、数字无来源、体积超限）。
3. 保留期与存储统计（`automation/storage.js` 已有类别）。**已定（2026-11-24）**：`runs/` 计入统计
   （`analysis.categories.runs`），但**不提供删除入口**——清理只作用于 `capital-data`，分析产物靠逻辑过期。

**验收**：模块结果可复算；缺数据不伪造；假设与 methodology log 完整；审计两件套（artifact/run）齐全。

> **进度（2026-11-24）**：已实现并全绿——`python/analysis/modules/financial_quality/`（manifest + 公式 + LICENSE +
> 5 组 fixtures：`normal` / `a_share_series` / `boundary` / `missing_income` / `document`）、golden 由 fixture 数值
> **手算**后冻结、`outputs/ratios.json` 记每个指标的公式与输入值（可逐项复算）。口径：三张报表是三份 Dataset，
> 按列签名识别 + `period_end_ms`/`period` 对齐，不要求预拼宽表；缺报表/缺列/分母无经济含义写 `data_gaps`
> （指标缺席、不写 0），缺利润表 `blocked`，其余有缺口最多 `partial`。
> 宿主侧新增两处硬校验：模块结果的 `assumptions`/`methodology_log` 必须非空（§12.2）；`submit_analysis` 先按
> artifact schema 校验（§11.4 "schema 不符" 落到实现）。模块可在异常上声明 `analysis_code`，worker 透传、
> runtime 只认已知码（`analysis_input_invalid` 不再降级成 `analysis_output_invalid`）。失败路径覆盖：缺数据、
> NaN/非无损、schema 不符（未知字段）、体积超限（输出与 artifact 两条）、超时、文档型输入、模块声明错误码。
> 测试：`test/analysis-modules.test.mjs`、`test/analysis-validation.test.mjs`、`test/analysis-tools.test.mjs`（全链路
> 建快照 → 跑模块 → 提交 artifact，Tier 1 拒后不覆盖已落盘产物）；`test/packaging.test.mjs` 按 registry 断言
> 每模块 `module.json`/entrypoint/`LICENSE` 进包、`fixtures/` 不进包（`fixtures/.npmignore`）。

### Phase 3：启用 senior（纯中继）

1. 完成 senior persona + 四册 skill + 主 persona 路由；`role-tool-policy` 给 analyst 加
   `wait_agent` 的 deny（Phase 0 只登记了工具面，这条还没落）。
2. 启用 preset 与委派行（`disabled` 去掉），保持 `ROLE_MESSAGE_TARGETS` 仍为全中继。
3. 真实 DSH 会话冒烟（手工，见 §18.1）。

**验收**：完整任务能从取数 → profile/evidence → senior → AnalysisArtifact → 主 Agent 最终答复跑通，
且**所有消息都经 lead**。

> **进度（2026-11-24）**：已实现并全绿——senior preset 与委派行去掉 `disabled`（preset id 仍
> `capital-data-analyst`，`order: 7`，内部角色不进 picker）；persona 重写为每轮硬规则（role 边界、
> 6 条 duty、全中继消息、时间与安全），正文 1.1 KB；四册 skill 全部落地并由 duty 点名
> （`capital-senior-analysis` / `-analysis-evidence` / `-analysis-synthesis` / `-analysis-validation`，
> 正文 4.0/3.6/3.7/3.6 KB，均 ≤7680 可见上限）。主 persona 加「结论层复核 → senior_analyst」路由、
> 四颗专用工具计数、四兄弟全中继、「未收到 analysis_result 不写结论」；三个任务 skill 与
> `capital-orchestration` 的路由表把「senior 未启用」改成实际派发。`role-tool-policy` 给 analyst 单独
> deny `wait_agent`（`ANALYST_DENIED_TOOLS`，不动 junior 的 barrier），`capital:data-contract` 增加
> senior 变体（快照口径，不写委派取数）。验证：`npm test` 1780 全绿、`smoke:boot` 13 行可解析、
> `check:dsh` 40/40。启用后在真实 boot 上抓到一处 Phase 0–2 漏网的硬伤：`tools/analysis` 的工具
> schema 用了 `anyOf` / `maxItems` / `maxLength`，不在宿主强制子集内 → 整族行注册失败、角色 preset
> broken（禁用期从不激活，所以测试全绿）。已改成 `oneOf` 并把条数/长度预算落进 `validateArtifact`
> 代码检查，`test/analysis-tools.test.mjs` 加关键字扫描；复测 `smoke:boot` exit 0、`rolePresets[].broken`
> 全 null、`problems: []`。**真实 DSH 会话冒烟是手工步骤**（§18.1），未接进 CI。
>
> **真实会话实测（2026-11-24，手工脚本驱动）**：用 scratch `DSH_HOME` + 本仓插件 + 内嵌探针
> （`sessionController.create({agentPreset:'capital-generation'})` → `resolveAgent` → `prompt`）在真实 web
> profile 里跑了一次完整任务（600519.SH 2024 财务质量）。**跑通的链**：lead 先 `list_agents` → 建
> `data_collector`（9 份 Dataset：利润表/资产负债表/现金流量表各两期 + indicators，`data_collection_completed`）
> → `data_junior` 20 次 `run_code` 做 profile 并按 gate 出了 3 张图（`data-junior/chart-1..3`）；再建
> `senior-analyst`，它**依次加载四册**（skill×4）、`list_analysis_modules` / `describe_analysis_module`、
> `read_profile`、`create_analysis_snapshot`、`run_analysis`、`submit_analysis`；全程消息经 lead（无直连）。
> **实测抓到三件事**：① fuyao A 股三表的 `period` 列是常量 `annual`，模块把它当报告期标签 → 所有报告期同名、
> `period` 参数不可用（senior 连试 11 种写法全被拒）；② 运行时缺 base pack 时 `data-runtime-not-ready` 未映射，
> `analysis_runtime_not_ready` 降级成 `analysis_output_invalid`；③ `dsh headless` 一次性 runner **不组合
> agent preset**（源码明说），真实角色冒烟只能走 web profile。①② 已修：标签改为「文本列能一一对应才用文本，
> 否则用 `period_end_ms` 的日期」，`period` 额外认 `fiscal_year` / `fiscal_year-FY`；新增 `a_share_annual`
> fixture 与两条回归（含 `analysis_runtime_not_ready` 映射）。另：本次模型走 `holysheep-ant/deepseek-v4.1-flash`
> ——机器上钉的 `opencode-go` 免费路由拿不到 `OPENCODE_GO_API_KEY`，`DEEPSEEK_API_KEY` 返回 402 余额不足。
> **未做**：精选方法的角色拆分（senior 暂共用 data_junior 方法集，`selected-skill-index.md` §8.7 已记
> 原因与去处）。

### Phase 4：开直连（D2）

1. `ROLE_MESSAGE_TARGETS` 改为 §5.2 邻接表；拒语与 persona 同步。
2. 实现 §5.6 的收尾四条（`peer_exchanges`、预算、`waiting_peer`、唤醒噪声说明）。
3. 回归：允许边放行、禁止边拒绝、兄弟不能 interrupt、Dataset scope 正常。

**验收**：§18.2 #4/#5/#6；直连下收尾不多轮、不少结论。

### Phase 5：模块扩展

1. `returns_risk` + `scenario_sensitivity`（覆盖序列与假设网格两种形状）。
2. 其余 P1 模块按需。

**验收**：三种输入形状都验证过；每颗模块的 fixtures/golden/provenance 齐全。

### Phase 6：加固与评估

1. 评测集固定与逐案 pass/fail（D8）。
2. 性能与成本观测（不设硬上限，先取数）。
3. 重新评估 D1 的可编辑脚本路径（§13.5）。
4. 文档与发布。

---

## 18. 测试与验收

### 18.1 必跑门禁（区分"已有脚本"与"手工步骤"）

| 门禁 | 实际是什么 | 怎么跑 |
|---|---|---|
| `agentPresets.resolve()` 无 broken | **已有脚本**（boot 冒烟，非单测） | `npm run smoke:boot` |
| `npm test` 全绿 | 已有 | `npm test` |
| `npm run check:dsh` | 已有（CI 仅 ubuntu） | `npm run check:dsh` |
| `npm pack --dry-run` 含模块与 LICENSE、不含 fixtures | 已有（`test/packaging.test.mjs` 在 `npm test` 内） | `npm test` |
| 子进程形状 | **静态检查**（`test/cross-platform.test.mjs`），CI 只有 ubuntu + windows | `npm test` |
| 真实 DSH 会话冒烟 | **手工步骤**（仓库无自动化） | 按 `CONTRIBUTING.md` 开真会话 |
| macOS 真机 | **无 CI runner**，只在发版前手工验 | 手工 |

> v1 把"macOS 子进程形状"与"真实会话冒烟"写成"必跑门禁"，实际都不存在自动化。
> 门禁清单必须如实，否则实现者会以为 CI 已经覆盖。

### 18.2 行为验收

1. 主 Agent 能创建并复用 `senior-analyst`。
2. senior 只看到预期工具面（§6.1 精确清单，含 `wait_agent` 被拒）。
3. senior 不能直接取数、检索、出图或创建子 Agent。
4. §5.2 邻接表的每条允许边成功、每条禁止边被拒。
5. senior 发新数据请求必须经 lead；补计算可直连 junior，且超过 3 次被拒。
6. 原始 rows 不出现在 senior 上下文或工具返回。
7. 输入/模块/参数任一变化 → `run_fingerprint` 不同 → 不复用；snapshot 过期 → `analysis_snapshot_expired`。
8. 模块输出缺字段、多字段、NaN 时拒绝。
9. runtime 未安装时返回 `analysis_runtime_not_ready`。
10. 超时与取消能收敛进程树（取消 5s 未退 → SIGKILL）。
11. `submit_analysis` 拒绝无来源数字（Tier 1）与缺失失效条件；Tier 2 落盘但降级。
12. 主 Agent 最终答复自足，不写"结论见上"。

### 18.3 评测集（D8）

首批固定案例（7 个）：

- A 股单公司财报质量与估值；
- A 股重大事件影响；
- 美股 10-K 财务质量；
- ETF/股票收益风险特征；
- 证据不足场景；
- 数据期间冲突场景；
- 估值假设冲突场景。

判定方式：**逐案人工 pass/fail**，每案一张检查表（结论是否有锚点、缺口是否点名、
失效条件是否可推翻、是否越权取数）。不做百分比阈值；指标（无来源数字率、evidence ref 覆盖率、
缺口识别率、冲突识别率、假设披露完整率、运行时间与 token 成本）只作**趋势记录**。

**不得用投资收益证明 Analyst 质量。**

---

## 19. 回滚策略

- 开发期 senior preset 与委派行保持 `disabled: true`；Phase 3 起才启用。
- 出问题时禁用 senior 委派行即可回滚，不影响 collector/junior/retriever。
- 直连可单独回滚：`ROLE_MESSAGE_TARGETS` 改回全中继，不动工具面。
- `tools/analysis` 族行可单独摘掉（角色少一族工具，不崩）。
- 不删除旧 `capital-data-analyst` preset id。
- 不引入不可逆数据迁移；`capital-analysis/runs/` 保留供审计。

---

## 20. 默认决策汇总

后续 Agent 无额外决策时按以下执行：

1. senior 是根直系叶子角色，不创建子 Agent。
2. 显示名/语义键改 senior，preset id 保留 `capital-data-analyst`；内部角色不进 picker。
3. 首版固定审查模块；可编辑 `analysis.py` 延期到 Phase 6（§13.5 三条前置）。
4. 广域直连按 §5.2 邻接表；新取数/新检索仍只经 lead；peer 往返 ≤ 3 次。
5. senior 不挂 Dataset 工具，只通过分析工具消费 refs；授权走 `tool-exec.ts`。
6. 分析模块只允许仓库内审查版本，静态 registry，不扫目录。
7. Python 模块采用 manifest + `analyze(request, context)` 鸭子协议；`read_dataset` 契约见 §8.5。
8. 工具返回只给 ref 与小摘要，原始 rows 不进模型。
9. 分析产物落 `capital-analysis/runs/<analysis_id>/`，保留期见 §7.5。
10. 主 Agent 仍是唯一最终写作者；senior 未结算不得写结论。
11. 不恢复报告文件通道、HTML 报告或自定义会话事件。
12. 证据不足允许 partial/blocked/insufficient；提交校验分级（§11.4）。
13. 首版不出图（D3）；需要图时 lead 另派 junior 并披露口径差异。

---

## 21. Handoff 工作包建议

| 工作包 | 负责内容 | 依赖 |
|---|---|---|
| WP1 | preset 身份迁移、`INTERNAL_ROLE_PRESET_IDS`、selected-skills 角色键、文档拆分 | 无 |
| WP2 | `src/analysis-entry.ts` 骨架、package 导出、family-rows/entries 登记 | 无 |
| WP3 | 分析协议、schema、registry、snapshot、artifact、`read_dataset` 契约 | WP2 |
| WP4 | `runAnalysisModule` + `worker.py analysis` + 取消升级 | WP3 |
| WP5 | `financial_quality` 模块 + fixtures + golden + LICENSE | WP3、WP4 |
| WP6 | 分析工具与 senior 工具面、授权接入 | WP3、WP4 |
| WP7 | senior persona + 四册 skill + 主 persona 路由 | WP1 |
| WP8 | 直连邻接表 + 收尾四条（Phase 4） | WP6、WP7 |
| WP9 | 集成测试、真实会话评测、发布 | 全部 |

**顺序**：WP1/WP2 并行 → WP3 → WP4 → WP5/WP6 并行 → WP7 → Phase 3 验收 → WP8 → WP9。
