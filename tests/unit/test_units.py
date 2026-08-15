"""M1: time/unit/source-name traps (docs/DATA_MODEL.md 时间陷阱 + L2 单位)."""

import pytest

from core.domain.units import date_to_ms, ms_to_date, now_ms, source_name, to_shares, utc_iso


class TestTime:
    def test_date_to_ms_is_shanghai_midnight(self) -> None:
        # 2024-08-30 00:00 Asia/Shanghai == 2024-08-29 16:00 UTC == 1724947200000
        ms = date_to_ms("2024-08-30")
        assert ms == 1724947200000

    def test_roundtrip(self) -> None:
        assert ms_to_date(date_to_ms("2024-08-30")) == "2024-08-30"

    def test_not_host_tz(self) -> None:
        # time.mktime on a UTC host yields 1724976000000 (UTC midnight, 8h off);
        # the same-tz-aware-datetime subtraction bug yields the same wrong value.
        assert date_to_ms("2024-08-30") != 1724976000000

    def test_utc_iso_roundtrip(self) -> None:
        assert utc_iso(date_to_ms("2024-08-30")) == "2024-08-29T16:00:00.000Z"

    def test_now_ms_sane(self) -> None:
        import time

        assert abs(now_ms() - int(time.time() * 1000)) < 10_000


class TestVolume:
    def test_hand_to_share(self) -> None:
        assert to_shares(123.0, "手") == 12300.0

    def test_share_passthrough(self) -> None:
        assert to_shares(12300.0, "股") == 12300.0
        assert to_shares(12300.0, "") == 12300.0

    def test_unknown_unit_raises(self) -> None:
        with pytest.raises(ValueError):
            to_shares(1.0, "张")  # annotate, don't guess


class TestSourceNames:
    def test_canonical_display_names(self) -> None:
        assert source_name("ths") == "同花顺"
        assert source_name("wind") == "Wind"  # capital W
        assert source_name("akshare") == "AKShare"

    def test_unknown_passthrough(self) -> None:
        assert source_name("nope") == "nope"
