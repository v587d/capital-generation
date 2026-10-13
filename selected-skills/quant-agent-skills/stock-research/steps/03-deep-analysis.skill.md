---
name: stock-research-step-03-deep-analysis
version: 2.18.2
description: |
  stock-research 第 2.3-3.5 步：A股特色增强分析(游资/解禁/政策) + Multi-Agent 并行深度分析 + 预期差挖掘 + 情景分析 + TAM增量映射。
  A股三维度Pre-Agent增强、Agent 编排、辩论裁决、六问、三情景期望值框架、证据分级、估值快照、产业TAM修正。
  Conductor 在进入深度分析阶段时加载此文件。
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---


## 第 2.3 步：A 股特色增强分析（v2.15.0 新增）

> 3 个 A 股特色增强模块，在数据采集完成后、Multi-Agent 分析前执行。
> 产出结构化 dict 注入 Agent 4（风险）和 Agent 5（催化剂）的 prompt，不额外消耗 Agent 调用。

```
Step 2: 委托采集 (existing)
    ↓
Step 2.3: A股特色增强分析 (NEW — 3 modules, sequential, ~2 min)
  ├─ Module A: 游资追踪 → smart_money_analysis dict
  ├─ Module B: 解禁监控 → lockup_analysis dict
  └─ Module C: 政策分析 → policy_analysis dict
    ↓
Step 2.5: Multi-Agent (Agent 4 风险 + Agent 5 催化剂 接收增强 dict)
```

---

#### Module A: 游资追踪 (Smart Money / Hot Money Tracking)

**Purpose**: Identify institutional vs retail behavior patterns using A-share specific data signals.

**Data Sources** (all existing, no new code):
```python
from common.stock_signals import (
    signal_summary,     # 全景一行调用
    get_moneyflow,      # 资金流: 超大单/大单买卖 (亿元)
    get_block_trades,   # 大宗交易: 机构席位/营业部
    get_northbound,     # 北向持股: 外资动向 (万股)
    get_insider_trades, # 增减持: 大股东/董监高
    get_shareholder_count, # 股东户数: 筹码集中度
)
```

**Structured Output** (`smart_money_analysis` dict):
```python
{
    "money_flow_trend": {
        "net_5d_yi": float,          # 5日净流入(亿元)
        "net_20d_yi": float,         # 20日净流入(亿元)
        "elg_buy_ratio": float,      # 超大单买入占比
        "signal": "bullish|neutral|bearish"
    },
    "block_trades": {
        "count_90d": int,            # 90天大宗交易次数
        "institutional_buy_pct": float,  # 机构席位买入占比
        "avg_discount_pct": float,   # 平均折价率
        "signal": "bullish|neutral|bearish"
    },
    "northbound": {
        "holding_change_30d_wan": float,  # 30天持股变化(万股)
        "holding_ratio_latest": float,    # 最新持股占比
        "trend": "accumulating|stable|distributing"
    },
    "insider_activity": {
        "net_change_90d_wan": float, # 90天净增减持(万股)
        "buy_count": int,            # 增持次数
        "sell_count": int,           # 减持次数
        "signal": "bullish|neutral|bearish"
    },
    "chip_concentration": {
        "holder_change_pct": float,  # 股东户数变化率
        "trend": "concentrating|stable|dispersing"
    },
    "composite_signal": "strong_buy|buy|neutral|sell|strong_sell",
    "composite_score": int,          # -2 to +2
    "a_share_notes": str             # A股特色注意事项
}
```

**Scoring Criteria**:
| Signal | Bullish (+1) | Neutral (0) | Bearish (-1) |
|--------|-------------|-------------|--------------|
| 资金流 | 5日净流入>0 且 超大单买入占比>60% | 净流入/流出<1亿 | 5日净流出>1亿 或 超大单卖出占比>60% |
| 大宗交易 | 机构席位买入>50% 且 溢价交易 | 营业部间对倒 | 折价>5% 且 机构席位卖出 |
| 北向资金 | 30天增持>500万股 | 变化<200万股 | 30天减持>500万股 |
| 内部人 | 90天净增持 | 无交易 | 90天净减持 |
| 筹码 | 股东户数环比-5%+ (集中) | 变化<3% | 股东户数环比+10%+ (分散) |

**A-Share Considerations**:
- T+1 制度: 游资无法当日反转，大宗交易折价反映流动性需求而非纯看空
- 涨跌停板: 连续涨停期间大宗交易溢价 = 强势信号; 连续跌停期间折价 = 恐慌出货
- 龙虎榜: 机构席位 vs 游资营业部 (东方财富/拉萨系 = 游资标记)
- 北向资金: "聪明钱" 标签在 A 股有特殊意义，外资信息优势+长线属性

### 🛑 v2.37.0 户数 vs 机构净增 交叉判定（2026-06-09 震裕教训固化）

> **来历**: 震裕 (300953.SZ) 5/28 L3 重大更新因"股东户数 +41%（19,011→26,795）"直接判"机构出货=红灯"，但 DB `top10_holders` 实为 Q1 公募+北向+ETF **全线净增持 +370 万股**（鹏华碳中和 Q4 减 247万股→Q1 增 70万股 = 净增 60 万股）。**5/28 单一信号（户数）触发"出货"假象=整期结论跟着错（"3%试探+14.8% CAGR"）。**
>
> **铁律: composite_signal 不能只看单一信号，必须先做"户数趋势 vs 机构净增"交叉判定**：

| 户数趋势 | 机构 Q1 净增（公募+北向+ETF 合计） | composite_signal 应判 | 含义 |
|---------|--------------------------------|--------------------|------|
| 集中化（-5%+）| 净增 | strong_buy | 筹码集中+机构加仓 = 强买 |
| 集中化（-5%+）| 净减 | neutral | 筹码集中但机构退却（高低切换?）|
| 分散化（+5%+）| 净增 | **buy** (非 sell!) | 散户涌入但机构同步加仓 = 真实新增需求（震裕 5/28 翻车真凶，应是 buy 不是 sell）|
| 分散化（+5%+）| 净减 | strong_sell | 散户接盘+机构退却 = 真实出货 |

> **硬指令**: `composite_signal` **必须是**"户数趋势 × 机构净增"双信号交叉判定结果，不是单维信号之和。**A-Share Considerations 必须显式说明这个交叉判定的结果**。
>
> **数据获取（必查）**:
> 1. `signal_summary(ts_code)` → 取 `stk_holdernumber` 最新户数
> 2. `top10_holders` 最新期（季报）→ 算"公募基金 Q1 净增 + 北向持股变化 + ETF 增减" 合计
> 3. **分母**: 公募+北向+ETF 季报间净增（万股）合并
> 4. **分子**: 同期股东户数变化率
> 5. 交叉后写回 `composite_signal`
>
> **关联 v2.27.0 §5.5 trend**: entry_trend_check 已含 RSI 27.3 / MA60 偏离 = 趋势侧；本节加 chip_concentration（户数）vs 机构净增 = 筹码侧。**双侧独立判定，不互相覆盖**。

---

### 🛑 v2.38.0 写"零/低卖方覆盖"前四道闸（2026-06-10 铖昌证伪固化）

> **来历**: 铖昌 (001270.SZ) 6/3 判"复苏后零卖方覆盖"被证伪——网上实存光大 2025-09-09 + 方正 2026 点评，**均早于研究日**。病根=东财单通道 + *ST 改名后按原名搜漏 + 本地 research_report 仅 152 只 + 聚合站零通道。同病：地平线 09660.HK 本地 5 家大行 vs 网上 22 家分析师 = 机构盲区 77%。
>
> **本质区分**: "我搜不到" ≠ "真没人覆盖"。前者是检索能力受限（写`本地检索受限`），后者才是真实低覆盖（才许写`零卖方覆盖`）。把两者混为一谈 = 把检索缺口当 alpha/红旗证据 = 结论级错误。

**四道闸（必须按序，任一道非空只能写"本地检索受限"，全空才许写"零卖方覆盖"）：**

```python
from common.coverage_check import verify_sellside_coverage, st_name_variants
res = verify_sellside_coverage(ts_code)   # 三态裁决
```

1. **本地三态裁决**: 跑 `verify_sellside_coverage(ts_code)`。
   - `verdict == COVERED` → 覆盖充分，根本不该写零覆盖。
   - `verdict == LOCAL_GAP`（本地空/陈旧但机构数>0 或 rc 有近期行）→ **禁写零覆盖**。措辞只能"本地库未收录 X 之后的卖方报告（检索受限）"，并提示跑 collect-data 补采。
   - `verdict == NEED_WEB_CHECK`（全部本地信号空）→ 进第 2-4 道继续核查。
2. **collect-data 复采**: 触发增量采集（`research_report_collector --code X` 重跑）后复查——本地库小（152 只）漏收是常态，先补再判。
3. **WebSearch ≥2 组关键词**: `"{名} 研报 {年} 目标价"` + `"{名} 评级 券商"`；**ST 股必须用 `st_name_variants(name)` 的 ST 名变体再搜一次**（治 *ST 改名后按新名搜漏旧研报，铖昌真凶）；渠道点名 慧博 hibor.com.cn / 发现报告 / 新浪财经。
4. **全空才许写零覆盖**: 上述全部为空，才允许下"零卖方覆盖"结论。**结算块必须落盘**到 深度研究.md 或 README 的 `## 卖方覆盖核查` 段（含 verify_sellside_coverage 输出 + WebSearch 核查记录两行）= §7.12 闸验收格式（缺块 → quality_gate 机械 BLOCK）。

**"覆盖密度"措辞规范（防新偏差，防覆盖家数崇拜）**:
- **高覆盖 ≠ 该买**: 一只票被 30 家机构覆盖 = 拥挤交易，预期差大概率已被消化，反而可能无 alpha。
- **低覆盖 ≠ 红旗**: 小票本来少人看，低覆盖可能是"未被定价的 alpha"而非"风险信号"。
- coverage 只描述"被定价充分度"这一个维度，**不直接进 buy/sell 判定**，更不作为论点的承重证据。

---

#### Module B: 解禁监控 (Lockup/Unlock Calendar)

**Purpose**: Assess upcoming supply pressure from restricted share unlocks.

**Data Sources**:
```python
from auto_research.toolchain.lockup_calendar import (
    fetch_upcoming_lockups,    # akshare 全市场解禁数据
    calc_warning_windows,      # T-30/T-14/T-7/T-1 窗口计算
    filter_alert_threshold,    # 占流通市值>5% 过滤
)

# ⚠️ 用法注意（2026-07-19 震裕实证）：fetch_upcoming_lockups(code) 返回的是
# 全市场未过滤大表（数万行），不是单股结果。必须自行按 code 过滤：
#   df = fetch_upcoming_lockups('300953')
#   mine = df[df['stock_code'].astype(str) == '300953']
# 打印前先看 len(mine)，禁止直接 to_string() 全表（会刷屏数万行烧上下文）。
```

