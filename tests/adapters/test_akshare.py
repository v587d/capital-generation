"""M4: AKShare adapter unit tests — golden-driven, offline (mock _call)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from core.adapters.akshare_adapter import AKShareAdapter
from core.domain.errors import FinTimeoutError, NoDataError, SourceDownError
from core.domain.units import date_to_ms

GOLDEN = Path(__file__).resolve().parents[1] / "golden" / "akshare"


def load_golden(name: str) -> list[dict]:
    return json.loads((GOLDEN / f"{name}.json").read_text(encoding="utf-8"))["rows"]


def make_adapter(rows_by_fn: dict[str, list[dict]], *, interval: float = 0.0) -> AKShareAdapter:
    adapter = AKShareAdapter(min_interval_s=interval)

    async def fake_call(fn_name: str, fn: Any, **kw: Any) -> list[dict]:
        # lambda (special 白名单) 无 __name__ → 回退 fn_name 键
        return rows_by_fn.get(getattr(fn, "__name__", ""), rows_by_fn.get(fn_name))

    adapter._call = fake_call  # type: ignore[method-assign]
    return adapter


def make_adapter_raising(
    rows_by_fn: dict[str, list[dict]], raise_by_fn: dict[str, Exception]
) -> AKShareAdapter:
    """上游链测试: 指定 fn 抛错 (模拟东财封锁/上游故障)."""
    adapter = AKShareAdapter(min_interval_s=0.0)

    async def fake_call(fn_name: str, fn: Any, **kw: Any) -> list[dict]:
        if fn_name in raise_by_fn:
            raise raise_by_fn[fn_name]
        return rows_by_fn.get(getattr(fn, "__name__", ""), rows_by_fn.get(fn_name))

    adapter._call = fake_call  # type: ignore[method-assign]
    return adapter


_EM_ROWS = [
    {
        "日期": "2026-06-01",
        "开盘": 1,
        "最高": 2,
        "最低": 1,
        "收盘": 1.5,
        "成交量": 100.0,
        "成交额": 1000.0,
    }
]
_SINA_ROWS = [
    {
        "date": "2026-06-01",
        "open": 1,
        "high": 2,
        "low": 1,
        "close": 1.5,
        "volume": 100.0,
        "amount": 1000.0,
    }
]
_TX_ROWS = [
    {
        "date": "2026-06-01",
        "open": 1,
        "close": 1.5,
        "high": 2,
        "low": 1,
        "volume": 100.0,
        "turnover": 0.01,
        "amount": 1000.0,
    }
]


class TestKline:
    @pytest.mark.asyncio
    async def test_parses_golden(self) -> None:
        golden = GOLDEN / "kline_600519_1m.json"
        if not golden.exists():  # 东财 push2his 封锁期间无法录制 → 显式跳过
            pytest.skip("kline golden 未录制 (东财限频); 封锁解除后运行 scripts/record-goldens.py")
        adapter = make_adapter({"stock_zh_a_hist": load_golden("kline_600519_1m")})
        bars = await adapter.get_klines(
            "600519.SH", start_ms=date_to_ms("2026-06-01"), end_ms=date_to_ms("2026-07-01")
        )
        assert bars, "golden has bars"
        b = bars[0]
        assert b.symbol == "600519"
        assert b.volume > 0  # 手→股 已转换
        assert b.volume == b.volume  # float
        assert b.adjust == "none"
        assert b.extra["akshare_adjust"] == ""  # 实际无复权
        assert b.source == "AKShare"

    @pytest.mark.asyncio
    async def test_hand_to_share_conversion(self) -> None:
        rows = [
            {
                "日期": "2026-06-01",
                "开盘": 1,
                "最高": 2,
                "最低": 1,
                "收盘": 1.5,
                "成交量": 100.0,
                "成交额": 1000.0,
            }
        ]
        adapter = make_adapter({"stock_zh_a_hist": rows})
        bars = await adapter.get_klines(
            "600519.SH", start_ms=date_to_ms("2026-06-01"), end_ms=date_to_ms("2026-06-02")
        )
        assert bars[0].volume == 10000.0  # 100 手 → 10000 股
        assert bars[0].turnover == 1000.0

    @pytest.mark.asyncio
    async def test_adjust_mapping_tagged(self) -> None:
        rows = [
            {
                "日期": "2026-06-01",
                "开盘": 1,
                "最高": 2,
                "最低": 1,
                "收盘": 1.5,
                "成交量": 1,
                "成交额": 1,
            }
        ]
        adapter = make_adapter({"stock_zh_a_hist": rows})
        bars = await adapter.get_klines("600519.SH", start_ms=1, end_ms=2, adjust="forward")
        assert bars[0].adjust == "forward"  # L3: 声明请求口径
        assert bars[0].extra["akshare_adjust"] == "qfq"  # 实际实现

    # ── v0.1.1 上游链 (东财 → 新浪 → 腾讯; LESSONS §5.4) ──────────────

    @pytest.mark.asyncio
    async def test_sina_golden(self) -> None:
        """新浪上游: 英文列, volume 单位=股 (不 ×100), extra.upstream 标注."""
        golden = GOLDEN / "kline_sina_600519.json"
        if not golden.exists():
            pytest.skip("kline_sina golden 未录制")
        adapter = make_adapter_raising(
            {"stock_zh_a_daily": load_golden("kline_sina_600519")},
            {
                "stock_zh_a_hist": SourceDownError(
                    "eastmoney blocked",
                    source="AKShare",
                    vendor="akshare",
                    endpoint="stock_zh_a_hist",
                )
            },
        )
        bars = await adapter.get_klines(
            "600519.SH", start_ms=date_to_ms("2026-06-01"), end_ms=date_to_ms("2026-07-01")
        )
        assert bars
        assert bars[0].symbol == "600519"
        assert bars[0].volume > 0
        assert bars[0].extra["upstream"] == "stock_zh_a_daily"
        assert bars[0].source == "AKShare"

    @pytest.mark.asyncio
    async def test_tx_golden_hand_to_share(self) -> None:
        """腾讯上游: volume 单位=手 → ×100; extra.upstream 标注."""
        golden = GOLDEN / "kline_tx_000001.json"
        if not golden.exists():
            pytest.skip("kline_tx golden 未录制")
        adapter = make_adapter_raising(
            {"stock_zh_a_hist_tx": load_golden("kline_tx_000001")},
            {
                "stock_zh_a_hist": SourceDownError(
                    "eastmoney blocked",
                    source="AKShare",
                    vendor="akshare",
                    endpoint="stock_zh_a_hist",
                ),
                "stock_zh_a_daily": SourceDownError(
                    "sina down", source="AKShare", vendor="akshare", endpoint="stock_zh_a_daily"
                ),
            },
        )
        bars = await adapter.get_klines(
            "000001.SZ", start_ms=date_to_ms("2026-06-01"), end_ms=date_to_ms("2026-07-01")
        )
        assert bars
        assert bars[0].symbol == "000001"
        assert bars[0].extra["upstream"] == "stock_zh_a_hist_tx"
        assert bars[0].volume > 0

    @pytest.mark.asyncio
    async def test_fallback_sina_when_eastmoney_down(self) -> None:
        """东财 SourceDown (IP 封锁) → 新浪接管, 结果带 upstream 标注."""
        adapter = make_adapter_raising(
            {"stock_zh_a_daily": _SINA_ROWS},
            {
                "stock_zh_a_hist": SourceDownError(
                    "eastmoney blocked",
                    source="AKShare",
                    vendor="akshare",
                    endpoint="stock_zh_a_hist",
                )
            },
        )
        bars = await adapter.get_klines("600519.SH", start_ms=1, end_ms=2)
        assert bars[0].extra["upstream"] == "stock_zh_a_daily"
        assert bars[0].volume == 100.0  # 新浪 volume 单位=股, 不转换

    @pytest.mark.asyncio
    async def test_fallback_tx_when_sina_down(self) -> None:
        """东财+新浪都挂 → 腾讯接管; volume 手→股."""
        down = SourceDownError("down", source="AKShare", vendor="akshare")
        adapter = make_adapter_raising(
            {"stock_zh_a_hist_tx": _TX_ROWS},
            {"stock_zh_a_hist": down, "stock_zh_a_daily": down},
        )
        bars = await adapter.get_klines("000001.SZ", start_ms=1, end_ms=2)
        assert bars[0].extra["upstream"] == "stock_zh_a_hist_tx"
        assert bars[0].volume == 10000.0  # 100 手 → 10000 股

    @pytest.mark.asyncio
    async def test_all_upstreams_down_raises_with_context(self) -> None:
        """三上游全挂 → SourceDownError 带全部上游上下文 (交路由链降级)."""
        down = SourceDownError("down", source="AKShare", vendor="akshare")
        adapter = make_adapter_raising(
            {},
            {
                "stock_zh_a_hist": down,
                "stock_zh_a_daily": down,
                "stock_zh_a_hist_tx": FinTimeoutError("slow", source="AKShare", vendor="akshare"),
            },
        )
        with pytest.raises(
            SourceDownError, match="stock_zh_a_hist.*stock_zh_a_daily.*stock_zh_a_hist_tx"
        ):
            await adapter.get_klines("600519.SH", start_ms=1, end_ms=2)

    @pytest.mark.asyncio
    async def test_no_data_does_not_switch_upstream(self) -> None:
        """东财返回空 → 返回空结果, 不切上游 (空值纪律: 不模拟)."""
        called: list[str] = []
        adapter = AKShareAdapter(min_interval_s=0.0)

        async def fake_call(fn_name: str, fn: Any, **kw: Any) -> list[dict]:
            called.append(fn_name)
            return []

        adapter._call = fake_call  # type: ignore[method-assign]
        bars = await adapter.get_klines("600519.SH", start_ms=1, end_ms=2)
        assert bars == []
        assert called == ["stock_zh_a_hist"]


class TestQuote:
    @pytest.mark.asyncio
    async def test_vertical_table_parsing(self) -> None:
        # stock_bid_ask_em 竖表结构 [item, value]
        rows = [
            {"item": "最新", "value": 1341.99},
            {"item": "今开", "value": 1359.0},
            {"item": "最高", "value": 1360.0},
            {"item": "最低", "value": 1338.0},
            {"item": "昨收", "value": 1355.3},
            {"item": "涨幅", "value": -0.98},
            {"item": "总手", "value": 29853.0},
            {"item": "金额", "value": 4024065608.0},
        ]
        adapter = make_adapter({"stock_bid_ask_em": rows})
        quotes = await adapter.get_quote(["600519.SH"])
        q = quotes[0]
        assert q.last_price == 1341.99
        assert q.change_pct == -0.98
        assert q.volume == 29853.0 * 100  # 总手 → 股
        assert q.turnover == 4024065608.0
        assert q.source == "AKShare"
        assert q.as_of_ms == 0  # 未知时点不猜

    @pytest.mark.asyncio
    async def test_no_data_raises(self) -> None:
        adapter = make_adapter({"stock_bid_ask_em": []})
        with pytest.raises(NoDataError):
            await adapter.get_quote(["600519.SH"])


class TestFinancials:
    @pytest.mark.asyncio
    async def test_income_golden(self) -> None:
        adapter = make_adapter({"stock_financial_report_sina": load_golden("income_600519")})
        rows = await adapter.get_financials("600519.SH", "income", limit=2)
        assert len(rows) == 2
        assert rows[0].statement == "income"
        assert rows[0].source == "AKShare"
        assert any("营业总收入" in dict(r) for r in rows[0].rows)

    @pytest.mark.asyncio
    async def test_indicators_golden(self) -> None:
        adapter = make_adapter(
            {"stock_financial_analysis_indicator": load_golden("indicators_600519")}
        )
        rows = await adapter.get_financials("600519.SH", "indicators", limit=2)
        assert len(rows) == 2


class TestCalendar:
    @pytest.mark.asyncio
    async def test_calendar_golden(self) -> None:
        adapter = make_adapter({"tool_trade_date_hist_sina": load_golden("calendar_sample")})
        days = await adapter.get_calendar()
        assert days
        assert all(d.is_trading for d in days)
        assert days[0].source == "AKShare"


class TestSpecial:
    @pytest.mark.asyncio
    async def test_limit_up_golden(self) -> None:
        adapter = make_adapter({"special/limit-up": load_golden("zt_pool_20260814")})
        data = await adapter.get_special_data("limit-up", date="2026-08-14")
        assert data.kind == "limit-up"
        assert data.items
        assert any("代码" in dict(r) for r in data.items)

    @pytest.mark.asyncio
    async def test_unsupported_kind(self) -> None:
        adapter = make_adapter({})
        with pytest.raises(NoDataError):
            await adapter.get_special_data("limit-up-ladder")


class TestErrors:
    @pytest.mark.asyncio
    async def test_keyerror_maps_to_source_down(self) -> None:
        def boom() -> Any:
            raise KeyError("成交量")

        adapter = AKShareAdapter(min_interval_s=0)
        with pytest.raises(SourceDownError) as ei:
            await adapter._call("stock_zh_a_hist", boom)
        assert "接口漂移" in ei.value.message
        assert ei.value.retryable

    @pytest.mark.asyncio
    async def test_timeout_maps_to_fin_timeout(self) -> None:
        def slow() -> Any:
            raise TimeoutError()

        adapter = AKShareAdapter(min_interval_s=0)
        with pytest.raises(FinTimeoutError):
            await adapter._call("tool_trade_date_hist_sina", slow)

    @pytest.mark.asyncio
    async def test_generic_failure_maps_to_source_down(self) -> None:
        def broken() -> Any:
            raise ConnectionError("Remote end closed connection")

        adapter = AKShareAdapter(min_interval_s=0)
        with pytest.raises(SourceDownError):
            await adapter._call("stock_zh_a_hist", broken)

    @pytest.mark.asyncio
    async def test_frequency_gate(self) -> None:
        import time

        def ok() -> list[dict]:
            return [{"trade_date": "2026-08-14"}]

        adapter = AKShareAdapter(min_interval_s=0.3)
        t0 = time.monotonic()
        await adapter._call("tool_trade_date_hist_sina", ok)
        await adapter._call("tool_trade_date_hist_sina", ok)
        elapsed = time.monotonic() - t0
        assert elapsed >= 0.3  # 第二次调用被频率闸挡住 ≥0.3s


class TestEdbFallback:
    """v0.2.0 EDB 白名单兜底 (config/akshare_edb.yaml, golden 驱动)."""

    @pytest.mark.asyncio
    async def test_whitelist_gdp(self) -> None:
        adapter = make_adapter({"macro_china_gdp_yearly": load_golden("edb_gdp")})
        points = await adapter.get_edb("中国GDP", observation=5)
        assert points
        p = points[0]
        assert p.code == "gdp"
        assert p.date_label == "2011-01-20"
        from core.domain.units import date_to_ms

        assert p.date_ms == date_to_ms("2011-01-20")
        assert p.indicator == "中国GDP年率报告·今值"
        assert p.value == 9.8
        assert p.source == "AKShare"
        assert p.tier == "free"

    @pytest.mark.asyncio
    async def test_whitelist_cpi_month_label(self) -> None:
        adapter = make_adapter({"macro_china_cpi": load_golden("edb_cpi")})
        points = await adapter.get_edb("CPI")
        assert points
        p = points[0]
        assert p.date_label == "2026年07月份"
        assert p.date_ms is not None  # "2026年07月份" 可解析
        assert p.indicator == "全国-当月"

    @pytest.mark.asyncio
    async def test_whitelist_shrzgm_yyyymm_label(self) -> None:
        adapter = make_adapter({"macro_china_shrzgm": load_golden("edb_shrzgm")})
        points = await adapter.get_edb("社会融资")
        assert points
        p = points[0]
        assert p.date_label == "201501"
        assert p.date_ms is not None  # "201501" 可解析

    @pytest.mark.asyncio
    async def test_unknown_indicator_no_data(self) -> None:
        adapter = make_adapter({})
        with pytest.raises(NoDataError) as ei:
            await adapter.get_edb("美联储利率")
        assert "白名单" in ei.value.message

    @pytest.mark.asyncio
    async def test_alias_matching_case_insensitive(self) -> None:
        adapter = make_adapter({"macro_china_pmi": load_golden("edb_pmi")})
        points = await adapter.get_edb("制造业PMI")
        assert points
        assert points[0].code == "pmi"
