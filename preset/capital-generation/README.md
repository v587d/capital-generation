# 自动模式 preset：组合设计说明

本文件是 `agent.patch.yml`（那六颗 `@deepseek-ai/dsh-agent-preset` 声明行）的**维护者文档**（人类可读），
不是模型可见内容：`skill-filesystem` 只扫 `skills/`，本文件既不会进 skill 目录，也不会被注入上下文。
组合文件里只留"就地必需"的一行注（realm、`!!js`、disabled 行），其余设计理由都在这里。

- 本目录由 `@v587d/capital-generation` 随包分发，`agent.patch.yml` 走 `package.json` 的
  `dsh.bundle.patch`（**数组**：主 patch + 这一份 yml，六颗声明行都在里面）以 `trust=system`
  挂载；**不要**手抄进 `~/.dsh/.agent-presets`。
- 长协议在 `skills/`（同目录），由本 preset 自己的 `skill-filesystem` 行发现；`capital-visualization-protocol` 同时供 data_junior 的 gate 和 visualization_specialist 按需加载。
- visualization_specialist 是 data_junior 委派出图的子 Agent（0.2.1 起所有子会话都是异步 continuable，没有 one-shot / 前台模式），不进入主 Agent 的 direct-child 复用清单；它只消费 chart_source_ref 并使用受控 render_chart。
- data_junior 的质检与可视化 gate 对每份结构化 Dataset 都执行，用户是否要图不是触发条件；显式「不要图」只收窄出图，不跳过 profile。
- 验证方式与"改 preset 前后的必做检查"见仓库根 `AGENTS.md` §8.3；设计理由与「不许改」全表见
`docs/dev/preset-persona.md`。

## 1. 平面纪律（plane discipline）

- `subagents` 注册表与它的 spawn/fork 后端住在 **host 组合**；本 preset 只贡献模型侧的
  委派工具行，它们解析 host 那一份注册表。本文件**没有**挂 `subagent_fork` 行，所以委派
  永远是 continuable 的 `spawn` provider。
- 本 preset 拥有的服务必须落在组行的 `isolate` realm 内（见第 4 节）；只消费 host 能力的
  行必须留在 realm 外，否则解析不到服务。

## 2. 人设（persona）承载与官方语义

实测 `dsh 0.2.1-rc.2`（`test/persona.test.mjs` 对着本机 dsh 核对字段名），两层载体注册的是
**同一个 system-prompt 节名**：

| 载体 | 位置 | 字段 | 生效范围 |
|---|---|---|---|
| `dsh-system-prompt` 行 | 部署（web profile） | `personaPrefix` / `personaSuffix` | 全局 |
| `dsh-persona` 行 | **每颗 preset 自己**（根 + 五颗角色，各一行） | `prefix`（必填）/ `suffix` / `complete` / `includeRuntimeContext` | 该 preset 组出来的 agent |

- 节名是 `deployment:persona-prefix`（order 0）与 `deployment:persona-suffix`（order
  10200）。**最近 scope 胜出 ⇒ 是覆盖不是追加**：0.2.1 起委派行**不再带 `config.persona`**
  （`tool-subagent: persona is no longer supported; configure persona … in an Agent Preset and
  select it with agentPreset`），子人设因此住在角色 preset 自己的 `dsh-persona` 行里，子 Agent
  组出来的那一颗 generation 覆盖同名节——效果与旧写法一致：**替换**（不是扩展）主 persona。
- `prefix`/`suffix` 是模板，渲染时对 `{{…}}` **严格插值**：未注册或 undefined 的变量会抛错，
  而且抛的是**整个会话的系统提示组装**，不是"这一段不显示"。可注册的变量以本机为准——
  0.2.1 的 `dsh-agent-loop` 只注册 `provider` / `model`（0.2.0 还有的 `cwd` **已被上游删掉**，
  真机踩过一次：`unknown prompt variable "{{cwd}}" in section "deployment:persona-prefix"`）。
  `test/persona.test.mjs` 现读本机注册表钉这条闸门，正文里写了少掉的变量会在 `npm test` 就红。
- 本 preset **不设 `suffix`**：按官方语义，空模板**仍然遮蔽**部署级后缀，所以部署那句
  "Your working directory is …" 在 Capital 会话里不出现；工作目录改由主 persona 自己用
  **文字**说明（本会话选定的 workspace 根目录），不再引用已经不存在的变量。这是有意为之，不是漏配。
- `complete: true` 会把其余所有段落（身份、工具引导、后缀）一并抑制；`includeRuntimeContext:
  false` 全有全无地关掉沙箱/审批/委派等 runtime context。本 preset 都不用。
