---
name: stock-research-step-02-data-collection
version: 2.14.2
description: |
  stock-research 第 2 步：委托采集。先调 collect-data skill 完成 DB+API 层统一采集，
  再跑研究特有数据（本地研报KB三路搜索+PDF提取、Web实时数据兜底、新闻情绪采集、
  L3替代调研）。Conductor 在进入第 2 步时加载此文件。
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# 第 2 步：委托采集 -- 紧耦合质量要求

## 2.0 数据采集统一入口：collect-data skill

**所有 DB 和 API 数据采集必须通过 `collect-data` skill 完成。禁止绕过 collect-data 直接调 API。**

collect-data 是项目的统一数据采集入库层，内建 DB-First 铁律（外部 API → 本地 SQLite DB → 业务代码读 DB）：

| 采集维度 | collect-data 数据源 | 入库表 | 下游读取方式 |
|---------|-------------------|--------|------------|
| A股行情/PE/PB | Tushare `daily` + `daily_basic` | daily_price / daily_basic | `get_financials_summary(ts_code)` |
| 财务三表+指标 | Tushare `income/balancesheet/cashflow/fina_indicator` | income / fina_indicator 等 | `get_financials_summary(ts_code)` |
| **东财研报列表** | **东财 ReportAPI → collect-data** | **research_report** | **`common.report_search.search_by_stock/search_reports/get_report_content`**（采集后跑 `sync_tushare_reports()` 同步到 FTS5） |
| **分析师一致预期(前瞻EPS/修正)** | **Tushare `report_rc` → `data_platform/report_rc_collector.py`** | **analyst_report_rc** | **`analyst_consensus.get_research_summary(ts_code)`**（前瞻EPS共识+真前瞻PE+券商上调/下调方向）。A股L2+研究先采: `ReportRcCollector().collect([code], start_year=本年-2)`，港股不覆盖(走hk_report_collector) |
| 北向资金 | Tushare `moneyflow_hsgt` + a-stock-data 分钟级 | northbound_money / hsgt_top10 | SQL 查询 |
| 龙虎榜 | a-stock-data 东财 datacenter → collect-data | lhb_detail | SQL 查询 |
| 融资融券 | a-stock-data 东财 datacenter → collect-data | margin_detail | SQL 查询 |
| 大宗交易 | a-stock-data 东财 datacenter → collect-data | block_trade | SQL 查询 |
| 股东户数 | a-stock-data 东财 datacenter → collect-data | stk_holdernumber | SQL 查询 |
| 分红送转 | a-stock-data 东财 datacenter → collect-data | dividend | SQL 查询 |
| 资金流向 | a-stock-data 东财 push2 → collect-data | moneyflow | SQL 查询 |
| 限售解禁 | a-stock-data → collect-data | lockup_calendar | `toolchain/lockup_calendar.py` |
| 国际宏观 | AkShare + yfinance + FRED → collect-data | macro_intl_daily / fred_macro | SQL 查询 |

**与 a-stock-data 的关系**（collect-data SKILL.md 已定义）：
```
collect-data (编排+入库层)
    ├── 调度 a-stock-data 的 28 个端点获取原始数据
    ├── INSERT OR REPLACE 入本地 SQLite DB
    └── 验证入库数据完整性
    
a-stock-data (API 调用层)
    ├── 7 层架构: 行情/研报/信号/资金面/新闻/基础数据/公告
    └── 每个端点自包含完整 Python 调用代码
```

**执行顺序（两步走）**：
```
第 1 步: 调 collect-data → 完成 DB+API 层数据采集
         （覆盖 §2.1 DB 财务 + §2.3 东财 API + §2.5.5 a-stock-data 信号/资金面）
第 2 步: 跑研究特有数据
         （§2.2 本地 KB 搜索+PDF 提取 + §2.4 Web 搜索兜底 + §2.6 新闻情绪 + §2.7 L3 替代调研）
```

**为什么必须走 collect-data**：
- **DB-First**：collect-data 保证数据先入库、下游只读 DB，可追溯可回放
- **幂等安全**：INSERT OR REPLACE，重复跑不产生脏数据
- **降级链闭环**：Tushare → AkShare → yfinance → FRED，四路自动降级，单一 skill 内闭环
- **断点续跑**：collect-data 内建 checkpoint，大股东采集中断后可从上次继续
- **禁止绕过**：直接调 Tushare API / akshare / a-stock-data 不入库 = 违反铁律 #2 + 数据不可追溯

---

以下各节是**研究特有**的数据采集（collect-data 覆盖不到的部分）：

### 2.1 DB财务数据（collect-data 已入库，直接 `get_financials_summary()` 读取）

**v2.8.0：前置检查 + 自动补数**

