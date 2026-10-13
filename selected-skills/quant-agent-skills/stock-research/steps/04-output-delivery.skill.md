---
name: stock-research-step-04-output-delivery
version: 2.18.0
description: |
  stock-research 第 4-5.5 步：五文件结构化输出模板 + 双地持久化 + 持仓-研究映射桥。
  包含 README.md、深度研究.md、财务数据.md、研报索引.md、跟踪框架.md 的完整模板。
  Conductor 在进入输出阶段时加载此文件。
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

## 第 4 步：五文件结构化输出

目录：`auto_research/knowledge/stock_research/{股票名}-{代码}/`

**文件名硬闸（2026-06-21 天岳先进复盘）**：股票 L3 的五文件必须包含
`财务数据.md`。`数据手册.md` 可以作为附加资料，但不能替代 `财务数据.md`；
`quality_gate_check.py` 可能因兼容行业包而放行 `数据手册.md`，但
`scripts/sync_stock_research_to_vault.py` 会按股票五文件精确文件名阻断。

### 因果盈利机读证据合同（L2+/L3）

只读 `_stock_earnings_model_YYYYMMDD.json` 作为 §7.15 的盈利因果机读证据。
Markdown 不得替代机读证据；手填三情景 EPS 不得替代机读证据。
`_scenario_probability_*` 只保留为 legacy history，不得替代盈利因果证据或当前收益概率。

输出 reader 文件前必须从同一份 dated JSON 读取并引用：
- 身份：`schema_version`、`ts_code`、`as_of_date`、`target_year`、
  `model_run_id`、`input_hash`；
- 状态：`activation_status=activated|soft_fallback`；fallback 还必须保留 `[C]`、
  `fallback_reason`、非空 `missing_inputs` 和已取得 provenance；
- activated：bull/base/bear 各自的 `assumptions`、`source_identifiers`（来源 ID、
  日期、单位、content hash）、`operands`、`audit_chain`、`earnings_uplift` 和
  `derived_eps`，以及只含 tier/band/judgment_basis 的 `probability_qualitative`。

README/深度研究引用 EPS 时必须能回指 `model_run_id + input_hash + scenario`；
若是 soft_fallback，Bull/Base/Bear 只能写无概率的条件案例 [C]，不得获得模型分
或生成交易动作。之后必须读取 `_return_distribution_YYYYMMDD.json`：withheld 时
`numeric probability = null`，写 reason，不得恢复手工权重，不生成正式概率加权 EV。

### 🛑 L3 clean report pass（v2.18.0 / 2026-06-11）

L3 刷新不是“在旧报告顶部贴一段增量结论”。最终交付给用户和下一个 agent 的五文件主文必须从第一屏到结尾都是同一研究日、同一当前价、同一 verdict/action、同一套 trigger 的**当前版本**。

**允许保留历史，但必须隔离**：
- 旧研究日、旧当前价、旧三情景、旧 action 只能进入 `历史版本摘要.md`，或主文中明确标为“历史记录/非当前口径”的短段；
- `README.md`、`深度研究.md`、`财务数据.md`、`研报索引.md`、`跟踪框架.md` 的主叙事不得继续混入旧口径；
- 如果读者打开文件中段还会看到旧价格/旧结论并误以为当前判断，说明 clean report pass 失败。

**执行要求**：
1. L3 刷新后优先生成/重写当前五文件主文，而不是只追加增量块；
2. 建一个 `历史版本摘要.md` 保存旧版 1-2 段摘要和口径变更；
3. 声明完成前搜索旧日期、旧价格、旧 verdict/action、旧建仓说明；
4. 主文承重段有残留则重写/归档，再跑 `quality_gate_check.py` 和 Vault SHA。

### 文件 1：README.md — 索引

