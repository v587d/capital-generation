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
- **⛔ 根侧收敛在桌面端整条没走（2026-09-30 硬证据，不再是推断）**：同一份 `session.v4.jsonl` 里
  `request/header` 带的是**真发给模型的工具表**，桌面端 Capital **根**会话那一份有 40 颗，其中
  `pwsh`、`render_chart`、`anysearch_search` 等**本该被 deny 的 17 颗全在**——`ROOT_AGENT_DENIED_TOOLS`
  一个都没落地。（`request_data` / `dc_status` 也在表里，但那**是设计如此**：Dataset 系列从来不在 deny
  名单里，靠工具层 `delegatedSession` 在调用那一刻拒，别把它当成 deny 失效的证据去改名单。）
  所以这不是"shell 漏了"而是"整条 `registerRootToolPolicy` 没生效"。**2026-09-30 第二轮取证把它
  再往前推了一步，而且推翻了"没生效"的三种猜测里的两种**：新构建里 `dc_status` 的现场记录显示
  `preset_id = capital-generation`、`outcome = restricted`、**17 颗名字 `restrict()` 都没抛错**
  （`web_search` / `web_fetch` / `bash` 三颗抛错＝那个 scope 里压根没有这些名字，Windows 上没有
  `bash` 那行，符合预期）——**可同一台机器真发给模型的工具表里，那 17 颗一颗不少地全在**。
  结论收窄成一句：**监听触发了、预设判对了、`restrict()` 调用成功了，可见面却纹丝不动**。
- **⛔ 因此 `tools.restrict()` 不是本仓可依赖的收敛手段**（在能重新取证之前都不要加回它然后宣称收住了）。
  上游对它的语义写得很清楚（`dsh-tools`：*restriction 只过滤 scope **继承**来的工具，**从不过滤本层自己
  注册的***；而 `view()` 会把 own 层的工具无条件放回可见面），且 `restrict(filter)` **没有 scope 参数**、
  靠 `scopeOf(this.ctx)` 决定写进哪一层——"通过 `agent.ctx.tools` 拿到的实例到底绑的是哪一层"从外部
  看不出来。对比之下 `tools.guard()` 是按 `exec.agent` 取链路的，**这才是有正确 per-agent 语义的那个**
  （`bash-guard.ts` 用它，理由就写在这一节上面）。
- **写边界也无法单独收窄**：`store.writeContext()` 用调用方 session 的 policy 且要求
  `workspace-write`，而 `describe_dataset` 会用 data_junior 的 session 写 `profile.json`——钉成
  read-only 直接打断它：bash 与 Dataset 管线共用同一把尺子（session policy）。
- 回归：`test/bash-guard.test.mjs`（含「命令内容不参与判定」与两个名字的对等判定）、
  `test/root-tool-policy.test.mjs`
  「bash/pwsh 必须点名」、`test/persona.test.mjs`「平台成对挂载」「纯计算兜底」、
  `test/apply-integration.test.mjs`。
