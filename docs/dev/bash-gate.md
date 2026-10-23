# shell / PTC 执行面闸门、fs 写口与工具收敛（工具可见性不是权限隔离）

> 索引见仓库根 `AGENTS.md` §1.6。改 shell / tool-fs 行挂载、`src/agents/bash-guard.ts` 或
> `ROOT_AGENT_DENIED_TOOLS` 之前读这里。§编号沿用 `AGENTS.md` 的全局命名空间。

> 2026-10-15 用户决策「开 read、同时保留 bash」：主 Agent 保留 `bash` / `pwsh`（读 skill 分册、
> 纯计算），新开 `read` 读文件；文件写口（`write` / `edit`）不开——落盘只走工具实现。
> 2026-10-23 起 data_junior 改用宿主 PTC：只挂 `tool-presentation`（`mode: ptc`），不挂 shell；
> 它的程序面是 `run_code`，同样只做工具调度与派生算术，不是取数通道。

## 1.6 接线与结构件

- **接线**：shell 行 preset 自持、**平台成对**挂载（Linux `tool-bash` / Windows `tool-pwsh`；Web
  平面把 host 层两行都 disabled，Windows 没有 bash-sandbox，只挂 bash 会实际执行 PowerShell），
  **只给主 Agent**（2026-10-23 起 data_junior 改挂 `tool-presentation` 的 `mode: ptc`，程序面是
  `run_code`）。`enableRunInBackground: false`。文件口一颗 `tool-fs`（本层只注册 `read`，`write` / `edit` 留在这里不注册——但**这不等于看不见**，见下）。
- **⛔ 行组合管得住的只有"我们自己的工具"与"同名变体的替换"**（2026-10-19 真机实测）：宿主
  `dsh-base` 在 **global 层**挂了 `dsh-tool-bash` / `dsh-tool-pwsh` / `dsh-tool-fs` /
  `dsh-tool-fs-search` / `dsh-tool-subagent-control`(+`/list-agents`) / `dsh-tool-todo` /
  `dsh-tool-web`，而 `ScopedLayers.merge()` 是"global 打底 + 作用域链覆盖**同名变体**"——**本层不注册
  一个名字，不等于把它从视图里删掉**。实测三条：根 preset 的 `tool-fs` 行写着 `write: false /
  edit: false`，手开 Capital 仍看得见 `write` 且真的落盘；手开 资讯 里 `interrupt_agent` 直接执行
  并回了"Agent 不存在"；每一颗模式都有 shell。（同一批表里 资讯 / 行情 没有 `write` / `edit`——
  那两档的可见性成因未实测清楚，但能确定的结论只有一条：指望行 config 收窄宿主面是靠不住的。）
  要减**可见面**只有 `tools.restrict({deny})`（且只对被委派的那一支有效，账本 L32）；要真**拦下**
  只能靠调用级 guard。写口与兄弟名字都属于后者。
- **执行面名字的判据仍要认全集**：shell 两行都声明、靠 `disabled: !!js process.platform …` 互斥，
  再加 PTC 的 `run_code`，所以 `bash-guard.ts` 的闸门必须认 `EXECUTION_ESCALATION_TOOL_NAMES`
  （`bash` / `pwsh` / `run_code`）——只认本平台那颗，另一端就是静默放行（§9.7）。
- **结构件**（都不看命令或程序内容）：① `ROOT_AGENT_DENIED_TOOLS` = 出图三件套 + 十三个出网工具 +
  `write` / `edit`（shell 名 2026-10-15 起**移出**名单，旧钉子随决策迁移，见
  `test/root-tool-policy.test.mjs`；`run_code` 是框架保留名，**不能**进 `restrict()`，根侧看不见只靠
  “部署级 `dsh-tools.mode` 保持 native”）；② `src/agents/bash-guard.ts` 在每个本 preset agent 自己的
  scope 装单调 guard，只拦**必然失败的沙箱升级**（`sandbox_permissions` / `justification`：委派会话
  审批策略固定为 `never`，`decide()` 直接 rejected、answerer 不被调用，模型却收到「user rejected」
  式文案）——被委派或身份不可考的调用方 fail closed，主 Agent 的升级走正常 ask 审批；
  ③ 角色工具面由 preset 挂的**族行**表达（D0，2026-10-19：`src/agents/role-tool-policy.ts` 那份
  整批 allow 已删，只剩逐名减掉 `tool-subagent-control` 焊进来的 `interrupt_agent`；2026-10-18
  通用 child 连同它的 deny 名单一起删除）：**本仓当前由 preset 族行暴露的 27 颗工具**谁能使，
  只看哪颗 preset 挂了哪几行
  ——挂漏 = 该角色整族用不上（fail-closed），多挂一行才是越权。宿主自带的名字不在这套判据里
  （上面那条⛔），`read_image` / `find` / `glob` / `grep` / `ls` / `todo_write` 这些条件注册或
  global 注册的名字因此**不进任何清单**，别处也没有第二份名字表要维护。
