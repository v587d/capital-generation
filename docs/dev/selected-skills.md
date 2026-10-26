# 外部项目 Skill 接入与运行时约束

> 索引见仓库根 `AGENTS.md` §8。本文记录把外部项目的 skill 接入本仓时必须过的清单（§8.6 第一节）与已验证的发现、加载、隔离和打包行为；不规定候选评估打分与阶段状态。

## 8.6 外部项目快照与运行时接线

### 接入必查清单（逐条打勾；不合规就地改掉正文）

清单只针对 **catalog 暴露的 skill**：仓与包都只保留这些正文，其余 skill、脚本、取数服务端与上游仓库材料
已从仓里删除（2026-10 收敛）；唯一留在 git 的非正文是纯公式参考实现（`selected-skills/reference-algorithms/`，
不随包、不执行）。`test/selected-skills-content.test.mjs` 按 catalog 现算扫描面，新加一条 skill 立刻进扫描，
重新按 commit 覆盖快照而没重做下面的改写会直接红。扫描面是**每颗 catalog skill 目录下的全部 `.md`**
（含 `references/` 一类附属文件）：第四颗改完 `SKILL.md` 才发现，真正把 Agent 指回自行浏览的那一句
住在 `references/deep/system-prompt.md`，只扫入口等于没扫（AGENTS.md §9.7 同一个族）。
第五颗（marian2js/trading-skills）又把同一族换了形态：正文里一处 `web search` 都不写，伸手取数写的是
`curl "…apikey=<FMP_API_KEY>"` 与 `ask which supported provider`，把计算推出去写的是
`For agents that support code execution … skills/_lib/calculations.py`。所以闸门按**词组族**加宽，
不按某一种措辞——§8.6 第 10 条的反证就打在新增这几条上。
第六颗（jwangkun/claude-for-financial-services-cn，A 股 63 颗）把同一族**摊成全量**：63 份正文每一份都带
一节按付费程度排开的数据服务商阶梯（顶层那档写着 `WIND_API_KEY`、密钥前缀与密钥申请去处）、一个用环境变量
决定"这次用哪家"的开关块、一段 ```python 围栏里的伪工具调用，并把服务商名写死在引用格式与检查项里。
闸门为此再加一族（十二条 → 二十三条）。**但服务商名不能按英文单词扫**：这道测试把命中统计强制成 `gi`，
于是 `\bWind\b` 会撞上按"风电"写的 sector-analysis、`\bChoice\b` 会撞上把 choice 当普通词用的 fact-check
与 tax-lens。这一族改按无歧义形状写（中文名、`Wind / Choice` 的阶梯形状、iFind 与 AkShare 这类不成词的品牌名）——
AGENTS.md §9.7 同一族的另一面：**闸门误伤过一次，下一个人就会把它整体削掉。**
第七颗（GAJETOso/financeskills，企业会计与公司金融 48 颗）违规形状**整个换了地方**：它没有取数层——
没有服务商阶梯、没有凭据名、一句 `web search` 都不写，23 条模式套全 48 颗只命中 2 处（都不在候选里）。
但它把"推给运行时"写成了**代码与脚本**：43 份正文带着 `Run \`python3 scripts/calculate.py\` to self-test`，
另有 `**Build with code**`、`In code: a single CONFIG dict`、`code-verified math`、模板脚注
`Computed with scripts/calculate.py`，以及一句点名宿主工具名的 `**web_fetch … cannot access secure
banking portals**`。上面那几条模式一条都不认（`code[\s-]execution` 要求两个词连着写，
`node scripts/|bash scripts/` 只认那两个动词，工具名从来没进过表）。**代价就是这六段改完没人看守**：
照 commit 重新覆盖快照时它们会静默退回而 `npm test` 全绿。因此闸门再加三条（二十三条 → 二十六条），
补之前先量过误伤面：三种形状在已收录的正文里零命中。裸 `scripts/` **不能**当模式——`## Scripts`
段本来就链接 `./scripts/calculate.py` 并写明"没人会执行它"，要认的是"把数字归给跑过的脚本"那个形状。
第八颗（Howard-Jerry/quant-agent-skills，三颗自述的量化研究编排器）违规形状**又换了一层：不是措辞，是本体**。
26 条模式在三颗入口上只响 1 次；但三颗点名的本地路径实测 10 / 32 / 16 个，**公开版一个都不存在**（作者写明
数据层要到 v1.1 才开源），132 处命中里 109 处住在 `steps/*.skill.md`，主措辞是 `Use \`scripts/x.py\` via \`Class\``
与 `PYTHONPATH={{QUANT_ROOT}} python data_platform/…`（第 10 条只认 `node|bash scripts/`，环境注入那一形从来没进过表）。
**这一颗没有一段可以改写**："自己跑脚本取数、再落一包文件"就是它的全部正文，删完什么都不剩——处理因此变了：
整颗不进 catalog，只单独拿隔壁两份零执行面的口径文件，收录那颗的入口正文**由本仓撰写**（第一次；MIT 这一档
不触发上面 Apache 那句 4(b) 的声明行义务）。闸门加四条（二十六 → 三十），但更宽的 `python3? <带路径的 .py>`
**明确不加**——第一颗那句 `python3 scripts/framework.py` 由 `NEEDS_FALLBACK` 的退路刻意放行，挡掉等于削掉既有设计。
新四条防的漂移方向也跟着变：这颗没改过任何上游句子，要防的是**有人把隔壁那三颗复制进随包目录**（快照根下
它们抬眼就是），反证照这个方向做。逐条数字与四条观察名单见扫描记录 2026-10-13 那一节。

