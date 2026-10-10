#!/bin/bash
# Regenerates the light and dark poster PNGs from canvas-skills.html.
#
#   ./generate-posters.sh [output-dir]     # default output-dir: ./out
#
# Pipeline (see README.md for why): headless-Chrome PDF export (vector, no
# tall-window raster cap) -> sips rasterize at 2x -> pillow trim to the
# content bounding box + 32px border -> 256-color quantize.
# Requirements: Google Chrome, macOS sips, uv (pillow runs via uvx).
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-out}"
mkdir -p "$OUT"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[ -f vendor/elk.bundled.js ] || vendor/fetch-elk.sh

# The page reports its own capture size in the document title.
SIZE=$("$CHROME" --headless --disable-gpu --window-size=800,600 \
  --virtual-time-budget=12000 --dump-dom \
  "file://$PWD/canvas-skills.html?capture=all" 2>/dev/null \
  | grep -o "capture [0-9]*x[0-9]*" | head -1)
W=$(echo "$SIZE" | sed 's/capture \([0-9]*\)x.*/\1/')
[ -n "$W" ] || { echo "could not read capture size from page title" >&2; exit 1; }
echo "canvas reports $SIZE; rasterizing at ${W}x2 px wide"

for theme in light dark; do
  url="file://$PWD/canvas-skills.html?capture=all"
  [ "$theme" = dark ] && url="$url&theme=dark"
  "$CHROME" --headless --disable-gpu --no-pdf-header-footer \
    --virtual-time-budget=15000 --print-to-pdf="$TMP/map-$theme.pdf" "$url" 2>/dev/null
  sips -s format png --resampleWidth $((W * 2)) \
    "$TMP/map-$theme.pdf" --out "$TMP/map-$theme.png" >/dev/null
done

uvx --with pillow python - "$TMP" "$OUT" <<'EOF'
import sys
from PIL import Image, ImageChops

tmp, out = sys.argv[1], sys.argv[2]
NAMES = {
    "light": "buffett-investment-framework-map.png",
    "dark": "buffett-investment-framework-map-dark.png",
}
# Background sample point, minimum luma difference that counts as content,
# poster border, and quantized palette size (matches the README description).
BG_PROBE = (5, 5)
CONTENT_THRESHOLD = 12
BORDER = 32
PALETTE_COLORS = 256
for theme, name in NAMES.items():
    im = Image.open(f"{tmp}/map-{theme}.png").convert("RGB")
    bg = Image.new("RGB", im.size, im.getpixel(BG_PROBE))
    diff = ImageChops.difference(im, bg).convert("L").point(
        lambda p: 255 if p > CONTENT_THRESHOLD else 0)
    b = diff.getbbox()
    m = BORDER
    crop = im.crop((max(0, b[0] - m), max(0, b[1] - m),
                    min(im.size[0], b[2] + m), min(im.size[1], b[3] + m)))
    q = crop.quantize(colors=PALETTE_COLORS, method=2, dither=Image.Dither.NONE)
    q.save(f"{out}/{name}", optimize=True)
    print(f"{out}/{name} {crop.size[0]}x{crop.size[1]}")
EOF
