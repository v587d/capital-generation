# Upstream Record

- Project: The Investment Skills Lexicon
- Repository: https://github.com/finterm-ai/investment-skills
- Upstream commit: `7235d3411601036cc79137fa0aec0d587f2c8e19`
- License: MIT; see `LICENSE` copied from upstream.
- Imported content: complete upstream repository snapshot, including the Buffett framework skill and its references. Upstream scripts are retained as source material and are never executed by intake or activation.
- Local modifications: none to upstream files. This record and the Capital selected-skill catalog are maintained by Capital Generation.
- Packaging: a Capital-owned `.npmignore` beside these files excludes `images/` and `viz/` from the published npm package — 2.3 MB of upstream README artwork (the same four PNGs exist twice, in `images/` and `viz/out/`) plus the upstream visualization site; no skill body references either. The complete snapshot stays committed here, so `github:` installs and provenance review are unaffected.
- Maintenance snapshot (checked 2026-10-08): latest commit 2026-07-22; no later commits observed through the review date (78 days). See [GitHub commit history](https://github.com/finterm-ai/investment-skills/commits/main/).
- Runtime status: `experimental` / explicit experiment. The skill remains disabled until explicitly selected in Capital settings and is registered only in a Capital root Agent's own scope. Its capability tags and warning are maintained in `selected-skills/catalog.js`.
- Review status: imported for user-directed evaluation; not endorsed by Warren Buffett, Berkshire Hathaway, or Capital Generation. Its US-centric framework must not be treated as A-share rules. Validate all financial claims against primary evidence.
