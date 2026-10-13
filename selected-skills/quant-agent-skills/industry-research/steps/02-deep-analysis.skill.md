---
name: industry-research-step-02-deep-analysis
description: |
  industry-research Step 2-4：5 Agent并行 + Debate+Leader辩论裁决 + 行业预期差+期望值框架。
  v1.4.0: Step4新增「先按行业适配方法做估值对比」软提示(与stock-research v2.33.0 §5.8同源)——填三情景估值锚前先按行业→适配方法速查表定方法,逐标的调route_valuation(ts_code),禁单一PE列横向排序周期/未盈利/平台型行业(纯软提示,gate §7.10仅stock_research)。
  v1.5.0: 5 Agent 必须读取 Fresh Public Signal Sweep 矩阵；catalyst-risk 负责把 S0/S1 承重信号转为触发器，把 S2/S3 保持为待验证线索。
  v1.6.0: Step 4.1 接入 industry earnings causal model（Phase 91 GATE-01）——有真 driver 的行业跑模型填 CAGR/概率，无 driver 软提示回退手填。
metadata:
  version: 1.6.0
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# Step 2-4: Multi-Agent 深度分析 + 辩论 + 期望值

## Step 2: 5 Agent 并行研究

每个 Agent 输出约 300 字核心发现 + 互评其他 Agent 至少 2 条。详细 Agent 定义见 `agents/` 目录。

| Agent | 文件 | 核心问题 |
|-------|------|---------|
| macro-industry-agent | `agents/macro-industry-agent.skill.md` | 宏观变量如何影响这个行业？当前处于什么周期位置？ |
| chain-agent | `agents/chain-agent.skill.md` | 中国在产业链什么位置？议价能力如何？谁在替代我们？ |
| competition-agent | `agents/competition-agent.skill.md` | CR5趋势？新进入者威胁？护城河量化？ |
| valuation-agent | `agents/valuation-agent.skill.md` | A股vs国际同行的PE/PB/ROE/GM？估值溢价有基本面支撑吗？ |
| catalyst-risk-agent | `agents/catalyst-risk-agent.skill.md` | 未来6-12月的催化剂？最大的3个风险？公开快信号哪些能承重、哪些只是 lead？地缘政治影响？ |

**输出规范**：
- 每个 Agent 输出 ≤300 字
- 互评：每个 Agent 至少评论 2 个其他 Agent 的发现
- 引用溯源：[A1]-[A5] 标记每条结论来源
- **🛑 研报全量阅读**：所有 Agent 必须完整阅读 Step 1 检索到的每一篇研报正文（国内外全覆盖）。禁止抽选/跳读/只看标题。量太大用子 Agent 分批并行读取，每篇必须提取评级/目标价/核心论点/关键假设/风险/分歧点
- **🛑 公开信息矩阵读取**：所有 Agent 必须读取 `_public_signal_matrix_YYYYMMDD.{md,json}`。若矩阵缺失且研究由事件/政策/供应链/替代驱动，输出 `pending_public_signal_sweep`，不得进入最终配置裁决。
- **S2/S3 降级**：未经 S0/S1 或独立二源交叉验证的媒体/社媒信息，只能用于 `lead_only` 或 `scenario_weight`，不能直接改变配置建议、建议权重、核心标的名单或 trigger。

---

## Step 3: Debate + Leader 辩论裁决

```
Debate Agent: 生成最强看多论点(3条) + 最强看空论点(3条)
Leader: 逐条裁决——哪些论点有证据支撑？哪些是噪音？
输出: 行业多空裁决书 (≤500字)
```

**Bull/Bear 同等标准**：看多和看空必须同样篇幅、同样证据标准。不能"看多一句带过、看空列十条"。

**公开信号冲突处理**：如果快信号与研报/DB 相反，Leader 必须裁决到底是：
- `report_lag_to_verify`：研报可能滞后，生成下一次验证 trigger；
- `public_signal_noise`：快信号证据等级不足，降级为 lead；
- `old_thesis_invalidated`：S0/S1 已经证伪旧假设，调整三情景前提。

---

## Step 4: 行业预期差挖掘 + 三情景期望值

### 🎯 先按行业适配方法做估值对比（2026-06-07 valuation_router 同源新增——治"全行业用单一 PE 排名'谁便宜'"）

