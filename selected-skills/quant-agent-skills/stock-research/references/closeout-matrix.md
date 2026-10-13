# Closeout Matrix

This matrix maps market route to evidence required before saying a single-stock
L3 package is complete.

| Gate | A-share | H-share | U.S. equity | A/H overlay | ADR/HK overlay |
| --- | --- | --- | --- | --- | --- |
| Ledger reality | `trade_history.json` + `portfolio_state.json` | Same, with HKD/CNY handling | Same, with USD handling | Same | Same |
| Primary filings/financials | Tushare/DB + announcements | HK filings/annual/quarterly + yfinance fallback | SEC EDGAR or documented non-SEC filing fallback | Company-level files once | Company-level files once |
| Broker/research source | Eastmoney + RRS/Zsxq | HK collector + RRS/Zsxq | yfinance analyst + SEC + RRS/Zsxq/international reports | Both listing tickers in aliases | ADR and HK ticker aliases |
| Eastmoney proof | Required second dry-run `missing=0`, `short=0` | `eastmoney_not_applicable_hk` | Not applicable | Required if A-share thesis key exists | Not applicable unless A-share line exists |
| Public signal matrix | Required for event-driven theses | Required for event-driven theses | Required for event-driven theses | Same company matrix | Same company matrix |
| Agent evidence | Real six-agent IDs or fallback reason | Same | Same | Same | Same |
| Action semantics | Required | Required | Required | Required | Required |
| Trigger/watchlist/bridge | Required | Required | Required | Required with chosen security | Required with chosen security |
| Structured evidence counts | Saved collector row counts reconcile to curated ids or documented exclusions | Same | Same, including yfinance analyst rows | Same | Same |
| Vault SHA | Required | Required | Required | Required | Required |
| Quality gate | Required after all edits | Required after all edits | Required after all edits | Required after all edits | Required after all edits |

## Closeout Order

1. Confirm ledger reality and held-position wording.
2. Confirm market adapter evidence.
3. Confirm public signal matrix and expectation delta.
4. Confirm real agent evidence or honest fallback.
5. Upsert triggers and watchlist. Read back the exact trigger subtree, then
   write this run's exact `state_updates.consumed_trigger_ids` and exact
   `next_loop_trigger` ID into workflow evidence. Use
   `completion_mode=consumed_closeout` when a prior trigger was consumed; use
   `initial_non_consuming` with exact `[]` only for a real first run. Consumed
   rows must be retired with `resolved_date`; the successor is always distinct
   and pending, and initial mode cannot claim closed-loop completion.
6. Refresh `research_verdicts.json` sibling fields.
7. Regenerate `portfolio_research_bridge.md`.
8. Regenerate research-loop board.
9. Reconcile structured collector counts to curated evidence ids.
10. Run Vault SHA sync.
11. Run `quality_gate_check.py`.
    Treat it as a validating command that may refresh manifests or tracking
    artifacts, not as guaranteed read-only; final citations must use the
    post-command state after the last source edit.
12. Run clean-report scan, including proof files, historical fact-pack action
    leakage, and action-state label denial pollution. If the only hit is a
    proof/current-state sentence saying an active action label is absent,
    rewrite it to neutral absence wording and rerun Vault sync, gate, and scan.
    For global state, scan the same-code stock row, theme/industry candidate
    rows, `research_subjects.json` same-code candidates, and same-stock bridge
    rows, not only `watchlist.stocks`.

Any edit after step 10 invalidates Vault proof. Any edit after step 11
invalidates the quality gate.
