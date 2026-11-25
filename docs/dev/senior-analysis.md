# senior_analyst 边界与直连语义（详情）

> 索引见仓库根 `AGENTS.md` §1。改 `capital-data-analyst` preset、`src/analysis/`、`python/analysis/`
> 或角色间消息边之前读这里。§编号沿用 `AGENTS.md` 的全局命名空间。

## 1.9 `senior_analyst` 边界与直连语义

**状态（Phase 4 完成）**：`tools/analysis` 六颗工具、宿主校验与产物落盘可用；`hello`（环境自检）与
`financial_quality`（首个真实模块，三张报表按报告期对齐）都跑通，golden case 由手算冻结；senior preset 与
委派行已启用，主 persona 按需路由，四册 skill 各有 duty 点名。直连已按邻接表开启，收尾四条同时生效。

### 身份：四个层各一个值，不许互相替代

| 层 | 值 | 落点 |
|---|---|---|
| 卡片显示名 | 高级分析师 | preset `config.name`（内部角色，不进选择器） |
| 角色语义键 | `senior_analyst` | 模块 manifest `roles`、精选方法路由 |
| 树内名字 | `senior-analyst` | 主 persona 固定的 `name`，`send_message` 目标 |
| preset id | `capital-data-analyst` | `config.id` = 会话日志身份，**不能改** |

`config.id` 已写进历史会话，改名后旧会话 `agent-preset/not-found`；旧语义键 `data_analyst` 只作精选方法路由的兼容别名。`test/persona.test.mjs` 把这张表钉死。

### 工具面（叶子，无子 Agent）

`tools/analysis`（六颗）+ `tools/time` + `skill` + `send_message`。**不挂** `tools/dataset-read`：
senior 只消费 ref、不读 rows。调用级另外 deny `interrupt_agent` / `list_agents` / `wait_agent`
——三者由 `tool-subagent-control` 行焊进来，只能 deny 不能 restrict；`wait_agent` **只加在 senior
的角色面上**（data_junior 有出图子 Agent，共享常量一起禁会拆掉它的 barrier）。
`wait_agent` 的 deny 只加在 senior 的角色面上（Phase 3 落地，`ANALYST_DENIED_TOOLS`），别并进
`SIBLING_DENIED_TOOLS`；「何时派 senior」的文案在主 persona 路由段。

### 直连（D2）：邻接表就是全部允许边

下表就是 `src/agents/messaging-policy.ts` 的实际允许边（`ROLE_MESSAGE_TARGETS`）；表外目标由调用级
guard 拒绝，能力上仍可互发——**这是路由纪律不是安全边界**。

| 发送方 | 允许目标 |
|---|---|
| lead | 仅直系子 Agent |
| data-collector | data-junior、senior-analyst、lead |
| data-junior | senior-analyst、lead |
| web-retriever | senior-analyst、lead |
| senior-analyst | data-junior、lead |
| visualization-specialist | 无 |

唯一保留的闸门：senior **不得**直接向 collector / retriever 要新数据或新检索，范围仍在 lead；
对 junior 只能请求"用已有 Dataset/profile 做计算"。

- **闸门看字符串，不是边界**：`tools.guard` 同步、读不到 `resolveName` 结果，而 `send_message`
  把任意非斜杠串当 session id 透传，已知深孙的 session id 与直系名在形状上不可区分。所以这是
  路由纪律（防误发），不要写成安全边界。
- **信封没有宿主校验**：`send_message` 只判目标、不解析 `message` 正文；`protocol` 信封是模型侧
  约定，真正需要确定性保证的 refs / 数字 / 状态必须走工具返回值。
- **收尾四条**（缺一条就多轮或少结论）：① peer 往返进 `analysis_result.peer_exchanges[]`，
  `answered:false` 时写 `completed` 是 Tier 1 硬拒；② 同一 task 的补计算往返 ≤ 3 次：发送侧 guard 按
  senior 会话计出向 peer 次数（第 4 次直接拒），`submit_analysis` 再按 `task_id` 查记录，超 3 条抛
  `analysis_peer_budget_exhausted`；③ 对账表新增 `waiting_peer` 行（`capital-orchestration` §4/§6.1/§7），
  空闲等 peer ≠ 完成，只有 lead 收到最终回执才可记完成；④ `src/agents/settled-wake.ts` 的 admit 只认向根
  投递过 relay 的子 Agent，只跟 peer 通信的可能多唤醒一个空轮——**是噪声不是数据丢失**，首版接受。