```markdown
# {股票名} ({代码}) 个股研究

> **研究等级**: L1/L2/L3 | **行业**: {行业} | **上市**: {日期} {板块}
> **研究日期**: YYYY-MM-DD | **更新频率**: 季度财报后 + 重大行业事件

## 文件索引
| 文件 | 内容 |
|------|------|
| [深度研究.md] | 投资逻辑、预期差挖掘、三情景框架、多源交叉验证 |
| [财务数据.md] | 关键财务指标、估值快照、券商盈利预测 |
| [研报索引.md] | 国内外研报清单及核心摘要 |
| [跟踪框架.md] | KTI 指标、催化剂日历、预警阈值、减仓触发条件 |

## 一句话投资逻辑
{1-2 句话}

## 条件估值与收益分布快照 (YYYY-MM-DD)

| 条件案例 | 条件 CAGR | 条件目标价 | 成立条件 |
|------|---------|----------|----------|
| 🟢 Bull | +X% | X元 | ... |
| 🟡 Base | +X% | X元 | ... |
| 🔴 Bear | -X% | X元 | ... |

收益概率另列 exact artifact filename/SHA、`publication_stage`、24个月 settlement，
以及从 artifact 原样复制的 `loss/below_hurdle/hurdle_pass` 与 tail；withheld 全写 null。

## 研究置信度（v2.12 改进——Debate Agent 外部评分替代自评）

| 维度 | 评分(0-10) | 权重 | 说明 |
|------|-----------|------|------|
| 数据完整性 | X | 30% | 数据缺口在哪？ |
| 多源交叉验证 | X | 30% | ≥2 独立源验证的结论占比？ |
| 预测可验证性 | X | 25% | 催化剂能否在 12 月内验证？ |
| 预期差清晰度 | X | 15% | 市场共识量化+参数差异清晰？ |
| **加权总分** | — | — | **≥7=PASS, 5-7=PROVISIONAL, <5=REJECT** |

**评分来源**: Debate+Leader Agent 在裁决时对各 Agent 输出的外部评估（不是 Agent 自评）。
- ≥7 (PASS): 六维全过，结论可驱动仓位决策
- 5-7 (PROVISIONAL): 有数据缺口但方向明确，可小仓位试探
- <5 (REJECT): 数据或验证不足，不驱动任何仓位决策

## 与市场的核心分歧
- 市场定价了什么: {量化描述}
- 你与市场最大的差异: {你最乐观/悲观的 1-2 个参数}
- 与卖方核心分歧: {GS/MS/CICC 为什么和你想的不一样}

## Agent 质量报告（v2.12——Debate+Leader 外部评估）
- 各 Agent 证据/逻辑/贡献评分（由 Debate+Leader 评定，非自评）
- 评分最低的 Agent: [AX] X.X/10 — 该维度在结论中降权
- Debate 最大分歧点（Bull vs Bear）: ...
- Conductor 采纳/拒绝的关键判断: ...

## 核心结论
- **24个月收益概率状态**: artifact stage + decision buckets/tail；withheld 时 numeric fields=null
- **研究置信度**: X.X/10 (PASS/PROVISIONAL/REJECT)
- **最优建仓价位**: YY 元 → 期望 CAGR ZZ%
- **等到最优价位的可能性**: 高/中/低（判断依据：历史波动率+催化剂时间线）| **等不到的 Plan B**: ...
- **最大风险**: ...
- **建议行动**: 建仓 X% / 小仓位观察 / 不建仓设提醒

## 建仓参数
<!-- 此表格为价格扫描器(price_alert_scanner)提供结构化数据，每晚20:00建仓条件日报扫描。
     【所有结论类型必填，不只 buy 类】缺失或不可解析: buy类 → gate §9 直接 BLOCK;
     hold类 → 日报落 Tier1 自由文本误判"有建仓意图但未提取到条件"(威胜陷阱)。
     勿删改列名; heading 必须含"建仓参数/建仓条件/建仓计划/建仓建议"(可带括号后缀) -->

| 参数 | 值 |
|------|-----|
| 建仓价格 | XX-YY元 (或 ≤XX元 / HK$XX-YY；hold 类写文本，见下方规范) |
| 建仓PE | ≤XXx (无PE条件填 N/A) |
| 建议仓位 | X-Y% |
| 止损价 | XX元 (或 N/A) |
| 备注 | 双闸/触发条件一句话 (可选) |

**建仓价格栏按结论类型填写（2026-06-04 规范，19只日报漏报+威胜陷阱复盘，memory: project-price-alert-hold-marker-fix）**:
- **等回调/有条件买入**（有价格闸）→ 写数字: `495-555元` / `≤102元` / `HK$22-28`。连接符用普通连字符或 en-dash –；斜杠/箭头(→)解析不了
- **持有不加/事件闸/不建仓观察**（无价格闸）→ 写文本说明: `持有不加(等8月中报)` / `不建仓观察(估值透支,等业绩兑现)` —— 扫描器识别为 hold marker，排除清单准确展示原因，不落噪声桶
- **向上突破闸**（"站上MA20≈¥51.6 再加"）→ 这是 ≥ 语义，**禁止编码成数字**（扫描器只支持 ≤ 回调语义，编码后天天误报"现价可建"）→ 写 hold 文本，数字可留在括号说明里
- ⚠️ **hold 文本禁带非% 数字区间**: "原建仓价22-24元但不加" 会被区间正则抢先提取 → 误入监控并⚡误触发（真实持仓案例教训）。写"区间见上文"。仓位百分比（如"试探≤3%"）安全——扫描器解析前已剥 % token
- ⚠️ **标准块只放 scanner 要消费的数值**（v2.40.11）：`建仓价格` 只写真实入场价/回调价；`建仓PE` 只写真实 PE 上限或 `N/A`。不要把 `A/H溢价<80%`、`光纤价格-25%`、`Q2净利20亿`、`毛利率45%` 这类百分比/利润触发写进 `建仓PE`，scanner 会把数字误读成 PE 条件。A/H 折溢价、财报门槛、thesis stop 放到 `triggers_entry.json`、`跟踪框架.md` 或 `备注` 文本里。
- 🛑 **scanner 扫的是 README 全文，不只是建仓参数块**（v2.43.2，2026-07-29 生益科技实证）：`_parse_standard_section(readme_text)` 对整篇 README 贪婪配对数字——"核心结论表里的入场区 98-108"+"财报闸 bullet 里的 OCF/NI<0.5" 会被拼成伪 `price_range{98.0, 0.5}` → `state_unknown` → gate BLOCK。WAIT_*/NO_NEW_MONEY 语义下 **README 全文零建仓数字**：入场区/价格闸/PE 线/止损价全部只放 `triggers_entry.json` + `跟踪框架.md`，README 任何位置都只写"见跟踪框架§X"指针。验收：`_parse_standard_section` 返回仅 `{"hold_text": ...}`。
- 🛑 **watchlist/trigger 数字线绑定契约**（v2.43.2）：watchlist `entry_zone` 文本里的数字区间会被 scanner 解析成条件，必须有**同类型+同端点**的结构化 trigger 绑定（`condition_type=price_range` + `price_low`/`price_high` 与文本端点逐一相等，容差 0.05，端点数量必须一致），否则 `state_unknown` fail-closed。`price_below 105` 绑定不了文本 "98-108元"（类型与端点数都不匹配）。WAIT_*/新钱=0 时 trigger action 只能 `re_research`/`watch`，绑定后 scanner 分桶为 re_research 而非新钱建仓。

## 数据来源
- 国际投行: ...
- 国内券商: ...
- 行业数据: ...
- 替代调研（L3）: ...
```

### 文件 2：深度研究.md — 投资逻辑 + 预期差

