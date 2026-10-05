# 数据补录与能力目录容量（本次迭代聚焦）

> 状态：**已评审通过，正在实现**（§6 第 0、1 步已落地，第 2 步待做）。日期 2026-10-05。
>
> **本文只管三件事**：① 还能补录哪些数据；② capability 目录/详情的体积上限怎么解；③ 一条能力该放
> `data_collector` 还是 `web_retriever`。
>
> **明确不在本文范围**（已移出，见 `docs/design/code-runtime-notes.md`）：Python 运行时与宿主代码执行通道、
> `run_analysis`、依赖三方库的数据源（BaoStock / pytdx / akshare）。理由：**必须靠 python 加三方库才能拿的源，
> 基本都能用公开 HTTP 接口覆盖**，两者不该在同一个 sprint 里互相牵制。
>
> 本文所有体积数字都是**实测**（脚本与复现见 §7），不是估算。

---

## 1. 容量：两道上限，而且会被"第一批新源"同时撞上

### 1.1 目录（发现面）——当前 69 条已用掉 90% 自预算

| 指标 | 实测 |
|---|---|
| 已注册 capability | **69**（Fuyao 61 + Tencent 3 + Eastmoney 5） |
| `list_capabilities()` JSON | **5530 字符** |
| 自约束预算（`test/data-collector-hub.test.mjs:375`） | 6144 → **90.0%** |
| 均摊每条 | 80 字符（68 固定开销 + 名称/摘要） |
| **还能加几条** | **7 条**（到 6144）／33 条（到剪枝硬顶 8192） |

上一轮记录的是"61 条 4878 字符，约 79%"（`docs/design/data-collector-fuyao-expansion.md:501`）。
**三个月内从 79% 涨到 90%，因为上限不是按比例逼近，而是被 Tencent/Eastmoney 那 8 条吃掉的。**

### 1.2 单能力详情（契约面）——这才是真正的硬墙，而且先于目录爆

`describe_capability` 的体积与被剪枝的 `4096` 预算，当前最大者已经顶到天花板：

| capability | 详情总字符 | description | input_schema | **output_schema** |
|---|---|---|---|---|
| `dragon_tiger` | **3891（95%）** | 428 | 271 | **3062（占总量 79%）** |
| `income_statement` | 2329 | 253 | 542 | 1413 |
| `eastmoney_top_buy_sell_market` | 2222 | 168 | 314 | 1606 |

体积几乎全部由 `output_schema` 决定，而 `output_schema` 的大小**等于列数**。实测构造宽表 JSON Schema：

| 行内列数 | `output_schema` 字符 | 预计详情总字符 | 4096 预算 |
|---|---|---|---|
| 17 | 1289 | ~1800 | ✔ |
| 30 | 2095 | ~2600 | ✔ |
| **45** | 3025 | **~3700** | ⚠ 逼近 |
| **72** | 4699 | **~5400** | ✗ **必爆** |

对照 §2 清单里的真实列数：融资融券个股 **45 列**、可转债档案 **72 列**、十大流通股东 47 列、机构调研 34 列。
**结论：不是"加到 100 条才撑不住"，而是本次想加的第一张宽表就会把详情预算打穿。**
目录和详情必须**同时**解决，只解决目录没有意义。

### 1.3 宿主侧事实需要更正一次（0.2.0-rc.2 实测）

上一轮把 8192 理解成"单次工具结果超限就被切中间"，实测语义更微妙：

- `dsh-compaction-tool-result-pruner`（我们的 preset 在 `agent.patch.yml:485-490` 自己挂了这一行，
  `thresholdChars: 8192 / headChars: 4096 / tailChars: 1024`）是**回溯式**的：**压缩触发条件满足后**才扫描
  `tool/result` 事件并追加替换事件，"未达到压力阈值的对话保持不变"。
  → 它防的是**长会话中途静默失忆**（目录中段能力消失），不是第一次调用被切。
- 0.2.0 新增 `dsh-spill-policy`，挂在 `ctx.on("tools/post-execute")`（**逐条工具结果**，不是最终答复），
  `dsh-base` 默认配 `maxInlineTokens: 12500`，超限时保留首尾并把**完整结果写入文件、把路径交给模型**。
