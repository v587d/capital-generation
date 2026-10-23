# 交付登记与回合归属（`src/chart/events.ts` / `src/chart/delivery.ts`）

> 索引见仓库根 `AGENTS.md` §6.3。改 `src/chart/events.ts`、`src/chart/delivery.ts`、
> `src/chart/present-tool.ts`、`src/index.ts` 的交付 ctx 或会话事件类型之前读这里。
> §编号沿用 `AGENTS.md` 的全局命名空间。

> 事故经过与机制解释住在 `src/chart/events.ts` / `src/chart/delivery.ts` / `src/index.ts` 注释、
> 账本 L11/L14/L34 与 `test/chart-turn-events.test.mjs` / `test/chart-delivery.test.mjs` 用例名里；
> 本文只列判据。

## 6.3 判据

- **交付写在收尾流里，不在工具调用 / 回合钩子里**：auto 模式下 `render_chart` 只回 `chart_ref`；
  `present_charts` 只记录本轮清单（refs 或 task_id，提前调用也安全）。真正的
  `deliverables/presented` 由 `agent/assistant-stream` 的终端 `finish` 帧触发：只有
  `reason.kind === 'stop'`、本次 attempt 没出现 tool-call、inbox 没有可执行消息、且没有运行中的
  直属子 Agent 时才写（`subagent-settled` 通知不算可执行消息）。宿主要等流结束后才 `append('assistant/message')`，所以事件的 seq 必然早于收尾消息——
  这是唯一同时满足"知道这轮是纯文本收尾"与"消息还没落盘"的时机（探针 L34）。
- **⛔ 禁止用回合钩子猜"最终轮"**：在 `turn/start` 补登记会落进被折叠的过程轮（真机
  `session-16129aa9`：5 张图分两轮落在中间轮，最后一轮只剩一句"见上"）；在 `turn-stopping` 补登记
  晚于收尾消息，被客户端 `presentedForClosing` 过滤。也不能只信模型：真机 `session-32e54e60` 在
  junior 尚未结算时提前调用 `present_charts`，随后又继续查询，最终报告落到 turn 16、卡片留在
  turn 14——写入点必须由宿主判定。
- **就绪条件**：`inbox` 的 `next-turn` / `next-step` 里没有可执行消息，且没有
  `activity='running'` 的直属子 Agent（用 `subagent/start` / `subagent/end` 维护同步集合；流回调里
  不能等异步查询）。`subagent-settled` 结算通知不算待处理：它可能在模型已经写收尾答复时才到，
  把它当 pending 会让卡片永远等不到"干净"的 finish；通知同时用来删掉已结算的直属子 Agent。
  真正的 relay / 人类输入仍不写。等待轮不写；写失败不推进"本轮已写"，下一次收尾可重试。
  `present_charts` 的 `readiness` 只在流监听缺失的回退路径上使用，并遵守同一判据。
- **模型没调也交付**：按当前 exchange 自动收集 `created_at >= 最近人类消息时间` 的图表；人类消息
  重置 exchange 与显式清单，旧 exchange 的图不会混进新回答。显式 `present_charts` 选择优先，按
  `chart_id` 合并去重。单次上限 32 张，全部文件写进**同一条**事件（`publishMany`，卡片自行折叠）。
- **主 Agent 独占**：`present_charts` 只由根 preset 的 `tools/present` 行带出（行契约
  `test/family-rows.mjs`）；子 Agent 的工具面由行组合封闭，不挂就没有。**不要给它加运行期名单**——
  §1.3 的授权判据只有 `tool-exec.ts` 一份，根独占靠组合表钉（`test/persona.test.mjs` 的族归属断言）。
  `chart_ref` 仍由 data_junior 汇总回传；refs 因上下文压缩丢失时传 `task_id` 兜底，registry 按 root
  session scope + cwd + task 过滤。
- **fork / branch 的顶层会话是根**：`parentSession` 有两种含义——`origin: 'subagent'` 才是委派谱系；
  用户 fork/branch 的 `parentSession` 只是 seed 谱系。`chartSessionScopeId` 与 `resolveOwnerSession`
  只对 `origin: 'subagent'` 走一跳；否则 branch 的图会记到被 fork 的旧会话，root 自己也解析不到
  `chart_ref`（2026-10-21 审查发现；回归 `chart-artifact-ref` / `chart-turn-events` / `present-tool`）。
- **归属规则仍适用于 `publish()`**（单体载体自动登记与任何手动 publish）：等子 Agent 时主 Agent
  会先结束自己的回合，出图常落在两回合之间 ⇒ 回合打开 → 立即写；没打开 → 寄存。冲刷首选
  `agent/turn-stopping`，**不得退回"下一次 `turn/start` 就冲刷"**（真机 `38bad3f9`：落进过程轮），
  `turn/start` 只在 `turnStoppingActive` 为 false 时兜底；冲刷一律**延到微任务**（`Session.append`
  窗口内再 append 会被拒绝）。
- **⛔ 会话事件词汇表是闭集**（`KNOWN_SESSION_EVENT_TYPES`）：`Session.append` 无法设置
  `ignorable` ⇒ 自定义事件"写时静默通过、冷加载时整份会话打不开"（曾发 `capital/chart-rendered`，
  6 份会话重启后全部打不开；**升级必然重启才暴露**）。回归「契约：交付事件必须是 first-party
  `deliverables/presented`」+ 探针 L11（上游讨论 deepseek-harness #5474）。
- **⛔ cordis ctx 绝不能用 `{ ...ctx }` 展开组装**：`get`/`on`/`effect` 挂在原型上，展开丢它们
  ⇒ 异常被 `catch {}` 静默吞掉 ⇒ 出图成功却零交付事件、零报错。交付 ctx 必须逐项显式转发
  （`src/index.ts` 的 `chartEventContext`，getter 用 `Object.defineProperty`）。回归「ctx 组装」。
- **⛔ 寄存队列按 owner（根会话）归档，不能按 `input.ownerSessionId`**（后者是发起出图的
  specialist 孙会话 ⇒ `flush()` 永远查不到、图永久滞留 pending）。**新用例不要再用同 id 的
  简化拓扑**。
- **发布器进程级单例、队列模块级**（每次调用都惰性调用，新建实例会让寄存与冲刷落在不同实例）；
  发布器只在 auto 模式的收尾流与单体载体的自动登记两条路径上使用，两处共用同一个
  `createChartEventPublisher`。
- **诊断默认关闭，按需 `CAPITAL_CHART_TRACE=1`**：stderr 成对日志 + 产物目录
  `deliverable-trace.txt`；**排查"图表 / 交付行不出现"先开它再复现**，不要靠读代码推断。
- **四处联动（准入 `ROOT_AGENT_DENIED_TOOLS`、交付登记 `CHART_DELIVERABLE_EVENT`、收尾写入点
  `agent/assistant-stream`（探针 L34）、交付步骤 `present_charts` 的行契约），改完全跑
  `npm test` + `npm run check:dsh`**；单独改任一处都会让图表静默不出现或会话无法加载。
