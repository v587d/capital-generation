# CapGen 投研自动化设计（v0.4）

> 状态：Phase 1 已实现（含工作区选择；条件触发器、跨运行上下文等仍在延期清单）
> 入口：CapGen 投研自动化
> 目标：在保留 DSH 官方「自动化任务」的前提下，为 Capital Generation 增加独立的定时投研任务能力。
> 运行时：DSH 0.2.1；当前实现以 `profileContext` 为 profile 来源。

---

## 0. 修订结论

v0.3 的入口替换方案取消。Capital 不关闭、不覆盖、不复用 DSH 官方 `ui-schedule` 的任何身份或 slot。

页面关系固定为：

```text
自动化任务          DSH 官方 schedule，保持原功能
CapGen 投研自动化   Capital 自有任务、运行记录和通知
```

DSH 侧栏目前是平级 panel 列表，没有可依赖的父子菜单契约。因此「在自动化任务下面」实现为紧邻官方入口的平级菜单；真正的嵌套菜单需要 DSH 提供新的导航接口，不纳入本方案假设。

v0.4 的实现范围收缩为：

- 定时任务；
- 手动运行；
- 内置任务模板；
- 运行状态、错误和取消；
- 当前 profile 隔离；
- 单 scheduler owner 和 occurrence 幂等；
- 独立页面与 API。

以下内容延期：

- 条件指标构建器和任意条件表达式；
- 跨运行 session 上下文继承；
- watchdog 补跑；
- 任意 preset、任意 projectRoot；
- 邮件、微信等外部通知；
- 任务导入导出。

### 0.1 事实、设计与待验证边界

**当前可依赖的 DSH 事实：**

- 当前 profile 可从 `ctx.profileContext` 读取；
- 官方 `ui-schedule` 和 `schedule` 服务继续由宿主维护；
- 自有 HTTP 路由必须调用 `connection.requestRejection()`；
- Agent 支持 hook cancel cause，compaction 只接受 idle agent。

**CapGen v0.4 自身设计：**

- `capital-automation` 独立 host bundle、页面和路由；
- 固定 `capital_automation` domain，记录内带服务端 profileKey；
- Capital 自有 60 秒 tick、scheduler owner、occurrence 和运行状态；
- 每次运行创建新 session，不在 Phase 1 自动 compact。

**实施前必须实测的能力：**

- automation bundle 与官方 bundle 共存时的实际 slot 组合；
- 固定 domain 在真实 backend 下的 profile 记录隔离；
- 跨进程 owner lock 和 fencing 语义；
- automation execution policy 对根 Agent 和 descendants 的调用期限制；
- session prompt accepted、崩溃恢复、Agent idle 和运行终态之间的实际时序。

---

## 1. 产品命名与模块边界

| 名称 | 含义 |
|---|---|
| `CapGen 投研自动化` | 用户看到的页面标题和侧栏文案 |
| `capital-automation` | host 行 id、客户端包名的一部分、路由和内部命名空间 |
| `automation/` | host bundle 源码和客户端 bundle 目录 |
| `capital_automation` | 固定 storage domain 名称；记录内部带 profileKey |
| `/capital-automation` | Capital 自有 HTTP 路由前缀 |
| `capital-automation` | Capital 自有 `main` key 与 `sidebar.panellist` id |

技术身份和用户文案分开维护。行 id、包名、路由、slot key 发生变化都视为迁移，不以“改名”处理。

### 1.1 与宿主 DSH 的边界

必须保持以下宿主能力不变：

- `ui-schedule` 行及其客户端 bundle；
- 官方 `schedules` main key 和 sidebar id；
- 官方右侧任务详情 tab；
- 会话头部的 schedule catalog；
- `conversation.chat.turnTail` 中的 `schedule-created` 卡片；
- 会话列表的 schedule 标记和 hover 内容；
- `schedule` 服务及其 `schedule.json` 存储；
- 官方 schedule 的编辑、删除和投递语义。

Capital 页面不读取、编辑或删除官方 schedule 记录。页面可以在帮助区域说明两套功能的关系；是否提供跳转官方页面，取决于 DSH 当前是否暴露稳定的 layout navigation 服务，不能把跳转 API 写成现成能力。

### 1.2 Host bundle

新增 host-plane 行：

```yaml
- insert:
    - id: capital-automation
      name: './automation/index.js'
```

不得加入：