- 两者叠加对本项目的真实含义：**6144 这道自约束仍然正确**（它守的是可追认性，不是能不能发出去），
  但 spill 这条逃生口我们**今天够不着**——阈值差一个量级（12500 token ≈ 5 万字符），而且
  `data_collector` 的工具白名单里**没有任何读文件的工具**，拿到路径也读不回来。

> 所以：**不指望宿主机制替我们解题，解法必须在自己的编码与契约形态里找。**

---

## 2. 解法（按性价比排序，全部不需要宿主改动、不需要抬阈值）

### 2.1 目录改紧凑行编码：**5530 → 2435 字符（−56%），余量从 +7 条变成 +105 条**

根因很朴素：**目录 JSON 里 58% 的字节是键名和标点**（3234 / 5530）。每条固定开销
`{"capability":"","summary":"","paginated":false}` ≈ 46 字符，69 条就是 3174 字符——**比全部摘要文本（1132）还长三倍**。

改成一行一条的定长三段式：

```text
quote|A 股实时快照|1
fund_nav|基金净值序列（8 种区间口径）|0
```

实测：2435 字符 = 预算的 40%，均摊 **35 字符/条**。

- ✅ **仍然"一次性全部返回"**，不引入分页、不引入 digest、不做裁剪阶梯——§1.1 那条硬约束原样成立；
- ✅ 剪枝风险同步下降（40% 余量）；
- ⚠ 代价三处，都要一起改，否则测试先红是对的：`hub.listCapabilities()` 的返回形态、
  `test/data-collector-hub.test.mjs:325`（`deepEqual(Object.keys(...))` 钉死三个键）、
  `preset/capital-generation/skills/capital-data-protocol/SKILL.md:54` 那行"capability + 一行 summary + paginated"；
- ⛔ **必须先加一条生产者护栏**：实测当前 69 条 summary 里 `|` `:` `;` 换行 制表符 **命中数全为 0**——
  但这是**今天的数据性质，不是保证**。定长分隔编码必须让 producer 拒绝（或转义）分隔符，
  并加断言。分隔符撞车属于"错了不报错、只是话说错"那一族：模型会把一条能力读成两条。

> **落地记录（2026-10-05，第 0 步）**：编码住 `DataCollectorHub.capabilityDirectory()`，
> 分隔符按 `\\`、`\|`、`\n`、`\t` 转义（转义而不是拒绝：注册期抛错会让整套数据工具静默消失，
> 比"话说错"更糟）。回归三处：目录行数 = 注册数、撞分隔符的摘要仍是一行、
> 预算注释写死实测 2435/6144。详情侧 `renderOutputFields`（同文件）从**已声明的 `output_schema`**
> 投影出字典，权威声明没搬家；实测最大详情 3891 → 2771（68% 预算），另有 72 列合成回归
> （同一份 schema 直发是 4464 > 4096，钉住字典存在的理由）。

### 2.2 详情与列数解耦（解决 §1.2 的硬墙）

把 `output_schema` 从"逐列 JSON Schema"降级为**紧凑字段字典**，一行一个字段，`字段名:type:单位/null 语义`：

```text
RZYE:number:融资余额(元)
RQYL:number|nil:融券余量(股)
DATE:datetime:交易日(Asia/Shanghai,毫秒)
```

实测 72 列：JSON Schema **4699 → 约 1300 字符**，详情总字符 ~5400 → **约 2100**，回到预算内。
两种落法：

- **A（推荐先做）**：字典塞进 `description`，`output_schema` 只声明外壳（`item: array` + `pagination`），
  `additionalProperties: true`。**不新增工具面、不动 §9.3 注册面、不改 §9.6 的 schema 满足性**
  （外壳就是真实形状，逐列不再由 schema 承诺，而由 guard 承诺）。
- **B（A 不够时的升级）**：新增 `describe_fields(capability)`，把列数彻底移出详情体积。
  代价是多一颗模型可见工具 + 多一次发现往返（违反 §1.1 的省往返取向），**所以 A 用尽之前不启动 B**。

### 2.3 分域发现（**备用，不作首选**）

`list_capabilities(domain?)`。实测分域后单域上界只有 **1149 字符**（fund 域 33 条 = 1182，其余 98~464）：