> **为什么**：价值的载体决定估值锚，不是品味问题。行业层横向估值对比必须用**该行业的适配方法**，单一 PE 列横向排名在结构错配的行业会系统性误判（卖方实证：腾讯/阿里用 SOTP / 信达用 rNPV / 中国核电用 DDM——研究报告 §二每篇投行研报都有 Valuation Methodology 段，方法跟着行业/公司结构走）。这与 stock-research v2.33.0 §5.8 同源同步。映射 SSoT = `docs/harness/valuation-method-routing-research-20260607.md §三/§五`，禁自创映射。

**行业→适配方法速查（填三情景"估值扩张/收缩到 ___x"锚之前先定方法）**：

| 行业类型 | 适配方法 | 禁用 |
|---------|---------|------|
| 银行 | **P/B-ROE 分位**（justified PB=(ROE−g)/(COE−g)，横向比 PB 分位不是 PE） | TTM PE 排名 |
| 保险 | **P/EV**（内含价值，利润确认口径失真，国内惯例；JPM 实操分部 SOTP） | PE |
| 地产 | **NAV 折价/PB**（盈利用 PB-ROE，亏损用 P/NAV——浙商利润正负分流） | TTM PE |
| 强周期（化工/有色/面板/存储/航运） | **PB-band 周期位置 + mid-cycle**（周期顶 PE 假便宜，禁 TTM PE 排"谁便宜"） | TTM PE 排名 |
| 未盈利赛道（创新药/AI/商业航天） | **PS / 管线价值（rNPV 逻辑）**（没有 E，PE 物理失效；申万三档子模型） | EPS×PE |
| 平台/多元集团（成分股） | **SOTP**（异质分部混成 blended PE 既高估差业务又低估好业务）——提示成分股逐个路由 | 整体 PE |
| 其余（半导体设备/光模块/PCB/消费成长/CXO） | **PE/PEG**（卖方主用法，无 gap，维持现状） | — |

**行业内标的逐个路由**（valuation-agent 估值对比 + watchlist 标的清单各跑一遍，把"该用什么方法"标在估值对比表表头）：

```python
from auto_research.toolchain.valuation_router import route_valuation

for ts_code in industry_constituents:   # 本行业 A股+港股标的清单（含港股最直接标的，见 Anti-Pattern #19）
    r = route_valuation(ts_code)         # ts_code 任意形（00700/00700.HK/002594.SZ）均可
    # r.primary_method  → SOTP / rNPV_PS / DDM / P/B-ROE / PB-band / NAV / PE
    # r.cross_check_method → 卖方双轨交叉验证方法（implied PE / 股息率 / PS ...）
    # r.rationale → 大白话理由；r.confidence → high/mid/low（low=港股无数据需人工判定行业归属）
    print(f"{ts_code}: {r.primary_method}（交叉验证 {r.cross_check_method}）— {r.rationale}")
```

**软提示规则（行业研究纯软提示，不硬拦——gate §7.10 非 PE 锚一致性门仅 stock_research 生效，行业研究不受其 BLOCK）**：
- 行业横向估值对比表表头标明所用方法，**禁用单一 TTM PE 列给整个行业排"谁便宜"**（周期/未盈利/平台型行业会系统性错判，见 valuation-agent 陷阱2/陷阱4）。
- **confidence=low**（港股 stock_basic 无行业 / 封装返回空）：路由器降级默认 PE，提示人工判定行业归属与价值载体后再选锚，不要盲信降级的 PE。
- ⚠️ **scope=路由器只判方法给锚模板名 + 理由**，不自动取行业倍数、不算 SOTP 加总、不算 rNPV 折现——倍数/口径由分析师手填。决策层（概率加权 EV vs 全市场平均门槛）对所有方法通用不变。

---

## Step 4.1: 因果模型驱动盈利估算（Phase 91 GATE-01 新增）

> **投资本质**：行业 CAGR 和情景概率不应手填端点（V2 病根1/3）。如果本行业有因果模型 driver，优先跑模型真算需求→供给→价格→公司全链，再填三情景模板。

### 4.1.1 Registry 查表：判断本行业是否有因果模型 driver

```python
from common.industry_earnings.industry_driver_registry import get_industry_driver

driver_cls = get_industry_driver("{行业目录名}")   # 如 "存储行业"
if driver_cls is not None:
    print(f"命中 driver: {driver_cls.__name__} — 进入模型驱动路径")
else:
    print("因果模型未实现此行业，盈利估算回退手填")
```

