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
from core.config import load_yaml
from core.domain.errors import ParamError
from core.domain.models import Announcement, Envelope, Instrument
from core.domain.routing import Router
from core.domain.symbols import Resolution, SymbolResolver, default_resolver
from core.domain.units import date_to_ms, now_ms, utc_iso

# ──────────────────────────────────────────────────────────────────────
# 渲染 (协议层; 信封 → JSON 可序列化 dict, provenance 永不剥离)
# docs/DESIGN_CONTEXT_BUDGET.md A1/A3: 表头外提 (meta+rows) + 公告截断 (配置化)
# ──────────────────────────────────────────────────────────────────────

_RENDER_CFG: dict[str, Any] | None = None


def _render_config() -> dict[str, Any]:
    """config/render.yaml (外置可配, 缺失/损坏时回退默认, 不阻断启动)."""
    global _RENDER_CFG
    if _RENDER_CFG is None:
        try:
            _RENDER_CFG = load_yaml("render.yaml")
        except FileNotFoundError:
            _RENDER_CFG = {}
    return _RENDER_CFG


def announcement_cap_chars() -> int:
    """公告 content 截断阈值 (字符); 0/缺失 = 不截断."""
    v = _render_config().get("announcements", {}).get("content_cap_chars", 800)
    return v if isinstance(v, int) and v > 0 else 0


def _row_to_dict(row: Any) -> dict[str, Any]:
    if is_dataclass(row):
        return asdict(row)
    return row  # SpecialData.items / FinancialStatement.rows 透传 (L3)


def _truncate_announcement_row(d: dict[str, Any], cap: int) -> dict[str, Any]:
    """A3: content 截断 + truncated 显式标注 (降级可观测; url 恒保留).

    cap<=0 (配置关闭) → 原样透传, 不加截断标记 (回退旧行为).
    """
    if cap <= 0:
        return d
    content = d.get("content", "")
    truncated = len(content) > cap
    d = dict(d)
    d["content"] = content[:cap] + "…" if truncated else content
    d["truncated"] = truncated
    return d


