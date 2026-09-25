# 交付登记与回合归属（`src/chart/events.ts`）

> 索引见仓库根 `AGENTS.md` §6.3。改 `src/chart/events.ts`、`src/index.ts` 的交付 ctx 或会话事件
> 类型之前读这里。§编号沿用 `AGENTS.md` 的全局命名空间。

> 事故经过与机制解释住在 `src/chart/events.ts` / `src/index.ts` 注释、账本「事故记录」与
> `test/chart-turn-events.test.mjs` 用例名里；本文只列判据。

## 6.3 判据

- **归属规则**：等子 Agent 时主 Agent 会**先结束自己的回合**，出图常落在两回合之间 ⇒ **回合打开
  → 立即写；没打开 → 寄存**。冲刷首选 `agent/turn-stopping`，**不得退回"下一次 `turn/start` 就
  冲刷"**（真机 `38bad3f9`：落进过程轮），`turn/start` 只在 `turnStoppingActive` 为 false 时兜底；
  冲刷一律**延到微任务**（`Session.append` 窗口内再 append 会被拒绝）。
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
- **发布器进程级单例、队列模块级**（每次 `render_chart` 惰性调用，新建实例会让寄存与冲刷落在
  不同实例）；**DSH 没有"最终轮"概念**：一轮是否最终在事件发生那一刻不可知，`data.turn` 是唯一
  归属手段——写尚未开始的 turn 安全，但**猜轮号**会让交付行静默消失；要落进"总结轮"，正解是在
  `turn-stopping` 上叠加"该轮无新委派 / 子树空闲"闸门。
- **诊断默认关闭，按需 `CAPITAL_CHART_TRACE=1`**：stderr 成对日志 + 产物目录
  `deliverable-trace.txt`；**排查"图表 / 交付行不出现"先开它再复现**，不要靠读代码推断。
- **两处联动（准入 `ROOT_AGENT_DENIED_TOOLS` + 交付登记 `CHART_DELIVERABLE_EVENT`），改完全跑
  `npm test` + `npm run check:dsh`**；单独改任一处都会让图表静默不出现或会话无法加载。
