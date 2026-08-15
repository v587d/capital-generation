"""MCP thin shell — the only protocol layer (docs/DESIGN_REVIEW.md 决策 11).

Registers the frozen v0.1.0 tool surface (PLAN.md §2.3): fin_data__search_symbols /
get_quote / get_klines / get_financials / get_calendar / get_special_data.

Tool logic lives in plain functions (testable without a transport); FastMCP
decorators are thin wrappers. Names & schemas are FROZEN once published.

BYOK (AGENTS.md): THS_API_KEY from env first, then DSH credentials file
($DSH_HOME/.credentials.yaml). Missing key → THS skipped with a warning, AKShare
still serves (degradation is observable, not an error).

Run: uv run python -m servers.mcp_data
"""

from __future__ import annotations

import os
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from core.adapters.akshare_adapter import AKShareAdapter
from core.adapters.ths import THSAdapter
from core.domain.errors import ParamError
from core.domain.models import Envelope, Instrument
from core.domain.routing import Router
from core.domain.symbols import Resolution, SymbolResolver, default_resolver
from core.domain.units import date_to_ms, now_ms, utc_iso

# ──────────────────────────────────────────────────────────────────────
# 渲染 (协议层; 信封 → JSON 可序列化 dict, provenance 永不剥离)
# ──────────────────────────────────────────────────────────────────────


def _row_to_dict(row: Any) -> dict[str, Any]:
    if is_dataclass(row):
        return asdict(row)
    return row  # SpecialData.items / FinancialStatement.rows 透传 (L3)


def render_envelope(env: Envelope) -> dict[str, Any]:
    data = env.data
    if isinstance(data, list) and data and is_dataclass(data[0]):
        rows = [_row_to_dict(r) for r in data]
        meta = _row_to_dict(data[0])
    elif is_dataclass(data):
        rows = _row_to_dict(data)
        meta = rows
    else:
        rows = data
        meta = {}
    return {
        "data": rows,
        "source": meta.get("source", ""),  # 规范名: 同花顺/Wind/AKShare
        "tier": meta.get("tier", ""),
        "ts": utc_iso(env.ts_ms),  # 查询时点 (数据时点见 data.as_of_ms/date_ms)
        "warnings": list(env.warnings),
    }


def render_ambiguity(query: str, candidates: tuple[Instrument, ...]) -> dict[str, Any]:
    return {
        "data": None,
        "source": "",
        "tier": "",
        "ts": utc_iso(now_ms()),
        "warnings": [
            f"{query!r} 有歧义: 请先调用 fin_data__search_symbols 消歧, 或用 market 参数限定",
        ],
        "ambiguous": [
            {"symbol": c.symbol, "name": c.name, "asset_type": c.asset_type}
            for c in candidates
        ],
    }


def render_not_found(query: str) -> dict[str, Any]:
    return {
        "data": None,
        "source": "",
        "tier": "",
        "ts": utc_iso(now_ms()),
        "warnings": [
            f"本地代码表未找到 {query!r}: 请先调用 fin_data__search_symbols 查询确认",
        ],
    }


# ──────────────────────────────────────────────────────────────────────
# 工具逻辑 (纯函数, 可离线单测)
# ──────────────────────────────────────────────────────────────────────


def resolve_or_guide(
    resolver: SymbolResolver, query: str, market: str | None
) -> Instrument | dict[str, Any]:
    """消歧: 唯一 → Instrument; 歧义/未找到 → 引导 dict (带 candidates)."""
    res: Resolution = resolver.resolve(query, market=market)
    if res.instrument is not None:
        return res.instrument
    if res.candidates:
        return render_ambiguity(query, res.candidates)
    return render_not_found(query)


def _split_symbols(symbols: str) -> list[str]:
    parts = [s.strip() for s in symbols.replace("，", ",").split(",") if s.strip()]
    if not parts:
        raise ParamError("symbols 不能为空")
    if len(parts) > 50:
        raise ParamError(f"批量最多 50 只, 收到 {len(parts)}")
    return parts


async def tool_get_quote(
    router: Router,
    resolver: SymbolResolver,
    symbols: str,
    market: str | None = None,
) -> dict[str, Any]:
    canonical: list[str] = []
    for s in _split_symbols(symbols):
        hit = resolve_or_guide(resolver, s, market)
        if isinstance(hit, dict):
            return hit
        canonical.append(hit.symbol)
    env = await router.call("quote", symbols=canonical)
    return render_envelope(env)


async def tool_get_klines(
    router: Router,
    resolver: SymbolResolver,
    symbol: str,
    period: str = "1d",
    start: str = "",
    end: str = "",
    adjust: str = "none",
) -> dict[str, Any]:
    if period != "1d":
        raise ParamError("v0.1.0 仅支持日线 period=1d (分钟/周/月线在后续版本)")
    if not start or not end:
        raise ParamError("start/end 必填 (YYYY-MM-DD)")
    hit = resolve_or_guide(resolver, symbol, "A股")
    if isinstance(hit, dict):
        return hit
    env = await router.call(
        "klines",
        symbol=hit.symbol,
        start_ms=date_to_ms(start),
        end_ms=date_to_ms(end),
        adjust=adjust,
    )
    return render_envelope(env)