```markdown
# {股票名} ({代码}) 深度研究
*生成日期：YYYY-MM-DD | 研究等级：L2/L3 | 证据等级：见各节标注*

## 0.1 数据信心分级（L2+ 必填，quality_gate 前置硬闸）

> 不要等 `quality_gate_check.py` WARN 后再补。五文件初稿就必须让读者知道每类数字能承重到什么程度。

| 等级 | 定义 | 本文使用边界 |
|------|------|--------------|
| [A] | DB/API/公司公告/交易所/监管日历直接验证，字段非空且日期明确 | 可承重事实、当前持仓、历史财务、监管节点 |
| [B] | 本地研报正文、东财原文、多卖方交叉验证或行业数据库间接验证 | 可承重但需注明来源链，适合盈利预测/行业规模 |
| [C] | 分析师模型推断、三情景假设、市场隐含参数反推 | 只能承重“预测/判断”，必须写明假设 |
| [D] | 早期临床、草根信息、单源新闻、无法独立复核的辅助信息 | 不得承重核心 thesis，只能作观察线索 |

## 一、公司定位与商业模式
[事实] 产业链位置、商业模式、收入来源...
[推断] 竞争优势来源、壁垒可持续性...

## 二、行业周期定位
[事实] 多源数据（产能利用率、库存水位、资本开支周期、集中度变化）...
[推断] 周期位置的判断：底部/上升/顶部/下降，理由...

## 三、市场定价与你的判断差异（核心价值）
### 3.1 市场定价了什么？
[事实] 券商一致预期（具体数字+来源）...
[推断] 当前估值隐含的增长预期...
[预测:中] 市场共识的核心假设链...

### 3.2 你的判断与市场的参数差异
| 核心参数 | 市场隐含 | 你的判断 | 分歧方向 |
|---------|---------|---------|---------|
| 3年营收 CAGR | X% | Y% | 你更乐观/悲观 |
| 终端净利率 | X% | Y% | ... |
| 新业务 3 年后收入 | ~0 | X亿 | 你更乐观 |
| 合理 PE | Xx | Yx | ... |

**你与市场最大的分歧点**（这 1-2 个参数就是你的核心赌注）：
1. ...

### 3.3 与卖方核心分歧
| 机构 | 评级 | 核心假设 | 你与他们的分歧 | 谁更可能对 |
|------|------|---------|--------------|----------|
| ... | ... | ... | ... | ... |

### 3.4 条件估值案例与 24 个月收益分布（L2+ 强制）
| 条件案例 | EPS/价值载体 | 估值假设 | 条件目标价 | 条件 CAGR | 成立条件 |
|------|------|----------|---------|-----------|------|
| 🟢 Bull | X | X | X元 | +X% | ... |
| 🟡 Base | Y | Y | Y元 | +Y% | ... |
| 🔴 Bear | Z | Z | Z元 | -Z% | ... |

**收益概率**：只读 `_return_distribution_YYYYMMDD.json`。固定桶为 loss
(`R<0%`)、below hurdle (`0%<=R<32.25%`)、hurdle pass (`R>=32.25%`)；
`PROVISIONAL_UNCALIBRATED` 仅 sensitivity，`CALIBRATED_MODEL_WEIGHT` 才可能正式承重。

### 3.5 修正催化剂
| 催化剂 | 预期时间 | 对 operating/valuation 输入的影响 | 是否触发重跑 |
|--------|---------|----------------|-------------|
| ... | YYYY-MM-DD | 更新的 PIT 字段 | `forecast(contract, snapshot)` |

## 四、业务线拆解
| 业务线 | 收入 | 同比 | 毛利率 | 战略定位 | 市场给的隐含估值 |
|--------|------|------|--------|----------|-----------------|
| ... | [事实] | ... | ... | [推断] ... | [推断] ... |

## 五、财务表现
[事实] 核心指标趋势...
**估值快照**（轻量）：
| 指标 | 当前 | 5年分位 | 行业中位数 | 判断 |
|------|------|---------|-----------|------|
| PE(TTM) | xx | xx% | xx | 偏贵/合理/偏便宜 |
| PB | xx | xx% | xx | ... |

## 六、同业对标
| 指标 | 本公司 | 对标A | 对标B | 来源 |
|------|--------|--------|--------|------|
| ... | [事实] | [事实] | [事实] | ... |

## 七、风险分析
| 等级 | 风险类别 | 风险 | 触发条件 | 对冲策略 | 证据等级 |
|------|---------|------|----------|---------|----------|
| 致命(黑色) | 治理 | ... | ... | ... | 事实/推断/猜测 |
| 致命(黑色) | 政策 | ... | ... | ... | 事实/推断/猜测 |
| 重大(红色) | 财务 | ... | ... | ... | 事实/推断/猜测 |
| 重大(红色) | 解禁 | ... | ... | ... | 事实/推断/猜测 |
| 重大(红色) | 行业 | ... | ... | ... | 事实/推断/猜测 |
| 一般(黄色) | 宏观 | ... | ... | ... | 事实/推断/猜测 |
| 一般(黄色) | 竞争 | ... | ... | ... | 事实/推断/猜测 |

**A 股特供风险维度**（机构覆盖盲区，但往往是最大的真风险）：
- **政策风险** [必查]：行业是否被政策打压？（教培/医疗集采/互联网反垄断）产业补贴是否有退出风险？准入门槛是否在变化？→ 来源: 国务院/发改委/工信部官网 + 公司年报"风险提示"章节
- **解禁风险** [必查]：未来 6 个月限售股解禁日历（东方财富→数据中心→限售解禁）。大股东/董监高近 12 个月增减持记录。解禁量占流通市值 > 5% → 升级为重大风险。
- **概念炒作风险**：公司是否被贴上热门概念标签但实质收入占比 < 5%？如果是，概念退潮时股价可能腰斩。


## 七-A、游资/聪明钱追踪（A股特色维度）

*数据来源: stock_signals.py | 分析日期: YYYY-MM-DD*

### 资金面全景
| 维度 | 数值 | 信号 | 说明 |
|------|------|------|------|
| 5日净流入 | X亿元 | 🟢/🟡/🔴 | 超大单+大单净买入 |
| 20日净流入 | X亿元 | 🟢/🟡/🔴 | 中期资金趋势 |
| 超大单买入占比 | X% | 🟢/🟡/🔴 | >60%=机构主导 |
| 大宗交易(90d) | X笔 | — | 机构席位买入占比X% |
| 北向持股变化 | X万股 | 🟢/🟡/🔴 | 30天变化 |
| 内部人净增减持 | X万股 | 🟢/🟡/🔴 | 90天净值 |
| 股东户数变化 | X% | 🟢/🟡/🔴 | 集中/分散 |

### 游资综合判定
- **综合信号**: {strong_buy/buy/neutral/sell/strong_sell}
- **核心发现**: [1-2句话概括最重要的资金面信号]
- **A股特色注意**: [T+1/涨跌停/龙虎榜相关的特殊观察]

## 七-B、解禁压力评估（A股特色维度）

*数据来源: lockup_calendar.py | 分析日期: YYYY-MM-DD*

### 未来解禁日历
| 解禁日期 | 解禁数量(万股) | 占流通市值% | 限售股类型 | 窗口 | 风险 |
|---------|--------------|-----------|----------|------|------|
| YYYYMMDD | X | X% | 定增/IPO/股权激励 | T-X | 🟢/🟡/🔴 |

### 解禁压力汇总
| 时间窗口 | 累计解禁占比 | 风险等级 |
|---------|-----------|---------|
| 90天 | X% | Low/Medium/High/Critical |
| 180天 | X% | Low/Medium/High/Critical |

### 解禁影响评估
- **风险等级**: {low/medium/high/critical}
- **关键解禁事件**: [最大的一次解禁详情]
- **减持新规约束**: [大股东实际可减持速度分析]
- **历史参考**: [同行业/同规模公司解禁前后股价表现]

## 七-C、政策环境评估（A股特色维度）

*数据来源: policy_events + meeting_calendar | 分析日期: YYYY-MM-DD*

### 近期相关政策事件
| 日期 | 政策/事件 | 类别 | 方向 | 强度 | 与本标关联 |
|------|---------|------|------|------|----------|
| YYYY-MM-DD | ... | 产业/监管/宏观 | 利好/利空/中性 | 高/中/低 | ... |

### 未来政策日历
| 日期 | 会议/事件 | 类型 | 预期议题 | 潜在影响 |
|------|---------|------|---------|---------|
| YYYY-MM-DD | ... | 国常会/行业会议 | ... | ... |

### 政策环境综合判定
- **行业政策方向**: {鼓励/中性/限制/打压}
- **补贴状态**: {有补贴/退坡中/无补贴}
- **监管趋势**: {放松/稳定/收紧}
- **政策风险评分**: {-3 to +3}
- **政策预期差**: [市场是否充分定价了政策影响？买预期卖事实的风险？]

## 八、Upside 分析 — 增长期权（v2.10 新增）
[预测:高/中/低] TAM × 市占率 → 5 年收入天花板...
[预测:中] 利润率扩张路径：净利率从 X% → Y% 的可验证条件...
[预测:低] 新业务期权价值：明确为条件估值输入；不得冒充 return decision probability...
[事实] 管理层执行力正面证据：历史产能承诺兑现率/研发转化率...

## 九、反向论证（L3 必填）
| 最有力的空头论点 | 我的反驳 | 我可能错在哪 |
|-----------------|---------|-------------|
| ... | ... | ... |

*多空论点都必须有。如果只能写出空头论点或只能写出多头论点——你没研究透。*

## 十、综合结论
- **24个月收益分布**: exact artifact/stage/buckets/tail；withheld 时 numeric probability = null
- **最优建仓价位**: YY 元（期望 CAGR 提升至 ZZ%）
- **等到最优价位的可能性**: 高/中/低（定性依据） | **等不到怎么办**: Plan B...
- **建议行动**: 仅由独立 action/portfolio-risk/approval/execution 闸生成，不由概率产物直接生成
- **时间框架**: 短期（1-3月）/ 中期（6-12月）/ 长期（1年+）
- **核心假设**: 以下假设任一被证伪，结论失效——
  1. ...
  2. ...
- **最大仓位**: xx%

*数据来源：... 不构成投资建议。*
```

