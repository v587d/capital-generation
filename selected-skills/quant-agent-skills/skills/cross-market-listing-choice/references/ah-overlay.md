# A/H Overlay

Use when the same company has both A-share and H-share listings. This overlay
answers which security is better for execution after the company thesis is
already researched.

## Principle

Company-level research is done once. A vs H does not change the company's cash
flows. It changes execution, valuation spread, tax, liquidity, currency, and
access.

## Required Checks

- Alias coverage for A code, H code, Chinese name, English name, short names,
  and common variants.
- A/H premium:
  - compute with consistent price dates;
  - convert currency: `(A_price / FX_CNY_per_HKD) / H_price - 1`;
  - use a clean post-split/post-corporate-action window when old data is
    polluted.
- Currency and dividend tax:
  - CNY vs HKD basis;
  - HK Stock Connect dividend withholding when relevant.
- Liquidity and channel:
  - A-share liquidity/limit-up-down/microstructure;
  - HK liquidity, southbound access, borrow/short availability if relevant.
- Portfolio reality:
  - current held line;
  - trade ledger currency and cost basis;
  - whether switching lines is operationally possible.

## Output Rule

Write the overlay as:

```text
Company verdict: <WAIT/BUY/HOLD/...>
Preferred listing if action triggers: <A/H/no-switch>
Reason: <premium, currency, tax, liquidity, channel>
```

Never upgrade a weak company-level EV just because one line is cheaper.