- 成本：persona 正文每个请求都重复；`prefix` 变化会让 KV cache 从第一个变化 token 起失效。
  所以正文按"每轮都要生效"的门槛收，参考材料一律外置。

## 3. 按需协议：什么进 persona、什么进 skills/

- **必须常驻 persona**：每轮预检、复用/创建判定、路由、权限边界、叶子边界、安全底线、
  第一条 duty（先加载协议）、最小载荷骨架。这些要在"模型还不知道本轮要做什么"之前生效，
  而 skill 只在模型决定加载时才生效。
- **按需进 `skills/`**：载荷 JSON 样例、字段级规则、`error/code → 处置`表、四态事实怎么读、
  QuerySpec 细则、检索收敛法则、官方域名核验清单、回传格式范例。
- **子 Agent 也能按需加载**：每颗角色 preset 自己挂 `@deepseek-ai/dsh-tool-skill` 行（四颗在用角色都有；预留的
  `capital-data-analyst` declaration 已 disabled，恢复时要去掉 `disabled`），子 Agent 就同时拿到
  目录与加载器。判据在 `dsh-tools` 的 `view()`：restriction 过滤**继承层（全局 + 全部祖先
  scope，含 preset 层）**，只豁免"本 scope 自己注册的"工具；而 `dsh-tool-skill` 发布目录的
  条件正是 `ctx.tools.get('skill', agent) === 该注册对象`。源码注释里记着这段历史坑
  （"Once presets moved them onto the agent plane they became an ANCESTOR contribution, so a
  child's filter silently stopped constraining anything it was given"）——它既是"子 Agent
  默认看不到 skill"的原因，也是放开它的唯一开关。
- **维护者理由不进 `skills/`**：任何放在 `skills/` 的东西都会拿到一条常驻目录项
  （name + ≤500 字 description）并可被模型加载。设计理由写在本文件。

## 4. realm 与服务归属

- `capital-generation-scope`（`cordis:group` + `isolate: { dataCollectorHub: true,
  datasetStore: true }`）：插件 `apply` 里 `ctx.provide` 的两个服务是进程级名字，
  必须按 session 隔离，否则第二个 Capital 会话注册时冲突。
- `compaction` 组（`isolate: { compaction: true, toolResultPruner: true }`）：
  `compaction-basic` 通过 `ctx.get` 读 `toolResultPruner`，两者必须同处一个 realm；
  `tokenMeter` 留在宿主平面。
- skills 注册表在 **host 平面并按 scope 分层**：`skill-filesystem` / `tool-skill` 只注册进
  本 preset 那一层，**不需要** realm。
- **图表前端组件（`capital-charts` 行）刻意在 host 平面、且不在任何 realm 里**：
  客户端 bundle 必须在页面启动时就存在（boot graph 在 index.html 渲染时确定），
  所以它不能是本 preset 的行。反过来，本插件的 `apply` 通过 `ctx.get('capitalCharts')`
  消费它——`isolate` 只重映射**列出**的服务名（`cordis-plugin-loader/src/config/isolate.ts`：
  `if (!label) return`），其余名字沿原型链向外解析，因此跨平面消费成立。
  这一条与"realm 里的行不能消费外面的服务"并不矛盾：那条规则说的是**提供方**在 realm 内、
  消费方在 realm 外的情况。
- **时间轴换算不在 preset 里，在宿主插件里**（`src/data-collector/time-axis.ts`）。理由与
  "为什么这几个服务归宿主"同源：它是**确定性计算**，且**有三个入口**必须共用同一份答案——
  profile 写出的 `time_facts`（`store.ts`）、工具边界收到的日期筛选值（`dataset-tools.ts`）、
  `resolve_data_time_range` 的 Dataset 形态（`time/tools.ts`）。写进 persona 或 skill 只会变成
  "请模型自己算"的口头约定（实测单步思考 41,961 字符全是时间戳算术）；在 preset 侧再定义一个
  模型工具则会把同一套偏移推断实现第二遍。放进宿主后，模型只需要写 `2026-08-23`。

## 5. 各行的作用与坑

- `agent-instructions`：注入 `AGENTS.md` / `CLAUDE.md`（宿主行在本 profile 被关，由 preset
  自持，`maxBytes: 16384`）。没有它，工作区约定对 Capital 会话不可见。
- `tool-result-pruner`：`thresholdChars: 8192`（head 4096 + tail 1024）。真实后果是
  **能力目录与工具结果超过阈值时中间段被剪掉**；`test/data-collector-hub.test.mjs` 因此用
  "目录 6144 + 单能力详情 4096"两道测试预算，让测试先失败而不是运行时静默截断。该阈值
  **不能按 Agent 区分**（全仓只有这一个 pruner 实例），主/子 Agent 共用。