```python
import sys; sys.path.insert(0, '{{QUANT_ROOT}}')
from common.stock_financials import get_financials_summary, check_table_coverage
# DB schema查询: 用 PRAGMA table_info(表名) 或参考 docs/harness/schema-reference.md

# 0. 前置检查：哪些表有数据？（避免反复 PRAGMA 探索）
coverage = check_table_coverage('002364.SZ')
missing_tables = [t for t, ok in coverage.items() if not ok]
if missing_tables:
    print(f"⚠️ 数据缺失: {missing_tables}")
    # 核心表缺失 → 必须调 collect-data
    if any(t in missing_tables for t in ['daily_basic', 'income']):
        print("核心表缺失，触发 collect-data 补数...")
        # → 调用 collect-data skill: Tushare → AkShare → yfinance 降级链

# 1. 一行拿核心指标（含 v2.8.0 新增 manual_pe_ttm）
summary = get_financials_summary('002364.SZ')

# 2. 需要写SQL时，用 schema 速查卡避免 PRAGMA
# cols('income') → 直接返回 income 表所有核心列名
# sql_select('income') → 快速生成标准 SELECT
```

- **首选**: 直接调用 `get_financials_summary(ts_code)` ——已包含 PE/PB/分位/ROE/毛利率/负债率/营收增速/季度数据 + **手工TTM PE**
- **需要更深数据**时: 用 `PRAGMA table_info(表名)` 确认列名后再写 SQL，**禁止猜列名**
- **DB 数据缺失**时: `check_table_coverage()` 发现核心表缺数据 → **必须调 `collect-data` skill**（Tushare → AkShare → yfinance → FRED 降级链采集入库后重试）→ 仍缺则标注 `[数据缺失]` 并用 Web 搜索替代

### 2.2 本地研报知识库 → **优先查询**（在 Web 搜索之前）

**项目的研报知识库是核心差异化武器——禁止跳过这一步直接搜 Web。**

#### 🛑 硬性执行检查表（必须逐项输出，禁止静默跳过）

**执行完 §2.2 后，你必须在对话中显式报告以下检查表的每一行。未运行就写"未执行"，0结果就写"0"，禁止用"查过了"等模糊表述代过。**

```
┌──────────────────────────────────────────────────────────────┐
│ §2.2 研报检索执行检查表（Conductor 逐项填写实际命中数）         │
├──────────────────────────────────────────────────────────────┤
│ □ 0. auto_tag_from_titles(): ____ 篇新标记                    │
│ □ 1. search_by_stock('代码'): ____ 篇（zsxq: ____ 篇）        │
│ □ 2. search_reports(英文关键词, source='zsxq'): ____ 篇       │
│ □ 3. search_reports(中文名): ____ 篇                          │
│ □ 4. search_reports(英文名+行业英文): ____ 篇                 │
│ □ 5. 五大行定向检查: GS__ MS__ UBS__ JPM__ Nomura__           │
│ □ 6. 最新 publish_date: ____ / 30天内____ 篇                  │
│ □ 7. 多关键词轮询: ____ 组关键词 → 去重后 ____ 篇               │
│ □ 8. PDF内容提取: 触发____ 篇 / 成功____ 篇 / 跳过____ 篇      │
├──────────────────────────────────────────────────────────────┤
│ 汇总: 东财____ 篇 + Zsxq____ 篇 = 总计____ 篇                  │
│ 判断: □ 充分 □ 不足→触发§2.3东财API □ 真空→标注+切换§2.3      │
└──────────────────────────────────────────────────────────────┘
```

**这个检查表不是建议——是强制输出。缺少此检查表的研究视为"数据采集未完成"。**

**⚠️ A股覆盖预期管理**：国际投行研报主要覆盖港股+美股+A股少数龙头（茅台/宁德/比亚迪），**A股中盘股大概率 KB 全空**。这不是采集问题，是国际投行覆盖率的结构性限制。三路搜索0结果时：
- 不要浪费时间反复搜——0结果本身是信号（机构不去的地方=你的机会）
- 立即切换到东财API为主数据源（§2.3）
- 研报索引中标注 `[信息真空] 国际投行无独立覆盖`

#### 前置步骤：自动打标（确保国际投行研报能被股票代码搜到）

```python
import sys; sys.path.insert(0, '.')
from common.report_search import search_reports, search_by_stock, get_report_content

# Codex/Conductor 研报读取入口统一走 common.report_search。
# 只有 auto_tag/missing/save/PDF路径维护这类存储层动作才直接进 ResearchReportStore。
from auto_research.research_report_store import ResearchReportStore
store = ResearchReportStore()
tagged = store.auto_tag_from_titles()
print(f"自动打标: {tagged} 篇新标记（增量，已有标签的跳过）")
```

**为什么必须这一步**：国际投行研报入库时 stock_code 字段经常为空（仅 0.6% 有标签），但标题中显含股票代码如 `（300124.SZ）`、`(9992.HK)`。不执行自动打标，这些研报在按股票代码搜索时全部不可见——等于把 Goldman Sachs、Morgan Stanley 的研报白采了。

#### 强制规则：必须三路搜索（中文名 + 代码精确匹配 + 英文名）+ FTS5 国际投行定向检索

ResearchReportStore v3.3.0 — **save() 三写**（JSON + reports_meta + FTS5），采集即可搜。6,413 篇全量入库（东财 4007 + Zsxq 2406）。研究读取入口用 `common.report_search.search_by_stock()` 精确匹配、`search_reports()` 多关键词/机构检索、`get_report_content()` 取正文；底层 `ResearchReportStore` 只作为写入、missing/save、auto_tag 和 PDF 路径维护实现。完整 Python 脚本见 `references/detailed-workflows.md` §本地研报三路搜索。

