---
name: china-catalyst-calendar
description: Track upcoming catalysts for A-share coverage universe — earnings dates, regulatory announcements, sector conferences, product launches, and policy events relevant to Chinese equities. Adapted from the original catalyst-calendar skill for A-share market conventions. Triggers on "A股催化剂日历", "事件日历", "财报日历", "earnings calendar A-share", "upcoming catalysts China", or "what's coming up for [company]".
---

# china-catalyst-calendar

> 本文件相对上游 `d7585ca` 快照做过合规改写（取数与凭据口径），逐条记在快照根目录的 UPSTREAM.md；方法论、阈值与输出模板未改。

## Purpose

Build and maintain a **A股催化剂日历** tracking upcoming events that could materially impact stock prices within a coverage universe.

## Evidence request

A calendar is a list of dates and documents, and this plugin obtains none of them from inside this step: retrieval has exactly one entry — the main agent delegating it to the role that owns market data or web and disclosure material — and a calendar holds no data-service key and issues no query of its own.

Hand over one brief per family, each naming the ticker or the indicator, the field wanted, and the as-of date:

- 公司事件：分红、回购、股东大会、解禁、披露安排, plus the 公告 and 相关新闻 behind each entry
- 公司底色：profile, 股本结构, and the historical earnings pattern that tells you which quarter is material
- 交易状态：current quote and trading context for each name on the calendar
- 全市场：指数行情 as macro backdrop, and market-wide news flow
- 宏观发布：the indicator calendar in `references/10-catalyst-types.md` (CPI / PMI / 工业增加值 / 零售 / 就业) with its release dates

The disclosure venues these briefs eventually resolve to — 巨潮公告、上交所公告、深交所公告 — are the host retrieval role's business, not a browsing task for this step: name the document type you need and let the retrieval path decide where it lives. In a role-split host, delegate rather than searching from here, then keep calendar entries that came back and mark the rest as unconfirmed dates.

## China-Specific Considerations

### Earnings Calendar Patterns

| Season | Months | Key Notes |
|--------|--------|-----------|
| Q1 earnings | Late April | 年报 + Q1季报 叠加, 信息密集 |
| H1 earnings | Late August | 中报窗口, 分红预案公布 |
| Q3 earnings | Late October | 三季报, 全年预测调整 |
| Annual earnings | Jan-April | 年报密集发布, 分红方案 |

### Lock-up Expiry (限售股解禁)

- 首发限售股 (IPO lock-up): typically 12 months
- 定增限售股 (private placement): typically 6-18 months
- 股权激励限售股: varies by plan
- High lock-up expiry → potential selling pressure

**Risk assessment:**
- Large percentage of float unlocking (>5%) → high risk
- Concentrated holders (single entity) → higher impact
- Company in downtrend → higher probability of sale

### Regulatory Calendar

**Recurring policy events:**
- 中央经济工作会议 (Central Economic Work Conference): Dec
- 两会 (Two Sessions / NPC & CPPCC): Mar
- 政治局会议 (Politburo meeting): Monthly (economics discussed ~quarterly)
- 国新办发布会 (State Council Info Office presser): Ad-hoc
- 央行货币政策执行报告: Quarterly

### Dividend Calendar

- 股权登记日 (record date): critical for dividend capture
- 除权除息日 (ex-dividend date): price adjusts
- 分红实施公告: typically 2-4 weeks after AGM approval
- 高送转 (high bonus issue): historically market-positive event

## Quality Checks

Before delivering:
- [ ] Calendar covers 4-12 weeks ahead
- [ ] All critical catalysts flagged
- [ ] Dates verified against official sources
- [ ] Importance levels assigned consistently
- [ ] Watch items specific and actionable
- [ ] Pre-catalyst preparation tasks defined

## Read the Parts

Everything below the surface of this file lives in `references/`. Open a part with `read`,
resolved against this skill's base directory, and open it **whole — with no line window**:
reporting a rule or a template out of a slice of a part is how a file gets described as read
when it was only skimmed. Each part is sized to arrive complete in one `read`. If a receipt
shows `[... tool result middle pruned ...]`, re-read it with `offset` before concluding
anything is missing.

- `references/10-catalyst-types.md` — Catalyst Types (A-share Specific)
- `references/11-workflow-and-calendar.md` — Workflow; Calendar Format; Integration with Other Skills

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.

