# 数据补录与能力目录容量（本次迭代聚焦）

> 状态：**已评审通过，第 0–3 步已全部落地并经 Agent 侧实测回评**（东财补录 16 条 + 腾讯港美股 4 条，
> 目录 69 → 89 条 = 预算 53.4%；实测打出一处阻断缺陷——四条 `ticker` 能力的单票过滤被自己的二次归一化
> 拒掉，已修并补全量结构性回归，见 §7.8；第 4 步 Wind 结构化 MCP 另案，等 spike 结论再决定注不注册）。
> 日期 2026-10-05。
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

> **2026-10-05 实测校订（上面那句预测漏了描述）**：字典与 `description` **共用同一个 4096**。
> 真把东财转债表 72 列全收（其中 13 列恒 null、没有承诺价值）并把六条陷阱写进描述，详情实测
> **4995 字符 = 超预算 899**；只取"有值且口径可承诺"的 29 列才落到 3738（预算 91.3%）。
> 结论要改口径：字典消掉的是**逐列 JSON Schema 那 ~3.4KB 固定开销**，不是"宽表随便加列"的许可证——
> 一张表要么减列、要么减描述，不能同时要。合成回归钉住了这两面（`test/data-collector-hub.test.mjs`：
> 72 列 + 一句话描述 < 4096，72 列 + 真实长度描述 > 4096）。
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
| 个股主力资金 | `RPT_DMSK_TS_STOCKNEW` | **只有查询日**：实测 5199 行、TRADE_DATE 单一，带旧日期过滤器返回 9201 | 31 | 补 Fuyao `code=2004` 永久关闭的那块，但只能以**快照**形态补：参数面不给日期，`main_cost`=主力成本价（元/股），比例类列口径未核验（`_raw` 后缀） |
| 融资融券个股 | ✅ `RPTA_WEB_RZRQ_GGMX` 已注册为 `eastmoney_margin_trading` | 单票 3992 个交易日 | **45 → 42 列取用** | §2.2 的兑现处：字典形态详情 2993 字符（73% 预算），同一份直发 JSON Schema 是 4479 > 4096 |
| 可转债 | ✅ `RPT_BOND_CB_LIST` 已注册为 `eastmoney_convertible_bond_list`；`RPT_CB_BALLOTNUM` `RPT_CB_IMPORTANTDATE` 未验 | 全库 1059 只，起息日 2007-07-02 至今 | **72 → 29 列取用** | ⛔ 2026-10-05 逐列核验：**这张表根本不含行情**——转债现价/正股现价/最新转股价/赎回回售触发价/PBV 实测 1059/1059 恒 null，转股溢价率恒为占位值 100。可承诺的是发行条款与日期；`ACTUAL_ISSUE_SCALE` 单位亿元（浦发 500 对上公开事实、南药 10.81491 精确到元），`BOND_EXPIRE` 是**实际存续年数**而非合同期限（提前赎回按实际终止日） |
| 股东结构 | ✅ `RPT_HOLDERNUMLATEST` 已注册为 `eastmoney_holder_number_snapshot`；`RPT_F10_EH_FREEHOLDERS` `RPT_SHARE_HOLDER_INCREASE` `RPT_ORG_SURVEY` 未验 | 5568 只截面 | 20 | `END_DATE` 是**报告期不是披露日**（实测茅台 2026-06-30 / 披露 2026-08-15），已分列；**只有最新一期，取不到历史** |
| 分红送配 | ✅ `RPT_SHAREBONUS_DET` 已注册为 `eastmoney_dividend_plan` | 56976 条，可翻回 1991 | 30 | Fuyao `corporate_actions` 只有除权事件，缺方案全字段；送转与派息是**每 10 股**口径 |
| 商誉 | `RPT_GOODWILL_STOCKDETAILS` | 3 万页 | 25 | 风险排查类 |
| 大宗交易 / 新股 | `RPT_DATA_BLOCKTRADE` `RPT_BLOCKTRADE_STA` `RPT_IPO_INFOALLNEW` `RPTA_APP_IPOAPPLY` `RPT_IPO_REVIEW` | **未逐条验列** | — | 未验不注册（§10） |

### 5.2 腾讯：港股 / 美股 ✅ 四条已注册

