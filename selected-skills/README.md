# Selected Skills

This directory is the community-skill intake and provenance area for Capital Generation.
Every entry is an experimental snapshot: it is off by default, is never loaded
automatically, and is visible only to a newly created Capital root Agent after the
user explicitly enables it in the plugin settings card.

The runtime catalog and its capability tags live in [`catalog.js`](./catalog.js). The
catalog is intentionally broader than any default composition. A candidate may be
selectable while still carrying a `watchlist` status; that status is a visible signal
for the user to review the source and decide whether it fits the task.

## Layout

- `<project>/skills/`: upstream skill files, preserved at a pinned commit.
- `<project>/UPSTREAM.md`: repository URL, owner, commit, license, runtime scope,
  maintenance notes, and local changes.
- `<project>/LICENSE`: original upstream license.
- `catalog.js`: Capital-owned stable keys, labels, capability tags, and maturity notes.

Tags describe what a skill helps with, not whether it is trustworthy or recommended.
Status, last commit, review date, source owner, and risk notes remain visible beside
the toggle. A tag is not a guarantee of financial validity.

## Operating posture

The cold-start posture is intentionally permissive: once provenance, license,
permissions, auditability, financial-claim boundaries, and Capital compatibility are
understood, a pinned candidate can be offered as an explicit experiment. Maintenance
cadence, scores, benchmark results, and community response guide the status and review
interval; they do not by themselves hide a candidate from the user during this phase.
The Owner actively looks for useful projects and welcomes pull requests.

This does not grant upstream code new permissions. Upstream scripts are retained as
source material and are never executed by intake or activation. The Capital provider
scans only catalog-approved skill directories, registers only explicitly enabled names,
and does not register the upstream orchestrator that conflicts with Capital routing.

Do not edit upstream skill files casually. If a local adaptation is required, record it
in `UPSTREAM.md`. These are vendored snapshots, not GitHub forks or submodules; use the
original owner/repository URL and pinned commit for attribution.

See `docs/design/external-skill-intake.md` for the staged intake policy and
`docs/reference/external-skill-scan-2026-10.md` for the initial candidate scan.
