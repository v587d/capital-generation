---
name: china-morning-note
description: Daily morning research note for A-share markets. Summarizes overnight developments, pre-market sentiment, trade ideas, and key events for the trading day. Adapted from the original morning-note skill for Chinese market conventions. Triggers on "早报", "晨会纪要", "今日策略", "morning note", "morning meeting", or "daily A-share preview".
---

# china-morning-note

> 本文件相对上游 `d7585ca` 快照做过合规改写（取数与凭据口径），逐条记在快照根目录的 UPSTREAM.md；方法论、阈值与输出模板未改。

## Purpose

Draft concise **A股晨会纪要/每日策略**, summarizing overnight developments and pre-market sentiment for the Chinese equity market. Designed for the typical Chinese sell-side 晨会 format (typically 7:00-8:30 AM before market open).

## Data Sources

A morning note is assembled before the open from material this step does not fetch: the plugin has one retrieval entry — the main agent delegating it to the role that owns market data or web and disclosure material — and this note holds no data-service key and issues no query of its own.

按族发 brief，每条写明标的或指标、要的字段与 as-of 日期：

- 指数与全市场：四大指数（上证 / 深证成 / 创业板 / 科创50）上一交易日收盘、涨跌家数、成交额；全市场新闻流
- 隔夜与外盘：美股三大指数、恒生、原油 / 铜 / 黄金、USD/CNY
- 资金与情绪：北向与南向的成交口径、两融余额、龙虎榜异动名单
- 公司要闻与披露：前一晚与今晨的公告（业绩预告、增减持、重大合同、回购）、已有研报条目
- 事件日历：今日披露、解禁、股东大会、业绩说明会、宏观数据发布

| 材料 | 由谁取 | 注意 |
|------|--------|------|
| 行情、指数、资金口径 | 宿主结构化取数，回传为数据集引用 | 全套统一 as-of；晨会的写法是"前一交易日收盘 + 今晨可用信息" |
| 公告、政策原文、监管通报 | 宿主的披露与网页检索（正文过长时由其解析成可读文本） | 引用落到具体文件与时点 |
| 宏观指标 | 把发布方与频率列进检索 brief（见下表） | 取不到就写成缺口，不折算成记忆里的数 |

披露场所与资讯站点由检索侧决定去哪儿取：这份纪要只写"要哪一类文件"，不把某个站点或某家服务商的工具当取数指令。
没回来的那一档在正文里写成"未取到"，不要让前一天早上的数字冒充今天的。

### Macro context (which indicators matter, and their release cadence)

| Data | 发布方 | Frequency |
|------|--------|-----------|
| PMI (制造业/非制造业) | 国家统计局 | Monthly |
| CPI / PPI | 国家统计局 | Monthly |
| Social financing / M2 | 央行 | Monthly |
| FX rate (USD/CNY) | 中国外汇交易中心 | Daily |
| Bond yields (10Y CGB) | 中国债券信息网 | Daily |
| 北向 / 南向资金 | 沪深港通 | Daily |

北向那一档按宿主返回的口径转述：实时买卖明细已停止披露，不要把取到的成交额写成"净买入"。

## Workflow

### Step 1: Overnight Developments

**Macro / Policy:**
- 央行 (PBoC) announcements — MLF/LPR rates, RRR cuts, open market operations
- 国务院 / 部委政策 — industry regulations, 产业政策
- 美联储 (Fed) developments — impact on A-share opening
- 外围市场 (overnight markets) — US equities, commodities, FX

**Company news:**
- Earnings releases from prior evening / overnight
- 业绩预告 (earnings preview notices)
- 增减持 (shareholder buy/sell announcements)
- 重大合同 (major contract wins)
- 回购 (share buybacks)

**Format:**
```
【宏观/政策】
- [News item with brief implication]
- [News item with brief implication]

【公司要闻】
- [Company]: [Event] — [Implication]
- [Company]: [Event] — [Implication]
```

### Step 2: Market Preview

**Previous session recap:**
- 上证指数: close, change, volume
- 深证成指: close, change
- 创业板指: close, change, 涨跌家数
- Sector performance: top 3 up/down sectors
- 北向资金: net buy/sell amount, direction

