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
`status`, `lastCommit`, `reviewBy` and `riskNote` are review metadata for this repository:
they drive the quarterly review cadence and the scan record, and they are deliberately not
rendered in the settings card, which shows the skill name, summary, capability tags and the
upstream repository link. A tag is not a guarantee of financial validity.

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

Upstream prose **is** edited when it fails the intake checklist — a skill that tells the
analysis role to run its own web search, to proceed on "training-data estimates", or to
invoke a helper script would otherwise route around this plugin's data boundaries with no
tool to stop it. Every such rewrite is mechanical, scoped to catalog-exposed skills, and
listed per category in that snapshot's `UPSTREAM.md`; `test/selected-skills-content.test.mjs`
re-checks the result on every run. Do not touch prose for taste, do not rename directories,
and leave skills that are not in the catalog exactly as upstream wrote them.

The full checklist lives in `docs/dev/selected-skills.md` §8.6. If a local adaptation is
required, record it in `UPSTREAM.md`. These are vendored snapshots, not GitHub forks or
submodules; use the original owner/repository URL and pinned commit for attribution.

See `docs/design/external-skill-intake.md` for the staged intake policy and
`docs/reference/external-skill-scan-2026-10.md` for the initial candidate scan.