| 域 | 条数 | 紧凑编码字符 |
|---|---|---|
| fund | 33 | 1182 |
| special（涨跌停/热股/异动/龙虎榜/竞价） | 13 | 464 |
| a-share | 11 | 359 |
| eastmoney | 5 | 198 |
| index | 4 | 129 |
| tencent | 3 | 98 |

**为什么不首选**：它引入一个新的假阴性失效模式——模型猜错域，看到的就是"这个能力不存在"，
然后去向用户说"没有该数据"。这正是本项目 §7 里 `final_report` 被删掉的那类"协议鼓励、宿主拒绝"的对称错误。
只有当总量真的冲到 150 条以上、2.1 的余量被吃完，才值得付这个代价，且必须让每次响应都带上
**全量域名与条数头**（`domains: fund=33, special=13, ...`），让"空结果"永远是响亮的。

### 2.4 抬 `thresholdChars`（**不推荐**）

我们的 preset 确实持有这一行，抬到 16384 技术上可做。但：① 主 Agent 与子 Agent 共用同一份 standing
composition（0.1.5 实测结论，0.2.0 未见改变），抬了主 Agent 也一起付 token；② 它只是把静默失忆推后，
不改变"每条能力都要在目录里花 80 字符"的事实；③ 上一轮已明确选择"测试先失败而不是运行时静默截断"
的结构护栏路线。所以**只在 2.1 之后仍不够时再谈，且要带数字来谈**。

### 建议组合

**2.1 + 2.2 一起做，作为补录任何新数据的前置第 0 步**；2.3/2.4 留作有余量后的备选。
理由：不做这两条，§3 那张清单里**任何一条**都可能在注册后静默不可见——那不是"少个功能"，
是"用户问得到、Agent 答错了"。

---

## 3. 归属判据：`data_collector` 还是 `web_retriever`

正式研发前先定这条，是因为两面的**数据结构、失败语义、预算口径完全不同**，事后迁移等于重写契约。
沿用并收紧两处既有经验（`docs/design/web-retriever-source-expansion.md:228` 的路由规则 + 同文 §141 的
"工具边界跟着契约走、不跟传输形态走"；以及同文否决 Plan C 的理由：叙事文本挤进 6000 码点 document 是契约错配）。

### 3.1 四问决策程序

| # | 问题 | 答"是" | 答"否" |
|---|---|---|---|
| Q1 | 每行同构、可分页、**同参数可得同形状**（确定性、可复现）？ | 继续 Q2 | → **web_retriever** |
| Q2 | 使用者要拿它**做算术**（聚合/排序/时序/跨表比对/进图）？ | → **data_collector** | 继续 Q3 |
| Q3 | 文本是"内容本身"（正文/纪要/新闻）还是只是行上的一个**标注字段**？ | 内容本身 → **web_retriever** | 标注字段 → **data_collector** |
| Q4 | 需要对单位、`null` 语义、时间口径做**承诺**（有护栏才有承诺）？ | → **data_collector** | → web_retriever |

### 3.2 终判据是"错法"，不是"形状"

两面失败的样子根本不同：`data_collector` 失败是**响亮错误码**（`request_params_invalid`、
`query_type_conflict`、`code=2004` 不重试）；`web_retriever` 失败是**抓到什么算什么**，上游改版只会静默变样。
**凡是要进入散户最终结论的数字，一律走 `data_collector`**——因为只有它能给出单位、`null` 与时间口径的承诺。
反过来，把叙事文本塞进 Dataset 是双向污染（§1.5 的 document 型是边界特例，不是通用口袋）。

### 3.3 本次候选的归属结论

