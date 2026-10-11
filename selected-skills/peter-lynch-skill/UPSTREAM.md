# Upstream Record

- Project: Peter Lynch Research（一颗 skill、两条工作流：Quick 快筛给 SKIP / WATCHLIST / DEEP RESEARCH，Deep 出完整尽调报告）
- Repository: https://github.com/DjNero11/peter-lynch-skill
- Upstream commit: `e0eaf5830f57768cc4fb6543682ae1eb3c8d022c`（main，2026-06-28）
  - 全仓只有两次提交：上一条 `4f028d6`（2026-06-23，Initial commit）。无 release、无 tag、无 CI。
- License: MIT；`LICENSE` 为上游原件（`Copyright (c) 2026 Szymon Nycz`），未改写。
  frontmatter 的 `metadata.author` 是 **Szymon Nycz**，与 GitHub login `DjNero11` 不同名——
  catalog 的 `owner` 用后者，因为它拼的是仓库链接。
- Imported content: 该 commit 的完整文件树（`SKILL.md` + `references/` 下 8 份附属文件 + `README.md` + `LICENSE`），
  132 KB。无脚本、无凭据读取、无出网调用、不落盘产物（`python3` / `node` / `install` 命中 0）。
- Local modifications（三类，逐条可复核；口径与理由见 `docs/dev/selected-skills.md` §8.6 的接入必查清单）：
  1. **套了一层 `skills/peter-lynch-skill/`。** 上游把 `SKILL.md` 放在**仓库根**，而 provider 的
     `customSkillDirs`、`test/selected-skills-content.test.mjs`、`test/packaging.test.mjs`、
     `test/persona.test.mjs` 与 `capital-config` 的原文旁路五处都按 `<repo>/<skillsDir>/<name>/SKILL.md`
     反查（AGENTS.md §9.7 那一族：漂了不报错，只是"勾了那一格、技能永远不出现"）。
     `references/` 跟着 `SKILL.md` 一起搬，正文里的相对链接不破；`SELECTED_SKILL_SKILL_DIRS`
     因此填 `'skills'`，与前两颗同形。上游 `README.md` 那张仓库结构图随之与实际路径不符——
     它是**不进 catalog 的材料**，按"不进 catalog 的正文一律不动"原样保留。
  2. **删除上游的 `.gitignore`。** 它带 `lib/` `build/` `dist/` `tmp/` `*.log` 一类目录规则，今天在这份
     快照里挡不到东西，但会把 ignore 规则继续带进宿主仓库，并让"按 commit 重导"的快照与所钉 commit
     不一致（InvestSkill 那一轮就是三个文件被静默挡掉）。vendored 快照不把 ignore 规则带进宿主仓库。
  3. **取数口径改写**（六份文件共 124 行改动，全部落在"谁去取数"与一处评分释义上；分析结论、
     预算数字、Source Ledger 字段、`Reported/Calculated/Inference` 标注、停止规则与章节结构一字未改）。
     上游正文写给"什么工具都在手边"的宿主，与本插件的取数边界冲突：
     - `SKILL.md` 开篇 `All data comes from **web search and fetched pages**` → 改为"数据来自宿主自己的
       取数通道；角色分流的宿主里把标的、字段、as-of 日期与来源档写进委派 brief 交出去"（1 处）。
     - `SKILL.md` Step 3 抬头 `Using the host agent's **web search** and **page fetch** tools:` →
       `Asking the host's own retrieval path …（delegate it with the brief, do not browse from here）`；
       配套把预算的计量对象改成"向通道要几次"（`2-3 searches` / `8-12 searches` → `retrieval requests`），
       **数字一字未动**（2 处）。
     - `references/{quick,deep}/web-research.md` 里 28 处独立 `search` 的**主语与动词**：
       `Every search must fill a Source Ledger slot` / `Before adding a search after the third Quick search` /
       `Do not run separate searches…` / `Use targeted external searches…` → 改成"向宿主取数通道要一份来源"；
       `Query Pack` 与 `Phase 2` 的 query 清单**原样保留**，只写明"每一条都是向通道要的目标，不是从这里去开的页面"。
       deep 的 `fetch/read the document` 明确成"把 URL 交给宿主检索通道，PDF 由检索角色解析，用回来的正文继续"
       （合计 14 处句子级改动）。
     - `references/deep/system-prompt.md` 的 `… use web search results for recent strategic and competitive
       context` → "use what the host's retrieval path returned…"。这是 `test/selected-skills-content.test.mjs`
       六条 FORBIDDEN 在本颗的**唯一实际命中**（1 处）。
     - `SKILL.md` 失效处理 `If web search is unavailable: state the limitation and stop — do not fabricate data`
       → "宿主对某个字段没有可用取数路径时：点名缺哪些字段、该字段下的分析停止"；后半句 `do not fabricate data`
       原样保留。同段 `use another reputable aggregator` → `ask the channel for another reputable aggregator`（2 处）。
     - `SKILL.md` 的 Required inputs 之后加一段**市场口径**说明：正文的 aggregator / SEC-EDGAR / Form 4-13F /
       wash-sale 都是美股与境外上市口径，A 股会话要换成 A 股披露口径，而换口径由宿主取数通道决定，
       不由这颗 skill 自行联网去补（§8.6 第 8 条；`us-stock` 标签就是给使用者的提示）。
     - `references/deep/methodology.md` §10 Final Score 加一句：X/10 衡量的是论点自洽度与结构特征，
       不预测价格或收益，也不是买卖指令（§8.6 第 7 条 / CONTRIBUTING.md §3 第 8 条）。
     **没有新增 `Retrieval:` 出处档**：上游既没有这个枚举，也不把记忆列成取数途径——
     第 2 条（记忆回填）在本颗**实测零命中**（`model memory` / `training-data` / `Live data unavailable` 全无），
     `system-prompt.md` 本来就把取回的东西限定成"来自研究简报"。不为了套 InvestSkill 的改法新造上游没有的模板字段。
  复核方法：`git clone` 所钉 commit 后 `diff -r`，差异只应包含以上三类；
  `test/selected-skills-content.test.mjs` 扫正文**结果**、本文件记**理由**，两边任一漂回去都会红。
