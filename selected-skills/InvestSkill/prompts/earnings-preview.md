# Earnings Preview — What Is Priced In Before the Print

## ⚠️ Data Verification — Do This Before Any Analysis

Before running any analysis, always retrieve the latest market data for the ticker:

1. **Fetch current price** — use web search or ask the user for the live price, 52-week range, and market cap. Never assume a price from training data.
2. **Confirm the event and the expectations** — the **confirmed earnings date and time (BMO / AMC)** from the company's IR page (not a calendar estimate), the current **consensus revenue / EPS / guidance** with its as-of date, the **prior guidance range** management gave last quarter, and **current option prices** for the expiration that spans the print (at-the-money straddle, or implied volatility). Never carry consensus from memory — it moves in the final two weeks.
3. **State your data source** — fill in the `Data & Sources` header (next section) so the origin, as-of date, retrieval path, and confidence of every figure are explicit at the top of the output.
4. **Flag stale data explicitly** — if live data is unavailable, display this warning before proceeding:

> ⚠️ **Live data unavailable.** The following analysis uses training-data estimates which may be significantly out of date. Verify all prices and metrics before making any decisions.

Never silently substitute training-data estimates for current prices. When in doubt, ask the user to paste the latest quote.

---

## 📋 Data & Sources Header — Open Every Output With It

