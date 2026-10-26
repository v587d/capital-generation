# Reference Algorithms

纯公式参考实现，**不随发布包、任何角色都不会执行、也不被任何 skill 正文点名**
（政策见 `docs/dev/selected-skills.md` §8.6 第 4 条）。运行时树里只有 Markdown；这些文件是升级公式、
移植到宿主计算面时的参考材料，不是运行时依赖。

- 文件头写明来源仓库、所钉 commit、许可与原始路径；`test/selected-skills-structure.test.mjs` 检查文件头，
  并禁止它们 import 网络 / 进程模块或读写文件。
- 当前 44 份：43 份 `financeskills` 的 `calculate.py`（8 份对应仍在仓的 catalog 正文，
  35 份对应的 skill 已删除）与 1 份 `trading-skills` 的共享计算模块。

| 文件 | 原 skill | 状态 | 来源 |
| --- | --- | --- | --- |
| `financeskills/ai-anomaly-detection/calculate.py` | `ai-anomaly-detection` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/aro-computation/calculate.py` | `aro-computation` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/automated-reconciliation/calculate.py` | `automated-reconciliation` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/banking-compliance/calculate.py` | `banking-compliance` | catalog 正文在仓（正文不指向本文件） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/budget-forecast/calculate.py` | `budget-forecast` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/company-valuation/calculate.py` | `company-valuation` | catalog 正文在仓（正文不指向本文件） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/corporate-consolidation/calculate.py` | `corporate-consolidation` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/credit-analysis/calculate.py` | `credit-analysis` | catalog 正文在仓（正文不指向本文件） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/crypto-accounting/calculate.py` | `crypto-accounting` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/cvp-breakeven/calculate.py` | `cvp-breakeven` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/debt-payoff/calculate.py` | `debt-payoff` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/debt-restructuring/calculate.py` | `debt-restructuring` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/deferred-tax/calculate.py` | `deferred-tax` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/earned-value-mgmt/calculate.py` | `earned-value-mgmt` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/ecl-computation/calculate.py` | `ecl-computation` | catalog 正文在仓（正文不指向本文件） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/financial-analysis/calculate.py` | `financial-analysis` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/fixed-asset-accounting/calculate.py` | `fixed-asset-accounting` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/forensic-accounting/calculate.py` | `forensic-accounting` | catalog 正文在仓（正文不指向本文件） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/insurance-reserving/calculate.py` | `insurance-reserving` | catalog 正文在仓（正文不指向本文件） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/intercompany-accounting/calculate.py` | `intercompany-accounting` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/inventory-costing/calculate.py` | `inventory-costing` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/investment-analysis/calculate.py` | `investment-analysis` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/journal-entry/calculate.py` | `journal-entry` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/lbo-modeling/calculate.py` | `lbo-modeling` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/lease-accounting/calculate.py` | `lease-accounting` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/net-worth-tracker/calculate.py` | `net-worth-tracker` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/oil-gas-valuation/calculate.py` | `oil-gas-valuation` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/personal-budgeting/calculate.py` | `personal-budgeting` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/predictive-burn-rate/calculate.py` | `predictive-burn-rate` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/product-profitability/calculate.py` | `product-profitability` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/retirement-planning/calculate.py` | `retirement-planning` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/revenue-recognition/calculate.py` | `revenue-recognition` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/risk-assessment/calculate.py` | `risk-assessment` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/startup-valuation/calculate.py` | `startup-valuation` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/statement-preparation/calculate.py` | `statement-preparation` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/tax-efficient-investing/calculate.py` | `tax-efficient-investing` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/tax-planning/calculate.py` | `tax-planning` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/three-statement-modeling/calculate.py` | `three-statement-modeling` | catalog 正文在仓（正文不指向本文件） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/treasury-management/calculate.py` | `treasury-management` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/variance-analysis/calculate.py` | `variance-analysis` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/venture-debt/calculate.py` | `venture-debt` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/wacc-computation/calculate.py` | `wacc-computation` | catalog 正文在仓（正文不指向本文件） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `financeskills/working-capital-analysis/calculate.py` | `working-capital-analysis` | 原 skill 已删除（无正文，仅留公式） | https://github.com/GAJETOso/financeskills @ `b0c6239` |
| `trading-skills/_lib/calculations.py` | `_lib` | catalog 正文在仓（正文不指向本文件） | https://github.com/marian2js/trading-skills @ `f1ae7d4` |
