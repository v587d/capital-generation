---
name: industry-research-step-03-output
description: |
  industry-research Step 5+Zsxq：五文件输出 + 三地沉淀 + Vault同步验证 +
  Fresh Public Signal Sweep 证据矩阵 + Zsxq国际投行研报多关键词轮询 + Quality Gate。
metadata:
  version: 1.5.2
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# Step 5: 五文件输出 + 三地沉淀 + 国际投行检索

## 五文件输出

输出路径: `auto_research/knowledge/industry_research/{行业名}/`

| 文件 | 内容 |
|------|------|
| `README.md` | 研究摘要、配置建议、Agent溯源、数据时效性、公开快信号结论 |
| `深度研究.md` | 完整研究报告（产业链/竞争格局/估值/催化剂/风险） |
| `数据手册.md` | 行业关键指标（市值/PE/ROE/增速/集中度）+ 量化信号 |
| `研报索引.md` | 国内外行业研报列表 + 核心观点提取 + 公开信息与研报冲突记录 |
| `跟踪框架.md` | 景气度跟踪指标 + 关键催化剂日历 + 月度/季度再评估触发条件 |

伴随证据文件：

| 文件 | 内容 |
|------|------|
| `_public_signal_matrix_YYYYMMDD.md` | 公开信息快信号证据矩阵，人读版本 |
| `_public_signal_matrix_YYYYMMDD.json` | 公开信息快信号证据矩阵，机器读版本 |

---

## 三地沉淀 + Vault 同步验证（Step 5 强制 checklist）

**跳步=研究未完成。Vault 同步必须验证返回值。**

```
□ 1. 项目目录: auto_research/knowledge/industry_research/{行业名}/ 五文件存在
□ 1.5 公开信息矩阵: 事件/政策/供应链驱动 L2/L3 必须有 `_public_signal_matrix_YYYYMMDD.{md,json}`；不适用必须写理由
□ 2. Vault 同步: obsidian_bridge.vault_write 每个文件到 研究参考/行业研究/{行业名}/
    逐文件验证: README.md → □✅/□❌  深度研究.md → □✅/□❌
                数据手册.md → □✅/□❌  研报索引.md → □✅/□❌
                跟踪框架.md → □✅/□❌
    要求: 5/5 ✅ = PASS, 任一 ❌ = 阻塞，先修再继续
    若目录含 `_agent_outputs_*.json`、`_workflow_evidence_*.json`、情景模型 `.py` 或其他机器证据:
      必须跑目录级 SHA manifest，同步 `.md/.json/.py` 并证明 source/vault 全量一致。
      推荐命令:
        python scripts/sync_research_dir_to_vault.py industry "auto_research/knowledge/industry_research/{行业名}" --json
      该命令是行业 L3 的目录级入口；不要用 stock/concept 专用 sync 脚本替代行业目录。
□ 3. Memory 索引: MEMORY.md 新增 "{行业名}行业L2深度研究" 条目
□ 4. MCP Memory Graph: create_entities 写入行业实体 + create_relations 关联已研究个股
    调用模板见下方 §MCP Memory Graph 写入
    如果当前平台没有 create_entities/create_relations 工具:
      写 `_mcp_memory_graph_payload_YYYYMMDD.json`，status=`pending_tool_unavailable`，
      记录本次 L3 结论、subject_id、watchlist entry、核心标的和 Vault manifest SHA；
      不得在 README 或 final summary 里冒充 graph 已写入。
□ 5. 关注池 watchlist.json: 把本行业标的写入"未持仓关注池"SSoT(bridge 第五区数据源)
    动作: 构造行业 entry → 落盘 {行业目录}/watchlist_entry.json(留痕) → 跑 helper:
      python scripts/watchlist_upsert.py --entry-file "auto_research/knowledge/industry_research/{行业名}/watchlist_entry.json"
    entry 字段: name/level/date/allocation/expected_return/thesis/upgrade_trigger/
      review_date/research_path + stocks[].{code,name,market,action,trigger,note}
    helper 自动保证: ①upsert-by-行业名整条替换(L3刷新不冒重复) ②已持仓标的查
      portfolio_state 锁 action=已持仓(不复活买入, 防与持仓SSoT对账打架)
    完成后: python scripts/generate_bridge.py 刷新 bridge 第五区
□ 6. 主题闭环: subject_entry.json 必须写入 research_subjects.json，并同步主题触发器:
      python scripts/research_subject_upsert.py --entry-file "auto_research/knowledge/industry_research/{行业名}/subject_entry.json" --json
      python scripts/theme_triggers_upsert.py --entry-file "auto_research/knowledge/industry_research/{行业名}/subject_entry.json" --json
      python scripts/build_research_loop_board.py --scope subject --subject-id <subject_id> --json
    行业主题只能输出 MONITOR_THEME / PROMOTE_STOCK_L3 / REBALANCE_REVIEW / RISK_REVIEW /
    STALE_REFRESH / COOLDOWN 等研究动作；不得直接生成目标价、入场价或交易仓位。
```