**架构保证**：任何通过 `store.save()` 入库的研报自动写入 JSON + SQLite meta + FTS5 索引 + 原始正文表。采集完就能搜，不需要手动同步。`collect-data` 的研报采集流程也已改为双写（tushare DB 存档 + store.save() 搜索索引）。

**搜索优先级（从上到下，逐个执行，禁止跳过）**。完整代码见 `references/detailed-workflows.md` §本地研报三路搜索。

核心路径: `auto_tag_from_titles()` → `search_by_stock('代码', limit=100)` → `search_reports(英文名, source='zsxq')` → `search_reports(中文名/产品/客户/竞品关键词)` → `get_report_content(info_code)` 全文读取 → 五大行定向检查。

**🛑 正文检索入口**：Conductor 不直接调用 `fts_search()` 当研究读取入口；用 `search_reports()` 拿候选，再逐条 `get_report_content(info_code)` 验证正文。底层 FTS5 默认不返正文的旧坑由 wrapper 隔离，防止把“只返元数据”误判成“0篇正文”。`search_by_stock()` 默认 limit 放宽，防止代码精确匹配被截断。

**⚠️ 多关键词轮询检索策略 — 提升国际投行研报命中率**：

Zsxq 国际投行研报标题全英文，且公司名/行业名表述多样，**单次搜索命中率低**。必须用多组相关关键词反复检索，覆盖不同表达方式：

完整代码见 `references/detailed-workflows.md` §多关键词轮询检索。核心：4组英文关键词(公司变体/产品技术/赛道/下游) → FTS5轮询 → info_code去重 → 按机构分组。

**关键词构造原则**：
- 公司名要多变体：全称、缩写、中文名拼音（英译研报可能用拼音）
- 产品/技术名要英文：伺服=servo, 变频器=inverter, 减速器=reducer/reduction gear
- 行业名要英文：工业自动化=industrial automation/factory automation
- A 股代码加 .SZ/.SH/.SS 三种后缀都试（Bloomberg 用 .SS，Tushare 用 .SH/.SZ）
- 竞争对手和上下游公司名——这些公司的研报中可能提到目标公司
- **不要一次搜完就停**——每组关键词能捞到不同机构的不同报告

#### 搜到本地研报后的强制动作：提取 PDF 内容

搜到研报后禁止只看元数据。必须提取 PDF 全文内容。详细 Python 脚本见 `references/detailed-workflows.md` §PDF 内容提取。

三步：检查 content 为空 → `pdf_content_extractor.py --source zsxq` 批量提取 → `fitz.open().get_text()` 即时阅读（不做回填）。研究完成后跑 `pdf_content_extractor.py` 回填（知识复利）。

#### 🛑 研报全量阅读铁律（禁止抽选/跳过）

**检索到的每一篇研报，都必须完整阅读正文。这是硬规则，不可违反。**

- **全量覆盖**：搜到 N 篇就读 N 篇全文，不抽选、不跳过。禁止"量太大选几篇代表性强的"——你没有资格判断哪篇"代表性强"而不读其他
- **量太大时用 Agent 分批**：如果研报数量很大（30+），启动多个 Agent 分批并行读取，每个 Agent 分配 ≤15 篇。但必须确保每篇都有 Agent 完整读完并提取关键信息。不允许以"上下文不够"为由跳过
- **每篇必须提取**：评级/目标价（含货币单位）/核心论点/关键假设/风险提示/与其他机构的分歧点。提取信息写入最终研究报告的研报索引
- **东财研报同理**：东财 API 拉取的研报正文也必须全量阅读。L2 top_only ~10篇，L3 全量 40-80篇——无论多少，全部读完
- **禁止的错误做法**：
  - "有 22 篇研报，我选 GS/MS/UBS 3 篇代表性强的读" → 禁止，22 篇必须全读
  - "东财 60 篇太多了，只看头部券商 10 篇" → L2 可以 top_only，但 L3 全量拉了就全读
  - "标题看着差不多，读一篇就行" → 禁止，不同机构即使标题相似，正文推导逻辑可能完全不同

#### 为什么这一步不能跳过
- 国际投行报告中的具体数据（如 OCF +2.56 亿、订单细分、产能指引）往往比国内券商和 Web 搜索更精确
- 错过本地研报 = 错过最优质的信息源 = 你的研究质量被打折扣
- 中文名搜索 0 结果 ≠ 本地库没有——代码搜索是保险绳
- **不回填 = 一个人把苦活干了，下次自己或别人还得重干**

#### 信息真空 fallback：三路搜索 + 东财 + Web 全空怎么办？

当**本地 KB + 东财 API + Web 搜索**都没有任何国际投行直接覆盖时：
1. **不要声称"已覆盖"** — 在研究报告中明确标注：`[信息真空] 国际投行无独立覆盖`
2. **不要将行业报告混同为个股报告** — Morgan Stanley 发的"AI Transceivers 行业报告"不等于覆盖了源杰科技
3. **进行行业链替代搜索**：
   ```bash
   # 搜索竞争对手、上下游公司（这些公司被覆盖时可能提及目标公司）
   from common.report_search import search_reports
   search_reports('{竞争公司代码}', limit=10)  # 如中际旭创 300308
   search_reports('{上游材料}', limit=10)      # 如 InP, epiwafer
   ```
