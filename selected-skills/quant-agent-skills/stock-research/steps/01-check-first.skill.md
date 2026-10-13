---
name: stock-research-step-01-check-first
version: 2.12.1
description: |
  stock-research 第 1 步：检查已有资产。查询本地研究库、DB 财务数据、
  三层知识库检索（MCP Memory + RAG 研报 + 代码符号）、确定研究深度。
  Conductor 在进入第 1 步时加载此文件。
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# 第 1 步：Check-First -- 检查已有资产

**禁止每次研究都从零开始。**

### 1.1 查询本地研究库
```bash
find auto_research/knowledge/stock_research/ -type d -name "*{股票名}*" -o -name "*{代码}*"
```
- 已有目录 → 读取 README.md 确认最后更新日期
- 用户说"更新" → 进入**增量模式**（只改变化文件，不动其他）

**🕐 分层再研究 SLA（替代旧软性"7天询问"，设计稿 §5.9 决策①）** — 按权威研究日期距今天数提示到期，不阻断、只提示：
- 持仓股距上次研究 **≥30天** → 提示 **L0 体检到期**（重打红绿灯 + 三情景概率/EV 重标，不重写研究）
- watchlist 股 **≥90天** → 同 **L0 体检到期**（未持仓，节奏放宽）
- 任何股 **≥365天** → 提示 **L2 全量重研到期**（建议人工触发 monthly_review）

**🌟 两条北极星铁律（治偏空病根，§5.9）：**
- 铁律1：日历节奏只触发 L0 重标（重标概率/EV），**绝不自动升级 L2**——L2 只许事件/命门/双红灯驱动
- 铁律2：复查产出的降级必须过原研究**同等证据**门槛（"涨了→贵了→AVOID"禁，无新证据不得改结论）

**🛑 已有目录必须检查五文件完整性**（防止半成品研究遗留）：
```bash
# 已有目录存在时，立即检查五文件是否齐全
required="README.md 深度研究.md 财务数据.md 研报索引.md 跟踪框架.md"
missing=""
for f in $required; do
  [ ! -f "auto_research/knowledge/stock_research/{目录名}/$f" ] && missing="$missing $f"
done
[ -n "$missing" ] && echo "⚠️ 不完整研究! 缺失: $missing — 优先补全后再更新"
```
缺失文件时 → 告知用户这是不完整研究，建议补全或重新做完整研究。

**⚠️ PDF内容自动提取**：检查到本地KB有国际投行研报但content为空时，**自动触发提取**——不等人工判断：
```python
# 放在三路搜索之后立即执行：检查哪些 Zsxq 报告 content=0
import sys; sys.path.insert(0, '{{QUANT_ROOT}}')
from common.report_search import search_reports, get_report_content

# Codex/Conductor 研报检索入口统一走 common.report_search；底层 store 只负责写入/维护。
hits = search_reports('{6位代码}', source='zsxq', limit=50)
empty = []
for _, r in hits.iterrows():
    content = get_report_content(r['info_code'])
    if r.get('has_pdf') and len(content or '') < 100:
        empty.append(r.to_dict())
if empty:
    print(f"⚠️ {len(empty)} 篇报告有PDF但content为空，自动触发提取...")
    # 直接用 pymupdf 即时阅读（不做回填），研究完成后再跑 pdf_content_extractor 回填
```
**注意**：研究期间的即时阅读用 `fitz.open().get_text()`（快，不回填），研究完成后跑 `pdf_content_extractor.py`（慢，回填知识复利）。

### 1.2 查询本地行情/财务 DB

**首选方式：`get_financials_summary()` — 一行调用拿全所有核心指标，禁止猜列名写 ad-hoc SQL。**

```python
import sys; sys.path.insert(0, '.')
from common.stock_financials import get_financials_summary, print_summary, fetch_financials

# 1. 一行拿核心指标（PE/PB/分位/营收/净利/毛利率/ROE/负债率/季度数据）
summary = get_financials_summary('688498.SH')
for k, v in summary.items():
    if k not in ('_raw', 'quarterly_data'):
        print(f"  {k}: {v}")

# 2. 季度数据（用于 TTM 手工计算和趋势判断）
for q in summary['quarterly_data']:
    print(f"  {q['end_date']} | 营收: {q['revenue']} | 净利: {q['net_profit']}")

# 3. 如果 summary 不够用，用 fetch_financials() 拿完整 dict
# 4. 需要更深数据（如收入拆解/现金流），再写精确 SQL
```

