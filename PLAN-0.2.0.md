# 研发计划 — capital-generation v0.2.0

> 2026-08-15 | 版本边界与里程碑。承接 `PLAN.md`（v0.1.0，已收官，冻结面存档）§2.2 非目标归属与 §6 版本展望；用户裁定：**Wind 按需最小接线**、**分钟线扩展 `fin_data__get_klines.period`**。
> 实施前必读：`docs/DESIGN_REVIEW.md`（决策，改动前先讨论）、`docs/DATA_MODEL.md`（模型）、`docs/DEGRADATION.md`（链与错误）、`docs/LESSONS.md`（§4 契约对策、§5.2 Wind 实测事实与坑）、`docs/PYTHON.md`（风格）。

## 1. v0.2.0 定位

**第二个可发布版本**：接入 Wind（MCP 客户端模式，BYOK，积分计费）作为**财务权威链头**——`financials` 链一行配置改 `[wind, ths, akshare]`，路由代码不动，验证 v0.1.0"数据驱动路由"设计；新增**分钟线/公告/EDB 宏观域**（Wind 独家，无降级源，明确告知）；**对账引擎**上线（未复权、免费源间 THS×AKShare，分歧交 LLM 裁决）；**QUOTA 门控真启用**（v0.1.0 机制就位但无 Wind 不触发，本版本首次真实触发）。

## 2. 边界（2026-08-15 确定）

### 2.1 范围（做）

| 维度 | 内容 |
|---|---|
| 数据域 | 财务三表+指标（**Wind 权威链头**）、分钟线（Wind 独家，**仅当日单日**）、公告（Wind 独家）、EDB/宏观（Wind 主干 + AKShare 白名单兜底）、对账（quote/klines **未复权**，THS×AKShare，数据时点对齐） |
| 数据源 | **+ Wind**（`core/adapters/wind.py`，mcp client 连接，transport 由 M0 实测定：streamable-http/SSE/stdio 三选一；错误信封含 `correction` 字段，**v0 只记录不自动重查**）；同花顺（主干）、AKShare（兜底）不变 |
| 核心机制 | QUOTA 门控启用（文本嗅探 `/积分\|配额\|quota/` → QUOTA，TTL 1 天，沿用 v0.1.0 已实现语义）、Wind 契约漂移检查（tool-manifest diff）、双形状解析、串行并发纪律（默认串行、上限 10、价格批量 ≤50）、对账引擎、BaseAdapter **能力化重构**（抽象方法 → 显式 `capabilities` 集合，Router 跳过无能力源） |
| 交付物 | `core/adapters/wind.py` + `core/domain/reconcile.py` + 新 domain models（Announcement / EDBPoint；Kline 加 `period` 字段默认 `"1d"`）+ `config/wind_tools.yaml`（Wind 工具→域方法映射）+ `config/reconcile.yaml`（容差）+ chains/error_map 更新 + 3 个新工具与 1 处 period 扩展（schema 评审记录）+ `scripts/verify-contracts.py` 扩展（Wind manifest）+ Wind fixtures + AKShare 宏观 golden + live-probe 扩展 + 文档同步 |

### 2.2 非目标（明确不做，防止范围蔓延）

| 项 | 原因 | 归属 |
|---|---|---|
| Wind fund/index/analytics 域（约 24 个工具：基金净值/持仓、指数行情/成分、分析师数据） | 用户裁定按需最小接线 | v0.3.0 |
| Wind 指数/板块行情 | windcode 映射缺口：THS `.TI` 语义在 Wind 侧不合法（LESSONS §5.2 实测），板块需 `885xxx.WI` 类映射且无权威表；指数行情继续 THS | 按需评估 |
| 研报全文 | 沿用 v0.1.0 用户裁定 | — |
| dump/数据湖、symbols 自动同步 | v0.1.0 裁定 | v0.3.0 |
| agent 编排层（`fin_agent__*`） | 数据层先稳 | v0.4.0 |
| Wind `correction` 自动重查 | 免费 tier 积分有限，v1 候选，v0 只记录 | — |
| 复权对账、分钟级跨日序列 | 复权价跨源不可比；LESSONS §5.2 实测 Wind 分钟序列仅当日 | — |

### 2.3 工具面（v0.2.0 变更清单，发布前一次 schema 评审，评审记录落 `docs/DESIGN_REVIEW.md` 决策 12）

**v0.1.0 六个工具一字不动**（冻结契约）。变更仅以下：

