#!/usr/bin/env bash
# 脱敏闸：发布前禁止以下模式出现在公开仓库正文。
# 用法: bash scripts/guard.sh（publish.sh 会自动调用）
set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

BANNED=(
  'jerrywang'
  '/Users/'
  '@w_jerry'
  'Jerry Vault'
  'Jerry Wang'
  'sk-[A-Za-z0-9]{20,}'
  'ghp_[A-Za-z0-9]{20,}'
  'AKIA[0-9A-Z]{16}'
)

fail=0
cd "$REPO_ROOT"
for pat in "${BANNED[@]}"; do
  hits=$(rg -n -i "$pat" -g '!scripts/**' -g '!.git/**' -g '!LICENSE' . 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "!!! 发现禁止模式: $pat"
    echo "$hits" | head -5
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "guard: OK（无禁止模式）"
fi
exit "$fail"
