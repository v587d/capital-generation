# Football Field Summary — Valuation Range

Part 3 of 5 for `stock-valuation` — Football Field Summary — Valuation Range; Margin of Safety Framework; Risk-Adjusted Expected Return; Analyst Consensus vs. Intrinsic Value; Deep DCF Modeling
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Football Field Summary — Valuation Range

Present all methods together in a football field chart:

```
Football Field Valuation Summary — [TICKER]
Current Market Price: $___

Method                      Bear (Low)    Base (Mid)    Bull (High)    Confidence
────────────────────────────────────────────────────────────────────────────────────
DCF — Bear/Base/Bull         $___          $___          $___           HIGH/MED/LOW
CCA — Peer Multiples         $___          $___          $___           HIGH/MED/LOW
EV/EBITDA Multiple           $___          $___          $___           HIGH/MED/LOW
P/E Multiple                 $___          $___          $___           HIGH/MED/LOW
Residual Income (if used)    $___          $___          $___           HIGH/MED/LOW
52-Week Range                $___          ─────────     $___           [Market]
Analyst Consensus            $___          $___          $___           [Street]
────────────────────────────────────────────────────────────────────────────────────
COMPOSITE INTRINSIC VALUE    $___          $___          $___

Visual Football Field:
$[low] |────────[bear range]────|────────[base range]────|────────[bull range]────| $[high]
                                              ▲
                                       Current Price $___
```

### Composite Valuation Calculation

```
Method Weighting (adjust based on applicable methods):
  DCF Valuation:              ___% weight    Implied: $___
  CCA (Comps):                ___% weight    Implied: $___
  EV/EBITDA Multiple:         ___% weight    Implied: $___
  P/E Multiple:               ___% weight    Implied: $___
  Residual Income:            ___% weight    Implied: $___
  ─────────────────────────────────────────────────────────
  Composite Weighted IV:                     $___
  Current Market Price:                      $___
  Margin of Safety:                          ___%  (discount to IV)
  Upside/Downside Potential:                 ___%
```

---

## Margin of Safety Framework

```
Margin of Safety = (Intrinsic Value − Market Price) / Intrinsic Value × 100%

Assessment:
>30% discount to IV    → Compelling value — strong margin of safety
10–30% discount        → Fair value — reasonable entry
0–10% discount         → Fairly priced — limited margin of safety
10–30% premium         → Slightly expensive — requires growth conviction
>30% premium           → Expensive — priced for perfection
>50% premium           → Very expensive — significant risk of multiple compression

Investor Type Minimums:
  Deep Value:       25–35% margin of safety required
  GARP:             10–20% margin of safety
  Growth:           0–10% (or slight premium for high-quality growth)
  Momentum:         Not applicable
```

---

## Risk-Adjusted Expected Return

Calculate the expected return across scenarios:

```
Expected Return Analysis:
Scenario    Probability    Price Target    Return vs. Current    Expected Return
────────────────────────────────────────────────────────────────────────────────
Bull         ___%           $___           +___%                 ___% contribution
Base         ___%           $___           +/-___%               ___% contribution
Bear         ___%           $___           -___%                 ___% contribution
────────────────────────────────────────────────────────────────────────────────
Probability-Weighted Expected Return:                            ___%

Risk/Reward Ratio:  [Bull upside] / [Bear downside] = ___x
(Good investments typically offer 3:1 or better risk/reward)
```

---

## Analyst Consensus vs. Intrinsic Value

```
Street vs. Model Comparison:
  Analyst Consensus Target (Mean):    $___
  Analyst Consensus Target (High):    $___
  Analyst Consensus Target (Low):     $___
  # Analysts covering:                ___
  Buy / Hold / Sell ratings:          ___ / ___ / ___

  Our Composite IV:                   $___
  vs. Consensus Mean:                 ___% [premium/discount]

  Interpretation:
  - Model > Consensus: Market may be underestimating growth/margin potential
  - Model < Consensus: Street may be pricing in too-optimistic assumptions
  - Large divergence: Investigate the key assumption difference
```

---

## Deep DCF Modeling

This section provides the full step-by-step DCF construction methodology for analysts who need a more rigorous, first-principles build. Use this when the quick DCF in Method 1 above requires deeper documentation, when running a standalone DCF, or when preparing material for an investment committee.

### Revenue Growth — Multi-Anchor Approach

Use multiple anchors to triangulate a defensible growth assumption:

- **Segment approach**: Project each revenue segment separately when possible (e.g., services vs. hardware, cloud vs. on-prem, international vs. domestic)
- **Historical growth analysis**: 3yr, 5yr, and 10yr revenue CAGR as a baseline anchor
- **Analyst consensus estimates**: Use sell-side consensus for years 1–3 as a cross-check
- **Management guidance**: Forward revenue guidance and long-term targets from earnings calls and investor days
- **Industry growth rate**: Use as a ceiling anchor (a company cannot sustainably grow faster than its industry forever)
- **Growth tapering**: Apply higher growth in years 1–5, decelerating in years 6–10 toward the terminal growth rate

### FCF Margin Construction

Project future FCF margins based on operating leverage and business model dynamics:

- **Historical FCF margin trend** (expanding, stable, or compressing — identify the driver)
- **Operating leverage potential**: As revenue scales, what fixed costs are being leveraged? (R&D, G&A, sales infrastructure)
- **Capex intensity** (% of revenue): Is capex increasing (scaling infrastructure) or decreasing (mature asset base)?
- **Working capital changes**: Is the company a working capital consumer or generator? (subscription businesses often generate WC)
- **Normalize for one-time items**: Strip out litigation settlements, asset sale gains, restructuring charges
- **SBC adjustment**: Subtract SBC from reported operating cash flow to get true economic FCF


This section is not finished here: `Deep DCF Modeling` continues in `references/13-terminal-value-two-methods.md`.
