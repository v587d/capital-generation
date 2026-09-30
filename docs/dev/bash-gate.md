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
- **⚠️ 未决（同一份日志暴露的另一件事，比沙箱形状更要紧）**：那 21 次 `pwsh` 是 **Capital 根会话自己**跑的
  （同一文件 `agent-preset/selected = capital-generation`；首行 `session` 记录写的 `standard` 与之矛盾，以
  selected 为准——system message 就是我们的人设）。按上面 ① 根侧 deny 应当让主 Agent 看不到 shell。两种解释
  都还成立，本机无法区分：① deny 在桌面端没生效——`restrictRootAgentTools` 逐名 try/catch 静默跳过、
  outcome 一律记 `restricted`，所以没生效也不会留 warn；② `isCapitalAgent` 在桌面端的根 agent 上判 false，
  整批提前 return。Linux 侧 35 份 Capital 会话日志里没有任何 shell 调用，**那不等于 deny 生效**，只是没触发。
  判据（下一步实测）：在桌面端 Capital 会话里问主 Agent「你手上有没有 pwsh / request_data」——看不见才是
  收住了；看得见而调用被拒，说明 deny 没落地，只是被工具层那道 `delegatedSession` 兜住。
- **写边界也无法单独收窄**：`store.writeContext()` 用调用方 session 的 policy 且要求
  `workspace-write`，而 `describe_dataset` 会用 data_junior 的 session 写 `profile.json`——钉成
  read-only 直接打断它：bash 与 Dataset 管线共用同一把尺子（session policy）。
- 回归：`test/bash-guard.test.mjs`（含「命令内容不参与判定」与两个名字的对等判定）、
  `test/root-tool-policy.test.mjs`
  「bash/pwsh 必须点名」、`test/persona.test.mjs`「平台成对挂载」「纯计算兜底」、
  `test/apply-integration.test.mjs`。
