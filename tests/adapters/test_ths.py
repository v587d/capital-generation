"""M3: THS adapter unit tests — fixture-driven, no live network (LESSONS §4.3)."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from core.adapters.ths import THSAdapter
from core.domain.errors import AuthError, ParamError, RateLimitError

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "ths"


def load(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


# fixture file name → endpoint path suffix
FIXTURE_PATHS: dict[str, str] = {
    "quote_batch": "prices/snapshot",
    "kline_600519": "prices/historical",
    "income_600519": "income-statements",
    "balance_600519": "balance-sheets",
    "calendar": "trading-days",
    "limit_up_pool": "limit-up-pool",
    "hot_stock_list": "hot-stock-list",
    "dragon_tiger": "dragon-tiger-list",
}


def make_adapter(*fixture_names: str) -> THSAdapter:
    """MockTransport serving canned bodies keyed by endpoint path suffix."""
    cases = {FIXTURE_PATHS[n]: load(n) for n in fixture_names}

    def handler(request: httpx.Request) -> httpx.Response:
        for suffix, body in cases.items():
            if request.url.path.endswith(suffix):
                return httpx.Response(200, json=body)
        return httpx.Response(
            404, json={"code": -1, "message": f"no fixture for {request.url.path}"}
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return THSAdapter(api_key="test-key", client=client)


def make_adapter_with(cases: dict[str, dict]) -> THSAdapter:
    """MockTransport serving raw canned bodies keyed by endpoint path suffix."""

    def handler(request: httpx.Request) -> httpx.Response:
        for suffix, body in cases.items():
            if request.url.path.endswith(suffix):
                return httpx.Response(200, json=body)
        return httpx.Response(
            404, json={"code": -1, "message": f"no fixture for {request.url.path}"}
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return THSAdapter(api_key="test-key", client=client)


class TestQuote:
    @pytest.mark.asyncio
    async def test_batch_quote(self) -> None:
        adapter = make_adapter("quote_batch")
        quotes = await adapter.get_quote(["600519.SH", "000001.SZ", "300750.SZ"])
        await adapter.aclose()
        assert len(quotes) == 3
        q = quotes[0]
        assert q.symbol == "600519.SH"
        assert q.source == "同花顺"
        assert q.tier == "free"
        assert q.volume >= 0 and q.last_price > 0
        assert q.currency == "CNY"

    @pytest.mark.asyncio
    async def test_bare_code_rejected(self) -> None:
        adapter = make_adapter("quote_batch")
        with pytest.raises(ParamError):
            await adapter.get_quote(["600519"])
        await adapter.aclose()

    @pytest.mark.asyncio
    async def test_too_many_symbols(self) -> None:
        adapter = make_adapter("quote_batch")
        with pytest.raises(ParamError):
            await adapter.get_quote([f"{i:06d}.SH" for i in range(51)])
        await adapter.aclose()


class TestKline:
    @pytest.mark.asyncio
    async def test_inclusive_start_filter(self) -> None:
        # fixture was recorded with start-1d; adapter must filter out the pre-start bar
        adapter = make_adapter("kline_600519")
        bars = await adapter.get_klines(
            "600519.SH", start_ms=1_700_000_000_000, end_ms=2_000_000_000_000
        )
        await adapter.aclose()
        assert bars, "fixture should contain bars"
        for b in bars:
            assert b.symbol == "600519.SH"
            assert b.source == "同花顺"
            assert b.adjust == "none"

    @pytest.mark.asyncio
    async def test_bad_adjust(self) -> None:
        adapter = make_adapter("kline_600519")
        with pytest.raises(ParamError):
            await adapter.get_klines("600519.SH", 1, 2, adjust="hfq")
        await adapter.aclose()


class TestFinancials:
    @pytest.mark.asyncio
    async def test_income_statement(self) -> None:
        adapter = make_adapter("income_600519")
        rows = await adapter.get_financials("600519.SH", "income", period="annual", limit=2)
        await adapter.aclose()
        assert rows and rows[0].statement == "income"
        assert rows[0].source == "同花顺"
        assert rows[0].caliber == "年度"
        # L3 passthrough: row dicts keep vendor field names
        assert any("net_profit" in dict(row) for row in rows[0].rows)

    @pytest.mark.asyncio
    async def test_bad_statement(self) -> None:
        adapter = make_adapter("income_600519")
        with pytest.raises(ParamError):
            await adapter.get_financials("600519.SH", "nope")
        await adapter.aclose()


class TestCalendar:
    @pytest.mark.asyncio
    async def test_calendar(self) -> None:
        adapter = make_adapter("calendar")
        days = await adapter.get_calendar()
        await adapter.aclose()
        assert days
        assert all(d.is_trading for d in days)
        assert days[0].source == "同花顺"


class TestSpecial:
    @pytest.mark.asyncio
    async def test_limit_up_pool(self) -> None:
        adapter = make_adapter("limit_up_pool")
        data = await adapter.get_special_data("limit-up", size=5)
        await adapter.aclose()
        assert data.kind == "limit-up"
        assert isinstance(data.items, tuple)  # 非交易日合法为空集
        assert data.source == "同花顺"

    @pytest.mark.asyncio
    async def test_hot_and_dragon_tiger(self) -> None:
        adapter = make_adapter("hot_stock_list", "dragon_tiger")
        hot = await adapter.get_special_data("hot", period="day")
        dt = await adapter.get_special_data("dragon-tiger", board_type="all")
        await adapter.aclose()
        assert hot.items  # 热榜应有数据
        assert isinstance(dt.items, tuple)  # 龙虎榜非交易日可能为空
        assert dt.kind == "dragon-tiger"

    @pytest.mark.asyncio
    async def test_unknown_kind(self) -> None:
        adapter = make_adapter("hot_stock_list")
        with pytest.raises(ParamError):
            await adapter.get_special_data("whatever")
        await adapter.aclose()


class TestErrors:
    @pytest.mark.asyncio
    async def test_business_code_maps_to_kind(self) -> None:
        adapter = make_adapter_with(
            {
                "prices/snapshot": {
                    "code": 4001, "message": "限流", "request_id": "r-1", "data": None,
                }
            }
        )
        with pytest.raises(RateLimitError) as ei:
            await adapter.get_quote(["600519.SH"])
        await adapter.aclose()
        assert ei.value.code == 4001
        assert ei.value.request_id == "r-1"
        assert ei.value.retryable  # RATE_LIMIT: backoff, don't switch

    @pytest.mark.asyncio
    async def test_http_401_maps_to_auth(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"code": 2001, "message": "invalid key"})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        adapter = THSAdapter(api_key="bad", client=client)
        with pytest.raises(AuthError) as ei:
            await adapter.get_quote(["600519.SH"])
        await adapter.aclose()
        assert not ei.value.retryable