### 文件 3：财务数据.md — 数字说话

包含：年度/季度/TTM 核心指标表、业务线收入拆解、资产负债核心指标、**估值快照**、券商盈利预测汇总、可比公司对比表。

所有数字标注来源或标记为估计值。旧数据标注截止日期。

### 文件 4：研报索引.md — 信息来源

包含：直接覆盖研报清单、行业核心研报、第三方数据来源、关键宏观指标。

每条标注：**日期**（绝对日期 YYYY-MM-DD）、**机构**、**核心内容**、**评级/目标价**。

### 文件 5：跟踪框架.md — 决策引擎

```markdown
# {股票名} ({代码}) 跟踪框架

## 一、投资论点支柱评分 (Thesis Scorecard)

| # | 支柱 | 原始预期 | 当前状态 | 趋势 | 置信度 |
|---|------|---------|---------|------|--------|
| P1 | ... | ... | ... | ↑/→/↓ | 高/中/低 |
| P2 | ... | ... | ... | ↑/→/↓ | 高/中/低 |
| P3 | ... | ... | ... | ↑/→/↓ | 高/中/低 |

**趋势判断规则**:
- ↑ Strengthening：证据在增强原始论点
- → Stable：按预期推进
- ↓ Concerning：出现与预期不符的证据

**整体论点状态**: 🟢 完整 / 🟡 部分动摇 / 🔴 需要重新评估

## 二、关键跟踪指标 (KTI)

### Tier 1 — 决定买卖的核心变量
| # | 指标 | 频率 | 来源 | 当前值 | 预警阈值 | 触发行动 |
|---|------|------|------|--------|----------|----------|
| K1 | ... | 月度 | ... | {当前} | {阈值} | 减仓 1/3 |
| ... | ... | ... | ... | ... | ... | ... |

### Tier 2 — 行业验证
### Tier 3 — 公司基本面

## 三、催化剂日历

| 日期 | 事件 | 预期影响 | 实际结果 | 对论点的影响 |
|------|------|---------|---------|-------------|
| YYYY-MM-DD | 财报发布 | ... | - | - |
| YYYY-MM-DD | 产品发布 | ... | - | - |
| YYYY-MM-DD | 政策节点 | ... | - | - |

## 四、月度决策复盘（每月必做——5 个问题）

```
1. 原始买入逻辑还成立吗？（逐 pillar 打分，不是感觉）
   P1: ☐ 成立 ☐ 部分成立 ☐ 不成立
   P2: ☐ 成立 ☐ 部分成立 ☐ 不成立
   P3: ☐ 成立 ☐ 部分成立 ☐ 不成立

2. 有没有新的、没在预期清单上的变化？
   ☐ 有（记录: ___） ☐ 没有

3. 仓位是否需要调整？为什么？
   ☐ 维持 ☐ 加仓 ☐ 减仓
   原因: ___

4. 如果现在空仓，我会在这个价位买吗？（最诚实的一题）
   ☐ 会 ☐ 不会 → 那你为什么还持有？
   理由: ___

5. 有没有更好的机会应该替换掉这个？
   ☐ 有（记录: ___） ☐ 没有
