#!/bin/bash
# Downloads the elkjs layout runtime (1.5 MB, EPL-2.0) and its license from
# unpkg. Both files are gitignored (see .gitignore here); run once after
# checkout before opening canvas-skills.html — generate-posters.sh runs it
# automatically when the bundle is missing.
set -euo pipefail
cd "$(dirname "$0")"
V=0.10.0
curl -fsSL -o elk.bundled.js "https://unpkg.com/elkjs@$V/lib/elk.bundled.js"
curl -fsSL -o elkjs-license.txt "https://unpkg.com/elkjs@$V/LICENSE.md"
echo "downloaded elkjs@$V from unpkg (elk.bundled.js + elkjs-license.txt, EPL-2.0)"
