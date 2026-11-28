# Capital Generation
<p align="left">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
  <a href="https://github.com/v587d/capital-generation"><img src="https://img.shields.io/badge/Financial%20Market-CN%20%7C%20HK%20%7C%20US-orange" alt="Market·CN+HK+US"></a>
  <a href="https://github.com/deepseek-ai"><img src="https://img.shields.io/badge/DSH%20Baseline-0.2.2--rc.5-blue" alt="DSH@0.2.2-rc.5"></a>
  <a href="https://github.com/v587d/capital-generation/releases"><img src="https://img.shields.io/badge/version-2.31.6-9cf" alt="Version"></a>
  <a href="https://www.npmjs.com/package/@v587d/capital-generation"><img src="https://img.shields.io/npm/v/%40v587d%2Fcapital-generation" alt="npm version"></a>
</p>

> Next-Gen AI-Driven Capital Gains Terminal.

Capital Generation 是运行在 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 里的证券研究插件，面向关注 A 股、港股、美股的个体投资者。安装后，新会话的选择器里会多出 **自动模式**、**行情专家**、**资讯专员** 三个模式；日常研究选 **自动模式**，用自然语言查行情、财务数据、公告和新闻，由它安排取数、数据质检、资料检索、独立复核与图表，最后给出带来源的结论。它不是独立应用，需要先安装 DSH。

