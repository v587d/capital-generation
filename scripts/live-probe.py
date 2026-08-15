"""Live probe — spawn the MCP server over stdio and call all tools (M7 + v0.2.0 M5).

Requires THS_API_KEY (see KEYS(only for test).txt); WIND_API_KEY 可选 (缺省跳过
Wind 用例); AKShare needs no key.
Usage:
    THS_API_KEY=<key> WIND_API_KEY=<key> uv run python scripts/live-probe.py

This is a REAL network smoke test — not for CI. CI uses fixtures/goldens.
"""

from __future__ import annotations

import asyncio
import os
import sys


async def main() -> int:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    ths_key = os.environ.get("THS_API_KEY", "")
    if not ths_key:
        print("THS_API_KEY env var required", file=sys.stderr)
        return 2

    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "servers.mcp_data"],
        # MCP SDK 默认只转发白名单环境变量 (安全设计); 必须显式传 env 否则子进程
        # 拿不到 THS_API_KEY / WIND_API_KEY → 对应适配器不构建 → 全链降级。
        # DSH 集成 (cordis.patch.yml) 同样必须显式声明 env。
        env={**os.environ},
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print(f"server: {init.serverInfo.name} {init.serverInfo.version}")
            tools = await session.list_tools()
            print(f"tools: {len(tools.tools)}")
            for t in tools.tools:
                print(f"  - {t.name}")

            cases = [
                ("fin_data__search_symbols", {"query": "贵州茅台", "limit": 3}),
                ("fin_data__get_quote", {"symbols": "600519,000001"}),
                (
                    "fin_data__get_klines",
                    {"symbol": "600519", "start": "2026-07-01", "end": "2026-07-10"},
                ),
                (
                    "fin_data__get_financials",
                    {"symbol": "600519", "statement": "income", "limit": 1},
                ),
                ("fin_data__get_calendar", {}),
                ("fin_data__get_special_data", {"kind": "hot"}),
                ("fin_data__get_quote", {"symbols": "000001"}),  # 歧义 → 引导
                ("fin_data__reconcile", {"domain": "quote", "symbols": "600519,000001"}),
                (
                    "fin_data__reconcile",
                    {"domain": "klines", "symbols": "600519",
                     "start": "2026-07-01", "end": "2026-07-10"},
                ),
            ]
            if os.environ.get("WIND_API_KEY"):
                cases += [
                    (
                        "fin_data__get_financials",
                        {"symbol": "600519", "statement": "indicators", "limit": 1},
                    ),
                    (
                        "fin_data__get_klines",
                        {"symbol": "600519", "period": "5m",
                         "start": "2026-07-08", "end": "2026-07-08"},
                    ),
                    (
                        "fin_data__get_announcements",
                        {"symbol": "600519", "start": "2025-01-01", "end": "2025-12-31",
                         "top_k": 2},
                    ),
                    ("fin_data__get_edb", {"indicator": "中国GDP", "observation": 3}),
                ]
            else:
                print("\n(WIND_API_KEY 未设置, 跳过 Wind 用例)")
            for name, args in cases:
                try:
                    res = await session.call_tool(name, args)
                    text = res.content[0].text if res.content else ""
                    head = text[:220].replace("\n", " ")
                    print(f"\n== {name}({args}) -> {res.isError and 'ERROR' or 'OK'}\n   {head}")
                except Exception as e:  # noqa: BLE001
                    print(f"\n== {name}({args}) -> EXC {type(e).__name__}: {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