**Structured Output** (`lockup_analysis` dict):
```python
{
    "upcoming_events": [
        {
            "release_date": str,          # YYYYMMDD
            "release_shares_wan": float,  # 解禁数量(万股)
            "release_ratio_pct": float,   # 占流通市值比例
            "share_type": str,            # 限售股类型
            "window": str,                # T-30/T-14/T-7/T-1
            "urgency": int                # 0(T-1) to 3(T-30)
        }
    ],
    "total_90d_ratio_pct": float,    # 90天累计解禁占流通市值%
    "total_180d_ratio_pct": float,   # 180天累计解禁占流通市值%
    "max_single_ratio_pct": float,   # 单次最大解禁占比
    "risk_level": "low|medium|high|critical",
    "price_impact_estimate": str,    # 基于历史解禁冲击的估算
    "signal": "bullish|neutral|bearish",
    "a_share_notes": str
}
```

**Scoring Criteria**:
| Risk Level | Condition | Signal |
|-----------|-----------|--------|
| Low | 90天累计解禁<2% 流通市值 | Neutral (0) |
| Medium | 90天累计2-5% | Neutral (-0.5) |
| High | 90天累计5-10% 或 单次>5% | Bearish (-1) |
| Critical | 90天累计>10% 或 单次>8% | Bearish (-2) |

**A-Share Considerations**:
- 解禁不等于减持: 大股东解禁后实际减持受减持新规约束(90天集中竞价≤1%)
- 定增解禁 vs IPO解禁: 定增参与者(机构/游资)减持意愿远高于创始股东
- T-7 窗口效应: A股解禁前7天平均下跌2-3%(历史统计)，是短期做空窗口
- 与股东户数联动: 解禁+股东户数暴增 = 双重供给压力

---

#### Module C: 政策分析 (Policy Impact Assessment)

**Purpose**: Assess policy risk/opportunity using structured policy event data.

**Data Sources**:
```python
# 政策事件库 (SQLite policy_events 表)
from common.policy_news_collector import PolicyEventStorage

# 会议日历 (SQLite meeting_calendar + meeting_announcements 表)
from common.meeting_storage import MeetingStorage

# 直接查 DB
import sqlite3
from common.constants import DB_PATH
# SELECT * FROM policy_events WHERE ... ORDER BY event_date DESC
# SELECT * FROM meeting_calendar WHERE ...
# SELECT * FROM meeting_announcements WHERE ...
```

**Structured Output** (`policy_analysis` dict):
```python
{
    "recent_policy_events": [
        {
            "date": str,
            "title": str,
            "category": str,         # 产业政策/监管政策/宏观政策/行业准入
            "intensity": str,        # high/medium/low
            "sentiment": str,        # positive/negative/mixed
            "relevance_to_stock": str  # 与本标的的关联分析
        }
    ],
    "upcoming_meetings": [
        {
            "date": str,
            "name": str,
            "type": str,             # 国常会/政治局/行业会议
            "expected_topics": list,
            "potential_impact": str
        }
    ],
    "policy_environment": {
        "industry_direction": str,   # 鼓励/中性/限制/打压
        "subsidy_status": str,       # 有补贴/补贴退坡/无补贴
        "regulatory_trend": str,     # 放松/稳定/收紧
    },
    "policy_risk_score": int,        # -3 (极大利空) to +3 (极大利好)
    "signal": "bullish|neutral|bearish",
    "a_share_notes": str
}
```

**Scoring Criteria**:
| Score | Condition |
|-------|-----------|
| +3 | 行业被纳入国家战略/重大补贴政策/准入壁垒提高(利好在位者) |
| +2 | 行业获定向支持/税收优惠/地方补贴 |
| +1 | 政策环境稳定/无重大变化 |
| 0 | 政策信号模糊/多空参半 |
| -1 | 行业监管收紧/准入门槛降低(竞争加剧) |
| -2 | 集采/限价/反垄断调查/补贴大幅退坡 |
| -3 | 行业被明确打压(类似教培双减)/重大政策风险 |

**A-Share Considerations**:
- 政策市特征: A股是全世界最典型的"政策市"，政策对估值的影响可以碾压基本面
- 会议日历: 国常会/政治局会议/两会/行业峰会前1-2周，相关板块异动概率>60%
- 政策传导链: 中央文件→部委细则→地方执行→行业影响，每一层都可能放大或衰减
- 预期差: 政策落地前的"预期交易"往往比政策本身影响更大(买预期卖事实)
- 政策发布不自动上调 `policy_risk_score`：必须比较最终文本 vs 事前预期/市场定价，分类为 `BEAT/IN_LINE/MISS/AMBIGUOUS`

---

### Injection into Agent 4 & 5 Prompts

After Step 2.3 produces the 3 dicts, Conductor injects them into:

**Agent 4 (风险) prompt addition**:
```
## A 股特色风险数据（预取，直接使用）

### 游资追踪信号
{smart_money_analysis formatted as table}

### 解禁压力评估
{lockup_analysis formatted as table}

### 政策环境评估
{policy_analysis.policy_environment + policy_risk_score}

**要求**: 在你的风险四维扫描中，必须引用上述数据，不要重新获取。
重点关注: composite_signal 为 bearish 的维度 + risk_level 为 high/critical 的解禁事件 + policy_risk_score ≤ -2 的政策风险。
```

**Agent 5 (催化剂) prompt addition**:
```
## A 股特色催化剂数据（预取，直接使用）

### 游资动向（短期催化剂信号）
{smart_money_analysis.composite_signal + key signals}

### 解禁日历（供给冲击催化剂）
{lockup_analysis.upcoming_events formatted as timeline}

### 政策日历（政策催化剂）
{policy_analysis.upcoming_meetings formatted as timeline}

**要求**: 在你的催化剂日历中，必须包含上述时间节点。
特别标注: T-7 以内的解禁事件 + 30天内的重大会议 + 已发布但尚未落地的政策。
已发布但尚未落地的政策/财报/订单/客户/产能节点必须写 `pre_event_expectation` 和 `delta_gate`；Agent 5 不得因为事件日期到来就标利好或 trigger confirmed。
```

**Agent 1 (财务) + Agent 6 (增长) + 预期差六问 prompt addition**:
```
## 分析师一致预期（预取，A股，直接使用）

调 `from common.analyst_consensus import get_research_summary; get_research_summary(ts_code)` 取:
- **前瞻一致预期 EPS（FY1/FY2）+ 真前瞻 PE**（券商 dedup 后中位数；替代滚动 PE 的"假便宜/假贵"误判）
- **盈利修正方向**（近半年券商在上调还是下调 EPS）—— **这是预期差的领先信号**：
  - 上调 + 股价没动 = 正预期差（街上在加预期，市场还没反应）
  - 下调 + 股价没跌 = 负预期差警报（基本面在恶化，估值还没修正）
- rating_buy_ratio（评级共识；A股几乎全买入，只看变化不看绝对值）

**要求**: 估值用前瞻 PE 不用滚动 PE；预期差六问的"市场定价了什么"必须对照修正方向。
**旗标处理（必查 flags）**: `eps_unit_suspect`/`cdr`/`implausible_pe`(CDR/科创存托凭证如689009九号→前瞻PE不可信，回退手工核) / `low_coverage`(<5券商→共识不稳，降信心) / `no_coverage`/`hk_not_covered`(港股→走 yfinance/AAStocks 共识)。

**CDR/EPS 降级硬指令（v2.39.2 九号教训）**: 若一致预期或研报字段出现 `cdr`、`eps_unit_suspect`、`implausible_pe`，或正文 EPS 同时出现 2.x 与 20.x/30.x 两类口径，禁止把原始 EPS、forward PE、东财 `tp` 元数据写成承重估值。估值段必须改用 **市值 / 正常化归母净利** + `valuation_router` 主方法（多分部优先 SOTP）交叉；`承重数字结算表` 里把相关 EPS/TP 行标 `🔻已降级`，写明"只作情绪/锚位参考，不进 EV 计算"。卖方目标价若引用，必须带研报日期和正文来源。
```

---

## 第 2.5 步：Multi-Agent 并行深度分析

**⚠️ L1 快速扫描跳过此步骤及后续所有步骤（§2.6-§5.5）**。L1 只需输出 §3.1 六问的一页 checklist 结论。

### Wave 0 active route（必须先于 fan-out、Leader 和 reader report）

`LEGACY_WAVE1_DISABLED`：`auto_research/workflows/stock_research_fanout.workflow.js`
保留为 Wave 1 migration debt；Wave 0 不调用、不 fallback 到该脚本，也不消费其
Leader/scenario/position 输出。当前 L2+/L3 必须先完成下面的受治理 route：

```python
from auto_research.toolchain.return_probability import (
    EvidenceSnapshot,
    ForecastContract,
    forecast,
)
from auto_research.toolchain.return_probability.artifacts import (
    load_forecast_artifact,
    save_forecast_artifact,
    validate_forecast_artifact,
)
from auto_research.toolchain.return_probability.claims import (
    build_return_claim_manifest,
    capture_strict_json_direct_child,
    load_return_claim_manifest,
    save_return_claim_manifest,
)
from auto_research.toolchain.return_probability.serialization import strict_json_dumps
from auto_research.toolchain.stock_causal_valuation import build_stock_earnings_model
from auto_research.toolchain.valuation_router import route_valuation

r = route_valuation(ts_code)
snapshot: EvidenceSnapshot = frozen_pit_snapshot

causal_artifact_path = None
if causal_adapter_applicable:
    causal_artifact_path = build_stock_earnings_model(
        study_dir=study_dir,
        ts_code=ts_code,
        as_of_date=as_of_date,
        target_year=target_year,
        prereg_path=prereg_path,
    )

contract: ForecastContract = return_forecast_contract
artifact = forecast(contract, snapshot)
return_artifact_path = save_forecast_artifact(study_dir, artifact)
captured_return_artifact = capture_strict_json_direct_child(
    study_dir,
    return_artifact_path.name,
    validate_forecast_artifact,
)
leader_artifact = load_forecast_artifact(return_artifact_path)
assert leader_artifact["forecast_contract"]["contract_id"] == contract.contract_id
assert strict_json_dumps(leader_artifact).encode("utf-8") == captured_return_artifact.raw_bytes
```

执行顺序是 valuation archetype → frozen PIT snapshot → applicable causal evidence →
`forecast(contract, snapshot)` → immutable save → exact captured-byte validation →
load。capture 的 strict object、raw bytes SHA-256 和 same-fd stat identity 是后续
manifest 唯一 artifact binding；禁止为了构造 claim 重开路径或复制 reader 数字。
**Leader/报告只能消费 `leader_artifact` 与后文的 `leader_claim_manifest`**；
在保存并验证 artifact 之前，不得开始概率裁决、条件案例汇总或
reader probability 输出。随后才按本节下方平台规则启动真实 agents；agent 只补充
证据、条件案例和矛盾收口，不能另造 probability/action/position。manifest 在真实
agents 返回结构化 conditional evidence 后、Leader 之前恰好 build/save/load 一次。

