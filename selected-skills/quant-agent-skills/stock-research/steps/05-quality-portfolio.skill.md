---
name: stock-research-step-05-quality-portfolio
version: 2.18.0
description: |
  stock-research 最终交付：对比模式、Quality Gate自检、Completion Status Protocol、
  Anti-Patterns禁止行为、已知限制与绕过方案、Skill Stack不重复造轮子、Related Skills。
  Conductor 在研究收尾和质量把关时加载此文件。
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

## 对比模式

当用户要求"对比 A 和 B"时，在标准五文件之外生成对比文件：

目录：`auto_research/knowledge/stock_research/对比_{A}vs{B}/`

```markdown
# {A} vs {B} 对比分析
*生成日期：YYYY-MM-DD*

## 一、关键差异矩阵
| 维度 | {A} | {B} | 谁更优 |
|------|-----|-----|--------|
| 商业模式壁垒 | ... | ... | A / B |
| 周期位置 | ... | ... | A / B |
| 财务质量 | ... | ... | A / B |
| 估值 | PE xx (xx%分位) | PE xx (xx%分位) | A / B |
| 预期差大小 | ... | ... | A / B |
| 催化剂确定性 | ... | ... | A / B |
| 最大风险 | ... | ... | A / B |

## 二、同一核心假设下谁更优
假设: {共同的核心假设，如"行业景气度在 12 个月内回升"}
- {A}: {在这个假设下的表现预测}
- {B}: {在这个假设下的表现预测}
- 结论: ...

## 三、仓位配置建议
- 如果只能选一个: {选哪个，为什么}
- 如果两个都要: 建议比例 A xx% / B xx%（理由）
- 如果都不值得: 为什么

## 四、相关性判断
- {A} 和 {B} 的核心驱动因素是否相同？
- 如果是（如同一行业、同一产业链位置），同时持有并不分散风险——只是在赌同一个变量
```

---

## 🛑 承重数字结算清单（declaring done 前强制必跑——v2.22 根治"脑补承重数字"）

> **来历**：永和605020(2026-05-31) 单次研究三处翻车，**全在"承重数字"上**（thesis 缺它就不成立的数）：① 内部人增持均价 DB `avg_price` 全 NaN，**两次脑补**(@17.7→@31.18 金额笔数全编)；② 三美 PE 写 33.1x，DB 实际 16.6x（承重对比数没回查）；③ normalized PE 用配额前 2.45亿做锚推"50-84x极贵"，与"配额结构性 floor"自相矛盾。
>
> **根因不是缺规则，是规则拦不住**：这三种错 [[feedback_research_source_fidelity_gate]] / [[feedback_quality_gate_format_not_logic]] / [[feedback_collect_data_no_guessing]] **全覆盖**，但**一条都没在事前触发**——全靠 advisor 事后捞。**检查全是"自觉做"，没有"机械必跑"。自觉 = 运气依赖，研究一长、上下文一满，自觉第一个失效。** 所以本清单不是"又一个 checkbox"——它要求落盘一张**机器可校验的表**，并由 `quality_gate_check.py §7.6` BLOCK 强制（缺表 / 有 `❌未结算` cell / 空壳表 → 直接 BLOCKED，无法 declaring done）。
>
> **⚠️ 这个 gate 拦什么、拦不住什么（别过度信它，否则又是"信了个 gate 没验它到底做啥"的永和陷阱）**：§7.6 能**机械拦**的只有 ① 完全没落盘结算表 ② 你自报 `❌未结算` ③ 空壳表（无任何 ✅/🔻 受控状态行）。**它拦不住你把脑补的数自信标成 ✅**（出处栏填 "DB:avg_price" 但其实没查 / 是 NaN）——脚本不查 DB，分不出"真 ✅"和"编的 ✅"。永和的 @17.7 当时若被自信标成 ✅，这个 gate 照样放行。**防伪造不靠脚本，靠：第二步你真去查 DB 拿到非 NaN 值 + advisor 终检 + 出处可被复查者查到同一个数。** 所以填 ✅ 不是"盖个章"，是"我真查了、换个人查同一 cell/页码也是这个数"。

### 第一步：落盘「承重数字结算表」（深度研究.md 必含，否则 Quality Gate BLOCK）

写完研究、declaring done **之前**，在 `深度研究.md` 写入这张表——把 thesis/结论/三情景/建仓价**依赖的每个承重数字**逐行列出、逐个标出处、逐个结算：

```markdown
## 承重数字结算表

| 承重数字 | 用在哪(thesis/情景/建仓价) | 出处类型 | 具体定位(cell/页码/公式) | 验证状态 |
|---|---|---|---|---|
| FY25净利38亿 | EPS基线/期望值 | DB+财报 | income表 + 年报p.4 | ✅已结算 |
| 内部人增持均价@27-28 | "内部人在27买/现价34没人追"判断 | 公告 | 2026-05权益变动公告 | ✅已结算 |
| 三美对比PE 16.6x | 同业贵贱对比 | DB | daily_basic | ✅已结算 |
| ~~内部人@17.7抄底~~ | (已删) DB avg_price=NaN答不出 | — | 答不出→从承重位删除 | 🔻已降级 |
| hurdle-pass probability | return evidence | immutable artifact | `_return_distribution_YYYYMMDD.json` + SHA + bucket field | ✅已结算 |
```

**验证状态受控词表（机器校验，只认这三个）**：
- `✅已结算` — 有真出处且已核实（DB 非 NaN / PDF 正文真读到 / 公式两端各有出处 / ≥2 独立 web 源）
- `🔻已降级` — 答不出出处，**已从承重位拿掉**（删除 / 改定性表述 / 显式标 illustrative 不承重）。出处栏写清"答不出→怎么处理"
- `❌未结算` — 还答不出出处、却仍占着承重位 → **Quality Gate 见此即 BLOCKED**。不许挂着"待核实"硬推，必须就地降级或删除

### 第二步：逐个标出处的判据

每个承重数字后面必须能填上 `← 出处`，否则不算结算：
- `DB:表.列`（并确认**非 NaN**——NaN 不算有出处，是"字段是空的"，照样会触发脑补）
- `PDF p.X 图Y`（并确认正文**真读到**，非扫描图嫁接、非凭记忆）
- `artifact: filename/SHA/field`（数值 probability/return/tail 必须逐字段回指同一 immutable artifact；禁止人工重算一组权重）
- `web多源N家`（≥2 独立源，标信心 `[B]`）