**如果 Vault 同步失败**: 不要继续下一步。先检查 Obsidian CLI 是否可用 (`obsidian --version`)。
**如果 vault_write 返回 False**: 文件已写入 staging 区，手动从 staging 移入 Vault。

### Quality Gate 格式清单（L2/L3 定稿前自检）

`quality_gate_check.py` 只能机械检查部分格式。定稿前必须人工确认：

| 项 | 要求 |
|---|---|
| 建仓参数 | README 必须有可被 scanner 解析的 `## 建仓参数`；无交易计划写“不建仓观察/0% 新增资金/WAIT_EVENT 或 MONITOR_THEME” |
| 承重数字 | `深度研究.md` 必须有承重数字结算表，状态只用 `✅已结算` / `🔻已降级` / `❌未结算` |
| TAM/规模 | 小市场或副产品主题必须把“市场空间 vs 可投资利润弹性”分开，不能把全球缺口直接映射成 A/H 利润 |
| 候选标的 | 生产商、加工/材料、下游应用和 cross-read 公司分层；下游公司不能冒充上游产能暴露 |
| 主题闭环 | `subject_entry.json` → `research_subject_upsert.py`，`watchlist_entry.json` → `watchlist_upsert.py --entry-file`，再跑 `generate_bridge.py` |
| 行动语义 | 行业/主题只能输出 `MONITOR_THEME` / `PROMOTE_STOCK_L3` / `WAIT_EVENT` 等研究动作；没有个股 L3 前 `current_new_money_pct=0` |

收尾清扫不要用会误伤负面上下文的裸 grep。推荐先避免在正文写裸 `BUY_NOW` / `ADD_NOW` / `TRADE_PLAN_READY` 等交易动作词；必须说明时写成自然中文“不是现买信号”。如果做机器扫描，应检查语义上下文，而不是把“不是 XXX”计为违规。

---

## Fresh Public Signal Sweep Closeout

五文件定稿前必须把公开快信号结算掉：

| 检查 | 要求 |
|------|------|
| 矩阵存在 | 新闻、政策、出口管制、供应链、客户动作、材料替代、技术路线驱动的 L2/L3 必须有 `_public_signal_matrix_YYYYMMDD.{md,json}` |
| source tier | 每条信号必须标 `S0_OFFICIAL/S1_PRIMARY_MARKET/S2_CREDIBLE_MEDIA/S3_SOCIAL_RUMOR` |
| decision use | 只能是 `fact/scenario_weight/trigger_input/watch_item/lead_only/rejected` 等受控用途 |
| 预期差闸 | 公告/政策/价格/客户/产能/财报事件必须写 `pre_event_expectation`、`priced_in_view`、`actual_disclosure`、`delta_class=BEAT/IN_LINE/MISS/AMBIGUOUS`、`action_boundary`；`IN_LINE` 不得承载超配/核心标的升级 |
| 承重边界 | S2/S3 未验证信息不得承载配置建议、建议权重、核心标的名单、目标涨跌幅或 confirmed trigger |
| 冲突记录 | 与研报/DB 矛盾时写入 `研报索引.md` 或 `深度研究.md` 的冲突段，并给下一次验证 trigger |

