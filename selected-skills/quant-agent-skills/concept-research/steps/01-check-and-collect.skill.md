---
name: concept-research-step-01-check-and-collect
version: 1.2.0
description: |
  concept-research Step 1：Check-First + 数据采集。
  检查已有研究 → 判断单概念/概念簇 → Fresh Public Signal Sweep → 采集概念指数+成分股 → 研报搜索 → 成分股财务/信号数据。
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# Step 1: Check-First + 数据采集

## Step 1.0: 持仓镜头（必做，不可跳过）

**在开始任何分析之前，先搞清楚用户是否已经持有这个概念的成分股。**

```python
import json, os
from pathlib import Path

# 1. 读持仓 SSoT
portfolio_path = Path("auto_research/knowledge/portfolio_state.json")
if portfolio_path.exists():
    portfolio = json.loads(portfolio_path.read_text())
    raw_positions = portfolio.get("positions") or portfolio.get("holdings", {})
    if isinstance(raw_positions, list):
        holdings = {p["ts_code"]: p for p in raw_positions if p.get("ts_code")}
    else:
        holdings = raw_positions
    # holdings: {ts_code: {shares, cost_price, market, ...}}
    
    # 2. 读概念成分股
    # （此处 concept_code 已知）
    members = conn.execute("""
        SELECT con_code, con_name FROM concept_member
        WHERE concept_code = ? AND valid_to IS NULL
    """, (concept_code,)).fetchall()
    member_codes = {m[0] for m in members}
    
    # 3. 交叉检查。概念簇要先做所有子概念的并集，再检查组合暴露。
    overlap = set(holdings.keys()) & member_codes
    if overlap:
        print(f"⚠️ 持仓中有 {len(overlap)} 只属于本概念:")
        for code in overlap:
            h = holdings[code]
            print(f"  {code}: {h.get('shares', '?')}股 @ {h.get('cost_price', '?')}")
        # → 注入到 facts_file 顶部，确保所有 Agent 看到
        # → 研究结论必须过持仓镜头：已持仓→HOLD/TRIM/ADD，不是"建多少仓"
    else:
        print("✅ 持仓中无本概念成分股")
```

**持仓镜头规则**：
- 如果持仓中有概念成分股 → L2/L3 结论必须对已持仓标的给出 **HOLD/TRIM/ADD** 建议（不是"建仓多少"）
- 概念簇必须分开写“广义重合”和“核心暴露”：并集擦边不等于持有概念龙头
- 持仓信息注入 facts_file 顶部，所有 Agent 必须看到
- README.md 的结论段必须包含"持仓镜头"小节（列出现有持仓+建议动作）
- bridge.md 行动列不可为空

**为什么这步不可跳过**：stock-research 曾因缺失持仓镜头导致9段L3研究全不知用户已持仓，建议全是"建仓多少"而非 trim/add/hold。概念研究同样需要——如果用户持仓中的股票恰好是概念龙头，结论完全不同。

---

## Step 1.1: 检查已有研究

```python
# 1. 搜索记忆：之前研究过这个概念吗？
# mem-search "{概念名}" — 查有没有之前的研究结论

# 2. 检查项目目录
import os
concept_dirs = [d for d in os.listdir('auto_research/knowledge/concept_research/')
                if '{概念关键词}' in d]
# 有旧研究 → 标注"增量刷新"，保留旧结论作对照

# 3. 确认概念代码
import sqlite3
from common.constants import DB_PATH
conn = sqlite3.connect(DB_PATH)
# 概念代码在 concept_daily.ts_code 里, 格式如 '885xxx.TI'
# 概念名在 concept_index_names.name 里；concept_member.con_name 是股票名
# 先查概念名→代码映射
concepts = conn.execute("""
    SELECT DISTINCT cd.ts_code, cin.name
    FROM concept_daily cd
    LEFT JOIN concept_index_names cin ON cd.ts_code = cin.ts_code
    WHERE cin.name LIKE '%{关键词}%'
    LIMIT 20
""").fetchall()
```

**如果概念代码找不到**：
- 同花顺概念代码格式 `885xxx.TI` 或 `883xxx.TI`
- 可尝试 web 搜索 "{概念名} 同花顺概念代码" 获取
- 如果 DB 里确实没有该概念数据 → 调 `/collect-data` 采集

## Step 1.1b: 判断是否需要概念簇

如果 L1 雷达或新闻催化显示多个概念其实属于同一叙事链，不要强行选一个概念代码。先建立 `concepts` 映射：

