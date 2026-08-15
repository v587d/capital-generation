"""Sync the THS ticker-list snapshot into config/symbols.json (M2).

Authoritative source for canonical symbol mapping (docs/DESIGN_REVIEW.md 决策 5).
Pulls /api/meta/tickers/list for A-share + index + fund asset classes (SH,SZ,BJ),
writes config/symbols.json, prints per-class counts. NEVER logs the API key.

Usage:
    THS_API_KEY=<key> uv run python scripts/sync-symbols.py [--asset-types a-share,a-share-index]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

import httpx

BASE = "https://fuyao.aicubes.cn"
LIST_URL = f"{BASE}/api/meta/tickers/list"
DEFAULT_ASSET_TYPES = "a-share,a-share-index,fund-etf,fund-lof,fund-otc,fund-reits"
PAGE = 10000
OUT = Path(__file__).resolve().parents[1] / "config" / "symbols.json"


def fetch_all(key: str, asset_types: str, exchanges: str) -> list[dict]:
    headers = {"X-api-key": key}
    items: list[dict] = []
    seen: set[str] = set()
    for asset_type in asset_types.split(","):
        offset = 0
        while True:
            resp = httpx.get(
                LIST_URL,
                headers=headers,
                params={
                    "exchange": exchanges,
                    "asset_type": asset_type,
                    "limit": PAGE,
                    "offset": offset,
                },
                timeout=30,
            )
            resp.raise_for_status()
            body = resp.json()
            if body.get("code") != 0:
                raise RuntimeError(f"THS error code={body.get('code')} msg={body.get('message')}")
            page = body["data"]["item"]
            for it in page:
                if it.get("thscode") not in seen:
                    seen.add(it["thscode"])
                    items.append(it)
            if len(page) < PAGE:
                break
            offset += PAGE
    return items


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--asset-types", default=DEFAULT_ASSET_TYPES)
    ap.add_argument("--exchanges", default="SH,SZ,BJ")
    args = ap.parse_args()

    key = os.environ.get("THS_API_KEY", "")
    if not key:
        print("THS_API_KEY env var is required (see KEYS(only for test).txt)", file=sys.stderr)
        return 2

    items = fetch_all(key, args.asset_types, args.exchanges)
    doc = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": "同花顺 /api/meta/tickers/list",
        "asset_types": args.asset_types.split(","),
        "count": len(items),
        "records": items,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")

    by_class: dict[str, int] = {}
    for it in items:
        by_class[it["asset_type"]] = by_class.get(it["asset_type"], 0) + 1
    print(f"wrote {OUT} ({len(items)} records)")
    for k, v in sorted(by_class.items()):
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