```

任一题答案负面 → 触发深度复盘。第 4 题答"不会"但仍在持有 → 这是一个危险信号，你正在自我合理化。

## 五、季度财报检查清单
```
□ 毛利率 vs 上季: 升/降/平 ______
□ 营收 QoQ: ______ vs 上季 ______
□ 经营现金流 vs 净利润: 差距是否在扩大？______
□ 管理层指引变化: ______
□ 业绩 vs 自己的预期（不是 vs 券商预期）: ______
```

## 六、减仓/清仓硬触发条件
| 等级 | 触发条件 | 行动 |
|------|----------|------|
| 黄色 | 任一 Tier 1 KTI 触及预警 | 减仓 1/3 |
| 黄色 | 任一 Pillar 连续 2 月趋势 ↓ | 减仓 1/3 |
| 红色 | 两个以上 Pillar 趋势 ↓ 或趋势均 → 无进展 | 减仓 1/2 |
| 黑色 | 核心假设被证伪 | **清仓** |
| 黑色 | 找到了明显更好的机会 | 清仓换股 |
| 黑色 | 第 4 题连续 3 月答"不会" | **清仓**（你在自我合理化） |

## 七、月度复盘记录

YYYY-MM: 论点状态 🟢/🟡/🔴 | 仓位 xx% | 第4题答案 会/不会 | 行动 维持/加减仓
YYYY-MM: ...

## 八、预测准确率追踪（每次研究自动更新）

这是对"对自己诚实"的机制化——不是感觉，是数据。

### 研究预测记录（机读 D-01，每次新研究时追加一行）

> 这张表是 backtest 引擎 `auto_research/toolchain/prediction_backtest.py` 锁死的 **D-01 七列机读结构**——列名/方向/时间窗口格式逐字对齐 parser 契约，下次研究同股时引擎自动取价判定并回填后两列。**表头逐字不可改、不可加别名列**。

| 日期 | 预测内容 | 方向 | 置信度 | 时间窗口 | 实际结果 | 判定 |
|------|---------|------|--------|---------|---------|------|
| 20260603 | 股价区间上涨超10% | 涨 | 4 | 6个月 | 待下次回测 | 待下次回测 |
| 20260603 | EPS净利润同比正增长20%+ | 涨 | 4 | 12个月 | 待下次回测 | 待下次回测 |
| 20260603 | 营收同比增速 | 涨 | 3 | 12个月 | 待下次回测 | 待下次回测 |

**机读契约规则（emit 时人/Agent 必须逐条遵守，否则引擎判定路由错或静默落默认）**:
- **emit 范围**: 1 行 headline 价格方向 + 2-3 行研究**已承诺**的命门数（**以 EPS/净利润、营收领衔**——这俩走真 YoY 同比判定，最有信息量）。零额外分析量，都是研究已有结论的结构化落盘。
- **`预测内容` 必须含路由关键词**（否则 dispatch 落默认 price，判定口径错）:
  - `EPS`/`每股收益`/`净利润`/`net profit` → income basic_eps **YoY 真算同比**
  - `营收`/`收入`/`revenue` → income total_revenue **YoY 真算同比**
  - `毛利`/`grossprofit` → fina_indicator grossprofit_margin（⚠️ **level-check 非 YoY**：引擎拿原始百分点值如 37.8 直接比 ±10% 中性区 → 方向写「涨」时几乎恒判 CORRECT，是已知引擎 quirk，**故毛利率/ROE 只作次要补充，命门数请用 EPS/净利润/营收 领衔**）
  - `ROE` → fina_indicator roe（同 level-check quirk）
  - `股价`/`price`/`涨跌幅` → daily_price 区间收益（真算）
- **`方向` ∈ {涨, 跌, 横盘}**（引擎只认这三个；±10% 为中性区判 AMBIGUOUS，横盘无 AMBIGUOUS）。⚠️ **同一批预测两行不要让一行的「预测内容」字面里出现另一行的方向字**（如价格行写「涨」就别用含「跌」的「涨跌幅」措辞，命门行写「跌」就别带「涨」字）——同日期多行时引擎回填的行匹配会按方向字 fallback，字面串字会写错行（已知引擎行匹配 quirk，靠措辞规避）。
- **`置信度` = 1-5 整数**（越界自动 clamp，非法默认 3）。
- **`时间窗口` 只接受 `N个月`/`N月`（如 3个月/6个月）或 `YYYYQ[1-4]`（如 2026Q1）**。⚠️ **禁出现「年」字**——`1年`/`一年` 引擎不识别会静默落 90 天默认；长窗口写「12个月」。
- **`日期` = 研究当日 YYYYMMDD**（forward-only 锚点，emit 当下不知未来）。
- **`实际结果`/`判定` 两列 emit 时填人读占位「待下次回测」，不写 AUTO-GENERATED 标记**——标记由引擎回填时自己插入，模板作者/Agent 不写。

### 预测回测（下次研究同一股票时自动对比）

| 上次预测 | 预测日期 | 判定日期 | 预测 | 实际 | 结果 | 偏差分析 |
|---------|---------|---------|------|------|------|---------|
| ... | ... | ... | ... | ... | 正确/偏差/错误 | ... |

### 预测准确率统计

| 指标 | 近 12 月 | 近 3 月 | 趋势 |
|------|---------|--------|------|
| 方向准确率 | X% | Y% | ↑/→/↓ |
| 量级准确率（±20%） | X% | Y% | ↑/→/↓ |
| 最常高估的维度 | ... | — | ... |
| 最常低估的维度 | ... | — | ... |

**关键规则**:
- 每次新研究必须先读上次预测，逐条对比实际结果
- **首次研究此股票时**: 跳过预测回测步骤，在跟踪框架 §八 仅创建"研究预测记录"行，标注"首次研究，无历史预测可回溯"
- 方向连续 3 次错 → 触发深度复盘
- 某个维度系统性偏差（如营收增速总是高估 8pp）→ 在财务数据中自动打折
- 预测回测结果写入跟踪框架，不写入深度研究（私人数据，不是投资建议）

### Leader prose 后的唯一 claim renderer/CAS

本步骤接收 Step 03 已生成的 `leader_report_prose`、已保存的
`return_claim_manifest_path` 和五文件当前内容。先把 Leader prose 及其他非 claim
正文写完；正文不得手抄 probability、expected return、weighted CAGR/target/terminal
value，也不得从 helper state、旧 scenario 或 agent vote 复制数值。然后只对
`深度研究.md` 运行一次项目 renderer 和 replacement：

```python
from auto_research.toolchain.return_probability.claims import (
    render_return_claims_block,
    replace_return_claims_block,
)

