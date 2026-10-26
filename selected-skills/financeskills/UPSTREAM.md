# Upstream Record

- Project: FinanceSkills —— 48 颗讲**企业会计与公司金融**的 skill：估值与建模（WACC、三表勾稽、DCF 与
  可比与先例交易、LBO、初创估值、油气储量）、信用与减值（偿债能力、IFRS 9 预期信用损失、银行资本、
  保险准备金）、编制视角的会计作业（收入确认、租赁、递延所得税、合并、存货、固定资产、总账分录、
  结账与对账）、审计内控（内审清单、SOX 404、取证排查、ESG 披露）、企业内部运营（FP&A、单位经济、
  盈亏平衡、司库、项目挣值、燃烧率），以及 6 颗个人理财与美国 / 英国税制那颗。上游 `README.md:5`
  自述目标用户是 **accountants**（"for accountants in oil & gas, banking, insurance, and corporate
  finance"），这一句正是本颗收录判断的落点：使用者是证券研究者，不是记账的人。
- Repository: https://github.com/GAJETOso/financeskills
- Upstream commit: `b0c6239e339c1865c54bd2bb4cd4c1974120f1b8`（main，2026-10-01 12:08:42 +0000，
  "chore: refresh eval baseline scorecard"）
  - 全仓 46 次提交，首末为 2026-05-01 与 2026-10-01；`chore: refresh eval baseline scorecard` 按月出现，
    是唯一持续的活动线。上游 `VERSIONS.md` 停在 v1.0.1（2026-06-12），`marketplace.json` 的 `version`
    同为 `1.0.1`，无 git tag、无 GitHub release。
- License: MIT；`LICENSE` 为上游原件、未改写。署名按现状记三条，不替上游挑一个：
  `LICENSE` 的版权行是 **`Copyright (c) 2026 KOMVIA`**；`marketplace.json` 的 `publisher` 也是 `KOMVIA`，
  上游 `AGENTS.md:11` 自述 `**Creator**: KOMVIA`；而仓库 owner 与 `README.md:5` 的 "Built by" 都是
  **Ayotunde Oso（账号 `GAJETOso`）**。catalog 的 `owner` 用仓库账号 `GAJETOso`——设置卡片那条
  上游链接是按 `https://github.com/${owner}/${repository}` 拼的（`config/client.src.cjs:576`），
  换成品牌名就是死链。MIT 与 Apache-2.0 的差别在本仓有实际后果，见下面"许可义务"一节。
- Imported content: 只带 `skills/` 这一棵树（48 颗，337 个文件 / 2.4 MB）与 `LICENSE` 原件，
  与所钉 commit 逐字节相同（除下面列出的 10 份）。**上游仓库根其余材料整个不复制进本仓**，
  不是"复制了再挡"：`tools/`（2.2 MB，MCP 服务端 + Stripe / Plaid / QuickBooks / Xero 连接器——
  执行面，连 git 都不进）、`standards/`（924 KB 准则摘要库）、`commands/`（斜杠命令层）、
  `projects/`、`compliance/`、`foundations/`、`ai-usage/`、`workflows/`、`financeskills_pkg/`（它自己的
  python 包与 CLI）、`validate_skills.py` 与两份 validate 脚本、`MANIFEST.sha256`、`SKILL_MATRIX.md`、
  `VERSIONS.md`、`marketplace.json`、`pyproject.toml`、`llms.txt` 与 12 份仓库级文档、`.claude-plugin/`、
  `.github/`。判据：正文从不跨目录引用它们——48 颗的 175 条相对链接**全部**落在自己目录内，
  `../` 命中 **0 处**（实测，见"复核方法"）。上游 `.gitignore` 同样不带（§8.6：它会继续在本仓生效）。
- Structure: **前六颗挨个踩过的四类结构改动，这一颗一处都不需要**——上游本来就是
  `skills/<name>/SKILL.md` 一层扁平，48 份 frontmatter 的 `name` 与目录名逐颗一致（因此
  `test/persona.test.mjs` 的 frontmatter 核对直接过），`description` 齐备，既不用补 `name`、
  不用套一层、不用平铺主题分组、也不用在多根里挑一条。catalog 的 `name` 与现有 59 颗**零撞名**。

