# Upstream Record

- Project: Claude for Financial Services（中文版）—— 63 颗面向 A 股的金融工作流 skill，按六条业务线组织：
  证券研究（`china-finance`，31 颗）、投行（10）、私募（9）、基金运营（6）、财富管理（5）、账户与合规（2）。
  同一套正文还被上游打包成四个"角色 Agent"（`agent-plugins/*`）再抄了一遍，所以仓库里 `SKILL.md` 有 188 个路径、
  唯一 `name` 只有 58 个。
- Repository: https://github.com/jwangkun/claude-for-financial-services-cn
- Upstream commit: `d7585ca0033d0624e14e8c5a031b373c1216dd74`（main，2026-09-14，
  "fix(akshare-mcp): get_financials always returned [] due to wrong THS indicator and stale annual filter (#4)"）
  - 全仓 15 次提交（`jwangkun` 14、`fintech-python-java` 1）：2026-06-07 建仓，06-08 与 06-09 两天集中 10 次，
    之后沉寂三个月到本 commit。831 stars、3 个 open issue，无 release、无 tag。
- License: **Apache-2.0** —— 本仓六份快照里第一份非 MIT。`LICENSE` 为上游原件、未改写。署名有三处互不一致，
  按现状记录，不做取舍：
  - `LICENSE:189` 附录写 `Copyright [2025] [jwangkun]` —— Apache 自己的说明要求填好后**去掉方括号**，上游没去；
  - 六个 `vertical-plugins/*/.claude-plugin/plugin.json` 的 `author.name` 都是 `Anthropic FSI China`；
  - `README.md:5` 自称"基于 Anthropic 官方 [claude-for-financial-services](https://github.com/anthropics/claude-for-financial-services)
    深度适配国内市场"，其对照表（`README.md:439`）称两者同为 Apache 2.0。
  上游**没有 `NOTICE` 文件**，因此再分发只需保留 `LICENSE` 与本条记录。catalog 的 `owner` 用仓库 owner `jwangkun`。
- Imported content: 该 commit 的完整文件树，267 个文件 / 约 3.1 MB（`vertical-plugins/` 六条线 63 颗 +
  `agent-plugins/` 四个角色包的副本 + `managed-agent-cookbooks/` + `mcp-servers/` 四份 python 取数服务 +
  `scripts/` + 根级 README / CLAUDE.md / IFIND-INTEGRATION-PLAN.md）。

