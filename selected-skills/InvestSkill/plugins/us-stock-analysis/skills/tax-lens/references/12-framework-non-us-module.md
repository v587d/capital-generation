# 4. Framework — `--non-us` module (non-resident alien holding US stocks)

Part 3 of 5 for `tax-lens` — 4. Framework — `--non-us` module (non-resident alien holding US stocks)
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## 4. Framework — `--non-us` module (non-resident alien holding US stocks)

The mechanics below describe the **US side only**. The investor's country of residence taxes the same income under its own rules, and that is out of scope — say so in the output.

### Phase 1 — Status and paperwork

- **W-8BEN** certifies non-US status and claims any treaty rate. It is generally valid until the end of the **third calendar year** after signing; an expired form means the broker withholds at the statutory rate (and may apply backup withholding). Output: on file? expiry year? treaty article claimed?
- **Form 1042-S** is the year-end statement of US-source income and tax withheld — the document to reconcile against, and often the one the home-country return needs.
- If the user says they are a US citizen or green-card holder living abroad, **stop the `--non-us` module**: they are taxed as US persons worldwide, and non-US funds (UCITS) raise PFIC issues for them. Point back to US mode.

### Phase 2 — Dividends: withholding and the treaty rate

| Item | General rule | Output |
|------|--------------|--------|
| Statutory withholding on US-source dividends | **30%**, withheld by the broker or paying agent at source | Effective yield after withholding |
| Treaty rate | Reduced (commonly 15%, some treaties 10% or lower) **only** if the residence country has an income-tax treaty with the US and a valid W-8BEN claims it | Name the treaty and the article, or state clearly that **no treaty exists** (for example Taiwan, Hong Kong, Singapore have no US income-tax treaty, so 30% applies) |
| Fund distributions | Ordinary dividends withheld as above; the treatment of short-term / long-term capital-gain and return-of-capital distributions differs — reconcile against the 1042-S rather than assume | Flag distribution types |
| Interest | Portfolio interest (Treasuries, most corporate bonds) is generally **exempt** from US withholding | Note where relevant |
| Derivatives on US equities | Dividend-equivalent payments on certain swaps and deep-in-the-money options can be withheld as if dividends (Section 871(m)) | Flag if the user trades options on dividend payers |

**After-withholding yield** is the headline number: a 3.0% dividend yield is 2.1% to a no-treaty holder and 2.55% at a 15% treaty rate. `dividend-analysis` reports the gross figure; this section converts it.

### Phase 3 — Capital gains

US capital gains on stocks are **generally not taxed by the US** for a non-resident alien. State the general conditions and the exceptions rather than a blanket promise:

- The general exemption applies when the individual is **not present in the US for 183 days or more** in the tax year and the gain is not effectively connected with a US trade or business. The day count is an input, not an assumption — if the user has not supplied it, state the treatment as **indeterminate** and show both outcomes.
- **Exceptions**: gains effectively connected with a US business; gains on **US real property interests** (including certain REITs) under FIRPTA, which are taxed and often withheld; and any home-country tax on the same gain, which is the rule that actually matters for most investors.
- Losses cannot be used against US tax the investor does not owe — the harvesting logic of US mode is **irrelevant** here except for the home-country return. Say so; do not port Phase 5 across.

### Phase 4 — US estate-tax exposure

This is the item most non-US investors have never heard of, and the one with the largest tail:

- US-situs assets of a non-resident alien — **US-domiciled stocks and US-domiciled ETFs** count; US Treasury bonds, bank deposits, and shares of non-US companies (including ADRs of foreign issuers) generally do not — are subject to US estate tax above an exemption of only **$60,000** (not the multi-million exemption US persons have), at rates that reach **40%**, unless an estate-tax treaty provides otherwise (only a minority of countries have one; Taiwan, Hong Kong, and Singapore do not).
- Output: the user's US-situs total today, the excess over $60,000, an illustrative exposure at the statutory brackets, and the two standard mitigations — holding the same exposure through **non-US-domiciled funds** (Phase 5) or estate planning structures that are entirely a professional's domain.
- Brokers may freeze the account pending a US estate-tax clearance; mention it as a practical consequence, not as advice.

### Phase 5 — Irish-domiciled UCITS alternatives

The common route for non-US investors, with an honest cost/benefit table:

| Dimension | US-domiciled ETF (e.g. an S&P 500 ETF listed in New York) | Irish-domiciled UCITS ETF (same index, listed in London / Amsterdam / Frankfurt) |
|-----------|------------------------------------------------------------|-----------------------------------------------------------------------------------|
| Dividend withholding | 30% (or treaty rate) at the investor level | **15% at the fund level** under the US–Ireland treaty; no further Irish withholding on distributions to non-Irish holders |
| Accumulating share class | Not available (US funds must distribute) | Available — reinvests inside the fund; whether the home country taxes the notional income is a **home-country** question |
| US estate tax | US-situs — exposed above $60,000 | **Not US-situs** — outside the US estate-tax net |
| Expense ratio and spread | Usually lower TER, tighter spreads, deepest liquidity | Typically a few basis points higher TER and wider spreads; some are large and liquid, many are not |
| Tracking | Benchmark | Slightly lower drag from the 15% fund-level withholding vs. 30% at investor level — for a no-treaty investor the UCITS fund often **wins after tax despite the higher TER** |
| Access | Any broker | Needs a broker with European exchange access; US brokers generally will not sell UCITS to anyone, and US persons should not buy them (PFIC) |

Show the arithmetic for the user's own case: gross yield → after-withholding yield under both routes → net of the TER difference → the estate-tax exposure difference. Hand the result to `etf-analysis` for the fund-level comparison.

---


