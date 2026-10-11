# 外部项目 Skill 接入与运行时约束

> 索引见仓库根 `AGENTS.md` §8。本文记录把外部项目的 skill 接入本仓时必须过的清单（§8.6 第一节）与已验证的发现、加载、隔离和打包行为；不规定候选评估打分与阶段状态。

## 8.6 外部项目快照与运行时接线

### 接入必查清单（逐条打勾；不合规就地改掉正文）

清单只针对 **catalog 暴露的 skill**：不进可选清单的正文留在快照里当材料，不改也不扫。
`test/selected-skills-content.test.mjs` 按 catalog 现算扫描面，新加一条 skill 立刻进扫描，
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
  退路句。根角色没有 shell（§1.6）。**改法**：删掉；确属方法论一部分的，必须同时写清
  "没有 shell 时直接读哪份附属文件"，并指明统计量交给宿主数据侧（本插件里委派 `data_junior`）。
  这条管的是**正文**：脚本文件本身可以随包留在快照里当可审查材料（下面 Packaging 那条），
  只要没有一句话指挥 Agent 去跑它，provider 与工具面也从不执行。
  同一族的另一种形状是**"看起来能跑"的伪调用围栏**：第六颗的 ```python 块里没有 import、没有 shell 指令，
  写的却是 `get_financials(ticker, "income", "annual") → 利润表`——模型会照着这个形状去调一个运行时不存在的工具。
  按同一条处理：整段换成委派 brief（要哪些字段、as-of 哪天），字段清单本身是方法论，留下。
- [ ] **5. 出图与报告。** 教 Agent 自己产出 HTML/Chart.js/图形或报告文件的，**不进 catalog**
  （§6.1 出图只走 `render_chart`；§7 报告链路已删除且禁止恢复），留在快照里当材料。
- [ ] **6. 编排与别名。** 会接管会话路由的 orchestrator、上游自己标注的 alias 残片，不进 catalog。
- [ ] **7. 金融表达合规。** 不承诺收益或准确率；打分项（0–10 那一类）要说明衡量的是自洽度/结构特征
  而非预测表现；给仓位、买卖动作的段落必须在 `riskNote` 写明是推演练习——本项目不提供投资建议。
- [ ] **8. 市场口径。** 非 A 股口径（SEC EDGAR / Form 4 / 13F / FRED / 美国税制…）逐条进
  `description` 与 `riskNote`，并给一个能力标签，让使用者在卡片上筛得出来哪些是美股专用。
- [ ] **9. 许可与留痕。** 许可证明确且允许再分发；`LICENSE` 原件随包；commit / release / 最近提交
  记进 `UPSTREAM.md`；**改了哪几类句子、为什么改，逐条记**——这是"可以改正文"的唯一代价。
  署名不一致要**按现状记三条**，不要替上游挑一个：第六颗的 `LICENSE` 附录是 `Copyright [2025] [jwangkun]`
  （Apache 自己的说明要求填好后去掉方括号，上游没去），六份 `plugin.json` 的 author 又写
  `Anthropic FSI China`，`README.md` 还自称基于 Anthropic 官方仓库适配。catalog 的 `owner` 用仓库 owner，
  `THIRD_PARTY_NOTICES.md` 把另外两处写进"作者"格。
  **Apache-2.0 比 MIT 多一条义务**：第 4 条 (b) 款要求"修改过的文件带上显著的声明"，光在他处（`UPSTREAM.md`）
  说明不够。所以凡被改写的正文各加一行可见声明（点名所钉 commit 与本文件），与上游逐字节相同的那些颗不加；
  `test/selected-skills-content.test.mjs` 有一条正向断言钉住"这一族每颗都得带"，因为漏了不会有别的报错。
- [ ] **10. 反证。** 把任意一颗已改的 skill 换回上游原文，`npm test` 必须红并点名它（防闸门退化成空断言）。

### 快照目录与发现

- 上游项目快照放在 `selected-skills/<repository>/`，保留上游自己的目录结构；`UPSTREAM.md` 记录仓库 URL、固定 commit、许可与本地改动，`LICENSE` 随快照保留。当前布局及说明见 [`selected-skills/README.md`](../../selected-skills/README.md)。
- provider 的 `customSkillDirs` 指向每个项目的 `skills/` 根目录。DSH filesystem provider 只枚举该根目录的直接子项：目录项需有 `<skill-dir>/SKILL.md`，或根目录直接包含 `.md` 文件。它不会递归寻找任意深度的 `SKILL.md`；指错到仓库根、`references/` 等目录时，技能可能不被发现。
- `SKILL.md` 必须有可解析的 YAML frontmatter，且至少包含 provider 要求的 `name`、`description`。缺字段、YAML 格式错误或不符合 DSH skill name 规则的文件会被跳过，而不是作为普通文本加载。
- **上游只写 `description` 是真实形态**（Claude Code 按目录名推导 skill 身份）。DSH provider 缺 `name` 时只 `logger.warn` 一行就跳过整颗文件，症状是"快照在仓库里、卡片能勾、会话里永远不出现"。接入前先 `head -4 <skill>/SKILL.md` 数一下字段；缺就在快照里机械补一行 `name: <目录名>`，并按下条记进 `UPSTREAM.md`。`name` 必须匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`（`10k-digest` 这种数字开头是合法的）。
- `name` 是运行时 skill 身份，不是展示标题。catalog 的 `name` 必须与 frontmatter `name` 完全一致；目录名也建议与该名称一致，便于从路径直接核对。发现文件但名字不一致时，catalog 过滤会把它隐藏。`test/persona.test.mjs` 逐条核对 catalog 每一条的 frontmatter `name` 与 `description`。
- 上游正文**可以改，但只有两个理由**：上面清单里的合规项，以及运行时可发现性（补 `name`）。除此之外不为了口味改措辞、不改目录名、不改分析结论。每一次改写都要在该快照的 `UPSTREAM.md` 里逐条列出（改了哪一类句子、为什么、影响几颗）——`test/selected-skills-content.test.mjs` 钉住结果，`UPSTREAM.md` 钉住理由。
- 快照目录**不要带上游自己的 `.gitignore`**：它会在本仓继续生效，而 git 在被排除的父目录之下无法再 include（上游 `build/` + `!site/build/*.js` 那种写法实测挡掉三个文件）。留着一个与所钉 commit 不一致的快照，比少几个文件更糟；删掉它并记进 `UPSTREAM.md`。

