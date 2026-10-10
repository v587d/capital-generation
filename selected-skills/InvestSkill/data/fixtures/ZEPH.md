---
# Evaluation fixture for scripts/eval-skills.js — a FICTIONAL company with
# internally consistent numbers, so a skill's arithmetic can be checked
# without depending on live market data. Every value below is invented.
ticker: ZEPH
company: Zephyr Robotics Inc. (fictional)
as_of: 2026-06-30
currency: USD millions unless stated
price: 48.20
shares_out_m: 412
market_cap_m: 19858
revenue_m: 6120
revenue_prior_m: 5100
gross_profit_m: 3550
operating_income_m: 1040
net_income_m: 820
eps: 1.99
ocf_m: 1240
capex_m: 310
fcf_m: 930
cash_m: 1650
total_debt_m: 800
net_debt_m: -850
dividends_paid_m: 165
dividend_per_share: 0.40
buybacks_m: 300
expect:
  # label | regex the number must appear near | expected value | unit (m = $ millions, x = multiple, pct = percent) | tolerance
  - { label: "FCF = OCF − capex",          near: "free cash flow|\\bFCF\\b",              value: 930,   unit: m,   tol: 0.02 }
  - { label: "Net debt = debt − cash",     near: "net debt|net cash",                    value: 850,   unit: m,   tol: 0.02 }
  - { label: "P/E = price ÷ EPS",          near: "P/E",                                  value: 24.2,  unit: x,   tol: 0.03 }
  - { label: "Revenue growth",             near: "revenue growth|revenue grew|YoY",     value: 20.0,  unit: pct, tol: 0.05 }
  - { label: "FCF payout (div ÷ FCF)",     near: "payout",                               value: 17.7,  unit: pct, tol: 0.08 }
---

# Zephyr Robotics Inc. (ZEPH) — data pack, as of 2026-06-30

> **Fictional company.** Use only the figures in this pack. Treat them as data pasted by the user (`Retrieval: pasted by user`). Do not search the web or use memory for ZEPH — it does not exist.

## Market data (close 2026-06-30)

| Item | Value |
|------|-------|
| Price | $48.20 |
| 52-week range | $31.10 – $55.80 |
| Shares outstanding | 412 M |
| Market cap | $19,858 M |
| Exchange / sector | NASDAQ · Industrials — factory automation & warehouse robotics |
| Dividend per share (annual) | $0.40 |

## Income statement — fiscal year ended 2026-03-31 ($ M)

| Line | FY2026 | FY2025 |
|------|--------|--------|
| Revenue | 6,120 | 5,100 |
| Cost of revenue | 2,570 | 2,210 |
| Gross profit | 3,550 | 2,890 |
| R&D | 1,190 | 980 |
| SG&A | 1,320 | 1,150 |
| Operating income | 1,040 | 760 |
| Interest expense | 38 | 41 |
| Pre-tax income | 1,030 | 745 |
| Income tax | 210 | 152 |
| Net income | 820 | 593 |
| Diluted EPS | $1.99 | $1.42 |
| Diluted shares (M) | 412 | 418 |

## Balance sheet — 2026-03-31 ($ M)

| Line | Value |
|------|-------|
| Cash & equivalents | 1,650 |
| Accounts receivable | 940 |
| Inventory | 610 |
| PP&E, net | 1,420 |
| Goodwill & intangibles | 880 |
| Total assets | 6,310 |
| Accounts payable | 520 |
| Total debt (all long-term, 4.1% fixed, due 2030) | 800 |
| Total liabilities | 2,140 |
| Shareholders' equity | 4,170 |

## Cash flow — FY2026 ($ M)

| Line | Value |
|------|-------|
| Operating cash flow | 1,240 |
| Capital expenditures | (310) |
| Free cash flow | 930 |
| Dividends paid | (165) |
| Share repurchases | (300) |
| Net change in cash | +365 |

## Segments — FY2026 revenue

| Segment | Revenue ($ M) | Growth | Share |
|---------|---------------|--------|-------|
| Warehouse robotics | 3,670 | +26% | 60% |
| Factory automation | 1,840 | +12% | 30% |
| Software & services (recurring) | 610 | +31% | 10% |

## Other facts

- Top customer = 18% of revenue (a large e-commerce retailer); top 5 = 41%.
- Backlog $4.2 B (+15% YoY); book-to-bill 1.1×.
- Management guided FY2027 revenue growth of 15–18% and gross margin 57–59%.
- Insider ownership 6%; no insider sales in the last six months; CFO bought $1.2 M of stock in May 2026.
- Two direct competitors: one larger diversified industrial (gross margin 41%), one venture-backed pure play (unprofitable, growing 45%).
- Risks disclosed in the 10-K: customer concentration, tariff exposure on components sourced from Asia (≈ 30% of COGS), a pending patent suit (damages sought $120 M).
