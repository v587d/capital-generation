# Scoring Framework

Part 1 of 3 for `stock-screener` — the five scores, their bands, and how TOTAL is composed
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Scoring Framework

Score every stock on five dimensions, each rated 0–10. Scores are composites — compute sub-scores for each factor listed, then average them into the dimension score (round to one decimal).

### 1. Valuation Score (0–10)

Higher score = cheaper relative to fundamentals.

| Sub-factor | How to score |
|---|---|
| P/E vs. sector median | Score 10 if P/E < 50 % of sector median, scale linearly to 0 if P/E > 200 % |
| Price-to-Sales (P/S) | Score 10 if P/S < 1, score 0 if P/S > 20, linear in between |
| EV/EBITDA | Score 10 if < 8x, score 0 if > 40x, linear in between |
| PEG Ratio | Score 10 if PEG < 0.75, score 0 if PEG > 3.0, linear in between; use N/A weight if earnings negative |

Average the available sub-scores → **Valuation Score**.

### 2. Quality Score (0–10)

Higher score = stronger business fundamentals.

| Sub-factor | How to score |
|---|---|
| Piotroski F-Score | Score = F-Score × (10/9), capped at 10 |
| ROIC vs. WACC spread | Score 10 if spread ≥ +10 pp, score 5 if at parity, score 0 if spread ≤ −10 pp |
| Gross margin trend (3-year) | Score 10 if expanding ≥ +3 pp/yr, score 5 if flat, score 0 if contracting ≥ −3 pp/yr |
| Debt-to-equity | Score 10 if D/E < 0.2, score 0 if D/E > 3.0, linear in between |

Average the available sub-scores → **Quality Score**.

### 3. Momentum Score (0–10)

Higher score = stronger price and relative performance momentum.

| Sub-factor | How to score |
|---|---|
| Price vs. MA50 | Score 10 if price ≥ 10 % above MA50, score 5 at MA50, score 0 if ≥ 10 % below |
| Price vs. MA200 | Score 10 if price ≥ 20 % above MA200, score 5 at MA200, score 0 if ≥ 20 % below |
| RSI (14-day) | Score 10 if RSI 55–70 (strong but not overbought), score 5 at RSI 50, score 0 if RSI < 30 or > 80 |
| 3M relative performance vs. SPY | Score 10 if outperforming by ≥ +10 %, score 5 if in-line, score 0 if underperforming by ≥ −10 % |
| 6M relative performance vs. SPY | Same scale as 3M |
| 12M relative performance vs. SPY | Same scale as 12M |

Average the available sub-scores → **Momentum Score**.

### 4. Sentiment Score (0–10)

Higher score = more positive smart-money and market positioning signals.

| Sub-factor | How to score |
|---|---|
| Insider net buying (trailing 6M) | Score 10 if net buy value > $5 M, score 5 if neutral/mixed, score 0 if net sell > $5 M |
| Institutional accumulation (QoQ) | Score 10 if institutions net added ≥ +2 % of float, score 5 if flat, score 0 if reduced ≥ −2 % |
| Short interest direction | Score 10 if short interest fell ≥ −20 % MoM (shorts covering), score 5 if flat, score 0 if short interest rose ≥ +20 % |
| Analyst estimate revisions (90d) | Score 10 if ≥ 3 upgrades and no downgrades, score 0 if ≥ 3 downgrades and no upgrades |

Average the available sub-scores → **Sentiment Score**.

### 5. Growth Score (0–10)

Higher score = stronger and more reliable growth trajectory.

| Sub-factor | How to score |
|---|---|
| Revenue growth YoY | Score 10 if ≥ 30 %, score 5 if 10 %, score 0 if ≤ 0 % |
| EPS growth YoY | Score 10 if ≥ 40 %, score 5 if 15 %, score 0 if ≤ 0 %; use N/A weight if negative base |
| Forward revenue growth estimate | Same scale as revenue growth YoY |
| Guidance trend (most recent quarter) | Score 10 if raised, score 5 if maintained, score 0 if lowered or withdrawn |

Average the available sub-scores → **Growth Score**.

### TOTAL Score

```
TOTAL = (Valuation × 0.20) + (Quality × 0.25) + (Momentum × 0.20) + (Sentiment × 0.15) + (Growth × 0.20)
```

Weights reflect: quality as the most durable factor, with equal emphasis on valuation, momentum, and growth, and a slight discount on sentiment which is noisier.

---
