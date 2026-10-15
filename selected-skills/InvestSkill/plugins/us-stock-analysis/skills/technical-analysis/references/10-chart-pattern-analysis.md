# Chart Pattern Analysis

Part 1 of 6 for `technical-analysis` — Chart Pattern Analysis; Technical Indicators; Price Levels; Market Context; Moving Average Chart Analysis; Trade Recommendation from MA Analysis
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Chart Pattern Analysis

1. **Trend Identification**
   - Primary trend (uptrend, downtrend, sideways)
   - Trend strength and momentum
   - Support and resistance levels
   - Trendline analysis

2. **Classic Chart Patterns**
   - Head and shoulders, inverse H&S
   - Double/triple tops and bottoms
   - Cup and handle
   - Triangles (ascending, descending, symmetrical)
   - Flags and pennants
   - Wedges and channels

3. **Candlestick Patterns**
   - Reversal patterns (doji, hammer, shooting star, engulfing)
   - Continuation patterns
   - Multi-candle formations

## Technical Indicators

1. **Trend Indicators**
   - Moving averages (SMA, EMA: 20, 50, 200-day)
   - Moving average crossovers
   - MACD (Moving Average Convergence Divergence)
   - ADX (Average Directional Index)

2. **Momentum Indicators**
   - RSI (Relative Strength Index)
   - Stochastic oscillator
   - Williams %R
   - Rate of Change (ROC)

3. **Volume Indicators**
   - Volume trends and patterns
   - On-Balance Volume (OBV)
   - Volume-weighted average price (VWAP)
   - Accumulation/Distribution line

4. **Volatility Indicators**
   - Bollinger Bands
   - Average True Range (ATR)
   - Volatility Index correlation

## Price Levels

- Key support and resistance zones
- Fibonacci retracement levels
- Pivot points
- Round number psychology
- Gap analysis

## Market Context

- Relative strength vs. market indices
- Sector rotation analysis
- Market breadth indicators
- Correlation with related assets

## Moving Average Chart Analysis

When given a stock ticker, always generate an MA chart and trade recommendation table as part of the analysis. This is the first required output section.

### MA Chart — Markdown Format

Retrieve or estimate recent price data and compute the following MAs:

| MA Period | Label | Trend Role |
|-----------|-------|------------|
| 30-day SMA | MA30 | Short-term trend |
| 60-day SMA | MA60 | Intermediate trend |
| 90-day SMA | MA90 | Medium-term trend |
| 200-day SMA | MA200 | Long-term bull/bear line |
| 365-day SMA | MA365 | Annual trend baseline |

**Required output — MA Position Table:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MOVING AVERAGE CHART — [TICKER]          [DATE]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Current Price : $[PRICE]

  MA       Value      vs Price    Signal
  ──────   ────────   ─────────   ───────────────────
  MA30     $[val]     ▲ +X.X%     [Above/Below] ← Short-term
  MA60     $[val]     ▲ +X.X%     [Above/Below] ← Intermediate
  MA90     $[val]     ▲ +X.X%     [Above/Below] ← Medium-term
  MA200    $[val]     ▼ -X.X%     [Above/Below] ← Long-term bull/bear
  MA365    $[val]     ▼ -X.X%     [Above/Below] ← Annual baseline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MA Stack: [BULLISH / BEARISH / MIXED]
  (Bullish = MA30 > MA60 > MA90 > MA200 > MA365)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**ASCII Trend Chart (last ~90 trading days):**

```
Price ($)
[HIGH] ┤         ╭──╮    ╭──╮
       ┤    ╭────╯  ╰────╯  ╰──╮       ← Price
       ┤────╯                   ╰──╮
       ┤·  ·  ·  ·  ·  ·  ·  ·  · ╰──  ← MA30
       ┤══════════════════════════════   ← MA60
       ┤- - - - - - - - - - - - - - -   ← MA90
[LOW]  ┤══════════════════════════════   ← MA200
       └─┬─────┬─────┬─────┬─────┬──→
       -90d  -70d  -50d  -30d  -10d  Today

Legend: ──── Price  · · · MA30  ════ MA60/MA200  - - - MA90
```

### MA Crossover Signals

Look for and report these high-significance crossover events. The standard data set is MA30 / MA60 / MA90 / MA200 / MA365 (the position table above); **MA50 is computed in addition**, solely because the classic 50/200 cross is what the market watches — state its value when you report it:

| Crossover | Type | Significance |
|-----------|------|--------------|
| MA30 crosses above MA60 | Golden Cross (short) | Short-term bullish momentum |
| MA30 crosses below MA60 | Death Cross (short) | Short-term bearish reversal |
| MA50 crosses above MA200 | Golden Cross (classic) | Major long-term bullish signal |
| MA50 crosses below MA200 | Death Cross (classic) | Major long-term bearish signal |
| Price reclaims MA200 from below | Breakout | Shift from bear to bull regime |
| Price loses MA200 support | Breakdown | Shift from bull to bear regime |

State: **most recent crossover event** + how many days ago it occurred.

---

## Trade Recommendation from MA Analysis

After computing MAs, output a clear, specific trade recommendation table:

```
╔══════════════════════════════════════════════════════════════════╗
║              MA-BASED TRADE RECOMMENDATION — [TICKER]           ║
╠══════════════════════════════════════════════════════════════════╣
║  Current Price : $[PRICE]                                       ║
╠══════════════════════════════════════════════════════════════════╣
║  OPERATION      │ ENTRY PRICE   │ TARGET        │ STOP-LOSS     ║
║  ───────────────┼───────────────┼───────────────┼────────────── ║
║  [BUY/SELL/HOLD]│ $[price]      │ $[price]      │ $[price]      ║
╠══════════════════════════════════════════════════════════════════╣
║  Rationale: [1-sentence MA-based reason]                        ║
║  Basis:     MA[X] = $[val] acting as [support/resistance]       ║
║  R/R Ratio: 1 : [X.X]                                          ║
║  Horizon:   [SHORT / SWING / LONG-TERM]                         ║
╚══════════════════════════════════════════════════════════════════╝
```

**Examples of well-formed recommendations:**
- "$185 is a good BUY entry for AAPL — price pulled back to MA90 ($183) which held as support, targeting MA resistance at $198 with stop below MA200 ($175). R/R 1:2.1."
- "$310 is a good SELL/SHORT entry for TSLA — price rejected MA60 ($312) as resistance while MA30 crossed below MA60, targeting $275 with stop at $320. R/R 1:2.5."
- "HOLD for MSFT — price is compressing between MA30 ($415) and MA60 ($420); wait for a confirmed break above MA60 before adding."

**Decision rules:**
- Price above all 5 MAs in bullish stack → BUY on MA30/MA60 dips
- Price below MA200 but reclaiming MA90 → speculative BUY with tight stop
- Price below all 5 MAs → SELL/AVOID; short only if MA30 < MA60 confirmed
- Price between MAs with no clear stack → HOLD, wait for resolution

---