```yaml
- id: ui-schedule
  disabled: true
```

不得注册以下宿主身份：

```text
main key: schedules
sidebar id: schedules
turnTail id: schedule-created
right sidebar task kind: official schedule kind
```

`automation/package.json` 必须声明独立的 web client bundle，遵守当前 chart-ui 使用的字面量相对路径、`platform: web`、`immediately: true` 和产物存在性约束。根 `package.json` 的 `files` 和 build 脚本必须同时加入 `automation/`，并由 packaging 测试验证发布 tarball 包含 host 和 client 两半。

---

## 2. Phase 1 的任务范围

### 2.1 任务类型

Phase 1 只接受定时触发：

```ts
type Trigger = {
  kind: 'schedule'
  cadence: 'daily' | 'weekly' | 'monthly'
  time: string                 // HH:mm
  timezone: string             // 必须是有效 IANA zone
  weekdays?: number[]          // weekly，ISO 1–7
  dayOfMonth?: number          // monthly，1–28
  tradingDaysOnly: boolean
}
```

不接受 `condition` trigger。条件任务需要独立的 metric registry、数据质量和三值逻辑设计，不能通过自动读取 JSON schema 代替。

### 2.2 内置任务

内置任务全部默认 `dormant`，用户明确启用后才会执行。Phase 1 提供三个只读模板：

| 分类 | 任务 | 默认触发 | 执行模式 |
|---|---|---|---|
| 资讯 | 早间资讯 | 交易日 08:30 | `news` |
| 资讯 | 盘后公告 | 交易日 18:30 | `news` |
| 复盘 | 每日复盘 | 交易日 20:00 | `review` |

模板只负责生成任务初始配置。用户可以编辑标题、说明、触发时间和指令覆盖；内置任务不能删除，只能暂停、休眠或恢复默认。

交易日历不可用时默认 fail-closed：任务记为 `skipped_calendar_unavailable`，不按 Mon–Fri 猜测运行。是否允许工作日 fallback 留到未来版本，并且必须是单独的显式设置。

### 2.3 执行模式

Phase 1 只允许以下执行模式：

```ts
type ExecutionMode = 'news' | 'market' | 'review' | 'research'
```

这些模式都使用当前 Capital 的 `capital-generation` 主 preset；模式只选择指令模板和输出要求，不改变 preset 身份。`ExecutionMode` **不是** agent preset，页面显示的是「输出侧重」；Agent preset 固定为 `capital-generation`（Capital 自动模式）。

Phase 1 不允许用户指定：

- 任意 `presetId`；
- 任意绝对 `projectRoot`；
- 任意自定义 shell 或写文件能力；
- 任意外部通知地址。

任务运行使用当前 profile 的已注册工作区：任务保存 `workspaceId`，未选择时把受控运行目录
`<dsh home>/automation-workspace/<profile>` 注册为专属工作区。只接受 `workspaceRegistry` 中的 id，
客户端不能传路径；保存前与运行前都做 `get` + `status()` 校验。workspace registry 不可用时退回
受控目录。

### 2.4 无人值守运行边界

“不要向用户提问、不要等待审批”只能作为运行提示，不能作为安全边界。

实现必须提供硬性 automation execution policy：

- 运行只能使用明确允许的 Capital 工具族；
- `ask_user_question`、交互式审批等待、shell 提权和写文件必须被拒绝或转换为 `blocked_requires_user`；
- 子 Agent 只能使用其角色 preset 声明的工具族；
- 根 Agent 取消时，scheduler 必须找到并取消该运行创建的 descendants；
- 步骤、工具调用和 wall-clock 预算覆盖整棵运行子树；
- 如果当前 DSH 版本无法在工具调用期可靠识别 automation execution context，Phase 1 不得开放无人值守运行，先补硬身份机制。

不得通过 persona 文案宣称已经取得这些边界。

---

## 3. 任务状态和模型

### 3.1 状态

```text
dormant   内置任务休眠，或用户尚未启用
active    按计划触发
paused    保留配置但停止触发
```

`running` 是运行记录状态，不写入任务配置。

状态转换：

```text
dormant -> active       启用
active  -> paused       暂停
paused  -> active       恢复
active/paused -> dormant 休眠并恢复默认覆盖层
custom -> deleted       仅删除自定义任务
```

运行中的任务不能删除或休眠，必须先取消或等待终态。

