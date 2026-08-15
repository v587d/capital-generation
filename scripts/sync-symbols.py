"""Sync the THS ticker-list snapshot into config/symbols.json (M2).

Authoritative source for canonical symbol mapping (docs/DESIGN_REVIEW.md 决策 5).
Pulls /api/meta/tickers/list for A-share + index + fund asset classes (SH,SZ,BJ),
writes config/symbols.json, prints per-class counts. NEVER logs the API key.

v0.3.0 (M6): --if-stale DAYS — 快照新鲜 (generated_at 距今 < DAYS) 时直接跳过,
配合定时/启动调用实现自动同步; 无 key 或失败时退出码 2, 不覆盖本地快照。

Usage:
    THS_API_KEY=<key> uv run python scripts/sync-symbols.py [--asset-types a-share,a-share-index]
    THS_API_KEY=<key> uv run python scripts/sync-symbols.py --if-stale 30
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


from core.domain.symbols import snapshot_age_days  # noqa: E402  (M6: 与启动检测共用)


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


def main_with_args(args: argparse.Namespace) -> int:
    """main 的可测体 (M6: --if-stale 跳过逻辑单测)."""
    if args.if_stale > 0:
        age = snapshot_age_days()
        if age is not None and age < args.if_stale:
            print(f"symbols.json 距今 {age} 天 (< {args.if_stale}), 跳过同步")
            return 0

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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--asset-types", default=DEFAULT_ASSET_TYPES)
    ap.add_argument("--exchanges", default="SH,SZ,BJ")
    ap.add_argument(
        "--if-stale",
        type=int,
        default=0,
        metavar="DAYS",
        help="快照距今 < DAYS 天时跳过 (自动同步用; 0 = 总是同步)",
    )
    return main_with_args(ap.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
