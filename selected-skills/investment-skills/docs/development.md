# Development

Internal dev notes for this repo.
The skill package itself lives in `skills/buffett-investment-framework/`; the
interactive layout map and its poster pipeline live in `viz/` (see
[viz/README.md](../viz/README.md) for how the canvas works).

## Tasks

Routine steps run through the top-level Makefile; `make` (or `make help`) lists them:

| Target | What it does |
| --- | --- |
| `make setup` | Fetch the elkjs layout runtime into `viz/vendor/` (gitignored; once per checkout). |
| `make validate` | Run the skill package’s own validator (`scripts/framework.py validate`). |
| `make posters` | Render the light and dark poster PNGs to `viz/out/`. |
| `make images` | Regenerate the README map images in `images/`. |
| `make open` | Open the interactive canvas (`viz/canvas-skills.html`) in a browser. |
| `make clean` | Remove fetched vendor files and generated posters. |

## Prerequisites

- `python3` for `make validate`.
- Google Chrome, macOS `sips`, and `uv` for the poster targets (the pipeline is
  macOS-specific; see the PNG Capture Mode section of `viz/README.md` for why it goes
  through PDF).

## Changing the Map

The map’s content is the hand-authored snapshot in `viz/data.js`; edit it when cards,
modules, or workflows change, then run `make images` to refresh the README posters.
`make images` writes both the light and dark variants; the top-level README currently
embeds only the light one.

<!-- This document follows common-doc-guidelines.md.
See github.com/jlevy/practical-prose and review guidelines before editing.
-->
