#!/usr/bin/env bash
# Convenience wrapper for macOS packs. Run on the matching architecture:
#   bash runtime-build/build-macos.sh arm64 [/tmp/cg-py-pack] [base|parquet|all]
#   bash runtime-build/build-macos.sh x64   [/tmp/cg-py-pack] [base|parquet|all]
set -euo pipefail
ARCH=${1:-arm64}
case "$ARCH" in
  arm64|x64) ;;
  *) echo "build-macos: arch 必须是 arm64 或 x64：$ARCH" >&2; exit 1 ;;
esac
exec "$(cd "$(dirname "$0")" && pwd)/build-posix.sh" "darwin-$ARCH" "${2:-/tmp/cg-py-pack}" "${3:-all}"
