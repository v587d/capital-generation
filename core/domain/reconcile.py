"""对账引擎 — 未复权 + 免费源间 (THS × AKShare); Wind 只作基准不参与.

docs/DESIGN_REVIEW.md 决策 1 + docs/LESSONS.md §2/§6:
- 只对账未复权数据 (复权价跨源不可比, 对账必误报) + 免费源间;
- 只比数据时点 (as_of_ms/date_ms), 绝不比查询时点 (时滞可达分钟级, LESSONS §5.3);
- 容差默认 0.5% (LESSONS §6 三源 PE 实测 <0.2%, 0.5% 有实测依据), 外置 config/reconcile.yaml;
- 分歧**不自动修复** — 报告交 LLM 裁决 (divergence → LLM adjudication, 无自动修复).
- 任一侧源失败 → 不抛错, 报告 skipped + warnings (可观测).

对账不走 chains: 双源直取 (绕链), 与 Router 解耦; 需要两个 adapter 实例.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.adapters.base import BaseAdapter
from core.config import load_yaml
from core.domain.errors import FinError
from core.domain.models import Quote
from core.domain.units import now_ms

_DEFAULTS = {"tolerance_pct": 0.5, "asof_tolerance_ms": 300_000}


def _load_defaults() -> dict[str, float]:
    cfg = load_yaml("reconcile.yaml")
    return {**_DEFAULTS, **cfg}


@dataclass(frozen=True)
class ReconcileRow:
    """一条 (key, field) 的双源对照; left=THS, right=AKShare."""

    key: str  # symbol 或 symbol+date
    field: str  # last_price / close / volume
    left: float | None
    right: float | None
    left_as_of_ms: int | None
    right_as_of_ms: int | None
    diff_pct: float | None
    matched: bool
    note: str = ""


@dataclass(frozen=True)
class ReconcileReport:
    domain: str
    rows: tuple[ReconcileRow, ...]
    compared: int
    matched: int
    mismatched: int
    skipped: int
    tolerance_pct: float
    ts_ms: int = 0
    warnings: tuple[str, ...] = ()

    def summary(self) -> dict[str, Any]:
        return {
            "domain": self.domain,
            "compared": self.compared,
            "matched": self.matched,
            "mismatched": self.mismatched,
            "skipped": self.skipped,
            "tolerance_pct": self.tolerance_pct,
        }


def _diff_pct(left: float, right: float) -> float:
    denom = max(abs(left), abs(right), 1e-9)
    return abs(left - right) / denom * 100.0


def _asdict(row: ReconcileRow) -> dict[str, Any]:
    return {
        "key": row.key,
        "field": row.field,
        "ths": row.left,
        "akshare": row.right,
        "ths_as_of_ms": row.left_as_of_ms,
        "akshare_as_of_ms": row.right_as_of_ms,
        "diff_pct": row.diff_pct,
        "matched": row.matched,
        "note": row.note,
    }


def _qmap(quotes: list[Quote]) -> dict[str, Quote]:
    return {q.symbol: q for q in quotes}


async def reconcile_quotes(
    ths: BaseAdapter,
    akshare: BaseAdapter,
    symbols: list[str],
    *,
    tolerance_pct: float | None = None,
    asof_tolerance_ms: int | None = None,
) -> ReconcileReport:
    """快照对账: 按 symbol 对齐, 比 last_price/volume; 数据时滞超窗 → skipped."""
    cfg = _load_defaults()
    tol = tolerance_pct if tolerance_pct is not None else cfg["tolerance_pct"]
    asof_tol = int(asof_tolerance_ms if asof_tolerance_ms is not None else cfg["asof_tolerance_ms"])
    warnings: list[str] = []
    left_map: dict[str, Quote] = {}
    right_map: dict[str, Quote] = {}
    try:
        left_map = _qmap(await ths.get_quote(symbols))
    except FinError as e:
        warnings.append(f"THS 快照不可用: {e.message} ({e.kind})")
    try:
        right_map = _qmap(await akshare.get_quote(symbols))
    except FinError as e:
        warnings.append(f"AKShare 快照不可用: {e.message} ({e.kind})")

    rows: list[ReconcileRow] = []
    for sym in symbols:
        lq, rq = left_map.get(sym), right_map.get(sym)
        if lq is None or rq is None:
            rows.append(
                ReconcileRow(
                    key=sym,
                    field="last_price",
                    left=lq.last_price if lq else None,
                    right=rq.last_price if rq else None,
                    left_as_of_ms=lq.as_of_ms if lq else None,
                    right_as_of_ms=rq.as_of_ms if rq else None,
                    diff_pct=None,
                    matched=False,
                    note="单边缺失",
                )
            )
            continue
        lag = abs(lq.as_of_ms - rq.as_of_ms)
        if lag > asof_tol:
            rows.append(
                ReconcileRow(
                    key=sym,
                    field="last_price",
                    left=lq.last_price,
                    right=rq.last_price,
                    left_as_of_ms=lq.as_of_ms,
                    right_as_of_ms=rq.as_of_ms,
                    diff_pct=None,
                    matched=False,
                    note=f"数据时滞超窗 ({lag / 1000:.0f}s > {asof_tol / 1000:.0f}s), 不比价",
                )
            )
            continue
        for field, lv, rv in (
            ("last_price", lq.last_price, rq.last_price),
            ("volume", lq.volume, rq.volume),
        ):
            if lv is None or rv is None:
                rows.append(
                    ReconcileRow(
                        key=sym,
                        field=field,
                        left=lv,
                        right=rv,
                        left_as_of_ms=lq.as_of_ms,
                        right_as_of_ms=rq.as_of_ms,
                        diff_pct=None,
                        matched=False,
                        note="单侧缺值",
                    )
                )
                continue
            diff = _diff_pct(lv, rv)
            rows.append(
                ReconcileRow(
                    key=sym,
                    field=field,
                    left=lv,
                    right=rv,
                    left_as_of_ms=lq.as_of_ms,
                    right_as_of_ms=rq.as_of_ms,
                    diff_pct=diff,
                    matched=diff <= tol,
                )
            )

    return _report("quote", rows, tol, warnings)


async def reconcile_klines(
    ths: BaseAdapter,
    akshare: BaseAdapter,
    symbol: str,
    start_ms: int,
    end_ms: int,
    *,
    tolerance_pct: float | None = None,
) -> ReconcileReport:
    """日K对账 (未复权): 按 date_ms 对齐, 比 close/volume; 缺失日期 skipped."""
    cfg = _load_defaults()
    tol = tolerance_pct if tolerance_pct is not None else cfg["tolerance_pct"]
    warnings: list[str] = []
    left: list[Any] = []
    right: list[Any] = []
    try:
        left = await ths.get_klines(symbol, start_ms, end_ms, adjust="none")
    except FinError as e:
        warnings.append(f"THS K线不可用: {e.message} ({e.kind})")
    try:
        right = await akshare.get_klines(symbol, start_ms, end_ms, adjust="none")
    except FinError as e:
        warnings.append(f"AKShare K线不可用: {e.message} ({e.kind})")

    lmap = {k.date_ms: k for k in left}
    rmap = {k.date_ms: k for k in right}
    rows: list[ReconcileRow] = []
    for date_ms in sorted(set(lmap) | set(rmap)):
        lk, rk = lmap.get(date_ms), rmap.get(date_ms)
        if lk is None or rk is None:
            rows.append(
                ReconcileRow(
                    key=f"{symbol}@{date_ms}",
                    field="close",
                    left=lk.close if lk else None,
                    right=rk.close if rk else None,
                    left_as_of_ms=date_ms,
                    right_as_of_ms=date_ms,
                    diff_pct=None,
                    matched=False,
                    note="单边缺失",
                )
            )
            continue
        for field, lv, rv in (("close", lk.close, rk.close), ("volume", lk.volume, rk.volume)):
            diff = _diff_pct(lv, rv)
            rows.append(
                ReconcileRow(
                    key=f"{symbol}@{date_ms}",
                    field=field,
                    left=lv,
                    right=rv,
                    left_as_of_ms=date_ms,
                    right_as_of_ms=date_ms,
                    diff_pct=diff,
                    matched=diff <= tol,
                )
            )
    return _report("klines", rows, tol, warnings)


def _report(
    domain: str, rows: list[ReconcileRow], tol: float, warnings: list[str]
) -> ReconcileReport:
    compared = sum(1 for r in rows if r.diff_pct is not None)
    matched = sum(1 for r in rows if r.matched)
    mismatched = sum(1 for r in rows if r.diff_pct is not None and not r.matched)
    skipped = len(rows) - compared
    return ReconcileReport(
        domain=domain,
        rows=tuple(rows),
        compared=compared,
        matched=matched,
        mismatched=mismatched,
        skipped=skipped,
        tolerance_pct=tol,
        ts_ms=now_ms(),
        warnings=tuple(warnings),
    )


__all__ = ["ReconcileReport", "ReconcileRow", "reconcile_klines", "reconcile_quotes"]
