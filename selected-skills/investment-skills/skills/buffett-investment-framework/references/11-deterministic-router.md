# Deterministic Router

The upstream router was a small file-reading helper: given an intent, it listed the cards and the
reference files that implement them. This snapshot ships Markdown only, so the same decision is
made from the tables below. Nothing is lost — the router held no analysis of its own, only the
mapping reproduced here.

## Intent to starting cards

| Intent | Use when | Ordinary starting cards |
| --- | --- | --- |
| `financial-analysis` | Company-filed evidence on performance, owner economics, capital efficiency, financing, or obligations | `F01`, `F02`, `F05`, `F06`, `F07` |
| `memo-review` | A memo or committee paper to challenge on evidence, assumptions, or consistency | `D01`, `D03`, `B02`, `V01`, `V05`, `V06`, `R01`, `R07` |
| `thesis-evaluation` | Explicit thesis components to test for mechanism, evidence, value logic, and invalidation | `D02`, `D03`, `B01`, `B06`, `V01`, `V04`, `R01`, `R07` |

## Card range to file

| Cards | Reference file |
| --- | --- |
| `D01`–`D04` | `01-decision-posture-D01-D04.md` |
| `D05`–`D09` | `01-decision-posture-D05-D09.md` |
| `B01`–`B03` | `02-business-economics-B01-B03.md` |
| `B04`–`B07` | `02-business-economics-B04-B07.md` |
| `M01`–`M04` | `03-management-governance-M01-M04.md` |
| `M05`–`M08` | `03-management-governance-M05-M08.md` |
| `F01`–`F03` | `04-financial-reality-F01-F03.md` |
| `F04`–`F07` | `04-financial-reality-F04-F07.md` |
| `V01`–`V03` | `05-valuation-V01-V03.md` |
| `V04`–`V06` | `05-valuation-V04-V06.md` |
| `C01`–`C04` | `06-capital-allocation-C01-C04.md` |
| `C05`–`C09` | `06-capital-allocation-C05-C09.md` |
| `R01`–`R03` | `07-risk-monitoring-R01-R03.md` |
| `R04`–`R07` | `07-risk-monitoring-R04-R07.md` |
| `S01`–`S03` | `08-specialized-overlays-S01-S03.md` |
| `S04`–`S06` | `08-specialized-overlays-S04-S06.md` |
| `S07`–`S09` | `08-specialized-overlays-S07-S09.md` |
| `S10`–`S12` | `08-specialized-overlays-S10-S12.md` |

Read the chosen files whole, with no line window, and resolve each name against this skill's base
directory. `09-workflows.md` holds the three card sequences with their required inputs; `10-method.md`
holds the decomposition method. Add a specialized overlay only when the supplied evidence triggers
it — an industry label does not load every overlay.
