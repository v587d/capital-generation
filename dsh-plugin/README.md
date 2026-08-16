# dsh-plugin — capital-generation 的 DSH 插件包装

本目录把 **capital-generation**(Python 金融数据 MCP server)包装为符合
DeepSeek Harness 插件规范的 `dsh.bundle` 包, 供
`dsh plugin add` / dsh-market / awesome-dsh-plugin 生态使用。

## 安装

```bash
# 0. 前置: uv + Python 3.12+, 已 clone 本仓库
git clone https://github.com/v587d/capital-generation.git
export CAPITAL_GENERATION_DIR=$PWD/capital-generation

# 1. Key (BYOK): THS_API_KEY / WIND_API_KEY → ~/.dsh/.credentials.yaml (0600)

# 2. 安装插件 (本目录发布到 npm 后):
dsh plugin --profile web add capital-generation

#    或未发布时手动接入: 把 cordis.patch.yml 的内容并入 profile patch
#    (参考 servers/cordis.patch.finance.example.yml), 重启 dsh web
```

安装后工具以 `mcp__fin__fin_data__*` 暴露(11 个), 即用。

## 说明

- **cwd 路径**: `cordis.patch.yml` 的 `cwd` 取 `$CAPITAL_GENERATION_DIR`,
  未设置时回退到仓库默认路径(按本机修改)。
- **BYOK**: 同花顺/万得 Key 由使用者自备, 仓库零密钥; 缺失源自动跳过并
  warnings 明示(降级可观测)。
- **体积与上下文**: v0.3.1 起结果侧压缩 -72.2% (真实 KEY 实测), 公告全文截断
  + url 兜底, 详见 docs/CONTEXT_BUDGET_RESULTS.md。
- **发布**: 本目录作为 npm 包发布时, package.json 的 `dsh.bundle.patch` 即
  插件清单 (与 dsh-bridge-browser / dsh-mcp-bridge 同款机制)。
