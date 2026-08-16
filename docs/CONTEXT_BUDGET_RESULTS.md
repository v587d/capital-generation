# 上下文 Token 优化 — 正式效果数据 (真实 KEY, 前后对比)

> 2026-08-15 | 承接 `docs/DESIGN_CONTEXT_BUDGET.md`(设计方案)。本报告是
> **优化前 vs 优化后**的正式测量, 全部接入真实 THS/Wind KEY, 模型侧 wire 文本
> (FastMCP `indent=2` 序列化, 即 LLM 真实所见), tiktoken cl100k_base。
> 依据本报告决定是否合并 (用户裁定: 先看数据再合并)。

## 方法 (可复现)

1. **优化前**: 旧代码 stdio 起 server, 顺序调用 11 个代表性用例 (串行 + 8s 间隔,
   THS 0.2 QPS 纪律, 全程无 2003) → wire 文本存档 `dumps/token_compare/`。
2. **优化后**: 新代码 (A1 表头外提 + A3 公告截断 + B1 title 剥离 + B2/C 描述) 同用例
   重跑 → 存档 `dumps/token_compare_new/`。
3. 对比: `uv run python scripts/measure_tokens.py compare`
   (`scripts/capture_live.py` 取数, `scripts/measure_tokens.py` 测量)。

同一交易日、同一用例集、同一序列化口径; 两次调用的行情数据一致 (同日快照/缓存)。

## 结果: 结果侧 (单次调用, 模型侧 tokens)

| 用例 | 优化前 | 优化后 | 节省 |
|---|---|---|---|
| announcements_10 (top_k=10, 600519) | 137,763 | 6,874 | **-95.0%** |
| calendar (全年) | 11,862 | 3,956 | **-66.6%** |
| edb_100 (100 观测) | 38,496 | 28,494 | -26.0% |
| klines_1y (242 根) | 34,417 | 19,489 | **-43.4%** |
| klines_5d | 763 | 529 | -30.7% |
| index_kline_5d | 878 | 556 | -36.7% |
| financials_income4 | 1,458 | 1,283 | -12.0% |
| quote_5 | 855 | 685 | -19.9% |
| fund_nav_10 | 199 | 199 | 0% (单行平铺) |
| reconcile_klines | 1,133 | 1,133 | 0% (设计上不动) |
| special_limitup_50 | 108 | 108 | 0% (L3 透传) |
| **合计** | **227,932** | **63,306** | **-72.2%** |

> 叠加工具面 (-9.2%/轮) 后, 一次典型 11 用例会话总输入约 -72%; 对 DSH 每步
> 边际成本 (新结果 token, 无缓存) 的削减即上述结果侧数字本身。

## 结果: 工具注册面 (每轮注入)

| 项 | 优化前 | 优化后 | 变化 |
|---|---|---|---|
| 11 工具合计 | 1,623 tokens | **1,473 tokens** | **-9.2%** |
| pydantic title 冗余 | 278 tokens (17.1%) | 0 | 已剥离 (B1) |
| 描述 (B2/C 改写+预算引导) | ~450 | ~674 | +50% 字数, 换调用预算引导 |

说明: 描述字数增加是**有意为之** (get_klines 明示"窗口 ≤1 年"、get_announcements
明示"top_k ≤5") — 工具面净省 150 tokens, 同时换取对 3 万+ token 级调用的事前拦截。

## 结构抽查 (优化后 wire, 无信息丢失)

- `klines_1y`: `meta={symbol,currency,period,adjust,source,tier,degraded,extra}`
  + `rows=242`; 信封 `source=同花顺/tier=free` ✅
- `announcements_10`: 7 条中 **6 条 truncated=True** (半年报全文 17.6 万字符 →
  800 字符摘要), 全部保留 title/date/url/truncated 标记; meta.note 明示截断语义 ✅
- `calendar`: `meta + rows=241` ✅
- 混合源/单行/空列表: 自动回退平铺 (单测覆盖) ✅

## 红线核对

| 红线 | 状态 |
|---|---|
| 工具参数 schema 冻结 | ✅ 参数名/类型/required/默认值零改动 (单测断言), 仅删冗余 title |
| 降级可观测 | ✅ 截断显式 `truncated: true` + meta.note + url 兜底; 信封 source/tier/ts/warnings 原样 |
| 数据质量 | ✅ 全文可经 url 获取; 截断只作用于 content 展示, 关键字段 (title/date/url) 恒保留 |
| KV-cache 前缀稳定 | ✅ 描述/schema 为一次性变更, 合入后前缀重新稳定 |

## 结论

1. **结果侧 -72.2% (合计 227,932 → 63,306 tokens)**, 其中两个灾难级单次调用
   (announcements 137K、klines 1年 34K) 被压到 6.9K / 19.5K; announcements 结果
   已低于 DSH spill 阈值 (50KB), 不再触发 read 往返。
2. **工具面 -9.2%/轮**, title 冗余清零; 描述改写带来调用预算引导 (防大调用)。
3. 0% 用例符合设计预期 (reconcile/special 不动, fund 单行平铺)。
4. 全量回归 205 passed + 10 skipped, CI (ruff + format + pytest + 双源契约) 全绿。

**建议: 合并。** 若后续希望进一步压缩 (klines 紧凑键、紧凑 JSON 序列化、
EDB 行内字段裁剪) 属 A2 范畴, 已在 DESIGN_CONTEXT_BUDGET.md 记录为暂缓项。