事实包和研报正文仍可通过文件供 agents `Read`，但 prior 三情景/CAGR 只能标为历史
对照，不能进入当前概率或动作。若真实 fan-out 工具不可用，使用带
`fallback_reason` 的本地六视角；该降级也必须消费 `leader_artifact`，不得调用 legacy JS。

Check-First 和数据采集完成后，启动 **6 个 Agent 并行跑**。每个 Agent 产出 ≤300 字（表格优先），减少上下文压力。

**🛑 真实 6 Agent 证据闸（v2.40.10）**：启动前先判定当前平台是否允许真实 fan-out。用户只要要求使用 `stock-research` 做单票 L3，即视为明确授权该 workflow 所需的真实 6 subagents / parallel agent work；Codex 等平台不得再以“用户没单独说 subagent”为由降级。若 subagent 工具可用，必须先 spawn A1-A6 并 `wait_agent`；声明 6 Agent 完成必须在 `_agent_outputs_YYYYMMDD.json` 记录 `workflow_run_id` 或 6 个真实 `agent_id` / `wait_agent` 返回摘要。只有工具不可用、spawn/wait 失败、或用户明确禁止并行 agent，才允许 `single_thread_local_six_lens_review` 本地六视角降级；降级必须写 `fallback_reason`，禁止冒充真实 6-Agent DONE。

**🛑 财务基线先行（v2.21 新增——根治"6 Agent 各算各的、数字漂移"）**

启动 6 Agent **之前**，Conductor 必须先算好**一份 reconciled 财务基线**，写进所有 Agent 的共享上下文（CTX），强制各 Agent 用同一套底数，禁止每个 Agent 自己从季报反推导致 EPS/净利在 37.8/38/42-44 之间漂：

```
必须钉死的共享基线（一次算好，全员复用）:
- 总股本（精确到亿股）、TTM 归母净利、最新 FY 归母净利（区分实际 vs 预估，标注口径）
- 单季净利轨迹（最近 8 季）、TTM EPS、最新 FY EPS
- 现价/市值/PE_ttm/PB + 各自历史分位
- 卖方一致预期 EPS（2026E/27E/28E，取最新各券商剔重均值，标 range）
```

> **真实翻车案例（巨化股份, 2026-05-31）**：财务数据.md 在 workflow 返回前写了"FY25 预估 42-44亿"，workflow/研报给出实际 ~38亿（+94.29%）后未回扫，靠事后 advisor 才改齐。**规则**：(1) 基线在 Agent 跑前算好；(2) 若先写了事实文件（财务数据.md），拿到 Agent/研报更准的数后**必须回扫对齐**，禁止新旧数并存。

```
Conductor → 6 Agent 并行（run_in_background=True）
  ├─ Agent 1: 财务 (DuPont+Z-Score+FCF质量+估值快照+反转DCF)
  ├─ Agent 2: 研报 (KB三路搜索+东财API+PDF阅读+关键数据提取)
  ├─ Agent 3: 行业 (同业对标+产业链+市占率+壁垒+周期定位)
  ├─ Agent 4: 风险 (治理/财务/行业/宏观+A股特供政策+解禁+概念炒作)
  ├─ Agent 5: 催化剂 (财报节点+政策节点+产品发布+解禁到期日)
  └─ Agent 6: 增长 (TAM×市占率+利润率扩张+新业务期权+管理层执行力)
→ Conductor 汇总 → conditional evidence → one manifest → Debate+Leader → Step 3
```

### Agent 1: 财务深度分析

产出 (~300字+表格)。必须包含: DuPont分解、Altman Z-Score、FCF质量(OCF/NI)、盈利质量背离度、估值快照(PE/PB/PS+5年分位+行业中位数)、反转DCF隐含增速。

### Agent 2: 研报多源聚合

产出 (~300字+表格)。必须包含: 国际投行观点(评级+目标价+EPS区间)、国内券商EPS预测序列(不引用评级)、关键数据交叉验证(≥2源一致→高置信度)、信息缺口标注。纯港股/ADR 标的没有 A 股主键时，国内券商 EPS 序列项写 `eastmoney_not_applicable_hk`，改用 `hk_report_collector` 共识 + yfinance/AAStocks + 本地海外库正文；不得把东财 0 条写成覆盖缺口。

**🛑 研报全量阅读铁律**：Agent 2 必须完整阅读第 2 步检索到的**每一篇**研报正文。禁止抽选、禁止只看标题/摘要、禁止只读开头几段。如果研报数量超过 15 篇，启动子 Agent 分批并行读取，但必须确保全覆盖。每篇读完后必须提取：评级/目标价/核心论点/关键假设/风险/分歧点。港股台账必须额外拆 `direct_company_coverage` / `summary_or_news` / `industry_cross_read` / `keyword_leads`；只有 direct full report 可承载目标价和估值，summary/news 只能作为共识线索。

### Agent 3: 行业竞争扫描

产出 (~300字+对比表)。必须包含: ≥3家可比公司对标(营收/净利/毛利率/ROE/PE)、产业链位置+议价力、市占率趋势(近3年)、竞争壁垒分类(技术/规模/品牌/牌照/网络效应)、行业周期位置。

### Agent 4: 风险四维扫描

产出 (~300字+风险矩阵)。必须包含: 治理(减持/关联交易/质押/处罚)、政策(产业方向/补贴/准入门槛)、解禁(未来90天+a-stock-data拉取)、资金面(北向/融资余额/大宗交易)、财务(商誉/质押率/短债比)、行业(技术替代/客户集中度>30%→致命)、概念炒作(实质收入<5%→高危)。

**a-stock-data 调用**: Agent 4 prompt 中直接写明需要查询的数据点——不要依赖 Agent 自己去"激活"另一个 skill。在 prompt 中说"请用 a-stock-data skill 查询 X 的北向资金流向、未来90天解禁日历、融资余额趋势"。

### Agent 5: 催化剂日历

产出 (~200字+时间线表)。必须先读取 `_public_signal_matrix_YYYYMMDD.{md,json}`；没有矩阵时只能标 `pending_public_signal_sweep`，不得直接写催化剂结论。必须包含: 每个催化剂的绝对日期、类型(财报/政策/产品/解禁/公开信息快信号)、来源级别(S0/S1/S2/S3)、验证状态、`pre_event_expectation`、`actual_disclosure`、`delta_class=BEAT|IN_LINE|MISS|AMBIGUOUS`、预期影响方向和量级(★~★★★★★)。S2/S3 未验证信息只能放入“待验证线索”，不得进入交易 trigger；`IN_LINE` 只能写继续观察或利好落地。

### Agent 6: 增长/Upside 分析

产出 (~300字+表格)。必须包含: TAM×市占率→5年收入天花板、利润率扩张路径(规模+结构升级→净利率提升概率)、新业务期权价值(EV/Revenue终值×成功概率)、管理层执行力正面证据(历史产能兑现率/研发转化率)、综合Upside量化(乐观情形3年后收入/利润/估值)。

### Agent 互评机制（替代自评——v2.12 修复 F4）

**不再让 Agent 自己给自己打分。** 6 Agent 并行完成后，Debate+Leader Agent 在裁决时同时对每个 Agent 输出做外部质量评估：

```markdown
## Agent 质量评估（Debate+Leader 外部评分）

| Agent | 证据充分性(0-10) | 逻辑一致性(0-10) | 投资决策贡献(0-10) | 加权均分 |
|-------|-----------------|-----------------|------------------|---------|
| A1 财务 | X | X | X | X.X |
| A2 研报 | X | X | X | X.X |
| ... | ... | ... | ... | ... |

- 加权: 证据40% + 逻辑30% + 贡献30%
- 任一 Agent 均分 <5 → Conductor 标注该维度 [数据不足]，在结论中降权
- 不触发重跑（v2.12 去除死循环风险——max_retry=0，不足就降权而非重跑）
```

### Agent 强制自省（BettaFish 模式——不可跳过）

每个 Agent 输出末尾必须回答三问（≤100字总计）：
- **缺少什么关键证据？**（1句话）
- **什么证据会改变我的判断？**（1句话）
- **我最可能错在哪？**（1句话）

### Agent structured conditional evidence → immutable manifest（Leader 前置硬闸）

6 个 Claude Agent 全部返回并完成自省后，Conductor 先把 Bull/Base/Bear 条件案例
变成项目 `claims.py` 的精确 records。每条只能引用同一
`captured_return_artifact.object["evidence_snapshot"]` 中实际存在且
source/hash 一致的字段；Agent 不能给概率、artifact pointer、action 或 position：

```python
conditional_evidence = [
    {
        "claim_id": agent_case_id,
        "claim_type": "CONDITIONAL_SCENARIO_VALUE",
        "label": agent_case_label,
        "value": agent_conditional_value,
        "unit": conditional_value_unit,
        "currency": contract.decision_currency,
        "horizon": {
            "start_trading_date": contract.start_trading_date,
            "settlement_calendar_date": contract.settlement_calendar_date,
        },
        "artifact_value_pointer": None,
        "authority_stage": "CONDITIONAL_EVIDENCE",
        "scenario_id": agent_case_id,
        "evidence_refs": pit_bound_evidence_refs,
        "probability": None,
    }
    for agent_case_id, agent_case_label, agent_conditional_value,
        conditional_value_unit, pit_bound_evidence_refs in agent_conditional_cases
]
```

`artifact_bound_claim_records` 不是 helper authority：它只能按
`references/output-contract.md` 的 exact discriminator/pointer table 从
`captured_return_artifact.object` 逐字段选择；calibrated numeric record 必须回指
同值 pointer，withheld record 的 value/pointer 都是 null，provisional 不得伪装成
formal。不得读 Markdown、报告正文、旧 scenario、agent vote 或手工数字生成该列表。
随后只执行下面一次 manifest write/load：

```python
manifest_claim_records = [*conditional_evidence, *artifact_bound_claim_records]
return_claim_manifest = build_return_claim_manifest(
    captured_return_artifact,
    conditional_evidence=conditional_evidence,
    claims=manifest_claim_records,
)
return_claim_manifest_path = save_return_claim_manifest(
    study_dir, return_claim_manifest
)
loaded_return_claim_manifest = load_return_claim_manifest(return_claim_manifest_path)
leader_claim_manifest = loaded_return_claim_manifest
```

到这里才允许发起 Claude 平台原有的单次 Debate+Leader 调用。Leader prompt 必须同时
接收 6 Agent outputs、`leader_artifact` 与 `leader_claim_manifest`，不得重建
manifest 或从 prose 反推 claims。平台 Agent 返回后：