- [ ] **1. 谁去取数。** 正文有没有要求 Agent 自己去 `web search`、抓 URL 或跑取数脚本。本插件取数
  只有一个入口：主 Agent 委派 `data_collector`（结构化数据）/ `web_retriever`（网页与披露文件）；
  根角色的 13 颗出网工具是逐名 deny 的（§1.1、`src/agents/root-tool-policy.ts`）。
  **改法**：把"你自己搜"换成"走宿主取数通道；角色分流的宿主里，把标的、字段、as-of 日期写进委派 brief 交出去"。
  闸门按 `web search` 这**个词组**扫，不是只扫 `use web search` 那一种措辞——第四颗的原句是
  `All data comes from web search and fetched pages` 与 `Using the host agent's web search and page fetch tools`。
  同一族还有另外两种形态，第五颗（trading-skills）用的就是它们：`curl "…&apikey=<FMP_API_KEY>"`（自己出网调接口）
  与 `ask which supported provider` / "already shared usable access details"（**向用户点选付费服务商、在对话里认领凭据**）。
  本插件没有那些服务商，密钥只进 credentials 域（§5）——这种句子直接删，不改成委派就还是第二条口子。
  第六颗（claude-for-financial-services-cn）把"自己取数"写成了**结构**而不是某一句：一节
  `## Data Sources (Multi-Tier)` 按付费程度排开三家服务商、顶层带着密钥名与申请去处、尾部一个
  `IFIND_DATA_SOURCE_MODE` 环境变量开关决定"这次用哪家"，再加一段围栏里的伪调用
  （`get_financials(ticker, "income", "annual")`、`ifind_get_stock_events(query)`、`ak.bond_zh_us_rate()`）
  与把服务商名写死的 `Source: AkShare, [date]`。这几样一起删（围栏整段换成"要哪些字段、as-of 哪天"的
  委派 brief），只删其中一句等于留着另外三句当路标。**引用块里点名披露场所可以留**（巨潮资讯、交易所、
  监管机构是出处，也正是宿主检索通道在用的来源），要删的是把它当**取数指令**的那些写法。
