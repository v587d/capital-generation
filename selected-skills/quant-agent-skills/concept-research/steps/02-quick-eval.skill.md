---
name: concept-research-step-02-quick-eval
version: 1.2.0
description: |
  concept-research L2 概念/概念簇快评：快速评估一个概念或同一叙事链概念簇值不值得深挖。
  Fresh Public Signal Sweep + 4分析维度(叙事/量价/成分股/资金面)必须过一遍, 权重AI自适应。
  30-60min 完成，不做 multi-agent 辩论。
allowed-tools:
  - Bash
  - Read
  - Write
---

# L2 概念/概念簇快评：快速评估

## 目标

30-60 分钟内判断一个概念值不值得进入 L3 深度研究。

**核心产出**：
- 概念阶段判断（形成/加速/扩散/退潮）
- 信心等级（高/中/低）
- 初步龙头识别（top 3-5）
- 是否进入 L3 的建议

## Step 0: 单概念还是概念簇

先判断研究对象是不是单一概念。满足任一条件时，按**概念簇**处理：

1. L1 Top20 中多个概念属于同一叙事链；
2. 新闻/研报催化跨材料、设备、客户、政策资金等多条子线；
3. 龙头候选反复出现在多个概念里；
4. 单一概念指数强，但成分股无法解释真实资金方向。

概念簇 L2 必须列出：

```text
覆盖概念:
- 885864.TI 光刻胶
- 886054.TI 光刻机
- 885897.TI 中芯国际概念
- 885893.TI 国家大基金持股
```

并用当前有效成分股做并集/交集：

```python
frames = []
for concept_code, concept_name in concepts.items():
    members = pd.read_sql_query("""
        SELECT con_code AS ts_code, con_name
        FROM concept_member
        WHERE concept_code = ? AND valid_to IS NULL
    """, conn, params=[concept_code])
    members["concept"] = concept_name
    frames.append(members)

member_union = pd.concat(frames, ignore_index=True)
member_agg = (
    member_union
    .groupby(["ts_code", "con_name"])
    .agg(
        concepts=("concept", lambda x: ",".join(sorted(set(x)))),
        concept_count=("concept", "nunique"),
    )
    .reset_index()
)
```

**注意**：概念簇不是把多个结论相加，而是回答“同一叙事现在资金买的是哪条载体链”。

---

## Step 0.5: 公开信息证据矩阵先读

L2 快评不能只从研报和概念指数开始。先读 Step 1.1c 生成的 `_public_signal_matrix_YYYYMMDD.{md,json}`，再判断叙事。

```text
□ 最近 7/30/90 天是否有 S0/S1 新事实？
□ 新事实是一阶利好、二阶替代，还是只改变预期差？
□ 公告/财报/客户认证/订单/政策披露是 `BEAT`、`IN_LINE`、`MISS` 还是 `AMBIGUOUS`？
□ 是否有官方/公司/客户/供应商/价格数据二次验证？
□ 是否已经被股价、概念指数、研报标题充分交易？
□ 没有验证的 S2/S3 信息是否被明确降级为 lead？
```

L2 输出必须加一段：

```markdown
## 公开信息快信号

| 结论 | 证据 |
|------|------|
| 最新催化剂 | {S0/S1事实；没有就写无可承重快信号} |
| 预期差 | {市场尚未充分反映/已反映/不可判断} |
| 预期差分类 | {BEAT/IN_LINE/MISS/AMBIGUOUS；IN_LINE=利好落地，不升级} |
| 降级线索 | {S2/S3 lead，不进主结论} |
| 下一次验证 | {公告/价格/客户认证/财报/进口数据日期} |
```

---

## 四维度快速扫描

### 维度1: 叙事逻辑（权重自适应）

```
□ 催化剂是什么？（政策/技术/事件/纯资金博弈）
□ 催化剂是一次性的还是持续的？
□ 这个概念之前炒过吗？（查历史 concept_daily 找之前的波峰）
□ 如果是旧叙事回潮，这次和上次有什么不同？
□ 叙事的"天花板"在哪？（TAM/渗透率/政策力度）
```

**数据来源**：
- `_public_signal_matrix_YYYYMMDD` — 最新公开事实、新闻、政策、供应链和价格快信号
- 研报搜索 `search_reports("{概念名}")` — 读核心逻辑和旧预期锚
- `concept_daily` 历史 — 查过去 2 年的炒作记录
- 概念簇场景：对每条子概念分别检索，再合并同一叙事的共同催化剂和分歧点

