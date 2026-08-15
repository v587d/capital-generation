# 研发计划 — capital-generation v0.3.0

> 2026-08-15 | 版本边界与里程碑。承接 `PLAN-0.2.0.md`（已收官，139 passed + 1 skip 全绿）§6 与 `PLAN.md`（v0.1.0 冻结面存档）§6 展望。**用户裁定（2026-08-15）**：① 数据湖**纯离线数据资产，不进 LLM**（延续 v0.1.0 裁定，工具面零膨胀）；② Wind fund/index/analytics 域**按需最小接线**；③ 数据湖**整体采用 THS 官方 marketdb CLI**（LESSONS §3.4「P3 可整体采用，不必自创」）。
> 实施前必读：`docs/LESSONS.md`（§3.2/§3.4 契约事实、§5 坑、§7 缺口）、`docs/DEGRADATION.md`（主干+备用）、`docs/DESIGN_REVIEW.md`（决策 12 为 schema 评审先例，决策 13 为本版本评审记录）。

## 1. v0.3.0 定位

**第三个可发布版本**：① 数据湖落地（官方 marketdb CLI 集成：四层表 + 复权因子推导 + validate/rebuild 修复，离线 CLI 资产，DSH 侧不可达——明确告知）；② Wind fund/index 域按需最小接线（THS 基金 7 端点 + 指数 4 端点同步接线为免费主干，chains 按「主干+按域备用」扩展）；③ symbols 自动同步 + windcode 列（按需）；④ CI 自动化（本地一体化检查 + pre-commit，仓库无 remote）。

## 2. 边界（2026-08-15 确定）

### 2.1 范围（做）

| 维度 | 内容 |
|---|---|
| 数据域 | **基金域**（净值/收益/持仓/持有人/场内行情/基本信息/K线，THS 主干 + Wind 补缺）、**指数域**（行情/K线/成分/基本面/指标/基本信息，指数行情 THS 主干）、**数据湖**（全市场日K 10 年 + 近 10 交易日增量 + 复权因子，Parquet → 官方 marketdb 四层库，**离线 CLI 资产不进 LLM**） |
| 数据源 | THS（基金/指数 REST 新端点接线）、Wind（fund_data 10 工具 + index_data 6 工具中按需子集）、官方 Financial-API marketdb CLI（数据湖，subprocess 集成）；AKShare 不变 |
| 核心机制 | 官方 marketdb（raw/calc/dim/stg 四层 + `_meta` schema_version + `_import_batches` 审计 + `data.lock` 排他锁 + validate 8 项 + rebuild 禁删 raw + forward/backward_factor）、dump 下载纪律（presigned URL TTL 5min 立即下载、OBS HEAD→XML 须 GET+Range 206 断点续传）、资产类别 gate 扩展（fund/index 工具）、windcode 按源语义（`.TI` 永不外发 Wind）、积分纪律沿用（快照/净值免费主干、串行、批量 ≤50）、symbols 自动同步（--if-stale + 启动 stale 检测） |
| 交付物 | `scripts/lake.py`（官方 CLI 薄封装）+ `core/lake/`（wrapper + 审计读取，按 M0 仓库可达性定）+ ths.py/wind.py 域扩展 + 2 个新工具（`fin_data__get_fund_data` / `fin_data__get_index_data`，schema 评审后冻结）+ chains.yaml 新域 + symbols 自动同步 + `scripts/ci.py` + pre-commit + fixtures/goldens + 文档同步 |

### 2.2 非目标（明确不做，防止范围蔓延）

| 项 | 原因 | 归属 |
|---|---|---|
| 数据湖进 LLM（查询工具） | **用户裁定：纯离线数据资产**；DSH 侧全市场扫描仍不可达，工具描述明示 | 用户裁定（未来如需 = 新工具 + schema 评审） |
| Wind bond 域（4 工具） | v0.2.0 裁定未含 | 未排期 |
| 指数/板块行情走 Wind（885xxx.WI） | windcode 映射缺口无权威表，沿用 v0.2.0 非目标；指数行情继续 THS | 按需评估 |
| 分钟线跨日放开 | 积分纪律 + v0.2.0 裁定；LESSONS §5.2 跨日能力已记录 | 未来决策 |
| Wind `correction` 自动重查 | v0 只记录，v1 候选 | 未排期 |
| 基金/指数对账 | 对账限未复权+免费源间，基金/指数无可比免费源 | — |
| v0.1.1 kline 兜底（新浪/腾讯）+ kline golden 补录 | 未排期；**M0 顺带项**（同一适配器区域，低风险） | 顺带 |
| agent 编排层（`fin_agent__*`） | 数据层先稳 | v0.4.0 |

### 2.3 工具面（v0.3.0 变更清单，发布前一次 schema 评审，评审记录落 `docs/DESIGN_REVIEW.md` 决策 13）

