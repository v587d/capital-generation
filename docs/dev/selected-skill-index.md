# 精选 Skill 路由：角色、触发条件与注册边界

> 索引见仓库根 `AGENTS.md` §8。本文记录外部精选 Skill 的**角色归属**、**触发条件**、**注册边界**
> 与当前闸门；快照接入清单在 `docs/dev/selected-skills.md` §8.6，provider 代码在
> `src/agents/selected-skills-provider.ts`。任务型内置 skill 不再携带精选索引。

## 8.7 角色化路由

精选 Skill 不是任务型内置 skill 的附录，也不是“只有主 Agent 能用的参考资料”。它们是独立的方法层，
按**执行角色**分发：同一个方法可以只给一个角色，也可以同时给多个角色。

### 协议层与方法层

内置 `capital-*` 是**流程协议**（工具委派、证据门、回传格式），精选 Skill 是**分析方法层**（估值步骤、财务勾稽、组合归因）。两者正交：同时命中就都加载，先协议定流程、再方法定分析；⛔ 不得用协议替代同主题方法，也不得让方法改写协议的工具边界与证据门。

### 角色表

| 角色键 | 会话 preset | 能加载什么 | 典型工作 |
|---|---|---|---|
| `main` | `capital-generation` | 研究框架、组合/交易流程、写作、教学、税务 | 组织证据、最终答复、用户决策 |
| `data_junior` | `capital-data-junior` | 估值、会计、财务质量、风险、筛选、技术/期权/ETF、取证 | `run_code` 计算、表格、统计 |
| `web_retriever` | `capital-web-retriever` | 10-K 深读、电话会纪要、逐条核验 | 取证、文档阅读、来源核对 |
| `data_analyst` | `capital-data-analyst`（未启用） | 与 `data_junior` 同一方法集 | 预留的独立分析角色 |
| `data_collector` | `capital-data-collector` | 无 | 只取结构化数据，不套方法 |
| `visualization_specialist` | `capital-visualization-specialist` | 无 | 只出图，不套方法 |

`roles` 是**执行角色**，不是“谁可能感兴趣”。主 Agent 需要数字时交给 `data_junior`，不要为了同一个方法再加载一遍；`data_junior` 也不写最终结论。多角色只给两部分确实由不同角色执行的条目（如 `fact-check` 检索侧取证、主 Agent 判定）。

### 数据契约：一处说清取数
“数据从哪来”只写在角色系统提示 `capital:data-contract`（`src/data-contract.ts`，随 `tools/selected-skills` 挂到四个能加载 skill 的角色）；Skill 只在 `## Evidence request` 里声明标的、证据类型、字段、期间与 as-of，换数据源只改契约一处（`test/selected-skills-content.test.mjs` 逐颗断言）。

### 元数据：`selected-skills/routing.js`

每条 catalog 条目在 `SELECTED_SKILL_ROUTING` 有且只有一行：

```js
{
  market: ['a-share'],        // a-share | us-stock | global
  stage: 'post-event',        // research | pre-event | post-event | monitoring | execution | review | learning
  methods: ['earnings', 'financial-health'],
  roles: ['main', 'data_junior'],
  primaryRole: 'main',        // 角色短清单把它排在最前
  useWhen: { zh, en },        // 唯一路由描述；zh 给模型，en 给英文界面/测试
  requires: ['financial_statements', 'filings'],
  overlaps: ['china-variance-commentary'],
  canonicalFor: ['a-share/post-event/earnings-note'], // 同族默认项，可空
}
```

`useWhen` 是**路由描述**，不是正文摘要。它必须写清“市场 + 阶段 + 产出 + 关键词 + 不适用条件”，
不以“分析 X”这种主题句充数。宿主技能目录、角色短清单与设置卡片都读同一份 `useWhen`；上游
frontmatter 的 `description` 只作溯源，不再直接进模型目录（provider 在 `list()` 时覆盖）。

### 角色短清单：`capital:selected-skills`

`tools/selected-skills` 行在每个 Capital 角色 preset 注册一个 system-prompt section：

- manual 只列**该角色已启用且有快照文件**的方法，全关时正文为空、零成本；auto 列该角色的全部方法，
  仍只展示 12 条，完整目录在宿主技能目录里。
