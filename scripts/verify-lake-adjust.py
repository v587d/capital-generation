"""复权对账 (v0.3.0 M2 验收, PLAN-0.3.0.md §8.2) — 本地 marketdb 前复权价 vs
THS 接口 adjust=forward 抽样对比。

- 湖侧: 本地 marketdb `v_daily_qfq` (官方 marketdb 前复权视图, forward=最新对齐真实)
- THS 侧: THS 官方接口 adjust=forward 复权K线 (THS 为基准, 免费源不参与对账)
- 对齐: (symbol, date); 容差外置 config/reconcile.yaml tolerance_pct (0.5%)
- 退出码: 0 = 全部一致; 1 = 存在 mismatch

用法:
    HITHINK_FINANCE_API_KEY=<ths_key> uv run python scripts/verify-lake-adjust.py
    [--db PATH] [--symbols 600519.SH,000001.SZ] [--start 2026-06-01] [--end 2026-07-10]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import socket
import sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(REPO))

import lake  # noqa: E402

from core.adapters.ths import THSAdapter  # noqa: E402
from core.config import load_yaml  # noqa: E402
from core.domain.units import TZ_CN, date_to_ms  # noqa: E402


def _patch_ipv4_only() -> None:
    """沙箱 IPv6 出口不可达 → 强制 IPv4 (LESSONS §6.5: patch 事件循环 getaddrinfo)."""
    loop = asyncio.get_running_loop()
    orig = loop.getaddrinfo

    async def gai_v4(host, port, *a, **k):
        k.pop("family", None)
        k["family"] = socket.AF_INET
        return await orig(host, port, *a, **k)

    loop.getaddrinfo = gai_v4


def main() -> int:
    ap = argparse.ArgumentParser(description="复权对账: 湖 v_daily_qfq vs THS adjust=forward")
    ap.add_argument("--db", default=None, help="湖 DuckDB 路径 (默认 dumps/market.duckdb)")
    ap.add_argument("--symbols", default="600519.SH,000001.SZ")
    ap.add_argument("--start", default="2026-06-01")
    ap.add_argument("--end", default="2026-07-10")
    ap.add_argument(
        "--tolerance",
        type=float,
        default=None,
        help="容差 % (默认取 config/reconcile.yaml tolerance_pct)",
    )
    args = ap.parse_args()

    tol = (
        args.tolerance
        if args.tolerance is not None
        else float(load_yaml("reconcile.yaml").get("tolerance_pct", 0.5))
    )
    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]
    db = lake._db_path(args.db)

    # 1) 湖侧: v_daily_qfq
    q = (
        "SELECT thscode, date, close FROM v_daily_qfq "
        f"WHERE thscode IN ({','.join(repr(s) for s in symbols)}) ORDER BY thscode, date"
    )
    proc = lake.run(["query", "--json", "--sql", q], db=db)
    if proc.returncode != 0:
        print(f"❌ 湖查询失败: {proc.stderr.strip()[-300:]}", file=sys.stderr)
        return 2
    lake_rows = json.loads(proc.stdout)["rows"]
    by_key = {(r["thscode"], r["date"][:10]): float(r["close"]) for r in lake_rows}
    print(f"湖侧 v_daily_qfq: {len(by_key)} 行 ({symbols})")

    # 2) THS 侧: adjust=forward
    key = lake._api_key()
    if not key:
        print("需要 THS key: HITHINK_FINANCE_API_KEY 或 THS_API_KEY", file=sys.stderr)
        return 2

    async def fetch() -> list:
        _patch_ipv4_only()
        ths = THSAdapter(api_key=key)
        try:
            out = []
            for symbol in symbols:
                bars = await ths.get_klines(
                    symbol, date_to_ms(args.start), date_to_ms(args.end), adjust="forward"
                )
                out.extend(bars)
            return out
        finally:
            await ths.aclose()

    bars = asyncio.run(fetch())
    print(f"THS adjust=forward: {len(bars)} 行")

    # 3) 对齐对比
    total, mismatched = 0, 0
    for b in bars:
        d = datetime.fromtimestamp(b.date_ms / 1000, tz=TZ_CN).strftime("%Y-%m-%d")
        local = by_key.get((b.symbol, d))
        if local is None:
            continue
        total += 1
        diff = abs(local - b.close) / b.close * 100 if b.close else 0.0
        if diff > tol:
            mismatched += 1
            print(
                f"[MISMATCH] {b.symbol} {d}: lake={local:.4f} ths={b.close:.4f} "
                f"diff={diff:.3f}% (> {tol}%)"
            )
    print(f"复权对账: 对齐 {total} 行, mismatch {mismatched}, 容差 {tol}%")
    return 1 if mismatched else 0


if __name__ == "__main__":
    raise SystemExit(main())
