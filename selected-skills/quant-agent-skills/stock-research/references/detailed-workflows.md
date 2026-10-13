# stock-research 详细工作流参考

> 此文件包含 skill.md 中引用的长 Python 代码块和详细操作步骤。
> 主 skill 只保留编排逻辑和关键模板。此处按需查阅。

## 研报同步（tushare DB → Index DB FTS5）

东财 reportapi 采集的研报写入 `tushare_data_v1.0.db::research_report`，研究读取统一走 `common.report_search` 封装层（优先 Index DB FTS5，自动 fallback 到主库）。**搜索返回 0 篇时先跑同步**：

```bash
# 一行调用（增量同步，只同步新增）
python3 -c "from common.report_search import sync_tushare_reports; print(sync_tushare_reports())"

# 或 CLI（含验证）
python auto_research/sync_tushare_reports.py --full    # 全量重建
python auto_research/sync_tushare_reports.py --verify  # 验证搜索质量
```

**自动降级**：`search_by_stock()` 和 `search_reports()` 已内置三层降级（Index DB FTS5 → Index DB reports_meta LIKE → Tushare DB research_report LIKE），同步缺口会自动兜底。但 FTS5 同步后搜索质量更高（jieba 分词 + 正文可搜）。Conductor/Codex 研究读取入口只用 `common.report_search.search_reports/search_by_stock/get_report_content`；底层 `ResearchReportStore` 只直接用于 `missing()`、`save()`、`auto_tag_from_titles()`、PDF 路径维护和修库。

## 东财 API 三步定式（研究采集 §2.3）

```bash
cd /path/to/quant_research && python3 << 'PYEOF'
import sys, time; sys.path.insert(0, '.')
from data_platform.research_report_collector import fetch_reports, fetch_report_content
from auto_research.research_report_store import ResearchReportStore
from common.report_search import search_by_stock, get_report_content

store = ResearchReportStore()

# 1. 拉取研报列表（含 EPS/PE/评级 结构化字段）
reports = fetch_reports('{6位代码}', top_only=False)  # L2: top_only=True / L3: top_only=False
print(f"东财API返回: {len(reports)} 篇")
for r in reports[:5]:
    print(f"  {r.publish_date} | {r.org_name} | 评级:{r.rating} | EPS:{r.eps_this_year}/{r.eps_next_year} | PE:{r.pe_this_year}/{r.pe_next_year}")

# 2. 检查哪些未入库
all_codes = [r.info_code for r in reports]
missing = store.missing(all_codes)
print(f"\n已入库: {len(all_codes) - len(missing)}, 待拉取: {len(missing)}")

# 3. 拉取正文 + 入库（带限速 + 正文为空时自动 PDF 回退）
report_map = {r.info_code: r for r in reports}
saved = failed = pdf_fallback = 0
for i, code in enumerate(missing):
    r = report_map[code]
    print(f"[{i+1}/{len(missing)}] {r.publish_date} {r.org_name}: {r.title[:50]}...", end=" ", flush=True)
    try:
        result = fetch_report_content(code)  # 东财 API 正文
        content_text = result.get("content", "")
        # 正文为空时，自动走 PDF → Markdown 回退
        if len(content_text.strip()) < 200:
            print("API空→PDF", end=" ", flush=True)
            from data_platform.research_report_collector import fetch_report_markdown
            content_text = fetch_report_markdown(code)
            if content_text:
                pdf_fallback += 1
        doc = r.to_dict()
        doc.update({
            "source": "eastmoney",
            "tags": ["{股票名}", "{6位代码}"],
            "content": content_text,
            "content_length": len(content_text),
        })
        store.save(doc)
        saved += 1
        print(f"OK ({doc['content_length']} chars)")
    except Exception as e:
        failed += 1
        print(f"FAILED: {e}")
    time.sleep(0.5)

print(f"\n入库完成: {saved} 新入 / {failed} 失败 (PDF回退: {pdf_fallback})")

# 4. 验证入库质量 + 正文率告警
by_stock = search_by_stock('{6位代码}', source='eastmoney', limit=200)
with_content = []
for _, r in by_stock.iterrows():
    content = get_report_content(r['info_code'])
    if len((content or '').strip()) > 100:
        with_content.append(r['info_code'])
pct = len(with_content) / max(len(by_stock), 1) * 100
print(f"总入库 {len(by_stock)} 篇, 有正文 {len(with_content)} 篇 ({pct:.0f}%)")
if pct < 90:
    print(f"⚠️ 正文率 < 90%！")
PYEOF
```

## 多关键词轮询检索（研究采集 §2.2）

