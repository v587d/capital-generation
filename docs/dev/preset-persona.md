# Preset 维护：现状、人设写作与「不许改」

> 索引见仓库根 `AGENTS.md` §8。改 `preset/capital-generation/` 的任何一行之前读这里；验证步骤
> （§8.3）与新增角色流程（§8.5）留在 `AGENTS.md`，因为它们是每次动手都要过的闸门。
> §编号沿用 `AGENTS.md` 的全局命名空间。

## 8.1 现状（实测于 dsh 0.2.1-rc.2）

- 装配整体住 **`preset/capital-generation/agent.patch.yml`**：**六颗**
  `@deepseek-ai/dsh-agent-preset` insert 行——根 `capital-generation` 加五颗角色 preset，每颗
  `config = { id, name?, description?, plugins: [...] }`，`plugins` 就是旧的 `agent.cordis.yml`
  行数组。由 `package.json` 的 `dsh.bundle.patch`（**数组**：主 patch + 这一份 yml）随包挂载，
  `trust=system`。**不要**手抄进 `~/.dsh/.agent-presets`，也不要编辑 DSH 自带安装目录
  （`standard` / `ptc` / `minimal` / `cordis`）——要改就复制成本地 preset。
- ⛔ 注册表**没有"隐藏"概念**（`list()` 只认声明行），六颗都仍注册；插件在 host 平面包一层
  `remoteExportList()`，只把 `capital-data-junior` / `capital-visualization-specialist` 从选择器与
  预设管理里滤掉（`list()` / `resolve()` / 委派全量；过滤器 fail-open；设置卡片另有 `data-agent-preset-id`
  CSS 兜底）。内部角色按 id 仍可解析/启动，所以角色工具面收敛判据**只有 preset id、不分根会话还是 child**：
  手开 web_retriever 也必须收敛；D0 后主要由**行组合**保证。卡片顺序：三个用户模式用负 `order` 排在官方四颗（1–4）之前，内部角色 5/6 在后；选择器是宿主按 `order` 排的扁平列表，没有分组字段。
- ⛔ **`config.id`（`capital-generation`）是写进会话日志的身份**：0.1.7 的
  `dsh-agent-preset-registry` **既不扫目录也不接受 preset 路径**，只认声明行。旧写法
  （registry 行 `config.roots` 指目录）整体失效，漂移的表现是**历史会话恢复时
  `RemoteError: Unknown agent preset: capital-generation`**——不是启动报错。
- ⛔ 嵌套行里的 `!!js` 插值中 `baseUrl` 是 **profile 目录**（settings 住那儿），不是这颗 yml
  所在目录：所以 `skill-filesystem` 的 `customSkillDirs` 只能
  `createRequire(baseUrl).resolve('<包名>/package.json')` 解析回随包发布的
  `preset/capital-generation/skills`（回归 `test/persona.test.mjs`，路径与本仓目录实况同源比对）。
- 主 persona 与每颗角色 persona 都由**各自 preset 里**的 `@deepseek-ai/dsh-persona` 行
  `config.prefix` 承载（**没有** `config.text`）；不设 `suffix` 时部署级后缀被遮蔽为空（有意）。
  0.2.1 起委派行**不再带 persona**（报错原文：`persona and tool plugins … configure them in an
  Agent Preset and select it with agentPreset`），子 persona 因此住在角色 preset 自己的声明行里，
  那是**另一颗 generation**，不是往主 persona 上追加一节。
- **工具面落点（D0，2026-10-19）**：六颗 preset 全部只挂 `@v587d/capital-generation/tools/<family>`
  的**族行**——组合表住 `test/persona.test.mjs`、行契约住 `test/family-rows.mjs`（十行清单抄两份就是
  §9.7 的开端）。运行期那份名字级 allow 清单已删，只剩 control 焊进来的 `interrupt_agent` 逐名减掉。
- **host 平面**：`capital-runtime` 只 provide 一份 chart token/artifact；`capital-policy` 在 host
  装一次 root/role/shell/fs 监听；root 可见性已由组合期负责（deny:false），旧单体调用点已删。
- 长协议由 `skill-filesystem` + `tool-skill` 两行发现；组合设计理由住同目录 `README.md`（不注入
  会话）；**本文与 `docs/dev/` 是给研发 Agent 的，使用者 Agent 只读 persona + skill + 工具
  description**，两侧受众不共用文本，也不得为腾地方把本文内容搬进 persona。
