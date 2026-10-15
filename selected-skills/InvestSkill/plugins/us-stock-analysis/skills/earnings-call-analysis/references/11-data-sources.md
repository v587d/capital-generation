# Data Sources

Part 2 of 3 for `earnings-call-analysis` — Data Sources; Input Formats; Output; Analysis Guidelines; Usage Examples; Integration Notes; Standard Signal Output
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Data Sources

Reference the following sources when analyzing earnings calls:

### Primary Sources
- **SEC EDGAR 8-K Filings**: Official transcripts filed within 4 days of call
  - Search: https://www.sec.gov/edgar/searchedgar/companysearch.html
  - Look for: Item 2.02 (Results of Operations and Financial Condition)

- **Company Investor Relations**: Live webcasts and archived recordings
  - Typically at: [company-website.com]/investors/earnings
  - May include slides and supplemental materials

### Transcript Services
- **Seeking Alpha**: Free transcript archive with searchable database
  - Format: https://seekingalpha.com/symbol/[TICKER]/earnings/transcripts

- **AlphaSense**: Premium transcript service with AI search (paid)
- **Bloomberg Terminal**: Real-time transcripts and historical archive (paid)
- **FactSet**: Transcript archive with analytics (paid)

### Supplementary Information
- **Earnings Press Release**: Published before call, contains prepared financial results
- **Investor Presentation Slides**: Visual aids referenced during call
- **10-Q/10-K Filings**: Detailed financials for context
- **Prior Quarter Calls**: For comparison and trend analysis

## Input Formats

Accept earnings call data in the following formats:

### Format 1: Transcript Text
```
Paste the full transcript text from the earnings call, including:
- Corporate Participants section
- Prepared Remarks
- Q&A Session
- Forward-Looking Statements disclaimer (if present)
```

### Format 2: Transcript URL
```
Provide URL to transcript:
- Seeking Alpha URL
- Company IR page URL
- SEC EDGAR filing link
```

### Format 3: Call Details for Manual Analysis
```
Company: [Name]
Ticker: [SYMBOL]
Quarter: Q[1-4] [YEAR]
Call Date: [MM/DD/YYYY]

Key Questions to Focus On:
- [Specific aspects to analyze]
```

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
- Output can be fed to /report-generator for HTML/PDF export
- Particularly valuable around earnings season (Jan, Apr, Jul, Oct)
- Best used within 1-2 days of earnings release while market is digesting information

## Standard Signal Output

All analysis concludes with this standardized block:

```

