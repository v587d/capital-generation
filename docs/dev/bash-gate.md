# data_junior 的 bash 闸门（工具可见性不是权限隔离）

> 索引见仓库根 `AGENTS.md` §1.6。改 shell 行挂载、`src/agents/bash-guard.ts` 或
> `ROOT_AGENT_DENIED_TOOLS` 之前读这里。§编号沿用 `AGENTS.md` 的全局命名空间。

> 目的：`bash` 做**纯计算兜底**（`query_dataset` 只有 count/min/max/avg/sum，派生算术没有别的
> 合规路径）。**不是**取数通道。

## 1.6 接线与结构件

- **接线**：shell 行 preset 自持、**平台成对**挂载（Linux `tool-bash` / Windows `tool-pwsh`；Web
  平面把 host 层两行都 disabled，Windows 没有 bash-sandbox，只挂 bash 会实际执行 PowerShell）。
  `enableRunInBackground: false`。allow/deny 名字用 `!!js` 按平台选——`restrict()` 对未注册名字
  报错，表现是"创建子 Agent 失败"而非挂载失败。
- **两道结构件**（都不看命令内容）：① `ROOT_AGENT_DENIED_TOOLS` 含 `bash` / `pwsh`；
  ② `src/agents/bash-guard.ts` 在每个本 preset agent 自己的 scope 装单调 guard，只对**被委派**
  子会话开放，并拦掉 `sandbox_permissions`（委派会话审批策略固定为 `never`，`decide()` 直接
  rejected、answerer 不被调用，模型却收到「user rejected」式文案）。通用 `subagent` 行 deny
  必须含 shell 槽位，否则通用 child 继承 bash 绕过两道 gate。
- **⛔ 这道闸门不是安全边界，别把它写成边界**：实测沙箱只拦写、不拦读、不拦网络（`SandboxMode`
  词汇表只覆盖文件效果）。`bashGuardReason()` **刻意不解析 `command`**——正则挡不住 `node -e` /
  `python3 -c`，而 node / python 正是引入 bash 的目的。禁区与出网纪律是 data_junior persona 的
  软约束（`# BASH DISCIPLINE`）。真要收紧：换掉 `ctx.shell`（容器 / 远端执行器）或做出网限制。
- **⛔ 闸门认的是两个名字，不是一个**（2026-09-30 实测教训）：`bash-guard.ts` 原先只认 `bash`，
  而 Windows 上模型调的是 `pwsh` ⇒ A/B 两层判定在 Windows 上**一次都不触发，且不报错**。根侧
  deny 里本来就有 `pwsh`，所以主 Agent 那条还活着；漏的是子会话侧。现在 shell 名字只在
  `SHELL_TOOL_NAMES`（`src/agents/root-tool-policy.ts`）定义一份，deny 与 guard 都从它取。
  这仍是 §9.7 那个族：同一能力两个入口，回归只喂了接好的那一个。现在
  `test/bash-guard.test.mjs` 每条判定对 `bash` / `pwsh` 各跑一遍，并另有一条断言
  「preset 挂的每一行 shell，deny 与 guard 都必须认」。
- **pwsh 侧只量到一半**（2026-09-30 桌面端记录）：一份 Capital 会话日志里有 **21 次 `pwsh` 调用，全部是读**
  （读到 workspace 外的 `~/.dsh/.credentials.yaml`、`app.asar`、`%APPDATA%`）⇒ **「不拦读」在 pwsh 上已实测**；
  「拦写」与「不拦网」两条仍无记录，别把 bash 的结论当 pwsh 的承诺。
- **⛔ 根侧收敛在桌面端整条没走，而 Linux / Web 上是生效的（两端对账，2026-09-30）**：同一段
  `request/header.tools` 与同一份探针记录，两端结果相反——
  探针都报 `preset_id = capital-generation`、`outcome = restricted`、17 颗名字 `restrict()` 没抛错
  （`web_search` / `web_fetch` 两端都抛错＝那个 scope 里压根没有这两个名字，**已从名单清掉**，见 `preset-persona.md` §8.4；`bash` / `pwsh` 则**恰好成对**：
  Linux 拒 `pwsh`、桌面端拒 `bash`，说明逐名 try/catch 的平台判定是对的）；
  而**真发给模型的工具表**：Linux 那 17 颗 **0 颗可见**，桌面端那 17 颗 **一颗不少全在**（并且真的执行了
  21 次 `pwsh`）。结论收窄成一句：**`restrict()` 在桌面端不抛错却没写进这个根 Agent 的链路层**。
  `restrict(filter)` 没有 scope 参数、靠 `scopeOf(this.ctx)` 决定落点，所以"通过 `agent.ctx.tools`
  拿到的实例绑在哪一层"在桌面端（Electron 打包的 `dsh-desktop-host`，同日 13:16:56 那边还抛过
  `INACTIVE_EFFECT`）与 CLI/Web 不同。**这是宿主产品形态差异，不是 restrict 这个 API 天生不能用。**
- **因此桌面端的根侧收敛目前是"看着有、实际没有"**：主 Agent 能直接跑 shell（读整机 + 写 workspace）、
  能自己 `render_chart`（绕过可视化 gate）、能直接检索（绕过 `web_retriever`）；**只有 Dataset 那一侧
  还兜得住**，因为它的拒绝发生在工具层 `delegatedSession`（调用期），不依赖 restrict 落没落对层。
  **处理决定（2026-09-30）**：这条按**宿主产品形态差异**对待，本仓**不写平台特判**（`if 桌面端`
  那种分支只会把宿主的坑变成我们的隐性契约），先等 DSH 侧；在此之前**不许在桌面端声称"已收住"**，
  README 的 desktop 徽章也只背书"装得上、四行运行、取数与自选股可用"。真要在我们这侧收口，方向是
  换成 `tools.guard()` 表达根侧禁令（guard 按 `exec.agent` 取链路，与实例绑哪层无关，
  `bash-guard.ts` 用的就是它）——**这是备选，不是待办**。
- **同族的一条本仓自己的坑，顺手修了**：`scripts/verify-sessions.mjs` 把会话文件名硬编码成
  `session.v3.jsonl.zstd`，而 0.2.0-rc.2 写的是 v4 ⇒ 本机 431 份会话它一份都没读，却打印
  "检查 0 份会话 ✅"。现在挑版本改为按 `session.v<N>` 取最新那份（`scripts/lib/session-files.mjs`
  + 回归 `test/session-files.test.mjs`），且**扫到 0 份就 exit 2 并明说"闸门没有核对任何东西"**——
  0 份从来不等于通过。
- **写边界也无法单独收窄**：`store.writeContext()` 用调用方 session 的 policy 且要求
  `workspace-write`，而 `describe_dataset` 会用 data_junior 的 session 写 `profile.json`——钉成
  read-only 直接打断它：bash 与 Dataset 管线共用同一把尺子（session policy）。
- 回归：`test/bash-guard.test.mjs`（含「命令内容不参与判定」与两个名字的对等判定）、
  `test/root-tool-policy.test.mjs`
  「bash/pwsh 必须点名」、`test/persona.test.mjs`「平台成对挂载」「纯计算兜底」、
  `test/apply-integration.test.mjs`。