- 工作区约定由 `agent-instructions` 行注入 `AGENTS.md`（宿主那份在本 profile 被关，由 preset 自持
  这一行）。它沿 session cwd 向上走到 project root 逐层读候选名（`AGENTS.md` / `CLAUDE.md` +
  `.local` 覆盖，按 trimmed 内容去重），**cwd 以下的子目录不会被扫**——所以 `docs/dev/` 靠指针
  按需 `Read`，模块级 `AGENTS.md` 在这里不成立。

## 8.2 人设写作方法（主 / 子 persona 一视同仁）

先问：**这条内容在"模型还不知道本轮要做什么"之前就必须生效吗？**

| 属于 | 落点 |
|---|---|
| 每轮硬规则（常驻） | persona（主 / 子）：预检、label 复用、路由、权限 / 叶子边界、安全底线、"第一步先加载协议" |
| 按需参考材料 | `skills/<name>/SKILL.md`：样例 JSON、字段规则、`error/code` 处置表、核验清单 |
| 维护者理由 / 踩坑 | `docs/dev/`（研发 Agent 按需读）与 `preset/capital-generation/README.md`：isolate realm、`!!js` 解析、provider 故障史 |

- 与工具 description / schema 重复的事实**不要再抄进 persona**（判据："该 Agent 可见的工具文本里
  是否已有"）。任何进 `skills/` 的文件都会拿一条常驻目录项并可被模型加载——维护者文档不放这里。
- 写错的代价：硬规则进 skill = 降级成"想起来才生效"；参考材料留 persona = 每轮付 token。

### 内置 skill 与外部精选 skill 的分界（同一张 `skills/` 表里没画的那条线）

`skills/` 那一行有**两个来源**，判据不同，混放会同时坏掉两边：

| | 内置（`preset/capital-generation/skills/`） | 外部精选（`selected-skills/…`，catalog 条目） |
|---|---|---|
| 挂载 | 随 preset 默认在，`skill` 加载即用 | **默认关闭**，使用者在「精选 Skills」勾选后只对之后的 Capital 会话可见（子 Agent 不继承） |
| 放什么 | **换个流派也成立**的东西：与已有数据源和主子 Agent 编排相适配的口径、勾稽、覆盖边界、结构性偏差、呈现与交付契约，以及符合经济 / 金融规律的方法 | **一家之言**：分档、阈值、阶段划分、触发词、流派化检查表（例：某行业集中度到多少算拥挤、持仓超过 35% 触发分散） |
| 允许不包对吗 | 不允许——它对所有会话生效，写进去就是本插件的说法 | 允许——不保证对，但开放给使用者试；代价是必须带 `tags` + `status` + `riskNote` 说明它是方法推演、本插件不据它执行（§8.6 第 7 条） |
| 怎么被看见 | persona 的第一条 duty 点名加载 | 靠 §8.7 的索引拼进三颗任务型内置 skill 的正文 |

- **一条内容两边都想要就拆开**：规律那半进内置，数字那半进精选。"周期股在盈利峰值会让 TTM PE
  创历史新低、看起来最便宜其实最贵"是规律；"位置 >0.8 且量比 >2 判定加速期"是一家之言。
- ⛔ **共用一次加载的字节预算**：三颗任务型内置 skill 的正文与拼进去的索引块**在同一次 `skill`
  结果里**，剪枝闸门是 `thresholdChars: 8192`（保留 `head 4096` + `tail 1024`，配在
  `preset/capital-generation/agent.patch.yml` 的 `tool-result-pruner` 行），
  超过就**中间静默消失**。索引每行带的是运行时 description（几十到几百字符），
  所以 `SELECTED_SKILLS_MAX_ENABLED = 6` 是这个算术的结果而不好抬；往任务型内置加句子花的
  是同一份预算。**动内置正文前先 `node -e` 数一遍该文件的字符数**，别用行数当预算（中文一行
  抵得上英文三行的字符量）。
