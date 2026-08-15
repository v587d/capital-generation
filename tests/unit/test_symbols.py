"""M2: symbol normalization rules (docs/DESIGN_REVIEW.md 决策 5 + LESSONS §5)."""

from pathlib import Path
from typing import Any

from core.domain.symbols import SymbolRecord, SymbolResolver


def rec(thscode: str, name: str = "", asset_type: str = "a-share") -> SymbolRecord:
    ticker = thscode.split(".")[0]
    exchange = thscode.split(".")[1] if "." in thscode else None
    return SymbolRecord(
        thscode=thscode,
        ticker=ticker,
        name=name,
        exchange=exchange,
        asset_type=asset_type,
        currency="CNY",
    )


FIXTURE = [
    rec("600519.SH", "贵州茅台"),  # stock SH
    rec("000001.SZ", "平安银行"),  # stock SZ
    rec("300750.SZ", "宁德时代"),  # stock SZ (创业板)
    rec("000001.SH", "上证指数", "a-share-index"),  # index: THS 权威表用 .SH + ticker 1A0001
    rec("000300.SH", "沪深300", "a-share-index"),  # index SH, ticker 1B0300 (非裸码)
    rec("883970.TI", "昨日涨停", "a-share-index"),  # THS 板块概念码 .TI
    rec("510300.SH", "沪深300ETF", "fund-etf"),  # ETF
    rec("113050.SH", "南银转债", "a-share"),  # 可转债 (THS 类别以表为准)
    rec("430047.BJ", "诺思兰德"),  # stock BJ (北交所)
    rec("00700.HK", "腾讯控股", "a-share"),  # HK (THS 无港股; 仅测试隔离)
]


def resolver() -> SymbolResolver:
    return SymbolResolver(FIXTURE)


class TestTableHits:
    def test_full_thscode(self) -> None:
        r = resolver().resolve("600519.SH")
        assert r.instrument is not None
        assert r.instrument.symbol == "600519.SH"
        assert r.instrument.asset_type == "stock"

    def test_bare_code_stock(self) -> None:
        r = resolver().resolve("600519")
        assert r.instrument is not None and r.instrument.symbol == "600519.SH"

    def test_bare_code_sz(self) -> None:
        assert resolver().resolve("000001").instrument is None  # ambiguous, see below
        r = resolver().resolve("300750")
        assert r.instrument is not None and r.instrument.symbol == "300750.SZ"

    def test_bare_code_bj(self) -> None:
        r = resolver().resolve("430047")
        assert r.instrument is not None and r.instrument.symbol == "430047.BJ"

    def test_etf_and_bond_from_table(self) -> None:
        assert resolver().resolve("510300.SH").instrument is not None
        assert resolver().resolve("113050").instrument is not None

    def test_name_resolution(self) -> None:
        r = resolver().resolve("贵州茅台")
        assert r.instrument is not None and r.instrument.symbol == "600519.SH"


class TestAmbiguity:
    def test_000001_ambiguous_index_vs_stock(self) -> None:
        r = resolver().resolve("000001")
        assert r.instrument is None
        assert {c.symbol for c in r.candidates} == {"000001.SH", "000001.SZ"}

    def test_market_hint_filters(self) -> None:
        r = resolver().resolve("000001", market="指数")
        assert r.instrument is not None and r.instrument.symbol == "000001.SH"

    def test_market_hint_stock(self) -> None:
        r = resolver().resolve("000001", market="A股")
        assert r.instrument is not None and r.instrument.symbol == "000001.SZ"


class TestBarePrefixIndex:
    def test_sh_index_bare_code_via_prefix(self) -> None:
        # ticker is 1B0300, not 000300 — resolved via thscode numeric prefix
        r = resolver().resolve("000300")
        assert r.instrument is not None and r.instrument.symbol == "000300.SH"
        assert r.instrument.asset_type == "index"

    def test_ti_board_bare_code(self) -> None:
        r = resolver().resolve("883970")
        assert r.instrument is not None and r.instrument.symbol == "883970.TI"