### 第三步：口径自洽（锚类数字防自相矛盾）

normalized / 锚类数字，逐个问"**这个锚和我 thesis 其他结论打架吗？**"
- 配额股别用配额前 earnings 锚；结构性改变的标的别用历史均值回归锚（巨化翻车本质）
- 命门数字（thesis 翻盘点）必须 ≥2 独立源交叉验证（见 SKILL.md §命门数字交叉验证铁律）；单券商单数据点不足以承重"见顶/拐点/反转"

### 红旗口诀（一句话自检，背下来）

> **"我手里这个带小数点的数，从哪个 cell / 页码 / 公式来？答不出，就是我编的。"**

**承重 vs 装饰**：承重数字（thesis 缺它就垮的）适用最严口径，必须进结算表。手工数值概率不属于“装饰”例外：当前 reader 中一律禁止；withheld 保持 null，conditional cases 不带概率。

### 第四步：advisor 终检兜底（已有铁律，是兜底不是首检）

上述 1-3 步自查**全跑完**后，仍调 advisor 查矛盾/确认偏误/命门单源。**advisor 是兜底，前三步必须自己先机械跑一遍**——把活全推给 advisor = 又回到"自觉依赖"。

> 关联记忆：[[feedback_load_bearing_numbers_settle]]（本清单的完整推导）。

---

## §7.15 因果盈利证据硬闸（L2+/L3）

§7.15 只读取最新 `_stock_earnings_model_YYYYMMDD.json`；Markdown 不得替代机读证据。

- `activation_status=activated`：机械核 `schema_version`、scope、PIT source date、
  来源 ID/单位/hash、`input_hash`、`model_run_id`；bull/base/bear 必须各自从
  `operands.scenario_net_profit_yi / operands.effective_shares_yi` 独立复算
  `derived_eps`，并核 target row `earnings_uplift` 与 `audit_chain`。
- `activation_status=soft_fallback`：必须为 `[C]`，含 `fallback_reason`、非空
  `missing_inputs` 与已取得 provenance；不得含 scenarios/model_score/derived_eps/
  probability/trading action，也不得获得 §7.15 模型分。
- 三类 anti-fixture 一律 BLOCK：手填 bull/base/bear EPS；没有财务结构与 audit
  支持的 `earnings_uplift`；盈利 evidence 中裸数值 probability 或用
  `_scenario_probability_*` 替代因果链。
- 同输入必须保持相同 `input_hash`、`model_run_id`、operands 和 `derived_eps`；
  malformed JSON 不得静默覆盖。

任何 causal schema、§7.15 gate、reader report 或承重数字改动，都会让下游证据失效；
必须从 dated causal artifact 重新生成 reader 文件，重新 Vault sync，再按最终顺序重跑
quality gate → scoped clean scan，旧 hash/旧 gate 回执不得沿用。

## §7.16 24 个月收益概率发布硬闸（L2+/L3）

§7.16 只把 exact captured `_return_distribution_YYYYMMDD.json` 与对应 immutable
`_return_claims_YYYYMMDD.json` 当 claim authority；Markdown 只是 renderer
projection。执行链必须证明：valuation archetype route → frozen PIT snapshot →
applicable `_stock_earnings_model_*` upstream evidence →
`forecast(contract, snapshot)` → immutable artifact save/capture/load → Agent
probability-null conditional evidence → manifest 恰好一次 build/save/load → Leader
消费 loaded manifest → report prose → renderer/CAS replacement。Leader 后不得再写
manifest，renderer 后不得手改 claims block。

- Sell-side Bull/Base/Bear 只含条件假设、估值方法和条件价值，禁止概率列。
- decision buckets 固定为 loss (`R<0%`)、below hurdle (`0%<=R<32.25%`) 和
  hurdle pass (`R>=32.25%`)，并与 tail 一起只从 artifact 复制。
- 所有 `WITHHELD_*`：`numeric probability = null` + exact reason；不得恢复手工权重，
  不生成正式概率加权 EV。
- `PROVISIONAL_UNCALIBRATED` 只能承重 sensitivity EV；
  `CALIBRATED_MODEL_WEIGHT` 必须有匹配 immutable model/version 的 active registry
  authorization、独立验证和人工批准。
- `_scenario_probability_*` 是 legacy evidence only。action、portfolio-risk、approval、
  execution 闸继续独立运行，概率产物不得写其状态。
- gate 必须核 manifest/artifact/PIT identity、single renderer block、
  discriminator/pointer、reserved numeric prose 和 helper state。稳定 failure code
  以 `references/output-contract.md` 为准；只有 pinned path/span/SHA exact legacy
  bytes 可 WARN，不能成为现行 claim authority。

## Reviewer Completion Barrier（commit 前硬闸）

所有为本次 closeout 启动的 reviewer、advisor、security audit 或后台审计，必须在首次
commit、amend、DONE 声明之前全部返回 terminal result。`running`、`pending`、超时后未取回
结果都视为未完成；不得把 reviewer 当 post-commit 补票。

- terminal 结果中 unresolved `CRITICAL` / `HIGH` 必须为 0；否则先补 RED、修复、跑对应回归，
  再让 reviewer 复核。
- reviewer 驱动的任何 source/evidence/trigger/verdict/bridge/proof/consumer-boundary 编辑，都会
  使此前 Vault SHA、consumer audit、quality gate 和 closeout proof 失效。必须从最后变更的
  authority 重新跑下游链，再等待全部 reviewer terminal。
- commit 前保存或引用每个 reviewer 的 terminal receipt，并核对 reviewer 数量等于本轮已启动
  数量；漏取一个结果即 `BLOCKED_PENDING_REVIEW`。
- 只有 reviewer barrier 清零后，才可精确 stage 本任务文件并 commit；禁止 `git add -A` 把
  其他研究或生成文件混入补救提交。

## Quality Gate（交付前自检）

**最终顺序硬闸** — 五文件、machine evidence、trigger/watchlist/bridge、Vault 同步、
Leader prose 和唯一 renderer/CAS block 全部完成后，先跑 closed consumer audit，
最后才跑 study quality gate。两条命令都是只读校验；quality gate 是本次 workflow
最后命令。任一失败均停止，禁止改 prose/block 后沿用旧回执：