- Local modifications（四类，逐条可复核；口径与理由见 `docs/dev/selected-skills.md` §8.6 的接入必查清单）：

  1. **删除上游的 `.gitignore`。** 它排的是 `mcp-servers/*/mcp_config.json`、`*.key`、`secrets/`、`__pycache__/`、
     `*.xlsx` / `*.pptx` / `*.docx` 与 `.claude/settings.local.json`——这些规则会在本仓继续生效，
     把"按 commit 重导"的快照与所钉 commit 弄成两种样子。实测该 commit 的 267 个已提交文件与盘上文件数一一对上
     （被它挡的都在 `__pycache__/` 一类未提交路径里），所以删除不丢任何文件，但规则本身不能带进宿主仓库。
  2. **不改布局。** 前五颗里出现过三种布局问题（上游没写 `name`、SKILL.md 住在仓库根、分组深一层），本颗都不是：
     每颗 `SKILL.md` 的 frontmatter 都齐 `name` + `description`，`name` 与目录名一致。唯一的新形态是
     **上游有六个 skills 根**（`vertical-plugins/<条线>/skills/`），而 provider 与五处反查只认一个根映射。
     处理方式是**只登记规范根那一条线**：`SELECTED_SKILL_SKILL_DIRS` 填
     `'claude-for-financial-services-cn': 'vertical-plugins/china-finance/skills'`，另五条线与 `agent-plugins/`
     副本不进 provider 视野，`src/` 一行不动。这样也避开了上游内部的同名冲突——`fund-admin` 有五颗与
     `china-finance` 同名但内容更薄（`china-accrual-schedule` 5799 vs 6563 字节一类），
     两条根同时登记就会撞车（provider 的启用集合只按 `name` 认）。
     上游 `CLAUDE.md` 自己写明 "Skills are authored in `vertical-plugins/china-finance/skills/`" 且
     "Agent plugins bundle vendored copies of their skills. **Never edit bundled copies directly.**"——
     登记规范根与上游的作者口径一致，那些副本因此在 diff 里与上游逐字节相同。
  3. **取数面改写：12 份 `SKILL.md`，37 处段落级改动（+250 / −333 行）。** 分析结论、判定档位、阈值表、
     报告骨架与输出模板一字未改。可核对的两个总数：这十二颗里的 ```python 伪调用围栏 **18 处 → 0**；
     `IFIND_DATA_SOURCE_MODE` 开关块在这十二颗里 **全部删除**（规范根其余 19 颗与另五条款线照旧带着原文开关——
     不进可选清单的正文不改也不扫，§8.6 第一段那条口径；所以整颗快照里仍有 173 个文件出现这个变量名，
     `grep` 到它不代表改写漏了，运行时那些颗一律被 catalog 闭集挡在读取之外）。
     本颗的 hazard 与前五颗不同族：**63 颗正文每一颗都把取数层写死进正文**——`## Data Sources (Multi-Tier)`
     三档服务商（Tier-0 万得 Wind，带 `WIND_API_KEY`、`ak_` 前缀与密钥申请 URL；Tier-1 同花顺 iFind，
     带 `IFIND_AUTH_TOKEN`；Tier-2 AkShare），python 围栏里的伪工具调用（`get_financials(ticker, …)`、
     `ifind_get_stock_events(query)`、`ak.bond_zh_us_rate()`），尾部统一的 `IFIND_DATA_SOURCE_MODE`
     环境变量开关块，以及把服务商名写进引用格式的 `Source: AkShare, [date]` 与"所有数字都应来自 …"检查项。
     改动分六类：
     - **TIER（12 份）**：服务商阶梯 → "这一节要的是哪些字段、as-of 哪天"的委派 brief 清单；
       保留上游的字段词汇（三表、最新价 / PE / PB、板块成分股、指数基准、新闻与公告），
       删掉的是"谁家有数据、密钥去哪申请"。
     - **CALL（12 份、18 处围栏）**：```python 伪调用围栏与 workflow 步骤里的内联调用 → 散文式取数请求。
       本插件没有 shell（§1.6），这些工具名指向的是快照里那四个 MCP 服务端，运行时不存在。
     - **MODE（12 份）**：`IFIND_DATA_SOURCE_MODE` 开关尾块整段删除，换成一句"取数档位由宿主的凭据域决定，
       这份产出既不配置它，也不向使用者索取凭据"（§5：密钥只进 credentials 域）。
     - **CITE（5 份）**：引用格式与检查项里的服务商名 → 回到取数通道真正给出的东西（数据集引用、披露文件名与页码）。
       `巨潮资讯` / 交易所 / 监管机构作为**出处**保留（那是披露场所，也是宿主检索通道本就在用的来源），
       作为**取数指令**的部分删掉。
     - **GAP（4 份，§8.6 第 2 条，本颗最要紧的一类）**：`china-earnings-preview` 原句
       "**If consensus unavailable**, derive from: Historical growth rates / Management guidance /
       Industry benchmarks"、`china-earnings-analysis` 的 `[UNSOURCED] — estimate based on [rationale]`、
       `china-dcf` 的 "use … or web search for latest"、`china-earnings-analysis` 的
       "Consensus sources: Wind / Choice / 慧博 / iFinD" 阶梯 → 统一改成**点名缺哪个字段、该列留空并停下**。
       这里必须如实说明一件事：**本插件没有一致预期的结构化取数面**（同花顺能力清单里没有盈利预测／一致预期条目，
       唯一带预测形状字段的是东财研报条目上的本年 / 次年 EPS 预测）。所以改写后的正文把这四档写成
       "卖方单家口径 ≠ 市场共识"，情景与差异要么写在去年、自家先前口径或公司披露区间上并**标明是哪种基线**，
       要么写成缺口——"用记忆里的增速估一个预期"没有任何工具会拦，只能改在正文里。
     - **ROUTE（2 处）**：`china-catalyst-calendar` 的 `## Integration with Other Skills` 表原句保留，
       加第五颗同一句前置条件（点名的 skill 只有使用者显式开启才存在于会话里，本插件明确不提供的那一类——
       替使用者下单与改单——永远不存在）。本轮判据纠正后这一句在两颗快照的八份正文里一起从"那两类（下单、给仓位）"
       改成执行面口径，因为仓位测算那颗已经收录。
       `china-idea-generation` 的跟踪清单里有一句直接把下一步指向 `china-catalyst-calendar`——那颗可能没被开启，
       所以这一句改成活动名（事件日期与是否落地，逐条复查），不改方法论里"要跟踪催化剂"这条。
     另有两处按同一族处理：**DESC（1 处）**`china-dcf` 的 frontmatter `description` 自己写着
     "Uses AkShare MCP for financial statements"，那半句换成口径描述，方法论部分不动；
     **CHART（1 处）**`china-initiating-coverage` 的 `**Chart standards:**` 块原文要求
     "Dark theme or light theme (consistent with firm template)" 与 `Source: AkShare historical data` →
     改成"这四张图说的是首次覆盖该有什么图表，图由宿主的出图通道渲染（出图只走 `render_chart`，§6.1），
     主题与标签排版是出图角色的决定"，图表清单本身（收入与利润历史、倍数区间带、增长 vs 倍数散点、两年价格线）未改。
     **就地标注（6 份）**：`china-comps-analysis`、`china-sector-overview`、`china-initiating-coverage`、
     `china-morning-note`、`china-thesis-tracker`、`china-idea-generation`
     的模板以目标价 / 投资建议 / 多空方向 / 加减仓决策收尾，且改动正好落在那份文件的尾块上，因此除了 `riskNote` 之外，
     尾块里另写了一句"属于推演练习，本插件没有券商接口，不据它下单，也不会替你执行任何一笔"。`china-earnings-analysis` 与
     `china-variance-commentary` 的评级只出现在报告骨架的某一节里（没有落到被改写的尾块），正文不动，
     完全由 catalog 的 `riskNote` 承担——两份都改或都不改都不是诚实的做法，这里是按"改写是否正好落在同一处"划线，
     线画在这里是为了让下一个人看得见。**评级五档表、`Long / Short` 一览与 `投资建议: [Buy / Hold / Sell]`
     这些上游判定档位与模板全部原样保留**（§8.6：不为口味改结论）。
     前三份原本那句写的是"不据它下单，也不给仓位"，本轮放开晨会纪要 / 逻辑跟踪 / 选股三颗（它们确实给止损位与仓位写法）
     之后那句成了假话，于是连同 catalog 里对应的四条 `riskNote` 一起改成执行面口径——这是判据纠正的连锁，不是新增改写。
  4. **Apache-2.0 §4(b) 的改动声明：上面那 12 份文件各加一行。** 前五份快照是 MIT，再分发不要求在**被改的文件上**
     留痕，改动口径只住在本文件里；Apache-2.0 第 4(b) 条要求"修改过的文件带上显著的声明"，所以这十二份在一级标题
     下面各有一句可见中文声明（点名所钉 commit `d7585ca`、改的是取数与凭据口径、逐条见本文件、方法论未改）。
     其余 51 颗与上游逐字节相同，因此不带这一行。它是许可要求而不是编辑：不改语义、不改结论，
     `test/selected-skills-content.test.mjs` 有一条正向断言钉住"这十二份必须各带一行"，漏一颗就点名那一颗。

