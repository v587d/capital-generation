"""M6: MCP shell — tool logic, rendering, BYOK, tool registration (offline)."""

from __future__ import annotations

import pytest

from core.domain.errors import ParamError
from core.domain.models import Envelope, Quote
from core.domain.symbols import SymbolRecord, SymbolResolver
from core.domain.units import date_to_ms, utc_iso
from servers import mcp_data
from servers.mcp_data import (
    render_ambiguity,
    render_envelope,
    tool_get_calendar,
    tool_get_klines,
    tool_get_quote,
    tool_get_special_data,
)

RESOLVER = SymbolResolver(
    [
        SymbolRecord("600519.SH", "600519", "贵州茅台", "SH", "a-share", "CNY"),
        SymbolRecord("000001.SZ", "000001", "平安银行", "SZ", "a-share", "CNY"),
        SymbolRecord("000001.SH", "1A0001", "上证指数", "SH", "a-share-index", "CNY"),
    ]
)


def ok_quote(symbol: str) -> Quote:
    return Quote(
        symbol=symbol, last_price=1.0, open_price=None, high_price=None,
        low_price=None, prev_close=None, change_pct=None, volume=1, turnover=1,
        as_of_ms=date_to_ms("2026-08-15"), source="同花顺", tier="free",
    )


class FakeRouter:
    def __init__(self, result: object | None = None) -> None:
        self.result = result
        self.calls: list[tuple[str, dict]] = []

    async def call(self, domain: str, **kwargs):
        self.calls.append((domain, kwargs))
        if self.result is not None:
            data = self.result
        elif domain == "calendar":
            data = []
        else:
            data = []
        return Envelope(data=data, ts_ms=date_to_ms("2026-08-15"), warnings=())


class TestRender:
    def test_envelope_keeps_provenance(self) -> None:
        env = Envelope(data=[ok_quote("600519.SH")], ts_ms=date_to_ms("2026-08-15"))
        d = render_envelope(env)
        assert d["source"] == "同花顺"
        assert d["tier"] == "free"
        assert d["ts"] == utc_iso(date_to_ms("2026-08-15"))
        assert d["data"][0]["symbol"] == "600519.SH"

    def test_ambiguity_rendering(self) -> None:
        d = render_ambiguity("000001", RESOLVER.resolve("000001").candidates)
        assert d["data"] is None
        assert len(d["ambiguous"]) == 2
        assert any("有歧义" in w for w in d["warnings"])


class TestToolLogic:
    @pytest.mark.asyncio
    async def test_quote_resolves_and_routes(self) -> None:
        router = FakeRouter(result=[ok_quote("600519.SH")])
        d = await tool_get_quote(router, RESOLVER, "600519")
        assert d["data"][0]["symbol"] == "600519.SH"
        assert router.calls[0][0] == "quote"
        assert router.calls[0][1]["symbols"] == ["600519.SH"]

    @pytest.mark.asyncio
    async def test_quote_ambiguous_guides_to_search(self) -> None:
        router = FakeRouter()
        d = await tool_get_quote(router, RESOLVER, "000001")
        assert d["data"] is None
        assert len(d["ambiguous"]) == 2
        assert router.calls == []  # 未发起数据请求

    @pytest.mark.asyncio
    async def test_index_rejected_with_clear_guidance(self) -> None:
        # v0.1.0 行情/财务仅服务 A股股票; 指数解析成功但明确引导 (不模糊失败)
        router = FakeRouter()
        d = await tool_get_quote(router, RESOLVER, "000001.SH")
        assert d["data"] is None
        assert any("仅支持" in w and "股票" in w for w in d["warnings"])
        assert router.calls == []
        d2 = await tool_get_klines(
            router, RESOLVER, "000001.SH", start="2026-07-01", end="2026-07-10"
        )
        assert d2["data"] is None
        assert router.calls == []

    @pytest.mark.asyncio
    async def test_quote_unknown_guides_to_search(self) -> None:
        router = FakeRouter()
        d = await tool_get_quote(router, RESOLVER, "113050")
        assert d["data"] is None
        assert any("search_symbols" in w for w in d["warnings"])

    @pytest.mark.asyncio
    async def test_quote_too_many_symbols(self) -> None:
        router = FakeRouter()
        with pytest.raises(ParamError):
            await tool_get_quote(router, RESOLVER, ",".join(f"{i:06d}" for i in range(51)))

    @pytest.mark.asyncio
    async def test_klines_passes_dates(self) -> None:
        router = FakeRouter(result=[ok_quote("600519.SH")])
        d = await tool_get_klines(
            router, RESOLVER, "600519", start="2026-07-01", end="2026-07-10"
        )
        assert d["data"][0]["symbol"] == "600519.SH"
        domain, kw = router.calls[0]
        assert domain == "klines"
        assert kw["start_ms"] == date_to_ms("2026-07-01")
        assert kw["end_ms"] == date_to_ms("2026-07-10")

    @pytest.mark.asyncio
    async def test_klines_rejects_non_daily_period(self) -> None:
        router = FakeRouter()
        with pytest.raises(ParamError):
            await tool_get_klines(
                router, RESOLVER, "600519", period="1w", start="2026-07-01", end="2026-07-10"
            )

    @pytest.mark.asyncio
    async def test_calendar(self) -> None:
        router = FakeRouter()
        d = await tool_get_calendar(router, RESOLVER)
        assert router.calls[0][0] == "calendar"
        assert "data" in d

    @pytest.mark.asyncio
    async def test_special_data_passes_kind(self) -> None:
        router = FakeRouter(result=[])
        await tool_get_special_data(router, RESOLVER, "limit-up", date="2026-08-14")
        domain, kw = router.calls[0]
        assert domain == "special"
        assert kw["kind"] == "limit-up"
        assert kw["date"] == "2026-08-14"


class TestServer:
    def test_six_tools_registered(self) -> None:
        app = mcp_data.create_app()
        names = {t.name for t in app._tool_manager.list_tools()}
        assert names == {
            "fin_data__search_symbols",
            "fin_data__get_quote",
            "fin_data__get_klines",
            "fin_data__get_financials",
            "fin_data__get_calendar",
            "fin_data__get_special_data",
        }

    def test_build_without_key_warns_and_keeps_akshare(self, monkeypatch) -> None:
        monkeypatch.setenv("THS_API_KEY", "")
        monkeypatch.setattr(mcp_data, "load_ths_key", lambda: None)
        router, resolver, warnings = mcp_data.build_server_components()
        assert "AKShare" in router._adapters or "akshare" in router._adapters
        assert any("THS_API_KEY" in w for w in warnings)

    def test_load_ths_key_env_first(self, monkeypatch) -> None:
        monkeypatch.setenv("THS_API_KEY", "sk-test-123")
        assert mcp_data.load_ths_key() == "sk-test-123"

    def test_load_ths_key_credentials_file(self, monkeypatch, tmp_path) -> None:
        monkeypatch.delenv("THS_API_KEY", raising=False)
        (tmp_path / ".credentials.yaml").write_text("ths_api_key: sk-file-456\n", encoding="utf-8")
        monkeypatch.setenv("DSH_HOME", str(tmp_path))
        assert mcp_data.load_ths_key() == "sk-file-456"
