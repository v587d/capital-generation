# 11. Visualization Support

Part 3 of 3 for `industry-map` — 11. Visualization Support; Output; Standard Signal Output; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## 11. Visualization Support

When `--visual` is used, provide graph specs ready for the host chart channel:

### Chain Graph
**Chart type**: Directed graph (Mermaid `flowchart LR` primary, ASCII fallback, graphviz/HTML for rich export). Nodes = layers with representative tickers; edges = supplier→customer flow.

### Value-Capture-by-Layer Bar
**Chart type**: Horizontal bar — estimated gross/operating margin (or a 0–10 value-capture score) per layer, to show where the profit pool sits.

```
Layer               Value-capture score (0–10)
Fab Equipment       [value]
Foundry             [value]
GPU / Accelerators  [value]
Cloud / CSP         [value]
Model Labs          [value]
```

### Bottleneck Heat Row
**Chart type**: Scorecard / heat row — bottleneck score per layer, highlighting the chokepoints.

---

## Output

Provide an industry-map report with:
- Executive Summary (scope, where value sits today, migration thesis — 3 sentences)
- The Chain Map (directed graph + chain-map table)
- Position Locator (if a ticker was given)
- Chokepoint & Bottleneck Analysis (scored, with the durable toll-collectors named)
- Value-Pool & Margin Migration (now → next, with the confirming trigger)
- Concentration & Supply-Chain Risk
- Investment Ideas by layer (core / 2nd-order / avoid)
- Investment Implications and how this feeds `competitor-analysis` / `stock-screener` / `bear-case`

## Standard Signal Output

All analysis concludes with this standardized block:

```
## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH — thesis breaks if:**
- the mapped chokepoint is broken (credible second source qualifies, or a customer in-sources) OR value migrates away from the node you favored
- [One or two more triggers drawn from this analysis's own drivers, each with a threshold]

**If signal is BEARISH — thesis breaks if:**
- the node re-establishes a durable bottleneck OR a new scarce input forms in its favor
- [One or two more triggers drawn from this analysis's own drivers, each with a threshold]

**Re-run this analysis when:**
- [ ] Next earnings release
- [ ] Price moves ±15% from current level
- [ ] 60 days have elapsed
- [ ] Material news event (acquisition, leadership change, regulatory decision)

╔══════════════════════════════════════════════╗
║              INVESTMENT SIGNAL               ║
╠══════════════════════════════════════════════╣
║ Signal:      BULLISH / NEUTRAL / BEARISH     ║
║ Confidence:  HIGH / MEDIUM / LOW             ║
║ Horizon:     SHORT / MEDIUM / LONG-TERM      ║
║ Score:       X.X / 10                        ║
╠══════════════════════════════════════════════╣
║ Action:      BUY / HOLD / SELL               ║
║ Conviction:  STRONG / MODERATE / WEAK        ║
╚══════════════════════════════════════════════╝
```

Score Guide: 8.0–10.0 Strongly Bullish | 6.0–7.9 Moderately Bullish | 4.0–5.9 Neutral | 2.0–3.9 Moderately Bearish | 0.0–1.9 Strongly Bearish
Confidence: HIGH (strong data, clear signals) | MEDIUM (mixed signals) | LOW (limited data, conflicting signals)
Horizon: SHORT-TERM (1 week–3 months) | MEDIUM-TERM (3 months–1 year) | LONG-TERM (1+ years)

**Disclaimer:** Educational analysis only. Not financial advice.