- [ ] **2. 取不到怎么办（最严重的一条）。** 有没有"打个 ⚠️ 警告然后用训练记忆估一个"的逃生口
  （`training-data estimates`、`Retrieval: model memory`、`Live data unavailable`）。**没有任何工具会拦它**——
  工具面拦得住越界取数，拦不住编造数字。**改法**：点名缺哪些字段、该字段下的分析停止，不回填。
  第六颗的同一族不写"记忆"，写的是**换个基线继续跑**：`If consensus unavailable, derive from:
  Historical growth rates / Management guidance / Industry benchmarks`、`[UNSOURCED] — estimate based on
  [rationale]`、`use … or web search for latest`（无风险利率取不到就去搜）。这三处都得改成"留空 + 点名缺口"，
  并且要**如实写明宿主能给什么**：本插件的结构化数据面没有盈利预测／一致预期条目，唯一带预测形状字段的是
  东财研报条目上的本年 / 次年 EPS 预测（那是单家口径，不是市场共识），所以按一致预期写的差异分解、
  beat/miss 判定在这一颗里天然只能落到披露区间与自家基线上。
- [ ] **3. 出处块的取数档。** `Data & Sources` 一类模板的 `Retrieval:` 枚举必须含委派档
  （`delegated retrieval`），且不许把 memory 列成一种取数途径。
- [ ] **4. 执行面。** 正文有没有 `python3 …` / `node …` / `curl …` / `install.sh` 一类指令，或
  "For agents that support code execution … `skills/_lib/calculations.py`" 这种**把计算推给能跑代码的宿主**的
  退路句；有没有**看起来能跑的伪调用围栏**（`get_financials(ticker, "income", "annual")` 一类）。
  根角色有 shell，但 `bash-guard` 刻意不解析命令内容（`docs/dev/bash-gate.md` §1.6），所以**正文仍是唯一闸门**。
  **改法**：删掉指令，写清算式、把算式写进答复，真正需要算力时委派 `data_junior`。
  **2026-10 起不再有"脚本留在快照里当材料"这一档**：运行时树只允许 Markdown，脚本一律出仓；
  确属公式参考实现的 44 份 `.py` 移到 `selected-skills/reference-algorithms/`——git-only、不随包、不执行、
  不被任何 skill 正文点名，`test/selected-skills-structure.test.mjs` 禁止它们 import 网络/进程模块或读写文件。
  同一族还有三种同形：**"用代码算"的英文措辞**（`Build with code` / `In code: …` / `code-verified math`）、
  **把数字归给跑过的脚本**（`Computed with scripts/…`）、**点名宿主工具名**（`web_fetch`）。
  闸门按**词族**扫，不按某一种措辞；改完仍有人把上游原句抄回来，`test/selected-skills-content.test.mjs` 会指名道姓。
- [ ] **5. 出图与报告。** 教 Agent 自己产出 HTML/Chart.js/图形或报告文件的，**不进 catalog**
  （§6.1 出图只走 `render_chart`；§7 报告链路已删除且禁止恢复），已从仓里删除。
- [ ] **6. 编排与别名。** 会接管会话路由的 orchestrator、上游自己标注的 alias 残片，不进 catalog，
  已从仓里删除（`test/selected-skills-structure.test.mjs` 按 catalog 反查目录，删掉的名字也不许再被正文指挥）。
- [ ] **7. 金融表达合规。** 不承诺收益或准确率；打分项（0–10 那一类）要说明衡量的是自洽度/结构特征
  而非预测表现。正文里出现方向、评级、目标价或仓位数字**不是排除理由**——本插件从不代使用者下单，
  也从不发布能下单的东西（那归第 4 条与 Packaging 的执行面口径，`etoro` 与四份取数服务端是按那条挡的）；
  这类段落只要在 `riskNote` 写明它是方法推演、本插件不据它执行。**别把第 7 条读成内容禁令**：
  第五、六颗当初就是这么混读的，结果把三颗 A 股卖方流程与两颗交易过程检查整颗挡在门外。
  真因"给动作"要不收的那类走第 8 条市场口径（wash-sale 是美国应税账户产物，A 股无此制度）。
