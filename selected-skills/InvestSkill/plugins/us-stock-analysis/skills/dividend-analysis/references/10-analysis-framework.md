# Analysis Framework

Part 1 of 5 for `dividend-analysis` — Analysis Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Analysis Framework

### 1. Dividend Safety Analysis

Assess the reliability and sustainability of the dividend:

**Payout Ratio Analysis**
- **EPS-based payout ratio**: Dividends per share / Earnings per share. Simple but earnings can be distorted by non-cash items.
- **FCF-based payout ratio**: Dividends paid / Free cash flow. More reliable measure — cash must be available to actually pay dividends.
- **AFFO payout ratio** (REITs): Dividends / Adjusted Funds From Operations. Standard metric for REITs since depreciation distorts net income.

**Safety Thresholds by Sector**
```
Sector               Very Safe    Moderate     Elevated     Danger
General (FCF)          <50%        50-70%       70-85%       >85%
Utilities (FCF)        <60%        60-75%       75-85%       >85%
REITs (AFFO)           <70%        70-80%       80-90%       >90%
Banks (Earnings)       <30%        30-40%       40-55%       >55%
MLPs (DCF)             <60%        60-75%       75-90%       >90%
```

**Dividend Safety Score (0-100)**

Weighted composite score:
- FCF payout ratio (25 pts): <50% = 25, 50-70% = 20, 70-85% = 10, >85% = 0
- FCF coverage ratio (20 pts): >2x = 20, 1.5-2x = 15, 1.0-1.5x = 8, <1.0x = 0
- Debt-to-EBITDA (20 pts): <1.5x = 20, 1.5-2.5x = 14, 2.5-3.5x = 7, >3.5x = 0
- Earnings stability (20 pts): Positive EPS 5yr = 20, 1 down year = 12, 2+ down years = 4
- Dividend history (15 pts): 10+ yr streak = 15, 5-9 yrs = 10, 2-4 yrs = 5, <2 yrs = 0

```
Score      Grade    Safety Assessment
90-100       A+     Very Safe
75-89        A      Safe
60-74        B      Borderline Safe
45-59        C      Elevated Risk
30-44        D      Unsafe
0-29         F      Danger Zone
```

**Dividend Stress Test**
- Scenario 1: Earnings decline 20% — can dividend be maintained at current payout?
- Scenario 2: Earnings decline 40% — what happens to dividend?
- Scenario 3: FCF drops to 5-year trough — payout ratio at trough FCF?
- Scenario 4: Revenue declines to 2020 COVID levels — stress test against prior recession data
- Pass/Fail for each scenario with projected payout ratio under stress

### 2. Dividend Growth Analysis

Measure the trajectory and sustainability of dividend increases:

**Dividend Growth Rate Calculations**
- 1-year DGR: Most recent annual dividend / Prior year annual dividend - 1
- 3-year DGR CAGR: (Current annual dividend / Dividend 3 years ago)^(1/3) - 1
- 5-year DGR CAGR: (Current / 5yr ago)^(1/5) - 1
- 10-year DGR CAGR: (Current / 10yr ago)^(1/10) - 1

```
DGR Tier        Range          Characteristic
Exceptional      >15%          High-growth compounders (FAST Graphs category)
Strong           8-15%         Solid dividend growers, re-rated higher
Moderate         4-8%          In line with or above inflation
Slow             1-4%          Token increases, inflation parity risk
Frozen           0%            No recent growth
Cut             <0%            Dividend reduced — major red flag
```

**Dividend Aristocrats and Kings**
- **Dividend Aristocrats**: S&P 500 constituents with 25+ consecutive years of dividend increases
- **Dividend Kings**: Stocks with 50+ consecutive years of consecutive increases (elite tier)
- **Dividend Achievers**: Stocks with 10+ consecutive years of increases (Nasdaq definition)
- Status confirmation adds credibility to safety assessment

**Chowder Rule**
```
Chowder Number = Current Yield + 5-Year DGR

Thresholds:
- Growth stocks (yield <3%): Chowder Number >= 12%
- High-yield stocks (yield >= 3%): Chowder Number >= 8%
- Utilities: Chowder Number >= 8% (special lower threshold)

Example: Yield 2.5% + 5yr DGR 10% = Chowder 12.5% (PASS for growth stock)
```

**Dividend Growth Sustainability Analysis**
- EPS growth rate vs. dividend growth rate: DGR > EPS growth = unsustainable (payout expansion)
- Payout ratio trend: expanding payout ratio limits future growth capacity
- FCF per share growth trend (primary driver of long-term DGR)
- Analyst consensus EPS growth estimate → maximum sustainable DGR = EPS growth + (payout reduction capacity)
- Revenue growth required to sustain dividend at current margins

### 3. Yield Analysis

Evaluate current yield attractiveness in historical and relative context:

**Current and Forward Yield**
- **Trailing yield**: Last 12 months dividends paid / Current price
- **Forward yield**: Projected next 12 months dividends / Current price (based on most recent quarterly dividend × 4)
- **Yield spread**: Forward yield minus 10-year Treasury yield. Positive spread = attractive income premium vs. risk-free rate.

**Historical Yield Context**
```
Yield Position          Interpretation
Current yield < 5yr avg   Stock trading at premium to historical (yield compressed = expensive)
Current yield ≈ 5yr avg   Fairly valued relative to history
Current yield > 5yr avg   Stock trading at discount (yield elevated = potentially cheap or risk elevated)
Current yield > 10yr avg  Historically cheap zone (requires safety check)
```

**Yield vs. 10-Year Treasury Analysis**
- Yield spread over 10-year Treasury: track historical spread compression/expansion
- Equity risk premium: compensates for equity risk vs. guaranteed government yield
- When spread < 1%: dividend yield barely compensates for equity risk vs. bonds
- When spread > 3%: significantly better income from equity vs. bonds (attractive)

**Yield-on-Cost (YOC) for Existing Holders**
- YOC = Original purchase price yield × (1 + DGR)^years held
- Demonstrates power of growing dividends on a fixed cost basis
- Example: 2% yield at purchase with 10% DGR for 10 years = 5.2% YOC

**Yield Trap Detection**

High yield + deteriorating business = value trap. Scrutiny triggers:
- Yield exceeds 7%: require thorough FCF analysis before investing
- Yield > 2x sector average: market pricing in dividend risk
- Yield spiked due to price decline (not dividend increase): investigate cause
- Consecutive quarters of FCF deterioration while yield elevated
- Debt issuance to fund dividend payments
- Red flags: declining revenue, rising payout ratio, credit rating downgrades, management tone change on dividend


This section is not finished here: `Analysis Framework` continues in `references/11-dividend-history-and-reliability.md`.
