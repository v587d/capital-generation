# Data Sources

Part 2 of 3 for `earnings-call-analysis` — Data Sources; Input Formats; Output; Analysis Guidelines; Usage Examples; Integration Notes; Standard Signal Output
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Evidence request

Ask for the evidence this analysis needs through the host data contract, in one request:

- the latest call: transcript with prepared remarks and Q&A, call date, fiscal quarter, and the venue or document that carries it
- the filing that accompanies it: the results release (8-K / 6-K items) or the 10-Q / 10-K the call refers to
- the materials distributed with the call: press release, investor presentation, supplemental schedules
- the prior-quarter call, for comparison
- a consensus or guidance baseline only if the host actually returned one, labelled as such

Do not ask the user to pick a data vendor and do not request credentials: the host decides where the evidence comes from and returns each item with provenance (venue, document, date, accession or link). State the as-of date on every figure the analysis leans on, and keep the period labels (fiscal quarter, trailing twelve months) exactly as the evidence source defines them. If the transcript cannot be retrieved, say so and stop the transcript-dependent parts — never reconstruct quotes, tone or Q&A from memory.

## Input formats

### Format 1: Transcript text

Paste the transcript as returned by retrieval, including the corporate participants section, prepared remarks, the Q&A and any forward-looking disclaimer. Treat it as `pasted by user`.

### Format 2: Call details only

```
Company: [Name]
Ticker: [SYMBOL]
Quarter: Q[1-4] [YEAR]
Call date: [MM/DD/YYYY]

Key questions to focus on:
- [specific aspects to analyze]
```

With only call details, request the transcript and the accompanying filing through the host channel first. If neither comes back, deliver the framework, name the missing fields, and stop short of writing a transcript analysis; a press release alone supports the guidance section but not the tone or Q&A reads, so say which sections the evidence actually covers.

## Output

Provide comprehensive earnings call analysis report with:

### 1. Call Metadata
- Company name and ticker
- Quarter and fiscal year
- Call date and time
- Participating executives
- Transcript source

### 2. Executive Summary (1-2 paragraphs)
- Overall assessment and sentiment
- Key takeaways (3-5 bullet points)
- Investment implication (Buy/Hold/Sell)

### 3. Management Tone Rating
- Confidence Level: High / Medium / Low
- Transparency: Excellent / Good / Fair / Poor
- Notable tone characteristics
- Supporting evidence (quotes)

### 4. Key Themes (Ranked by Importance)
For each theme:
- Description
- Management's stance
- Supporting quotes
- Investment relevance

### 5. Guidance Analysis
- Detailed guidance breakdown
- Changes from prior guidance
- Comparison to consensus estimates
- Credibility assessment

### 6. Q&A Insights
- Top 5 analyst questions
- Quality of management responses
- New information revealed
- Questions avoided or deflected

### 7. Red Flags & Concerns
- Identified warning signs (if any)
- Severity assessment
- Historical context
- Recommended monitoring items

### 8. Quarter-over-Quarter Changes
- Messaging shifts
- Tone differences
- Strategic pivots
- Performance vs. prior commitments

### 9. Investment Recommendation
- Overall sentiment: Bullish / Neutral / Bearish
- Confidence level: High / Medium / Low
- Key investment drivers (bullish case)
- Key risks (bearish case)
- Suggested action with rationale
- Time horizon

### 10. Notable Quotes
5-10 most significant quotes from management with context

## Analysis Guidelines

### Best Practices

1. **Read the Entire Transcript**: Don't rely only on prepared remarks; Q&A often reveals more
2. **Compare to Prior Calls**: Context is critical for identifying changes
3. **Cross-Reference with Financials**: Verify claims against actual 10-Q/10-K data
4. **Watch for Language Patterns**: Hedging, definitiveness, evasiveness
5. **Note What's NOT Said**: Absence of previously discussed topics is meaningful
6. **Consider the Audience**: Different messages for different analyst types

### Common Pitfalls to Avoid

1. **Over-Optimism Bias**: Management is inherently promotional
2. **Recency Bias**: One quarter doesn't make a trend
3. **Cherry-Picking**: Consider full context, not just favorable quotes
4. **Ignoring Tone**: What's said matters, but HOW it's said matters more
5. **Missing Red Flags**: Defensiveness and evasion are important signals

### Analyst Question Interpretation

- **If analysts ask about guidance**: They may expect a beat or miss
- **If questions focus on one issue**: It's likely a consensus concern
- **If analysts challenge management**: Credibility may be in question
- **If questions are softball**: Either results are stellar or relationships are managed

## Usage Examples

### Example 1: Basic Transcript Analysis
```
User: /earnings-call-analysis AAPL

[Paste transcript text or provide URL]

Claude analyzes the transcript and provides comprehensive report with all sections
```

### Example 2: Focused Analysis
```
User: /earnings-call-analysis TSLA --focus "production guidance,margin outlook"

[Provide transcript]

Claude emphasizes analysis of specified topics while still covering full call
```

### Example 3: Comparative Analysis
```
User: /earnings-call-analysis NVDA --compare Q3-2024

[Provide current quarter transcript]

Claude compares with prior quarter (Q3 2024) to highlight changes and trends
```

## Integration Notes

- Can be used standalone or in conjunction with /stock-eval
- Chart-ready tables stay in the answer; the host chart channel renders them (this plugin exports no HTML/PDF)
- Particularly valuable around earnings season (Jan, Apr, Jul, Oct)
- Best used within 1-2 days of earnings release while market is digesting information

## Standard Signal Output

All analysis concludes with this standardized block:

```

