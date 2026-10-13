#!/usr/bin/env bash
# 从本地 skill SSoT 同步三件套到公开仓库并脱敏。这是唯一写路径。
# 用法: bash scripts/publish.sh
set -euo pipefail

SSOT="${SSOT:-/Users/jerrywang/.claude/skills}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

for skill in concept-research stock-research industry-research; do
  echo "==> syncing $skill"
  rsync -a --exclude='.DS_Store' --exclude='*.bak*' \
    "$SSOT/$skill/" "$REPO_ROOT/$skill/"
done

echo "==> sanitizing (A/B/F)"
find "$REPO_ROOT" -name '*.md' -not -path '*/.git/*' | while read -r f; do
  # A 类：个人绝对路径 → {{QUANT_ROOT}} 占位符
  sed -i '' 's|/Users/jerrywang/.openclaw/workspace/quant_research|{{QUANT_ROOT}}|g' "$f"
  # B/F 类：人名、个人案例、内部会话标识
  sed -i '' \
    -e 's|搜索 Jerry Vault 或 MCP memory|搜索你的本地知识库（如 Obsidian Vault）或 MCP memory|g' \
    -e 's|（复星坑）|（真实持仓案例教训）|g' \
    -e 's|华工科技半截子补丁|补丁：半截子交付教训|g' \
    -e 's|2026-06-22 华工科技 gap|2026-06-22 gap|g' \
    -e 's|（quick-260607-v3s）||g' \
    -e 's|，quick-260607-wc8||g' \
    -e 's| (box7)||g' \
    -e 's|（v2.26 box7）|（v2.26）|g' \
    "$f"
done

# B 类（多行）：stock-research 平台 override 段落
perl -0pi -e 's{This is the default Claude SSoT for single-stock research\. Codex keeps a\nplatform override at `/Users/jerrywang/\.codex/skills/stock-research`; keep the\ntwo structurally aligned, but do not blindly overwrite the Codex override when\nsyncing Claude skills\.}{This is the canonical single-stock research skill. If you maintain platform\ncopies (e.g., a Codex-side override), keep them structurally aligned with this\ncanonical file, but do not blindly overwrite one with the other.}g' \
  "$REPO_ROOT/stock-research/SKILL.md"

echo "==> re-inserting public-edition preambles (D)"
strip_preamble() {
  local f="$1"
  awk '
    /^> \*\*公开版适配说明/ { in_preamble=1; next }
    in_preamble && /^> / { next }
    in_preamble { in_preamble=0 }
    { print }
  ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
}
insert_preamble() {
  local f="$1" marker_file="$2"
  strip_preamble "$f"
  grep -qF "$(head -1 "$marker_file")" "$f" && return 0
  awk -v mf="$marker_file" '
    /^---$/ {
      n++
      print
      if (n==2 && !done) {
        print ""
        while ((getline line < mf) > 0) print line
        close(mf)
        print ""
        done=1
        # 原文件在 frontmatter 后可能有空行；吃掉它，保证 marker 后恰好一个空行
        if ((getline line) > 0 && line == "") { next }
        else if (line != "") { print line }
        next
      }
      next
    }
    { print }
  ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
}
insert_preamble "$REPO_ROOT/concept-research/SKILL.md"  "$REPO_ROOT/scripts/preamble-concept.txt"
insert_preamble "$REPO_ROOT/stock-research/SKILL.md"    "$REPO_ROOT/scripts/preamble-stock.txt"
insert_preamble "$REPO_ROOT/industry-research/SKILL.md" "$REPO_ROOT/scripts/preamble-industry.txt"

# 脱敏闸
bash "$REPO_ROOT/scripts/guard.sh"

echo ""
echo "publish 完成。请检查 git diff（应为空或仅预期变更）后手动提交（不要自动 push）。"