- Local modifications（两类，逐条可复核；口径与理由见 `docs/dev/selected-skills.md` §8.6 的接入必查清单）：

  1. **合规改写：8 颗 catalog 正文里的 16 处，涉及 10 份文件（+16 / −16 行）**。全部落在第 1、4 两条，
     按类别列在这里：

     - **`python3 scripts/calculate.py` 那一句（8 处，每颗 SKILL.md 的 `## Scripts` 段各一行）**——
       上游 48 份正文里有 43 份带着这句，写法是 `Run \`python3 scripts/calculate.py\` to self-test;
       import the functions instead of doing mental math`，而同文件里**没有任何一份**写着"没有 shell
       时读哪份附属文件"的退路句（实测命中 0）。本插件的根角色没有 shell（§1.6 两道闸门 deny
       `bash` / `pwsh`），发布包也不带脚本，这一句撞上的是一条跑不通的指令。改法照 trading-skills
       先例：删掉"你自己跑"，逐颗点名"照哪几份 `references/` 的算式做、把算式写进答复、真要算力就
       交给委派的 `data_junior`"。八颗各自点名的附属文件：`company-valuation` →
       `references/terminal-value-guide.md`；`wacc-computation` → `references/capm-basics.md` 与
       `references/beta-math.md`；`three-statement-modeling` → `references/model-checks.md`；
       `credit-analysis` → `references/covenant-guide.md`；`ecl-computation` →
       `references/risk-modeling.md` 与 `references/ifrs9-standard.md`；`insurance-reserving` →
       `references/actuarial-methods.md` 与 `references/insurance-metrics.md`；`banking-compliance` →
       `references/basel-iii-framework.md` 与 `references/risk-weights.md`；`forensic-accounting` →
       `references/benfords-law.md`。
     - **"用代码算"这一族（4 处）**：`company-valuation:45`（`**Build with code**: FCF model,
       sensitivity grid …`）、`three-statement-modeling:50`（`**Build in code** (pandas or a clean
       spreadsheet structure) …`——同时点了 pandas 与电子表格引擎）、`credit-analysis:48`
       （`**Compute ratios with code** …`）与 `credit-analysis:62`（输出模板里的
       `with code-verified math`）。这四句都在指挥 Agent"用代码把数算出来"，而本插件的分析侧唯一有
       shell 的是被委派的 `data_junior`，根角色算数只能把算式写出来。改成同一条形状，不动它们给出的
       公式、阈值与判断标准。
     - **附属文件里的同类残留 1 处**：`three-statement-modeling/references/model-checks.md:23`
       写着 `In code: a single CONFIG dict/dataclass, statements as functions of it`——把模型组织成代码
       的指令。改成"只留一个驱动因子块，每张报表都从它派生"，意思不丢。**扫描面必须含附属文件**这一条
       是第四颗教的（§8.6 开头那段），这次照样在 `references/` 里抓到一处。
     - **产出物里的假出处 1 处**：`wacc-computation/assets/wacc-memo-template.md:40` 的脚注
       `Computed with scripts/calculate.py` 会在每张备忘录上宣称"这些数是一个脚本算出来的"——在
       本插件里没有任何脚本跑过，这是一句运行时假话。改为"每个数字都对得上它旁边写出的算式与输入"，
       保留后半句 `review before use in a transaction`。
     - **点名宿主工具 1 处（2 行）**：`forensic-accounting:29-30` 原句
       `**\`web_fetch\` and generic scraping cannot access secure banking portals or private ERP
       environments.**` 加后半句"…or via specific API integrations"。这句**本意是护栏**（提醒 Agent
       别以为抓得到银行内网），但两半都有问题：前半句点名了一颗本插件根角色没有的工具名，后半句承诺了
       一个本插件不提供的企业接口集成。改写为"本插件的任何检索路径——包括委派出去的——都到不了银行
       门户、企业 ERP 或任何内部系统，账务明细只能由使用者给出"，护栏含义原样保留。
       ⚠ 这一处是本轮最容易"过了闸门却改坏内容"的地方：闸门只认词形，`web_fetch` 从来不在 23 条模式里。

  2. **判定过、但按"不改"处理的**（记在这里，因为下一轮重新按 commit 覆盖快照时会有人以为漏改）：
     - `three-statement-modeling/references/model-checks.md:16` 的 `in Excel requires iterative calc …
       in Python, loop until |Δinterest| < tolerance`：**留着**。这是在讲循环引用两种解法各自的
       代价（并明确写了 "risk: silent convergence failures"），属方法论描述，不是一句"你去跑"的指令。
       同文件 `:22` 的 `Color convention if spreadsheet-based` 同理（呈现惯例）。
     - `## Related Skills` 段里那些**指向不进 catalog 的兄弟**的名字（`financial-analysis`、
       `risk-assessment`、`lbo-modeling`、`startup-valuation`、`investment-analysis`、`budget-forecast`、
       `working-capital-analysis`、`debt-restructuring`、`corporate-consolidation`、`audit-checklist`）：
       **留着，逐字不动**。这些 skill 随包住在快照里，只是没进闭集，运行时会得到一次"没开放"的答复——
       已收录的正文里本来就有 26 处同形状（InvestSkill 的 `fact-check → full-report`、
       `industry-map → chart-master` 等），不为口味改上游的交叉引用。
     - 另外三个名字**指向的 skill 连上游都不存在**（`wacc-computation` 的 `capital-budgeting`；
       `ecl-computation` 与 `insurance-reserving` 的 `financial-statement-prep`——上游那颗真名叫
       `statement-preparation`，八成是改名后没回来更新）。这是上游自身缺陷，不属"合规 / 可发现性"
       两个可改理由，因此**也不改**，只记在这里；表现与上一条完全相同。
     - 巴塞尔的 4.5% / 6% / 8%、`credit-analysis` 的杠杆 3.0x 与 DSCR 1.2x、`company-valuation` 的
       "TV > 75% of EV 报警"与"DCF 与可比差 30% 说明假设有错"、控制权溢价 20–35%、
       `ecl-computation` 的 `Loss Allowance Posting (Generating the journal entry)`——**一个数字、
       一句结论都没动**（§8.6：不改分析结论）。它们与市场口径有关的偏差全部改在 catalog 的
       `description` 与 `riskNote` 上说明，见下面"市场口径落点"。