4. **信息真空本身是一个信号** — 尤其当 Morgan Stanley 是 H 股 IPO 协调人却不出报告时，值得在深度研究中讨论原因（市值太小？治理问题？合规障碍？）
5. **在 Quality Gate 中标记为 `DONE_WITH_CONCERNS`** — 国际视角缺失会降低交叉验证的可信度

### 2.3 东财研报采集（通过 collect-data 入库 → common.report_search 读取）

**A 股个股 L2 及以上研究，必须从东财 API 拉取研报列表+正文并存入知识库。** 这是获取国内券商精确 EPS/PE 预测序列的唯一标准化渠道——Web 搜索只能拿到零散的净利预测摘要，东财 API 返回的是结构化的 EPS/PE/评级数据，可追踪同一券商跨时间的预测变化。

#### 🛑 执行检查表（A股必填，港股/美股标注"跳过"）

```
┌──────────────────────────────────────────────────────────────┐
│ §2.3 东财API采集检查表（A股 L2+ 强制执行）                     │
├──────────────────────────────────────────────────────────────┤
│ □ fetch_reports('代码'): 返回 ____ 篇                         │
│ □ 已入库: ____ 篇 / 待拉取正文: ____ 篇                        │
│ □ 正文拉取完成: ____ 篇 / 失败: ____ 篇 / PDF回退: ____ 篇     │
│ □ 正文率: ____% (≥90% ✅ / <90% ⚠️)                          │
│ □ EPS预测序列: 最早____ 最新____ 覆盖____ 家券商               │
│ □ 卖方EPS偏差: □ 已对比 □ 数据不足跳过                         │
└──────────────────────────────────────────────────────────────┘
```

#### 为什么必须先跑东财 API（三层漏斗的基石）

- **结构化数据 Web 搜不到**：`fetch_reports` 返回每条研报的 `eps_this_year/eps_next_year/eps_next_two_year` + `pe_this_year/pe_next_year/pe_next_two_year` + `rating` + `org_name`。这些字段在 Web 搜索中零散分布在不同的文章里，无法系统收集
- **EPS 预测准确率追踪**：对比同一券商不同日期的 EPS 预测 vs 实际 EPS，可以量化卖方系统性偏差——这是发现"近20家券商连续两年看走眼"的唯一方法
- **知识复利**：入库后下次研究同一股票自动跳过（`missing()` 检查），不同股票共享同一知识库

#### 三步定式 → 完整代码见 `references/detailed-workflows.md` §东财 API 三步定式

核心流程: `fetch_reports('代码')` → `store.missing()` → `fetch_report_content()` 逐篇入库 → 正文率验证 ≥90%。研究完成后跑回填脚本（`references/detailed-workflows.md` §财务数据检查和研究后回填）。

**双库一致性硬闸（v2.40.0）**：东财正文有两层落点：主库 `data_platform/tushare_data_v1.0.db::research_report` 负责结构化存档和 fallback，`auto_research/knowledge/research_reports_index.db::reports_meta/reports_raw_content` 负责 RRS/FTS 阅读检索。L2+ 写报告前必须对账；如果 RRS 已有 `source=eastmoney` 正文，但 `research_report` 缺条目或正文短，先跑幂等回填：

```bash
python scripts/sync_rrs_eastmoney_to_research_report.py --code {6位代码} --name {股票名} --dry-run
python scripts/sync_rrs_eastmoney_to_research_report.py --code {6位代码} --name {股票名}
```

输出中的 `missing_in_research_report` 和 `short_content_refreshed` 必须结算为 0 或已说明原因；否则不能写“东财正文已穷尽”。如果主库条数多于 RRS，标记为 `raw_only_count`，再按需要跑 `python auto_research/sync_tushare_reports.py --dry-run` 检查 raw→RRS 同步，禁止把其中任一库单独当全景。

**正文率必须 ≥ 90%**。入库后自动验证，不达标立即报告。正文为空时自动走 PDF→Markdown 回退。

**参数说明**：
- `top_only=True`（L2 默认）：只拉头部券商（中金/中信/华泰/申万/海通/国君/招商/广发/兴业/天风），速度快，覆盖核心观点
- `top_only=False`（L3 必选）：拉全量，约 40-80 篇，用于完整追踪 EPS 预测序列 + 发现冷门券商的独特观点
- 每次研究同一股票时，`missing()` 自动跳过已入库的——不会重复拉取

**L3 全量拉取耗时优化**：40+ 篇正文拉取（每篇 0.3s 限速）需要 12 秒+。**正文入库必须后台跑，不要阻塞其他采集步骤**：
```bash
# 后台启动东财正文入库（不阻塞主流程）
python3 << 'PYEOF' > /tmp/eastmoney_ingest_{code}.log 2>&1 &
# ... 正文拉取 + 入库代码 ...
PYEOF
# 主流程同时进行：本地 KB 搜索 + 财务数据 + Web 搜索
# 最后用 store.list_by_stock('{code}') 验证入库数量
```
正文入库期间，**先用 `fetch_reports()` 返回的元数据**（评级/EPS/PE 预测）做分析。这些结构化字段不需要正文。入库完成后的研究读取统一用：