### 维度2: 量价形态

```python
import sqlite3
import pandas as pd
from common.constants import DB_PATH

conn = sqlite3.connect(DB_PATH)

# 概念指数近120日数据
df = pd.read_sql_query("""
    SELECT trade_date, close, vol, pct_change, turnover_rate
    FROM concept_daily
    WHERE ts_code = ?
    ORDER BY trade_date DESC
    LIMIT 120
""", conn, params=[concept_code])

# 关键量价指标
current_price = df['close'].iloc[0]
high_120d = df['close'].max()
low_120d = df['close'].min()
position = (current_price - low_120d) / (high_120d - low_120d)  # 0-1位置

vol_5d_avg = df['vol'].iloc[:5].mean()
vol_20d_avg = df['vol'].iloc[:20].mean()
vol_ratio = vol_5d_avg / vol_20d_avg  # >1.5 放量, <0.7 缩量

# 形态判断
if position > 0.8 and vol_ratio > 2:
    stage_signal = "加速期（高位放量）"
elif position > 0.6 and vol_ratio > 1.5:
    stage_signal = "扩散期（高位大量）"
elif position < 0.3 and vol_ratio > 1.5:
    stage_signal = "形成期（低位放量）"
elif position < 0.5 and vol_ratio < 0.8:
    stage_signal = "退潮期（回落缩量）"
else:
    stage_signal = "需进一步判断"
```

```
□ 概念指数在120日高低点什么位置？
□ 量价配合度？（涨放量/跌缩量=健康，涨缩量/跌放量=恶化）
□ 均线排列？（多头排列=趋势向上）
□ 与上次炒作高点比什么位置？（如果距上次高点-50%+，可能是退潮而非形成）
```

### 维度2.5: 日期口径对齐（必写入输出）

概念指数和个股截面必须分开确认：

```python
concept_daily_latest = conn.execute(
    "SELECT MAX(trade_date) FROM concept_daily WHERE ts_code = ?",
    (concept_code,),
).fetchone()[0]

stock_cross_section_date = pd.read_sql_query("""
    SELECT trade_date, COUNT(DISTINCT ts_code) AS n
    FROM daily_price
    GROUP BY trade_date
    HAVING n > 5000
    ORDER BY trade_date DESC
    LIMIT 1
""", conn).iloc[0]["trade_date"]
```

输出中必须写：

```text
概念指数: concept_daily 最新 YYYYMMDD
成分股/财务/资金: 完整个股截面使用 YYYYMMDD
```

如果两个日期不同，只能说“概念指数当日异动 + 最近完整个股截面扩散度”，不能把个股截面误写成当日全市场表现。

### 维度3: 成分股初筛

```python
# 获取当前成分股
members = pd.read_sql_query("""
    SELECT con_code, con_name
    FROM concept_member
    WHERE concept_code = ? AND valid_to IS NULL
""", conn, params=[concept_code])

# 成分股近20日涨幅排名
# （用 daily_price 计算，找出概念内的领涨股和滞涨股）
# 领涨股 = 龙头候选
# 滞涨股 = 可能是假龙或尚未启动
```

```
□ 成分股涨幅分布：均匀上涨（概念扩散）vs 少数股领涨（龙头集中）？
□ 领涨股是谁？有基本面支撑吗？
□ 最大市值股 vs 最大涨幅股是否一致？（不一致 = 真龙可能不是权重股）
□ 有没有非成分股但明显属于这个概念的标的？（同花顺成分股不全）
```

**概念簇扩散度指标**：

```python
cluster_breadth = {
    "union_count": len(member_agg),
    "priced_count": valid["ret5"].notna().sum(),
    "positive_5d_ratio": (valid["ret5"] > 0).mean(),
    "gt5_5d_ratio": (valid["ret5"] > 0.05).mean(),
    "median_ret5": valid["ret5"].median(),
    "median_ret20": valid["ret20"].median(),
}
```

判断规则：
- 并集 5日上涨比例 >60% 且 20日中位数转正：扩散健康；
- 上涨比例约50%但中位数接近0或为负：少数龙头集中，不能追扩散；
- 龙头 5日暴涨但资金流转负/估值极端：证明叙事强，不证明入场好。