**Phase 91 激活范围**：仅 `"存储行业"` 有真 driver（`MemoryDemandModel`），其余行业返回 `None` 走回退路径。

### 4.1.2 命中真 driver（如存储行业）：模型跑数 → 填三情景

```python
from common.industry_earnings.model import IndustryEarningsModel
from common.industry_earnings.industry_driver_registry import get_industry_driver
import json
from pathlib import Path

# 1. 实例化 driver + 模型
driver_cls = get_industry_driver("存储行业")
driver = driver_cls()
model = IndustryEarningsModel(demand_layer=driver)

# 2. 读取 preregistration LOCK（上游 phase87-90 假设已锁）
repo_root = Path(__file__).resolve().parents[2]
prereg_path = repo_root / ".planning/research/phase90_assumptions_preregistration.json"
with open(prereg_path, encoding="utf-8") as f:
    assumptions = json.load(f)

# 3. 跑模型全链（demand 真算，其余层 try/except stub 不崩）
result = model.run(assumptions=assumptions, year=2028)

# 4. 提取三情景结果（来自 scenario_engine bull/base/bear 组合）
#    demand_revenue_usd_bn → 转行业营收 → 算 CAGR（非手填端点）
#    probability_qualitative → tier + band（非裸百分比）
#    assumptions_combo → provenance 追溯
```

**产出要求（填三情景模板之前必须完成）**：

1. **行业 CAGR**：从 `result["demand"].total_revenue_usd_bn` 推算行业营收，再算 CAGR。示例格式：
   - 景气情景 CAGR = (model_bull_revenue / current_revenue)^(1/n) - 1
   - 基准情景 CAGR = (model_base_revenue / current_revenue)^(1/n) - 1
   - 衰退情景 CAGR = (model_bear_revenue / current_revenue)^(1/n) - 1

2. **概率**：使用模型输出的 `probability_qualitative`，格式示例：
   - 景气情景概率 = 高（60-80），依据：底层假设组合 P(holds) subset 与 dependency_matrix 联合分解
   - 基准情景概率 = 中（40-60），依据同上
   - 衰退情景概率 = 低（10-30），依据同上
   - **禁止写 "0.25" "0.50" "0.75" 等裸百分比数字**

3. **Provenance**：每个情景必须附带 `model_run_id`（assumptions_combo hash + as_of 日期）+ `assumptions_combo` 引用指针。

4. **Evidence 文件**：写入 `{行业目录}/_industry_earnings_model_YYYYMMDD.json`，含：
   - `bull` / `base` / `bear` 全链结果（`demand_revenue_usd_bn`、`supply_realized`、`price_asp`、`company_earnings_uplift`、`company_split`）
   - `probability_qualitative`（tier + band）
   - `assumptions_combo` 引用
   - `model_run_id`
   - 必须产出 JSON evidence 后，再填下方三情景模板。

**⚠️ scope 边界**：
- `company_earnings_uplift` 留给下游 **stock-research Step 5**（个股 L3），不进 industry Step 4 承重。
- 估值倍数（扩张/维持/收缩到 ___x）仍是分析师判断，模型只驱动 CAGR 和概率。

### 4.1.3 未命中 driver（无模型行业）：软提示回退

若 `get_industry_driver("{行业名}")` 返回 `None`：

> 因果模型未实现此行业，盈利估算回退手填。继续后续人工判断，不阻断流程。

此时 CAGR 和概率由分析师基于研报共识/历史数据手工估算，仍须遵守：
- 概率用定性判断（高/中/低），不编造精确百分比
- 每档概率对应区间：高=60-80%，中=40-60%，低=10-30%

---

```
市场定价了什么？（行业当前估值隐含的增长预期——按上方适配方法读，不是无脑 PE）
你的判断和市场有什么不同？
三情景:
  - 景气情景 (概率:高/中/低): 行业CAGR ___%, 估值扩张/收缩到 ___x（用行业适配方法的锚）
  - 基准情景 (概率:高/中/低): 行业CAGR ___%, 估值维持 ___x
  - 衰退情景 (概率:高/中/低): 行业CAGR ___%, 估值收缩到 ___x
期望回报 = Σ 概率 × 回报
行业配置建议: 超配/中性/低配, 建议权重 ___%
```

**⚠️ 概率用定性判断（高/中/低），不编造精确百分比。每档概率对应区间：高=60-80%, 中=40-60%, 低=10-30%。**