`qt.gtimg.cn/q=hk00700`、`q=usAAPL`、`web.ifzq.gtimg.cn/…/hkfqkline|usfqkline` 实测直返。
新增 `tencent_hk_quote` / `tencent_hk_kline` / `tencent_us_quote` / `tencent_us_kline` 四条：**新前缀、
不复用 A 股的 `quote` / `kline`**——逐列核验后发现同一位序在两个市场含义不同（换手率港股第 59 位、
美股第 38 位、A 股第 38 位；币种 A 股没有、港股第 75 位、美股第 35 位；成交额在港股**指数行**还是万元），
共用一张表必然说错话。币种、交易时段与覆盖缺口都写进描述（实测细节见 §7.7）。

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
2. ✅ **东财 datacenter 补录已走完**（2026-10-05）：按"窄表先走、宽表后走"排序落成
   宏观 9 → 沪深港通 2 → 个股主力 → 分红送配 → 股东户数 → 两融 42 列 → 可转债 29 列（72 列取用），
   实测记录在 §7.1–§7.6。每条都做了 `npm run docs:capabilities` 同步、真报文先验（§10）与
   `test/apply-integration.test.mjs` 的 capability 总数跟着改。**下一步不是继续加东财表**：
   剩下的候选（§7.7）都还欠逐列核验，按"未验不注册"停在这里。
3. ✅ **腾讯港美股四条已注册**（2026-10-05）：`tencent_hk_quote` / `tencent_us_quote` / `tencent_hk_kline` / `tencent_us_kline`。三处「多看几个样本才敢定的口径」见 §7.7。
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
  两融 42 列 / 可转债（72 列取 29）那批才兑现，兑现时带出一条校正：**列数与描述共用 4096**（见 §2.2 校订）。
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
- 容量核对：宏观九条注册后是 **78 条 = 2795 字符（45.5% 预算）**；加上沪深港通、主力资金、分红送配与
  股东户数后 **83 条 = 3027 字符（49.3%）**。同一份 83 条若还走编码前的 JSON 数组编码是 **6739 字符，
  已经越过 6144 自预算**——第 0 步不先落地，这几批补录就会把目录撞爆（正是 §2 预判的那件事）。

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

### 7.3 第 2 步·个股主力资金（2026-10-05，注册为 `eastmoney_main_capital_snapshot`）

`RPT_DMSK_TS_STOCKNEW` 31 列，取 200 行核验：`SECUCODE / TRADE_DATE / PRIME_*` 零缺键，
`CHANGE_RATE` 与 `TURNOVERRATE` 各 2/200 为 null（停牌或当日无成交）。**关键形状事实**：返回的
5199 行只对应**一个** `TRADE_DATE`，带 `(TRADE_DATE='2026-09-25')` 过滤器返回 `9201` 空——上游只滚动
保留最近一个交易日的全市场截面。

所以这条注册成**快照能力**而不是序列表：参数面**没有日期**（给了就 `unsupported parameter` 响亮拒绝），
默认按主力净流入降序、可用带市场后缀的 `ticker` 收窄到单票、`cacheMaxAgeMs=60_000`。描述里写死
"不要按日期循环请求"，否则模型会把 9201 当成取数失败反复重试。它补的正是 Fuyao `code=2004`
永久关闭的那块盘面数据。

字段口径分两级写进 `description`：

- 有承诺：`main_cost*` 是主力成本价（元/股，与 `close_price` 同量纲，用于判断现价在主力成本上方还是
  下方）；`change_pct` / `turnover_rate_pct` 是东财百分数原值，与本仓既有东财能力同口径；金额列
  （`main_net_inflow` 与各档 `*_inflow` / `*_outflow`）实测量级对应元（茅台 5.3 亿、小盘股 -382 万）。
- 无承诺：`*_ratio_raw`、`org_participate_raw` 的比例口径未核验（0.1198 可读作 0.12% 也可能读作
  11.98%），只允许同列相对比较；`rank / rank_up / total_score / focus` 是东财自有打分、跨日不可比；
  `participate_type` 是上游类型码原文，未做翻译。`SECURITY_INNER_CODE` / `TRADE_MARKET_CODE` 这类
  内部编码不取进行。
- `SECUCODE` 丢市场后缀时直接判 `eastmoney_invalid_response`，**不按代码首位猜市场**——猜错就是把
  一只股票的数据挂到另一只上。

### 7.4 第 2 步·分红送配与股东户数（2026-10-05，注册 `eastmoney_dividend_plan` / `eastmoney_holder_number_snapshot`）

