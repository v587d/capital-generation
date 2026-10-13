# stock-research Core Contract

This file is market-neutral. Load it for every single-stock L2+/L3 run before
loading a market adapter.

## First Principles

The job is not to prove a stock is good. The job is to decide whether the
current market price gives enough expected value after data quality, risk,
timing, and portfolio reality are considered.

Every conclusion must answer four questions:
- What is the market already pricing?
- Where is our view different, and why is that difference evidence-backed?
- What are the bull/base/bear probabilities and expected value?
- What action is allowed now, not after an imagined future trigger?

## Common Workflow

1. Check-first.
   - Read existing study files, `research_verdicts.json`, `watchlist.json`,
     `portfolio_research_bridge.md`, `trade_history.json`, and
     `portfolio_state.json`.
   - If the user reports a trade missing from the ledger, stop at
     `BLOCKED_LEDGER_MISSING_TRADE`. Do not repair this by changing prose.
   - Refresh decision when prior L3 exists: if study files already exist and
     the user requests L3 again, ask the user to choose between incremental
     refresh, full redo, or read-only review before doing either. Incremental
     refresh (preferred when prior L3 < ironclad-22's 7-day threshold and no
     new load-bearing event has occurred) reuses prior real agent evidence
     with `incremental_refresh_carrier` + documented rationale, reruns the
     three tools (forward PE / SOTP / earnings base), updates price and
     dates, and writes a new `thesis_id={ts_code}@{YYYYMMDD}` superseding the
     prior. Full redo re-spawns agents and re-collects data. Do not silently
     redo (wastes the prior evidence) or silently skip (ignores the request).

2. Route by market.
   - Use `references/market-router.md`.
   - Load exactly one primary market adapter from `references/markets/`.
   - Load an overlay only when the same company has another listed security.

3. Fill data through durable stores first.
   - Missing structured data means call the relevant collector/skill and verify
     local DB/RRS persistence before using it.
   - Web or search is support evidence unless no durable collector exists.

4. Build the public signal matrix before agent judgment when the thesis depends
   on news, policy, product, supply-chain, customer, export-control, earnings,
   orders, capacity, or technical-route changes.
   - Required files: `_public_signal_matrix_YYYYMMDD.md` and `.json`.
   - S2/S3 rows are leads unless verified by S0/S1 or two independent sources.
   - Every event must classify `delta_class` as `BEAT`, `IN_LINE`, `MISS`, or
     `AMBIGUOUS` against pre-event expectation and priced-in view.

5. Run six-lens evidence before final conclusion.
   - A user request for stock-research/L3 on a single stock authorizes the
     workflow's real parallel agent work when the host platform supports it.
   - If real agents are unavailable or explicitly prohibited, write
     `_agent_outputs_YYYYMMDD.json` with `fallback_reason`; never claim real
     agent completion.

6. Convert view into action semantics.
   - `current_action` must be one of `BUY_NOW`, `ADD_NOW`, `PROBE_ONLY`,
     `WAIT_PRICE`, `WAIT_EVENT`, `HOLD_MONITOR`, `NO_NEW_MONEY`, `NO_ACTION`.
   - Positive research is not a buy order. If EV/CAGR, risk/reward, trend, event
     risk, or ledger reality does not pass, `current_new_money_pct` is `0`.
   - `PROBE_ONLY` must be capped at 1-2%, include a stop/falsifier, and name the
     next review date.

7. Write five-file output and machine-readable state.
   - Required reader files: `README.md`, `深度研究.md`, `财务数据.md`,
     `研报索引.md`, `跟踪框架.md`.
   - Required machine files: `triggers_entry.json`, `watchlist_entry.json`,
     `_workflow_evidence_YYYYMMDD.json` or `.md`,
     `_agent_outputs_YYYYMMDD.json`, `_mcp_memory_graph_payload_YYYYMMDD.json`
     or explicit memory note, `_vault_sync_manifest_YYYYMMDD.json`.

8. Close only after current-state proof.
   - Upsert triggers/watchlist, refresh verdict sibling fields, regenerate
     bridge, refresh research-loop, sync Vault by SHA, then run quality gate.
   - Any edit to evidence, trigger, watchlist, verdict, bridge, or Vault proof
     invalidates older gate output.

## Hard Blocks

Return `BLOCKED` or `DONE_WITH_CONCERNS`; do not say `DONE`, when any of these
are true:
- ledger reality conflicts with research wording;
- current workflow evidence contains `ledger_missing_trade` or
  `BLOCKED_LEDGER_MISSING_TRADE`;
- market adapter evidence is missing;
- `_agent_outputs_YYYYMMDD.json` has no real agent IDs and no fallback reason;
- event-driven action lacks expectation-delta fields;
- trigger status is outside `pending/confirmed/invalidated/expired/retired`;
- Vault sync lacks source/Vault SHA proof;
- `quality_gate_check.py` returns `BLOCKED` or is stale after later edits.