deep_report_path = study_dir / "深度研究.md"
assert leader_report_prose
rendered_return_claims_block = render_return_claims_block(
    return_claim_manifest_path
)
replace_return_claims_block(
    deep_report_path,
    rendered_return_claims_block,
)
```

`render_return_claims_block` 只投影 immutable manifest；
`replace_return_claims_block` 在锁内以所读 preimage SHA-256 做 CAS，冲突或重复
delimiter 必须停止并重读，不得覆盖。全研究目录只能有这一段
`RETURN_CLAIMS_BEGIN/END` block。这里不 build/save manifest，不在 replacement 后
手改 block，也不再写任何 probability claim；后续只做持久化、consumer audit 和最终
quality gate。

---

## 第 5 步：双地持久化

优先使用专用同步脚本。它会校验五文件、同步研究目录下直接 `.md/.json` 文件、生成 manifest，并逐文件比对源/Vault SHA：

```bash
python scripts/sync_stock_research_to_vault.py \
  "auto_research/knowledge/stock_research/{股票名}-{代码}" --json
```

`--dry-run` 只能做预检，不能作为 DONE 证据。若脚本不可用，才允许用 `vault_write` 手工 fallback，并必须逐文件 `shasum -a 256` 比对源/Vault 内容后写明 fallback reason。

### Step 5 完成确认 checklist（逐项勾兑，跳步=研究未完成）

```
□ 1. 项目目录五文件存在: ls auto_research/knowledge/stock_research/{股票名}-{代码}/
□ 2. Vault 同步（v2.40.14 双层证据，任一层失败=阻塞）:
     2.1 单票 SHA 硬闸:
         python scripts/sync_stock_research_to_vault.py \
           "auto_research/knowledge/stock_research/{股票名}-{代码}" --json
         必须看到 ok=true、required files 全在、source_sha256 == vault_sha256、
         manifest_sha256/content_hash 已生成。README.md / 深度研究.md / 财务数据.md /
         研报索引.md / 跟踪框架.md 任一 ❌ 都不能 DONE。
     2.2 全局 Vault manifest 新鲜度:
         复跑 quality_gate_check.py。若唯一剩余 warning 是
         `[Infra] vault_sync last_sync ... >24h` 这类全局陈旧，而不是本研究源/Vault SHA 问题，
         继续刷新全局 manifest:
         python - <<'PY'
         import sys
         sys.path.insert(0, ".")
         from common.obsidian_bridge import sync_all_research
         print(sync_all_research())
         PY
         然后再次复跑 quality_gate_check.py；warning 消除才可写 PASS。
□ 3. Memory 索引: MEMORY.md 新增或更新个股研究条目
□ 4. quality_gate_check.py 通过 (≥85分 PASS, 60-84 WARN)
     ⚠️ §9 强制(06-04 升BLOCK): README 必须含可解析「## 建仓参数」标准块——
     buy类写数字价格闸 / hold类(持有不加·事件闸·不建仓)写文本说明, 缺块=BLOCK。
     填写规范见上方「建仓参数」模板段(hold文本禁带非%数字区间/突破闸禁编码数字；
     A/H溢价、财报利润、价格跌幅等非PE数字不得写入建仓PE)
□ 5. 映射桥: portfolio_research_bridge.md 已更新
□ 6. 个股关注池 watchlist.json（仅"可操作观察"结论才登记）:
     判定: 本股=未持仓 + 有明确建仓计划(等回调/有条件买入/小仓试探/分批建仓, 带建仓区间/触发)?
       是 → 构造 stock entry → 落盘 {目录}/watchlist_entry.json(留痕) → 跑 helper:
         python scripts/watchlist_upsert.py --stock-entry-file \
           "auto_research/knowledge/stock_research/{股票名}-{代码}/watchlist_entry.json"
         entry 字段: code/name/market/action/entry_zone/trigger/verdict/research_path/note
       否(强回避 conviction avoid / 治理红灯 / 已持仓) → 不写 entry(不污染未持仓池)
     helper 自动: ①upsert-by-code 整条替换(刷新不重复) ②已持仓 lifecycle(买入→移出池)
     gate §7.8 强制: 有 watchlist_entry.json 但 code 未进 watchlist.json stocks[] → BLOCK
       (已持仓自动免登; 无 entry 但核心结论含可操作词 → 仅 WARN 提醒, 不 BLOCK)
     完成后: python scripts/generate_bridge.py 刷新 bridge 第五区「个股关注」块