```bash
python scripts/audit_return_claim_consumers.py --root . --json
python auto_research/quality_gate_check.py auto_research/knowledge/stock_research/{股票名}-{代码}/
```

> 脚本自动检查：五文件完整性/证据等级/数据信心/数字来源/绝对日期/投资声明/**逻辑自洽(v2.21)**/跟踪框架/建仓情景/TAM映射。输出PASS/PASS_WITH_WARNINGS/BLOCKED。

> **🛑 Quality Gate 只查"格式"，不查"逻辑对不对"（v2.21 必读）**：脚本是 regex 校验——五文件齐、有[事实]标记、有来源关键词、有免责声明就给高分，**可被关键词刷分**。它**保证不了结论自洽、数字正确、推理成立**。
> - 真实翻车：巨化股份(2026-05-31) Quality Gate **100% PASS**，但 bear 招牌"正常化PE 40-49x"与行业 agent"配额结构性改变不可类比"逻辑打架，**全靠事后 advisor 才发现**。
> - **铁律**：Quality Gate PASS ≠ 可以 declaring done。**declaring done 前必须调 advisor 查"逻辑自洽 + 确认偏误 + 命门数字单源"**——这一步不可省（参照 `feedback_research_refresh_confirmation_bias`）。Gate 的逻辑自洽检查(v2.21)只能机械捕捉"结构性改变vs均值回归"这一种模式，其余矛盾靠 advisor/人工。

**人工自检清单**（辅助）：

- [ ] **🛑 承重数字结算表已落盘**（v2.22 强制，最高优先级）：`深度研究.md` 含「承重数字结算表」，每行验证状态 ∈ {✅已结算, 🔻已降级}，**无 `❌未结算`**。脚本 §7.6 会 BLOCK，但你应在跑脚本前自己先填完（见 §承重数字结算清单）
- [ ] **🛑 数据信心分级已前置落盘**（v2.39.1）：`深度研究.md` 首屏或承重数字表后已写 `[A]/[B]/[C]/[D]` 定义和本文使用边界。禁止首次 gate WARN 后才补；这是研究初稿的基础卫生。
- [ ] **🛑 TAM/市场规模映射已前置落盘**（v2.17.0/v2.40.9）：L2+/L3 首次 gate 前，`深度研究.md` 已把核心业务按 `承重业务/待验证增长/期权业务` 分桶，列出 TAM/市场规模来源、口径日期、公司份额与估值用途。若数据不足，必须写 `TAM_DATA_GAP`、已检索关键词和“不用 TAM 增长支撑估值”的降级结论，禁止 gate WARN 后才补。
- [ ] **🛑 绝对日期预清理已完成**（v2.39.1）：跑 gate 前先扫五文件，`今天|昨天|刚刚|最近|上周|目前|当下|today|yesterday|recently` 等相对时间要么清零，要么在历史引用中改成明确 `YYYY-MM-DD`。
- [ ] **🛑 trigger 日期卫生已结算**（v2.39.1）：`triggers_entry.json` 中每条 `expected_date` 只能为空或 `YYYY-MM-DD`；禁止 `2026Q3` / `2026-08` / `H1` / `下半年`；研究日之前已发生的事件不得继续 `status="pending"`。
- [ ] **🛑 declaring done 前已调 advisor**（v2.21 强制）：查逻辑自洽/跨 Agent 矛盾收口/命门数字是否单源/确认偏误。Quality Gate 100% 也不豁免这一步
- [ ] **命门数字 ≥2 源交叉验证**（v2.21）：支撑整篇 thesis 方向的单个最重要外部变量（价格/份额/订单）已 ≥2 独立来源验证，未用单券商单数据点下"见顶/拐点"结论；tp 目标价字段失真未直接引用
- [ ] **跨 Agent 矛盾已收口**（v2.21）：深度研究.md 有"矛盾收口"段，逐条列出 6 Agent 间逻辑张力 + 裁定口径（或写明"已扫描无互斥逻辑"）
- [ ] **财务基线一致**（v2.21）：TTM/FY 净利、EPS、股本全文一处算好全员复用，无新旧数并存/漂移

