"""M1: domain models — L1/L2 shape, provenance fields, envelope."""

from core.domain.models import CalendarDay, Envelope, Instrument, Kline, Quote
from core.domain.units import date_to_ms


def test_instrument_l1() -> None:
    inst = Instrument(symbol="600519.SH", name="贵州茅台", asset_type="stock", exchange="SH")
    assert inst.currency == "CNY"


def test_quote_l2_shape_and_provenance() -> None:
    q = Quote(
        symbol="600519.SH",
        last_price=1400.0,
        open_price=None,
        high_price=None,
        low_price=None,
        prev_close=1390.0,
        change_pct=0.72,
        volume=3000000,
        turnover=4.2e9,
        as_of_ms=date_to_ms("2026-08-15"),
        source="同花顺",
        tier="free",
        extra={"ths_ts": 1},
    )
    assert q.volume == 3000000  # 股, not 手
    assert q.source == "同花顺"
    assert q.tier == "free"
    assert q.extra["ths_ts"] == 1


def test_kline_adjust_is_declaration() -> None:
    k = Kline(
        symbol="600519.SH",
        date_ms=date_to_ms("2026-08-15"),
        open=1, high=2, low=1, close=1.5,
        volume=100, turnover=200,
        adjust="forward",  # L3: declared, never converted
    )
    assert k.adjust == "forward"


def test_envelope_wraps_with_query_time() -> None:
    q = Quote(
        symbol="600519.SH", last_price=1.0, open_price=None, high_price=None,
        low_price=None, prev_close=None, change_pct=None, volume=1, turnover=1,
        as_of_ms=1, source="同花顺",
    )
    env = Envelope(data=q, ts_ms=2, warnings=("degraded from 同花顺 to AKShare",))
    assert env.data is q
    assert env.ts_ms == 2
    assert env.warnings == ("degraded from 同花顺 to AKShare",)


def test_calendar_day() -> None:
    d = CalendarDay(date_ms=date_to_ms("2026-08-15"), is_trading=True)
    assert d.is_trading