> ⛔ **工具 schema 只能写宿主的 JSON Schema 子集**（`dsh-tools`：`type` / `oneOf` / `properties` /
> `required` / `additionalProperties` / `items` / `enum` / `const` + 注解）。写 `anyOf`、`maxItems`、
> `maxLength` 不会报在测试里，而是**整族行注册失败、角色 preset 在 boot 期 broken**（2026-11-24 启用
> senior preset 时正好踩到：6 颗工具全挂）。预算/条数上限因此写在 `validateArtifact` 的代码检查里；
> `test/analysis-tools.test.mjs` 逐定义扫关键字。

### 四册 skill（每册都被一条 duty 点名）

| 分册 | 管什么 | 点名它的 duty |
|---|---|---|
| `capital-senior-analysis` | 总流程、工具地图、失败处置 | duty 0 |
| `capital-analysis-evidence` | 快照输入、缺口分类、补数请求 | duty 1 |
| `capital-analysis-synthesis` | claims、反证、冲突、情景、失效条件 | duty 3 |
| `capital-analysis-validation` | 数字锚点、引用、Tier 分级、体积预算 | duty 4 |

每册正文 ≤7680（`正文 + 512 ≤ 8192` 剪枝阈值）；只点名不加载等于规则永不生效，
`test/persona.test.mjs` 逐册钉住"文件存在 + duty 点名 + 体积"。persona 只放每轮硬规则，细则全在册子里。

### 产物布局与保留期

```text
capital-analysis/runs/<analysis_id>/
  snapshot.json  run.json  artifact.json
  inputs/{datasets,profiles,evidence}/     # 宿主授权副本，只供固定 worker 读
  modules/<module_run_id>/{request,result}.json + outputs/ + logs/
```

- `snapshot.json` 只存引用、覆盖范围、限制与 `input_fingerprint`，**不存原始 rows**。
- 两层指纹：`input_fingerprint`（建快照时算）与 `run_fingerprint`（再加模块版本 + 参数摘要）；
  同快照内同 `run_fingerprint` 可复用，**跨快照不复用**。
- `expires_at = min(创建 + 7d, 最早输入保留期)`；过期后 `inputs/` 不再被读取，`artifact.json` /
  `run.json` 长期保留（审计与复算靠这两份摘要，不靠副本）。**过期是逻辑失效，不删任何文件**。
- 复用：`run.json` 是本次分析的 run 索引（每行带 `run_fingerprint`）；同快照内同指纹的已完成 run
  直接复用，不重复起进程。`result.json` 同时记录 python 版本与耗时。
- **纳入存储统计、不提供删除**：`capital-analysis/runs/` 计入设置卡片「分析结果 → 分析产物」
  （`automation/storage.js` 的 `analysis.categories.runs`），但「清除数据缓存」只作用于 `capital-data`。
  **不要给分析产物加删除按钮或清理 API**——保留期是逻辑过期（`expires_at`），审计要能一直读到
  `artifact.json` / `run.json`；`test/automation-storage.test.mjs` 钉住了这条（服务面只允许 `stats` / `clear`）。
- `capital-analysis/runs/` 在族行首次写入时按需创建；此前只是存储统计里的预留类别。

### 模块协议要点

- 静态 registry（`src/analysis/registry.ts` 的 id 白名单），不扫目录；只跑仓库内审查过的模块
  （`python/analysis/modules/<id>/`，manifest 住 `module.json`）。当前登记 `hello`（环境自检，不产出结论）、
  `financial_quality`（三表比率）、`returns_risk`（价格序列收益 / 风险）、`scenario_sensitivity`（假设网格求值）。
- `financial_quality` 吃**三份 Dataset**（利润表 / 资产负债表 / 现金流量表），按列签名识别、按
  `period_end_ms`（缺则 `period`）对齐；**不要求先拼宽表**——没有任何入口能产出宽表。缺报表、缺列、
  分母无经济含义（负净资产、零利息、净利 ≤ 0）一律写 `data_gaps`，对应指标缺席而不是写 0；缺整张利润表
  时 `status=blocked`，其余有缺口的情况最多 `partial`。`returns_risk` 吃价格序列（可选基准）、`scenario_sensitivity` 只吃参数（显式恒等式 + 网格 / 情景，不读 Dataset）：横截面 / 序列 / 假设网格三种形状各一颗。