**v0.1.0/v0.2.0 九个工具一字不动**（冻结契约）。变更仅以下：

| 工具 | 变更 | 内部链（chains.yaml） | 备注 |
|---|---|---|---|
| `fin_data__get_fund_data` | **新工具**：`symbol, kind`(quote/nav/kline/holdings/holders/performance/info), `start/end?`, `limit?` | quote/nav/holdings/holders/performance → `fund: [ths, wind]`；kline → `fund_kline: [ths, wind]`（THS ETF≤5年无 adjust、LOF 无历史，限制 L3 标注，Wind 兜底）；info → `[wind]` | 资产 gate：asset_type ∈ fund（etf/lof/otc/reits）；快照批量 ≤50 纪律 |
| `fin_data__get_index_data` | **新工具**：`symbol, kind`(quote/kline/fundamentals/indicators/constituents/basicinfo), `start/end?`, `limit?` | quote/kline/constituents → `index: [ths, wind]`；fundamentals/indicators/basicinfo → `index_fund: [wind]` | 资产 gate：asset_type=index；成分仅当前（THS 无历史成分）；指数特殊码（H11077.SH 等）windcode 直通 M0 实测，失败 → 映射表补录或 NO_DATA+明示 |
| analytics 域（Wind `get_financial_data`） | **M0 决策门**：核实返回内容；若属评级/目标价 → 触及「研报/评级/目标价不覆盖」裁定（LESSONS §1），**出局并记录在案** | — | 不新增工具，除非 M0 裁定可行 |

`config/chains.yaml` 新增 `fund` / `fund_kline` / `index` / `index_fund` 四域；`config/symbols.json` 按 M0/M3 需要加 `windcode` 列（或独立 `config/windcode_map.yaml`）。

## 3. 里程碑

| 里程碑 | 内容 | 估时 | 出口标准 |
|---|---|---|---|
| M0 基线落袋 + 契约盘点（三决策门） | ① 提交 v0.2.0 工作树（139 green）并 tag；② 拉取 THS 官方 Financial-API 仓库（LESSONS 引用源，本机 `.clone` 已不存在）核实 marketdb CLI：安装/调用/许可证、`data init/sync/validate/rebuild` 命令面、dump 响应形状（presigned URL/OBS 206）、能否 `--source local` 喂合成 parquet（离线测试可行性）；**决策门 A：仓库不可达 → 回退自建 core/lake（DuckDB，语义不变），与用户确认**；③ Wind fund/index 工具逐项 live 核实（fund .SZ/.SH/.OF 与 index .SH/.SZ 直通、特殊码、question 类响应形状、get_financial_data 边界 → **决策门 B**）；④ THS 基金/指数端点 live 核实；**决策门 C：windcode 直通或映射表**；⑤ 工具面初稿 → schema 评审（决策 13）；⑥ 顺带 v0.1.1（akshare kline 新浪/腾讯兜底 + golden 补录尝试）；⑦ 结论写回 LESSONS | 1.5d | 三决策门结论 + 映射终表 + 官方仓库可达性判定；基线 commit+tag |
| M1 数据湖下载层 | `scripts/lake.py` 薄封装官方 CLI `data init/sync`：daily-k（10 年全市场 ~945 万行）/ daily-k-10d（~25 万行增量）/ adjustment-factors（~5.2 万行）；presigned URL 5min TTL 立即下载 + 过期重取；OBS HEAD→XML 识别 + GET+Range（206）断点续传；目录可配置（默认 `dumps/`，gitignored）；`data.lock` 排他纪律（并发调用方单进程）；批次 manifest 审计读取 | 1.5d | wrapper 单测（mock 子进程）绿；官方 CLI 集成测试标 live-skip（无 key/网络时）；断点续传单测 |
| M2 数据湖仓库 | 官方 marketdb 四层 raw/calc/dim/stg + `_meta` + `_import_batches` 落地；复权因子推导（官方 forward/backward_factor，默认 forward 最新价对齐真实——不重复实现算法，官方为基准）；validate 8 项质量校验 + rebuild（禁删 raw）；**复权对账验收**：本地 forward 复权价 vs THS 接口 adjust=forward 复权K线抽样对比（600519.SH/000001.SZ，THS 官方为基准，免费源不参与）；合成小样本（构造 10 股 × 2 年日K + 因子事件）走 `--source local` 离线验证 | 2d | 合成样本离线 validate/rebuild/因子全绿（若官方 CLI 支持 local；否则 wrapper mock + live 集成标 skip）；复权对账抽样一致（容差外置 config/reconcile.yaml 复用） |
| M3 Wind fund/index 最小接线 | wind.py 扩展：fund（get_fund_kline/get_fund_quote/get_fund_price_indicators/get_fund_holdings/get_fund_performance，info 类待 M0 核实）；index（get_index_kline/get_index_quote/get_index_fundamentals/get_index_price_indicators，technicals/basicinfo 待 M0）；analytics 按决策门 B；双形状解析 + 真实 key fixture 录制（10–15 条含错误信封）+ error_map 复用 + 串行并发纪律 + 批量 ≤50 | 1.5d | adapter 单测 + fixture 回放绿（CI 离线）；live 冒烟；windcode 直通/映射表生效（无 `.TI` 外发） |
| M4 THS 基金/指数域 | ths.py 扩展：基金 7 端点（净值/收益/持仓/持有人/场内行情等）+ 指数 4 端点（行情/成分/板块）；fixture 录制；inclusiveStart/裸码/错误码复用；资产类别 gate 扩展 | 1d | fixture 回放绿；live 冒烟 |
| M5 工具面装配 | `fin_data__get_fund_data` / `fin_data__get_index_data` 注册（tool logic 纯函数可离线单测）；chains.yaml 四新域；instructions/工具描述更新（Wind 独家域明示 + 「数据湖为离线资产，不支持全市场扫描」）；DESIGN_REVIEW 决策 13 落档；tools/list 11 工具断言 | 1d | `tools/list` 11/11；schema 评审记录；单测绿 |
| M6 symbols 自动同步 + CI | sync-symbols.py `--if-stale`（TTL 默认 30 天）+ 服务启动 stale 检测 warning（无 key/失败降级本地快照 + warnings）；windcode 列产出（按 M0/M3 需要）；`scripts/ci.py`（ruff check + format check + pytest 全量离线 + verify-contracts --offline + symbols 新鲜度 informational）+ pre-commit hook（ruff）+ Makefile；verify-contracts `--offline` 改为仓库内缓存 `config/ths/llms-full.txt`（现依赖仓库外绝对路径，CI 不可用）；可选 `.github/workflows/ci.yml`（remote 就位后启用） | 1d | ci.py 全绿；pre-commit 生效；verify-contracts 双源离线可跑 |
| M7 验收 | live-probe 扩展（fund/index 用例，WIND key 可选）；verify-contracts 扩展（THS dump/基金/指数端点纳入 diff，Wind 新工具自动覆盖）；README/DEGRADATION（新域链 + 数据湖离线声明）/DATA_MODEL/DESIGN_REVIEW/LESSONS/PLAN.md §6 指针同步；pyproject version 0.3.0 | 1d | §4 验收清单全绿 |

