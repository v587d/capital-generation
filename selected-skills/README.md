# Selected Skills

This directory is the community-skill intake and provenance area for Capital Generation.
Every entry is an experimental snapshot: it is off by default, is never enabled
automatically, and after the user explicitly enables it in the plugin settings card
it is visible only to the Capital role(s) declared in `routing.js` (main Agent,
data analysis, or retrieval/evidence).

The runtime catalog, display tags and provenance live in [`catalog.js`](./catalog.js); role ownership and trigger text live in [`routing.js`](./routing.js). The human-readable 70-row review table is [`ROUTING.md`](./ROUTING.md). Actual loads are recorded programmatically by the role-scoped provider (`skills_used` in the role prompt, `npm run report:skill-usage` for the session-log audit). The
catalog is intentionally broader than any default composition. A candidate may be
selectable while still carrying a `watchlist` status; that status is a visible signal
for the user to review the source and decide whether it fits the task.

## Layout

- `<project>/<skills root>/`: the selectable skill bodies, preserved at a pinned commit. The
  root is not always `skills/` — it is declared per repository in `SELECTED_SKILL_SKILL_DIRS`
  (`catalog.js`), because upstreams lay skills out differently: one buries them under a
  plugin directory, one groups them two levels deep, and the A-share snapshot has six
  parallel roots, of which exactly one is registered (the line upstream itself calls the
  source of truth). Only the bodies in `catalog.js` are kept: everything else the upstream
  shipped — other skills, scripts, MCP servers, evaluation fixtures, docs, sites, CI — was
  deleted from this repository, not merely excluded from the package. The one exception is
  `china-stock-research-skills/skills/shared/`, whose reference files the six A-share skills
  link to directly.
- `reference-algorithms/`: pure formula implementations moved out of the runtime tree
  (43 finance `calculate.py` files plus the trading `_lib/calculations.py`). Git-only, never
  packaged, never executed and never pointed at by a skill body; `README.md` there is the
  index. They exist as upgrade material for a future computation surface, nothing else.
- `<project>/UPSTREAM.md`: repository URL, owner, commit, license, runtime scope,
  maintenance notes, local changes, and the deletion record for everything not kept.
- `<project>/LICENSE`: original upstream license.
- `catalog.js`: Capital-owned stable keys, labels, capability tags, and maturity notes.

Tags describe what a skill helps with, not whether it is trustworthy or recommended.
`status`, `lastCommit`, `reviewBy` and `riskNote` are review metadata for this repository:
they drive the quarterly review cadence and the scan record, and they are deliberately not
rendered in the settings card, which shows the skill name, summary, capability tags, the
preset that can load it, its trigger/keyword line and the upstream repository link. A tag
is not a guarantee of financial validity.

## Operating posture

The cold-start posture is intentionally permissive: once provenance, license,
permissions, auditability, financial-claim boundaries, and Capital compatibility are
understood, a pinned candidate can be offered as an explicit experiment. Maintenance
cadence, scores, benchmark results, and community response guide the status and review
interval; they do not by themselves hide a candidate from the user during this phase.
The Owner actively looks for useful projects and welcomes pull requests.

This does not grant upstream code new permissions. The runtime tree carries Markdown only:
no scripts, no MCP servers, no evaluation fixtures, no non-catalog skills. Pure formula
implementations live in `reference-algorithms/`, are never packaged, and are never executed.
The Capital provider scans only catalog-approved skill directories and registers only
explicitly enabled names.

Upstream prose **is** edited when it fails the intake checklist — a skill that tells the
analysis role to run its own web search, to pick a data vendor, to invoke a helper script, or
to proceed on "training-data estimates" would otherwise route around this plugin's data
boundaries with no tool to stop it. Where data comes from is stated once, in the
`capital:data-contract` role-prompt section; each skill only declares what evidence it needs
(`## Evidence request`) and leaves the retrieval route to the host. Every rewrite is
mechanical, listed per category in that snapshot's `UPSTREAM.md`, and re-checked by
`test/selected-skills-content.test.mjs` and `test/selected-skills-structure.test.mjs` on every run.
Do not touch prose for taste and do not rename directories.

The full checklist lives in `docs/dev/selected-skills.md` §8.6. If a local adaptation is
required, record it in `UPSTREAM.md`. These are vendored snapshots, not GitHub forks or
submodules; use the original owner/repository URL and pinned commit for attribution.

See `docs/design/external-skill-intake.md` for the staged intake policy and
`docs/reference/external-skill-scan-2026-10.md` for the initial candidate scan.
