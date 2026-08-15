"""Record sanitized THS responses as offline fixtures (LESSONS §4.3).

Dev-only: hits the live API with the real key, saves raw JSON bodies to
tests/fixtures/ths/<name>.json (keys live in headers only — bodies carry no key).
CI replays fixtures via httpx MockTransport; never run in CI with real keys.

Usage:
    THS_API_KEY=<key> uv run python scripts/record-fixtures.py
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from core.adapters.ths import BASE
from core.domain.units import date_to_ms

OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "ths"

# name → (endpoint, params) — mirrors the adapter's calls
CASES: dict[str, tuple[str, dict[str, object]]] = {
    "search_maotai": ("/api/meta/tickers/search", {"q": "贵州茅台", "limit": 5}),
    "quote_batch": (
        "/api/a-share/prices/snapshot",
        {"thscodes": "600519.SH,000001.SZ,300750.SZ"},
    ),
    "kline_600519": (
        "/api/a-share/prices/historical",
        {
            "thscode": "600519.SH",
            "interval": "1d",
            "start": date_to_ms("2026-07-01") - 86_400_000,
            "end": date_to_ms("2026-08-10"),
            "adjust": "none",
        },
    ),
    "income_600519": (
        "/api/a-share/financials/income-statements",
        {"thscode": "600519.SH", "period": "annual", "limit": 2},
    ),
    "balance_600519": (
        "/api/a-share/financials/balance-sheets",
        {"thscode": "600519.SH", "period": "annual", "limit": 2},
    ),
    "calendar": ("/api/a-share/calendar/trading-days", {}),
    "limit_up_pool": (
        "/api/a-share/special-data/limit-up-pool",
        {"size": 5, "sort_field": "limit_up_time", "sort_dir": "asc"},
    ),
    "hot_stock_list": ("/api/a-share/special-data/hot-stock-list", {"period": "day"}),
    "dragon_tiger": ("/api/a-share/special-data/dragon-tiger-list", {"board_type": "all"}),
}


def main() -> int:
    import os

    key = os.environ.get("THS_API_KEY", "")
    if not key:
        print("THS_API_KEY env var is required", file=__import__("sys").stderr)
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    headers = {"X-api-key": key}
    with httpx.Client(timeout=30) as client:
        for name, (endpoint, params) in CASES.items():
            resp = client.get(f"{BASE}{endpoint}", params=params, headers=headers)
            body = resp.json()
            status = "OK" if body.get("code") == 0 else f"code={body.get('code')}"
            (OUT / f"{name}.json").write_text(
                json.dumps(body, ensure_ascii=False, indent=1), encoding="utf-8"
            )
            print(f"{name:18} {status:10} {resp.status_code} {endpoint}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