- [ ] **8. 市场口径。** 非 A 股口径（SEC EDGAR / Form 4 / 13F / FRED / 美国税制…）逐条进
  `description` 与 `riskNote`，并给一个能力标签，让使用者在卡片上筛得出来哪些是美股专用。
- [ ] **9. 许可与留痕。** 许可证明确且允许再分发；`LICENSE` 原件随包；commit / release / 最近提交
  记进 `UPSTREAM.md`；**改了哪几类句子、为什么改，逐条记**——这是"可以改正文"的唯一代价。
  署名不一致要**按现状记三条**，不要替上游挑一个：第六颗的 `LICENSE` 附录是 `Copyright [2025] [jwangkun]`
  （Apache 自己的说明要求填好后去掉方括号，上游没去），六份 `plugin.json` 的 author 又写
  `Anthropic FSI China`，`README.md` 还自称基于 Anthropic 官方仓库适配。catalog 的 `owner` 用仓库 owner，
  `THIRD_PARTY_NOTICES.md` 把另外两处写进"作者"格。
  **Apache-2.0 比 MIT 多一条义务**：第 4 条 (b) 款要求"修改过的文件带上显著的声明"，光在他处（`UPSTREAM.md`）
  说明不够。所以凡被改写的正文各加一行可见声明（点名所钉 commit 与本文件）；这颗快照在本仓只保留这 12 份
  被改写的正文，`test/selected-skills-content.test.mjs` 逐份正向断言这一行，漏了不会有别的报错。
- [ ] **10. 反证。** 把任意一颗已改的 skill 换回上游原文，`npm test` 必须红并点名它（防闸门退化成空断言）。
- [ ] **11. 证据请求。** 每颗 catalog 的 `SKILL.md` 必须有 `## Evidence request`，写清要哪些证据（标的、证据类型、字段或章节、期间、as-of），**不写取数方式**；取数与角色分工只写在系统提示的 `capital:data-contract` 一处，skill 不回写服务商、URL、密钥或脚本。`test/selected-skills-content.test.mjs` 逐颗正向断言；新增一颗忘了写就直接红。

### 快照目录与发现

