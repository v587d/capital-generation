---
name: stock-research
description: |
  Quant single-stock research orchestrator for A-share, H-share, U.S. equity, A/H, and ADR/HK L2+/L3 work.
  Use for single-stock research, held-position refresh, stock comparison, action semantics, and closeout-ready five-file packages.
  Broad stock discovery must route to l3-candidate-queue before full L3.
metadata:
  version: 2.46.0
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - EnterWorktree
  - ExitWorktree
---

> **公开版适配说明（v1.0.0）**：本 skill 来自作者个人量化系统，命令和文件路径是
> 作者技术栈的具体实现。使用前请先读术语表与适配指南：
> https://github.com/Howard-Jerry/quant-agent-skills/blob/main/docs/adaptation-guide.md
> `{{QUANT_ROOT}}` 是你的量化项目根目录；`RRS`/`research_report`/`Vault`/
> `scripts/*.py` 等是作者配套组件，公开版不附带，请按指南替换为你自己的
> 数据层与知识库（最小骨架见仓库 `template/` 目录）。

# stock-research

This is the canonical single-stock research skill. If you maintain platform
copies (e.g., a Codex-side override), keep them structurally aligned with this
canonical file, but do not blindly overwrite one with the other.

The old failure mode was one huge skill mixing common L3 rules, A-share rules,
HK rules, partial U.S. rules, overlays, and historical patches. The new shape is:
thin router first, market adapter second, shared closeout contract last.

## First Decision

Before doing research, classify the request.

| Request | Action |
| --- | --- |
| "找票", "哪些值得 L3", "提高研究效率", broad watchlist triage | Use `l3-candidate-queue`; do not run full L3 first. |
| One concrete stock, L2+/L3, update, held-position refresh, or action question | Use this skill. |
| Trade ledger correction from screenshots or fills | Use `brokerage-trade-screenshot-import` or `portfolio-cost-correction` first. |
| Portfolio sizing across names | Use latest `research_verdicts.json` and portfolio skills after stock verdicts are current. |

For a single-stock L3, run the workflow's real six-agent evidence when the host
agent platform supports it. If real agents are unavailable or the user forbids
delegation, write `fallback_reason`; never claim local review is real agent
output.

## Load References

Always read these first:
- `references/core-contract.md`
- `references/market-router.md`
- `references/output-contract.md`
- `references/closeout-matrix.md`

Then read exactly one primary market adapter:
- `references/markets/a-share.md`
- `references/markets/h-share.md`
- `references/markets/us-equity.md`

Read an overlay only when the same company has another listed security:
- `references/overlays/ah-overlay.md`
- `references/overlays/adr-hk-overlay.md`

Use existing step files for detailed execution only after the route is known:
- `steps/01-check-first.skill.md`
- `steps/02-data-collection.skill.md`
- `steps/03-deep-analysis.skill.md`
- `steps/04-output-delivery.skill.md`
- `steps/05-quality-portfolio.skill.md`

## Market Routing

| Ticker / listing | Primary adapter | Overlay |
| --- | --- | --- |
| `*.SH`, `*.SZ`, `*.BJ`, six-digit A-share | `a-share.md` | `ah-overlay.md` if same company has H-share |
| `*.HK`, five-digit HK code, pure Hong Kong listing | `h-share.md` | `adr-hk-overlay.md` if ADR exists |
| U.S. ticker, `*.US`, U.S. primary listing | `us-equity.md` | `adr-hk-overlay.md` for ADR/HK dual listings |
| A/H pair such as `002594.SZ/01211.HK` | security being evaluated | `ah-overlay.md` |
| ADR/HK pair such as `BABA/9988.HK` | security being evaluated | `adr-hk-overlay.md` |

Research the company once. Listing choice is an overlay, not a second company
thesis.

## Non-Negotiable Core Gates

1. Check-first before new work.
   - Read existing study directory, `research_verdicts.json`, `watchlist.json`,
     `portfolio_research_bridge.md`, `trade_history.json`, and
     `portfolio_state.json`.
   - If the user reports a trade missing from the ledger, stop at
     `BLOCKED_LEDGER_MISSING_TRADE`.

2. DB-first data discipline.
   - Missing local data means call the existing collector/skill and verify
     persistence before using it.
   - Do not use one-off API/web facts as if they were durable DB evidence.

3. Market adapter evidence.
   - A-share: Eastmoney text/PDF plus RRS to `research_report` dry-run/write/dry-run.
     Event-driven A-share L2+/L3 also needs S0 announcement fallback when the
     announcement collector returns 0 rows; a collector miss is not proof that
     no company disclosure exists.
   - H-share: `eastmoney_not_applicable_hk`, HK collector, yfinance/AAStocks,
     RRS/Zsxq overseas search, currency basis.
   - U.S. equity: SEC EDGAR/yfinance analyst collectors, RRS/Zsxq overseas
     search, filing form/date proof, GAAP vs non-GAAP basis.

