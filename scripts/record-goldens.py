"""Record AKShare golden outputs (tests/golden/akshare/*.json) — M4.

Purpose (PLAN M4 / DEGRADATION AKShare 纪律): lock the akshare version + freeze raw
responses so interface drift shows in CI (golden diff) instead of production.
Dev-only: hits live free endpoints (频率闸 2s 内置); no key needed.

Usage:
    uv run python scripts/record-goldens.py
"""

from __future__ import annotations

import json
from pathlib import Path

import akshare as ak

OUT = Path(__file__).resolve().parents[1] / "tests" / "golden" / "akshare"

# name → (fn, kwargs) — 白名单, 与 core/adapters/akshare_adapter.py 对应
CASES: dict[str, tuple[object, dict]] = {
    "kline_600519_1m": (
        ak.stock_zh_a_hist,
        {
            "symbol": "600519",
            "period": "daily",
            "start_date": "20260601",
            "end_date": "20260701",
            "adjust": "",
        },
    ),
    "income_600519": (
        ak.stock_financial_report_sina, {"stock": "sh600519", "symbol": "利润表"}
    ),
    "indicators_600519": (ak.stock_financial_analysis_indicator, {"symbol": "600519"}),
    "calendar_sample": (ak.tool_trade_date_hist_sina, {}),
    "zt_pool_20260814": (ak.stock_zt_pool_em, {"date": "20260814"}),
}

# push2 实时报价接口偶发被东财 IP 封锁 (stock_bid_ask_em); 封锁解除后补录:
#   "quote_600519": (ak.stock_bid_ask_em, {"symbol": "600519"}),


def to_jsonable(df) -> list[dict]:
    import pandas as pd

    out = []
    for row in df.to_dict("records"):
        item = {}
        for k, v in row.items():
            if pd.isna(v):
                item[k] = None
            elif hasattr(v, "isoformat"):
                item[k] = str(v)
            else:
                item[k] = v
        out.append(item)
    return out


def main() -> int:
    import sys
    import time

    OUT.mkdir(parents=True, exist_ok=True)
    for name, (fn, kw) in CASES.items():
        last_err: Exception | None = None
        for attempt in range(3):  # 爬虫源限频常见, 重试 3 次 (间隔递增)
            try:
                df = fn(**kw)
                break
            except Exception as e:  # noqa: BLE001
                last_err = e
                time.sleep(8 * (attempt + 1))
        else:
            err = f"{type(last_err).__name__} {str(last_err)[:100]}"
            print(f"{name}: FAILED {err}", file=sys.stderr)
            continue
        rows = to_jsonable(df)
        (OUT / f"{name}.json").write_text(
            json.dumps({"fn": fn.__name__, "rows": rows}, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
        print(f"{name:22} rows={len(rows):5}  {fn.__name__}({kw})")
        time.sleep(6)  # 频率闸: 探测同样守纪律
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
