# 社区金融 Skill 候选扫描（2026-10）

> **2026-10 政策更新：** 本文记录的是接入当轮的判断，不是现行仓内形态。此后仓内收敛为
> "只留 catalog 正文 + `LICENSE` + `UPSTREAM.md`"：被排除的非 catalog skill、脚本、取数服务端与仓库材料
> 已从仓里删除（逐份清单见各快照的 `UPSTREAM.md`），纯公式脚本移到 `selected-skills/reference-algorithms/`
> （git-only、不执行）。本文里"仍留在快照""不进发布包"一类措辞按此理解；取数一律走角色系统提示里的
> `capital:data-contract`，skill 只声明 `## Evidence request`。

**扫描日期：**2026-10-08  
**目的：**寻找可适配 Capital Generation 的外部能力，不代表采用、背书或运行这些项目。  
**审查范围：**公开仓库 README、代表性 `SKILL.md`、引用/方法文件、许可证和 GitHub API 元数据。没有 clone 或执行任何外部脚本，也没有核实其实际金融结论。

## 结论

当前固定版本都进入默认关闭的显式实验 catalog，设置页按能力标签展示和筛选；`status` 是记在 catalog 与本文里的成熟度/维护风险信号，不在设置页显示，也不代表推荐或背书：

1. [`spikeHongg/china-stock-research-skills`](https://github.com/spikeHongg/china-stock-research-skills)：内容可作为 A 股财务健康、风险监控、估值、战略转型、行业竞争和订单质量的实验模块；截至 2026-10-08，最后提交为 2026-03-09，状态为 `watchlist`，用户可按模块自行开启。其 orchestrator 仍因与 Capital 路由冲突排除。
2. [`finterm-ai/investment-skills`](https://github.com/finterm-ai/investment-skills)：最后提交为 2026-07-22，状态为 `experimental`，可作为 Buffett-inspired 商业分析、现金流、估值和风险框架显式实验，仍默认关闭。它主要源于美股/伯克希尔语境，不能直接当作 A 股规则。
3. [`yennanliu/InvestSkill`](https://github.com/yennanliu/InvestSkill)：**2026-10-10 追加入驻**，状态 `experimental`，28 个美股模块进 catalog、默认关闭。判断依据与逐条排除见下面的追加节。
4. [`DjNero11/peter-lynch-skill`](https://github.com/DjNero11/peter-lynch-skill)：**2026-10-11 追加入驻**，状态 `watchlist`，一颗个股研究工作流（Quick 快筛 + Deep 尽调）进 catalog、默认关闭。它带来本仓第一颗**自带完整证据预算与引用契约**的工作流，也第一次遇到"`SKILL.md` 住在仓库根"的结构。判断依据与逐条改写见文末第二个追加节。
5. [`marian2js/trading-skills`](https://github.com/marian2js/trading-skills)：**2026-10-11 追加入驻**，状态 `watchlist`，19 颗里 11 颗进 catalog（下单前的过程检查、仓位测算与持仓复核、下单后的复盘），默认关闭。券商执行面、接管路由的编排、写死付费 API 的那几颗逐条排除；它也是第一颗 `SKILL.md` 藏在**两层目录**底下的快照。**2026-10-12 判据纠正**后收回 `position-sizing` 与 `position-management`（当初按"给仓位与买卖动作"排除，是把内容形状当成了执行面）。判断依据与逐条排除见文末第三个追加节与第五个追加节。
6. [`jwangkun/claude-for-financial-services-cn`](https://github.com/jwangkun/claude-for-financial-services-cn)：**2026-10-11 追加入驻**，状态 `watchlist`，规范根 31 颗里 12 颗进 catalog（A 股卖方研究体裁：业绩点评与差异表述、财报前瞻、可比倍数、A 股 DCF、行业全景、催化剂日历、财务核查、首次覆盖，另有晨会纪要、持仓逻辑跟踪与选股清单），默认关闭。本仓**第一份非 MIT 的快照（Apache-2.0）**，因此被改写的十二份正文各带一行 §4(b) 要求的改动声明；它也是第一颗把取数层写成**结构**（三档服务商阶梯 + 环境变量模式开关 + 伪调用围栏，63 份正文每份都带）的快照，以及六个并列 skills 根里**只登记一条线**的那种结构。判断依据与逐条排除见文末第四个追加节与第五个追加节。
7. [`GAJETOso/financeskills`](https://github.com/GAJETOso/financeskills)：**2026-10-12 追加入驻**，状态 `watchlist`，48 颗里 8 颗进 catalog（估值与建模的工程层：`wacc-computation`、`three-statement-modeling`、`company-valuation`；偿债与行业专用财务：`credit-analysis`、`ecl-computation`、`banking-compliance`、`insurance-reserving`；加一颗 `forensic-accounting` 的首位数字排查），默认关闭。两点第一次：**重心不在证券研究**——上游 `README.md:5` 自述写给 accountants，因此 40 颗的排除理由是"领域外"（编制视角的会计作业、内部审计与内控、个人理财与美国 / 英国税制、加密资产、私有公司语境）而不是执行面；以及**正文自带可运行的计算脚本**——43 份 `calculate.py` 逐份审过（全标准库、零网络零落盘零子进程零凭据、38 份对上游 `MANIFEST.sha256` 哈希一致），但本轮仍按现行 §8.6 第 4 条处置：删掉"你自己跑"那一句，脚本不进发布包。判断依据、脚本审计与"政策若翻案要动哪三处"见文末第六个追加节与该快照的 `UPSTREAM.md`。

8. [`Howard-Jerry/quant-agent-skills`](https://github.com/Howard-Jerry/quant-agent-skills)：**2026-10-13 追加入驻**，状态 `watchlist`，上游三颗里 **0 颗**进 catalog，进 catalog 的那一颗 `cross-market-listing-choice`（跨市场选线：同一公司有 A 股与港股、或美股 ADR 与港股两条线时选哪一条）**正文由本仓撰写**。两点第一次：本仓第一次在外部快照里放一份**自持正文**（随包的上游原文只有两份零执行面的 overlay 口径文件，逐字节相同，核对方式写在 `UPSTREAM.md`）；也是第一次遇到"**整颗都不能收，但隔壁两份附属口径值得单独拿出来**"的形状——它不写服务商阶梯、不写凭据名，26 条闸门模式在三颗入口上只响 1 次，但三颗点名的本地路径实测 10 / 32 / 16 个，公开版**一个都不存在**（作者声明数据层要到 v1.1 才开源），132 处命中里 109 处住在 `steps/`。这种句子改不掉：删掉"你自己跑脚本"，那颗就没有正文了。判断依据、闸门新增四条与反证方向见文末第七个追加节。

所有条目都需要用户自行判断是否适合当前任务；Owner 会继续寻找合适的社区项目，也欢迎通过 PR 提交新的固定快照和标签元数据。

观察名单：[`yaorenliang/trading-agents-skill`](https://github.com/yaorenliang/trading-agents-skill)，评估多空相互反驳、延迟复盘等可拆分 workflow。**2026-10-12 判据纠正**：这一条原先写的是「评级、买卖动作和仓位决策属于明确冲突，不能直接集成」，那是把 §8.6 第 7 条读成了内容禁令；本插件不收的是**执行面**（第 4 条——不接券商接口、不发布能下单的东西），强制五档评级与给出仓位数字本身都不构成排除理由。这一条因此按纠正后的判据重评：它此前只读过 README，重评要 clone 后逐文件看取数层与凭据形状，不在本轮范围。同一口径在第五、六颗上各挡掉过几颗，其中五颗（`position-sizing`、`position-management`、`china-morning-note`、`china-thesis-tracker`、`china-idea-generation`）已于 2026-10-12 收回，见文末第五个追加节；`china-tax-loss-harvesting` 仍不收，但理由改记在第 8 条市场口径上。

外部服务/合作参考：[`MobiusQuant/Gendangzou-skill`](https://github.com/MobiusQuant/Gendangzou-skill)。其板块政策与多信号快照、证据链是独特主题，但主体能力依赖其在线 API，结论范围限定在板块，不能视作可离线导入的通用技能。

## 维护性核验

维护判断以提交历史而非 stars 为准：[China Stock Research Skills commits](https://github.com/spikeHongg/china-stock-research-skills/commits/main/) 的最新提交是 2026-03-09，2026-07-10 至 2026-10-08 无提交；[Finterm commits](https://github.com/finterm-ai/investment-skills/commits/main/) 的最新提交是 2026-07-22，之后至扫描日无提交。前者因此标为 `watchlist`，后者标为 `experimental`；两者都默认关闭，用户选择时能看到最后提交日期和下次复查时间。未来随着 catalog 规模和 benchmark 增长，再把长期无响应候选迁出运行时选项。

## 候选审查

| 候选 | 可验证亮点 | 与本项目的关系 | 初筛意见 |
|---|---|---|---|
| [China Stock Research Skills](https://github.com/spikeHongg/china-stock-research-skills) | 7 个模块；每条关键事实要求可访问来源；Tier 1/2/3 来源等级；明确区分事实、解读、待验证问题；带行业 overlays 与模板；MIT | 与 `capital-equity-research`、`capital-event-impact` 覆盖面重叠，但其引用标准与分析模式路由可作 benchmark | **`watchlist`，按模块开放默认关闭的显式实验。**最后提交 2026-03-09；设置页显示 A 股、财务、风险、订单等能力标签。orchestrator 因路由冲突排除。 |
| [Finterm Investment Skills](https://github.com/finterm-ai/investment-skills) | Buffett framework 用 65 张卡、8 个模块、3 个工作流；先检查输入证据；卡片包括问题、动作、输出、边界和来源；有 source key、检索位置、`validate` 脚本与 CI；MIT | 适合作为“可追溯方法卡 + 按需路由”的设计参照；对当前完整投研 skill 有较大重叠，且主要源于美股/伯克希尔语境 | **`experimental`，默认关闭的显式实验。**最后提交 2026-07-22；设置页显示现金流、估值、风险等能力标签，不能直接当作 A 股规则。 |
| [Trading Agents SOP](https://github.com/yaorenliang/trading-agents-skill) | A 股场景；多空轮次反驳；5 档评级；T+5 延迟反思；声称提供真实案例；Apache-2.0 | 反方交叉质询和延迟复盘与“自进化”目标相关；但仓库明确要求买卖/持有决断、入场/止损/仓位与强制评级 | **只观察可拆分 workflow。**不可直接纳入 preset；若后续研究，只考虑不含交易动作的辩论/反思机制，并用固定 fixture 验证。 |
| [Gendangzou Skill](https://github.com/MobiusQuant/Gendangzou-skill) | A 股板块研究；区分实时发现与每日快照；强调 snapshot、稳定 ID、来源链；Apache-2.0 | 可补充政策/权威媒体/资金的板块信号视角；需要访问其服务 API，且不做个股/ETF 推荐 | **服务集成候选，不是 skill 文本入驻。**先审 API 条款、匿名/Token 条件、数据许可、稳定性和现有来源增量。 |
| [xquant-skills](https://github.com/dengyishuo/xquant-skills) | `ashare-fundamentals` 有断点续传、覆盖率检查、Parquet/可选 DuckDB/MySQL；MIT；明确源接口是公开东方财富结构化接口 | 这是数据 ETL 脚本和本地持久化流程；Capital 已有 Fuyao / Dataset 管线和 opaque ref 边界 | **不引入代码或数据 skill。**可借鉴覆盖率与续传验收思路；如需采用脚本，必须重走数据源扩展设计与独立 PR。 |
| [A-Stock-Skills](https://github.com/ZICXR/A-Stock-Skills) | A 股覆盖广，MIT，存在多源行情、分析、回测和报告样例 | README 示例包含持仓/cost 信息、常驻轮询和 webhook 告警，也描述 cookie 配置；部分功能是应用/执行面而非 skill | **不整包引入。**代码与脚本需逐个审计；优先验证来源许可、API 稳定性、凭据处理、回测偏差和消息外发。 |
| [悟道真英雄 Skill](https://github.com/sherjy/wudao-hero-skill) | 用户个性化交易纪律、复盘记录和版本回滚概念；MIT | 不是道家哲学 skill，而是个性交易人格/短线陪伴系统。README 鼓励导入截图、群聊、论坛材料并跨 skill 学习，含短线业绩/游资叙事 | **不入驻投资研究默认组合。**隐私与未经核验的社群信息风险高，且不是用户所说的“道家思想方法”。可观察其私有本地偏好/版本回滚机制，但需完全隔离数据。 |
| [Finance Toolkit](https://github.com/YellowPancake/Finance_Toolkit) | 汇集多种投资者/流派视角；说明来源等级、内在张力、证伪条件等设计主张；MIT | 适合作为 persona/perspective 搜寻入口，非单个经验证 skill | **仅作索引，不按 README 声明视为验证。**具体文件需逐份检查来源、人物归属、收益断言和版本；优先抽取检查问题，不导入声音模仿。 |
| [Hanai Worth / hanai-investment-dsh](https://github.com/hancao97/hanai-investment-dsh) | 同为 DSH 上的本地优先 A 股研究工作台；展示多专家研究与证据/输入快照哈希等可审计做法；MIT | 更像社区 peer/product，不是可复制进本 preset 的独立 skill | **建议建立社区交流/benchmark 关系。**可以互换非敏感评测场景或讨论 DSH 适配；不要复制其业务 UI、工具或专家组织架构。 |

## 与巴菲特/道家视角有关的发现

- 有多个“巴菲特” skill，但质量差异明显。当前优先看 Finterm 的非角色扮演、证据边界和逐卡来源；`bravet/buffett-skill` 也有公开股东信来源描述，但其 README 称由其他 skill 蒸馏生成，且只读 README 后不足以证明引用逐项可追溯，暂不排前。
- `sherjy/wudao-hero-skill` 的“悟道”是交易者自我人格/纪律系统，并非道家思想用于投资研究。
- 本轮没有发现能证明其内容来自道家经典并将概念转化为可检验投资问题的成熟 A 股 skill。这个方向放进 watchlist，避免把“道法自然”等泛化口号包装成有实证支持的方法。若后续找到候选，检查原典出处、现代解释、可证伪机制和边界后再决定是否作为 perspective lens。

## 下一轮建议

1. 先挑 Finterm 的 “Owner earnings / 现金流质量” 与 China 的财务健康、订单质量等模块，和现有 `capital-equity-research` 做盲测；用户也可以在设置页按标签自行组合。
2. 固定相同问题、截止日期和输入证据；只比较证据完整性、冲突处理、遗漏、无依据断言和 token/工具成本，不比较是否猜中股价。
3. 用用户反馈、失败案例和对照评测逐步改善标签、风险提示和复查周期；当候选规模和 benchmark 足够成熟时，再考虑把长期无响应或低价值条目移出 catalog。
4. 2026-11-06 重新检查前五颗快照的 release/commit、许可证、依赖与问题处理，2026-11-08 复查第六颗（节奏与它自己的 `reviewBy` 一致）；上游变化只触发复审，不自动更新本地能力。

## 追加（2026-10-10）：InvestSkill 入驻

候选：[`yennanliu/InvestSkill`](https://github.com/yennanliu/InvestSkill)（Claude Code plugin `us-stock-analysis`，`v1.12.0`，MIT）。固定 commit `c3f2a17`（main，2026-10-09；最后一次内容提交 `113527f`，2026-09-25）。

**与本轮其余候选不同，这一条是 clone 后逐文件读的**（不是只读 README），并且**按接入清单改写过正文**。快照与所钉 commit 的差异只有三类，逐条记在 `selected-skills/InvestSkill/UPSTREAM.md`：34 篇 `SKILL.md` 各补一行 `name:`（DSH provider 缺它就不发现该文件）；删掉上游自己的 `.gitignore`（它在宿主仓库会静默挡掉 `site/build/`）；**28 颗 catalog skill 的取数口径改写**（168 行删 / 161 行增）——原文成规模地要求分析角色自己 `use web search` 取实时报价，取不到就"打个 ⚠️ 警告后用 training-data estimates 继续"，另有两处 `node scripts/fetch-*.js` 指令。分析结论、评分表与输出模板一字未改；不进 catalog 的 6 颗原文未动。这一轮之后，接入清单（含"谁去取数""取不到怎么办"两条硬问题）固化在 `docs/dev/selected-skills.md` §8.6，正文结果由 `test/selected-skills-content.test.mjs` 复查。

| 硬门槛 | 读到的是什么 |
|---|---|
| 来源可核验 | 仓库、作者、tag `v1.12.0`、251 次提交；无转载痕迹 |
| 许可可用 | MIT，`Copyright (c) 2026 yennanliu`，原件随包 |
| 权限可控 | 原文每篇开篇要求分析角色"自己取实时报价"（24 颗写 `use web search`、25 颗留"取不到就用训练记忆估"的逃生口）——**已按清单改为委派与报缺**；本插件的取数边界本身不受正文影响（出网工具逐名 deny、bash 只给 `data_junior`），但记忆回填没有工具会拦，所以必须改在正文里。无凭据读取、无外传、无自动下单 |
| 可审查 | `scripts/` 372 KB 全部是 node 脚本，随快照留在 git、provider 从不执行；无下载后执行、无混淆代码、无隐藏网络调用 |
| 金融表达可校验 | 无收益/准确率承诺；打分项（Verification / ETF Fitness / Risk Budget 0–10）衡量的是自洽度与结构特征；`bear-case`、`earnings-preview`、`position-ladder` 含情景与股数写法，逐条在 `riskNote` 里写明是推演练习、不是订单 |
| 可适配 | 34 颗各自是一个有边界的分析视角/验证步骤，输入输出与失效条件都写在正文里 |

**catalog 收录 28 颗，排除 6 颗**（都留在快照里当材料）：`fundamental-analysis`、`dcf-valuation`、`research-bundle` 是上游自己标注的 alias 残片（`scripts/lib/skill-registry.js` 的 `ALIAS_SKILLS`，正文已声明并入他处）；`full-report` 是编排 skill，与 `china-stock-research-orchestrator` 同一条排除理由；`report-generator` 是上游输出口（HTML/PDF 存 `output/`），与已删除、禁止恢复的报告交付链路冲突；`chart-master` 教 Agent 自己出图，出图一律走 `render_chart`。

**它填的缺口**：本插件此前没有逐条主张核验（`fact-check`）、刻意反方（`bear-case`）、SEC 披露面（Form 4 / 13F / 短仓）与结果自洽度评分（`result-validator`）这几类视角；使用者在"复核一份别人写的报告""给一个看多论点找反证""读美股年报"这三类任务里会去勾它。**重叠**：`stock-valuation` 与 `valuation-investment-strategy`、`competitor-analysis` 与 `industry-competition-moat` 主题相近，但前者按美股同业与四方法区间出假设清单，后者按 A 股披露口径——两条 riskNote 都写明了不可互相替代。

**A 股专项检查**：本条**不声称**适用于 A 股。复权、T+1、涨跌停、披露制度（无 Form 4/13F/13D、无 SEC EDGAR full-text）与税务（无 wash-sale 规则）都不成立，因此 `us-stock` 与 `filings` 标签就是给使用者的口径提示，各条 `riskNote` 逐条点名要换的口径。

维护性：近 90 天 47 次非机器人提交、近 180 天 111 次，最新 release `v1.12.0`（2026-09-25），CI 自带 skill 契约检查（`scripts/check-skill-contract.js`）。活跃，因此 `experimental` 而非 `watchlist`。下次复查 2026-11-06（与另两颗同一节奏）。

## 追加（2026-10-11）：peter-lynch-skill 入驻

候选：[`DjNero11/peter-lynch-skill`](https://github.com/DjNero11/peter-lynch-skill)（作者 Szymon Nycz，GitHub 账号 `DjNero11`，MIT，一颗 skill、两条工作流）。固定 commit `e0eaf58`（main，2026-06-28）。

结构与前三颗都不同的一点：**上游把 `SKILL.md` 放在仓库根**，没有 `skills/` 那一层。`SELECTED_SKILL_SKILL_DIRS` 能表达"`<repo>` 下哪个子路径是 skills 根"，表达不了"`<name>/SKILL.md` 这一层就是根本身"——provider 与四处反查都会去找 `…/peter-lynch-skill/peter-lynch-skill/SKILL.md`。取舍是把 `SKILL.md` 与 `references/` 一起套进 `skills/peter-lynch-skill/`：相对链接不破、frontmatter `name` 与目录名一致、五处路径计算一行不动，代价是快照不再与上游树逐字节一致（这条失真记在 `UPSTREAM.md`，没有为了让路径成立去动 provider 的布局假设）。原文旁路 `MAX_SKILL_DOC_BYTES` 是 128 KB，这颗 `SKILL.md` 7.8 KB，余量充足。

**这一颗是 clone 后逐文件读的**，并按接入清单改写过正文。快照与所钉 commit 的差异只有三类，逐条记在 `selected-skills/peter-lynch-skill/UPSTREAM.md`：套一层 `skills/<name>/`；删掉上游 `.gitignore`；**六份文件 124 行的取数口径改写**——原文把取数交给 Agent 自己（`All data comes from web search and fetched pages`、Step 3 抬头 `Using the host agent's web search and page fetch tools`、两份 `web-research.md` 里 28 处独立 `search`、`deep/system-prompt.md` 的 `use web search results`），而本插件的检索只有一个入口：委派 `web_retriever` / `data_collector`。预算数字与计量对象分开处理——"向通道要几次"改了措辞，次数一字未动。**与 InvestSkill 那一轮相反，第 2 条硬门槛这里没有内容**：`model memory`、`training-data estimates`、`Live data unavailable` 零命中，正文本来就写"只用简报里的数据、不知道就说不知道"，所以没有记忆逃生口要堵，也不为它新造 `Retrieval:` 枚举。方法论、Source Ledger 字段、`Reported/Calculated/Inference` 标注、停止规则与输出模板一字未改。

| 硬门槛 | 读到的是什么 |
|---|---|
| 来源可核验 | 仓库、作者、固定 commit `e0eaf58`；两次提交的单人小项目，无转载痕迹 |
| 许可可用 | MIT，`Copyright (c) 2026 Szymon Nycz`，原件随包 |
| 权限可控 | 原文要求 Agent 自行浏览（**已按清单改为委派**）；无凭据读取、无外传、无自动下单、无脚本（正文自陈 `no bundled scripts`） |
| 可审查 | 132 KB 全是 markdown：一份入口 + 八份附属文件；无混淆、无隐藏网络调用、无下载后执行 |
| 金融表达可校验 | 无收益/准确率承诺；`Deep` 的 Attractiveness score X/10 已补一句"衡量论点自洽度与结构特征，不预测价格或收益、不是买卖指令"；全文无仓位、无买卖动作、无目标价（`buy`/`sell`/position size/price target 零命中）；上游自带 disclaimer 已声明非投资建议 |
| 可适配 | 一条有边界的研究工作流：输入（代码或公司名 + 可选交易所）、输出（约 450 字快筛或最多 3000 字尽调）、失效行为（点名缺哪些字段并停止该字段下的分析）都写在正文里 |

**catalog 收录 1 颗，无排除**：`SKILL.md` 内部的 Quick / Deep 二选一是**这颗自己**在两条工作流之间做选择，不接管会话路由、不跨 Agent，因此不算 `china-stock-research-orchestrator` / `full-report` 那一类；输出是最终答复里的 markdown，不落报告文件、不出图，与 §7（报告链路已删除）和 §6.1（出图只走 `render_chart`）都不冲突。这条判断记在 `UPSTREAM.md`，免得下一个人误判成编排 skill。

**它填的缺口**：catalog 此前没有"带固定证据预算的两级工作流"——`buffett-investment-framework` 给的是 65 张方法卡，InvestSkill 给的是 28 个单点视角，china 那六颗是 A 股专题；这一颗给的是**从"要不要深挖"到"完整尽调"的一条路径**，并强制每条主张配可点开的链接（`verification` 标签）。使用者在"第一次看一只美股票""手上只有一个代码，需要判断值不值得花时间"这类任务里会去勾它。**重叠**：与 `buffett-investment-framework` 同在美股语境、都关心生意质量与负债，但那条按卡驱动分析、这一颗按"取数预算—简报—报告"三段与分诊驱动，不可互相替代。**新标签**：`peter-lynch`（zh/en 两套显示名同时补，`test/capital-config.test.mjs` 的显示名闸门守着）——前三颗没有以人物命名视角的先例（`perspective` 是泛化标签），用它是因为使用者真的会按"这是哪一种流派"来筛。

**A 股专项检查**：本条**不声称**适用于 A 股。SEC EDGAR / 10-K / 20-F / Form 4 / 13F、美元本位与 wash-sale 税务都不成立；正文点名的 aggregator（Yahoo Finance、MarketWatch、Macrotrends、StockAnalysis、GuruFocus、CompaniesMarketCap、Nasdaq）在本插件里只能由通用检索通道取，九个具名来源全是 A 股口径。因此 `us-stock` 标签与 `riskNote` 就是给使用者的口径提示，改写时另在 `SKILL.md` 加了"A 股会话要换成 A 股披露口径，由宿主取数通道决定"一句。

维护性：全仓两次提交（2026-06-23 建仓、2026-06-28 最后提交），至扫描日 105 天无提交；无 CI、无 release/tag。内容读起来像"按意图做完"而非"烂尾"（入口与八份附属文件彼此一致、无残片），但维护信号确实薄，因此 `watchlist` 而非 `experimental`（与 `china-stock-research-skills` 同一口径：内容可用、维护薄，启用前请使用者自行复核来源）。下次复查 2026-11-06（与另三颗同一节奏）。

## 追加（2026-10-11）：trading-skills 入驻

候选：[`marian2js/trading-skills`](https://github.com/marian2js/trading-skills)（MIT，19 颗 skill 按主题分 8 组：idea-discovery / market-context / trade-construction / position-oversight / review-learning / thesis-validation / workflows / live-trade）。固定 commit `f1ae7d48`（main，2026-03-16）。

结构上第一次遇到的是**深了一层**（与前一颗的"太浅"正好相反）：上游把 skill 放在 `skills/<domain>/<name>/SKILL.md`，而 provider 只枚举 skills 根的**直接子项**——`SELECTED_SKILL_SKILL_DIRS` 填 `skills` 等于发现 0 颗，症状与 peter-lynch 那一颗同族（卡片能勾、会话里永远不出现）。取舍是**在快照里平铺掉 `<domain>/`**：先逐颗核过正文链接（19 颗全部只指向自己目录内的 `references/` 与 `assets/`，无 `../`、无跨目录），平铺后一条都不破；上游 `catalog.json` 的 `path` / `docs_path` 与 `docs/examples/` 的路径随之变旧，两者都不进 catalog 也不进发布包，按"不进 catalog 的正文不动"原样保留。原分组逐颗记在 `UPSTREAM.md`，复核时仍能一次 `diff` 对上 commit。

**这一颗把危险换了形态，是本轮最要紧的一课**：全文 `web search` 零命中、记忆回填零命中（19 颗每颗都写"缺什么就点名缺、别编"，`example-mode` 指使用者自带的示例数据并要求标注，不是逃生口），但"谁去取数"这条边界以三种前两课没见过的写法出现：

- 自己调外部付费服务商：三颗 market-context 里的 `ask which supported provider` 与 18 处 `curl "…apikey=<FMP_API_KEY>"`，上游校验器甚至把它写成硬要求（`scripts/validate_repo.py:146`）；
- 在对话里认领凭据：`check whether the user … already shared usable access details`，以及 `etoro` 的 `Keys (request from the user on install)` 与逐步生成密钥的说明；
- 把计算推给能跑代码的宿主：`For agents that support code execution … skills/_lib/calculations.py`（三颗引用同一个共享 python 模块）。

所以 `test/selected-skills-content.test.mjs` 的 FORBIDDEN 从六条加到十二条，新增的六条按**词组族**扫（`curl`、`code execution`、`ask which supported provider`、`usable access details`、`fetch live`、`pair this skill`），在已有四颗快照上实测零命中——只加不减。§8.6 第 10 条的反证改打在新写法上：把 `catalyst-map` 或 `journal-pattern-analyzer` 换回原文必须红并点名。

| 硬门槛 | 读到的是什么 |
|---|---|
| 来源可核验 | 仓库、owner、固定 commit `f1ae7d48`；31 次提交全落在 2026-03-06 至 03-16 十天里，`VERSION` 是 `0.1.0-rc.1`，无 release/tag |
| 许可可用 | MIT 原件随包，但其 `Copyright (c) 2026` 一行**没有署名**（上游就是这么写的）；署名按仓库 owner 与 commit author 记为 `marian2js`，失真记进 `UPSTREAM.md` |
| 权限可控 | `etoro` 是券商 API 操作手册：真实下单端点、`IsBuy`/`Leverage`/`UnitsToDeduct`、按 `positionId` 平仓、末尾指到一个 MCP server —— 不进 catalog，且连发布包都不进（`.npmignore`）。收录的九颗无脚本执行、无凭据、无自己出网（已按清单改为委派） |
| 可审查 | 55 个文件约 460 KB 全是 markdown，另有两个 python 模块（上游的仓库校验与共享计算，留在 git、不进包、从不执行）；无混淆、无下载后执行 |
| 金融表达可校验 | 无收益或准确率承诺；`execution-plan-check`／`risk-reward-sanity-check`／`portfolio-concentration` 触及订单结构、盈亏比与 5%/10% 阈值，`post-trade-review` 的例子含"高冲击数据日减 25% 仓位"——逐条在 `riskNote` 写明是过程推演，本插件不下单、不改单、不给仓位数字；`journal-pattern-analyzer` 的胜率／期望值注明"是对已有日志的描述，不证明可持续优势" |
| 可适配 | 九颗都是单点检查：输入清单、判定档位词汇（`must-watch` / `fragile` / `too concentrated` 一类）、输出顺序与缺数据行为都写在正文里 |

**catalog 收录 9 颗、排除 10 颗**（2026-10-12 判据纠正后收回两颗，实际 11 颗进 catalog，见文末第五个追加节），四条排除线各自有先例：

| 排除 | 理由 |
|---|---|
| `etoro` | 券商执行面 + 对话内采集凭据 + 真实下单（§8.6 第 4、7 条）；不进包 |
| `position-sizing`、`position-management` | **当初排除，2026-10-12 收回。** 当时记的理由是"输出仓位数字（`Position Recommendation`、索取 account equity）与 hold／trim／close 决断"，与本记录上方的既有口径同源——那条口径把 §8.6 第 7 条读成了内容禁令。纠正后的判据：不收的是执行面（第 4 条），这两颗不取数、不碰凭据、不产文件，只在答复里算一个数、给一个建议，因此收录并由 `riskNote` 标注为方法推演 |
| `pre-trade-check`、`earnings-trade-prep`、`portfolio-risk-review`、`post-trade-debrief` | 上游自己的 "Workflow routing" 段按结果把会话分流到 11–12 颗子 skill，与 `china-stock-research-orchestrator`／`full-report` 同一条理由 |
| `earnings-preview`、`macro-event-analysis`、`market-regime-analysis` | 数据层写死付费服务商（见上），本插件没有那些凭据，也不为它们开第二条取数口子；改成委派会让那 10 份 provider 文档变死路，所以整颗留原文不改。`earnings-preview` 另与 InvestSkill 已收录的**同名**那颗撞车：provider 的启用集合只按 `name` 认，catalog 的 `name` 必须全局唯一（`test/persona.test.mjs` 钉着），不改上游身份 |

派生式钉法跟着上：`test/selected-skills-provider.test.mjs` 按「skills 根 − 排除清单」核对本颗的 9 条，`test/persona.test.mjs` 另把 `etoro`／`position-sizing`／`position-management`／`pre-trade-check` 明确断为不进 catalog——有人顺手加回去就会红并点名。

**它填的缺口**：此前 36 颗全是"投研"（生意质量、估值、披露文件、风险专题），没有一颗管**下单前的过程检查与下单后的复盘**。`capital-portfolio-review` 复盘的是组合层持仓、`capital-event-impact` 看的是单个事件影响，而"这笔想法还缺哪些证据""这个盈亏比结构自洽吗""这份计划在流动性能不能落地""这笔已经平掉的交易怎么复盘而不做事后诸葛亮"四件事此前没有对应模块。新标签 `trade-discipline`（中文显示名"交易纪律"、英文 "Trade discipline"）就是这条线，两套显示名同时补（`test/capital-config.test.mjs` 守着），市场口径继续用 `us-stock`。

**重叠**：`portfolio-concentration` 与 `capital-portfolio-review` 都看集中度——本插件那颗只读使用者在自选股面板里亲手标过的持仓与自报权重并要求逐项可复核，上游这颗吃用户贴进来的账户快照并给经验阈值，`riskNote` 写明以自报口径为准；`watchlist-review` 作用于自选清单条目（移出的是清单条目，不是持仓）；`catalyst-map` 与 `capital-event-impact` 相邻，但它排的是"一排事件的注意力"，后者查的是"单个事件的影响"。

**A 股专项检查**：本条**不声称**适用于 A 股。美股时段与盘前盘后、ES／期权／CFD 的合约乘数、FINRA／Fidelity／Schwab 口径的阈值、EURUSD 与 T+0 假设在 A 股都不成立（T+1、涨跌停、无盘后连续竞价这些规则上游完全不知道）。因此 `us-stock` 标签与逐条 `riskNote` 是给使用者的口径提示，仓位测算与持仓复核那两颗的止损、滑点与合约乘数假设同样按美股／境外写，改写时也没替它补 A 股假设。

维护性：31 次提交集中在十天内（2026-03-06 建仓、2026-03-16 最后提交），至扫描日 209 天无提交；16 stars / 6 forks，`0.1.0-rc.1` 未发 release，有 CI（两条 GitHub Actions）。内容读起来完整而非烂尾（每颗都带 will-not 清单、invalidation、输出顺序与小样本护栏，风格统一），但维护信号薄，因此 `watchlist`（与 china、peter-lynch 同一口径：内容可用、维护薄，启用前请使用者自行复核来源）。下次复查 2026-11-06（与另四颗同一节奏）。

## 追加（2026-10-11）：claude-for-financial-services-cn 入驻

候选：[`jwangkun/claude-for-financial-services-cn`](https://github.com/jwangkun/claude-for-financial-services-cn)（Apache-2.0，63 颗 A 股 skill 按六条业务线组织：证券研究 31、投行 10、私募 9、基金运营 6、财富管理 5、账户与合规 2；同一批正文又被打包成四个"角色 Agent"再抄一遍，所以仓里 `SKILL.md` 有 188 个路径、唯一 `name` 只有 58 个）。固定 commit `d7585ca0`（main，2026-09-14）。

结构上第一次遇到的是**并列六个 skills 根**：上游把正文放在 `vertical-plugins/<条线>/skills/`，provider 与五处反查只认"一颗快照一个根"。取舍是**只登记规范根那一条线**（`SELECTED_SKILL_SKILL_DIRS` 填 `vertical-plugins/china-finance/skills`），既不平铺（上一颗的做法）也不套层（再上一颗的做法），`src/` 一行不动。依据不是口味：那颗快照自己的 `CLAUDE.md` 写明 "Skills are authored in `vertical-plugins/china-finance/skills/`"，并规定 "Agent plugins bundle vendored copies of their skills. **Never edit bundled copies directly.**"。这一手同时避开了**同一仓库内部的撞名**——`fund-admin` 有五颗与 `china-finance` 同名而内容更薄（`china-accrual-schedule` 5799 vs 6563 字节），两个根一起登记必然撞上"启用集合只按 `name` 认"。

**这一颗的取数层是结构，不是句子**，是本轮最要紧的一课：63 份正文每一份都带
- 一节 `## Data Sources (Multi-Tier)` 按付费程度排开的服务商阶梯，顶层那档写着 `WIND_API_KEY`、`ak_` 密钥前缀与**密钥申请去处**，第二档带 `IFIND_AUTH_TOKEN`；
- 一段 ```python 围栏里的**伪工具调用**（`get_financials(ticker, "income", "annual")`、`ifind_get_stock_events(query)`、`ak.bond_zh_us_rate()`）——不是 shell 指令，模型却会照着这个形状去调一个运行时不存在的工具；
- 尾部统一的 `IFIND_DATA_SOURCE_MODE` 环境变量开关块，用对话正文决定"这次用哪家、取不到降级到哪家"；
- 把服务商名写死的引用格式与检查项（`Source: AkShare, [date]`、"All numbers sourced from …"）。

`test/selected-skills-content.test.mjs` 的 FORBIDDEN 因此从十二条加到二十三条，新增的一族在被改写的九份上实测命中、在既有五颗上零命中。**另一个教训是关于闸门本身**：服务商名不能按英文单词扫——这道测试把命中统计强制成 `gi`，`\bWind\b` 会撞上按"风电"写的 `sector-analysis`，`\bChoice\b` 会撞上把 choice 当普通词用的 `fact-check` 与 `tax-lens`。改按无歧义形状写（中文名"万得／慧博"、`Wind / Choice` 的阶梯形状、iFind 与 AkShare 这类不成词的品牌名）。一条误伤会把整条闸门逼瘦，那是 §9.7 同一族。

| 硬门槛 | 读到的是什么 |
|---|---|
| 来源可核验 | 仓库、owner、固定 commit `d7585ca0`；15 次提交（`jwangkun` 14 + `fintech-python-java` 1），2026-06-07 建仓、06-08/09 集中 10 次、此后沉寂三个月到本 commit；831 stars、3 open issue，无 release/tag |
| 许可可用 | **Apache-2.0**（本仓第一份非 MIT），`LICENSE` 原件随包，无 `NOTICE` 文件。署名三处不一致：`LICENSE:189` 是 `Copyright [2025] [jwangkun]`（Apache 说明要求填好后去掉方括号，上游没去）、六份 `plugin.json` 署 `Anthropic FSI China`、`README.md` 自称基于 [`anthropics/claude-for-financial-services`](https://github.com/anthropics/claude-for-financial-services) 适配（README 对照表称两者均 Apache 2.0）。三处都按现状记进 `UPSTREAM.md`，catalog `owner` 用仓库 owner |
| 权限可控 | 收录的九颗改写后无脚本执行、无凭据、无自己出网。四份可运行的取数服务端（`mcp-servers/`：万得／同花顺／AkShare／新闻，带密钥配置形态）**连发布包都不进**，与不发布券商执行面（`etoro`）同一条线 |
| 可审查 | 全树 267 个文件 / 3.1 MB：markdown 为主，另有 9 个 python（上游的服务端与生成校验脚本，留在 git、不进包、从不执行）与 4 份 cookbook YAML；无混淆、无下载后执行 |
| 金融表达可校验 | 无收益或准确率承诺；但报告模板以**投资评级五档（买入／增持／中性／减持／卖出）+ 目标价**收尾（`china-initiating-coverage`），`china-comps-analysis` 末尾有 `投资建议: [Buy / Hold / Sell]`，`china-sector-overview` 有 `Long / Short` 一览——档位表与模板按"不为口味改结论"原样保留，逐条在 `riskNote` 写明是推演练习；本插件没有券商接口，不据它们下单、不改单，也不代使用者执行 |
| 可适配 | 九颗都是单点研究方法：输入清单、阈值表、报告骨架与缺数据行为都写在正文里；正文没有跨目录链接（实测九份零 markdown 链接、零脚本引用），所以不改布局也不破链 |

**catalog 收录 9 颗、规范根排除 22 颗**（另五条款线 32 颗整条不登记；2026-10-12 判据纠正后收回三颗，实际 12 颗进 catalog、19 颗留材料，见文末第五个追加节），排除线与前几颗同源：

| 排除 | 理由 |
|---|---|
| `china-market-data` | 它本身就是那份服务商工具目录（`mcp__ifind__*` 一类工具名表 + 28 个"要什么数据用哪个工具"的配方 + `export IFIND_DATA_SOURCE_MODE=…`），自己不产出分析。收录等于在本插件既有取数协议之外再造一条取数路由（§8.6 第 1、6 条） |
| `china-skill-creator` | 元技能：教造新 `china-*` 正文，模板里硬编码那节服务商阶梯，还要 `python3 scripts/check-china.py`／`sync-china-skills.py` 校验同步（第 4、6 条） |
| `china-dcf-model`、`china-comps` | 前者是上游自标的 alias（"redirects to `china-dcf`"）；后者是同题材的薄一份且带**两份 frontmatter**（`L1-4` 与 `L37-40`） |
| `china-morning-note`、`china-thesis-tracker`、`china-idea-generation` | **当初排除，2026-10-12 收回。** 当时记的理由是"给买卖方向与仓位：Long／Short、`[Maintain / Add / Reduce / Exit]`、`Position sizing recommendations`"，与第五颗同一条误读。纠正后按执行面判据收录，正文只改取数层，晨会模板的【今日策略】、逻辑跟踪的决策档与选股清单的 Conviction 档原样保留 |
| `china-tax-loss-harvesting` | 仍不收，但理由改记在 §8.6 第 8 条市场口径：税损收割建立在 wash-sale 规则与应税账户成本基础上，A 股无此制度；`Full exit`／`Reduce position` 只是同一件事的表现形状 |
| 十一颗 `*-xls` / `*-xlsx` / `*-pptx` / `*-deck` / `*-model` / `*-recon` 一类 | 交付物是工作簿或 deck 文件（`File named: …_.xlsx`、`python3 scripts/generate_a_share_ppt.py`、"All cells formula-driven"），本插件没有 shell（§1.6）、报告链路已删除（§7）、出图只走 `render_chart`（§6.1） |
| `china-gl-recon`、`china-accrual-schedule`、`china-deal-screening` | 无明显违规，但对象是总账对账、计提计划与一级市场筛选，不是本插件使用者的研究场景 |
| 另五条业务线（投行 10、私募 9、基金运营 6、财富 5、账户 2） | 不在登记的根里；交付物多为机构流程文件（teaser／CIM／datapack／IC memo／净值对账），财富管理那条线直接给配置与投资建议 |

派生式钉法跟着上：`test/selected-skills-provider.test.mjs` 按「规范根目录 − 排除清单」核对本颗的 12 条，且**根路径从 `SELECTED_SKILL_SKILL_DIRS` 现取**（这颗的根不是 `<快照>/skills`，写死目录名就等于映射漂了要等装配才发现）；`test/persona.test.mjs` 另把 `china-market-data`／`china-skill-creator`／`china-dcf-model` 断为不进 catalog（执行面与 skill 生产线那一类，判据纠正后留下的就是这一类）；`test/selected-skills-content.test.mjs` 有一条**正向**断言钉住"被改写的十二份必须各带一行 Apache §4(b) 声明"——漏了不会有别的报错。§8.6 第 10 条的反证打在新族上：把 `china-dcf` 的 8-33 行换回上游原文，命中的全是本次新增的模式（`WIND_API_KEY`、密钥申请、`aifinmarket`、万得、`ifind_`、`get_financials(`、`IFIND_DATA_SOURCE_MODE`），既有十二条一条都不响。

**它填的缺口**：此前 45 颗里 A 股只有 spikeHongg 的六颗专题（财务健康、风险与催化剂、估值情景、战略转型、行业竞争、订单质量），没有一颗按**中国大陆卖方体例**写：业绩点评的超预期分解（实际／一致预期／上期三列 + beat/miss 档位）、财报公布前的三档情景与"要盯的三到五个指标"、A 股口径的可比倍数（动态／静态／TTM 三套 P/E 与 涨停流动性折价）、DCF 的中国参数档（十年期国债、A 股 ERP、25%／高新技术企业 15%）、按披露节奏排的催化剂日历（业绩预告→快报→正式报告、解禁、股东大会）、按报表科目与监管文书走的财务核查、以及首次覆盖的报告骨架。

**与既有能力的重叠**：`china-sector-overview` 与 `industry-competition-moat` 都看行业，前者按市场规模／政策／板块 KPI 铺全景、后者专攻竞争格局与护城河；`china-break-trace` 与 `risk-warning-catalysts` 都找风险，后者盯事件与催化剂、这颗盯科目勾稽与审计意见；`china-earnings-analysis` 与 InvestSkill 的 `10k-digest`／`stock-valuation` 同族但换成 A 股披露口径（扣非净利润、商誉、政府补助、涨跌停对盘后反应的影响）；`china-catalyst-calendar` 与第五颗的 `catalyst-map` 是同族的两份实现，一个 A 股披露节奏、一个美股事件窗口，`riskNote` 与标签把两者分开（这颗全部带 `a-share`，不新增标签）。

**A 股专项检查**：这是本仓第一份**整份按 A 股写**的快照，所以这一条这次反过来问的是"哪里不适用"。一是**一致预期取不到**：本插件的结构化数据面没有盈利预测／一致预期条目，唯一带预测形状字段的是东财研报条目上的本年／次年 EPS 预测（单家口径，不是市场共识）——按一致预期做的差异分解与 beat/miss 判定只能落到披露区间与自家基线上，正文改写时已如实写明，不留"用历史增速推一个预期"的逃生口。二是**卖方投顾边界**：五档评级、目标价与"重点标的"是本插件明确不提供的东西，收录只为呈现流程，`riskNote` 逐条标注为推演练习。三是这些正文假定使用者能接入万得／同花顺级别的付费数据，而本插件的取数面与之不对应；改写消掉的是"自己去取"的指令，不是它的分析框架。

维护性：15 次提交里 10 次落在建仓后两天，之后三个月无动作，直到本 commit 修 AkShare 服务端返回空数组的 bug；831 stars、3 open issue、无 release/tag。内容读起来成体系（六十三条口径统一、术语表与板块 KPI 表是内行写的），但维护方式是"一次性把 Anthropic 的仓库搬到 A 股语境"，因此 `watchlist`（与 china、peter-lynch、trading 同一口径）。下次复查 2026-11-08。

打包侧的实测结果：整包 291 → 356 个文件（净增 65：63 份 `SKILL.md` + 上游 `LICENSE` + 本仓写的 `UPSTREAM.md`），未压缩 3.49 → 3.98 MiB、下载 1.15 → 1.31 MiB。进包的是六十三份正文（含未登记的另五条款线 32 份，作为"为什么不收这 54 颗"的可审查材料），被挡在包外的是四份取数服务端、`agent-plugins/` 副本、cookbooks、CodeBuddy 材料、上游脚本与每条款线的 `.mcp.json`／manifest。`.npmignore` 的规则**只能写裸名**：反向断言丢掉以 `/` 开头或带内部斜杠的规则，而目录规则按任意路径段匹配——写一条 `skills/` 就能把六十三份正文全挡掉。

## 追加（2026-10-12）：判据纠正，收回被误挡的五颗

这一节不改上游，改的是**本仓自己写下的判据**，因此记在同一份记录里：前三轮（第五颗、第六颗，以及第一轮的观察名单）都按同一句话排除了内容——「评级、买卖动作和仓位决策属于明确冲突，不能直接集成」。这句话的来源是 `docs/dev/selected-skills.md` §8.6 第 7 条，而那条把两件事写进了一句：「给仓位、买卖动作的段落必须在 `riskNote` 写明是推演练习——本项目不提供投资建议」。

纠正后的口径：**本插件不收的是执行面**——没有券商接口、不发布能下单的东西（第 4 条；`etoro` 与第六颗那四份 `mcp-servers/` 至今按这条连发布包都不进）。正文给出方向、评级、目标价、止损位或仓位数字**不是排除理由**，第 7 条对它们只要求一句 `riskNote`：那是方法推演、本插件不据它执行。真要因"给动作"不收的那类走第 8 条市场口径。

**收回 5 颗（catalog 54 → 59）**：第六颗的 `china-morning-note`、`china-thesis-tracker`、`china-idea-generation`（12 进 / 19 留），第五颗的 `position-sizing`、`position-management`（11 进 / 8 留）。`china-tax-loss-harvesting` 仍不收，理由从"写了 `Full exit`"改成 wash-sale 与应税账户成本基础在 A 股不成立。

**实测改写量**（`git diff --no-index` 对所钉 commit 现算，不是估计）：第六颗规范根 12 份 `SKILL.md`、37 段、+250 / −333（其中本轮三颗 9 段、+98 / −133）；第五颗 10 份 `SKILL.md` + 3 份 `references/calculation-helpers.md`、20 段、+46 / −20。第六颗这十二份里的 ```python 围栏 18 处 → 0，`IFIND_DATA_SOURCE_MODE` 开关块 12 颗全部删净（整颗快照仍有 173 个文件带着该变量名——不进可选清单的正文不改也不扫）。

**这一轮最脆的一类是连锁**：口径一改，先前为了那句口径写进正文与卡片的话就成假话，而**没有任何测试会红**。具体是八份正文里同一句 `Next Skill` 前置条件（"the ones this plugin deliberately does not offer — placing orders, **setting position size**"）、第六颗三份尾块与 catalog 四条 `riskNote` 的"也不给仓位数字"、`THIRD_PARTY_NOTICES.md` 的"本插件明确不提供投资评级、目标价与仓位建议"。全部改成执行面口径（不据它下单、不改单、也不替你执行任何一笔）。留下的"不构成投资建议"只有两类，且都仍为真：图表页脚（就那张图而言）与样例报告自己的页内声明。

**顺序是设计好的**：先加 catalog 条目、再改正文——内容闸门按 catalog 现算扫描面（`test/selected-skills-content.test.mjs:75-88`），条目没进去之前改写无人看守。反过来也成立：`position-sizing` 的违规形状分两处（`SKILL.md:52` 与 `references/calculation-helpers.md:3`），扫描面含附属文件这条在第四颗就立过，本轮反证照两处一起验。另一处只有人工能守的是 `position-management:51`：那句原意是护栏（别自己堆数据），闸门只认 `fetch live` 与 `pair this skill` 两个词形，改完必须逐句核对两层意思都还在。

**判据文字落点**：§8.6 第 7 条（拆开并写明"别把这条读成内容禁令"+ 记下来两轮就是这么误读的）、`CONTRIBUTING.md` 第 8 条与开篇提示、`README.md` 的免责声明（按 Owner 定的字面：不提供金融服务或投资建议 → **不提供代交易服务**）。`AGENTS.md` 的 ⛔ 一行本来写的就是"不带执行面"，未动。

**观察名单重评**：`yaorenliang/trading-agents-skill` 原先按这句误读钉在"只观察"，前提已解除；它此前只读过 README，真要评估得 clone 后逐文件读（本轮不做，一轮一个关注点）。

验证：四组定向闸门 + 反证 + `npm test` 全绿（2.7.6）。

## 追加（2026-10-12）：第七颗 GAJETOso/financeskills 入驻，以及"允许脚本"这条政策为什么本轮不落

Owner 给的三条判据是：是否符合本项目合规性、是否填补 skill 空白、优先 A 股适用性高的（美股那些必须真的填补），并加了一条资产类别边界（本项目不涉及比特币之类）。这一节按这三条给结论，全部数字都在所钉 commit 的 clone 上现算。

**候选画像。** MIT，48 颗，`skills/<name>/SKILL.md` 一层扁平，正文 77–108 行的统一模板（Initial Assessment → Framework → Technical Steps → Output Format → Scripts → References → Assets → Related Skills），`references/` 83 份平均 29 行，`assets/` 只有 6 份。上游 `README.md:5` 自述服务对象是 accountants（"for accountants in oil & gas, banking, insurance, and corporate finance"）——**这一句决定了本轮的取舍**：本插件的使用者是做证券研究的人，读别人披露的账，不是把账做对的人。46 次提交（2026-05-01 至 2026-10-01），版本文件停在 v1.0.1，唯一持续的活动是按月刷新评测基线。

**合规性：闸门几乎不响，因为这一批压根没有取数层。** 把 `test/selected-skills-content.test.mjs` 那 23 条 FORBIDDEN 的原文正则套到全 48 颗的 185 份 `.md` 上，命中 **2 处**，且都在本轮不收的 `automated-reconciliation/references/fuzzy-logic.md` 与 `nlp-earnings-sentiment/references/finbert-guide.md`（两处 ```python 围栏）。没有服务商阶梯、没有凭据名、没有伪工具调用、没有"向用户点选付费服务商"。**违规形状换了一族**：43 份正文写着 `Run \`python3 scripts/calculate.py\` to self-test`，而同文件里带着"没有 shell 时读哪份附属文件"退路句的是 **0 份**——按现行 §8.6 第 4 条与闸门 `NEEDS_FALLBACK`（`test/selected-skills-content.test.mjs:71-73`），这 43 份一份都过不去。

**结构上是七颗里最干净的一份：四类结构改动一处都不需要。** 48 份 frontmatter 的 `name` 与目录名逐颗一致（前五颗为这件事补过 `name`）、`description` 齐备、175 条相对链接全部指向存在的文件、`../` 跨目录引用 **0 处**（因此上游那份 924 KB 的 `standards/` 与 2.2 MB 的 `tools/` 整个不复制进来也不会破任何一条链接）、与现有 59 颗零撞名。`SELECTED_SKILL_SKILL_DIRS` 因此就是 `skills` 一个词。

**填补什么空白：按双语词表在已收录 59 颗的正文上现算。** 宇宙取的是 catalog 条目目录下的全部 `.md`（与闸门同一口径，103 份）。**0 命中**的有六项：EV→股权价值 bridge、敏感性网格与 mid-year convention、三表勾稽与 revolver 循环、PD / LGD / ECL 三阶段减值、Benford 首位数字。**1 命中**的有五项：先例交易、控制权溢价、DuPont、CET1 / RWA / LCR（只在 `sector-analysis` 顺带一次）、IBNR / 综合成本率（只在 `peter-lynch-skill` 顺带一次）。**2 命中**：CAPM 与 β 去杠杆——都被点名过，都没有估法。**已经覆盖所以不收**：现金周期 7 命中（`working-capital-analysis` 判重复）、正常化 14 命中、无风险利率 7 命中、比率与 VaR 各有更厚的既有颗。⚠ 这一条差点犯下的错：**只用英文词表核对会把中文写的 A 股正文误判成空白**（例如"折现率""营运资本""综合成本率"在 `china-*` 那十二份里是用中文写的），第一版核对因此报出过 80 份命中"WACC"这种荒谬数——修正成中英两套同时算，并且把宇宙限定在已收录条目之后才是上面的数。

**A 股适用性：整体低，所以只取可迁移的方法层。** 这批按 IFRS / US GAAP 写，原生长不出"A 股专用"的 skill。8 颗里对 A 股最有用的恰恰是那些**披露结构相同而准则号不同**的：EV→股权 bridge（参股公司与少数股东权益是 A 股合并报表的常态难题）、三阶段减值（CAS 22 已对齐 IFRS 9，但年报只给阶段余额不给 PD / LGD——这颗因此是"读别人的减值合不合理"而非"自己算一个准备数"）、保险准备金与综合成本率、银行资本与流动性。数字基准确实是美国的三颗（`wacc-computation` 用 10 年期美债与美股 ERP、`company-valuation` 用控制权溢价与先例交易惯例、`credit-analysis` 用国际公司贷款阈值）套 `us-stock` 标签；其余五颗是国际准则，标成"美股专用"反而会把 A 股能用的东西藏起来，口径差异写进 `riskNote`。**这一轮没有给 A 股找到新东西，这条结论本身就记在这里**：下一颗如果要按"A 股优先"找，得往境内作者写的卖方 / 买方流程材料里找，而不是在 IFRS 系里再筛一遍。

**`banking-compliance` 与 `forensic-accounting` 是带风险收的两颗（Owner 选"带风险标注全收"）。** 前者正文的资本阈值是巴塞尔原值 4.5% / 6% / 8%，而境内适用《商业银行资本管理办法》：核心一级最低 5%，之上还有储备资本与系统重要性附加，资本定义与风险权重另有表——**正文一个数字没改**（§8.6：不改阈值与结论），风险全部改在 `riskNote` 上说明"比率形状可用、数字只能当境外参照，不能当境内合规判断"。后者除首位数字检验可以只对公开报表做以外，主要路径（银行流水、员工与供应商信息比对、企业内网 ERP）需要使用者自己提供账务明细；`SKILL.md:29` 那句本意是护栏，但点名了 `web_fetch`（本插件根角色没有这颗工具）并承诺了"specific API integrations"（本插件不提供企业接口集成），两处都改写到位且保留护栏含义——这是本轮最容易"过了闸门却改坏内容"的一处，与上一轮 `position-management:51` 同一族。

**实测改写量**（`diff -r` 对所钉 commit + `git diff --no-index --numstat` 现算）：8 份 `SKILL.md` + `three-statement-modeling/references/model-checks.md` + `wacc-computation/assets/wacc-memo-template.md`，**10 份文件 / 16 段 / +16 −16**，其余 38 颗逐字节相同。16 段的构成：脚本指令 8 段、"用代码算"4 段、`references/` 里的写代码指令 1 段、产出物模板的假出处脚注 1 段、点名宿主工具那 2 行、`## Related Skills` 一个都没动。

**"允许 skill 自带脚本"这条政策本轮不落，但把落它需要的东西全部备好了。** 政策是 Owner 2026-10-12 给的（允许自带 scripts，需要仔细 review 代码风险；未来会有能执行 shell 的子 Agent）。**代码风险已经审完并写进 `selected-skills/financeskills/UPSTREAM.md` 的"脚本审计"一节**：43 份 / 2002 行，顶层 import 只有 `__future__` `copy` `dataclasses` `itertools` `math` `random` `statistics` `typing`（全标准库，宿主不需要 pip 装任何东西），零网络、零文件读写、零 subprocess / eval、零 `os.environ` 与凭据读取，`__main__` 是 `assert` 自检；38 份与上游 `MANIFEST.sha256` 哈希一致、0 份不符，5 份不在清单（上游自述"judgment-only by design"，而那 5 份正是个人理财那批，本轮不收）。**不落的理由是一轮一个关注点**：政策落地要同时动三处——§8.6 第 4 条（把"没有一句话指挥 Agent 去跑它"换成"执行一律委派给有 shell 的角色"）、闸门 `NEEDS_FALLBACK`（现认的退路句是 `skip the router`，要认新的委派形状）、这颗的 `.npmignore`（现在挡 `scripts`，翻案要放开）。三处一起动会把"收录 8 颗"和"改运行时纪律"混进同一轮，而后者需要真机验证：`python3` 在本机是 3.14，Windows 桌面端不保证存在（§1.6 记录了 pwsh 侧只量到一半），宿主那三条 python 通道也都不在这条路上。本轮因此按现行口径执行（脚本不进包、指令删净），并把"翻案需要改哪三处 + 实测依据"整段留在 UPSTREAM.md，将来那一轮是一次改动而不是重审一遍代码。顺带存到一个有用事实：DSH 的 `skill` 工具会在结果里给一行 `<skill_resources>` 与 **Base directory for this skill: <绝对路径>**（本仓真实会话里取到两例），所以脚本路径其实可解析——真正的约束从来是"谁来执行"，不是"能不能定位"。

**收录数字**：catalog **59 → 67**；快照内共 48 颗；六颗快照的上游 skill 总数 125 → **173**。不进可选清单的 40 颗照 InvestSkill 先例随包保留为可审查材料（provider 的 `list()` / `get()` 与 `/capital-skills` 旁路都按 catalog 闭集过滤），`evals`（896 KB 评测夹具）与 `scripts`（344 KB）连发布包都不进。**许可的差别记清楚**：本颗 MIT，被改写的 10 份正文**不带**改动声明行——那是第六颗（Apache-2.0 §4(b)）的许可义务，不是本仓惯例，`test/selected-skills-content.test.mjs:132-143` 那条正向断言按 `repository` 钉死只问那一族；下一份若又是 MIT 而有人"照格式"给正文加声明行，反而是把特殊义务伪装成通用规则。

验证：四组定向闸门 + 三条反证 + `npm pack --dry-run` 抽查 + `npm test` 全绿（2.7.8）。

## 追加（2026-10-13）：三颗候选的评估，以及"违规形状"第六次搬家

Owner 这一轮给的仍是那三条判据（合规性、是否填补空白、A 股优先且美股必须真填补）加资产类别边界。三颗都在所钉 commit 上 clone 后逐文件读，所有数字现算。结论：**一颗拒于许可、一颗拒于架构、一颗整颗不收但隔壁两份口径值得单独拿**——最后这第三种形状是本仓以前没遇到过的，它改变了"接入"这一步的产出物。

**① [`ychowdhrey/skills`](https://github.com/ychowdhrey/skills) 里的 `stock-analysis`——拒，卡在许可这一条，而这条改不掉。** 它是 `anthropics/skills`（18 万星）的 fork，作者只加了这一个 commit（`120f896`，2026-04-17），仓根**没有 LICENSE**；同仓 18 颗 skill 里 **16 颗各自带 Apache-2.0 的 `LICENSE.txt`**，不带的那两颗是 `doc-coauthoring`（Anthropic 自己漏的）与这颗。上游 README 那句 "Many skills in this repo are open source (Apache 2.0)" 覆盖的是 Anthropic 的示例集，**够不到 fork 作者后加的一颗**；fork 自己的 `.claude-plugin/marketplace.json` 也没有把 `stock-analysis` 登记进去（作者自己都未把它算进那份 Apache 集）。这颗 9 份文件里授权字样零命中（`moat-framework.md:59` 那个 "Licenses" 是讲牌照护城河）。GitHub 对两个仓都报 `license: null`。**无授权 = 默认保留所有权利**，本仓既不能改它正文、更不能随 npm 包再分发——这是 §8.6 十条里唯一一条**不能靠改写解决**的。顺带两条实测：这颗**上游自己就是坏的**，正文按 `references/` `assets/` `scripts/` 三种子目录写引用而 9 份文件全平铺同层，**8/8 引用是死链**（连 Claude Code 里它也读不到自己的 7 份 references，说明它从未在真实运行时跑通过）；空白核对下来真正空的只有 behavioral 那一族（ownership bias / 禀赋效应 / zero-shares 测试、向使用者索取的书面卖出触发、回本偏误、fact–projection–hope 三分并据此封顶仓位——四组概念在已收录 67 颗的 133 份正文里全 **0 命中**），其余 7 份与既有 12 颗重叠（仓位那一族最近邻是已收的 `position-ladder`，它有 entry ladder / floor-ceiling / trim-re-add / thesis-break gate，更厚）。A 股适用性 **0**：SEC 10-K/10-Q/8-K、non-GAAP + SBC、Macrotrends / Wisesheets / Finviz / GF Value、AWS/Azure/GCP 打包威胁，例子全是 Visa / MSFT / Costco / GOOGL / AAPL / NVDA / CRWD / FCX / CVX / JPM。**处置**：不收；向作者请求补 LICENSE 是公开跨仓库动作，等 Owner 明确点头才起草。

**② [`RKiding/Awesome-finance-skills`](https://github.com/RKiding/Awesome-finance-skills)——拒，卡在架构。** Apache-2.0 且 `LICENSE` 附录已填 `Copyright 2026 RKiding`，**许可这一关它是过的**（3067 星，2026-01-31 建、03-29 最后提交，单一作者 18 commit）。它不是一堆 skill，是**一整套应用套了 skill 的目录形状**：10 颗目录的 `SKILL.md` 各 1–2 KB，背后 python 运行时 **1.08 MB / 139 个 `.py`（唯一内容只有 59 份——每颗都 vendored 一份同样的 runtime）**，predictor 还带一份 1.28 MB 的 `.pt` 权重；仓根**无 `requirements.txt` / `pyproject.toml`**，`torch` / `transformers` / `sentence-transformers` / `scikit-learn` / `akshare` / `yfinance` / `agno` / `loguru` 全部只写在散文里。**第 4 条不可删**（主措辞是 `Use \`scripts/news_tools.py\` via \`NewsNowTools\``，24 行 `scripts/*.py` 引用；删掉执行指令就没有正文剩下）、**第 1 条四个第二取数通道**（EastMoney `push2his`、`newsnow.busiyi.world`、`gamma-api.polymarket.com`、`s.jina.ai` / `r.jina.ai`、`dashscope.aliyuncs.com` 与 `api.z.ai` 两颗**第三方 LLM 端点**——它把使用者文本发给外部模型，`api_key` 出现 143 处 / 13 份文件）、**第 5 条与 `AGENTS.md` §7**（`-logic-visualizer` 落 `chain_visual.html`、`-reporter` 是 Plan→Write→Edit→Chart 的研报生成加 `md_to_html.py`，正是 2026-09-17 删掉的那条链路）、第 6 条（`-signal-tracker` 正文自己写着 "currently a pattern extracted from FinAgent… in a future refactor it should be a standalone utility class"——上游自认的残片）。**代码风险审计（Owner 点名的那一项）**：干净的一面是全仓 `.py` 无 `subprocess` / `os.system` / `socket` / `httpx` / `yaml.load` / `eval` / `exec`、无硬编码密钥，仓内那颗 `.pt` 的 pickle 载荷只有 365 字节、符号只有 `_rebuild_tensor_v2` / `FloatStorage` 一类 torch 重建器，**无危险 GLOBAL opcode**；真风险两处且可核对——文档那句 "We use `weights_only=True`" **只对一半**（5 个 `torch.load` 只有 `kronos_predictor.py:79` 带 guarded，同一 `try` 的 `except` 分支 `:83` 与三处 vendored 的 `evaluation.py:39` 都是裸加载），选权重用 `max(glob("kronos_news_*.pt"), key=os.path.getctime)`（丢一个文件进去就能被加载，且 `getctime` 在 Windows/WSL 上本就不可靠），再加 README 那句 "Or depend on the base model (**automatically downloaded**)"——**运行期从网络取权重才是真供应链面**。空白核对：情绪 24 颗已有、信号演化 25 颗已有、传导链路 5 颗已有，真空白的五项（Kronos 时序、FinBERT、Polymarket、Draw.io、本地 RAG）**恰恰是因为我们架构里没有"跑模型 / 直连第三方 API"这条通道**——空白是设计的后果不是遗漏，一颗 `SKILL.md` 填不了它。A 股适用性是三颗候选里唯一原生的一条（`600519`、财联社 / 华尔街见闻 / 雪球 / 微博 / 知乎 / 百度 / 头条 / 澎湃，EastMoney 直连并"自动检测代理失败回退直连"），它那张 14 个中文信源的 `references/sources.md` 对照本插件 `docs/dev/web-retriever.md` §4.1 的九个具名来源，**是唯一现在就能用的事实增量**（本轮未做）。**真正的收获是 Kronos 本身**（`shiyu-coder/Kronos`，MIT，4 万星，45+ 交易所预训练的 K 线基础模型）：它的家是 `AGENTS.md` §1 里预留未启用的 `data_analyst`，不是某颗 skill——已按调研留档写进 `docs/design/data-analyst-architecture.md` 新增的 §3.4 与 §13。另记一处闸门脆弱（与本颗收不收无关）：`/\bAkShare\b|\bAkSource\b/` 这条模式**自己不带 `i`**，这次命中纯粹因为 `test/selected-skills-content.test.mjs:115` 把匹配强制成 `'gi'`；按 §9.7 的判据（规则不许押在测试的偶然属性上）`i` 应当写进模式本身，本轮未改。

**③ [`Howard-Jerry/quant-agent-skills`](https://github.com/Howard-Jerry/quant-agent-skills)——整颗不收，但两份口径单独拿。** MIT（`Copyright (c) 2026 Jerry Wang`，附录已填），3067 星以下的小仓：2 星、**5 次提交全落在 2026-08-05 同一天**、之后无提交、0 issue，作者声明真身是本地私有 SSoT、经 `scripts/publish.sh` 同步、数据层要到 v1.1 才开源，`stock-research` 自报 `version: 2.46.0`（那版本号是私有系统的历史）。三颗都自述"编排器 / orchestrator"（`concept-research` / `industry-research` / `stock-research`），frontmatter 声明 `allowed-tools: Bash, Read, Write, Edit, EnterWorktree, ExitWorktree`（后两枚是 Claude Code 专属）。**决定性的一条不是措辞，是本体**：三颗入口点名的本地路径 **10 / 32 / 16 个，公开版一个都不存在**（`trade_history.json`、`portfolio_state.json`、`research_verdicts.json`、`scripts/generate_bridge.py`、`auto_research/quality_gate_check.py`、`sleeve/concept_heat.py`…）。闸门 132 处命中的分布把结构说清了：三颗 `SKILL.md` **1 处**、`steps/*` **109 处**、`agents/*` 9 处、**我们取用的那族纯方法论 1 处**、`detailed-workflows.md` 10 处——命中族是 71 个 ```python 围栏、40 个 `get_*(` 伪调用、17 个 AkShare、`ak.stock_news_em(`、慧博。**⚠ 又一次"形状搬家"**：26 条在三颗入口上只响 1 次，而 `python auto_research/quality_gate_check.py <research_dir>` 这类指令一条都不认（第 10 条只认 `node|bash scripts/`）——"绿"在这颗上完全不能当"合规"读。还有一个架构级不兼容值得单独记：它整套结论都建立在**持有者的成交账本**上（`Ledger reality`、`BLOCKED_LEDGER_MISSING_TRADE`、`current_new_money_pct`），而本插件从不持有使用者的账本，只有自选股（观察清单）。
**取用的两份**：`ah-overlay.md` 与 `adr-hk-overlay.md`——同一张表里唯二 **0 代码围栏（只有 ```text）、0 私有路径、0 跨文件链接**的文件，核心那句是公司层只研究一次、价差与税制才是变量，收尾一句 *Never upgrade a weak company-level EV just because one line is cheaper*。空白实测（catalog 现算 67 颗 / 133 份正文，中英两套词表）：**A/H 溢价与选线 0 命中**、预期差 `delta_class` 0 命中、动作语义枚举 0 命中、check-first 0 命中、题材叙事生命周期 0 命中、境内券商评级偏多 0 命中；**而我上一轮凭印象以为也空白的三条，其实已有覆盖**（ADR/HFCAA/20-F 4 颗、归母与少数股东 6 颗、解禁锁定期 2 颗）——更正记在这里，下一个人不必再猜一遍。**闸门因此加四条**（二十六 → 三十）：`{{QUANT_ROOT}}` / `PYTHONPATH=` / `data_platform|auto_research|sleeve/*.py`、`Use|Run \`?scripts/`、`collect-data`、五文件与三地沉淀。加之前逐条量过误伤面（现有 136 份正文全零命中），并且**明确不加**更宽的那条形 `python3? <带路径的 .py>`——第一颗的 `python3 scripts/framework.py` 是 `NEEDS_FALLBACK` 刻意放行的，挡掉等于削掉既有设计（§9.7：闸门误伤过一次，下一个人就会把它整体削掉）。反证按这颗的真实漂移方向做：把 `markets/a-share.md` 与 `stock-research/SKILL.md` 放回随包目录，三条新模式立刻点名红（不是改几句措辞，是把整颗编排器搬进来）。
**留在观察名单的四条**（都住在不能进 catalog 的编排器正文里，要接必须另起一轮重写）：预期差闸门 `delta_class=BEAT|IN_LINE|MISS|AMBIGUOUS` 加"公告披露不是叙事加速的充分条件、`IN_LINE` 不得升级入场线与仓位"；概念/题材叙事生命周期（形成→加速→扩散→退潮 + 真龙/假龙，且本插件**数据面已就绪**：`index_catalog` 概念板块目录、`index_constituents`、`eastmoney_sector_rotation`、`eastmoney_cashflow_rotation`）；check-first（同一标的先读已有结论，再让使用者在增量刷新 / 重做 / 只读复核里选）；境内券商评级结构性偏多与 A 股新股首日无涨跌幅 5 日。另有一条**数据面线索**（不是 skill 问题）：它的 `report_rc` 对应 Tushare 的券商研报预测条目（前瞻 EPS / 目标价 / 上调下调方向），本插件结构化面没有这一族，唯一的一致预期是 `web_retriever` 的 `ths_eps_forecast`。

验证：三颗候选各自的 clone + 逐文件读、`grep`/`node` 现算命中与空白（可疑的 0 都用原始 `grep` 反证过至少一次）、`.pt` 用 `zipfile` 拆开看 pickle 符号表、`ast` 解析 `score_investment.py`；入驻那颗另过 30 条定向闸门 + 反证 + `npm pack --dry-run` 抽查 + `npm test` 全绿。

本扫描是公开信息桌面审阅（InvestSkill、peter-lynch-skill、trading-skills、claude-for-financial-services-cn、financeskills、2026-10-13 那三颗 六节，以及 2026-10-12 判据纠正那次除外：那几节都在所钉 commit 上 clone 后逐文件读过，脚本还逐份审过依赖与 IO 形状），不是完整安全审计、法律意见、作者背书或金融方法有效性证明。入驻前仍需固定 commit，静态检查完整文件树，逐一复核许可与引用，并运行隔离评测。
