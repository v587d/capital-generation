# Options Flow Integration

Part 5 of 6 for `technical-analysis` — Options Flow Integration; Output; Standard Signal Output
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Options Flow Integration

### Put/Call Ratio Interpretation

The Put/Call ratio measures options market sentiment — the ratio of put volume to call volume on a given day.

| P/C Ratio   | Interpretation                                                    |
|-------------|-------------------------------------------------------------------|
| < 0.6       | Extreme bullishness / complacency — contrarian warning (overbought)|
| 0.6–0.7     | Bullish — call buyers dominating, positive sentiment              |
| 0.7–1.0     | Neutral — balanced activity                                       |
| 1.0–1.3     | Bearish fear — put buyers dominating, defensive hedging           |
| > 1.3       | Extreme fear — potential contrarian buy signal (maximum bearishness)|

**CBOE Total P/C vs. Equity-Only P/C**: Equity-only P/C more directly reflects retail/institutional directional bets (excludes index hedging).

### Unusual Options Activity (UOA) Signals

- **Large block trades**: Single orders of 500+ contracts, especially OTM (out-of-the-money)
- **OTM sweeps**: Aggressive market orders sweeping multiple exchanges at ask — directional conviction
- **Dark pool prints**: Large, off-exchange block prints can signal institutional accumulation/distribution
- **Short-dated OTM calls on takeover candidates**: One of the most reliable pre-announcement signals
- **Key UOA filters**: Volume > 5x open interest, expiry within 30 days, OTM strike, market order execution

### Implied Volatility (IV) vs. Historical Volatility (HV)

| Condition   | Description                                              | Options Strategy Implication        |
|-------------|----------------------------------------------------------|-------------------------------------|
| IV >> HV    | Options are expensive — market pricing elevated moves   | Premium selling opportunity (write options) |
| IV ≈ HV     | Options fairly priced                                    | No directional vol edge             |
| IV << HV    | Options are cheap — market underpricing moves           | Buying options (long vol opportunity)|

- **IV Rank (IVR)**: Current IV relative to its 52-week range. IVR > 50 = elevated; IVR < 25 = depressed.
- **IV Percentile**: % of days in the past year where IV was lower than current. More robust than IV Rank.

### Max Pain Theory

- **Max Pain** = The strike price at which the total value of all outstanding options (puts and calls) would expire worthless — the price that causes maximum loss for option buyers.
- Near expiration, market prices have a tendency to gravitate toward the max pain level (due to dealer hedging flows).
- Most useful in the final 5–7 days before monthly options expiration (OPEX).
- **Application**: If stock is significantly above max pain near OPEX, short-term mean reversion is possible.

### Gamma Exposure (GEX) and Spot Price Impact

- **Gamma** measures how much a dealer's delta changes per $1 move in the underlying.
- **Positive GEX (Dealer Long Gamma)**: Dealers buy into dips and sell into rallies — suppresses volatility, market stays range-bound.
- **Negative GEX (Dealer Short Gamma)**: Dealers sell into dips and buy into rallies — amplifies moves, increases volatility.
- **GEX Flip Level**: The price at which market transitions from positive to negative gamma — crossing this level can accelerate directional moves.
- **Practical rule**: Low realized volatility + tightening range = likely high positive GEX environment. Breakouts become more powerful when negative GEX zone is entered.

> **Note**: This section provides interpretive framework. Actual real-time options flow data, IV readings, and GEX levels must be sourced from the user's options data provider (e.g., Market Chameleon, Unusual Whales, SpotGamma, Thinkorswim).

---

## Output

Provide technical analysis report with:
- Current trend and momentum assessment
- Key chart patterns identified
- Support and resistance levels
- Technical indicator signals
- Volume and volatility analysis
- Entry/exit points and price targets
- Stop-loss recommendations
- Risk/reward ratio for trade setups
- Time horizon (short-term, swing, position trading)
- MTF alignment score and summary table
- Ichimoku Cloud status (price above/below/inside cloud)
- Volume Profile POC, VAH, VAL levels

### Enhanced Output (with --chart flag)
- All standard output sections above
- Chart data tables for price, volume, and indicators
- MTF confluence table with signal direction per timeframe
- ASCII charts for terminal display
- Pattern recognition overlays with annotations
- Support/resistance level visualizations
- Volume Profile data (POC, VA, LVN/HVN zones)
- Technical indicator panels (RSI, MACD, Bollinger Bands, Ichimoku)
- Chart specifications for HTML report generation
- Color-coded signals (bullish/bearish/neutral)

Keep analysis objective and data-driven, avoiding emotional bias.

## Standard Signal Output

All analysis concludes with this standardized block:

```

