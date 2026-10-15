# Overview

Part 1 of 5 for `stock-valuation` — Overview; When to Use Each Method; Method 1: Discounted Cash Flow (DCF)
See `SKILL.md` for what to read and when; this part is procedure, not routing.

## Overview

Valuation is an art grounded in financial science. Each method has strengths and weaknesses depending on the business type, stage of maturity, and data availability. This skill applies four to five valuation methods, then reconciles them into a football field chart to show the implied value range. Wherever there is consensus across methods, conviction is high. Where methods diverge significantly, that gap tells you something important about market expectations.

---

## When to Use Each Method

```
Valuation Method          Best For                           Avoid For
────────────────────────────────────────────────────────────────────────────────────
DCF (Free Cash Flow)      Mature, FCF-positive businesses    Pre-revenue, banks, REITs
Comparable Company (CCA)  Any publicly traded company        No good public comps
EV/EBITDA Multiple        Capital-intensive industrials      Asset-light, high-SBC tech
Price/Earnings (P/E)      Stable earnings businesses         Negative earnings
Price/Sales (P/S)         Revenue-stage growth companies     Mature high-margin businesses
EV/Revenue                High-growth, low-margin SaaS       Mature, cyclical businesses
Residual Income (RI)      Financial companies, book-value    Asset-light businesses
Dividend Discount (DDM)   Dividend-paying value stocks       Growth stocks, no dividend
Asset-Based NAV           Real estate, holding companies     Operating businesses
────────────────────────────────────────────────────────────────────────────────────
```

---

## Method 1: Discounted Cash Flow (DCF)

### Step 1: Base Financial Metrics

Collect trailing twelve months (TTM) data:

```
Base Metrics:
  Revenue (TTM):                    $___M
  Operating Cash Flow (TTM):        $___M
  Capital Expenditures (TTM):       $___M
  Free Cash Flow (TTM):             $___M  (OCF - Capex)
  FCF Margin (TTM):                 ___%
  Stock-Based Compensation (TTM):   $___M
  True Economic FCF (SBC-adjusted): $___M
  Diluted Shares Outstanding:       ___M
  Net Debt / (Net Cash):            $___M
  Effective Tax Rate:               ___%
```

### Step 2: Three-Scenario Projections (10-Year)

```
Scenario Assumptions:
                        Bull        Base        Bear
Probability:            20%         60%         20%
Revenue CAGR Y1-5:      ___%        ___%        ___%
Revenue CAGR Y6-10:     ___%        ___%        ___%
FCF Margin Y5:          ___%        ___%        ___%
FCF Margin Y10:         ___%        ___%        ___%
WACC:                   ___%        ___%        ___%
Terminal Growth Rate:   ___%        ___%        ___%
```

### Step 3: WACC Calculation

```
Cost of Equity (CAPM):
  Risk-Free Rate (10Y Treasury):  ___%
  Beta (5-year monthly):          ___
  Equity Risk Premium:            ___%
  Size Premium (if applicable):   ___%
  Cost of Equity:                 ___% = Rf + β × ERP + Size

Cost of Debt:
  Interest Expense (TTM):         $___M
  Total Debt:                     $___M
  Effective Interest Rate:        ___%
  Tax Rate:                       ___%
  After-Tax Cost of Debt:         ___%

Capital Structure:
  Equity Market Cap:              $___M
  Total Debt:                     $___M
  E/V (Equity Weight):            ___%
  D/V (Debt Weight):              ___%

WACC = Ke × (E/V) + Kd × (D/V) = ___%
```

### Step 4: DCF Valuation Table

```
10-Year FCF Projection (Base Case):
Year    Revenue ($M)    FCF Margin%    FCF ($M)    Discount Factor    PV of FCF ($M)
1       ___             ___%           ___         ___                ___
2       ___             ___%           ___         ___                ___
3       ___             ___%           ___         ___                ___
4       ___             ___%           ___         ___                ___
5       ___             ___%           ___         ___                ___
6       ___             ___%           ___         ___                ___
7       ___             ___%           ___         ___                ___
8       ___             ___%           ___         ___                ___
9       ___             ___%           ___         ___                ___
10      ___             ___%           ___         ___                ___
────────────────────────────────────────────────────────────────────────────────────
Sum of PV (FCF 1-10):                                                ___
Terminal Value = FCF10 × (1+g) / (WACC-g):                          ___
PV of Terminal Value:                                                ___
Enterprise Value:                                                    ___
Less: Net Debt:                                                      ___
Equity Value:                                                        ___
Diluted Shares:                                                      ___M
DCF Intrinsic Value per Share:                                       $___
TV as % of EV (flag if >75%):                                        ___%
```

### Step 5: Sensitivity Table

```
Intrinsic Value per Share — WACC vs. Terminal Growth Rate
              Terminal Growth Rate
WACC     1.0%     1.5%     2.0%     2.5%     3.0%
6.0%     $___     $___     $___     $___     $___
7.0%     $___     $___     $___     $___     $___
8.0%     $___     $___     $___     $___     $___   ← Base Case
9.0%     $___     $___     $___     $___     $___
10.0%    $___     $___     $___     $___     $___
```

---


