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


def _not_stock_response(hit: Instrument) -> dict[str, Any]:
    return {
        "data": None,
        "source": "",
        "tier": "",
        "ts": utc_iso(now_ms()),
        "warnings": [
            f"{hit.symbol} ({hit.name}) 是 {hit.asset_type}, 行情/财务/公告工具仅支持"
            " A股股票; 指数行情等能力在后续版本",
        ],
    }


_MINUTE_PERIODS = ("1m", "5m", "15m", "30m", "60m")


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
        if hit.asset_type != "stock":
            return _not_stock_response(hit)
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
    """日线 (1d, THS 主干) 或分钟线 (1m/5m/15m/30m/60m, Wind 独家仅当日)."""
    if period == "1d":
        domain = "klines"
    elif period in _MINUTE_PERIODS:
        domain = "intraday"
        if start != end:
            raise ParamError(
                f"分钟线仅支持单交易日窗口 (start == end), 收到 {start} ~ {end}"
            )
    else:
        raise ParamError(
            f"period 仅支持 1d 与分钟线 {'/'.join(_MINUTE_PERIODS)} (周/月/季不支持)"
        )
    if not start or not end:
        raise ParamError("start/end 必填 (YYYY-MM-DD)")
    hit = resolve_or_guide(resolver, symbol, "A股")
    if isinstance(hit, dict):
        return hit
    if hit.asset_type != "stock":
        return _not_stock_response(hit)
    start_ms, end_ms = date_to_ms(start), date_to_ms(end)
    if domain == "klines":
        env = await router.call(
            "klines",
            symbol=hit.symbol,
            start_ms=start_ms,
            end_ms=end_ms,
            adjust=adjust,
        )
    else:
        env = await router.call(
            "intraday", symbol=hit.symbol, period=period,
            start_ms=start_ms, end_ms=end_ms,
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
    if hit.asset_type != "stock":
        return _not_stock_response(hit)
    env = await router.call(
        "financials", symbol=hit.symbol, statement=statement, period=period,
        limit=limit, name=hit.name,
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


# ── v0.2.0 新工具 (PLAN-0.2.0.md §2.3, schema 评审记录: DESIGN_REVIEW 决策 12) ──


async def tool_get_announcements(
    router: Router,
    resolver: SymbolResolver,
    symbol: str,
    start: str = "",
    end: str = "",
    top_k: int = 10,
) -> dict[str, Any]:
    """公告检索 (Wind 独家 RAG, 无降级源 — 明确告知)."""
    if not start or not end:
        raise ParamError("start/end 必填 (YYYY-MM-DD)")
    if not 1 <= top_k <= 20:
        raise ParamError(f"top_k 1-20, 收到 {top_k}")
    hit = resolve_or_guide(resolver, symbol, "A股")
    if isinstance(hit, dict):
        return hit
    if hit.asset_type != "stock":
        return _not_stock_response(hit)
    env = await router.call(
        "announcements", symbol=hit.symbol,
        start_ms=date_to_ms(start), end_ms=date_to_ms(end),
        top_k=top_k, name=hit.name,
    )
    return render_envelope(env)


async def tool_get_edb(
    router: Router,
    resolver: SymbolResolver,
    indicator: str,
    start: str = "",
    end: str = "",
    observation: int = 10,
) -> dict[str, Any]:
    """EDB 宏观/行业指标 (Wind 搜索并提数; AKShare 仅白名单兜底)."""
    indicator = indicator.strip()
    if not indicator:
        raise ParamError("indicator 必填 (指标简称, 如 中国GDP)")
    if not 1 <= observation <= 100:
        raise ParamError(f"observation 1-100, 收到 {observation}")
    kwargs: dict[str, Any] = {"indicator": indicator, "observation": observation}
    if start or end:
        if not (start and end):
            raise ParamError("start/end 需成对提供 (YYYY-MM-DD)")
        kwargs["start_ms"] = date_to_ms(start)
        kwargs["end_ms"] = date_to_ms(end)
    env = await router.call("edb", **kwargs)
    return render_envelope(env)


def render_reconcile(rep: Any) -> dict[str, Any]:
    """对账报告渲染: 信封 source="" + engine 字段; 行自带各源值 (规范名) 与数据时点."""
    rows = []
    for r in rep.rows:
        rows.append({
            "key": r.key,
            "field": r.field,
            "同花顺": r.left,
            "AKShare": r.right,
            "ths_as_of_ms": r.left_as_of_ms,
            "akshare_as_of_ms": r.right_as_of_ms,
            "diff_pct": r.diff_pct,
            "matched": r.matched,
            "note": r.note,
        })
    return {
        "data": rows,
        "source": "",
        "tier": "",
        "ts": utc_iso(rep.ts_ms),
        "engine": "reconcile",
        "summary": rep.summary(),
        "warnings": list(rep.warnings),
    }


async def tool_reconcile(
    router: Router,
    resolver: SymbolResolver,
    domain: str,
    symbols: str,
    start: str = "",
    end: str = "",
    tolerance_pct: float | None = None,
) -> dict[str, Any]:
    """双源对账 (THS×AKShare, 未复权; 分歧不自动修复, 交 LLM 裁决)."""
    from core.domain.reconcile import reconcile_klines, reconcile_quotes

    if domain not in ("quote", "klines"):
        raise ParamError(f"domain 仅支持 quote/klines, 收到 {domain!r}")
    if tolerance_pct is not None and not 0 < tolerance_pct <= 100:
        raise ParamError(f"tolerance_pct 需在 (0, 100], 收到 {tolerance_pct}")
    ths = router.adapters.get("ths")
    akshare = router.adapters.get("akshare")
    missing = [v for v, a in (("ths", ths), ("akshare", akshare)) if a is None]
    if missing:
        return {
            "data": None, "source": "", "tier": "",
            "ts": utc_iso(now_ms()),
            "engine": "reconcile",
            "summary": {"domain": domain, "compared": 0, "matched": 0,
                        "mismatched": 0, "skipped": 0},
            "warnings": [f"对账需要 THS×AKShare 双源, 当前缺少: {missing}"],
        }
    if domain == "quote":
        canonical: list[str] = []
        for s in _split_symbols(symbols):
            hit = resolve_or_guide(resolver, s, "A股")
            if isinstance(hit, dict):
                return hit
            if hit.asset_type != "stock":
                return _not_stock_response(hit)
            canonical.append(hit.symbol)
        rep = await reconcile_quotes(ths, akshare, canonical,
                                     tolerance_pct=tolerance_pct)
    else:
        if not start or not end:
            raise ParamError("klines 对账需要 start/end (YYYY-MM-DD)")
        hit = resolve_or_guide(resolver, symbols, "A股")
        if isinstance(hit, dict):
            return hit
        if hit.asset_type != "stock":
            return _not_stock_response(hit)
        rep = await reconcile_klines(
            ths, akshare, hit.symbol, date_to_ms(start), date_to_ms(end),
            tolerance_pct=tolerance_pct,
        )
    return render_reconcile(rep)


# ──────────────────────────────────────────────────────────────────────
# FastMCP 装配
# ──────────────────────────────────────────────────────────────────────


def _load_key(env_var: str, creds_key: str) -> str | None:
    """BYOK: env → DSH credentials 文件 (AGENTS.md; THS/Wind 同款)."""
    key = os.environ.get(env_var, "").strip()
    if key:
        return key
    home = Path(os.environ.get("DSH_HOME", str(Path.home() / ".dsh")))
    creds = home / ".credentials.yaml"
    if creds.exists():
        try:
            import yaml

            data = yaml.safe_load(creds.read_text(encoding="utf-8")) or {}
            key = data.get(creds_key) or data.get(env_var) or ""
            return key.strip() or None
        except Exception:  # noqa: BLE001 — credentials 损坏不应阻断启动
            return None
    return None


def load_ths_key() -> str | None:
    return _load_key("THS_API_KEY", "ths_api_key")


def load_wind_key() -> str | None:
    return _load_key("WIND_API_KEY", "wind_api_key")


def build_server_components() -> tuple[Router, SymbolResolver, list[str]]:
    warnings: list[str] = []
    adapters: dict[str, Any] = {}

    ths_key = load_ths_key()
    if ths_key:
        adapters["ths"] = THSAdapter(api_key=ths_key)
    else:
        warnings.append("未配置 THS_API_KEY: 同花顺不可用, 仅 AKShare 兜底")

    from core.adapters.wind import WindAdapter

    wind_key = load_wind_key()
    if wind_key:
        adapters["wind"] = WindAdapter(api_key=wind_key)
    else:
        warnings.append(
            "未配置 WIND_API_KEY: Wind 不可用 (financials 降级 THS; 分钟线/公告/EDB 不可用)"
        )

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
            "统一金融数据入口。v0.2.0 覆盖: A股行情快照/日K/分钟线(当日,W独家)/财务三表与指标/"
            "交易日历/特色数据/标的检索/公告(W独家)/EDB宏观(W主干)/双源对账。不支持: 周月季K、"
            "港股美股、宏观白名单外指标经AKShare兜底、全市场快照。每个结果携带 "
            "source(同花顺/Wind/AKShare)/tier/ts 溯源; 分钟线/公告无降级源, 明确告知。"
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
        """K线: period=1d 日线 (≤10年, THS 主干); 分钟线 1m/5m/15m/30m/60m
        仅单交易日 (start==end, Wind 独家无降级源)。adjust: none/forward/backward (仅日线)。"""
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

    @mcp.tool()
    async def fin_data__get_announcements(
        symbol: str,
        start: str = "",
        end: str = "",
        top_k: int = 10,
    ) -> dict:
        """上市公司公告检索 (Wind 独家 RAG, 无降级源)。start/end 必填 (YYYY-MM-DD)。"""
        return await tool_get_announcements(router, resolver, symbol, start, end, top_k)

    @mcp.tool()
    async def fin_data__get_edb(
        indicator: str,
        start: str = "",
        end: str = "",
        observation: int = 10,
    ) -> dict:
        """EDB 宏观/行业指标 (Wind 搜索并提数, 指标简称如 中国GDP; AKShare 仅白名单兜底)。"""
        return await tool_get_edb(router, resolver, indicator, start, end, observation)

    @mcp.tool()
    async def fin_data__reconcile(
        domain: str,
        symbols: str,
        start: str = "",
        end: str = "",
        tolerance_pct: float | None = None,
    ) -> dict:
        """双源对账 (THS×AKShare, 未复权, 只比数据时点): domain=quote/klines;
        分歧不自动修复 — 交 LLM 裁决 (报告含双源值 + 数据时点 + diff)。"""
        return await tool_reconcile(router, resolver, domain, symbols, start, end, tolerance_pct)

    return mcp


def main() -> None:
    app = create_app()
    app.run(transport="stdio")


if __name__ == "__main__":
    main()