- 许可义务：MIT 与 Apache-2.0 在这点上不同，别混淆。Apache-2.0 第 4 条 (b) 款要求"修改过的文件带上
  显著声明"，所以第六颗（`claude-for-financial-services-cn`）每份被改写的正文第一行都有一句可见声明，
  并由 `test/selected-skills-content.test.mjs:132-143` 按 `repository` 正向钉住。**本颗是 MIT**：
  再分发不要求在被打的那份文件上留痕，改动口径住在本文件就够了——所以这 8 份正文**没有**加声明行，
  那也不是遗漏。将来若有 Apache-2.0 的快照照本文件抄格式，别忘了那一句是许可义务而不是本仓习惯。

- 脚本审计（"允许 skill 自带脚本"这条政策的实测底子，翻案时直接用）：43 份 `scripts/calculate.py`，
  共 2002 行，逐份读过。顶层 import 只有 `__future__`、`copy`、`dataclasses`、`itertools`、`math`、
  `random`、`statistics`、`typing`——**全部标准库**；零网络调用、零文件读写、零 `subprocess` /
  `os.system` / `eval` / `exec`、零 `os.environ` 与凭据读取；每份末尾的 `if __name__ == "__main__":`
  是一组 `assert` 自检加一行打印。上游自带 `MANIFEST.sha256`（580 条），实测 **38 份脚本哈希与清单一致、
  0 份不符**；5 份不在清单内（`personal-budgeting`、`tax-efficient-investing`、`debt-payoff`、
  `net-worth-tracker`、`retirement-planning`），上游 `VERSIONS.md` 自述"38/43 covered; remaining 5
  judgment-only by design"。**风险不在恶意，在"这条指令跑不通"**：正文写的是相对路径 `scripts/…`，
  而 DSH 的 `skill` 工具会在结果里给一行 `<skill_resources>` 与"Base directory for this skill:
  <绝对路径>"（本仓真实会话里取到两例），所以路径其实可解析——真正的约束是谁来执行：根角色被
  `ROOT_AGENT_DENIED_TOOLS` 与 `src/agents/bash-guard.ts` 两道闸门挡掉 shell，唯一有 shell 的
  `data_junior` 看不到 skills（provider 只在 Capital 根 Agent scope 注册）。因此翻案需要同时动
  §8.6 第 4 条、闸门 `NEEDS_FALLBACK`（现要求 `skip the router` 那一句）与这颗的 `.npmignore`
  （现在挡 `scripts`），并把 `python3` 在 Windows 桌面端不保证存在这一条写成退路而不是装饰。
  **本轮按现行口径执行，脚本不进发布包。**

