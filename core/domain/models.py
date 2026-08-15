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
    """L1: unified instrument identity (canonical symbol is the mapping key)."""

    symbol: str  # canonical, e.g. 600519.SH
    name: str
    asset_type: str
    exchange: str  # SH / SZ / BJ / HK / US / ...
    currency: str = "CNY"


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
    """L1 + L2: one OHLCV bar. adjust is an L3 declaration, never converted."""

    symbol: str
    date_ms: int  # L2: Asia/Shanghai ms
    open: float
    high: float
    low: float
    close: float
    volume: float  # L2: 股
    turnover: float
    currency: str = "CNY"
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
    """

    symbol: str
    statement: str  # income / balance / cashflow / indicators
    report_date_ms: int  # report period date (Asia/Shanghai ms)
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
