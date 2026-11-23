# a-stock-data 上游复核（2026-11-22）：87 端点全量对账、Python 运行时增量与 CapGen 缺口优先级

> 状态：**调研完成，未改代码**。上游 `simonlin1212/a-stock-data` v3.10.4（2026-11-04，72 commits）；
> 本地 `docs/data-collector-capabilities.md` 的 **135 条 capability** + **17 个 `web_retriever` 工具**。
> 需求侧：`~/.dsh/storages/capital_automation.json` 的 **87 份简报 / 668 条 gaps**（2026-11-04–11-21），
> 其中 **11-14 之后 42 份 / 372 条**；缺口总账仍以
> [`data-capability-gaps-2026-11.md`](data-capability-gaps-2026-11.md) 的 18 条 backlog 为基线。
>
> 方法：git 全历史 + `SKILL.md` 十五层逐节通读（L1–4 / L5–10 / L11–15 三组并行、逐条标注本地覆盖）；
> 本地能力总表与工具面逐条对照；私有 Python 运行时（3.13.17）真实探针；上游 CHANGELOG/测试/依赖核对。
> **标注**：「实测」= 本机 2026-11-22 真实请求；「上游自述」= 仅转述上游文中实测，未独立复验；
> 「未验证」= 需要先 spike 才能当结论。
>
> **一句话**：上游 v3.10.0 之后**没有新增端点**，只有 4 个数据修复版本；87 个端点里约 **22 组仍缺**，
> 但 Python 运行时真正解锁的只有 **BaoStock（TCP）与 Excel 官方源**，不是「整个上游可以平移」。
> 按已记录缺口，接下来的优先级应是：**先修 2 个口径缺陷（P0），再做 5 个低成本高需求能力（P1）**；
> 上游能补的只有 A5 / X1 / F1 的 CN 腿 / M1 的两条腿，**补不了 H1、A2 以及美股/港股相关缺口**。

---

## 0. 一页结论

### 0.1 三个问题的直接回答

| 问题 | 结论 |
|---|---|
| 上游最近新增了很多接口吗？ | **没有**。上次核对基于 v3.10.0（2026-09-24）；之后只有 v3.10.1–v3.10.4 四个补丁版本（10-07 / 10-11 / 10-23 / 11-04），**入口数与来源数都不变**（87 = 82 主 + 5 备胎、34 源），四个版本全是数据/口径修复，无新端点。真正的端点扩张是 v3.9.0（+25，09-20）与 v3.10.0（+2，09-22），都发生在上次核对之前；上次只复核了 5 个新闻/问答来源，**其余约 80 个端点一直没被逐条评估**——这次补上了。 |
| Python 运行时能平移多少数据能力？ | **增量很小，且不在「HTTP 端点」上**。上游 76 个主端点条目里，绝大多数是纯 HTTP + JSON/CSV，TS 侧已经覆盖 28 组；Python 真正多出来的只有两类：① **BaoStock**（自有 TCP 协议，上游唯一能拿日频历史估值与退市日的源，本地无等价物）；② **xls/xlsx 官方文件**（社融、申万历史、中证指数估值）。而且当前 base pack **没有 `requests` / `certifi` / `openpyxl` / `xlrd` / `baostock`**，`PythonRuntimeManager` **没有 `run()`**（worker 有 `run` 子命令，M5 `run_analysis` 未实现），所以「平移」不是打开开关，仍要新建一条受控的 Python 数据通道。 |
| 接下来的优先级？ | **P0（1–2 天，不新增能力）**：`tencent_kline` 科创板成交量单位契约、`sina_reports` 假空页节流。**P1（下一迭代，TS HTTP）**：ETF 期权 → A50 → 证券画像（行业/ST 两腿）→ 指数估值 → 事件驱动包。**P2（需 Python/xls 通道或需求低）**：BaoStock 历史估值/退市日、社融、回购定盘、申万历史。**不做**：整包平移、百度 MA、iwencai、mootdx、北向分钟、央视批量、120 日东财资金流。 |

### 0.2 数量

| 口径 | 数量 |
|---|---:|
| 上游版本 / 最后提交 | v3.10.4 / 2026-11-04 |
| 上游层数 / 端点（官方口径） | 15 层 / **87**（82 主 + 5 备胎） |
| 上游主端点条目（本复核口径） | **76**（路由表 82 行 − 2 行前置 helper − 1 行估值公式 − 3 行承载 5 个备胎） |
| 上游来源 / 可运行代码 / 测试 | 34 源 / 约 5,000 行代码块 / 212 条（208 离线 + 4 联网） |
| 本地 capability / web 工具 | **135** / **17**（较 gap 文档的 132 条基线多 3 条：11-21 新增的涨停统计/严重异动/板块反查） |
| § 级覆盖判定 | **covered 28 · partial 23 · missing 22 · irrelevant 3** |
| 备胎 5 条 | 4 条是独立源（但多数本地已有主能力），`announcements_backup` 沪市腿仍走东财 |
| 近 7 天需求 | 42 份简报 / **372 条 gaps**（capability 136 · quality 162 · conflict 39 · transient 35） |

### 0.3 最值得先做的五件事

1. **修 `tencent_kline` 成交量单位契约**（上游 V3.10.1 已更正：科创板 688/689 是**股**，其余是**手**；
   本地数据面没有声明，调用方按「手」换算会大 100 倍）——**1 处契约 + 回归，最高性价比**。
2. **ETF 期权**（T 型报价 / 希腊字母 / IV）：本地**整层零覆盖**，近 7 天 3 条 capability 缺口直指它；
   上游三端点纯 HTTP、GBK、零 key，是本批最值得平移的新能力。
3. **A50 期指**：F1 唯一能补的一腿；近 7 天 10 条 capability 缺口与股指期货/A50 相关；上游一次 GET。
4. **证券画像的行业/ST 两腿**：近 7 天 8 条「个股→行业/板块归属」缺口；上游 `eastmoney_stock_info`
   + `st_stock_list` 与本地东财链路同源，成本低。**A5 的 A/H 对手腿上游没有**，不要承诺整条 A5 完成。
5. **`sina_reports` 假空页修复**：上游实测 1 秒间隔会返回 HTTP 200 的「没有找到相关内容」，
   本地无节流；把「假空」当「该股无研报」是证据级错误。

---

## 1. 上游变了什么

### 1.1 时间线（只列与本地相关的）

| 日期 | 版本 | 变化 | 对本地的影响 |
|---|---|---|---|
| 2026-08-19 | v3.7.0 | 宏观层 + 筹码分布 + 复权因子 + 估值历史（+1 层 7 端点 4 源） | 本次复核重点（历史估值、社融等）在此版本引入 |
| 2026-09-05 | v3.8.0 | 指数与交易日历层（+1 层 6 端点 3 源） | 中证/国证成分、权重、估值、深交所日历 |
| 2026-09-20 | v3.9.0 | 期货/事件驱动/可转债三层 + 多源补齐（12→15 层，60→85 端点，22→34 源） | **端点扩张主体**；上次核对未覆盖 |
| 2026-09-22 | v3.10.0 | 腾讯逐笔替代 mootdx、新浪期货日 K、行情层重排（85→87） | 上次核对版本；本地 `tencent_ticks` 已有对应实现 |
| 2026-10-07 | v3.10.1 | 科创板成交量单位、逐笔重试/`complete`、期货日 K 重试 | **本地需回灌成交量单位**；`complete` 未移植 |
| 2026-10-11 | v3.10.2 | `full_valuation` 的 PE 消化年数 `0` → `None` | 本地无此计算，不涉及 |
| 2026-10-23 | v3.10.3 | 上证e互动相对时间（"昨天 18:22"）整页报错 | 本地 `sseinfo_qa` **已支持**三类时间，不涉及 |
| 2026-11-04 | v3.10.4 | 基金（ETF/LOF）复权补读 `s/u` | 本地无新浪比例因子能力；未来接才涉及 |

