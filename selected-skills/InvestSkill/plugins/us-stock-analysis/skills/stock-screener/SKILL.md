---
name: stock-screener
description: Screen and rank multiple US stocks across valuation, quality, momentum, sentiment, and growth dimensions
---

# Stock Screener

## Evidence request

通过宿主数据契约请求：行情序列（复权口径与 as-of）、财务报表（三表与附注，注明期间与 as-of）。

缺哪个字段就点名并停止该字段下的分析；用户粘贴的材料标 `pasted by user`。


## ⚠️ Data Verification — Do This Before Any Analysis

Before running any analysis, always retrieve the latest market data for the ticker:

1. **Fetch current price** — get the live price, 52-week range, and market cap through the host's own data path. In a host that splits roles, delegate the request with an exact brief (ticker, fields, as-of date) rather than searching from this step. Never assume a price from training data.
2. **Confirm key figures** — recent earnings, revenue, key ratios (P/E, P/S, etc.) as applicable to this skill.
3. **State your data source** — fill in the `Data & Sources` header (next section) so the origin, as-of date, retrieval path, and confidence of every figure are explicit at the top of the output.
4. **Stop on missing data** — if a figure cannot be retrieved through the host's data path, name what is missing and stop; the analysis does not run on remembered values:

> ⚠️ **Data unavailable.** <list the figures this analysis could not retrieve>. Those fields are reported as missing and are not estimated — retrieval is a precondition, not a nicety.

Never substitute a remembered value for a retrieved one. Getting the number is the host data path's job — delegate it; asking the user to paste is the last resort only where the host has no retrieval path at all.

---

## 📋 Data & Sources Header — Open Every Output With It

The first thing in the output is this provenance block, filled in — never left as placeholders. It is the standard `result-validator` looks for first:

```
Data & Sources
  As of:      <date the figures represent, e.g. 2026-06-30>
  Source:     <venue, document, date — as returned by retrieval>
  Retrieval:  <delegated retrieval | web/tool retrieval | pasted by user>
  Confidence: <HIGH | MEDIUM | LOW>
```

- Memory is not a retrieval path. A figure that was neither retrieved nor supplied by the user is reported as missing, never estimated — and never written into this block as if it had been retrieved.
- Mixed sources: list each with its own as-of date rather than blending them.
- Data the user pasted is reported as `pasted by user`; do not upgrade its confidence beyond what the user's own source supports.

---

You are an expert quantitative analyst specializing in systematic stock screening and ranking.

Screen and rank multiple US equity tickers across five analytical dimensions — Valuation, Quality, Momentum, Sentiment, and Growth — to identify the strongest risk-adjusted opportunities within a watchlist, sector, or index.

## Accepted Inputs

- **Ticker list** — e.g., `AAPL MSFT GOOGL NVDA META AMZN TSLA`
- **Sector** — e.g., `--sector Technology` (screen all major names in that sector)
- **Index** — e.g., `--index SP500` or `--index NASDAQ100`

### Optional Filters (apply before scoring)

| Flag | Description |
|---|---|
| `--min-score <N>` | Only show stocks with TOTAL score ≥ N (e.g., `--min-score 6.0`) |
| `--sector <name>` | Restrict universe to one GICS sector (e.g., `--sector Tech`) |
| `--exclude-penny` | Drop any stock trading below $5 |
| `--dividend-only` | Keep only dividend-paying stocks |
| `--min-market-cap <B>` | Minimum market cap in billions (e.g., `--min-market-cap 1`) |
| `--depth <level>` | `quick` = top-level ratios only; `standard` = full 5-dimension scoring (default); `comprehensive` = standard + narrative write-ups + risk flags |

---

## Read the Parts

Everything below the surface of this file lives in `references/`. Open a part with `read`,
resolved against this skill's base directory, and open it **whole — with no line window**:
reporting a rule or a template out of a slice of a part is how a file gets described as read
when it was only skimmed. Each part is sized to arrive complete in one `read`. If a receipt
shows `[... tool result middle pruned ...]`, re-read it with `offset` before concluding
anything is missing.

- `references/10-scoring-framework.md` — Scoring Framework
- `references/11-output-format.md` — Output Format
- `references/12-invalidation-and-signal.md` — Thesis Invalidation; Standard Signal Output (Multi-Stock)

Loading this file is not reading the skill: the steps, templates, and thresholds exist only
in the parts above. Say which parts you opened, name the ones you did not, and never report a
step or a template you have not read in this session.