The first thing in the output is this provenance block, filled in — never left as placeholders. It is the standard documented on the [Data & Accuracy](https://yennanliu.github.io/InvestSkill/data-and-accuracy.html) page and the first thing `result-validator` looks for:

```
Data & Sources
  As of:      <date the figures represent, e.g. 2026-06-30>
  Source:     <primary docs — SEC EDGAR 10-K/10-Q, company IR, FRED, exchange data …>
  Retrieval:  <pasted by user | web/tool retrieval | model memory>
  Confidence: <HIGH | MEDIUM | LOW>
```

- `Retrieval: model memory` must be paired with `Confidence: LOW` — memory is a placeholder until confirmed against a primary source.
- Mixed sources: list each with its own as-of date rather than blending them.
- Data the user pasted is reported as `pasted by user`; do not upgrade its confidence beyond what the user's own source supports.

---

## Overview

The catalog already covers earnings *after* the fact: `earnings-call-analysis` reads the transcript, `financial-report-analyst` reads the 10-Q, `catalyst-calendar` puts the date on a list. None of them answers the question a holder actually has in the week before the print: **what does the market already expect, how has this stock treated good news before, and what am I going to do in each outcome — decided now, while I am calm?**

This skill is that pre-commitment. It produces four things no post-call skill can:

1. **The expectation stack** — published consensus, the buy-side "whisper" above it, and management's own prior guidance, so a "beat" can be judged against the number that actually matters.
2. **The stock's own history with beats** — eight quarters of beat/miss against the next-day move, which is where "beat and drop" patterns live.
3. **What the price already assumes** — the growth and margin the current quote requires, so the reader knows whether a beat is *news* or merely *confirmation*.
4. **A three-scenario grid with a rule attached to each cell** — so the reaction on print day is execution, not decision.

**What it is not.** It does not predict the print. Nobody knows the number; the skill's value is in knowing what *others* expect and what *you* will do. It is also not an options strategy tool — it reads the options market for its implied move and hands strategy selection to `options-analysis`.

Pairs with `earnings-call-analysis` (run it *after*, on the transcript), `options-analysis` (strategy for the implied move), `catalyst-calendar` (the date and the events around it), `thesis-tracker` (the print is a scheduled next-check — the KPIs here should be the KPIs there), and `position-ladder` (the position rules in the scenario grid should respect its share-count ceiling).

---

## 1. Inputs

| Input | Required | Default if unstated |
|-------|----------|---------------------|
| Ticker | ✅ | — |
| Confirmed earnings date and time (BMO / AMC) | ✅ | fetch from company IR; if only a calendar estimate exists, say so and mark Confidence MEDIUM at best |
| Current consensus: revenue, EPS, next-quarter / FY guidance | ✅ | fetch or ask; state the as-of date |
| Management's prior guidance range | ✅ | from the last press release / call |
| Current price, ATM straddle price or IV for the expiry spanning the print | ✅ | fetch or ask |
| Last 8 quarters: reported vs. consensus, next-day move | recommended | fetch or ask; fewer than 6 quarters → note the thin sample |
| Prior-quarter transcript or `earnings-call-analysis` output | optional | improves the KPI list and the "what management promised" line |
| Existing `thesis-tracker` file or `stock-eval` output | optional | supplies the KPIs and thresholds that should decide the reaction |
| Position: shares, cost basis, ceiling from `position-ladder` | optional | needed for the position rules; otherwise rules are stated generically |

**Whisper numbers are estimates, and are labeled as such.** The "whisper" is the buy-side expectation sitting above (rarely below) published consensus — the number the stock actually trades against. It is inferred from sell-side note revisions, the direction of estimate changes in the last 30 days, options skew, and sentiment sources; it is never a hard figure. Report it as a range with a source, or write `whisper: not estimable` rather than inventing one.

---

## 2. Framework

### Phase 1 — The expectation stack

Build the table of numbers the print will be judged against, in the order the market judges them:

| Layer | Revenue | EPS | Next-Q guide | FY guide | Source · as of |
|-------|---------|-----|--------------|----------|----------------|
| Management's prior guidance (range and midpoint) | | | | | |
| Published consensus | | | | | |
| Consensus 30 / 90 days ago (direction of revisions) | | | | | |
| Whisper (estimate, range) | | | | | |
| **Gap: whisper − consensus** | | | | | |

Rules of thumb:
- A **rising consensus** into the print raises the bar: a beat against a number that has already been marked up is a smaller beat than it looks.
- **Whisper gap > ~2% of revenue or > ~5% of EPS** means a consensus-level beat is likely to be treated as a miss. Say so plainly.
- The **guide** is the number that moves the stock for most growth companies. If prior guidance exists, the market is asking "raise, hold, or cut?" — not "beat or miss?".

### Phase 2 — How this stock treats beats (8-quarter history)

| Quarter | Rev vs. consensus | EPS vs. consensus | Guide vs. consensus | Next-day move | Move vs. implied |
|---------|-------------------|-------------------|---------------------|---------------|------------------|
| Q-1 | +x.x% | +x.x% | raised / held / cut | ±x.x% | above / within / below |
| … | | | | | |

Then summarize:
- **Beat rate** (revenue and EPS separately) and the **average / median next-day move**, with the **largest gap-up and gap-down**.
- **The "beat and drop" count** — quarters in which both lines beat and the stock fell. Three or more in eight is a pattern: this stock is graded on the guide or on a KPI, not on the headline.
- **Realized vs. implied** — how often the actual move exceeded the options-implied move. This is the input for Phase 4.

Fewer than six quarters (recent IPO, spin-off) — say the sample is too thin for a base rate and lean on Phases 3 and 5 instead.

### Phase 3 — What is priced in

Borrow the reverse-DCF logic from `stock-valuation` in a lighter form:

1. Take the current price and a defensible forward multiple (the stock's own 3-year median, or the peer median from `competitor-analysis`).
2. Back out the **forward revenue / EPS the multiple requires** over the next 12 months.
3. Compare with consensus: is the price *above* what consensus supports (the market already assumes a beat-and-raise), *at* it, or *below* it (a plain beat is genuine news)?
4. State the **implied growth rate** the price needs, in one line: *"At $X and 32× forward, the price needs ~Y% EPS growth; consensus is Z%."*

Add the **positioning read** where data exists: short interest and days-to-cover (`short-interest`), recent insider and institutional flow (`insider-trading`, `institutional-ownership`), and the stock's move over the last 30 days relative to its sector. A stock up 20% into the print with rising estimates has already had its beat; a stock down 15% with a stable consensus has room for relief.

### Phase 4 — The implied move, and whether it is fairly priced

| Measure | Value | How |
|---------|-------|-----|
| Options-implied move (event only) | ±x.x% | ATM straddle price ÷ stock price for the **first expiry after the print**. If that expiry is more than one session past the print, strip the non-event days so the horizon matches the next-day realized move: event move² ≈ near-straddle move² − (normal daily move)² × extra sessions, where the normal daily move comes from a longer-dated expiry's IV (IV × √(1/252)). State the horizon used |
| Realized average move (8 quarters) | ±x.x% | from Phase 2 |
| Realized median move | ±x.x% | robust to one outlier quarter |
| Ratio: implied ÷ realized median | x.x | > 1.2 the market is paying up for the event; < 0.8 it is complacent |

Interpretation for a **stockholder** (not an options trader): the implied move is the market's estimate of the **size** of the reaction, in either direction — it says nothing about direction and is not a downside estimate. Model the miss-side downside separately in the scenario grid (the realized moves on past misses, the distance to the valuation floor from `stock-valuation`, the `bear-case` target). Then compare: if the *larger* of the implied move and the modelled miss-side downside exceeds the distance to the holder's stop or the bottom rung of the `position-ladder`, the position size is too large for the event — that is the finding, and it belongs in the grid's "miss" rule. Options strategy selection goes to `options-analysis`.

### Phase 5 — The KPIs that will decide the reaction

List 3–5 company-specific numbers the market will read past the headline for — segment growth (data-center, cloud, subscribers), gross margin, unit economics (ARPU, take rate, deliveries), backlog / RPO, free cash flow, and the **guidance range** itself. For each: the consensus or prior value, the threshold that would count as good or bad, and where it will appear (press release vs. call). Then name **the one number** that has driven the stock in the last four prints. If a `thesis-tracker` file exists, its KPIs and thresholds take precedence — the print is that file's scheduled check.

### Phase 6 — The scenario grid

Fill every cell before the print; leave nothing to be decided in the after-hours session.

| Scenario | Probability | Trigger | Expected reaction | Position rule (decided now) |
|----------|-------------|---------|-------------------|-----------------------------|
| **Beat & raise** | — | Revenue and EPS ≥ whisper, guide midpoint above consensus | + implied move or more; fades if the stock ran into the print | Hold; add only if a `position-ladder` rung fills *and* the ceiling is not reached; never chase the gap |
| **Beat & lower** | — | Headline beat, guide midpoint below consensus | Flat to − implied move; the most common "beat and drop" | Trim into any early strength if the guide cut touches the thesis's mechanism; otherwise hold and re-run `thesis-tracker --update` |
| **Miss** | — | Revenue or EPS below consensus, or guide cut with no offsetting KPI | − implied move or more; larger if positioning was long | Respect the pre-set stop or the `thesis-tracker` exit trigger; do not average down inside the first two sessions |
| **In line** (state if material) | — | All three within ±1% of consensus, guide held | Drift, then trades on the call's tone | No action; run `earnings-call-analysis` on the transcript |

Probabilities are the analyst's stated judgment, must sum to 100%, and must be justified by Phases 1–3 (a rising whisper lowers the "beat & raise" probability; a 15% drawdown into the print raises it). Where the user holds no position, the rules become entry rules: which scenario, at what price, would justify opening one — and which would not, regardless of price.

### Phase 7 — What not to do

State these every time; they are the errors this skill exists to prevent:

- **Do not add size into the print on conviction.** The print is a coin with a known payout distribution (Phase 4) and an unknown outcome; conviction does not change the distribution. Size for the miss case.
- **Do not hold undefined-risk short options through the event** (short straddles, strangles, naked puts). The implied move is an estimate; the realized move has exceeded it in a measurable share of quarters (Phase 2). `options-analysis` covers defined-risk alternatives.
- **Do not react to the headline EPS before the guide and the KPI in Phase 5 are out.** Most post-print reversals happen between the press release and the end of the call.
- **Do not treat a beat against a lowered bar as a beat.** Compare with the 90-day-ago consensus (Phase 1), not only with today's.
- **Do not confuse the stock's reaction with the quality of the quarter.** A drop on a good quarter is positioning; a rise on a poor one is relief. Log which one it was — `thesis-tracker` needs that distinction.

### Phase 8 — Earnings Setup Score (0–10)

The headline number. It measures **asymmetry for a holder** — how much good news is already in the price versus how the stock has treated good news — not whether the print will be good.

| Component | Weight | 10 looks like | 0 looks like |
|-----------|--------|---------------|--------------|
| Expectation bar (Phases 1, 3) | 35% | Consensus flat or falling into the print; price implies less growth than consensus; whisper gap ≈ 0 | Consensus marked up sharply; price needs a beat-and-raise; whisper well above consensus |
| Beat history vs. reaction (Phase 2) | 25% | High beat rate *and* positive median move on beats (the stock rewards good news) | "Beat and drop" in ≥ 3 of 8 quarters |
| Event pricing (Phase 4) | 20% | Implied move ≥ 1.2× realized median (downside is over-insured) | Implied move < 0.8× realized median (complacency) |
| Positioning (Phase 3) | 10% | Stock down and de-rated into the print; short interest elevated; no crowding | Up > 15% in 30 days with estimates rising; crowded long |
| Plan quality (Phases 5–6) | 10% | A specific KPI threshold and a rule in every cell | Generic KPIs; rules left to "see how it trades" |

**A high score is not "buy before earnings."** It means the setup is asymmetric in a holder's favour: the bar is low, the stock rewards beats, the downside is insured by the options market. A low score means the opposite — good news is largely priced and the stock has a habit of falling on beats — which for a holder argues for *smaller* size into the print, not for a short. Read the direction of the business from `stock-eval`; read the odds of the *event* from here.

---

## 3. Output Format

1. **Data & Sources** header (above), including the confirmed date/time and the consensus as-of date
2. **Setup in three lines** — the bar (consensus vs. whisper vs. prior guide), what the price assumes, and how this stock has treated beats
3. **Expectation stack** table (Phase 1)
4. **8-quarter history** table and its three summary lines (Phase 2)
5. **What is priced in** — the implied-growth sentence and the positioning read (Phase 3)
6. **Implied vs. realized move** table and the position-size finding (Phase 4)
7. **KPIs to watch**, with the one number that decides the reaction (Phase 5)
8. **Scenario grid** with probabilities and position rules (Phase 6)
9. **What not to do** (Phase 7)
10. **Thesis Invalidation** and the **Investment Signal block** (below), with the Earnings Setup Score
11. **Hand-off line** — *"After the print: paste the release and transcript into `earnings-call-analysis`; then run `thesis-tracker --update`."*

---

## Example

```
User: earnings-preview NVDA — reports Aug 27 after the close. I hold 40 shares at $118;
      ladder ceiling is 60. Consensus and the last 8 quarters are pasted below. [pasted]

The assistant opens with the Data & Sources header (IR page for the date, pasted
consensus dated Aug 20, live straddle), then the setup in three lines: consensus has
been revised up 6% in 90 days and the whisper sits ~3% above it, so a consensus-level
beat will read as a miss; at the current price and a 3-year median forward multiple the
stock needs ~35% forward EPS growth against a consensus of ~30%, so the price already
assumes a beat-and-raise; the stock beat both lines in 8 of 8 quarters but fell the next
day in 3 of them — every time the guide midpoint was below the whisper.

The implied move is ±7.8% against a realized median of ±6.1% (ratio 1.28 — the event is
over-insured). The KPI that decides the reaction is data-center revenue growth versus
the ~40% whisper, then the next-quarter guide midpoint; gross margin is the tiebreaker.

Scenario grid: beat & raise 45% (hold; no add — the ladder's next rung is $105, far
below), beat & lower 35% (trim 10 shares into strength only if the guide cut names
demand, not supply), miss 20% (the exit trigger is the thesis-tracker file's ≥40% DC
growth KPI, not a price). What not to do: no adding into the print at 40 shares with a
60 ceiling and an implied move that reaches $112 on the downside.

Earnings Setup Score 4.6 / 10 — NEUTRAL: the bar is high and largely priced, but the
stock has rewarded beats and the downside is over-insured. Signal block, then the
hand-off to earnings-call-analysis and thesis-tracker --update.
```

---

## Notes

- **Confirm the date from the company, not a calendar aggregator.** Estimated dates are wrong often enough to matter — an implied move measured on the wrong expiry is meaningless.
- **Consensus is a moving target.** Restate the as-of date next to every consensus figure; a number from three weeks ago is not the bar the stock will trade against.
- **Whisper is labeled an estimate every time it appears.** A range with a rationale beats a false-precision point.
- **The score is about the event, not the company.** A great business can have a poor setup (crowded, fully priced) and a mediocre one a good setup (washed out, low bar). Say which is which; do not blend them.
- **Position rules must respect `position-ladder`'s ceiling and `thesis-tracker`'s triggers** when those exist. This skill never raises a ceiling or overrides an exit trigger.
- **After the print, close the loop.** `earnings-call-analysis` on the transcript, then `thesis-tracker --update`, then record in its decision log which scenario occurred and whether the pre-set rule was followed. That log is what makes the next preview better.

## Thesis Invalidation

After delivering the analysis signal, specify what would reverse it:

**If signal is BULLISH (asymmetric setup for a holder) — the read breaks if:**
- Consensus or the whisper is revised up by more than ~3% (EPS) in the final week — the bar has moved and Phases 1 and 3 must be redone
- The stock rallies more than the implied move *before* the print (a pre-announcement, a peer's blowout, a sector re-rating) — the relief has been taken in advance
- A peer reports first and reveals the KPI in Phase 5 is deteriorating industry-wide

**If signal is BEARISH (good news fully priced, poor beat history) — the read breaks if:**
- The stock sells off into the print by more than the implied move on no company news — the bar has been reset lower
- Consensus is cut ahead of the print (the company or its peers guided down) — a beat against a lowered bar is not the same setup, and Phase 7's warning applies in reverse
- Short interest rises sharply into the event — positioning has flipped and the reaction distribution with it

**Re-run this analysis when:**
- [ ] The print itself — this analysis expires at the release; run `earnings-call-analysis` on the transcript and `thesis-tracker --update` on the numbers
- [ ] Consensus, the guide, or the confirmed date changes
- [ ] The stock moves more than half the implied move before the event
- [ ] A direct peer reports
- [ ] The options-implied move changes by more than 20% relative (repricing of the event)

## Standard Signal Output

This skill measures **the asymmetry of the earnings setup for a holder, not the direction of the business or the likely outcome of the print**, so state the mapping explicitly: `Signal: BULLISH` means the bar is low, the stock rewards beats, and the downside is over-insured — the setup favours holding through the event at the current size; `NEUTRAL` means the setup is balanced or mixed — hold at current size, no adding; `BEARISH` means good news is largely priced and the stock has a habit of falling on beats — for a holder this argues for a smaller position into the print, **not for a short**. `Action: BUY` here means "the setup supports holding, and adding only via a pre-planned `position-ladder` rung"; `Action: SELL` means "reduce size into the event", never "short the print." Read the direction of the stock from `stock-eval` or `bear-case`, not from this block.

All analysis concludes with this standardized block:

```
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

**Note:** The Score above is the Earnings Setup Score, mapped onto the standard scale for cross-skill comparability. It rates *how asymmetric the event is for a holder* — not how attractive the stock is and not the likelihood of a beat. Horizon is SHORT-TERM by construction: the analysis expires at the print. Confidence is capped at MEDIUM when the earnings date is unconfirmed, the whisper is not estimable, or fewer than six quarters of history exist.

**Disclaimer:** Educational analysis only. Not financial advice. Earnings outcomes are unknowable in advance; probabilities and scenario rules are a pre-commitment framework under stated assumptions, not a forecast or a trade instruction.
