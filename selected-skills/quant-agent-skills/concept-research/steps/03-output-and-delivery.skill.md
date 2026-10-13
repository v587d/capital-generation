---
name: concept-research-step-03-output-and-delivery
version: 1.1.0
description: |
  concept-research L3 Step 5：五文件输出 + 三地沉淀 + Vault同步 +
  Fresh Public Signal Sweep evidence + watchlist upsert + thesis triggers + Quality Gate。
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# Step 5: 五文件输出 + 三地沉淀 + Quality Gate

## 五文件输出

输出路径: `auto_research/knowledge/concept_research/{概念名}-{概念代码}/`

| 文件 | 内容 |
|------|------|
| `README.md` | 概念摘要、结论(WATCH/ACCUMULATE/TRADE/AVOID)、叙事阶段、龙头股列表、入场/止损区间、Agent溯源、数据时效 |
| `叙事生命周期.md` | 核心报告：叙事起源+催化剂链+生命周期阶段判定(量价+资金+叙事三维交叉验证)+成分股叙事关联度排名 |
| `成分股分析.md` | 成分股排名表(真龙/假龙/跟风标注)+量价数据+财务甄别(earnings_quality)+资金面全景(信号8表)+行业交叉 |
| `研报索引.md` | 国内外概念/龙头相关研报列表+公开信息证据矩阵摘要+核心观点提取+来源溯源 |
| `跟踪框架.md` | 概念跟踪指标+催化剂日历+龙头切换条件+退出信号+月度再评估触发 |

---

## README.md 模板

```markdown
# {概念名} ({概念代码})

> 研究日期: {日期} | 等级: L3 | 版本: v1.0

## 结论: {WATCH / ACCUMULATE / TRADE / AVOID}

**叙事阶段**: {形成期/加速期/扩散期/退潮期}
**信心等级**: {高/中/低}
**期望回报**: {三情景加权 EV}

## 一句话逻辑
{为什么这个概念现在值得关注/不值得}

## 公开信息快信号
| 日期 | 来源级别 | 事实 | 验证状态 | 投资含义 |
|------|----------|------|----------|----------|
| {日期} | {S0/S1/S2/S3} | {事实主张} | {已二次验证/待验证/降级} | {一阶影响/二阶替代/已反映} |

- 可承重事实: {只写 S0/S1 或已二次验证的 S2}
- 预期差分类: {BEAT/IN_LINE/MISS/AMBIGUOUS；IN_LINE 不自动升级 L3/交易}
- 降级线索: {S2/S3 lead，不进主结论}
- 下一次验证: {公告/价格/客户认证/财报/海关数据日期}

## 龙头股

| 排名 | 股票 | 代码 | 龙头类型 | 20日涨幅 | 基本面 | 建议 |
|------|------|------|---------|---------|--------|------|
| 1 | {股1} | {码1} | 真龙 | +X% | secular_growth | ACCUMULATE |
| 2 | {股2} | {码2} | 跟风 | +X% | cyclical | WATCH |

## 入场/止损
- **入场区间**: ¥{X}-{Y} (基于{龙头股})
- **止损**: ¥{Z} ({触发条件})
- **仓位上限**: {X}%

## 催化剂日历
| 日期 | 事件 | 预期差/影响 | 确定性 |
|------|------|-------------|--------|
| {日期1} | {事件1} | {pre_event_expectation / delta_class / action_boundary} | {高/中/低} |

每个催化剂必须写 `pre_event_expectation`、`priced_in_view`、`actual_disclosure`、`delta_class`、`action_boundary`；只披露但 `IN_LINE` 的事件不能进入入场线、目标价或 trigger。

## 数据来源时效
- concept_daily 最新: {日期}
- 公开信息最新: {日期}
- 研报最新: {日期}
- 信号面最新: {日期}

## Agent 溯源
- narrative-agent: {核心发现摘要}
- quant-agent: {核心发现摘要}
- stock-picker-agent: {核心发现摘要}
- risk-agent: {核心发现摘要}
- Leader 裁决: {最终判定}
```

---

## 三地沉淀 + Vault 同步验证（Step 5 强制 checklist）

**跳步=研究未完成。Vault 同步必须验证返回值。**