`RPT_SHAREBONUS_DET` 取 200 行核验（56,976 条，最早 1991 年）：

- 送转与派息的标度**由上游自己写在原文里**（`IMPL_PLAN_PROFILE="10派280.2423元(含税)"` 配
  `PRETAX_BONUS_RMB=280.2423`、`"10送4.00派3.00元"` 配 `BONUS_RATIO=4`），所以按"每 10 股"承诺并且
  保留 `plan_profile` 原文供对照。纯派息方案的三个送转列**同时为 null**，是形态不是缺数。
- 四个日期各司其职：`report_date`（报告期）/ `plan_notice_date`（预案）/ `notice_date`（实施公告）/
  `equity_record_date`（登记日，实测 12/200 为 null——方案还没定登记日）/ `ex_dividend_date`（除权日，
  实测无空值，作为时间轴与区间过滤器）。前三列实测从不缺席，因此按**必填**处理：缺一即
  `eastmoney_invalid_response`，不悄悄交出 null。
- `EX_DIVIDEND_DAYS` 对未来除权日是**负数**（实测 -17），原样保留。
- `IS_KCB` 与 `PUBLISH_DATE` 实测 200/200 全 null → 不收录，并在描述里点名，免得被当成取数失败；
  `SECURITY_INNER_CODE` / `ORG_CODE` / `MARKET_TYPE` 内部编码同样不进取。
- `DIVIDENT_RATIO` 与 `D10/BD10/D30_CLOSE_ADJCHRATE` 的比例与复权口径未核验 → 命名带 `_raw`，只允许同列比较。

`RPT_HOLDERNUMLATEST` 实测 5568 只、**一股一行**：这是最新一期**截面**，上游不提供历史序列，所以参数面
没有日期（给了就 `unsupported parameter` 拒绝），描述写死"要历史就如实说覆盖不了"。
`END_DATE`（报告期）与 `HOLD_NOTICE_DATE`（披露日）分列——正是 §5.1 当初标的那条陷阱，实测茅台
报告期 2026-06-30、披露 2026-08-15。新股实测 `PRE_HOLDER_NUM=0` 且 `HOLDER_NUM_RATIO=null`
（无上期可比），保留 null 不写成 0%。`CHANGE_REASON` 是中文原因原文（「发行融资」/「资产重组」），
照存不改写；`PRE_E_DATE` / `HOLD_N_DATE` 这种 `03/31` 短标签与 `ORG_CODE` 不进取。

### 7.5 第 2 步·两融个股明细（2026-10-05，注册 `eastmoney_margin_trading`）

`RPTA_WEB_RZRQ_GGMX` 实测 45 列、单票 3992 个交易日（约回到 2010）。这一条是 §2.2 的**兑现处**：
映射后取用 42 列，字典形态详情 **2993 字符 = 预算 73%**，而同一份详情改回逐列 JSON Schema 是
**4479 > 4096**——不做投影，这张表第一次注册就会把详情预算打穿（回归里两种形态都断言了）。

口径不靠记忆，靠上游自己给出的加减关系（实测 600519 与 000001 都精确成立）：
`RZRQYE = RZYE + RQYE`、`RZRQYECZ = RZYE - RQYE`、`RZJME = RZMRE - RZCHE`、`RQJMG = RQMCL - RQCHL`、
`RZYEZB = RZYE / SZ`（0.8617% 对得上）。所以这些列的含义与"元"量纲可以写进契约；
`FIN_BALANCE_GR` 的增长口径推不出唯一解释，命名带 `_raw` 并只做同列比较。

两条真实陷阱进了描述：
- **披露新鲜度跨市场不一致**：同日查询沪市（600519）最新 2026-09-30，深市（000001）只有 2026-09-29。
  两市当天并排比就会得出错误结论，所以时间契约挂 `warning`，描述要求先对齐到共同日期。
- `SCODE` 不带市场后缀，行身份只能用**请求传入的 canonical 代码**；同时与上游 `SECUCODE` 对照，
  不一致就 `eastmoney_invalid_response`——否则就是"把 A 票的两融挂到 B 票名下"。
  融券流量量纲是**股数**（与金额族不可相加）、`_3d/_5d/_10d` 是滚动累计（不是日均），也都写明。

### 7.6 第 2 步·可转债（2026-10-05，注册 `eastmoney_convertible_bond_list`）