| 工具 | 变更 | 内部链（chains.yaml） | 备注 |
|---|---|---|---|
| `fin_data__get_klines` | **period 扩展**：新增 `1m/5m/15m/30m/60m`（仅当日、Wind 独家、无降级源；周/月/季明确拒绝）；`1d` 及现有参数行为与 v0.1.0 完全一致 | `1d`→`klines: [ths, akshare]`；分钟→新域 `intraday: [wind]`（工具内部按 period 分流） | 向后兼容的枚举扩展，需评审记录；分钟结果 `degraded=false` 但工具描述明示"Wind 独家，无降级源" |
| `fin_data__get_announcements` | **新工具**：`symbol, start, end` → 公告/新闻列表 | `announcements: [wind]` | Wind `financial_docs`（公告+新闻）；无备，明确告知 |
| `fin_data__get_edb` | **新工具**：`indicator`（指标简称）、`start, end`、可选 `codes` → Wind EDB 两段式 search→fetch；AKShare 兜底仅限外置白名单宏观指标（初始 GDP/CPI/PMI 等 5–10 个，映射进 config，沿用 AKShare 适配器白名单机制） | `edb: [wind, akshare]` | 长句搜不到，用指标简称（LESSONS §5.2）；EDB 双形状解析 |
| `fin_data__reconcile` | **新工具**：`domain=quote\|klines`、`symbols`、`start/end`、`tolerance_pct?` → 对账报告（**分歧不自动修复，交 LLM 裁决**） | 不走链（双源直取） | 信封 `source=""` + 新字段 `engine: "reconcile"`（source 规范名 同花顺/Wind/AKShare 不变，报告行自带各源 source 与数据时点） |

`config/chains.yaml` 变更：`financials: [ths, akshare]` → `[wind, ths, akshare]`（仅此一行，代码不动）；新增 `intraday` / `announcements` / `edb` 三域。

## 3. 里程碑

| 里程碑 | 内容 | 估时 | 出口标准 | 状态 |
|---|---|---|---|---|
| M0 契约盘点与接线映射 | 拉取 Wind 官方 tool-manifest（机器可读）→ `config/wind_tools.yaml`（工具→域方法逐条映射）；live 逐项核实：三表可用性与响应形状、windcode 形态（股票 thscode 直通假设）、分钟线当日边界、EDB 两段式与日期参数风格、配额文本形态、MCP transport 形态；核实结论写回 `docs/LESSONS.md`；**决策门：若 Wind 三表不可用 → financials 保持 `[ths, akshare]`，Wind 只接公告/EDB/分钟线** | 1d | 映射表 + 核实记录 + LESSONS 更新 | ⏳ |
| M1 Wind 适配器骨架 | mcp client 连接层（transport spike 落地）、**BaseAdapter 能力化重构**（抽象方法 → 显式 `capabilities` 集合；Router 跳过无能力源；核心契约变更，测试先行）、`error_map.yaml` wind 段（文本嗅探→QUOTA）、FinError 全上下文（vendor + tool + status + code + request_id + correction）、`tier=quota` 打标、串行并发纪律（会话锁、价格批量 ≤50）、BYOK（env `WIND_API_KEY` 等 → DSH credentials，cordis 示例 env 白名单补 `WIND_*`，THS 陷阱同款）、Wind fixture 录制/回放 | 2d | adapter 单测 + fixture 回放绿（CI 无实时网络）；真实 key live 冒烟（人工） | ⏳ |
| M2 财务权威链 | `chains.yaml` 改 `financials: [wind, ths, akshare]`（代码不动）；0.000 陷阱（估值默认只问 市盈率(TTM)，PB 只信 THS `pb_mrq`，Wind 行 0 值带 extra 标注 + warnings）；indicators 口径核对；`aftype` 无不复权字面量（0=前复权）→ Wind 行永不当未复权用 | 1.5d | 双源对照测试绿（fixture 回放）；live 冒烟 | ⏳ |
| M3 分钟线/公告/EDB 域 | 新域 `intraday`（仅当日、Wind 独家无备、周/月/季拒绝并在工具描述明示）、`announcements`、`edb`（两段式 + akshare 白名单宏观映射外置）；新工具注册 + klines period 扩展（**schema 评审记录落 DESIGN_REVIEW 决策 12**） | 2d | `tools/list` 9 工具全注册；单测绿 | ⏳ |
| M4 对账引擎 | `core/domain/reconcile.py`：双源直取（绕链）、按 `(symbol, date_ms)`（K线）/ `(symbol, as_of_ms)`（快照）对齐、quote 数据时点时滞容差外置（如 5 分钟）、容差 0.5%（LESSONS §6 实测基准，外置 `config/reconcile.yaml`）、逐行 diff 报告 + 汇总（matched/mismatched）、**不自动修复**；`fin_data__reconcile` 工具注册；双源 fixture 回放测试 | 1.5d | 单测绿；实测对账报告样例（600519.SH / 000001.SZ） | ⏳ |
| M5 验收 | live-probe 扩展（`WIND_API_KEY` 可选，缺省跳过）、`verify-contracts.py` 双源（THS llms-full.txt + Wind tool-manifest diff）、AKShare kline golden 补录（东财封锁解除后，仍封锁则保持显式 skip）、README/DEGRADATION（含 QUOTA 行为澄清）/DESIGN_REVIEW/DATA_MODEL 同步 | 1d | §4 验收清单全绿 | ⏳ |

合计 ≈ 9 天（+20% buffer ≈ 11 天）。**顺序理由**：M0 先行——Wind 一切接线的事实基础（transport / 三表可用性 / windcode 假设都需实测确认，M0 是决策门）；M1 先做能力化重构（BaseAdapter 是唯一跨层契约，先改先测）；M2 一行配置验证主干设计；M3 新域在骨架之后；M4 对账须双源齐备；M5 收官。