```
□ 1. 项目目录: auto_research/knowledge/concept_research/{概念名}-{代码}/ 五文件存在
□ 1.5 公开信息证据矩阵: _public_signal_matrix_YYYYMMDD.{md,json} 已落盘或内嵌，README/研报索引已区分 S0/S1/S2/S3 和降级线索
□ 2. Vault 同步: 跑脚本并保留输出证据
    python scripts/sync_concept_research_to_vault.py \
      "auto_research/knowledge/concept_research/{概念名}-{代码}" \
      --manifest-date YYYYMMDD --json
    要求: all_required_ok=true, all_file_sha_match=true, manifest_sha_match=true, ok=true
    产物: _vault_sync_manifest_YYYYMMDD.json 同时存在于项目目录和 Vault 目录
□ 3. Memory 索引: MEMORY.md 或 MCP memory payload 新增 "{概念名}概念L3研究" 条目
    条目格式: "- [{概念名}({代码}) L3研究](project_{slug}_concept_research.md) — {一句话结论}/{阶段}/{龙头}/{结论}/期望{EV}/{日期}"
□ 4. Memory 文件: memory/project_{slug}_concept_research.md 创建
    内容: 研究结论摘要+龙头列表+入场止损+催化剂+与stock-research的衔接
□ 5. MCP memory/graph 不可用时: 写 _mcp_memory_graph_payload_YYYYMMDD.json，标 pending_tool_unavailable，不得冒充已入图
```

**如果 Vault 同步失败**: 不要继续下一步。先看脚本返回的缺文件、短文件、SHA 不一致或 iCloud 未落盘原因，修完重跑。

---

## watchlist 关注池 upsert

```python
# 构造概念研究 entry → 落盘 → upsert
# 概念级 entry 只表达概念/主题跟踪结论；个股条目必须另建 stock-research 口径 JSON

# 1. 落盘 entry 文件（留痕）
# 写入 {概念目录}/watchlist_entry.json

# 2. 行业级 upsert（概念归入哪个行业方向）
# python scripts/watchlist_upsert.py --entry-file "auto_research/knowledge/concept_research/{概念名}-{代码}/watchlist_entry.json"

# 3. 个股级 upsert（龙头股单独入册）
# 不要把同一个概念级 JSON 传给 --stock-entry-file。
# 龙头股若要入 stocks[]，必须为每只股票生成 stock-research 口径 stock entry。
# python scripts/watchlist_upsert.py --stock-entry-file "{股票研究目录}/watchlist_entry.json"

# 4. 刷新 bridge
# python scripts/generate_bridge.py
```

---

## thesis triggers 灌库

```python
# 从概念研究的催化剂日历 + 入场/止损条件 → triggers
# 构造 triggers_entry.json → 灌入 research_verdicts.json + catalyst_events

# python scripts/thesis_triggers_upsert.py --stock-entry-file "{概念目录}/triggers_entry.json"

# trigger 格式:
# - catalyst: 催化剂事件 → re_research
# - entry: 入场条件触发 → execute_trade:add
# - stop: 止损条件触发 → trim_stop
# - watch: 观察指标变化 → watch
```

---

## Quality Gate

概念研究的 Quality Gate 检查清单（对标 stock-research 的 quality_gate_check.py）：

| 检查项 | 权重 | 标准 |
|--------|------|------|
| 五文件完整 | 20分 | 五文件全部存在且非空 |
| 叙事阶段有证据 | 15分 | 阶段判定有量价+资金+叙事三维交叉验证 |
| 成分股甄别 | 15分 | 龙头有真龙/假龙标注 + earnings_quality 支撑 |
| 研报引用 | 10分 | 至少3篇研报引用（含国际投行≥1篇） |
| 入场/止损明确 | 10分 | 有具体价格区间和触发条件 |
| 催化剂日历 | 10分 | 有明确日期+事件+确定性标注 |
| 三地沉淀 | 10分 | Vault manifest SHA ✅ + memory 索引/graph payload |
| watchlist入册 | 5分 | 概念级 watchlist 已入册；个股入册需独立 stock entry |
| triggers灌库 | 5分 | 催化剂已灌 catalyst_events |

**总分 ≥ 70 = PASS, < 70 = BLOCKED**

**公开信息硬闸**：若 L2/L3 是事件驱动或新闻驱动概念，但没有 `_public_signal_matrix_YYYYMMDD`，或把未验证 S2/S3 写进主结论、入场线、目标价、trigger，直接 BLOCKED，不用进入打分。若公告/财报/客户认证/订单/政策披露没有 `BEAT/IN_LINE/MISS/AMBIGUOUS` 预期差分类，或把 `IN_LINE` 写成升级/买入触发，也直接 BLOCKED。

---

## 与 stock-research 的衔接（Step 5 收尾）

```markdown
## 后续动作建议

### 需要调 /stock-research 做 L3 深挖的标的:
1. {股票1}({代码}) — 理由: {概念内最佳载体, 基本面+量价+资金面综合评分最高}
2. {股票2}({代码}) — 理由: ...

### 已有 stock-research 研究的标的:
1. {股票X}({代码}) — 引用已有结论: {一句话}

### 不需要个股 L3 的标的:
1. {假龙1} — 理由: {纯叙事炒作, 无业绩支撑}
```