缺矩阵、缺事件预期差分类，或把未验证 S2/S3 / `IN_LINE` 事件写成承重结论时，最终状态写 `BLOCKED: pending_public_signal_sweep` 或 `BLOCKED: pending_event_expectation_delta`，不得说 DONE。

---

## MCP Memory Graph 写入（三地沉淀第三条腿）

> 投资本质: 三地沉淀解决"文件在哪"，MCP memory graph 解决"知识关联"。
> SessionStart hook 自动从 graph 注入 → 跨 session 行业认知复利。

### 写入模板

```
1. create_entities:
   - name: "{行业名}行业"    # 例: "半导体行业"
   - entityType: "industry_research"
   - observations: (5-7 条)
     • 研究日期+等级: "L3行业研究 2026-MM-DD: {一句话结论}"
     • 配置建议: "{超配/中性/低配} {仓位比例} + 期望CAGR"
     • 核心驱动: "{行业景气的2-3个关键因子}"
     • TAM/增速: "{行业规模 + 增速预期}"
     • 核心标的: "{推荐的3-5只个股+建仓价}"
     • 主要风险: "{1-2条行业级风险}"
     • 文件路径: "auto_research/knowledge/industry_research/{行业名}/"

2. create_relations (关联已研究的个股):
   - from: "{股票名}({代码})"  to: "{行业名}行业"  relationType: "belongs_to_industry"

3. add_observations (增量更新时):
   - entityName: "{行业名}行业"
   - observations: ["更新 2026-MM-DD: {变化的核心结论}"]
```

### 增量更新规则
- entity 已存在 → `search_nodes` 确认 → `add_observations` 追加
- 禁止重复 `create_entities` 同一行业
- 新研究个股 → `create_entities` 个股 + `create_relations` 关联行业

---

## Zsxq 国际投行报告多关键词轮询

护城河数据源: 2053 篇国际投行研报（Goldman Sachs 580 + UBS 430 + Morgan Stanley 259 + J.P. Morgan 203 + Bernstein 185 + Nomura 125 + BofA Securities 51），SQLite FTS5 全文索引驱动。

### 必须使用的场景
- L2/L3 研究必须引用至少 3 篇国际投行行业报告
- 估值比较 Agent 必须至少 1 家国际可比公司
- 产业链 Agent 必须覆盖全球价值链（不仅是A股视角）

### 3 组关键词轮询（简化版）

```python
store = ResearchReportStore()
store.auto_tag_from_titles()

keyword_groups = [
    "{行业英文} OR {行业英文变体1} OR {行业英文变体2}",
    "\"China {行业英文}\" OR {龙头1英文} OR {龙头2英文}",
    "{上游关键词} OR {下游关键词} OR {技术关键词}",
]

all_intl = {}
for i, kw_group in enumerate(keyword_groups):
    results = store.fts_search(kw_group, source='zsxq', limit=20, with_content=True)  # 🛑 with_content必传,否则只返元数据不含正文(2026-05-29根治)
    print(f"  关键词组{i+1}: {len(results)} 篇")
    for r in results:
        all_intl[r['info_code']] = r

print(f"3组关键词去重: {len(all_intl)} 篇")
```