- **工具面 = preset 挂的行**（D0，2026-10-19）：`toolFilter` 已从委派行删除，上游报错原文指明的
  替代是「persona 与工具插件改住 Agent Preset，委派行只用 `agentPreset` 选它」——这一条我们做到底：
  本仓当前由 preset 族行暴露的 27 颗模型工具，按族拆成
  `@v587d/capital-generation/tools/<family>` 的 subpath 入口行
  （`package.json` 的 `exports`），每颗 preset 只挂自己那几族，**不再有运行期名字级 allow 名单**。
  行契约（那一行注册哪些名字）只有一份，住 `test/family-rows.mjs`：`test/family-entries.test.mjs`
  拿它实测每个入口注册了什么，`test/persona.test.mjs` 拿它核对 YAML 的组合结果。
  - collector：`tools/collect` + `tools/time`；junior：`tools/dataset-read` + `tools/chart-source` +
    `tools/time`；specialist：`tools/chart-render` + `tools/time`；retriever：`tools/retrieve-search` +
    `tools/retrieve-sources` + `tools/ocr` + `tools/time`；根：`tools/time` +
    `tools/ocr` + `tools/watchlist` + `tools/root-extras`（最后一行一颗工具都不带，只挂精选
    skills 的 provider 与用户自定义人设分节）。**`tools/time` 每颗 preset 都挂、且不带任何行配置**：
    通用能力不按角色裁（2026-10-19 决策，retriever 那颗继承自 0.2.0 `toolFilter` 的
    `localDatetime: false` 已删——行契约里没有开关，写了就是"以为裁了、其实没人读"）。
  - 运行期只剩**一格**：`tool-subagent-control` 把 `send_message` 与 `interrupt_agent` 焊在同一行，
    而宿主没给那颗行开成员开关，叶子角色逐名 tolerant deny 减掉那个兄弟
    （`src/agents/role-tool-policy.ts` 的 `SIBLING_DENIED_TOOLS`）。它不是工具面清单。⛔ 那一格只减
    **被委派子会话**的可见面：手开的角色会话上 restrict 减不掉它（时机见账本 L32），所以执行期另有
    一颗全局 `tools.guard()`（`registerRoleSiblingGuard`）兜住同一颗名字。
- **⛔ 行名与 deny 名的两种失效形状都是静默的**：族行名写错 / 包导出漏了 ⇒ 那一行装载失败
  （只打一行 warn），该角色**少一整族**工具；`deny` 里的名字本作用域看不见 ⇒ 逐名跳过，只少减
  那一个并记进 `failed`（这是它相对旧"整批 allow"的差别：错一个名字不再等于完全不收敛）。
  两道补偿：`test/family-entries.test.mjs` 把 `package.json` 的 `exports` 与行契约对表，
  `dc_status` 的 `agent_tool_policy` + `session_identity` 把现场带回会话侧。
- **⛔ 没有通用 `subagent` 行**（2026-10-18 用户决策：没有明确场景就不该有「其他」，它的 34 名
  `deny` 名单一起删）。"谁能碰什么"因此始终是**正面清单**：deny 是 fail-open（漏写就等于有权限，
  2026-09 的出图绕过就是这么走的），行组合是 fail-closed（多挂一行才越权）。**禁止**以任何形式
  恢复通用委派行，也禁止把那一格兄弟 deny 长成工具面清单；回归 `test/persona.test.mjs`
  「委派出口只有专用角色」「组合表：每颗 preset 挂的族行必须恰好是这几行」与
  `test/role-tool-policy.test.mjs`。
- **出网那十三颗只由 retriever 挂的两行带出来**，其余角色没挂就拿不到；根 preset 不挂
  `tools/retrieve-search` / `tools/retrieve-sources`，可见性在组合期封闭。
  `src/agents/root-tool-policy.ts` 的 `RETRIEVAL_DENIED_TOOLS` / `ROOT_AGENT_DENIED_TOOLS` 作为
  单体载体与回归兜底保留（host policy 对 root 传 `deny:false`），**新增来源只改族行与行契约**。
  **`ocr` 那一行由根与 retriever 各挂一次**：主 Agent 要能解析用户 `@` 进来的本地文档；host 的
  `installRootOcrGuard` 只拒它的 `url` 形态，retriever 侧拿到完整形态
  （见 §4.3 → `docs/dev/web-retriever.md`）。
  **宿主自己挂的 `web_search` / `web_fetch` 不由本插件注册**：2026-09-30 双端实测当时的作用域里
  没有这两个名字，所以从 `ROOT_AGENT_DENIED_TOOLS` 清掉；但 2026-10-20 的 web profile 里 AnySearch
  会补注册 `web_fetch`，它因此出现在所有 preset 的工具表里。**没挂行不等于看不见**：要收窄就加回根侧/
  角色名单（逐名 restrict 容忍 absent），或关掉宿主 provider；别拿组合表当宿主工具的隔离证明。
