# 投研自动化（`capital-automation`）

> 索引见仓库根 `AGENTS.md` §12；设计稿 `docs/design/automation-tasks-v0.4.md` 是本实现的契约来源。
> §编号沿用 `AGENTS.md` 的全局命名空间。改 `automation/` 之前读本页。

## 12.1 边界与身份

- **独立 host bundle**：`automation/` 是随主包携带的嵌套包，行 id `capital-automation`，行名保持
  字面量相对路径 `./automation/index.js`。它与官方 `ui-schedule` 平级共存，**不** disable 官方行，
  **不**注册 `schedules` main/sidebar id、`schedule-created` turnTail 或官方右侧 tab kind。
- 页面身份是 Capital 自己的 `main` key 与 `sidebar.panellist` id，均为 `capital-automation`；
  技术身份与用户文案分开维护，改名视为迁移。
- 官方 schedule 记录不读、不写、不删；本页只在帮助区说明两套功能的关系。

## 12.2 固定域与 profile 隔离

- 固定 `capital_automation` 域（`layout: 'single'`），表：`tasks` / `runs` / `attempts` /
  `notifications` / `meta`。不在调用期动态生成域名。
- 每条记录带服务端派生的 `profileKey`（当前 `ctx.profileContext.name` 的完整原始字符串 sha256 前 24 位；
  页面显示名可截断）。列表、读取、运行、取消、通知查询一律先按 `profileKey` 过滤；请求体里的 profile / owner /
  session / preset / cwd / state 字段由 strict schema 直接拒绝。
- 内置任务按 profile 首次访问时播种，id 由 `profileKey + builtinId` 派生；休眠清空覆盖层并回到
  当前代码定义版本。运行保留每任务 200 条、每 profile 2000 条；通知每 profile 200 条。
- 所有表严格 schema；写入前 `assertCleanJson` 拒绝 `undefined`、`NaN`、空洞数组和非 plain object。
  损坏记录由域写入口拒绝；域 open 失败时页面显示不可用，调度器不启动。
- 启动扫描只做恢复标记：`queued` / `starting` / `running` 没有本进程 owner 时，优先按记录里的
  `turnState` 收口——`phase: 'ended'` 的 `succeeded` / `failed` / `canceled` / `timed_out` /
  `blocked_requires_user` 按原终态恢复，`finishedAt` 取回合结束时刻；只有没有回合边界（或边界仍是
  `running`）的运行才进入 `unknown_after_restart`，不自动重试。

## 12.3 调度与 occurrence

- Capital 自有 60 秒 tick（设置范围 30 秒–60 分钟）：tick 只做租约校验、读任务、算最近到期
  occurrence、投递与日历刷新，不在 tick 中等待模型运行；任务频率与 tick 无关。
- 单 scheduler owner：`~/.dsh/storages/capital-automation-locks/` 下的目录锁用 `mkdir` 原子创建；
  过期租约由 `rename` 移走后重新竞争，owner 记录含 `ownerId`、`fencingToken`、`leaseExpiresAt`。
  每个 lease 使用独立 child 目录，旧 owner 不能写入接任者的 root；`renew`/`isCurrent` 每次同时校验
  child 与当前 root。拿不到租约时进入 `standby`，页面只读；手动运行同样先要 owner，standby 返回
  `scheduler_unavailable`。
- profile 同时最多 admission 两个活动 run；超出部分记 `skipped_overlap`，手动运行返回
  `run_capacity`，不改变任务级 300 steps / 1200 tool calls / 30 分钟默认预算。
- occurrence 键：`profileKey + ':' + taskId + ':' + scheduleVersion + ':' + scheduledInstantUtc`；
  手动运行使用 `profileKey:manual:<runId>`。触发配置变化会改变 `scheduleVersion` 并重置
  `scheduleAnchorAt`，避免用旧版本补跑。
- 同任务串行：存在 `queued/starting/running` 运行时，下一次计划记 `skipped_overlap`。
  超过 10 分钟 catch-up 窗口的 occurrence 记 `missed`，不补跑多天缺口。
- `tradingDaysOnly` 的日历以深交所官方休市日历（`monthList` 月 JSON，无需 key）为准：按月拉取
  “今天 −62 天 … 今天 +400 天”，已拉取月份覆盖内置表，未公布月份回退内置表，两者都没有的日期
  fail-closed（`calendar_unavailable` → `skipped_calendar_unavailable`），**不**按 Mon–Fri 猜测。
  缓存 `<dsh home>/storages/capital-automation-calendar/szse.json`，每天刷新；启动先等一次就绪，
  刷新在途时 `pendingRefresh` 让调度顺延到下一 tick 再判定，不提前烧掉 occurrence。
