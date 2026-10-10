# Skills-Layout Canvas: Buffett Framework

A self-contained, interactive map of how the `buffett-investment-framework` skill is
organized—the `SKILL.md` entry point, its three workflows, the eight reference modules
holding all 65 cards, and the router script—rendered with the metaproc ELK compound
canvas and built to export a clean tall poster PNG for the skill’s README.

The directory has no external dependencies at runtime: every asset lives in `vendor/`,
there is no build step, and the page opens directly from disk.
It is designed to be copied wholesale into another repository (e.g. as a `viz/`
subdirectory); nothing references files outside this folder.

## Quickstart

```bash
vendor/fetch-elk.sh          # once per checkout: downloads elkjs (1.5 MB, EPL-2.0)
open canvas-skills.html      # interactive canvas
./generate-posters.sh        # writes both poster PNGs to ./out (auto-fetches elkjs)
```

The repo’s top-level Makefile wraps these as `make setup`, `make open`, `make posters`,
and `make images` (see `docs/development.md`).

The elkjs bundle and its license are gitignored (`vendor/.gitignore`) and fetched from
unpkg by `vendor/fetch-elk.sh`; the other vendored assets are copies of unpublished
metaproc sources, so they are committed.

## What’s Here

| File | What it is |
| --- | --- |
| `canvas-skills.html` | The canvas page: hairline group frames, per-type colored icons, click a group’s title or chevron to expand, auto-fits the whole map to the viewport. All styling and harness JS are inline. |
| `data.js` | Hand-authored snapshot of the skill’s layout in the metaproc viz shape (not generated from the skill checkout). Edit this to change the map’s content. |
| `generate-posters.sh` | One-command poster export: light and dark PNGs, trimmed and quantized (see PNG Capture Mode). |
| `vendor/` | All runtime assets: design tokens, canvas CSS, icon registry, the ELK layout engine, and the viz renderer. |

`vendor/viz.js` is a fork of the metaproc viz renderer (via the finterm argument-map
spike) with three marked changes (search “SPIKE PATCH (skills-map)”): frame edge ports
sit at the vertical middle of the box, spacing options propagate into nested containers,
and sibling order follows the data instead of crossing minimization.

## Node Types

One box shape everywhere; color carries the type semantics: each box gets a dark icon
and a light background tint of the same hue (inverted in dark mode).
Sparkle (violet) for the skill root, folder (amber) for directories and card modules,
workflow glyph (teal) for the three task intents, file-text (warm tan) for plain files,
and a bulleted list (blue) for the 65 cards.
Identity is never color-alone—the glyph and label always carry it.
Siblings render in data order: `00-source-key` first, modules 01–08, and cards in ID
order within each module.

## PNG Capture Mode

`./generate-posters.sh [output-dir]` produces both finished posters (light and dark,
~2800px wide, trimmed to the content plus a 32px border, 256-color quantized).
It needs Google Chrome, macOS `sips`, and `uv` (pillow runs via `uvx`). To refresh a
README image in a consuming repo, point it at that repo’s image directory, e.g.
`./generate-posters.sh ../images`.

Under the hood, `?capture` renders just the map—no header, toolbar, chevrons, or
scrollbars, zoom pinned at exactly 100%, saved view state ignored—reports the capture
size (map plus a 16px border) in the document title as `capture <w>x<h>`, and declares a
matching single `@page` for PDF export.
`?capture=all` does the same with every group expanded; `&theme=dark` forces the dark
theme.

The script goes through PDF rather than a screenshot because Chrome’s screenshot path
silently stops painting very tall windows and ignores `--force-device-scale-factor` on
them, while PDF stays vector at any height; `sips` then rasterizes it at 2x. (A 1x
screenshot at exactly the reported `<w>x<h>` window size does work when a quick
single-theme capture is enough.)

Poster typography is set in the page CSS: card titles and frame headers both size from
the `--viz-header-font-size` token (16px here—element-level `font-size` never reaches
the title row), boxes and ELK spacing are tightened, and a measurement floor
(`.viz-node.viz-measure { min-width: 300px }`) puts most card titles on one line.

## Provenance

Grown from the finterm argument-map spike
(`docs/project/research/spikes/argument-map-figma/` in the finterm repo), which
benchmarked the metaproc ELK canvas over a published report’s argument tree.
This canvas deliberately simplifies it: one box shape with a small typed-icon
vocabulary, no argument semantics (direction, weight, stances, tooltips, drawer), inert
cards, and the capture mode above.
`vendor/tokens.css`, `viz.css`, and `icons.js` are unmodified copies of that spike’s
vendored assets; elkjs (EPL-2.0, `vendor/elkjs-license.txt`) is fetched from unpkg
rather than committed.

<!-- This document follows common-doc-guidelines.md.
See github.com/jlevy/practical-prose and review guidelines before editing.
-->
