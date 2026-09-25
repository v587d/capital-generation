# Capital 模式 preset：组合设计说明

本文件是 `agent.cordis.yml` 的**维护者文档**（人类可读），不是模型可见内容：
`skill-filesystem` 只扫 `skills/`，本文件既不会进 skill 目录，也不会被注入上下文。
组合文件里只留"就地必需"的一行注（realm、`!!js`、disabled 行），其余设计理由都在这里。

- 本目录由 `@v587d/capital-generation` 随包分发，由 `cordis.patch.yml` 的 bundle patch
  以 `trust=system` 挂载；**不要**手抄进 `~/.dsh/.agent-presets`。
- 长协议在 `skills/`（同目录），由本 preset 自己的 `skill-filesystem` 行发现；`capital-visualization-protocol` 同时供 data_junior 的 gate 和 visualization_specialist 按需加载。
- visualization_specialist 是 data_junior 创建的 one-shot 前台子 Agent，不进入主 Agent 的 direct-child 复用清单；它只消费 chart_source_ref 并使用受控 render_chart。
- 验证方式与"改 preset 前后的必做检查"见仓库根 `AGENTS.md` 的「Preset 维护纪律」。

## 1. 平面纪律（plane discipline）

- `subagents` 注册表与它的 spawn/fork 后端住在 **host 组合**；本 preset 只贡献模型侧的
  委派工具行，它们解析 host 那一份注册表。本文件**没有**挂 `subagent_fork` 行，所以委派
  永远是 continuable 的 `spawn` provider。
- 本 preset 拥有的服务必须落在组行的 `isolate` realm 内（见第 4 节）；只消费 host 能力的
  行必须留在 realm 外，否则解析不到服务。

## 2. 人设（persona）承载与官方语义

实测 `dsh 0.1.5-rc.1`，三层载体注册的是**同一个 system-prompt 节名**：

| 载体 | 位置 | 字段 | 生效范围 |
|---|---|---|---|
| `dsh-system-prompt` 行 | 部署（web profile） | `personaPrefix` / `personaSuffix` | 全局 |
| `dsh-persona` 行 | 本 preset | `prefix`（必填）/ `suffix` / `complete` / `includeRuntimeContext` | preset 内全部 agent（主 + 子） |
| `dsh-tool-subagent` 行 | 本 preset 委派行 | `config.persona` | 该子 Agent 自己 |

- 节名是 `deployment:persona-prefix`（order 0）与 `deployment:persona-suffix`（order
  10200）。**最近 scope 胜出 ⇒ 是覆盖不是追加**；`dsh-subagent` 把 `config.persona` 注册进
  子 Agent 自己的 scope，所以子人设**替换**（不是扩展）主 persona。
- `prefix`/`suffix` 是模板，渲染时对 `{{…}}` **严格插值**：未注册或 undefined 的变量会抛错。
  `provider` / `model` / `cwd` 由 `dsh-agent-loop` 全局注册，可以直接用。
- 本 preset **不设 `suffix`**：按官方语义，空模板**仍然遮蔽**部署级后缀，所以部署那句
  `Your working directory is {{cwd}}.` 在 Capital 会话里不出现（主 persona 自己写了
  `{{cwd}}`）。这是有意为之，不是漏配。
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
- **子 Agent 也能按需加载**：子行的 `toolFilter.allow` 里写了 `skill`，子 Agent 就同时拿到
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
  自持，`maxBytes: 65536`）。没有它，工作区约定对 Capital 会话不可见。
- `tool-result-pruner`：`thresholdChars: 8192`（head 4096 + tail 1024）。真实后果是
  **能力目录与工具结果超过阈值时中间段被剪掉**；`test/data-collector-hub.test.mjs` 因此用
  "目录 6144 + 单能力详情 4096"两道测试预算，让测试先失败而不是运行时静默截断。该阈值
  **不能按 Agent 区分**（全仓只有这一个 pruner 实例），主/子 Agent 共用。
- `toolFilter.allow` 只能写**真实注册**的全局工具名：`tools.restrict()` 对未知名字直接报错，
  且它在**子 Agent 创建窗口**执行——写错的表现是"创建子 Agent 失败"，不是挂载失败。
- **通用 `subagent` 行必须写 `toolFilter.deny`（2026-09 review）**：`dsh-subagent` 只在
  `composition.toolFilter !== void 0` 时才 `restrict`，而 child 用 `composeFrom(childCtx,
  parent.ctx)` 加入父 Agent **同一份 standing composition**，因此没有 filter 的通用 child
  会继承 standing 的全部工具——只带 `parentSession` 的 child 就能自己 `prepare_chart_source`
  再 `render_chart`，把"出图只有一个入口"降级成 persona 建议。这里的 `deny` 与子角色的
  `allow` 不冲突：`allow`/`deny` 都只是继承层交集过滤，专用行各自的白名单照常生效。
  通用行只能有一个 filter，所以用 `deny` 列全敏感工具（数据管线 + Dataset 系列 + 出图 +
  专用角色创建工具）；`deny` 里的名字同样必须真实注册。回归断言见
  `test/persona.test.mjs` 的「通用 subagent 行」用例。
