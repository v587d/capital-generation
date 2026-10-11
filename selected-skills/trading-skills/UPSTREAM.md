# Upstream Record

- Project: Trading Skills —— 19 颗讲交易过程纪律的 skill：下单前的检查（催化剂排布、自选清单分诊、证据缺口、
  论点压力测试、盈亏比结构、执行计划可操作性、组合集中度）与下单后的复盘学习（交易日志模式、单笔复盘），
  外加 4 颗把它们串起来的 workflow、一颗仓位计算与一颗券商 API 执行面。
- Repository: https://github.com/marian2js/trading-skills
- Upstream commit: `f1ae7d481154b49192681187cb08d39d7e2d4524`（main，2026-03-16，"Run skill-doctor and improve skill triggers"）
  - 全仓 31 次提交，全部落在 2026-03-06 至 2026-03-16 这十天里。上游版本文件 `VERSION` = `0.1.0-rc.1`，无 release、无 tag。
- License: MIT；`LICENSE` 为上游原件、未改写。**注意其 `Copyright (c) 2026` 一行没有署名**（上游就是这么写的），
  署名按仓库 owner 与 commit author 记为 `marian2js`；catalog 的 `owner` 用同一个值拼仓库链接。
- Imported content: 该 commit 的完整文件树（`skills/` 下 19 颗 skill + 共享 python 模块 + 仓库级材料），55 个文件 / 约 460 KB。
  上游带 `.gitignore`（`__pycache__/`、`.env`、`.venv/` 等）——见下面的本地改动 2。

- Local modifications（三类，逐条可复核；口径与理由见 `docs/dev/selected-skills.md` §8.6 的接入必查清单）：

  1. **平铺掉 `<domain>/` 一层。** 上游把 skill 按主题分成两层：`skills/<domain>/<name>/SKILL.md`
     （`idea-discovery`、`market-context`、`position-oversight`、`review-learning`、`thesis-validation`、
     `trade-construction`、`live-trade`、`workflows`）。DSH filesystem provider 只枚举 skills 根的**直接子项**，
     指 `skills` 等于发现 0 颗；而 provider 与 `test/selected-skills-content.test.mjs`、`test/packaging.test.mjs`、
     `test/persona.test.mjs`、`capital-config` 原文旁路五处都按 `<repo>/<skillsDir>/<name>/SKILL.md` 反查
     （AGENTS.md §9.7 那一族：漂了不报错，只是"勾了那一格、技能永远不出现"）。所以快照里是
     `skills/<name>/…`，`SELECTED_SKILL_SKILL_DIRS` 填 `'skills'`。
     每颗 skill 的 markdown 链接**只指向自己目录内**的 `references/…` 与 `assets/…`（逐颗核过，无 `../`、无跨目录链接），
     平铺后一条不破。原分组记在这里供核对：
     `idea-discovery` → catalyst-map、watchlist-review；`market-context` → earnings-preview、macro-event-analysis、
     market-regime-analysis；`position-oversight` → position-management；`review-learning` → journal-pattern-analyzer、
     post-trade-review；`thesis-validation` → evidence-gap-check、thesis-validation；`trade-construction` →
     execution-plan-check、portfolio-concentration、position-sizing、risk-reward-sanity-check；`live-trade` → etoro；
     `workflows` → earnings-trade-prep、portfolio-risk-review、post-trade-debrief、pre-trade-check。
     随之变旧的是上游 `catalog.json` 里的 `path` / `docs_path` 字段与 `docs/examples/` 的路径口径——
     两者都不进 catalog、也不进发布包（见 Packaging），按"不进 catalog 的正文一律不动"原样保留。
  2. **删除上游的 `.gitignore`。** 被排除的 ignore 规则会在本仓继续生效，并把"按 commit 重导"的快照
     与所钉 commit 弄成两种样子（InvestSkill 那一轮就是三个文件被静默挡掉）。vendored 快照不把 ignore 规则带进宿主仓库。
  3. **取数与执行面口径改写**：8 份 `SKILL.md` + 2 份 `references/calculation-helpers.md`，
     共 17 处句子级改动（+34 / −13 行）。分析结论、判定档位词汇（`must-watch` / `fragile` / `too concentrated` 一类）、
     输入清单、输出顺序与 `references/` 的框架、阈值文档一字未改。
     本颗**没有** `web search` 与记忆回填那一族（`web search` 零命中；每颗都写"缺什么就点名缺、别编"，
     `example-mode` 指使用者自带的示例数据并要求标注，不是逃生口），换的是另外三种形态：
     - **谁去取数（6 处）**：`catalyst-map`、`watchlist-review`、`evidence-gap-check`、`thesis-validation`、
       `execution-plan-check`、`portfolio-concentration` 各有一句 `Do not fetch live data unless the user
       explicitly asks to pair this skill with …`。前半句的意图（别自己去堆一堆数据）保留，
       后半句改成"确实缺一个日期或一个字段时，把标的、字段、as-of 日期写成 brief 交给宿主取数通道——
       角色分流的宿主里就是负责检索与行情的角色——用回来的东西继续，剩下的照旧标为未知"。
       顺带这三句原本点名的 `earnings-preview` / `macro-event-analysis` 不在可选清单里（见下面的收录判断）。
     - **没有 shell 就算不了（2 + 2 处）**：`journal-pattern-analyzer:49` 与 `risk-reward-sanity-check:52` 的
       `For agents that support code execution, use [references/calculation-helpers.md] …` 改成
       "本插件的分析角色没有 shell，也不跑 helper 脚本：统计量交给宿主数据侧（角色分流的宿主里委派做统计与质量校验的角色），
       三笔以内可以在答复里手算并把算式写出来，缺输入的条目留空不补默认值"；
       两颗各自的 `references/calculation-helpers.md` 随之从"复用 `skills/_lib/calculations.py` 里的函数"
       改写成"这些量是什么、怎么取"（公式按上游 `_lib/calculations.py` 的实现核对：
       `risk_reward_ratio` = |target−entry| / |entry−stop| 每单位、`expectancy` = 胜率×均盈 − 败率×均亏，
       `kelly_fraction` 只是参照值，不作为交给使用者的仓位）。
     - **点名的下一步 skill 未必存在（7 处）**：`catalyst-map`、`watchlist-review`、`evidence-gap-check`、
       `thesis-validation`、`journal-pattern-analyzer`、`execution-plan-check`、`portfolio-concentration` 的
       `Next Skill` 清单原句保留，各加同一句前置条件与退路（InvestSkill 那轮的改法）：
       点名的 skill 只有使用者显式开启才存在于会话里，本插件明确不提供的那两类（下单、给仓位）永远不存在，
       只能说成选项、不能替使用者跑。
     **没有新增 `Retrieval:` 出处档**：上游根本没有这个枚举（§8.6 第 3 条不适用），
     不为了套前几颗的改法新造上游没有的模板字段。

