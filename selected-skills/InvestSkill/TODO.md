# TODO — InvestSkill

The curated top five. Everything else — with rationale, effort estimates, and release mapping — lives in the bilingual roadmap: [doc/IMPROVEMENT-ROADMAP.md](doc/IMPROVEMENT-ROADMAP.md) · [繁體中文](doc/IMPROVEMENT-ROADMAP-zh-TW.md). Progress against the roadmap's ten headline items is tracked in its §0 table.

The previous long-form backlog (last updated 2026-02-24) is archived at [doc/archive/TODO-2026-02.md](doc/archive/TODO-2026-02.md).

## Top 5

1. **`full-report --depth comprehensive` runs every framework** — add the frameworks missing since v1.8 (`bear-case` above all) plus the new Tier 1 skills where they fit, swap the alias modules for their targets, add `--skip <skill>`. → roadmap §4.3
2. **`--lang zh-TW` on every skill + a machine-readable JSON footer** — the remaining two items of the skill contract (§4.1); the footer is what lets `eval-skills.js` and `result-validator` parse results without regex on box-drawing characters.
3. **Learning lessons: Macro & the Fed Cycle, Options for Stock Investors** — the two §5.1 lessons still open (Lesson 5 has the material); plus self-check quizzes for Lessons 1–8 and the printable cheat sheet (§5.4). → roadmap §5.1, §5.4
4. **Non-US Investor Guide page** — Lesson 11's non-US section is the core; the page adds brokers, FX, and account opening (§5.4). Glossary: the ~16 filing / technical terms still missing (§5.3).
5. **Tier 2 skills as demand shows** — `forensic-accounting`, `proxy-governance`, `trade-postmortem` (closed `thesis-tracker` files are its input), `investment-policy`. → roadmap §3.2

## Recently shipped from the roadmap

- Stale counts fixed and historical docs archived (§7)
- Skill contract enforced on every analysis skill — `Data & Sources` header, Data Verification gate, Thesis Invalidation — with `scripts/check-skill-contract.js` in `npm test` (§4.1, §6.3)
- The three redirect skills reclassified as aliases; honest count of 24 frameworks (§4.2)
- `thesis-tracker` (§3.1)
- The rest of Tier 1 — `etf-analysis`, `earnings-preview`, `tax-lens` (with `--non-us`), `risk-stress-test`, `learning-coach` (§3.1)
- Learning track Part II — Lessons 9–13 (Before Your First Trade · ETFs · Taxes & Accounts incl. non-US · Earnings Season · Psychology & Process), the "When the Answer Is No" case study, self-check quizzes, glossary 44 → 76 (§5.1–5.3; see `doc/LEARNING-GAP-REVIEW.md`)
- `fact-check` — claim-level verification against primary sources, recomputation, corrected report with inline citations and References; Verification Score feeds `result-validator` Data Quality (not on the roadmap; added on request)
- `scripts/sync-prompts.js`, `scripts/new-skill.js`, `scripts/eval-skills.js`, `scripts/lib/signal-block.js` (§6.1, §6.2, §6.4, §6.11)

## Deliberately not planned

Live-data / broker APIs, crypto and forex, ML price prediction, and changes to the signal block — see roadmap §9 for why.