```python
from common.report_search import search_by_stock, search_reports, get_report_content
by_stock = search_by_stock("{6位代码}", source="eastmoney", limit=100)
contents = {r["info_code"]: get_report_content(r["info_code"]) for _, r in by_stock.iterrows()}
```

**核心用法**：
- **EPS 预测准确率追踪**：将券商 EPS 预测序列导出，与 DB 实际 EPS 对比。持续高估 >50% = 系统性乐观偏差，降低该券商预测权重
- **⚠️ 国内券商评级权重为零**：A股券商评级不含卖出选项（合规限制），121篇研报100%看多 ≠ 真全看多 = 系统性bias。**评级对结论的边际价值为零**——结构化的EPS/PE预测序列才是东财API的真正价值。在深度研究中引用券商观点时，引用他们的事实数据和行业分析，但不要引用"买入/增持"评级作为看好理由
- **正文率 < 50%**：部分研报东财 API 无正文（仅元数据），在研报索引中标注 `[仅元数据]`，降低其在深度研究中的引用权重。**正文为空时的PDF回退**：`fetch_report_content` 返回空时，检查是否有PDF下载链接 → 优先 `markitdown` 转 Markdown → 失败才降级 `pymupdf4llm`/OCR → 回填 content。此路径正文质量（Markdown/表格保留）远高于东财正文HTML
- **美股**：跳过此步骤，用 yfinance analyst data 替代
- **港股**：跳过东财API，改走 **§2.3.5 港股研报采集器**（AAStocks + yfinance + 腾讯）

### 2.3.5 港股研报采集（港股 L2+ 强制执行，替代东财API）

**港股不在东财 reportapi 覆盖范围内**，必须用独立采集链路。纯港股/ADR 标的若曾尝试东财 `reportapi` 且返回 0 条或缺 `infoCode`，证据写 `eastmoney_not_applicable_hk`，不能写“东财无研报/正文缺口”。`data_platform/hk_report_collector.py` 是项目的港股研报标准采集器，三源数据融合：

| 数据源 | 覆盖 | 用途 |
|--------|------|------|
| **AAStocks** | 大行报告新闻 + 共识评级 | 港股最全面的免费分析师数据源 |
| **yfinance** | 分析师共识PT + 评级分布 + forward PE | 结构化数据最可靠 |
| **腾讯财经** | 行情快照 | 只进内部 evidence/source note；对外报告统一写本地行情参考价 |

#### 一行调用

```python
import sys; sys.path.insert(0, '{{QUANT_ROOT}}')
from data_platform.hk_report_collector import collect_hk_reports

result = collect_hk_reports('01801')  # 5位港股代码
print(result.summary())
```

#### 🛑 执行检查表（港股 L2+ 强制执行）

```
┌──────────────────────────────────────────────────────────────┐
│ §2.3.5 港股研报采集检查表（港股 L2+ 强制执行）                  │
├──────────────────────────────────────────────────────────────┤
│ □ collect_hk_reports('代码'): 数据源 ____                     │
│ □ Eastmoney reportapi: □ not_applicable_hk □ A股主键另跑§2.3 │
│ □ yfinance 共识: ____ 分析师, PT: ____ (High/ Low: ____)     │
│ □ yfinance 评级: ____ (Strong Buy/Buy/Hold/Sell)             │
│ □ AAStocks 大行报告新闻: ____ 篇                              │
│ □ 腾讯现价: HK$____                                          │
│ □ 上行空间: ____%                                            │
├──────────────────────────────────────────────────────────────┤
│ 汇总: yfinance____ 篇共识 + AAStocks____ 篇大行新闻           │
│ 判断: □ 充分 □ 不足→补充Zsxq国际投行研报搜索                  │
└──────────────────────────────────────────────────────────────┘
```

#### 港股代码格式

- **输入**: 5位港股代码（如 `01801`, `00700`, `09988`）
- **yfinance 内部转换**: `00700` → `0700.HK`（去一个前导0）, `01801` → `1801.HK`
- **AAStocks/腾讯**: 5位代码

#### 输出结构

```python
result.consensus       # HKConsensus: 评级数/目标价/现价/上行空间
result.reports         # List[HKAnalystReport]: 大行报告新闻
result.yfinance_data   # Dict: yfinance 原始分析师数据
result.sources_tried   # List[str]: 成功采集的数据源
result.errors          # List[str]: 失败原因
```

#### 与 Zsxq 国际投行研报的互补关系

港股研报采集器主要提供**大行报告新闻摘要**（中文标题 + 评级/目标价变动），不含研报PDF正文。完整的国际投行研报正文仍需从 Zsxq 知识库（`research_reports_index.db`）检索：

```python
# 港股研报 = hk_report_collector(新闻摘要) + Zsxq(研报正文)
from data_platform.hk_report_collector import collect_hk_reports
from common.report_search import search_by_stock, get_report_content

# Step 1: 大行报告新闻 + 共识
hk_result = collect_hk_reports('01801')

# Step 2: Zsxq 研报正文（已在 §2.2 覆盖）
zsxq_reports = search_by_stock('01801', source='zsxq', limit=100)
contents = {r['info_code']: get_report_content(r['info_code']) for _, r in zsxq_reports.iterrows()}
```