□ 7. 自动吐 triggers（机读行动契约 → research_verdicts + catalyst_events 闭环）:
     本质: 研究做完不是终点, 是给未来定下一组「如果……就……」的行动契约。
       每条 trigger 让催化剂推送从「信息流」升级为「行动流」——新闻命中 trigger
       直接给出 thesis 预设的行动建议, 不用回去翻研究。
     从研究产出逐条映射构造 triggers[]（厚 rubric, gate 只管一致性不管质量, 质量全靠这里）:
       • 交易计划「买入/加仓触发条件」(入场区间命中 且 thesis 未破)
           → 仅 `GENERATED_AUTHORIZED` 可映射 action="execute_trade:add"；否则 action="re_research" 或 "watch"，
             condition="回吐至¥X-Y 且 thesis未破", keywords=[股名,英文名,核心催化词]
       • 交易计划「止损线」
           → 仅 `GENERATED_AUTHORIZED` 可映射 action="trim_stop"；否则 action="re_research"
       • 跟踪框架「减仓触发」
           → 仅 `GENERATED_AUTHORIZED` 可映射 action="trim_stop" 或 "execute_trade:trim"；否则 action="re_research"
       • 催化剂日历「会改变 thesis 的重大事件」(财报/数据读出/审批/解禁)
           → action="re_research", condition=事件描述, expected_date=日历日期
       • 观察类 (上冲不追/横盘/等回调中)
           → action="watch"
     每条 trigger 必填 8 字段 (thesis_schema.validate_triggers 强制):
       trigger_id (slug, 如 innovent_pullback_add) / catalyst (催化剂名) /
       condition (触发条件) / action (上面枚举) /
       falsifier (来自 Thesis Scorecard 命门/证伪条件, 无证伪的 trigger 是赌徒祈祷) /
       keywords (催化剂名 + 股票别名中英文, NewsNow 靠它匹配) /
       status="pending" / expected_date (来自催化剂日历, 无则留 "")
     日期卫生硬闸 (v2.39.1, 写入前先结算):
       • expected_date 只能是 "" 或 YYYY-MM-DD; 禁止 2026Q3 / 2026-08 / H1 / "下半年"
       • 研究日之前已经发生的事件不得继续 status="pending"; 改为 resolved/removed,
         或重写成下一步 follow-up trigger 并给未来绝对日期
       • 催化剂正文可写"2026Q3窗口", 但机读 expected_date 必须落到一个可扫描日期
     condition_type 硬闸 (v2.42.1, 2026-07-19 长飞实证): trigger 若要带 `condition_type`，
       合法枚举**只有** `price_below` / `price_range` / `pe_below` / `pe_range`（且必须带
       对应数值字段，由 price_alert_scanner 结构化消费）。描述性类型
       （如 `technical_confirmation`、`event_gate`）会被 scanner 判"结构化价格trigger畸形"
       直接硬错——这类语义只写进 `condition` 文本，**不要**落 `condition_type` 字段。
     构造后写 {目录}/triggers_entry.json (含 ts_code/thesis_id/triggers[], 留痕), 再跑:
         python scripts/thesis_triggers_upsert.py --stock-entry-file \
           "auto_research/knowledge/stock_research/{股票名}-{代码}/triggers_entry.json"
     helper 自动: ①validate_triggers 拒非法 action ②merge 进 verdicts 不 clobber sibling 字段
       ③链式灌 catalyst_events ④孤儿停用 (上次有这次没有的旧 trigger 自动 is_active=0,
       防 WAIT->AVOID 后旧反方向 BUY 卡片还活着误推) ⑤别名守卫 WARN ⑥幂等连跑不翻倍
     v2.40.11 新票/A+H 别名闸: 跑完必须看 stdout/stderr。若出现别名/resolve warning,
       先补 `common/stock_alias_map.json` 的中文简称/全称、英文简称/全称、代码变体
       (A股6位、H股5位、`.SH/.SZ/.HK`), 再重跑到无 warning；exit 0 但有 warning 不算 DONE。
     v2.40.0 硬闸: helper 只负责 thesis_id/triggers/catalyst_events，不刷新 sibling 字段。
       跑完必须打开或程序校验 `auto_research/knowledge/research_verdicts.json` 中该股
       `verdict`/`action`/`expected_cagr`/`grade`/`last_updated` 与 README/深度研究一致；
       不一致要用 `common.locked_json.locked_update` 或现有 helper 显式更新，再跑
       `python scripts/generate_bridge.py` 和 `python auto_research/quality_gate_check.py <研究目录>`。
     强回避 (conviction avoid / 治理红灯) 股: 可只出 watch 或 re_research-on-washout trigger,
       或不出 triggers (不污染闭环) —— 与 gate §7.9 灰区一致 (无 entry 不 BLOCK)。
     gate §7.9 强制: 有 triggers_entry.json 但 verdicts 未同步 triggers → BLOCK
       (持仓股不享纯成员豁免, trim_stop 最需要活着; 无 entry 灰区不 BLOCK; 非法 action BLOCK)
```

**如果 vault_write 返回 False**: 文件已写入 staging 区，手动检查 Obsidian CLI 状态。

---

## 第 5.5 步：更新持仓-研究映射桥（L2+ 强制）

研究做完不是终点——研究结论必须连接到持仓操作才能真正产生价值。**每次 L2+ 研究完成后，必须更新 `auto_research/knowledge/portfolio_research_bridge.md`**，把你刚做完的研究结论映射到持仓建议上。

### 更新规则

1. **查当前持仓**：从 DB `stk_holdertrade` 或用户确认获取最新持仓
2. **提取研究结论**：从刚完成的 README.md 中提取：仓位建议 + 建仓条件/区间 + 最大风险
3. **判断映射状态**：

| 持仓状态 | 研究结论 | 映射标签 |
|---------|---------|---------|
| 持有 | 建议建仓/维持 | 🟢 一致 |
| 持有 | 建议减仓/清仓 | 🔴 严重冲突 |
| 持有 | 仓位超上限或成本高于建仓区 | 🟡 偏差 |
| 不持有 | 建议建仓（满足条件） | ★ 候选（按优先级） |
| 不持有 | 不建议建仓 | — 跟踪 |

4. **冲突标的置顶**：🔴 严重冲突的标的不论市值大小一律置顶
5. **更新最后更新日期**为当天

### 更新方法

直接读取并编辑 `auto_research/knowledge/portfolio_research_bridge.md`：

```bash
# 1. 读取当前映射表
cat auto_research/knowledge/portfolio_research_bridge.md

# 2. 找到刚研究标的的行，用 Edit 工具更新：
#    - 研究结论列 → 填入最新 README.md 中的仓位建议
#    - 建议行动列 → 根据映射标签给出具体行动
#    - 更新"最后更新"日期

# 3. 如果该标的不在映射表中（新研究），在对应的映射区域添加一行

# 4. 如果刚研究的标的当前在持仓中且标签为🔴/🟡，
#    在"冲突行动计划"区域新增一条具体的行动建议
```

### 映射桥的核心价值

- **研究→操作闭环**：做完研究，自动检查是否需要调仓
- **冲突可见化**：研究说卖但还在持有的，红标置顶，无法忽视
- **建仓候选池**：研究过但不持有的，按条件满足度排优先级
- **自我一致性**：一个月后回看——"研究建议的行动我执行了吗？"这是对自己诚实的机制化

**注意**：映射表修改的是持仓建议，不是实际持仓。实际调仓由用户在交易软件中手动执行。

---

## 交易计划生成详细规范（主文件 Step 5，v2.17.0 升级为独立步骤）

研究证据与交易计划不是一步直通。只有独立 action、portfolio-risk、人工批准和
execution 闸已产生同一 decision 的授权证据，才可调用 `quick_trade_plan()`；
withheld/provisional probability、卖方条件案例或 Leader summary 均不能触发调用。

### 调用方法

```python
from common.trade_planner import quick_trade_plan

