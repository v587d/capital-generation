# capital-generation

统一金融数据访问（DeepSeek Harness 插件生态）：一个入口覆盖 **同花顺（主干，官方 REST）+ AKShare（免费兜底）**，降级全程可观测。基于 MCP，DSH 侧零 TS。

> 版本：v0.3.0（2026-08-15 发布）· 设计决策见 [`docs/`](docs/DESIGN_REVIEW.md) · v0.1.0 计划（冻结面）见 [`PLAN.md`](PLAN.md) · v0.2.0 计划见 [`PLAN-0.2.0.md`](PLAN-0.2.0.md) · **v0.3.0 计划见 [`PLAN-0.3.0.md`](PLAN-0.3.0.md)（数据湖 / 基金·指数域 / symbols 自动同步 / CI 自动化）**

## 能力（v0.3.0）

| 工具 | 说明 | 内部链 |
|---|---|---|
| `fin_data__search_symbols` | 标的消歧（名称/代码 → 唯一 thscode） | 同花顺 → AKShare |
| `fin_data__get_quote` | A股最新行情快照（≤50 只；不含中文名） | 同花顺 → AKShare |
| `fin_data__get_klines` | 日K（≤10 年，adjust=none/forward/backward）+ **分钟线 1m/5m/15m/30m/60m（仅单交易日，Wind 独家无降级源）** | 日K 同花顺 → AKShare；分钟 Wind |
| `fin_data__get_financials` | 三表 + 财务指标（**Wind 权威链头**，估值默认 PE-TTM） | **Wind** → 同花顺 → AKShare |
| `fin_data__get_calendar` | A股近一年交易日历 | 同花顺 → AKShare |
| `fin_data__get_special_data` | 涨停池/连板天梯/热榜/历史热榜/龙虎榜/异动 | 同花顺 → AKShare |
| `fin_data__get_announcements` | 上市公司公告检索（**Wind 独家 RAG，无降级源**） | Wind |
| `fin_data__get_edb` | EDB 宏观/行业指标（指标简称，如"中国GDP"；AKShare 仅白名单兜底） | Wind → AKShare |
| `fin_data__reconcile` | **双源对账**（quote/klines 未复权，THS×AKShare，只比数据时点；分歧不自动修复，交 LLM 裁决） | 双源直取 |
| `fin_data__get_fund_data` | **基金数据**（quote/nav/kline/holdings/holders/performance/info；THS 免费主干，Wind 补缺；场内快照/日K 仅 ETF，LOF/OTC 由 Wind 兜底并 L3 标注） | 同花顺 → Wind |
| `fin_data__get_index_data` | **指数数据**（quote/kline/constituents 行情 THS 主干无复权语义；fundamentals/basicinfo **Wind 独家无降级源**；成分仅当前无历史） | 同花顺 → Wind（基本面 Wind） |

每个结果携带溯源：`source`（规范名 同花顺/Wind/AKShare）+ `tier`（free/quota/paid）+ `ts`（查询时点）+ `warnings[]`（降级说明）+ 数据时点（`as_of_ms`/`date_ms`）。降级从不静默；分钟线/公告/指数基本面无降级源，明确告知。

**边界**：A股股票 + 基金（净值/收益/持仓/持有人/场内快照/K线）+ 指数（行情/K线/成分/基本面）+ Wind 独家域（分钟线/公告/EDB）。不做：周/月/季K、港股/美股、宏观白名单外经 AKShare 兜底、研报/评级/目标价、**全市场扫描（数据湖为离线资产，走 `scripts/lake.py` CLI，不进 LLM）**（见 `PLAN-0.3.0.md` §2.2）。

## 数据湖（离线资产，v0.3.0）

官方 THS marketdb CLI（`HiThink-Tech/Financial-API`，MIT）整体采用：全市场 10 年日K + 复权因子 + 近 10 交易日增量，四层表 raw/calc/dim/stg + 8 项质量校验 + validate/rebuild 修复（禁删 raw）。**纯离线，不进 LLM**（用户裁定）；入口 `scripts/lake.py`：

```bash
HITHINK_FINANCE_API_KEY=<ths_key> uv run python scripts/lake.py sync    # 全量/增量同步
uv run python scripts/lake.py validate | rebuild | status | describe     # 质量/修复/状态
uv run python scripts/lake.py query --sql "SELECT * FROM v_daily_qfq ..."  # 只读查询
```

安装：`git clone https://gh-proxy.com/https://github.com/HiThink-Tech/Financial-API`（github.com 直连不通，走镜像）→ `uv pip install -e <克隆>/python`。合成样本离线测试已内置（`tests/unit/test_lake.py`）。

## 安装

```bash
uv sync        # Python 3.12+ (mcp<2 已锁定; akshare 锁版本, 升级前跑 golden)
```

## 配置（BYOK）

```bash
export THS_API_KEY=sk-fuyao-...    # 同花顺 Key (fuyao.aicubes.cn/admin)
export WIND_API_KEY=ak_...         # Wind Key (aifinmarket.wind.com.cn; 可选, 缺省时 Wind 域不可用)
```

