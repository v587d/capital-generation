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
- **写边界也无法单独收窄**：`store.writeContext()` 用调用方 session 的 policy 且要求
  `workspace-write`，而 `describe_dataset` 会用 data_junior 的 session 写 `profile.json`——钉成
  read-only 直接打断它：bash 与 Dataset 管线共用同一把尺子（session policy）。
- 回归：`test/bash-guard.test.mjs`（含「命令内容不参与判定」）、`test/root-tool-policy.test.mjs`
  「bash/pwsh 必须点名」、`test/persona.test.mjs`「平台成对挂载」「纯计算兜底」、
  `test/apply-integration.test.mjs`。
