> 本文件相对上游 `d7585ca` 快照做过合规改写（取数与凭据口径），逐条记在快照根目录的 UPSTREAM.md；方法论、阈值与输出模板未改。

# Workflow, Calendar Format, Integration

Part 2 of 2 for `china-catalyst-calendar` — building and maintaining the calendar, the output views, and how it pairs with other skills
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Workflow

### Step 1: Define Coverage Universe

Identify the stocks and sectors to track. Typical A-share coverage universe:
- 50-200 names
- Organized by sector/industry
- Priority tiers (P1 = must-track, P2 = watchlist)

### Step 2: Build Calendar Entries

**For each catalyst, record:**

```json
{
  "date": "2024-04-25",
  "type": "earnings",
  "subtype": "季报",
  "ticker": "{{TICKER}}",
  "company": "{{COMPANY_NAME}}",
  "importance": "high",
  "notes": "Q1 2024 results; watch 批价 and inventory",
  "status": "confirmed"
}
```

**Catalyst types in JSON:**
- `earnings` — quarterly/semi/annual reports
- `earnings_call` — 业绩说明会
- `regulatory` — 监管政策发布
- `policy` — 宏观政策 (央行, 国务院)
- `corporate` — 公司事件 (分红, 解禁, M&A)
- `macro_data` — 经济数据发布
- `sector_event` — 行业展会/论坛
- `lockup_expiry` — 限售股解禁

### Step 3: Prioritize Catalysts

**Importance levels:**
- **Critical**: Likely to move stock >10% (earnings, M&A, major policy)
- **High**: Likely to move stock 5-10% (regulatory decisions, industry data)
- **Medium**: Watch item, context-setting (dividend, conference participation)
- **Low**: Background noise (routine filings, minor announcements)

### Step 4: Pre-Catalyst Preparation

**1 week before critical catalysts:**
- Pull latest data and consensus
- Prepare scenario analysis
- Draft preliminary positioning note
- Alert stakeholders if high-impact

**1 day before critical catalysts:**
- Final data check
- Confirm release timing (morning vs afternoon)
- Prepare pre-market positioning note
- Set monitoring alerts

### Step 5: Post-Catalyst Update

After catalyst passes:
- Record actual outcome
- Compare vs scenario framework
- Update price target / thesis if material
- Move to "completed" section
- Flag next catalyst in queue

## Calendar Format

### Weekly View

```
【本周催化剂日历】[YYYY-MM-DD 至 YYYY-MM-DD]

周一 [Date]
  - [Time] [Ticker] [Company] — [Event type] — [Importance]
  - [Time] [Macro event] — [Impact assessment]

周二 [Date]
  ...

本周重点：
- [Top 2-3 catalysts to watch]
- [Market-wide risk events]
```

### Monthly View

```
【X月重要事件日历】

财报窗口:
- [Week 1]: [Sector] Q[X] results: [List of companies]
- [Week 2]: [Sector] Q[X] results: [List of companies]

政策窗口:
- [Date]: [Policy event] — [Expected impact]

解禁窗口:
- [Date]: [Ticker] — [Amount] shares unlocking — [Risk assessment]

宏观数据:
- [Date]: [Indicator] — [Consensus] — [Previous]
```

### Upcoming Catalysts Table

| Date | Company | Event | Importance | Watch Item |
|------|---------|-------|------------|------------|
| {{DATE}} | {{COMPANY_NAME}} ({{TICKER}}) | {{EVENT_TYPE}} | {{IMPORTANCE}} | {{WATCH_ITEMS}} |
| Example | 贵州茅台 (600519) | Q1 年报 | Critical | 批价, 动销 |
| 04-30 | 工信部 | 新能源车月度数据 | Medium | 销量, 渗透率 |

## Integration with Other Skills

| Related Skill | Integration Point |
|---------------|-------------------|
| china-earnings-analysis | Post-earnings catalyst review |
| china-earnings-preview | Pre-earnings scenario setup |
| china-thesis-tracker | Catalyst milestone tracking |
| china-morning-note | Daily catalyst briefing |
| china-market-researcher | Sector catalyst themes |

A skill named above is an option for the user, not a step this role can take: only the skills the user switched on exist in this session, and what this plugin deliberately does not offer — placing or amending an order on the user's behalf — is not reachable at all. Say what you would check next and let the user decide.
