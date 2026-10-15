# Method 2: Comparable Company Analysis (CCA)

Part 2 of 5 for `stock-valuation` — Method 2: Comparable Company Analysis (CCA); Method 3: EV/EBITDA Multiple Valuation; Method 4: Price/Earnings (P/E) Valuation; Method 5: Residual Income / Economic Value Added
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Method 2: Comparable Company Analysis (CCA)

Select 5–8 comparable public companies based on:
- Same industry and sub-industry
- Similar business model (SaaS vs. perpetual license, etc.)
- Similar growth profile (high-growth vs. mature)
- Similar size (market cap within 0.5–2.0x range preferred)

### Comparable Company Table

```
Comparable Company Multiples:
Company    Mkt Cap    EV/Rev    EV/EBITDA    P/E (FWD)    P/FCF    EV/FCF    Rev Growth%    EBITDA Mg%
Target     ___        ___       ___          ___          ___      ___       ___%           ___%
Peer 1     ___        ___       ___          ___          ___      ___       ___%           ___%
Peer 2     ___        ___       ___          ___          ___      ___       ___%           ___%
Peer 3     ___        ___       ___          ___          ___      ___       ___%           ___%
Peer 4     ___        ___       ___          ___          ___      ___       ___%           ___%
Peer 5     ___        ___       ___          ___          ___      ___       ___%           ___%
───────────────────────────────────────────────────────────────────────────────────────────────────
Peer Mean  ___        ___       ___          ___          ___      ___       ___%           ___%
Peer Median___        ___       ___          ___          ___      ___       ___%           ___%
```

### CCA Implied Value

Apply peer median multiples to the target's metrics:

```
CCA Valuation:
Metric          Target Value    Peer Median Multiple    Implied EV ($M)    Implied Price    Weight
EV/Revenue      $___M Rev       ___x                    $___               $___             25%
EV/EBITDA       $___M EBITDA    ___x                    $___               $___             25%
P/E (Forward)   $___  EPS       ___x                    n/a (equity)       $___             25%
EV/FCF          $___M FCF       ___x                    $___               $___             25%
──────────────────────────────────────────────────────────────────────────────────────────────────
EV-based rows: Implied Price = (Implied EV − Net Debt − Minority Interest + Non-operating Assets) ÷ Diluted Shares
P/E row:       Implied Price = Peer Median P/E × Target EPS   (already a per-share equity value — no EV bridge)
The weighted average below is taken over the Implied Price column only.
CCA Weighted Average Implied Price:                      $___
Premium/Discount Applied (for size, quality):            ±___%
CCA Adjusted Implied Price:                              $___
```

**Premium/Discount Adjustment Factors:**
- Apply a +10–20% premium if the target has: superior growth, higher margins, stronger balance sheet
- Apply a -10–25% discount if: smaller/less liquid, weaker fundamentals, regulatory overhang

---

## Method 3: EV/EBITDA Multiple Valuation

Simple multiple-based valuation used primarily as a sanity check:

```
EV/EBITDA Valuation:
  TTM EBITDA:                    $___M
  Forward EBITDA (NTM):          $___M
  Historical EV/EBITDA Average:  ___x  (5-year own history)
  Peer Median EV/EBITDA:         ___x
  Sector Median EV/EBITDA:       ___x

  Conservative Multiple (peer discount): ___x
  Base Multiple (peer median):           ___x
  Premium Multiple (peer premium):       ___x

  Conservative Implied EV:       $___M  → Per Share: $___
  Base Implied EV:               $___M  → Per Share: $___
  Premium Implied EV:            $___M  → Per Share: $___

  Net Debt/(Cash):               $___M
  Shares Outstanding:            ___M
```

---

## Method 4: Price/Earnings (P/E) Valuation

For companies with stable, growing earnings:

```
P/E Valuation:
  TTM GAAP EPS:                  $___
  NTM Consensus EPS:             $___
  2-Year Forward EPS:            $___

  Historical P/E Average (5yr):  ___x
  Peer Median P/E (NTM):         ___x
  S&P 500 P/E (NTM):             ___x   [for context]

  PEG Ratio (NTM P/E / Growth):  ___    [<1.0 = undervalued, >2.0 = expensive]

  Conservative P/E (10% discount to peer): ___x → Implied Price: $___
  Base P/E (peer median):                  ___x → Implied Price: $___
  Premium P/E (10% premium to peer):       ___x → Implied Price: $___
```

---

## Method 5: Residual Income / Economic Value Added

For financial companies or businesses where book value is meaningful:

```
Residual Income Model:
  Book Value per Share (current):        $___
  Cost of Equity (Ke):                   ___%
  Expected ROE (avg next 5 years):       ___%
  Residual Income (ROE - Ke) × BV:       $___

  Justified P/B = 1 + (ROE - Ke) / (Ke - g)
                = 1 + (___ - ___) / (___ - ___)
                = ___x

  Book Value per Share:                  $___
  Justified P/B:                         ___x
  Residual Income Implied Price:         $___
```

---