**结论**：从上次核对（v3.10.0）到现在，**入口零增长**；变化是 4 个补丁版本、约 280 行 SKILL.md
与一批测试/fixture。上游的「最近新增了很多接口」不成立；真正的变化是**我们从未评估过的 80 个既有端点**。

### 1.2 四个补丁里对本地有实际意义的

| 版本 | 上游修的是什么 | 本地现状 | 处置 |
|---|---|---|---|
| v3.10.1 | §1.2 腾讯 K 线 `volume`：**科创板（688/689）是股，其余是手**；文档此前一律写「手」 | 本地 `tencent_kline` 数据面原样返回上游值，`description` 写「volume 单位为手」；只有内部 `fetchDailyBars` 对 `^68[89]` 标 `volume_unit='share'` | **P0 回灌**：能力契约加单位声明（`volume_unit` 或按市场分支），补回归 |
| v3.10.1 | §1.4 腾讯逐笔改复用连接 + 自动重试；新增 `frame.attrs["complete"]`（15:31 后用快照核对盘后各笔） | 本地有连续竞价缺号/成交额核对、`missing_seq`，**无 `complete`** | P1/P2：盘后尾笔缺失目前不可见；非阻断 |
| v3.10.2 | `full_valuation` 盈利不增长时 `digest_years` 返回 `None` 而不是 `0` | 本地无该计算 | 不涉及 |
| v3.10.3 | 上证e互动相对时间整页抛错 | 本地 `sseinfo_qa` 已支持「今天/昨天/前天/N 分钟前」 | 不涉及 |
| v3.10.4 | 基金复权补读 `s`（份额折算）/`u`（累计分红）；`f` 恒 1 是正常态 | 本地无新浪比例复权因子；`corporate_actions` 只给事件 | 未来接 §1.6 时才需要；当前不涉及 |

### 1.3 计数口径（先对齐，避免被「87」误导）

上游自述 **87 = 82 主端点 + 5 备胎**；其 `## 端点路由速查` 共 82 行，扣除 2 行前置 helper、
1 行估值公式与 3 行承载 5 个备胎后，剩 **76 条主端点条目**。差异来自同一 § 下多函数
（`em_zt_pool/em_zb_pool/em_dt_pool/em_yzt_pool`、`sina_option_codes/tquote/greeks`、
`ths_hot_list/em_hot_rank/em_hot_concept` 等）。本复核**按 §/路由行级**统计，函数级数量以官方口径为准。
本地覆盖判定也按 § 级，避免把「一个 § 三个函数」重复计成三条。

---

## 2. 完整复核：十五层 × 87 端点

### 2.1 分层覆盖

| 层 | 端点条目数 | covered | partial | missing | irrelevant | 一句话 |
|---|---:|---:|---:|---:|---:|---|
| L1 行情 | 7 | 3 | 2 | 1 | 1 | 腾讯/逐笔已覆盖；缺百度 MA（可派生） |
| L2 研报 | 5 | 3 | 0 | 2 | 0 | 个股研报/一致预期/新浪已覆盖；缺**行业研报**、iwencai |
| L3 信号 | 9 | 2 | 5 | 2 | 0 | 板块/资金/龙虎榜多为「换源覆盖」；缺**同花顺题材归因**、北向分钟 |
| L4 资金/筹码 | 7 | 4 | 1 | 2 | 0 | 两融/大宗/户数/分红已覆盖；缺**CYQ**、**ETF 份额** |
| L5 新闻 | 5 | 4 | 0 | 1 | 0 | 四源已覆盖；央视联播为刻意不做 |
| L6 基础数据 | 8 | 1 | 4 | 2 | 1 | 三表已覆盖；缺 **BaoStock 估值历史/退市日**、**申万历史** |
| L7 公告 | 2 | 1 | 0 | 0 | 1 | 按代码公告已由东财承担；F10 摘要不需要 |
| L8 打板 | 5 | 3 | 2 | 0 | 0 | 三池/统计/监控已覆盖；缺昨日涨停池、板型/封板率 |
| L9 ETF 期权 | 1 | 0 | 0 | 1 | 0 | **整层零覆盖** |
| L10 舆情 | 3 | 2 | 1 | 0 | 0 | 互动易/e互动已覆盖；热榜缺概念/标签列 |
| L11 宏观利率 | 6 | 3 | 1 | 2 | 0 | 中债/LPR/日历已覆盖；缺**社融**、**回购定盘** |
| L12 指数日历 | 4 | 1 | 2 | 1 | 0 | 日历/成分/权重多为换源；缺**指数估值** |
| L13 期货大宗 | 7 | 1 | 3 | 3 | 0 | FTShare 覆盖 9 条期货；缺**期权**、**A50**、实时期货 |
| L14 事件驱动 | 6 | 0 | 1 | 5 | 0 | 只有业绩预告有等价物；缺调研/增减持/回购/质押/新股 |
| L15 可转债 | 1 | 0 | 1 | 0 | 0 | 条款+日 K 有，转股价值/溢价率未算 |
| **合计（主端点）** | **76** | **28** | **23** | **22** | **3** | — |
| 备胎 5 条 | 5 | 2 | 2 | 1 | 0 | 多为降级/交叉验证；不是新数据面 |

### 2.2 真缺口清单（22 组，按「本地缺 + 上游可补 + 需求」排序）

