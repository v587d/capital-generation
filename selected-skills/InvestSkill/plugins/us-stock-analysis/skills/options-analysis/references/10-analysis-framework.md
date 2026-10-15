# Analysis Framework

Part 1 of 4 for `options-analysis` — Analysis Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Analysis Framework

### 1. Options Basics and Context

**Core Terminology**
- **Strike price**: The price at which the option holder can buy (call) or sell (put) the underlying stock
- **Expiration date**: The date the option contract expires; American-style options can be exercised at any time before expiration
- **Premium**: The market price of the option contract (cost to buyer, credit received by seller)
- **Contract**: Represents 100 shares of the underlying stock
- **ITM (In-the-Money)**: Call with strike < stock price; Put with strike > stock price — has intrinsic value
- **ATM (At-the-Money)**: Strike approximately equal to current stock price
- **OTM (Out-of-the-Money)**: Call with strike > stock price; Put with strike < stock price — only time value, no intrinsic value

**Intrinsic Value vs. Time Value**
- Premium = Intrinsic Value + Time Value (Extrinsic Value)
- Intrinsic value: how far ITM the option is (cannot be negative)
- Time value: premium above intrinsic value — represents probability of further price movement and time remaining

**When to Use Options vs. Stock**
- **Leverage**: Control 100 shares with a fraction of the capital (calls vs. outright long)
- **Hedging**: Protect existing portfolio positions (protective puts, collars)
- **Income generation**: Sell covered calls or cash-secured puts to generate premium income
- **Volatility plays**: Profit from large moves (straddles) or stability (iron condors) regardless of direction
- **Defined risk**: Spreads cap maximum loss to the debit paid

### 2. The Greeks Analysis

**Delta (Δ) — Directional Sensitivity**

Definition: Change in option price for a $1 move in the underlying stock price.

```
Option Type      Delta Range      Moneyness Context
Call (long)      0 to +1.0        Deep OTM ≈ 0.05, ATM ≈ 0.50, Deep ITM ≈ 0.99
Put (long)       -1.0 to 0        Deep OTM ≈ -0.05, ATM ≈ -0.50, Deep ITM ≈ -0.99
```

- **Delta as probability proxy**: A 70-delta option approximates a 70% probability of expiring ITM (rough heuristic, not precise)
- **Position delta**: Sum of all delta exposure across a portfolio = total directional equivalent shares
- Directional traders: select delta matching conviction (high delta = high directional exposure, lower leverage; low delta = cheaper, more speculative)
- Delta hedging: offset option delta with opposite stock position to create delta-neutral portfolio

**Gamma (Γ) — Rate of Delta Change**

Definition: Rate of change of delta for a $1 move in the underlying.

- Gamma is highest for ATM options and increases dramatically as expiration approaches
- **Long gamma**: Long options positions (long calls or puts) — benefits from large moves in either direction; gamma accelerates gains as stock moves through strike
- **Short gamma**: Short options positions — benefits from stability and small moves; faces accelerating losses on large moves
- **Gamma risk at expiration**: ATM options near expiry have very high gamma — pin risk and rapid delta shifts
- **Gamma scalping**: Dynamically delta-hedging a long gamma position to profit from realized volatility exceeding implied volatility
- Weekly options have the highest gamma, making them both powerful and dangerous near expiry

**Theta (Θ) — Time Decay**

Definition: Daily erosion of an option's value due to the passage of time (always negative for long options, positive for short options).

- Theta represents the "rent" paid to maintain a long options position
- Time decay is not linear — it accelerates as expiration approaches

```
DTE Range        Theta Decay Speed
>90 days         Slow — manageable for long holders
60-90 days       Moderate — beginning to accelerate
30-60 days       Elevated — meaningful daily decay
15-30 days       Fast — significant daily cost
7-15 days        Rapid — theta dominates P&L
<7 days          Extreme — ATM options decay very rapidly
```

- **Theta / premium**: The daily decay as a percentage of the option's premium
- Short options strategies (iron condors, covered calls) benefit from theta; structure positions so that time is your ally
- Rule of thumb: avoid holding long OTM options into the final 21 days unless near a catalyst

**Vega (ν) — Volatility Sensitivity**

Definition: Change in option price for a 1 percentage point change in implied volatility (IV).

- **Long options = long vega**: Long calls and long puts both benefit from IV expansion
- **Short options = short vega**: Short premium strategies benefit from IV contraction (volatility crush)
- Vega is largest for ATM options with 30-60 days to expiration
- Earnings and binary events dramatically increase vega exposure — IV expands before event, then collapses after (volatility crush)

```
IV Change Impact on Long Option:
+5% IV increase on $5.00 option with vega 0.20 = +$1.00 gain
-5% IV decrease (post-earnings crush) = -$1.00 loss
```

- **Vega term structure**: Long-dated options have higher absolute vega — more sensitive to IV changes
- Managing vega: use spreads to reduce net vega exposure (long spread = smaller net vega than long naked option)

**Rho (ρ) — Interest Rate Sensitivity**

Definition: Change in option price for a 1 percentage point change in the risk-free interest rate.

- Calls have positive rho: benefit from interest rate increases (higher rates increase call values)
- Puts have negative rho: decrease in value as interest rates rise
- Rho is typically the least impactful Greek for short-dated options
- More relevant for LEAPS (long-dated options with 1-2 year expirations) in a higher interest rate environment
- In a high-rate environment (rates >4%): rho becomes a meaningful consideration for 6-12 month options strategies


This section is not finished here: `Analysis Framework` continues in `references/11-implied-volatility-iv-analysis.md`.