### 其他搜索方式
```python
# FTS5 直接搜索
results = store.fts_search("{行业英文} outlook OR strategy", source='zsxq', limit=20, with_content=True)  # 🛑 with_content必传

# 语义搜索（跨语言，模型不可用时自动降级 FTS5）
results = store.semantic_search("{行业名} 行业展望 产业链 竞争格局", top_k=10)

# 按机构定向搜索
gs_reports = store.fts_search("{行业英文}", source='zsxq', org_name='Goldman Sachs', limit=10, with_content=True)
ms_reports = store.fts_search("{行业英文}", source='zsxq', org_name='Morgan Stanley', limit=10, with_content=True)
```

---

## 🛑 承重数字结算清单（declaring done 前强制必跑——v1.4 与 stock-research v2.22 同源）

> 行业研究的承重数字（thesis 缺它就垮的）= **TAM/市场规模、行业增速、龙头市占率/集中度、景气度指标、期望CAGR、渗透率**。这些脑补一个，整篇"超配/中性/低配"的配置结论和期望值就歪。与个股同病同治：检查靠自觉 = 运气依赖，必须落盘一张**机器可校验的表**，由 `quality_gate_check.py §7.6` BLOCK 强制（缺表 / 有 `❌未结算` / 空壳表 → BLOCKED，**仅对 industry_research + stock_research 目录生效**）。
>
> **⚠️ gate 拦什么、拦不住什么（别过度信）**：能机械拦的只有 ①没落盘表 ②自报 `❌未结算` ③空壳表。**拦不住把脑补的 TAM/增速自信标成 ✅**（脚本不查数据源，分不出真✅和编的✅）。防伪造靠：真去查 DB/研报正文/第三方数据商拿到可复查的数 + advisor 终检 + 出处可被复查者查到同一个数。

在 `深度研究.md` 写入这张表——把"超配/中性/低配"判断、期望CAGR、核心标的建仓价**依赖的每个承重数字**逐行结算：

```markdown
## 承重数字结算表

| 承重数字 | 用在哪(配置/期望值/标的) | 出处类型 | 具体定位(机构/页码/公式) | 验证状态 |
|---|---|---|---|---|
| 行业TAM 2030=$4.6亿 | "奖品又小又远"低配判断 | 研报 | Yole 2026玻璃基板报告 p.X | ✅已结算 |
| 行业增速 +30%CAGR | 期望值/景气 | 研报多源 | GS+Nomura 两家交叉 | ✅已结算 |
| 龙头市占率 80% | 集中度/竞争格局 | 第三方 | 卓创/百川数据 | ✅已结算 |
| ~~CPO玻璃¥1200亿~~ | (已删)公司自报无第三方 | — | 答不出→改定性"公司宣称" | 🔻已降级 |
| 期望CAGR -11.3% | verdict 承重 | 公式 | 三情景概率×回报手算 | ✅已结算 |
```

**验证状态受控词表（机器校验，只认这三个 emoji）**：
- `✅已结算` — 有真出处且已核实（研报正文真读到 / ≥2 独立机构或第三方数据商交叉 / 公式两端各有出处）
- `🔻已降级` — 答不出出处，**已从承重位拿掉**（删除 / 改"公司宣称"定性 / 显式标 illustrative）
- `❌未结算` — 还答不出出处却仍占承重位 → **Quality Gate 见此即 BLOCKED**

> 红旗口诀：**"我手里这个带小数点的行业数（TAM/增速/份额），从哪个机构/页码/公式来？答不出，就是我编的。"**
> 关联记忆：[[feedback_load_bearing_numbers_settle]]。

---

## Quality Gate 校验

五文件落盘后运行质量门：

```python
import sys; sys.path.insert(0, '{{QUANT_ROOT}}')
from auto_research.quality_gate_check import check_study_dir

result = check_study_dir('auto_research/knowledge/industry_research/{行业名}')
print(f"质量门: {result['total_score']}分 → {result['verdict']}")
for dim, score in result['dimensions'].items():
    print(f"  {dim}: {score}")
```

**通过标准**: ≥70分 PASS / 50-69 WARN / <50 BLOCKED（行业研究标准比个股低15分，因数据可得性差异）
