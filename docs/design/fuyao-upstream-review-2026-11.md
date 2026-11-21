# Fuyao 上游复核（2026-11-21）：新增能力与 CapGen 缺口的供需对账

> 状态：调研完成；**P0 / P1 已落地（2026-11-21）**，P2 随 X1 立项。上游文档、真报文与本地缺口三方对账。
>
> 输入：上游 `llms-full.txt`（2026-11-21 抓取，16,347 行；本地快照仍为 11,550 行）与
> [`CHANGELOG.md`](https://github.com/Hithink-Tech-Org/Financial-API/blob/main/CHANGELOG.md)；
> 14 条新端点的真报文探针（本机 `FUYAO_API_KEY`，2026-11-21）；`npm run smoke:fuyao` 全量
> 61/61；`~/.dsh/storages/capital_automation.json` 中 2026-11-14–11-20 的 41 份简报 / 364 条 gaps；
> 本地 [`data-collector-capabilities.md`](../data-collector-capabilities.md) 的 132 条能力。
>
> **一句话**：上游确实新增了 37 条端点，但 6 条端内专用；真正可接、且与本周需求重合的只有
> **1 条**（个股行业/概念反查）。需求重心仍在公告正文、事件日历与港股量能——这三块 Fuyao 补不了。

---

## 0. 一页结论

| 问题 | 结论 |
|---|---|
| 上游新增了什么 | 37 条真实端点（路径串 +39，其中 2 个是前缀碎片；原 131 → 167）：A 股特色数据 10（7 公开 + 3 端内）、新股 4、资讯 8、批量 6、dump 3、基金 2、期货/期权目录 2、个股板块反查 1、新增概念 1（端内）。 |
| 能不能用 | **31 条可外部调用**；6 条端内专用（4 条实测 `code=2004`，另 2 条文档标注）。 |
| 与需求重合吗 | **只有 1 条强重合**：`ths-index-list-by-stock`（个股 → 行业/概念/地域/特色，批量 100）对上"板块/行业分类"23 条；`limit-up-statistics` 弱重合（3 条口径抱怨）。其余新增面（IPO、资讯、批量、期货、dump）在本周 364 条 gaps 里几乎零需求。 |
| 需求重心在哪 | 公告/财报正文与官方核验 58、事件日历 38、公告清单覆盖 25、时点/单位元数据 25、口径冲突 23、港股量能 20。**前五项 Fuyao 一条都补不了**。 |
| 本周最高性价比 | 不是新能力：修 `tencent_us_prepost_quote` 的 `before` 标签（1 行，6 条缺口）+ 把 `cninfo_announcements` 写进公告任务的可见面（5–10 条缺口）。 |
| Python 运行时改变了吗 | **没有增加取数面**。`run_code` 仍是"只调度工具与算术"；parquet 包只让 dump 在技术上可读，Dataset 契约、7 天保留与 raw 不可变都没为它让路。 |

**优先级（按"需求 × 增量 × 成本"，不按上游发布顺序）**

| 级别 | 事项 | 为什么 |
|---|---|---|
| **P0** | Fuyao `index_list_by_stock`（1 条） | 唯一强重合；1 条端点把 A5 的"行业/概念归属"从"等新供应商"变成"已有"；还能派生板块领涨股/家数。 |
| **P0（非 Fuyao）** | U1 `before` 修复、A1 可见性 | 需求回归里唯一"1 行代码换 6 条缺口"的修复；新能力之前先做。 |
| **P1** | `limit_up_statistics`（+ `abnormal_monitor_list` 同批） | 官方口径的封板率/晋级率/监控区间，补"自算与页面不一致"；2 条端点，成本低。 |
| **P2** | IPO 日历（A 股 + 港股，3 条） | 需求只有 1 条，**不单独立项**；等 X1 `event_calendar` 落地时作为 IPO 腿，免费且已验证。 |
| **不做** | 龙虎榜席位 3 条、批量 K/财报 4 条、资讯 8 条、期货/期权 15 条、dump 3 条、6 条端内 | 重复覆盖、零需求、与"不建第二个新闻管道"冲突，或与 Dataset 契约冲突。 |

> 执行结果：P0 与 P1 已于 2026-11-21 落地（§9）；P2 仍随 X1 立项。

---

## 1. 上游变了什么

### 1.1 时间线（据 CHANGELOG 与文档路径差集）

| 日期 | 变化 | 对本仓的影响 |
|---|---|---|
| 2026-09-10 | 公开期货 13 + 期权 4，新增 `futures`/`options` 资产类型 | 本仓未接；FTShare 已覆盖国内 10 条期货，海外 F1 仍缺 |
| 2026-09-20 | 同花顺 AI 客户端上线，资金流/高频/期货期权专业数据转端内 | 解释了我们早已实测的 `capital-flow`、`high-frequency` 的 `2004` |
| 2026-10-14 | 涨停统计、个股龙虎榜机构金额、营业部战绩/历史、严重异动、竞价机会、A 股/港股新股 | 本轮新增的主体（10 条） |
| 2026-10-16 | 资讯域 8 条（快讯/文章/公告解读/专题/异动解读/个股新闻） | 与既有 web_retriever 新闻管道重叠 |
| 2026-10 之后 | 原生批量（K 线 3 + 财报 3）、dump 改走 `/api/dump/*` + `X-api-key`、个股板块反查 | 批量与 dump 是"形态/入口"变化，不是新数据 |

### 1.2 新增端点盘点（37 条，可用 31）

| 域 | 条数 | 代表 | 形态 | 增量分级 |
|---|---:|---|---|---|
| A 股特色数据（公开） | 7 | `limit-up-statistics`、`dragon-tiger-stock-institution`、`dragon-tiger-department-*`、`abnormal-monitor-list`、`auction-stock-opportunities` / `-dates` | 统计/名单/聚合 | S/A |
| A 股特色数据（端内） | 3 | `chip-shape-dates` / `-stocks`、`turnover-prediction-snapshot` | — | 不可接 |
| 新股 IPO | 4 | A 股 `ipo/calendar-list`；港股 `application-list` / `calendar-list` / `issue-detail` | 名单/快照 | S |
| 资讯 | 8（7 公开 + 1 端内） | `news/flash/list` / `refresh`、`article/detail`、`notice/detail`、`topic/hot-list`、`stock/timeline-list`、`anomaly/analysis`；端内 `events/search` | 摘要/正文/解读 | S（但重复） |
| 批量 | 6 | A 股/指数/ETF `historical-batch`、三表 `*-batch` | 历史序列 | A（便利） |
| dump 下载 | 3 | `daily-k` / `daily-k-10d` / `adjustment-factors` 的 `download-url` | 仅预签名链接 | B |
| 基金 | 2（1 公开 + 1 端内） | `performance/nav-snapshot`；端内 `etf-flow/net-inflow-historical` | 快照/序列 | B |
| 期货/期权目录 | 2 | `futures/contracts/list`、`options/contracts/list` | 目录分页 | A（覆盖更全） |
| 个股板块反查 | 1 | `constituents/ths-index-list-by-stock`（1–100 只） | 关系快照 | B（但需求对上） |
| 新增概念（端内） | 1 | `a-share-index/baseinfo/new-concepts` | — | 不可接 |

> 合计 37：公开 31、端内 6。端内 6 条里 4 条已实测 `code=2004`，另 2 条（`chip-shape-stocks`、
> `news/events/search`）由文档标注；两条都是同一族的同一判断。

关键事实（均来自文档原文或真报文）：

- **批量上限 10 个原始代码项**（去重前计数），窗口沿用单标：A 股 K 10 年、指数 K 5 年、ETF K 5 年；财报 `limit` 1–20 或日期区间，两种模式互斥。
- **ETF/LOF 快照可一次 100 只**（走原 `fund/market/snapshot` 的 `thscode` 参数）——这是唯一一条"批 100"的量价入口。
- **dump 已可用 API Key 取链接**（真报文返回 `presigned_url` / `expires_in_seconds`），不再是"只能登录页点按钮"；但链接通常 5 分钟有效，且日 K dump 只有**不复权**，复权要自己按因子推。
- **`/api/fund/indicators/line|table` 从文档消失**（不是改名）。能力被拆成固定口径的 `performance/indicators-historical`、`drawdowns`、`financials/indicators`、`backtest/indicators`、`diagnostics`。

---

## 2. 真报文复核（2026-11-21）

### 2.1 新端点探针

| 端点 | 结果 | 判断 |
|---|---|---|
| `limit-up-statistics?date=2026-11-20` | `code=0`，含 `seal_rate`、`open_stock_count`、`limit_up_stock_count`、`page_boards[]`、`exact_boards[]` | 可用，官方口径 |
| `dragon-tiger-stock-institution?thscode=301052.SZ&date=2026-11-20` | `code=0`，1 条，11 字段（机构三金额 + 席位） | 可用 |
| `abnormal-monitor-list?state=current` | `code=0`，2 条，含 `monitor_type`/`monitor_label`/区间 | 可用 |
| `auction-stock-opportunities?date=2026-11-20` | `code=0`，5 条，15 字段；数量单位文档未定义 | 可用但单位不可承诺 |
| `a-share/ipo/calendar-list?market=sh_sz&status=upcoming` | `code=0`，2 条 | 可用 |
| `hk-share/ipo/calendar-list?status=subscribable` | `code=0`，0 条（当时无在招） | 接口通，数据时点为空 |
| `news/flash/list?tag_id=21103&seq=0` | `code=0`，20 条，`summary`+`encoded_url` | 只有摘要，**没有原文** |
| `prices/historical-batch`（2 只） | `code=0`，2 组；返回 `item[].item[]` 嵌套 | 可用 |
| `ths-index-list-by-stock?thscode=600519.SH&type=industry` | `code=0`，返回 `881273.TI 白酒` | 可用 |
| `dump/market-dumps/daily-k/download-url` | `code=0`，返回预签名链接与有效期 | 技术上可下载 |
| `new-concepts` / `chip-shape-dates` / `turnover-prediction` / `etf-flow` | **`code=2004`** | 端内专用，不接 |
| `fund_indicator_line` / `fund_indicator_table`（已注册能力） | 前者 PASS；后者 `5003` | 文档已撤，运行时仍在 |

### 2.2 既有 61 条

`npm run smoke:fuyao` 全量：**61/61 成功，上游/契约失败 0，网络抖动 0**（`fund_indicator_table`
按 5003 记为数据缺口）。结论：**没有"被上游删掉"的能力**，只有"文档不再背书"的两条。

---

## 3. 需求侧：最近一周的 364 条 gaps

### 3.1 数量与结构（2026-11-14–11-20）

| 口径 | 数量 |
|---|---:|
| 简报 / 运行 / gaps | 41 / 48 / **364** |
| `quality` | 159（43.7%，上周 40.2%） |
| `capability` | 132（36.3%，上周 41.6%） |
| `conflict` | 38（10.4%） |
| `transient` | 35（9.6%） |
| 落在旧 18 条 ID 方向 | 197（54.1%） |
| 已有能力的用法/契约/产品问题 | 153（42.0%） |
| 18 条之外的新方向 | **14（3.8%）** |

`capability` 占比下降、`quality` 上升：**缺口重心已从"没有这项能力"移到"有数据但不可核验/不可对齐"**。

### 3.2 Top 主题与处置

| 主题 | 次数 | 处置 | Fuyao 新供给能补吗 |
|---|---:|---|---|
| 公告/财报正文与官方核验 | 58 | 用满 `eastmoney_announcement_body` + `ocr` + 官方域 fetch；来源等级写进契约 | 否（资讯域给解读/摘要，不给公告原文） |
| 事件日历/交易日历 | 38 | **X1 + U3 值得新建** | 仅 IPO 子集（A 股 + 港股） |
| 公告清单/全市场覆盖 | 25 | A1 已落地，补可见性；港/美走 H2/U2 | 否 |
| 时点/延迟/单位元数据 | 25 | 契约修补（`as_of`/`is_delayed`/`unit_text`） | 否 |
| 口径冲突/跨市场对齐 | 23 | 契约 + 源身份断言 | 否 |
| 板块/行业分类与领涨股 | 23 | **A5**；可用新端点先落"归属"，领涨股靠派生 | **是（唯一强重合）** |
| 港股大市/恒科成交额 | 20 | **H1（P0）** | 否（Fuyao 无港股） |
| 南向资金 | 18 | **H3 + 单位/时间窗契约** | 否 |
| 持仓标记/组合口径 | 15 | 产品侧（面板 `held`），不进数据 backlog | 否 |
| 财务口径与估值 | 15 | 契约为主；美港股财务 3 条记观察 | 否 |
| 公司行为（停复牌/分红/回购） | 15 | **A2 停复牌**；其余已覆盖 | 否（Fuyao 无停复牌） |

### 3.3 已落地能力的回归（比新能力更急）

| 能力 | 本周记录 | 事实 |
|---|---:|---|
| U1 `tencent_us_prepost_quote` | 6（覆盖 5/5 个交易日） | 上游返回 `before`，适配层只认 `pre`/`after` 并抛错（`src/sources/tencent-http.ts`）。**确定性 bug，1 行修复。** |
| A1 `cninfo_announcements` | 5 + 10 | 工具已在 web_retriever，也在 web 协议 skill 里；但简报仍以"132 条没有公告能力"入账。**可见性问题，不是能力缺失。** |
| A3 `eastmoney_margin_total` | 2 | 深/京 T+1 完整性，不是缺能力。 |
| G1/G2 | 4 + 9 | 3 条是 G1 明确不承诺的符号（HSTECH/布伦特/LME），属边界而非缺口。 |

---

## 4. 供给 × 需求：能补与补不了

| 需求主题 | 上游新供给 | 判定 |
|---|---|---|
| 板块/行业分类与领涨股（23） | `ths-index-list-by-stock`：1–100 只，`cn_concept`/`industry`/`region`/`tszs` | **补归属**：涨停/异动股批量打上同花顺行业与概念标签；再用 `index_constituents` + `quote` 批量派生板块领涨股与涨跌家数。**注意口径**：这是同花顺行业（`881xxx.TI`），不是申万三级，禁止与 `ftshare_sw_*` 混用后再比较。 |
| 涨跌停/市场宽度（6） | `limit-up-statistics` | **补口径**：封板率、打开家数、页面档位晋级率是官方口径；`page_boards` 的"五板以上"是合并档位，不能当精确家数。与 `limit_up_pool`/`ladder`/`limit_break_pool` 是"统计 vs 名单"分工，不互相替代。 |
| 严重异动/风险（7） | `abnormal-monitor-list` | **弱补**：能补"监管监控区间"这一事实；7 条里 4 条其实是警示函原文（源侧），3 条是异动原因（已有 `anomaly_*`）。 |
| 龙虎榜席位（2） | `dragon-tiger-stock-institution` + 营业部 2 条 | **不补**：`ftshare_dragon_tiger_seats` 已覆盖前五席位；新增的营业部画像无人要。 |
| 事件日历（38） | A 股/港股 IPO 4 条 | **只补 IPO 一脚**；财报日、股东大会、宏观日历仍缺，X1 不能因它降级。 |
| 公告正文（58） | 资讯 8 条 | **不补**：`news/notice/detail` 是结构化解读，`article/detail` 是资讯正文；公告/财报原文仍要走官方 PDF + `ocr`。 |
| 港股量能（20）、南向（18）、停复牌（15）、美股份额/期货 | 无 | **完全补不了**：Fuyao 公开面无港股行情、无停复牌、无海外期货。 |
| 多标的批量（0）、Parquet 导出（0） | 批量 6 + dump 3 | **需求为零**。批量是吞吐优化，不是新事实；dump 与 7 天 Dataset 契约冲突。 |

---

## 5. 优先级与验收

### 5.1 P0：`index_list_by_stock`（A5 的行业腿）

**为什么排第一**：需求侧 23 条、6 条主题里唯一能被新供给直接命中的；成本 1 条端点；能把
"涨停归因只能靠原因串""板块与个股对不上"两件事同时解开。

**形态**

```text
capability: index_membership_by_stock
endpoint:   /api/a-share-index/constituents/ths-index-list-by-stock
params:     thscodes* (1..100, 逗号分隔), type? (cn_concept|industry|region|tszs)
output:     item[]{ thscode, index_list[]{ thscode, name, type } }
taxonomy:   ths（同花顺指数，.TI）；不声明申万口径
```

**验收**

- 真报文 fixture：单只 + 批量 3 只 + 空列表（`index_list: []`）+ `type=industry` 限定。
- 参数层：>100、裸码、中文逗号、非法 `type` 整批拒绝（上游 `1002`，本地不发请求）。
- 输出：`.TI` 代码可被 `index_quote` / `index_constituents` 接受；同一批返回同一份关系快照。
- 文档：`description` 写明"同花顺行业/概念，不是申万"；与 `ftshare_sw_*` 混用禁令。
- 契约：`contract-registry.mjs` 先 `shadow` 一周再转 `daily`。

### 5.2 P1：`limit_up_statistics`（+ `abnormal_monitor_list`）

**为什么**："市场宽度/涨跌停"6 条里 3 条直接是涨停统计口径问题，严重异动 7 条；官方统计能消掉
"自算封板率与页面不一致"。

**验收**

- `seal_rate` / `promotion_rate` 是**小数比例**，输出不转百分数；`page_boards` 的 `five_plus` 合并档位写进描述；`one.promotion_rate=null` 不是 0。
- 同一交易日与 `limit_up_pool` 的计数对账（差异要能解释：ST/新股/北交所口径）。
- `abnormal-monitor-list`：`state=current|history`、`size≤30`、`monitor_type` 1/2=严重异动其余=重点监控；代码/名称可空，输出保留 `null`。
- 两条都进"风险/情绪"同一主题片，避免目录碎片化。

### 5.3 P2 与不做

| 事项 | 处置 | 理由 |
|---|---|---|
| IPO 4 条（A 股 1 + 港股 3） | **随 X1 落地**，不单独立项 | 需求 1 条；X1 的 IPO 腿用它最省（不新增供应商、已验证） |
| `fund_quote` 一次 100 只 | 观察 | 自选股 ETF 现在逐只扇出；但无缺口记录，且改现有 schema 会破坏契约，只能新加批量能力 |
| 批量 K 线/财报 6 条 | 暂缓 | 需求 0；6 条目录成本换吞吐，等"同业批量对比"成为固定任务再上 |
| 龙虎榜机构/营业部 3 条 | 不做 | 与 `ftshare_dragon_tiger_seats` 重复，需求 2 条 |
| 资讯 8 条 | 不做 | 与 §8.2"不建第二个新闻管道"冲突；需求方向相反（要原文，不要摘要） |
| 期货 13 + 期权 4（2026-09-10 起公开，不在本轮 37 条内） | 不做 | F1 要的是 CME/SGX；国内期货 FTShare 已覆盖 10 条 |
| dump / Parquet 3 条 | 维持不做 | 需求 0；全市场 10 年、5 分钟链接、不复权、Dataset 契约四项都不成立 |
| 6 条端内专用 | 写进"不在覆盖范围" | 免得下一轮又当缺口立项 |

---

## 6. Python 运行时：为什么它不改变上面的结论

1. **取数面没变**。`run_code` 是 data_junior 的 PTC 面，纪律是"程序只调度工具与算术"；沙箱
   不拦网络，但**人设禁止程序自己出网**。用 Python SDK 直接打 Fuyao 会绕开 capability 注册表、
   参数规范化、输出护栏、Dataset 落盘与 `source_label`，是把数据层分叉，不是加能力。
2. **parquet 包只解决"能不能读"**。base 带 numpy/pandas，parquet 包带 pyarrow 25.0.1；它让
   dump 从"读不了"变成"读得了"，但**没有**解决"全市场 10 年放哪、保留几天、raw 用什么格式、
   Dataset 如何引用一个 1GB 文件"这四个契约问题。所以 dump 仍是"不做"，只是理由从"技术上不行"
   收窄成"架构上不划算"。
3. **上游的 Python SDK / CLI / MCP / marketdb 都是替代入口，不是新数据**。它们与 REST 同源；
   `marketdb` 是本地 DuckDB 库，接进来等于自建第二套数据层。真要本地库，应当是 Node 侧 source
   下载 + 注册 Dataset，而不是在 `run_code` 里调 SDK。

---

## 7. 契约与巡检动作（本次不改代码，登记待办）

1. **`fund_indicator_line` / `fund_indicator_table`**：上游文档已撤这两条路径（运行时仍在，前者
   PASS、后者 5003）。在 `contract-registry` 降为 `shadow`，`description` 注明"上游文档已撤，
   仅按实测契约维护"，不再在其上做新功能。
2. **"不在覆盖范围"表补 6 条端内**：`chip-shape-*`、`turnover-prediction-snapshot`、
   `fund/etf-flow/*`、`a-share-index/baseinfo/new-concepts`、`news/events/search`。
3. **文档漂移巡检**：本地快照 11,550 行 vs 上游 16,347 行。建议加一条月度脚本，抽
   `llms-full.txt` 的 `/api/*` 路径与 `src/sources/fuyao-rest.ts` 做差集（新增/消失各打一行），
   与 `smoke:fuyao` 同性质、不进 `npm test`。本次只记录，不实现。
4. **批量端点不得改写既有单标能力**：`history` 的 `interval` 仍只有 `1d`，批量才支持 `1w/1mo`；
   不要把 `thscode` 改成数组，新增 `*_batch` capability。
5. **维持既有错误码纪律**：`2004` 不注册、不重试；`5003` 是数据缺口；新端点的 `1002/1003/1004`
   在参数层拦住，不落盘。

---

## 8. 本周动作（建议顺序）

1. 修 U1 `before` → 归一为 `pre`，加一条回归用例（覆盖 5 个交易日 6 条缺口）。
2. 公告任务文案/技能里点名 `cninfo_announcements` 与"它不在 data_collector 132 条里"，消掉 5–10 条误报。
3. 落 `index_list_by_stock`（P0，1 条端点）→ 涨停/异动归因与板块对齐先受益。
4. 下一批再上 `limit_up_statistics` + `abnormal_monitor_list`（2 条）。
5. X1 立项时把 IPO 腿指向 Fuyao 的 A 股/港股 4 条，不再另找供应商。

---

## 9. 执行记录（2026-11-21）

本次按 §5 的优先级落地了 P0 与 P1，未改 P2 与「不做」清单。

| 事项 | 状态 | 落点 / 证据 |
|---|---|---|
| U1 `before` 归一为 `pre` | ✅ | `src/sources/tencent-http.ts`（上游盘前标签 `before`）；`test/tencent-source.test.mjs` 同时覆盖 `before`、`pre` 与未知 `overnight` 响亮失败 |
| A1 可见性 | ✅ | `capital-web-retriever` persona 的「先定来源」改为全市场按日优先 `cninfo_announcements`、按代码用 `eastmoney_announcements`；`capital-data-protocol` skill 写明「不在 data_collector 目录、不要答没有公告能力」 |
| `index_membership_by_stock`（P0） | ✅ | 新增 Fuyao 能力（本轮三颗之一，Fuyao 合计 64）；参数 `thscode`（1–100，上游保持单数名）+ `type`；整批 1002 语义在本地先拦；真报文 `600519.SH → 881273.TI 白酒`；`smoke:fuyao --only index_membership_by_stock` PASS |
| `limit_up_statistics`（P1） | ✅ | 新增 Fuyao 能力（三颗之一）；`seal_rate` / `promotion_rate` 小数比例、`five_plus` 合并档位写进描述；真报文 PASS |
| `abnormal_monitor_list`（P1） | ✅ | 新增 Fuyao 能力（三颗之一）；`state` / `page` / `size≤30`，身份可空、`total` 可空；真报文 PASS |
| `fund_indicator_line` / `_table` 降 shadow | ✅ | 上游文档已撤；两条巡检改 `shadow`（`since` / `evidence` / `revisit` 齐全），描述加「不再在其上做新功能」 |
| 能力总表 / 计数 | ✅ | 135 条（Fuyao 64）；`docs/data-collector-capabilities.md` 重新生成；README、`docs/agent-roles.md` 与测试里的 132/61 同步为 135/64 |
| 端内 6 条与 dump 复核 | ✅ | 写进「不在覆盖范围」：端内 6 条实测/文档确认 `2004`；dump 注明「API Key 可取链接，但 10 年全市场 + 不复权 + Dataset 契约不匹配」 |
| 回归 | ✅ | `npm test` 全绿（见下）；`npm run check:dsh` 40/40；`npm run smoke:boot` 预设与角色 `broken=null` |
| 运行进程 | ⏳ | `src/` 已重建到 `lib/`；运行中的 dsh 进程需重启才会加载新能力（本次会话不自行重启） |

**计数**：`npm test` 1605 用例全绿；`smoke:fuyao` 三条新能力各 PASS；`index_membership_by_stock`
在联调时先按 `thscodes` 写错过一次（上游返回 `1001`），说明「上游参数名以真报文为准」这条闸门仍然有效。
