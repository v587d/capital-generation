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
- [x] 数据湖：官方 marketdb CLI 集成 (scripts/lake.py 薄封装)；**live 全量 sync 待网关恢复后执行** (命令: HITHINK_FINANCE_API_KEY=<key> lake.py sync; 复权对账脚本 /tmp/verify_adjust.py 就位)；目录可配置；wrapper 层 flock 排他；_import_batches 审计由官方导入器维护
- [x] 复权因子：官方 calc_adjust_factor_daily 产出 forward/backward (合成样本验证方向正确: 除权日前 factor<1, 后=1)；抽样对账待全量同步后 live 验证
- [x] validate 8 项 + rebuild（禁删 raw）可用；合成样本离线全流程测绿 (tests/unit/test_lake.py TestOfflineFlow)
- [x] 11 工具全注册 (stdio 无 key 实测 tools/list 11/11)；schema 评审记录落档 (DESIGN_REVIEW 决策 13)；九工具 schema 回归绿
- [x] fund 域：链 [ths, wind] + 3004→NoData 兜底路由测试绿；ETF≤5年/仅ETF快照 L3 标注；资产 gate 正确；live 验证待 THS 冷却
- [x] index 域：quote/kline/constituents [ths, wind] + fundamentals/basicinfo [wind]；成分仅当前明示；H11077.SH 直通 OK (Wind fixture + 单测)；live 验证待 THS 冷却
- [x] analytics：决策门 B 出局 (get_financial_data 含目标价/评级) — 落档 LESSONS §6.5 + DESIGN_REVIEW 决策 13
- [x] windcode 纪律：无 .TI 外发单测 (test_windcode_direct_pass_no_ti)；fund .SZ/.SH/.OF 与 index .SH/.SZ + H11077.SH 直通 live 实测
- [x] symbols 自动同步：--if-stale + 启动 stale warning + 单测 (TestSyncIfStale / TestSymbolsStaleWarning)
- [x] CI：scripts/ci.py 全绿 (ruff + pytest 195+1 + 双源契约漂移 + symbols 新鲜度)；.pre-commit-config.yaml + Makefile 就位
- [x] fixtures/goldens：Wind fund/index 10 fixtures 录制回放绿 (test_wind 29 passed)；v0.1.1 完成 (新浪/腾讯 golden 已录, 东财 golden 维持显式 skip)；**THS fund/index 11 fixtures 后台补录中** (bash-14 探测-录制循环; 根因: THS 间歇 2003 限流, LESSONS §6.5; 录到后回放测试自动激活)
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
| 顺带优化 A | **LLM-first 错误消息规范**（§9.1）：全量审计错误/引导消息，三要素 = 发生了什么+为什么+下一步动作 |
| 顺带优化 B | **上下文 token 优化**（§9.2）：Kline 渲染压缩 / announcements content 截断 / schema 精简 / 结果 token 预算 |

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

## 8. 遗留 live 验证项 (2026-08-15 记录, 待 THS 网关恢复后补做)

> 发布时 (786803f, tag v0.3.0) 全部离线工作完成 (197 tests + 9 skip, CI 全绿)。
> 以下四项依赖 THS 网关 (间歇 2003 限流, 见 `docs/LESSONS.md` §6.5), 均不阻塞发布;
> 对应测试已就位 (缺失时显式 skip), 补做后自动激活。

### 8.1 THS fund/index fixtures 录制 (11 条)

- 目标文件: `tests/fixtures/ths/{fund_snapshot_510300,fund_snapshot_lof_160105,fund_kline_510300,
  fund_nav_510300,fund_returns_510300,fund_holdings_510300,fund_holders_161725,
  fund_profile_510300,index_snapshot_000300,index_kline_000300,index_constituents_000300}.json`
- 格式: 原始信封 `{"code":0,"message":"success","request_id":"fixture","data":{...}}`
  (与既有 `tests/fixtures/ths/*.json` 同款; 端点/参数清单见 `tests/adapters/test_ths.py`
  `FUND_INDEX_FIXTURES` 表)
- 录制节奏: **单发探测成功 → 立即 ≥3s 节奏连录 11 条 → 遇 2003 冷却 5-10 分钟重来**
  (THS 高频限流无稳定数学模型; 严禁连发)
- 强制 IPv4: 沙箱 IPv6 出口不可达 → patch asyncio 事件循环 `getaddrinfo` 为
  `family=AF_INET` (**注意: patch `socket.getaddrinfo` 属性对事件循环无效**)
- 录到后: `tests/adapters/test_ths.py::TestFundIndexFixtures` 8 条回放测试自动激活,
  跑 `uv run pytest tests -q` 全绿后补提交

### 8.2 数据湖全量同步 + 复权对账

- `HITHINK_FINANCE_API_KEY=<ths_key> uv run python scripts/lake.py sync` (auto-sync 自动判
  全量/增量; 首次全量 = daily-k 10 年 ~945 万行 + adjustment-factors + 增量 daily-k-10d)
  → `lake.py validate --json` (8 项, error 级退出码 1)