| 候选 | Q1 | Q2 | 归属 | 备注 |
|---|---|---|---|---|
| 宏观 CPI/PPI/GDP/PMI/M2/信贷/进出口 | ✔ | ✔ | **collector** | 时序截面，要画图和同比环比 |
| 沪深港通成交额 | ✔ | ✔ | **collector** | 见 §4 的 `null` 陷阱 |
| 个股主力资金 | ✔ | ✔ | **collector** | 数值 + 占比 |
| 融资融券 | ✔ | ✔ | **collector** | 45 列 → 先过 §2.2 |
| 可转债档案/条款 | ✔ | ✔ | **collector** | 72 列 → 先过 §2.2 |
| 股东户数 / 十大流通 / 增减持 | ✔ | ✔ | **collector** | 筹码类数值 |
| 分红送配方案 | ✔ | ✔ | **collector** | 补 Fuyao `corporate_actions` 的字段缺口 |
| 机构调研**记录表**（日期/对象/地点） | ✔ | ✔ | **collector** | 表格部分 |
| 机构调研**纪要全文**、研报正文、公告正文 | ✗ | ✗ | **retriever** | 已有 `wind_docs_*` / `eastmoney_reports` / `anysearch`，**不重复建** |
| 港股 / 美股行情与 K 线 | ✔ | ✔ | **collector** | 腾讯传输层，见 §4.2 |

**判据落点（2026-10-05 已落）**：四问与"终判据是错法"进 `capital-orchestration` §5 路由表（主 Agent
委派时就在那里定归属）；`capital-web-protocol` 新增 §1.2"遇到结构化数值诉求就停手"（含 Wind 积分裁决）；
`capital-data-protocol` §1 硬规则加一条"本角色只收结构化行集"。三条都有 `test/persona.test.mjs` 的
`assertRule` / `assertRuleAny` 断言，并做过**复刻事故形态**自检（删掉规则确认测试变红）。
规则不留在这份文档里靠人记——否则下一次加源又是一轮口头争论。

---

## 4. 键名纪律：把"Wind 要谨慎"变成可执行的判据

Wind 结构化 MCP 的两个具体毛病（输入输出不确定、接口 key 含中文与冒号且全半角不明），现在可以定位到
**确切会坏在哪里**，而不是停在"感觉不稳"。

### 4.1 中文/全半角键名会不会坏？——会，且是静默坏

实测代码事实：`normalizeKeyToken`（`src/data-collector/hub.ts:10-15`）只归一**内部 `data_key`**
（`[\\/:]` 与非 `[A-Za-z0-9._-]` 一律换成 `.`），**不碰行字段名**。上游键名原样进 `raw.json`。
后果链是：

- `query_dataset` 的 `select` / `filters` / `group_by` 用**字符串字面量**点列名；
- 键名里混进全角 `：`、`（）`、`％`，而模型下一轮复现成半角 → **匹配不到任何行 → 返回空**；
- `query_type_conflict` 只在**类型冲突**时响亮失败；**列名不存在属于"返回空"**。

"空结果"和"确实没数据"在响应里长一个样，这正好是本项目最忌讳的**错了不报错、只是话说错**。

### 4.2 已有先例可以直接沿用

`src/sources/eastmoney-http.ts` 干的就是这件事：上游 `SECUCODE` / `CHANGE_RATE` / `TURNOVERRATE`
在 producer 层重命名成 `thscode` / `change_pct` / `turnover_rate_pct`。所以东财这批新表**没有**键名问题，
只是延续同一做法；Wind 的中文键是同一问题的恶劣版本。

### 4.3 落成硬规则（已落 `docs/dev/tool-schema.md` §10.6）