- ⛔ **协议正文按"册"分，不按"篇"写长**：`skill` 正文走的正是上面那个剪枝器——
  `@deepseek-ai/dsh-skill` 的 `renderSkillContent` 把正文塞进 `<skill_content>` / `<skill_instructions>`
  并挂一行 base directory，**渲染包装实测约 512 字符**，超阈值就被剪成 head 4096 + `[middle pruned]` +
  tail 1024，中间的规则静默消失。2026-10-14 在已安装的 dsh 包里核过实现
  （`@deepseek-ai/dsh-compaction-tool-result-pruner`）：它遍历当前 surface 的**所有**工具结果节点，
  配置项只有 `thresholdChars` / `headChars` / `tailChars` 三个，**没有按工具名豁免的口子**，
  所以 `skill` 那一颗不会例外。2026-10-14 实测起点（正文口径，与上面那条上限同一把尺）：
  `capital-data-protocol` 单册 16,264 字符、`capital-web-protocol` 10,324 字符，
  `data_junior` 按 §0 该读的 §3/§4 恰好整段在被剪掉的中间。
  现在数据协议三册（`capital-data-protocol` / `-profile` / `-query`）、检索协议两册
  （`capital-web-protocol` / `-evidence`），§编号跨册连续。**要长就加一册并在 duty 行点名它，
  不要把某一册写回去**：闸门 `test/persona.test.mjs`「内置 skill 每一册加载后完整可见」
  按 `正文 + 512 ≤ thresholdChars` 逐册拦，另两条拦索引块与拆册不丢句。
- 同一把尺子量到外部精选：catalog 条目正文同样受这条物理限制，**存量 32 颗**（最大 31,755 字符）
  曾只能拿到节选；2026-10-14 / 10-15 两轮按同一算法分层完毕（入口册 + `references/` 分册 + 运行时 `read`，
  一行规则不删），拦"新增超限条目"的棘轮因此升级成硬闸门——任何 catalog 条目正文超可见上限即红。
  分层口径与实测记在 `docs/dev/selected-skill-index.md` 的「已知边界」与 §8.6。

## 8.4 不许改（除非有明确设计决策，并同步测试）

- **persona 只放每轮硬规则**（判据 §8.2）：`list_agents` 每轮预检、按角色映射复用（label 优先，
  旧标题按 durable id 沿用）、同角色复用不新建、`description` = 角色标签、durable id、委派清单与
  `waiting_data`、路由表、质检 gate 不以用户提图为触发条件、禁主 Agent 直连数据工具与检索、子 Agent
  互通经主 Agent 中继、全部 continuable、安全合规底线、叶子边界与「第一步先加载协议」。长协议 / 示例 JSON / 重试表 / 清单格式一律进 `skills/`。
- **插件代码默认不注册 skill provider**：preset 自带 skills 继续由 `skill-filesystem` / `tool-skill` 组合行承载。唯一例外是用户显式选择的 community `selected-skills`：只在 `agent/created` 中同时确认 Capital preset 与 root Agent 后，注册到该 Agent 自己的 scope（`agent/created` 等注入完成再放行，开关每轮 `agent/pre-step` 重读并按需失效目录缓存，切换不需要新建会话）；配置默认全关，provider 只扫描 `selected-skills/catalog.js` 批准的快照目录并按 catalog 过滤，catalog 条目可带 `experimental` / `watchlist` 状态和能力标签，随 Agent scope 注销并停止 watcher。冷启动阶段维护频率和评分是用户可见的风险信号，不是自动拒绝条件；未来可随 catalog 规模和评测成熟逐步收紧。不得注册到 preset standing scope 或 Host scope；子 Agent 侧不受影响（provider 注册在 agent scope，restriction 只过滤继承层）。同一个 provider 还给三颗任务型内置 skill 提供**同名遮蔽候选**（正文 + 外部精选索引，读取期拼装、不改磁盘），条件与失败姿态见 §8.7。回归 `test/selected-skills-provider.test.mjs`、`test/selected-skill-tags.test.mjs` 与 `test/persona.test.mjs`。
- **子 Agent 读 skill 的开关**：由该角色 preset 自己挂的 `tool-skill` 行提供（D0 之后每颗角色
  都挂那一行，没有"仍挂单体"的例外了）。restriction 过滤继承层、只豁免本 scope 自注册工具；
  这条链上任一环改动（角色挂的行 / skill 名 / 文件名）都要同步测试。
- `dataCollectorHub` / `datasetStore` 只留在 `capital-data-collector` 那颗 `capital-generation-scope`
  isolate realm 里（realm 里只有 `tools/collect` 一行）；其余角色只建本地 store（retriever 另有检索
  客户端），不建 hub；`compaction` / `toolResultPruner` 同 realm（pruner 是组内子行）。
