# 3. Framework — US mode(continued)

Part 2 of 5 for `tax-lens` — 3. Framework — US mode
See `SKILL.md` for what to read and when; this part is procedure, not routing.

### Phase 3 — Dividends: qualified or not

| Question | General rule |
|----------|--------------|
| Is the payer eligible? | US corporations and qualified foreign corporations — yes. REITs, most MLPs, money-market and bond-fund income — generally **not** qualified (REIT ordinary dividends may qualify for a separate 20% deduction instead) |
| Did the holder meet the holding period? | The stock must be held **more than 60 days during the 121-day period that begins 60 days before the ex-dividend date**. Hedged shares (deep puts, short calls) can fail the test |
| What is the consequence? | Qualified → long-term capital-gains rates. Not qualified → ordinary income |

For a dividend payer, show the ex-dividend dates in the period, whether each lot passes the test, and the after-tax yield at the user's bracket — that is the number `dividend-analysis` cannot give.

### Phase 4 — Which lot to sell

| Method | When it helps | Caveat |
|--------|---------------|--------|
| **Specific identification** | Almost always — choose the lot that produces the character and size of gain/loss you want | Must be designated **at or before the trade**, in the form the broker accepts; a retroactive choice is not allowed |
| FIFO (default at most brokers) | Long-held, low-basis lots first — largest gains | Often the worst choice for a partial sale in a rising stock |
| Highest cost first (HIFO) | Minimizes the current gain or maximizes the harvested loss | May realize short-term gains; check character, not just size |
| Lowest cost first | Deliberately realizing gains in a 0% bracket year, or before a rate change | Rare, but real |

Produce the lot table: lot · shares · basis · gain/loss · character · days to long-term · **recommended for this trade?** — and the total tax at the user's bracket under FIFO vs. the recommended specific lots.

### Phase 5 — Tax-loss harvesting pairs

For every lot with an unrealized loss above a materiality floor (state it, e.g. the larger of $500 or 5% of the lot):

- **Value of the harvest** = loss × the rate it offsets (short-term losses are worth more when they offset short-term gains or ordinary income).
- **Replacement**: name a *similar-but-not-substantially-identical* holding that keeps the exposure for the 31 days (a different index or a peer, never the same ticker or an option on it). Say what the tracking difference costs.
- **The reversal**: after 31 days, whether to swap back (a new taxable event) or keep the replacement.
- **Basis reset warning**: harvesting lowers basis — the tax is deferred, not eliminated, unless the position is held until a step-up or a donation.

### Phase 6 — Account placement

General placement logic, shown as a table of the user's holdings:

| Asset behaviour | Taxable account | Tax-deferred (traditional IRA / 401(k)) | Tax-free (Roth) |
|-----------------|-----------------|------------------------------------------|-----------------|
| Broad, low-turnover equity index; individual stocks held long | ✅ best — long-term rates, harvesting possible, step-up | fine | fine |
| Bonds, REITs, high-yield, high-turnover active funds | ✗ ordinary income every year | ✅ | ✅ |
| Highest expected growth | ok | ok | ✅ best — growth never taxed |
| Foreign equity funds with withholding | ✅ (the foreign tax credit is only available here) | ✗ credit lost | ✗ credit lost |

Flag every holding sitting in the wrong column and estimate the annual cost of leaving it there.

### Phase 7 — Annual tax drag

```
Tax drag (% of portfolio per year) ≈
    Σ weight_i × [ yield_i × ( qualified_i × LTCG rate + (1 − qualified_i) × ordinary rate ) ]
  + realized-gain turnover × blended gain rate
  + non-qualified income (bond interest, REIT) × ordinary rate

Scope — the terms are disjoint: yield_i is the dividend yield of the *equity* holdings only
(stocks and equity funds), split into its qualified and non-qualified parts; the third line
covers income that is never a qualified dividend (bond and money-market interest, REIT and
MLP distributions), so it is not counted in yield_i as well.
```

Report the drag in percentage points and dollars, the three largest contributors, and the drag after the Phase 5–6 changes. State the assumed rates in the table, not in prose.

---


