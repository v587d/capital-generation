"""M3: THS adapter unit tests — fixture-driven, no live network (LESSONS §4.3)."""

from __future__ import annotations

import asyncio
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
                    "code": 4001,
                    "message": "限流",
                    "request_id": "r-1",
                    "data": None,
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


# ── v0.3.0 fund/index 域 (M4; canned 官方契约形状, THS fixtures 录制后补回放) ──


def _env(data: dict) -> dict:
    return {"code": 0, "message": "success", "request_id": "t", "data": data}


def make_fund_adapter(cases: dict[str, dict]) -> THSAdapter:
    return make_adapter_with(cases)


class TestFundDomain:
    async def test_fund_quote_snapshot(self) -> None:
        a = make_fund_adapter(
            {
                "fund/market/snapshot": _env(
                    {
                        "timestamp": 1784210584000,
                        "item": [
                            {
                                "thscode": "510300.SH",
                                "ticker": "510300",
                                "last_price": 4.753,
                                "open_price": 4.775,
                                "high_price": 4.825,
                                "low_price": 4.724,
                                "prev_price": 4.838,
                                "price_change_ratio_pct": -1.756924,
                                "volume": 1657822800,
                                "turnover": 7909234100,
                            }
                        ],
                    }
                )
            }
        )
        q = (await a.get_fund_quote("510300.SH"))[0]
        assert q.symbol == "510300.SH"
        assert q.last_price == 4.753
        assert q.volume == 1657822800  # 股 (THS 原生)
        assert q.source == "同花顺"
        assert q.tier == "free"

    async def test_fund_quote_lof_3004_falls_to_nodata(self) -> None:
        """LOF 场内快照 → THS 3004 (能力边界) → NoDataError → 路由换 Wind (M4 定向例外)."""
        from core.domain.errors import NoDataError

        a = make_fund_adapter(
            {
                "fund/market/snapshot": {
                    "code": 3004,
                    "message": "标的类型不支持该能力",
                    "request_id": "t",
                    "data": None,
                }
            }
        )
        with pytest.raises(NoDataError):
            await a.get_fund_quote("160105.SZ")

    async def test_fund_kline(self) -> None:
        from core.domain.units import date_to_ms

        a = make_fund_adapter(
            {
                "fund/market/historical": _env(
                    {
                        "timestamp": 1784131200000,
                        "item": [
                            {
                                "date_ms": date_to_ms("2026-07-01"),
                                "open_price": 4.70,
                                "high_price": 4.76,
                                "low_price": 4.69,
                                "close_price": 4.75,
                                "volume": 1.2e8,
                                "turnover": 5.7e8,
                            }
                        ],
                    }
                )
            }
        )
        b = (
            await a.get_fund_kline("510300.SH", date_to_ms("2026-07-01"), date_to_ms("2026-07-10"))
        )[0]
        assert b.period == "1d"
        assert b.adjust == "none"  # THS 基金日K 无复权语义
        assert b.close == 4.75
        assert "仅 ETF" in b.extra["note"]

    async def test_fund_nav(self) -> None:
        a = make_fund_adapter(
            {
                "fund/performance/nav": _env(
                    {
                        "timestamp": 1784131200000,
                        "item": [{"nav_date": 1752595200000, "unit_nav": 4.0713, "adj_nav": 4.5}],
                    }
                )
            }
        )
        s = (await a.get_fund_nav("510300.SH", asset_type="fund-etf"))[0]
        assert s.statement == "nav"
        assert s.rows[0]["unit_nav"] == 4.0713
        assert s.source == "同花顺"

    async def test_fund_holdings(self) -> None:
        a = make_fund_adapter(
            {
                "fund/portfolio/holdings": _env(
                    {
                        "timestamp": 0,
                        "item": [
                            {
                                "thscode": "300750.SZ",
                                "ticker": "300750",
                                "stock_name": "宁德时代",
                                "hold_ratio": 4.67,
                            }
                        ],
                    }
                )
            }
        )
        s = (await a.get_fund_holdings("510300.SH", asset_type="fund-etf"))[0]
        assert s.statement == "holdings"
        assert "定期披露" in s.extra["note"]

    async def test_fund_holders_and_info(self) -> None:
        a = make_fund_adapter(
            {
                "fund/holders/detail": _env(
                    {
                        "timestamp": 1767110400000,
                        "item": [
                            {
                                "merge_scope": "merged",
                                "report_date_ms": 1609344000000,
                                "ins_position": 0.18,
                                "holder_amount": 7058156,
                            }
                        ],
                    }
                ),
                "fund/profile/detail": _env(
                    {
                        "timestamp": 1784210313786,
                        "item": [
                            {
                                "thscode": "510300.SH",
                                "fund_name": "沪深300ETF",
                                "estab_date": 1767024000000,
                                "mgmt_name": "华夏基金管理有限公司",
                            }
                        ],
                    }
                ),
            }
        )
        h = (await a.get_fund_holders("161725.SZ", asset_type="fund-lof"))[0]
        assert h.statement == "holders"
        assert h.rows[0]["ins_position"] == 0.18
        i = (await a.get_fund_info("510300.SH", asset_type="fund-etf"))[0]
        assert i.statement == "info"
        assert i.rows[0]["fund_name"] == "沪深300ETF"

    async def test_fund_performance(self) -> None:
        a = make_fund_adapter(
            {
                "fund/performance/returns": _env(
                    {"timestamp": 0, "item": [{"return_year": 19.66, "return_now": 121.58}]}
                )
            }
        )
        s = (await a.get_fund_performance("510300.SH", asset_type="fund-etf"))[0]
        assert s.statement == "performance"
        assert s.rows[0]["return_year"] == 19.66