- [ ] **DB数据完整性**: `check_table_coverage()` 已跑，缺核心表时已调 `collect-data` 补数
- [ ] **手工TTM PE**: `summary['manual_pe_ttm']` 已与系统PE对比，差异>30%已标注
- [ ] **研报时效性**: `store.freshness(code)` 已跑，最新研报>90天亮黄灯
- [ ] **来源可追溯性已验证**：每个数字可追溯到 `[直接来源]`（财报原文/DB数据）或 `[中间来源]`（券商研报引用）。禁止用中间来源的数字当事实陈述——中间来源的数字是别人的推断，不是你的事实
- [ ] **研报来源等级已标注**：`[一手]`本地KB有PDF正文 / `[二手]`Web社区转述 / `[推测]`无直接来源（禁止用二手来源的目标价做估值锚）
- [ ] **Street Revision Delta 已审计**（v2.40.21）：若最终结论是 `WAIT/AVOID/不买/等回调/等右侧`，已检查最近 30-45 天投行/卖方 TP/EPS/收入/ASP/GM/订单上修轨迹；命中则已写 `street_revision_delta`、`driver_type`、`right_side_confirmation` 和 `action_boundary`。若 `driver_type=earnings_path` 且右侧确认，必须刷新 operating evidence、forward 锚、PIT snapshot 和 return forecast；不得手工调概率或把卖方 Base 值升级成动作。
- [ ] **Action Semantics 已结算**（v2.40.23）：README/深度研究已写 `current_action/current_new_money_pct/max_position_after_trigger_pct`；动作由基本面、趋势、风险、组合、批准和执行证据独立裁定。withheld/provisional probability、conditional CAGR 或 sensitivity EV 不得创建 `BUY_NOW/ADD_NOW/PROBE_ONLY`；缺独立授权时 `current_new_money_pct=0`。
- [ ] **六问已回答**（§3.1），参数对比表已填写（§3.3）
- [ ] **条件案例与收益分布合同已完成**（§3.4 L2+强制）：Bull/Base/Bear 无概率条件案例 + exact return artifact filename/SHA/stage + 24个月 decision buckets/tail；withheld 数值为 null
- [ ] **Claim manifest closeout 已完成**：Agent conditional evidence 均为 PIT-bound refs + `probability=null`；manifest 仅一次 build/save/load；Leader 消费 loaded manifest 后才有 report prose；唯一 renderer block 已 CAS 替换；closed consumer audit 先 PASS，最终 quality gate 后无任何写入
- [ ] **与卖方核心分歧已写清**（§3.3 L2+强制）：不只列评级，要解释为什么你和他们不一样
- [ ] **最优建仓分析已完成**（§3.4）：条件目标价/CAGR + 定性到价可能性 + 等待机会成本 + Plan B；不另造数值概率
- [ ] **预测置信度已标注**（v2.10新增）：[预测:高/中/低] 区分历史事实和未来判断的可靠性
- [ ] **催化剂已标注绝对日期**（不是"未来某时"——是"2026-08-15 财报"）并注明更新哪些 PIT 输入、是否触发 forecast 重跑；不手工调概率
- [ ] 风险分析包含致命/重大/一般三级 + 触发条件 + 对冲策略
- [ ] **Upside 分析已完成**（v2.10新增 §八）：TAM×市占率+利润率扩张+新业务期权+管理层执行力
- [ ] 跟踪框架包含 thesis scorecard + KTI + 催化剂日历 + 硬触发条件
- [ ] **triggers_entry.json 已生成并跑 thesis_triggers_upsert.py**（v2.26）：从交易计划/止损/催化剂日历/命门映射机读 triggers[] → research_verdicts + catalyst_events 闭环（强回避股可不出, gate §7.9 灰区）
- [ ] **研究闭环动作面板已生成**（§7.9c）：跑 `python scripts/build_research_loop_board.py --ts-code {代码}`，确认当前状态落到 `TRADE_PLAN_READY / RESEARCH_DUE / WAIT_PRICE / WAIT_EVENT / HOLD_MONITOR / WAIT_TIME_RECHECK / AVOID_COOLDOWN` 之一，并能说清下一触发、复查日、触发后动作；不能生成则研究仍开环
- [ ] **research_verdicts sibling 字段已核对更新**（v2.40.0）：`thesis_triggers_upsert.py` 只 merge `thesis_id`/`triggers[]`，不更新 `verdict`/`action`/`expected_cagr`/`grade`/`last_updated`；这些字段必须与 README/深度研究最终结论一致，且已重跑 `scripts/generate_bridge.py`
- [ ] **分歧台账已登记**（v2.38.1 box8 软指令）：研究落盘后跑 `python auto_research/toolchain/divergence_ledger.py --mode record-backfill`（幂等全量，新研究自动入账 ours/street/settlement 三段）。港股若 研报索引.md 有研究日时点（publish_date ≤ study_date）的卖方 TP/评级 → 构造 manual_street json `{thesis_id: {as_of, n_brokers, buy_ratio, tp_mean, rating_summary, source:"manual_readme"}}` → `--mode inject-manual --file <json>` 灌入街腿（前视闸：as_of > study_date 直接 raise）。软指令不阻断 declaring done，台账完整性靠月度 settle 时 record-backfill 兜底。
- [ ] **研究队列已标 complete**（W2 follow-through）：研究落盘后跑 `python scripts/research_queue_complete.py --ts-code {代码}` 标该股研究队列项 complete（幂等，不在队列静默 no-op，exit 0）。不标则 build() 永远把它当 pending 重排，再研究节奏闭环合不上
- [ ] **L3 closeout proof-chain 已审计**（v2.40.16）：若 `stock-l3-closeout-proof` skill 可用，声明 DONE 前必须用它复核 `_agent_outputs`、东财双库二次 dry-run / HK 分支、A/H clean-window overlay、triggers/watchlist/bridge、research-loop state、Vault SHA、memory/MCP payload、quality gate 与 clean-report pass；审计 `BLOCK` 时不得声明完成。
- [ ] **L3 完成声明证据链已结算**（v2.38.2/v2.39.2/v2.40.6 硬闸）：Check-First/持仓状态、DB 覆盖与 collect-data 补数、本地 KB 三路检索、东财正文入库与全读、Workflow run_id / `wait_agent` 返回的 6 个真实 `agent_id`，或带 `fallback_reason` 的本地六视角降级证据（不得冒充真实 6-Agent）、无概率条件案例、return artifact/stage、独立动作语义、triggers/watchlist/bridge、Vault 源端-vs-Vault SHA256 逐文件一致、agent memory/MCP payload、quality_gate 结果全部在正文、`_agent_outputs_YYYYMMDD.json` 或 `_workflow_evidence_YYYYMMDD.md` 可追溯。缺任一项不得写 DONE，只能 DONE_WITH_CONCERNS/BLOCKED。
- [ ] **L3 clean report pass 已完成**（v2.40.3/v2.40.17 硬闸）：最终五文件主文不是旧报告顶部贴增量段；旧研究日、旧当前价、旧 verdict/action、旧建仓区间只能进入 `历史版本摘要.md` 或明确历史段。声明 DONE 前已搜索旧日期/旧价格/旧 action 关键词，主文承重段无混杂口径；`_workflow_evidence_*.{json,md}`、MCP payload、trigger/watchlist payload 的当前状态描述也已做 hygiene scan，不能因解释检查项而留下 TODO/FIXME/待补或历史故障词误触发。
- [ ] **Action-label hygiene 已完成**（v2.17.1）：proof/current-state 文件证明“没有即时交易状态”时，用中性布尔或自然语言，不把 `BUY_NOW` / `ADD_NOW` / `PROBE_ONLY` / `TRADE_PLAN_READY` / `execute_trade:add` 写进否定句做证明。若 focused clean scan 只命中这种否定句，先改写，再重跑 Vault sync、quality gate 和 focused clean scan。
- [ ] **最终重跑顺序已锁定**（v2.40.17 + claim manifest）：所有 evidence / trigger / watchlist / agent output / Vault-adjacent 文件完成最终编辑后，按当前文件状态依次执行 Vault sync → renderer/CAS → closed consumer audit → quality gate；quality gate 后若又改任一证据、manifest 或 reader 文件，旧结果作废，必须从受影响步骤重跑。
- [ ] L3 研报已包含反向论证（**多空论点都必须有**——空头和多头至少各 3 条）
- [ ] **新闻情绪采集已完成**（L2+）：akshare 拉取+LLM 三分类+情绪汇总表已放入 财务数据.md 末尾
- [ ] **6 Agent 并行分析已完成**（L2+）：6 个真实 Agent 并行跑完，且 `_agent_outputs_YYYYMMDD.json` 含 `workflow_run_id` 或 6 个真实 `agent_id` / `wait_agent` 返回摘要；若只是本地六视角，必须写 `single_thread_local_six_lens_review` + `fallback_reason`，不能勾选为真实 6 Agent 完成。
- [ ] **Debate+Leader 辩论已完成**（L2+）：单 Agent 同时执行 Bull/Bear 分析+Leader 裁决+Agent 互评
- [ ] **预测准确率追踪已更新**：§八 第一张表用 D-01 七列机读格式（日期/预测内容/方向/置信度/时间窗口/实际结果/判定），预测内容含路由关键词（EPS/净利润/营收/股价）、时间窗口可被引擎解析（N个月/YYYYQ[1-4]，禁"年"字）；上次预测已回测，结果已写入跟踪框架 §八
- [ ] 所有引用研报已标注：日期、机构、核心观点、评级/目标价；`[仅元数据]` 已标注；国际投行无覆盖已标注 `[信息真空]`
- [ ] 三地沉淀已完成：项目目录 5 文件 + Vault 5 文件（SHA256 逐文件一致，不只看 manifest）+ agent memory/MCP payload
- [ ] 国内券商评级未作为看好理由引用（仅引用其结构化数据、行业分析和盈利预测逻辑）
- [ ] 末尾已附加 "不构成投资建议" 声明
- [ ] 相对时间已替换为绝对日期（"最近" → "2026-05-17"）
- [ ] 如为增量更新，已确认未覆盖未变化的文件
- [ ] **防确认偏误**: Bull/Base/Bear 条件案例正反证据对称；没有 30/50/20 手工概率、agent vote 或 sell-side 权重进入当前结论
- [ ] **防悲观偏误**（v2.10）: Debate 中 Bull 和 Bear 篇幅对等，正面证据权重不低于负面证据。结论不是默认"不建议建仓"
- [ ] **防数据源偏见**（v2.11 新增——对标 BettaFish）: 6 Agent 的数据源是否足够差异化？同一份数据被 3+ Agent 复用 → 辩论无实质张力 → 重分配数据源
- [ ] **Agent 溯源完整性**（v2.11 新增）: 深度研究.md 中所有关键结论是否标注了 [A1]-[A6] 来源？是否有无溯源结论？
- [ ] **强制自省完整性**（v2.11 新增）: 每个 Agent 是否回答了"缺少什么证据？""什么证据会改变判断？""最可能错在哪？"三问？
- [ ] **研究置信度评分**（v2.11 新增）: README.md 中五维加权评分是否完成？≥7 PASS / 5-7 PROVISIONAL / <5 REJECT？
- [ ] **本地研报库三路搜索已完成**（中文名 + 代码 + 英文名），搜到的 PDF 已即时阅读（content=0 时用 fitz）
- [ ] **知识复利已执行**：东财研报已通过 `fetch_reports()` + `fetch_report_content()` + `store.save()` 入库（A 股 L2+），入库报告数 + 有正文率已验证；国际投行 PDF 已 `pdf_content_extractor.py` 回填（研究完成后）
- [ ] **§3.5 产业TAM增量映射已完成**（L2+强制）：TAM轨迹+市占率+隐含PE+产业确定性四步全跑。TAM数据不足时已标注并降级为DONE_WITH_CONCERNS。静态PE评级已用TAM增量修正
- [ ] **持仓研究映射桥已更新**（L2+强制）：`portfolio_research_bridge.md` 中本标的行已更新，冲突标签已设，冲突行动计划已追加
- [ ] **agent memory / MCP 第三腿已处理**（L2+强制）：若 `create_entities/create_relations` 工具可用，真实写入 graph；若当前环境无该工具，必须生成 `_mcp_memory_graph_payload_YYYYMMDD.json` / `mcp_memory_payload_YYYYMMDD.json` 或 memory note，payload 顶层必须含 `status: pending_tool_unavailable` 和 `reason`。禁止把 payload 说成已写 graph。