- 收录判断（19 颗里 9 颗进 catalog，10 颗留在快照里当可审查材料）：
  - **进**：`catalyst-map`、`watchlist-review`、`evidence-gap-check`、`thesis-validation`、
    `risk-reward-sanity-check`、`execution-plan-check`、`portfolio-concentration`、
    `journal-pattern-analyzer`、`post-trade-review`。
    `post-trade-review` 一字未动就过闸门（全文无取数、无脚本、无出图，只在 `references/review-rubric.md`
    里举了一条"高冲击数据日把仓位减 25%"的过程规则例子 → `riskNote` 写明属于过程推演）。
  - **不进 · 执行面**：`etoro`。它是券商公开 API 的操作手册：`SKILL.md:18` "**Keys (request from the user on install)**"
    与逐步生成密钥的说明、`x-api-key` / `x-user-key` 请求头、`curl -X POST …/trading/execution/…market-open-orders/by-amount`
    带 `"IsBuy": true, "Leverage": 1`、"Use **non-demo execution endpoints** for real trading"、按 `positionId` 平仓，
    末尾还指到一个 MCP server。§8.6 第 4 条（执行面）与第 7 条（真实下单）双重排除；本插件不接券商、不下单、
    凭据只进 credentials 域（§5）。这颗连发布包都不进（`.npmignore`），全量仍住在 git 里。
  - **不进 · 仓位与买卖动作**：`position-sizing`（索取 account equity，输出 `Position Recommendation`：
    股数／合约数／账户风险百分比）、`position-management`（`hold, trim, tighten risk, close, or wait` + `Best Next Action`）。
    与 `docs/reference/external-skill-scan-2026-10.md` 观察名单里既写的同一口径：
    「评级、买卖动作和仓位决策属于明确冲突，不能直接集成」。
  - **不进 · 接管会话路由**：`pre-trade-check`、`earnings-trade-prep`、`portfolio-risk-review`、`post-trade-debrief`
    四颗 workflow。上游自己的 "Workflow routing" 段按结果分流到 11–12 颗子 skill 并给出
    `ready` / `reject` / `hold through with conditions` 一类决断，与本插件的角色路由冲突
    （`china-stock-research-orchestrator` 与 InvestSkill 的 `full-report` 是同一条理由）。
  - **不进 · 数据层与本插件不兼容**：`earnings-preview`、`macro-event-analysis`、`market-regime-analysis`。
    上游校验器把这套取数口径写成硬要求（`scripts/validate_repo.py:146` 要求这三颗必须写
    `ask which supported provider`）：向用户点选 FMP／Polygon／TradingEconomics、在对话里认领"usable access details"、
    然后 `curl "…apikey=<FMP_API_KEY>"`（三颗共 18 处 curl + 3 份 `data-providers.md`）。本插件没有这些服务商的凭据，
    也不为它们开第二条取数口子；改写成"委派宿主通道"会让这 10 份 provider 文档变成死路，因此整颗留原文不改。
    另外 `earnings-preview` 与 catalog 里已收录的 InvestSkill 同名那颗**撞车**——provider 的启用集合只按 `name` 认，
    `test/persona.test.mjs` 钉住 name 全局唯一，收进来必然出问题。
  - `test/selected-skills-provider.test.mjs` 用「skills 根目录 − 排除清单」派生本颗的可选清单，
    `test/persona.test.mjs` 另把 `etoro` / `position-sizing` / `position-management` / `pre-trade-check` 明确断为不进 catalog。
