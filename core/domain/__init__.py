"""core.domain — the only cross-layer contract (models + FinError taxonomy).

Everything below is protocol-free: never import mcp/dsh here.
"""

from core.domain.errors import (
    AuthError,
    FinError,
    FinTimeoutError,
    InternalError,
    NoDataError,
    ParamError,
    QuotaError,
    RateLimitError,
    SourceDownError,
)
from core.domain.models import (
    CalendarDay,
    Envelope,
    FinancialStatement,
    Instrument,
    Kline,
    Quote,
    SpecialData,
)
from core.domain.units import (
    SOURCE_IDS,
    SOURCE_NAMES,
    TZ_CN,
    date_to_ms,
    ms_to_date,
    ms_to_iso_cn,
    now_ms,
    source_name,
    to_shares,
    utc_iso,
)

__all__ = [
    "AuthError",
    "FinError",
    "FinTimeoutError",
    "InternalError",
    "NoDataError",
    "ParamError",
    "QuotaError",
    "RateLimitError",
    "SourceDownError",
    "CalendarDay",
    "Envelope",
    "FinancialStatement",
    "Instrument",
    "Kline",
    "Quote",
    "SpecialData",
    "SOURCE_IDS",
    "SOURCE_NAMES",
    "TZ_CN",
    "date_to_ms",
    "ms_to_date",
    "ms_to_iso_cn",
    "now_ms",
    "source_name",
    "to_shares",
    "utc_iso",
]
