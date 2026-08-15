"""M1/M2: scripts/lake.py — marketdb CLI 薄封装测试.

- 单测: mock subprocess.run (参数拼装/key 传递/JSON 解析/退出码)
- 离线集成: 真 marketdb + 合成 parquet (init→import→validate→query), marketdb 缺失时 skip
  (官方包不在 PyPI, 需从 HiThink-Tech/Financial-API 克隆安装 — scripts/lake.py 头注)
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import lake  # noqa: E402

HAS_MARKETDB = importlib.util.find_spec("marketdb") is not None


class FakeProc:
    def __init__(self, rc: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.returncode = rc
        self.stdout = stdout
        self.stderr = stderr


def patch_run(monkeypatch: pytest.MonkeyPatch, proc: FakeProc) -> list[tuple[list[str], dict]]:
    """捕获 lake.run 的 cmd/env, 返回固定 proc. 返回可变 calls 列表 (调用后填充)."""
    calls: list[tuple[list[str], dict]] = []

    def fake_run(cmd: list[str], env: dict, **kw: object) -> FakeProc:
        calls.append((cmd, env))
        return proc

    monkeypatch.setattr(lake.subprocess, "run", fake_run)
    return calls


class TestValidate:
    def test_ok_json(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        body = json.dumps({"db_path": str(tmp_path / "m.duckdb"), "ok": True, "issues": []})
        calls = patch_run(monkeypatch, FakeProc(stdout=body))
        args = lake.argparse.Namespace(db=str(tmp_path / "m.duckdb"), json=True, fn=None)
        assert lake.cmd_validate(args) == 0
        assert calls[0][0][3:] == ["validate", "--json", "--db", str(tmp_path / "m.duckdb")]

    def test_issues_exit_1(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        body = json.dumps(
            {
                "db_path": "x",
                "ok": False,
                "issues": [
                    {
                        "check": "raw_kline_daily.high_ge_low",
                        "severity": "error",
                        "detail": "high<low",
                        "sample": [],
                    }
                ],
            }
        )
        patch_run(monkeypatch, FakeProc(stdout=body))
        args = lake.argparse.Namespace(db=None, json=False, fn=None)
        monkeypatch.setenv("MARKETDB_DB_PATH", str(tmp_path / "m.duckdb"))
        assert lake.cmd_validate(args) == 1

    def test_nonzero_exit_propagates(self, monkeypatch: pytest.MonkeyPatch) -> None:
        patch_run(monkeypatch, FakeProc(rc=2, stderr="boom"))
        args = lake.argparse.Namespace(db=None, json=True, fn=None)
        assert lake.cmd_validate(args) == 2


class TestSync:
    def test_requires_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("HITHINK_FINANCE_API_KEY", raising=False)
        monkeypatch.delenv("THS_API_KEY", raising=False)
        args = lake.argparse.Namespace(db=None, fn=None)
        assert lake.cmd_sync(args) == 2

    def test_key_passthrough(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        envs: list[dict] = []

        def fake_run(cmd: list[str], env: dict, **kw: object) -> FakeProc:
            envs.append(env)
            return FakeProc()

        monkeypatch.setattr(lake.subprocess, "run", fake_run)
        monkeypatch.setenv("THS_API_KEY", "sk-test")
        args = lake.argparse.Namespace(db=str(tmp_path / "m.duckdb"), fn=None)
        assert lake.cmd_sync(args) == 0
        assert envs[0]["HITHINK_FINANCE_API_KEY"] == "sk-test"  # 同值直通


class TestQuery:
    def test_sql_and_limit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        body = json.dumps(
            {
                "row_count": 1,
                "truncated_to": 1,
                "columns": ["thscode"],
                "rows": [{"thscode": "600519.SH"}],
            }
        )
        calls = patch_run(monkeypatch, FakeProc(stdout=body))
        args = lake.argparse.Namespace(db=None, sql="SELECT 1", limit=10, json=True, fn=None)
        assert lake.cmd_query(args) == 0
        assert calls[0][0][3:8] == ["query", "--json", "--sql", "SELECT 1", "--limit"]
        assert calls[0][0][8] == "10"

    def test_sql_required(self, monkeypatch: pytest.MonkeyPatch) -> None:
        patch_run(monkeypatch, FakeProc())
        args = lake.argparse.Namespace(db=None, sql="", limit=None, json=False, fn=None)
        assert lake.cmd_query(args) == 2


class TestImport:
    def test_daily_required(self, monkeypatch: pytest.MonkeyPatch) -> None:
        patch_run(monkeypatch, FakeProc())
        args = lake.argparse.Namespace(db=None, daily="", events=None, fn=None)
        assert lake.cmd_import(args) == 2

    def test_passes_paths(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = patch_run(monkeypatch, FakeProc(stdout="ok"))
        args = lake.argparse.Namespace(db=None, daily="/d.parquet", events="/e.parquet", fn=None)
        assert lake.cmd_import(args) == 0
        assert calls[0][0][3:-2] == [
            "import-parquet",
            "--daily",
            "/d.parquet",
            "--events",
            "/e.parquet",
        ]


@pytest.mark.skipif(not HAS_MARKETDB, reason="marketdb 未安装 (官方克隆 pip install -e ./python)")
class TestOfflineFlow:
    """真 marketdb 离线全流程: init → import 合成 parquet → validate → query 复权."""

    def _synth(self, tmp_path: Path) -> tuple[Path, Path]:
        import datetime as dt
        import random

        import pyarrow as pa
        import pyarrow.parquet as pq

        random.seed(7)
        tz = dt.timezone(dt.timedelta(hours=8))
        days = []
        d = dt.date(2024, 1, 2)
        while d <= dt.date(2024, 12, 31):
            if d.weekday() < 5:
                days.append(d)
            d += dt.timedelta(days=1)
        k_rows, e_rows = [], []
        for i in range(3):
            code = f"6000{i}0.SH"
            price = 10.0
            for day in days:
                price *= 1 + random.uniform(-0.02, 0.02)
                ms = int(dt.datetime(day.year, day.month, day.day, tzinfo=tz).timestamp() * 1000)
                k_rows.append(
                    {
                        "thscode": code,
                        "currency": "CNY",
                        "interval": "1d",
                        "adjusted": "none",
                        "date_ms": ms,
                        "open_price": round(price, 2),
                        "high_price": round(price * 1.01, 2),
                        "low_price": round(price * 0.99, 2),
                        "close_price": round(price, 2),
                        "volume": 1_000_000.0,
                        "turnover": price * 1_000_000.0,
                    }
                )
            ms = int(dt.datetime(2024, 6, 10 + i, tzinfo=tz).timestamp() * 1000)
            e_rows.append(
                {
                    "thscode": code,
                    "ticker": code.split(".")[0],
                    "ex_date_ms": ms,
                    "dividend_per_share": 0.5,
                    "per_share_bonus": None,
                    "allotment_ratio": None,
                    "allotment_price": None,
                    "currency": "CNY",
                }
            )
        daily = tmp_path / "synth_daily.parquet"
        events = tmp_path / "synth_events.parquet"
        pq.write_table(pa.Table.from_pylist(k_rows), daily)
        pq.write_table(pa.Table.from_pylist(e_rows), events)
        return daily, events

    def test_full_offline_flow(self, tmp_path: Path) -> None:
        db = tmp_path / "market.duckdb"
        daily, events = self._synth(tmp_path)

        init = lake.run(["init"], db=db)
        assert init.returncode == 0, init.stderr

        imp = lake.run(["import-parquet", "--daily", str(daily), "--events", str(events)], db=db)
        assert imp.returncode == 0, imp.stderr

        val = lake.run(["validate", "--json"], db=db)
        assert val.returncode == 0, val.stderr
        assert json.loads(val.stdout)["ok"] is True

        st = lake.run(["status", "--json"], db=db)
        data = json.loads(st.stdout)
        import datetime as _dt

        _n = sum(
            1 for i in range(365) if (_dt.date(2024, 1, 2) + _dt.timedelta(days=i)).weekday() < 5
        )  # synth 从 1-2 起
        assert data["raw_kline_daily.rows"] == str(_n * 3)

        q = lake.run(
            [
                "query",
                "--json",
                "--sql",
                "SELECT thscode, COUNT(*) AS n FROM raw_kline_daily GROUP BY thscode",
            ],
            db=db,
        )
        rows = json.loads(q.stdout)["rows"]
        assert len(rows) == 3

        rk = lake.cmd_rebuild(lake.argparse.Namespace(db=db, fn=None))
        assert rk == 0
