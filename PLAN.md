# 研发计划 — capital-generation v0.1.0

> 2026-08-15 收官（全部里程碑 ✅）。**v0.1.0 冻结面存档**；当前版本计划见 [`PLAN-0.2.0.md`](PLAN-0.2.0.md)。
> 实施前必读：`docs/DESIGN_REVIEW.md`（决策，改动前先讨论）、`docs/DATA_MODEL.md`（模型）、`docs/DEGRADATION.md`（链与错误）、`docs/LESSONS.md`（契约事实与坑）、`docs/PYTHON.md`（风格）。

## 1. v0.1.0 定位

**第一个可在 DSH 会话中端到端使用的版本**：Python 统一 MCP server（FastMCP）经 stdio 接入 dsh-mcp-client，发布冻结的 `fin_data__*` 工具面，同花顺为主干、AKShare 兜底，降级全程可观测。

## 2. 边界（2026-08-15 确定）

### 2.1 范围（做）

| 维度 | 内容 |
|---|---|
| 数据域 | A股行情快照、历史日K（含复权）、财务三表+财务指标、交易日历、特色数据（涨停/连板/异动/热榜/龙虎榜）、标的检索/消歧 |
| 数据源 | **同花顺（主干，REST 官方契约）+ AKShare（兜底）**；Wind 不接入（v0.2.0） |
| 核心机制 | L1/L2/L3 数据模型、错误分类判定表（外置 `error_map.yaml`）、降级链（外置 `chains.yaml`）、熔断、QUOTA 门控（TTL 1 天，机制就位，v0.1.0 无 Wind 不触发）、缓存 TTL/LRU、AKShare 频率闸、**symbol 归一（THS ticker-list 权威同步 + 裸码兜底）** |
| 交付物 | `core/`（纯 Python，零协议依赖）+ `servers/mcp_data.py`（FastMCP 薄壳）+ `config/`（chains/error_map/symbols）+ `scripts/`（同步/录制/探针/漂移检查）+ 测试 + README + cordis.patch.yml 示例 |

### 2.2 非目标（明确不做，防止范围蔓延）

| 项 | 原因 | 归属 |
|---|---|---|
| Wind 适配器（含分钟线/公告/EDB/宏观/资金流/风险/技术/债券） | 权威主干，工程量独立 | v0.2.0 |
| 对账引擎（双源同时点核对） | 依赖多源稳定 + 复权事件流 | v0.2.0 |
| dump/数据湖（全市场 Parquet → 本地库） | 用户裁定：dump 落盘但**不上库、不进 LLM**，本版本无数据库工具 | v0.3.0 |
| 基金域（THS 7 端点） | 未决策 | 独立决策，不进主线 |
| 研报全文/评级/目标价 | 用户裁定不覆盖，另选数据源 | — |
| 妙想 MX（东财） | 用户裁定排除 | — |
| agent 编排层（`fin_agent__*`） | 数据层先稳 | v0.4.0 |

### 2.3 工具面（v0.1.0 冻结契约）

**工具名与 schema 一经发布冻结**（AGENTS.md 硬规则）；发布前需一次 schema 评审。详细参数 schema 以 `servers/mcp_data.py` 为准，本表为契约摘要：

| 工具 | 参数（摘要） | 内部链（chains.yaml） | 备注 |
|---|---|---|---|
| `fin_data__search_symbols` | `query`, `market?` | ths → akshare | 消歧返回唯一 canonical symbol |
| `fin_data__get_quote` | `symbols`(≤50), `market?` | ths → akshare | 快照；**不含中文名**（LESSONS §3.2），要名称先 search |
| `fin_data__get_klines` | `symbol`, `period`(1d), `start`, `end`, `adjust`(none/forward/backward) | ths → akshare | THS 开区间已吸收（inclusiveStart）；≤10 年；L3 标注复权口径 |
| `fin_data__get_financials` | `symbol`, `statement`(income/balance/cashflow/indicators), `period`, `limit`/`report` | ths → akshare | v0.2.0 接 Wind 后 chains.yaml 改为 wind→ths→akshare，代码不动 |
| `fin_data__get_calendar` | — | ths → akshare | THS 固定近一年窗口 |
| `fin_data__get_special_data` | `kind`(limit-up/limit-up-ladder/hot/hot-history/dragon-tiger/anomaly-stock), `date?`, `page?` | ths → akshare | 异动仅当日；热榜历史限近一年 |

