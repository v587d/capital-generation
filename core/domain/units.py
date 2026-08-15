"""Units & time conventions — docs/DATA_MODEL.md.

- Timestamps: int ms since epoch, Asia/Shanghai — NEVER naive datetime, NEVER
  host-tz-dependent mktime (the 16h trap).
- Volume: unified 股. THS/Wind already return 股; AKShare partial endpoints return 手
  → conversion table driven (`to_shares`).
- Only *physical* unit conversion (手→股); never semantic conversion (percent→fraction).
- Source display names are canonical: 同花顺 / Wind / AKShare (docs/DEGRADATION.md).

L3 ratios/calibers: pass through as-is, never convert.
"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

TZ_CN = ZoneInfo("Asia/Shanghai")
EPOCH_CN = datetime(1970, 1, 1, tzinfo=TZ_CN)

# Internal vendor id → 规范名 (对外/信封/工具返回值必须用规范名).
SOURCE_NAMES: dict[str, str] = {
    "ths": "同花顺",
    "wind": "Wind",
    "akshare": "AKShare",
}

SOURCE_IDS: dict[str, str] = {v: k for k, v in SOURCE_NAMES.items()}


def source_name(vendor_id: str) -> str:
    """vendor_id (ths/wind/akshare) → display name (同花顺/Wind/AKShare)."""
    return SOURCE_NAMES.get(vendor_id, vendor_id)


def date_to_ms(date_str: str) -> int:
    """'YYYY-MM-DD' → Asia/Shanghai midnight ms. Explicit tz — never time.mktime.

    `.timestamp()` on an *aware* datetime is host-tz independent (converts to UTC
    internally); subtracting same-tz aware datetimes would give wall-clock deltas.
    """
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=TZ_CN)
    return int(dt.timestamp() * 1000)


def ms_to_date(ms: int) -> str:
    """Asia/Shanghai ms → 'YYYY-MM-DD' (calendar day in CN tz)."""
    dt = datetime.fromtimestamp(ms / 1000, tz=TZ_CN)
    return dt.strftime("%Y-%m-%d")


def now_ms() -> int:
    """Current time as Asia/Shanghai ms (query time for envelopes)."""
    return int(datetime.now(tz=TZ_CN).timestamp() * 1000)


def _to_shares_hand(value: float) -> float:
    return value * 100.0


def to_shares(value: float, unit: str) -> float:
    """Physical unit conversion into 股 (L2). Unknown units raise — never guess.

    unit is the *vendor-declared* unit of `value`: "股"/"手"/"张"...
    """
    u = unit.strip()
    if u in ("股", "share", "shares", ""):
        return value
    if u == "手":
        return _to_shares_hand(value)
    raise ValueError(f"unknown volume unit: {unit!r} (annotate, don't guess)")


def ms_to_iso_cn(ms: int) -> str:
    """Asia/Shanghai ms → ISO-8601 with +08:00 tag (for envelope `ts`)."""
    return datetime.fromtimestamp(ms / 1000, tz=TZ_CN).isoformat(timespec="milliseconds")


def utc_iso(ms: int) -> str:
    """Asia/Shanghai ms → UTC ISO-8601 (machine-readable envelope ts)."""
    dt = datetime.fromtimestamp(ms / 1000, tz=TZ_CN).astimezone(UTC)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
