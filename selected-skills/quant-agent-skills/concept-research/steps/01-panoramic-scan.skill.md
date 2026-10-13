---
name: concept-research-step-01-panoramic-scan
version: 1.0.0
description: |
  concept-research L1 全景扫描：全市场496概念量化预过滤 → 异动概念top 20 →
  LLM叙事分类+阶段判断 → 概念雷达输出。
  设计为周频运行（手动或launchd），自动发现正在形成的新叙事。
allowed-tools:
  - Bash
  - Read
  - Write
---

# L1 全景扫描：全市场概念雷达

## 目标

从496个概念中，用**纯量化预过滤**找到正在异动的前20个，再用LLM做**轻量叙事分类**，输出概念雷达图。

**成本控制**：不对每个概念跑深度分析。量化预过滤成本≈0（纯SQL+pandas），LLM只做top 20的叙事分类。

---

## Step 1: 全市场概念量化预过滤

```python
import sqlite3
import pandas as pd
import numpy as np
from common.constants import DB_PATH

conn = sqlite3.connect(DB_PATH)

# 1.1 拉全市场概念指数近60日数据
concept_daily = pd.read_sql_query("""
    SELECT ts_code, trade_date, close, vol, pct_change
    FROM concept_daily
    WHERE trade_date >= (
        SELECT trade_date FROM concept_daily
        ORDER BY trade_date DESC LIMIT 1 OFFSET 60
    )
    ORDER BY ts_code, trade_date
""", conn)

# 1.2 获取概念名称映射
concept_names = pd.read_sql_query("""
    SELECT DISTINCT concept_code, con_name
    FROM concept_member
    WHERE valid_to IS NULL
""", conn)

# 1.3 计算量价异动指标（每个概念）
results = []
for code, group in concept_daily.groupby('ts_code'):
    if len(group) < 20:
        continue
    
    group = group.sort_values('trade_date')
    
    # 收益率指标
    ret_5d = group['close'].iloc[-1] / group['close'].iloc[-6] - 1 if len(group) >= 6 else 0
    ret_20d = group['close'].iloc[-1] / group['close'].iloc[-21] - 1 if len(group) >= 21 else 0
    
    # 成交量异动（近5日均量 / 前20日均量）
    vol_recent = group['vol'].iloc[-5:].mean() if len(group) >= 5 else 0
    vol_base = group['vol'].iloc[-25:-5].mean() if len(group) >= 25 else 1
    vol_ratio = vol_recent / vol_base if vol_base > 0 else 1
    
    # 动量加速度（5日动量 vs 前5日动量）
    mom_accel = ret_5d - (group['close'].iloc[-6] / group['close'].iloc[-11] - 1) if len(group) >= 11 else 0
    
    # 波动率（20日）
    volatility = group['pct_change'].tail(20).std()
    
    # 涨停天数（近5日涨幅>9.5%的天数——概念指数用宽松阈值）
    limit_days = (group['pct_change'].tail(5) > 5).sum()  # 概念指数涨幅阈值用5%
    
    results.append({
        'ts_code': code,
        'ret_5d': ret_5d,
        'ret_20d': ret_20d,
        'vol_ratio': vol_ratio,
        'mom_accel': mom_accel,
        'volatility': volatility,
        'limit_days': limit_days,
    })

df_signals = pd.DataFrame(results)
```

## Step 2: 异动排名 + 筛选

```python
# 2.1 综合异动评分
# 三条件至少满足两条 = 异动
df_signals['ret_rank'] = df_signals['ret_5d'].rank(pct=True)
df_signals['vol_rank'] = df_signals['vol_ratio'].rank(pct=True)
df_signals['accel_rank'] = df_signals['mom_accel'].rank(pct=True)

# 异动条件
df_signals['is_ret_hot'] = df_signals['ret_rank'] > 0.90    # 涨幅前10%
df_signals['is_vol_hot'] = df_signals['vol_ratio'] > 2.0    # 量比>2
df_signals['is_accel_hot'] = df_signals['mom_accel'] > 0.02 # 动量加速

df_signals['hot_count'] = (
    df_signals['is_ret_hot'].astype(int) +
    df_signals['is_vol_hot'].astype(int) +
    df_signals['is_accel_hot'].astype(int)
)

# 2.2 筛选异动概念（至少2个维度hot）
hot_concepts = df_signals[df_signals['hot_count'] >= 2].nlargest(20, 'hot_count')

# 2.3 合并概念名称
hot_concepts = hot_concepts.merge(concept_names, left_on='ts_code', right_on='concept_code', how='left')
```