- 收录判断（规范根 31 颗里 12 颗进 catalog，19 颗留在快照里当可审查材料；另五条款线 32 颗整条不进）：
  - **进（12）**：`china-earnings-analysis`、`china-earnings-preview`、`china-comps-analysis`、`china-dcf`、
    `china-sector-overview`、`china-catalyst-calendar`、`china-break-trace`、`china-variance-commentary`、
    `china-initiating-coverage` 这九颗补的是当时既有 45 条里没有的形状：A 股卖方体例的业绩点评与超预期分解、
    财报前情景框架、A 股口径的可比倍数与 DCF 参数（10Y 国债、A 股 ERP、25%/15% 税率）、
    A 股披露节奏的催化剂日历、按报表科目与监管文书走的财务核查、差异表述的句子级写法、首次覆盖的报告骨架；
    `china-morning-note`、`china-thesis-tracker`、`china-idea-generation` 这三颗是本轮按纠正后的判据收进来的，
    补的是开盘前那份晨会策略、逐只持仓的逻辑加减与按筛选条件系统性找标的。
    市场口径是 **A 股**（`tags` 全部带 `a-share`），与美股那 30 多颗互为对照，不通用。
  - **不进 · 它本身就是取数目录**：`china-market-data`。整颗是四个服务商 MCP 的工具清单
     （`mcp__ifind__*` / `mcp__akshare__*` 之类工具名表 + 28 个"要什么数据用哪个工具"的配方 +
     `export IFIND_DATA_SOURCE_MODE=…`），自己不产出任何分析。收录它等于在本插件既有的取数协议之外
     再造一条取数路由（§8.6 第 1 条与第 6 条同时撞上），因此整颗留原文不改、也不进清单。
  - **不进 · 元技能 + 执行面**：`china-skill-creator`。它教 Agent 按上游模板新写 `china-*` skill，
     模板里硬编码那份三档服务商的 `## Data Sources` 块，并要求跑 `python3 scripts/check-china.py` 与
     `sync-china-skills.py` 来校验和同步。本插件没有 shell（§1.6），也不需要第二条 skill 生产线。
  - **不进 · 上游自标的 alias**：`china-dcf-model`。`description` 自己写 "This alias skill redirects to
     `china-dcf`"，与 InvestSkill 那轮的 `fundamental-analysis` / `dcf-valuation` 同一条理由（§8.6 第 6 条）。
  - **不进 · 同题材的薄一份且结构坏**：`china-comps`（105 行 vs `china-comps-analysis` 207 行）。
     它带着**两份 frontmatter**（`L1-4` 与 `L37-40` 各一份 `name` / `description`），
     正文是同一题材的早版；收哪一颗都让"目录名 ↔ frontmatter name ↔ catalog name"的三处一致变复杂。
  - **本轮收回来的三颗（判据纠正，2026-10-12）**：`china-morning-note`、`china-thesis-tracker`、
    `china-idea-generation`。这三颗当初按"给买卖方向与仓位数字"整颗不收（第五颗的 `position-sizing` /
    `position-management` 是同一条误读挡的），而 §8.6 第 7 条被读成了内容禁令。本插件不收的从来是**执行面**
    （第 4 条：没有券商下单接口，`mcp-servers/` 连发布包都不进）；正文给出方向、止损位或仓位写法属于方法推演，
    收录后由 catalog 的 `riskNote` 与正文尾块那一句承担口径。改写只消掉取数层（服务商阶梯、```python 伪调用、
    `IFIND_DATA_SOURCE_MODE` 开关），晨会模板的【今日策略】、逻辑跟踪的决策档与选股清单的 Conviction 档原样保留。
  - **不进 · 市场口径（§8.6 第 8 条，不是第 7 条）**：`china-tax-loss-harvesting`。税损收割建立在 wash-sale
    规则与应税账户的成本基础上，A 股没有这套制度，所以它整颗不适用；`Full exit: Sell and replace` 那几行只是
    同一件事的表现形状——真正的障碍是口径不成立，不是它写了买卖。
  - **不进 · 要求产出或读取本地文件（§8.6 第 4、5 条）**：`china-xlsx-author`、`china-pptx-author`
    （后者的 `Usage` 直接是 `python3 scripts/generate_a_share_ppt.py`）、`china-ppt-template-creator`、
    `china-deck-refresh`、`china-audit-xls`、`china-ib-check-deck`、`china-clean-data-xls`、
    `china-3-statement-model`（带 `## Excel Formatting (OpenPyXL / Office JS)` 与
    `File named: …_3StatementModel_….xlsx` 的产出清单）、`china-lbo-model`（同一族的 Excel 结构）、
    `china-model-update`、`china-roll-forward`。这十一颗的对象是一份工作簿或一份 deck：本插件的产出写在
    最终答复里（§7 报告链路已删除），图表只走 `render_chart`（§6.1），没有 shell 能生成文件（§1.6）。
  - **不进 · 不是本插件使用者的场景**：`china-gl-recon`、`china-accrual-schedule`（总账对账与计提计划，
    会计作业口径）、`china-deal-screening`（一级市场标的筛选）。它们没有明显违规，留原文不改、不进清单。
  - **整条线不进（另五条，共 32 颗）**：`investment-banking`（10：teaser / CIM / buyer list / datapack /
    merger model / pitch deck …，交付物是并购文件）、`private-equity`（9：尽调清单、IC 备忘录、
    回报与单元经济、投后监控）、`fund-admin`（6：净值对账、GL 对账、roll-forward）、
    `wealth-management`（5：客户报告、理财规划、投顾建议书、组合再平衡——直接给配置动作与建议）、
    `operations`（2：KYC 材料解析与规则）。理由合起来是三条：它们与规范根不在同一个 skills 根里、
    交付物多是机构流程文件，以及财富管理那条线给的是配置建议。
  - **`agent-plugins/*` 与 `mcp-servers/*` 更不是可选面**：前者是上游自己 vendored 的角色包副本
    （上游规定不许直接编辑），后者是四份可运行的取数服务端（`server.py` + `requirements.txt` +
    密钥配置形态）。本插件从不执行快照里的脚本（§8.6 第 4 条的口径：管的是正文，不是文件在不在盘上）。
  - `test/selected-skills-provider.test.mjs` 用「skills 根目录 − 排除清单」派生本颗的可选清单，
    `test/persona.test.mjs` 另把 `china-market-data` / `china-skill-creator` / `china-dcf-model` 明确断为
    不进 catalog（执行面与生产线那一类）。
