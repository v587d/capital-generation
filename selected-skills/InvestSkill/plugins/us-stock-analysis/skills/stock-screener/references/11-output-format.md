# Output Format

Part 2 of 3 for `stock-screener` — the five output sections of a screening report
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Output Format

### Section 1 — Data Sources

State the date and source(s) used for prices and financials.

### Section 2 — Screener Leaderboard

Produce a ranked table sorted by TOTAL score descending:

```
| Rank | Ticker | Val  | Quality | Momentum | Sentiment | Growth | TOTAL | Signal     |
|------|--------|------|---------|----------|-----------|--------|-------|------------|
|  1   | AAPL   | 7.2  |   8.1   |   6.9    |    7.5    |  8.0   |  7.5  | BUY        |
|  2   | MSFT   | 6.8  |   8.4   |   7.1    |    6.9    |  7.8   |  7.4  | BUY        |
| ...  |  ...   | ...  |   ...   |   ...    |    ...    |  ...   |  ...  |    ...     |
```

Signal legend:
- TOTAL ≥ 7.5 → 🟢 STRONG BUY
- TOTAL 6.0–7.4 → 🟢 BUY
- TOTAL 4.5–5.9 → 🟡 HOLD
- TOTAL 3.0–4.4 → 🔴 AVOID
- TOTAL < 3.0 → 🔴 STRONG AVOID

### Section 3 — Top 3 Deep Dives

For each of the top 3 ranked stocks, provide:

**[RANK] [TICKER] — [Company Name]**

- **Why it scores high**: 3–5 bullet points, one per standout dimension
- **Key risk**: The single most important risk that could invalidate the bull case
- **Entry consideration**: Suggested price zone or trigger (e.g., pullback to MA50, post-earnings confirmation)
- **Investment horizon**: Short / Medium / Long-term suitability

### Section 4 — Avoid List (Bottom 3)

For each of the bottom 3 ranked stocks, provide:

**[RANK] [TICKER] — [Company Name]**

- **Why it scores low**: 2–3 bullet points identifying the weakest dimensions
- **Potential catalyst to watch**: One event or data point that could change the thesis (don't ignore — flag for reassessment)

### Section 5 — Screening Notes

- Any tickers excluded by filters (and which filter triggered)
- Data gaps or caveats (e.g., "ROIC unavailable for XXXX, sub-score excluded")
- Sector / macro context relevant to this batch of stocks
- Correlation warning if top picks are highly correlated (e.g., all mega-cap tech)

---