```python
concepts = {
    "885864.TI": "光刻胶",
    "886054.TI": "光刻机",
    "885897.TI": "中芯国际概念",
    "885893.TI": "国家大基金持股",
}
```

概念簇成立的典型信号：
- L1 Top20 中多个概念同涨；
- 龙头候选重复出现在多个概念成分里；
- 新闻/研报催化不是单一产品，而是材料/设备/客户/政策资金共振；
- 单一概念的成分股分布无法解释真实领涨股。

后续 Step 1.2/1.3 对 `concepts` 中每个 `concept_code` 都要跑；L2 输出时报告并集、交集和 `concept_count`，不要把多个概念分别写成互相重复的研究。

## Step 1.1c: Fresh Public Signal Sweep（L2/L3 必做）

**目的**：补研报和本地 DB 的时滞。投行/顶级卖方会把碎片化公开信息先变成可追溯证据，再判断它是事实、预期差、还是噪音；不要把 Web 搜索当成正文替代，也不要把新闻标题当成结论。

**时间窗**：
- 事件驱动概念：最近 7/30/90 天都扫一遍，7 天看爆点，30 天看传播，90 天看是否已有前置铺垫；
- 周期/资源/政策概念：额外查 6-12 个月政策、价格、海关、客户认证和供需变化；
- 增量刷新：必须标注“本次新增事实”和“旧研究已覆盖事实”。

**来源分级**：
| 等级 | 来源 | 用法 |
|------|------|------|
| S0 | 官方政策、交易所/公司公告、海关/监管/法院、原始法案/管制清单 | 可承载事实主张和 trigger |
| S1 | 公司官网/技术文档、客户/供应商公开材料、权威产业媒体、可复查价格/库存数据 | 可承载产业链判断，但要写清覆盖对象 |
| S2 | 主流财经媒体、券商新闻摘要、二手行业报道 | 只能作线索或预期差，需 S0/S1 或两源交叉验证后进入主结论 |
| S3 | 社媒、自媒体、论坛、群聊截图 | 只作线索，不得进入主结论、估值或交易触发器 |

**最低检索组**（按概念替换关键词，保留检索词到 evidence）：
```text
{概念名} 最新 新闻 政策 订单 价格 涨价 停产 出口管制 进口限制
{核心材料/产品} 供应 中断 替代 客户认证 技术路线
{海外关键词} export control supply shortage qualification alternative customer
{龙头候选1/2/3} 公告 投资者关系 调研 订单 客户 产能
```

**输出 evidence matrix**：落盘到概念目录或临时工作目录，命名 `_public_signal_matrix_YYYYMMDD.{md,json}`；如果 L2 不建目录，也要在快评正文内嵌同样表格。

```markdown
## 公开信息证据矩阵

| 日期 | 来源级别 | 来源/URL | 事实主张 | 二次验证 | 影响链条 | 进入结论? |
|------|----------|----------|----------|----------|----------|-----------|
| YYYY-MM-DD | S0 | 商务部公告 | 对X实施出口管制 | 原文命中 | 供给约束 | 是 |
| YYYY-MM-DD | S1 | 产业媒体/公司材料 | 客户开始验证Y替代路线 | 需客户/设备商交叉 | 技术替代 | 降级 |
```

**硬闸**：
- L2/L3 结论前必须有 evidence matrix；零命中也要写“已查关键词/来源/时间窗/零命中”；
- S2/S3 不能单独改变评级、仓位、目标价、入场线；
- 市场影响必须拆成四列：`发生了什么`、`谁的一阶受益/受损`、`二阶替代或反身性`、`股价/概念指数是否已反映`；
- 与研报矛盾时，不直接取新信息；写成“研报滞后待验证”或“公开信息证伪旧假设”，并给出下次验证触发器。

## Step 1.2: 概念指数数据采集

```python
# 检查 concept_daily 数据新鲜度
freshness = conn.execute("""
    SELECT MAX(trade_date), COUNT(*)
    FROM concept_daily
    WHERE ts_code = ?
""", (concept_code,)).fetchone()

# 如果最新日期距今 > 5 个交易日 → 调 /collect-data 补充
# collect-data 的 concept_daily 采集走 Tushare ths_daily 接口
```

**数据验证**：
- concept_daily 必须有最近 60 个交易日数据（量价分析的最低窗口）
- 如果数据不足 → `/collect-data` 补数后重新验证
- 概念簇场景：每个 concept_code 都必须单独验证最新日期和 60 日覆盖；缺任一子概念数据，结论要降级或先补数。