`RPT_BOND_CB_LIST` 整表 72 列、1059 只（起息日 2007-07-02 至 2026-09-29，含已摘牌与老三板退市债）。
逐列核验的结论是**这张表给不了行情**：`CURRENT_BOND_PRICE` / `CONVERT_STOCK_PRICE` / `TRANSFER_PRICE` /
`RESALE_TRIG_PRICE` / `REDEEM_TRIG_PRICE` / `PBV_RATIO` / `MARKET` / `CONVERT_STOCK_PRICEHQ`
实测 **1059/1059 恒为 null**，`TRANSFER_PREMIUM_RATIO` 恒为占位值 **100**（东财页面上那些数是另一条
行情接口现算的）；`TRANSFER_VALUE` 与 `INITIAL_TRANSFER_PRICE` 实测相同却多 8 个 null。所以注册成
**发行清单与条款要素**，29 列取用，描述里点名的丢弃列就是"这不是取数失败"的凭据。

口径证据（都来自 live 报文，不是记忆）：
- **发行规模单位是亿元**：浦发转债 500（公开事实）、南药转债 10.81491 有小数五位 = 元级精度写成亿元。
- **`FIRST_PER_PREPLACING` 是每股获配面值（元/股）**：500 亿 / 浦发银行 293.5 亿股 = 1.703，与上游值
  逐位相符；若它是"每 10 股"或"张数"都对不上这个除法。
- **`COUPON_IR` 是当前计息年度的票面利率、百分数原值**：福蓉转债阶梯原文「…第四年1.50%…」，
  起息 2023-07-18、今天落在第 4 个计息年度，列值给 1.5；且**所有非空行**的 `IB_START…IB_END` 都跨过查询日。
- **`ONLINE_GENERAL_LWR` 只能读作百分数**：2007 首批 1.33~5.31、2019 浦发 0.30、2026 年 0.0009~0.0033。
  按小数读会得出 531% 的中签率（不可能），按百分数读才同时成立且年代单调。
- **`BOND_EXPIRE` 是实际存续年数**：`EXPIRE_DATE − VALUE_DATE` 逐年对上（豫光转债合同 6 年、
  2025-12-19 提前终止 → 1.3534）。拿它当"合同期限"就会把短存续的债读成六年期品种。

三条真实陷阱写进契约与描述：
1. **日期轴只能用起息日**。`PUBLIC_START_DATE` 与 `VALUE_DATE` 实测 1059/1059 相同且从不为空；
   `LISTING_DATE` 有 8 只"已发行未上市"为 null——按上市日过滤会静默吞掉它们（§1.3 那一族：
   过滤器打在会为空的列上，就是话说错）。`DELIST_DATE` 实测 4 条是**将来**日期（已公告待摘牌），
   所以描述写"null=尚未摘牌"而不写"有值=已摘牌"。
2. **正股市场不许按代码首位推**。`TRADE_MARKET` 与代码前缀交叉表实测：`CNSESH/11`:480、`CNSESZ/12`:559、
   `STAS00/40`:5，另有 **`CNSESH/12`:14 与 `CNSESZ/11`:1**（2007-2009 的 126 段沪市老债）。老三板退市债
   404005.NQ 的正股是 400266——若走 `marketFromAshareDigits`（4/8/92 → 北交所）就会给它编一个 `.BJ`。
   所以本能力自带一份按 `TRADE_MARKET` 的映射，未知市场只给 `stock_ticker` 不给后缀。
3. **15 只老债同批缺四列**（14 只 126 段 + 115003.SZ）：转股起止、初始转股价、`IS_CONVERT_STOCK` 一起为
   null，那是分离交易可转债的产品形态；`INTEREST_RATE_EXPLAIN` 对它们还是"票面利率预设区间……协商确定"
   的发行前文本，不能当成交利率——描述都写明了。

容量：85 条目录 3126 字符（50.9%），同一份 JSON 数组编码是 6926 > 6144 自预算。本条是**全仓最大详情**
3738 字符（91.3%），瓶颈已从列数挪到描述（见 §2.2 的校订）。live 双向复核跑的是注册后的
`source.execute`（九月新债 9 只、单债 110059、按正股 600000 收窄、老三板 404005、2008 年 126 段 16 只、
空区间 9201 走空结果），九条断言全过；fixture 回归另覆盖畸形 SECUCODE / 畸形日期 / 畸形代码参数
（出网前拒绝）与"恒 null 列不得漏进取"。

### 7.7 第 3 步·腾讯港美股（2026-10-05，注册四条）

