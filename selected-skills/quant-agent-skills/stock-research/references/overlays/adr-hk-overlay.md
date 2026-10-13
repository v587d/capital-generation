# ADR / HK Overlay

Use when the same company trades as a U.S. ADR and Hong Kong share, or when a
U.S.-listed ADR has a related HK primary/secondary listing.

## Principle

Research the company once. The overlay chooses the better security wrapper for
execution and risk control.

## Required Checks

- Alias coverage for ADR ticker, HK ticker, Chinese name, English name, and
  historical names.
- Share ratio:
  - ADR-to-ordinary share conversion ratio;
  - price parity after FX and ratio adjustment.
- Currency:
  - USD vs HKD;
  - FX basis date.
- Listing and regulatory risk:
  - HFCAA/delisting risk if applicable;
  - primary vs secondary listing status;
  - fungibility and conversion constraints.
- Liquidity and trading access:
  - U.S. session vs HK session;
  - spread and average daily value;
  - available account/channel.
- Filing path:
  - U.S. domestic forms (`10-K/10-Q/8-K`) vs foreign private issuer forms
    (`20-F/6-K`);
  - company IR fallback when local SEC collector does not yet cover forms.

## Output Rule

Write:

```text
Company verdict: <WAIT/BUY/HOLD/...>
Preferred security if action triggers: <ADR/HK/no-switch>
Wrapper reason: <parity, liquidity, filing, regulatory, FX, channel>
```

Do not let wrapper cheapness override missing company-level evidence.

