# Output Contract

Use this contract for every stock-research L2+/L3 package.

## Reader Files

Each study directory must contain:
- `README.md` for current verdict, action semantics, file index, and proof
  summary.
- `深度研究.md` for thesis, market pricing, difference vs consensus,
  bull/base/bear EV, risks, and conclusion.
- `财务数据.md` for durable numeric evidence and source dates.
- `研报索引.md` for direct company coverage, summaries/news, cross-reads, and
  keyword leads.
- `跟踪框架.md` for KTI, catalysts, falsifiers, review dates, and research-loop
  state.

`财务数据.md` is not optional for stock packages. Do not replace it with
`数据手册.md`; that name can appear as an extra supporting file, but the stock
Vault sync gate validates `财务数据.md` by exact filename.

## Mechanical Reader Blocks

Before the first quality gate, L2+/L3 reader files must already contain the
mechanical blocks that downstream gates and humans need:
- evidence tags that separate `[事实]` from `[推断]`;
- confidence tags `[A]`, `[B]`, `[C]`, and `[D]` with a short meaning table;
- `承重数字结算表` in `深度研究.md`, with every load-bearing row marked
  `✅已结算` or `🔻已降级` and no load-bearing `❌未结算` row;
- TAM or market-size mapping for the businesses used in valuation, or an
  explicit `TAM_DATA_GAP` downgrade with searched keywords and a statement that
  TAM growth is not carrying the valuation;
- a valuation-router method keyword in the valuation section, such as `SOTP`,
  `rNPV_PS`, `DDM`, `P/B-ROE`, `PB-band`, `NAV`, or `PE`.

These are first-draft requirements, not warnings to patch only after an initial
gate failure.

## Machine Files

Each L3 closeout must be able to show:
- `_agent_outputs_YYYYMMDD.json`
- `_workflow_evidence_YYYYMMDD.json` or `.md`
- `_public_signal_matrix_YYYYMMDD.md` and `.json`, unless explicitly not
  applicable with reason
- `triggers_entry.json`
- `watchlist_entry.json`
- `_mcp_memory_graph_payload_YYYYMMDD.json` or explicit memory note
- `_vault_sync_manifest_YYYYMMDD.json`
- `_stock_earnings_model_YYYYMMDD.json` where the operating causal adapter is
  applicable; this is upstream earnings evidence, not the numeric return source.
- `_return_distribution_YYYYMMDD.json`, produced only through
  `forecast(contract, snapshot)` and immutable artifact persistence.
- `_scenario_probability_*` is legacy evidence only and has no current decision
  authority.

## Conclusion-First Return-Probability Contract

Any reader or machine output that discusses probability must lead with the exact
security, `as_of`, decision currency, 24-month settlement contract, valuation
archetype, model identity, publication stage, artifact filename/SHA-256, and the
evidence that would falsify or rerun the conclusion.

### Structured Claim Manifest Boundary

Numeric return claims are records in the immutable manifest; Markdown is only
the renderer's deterministic display projection. The exact live order is
artifact creation/save, strict direct-child captured-byte validation and load,
Claude agents producing probability-null PIT-bound conditional evidence,
exactly one manifest build/save/load, Leader consumption of the loaded manifest,
report prose, one renderer/CAS replacement, consumer audit, and the final
quality gate. There is no second manifest write.

