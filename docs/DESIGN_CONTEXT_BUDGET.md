# 设计方案 — MCP 上下文 Token 预算 (Context Budget)

> 2026-08-15 | 承接 `docs/RESEARCH_MCP_CONTEXT_WINDOW.md`(研究简报)与
> `PLAN-0.3.0.md` §9.2(顺带优化 B)。本文是**研究结论 + 设计方案**;所有数字均为
> 本日实测(测量方法见 §2.5,可复现脚本 `scripts/measure_tokens.py`)。
> 待用户裁定项见 §7。实施前必读红线:AGENTS.md(schema 冻结)、docs/DEGRADATION.md
> (降级可观测)、docs/DATA_MODEL.md(L2 语义)。

## 1. 结论摘要 (Executive Summary)

1. **成本模型被实证推翻了一半**:DSH 每步确实全量注入工具面(H1 ✅),但 DeepSeek
   服务端自动磁盘缓存(KV cache)让**工具面只按全价计费一次**,后续每步按 1/50 价格
   从缓存读取(实测单会话 384 步:cacheRead 1.07 亿 tokens、uncached 仅 79.6 万)。
   **每步的真实边际成本 = 新产生的 token(工具结果 + 新消息 + reasoning 回传)**,
   不是工具面的重复计费。→ 优化重心应放在**结果侧**,而非工具面。
2. **本仓库真正的两个大头**(实测):
   - `fin_data__get_announcements` top_k=10:单次调用 **137,487 tokens**
     (600519 半年报全文 17.6 万字符);截断到 800 字符/条 + `truncated:true` +
     url 兜底 → **6,723 tokens(-95%)**。
   - `fin_data__get_klines` 1 年窗口(242 根):模型侧 **34,417 tokens**;
     表头外提 + 紧凑键 + 精度截断 → **11,920 tokens(-65%)**。
3. **DSH 侧已有兜底但不够**:spill(>50KB 结果自动落盘、模型看头尾预览)在本部署
   激活,但预览仍有 ~18K tokens 且需要模型再发 `read` 调用;compaction 与
   tool-result-pruner 在本部署 **disabled**(无会话级压缩)。服务端先压缩 → 结果
   不超 spill 阈值 → 一次调用即得全量信息,不产生额外 read 往返。
4. **收益量化**(cl100k_base,fixture 真实数据,现渲染 vs 压缩):
   kline -41~49% / calendar -53~78% / edb -79% / announcements -95% /
   quote -25~34% / financials -14% / special ~0%(L3 透传行,不可压缩)。
5. **建议方案分四层**,全部在服务端渲染层/描述层,零协议改动、零 schema 语义改动:
   A. 结果渲染压缩(最大收益,先做) → B. schema 去 title 冗余 + 描述行动指令化
   (-17%) → C. 工具描述引导调用预算(窗口/top_k) → D. 统一 token 预算(远期)。
6. **红线核对**:工具参数 schema 只减冗余(title),不动参数名/语义/结构 ——
   一次性改动后前缀重新稳定,KV-cache 语义不变;截断一律显式标注(`truncated`)并
   保留 url —— 降级可观测;价格精度按 A 股最小变动价位(0.01)圆整,无数据损失。

## 2. 实测证据 (本日, 全部可复现)

### 2.1 DSH 侧机制事实(源码级, `~/.dsh/profiles/node_modules/@deepseek-ai/`)