**Overnight markets:**
- 美股三大指数 (Dow, Nasdaq, 中证500) — impact on A-share opening
- Hang Seng Index (港股)
- Commodities: 原油, 铜, 黄金
- USD/CNY: exchange rate movement

### Step 3: Trade Ideas

**2-4 actionable ideas for the day:**

For each idea:
- **方向**: Long / Short / Watch
- **标的**: Company name + ticker
- **逻辑**: Brief thesis (1-2 sentences)
- **催化剂**: Key event to watch
- **风险**: Main risk factor

**Example format:**
```
【今日策略】
1. [方向] [标的]（[代码]）
   逻辑：[简要投资逻辑]
   催化剂：[近期催化剂]
   风险：[主要风险]

2. ...
```

### Step 4: Key Events Calendar

**Today's events:**
- Earnings releases (A-share companies reporting)
- Economic data releases (CPI, PMI, etc.)
- Policy events (PBoC MLF operations, 国新办发布会)
- Earnings calls (业绩说明会)
- Sector conferences / 策略会

### Step 5: Sector / Thematic Focus

**Sector of the day:**
- What's moving?
- Key drivers (policy, data, sentiment)
- Names to watch within sector

### Step 6: Draft the Note

**Standard A-share morning note format:**

```
【XX证券】A股晨会纪要 [YYYY-MM-DD]

一、市场回顾
   [Yesterday's close, sector performance, 北向资金]

二、隔夜外盘与大宗
   [Overnight US/Asia markets, commodities, FX]

三、重要资讯
   【宏观政策】...
   【公司要闻】...
   【行业动态】...

四、今日策略
   [Trade ideas with rationale]

五、重点事件日历
   [Today's scheduled events]

六、风险提示
   [Market-wide risks]
```

### Step 7: Delivery

**Tone guidelines:**
- Concise and actionable
- Opinionated but evidence-based
- Flag high-conviction ideas vs. lower-conviction
- Include risk management notes (止损位, 仓位建议)

【今日策略】里的方向（Long / Short / Watch）、止损位与仓位写法，是把上面这些材料写成一个结论的**推演练习**：
本插件没有券商接口，不据它下单，也不会替你执行任何一笔。

**Typical length:**
- 300-600 words for daily note
- 800-1,500 words for weekly strategy piece

## China-Specific Morning Context

### Market Mechanics

| Item | A-share Convention |
|------|-------------------|
| Pre-market | No formal pre-market; some dark pools |
| Opening | 9:30 AM (集合竞价 9:15-9:25) |
| Closing | 3:00 PM (集合竞价 14:57-15:00) |
| Lunch break | 11:30 AM - 1:00 PM |
| Trading limits | ±10% (main), ±20% (创业板/科创板), ±30% (ST) |

### Common A-share Themes

- **政策市** (policy-driven market) — government announcements move markets
- **存量博弈** (capital rotation) — limited new money, sector rotation
- **北向资金** (Northbound flows) — tracked as sentiment indicator
- **两融余额** (margin balances) — leverage indicator
- **龙虎榜** (Dragon-Tiger list) — unusual activity names
- **涨跌停** — limit-up/limit-down stocks (market momentum)

### Common Catalysts in A-share

- 央行公开市场操作 (PBoC open market operations)
- LPR报价 (Loan Prime Rate announcements)
- PMI数据 (monthly PMI releases)
- 季报/年报窗口 (earnings season: Apr, Aug, Oct)
- 重要会议 (重要会议: 政治局会议, 中央经济工作会议)
- 行业监管政策 (sector regulation: 集采, 反垄断, etc.)
- 外资流入 (foreign inflow via 沪深港通)

## Quality Checks

Before delivering:
- [ ] Market data current and accurate
- [ ] Overnight developments captured
- [ ] Trade ideas actionable and time-relevant
- [ ] Event calendar complete
- [ ] Risk factors included
- [ ] Tone appropriate for morning meeting format

> 取数档位（接哪家数据服务、用哪个密钥）由宿主的凭据域决定：这份晨会纪要不配置它，也不向使用者索取凭据。
