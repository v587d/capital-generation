# Repo tasks: skill validation and the viz poster pipeline (see viz/README.md).
# `make` lists targets; poster targets need Google Chrome, macOS sips, and uv.

.DEFAULT_GOAL := help
.PHONY: help setup validate posters images open clean

help:  ## List available targets
	@grep -E '^[a-z][a-z-]*:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

setup: viz/vendor/elk.bundled.js  ## Fetch the elkjs runtime (once per checkout)

viz/vendor/elk.bundled.js:
	viz/vendor/fetch-elk.sh

validate:  ## Validate the 65-card skill package
	python3 skills/buffett-investment-framework/scripts/framework.py validate

posters: setup  ## Render light + dark poster PNGs to viz/out
	cd viz && ./generate-posters.sh

images: setup  ## Refresh the README poster PNGs in images/
	cd viz && ./generate-posters.sh ../images

open: setup  ## Open the interactive canvas in the default browser
	open viz/canvas-skills.html

clean:  ## Remove fetched vendor files and generated posters
	rm -f viz/vendor/elk.bundled.js viz/vendor/elkjs-license.txt
	rm -rf viz/out
