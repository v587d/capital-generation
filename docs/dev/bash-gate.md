# shell 闸门、fs 写口与工具收敛（工具可见性不是权限隔离）

> 索引见仓库根 `AGENTS.md` §1.6。改 shell / tool-fs 行挂载、`src/agents/bash-guard.ts` 或
> `ROOT_AGENT_DENIED_TOOLS` 之前读这里。§编号沿用 `AGENTS.md` 的全局命名空间。

> 2026-10-15 用户决策「开 read、同时保留 bash」：主 Agent 保留 `bash` / `pwsh`（读 skill 分册、
> 纯计算），新开 `read` 读文件；文件写口（`write` / `edit`）不开——落盘只走工具实现。
> `bash` 的本职仍是**纯计算兜底**（`query_dataset` 只有 count/min/max/avg/sum），不是取数通道。

## 1.6 接线与结构件

- **接线**：shell 行 preset 自持、**平台成对**挂载（Linux `tool-bash` / Windows `tool-pwsh`；Web
  平面把 host 层两行都 disabled，Windows 没有 bash-sandbox，只挂 bash 会实际执行 PowerShell），
  主 Agent 与 data_junior 共用（2026-10-15 起不再只给 data_junior）。`enableRunInBackground: false`。
  文件口一颗 `tool-fs`：`read` / `write` / `edit` 全量注册（`read_image` 是包内条件注册，另看宿主
  attachments 服务；`tool-fs-search` 本轮不挂）。allow/deny 名字用 `!!js` 按平台选——`restrict()`
  对未注册名字报错，表现是"创建子 Agent 失败"而非挂载失败。
- **结构件**（都不看命令内容）：① `ROOT_AGENT_DENIED_TOOLS` = 出图三件套 + 十三个出网工具 +
  `write` / `edit`（shell 名 2026-10-15 起**移出**名单，旧钉子随决策迁移，见
  `test/root-tool-policy.test.mjs`）；② `src/agents/bash-guard.ts` 在每个本 preset agent 自己的
  scope 装单调 guard，只拦**必然失败的沙箱升级**（`sandbox_permissions` / `justification`：委派会话
  审批策略固定为 `never`，`decide()` 直接 rejected、answerer 不被调用，模型却收到「user rejected」
  式文案）——被委派或身份不可考的调用方 fail closed，主 Agent 的升级走正常 ask 审批；
  ③ 通用 `subagent` 行 deny 含 shell 槽位 + `read` / `write` / `edit`，否则通用 child 继承 standing
  全部工具、绕过 ①②（`read_image` 刻意不点名：条件注册的名字写进 deny = 创建子 Agent 失败）。
- **fs 写口闸门（2026-10-15，本文声明过的备选方向在写口上落地）**：`registerFsWriteGuard` 在
  插件 ctx 上**全局装一次** `tools.guard()`（guard 按 `exec.agent` 取链路，与实例绑哪层无关），
  调用期拦本 preset 的 `write` / `edit`，文案 `FS_WRITE_READ_ONLY` 指回正路（读用 `read`，数据与
  产物走工具回传，落盘由工具实现完成）。判据 **fail-open**：`composedPreset` 读不到 / 抛错 /
  拿不到 agent 一律放行——全局 guard 判错一次，会把同一进程里开发会话的正当写口一起吃掉。
  `read` 不在名单里，只读口全开（含 `read_image`）。
- **读侧没有结构边界，只有人设边界（2026-10-15）**：写口两层（视图层 deny + 全局调用闸门），读口
  只有一条主 persona 规则（不读 `capital-data/` 落盘、不读 `~/.dsh/`，分册整册读完才算读过）。
  按 `read` 的参数做路径闸门是**假边界**：shell 还在，`cat` 同一个文件不需要任何权限，而沙箱实测
  只拦写不拦读。回归住 `test/persona.test.mjs`「read 的边界」四条——闸门管不到的地方，要写清是谁在管。
- **⛔ 这道闸门不是安全边界，别把它写成边界**：实测沙箱只拦写、不拦读、不拦网络（`SandboxMode`
  词汇表只覆盖文件效果）。`bashGuardReason()` **刻意不解析 `command`**——正则挡不住 `node -e` /
  `python3 -c`，而 node / python 正是引入 bash 的目的。禁区与出网纪律是 data_junior persona 的
  软约束（`# BASH DISCIPLINE`）。真要收紧：换掉 `ctx.shell`（容器 / 远端执行器）或做出网限制。
