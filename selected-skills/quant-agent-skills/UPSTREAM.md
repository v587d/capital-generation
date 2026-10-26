# Upstream Record

- Project: Quant Agent Skills（三颗**自述为编排器**的量化研究 skill：`concept-research` 概念/题材、
  `industry-research` 行业、`stock-research` 个股；A 股 / 港股 / 美股三市场分册 + A/H 与 ADR/HK 两条 overlay）
- Repository: https://github.com/Howard-Jerry/quant-agent-skills
- Upstream commit: `03677d216320f7f80ebf1f4d6d3106d41f72d333`（main，2026-08-05 20:27 +0800，作者 Jerry Wang）
  - **全仓五次提交，全部落在 2026-08-05 同一天**（`f65c549` v1.0.0 → `03677d2` examples）。无 release、无 tag、无 CI。
  - 上游 README 与 `docs/adaptation-guide.md` 自己写明：正文来自作者的**本地私有 SSoT**，经
    `scripts/publish.sh` 同步发布，数据层（`collect-data`、候选队列）要到 **v1.1 才开源**；
    贡献约定还规定"不要直接改 skill 正文再提交 PR"。frontmatter 里 `stock-research` 自报
    `version: 2.46.0` —— 那个版本号是私有系统的历史，不代表公开版的成熟度。
- License: MIT；`LICENSE` 为上游原件（`Copyright (c) 2026 Jerry Wang`），未改写。
  **MIT 没有 Apache-2.0 第 4(b) 条那份"被改文件要带显著声明"的义务**，所以本颗不新增声明行
  （与 `claude-for-financial-services-cn` 那一颗的区别正在这里，不是遗漏）。
  上游 README 另带一句免责：仅供研究与教育用途、不构成投资建议、仓库不含任何实盘持仓数据。
- Imported content: 所钉 commit 的完整文件树（三颗 skill 目录、`docs/`、`examples/`、`scripts/`、
  `template/`、`README.md`、`CHANGELOG.md`、`LICENSE`），约 233 KB，**随 git 保留供复核**。
  **随包发布的只有**：`LICENSE`、本文件，以及 `skills/cross-market-listing-choice/`
  （一颗我们自持的入口 + 两份逐字复制的上游口径文件）。排除口径与理由写在快照自己的 `.npmignore`。

## Local modifications（四类，逐条可复核；判据见 `docs/dev/selected-skills.md` §8.6）

1. **新建一颗本仓自持的入口 skill** `skills/cross-market-listing-choice/SKILL.md`。
   这不是上游正文的改写，而是本仓第一次在外部快照里放一颗自己写的正文——原因是一条结构事实：
   provider 只把 `<skills 根>/<name>/SKILL.md` 认作可发现单位，而上游那三颗都不能进 catalog
   （判断见下节），它们携带的两份**跨市场选线口径**因此没有可挂载的运行时入口。
   入口正文全部由本仓撰写，口径来源只有那两份 overlay 文件与宿主既有纪律（委派取数、
   不用记忆回填、不承诺收益、不代下单），没有从上游编排器里搬任何一句指令。
2. **套了一层 `skills/`。** 上游把三颗 skill 直接放在**仓库根**，provider 的 `customSkillDirs`
   与五处反查都按 `<repo>/<skillsDir>/<name>/SKILL.md` 走（peter-lynch 是同一类先例）。
   `SELECTED_SKILL_SKILL_DIRS` 因此填 `'skills'`。