- **fs 写口闸门（2026-10-15 提出，2026-10-19 才真的在场）**：`registerFsWriteGuard` 在插件 ctx 上
  **全局装一次** `tools.guard()`（guard 按 `exec.agent` 取链路，与实例绑哪层无关），
  调用期拦**本插件任一 preset**（根 + 五颗角色）的 `write` / `edit`，文案 `FS_WRITE_READ_ONLY` 指回正路（读用 `read`，数据与
  产物走工具回传，落盘由工具实现完成）。判据 **fail-open**：`composedPreset` 读不到 / 抛错 /
  拿不到 agent 一律放行——全局 guard 判错一次，会把同一进程里开发会话的正当写口一起吃掉。
  `read` 不在名单里，只读口全开（含 `read_image`）。⛔ 这颗 guard 依赖 `capital-policy` 行的
  `export const inject = ['tools']`（账本 L33）：没声明时 `ctx.get('tools')` 在 boot 期是
  `undefined`、属性访问抛错被 try/catch 吞掉，**闸门整批静默不装**——2026-10-15 到 2026-10-19
  的真实状态就是这样，掩护它的是视图层那条 `tool-fs` 行级 `write: false`（而那条本身也拦不住
  宿主 global 层那一份）。运行期反证住 `npm run smoke:boot`（数宿主 global guard 层里的颗数）。
- **⛔ 按人设的调用级闸门一律全局装、在调用期现读身份**（2026-10-19）：与 fs 写口同形的共三颗——
  `registerFsWriteGuard`（`write` / `edit`）、`registerRootOcrGuard`（`ocr` 的 `url` 形态）、
  `registerRoleSiblingGuard`（`interrupt_agent`）。**判据不许挂 `agent/created`**：宿主先建 Agent、
  后选人设（账本 L32），created 那一刻读到的还是创建默认值，手开模式一次都不会被拦。三颗都按 root
  去重、都 fail-open、拒绝都记进 `dc_status` 的 `agent_tool_policy`（`outcome=guard-denied`，`root`
  照实记会话形状）。回归 `test/policy-dedup.test.mjs`（各装一次）+ `test/apply-integration.test.mjs`
  （走生产装配逐颗放行 / 拒绝，含"检索人设的 `ocr` url 形态放行"这条——判据是人设，不是会话拓扑）。
- **读侧没有结构边界，只有人设边界（2026-10-15）**：写口两层（视图层 deny + 全局调用闸门），读口
  只有一条主 persona 规则（不读 `capital-data/` 落盘、不读 `~/.dsh/`，分册整册读完才算读过）。
  按 `read` 的参数做路径闸门是**假边界**：shell 还在，`cat` 同一个文件不需要任何权限，而沙箱实测
  只拦写不拦读。回归住 `test/persona.test.mjs`「read 的边界」四条——闸门管不到的地方，要写清是谁在管。
- **⛔ 这道闸门不是安全边界，别把它写成边界**：实测沙箱只拦写、不拦读、不拦网络（`SandboxMode`
  词汇表只覆盖文件效果）。`bashGuardReason()` **刻意不解析 `command` / `code`**——正则挡不住
  `node -e` / `python3 -c` / 动态 `import()`，而 node / python 正是引入程序面的目的。禁区与出网纪律
  是 data_junior persona 的 `# PROGRAM DISCIPLINE` 软约束。真要收紧：换掉 `ctx.shell` / PTC runtime
  （容器 / 远端执行器）或做出网限制。
- **⛔ 闸门认的是执行面全集，不是一个名字**（2026-09-30 实测教训）：`bash-guard.ts` 原先只认 `bash`，
  而 Windows 上模型调的是 `pwsh` ⇒ 判定在 Windows 上**一次都不触发，且不报错**。现在 shell 名字
  只在 `SHELL_TOOL_NAMES`（`src/agents/root-tool-policy.ts`）定义一份，`run_code` 由
  `EXECUTION_ESCALATION_TOOL_NAMES` 并进来，guard 与测试都从它取（根侧 deny 不再含 shell 之后，
  名字钉子继续住在 guard 判定与文案上）。这仍是 §9.7 那个族：同一能力多个入口，回归只喂了接好的
  那一个。现在 `test/bash-guard.test.mjs` 每条判定对 `bash` / `pwsh` / `run_code` 各跑一遍，
  并另有一条断言「preset 挂的每一行 shell，guard 都必须认」。
- **pwsh 侧只量到一半**（2026-09-30 桌面端记录）：一份 Capital 会话日志里有 **21 次 `pwsh` 调用，全部是读**
  （读到 workspace 外的 `~/.dsh/.credentials.yaml`、`app.asar`、`%APPDATA%`）⇒ **「不拦读」在 pwsh 上已实测**；
  「拦写」与「不拦网」两条仍无记录，别把 bash 的结论当 pwsh 的承诺。
- **⛔ 根侧收敛在桌面端整条没走，而 Linux / Web 上是生效的（两端对账，2026-09-30）**：同一段
  `request/header.tools` 与同一份探针记录，两端结果相反——
  探针都报 `preset_id = capital-generation`、`outcome = restricted`、17 颗名字 `restrict()` 没抛错
  （`web_search` / `web_fetch` 当时都抛错＝那个 scope 里没有这两个名字；2026-10-20 起 AnySearch 会在
  web profile 补注册 `web_fetch`，见 `preset-persona.md` §8.4）；
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
- 回归：`test/bash-guard.test.mjs`（「主 Agent 的 shell / run_code 调用放行」「命令与程序内容不参与
  判定」与三个名字的对等判定）、`test/root-tool-policy.test.mjs`（「shell 不点名，写口点名」+
  `fsWriteGuardReasonFor` / `registerFsWriteGuard` 用例）、`test/persona.test.mjs`（「平台成对
  挂载」「tool-fs 行」「program discipline」）、`test/ptc-preset.test.mjs`（只有 junior 有
  presentation 行、无 shell 行）、`test/apply-integration.test.mjs`（闸门按行为分流 + fs
  写口全局装一次）。
