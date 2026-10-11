#!/usr/bin/env bash
# claude-ashare 开源初始化脚本
# 用法: bash scripts/init-repo.sh <your-github-username> <your-name>
# 例: bash scripts/init-repo.sh jwangkun "Your Name"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

USERNAME="${1:?用法: $0 <github-username> <your-name>}"
NAME="${2:-$USERNAME}"
REPO="claude-for-financial-services-cn"
REPO_URL="https://github.com/${USERNAME}/${REPO}.git"

echo "🚀 初始化 claude-ashare 开源仓库"
echo "   用户名: $USERNAME"
echo "   仓库名: $REPO"
echo "   地址:   $REPO_URL"
echo ""

# 1. 替换 README 和 LICENSE 里的占位符
echo "📝 替换占位符..."
sed -i '' "s/your-username/${USERNAME}/g" README.md
sed -i '' "s/your-name/${NAME}/g" LICENSE
echo "   ✅ README.md 和 LICENSE 已更新"

# 2. 初始化 git
if [ -d .git ]; then
  echo "   ⏭️  .git 已存在，跳过 init"
else
  git init
  echo "   ✅ git init 完成"
fi

# 3. 设置 gitignore（如果不存在）
if [ -f .gitignore ]; then
  echo "   ⏭️  .gitignore 已存在，跳过"
else
  cat > .gitignore << 'GITIGNORE'
# Python
__pycache__/
*.pyc
*.pyo
.venv/
venv/
.env
.env.local

# Node
node_modules/
package-lock.json

# macOS
.DS_Store
.AppleDouble
.LSOverride

# IDE
.idea/
.vscode/
*.swp
*.swo

# Secrets
*.key
*.pem
secrets/
GITIGNORE
  echo "   ✅ .gitignore 创建完成"
fi

# 4. 首次 commit
git add README.md LICENSE .gitignore
git add agent-plugins/ managed-agent-cookbooks/ vertical-plugins/ \
      mcp-servers/ scripts/ .claude-plugin/ CLAUDE.md

if git diff --cached --quiet 2>/dev/null; then
  echo "   ⏭️  没有新的文件要 commit"
else
  git commit -m "feat: 开源 claude-ashare — 63 个 A 股 Claude Skills

- 31 个 china-finance 技能（研报 / 建模 / 估值 / 数据）
- 10 个 investment-banking 技能（Pitch Deck / CIM / 并购模型）
- 9 个 private-equity 技能（DD / IC Memo / 回报分析）
- 5 个 wealth-management 技能（客户报告 / 组合再平衡）
- 6 个 fund-admin 技能（对账 / 净值 / 应计）
- 2 个 operations 技能（KYC）
- 4 个端到端智能体
- 2 个 MCP Server（AkShare 数据 + 财经新闻）
- 完整部署 / 测试 / 校验工具链

基于 Anthropic claude-for-financial-services 中国市场适配"
  echo "   ✅ 首次 commit 完成"
fi

# 5. 添加 remote（如果不存在）
if git remote get-url origin >/dev/null 2>&1; then
  CURRENT=$(git remote get-url origin)
  echo "   ⏭️  remote origin 已存在: $CURRENT"
else
  git remote add origin "$REPO_URL"
  echo "   ✅ remote origin 已添加: $REPO_URL"
fi

# 6. 设置主分支名
git branch -M main

echo ""
echo "═══════════════════════════════════════════"
echo "✅ 本地仓库准备完毕！"
echo ""
echo "接下来："
echo ""
echo "  1. 在 GitHub 网页上创建空仓库:"
echo "     https://github.com/new"
echo "     仓库名: $REPO"
echo "     不要勾选 'Add a README' 和 '.gitignore'"
echo ""
echo "  2. 推代码:"
echo "     git push -u origin main"
echo ""
echo "═══════════════════════════════════════════"
