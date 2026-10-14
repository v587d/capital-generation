# Workflows

Card sequences, required inputs, and the output contract for the three task workflows routed from
*Choose the Workflow* in `SKILL.md`. Open the workflow you are running before applying
cards; each part is sized to arrive complete in one `read`.

## Run Financial Analysis

Require exact filings and periods, policies and notes, segment schedules, cash-flow and
capital-expenditure data, and material financing and obligation disclosures.
Treat market price as a separate input only when valuation is in scope.

1. Apply `F01` and `F05` to inventory the package and reconcile reported results into
   comparable segments without discarding genuine costs.
2. Apply `F02` to bridge reported earnings to a range of owner earnings.
   Add `F03` when maintenance, growth, restricted, or distributable capital must be
   separated. Show every maintenance-capital, working-capital, compensation, and
   recurring-cost judgment.
3. Apply `F06`, and `B06` when prospective reinvestment matters, to separate historical
   returns from the future reinvestment runway.
4. Add `F07`, `C02`, `R02`, and `R03` as needed to inventory obligations and stress
   financing, liquidity, collateral, and nonlinear claims.
5. Add `F04` for material partial ownership and only the triggered `S01`–`S11` overlay
   for industry-specific accounting or risk.

Return a package inventory, reported-to-analytical bridge, normalized segment base,
owner-earnings range, capital-return calculations, obligation ledger, assumptions,
sensitivities, and blocked calculations.

## Review an Investment Memo

Require the complete memo and appendices, cited primary sources and models, decision
question, horizon, business and management claims, valuation bridge, alternatives,
risks, and invalidation conditions.

1. Apply `D01` and `D03` to test estimability, separate facts, calculations, and
   inference, and seek disconfirming evidence.
   Add `D02` when ownership framing is material.
2. Apply `B02` to test a claimed moat as a causal mechanism.
   Add `B01` and only the relevant `B03`–`B07` cards when the memo’s claims require
   them.
3. Add only material `M01`–`M08` and `C01`–`C09` cards; use `C09` when a transaction is
   central.
4. Apply `V01`, `V05`, and `V06` to reconstruct value and expose sensitivities.
   Add `V03` when the normalized base is material and `V04` when projected growth
   contributes materially to value; use `D04` when price action is being treated as
   business evidence.
5. Apply `R01` and `R07` to trace owner harm and invalidation.
   Add `R02` or `R03` only for financing or contingent paths actually present.

Return one row per material claim: claimed consequence, evidence and source quality,
applicable cards, supported/challenged/unresolved disposition, counterevidence or
alternate mechanism, and evidence still needed.

## Evaluate a Thesis

Require explicit thesis components and horizon, primary evidence for the claimed
business and management mechanisms, valuation inputs, financing and risk evidence,
market price when price versus value is asked, and failure conditions.

1. Apply `D02`, `D03`, and `R07` to rewrite the thesis as testable components while
   preserving the author’s meaning and invalidation conditions.
2. Apply `B01`, `B02`, `B06`, and `B07` as relevant to test business mechanisms,
   incremental-return economics, and structural change.
3. Add only the `M01`–`M08` and `C01`–`C09` cards needed by stated management or
   allocation dependencies.
4. Apply `V01`, `V03`, `V04`, `V05`, and `V06` as relevant to reconstruct value from
   supplied evidence and keep quality, value, and price as separate judgments.
5. Add `R01`, `R02`, `R03`, and a triggered `S01`–`S12` overlay to trace owner-harm,
   financing, contingent, and specialized risks.

Return a component map, evidence and counterevidence table, mechanism tests, valuation
assumptions and sensitivities, owner-harm paths, invalidation indicators, missing
evidence, and a separate disposition for each component.
Do not aggregate component dispositions into an investment recommendation.

## Use This Output Contract

Every response must contain:

1. **Question and scope:** task intent, horizon, entity, and exclusions.
2. **Evidence receipt:** supplied primary evidence, periods, missing inputs, and source
   limitations.
3. **Card load:** five to 12 IDs and why each was selected.
4. **Analytical work:** sourced bridges, calculations, mechanism tests, and
   sensitivities.
5. **Findings:** supported, challenged, or unresolved, one decision question at a time.
6. **Counterevidence and alternatives:** strongest contrary account and competing
   mechanism.
7. **Limits and blocked branches:** missing evidence and uncertainty that affect the
   result.
8. **Monitoring and invalidation:** observations that would strengthen, weaken, revise,
   or retire each material finding.

End with an analytical summary, not a buy, sell, hold, entry-price, position-size, or
trade instruction.