- 模式来自 `capital-config.selectedSkillsMode`：`manual`（默认）只给勾选，`auto` 按角色开放全部方法、
  运行期忽略勾选。`agent/pre-step` 的指纹包含模式，切换在下一轮生效。
- 规则是**强制检查**：进入分析/取证前逐条判断，匹配的先用 `skill` 加载 1–2 条，再按正文执行；
  加载后不得把摘要当全文，不得声称用过未加载的条目；全不匹配就不提。
- 方法仍从属于本插件：不改变证据门、数据委派路径、输出通道；冲突以本插件为准。
- 最多列 12 条（`BRIEF_MAX`），按 `canonicalFor` + `primaryRole` 排序，先给本角色最常用的默认项；
  完整清单仍在宿主技能目录里，这 12 条不是勾选上限。
- 角色差异写在 section 里：主 Agent 说明计算归 `data_junior`；`data_junior` 只做计算/表格/统计；
  `web_retriever` 只做取证与核验。
- `interpolate: false`：上游派生文本不能走 `{{variable}}` 插值。

### 使用反馈：`skills_used` 与最终引用

账本住 `src/agents/skill-usage.ts`，以 **session id** 为键、按 `parentSession` 归树：

- **什么算一次实际加载**：`skill` 工具成功返回 `provider === 'capital-selected-skills'` 的正文；
  `data_junior` 的 `tools.skill` 走 PTC，记 `tool/ptc-dispatch`；用户 `/name` 注入记
  `user/message` 的 `skill-invocation`。失败调用、内置协议名、未启用或角色不匹配的名字都不入账。
- **谁写账**：每个角色的 `tools/selected-skills` 行在该 Agent 的 scope 内监听 `tools/result` 与
  `session/event`。没有“模型自报字段”这条路径：名字来自成功返回的正文，不是来自子 Agent 的措辞。
- **主 Agent 看什么**：`capital:selected-skills` 的 section 在每次 assembly 读整棵树的账本，列出
  `主 Agent：…` / `数据分析（session-xxxx）：…`，并硬性要求最终答复有一节「使用的方法」逐条点名、
  说明各自支撑的判断；不得点名未加载项，也不得用“参考了相关方法”代替。
- **子 Agent 回传**：角色 section 列出自己的账本；有加载时要求末尾附一行
  `skills_used: name1, name2`。这行是给人看的摘要，主 Agent 与报告仍以程序记录为准。
- **引用窗口**：根 Agent 收到新的 `user/message`（`source.kind === 'user'`）时清空整棵树的名单；
  子 Agent 结算消息不触发清空。根 Agent scope 销毁时删除整棵树，内存不跨会话累积。
- **报告与审计**：`node scripts/skill-usage-report.mjs`（`npm run report:skill-usage`）从会话日志
  重算同一组事实：根会话、各角色会话、每颗次数、最终答复点名 `n/m` 与缺失名单；支持 `--json`、
  `--latest N`、`--session <id>`、`--all-workspaces`、`--catalog`、`--strict`。它不依赖运行期内存，
  能审计历史会话；`--catalog` 按会话打印精选 / 内置目录计数，用来验证 auto 的角色暴露。

### 注册边界

- `tools/selected-skills` 行带 `config.role`，按角色挂进 `capital-data-junior` / `-web-retriever` /
  `-data-analyst` / 根 `capital-generation`；`data_collector` 与 `visualization_specialist` 不挂。
- provider 只在 **Agent 自己的 scope** 注册（`agent.ctx.inject(['skills'])`），并要求
  `agentPresets.composedPreset(agent.ctx) === 该角色 preset id`；不注册到 preset standing scope 或
  Host scope。`agent/created` 与 `agent-preset/selected` 两条路径都接（GUI 先建后切是真实顺序）。
- `list()` 与 `get()` 使用同一道“角色 ∩ 当前模式可用集合”闸门；manual 下未勾选、角色不匹配或快照
  缺失的名字不得通过 `get()` 绕过目录过滤，auto 只放开角色边界以内的方法。
