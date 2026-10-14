---
name: china-idea-generation
description: Systematic stock screening and investment idea sourcing for A-share markets. Combines quantitative screens, thematic research, and pattern recognition to surface new long and short ideas. Adapted from the original idea-generation skill for Chinese market conventions and data sources. Triggers on "A股选股", "股票筛选", "寻找机会", "stock screen China", "A-share ideas", "find ideas for Chinese stocks", or "screen for A-share opportunities".
---

# china-idea-generation

> 本文件相对上游 `d7585ca` 快照做过合规改写（取数与凭据口径），逐条记在快照根目录的 UPSTREAM.md；方法论、阈值与输出模板未改。

## Purpose

Systematically surface new **A股投资机会** through quantitative screens, thematic analysis, and pattern recognition.

## Data Sources

A screen is a set of conditions applied to numbers somebody else handed back, and this step retrieves none of them: the plugin has one retrieval entry — the main agent delegating to the role that owns structured data or web and disclosure material — and it holds no data-service key and runs no query from here.

发 brief 时按族写清标的或筛选条件、要的字段与 as-of 日期：

- 全市场快照：涨跌幅榜、成交额榜与异动名单
- 候选池的行情与估值：价格、PE / PB、市值，以及一段价格序列（动量与形态要用同一段区间）
- 财务口径：利润表与资产负债表的关键科目（筛选阈值那一节按这些数下判断）
- 分类与同业：行业分类口径下的成分股清单，以及同一批字段（一次 brief，别逐个问）

### Secondary Screening Data

| Data | 披露/发布方 | Use |
|------|-------------|-----|
| 龙虎榜 (Dragon-Tiger list) | 交易所每日榜单 | Unusual activity, institutional interest |
| 北向资金 (Northbound flows) | 沪深港通 | Foreign investor sentiment |
| 融资融券 (Margin trading) | 交易所 | Leverage and sentiment |
| 股东人数变化 | 定期报告与公告 | Institutional accumulation/distribution |
| 机构持仓 | 季报 / F10 | Fund ownership trends |
| 大宗交易 (Block trades) | 交易所 | Smart money signals |

这几档同样按"要哪个字段"写进 brief，由检索侧决定去哪儿取；哪一档没回来就在筛选记录里写明它缺席，
不许凭印象把它算进或排除。北向那一档按宿主返回的口径转述——实时买卖明细已停止披露，别写成"净买入"。

## China-Specific Screening Considerations

### Market Structure

| Feature | Screening Implication |
|---------|----------------------|
| 涨跌停限制 | Momentum may be interrupted |
| 散户占比高 | Sentiment-driven overreactions common |
| 政策敏感 | Regulatory risk premium in certain sectors |
| 北向资金 | Track foreign flows for large-caps |
| 龙虎榜 | Unusual activity signals |
| 停牌 (Trading halt) | Due diligence risk for suspended names |

### Common A-share Investment Styles

| Style | Description | Key Metrics |
|-------|-------------|-------------|
| 价值投资 | Deep value, dividend, asset-based | PB, dividend yield, 破净 |
| 成长投资 | High growth, innovation | Revenue growth, R&D intensity |
| 主题投资 | Policy/trend themes | Catalyst proximity, theme purity |
| 技术分析 | Chart-based trading | 均线, MACD, 量价 |
| 量化策略 | Systematic, factor-based | Multi-factor models |
| 打新 | IPO subscription | 中签率, 涨幅预期 |

### Sector-Specific Screening

| Sector | Screening Focus |
|--------|----------------|
| 白酒 | 批价趋势, 渠道库存, 回款, 品牌力 |
| 半导体 | 产能利用率, 国产替代进度, 技术迭代 |
| 新能源 | 产能过剩/出清, 技术路线, 补贴退坡影响 |
| 医药 | 创新药管线, 集采中标, 国际化 |
| 银行 | NIM趋势, 不良率, 拨备, 估值 (破净) |
| 房地产 | 销售额, 融资能力, 土储质量 |
| 消费 | 动销, 库存, 消费升级/降级趋势 |

## Quality Checks

Before delivering ideas list:
- [ ] Screen criteria documented and reproducible
- [ ] Each candidate has fundamental backing
- [ ] Catalysts identified for each idea
- [ ] Risk factors clearly stated
- [ ] Conviction levels assigned
- [ ] Liquidity verified (tradable)
- [ ] Regulatory/compliance review passed

> 取数档位（接哪家数据服务、用哪个密钥）由宿主的凭据域决定：这份选股清单不配置它，也不向使用者索取凭据。

## Read the Parts

Everything below the surface of this file lives in `references/`. Open a part with `read`,
resolved against this skill's base directory; each part is sized to arrive complete in one
`read`. If a receipt shows `[... tool result middle pruned ...]`, re-read it with `offset`
before concluding anything is missing.

- `references/10-workflow.md` — Workflow

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.

