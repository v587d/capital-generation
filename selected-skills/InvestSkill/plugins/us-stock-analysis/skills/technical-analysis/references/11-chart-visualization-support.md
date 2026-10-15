# Chart Visualization Support

Part 2 of 6 for `technical-analysis` — Chart Visualization Support
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Chart Visualization Support

When `--chart` flag is used, include chart specifications and data tables:

### 1. Price Chart with Moving Averages
**Chart Type**: Candlestick chart with overlay lines
**Data Table**:
```
Date        Open      High      Low       Close     Volume      SMA_30    SMA_60    SMA_200
2024-01-01  [price]   [price]   [price]   [price]   [volume]    [price]   [price]   [price]
2024-01-02  [price]   [price]   [price]   [price]   [volume]    [price]   [price]   [price]
...
[Last 90 trading days for detailed view]
```

**Visual Specifications**:
- Candlesticks: Green for up days, red for down days
- SMA 30: Blue line (short-term trend)
- SMA 60: Orange line (intermediate trend)
- SMA 200: Purple line (long-term trend)
- Support/resistance: Horizontal dashed lines with labels

### 2. Volume Bars
**Chart Type**: Bar chart (synchronized with price chart)
**Data Table**:
```
Date        Volume      Avg_Volume_20    Above_Avg    Color
2024-01-01  [volume]    [volume]         [Yes/No]     [Green/Red]
2024-01-02  [volume]    [volume]         [Yes/No]     [Green/Red]
...
```

**Visual Specifications**:
- Green bars: Volume on up days
- Red bars: Volume on down days
- Dashed line: 20-day average volume
- Highlight bars exceeding 2x average volume

### 3. RSI Indicator Panel
**Chart Type**: Line chart with overbought/oversold zones
**Data Table**:
```
Date        RSI_14    Overbought_70    Oversold_30    Signal
2024-01-01  [value]   70               30             [Neutral/OB/OS]
2024-01-02  [value]   70               30             [Neutral/OB/OS]
...
```

**Visual Specifications**:
- RSI line: Blue
- Overbought zone (>70): Red shaded area
- Oversold zone (<30): Green shaded area
- Midline (50): Dashed gray line
- Divergence annotations if present

### 4. MACD Indicator Panel
**Chart Type**: Line chart with histogram
**Data Table**:
```
Date        MACD      Signal    Histogram    Crossover
2024-01-01  [value]   [value]   [value]      [None/Bullish/Bearish]
2024-01-02  [value]   [value]   [value]      [None/Bullish/Bearish]
...
```

**Visual Specifications**:
- MACD line: Blue
- Signal line: Red
- Histogram: Green (positive), Red (negative)
- Zero line: Black dashed
- Crossover markers: Arrows or dots

### 5. Bollinger Bands
**Chart Type**: Overlay on price chart
**Data Table**:
```
Date        Price     BB_Upper    BB_Middle    BB_Lower    %B       Bandwidth
2024-01-01  [price]   [price]     [price]      [price]     [value]  [value]
2024-01-02  [price]   [price]     [price]      [price]     [value]  [value]
...
```

**Visual Specifications**:
- Upper band: Red dashed line
- Middle band (20 SMA): Blue solid line
- Lower band: Green dashed line
- Shaded area between bands: Light gray
- Price line: Black candlesticks

### 6. Support & Resistance Levels
**Annotation Overlay**:
```
Level Type       Price      Strength    Touches    Last Test    Notes
Resistance       $[price]   Strong      5          [date]       Historical high
Resistance       $[price]   Medium      3          [date]       Recent rejection
Support          $[price]   Strong      4          [date]       Key accumulation zone
Support          $[price]   Weak        2          [date]       Minor bounce level
Fibonacci 61.8%  $[price]   N/A         -          -            Retracement level
```

### 7. Pattern Recognition Annotations
**Chart Overlays**:
```
Pattern Type              Start Date    End Date      Status        Target        Risk/Reward
Head & Shoulders          2024-01-15    2024-02-10    Confirmed     $[price]      1:3.2
Ascending Triangle        2024-02-01    Current       Forming       $[price]      1:2.5
Flag Pattern             2024-02-05    2024-02-08    Complete      $[price]      1:2.8
```

**Visual Elements**:
- Pattern boundaries: Colored rectangles or polygons
- Trendlines: Dashed connecting lines
- Breakout points: Arrows indicating direction
- Target levels: Horizontal lines with labels

### ASCII Chart Example (Terminal Display)

```
Technical Chart: AAPL (Last 30 Days)

Price ($)
180 ┤                                    ╭─╮
175 ┤                              ╭─────╯ ╰─╮
170 ┤                        ╭─────╯         ╰──╮
165 ┤                  ╭─────╯                  ╰─╮  ← Current: $172.50
160 ┤            ╭─────╯                          ╰──
155 ┤      ╭─────╯                                      SMA 30: $168.23
150 ┤──────╯                                            SMA 60: $165.80
    └──┬─────┬─────┬─────┬─────┬─────┬─────┬──          ══════ Resistance: $178
     1/15  1/22  1/29  2/05  2/12  2/19  2/26          ══════ Support: $155

RSI (14)
 70 ┤                                    ● ← 68 (approaching OB)
 50 ┤                        ●     ●
 30 ┤            ●
    └──┬─────┬─────┬─────┬─────┬─────┬─────┬──

Volume (M)
100M┤                                    █
 75M┤                              █     █
 50M┤            █     █     █     █  █  █  █
 25M┤      █  █  █  █  █  █  █  █  █  █  █  █
    └──┬─────┬─────┬─────┬─────┬─────┬─────┬──

Signals:
↗ Bullish: Price above SMA 30 & 60
● RSI approaching overbought (68) - potential pullback
📊 Volume increasing on up days - healthy uptrend
🎯 Target: $178 (resistance), Stop: $165 (below SMA 60)
```

### Integration with Report Generator

When `--chart` flag is used, output is optimized for `/report-generator`:
- All chart data tables formatted for Chart.js/Plotly
- Color schemes specified for consistent visualization
- Annotations and overlays clearly defined
- Time axis formatting (date range, granularity)
- Y-axis scaling recommendations (log scale for long-term charts)

### Chart Configuration Recommendations

**Timeframe Selection**:
- **Day Trading**: 1-minute to 1-hour candles, last 5-10 days
- **Swing Trading**: 4-hour to daily candles, last 3-6 months
- **Position Trading**: Daily to weekly candles, last 1-3 years

**Indicator Combinations**:
- **Trend Following**: SMA 50/200 + MACD + ADX
- **Mean Reversion**: Bollinger Bands + RSI + Stochastic
- **Momentum**: RSI + MACD + Volume
- **Breakout**: Bollinger Bands + Volume + Pattern Recognition

---


