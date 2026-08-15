"""M4: 对账引擎单测 — 双源 stub 数据, 离线 (PLAN-0.2.0.md M4).

验证: 数据时点对齐 / 容差 / 时滞超窗跳过 / 单边缺失 / 不自动修复 / 容差外置。
"""

from __future__ import annotations

import pytest

from core.adapters.base import BaseAdapter
from core.domain.errors import SourceDownError
from core.domain.models import Kline, Quote
from core.domain.reconcile import reconcile_klines, reconcile_quotes
from core.domain.units import date_to_ms, ms_to_date


def quote(symbol: str, price: float, volume: float = 1000.0, as_of_ms: int = 1_000_000) -> Quote:
    return Quote(
        symbol=symbol,
        last_price=price,
        open_price=None,
        high_price=None,
        low_price=None,
        prev_close=None,
        change_pct=None,
        volume=volume,
        turnover=0.0,
        as_of_ms=as_of_ms,
        source="同花顺",
    )


def kline(symbol: str, date: str, close: float, volume: float = 1000.0) -> Kline:
    return Kline(
        symbol=symbol,
        date_ms=date_to_ms(date),
        open=close,
        high=close,
        low=close,
        close=close,
        volume=volume,
        turnover=0.0,
        source="同花顺",
    )


class StubTHS(BaseAdapter):
    vendor_id = "ths"
    capabilities = frozenset({"quote", "klines"})

    def __init__(
        self,
        quotes: dict[str, Quote] | None = None,
        klines: dict[str, list[Kline]] | None = None,
        fail: str | None = None,
    ) -> None:
        self._quotes = quotes or {}
        self._klines = klines or {}
        self._fail = fail

    async def get_quote(self, symbols):
        if self._fail == "quote":
            raise SourceDownError("down", vendor="ths")
        return [q for s in symbols if (q := self._quotes.get(s))]

    async def get_klines(self, symbol, start_ms, end_ms, *, adjust="none"):
        if self._fail == "klines":
            raise SourceDownError("down", vendor="ths")
        return self._klines.get(symbol, [])


class StubAK(BaseAdapter):
    vendor_id = "akshare"
    capabilities = frozenset({"quote", "klines"})

    def __init__(
        self,
        quotes: dict[str, Quote] | None = None,
        klines: dict[str, list[Kline]] | None = None,
        fail: str | None = None,
    ) -> None:
        self._quotes = quotes or {}
        self._klines = klines or {}
        self._fail = fail

    async def get_quote(self, symbols):
        if self._fail == "quote":
            raise SourceDownError("down", vendor="akshare")
        return [q for s in symbols if (q := self._quotes.get(s))]

    async def get_klines(self, symbol, start_ms, end_ms, *, adjust="none"):
        if self._fail == "klines":
            raise SourceDownError("down", vendor="akshare")
        return self._klines.get(symbol, [])


async def test_quote_match_within_tolerance() -> None:
    ths = StubTHS(quotes={"600519.SH": quote("600519.SH", 100.0, as_of_ms=1_000_000)})
    ak = StubAK(quotes={"600519.SH": quote("600519.SH", 100.3, as_of_ms=1_000_100)})
    rep = await reconcile_quotes(ths, ak, ["600519.SH"])
    assert rep.mismatched == 0
    assert rep.matched == 2  # last_price + volume
    assert rep.skipped == 0
    price_row = [r for r in rep.rows if r.field == "last_price"][0]
    assert price_row.diff_pct == pytest.approx(0.3, abs=0.01)  # 0.3% ≤ 0.5%