四条能力：`tencent_hk_quote` / `tencent_us_quote` / `tencent_hk_kline` / `tencent_us_kline`。
这一批的教训几乎全部来自"**同一位序在不同市场不是同一个意思**"，逐列核验前无从推断：

| 项 | A 股 | 港股 | 美股 |
|---|---|---|---|
| 币种列 | 没有 | 第 75 位 | 第 35 位 |
| 换手率 | 第 38 位 | 第 59 位（分母=总股本） | 第 38 位（分母=**总股本**） |
| 成交额 | 第 37 位（万元） | 个股第 37 位=**港元**、指数行=**万元** | 第 37 位（美元） |
| 股本 | — | 只有一个数（44/45 两列市值恒等） | 流通与总两列真的不相等 |
| 涨跌停 | 有 | **没有** | **没有** |

三条只能靠多打几个样本才浮出来的事实：
1. **换手率的分母**。第一版按苹果推断成"流通股本"（33,278,552 ÷ 14,585,108,878 = 0.228% ≈ 给的 0.23），
   加到 GOOGL / BRK.B 就露馅：按流通算是 0.41 / 0.34，按总股本是 0.194 / 0.196，与给的 0.19 / 0.20 吻合。
   苹果与阿里两个分母几乎相等，**是无效样本**——这批唯一能定分母的是多级股票类别。已按总股本写进契约，
   回归里 BRK.B 那一行同时断言"按流通算会差 0.14"。
2. **快照的 52 周高低两列不可信**。实测腾讯给 677.2/411 而近 252 个交易日是 683/411；汇丰给
   168.916/94.532 而实际 169.7/100.4；苹果给 345.34/242.76 而实际 345.34/243.42。窗口口径推不出来，
   **两列都不收录**，描述指回 K 线自己算。
3. **美股写法必须由上游裁决**。腾讯快照只认不带后缀的形式（`usBABA.N` 整行不回、`usBABA` 回），
   K 线却只认带正确后缀的形式（`usAAPL` 回一列 2011 年起的陌生序列、`usAAPL.NS` 静默回 0 行）；
   而点号既可能是级别码（BRK.B / BF.B）也可能是交易所码（BABA.N），字面上分不开。
   所以两位以上尾段直接剥掉，单字母尾段照原样先问、没回行再剥一段重问（`resolveUsKlineSymbol` 同理）——
   猜错只多一轮请求，猜错第二次就是把数据挂到别的标的上。

覆盖面缺口按 `tencent_ticks` 拒北交所的先例写死在描述里：港美股**没有分钟线**（实测 hk 走 mkline 连接失败、
走 proxy 回 code -1）、**不支持日期区间**（实测 hkfqkline 忽略 start/end，带 2024-01-01..2024-03-01 与
count=640 仍回最近 640 条），所以参数层直接拒绝 start/end 而不是静默忽略；美股**不提供 hfq**（实测 usfqkline
把 hfq 映射成与不复权逐位相同的价格序列，苹果 2025-06-26 给 201.43/201.00 而 qfq 给 200.46/200.04）；
美股 K 线**只有 OHLCV**（两个可用入口都只回六列，多出来的列只在那个被拒绝的形态里）；港股指数拒收
（指数行的第 6/37 位量纲与个股不同，两种单位不许进同一列）。

正面收获：港股 K 线的成交额列名带单位（`amount_wan_hkd`，实测与快照的港元原值差整整 1e4），
每手股数是真实差异（腾讯 100 / 汇丰 400），行情时间戳**同一份响应里 `2026/10/05` 与 `2026-10-05` 并存**
（解析两种都吃），美股 `quote_time` 是美东时间（实测周一北京清早取到的仍是 2026-10-02 16:00:01）。
另有一条护栏差异是必要的：港美股 K 线入口对 `code:1 / bad params` **直接判定为参数错误并一次即停**，
不套用 A 股那套"空返回就换机并拉黑 120 秒"——把写错的参数算成机房故障会一次污染三个入口
（回归 `上游拒参数不拉黑其他入口` 钉住只发一次请求）。

容量：89 条目录 3280 字符（53.4%），同一份 JSON 数组编码 7260 > 6144 自预算；最大详情仍是转债表 3738。

### 7.8 验收回评：Agent 侧实测打出的阻断缺陷（2026-10-05 修复）