**⚠️ Worktree 路径隔离**：EnterWorktree 后 `sys.path.insert(0, '.')` 不可用（worktree 下没有 `common/` 模块）。DB 查询、财务数据、研报库读写**一律用主仓库绝对路径**：
```python
import sys; sys.path.insert(0, '{{QUANT_ROOT}}')
# 后续所有 DB/Store 操作正常 import
```

**⚠️ PE_TTM 陈旧警告**：`daily_basic.pe_ttm` 基于系统 TTM 盈利数据，如果公司近期盈利大幅变化（扭亏/爆发），系统 PE 会严重失真。**直接使用 `summary['manual_pe_ttm']`** ——v2.8.0已内置自动单位换算（total_mv万元/净利万元）：

```python
# 一行拿手工TTM PE（v2.8.0新增，自动处理total_mv/净利的单位换算）
manual_pe = summary['manual_pe_ttm']
# 与系统PE对比，差异>30%说明系统PE失真
if manual_pe and summary['pe_ttm']:
    divergence = abs(manual_pe - summary['pe_ttm']) / summary['pe_ttm']
    if divergence > 0.3:
        print(f"⚠️ 系统PE失真: 手工{manual_pe:.1f} vs 系统{summary['pe_ttm']:.1f}, 差异{divergence:.0%}")
```

**DB 数据缺失时的 fallback**：先调用 `check_table_coverage(ts_code)` 确认哪些表缺数据 → 缺核心表（daily_basic/income）→ **必须调 `collect-data` skill** 补数 → 仍缺则 Web 搜索兜底。

**⚠️ 数据新鲜度检查**：`get_financials_summary()` 调用后检查最新数据季度。若最新季度 < 当期-1季，标注在财务数据.md中并用 YoY 增速推算缺失季度。缺 >2 个季度 → 降级为 `DONE_WITH_CONCERNS`。

### 1.3 搜索项目知识库 — 三层检索（新增）

**禁止只搜研报不搜记忆。** 项目 500+ 条历史 observation 包含过去的个股研究结论、因子表现、教训——这些都是复利资产。

#### Layer 1: MCP Memory 语义搜索（项目记忆 + 教训）

```bash
# 重建 + 激活知识库（每次研究的 Check-First 第一步）
# 搜索过去的个股研究、决策记录、失败教训
mcp__plugin_claude-mem_mcp-search__rebuild_corpus(name="quant_research")
mcp__plugin_claude-mem_mcp-search__prime_corpus(name="quant_research")
mcp__plugin_claude-mem_mcp-search__query_corpus(
    name="quant_research",
    question="{你的研究问题，如：这只股票之前研究过吗？有什么风险发现？相关行业有什么教训？}"
)
```

#### Layer 2: RAG 研报语义搜索（4045 篇研报全文 — SQLite FTS5 主索引 + 向量降级）

```python
from common.report_search import search_reports, search_by_stock, get_report_content

# 🛑 检索铁律(2026-05-29根治，防漏检复发):
#   主力① search_by_stock(code) — 拿个股全部研报，默认limit放宽，返回 content_len/has_pdf
#   主力② 国际投行行业研报用 search_reports(keyword, source='zsxq')
#   主力③ 需要正文全文时逐条 get_report_content(info_code)
domestic = search_by_stock('{6位代码}', limit=100)
intl_reports = search_reports('{英文关键词}', source='zsxq', limit=50)
company_reports = search_reports('{股票名} {核心概念}', limit=30)

contents = {
    r['info_code']: get_report_content(r['info_code'])
    for _, r in intl_reports.iterrows()
}

# 需要写入、missing/save、auto_tag、PDF路径维护时，才进入底层 ResearchReportStore。
```

#### Layer 3: 代码符号搜索（模块/函数定位）

```bash
# 快速找相关因子、策略模块
mcp__plugin_claude-mem_mcp-search__smart_search(query="{因子名/模块名}")
```

### 1.5 查询 Vault / MCP Memory
搜索你的本地知识库（如 Obsidian Vault）或 MCP memory 是否已有该股票的知识节点。避免重复创建，优先更新已有实体。

### 1.6 确定研究深度
根据用户意图和你的把握度，判断执行 L1 / L2 / L3。不确定时默认 L2，但告知用户。