### 维度4: 资金面

```python
from common.stock_signals import signal_summary

# 对 top 5 龙头候选做资金面快扫
for code in top5_leaders:
    sig = signal_summary(code)
    # 关注: 融资余额变化/北向增减持/龙虎榜/大户动向
```

```
□ 龙头股的融资余额在增加还是减少？（融资增加 = 杠杆资金进场）
□ 北向资金动向？（北向加仓 = 外资认可，北向减仓 = 警惕）
□ 最近有没有龙虎榜？（机构买入 = 聪明钱进场，营业部买入 = 游资炒作）
□ 股东户数变化？（户数减少 = 筹码集中 = 正面，户数暴增 = 散户接盘）
```

---

## L2 快评输出模板

```markdown
# 概念快评: {概念名} ({概念代码})

## 结论: {值得跟进 / 观望 / 不建议介入}
**信心等级**: {高/中/低}
**事件预期差**: {BEAT/IN_LINE/MISS/AMBIGUOUS；若无公告事件写不适用}

## 叙事阶段: {形成期/加速期/扩散期/退潮期}
**阶段判断依据**: {量价+叙事+资金面 三维交叉}

## 核心逻辑
{2-3句话概括这个概念的投资逻辑}

## 龙头候选
| 股票 | 代码 | 20日涨幅 | 基本面 | 资金面 | 龙头评分 |
|------|------|---------|--------|--------|---------|
| {股1} | {码1} | +X% | {有/无}业绩支撑 | {加仓/减仓} | ★★★★ |
| ... | ... | ... | ... | ... | ... |

### 概念簇专用补充

| 指标 | 结果 |
|------|------|
| 覆盖概念 | {concept_code/name 列表} |
| 成分股并集 | {N} 只 |
| 5日上涨比例 | {X%} |
| 5日>5%比例 | {X%} |
| 5日中位数 | {+X%} |
| 20日中位数 | {+X%} |
| 结论 | {全面扩散 / 龙头集中 / 退潮切换} |

## 风险点
1. {风险1}
2. {风险2}

## 建议
- {进入L3深度研究 / 加入关注列表定期跟踪 / 不建议介入}
- {如果进入L3，重点关注哪些方面}
```

---

## L2 → L3 的升级条件

满足以下**任一条件**建议进入 L3：

1. **叙事强+阶段早**: 催化剂明确且未被充分定价；披露后必须是 `BEAT` 才能作为升级理由 + 处于形成期/加速期初期
2. **龙头真**: top 3 龙头中至少 1 只有业绩支撑（earnings_quality = secular_growth）
3. **资金面正面**: 龙头股融资增加 + 北向加仓 + 机构龙虎榜买入
4. **用户持仓相关**: 用户持仓中有股票属于这个概念（组合共振）

**不进入 L3 的条件**：
1. 退潮期信号明确（回落+缩量+龙头派发）
2. 纯资金博弈无基本面（所有龙头 earnings_quality = one_off 或亏损）
3. 概念已过度炒作（距120日高点-5%以内，但所有龙头都已涨100%+）
4. 公告/催化只符合预期（`IN_LINE`）或无法判断（`AMBIGUOUS`），没有新的收益路径增量

---

## L2 → L3 升级操作（文件管理）

当 L2 快评结论为"进入 L3"时：

1. **L2 快评文件不删除**，保留在概念目录下作为历史记录（命名 `快评_{日期}.md`）
2. L3 五文件输出到**同目录**（`auto_research/knowledge/concept_research/{概念名}-{代码}/`）
3. L3 README.md 的"研究等级"字段标注 `L3（从L2升级）`，并在末尾添加一行：`> L2快评: [快评_{日期}.md](快评_{日期}.md)（升级前初步评估）`
4. L3 五文件的分析必须**独立于 L2 快评**——不因 L2 有结论就跳步，4个 Agent 必须从零跑完
5. **L2 快评的龙头候选列表**作为 L3 stock-picker-agent 的输入参考（不是结论参考）

**为什么保留 L2 文件**：L2 是"初步判断"，L3 是"深度验证"。保留 L2 可以在事后复盘"L2 的判断有多少被 L3 推翻"，这是 skill 自我进化的数据源。
