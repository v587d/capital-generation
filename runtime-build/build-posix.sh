#!/usr/bin/env bash
# Maintainer-only POSIX pack builder. Runs on the matching host (Linux x64, macOS arm64, macOS x64):
#   bash runtime-build/build-posix.sh linux-x64 /tmp/cg-py-pack [base|parquet|all]
#   bash runtime-build/build-posix.sh darwin-arm64 /tmp/cg-py-pack
#   bash runtime-build/build-posix.sh darwin-x64 /tmp/cg-py-pack
# Requires curl, tar, uv, node and npm. Package names/versions come from runtime/manifest.json.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TARGET=${1:?target is required (linux-x64 | darwin-arm64 | darwin-x64)}
OUT=${2:-/tmp/cg-py-pack}
WHICH=${3:-all}
MANIFEST="$ROOT/runtime/manifest.json"

PYTHON_VERSION=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).python)" "$MANIFEST")
PBS_TAG=20261021
VERSION=$(node -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); const t=m.packs.base.targets[process.argv[2]]; if(!t){console.error('manifest 没有 target '+process.argv[2]);process.exit(1)}; process.stdout.write(t.version)" "$MANIFEST" "$TARGET")
BASE_DEPS=$(node -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(Object.entries(m.packs.base.packages).map(([n,v])=>n+'=='+v).join(' '))" "$MANIFEST")
PYARROW=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).packs.parquet.packages.pyarrow)" "$MANIFEST")

case "$TARGET" in
  linux-x64)
    [[ "$(uname -s)" == Linux ]] || { echo "build-posix: linux-x64 必须在 Linux 上构建" >&2; exit 1; }
    TRIPLE=x86_64-unknown-linux-gnu
    ;;
  darwin-arm64)
    [[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo "build-posix: darwin-arm64 必须在 Apple Silicon 上构建" >&2; exit 1; }
    TRIPLE=aarch64-apple-darwin
    ;;
  darwin-x64)
    [[ "$(uname -s)" == Darwin && "$(uname -m)" == x86_64 ]] || { echo "build-posix: darwin-x64 必须在 Intel Mac 上构建" >&2; exit 1; }
    TRIPLE=x86_64-apple-darwin
    ;;
  *)
    echo "build-posix: 未知 target：$TARGET" >&2
    exit 1
    ;;
esac

case "$WHICH" in
  base|parquet|all) ;;
  *) echo "build-posix: 未知 pack：$WHICH（只能是 base / parquet / all）" >&2; exit 1 ;;
esac

PBS_FILE="cpython-${PYTHON_VERSION}+${PBS_TAG}-${TRIPLE}-install_only_stripped.tar.gz"
PBS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${PBS_FILE//+/%2B}"

rm -rf "$OUT"
mkdir -p "$OUT"
echo "build-posix: $TARGET / CPython $PYTHON_VERSION / packs=$WHICH"
curl -L --fail --retry 3 --max-time 600 -o "$OUT/python.tar.gz" "$PBS_URL"
tar -xzf "$OUT/python.tar.gz" -C "$OUT"
rm -f "$OUT/python.tar.gz"

uv pip install --python "$OUT/python/bin/python3.13" \
  --target "$OUT/site-packages" --no-cache --only-binary=:all: --no-deps $BASE_DEPS

# Keep the interpreter relocatable and the npm tarball small.
rm -rf "$OUT/python/include" "$OUT/python/share" "$OUT/python/lib/pkgconfig" \
  "$OUT/python/lib/python3.13/test" "$OUT/python/lib/python3.13/idlelib" \
  "$OUT/python/lib/python3.13/tkinter" "$OUT/python/lib/python3.13/turtledemo" \
  "$OUT/python/lib/python3.13/ensurepip" "$OUT/python/lib/python3.13/venv" \
  "$OUT/python/lib/python3.13/lib2to3" "$OUT/python/lib/python3.13/site-packages" \
  "$OUT/python/lib/python3.13/config-"*
find "$OUT/python/bin" -maxdepth 1 \( -name 'pip*' -o -name 'idle*' -o -name 'pydoc*' -o -name '2to3*' \) -delete
find "$OUT/site-packages" -type d \( -name tests -o -name __pycache__ \) -prune -exec rm -rf {} +
find "$OUT/site-packages" -maxdepth 2 -type d -name bin -exec rm -rf {} +
find "$OUT/python" "$OUT/site-packages" \( -name '*.a' -o -name '*.lib' -o -name '*.pyc' \) -delete
# python-build-standalone ships `python/.gitignore` containing `*`, which makes npm skip the tree.
rm -f "$OUT/python/.gitignore" "$OUT/python/.lock" "$OUT/site-packages/.lock"
chmod 755 "$OUT/python/bin/python3.13"

# The interpreter tree does not carry CPython's license; fetch the exact tag's text.
curl -L --fail --retry 3 --max-time 120 -o "$OUT/CPYTHON-LICENSE.txt" \
  "https://raw.githubusercontent.com/python/cpython/v${PYTHON_VERSION}/LICENSE"

if [[ "$WHICH" == base || "$WHICH" == all ]]; then
  node "$ROOT/runtime-build/pack.mjs" \
    --kind base --target "$TARGET" --out "$OUT" --version "$VERSION" \
    --python-dir "$OUT/python" --site-dir "$OUT/site-packages" \
    --extra-license "CPython=$OUT/CPYTHON-LICENSE.txt"
fi

if [[ "$WHICH" == parquet || "$WHICH" == all ]]; then
  rm -rf "$OUT/parquet-site-packages"
  mkdir -p "$OUT/parquet-site-packages"
  uv pip install --python "$OUT/python/bin/python3.13" \
    --target "$OUT/parquet-site-packages" --no-cache --only-binary=:all: --no-deps "pyarrow==$PYARROW"
  find "$OUT/parquet-site-packages" -type d \( -name tests -o -name __pycache__ \) -prune -exec rm -rf {} +
  find "$OUT/parquet-site-packages" -name '*.pyc' -delete
  rm -f "$OUT/parquet-site-packages/.lock"
  node "$ROOT/runtime-build/pack.mjs" \
    --kind parquet --target "$TARGET" --out "$OUT" --version "$VERSION" \
    --site-dir "$OUT/parquet-site-packages" \
    --extra-license "CPython=$OUT/CPYTHON-LICENSE.txt"
fi

echo "build-posix: done ($(ls "$OUT"/*.tgz | tr '\n' ' '))"
