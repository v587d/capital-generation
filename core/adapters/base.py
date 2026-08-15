"""Adapter base — one adapter per vendor, an independent failure domain.

Contract (docs/DEGRADATION.md + LESSONS §4):
- Adapters translate vendor responses into domain models and vendor failures into
  typed FinError with full context (vendor + endpoint + status + code + request_id).
- Adapters NEVER retry — backoff/failover belongs to the router.
- Every result carries provenance: source (规范名) + tier.

v0.2.0 (PLAN-0.2.0.md M1): capability-based surface. `capabilities` declares which
domains a vendor serves (按域主干+备用); the router skips vendors without the
capability. Default method bodies raise InternalError — a safety net only; the
router must not invoke unsupported domains.
"""

from __future__ import annotations

from collections.abc import Sequence

from core.domain.errors import InternalError
from core.domain.models import (
    Announcement,
    CalendarDay,
    EDBPoint,
    FinancialStatement,
    Instrument,
    Kline,
    Quote,
    SpecialData,
)
from core.domain.units import source_name

# 全部域键 (router _METHODS 的超集; 新增域在此登记)
ALL_DOMAINS = frozenset(
    {
        "search",
        "quote",
        "klines",
        "financials",
        "calendar",
        "special",
        "intraday",
        "announcements",
        "edb",
        # v0.3.0 fund/index 域 (PLAN-0.3.0.md M3/M4; 按域主干+备用)
        "fund_quote",
        "fund_nav",
        "fund_kline",
        "fund_holdings",
        "fund_holders",
        "fund_performance",
        "fund_info",
        "index_quote",
        "index_kline",
        "index_constituents",
        "index_fundamentals",
        "index_basicinfo",
    }
)


class BaseAdapter:
    """One adapter per vendor. Implement only the domains in `capabilities`."""

    vendor_id: str = ""
    capabilities: frozenset[str] = frozenset()

    def supports(self, domain: str) -> bool:
        return domain in self.capabilities

    def _unsupported(self, domain: str) -> InternalError:
        return InternalError(
            f"{source_name(self.vendor_id)} 不支持域 {domain} (capabilities: "
            f"{sorted(self.capabilities)})",
            source=source_name(self.vendor_id),
            vendor=self.vendor_id,
        )

    # ── v0.1.0 domains ─────────────────────────────────────────────────

    async def search_symbols(
        self, query: str, *, market: str | None = None, limit: int = 10
    ) -> list[Instrument]:
        """Live 消歧 search; returns canonical instruments."""
        raise self._unsupported("search")

    async def get_quote(self, symbols: Sequence[str]) -> list[Quote]:
        """Latest snapshot for ≤50 canonical symbols."""
        raise self._unsupported("quote")

    async def get_klines(
        self,
        symbol: str,
        start_ms: int,
        end_ms: int,
        *,
        adjust: str = "none",
    ) -> list[Kline]:
        """Daily OHLCV bars, inclusive [start, end]."""
        raise self._unsupported("klines")

    async def get_financials(
        self,
        symbol: str,
        statement: str,
        *,
        period: str = "annual",
        limit: int = 4,
    ) -> list[FinancialStatement]:
        """Financial statements (income/balance/cashflow/indicators)."""
        raise self._unsupported("financials")

    async def get_calendar(self) -> list[CalendarDay]:
        """Trading days (THS: fixed last-year window)."""
        raise self._unsupported("calendar")

    async def get_special_data(self, kind: str, **params: object) -> SpecialData:
        """Market-heat data (limit-up/ladder/hot/hot-history/dragon-tiger/anomaly)."""
        raise self._unsupported("special")

    # ── v0.2.0 domains ─────────────────────────────────────────────────

    async def get_intraday(
        self,
        symbol: str,
        period: str,
        start_ms: int,
        end_ms: int,
    ) -> list[Kline]:
        """Minute bars (Wind-exclusive; single trading day, see PLAN-0.2.0.md)."""
        raise self._unsupported("intraday")

    async def get_announcements(
        self, symbol: str, start_ms: int, end_ms: int, *, top_k: int = 10
    ) -> list[Announcement]:
        """Company announcements (Wind-exclusive RAG)."""
        raise self._unsupported("announcements")

    async def get_edb(
        self,
        indicator: str,
        start_ms: int | None = None,
        end_ms: int | None = None,
        *,
        observation: int = 10,
    ) -> list[EDBPoint]:
        """EDB macro/industry indicator series (Wind 主干; AKShare 白名单兜底)."""
        raise self._unsupported("edb")

    # ── v0.3.0 fund 域 (THS 主干免费 + Wind 补缺; 资产 gate 在工具层) ─────

    async def get_fund_quote(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[Quote]:
        """基金场内行情快照 (THS: 仅 ETF; Wind 兜底: 当日分钟行情, L3 标注)."""
        raise self._unsupported("fund_quote")

    async def get_fund_nav(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        """基金净值 (unit/adj; THS 免费主干)."""
        raise self._unsupported("fund_nav")

    async def get_fund_kline(self, symbol: str, start_ms: int, end_ms: int) -> list[Kline]:
        """基金日K (THS: ETF ≤5 年无复权; Wind 兜底: 全类型, 前复权标注)."""
        raise self._unsupported("fund_kline")

    async def get_fund_holdings(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        """基金重仓股 (定期披露, 非实时)."""
        raise self._unsupported("fund_holdings")

    async def get_fund_holders(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        """基金持有人结构 (机构/个人)."""
        raise self._unsupported("fund_holders")

    async def get_fund_performance(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        """基金收益表现 (区间收益率)."""
        raise self._unsupported("fund_performance")

    async def get_fund_info(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        """基金基本信息 (名称/管理人/经理/规模等)."""
        raise self._unsupported("fund_info")

    # ── v0.3.0 index 域 ─────────────────────────────────────────────────

    async def get_index_quote(self, symbols: Sequence[str]) -> list[Quote]:
        """指数行情快照 (THS 批量主干; Wind 兜底: 当日分钟行情, L3 标注)."""
        raise self._unsupported("index_quote")

    async def get_index_kline(self, symbol: str, start_ms: int, end_ms: int) -> list[Kline]:
        """指数日K (THS ≤10 年无复权; Wind 兜底)."""
        raise self._unsupported("index_kline")

    async def get_index_constituents(self, symbol: str) -> list[FinancialStatement]:
        """指数成分股 (THS 仅当前, 无历史)."""
        raise self._unsupported("index_constituents")

    async def get_index_fundamentals(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        """指数基本面 (Wind 独家, question 类)."""
        raise self._unsupported("index_fundamentals")

    async def get_index_basicinfo(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        """指数基本信息 (Wind 独家, question 类)."""
        raise self._unsupported("index_basicinfo")
