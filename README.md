# capital-generation

统一金融数据访问（DeepSeek Harness 插件生态）：一个入口覆盖 **同花顺（主干，官方 REST）+ AKShare（免费兜底）**，降级全程可观测。基于 MCP，DSH 侧零 TS。

> 版本：v0.1.0（2026-08-15 已发布）· 设计决策见 [`docs/`](docs/DESIGN_REVIEW.md) · v0.1.0 计划（冻结面）见 [`PLAN.md`](PLAN.md) · **v0.2.0 计划见 [`PLAN-0.2.0.md`](PLAN-0.2.0.md)（Wind 适配器 / 对账引擎 / 分钟线·公告·EDB）**

## 能力（v0.1.0）

| 工具 | 说明 | 内部链 |
|---|---|---|
| `fin_data__search_symbols` | 标的消歧（名称/代码 → 唯一 thscode） | 同花顺 → AKShare |
| `fin_data__get_quote` | A股最新行情快照（≤50 只；不含中文名） | 同花顺 → AKShare |
| `fin_data__get_klines` | A股历史日K（≤10 年，含起止日；adjust=none/forward/backward） | 同花顺 → AKShare |
| `fin_data__get_financials` | 三表 + 财务指标（income/balance/cashflow/indicators） | 同花顺 → AKShare |
| `fin_data__get_calendar` | A股近一年交易日历 | 同花顺 → AKShare |
| `fin_data__get_special_data` | 涨停池/连板天梯/热榜/历史热榜/龙虎榜/异动 | 同花顺 → AKShare |

每个结果携带溯源：`source`（规范名 同花顺/Wind/AKShare）+ `tier` + `ts`（查询时点）+ `warnings[]`（降级说明）+ 数据时点（`as_of_ms`/`date_ms`）。降级从不静默。

**v0.1.0 边界**：仅 A股股票行情/财务/日历/特色数据。不做：分钟线、港股/美股、指数行情、宏观、基金域、研报、全市场快照（见 `PLAN.md` §2.2）。

## 安装

```bash
uv sync        # Python 3.12+ (mcp<2 已锁定; akshare 锁版本, 升级前跑 golden)
```

## 配置（BYOK）

```bash
export THS_API_KEY=sk-fuyao-...    # 同花顺 Key (fuyao.aicubes.cn/admin)
```

读取顺序：环境变量 → `$DSH_HOME/.credentials.yaml`（键 `ths_api_key`）。AKShare 无需 key。
**密钥绝不入库**：`KEYS*` 已被 `.gitignore` 排除；测试 key 见 `KEYS(only for test).txt`（勿提交）。

⚠️ **DSH/stdio 子进程环境白名单陷阱**（2026-08-15 实测踩坑）：MCP SDK 的 stdio 子进程默认只转发白名单环境变量，`THS_API_KEY` 不在其中——必须显式传 env，否则同花顺适配器不构建、全链静默降级 AKShare。DSH 接入示例见 [`servers/cordis.patch.finance.example.yml`](servers/cordis.patch.finance.example.yml)（`env` 必须显式声明）。

## 运行

```bash
uv run python -m servers.mcp_data          # 启动 MCP server (stdio)
THS_API_KEY=... uv run python scripts/live-probe.py   # 真实 key 端到端冒烟 (7 用例)
uv run pytest tests                        # 全量单测 (离线: fixture/golden 回放, 无实时网络)
uv run python scripts/verify-contracts.py  # THS 契约漂移检查 (llms-full.txt diff)
uv run python scripts/sync-symbols.py      # 刷新 config/symbols.json (THS ticker-list 权威映射)
uv run python scripts/record-fixtures.py   # 重录 THS 脱敏 fixture (真实 key, 开发期)
uv run python scripts/record-goldens.py    # 重录 AKShare golden (锁版本后)
```

## DSH 接入

`~/.dsh/profiles/web/cordis.patch.yml` 加一条（示例见 `servers/cordis.patch.finance.example.yml`）：一个 `dsh-mcp-client` stdio 条目指向本仓库，`env.THS_API_KEY` 显式声明。DSH 侧零 TS。

## 目录

```
core/             纯 Python, 零协议依赖 (domain + FinError 是唯一跨层契约)
  domain/         models / errors / symbols / units / routing
  adapters/       base / ths / akshare_adapter (注册式: 新源 = 新文件 + 配置)
servers/          MCP 薄壳: mcp_data.py + cordis 示例 (唯一协议层)
config/           chains.yaml / error_map.yaml / symbols.json (数据不是代码)
scripts/          sync-symbols / record-fixtures / record-goldens / live-probe / verify-contracts
tests/            unit / adapters / golden / fixtures (CI 无实时网络)
docs/             DATA_MODEL / DEGRADATION / DESIGN_REVIEW / PYTHON / LESSONS
PLAN.md           v0.1.0 范围与里程碑（冻结面存档）
PLAN-0.2.0.md     v0.2.0 计划（Wind 适配器/对账引擎/分钟线/公告/EDB）
```

## 测试纪律

- THS：fixture 回放（`tests/fixtures/ths/`，录制一次脱敏，CI 离线）
- AKShare：golden 回归（`tests/golden/akshare/`，锁版本后录制；东财封锁期间 kline golden 显式 skip，封锁解除后 `record-goldens.py` 补录）
- 真实 key 冒烟：`live-probe.py`（不进 CI）
- 契约漂移：`verify-contracts.py`（对比官方 llms-full.txt）

## 文档

渐进披露，按需阅读：`docs/DESIGN_REVIEW.md`（决策）→ `docs/DATA_MODEL.md`（模型）→ `docs/DEGRADATION.md`（链与错误）→ `docs/LESSONS.md`（契约事实与坑）→ `docs/PYTHON.md`（风格）→ [`PLAN.md`](PLAN.md)（v0.1.0 冻结面）→ [`PLAN-0.2.0.md`](PLAN-0.2.0.md)（当前版本计划）。
