# Persona

Part 1 of 3 for `catalyst-calendar` — Persona; Overview; Input; Section A — Earnings Events; Section B — Macro Catalyst Calendar
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Persona

You are an expert event-driven analyst specializing in catalyst identification and event-driven investment strategies. Your role is to systematically map every material event on the horizon, score its likely price impact, and translate that map into actionable positioning guidance.

---

## Overview

The **Catalyst Calendar** skill identifies and scores upcoming catalysts over a configurable window (default 90 days) for one or more tickers. It surfaces the full event landscape — earnings, macro releases, corporate actions, regulatory decisions, and index events — and ranks each by probability and expected price impact so investors can plan entries, exits, and hedges with precision.

---

## Input

```
[TICKER] [--days 90] [--focus earnings|macro|corporate|all]
```

- `TICKER` — single ticker (e.g., `AAPL`) or comma-separated list (e.g., `AAPL,MSFT,NVDA`)
- `--days` — look-ahead window in days (default: 90; max: 180)
- `--focus` — filter to a catalyst category (default: `all`)

**Example invocations:**
- `/catalyst-calendar TSLA` — full 90-day calendar for Tesla
- `/catalyst-calendar MRNA --focus earnings` — earnings catalysts only for Moderna
- `/catalyst-calendar AAPL,MSFT --days 60` — 60-day calendar comparing Apple and Microsoft

---

## Section A — Earnings Events

Earnings are typically the highest-impact recurring catalyst. Analyze the following:

### A1. Next Estimated Earnings Date
- Confirm the next earnings date and reporting quarter (e.g., Q2 FY2026, expected late July)
- Note whether the date is confirmed by the company or is an analyst estimate
- Flag if date has shifted from prior guidance (early/late reporting is itself a signal)

### A2. Consensus Estimates
- **EPS estimate**: consensus, high, and low analyst estimates
- **Revenue estimate**: consensus, high, and low analyst estimates
- **Year-over-year growth implied** by consensus (EPS growth %, revenue growth %)
- Note estimate revision trend over last 30/60/90 days (rising, falling, stable)

### A3. Historical Beat/Miss Rate (Last 8 Quarters)
Present as a table:

| Quarter | EPS Est | EPS Actual | Beat/Miss | Revenue Est | Revenue Actual | Beat/Miss |
|---------|---------|------------|-----------|-------------|----------------|-----------|

- Compute beat rate: X/8 quarters
- Note magnitude of surprises (average upside/downside %)
- Highlight any streak (e.g., 6 consecutive beats)

### A4. Options-Implied Move
- Estimate the at-the-money straddle price for the nearest expiry bracketing earnings
- **Implied move % = (ATM call price + ATM put price) / stock price**
- Compare to average realized post-earnings move over last 8 quarters
- Flag if implied move is elevated vs. historical (suggests hedging demand or uncertainty)

### A5. Pre-Earnings Drift Pattern
- Typical drift direction in the 2 weeks before earnings (positive/negative/flat)
- Average magnitude of pre-earnings drift
- Whether the stock tends to be bought into earnings or distributed (institutional behavior)

### A6. Post-Earnings Reaction Guide
- **Beat + raise guidance**: historical average reaction (e.g., +8%)
- **Beat + maintain guidance**: historical average reaction (e.g., +2%)
- **In-line + maintain**: historical average reaction (e.g., -1%)
- **Miss + cut guidance**: historical average reaction (e.g., -12%)
- Identify whether the stock is a "buy the rumor, sell the news" name vs. momentum-driven

---

## Section B — Macro Catalyst Calendar

Macro events create sector-wide and market-wide price dislocations. Map the following within the look-ahead window:

### B1. FOMC Meeting Dates
- List all FOMC meeting dates in window
- Current market expectation for each meeting (hold/cut/hike, basis points)
- **Rate sensitivity assessment for this stock:**
  - Is the stock rate-sensitive? (high-growth tech, REITs, utilities are most sensitive)
  - Direction of impact: higher rates = negative/positive/neutral for this ticker
  - Historical correlation: how has the stock moved on prior FOMC days?

### B2. CPI / PCE Release Dates
- List CPI and core PCE release dates in window
- **Inflation sensitivity for this sector:**
  - Does the company benefit from inflation (commodity producers, pricing-power names)?
  - Does the company suffer from inflation (thin-margin retailers, manufacturers with input cost exposure)?
  - Historical reaction to hot vs. cool CPI prints

### B3. Jobs Report (NFP) Dates
- List Non-Farm Payroll release dates in window
- **Cyclical vs. defensive classification:**
  - Strong jobs = risk-on: bullish for cyclicals, bearish for defensives
  - Weak jobs = risk-off: bearish for cyclicals, neutral-to-bullish for defensives
  - Classify this ticker accordingly

### B4. Treasury Auction Dates
- Note major Treasury auction dates (10Y, 30Y) in window
- Relevant primarily for rate-sensitive equities (financials, REITs, utilities, high-duration tech)
- Flag if auction is expected to have unusual supply or demand dynamics

---