### 🛑 v2.38.0 未持仓观察池硬指令（2026-06-09 震裕教训固化）

> **来历**: 震裕 (300953.SZ) 5/28 L3 重大更新 verdict=可3%试探 + 期望 CAGR 14.8%，但**用户实际未执行建仓**（3%试探只是建议），本次 6/9 重算降级为 WAIT 0 仓位 → **5/28 整期研究的"可 3%试探"结论无任何动作归属**：
> - 5/28 时：未入 `watchlist.stocks`（因为 5/28 判"已可建仓"非"等回调"）
> - 5/28 时：未入 `portfolio_research_bridge.md`（同上）
> - 5/28 时：未入 `research_verdicts.json` 的 `position_pct` 字段（结构上只覆盖 verdict 但没标**当前是否持仓**）
>
> **本指令适用范围**: **任何 L2+ 个股研究的 verdict**，不论最后是"建仓/观望/清仓"。

| 投资动作（来自 README/verdict）| watchlist 段 | bridge 段 | research_verdicts position_pct |
|------------------------------|------------|----------|--------------------------------|
| **buy / add（已建仓）** | stocks[] 自动免登 + 移出池（v2.27.0 §7.8）| 持仓诊断卡（v2.16.0）| >0%（已建仓）|
| **wait / hold 等回调**| **必入 stocks[]（status=wait, target_entry_price）** | **观察池段（目标建仓价 + 触发条件）** | **0%（未持仓）+ target_entry_price + stop_loss** |
| **sell / trim（持仓减仓）**| 持仓诊断卡更新 | 持仓诊断卡 | <100% |
| **avoid（不建议建仓）**| **必入 stocks[]（status=avoid）+ 移出观察池后 90 天**| 观察池段（标"为何不投"）| 0% |