合计 ≈ 10.5 天（+20% buffer ≈ 13 天）。**顺序理由**：M0 先行——三决策门（官方仓库可达性 / analytics 研报边界 / windcode 直通）是 v0.3.0 的事实基础；M1→M2 数据湖（纯离线、无依赖，先行验证官方 CLI 集成路径）；M3 先于 M4（Wind 新形状风险高先测，沿用 v0.2.0 先 Wind 的次序）；M5 装配在双源齐备后（schema 冻结前不写协议层）；M6 工程化；M7 收官。

## 4. 验收清单（v0.3.0 出口）

- [x] v0.2.0 基线落袋：工作树提交 (8621c40) + tag v0.2.0；全量回归 195+1 保持绿
- [x] 数据湖：官方 marketdb CLI 集成 (scripts/lake.py 薄封装)；全量+增量 sync 待 THS 网关冷却后 live 验证；目录可配置 (--db/MARKETDB_DB_PATH)；wrapper 层 flock 排他 (官方无内置 data.lock, LESSONS §6.5)；_import_batches 审计由官方导入器维护
- [x] 复权因子：官方 calc_adjust_factor_daily 产出 forward/backward (合成样本验证方向正确: 除权日前 factor<1, 后=1)；抽样对账待全量同步后 live 验证
- [x] validate 8 项 + rebuild（禁删 raw）可用；合成样本离线全流程测绿 (tests/unit/test_lake.py TestOfflineFlow)
- [x] 11 工具全注册 (stdio 无 key 实测 tools/list 11/11)；schema 评审记录落档 (DESIGN_REVIEW 决策 13)；九工具 schema 回归绿
- [x] fund 域：链 [ths, wind] + 3004→NoData 兜底路由测试绿；ETF≤5年/仅ETF快照 L3 标注；资产 gate 正确；live 验证待 THS 冷却
- [x] index 域：quote/kline/constituents [ths, wind] + fundamentals/basicinfo [wind]；成分仅当前明示；H11077.SH 直通 OK (Wind fixture + 单测)；live 验证待 THS 冷却
- [x] analytics：决策门 B 出局 (get_financial_data 含目标价/评级) — 落档 LESSONS §6.5 + DESIGN_REVIEW 决策 13
- [x] windcode 纪律：无 .TI 外发单测 (test_windcode_direct_pass_no_ti)；fund .SZ/.SH/.OF 与 index .SH/.SZ + H11077.SH 直通 live 实测
- [x] symbols 自动同步：--if-stale + 启动 stale warning + 单测 (TestSyncIfStale / TestSymbolsStaleWarning)
- [x] CI：scripts/ci.py 全绿 (ruff + pytest 195+1 + 双源契约漂移 + symbols 新鲜度)；.pre-commit-config.yaml + Makefile 就位
- [ ] fixtures/goldens：Wind fund/index 10 fixtures 录制回放绿 (test_wind 27 passed)；THS fund/index fixtures 待网关冷却录制；v0.1.1 完成 (新浪/腾讯 golden 已录, 东财 golden 维持显式 skip)
- [x] v0.2.0 判定表行为回归绿 (195+1 全量; 路由仅加新域方法表 + 快照 TTL)
- [x] 文档同步：README/DEGRADATION/DATA_MODEL/DESIGN_REVIEW 决策 13/LESSONS §6.5/PLAN.md §6 指针 + PLAN-0.3.0.md 本体

