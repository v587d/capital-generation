---
name: china-sector-overview
description: Comprehensive A-share sector and industry landscape reports — market size, competitive positioning, policy environment, key A-share players, trading multiples, and thematic trends. Adapted from the original sector-overview skill for Chinese market structure and terminology. Triggers on "A股行业分析", "行业研究", "板块分析", "sector overview China", "A-share sector deep dive", "白酒/半导体/新能源 行业分析", or "[industry] landscape China".
---

# china-sector-overview

> 本文件相对上游 `d7585ca` 快照做过合规改写（取数与凭据口径），逐条记在快照根目录的 UPSTREAM.md；方法论、阈值与输出模板未改。

## Purpose

Create comprehensive **A股行业/板块深度报告** covering market dynamics, competitive positioning, regulatory environment, key players, trading multiples, and thematic trends.

## Data Sources

A sector report needs a lot of numbers, and none of them is fetched from here. This plugin routes every retrieval through one entry — the main agent delegates it to the role that owns structured data or web and disclosure material — and holds no data-service key inside a report.

Hand the retrieval roles one brief per family of material:

- 板块成分股：the constituent list for the industry being covered, by its Chinese industry name
- 成分股行情与财务：最新价、市值、PE / PB、收入与利润率 for the top names, all on one shared as-of date
- 大盘基准：index history, 涨幅榜 / 成交额榜 for where the sector sits in the tape
- 行业新闻与政策：recent sector news and the policy documents that move it
- 口径材料：the statistics and filings the report quotes — 国家统计局 / 海关总署 output and trade figures, 行业协会 (中汽协, 硅业分会 etc.) sector counts, 巨潮 filings behind the competitive picture, 券商研报 for frameworks and forecast ranges

| 材料 | 用来支撑 |
|------|----------|
| 国家统计局 / 海关总署 | industry output, 进出口 |
| 行业协会 | sector-specific volumes and prices |
| 巨潮资讯 | company filings for competitive analysis |
| 券商研报 | analyst frameworks and forecast ranges — treat as one house's view, not as consensus |
| 东方财富行业板块 | industry classification and sector index constituents |

In a role-split host, delegate with those briefs rather than reaching for a feed from here. What does not come back is written up as a gap in that section; a sector size or growth rate is never rounded off from memory.

## China-Specific Considerations

### A-share Market Structure

| Feature | Description | Implication |
|---------|-------------|-------------|
| 涨跌停限制 | ±10% (main), ±20% (创业板/科创板) | Price discovery slower |
| 散户占比高 | Retail ~60-80% of turnover | More sentiment-driven |
| 政策驱动 | Government announcements move markets | Monitor policy closely |
| 板块轮动 | Sector rotation common | Timing important |
| 北向资金 | Foreign inflows tracked daily | Sentiment indicator |

### Industry Classification

**Common sector classifications:**
- 申万行业分类 (SW Industry) — most widely used
- 中信行业分类 (CITIC) — alternative
- 证监会行业分类 — regulatory standard
- 东方财富行业 — data vendor specific

**Ask for constituents by the Chinese industry name, and say in the brief which classification's buckets you mean (申万 / 中信 / 证监会 / 东方财富), since the same sector splits differently across them.**

### Sector-Specific Metrics

| Sector | Key Metrics |
|--------|-------------|
| 白酒 | 批价, 库存, 回款, 动销, 渠道库存 |
| 半导体 | 产能利用率, 出货量, ASP, 库存天数 |
| 新能源汽车 | 交付量, 单车收入, 电池成本, 渗透率 |
| 医药 | 创新药收入, 研发费用率, 集采中标 |
| 银行 | NIM, 不良率, 拨备覆盖率, ROE |
| 券商 | 经纪/投行/资管收入, 股基交易量, 两融余额 |
| 光伏 | 硅料/组件价格, 排产, 海外出货 |
| 房地产 | 销售额, 拿地, 融资成本, 去化周期 |
| 食品饮料 | 动销, 库存, 提价能力 |
| 互联网 | DAU/MAU, ARPU, 收入增速, 利润率 |

### Policy Risk Framework

**High policy-sensitivity sectors:**
1. 医药 — 集采 (volume-based procurement)
2. 互联网 — 反垄断, 数据安全
3. 教育 — 双减 (reduced private tutoring)
4. 金融 — 监管周期, 利率政策
5. 房地产 — 三道红线, 限购限贷
6. 新能源 — 补贴退坡, 产能过剩

**Policy risk assessment:**
- Current policy stance (支持/中性/限制)
- Upcoming regulatory events
- Historical policy impact patterns
- Best/worst case scenarios

## Quality Checks

Before delivering:
- [ ] Industry definition clear and consistent
- [ ] Market size data sourced (统计局 or industry association)
- [ ] Competitive landscape covers top 5-10 players
- [ ] Financials came back through the host's retrieval path, or the gap is named in that section
- [ ] Valuation multiples calculated consistently
- [ ] Policy environment analyzed
- [ ] Investment themes articulated
- [ ] Ideas shortlist included (3-5 names)
- [ ] Risk factors specific to China market included
> 取数档位（接哪家数据服务、用哪个密钥）由宿主的凭据域决定：这份行业报告不配置它，也不向使用者索取凭据。
> 分册 `references/10-workflow.md` 里 Step 8 的 Long / Short 一览与第七节的重点标的、目标价、评级，是把上面这些材料写成结论的**推演练习**：本插件没有券商接口，不据它下单，也不会替你执行任何一笔。

## Read the Parts

Everything below the surface of this file lives in `references/`. Open a part with `read`,
resolved against this skill's base directory; each part is sized to arrive complete in one
`read`. If a receipt shows `[... tool result middle pruned ...]`, re-read it with `offset`
before concluding anything is missing.

- `references/10-workflow.md` — Workflow

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.