- **⛔ 闸门认的是两个名字，不是一个**（2026-09-30 实测教训）：`bash-guard.ts` 原先只认 `bash`，
  而 Windows 上模型调的是 `pwsh` ⇒ 判定在 Windows 上**一次都不触发，且不报错**。现在 shell 名字
  只在 `SHELL_TOOL_NAMES`（`src/agents/root-tool-policy.ts`）定义一份，guard 与测试都从它取
  （根侧 deny 不再含 shell 之后，两名字钉子继续住在 guard 判定与文案上）。这仍是 §9.7 那个族：
  同一能力两个入口，回归只喂了接好的那一个。现在 `test/bash-guard.test.mjs` 每条判定对
  `bash` / `pwsh` 各跑一遍，并另有一条断言「preset 挂的每一行 shell，guard 都必须认」。
- **pwsh 侧只量到一半**（2026-09-30 桌面端记录）：一份 Capital 会话日志里有 **21 次 `pwsh` 调用，全部是读**
  （读到 workspace 外的 `~/.dsh/.credentials.yaml`、`app.asar`、`%APPDATA%`）⇒ **「不拦读」在 pwsh 上已实测**；
  「拦写」与「不拦网」两条仍无记录，别把 bash 的结论当 pwsh 的承诺。
- **⛔ 根侧收敛在桌面端整条没走，而 Linux / Web 上是生效的（两端对账，2026-09-30）**：同一段
  `request/header.tools` 与同一份探针记录，两端结果相反——
  探针都报 `preset_id = capital-generation`、`outcome = restricted`、17 颗名字 `restrict()` 没抛错
  （`web_search` / `web_fetch` 两端都抛错＝那个 scope 里压根没有这两个名字，**已从名单清掉**，见 `preset-persona.md` §8.4）；
  而**真发给模型的工具表**：Linux 那 17 颗 **0 颗可见**，桌面端那 17 颗 **一颗不少全在**（并且真的执行了
  21 次 `pwsh`）。结论收窄成一句：**`restrict()` 在桌面端不抛错却没写进这个根 Agent 的链路层**。
  `restrict(filter)` 没有 scope 参数、靠 `scopeOf(this.ctx)` 决定落点，所以"通过 `agent.ctx.tools`
  拿到的实例绑在哪一层"在桌面端（Electron 打包的 `dsh-desktop-host`，同日 13:16:56 那边还抛过
  `INACTIVE_EFFECT`）与 CLI/Web 不同。**这是宿主产品形态差异，不是 restrict 这个 API 天生不能用。**
- **因此桌面端的根侧收敛目前是"看着有、实际没有"**：主 Agent 能自己 `render_chart`（绕过可视化
  gate）、能直接检索（绕过 `web_retriever`）；**只有 Dataset 那一侧还兜得住**，因为它的拒绝发生在
  工具层 `delegatedSession`（调用期），不依赖 restrict 落没落对层。shell 对主 Agent 开放已成
  新契约（2026-10-15），不再算这个洞的泄漏面。**处理决定（2026-09-30，2026-10-15 修订）**：按
  **宿主产品形态差异**对待，本仓**不写平台特判**（`if 桌面端` 那种分支只会把宿主的坑变成我们的
  隐性契约），先等 DSH 侧；在此之前**不许在桌面端声称"已收住"**，README 的 desktop 徽章也只背书
  "装得上、四行运行、取数与自选股可用"。"换成 `tools.guard()` 表达根侧禁令（guard 按 `exec.agent`
  取链路，与实例绑哪层无关）"这个备选**已在 fs 写口落地**（上文 ③）；出图 / 检索名单仍走
  `restrict()`，是否同样迁移等真凭据再说。
- **同族的一条本仓自己的坑，顺手修了**：`scripts/verify-sessions.mjs` 把会话文件名硬编码成
  `session.v3.jsonl.zstd`，而 0.2.0-rc.2 写的是 v4 ⇒ 本机 431 份会话它一份都没读，却打印
  "检查 0 份会话 ✅"。现在挑版本改为按 `session.v<N>` 取最新那份（`scripts/lib/session-files.mjs`
  + 回归 `test/session-files.test.mjs`），且**扫到 0 份就 exit 2 并明说"闸门没有核对任何东西"**——
  0 份从来不等于通过。
- **写边界也无法单独收窄到会话**：`store.writeContext()` 用调用方 session 的 policy 且要求
  `workspace-write`，而 `describe_dataset` 会用 data_junior 的 session 写 `profile.json`——钉成
  read-only 直接打断它：bash 与 Dataset 管线共用同一把尺子（session policy）。模型侧的写口
  由上文 ③ 的调用期闸门收，工具实现侧的落盘不在此列。
- 回归：`test/bash-guard.test.mjs`（「主 Agent 的 shell 调用放行」「命令内容不参与判定」与两个
  名字的对等判定）、`test/root-tool-policy.test.mjs`（「shell 不点名，写口点名」+
  `fsWriteGuardReasonFor` / `registerFsWriteGuard` 用例）、`test/persona.test.mjs`（「平台成对
  挂载」「tool-fs 行」「纯计算兜底」）、`test/apply-integration.test.mjs`（闸门按行为分流 + fs
  写口全局装一次）。
