"""上下文 token 测量脚本 (docs/RESEARCH_MCP_CONTEXT_WINDOW.md §8.4 复测方法).

测量两件事, 全部离线 (fixture 驱动, 不碰网络):

1. 工具注册面 (surface): create_app() 注册的 11 个 fin 工具, 按 DSH 视角
   (dsh-mcp-client 只取 name/description/inputSchema, 名字加 `mcp__fin__` 前缀)
   序列化后逐工具/逐构成测 token; 并量化 pydantic 自动生成的 title 冗余占比。
2. 结果渲染 (results): 用 tests/fixtures 里的真实数据构造典型 payload, 走
   现有 render_envelope 渲染 (V0), 与两个压缩变体对比:
   - V1: 仅结构性去重 (公共字段外提, 不改字段名/不改值)
   - V2: V1 + 紧凑键名 + 浮点截断 + 日期转 ISO 字符串 (值表示变化, 需评审)

Tokenizer: tiktoken cl100k_base —— DSH 实际模型 (deepseek-v4-flash) 的 tokenizer
未公开, cl100k_base 是简报认可的代理; 真实计费数字以 DSH 会话日志里 provider
usage 为准 (见 docs/DESIGN_CONTEXT_BUDGET.md §实测证据)。

用法: uv run python scripts/measure_tokens.py [surface|results|all]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from core.domain.models import (
    Announcement,
    CalendarDay,
    EDBPoint,
    Envelope,
    FinancialStatement,
    Kline,
    Quote,
    SpecialData,
)
from core.domain.units import date_to_ms, utc_iso
from servers.mcp_data import render_envelope, render_reconcile

REPO = Path(__file__).resolve().parents[1]
FIX = REPO / "tests" / "fixtures"
_DAY_MS = 86_400_000

try:
    import tiktoken

    ENC = tiktoken.get_encoding("cl100k_base")
except ImportError:  # pragma: no cover
    ENC = None


def tok(text: str) -> int:
    """cl100k_base tokens; 中文按字节级 BPE 实际计, 不按字符粗估."""
    assert ENC is not None, "需要 tiktoken (uv sync 已加入 dev group)"
    return len(ENC.encode(text))


def tok_json(obj: Any) -> int:
    return tok(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def pct(part: int, total: int) -> str:
    return f"{100.0 * part / total:5.1f}%"


# ──────────────────────────────────────────────────────────────────────
# 1. 工具注册面 (DSH 视角)
# ──────────────────────────────────────────────────────────────────────


def measure_surface() -> dict[str, Any]:
    from servers.mcp_data import create_app

    app = create_app()
    manager = app._tool_manager  # FastMCP 内部; 与 dsh-mcp-client syncTools 对齐
    rows: list[dict[str, Any]] = []
    title_tokens = 0
    total = 0
    for tool in manager._tools.values():
        raw_name = tool.name
        public = f"mcp__fin__{raw_name}"  # dsh-mcp-client publicToolName 规则
        params = tool.parameters
        desc = tool.description or ""
        # title 冗余: 剥掉 inputSchema 里所有 "title" 键 (值+键+逗号) 后的差值
        stripped = _strip_title_keys(params)
        t_full = tok_json({"name": public, "description": desc, "parameters": params})
        t_no_title = tok_json({"name": public, "description": desc, "parameters": stripped})
        t_title = t_full - t_no_title
        title_tokens += t_title
        total += t_full
        rows.append(
            {
                "tool": public,
                "tokens": t_full,
                "desc_tokens": tok(desc),
                "title_redundant_tokens": t_title,
            }
        )
    rows.sort(key=lambda r: -r["tokens"])
    instructions = str(app.instructions or "")
    inst_tokens = tok(instructions)
    return {"rows": rows, "total": total, "title_total": title_tokens, "instructions_tokens": inst_tokens}


def _strip_title_keys(node: Any) -> Any:
    if isinstance(node, dict):
        out = {k: _strip_title_keys(v) for k, v in node.items() if k != "title"}
        return out
    if isinstance(node, list):
        return [_strip_title_keys(v) for v in node]
    return node


# ──────────────────────────────────────────────────────────────────────
# 2. 结果渲染 (fixture 真实数据 → 现渲染 vs 压缩变体)
# ──────────────────────────────────────────────────────────────────────


def load_fixture(*parts: str) -> dict:
    return json.loads((FIX.joinpath(*parts)).read_text(encoding="utf-8"))


def build_kline_payload(n_bars: int) -> Envelope:
    """THS kline fixture 真实 OHLCV; n_bars>30 时循环采样延展窗口 (模拟长窗口)."""
    items = load_fixture("ths", "kline_600519.json")["data"]["item"]
    bars: list[Kline] = []
    for i in range(n_bars):
        it = items[i % len(items)]
        bars.append(
            Kline(
                symbol="600519.SH",
                date_ms=int(it["date_ms"]) + (i // len(items)) * _DAY_MS,
                open=float(it["open_price"]),
                high=float(it["high_price"]),
                low=float(it["low_price"]),
                close=float(it["close_price"]),
                volume=float(it["volume"]),
                turnover=float(it["turnover"]),
                currency="CNY",
                period="1d",
                adjust="none",
                source="同花顺",
                tier="free",
            )
        )
    return Envelope(data=bars, ts_ms=date_to_ms("2026-08-15"), warnings=())


def build_quote_payload(n: int = 50) -> Envelope:
    items = load_fixture("ths", "quote_batch.json")["data"]["item"]
    quotes: list[Quote] = []
    for i in range(min(n, len(items))):
        it = items[i]
        quotes.append(
            Quote(
                symbol=it["thscode"],
                last_price=float(it["last_price"]),
                open_price=float(it.get("open_price")),
                high_price=float(it.get("high_price")),
                low_price=float(it.get("low_price")),
                prev_close=float(it.get("prev_price")),
                change_pct=float(it["price_change_ratio_pct"]),
                volume=float(it["volume"]),
                turnover=float(it["turnover"]),
                as_of_ms=int(load_fixture("ths", "quote_batch.json")["data"]["timestamp"]),
                currency="CNY",
                source="同花顺",
                tier="free",
            )
        )
    return Envelope(data=quotes, ts_ms=date_to_ms("2026-08-15"), warnings=())


def build_calendar_payload() -> Envelope:
    items = load_fixture("ths", "calendar.json")["data"]["item"]
    days = [
        CalendarDay(date_ms=int(it["date_ms"]), is_trading=True, source="同花顺", tier="free")
        for it in items
    ]
    return Envelope(data=days, ts_ms=date_to_ms("2026-08-15"), warnings=())


def build_announcements_payload() -> Envelope:
    """Wind 公告 fixture: 真实全文 (贵州茅台, 单条 ~8.5K 字符)."""
    raw = load_fixture("wind", "announcements_600519.json")
    text = raw["result"]["content"][0]["text"]
    inner = json.loads(text)["data"]
    anns: list[Announcement] = []
    for it in inner.get("items", []):
        raw_date = it.get("date") or it.get("date_ms") or 0
        if isinstance(raw_date, str) and "-" in raw_date:
            date_ms = date_to_ms(raw_date[:10])
        else:
            date_ms = int(raw_date)
        anns.append(
            Announcement(
                symbol="600519.SH",
                title=it.get("title", ""),
                date_ms=date_ms,
                content=it.get("content", ""),
                url=it.get("url", ""),
                source="Wind",
                tier="quota",
            )
        )
    return Envelope(data=anns, ts_ms=date_to_ms("2026-08-15"), warnings=())


def build_financials_payload() -> Envelope:
    """THS income fixture: 真实行字段 (L3 透传 dict), 4 期."""
    items = load_fixture("ths", "income_600519.json")["data"]["item"]
    stmts: list[FinancialStatement] = []
    for i in range(4):
        it = dict(items[i % len(items)])
        it["fiscal_year"] = 2025 - i
        stmts.append(
            FinancialStatement(
                symbol="600519.SH",
                statement="income",
                report_date_ms=int(it.get("period_end_ms") or 0),
                rows=(it,),
                currency=it.get("currency", "CNY"),
                caliber="年度",
                source="同花顺",
                tier="free",
            )
        )
    return Envelope(data=stmts, ts_ms=date_to_ms("2026-08-15"), warnings=())


def build_special_payload(n: int = 50) -> Envelope:
    """涨停池 fixture 为空 item → 用龙虎榜 fixture 的行做体量估计."""
    try:
        items = load_fixture("ths", "limit_up_pool.json")["data"]["item"]
    except KeyError:
        items = []
    if not items:
        items = load_fixture("ths", "dragon_tiger.json")["data"]["stock_items"]
    items = (items * ((n // max(1, len(items))) + 1))[:n]
    return Envelope(
        data=SpecialData(
            kind="limit-up",
            date_ms=date_to_ms("2026-08-15"),
            items=items,
            source="同花顺",
            tier="free",
        ),
        ts_ms=date_to_ms("2026-08-15"),
        warnings=(),
    )


def build_edb_payload(n: int = 100) -> Envelope:
    """Wind EDB fixture 真实指标 (中国GDP, 季频); 循环延展到 n 个观测."""
    raw = load_fixture("wind", "edb_gdp.json")
    inner = json.loads(raw["result"]["content"][0]["text"])["data"]["data"][0]
    meta, dates, values = inner["meta"], inner["date"], inner["value"]
    pts: list[EDBPoint] = []
    for i in range(n):
        d = dates[i % len(dates)]
        pts.append(
            EDBPoint(
                indicator=meta["name"],
                code=meta["code"],
                date_ms=date_to_ms(f"{d[:4]}-{d[4:6]}-{d[6:8]}"),
                value=float(values[i % len(values)]),
                unit=meta["unit"],
                magnitude=meta["magnitude"],
                freq=meta["freq"],
                currency=meta["currency"],
                source="Wind",
                tier="quota",
            )
        )
    return Envelope(data=pts, ts_ms=date_to_ms("2026-08-15"), warnings=())


def build_reconcile_payload() -> dict[str, Any]:
    from core.domain.reconcile import ReconcileReport, ReconcileRow

    rep = ReconcileReport(
        domain="klines",
        rows=(
            ReconcileRow(
                key="600519.SH",
                field="close",
                left=1185.49,
                right=1185.49,
                left_as_of_ms=date_to_ms("2026-08-14"),
                right_as_of_ms=date_to_ms("2026-08-14"),
                diff_pct=0.0,
                matched=True,
                note="",
            ),
            ReconcileRow(
                key="000001.SZ",
                field="close",
                left=11.02,
                right=11.03,
                left_as_of_ms=date_to_ms("2026-08-14"),
                right_as_of_ms=date_to_ms("2026-08-14"),
                diff_pct=0.09,
                matched=False,
                note="双源时点一致, 价格分歧",
            ),
        ),
        compared=2,
        matched=1,
        mismatched=1,
        skipped=0,
        tolerance_pct=0.5,
        ts_ms=date_to_ms("2026-08-15"),
        warnings=(),
    )
    return render_reconcile(rep)


# ── 压缩变体 (V1 结构性; V2 结构性+表示层) ────────────────────────────


def compact_kline(env: Envelope, variant: str) -> dict[str, Any]:
    bars: list[Kline] = env.data  # type: ignore[assignment]
    b0 = bars[0]
    meta = {
        "symbol": b0.symbol,
        "currency": b0.currency,
        "period": b0.period,
        "adjust": b0.adjust,
        "source": b0.source,
        "tier": b0.tier,
        "degraded": b0.degraded,
        "ts": utc_iso(env.ts_ms),
    }
    if variant == "V1":
        rows = [
            {
                "date_ms": b.date_ms,
                "open": b.open,
                "high": b.high,
                "low": b.low,
                "close": b.close,
                "volume": b.volume,
                "turnover": b.turnover,
            }
            for b in bars
        ]
    else:  # V2: 紧凑键 + 浮点截断 + ISO 日期
        rows = [
            {
                "d": utc_iso(b.date_ms)[:10],
                "o": round(b.open, 2),
                "h": round(b.high, 2),
                "l": round(b.low, 2),
                "c": round(b.close, 2),
                "v": int(b.volume),
                "t": int(b.turnover),
            }
            for b in bars
        ]
    return {"data": {"meta": meta, "rows": rows}, "warnings": list(env.warnings)}


def compact_kline_v2_noiso(env: Envelope) -> dict[str, Any]:
    """V2 但日期保持 date_ms (L2 语义; ms int 的 BPE token 密度更高)."""
    bars: list[Kline] = env.data  # type: ignore[assignment]
    b0 = bars[0]
    meta = {
        "symbol": b0.symbol,
        "currency": b0.currency,
        "period": b0.period,
        "adjust": b0.adjust,
        "source": b0.source,
        "tier": b0.tier,
        "degraded": b0.degraded,
        "ts": utc_iso(env.ts_ms),
    }
    rows = [
        {
            "d": b.date_ms,
            "o": round(b.open, 2),
            "h": round(b.high, 2),
            "l": round(b.low, 2),
            "c": round(b.close, 2),
            "v": int(b.volume),
            "t": int(b.turnover),
        }
        for b in bars
    ]
    return {"data": {"meta": meta, "rows": rows}, "warnings": list(env.warnings)}


def compact_quote(env: Envelope, variant: str) -> dict[str, Any]:
    quotes: list[Quote] = env.data  # type: ignore[assignment]
    q0 = quotes[0]
    meta = {
        "as_of_ms": q0.as_of_ms,
        "currency": q0.currency,
        "source": q0.source,
        "tier": q0.tier,
        "ts": utc_iso(env.ts_ms),
    }
    if variant == "V1":
        rows = [
            {
                "symbol": q.symbol,
                "last_price": q.last_price,
                "open_price": q.open_price,
                "high_price": q.high_price,
                "low_price": q.low_price,
                "prev_close": q.prev_close,
                "change_pct": q.change_pct,
                "volume": q.volume,
                "turnover": q.turnover,
            }
            for q in quotes
        ]
    else:
        rows = [
            {
                "s": q.symbol,
                "last": round(q.last_price, 2),
                "open": None if q.open_price is None else round(q.open_price, 2),
                "high": None if q.high_price is None else round(q.high_price, 2),
                "low": None if q.low_price is None else round(q.low_price, 2),
                "prev": None if q.prev_close is None else round(q.prev_close, 2),
                "chg%": None if q.change_pct is None else round(q.change_pct, 2),
                "vol": int(q.volume),
                "amt": int(q.turnover),
            }
            for q in quotes
        ]
    return {"data": {"meta": meta, "rows": rows}, "warnings": list(env.warnings)}


def compact_calendar(env: Envelope, variant: str) -> dict[str, Any]:
    days: list[CalendarDay] = env.data  # type: ignore[assignment]
    meta = {"source": days[0].source, "tier": days[0].tier, "ts": utc_iso(env.ts_ms)}
    if variant == "V1":
        rows = [{"date_ms": d.date_ms, "is_trading": d.is_trading} for d in days]
    else:
        rows = [utc_iso(d.date_ms)[:10] for d in days]
    return {"data": {"meta": meta, "rows": rows}, "warnings": list(env.warnings)}


def compact_announcements(env: Envelope, variant: str, cap_chars: int = 800) -> dict[str, Any]:
    anns: list[Announcement] = env.data  # type: ignore[assignment]
    a0 = anns[0]
    meta = {
        "symbol": a0.symbol,
        "source": a0.source,
        "tier": a0.tier,
        "ts": utc_iso(env.ts_ms),
        "note": "content 为摘要截断, 全文见 url (降级可观测: truncated 字段)",
    }
    rows = []
    for a in anns:
        content = a.content
        truncated = len(content) > cap_chars
        if truncated:
            content = content[:cap_chars] + "…"
        rows.append(
            {
                "title": a.title,
                "date": utc_iso(a.date_ms)[:10],
                "content": content,
                "url": a.url,
                "truncated": truncated,
            }
        )
    return {"data": {"meta": meta, "rows": rows}, "warnings": list(env.warnings)}


def compact_financials(env: Envelope, variant: str) -> dict[str, Any]:
    stmts: list[FinancialStatement] = env.data  # type: ignore[assignment]
    s0 = stmts[0]
    meta = {
        "symbol": s0.symbol,
        "statement": s0.statement,
        "currency": s0.currency,
        "caliber": s0.caliber,
        "source": s0.source,
        "tier": s0.tier,
        "ts": utc_iso(env.ts_ms),
    }
    # rows 是 L3 透传 (字段名 vendor 保留), 只压缩外层
    rows = [{"report_date_ms": s.report_date_ms, "rows": s.rows} for s in stmts]
    return {"data": {"meta": meta, "rows": rows}, "warnings": list(env.warnings)}


def compact_special(env: Envelope, variant: str) -> dict[str, Any]:
    sp: SpecialData = env.data  # type: ignore[assignment]
    meta = {
        "kind": sp.kind,
        "source": sp.source,
        "tier": sp.tier,
        "ts": utc_iso(env.ts_ms),
    }
    return {"data": {"meta": meta, "rows": sp.items}, "warnings": list(env.warnings)}


def compact_edb(env: Envelope, variant: str) -> dict[str, Any]:
    pts: list[EDBPoint] = env.data  # type: ignore[assignment]
    p0 = pts[0]
    meta = {
        "indicator": p0.indicator,
        "code": p0.code,
        "unit": p0.unit,
        "magnitude": p0.magnitude,
        "freq": p0.freq,
        "currency": p0.currency,
        "source": p0.source,
        "tier": p0.tier,
        "ts": utc_iso(env.ts_ms),
    }
    if variant == "V1":
        rows = [{"date_ms": p.date_ms, "value": p.value} for p in pts]
    else:
        rows = [{"d": utc_iso(p.date_ms)[:10] if p.date_ms else "", "v": p.value} for p in pts]
    return {"data": {"meta": meta, "rows": rows}, "warnings": list(env.warnings)}


def compact_reconcile(rendered: dict[str, Any]) -> dict[str, Any]:
    # reconcile 已是紧凑形态 (行自带双源值), 仅把 ts 留在信封 — 无结构性冗余可去
    return rendered


# ──────────────────────────────────────────────────────────────────────


def measure_results() -> list[dict[str, Any]]:
    cases: list[tuple[str, Envelope | dict[str, Any], Any]] = [
        ("kline 30根 (周窗口)", build_kline_payload(30), compact_kline),
        ("kline 250根 (年窗口)", build_kline_payload(250), compact_kline),
        ("quote 批量 50", build_quote_payload(50), compact_quote),
        ("calendar 全年", build_calendar_payload(), compact_calendar),
        ("announcements top_k=10", build_announcements_payload(), compact_announcements),
        ("financials income×4期", build_financials_payload(), compact_financials),
        ("special 榜单 50 行", build_special_payload(50), compact_special),
        ("edb 100 观测", build_edb_payload(100), compact_edb),
        ("reconcile 报告", build_reconcile_payload(), compact_reconcile),
    ]
    out: list[dict[str, Any]] = []
    for label, env, fn in cases:
        if isinstance(env, dict):  # reconcile: 已渲染 dict
            v0 = env
        else:
            v0 = render_envelope(env)
        t0 = tok_json(v0)
        row: dict[str, Any] = {"case": label, "V0_tokens": t0, "V0_chars": len(json.dumps(v0, ensure_ascii=False))}
        v1 = fn(env, "V1") if not isinstance(env, dict) else compact_reconcile(env)
        row["V1_tokens"] = tok_json(v1)
        if not isinstance(env, dict):
            v2 = fn(env, "V2")
            row["V2_tokens"] = tok_json(v2)
        if not isinstance(env, dict) and label.startswith("kline"):
            v2b = compact_kline_v2_noiso(env)
            row["V2_noISO_tokens"] = tok_json(v2b)
        out.append(row)
    return out


# ──────────────────────────────────────────────────────────────────────


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode in ("surface", "all"):
        s = measure_surface()
        print(f"\n== 工具注册面 (DSH 视角: mcp__fin__ 前缀, cl100k_base) ==")
        print(f"{'tool':<40} {'tokens':>7} {'desc':>6} {'title冗余':>8}")
        for r in s["rows"]:
            print(
                f"{r['tool']:<40} {r['tokens']:>7} {r['desc_tokens']:>6} "
                f"{r['title_redundant_tokens']:>8}"
            )
        print(f"\n11 工具合计: {s['total']} tokens (每轮注入一次)")
        print(f"其中 title 冗余: {s['title_total']} tokens ({pct(s['title_total'], s['total'])})")
        print(f"instructions 长文本: {s['instructions_tokens']} tokens")
    if mode in ("results", "all"):
        print(f"\n== 结果渲染 (fixture 真实数据, cl100k_base) ==")
        print(f"{'case':<26} {'V0':>7} {'V1':>7} {'V2':>7} {'V1节省':>8} {'V2节省':>8}")
        for r in measure_results():
            v2 = r.get("V2_tokens")
            print(
                f"{r['case']:<26} {r['V0_tokens']:>7} {r['V1_tokens']:>7} "
                f"{str(v2):>7} {pct(r['V0_tokens']-r['V1_tokens'], r['V0_tokens']):>8} "
                f"{pct(r['V0_tokens']-v2, r['V0_tokens']) if v2 else '-':>8}"
            )
            v2b = r.get("V2_noISO_tokens")
            if v2b:
                print(
                    f"{'  └ V2 保持 date_ms':<26} {r['V0_tokens']:>7} {'':>7} "
                    f"{v2b:>7} {'':>8} {pct(r['V0_tokens']-v2b, r['V0_tokens']):>8}"
                )


if __name__ == "__main__":
    main()
