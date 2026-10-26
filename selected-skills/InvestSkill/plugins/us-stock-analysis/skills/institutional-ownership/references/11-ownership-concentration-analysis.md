# Analysis Framework(continued)

Part 2 of 4 for `institutional-ownership` — Analysis Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### 5. Ownership Concentration Analysis

Assess how concentrated institutional ownership is:

**Concentration Metrics**
- **Top 3 holders**: [%] of shares outstanding
- **Top 10 holders**: [%] of shares outstanding
- **Top 25 holders**: [%] of shares outstanding
- **HHI (Herfindahl-Hirschman Index)**: [Score] (concentration measure)

**Interpretation**
- **High concentration** (Top 10 > 50%):
  - Pro: Strong conviction from major holders
  - Con: Volatile if large holder exits
  - Common in: Small-caps, founder-led companies

- **Medium concentration** (Top 10 = 30-50%):
  - Balanced ownership structure
  - Most large-cap companies

- **Low concentration** (Top 10 < 30%):
  - Widely distributed ownership
  - More stable, less influenced by single holder
  - Common in: Mega-caps, index heavyweights

**Turnover Analysis**
- Holder retention rate: [%] of holders from 1 year ago still holding
- New entrants (last 12 months): [N] institutions
- Complete exits (last 12 months): [N] institutions
- Net holder change: [+/-N]

**Stability Assessment**
- High retention + new entrants = Strengthening conviction (Bullish)
- High retention + no new entrants = Stable (Neutral)
- Low retention + exits = Weakening conviction (Bearish)

### 6. Activist & Strategic Holders

Identify and analyze activist investors or strategic stakeholders:

**Activist Investors (>5% ownership or known activist activity)**

For each activist position:
- **Investor Name & Fund**
- **Ownership %**: Current stake
- **Entry Date & Price**: When position was initiated
- **Current Value**: Mark-to-market
- **Activist Thesis**: What changes they're pushing for
- **Progress**: Status of their initiatives
- **Track Record**: Success rate in similar situations

**Types of Activist Campaigns**
1. **Operational Improvements**: Cost cuts, margin expansion, divestitures
2. **Capital Allocation**: Increased buybacks, dividends, M&A
3. **Strategic Alternatives**: Sale of company, merger, spin-offs
4. **Board Changes**: New directors, CEO replacement
5. **Governance**: ESG initiatives, compensation reforms

**Impact Assessment**
- Historical success rate of this activist at peer companies
- Management's receptiveness to proposals
- Other shareholders' support
- Potential value unlock if successful
- Timeline to value realization

### 7. Portfolio Weight Analysis

Analyze how important the position is to each holder:

**High-Conviction Holders** (Position is >5% of their portfolio)
| Institution | Shares | Value ($M) | % of Their Portfolio | Rank in Portfolio | Recent Action |
|-------------|--------|------------|---------------------|-------------------|---------------|
| Akre Capital | 4.2M | $630 | 8.5% | #2 holding | Increased |
| ... | ... | ... | ... | ... | ... |

**Interpretation**
- **High portfolio weight**: Strong conviction, more research depth
- **Top 10 holding**: Likely actively managed and monitored
- **Increases to high-conviction holding**: Very bullish signal
- **Decreases from high-conviction**: Concerning if thesis change

**Position Sizing Trends**
- How many institutions have it as top 10 holding: [N]
- How many increased portfolio weight: [N] (bullish)
- How many decreased portfolio weight: [N] (bearish)
- Average portfolio weight: [%]

### 8. Stock Price Performance Correlation

Analyze relationship between ownership changes and stock performance:

**Performance During Institutional Activity**
```
Period: [Qn YYYY]
Institutional Change: [±%] ownership (net buying / selling)
Stock Price Change: [±%]
S&P 500 Change: [±%]
Outperformance: [±%]
```

**Historical Pattern Analysis**
- Correlation between institutional buying and subsequent returns
- Lead/lag relationship (do institutions front-run or follow?)
- Performance after smart money buys vs. sells

**Predictive Value**
- **High predictive value scenarios**:
  - Multiple smart money managers buying
  - Activist initiating position
  - Institutions buying during weakness
  - First-time institutional coverage

- **Low predictive value scenarios**:
  - Index rebalancing flows
  - ETF creation/redemption
  - Tax-loss selling end-of-year
  - Merger arbitrage activity

### 9. Data Sources & Filing Requirements

Reference the following sources for institutional ownership data:

**Primary Source - SEC 13F Filings**
- **What**: Quarterly holdings reports required of institutional investment managers exercising investment discretion over **≥ $100 million in Section 13(f) securities** (the test is 13(f) securities under management, not the firm's total AUM)
- **Who**: Institutional investment managers
- **When**: Filed within 45 days of quarter-end
- **Where**: the manager's own filing, as returned by the host retrieval channel

**13F Filing Calendar**
- Q1 (Mar 31) → Filed by May 15
- Q2 (Jun 30) → Filed by Aug 14
- Q3 (Sep 30) → Filed by Nov 14
- Q4 (Dec 31) → Filed by Feb 14

**Important Limitations**
- 45-day lag (data is stale)
- Only long positions reported (shorts not disclosed)
- Options and ADRs may not be reported
- Some holdings can be confidentially withheld
- $200K or 10,000 share threshold per position

**Schedule 13D/G Filings** (>5% ownership)
- **13D**: Activist investors with intent to influence
  - Initial filing within **5 business days** of crossing 5% (SEC rule effective 2024-02-05; previously 10 calendar days)
  - Amendments for material changes (≥ 1%) within **2 business days**
  - Includes plans and intentions

- **13G**: Passive investors, no control intent
  - Deadlines depend on filer type (revised schedule in force since 2024-09-30): qualified institutional investors — 45 days after the quarter-end in which they cross 5%, or 5 business days after month-end once above 10%; passive investors — 5 business days after crossing 5%; exempt investors — 45 days after quarter-end
  - Check the deadline in force on the filing date before dating a filing as late; deadlines have changed twice since 2024
  - Simplified reporting for passive positions

**What to request, and what it can support**

Ask by manager and by issuer: the 13F-HR information table for a given quarter-end, the 13D/G filing with its amendment history, and the issuer's own share count for the same date. An aggregated "institutional ownership %" is a secondary figure — it mixes managers, quarter-ends and filing lags — so label it as such and never let it stand in for a manager-level position.


This section is not finished here: `Analysis Framework` continues in `references/12-red-flags-warning-signs.md`.