### 3.2 严格任务模型

不要使用 `Record<string, unknown>` 作为用户可写覆盖层。配置由 zod/domain schema 严格校验，所有字符串、数组深度、指令长度和记录大小都有上限。

```ts
interface AutomationTask {
  id: string
  schemaVersion: 1
  definitionVersion: number
  origin: 'builtin' | 'custom'
  sourceBuiltinId?: string
  profileKey: string              // 服务端生成，客户端不可写
  profileName: string             // 服务端生成，用于诊断
  state: 'dormant' | 'active' | 'paused'
  category: 'news' | 'market' | 'review' | 'research'
  title: string
  description: string
  trigger: Trigger
  instruction: string
  mode: ExecutionMode
  cwdKind: 'profile'
  limits: {
    runTimeoutMinutes: number
    idleTimeoutMinutes: number
    maxSteps: number
    maxToolCalls: number
  }
  notifications: {
    inApp: boolean
    onFailure: boolean
    onSuccess: boolean
  }
  overrides?: BuiltinOverrides
  createdAt: string
  updatedAt: string
}
```

`profileKey`、`profileName`、`cwdKind`、`schemaVersion`、`definitionVersion` 由服务端维护。客户端 PATCH 不能改变任务所属 profile、任务 origin、执行 preset 或 cwd。

### 3.3 内置覆盖层

内置定义位于代码中，每个定义包含：

```ts
interface BuiltinDefinition {
  id: string
  version: number
  category: AutomationTask['category']
  defaults: Omit<AutomationTask, 'id' | 'profileKey' | 'profileName' | 'createdAt' | 'updatedAt'>
}
```

读取内置任务时按以下顺序合并：

```text
代码内置定义 -> 合法用户覆盖层 -> 服务端运行时字段
```

升级时：

- 新字段取新版本默认值；
- 用户已有覆盖保留；
- 已删除的内置定义保留历史运行，但从任务库隐藏；
- 休眠会清空用户覆盖，并回到当前内置默认版本；
- 不把不认识的旧字段原样带入新记录。

---

## 4. Session 与运行生命周期

### 4.1 每次运行使用新 session

Phase 1 不继承上一次运行的上下文。每次运行创建一个新的 automation session：

- `agentPreset = capital-generation`（Capital 自动模式）；
- 使用任务保存的已注册 `workspaceId`；未选择时使用专属受控运行目录并注册为工作区；
- 标题格式：`[CapGen 投研自动化·<profile>] <task-title>·<run-short-id>`；
- `run.sessionId` 保存服务端创建结果；
- 运行终态后不再向该 session 自动追加消息。

不把 session 标题当作权限边界。任务、run、profile 和 session 的关系由服务端存储映射维护。

如果用户修改执行模式、触发配置、指令或受控 cwd，下一次运行自然使用新 session，不复用旧 session。旧 session 只作为审计材料保留，不作为下一次运行上下文。

### 4.2 运行指令

首条消息包含：

- 任务指令；
- 触发原因：`scheduled` 或 `manual`；
- 运行 id、任务 id 和 occurrence；
- 当前日期、任务时区和项目上下文；
- 输出格式和失败处理要求；
- 无人值守执行策略的标识。

指令不得要求模型绕过 DSH 审批，也不得把内部错误、密钥、原始 rows 或路径诊断直接复制到用户正文。

### 4.3 运行状态

```text
queued
starting
running
succeeded
failed
canceled
timed_out
blocked_requires_user
unknown_after_restart
skipped_overlap
skipped_calendar_unavailable
missed
```

`unknown_after_restart` 表示进程重启时无法证明 prompt 是否已被 Agent 接受。Phase 1 不自动重试这类运行，避免重复执行；用户可以手动创建一次新的运行。

### 4.4 取消和预算

每个运行配置：

| 预算 | 默认 | 范围 |
|---|---:|---:|
| wall-clock | 30 分钟 | 5–120 分钟 |
| idle timeout | 5 分钟 | 1–30 分钟 |
| 最大步骤 | 300 | 10–2000 |
| 最大工具调用 | 1200 | 10–6000 |

超限时使用：

```ts
agent.cancel({
  kind: 'hook',
  reason: 'automation_run_timeout'
})
```