- 覆盖不足 30 天时页面提前告警；`/meta.calendar` 暴露 `source / through / coverageDays /
  fetchedAt / stale / lastError`。交易所公布新一年安排后自动接上，不再靠改代码补表。
- 时区/DST：本地墙钟转 UTC，春季不存在的分钟跳过，秋季重叠取第一个；存储只用规范化 UTC ISO。

## 12.4 运行与无人值守边界

- 每次运行创建新 session（`agentPreset: capital-generation`，即 Capital 自动模式）；任务配置保存
  已注册工作区 id，未选择时把 `<dsh home>/automation-workspace/<profile>` 注册为
  `CapGen 投研自动化（<profile>）` 并使用。创建 session 时传 `workspaceId`，**不**传裸 `cwd`，
  这样 session 进入用户选择的工作区分组，而不是「未分组」；只有 workspace registry 不可用时才退回
  受控目录并记 warn。标题 `[CapGen 投研自动化·<profile>] <task-title>·<run-short-id>`。终态后不再向
  该 session 追加消息；Phase 1 不做 compaction，也不继承上次运行的上下文。
- 工作区只接受 `workspaceRegistry` 中已注册的 id（保存时 `get` + `status()` 校验，运行前再校验一次）；
  客户端不能传路径、`cwd` 或 `projectRoot`。默认工作区首次读取 `meta`/运行任务时注册，并把
  cwd 相同的历史 session 重新 attach，避免旧运行继续留在未分组。注册失败不阻断运行，只退回受控目录。
- 首条 prompt 含任务指令、触发原因、run/task/occurrence、当前时间与时区、输出要求和
  `automation-v1` 无人值守标识。prompt 未被明确接受时进入 `unknown_after_restart`，不自动重试；
  session 创建失败留下合成 `failed` run。
- 根回合边界即落盘：`turn/start` 写 `turnState{phase:'running'}`，`turn/end` 写
  `turnState{phase:'ended', status}` 并顺带持久化当时的 `steps` / `toolCalls` / `summary`；不依赖
  750ms settle 之后的 finalize。恢复与 dispose 都以该字段为准，因此已完成回合不会被重启改写成
  `unknown_after_restart`。
- 预算（任务级覆盖）：wall-clock 5–120 分钟、idle 1–30 分钟、最大步骤 10–2000（默认 300）、
  最大工具调用 10–6000（默认 1200）。wall-clock 从 admission 开始，覆盖 workspace/session 创建、resolve、rename
  与首条 prompt；工具调用计数覆盖整棵运行子树：`tool/call` 与 PTC 的 `tool/ptc-dispatch` 都算一次，子 Agent 的调用也计入。
  取消用 `agent.cancel({kind:'hook', reason})` + `subagents.drainDescendants()`；drain 与 session flush 都有有限时，
  宽限期后仍未收敛则按 `timed_out` / 取消终态收口，不假定底层工具已停止。runtime/profile 卸载时先等待 scheduler admission 和活动 runner drain；runner dispose 最多等待 20 秒；
  已结束回合按 `turnState` 收口，仍在中途的运行显式记为 `unknown_after_restart`，不自动重试。
- 工具调用期身份是 run 注册的 session id：全局 `tools.guard` 拒绝 `ask_user_question`、`write`、
  `edit` 与 shell 提权请求；被拒的提问把运行标成 `blocked_requires_user`。角色工具面仍由
  preset 的族行封闭；不得用 persona 文案替代这些闸门。
- 运行错误最多 20 条、按 code+message+phase 去重，进入存储前脱敏（token、路径、控制字符）。
  通知默认失败/超时/standby/日历不可用开启，成功默认关闭。

## 12.5 API、页面与验收

- 路由前缀 `/capital-automation`；所有 handler 第一步 `connection.requestRejection(req)`，
  被拒时不读 body、不碰 storage。提供 `/meta`、`/tasks`（CRUD + activate/pause/hibernate/copy/run）、
  `/runs`（列表/详情/cancel）、`/notifications`（列表/已读）。不提供 `/legacy`、`/catalog` 或条件接口。
