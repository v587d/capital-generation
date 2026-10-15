# 5. Scoring — Tax Efficiency Score (0–10)

Part 4 of 5 for `tax-lens` — 5. Scoring — Tax Efficiency Score (0–10); 6. Output Format; Example; Notes
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## 5. Scoring — Tax Efficiency Score (0–10)

The headline number measures **how tax-efficient the trade or portfolio is as specified**, not whether the investment is good.

| Component | Weight | 10 looks like | 0 looks like |
|-----------|--------|---------------|--------------|
| Character & timing | 30% | Gains long-term, losses short-term; no lot turns long-term within 60 days of a proposed short-term sale | Large short-term gains realized days before turning long-term |
| Wash-sale hygiene | 20% | No purchases in the 61-day window across any account | A harvested loss disallowed by a DRIP or IRA repurchase |
| Lot selection | 15% | Specific-ID chosen and designated | FIFO by default on a partial sale of a long-held winner |
| Account placement | 15% | Every holding in the right column | Bond funds and REITs in taxable, growth in traditional IRA |
| Harvest capture | 10% | Material losses harvested into non-identical replacements | Losses left on the table in a high-gain year |
| Drag & paperwork | 10% | Drag below ~0.5% / yr; W-8BEN current and treaty claimed (non-US) | Drag > 1.5% / yr; expired W-8BEN, statutory withholding, unaddressed estate exposure |

In `--non-us` mode, replace "Harvest capture" with **Estate-tax exposure** (10 looks like: US-situs holdings below the exemption or moved to non-US-domiciled funds; 0: a large US-situs portfolio with no plan).

---

## 6. Output Format

1. **Not-tax-advice banner** (verbatim, first line)
2. `Data & Sources` header — including the tax year and rule sources
3. **Executive summary** — three sentences: the tax cost of the action as specified, the cheapest alternative, and the one thing to confirm with a professional
4. **Lot table** (Trade / Position / Portfolio) — lot · shares · basis · gain/loss · character · days to long-term · recommended?
5. **Wash-sale timeline** — 61-day window with every purchase marked
6. **Dividend test** — ex-dates, holding-period pass/fail, after-tax yield (or after-withholding yield in `--non-us`)
7. **Alternatives table** — "as specified" vs. "wait N days" vs. "specific lots" vs. "harvest & replace", each with estimated tax and market-risk trade-off
8. **Placement & drag** (Portfolio mode) — misplaced holdings, drag before / after
9. **`--non-us` block** — W-8BEN status, treaty or no-treaty rate, capital-gains treatment with exceptions, estate-tax exposure, UCITS comparison
10. **Thesis Invalidation** — what would change this analysis (below)
11. **Investment Signal block** — the standard box (below)
12. **Not-tax-advice banner** (verbatim, last line)

---

## Example

```
User: tax-lens AVGO — I hold 20 sh bought 2026-05-30 @ $128 (taxable) and 10 sh bought
      2025-08-14 @ $96. Price $122. I want to sell 15 shares and rebuy lower with the
      position-ladder plan. 24% bracket, single, DRIP is on.

The assistant opens with the not-tax-advice banner and a Data & Sources header (tax year 2026,
IRS Pub 550, prices pasted by user). Lot table: the 2026 lot shows a $6/sh short-term loss;
the 2025 lot a $26/sh long-term gain that has already passed one year. Selling 15 from the
2026 lot by specific identification realizes a $90 short-term loss; FIFO would instead sell
the 10 long-term gain shares first (+$260 gain, ~$39 tax at 15%) plus 5 loss shares. The
wash-sale timeline flags two problems: DRIP reinvested a dividend on 2026-06-30 (inside the
window — part of the loss is disallowed and added to those shares' basis) and every
position-ladder rung inside the next 30 days would wash the rest. Alternatives: turn DRIP
off and place the first rung on day 31; or accept the wash (the loss moves into the basis of
the re-bought shares and is not lost, only deferred). Tax Efficiency Score 4.5 → NEUTRAL:
the plan is fine once the DRIP and rung timing are fixed. Closes with the banner.

User: tax-lens --non-us Taiwan — I hold $180k of VOO and $40k of AAPL at a US broker,
      W-8BEN signed 2023.

The assistant states that Taiwan has no US income-tax treaty, so dividends are withheld at 30%
(VOO's ~1.3% gross yield → ~0.9% net); the W-8BEN signed in 2023 expires at the end of 2026
and must be renewed or withholding may rise further; US capital gains are generally not taxed
by the US for a non-resident (conditions and exceptions stated) but Taiwan's own rules apply;
US-situs assets total $220k, $160k above the $60k exemption — an illustrative estate-tax
exposure it quantifies at the statutory brackets — and shows the Irish-UCITS comparison for
the VOO sleeve (15% fund-level withholding, no US estate exposure, ~0.03–0.05% higher TER).
Score 3.5 → BEARISH on tax efficiency as held; the investment view is unchanged. Recommends a
cross-border professional for the estate question. Closes with the banner.
```

---

## Notes

- **Rules move.** Brackets and thresholds are indexed annually; the wash-sale rule, the qualified-dividend test, and the treatment of non-resident capital gains have all been the subject of proposals. State the tax year, cite the publication, and tell the user to confirm.
- **Never compute a liability to be relied upon.** Show the mechanics on the user's numbers as an illustration and label it as such.
- **Out of scope, always flagged**: state income tax, AMT, employer equity (ISO/ESPP/RSU) beyond identifying it, trusts and entities, the home-country side of `--non-us`, and gifting/inheritance planning.
- **Pairs with**: `position-ladder` (rung timing vs. the wash window; the ceiling vs. concentration of embedded gains), `portfolio-review` (placement), `dividend-analysis` (gross yield in, after-tax yield out), `etf-analysis` (US vs. UCITS fund comparison), `risk-stress-test` (what a forced de-risking would realize).
- **For the zh-TW audience**: Taiwan has no US income-tax or estate-tax treaty; the 30% withholding, the $60,000 estate exemption, and the UCITS route are the three facts that change the arithmetic most. Home-country reporting of overseas income is a Taiwan tax question this skill does not answer.