- 不用 `dsh-time-context` 行：它每个 step 自动注入时钟读数，与自研 `get_local_datetime`
  重复；时间读数只来自后者（会话组作用域内注册，主 Agent 与全部子 Agent 共享，支持
  `timezone` 换算）。
- `data_analyst` 的 preset 与委派行都保持 `disabled`（2026-10-18 用户要求先停用，等价于注释）。
  恢复前置条件（缺一不可）：宿主先实现 Python runner 与 coding 工具；插件注册 `read_profile`
  （新工具必须先有族行带它、行契约同步）；更新 `AGENTS.md`、`docs/dev/data-roles.md` 与
  `test/persona.test.mjs` 的预留期断言。

## 5.1 shell 与文件口：主 Agent 保留 shell，data_junior 用 PTC（2026-10-15 / 2026-10-23）

- **动机**：`query_dataset` 只有 `count/min/max/avg/sum`，变化量 / 增幅 / CAGR / 比值这类派生
  指标没有宿主工具；模型只能拿 `time_facts.first/last` 心算——那正是 §1.3 那次 41,961 字符
  时间戳心算的同型浪费。所以给 data_junior 一个程序面。**不是**给它开取数通道。
- **2026-10-15 起主 Agent 也持有 shell 与 `read`**（用户决策「开 read、同时保留 bash」，推翻
  2026-09-30 的"主 Agent 不给 shell"）：主 Agent 需要 `read` 读 skill 分册与工作区文件
  （此前只能 `bash cat`，能力等价但绕远），shell 保留纯计算兜底。`ROOT_AGENT_DENIED_TOOLS`
  里的 `bash` / `pwsh` 随之移出，名单改为出图三件套 + 十三个出网工具 + `write` / `edit`。

### 5.1.1 PTC：只给 data_junior，主 Agent 仍是 native

- **一行怎么落**：junior preset 挂 `@deepseek-ai/dsh-agent-tool-presentation`（`mode: ptc`），
  同时删掉 `tool-bash` / `tool-pwsh`。宿主 `ptc-runtime` 由 `dsh-base` 提供，preset 写不进去；
  `smoke:boot` 同时断言 presentation 行 `fiberState=2` 与 `ctx.get('ptcRuntime')` 在场。
- **为什么删 shell 而不是并存**：PTC SDK 在可见 `bash` 时会主动塞一条 `tools.bash({command:'pwd'})`
  示例，并存等于官方提示词把模型往 shell 引；junior 只需要一个执行面。主 Agent 仍是 native，
  拿到的是原生 shell，根侧 `restrict()` 不能点名保留名 `run_code`（只在部署级 `tools.mode`
  被改成 `ptc` 时才会出现，本仓只允许 preset 行）。
- **省的是回合与抄写，不是安全升级**：`run_code` 里的 Node 仍能 `import('node:fs/promises')` /
  `fetch` / `child_process`；宿主沙箱只拦写。`# PROGRAM DISCIPLINE` 与
  `capital-data-query` §3.3 是纪律，不是边界；要硬隔离只能换容器 / VM / 远端 runtime。
- **结果体积不变**：describe 仍是 7000 码点小回执 + hint；`run_code` 外层只过宿主 pruner（8192），
  本仓不新设第二道闸门。per-call（每次新进程）是默认，不使用 `persistent-in-memory`。
- **回滚**：整颗改动（composition 行 + persona + 三册 skill + guard）是一个 commit；回滚后
  junior 回到 bash + native，恢复两行 YAML 与 `# BASH DISCIPLINE` 即可。
