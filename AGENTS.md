# capital-generation

Unified financial data access for DeepSeek Harness (DSH): one entry point over AKShare (free fallback), THS fuyao (A-share quotes), and Wind (authoritative data) — with multi-agent orchestration on top. Lives in the DSH plugin ecosystem (MCP-based; zero TS required to wire in).

## Stack

- Python (3.12+ / 3.14 both fine), managed with `uv` — data layer and MCP servers (servers are Python, settled)
- TypeScript allowed where the DSH plugin ecosystem needs it (agent orchestration layer — design TBD, still learning)
- Layout: `core/` (data domain, protocol-free by intent — Python-leaning, not finalized) → `servers/` (MCP thin shells) → `agents/` (future DSH subagents, not implemented yet)

## Hard rules

- Tool names: `fin_data__*` (data) / `fin_agent__*` (orchestration). Once published, names and schemas are frozen
- Auth: BYOK only — no platform keys (vendors forbid resale; AKShare needs no key anyway)
- Every result carries `source` + `degraded` metadata; degradation must be observable
- Errors: AUTH/QUOTA → return immediately; RATE_LIMIT/TIMEOUT → backoff, then fallback-chain retry; otherwise → return for the caller to fix
- Reconciliation: unadjusted data only, free sources only (THS × AKShare); Wind is the benchmark, never a reconciliation participant
- Symbol normalization: thscode/windcode/plain → one canonical mapping (authoritative source: THS ticker list)

## Docs (progressive disclosure — read before changing design)

- `docs/DATA_MODEL.md` — L1 identity / L2 semantics (fixed: Asia/Shanghai ms timestamps, volume 手→股, explicit currency) / L3 conventions (annotate only, never convert)
- `docs/DEGRADATION.md` — per-domain fallback chains (quotes THS→AKShare→Wind; fundamentals Wind→THS→Tushare→AKShare; hot lists THS-exclusive)
- `docs/DESIGN_REVIEW.md` — agreed decisions & rationale (migrated from research session; ask before overturning)
- `docs/PYTHON.md` — Python style: annotations, dataclass models, no `dict[str, Any]`, lazy iteration, typed errors
- `docs/LESSONS.md` — scope rulings, verified contract facts & pitfalls (THS/Wind, from pi-fin-prism review; read before writing adapters)
- `PLAN.md` (repo root) — v0.1.0 scope & milestones; frozen `fin_data__*` tool surface lives here (read before implementing)

## Working style

- Every change ships with unit/smoke tests that guard three-source comparability
- Prefer the smallest change that fits the rules; when in doubt, check docs before code