4. Fresh Public Signal Sweep.
   - Required for event-driven theses.
   - S2/S3 rows are only leads unless verified.
   - Every material event must be `BEAT`, `IN_LINE`, `MISS`, or `AMBIGUOUS`
     against pre-event expectation and priced-in view.

5. Six-agent evidence before final conclusion.
   - Real A1-A6 agent IDs/workflow run evidence when tools exist.
   - If tools are unavailable or user forbids delegation, write a clear
     `fallback_reason`; do not pretend local review is real agent output.

6. Action semantics before positive wording.
   - Required fields: `current_action`, `current_new_money_pct`,
     `max_position_after_trigger_pct`, `trigger_required`,
     `next_review_date`, `stop_or_falsifier`.
   - `WAIT_PRICE`, `WAIT_EVENT`, `HOLD_MONITOR`, and `NO_NEW_MONEY` are not buy
     signals.
   - Review-only price or valuation triggers with `current_new_money_pct=0` use
     `action=re_research` or `watch` and `status=pending` while proof is still
   required. Do not mark them `confirmed` merely because price touched the
   review band after the re-research has already completed.

**Return-probability publication and conclusion-first delivery (hard gate).**
   - L2+/L3 routes the valuation archetype, freezes the PIT evidence snapshot,
     retains dated `_stock_earnings_model_*` as upstream causal operating
     evidence where applicable, then calls `forecast(contract, snapshot)`.
   - The sole active publication order is immutable artifact forecast/save,
     strict captured-byte validation and load, real Claude agents producing
     PIT-bound `CONDITIONAL_SCENARIO_VALUE` records with `probability=null`,
     exactly one manifest build/save/load, Leader consumption of that loaded
     manifest, report prose, deterministic renderer plus locked CAS replacement,
     then the final consumer audit and quality gate. Leader and prose start only
     after manifest load; no manifest write occurs after Leader.
   - `_return_distribution_YYYYMMDD.json` is the sole current numeric source.
     Decision buckets are loss (`R < 0%`), below hurdle
     (`0% <= R < 32.25%`), and hurdle pass (`R >= 32.25%`). Sell-side
     Bull/Base/Bear remain conditional cases without probabilities.
   - Wave 0 has no predictive adapter. `WITHHELD_UNSUPPORTED_ARCHETYPE` and
     every other withheld stage require numeric probability = null, an exact
     reason, no manual fallback, and no formal probability-weighted EV.
   - `PROVISIONAL_UNCALIBRATED` is model-only numeric evidence and may support
     labeled sensitivity EV. Only a registry-authorized
     `CALIBRATED_MODEL_WEIGHT` may carry formal probability-weighted research
     value after preregistered OOS skill/stability, independent validation, and
     explicit human approval.
   - `_scenario_probability_*` and manual weights are legacy history only.
     Markdown, report prose, helper state, agent votes, and manually copied
     values are never claim authority; the renderer owns the sole claims block.
     Existing action, portfolio-risk, approval, and execution gates remain
     independent downstream; no probability stage grants trade authority.
   - Preserve the upstream causal-EPS audit rule as history, not as the return
     target: record `target_year` and EPS P10/P50/P90; below 31 realized
     PIT-aligned samples, require
     `posterior_probabilities=null` and
     `WITHHELD_INSUFFICIENT_BASE_RATE_SAMPLES`; any raw output is only
     uncalibrated operating model path mass and cannot populate return buckets.

7. Five-file plus machine state.
   - Reader files: `README.md`, `深度研究.md`, `财务数据.md`, `研报索引.md`,
     `跟踪框架.md`.
   - For stock L3 packages, `财务数据.md` is a mandatory exact filename.
     `数据手册.md` may be an extra supporting file, but it is not a substitute;
     `scripts/sync_stock_research_to_vault.py` blocks stock packages without
     `财务数据.md`.
   - Before the first quality gate, L2+/L3 reader files must already contain
     mechanical reader blocks: `[事实]/[推断]`, `[A]/[B]/[C]/[D]`, a
     `承重数字结算表` using `✅已结算` / `🔻已降级`, TAM/market-size mapping
     or `TAM_DATA_GAP`, and a valuation-router method keyword such as `SOTP`,
     `rNPV_PS`, `DDM`, `P/B-ROE`, `PB-band`, `NAV`, or `PE`. These are
     first-draft requirements, not post-gate patch tasks.
   - Machine files: `_agent_outputs_YYYYMMDD.json`,
     `_workflow_evidence_YYYYMMDD.json` or `.md`, public signal matrix when
     applicable, `triggers_entry.json`, `watchlist_entry.json`, memory payload,
     and Vault manifest.
   - When a completed run consumes an earlier trigger and leaves one successor,
     `_workflow_evidence_YYYYMMDD.json::state_updates` must write
     `consumed_trigger_ids` as the exact non-empty list of source trigger IDs and
     `next_loop_trigger` as the exact successor `trigger_id` (not a label), plus
     `completion_mode=consumed_closeout`.
     Every consumed ID must read back from `triggers_entry.json` as
     `status=retired` with non-empty `resolved_date`; the successor must be one
     distinct `status=pending` row. A first-run package with no predecessor uses
     `completion_mode=initial_non_consuming` with `consumed_trigger_ids=[]`,
     still names one pending successor, and must not claim closed-loop conservation.
   - For A-share `watchlist_entry.json`, use the canonical suffixed code in both
     `ts_code` and `code` (for example `300620.SZ`, not bare `300620`). The
     watchlist helper replaces by exact `code`; a later suffix repair can append
     a duplicate same-stock row unless the stale bare row is removed and the
     target subtree is re-read.
   - Structured collector counts must reconcile. If yfinance, SEC, Eastmoney,
     or another collector saves `N` durable rows, the report index, workflow
     evidence, curated evidence JSON, and closeout proof must list those `N`
     ids or explain excluded rows. Do not cite "saved 6 rows" while curating
     only 5.