<!-- RETURN_CLAIM_RUNTIME_CONTRACT_BEGIN -->
```yaml
return_claim_runtime_contract:
  schema_version: 1.0.0
  artifact_capture:
    direct_child_open_count: 1
    nofollow: required
    binds: [raw_bytes_sha256, stat_identity, strict_json_object]
    toctou_rule: same_captured_bytes_only
  runtime_order:
    - artifact_capture
    - artifact_save
    - artifact_load
    - agents_conditional_evidence
    - manifest_build
    - manifest_save
    - manifest_load
    - leader_manifest_consumer
    - report_prose
    - renderer
    - replacement_cas
    - quality_gate
  manifest_build_count: 1
  manifest_save_count: 1
  manifest_load_count_before_leader: 1
  manifest_writes_after_leader: 0
  manifest_persistence: locked_write_once_exact_bytes
  replacement_concurrency: locked_preimage_sha256_cas
  markdown_authority: display_only_deterministic_projection
  numeric_authority: CALIBRATED_MODEL_WEIGHT_only
  provisional_authority: sensitivity_only_not_formal
  withheld_numeric: null
  helper_state_authority: forbidden
  manual_or_prose_authority: forbidden
  pointer_policy:
    CONDITIONAL_SCENARIO_VALUE:
      authority_stage: CONDITIONAL_EVIDENCE
      value: finite
      artifact_value_pointer: null
      probability: null
      evidence_refs: required_pit_bound
    RETURN_PROBABILITY:
      authority_stage: CALIBRATED_MODEL_WEIGHT
      artifact_value_pointer: "/total_return_distribution/event_probabilities/{event_id}/probability"
    DECISION_BUCKET_PROBABILITY:
      authority_stage: CALIBRATED_MODEL_WEIGHT
      artifact_value_pointer: "/decision_probability_buckets/{bucket}"
    TAIL_PROBABILITY:
      authority_stage: CALIBRATED_MODEL_WEIGHT
      artifact_value_pointer: /tail_risk/probability_r_lte_severe_loss
    PROBABILITY_WEIGHTED_EXPECTED_RETURN:
      authority_stage: CALIBRATED_MODEL_WEIGHT
      artifact_value_pointer: /total_return_distribution/mean
    PROBABILITY_WEIGHTED_CAGR:
      authority_stage: CALIBRATED_MODEL_WEIGHT
      artifact_value_pointer: /total_return_distribution/mean_annualized_return
    PROBABILITY_WEIGHTED_TARGET_PRICE:
      authority_stage: CALIBRATED_MODEL_WEIGHT
      artifact_value_pointer: /total_return_distribution/mean_terminal_price
    PROBABILITY_WEIGHTED_TERMINAL_VALUE:
      authority_stage: CALIBRATED_MODEL_WEIGHT
      artifact_value_pointer: /total_return_distribution/mean_terminal_equity_value
    WITHHELD_NULL:
      value: null
      artifact_value_pointer: null
      authority_stage: withheld_reason_code
  consumer_allowlist:
    - auto_research/quality_gate_check.py
    - auto_research/toolchain/return_probability/gates.py
  capital_gates:
    - action_gate_passed
    - portfolio_risk_gate_passed
    - human_approved
    - execution_gate_passed
  literal_policy:
    normalization: NFKC+casefold
    rule: reserved_marker_and_numeric_token_on_same_normalized_line
  legacy_exception: immutable_pinned_path_span_sha_warn_only
  failure_codes:
    - RETURN_CLAIM_ARTIFACT_MISMATCH
    - RETURN_CLAIM_BLOCK_DUPLICATE
    - RETURN_CLAIM_BLOCK_MISSING
    - RETURN_CLAIM_BLOCK_TAMPERED
    - RETURN_CLAIM_MANIFEST_INVALID
    - RETURN_CLAIM_MANIFEST_MISSING
    - RETURN_PROBABILITY_ARTIFACT_IDENTITY_MISMATCH
    - RETURN_PROBABILITY_ARTIFACT_INVALID
    - RETURN_PROBABILITY_HELPER_INVALID
    - RETURN_PROBABILITY_LEGACY_INVENTORY_INVALID
    - RETURN_PROBABILITY_MANUAL_WEIGHT_BLOCKED
    - RETURN_PROBABILITY_REPORT_UNREADABLE
    - RETURN_PROBABILITY_RESERVED_NUMERIC_PROSE_BLOCKED
    - RETURN_PROBABILITY_SELL_SIDE_PROBABILITY_BLOCKED
    - RETURN_PROBABILITY_STATE_MUTATION_BLOCKED
```
<!-- RETURN_CLAIM_RUNTIME_CONTRACT_END -->

The manifest interfaces and discriminator table above are the project
`claims.py` contract. Do not add a skill-local schema, JSON writer, Markdown
parser, helper authority, or copied numeric source. Capture binds raw bytes,
SHA-256, same-fd stat identity, and strict JSON object; persistence is locked
write-once, and replacement is locked preimage-SHA-256 CAS. A conditional record
must have non-empty snapshot-matching `evidence_refs`,
`authority_stage=CONDITIONAL_EVIDENCE`,
`artifact_value_pointer=null`, and `probability=null`.

Only `CALIBRATED_MODEL_WEIGHT` may carry an artifact-pointer-backed numeric
claim. Withheld records have null value/pointer; provisional evidence is
sensitivity-only. The renderer owns the single claims block. Reserved
marker-plus-number lines are evaluated after NFKC+casefold normalization.
Pinned legacy path/span/SHA bytes are WARN-only. The two listed quality
consumers are the closed allowlist, and action, portfolio-risk, human approval,
and execution remain four independent capital gates.


Publication rules are mechanical:

- Decision buckets are loss (`R < 0%`), below hurdle
  (`0% <= R < 32.25%`), and hurdle pass (`R >= 32.25%`). They are copied only
  from the same schema-valid `_return_distribution_YYYYMMDD.json` as tail risk.
- Sell-side Bull/Base/Bear are conditional cases with assumptions, valuation
  method, and conditional value. They contain no probability column or agent
  supplied numeric weight.
- `WITHHELD_DATA_INCOMPLETE`, `WITHHELD_UNSUPPORTED_ARCHETYPE`,
  `WITHHELD_INFERENCE_FAILURE`, and `WITHHELD_MODEL_CONTRACT_FAILURE` mean
  numeric probability = null. State the reason; do not restore a manual number
  and do not generate formal probability-weighted EV.
- `PROVISIONAL_UNCALIBRATED` is the sole model-only numeric source and may
  support only explicitly labeled sensitivity EV.
- `CALIBRATED_MODEL_WEIGHT` may carry formal probability-weighted research
  value only after preregistered OOS skill/stability, independent validation,
  explicit human approval, and active model-inventory authorization.