**🎞️视频演示：**[安装、配置与使用](https://www.bilibili.com/video/BV1fzaZ6CE9J/)。

> [!IMPORTANT]
> 本项目仍在探索中，不提供代交易服务，不保证数据完整、及时或准确，也不承诺投资回报。请自行核对来源并承担投资风险。

## 「🎉 CapGen 投研自动化」 已上线，欢迎试用并提 issue 💕 [快速了解](#capgen-automation)

## 「🎉 高级分析师」 已上线，欢迎试用并提 issue 💕 [快速了解](#senior-analyst)

## 快速上手

> [!NOTE]
> 最新版本已适配 DSH`@0.2.2-rc.5`，支持窗口是**同一 minor**（`>=0.2.2-rc.5 <0.2.3-0`）：宿主补丁级更新（rc.6、0.2.2 正式版）不再需要跟发插件，0.2.3 起仍需插件适配。


0. **前置**

    **建议用独立 profile 启动。** 比如：
       
    ```bash
      dsh --profile capital --port 8888
    ```
    然后访问 `http://localhost:8888`。这样，本插件只属于 capital 这个 profile，避免和其他 profile 冲突。

1. **安装插件**

    Linux / macOS ：

    ```bash
    dsh plugin --profile capital add @v587d/capital-generation
    ```
    或
    ```bash
    dsh plugin --profile capital add github:v587d/capital-generation
    ```

    DSH 桌面端在 「添加插件」 中输入：

    ```input
    https://github.com/v587d/capital-generation
    ```
    或
    ```input
    @v587d/capital-generation
    ```
    **本仓库已包含构建产物，普通用户不需要克隆仓库或运行构建命令。**

2. **选填密钥** （打开 DSH 「插件」 → **Capital Generation** →「数据源」）
  
    本插件所有自带密钥均可免费申请、免费日常使用。哪怕所有密钥留空也不影响插件核心功能，即缺哪个密钥，仅表示对应能力就不可用，其他功能照常。
  
     | 密钥 | 用途 |
     | --- | --- |
     | [同花顺 Fuyao](https://fuyao.aicubes.cn/docs/) | 行情、财务数据和自选股报价 |
     | [AnySearch](https://www.anysearch.com/docs) | 网页搜索和正文提取 |
     | [Wind Alice](https://market.windalice.com/#/home) | 公告与新闻的语义深研（**按次消耗积分**），以及宏观/行业/汇率指标与按日期区间取的历史 K 线；公告清单优先走零 key 的东财公告工具 |
     | [PaddleOCR AIStudio](https://aistudio.baidu.com/paddleocr) | 解析 PDF 和图片中的文字 |
     | [FTShare（非凸科技）](https://market.ft.tech/gateway/doc/p/pb8eizu3) | A 股行情与日 K 截面、主力资金流、涨跌停、龙虎榜席位、股东人数、指数权重、可转债行情、宏观利率，以及期货合约与贵金属行情等第二家上游口径 |

    第三方服务的密钥，需分别向服务方申请；额度和条款以各服务方为准。保存后 **新建会话** 即可生效，无需重启。

    也可以直接把密钥写入`~/.dsh/.credentials.yaml`，名称依次为 `FUYAO_API_KEY`、`ANYSEARCH_API_KEY`、`WIND_API_KEY`、`PADDLE_OCR_TOKEN`、`FTSHARE_API_KEY`。

    密钥由 DSH 凭据服务保存。

    > **专业分析环境（可选）：** 插件页的「分析环境」由本插件独立管理 Python 运行时。首次使用前点一次
    > 「准备分析环境」，插件会下载约 55–60 MB 的固定版本运行时；**不需要你安装 Python、pip 或 conda**。
    > 装好后可离线使用。支持 Windows 10+ x64、macOS 12+、Linux x64（glibc 2.28+，含 WSL2 Ubuntu 20.04+）。
    > 需要全市场 Parquet 数据时，再额外安装「Parquet 支持」（pyarrow）。

3. **新建会话。** 新会话的模式选择器里会看到三个自定义模式。日常研究选 **自动模式**，然后直接描述研究问题；也可以到「设置」→「Agent 预设」把它设为默认模式。

    | 模式 | 适合什么 | 会做什么 | 边界 |
    | --- | --- | --- | --- |
    | **自动模式**（推荐） | 投研报告、事件影响、持仓复盘，以及需要同时查数、查资料和出图的综合问题 | 统一调度取数、数据质检、资料检索、独立复核与绘图，汇总证据后直接答复 | 自动模式不直接取数，也不直接画图；每个数字都要有来源与截止时间 |
    | **行情专家** | 只想拿一份结构化行情、财务或宏观数据 | 查询并保存到当前会话，返回数据引用、来源与截止时间 | 只负责取数，不读取数据内容、不做判断；数据只在当前会话可用 |
    | **资讯专员** | 只要公告、新闻或互动平台材料 | 检索公告与新闻，逐条标注来源与核验状态 | 不做投资分析，也不给买卖建议 |

    **分析师**、**高级分析师**与**绘图专员**是自动模式的内部角色，不出现在选择器里。自动模式会在需要时创建并调度它们；它们没有独立的取数入口，单独打开也读不到本次研究的数据。

    **每份结构化数据都会先做质检。** 无论你有没有提图表，自动模式收到行情或财务数据后都会先交给分析师检查结构、时间轴、缺失与基础统计；要不要图是检查之后的一个判断。明确说“不要图”时，质检照做，只是停在出图之前。

    **需要判断的问题会先交给高级分析师复核。** 财务质量、收益与风险、情景与敏感性，以及事件影响、趋势、估值这类要下结论的问题，由高级分析师在固定分析模块里算完再写判断；结论里的数字对不上数据集或模块计算的，会被退回重写。数据质检只检查结构与统计，不替你做判断。详见 [高级分析师](#senior-analyst)。

    自动模式会把子角色工作期间的中间回执留在同一轮里处理，等材料收齐后再给出完整结论，而不是每条中间进展都单独回一段。

## 试试这么用

在新的自动模式会话中使用以下指令。将方括号内容换成自己的标的、公告或持仓；证券代码写完整市场后缀，例如 `600519.SH`。每条指令单独发送，便于观察结果。

[样例：指南针Q3暴跌探因（20261031）](docs/sample/指南针Q3暴跌探因.md)

<details>
<summary>展开示例指令</summary>

**完整投资研究报告**

```instruction
请对[公司名称、俗称]([证券代码])做一份完整投资研究报告。
以你实际取得的最新可用数据为截止，覆盖业务、财务、估值、价格走势、近期重要事件以及风险与反方观点。
先给核心判断和最大风险；关键数字注明报告期或交易日、来源和采集时间。
证据不足的部分注明未评估及原因，不编造目标价或收益概率。
```

**事件与公告影响分析**

```instruction
请核查[公司名称]([完整证券代码])的[公告标题及披露日期，或“最近一次业绩公告”]，
分析它对经营、现金流和投资风险可能产生的影响。
先核对公告原文、披露时间和事项进展，区分已实施事实与尚待批准的方案；
如讨论股价反应，只比较公告后可交易时段和同窗市场走势，不把同期涨跌直接归因于公告。
给出最大不确定性和后续验证指标，找不到原文时不要假设事件已发生。
```

**持仓与组合复盘**

```instruction
请复盘我的持仓[其他资产如有，请补充]。
请先核对这些比例是否覆盖全部资产，再分析单只标的、行业与市场的集中风险，
以及哪些风险会同时影响多个持仓。
我没有提供交易流水或成本，不要计算期间收益、最大回撤或收益归因；
我只在自选股里标过持仓的那几只才算仓位，没标的只是关注。
给出最需要核实的信息和可观察的防守选项。
```

**财务质量与收益风险复核**

```instruction
请复核[公司名称]([完整证券代码])最近三期财报的财务质量：利润率与 ROE 的驱动、利润的现金含量、
杠杆和利息覆盖；再用近一年日线算区间收益、波动与最大回撤，并和沪深300 对比。
结论里的每个数字注明报告期或交易日；数据缺的部分直接说没评估，不要用假设补齐。
```

**关键假设的情景测算**

```instruction
请用[公司简称]最近一期的营收与净利率做情景测算：营收降 10%、净利率降 2 个百分点时净利润是多少，
再给出营收 -20% 到 +10%、净利率 -3 到 +3 个点的敏感性格点表。
只做算术，不预测股价，也不给目标价；说明哪些假设最脆弱。
```

</details>

## 还能做什么

- **查数据和资料：** 覆盖 A 股、港股、美股与期货等品种，由专用角色按需获取行情、财务、指数、基金、宏观行业与期货数据，检索公告、新闻和研报。共计 **173** 个数据收集能力和 **17** 个网页检索能力，部分公开数据源无需额外密钥；具体覆盖范围见 [数据收集能力表](docs/data-collector-capabilities.md) 和 [网页检索能力表](docs/web-retriever-capabilities.md)。
- **数据质检：** 结构化数据不会直接进入模型上下文。每份数据先由分析师检查结构、时间轴、缺失与基础统计，再按受控方式汇总；原始数据行始终留在工具层。

<a id="senior-analyst" name="senior-analyst"></a>
- **高级分析师（研究结论复核）：** 需要判断的问题不再由取数角色顺手给结论，而是交给「高级分析师」在固定分析模块里算完再下判断。判断类问题包括财务质量复核、收益与风险对比、关键假设的情景与敏感性，以及事件影响、趋势、估值这类需要结论的问题。内置 11 颗分析模块：

  | 输入 | 模块 | 能回答什么 |
  | :--- | :--- | :--- |
  | 三张报表 | 财务质量、三表勾稽 | 利润的含金量、ROE 驱动、现金转换与偿债；资产 = 负债 + 权益、现金流对账、留存收益滚动是否对得上 |
  | 两期利润表 | 盈利归因 | 净利润变化拆成收入、净利率、税率各自贡献了多少 |
  | 价格序列 | 收益风险、K 线清洗、技术指标、简易回测 | 收益/波动/回撤/夏普与基准 beta；坏 K 线逐行剔除；均线与振荡指标复盘；均线规则的样本内回测 |
  | peers 横截面 | 可比倍数 | P/E、P/B、P/S、EV/EBITDA 的中位数，以及一只标的相对同行的位置 |
  | 多持仓 + 窗口 | 组合回放 | 给定权重在历史区间里的组合收益、逐持仓贡献与集中度 |
  | 假设参数 | 情景与敏感性、DCF 敏感性 | 净利润 = 营收 × 净利率 这类恒等式在不同假设下的取值；DCF 模型值与 WACC×终值增长网格（**不是目标价**） |

  **结论要能复核。** 结论里的每个数字都要对得回数据集、统计结果或模块计算，插件会逐个数字校验，对不上就退回要求改（这只保证数字有出处，不证明判断本身正确）；产物要带正反论据和至少一条能推翻主判断的失效条件，并写明证据充分度、局限与未解决的缺口，有替代解释、冲突点或情景时也要一并列出；证据不足时只给「部分完成」或「证据不足」，不硬凑结论。每次复核都会在工作区留一份结构化产物（`capital-analysis/runs/`），可以回看与复算；它属于保留数据，清理数据缓存时不会删除。

  **边界：** 高级分析师不取数、不读原始数据行、不出图、不写最终答复；它把结论层材料交回自动模式，由自动模式写最终答复、登记图表。它也不给买卖、仓位或目标价建议。模块是仓库内审查过的固定模块，模型只能选模块和参数，不能改模块代码或提交脚本。这些模块跑在插件自带的 Python 运行时里（见上面的「专业分析环境」），没准备环境时会提示先安装，其余功能照常。

- **可视化：** 分析师判断数据适合图表，或你明确要图时，绘图专员会生成可交互图表；明确不要图时只完成质检。图表会登记为**最后一轮答复**的交付物，在答复末尾集中出现，可在侧栏查看或离线打开。了解处理流程可看 [Agent 角色说明](docs/agent-roles.md)。

| 走势折线 | K 线与量价 |
| :---: | :---: |
| <a href="assets/chart-line-sidebar.png"><img src="assets/chart-line-sidebar.png" alt="侧栏折线图" width="400"></a> | <a href="assets/chart-candlestick-sidebar.png"><img src="assets/chart-candlestick-sidebar.png" alt="侧栏 K 线图" width="400"></a> |

- **管理自选股：** 在 **自动模式、行情专家、资讯专员** 三种模式的会话中输入 `/` 或点击输入框旁的 `+`，从「指令」中打开「自选股」。左侧栏的「自选股」打开行情工作台：左边是行情列表，右边是选中标的的当日分时走势图（价格、均价、昨收基准与成交量，A 股、港股、美股都画；收盘后标明是当日收盘还是上一交易日，没有分时源的市场不画），下面接着历史日 K（蜡烛、MA5/10/20/60、成交量，A 股、港股、美股个股都有，A 股指数也有；港美股指数暂时没有日线）。

<p align="center">
  <a href="assets/watchlist.png">
    <img src="assets/watchlist.png" alt="自选股行情工作台" width="800">
  </a>
</p>

- **精选 Skills：** 当前收录 8 个开源项目、共 70 个 Skill。默认不开启「智能装载 Skills」，逐项清单和勾选都在；打开后清单收起，按角色开放该角色全部方法，由模型按任务挑 1–2 条，运行期不再看勾选。两种状态都按角色分发：研究/组合方法归自动模式，估值/财务/风险/筛选归分析师，文档深读与核验归资讯专员；无需新建会话，下一轮就生效。

<p align="center">
  <a href="assets/selected-skills配置.png">
    <img src="assets/selected-skills配置.png" alt="精选 Skills 配置：按 Skill 特点与适用预设筛选" width="800">
  </a>
</p>

| 项目名称 | 收录边界 |
| :---: | :---: |
| [The Investment Skills Lexicon](https://github.com/finterm-ai/investment-skills) | Buffett Investment Framework |
| [China Stock Research Skills](https://github.com/spikeHongg/china-stock-research-skills) | 6 个 A 股研究 Skill |
| [InvestSkill](https://github.com/yennanliu/InvestSkill) | 28 个美股 Skill：逐条主张核验、空头反方、披露文件与内部人追踪、压力测试等 |
| [Peter Lynch Research](https://github.com/DjNero11/peter-lynch-skill) | 一条完整的个股研究流程 |
| [Trading Skills](https://github.com/marian2js/trading-skills) | 11 个交易过程 Skill：催化剂排布、自选股分诊、论点压力测试、执行计划检查、入场仓位测算、持仓论点复核、交易日志复盘等，美股与境外交易口径 |
| [Claude for Financial Services CN](https://github.com/jwangkun/claude-for-financial-services-cn) | 12 个 A 股卖方研究 Skill：业绩点评与差异表述、财报前瞻、可比倍数、A 股 DCF 口径、行业全景、催化剂日历、财务核查、晨会纪要、持仓逻辑跟踪与选股清单等 |
| [FinanceSkills](https://github.com/GAJETOso/financeskills) | 8 个估值与财务方法 Skill：折现率（WACC）估算、三表勾稽建模、企业估值与股权价值桥、偿债能力与债务容量、预期信用损失三阶段、银行资本与流动性、保险准备金与综合成本率、账务异常排查；按 IFRS / 美股与国际准则口径写，境内监管阈值与科目名需自行对照 |
| [Quant Agent Skills](https://github.com/Howard-Jerry/quant-agent-skills) | 1 个跨市场选线 Skill：同一家公司在 A 股与港股、或美股 ADR 与港股各有一条线时该走哪一条——价差、币种与股息税、流动性与通道、披露文件路径各不相同。公司本身只研究一次，便宜的那条线不构成"这家公司更值得买"；A/H 溢价与 ADR 平价没有现成条目，须按两条线同一天的收盘价与当日汇率现算，缺任一项就只报缺的那一项 |

<a id="capgen-automation" name="capgen-automation"></a>
- **CapGen 投研自动化：** 内置 17 个模板：16 个内容模板默认未添加、按需添加，覆盖资讯、行情、复盘、研究、组合与监控；交易日有盘前公告（08:00）、早间资讯（08:30）、午间快照（11:35）、当日公告（16:00）、港股收盘（16:30）与每日复盘（20:00），另有美股收盘（周二至周六 07:00）、美股盘前（周一至周五 20:30）、组合周报、自选股周检、行业周报、研究选题、财报跟踪、下周事件日历、市场周报与组合风险月报；「TODO 核验」默认启用，交易日 17:00 主动核验看板里的待验证条件。也可新建自己的任务，并从 30 个图标里挑一个；内置模板也有各自的固定图标，看板卡片沿用同一枚。到点自动新建 session 执行，也能手动运行。任务、看板、12 个月运行热力图与任务通知在同一页，可在设置卡把任一已注册工作区设为任务统一使用的默认工作区，支持运行预算、通知和仅交易日触发；看板简报卡右上角的对话入口可直接追问，回答完成后卡片显示最新一轮摘要并可在卡内展开全文，弹窗按时间列出这次运行的全部追问，右上角可打开完整 session。看板 TODO 由「TODO 核验」主动调查触发条件，待确认或数据不足的条目交给你核对；触发或需要你处理时写入任务通知。

<p align="center">
  <a href="assets/capgen-automation-kanban.png">
    <img src="assets/capgen-automation-kanban.png" alt="投研自动化：看板、任务简报与右栏" width="800">
  </a>
</p>

<p align="center">
  <a href="assets/capgen-automation-tasks.png">
    <img src="assets/capgen-automation-tasks.png" alt="投研自动化：任务、日程与运行概览" width="800">
  </a>
</p>

## 常见问题

- **安装后找不到模式？** 确认插件出现在「插件」→ 已安装列表；Web / CLI profile 安装后要重启该 profile，并在新会话选择模式。选择器里应看到自动模式、行情专家、资讯专员；分析师、高级分析师和绘图专员是自动模式的内部角色，不会出现在这里。
- **高级分析师是什么角色，什么时候介入？** 它是自动模式里的结论层：需要判断的问题（财务质量、收益与风险、事件影响、趋势、估值、情景）交给它，在固定分析模块里算指标、写结论，结论带正反论据与失效条件。它不取数、不出图、不写最终答复，也不给买卖、仓位或目标价建议；单点事实查询不会派它，复杂问题因为多一层复核会比单纯查数慢一些。证据不足时它会写明「部分完成」或「证据不足」，不硬凑结论。首次使用前记得在插件页准备「分析环境」，否则它会报告环境未就绪。
- **配置在哪？** 打开「插件」→ 已安装的 **Capital Generation**，插件介绍下方就是「数据源 / 投研自动化 / 精选 Skills / 包含的组件 / 分析环境」五格，五把密钥都在第一格；第二格可指定任务统一使用的默认工作区，也能改自动检查间隔与最长运行时间等上限；第五格准备 Python 分析环境；不在 DSH 的普通「设置」页面，也不用点进任何一行组件。保存密钥后新建会话再试。
- **升级到 2.9.0 后，分析师和绘图专员去哪了？** 这一版把它们收进自动模式内部，不再出现在选择器与预设管理里，避免误开一个没有取数入口的空会话。旧会话仍能按原身份恢复；新任务直接用自动模式提出即可。
- **宿主更新后插件显示异常、三个模式消失？** 插件只支持**同一 minor** 的宿主（本版是 `>=0.2.2-rc.5 <0.2.3-0`）：宿主跨到 0.2.3 及以上时，旧插件会被启动拒载（插件页显示「异常」）。先把宿主升到与插件同一条 minor，再在插件页更新插件；应急可用版本豁免（有崩溃风险，见 CHANGELOG 的 Migration）。日志里出现「宿主 dsh … 未逐项验证」说明你跑在同一 minor 的未验证补丁版上——能跑，但遇异常请先升级插件并把那行日志附在 issue 里。
- **桌面端升级后仍是旧版？** 桌面端安装时会固定所解析的版本，不会自动升级。卸载后重新安装，再到插件详情查看版本号；如需指定版本，可在地址末尾加 `#v2.31.6` 或 `@2.31.6`。
- **刚发布的新版本装不到？** 桌面端取包时会跳过**刚发布不久**的版本（宿主侧包管理器的发布冷却策略，实测会静默装成上一个版本），国内镜像的同步也可能滞后一段时间。急着用最新代码，改用仓库地址安装最直接；但仓库地址安装的是 git 依赖，插件页不显示「版本」检查。
- **插件页的「版本」段怎么用？** 只有用包名从 npm 安装的版本才有；它只列比当前新的版本。回旧版要先卸载，再安装 `@v587d/capital-generation@版本号`（桌面端地址末尾加 `#v版本号`）；旧版必须匹配当前 DSH 基线，对应关系见 [CHANGELOG 的 Migration](CHANGELOG.md)。
- **网页抓取失败？** 配置卡片中的「允许启动本地提取网页内容」默认开启：AnySearch 提取失败时可尝试本机直连。关闭后，本机直连的具名来源查询也不可用；请检查该开关和网络连接。
- **Wind 那部分会消耗积分？** 会。Wind 的公告 / 新闻语义检索、宏观 / 行业 / 汇率指标、按日期区间取的历史 K 线都按次消耗你在 Wind 侧的额度；额度与条款以 Wind 为准，插件不做用量封顶。没配 `WIND_API_KEY` 时这几类不可用，其余功能照常——公告清单与正文有零密钥的东财工具，不配 Wind 也能查。
- **没有加载想要的精选 Skill？** 先看「智能装载 Skills」开关：关着时只给已勾选的方法；打开后按角色放开全部方法，但仍由模型判断任务是否命中。再确认它归哪个预设——自动模式偏研究/组合/写作，估值、财务与筛选由分析师在计算时加载，文档深读与核验由资讯专员加载。列表上方可以按「Skill 特点」和「适用预设」两个维度取交集筛选；点技能名可看原文。需要强制使用时，在对话里直接输入 `/` 加原文中的英文名（例如 `/china-earnings-analysis`），不要用中文标题。
- **怎么知道这次分析用了哪些精选 Skill？** 最终答复会有一节「使用的方法」，逐项列出实际加载过的 Skill 并说明各自支撑了哪个判断；主 Agent 和子 Agent 的加载都会计入。没有加载过就不会出现这一节，答复里也不会挂没读过的名字。
- **精选 Skill 的方法论很长，Agent 读得完吗？** 读得完。超过一次可读长度的正文已经重排成「入口 + 分册」：Agent 先看入口目录，需要具体规则、模板或阈值时把对应那一册整本读进来，并会告诉你它读了哪几册、哪些没读。设置卡片里点技能名打开的原文预览仍然只给入口那一份，想看某一册直接问 Agent。

目前 Windows 桌面端有一项[已知宿主差异](CHANGELOG.md)：自动模式的出图与检索限制可能不生效。请留意它实际调用了哪些工具；结构化数据的取数边界仍由工具层执行。

## 开发与贡献 
普通用户不需要执行下面的命令。修改源码时请参考 [贡献指南](CONTRIBUTING.md) 和 [开发约定](AGENTS.md)：

[![OctoCounts](https://api.octocounts.com/badge/v587d/capital-generation/branch/master)](https://octocounts.com/github/v587d/capital-generation/tree/master)

```bash
npm install
npm run build       # 构建 lib/ 和浏览器端资源
npm test            # 构建并运行测试
npm run check:dsh   # 检查 DSH 扩展面兼容性
npm run smoke:boot  # 检查插件装配
```

完整版本历史见 [CHANGELOG.md](CHANGELOG.md)。问题与建议可到 [Issues](https://github.com/v587d/capital-generation/issues) 或 [DSH官方 Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions/6947) 交流。本项目采用 [MIT 许可](LICENSE)。

## 致谢

- 「精选 Skills」的研究、交易过程与财务方法 Skill 按固定 commit **快照收录**自 [finterm-ai/investment-skills](https://github.com/finterm-ai/investment-skills)、[spikeHongg/china-stock-research-skills](https://github.com/spikeHongg/china-stock-research-skills)、[yennanliu/InvestSkill](https://github.com/yennanliu/InvestSkill)、[DjNero11/peter-lynch-skill](https://github.com/DjNero11/peter-lynch-skill)、[marian2js/trading-skills](https://github.com/marian2js/trading-skills)、[GAJETOso/financeskills](https://github.com/GAJETOso/financeskills)、[Howard-Jerry/quant-agent-skills](https://github.com/Howard-Jerry/quant-agent-skills)（以上均 MIT License）与 [jwangkun/claude-for-financial-services-cn](https://github.com/jwangkun/claude-for-financial-services-cn)（Apache-2.0）。快照目录、收录口径与逐颗排除理由见 [selected-skills/](selected-skills/README.md)，第三方组件与许可见下面的清单文件。
- 会话里的可交互图表由 [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts)（Apache-2.0）渲染，图上保留它自带的归属标识。
- 行情、财务、公告与网页材料来自五类需自备密钥的服务（同花顺 Fuyao、Wind Alice、AnySearch、PaddleOCR、FTShare 非凸科技）与一批公开口径的来源（东方财富、腾讯、新浪、财联社、华尔街见闻、巨潮互动易、上证 e互动、同花顺公开站点）；数据版权归各服务方，额度与条款以服务方为准，本项目不重新分发原始数据。

第三方组件、版本与许可，以及宿主提供哪部分、构建期用什么、各服务的数据会出到哪些地方，逐条列在 [第三方组件与许可](THIRD_PARTY_NOTICES.md)。

## Star History

<a href="https://www.star-history.com/?repos=v587d%2Fcapital-generation&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=v587d/capital-generation&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=v587d/capital-generation&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=v587d/capital-generation&type=date&legend=top-left" />
 </picture>
</a>