- 收录判断（48 颗里 **8 颗进 catalog，40 颗留在快照里当可审查材料**）：
  - **进（8）**：`company-valuation`、`wacc-computation`、`three-statement-modeling`、`credit-analysis`、
    `ecl-computation`、`insurance-reserving`、`banking-compliance`、`forensic-accounting`。
    依据是在已收录 59 颗的正文上按中英双语现算的空白核对（宇宙 = catalog 条目目录下的全部 `.md`，
    与闸门同一口径）：**EV→股权价值 bridge、敏感性网格、三表勾稽与 revolver 循环、PD/LGD/ECL 三阶段、
    Benford 首位数字、mid-year convention 六项 0 命中**；CET1 / RWA / LCR、IBNR / 综合成本率、
    DuPont、先例交易、控制权溢价各只有 1 颗顺带提过；CAPM 与 β 去杠杆各 2 颗——**都点名了，都没有估法**。
  - **不进 · 与既有重叠（4）**：`financial-analysis`（比率与 DuPont 已被 `stock-eval`、
    `financial-report-analyst`、`financial-health` 覆盖）、`investment-analysis`（与
    `stock-eval`、`buffett-investment-framework`、`peter-lynch-skill` 同一件事且更薄）、
    `risk-assessment`（VaR / 压力测试已有 `risk-stress-test` 与 `portfolio-concentration`）、
    `working-capital-analysis`（现金周期 7 颗已覆盖，含 A 股那几颗）。
  - **不进 · 资产类别（1）**：`crypto-accounting`。本插件不涉及比特币与数字资产，这条与合规判据无关，
    是服务边界。连带 `tools/connectors/`（Stripe / Plaid 等账户连接）整个不进 git。
  - **不进 · 个人理财与美国 / 英国税制（6）**：`personal-budgeting`、`net-worth-tracker`、
    `retirement-planning`、`debt-payoff`、`tax-planning`、`tax-efficient-investing`（401k vs Roth、
    ISA allowance 是境外税制产物）。使用者是这个投研插件的使用者，不是家庭财务规划的客户。
  - **不进 · 编制视角的会计作业（13）**：`journal-entry`、`statement-preparation`、
    `intercompany-accounting`、`corporate-consolidation`、`close-management`、`automated-reconciliation`、
    `deferred-tax`、`revenue-recognition`、`lease-accounting`、`inventory-costing`、
    `fixed-asset-accounting`、`aro-computation`、`variance-analysis`。这一族的正文是"你是总账会计 /
    集团财务报告会计 / 工厂成本控制员"，把账做对；本插件的使用者读别人披露的账。**收法上我们没有
    "把编制视角改写成审阅视角"这一项授权**（§8.6：不为口味改措辞、不改分析结论），所以整族留在材料里。
  - **不进 · 审计、内控与披露合规执行（3）**：`audit-checklist`、`sox-compliance`、`esg-reporting`
    （SOX 404 控制测试与抽样、COSO 框架、SASB / TCFD 披露准备——执行面在上市公司自己，且本插件
    没有 ESG 数据面）。
  - **不进 · 企业内部经营与资金管理（6）**：`budget-forecast`、`predictive-burn-rate`、
    `product-profitability`、`cvp-breakeven`、`treasury-management`、`earned-value-mgmt`。
  - **不进 · 私有公司与特殊融资语境（5）**：`startup-valuation`（Berkus / VC 法，无披露可校）、
    `lbo-modeling`、`venture-debt`、`debt-restructuring`（Chapter 11 谈判）、`oil-gas-valuation`
    （储量经济学）。本插件没有非上市标的与储量报告的取数面。
  - **不进 · 依赖本插件不具备的模型或数据形态（2）**：`ai-anomaly-detection`、
    `nlp-earnings-sentiment`（正文的 `references/finbert-guide.md` 里那段 ```python 围栏用
    `from transformers import pipeline`；本插件既没有 shell，宿主侧也不带 transformers）。
    这两份围栏同时是 23 条模式在**全 48 颗**上唯一的命中（另一处是
    `automated-reconciliation/references/fuzzy-logic.md`），正因为不收，它们不进扫描面。

- 市场口径落点（§8.6 第 8 条）：`us-stock` 只给**数字基准确实是美国**的三颗——`wacc-computation`
  （10 年期美债、美股 ERP、美国边际税率）、`company-valuation`（先例交易与控制权溢价惯例）、
  `credit-analysis`（国际公司贷款的舒适阈值）。`banking-compliance`（巴塞尔原值）、`ecl-computation`
  （IFRS 9）、`insurance-reserving`（IFRS 17 与精算惯例）、`three-statement-modeling`（IFRS / US GAAP
  科目表）、`forensic-accounting` **不套 `us-stock`**——它们是国际准则而不是美股专用，标错会把
  A 股能用的东西藏起来；差异逐颗写进 `riskNote`：境内商业银行资本办法的 5% + 储备资本 + D-SIB 附加、
  CAS 22 已对齐 IFRS 9 但不披露 PD / LGD 参数、境内法定准备金与折现曲线另有规定、A 股科目要自己映射。

- 复核方法（全部是实测命令，不是回忆）：
  1. `git clone` 所钉 commit 到 `/tmp`，`diff -rq` 上游 `skills/` 与快照 `skills/` ⇒ 差异
     **恰好 10 份文件**（8 份 `SKILL.md` + `three-statement-modeling/references/model-checks.md` +
     `wacc-computation/assets/wacc-memo-template.md`），其余 38 颗逐字节相同；`git diff --no-index
     --numstat` 逐份取行数，合计 **+16 / −16**。
  2. 把 `test/selected-skills-content.test.mjs` 的 23 条 FORBIDDEN **原文正则**套到全 48 颗的 185 份
     `.md` 上现扫 ⇒ 命中 2 处（都不在候选里）；另按 `python3 scripts/` 数出 43 份、按退路句族
     （`skip the router` / `no shell` / `without a shell`）数出 **0 份**。
  3. `sha256sum -c MANIFEST.sha256`：580 条里 52 条不匹配，**全部是 `evals/` 下的 CSV 夹具与
     `tools/evals/BASELINE.md`、`compliance/REGULATORY_MAPPING.md`**；43 份脚本零不匹配（38 对、5 不在清单）。
     不推断成因，只记事实。
  4. 链接与结构：48 份 frontmatter 的 `name` 与目录名逐一相等；175 条相对 `.md` 链接全部指向存在的
     文件；`../` 跨目录引用 0 处；`skills/` 下的子目录名只有 `references` / `evals` / `scripts` /
     `assets` / `files` 五种，与上游仓库根那批目录名零冲突（这一条决定 `.npmignore` 的裸名规则会不会
     误挡正文——见 packaging 那一节）。
  5. 空白核对按 catalog 现算：把候选主题的英文与中文两套词表同时套到已收录 59 颗的正文上（**只用
     英文词表会把中文写的 A 股正文误判成空白**，这是这一轮差点犯下的错）。

- Packaging: 这颗带 `.npmignore`，两条裸名规则：`evals`（48 份评测夹具目录，896 KB——`evals.json` 与
  CSV 样本；**八颗的 `SKILL.md` 都不链接 `EXAMPLE.md`，而 `EXAMPLE.md` 是唯一提到 `evals/files/*.csv`
  的地方**，所以运行时读不到它们，`provider` 也只读 `SKILL.md`）与 `scripts`（43 份 `calculate.py`，
  344 KB；本轮按 §8.6 第 4 条不进包，理由与审计数字见上面"脚本审计"一节，政策若翻案这条第一个要改）。
  随包发的是 48 颗的运行时正文（`SKILL.md` + `references/` + `assets/` + `EXAMPLE.md`）与本文件、
  `LICENSE`。规则写成裸名不带路径（`test/packaging.test.mjs` 把目录与文件两类规则都拿去问一次真实
  打包器，写了没生效就红；反过来"该挡的没写"没有任何测试会响，所以 `npm pack --dry-run` 的抽查是
  这一步的收尾）。全量快照完整住在 git，`github:` 安装与"当时是哪个 commit"的复核都不受影响。

- Runtime status: `watchlist` / 默认关闭的显式实验。只有使用者在「插件」→ Capital Generation →「配置」
  逐格打开后，对**之后新建**的 Capital 根 Agent 可见；子 Agent 不继承。开启与否都不引入新权限：
  这 8 颗正文从不取数、不跑脚本、不连任何系统，需要的数字一律走本插件既有的委派取数通道，
  取不到就点名缺口。
- Review status: 2026-10-12 收录并复查上游、许可证、脚本与维护状态；下次复核 **2026-11-15**。
  这 48 颗按 IFRS / US GAAP 的企业财务惯例写（科目名、准则号、巴塞尔阈值、401k 与 ISA 那类税制），
  与本仓已有的美股 28 颗和 A 股 18 颗互为**方法层补充**而不是同一件事的第四份。本插件不提供金融服务：
  这 8 颗算出的 WACC、估值区间、偿债结论、减值覆盖、准备金与资本比率都是方法推演的产物，
  既不是订单，也不是授信意见、审计意见或法律意见——`forensic-accounting` 那颗给出的"疑似"清单尤其
  不构成舞弊认定。本文件与本仓的收录判断不构成对上游观点的背书。

## 2026-10 收敛：仓内只保留 catalog 正文

本仓不再保存上游全量快照。除 catalog 命中的 8 颗正文、LICENSE 与本文件之外，以下内容按 2026-10 政策**从仓里删除**（不是仅从包里排除）；重新按上面所钉 commit 覆盖快照时按本节过滤。

- **非 catalog skill（40 颗）**：`ai-anomaly-detection`、`aro-computation`、`audit-checklist`、`automated-reconciliation`、`budget-forecast`、`close-management`、`corporate-consolidation`、`crypto-accounting`、`cvp-breakeven`、`debt-payoff`、`debt-restructuring`、`deferred-tax`、`earned-value-mgmt`、`esg-reporting`、`financial-analysis`、`fixed-asset-accounting`、`intercompany-accounting`、`inventory-costing`、`investment-analysis`、`journal-entry`、`lbo-modeling`、`lease-accounting`、`net-worth-tracker`、`nlp-earnings-sentiment`、`oil-gas-valuation`、`personal-budgeting`、`predictive-burn-rate`、`product-profitability`、`retirement-planning`、`revenue-recognition`、`risk-assessment`、`sox-compliance`、`startup-valuation`、`statement-preparation`、`tax-efficient-investing`、`tax-planning`、`treasury-management`、`variance-analysis`、`venture-debt`、`working-capital-analysis`。
- **上游仓库材料**：`.npmignore`。
- **catalog 目录内的附属材料**：`evals/` 17 个文件。
- **纯公式脚本（8 份）**：移到 `selected-skills/reference-algorithms/financeskills/`，git-only、不随包、不执行。
- 许可与署名不受影响：`LICENSE` 原件、所钉 commit 与作者信息仍在上面各节；公开许可只要求保留版权与许可声明。