工具调用计数覆盖整棵运行子树：顶层 `tool/call`、PTC 的 `tool/ptc-dispatch` 与子 Agent 调用都算一次。
`step_limit`、`tool_limit`、`stalled` 使用独立 reason。取消只影响当前 Agent，因此运行 owner 必须维护本次运行创建的 agent/session 子树，并递归取消 descendants。取消后等待终态；超出取消宽限时写入 `timed_out` 或 `unknown_after_restart`，不能假定底层工具已经停止。runtime/profile 卸载先等待 scheduler admission 和活动 runner drain；runner dispose 最多等待 20 秒，超时仍未证明结束的运行写入 `unknown_after_restart`，不自动重试。

为防止多个高预算任务同时运行压垮宿主，Phase 1 对每个 profile 增加 2 个活动运行的 admission cap；超出部分记为 `skipped_overlap`，手动请求返回 `run_capacity`。该 cap 是宿主资源背压，不改变单次运行的 wall-clock、step 或 tool-call 默认值。

### 4.5 Compaction

因为 Phase 1 每次运行使用新 session，不在每次运行结束后自动 compact。这样避免把 `turn/end`、flush、idle 和下一次 prompt 竞态混入第一版调度器。

未来若启用跨运行上下文，必须满足：

1. Agent 已经 idle；
2. session persistence checkpoint 已完成；
3. 通过 `agent.ctx.compaction` 调用 `compactNow(agent, signal)`；
4. compaction 期间禁止同 task 新运行；
5. 明确处理 `busy`、`cancelled`、`changed`、`summary`、`commit`、`persistence`；
6. 只在持久化终态成功后更新运行摘要。

---

## 5. 调度器

### 5.1 调度器边界

Capital 使用自己的 host scheduler。它不调用 DSH 官方 schedule service 作为内部任务存储，也不修改官方 schedule domain。

`DEFAULT_TICK_MS = 60_000` 是 Capital 自己的调度策略，不代表 DSH 官方 schedule runtime 的实现。

scheduler 必须挂在 `ctx.effect` 生命周期中：

- profile 启动时打开自己的 storage domain；
- 仅创建一个 tick loop；
- effect dispose 时清理 interval、运行观察器和 owner lease；
- tick 中不等待模型运行；
- tick 只读取配置、计算到期项、尝试 claim occurrence 和投递运行。

### 5.2 单 scheduler owner

Phase 1 默认每个 profile 只有一个活动 scheduler。owner 机制必须是跨进程可证明的：

- 优先使用宿主提供的原子 lock/lease 能力；
- 若只能使用文件锁，必须用原子创建或等价的 OS 原语，并验证 Windows、Linux 和进程崩溃行为；
- 无法取得可靠 owner 时，scheduler 进入 `standby`，页面显示“调度器未取得运行权”；
- best-effort 心跳不能作为“不会重复执行”的依据；
- owner 记录包含 `profileKey`、owner id、lease expiry 和 fencing token；
- 失去 owner 后停止新投递，已有运行继续由其 Agent 生命周期处理。

### 5.3 occurrence

定时任务的 occurrence 使用规范化计划时刻，不使用模糊的本地日期字符串：

```text
occurrenceKey = profileKey + ':' + taskId + ':' + scheduleVersion + ':' + scheduledInstantUtc
```

手动运行没有 schedule occurrence，使用独立的 `manual:<runId>` 标识。手动运行请求同样必须先取得当前 profile 的 scheduler owner；处于 `standby` 时返回 `scheduler_unavailable`，不能绕过 owner 直接创建 session。

一次 occurrence 的 claim 必须先于 session 创建，并且状态转换必须通过同一 profile owner 串行化。成功接受 prompt 后才进入 `running`；无法确认 prompt 是否接受时进入 `unknown_after_restart`，不自动重试。

同一任务串行运行。上一运行仍为 `starting` 或 `running` 时，下一次计划记为 `skipped_overlap`。

### 5.4 启动恢复

启动扫描只做恢复标记，不自动补跑：

- `queued` 超过 10 分钟且没有 session id → `unknown_after_restart`；
- `starting` 或 `running` 没有可靠 Agent owner → `unknown_after_restart`；
- 已保存终态不再改变；
- 过期的 occurrence 记为 `missed`；
- 不补执行多天的缺口；
- 用户可通过页面手动发起新运行。

---

## 6. 数据与角色边界

### 6.1 定时运行的数据路径

scheduler 只负责创建 session 和提交 prompt，不直接读取行情、新闻或 Dataset。