def _partition_dicts(dicts: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """A1: 表头外提 — 批内全等的字段 → meta, 差异字段留行内.

    混合源等场景自动回退: 任一字段在行间不一致 → 留在行内, 绝不静默丢字段.
    """
    if not dicts:
        return [], {}
    keys = list(dicts[0].keys())
    meta: dict[str, Any] = {}
    for k in keys:
        first = dicts[0][k]
        if all(d[k] == first for d in dicts[1:]):
            meta[k] = first
    rows = [{k: v for k, v in d.items() if k not in meta} for d in dicts]
    return rows, meta


def _rows_to_payload(data: Any) -> tuple[Any, dict[str, Any]]:
    """数据 → (payload, meta); meta 供信封 source/tier 溯源 (provenance 永不剥离)."""
    if isinstance(data, list) and data and is_dataclass(data[0]):
        if isinstance(data[0], Announcement):
            cap = announcement_cap_chars()
            dicts = [_truncate_announcement_row(_row_to_dict(a), cap) for a in data]
        else:
            dicts = [_row_to_dict(r) for r in data]
        if len(dicts) > 1:  # 批内多行才做表头外提; 单行平铺 (rows 空壳无意义)
            rows, meta = _partition_dicts(dicts)
            if rows and any(rows):
                if any(r.get("truncated") for r in rows):
                    meta["note"] = "content 为截断摘要, 全文见 url"
                return {"meta": meta, "rows": rows}, meta
        # 无外提空间 (单行/批内全等) → 平铺, 信封溯源取首行
        env_meta = {k: v for k, v in dicts[0].items() if k in ("source", "tier")} if dicts else {}
        return dicts, env_meta
    if is_dataclass(data):
        d = _row_to_dict(data)
        return d, {k: d[k] for k in ("source", "tier") if k in d}
    return data, {}  # L3 透传 (FinancialStatement.rows 内层 / SpecialData.items)


def render_envelope(env: Envelope) -> dict[str, Any]:
    payload, meta = _rows_to_payload(env.data)
    return {
        "data": payload,
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
            {"symbol": c.symbol, "name": c.name, "asset_type": c.asset_type} for c in candidates
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


def _not_asset_response(hit: Instrument, expected: str) -> dict[str, Any]:
    desc = {"stock": "A股股票", "fund": "基金 (ETF/LOF/场外/REITs)", "index": "指数"}[expected]
    return {
        "data": None,
        "source": "",
        "tier": "",
        "ts": utc_iso(now_ms()),
        "warnings": [
            f"{hit.symbol} ({hit.name}) 是 {hit.asset_type}, 该工具仅支持 {desc}; "
            "请用 fin_data__search_symbols 确认标的类型",
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
            return _not_asset_response(hit, "stock")
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
            raise ParamError(f"分钟线仅支持单交易日窗口 (start == end), 收到 {start} ~ {end}")
    else:
        raise ParamError(f"period 仅支持 1d 与分钟线 {'/'.join(_MINUTE_PERIODS)} (周/月/季不支持)")
    if not start or not end:
        raise ParamError("start/end 必填 (YYYY-MM-DD)")
    hit = resolve_or_guide(resolver, symbol, "A股")
    if isinstance(hit, dict):
        return hit
    if hit.asset_type != "stock":
        return _not_asset_response(hit, "stock")
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
            "intraday",
            symbol=hit.symbol,
            period=period,
            start_ms=start_ms,
            end_ms=end_ms,
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
        raise ParamError(f"statement 必须是 income/balance/cashflow/indicators, 收到 {statement!r}")
    hit = resolve_or_guide(resolver, symbol, "A股")
    if isinstance(hit, dict):
        return hit
    if hit.asset_type != "stock":
        return _not_asset_response(hit, "stock")
    env = await router.call(
        "financials",
        symbol=hit.symbol,
        statement=statement,
        period=period,
        limit=limit,
        name=hit.name,
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


# ── v0.3.0 新工具 (PLAN-0.3.0.md §2.3, schema 评审记录: DESIGN_REVIEW 决策 13) ──

_FUND_KINDS = ("quote", "nav", "kline", "holdings", "holders", "performance", "info")
_INDEX_KINDS = ("quote", "kline", "fundamentals", "constituents", "basicinfo")


async def tool_get_fund_data(
    router: Router,
    resolver: SymbolResolver,
    symbol: str,
    kind: str = "quote",
    start: str = "",
    end: str = "",
    limit: int = 10,
) -> dict[str, Any]:
    """基金数据: quote/nav/kline/holdings/holders/performance/info.

    THS 免费主干 (净值/收益/持仓/持有人/基本信息/场内快照仅ETF), Wind 补缺
    (LOF/OTC 快照=分钟行情 L3 标注; kline 全类型)。资产 gate: fund。
    """
    if kind not in _FUND_KINDS:
        raise ParamError(f"kind 仅支持 {'/'.join(_FUND_KINDS)}, 收到 {kind!r}")
    if not 1 <= limit <= 100:
        raise ParamError(f"limit 1-100, 收到 {limit}")
    hit = resolve_or_guide(resolver, symbol, "基金")
    if isinstance(hit, dict):
        return hit
    if hit.asset_type != "fund":
        return _not_asset_response(hit, "fund")
    domain = f"fund_{kind}"
    kwargs: dict[str, Any] = {
        "symbol": hit.symbol,
        "asset_type": hit.subtype or hit.asset_type,
        "name": hit.name,
    }
    if kind == "kline":
        if not start or not end:
            raise ParamError("fund kline 需要 start/end (YYYY-MM-DD)")
        kwargs["start_ms"] = date_to_ms(start)
        kwargs["end_ms"] = date_to_ms(end)
    else:
        kwargs["limit"] = limit
    env = await router.call(domain, **kwargs)
    return render_envelope(env)


async def tool_get_index_data(
    router: Router,
    resolver: SymbolResolver,
    symbol: str,
    kind: str = "quote",
    start: str = "",
    end: str = "",
    limit: int = 10,
) -> dict[str, Any]:
    """指数数据: quote/kline/fundamentals/constituents/basicinfo.

    指数行情 THS 主干 (无复权语义); fundamentals/basicinfo Wind 独家
    (question 类, 无降级源); constituents 仅当前成分 (THS 无历史)。
    资产 gate: index。
    """
    if kind not in _INDEX_KINDS:
        raise ParamError(f"kind 仅支持 {'/'.join(_INDEX_KINDS)}, 收到 {kind!r}")
    if not 1 <= limit <= 100:
        raise ParamError(f"limit 1-100, 收到 {limit}")
    hit = resolve_or_guide(resolver, symbol, "指数")
    if isinstance(hit, dict):
        return hit
    if hit.asset_type != "index":
        return _not_asset_response(hit, "index")
    domain = f"index_{kind}"
    if kind == "quote":
        env = await router.call(domain, symbols=[hit.symbol])
    elif kind == "kline":
        if not start or not end:
            raise ParamError("index kline 需要 start/end (YYYY-MM-DD)")
        env = await router.call(
            domain,
            symbol=hit.symbol,
            start_ms=date_to_ms(start),
            end_ms=date_to_ms(end),
        )
    elif kind == "constituents":
        env = await router.call(domain, symbol=hit.symbol)
    else:  # fundamentals / basicinfo (Wind 独家)
        env = await router.call(
            domain, symbol=hit.symbol, asset_type=hit.subtype, name=hit.name, limit=limit
        )
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
        return _not_asset_response(hit, "stock")
    env = await router.call(
        "announcements",
        symbol=hit.symbol,
        start_ms=date_to_ms(start),
        end_ms=date_to_ms(end),
        top_k=top_k,
        name=hit.name,
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
        rows.append(
            {
                "key": r.key,
                "field": r.field,
                "同花顺": r.left,
                "AKShare": r.right,
                "ths_as_of_ms": r.left_as_of_ms,
                "akshare_as_of_ms": r.right_as_of_ms,
                "diff_pct": r.diff_pct,
                "matched": r.matched,
                "note": r.note,
            }
        )
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
            "data": None,
            "source": "",
            "tier": "",
            "ts": utc_iso(now_ms()),
            "engine": "reconcile",
            "summary": {
                "domain": domain,
                "compared": 0,
                "matched": 0,
                "mismatched": 0,
                "skipped": 0,
            },
            "warnings": [f"对账需要 THS×AKShare 双源, 当前缺少: {missing}"],
        }
    if domain == "quote":
        canonical: list[str] = []
        for s in _split_symbols(symbols):
            hit = resolve_or_guide(resolver, s, "A股")
            if isinstance(hit, dict):
                return hit
            if hit.asset_type != "stock":
                return _not_asset_response(hit, "stock")
            canonical.append(hit.symbol)
        rep = await reconcile_quotes(ths, akshare, canonical, tolerance_pct=tolerance_pct)
    else:
        if not start or not end:
            raise ParamError("klines 对账需要 start/end (YYYY-MM-DD)")
        hit = resolve_or_guide(resolver, symbols, "A股")
        if isinstance(hit, dict):
            return hit
        if hit.asset_type != "stock":
            return _not_asset_response(hit, "stock")
        rep = await reconcile_klines(
            ths,
            akshare,
            hit.symbol,
            date_to_ms(start),
            date_to_ms(end),
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
    # v0.3.0 M6: symbols 快照新鲜度检测 (自动同步入口: scripts/sync-symbols.py --if-stale)
    from core.domain.symbols import snapshot_age_days

    age = snapshot_age_days()
    if age is None:
        warnings.append("config/symbols.json 缺失或不可解析: 请运行 scripts/sync-symbols.py")
    elif age >= 30:
        warnings.append(
            f"config/symbols.json 距今 {age} 天未同步: 建议运行 "
            "scripts/sync-symbols.py --if-stale 30 (本地快照仍可用)"
        )
    router = Router(adapters)
    return router, resolver, warnings


def create_app() -> Any:
    from mcp.server.fastmcp import FastMCP

    router, resolver, warnings = build_server_components()
    mcp = FastMCP(
        "finance-unified",
        instructions=(
            "统一金融数据入口。v0.3.0 覆盖: A股行情快照/日K/分钟线(当日,W独家)/财务三表与指标/"
            "交易日历/特色数据/标的检索/公告(W独家)/EDB宏观(W主干)/双源对账/"
            "基金(净值/收益/持仓/持有人/场内快照/K线)/指数(行情/K线/成分/基本面)。"
            "不支持: 周月季K、港股美股、宏观白名单外指标经AKShare兜底、全市场扫描"
            "(数据湖为离线资产, 见 scripts/lake.py)、研报/评级/目标价。每个结果携带 "
            "source(同花顺/Wind/AKShare)/tier/ts 溯源; 分钟线/公告/指数基本面无降级源, 明确告知。"
            + (" 注意: " + "; ".join(warnings) if warnings else "")
        ),
    )

    @mcp.tool()
    async def fin_data__search_symbols(
        query: str, market: str | None = None, limit: int = 10
    ) -> dict:
        """名称/代码消歧检索 → 唯一 canonical code (同花顺 meta → AKShare 兜底)。

        歧义时返回候选列表: 用 market 参数 (A股/基金/指数) 限定后重查。"""
        env = await router.call("search", query=query, market=market, limit=limit)
        return render_envelope(env)

    @mcp.tool()
    async def fin_data__get_quote(symbols: str, market: str | None = None) -> dict:
        """A股行情快照 (最新价/涨跌幅/量额), 批量 ≤50 只逗号分隔。

        先 search 消歧再调用; 结果不含中文名。单次调用体积小, 可放心批量。"""
        return await tool_get_quote(router, resolver, symbols, market)

    @mcp.tool()
    async def fin_data__get_klines(
        symbol: str,
        period: str = "1d",
        start: str = "",
        end: str = "",
        adjust: str = "none",
    ) -> dict:
        """K线: 1d 日线优先 (THS 主干), 分钟线 1m/5m/15m/30m/60m 仅单交易日 (Wind 独家)。

        窗口 ≤1 年 (长窗口单次结果可达 3 万+ tokens, 需要更久历史时切片多次);
        adjust: none/forward/backward 仅日线; 分钟线要求 start==end。"""
        return await tool_get_klines(router, resolver, symbol, period, start, end, adjust)

    @mcp.tool()
    async def fin_data__get_financials(
        symbol: str,
        statement: str,
        period: str = "annual",
        limit: int = 4,
    ) -> dict:
        """A股财务三表与指标: statement=income/balance/cashflow/indicators。

        period=annual/quarterly, limit 1-20 (默认 4 期足够趋势判断, 勿取 20)。"""
        return await tool_get_financials(router, resolver, symbol, statement, period, limit)

    @mcp.tool()
    async def fin_data__get_calendar() -> dict:
        """A股近一年交易日历 (~240 行, 一次调用即可, 勿重复取)。"""
        return await tool_get_calendar(router, resolver)

    @mcp.tool()
    async def fin_data__get_special_data(
        kind: str,
        date: str | None = None,
        page: int = 1,
        size: int = 50,
    ) -> dict:
        """特色数据: kind=limit-up/limit-up-ladder/hot/hot-history/dragon-tiger/anomaly-stock。

        涨停池支持分页 (page/size); 只看头部时调小 size (默认 50)。"""
        return await tool_get_special_data(router, resolver, kind, date, page, size)

    @mcp.tool()
    async def fin_data__get_announcements(
        symbol: str,
        start: str = "",
        end: str = "",
        top_k: int = 10,
    ) -> dict:
        """上市公司公告检索 (Wind 独家 RAG, 无降级源)。start/end 必填 (YYYY-MM-DD)。

        top_k ≤5 (长公告全文可达 2 万+ tokens; 结果 content 已截断, 全文见 url)。"""
        return await tool_get_announcements(router, resolver, symbol, start, end, top_k)

    @mcp.tool()
    async def fin_data__get_edb(
        indicator: str,
        start: str = "",
        end: str = "",
        observation: int = 10,
    ) -> dict:
        """EDB 宏观/行业指标 (Wind 主干; AKShare 仅白名单兜底)。

        用指标简称 (如 中国GDP); observation 默认 10 已够趋势判断, 勿取 100。"""
        return await tool_get_edb(router, resolver, indicator, start, end, observation)

    @mcp.tool()
    async def fin_data__reconcile(
        domain: str,
        symbols: str,
        start: str = "",
        end: str = "",
        tolerance_pct: float | None = None,
    ) -> dict:
        """双源对账 (THS×AKShare, 未复权, 只比数据时点): domain=quote/klines。

        分歧不自动修复 — 报告交 LLM 裁决 (含双源值 + 数据时点 + diff)。"""
        return await tool_reconcile(router, resolver, domain, symbols, start, end, tolerance_pct)

    @mcp.tool()
    async def fin_data__get_fund_data(
        symbol: str,
        kind: str = "quote",
        start: str = "",
        end: str = "",
        limit: int = 10,
    ) -> dict:
        """基金数据 (THS 免费主干, Wind 补缺): kind=quote/nav/kline/holdings/holders/
        performance/info。

        kline 需 start/end; 其余 kind 用 limit (默认 10)。资产 gate: fund。"""
        return await tool_get_fund_data(router, resolver, symbol, kind, start, end, limit)

    @mcp.tool()
    async def fin_data__get_index_data(
        symbol: str,
        kind: str = "quote",
        start: str = "",
        end: str = "",
        limit: int = 10,
    ) -> dict:
        """指数数据 (行情 THS 主干, 无复权语义): kind=quote/kline/fundamentals/
        constituents/basicinfo。

        kline 需 start/end; constituents 仅当前成分 (无历史)。资产 gate: index。"""
        return await tool_get_index_data(router, resolver, symbol, kind, start, end, limit)

    # B1 (DESIGN_CONTEXT_BUDGET.md): 去除 pydantic 自动 title (与参数名重复的注解)。
    # 参数名/类型/required/默认值/语义零改动 — 一次性结构精简, 之后前缀重新稳定
    for _tool in mcp._tool_manager._tools.values():
        _tool.parameters = _strip_schema_titles(_tool.parameters)

    return mcp


def _strip_schema_titles(node: Any) -> Any:
    """递归删除 JSON Schema 中的 "title" 键 (FastMCP/pydantic 自动生成, 纯冗余)."""
    if isinstance(node, dict):
        return {k: _strip_schema_titles(v) for k, v in node.items() if k != "title"}
    if isinstance(node, list):
        return [_strip_schema_titles(v) for v in node]
    return node


def main() -> None:
    app = create_app()
    try:
        app.run(transport="stdio")
    except KeyboardInterrupt:
        # 父进程 (dsh web) Ctrl+C 时 SIGINT 同发前台进程组 → anyio 事件循环
        # 以 KeyboardInterrupt 结束 (正常清理路径)。静默退出, 不刷 traceback。
        pass


if __name__ == "__main__":
    main()
