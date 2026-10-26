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
- Packaging: 这颗自己的 `.npmignore` 是排除口径的唯一声明处（`test/packaging.test.mjs` 逐条反查，
  目录规则与文件规则都问）。挡掉的是上游静态站 `site/`（1.7 MB）、与 skill 正文同源的提示词副本
  `prompts/`（772 KB）、`scripts/`、`qa/`、`doc/`、`data/`、`.github/`、`.cursor/`、`.claude-plugin/`，
  以及只有人类读者会用的仓库文档：`README*.md` 六个语言/平台变体（含 `plugins/us-stock-analysis/README.md`）、
  `CLAUDE.md`、`GEMINI.md`、`ADDING-NEW-SKILLS.md`、`CI-CD-GUIDE.md`、`CONTRIBUTING.md`、`DEPLOYMENTS.md`、
  `FAQ.md`、`PLATFORM-COMPATIBILITY.md`、`RELEASE_NOTES.md`、`RELEASE-QUICK-REFERENCE.md`、`SECURITY.md`、
  `TODO.md` 与它自己的 `package.json`。根级 `install.sh` 照旧随包保留（本插件从不执行它）。
  不进可选清单的六颗 skill 也照旧随包，作为可审查材料。全量快照完整住在 git，
  `github:` 安装与"当时是哪个 commit"的复核都不受影响。
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
- Visibility layering, second batch (2026-10-15, same §8.6 reason): the remaining **25** catalogued entries in this
  snapshot were single-file bodies of 15,437–31,754 characters — every one of them arrived as a truncated excerpt
  (head 4,096 + tail 1,024) once a user ticked it. All 25 are now entry file plus parts under `skills/<name>/references/`:
  the entry keeps only what holds on every round (`⚠️ Data Verification`, `📋 Data & Sources Header`, and
  `⚠️ Read This First` where upstream wrote one), gains an index of the part filenames, and states that loading the
  entry is not reading the skill. Everything else moves **in section order** into `references/10…`, splitting a
  section that still overflows at `###`, then `####`, then blank-line paragraphs — and a section cut across two parts
  gets a one-line pointer at the cut (`This section is not finished here: … continues in references/NN-….md`), which
  is why prose like "the following sections" still lands: across the whole batch exactly **one** real dangling pointer
  had to be rewritten (`learning-coach`: "the quiz block from §4" → the part that now holds §4). Nothing was deleted —
  a line-set check per entry found zero lost lines apart from that rewrite, and each directory's `.md` total grew
  (e.g. `stock-eval` 31,754 → 34,135, `earnings-call-analysis` 15,437 → 16,873; 98 new parts in total). Sizes are judged
  on the **rendered** `read` receipt, with the part header itself reserved inside the envelope. Two upstream quirks are
  deliberately left alone: `institutional-ownership` mentions "the smart-money list above" that upstream never defines,
  and `fact-check`'s example table cites `§1…§5` of **the report being verified**, not of this skill — neither is a
  layering artefact. `test/selected-skills-content.test.mjs` (LAYERED, now 32 entries) and the ratchet in
  `test/persona.test.mjs` (baseline emptied, so any future oversized entry fails outright) hold the result.
- Visibility layering (2026-10-14, third allowed reason in `docs/dev/selected-skills.md` §8.6): `bear-case` and `stock-screener` had a single `SKILL.md` over the host load cap (8,192 code points; the middle of a longer tool result comes back as `[... tool result middle pruned ...]`). Each is now an entry file plus parts under `skills/<name>/references/`: `bear-case` 13,816 → 15,218 characters with `10-analysis-framework.md`, `11-output-and-signal.md`, `12-thesis-invalidation.md`; `stock-screener` 11,588 → 12,961 with `10-scoring-framework.md`, `11-output-format.md`, `12-invalidation-and-signal.md`. The entry keeps its per-round discipline sections (Data Verification, the Data & Sources header, Read This First / Accepted Inputs) and gains an index of the parts plus a line saying that loading the entry is not reading the skill. No line of upstream text was deleted: a line-set check against this commit found only the rewritten pointer lines, plus two cross-file pointers fixed (`pillars 1–7 above` → the file that now holds them, and the same for `The Score above`). MIT, so no per-file licence notice is required. Sizes are judged on the **rendered** `read` receipt (each line gains an `N: ` prefix), not on file characters — see `test/selected-skills-content.test.mjs`.
- Runtime status: `experimental` / 显式实验。默认全关，只在使用者于「插件」→ Capital Generation →「配置」
  逐格打开后，对**之后新建**的 Capital 根 Agent 可见；子 Agent 不继承。
- Financial boundary: 正文口径天生是美股（SEC EDGAR / Form 4 / 13F、FRED、美国税制），并且多模块给出
  0–10 打分与分批仓位的写法。本插件不提供代交易服务（没有券商接口，不代使用者下单或改单）：
  每条 catalog 的 `riskNote` 写明打分是自洽度信号、股数区间是推演练习，不是订单，也不承诺表现。
- Data-fetch assumption: 每颗 skill 开篇都要求 Agent 先用网页搜索取实时报价。**这不授予新权限**——
  取数仍受本插件的角色与工具边界约束（主 Agent 委派、原始 rows 不出工具层），skill 正文只是方法论材料。
- Review status: 收录供使用者自行实验，不构成对任何金融方法的背书。复核前先读上面的 Catalog scope，
  确认排除项没有被人顺手加回。

## 2026-10 收敛：仓内只保留 catalog 正文

本仓不再保存上游全量快照。除 catalog 命中的 28 颗正文、LICENSE 与本文件之外，以下内容按 2026-10 政策**从仓里删除**（不是仅从包里排除）；重新按上面所钉 commit 覆盖快照时按本节过滤。

- **非 catalog skill（6 颗）**：`chart-master`、`dcf-valuation`、`full-report`、`fundamental-analysis`、`report-generator`、`research-bundle`。
- **上游仓库材料**：`.claude-plugin`、`.cursor`、`.github`、`.npmignore`、`ADDING-NEW-SKILLS.md`、`CHANGELOG.md`、`CI-CD-GUIDE.md`、`CLAUDE.md`、`CONTRIBUTING.md`、`DEPLOYMENTS.md`、`FAQ.md`、`GEMINI.md`、`PLATFORM-COMPATIBILITY.md`、`README-claude-code.md`、`README-cursor.md`、`README-gemini.md`、`README-ollama.md`、`README-zh-TW.md`、`README.md`、`RELEASE-QUICK-REFERENCE.md`、`RELEASE_NOTES.md`、`SECURITY.md`、`TODO.md`、`data`、`doc`、`install.sh`、`package-lock.json`、`package.json`、`plugins`、`prompts`、`qa`、`scripts`、`site`。
- 许可与署名不受影响：`LICENSE` 原件、所钉 commit 与作者信息仍在上面各节；公开许可只要求保留版权与许可声明。