## Step 1.2b: 个股完整截面日期验证（必做）

概念指数日期不能直接当成成分股扩散度日期。必须找最近一个全市场覆盖 >5000 只股票的日线/基础指标截面：

```python
stock_cross_section = conn.execute("""
    SELECT trade_date, COUNT(DISTINCT ts_code) AS n
    FROM daily_price
    GROUP BY trade_date
    HAVING n > 5000
    ORDER BY trade_date DESC
    LIMIT 1
""").fetchone()

if not stock_cross_section:
    raise RuntimeError("daily_price 找不到覆盖>5000只股票的完整截面，先调 /collect-data 补数")

stock_cross_section_date, stock_cross_section_count = stock_cross_section
concept_latest = freshness[0]
if stock_cross_section_date != concept_latest:
    print(
        "⚠️ 日期口径不同: "
        f"concept_daily_latest={concept_latest}, "
        f"stock_cross_section_date={stock_cross_section_date}, "
        f"stock_cross_section_count={stock_cross_section_count}"
    )
```

**硬闸**：
- 扩散度、成分股涨跌幅、量价排名必须用 `stock_cross_section_date` 或其前推窗口；
- 如果 `MAX(daily_price.trade_date)` 的覆盖不足 5000，只能标为局部/盘中截面，不能用于 L3 结论；
- README 与 `_workflow_evidence_YYYYMMDD.json` 必须同时写 `concept_daily_latest` 和 `stock_cross_section_date`。

## Step 1.3: 成分股数据采集

```python
# 获取当前有效成分股（⚠️必须检查 valid_to）
members = conn.execute("""
    SELECT concept_code, con_code, con_name, valid_from
    FROM concept_member
    WHERE concept_code = ?
      AND valid_to IS NULL
    ORDER BY valid_from DESC
""", (concept_code,)).fetchall()

# 输出: 当前 N 只成分股
# 记录成分股数量变化（与上次研究对比，如有）
```

**成分股变动分析**：
- 最近 30 天新纳入的股票 = 概念扩散信号
- 最近 30 天移出的股票 = 概念收缩信号
- 成分股数量本身是叙事扩散度的量化指标
- 概念簇场景：用当前有效成分股做并集/交集，并记录每只股票属于几个子概念；`concept_count` 是龙头相关度的重要权重。

## Step 1.4: 研报搜索

```python
from common.report_search import search_reports, search_by_stock

# 1. 概念关键词搜索
concept_reports = search_reports("{概念名}", limit=50)

# 2. 概念龙头股搜索（先做初步量价排名确定 top 5 龙头候选）
for stock_code in top5_candidates:
    stock_reports = search_by_stock(stock_code, limit=20)

# 3. Zsxq 国际投行搜索（如有港股标的）
# 走 notebooklm.zsxq 增量搜索概念相关研报
```

**研报全量阅读铁律**：搜到多少篇读多少篇。每篇提取：核心逻辑/推荐标的/催化剂/风险。

## Step 1.5: 成分股财务+信号数据

```python
from common.stock_financials import check_table_coverage, get_financials_summary
from common.stock_signals import signal_summary

# 对 top 10 成分股（按近20日涨幅排名）做数据完整性检查
for ts_code in top10_members:
    coverage = check_table_coverage(ts_code)
    missing = [t for t, ok in coverage.items() if not ok]
    if missing:
        # 缺核心数据 → /collect-data 补数
        pass

    # 财务摘要（营收/净利/ROE/毛利率/增速）
    fin = get_financials_summary(ts_code)

    # 信号面全景（融资/北向/龙虎榜/大户/股东户数）
    sig = signal_summary(ts_code)
```

**缺数据时**：
```python
# 发现缺表 → 必须立即调 /collect-data 补齐
# 禁止跳过继续研究
```

## Step 1.6: 静默失败防护

```python
# 运行时断言：所有数据源必须有数据
assert len(concept_daily_df) > 0, f"concept_daily 为空: {concept_code}"
assert len(members) > 0, f"成分股为空: {concept_code}"
assert concept_daily_df['trade_date'].max() >= recent_threshold, \
    f"concept_daily 数据过期: 最新={concept_daily_df['trade_date'].max()}"

# 非空率检查
for ts_code in top10:
    non_null_rate = signal_data[ts_code].notna().mean()
    assert non_null_rate > 0.5, f"{ts_code} 信号面非空率仅 {non_null_rate:.1%}"
```