```python
from common.report_search import search_reports

keyword_groups = [
    "Inovance OR \"Shenzhen Inovance\" OR 300124",
    "servo OR PLC OR \"industrial automation\"",
    "\"factory automation\" OR \"motion control\" OR inverter",
    "elevator OR robotics OR \"new energy vehicle\"",
]

all_intl = {}
for i, kw_group in enumerate(keyword_groups):
    results = search_reports(kw_group, source='zsxq', limit=20)
    print(f"  关键词组{i+1}: {len(results)} 篇")
    for _, r in results.iterrows():
        all_intl[r['info_code']] = r.to_dict()

print(f"\n多关键词轮询后去重: {len(all_intl)} 篇国际投行研报")

from collections import Counter
org_counts = Counter(r['org_name'] for r in all_intl.values())
for org, cnt in org_counts.most_common(10):
    print(f"  {org}: {cnt} 篇")
```

## 本地研报三路搜索（研究采集 §2.2）

```bash
cd /path/to/quant_research && python3 << 'PYEOF'
import sys; sys.path.insert(0, '.')
from common.report_search import search_reports, search_by_stock, get_report_content

# 路 1: 股票中文名（通用搜索）
results = search_reports('{股票全称}', limit=20)
print(f"中文名 => {len(results)} results")

# 路 2: 股票代码 — 精确匹配（避免误匹配）
results = search_by_stock('{6位代码}', limit=100)  # 默认limit放宽；勿显式截到20
print(f"代码(精确) => {len(results)} results")
for _, r in results.head(5).iterrows():
    print(f"  {r['publish_date']} | {r['org_name']} | {r['title'][:80]}")

# 路 3: 英文名/拼音（通用搜索）
results = search_reports('{英文名} {行业关键词}', limit=10)
print(f"英文名 => {len(results)} results")

# 研报正文抽样确认
sample = search_by_stock('{6位代码}', limit=5)
contents = {r['info_code']: get_report_content(r['info_code']) for _, r in sample.iterrows()}
newest = sample['publish_date'].max() if len(sample) else None
print(f"\n最新研报日期: {newest} | 抽样正文篇数: {sum(bool((v or '').strip()) for v in contents.values())}")
PYEOF
```

## PDF 内容提取和即时阅读（研究采集 §2.2）

**Step A — 检查缺少内容的报告:**
```python
import sys; sys.path.insert(0, '.')
from common.report_search import search_by_stock, get_report_content
rows = search_by_stock('{6位代码}', source='zsxq', limit=100)
empty_content = []
for _, r in rows.iterrows():
    content = get_report_content(r['info_code'])
    if r.get('local_pdf_path') and len((content or '').strip()) < 100:
        item = r.to_dict()
        item['content_length'] = len((content or '').strip())
        empty_content.append(item)
print(f"需要提取内容的报告: {len(empty_content)} 篇")
```

**Step B — 批量提取:**
```bash
python auto_research/pdf_content_extractor.py --source zsxq --force --limit 50
```

**Step C — 即时阅读:**
```bash
python3 << 'PYEOF'
import fitz  # pymupdf
for label, pdf_path in [("{机构}", "{pdf路径}"), ...]:
    doc = fitz.open(pdf_path)
    for i in range(min(5, doc.page_count)):
        text = doc[i].get_text()
        if text.strip():
            print(text[:3000])
    doc.close()
PYEOF
```

## 财务数据检查和研究后回填

**前置检查 + 补数:**
```python
import sys; sys.path.insert(0, '{{QUANT_ROOT}}')
from common.stock_financials import get_financials_summary, check_table_coverage
# DB schema查询: PRAGMA table_info(表名) 或 docs/harness/schema-reference.md

coverage = check_table_coverage('002364.SZ')
missing_tables = [t for t, ok in coverage.items() if not ok]
if missing_tables:
    print(f"⚠️ 数据缺失: {missing_tables}")
    if any(t in missing_tables for t in ['daily_basic', 'income']):
        print("核心表缺失，触发 collect-data 补数...")

summary = get_financials_summary('002364.SZ')
```

**研究完成后回填历史空正文:**
```python
empty = [r for r in store.list_by_stock('{6位代码}')
         if r.get('info_code') and len(r.get('content','') or '') < 100]
if empty:
    print(f"回填 {len(empty)} 篇历史空正文...")
    for r in empty:
        md = fetch_report_markdown(r['info_code'])
        if md:
            r['content'] = md
            r['content_length'] = len(md)
            store.save(r)
            time.sleep(0.3)
```

## 双地持久化（§5）

```python
import sys
sys.path.insert(0, '.')
from common.obsidian_bridge import vault_write

base_dir = 'auto_research/knowledge/stock_research/{股票名}-{代码}'
files = ['README.md', '深度研究.md', '财务数据.md', '研报索引.md', '跟踪框架.md']

for f in files:
    with open(f'{base_dir}/{f}') as fh:
        content = fh.read()
    vault_path = f'研究参考/个股研究/{股票名}-{代码}/{f}'
    ok = vault_write(vault_path, content, mode='create')
```
