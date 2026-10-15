# Analysis Framework

Part 1 of 4 for `institutional-ownership` — Analysis Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Analysis Framework

### 1. Institutional Ownership Overview

Provide current snapshot of institutional holdings:

**Aggregate Statistics**
- Total institutional ownership: [%] of shares outstanding
- Number of institutional holders: [N]
- Total shares held by institutions: [Number] shares
- Total value held: $[Amount]
- Float ownership by institutions: [%] (excl. insider holdings)

**Ownership Trend (4 Quarters)**
```
Quarter        Institutional %    # of Holders    Change from Prior
[Qn YYYY]          [%]                [N]              [±%]
[Qn-1 YYYY]        [%]                [N]              [±%]
[Qn-2 YYYY]        [%]                [N]              [±%]
[Qn-3 YYYY]        [%]                [N]              [±%]
```

**Trend Interpretation**
- **Increasing ownership**: Growing institutional interest = Bullish
- **Stable ownership**: Maintained confidence = Neutral to Bullish
- **Decreasing ownership**: Distribution or loss of confidence = Bearish

### 2. Top Institutional Holders

Identify and analyze largest institutional positions:

**Top 10 Holders Table**

| Rank | Institution | Type | Shares Held | Value ($M) | % of Portfolio | % of Company | Change (QoQ) |
|------|-------------|------|-------------|------------|----------------|--------------|--------------|
| 1 | Vanguard Group | Index | 45.2M | $6,780 | 0.8% | 8.5% | +2.1% |
| 2 | BlackRock | Index | 38.1M | $5,715 | 0.6% | 7.2% | +1.5% |
| 3 | State Street | Index | 22.3M | $3,345 | 1.2% | 4.2% | -0.3% |
| 4 | Fidelity | Active | 18.7M | $2,805 | 2.1% | 3.5% | +15.2% |
| 5 | ... | ... | ... | ... | ... | ... | ... |

**Holder Categories**
- **Index Funds** (Vanguard, BlackRock, State Street): Follow index weights, less signal
- **Active Managers** (Fidelity, T. Rowe Price, Wellington): Stock selection, more signal
- **Hedge Funds** (Bridgewater, Citadel, Renaissance): Tactical, high signal value
- **Pension Funds** (CalPERS, CalSTRS): Long-term, moderate signal
- **Sovereign Wealth Funds**: Very long-term, strategic positions

### 3. Quarter-over-Quarter Position Changes

Analyze recent changes in institutional holdings:

**New Positions (Initiated)**
- Institutions that added stock for first time in recent quarter
- Particularly meaningful if from notable investors
- Indicates new conviction or thesis development

| Institution | Shares | Value ($M) | % of Their Portfolio | Significance |
|-------------|--------|------------|---------------------|--------------|
| ARK Invest | 2.5M | $375 | 3.2% | High (active, thematic) |
| ... | ... | ... | ... | ... |

**Increased Positions (>25% increase)**
- Institutions that significantly added to existing position
- Shows growing conviction
- More meaningful if they're "adding to winners"

| Institution | Previous Shares | New Shares | Change | New Value | Notes |
|-------------|----------------|------------|--------|-----------|-------|
| ValueAct Capital | 5.0M | 8.2M | +64% | $1,230M | Activist, 4th increase |
| ... | ... | ... | ... | ... | ... |

**Decreased Positions (>25% decrease)**
- Institutions that significantly reduced holdings
- May indicate profit-taking, thesis change, or risk management
- Consider whether selling from highs or lows

| Institution | Previous Shares | New Shares | Change | Current Value | Reason |
|-------------|----------------|------------|--------|---------------|--------|
| Tiger Global | 12.0M | 4.5M | -62% | $675M | Reducing tech exposure |
| ... | ... | ... | ... | ... | ... |

**Eliminated Positions (Sold Completely)**
- Complete exits by institutional holders
- Most bearish signal, especially if from concentrated holders
- Check if stock was top holding previously

| Institution | Previous Shares | Value Sold ($M) | Exit Price | Context |
|-------------|----------------|-----------------|------------|---------|
| Scion Asset Mgmt | 3.2M | $480 | $150 | Burry exited |
| ... | ... | ... | ... | ... |

### 4. Smart Money Analysis

Track notable investors and their activities:

**Super Investors / Gurus** (Defined as legendary investors or top-performing fund managers)

**Bullish Signals - Notable Buyers**
| Investor | Institution | Action | Shares | Value ($M) | % of Their Portfolio | Signal Strength |
|----------|-------------|--------|--------|------------|---------------------|-----------------|
| Warren Buffett | Berkshire Hathaway | New Position | 50.0M | $7,500 | 4.5% | VERY HIGH |
| Bill Ackman | Pershing Square | Increased 80% | 8.5M | $1,275 | 8.2% | HIGH |
| ... | ... | ... | ... | ... | ... | ... |

**Bearish Signals - Notable Sellers**
| Investor | Institution | Action | Shares Sold | Value ($M) | Reason (if stated) | Signal Strength |
|----------|-------------|--------|-------------|------------|-------------------|-----------------|
| Michael Burry | Scion Asset Mgmt | Eliminated | 3.2M | $480 | Not disclosed | HIGH |
| ... | ... | ... | ... | ... | ... | ... |

**Notable Investor Categories**
1. **Value Investors**: Buffett, Klarman, Pabrai, Greenblatt
2. **Growth Investors**: T. Rowe Price, Baron, Baillie Gifford
3. **Activist Investors**: Icahn, Ackman, Loeb, ValueAct
4. **Quant/Macro**: Bridgewater, Renaissance, AQR, Two Sigma
5. **Tech-Focused**: ARK Invest, Tiger Global, Coatue

**Why Smart Money Matters**
- Superior research resources and information access
- Proven track records of alpha generation
- Often catalyst for stock re-rating
- Activist investors can drive corporate changes
- Attracts other institutional followers


This section is not finished here: `Analysis Framework` continues in `references/11-ownership-concentration-analysis.md`.