| # | § | 上游能力 | 本地现状 | 依赖 | 优先级 |
|---|---|---|---|---|---|
| 1 | 9.1 | ETF 期权合约 / T 型报价 / 希腊字母+IV（新浪） | **零覆盖**（只有 `ticker_list` 的 options 元数据） | 纯 HTTP、GBK、Referer | **P1** |
| 2 | 13.5 | 富时中国 A50 期指（新浪 `hf_CHA50CFD`） | **零覆盖**；F1 只有国内期货 | 纯 HTTP、一次 GET | **P1** |
| 3 | 6.3 | 东财个股基本面：行业/股本/市值/上市日 | 缺「单票→行业」字段；`index_membership_by_stock` 只给同花顺板块 | 纯 HTTP（push2） | **P1** |
| 4 | 6.8 | 沪深京 ST/*ST 当日名单 | 只有 `ftshare_ashare_quote.st` 布尔，无「只列 ST」入口 | 纯 HTTP（东财 clist） | **P1** |
| 5 | 12.3 | 中证指数 PE / 股息率 | **零覆盖**（个股有估值、行业有申万，指数没有） | xls/xlsx 解析 | **P1** |
| 6 | 14.2–14.6 | 机构调研 / 增减持 / 回购 / 质押 / 新股日历 | **零覆盖**（FTShare 只有业绩预告/快报） | 东财 datacenter，本地同链路 | **P1/P2** |
| 7 | 11.1 | 人民银行社融增量（月度 12 列） | **零覆盖**；M1 唯一可补腿 | 4 跳 HTML + xlsx | **P2** |
| 8 | 11.4 | 银行间回购定盘利率 FR/FDR | **零覆盖**；M1 另一腿 | CSV + Referer | **P2** |
| 9 | 6.5 | BaoStock 日频估值历史（PE/PB/PS/PCF + turn + 停牌 + isST） | **零覆盖**；本地 `valuation` 明写「不提供历史估值」 | **baostock TCP** | **P2** |
| 10 | 6.6 | BaoStock 上市日/退市日/状态 | 上市日有；**退市日未证** | baostock TCP | **P2** |
| 11 | 6.7 | 申万行业归属变迁史（消前视偏差） | 只有当前归属（同花顺口径） | xls；**当前 TLS 不可达**（实测） | **P2** |
| 12 | 4.6 | 筹码分布 CYQ（获利比例/成本区间/筹码峰） | 本地 `chip_concentration` 恒 null | 纯本地计算（需前复权 K + 换手率） | **P2** |
| 13 | 4.7 | 上交所/深交所 ETF 份额 | **零覆盖** | 两所 JSON/JSON+HTML | **P2** |
| 14 | 3.1 | 同花顺热点：强势股+题材归因 `reason` | 热榜只有 rank/heat；题材归因空白 | 纯 HTTP JSON | **P2** |
| 15 | 2.1c | 东财行业研报（`qType=1`） | `eastmoney_reports` 只按 code | 同端点、同限流 | **P2** |
| 16 | 13.2 | 商品/股指期权日行情（含 Delta/IV） | **零覆盖**；中金所不公布 Delta/IV | 五所五套格式 | **P2** |
| 17 | 13.4 | 新浪实时期货（含大商所） | 只有日频/结算，无盘中 | 需盘中轮询 | **P3/不做** |
| 18 | 1.5 | 百度 K 线带 MA | 无 | MA 可派生 | **不做** |
| 19 | 2.3 | iwencai 语义搜索 | 无 | 需 Key + POST | **不做** |
| 20 | 3.2 | 北向分钟流向 | 日频渠道级已有；分钟无 | hgt/sgt 口径不稳 | **不做**（不可修） |
| 21 | 5.5 | 央视《新闻联播》批量正文 | 只能逐条 fetch | 16 次请求 | **不做**（已决策不进 recipe） |
| 22 | 7.2 | 通达信 F10 公告摘要 | 不需要 | mootdx TCP | **不做** |

### 2.3 已覆盖但「契约/口径」需修正的（不是新能力）

| § | 上游口径 | 本地现状 | 动作 |
|---|---|---|---|
| 1.2 | 科创板成交量是**股**，其余是**手** | 能力 `description` 写「单位为手」，输出无 `volume_unit` | **P0**：补单位字段/说明，回归 |
| 1.4 | 15:31 后核对盘后定价各笔，输出 `complete` | 无 `complete`；盘后尾笔缺失不可见 | P1：可加，非阻断 |
| 2.4 | 新浪研报 1s 间隔会返回 HTTP 200 假空页；需 6s | 无节流/空页重试 | **P0**：加最小间隔 + 空页重试 |
| 4.4 | 上游注释写「每股派息」，东财原义是「每 10 股」 | 本地 `plan_profile` 已按 10 股实证 | 不照抄上游注释 |
| 4.5 | 上游把 `"-"` 直接转 `0` | 本地禁止补零 | 不照抄 |
| 4.7/15.1 | 上游溢价率列是占位值 100，需另挂 `quoteColumns` 现算 | 本地 `eastmoney_convertible_bond_list` 已丢弃该列并写明 | 保持不补零 |
| 10.3 | 上游正则实测匹配 0 条（`<br/>` 问题） | 本地 `sseinfo_qa` 已用逐 `<a>` 解析 | 不照抄 |
| 6.5 | 北交所直接拒绝（`10004011`） | 无该能力 | 若接，登录前拦住 |

### 2.4 已覆盖的 28 组（不要重复建设）

行情：`tencent_quote` / `tencent_kline` / `tencent_ticks`；研报：东财个股研报（含 PDF 链接）/
同花顺 EPS / 新浪研报；信号与资金：解禁 / 全市场龙虎榜 / 两融明细 / 大宗 / 股东户数 / 分红；
新闻：东财个股新闻 / 财联社 / 东财 7×24 / 华尔街见闻；基础：三表；公告：按代码公告；
打板：情绪统计 / 监控池 / 异动；舆情：互动易 / 上证e互动；宏观：中债曲线 / LPR / 宏观日历；
指数：深交所日历；期货：会员持仓排名（换源）。

> 这 28 组里**没有一组**值得为了「上游更权威」再建第二份——本地契约（单位、空值、时间轴、分页）比上游更细。
> 上游的价值在**未覆盖的 22 组**与**已踩过的坑**，不在「有 87 个端点」这个数字。

---

## 3. Python 运行时到底解锁了什么

### 3.1 事实基线（本机实测）

| 项 | 事实 |
|---|---|
| base pack | **已就绪**：Python 3.13.17、numpy 2.4.6、pandas 3.0.6、dateutil、six、tzdata |
| 缺的库 | **没有 `requests` / `certifi` / `openpyxl` / `xlrd` / `baostock` / `mootdx` / `stockstats`** |
| 执行面 | `python/worker.py` 有 `probe` / `run` 两个子命令；`PythonRuntimeManager` **只有 status/prepare/verify/resolve/remove，没有 run**；`run_analysis`（M5）未实现 |
| 部署形态 | 按需安装（用户点「准备分析环境」才装），平台矩阵 Win x64 / mac arm64+x64 / linux x64；**Linux arm64 与 Alpine 不支持** |
| 隔离 | 文档明写：**不是 OS sandbox**；Python 子进程不受 DSH workspace sandbox 约束；不允许 pip 安装 |
| 现有用途 | 只服务分析环境（pandas/parquet），不承担取数；`data_analyst` 仍 disabled |

### 3.2 上游代码依赖画像（按 § 统计）

| 依赖 | 涉及 § 数 | 说明 |
|---|---:|---|
| `requests` | 27 | 绝大多数 HTTP 端点；含 `Session` / 重试 adapter / 自定义头 |
| `pandas` | 10 | 出表、`read_excel`、`read_html`、数值转换 |
| `mootdx`（TCP） | 6 | 财务快照 / F10（行情命令 2026-09 起返回空） |
| `baostock`（TCP） | 4 | 估值历史 / 上市退市日 / ST 兜底 |
| `urllib` | 2 | 腾讯 §1.1、备用源 |
| POST / 签名 / 自定义头 | 7 / 1 / 多 | 互动易、上证e互动、东财部分、财联社签名 |
| xls/xlsx 解析 | 4 | 社融、申万历史、中证估值、备用源 |

**结论**：上游代码不是「一个 Python 文件直接跑」——它默认 `requests`、部分 `pd.read_excel`，
且 `mootdx`/`baostock` 需要额外包。当前 runtime 一个都没有，**直接照抄会大面积 ImportError**。

### 3.3 本机真实探针（私有 Python 3.13 + 仅标准库）

| 端点 | 结果 | 结论 |
|---|---|---|
| 中国货币网 FR CSV | 200 / `text/csv` / 数据正常 | 纯 urllib 可用 |
| 人民银行社融索引 | 200 / 89KB HTML | 4 跳链路可达（见下） |
| 国家统计局发布页 | 200 / HTML | 可达 |
| 新浪 A50（`hf_CHA50CFD`） | 200 / 152B / 现价 12,515.3 | 一次 GET 可用 |
| 东财 datacenter 事件报表 | 200 / JSON（`pages=148115`） | 与本地东财链路同源 |
| 东财 push2 个股信息 / 涨停池 | 200 / JSON | 可用 |
| 上交所 ETF 份额 / 深交所基金报表 | 200 / JSON | 两所均可达 |
| 同花顺 EPS 页 / 热点 JSON | 200（GBK/HTML、JSON） | 可达，需 GBK 解码 |
| 华尔街见闻宏观日历 | 200 / JSON | 可达 |
| 巨潮公告 POST | **裸 POST 返回 200 空 body**；带 `Origin/Referer/X-Requested-With` 后 200 / 608 条 | **必须复刻浏览器头** |
| 申万行业历史 xls | **TLS 证书链失败**（`unable to get local issuer certificate`；`curl` 同样失败；加 `certifi` 也不解决） | **当前不可达**，不要承诺 |
| BaoStock | **登录成功**；茅台 2026-11-01..11-21 15 行估值；`query_stock_basic` 返回上市日 | **vendored wheel 实测可用** |
| 人民银行社融 xlsx | 下载 12,961B（`PK` zip）；vendored `openpyxl` + pandas **解析成功**（2026.01–2026.10，11/12 月为空行） | **可端到端** |

补充事实：私有 Python 的 `ssl` 用系统 CA（`/etc/ssl/certs`），大多数站点正常；SW 是服务端证书链问题，
不是「加个 certifi 就好」。上游文中「certifi 环境正常」的说法本次**未能复现**。

### 3.4 三个方案与建议

| 方案 | 内容 | 判断 |
|---|---|---|
| **A. 继续 TS 端点** | 所有 HTTP 能力仍走 `src/sources/*.ts`；只回灌上游口径修复 | **推荐为主路径**：契约、护栏、巡检、时间轴都只有一套；成本可预期 |
| **B. 受控 Python 数据通道（试点）** | 固定白名单脚本 `python/sources/*.py`（不是任意代码）；TS 侧新增 `python_source` 适配器：`manager.run()` → 脚本读 `request.json`、写 `result.json` → TS 校验/改键/落 Dataset。**只服务 Python-only / xls 源** | **推荐做最小试点**：先只接 BaoStock 两条；包用**vendored 纯 Python 库**（见 §3.5），不新增 runtime pack；能力始终注册，运行时缺失时**调用期**响亮失败（`runtime-not-ready`），不押装配期状态 |
| **C. 整包平移 / 通用 Python 工具** | 把 SKILL.md 全部代码放进 runtime，暴露一个通用 `a_stock_data(endpoint, params)` | **不做**：绕过 §9 工具 schema 与能力目录、无逐能力契约/单位/时间轴；注册依赖外部运行时（§9.7 反例）；供应链与审核面不可控；且当前 runtime 连 `requests` 都没有 |

### 3.5 Vendored 纯 Python 库：比新增 pack 便宜得多

本机实测：把 wheel 解包进 `python/vendor/`、worker 里加入 `sys.path` 即可，无需 pip、无需新 pack：

| 包 | 版本 | 许可 | 解包体积 | 用途 |
|---|---|---|---:|---|
| baostock | 0.9.4 | BSD | ~376 KB | 历史估值 / 上市退市日 |
| openpyxl + et-xmlfile | 3.1.5 / 2.0.0 | MIT | ~1 MB | xlsx（社融、中证估值） |
| xlrd | 2.0.2 | BSD | ~0.2 MB | xls（申万历史，若将来可达） |
| certifi | 2026.11.20 | MPL-2.0 | ~0.24 MB | 证书（可选；对 SW 无效） |

代价：`THIRD_PARTY_NOTICES.md` 要补四个包；主包体积增加约 1.5–2 MB；worker 的 `-I` 下需显式加入
`python/vendor`（与 `--site-packages` 同一机制）。收益：**不需要为每个库重建四个平台的原生 pack**。

### 3.6 Python 数据通道的硬约束（若做 B）

1. **脚本白名单**：只运行 `python/sources/` 下的固定文件，能力名 → 文件名映射写死；**不接受模型给路径/代码**。
2. **不新开体积闸门**：结果仍由 Dataset 落盘，模型只拿 `DatasetRef`；Python 侧的 stdout/stderr 只进日志。
3. **运行时可选 = 能力可用性可选**：`runtime-not-ready` 必须是一等错误并写进 `describe_capability`；
   **不要**在装配期按运行时是否安装决定注册（§9.7）。
4. **不把 Python 当安全边界**：它没有文件沙箱；脚本本身必须评审，且只做「取数 → JSON」。
5. **平台分支**：Linux arm64/Alpine 用户拿不到这些能力；文档与 persona 不得把它写成全平台能力。
6. **许可与来源**：baostock 免费但需遵守其服务条款；vendored 包必须进 `THIRD_PARTY_NOTICES.md`。

---

## 4. 与 CapGen 18 条缺口的对账

### 4.1 上游能补/不能补

| ID | 缺口 | 上游能补吗 | 说明 |
|---|---|---|---|
| **H1** | 港股大市成交额/涨跌家数 | **不能** | 上游纯 A 股，无港股市场统计 |
| **A2** | A 股停复牌名单 | **不能（有一个未验证候选）** | 无停复牌端点；`tdx_daily_package` 若停牌票仍在包内（volume=0）或可反推——**未验证，不可当结论** |
| **G3** | 美国宏观长序列 | **不能** | 无 FRED/BLS/BEA |
| **A4** | 昨日同期成交额 | **不能** | 腾讯分钟 K 无成交额；上游明确「量×均价」自算，不能当同刻累计额 |
| **U3** | 美股交易日历 | **不能** | 只有深交所日历 |
| **X1** | 事件日历 | **部分**：IPO 日历、宏观日历（本地已有同源财经日历）；调研/增减持/回购/质押是**事件明细**不是日历 | 可作 X1 的数据腿，但 X1 本体仍需自建 |
| **H2** | 港股披露/回购 | **不能** | 巨潮是 A 股法定平台；无 HKEX |
| **U2** | SEC filings | **不能** | 无 EDGAR |
| **U4** | 美股/港股一致预期 | **不能** | 只有 A 股 EPS（本地已有） |
| **A5** | 证券画像/行业分类 | **部分**：行业（东财）、ST 名单、股本/上市日、申万历史；**A/H 对手没有** | 可补 2–3 腿，不能整条交付 |
| **H3** | 南向十大活跃股 | **不能** | 只有北向，无南向个股 |
| **F1** | 海外股指期货 | **仅 A50 一腿** | A50 是 SGX CFD 连续报价；**CME 的 ES/NQ/YM/RTY 上游零覆盖** |
| **M1** | 中国宏观补充 | **部分**：社融、回购定盘；**工增/固投/房地产/失业率/OMO 没有** | 只能补 2/6 项 |
| G1/G2/A1/A3/U1 | 已落地 | — | 无动作 |

**结论**：18 条 backlog 里，上游实质影响 **4 条**（A5、X1、F1、M1），且**没有一条能整条关闭**；
P0 的 H1/A2 与美股/港股相关的 U2/U3/U4/G3/H2/H3 **完全不受影响**。

### 4.2 近 7 天需求侧的硬证据（42 份简报 / 372 条 gaps）

| 候选能力 | 近 7 天 capability 缺口（人工核对后） | 典型原话 |
|---|---:|---|
| 股指期货 / A50 | **10** | 「美股指数期货全目录无能力」「ES/NQ 方向未取到」「A50 夜盘未取到」 |
| 行业/板块归属 | **8** | 「个股→行业映射缺失」「申万一级当日涨幅未取到」「板块领涨股未取到」 |
| 财报日历 / 一致预期 | **9** | 「无 A 股财报披露日历」「EPS/营收一致预期无结构化字段」「港股/美股一致预期无」 |
| 停复牌 / 风险警示 | **3**（+若干 quality） | 「A 股停牌只有时点快照，曾停后复牌不体现」「停牌与风险警示无字段」 |
| ETF 期权 / IV | **3** | 「本仓无期权端点，无法取期权隐含波动率」「无期权数据源」 |
| ETF 份额 | **1** | 「库内无 ETF 份额/申赎序列」 |
| 指数估值 / PE 分位 | **1** | 「只有申万行业级估值快照，没有指数 PE(TTM) 及分位」 |
| 历史估值 / PE 分位 | **0**（仅 quality 级抱怨） | 「无历史估值分位」出现在 quality 缺口里 |
| 社融 / 宏观 | **0** | 近 7 天无直接需求 |

> 与 11-13 之前的 296 条相比，需求重心仍是**公告正文/官方核验、港股量能、美股日历/期货、事件日历**；
> 上游能补的 A 股侧（社融、BaoStock、事件明细）在最近一周反而**需求最低**。这是排序时必须承认的事实。

---

## 5. 接下来的优先级

排序判据：**需求（近 7 天 gaps + 18 条 backlog）× 上游可补 × 成本 × 契约风险**。
「P0」= 不新增能力、1–2 天；「P1」= 下一迭代可交付；「P2」= 需要新通道或需求不足，先 spike/排队。
本节排的是**本轮上游复核带来的可开工增量**；18 条 backlog 里 H1 / A2 仍按原计划推进（上游帮不上，
见 §4.1），不因本复核改优先级；完整合并视图见 §5.5。

### 5.1 P0：先修口径（不新增 capability）

| # | 事项 | 为什么 | 验收 |
|---|---|---|---|
| **P0-1** | `tencent_kline` 成交量单位契约 | 上游 V3.10.1 已确认科创板是**股**、其余是**手**；本地数据面未声明，按「手」换算会差 100 倍 | description 明确两套单位（或输出加 `volume_unit`）；688/689 与 600xxx 各一条真实 fixture；更新 `docs/data-collector-capabilities.md` |
| **P0-2** | `sina_reports` 最小间隔 + 空页重试 | 上游实测 1s 间隔第二次起返回 HTTP 200 的假「没有找到相关内容」；本地无节流 | 连续两次调用间隔 ≥6s；空页只在重试后仍空才返回空；补测试 |
| **P0-3** | 把「上游口径修正」写进契约 | 4.4 每股 vs 每 10 股、4.5 `"-"`→0、15.1 溢价率占位 100、10.3 正则失效、`ssl.CERT_NONE` | 在对应 `description`/注释里写明，不照抄上游 |

### 5.2 P1：下一迭代的五个能力（TS HTTP，优先顺序即表序）

| # | 能力 | 源 / 形态 | 需求 | 成本 | 关键坑 |
|---|---|---|---|---|---|
| **P1-1** | `sina_etf_options`（合约清单 / T 型报价 / 希腊字母+IV，一个工具三操作） | 新浪 `hq.sinajs.cn`，GBK + Referer | 3 条 capability | 3–4d | T 型 43 位、希腊字母必须 `[raw[0]]+raw[4:]`（跳过 3 个空串）；`iv` 是小数；空结果与解析失败分开 |
| **P1-2** | `a50_futures`（或并入 `global_index_futures` 的 `CN` 腿） | 新浪 `hf_CHA50CFD`，一次 GET | 10 条与股指期货相关 | 1d | 只有 CFD 连续报价；**不得承诺合约月/结算/持仓**；CME 仍缺，F1 不能标完成 |
| **P1-3** | `security_profile`（东财个股信息：行业/股本/上市日）+ `st_stock_list` | 东财 push2 / clist | 8 条行业归属 | 2–3d | `em_secid` 规则（5x/588x/900x 也是沪市）；ST 名单北交所不在风险警示板过滤，要按名称筛 |
| **P1-4** | `index_valuation`（中证 PE/股息率） | 中证 XLS 文件（需 xlsx 解析件；与 P2-1 共用 Python 通道则顺延到 P2） | 1 条 | 2d | 只中证、无 PB、无全历史；`(date,index_code)` 去重 |
| **P1-5** | `eastmoney_events`（`event_type` 枚举：机构调研/增减持/回购/质押/新股） | 东财 datacenter，与本地同链路 | 7 条（多为公告侧） | 3–5d | 排序字段必须唯一（否则翻页重/漏行）；`AFTER_CHANGE_RATE` 是本次变动占比；`ISSUE_PRICE` 定价前 null **或 0**；北交所质押不支持 |

> 目录影响：135 → 约 **141**，仍在 145 预警线内；九主题分片已落地，单结果预算不是阻塞项。

### 5.3 P2：需要 Python / xls 通道，或需求不足

| # | 事项 | 触发条件 | 说明 |
|---|---|---|---|
| **P2-1** | BaoStock 历史估值 + 上市/退市日 | 先做 **2 能力试点**（`baostock_valuation_history` / `baostock_stock_basic`） | 唯一 Python-only 源；vendored baostock 实测可用；需 `python_source` 适配器与 `manager.run()`；不支持北交所 |
| **P2-2** | 社融 + 回购定盘（M1 两腿） | 与 P2-1 共用 Python 通道时再做 | 社融 xlsx 已端到端验证；`openpyxl` vendored；未发布月份整行丢弃、Excel 尾零 `2026.1` 是 10 月 |
| **P2-3** | 申万行业历史（A5 历史腿） | 先找可达镜像/替代 | 当前 `www.swsresearch.com` TLS 不可达（本机 + curl + certifi 均失败），**不要先写代码** |
| **P2-4** | 筹码分布 CYQ（本地计算） | 等 data_junior 计算通道或新能力立项 | 纯派生、零上游风险；需前复权 K + 换手率；输出是推演值，必须标口径 |
| **P2-5** | ETF 份额（两所官方） | 需求仍只有 1 条时排在 P1-5 之后 | 上交所 JSON + 深交所 JSON 内嵌 HTML；单位万份；深交所只有最新一天 |

### 5.4 明确不做

- **整包平移 SKILL.md / 通用 Python 数据工具**：违反 §9 工具 schema、能力目录与 §9.7（注册押外部状态）。
- **重复建设已覆盖的 28 组**：腾讯行情/K 线/逐笔、研报、公告、三池、互动易等。
- **iwencai**（需 Key + POST）、**百度 MA**（可派生）、**mootdx**（TCP + 行情已失效）、
  **央视批量**（已决策不进 recipe）、**北向分钟**（口径不稳/不可修）、**120 日东财资金流**
  （与 FTShare 主力口径冲突，禁止拼接）、**BSE/公告备胎**（非独立源或已覆盖）。
- **照抄上游的 `ssl.CERT_NONE`、占位溢价率、`"-"→0`、正则解析器**——这些是上游的已知坑，不是能力。

### 5.5 与 18 条 backlog 的合并视图

| 原优先级 | ID | 本次复核后的动作 |
|---|---|---|
| P0 | H1 港股量能 | **不变**（上游不能补）；继续找主板全量源 |
| P0 | A2 停复牌 | **不变**；可加一次 `tdx_daily_package` 停牌票 spike（未验证，不阻塞） |
| P1 | G3 美国宏观 | 不变（上游不能补，FRED 出口需复核） |
| P1 | A4 昨日同期成交额 | 不变（上游不能补） |
| P1 | U3 美股交易日历 | 不变（上游只有深交所日历） |
| P1 | X1 事件日历 | **可拆两步**：先用 `eastmoney_events` 补 A 股事件明细（P1-5），日历骨架仍自建 |
| P1 | H2 港股披露 | 不变（上游不能补） |
| P1 | U2 SEC | 不变（上游不能补） |
| P1 | U4 一致预期 | 不变（上游只有 A 股 EPS，本地已有） |
| P2 | **A5 证券画像** | **升到 P1**：先交行业/ST/股本三腿（P1-3）；A/H 对手仍缺 |
| P2 | H3 南向个股 | 不变（上游不能补） |
| P2 | **F1 海外期货** | **拆开**：A50 腿 P1-2 可交；CME 的 ES/NQ/YM/RTY 仍缺，F1 不标完成 |
| P2 | **M1 中国宏观** | 维持 P2：上游只能补社融+回购定盘，近 7 天零需求 |
| — | **新增（18 条外）** | ETF 期权（P1-1）、指数估值（P1-4）、ETF 份额（P2-5）、BaoStock 估值历史（P2-1） |

---

## 6. 风险与红线

1. **不要按端点数量做规划**：上游 87 个端点里 28 组已覆盖、23 组部分覆盖；真正值得新做的只有上表 5–7 项。
   「上游有、本地没有」不等于「应该做」——还要看需求（§4.2）。
2. **不要把 Python 运行时当成「上游开关」**：base pack 没有 `requests`/`certifi`/xls/baostock；
   `manager` 没有 `run()`；运行时按需安装且平台有限。任何依赖 Python 的能力都是**条件可用**。
3. **不要绕过 Dataset 契约取数**：即使走 Python，结果也必须回到 TS 侧校验、改键、落 Dataset；
   禁止把 rows 直接回模型，也禁止在 Python 里另建一套保留/时间轴。
4. **不要重复新闻/研报/PDF 管道**：`cls`/`wscn`/`eastmoney_724`/`eastmoney_reports`/`sina_reports`/`ocr` 已覆盖。
5. **不要承诺上游做不到的事**：港股大市量能、南向个股、SEC、CME、美股日历、港股公告——上游一条都没有。
6. **许可证**：上游是 **Apache-2.0**；若 vendored 代码/库，补 `THIRD_PARTY_NOTICES.md` 与来源说明；
   SKILL.md 是「给 AI 抄代码」的文档，不是库，**不要**把它作为运行时依赖动态加载。
7. **数据源风险**：上游接口是公开抓取（无 SLA）；所有新能力仍要按 `docs/dev/tool-schema.md` §10.1–§10.9
   做真报文 fixture、`validateOutput`、时间契约、`contract-registry` 与 `npm run docs:capabilities`。
8. **本机实测的时效**：探针是 2026-11-22 单次结果；部署出口（尤其 SW TLS、baostock TCP、巨潮反爬）需在 CI/真实环境复核。

---

## 7. 附录

### A. 复核范围与文件

- 上游：`.review/a-stock-data/`（gitignored 工作副本；SKILL.md 7,702 行 / 442 KB）。
- 逐节笔记：工作文件未入库（`.review/notes-l1-l4.md` / `notes-l5-l10.md` / `notes-l11-l15.md`），
  本文的每条判定均可在本轮复核记录中追溯；需要复现时重新 clone 并逐节读 §。
- 本地基线：`docs/data-collector-capabilities.md`（135 条）、`src/web-retriever/tools.ts`（17 工具）、
  `docs/design/data-capability-gaps-2026-11.md`（18 条 backlog）、`docs/design/python-runtime.md`。

### B. 本机探针命令（可复现）

```text
# 私有解释器
~/.dsh/cache/cg/python-runtime/base/1.0.0/linux-x64/payload/python/bin/python3.13
# 已验证：chinamoney CSV / PBC 社融索引+xlsx / NBS / 新浪 A50 / 东财 datacenter+push2 /
#         沪深 ETF 份额 / 同花顺 / 华尔街见闻 / 巨潮 POST（需浏览器头）/ baostock 登录+估值查询
# 失败：申万 xls（TLS 证书链，curl 与 certifi 均失败）
```

### C. 与旧判断的关系

- `docs/design/code-runtime-notes.md`（2026-10-05）的结论「Python 不是取数通道，是算力通道」**仍然成立**：
  本复核没有找到「只有 Python 才能拿、且值得接」的大批端点；只找到 BaoStock 与 xls 官方文件两类。
- 该文把 BaoStock 定位为「离线核对脚本」，现在可以升级为「受控数据通道试点」——但前提是
  §3.6 的六条约束与 §5.3 的触发条件，而不是「运行时已就绪就默认开放」。

---

## 8. 落地记录（2026-11-22 实施）

> 本节记录复核结论被落地后的真实状态。上方 §2 / §3 / §5 保持复核时点的事实，不回改历史判断；
> 与本节冲突时以本节为准。

### 8.1 已交付

| 复核项 | 落地内容 | 关键事实 |
|---|---|---|
| **P0-1** | `tencent_kline` 行级 `volume_unit`（`share`/`lot`）+ 契约改写 + 回归 | 实测 688981 71,848,002（股）、688001 10,276,186（股）、600519 67,229（手）、588000 75,171,992（手）、000001.SH 499,711,727（手）、688981 m5 2,907,497（股）；`fetchDailyBars` 复用同一判据，不再两份实现 |
| **P0-2** | `sina_reports` 进程级 6 秒节流（`src/web-retriever/throttle.ts`）+ 空页重试一次 + note 说明 | 实测非空页 1 次请求 39 条 0.36s；空页路径单测钉住「两次请求都走同一条链」；重试仍空才当「确实没有研报」 |
| **P0-3** | 契约修正复核 | 检查后确认本地已按对的口径写：`eastmoney_dividend_plan` 明写「每 10 股」、可转债清单已丢弃恒为占位 100 的 `TRANSFER_PREMIUM_RATIO`；本轮无代码改动 |
| **P1-1** | 新增新浪家族 4 能力：`sina_etf_option_contracts` / `sina_etf_option_tquote` / `sina_etf_option_greeks` / `sina_a50_futures` | 新 topic `options`；实测 `CON_OP_` 报文 51 列（上游文档只写 43）、`pct` 基准是昨结算而 `amplitude` 基准是昨收（450/450 命中验证）、希腊字母 `raw[1:4]` 三个空串必须跳过、`hf_` 行是北京时间墙钟（用 `hf_GC` 反证） |
| **P1-2** | A50 以 `sina_a50_futures` 落地（并入 P1-1 同一家族） | 只有 CFD 连续报价；不承诺合约月/结算/持仓/成交额；CME 的 ES/NQ/YM/RTY 仍缺，F1 不标完成 |
| **P1-3** | `eastmoney_security_profile` + `eastmoney_st_stock_list` | 字段/口径已用录制真报文验证（行业=东财板块名、股本/市值/上市日/动态 PE/PB；ST 名单按沪深京三路分别取，剔除北交所 186 只僵尸老号段）。⛔ push2 出口在 2026-11-22 16:00 后持续 `fetch failed`（46 次生产请求），巡检按 §10.8 挂 **shadow**，revisit 2026-12-20 |
| **P1-4** | `csindex_index_valuation`（中证官网 JSON `perf/indexCsiDsPe`） | 只有 **PE(TTM)**：全历史 3,824 行 / 单区间 261 行；官网 JSON 没有 PB、静态 PE、股息率（那三列只在 `oss-ch` 的 xls「近 20 个工作日」与 8 大指数最新一日快照里）→ description 已明确「本能力不提供」。请求起点前移 7 天再本地裁剪，避免上游补行 |
| **P1-5** | 东财事件包 5 能力：`eastmoney_institution_research` / `eastmoney_holder_change` / `eastmoney_buyback` / `eastmoney_pledge` / `eastmoney_new_stock` | 每个端点排序键，实测唯一（1728 / 2969 / 5846 / 2265 / 5642 行翻页无重复无漏行）；`AFTER_CHANGE_RATE` 口径、`ISSUE_PRICE` 定价前 0→null、北交所质押不支持等怪癖写进 description；质押仅沪深、按周发布 |
| **P2-1** | 私有 Python 数据通道 + BaoStock 2 能力（`baostock_valuation_history` / `baostock_stock_basic`） | 见 §8.3；实测茅台 24 行（2026-10-20..11-21）、全历史 6,121 行 8–15.7s、退市日 null 映射、批量缺行整批失败 |
| **P2-2** | `pbc_social_financing`（社融，xlsx 经 vendored openpyxl）+ `chinamoney_repo_fixing`（FR/FDR，CSV） | 社融默认 10 行（2026-01..10）、12 行/58 行窗口正确、2024 年合计 322,588 亿与官方一致、尾零月份 2025-10 还原；回购定盘 FR 748 行/FDR 249 行、百分数原值、FDR 空值 null 不是 0 |
| **P2-5** | `sse_etf_shares` / `szse_etf_shares` | 份额单位统一「份」（上游万份 ×10000，字符串换算避免浮点误差）；对账：510300 份额×收盘价 = 腾讯总市值，比值 0.999999；深交所只有最新一天、39 页 11.5s、预算抬到 60s |

**规模**：capability **135 → 153**（+7 东财、+4 新浪、+3 官方、+1 中证、+3 Python），topic **9 → 10**（新增 `options`）。

### 8.2 未交付与原因

- **P2-3 申万行业历史**：`www.swsresearch.com` TLS 证书链仍不可达（curl exit 60 / verify 20），**即使 `-k` 跳过校验源站也回 HTTP/2 508 空响应**——不是本仓能修的，先找替代镜像再立项。
- **P2-4 筹码分布 CYQ**：纯派生指标，需要前复权 K + 换手率的口径设计与 `data_junior` 计算通道，未在数据层实现（避免把一个推演值做成「数据能力」）。
- **P1-4 的 PB / 静态 PE / 股息率**：中证官网 JSON 没有这三列。可做的替代是 `data-service/indexValuation`（8 大指数**最新一日**快照，含 pe/peg/pb/dp），但那是「快照」不是历史序列，需另立能力并单独验收。
- **push2 两条**：字段已验、出口不通，按 shadow 挂着等 2026-12-20 复核；不要因为「测试绿」就以为它在生产可用。
- **A50 之外的海外期货**：CME 的 ES/NQ/YM/RTY 仍无来源，F1 保持未完成。

### 8.3 Python 数据通道的结构事实（维护者必读）

- **执行路径**：`PythonRuntimeManager.runDataScript({ script, params, timeoutMs, signal })` → 只接受 `python/scripts/<固定名>.py`（白名单正则，绝不接受模型传代码）→ 在 `<cacheRoot>/data-runs/<script>-<uuid>/` 写 `request.json` + `input.json` + 脚本副本 → `python -I worker.py run --site-packages <base pack> --site-packages <repo>/python/vendor --run-dir <dir>` → 读 `result.json` 与脚本写的 `out.json` → 返回 `{ rows }` → **TS 侧逐字段校验/改名后才进 Dataset**。
- **spawn 只有一份**：`src/python-runtime/probe.ts` 的 `runWorkerProcess` 同时服务 probe 与 run；超时 SIGTERM→2s SIGKILL、abort、stdout/stderr 各 64KB 尾、run dir 24h 残留清理。
- **vendored 包**（`python/vendor/`，约 1.8MB，仅 `.py` + LICENSE，无二进制、无 `__pycache__`）：BaoStock 0.9.4（BSD）、openpyxl 3.1.5（MIT）、et_xmlfile 2.0.0（MIT）。`THIRD_PARTY_NOTICES.md` 已登记；`package.json` 的 `files` 已含 `python`，无需改动。⛔ 升级任一包 = 替换目录 + 核对 LICENSE + 重跑 `.review/python-probe.mjs`，不要就地改代码。
- **失败语义**：base pack 未安装/损坏 → `data-runtime-not-ready`（文案指向「插件设置 → 分析环境」）；脚本失败 → `script-failed`（错误信息优先取 stderr 末行，traceback 进 diagnostics）；运行时**调用期现取**，装配期不探测、失败不 memoize。
- **已知限制**：BaoStock 不支持北交所（10004011）与 B 股；社融历史从 2022-01 起（更早是 OLE2 `.xls`，openpyxl 读不了）、`afre_total` ≠ 10 分项之和（表内还有未列出的其他融资）；每次能力调用新起解释器，BaoStock 约 +2.8s import。
- **巡检**：3 条 Python 能力一律 `excluded`（CI runner 不安装私有运行时、BaoStock 是自建 TCP、PBC 是四级跳抓取），按需本地跑 `.review/python-probe.mjs`。

### 8.4 本轮验证

- `npm test`：**1687 pass / 0 fail**（新增 6 个测试文件：sina / official / csindex / python-remote / python-runtime-data / eastmoney-events）。
- `npm run check:dsh`：**40/40 PASS**；`npm run smoke:boot`：预设 `broken=null`、`pythonRuntime=present`、族行 20/20。
- `npm run contract:probe` 真实巡检（2026-11-22）：sina 3/3 PASS（合约清单走周档）、official 3/3 PASS（szse 11.5s）、csindex 1/1 PASS、东财事件包 4 条 daily PASS；push2 两条 **TRANSPORT→影子**（与预期一致）。
- `npm run docs:capabilities` 重新生成总表（153 条，10 个 topic）。

### 8.5 边界

- **未发版**：版本仍是 `2.29.0`；CHANGELOG 未写（按本仓惯例，发版单独一次 `feat(release)`）。
- **未提交**：工作树等待审阅（含 `lib/` 构建产物与 `python/vendor` 1.8MB）。
- **需重启进程**：`lib/` 已重建，但运行中的 dsh 进程仍是旧代码；生效要重启 dsh（`docs/dev/tool-schema.md` §9.4）。
- **明确不做**：iwencai、百度 MA、mootdx、北向分钟、央视批量、120 日东财资金流、BSE/公告备胎，以及 H1/A2/A4/U3/U2/U4/G3/H2/H3 这些上游补不上的缺口。

---

## 9. 第二轮：打板层与舆情层缺口补齐（同日）

> §2.1 里 L8「5 组 → 3 覆盖 / 2 部分」与 L10「3 组 → 2 覆盖 / 1 部分」是按上游**端点组**数的；
> 按数据点拆开时余下的 7 个打板数据点 + 2 个舆情数据点在本轮补齐（东财人气榜仍未接，见 §9.3）。
> 能力总数 **153 → 162**，新增家族 **同花顺网页直连（ths）** 2 条；东财 31 → 38 条；Fuyao 3 处补列。

### 9.1 已交付

| 数据点 | 落地 | 关键实测事实 |
|---|---|---|
| 东财涨停池 | `eastmoney_limit_up_pool`（push2ex） | 2026-11-20 28 行；`p/ztp` 是 **×1000 整数**（÷1000）；`fbt/lbt` 是 **HHMMSS 整数**（92501→09:25:01）；`zttj={days,ct}` 与 `lbc` **不等价**（002548 `lbc=1` vs `zttj=6天3板`）；`fund` = 封板资金，与腾讯买一量×100×价 **28/28** 对上；**只有约最近 15 个交易日**，今天及更晚会被静默夹到最近交易日（行内 `requested_date_clamped` 标出） |
| 东财炸板池 | `eastmoney_limit_break_pool` | 7 行；`amplitude_pct`(zf)/`speed_pct`(zs)/`limit_price`(ztp÷1000)；⛔ 涨速收盘后恒 0（盘中才有值） |
| 东财跌停池 | `eastmoney_limit_down_pool` | 58 行；`fund` 封单资金与腾讯卖一量 **57/58** 对账一致；`days`/`oc`/`lbt` 与东财前端 title 对齐；⛔ `fba`（板上成交额）原值收录但**12/58 行大于当日成交额**、3 只一字板也不等于成交额 → 禁止当成交额用 |
| 东财昨日涨停池 | `eastmoney_yesterday_limit_up_pool` | 23 行；⛔ 字段名带 `y_` 前缀（`yfbt`/`ylbc`），**不能与涨停池复用解析**；`zt_stat` 的 `ct/days` 语义是「m 天里有 n 次涨停」 |
| 同花顺涨停揭秘 | `ths_limit_up_detail`（data.10jqka 网页 JSON，零 key） | 28 行；`board_type`（换手板/一字板/T字板）、`seal_rate`（0~1 小数，0 与 null 都真实存在）、`is_again`、`break_times`、`seal_amount`、`high_days`（**字符串且不是连板数**：好当家「7天4板」vs Fuyao `continue_day_cnt=1`）；⛔ `first_limit_up_time` 是 **Unix 秒**，与东财 HHMMSS 不是一套；与 Fuyao 涨停池 28/28 对账，差集全是 **ST**（本能力上游池不含 ST），`filter` 也不含北交所 |
| 东财日内异动明细 | `eastmoney_price_anomaly_list` | 规则码/文字解释 + 累计偏离 `deviation_pct` + 统计窗口 `window_days`；⛔ 上游**完全忽略 date**（传什么日期都回当前业务日）→ 拿不到历史，早于业务日的 date 直接失败；`m=0` 同时代表深市与北交所；`t` 在 list 是「涨跌幅目标值(浮点)」、在 count 是「异动次数(整数)」，两个 parser 完全独立 |
| 东财异动聚合 | `eastmoney_price_anomaly_count` | 按标的聚合：`anomaly_times`/`deviation_pct`/`window_days`；排序由本层做（上游 sort 参数不可靠） |
| 东财个股概念命中 | `eastmoney_stock_hot_concepts`（emappdata） | POST + `content-type: application/json`（GET 回 `code=-2`）；`srcSecurityCode` 必须**大写前缀**；600519 回 7 条、hitCount 严格降序（6176/107/88/…）；⛔ `data=[]` 是合法空（北交所 3 只实测空），**空 ≠ 不属于任何概念** |
| 同花顺热榜两列 | `ths_hot_list`（dq.10jqka 网页 JSON，零 key） | 100 行；Fuyao 热榜**不返回** `concepts`/`tag`（实测行字段确认），本能力是唯一来源；与 Fuyao `hot_stock_list` 前 30 行 `name/rank/heat/rank_change` **30/30 完全一致**（差异只在 Top30 vs 100 行）；`rise_and_fall` 是百分数原值（与腾讯/FTShare 三方一致） |
| Fuyao 池子补列 | `limit_up_pool.open_times`（炸板次数）、`limit_break_pool.first_seal_time`/`last_seal_time` | 上游一直在返回、此前只是没声明；现在进了 `output_schema` 与 guard。四条池子/热榜的 description 都点名缺的列去东财四池 / `ths_hot_list` 取，并写明两家口径不可混算 |

### 9.2 计数口径变更

- 新增 9 条能力：东财 7（四池 + 异动 2 + 概念 1）、同花顺网页直连 2（热榜 + 涨停揭秘）→ **153 → 162**。
- 新增巡检家族 `ths`（`PROBE_FAMILIES` / `FAMILY_ORDER` / `NO_PACE` 同步）；东财 7 条全部 `daily`（三域与 push2 不同域，2026-11-22 本机实测均 HTTP 200，不挂 shadow）。
- 四池巡检用 `trade_date: dayShift(-1)`：固定偏移总有 1/7 天落在周末，但上游会把周末/今天**夹到最近交易日**返回 28 行，因此周末探针仍 PASS；真·非交易日与超窗口返回空池（合法空，不开单）。

### 9.3 仍未做

- **东财人气榜**（`emappdata /stockrank/getAllCurrentList` + push2 `ulist.np` 补名称价格）：主列表可达，但补名称/价格依赖 push2，而 push2 在本机出口当日不可达（同 §8.1 的个股基本面/ST 名单 shadow）→ 等出口复核后再接，或接受「只有排名与代码、没有名称价格」的降级形态。
- 异动池 12 条规则中文名来自上游前端映射，本轮只核对到出现的规则码；`s==6 → e*10` 分支无真样本。
- 跌停池 `board_amount` 口径不可靠（见 §9.1），保留原值但禁止当成交额。
- 涨停揭秘历史窗口实测只到 2025-11-07，更早上游返回参数错误；不含 ST/北交所，那两类仍用 Fuyao 池。

### 9.4 验证

- `npm test`：**1728 pass / 0 fail**（新增 `test/eastmoney-limit-pools.test.mjs` 24 例、`test/ths-source.test.mjs` 16 例、Fuyao 补列 1 例）。
- `npm run check:dsh` 40/40；`npm run smoke:boot` 预设 `broken=null`、`pythonRuntime=present`、族行 20/20。
- `npm run contract:probe` 真打：`--family ths` 2/2 PASS；东财 7 条逐条 PASS；四池真数据另用 2026-11-20 手工复核 28/7/58/23 行。
- `npm run docs:capabilities` 已重生成（162 条）。

## 9.5 实机验收与修复（2026-11-23，2.30.1）

2026-11-23 收盘后按真实「自动模式」session 逐能力跑了一遍：3 条私有 Python 通道必测 + 8 条抽检（新浪期权链、上交所份额、中证 PE、东财涨停池、东财热门概念、同花顺涨停揭秘、Fuyao 炸板池补列、腾讯成交量单位），11 个 session 全部 succeeded，测试树内 39 次 `request_data` 零失败，产物 91 条不变量断言全过。三条发现与修复：

1. **envelope 根级字段对消费者不可见**（影响口径判断，已修）：`raw.json` 里 `trade_date` / `requested_date_clamped` / `upstream_total` / `available` / `note` / `calculated_at` 都有值，但回执只有 13 个 DatasetRef 键、`describe_dataset` 也不返回根级标量，`query_dataset` 报 `query_column_not_found`。E8（东财涨停池）的 collector 明确回告「回执未暴露根级字段」，E14（热门概念）的 `calculated_at`（实际 `2026-11-23 16:00:00`）只能弃用。修复：DatasetRef/读面新增 `envelope`（根级标量 + 一层扁平对象，≤4KB；旧 manifest 读面从 raw 现算）。
2. **`ths_limit_up_detail` 无日期列**（已修）：行内加 `trade_date`（上游 `data.date`），时间轴自动识别，行 schema/护栏/description/时间契约同步。
3. **腾讯 qfq 日线盘后缺当日 bar**（文档修复）：2026-11-23 17:35 实测 600519 `qfqday` 止于 11-20（`day` 已有 11-23），688981 正常；`tencent_kline` 描述补「qfq/hfq 盘后可能未回填，要当日收盘价用 none 或快照」。
4. 过程噪音（不影响数据能力）：PTC 自写程序报错 6 次、AnySearch 抓取失败 8 次、角色越界/时间轴工具误用 3 次，agent 均自行重试成功。

同轮补跑的验收口径：D1 BaoStock 估值 242 行、D2 基本信息 3 行、D3 社融 12 行；B1 510300 = 55,184,887,700 份（与描述对账值逐位相同）；C1 最新 PE 13.09、分位复算 50.18%；E8 146 行且 `upstream_total=row_count`；F2 145 行与东财 146 的差集只有北交所 920690；G2 23 行补列齐全；H1 `volume_unit` 逐行 share/lot。

回归：`npm test` **1735 pass / 0 fail**（新增 envelope 5 例）。
