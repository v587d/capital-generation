# Output and Signal

Part 2 of 3 for `bear-case` — the output sections, the scoring block, and the machine-readable signal shape
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Output

Provide a structured bear-case report:

### 1. One-Sided-Disclosure Banner
> ⚠️ This is a **deliberately one-sided bear case** built to surface counterevidence. Pair it with `/stock-eval` or a bull analysis for a balanced view.

### 2. Bear Thesis in Three Sentences
The elevator pitch for why the stock is a bad hold.

### 3. Bear Case Strength Score (0–10)
```
Pillar                              Weight   Score
Valuation stretch                    0–2      X.X
Deteriorating fundamentals           0–2      X.X
Accounting / earnings-quality flags  0–2      X.X
Competitive & secular threats        0–2      X.X
Management & capital allocation      0–1      X.X
Catalyst clarity & timing            0–1      X.X
                          BEAR CASE STRENGTH:  X.X / 10
```
```
Bear Case Strength   Interpretation
0.0–2.0              Weak — few credible negatives; bull case likely intact
2.1–4.0              Modest — some concerns, not thesis-breaking
4.1–6.0              Moderate — real red flags; reduce/hedge worth considering
6.1–8.0              Strong — multiple independent negatives; avoid / short candidate
8.1–10.0            Severe — deep impairment or fraud-risk signals; high-conviction bear
```

### 4. Detailed Findings
Cover pillars 1–7 (in `10-analysis-framework.md`), each with the evidence and its severity.

### 5. Downside Target & Risk/Reward
Bear price target with the math, scenario tree, and asymmetry assessment.

### 6. Thesis-Killers
The mandatory list of what would prove the bear wrong.

## Signal Output

The Bear Case Strength Score maps to the standard signal as follows: a **stronger bear case (higher score) means a more BEARISH signal**. A strong/severe bear case → BEARISH / SELL; a weak bear case → the bear failed to make its point, leaning NEUTRAL-to-constructive. Because this skill argues one side, state the mapping explicitly so the user reads the block correctly.

All analysis concludes with this standardized block:

```