1. **进入 `data_collector` 的行键名必须是 ASCII `snake_case`**；非 ASCII 键一律在 producer 层用**显式映射表**改名。
2. 映射不到的字段**丢弃，并把口径写进该能力的 `description`**——不许原样透传给模型侧。
   ~~在回执 `omitted` 里记名~~ 这条**改掉**：`omitted` 机制今天不存在（只有 web 侧的 `omitted_pages`），
   把人设写成承诺一个不存在的通道，正是 §7 里 `final_report"协议鼓励、宿主拒绝"那一族**。
   真要用 `omitted`，先实现再承诺。
3. 上游全角/半角混排要先在**真报文**上验一遍再写映射表（§10：护栏拒绝官方示例就是真实取数事故；
   同理，映射表猜错全半角就是静默空结果）。
4. **落点分层**：这条规则约束的是**研发写 source 适配器**，运行时 Agent 无从执行，所以它进
   `docs/dev/`（研发约定），不进 persona / skill。§3 的分流判据相反——那是主 Agent 委派时的决定，
   必须进 skill。

### 4.4 Wind 结构化 MCP 的定位

`docs/design/wind-market-source.md` 的设计本身仍然成立，但按本次判据它**排不进这一轮**，两个独立理由：

- **违反 Q1**：NL 检索类入口同参数不同形状，可复现性要靠额外设计硬凑（该文档 §186 自己也把
  "NL reproducibility"列为未解风险）；
- **键名风险未清**：需要先做一次**键名 spike**——拿真实返回把全部列名、全半角、单位口径落成映射表，
  才能进 `data_collector`。spike 未完，注册即风险。

另需注意它与 §5 的免费源**正面重叠**（宏观 EDB、港美股）。路由裁决：**免费公开源先覆盖"能看趋势"，
Wind 只在需要 Wind 口径/研报级准确度时花积分**；这条要写进 `capital-data-protocol`，否则 §10 的口径冲突
与积分焦虑都会回来。

---

## 5. 补录清单（本次候选，全部零 key / 零新依赖 / 不碰 python）

实测全部打到 **2026-09-30**（最近交易日），host 都已在仓内：
`datacenter-web.eastmoney.com`（已有 5 条 capability + 共享限流客户端 `src/net/eastmoney-client.ts`）
与 `qt.gtimg.cn` / `web.ifzq.gtimg.cn`（已有 3 条 + host 轮换）。

### 5.1 东财 datacenter（`reportName` 逐条实测可达；列数=详情成本）

| 数据 | reportName | 实测 | 列数 | 必写的约束 |
|---|---|---|---|---|
| 宏观 CPI/PPI/GDP/PMI/M2/存准/新增贷款/进出口/社零/房价/FDI | `RPT_ECONOMY_CPI` `…_PPI` `…_GDP` `…_PMI` `…_CURRENCY_SUPPLY` `…_DEPOSIT_RESERVE` `…_RMB_LOAN` `…_CUSTOMS` `…_TOTAL_RETAIL` | CPI 112 页 / PPI 248 页 / GDP 82 页 | 少 | **本项目当前最大的整块空白**；Fuyao 全文零命中 |
| 沪深港通 | `RPT_MUTUAL_DEAL_HISTORY` `RPT_MUTUAL_QUOTA` | 到 2026-09-30 | 17 / 13 | ⛔ 2026-10-05 复核：**不是"全为 null"**。北向三档（沪股通 001 / 深股通 003 / 北向合计 005）的 `BUY_AMT / SELL_AMT / NET_DEAL_AMT / ACCUM_DEAL_AMT` 与 `FUND_INFLOW / QUOTA_BALANCE` 为 null，**南向三档（002 / 004 / 006）四项都有值**；成交额 `DEAL_AMT`、笔数 `DEAL_NUM` 双方都披露。所以能力名与描述里不许出现"北向资金净流入"，但南向可以给净买入。**另发现 `TRADE_QUOTA` 跨方向单位不一致**（北向 52000=520 亿元、南向 42000000000=420 亿元），禁止跨方向比较 |
| 个股主力资金 | `RPT_DMSK_TS_STOCKNEW` | 1733 页 | 31 | 补 Fuyao `code=2004` 永久关闭的那块；`PRIME_COST`=主力成本口径要在描述里说清 |
| 融资融券个股 | `RPTA_WEB_RZRQ_GGMX` | 单票 1331 页 | **45** | 先过 §2.2，否则详情必爆 |
| 可转债 | `RPT_BOND_CB_LIST` `RPT_CB_BALLOTNUM` `RPT_CB_IMPORTANTDATE` | 1059 页 / 72 列 | **72** | 同上；**转债行情本次未验**，未验不注册 |
| 股东结构 | `RPT_HOLDERNUMLATEST` `RPT_F10_EH_FREEHOLDERS` `RPT_SHARE_HOLDER_INCREASE` `RPT_ORG_SURVEY` | 1856 / 294 万 / 14.7 万 / 334 万页 | 23~47 | `END_DATE` 是**报告期不是披露日**，时间轴必须按 §1.3 归一并区分开 |
| 分红送配 | `RPT_SHAREBONUS_DET` | 5.7 万页 | 30 | Fuyao `corporate_actions` 只有除权事件，缺方案全字段 |
| 商誉 | `RPT_GOODWILL_STOCKDETAILS` | 3 万页 | 25 | 风险排查类 |
| 大宗交易 / 新股 | `RPT_DATA_BLOCKTRADE` `RPT_BLOCKTRADE_STA` `RPT_IPO_INFOALLNEW` `RPTA_APP_IPOAPPLY` `RPT_IPO_REVIEW` | **未逐条验列** | — | 未验不注册（§10） |

### 5.2 腾讯：港股 / 美股

`qt.gtimg.cn/q=hk00700`、`q=usAAPL`、`web.ifzq.gtimg.cn/…/hkfqkline|usfqkline` 实测直返。
新增 `hk_quote` / `hk_kline` / `us_quote` / `us_kline` 四条：**必须新前缀、不复用 `quote` / `history`**
（沿用腾讯首期定的命名纪律），描述里写清币种与交易时段；照 `tencent_ticks` 拒北交所的先例把覆盖缺口写明。

### 5.3 本次明确不做（一句话各归各位）

- **akshare / BaoStock / pytdx / 通达信类**：需要 python + 三方库 → 见 `docs/design/code-runtime-notes.md`；
  且分钟线与逐笔已由 `tencent_kline` / `tencent_ticks` 覆盖。
- **同花顺 `dump/market-dumps` Parquet**：三重已否决（范围 / 永久排除表 / 能力表说明 + 本地 K 线库被否）。
- **主力资金 / 高频动向（Fuyao 侧）**：`code=2004` 永久不外部接入，错误分类已定"不重试"。
- **叙事文本类新工具**：公告/研报/新闻正文已有 `wind_docs_*`、`eastmoney_reports`、`sina_reports`、`anysearch` 覆盖。

### 5.4 收录即契约

东财与腾讯这些都是**公开抓取接口，没有服务条款给我们背书**：一旦写进能力目录、配上 `summary` 与护栏，
它就是**我们承诺的契约**，上游改版由我们承担"话说错"的责任（§10 那条纪律的适用范围因此不只覆盖 Fuyao）。
三条配套约束：

1. **只自用、不再分发**——沿袭 BYOK 结论：平台共享 key / 转售第三方商业数据有许可风险，
   而公开抓取数据的再分发风险更高，能力目录与文档里都不出现"数据可导出/可转发"的暗示。
2. **每条新能力先拿真报文验过再注册**（含 `null`、单位、分页边界）；未验一律不进目录（§10 原文：
   护栏拒绝官方示例就是真实取数事故；同理，**凭印象写的 `summary` 就是静默说错**）。
3. **上游改版要有形状断言**，而不是等用户发现数字变了——新源的 `rowShape`、列名映射与
   `omitted` 行为都要有回归用例覆盖，和东财现有 5 条同等对待。

---

## 6. 落地顺序（本次迭代）

0. ✅ **体积解法已落地**（2026-10-05，提交 `666846d`）：§2.1 目录紧凑编码 + §2.2 详情字段字典 +
   §2.1 的分隔符转义护栏。验收到位：预算注释写死实测 2435/6144、`capital-data-protocol` §1.1
   那两行改写、`npm test` 739 全绿、`npm run smoke:boot` 挂载与 `npm run check:dsh` 25 条账本全过。
   **实测余量**：目录 69 条 = 2435 字符（40%），最大详情 2771 字符（68%）。
1. ✅ **键名与归属规则已固化**（同一天）：§3 四问 + 终判据进 `capital-orchestration` §5，
   `capital-web-protocol` §1.2、`capital-data-protocol` §1 各一条，`test/persona.test.mjs` 有断言；
   §4.3 键名纪律进 `docs/dev/tool-schema.md` §10.6（研发侧，见该节第 4 条的分层理由）。
2. **东财 datacenter 补录**，按"窄表先走、宽表后走"排：宏观 → 沪深港通（含 `null` 陷阱的响亮失败）→
   个股主力 → 分红送配 → 股东结构 → **然后**两融 / 可转债（45/72 列）。
   每条都要：`npm run docs:capabilities` 同步能力表、真报文先验（§10）、`test/apply-integration.test.mjs`
   的 capability 总数断言跟着改。
3. **腾讯港美股四条**。
4. **Wind 结构化 MCP** 另案：先做键名与可复现性 spike，spike 不过就不注册。

---

## 7. 实测复现（本文数字全部来自这三步）

环境：WSL2 / Linux x64、`@deepseek-ai/dsh@0.2.0-rc.2`、本仓 `lib/`（已 build）。

```bash
# ① 目录与详情体积、编码对比、余量
node -e "import('./lib/data-collector/hub.js').then(async ({DataCollectorHub}) => { … })"
#    69 条 / 目录 5530 字符（90.0% of 6144）/ 均摊 80；紧凑行编码 2435（40%）/ 均摊 35
#    JSON 键与标点开销 3234（58%）；分隔符 | : ; 换行 制表符 在 summary 中命中 0
#    详情最大 dragon_tiger 3891（95% of 4096），其中 output_schema 3062（79%）
#    分域：fund 1182 / special 464 / a-share 359 / eastmoney 198 / index 129 / tencent 98
# ② 宽表成本（构造 JSON Schema 按列数）
#    17 列 1289 → 30 列 2095 → 45 列 3025 → 72 列 4699
# ③ 上游可达性与新鲜度：东财 datacenter 各 reportName、腾讯 hk/us/分时，均 200，最新 2026-09-30
```

宿主侧事实的出处：`dsh-base/cordis.patch.yml:404-419`（`spill-local` + `spill-policy maxInlineTokens: 12500`
+ `tool-result-pruner`）、`dsh-spill-policy/lib/index.js:237`（`ctx.on("tools/post-execute")`）、
`dsh-compaction-tool-result-pruner/README.zh.md`（"压缩触发条件满足后…未达到压力阈值的对话保持不变"）。

### 7.1 第 2 步·宏观批次的真报文核验（2026-10-05，已注册）

每表取 200 行（GDP 82 行、存准率 58 行为全量）统计缺键与空值：

| reportName | 期数与深度 | 列数 | 缺键 | null 分布 |
|---|---|---|---|---|
| `RPT_ECONOMY_CPI` | 224 期，2010-01..2026-08 | 14 | 0 | 无 |
| `RPT_ECONOMY_PPI` | 248 期，2010-01..2026-08 | 5 | 0 | 无 |
| `RPT_ECONOMY_GDP` | 82 期，2006-Q1..2026-Q2 | 10 | 0 | 无 |
| `RPT_ECONOMY_PMI` | 225 期，2010-02..2026-09 | 6 | 0 | 无 |
| `RPT_ECONOMY_CURRENCY_SUPPLY` | 224 期，2010-01..2026-08 | 11 | 0 | 无 |
| `RPT_ECONOMY_RMB_LOAN` | 224 期，2010-01..2026-08 | 7 | 0 | 无（**含负值**：2025-07 为 -5896） |
| `RPT_ECONOMY_CUSTOMS` | 224 期，2010-01..2026-08 | 12 | 0 | 无 |
| `RPT_ECONOMY_TOTAL_RETAIL` | 209 期，2008-10..2026-08 | 7 | 0 | **`RETAIL_TOTAL` 15/200、`_SAME` 15/200、`_SEQUENTIAL` 30/200** |
| `RPT_ECONOMY_DEPOSIT_RESERVE` | 58 条事件，2007-01..2025-05 | 14 | 0 | **`REMARK` 30/58** |

- 结论 1：**数值列一律按可空声明**（`oneOf [number, null]`），社零与存准率都实测到 null；
  null 原样保留，不补 0、不删列（删列会让 `query_dataset` 把"没有这列"和"这期没数据"混成一件事）。
- 结论 2：这批全是**窄表**（≤14 列），字典投影后详情最大 1648 字符（存准率）——§2.2 的收益要到
  两融 45 列 / 可转债 72 列那批才真正兑现。
- 结论 3：单位口径分级。**亿元**（量级核对）：GDP 累计、M0/M1/M2、新增贷款、社零；
  **百分数原值**：`*_SAME` 同比、`*_SEQUENTIAL` 环比、存准率与次日大盘涨跌；
  **指数**（上年同月=100）：CPI/PPI 的 `_BASE` / `_ACCUMULATE`；PMI 两项是指数（50 为荣枯线）。
  ⛔ **进出口金额单位未核验**：`EXIT_BASE=401440956.924` 与美元、人民币两种口径的量级都只能对上其一，
  所以 `eastmoney_customs_trade` 的 description 明令"只用于趋势与同环比，禁止换算成元或美元写进结论"。
  这就是 §5.4"凭印象写的 summary 就是静默说错"的具体形态。
- 结论 4：`RPT_ECONOMY_DEPOSIT_RESERVE` 是**事件表**，`filter` 窗口 2025-01..2025-04 返回
  `code=9201`（区间内确实没有降准）→ 走既有 9201 归类：**空结果而非上游故障**，不重试。
- 复现口径：`GET https://datacenter-web.eastmoney.com/api/data/v1/get`，参数
  `reportName=<表名>&columns=ALL&source=WEB&client=WEB&sortColumns=REPORT_DATE&sortTypes=-1&pageNumber=1&pageSize=200`，
  过滤器写法 `(REPORT_DATE>='YYYY-MM-DD')(REPORT_DATE<='YYYY-MM-DD')`。
