# Earnings Season, Explained

> Four times a year, every US-listed company reports. For a stockholder those four weeks decide more of the year's return than the other forty-eight — and almost all of the avoidable mistakes happen inside them. This lesson explains how the quarterly cycle actually works, what "consensus" and "guidance" are and why the guide moves the stock more than the print, why a company can beat and still fall, what the options market is telling you about the size (not the direction) of the reaction, and how to have your decision written down *before* the number arrives.

**What you'll learn**

- The quarterly reporting cycle: 10-Q / 10-K, the "season", pre-market vs. after-close, and the press release → 8-K → call → transcript sequence
- What consensus is, where it comes from, and why the whisper number is the bar the stock actually trades against
- Why the *guide* matters more than the *print* — and the anatomy of a "beat and drop"
- How to read the options-implied move as a **size** estimate, never a direction, and check whether the event is over- or under-priced
- A plain-words version of "what's priced in"
- How to read a press release in five minutes and an 8-K in two
- A three-scenario grid with a position rule decided *before* the print — and the list of things not to do

---

## The quarterly cycle

US public companies file a **10-Q** for each of the first three fiscal quarters and a **10-K** for the full year. The filing itself arrives days or weeks after the number; what moves the stock is the **earnings release** that precedes it. Because most fiscal quarters end on the same calendar dates, the releases bunch into a roughly four-week **earnings season** starting about two weeks after quarter-end — mid-January, mid-April, mid-July, mid-October.

A typical earnings day, in order:

| Step | When | What it is | Where to read it |
|---|---|---|---|
| **Press release** | Before the open (**BMO**) or after the close (**AMC**) — never during the session for most large caps | Headline revenue, EPS (GAAP *and* adjusted), segment table, and — for most companies — the **guidance** for the next quarter or year | Company investor-relations page |
| **Form 8-K** | Minutes later | The release filed with the SEC under Item 2.02 ("Results of Operations"); sometimes with extra exhibits | SEC EDGAR |
| **Conference call** | 30–90 minutes after the release | Prepared remarks, then analyst Q&A — the tone, the reasons behind the guide, and what management dodges | IR webcast; transcript within hours |
| **10-Q / 10-K** | Days to weeks later | The full statements, footnotes, risk factors, and management discussion | SEC EDGAR |

Two timing facts matter for a holder. A **BMO** release trades during the full session that day, so the reaction is visible and liquid; an **AMC** release trades in the thin after-hours session first, where a small number of orders can move the price several percent before most holders can act. And in the weeks before the release, companies observe a **quiet period** — management stops talking to investors — so any "news" you hear in that window is not coming from the company.

---

## Consensus, guidance, and the whisper

**Consensus** is the average (sometimes the median) of the published estimates from the sell-side analysts who cover the stock — revenue, EPS, and increasingly the next-quarter guidance. It is collected by data vendors and quoted everywhere. It is a useful number and a slightly misleading one: it lags, it is skewed by stale estimates, and it is the *public* bar, not the *real* one.

**Guidance** is the company's own outlook — a range for next quarter's revenue, the year's EPS, margins, or a key operating metric. Most large US companies give it; some (famously) refuse. For a growth company the guide is the number the market grades, because the stock is priced on the *future*, and the print is already the past. A common pattern: revenue and EPS beat, the guide comes in below consensus, and the stock falls 8% — a **beat and drop**.

The **whisper number** is the buy-side expectation sitting *above* the published consensus — the figure the stock is actually trading against. It is not published anywhere official; it is inferred from the direction of recent estimate revisions, the stock's run into the print, and how the company has treated its own guidance historically. Treat every whisper figure as **an estimate, labelled as one**. The practical rule: if the whisper sits materially above consensus (a few percent of revenue, more for EPS), a consensus-level "beat" will be received as a miss.

> **Key idea:** The market does not ask "did they beat?" It asks "did they beat *what I already expected*, and what did they say about next quarter?" Both halves of that question have to be answered before the reaction makes sense.

### Why a stock beats and falls

Four causes account for almost every "beat and drop":

1. **The bar was higher than consensus** — the whisper, or a consensus that had been rising for 90 days, so the beat was already in the price.
2. **The guide was cut, or held when a raise was expected** — the future got smaller even as the past looked good.
3. **The beat was low quality** — a tax item, a one-off gain, a buyback-driven EPS beat on flat revenue, or a margin beat from under-spending that will reverse.
4. **Positioning** — the stock ran 20% into the print; the holders who bought the run sell the news.

A stock that has beaten and dropped three times in the last eight quarters is telling you it is graded on the guide or on one KPI, not on the headline. That is worth knowing *before* you hold it through a print.

---

## The 8-quarter habit

Before every print, build (or ask a skill to build) one small table:

| Quarter | Revenue vs. consensus | EPS vs. consensus | Guide vs. consensus | Next-day move | Move vs. implied |
|---|---|---|---|---|---|
| Q-1 | +2.1% | +6.0% | raised | +7% | above |
| Q-2 | +1.4% | +3.2% | held | −5% | within |
| … | | | | | |