```python
leader_report_prose = claude_debate_leader_output
```

该 prose 只负责解释和条件案例叙述；数值 return claims 仍只在 loaded manifest 中。
后续 Step 04 才能调用 deterministic renderer/CAS replacement，且任何步骤都不得第二次
保存 manifest。

### Debate+Leader 辩论裁决（合并 Bull+Bear+Leader——v2.12 修复 F1）

**Bull 和 Bear 分析由同一个 Agent 完成**（节省 2 次 Agent 调用，约 6-8K tokens），但必须在输出中明确区分两个视角并给予**同等权重**：

```
6 Agent 并行输出
    ↓
Debate+Leader Agent（单次调用，完成三项任务）:
  1. Bull 视角 (40%篇幅): 汇总正面证据 + 市场可能低估的期权价值
     - 所有 [事实] 级别的正面数据点
     - 量化上行空间：最优情景下的收入/利润/估值
  2. Bear 视角 (40%篇幅): 汇总负面证据 + 遗漏的致命风险
     - 挑战 Bull 的每一个关键假设
     - 量化下行空间：最差情景下的收入/利润/估值
  3. 裁决 (20%篇幅): 输出无概率条件案例 + immutable return artifact 摘要 + Agent 质量评估
     - Bull×Bear 分歧最大的 1-2 个点 → 这就是预期差的核心
     - 什么证据会打破僵局？
     - 每个 Agent 的外部质量评分
     - ⚠️ **跨 Agent 矛盾收口（v2.21 强制——见下）**
    ↓
Conductor 写文件
```

**🛑 跨 Agent 矛盾 reconcile（硬职责，v2.21 新增——根治"格式过关但逻辑打架"）**

Leader 裁决前**必须**逐项扫描 6 Agent 的招牌论据，找出**互相打架的逻辑**并收口，禁止简单把 bull+bear 拼起来就交差：

- **典型矛盾形态**：一个 Agent 高信心说"结构性改变/这次不一样/旧规律失效"，另一个 Agent 的招牌空头/多头数字却恰恰建立在"回归历史均值/旧周期重演"上。两者**不能同时成立**——必须二选一或明确分层（如"供给结构性封顶为真，但价格仍是周期变量"）。
- **真实翻车案例（巨化股份600160, 2026-05-31）**：行业 Agent 高信心判"配额制结构性改变游戏、2018峰/2020谷不可类比"；但风险 Agent 的招牌空头"正常化PE 40-49x"恰恰用配额前 ROE 11% 做锚。Leader 直接合成没 reconcile，Quality Gate 100% 也没抓到，**全靠事后 advisor 才发现**。正解：改用 moat-consistent 的 Gordon 口径（"现 PB 隐含可持续 ROE 33%>峰值21%，即便峰值永续合理 PB 仅 2.57x → 下行是 de-rate 不是 collapse"）——结论不变但理由自洽。
- **收口动作**：裁决章节必须有一段「矛盾收口」，逐条列出发现的跨 Agent 逻辑张力 + 如何裁定（哪个口径胜出、为什么、对三情景目标价的影响）。找不出任何矛盾也要写一句"已扫描，无互斥逻辑"。
- **判别口诀**：招牌数字（正常化PE/目标价/份额）若用了某个 Agent 已判定为"失效"的锚，就是矛盾，必须换锚。

**辩论规则**（对称设计，单 Agent 执行）:
- Bull 和 Bear 必须用**同等篇幅**和**同等证据标准**
- 每一方都必须承认对方论点的合理部分
- 立场必须用证据锚定（禁止"我觉得""可能""一般来说"）
- 裁决必须写明理由（可审计的推理链）
- **裁决必须 reconcile 跨 Agent 矛盾**（见上，硬职责）
- **单次调用，不分多轮**（避免主题漂移和上下文浪费）

**大师视角库（软提示，v2.37.0 新增）**: `references/investment-masters/masters/` 存有 15 位大师方法论提炼（选股/仓位/风控/退出，有出处）。Debate+Leader 的 prompt 可按标的类型选 2-3 个镜头注入，**不强制、不加新 Agent**：
- Bull 视角 → Lynch GARP 检验（增速/PEG 是否撑得起故事）+ Druckenmiller 不对称性（赢时赢多少 vs 输时输多少）
- Bear 视角 → Marks 周期位置质询（现在是钟摆的哪一端？乐观被 price-in 了多少？）
- Leader 裁决 → 段永平卖出纪律（卖出条件必须=论据被打破，不是价格涨跌）+ Marks "低估→合理即卖，别等高估"（对已持仓股的 trim 判断）

### Conductor 汇总 → 进入预期差挖掘

辩论层输出的综合报告作为 Step 3 的输入。

**关键规则**:
- 6 Agent 并行调用（`run_in_background=True`）
- Debate+Leader 单次顺序调用（依赖 6 Agent 输出）
- 每个 Agent 产出 ≤300 字，数据密集用表格
- Agent 产出中关键结论标注 `[A1]`-`[A6]` 来源 ID
- **不再触发 Agent 重跑**（v2.12: 评分不足→降权标注，不重跑，避免死循环和上下文浪费）
- L1 快速扫描跳过 Multi-Agent 和辩论层，L2-L3 强制执行

---

## 第 3 步：预期差挖掘 + 情景分析 — 从"对/错"到"值不值"

这是本 skill 最核心的环节。机构在数据、模型、算力上都碾压你——但他们在"独立思考"上做不到，因为他们的职业风险不允许。**你的胜算不是"证明市场错了"，是判断当前价格隐含的预期和你的判断之间的差距，是否大到值得下注。**

### 3.1 六问（必须逐题回答）

1. **公司赚的是什么钱？**（商业模式本质——卖产品/卖服务/卖牌照/卖流量？壁垒是什么？为什么不是别人？）
2. **当前处于周期的什么位置？**（用数据定位——产能利用率、库存水位、资本开支周期、行业集中度变化——不用感觉）
3. **市场定价了什么？**（当前估值隐含的增速是多少？市场共识是什么？进入 3.2 系统挖掘）
4. **你的判断和市场有什么不同？**（哪些参数你比市场乐观？哪些你更悲观？为什么？）
5. **最大的单点风险是什么？**（可能让投资归零的那个变量。如果找不到任何一个，说明你不够了解这家公司）
6. **关键跟踪指标是什么？**（什么信号会告诉你"逻辑变了"？必须在买入前定义，否则你会在下跌时自我合理化）

### 3.2 市场定价了什么？（必须量化，不能模糊）

回答以下问题，每一个都要有数据源支撑：

```
1. 当前估值隐含的增长预期：
   - 当前 PE 处于历史什么分位？（5 年 / 10 年）
   - 反推：当前估值隐含的未来 3 年净利润增速是多少？
     （简化公式：隐含增速 ≈ (当前 PE / 行业合理 PE - 1) × 100%）
   - 这个隐含增速与券商一致预期有多大差距？

2. 券商/投行的一致预期：
   - 未来 2 年营收增速？EPS？[列出至少 3 家机构的具体数字]
   - 这些假设隐含的驱动因素是什么？（量增/价涨/份额扩大/新业务）
   - 国际投行 vs 国内券商的观点是否有分歧？分歧在哪？

3. 机构的持仓情况：
   - 机构持仓占比？是加仓还是减仓趋势？
   - 有多少券商覆盖？（覆盖越少，越可能未被充分定价——无论是高估还是低估）
```

**警告**：如果你写了"市场普遍认为..."但没有附具体数字和来源，你没有在做分析——你在讲故事。重新做。

### 3.2.b 投行上修斜率 / Street Revision Slope Guard（L2+ 强制）

静态目标价不是重点，**目标价/EPS/ASP/毛利率为什么在连续上修**才是重点。建滔积层板/建滔集团类案例的错误，本质是把“投行连续上修盈利路径”当成普通研报摘要，而不是把它当成市场正在修正定价函数。

在进入 3.3 参数差异和 3.4 三情景前，必须输出 `street_revision_delta`：

```markdown
## Street Revision Delta

| 日期 | 机构 | 项目 | 原值 | 新值 | 上修幅度 | 驱动 | 证据等级 |
|------|------|------|------|------|----------|------|----------|
| YYYY-MM-DD | Citi | TP/EPS/ASP/GM | X | Y | +Z% | ASP/毛利率/订单/份额 | direct_full_report / S2摘要+交叉验证 |

- driver_type: earnings_path / multiple_only / mixed
- right_side_confirmation: confirmed / absent / overheated
- old_local_view: WAIT / AVOID / BUY / HOLD
- action_boundary: REVISION_UPGRADE_NOW / RIGHT_SIDE_PROBE_ALLOWED / MAINTAIN_WAIT_WITH_BEAR_TRIGGER
```

判定规则：
- `earnings_path`：EPS、ASP、毛利率、订单、产能利用率、成本、份额等盈利路径上修。必须刷新上游 operating evidence、forward PE/SOTP、PIT snapshot 并重跑 return forecast，不能沿用旧静态价格锚或手工调概率。
- `multiple_only`：只是换目标倍数或估值窗口后移。只能作为情绪/估值锚线索，不自动升级。
- `mixed`：盈利路径和倍数都有。拆开处理，盈利部分进情景参数，倍数部分进敏感性。
- 若只有标题/摘要/AAStocks/新闻，先按 `keyword_lead` 或 `S2` 处理；但如果同一结论由两家以上主流来源、公告/价格数据或公司/产业链事实交叉验证，不得因为“没有完整 PDF”直接 veto。交叉验证只能提升条件案例的证据等级，不得手工改 return probability 或仓位；动作仍走独立 gates。
- 若股价 5/10 日显著上涨、相对指数超额为正、突破近月高点、放量，或 watchlist 右侧条件已触发，`right_side_confirmation=confirmed`。这时“等右侧”已经被满足，不能继续写成无限等待。

### 3.3 你的判断与市场的差异（这是你值钱的地方）

不要把市场共识预设为"错的"——逐一对比你和市场的参数差异：

