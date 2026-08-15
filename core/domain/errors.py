"""Typed error taxonomy — docs/DEGRADATION.md 判定表.

Rules:
- Adapters NEVER retry; they translate vendor failures into these typed errors with
  full context (vendor + endpoint + status + code + request_id). Retry/backoff/failover
  belongs to the router only.
- `retryable` drives the router: True → backoff-retry and/or next source in chain;
  False → return immediately (AUTH/PARAM/QUOTA/INTERNAL).
- `kind` is the external contract value (AUTH/PARAM/RATE_LIMIT/TIMEOUT/NO_DATA/
  SOURCE_DOWN/QUOTA/INTERNAL).
"""

from __future__ import annotations

from typing import ClassVar


class FinError(Exception):
    """Base class. Subclasses carry the taxonomy; never raise bare FinError."""

    kind: ClassVar[str] = "INTERNAL"
    retryable: ClassVar[bool] = False

    def __init__(
        self,
        message: str,
        *,
        source: str = "",
        vendor: str = "",
        endpoint: str = "",
        status: int | None = None,
        code: str | int | None = None,
        request_id: str | None = None,
        retryable: bool | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.source = source  # 规范名: 同花顺 / Wind / AKShare
        self.vendor = vendor  # internal id: ths / wind / akshare
        self.endpoint = endpoint
        self.status = status
        self.code = code
        self.request_id = request_id
        if retryable is not None:
            self.retryable = retryable  # type: ignore[misc]

    def as_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "retryable": self.retryable,
            "message": self.message,
            "source": self.source,
            "vendor": self.vendor,
            "endpoint": self.endpoint,
            "status": self.status,
            "code": self.code,
            "request_id": self.request_id,
        }


class AuthError(FinError):
    """401 / 2001 / 2003 — key missing/invalid/revoked. Never retry, never switch source."""

    kind = "AUTH"


class ParamError(FinError):
    """Parameter validation failed (THS 1001-1004). Return for the caller to fix."""

    kind = "PARAM"


class RateLimitError(FinError):
    """429 / 4001 — backoff-retry on the same source; do NOT switch source."""

    kind = "RATE_LIMIT"
    retryable = True


class FinTimeoutError(FinError):
    """Timeout — switch to the next source in the chain."""

    kind = "TIMEOUT"
    retryable = True


class NoDataError(FinError):
    """标的不存在 (3001) / no data. Try next source once, then return empty.

    3002 (数据尚未准备, 暂不可得) also maps here: keep `request_id`, may retry later,
    never fill zeros or mock data.
    """

    kind = "NO_DATA"
    retryable = True


class SourceDownError(FinError):
    """5xx / circuit open — switch source."""

    kind = "SOURCE_DOWN"
    retryable = True


class QuotaError(FinError):
    """Wind 积分不足 / quota exhausted. Gate the vendor (TTL 1 day), degrade, don't retry."""

    kind = "QUOTA"


class InternalError(FinError):
    """Unexpected — bug or unknown response shape."""

    kind = "INTERNAL"