主 Agent 按现有 Capital 角色协议完成：

```text
主 Agent -> data_collector -> DatasetRef
主 Agent -> data_junior -> profile / query / gate
```

原始 rows 不进入 scheduler、页面 API 或运行摘要。运行摘要只保留状态、耗时、来源引用和用户可读结论所需的有限信息。

### 6.2 条件引擎延期

v0.4 不开放 `/catalog` 条件指标构建器，也不新增 `DataCollectorHub.probe()`。

条件引擎未来必须先定义版本化 metric registry：

```ts
interface MetricDefinition {
  id: string
  version: number
  capability?: string
  adapter: string
  paramsSchema: object
  valuePath: string
  valueType: 'number' | 'string' | 'boolean'
  unit?: string
  aggregation?: 'last' | 'max' | 'min' | 'mean' | 'count'
  paginationSemantics: 'complete' | 'partial' | 'total_field' | 'unsupported'
  asOfField?: string
  maxAgeMs: number
}
```

每个 adapter 必须声明参数规范、单位、时间口径、分页语义、质量状态和权限。新闻、自选股、交易日历等非 Hub 数据不能伪装成 Hub capability。

条件系统还需要定义 `true/false/unknown/error` 的三值逻辑、过期数据行为和 fail-closed 规则，完成后另行评审。

---

## 7. Storage 与 profile 隔离

### 7.1 固定 domain

使用固定、预声明的 storage domain：

```text
capital_automation
```

不在调用期根据 profile 动态生成 domain name，避免依赖未经验证的动态 `defineDomain` 行为。

由于 DSH storage/session 根目录是全局的，domain 内每条记录都必须带服务端生成的 `profileKey`。所有读写、列表、删除、运行和通知查询都先按当前 `ctx.profileContext.name` 派生 profileKey，再过滤记录。

客户端提交的 profile 字段一律忽略或拒绝，不能用请求体决定数据归属。

### 7.2 表

```text
tasks          任务配置和内置覆盖层
runs            运行摘要和状态迁移
attempts        prompt 投递尝试、接受状态和 dispatch receipt
notifications  应用内通知
meta            schema、owner 和迁移信息
```

Phase 1 不保存条件判定表。

所有表记录使用严格 schema：

- id 使用服务端生成的 opaque id；
- 时间使用 UTC ISO 字符串，展示时按任务 timezone 格式化；
- 枚举闭集校验；
- 字符串和 JSON 大小有上限；
- 写入前拒绝 `undefined`、`NaN`、空洞数组和未声明字段；
- 迁移采用版本化读旧写新；
- 损坏记录备份并报告，不静默恢复默认。

建议保留：每任务 200 条 run，全局 2000 条 run，每个 profile 最多 200 条通知。淘汰必须先按 profile 过滤，不能误删其他 profile。

### 7.3 profile 事实边界

服务端只依赖当前 `ctx.profileContext.name`、`dir` 和 `home`。不能在设计中假定 Electron 只有一个 profile、不能切换 profile，或插件安装必然进入某个 profile；这些属于桌面运行时待验证事项。

页面只显示当前 profile 标识，不能把它当作权限边界。权限边界来自服务端 profileKey 过滤、任务不可变归属和 owner 校验。

---

## 8. API

所有 handler 的第一步都调用 `connection.requestRejection(req)`。被拒绝时直接返回其 401/403 结果，不先解析业务参数、不先访问 storage。

