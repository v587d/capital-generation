---
name: china-dcf
description: DCF valuation model for A-share stocks on Chinese financial statements, with WACC built from China government bond yields and A-share specific ERP. Use instead of the original dcf-model skill for Chinese equities.
---

# china-dcf

> 本文件相对上游 `d7585ca` 快照做过合规改写（取数与凭据口径），逐条记在快照根目录的 UPSTREAM.md；方法论、阈值与输出模板未改。

## Data Sources

A DCF is only as honest as the numbers handed to it, and this plugin has exactly one way to obtain numbers: the main agent delegates retrieval to the role that owns it. Nothing here calls a data interface, holds a key, or runs code.

Write one brief that names the ticker, the fields, and the as-of date, and ask for:

- 三表（年度，5 年窗口）：利润表、资产负债表、现金流量表 — the base for FCF history and for 折旧摊销 / CapEx
- 行情与股本：最新价、市值、PE / PB、股本结构（beta 需要它和基准指数的收益序列）
- 基准指数收益：上证指数的历史收益，用于 β 回归
- 无风险与债务成本输入：中国 10Y 国债收益率（Rf）与 5 年期信用债收益（Kd 的起点）
- 风险指标：宿主数据侧给出的 β / 波动率；拿不到就用同业 β 并写明用的是哪家同业

In a host that splits roles, delegate that brief rather than reaching for a feed from here. Then build the model from what comes back; a field that did not come back stays a named gap, and the valuation runs as a sensitivity over it rather than on an invented level.




## Key differences from US-market DCF

| Parameter | US DCF Convention | China DCF Convention |
|-----------|-------------------|---------------------|
| Risk-free rate | US 10Y Treasury | China 10Y CGB (国债收益率, ~2.5-3.5%) |
| Equity risk premium | ~5-6% (historical US) | ~6-8% (China A-share ERP) |
| Tax rate | US corporate 21% | China corporate 25% (高新技术企业 15%) |
| Terminal growth | US GDP growth (~2%) | China GDP growth (~4-5%) |
| Currency | USD | CNY |
| Reporting standard | US GAAP / IFRS | CAS (中国会计准则) |

## Workflow

### Step 1: Pull financials

Retrieve, through the host's data path: 利润表 / 资产负债表 / 现金流量表 on an annual basis for the last 5 years. Ask for them as one brief with the ticker, the three statements, and the window, then take the returned dataset reference as the model's input record.

### Step 2: Get market data

Retrieve 最新价、市值、PE / PB for the subject, and the 上证指数 return history needed for β. Both asks go to the host's retrieval path with the same as-of date; β is then estimated from what came back, and if the benchmark history did not come back, say so and use a comparable-firm β labelled as such.

### Step 3: Build projections

- Project revenue using historical growth rates adjusted for China macro outlook
- Assume 65-75% operating margin for 白酒 / high-margin sectors
- Assume 15-25% operating margin for manufacturing
- CapEx as % of revenue: check historical from cashflow statement

### Step 4: Compute WACC

```
WACC = E/(D+E) * Ke + D/(D+E) * Kd * (1 - tax_rate)

Ke = Rf + β * ERP
  Rf   = China 10Y CGB yield（国债收益率）— ask the host's retrieval path for the current level; if it does not come
         back, run the model as a sensitivity over a stated Rf band instead of assuming a number
  β    = regression on 上证指数 returns (or use comparable firm beta)
  ERP  = 6-8% (China-specific equity risk premium)

Kd   = China 5Y corporate bond yield + credit spread
```

### Step 5: Terminal value

```
Terminal Value = FCF_(n+1) / (WACC - g)
g = 3-4% for mature Chinese companies (China nominal GDP growth)
```

## Notes

- Chinese fiscal year ends December 31 for most companies
- 北向资金 (Northbound flow) data can be used as sentiment indicator
- 商誉 (goodwill) impairments are common in China M&A — flag if goodwill > 30% of equity
- Some Chinese financial statements are reported in 千元 (thousands of CNY) vs 元 — check the unit
