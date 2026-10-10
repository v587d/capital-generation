# 社区金融 Skill 候选扫描（2026-10）

**扫描日期：**2026-10-08  
**目的：**寻找可适配 Capital Generation 的外部能力，不代表采用、背书或运行这些项目。  
**审查范围：**公开仓库 README、代表性 `SKILL.md`、引用/方法文件、许可证和 GitHub API 元数据。没有 clone 或执行任何外部脚本，也没有核实其实际金融结论。

## 结论

当前固定版本都进入默认关闭的显式实验 catalog，设置页按能力标签展示和筛选；`status` 是记在 catalog 与本文里的成熟度/维护风险信号，不在设置页显示，也不代表推荐或背书：

1. [`spikeHongg/china-stock-research-skills`](https://github.com/spikeHongg/china-stock-research-skills)：内容可作为 A 股财务健康、风险监控、估值、战略转型、行业竞争和订单质量的实验模块；截至 2026-10-08，最后提交为 2026-03-09，状态为 `watchlist`，用户可按模块自行开启。其 orchestrator 仍因与 Capital 路由冲突排除。
2. [`finterm-ai/investment-skills`](https://github.com/finterm-ai/investment-skills)：最后提交为 2026-07-22，状态为 `experimental`，可作为 Buffett-inspired 商业分析、现金流、估值和风险框架显式实验，仍默认关闭。它主要源于美股/伯克希尔语境，不能直接当作 A 股规则。
3. [`yennanliu/InvestSkill`](https://github.com/yennanliu/InvestSkill)：**2026-10-10 追加入驻**，状态 `experimental`，28 个美股模块进 catalog、默认关闭。判断依据与逐条排除见下面的追加节。

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
4. 2026-11-06 重新检查三颗快照的 release/commit、许可证、依赖与问题处理；上游变化只触发复审，不自动更新本地能力。

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

本扫描是公开信息桌面审阅（InvestSkill 那一节除外：那一节 clone 后逐文件读过），不是完整安全审计、法律意见、作者背书或金融方法有效性证明。入驻前仍需固定 commit，静态检查完整文件树，逐一复核许可与引用，并运行隔离评测。