```
1. 你的参数 vs 市场参数（逐项对比）：

   ┌──────────────────┬──────────┬──────────┬──────────────┐
   │ 核心参数          │ 市场隐含  │ 你的判断  │ 分歧方向      │
   ├──────────────────┼──────────┼──────────┼──────────────┤
   │ 3年营收 CAGR      │   35%    │   25%    │ 你比市场悲观   │
   │ 3年净利 CAGR      │   40%    │   28%    │ 你比市场悲观   │
   │ 终端净利率         │   20%    │   22%    │ 你比市场乐观   │
   │ 新业务 3 年后收入   │  ~0      │  15亿    │ 你比市场乐观   │
   │ 合理 PE            │   30x    │   35x    │ 你比市场乐观   │
   └──────────────────┴──────────┴──────────┴──────────────┘

   ⚠️ 关键：你不必在所有参数上都和市场不同。差异最大的 1-2 个参数
   就是你的核心赌注。其他参数跟市场一致没关系——你不是在证明自己聪明，
   是在判断赔率。

2. 哪些参数你比市场乐观？为什么？
   - 市场是否忽略了某个业务的期权价值？（亏损/微利但值钱）
   - 市场是否对周期性过于悲观？（当前利润率是否处于历史低位？）
   - 市场是否忽视了结构性改善？（竞争出清/商业模式升级/管理层改善）
   - 机构因什么约束无法行动？（市值太小/不在指数/行业被抛弃/ST/流动性差）

3. 哪些参数你比市场悲观？为什么？
   - 市场是否线性外推了高增速？（当前利润率处于历史极端高位？）
   - 市场是否忽略了竞争加剧？（新进入者/替代技术/客户议价力增强）
   - 市场是否低估了政策/监管风险？

4. 与卖方核心分歧（L2+强制）：
   不只要列卖方评级，要解释你和他们为什么不一样：

   | 机构 | 评级 | 他们的核心假设 | 你与他们的分歧点 | 谁更可能对？ |
   |------|------|--------------|----------------|------------|
   | GS | 买入 | 1.6T 2026H2 放量 | 你更谨慎（晚 2 季度） | 取决于 B300 交付 |
   | MS | 减持 | CapEx 2027 见顶 | 你更乐观（见顶不崩） | MS 历史上偏早 18 月 |
   | 我们 | — | 你的核心假设 | — | — |
```

### 3.3.a 已验证收益产物的只读引用（进入条件估值前强制）

估值路由、PIT snapshot、适用的因果经营证据和 return forecast 已在 fan-out 前的
唯一 canonical route 完成并不可变落盘。本节不得再次路由、冻结、构造、预测或保存；
只能读取同一次 canonical route 已验证的 `leader_artifact` 与产物引用：

```python
# 两个对象均来自 fan-out 前的 canonical route；这里只建立只读别名。
validated_return_artifact = leader_artifact
return_artifact_filename = return_artifact_path.name
return_publication_stage = validated_return_artifact["publication_stage"]
```

- reader 写入的 filename、SHA256、identity、`publication_stage`、decision buckets 和
  tail 必须来自这份 `validated_return_artifact` 及其不可变保存回执，不得重新计算、
  覆盖或从 agent 输出拼装。
- `_stock_earnings_model_YYYYMMDD.json` 只作为 canonical route 已取得的上游 causal
  operating evidence 被读取；不得在本节重建。只读保留 `activation_status=activated`
  或 `activation_status=soft_fallback` 及原 provenance；少于 31 个实现样本时保持
  `posterior_probabilities=null` 和 `WITHHELD_INSUFFICIENT_BASE_RATE_SAMPLES`，不得映射为
  return probability。
- 本只读步骤不改变真实六 Agent、Debate/Leader、交易账本、
  `current_action/current_new_money_pct` 或其他动作语义。
- agent 投票、旧 EPS posterior、卖方案例和手工数值概率均不得补位。

### 3.4 三情景期望值框架 / 条件估值案例与 24 个月收益分布（L2+ 强制）

**禁止只有方向没有数字的结论。** 做完参数对比后，先输出无概率的
Bull/Base/Bear 条件经营与估值案例；再从 return artifact 读取决策桶与 tail。

**🛑 horizon 一致性铁律（2026-06-04 芯碁微装翻车）**：Bull/Base/Bear 的 EPS 年份与条件估值 horizon **必须同口径**；不同年份只可分表展示，禁止手工加权。24个月 expected return 只能来自 return artifact 的 exact settlement contract；withheld 时不存在可替代的加权 EV/CAGR。

**🎯 先选估值方法（2026-06-07 valuation_router 新增——治"全标的单一 EPS×PE 漏斗"）**：填三情景表**之前**，先调路由器决定**用哪种估值方法**，不再无脑用 EPS×PE。不同行业价值载体不同（卖方实证：腾讯用 SOTP / 信达用 rNPV / 中国核电用 DDM——研究报告 §二每篇投行研报都有 Valuation Methodology 段，方法跟着行业/公司结构走）。

```python
from auto_research.toolchain.valuation_router import route_valuation
r = route_valuation(ts_code)   # ts_code 任意形（00700/00700.HK/002594.SZ）均可
# r.primary_method  → SOTP / rNPV_PS / DDM / P/B-ROE / PB-band / NAV / PE
# r.cross_check_method → 卖方双轨交叉验证方法（implied PE / 股息率 / PS ...）
# r.anchor_template → 对应下面哪张三情景锚填表模板
# r.rationale → 大白话理由；r.confidence → high/mid/low（low=港股无数据需人工判定行业归属）
```

**按 `r.primary_method` 选下面对应的条件案例锚填表模板**（行仍是 🟢牛/🟡基/🔴熊，但**不得添加概率或加权回报列**，只换每个案例里写死的"EPS×PE"锚）：

- `PE`（仅已证明属于稳定盈利成长/制造/消费/CXO 的条件估值默认）→ 用本节 **EPS×PE 条件案例表**。无法映射到 approved `ValuationArchetype` 时不得强塞 PE；保留 requested archetype，让 forecast 返回 `WITHHELD_UNSUPPORTED_ARCHETYPE`。
- `SOTP`（平台/多元集团）→ **分部倍数加总锚**（见下）
- `rNPV_PS`（未盈利/早期）→ **管线 rNPV/PS 锚**（见下，禁 EPS）
- `DDM`（公用事业/类债）→ **戈登股息贴现锚**（见下）
- `P/B-ROE`（银行/盈利地产）→ **justified P/B-ROE 锚**（见下）
- `PB-band`（强周期）→ **周期 PB-band 分位锚**（见下，治周期顶 PE 假便宜）

> ⚠️ 范围边界：路由器只判方法 + 给锚模板名 + 理由，**不自动取行业倍数、不算 SOTP 加总、不算 rNPV 折现**——倍数/POS/折现率由分析师手填（同 §5.7 sotp_analyzer scope）。gate §7.10 会机械 BLOCK"非 PE 标的却用 EPS×PE 单一锚硬套"。

```markdown
## 条件估值案例（方法=PE 默认模板）

### 核心驱动参数假设

| 参数 | 熊市 | 基准 | 牛市 |
|------|------|------|------|
| 3年营收 CAGR | X% | Y% | Z% |
| 3年净利 CAGR | X% | Y% | Z% |
| 终端净利率 | X% | Y% | Z% |
| 新业务 3 年后收入 | 0 | X亿 | Y亿 |
| 3年后合理 PE | Xx | Yx | Zx |

### 情景分析

| 条件案例 | 3年后 EPS | 3年后 PE | 条件目标价 | 条件 CAGR | 成立条件 |
|------|----------|---------|-----------|------|---------|
| 🟢 Bull | X元 | Xx | X元 | +X% | 条件假设... |
| 🟡 Base | Y元 | Yx | Y元 | +Y% | 条件假设... |
| 🔴 Bear | Z元 | Zx | Z元 | -Z% | 条件假设... |

### Return artifact 决策证据

- artifact: `_return_distribution_YYYYMMDD.json` + exact SHA-256
- publication stage: `<WITHHELD_*/PROVISIONAL_UNCALIBRATED/CALIBRATED_MODEL_WEIGHT>`
- decision buckets: loss (`R<0%`), below hurdle (`0%<=R<32.25%`), hurdle pass (`R>=32.25%`)
- tail risk/benchmark: 只从同一 artifact 复制，不从条件案例推导
- withheld：`numeric probability = null` + exact reason；不得恢复手工权重，
  不生成正式概率加权 EV
- provisional：只允许明确标注的 sensitivity EV；calibrated：必须有 registry 授权

### 买入动作语义表（v2.40.23 强制）

```json
{
  "current_action": "BUY_NOW|ADD_NOW|PROBE_ONLY|WAIT_PRICE|WAIT_EVENT|HOLD_MONITOR|NO_NEW_MONEY|NO_ACTION",
  "current_new_money_pct": 0,
  "max_position_after_trigger_pct": 0,
  "trigger_required": "price|event|right_side|earnings_revision|none",
  "rerun_required_after_trigger": true,
  "why_now": "",
  "why_not_wait": "",
  "stop_or_falsifier": "",
  "next_review_date": "YYYY-MM-DD"
}
```

- action 表由基本面、趋势、风险、组合、批准和执行证据独立裁定。withheld/provisional 概率、卖方 Base 条件价值或 sensitivity EV 都不能创建正向 `current_action`；缺独立授权时 `current_new_money_pct=0`。
- `PROBE_ONLY` 必须写 ≤1-2% 上限、止损、复查日和失败触发；不能因为“低PE/PB/卖方Buy/目标价高/战略期权”直接给试探仓。
- `触发后仓位上限` 不是自动买入；触发发生后要重跑基本面、盈利修正、趋势/筹码和风险闸。

### 最优建仓分析

- 若在 YY 元观察，条件 Base CAGR 为 ZZ%；只有 `CALIBRATED_MODEL_WEIGHT` 才可另写正式概率加权 expected return
- 等到此价位的可能性: **高/中/低**（只作定性路径描述，写明历史波动与催化剂依据；不得伪装成数值概率）
- 等待的机会成本: 如果 2 年才到目标价，2 年中 EPS 增长了 A%，实际折扣只有 B%
- **Plan B（等不到怎么办？）**: 若12个月内等不到目标价且EPS如期增长，在YY元（更高）建仓X%
```

**关键原则**：
- 卖方 Bull/Base/Bear 只写条件假设、估值方法和条件价值，禁止概率列与手工数值概率。
- 唯一数值概率源是 `_return_distribution_YYYYMMDD.json`；决策桶与 tail 必须来自同一 artifact。
- Wave 0 的 `WITHHELD_UNSUPPORTED_ARCHETYPE` 是预期结果：`numeric probability = null`，写 exact reason，不得恢复手工权重，不生成正式概率加权 EV。
- `PROVISIONAL_UNCALIBRATED` 只能支持明确标注的 sensitivity EV；只有 registry 授权的 `CALIBRATED_MODEL_WEIGHT` 才能承重正式概率加权研究价值。
- 当前 action、portfolio-risk、approval、execution 必须用各自现有证据闸独立裁定；概率 artifact 不直接设置动作。
- **必须给等不到的 Plan B**——好公司很少回到"便宜"的估值。如果永远等不到目标价，你的机会成本是多少？

---

#### 非 PE 方法的三情景锚填表模板（按 `route_valuation` 选用）

> 每张表行仍是 🟢Bull/🟡Base/🔴Bear 条件案例，保持 horizon 同口径，但不写概率或加权值。倍数/POS/折现率/分部口径由分析师作为条件假设填写，路由器不自动算。