- Packaging: 这颗**不带 `.npmignore`**——除 `README.md`（13 KB）之外全是运行时正文与溯源，包体积增量约 120 KB，
  没有需要挡的成图、静态站或脚本目录（`china-stock-research-skills` 同样没挡）。
  `package.json` 的 `files` 已逐仓库登记 `selected-skills/peter-lynch-skill`，
  `test/packaging.test.mjs` 从 catalog 反查发布清单里的真实 `SKILL.md` / `LICENSE` / `UPSTREAM.md`。
- Catalog 收录判断：`SKILL.md` 内部的 Quick / Deep 二选一**不算**"会接管会话路由的编排 skill"——
  它不跨 Agent、不改本插件的角色分流，只在本颗的两条工作流之间选择（`china-stock-research-orchestrator`
  与 InvestSkill 的 `full-report` 是另一类东西）。也不触发 §7（报告交付链路已删除）与 §6.1（出图只走
  `render_chart`）：这颗的输出是**最终答复里的 markdown 报告**，不落文件、不出图。
- Maintenance snapshot (checked 2026-10-11): 全仓两次提交，最后一次 2026-06-28，之后 105 天无提交；
  单人仓库、无 issue 响应记录。因此标 `watchlist`——与 `china-stock-research-skills` 同一口径
  （内容可用、维护薄，启用前请使用者自行复核来源），而不是内容缺陷。
  See [GitHub commit history](https://github.com/DjNero11/peter-lynch-skill/commits/main/)。
- Runtime status: `watchlist` / 默认关闭的显式实验。只有使用者在「插件」→ Capital Generation →「精选 Skills」
  里亲手打开，它才对**之后新建**的 Capital 根 Agent 可见；子 Agent 不继承，上游附属文件从不执行。
  能力标签（含本颗带来的新标签 `peter-lynch`）与 `riskNote` 维护在 `selected-skills/catalog.js`。
- Review status: 2026-11-06 复查上游、许可证与维护状态。正文是 Lynch 三部著作（*One Up on Wall Street*、
  *Beating the Street*、*Learn to Earn*）方法论的**二手转写**，与 Lynch 本人、Fidelity 或 Capital Generation
  均无关联，不构成背书；美股口径不得直接当作 A 股规则，所有金融主张须回到原始证据核验。
