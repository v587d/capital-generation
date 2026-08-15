"""Symbol normalization — canonical mapping, authoritative source: THS ticker-list.

docs/DESIGN_REVIEW.md 决策 5 + docs/LESSONS.md §5: bare-code inference is a *fallback*
that only holds for A-share stocks (6→SH / 0,3→SZ / 4,8,9→BJ). 可转债/ETF/指数/基金
must come from the table — guessing their market is a known trap (000001 = 平安银行
vs 上证指数; pi-fin-prism 实测 Wind 把 000001.TI 误读成平安银行).

The resolver is offline (reads config/symbols.json). Live name search (消歧) is the
fin_data__search_symbols tool's job (THS /api/meta/tickers/search).
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from core.domain.models import Instrument

# THS asset_type leaf → canonical asset class (DATA_MODEL: stock/bond/index/fund/...)
_ASSET_TYPE_CANONICAL = {
    "a-share": "stock",
    "a-share-index": "index",
    "fund-otc": "fund",
    "fund-etf": "fund",
    "fund-lof": "fund",
    "fund-reits": "fund",
    "forex": "forex",
}

# market hint (工具入参 market) → canonical asset classes it may match.
_MARKET_ASSET_CLASSES: dict[str, frozenset[str]] = {
    "A股": frozenset({"stock"}),
    "指数": frozenset({"index"}),
    "板块": frozenset({"index"}),
    "基金": frozenset({"fund"}),
    "债券": frozenset({"stock", "bond"}),  # 可转债在 THS 侧类别以表为准
    "可转债": frozenset({"stock", "bond"}),
}

# Bare-code fallback: A-share STOCK suffix rules only (LESSONS §5.1).
_STOCK_SUFFIX_BY_FIRST = {"6": "SH", "0": "SZ", "3": "SZ", "4": "BJ", "8": "BJ", "9": "BJ"}


def canonical_asset_type(ths_asset_type: str) -> str:
    return _ASSET_TYPE_CANONICAL.get(ths_asset_type, ths_asset_type)


@dataclass(frozen=True)
class SymbolRecord:
    thscode: str
    ticker: str
    name: str
    exchange: str | None
    asset_type: str  # THS leaf: a-share / a-share-index / fund-* / ...
    currency: str

    @property
    def canonical_asset(self) -> str:
        return canonical_asset_type(self.asset_type)

    def to_instrument(self) -> Instrument:
        return Instrument(
            symbol=self.thscode,
            name=self.name,
            asset_type=self.canonical_asset,
            exchange=self.exchange or "",
            currency=self.currency,
        )


@dataclass(frozen=True)
class Resolution:
    """resolve() outcome: exactly one hit, or candidates for the caller to disambiguate."""

    instrument: Instrument | None = None
    candidates: tuple[Instrument, ...] = ()


class SymbolResolver:
    """Offline canonical mapping over a THS ticker-list snapshot."""

    def __init__(self, records: Sequence[SymbolRecord]) -> None:
        self._by_thscode: dict[str, SymbolRecord] = {}
        self._by_ticker: dict[str, list[SymbolRecord]] = {}
        self._by_bare: dict[str, list[SymbolRecord]] = {}  # thscode 数字前缀 (000300 → 000300.SH)
        self._by_name: dict[str, list[SymbolRecord]] = {}
        for r in records:
            self._by_thscode.setdefault(r.thscode, r)
            self._by_ticker.setdefault(r.ticker, []).append(r)
            bare = r.thscode.split(".")[0]
            if bare != r.ticker:
                self._by_bare.setdefault(bare, []).append(r)
            if r.name:
                self._by_name.setdefault(r.name, []).append(r)

    @classmethod
    def from_json(cls, path: Path) -> SymbolResolver:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        return cls(
            [
                SymbolRecord(
                    thscode=r["thscode"],
                    ticker=r["ticker"],
                    name=r.get("name", ""),
                    exchange=r.get("exchange"),
                    asset_type=r["asset_type"],
                    currency=r.get("currency", "CNY"),
                )
                for r in data["records"]
            ]
        )

    # ── resolution ──────────────────────────────────────────────────────

    def resolve(self, code: str, *, market: str | None = None) -> Resolution:
        """Canonical resolve of a code/name. Prefers table hits; bare-code stock
        suffix inference only as fallback. `market` filters candidates."""
        q = code.strip()
        if not q:
            return Resolution()

        # 1. exact thscode (with suffix) — always wins, no market filtering needed
        rec = self._by_thscode.get(q)
        if rec is not None:
            return Resolution(instrument=rec.to_instrument())

        # 2. bare ticker or name → table lookup, filter by market hint
        cands = self._candidates(q, market)
        if len(cands) == 1:
            return Resolution(instrument=cands[0])
        if len(cands) > 1:
            return Resolution(candidates=tuple(cands))

        # 3. fallback: bare digits → stock suffix inference (stocks only!)
        if q.isdigit() and len(q) == 6:
            suffix = _STOCK_SUFFIX_BY_FIRST.get(q[0])
            if suffix is not None:
                return Resolution(
                    instrument=Instrument(
                        symbol=f"{q}.{suffix}",
                        name="",
                        asset_type="stock",
                        exchange=suffix,
                        currency="CNY",
                    )
                )
        return Resolution()

    def _candidates(self, q: str, market: str | None) -> list[Instrument]:
        classes = _MARKET_ASSET_CLASSES.get(market or "") if market else None
        seen: set[str] = set()
        out: list[Instrument] = []
        for rec in [*self._by_ticker.get(q, []), *self._by_bare.get(q, [])]:
            if rec.thscode in seen:
                continue
            seen.add(rec.thscode)
            if classes is not None and rec.canonical_asset not in classes:
                continue
            out.append(rec.to_instrument())
        if not out:
            for rec in self._by_name.get(q, []):
                if classes is not None and rec.canonical_asset not in classes:
                    continue
                out.append(rec.to_instrument())
        return out


def default_resolver() -> SymbolResolver:
    """Resolver over the repo snapshot (config/symbols.json)."""
    path = Path(__file__).resolve().parents[2] / "config" / "symbols.json"
    return SymbolResolver.from_json(path)