- 容量核对：宏观九条注册后是 **78 条 = 2795 字符（45.5% 预算）**；加上沪深港通两条后 **80 条 = 2880 字符
  （46.9%）**。同一份 80 条若还走编码前的 JSON 数组编码是 **6460 字符，已经越过 6144 自预算**——
  第 0 步不先落地，这两批补录就会把目录撞爆（正是 §2 预判的那件事）。

### 7.2 第 2 步·沪深港通的真报文核验（2026-10-05，已注册两条）

`RPT_MUTUAL_DEAL_HISTORY` 取 500 行按 `MUTUAL_TYPE` 分组，并用同一交易日的金额做加法核对：

| MUTUAL_TYPE | 上游自标名称 | 成交额 DEAL_AMT（2026-09-30） | BUY/SELL/NET/ACCUM |
|---|---|---|---|
| `001` | 沪股通（北向） | 101257.88 | **null** |
| `003` | 深股通（北向） | 106683.74 | **null** |
| `005` | 北向合计 | 207941.62 = 001+003 ✓ | **null** |
| `002` | 港股通(沪)（南向） | 46015.39 | 有值 |
| `004` | 港股通(深)（南向） | 23911.48 | 有值 |
| `006` | 南向合计 | 69926.87 = 002+004 ✓ | 有值 |

