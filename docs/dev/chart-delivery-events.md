# 交付登记与回合归属（`src/chart/events.ts` / `src/chart/present-tool.ts`）

> 索引见仓库根 `AGENTS.md` §6.3。改 `src/chart/events.ts`、`src/chart/present-tool.ts`、`src/index.ts`
> 的交付 ctx 或会话事件类型之前读这里。§编号沿用 `AGENTS.md` 的全局命名空间。

> 事故经过与机制解释住在 `src/chart/events.ts` / `src/index.ts` 注释、账本「事故记录」与
> `test/chart-turn-events.test.mjs` / `test/present-tool.test.mjs` 用例名里；本文只列判据。

## 6.3 判据

- **交付是模型步骤，不是回合钩子**：auto 模式下 `render_chart` 只回 `chart_ref`（`tools/chart-render`
  不再传 `chartEvents`），主 Agent 在写最终答复前调用一次 `present_charts`，交付事件才落进收尾轮。
  依据是宿主 `deliverables` 卡片的折叠规则：它只重放 `seq < 收尾 assistant 消息 seq` 的
  `deliverables/presented`（`presentedForClosing`）⇒ 事件必须写在最终答复**之前**；在
  `turn-stopping` 里补登记一定被丢掉，`present_charts` 因此是模型可见的一步。
- **⛔ 禁止用回合钩子猜"最终轮"**：DSH 没有"最终轮"概念，一轮是否最终在事件发生那一刻不可知。
  在 `turn/start` 上补登记会落进被折叠的过程轮（真机 `session-16129aa9`：5 张图分两轮落在中间轮，
  最后一轮只剩一句"见上"），在 `turn-stopping` 上补登记则落后于收尾消息、被卡片过滤。唯一可靠
  信号是模型自己"现在要写最终答复了"——这就是 `present_charts` 存在的理由。
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
  发布器只在 auto 模式的 `present_charts` 与单体载体的自动登记两条路径上使用，两处共用同一个
  `createChartEventPublisher`。
- **诊断默认关闭，按需 `CAPITAL_CHART_TRACE=1`**：stderr 成对日志 + 产物目录
  `deliverable-trace.txt`；**排查"图表 / 交付行不出现"先开它再复现**，不要靠读代码推断。
- **三处联动（准入 `ROOT_AGENT_DENIED_TOOLS`、交付登记 `CHART_DELIVERABLE_EVENT`、交付步骤
  `present_charts` 的行契约），改完全跑 `npm test` + `npm run check:dsh`**；单独改任一处都会让图表
  静默不出现或会话无法加载。
