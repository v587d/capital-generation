# Capital 模式 preset：组合设计说明

本文件是 `agent.cordis.yml` 的**维护者文档**（人类可读），不是模型可见内容：
`skill-filesystem` 只扫 `skills/`，本文件既不会进 skill 目录，也不会被注入上下文。
组合文件里只留"就地必需"的一行注（realm、`!!js`、disabled 行），其余设计理由都在这里。

- 本目录由 `@v587d/capital-generation` 随包分发，由 `cordis.patch.yml` 的 bundle patch
  以 `trust=system` 挂载；**不要**手抄进 `~/.dsh/.agent-presets`。
- 长协议在 `skills/`（同目录），由本 preset 自己的 `skill-filesystem` 行发现。
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

## 5. 各行的作用与坑

- `agent-instructions`：注入 `AGENTS.md` / `CLAUDE.md`（宿主行在本 profile 被关，由 preset
  自持，`maxBytes: 65536`）。没有它，工作区约定对 Capital 会话不可见。
- `tool-result-pruner`：`thresholdChars: 8192`（head 4096 + tail 1024）。真实后果是
  **能力目录与工具结果超过阈值时中间段被剪掉**；`test/data-collector-hub.test.mjs` 因此用
  "目录 6144 + 单能力详情 4096"两道测试预算，让测试先失败而不是运行时静默截断。该阈值
  **不能按 Agent 区分**（全仓只有这一个 pruner 实例），主/子 Agent 共用。
- `toolFilter.allow` 只能写**真实注册**的全局工具名：`tools.restrict()` 对未知名字直接报错，
  且它在**子 Agent 创建窗口**执行——写错的表现是"创建子 Agent 失败"，不是挂载失败。
- 不用 `dsh-time-context` 行：它每个 step 自动注入时钟读数，与自研 `get_local_datetime`
  重复；时间读数只来自后者（会话组作用域内注册，主 Agent 与全部子 Agent 共享，支持
  `timezone` 换算）。
- `data_analyst` 行保持 `disabled`。启用前置条件（缺一不可）：宿主先实现 Python runner 与
  coding 工具；插件注册 `read_profile`（allow 里的名字必须先真实存在）；更新 `AGENTS.md`
  的角色边界与 `test/persona.test.mjs` 的预留期断言。

## 6. 改动流程

1. 先判断内容属于"每轮硬规则"（→ persona）还是"按需协议"（→ `skills/`）。
2. 专用角色五处齐改：委派行（provider / toolName / backgroundMode / persona / toolFilter）、
   子 persona、主 persona 的路由与复用规则、`AGENTS.md` 角色边界、测试断言。
3. `npm test` 全绿 + `agentPresets.standingKeyFor('capital-generation')` 挂载成功，再开一个
   Capital 会话确认工具表、首轮预检，以及子 Agent 是否真的按第一条 duty 先加载 skill。
