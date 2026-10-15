# Analysis Framework

Part 1 of 3 for `short-interest` — Analysis Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Analysis Framework

### 1. Short Interest Overview

Measure the current level and trend of bearish positioning:

**Core Short Interest Metrics**
- **Short interest (shares)**: Total number of shares sold short and not yet covered or closed
- **Short float %**: Short shares / Total float (shares available for public trading)
- **Short interest as % of shares outstanding**: Short shares / Total shares outstanding (includes locked-up insider shares)
- Float % is the more actionable metric — tighter supply amplifies squeeze dynamics

**Short Float % Thresholds**
```
Short Float %     Interpretation
<2%               Negligible — minimal bearish conviction
2-5%              Low — modest skepticism or hedging
5-10%             Moderate — meaningful bearish positioning
10-20%            Elevated — significant short thesis in market
20-30%            High — heavy bearish conviction, squeeze potential
>30%              Extreme — high risk environment (squeeze OR fundamental collapse)
```

**Days to Cover (Short Interest Ratio)**
- Formula: Short interest (shares) / Average daily trading volume
- Represents: how many trading days it would take all shorts to cover at normal volume
- Also called: Short Interest Ratio (SIR)

```
DTC Range         Interpretation
<1 day            Very low — shorts can exit quickly
1-3 days          Low — manageable exit risk for shorts
3-5 days          Moderate — some covering friction
5-10 days         Elevated — meaningful covering difficulty
>10 days          High — forced covering creates significant price pressure
>20 days          Extreme — structural squeeze conditions present
```

**Change in Short Interest Trend**
- Compare last 4 reporting periods (approximately 2 months)
- Increasing short interest: bears building positions, growing conviction against stock
- Decreasing short interest: short covering, thesis deterioration, or squeeze in progress
- Spike in short interest: new negative catalyst or activist short report
- Rapid decline in short interest: covering rally in progress, thesis proved wrong

### 2. Short Squeeze Potential Assessment

**Squeeze Score (0-10 Composite)**

Assign points based on the following conditions:
- Short float > 20%: +3 points (high short interest is the core prerequisite)
- Days to Cover > 10: +2 points (exit difficulty creates forced buying)
- Recent positive catalyst (earnings beat, product launch, partnership, FDA approval): +2 points
- Strong price momentum (price above 50-day moving average): +1 point
- Limited share supply (small float < 50 million shares): +1 point
- High borrow rate (annualized cost > 5%): +1 point (shorts paying carrying cost = time pressure)

```
Squeeze Score     Probability Assessment
0-2               Low — insufficient conditions for meaningful squeeze
3-4               Moderate — partial conditions met, monitor for catalysts
5-6               High — most conditions met, squeeze possible on catalyst
7-8               Very High — strong squeeze setup, catalyst likely to trigger
9-10              Extreme — textbook squeeze conditions, high probability event
```

**Three Requirements for High-Probability Squeeze**

All three must be present simultaneously:
1. **High short interest**: Float% > 15% AND DTC > 7 days (supply-demand imbalance)
2. **Catalyst or forced covering trigger**: positive news, options expiration forcing hedging, index inclusion, or institutional accumulation
3. **Limited downside floor**: fundamental support (valuation floor, asset value) or strong technical support level that prevents shorts from adding

**Historical Squeeze Pattern Reference**
- GameStop (GME) January 2021: 140% short float + retail coordination + options gamma cascade
- Volkswagen (VW) October 2008: Porsche cornered supply, DTC extreme, short float near 13% of total shares outstanding
- Common precursors: borrow rate spikes sharply before price spike, DTC > 10 sustained for weeks, options call OI builds in OTM strikes
- Key lesson: squeezes are self-reinforcing — covering buying creates price increase which triggers more covering

### 3. Borrow Rate and Cost of Short

**Borrow Rate Tiers**
```
Annualized Rate    Classification    Interpretation
<1%               General Collateral  Easy to borrow — no friction on shorts
1-5%              Easy to Borrow      Low cost, ample supply available
5-15%             Hard to Borrow      Elevated cost, supply becoming scarce
15-30%            Very Hard           Significant carry cost, time pressure on shorts
>30%              Extreme / Recall    Near impossible to maintain at sustainable cost
```

**Borrow Rate Impact Analysis**
- At 20% annualized borrow rate: a short position costs shorts approximately 20 cents per $1 of position per year
- High borrow rates create urgency to cover — especially if stock trades sideways or up
- Borrow availability changes: easy to borrow → hard to borrow transition signals supply tightening
- **Recall risk**: Prime brokers can recall shares on loan with short notice, forcing mandatory covering
- Borrow rate spike (rapid increase in 1-2 weeks) is a leading indicator of pending squeeze

**Implications of Borrow Dynamics**
- High borrow cost + high short interest = unstable equilibrium
- Time works against short sellers in high-borrow-rate environments
- Tracking borrow rate trend over 30-60 days is more valuable than single-point reading


This section is not finished here: `Analysis Framework` continues in `references/11-bearish-thesis-evaluation.md`.