> **机械化**：
> 1. **wait/hold verdict**: 必跑 `python scripts/watchlist_upsert.py --stock-entry-file <triggers_entry.json>`（status=wait, target_entry_price 必填，触发条件附在 watch_reason 段）
> 2. **避免漏登**: bridge `portfolio_research_bridge.md` 末必追加"未持仓观察池"段（持仓股自动免登，未持仓必入）
> 3. **避免 position_pct 错**: research_verdicts.json 必加 `target_entry_price` + `stop_loss` + `expected_cagr_2_5y_pct`（即便 0 仓位也标触发价）
>
> **gate 升级**: gate §7.7 已有"行业缺席 → BLOCK"（v2.16.0）+ §7.8 已有"个股有 entry 未入册 → BLOCK"（v2.27.0）→ v2.38.0 同步加 watchlist 软提示："L2+ verdict=wait/hold/avoid 但 watchlist.stocks 无对应 entry → WARN（不 BLOCK，留给人工判断；但 5/28 翻车同款会被 advisor 终检捞到）"。当前 `quality_gate_check.py §7.13` 已用于 6 Agent 证据闸，勿复用编号。
>
> **为什么不机械 BLOCK**: 持仓股可豁免（§7.8 已豁免）+ 个股已有"可建仓"判断（verdict=buy）但用户尚未实际买入 = 系统无法判定"用户没买"，故 WARN 不 BLOCK。

---

## agent memory / MCP 写入（三地沉淀第三条腿）

> 投资本质: 三地沉淀(项目目录+Vault)解决"文件在哪"，agent memory/MCP 第三腿解决"下次 session 能不能找回这次判断"。
> 当前环境若没有 `create_entities/create_relations` 工具，不得假装 graph 已写入；必须把同等结构化内容落为 `_mcp_memory_graph_payload_YYYYMMDD.json` / `mcp_memory_payload_YYYYMMDD.json` 或 memory note，并在完成状态里标 `pending_tool_unavailable`。
> **不处理第三腿 = 下次 session 不知道这只股研究过什么。**

### 写入模板

研究完成后，**在 Completion Status 声明前**，先判断工具是否可用：

- 工具可用：执行以下 MCP 调用，并在 `_workflow_evidence_YYYYMMDD.md` 记录调用结果
- 工具不可用：生成同结构 payload 文件，顶层写 `status: pending_tool_unavailable` + `reason`，Completion 不得写 "MCP Memory Graph 已写入"

```
1. create_entities:
   - name: "{股票名}({代码})"    # 例: "拓荆科技(688072)"
   - entityType: "stock_research"
   - observations: (5-8 条，从 README.md 五维评分 + 深度研究.md 预期差提炼)
     • 研究日期+等级: "L3研究 2026-05-28: {一句话结论}"
     • 核心数据: "{PE/PB分位 + ROE + 营收增速 + 净利增速}"
     • 核心预期差: "{市场定价错误的1-2个关键点}"
     • 投资评级: "{强烈买入/有条件买入/观望/不建议} + 建仓价 + 仓位建议"
     • 主要风险: "{1-2条最大风险}"
     • 催化剂: "{最近1-2个催化剂事件+时间}"
     • 文件路径: "auto_research/knowledge/stock_research/{股票名}-{代码}/"

2. create_relations (如行业 entity 已存在):
   - from: "{股票名}({代码})"
   - to: "{行业名}行业"
   - relationType: "belongs_to_industry"

3. add_observations (增量更新时):
   - entityName: "{股票名}({代码})"
   - observations: ["L3更新 2026-MM-DD: {变化的核心结论}"]
```

### 增量更新规则
- entity 已存在 → 用 `search_nodes` 确认 → `add_observations` 追加新结论
- 禁止重复 `create_entities` 同一标的（会创建重复 node）
- 旧 observation 过时 → 不删，用新 observation 覆盖结论（时间戳区分）

---

## Completion Status Protocol

- **DONE** — 承重数字结算表落盘（非空壳，每行 ✅已结算/🔻已降级）且无 `❌未结算` cell（§承重数字结算清单）+ `[A]/[B]/[C]/[D]` 数据信心分级已落盘 + 相对时间已转绝对日期 + trigger expected_date 已规范化 + 五文件落盘且 L3 clean report pass 通过（主文无旧日期/旧价格/旧 action 口径混杂）+ Vault 同步后源端/Vault SHA256 逐文件一致 + Quality Gate 全部通过（脚本非 BLOCKED）+ 映射桥已更新 + triggers/watchlist 已结算 + agent memory/MCP 第三腿已真实写入或明确 payload pending
- **DONE_WITH_CONCERNS** — 已完成，但存在问题（列出具体问题）
- **BLOCKED** — 无法继续，附原因和已尝试方案
- **NEEDS_CONTEXT** — 缺少关键信息，附推荐用户操作

### 3-Strike Rule
同一数据源连续 3 次获取失败 → 降级。所有数据源耗尽 → BLOCKED 上报。

---

## Anti-Patterns（禁止行为）