- **纠正 §5.1 的原判断**："北向净买入停止披露"是真的，但**南向仍披露**，所以不能整表按"只有成交额"
  设计。落地成一条 `eastmoney_mutual_flow`，用 `channel` 六档枚举选渠道，行里带 `channel` 语义名与
  `channel_code` 原值；描述里明写"本能力不提供北向净买入"（§7 那类"协议鼓励、宿主拒绝"的错误不能再犯）。
- 渠道身份不靠记忆：由上游 `MUTUAL_TYPE_NAME` 自标 + 同日成交额加法核对（两条等式精确成立）确认。
- `HOLD_MARKET_CAP`：北向单渠道 null、**北向合计给 0**（占位而非真实市值）——原样保留 0，
  由描述负责说明，不在 producer 里改成 null（那与"把 null 补成 0"是同一类擅自改数）。
- `RPT_MUTUAL_QUOTA` 是**当日四条快照**（实测全表 count=4、无历史），因此注册成不分页、`cacheMaxAgeMs`
  60 秒的快照能力，`captured_at` 才是采集时间；`START_TIME / END_TIME` 实测全为 null，不收录。
- ⛔ 新发现的口径陷阱：同一列 `TRADE_QUOTA` 在两个方向单位不同（北向 52000 对应官方 520 亿元、
  南向 42000000000 对应 420 亿元）。这类"同列不同单位"无法由 producer 判定，只能在 description 里
  禁止跨方向比较——与 §7.1 结论 3 的进出口金额同一族。
- **本批未注册**：`RPT_MUTUAL_BOARD_HOLDRANK_WEB`（35 列、579 万行，但实测 `sortColumns=TRADE_DATE&sortTypes=-1`
  返回的最新记录停在 **2024-08-16**；先要弄清它是整表停更还是某个 `INTERVAL_TYPE` 维度未筛，未弄清不注册）、
  `RPT_MUTUAL_HOLD_DET`（个股持股明细，未逐列核验）。两条留作下一批。