| # | 事实 | 证据 | 对设计的影响 |
|---|---|---|---|
| F1 | 每 step 一次 `buildRequest`,请求必带完整 `tools` 数组 | `dsh-agent-loop/lib/index.js` L613/706 (`preStep` 每步 `assemble()` → `{tools}`) | H1 确认:每轮注入 |
| F2 | DeepSeek 磁盘缓存自动开启;命中需**完整匹配缓存前缀单元**;`prompt_tokens = cache_hit + cache_miss` | [DeepSeek 官方 KV Cache 文档](https://api-docs.deepseek.com/guides/kv_cache);`dsh-llm-deepseek` L191-198 | 工具面一次全价 + 每步 1/50 价读取;**任何 schema/系统提示改动都打断缓存前缀** → 改动要一次性做完,不要频繁改 |
| F3 | 定价:cache hit $0.0028/1M vs miss $0.14/1M(50 倍差) | [DeepSeek 定价页](https://api-docs.deepseek.com/quick_start/pricing) | 前缀稳定 = 省钱;但边际成本主体仍是新 token |
| F4 | 实测会话(2 轮 10 steps,13 次 fin 调用):uncached input 56,795 / cacheRead 323,584;单步 uncached 峰值 29,964(公告+K线结果) | `~/.dsh/sessions/--home-shawn-investment--/*/session.jsonl.zstd` | 用户"5 万+ tokens"= **新内容的边际成本**,非 schema 重复计费 |
| F5 | 长会话(384 步):cacheRead 累计 1.07 亿,占输入流量 ~99% | 同仓库 session-e9c7d693 | 注意力被超大缓存前缀稀释 → 结果压缩同样降低每步注意力成本 |
| F6 | spill 激活:结果 >50KB(UTF-8)自动落盘,模型侧为头尾预览+定位指引;实测公告预览 26,055 chars(~18K tokens)、K线预览 49,226 chars | `dsh-spill-policy`(maxInlineBytes 50000);会话日志 | 服务端压缩后结果不触发 spill → 免一次 read 往返,信息更完整 |
| F7 | compaction-basic / command-compact / tool-result-pruner 在本部署 **disabled** | `dsh --profile web --dump-config` | 无会话级压缩兜底;session 增长全裸奔 |
| F8 | 全 harness 工具面(32 工具)JSON 34,573 chars ≈ 8.6K tokens(heuristic);其中 fin 11 工具 ≈ 13.7K chars ≈ 3.4K tokens(含 `mcp__fin__` 前缀) | 会话 request/header 事件 | 与用户 DSH 统计"tool schema ≈ 1 万"吻合(全量 32 工具) |
| F9 | MCP 协议无服务端缓存语义;DSH client 在连接/`listChanged` 时 `tools/list` 一次并本地缓存 | `dsh-mcp-client` L139-168;MCP 2025-06-18 规范(分页 + annotations) | 协议层无优化空间;工具面成本 = 每步注入 |
| F10 | DSH 自己的 token-meter 是字符/4 启发式;真实数字只能来自 provider usage | `dsh-token-meter/lib/index.js` | 基线必须用 provider usage + tiktoken 复测,不能用启发式 |

### 2.2 本仓库工具面测量(scripts/measure_tokens.py `surface`)

- 11 工具合计 **1,623 tokens/轮**(DSH 视角,含 `mcp__fin__` 前缀,cl100k_base)。
- 其中 pydantic 自动生成的 **title 冗余 278 tokens = 17.1%**(inputSchema 内
  `"title"` 键,值与参数名重复)。
- `instructions` 长文本 267 tokens(每轮随 system 注入)。
- **schema 结构实证**(mcp 1.29.0 / FastMCP):每个属性都带 `"title": "Query"` 这类
  与参数名重复的键,根级还有 `"title": "fin_data__search_symbolsArguments"`;
  上游 FastMCP 社区已在 [PR #449 "Prune titles from JSONSchemas"](https://github.com/PrefectHQ/fastmcp/pull/449)
  (2025-05 合并,对应 [issue #412](https://github.com/PrefectHQ/fastmcp/issues/412))
  裁剪 title,本版本未包含该改动 → 我们自己剥离(方案 B1)。

### 2.3 结果渲染测量(fixture 真实数据;live 交叉验证)

| 场景 | V0 现渲染 | V1 表头外提 | V2 +紧凑键/精度 | 说明 |
|---|---|---|---|---|
| kline 30 根(周) | 2,917 | 1,717 (-41%) | 1,537 (-47%) | V2 保持 `date_ms`(ms int 比 ISO 更省 token:5 vs 6) |
| kline 250 根(年) | 24,037 | 13,817 (-43%) | 12,317 (-49%) | live 242 根模型侧 34,417(美化 JSON)→ V2 11,920 (-65%) |
| quote 批量 50 | 352 | 264 (-25%) | 231 (-34%) | — |
| calendar 全年 | 7,781 | 3,672 (-53%) | 1,735 (-78%) | 行纯日期串 + meta 外提 |
| announcements top_k=10 | 9,644 | 3,684 (-62%) | 同 V1(截断 800 字符/条) | **live 600519:137,487 → 6,723 (-95%)** |
| financials income×4 | 1,029 | 887 (-14%) | 同 V1 | rows 是 L3 透传,只压缩外层 |
| special 榜单 50 行 | 6,638 | 6,610 (-0.4%) | 同 V1 | items 是 L3 透传 dict,不可压缩 |
| edb 100 观测 | 7,833 | 1,680 (-79%) | 同 V1 | meta(指标/单位/频率)外提是最大头 |
| reconcile | 216 | 216 (0%) | — | 已是紧凑形态,不动 |

> 注:V0 为紧凑 JSON 序列化口径;模型侧实际是美化 JSON,美化本身约 +30-48%
> (live kline:紧凑 23,269 vs 美化 34,417)—— 渲染层顺带改为紧凑序列化。
> 美化 JSON 对 LLM 无信息增益(JSON 结构由模型按 token 读取)。

### 2.4 关键结论:单次调用的"灾难级"结果(按降序)

| 调用 | 单次 tokens(实测) | 触发条件 |
|---|---|---|
| announcements top_k=10 | **~137K** | 600519 半年报窗口;标的长文公告时必然发生 |
| klines 1 年日K | **~34K** | 用户/模型按年拉取;10 年窗口(适配器允许)≈ 30 万+ |
| klines 30 根 | ~2.9K | 常规 |
| calendar 全年 | ~7.8K | 每轮可能被重复调用 |
| edb 100 观测 | ~7.8K | observation 默认 10 时 ~0.8K |
| special 50 行 | ~6.6K | 默认 size=50 |

### 2.5 测量方法(防回归基线)

```bash
uv run python scripts/measure_tokens.py all   # surface + results
```

- tokenizer:tiktoken cl100k_base(DeepSeek tokenizer 未公开;简报 §8.4 认可的代理)。
- 真值锚点:DSH 会话日志 provider usage(`inputTokens/cacheReadTokens/outputTokens`),
  两者结论一致时采信;差异 >15% 时以 provider usage 为准并复核。
- 新改动合入前跑基线,记录 diff,防止回归(纳入 CI 前先人工核对,见 §8)。

### 2.6 外部依据(2026-08-15 检索)

- DeepSeek 官方:[Context Caching on Disk](https://api-docs.deepseek.com/guides/kv_cache)
  (自动开启、前缀单元完整匹配、请求边界/公共前缀/定长间隔持久化)、
  [定价页](https://api-docs.deepseek.com/quick_start/pricing)(cache hit $0.0028 vs
  miss $0.14 / 1M,50 倍差)、[新闻公告](https://api-docs.deepseek.com/news/news0802/)。
- MCP 2025-06-18 规范:[Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
  (tools/list 分页 + listChanged 通知;无协议层列表缓存语义)。
- FastMCP:[PR #449](https://github.com/PrefectHQ/fastmcp/pull/449) title 裁剪先例。
- OpenAI function calling 官方建议:工具描述应"简短、动作导向",用 enum/结构让非法
  状态不可表示,namespace 按域分组(其 tool_search 动态装载依赖 gpt-5.4+,DeepSeek
  侧无对应能力)。
- OpenBB [标准化文档](https://docs.openbb.co/odp/python/developer/standardization):
  按域标准化输出 schema + provider 字段透传 —— 与本项目 L3"标注不转换"同构。

## 3. 红线核对(每条优化对照)

| 红线 | 本方案如何守住 |
|---|---|
| 工具名与参数 schema 冻结(AGENTS.md) | 优化 A(渲染)不碰 schema;优化 B 只**删除 pydantic 自动 title 键**,参数名/类型/required/语义/结构零改动;一次性合入,之后前缀稳定,不破坏 KV-cache 语义 |
| 降级可观测(DEGRADATION.md) | 所有截断输出 `truncated: true` + `note`(meta 内)明示 + `url`/全文兜底;绝不静默丢数据 |
| 数据质量不降 | 价格按 A 股最小变动价位 0.01 圆整(无损失);volume 股整数化(L2 已是股);turnover 保留 2 位;日期保持 `date_ms` int(L2 语义,且更省 token);`date_ms`→ISO **不做**(反而更贵) |
| KV-cache 前缀稳定 | 描述/schema 改动一次到位;不把运行时可变量(时间、warnings)写进工具描述 |

## 4. 优化设计(分层,按收益排序)

### A. 结果渲染压缩(render 层,`servers/mcp_data.py`;最大收益,先做)

**A1. 表头外提(meta 化)—— 结构性,零语义风险,全部 dataclass 行适用**

信封不变:`{"data", "source", "tier", "ts", "warnings"}`(溯源/降级载体,不动)。
`data` 内部改为:

```jsonc
// Kline/Quote/CalendarDay/EDBPoint(批内公共字段只出现一次)
"data": {
  "meta": {"symbol":"600519.SH","currency":"CNY","period":"1d","adjust":"none",
           "source":"同花顺","tier":"free","ts":"..."},
  "rows": [
    {"date_ms":1782748800000,"open":1187.0,"high":1195.67,"low":1176.0,
     "close":1185.49,"volume":3960779,"turnover":4684236158.95},
    ...
  ]
}
```

- 公共字段判定:批内**逐行相同**者外提(symbol/currency/period/adjust/source/
  tier/degraded;quote 另加 as_of_ms;EDB 加 indicator/code/unit/magnitude/
  freq/currency)。批内变化者(如混合 source)留在行内 —— 外提前做一致性检查,
  不一致则回退旧格式(降级可观测的同一哲学:宁可多几行,不静默丢字段)。
- FinancialStatement:statement 级字段(symbol/statement/currency/caliber/
  source/tier)外提,`rows`(L3 透传)原样。
- SpecialData items / reconcile 行 / ambiguity / not_found:已是 L3 透传或紧凑
  形态,不动。

**A2. 紧凑行键 + 精度策略(表示层,收益叠加,建议一并做)**

- 行键缩写仅用于**自描述性强的领域约定**:`d/o/h/l/c/v/t`(K线,金融 API 通用
  惯例)、`s/last/chg%/vol/amt`(quote)。EDB/calendar 行不缩键(V1 已足够)。
- 精度(外置 `config/render.yaml`,不写死):
  - 价格/指数点位:round 2 位(A 股最小变动价位 0.01,无损失)
  - 基金净值:round 4 位(场内/场外净值惯例)
  - volume:int(股);turnover:round 2
- 日期:保持 `date_ms` int(L2 语义;实测 ms int 5 tokens < ISO 6 tokens)。
- 序列化:紧凑 JSON(`separators=(",",":")`),放弃美化;实测再省 ~30-48%。
- **A1+A2 合计:klines -49~65%、calendar -78%、quote -34%、edb -79%。**

**A3. announcements 截断(最大单项,独立决策)**

- 默认每条 `content` 截断 **800 字符**(可配置 `config/render.yaml`)。
- 输出 `truncated: true` + meta.note 说明"content 为摘要,全文见 url"(降级可观测)。
- `url` 恒保留(全文兜底;模型可提示用户自取)。
- 排序保持 Wind relevance 序;title/date 恒保留。
- 实测:600519 top_k=10 → 137,487 → **6,723 tokens (-95%)**;且结果 <50KB
  不再触发 DSH spill,省一次 read 往返。

### B. 工具面去冗余(一次合入,以后冻结)

- **B1. 去除 pydantic 自动 title**:在 FastMCP 注册层对 `inputSchema` 递归删除
  `"title"` 键(工具级 title 本就未设置)。-17.1%(278/1,623 tokens)。
  参数名/类型/required/描述语义不动。schema 评审记录落 DESIGN_REVIEW(决策 14)。
- **B2. 描述行动指令化**:description 现含参数解释(与 schema 重复)。改写为
  "何时用 + 怎么用 + 边界",参数语义交给 schema。目标 -30~40% 描述字数。
  例:`get_klines` 描述增加调用引导(见 C)。
- 预期合计:1,623 → ~1,200 tokens/轮(-26%)。

### C. 调用预算引导(描述层,不新增参数)

在工具描述中明示资源边界,引导模型避免大调用(OpenAI 官方工具描述建议同向:

- `get_klines`:"**窗口 ≤ 1 年**(10 年窗口单次结果可达 3 万+ tokens);
  优先日线;分钟线仅单交易日。"
- `get_announcements`:"**top_k ≤ 5**;长公告全文可达 2 万+ tokens,结果已截断,
  全文见 url。"
- `get_edb`:`observation` 默认 10;`get_special_data` size 默认 50 可降(25)。
- 效果不可强制(模型可能无视),但零成本、与 F2/KV-cache 无冲突(一次性)。

### D. 统一结果 token 预算(远期,本期不定)

- `config/render.yaml` 增加 `budget`(如单次结果 ≤ 8K tokens)+ 超限截断 +
  `truncated` 标注 —— 与 A3 同哲学,统一到所有工具。
- 设计前提:预算外置可配置;绝不静默丢数据。
- 本期不实现:DSH 侧无 compaction(部署配置问题,非本仓库可改);协议层无缓存;
  结果侧摘要缓存(LLM 少重复调用,命中率低,实测会话 431 次调用 0 重复)。

## 5. 与 DSH 已有机制的边界(为什么服务端压缩仍必要)

| DSH 机制 | 现状 | 服务端压缩的增量价值 |
|---|---|---|
| 磁盘缓存 | 自动,工具面/历史前缀 1/50 价 | 新结果 token 无缓存,压缩直接减计费;压缩还减每步 attention 前缀 |
| spill | >50KB 落盘,模型看头尾预览+指引 | 压缩后不触发 spill:信息一次给全,免 read 往返;spill 预览仍 ~18K tokens |
| compaction/pruner | **本部署 disabled** | 长会话无兜底;即使未来开启,服务端压缩让压缩触发点大幅推迟 |
| token-meter | 字符/4 启发式 | 本方案提供真实 tokenizer 基线 + provider usage 锚点 |

## 6. 实施清单(按序)

1. `config/render.yaml`(新):精度/截断阈值/紧凑键开关,外置可配。
2. `servers/mcp_data.py` 渲染层:meta 外提(A1)+ 紧凑键与精度(A2)+ 紧凑序列化。
   渲染层纯函数,不动 core/domain 数据层、不动工具逻辑。
3. announcements 截断(A3,独立提交,先评审)。
4. 工具面:B1 title 剥离 + B2 描述改写(一次合入;schema 评审记录落 DESIGN_REVIEW
   决策 14;tools/list 11/11 断言保持)。
5. 描述引导(C)随 B2 一起。
6. 测试:每步加渲染单测(meta 外提一致性、截断标注、混合 source 回退);
   `scripts/measure_tokens.py` 基线更新;回归 pytest 全绿(197+9)。
7. 文档:DEGRADATION(截断标注语义)/DATA_MODEL(渲染层表示说明)/README。

## 7. 待用户裁定(实施前)

1. **A2 紧凑键**(`o/h/l/c/v/t`):接受金融惯例缩写,还是保留全名键(仅 A1)?
   - 影响:klines -49% vs -43%。
2. **A3 截断阈值**:800 字符/条(推荐,约 1.5K tokens/条)vs 1500 字符(更完整)。
3. **B2 描述改写**:允许逐字改写(参数语义不变),评审后一次性合入。
4. D 统一预算是否排期(建议 v0.4.0 或以后)。

## 8. 度量与防回归

- 基线:`scripts/measure_tokens.py all` 输出存档(本文 §2.2/2.3 即基线)。
- 改动前后必须跑基线并 diff;合入前人工核对变化是否符合预期(截断阈值等可配置
  项验证)。CI 自动化(在 pytest 内断言关键用例 token 上限,如
  announcements 截断后 < 8K tokens)列为后续项,先人工。
- tokenizer 变更(cl100k → DeepSeek 官方若发布)时重跑基线,不改断言口径。

## 9. 不做(明确排除)

- ❌ 修改 DSH 侧(compaction 开关、spill 阈值):部署配置问题,不属于本仓库;
  如需,单独向用户提出。
- ❌ LLMLingua 类 prompt 压缩:DSH 已有 compaction 机制(未启用),服务端引入
  压缩器与"降级可观测"哲学冲突,且收益被磁盘缓存稀释。
- ❌ MCP 协议层优化:2025-06-18 规范无工具列表缓存语义;DSH client 已缓存
  tools/list 结果(连接期一次)。
- ❌ 动态/按需工具面(OpenAI tool_search 模式):DeepSeek API 无此能力;
  且 schema 冻结红线不允许裁工具。
- ❌ 日期 ISO 化:实测更贵(6 > 5 tokens),且碰 L2 语义,得不偿失。
- ❌ special/financials rows 键名改写:L3 透传字段 vendor 保留,契约红线。