**① SOTP（分部倍数加总锚）— 平台/多元集团**（腾讯/阿里/比亚迪；研究报告 §5.7 + JPM 潍柴"switch to SoTP...better captures different growth stages"）

**调工具真算（v2.31.0，治"分析师手搓 Excel 加总易错"）**：倍数/口径=人工填（工具不取行业中位数），工具负责算加总 + holdco 折价 + net_cash equity 桥 + implied PE 交叉验证 + markdown 格式化。

```python
from auto_research.toolchain.sotp_analyzer import compute_sotp
# A股可先 get_mainbz_segments(ts_code) 预填 name + 利润底数, 倍数永远人工给
segments = [
    {"name": "增值服务", "metric_value": 1500, "multiple": 18, "multiple_type": "PE", "basis": "游戏+社交同业可比"},
    {"name": "金融科技", "metric_value": 300, "multiple": 25, "multiple_type": "PE", "basis": "增速高→倍数高"},
]
listed_stakes = [  # 投资组合按市值 + holdco 折价单列（对标卖方）
    {"name": "投资组合", "market_value": 8000, "discount": 0.20},
]
v = compute_sotp(segments, listed_stakes=listed_stakes, net_cash=500,
                 total_net_profit=1900, total_shares=92)
# v.total_equity / v.per_share / v.implied_pe（交叉验证）/ v.markdown
print(v.markdown)   # → 直接贴进深度研究.md 估值段；三情景各跑一次（牛/基/熊各一组倍数+折价）
```

**或手填**（港股无 fina_mainbz / 工具不适用时手搓）：

```markdown
| 分部 | 口径(利润/营收) | 可比倍数 | 分部估值 | 备注 |
|------|----------------|---------|---------|------|
| 主业A | X亿净利 | Yx PE | XY亿 | 同业可比 |
| 主业B | X亿净利 | Yx PE | XY亿 | 增速不同→倍数不同 |
| 投资组合 | 持股市值 | ×(1−holdco折价D%) | Z亿 | 按市值非账面 |
| **合计 EV** | — | — | **ΣXY亿** | **implied 整体 PE = EV/总净利 Xx（交叉验证）** |
（条件案例：Bull/Base/Bear 各给一组分部倍数 + holdco 折价 → 三个条件 EV/目标价/CAGR；不附概率）
```

**② rNPV（管线 rNPV/PS 锚）— 未盈利/早期**（信达/百济/智谱；禁 EPS，没有 E。申万三档子模型：保守可比/中性 rNPV/乐观实物期权）

**调工具真算（v2.31.0，治"拍脑袋 POS / 右尾砍杀"）**：POS/峰值销售/margin/倍数=人工填（POS 可用内置 POS_BENCHMARKS 累计获批 LOA 基准：Phase1 0.10 / Phase2 0.20 / Phase3 0.55 / NDA 0.88），工具负责 rNPV 折现加总 + 商业化基础 + net_cash + implied PS 交叉验证 + **POS ±20% 敏感性表** + markdown。**强调禁 EPS（没有 E）**。

```python
from auto_research.toolchain.rnpv_calculator import compute_rnpv
pipeline_assets = [  # 显式 pos 优先；不给 pos 时按 phase 查 POS_BENCHMARKS
    {"name": "PD-1 单抗", "pos": 0.55, "peak_sales": 50, "margin": 0.30, "multiple": 5, "launch_year": 2028},
    {"name": "ADC 早期", "phase": "Phase2", "peak_sales": 80, "margin": 0.30, "multiple": 5, "launch_year": 2030},
]
commercial_base = {"value": 200, "method": "PS", "basis": "已上市产品 PS 5x"}  # 已商业化部分
v = compute_rnpv(pipeline_assets, commercial_base=commercial_base, net_cash=80,
                 wacc=0.10, fx=1.0, valuation_year=2026, total_shares=16, total_revenue=40)
# v.total_equity / v.per_share / v.implied_ps / v.sensitivity_table（POS±20%）/ v.markdown
print(v.markdown)   # → 直接贴 markdown + POS 敏感性表进深度研究.md；三情景各跑一次
```

**或手填**（工具不适用时手搓）：

```markdown
| 管线/业务 | POS 成功概率 | 峰值销售 | 倍数/折现 | rNPV |
|----------|------------|---------|----------|------|
| 管线1 | P1% | X亿 | DCF@r% | PV1 |
| 管线2 | P2% | Y亿 | DCF@r% | PV2 |
| 已上市/平台 | — | Z亿营收 | PS Kx | PV3 |
| **合计** | — | — | — | **Σ PV（交叉验证：implied PS = EV/营收 Kx）** |
（三情景：牛/基/熊各调 POS + 峰值销售 + 折现率 → 三个 rNPV；未盈利标的禁用 EPS×PE）
```

**③ DDM（戈登股息贴现锚）— 公用事业/类债**（中国核电/豫能控股；价值≈债券+小期权）

```markdown
| 参数 | 熊市 | 基准 | 牛市 |
|------|------|------|------|
| DPS（每股股息） | X | Y | Z |
| 永续增长 g | g1% | g2% | g3% |
| 折现率 r（COE） | r% | r% | r% |
| 戈登价 = DPS×(1+g)/(r−g) | P1 | P2 | P3 |
| 隐含股息率（交叉验证） | d1% | d2% | d3% |
（给派息率与永续增长假设区间；增长封顶派息主导）
```

**④ P/B-ROE（justified P/B-ROE 锚）— 银行/盈利地产**（浙商：justified PB=(ROE−g)/(COE−g)；E 受拨备/周期噪音污染，B×ROE 才是引擎）

```markdown
| 参数 | 熊市 | 基准 | 牛市 |
|------|------|------|------|
| BVPS（每股净资产） | B1 | B2 | B3 |
| 可持续 ROE | r1% | r2% | r3% |
| justified PB=(ROE−g)/(COE−g) | pb1 | pb2 | pb3 |
| 目标价 = BVPS × justified PB | P1 | P2 | P3 |
| 隐含 PE（交叉验证） | pe1 | pe2 | pe3 |
```

**⑤ PB-band（周期 PB-band 分位锚）— 强周期**（京东方/江波龙/江西铜业；周期顶 PE 假便宜、周期底 PE 假贵，治"低 PE=便宜"伪论点）

```markdown
| 参数 | 熊市(周期顶) | 基准 | 牛市(周期底→复苏) |
|------|------------|------|------------------|
| normalized BVPS | B1 | B2 | B3 |
| 历史 PB 分位带 | 低分位(顶用低) | 中位 | 高分位(底用高) |
| 目标价 = norm BVPS × PB 分位 | P1 | P2 | P3 |
| through-cycle PE（交叉验证） | pe1 | pe2 | pe3 |
（周期顶用低 PB 分位、周期底用高 PB 分位——与 PE 方向相反，这正是治周期顶 PE 假便宜的点）
```

> **NAV（资产 NAV 折价锚）— 亏损地产/控股公司**：目标价 = 重估 NAV ×(1−历史均值 ±1SD 的 NAV 折价 D%)，资产本身有市价、盈利只是资产的影子（研究报告 §三）。

#### 卖方双轨纪律（研究报告 §三末尾 + §五）

primary 方法定三情景目标价 + **implied 倍数交叉验证**（SOTP→implied PE / DDM→implied 股息率 / P/B-ROE→implied PE / rNPV→implied PS）。**两套不一致 = 红旗**，必须在「矛盾收口」段说明为什么（GS 珀莱雅 DCF→implied 28x PE 双轨实证）。

#### 🔒 决策层一字不动（对所有方法通用，只是锚换了）

无论用哪种估值方法，条件案例都必须 horizon 同口径并给 Bear downside、最优建仓分析和 **Plan B（等不到怎么办）**。数值概率、expected return 和 tail 只来自 return artifact：withheld 时保持 null；provisional 只作 sensitivity；formal probability-weighted EV 只允许 `CALIBRATED_MODEL_WEIGHT`。这些概率语义不随估值方法改变，且不替代下游动作闸。

### 3.5 修正催化剂

```
1. 什么事件会触发 PIT snapshot 和 return forecast 重跑？
   - 财报相对预设阈值/市场共识 `BEAT/MISS` → 更新 operating evidence 后重跑；`IN_LINE` 不手工调权重
   - 新产品/新订单公告相对 `pre_event_expectation` 为 `BEAT/MISS/AMBIGUOUS` → 重研或重跑；禁止人工上调 Bull 概率
   - 行业政策变化 → 比最终文本与事前预期，`BEAT/MISS` 才触发重跑，发布本身不调整概率
   - 产能释放/新产线投产 → 相对 ramp schedule、良率、客户导入基线形成新 PIT 证据后才重跑

2. 每个催化剂的：
   - 预期发生时间（绝对日期）
   - `pre_event_expectation` / `priced_in_view` / `actual_disclosure` / `delta_class` / `action_boundary`
   - 对 operating/valuation 输入的影响，以及是否触发 `forecast(contract, snapshot)` 新版本；不手工写概率变化
   - 如果未发生，意味着什么？（反向信号——可能触发熊市情景）

3. 如果没有任何可在 12 个月内验证的催化剂——
   你对参数的判断无法被市场定价。
   你的研究时间可能花在了对投资决策无用的深度上。
```

### 3.6 证据分级（事实 vs 预测两个独立维度）

**维度一：数据来源置信度**（这个数字有多可靠？）

| 等级 | 标签 | 定义 | 示例 |
|------|------|------|------|
| **事实** | `[事实]` | 有明确数据源，可交叉验证 | "Q1 净利 38.62 亿（财报）" |
| **推断** | `[推断]` | 基于事实的逻辑推演，标注前提 | "若 NAND 涨 10%，净利增约 X（假设库存结构不变）" |
| **猜测** | `[猜测]` | 信息不足时的合理推测 | "市场可能尚未充分定价 eSSD 放量 [待验证]" |

**禁止将推断或猜测写成事实陈述。** 三者必须在输出中明确区分。

**维度二：预测置信度**（这个对未来的判断有多可靠？——v2.10 新增）

| 等级 | 标签 | 定义 | 示例 |
|------|------|------|------|
| **高置信度预测** | `[预测:高]` | 已签合同/锁价订单/监管已批准/产能已建成 | "已签长约的 AI 服务器订单 → 2027 年收入至少 +25%" |
| **中置信度预测** | `[预测:中]` | 行业趋势明确+公司历史上兑现过类似承诺 | "管理层给出的 25-30% 增长指引（历史上 5 年 4 次达标）" |
| **低置信度预测** | `[预测:低]` | 行业趋势不确定/公司无历史记录/依赖外部变量 | "机器人业务 3 年后贡献 20% 收入（依赖 Tesla 量产节奏）" |