- **禁止直接调用 API 不入库** — 必须走 `collect-data` 的 DB-First 流程
- **禁止无引用的事实陈述** — "市场普遍认为..." 必须给出至少 2 个具体来源
- **禁止研究做完不更新映射桥** — L2+ 研究完成后必须更新 `portfolio_research_bridge.md`。研究结论不连接到持仓操作 = 研究白做
- **禁止用推断伪装猜测** — 信息不足时承认，不要假装确定
- **禁止只输出聊天不落盘** — 违反三地沉淀黄金法则
- **禁止相对时间** — "最近"、"上季度" → 必须写 "YYYY-MM-DD"
- **禁止在更新模式下重写全部文件** — 只改变化部分
- **禁止投资建议伪装成研究结论** — 必须声明不构成投资建议
- **禁止"市场低估了/高估了"式废话** — 必须说出：市场估值隐含的假设链是什么？你与市场的参数差异是什么？差距多大？哪个方向？
- **禁止默认悲观结论**（v2.10 新增） — "不建议建仓"不能是研究的标准结局。Debate 中 Bull/Bear 条件案例论据对等；但条件 upside、卖方 Base 值或 provisional sensitivity EV 都不能绕过独立 action/portfolio-risk/approval/execution 闸。
- **禁止只有"等 XX 元"没有机会成本分析**（v2.10 新增） — 必须给出条件目标价/CAGR、定性到价可能性和等不到的 Plan B；数值 expected return 只有 return artifact 可给，withheld 时保持 null。
- **禁止跳过反向论证（L3）** — 多空论点都必须有，空头和多头至少各 3 条。只会写空头或只会写多头 = 没研究透
- **禁止持有但不复盘** — 月度复盘 5 问不做，等于开车不看仪表盘
- **禁止跳过本地 KB 三路搜索 + 东财采集** — A 股 L2+ 研究必须：(1) 用 `common.report_search.search_reports/search_by_stock/get_report_content` 搜中文名+代码+英文名并读正文；(2) `research_report_collector.py --code {代码} --top-only`。少任一步 = 研究不完整
- **禁止将中间来源数字当事实** — 券商研报里的 EPS 预测是分析师的推断，不是你的事实。引用中间来源时必须标注 `[推断]`+`[C]`，而非 `[事实]`+`[A]`
- **禁止用 Grade D 数据** — 无法验证的数据宁可写 `--` 也不编一个估计值。虚假的精确比承认不知道更危险
- **禁止省略 A 股特供风险** — L2+ 研究必须包含政策风险和解禁风险两维。A 股最大的黑天鹅往往来自这两个方向
- **禁止只用关键词搜索忽略语义理解（v2.8.0）** — 研究读取先走 `common.report_search.search_reports()`，必要时再查向量/RAG结果。底层 store 旧关键词方法只能作修库/诊断，不作为 Codex 研究读取入口
- **禁止只用中文名搜本地研报** — 中文名 0 结果 ≠ 本地库没有。必须三路搜索（中文名 + 代码 + 英文名），搜到必须提取 PDF 内容。2026-05-19 应流股份教训：中文名搜 0 结果，但代码 603308 搜出 5 篇国际投行研报（MS/GS/UBS），其中 OCF 数据纠正了致命错误
- **禁止国际投行KB 0结果反复搜** — A股中盘股KB空是结构性问题（国际投行覆盖率有限），不是操作失误。三路搜索0结果后立即切东财API为主数据源，标注`[信息真空]`
- **禁止以国内券商评级作决策依据** — "10家券商全部买入评级"不代表共识看多，代表A股分析师不能发出售评级。将评级权重设为零，只看EPS预测序列和行业数据
- **禁止PDF content=0跳过不提取** — 国际投行PDF有全文但content字段为空时，必须`fitz.open().get_text()`即时阅读。研究完成后跑`pdf_content_extractor.py`回填（知识复利）
- **禁止只用静态PE做估值定论不跑TAM修正** — 当行业TAM在5年内增长4-12x时，今天"看起来很贵"的PE可能在3年后是便宜的。禁止不跑§3.5产业TAM增量映射就给"建议买入/卖出/持有"结论。2026-05-19教训：天孚PE 157x被静态框架判B+→TAM修正后应为A-；摩尔PS 111x判C+→修正后应为B
- **禁止跳过新闻情绪采集（L2+）** — 新闻情绪是市场在交易什么情绪的横截面快照。跳过此步骤等于少了一个市场温度计。极端情绪（>60%利好或<-40%利空）是反向指标信号，不能错过
- **禁止串行执行深度分析（L2+）** — 6 个 Agent 必须并行启动（run_in_background=True），不是顺序跑。串行浪费 2-3h 用户等待时间
- **禁止无溯源的结论**（v2.11 新增——对标 BettaFish engineQuote） — 深度研究.md 和 README.md 中所有关键结论必须标注 [A1]-[A6] 来源 Agent。Conductor 综合时必须注明采纳/拒绝某个 Agent 判断的理由。"我认为""综合来看"但没有 Agent 溯源的结论 = 不可审计 = 不可信
- **禁止跳过强制自省**（v2.11 新增） — 每个 Agent 必须回答三问：缺少什么证据？什么证据会改变我的判断？我最可能错在哪？跳过自省 = Agent 不承认知识边界 = 分析不可信
- **禁止研究置信度 <5 驱动仓位决策**（v2.11 新增） — 五维加权评分 <5 (REJECT) 的研究，不驱动任何仓位决策。5-7 (PROVISIONAL) 仅可小仓位试探
- **禁止新研究不回溯上次预测** — 每次研究同一股票必须先读跟踪框架 §八的预测记录，逐条对比实际结果。不回溯 = 无法量化自己的判断质量 = 不知道自己在哪些维度系统性偏差

---

## 已知限制与绕过方案

### 1. Worktree 隔离导致知识库 DB/JSON 不可见

**现象**: EnterWorktree 后，`data_platform/tushare_data_v1.0.db`(12GB) 和 `auto_research/knowledge/research_reports/*.json` 是 untracked 文件，不出现在 worktree 中。且 `sys.path.insert(0, '.')` 在 worktree 下不可用（无 `common/` 模块）。

**绕过**: **所有 Bash 命令用主仓库绝对路径**：
```python
import sys; sys.path.insert(0, '{{QUANT_ROOT}}')
# 后续正常 import common.utils / common.report_search / ...
```
代码用 worktree 目录写，数据读写一律指向 `{{QUANT_ROOT}}/...`。

**投资本质**: worktree 隔离的是代码风险（改坏了能扔），知识库数据是 untracked 只读资产，不应该也不需要隔离。

### 2. Skill 文件 / MEMORY.md 被 Formatter Hook 持续修改导致竞态

**现象**: 读 skill.md/MEMORY.md 后立即 Edit，报 `File has been modified since read`。原因是 PostToolUse hook (black/ruff/mdformatter) 每次 Read 后重写文件。需重试 3-5 次才能成功一次。

**绕过**: (a) 多次重试 Edit 直到成功；(b) 用 Bash heredoc 直接写文件绕过 Edit 工具的文件锁。

### 3. 东财 API 正文覆盖率不稳定 + PDF回退路径（已修复 2026-05-19）

**原问题**: 东财 API `zwinfo.notice_content` 字段经常为空（通富微电121篇中72%有正文）。老报告（2017-2020）几乎全空。

**修复**: 新增 `fetch_report_pdf()` + `fetch_report_markdown()`：
1. 东财 API `fetch_report_content()` — 首选，70%覆盖率
2. **cloudscraper → PDF 下载 → pymupdf4llm.to_markdown()** — 正文质量最高（Markdown/表格保留），已验证通富微电 33 篇 PDF 成功提取
3. Web 搜索同名报告 — 兜底

