# 投研自动化（`capital-automation`）

> 索引见仓库根 `AGENTS.md` §12；设计稿 `docs/design/automation-tasks-v0.4.md` 是任务/运行契约，
> 看板见 `docs/design/automation-board-v0.2.md`。
> §编号沿用 `AGENTS.md` 的全局命名空间。改 `automation/` 之前读本页。

## 12.1 边界与身份

- **独立 host bundle**：`automation/` 是随主包携带的嵌套包，行 id `capital-automation`，行名保持
  字面量相对路径 `./automation/index.js`。它与官方 `ui-schedule` 平级共存，**不** disable 官方行，
  **不**注册 `schedules` main/sidebar id、`schedule-created` turnTail 或官方右侧 tab kind。
- 页面身份是 Capital 自己的 `main` key 与 `sidebar.panellist` id，均为 `capital-automation`；
  技术身份与用户文案分开维护，改名视为迁移。
- 官方 schedule 记录不读、不写、不删；本页只在帮助区说明两套功能的关系。

## 12.2 固定域与 profile 隔离

- 固定 `capital_automation` 域（`layout: 'single'`），表：`tasks` / `runs` / `attempts` / `notifications` / `meta` / `briefs` / `todo_acks` / `todo_watches` / `asks`。`briefs` 是成功运行的派生任务简报（一 run 一条），TODO / 雷达 / 数据体检都由它读取时聚合；`todo_acks` 存用户对单条 TODO 的版本级决定（`profileKey` + `todoId` + `confirmedAt` + 可选 `decision: confirmed|deferred`，旧记录按 confirmed 读，每 profile 最多 500 条），读取时按 `confirmedAt` 判断该版本是否已被决定，不回写 brief；`todo_watches` 是 `confirm` / `verify` 的派生跟踪态（`watching` / `triggered` / `needs_human` / `resolved` / `expired`，每 profile 最多 600 条），只存核验结论与原文证据，可选 `autoRequestedAt` 记录用户主动转入自动核验的一次请求，可选 `expiredReason` 记录归档原因；`asks` 存看板追问（`runId` + 原始问题 + 追问前日志游标 + 前 160 字预览，每 profile 最多 400 条），同一 run 同时只允许一条 `running`，不复制 session 正文。
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
  `scheduler_unavailable`。standby 是系统状态，不写通知记录；`status()` 暴露
  `lastStandbyAt / lastStandbyCode / lastStandbyReason`，由页面底部「系统状态」展示，技术原因默认折叠。
- profile 同时最多 admission 两个活动 run；超出部分记 `skipped_overlap`，手动运行返回
  `run_capacity`，不改变任务级 300 steps / 1200 tool calls / 60 分钟默认预算。
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

- 每次运行创建新 session（`agentPreset: capital-generation`，即 Capital 自动模式）。任务保存已注册工作区 id；
  未选择时按设置卡的统一默认工作区（`automation.defaultWorkspaceId`，须已注册且目录可用）启动，否则注册并使用
  `<dsh home>/CapGen-automation-workspace/<profile>`（标题 `CapGen 投研自动化（<profile>）`）。创建 session 时传
  `workspaceId`、**不**传裸 `cwd`，让 session 进入对应工作区分组；只有 workspace registry 不可用时才退回受控目录并记 warn。
  标题是触发时区的 `<MM-DD> <task-title> <run-id-prefix>`（默认 8 位）。终态后不再追加消息；Phase 1 不做 compaction，也不继承上下文。
- 工作区只接受 `workspaceRegistry` 中已注册的 id（保存时 `get` + `status()` 校验，运行前再校验一次）；客户端不能传路径、
  `cwd` 或 `projectRoot`。专属默认工作区首次读取 `meta` / 设置卡 / 运行任务时注册，并把 cwd 相同的历史 session 重新 attach，
  避免旧运行留在未分组；注册失败不阻断运行。设置卡下拉从 `/workspaces` 读取 id / 标题 / 路径，只展示 `~` 缩写。
