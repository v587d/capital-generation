# 降级链与错误分类(路由层)

> 来源:`research/方案回顾与漏洞评审.md` §2 OP1 + §3.3、`dsh金融数据插件设计.md` §3.3。
> 原则:主干+按域备用(不是三源平权);错误必须先分类再路由;降级必须可观测。

## 按数据域的"主干 + 备用"(OP1)

| 数据域 | 主干 | 备用 | 说明 |
|---|---|---|---|
| A股行情/K线 | THS(免费官方) | AKShare | 不用 Wind 兜行情(贵) |
| 财务三表/指标 | Wind(权威) | THS → AKShare | 权威性优先; v0.2.0 链 `[wind, ths, akshare]` |
| 分钟线 | Wind | —(无备) | 独家, 无降级, **明确告知用户**; 仅单交易日 (积分纪律) |
| 公告 | Wind | —(无备) | 独家 RAG, 无降级, **明确告知用户** |
| EDB/宏观 | Wind | AKShare **白名单** | 白名单外指标 AKShare 不兜底 (config/akshare_edb.yaml); 口径不同 L3 标注 |
| 热榜/异动/连板/龙虎榜 | THS | AKShare 同名接口 | THS 独家能力为主 |
| **基金 (v0.3.0)** | THS(免费) | Wind | 净值/收益/持仓/持有人/资料 THS 全类型; 场内快照/日K 仅 ETF → LOF/OTC 由 Wind 兜底 (分钟行情/全类型K, L3 标注差异) |
| **指数 (v0.3.0)** | THS(免费) | Wind | 行情/K线/成分 THS 主干 (无复权语义, 成分仅当前); 基本面/基本信息 Wind 独家 (question 类, 无降级源) |
| **数据湖 (v0.3.0)** | 官方 marketdb CLI | — | **纯离线数据资产, 不进 LLM** (用户裁定); 全市场扫描类需求走 `scripts/lake.py`, 工具面明示不支持 |
| 美股/加密/另类 | AKShare | —(无备) | 免费源独占域, 接受其不稳定性 |

```yaml
# config/chains.yaml(配置外置,不写死在代码里)
quote:      [ths, akshare]        # 快照不烧 Wind 积分
klines:     [ths, akshare]
intraday:   [wind]                # 分钟线 Wind 独家 (无降级源, 明确告知)
financials: [wind, ths, akshare]
announcements: [wind]             # 公告 Wind 独家 (无降级源, 明确告知)
edb:        [wind, akshare]       # 宏观: Wind 主干, AKShare 仅白名单兜底
special:    [ths, akshare]
macro:      [wind, akshare]
# v0.3.0 (PLAN-0.3.0.md §2.3): 基金/指数 — THS 免费主干, Wind 补缺
fund_quote: [ths, wind]           # 场内快照 THS 仅 ETF; LOF/OTC → Wind 分钟行情 (L3 标注)
fund_nav:   [ths, wind]
fund_kline: [ths, wind]           # THS 仅 ETF ≤5 年无复权; Wind 兜底全类型
fund_holdings: [ths, wind]
fund_holders: [ths, wind]
fund_performance: [ths, wind]
fund_info:  [ths, wind]
index_quote: [ths, wind]          # 指数行情 THS 主干
index_kline: [ths, wind]
index_constituents: [ths, wind]   # 成分仅当前无历史 (THS 能力边界, 明示)
index_fundamentals: [wind]        # Wind 独家 (question 类, 无降级源)
index_basicinfo: [wind]           # Wind 独家 (question 类, 无降级源)
```

## 错误分类(判定表外置,新源接入只声明自己的错误码映射)

```python
class FinError(Exception):
    kind: str  # AUTH / PARAM / RATE_LIMIT / TIMEOUT / NO_DATA / SOURCE_DOWN / QUOTA / INTERNAL
    retryable: bool
    source: str
```

| kind | 判定 | 路由层动作 | 模型看到 |
|---|---|---|---|
| AUTH | 401/2001/2003 | **不重试、不换源**(换源也没 Key) | "THS Key 无效,请检查配置" |
| PARAM | 参数校验失败 | 不重试,直接返回 | 错误信息 + 建议修正(模型自行改参) |
| RATE_LIMIT | 429/4001 | **指数退避重试,不换源** | 重试后的结果或明确限流提示 |
| TIMEOUT | 超时 | 换源(链内下一个) | 结果 + `degraded: true` |
| NO_DATA | 标的不存在(3001)/无数据;**3002=数据尚未准备(暂不可得)** | 换源一次,仍无则返回空;**3002 保留 request_id 稍后可重试** | 空结果 + 说明(3002 注明"稍后再查",不得补零/模拟) |
| SOURCE_DOWN | 5xx/熔断 | 换源 | 结果 + `degraded: true` |
| QUOTA | Wind 积分不足 | **门控跳过该源 + 降级提示**(不重试、不换源);门控 **TTL 1 天**(对齐 Wind 每日积分重置),到期自动恢复 | 结果 + `degraded: true`(注明"Wind 配额不足,已降级") |

> **QUOTA 行为澄清 (v0.2.0 实测语义)**：触发配额错误的那一次调用**立即报 QUOTA 错误并门控 1 天**（不换源——换源也救不了本次请求）；门控期内后续调用**跳过 Wind、走链内下一源**（如 financials → THS），返回 `degraded: true` 结果。不允许"降级一次后永久按降级处理"。

**为什么**:认证失败重试一万次也没用;限流应退避而不是换源烧别的源;只有 TIMEOUT/NO_DATA/SOURCE_DOWN 才值得在链内消耗下一个源。

## 熔断与缓存

- 熔断:某源连续失败 ≥5 次 → 冷却 60s,冷却期直接跳过;成功即复位;半开试探
- QUOTA 门控:配额耗尽 → Disable(跳过 + 降级提示),**TTL 1 天**(对齐 Wind 每日积分重置),到期自动恢复 Enable;再次耗尽再次降级——不允许"降级一次后永久按降级处理"
- 缓存:快照 30s TTL、K线按 (symbol, period, adjust) 当日;LRU 上限,防内存泄漏
- 超时:快照 10s / K线 30s / 批量 60s,超时即切源
- AKShare 调用包"信号量 + 硬超时 + 线程池上限"(线程不可取消,外层超时后丢弃结果并记录)

## 可观测性(禁止静默降级)

- 每个结果必带 `source` + `degraded` 元数据;`source` 对外取值一律用规范名 **`同花顺` / `Wind` / `AKShare`**(不缩写 ths/wind/akshare;**Wind 首字母大写 W**);内部 vendor id 可用小写缩写,但信封/工具返回值必须是规范名
- 降级事件计数/日志,连续降级 N 次提醒人工检查上游故障

## AKShare 兜底纪律(P0-2,反模式禁令)

- ❌ 禁止全市场拉取再本地过滤(如 `stock_zh_a_spot_em` 5000+ 行只取 50 只)——东财限频,免费源会变成最先挂的源
- ✅ 单标的/小批量取数 + 频率闸(≥2s/次);全市场快照类需求走数据湖(THS Parquet → DuckDB)
- 锁 akshare 版本 + 每接口 golden 回归测试,升级前先跑(接口漂移在 CI 暴露而非线上)