- **文件写口不开，但"不开"靠的是调用级闸门，不是行配置**：根 preset 那行 `read: true /
  write: false / edit: false` 只决定**本层变体**——2026-10-19 实测手开 Capital 里 `write` 仍在工具表
  中且真的落盘，缺席不等于移除（`ScopedLayers.merge` 用 global 打底，账本 L33）。所以拦下写口的只有一颗：全局 `tools.guard()`
  （`registerFsWriteGuard`，判据 = 调用期 `composedPreset` ∈ 本插件任一 preset，fail-open，细节见
  `docs/dev/bash-gate.md` §1.6）。`ROOT_AGENT_DENIED_TOOLS` 里的 `write` / `edit` 只在**被委派**
  那一支减得到可见面，且生产装配以 `deny: false` 注册、不提交名单。理由：主 Agent 唯一对用户说话、
  又会读到子 Agent 回传（含网页材料），写文件等于给"注入 → 落盘 → 被别的环节读回"开口；业务落盘
  本来就有正路（`store.writeContext` 等工具实现）。角色一侧同一条判据：本插件的六颗 preset 一律
  不许直接写文件，原始 rows 也永不出工具层。
- **平台成对挂载**：Windows 上 host 层挂的是 `pwsh-sandbox`，没有 `bash-sandbox`；只挂
  `tool-bash` 会让名为 bash 的工具实际执行 PowerShell。所以两行互补 `disabled: !!js`。
  0.2.1 起这份 YAML 里不再出现工具名，shell 名在 `src/agents/root-tool-policy.ts` 的
  `SHELL_TOOL_NAMES` 定义一份，`bash-guard.ts` 再并进 `run_code`；
  `test/bash-guard.test.mjs` 钉"preset 挂的每一行 shell，闸门都必须认"，
  成对挂载与后台执行那一格仍由 `test/persona.test.mjs`「shell 行：平台成对挂载……」看着。
  2026-10-23 起 junior 不再挂这两行，成对挂载只剩主 Agent。
- **不给后台执行**：`enableRunInBackground: false`。本 preset 不挂 `tool-jobs`，开着后台只会让
  模型拿到一个永远读不回来的 jobId（本 preset 压根没挂 `tool-jobs` 那一行）。
- **执行面闸门只剩一层，且不是安全边界**（`src/agents/bash-guard.ts`）：拦掉
  `sandbox_permissions` / `justification`——被委派会话的审批策略由框架固定为 `never`，升级必然
  失败，而且模型会收到「the user rejected…」这种把系统拒绝说成用户拒绝的文案；被委派或身份
  不可考的调用方 fail closed。主 Agent 的升级走正常 ask 审批（2026-10-15 前的"只对被委派子会话
  开放"一层随决策移除，断言迁移见 `test/bash-guard.test.mjs`）。**刻意不解析 `command` / `code`**：
  本仓实测沙箱只拦写、不拦读（`~/.dsh/.credentials.yaml` 与 `sessions/**` 整机可读）、不拦网络
  （`curl` 直连 200），而正则挡不住 `node -e` / `python3 -c` / 动态 `import()`——那正是引入程序面的
  目的。禁区与出网纪律是 data_junior persona 的 `# PROGRAM DISCIPLINE` 软约束。
- **写边界收不窄到会话**：`store.writeContext()` 用**调用方 session** 的 policy 且要求
  `mode ∈ {workspace-write, danger-full-access}`，而 `describe_dataset` 会用 data_junior 的会话写
  `profile.json`；把它的会话钉成 `read-only` 会直接打断 describe_dataset。`run_code` / bash 与
  Dataset 管线共用同一把尺子（session policy），所以模型侧写口只能靠上一条的调用期闸门收。
- **要真正收紧**只有两条路：换掉 `ctx.shell`（容器 / 微 VM / 远端执行器），或给 dsh 进程做出网
  限制。两者都不是 `ctx.sandbox` 能提供的。

## 6. 改动流程

1. 先判断内容属于"每轮硬规则"（→ persona）还是"按需协议"（→ `skills/`）。
2. 专用角色**七处齐改**（判据与顺序见 `docs/dev/preset-persona.md` §8.5）：角色 preset 声明行
   （`dsh-persona` 正文：骨架 + 第一条 duty `skill <name>`；以及它自己需要的工具行）、主 preset
   里的委派行（`provider` / `toolName` / `agentPreset`）、该角色 preset 挂哪几族行
   （`test/family-rows.mjs` 的行契约 + `test/persona.test.mjs` 的组合表；只有同行焊死的兄弟才写
   `src/agents/role-tool-policy.ts` 那份逐名 deny）、`skills/<name>/SKILL.md`、主 persona 的路由与复用规则、
   `docs/dev/data-roles.md` §1.1 的角色边界、测试断言。
3. `npm test` 全绿 + `agentPresets.resolve('capital-generation')` 结果里没有 `broken`（挂载成功），
   再开一个 Capital 会话确认工具表、首轮预检，以及子 Agent 是否真的按第一条 duty 先加载 skill。