- 复核方法：`git clone` 所钉 commit 后，只对**规范根**逐颗 `diff -r`：
  `diff -r /tmp/upstream/vertical-plugins/china-finance/skills <快照>/vertical-plugins/china-finance/skills`
  —— 差异只应是上面那 12 份 `SKILL.md`（37 段），其余 19 颗与另五条款线、`agent-plugins/`、`mcp-servers/`、
  `LICENSE` 逐字节相同。注意 `agent-plugins/<角色>/skills/` 里有**同名副本**，对整个仓库跑 `diff -r`
  会把它们一起列出来（本颗没动它们，列出来也不代表漂移）；`fund-admin` 那五颗同名 skill 内容更薄，
  比对时按路径而不是按名字认。
- Packaging: 这颗带 `.npmignore`，挡的是非运行内容：`agent-plugins/`（角色包里的 skill 副本）、
  `managed-agent-cookbooks/` 与 `.codebuddy/`（它给别的宿主编排用的 agent 定义与团队材料）、
  `scripts/`（上游的生成、校验与同步 python / shell）、`.claude-plugin/` 与 `.mcp.json`
  （每条款线的 plugin manifest 与 MCP 接线）、根级 `README.md` / `CLAUDE.md` / `IFIND-INTEGRATION-PLAN.md`。
  另有一条合规口径，不只是体积：**`mcp-servers/` 连发布包都不进**——四份能连付费数据接口的 python 服务端
  与本仓排除券商执行面（`trading-skills` 的 `etoro`）是同一条线，凭据只进 credentials 域（§5）。
  不进可选清单的正文（规范根的 19 颗、另五条款线的 32 颗）**随包保留**作为可审查材料，
  照 InvestSkill 与 trading-skills 先例：provider 的 `list()` / `get()` 与 `/capital-skills/<name>.md`
  旁路都按 catalog 闭集过滤，运行时读不到它们。
  规则**只写裸名**：`test/packaging.test.mjs` 丢掉以 `/` 开头的规则、也不检查带内部斜杠的规则，
  而目录规则按**任意路径段**匹配——所以这里绝不能出现 `skills/`（一条就会把六十三份正文全挡掉，
  而 catalog 反查只会说"包里找不到 SKILL.md"）。
  `package.json` 的 `files` 已登记 `selected-skills/claude-for-financial-services-cn`；随包的是 63 份
  `SKILL.md`（规范根 31 + 另五条线 32）+ `LICENSE` + 本文件，净增 65 个文件，整包未压缩 3.49 → 3.98 MiB。