#### 港股研报数据源优先级

```
1. Zsxq 国际投行研报 (本地DB, §2.2) — 深度分析正文
2. hk_report_collector (本步骤) — 大行报告新闻 + 共识
3. yfinance 分析师共识 — 结构化PT/评级
4. 本地港股研报库 (175篇覆盖) — 历史覆盖
```

#### A+H / 纯 H 股财务 fallback 口径（v2.40.11 / v2.40.13）

港股财务接口经常因为 Tushare 权限或覆盖问题返回空。遇到 `hk_fina_indicator` 无权限、0 行或季度字段缺失时：

1. 不把它写成“港股无财务数据”，先调 `collect-data` 的 H 股 fallback：用 `yfinance.Ticker('{code}.HK').financials` / `quarterly_financials` 和 `history()` 入库 `hk_fina_indicator` / `hk_daily_price`。
2. 若 yfinance 同时写入 annual 与 quarterly，且 `end_date=YYYY1231` 重合，年报序列必须优先 `report_type='annual'` / 非 quarterly 行；Q4 行只能做季度轨迹，不能覆盖年报净利、营收、毛利率。改动后跑 `PYTHONPATH=. pytest -q tests/test_stock_financials_hk.py`。
3. 若 yfinance 年度数据可用但季度数据为空，只能把年度财务标 `[B]`，季度财务标 `🔻已降级`；A+H 公司级收入、利润、现金流承重仍优先用 A 股公告/DB（同一公司）或已核验年报。纯 H 股则用已入库年报 + 公司公告交叉，不能把空季度表写成完整财务覆盖。
4. H 股在报告里的角色要分清：可以承载交易价格、折价/AH 溢价、港股共识、watchlist_entry；不能因为 H 股 fallback 财务不完整，就用未经校验的港股季度空表支撑估值。
5. 在 `承重数字结算表` 写明 `Tushare HK权限/覆盖缺口 -> yfinance fallback -> 哪些字段可用/哪些字段降级`，避免下一次研究把 fallback 当完整正式财务表。

#### 避坑指南（已验证，禁止重复踩坑）

| 数据源 | 状态 | 原因 |
|--------|------|------|
| ❌ 东财 reportapi | 不支持港股 | 所有格式(01801/01801.HK/|01801)均返回0结果 |
| ❌ AKShare | 港股API不支持 | `stock_research_report_em` 仅A股 |
| ❌ iwencai | pywencai未安装 | 需要额外安装 |
| ❌ 港交所披露易 | JS渲染 | hkexnews.hk 是 JSF ViewState 表单，WebFetch 无法抓取 |
| ❌ 公司IR页面 | JS渲染 | 大部分港股IR页面需要浏览器渲染 |
| ✅ AAStocks | 可用 | 港股最全面免费分析师数据源 |

### 2.4 Web 实时数据 → 委托 `exa-search` + `deep-research`（兜底补充）

**紧耦合要求**：委托时必须明确输出标准，不满足标准的返回标记为不完整。

```
每条引用必须包含：
- 来源 URL（可点击）
- 发布日期（YYYY-MM-DD）
- 机构/作者名称

券商研报必须额外包含：
- 评级（买入/增持/中性/减持/卖出）
- 目标价（如有）
- 核心论点（一句话）

缺失上述任一字段 → 标记为 [信息不完整]，不纳入交叉验证
```

- `exa-search`：搜索最新券商研报、公司公告、行业数据
- `deep-research`：对"预期差"和"信息差"进行多源交叉验证
- **禁止无引用的陈述** — "市场普遍认为..." 必须跟来源
- **仅在本地研报知识库覆盖不足时使用**


**WebFetch/WebSearch 失败时的 Playwright 渲染回退**：
- 触发条件：WebFetch 返回空/模板变量/JS 未渲染内容
- 工具：`mcp__plugin_ecc_playwright__browser_navigate` → `browser_snapshot`
- 限制：每只股票 ≤3 次渲染请求（控制时间成本）
- 仅当 WebFetch 失败时触发——不额外增加正常路径成本

### 2.5 行业与竞争数据
- 搜索可比公司财务数据（通过 `collect-data` 读 DB）
- 搜索上下游价格/供需（通过 `exa-search`）

### 2.5.5 A股信号与资金面数据 → collect-data 调度 a-stock-data

当研究需要以下数据时，直接激活 `a-stock-data` skill（7层28端点，全部直连HTTP零依赖）：

**信号层（L2+强制采集）**：
- 北向资金动向：沪股通/深股通分钟级流向 → 判断外资态度
- 龙虎榜记录：个股席位买卖+全市场净买入排名 → 判断游资/机构动向
- 限售解禁日历：未来90天待解禁预警 → A股最大的定时炸弹（v2.6.0新增维度）
- 强势股+题材归因：当日热点概念+领涨股 → 判断市场在交易什么
- 概念板块归属：行业/概念/地域三维分类 → 产业链定位验证

**资金面/筹码层（L3必采，L2选采）**：
- 融资融券明细：日级融资余额变化趋势 → 杠杆资金态度
- 大宗交易：成交价/量+买卖方营业部+溢价率 → 机构调仓信号
- 股东户数变化：季度股东数+户均持股 → 筹码集中/分散趋势
- 分红送转历史：每股派息+送股+转增 → 股东回报记录
- 个股资金流120日：主力/大单/中单/小单净流入 → 资金面技术验证