3. **两份 `references/` 是逐字复制，不是移动**：`ah-overlay.md`、`adr-hk-overlay.md` 的原件仍住在
   `stock-research/references/overlays/`（随 git 保留、不进发布包）。副本与上游**逐字节相同**，核对方式：
   ```text
   cmp skills/cross-market-listing-choice/references/ah-overlay.md \
       <上游 commit>/stock-research/references/overlays/ah-overlay.md
   ```
   挑这两份（而不是 `markets/a-share.md` 那族）的唯一判据是**零执行面**：实测两份 overlay 正文
   只含 ```text 围栏、零跨文件相对链接、零 `{{QUANT_ROOT}}` / `scripts/` / `*.py` / `collect-data`
   一类私有栈引用，闸门 26 条模式零命中。`markets/a-share.md` 那份虽然 0 模式命中，但里面有
   `PYTHONPATH={{QUANT_ROOT}} python data_platform/research_report_collector.py …` 这样的命令块，
   指向公开版根本不附带的脚本——按第 4 条它要么整段删掉（就成了改上游正文），要么原样发出去
   （就成了教 Agent 跑一条不存在的命令）。两条都不做，所以它不进包。
4. **删除上游的 `.gitignore`**（只带 `.DS_Store` 与 `.env` 两条）。它会在本仓继续生效，
   而 git 在被排除的父目录之下无法再 include（§8.6 那条实测教训）。

**上游三颗正文一字未改**：不进 catalog 的正文不动也不扫（§8.6 开头那句），它们随 git 完整保留。

## 收录判断：三颗编排器为什么一颗都不进 catalog

按第 1、4、5、6 条逐条实测，不是印象：

- **第 6 条（接管会话路由）**：三颗的 `description` 自报"编排器 / orchestrator"，正文是 Conductor
  按步骤加载 `steps/*.skill.md`、并行派生 5–6 个 agent 再做 Debate 裁决——与本插件的角色路由正面冲突
  （`china-stock-research-orchestrator`、InvestSkill 的 `full-report`、trading-skills 的四颗是同一类）。
- **第 4 条（执行面）**：三颗都声明 `allowed-tools: Bash, Read, Write, Edit, EnterWorktree, ExitWorktree`
  （后两个是 Claude Code 专属，DSH 运行时没有）。更硬的一条是**它们指挥的东西不在仓里**：
  三颗 `SKILL.md` 点名的本地路径实测 **10 / 32 / 16 个，公开版一个都不存在**（`trade_history.json`、
  `portfolio_state.json`、`research_verdicts.json`、`scripts/generate_bridge.py`、
  `auto_research/quality_gate_check.py`、`sleeve/concept_heat.py`、`scripts/concept_radar.py` 等）。
  把这种正文发给使用者，得到的是"教 Agent 去撞一堵墙"。
- **第 1 条（第二条取数通道）**：`stock-research/steps/02-data-collection.skill.md` 写着
  "**所有 DB 和 API 数据采集必须通过 `collect-data` skill 完成，禁止绕过 collect-data 直接调 API**"，
  下面整张表是 Tushare / AkShare / yfinance / FRED / 东财 ReportAPI → 本地 SQLite + FTS5。
  本插件的取数入口只有委派一个（§1.1），且原始 rows 永不出工具层。
- **第 5 条 + `AGENTS.md` §7**：`04-output-delivery` 与 `references/output-contract.md` 要求产出
  **五文件包**（`README.md` / `深度研究.md` / `财务数据.md` / `研报索引.md` / `跟踪框架.md`）
  加一堆机器可读文件与 "Vault SHA 同步"。报告交付链路 2026-09-17 已整条删除、禁止以任何形式恢复。
- **闸门实测**：全仓 51 份 `.md` 命中 **132 处**，分布极不均匀——三颗 `SKILL.md` 只有 **1 处**、
  `steps/*` **109 处**、`agents/*` 9 处、我们真正取用的那族纯方法论 **1 处**（就是 `us-equity.md`
  里的 AkShare 一词，而它不进包）、`detailed-workflows.md` 10 处。命中族是
  71 个 ```python 围栏、40 个 `get_*(` 伪工具调用、17 个 AkShare、1 个 `ak.stock_news_em(`、1 个慧博。
  **注意"1 处"不等于干净**：`python auto_research/quality_gate_check.py <research_dir>` 这类指令
  现有 26 条模式一条都不认（第 10 条只认 `node|bash scripts/`）——这是"违规形状搬家"的又一次重演。
- **还有一个架构级不兼容，值得单独记**：它整套结论都建立在**持有者的成交账本**上
  （`Ledger reality`、`BLOCKED_LEDGER_MISSING_TRADE`、`current_new_money_pct`）。本插件从不持有
  使用者的账本，只有自选股（观察清单），所以凡依赖账本的规则都落不了地。
  `cross-market-listing-choice` 的正文因此明写"没有使用者的成交账本"这一条限制。

## 已知未收、留给后续轮次的东西

这几条按 catalog 现算的 67 颗 / 133 份 `.md` 实测是**空白**，且质地都好，但它们全部住在
不能进 catalog 的编排器正文里，要接必须另起一轮重写：

- **预期差闸门**：`delta_class=BEAT|IN_LINE|MISS|AMBIGUOUS` + "**公告披露不是叙事加速的充分条件**，
  `IN_LINE` 不得直接升级 L3 / 龙头排序 / 入场线 / 仓位 / trigger，`BEAT` 也只能触发进一步验证"
  （`concept-research/SKILL.md:58`、`industry-research/SKILL.md:52` 各一种措辞）。
- **概念/题材叙事生命周期**：形成 → 加速 → 扩散 → 退潮 + 真龙/假龙（有业绩兑现 vs 纯叙事）。
  本插件**数据面已经就绪**（`index_catalog` 概念板块目录、`index_constituents`、
  `eastmoney_sector_rotation`、`eastmoney_cashflow_rotation`），缺的只是方法论面。
- **check-first**：研究同一只票之前先读已有结论，并让使用者在"增量刷新 / 重做 / 只读复核"里选。
- **境内券商评级结构性偏多**（"rating count is not a bullish thesis"）与
  **A 股新股首日无涨跌幅 5 日**那一条（`markets/a-share.md`，含锁定期阶梯与招股书回退路径）。

顺带一条数据面线索（不是 skill 问题）：它的 `report_rc` 对应 Tushare 的券商研报预测条目
（前瞻 EPS / 目标价 / **上调下调方向**）。本插件的结构化面没有这一族，唯一的一致预期是
`web_retriever` 的 `ths_eps_forecast`（机构数 / 最小 / 均值 / 最大 / 行业平均，且已带
"机构数 <3 须一并披露"的纪律）。要不要补第二个来源，走 §10 数据源验收纪律另开。

- Maintenance snapshot (checked 2026-10-13): 2 星、五次提交全在同一天、之后 70 天无提交、
  0 issue、单人仓库，作者已声明数据层要到 v1.1 才开源。因此 catalog 标 `watchlist`——
  是**维护薄**，不是那两份口径的内容缺陷。
- Packaging: `.npmignore` 用七条目录规则 + 两条文件规则挡掉三颗编排器与上游工程材料；
  `package.json` 的 `files` 登记 `selected-skills/quant-agent-skills`。
  `test/packaging.test.mjs` 从 catalog 反查发布清单里的 `SKILL.md` / `LICENSE` / `UPSTREAM.md`，
  并逐条反查 `.npmignore` 确实生效（目录与文件名两类都问）。
- Runtime status: `watchlist` / 默认关闭。使用者在「插件」→ Capital Generation →「精选 Skills」
  打开后，对之后的 Capital 会话可见；子 Agent 不继承。上游随 git 保留的脚本与编排器正文
  **从不执行、也从不被 provider 读取**（skills 根里没有它们）。
- Review status: 2026-11-15 复查上游、许可证与维护状态。届时若上游 v1.1 真的放出数据层，
  重读上面"已知未收"那四条的可行性；不要在没有账本能力的前提下把它的 closeout 契约搬过来。

## 2026-10 收敛：仓内只保留 catalog 正文

本仓不再保存上游全量快照。除 catalog 命中的 1 颗正文、LICENSE 与本文件之外，以下内容按 2026-10 政策**从仓里删除**（不是仅从包里排除）；重新按上面所钉 commit 覆盖快照时按本节过滤。

- **非 catalog skill（3 颗）**：`concept-research`、`industry-research`、`stock-research`。
- **上游仓库材料**：`.npmignore`、`CHANGELOG.md`、`README.md`、`docs`、`examples`、`scripts`、`template`。
- 许可与署名不受影响：`LICENSE` 原件、所钉 commit 与作者信息仍在上面各节；公开许可只要求保留版权与许可声明。