class TestFallbackInference:
    def test_unknown_stock_code_6(self) -> None:
        # not in table → stock suffix inference (6→SH)
        r = resolver().resolve("688888")
        assert r.instrument is not None
        assert r.instrument.symbol == "688888.SH"
        assert r.instrument.asset_type == "stock"

    def test_unknown_stock_code_0(self) -> None:
        assert resolver().resolve("001111").instrument.symbol == "001111.SZ"

    def test_unknown_short_code_no_guess(self) -> None:
        # 5-digit codes: no rule — do NOT guess
        assert resolver().resolve("51030").instrument is None

    def test_unknown_etf_like_not_guessed(self) -> None:
        # 5xxxxx = SH ETF/fund segment, not stock → no inference rule, no guess
        assert resolver().resolve("510399").instrument is None


class TestIndexCodes:
    def test_ti_passthrough(self) -> None:
        r = resolver().resolve("883970.TI")
        assert r.instrument is not None and r.instrument.asset_type == "index"

    def test_sh_index_thscode(self) -> None:
        r = resolver().resolve("000001.SH")
        assert r.instrument is not None
        assert r.instrument.name == "上证指数"
        assert r.instrument.asset_type == "index"

    def test_hk_style_short_code_not_guessed(self) -> None:
        # 00701: 5 digits, not in table → no rule, no guess
        assert resolver().resolve("00701").instrument is None

    def test_hk_code_from_table(self) -> None:
        r = resolver().resolve("00700.HK")
        assert r.instrument is not None and r.instrument.symbol == "00700.HK"


class TestSnapshotAge:
    """v0.3.0 M6: symbols 快照新鲜度 (启动检测 + sync --if-stale 共用)."""

    def test_age_from_generated_at(self, tmp_path) -> None:
        import json
        from datetime import UTC, datetime, timedelta

        from core.domain.symbols import snapshot_age_days

        p = tmp_path / "symbols.json"
        old = (datetime.now(UTC) - timedelta(days=40)).isoformat(timespec="seconds")
        p.write_text(json.dumps({"generated_at": old, "records": []}), encoding="utf-8")
        assert snapshot_age_days(p) == 40

    def test_missing_returns_none(self, tmp_path) -> None:
        from core.domain.symbols import snapshot_age_days

        assert snapshot_age_days(tmp_path / "nope.json") is None

    def test_corrupt_returns_none(self, tmp_path) -> None:
        from core.domain.symbols import snapshot_age_days

        p = tmp_path / "symbols.json"
        p.write_text("{not json", encoding="utf-8")
        assert snapshot_age_days(p) is None


class TestSyncIfStale:
    """v0.3.0 M6: sync-symbols --if-stale 跳过新鲜快照 (自动同步入口).

    文件名带连字符 (sync-symbols.py) 无法常规 import → importlib 按路径加载。
    """

    @staticmethod
    def _load_sync() -> Any:
        import importlib.util

        path = Path(__file__).resolve().parents[2] / "scripts" / "sync-symbols.py"
        spec = importlib.util.spec_from_file_location("sync_symbols_mod", path)
        assert spec and spec.loader
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_skips_fresh_snapshot(self, monkeypatch) -> None:
        sync = self._load_sync()
        monkeypatch.setattr(sync, "snapshot_age_days", lambda: 5)
        monkeypatch.setattr(
            sync,
            "fetch_all",
            lambda *a, **k: (_ for _ in ()).throw(AssertionError("不应触发网络同步")),
        )
        args = sync.argparse.Namespace(asset_types="x", exchanges="SH", if_stale=30)
        assert sync.main_with_args(args) == 0

    def test_syncs_stale_snapshot(self, monkeypatch, tmp_path) -> None:
        import json

        monkeypatch.setenv("THS_API_KEY", "sk-test")
        sync = self._load_sync()
        monkeypatch.setattr(sync, "snapshot_age_days", lambda: 40)
        out = tmp_path / "symbols.json"
        monkeypatch.setattr(sync, "OUT", out)
        monkeypatch.setattr(
            sync,
            "fetch_all",
            lambda *a, **k: [
                {
                    "thscode": "600519.SH",
                    "ticker": "600519",
                    "name": "贵州茅台",
                    "exchange": "SH",
                    "asset_type": "a-share",
                    "currency": "CNY",
                }
            ],
        )
        args = sync.argparse.Namespace(asset_types="a-share", exchanges="SH", if_stale=30)
        assert sync.main_with_args(args) == 0
        doc = json.loads(out.read_text(encoding="utf-8"))
        assert doc["count"] == 1