- 首条 prompt 含任务指令、任务分类、触发原因、run/task/occurrence、当前时间与时区、
  **宿主算出的最晚结束时刻**与预算时钟规则（收口/等待前必须先调 `get_local_datetime`，
  不得用步数或等待次数估算）、`automation-v1` 无人值守标识。任务分类同时决定输出结构与通用侧重，这段分类要求排在任务
  指令之前且不覆盖任务指令。内置模板的指令只写覆盖范围与交付口径（逐档覆盖、按什么分级、
  什么算做完），不点名工具，也不复制分类结构、数据纪律与无人值守策略；标题与说明用 JSON
  引号串作为背景数据嵌入，并明确以「任务指令」为任务目标，背景资料里的指令性文字按数据
  忽略；prompt 未被明确接受时进入 `unknown_after_restart`，不自动重试；session 创建失败
  留下合成 `failed` run。
- 根回合边界即落盘：`turn/start` 写 `turnState{phase:'running'}`，`turn/end` 写
  `turnState{phase:'ended', status}` 并顺带持久化当时的 `steps` / `toolCalls` / `summary`；不依赖
  750ms settle 之后的 finalize。恢复与 dispose 都以该字段为准，因此已完成回合不会被重启改写成
  `unknown_after_restart`。
- 预算（任务级覆盖）：wall-clock 5–120 分钟、idle 1–30 分钟、最大步骤 100–2000（默认 300）、
  最大工具调用 100–5000（默认 1200）。wall-clock 从 admission 开始，覆盖 workspace/session 创建、resolve、rename
  与首条 prompt；工具调用计数覆盖整棵运行子树：`tool/call` 与 PTC 的 `tool/ptc-dispatch` 都算一次，子 Agent 的调用也计入。
  取消用 `agent.cancel({kind:'hook', reason})` + `subagents.drainDescendants()`；drain 与 session flush 都有有限时，
  宽限期后仍未收敛则按 `timed_out` / 取消终态收口，不假定底层工具已停止。runtime/profile 卸载时先等待 scheduler admission 和活动 runner drain；runner dispose 最多等待 20 秒；
  已结束回合按 `turnState` 收口，仍在中途的运行显式记为 `unknown_after_restart`，不自动重试。
- 工具调用期身份是 run 注册的 session id：全局 `tools.guard` 拒绝 `ask_user_question`、`write`、
  `edit` 与 shell 提权请求；被拒的提问把运行标成 `blocked_requires_user`。角色工具面仍由
  preset 的族行封闭；不得用 persona 文案替代这些闸门。
- 运行错误最多 20 条、按 code+message+phase 去重，进入存储前脱敏（token、路径、控制字符）。
  通知只记录任务级事件：失败 / 超时 / 需人工处理（默认开启）、成功（默认关闭）与交易日历不可用；
  调度器 standby 不写通知，只进系统状态。

## 12.5 API、页面与验收

- 路由前缀 `/capital-automation`；所有 handler 第一步 `connection.requestRejection(req)`，
  被拒时不读 body、不碰 storage。提供 `/meta`（页面壳；`notifications.unread` 直接带任务通知未读数）、`/workspaces`（设置卡的下拉，带路径与专属默认标记）、`/tasks`（CRUD + activate/pause/hibernate/copy/run）、
  `/runs`（列表/详情/cancel）、`/runs/history`（按浏览器时区聚合的每日运行数）、`/notifications`（列表/已读）、`/board`（看板聚合）、`/board/briefs/:runId/retry`（只重试已入队的失败新简报）、`/board/briefs/:runId/ask`（POST `{ question, timeZone? }`，把追问追加到该 run 的 session，202 入队）、`/board/briefs/:runId/asks`（GET 按创建时间正序返回该 run 的全部追问）、`/board/asks/:id`（轮询追问状态与前 160 字预览）与 `/board/asks/:id/answer`（按需读取完整回答）、`/board/todos/confirm`（POST `{ id }` 确认单条 TODO，body 严格校验）；不提供 `/legacy`、`/catalog`、历史回填或条件接口。