### Catalog 与隔离边界

- 每个可选 skill 在 `selected-skills/catalog.js` 有独立条目。`key` 是 Capital 设置使用的稳定键，`repository` 对应快照目录名，`name` 对应上游 skill frontmatter。多个项目可有同名 skill，但 provider 的启用集合**只按 name 认**，所以 catalog 里 `key` 与 `name` 都必须全局唯一（`test/persona.test.mjs` 钉住）。撞名时**不收后面那颗**（第五颗的 `earnings-preview` 与 InvestSkill 已收录的那颗同名，因此留在快照里当材料），不去改上游的 `name` 或目录名——那是 skill 的运行时身份，改了就和所钉 commit 对不上。
- skills 根不假设是 `<快照目录>/skills`：`selected-skills/catalog.js` 的 `SELECTED_SKILL_SKILL_DIRS`（repository → 上游放 `SKILL.md` 的相对子路径）是唯一来源，provider 现算 `customSkillDirs`、`test/packaging.test.mjs` 按它反查发布清单。上游把 skill 埋在 `plugins/<plugin>/skills/` 底下（InvestSkill 即如此）时只改这一处映射。
- 但这处映射表达不了"`SKILL.md` 就是 skills 根本身"（第四颗 peter-lynch-skill 即如此）：provider 与五处反查都按 `…/<skills 根>/<name>/SKILL.md` 走。这种情况在**快照里套一层 `skills/<name>/`**，`references/` 跟着一起搬（正文的相对链接因此不破），并记进该快照的 `UPSTREAM.md` 作为第三类本地改动——不为了让路径成立去动 provider 的布局假设。
- 反方向同样成立：**上游把 skill 分组在 `skills/<domain>/<name>/`（深了一层）也必须动快照**（第五颗 trading-skills 即如此）。provider 只枚举 skills 根的**直接子项**，指 `skills` 上去发现 0 颗，症状与上面一样是"卡片能勾、会话里永远不出现"。做法是平铺掉 `<domain>/`，**前提是逐颗核过正文链接**：只有全部指向自己目录内的 `references/` / `assets/`（无 `../`、无跨目录）才平得干净；上游 `catalog.json` 与 `docs/` 里的旧路径随之变旧，按"不进 catalog 的正文不动"保留并记进 `UPSTREAM.md`。
- 还有第四种形态：**上游有六个并列的 skills 根**（第六颗：`vertical-plugins/<条线>/skills/`，另有 `agent-plugins/<角色>/skills/` 是上游自己 vendored 的副本）。这时不要平铺、也不要动 provider 的布局假设，而是**只登记其中一条线**当根（`SELECTED_SKILL_SKILL_DIRS` 填 `vertical-plugins/china-finance/skills`），其余条线不进 provider 视野。挑哪一条要有依据：那颗快照的上游 `CLAUDE.md` 自己写明 "Skills are authored in `vertical-plugins/china-finance/skills/`" 且 "Never edit bundled copies directly"。这一手还顺手避开一类撞名——同一个仓库内部 `china-accrual-schedule` 在两条线里同名而内容不同，两个根同时登记就必然撞上"启用集合只按 name 认"。
- provider 明确关闭 DSH 默认 skill roots，只扫描配置的快照目录；否则用户或项目目录中的其他 skills 可能进入同一来源。
- 设置里的开关字段（主插件 `Config.selectedSkills` 与 settings 卡片）都按 catalog 现算。主插件 Config 曾手抄过一份 key 列表，接第三颗快照时两处就漂了——表现是卡片能拨、运行期读不到（AGENTS.md §9.7 同一族）。新增快照因此不动 `src/`。
- catalog 过滤必须同时覆盖 provider 的 `list()` 与 `get()`。只过滤列表不够：已有 candidate 仍可能被直接传给 `get()`，因此未启用或不在 catalog 的名字必须在读取内容时再次拒绝。
- selected-skills provider 只在新建的 Capital 根 Agent scope 内注册；子 Agent 和其他 preset 不注册。设置值在 Agent 创建时读取，因此切换设置不会改写已经创建的 Agent；新建 Capital 会话后才按新选择加载。
- 与 Capital 已有路由冲突的上游编排 skill 不应仅因为它和模块一起存在于快照中就进入 catalog。当前 China Stock Research 快照保留上游 orchestrator 作为来源材料，但 catalog 只列独立研究模块。
- 上游脚本随快照保留不等于它们会运行。intake/provider 路径只发现并读取 skill 文档，不执行上游脚本。

