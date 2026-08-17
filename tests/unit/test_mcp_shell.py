"""M6: MCP shell — tool logic, rendering, BYOK, tool registration (offline)."""

from __future__ import annotations

import json

import pytest

from core.domain.errors import ParamError
from core.domain.models import Announcement, Envelope, Kline, Quote
from core.domain.symbols import SymbolRecord, SymbolResolver
from core.domain.units import date_to_ms, utc_iso
from servers import mcp_data
from servers.mcp_data import (
    render_ambiguity,
    render_envelope,
    tool_get_announcements,
    tool_get_calendar,
    tool_get_edb,
    tool_get_financials,
    tool_get_klines,
    tool_get_quote,
    tool_get_special_data,
)

RESOLVER = SymbolResolver(
    [
        SymbolRecord("600519.SH", "600519", "贵州茅台", "SH", "a-share", "CNY"),
        SymbolRecord("000001.SZ", "000001", "平安银行", "SZ", "a-share", "CNY"),
        SymbolRecord("000001.SH", "1A0001", "上证指数", "SH", "a-share-index", "CNY"),
        SymbolRecord("510300.SH", "510300", "沪深300ETF", "SH", "fund-etf", "CNY"),
    ]
)


def ok_quote(symbol: str) -> Quote:
    return Quote(
        symbol=symbol,
        last_price=1.0,
        open_price=None,
        high_price=None,
        low_price=None,
        prev_close=None,
        change_pct=None,
        volume=1,
        turnover=1,
        as_of_ms=date_to_ms("2026-08-15"),
        source="同花顺",
        tier="free",
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
        assert d["data"][0]["symbol"] == "600519.SH"  # 单行平铺 (无外提空间)

    def test_ambiguity_rendering(self) -> None:
        d = render_ambiguity("000001", RESOLVER.resolve("000001").candidates)
        assert d["data"] is None
        assert len(d["ambiguous"]) == 2
        assert any("有歧义" in w for w in d["warnings"])


class TestRenderCompact:
    """DESIGN_CONTEXT_BUDGET.md A1/A3: 表头外提 + 公告截断 (渲染层)."""

    def _kline(self, date_ms: int, source: str = "同花顺", close: float = 1.0) -> Kline:
        return Kline(
            symbol="600519.SH",
            date_ms=date_ms,
            open=1.0,
            high=1.1,
            low=0.9,
            close=close,
            volume=100,
            turnover=200,
            source=source,
            tier="free",
        )

    def test_multirow_meta_extraction(self) -> None:
        env = Envelope(
            data=[self._kline(1), self._kline(2, close=1.2)],
            ts_ms=date_to_ms("2026-08-15"),
        )
        d = render_envelope(env)
        assert d["data"]["meta"]["symbol"] == "600519.SH"
        assert d["data"]["meta"]["source"] == "同花顺"
        assert d["data"]["meta"]["tier"] == "free"
        # 行内只留差异字段
        assert "date_ms" in d["data"]["rows"][0]
        assert "symbol" not in d["data"]["rows"][0]
        assert d["source"] == "同花顺"  # 信封溯源保留

    def test_mixed_source_stays_in_rows(self) -> None:
        env = Envelope(
            data=[self._kline(1, source="同花顺"), self._kline(2, source="AKShare")],
            ts_ms=date_to_ms("2026-08-15"),
        )
        d = render_envelope(env)
        assert "source" not in d["data"]["meta"]  # 混合源自动回退: 留行内
        assert d["data"]["rows"][0]["source"] == "同花顺"
        assert d["data"]["rows"][1]["source"] == "AKShare"

    def test_announcement_truncated_with_flag(self) -> None:
        long_ann = Announcement(
            symbol="600519.SH",
            title="半年报",
            date_ms=date_to_ms("2026-08-15"),
            content="字" * 2000,
            url="https://u",
            source="Wind",
            tier="quota",
        )
        short_ann = Announcement(
            symbol="600519.SH",
            title="短公告",
            date_ms=date_to_ms("2026-08-14"),
            content="短",
            url="https://u2",
            source="Wind",
            tier="quota",
        )
        env = Envelope(data=[long_ann, short_ann], ts_ms=date_to_ms("2026-08-15"))
        d = render_envelope(env)
        assert d["data"]["meta"]["note"] == "content 为截断摘要, 全文见 url"
        r0, r1 = d["data"]["rows"]
        assert r0["truncated"] is True and len(r0["content"]) == 801  # 800 + …
        assert r1["truncated"] is False and r1["content"] == "短"
        assert r0["url"] == "https://u"  # url 恒保留 (全文兜底)

    def test_announcement_single_row_flat(self) -> None:
        ann = Announcement(
            symbol="600519.SH",
            title="T",
            date_ms=date_to_ms("2026-08-15"),
            content="字" * 2000,
            url="https://u",
            source="Wind",
            tier="quota",
        )
        d = render_envelope(Envelope(data=[ann], ts_ms=date_to_ms("2026-08-15")))
        assert isinstance(d["data"], list)  # 单行平铺
        assert d["data"][0]["truncated"] is True

    def test_announcement_cap_zero_disables(self, monkeypatch) -> None:
        import servers.mcp_data as md

        monkeypatch.setattr(md, "_RENDER_CFG", {"announcements": {"content_cap_chars": 0}})
        ann = Announcement(
            symbol="600519.SH",
            title="T",
            date_ms=date_to_ms("2026-08-15"),
            content="字" * 2000,
            url="https://u",
            source="Wind",
            tier="quota",
        )
        d = render_envelope(Envelope(data=[ann], ts_ms=date_to_ms("2026-08-15")))
        assert "truncated" not in d["data"][0]  # cap=0 → 旧行为: 无标记
        assert len(d["data"][0]["content"]) == 2000

    def test_empty_list_stays_flat(self) -> None:
        d = render_envelope(Envelope(data=[], ts_ms=date_to_ms("2026-08-15")))
        assert d["data"] == []


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
        d = await tool_get_klines(router, RESOLVER, "600519", start="2026-07-01", end="2026-07-10")
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

    @pytest.mark.asyncio
    async def test_special_data_anomaly_requires_thscodes(self) -> None:
        router = FakeRouter(result=[])
        with pytest.raises(ParamError, match="thscodes"):
            await tool_get_special_data(
                router, RESOLVER, "anomaly-stock", date="2026-08-14", size=20
            )
        assert router.calls == []

    @pytest.mark.asyncio
    async def test_special_data_anomaly_passes_thscodes(self) -> None:
        router = FakeRouter(result=[])
        await tool_get_special_data(
            router,
            RESOLVER,
            "anomaly-stock",
            date="2026-08-14",
            size=20,
            thscodes="600519.SH, 000001.SZ",
        )
        domain, kw = router.calls[0]
        assert domain == "special"
        assert kw["kind"] == "anomaly-stock"
        assert kw["thscodes"] == "600519.SH,000001.SZ"
        assert "date" not in kw
        assert "size" not in kw


class TestToolLogicV02:
    """v0.2.0 新工具与 period 扩展 (PLAN-0.2.0.md §2.3)."""

    @pytest.mark.asyncio
    async def test_klines_daily_still_routes_klines(self) -> None:
        router = FakeRouter(result=[])
        await tool_get_klines(
            router, RESOLVER, "600519", "1d", start="2026-07-01", end="2026-07-10"
        )
        domain, kw = router.calls[0]
        assert domain == "klines"
        assert kw["adjust"] == "none"

    @pytest.mark.asyncio
    async def test_klines_minute_routes_intraday(self) -> None:
        router = FakeRouter(result=[])
        await tool_get_klines(
            router, RESOLVER, "600519", "5m", start="2026-07-08", end="2026-07-08"
        )
        domain, kw = router.calls[0]
        assert domain == "intraday"
        assert kw["period"] == "5m"

    @pytest.mark.asyncio
    async def test_klines_minute_requires_single_day(self) -> None:
        router = FakeRouter(result=[])
        with pytest.raises(ParamError):
            await tool_get_klines(
                router, RESOLVER, "600519", "5m", start="2026-07-08", end="2026-07-09"
            )

    @pytest.mark.asyncio
    async def test_klines_weekly_rejected(self) -> None:
        router = FakeRouter(result=[])
        with pytest.raises(ParamError) as ei:
            await tool_get_klines(
                router, RESOLVER, "600519", "1w", start="2026-07-01", end="2026-07-10"
            )
        assert "周/月/季" in str(ei.value)

    @pytest.mark.asyncio
    async def test_announcements_routes_with_name(self) -> None:
        router = FakeRouter(result=[])
        await tool_get_announcements(
            router, RESOLVER, "600519", start="2024-01-01", end="2025-12-31", top_k=5
        )
        domain, kw = router.calls[0]
        assert domain == "announcements"
        assert kw["symbol"] == "600519.SH"
        assert kw["name"] == "贵州茅台"
        assert kw["top_k"] == 5

    @pytest.mark.asyncio
    async def test_edb_observation_default(self) -> None:
        router = FakeRouter(result=[])
        await tool_get_edb(router, RESOLVER, "中国GDP")
        domain, kw = router.calls[0]
        assert domain == "edb"
        assert kw["indicator"] == "中国GDP"
        assert kw["observation"] == 10
        assert "start_ms" not in kw

    @pytest.mark.asyncio
    async def test_edb_with_dates(self) -> None:
        router = FakeRouter(result=[])
        await tool_get_edb(router, RESOLVER, "中国GDP", start="2024-01-01", end="2024-12-31")
        domain, kw = router.calls[0]
        assert kw["start_ms"] == date_to_ms("2024-01-01")
        assert kw["end_ms"] == date_to_ms("2024-12-31")

    @pytest.mark.asyncio
    async def test_financials_passes_name_for_wind_nl(self) -> None:
        router = FakeRouter(result=[])
        await tool_get_financials(router, RESOLVER, "600519", "income")
        domain, kw = router.calls[0]
        assert domain == "financials"
        assert kw["name"] == "贵州茅台"  # Wind NL 问句需要名称 (M2 权威链头)


class TestServer:
    def test_eleven_tools_registered(self) -> None:
        app = mcp_data.create_app()
        names = {t.name for t in app._tool_manager.list_tools()}
        assert names == {
            "fin_data__search_symbols",
            "fin_data__get_quote",
            "fin_data__get_klines",
            "fin_data__get_financials",
            "fin_data__get_calendar",
            "fin_data__get_special_data",
            "fin_data__get_announcements",
            "fin_data__get_edb",
            "fin_data__reconcile",
            "fin_data__get_fund_data",
            "fin_data__get_index_data",
        }

    def test_build_without_key_warns_and_keeps_akshare(self, monkeypatch) -> None:
        monkeypatch.setenv("THS_API_KEY", "")
        monkeypatch.setattr(mcp_data, "load_ths_key", lambda: None)
        monkeypatch.setattr(mcp_data, "load_wind_key", lambda: None)
        router, resolver, warnings = mcp_data.build_server_components()
        assert "AKShare" in router._adapters or "akshare" in router._adapters
        assert any("THS_API_KEY" in w for w in warnings)
        assert any("WIND_API_KEY" in w for w in warnings)

    def test_schema_titles_stripped(self) -> None:
        """B1 (DESIGN_CONTEXT_BUDGET.md): inputSchema 无 pydantic 冗余 title.

        参数名/类型/required/默认值必须原样保留 (schema 冻结红线: 只减冗余).
        """
        app = mcp_data.create_app()
        tools = {t.name: t for t in app._tool_manager.list_tools()}
        for name, tool in tools.items():
            assert '"title"' not in json.dumps(tool.parameters), name
        params = tools["fin_data__search_symbols"].parameters
        assert params["properties"]["query"] == {"type": "string"}
        assert params["properties"]["limit"] == {"default": 10, "type": "integer"}
        assert params["required"] == ["query"]

    def test_special_data_schema_exposes_thscodes(self) -> None:
        """anomaly-stock 需要 thscodes; MCP schema 必须透出该可选参数."""
        app = mcp_data.create_app()
        tools = {t.name: t for t in app._tool_manager.list_tools()}
        params = tools["fin_data__get_special_data"].parameters
        assert "thscodes" in params["properties"]
        assert "thscodes" not in params["required"]

    def test_descriptions_carry_budget_guidance(self) -> None:
        """C (DESIGN_CONTEXT_BUDGET.md): 描述引导调用预算 (窗口/top_k/observation)."""
        app = mcp_data.create_app()
        tools = {t.name: t for t in app._tool_manager.list_tools()}
        assert "窗口 ≤1 年" in tools["fin_data__get_klines"].description
        assert "top_k ≤5" in tools["fin_data__get_announcements"].description
        assert "observation 默认 10" in tools["fin_data__get_edb"].description

    def test_load_ths_key_env_first(self, monkeypatch) -> None:
        monkeypatch.setenv("THS_API_KEY", "sk-test-123")
        assert mcp_data.load_ths_key() == "sk-test-123"

    def test_load_ths_key_credentials_file(self, monkeypatch, tmp_path) -> None:
        monkeypatch.delenv("THS_API_KEY", raising=False)
        (tmp_path / ".credentials.yaml").write_text("ths_api_key: sk-file-456\n", encoding="utf-8")
        monkeypatch.setenv("DSH_HOME", str(tmp_path))
        assert mcp_data.load_ths_key() == "sk-file-456"

    def test_load_wind_key_credentials_file(self, monkeypatch, tmp_path) -> None:
        monkeypatch.delenv("WIND_API_KEY", raising=False)
        (tmp_path / ".credentials.yaml").write_text("wind_api_key: ak-file-789\n", encoding="utf-8")
        monkeypatch.setenv("DSH_HOME", str(tmp_path))
        assert mcp_data.load_wind_key() == "ak-file-789"


class TestFundIndexTools:
    """v0.3.0 新工具 (PLAN-0.3.0.md §2.3, 决策 13)."""

    @pytest.mark.asyncio
    async def test_fund_quote_routes_with_asset_type(self) -> None:
        router = FakeRouter()
        d = await mcp_data.tool_get_fund_data(router, RESOLVER, "510300")
        assert router.calls[0][0] == "fund_quote"
        assert router.calls[0][1] == {
            "symbol": "510300.SH",
            "asset_type": "fund-etf",
            "name": "沪深300ETF",
            "limit": 10,
        }
        assert d["data"] == []

    @pytest.mark.asyncio
    async def test_fund_kline_requires_dates(self) -> None:
        router = FakeRouter()
        with pytest.raises(ParamError):
            await mcp_data.tool_get_fund_data(router, RESOLVER, "510300", kind="kline")
        await mcp_data.tool_get_fund_data(
            router, RESOLVER, "510300", kind="kline", start="2026-07-01", end="2026-07-10"
        )
        assert router.calls[0][0] == "fund_kline"
        assert router.calls[0][1]["start_ms"] == date_to_ms("2026-07-01")

    @pytest.mark.asyncio
    async def test_fund_gate_rejects_stock(self) -> None:
        router = FakeRouter()
        d = await mcp_data.tool_get_fund_data(router, RESOLVER, "600519")
        assert d["data"] is None
        assert any("仅支持 基金" in w for w in d["warnings"])

    @pytest.mark.asyncio
    async def test_fund_kind_validation(self) -> None:
        router = FakeRouter()
        with pytest.raises(ParamError, match="kind 仅支持"):
            await mcp_data.tool_get_fund_data(router, RESOLVER, "510300", kind="foo")

    @pytest.mark.asyncio
    async def test_index_quote_routes_symbols(self) -> None:
        router = FakeRouter()
        await mcp_data.tool_get_index_data(router, RESOLVER, "000001", kind="quote")
        assert router.calls[0][0] == "index_quote"
        assert router.calls[0][1]["symbols"] == ["000001.SH"]

    @pytest.mark.asyncio
    async def test_index_fundamentals_wind_only(self) -> None:
        router = FakeRouter()
        await mcp_data.tool_get_index_data(router, RESOLVER, "000001", kind="fundamentals")
        assert router.calls[0][0] == "index_fundamentals"
        assert router.calls[0][1]["name"] == "上证指数"

    @pytest.mark.asyncio
    async def test_index_kline_requires_dates(self) -> None:
        router = FakeRouter()
        with pytest.raises(ParamError):
            await mcp_data.tool_get_index_data(router, RESOLVER, "000001", kind="kline")

    @pytest.mark.asyncio
    async def test_index_gate_rejects_stock(self) -> None:
        router = FakeRouter()
        d = await mcp_data.tool_get_index_data(router, RESOLVER, "600519")
        assert d["data"] is None
        assert any("仅支持 指数" in w for w in d["warnings"])


class TestSymbolsStaleWarning:
    """v0.3.0 M6: 启动 stale 检测 warning (无 key/失败降级本地快照, 可观测)."""

    def test_stale_warns(self, monkeypatch, tmp_path) -> None:
        import json
        from datetime import UTC, datetime, timedelta

        import core.domain.symbols as sym_mod
        import servers.mcp_data as mcp_mod

        p = tmp_path / "symbols.json"
        old = (datetime.now(UTC) - timedelta(days=60)).isoformat(timespec="seconds")
        p.write_text(json.dumps({"generated_at": old, "records": []}), encoding="utf-8")
        monkeypatch.setattr(sym_mod, "snapshot_age_days", lambda *a, **k: 60)
        monkeypatch.setattr(mcp_mod, "load_ths_key", lambda: None)
        monkeypatch.setattr(mcp_mod, "load_wind_key", lambda: None)
        _, _, warnings = mcp_mod.build_server_components()
        assert any("未同步" in w for w in warnings)

    def test_fresh_no_warning(self, monkeypatch) -> None:
        import core.domain.symbols as sym_mod
        import servers.mcp_data as mcp_mod

        monkeypatch.setattr(sym_mod, "snapshot_age_days", lambda *a, **k: 0)
        monkeypatch.setattr(mcp_mod, "load_ths_key", lambda: None)
        monkeypatch.setattr(mcp_mod, "load_wind_key", lambda: None)
        _, _, warnings = mcp_mod.build_server_components()
        assert not any("未同步" in w for w in warnings)
