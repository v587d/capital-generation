"""M1: Wind adapter unit tests — fixture replay, no live network (LESSONS §4.3).

Fixtures are verbatim JSON-RPC envelopes recorded live on 2026-08-15
(tests/fixtures/wind/); MockTransport replays them keyed by (server, method, args).
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from core.adapters.wind import WindAdapter
from core.domain.errors import (
    AuthError,
    FinError,
    NoDataError,
    ParamError,
    RateLimitError,
    SourceDownError,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "wind"


def load(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def pick(server: str, method: str, args: dict) -> dict:
    """Fixture selection by (server path, method, params)."""
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "serverInfo": {"name": "wind"},
            },
        }
    q = str(args.get("windcode", "")).lower()
    if "stock_data" in server and method == "get_stock_price_indicators":
        if q == "999999.sh":
            return load("err_invalid_windcode")
        if q == "000001.sz":
            return load("price_indicators_000001")
        return load("price_indicators_600519")
    if "stock_data" in server and method == "get_stock_kline":
        if args.get("period") == "3":
            if args.get("begin_date") != args.get("end_date"):
                return load("kline_5min_crossday_600519")
            return load("kline_5min_600519")
        return load("kline_daily_600519")
    if "stock_data" in server and method == "get_stock_quote":
        return load("quote_minute_600519")
    if "stock_data" in server and method == "get_stock_fundamentals":
        if "xyzabc" in str(args.get("question", "")).lower():
            return load("err_fundamentals_no_data")
        return load("fundamentals_600519")
    if "financial_docs" in server and method == "get_company_announcements":
        return load("announcements_600519")
    if "economic_data" in server and method == "natural_language_get_edb_data":
        if "不存在的指标" in str(args.get("question", "")):
            return load("err_edb_not_found")
        if args.get("executionMode") == "search":
            return load("edb_search")
        return load("edb_gdp")
    # ── v0.3.0 fund/index 域 (M3 fixtures, 2026-08-15 真实 key 录制) ──────
    if "fund_data" in server:
        if method == "get_fund_quote":
            return load("fund_quote_510300")
        if method == "get_fund_kline":
            return load("fund_kline_158001")
        if method == "get_fund_holdings":
            return load("fund_holdings_158001")
        if method == "get_fund_holders":
            return load("fund_info_158001")  # question 类同形状 (holders 未单独录制)
        if method == "get_fund_performance":
            return load("fund_performance_158001")
        if method == "get_fund_info":
            return load("fund_info_158001")
    if "index_data" in server:
        if method == "get_index_quote":
            return load("index_quote_000300")
        if method == "get_index_kline":
            return load("index_kline_H11077" if q == "h11077.sh" else "index_kline_000300")
        if method == "get_index_fundamentals":
            return load("index_fundamentals_000300")
        if method == "get_index_basicinfo":
            return load("index_basicinfo_000300")
    raise AssertionError(f"no fixture for {server}.{method} {args}")


def make_adapter(*, status: int = 200, captured: list[dict] | None = None) -> WindAdapter:
    def handler(request: httpx.Request) -> httpx.Response:
        if status != 200:
            return httpx.Response(status, text="boom")
        body = json.loads(request.content)
        if captured is not None:
            captured.append(body)
        method = body["method"]
        server = request.url.path.split("/")[1]  # vserver_<server>/mcp/
        if method == "initialize":
            return httpx.Response(
                200,
                json=pick(server, "initialize", {}),
                headers={"content-type": "application/json"},
            )
        tool = body["params"]["name"]
        args = body["params"].get("arguments", {})
        payload = pick(server, tool, args)
        return httpx.Response(200, json=payload, headers={"content-type": "application/json"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=10.0)
    adapter = WindAdapter("ak_test", client=client)
    return adapter


@pytest.fixture()
def adapter() -> WindAdapter:
    return make_adapter()


async def test_financials_indicators(adapter: WindAdapter) -> None:
    stmts = await adapter.get_financials("600519.SH", "indicators", name="贵州茅台")
    assert len(stmts) == 1
    s = stmts[0]
    assert s.statement == "indicators"
    assert s.source == "Wind"
    assert s.tier == "quota"
    assert s.report_date_ms is None  # 时点截面, 源未声明报告期
    row = s.rows[0]
    assert row["市盈率(TTM)"] == "20.282"
    assert row["中文简称"] == "贵州茅台"
    assert s.extra["units"]["总市值1"] == "元"


async def test_financials_income_nl(adapter: WindAdapter) -> None:
    stmts = await adapter.get_financials(
        "600519.SH", "income", period="annual", limit=2, name="贵州茅台"
    )
    assert len(stmts) == 1
    s = stmts[0]
    assert s.statement == "income"
    assert s.caliber.startswith("Wind NL")
    row = s.rows[0]
    assert "2024年ROE" in row  # 报告期在列名 (L3 标注)
    assert row["2024年营业收入"] == 1708.9915


async def test_financials_no_data(adapter: WindAdapter) -> None:
    with pytest.raises(NoDataError) as ei:
        await adapter.get_financials("XYZABC", "income", name="不存在标的")
    assert ei.value.kind == "NO_DATA"


async def test_intraday_5min(adapter: WindAdapter) -> None:
    from core.domain.units import date_to_ms

    bars = await adapter.get_intraday(
        "600519.SH", "5m", date_to_ms("2026-07-08"), date_to_ms("2026-07-08")
    )
    assert len(bars) == 48
    b = bars[0]
    assert b.period == "5m"
    assert b.adjust == "forward"  # Wind aftype=0 前复权声明
    assert b.source == "Wind"
    assert b.tier == "quota"
    assert b.close == 1186.50
    assert b.volume == 267550  # 股
    # TIME 09:35 +08:00 → Asia/Shanghai ms
    from core.domain.units import ms_to_date

    assert ms_to_date(b.date_ms) == "2026-07-08"
    assert (b.date_ms - date_to_ms("2026-07-08")) // 1000 == 9 * 3600 + 35 * 60


async def test_intraday_crossday_fixture(adapter: WindAdapter) -> None:
    """实测: Wind get_stock_kline 分钟级可跨日 (96 行) — 计划强制单日, 事实记录于 LESSONS."""
    from core.domain.units import date_to_ms

    bars = await adapter.get_intraday(
        "600519.SH", "5m", date_to_ms("2026-07-08"), date_to_ms("2026-07-09")
    )
    assert len(bars) == 96
    assert bars[-1].date_ms > bars[0].date_ms


async def test_intraday_unsupported_period(adapter: WindAdapter) -> None:
    from core.domain.units import date_to_ms

    with pytest.raises(ParamError):
        await adapter.get_intraday(
            "600519.SH", "1w", date_to_ms("2026-07-08"), date_to_ms("2026-07-08")
        )


async def test_announcements(adapter: WindAdapter) -> None:
    from core.domain.units import date_to_ms

    items = await adapter.get_announcements(
        "600519.SH",
        date_to_ms("2024-01-01"),
        date_to_ms("2025-12-31"),
        top_k=2,
        name="贵州茅台",
    )
    assert len(items) >= 2  # 实测: top_k 为软上限, 后端返回 4 条
    a = items[0]
    assert a.title == "贵州茅台:2024年年度利润分配方案公告"
    assert a.symbol == "600519.SH"
    assert a.date_ms == date_to_ms("2025-04-03")
    assert a.url.startswith("https://")
    assert "分红" in a.content
    assert a.tier == "quota"
    assert a.extra["relevance"] == 0.6352


async def test_edb_gdp(adapter: WindAdapter) -> None:
    points = await adapter.get_edb("中国GDP", observation=2)
    assert points
    p = points[0]
    assert p.indicator == "中国:GDP:现价:当季值"
    assert p.code == "M5567876"
    assert p.unit == "亿元"
    assert p.magnitude == "亿"
    assert p.freq == "季"
    assert p.value == 341443.2
    from core.domain.units import date_to_ms

    assert p.date_ms == date_to_ms("2024-09-30")
    assert p.source == "Wind"
    assert p.tier == "quota"


async def test_edb_with_dates(adapter: WindAdapter) -> None:
    from core.domain.units import date_to_ms

    points = await adapter.get_edb("中国GDP", date_to_ms("2024-01-01"), date_to_ms("2025-12-31"))
    assert points


async def test_edb_not_found(adapter: WindAdapter) -> None:
    with pytest.raises(NoDataError) as ei:
        await adapter.get_edb("不存在的指标xyzabc", observation=2)
    assert ei.value.kind == "NO_DATA"


async def test_invalid_windcode(adapter: WindAdapter) -> None:
    with pytest.raises(NoDataError) as ei:
        await adapter.get_financials("999999.SH", "indicators")
    assert ei.value.kind == "NO_DATA"
    assert "未识别到有效的金融标的" in ei.value.message


async def test_http_error_mapping() -> None:
    for status, cls in ((401, AuthError), (429, RateLimitError), (500, SourceDownError)):
        a = make_adapter(status=status)
        with pytest.raises(cls) as ei:
            await a.get_financials("600519.SH", "indicators")
        assert ei.value.status == status
        assert ei.value.vendor == "wind"
        await a.aclose()


async def test_quota_kind_config() -> None:
    """error_map wind 段: 单日/余额 → QUOTA (门控触发用)."""
    a = make_adapter()
    assert a._error_map.get("DAILY_LIMIT_ERROR") == "QUOTA"
    assert a._error_map.get("BALANCE_ERROR") == "QUOTA"
    assert a._error_map.get("RATE_LIMIT_ERROR") == "RATE_LIMIT"
    assert a._error_map.get("AUTH_ERROR") == "AUTH"
    assert a._error_map.get("NO_RESULTS") == "NO_DATA"


async def test_capabilities(adapter: WindAdapter) -> None:
    assert adapter.supports("financials")
    assert adapter.supports("intraday")
    assert adapter.supports("announcements")
    assert adapter.supports("edb")
    # 行情不烧 Wind 积分 (DEGRADATION 主干表)
    assert not adapter.supports("quote")
    assert not adapter.supports("klines")
    assert not adapter.supports("search")
    assert not adapter.supports("calendar")
    assert not adapter.supports("special")


async def test_finerror_context(adapter: WindAdapter) -> None:
    with pytest.raises(FinError) as ei:
        await adapter.get_financials("999999.SH", "indicators")
    err = ei.value
    assert err.vendor == "wind"
    assert err.endpoint == "stock_data.get_stock_price_indicators"
    assert err.source == "Wind"


async def test_protocol_shape() -> None:
    """M0 实测协议: method=tools/call, params={name, arguments}; initialize 先行."""
    captured: list[dict] = []
    a = make_adapter(captured=captured)
    await a.get_financials("600519.SH", "indicators", name="贵州茅台")
    methods = [c["method"] for c in captured]
    assert methods[0] == "initialize"
    assert methods[1] == "tools/call"
    call = captured[1]
    assert call["params"]["name"] == "get_stock_price_indicators"
    assert call["params"]["arguments"] == {
        "windcode": "600519.SH",
        "indexes": a._tool_by_domain["financials"]["indicators"]["indexes"],
    }
    # 同一 server 只握手一次
    await a.get_financials("600519.SH", "indicators")
    assert [c["method"] for c in captured].count("initialize") == 1


# ── v0.3.0 fund/index 域 (M3, PLAN-0.3.0.md) ─────────────────────────────


async def test_fund_quote_minute_bars(adapter: WindAdapter) -> None:

    bars = await adapter.get_fund_quote("510300.SH")
    assert bars
    b = bars[0]
    assert b.period == "1m"  # Wind 分钟行情 (仅当日), 与 THS 快照 L3 标注差异
    assert b.source == "Wind"
    assert b.tier == "quota"
    assert "分钟行情" in b.extra["note"]
    from core.domain.units import ms_to_date

    assert ms_to_date(b.date_ms) == "2026-07-08"  # Asia/Shanghai 毫秒 (09:30 条)


async def test_fund_kline_no_volume_annotated(adapter: WindAdapter) -> None:
    from core.domain.units import date_to_ms

    bars = await adapter.get_fund_kline(
        "158001.SZ", date_to_ms("2026-07-01"), date_to_ms("2026-07-10")
    )
    assert len(bars) == 10
    b = bars[0]
    assert b.period == "1d"
    assert b.adjust == "forward"  # Wind aftype=0 前复权声明
    assert b.extra["volume_unavailable"] is True  # fund kline 源无 VOLUME 列
    assert b.volume == 0.0  # 空值纪律: 不模拟, 0 + 标注


async def test_fund_holdings_nl(adapter: WindAdapter) -> None:
    stmts = await adapter.get_fund_holdings("158001.SZ", asset_type="fund-etf")
    assert len(stmts) == 1
    s = stmts[0]
    assert s.statement == "holdings"
    assert s.caliber.startswith("Wind NL")
    row = s.rows[0]
    assert "前十大重仓股代码" in row  # 定期披露, 非实时 (列名即口径, L3)
    assert row["名次"] == 1


async def test_fund_performance_nl(adapter: WindAdapter) -> None:
    stmts = await adapter.get_fund_performance("158001.SZ", asset_type="fund-etf")
    assert stmts and stmts[0].statement == "performance"
    row = stmts[0].rows[0]
    assert "过去一年复权单位净值增长率" in row


async def test_fund_info_nl(adapter: WindAdapter) -> None:
    stmts = await adapter.get_fund_info("158001.SZ", asset_type="fund-etf")
    assert stmts and stmts[0].statement == "info"
    row = stmts[0].rows[0]
    assert "基金管理人" in row


async def test_index_quote_minute_bars(adapter: WindAdapter) -> None:
    bars = await adapter.get_index_quote(["000300.SH"])
    assert bars
    b = bars[0]
    assert b.period == "1m"
    assert b.source == "Wind"
    assert b.extra["volume_unavailable"] is False  # index quote 含 VOLUME


async def test_index_kline(adapter: WindAdapter) -> None:
    from core.domain.units import date_to_ms

    bars = await adapter.get_index_kline(
        "000300.SH", date_to_ms("2026-07-01"), date_to_ms("2026-07-10")
    )
    assert len(bars) == 8
    b = bars[0]
    assert b.period == "1d"
    assert b.adjust == "forward"
    assert b.volume > 0  # index kline 含 VOLUME (与 fund kline 不同, 双形状)


async def test_index_kline_special_code(adapter: WindAdapter) -> None:
    """决策门 C 结论: 指数特殊码 (H11077.SH) windcode 直通 OK."""
    from core.domain.units import date_to_ms

    bars = await adapter.get_index_kline(
        "H11077.SH", date_to_ms("2026-07-01"), date_to_ms("2026-07-10")
    )
    assert len(bars) == 8
    assert bars[0].extra["volume_unavailable"] is True  # 特殊码无 VOLUME 列


async def test_index_fundamentals_nl(adapter: WindAdapter) -> None:
    stmts = await adapter.get_index_fundamentals("000300.SH", name="沪深300")
    assert stmts and stmts[0].statement == "fundamentals"
    row = stmts[0].rows[0]
    assert "市盈率PE_TTM" in row
    assert "市净率PB_LF" in row


async def test_index_basicinfo_nl(adapter: WindAdapter) -> None:
    stmts = await adapter.get_index_basicinfo("000300.SH", name="沪深300")
    assert stmts and stmts[0].statement == "basicinfo"
    row = stmts[0].rows[0]
    assert "成份个数" in row


async def test_windcode_direct_pass_no_ti(adapter: WindAdapter) -> None:
    """windcode 纪律: 请求只发合法 windcode, 无 .TI (LESSONS §5.2)."""
    from core.domain.units import date_to_ms

    captured: list[dict] = []
    a = make_adapter(captured=captured)
    await a.get_fund_kline("158001.SZ", date_to_ms("2026-07-01"), date_to_ms("2026-07-10"))
    calls = [c for c in captured if c["method"] == "tools/call"]
    assert calls[0]["params"]["arguments"]["windcode"] == "158001.SZ"
    assert ".TI" not in str(calls)


async def test_fund_nav_fallback_via_info(adapter: WindAdapter) -> None:
    """Wind 无独立净值工具 → get_fund_info 兜底 (净值在列内, L3 标注)."""
    stmts = await adapter.get_fund_nav("158001.SZ", asset_type="fund-etf", name="价值ETF嘉实")
    assert stmts and stmts[0].statement == "nav"
    assert "单位净值" in stmts[0].rows[0]


async def test_fund_holders_fallback(adapter: WindAdapter) -> None:
    stmts = await adapter.get_fund_holders("158001.SZ", asset_type="fund-etf", name="价值ETF嘉实")
    assert stmts and stmts[0].statement == "holders"
    assert stmts[0].rows  # question 类兜底, 列以响应为准 (fixture 为 info 表)