- 报告期标签取报告期键（`period_end_ms` → 日期），**不取数据源的 `period` 列**：fuyao A 股三表那列实测是常量
  `"annual"`，当成标签会让所有报告期同名、`period` 参数不可用（2026-11-24 真实会话踩到，11 次重试全被拒）。
- 每颗模块的 `fixtures/`（正常 / 边界 / 失败 + **手算** golden）随仓库、**不进发布包**（`fixtures/.npmignore`）；
  `test/packaging.test.mjs` 按 registry 逐模块断言 `module.json` / entrypoint / `LICENSE` 进包、`fixtures/` 不进包。
- manifest 的 `capabilities` 是**强制白名单**：未声明 `dataset.read` 就不能 `context.read_dataset`。
- `read_dataset` 的行数组位置由 Dataset manifest 的 `row_key` 决定（同 §1.5）；超 `max_input_rows` 置
  `truncated=true`，模块必须写进 limitations；document 型 Dataset 在建快照时就被拒
  （`analysis_input_invalid`），走不到模块里。
- 结果必须无损 JSON（无 `undefined` / `NaN` / 空洞）、未知字段拒绝、大输出只进 `outputs/`；`assumptions` 与
  `methodology_log` 必须非空（宿主硬校验：缺了不可复算）。
- 模块可以在异常上声明 `analysis_code`（如 `analysis_input_invalid`）：worker 透传 → `manager` 带出 → `runtime`
  只认 `ANALYSIS_ERROR_CODES` 里的码。没声明的异常一律 `MODULE_ERROR` → `analysis_output_invalid`；模块不能
  借这条冒充宿主侧失败。
- 可复算：模块把每个指标的公式与输入值写进 `outputs/<name>.json`，`result.json` 记 Python 版本与耗时；评测集与观测口径见 `docs/design/senior-analyst-eval.md`（Phase 6 / D8）。
- **"不提供"不等于"不可能"**：Python 进程内仍可 `import socket`；首版的真实控制是随包发布 +
  代码审查 + registry 白名单，不是运行时拦截，别写成安全边界。

### 校验分级

- **Tier 1 硬拒**（不落盘）：结论性字段的数字无锚点（按显示精度四舍五入匹配；证券代码与结构性计数豁免）、
  refs 不存在、缺失效条件、schema 不符或非无损 JSON。
  `submit_analysis` 先按 artifact schema 校验（未知字段、每侧 claims > 20、场景 > 8 都算 schema 不符），
  再跑语义分级；体积 > 30000 字符单独报 `analysis_result_too_large` 并点名超的是哪一段。
- **Tier 2 警告**（落盘但 `validation.status = "warning"`，artifact 最多 `partial`）：`metrics` /
  `calculations` 的数字无锚点、`confidence` 缺 basis、`limitations` 为空、peer 有未回执项。
- **Tier 3** 只计数，不改状态。
- 数字溯源只保证"结论里的数字有锚点"，**不要**声称能证明全文无编造。

### 授权与错误码（实现口径）

- 六颗工具一律走 `src/tool-exec.ts` 的 `authorizedSession(..., ANALYSIS_PRESET_IDS)`：**没有第二份判据**。
- 授权失败的 code 复用既有 `dataset_session_mismatch`（不新增 `analysis_ref_unauthorized`，避免两套错误
  并存）；其余失败用 `analysis_*` 稳定码。
- `analysis_not_implemented` 只是 Phase 0 占位，Phase 1 起不再出现。
- 并发：全局最多 2 个分析进程；同一快照串行（并发会让 `run.json` 索引互相覆盖）。
- 取消：abort 先 SIGTERM，5s 未退再 SIGKILL（`src/python-runtime/probe.ts`）。

### 回滚

preset 与委派行保持 `disabled` 即可回滚；直连单独回滚 = 把 `ROLE_MESSAGE_TARGETS` 每个角色改回只留
`lead`（peer 预算表可留着，不再触发），不动工具面；`tools/analysis` 族行可单独摘掉（角色少一族工具，不崩）。不删旧 preset id。
