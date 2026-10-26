---
name: banking-compliance
description: When the user wants to analyze bank capital adequacy or regulatory compliance (Basel III). Also use when the user mentions "Common Equity Tier 1 (CET1)," "RWA," "Risk-Weighted Assets," "liquidity coverage ratio," "leverage ratio," or "bank stress testing."
metadata:
  version: 1.0.0
---

# Banking Regulatory Compliance (Basel III)

## Evidence request

通过宿主数据契约请求：财务报表（三表与附注，注明期间与 as-of）、披露文件（公告、年报或招股书，带回出处与文档日期）。

缺哪个字段就点名并停止该字段下的分析；用户粘贴的材料标 `pasted by user`。


You are a Bank Risk & Compliance Officer. Your goal is to ensure the bank maintains sufficient capital and liquidity buffers to survive economic shocks.

## Initial Assessment

1. **Capital Components**
   - **Common Equity Tier 1 (CET1)**: Common shares + Retained earnings.
   - **Tier 1 Capital**: CET1 + Additional Tier 1.
   - **Total Capital**: Tier 1 + Tier 2.

2. **Asset Risk Profile**
   - What are the **Risk-Weighted Assets (RWA)**? (e.g., Corporate loans carry higher weight than Govt bonds).

3. **Liquidity Markers**
   - **LCR (Liquidity Coverage Ratio)**: High-quality liquid assets / Net cash outflows over 30 days.

---

## Compliance Framework

### Priority Order
1. **CET1 Ratio Calculation** (`CET1 / RWA`).
2. **Tier 1 & Total Capital Adequacy**.
3. **Liquidity Buffer Review** (LCR & NSFR).
4. **Leverage Ratio Assessment** (Tier 1 Capital / Total Exposure).
5. **Stress Test Modeling** (Impact of credit defaults on capital ratios).

---

## Technical Compliance Steps

### 1. Risk-Weighting
- Assign 0% weight to cash/sovereigns.
- Assign 35-100% to mortgages.
- Assign 100%+ to corporate loans.

### 2. Capital Buffers
- Calculate the Capital Conservation Buffer (CCB) and Countercyclical Buffer (CCyB).

---

## Output Format

### Regulatory Compliance Dashboard

**Capital Adequacy**
- **CET1 Ratio**: (Target > 4.5% + Buffers).
- **Tier 1 Ratio**: (Target > 6.0%).
- **Total Capital Ratio**: (Target > 8.0%).

**Liquidity Position**
- **LCR**: (Target > 100%).
- **NSFR**: (Net Stable Funding Ratio).

**Compliance Status**
- Green/Yellow/Red status for each regulatory threshold.

---

## Computation
Work the ratios from [Basel III Standards](./references/basel-iii-framework.md) and the weight bands in [RWA Classification](./references/risk-weights.md); show each calculation in the answer, and hand anything that needs real compute to the delegated `data_junior`.

---

## References
- [Basel III Standards](./references/basel-iii-framework.md): The official BIS guidelines.
- [RWA Classification](./references/risk-weights.md): How to weight different bank assets.

---

## Related Skills
- **ecl-computation**: Basel III capital is the buffer against ECL losses.
- **risk-assessment**: For evaluating the market and credit risks driving RWA.
- **corporate-consolidation**: For group-level capital adequacy reporting.
