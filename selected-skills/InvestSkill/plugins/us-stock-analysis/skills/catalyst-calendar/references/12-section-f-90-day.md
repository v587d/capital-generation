# Section F — 90-Day Catalyst Heat Map

Part 3 of 3 for `catalyst-calendar` — Section F — 90-Day Catalyst Heat Map; Thesis Invalidation
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Section F — 90-Day Catalyst Heat Map

Visualize catalyst density across the look-ahead window as an ASCII weekly calendar. Use block shading to indicate event intensity:

```
░░░ = Low (0–1 minor catalysts)
██  = Medium (1–2 moderate catalysts)
████ = HIGH (3+ catalysts or 1 major binary event)
```

**Example output format:**

```
90-Day Catalyst Heat Map — [TICKER]
════════════════════════════════════════════════════════

Week 1  (Jun 23 – Jun 27):  ░░░  Low       — Quiet period
Week 2  (Jun 30 – Jul  4):  ████ HIGH      — Earnings + FOMC
Week 3  (Jul  7 – Jul 11):  ██   Medium    — CPI release
Week 4  (Jul 14 – Jul 18):  ░░░  Low       — Quiet period
Week 5  (Jul 21 – Jul 25):  ██   Medium    — Investor Day
Week 6  (Jul 28 – Aug  1):  ░░░  Low       — Quiet period
Week 7  (Aug  4 – Aug  8):  ██   Medium    — Jobs Report + FOMC minutes
Week 8  (Aug 11 – Aug 15):  ████ HIGH      — FDA PDUFA + CPI
Week 9  (Aug 18 – Aug 22):  ░░░  Low       — Quiet period
Week 10 (Aug 25 – Aug 29):  ░░░  Low       — Quiet period
Week 11 (Sep  1 – Sep  5):  ██   Medium    — Jobs Report
Week 12 (Sep  8 – Sep 12):  ██   Medium    — Conference presentation
Week 13 (Sep 15 – Sep 19):  ████ HIGH      — FOMC + index rebalancing

════════════════════════════════════════════════════════
Peak Risk Window:  Jul 1 – Jul 11 (earnings + macro overlap)
Quietest Window:   Jul 14 – Jul 25 (low catalyst density, favorable for accumulation)
```

Adjust weeks and labels to match the actual look-ahead window and identified catalysts.

---

## Thesis Invalidation

**If catalyst outlook is BULLISH — it breaks if:**
- Earnings miss by >10% AND guidance lowered
- FOMC surprise rate hike >25bps above consensus
- Key product launch delayed >1 quarter
- FDA rejection or Complete Response Letter (CRL) issued
- Index inclusion candidate excluded from rebalancing

**If catalyst outlook is BEARISH — it breaks if:**
- Major earnings beat with raised guidance
- Positive regulatory surprise (FDA approval, contract win)
- Index inclusion announcement
- Activist investor disclosure or buyout rumor
- Macro surprise (emergency rate cut, strong CPI miss to downside)

**Re-run this analysis when:**
- [ ] Earnings date confirmed / officially announced by the company
- [ ] Major news event changes catalyst timeline (acquisition, spin-off, regulatory action)
- [ ] 30 days elapsed (calendar and estimates both update)
- [ ] Implied volatility moves >20% from levels at time of this analysis
- [ ] Analyst coverage changes materially (new initiations or target price revisions >15%)

---

```
╔══════════════════════════════════════════════╗
║         INVESTMENT SIGNAL — CATALYST CALENDAR             ║
╠══════════════════════════════════════════════╣
║ Next Catalyst:   [EVENT] on [DATE]           ║
║ 30-Day Bias:     BULLISH / NEUTRAL / BEARISH ║
║ Catalyst Density: HIGH / MEDIUM / LOW        ║
╠══════════════════════════════════════════════╣
║ Highest Impact:  [EVENT] — [±X%] expected    ║
║ Risk Window:     [DATE RANGE]                ║
╚══════════════════════════════════════════════╝
```

**Disclaimer:** Educational analysis only. Not financial advice.