### Step 2.5: 雷达脚本回归检查（必做）

运行 `scripts/concept_radar.py` 前，先确认热度条件没有把百分位和绝对值混用：

- `ret` 热度可以用百分位：`r_ret > 0.90`
- `vol` 热度必须用绝对量比：`vol_ratio > 1.5` 或更高阈值
- `accel` 热度必须用绝对动量加速度：`accel > 0.01` 或更高阈值

**禁止写法**：

```python
(df["r_vol"] > 1.5)   # r_vol 是 0-1 百分位，永远不可能 >1.5
(df["r_acc"] > 0.01)  # r_acc 是百分位，几乎全市场都会通过
```

**验证命令**：

```bash
pytest -q tests/test_concept_radar.py
python -m py_compile scripts/concept_radar.py
```

如果测试不存在，先补最小回归测试：构造一个“涨幅不热但量比热+加速度热”的概念，必须能被 `rank_and_filter()` 选出。

## Step 3: LLM 叙事分类 + 阶段判断

**对 top 20 异动概念做轻量叙事分类**（不是深度分析！）

```
对每个异动概念，基于以下信息做叙事分类：
1. 概念名称 + 近期涨幅 + 量比 + 动量加速度
2. 成分股中涨幅最大的5只（用 concept_member + daily_price 查）
3. 近5天的相关新闻/公告（如有，走 report_search）

输出格式：
- 概念名: {名称} ({代码})
- 5日涨幅: {X%}, 量比: {X}x
- 叙事类型: [新叙事 / 旧叙事回潮 / 政策驱动 / 事件驱动 / 资金博弈]
- 阶段判断: [形成期 / 加速期 / 扩散期 / 退潮期]
- 判断依据: {一句话}
- 龙头候选: {涨幅top 3 股票}
- 值得关注: [是/否] + 理由
```

**LLM 判断阶段的关键信号**：

| 阶段 | 量价信号 | 成分股信号 | 叙事信号 |
|------|---------|-----------|---------|
| 形成期 | 微涨+温和放量 | 少数股异动 | 新催化剂出现 |
| 加速期 | 快速拉升+大幅放量 | 多股同步拉升 | 媒体开始报道 |
| 扩散期 | 高位震荡+天量 | 跟风股补涨 | 散户热议 |
| 退潮期 | 回落+缩量 | 龙头先跌 | 叙事疲劳 |

## Step 4: 概念雷达输出

```markdown
# 概念雷达 — {日期}

## 异动概念 TOP 20

| # | 概念 | 5日涨幅 | 量比 | 阶段 | 叙事类型 | 龙头 | 值得关注 |
|---|------|--------|------|------|---------|------|---------|
| 1 | {名} | +X% | Xx | 加速期 | 政策驱动 | {股1,股2} | ✅ 理由 |
| 2 | ... | ... | ... | ... | ... | ... | ... |

## 新叙事发现
{本周新出现的叙事，之前从未异动过的概念}

## 退潮预警
{上周在top 20但本周掉出的概念，可能进入退潮期}

## 建议进入 L2/L3 的概念
{最值得深入研究的概念 + 理由}
```

---

## 运行方式

```bash
# 手动运行
# 在 Claude Code 中: "帮我扫一下最近的热门概念"

# 定时运行（可选，launchd 每周日 18:00）
# 输出落盘: auto_research/knowledge/concept_research/_radar/{日期}_radar.md
```

---

## 注意事项

1. **不做投资建议**：L1 只是发现+分类，不给买卖建议
2. **数据新鲜度**：concept_daily 最新日期必须在 2 个交易日内，否则先补数
3. **成本控制**：LLM 调用限制在 20 个概念以内，不对全量 496 个概念跑 LLM
4. **历史对比**：如果上周有雷达，本周对比上周——新进入/退出/持续的概念标注变化
5. **概念簇提示**：如果 top 20 里多个概念属于同一叙事链，L1 输出必须标注“建议进入概念簇 L2”，不要把同一叙事拆成多个孤立 L2。