### 发布打包与回归

- 本地工作区能发现文件，不代表发布包含有它。`package.json` 的 `files` 按仓库逐个登记（`selected-skills/catalog.js`、同级 `README.md`，加上每颗 `selected-skills/<repository>`）；新接一份快照忘了登记时 catalog 仍可能有条目，但用户启用后找不到对应 `SKILL.md`。
- 更新 catalog 时，确认每一条 `repository` / `name` 都能对应到 `selected-skills/<repository>/skills/<name>/SKILL.md`，并确认该项目的 `LICENSE` 与 `UPSTREAM.md` 随包发布。通过 npm pack 文件清单验证，不要只依赖仓库目录存在。
- 随包发的是运行时正文与溯源（skills 根 + `LICENSE` + `UPSTREAM.md`），不是上游仓库的全部：六颗快照**都**用自己的 `.npmignore` 挡非运行内容（`investment-skills` 挡 README 成图、viz 站点、它的 CI 与 roadmap 文档；`china-stock-research-skills` 挡 issue/PR 模板、`examples/` 与九份仓库文档，但 **`skills/shared/` 必须留**——六颗模块的正文按 `../shared/…` 相对链接读那里的引用标准、行业 overlay 与输出模板；`InvestSkill` 挡静态站、与 skill 正文同源的 `prompts/` 副本、`scripts/`、CI 与 20 份仓库文档；`peter-lynch-skill` 只挡一份上游 README；`trading-skills` 挡它的 `docs/`、`scripts/`、CI、`catalog.json` 与 `skills/_lib/`，另按合规口径挡掉券商执行面那颗 `skills/etoro/`；第六颗挡 `agent-plugins/`（上游自己 vendored 的 skill 副本）、`managed-agent-cookbooks/` 与 `.codebuddy/`（它给别家宿主编排用的材料）、`scripts/`、每条款线的 `.claude-plugin/` 与 `.mcp.json`、根级 `README.md` / `CLAUDE.md` / 接入计划，并按同一条合规口径挡掉**四份可运行的取数服务端** `mcp-servers/`——它能连付费接口、带密钥配置形态，与不发布券商执行面是同一条线）。**上游自带的可执行面不在这条线上**：`framework.py`、`install.sh`、`Makefile`、`agents/openai.yaml` 照旧随包作为材料（有的正文把它写成方法论入口并同时给了无 shell 的退路），provider 与工具面从不执行——第 4 条管的是"正文不许指挥 Agent 去跑它"，不是"文件必须不在盘上"。全量快照完整住在 git，`github:` 安装与"当时是哪个 commit"的复核都不受影响。**那份 `.npmignore` 就是排除口径的唯一声明处**：`test/packaging.test.mjs` 逐颗快照读它、再拿发布清单反查，**目录规则与文件规则两类都问**（补的排除多是 `README*.md` 这类文件规则，只查目录等于放任它们不生效——AGENTS.md §9.7 同一族）；写了却没生效、或有人放宽口径都会红。放宽或收紧口径都要同步该项目的 `UPSTREAM.md` Packaging 一行。
**规则只能写裸名**（一条目录名或一个文件名，不带路径、不以 `/` 开头）：反向断言丢掉以 `/` 开头的规则、也不检查带内部斜杠的规则，而目录规则按**任意路径段**匹配——所以 `skills/` 这一条绝不能写（一颗快照里有六个 `skills` 段，写下去等于把全部正文挡掉，而 catalog 反查只报"包里找不到 SKILL.md"），`vertical-plugins/fund-admin/` 这种写法看起来更精确、实际根本不被检查。上游同名文件到处有的（`README.md`）也按裸名挡，npm 的 ignore 语义本来就是逐目录生效。
- 回归重点在 `test/selected-skills-content.test.mjs`（按 catalog 现算的正文合规扫描，扫每颗 skill 目录下的全部 `.md`：取数归属、记忆回填、执行面、委派档）、`test/selected-skills-provider.test.mjs`（默认关闭、root/preset 限定、list/get 过滤、scope 清理和新 Agent 读最新开关；catalog 清单对多 skill 的快照按「skills 根目录 − 排除清单」派生，不写死名单）、`test/persona.test.mjs`（skill frontmatter / preset 接线 / catalog 身份唯一）及 `test/packaging.test.mjs`（发布包逐条查文件）。改动目录布局、catalog 字段或接入逻辑时同步这些断言。