- 上游项目快照放在 `selected-skills/<repository>/`，保留上游自己的目录结构；`UPSTREAM.md` 记录仓库 URL、固定 commit、许可与本地改动，`LICENSE` 随快照保留。当前布局及说明见 [`selected-skills/README.md`](../../selected-skills/README.md)。
- provider 的 `customSkillDirs` 指向每个项目的 `skills/` 根目录。DSH filesystem provider 只枚举该根目录的直接子项：目录项需有 `<skill-dir>/SKILL.md`，或根目录直接包含 `.md` 文件。它不会递归寻找任意深度的 `SKILL.md`；指错到仓库根、`references/` 等目录时，技能可能不被发现。
- `SKILL.md` 必须有可解析的 YAML frontmatter，且至少包含 provider 要求的 `name`、`description`。缺字段、YAML 格式错误或不符合 DSH skill name 规则的文件会被跳过，而不是作为普通文本加载。
- **上游只写 `description` 是真实形态**（Claude Code 按目录名推导 skill 身份）。DSH provider 缺 `name` 时只 `logger.warn` 一行就跳过整颗文件，症状是"快照在仓库里、卡片能勾、会话里永远不出现"。接入前先 `head -4 <skill>/SKILL.md` 数一下字段；缺就在快照里机械补一行 `name: <目录名>`，并按下条记进 `UPSTREAM.md`。`name` 必须匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`（`10k-digest` 这种数字开头是合法的）。
- `name` 是运行时 skill 身份，不是展示标题。catalog 的 `name` 必须与 frontmatter `name` 完全一致；目录名也建议与该名称一致，便于从路径直接核对。发现文件但名字不一致时，catalog 过滤会把它隐藏。`test/persona.test.mjs` 逐条核对 catalog 每一条的 frontmatter `name` 与 `description`。
- 上游正文**可以改，但只有三个理由**：上面清单里的合规项、运行时可发现性（补 `name`），以及**可见性分层**——把一份超过一次加载上限的正文切成「入口册 + 分册」，让模型按需用 `read` 取分册（上限的算法与实测见 `docs/dev/preset-persona.md` §8.2 的单次加载字节预算与 `test/selected-skills-content.test.mjs` 的可见性闸门）**切完必须逐条查指示词**：正文里的 `above` / `below` / `上面` / `第 N 节` 原来指同一份文件里的内容，切开之后就指向别的文件了，模型按错地图走路。这一条正则钉不住（`Price above MA50` 一类全是误伤），所以它是分层的工序步骤，不是闸门——第一批 7 颗查到 5 处，第二批 25 颗只 1 处，因为批量那一轮按 `##` **保序**搬、并按渲染包络预留分册抬头的位置，**被切到下一册的那一节在册末自动留一句指针**（"This section is not finished here: … continues in `references/NN-….md`"），`following sections` 这类回指才落得住。分层只准**搬家**：每份分册都要一次加载全文可见、每一册都得有人指过去、卡片/规则不重不漏、目录内 `.md` 总量只准涨；Apache-2.0 那一族的 §4(b) 声明行跟着搬进**每一份分册**（闸门逐份 `.md` 问，不只问 `SKILL.md`）。断链那条判据只认**裸文件名或以 `references/` 打头**的路径——上游正文里也写 `.md`，但那是产物名模板（`<TICKER>-10k-digest.md`）或输出目录示例（`output/thesis/NVDA.md`），当册地址就是假阳性（2026-10-15 两颗各撞一种）。除此之外不为了口味改措辞、不改目录名、不改分析结论。每一次改写都要在该快照的 `UPSTREAM.md` 里逐条列出（改了哪一类句子、为什么、影响几颗）——`test/selected-skills-content.test.mjs` 钉住结果（分层那一侧两条：每册可见性 + 搬家不删规则），`UPSTREAM.md` 钉住理由。
- 快照目录**不要带上游自己的 `.gitignore`**：它会在本仓继续生效，而 git 在被排除的父目录之下无法再 include（上游 `build/` + `!site/build/*.js` 那种写法实测挡掉三个文件）。留着一个与所钉 commit 不一致的快照，比少几个文件更糟；删掉它并记进 `UPSTREAM.md`。

### Catalog 与隔离边界

