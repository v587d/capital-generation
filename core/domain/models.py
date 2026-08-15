"""L1/L2/L3 domain models — the only cross-layer contract (docs/DATA_MODEL.md).

L1: identity (symbol/asset_type/exchange). L2: unified semantics (Asia/Shanghai ms,
volume in 股, explicit currency). L3: caliber is *declared*, never converted.

Every data row carries provenance: source (规范名: 同花顺/Wind/AKShare, per
docs/DEGRADATION.md), tier (free/quota/paid), degraded + warnings (observability).
Vendor-specific fields pass through in `extra` (OpenBB-style).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, TypeVar

# ──────────────────────────────────────────────────────────────────────
# L1 identity
# ──────────────────────────────────────────────────────────────────────

AssetType = str  # "stock" | "bond" | "index" | "fund" | "fund-etf" | ...
Market = str  # "A股" | "港股" | "美股" | "指数" | "板块" | "基金" | "债券" | "可转债"


@dataclass(frozen=True)
class Instrument:
    """L1: unified instrument identity (canonical symbol is the mapping key).

    `asset_type` is the canonical class (stock/fund/index/...); `subtype` keeps
    the vendor leaf class (THS: fund-etf/fund-lof/fund-otc/fund-reits/...) — some
    vendor endpoints need the leaf (THS fund_type), v0.3.0 (PLAN-0.3.0.md M4).
    """

    symbol: str  # canonical, e.g. 600519.SH
    name: str
    asset_type: str
    exchange: str  # SH / SZ / BJ / HK / US / ...
    currency: str = "CNY"
    subtype: str = ""  # vendor leaf class (THS ticker-list asset_type), "" = 无


# ──────────────────────────────────────────────────────────────────────
# L2 data rows (provenance-carrying)
# ──────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Quote:
    """L1 + L2: latest price snapshot."""

    symbol: str
    last_price: float
    open_price: float | None
    high_price: float | None
    low_price: float | None
    prev_close: float | None
    change_pct: float | None  # 涨跌幅, percent raw value (8.88 = 8.88%, L3: no conversion)
    volume: float  # L2: 股 (手→股 conversion is adapter/units work)
    turnover: float  # L2: raw currency
    as_of_ms: int  # L2: data time point (数据时点 ≠ query time; reconcile on as_of)
    currency: str = "CNY"
    source: str = ""  # 规范名: 同花顺 / Wind / AKShare
    tier: str = ""  # free / quota / paid
    degraded: bool = False
    extra: dict[str, Any] = field(default_factory=dict)  # provider-specific passthrough


@dataclass(frozen=True)
class Kline:
    """L1 + L2: one OHLCV bar. adjust is an L3 declaration, never converted.

    `period` (1d / 1m / 5m / 15m / 30m / 60m) tags the bar frequency; intraday
    bars are Wind-exclusive (v0.2.0, single trading day window).
    """

    symbol: str
    date_ms: int  # L2: Asia/Shanghai ms
    open: float
    high: float
    low: float
    close: float
    volume: float  # L2: 股
    turnover: float
    currency: str = "CNY"
    period: str = "1d"  # L3: bar frequency tag (1d / 1m / 5m / 15m / 30m / 60m)
    adjust: str = "none"  # L3: none/forward/backward — declared only
    source: str = ""  # 规范名
    tier: str = ""  # free/quota/paid
    degraded: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class FinancialStatement:
    """L1 + L2 header for a financial statement; rows are L3 passthrough.

    Statement rows keep vendor field names verbatim (`rows` as dicts is deliberate:
    statement line items are vendor-defined and must not be normalized — see
    docs/DATA_MODEL.md L3 "annotate only, never convert").

    `report_date_ms` is None when the source does not declare a report period
    (e.g. Wind fundamentals answer rows key periods in column names, and Wind
    price-indicators are point-in-time — see docs/LESSONS.md §5.2/§7).
    """

    symbol: str
    statement: str  # income / balance / cashflow / indicators
    report_date_ms: int | None  # report period date (Asia/Shanghai ms), None = 源未声明
    rows: tuple[dict[str, Any], ...]
    currency: str = "CNY"
    caliber: str = ""  # L3 tag: 年度/季度/半年度/TTM/MRQ
    source: str = ""
    tier: str = ""
    degraded: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SpecialData:
    """THS-exclusive market-heat data (涨停/连板/异动/热榜/龙虎榜)."""

    kind: str  # limit-up / limit-up-ladder / hot / hot-history / dragon-tiger / anomaly-stock
    date_ms: int | None
    items: tuple[dict[str, Any], ...]
    source: str = ""
    tier: str = ""
    degraded: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CalendarDay:
    """One trading-calendar day."""

    date_ms: int
    is_trading: bool
    source: str = ""
    tier: str = ""
    degraded: bool = False


@dataclass(frozen=True)
class Announcement:
    """Wind-exclusive announcement RAG hit (financial_docs.get_company_announcements).

    `content` is the announcement text verbatim (L3 passthrough); the vendor also
    reports title / publish date / relevance / url.
    """

    symbol: str
    title: str
    date_ms: int  # 公告发布日期 (Asia/Shanghai ms)
    content: str
    url: str = ""
    source: str = ""  # 规范名
    tier: str = ""  # free/quota/paid
    degraded: bool = False
    extra: dict[str, Any] = field(default_factory=dict)  # doc_type / relevance 等


@dataclass(frozen=True)
class EDBPoint:
    """One EDB (宏观/行业指标) observation — Wind EDB or AKShare 白名单兜底.

    L3: unit / magnitude / freq / currency are *annotated*, never converted
    (docs/DATA_MODEL.md 铁律: 只做物理单位转换, 不做语义转换).
    `date_ms` is None when the source period label cannot be parsed (AKShare
    兜底用 label + extra 标注, 不猜日期).
    """

    indicator: str  # 指标名称 (Wind: meta.name; AKShare: 白名单别名)
    code: str  # Wind EDB 指标代码 (如 M5567876); AKShare 兜底为白名单 key
    date_ms: int | None  # Asia/Shanghai ms (yyyyMMdd); None = 源未给出可解析日期
    value: float | None  # 原始值 (INVALID → None, 不猜)
    unit: str = ""  # L3 标注: 亿元 / % / 万元 ...
    magnitude: str = ""  # L3 标注: 亿 / 万 / 10k ...
    freq: str = ""  # L3 标注: 季 / 月 / 年 ...
    currency: str = ""  # L3 标注
    date_label: str = ""  # 源给出的原始日期/期间标签 (AKShare 兜底)
    source: str = ""  # 规范名
    tier: str = ""  # free/quota/paid
    degraded: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


# ──────────────────────────────────────────────────────────────────────
# Envelope: query-time + degradation notes wrap any domain payload
# ──────────────────────────────────────────────────────────────────────

T = TypeVar("T")


@dataclass(frozen=True)
class Envelope[T]:
    """Result wrapper: `data` carries provenance; envelope adds query time + warnings."""

    data: T
    ts_ms: int  # query time, Asia/Shanghai ms (data's own time is data.as_of_ms/date_ms)
    warnings: tuple[str, ...] = ()