- **名字清单只写真注册的工具名**：`tools.restrict()` 对"本作用域看不见的名字"抛错。根侧逐名
  `restrict({deny})` 的 try/catch 把它变成无害跳过；角色那份从前是**一次整批 allow**，一个看不见的
  名字就整批失败、**该角色完全没被收敛**（静默 fail-open）。D0 换成**逐名 tolerant deny**（只减
  `interrupt_agent` 那颗焊死的兄弟），失败方向跟着翻：错一个只少减一个，且记进 `failed` 可见。
  宿主自己挂的 `web_search` / `web_fetch` 因此**不在 `ROOT_AGENT_DENIED_TOOLS` 里**（2026-09-30 双端实测
  本 preset 作用域没有这两个名字）；但 2026-10-20 的 web profile 里 AnySearch 会补注册 `web_fetch`，它进
  所有 preset，说明"没挂行"不等于"看不见"；要收窄就加回根侧/角色名单或关掉宿主 provider。
- **四组结构件，删任一处该闸门就退回"persona 软建议"**：① 可视化 gate（§6.1 三件套 + §6.3 两处
  联动 → `chart-presentation.md` / `chart-delivery-events.md`）；② shell 闸门与 fs 写口
  （shell 槽位 + 升级 guard + `write`/`edit` 的根侧名单与全局 guard，2026-10-15「开 read、
  同时保留 bash」→ `bash-gate.md` §1.6）；③ 出网只有一个入口：`RETRIEVAL_DENIED_TOOLS`
  （`src/agents/root-tool-policy.ts`，13 个检索 / 来源工具名的**唯一事实来源**，spread 进
  `ROOT_AGENT_DENIED_TOOLS`，**新增来源只改这一处**）+ 主 persona 禁直连
  文案；这批名字同时**只由 `capital-web-retriever` 挂的 `tools/retrieve-search` +
  `tools/retrieve-sources` 两行带出来**（§8.1 → `agent.patch.yml` 的组合与
  `test/family-rows.mjs` 的行契约），别的角色没挂那两行、也就拿不到。④ 本地回退开关支配九个具名来源
  （§4.2 → `web-retriever.md`）。②③ 由
  `test/persona.test.mjs`（无通配 + deepEqual 对齐同一名单）与 `test/root-tool-policy.test.mjs`
  （名单长度 13）钉死。**教训**：`工具前缀_*` 通配在工具改名后一个都不匹配——禁直连文案必须
  **只点名宿主的 `web_search` / `web_fetch`**。
- **③ 的唯一例外是 `ocr`，且例外开在"形态"而不是"工具名"上**（§4.3）：主 Agent 拿本地文档
  （`file` / `doc_id`）是正当入口，外部链接（`url`）仍必须委派。名字级 deny 表达不了这个粒度，所以走
  `registerRootOcrGuard` 的调用级 guard 只拒 `url` 形态，且**全局装、调用期现读人设**（挂 created
  会漏手开模式，账本 L32）。加 `ocr` 时**不要**把它塞进 `RETRIEVAL_DENIED_TOOLS`（那会连带关掉本地
  形态）。通用 child 已随 2026-10-18 决策删除，`ocr` 那一行因此只由 `capital-web-retriever` 与**主
  preset** 挂（挂别的角色 = 重新开出一个"能自己抓外部文档"的第二个出口，别拿运行期那份兄弟 deny 当补救）。
- **`data_analyst` 的 preset 与委派行都 disabled**（2026-10-18 用户要求先停用）。declaration
  不激活、不进 picker（它挂 dataset-read / time 两行，手开也不越权）。恢复时去掉 `disabled`，先实现
  Python runner + coding tools + `read_profile`（新工具必须先有自己的族行），shell 槽位加行并重定
  沙箱写边界（`capital-analysis/runs/` 需 `workspace-write`，不要 read-only 钉会话，§1.6）。

## 8.5 新增或修改一个角色

1. 按 §8.2 定落点。2. 专用角色**七处齐改**：角色 preset 声明行（`dsh-persona` 正文：骨架 +
   第一条 duty `skill <name>`，以及它自己需要的工具行）、主 preset 的委派行（`provider` /
   `toolName` / `agentPreset`）、工具面的落点（在 `agent.patch.yml` 里决定它挂哪几族行，并按
   `test/family-rows.mjs` 的行契约核对组合结果；只有"同行焊进来减不掉的兄弟"才写
   `src/agents/role-tool-policy.ts` 那份逐名 deny，它不是工具面清单）、`skills/<name>/SKILL.md`、
   主 persona 路由与复用、本文 §1.1（`data-roles.md`）、测试断言。3. 挂载验证（§8.3 第 1 项）+
   `npm test` + 开一个 Capital 会话确认工具表与首轮预检。