- 复权对账 (原 `/tmp/verify_adjust.py` 已删, 逻辑):
  1. 湖侧: `lake.py query --json --sql "SELECT thscode, date, close FROM v_daily_qfq
     WHERE thscode IN ('600519.SH','000001.SZ') ORDER BY thscode, date"`
  2. THS 侧: `THSAdapter.get_klines(symbol, start_ms, end_ms, adjust="forward")`,
     窗口取 2026-06-01 ~ 2026-07-10 (含除息日)
  3. 按 `(symbol, date)` 对齐, `|lake - ths| / ths > tolerance_pct` (0.5%,
     `config/reconcile.yaml`) 计 mismatch; 0 mismatch 即通过

### 8.3 live-probe 全链路

- `THS_API_KEY=<key> WIND_API_KEY=<key> uv run python scripts/live-probe.py`
- 期望: tools/list 11/11; 新增用例含 `fin_data__get_fund_data` (nav/holdings/kline)、
  `fin_data__get_index_data` (quote/constituents)、Wind 兜底用例
  (000037 OTC 基金 quote: THS 3004 → Wind 分钟行情, degraded 可观测)

### 8.4 东财 kline golden 补录 (v0.1.1 余项)

- 东财 push2his IP 封锁未解除 (2026-08-15 重试仍 TCP 层 ConnectionError, LESSONS §5.4);
  封锁解除后 `uv run python scripts/record-goldens.py` (kline_600519_1m 不再 skip,
  同时补录 quote_600519); 新浪/腾讯 golden 已录, 不受影响


## 9. 后续优化备忘 (2026-08-15 用户提出, 顺带项)

### 9.1 LLM-first 错误消息规范

**定位**: MCP 的消费方是 LLM 不是人 — 每条错误/引导消息都是给 LLM 的下一条指令。
这是本项目区别于同花顺/万得原生 SDK 的核心优势: 不只转发错误, 而是翻译成可执行动作。

**现状审计结论**:
- ✅ 已有好的先例: DEGRADATION 判定表"模型看到"列 (AUTH→"请检查配置"),
  3002→"保留 request_id 稍后可重试, 不得补零", ConnectError→"请稍后重试或检查网络" (5d53ed5)
- ❌ 典型反例: THS `2003 "Invalid or revoked API key"` 原文透传 — 2026-08-15 实测它
  **可能是临时限流而非 key 失效**, LLM 看到英文原文会误判并引导用户换 key (错误动作!)
- ❌ 其他: akshare "接口漂移" 无下一步; InternalError "未分类异常" 无下一步;
  部分 warnings 只有描述没有动作建议

**规范草案 (每条消息三要素)**:
1. 发生了什么 (vendor + endpoint + code/类型, 保留原文细节)
2. 为什么 (归类: 限流/权限/参数/暂无数据/网络/内部)
3. 下一步动作 (LLM 可执行: 等多久重试 / 改什么参数 / 换什么标的 / 检查什么配置)

**实施清单 (顺带, 全量审计)**: `core/domain/errors.py` + `ths.py` + `wind.py` +
`akshare_adapter.py` + `servers/mcp_data.py` + `routing.py` 的全部 raise/warnings 消息;
重点: THS 2003/4001 消息按本次实测语义改写 (2003 可能=临时限流, 引导"稍后重试");
非错误返回 (ambiguity/not_found/not_asset/降级 warnings) 同步 review。

### 9.2 上下文 token 优化

**量化实测 (2026-08-15, DSH 会话)**:
- 用户实测: 两轮 10 steps ≈ 5 万+ tokens; tool result ≈ 4 万; tool schema ≈ 1 万
- 本仓库侧实测:
  - **工具 schema+desc 11 个 ≈ 1373 tokens/轮** — DSH 每轮注入工具列表,
    10 steps ≈ 1.4 万 (与用户感知吻合); 大头是 FastMCP 冗余 title + 长 description
  - **Kline 渲染 ≈ 100 tokens/根** — 每根重复 symbol/currency/period/adjust/source/tier/
    degraded/extra 全字段; 30 根=3165, 1 年≈2.5 万, **10 年窗口≈24 万 (灾难)**
  - **announcements content 全文透传** — 600519 单条 8466 chars ≈ 2100 tokens;
    top_k=10 可达 2-4 万 ← result 大头 #1

**优化清单 (顺带, 边做边想)**:
1. **Kline/Quote 渲染压缩**: 表头提取公共字段 (symbol/currency/adjust/source/tier 只出现一次)
   或紧凑行格式; 目标 -60~80%; 渲染层改动不碰数据层
2. **announcements content 截断**: 默认每条约 500-800 字符 + `truncated: true` 标注 +
   url 保留 (全文可让 LLM 提示用户自取); top_k 默认 10→5 或描述写明
3. **schema 精简**: FastMCP 是否可关冗余 title (如支持省 ~20-30%); description 压缩为
   行动指令 (参数含义交给 schema, 描述只写"何时用/怎么用")
4. **工具描述引导**: get_klines 明示"窗口 ≤1 年、优先日线, 分钟线仅当日";
   EDB observation 默认 10; special size 默认 50 可再降
5. **结果 token 预算 (远期)**: 渲染层统一预算 + 截断 + warnings 标注 (可配置外置,
   绝不静默丢数据 — 与"降级可观测"同哲学)
6. 注意: 工具 schema 冻结依赖 (KV-cache 前缀稳定) — 优化只减字数不改参数名/结构