- 开关每轮 `agent/pre-step` 现读；指纹变化时 `control.invalidate()` 必须在 `next()` 之前完成。
- 读取链路只有一份：`readCapitalEntry()` 走 `settings.describe()` → `configEditor` 保存层；
  读不到返回空对象，绝不当成“用户全关”后把 provider 钉死。preset 兜底只给主插件 Config。

### 已移除

- **任务型 skill 索引与同名遮蔽**：`SELECTED_SKILL_TASK_IDS`、`renderTaskSkillIndex`、shadow rank、
  `get()` 拼正文全部删除。任务型 skill 回到纯内置协议，精选 Skill 不再从它的正文尾部出现。
- **6 颗勾选上限**：`SELECTED_SKILLS_MAX_ENABLED` 与卡片警示图标删除；manual 模式数量不限。
  老配置里多于 6 颗的照常全部生效。角色短清单只限制**列出条数**，不限制可加载集合。
- **标签的 `serves` / `fallback` 路由**：标签只做设置卡片筛选；角色与触发条件只看 `routing.js`。

### 当前边界

- **auto 已实现**：按角色暴露全部方法，运行期不读勾选；`manual` 保持原行为（数量不限）。auto 的
  选择质量依赖 `routing.js` 的 `useWhen` + `stage` + `canonicalFor`，角色短清单仍只列 12 条。
- auto 不改变角色边界：`data_collector` / `visualization_specialist` 仍是 0 颗；main 看不到
  `china-dcf` 一类数据侧专属方法，越界 `get()` 照常拒绝。
- 内置 `capital-*` 协议曾遮住同主题精选方法；2026-10-25 起按“协议层 / 方法层”解耦：短清单声明两层
  正交，六个协议顶部写定位与按角色加载。复测组合复盘同时加载 `capital-portfolio-review` + `portfolio-review`，
  10-K 加载 `capital-web-protocol` + `10k-digest`。无 Dataset 建模仍由主 persona 路由 data_junior。
- 角色短清单只列 12 条；角色目录仍是完整集合，模型从宿主技能目录选择其余条目。
- `data_analyst` 未启用，只做 `data_junior` 的别名；启用时要单独决定是否拆分方法集。
- 使用反馈已落到运行期账本与会话日志：报告能证明“加载过什么、最终答复有没有点名”，但不能判断
  方法是否被正确执行；方法质量仍由内容闸门与人工评审负责。
- 真机尚未验证“角色子 Agent 的 `composedPreset` 返回角色 id”这一条；第一次实机看到某个角色目录
  为空时，先查 `readPresetClaim` 的返回，而不是先怀疑 catalog 文件。

### 闸门

- `test/selected-skill-routing.test.mjs`：catalog ↔ routing 一一对应、角色/市场/阶段/方法/依赖
  已登记、`useWhen` 含“当…时使用”/`Use when`+`Triggers on`、overlaps 双向、canonicalFor 唯一、
  primaryRole 分工与角色成员数快照、标签只做筛选。
- `test/selected-skills-provider.test.mjs`：按角色过滤、`get()` 拒绝角色不匹配/未启用、预设身份判据、
  两条注册路径、注入失败可重试、每轮开关刷新、目录描述用 `useWhen`、角色短清单规则与 12 条展示上限；
  auto 的 37/40/8 角色目录、越界拒绝、模式切换让缓存失效；
  原生 `skill` / PTC / `/name` 三种入账、失败与内置名排除、整树汇总、新一轮清空、跨会话隔离。
- `test/skill-usage-report.test.mjs`：会话日志重算、父会话缺席时子树自成根、最终答复点名与缺失名单。
- `test/apply-integration.test.mjs`：`tools/selected-skills` 的 section（`interpolate: false`、
  动态重读、`configEditor` 兜底、按当前 Agent 读账本）与 provider 注册。
- `test/persona.test.mjs` / `test/family-entries.test.mjs` / `test/family-rows.mjs`：preset 组合表、
  行契约 `config.role`、入口 `inject` 与组合面一致。
- `test/selected-skills-content.test.mjs`：快照正文的取数/记忆回填/执行面/委派档合规扫描不变；
  触发条件与角色元数据是 Capital 自持数据，不写回上游快照。

逐颗 review 表（70 行、角色/触发条件/重叠数）见 `selected-skills/ROUTING.md`；
它由 `routing.js` 生成，改路由先改 `routing.js`。
