# Upstream Record

- Project: China Stock Research Skills
- Repository: https://github.com/spikeHongg/china-stock-research-skills
- Upstream commit: `d49f1f360deac57821d5d6b3aff664dff232acc6`
- License: MIT; see `LICENSE` copied from upstream.
- Imported content: complete upstream repository snapshot for traceability; runtime catalog excludes `china-stock-research-orchestrator` because its orchestration conflicts with Capital's existing routing contract.
- Packaging: a Capital-owned `.npmignore` keeps the runtime body and this record in the published npm package and drops human-only repository material — `.github/` issue and PR templates, `examples/` sample dialogues, and the upstream README (both languages) plus SKILLS / CHANGELOG / CONTRIBUTING / INSTALL / GITHUB_PUBLISHING / PUBLISH_CHECKLIST / RELEASE_ASSETS / ROADMAP notes. `skills/shared/` must ship: all six selectable modules link into it (`../shared/references/…`, `../shared/templates/…` — 15 links) for the citation standard, industry overlays and output templates. The excluded orchestrator still ships as review material; nothing here is ever executed. The complete snapshot stays committed, so `github:` installs and provenance review are unaffected.
- Local modifications: none to upstream files. The upstream `.gitignore` (it ignored only `.DS_Store`) was removed from the snapshot: vendored snapshots do not carry ignore rules into this repo (`docs/dev/selected-skills.md` §8.6), and nothing committed was hidden by it. This record and the Capital selected-skill catalog are maintained by Capital Generation.
- Maintenance snapshot (checked 2026-10-08): latest commit 2026-03-09; no commits in the trailing 90 days; no later release was verified. See [GitHub commit history](https://github.com/spikeHongg/china-stock-research-skills/commits/main/).
- Runtime status: `watchlist` / explicit experiment. The snapshot is retained for provenance and can be selected skill-by-skill by the user, but every toggle is off by default. The upstream orchestrator remains excluded because it conflicts with Capital's routing contract.
- Review status: imported for comparison and user-directed experiments; not endorsed as a financial methodology. Review source quality, conflicts, omissions, and incremental value before relying on any module.