- **同一份 `deny` 也覆盖出网（2026-09-24）**：本插件 13 个检索 / 来源工具全部列进来，否则只带
  `parentSession` 的通用 child 能自己抓网页，「外部检索只经 web_retriever」又是一条 persona 文案。
  名字的唯一事实来源是 `src/agents/root-tool-policy.ts` 的 `RETRIEVAL_DENIED_TOOLS`（根 Agent 逐名
  deny 用的就是它），测试把两处对齐成同一份名单。**宿主自己挂的 `web_search` / `web_fetch` 绝不能
  写进这里的 `deny`**：它们不由本插件注册，未注册名字在 `deny` 里的表现是"创建子 Agent 失败"；
  它们只出现在根侧 `ROOT_AGENT_DENIED_TOOLS`（逐名 `restrict` 的 try/catch 容忍"这个 scope 里没有"）。
- 不用 `dsh-time-context` 行：它每个 step 自动注入时钟读数，与自研 `get_local_datetime`
  重复；时间读数只来自后者（会话组作用域内注册，主 Agent 与全部子 Agent 共享，支持
  `timezone` 换算）。
- `data_analyst` 行保持 `disabled`。启用前置条件（缺一不可）：宿主先实现 Python runner 与
  coding 工具；插件注册 `read_profile`（allow 里的名字必须先真实存在）；更新 `AGENTS.md`
  的角色边界与 `test/persona.test.mjs` 的预留期断言。

## 5.1 bash：为什么只给 data_junior，以及它到底能做什么

- **动机**：`query_dataset` 只有 `count/min/max/avg/sum`，变化量 / 增幅 / CAGR / 比值这类派生
  指标没有宿主工具；模型只能拿 `time_facts.first/last` 心算——那正是 §1.3 那次 41,961 字符
  时间戳心算的同型浪费。所以给 data_junior 一个纯计算兜底。**不是**给它开取数通道。
- **为什么主 Agent 不给**：主 Agent 今天没有任何通用执行 / 文件 / 网络工具（Web 平面把 host 层
  的 `tool-bash` / `tool-fs` / `tool-web` 都 `disabled` 了，本 preset 也不挂回来）。这是一条
  结构性事实，不是 persona 约定：主 Agent 唯一对用户说话、又会读到子 Agent 回传（含网页材料），
  一旦拥有 bash 就等于拿到"注入 → 执行 → 读凭据 → 出网"的完整链路。收敛靠
  `ROOT_AGENT_DENIED_TOOLS`（含 `bash` / `pwsh`）。
- **平台成对挂载**：Windows 上 host 层挂的是 `pwsh-sandbox`，没有 `bash-sandbox`；只挂
  `tool-bash` 会让名为 bash 的工具实际执行 PowerShell。所以两行互补 `disabled`，allow / deny
  里的名字用 `!!js` 三元表达式按平台选。`tools.restrict()` 对未注册名字报错，所以表达式与行必须
  同进同退（回归：`test/persona.test.mjs`「shell 行：平台成对挂载……」）。
- **不给后台执行**：`enableRunInBackground: false`。本 preset 不挂 `tool-jobs`，开着后台只会让
  模型拿到一个永远读不回来的 jobId（`job_output` / `job_kill` 不在任何 allow 里）。
- **闸门只有两层，且都不是安全边界**（`src/agents/bash-guard.ts`）：
  ① 只对**被委派**子会话开放（镜像 `tool-exec.ts` 的 `delegatedSession`，执行层兜住可见性被改坏）；
  ② 拦掉 `sandbox_permissions`——委派会话的审批策略由框架固定为 `never`，升级必然失败，而且模型
  会收到「the user rejected…」这种把系统拒绝说成用户拒绝的文案。
  **刻意不解析 `command`**：本仓实测沙箱只拦写、不拦读（`~/.dsh/.credentials.yaml` 与
  `sessions/**` 整机可读）、不拦网络（`curl` 直连 200），而正则挡不住 `node -e` / `python3 -c`
  ——那正是引入 bash 的目的。禁区与出网纪律是 data_junior persona 的 `# BASH DISCIPLINE` 软约束。
- **写边界收不窄**：`store.writeContext()` 用**调用方 session** 的 policy 且要求
  `mode ∈ {workspace-write, danger-full-access}`，而 `describe_dataset` 会用 data_junior 的会话写
  `profile.json`；把它的会话钉成 `read-only` 会直接打断 describe_dataset。bash 与 Dataset 管线
  共用同一把尺子（session policy）。
- **要真正收紧**只有两条路：换掉 `ctx.shell`（容器 / 微 VM / 远端执行器），或给 dsh 进程做出网
  限制。两者都不是 `ctx.sandbox` 能提供的。

## 6. 改动流程

1. 先判断内容属于"每轮硬规则"（→ persona）还是"按需协议"（→ `skills/`）。
2. 专用角色五处齐改：委派行（provider / toolName / backgroundMode / persona / toolFilter）、
   子 persona、主 persona 的路由与复用规则、`AGENTS.md` 角色边界、测试断言。
3. `npm test` 全绿 + `agentPresets.standingKeyFor('capital-generation')` 挂载成功，再开一个
   Capital 会话确认工具表、首轮预检，以及子 Agent 是否真的按第一条 duty 先加载 skill。
