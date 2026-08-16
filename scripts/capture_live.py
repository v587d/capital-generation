"""真实 KEY 取数存档 — 优化前后对比的数据源 (docs/DESIGN_CONTEXT_BUDGET.md §8).

流程: stdio 起真实 server → 顺序调用代表性用例 → 把每个结果的 wire 文本
(模型侧真实所见, FastMCP indent=2 序列化) 存档到 dumps/token_compare/。

QPS 纪律 (用户备注 2026-08-15): THS 免费/测试 tier 隐藏限流 ≈ 0.2 QPS
(60s 滑动窗口令牌桶, 突发容量 10-15 个/60s, 打满 → 2003)。本脚本串行 +
每调用间隔 8s (≈0.125 QPS), 总量 11 个调用。遇 2003 → 冷却 60s 重试一次。

用法: uv run python scripts/capture_live.py
产出: dumps/token_compare/<case>.json — {"params", "wire_text", "chars", "tokens_cl100k"}
对比: uv run python scripts/measure_tokens.py compare
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

import tiktoken

REPO = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "dumps" / "token_compare"

CASES: list[tuple[str, str, dict]] = [
    # (name, tool, params)
    (
        "quote_5",
        "fin_data__get_quote",
        {"symbols": "600519.SH,000001.SZ,300750.SZ,601318.SH,000858.SZ"},
    ),
    (
        "klines_5d",
        "fin_data__get_klines",
        {
            "symbol": "600519.SH",
            "period": "1d",
            "start": "2026-08-10",
            "end": "2026-08-14",
            "adjust": "none",
        },
    ),
    (
        "klines_1y",
        "fin_data__get_klines",
        {
            "symbol": "600519.SH",
            "period": "1d",
            "start": "2025-08-15",
            "end": "2026-08-14",
            "adjust": "none",
        },
    ),
    ("calendar", "fin_data__get_calendar", {}),
    (
        "financials_income4",
        "fin_data__get_financials",
        {"symbol": "600519", "statement": "income", "period": "annual", "limit": 4},
    ),
    (
        "announcements_10",
        "fin_data__get_announcements",
        {"symbol": "600519", "start": "2026-07-01", "end": "2026-08-15", "top_k": 10},
    ),
    (
        "special_limitup_50",
        "fin_data__get_special_data",
        {"kind": "limit-up", "date": "2026-08-14", "size": 50},
    ),
    ("edb_100", "fin_data__get_edb", {"indicator": "中国GDP", "observation": 100}),
    ("fund_nav_10", "fin_data__get_fund_data", {"symbol": "510300", "kind": "nav", "limit": 10}),
    (
        "index_kline_5d",
        "fin_data__get_index_data",
        {"symbol": "000300", "kind": "kline", "start": "2026-08-10", "end": "2026-08-14"},
    ),
    (
        "reconcile_klines",
        "fin_data__reconcile",
        {"domain": "klines", "symbols": "600519", "start": "2026-08-10", "end": "2026-08-14"},
    ),
]

INTERVAL_S = 8  # ≈0.125 QPS, 低于 THS 隐藏限流 0.2 QPS
COOL_DOWN_S = 60


async def call_with_retry(session, name: str, tool: str, params: dict) -> str:
    for attempt in range(2):
        try:
            res = await session.call_tool(tool, params)
            text = "".join(b.text for b in res.content if getattr(b, "type", "") == "text")
            if not text:
                raise RuntimeError(f"{name}: 空文本 (content={res.content!r})")
            return text
        except Exception as e:  # noqa: BLE001 — 取数脚本: 任何失败都走冷却重试
            msg = str(e)
            is_ths_rate = "2003" in msg or "Invalid or revoked" in msg
            wait = COOL_DOWN_S if is_ths_rate else 15
            print(
                f"  !! {name} 第{attempt + 1}次失败 ({type(e).__name__}): "
                f"{msg[:120]} → 冷却 {wait}s"
            )
            await asyncio.sleep(wait)
    raise RuntimeError(f"{name}: 两次尝试均失败")


async def main() -> None:
    if not REPO.exists():
        sys.exit("repo 路径异常")
    OUT.mkdir(parents=True, exist_ok=True)
    enc = tiktoken.get_encoding("cl100k_base")

    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    server_params = StdioServerParameters(
        command="uv",
        args=["run", "--directory", str(REPO), "-m", "servers.mcp_data"],
    )
    print("启动 server 并取数 (间隔 8s, THS 0.2 QPS 纪律)…")
    results: list[dict] = []
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            for i, (name, tool, params) in enumerate(CASES):
                t0 = time.monotonic()
                text = await call_with_retry(session, name, tool, params)
                tokens = len(enc.encode(text))
                record = {
                    "tool": tool,
                    "params": params,
                    "wire_text": text,
                    "chars": len(text),
                    "tokens_cl100k": tokens,
                }
                (OUT / f"{name}.json").write_text(
                    json.dumps(record, ensure_ascii=False), encoding="utf-8"
                )
                print(
                    f"  [{i + 1}/{len(CASES)}] {name:<22} {len(text):>8} chars  "
                    f"{tokens:>7} tokens  ({time.monotonic() - t0:.1f}s)"
                )
                results.append(record)
                if i < len(CASES) - 1:
                    await asyncio.sleep(INTERVAL_S)
    total = sum(r["tokens_cl100k"] for r in results)
    print(f"\n存档完成: dumps/token_compare/ ({len(results)} 用例, 合计 {total} tokens)")


if __name__ == "__main__":
    asyncio.run(main())