- 复核方法：`git clone` 所钉 commit 后，把上游 `skills/<domain>/<name>` 与快照 `skills/<name>` 逐颗 `diff -r`——
  差异只应包含以上三类（10 份文件、17 处句子级改动；其余 11 颗与 `_lib/`、`LICENSE` 逐字节相同）。
  `test/selected-skills-content.test.mjs` 扫正文**结果**、本文件记**理由**，两边任一漂回去都会红。
- Packaging: 这颗带 `.npmignore`，挡的是非运行内容：`docs/`（上游文档站与 18 份 walkthrough）、
  `scripts/`（上游的 catalog 生成与仓库校验 python）、`.github/`、`catalog.json`（上游自己的索引，与本仓
  `selected-skills/catalog.js` 无关）、`README.md` / `CONTRIBUTING.md` / `CHANGELOG.md` / `VERSION` / `Makefile`、
  `skills/_lib/`（共享 python 计算模块，本插件没有 shell 可跑它），以及合规口径那条 `skills/etoro/`（券商执行面，见上）。
  其余不进可选清单的 skill 照 InvestSkill 先例**随包保留**作为可审查材料：provider 的 `list()` / `get()`
  与 `/capital-skills/<name>.md` 旁路都按 catalog 闭集过滤，运行时读不到它们。
  `package.json` 的 `files` 已逐仓库登记 `selected-skills/trading-skills`，
  `test/packaging.test.mjs` 从 catalog 反查发布清单里的真实 `SKILL.md` / `LICENSE` / `UPSTREAM.md`，并反查上面每条目录规则确实生效。
- Maintenance snapshot (checked 2026-10-11): 31 次提交集中在 2026-03-06 至 2026-03-16，此后 209 天无提交；
  16 stars、6 forks，`0.1.0-rc.1` 未发 release。因此标 `watchlist`——与 `china-stock-research-skills`、
  `peter-lynch-skill` 同一口径（内容可用、维护薄，启用前请使用者自行复核来源），不是内容缺陷。
  See [GitHub commit history](https://github.com/marian2js/trading-skills/commits/main/)。
- Runtime status: `watchlist` / 默认关闭的显式实验。只有使用者在「插件」→ Capital Generation →「精选 Skills」
  里逐格打开，它们才对**之后新建**的 Capital 根 Agent 可见；子 Agent 不继承，上游脚本从不执行。
  能力标签带来的新词是 `trade-discipline`（交易纪律 / Trade discipline），市场口径继续用 `us-stock`；
  `riskNote` 里逐条写明各颗不做什么（不下单、不改单、不给仓位数字、不预测表现）。
- Review status: 2026-11-06 复查上游、许可证与维护状态。内容按美股与境外交易习惯写（SPY／QQQ／ES 期货、
  美股时段与盘前盘后、FINRA／Fidelity／Schwab 口径的集中度阈值、EURUSD 与 CFD／杠杆工具），
  **不声称适用 A 股**，也不得直接当作 A 股规则；它提供的是过程纪律而不是信号或收益承诺，
  所有金融主张须回到原始证据核验。本文件与本仓的收录判断不构成对上游观点的背书。