请求体使用严格 schema，服务端从当前 runtime 派生 profile，不接受 profile、owner 或 session 归属字段。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/meta` | 当前 profile、版本、scheduler 状态和能力摘要 |
| GET | `/tasks` | 当前 profile 的任务列表 |
| POST | `/tasks` | 新建自定义定时任务 |
| PATCH | `/tasks/:id` | 修改当前 profile 的任务配置 |
| DELETE | `/tasks/:id` | 删除 custom 任务；运行中拒绝 |
| POST | `/tasks/:id/activate` | 启用任务 |
| POST | `/tasks/:id/pause` | 暂停任务 |
| POST | `/tasks/:id/hibernate` | 休眠并恢复内置默认 |
| POST | `/tasks/:id/copy` | 复制内置任务为 custom |
| POST | `/tasks/:id/run` | 手动运行一次 |
| GET | `/runs` | 当前 profile 的分页运行列表 |
| GET | `/runs/:id` | 运行详情和脱敏错误 |
| POST | `/runs/:id/cancel` | 取消运行 |
| GET | `/notifications` | 当前 profile 的通知 |
| POST | `/notifications/read` | 标记当前 profile 通知已读 |

不提供：

```text
/legacy
/catalog
/condition/validate
/condition/preview
```

原因分别是：不复制官方 schedule 管理、条件引擎尚未进入 Phase 1、避免把未实现能力伪装成 API。

错误响应只返回稳定 code、用户可读 message 和 request id。工具原文、密钥、原始 rows、完整 prompt、内部路径和未经脱敏的 `meta` 不直接返回浏览器。

---

## 9. 页面

侧栏入口：

```text
自动化任务
CapGen 投研自动化
```

Capital 页面顶部永久显示当前 profile 和 scheduler 状态。

### 9.1 任务列表

分组：

- 运行中；
- 资讯；
- 行情；
- 复盘；
- 我的任务。

每行显示：状态、下次运行、上次结果、未读通知数量。未读数量显示在 Capital 页面内部，不承诺 DSH 侧栏 slot 支持 badge。

### 9.2 任务详情

- 概览：描述、状态、触发时间、下次运行、上次结果；
- 配置：标题、触发、指令、模式、运行上限和通知；
- 运行记录：状态、耗时、session、错误和取消动作；
- 执行策略：只读显示允许的 preset、cwd 和工具边界；
- 通知：当前 profile 的未读记录。

运行期间只显示取消按钮。session 入口在运行进入终态后才开放，避免用户在自动运行过程中向同一个 session 注入交互消息。

### 9.3 新建任务

向导分三步：

1. 基本信息：标题、描述、指令；
2. 触发：daily、weekly、monthly、timezone、交易日选项；
3. 执行：工作区（已注册列表）、输出侧重（news、market、review、research）、超时和应用内通知。

不显示 preset 选择器和任意项目路径输入框；工作区只能从 `/meta.workspaces` 的已注册 id 中选择，
空值表示默认专属工作区。页面明确标注输出侧重不改变固定 preset `capital-generation`（自动模式）。

---

## 10. 配置

默认值集中在 `automation/defaults.js`：

```js
export const DEFAULT_TICK_MS = 60_000
export const MIN_TICK_MS = 30_000
export const MAX_TICK_MS = 3_600_000

export const DEFAULT_RUN_TIMEOUT_MINUTES = 30
export const MIN_RUN_TIMEOUT_MINUTES = 5
export const MAX_RUN_TIMEOUT_MINUTES = 120