读取顺序：环境变量 → `$DSH_HOME/.credentials.yaml`（键 `ths_api_key` / `wind_api_key`）。AKShare 无需 key。
**密钥绝不入库**：`KEYS*` 已被 `.gitignore` 排除；测试 key 见 `KEYS(only for test).txt`（勿提交）。

⚠️ **DSH/stdio 子进程环境白名单陷阱**（2026-08-15 实测踩坑）：MCP SDK 的 stdio 子进程默认只转发白名单环境变量，`THS_API_KEY`/`WIND_API_KEY` 不在其中——必须显式传 env，否则对应适配器不构建、全链静默降级。DSH 接入示例见 [`servers/cordis.patch.finance.example.yml`](servers/cordis.patch.finance.example.yml)（`env` 必须显式声明）。

## 运行

```bash
uv run python -m servers.mcp_data          # 启动 MCP server (stdio)
THS_API_KEY=... WIND_API_KEY=... uv run python scripts/live-probe.py  # 真实 key 端到端冒烟
uv run pytest tests                        # 全量单测 (离线: fixture/golden 回放, 无实时网络)
uv run python scripts/ci.py                # 本地 CI (ruff + pytest 离线 + 契约漂移; v0.3.0)
uv run python scripts/verify-contracts.py  # THS 契约漂移检查 (llms-full.txt diff)
uv run python scripts/verify-contracts.py --wind  # Wind 契约漂移检查 (官方 tool-manifest diff)
uv run python scripts/sync-symbols.py --if-stale 30  # symbols 自动同步 (新鲜则跳过; 启动时自动检测)
uv run python scripts/record-fixtures.py   # 重录 THS 脱敏 fixture (真实 key, 开发期)
uv run python scripts/record-goldens.py    # 重录 AKShare golden (锁版本后; 东财封锁期 kline 显式 skip)
```

## DSH 接入

`~/.dsh/profiles/web/cordis.patch.yml` 加一条（示例见 `servers/cordis.patch.finance.example.yml`）：一个 `dsh-mcp-client` stdio 条目指向本仓库，`env.THS_API_KEY` 显式声明。DSH 侧零 TS。

## 目录

```
core/             纯 Python, 零协议依赖 (domain + FinError 是唯一跨层契约)
  domain/         models / errors / symbols / units / routing / reconcile
  adapters/       base / ths / akshare_adapter / wind (注册式: 新源 = 新文件 + 配置)
servers/          MCP 薄壳: mcp_data.py + cordis 示例 (唯一协议层)
config/           chains.yaml / error_map.yaml / symbols.json / wind_tools.yaml /
                  akshare_edb.yaml / reconcile.yaml / wind/ / ths/ (官方契约快照, 数据不是代码)
scripts/          sync-symbols / record-fixtures / record-goldens / live-probe /
                  verify-contracts (--wind) / lake (数据湖 CLI) / ci (本地 CI)
tests/            unit / adapters / golden / fixtures (CI 无实时网络; fixtures/wind 24 条)
docs/             DATA_MODEL / DEGRADATION / DESIGN_REVIEW / PYTHON / LESSONS
PLAN.md           v0.1.0 范围与里程碑（冻结面存档）
PLAN-0.2.0.md     v0.2.0 计划（Wind 适配器/对账引擎/分钟线/公告/EDB）
PLAN-0.3.0.md     v0.3.0 计划（数据湖/基金·指数域/symbols 自动同步/CI 自动化）
```

## 测试纪律

- THS：fixture 回放（`tests/fixtures/ths/`，录制一次脱敏，CI 离线）
- Wind：fixture 回放（`tests/fixtures/wind/`，2026-08-15 真实 key 录制 24 条，含错误信封）
- AKShare：golden 回归（`tests/golden/akshare/`，锁版本后录制；东财封锁期间 kline golden 显式 skip；
  v0.1.1 新浪/腾讯 kline golden 已录）
- 数据湖：`scripts/lake.py` wrapper 单测（mock 子进程）+ 合成 parquet 离线全流程
  （`tests/unit/test_lake.py`；marketdb 未安装时显式 skip）
- 真实 key 冒烟：`live-probe.py`（不进 CI；无 WIND_API_KEY 时跳过 Wind 用例）
- 契约漂移：`verify-contracts.py`（THS llms-full.txt，`--offline` 用仓库内缓存）+ `--wind`
  （官方 tool-manifest 快照 diff）
- 本地 CI：`scripts/ci.py`（ruff + pytest 离线 + 双源契约漂移 + symbols 新鲜度）+ pre-commit

## 文档

渐进披露，按需阅读：`docs/DESIGN_REVIEW.md`（决策）→ `docs/DATA_MODEL.md`（模型）→ `docs/DEGRADATION.md`（链与错误）→ `docs/LESSONS.md`（契约事实与坑）→ `docs/PYTHON.md`（风格）→ [`PLAN.md`](PLAN.md)（v0.1.0 冻结面）→ [`PLAN-0.2.0.md`](PLAN-0.2.0.md)（v0.2.0）→ [`PLAN-0.3.0.md`](PLAN-0.3.0.md)（当前版本计划）。
