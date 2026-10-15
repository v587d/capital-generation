# Overview

Part 1 of 4 for `earnings-preview` — Overview; 1. Inputs; 2. Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

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


This section is not finished here: `2. Framework` continues in `references/11-phase-4-the-implied.md`.
