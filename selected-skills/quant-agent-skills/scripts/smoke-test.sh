#!/usr/bin/env bash
# 冒烟验证：模拟新用户 clone + symlink 安装，检查 skill 可发现、可读、引用完整。
# 用法: bash scripts/smoke-test.sh [repo-path]
set -euo pipefail

REPO="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
TMP="$(mktemp -d /tmp/quant-skills-smoke.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

git clone -q "$REPO" "$TMP/repo"
mkdir -p "$TMP/home/.claude/skills"

pass=0; fail=0
ok()   { pass=$((pass+1)); echo "  ✓ $1"; }
bad()  { fail=$((fail+1)); echo "  ✗ $1"; }

for s in concept-research stock-research industry-research; do
  echo "== $s"
  SKILL="$TMP/home/.claude/skills/$s"
  ln -s "$TMP/repo/$s" "$SKILL"

  # 1. 可发现性：根目录有 SKILL.md
  [ -f "$SKILL/SKILL.md" ] && ok "SKILL.md 存在" || bad "SKILL.md 缺失"

  # 2. frontmatter 关键字段
  head -1 "$SKILL/SKILL.md" | grep -q '^---$' && ok "frontmatter 起始" || bad "frontmatter 起始缺失"
  for field in '^name:' '^description:' '^metadata:' 'version:'; do
    grep -qE "$field" "$SKILL/SKILL.md" && ok "frontmatter 含 $field" || bad "frontmatter 缺 $field"
  done

  # 3. 引用完整性：SKILL.md 引用的仓库内文件必须存在
  missing=0
  while read -r ref; do
    [ -f "$SKILL/$ref" ] || { missing=1; bad "引用文件缺失: $ref"; }
  done < <(rg -o "(steps|agents|references)/[A-Za-z0-9_./-]+\.md" "$SKILL/SKILL.md" | sort -u)
  [ "$missing" -eq 0 ] && ok "SKILL.md 引用的文件全部存在"

  # 4. 无个人路径/占位符已文档化
  if rg -q '/Users/|jerrywang' "$SKILL" -g '*.md' 2>/dev/null; then bad "发现个人路径"; else ok "无个人路径"; fi
done

# 5. README 链接完整性
echo "== README/docs"
for target in docs/adaptation-guide.md template examples LICENSE CHANGELOG.md; do
  [ -e "$TMP/repo/$target" ] && ok "README 引用存在: $target" || bad "README 引用缺失: $target"
done

# 6. 脱敏闸
echo "== guard"
bash "$TMP/repo/scripts/guard.sh" >/dev/null 2>&1 && ok "guard 通过" || bad "guard 失败"

echo ""
echo "结果: $pass 通过, $fail 失败"
[ "$fail" -eq 0 ]