From it you learn three things no headline gives you: the **beat rate** (how often the company beats — most do, most of the time, which is exactly why a beat alone is not news), the **median next-day move** (the stock's own reaction size, robust to one wild quarter), and the **beat-and-drop count**. Fewer than six quarters of history — a recent IPO or spin-off — means there is no base rate yet; say so and lean on the other tools.

---

## The options-implied move — size, not direction

The options market prices the earnings reaction every quarter, and you can read that price without trading a single option. Take the **at-the-money straddle** (a call plus a put at the strike nearest the stock price) for the **first expiration after the print**; its cost divided by the stock price is the **implied move**, roughly the size of swing the market expects, in either direction.

Two cautions, both from the review of the skill that computes this:

- It is **non-directional**. An implied move of ±6% says the market expects a move of about 6% — up *or* down. It is not an estimate of your downside on a miss; that has to be modelled separately (past misses, the valuation floor, the bear-case target).
- It must be measured **event-only**. If the first expiration is more than one trading session after the print, the straddle also contains ordinary day-to-day volatility for those extra sessions. Strip it out (a longer-dated expiration gives the "normal" daily move) so the implied figure is comparable with the *next-day* realized move.

Then compare: **implied ÷ realized median**. Above about 1.2 the market is paying up for the event — "over-insured"; below about 0.8 it is complacent. Neither tells you which way the stock goes. Both tell you something about how surprised the crowd is prepared to be.

### A tiny worked illustration (illustrative, rounded)

A fictional company, "Zephyr Robotics", reports after the close on Thursday. The stock is $50. The straddle expiring Friday costs $3.00, so the implied move is 3.00 ÷ 50 = **±6%**. Its median next-day move over the last eight prints is **±4%**. Ratio 1.5 → the market is over-insured; the options crowd expects a bigger reaction than the stock's own history suggests.

What this means for a *holder*, not an options trader: the market's own size estimate is ±6%, so a stop placed 4% below the price will almost certainly be hit by ordinary post-print noise even on a decent quarter. Either the stop belongs further away (and the position smaller to keep the dollar risk the same), or the holder accepts that the stop is really a decision to exit on any miss. What it does **not** mean is that the stock will fall 6% on a miss — the miss-side downside is a separate estimate.

---

## What's priced in

Every price contains a forecast. The plain-words version of a **reverse DCF** (Lesson 4 has the real one): take today's price and a defensible multiple — the stock's own three-year median or the peer median — and ask what forward earnings that multiple *requires*. Then compare with consensus.

*"At $50 and 32× forward earnings, the price needs about 25% EPS growth next year; consensus is 18%."* That single sentence tells you the market is already assuming a beat-and-raise. A plain beat will be confirmation, not news; a beat-and-hold may be read as a miss. The opposite case — a stock down 15% into the print with a stable consensus — has room for relief on an ordinary quarter.

Add the positioning read where you can: short interest and days-to-cover, recent insider and institutional activity, and the stock's move over the last 30 days relative to its sector. A crowded, run-up name and an abandoned, sold-down name can report the identical quarter and react in opposite directions.

---

## Reading the release in five minutes

Read in this order, and stop at each line long enough to compare it with the bar:

1. **Revenue vs. consensus** — and vs. the company's own prior guidance range. Beat, in line, or miss, in percent.
2. **EPS — GAAP and adjusted, separately.** Note what was adjusted out (stock compensation, restructuring, a legal charge). An adjusted beat on a GAAP miss is a question, not an answer.
3. **Guidance vs. consensus** — the midpoint of the new range against what the street expected. This is usually the sentence that decides the after-hours move.
4. **The KPI that drove the last four prints** — segment growth, gross margin, subscribers, deliveries, backlog. Every company has one or two; you should know them before the release.
5. **One-offs and the share count** — a tax benefit, an asset sale, a buyback that lifted EPS without lifting profit.

Then the **8-K**: the release is Exhibit 99.1; check whether any other item was filed at the same time (a departure under Item 5.02, an impairment under Item 2.06) — companies bury bad news next to good numbers.

The **call** is where the reasons live. Read the transcript, or run `earnings-call-analysis` on it, for the tone of the prepared remarks, whether the guide is "conservative as usual" or genuinely cut, and which analyst question management refused to answer. Most post-print reversals happen between the release and the end of the call.

---

## The three-scenario grid — decided before the print

The single most useful habit in this lesson: fill in the grid the day *before* the release, so the reaction is execution rather than decision.

| Scenario | Trigger | Expected reaction | Your rule (written now) |
|---|---|---|---|
| **Beat & raise** | Revenue and EPS at or above the whisper; guide midpoint above consensus | Up by about the implied move or more; fades if the stock ran into the print | Hold. Add only at a pre-planned level, never by chasing the gap |
| **Beat & lower** | Headline beat; guide midpoint below consensus | Flat to down by the implied move — the classic beat and drop | Trim into early strength *if* the guide cut touches the reason you own it; otherwise hold and re-check the thesis |
| **Miss** | Revenue or EPS below consensus, or a guide cut with no offsetting KPI | Down by the implied move or more; larger if positioning was long | Respect the stop or the thesis's exit trigger. Do not average down in the first two sessions |
| **In line** | Everything within ±1%; guide held | Drift, then trades on the call's tone | No action. Read the transcript |

Attach a rough probability to each row and make them sum to 100 — the exercise forces you to say out loud that a beat-and-raise is *not* the base case for a stock that has already run.

### What not to do

- **Do not add size into the print on conviction.** The print is a coin with a known payout distribution and an unknown outcome; conviction changes neither. Size for the miss case.
- **Do not hold undefined-risk short options through the event** — short straddles, strangles, naked puts. The realized move exceeds the implied move in a measurable share of quarters.
- **Do not react to the headline EPS before the guide and the KPI are out.** The after-hours print is often reversed by the call.
- **Do not treat a beat against a lowered bar as a beat.** Compare with the consensus of 90 days ago, not only today's.
- **Do not average down inside the first two sessions after a miss.** Let the information settle; re-run the thesis first.
- **Do not confuse the stock's reaction with the quality of the quarter.** A drop on a good quarter is positioning; a rise on a poor one is relief. Write down which it was.

---

## The print is a thesis check

If you keep a written thesis (Lesson 7, and `thesis-tracker`), every earnings date is already on your calendar as a **scheduled check**. The KPIs in the thesis file are exactly the numbers to read in the release; the invalidation triggers are exactly what the "miss" row of the grid should respect. After the call, update the file — INTACT, WEAKENED, or BROKEN — and let that status, not the after-hours price, decide whether adding is still allowed.

*In the plugin:* `earnings-preview` builds the expectation stack, the 8-quarter table, the implied-vs-realized comparison, and the scenario grid *before* the print; `earnings-call-analysis` reads the transcript *after*; `catalyst-calendar` puts the date on the calendar; `options-analysis` handles strategy for the implied move; `thesis-tracker` records the check; `position-ladder` supplies the pre-planned add levels and the ceiling.

---

## Check yourself

1. A company beats revenue and EPS consensus and the stock falls 9% after hours. Name three causes that do not involve the reported quarter being bad.
2. The stock is $80; the straddle expiring the day after the print costs $5.60. What is the implied move, and what does it *not* tell you?
3. The first expiration after a Tuesday-evening print is Friday. Why can't you use that straddle's price directly as the event-implied move?
4. Consensus EPS has risen from $1.00 to $1.10 over the last 90 days. The company reports $1.11. Is this a strong beat? Why or why not?
5. Your thesis file's exit trigger is "gross margin below 55%". The release shows 53% and the stock rises 4% on a revenue beat. What does the grid say you should do, and why?

<details><summary>Answers</summary>

1. The whisper was above consensus (the bar was higher than published); the guide was cut or merely held; the beat was low quality (one-offs, buyback-driven EPS, under-spending); or the stock had run into the print and holders sold the news.
2. 5.60 ÷ 80 = **±7%**. It is a size estimate in either direction; it does not tell you the direction, and it is not an estimate of your downside on a miss.
3. It contains two extra ordinary trading sessions (Wednesday and Thursday) of normal volatility on top of the event. Strip the non-event days — using a longer-dated expiration's implied daily move — so the figure is comparable with the next-day realized move.
4. Weak. The bar rose 10% in 90 days; a $0.01 beat against the marked-up number is in line with what the market already expected, and likely below the whisper.
5. The exit trigger fired regardless of the price reaction. The grid's rule is to respect the thesis's trigger: at minimum stop adding and re-run the thesis check; a rise on a quarter that broke the thesis is relief, not confirmation.

</details>

---

## Key takeaways

- The stock reacts to the **guide** and to the gap between the print and the *real* expectation (the whisper), not to "beat or miss" against published consensus.
- "Beat and drop" has four ordinary causes — a higher bar, a weaker guide, a low-quality beat, and positioning — and a stock's 8-quarter history tells you which one it is prone to.
- The **options-implied move** is the market's estimate of the reaction's **size**, in either direction, measured event-only; it is not a downside forecast.
- "What's priced in" is one sentence: at this price and multiple, what growth does the market already assume — and is that above or below consensus?
- Read the release in a fixed order — revenue, GAAP and adjusted EPS, guide, the KPI, one-offs — then the 8-K's other items, then the call for the reasons.
- Fill in the **three-scenario grid** the day before, with a rule per row; the print is a scheduled check on a written thesis, not an invitation to decide in the after-hours session.

---

> **Next / Related:** Previous lesson — [Taxes & Account Types](learning-taxes.html). Next: [**Psychology & Process**](learning-psychology.html). Or head back to the [Learning hub](learning.html), then [Choose a Skill](choose-a-skill.html) to put it to work. See also [Concepts](concepts.html) and the [Glossary](glossary.html).

*Educational content only. Not financial advice.*