- 页面顶部只保留品牌与居中的「看板 / 任务 / 运行」页签，默认停在看板；右上角是任务通知中心与「新建任务」。看板无 brief 时只显示空态引导（去任务页手动运行 / 新建任务），不显示统计、右栏或历史占位；有数据时由任务简报、TODO、个股动态、数据体检、运行健康五块组成；TODO 默认只看今天/尽快，筛选只有今天/尽快、将来、历史 TODO 三档，未来日期进将来（有具体日期直接显示，没有则显示未定；到当天自动浮到今天），当天没有待办显示「今天暂无待办」，每行状态标签独占一行、标题在标签下方（已决定行例外：收成单行并排到今天最后），待人工处理 / 已触发 / 跟踪 / 自动核验中的行右侧是「...」更多操作菜单，内含「已确认 / 转入自动校验 / 忽略」；`track` 只给「已确认 / 忽略」，美股代码与已触发项不提供自动校验，菜单里以禁用项标注「美股暂不支持 / 条件已触发」。已确认与已忽略先本地收起并排到今天最后，再异步写入 `todo_acks`，写回失败会撤回；已决定行之间不重复画分隔线，只有第一条与上方待处理项之间保留一条，标签与标题的间距固定。转入自动校验先本地切成「自动核验中」并排入下一次 17:00 核验，不立即起跑。已决定行仍保留菜单可改判；历史 TODO 档只读，默认看昨天，筛选项左侧的日期选择器可在当前看板范围内选任意过去一天；每行标题独占一行、点击展开，第二行显示结论（未触发 / 证据不足 / 未完成核验 / 手动确认 / 手动忽略 / 跟踪结束 / 已过期）与自动核验 / 人工处理日期，不显示 watch 状态标签、不提供菜单，行间不画分隔线；已确认 / 已忽略版本保留，后续运行再次提到同一项时重新出现（决定只覆盖已看到的版本），展开依据后每条来源行右侧的「打开 session」也是 30px 外链箭头（文字只留在 `title` / `aria-label`）；简报按完成时间倒序平铺、首行带任务身份图标（与任务页同源）、显示相对时间（完整时间在 `title`）；卡片不再显示「AI 简报」标识、「原文过长」截断标记或常驻输入框，右上角改为聊天 icon（与「打开 session」外链箭头同排）；点开后是 headless 的「对话」弹窗，顶部还原任务身份与简报原文，右上角可打开 session（与关闭按钮同款 30px 图标），底部输入问题；弹窗按创建时间正序列出该 run 的全部问答；卡片内只保留最新一轮问答（问题右对齐气泡、回复左侧强调线，不再显示「你问 / 回答」标签），回复默认显示前 160 字（最多三行），「查看更多」在卡内展开完整回答并可「收起」；卡片右上角的「打开 session」是 30px 方形图标按钮（`title` / `aria-label` 交代动作，窄屏仍留在标题行右侧），失败 / 跳过态卡内也不再放文字版「打开 session」；右栏默认展开，TODO 与个股动态默认展开、数据体检与运行健康折叠，工具栏可整体收起；数据体检条目不再显示「能力缺口 / 本次未取到 / 口径冲突 / 数据质量」分类标签，展开后的「打开 session」与 TODO 依据行一致，只留 30px 外链箭头（`title` / `aria-label` 交代动作）；运行健康异常行右侧的「打开 session」同样只留 30px 外链箭头。顶部统计拆成当天与总量：`今天简报 / 总简报`、`今天 TODO : 人工 / 自动`、`个股动态 / 新增`、`数据能力缺口 / 新增`、`今天运行异常`；点“今天简报”的数字高亮当天简报卡 3 秒，总简报只读，其他数字先展开目标面板再滚到模块。TODO 的“人工 / 自动”按自动核验状态拆分，`watching` 计入自动，其余计入人工；“新增”按当天首次出现计数。个股动态按代码合并带 / 不带交易所后缀的同一只（`300803` 与 `300803.SZ` 不算两只），右上角计数改为「共 N 只」并接标签筛选（全部 / 持仓 / 风险 / 事件 / 关注）；首屏只显示 12 只，其余用「展开全部 N 只」加载完整列表。标签 hover 显示释义；「N 条待跟进」与展开条目共用服务端随个股返回的同一份列表，计数不会再超过实际能展开的条目数。条目 hover / 键盘聚焦走品牌蓝色，每条可整行点击直接打开来源 session，不再逐条放「打开 session」按钮。
- **TODO 自动跟踪（2.21.0）**：只跟踪 `confirm` / `verify`，`track` 保持被动。最近 3 天仍被运行提到、且 `dueAt` 未过的条目进入 `todo_watches`；`confirm` 直接转 `needs_human`（不进模型核验）。`verify` 只由内置 `todo-verifier-close`（「TODO 核验」，交易日 17:00，默认启用）主动核验：服务端在运行前把 A/H 与无标的的候选 TODO 注入 prompt，任务用数据/网页工具逐条调查并返回 JSON；核验运行也生成简报，由同一个终稿在 `results` 之外写一份 `brief`（headline / plain，正文要交代触发项的核实线索），服务端校验后落库、不额外起一次总结请求；`brief` 缺失或不合法时回退到按结果生成的确定性文案（`items` / `stocks` / `gaps` 两种情况都为空），避免把核验 JSON 回灌成新的 TODO；午间快照、每日复盘等普通任务不再担任判卷人。单批最多 30 条，超出留到下一窗口；没有候选时 scheduler 直接消费 occurrence，不创建空 run/session。核验只认同一标的、同一口径、同一时点，`evidence` 必须能在本次运行的答复或工具结果原文中找到，`source` 记录数据集/URL/工具与 as-of；输出 JSON 先修复字符串外的尾逗号再解析，非空 `results` 解析为空时记 warning，避免整批 verdict 因格式失败被当成数据不足；低置信度、找不到原文或数据不足一律转 `needs_human`，不把“没取到数据”写成“条件未满足”。触发写 `todo_triggered`，需要人工处理写 `todo_needs_human`，通知带 `todoId`，点通知回到看板 TODO；同一状态只通知一次。用户确认与忽略都落 `todo_acks`（`decision` 区分 `confirmed` / `deferred`），并把 watch 收口为 `resolved`；连续 3 天没有新运行提到则移出跟踪并记 `stale`；`dueAt` 到期后除 `triggered` 外一律结算为 `expired` 并记原因（`not_triggered` / `no_data` / `not_verified` / `not_confirmed` / `stale`），不再补跑、不通知；到期后才第一次出现的 `verify` 不建 watch，直接归档；`confirm` 有明确日期时也立即归档。看板 TODO 行只保留一个状态标签：`自动核验中 / 已触发 / 待人工处理 / 已确认 / 已忽略 / 跟踪`（历史 TODO 行不显示该标签，改在第二行给结论）；鼠标移到「自动核验中」上会列出当前启用的核验任务名与 A/H 收盘窗口。`历史 TODO` 是只读单日归档：按到期日归到某天（无 `dueAt` 时退回人工处理 / 核验 / 最后提及日期），结论统一为「未触发 / 证据不足 / 未完成核验 / 手动确认 / 手动忽略 / 跟踪结束 / 已过期」，自动核验与人工处理分别显示对应日期；不再提供菜单，不计入今日 TODO、个股跟进数与通知；后续运行再次提到同一项时按新版本重新出现。`已确认` 与 `已忽略` 都是当前版本的软关闭：不计入今日 TODO 与个股跟进数、不再提醒，前者标签不同；后续运行再次提到同一项时按新版本重新出现。`转入自动校验` 给 watch 写 `autoRequestedAt`、状态切 `watching`，下一次核验优先送候选；`confirm` 条目也可进入候选，核验返回 `insufficient` 后退回 `needs_human` 并清掉一次请求标记，避免无限重试；到期后未触发或数据不足直接归档，不再重试；`track`、美股与历史条目不提供该分支。已决定行保留「...」菜单，可直接改判为另一种决定或转回自动核验；改判会覆盖旧决定并重开对应版本。待人工处理不再显示「只有你本人知道」一类通用交接说明。
  profile / scheduler / 日历等诊断信息不常驻，只在 scheduler standby、存储或交易日历不可用时以 banner 提示；任务页/运行页底部保留「系统状态」，看板把调度与日历状态并入运行健康，
  技术原因折叠，版本号不在页面展示。明暗主题跟随 `body[data-ds-dark-theme]`；
  浅色模式的灰阶、表格分隔线、标签/状态文字色单独覆盖，页签选中态用高对比实心胶囊。任务页由
  运行中条、任务表（分类/我的任务筛选、搜索、行内操作菜单）和内置模板区组成：
  `dormant` 的内置任务以模板卡展示，添加后进入任务表；`active` / `paused` 任务与自定义任务留在任务表。
  分类/来源标签与任务标题同排（模板卡标题只带分类标签），超过 12 个字截断，窄屏换到标题下一行；
  模板卡的添加按钮是品牌色实心主按钮，不靠 hover 才可见；筛选计数是圆圈数字，模板区标题只留「模板」。
  进入页面只取 `/meta`（页面壳，含未读徽标）与当前看板的 `/board`；任务、运行与通知列表按页签懒加载，
  首次打开任务 / 运行页签时才渲染与最终布局同轮廓的骨架屏（官方 `--dsw-alias-bg-skeleton` token +
  呼吸动画，`prefers-reduced-motion` 下停用），不得先显示「还没有任务」；刷新与 30 秒轮询也只带页面壳与当前页签，首次请求失败则落在错误 banner + 重试，不留在骨架屏。
  应用空闲时（`requestIdleCallback`，无此 API 时 2 秒后）预取一次默认 14 天看板，每次成功取到默认看板都写模块级快照，重新进入先用快照出内容、再后台校正（其他筛选视图不写快照）；诊断对象 `window.__CA_LAST_TIMING__` 分开记录 `clickToMountMs`（宿主点击 → 页面挂载）与 `mountToBoardMs`（页面挂载 → 看板首帧）。