## 5. 关键机制要求（源自 LESSONS，实现时对照）

1. **adapter 绝不自己重试**——重试/退避/门控/降级全归路由（沿用）
2. **双形状解析**：Wind fund/index question 类工具与 THS 基金/指数端点都可能换形状——解析器兼容新旧形状，旧 fixture 保留
3. **复权以官方 marketdb 为基准**：不重复实现因子算法；本地复权价只与 THS 官方复权接口对账，免费源不参与（对账双保险：Wind 行永不当未复权用，沿用）
4. **windcode 按源区分语义**：`.TI` 只在 THS 侧合法，永不外发 Wind；指数特殊码 M0 实测（LESSONS §5.2 实测教训：Wind 把 `000001.TI` 静默读成平安银行）
5. **积分纪律**：快照/净值类 THS 免费主干，Wind 只补 THS 无能力处（fund kline 长历史、index fundamentals 等）；默认串行、批量 ≤50、先探针后扩散
6. **dump 下载纪律**：presigned URL TTL ~5 分钟，拿到立刻下载；OBS HEAD 返回 XML 不能用，须 GET + Range（206）断点续传；`data.lock` 排他；3 次请求替代 ~5000 次逐股拉取
7. **数据湖不进 LLM**（用户裁定）：无新湖工具；工具描述与 DEGRADATION 明示「全市场扫描不支持，数据湖为离线资产」；全市场需求经 `scripts/lake.py` CLI
8. **修复语义 = validate 诊断 + rebuild 重建视图/因子，禁直接删库**（`_meta` schema_version 校验 + `_import_batches` 导入审计）
9. 空值纪律（null 不补零不模拟）、判定表外置、错误上下文完整（vendor+endpoint+status+code+request_id）：沿用
10. **新工具 schema 评审后再冻结**（决策 13 流程同决策 12：评审记录落 DESIGN_REVIEW，发布后任何人改动需讨论）

## 6. 版本展望

| 版本 | 内容 |
|---|---|
| v0.4.0 | `fin_agent__*` 编排层（数据层零改动） |
| 未排期 | Wind bond 域（4 工具）、分钟线跨日、Wind correction 自动重查、数据湖进 LLM（若未来裁定 = 新工具 + 评审）、基金/指数对账、v0.1.1 剩余项（kline golden 补录，东财封锁解除后） |

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 官方 Financial-API 仓库不可达/许可证不兼容 | M0 决策门 A：回退自建 core/lake（DuckDB，四层语义不变），与用户确认后执行 |
| marketdb CLI 命令面与 LESSONS 记录漂移 | M0 live 核实命令面；wrapper 层容错 + 清晰的错误上下文 |
| 官方 CLI 不支持 `--source local` 合成样本（离线测试不可行） | 测试策略降级：wrapper mock 子进程单测 + live 集成测试显式 skip（有据） |
| Wind fund/index question 类响应形状未知 | M0 先行核实 + 双形状解析 + fixture 回放；live 冒烟 |
| 指数特殊码 windcode 直通失败（H11077.SH/950116CNY050.SH） | 映射表补录（config/windcode_map.yaml）；失败则该类工具 NO_DATA + 文档明示，不阻塞 |
| analytics 触及「研报/评级/目标价不覆盖」裁定 | M0 决策门 B：出局并记录在案，不阻塞其余里程碑 |
| 全量 dump 下载体量/时长（~945 万行） | 增量策略（daily-k-10d）+ 断点续传 + 后台任务 + 目录可配置 |
| 东财封锁未解除（kline golden） | 保持显式 skip，v0.1.1 顺带项部分完成即可 |
| 估时乐观 | 合计 +20% buffer；M0 三决策门逐个过 gate |
