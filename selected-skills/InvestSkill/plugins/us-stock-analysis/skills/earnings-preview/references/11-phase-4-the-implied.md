# 2. Framework(continued)

Part 2 of 4 for `earnings-preview` — 2. Framework
See `SKILL.md` for what to read and when; this part is procedure, not routing.

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