- 任务简报只在成功且存在 `sessionId` 时入队：先写 `briefs.pending`，再由固定 system prompt 的无工具模型改写；服务端用 `sessionQuery.readSession(sessionId)` 取最后一个有实质结论的主 assistant 文本；若最后一轮只由 `subagent-settled` 通知唤醒且只写了简短确认，则把上一轮非通知答复一并交给简报模型挑选，避免把“本轮没有新增信息”当成终稿，`llm.stream` 必须带 `sessionId`（opencode-go 需要 `x-opencode-session`），模型不读 session、不挂 preset/persona、不写 session，失败不改变运行终态；不回填历史、不扫描旧 run、不用 `run.summary` 凑简报，失败的新简报只提供单条重试。简报校验只保留长度、Markdown/表情/单段与来源引用；长度按字符数（含标点、空格、数字）计，超长时修复请求会带实际字数；不按词表判断买卖建议或语气，内容交给用户判断。
- 任务详情是独立焦点页，不重复全局页头，顶部只留「所有任务」返回条；含概览、配置、运行记录、
  通知四个页签。详情头只保留标题、状态、说明与操作，不再有分类 / 日程摘要行；下次运行、上次结果
  放在四张状态卡里，不再重复整块日程明细；未添加或暂停的任务明确写「当前不会自动运行」，不展示
  会被跳过的下次运行日期；单次任务日期已过写「单次任务已结束」，未来日期因非交易日被跳过写
  「单次任务不会运行」，都不自动改任务状态；失败、运行中、跳过分别着色。配置表单在失焦时逐字段校验，
  字数与错误提示标在字段标题右侧、错误标红；页顶只保留 API / 操作错误，不再集中显示必填错误。
  任务标题与任务分类同行，标题上限 12 个字；任务说明上限 100 个字、固定两行高。任务指令是
  固定高度的纯文本编辑框（不用可拖拽的 textarea，粘贴只进纯文本），与右侧加宽的触发器、工作区
  两栏等高并排，窄屏回落为单列；触发器固定两行：第一行频率单选下拉（每天 / 每周 / 每月 / 单次）
  在左、时间在右，规则控制夹在两者中间——每天留空，每周是可多选的星期菜单（含工作日 / 周末快捷），
  每月是单选日期菜单（1 号 / 月中 / 月末 / 自定义，自定义级联 1–31 日），单次是日期输入；第二行是
  时区下拉与仅交易日开关，切换频率不改变触发器高度；不再显示墙钟长提示；运行上限留在「高级设置」。
  内置模板的覆盖说明不再常驻，分类固定说明只在悬停分类下拉时出现。
  执行环境只列运行模式（自动模式）、工作区与任务分类，不展示内部 preset id、执行策略
  长文或预算子树说明；技术信息直接展开（无折叠按钮，与上方信息用分隔线隔开），保留 profileKey、运行模式、无人值守策略、工作区来源、
  profile 名称与交易日历，版本号不显示。「最近运行」固定 3 条，链接写「完整记录」并留在本任务的
  运行记录页签；每条运行行的错误条数跟在「工具调用」之后，右侧只留取消运行或打开 session
  （打开 session 用主按钮）。配置里的「工作区」从 `/meta` 的 `workspaces` 选择，空值 = 默认专属
  工作区；任务分类同时决定输出结构与通用侧重，不再有独立「输出侧重」；页面只标明运行模式固定为
  「自动模式」。内置模板的指令写覆盖范围与交付口径（不点名工具，也不复制分类输出要求、
  数据纪律与无人值守策略）；旧覆盖层升级时会清理旧指令与遗留 mode，但保留用户真实改过的
  标题、触发与工作区。配置修改即保存：客户端 600ms 防抖后串行 `PATCH /tasks/:id`，字段失焦、
  切换页签、页面隐藏与组件卸载都会冲刷待保存修改；页脚只保留自动保存状态与失败重试，不再有
  保存 / 取消按钮。校验未通过时不提交并提示补全，保存失败保留草稿与错误、可重试；详情刷新或
  其他操作触发的重新读取不得覆盖本地未保存的编辑。服务端接口与校验语义不变，多窗口同时编辑
  仍是最后写入生效。删除自定义任务、休眠内置模板都要二次确认，取消活动运行同样需要确认。任务详情运行中只显示取消；
  未添加的模板用「添加」、已暂停任务用「启用」，二者是主按钮；已启用后「立即运行」是主按钮；
  终态后才开放 session 入口。- 运行页顶部是 12 个月热力卡，按全部/进行中/成功/失败筛选 profile 级运行记录；每行标题
  在前、状态在后，时间、耗时与步骤等元数据在第二行左对齐，错误条数紧跟「工具调用」，
  取消 / session 操作靠右。点击错误条数在行内展开具体错误（消息 + code），摘要不展开——
  结果与过程以 session 为准。可取消活动运行或在终态后打开 session。
  任务通知中心只展示任务级通知（`run_failed` / `run_timeout` / `run_succeeded` /
  `calendar_unavailable` / `todo_triggered` / `todo_needs_human`），默认按 `scope=task` 过滤并只统计这些未读；`/notifications?scope=system`
  仅供诊断查看旧的 `scheduler_standby` 记录。API 的 `scope` 默认 `task`，全部已读也默认只处理任务事件。
- 设置默认值集中在 `automation/defaults.js`；用户级字段走现有 `capital-config` 条目的
  `automation.*` volatile 字段，在插件设置卡片的「投研自动化」格集中编辑（与「数据源」平级），最上面是「默认工作区」下拉（空 = 专属默认工作区），其后才是调度 / 单次运行上限 / 通知；优先级固定为代码默认 → 部署行 → 当前 profile → 任务级覆盖：任务记录里的 `limits` 是可选覆盖层，省略即跟随 profile，只有显式保存过的值才盖过它；新建任务表单也以 profile 值为初始值。默认工作区 id 同样按这个顺序解析，任务显式保存的 `workspaceId` 仍优先。
- 回归：`test/automation-*.test.mjs`（schema/时区/DST/owner/store/route/scheduler/policy/runner/
  calendar-source/组合）+ `test/packaging.test.mjs`。日历上游形状用 `npm run smoke:calendar` 实测，
  不进 `npm test`（测试全部注入假 fetch，不打外网）。改 `automation/` 后跑 `npm test`；改 host 行或
  客户端产物后再跑 `npm run check:dsh` 与 `npm pack --dry-run`，并重启 dsh 进程、刷新浏览器。