**实时行情（补充DB数据）**：
- 腾讯财经：PE(TTM)/PB/总市值/流通市值/换手率/涨跌停价/指数/ETF
- 百度K线：日K线带MA5/MA10/MA20均价

**使用方式**：
```bash
# a-stock-data 是独立 skill，直接说需求即可激活：
# "帮我查一下300476的北向资金流向"
# "002475最近上过龙虎榜吗"
# "这只票未来3个月有没有解禁"
# "今天哪些行业涨幅最大"
```

采集结果汇总到 Agent 4（风险四维扫描）的"解禁风险"和"概念炒作风险"维度，以及财务数据.md 的"资金面信号"小节。

### 2.6 Fresh Public Signal Sweep + 新闻情绪（L2+ 强制）

研究时必须拉取最近 30 天公司相关新闻，并额外做公开信息快信号扫描。这不是替代 DB 和研报，而是补研报滞后的前置信号层：政策原文、公告、交易所问询、海关/价格、客户/供应商、产业媒体、产品/技术路线变化。投行式做法不是“新闻越多越好”，而是先把碎片信息变成可追溯证据矩阵，再判断它能否进入结论、估值和 trigger。

**来源分级**：

| 等级 | 来源 | 用法 |
|------|------|------|
| S0 | 官方政策、交易所/公司公告、海关/监管/法院、原始管制清单 | 可承载事实主张和 trigger |
| S1 | 公司官网/技术文档、客户/供应商公开材料、权威产业媒体、可复查价格/库存数据 | 可承载产业链判断，但要写清覆盖对象 |
| S2 | 主流财经媒体、券商新闻摘要、二手行业报道 | 只能作线索或预期差，需 S0/S1 或两源交叉验证后进入主结论 |
| S3 | 社媒、自媒体、论坛、群聊截图 | 只作线索，不得进入主结论、估值或交易触发器 |

**Step A0 — 设定检索组**：

```text
{公司名} {股票代码} 最新 公告 订单 客户 产能 调研 问询 减持 处罚
{核心产品/材料/服务} 价格 涨价 供应 中断 替代 客户认证 技术路线
{上游/下游/客户名} + {公司名/产品名}
{英文名/港股名/ADR名} export control supply shortage qualification customer alternative
```

**Step A — 拉取新闻和公开信息**：

```bash
cd /path/to/quant_research && python3 << 'PYEOF'
import akshare as ak
import pandas as pd

# A 股：akshare stock_news_em（东方财富个股新闻）
# ⚠️ 接口漂移（2026-07-19 震裕实证）：当前 akshare 版本参数为 symbol= 且列名为
# 新闻标题/新闻内容/发布时间/文章来源/新闻链接；旧 stock= 参数与 row['标题'] 已失效。
# 若再遇签名/列名漂移，先 print(list(news.columns)) 再取值，禁止按旧模板硬取。
try:
    news = ak.stock_news_em(symbol="{6位代码}")
    if news is not None and len(news) > 0:
        title_col = "新闻标题" if "新闻标题" in news.columns else "标题"
        news = news.sort_values("发布时间", ascending=False).head(20)
        print(f"拉取到 {len(news)} 条新闻（最近 30 天）")
        for _, row in news.iterrows():
            print(f"  [{row['发布时间']}] {str(row[title_col])[:100]}")
    else:
        print("akshare 返回空，尝试 Web 搜索兜底")
except Exception as e:
    print(f"akshare 失败: {e}，使用 Web 搜索兜底")
PYEOF
```

港股/美股用 yfinance + Web 搜索替代（akshare 港股新闻接口不稳定）。

**Step A1 — A股公告 S0 fallback**：

事件驱动 A 股 L2+/L3 不允许只靠新闻摘要或券商复述。先跑
`data_platform/cninfo_collector.py --code <ts_code> --category 临时公告 --download-pdfs`。
如果返回 0，但线索指向订单、中标、客户、诉讼、融资、产能、项目或重大合同公告，
用 `<code6> + <股票名> + <事件关键词> + 公告/PDF` 二次查官方/交易所 PDF；
把 PDF/TXT 放入 `data_platform/cninfo_output/`，以 `company_announcement_pdf`
或 `cninfo_fallback` 入 RRS，并在 `_public_signal_matrix_YYYYMMDD` 写明
collector 0 行、fallback 查询、local path、RRS `info_code`。0 行不能写成
“无公告”，只能写 `collector_miss_fallback_used` 或 `pending_s0_announcement_check`。

**Step B — 证据矩阵**：

把所有命中的新闻/公告/公开资料先落成矩阵，命名 `_public_signal_matrix_YYYYMMDD.{md,json}`，并在 `财务数据.md` 或 facts_file 中摘要。

