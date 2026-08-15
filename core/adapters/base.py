"""Adapter base — one adapter per vendor, an independent failure domain.

Contract (docs/DEGRADATION.md + LESSONS §4):
- Adapters translate vendor responses into domain models and vendor failures into
  typed FinError with full context (vendor + endpoint + status + code + request_id).
- Adapters NEVER retry — backoff/failover belongs to the router.
- Every result carries provenance: source (规范名) + tier.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence

from core.domain.models import (
    CalendarDay,
    FinancialStatement,
    Instrument,
    Kline,
    Quote,
    SpecialData,
)


class BaseAdapter(ABC):
    """v0.1.0 adapter surface (6 domains). Each method may raise FinError only."""

    vendor_id: str = ""

    @abstractmethod
    async def search_symbols(
        self, query: str, *, market: str | None = None, limit: int = 10
    ) -> list[Instrument]:
        """Live 消歧 search; returns canonical instruments."""

    @abstractmethod
    async def get_quote(self, symbols: Sequence[str]) -> list[Quote]:
        """Latest snapshot for ≤50 canonical symbols."""

    @abstractmethod
    async def get_klines(
        self,
        symbol: str,
        start_ms: int,
        end_ms: int,
        *,
        adjust: str = "none",
    ) -> list[Kline]:
        """Daily OHLCV bars, inclusive [start, end]."""

    @abstractmethod
    async def get_financials(
        self,
        symbol: str,
        statement: str,
        *,
        period: str = "annual",
        limit: int = 4,
    ) -> list[FinancialStatement]:
        """Financial statements (income/balance/cashflow/indicators)."""

    @abstractmethod
    async def get_calendar(self) -> list[CalendarDay]:
        """Trading days (THS: fixed last-year window)."""

    @abstractmethod
    async def get_special_data(self, kind: str, **params: object) -> SpecialData:
        """Market-heat data (limit-up/ladder/hot/hot-history/dragon-tiger/anomaly)."""