## 3. 里程碑

| 里程碑 | 内容 | 估时 | 出口标准 | 状态 |
|---|---|---|---|---|
| M0 骨架 | uv init、`pyproject.toml`、目录（core/servers/config/tests/scripts）、pytest + ruff、README 骨架 | 0.5d | `uv run pytest` 空跑绿；目录即 DESIGN_REVIEW 结构 | ✅ 2026-08-15 |
| M1 模型与错误 | domain dataclass（Instrument/Quote/Kline/FinancialStatement/SpecialData/CalendarDay）、`FinError` 分类、units（手→股转换表、Asia/Shanghai 毫秒、**source 规范名 同花顺/Wind/AKShare**）、envelope（source/tier/degraded/warnings） | 1d | 单测绿，含时区（mktime 陷阱）与单位（手/股、亿元/元）陷阱用例 | ✅ 2026-08-15 |
| M2 symbol 归一 | `scripts/sync-symbols.py`（拉 THS ticker-list 全量 → `config/symbols.json`）、SymbolResolver（canonical 映射、裸码兜底规则仅股票 6→.SH 等、类别感知、`.TI` 仅 THS 语义、歧义返回候选） | 1.5d | 单测覆盖可转债/ETF/指数/北交所用例；快照入库；歧义提示引导 search_symbols | ✅ 2026-08-15（实测快照 30327 条；上证指数=000001.SH 发现已入 LESSONS） |
| M3 同花顺适配器 | httpx 直连、`X-api-key`、信封 `code==0`、错误码→FinError（`error_map.yaml`）、inclusiveStart、裸码补后缀、批量/分页、超时分级（快照10s/K线30s/批量60s）、六工具端点全覆盖；`scripts/record-fixtures.py` | 2d | adapter 单测 + fixture 回放绿（CI 无实时网络）；真实 key live 冒烟（人工） | ✅ 2026-08-15（9 个 live fixture；真实 key 冒烟通过） |
| M4 AKShare 适配器 | 白名单函数映射表（每工具一个函数组）、信号量+硬超时+线程池上限、频率闸 ≥2s、**禁全市场拉取过滤**、锁版本 + golden 回归 | 1.5d | golden 测试绿（版本锁定后录制）；code review 确认无全市场反模式 | ✅ 2026-08-15（4/5 golden 已录；kline golden 待东财封锁解除，测试显式 skip） |
| M5 路由层 | `chains.yaml` 加载、降级链执行（逐源独立 try/except）、熔断（≥5 次→60s 冷却，成功复位）、QUOTA 门控（TTL 1 天，到期自动恢复）、缓存（快照30s/K线当日/LRU）、degraded+warnings 标注 | 1.5d | routing 单测绿：链序、failover、熔断复位、门控 TTL 到期恢复 | ✅ 2026-08-15 |
| M6 MCP 薄壳 | FastMCP server、6 个 `fin_data__*` 工具注册、BYOK（env → DSH credentials）、工具描述边界声明（禁全市场/禁分钟线等）、大结果惰性迭代、cordis.patch.yml 示例 | 1d | `uv run python -m servers.mcp_data` 可起；tools/list 6/6；schema 评审冻结 | ✅ 2026-08-15（stdio 全链路真实 key 冒烟通过；发现并修复 MCP env 白名单陷阱） |
| M7 验收 | 端到端冒烟（600519.SH / 000001.SZ / 300750.SZ × 六工具）、`scripts/live-probe.py`、`scripts/verify-contracts.py`（llms-full.txt 漂移检查）、文档同步（README/配置示例） | 1.5d | §4 验收清单全绿 | ✅ 2026-08-15 |