```markdown
## 公开信息证据矩阵

| 日期 | 来源级别 | 来源/URL | 事实主张 | 二次验证 | 影响链条 | 进入结论? |
|------|----------|----------|----------|----------|----------|-----------|
| YYYY-MM-DD | S0 | 交易所公告 | 大客户订单/问询/处罚 | 原文命中 | 收入/风险 | 是 |
| YYYY-MM-DD | S1 | 产业媒体/客户材料 | 客户开始验证替代路线 | 需客户/设备商交叉 | 技术替代 | 降级 |
| YYYY-MM-DD | S2 | 大行新闻摘要 | 某机构 TP/EPS/ASP/GM 上修 | 需同机构原文或第二来源/价格数据交叉 | 盈利路径/估值锚 | 进 street_revision_delta |
```

硬闸：
- S2/S3 不能单独改变评级、仓位、目标价、入场线；
- 券商/投行上调新闻必须拆 `old_value`、`new_value`、`revision_magnitude_pct`、`driver_type=earnings_path|multiple_only|mixed`，若是 ASP/毛利率/订单等盈利路径上修，必须传给 Step 3.2.b 的 `street_revision_delta`；
- “产业链交叉阅读”必须和“公司直接覆盖”分开写；
- 市场影响拆成 `发生了什么`、`一阶受益/受损`、`二阶替代或反身性`、`股价是否已反映`；
- 公告/财报/订单/政策/客户认证/产能事件必须额外写 `pre_event_expectation`、`priced_in_view`、`actual_disclosure`、`delta_class=BEAT|IN_LINE|MISS|AMBIGUOUS`、`action_boundary`；`event_occurred` 或 `confirmed` 只说明发生，不说明利好；
- 与研报矛盾时，写成“研报滞后待验证”或“公开信息证伪旧假设”，并生成下一次验证 trigger。

**JSON 行级字段合同（`_public_signal_matrix_YYYYMMDD.json`，closeout batch audit 机械校验，缺字段直接 BLOCK）**：

每一行事件（`rows`/`events`/`signals`/`matrix`/`items` 任一容器键均可，但推荐 `events`）必须同时带齐两组字段：

1. 分级与用途四字段：
   - `source_tier`：`S0_OFFICIAL` / `S1_COMPANY_OR_AUTHORITATIVE` / `S2_CREDIBLE_MEDIA` / `S3_SOCIAL_RUMOR`（不要只写裸 `S0/S1`，机械审计按受控词表读）；
   - `verification_status`：如 `verified_s0_pdf_saved` / `verified_full_text` / `verified_db_multi_source` / `unverified_s2_lead`；
   - `affected_thesis_leg`：该行影响的是哪一条 thesis 腿（如"合同价补涨腿"）；
   - `decision_use`：该行在决策里的用途（如"仅 trigger，不进仓位"、"street_revision_delta 输入"）；
2. 事件预期差五字段（凡公告/财报/订单/政策/客户/产能/产品/催化事件）：
   - `pre_event_expectation`、`priced_in_view`、`actual_disclosure`、`delta_class`、`action_boundary`。

顶层的 summary/count 字段不能替代行级字段；别名键名（`level`/`verification` 等）不被审计识别。

**Step C — LLM 情绪三分类**：

将拉取的每条新闻用 LLM 做情绪分类：

```text
你是金融情绪分类器。对以下新闻逐条标注情绪标签，只输出 JSON 数组：

情绪标签定义：
- 利好：只有相对 `pre_event_expectation` 明确 `BEAT` 的业绩、订单、客户、政策、涨价、技术或产能事件
- 利空：业绩下滑/不及预期、大股东减持、监管处罚/问询、行业整顿、核心人员离职
- 中性：例行公告、人事变动（非核心）、行业新闻提及、调研接待、按计划推进、符合预期披露、`IN_LINE` 利好落地

新闻列表：
1. [2026-05-15] 某公司Q1净利同比增长53%，创历史新高
2. [2026-05-10] 某公司股东计划减持不超过2%股份
...

输出格式：
[{"idx": 1, "sentiment": "利好", "reason": "业绩超预期增长"}, ...]
```

**Step D — 情绪汇总表**（放入财务数据.md 末尾）：

```markdown
## 新闻情绪快照（最近 30 天）

| 情绪 | 条数 | 占比 |
|------|------|------|
| 利好 | X 条 | Y% |
| 利空 | Z 条 | W% |
| 中性 | N 条 | M% |

- 总条数: {total}（数据截止: YYYY-MM-DD）
- 情绪偏离度 = 利好% - 利空% = {bias}%
- 解读: {bias > 60% → 市场情绪可能过度乐观，反向指标信号；bias < -40% → 市场情绪可能过度悲观，关注利空出尽；其他 → 情绪中性}
```

**情绪是辅助参考不是决策依据**。利好新闻多不等于应该买——尤其在股价已大涨之后。用途：
1. 极端乐观 + 高位 → 利好出尽，警惕反转
2. 极端悲观 + 低位 → 利空出尽，关注底部信号
3. 情绪与你的判断同向 → 预期差可能已被市场消化，超额收益空间缩小
4. 公告情绪必须先通过预期差分类；利好条数多不等于新利好，`IN_LINE` 是已兑现/已消化

### 2.7 L3 替代调研（仅重仓级）
至少执行一种：
- 招聘数据分析（公司扩招/裁员趋势 → 判断战略方向）
- 上下游供应商/客户验证（上下游公司的公开数据中找交叉证据）
- 用户评价/产品口碑爬取
- 工商变更记录
- 实地调研/门店观察（如果可执行）