**关键区别**：
- `[事实][预测:高]` = 历史数字可靠 + 未来高度确定（如已签长约 = 未来的收入是事实）
- `[推断][预测:低]` = 基于事实推演 + 未来高度不确定（如实控人说"我们机器人要成为第二增长曲线"）
- 两个维度独立评判，不要混淆——不是所有推断都是低置信度预测，不是所有事实都能推导高置信度预测

**为什么需要两个维度**：
旧的单一证据分级导致所有预测都被压低权重——"管理层减持"是 [事实][A]，"2027 年净利"是 [推断][C]，结论自动倒向风险面。
现在 [预测:高] 的结论在期望值框架中的权重，应当接近 [事实] 级别。**高确定性预测（如已签长约的交付计划）和有数据支撑的推断，有权重进入最终结论。**

### 3.7 数据信心分级

除了"是什么类型的判断"（事实/推断/猜测），还需要标注"数据有多可靠"：

| 等级 | 标签 | 定义 | 示例 |
|------|------|------|------|
| **A** | `[A]` | 直接从财报原文/DB提取，可精确复现 | "Q1净利 38.62亿（财报P12）" |
| **B** | `[B]` | 2个以上独立来源交叉验证一致 | "3家券商一致预期EPS 5.2-5.5元" |
| **C** | `[C]` | 单一来源，无法交叉验证 | "仅华泰研报提到Q2订单增长" |
| **D** | `[D]--` | 无法验证 → 输出 `--`，不编数字 | "公司未披露分业务毛利率 → --" |

**"宁缺毋滥"原则**：Grade D 的数字宁可输出 `--` 也不编一个看起来合理的估计。不确定的数字比没有数字更危险——它会制造虚假的精确感。

**使用格式**：`[事实][B] Q1净利38.62亿，同比+53%`（证据等级 + 信心等级）

**注意区分**：
- `[事实][C]` = 是真的，但只有一个来源（如单家券商报告中的具体数据）
- `[推断][B]` = 是推断，但基于多个来源的交叉数据支撑
- 两个维度独立评判，不要混淆

### 3.7.5 周期位置检查（治模式 C 周期错位，SEED-008 P1-A）

> **软提示，非硬 gate**（同 §5.6 earnings classifier / §5.7 sotp 软提示风格）。不引入 quality_gate 机械 BLOCK。

**为什么要这一步**：周期顶部时盈利/EBITDA 在峰值，TTM PE 被分母推到历史最低 → 读出"最便宜"实际"最贵"（沪电 PB 100%分位 = 周期顶部 PE 假贵）。SEED-008 实证 8 个 L3 案例中 **5/8 中招模式 C（周期错位）**，是头号背离修复。投行不用单季峰值，用 **mid-cycle EV/EBITDA**（穿越周期的正常化 EBITDA）+ **PB-band 周期位置验证**（PB 不随单季利润波动，是周期位置的稳健标尺）。

**触发条件**：
- 强周期股 / 硬件周期股（PCB / 光模块 / 存储 / 面板 / 有色 / 电子元件 等）
- 或 §5.6 `earnings_quality_classifier` 判 `cyclical_peak` 的标的

**步骤①（v2.34.0 新增）：先用 `cycle_nature` 三层判别器定"周期性质"，决定 mid-cycle 工具的角色**

> SEED-008 C 清单修复：手工标"谁是周期股"5 个错 3 个（沪电/新易盛/天孚 secular 被错标 C）。
> 单轴（gm_cv/CAGR/gm_ratio）物理上分不开"价格周期"和"成长扩张期 margin 爬坡"。`decide_cycle_nature`
> 加 **行业先验白名单 + 公司级价格驱动种子 + GM 趋势斜率轴**，按业务本质判而非按症状。

```python
from auto_research.toolchain.earnings_quality_classifier import classify_earnings_base
eq = classify_earnings_base("002463.SZ")
# eq.cycle_nature ∈ {true_cyclical, cyclical_grower, secular, stable, unknown}
# eq.rev_cagr_10y / eq.gm_trend_slope（京东方 vs 沪电唯一财务分离器）
```

**四档处置矩阵（设计 §3.2 — 决定主锚 + mid-cycle 工具角色）**：

| cycle_nature | 主锚 | mid-cycle 工具角色 | PB-band | gap<15% 验收 |
|---|---|---|---|---|
| **true_cyclical**（纯价格周期：面板/存储/有色/化工/钢铁/煤炭/航运/养殖） | normalized EPS / PB-band | **目标价**（均值回归世界的公允值） | 主锚 | ✅ 适用 |
| **cyclical_grower**（周期叠结构性需求，Micron-in-AI） | forward PE（§3.8 E 纪律） | **地板** + 退出倍数压缩敏感性强制披露 | 强制披露 | ❌ |
| **secular**（结构性成长，定价权积累：沪电/新易盛/天孚/拓荆型） | forward PE（§3.8 E 纪律） | 地板（可选） | 仅警示（99%分位仍要喊） | ❌ |
| **stable**（低增长低波动） | PE / DDM | — | — | ❌ |

**步骤②：跑 `compute_pb_band` 定周期位置（把 cycle_nature 传入，markdown 自动标对口径）**

```python
from auto_research.toolchain.midcycle_valuation import compute_pb_band
r = compute_pb_band("002463.SZ", cycle_nature=eq.cycle_nature)  # 港股传 pb_series 显式降级
# r.percentile / r.position（底/中/顶，分位优先）/ r.markdown
# markdown 顶部按 cycle_nature 标注: true_cyclical → mid-cycle=目标价锚 / 其他 → 估值地板非目标价
print(r.markdown)   # → 直接贴进财务数据.md 估值段
```
- `position == "顶"` 或 `percentile > 80%` → 周期顶部，进步骤③
- 港股无 daily_basic → `compute_pb_band(code, pb_series=[...], current_pb=...)` 显式输入，或 `position="无数据"` fail-open 不阻断

**步骤③：周期顶部时禁用 TTM PE 当便宜信号，改 `compute_midcycle_ev_ebitda` 交叉验证（同样传 cycle_nature）**

```python
from auto_research.toolchain.midcycle_valuation import compute_midcycle_ev_ebitda
# 合理 EV/EBITDA 倍数 / 产能 / 利用率 / 单位利润率 / net_debt 全是研究输入手填（工具不取）
v = compute_midcycle_ev_ebitda(
    "002463.SZ",
    ev_ebitda_multiple=12.0, multiple_basis="PCB 同业可比 12x",   # 倍数永远人工给
    net_debt=17.4,                                                # EV−net_debt 桥
    current_revenue=189.0,                                        # 算法③用
    current_ev_ebitda=24.0,                                       # 显式 TTM 口径，工具不从市值反推
    cycle_nature=eq.cycle_nature,                                 # 决定 markdown 口径（目标价锚 vs 地板）
)
print(v.markdown)   # 三算法（①历史中位 ②产能法 ③收入×历史均值率）横向对比 → 贴估值段
# v.ttm_vs_midcycle_multiple > 1 = 当前比 mid-cycle 贵 = 周期顶 TTM 失真
# v.spread_flag = True 时三算法发散大 = 口径敏感，禁单点决策
```

**与 §5.6 协同（双确认）**：`cycle_nature==true_cyclical`（行业先验/种子坐实）+ PB 高分位 = 双确认。
**关键纪律（v2.34.0）**：secular/cyclical_grower（沪电/新易盛/拓荆型）即便 PB 100%分位，mid-cycle 也只是**估值地板非目标价**——主锚永远是 forward PE，不能因为"看着像周期顶"就把 secular 当 true_cyclical 锚 PB-band（这正是 SEED-008 手工标错 3/5 的病根）。只有 `cycle_nature==true_cyclical` 才用 PB-band 当目标价锚。

**与 valuation_router（§3.4）的正交关系（硬写，constraint）**：
- `valuation_router` = **方法选择层**（判该用哪种方法 → PE / SOTP / rNPV / PB-band / …）
- 本工具 = PE 适配桶内的 **"锚纪律层"**（即使路由到 `METHOD_PE`，周期顶仍需 mid-cycle EV/EBITDA 校准 TTM PE）
- SEED-008 原文：路由表 = 方法选择层 / 5 模式 = 方法执行层，**二者正交非替代**
- ⚠️ 模式 C 受害股（沪电 / 新易盛 / 天孚 / 顺络 / 旭创）多路由到 `METHOD_PE`（盈利成长，非 `cyclical_peak`），所以这层纪律必须在 **PE 桶内补**，不是换成 PB-band 方法。走对路由 ≠ 不再背离投行，还要专门治 C 才真正收敛。

**纯计算器边界**（同 §5.7 sotp scope）：合理 EV/EBITDA 倍数 / 产能 / 利用率 / 单位利润率 / net_debt / current_ev_ebitda 都是**研究输入手填**，工具只算术 + 对比 + markdown，永不从市值反推 EV（否则破纯计算器边界）。

### 3.8 估值快照（轻量，不做精密模型）

**估值锚随增速自动切换规则（v2.33.0 新增 — SEED-008 P2-A 治模式 E 锚漂移，8/8 案例几乎全中）**:
锚死 TTM/当年 PE，增速 >50% 时 PE 已失效但还在用 = 系统性"史上最贵"误判。锚必须随净利增速自动切换:
- **净利增速 >50%** → 锚用 **forward PE**（12-18 个月后 EPS），TTM **仅参考且必须显式标注**。
- **增速 20-50%** → **当年 forward PE + mid-cycle EV/EBITDA（§3.7.5 工具）交叉**。
- **增速 <20%** → 必须切 **mid-cycle**，forward PE 不可信。
>
> ✅ **验证标准（硬写）**: AI 链高增股估值段必须**显式标注**"当前锚=forward 12-18m，TTM 仅参考"。
> 🔻 **反例（写进文档）**: 新易盛 TTM 54x vs 2027E 17x 差 **3.2x**——锚死 TTM 会得出"史上最贵"误判，
> forward 锚才是真口径（同款: 天孚 TTM 160x vs 27E 35x / 旭创 TTM 88x vs 27E ~30x）。
> 与 §3.4 horizon 一致性铁律呼应（三情景 EPS 年份同口径），与 §3.7.5 mid-cycle 工具引用对齐。