# approved_decision 由独立 action/portfolio-risk/approval/execution 链提供；
# 不能从 Bull/Base/Bear、sensitivity EV 或 return artifact 临时拼装。
required_gates = (
    "action_gate_passed",
    "portfolio_risk_gate_passed",
    "human_approved",
    "execution_gate_passed",
)
all_independent_gates = all(
    approved_decision.get(key) is True for key in required_gates
)
if not all_independent_gates:
    trade_plan_status = "SKIPPED_NO_AUTHORITY"
    tp = None
else:
    fa_verdict = approved_decision["fa_verdict"]
    tp = quick_trade_plan(
        approved_decision["ts_code"],
        fa_verdict,
        portfolio_value=approved_decision["portfolio_value"],
        current_holdings_pct=approved_decision["current_holdings_pct"],
    )
    trade_plan_status = "GENERATED_AUTHORIZED"
```

### 输出写入深度研究.md

只有 `trade_plan_status == "GENERATED_AUTHORIZED"` 时，才在 `深度研究.md` 的
**§十、综合结论** 之后追加以下内容。若为 `SKIPPED_NO_AUTHORITY`，不得调用
`quick_trade_plan()`、不得追加交易计划，只记录未获授权状态：

```markdown
## 十一、交易计划 (Trade Idea)

*自动生成: quick_trade_plan() | 日期: YYYY-MM-DD*

### 核心参数
| 参数 | 值 | 说明 |
|------|---|------|
| 方向 | buy/sell/hold | FA结论驱动 |
| 入场区间 | ¥XX.XX~¥XX.XX | 技术共振区(MA+筹码+Fibonacci) |
| 止损 | ¥XX.XX | ATR×2或筹码支撑位 |
| 目标1 | ¥XX.XX (卖1/3) | entry+2×ATR |
| 目标2 | ¥XX.XX (卖1/3) | entry+3×ATR |
| 仓位 | X.X% = XXX股 = ¥XX,XXX | 波动率+相关性调整 |
| 风险收益比 | X.XX:1 | ≥1.5可执行，<1.5不建议 |
| 最大亏损 | X.XX% | 触及止损的组合损失 |

### 技术面信号
| 指标 | 值 | 信号 |
|------|---|------|
| 趋势评分 | X.XX | strong_buy/buy/neutral/sell/strong_sell |
| Hurst | X.XXX | trending/random/mean_reverting |
| RSI(14) | XX.X | 超买>70/超卖<30 |
| BOLL位置 | X.XX | >1.0超买/<0超卖 |
| BIAS(6) | X.X% | >15%极端超买 |
| 筹码获利盘 | XX.X% | >90%抛压风险 |
| 量价背离 | bearish/bullish/None | 强度XX% |
| SMC评分 | X.XX | 多头/空头/中性 |
| 超买冲突 | True/False | 趋势+超买同时存在 |

### 执行建议
- **TWAP**: X笔, 时段 HH:MM~HH:MM
- **限价单**: ¥XX.XX (VWAP附近)
- **分批**: 首批XX%@入场区下沿, 加仓XX%@确认信号, 追加XX%@突破

### ⚠️ 风险提示
- [系统自动检测: R:R<1.5/BOLL>1.0/获利盘>90%/超买冲突 等]
```

### fa_verdict 构造规则（v2.40.23 动作语义优先）

| README `current_action` | fa_verdict.action | fa_verdict.conviction | 约束 |
|------------|-------------------|----------------------|---|
| `BUY_NOW` | `"buy"` | `"strong/moderate"` | 仅投影已经由独立 action + portfolio-risk + approval + execution 闸授权的 current_action；概率 stage 不创建该动作 |
| `ADD_NOW` | `"buy"` | `"moderate"` | 同上；withheld/provisional、卖方 Base 值或 sensitivity EV 均不够 |
| `PROBE_ONLY` | `"buy"` | `"weak"` | 必须先有独立动作授权；≤1-2%，有止损/复查日/失败触发 |
| `WAIT_PRICE` / `WAIT_EVENT` | `"hold"` | — | 不生成买入计划，只生成 trigger/watch |
| `HOLD_MONITOR` / `NO_NEW_MONEY` | `"hold"` | — | 已持仓只监控，不追加新资金 |
| `NO_ACTION` / `AVOID` | `"sell"` 或 `"hold"` | `"moderate"` | 视是否已持仓决定 trim/hold |
| `TRIM` / `SELL` / `CLEAR` | `"sell"` | `"moderate"/"strong"` | 减仓或清仓 |

**target_price**: Bull/Base/Bear 的条件目标价只能进入研究敏感性。不得把卖方
Base 值或 provisional/withheld 输出直接写入可执行 trade plan；执行 target 必须来自
已经通过独立 action、组合风险、批准与执行闸的 decision evidence。

禁止从标题词倒推交易动作：`强烈买入/有条件买入/小仓试探/核心仓不能减` 若对应 `current_new_money_pct=0`，一律不得传 `action="buy"`。

### 特殊情况处理

1. **港股**: `quick_trade_plan("09988.HK", ...)` 自动使用 HKTradeConstraints（印花税0.1%双边+5项征费）
2. **已持仓股**: 传 `current_holdings_pct=0.119` → 系统自动扣除已有仓位
3. **研究说不建议**: action="sell" 或 action="hold"，系统不会生成买入计划
4. **R:R<1.0**: 系统在推理中自动警告"赔率不足，不建议现价入场"

### 完成确认（Step 5 检查项）

```
授权分支：`GENERATED_AUTHORIZED`
□ Step 5.1A 四个独立 gate 均为 true；quick_trade_plan() 已调用，Trade Idea 已写入深度研究.md §十一
□ Step 5.2A 交易计划摘要已输出给用户（入场区间/止损/仓位/R:R）
未授权分支：`SKIPPED_NO_AUTHORITY`
□ Step 5.1B 至少一个独立 gate 非 true；quick_trade_plan() 未调用，深度研究.md 未追加交易计划
□ Step 5.2B 只输出未授权状态，不声称交易计划完成
□ Step 5.3 triggers_entry.json 已构造并跑 thesis_triggers_upsert.py
            (从交易计划/止损/催化剂日历/命门映射 triggers[]; 强回避股可不出, gate §7.9 灰区)
□ Step 5.4 action_semantics 已写入 README/深度研究；若 current_action 非 BUY_NOW/ADD_NOW/PROBE_ONLY，
            quick_trade_plan 未被传成 buy，当前可用新资金仓位为 0%
```

---