async def test_quote_mismatch_no_autofix() -> None:
    ths = StubTHS(quotes={"600519.SH": quote("600519.SH", 100.0, as_of_ms=1_000_000)})
    ak = StubAK(quotes={"600519.SH": quote("600519.SH", 102.0, as_of_ms=1_000_000)})
    rep = await reconcile_quotes(ths, ak, ["600519.SH"])
    assert rep.mismatched == 1
    row = [r for r in rep.rows if r.field == "last_price"][0]
    assert not row.matched
    assert row.diff_pct == pytest.approx(1.96, abs=0.01)  # 2/102
    # 不自动修复: 双源原始值保留, 交 LLM 裁决
    assert row.left == 100.0 and row.right == 102.0


async def test_quote_asof_lag_skipped() -> None:
    ths = StubTHS(quotes={"600519.SH": quote("600519.SH", 100.0, as_of_ms=1_000_000)})
    ak = StubAK(quotes={"600519.SH": quote("600519.SH", 100.0, as_of_ms=1_000_000 + 6_000_000)})
    rep = await reconcile_quotes(ths, ak, ["600519.SH"], asof_tolerance_ms=60_000)
    assert rep.skipped == 1
    row = rep.rows[0]
    assert not row.matched
    assert "时滞超窗" in row.note


async def test_quote_side_missing() -> None:
    ths = StubTHS(quotes={"600519.SH": quote("600519.SH", 100.0)})
    ak = StubAK(quotes={})  # 单边缺失
    rep = await reconcile_quotes(ths, ak, ["600519.SH"])
    assert rep.skipped == 1
    assert "单边缺失" in rep.rows[0].note


async def test_quote_source_down_warning() -> None:
    ths = StubTHS(fail="quote")
    ak = StubAK(quotes={"600519.SH": quote("600519.SH", 100.0)})
    rep = await reconcile_quotes(ths, ak, ["600519.SH"])
    assert rep.skipped == 1
    assert any("THS 快照不可用" in w for w in rep.warnings)
    assert rep.mismatched == 0  # 不把单边当分歧


async def test_klines_align_by_date_ms() -> None:
    ths = StubTHS(
        klines={
            "600519.SH": [
                kline("600519.SH", "2026-07-01", 100.0),
                kline("600519.SH", "2026-07-02", 101.0),
            ]
        }
    )
    ak = StubAK(
        klines={
            "600519.SH": [
                kline("600519.SH", "2026-07-01", 100.2),
                kline("600519.SH", "2026-07-03", 99.0),  # 07-02 缺失, 07-03 单边
            ]
        }
    )
    rep = await reconcile_klines(
        ths, ak, "600519.SH", date_to_ms("2026-07-01"), date_to_ms("2026-07-03")
    )
    assert rep.mismatched == 0
    assert rep.matched == 2  # 07-01 close+volume
    assert rep.skipped == 2  # 07-02 (单边) + 07-03 (单边)
    close_rows = [r for r in rep.rows if r.field == "close"]
    assert ms_to_date(close_rows[0].left_as_of_ms or 0) == "2026-07-01"
    assert close_rows[0].matched
    assert close_rows[0].left_as_of_ms == close_rows[0].right_as_of_ms  # 比数据时点
    assert "单边缺失" in close_rows[1].note


async def test_klines_tolerance_override() -> None:
    ths = StubTHS(klines={"600519.SH": [kline("600519.SH", "2026-07-01", 100.0)]})
    ak = StubAK(klines={"600519.SH": [kline("600519.SH", "2026-07-01", 100.3)]})
    rep = await reconcile_klines(ths, ak, "600519.SH", 0, 1 << 40, tolerance_pct=0.1)
    assert rep.mismatched == 1  # 0.3% > 0.1%
    assert rep.tolerance_pct == 0.1


async def test_klines_unadjusted_only() -> None:
    """对账只比未复权 (引擎强制 adjust='none' 直取)."""
    calls: list[str] = []

    class T(StubTHS):
        async def get_klines(self, symbol, start_ms, end_ms, *, adjust="none"):
            calls.append(adjust)
            return []

    await reconcile_klines(T(klines={}), StubAK(klines={}), "600519.SH", 0, 1 << 40)
    assert calls == ["none"]
