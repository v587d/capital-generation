# 外部项目 Skill 接入与运行时约束

> 索引见仓库根 `AGENTS.md` §8。本文记录把外部项目的 skill 接入本仓时必须过的清单（§8.6 第一节）与已验证的发现、加载、隔离和打包行为；不规定候选评估打分与阶段状态。

## 8.6 外部项目快照与运行时接线

### 接入必查清单（逐条打勾；不合规就地改掉正文）

清单只针对 **catalog 暴露的 skill**：不进可选清单的正文留在快照里当材料，不改也不扫。
`test/selected-skills-content.test.mjs` 按 catalog 现算扫描面，新加一条 skill 立刻进扫描，
重新按 commit 覆盖快照而没重做下面的改写会直接红。扫描面是**每颗 catalog skill 目录下的全部 `.md`**
（含 `references/` 一类附属文件）：第四颗改完 `SKILL.md` 才发现，真正把 Agent 指回自行浏览的那一句
住在 `references/deep/system-prompt.md`，只扫入口等于没扫（AGENTS.md §9.7 同一个族）。

- [ ] **1. 谁去取数。** 正文有没有要求 Agent 自己去 `web search`、抓 URL 或跑取数脚本。本插件取数
  只有一个入口：主 Agent 委派 `data_collector`（结构化数据）/ `web_retriever`（网页与披露文件）；
  根角色的 13 颗出网工具是逐名 deny 的（§1.1、`src/agents/root-tool-policy.ts`）。
  **改法**：把"你自己搜"换成"走宿主取数通道；角色分流的宿主里，把标的、字段、as-of 日期写进委派 brief 交出去"。
  闸门按 `web search` 这**个词组**扫，不是只扫 `use web search` 那一种措辞——第四颗的原句是
  `All data comes from web search and fetched pages` 与 `Using the host agent's web search and page fetch tools`。
- [ ] **2. 取不到怎么办（最严重的一条）。** 有没有"打个 ⚠️ 警告然后用训练记忆估一个"的逃生口
  （`training-data estimates`、`Retrieval: model memory`、`Live data unavailable`）。**没有任何工具会拦它**——
  工具面拦得住越界取数，拦不住编造数字。**改法**：点名缺哪些字段、该字段下的分析停止，不回填。
- [ ] **3. 出处块的取数档。** `Data & Sources` 一类模板的 `Retrieval:` 枚举必须含委派档
  （`delegated retrieval`），且不许把 memory 列成一种取数途径。
- [ ] **4. 执行面。** 有没有 `python3 …` / `node …` / `install.sh` 一类指令。根角色没有 shell（§1.6），
  上游脚本也不进发布包。**改法**：删掉；确属方法论一部分的，必须同时写清"没有 shell 时直接读哪份附属文件"。
- [ ] **5. 出图与报告。** 教 Agent 自己产出 HTML/Chart.js/图形或报告文件的，**不进 catalog**
  （§6.1 出图只走 `render_chart`；§7 报告链路已删除且禁止恢复），留在快照里当材料。
- [ ] **6. 编排与别名。** 会接管会话路由的 orchestrator、上游自己标注的 alias 残片，不进 catalog。
- [ ] **7. 金融表达合规。** 不承诺收益或准确率；打分项（0–10 那一类）要说明衡量的是自洽度/结构特征
  而非预测表现；给仓位、买卖动作的段落必须在 `riskNote` 写明是推演练习——本项目不提供投资建议。
- [ ] **8. 市场口径。** 非 A 股口径（SEC EDGAR / Form 4 / 13F / FRED / 美国税制…）逐条进
  `description` 与 `riskNote`，并给一个能力标签，让使用者在卡片上筛得出来哪些是美股专用。
- [ ] **9. 许可与留痕。** 许可证明确且允许再分发；`LICENSE` 原件随包；commit / release / 最近提交
  记进 `UPSTREAM.md`；**改了哪几类句子、为什么改，逐条记**——这是"可以改正文"的唯一代价。
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

