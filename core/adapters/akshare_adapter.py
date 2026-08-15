"""AKShare adapter — free fallback source (docs/DEGRADATION.md AKShare 兜底纪律).

Discipline (P0-2 反模式禁令 + LESSONS):
- 单标的/小批量取数, 禁止全市场拉取再本地过滤 (stock_zh_a_spot_em 5000+ 行只取几只 = 封 IP).
- 频率闸: ≥2s/次 (global gate); 并发走信号量; 线程不可取消 → asyncio.timeout 硬超时,
  超时后丢弃结果并记录 (thread keeps running, result is dropped).
- 版本锁定 + golden 回归 (tests/golden), 升级前先跑.
- Errors: wrap into typed FinError; response-shape drift (KeyError) → SourceDownError
  with context — 接口漂移要可见, 不静默.

NOTE: akshare 是同步库, 这里全部 asyncio.to_thread 包装; 适配器不重试 (归路由).
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Sequence
from typing import Any

from core.adapters.base import BaseAdapter
from core.domain.errors import (
    FinTimeoutError,
    NoDataError,
    SourceDownError,
)
from core.domain.models import (
    CalendarDay,
    FinancialStatement,
    Instrument,
    Kline,
    Quote,
    SpecialData,
)
from core.domain.units import date_to_ms, ms_to_date, source_name, to_shares

MIN_INTERVAL_S = 2.0  # 频率闸
SEMAPHORE = 4  # 并发上限 (东财限频)
CALL_TIMEOUT_S = 30.0

_ADJUST_MAP = {"none": "", "forward": "qfq", "backward": "hfq"}  # 前/后复权映射(口径标签在模型上)

# 白名单: 每个域只允许这些 akshare 函数 (升级前 golden 回归覆盖它们)
import akshare as ak  # noqa: E402  (延迟导入, 保持 core 无顶层重依赖)

_SPECIAL_FUNCS = {
    "limit-up": lambda **kw: ak.stock_zt_pool_em(**kw),
    "hot": lambda **kw: ak.stock_hot_rank_em(),
    "dragon-tiger": lambda **kw: ak.stock_lhb_detail_em(**kw),
}


class AKShareAdapter(BaseAdapter):
    vendor_id = "akshare"

    def __init__(self, *, min_interval_s: float = MIN_INTERVAL_S) -> None:
        self._min_interval = min_interval_s
        self._last_call = 0.0
        self._sem = asyncio.Semaphore(SEMAPHORE)

    # ── plumbing ───────────────────────────────────────────────────────

    async def _call(self, fn_name: str, fn: Any, **kw: Any) -> Any:
        """频率闸 + 信号量 + 线程池 + 硬超时 + typed 错误包装."""
        now = time.monotonic()
        wait = self._last_call + self._min_interval - now
        if wait > 0:
            await asyncio.sleep(wait)
        self._last_call = time.monotonic()

        async def run() -> Any:
            async with self._sem:
                return await asyncio.to_thread(fn, **kw)

        try:
            return await asyncio.wait_for(run(), timeout=CALL_TIMEOUT_S)
        except TimeoutError as e:
            raise FinTimeoutError(
                f"AKShare {fn_name} timeout ({CALL_TIMEOUT_S}s, 结果已丢弃)",
                source=source_name(self.vendor_id), vendor=self.vendor_id,
                endpoint=fn_name,
            ) from e
        except KeyError as e:
            raise SourceDownError(
                f"AKShare {fn_name} 接口漂移 (缺字段 {e}) — 检查 akshare 版本/golden 回归",
                source=source_name(self.vendor_id), vendor=self.vendor_id,
                endpoint=fn_name,
            ) from e
        except Exception as e:  # noqa: BLE001 — 爬虫源异常种类多, 统一按源故障
            raise SourceDownError(
                f"AKShare {fn_name} 失败: {type(e).__name__}: {e}",
                source=source_name(self.vendor_id), vendor=self.vendor_id,
                endpoint=fn_name,
            ) from e

    @staticmethod
    def _rows(df: Any) -> tuple[dict[str, Any], ...]:
        """DataFrame (or list[dict] from goldens) → row dicts (L3 passthrough; NaN → None)."""
        if df is None or len(df) == 0:
            return ()
        if isinstance(df, list):
            return tuple(df)
        import pandas as pd

        return tuple(
            {k: (None if pd.isna(v) else v) for k, v in row.items()}
            for row in df.to_dict("records")
        )

    # ── 6 domains ──────────────────────────────────────────────────────

    async def search_symbols(
        self, query: str, *, market: str | None = None, limit: int = 10
    ) -> list[Instrument]:
        # 代码表单次全量但缓存由路由层负责; 这里只做名称/代码匹配 (无全市场行情拉取)
        df = await self._call("stock_info_a_code_name", ak.stock_info_a_code_name)
        rows = self._rows(df)
        q = query.strip()
        hits = [r for r in rows if q in str(r.get("code", "")) or q in str(r.get("name", ""))]
        out: list[Instrument] = []
        for r in hits[:limit]:
            code = str(r["code"])
            out.append(
                Instrument(
                    symbol=code if "." in code else f"{code}.SH",
                    name=str(r.get("name", "")),
                    asset_type="stock",
                    exchange="",
                    currency="CNY",
                )
            )
        return out

    async def get_quote(self, symbols: Sequence[str]) -> list[Quote]:
        out: list[Quote] = []
        for s in symbols[:50]:
            # stock_bid_ask_em 返回竖表 [item, value] (最新/今开/最高/最低/昨收/涨幅/总手/金额)
            df = await self._call(
                "stock_bid_ask_em", ak.stock_bid_ask_em, symbol=s.split(".")[0]
            )
            kv = {str(r["item"]): r["value"] for r in self._rows(df)}
            if not kv:
                raise NoDataError(
                    f"AKShare 无 {s} 行情", source=source_name(self.vendor_id),
                    vendor=self.vendor_id, endpoint="stock_bid_ask_em",
                )
            out.append(
                Quote(
                    symbol=s,
                    last_price=_f(kv.get("最新")) or 0.0,
                    open_price=_f(kv.get("今开")),
                    high_price=_f(kv.get("最高")),
                    low_price=_f(kv.get("最低")),
                    prev_close=_f(kv.get("昨收")),
                    change_pct=_f(kv.get("涨幅")),
                    volume=to_shares(_f(kv.get("总手")) or 0.0, "手"),
                    turnover=_f(kv.get("金额")) or 0.0,
                    as_of_ms=0,  # 爬虫源无数据时点 → 0 表示未知
                    currency="CNY",
                    source=source_name(self.vendor_id),
                    tier="free",
                    extra={"as_of_unknown": True},
                )
            )
        return out

    async def get_klines(
        self, symbol: str, start_ms: int, end_ms: int, *, adjust: str = "none"
    ) -> list[Kline]:
        if "." in symbol:
            symbol = symbol.split(".")[0]
        df = await self._call(
            "stock_zh_a_hist",
            ak.stock_zh_a_hist,
            symbol=symbol,
            period="daily",
            start_date=ms_to_date(start_ms),
            end_date=ms_to_date(end_ms),
            adjust=_ADJUST_MAP[adjust],
        )
        out: list[Kline] = []
        for r in self._rows(df):
            out.append(
                Kline(
                    symbol=symbol,
                    date_ms=date_to_ms(str(r["日期"])),
                    open=float(r["开盘"]),
                    high=float(r["最高"]),
                    low=float(r["最低"]),
                    close=float(r["收盘"]),
                    volume=to_shares(float(r["成交量"]), "手"),
                    turnover=float(r.get("成交额") or 0),
                    currency="CNY",
                    adjust=adjust,  # L3: 声明请求口径 (akshare 实际 qfq/hfq 见 extra)
                    source=source_name(self.vendor_id),
                    tier="free",
                    extra={"akshare_adjust": _ADJUST_MAP[adjust]},
                )
            )
        return out

    async def get_financials(
        self, symbol: str, statement: str, *, period: str = "annual", limit: int = 4
    ) -> list[FinancialStatement]:
        if statement == "indicators":
            df = await self._call(
                "stock_financial_analysis_indicator",
                ak.stock_financial_analysis_indicator,
                symbol=symbol.split(".")[0],
            )
            rows = self._rows(df)[:limit]
        else:
            rows = await self._report_sina(symbol, statement, limit)
        return [
            FinancialStatement(
                symbol=symbol,
                statement=statement,
                report_date_ms=0,  # 爬虫源日期字段不统一 → 0 表示未解析
                rows=(r,),
                currency="CNY",
                caliber="年度" if period == "annual" else "季度",
                source=source_name(self.vendor_id),
                tier="free",
                extra={"report_date_unparsed": True},
            )
            for r in rows
        ]

    @staticmethod
    def _sina_stock_code(symbol: str) -> str:
        """600519 / 600519.SH → sh600519; 000001 / 000001.SZ → sz000001."""
        code = symbol.split(".")[0]
        prefix = "sh" if code.startswith("6") else "sz"
        return f"{prefix}{code}"

    async def _report_sina(self, symbol: str, statement: str, limit: int) -> tuple[dict, ...]:
        table = {"income": "利润表", "balance": "资产负债表", "cashflow": "现金流量表"}[statement]
        df = await self._call(
            "stock_financial_report_sina",
            ak.stock_financial_report_sina,
            stock=self._sina_stock_code(symbol),
            symbol=table,
        )
        return self._rows(df)[:limit]

    async def get_calendar(self) -> list[CalendarDay]:
        df = await self._call("tool_trade_date_hist_sina", ak.tool_trade_date_hist_sina)
        rows = self._rows(df)
        return [
            CalendarDay(
                date_ms=date_to_ms(str(r["trade_date"])),
                is_trading=True,
                source=source_name(self.vendor_id),
                tier="free",
            )
            for r in rows
        ]

    async def get_special_data(self, kind: str, **params: object) -> SpecialData:
        fn = _SPECIAL_FUNCS.get(kind)
        if fn is None:
            raise NoDataError(
                f"AKShare 无 {kind} 兜底 (仅支持 limit-up/hot/dragon-tiger)",
                source=source_name(self.vendor_id), vendor=self.vendor_id,
                endpoint=f"special/{kind}",
            )
        kw: dict[str, Any] = {}
        if kind == "limit-up" and params.get("date"):
            kw["date"] = str(params["date"]).replace("-", "")
        if kind == "dragon-tiger":
            end = str(params.get("date") or ms_to_date(int(params.get("date_ms") or 0)))
            kw["start_date"] = kw.get("start_date", end)
            kw["end_date"] = end
        df = await self._call(f"special/{kind}", fn, **kw)
        return SpecialData(
            kind=kind,
            date_ms=int(params["date_ms"]) if isinstance(params.get("date_ms"), int) else None,
            items=self._rows(df),
            source=source_name(self.vendor_id),
            tier="free",
        )


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