- 页面顶部只保留品牌与居中的「任务 / 运行」页签，右上角是 profile 级通知中心与「新建任务」；
  profile / scheduler / 日历等诊断信息不再常驻，只在 scheduler standby、存储或交易日历不可用
  时以 banner 提示，版本号不在页面展示。明暗主题跟随 `body[data-ds-dark-theme]`；
  浅色模式的灰阶、表格分隔线、标签/状态文字色单独覆盖，页签选中态用高对比实心胶囊。任务页由
  最近 30 天运行历史、运行中条、任务表（分类/我的任务筛选、搜索、行内操作菜单）和内置模板区组成：
  `dormant` 的内置任务以模板卡展示，添加后进入任务表；`active` / `paused` 任务与自定义任务留在任务表。
  分类/来源标签与任务标题同排（模板卡标题只带分类标签），超过 12 个字截断，窄屏换到标题下一行；
  模板卡的添加按钮是品牌色实心主按钮，不靠 hover 才可见；筛选计数是圆圈数字，模板区标题只留「模板」。
  首屏在 `/meta` 与 `/tasks` 一起返回前只渲染与最终布局同轮廓的骨架屏（官方
  `--dsw-alias-bg-skeleton` token + 呼吸动画，`prefers-reduced-motion` 下停用），不得先显示
  「还没有任务」；首次请求失败则落在错误 banner + 重试，不留在骨架屏。
- 任务详情是独立焦点页，不重复全局页头，顶部只留「所有任务」返回条；含概览、配置、运行记录、
  通知四个页签。详情头只保留标题、状态、说明与操作，不再有分类 / 日程摘要行；下次运行、上次结果
  放在四张状态卡里，不再重复整块日程明细；未添加或暂停的任务明确写「当前不会自动运行」，不展示
  会被跳过的下次运行日期，失败、运行中、跳过分别着色。内置模板的覆盖说明只在配置页出现。
  执行环境只列运行模式（自动模式）、工作区、任务分类与输出侧重，不展示内部 preset id、执行策略
  长文或预算子树说明；技术信息直接展开（无折叠按钮，与上方信息用分隔线隔开），保留 profileKey、运行模式、无人值守策略、工作区来源、
  profile 名称与交易日历，版本号不显示。「最近运行」固定 3 条，链接写「完整记录」并留在本任务的
  运行记录页签；每条运行行的错误条数跟在「工具调用」之后，右侧只留取消运行或打开 session
  （打开 session 用主按钮）。配置里的「工作区」从 `/meta` 的 `workspaces` 选择，空值 = 默认专属
  工作区；「输出侧重」只是 `news/market/review/research` 的提示词模板，不是 agent preset，页面
  同时标明运行模式固定为「自动模式」。保存有取消与脏状态提示；
  删除自定义任务、休眠内置模板都要二次确认，取消活动运行同样需要确认。任务详情运行中只显示取消；
  未添加的模板用「添加」、已暂停任务用「启用」，二者是主按钮；已启用后「立即运行」是主按钮；
  终态后才开放 session 入口。
- 运行页复用同一张 30 天历史卡，按全部/进行中/成功/失败筛选 profile 级运行记录；每行标题
  在前、状态在后，时间、耗时与步骤等元数据在第二行左对齐，错误条数紧跟「工具调用」，
  取消 / session 操作靠右。点击错误条数在行内展开具体错误（消息 + code），摘要不展开——
  结果与过程以 session 为准。可取消活动运行或在终态后打开 session。
  通知中心展示全部 profile 级通知（包括没有 taskId 的 `scheduler_standby` /
  `calendar_unavailable`），可定位到任务。上述均为页面组织与呈现，API、状态机和存储契约不变。
- 设置默认值集中在 `automation/defaults.js`；用户级字段走现有 `capital-config` 条目的
  `automation.*` volatile 字段，优先级固定为代码默认 → 部署行 → 当前 profile → 任务级覆盖。
- 回归：`test/automation-*.test.mjs`（schema/时区/DST/owner/store/route/scheduler/policy/runner/
  calendar-source/组合）+ `test/packaging.test.mjs`。日历上游形状用 `npm run smoke:calendar` 实测，
  不进 `npm test`（测试全部注入假 fetch，不打外网）。改 `automation/` 后跑 `npm test`；改 host 行或
  客户端产物后再跑 `npm run check:dsh` 与 `npm pack --dry-run`，并重启 dsh 进程、刷新浏览器。
