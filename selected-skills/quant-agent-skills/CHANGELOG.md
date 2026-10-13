# Changelog

## v1.0.0 (2026-08-05) — first open-source release

- Publish `concept-research` 1.3.2, `stock-research` 2.46.0, `industry-research` 1.8.4.
- Sanitization: personal absolute paths parameterized as `{{QUANT_ROOT}}`;
  internal components documented via glossary instead of being shipped.
- Add `template/` minimal adaptation skeleton and `docs/adaptation-guide.md`.
- Add `scripts/publish.sh` (only write path from local SSoT) and
  `scripts/guard.sh` (pre-push sanitization gate).

Upstream skill version history is preserved inside each `SKILL.md`
(versioned patch records) as the living changelog for methodology evolution.