**工具调用：forward_pe_snapshot 取 forward PE + 退出倍数敏感性表（v2.35.0 新增 — SEED-008 P2-A E 模式代码化）**:
高增股估值段不再人工填表——调 `forward_pe_snapshot` 取 forward PE FY1/FY2（一致预期 EPS 自动取数）+ TTM 失真倍数 + 退出倍数敏感性表，直接贴 markdown：
```python
from auto_research.toolchain.forward_pe import forward_pe_snapshot
# terminal_multiples 是研究输入（GS 26x vs CITI 11x 之争=退出倍数之争，工具不内部拍）；
# 不传则取中枢 ±1/3 自动构造低/中/高三档（应替换为你的增速→倍数映射）。
snap = forward_pe_snapshot("300502.SZ", terminal_multiples={"CITI": 11, "mid": 18, "GS": 26})
# snap.markdown 直接贴估值段：forward PE 表 + TTM 失真倍数 + 退出倍数敏感性表（每档目标价 + 隐含 CAGR）
```
> **纯计算器哲学**: terminal multiple（退出倍数）= 研究输入（增速→合理倍数有主观判断，工具只做算术 + markdown）。
> 共识 EPS 走 `get_consensus_eps`（eps_forecast_ths 主 + analyst_forecasts_v2 辅，缺数据 fail-open 走研报 grep）；
> 现价默认 A 股 daily_basic，港股需显式传 `price=`。**目标价之争从来不是 EPS 之争而是 terminal multiple 之争**
> （新易盛 GS 26x vs CITI 11x 差 2.4 倍、零盈利分歧），退出倍数敏感性表把这件事工具化。
> ⚠️ gate §7.11 机械检查：共识增速 >50% 的标的，估值段无 forward 年限标注（forward/26E/27E）→ WARN（不 BLOCK）。

> ⚠️ **CDR/存托凭证例外（v2.39.2）**：若 `forward_pe_snapshot` / `get_research_summary` / 研报正文暴露 CDR EPS 单位混乱，forward PE 表只能作为降级参考，不能作为 Bull/Base/Bear 条件估值主锚。主锚切到市值 / 正常化净利和 SOTP 分部估值，承重表必须显式标 `🔻已降级`。

**引用任何卖方 TP/EPS 前必读最新研报正文（v2.33.0 新增 — SEED-008 P3-A 治模式 B 前视 stale）**:
估值锚引用任何卖方 TP/EPS **前必须通过 `common.report_search` 读取最新研报正文**确认未被上调/下调；Conductor/Codex 不直接把底层 `fts_search()` 当研究入口:
```python
from common.report_search import search_reports, get_report_content

hits = search_reports("英文名 OR 股票名 OR 代码", source="zsxq", limit=50)
contents = {
    r["info_code"]: get_report_content(r["info_code"])
    for _, r in hits.iterrows()
}
```
> 🔻 **拓荆教训（写进文档）**: workflow 数据包曾用 **stale Bernstein PT 450** 据此判"front-run 全卖方 +37%"，
> 实际 Bernstein 已上调 **450→580**（现价仅 +6% 约公允）—— stale 锚 = **偏空陷阱**（memory
> `feedback_research_framework_bias_trend_blind` 同款）。对应 gate §7.6 新增的 TP/EPS 时间戳 WARN（承重表
> 引用 TP/目标价/EPS 但无日期格式 → WARN 提示带研报时间戳防 stale）。
>
> ⚠️ **正文完整性权重闸（v2.40.14）**: 若最新卖方 TP/EPS 只在标题/摘要/新闻里出现，或 RRS/PDF/OCR 正文乱码、截断、缺模型页/关键假设，必须降级为 `keyword_lead` / `sensitivity_case`，不得作为三情景 main/base/bull/bear 承重锚。写法要求：①研报索引区分 `direct_full_report`、`title_only_or_garbled`、`industry_cross_read`；②承重数字表把该 TP/EPS 标 `🔻已降级`；③交易计划只能写“等待完整正文/PDF恢复/复核”，不能因为标题 TP 高就上调建仓线。只有读到可核对正文日期、模型假设、盈利预测表或估值页，才可升级为主估值锚。

> ⚠️ **上修斜率优先于静态目标价（v2.18.0）**: 最新 TP/EPS 不只是一个数字，要看同一机构/多机构过去 30-45 天的 `old_value → new_value` 斜率和驱动。若上修来自 ASP、毛利率、订单或产能利用率，且有 S0/S1 或两源交叉验证，必须进入 `street_revision_delta` 并重算三情景；若上修只是 `multiple_only` 或估值窗口后移，只能进敏感性，不得单独承重。

**反转 DCF — 量化"市场共识"的关键武器**：
当前股价不是凭空来的——它隐含了市场对公司未来的所有预期。把这个隐含预期算出来，你才能说"市场错了"。

```
反转 DCF 三步速算（放入财务数据.md）：

1. 反推隐含增速：
   从当前股价出发，用简化的戈登增长模型反推：
   隐含增长率 = WACC - FCFE/市值
   或用更直观的方法：
   隐含 3 年 EPS CAGR = (当前 PE / 行业合理 PE - 1) × 100%
   示例：当前 PE 80x，行业合理 PE 25x → 隐含 3 年 CAGR ≈ 220%（即市场预期利润3年翻3倍）

2. 与你的判断对比：
   ┌────────────┬──────────┬──────────┐
   │            │ 营收增速  │ 净利增速  │
   ├────────────┼──────────┼──────────┤
   │ 市场隐含    │   35%    │   45%    │
   │ 券商一致    │   30%    │   38%    │
   │ 我的判断    │   25%    │   30%    │
   └────────────┴──────────┴──────────┘
   
3. 预期差量化：
   如果我的判断对、市场共识错 → 合理 PE ≈ 40x → 当前 80x 被高估 50%
   如果市场共识对、我的判断错 → 合理 PE ≈ 75x → 当前 80x 基本合理

⚠️ 反转 DCF 的精确数字不重要——它和你的预期之间的差距大小才重要。
   差距越大，预期差越大。差距小 → 你和市场想的一样 → 没有超额收益。
```

你不需要 DCF。做这些就够了：

```
估值快照（自动计算，放入财务数据.md）

1. 当前估值 vs 历史：
   - PE(TTM)：当前值 / 5年分位 / 10年分位 / 行业中位数
   - PB：当前值 / 5年分位 / 10年分位
   - PS（如适用）

2. 券商一致预期（取中位数）：
   - 未来 12 个月目标价
   - 未来 2 年 EPS 预测
   - 未来 2 年营收预测

3. PEG 速算：
   - PEG = 当前 PE / 未来 3 年预期净利润 CAGR

4. 核心判断（不是精确数字，是方向）：
   - 当前估值在历史上是偏贵 / 合理 / 偏便宜？
   - 当前估值是否已经反映了市场共识？
   - 如果你的预期差是对的，估值应该值多少？（给区间，不给点）
```

**原则**：模糊的正确 > 精确的错误。一个精确到小数点后两位的 DCF 不会让你比机构更赚钱——但发现一个所有机构都忽略了的预期差，会。

---

---

## 第 3.5 步：产业 TAM 增量映射 — 把未来增量算进去（v2.5.0 新增）

**禁止只用静态 PE 做估值判断。** 当行业 TAM 在 5 年内增长 4-12x 时，今天"看起来很贵"的 PE 可能在 3 年后是便宜的。v2.5.0 前教训：天孚通信 PE 157x 被静态框架误判为 B+（TAM修正后应为 A-）；摩尔线程 PS 111x 被误判为 C+（修正后应为 B）。

**v2.17.0 前置门禁**：L2+/L3 首次 `quality_gate_check.py` 前必须把本节写进 `深度研究.md`，不能等 gate warning 后再补。若公司有多条业务线，先按 `承重业务 / 待验证增长 / 期权业务` 分桶，再分别写 TAM/市场规模、公司份额、来源日期、估值是否承重。TAM 数据不足不是跳过理由，必须写 `TAM_DATA_GAP`、已检索关键词、缺口原因，以及“本次估值不使用 TAM 扩张做承重假设”的降级结论。

### 强制检查清单（L2+必须逐条回答，标注数据来源）

**1. 公司所在核心产业的 TAM 轨迹**：
- 当前 TAM：___（来源：___）
- 3 年后 TAM：___（CAGR ___%）
- 5 年后 TAM：___（CAGR ___%）
- 数据来源必须 ≥2 个独立源（投行报告/产业研究机构）

**2. 公司在 TAM 中的份额趋势**：
- 当前市占率：___%（来源：___）
- 3 年后预期：扩大/维持/缩小（理由：___）

**3. TAM 调整后的隐含估值**：
- 当前 PE(TTM)：___x 或 PS(TTM)：___x
- 若 TAM 增长 Nx + 公司营收同步增长：
  - 3 年后隐含 PE = 当前 PE / (TAM 倍数 × 市占率变化) = ___x
  - 隐含 PE < 20x → TAM 增长足以合理化当前估值
  - 隐含 PE 在 20-40x → 部分合理化，需结合其他因素
  - 隐含 PE > 40x → 即使 TAM 高增，当前估值仍然偏贵

**4. 产业增量确定性评估（三选一，决定修正幅度）**：
- □ 确定性高（AI Capex/头部云厂商签长约/产能已锁定 → 修正 +2 级）
- □ 确定性中（机器人量产/1.6T放量，时间线可能跳票 1-2 年 → 修正 +1 级）
- □ 确定性低（量子计算/前沿技术，商业化时间不确定 → 不修正）

**5. TAM 增量修正后的评级**：
- 静态 PE 评级：___
- TAM 增量修正：+___级（确定性___）
- **修正后评级：___**

**6. 分业务承重映射（L2+/L3 首次 gate 前必填）**：

| 业务/产品线 | 分桶 | 收入/利润占比 | TAM/市场规模口径 | 来源与日期 | 公司份额/竞争位次 | 估值用途 |
|---|---|---:|---|---|---|---|
| ___ | 承重业务 / 待验证增长 / 期权业务 | ___ | 当前 ___ / 3年 ___ / 5年 ___ | ___ | ___ | 承重 / 交叉验证 / 只作期权 |

无法填满时不得空白，写：

```text
TAM_DATA_GAP: 已检索 [关键词1, 关键词2, ...]，未找到可承重的市场规模/份额口径；本次估值不使用 TAM 扩张做承重假设，仅保留为待验证 upside。
```

### 关键原则

- **TAM 高增长 ≠ 可以给任何估值**。即使 AI 加速器 TAM 12x 增长，如果公司市占率可能下降，仍要给估值折价
- **产业确定性决定修正幅度**。AI 网络（4x TAM，确定性高）→ 修正幅度大。量子计算（TAM 时间线不确定）→ 不修正
- **不要把"可能"当前提**。若 TAM 增长依赖"1.6T 如期放量"等假设，必须标注假设风险
- **TAM 数据不足时不强行修正**。标注"TAM 数据不足，无法完成增量映射"，不调整评级
- **TAM 只能修正条件估值，不替代 return artifact 或动作闸**。不得把 TAM、条件 CAGR 或卖方 Base 值转换为手工概率/正式 EV，更不得据此直接给买入。

### TAM 数据获取方法

1. WebSearch "{产业名称} 市场规模 TAM 2026 2030 预测"
2. 已拉取的东财/国际投行研报中搜索产业 TAM/市场规模数据
3. 上市可比公司的投资者演示材料（如 NVIDIA/TSMC 的 Capex 指引）
4. 无数据时：标注并跳过，不强行修正

---