合计 ≈ 10 天（+20% buffer）。**顺序理由**：M1→M2 先做死契约与基础工程（映射表"不容有失"）；M3 先于 M4（主干先测）；M5 路由在双源齐备后；M6 薄壳最后接（工具 schema 冻结前不写协议层）。

## 4. 验收清单（v0.1.0 出口）

- [x] 6 个工具全部注册，DSH 会话（stdio）可调用 — 2026-08-15 live-probe 全链路验证（含 stdio 真实 key）
- [x] 三样本标的冒烟通过（600519.SH / 000001.SZ / 300750.SZ）— 600519/000001 已实测；300750 随 fixture 覆盖
- [x] 降级可观测：同花顺失败 → AKShare 结果带 `source: AKShare` + `degraded: true` + warnings（**禁止静默降级**）
- [x] 错误分类行为：AUTH 立即返回不重试不换源；4001 指数退避；3001 换源一次；3002 保留 request_id 稍后可重试（不得补零）
- [x] symbol 归一：裸码/别名/带后缀均可解析；可转债/ETF/指数不误判；歧义返回候选
- [x] AKShare 纪律：频率闸生效；代码中无全市场拉取再过滤
- [x] CI 无实时网络：THS fixture 回放 + AKShare golden 全绿（1 项显式 skip：kline golden 待东财封锁解除）
- [x] source 取值规范：信封/工具返回值一律 `同花顺` / `Wind` / `AKShare`（Wind 大写 W）
- [x] 工具 schema 冻结文档（发布前评审，评审后任何人改动需讨论）— schema 冻结于 PLAN §2.3 + servers/mcp_data.py

## 5. 关键机制要求（源自 LESSONS，实现时对照）

1. **adapter 绝不自己重试**——重试/退避/failover 全归路由（M5）
2. **双形状解析**：vendor 响应可能整体换形状，解析器兼容新旧形状，旧 fixture 保留（M3）
3. **错误上下文完整**：vendor + endpoint + status + code + request_id（M3）
4. **判定表外置**：错误码映射、配额判定（文本嗅探类）进 `error_map.yaml`（M3/M5）
5. **单位未知不猜**：源不给币种元数据时宁可不填（M1）
6. **空值纪律**：`null` 不补零、不模拟（M3）
7. **QUOTA 门控 TTL 1 天**：到期自动恢复，不允许降级一次后永久降级（M5）

## 6. 版本展望（主线之外独立决策：基金域、研报）

| 版本 | 内容 |
|---|---|
| **v0.1.1（已记录在案，未排期）** | ① kline 兜底加备用上游：akshare 适配器内 东财 → 新浪(`stock_zh_a_daily`) → 腾讯(`stock_zh_a_hist_tx`) 顺序尝试，各配 golden（2026-08-15 实测：东财 push2his/push2 对本机 IP 限频间歇不可用，新浪/腾讯稳定，见 LESSONS §5.4）② 补录 kline golden（东财限频解除后或换网络执行 `record-goldens.py`；当前测试显式 skip） |
| v0.2.0 | Wind 适配器（按需接线，fund/index/analytics 域待决策）+ 对账引擎（未复权、免费源间）+ 分钟线/公告/EDB/宏观域 + QUOTA 门控启用 |
| v0.3.0 | dump 落盘 + 数据湖（参考 THS 官方 marketdb：四层表/复权因子推导/validate+rebuild 修复）+ symbols 自动同步 + CI 自动化 |
| v0.4.0 | `fin_agent__*` 编排层（数据层零改动） |

## 7. 风险

| 风险 | 缓解 |
|---|---|
| THS 契约漂移（无版本） | verify-contracts.py（llms-full.txt diff）+ fixture 回放 + 双形状解析 |
| AKShare 接口漂移 | 锁版本 + golden 回归（升级前先跑） |
| 工具面冻结责任 | M6 前 schema 评审冻结；新能力 = 新工具，不改旧 schema |
| 同花顺无 Key 时全链压 AKShare | 频率闸 + 单标的纪律；文档明示降级 |
| 估时乐观 | 合计 +20% buffer；里程碑逐个过 gate |
