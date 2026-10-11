"""China News MCP Server — Chinese financial news via MCP protocol.

Aggregates financial news from publicly available Chinese sources:
individual stock news, market headlines, and industry news.

Usage:
    python server.py                    # stdio (local Claude Desktop)
    python server.py --transport sse    # HTTP/SSE (deployment)
"""

import argparse
import json
import sys
from datetime import datetime, timedelta
from typing import Optional

import akshare as ak
import pandas as pd

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    from mcp import FastMCP

server = FastMCP("china-news-mcp", instructions="Chinese financial news — stock news, market headlines, industry news")


def _df_to_json(df: pd.DataFrame) -> str:
    if df is None or df.empty:
        return json.dumps([], ensure_ascii=False)
    df = df.where(pd.notna(df), None)
    result = []
    for _, row in df.head(30).iterrows():
        item = {}
        for col in df.columns:
            val = row[col]
            if isinstance(val, (datetime, pd.Timestamp)):
                val = val.isoformat()
            elif val is not None:
                val = str(val)
            item[str(col)] = val
        result.append(item)
    return json.dumps(result, ensure_ascii=False)


@server.tool()
def get_stock_news(ticker: str) -> str:
    """Get latest news for a specific A-share stock.

    Args:
        ticker: Stock code (e.g., "600519" for Maotai).
    """
    try:
        df = ak.stock_news_em(symbol=ticker)
        return _df_to_json(df)
    except Exception as e:
        return json.dumps({"error": f"get_stock_news failed: {e}"}, ensure_ascii=False)


@server.tool()
def get_market_headlines(top_n: int = 20) -> str:
    """Get latest A-share market headlines / hot news from East Money.

    Args:
        top_n: Number of headlines to return (default 20, max 50).
    """
    try:
        df = ak.stock_info_global_em()
        return _df_to_json(df.head(min(top_n, 50)))
    except Exception as e:
        return json.dumps({"error": f"get_market_headlines failed: {e}"}, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser(description="China News MCP Server")
    parser.add_argument("--transport", choices=["stdio", "sse"], default="stdio")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--host", type=str, default="0.0.0.0")
    args = parser.parse_args()

    if args.transport == "sse":
        print(f"Starting SSE server on http://{args.host}:{args.port}/mcp", file=sys.stderr)
        server.run(transport="sse", host=args.host, port=args.port)
    else:
        print("Starting stdio MCP server...", file=sys.stderr)
        server.run(transport="stdio")


if __name__ == "__main__":
    main()