- 每个可选 skill 在 `selected-skills/catalog.js` 有独立条目。`key` 是 Capital 设置使用的稳定键，`repository` 对应快照目录名，`name` 对应上游 skill frontmatter。多个项目可有同名 skill，但 provider 的启用集合**只按 name 认**，所以 catalog 里 `key` 与 `name` 都必须全局唯一（`test/persona.test.mjs` 钉住）。撞名时**不收后面那颗**（第五颗的 `earnings-preview` 与 InvestSkill 已收录的那颗同名，因此不收录、已删除），不去改上游的 `name` 或目录名——那是 skill 的运行时身份，改了就和所钉 commit 对不上。
- skills 根不假设是 `<快照目录>/skills`：`selected-skills/catalog.js` 的 `SELECTED_SKILL_SKILL_DIRS`（repository → 上游放 `SKILL.md` 的相对子路径）是唯一来源，provider 现算 `customSkillDirs`、`test/packaging.test.mjs` 按它反查发布清单。上游把 skill 埋在 `plugins/<plugin>/skills/` 底下（InvestSkill 即如此）时只改这一处映射。
- 但这处映射表达不了"`SKILL.md` 就是 skills 根本身"（第四颗 peter-lynch-skill 即如此）：provider 与五处反查都按 `…/<skills 根>/<name>/SKILL.md` 走。这种情况在**快照里套一层 `skills/<name>/`**，`references/` 跟着一起搬（正文的相对链接因此不破），并记进该快照的 `UPSTREAM.md` 作为第三类本地改动——不为了让路径成立去动 provider 的布局假设。
- 反方向同样成立：**上游把 skill 分组在 `skills/<domain>/<name>/`（深了一层）也必须动快照**（第五颗 trading-skills 即如此）。provider 只枚举 skills 根的**直接子项**，指 `skills` 上去发现 0 颗，症状与上面一样是"卡片能勾、会话里永远不出现"。做法是平铺掉 `<domain>/`，**前提是逐颗核过正文链接**：只有全部指向自己目录内的 `references/` / `assets/`（无 `../`、无跨目录）才平得干净；上游 `catalog.json` 与 `docs/` 里的旧路径随之变旧，按"不进 catalog 的正文不动"保留并记进 `UPSTREAM.md`。
- 还有第四种形态：**上游有六个并列的 skills 根**（第六颗：`vertical-plugins/<条线>/skills/`，另有 `agent-plugins/<角色>/skills/` 是上游自己 vendored 的副本）。这时不要平铺、也不要动 provider 的布局假设，而是**只登记其中一条线**当根（`SELECTED_SKILL_SKILL_DIRS` 填 `vertical-plugins/china-finance/skills`），其余条线不进 provider 视野。挑哪一条要有依据：那颗快照的上游 `CLAUDE.md` 自己写明 "Skills are authored in `vertical-plugins/china-finance/skills/`" 且 "Never edit bundled copies directly"。这一手还顺手避开一类撞名——同一个仓库内部 `china-accrual-schedule` 在两条线里同名而内容不同，两个根同时登记就必然撞上"启用集合只按 name 认"。
- provider 明确关闭 DSH 默认 skill roots，只扫描配置的快照目录；否则用户或项目目录中的其他 skills 可能进入同一来源。
- 设置里的开关字段（主插件 `Config.selectedSkills` 与 settings 卡片）都按 catalog 现算。主插件 Config 曾手抄过一份 key 列表，接第三颗快照时两处就漂了——表现是卡片能拨、运行期读不到（AGENTS.md §9.7 同一族）。新增快照因此不动 `src/`。
- catalog 过滤必须同时覆盖 provider 的 `list()` 与 `get()`。只过滤列表不够：已有 candidate 仍可能被直接传给 `get()`，因此未启用或不在 catalog 的名字必须在读取内容时再次拒绝。
- selected-skills provider 按**角色**注册：`tools/selected-skills` 行的 `config.role` 分别挂进根 / `data_junior` / `web_retriever` / 保留的 `data_analyst`，`data_collector` 与 `visualization_specialist` 没有方法集因而不挂。provider 只在 Agent 自己的 scope 注册（`agent.ctx.inject(['skills'], ...)`），并要求 `agentPresets.composedPreset(agent.ctx)` 等于该角色 preset；不注册到 preset standing scope 或 Host scope。`agent/created` 与 `agent-preset/selected` 两条路径都接（GUI 先建后切是真实顺序；preset registry 在 mount 完成后才 append，监听一定早于事件落位），同一个 Agent 由 `WeakSet` 去重，注入失败撤登记以留下重试余地。开关是 settings 的 live 偏好，**每轮 `agent/pre-step` 重读**：`list()` / `get()` 在调用期按最新开关与 `routing.js` 的 `roles` 过滤，pre-step 对比指纹，变了才 `control.invalidate()`；未变零成本。初始全关也注册 provider（否则后来打开永远不出现），`list()` 短路返回空目录、不扫快照。开关值走 `readCapitalEntry()`：`settings.describe()` → `configEditor` 保存层，读不到返回空对象而不是“全关”；服务引用调用期现取。provider 注册不等于全文注入：`tool-skill` 每轮发布目录，模型仍需 `skill` 加载正文；角色 system section 只列已启用且快照存在的方法。实际加载由 `src/agents/skill-usage.ts` 按 session 记账（原生 `skill`、PTC `tools.skill`、用户 `/name`），主 Agent 的 section 按 `parentSession` 汇总整棵树并要求最终答复点名，`scripts/skill-usage-report.mjs` 从会话日志复算与审计；任务型内置 skill 不再拼索引，详情见 `docs/dev/selected-skill-index.md` §8.7。
- 与 Capital 已有路由冲突的上游编排 skill 不应仅因为它和模块一起存在于快照中就进入 catalog；2026-10 收敛后这类正文整个出仓，仓里只留 catalog 条目。
- 运行时树没有可执行文件，所以"脚本随快照保留但不会运行"这句话不再有适用对象：脚本要么删掉，要么作为纯公式参考实现住进 `reference-algorithms/`。

