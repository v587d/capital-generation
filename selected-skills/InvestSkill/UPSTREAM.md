# Upstream Record

- Project: InvestSkill（上游以 Claude Code plugin `us-stock-analysis` 的形式发布）
- Repository: https://github.com/yennanliu/InvestSkill
- Upstream commit: `c3f2a17cd2b6ac9731beb3b5739592446ad6f556`（main，2026-10-09）
  - 这颗 HEAD 是上游机器人的 daily site review 提交；最后一次**内容**提交是
    `113527fc7e44a723513dc2840becca7ab6eba823`（2026-09-25，PR #32 prompt-audit），同日打 `v1.12.0`。
    catalog 的 `lastCommit` 记的是后者。
- License: MIT；`LICENSE` 为上游原件（`Copyright (c) 2026 yennanliu`），未改写。
- Imported content: 该 commit 的完整仓库快照，只移除上游自己的 `.gitignore`（见下）。
  34 颗 skill 在 `plugins/us-stock-analysis/skills/<name>/SKILL.md`；`scripts/`、`prompts/`、
  `site/`、`qa/`、`doc/`、`data/`、`.github/` 作为可审查材料保留，intake 与 activation 都不执行它们。
- Local modifications（三类，逐条可复核；口径与理由见 `docs/dev/selected-skills.md` §8.6 的接入必查清单）：
  1. **34 颗 `SKILL.md` 的 frontmatter 第一键补 `name: <目录名>`。** DSH filesystem provider 要求
     frontmatter 同时有 `name` 与 `description`，缺 `name` 的文件是**静默跳过**（只 warn）——原样收录
     时 34 颗一颗都不会被发现。上游依赖 Claude Code 从目录名推导，所以它自己不需要这一行。
  2. **删除上游的 `.gitignore`。** 它在宿主仓库里会静默挡掉 `site/build/`：上游用 `build/` 这条目录
     规则配上 `!site/build/*.js` 的反向白名单，而 git 在被排除的父目录之下无法再 include——留着一个
     不完整、且与所钉 commit 不一致的快照，比少三个文件更糟。vendored 快照不把 ignore 规则带进宿主仓库。
  3. **28 颗 catalog skill 的取数口径改写**（168 行删 / 161 行增，全部落在下面五类句子上；
     不进 catalog 的 6 颗原文未动）。上游正文写给"什么工具都在手边"的宿主，与本插件的取数边界冲突：
     - `1. **Fetch …** — use web search or ask the user for …` → 改为"走宿主自己的取数通道；
       角色分流的宿主里把标的、字段、as-of 日期写进委派 brief 交出去"（24 处，含 economics / etf /
       sector / risk-stress 的变体与 fact-check 的"只在主张需要时才取现价"）。
     - `4. **Flag stale data explicitly** … display this warning before proceeding` 与
       `> ⚠️ **Live data unavailable.** … training-data estimates …` → 改成 `**Stop on missing data**`：
       点名缺哪些字段、该字段下的分析停止，不回填（23 + 25 处）。
     - 收尾句 `Never silently substitute training-data estimates … ask the user to paste …` → 改成
       "取数是宿主数据通道的职责（委派）；只有宿主完全没有检索路径时才谈用户粘贴"（24 处）。
     - 出处块 `Retrieval: <pasted by user | web/tool retrieval | model memory>` → 去掉 `model memory`
       这一档、加 `delegated retrieval`（27 处）；配套那条"`model memory` 配 `Confidence: LOW`"改成
       "记忆不是取数途径：没取到的数字报缺，不写进这一栏"（27 处）。`result-validator` 的评分口径同步改，
       `learning-coach` 检测的"没有检索路径"随之改名。
     - 无密钥 EDGAR 取数阶梯（`10k-digest` / `financial-report-analyst` / `fact-check`）：A 档从
       "宿主能抓就自己抓"改成"走宿主检索通道＝委派"；B 档只在"宿主完全没有检索路径"时谈用户粘贴；
       C 档从"设成 model memory + LOW 继续"改成"缺的就缺着"。**删掉两处 `node scripts/fetch-*.js`
       指令**——`scripts/` 不进发布包，根角色也没有 shell（AGENTS.md §1.6）。
     分析结论、方法论、评分表、输出模板与其余正文**一字未改**。
  复核方法：`git clone` 所钉 commit 后 `diff -r`，差异只应包含以上三类；
  `test/selected-skills-content.test.mjs` 扫正文**结果**、本文件记**理由**，两边任一漂回去都会红。
- Catalog scope: 28 颗进入 `selected-skills/catalog.js`，六颗留在快照里但不进可选清单：
  - `fundamental-analysis`、`dcf-valuation`、`research-bundle`：上游自己标注的 alias 残片
    （`scripts/lib/skill-registry.js` 的 `ALIAS_SKILLS`），正文已声明分别并入 `stock-eval` /
    `stock-valuation` / `full-report`，勾到它们只会拿到一份速查表而不是在维护的完整模块。
  - `full-report`：上游编排 skill（跑多个模块再合成总分），与 `china-stock-research-orchestrator`
    被排除是同一条理由——本插件的角色路由是单点决策。
  - `report-generator`：上游的输出口（把别的 skill 结果渲染成 HTML/PDF 存进 `output/`），与已删除并
    禁止恢复的报告交付链路冲突（`AGENTS.md` §7）。
  - `chart-master`：教 Agent 自己产出 HTML/Chart.js 与 Mermaid 图形，出图一律走 `render_chart`
    且只有 `visualization_specialist` 持有（`AGENTS.md` §6.1）。
- Maintenance snapshot（checked 2026-10-10）：251 次提交；近 90 天 47 次非机器人提交、近 180 天 111 次；
  最新 release `v1.12.0`（2026-09-25）。维护活跃，因此标 `experimental`。
  See [GitHub commit history](https://github.com/yennanliu/InvestSkill/commits/main/).
- Runtime status: `experimental` / 显式实验。默认全关，只在使用者于「插件」→ Capital Generation →「配置」
  逐格打开后，对**之后新建**的 Capital 根 Agent 可见；子 Agent 不继承。
- Financial boundary: 正文口径天生是美股（SEC EDGAR / Form 4 / 13F、FRED、美国税制），并且多模块给出
  0–10 打分与分批仓位的写法。本插件不提供投资建议：每条 catalog 的 `riskNote` 写明打分是自洽度信号、
  股数区间是推演练习，不是订单，也不承诺表现。
- Data-fetch assumption: 每颗 skill 开篇都要求 Agent 先用网页搜索取实时报价。**这不授予新权限**——
  取数仍受本插件的角色与工具边界约束（主 Agent 委派、原始 rows 不出工具层），skill 正文只是方法论材料。
- Review status: 收录供使用者自行实验，不构成对任何金融方法的背书。复核前先读上面的 Catalog scope，
  确认排除项没有被人顺手加回。