class TestIndexDomain:
    async def test_index_quote_batch(self) -> None:
        a = make_fund_adapter(
            {
                "a-share-index/prices/snapshot": _env(
                    {
                        "timestamp": 1784275991000,
                        "total": 2,
                        "item": [
                            {
                                "thscode": "000300.SH",
                                "ticker": "1B0300",
                                "last_price": 4665.88,
                                "price_change": 1.93,
                                "price_change_ratio_pct": 0.041381,
                                "open_price": 4672.98,
                                "high_price": 4676.71,
                                "low_price": 4637.13,
                                "prev_price": 4663.95,
                                "volume": 17843070000,
                                "turnover": 549769610000,
                            },
                            {
                                "thscode": "000001.SH",
                                "ticker": "000001",
                                "last_price": 3388.06,
                                "price_change_ratio_pct": 0.3617,
                                "volume": 0,
                                "turnover": 0,
                            },
                        ],
                    }
                )
            }
        )
        qs = await a.get_index_quote(["000300.SH", "000001.SH"])
        assert len(qs) == 2
        assert qs[0].last_price == 4665.88
        assert qs[0].as_of_ms == 1784275991000

    async def test_index_kline(self) -> None:
        from core.domain.units import date_to_ms

        a = make_fund_adapter(
            {
                "a-share-index/prices/historical": _env(
                    {
                        "timestamp": 1784131200000,
                        "adjust": None,
                        "item": [
                            {
                                "date_ms": date_to_ms("2026-07-01"),
                                "open_price": 4500.0,
                                "high_price": 4550.0,
                                "low_price": 4480.0,
                                "close_price": 4530.0,
                                "volume": 1.7e10,
                                "turnover": 5.4e11,
                            }
                        ],
                    }
                )
            }
        )
        b = (
            await a.get_index_kline("000300.SH", date_to_ms("2026-07-01"), date_to_ms("2026-07-10"))
        )[0]
        assert b.period == "1d"
        assert b.close == 4530.0
        assert "无复权语义" in b.extra["note"]

    async def test_index_constituents(self) -> None:
        a = make_fund_adapter(
            {
                "a-share-index/constituents/ths-stock-list": _env(
                    {
                        "timestamp": 1748102400000,
                        "item": [
                            {"thscode": "600519.SH", "ticker": "600519", "name": "贵州茅台"},
                            {"thscode": "000858.SZ", "ticker": "000858", "name": "五粮液"},
                        ],
                    }
                )
            }
        )
        s = (await a.get_index_constituents("000300.SH"))[0]
        assert s.statement == "constituents"
        assert len(s.rows) == 2
        assert "仅当前" in s.extra["note"]


# ── v0.3.0 THS fund/index fixtures 回放 (live 录制后自动生效; 缺失时显式 skip) ──