## 4. 验收清单（v0.2.0 出口）

- [ ] `financials` 链头为 Wind：正常返回 `source: Wind` + `tier: quota`；Wind 不可用时按链降级 THS/AKShare（degraded 可观测，禁止静默降级）
- [ ] QUOTA 门控真触发：文本嗅探 → 触发调用报 QUOTA 错误并门控 1 天 → 到期自动恢复（模拟测试 + live 验证）；门控期内跳过 Wind、链内下一源出 degraded 结果
- [ ] 9 个工具全部注册（6 冻结 + 3 新增），klines period 扩展生效且 `1d` 行为与 v0.1.0 完全一致；schema 评审记录落档（DESIGN_REVIEW 决策 12）
- [ ] 对账：600519.SH / 000001.SZ quote+klines（未复权）双源对照，报告含逐行 diff + 双源数据时点，不自动修复；数据时点时滞不入误报
- [ ] 分钟线仅当日单日；周/月/季明确拒绝；无降级源明确告知
- [ ] 公告/EDB Wind 独家标注；EDB 两段式（指标简称检索）；AKShare 兜底仅白名单宏观指标
- [ ] Wind 纪律：默认串行、价格指标批量 ≤50、请求中永不出现 `.TI`（windcode 语义按源区分）、`correction` 只记录不自动重查
- [ ] CI 离线全绿：Wind fixture 回放 + AKShare golden（含新增宏观 golden）；kline golden 补录（若封锁解除）
- [ ] source 取值规范不变：信封/工具返回值一律 `同花顺` / `Wind` / `AKShare`
- [ ] v0.1.0 判定表行为回归绿：AUTH/PARAM/QUOTA 不重试不换源；RATE_LIMIT 退避不换源；TIMEOUT/NO_DATA/SOURCE_DOWN 链内换源

## 5. 关键机制要求（源自 LESSONS，实现时对照）

1. **adapter 绝不自己重试**——重试/退避/门控/降级全归路由（沿用 v0.1.0 第 1 条）
2. **双形状解析**：Wind EDB 已实测换过形状（`indicators[].series` → columnar `data[].{meta,date[],value[]}`）——解析器兼容新旧形状，旧 fixture 保留
3. **0.000 陷阱**：免费 tier 市净率返回字面 `0.000` 不报错——估值默认只问 市盈率(TTM)，PB 只信 THS（`pb_mrq`）；0 值混入真实值要告警
4. **`aftype` 无不复权字面量**（`none→0`，0=前复权）→ Wind 行永不当未复权用（对账双保险；Wind 本就不参与对账）
5. **windcode 语义按源区分**：`.TI` 只在 THS 侧合法（Wind 会把 `000001.TI` 静默读成平安银行且币种变 JPY）——指数/板块走 Wind 需 windcode 映射（v0.2.0 不接，映射缺口记录在案）
6. **QUOTA 行为沿用 v0.1.0 已实现语义**：触发调用报 QUOTA 错误 + 门控 1 天；门控期内跳过该源、链内下一源出 degraded 结果——不允许"降级一次后永久按降级处理"；DEGRADATION.md 补一句澄清
7. **对账只比数据时点**（as_of_ms/date_ms），绝不比查询时点；只对账未复权 + 免费源间（THS×AKShare），Wind 只作基准不参与对账
8. 空值纪律（`null` 不补零不模拟）、单位未知不猜、判定表外置、错误上下文完整：沿用 v0.1.0 第 3/4/6 条

## 6. 版本展望（主线之外独立决策：基金域、研报）

| 版本 | 内容 |
|---|---|
| v0.3.0 | dump 落盘 + 数据湖、Wind fund/index/analytics 域、symbols 自动同步 + windcode 列（按需）、CI 自动化 |
| v0.4.0 | `fin_agent__*` 编排层（数据层零改动） |

## 7. 风险

| 风险 | 缓解 |
|---|---|
| Wind 三表不可用 / 响应形状与预期差异大 | M0 决策门：financials 链保持现状，Wind 只接公告/EDB/分钟线（映射表与 LESSONS 记录在案，不阻塞其余里程碑） |
| Wind 契约漂移（无版本） | verify-contracts.py 扩展（tool-manifest diff）+ 双形状解析 + fixture 回放 |
| Wind 积分消耗不可预测 | 门控 TTL 1 天 + `tier=quota` 可见 + 快照不烧 Wind（quote/klines 链不加 Wind）+ 文档明示 |
| 对账误报（数据时滞/口径差异） | 只对账未复权 + 数据时点对齐 + 容差与时滞窗口外置配置 + 分歧不自动修复 |
| 分钟线被 LLM 误用（跨日/多周期） | 工具描述明示"仅当日、无降级源"；周/月/季明确拒绝 |
| 估时乐观 | 合计 +20% buffer；M0/M1 逐个过 gate |