### 发布打包与回归

- 本地工作区能发现文件，不代表发布包含有它。`package.json` 的 `files` 按仓库逐个登记（`selected-skills/catalog.js`、同级 `README.md`，加上每颗 `selected-skills/<repository>`）；新接一份快照忘了登记时 catalog 仍可能有条目，但用户启用后找不到对应 `SKILL.md`。
- 更新 catalog 时，确认每一条 `repository` / `name` 都能对应到 `selected-skills/<repository>/skills/<name>/SKILL.md`，并确认该项目的 `LICENSE` 与 `UPSTREAM.md` 随包发布。通过 npm pack 文件清单验证，不要只依赖仓库目录存在。
- 随包发的是运行时正文与溯源：catalog 里每颗的 `SKILL.md` 与其引用的 `references/`、`assets/` Markdown，快照根的 `LICENSE` 与 `UPSTREAM.md`；A 股那六颗另带它们逐条链接的 `skills/shared/`。**仓里没有 `.npmignore` 了**：非运行内容不是"挡在包外"，而是已经从仓里删除，发布清单因此只需要一张白名单。
- 白名单在 `test/packaging.test.mjs`：`selected-skills/<repo>/**` 只允许 `LICENSE`、`UPSTREAM.md`、catalog 目录下的 `.md`，以及 `china-stock-research-skills/skills/shared/**`；`reference-algorithms/` 不在 `package.json` 的 `files` 里，出现即红。这比逐颗 `.npmignore` 的反向断言强一档：新增文件默认是红的，不会因为忘写一条规则就漏进包。
- 每份 `UPSTREAM.md` 必须记"删了什么、为什么、所钉 commit"：这是快照不再逐字节完整之后唯一的复核入口。重新按 commit 覆盖快照时按这份清单过滤，别把已删的正文与脚本带回来。
- 回归重点在 `test/selected-skills-content.test.mjs`（按 catalog 现算的正文合规扫描，扫每颗 skill 目录下的全部 `.md`：取数归属、记忆回填、执行面、委派档、`## Evidence request`、被删 skill 的名字）与 `test/selected-skills-structure.test.mjs`（运行时树只许 Markdown、目录逐颗对得上 catalog、参考算法区无 I/O）、`test/selected-skills-provider.test.mjs`（默认关闭、root/preset 限定、list/get 过滤、scope 清理和每轮 pre-step 读最新开关——含已有 Agent 的目录刷新、缓存失效时机与两种监听顺序；catalog 清单对多 skill 的快照按「skills 根目录 − 排除清单」派生，不写死名单）、`test/persona.test.mjs`（skill frontmatter / preset 接线 / catalog 身份唯一）及 `test/packaging.test.mjs`（发布包逐条查文件）。改动目录布局、catalog 字段或接入逻辑时同步这些断言。