8. Verdict lands in research_verdicts.json (2026-06-22 补丁：半截子交付教训).
   - `_agent_outputs_YYYYMMDD.json` existing with non-null agent IDs but no
     matching `research_verdicts.json[ts_code]` entry (or entry with
     `verdict=null`) is a BLOCKED half-done closeout, not DONE.
   - Before closeout: assert the study-date `_agent_outputs_*.json` implies a
     `research_verdicts.json[ts_code]` entry with non-null `verdict` /
     `current_action` / `current_new_money_pct`. Leader verdict must land in
     research_verdicts.json, not only in the agent evidence file.
   - Closes the 2026-06-22 gap: 6 agents ran, evidence file wrote,
     verdict=None, 深度研究.md untouched, no gate/Vault sync.

## Closeout Order

Do not say `DONE`, `完成`, or `L3已闭环` until the current files pass this order:

1. ledger reality and held-position wording;
2. market adapter coverage;
3. public signal matrix and expectation delta;
4. six-agent evidence or honest fallback;
5. `thesis_triggers_upsert.py --stock-entry-file`;
   - Read back the exact trigger subtree. Before closeout, bind this run in
     `_workflow_evidence_YYYYMMDD.json::state_updates` to the exact
     `consumed_trigger_ids` and exact successor ID described above. If the
     producer cannot name the consumed trigger, keep the run BLOCKED instead of
     choosing any older retired trigger from the same thesis.
6. `watchlist_upsert.py --stock-entry-file`;
7. refresh `research_verdicts.json` sibling fields;
   - `thesis_triggers_upsert.py` only writes `thesis_id` and `triggers[]`.
     Before bridge/loop/gate, explicitly refresh the target
     `research_verdicts.json[ts_code]` sibling fields: `verdict`, `action`,
     `current_action`, `current_new_money_pct`,
     `max_position_after_trigger_pct`, position facts, risk flags,
     `next_review_date`, and `research_path`; then read back the exact subtree.
   - After `watchlist_upsert.py`, read back `watchlist.json::stocks` for the
     target stock and prove there is exactly one canonical row. If a previous
     bare-code row remains, remove only that same-stock stale row and rerun from
     step 6.
8. `scripts/generate_bridge.py`;
9. `scripts/build_research_loop_board.py --ts-code <ts_code> --json`;
   - If a 0-new-money review trigger renders as `TRADE_PLAN_READY` or another
     trade-plan state, fix both trigger `action` and `status`, refresh
     `research_verdicts.json` sibling fields, then rerun from step 5.
10. `scripts/sync_stock_research_to_vault.py <research_dir or code> --json`;
11. `python auto_research/quality_gate_check.py <research_dir>`;
   - Treat the gate as a validating command that can refresh manifests or
     tracking artifacts, not as guaranteed read-only. If it changes final-state
     evidence, cite the post-command state and rerun any affected Vault/gate
     evidence after the last source edit.
12. clean-report scan for stale dates, stale prices, stale verdicts, historical
    fact-pack action leakage, provider fallback wording, and action-state label
    denial pollution. Do not leave `BUY_NOW`, `ADD_NOW`, `PROBE_ONLY`,
    `TRADE_PLAN_READY`, or `execute_trade:add` in negative proof/current-state
    prose merely to prove they are absent; use neutral absence wording.
    The scan scope for global state includes same-code rows in
    `watchlist.json::stocks`, `watchlist.json::industries[].candidates`,
    `research_subjects.json`, and same-stock bridge rows.
13. structured-evidence count scan: saved collector row counts match curated ids
    in report index / workflow evidence / closeout proof, or exclusions are
    explicitly documented.

Any evidence, trigger, watchlist, verdict, bridge, or Vault edit after steps
10-11 invalidates the old closeout proof.

## Output Labels

Use:
- `PASS` only when current files prove every hard gate.
- `PASS_WITH_WARNINGS` only for global infra or clearly non-study warnings.
- `BLOCKED` when any market adapter, ledger, agent, Vault, or gate proof is
  missing or stale.

When closeout appears complete, run `stock-l3-closeout-proof` before final
answering.
