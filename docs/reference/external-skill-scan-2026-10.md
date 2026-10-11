# 社区金融 Skill 候选扫描（2026-10）

**扫描日期：**2026-10-08  
**目的：**寻找可适配 Capital Generation 的外部能力，不代表采用、背书或运行这些项目。  
**审查范围：**公开仓库 README、代表性 `SKILL.md`、引用/方法文件、许可证和 GitHub API 元数据。没有 clone 或执行任何外部脚本，也没有核实其实际金融结论。

## 结论

当前固定版本都进入默认关闭的显式实验 catalog，设置页按能力标签展示和筛选；`status` 是记在 catalog 与本文里的成熟度/维护风险信号，不在设置页显示，也不代表推荐或背书：

1. [`spikeHongg/china-stock-research-skills`](https://github.com/spikeHongg/china-stock-research-skills)：内容可作为 A 股财务健康、风险监控、估值、战略转型、行业竞争和订单质量的实验模块；截至 2026-10-08，最后提交为 2026-03-09，状态为 `watchlist`，用户可按模块自行开启。其 orchestrator 仍因与 Capital 路由冲突排除。
2. [`finterm-ai/investment-skills`](https://github.com/finterm-ai/investment-skills)：最后提交为 2026-07-22，状态为 `experimental`，可作为 Buffett-inspired 商业分析、现金流、估值和风险框架显式实验，仍默认关闭。它主要源于美股/伯克希尔语境，不能直接当作 A 股规则。
3. [`yennanliu/InvestSkill`](https://github.com/yennanliu/InvestSkill)：**2026-10-10 追加入驻**，状态 `experimental`，28 个美股模块进 catalog、默认关闭。判断依据与逐条排除见下面的追加节。
4. [`DjNero11/peter-lynch-skill`](https://github.com/DjNero11/peter-lynch-skill)：**2026-10-11 追加入驻**，状态 `watchlist`，一颗个股研究工作流（Quick 快筛 + Deep 尽调）进 catalog、默认关闭。它带来本仓第一颗**自带完整证据预算与引用契约**的工作流，也第一次遇到"`SKILL.md` 住在仓库根"的结构。判断依据与逐条改写见文末第二个追加节。

所有条目都需要用户自行判断是否适合当前任务；Owner 会继续寻找合适的社区项目，也欢迎通过 PR 提交新的固定快照和标签元数据。

观察名单：[`yaorenliang/trading-agents-skill`](https://github.com/yaorenliang/trading-agents-skill)，仅评估多空相互反驳、延迟复盘等可拆分 workflow；评级、买卖动作和仓位决策属于明确冲突，不能直接集成。

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
4. 2026-11-06 重新检查四颗快照的 release/commit、许可证、依赖与问题处理；上游变化只触发复审，不自动更新本地能力。

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

本扫描是公开信息桌面审阅（InvestSkill 与 peter-lynch-skill 两节除外：那两节 clone 后逐文件读过），不是完整安全审计、法律意见、作者背书或金融方法有效性证明。入驻前仍需固定 commit，静态检查完整文件树，逐一复核许可与引用，并运行隔离评测。
