# 3. Output Format

Part 3 of 4 for `etf-analysis` — 3. Output Format; Example; Notes; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## 3. Output Format

```
Data & Sources · as of · issuer factsheet · fund prospectus · retrieval · confidence

1. Fund card          ticker · issuer · index tracked · inception · AUM · expense ratio · structure · domicile
2. Cost & tracking    expense ratio vs. category median · 1/3/5-yr tracking difference · tracking gap flag · spread · ADV
3. What you own       #holdings · top-10 weight · sector / factor / country / currency tilt · concentration flag
4. Overlap            % overlap by weight with the user's holdings · duplicated names · verdict (redundant / partial / complementary)
5. Distributions      trailing yield · composition (qualified / ordinary / ROC / gains) · capital-gains distributions (last 5 yrs) · tax form
6. Structure risks    leveraged / inverse / synthetic / ETN / single-stock / commodity / hedged / covered-call → warning box
7. Alternatives       2–3 peers in one table · "vs. top-5 holdings directly" table
8. ETF Fitness Score  0–10 with the six sub-scores and any cap that fired → Thesis Invalidation → signal block
```

When several tickers are given, produce sections 1–6 per fund compactly, then one comparison table, then one score per fund.

---

## Example

```
User: Is VOO or SPYM the better core holding? I already hold VTI at 40% of my portfolio.

The assistant builds the fund card for both (same index family — S&P 500 — so the
comparison collapses to cost, tracking, liquidity and share price), pulls the issuer
performance tables to compare 1/3/5-yr tracking difference against each fund's expense
ratio, notes that both are physical, distributing, 1099 funds with no capital-gains
distributions in the record supplied, and that either is liquid enough for any retail
order with a limit. Then it runs the overlap check against VTI: an S&P 500 fund is
roughly four-fifths of a total-US-market fund by weight, so the overlap is high and the
verdict is "redundant — you already own this exposure through VTI; adding either fund
raises large-cap concentration without adding a new bet." Both funds score well on
fitness in isolation; the report's headline is the overlap finding, and the suggested
next step is `portfolio-review` to decide whether the user actually wants *more* US
large cap, or `etf-analysis` on an international or small-cap fund instead.
```

---

## Notes

- **This is vehicle due diligence, not a market view.** Do not score the asset class. A perfectly built fund on an exposure the user should not own still gets a high Fitness Score — pair with `sector-analysis` or `economics-analysis` for whether to own it, and `portfolio-review` for how much.
- **Never invent fund statistics.** Expense ratios, AUM, tracking figures, and holdings change; if the issuer page or factsheet was not retrieved or pasted, say "not verified" rather than recalling a number.
- **Read the index methodology.** Two funds with similar names can track very different indexes (screened vs. unscreened, capped vs. uncapped, quarterly vs. annual rebalancing). The methodology document, not the fund name, is the strategy.
- **Non-US investors** (including readers using the Traditional Chinese site): a US-domiciled ETF exposes a non-resident holder to 30% (or treaty-rate) withholding on distributions and to US estate-tax exposure above a low exemption; an Irish-domiciled UCITS equivalent typically suffers 15% withholding at the fund level and no US estate-tax exposure, at a somewhat higher expense ratio and, for accumulating share classes, no distributions at all. Name the UCITS equivalent when one exists and hand the arithmetic to `tax-lens --non-us`.
- **Overlap arithmetic depends on the data supplied.** Top-10-only overlap is a lower bound; label it. Full holdings files are downloadable from every major issuer.
- **Bond, commodity, and alternative ETFs** need the extra questions this skill only flags (duration, credit quality, roll yield, collateral). Say when the fund is outside the equity-index case this framework is built for.
- Pairs with: `portfolio-review` (allocation fit), `risk-stress-test` (drawdown behaviour), `tax-lens` (after-tax cost), `sector-analysis` / `stock-screener` (whether the exposure is worth owning at all).

## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH (the fund is a fit vehicle) — the verdict breaks if:**
- The tracking difference widens beyond −(expense ratio + 0.10%) in the next annual performance table — the fund has started leaking
- The issuer changes the index, raises the fee, lets a waiver expire, or announces a merger or liquidation (AUM falling below ~$50M is the early warning)
- The fund's concentration crosses the thresholds above (top-10 > 40%, single name > 10%) so that "broad" is no longer true
- The user's other holdings change such that the overlap verdict moves from complementary to redundant

**If signal is BEARISH (the fund is not a fit vehicle) — the verdict breaks if:**
- A fee cut or a fixed tracking gap removes the cost objection (re-run against the peers)
- The user's stated exposure changes so that the tilt this fund carries is now the intended bet
- The overlap objection disappears because the duplicated position is sold
- For a structure warning: the user's horizon and purpose genuinely match the product (a multi-day hedge with an inverse fund, for example) — the warning still prints, the cap may be lifted

**Re-run this analysis when:**
- [ ] The issuer publishes its annual performance / tracking table
- [ ] Any change to expense ratio, index, or fund structure is announced
- [ ] The user adds or removes a position large enough to change the overlap verdict
- [ ] AUM falls below $100M or the spread widens persistently
- [ ] 12 months have elapsed


