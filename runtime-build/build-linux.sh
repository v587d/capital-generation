#!/usr/bin/env bash
# Convenience wrapper for the Linux x64 pack. See build-posix.sh for requirements.
#   bash runtime-build/build-linux.sh [/tmp/cg-py-pack] [base|parquet|all]
set -euo pipefail
exec "$(cd "$(dirname "$0")" && pwd)/build-posix.sh" linux-x64 "${1:-/tmp/cg-py-pack}" "${2:-all}"
