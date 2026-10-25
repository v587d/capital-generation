# 精选 Skill 路由规划表（68 颗，review 用）

> 本表由 `selected-skills/routing.js` 生成，不是第二份真相；角色/触发条件改动以 `routing.js` 为准。
> 生成规则：`market` 取 catalog 的 A 股/美股标签（都没有则为 global）；`stage`、`methods`、`requires`、
> `overlaps`、`canonicalFor` 与 `useWhen` 由本轮逐颗规划；`useWhen.en` 与卡片显示同源，不在此表展开。
> 角色归属是**执行角色**：主 Agent 主导研究/决策/写作，数据分析主导计算/建模/统计，检索取证主导文档深读/核验；
> 多角色只给“同一方法真的由两边执行”的条目（17 颗）。

## 角色分布

| 角色 | primaryRole | roles 成员（含多角色） |
|---|---:|---:|
| 主 Agent | 29 | 37 |
| 数据分析 | 36 | 40 |
| 检索与取证 | 3 | 8 |

## 68 颗

| # | name | 中文名 | 角色（primary 在前） | primaryRole | stage | methods | market | 触发条件（zh） | canonicalFor | overlaps 数 |
|---:|---|---|---|---|---|---|---|---|---|---:|
| 1 | `buffett-investment-framework` | Buffett Investment Framework | 主 Agent | 主 Agent | research | valuation / financial-health / risk | global | 当用户要求按商业质量、资本配置、估值与风险搭建基本面研究框架，或明确提到巴菲特式分析时使用；关键词：巴菲特、商业质量、资本配置、护城河。 | — | 9 |
| 2 | `financial-health` | 财务健康 | 数据分析 | 数据分析 | research | financial-health / accounting | a-share | 当用户要求检查盈利质量、现金转换、营运资本、杠杆与资产负债表风险时使用；关键词：财务健康、现金流、应收账款、减值、负债。只看一个季度增速时不要用。 | — | 6 |
| 3 | `risk-warning-catalysts` | 风险与催化剂监控 | 主 Agent | 主 Agent | monitoring | risk / portfolio | a-share | 当用户要求把研究结论转成带来源、阈值和复查频率的风险与催化剂监控项时使用；关键词：风险监控、催化剂、阈值、复查频率。 | — | 5 |
| 4 | `valuation-investment-strategy` | 估值与情景分析 | 数据分析 | 数据分析 | research | valuation / risk | a-share | 当用户要求在一次事实核查之后搭建带假设、情景与失效条件的估值框架时使用；关键词：估值框架、情景分析、失效条件。 | — | 7 |
| 5 | `strategy-business-transition` | 战略与业务转型 | 主 Agent | 主 Agent | research | evidence / risk | a-share | 当用户要检验公司战略叙事、业务迁移、资本配置与转型里程碑是否自洽时使用；关键词：战略、业务转型、资本配置、里程碑。 | — | 0 |
| 6 | `industry-competition-moat` | 行业竞争与护城河 | 主 Agent | 主 Agent | research | evidence / risk | a-share | 当用户要判断行业结构、竞争格局、供需与公司差异化是否可持续时使用；关键词：行业格局、竞争、护城河、供需。 | — | 0 |
| 7 | `business-decomposition-order-quality` | 业务拆解与订单质量 | 数据分析 | 数据分析 | research | financial-health / accounting | a-share | 当用户要拆解产品、客户、项目与订单，检查增长能否转成收入与现金时使用；关键词：业务拆解、订单质量、收入转化、现金流。 | — | 0 |
| 8 | `10k-digest` | 年报（10-K）逐节精读 | 检索与取证 / 主 Agent | 检索取证 | post-event | earnings / evidence | us-stock | 当用户要逐节精读一份美股 10-K，产出摘要、分节要点、关键指标与可核对出处时使用；关键词：10-K、年报精读、分节摘要。 | us/post-event/10k-digest | 7 |
| 9 | `bear-case` | 空头视角红队反驳 | 主 Agent | 主 Agent | review | evidence / risk | us-stock | 当用户要求对一个看多论点做最强的反面论证、逐条找反证与脆弱假设时使用；关键词：空头、红队、反方、看空、bear case。它不预测跌幅。 | — | 0 |
| 10 | `catalyst-calendar` | 90 天催化剂日历 | 主 Agent | 主 Agent | monitoring | earnings / portfolio | us-stock | 当用户要求列出未来 90 天的事件催化剂、预期影响与复查节奏时使用；关键词：催化剂、日历、财报日、解禁、事件。需要把事件按注意力优先级排序时用 catalyst-map。 | us/monitoring/catalysts | 5 |
| 11 | `competitor-analysis` | 直接对手与护城河 | 数据分析 | 数据分析 | research | evidence / valuation | us-stock | 当用户要围绕一家公司与其直接对手比较护城河、市场地位与行业格局时使用；关键词：竞争对手、护城河、市场地位、同业。 | — | 0 |
| 12 | `dividend-analysis` | 分红回购与资本配置 | 数据分析 | 数据分析 | research | valuation / financial-health | us-stock | 当用户要把分红、回购、并购、债务管理与自由现金流去向合起来看资本配置纪律时使用；关键词：分红、回购、资本配置、自由现金流。 | — | 0 |
| 13 | `earnings-call-analysis` | 业绩电话会文本分析 | 检索与取证 / 主 Agent | 检索取证 | post-event | earnings / evidence | us-stock | 当用户拿到业绩电话会纪要，要求读情绪、主题与管理层口径变化时使用；关键词：电话会、纪要、管理层口径、情绪。 | us/post-event/earnings-call | 7 |
| 14 | `earnings-preview` | 财报前三档情景推演 | 数据分析 / 主 Agent | 数据分析 | pre-event | earnings / risk | us-stock | 当用户要在美股财报公布前，对比一致预期与期权隐含波动，做超预期 / 符合 / 不及三档情景时使用；关键词：财报前瞻、隐含波动、一致预期、情景。 | us/pre-event/earnings-preview | 7 |
| 15 | `economics-analysis` | 美国宏观指标解读 | 数据分析 | 数据分析 | research | macro / risk | us-stock | 当用户要解读美国宏观数据与利率路径，并交代它如何传导到市场时使用；关键词：美国宏观、利率路径、传导、CPI、非农。 | — | 0 |
| 16 | `etf-analysis` | ETF 尽调与契合度评分 | 数据分析 | 数据分析 | research | portfolio / risk | us-stock | 当用户要比较 ETF 的费率、跟踪误差、流动性、成分集中度与持仓重叠，并给出契合度评分时使用；关键词：ETF、费率、跟踪误差、持仓重叠。 | — | 0 |
| 17 | `fact-check` | 逐条主张核验与补引用 | 检索与取证 / 主 Agent | 检索取证 | review | evidence | us-stock | 当用户要求把报告里的数字与事实主张逐条对照一手来源、标注已核验 / 不符 / 无法核验时使用；关键词：核验、fact check、引用、一手来源。它只核事实，不重做投资结论。 | global/review/claims | 6 |
| 18 | `financial-report-analyst` | 财报质量与红旗解读 | 数据分析 / 检索与取证 | 数据分析 | post-event | accounting / financial-health | us-stock | 当用户要从 10-K / 10-Q 读报表质量、异常红旗与可交代出处的信号时使用；关键词：10-Q、报表质量、红旗、异常。 | us/quality/statement | 12 |
| 19 | `industry-map` | 产业链地图与咽喉点 | 数据分析 | 数据分析 | research | evidence / macro | us-stock | 当用户要把产业链上下游画成有向图，定位公司位置、供需瓶颈与利润池时使用；关键词：产业链、上下游、瓶颈、利润池。 | — | 0 |
| 20 | `insider-trading` | 内部人增减持追踪 | 数据分析 / 检索与取证 | 数据分析 | monitoring | ownership / evidence | us-stock | 当用户要从 SEC Form 4 追踪高管与董事增减持并做解读时使用；关键词：内部人、Form 4、增减持、高管。 | — | 0 |
| 21 | `institutional-ownership` | 机构持仓变动 | 数据分析 / 检索与取证 | 数据分析 | monitoring | ownership / evidence | us-stock | 当用户要从 13F 读机构持仓变化、识别资金迁移方向时使用；关键词：13F、机构持仓、资金迁移。 | — | 0 |
| 22 | `learning-coach` | 把分析讲成课程 | 主 Agent | 主 Agent | learning | teaching | global | 当用户要求把一份分析结果讲成课程、逐指标解释并反问理解问题时使用；关键词：讲解、教学、逐指标、理解检验。 | — | 0 |
| 23 | `options-analysis` | 期权希腊字母与隐波 | 数据分析 | 数据分析 | research | technical / risk | us-stock | 当用户要看期权希腊字母、隐含波动率与策略适配度，理解风险形状时使用；关键词：期权、Greeks、隐含波动率、策略。 | — | 0 |
| 24 | `portfolio-review` | 组合表现与配置偏离 | 主 Agent | 主 Agent | review | portfolio / risk | us-stock | 当用户要求复盘实际持仓或组合的收益来源、集中度、配置偏离与风险动作时使用；关键词：组合复盘、持仓、配置偏离、集中度。自选清单不等于持仓。 | global/portfolio/review | 10 |
| 25 | `position-ladder` | 分批建仓与摊薄节奏 | 主 Agent | 主 Agent | execution | portfolio / trade | us-stock | 当用户要把建仓拆成分批股数上下限与加减仓节奏，并检查批次记账与洗售窗口时使用；关键词：分批建仓、加减仓、批次、洗售。 | global/execution/ladder | 10 |
| 26 | `result-validator` | 分析结果置信度评分 | 主 Agent | 主 Agent | review | evidence / risk | global | 当用户要从数据质量、方法一致性与信号冲突三个维度给一份分析结果打置信度分时使用；关键词：置信度、数据质量、方法一致性、信号冲突。 | — | 6 |
| 27 | `risk-stress-test` | 组合压力测试与风险预算 | 数据分析 / 主 Agent | 数据分析 | review | risk / portfolio | us-stock | 当用户要对组合做 beta 加权敞口、历史情景重放、VaR / CVaR、最大回撤与流动性退出天数测算时使用；关键词：压力测试、VaR、CVaR、回撤、风险预算。 | global/portfolio/stress | 10 |
| 28 | `sector-analysis` | 板块相对强弱与轮动 | 数据分析 | 数据分析 | research | macro / technical | us-stock | 当用户要看美国各板块的相对强弱与轮动线索时使用；关键词：板块、相对强弱、轮动、行业。 | — | 0 |
| 29 | `short-interest` | 空头持仓与挤压条件 | 数据分析 / 检索与取证 | 数据分析 | monitoring | ownership / risk | us-stock | 当用户要读空头比例、回补成本与挤压条件，并检查利空堆积时使用；关键词：空头、short interest、挤压、回补。 | — | 0 |
| 30 | `stock-eval` | 基本面与估值综合评估 | 数据分析 | 数据分析 | research | valuation / financial-health / risk | us-stock | 当用户要把财务质量、成长、估值与风险合成一次美股综合评估时使用；关键词：综合评估、基本面、估值、风险。 | us/research/comprehensive | 9 |
| 31 | `stock-screener` | 多标的横向打分排序 | 数据分析 | 数据分析 | research | screening / valuation | us-stock | 当用户要按估值、质量、动量、情绪与成长五个维度给一篮子美股打分排序时使用；关键词：筛选、打分、排序、多标的。 | — | 4 |
| 32 | `stock-valuation` | 四方法估值区间 | 数据分析 | 数据分析 | research | valuation | us-stock | 当用户要求对美股或境外上市公司做 DCF、可比公司、EV 倍数或剩余收益估值区间时使用；关键词：估值、DCF、目标价、合理区间。单独算 WACC 或做 EV/股权桥时用更专门的 skill。 | us/valuation/multi-method | 7 |
| 33 | `tax-lens` | 美国税务视角检视清单 | 主 Agent | 主 Agent | review | tax / portfolio | us-stock | 当问题涉及美国资本利得、洗售窗口、合格股息持有期、批次选择或年度税负拖累时使用；关键词：税、wash sale、长期 / 短期、税负。中国大陆税务不要套用。 | global/tax/us | 0 |
| 34 | `technical-analysis` | 技术面与指标解读 | 数据分析 | 数据分析 | monitoring | technical | us-stock | 当用户要求用均线、成交量、RSI / MACD 读趋势、关键价位、支撑压力或复查触发条件时使用；关键词：技术面、补跌、趋势、支撑压力。它是复查条件，不是方向预测。 | — | 0 |
| 35 | `thesis-tracker` | 投资论点存档与复核 | 主 Agent | 主 Agent | monitoring | evidence / risk | us-stock | 当用户要写下论点的 KPI、失效条件与催化剂，并在新数据到来后复核维持 / 走弱 / 失效时使用；关键词：论点跟踪、KPI、失效条件、催化剂。 | — | 5 |
| 36 | `peter-lynch-skill` | 彼得·林奇式个股研究 | 主 Agent | 主 Agent | research | valuation / evidence / screening | us-stock | 当用户要求按彼得·林奇式快筛（SKIP / WATCHLIST / DEEP RESEARCH）或完整尽调研究一只美股时使用；关键词：彼得·林奇、快筛、尽调、分类。 | — | 9 |
| 37 | `catalyst-map` | 催化剂地图 | 主 Agent | 主 Agent | monitoring | earnings / portfolio | us-stock | 当用户要把事件按影响什么、什么时候影响、传导到谁排成注意力优先级时使用；关键词：催化剂地图、事件链、注意力、传导。 | — | 5 |
| 38 | `watchlist-review` | 自选股分诊 | 主 Agent | 主 Agent | monitoring | portfolio / evidence | us-stock | 当用户要对自选清单做分诊，区分值得盯、只作背景与理由已不成立时使用；关键词：自选股、分诊、清单、移除。 | — | 10 |
| 39 | `evidence-gap-check` | 证据缺口检查 | 主 Agent | 主 Agent | review | evidence | global | 当用户要把一笔想法还缺的事实、假设与未解问题按会不会改变判断排序时使用；关键词：证据缺口、假设、未解问题、置信度。 | — | 6 |
| 40 | `thesis-validation` | 论点压力测试 | 主 Agent | 主 Agent | review | evidence / risk | global | 当用户要把一个说法压成可检验的论点、证据、失效条件与时间窗时使用；关键词：论点压力测试、可检验、失效、时间窗。 | — | 0 |
| 41 | `risk-reward-sanity-check` | 盈亏比自洽检查 | 数据分析 | 数据分析 | execution | trade / risk | us-stock | 当用户给出入场、止损与目标，要求算盈亏比并检查目标是否在噪声里、止损是否在流动性聚集处时使用；关键词：盈亏比、止损、目标、结构自洽。 | — | 10 |
| 42 | `execution-plan-check` | 执行计划检查 | 主 Agent | 主 Agent | execution | trade / risk | us-stock | 当用户要检查一份交易计划在操作上能否落地：订单类型、流动性、点差、事件时点与止损成交时使用；关键词：执行计划、订单类型、流动性、止损。 | — | 10 |
| 43 | `portfolio-concentration` | 组合集中度检查 | 数据分析 / 主 Agent | 数据分析 | review | portfolio / risk | global | 当用户要判断组合是否过度压在同一批发行人、行业、主题或相关暴露上时使用；关键词：集中度、发行主体、行业、相关暴露。 | global/portfolio/concentration | 10 |
| 44 | `journal-pattern-analyzer` | 交易日志模式分析 | 主 Agent | 主 Agent | review | trade / teaching | global | 当用户要从自己的交易日志里找重复出现的优势与失误，并按环境分组时使用；关键词：交易日志、模式、优势、失误、小样本。 | — | 10 |
| 45 | `post-trade-review` | 交易复盘 | 主 Agent | 主 Agent | review | trade / teaching | global | 当用户要按论点、setup、执行、守规与结果复盘一笔已平掉的交易时使用；关键词：交易复盘、后视镜、守规、结果。 | global/review/post-trade | 10 |
| 46 | `position-sizing` | 入场仓位测算 | 数据分析 / 主 Agent | 数据分析 | execution | trade / portfolio | us-stock | 当用户给出账户规模、单笔风险预算、入场价与止损价，要求反推一个可辩护的仓位大小时使用；关键词：仓位、头寸、风险预算、止损。它只算大小，不判断这笔该不该做。 | global/execution/sizing | 10 |
| 47 | `position-management` | 持仓论点复核 | 主 Agent | 主 Agent | review | portfolio / risk | us-stock | 当用户要对照原始论点、失效条件、催化剂与执行约束复查一笔在手仓位时使用；关键词：持仓复核、继续持有、减仓、止损、离场。 | — | 10 |
| 48 | `china-earnings-analysis` | A 股业绩点评 | 主 Agent / 数据分析 | 主 Agent | post-event | earnings / financial-health | a-share | 当用户要求对 A 股公司做季报/年报点评，需要实际 / 一致预期 / 上期差异表、收入与利润率分解、资产负债表与现金流关注点时使用；关键词：财报点评、季报点评、年报点评、业绩分析。只查公告事实时不要用。 | a-share/post-event/earnings-note | 7 |
| 49 | `china-earnings-preview` | A 股财报前瞻 | 数据分析 / 主 Agent | 数据分析 | pre-event | earnings / risk | a-share | 当用户在一份 A 股财报公布前，要求历史基线、要盯的三到五个指标、乐观 / 基准 / 悲观三档情景与触发条件时使用；关键词：财报前瞻、业绩预告、快报、前瞻。 | a-share/pre-event/earnings-preview | 7 |
| 50 | `china-comps-analysis` | A 股可比公司倍数 | 数据分析 | 数据分析 | research | valuation | a-share | 当用户要按 A 股口径搭同业倍数表，比较 P/E、P/B、EV/EBITDA 与溢价折价时使用；关键词：可比公司、倍数、P/E、EV/EBITDA、A 股。 | a-share/valuation/comps | 7 |
| 51 | `china-dcf` | A 股 DCF 口径 | 数据分析 | 数据分析 | research | valuation / financial-health | a-share | 当用户要用中国财报口径跑 DCF：十年期国债、A 股股权风险溢价、25% / 15% 税率与本币终值时使用；关键词：A 股 DCF、WACC、敏感性、终值。 | a-share/valuation/dcf | 7 |
| 52 | `china-sector-overview` | A 股行业全景 | 数据分析 | 数据分析 | research | macro / evidence | a-share | 当用户要画 A 股行业全景：市场规模、集中度、政策框架、竞争格局与关键 KPI 时使用；关键词：A 股行业、市场规模、集中度、政策、KPI。 | — | 0 |
| 53 | `china-catalyst-calendar` | A 股催化剂日历 | 主 Agent | 主 Agent | monitoring | earnings / portfolio | a-share | 当用户要把 A 股披露与事件按时间排成注意力日历：财报、预告、股东大会、解禁、分红回购与政策会议时使用；关键词：A 股催化剂、日历、解禁、披露。 | a-share/monitoring/catalysts | 5 |
| 54 | `china-break-trace` | A 股财务核查 | 数据分析 / 检索与取证 | 数据分析 | post-event | accounting / evidence / risk | a-share | 当用户要对 A 股财报做取证式核查：科目勾稽、利润与现金流背离、应收存货异常、审计意见与问询函时使用；关键词：财务核查、勾稽、现金流背离、问询函。 | a-share/quality/forensic | 12 |
| 55 | `china-variance-commentary` | A 股业绩差异表述 | 主 Agent / 数据分析 | 主 Agent | post-event | earnings / evidence | a-share | 当用户要把 A 股业绩差异写成可读的中文：超预期 / 低于预期分类、驱动归因、口径与单位一致性时使用；关键词：业绩差异、超预期、归因、口径。 | a-share/post-event/variance-paragraph | 7 |
| 56 | `china-initiating-coverage` | A 股首次覆盖 | 主 Agent / 数据分析 | 主 Agent | research | valuation / financial-health / evidence | a-share | 当用户要按券商研究所体例搭一份 A 股首次覆盖：公司行业、三表、估值、图表清单与报告骨架时使用；关键词：首次覆盖、深度报告、三表、估值、目标价。 | a-share/research/initiation | 4 |
| 57 | `china-morning-note` | A 股晨会纪要 | 主 Agent | 主 Agent | monitoring | macro / portfolio | a-share | 当用户要按 A 股卖方晨会节奏写一份当日策略：隔夜外盘、盘前情绪、解禁披露事件与盯盘要点时使用；关键词：晨会、盘前、隔夜、盯盘。 | — | 0 |
| 58 | `china-thesis-tracker` | A 股持仓论点跟踪 | 主 Agent | 主 Agent | monitoring | evidence / portfolio | a-share | 当用户要为 A 股持仓与自选逐只维护投资逻辑、跟踪数据点与催化剂，并更新有效性时使用；关键词：A 股论点、持仓跟踪、催化剂、有效性。 | — | 5 |
| 59 | `china-idea-generation` | A 股选股与机会生成 | 主 Agent | 主 Agent | research | screening / technical | a-share | 当用户要按量化筛选、主题线索与形态识别系统性地找 A 股多空标的时使用；关键词：A 股选股、筛选、主题、形态、多空。 | — | 0 |
| 60 | `company-valuation` | 企业估值与股权价值桥 | 数据分析 | 数据分析 | research | valuation / financial-health | us-stock | 当用户要用 DCF、同业倍数与先例交易估企业价值，并把 EV 桥到股权价值时使用；关键词：企业价值、股权价值桥、DCF、先例交易。 | us/valuation/dcf | 7 |
| 61 | `wacc-computation` | WACC 与资本成本估算 | 数据分析 | 数据分析 | research | valuation / risk | us-stock | 当用户要拆解 CAPM 输入、可比 β 去杠杆 / 再杠杆与税后债务成本，算 WACC 与敏感性区间时使用；关键词：WACC、CAPM、β、股权风险溢价、资本成本。 | us/valuation/wacc | 0 |
| 62 | `three-statement-modeling` | 三表勾稽建模与诊断 | 数据分析 | 数据分析 | research | accounting / financial-health | global | 当用户要搭一张联动的三表模型，并用每期平衡检查点名不平的项目时使用；关键词：三表模型、勾稽、资产负债表、现金流、平衡检查。 | — | 0 |
| 63 | `credit-analysis` | 偿债能力与债务容量分析 | 数据分析 | 数据分析 | research | risk / financial-health | us-stock | 当用户要判断一家公司能否穿过周期还债，算杠杆、利息覆盖、DSCR、FCF / 债务与流动性时使用；关键词：偿债能力、DSCR、杠杆、信用分析。 | — | 0 |
| 64 | `ecl-computation` | 预期信用损失与三阶段减值 | 数据分析 | 数据分析 | research | accounting / risk | global | 当用户要按 IFRS 9 三阶段拆分预期信用损失：阶段迁徙、PD / LGD / EAD、账龄矩阵与情景加权时使用；关键词：预期信用损失、IFRS 9、PD、LGD、减值。 | — | 0 |
| 65 | `insurance-reserving` | 保险准备金与综合成本率 | 数据分析 | 数据分析 | research | accounting / risk | global | 当用户要看保险准备金链条：赔款发展三角、链式法、Bornhuetter-Ferguson、IBNR 与综合成本率时使用；关键词：保险准备金、IBNR、发展三角、综合成本率。 | — | 0 |
| 66 | `banking-compliance` | 银行资本与流动性指标 | 数据分析 | 数据分析 | research | risk / financial-health | global | 当用户要看银行资本与流动性指标：CET1、RWA、杠杆率、LCR / NSFR 与压力形状时使用；关键词：银行资本、CET1、RWA、LCR、NSFR。 | — | 0 |
| 67 | `forensic-accounting` | 账务异常与数字分布排查 | 数据分析 | 数据分析 | review | accounting / evidence | global | 当用户要用 Benford、整数重复金额、资金循环与供应商关联方重合作取证式排查时使用；关键词：取证会计、Benford、资金循环、关联方。 | — | 6 |
| 68 | `cross-market-listing-choice` | 跨市场选线（A/H · ADR/HK） | 主 Agent / 数据分析 | 主 Agent | review | portfolio / tax / risk | a-share / us-stock | 当同一家公司有 A/H、ADR/港股多条上市线，用户要选一条持有、加仓或观察时使用；关键词：A/H 溢价、ADR、选线、汇率、股息税。 | — | 0 |