export const DEFAULT_IDLE_TIMEOUT_MINUTES = 5
export const DEFAULT_MAX_STEPS = 300
export const DEFAULT_MAX_TOOL_CALLS = 1200
export const DEFAULT_OWNER_LEASE_MS = 90_000
```

用户可编辑字段只进入现有 `capital-config` 的包级设置卡，并使用 `.volatile()`。host row 的 `config` 只允许部署级默认值，不再同时保存一份可编辑的 tick 或 timeout。

优先级固定为：

```text
代码默认值 -> 部署级默认值 -> 当前 profile 用户设置 -> 任务级合法覆盖
```

所有设置读取在调用期完成，非法值拒绝或 clamp，并把结果记录到诊断信息。

---

## 11. 错误与通知

### 11.1 运行错误

```ts
interface RunError {
  at: string
  phase: 'schedule' | 'session' | 'turn' | 'tool' | 'llm' | 'timeout' | 'storage'
  severity: 'error' | 'warning'
  code: string
  message: string
  tool?: string
  callId?: string
}
```

每次运行最多保存 20 条错误，每条 message 有长度上限；相同 code、message 和 phase 去重。敏感内容在进入 storage 前脱敏。

Phase 1 只在任务详情和通知中心展示错误，不新增独立的宿主级系统错误中心。

### 11.2 通知

默认通知：

- 运行失败：开启；
- 运行超时：开启；
- 运行成功：关闭；
- scheduler standby：开启；
- calendar unavailable：开启；
- occurrence skipped：关闭。

不预留 email、微信字段。未来实现外部通知时，单独增加 credentials 和验证流程。

---

## 12. 分期

### Phase 1

- 独立 `capital-automation` host bundle；
- 官方 `ui-schedule` 保持不变；
- 固定 domain 和 profile 过滤；
- 单 scheduler owner；
- daily/weekly/monthly 定时任务；
- 三个内置只读模板；
- custom 任务；
- 手动运行；
- 新 session 每次运行；
- wall-clock、idle、step、tool budgets；
- 取消和 `unknown_after_restart`；
- 运行记录、脱敏错误和应用内通知；
- 页面、API、打包和挂载验证。

### Phase 2

- 跨运行摘要或受控上下文；
- metric registry；
- 条件评估和三值逻辑；
- watchdog；
- 任务导入导出；
- 多 cwd 与同一任务分工作区并行运行；
- 外部通知；
- 经过 Electron 运行时验证的 profile 功能。

---

## 13. 测试与验收

### 13.1 组合和打包

- `capital-automation` 行使用字面量相对路径；
- `automation/package.json` 的 client 声明正确；
- 根 `package.json` 的 `files` 包含 `automation/`；
- client bundle 存在且可被 `npm pack` 包含；
- `ui-schedule` 没有被 disabled；
- 官方 `schedules` 和 Capital `capital-automation` 同时存在；
- Capital 没有注册官方 turn tail、right-sidebar 或 session row id。

### 13.2 权限和 profile

- 未通过 `requestRejection` 的请求不会访问业务参数或 storage；
- 请求体不能伪造 profile、owner、session；
- 不同 profile 不能读、改、run、cancel 对方任务；
- 任务 cwd 和 preset 不能由客户端扩大；
- 路径逃逸、绝对路径和未知字段被拒绝；
- automation policy 拒绝交互提问、shell 提权和写文件；
- 根 Agent 取消后 descendants 最终收敛。

### 13.3 调度和恢复

- daily/weekly/monthly 的 timezone、跨午夜和 DST 边界；
- 交易日历不可用时 fail-closed；
- 同 occurrence 不重复 claim；
- 双 host 竞争时只有一个 owner；
- owner 丢失后停止新投递；
- prompt 接受前崩溃和接受后崩溃都进入正确的未知状态；
- unknown 运行不会自动重试；
- 运行中重叠触发记为 `skipped_overlap`；
- 时钟回拨不会制造重复 occurrence。

### 13.4 存储和 schema

- 严格拒绝 undefined、NaN、空洞数组和未声明字段；
- schema 迁移、损坏记录、超长文本和保留淘汰；
- profileKey 过滤覆盖所有表和 API；
- owner lease 的获得、续租、失效和崩溃恢复；
- storage open 失败时页面显示不可用，不启动调度。

### 13.5 Session 和运行

- 每次运行都创建新 session；
- session 创建失败会生成合成 failed run；
- prompt 未接受时不误报 running；
- turn/end、tool error、LLM error 正确映射；
- wall-clock、idle、step、tool 上限；
- cancel 宽限和 stuck/unknown 状态；
- 终态后才允许打开 session；
- 不执行 compact，避免第一版引入 idle/flush 竞态。

### 13.6 必须执行的验收

```text
npm test
npm run check:dsh
npm pack --dry-run
```

手工验收：

1. 官方“自动化任务”和“CapGen 投研自动化”同时可见；
2. 官方 schedule 创建、编辑、删除和会话卡片不受影响；
3. 当前 profile 创建一个内置任务并手动运行；
4. 运行记录显示 queued、running 和终态；
5. 超时后 Agent 和 descendants 都收敛；
6. 重启后不自动重复未知运行；
7. 第二个 host 无法取得 owner 时进入 standby；
8. 另一 profile 看不到当前 profile 的任务和运行记录；
9. 发布 tarball 包含 automation host/client 产物。

---

## 14. 实施前置条件

以下任一条件未满足，都不得把 Phase 1 标记为可发布：

1. host bundle 的独立 slot、路由和认证契约已用当前 DSH 版本实测；
2. storage domain 的固定 name/version 和 profile 记录过滤已通过真实 backend 验收；
3. 跨进程 owner lock 有可证明的原子语义；否则 scheduler 必须默认 standby；
4. automation execution policy 能在调用期硬性限制工具和子 Agent；
5. session prompt 接受、崩溃恢复和未知状态已经有测试；
6. `npm test`、`npm run check:dsh` 和 packaging 验收全部通过。

本方案不把未验证的 Electron profile 行为、动态 storage domain、DSH 官方 scheduler 实现或模型 prompt 自律当作系统保证。