- 每个可选 skill 在 `selected-skills/catalog.js` 有独立条目。`key` 是 Capital 设置使用的稳定键，`repository` 对应快照目录名，`name` 对应上游 skill frontmatter。多个项目可有同名 skill，但 provider 的启用集合**只按 name 认**，所以 catalog 里 `key` 与 `name` 都必须全局唯一（`test/persona.test.mjs` 钉住）。
- skills 根不假设是 `<快照目录>/skills`：`selected-skills/catalog.js` 的 `SELECTED_SKILL_SKILL_DIRS`（repository → 上游放 `SKILL.md` 的相对子路径）是唯一来源，provider 现算 `customSkillDirs`、`test/packaging.test.mjs` 按它反查发布清单。上游把 skill 埋在 `plugins/<plugin>/skills/` 底下（InvestSkill 即如此）时只改这一处映射。
- 但这处映射表达不了"`SKILL.md` 就是 skills 根本身"（第四颗 peter-lynch-skill 即如此）：provider 与五处反查都按 `…/<skills 根>/<name>/SKILL.md` 走。这种情况在**快照里套一层 `skills/<name>/`**，`references/` 跟着一起搬（正文的相对链接因此不破），并记进该快照的 `UPSTREAM.md` 作为第三类本地改动——不为了让路径成立去动 provider 的布局假设。
- provider 明确关闭 DSH 默认 skill roots，只扫描配置的快照目录；否则用户或项目目录中的其他 skills 可能进入同一来源。
- 设置里的开关字段（主插件 `Config.selectedSkills` 与 settings 卡片）都按 catalog 现算。主插件 Config 曾手抄过一份 key 列表，接第三颗快照时两处就漂了——表现是卡片能拨、运行期读不到（AGENTS.md §9.7 同一族）。新增快照因此不动 `src/`。
- catalog 过滤必须同时覆盖 provider 的 `list()` 与 `get()`。只过滤列表不够：已有 candidate 仍可能被直接传给 `get()`，因此未启用或不在 catalog 的名字必须在读取内容时再次拒绝。
- selected-skills provider 只在新建的 Capital 根 Agent scope 内注册；子 Agent 和其他 preset 不注册。设置值在 Agent 创建时读取，因此切换设置不会改写已经创建的 Agent；新建 Capital 会话后才按新选择加载。
- 与 Capital 已有路由冲突的上游编排 skill 不应仅因为它和模块一起存在于快照中就进入 catalog。当前 China Stock Research 快照保留上游 orchestrator 作为来源材料，但 catalog 只列独立研究模块。
- 上游脚本随快照保留不等于它们会运行。intake/provider 路径只发现并读取 skill 文档，不执行上游脚本。

### 发布打包与回归

- 本地工作区能发现文件，不代表发布包含有它。`package.json` 的 `files` 按仓库逐个登记（`selected-skills/catalog.js`、同级 `README.md`，加上每颗 `selected-skills/<repository>`）；新接一份快照忘了登记时 catalog 仍可能有条目，但用户启用后找不到对应 `SKILL.md`。
- 更新 catalog 时，确认每一条 `repository` / `name` 都能对应到 `selected-skills/<repository>/skills/<name>/SKILL.md`，并确认该项目的 `LICENSE` 与 `UPSTREAM.md` 随包发布。通过 npm pack 文件清单验证，不要只依赖仓库目录存在。
- 随包发的是运行时正文与溯源（skills 根 + `LICENSE` + `UPSTREAM.md`），不是上游仓库的全部：每颗快照用**自己的 `.npmignore`** 挡非运行内容（`investment-skills` 挡 README 成图与 viz 站点；`InvestSkill` 挡它的静态站 `site/`、与 skill 正文同源的 `prompts/` 副本、`scripts/`、CI 与站点体检记录）。全量快照完整住在 git，`github:` 安装与"当时是哪个 commit"的复核都不受影响。**那份 `.npmignore` 就是排除口径的唯一声明处**：`test/packaging.test.mjs` 逐颗快照读它、再拿发布清单反查，写了却没生效、或有人放宽口径都会红。放宽口径要同步该项目的 `UPSTREAM.md` Packaging 一行。
- 回归重点在 `test/selected-skills-content.test.mjs`（按 catalog 现算的正文合规扫描，扫每颗 skill 目录下的全部 `.md`：取数归属、记忆回填、执行面、委派档）、`test/selected-skills-provider.test.mjs`（默认关闭、root/preset 限定、list/get 过滤、scope 清理和新 Agent 读最新开关；catalog 清单对多 skill 的快照按「skills 根目录 − 排除清单」派生，不写死名单）、`test/persona.test.mjs`（skill frontmatter / preset 接线 / catalog 身份唯一）及 `test/packaging.test.mjs`（发布包逐条查文件）。改动目录布局、catalog 字段或接入逻辑时同步这些断言。