- Hand-entered numeric weights, agent votes, and legacy EPS/scenario posterior
  are not fallbacks. Action, portfolio-risk, approval, and execution gates remain
  independent downstream; no stage grants trade authority.
- For upstream causal-EPS audit history, the existing 31-realized-sample rule is
  retained: below it use `posterior_probabilities=null` and
  `WITHHELD_INSUFFICIENT_BASE_RATE_SAMPLES`; raw output is labeled
  **uncalibrated model path mass** and never mapped into return buckets.

### thesis_id 单代码硬规则（含 A/H）

`triggers_entry.json` 的 `thesis_id` 必须满足
`common/thesis_schema.validate_thesis_id`：**`<ts_code>@YYYYMMDD`，且 `@` 前只能是
`ts_code` 本身**（`scripts/research_review_reminder.py` 按最后一个 `@` 解析日期，
日期后不得再挂语义后缀）。A+H 同公司研究**不得**使用组合 ID
（如 `601869.SH_06869.HK@20260719`——校验直接拒绝写入）：选行动/主研究证券的
单代码作为 `ts_code` 与 `thesis_id` 前缀（A 股东财腿优先用 A 代码），另一上市线
写入 `same_company_security` / verdict sibling `related_codes` 和 trigger
`keywords`。语义（wait-event / no-new-money 等）只进 trigger id、note、evidence
字段，不进 `thesis_id`。

## Required Machine Fields

The package must expose, directly or through current verdict/watchlist payloads:
- `current_action`
- `current_new_money_pct`
- `max_position_after_trigger_pct`
- `trigger_required`
- `next_review_date`
- `stop_or_falsifier`
- `street_revision_delta` when there is recent broker or street estimate
  revision pressure
- `event_expectation_delta` when a public event affects the thesis
- `ledger_reality_check` for every held or user-reported position

## Structured Evidence Consistency

Collector persistence counts are hard evidence. If a workflow step says a
collector saved `N` durable rows, the current package must reconcile that count
across the reader-facing report index, workflow evidence, curated evidence JSON,
and closeout proof.

Hard pass requires one of:
- all `N` row ids are listed with source, date, and evidence role; or
- excluded rows are named and given a reason such as duplicate, malformed,
  superseded, or non-bearing noise.

Do not write "yfinance saved 6 rows" while curating only 5 ids. Target price,
recommendation trend, revenue estimates, EPS estimates, EPS trend, and growth
estimates are separate rows when the collector saves them separately.

## Historical Fact-Pack Hygiene

`_fact_pack_YYYYMMDD.*` may preserve earlier verdicts, prices, costs, and action
strings as audit history. It must not make an old action look current.

When a new package carries forward an older verdict/action from prior research,
the historical record must include:
- `historical_as_of` or equivalent date/source label;
- `superseded_by_study_date` or `superseded=true`;
- `current_treatment`, such as `historical_only`, `superseded_by_latest_verdict`,
  or `do_not_use_as_current_action`.

Do not copy old `BUY_NOW`, `ADD_NOW`, `PROBE_ONLY`, `WAIT_PRICE`, `WAIT_EVENT`,
or trigger-action strings into current verdict fields unless they have been
recomputed in the current study. Current-state payloads should point to the
latest `current_action/current_new_money_pct/max_position_after_trigger_pct`,
not to the prior fact-pack wording.

## Machine-Evidence Lexeme Neutrality (v2.43.2, 2026-07-29 生益科技实证)

Quality gates match blocker lexemes mechanically; negation context does NOT
exempt them. Writing `无 BLOCKED_LEDGER_MISSING_TRADE` in
`_workflow_evidence_*.json` (or any machine JSON) is read as the block being
present and fails §7.9d. In all machine-state files (workflow evidence, agent
outputs, proof, payloads):

- use neutral absence wording: `零持仓，账本与研究口径一致，无账本缺失项`;
- or boolean fields: `ledger_block_terms_absent=true`,
  `immediate_trade_state_absent=true`, `trade_plan_state_absent=true`;
- never spell out `BLOCKED_LEDGER_MISSING_TRADE`, `ledger_missing_trade`,
  `BUY_NOW`, `ADD_NOW`, `PROBE_ONLY`, `TRADE_PLAN_READY`, or
  `execute_trade:add` merely to say they are absent.

## Completion Wording

Use:
- `PASS` only when every hard gate is proven on current files.
- `PASS_WITH_WARNINGS` only when remaining warnings are global infra or
  explicitly non-study issues.
- `BLOCKED` when any hard gate is missing, stale, contradictory, or unavailable.

Never describe `WAIT_PRICE`, `WAIT_EVENT`, `HOLD_MONITOR`, or
`NO_NEW_MONEY` as a buy signal.

For proof/current-state hygiene, do not leave active action-state labels such
as `BUY_NOW`, `ADD_NOW`, `PROBE_ONLY`, `TRADE_PLAN_READY`, or
`execute_trade:add` in negative absence prose merely to prove they are absent.
Use neutral reader wording or boolean fields instead, then rerun the focused
clean scan.
