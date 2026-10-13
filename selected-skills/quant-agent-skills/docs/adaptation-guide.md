# 数据层适配指南（Glossary & Adaptation Guide）

本仓库的三个 skill 来自作者的个人量化系统。术语和命令是作者栈的具体实现；
公开版不附带这些组件。下面是完整映射表——先看这张表，再决定你的替代方案。

| 术语 / 组件 | 含义 | 公开版处理 |
| --- | --- | --- |
| `{{QUANT_ROOT}}` | 你的量化项目根目录 | 全局替换为你的路径；`template/.env.example` 有示例 |
| `RRS` | 作者项目的本地研报存储（Research Report Store，SQLite） | 替换为你的研报库；示例命令仅供参考 |
| `research_report` | 研报库表/数据库 | 同上 |
| `Zsxq` | 知识星球（可选付费研报源） | 可选；没有就跳过该路径 |
| `Vault` / `sync_*_to_vault.py` | 三地沉淀的"第三地"：个人知识库（Obsidian 等） | 换成你的知识库目录/同步方式 |
| `scripts/*.py`（`watchlist_upsert.py`、`theme_triggers_upsert.py`、`generate_bridge.py` 等） | 作者项目配套的闭环脚本 | v1.1 随 `collect-data` 开源；当前请用你自己的等价命令，或用 `template/scripts/` 占位 |
| `data_platform/*.py`（`research_report_collector.py`、`cninfo_collector.py` 等） | 数据采集器 | 同上，属于 v1.1 范围 |
| `common/constants.py` 的 `DB_PATH` | 本地数据库路径 | 适配你自己的 DB 连接 |
| `auto_research/` | 研究产物目录（五文件、knowledge JSON） | `template/research/` 提供最小骨架 |
| `.factor_cache/tracking/l3_candidate_queue.json` | 全局候选排序缓存（派生数据） | 可选组件，不影响方法论 |
| 五文件输出 / 三地沉淀 / thesis_id / triggers / bridge / quality gate | 方法论契约 | **保留**——这是本仓库的核心价值 |

## 三个最少替换点

1. `{{QUANT_ROOT}}` → 你的项目根目录（sed 一行可全局替换）。
2. 数据采集命令 → 你的数据源（免费路径建议：东财/腾讯公开接口 + SQLite；
   v1.1 会发布作者的完整实现）。
3. Vault 同步命令 → 你的知识库（或暂时跳过"第三地沉淀"，其余契约不受影响）。

## 贡献约定

- 三件套来自本地 SSoT，通过 `scripts/publish.sh` 同步发布；不要直接改
  skill 正文再提交 PR（方法论变更请走 Issue 讨论）。
- 所有示例输出必须匿名：禁止真实持仓、真实交易、真实资金数字。
