# 数据模型:适配均衡点(L1/L2 做死,L3 只标注)

> 来源:`research/方案回顾与漏洞评审.md` §3 + OP4(参考 OpenBB Standardization)。
> 均衡点定义:太浅 → 字段/单位错误且不可见;太深 → 维护成本爆炸、对账失去可比性。
> **结论:L1 标识 + L2 语义做死,L3 口径只标注不转换。**

## 三档策略

| 档位 | 做 | 不做 |
|---|---|---|
| **L1 标识层**(必做) | symbol 归一、资产类别、市场 | — |
| **L2 语义层**(必做) | 字段名统一(open/high/low/close/volume/turnover)、时间统一 **Asia/Shanghai 毫秒 int**、volume 统一**股**、currency 显式 | 不隐式转换业务口径 |
| **L3 口径层**(不归一) | 复权算法、财报合并口径、行业分类、比率单位 → **参数显式声明 + 响应标注** | 不做跨源转换(复权、百分数→小数) |

## 标准模型(核心字段,dataclass)

```python
@dataclass(frozen=True)
class Instrument:      # L1
    symbol: str        # 统一代码(如 600519.SH)
    name: str
    asset_type: str    # stock/bond/index/fund
    exchange: str
    currency: str = "CNY"
    subtype: str = ""  # v0.3.0: vendor 叶类别 (THS: fund-etf/fund-lof/fund-otc/fund-reits...)
                       # 某些 vendor 端点需要叶类别 (THS fund_type), canonical 类别不够

@dataclass(frozen=True)
class Kline:           # L1 + L2
    symbol: str
    date_ms: int       # L2: Asia/Shanghai 毫秒,绝不 naive datetime
    open/high/low/close: float   # L2: 原始货币
    volume: float      # L2: 统一"股"(手→股由转换表驱动)
    turnover: float    # L2: 原始货币
    currency: str = "CNY"
    period: str = "1d"     # L3: 频率标签 1d/1m/5m/15m/30m/60m (v0.2.0 分钟线 Wind 独家)
    adjust: str = "none"   # L3: 声明,不转换 (Wind aftype=0 → 标注 forward, 永不当未复权)
    source: str = ""       # 可观测性(规范名:同花顺/Wind/AKShare,见 DEGRADATION.md)
    tier: str = ""         # free/quota/paid:配额消耗可见(Wind=quota)
    degraded: bool = False
    extra: dict = field(default_factory=dict)  # provider 特有字段透传(OpenBB 同款)

@dataclass(frozen=True)
class Announcement:    # L1 + L2 (v0.2.0, Wind 独家 RAG)
    symbol: str
    title: str
    date_ms: int       # 公告发布日期 (Asia/Shanghai 毫秒)
    content: str       # 公告文本逐字透传 (L3)
    url: str = ""
    source: str = ""; tier: str = ""; degraded: bool = False
    extra: dict = field(default_factory=dict)  # doc_type / relevance

@dataclass(frozen=True)
class EDBPoint:        # L1 + L2 (v0.2.0, Wind EDB / AKShare 白名单兜底)
    indicator: str     # 指标名称 (Wind meta.name / AKShare 列名)
    code: str          # Wind EDB 指标代码 (如 M5567876) / AKShare 白名单 key
    date_ms: int | None  # yyyyMMdd → Asia/Shanghai 毫秒; None = 源期间标签不可解析 (不猜)
    value: float | None  # 原始值 (INVALID → None, 不猜)
    unit: str = ""     # L3 标注 (亿元/%/万元), 不转换
    magnitude: str = ""; freq: str = ""; currency: str = ""
    date_label: str = ""  # 源原始期间标签 (AKShare 兜底)
    source: str = ""; tier: str = ""; degraded: bool = False

# Quote / CorporateAction(除复权事件流)/ FinancialStatement / SpecialData 同理:
# L1+L2 字段统一,provider 特有字段进 extra 或显式标注
# v0.2.0: FinancialStatement.report_date_ms 可为 None — Wind NL 回答报告期在列名,
#   源未声明报告期时不猜 (L3: 标注不转换)
# v0.3.0: 基金/指数域行数据 (nav/holdings/holders/performance/info/fundamentals/
#   basicinfo/constituents) 一律用 FinancialStatement(statement=<kind>, rows=透传)
#   — vendor 字段名即口径, 只标注不归一 (与财务行同款 L3 纪律); 快照/K线用 Quote/Kline
#   (fund_quote Wind 兜底为分钟行情 → Kline period="1m" + extra.note 标注差异)
```

## 单位与时间转换表(显式、可配置)

| 字段 | THS | AKShare(东财) | Wind | 统一 |
|---|---|---|---|---|
| volume | 股 | 手(部分接口)/股 | 股 | **股**(转换表驱动) |
| 时间戳 | 毫秒 | datetime/字符串 | 契约自带 meta | 毫秒(Asia/Shanghai) |
| 价格 | 原始货币 | 原始货币 | 原始货币 | 原始货币 + currency |
| 比率 | 百分数原值(8.88=8.88%) | 部分为小数 | meta 声明 | **跟随源标注,不转换**(L3) |

**铁律:只做"物理单位"转换(手→股),不做"语义转换"(百分数→小数)。** 后者标注清楚,交给模型或下游。

## 时间陷阱(实测踩过)

- `time.mktime` 依赖主机时区,与 THS 上海零点毫秒差 16 小时 → 一律用 Asia/Shanghai 显式构造
- 数据时点 ≠ 查询时点:快照类数据自带数据时点(`as_of_ms`),查询时间与数据时点分开记录;对账只比数据时点(实测:部分源数据滞后查询时刻可达分钟级,见 `docs/LESSONS.md` §5.3/§6)
- 全市场快照等大结果集禁止在适配器内物化列表 → generator/惰性迭代(见 `docs/PYTHON.md`)