子 Agent 按 `force_refresh=true` 逐条真实请求本轮 20 条新能力，18 条通过；`eastmoney_dividend_plan`
与 `eastmoney_margin_trading` 完全不可用，`eastmoney_main_capital_snapshot` 与
`eastmoney_holder_number_snapshot` 只能取全市场截面、单票过滤失效。报错统一是
`request_params_invalid: unsupported parameter: thscode`，报告把它归给"宿主把 ticker 归一化成了 thscode"。

**真凶在我们自己**：归一化按设计要跑**两遍**（Hub 入队前一次——merge key 与 digest 用规范化参数；
`createSource` 的 execute 内再一次——直连调用也要生效，`fuyao-rest.ts` 把这条写成注释"幂等"）。
Fuyao 的参数名与上游一致，所以天然幂等；本轮新增的四条东财能力在 `normalize` 里把 `ticker`
**改名**成内部叫法 `thscode`，第二遍 `assertKnown` 只认声明过的 `ticker`，于是自己的护栏拒了
自己规范化出来的键。本文件里早有正确写法（`normalizeTicker`：键名不动、只把值换成 canonical），
新代码没沿用。

修的是四条：normalize 就地归一化（`ticker: identity.thscode`），五处 execute 读取点跟着改。
红绿都验过——把构建产物临时还原成改名形状，Hub 路径逐条复现 `unsupported parameter: thscode`；
修复后同一走法打到真实上游，四条分别带上 `(SCODE="600519")` 与 `(SECUCODE="600519.SH")`。

**为什么 766 个测试全绿却漏了**：`test/eastmoney-source.test.mjs` 里那条幂等回归是**手抄两条**样例，
新能力进不了它的覆盖；而所有单测都直接调 `source.execute`（归一化只跑一遍），没有一条走过 Hub。
新增 `test/source-normalize-contract.test.mjs`，把这条不变量做成结构性的：① 样例表必须覆盖 21 东财
+ 7 腾讯的**全部**注册能力（缺能力即失败，不静默少测，口径与 `scripts/smoke-fuyao.mjs` 的 `PARAMS`
一致）；② 归一化**不得发明模型没声明的键**（输出键 ⊆ `input_schema.properties`）；③ 双跑幂等；
④ 走 Hub 的真实入口，断言请求真的带着单票 filter 到达上游。写这条回归的当场就抓出第二处错
（我给 `tencent_ticks` 的样例带了 `count`，而它只有 `code`）。原来的手抄两用例已删，由这条全量覆盖取代。
**覆盖边界要说明白**：这条回归扫的是 28 条公开 HTTP 能力；Fuyao 那 61 条不在表内，它的双跑幂等靠的是
`fuyao-rest.ts` 里那句注释约定与历史上真实走过 Hub 的取数记录——要把它也钉住，得先把
`scripts/smoke-fuyao.mjs` 的 `PARAMS` 从脚本里提成可导入的一张表（一处样例，两处消费）。

同批报告里另有三条**不是缺陷**，记录以免重复追查：北向四列金额为 null 是已经写进
`eastmoney_mutual_flow` description 的披露停更边界；"量纲要回 `describe_capability` 读"是 §1.4/§2.2
的设计（profile 不携带单位）；"tencent 无日期区间"只对港美股两线成立——A 股 `tencent_kline` 支持
`start`/`end`，港美两线则是刻意不让 `start`/`end` 进 `input_schema` 并在 normalize 里显式拒绝。
股东户数的极端比值是真数据：已把"基数极小时比值失真（实测降序前五名上期户数 60/4/6/7/17，
长鑫科技 60 → 3,456,664 户给 +5,761,006.67%）"与"`end_date` 只是**最新披露的一期**，停更票会停在
多年前（实测 601865 停在 2019-02-15）"补进 description。

### 7.9 尚未注册（"未验不注册"仍然生效）

`RPT_MUTUAL_BOARD_HOLDRANK_WEB`（最新记录停在 2024-08-16，先弄清是整表停更还是维度未筛）、
`RPT_MUTUAL_HOLD_DET`、十大流通股东 `RPT_F10_EH_FREEHOLDERS`、增持 `RPT_SHARE_HOLDER_INCREASE`、
机构调研 `RPT_ORG_SURVEY`、可转债其余三表 `RPT_CB_BALLOTNUM` / `RPT_CB_IMPORTANTDATE` / 转债行情
（本表不含行情，要现价得先验出另一条端点）；大宗交易与新股五表在设计阶段就标了未验不注册。