- Maintenance snapshot (checked 2026-10-11): 15 次提交里 10 次落在 2026-06-08 与 06-09 两天，
  此后三个月无动作，直到 2026-09-14 那一次修 AkShare 服务端返回空数组的 bug（也就是本 commit）。
  831 stars、3 open issue，无 release / tag。因此标 `watchlist`：内容成体系、维护靠一次性的集中搬运，
  与 `china-stock-research-skills`、`trading-skills` 同一口径，不是内容缺陷。
  See [GitHub commit history](https://github.com/jwangkun/claude-for-financial-services-cn/commits/main/)。
- Runtime status: `watchlist` / 默认关闭的显式实验。只有使用者在「插件」→ Capital Generation →「精选 Skills」
  里逐格打开，它们才对**之后新建**的 Capital 根 Agent 可见；子 Agent 不继承，上游的 MCP 服务端与脚本从不执行。
  能力标签全部复用既有词表（`a-share` 加各颗自己的 `earnings` / `valuation` / `risk` / `monitoring` /
  `macro` / `competition` / `verification` / `business-analysis` / `filings` / `financial-health` / `cash-flow` /
  `technicals` / `portfolio`），本颗**没有新增标签**；`riskNote` 逐条写明两件事：评级、目标价、多空方向与
  止损位／仓位写法属于推演练习，以及本插件取不到一致预期那一类字段。
- Review status: 2026-11-08 复查上游、许可证与维护状态。这十二颗按中国大陆卖方与机构研究惯例写
  （中金 / 中信 / 华泰体例、申万与中信行业分类、CAS 科目、涨跌停与北向资金口径、A 股披露节奏），
  与美股那三十多颗互为对照而**不通用**；本插件不提供的是执行面——没有券商接口，不据这些结论下单，也不代使用者动仓。
  五档评级、目标价与仓位写法作为卖方流程的一部分原样收录，逐条标注为推演练习：收录它们只为让使用者看见
  卖方流程长什么样，**不构成投资建议**，也不得反向当作监管或会计规则。
  本文件与本仓的收录判断不构成对上游观点、也不构成对 `anthropics/claude-for-financial-services` 观点的背书。