async def tool_get_financials(
    router: Router,
    resolver: SymbolResolver,
    symbol: str,
    statement: str,
    period: str = "annual",
    limit: int = 4,
) -> dict[str, Any]:
    if statement not in ("income", "balance", "cashflow", "indicators"):
        raise ParamError(
            f"statement 必须是 income/balance/cashflow/indicators, 收到 {statement!r}"
        )
    hit = resolve_or_guide(resolver, symbol, "A股")
    if isinstance(hit, dict):
        return hit
    env = await router.call(
        "financials", symbol=hit.symbol, statement=statement, period=period, limit=limit
    )
    return render_envelope(env)


async def tool_get_calendar(router: Router, resolver: SymbolResolver) -> dict[str, Any]:
    env = await router.call("calendar")
    return render_envelope(env)


async def tool_get_special_data(
    router: Router,
    resolver: SymbolResolver,
    kind: str,
    date: str | None = None,
    page: int = 1,
    size: int = 50,
) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if date:
        params["date"] = date
    if kind == "limit-up":  # 仅涨停池支持分页; hot 榜用 period=day 默认值
        params["page"] = page
        params["size"] = size
    env = await router.call("special", kind=kind, **params)
    return render_envelope(env)


# ──────────────────────────────────────────────────────────────────────
# FastMCP 装配
# ──────────────────────────────────────────────────────────────────────


def load_ths_key() -> str | None:
    key = os.environ.get("THS_API_KEY", "").strip()
    if key:
        return key
    # DSH credentials 文件兜底 (BYOK, AGENTS.md)
    home = Path(os.environ.get("DSH_HOME", str(Path.home() / ".dsh")))
    creds = home / ".credentials.yaml"
    if creds.exists():
        try:
            import yaml

            data = yaml.safe_load(creds.read_text(encoding="utf-8")) or {}
            key = data.get("ths_api_key") or data.get("THS_API_KEY") or ""
            return key.strip() or None
        except Exception:  # noqa: BLE001 — credentials 损坏不应阻断启动
            return None
    return None


def build_server_components() -> tuple[Router, SymbolResolver, list[str]]:
    warnings: list[str] = []
    adapters: dict[str, Any] = {}

    ths_key = load_ths_key()
    if ths_key:
        adapters["ths"] = THSAdapter(api_key=ths_key)
    else:
        warnings.append("未配置 THS_API_KEY: 同花顺不可用, 仅 AKShare 兜底")

    adapters["akshare"] = AKShareAdapter()
    resolver = default_resolver()
    router = Router(adapters)
    return router, resolver, warnings


def create_app() -> Any:
    from mcp.server.fastmcp import FastMCP

    router, resolver, warnings = build_server_components()
    mcp = FastMCP(
        "finance-unified",
        instructions=(
            "统一金融数据入口。v0.1.0 覆盖: A股行情快照/日K/财务三表与指标/交易日历/"
            "特色数据(涨停/连板/热榜/龙虎榜)/标的检索。不支持: 分钟线、港股/美股、"
            "宏观、基金域、全市场快照。每个结果携带 source(同花顺/Wind/AKShare)/tier/ts 溯源。"
            + (" 注意: " + "; ".join(warnings) if warnings else "")
        ),
    )

    @mcp.tool()
    async def fin_data__search_symbols(
        query: str, market: str | None = None, limit: int = 10
    ) -> dict:
        """标的消歧检索 (同花顺 meta → AKShare 兜底)。名称/代码 → 唯一 thscode。"""
        env = await router.call("search", query=query, market=market, limit=limit)
        return render_envelope(env)

    @mcp.tool()
    async def fin_data__get_quote(symbols: str, market: str | None = None) -> dict:
        """A股最新行情快照 (≤50 只, 逗号分隔)。不含中文名 — 名称请先 search。"""
        return await tool_get_quote(router, resolver, symbols, market)

    @mcp.tool()
    async def fin_data__get_klines(
        symbol: str,
        period: str = "1d",
        start: str = "",
        end: str = "",
        adjust: str = "none",
    ) -> dict:
        """A股历史日K (≤10 年, 含起止日)。adjust: none/forward(前复权)/backward(后复权)。"""
        return await tool_get_klines(router, resolver, symbol, period, start, end, adjust)

    @mcp.tool()
    async def fin_data__get_financials(
        symbol: str,
        statement: str,
        period: str = "annual",
        limit: int = 4,
    ) -> dict:
        """A股财务: statement=income/balance/cashflow/indicators;
        period=annual/quarterly; limit 1-20。"""
        return await tool_get_financials(router, resolver, symbol, statement, period, limit)

    @mcp.tool()
    async def fin_data__get_calendar() -> dict:
        """A股近一年交易日历。"""
        return await tool_get_calendar(router, resolver)

    @mcp.tool()
    async def fin_data__get_special_data(
        kind: str,
        date: str | None = None,
        page: int = 1,
        size: int = 50,
    ) -> dict:
        """特色数据: kind=limit-up(涨停池)/limit-up-ladder(连板天梯)/hot(热股榜)/
        hot-history(历史热榜,date)/dragon-tiger(龙虎榜,date)/anomaly-stock(异动)。"""
        return await tool_get_special_data(router, resolver, kind, date, page, size)

    return mcp


def main() -> None:
    app = create_app()
    app.run(transport="stdio")


if __name__ == "__main__":
    main()
