# Advanced Indicators: Ichimoku Cloud

Part 4 of 6 for `technical-analysis` — Advanced Indicators: Ichimoku Cloud
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Advanced Indicators: Ichimoku Cloud

### Five Components

| Component     | Calculation                                     | Default Period | Purpose                              |
|---------------|-------------------------------------------------|----------------|--------------------------------------|
| Tenkan-sen    | (9-period High + 9-period Low) / 2              | 9 periods      | Short-term trend / momentum line     |
| Kijun-sen     | (26-period High + 26-period Low) / 2            | 26 periods     | Medium-term trend / baseline         |
| Senkou Span A | (Tenkan-sen + Kijun-sen) / 2, plotted 26 ahead | Leading        | Fast cloud boundary                  |
| Senkou Span B | (52-period High + 52-period Low) / 2, plotted 26 ahead | 52 periods | Slow cloud boundary              |
| Chikou Span   | Current close plotted 26 periods back           | Lagging        | Confirms trend vs. historical price  |

The shaded area between Senkou Span A and Senkou Span B is the **Kumo (Cloud)**.

### Bullish Ichimoku Signals

| Signal                    | Condition                                               | Strength |
|---------------------------|---------------------------------------------------------|----------|
| Price above Cloud         | Price above both Span A and Span B                      | Base condition |
| Green Cloud               | Span A > Span B (cloud is green/bullish)                | Trend support |
| TK Cross (Bullish)        | Tenkan-sen crosses above Kijun-sen                      | Medium signal |
| TK Cross above Cloud      | Bullish TK cross while price is above the cloud         | Strong signal |
| Chikou above price        | Chikou Span is above historical price 26 periods ago    | Confirms uptrend |
| All 5 elements aligned    | All conditions bullish simultaneously                   | Strongest signal |

### Bearish Ichimoku Signals

| Signal                    | Condition                                               | Strength |
|---------------------------|---------------------------------------------------------|----------|
| Price below Cloud         | Price below both Span A and Span B                      | Base condition |
| Red Cloud                 | Span B > Span A (cloud is red/bearish)                  | Trend resistance |
| TK Cross (Bearish)        | Tenkan-sen crosses below Kijun-sen                      | Medium signal |
| TK Cross below Cloud      | Bearish TK cross while price is below the cloud         | Strong signal |
| Chikou below price        | Chikou Span is below historical price 26 periods ago    | Confirms downtrend |
| All 5 elements aligned    | All conditions bearish simultaneously                   | Strongest signal |

### Kumo Twist

- A **Kumo Twist** occurs when Senkou Span A and Span B cross — changing the cloud color from green to red (bearish twist) or red to green (bullish twist).
- The cloud is plotted 26 periods ahead, so a Kumo Twist is an early warning signal visible in advance.
- **Thin cloud**: Weak support/resistance — price can break through easily.
- **Thick cloud**: Strong support/resistance — price will struggle to penetrate.

### Ichimoku Signal Strength Matrix

| # Bullish Conditions Met | Signal Grade           | Suggested Bias    |
|--------------------------|------------------------|-------------------|
| 5/5                      | Maximum Bullish        | Strong long bias  |
| 4/5                      | Strong Bullish         | Long bias         |
| 3/5                      | Moderate Bullish       | Lean long         |
| 2/5                      | Mixed / Transitioning  | Neutral           |
| 1/5 or 0/5               | Bearish                | Short bias        |

---


