# Multi-Timeframe Analysis (MTF)

Part 3 of 6 for `technical-analysis` — Multi-Timeframe Analysis (MTF); Volume Profile Analysis
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Multi-Timeframe Analysis (MTF)

### Framework

Analyze 3 timeframes simultaneously — higher timeframe establishes the trend, primary timeframe identifies the setup, lower timeframe refines the entry. Trade only in the direction of the higher timeframe trend.

### Trading Setups by Approach

| Approach          | Higher TF (Trend) | Primary TF (Setup) | Lower TF (Entry) |
|-------------------|--------------------|---------------------|------------------|
| Day Trading       | Weekly             | Daily               | 1-Hour           |
| Swing Trading     | Monthly            | Weekly              | Daily            |
| Position Trading  | Quarterly          | Monthly             | Weekly           |

### MTF Alignment Scoring

| Alignment Score | Interpretation                                                    |
|-----------------|-------------------------------------------------------------------|
| 3/3 Bullish     | Strong long setup — all timeframes confirm uptrend               |
| 3/3 Bearish     | Strong short setup — all timeframes confirm downtrend            |
| 2/3 Aligned     | Moderate setup — primary direction clear, minor conflict         |
| 1/3 Aligned     | Weak/conflicting — avoid new positions, wait for clarity         |
| 0/3 Aligned     | Contradiction across all timeframes — no trade                   |

### MTF Confluence Table

| Timeframe  | Trend Direction | Key Signal          | Support | Resistance | Alignment |
|------------|-----------------|---------------------|---------|------------|-----------|
| Higher TF  |                 |                     |         |            |           |
| Primary TF |                 |                     |         |            |           |
| Lower TF   |                 |                     |         |            |           |
| **Overall**|                 | **Score: X/3**      |         |            |           |

### MTF Integration with `--chart` Flag

When `--chart` is used, MTF analysis adds the following data tables for report generation:

```
MTF Summary Table:
Timeframe   Candle   MA Trend    RSI     MACD       Volume Trend   Signal
Weekly      [data]   [Up/Down]   [val]   [Bull/Bear] [Rising/Fall]  [Bullish/Bearish/Neutral]
Daily       [data]   [Up/Down]   [val]   [Bull/Bear] [Rising/Fall]  [Bullish/Bearish/Neutral]
4-Hour      [data]   [Up/Down]   [val]   [Bull/Bear] [Rising/Fall]  [Bullish/Bearish/Neutral]
Alignment Score: X/3
```

**Rule**: Never take a trade rated 1/3 or lower on MTF alignment. Wait for 2/3 minimum before entry.

---

## Volume Profile Analysis

### Key Concepts

- **Point of Control (POC)**: The price level with the highest volume traded over the selected period. Acts as a magnetic price level — markets frequently return to and consolidate around the POC.
- **Value Area (VA)**: The price range where approximately 70% of total volume was traded. Defines the "fair value zone" as agreed upon by market participants.
- **Value Area High (VAH)**: Upper boundary of the Value Area. Strong resistance when price is approaching from below.
- **Value Area Low (VAL)**: Lower boundary of the Value Area. Strong support when price is approaching from above.
- **Low Volume Node (LVN)**: A price range with minimal volume. Price passes through LVNs quickly — acts as a gap zone.
- **High Volume Node (HVN)**: A price range with dense volume. Price is magnetically attracted and consolidates around HVNs.

### Volume Profile Shapes

| Shape                | Description                                         | Implication                                         |
|----------------------|-----------------------------------------------------|-----------------------------------------------------|
| Normal (Bell Curve)  | Symmetric distribution, clear POC in the middle    | Balanced, range-bound market — fair value accepted  |
| P-Shape              | High volume at top, thin tail at bottom             | Buying tail below = short-covering rally, bullish   |
| b-Shape              | High volume at bottom, thin tail at top             | Selling tail above = distribution/top, bearish      |
| Double Distribution  | Two high-volume nodes with low-volume gap between  | Market in transition — break of LVN is directional  |
| Thin Profile         | Volume evenly spread, no clear POC                  | Trending market — follow the trend, no anchoring    |

### Volume Profile Trading Rules

| Scenario                        | Interpretation                                          | Action                                    |
|---------------------------------|---------------------------------------------------------|-------------------------------------------|
| Price > VAH (above Value Area)  | Bullish — market accepted higher prices, strong trend  | Buy breakouts above VAH with volume       |
| Price < VAL (below Value Area)  | Bearish — market rejected higher prices, breakdown     | Sell breakdowns below VAL with volume     |
| Price at POC                    | High acceptance zone — balanced, range-bound likely    | Fade edges of range; buy VAL, sell VAH    |
| Price enters LVN (thin area)    | Fast move — price moves quickly through low-volume gap | Expect acceleration; don't fade momentum  |
| Price at HVN                    | Magnetic zone — consolidation, range trade likely      | Mean-reversion strategies appropriate     |

### Session vs. Composite Profile

- **Session Profile**: Volume profile for a single trading day or week. Identifies intraday POC, VAH, VAL.
- **Composite Profile**: Aggregated over weeks, months, or custom date range. Identifies major structural levels.
- **Integration rule**: Composite HVNs = major structural support/resistance levels. LVNs = breakout acceleration zones. Session POC = short-term magnet.

---