FUND_INDEX_FIXTURES = {
    "fund_snapshot_510300": "fund/market/snapshot",
    "fund_snapshot_lof_160105": "fund/market/snapshot",
    "fund_kline_510300": "fund/market/historical",
    "fund_nav_510300": "fund/performance/nav",
    "fund_returns_510300": "fund/performance/returns",
    "fund_holdings_510300": "fund/portfolio/holdings",
    "fund_holders_161725": "fund/holders/detail",
    "fund_profile_510300": "fund/profile/detail",
    "index_snapshot_000300": "a-share-index/prices/snapshot",
    "index_kline_000300": "a-share-index/prices/historical",
    "index_constituents_000300": "a-share-index/constituents/ths-stock-list",
}


class TestFundIndexFixtures:
    """回放测试: 全部 fixture 存在时才激活 (录制后 CI 离线回放)."""

    @pytest.fixture(autouse=True)
    def _require_fixtures(self) -> None:
        missing = [n for n in FUND_INDEX_FIXTURES if not (FIXTURES / f"{n}.json").exists()]
        if missing:
            pytest.skip(f"THS fund/index fixtures 未录制 (网关封禁期): {missing}")

    def test_fund_snapshot_etf(self) -> None:
        a = make_adapter("fund_snapshot_510300")
        q = (await_p(a.get_fund_quote("510300.SH")))[0]
        assert q.symbol == "510300.SH"
        assert q.last_price > 0
        assert q.source == "同花顺"

    def test_fund_snapshot_lof_is_nodata(self) -> None:
        """LOF 快照 fixture 应为 3004 信封 → NoDataError (链内换源语义)."""
        from core.domain.errors import NoDataError

        a = make_adapter("fund_snapshot_lof_160105")
        with pytest.raises(NoDataError):
            await_p(a.get_fund_quote("160105.SZ"))

    def test_fund_kline_fixture(self) -> None:
        from core.domain.units import date_to_ms

        a = make_adapter("fund_kline_510300")
        bars = await_p(
            a.get_fund_kline("510300.SH", date_to_ms("2026-07-01"), date_to_ms("2026-07-10"))
        )
        assert bars
        assert bars[0].close > 0
        assert bars[0].extra["note"].startswith("THS")

    def test_fund_nav_fixture(self) -> None:
        a = make_adapter("fund_nav_510300")
        s = await_p(a.get_fund_nav("510300.SH", asset_type="fund-etf"))[0]
        assert s.statement == "nav"
        assert "unit_nav" in s.rows[0] or "adj_nav" in s.rows[0]

    def test_fund_returns_holdings_profile(self) -> None:
        a = make_adapter("fund_returns_510300", "fund_holdings_510300", "fund_profile_510300")
        perf = await_p(a.get_fund_performance("510300.SH", asset_type="fund-etf"))[0]
        assert perf.statement == "performance"
        hold = await_p(a.get_fund_holdings("510300.SH", asset_type="fund-etf"))[0]
        assert hold.statement == "holdings"
        info = await_p(a.get_fund_info("510300.SH", asset_type="fund-etf"))[0]
        assert info.statement == "info"

    def test_fund_holders_fixture(self) -> None:
        a = make_adapter("fund_holders_161725")
        s = await_p(a.get_fund_holders("161725.SZ", asset_type="fund-lof"))[0]
        assert s.statement == "holders"
        assert "ins_position" in s.rows[0]

    def test_index_snapshot_and_kline(self) -> None:
        from core.domain.units import date_to_ms

        a = make_adapter("index_snapshot_000300", "index_kline_000300")
        qs = await_p(a.get_index_quote(["000300.SH", "000001.SH"]))
        assert len(qs) == 2
        bars = await_p(
            a.get_index_kline("000300.SH", date_to_ms("2026-07-01"), date_to_ms("2026-07-10"))
        )
        assert bars and bars[0].close > 0

    def test_index_constituents_fixture(self) -> None:
        a = make_adapter("index_constituents_000300")
        s = await_p(a.get_index_constituents("000300.SH"))[0]
        assert s.statement == "constituents"
        assert s.rows


def await_p(coro):
    """fixture 回放测试在普通方法内 await (类内无 pytest.mark.asyncio)."""
    return asyncio.get_event_loop().run_until_complete(coro)