**依赖**: `pip install cloudscraper pymupdf4llm`（已安装）

### 4. 国际投行 A 股覆盖率结构性空白 (v2.4.0 新增)

**现象**: Zsxq 502篇国际投行报告主要覆盖港股+美股+A股少数龙头。A股中盘股大概率KB全空。这不是采集问题，是覆盖率的客观限制。

**当前解法**: 三路搜索0结果后立即切东财API为主数据源，标注`[信息真空] 国际投行无独立覆盖`。信息真空本身是信号——机构不去的地方=你的机会。

### 5. 国内券商评级100%看多是合规现象，非真实观点分布 (v2.4.0 新增)

**现象**: 东财API所有报告评级均为买入/增持/推荐（零卖出/中性）。这不是分析师真全看多，是A股卖方合规不允许发出售。

**当前解法**: 评级权重设为零。仅引用券商的结构化数据（EPS预测/行业数据）和事实分析，禁止用"X家券商买入"作为看好理由。

### 6. MEMORY.md 索引条目快速增长

**现象**: 每次研究新增1条目，50+条目后接近200行上限。条目超过200行会触发系统裁剪。

**当前解法**: 每个研究项目一个project memory文件+YAML frontmatter。MEMORY.md只放一行索引。后续考虑按行业/板块分组。

### 7. 股票代码后缀一致性（已修复 2026-05-19）

**原问题**: 东财入库 `stock_code='603986'`（裸代码），Zsxq 入库 `stock_code='603986.SH'`（带后缀），导致 `list_by_stock` 漏匹配。

**修复**: (a) `ingest_from_collector()` 自动补齐 `.SH/.SZ` 后缀；(b) `list_by_stock()` 同时查询裸代码 + `.SH` + `.SZ` 三种变体；(c) `search()` 已包含 `stock_code` 字段所以天然免疫。

### 8. ResearchReportStore 双实现漂移（已修复 2026-05-19）

**原问题**: `knowledge_base.py` 和 `research_report_store.py` 各自独立实现同一个类，方法不同步。

**现状态**: `knowledge_base.ResearchReportStore` 继承 `research_report_store.ResearchReportStore`，只追加 Viking 索引和 `batch_ingest`。两个 import 路径同一实现。

---

## Skill Stack — 不重复造轮子

| 能力 | 委托给 | 说明 |
|------|--------|------|
| 本地财务/行情数据采集 | `collect-data` | DB-First：先入库再使用 |
| **本地研报知识库（优先）** | `common.report_search` | 13,612条（2026-06-05 实数, 东财+zsxq+talks），读取入口为 `search_reports/search_by_stock/get_report_content`，底层 RRS/FTS/Tushare fallback 对 Conductor 隔离，先搜本地再 Web |
| **RAG 向量检索引擎** | `report_vector_search.py` | DashScope text-embedding-v4 云端 1024维（2026-06-05 迁移, 需 DASHSCOPE_API_KEY, 本地零模型内存）+余弦相似度+RRF混合融合，跨语言概念检索；新研报查询时自动增量入索引；API 挂→FTS5 降级 |
| **东财研报API采集（A股L2+必跑）** | `research_report_collector.py` | A股个股研报列表+精确EPS+正文，支持断点续跑，见 §2.3 |
| 实时 Web 发现（研报/新闻/公告） | `exa-search` / `deep-research` | 紧耦合质量标准（见 §2.4），仅本地库不足时使用 |
| 股票代码/名称模糊搜索 | `alphaear-stock` | `search_ticker()` → `get_stock_price()` |
| A股实时行情/信号/资金面 | `a-stock-data` (simonlin1212, 1.3K★) | 7层28端点直连HTTP：行情(PE/PB/K线)、信号(北向/龙虎榜/解禁/题材归因)、资金面(两融/大宗/股东户数/分红)、新闻(东财/财联社)。零第三方依赖。用于Step 2快速采集+Agent 4风险扫描 |
| **新闻情绪自动采集（L2+必跑）** | LLM sentiment classification | 东财新闻 + LLM 三分类（利好/利空/中性），情绪偏离度信号 |
| **Multi-Agent 并行分析** | `Agent` 工具 (run_in_background) | 6 Agent 并行(≤300字) + Debate+Leader 辩论裁决+互评，30-60min |
| 知识存储层决策 | `knowledge-ops` | 6 层架构，去重，选择 canonical home |
| 报告文字润色 | `article-writing` | 去除 AI 腔，增强可读性 |

**规则**：本 Skill 只负责"研究编排、预期差挖掘、五文件结构模板、三地同步"，数据采集和持久化细节委托给上表 Skill。

---

## Related Skills

| Skill | 关系 | 调用时机 |
|-------|------|----------|
| `collect-data` | 数据源 | 所有本地财务/行情数据采集 |
| `common.report_search` | **核心读取入口** | 本地研报全文检索（优先于 Web 搜索），使用 `search_reports()`/`search_by_stock()`/`get_report_content()`；底层自动处理 FTS/主库 fallback |
| `ResearchReportStore` (research_report_store.py) | **存储层实现** | 仅在入库、`missing()`、`save()`、`auto_tag_from_titles()`、PDF 路径维护和修库时直接调用 |
| `research_report_collector.py` | **数据源** | 东财API（`fetch_reports` + `fetch_report_content`），A股L2+必跑，见 §2.3 |
| `hk_report_collector.py` | **数据源** | 港股 L2+/L3 标准研报分支；东财 `reportapi` 不适用时采 AAStocks + yfinance + 行情快照 |
| `zsxq_report_ingestor` (zsxq_collector.py) | **数据源** | 知识星球国际投行研报已入库（502篇，21机构） |
| `alphaear-stock` | 工具 | 股票代码/名称模糊搜索 |
| `exa-search` | 数据源 | Web 实时检索（研报/新闻/公告） |
| `deep-research` | 数据源 | 多源深度研究带引用 |
| `market-research` | 参考 | 市场研究与竞争分析 |
| `knowledge-ops` | 存储层 | 知识持久化与去重决策 |
| `article-writing` | 润色 | 报告文字去 AI 腔 |
| `neat-freak` | 维护 | 研究文件审查与清理 |
