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
from core.config import load_yaml
from core.domain.errors import (
    FinTimeoutError,
    InternalError,
    NoDataError,
    SourceDownError,
)
from core.domain.models import (
    CalendarDay,
    EDBPoint,
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
    # v0.1.0 六个域 + edb (宏观白名单兜底, config/akshare_edb.yaml)
    capabilities = frozenset(
        {"search", "quote", "klines", "financials", "calendar", "special", "edb"}
    )

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
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint=fn_name,
            ) from e
        except KeyError as e:
            raise SourceDownError(
                f"AKShare {fn_name} 接口漂移 (缺字段 {e}) — 检查 akshare 版本/golden 回归",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint=fn_name,
            ) from e
        except Exception as e:  # noqa: BLE001 — 爬虫源异常种类多, 统一按源故障
            raise SourceDownError(
                f"AKShare {fn_name} 失败: {type(e).__name__}: {e}",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
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
            df = await self._call("stock_bid_ask_em", ak.stock_bid_ask_em, symbol=s.split(".")[0])
            kv = {str(r["item"]): r["value"] for r in self._rows(df)}
            if not kv:
                raise NoDataError(
                    f"AKShare 无 {s} 行情",
                    source=source_name(self.vendor_id),
                    vendor=self.vendor_id,
                    endpoint="stock_bid_ask_em",
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
        """日K — 上游链 东财 → 新浪 → 腾讯 (v0.1.1, PLAN.md §6; LESSONS §5.4).

        东财 push2his 对本机 IP 间歇限频 (TCP 层 ConnectionError, 无 HTTP 响应),
        表现为 SourceDownError/FinTimeoutError — 仅此类错误才换上游; NO_DATA/空结果
        不换 (空值纪律: 不模拟)。三个上游全挂 → SourceDownError 带全部上游上下文,
        交路由层按链降级。每次结果 extra.upstream 记录实际服务上游 (可观测)。
        """
        if "." in symbol:
            symbol = symbol.split(".")[0]
        errors: list[str] = []
        for fn_name, fn, kw in self._kline_upstreams(symbol, start_ms, end_ms, adjust):
            try:
                df = await self._call(fn_name, fn, **kw)
                return self._kline_rows(fn_name, df, symbol, adjust)
            except (SourceDownError, FinTimeoutError) as e:
                errors.append(f"{fn_name}: {type(e).__name__}: {str(e)[:80]}")
        raise SourceDownError(
            f"AKShare kline 全部上游失败: {'; '.join(errors)}",
            source=source_name(self.vendor_id),
            vendor=self.vendor_id,
            endpoint="kline",
        )

    @staticmethod
    def _kline_upstreams(
        symbol: str, start_ms: int, end_ms: int, adjust: str
    ) -> list[tuple[str, Any, dict[str, Any]]]:
        a = _ADJUST_MAP[adjust]
        start, end = ms_to_date(start_ms), ms_to_date(end_ms)
        return [
            # 东财 (原 M4 主干; 封锁期可能整源不可用)
            (
                "stock_zh_a_hist",
                ak.stock_zh_a_hist,
                {
                    "symbol": symbol,
                    "period": "daily",
                    "start_date": start,
                    "end_date": end,
                    "adjust": a,
                },
            ),
            # 新浪 (LESSONS §5.4 验证稳定; volume 单位=股; 仅 sh/sz)
            (
                "stock_zh_a_daily",
                ak.stock_zh_a_daily,
                {
                    "symbol": AKShareAdapter._sina_stock_code(symbol),
                    "start_date": start,
                    "end_date": end,
                    "adjust": a,
                },
            ),
            # 腾讯 (LESSONS §5.4 验证稳定; volume 单位=手 → to_shares)
            (
                "stock_zh_a_hist_tx",
                ak.stock_zh_a_hist_tx,
                {
                    "symbol": symbol,
                    "start_date": start,
                    "end_date": end,
                    "adjust": a,
                },
            ),
        ]

    @staticmethod
    def _kline_rows(fn_name: str, df: Any, symbol: str, adjust: str) -> list[Kline]:
        """各上游形状归一 (L2: date_ms/股/原始货币); extra.upstream 记录服务上游."""
        rows = AKShareAdapter._rows(df)
        if not rows:
            return []
        # 东财: 中文列, volume 手; 新浪/腾讯: 英文列 (sina volume 股 / tx 手)
        if "日期" in rows[0]:
            get, vol_unit = (
                lambda r, k: r[k],  # noqa: E731 — 中文列直取
                "手",
            )
            date_key, open_key = "日期", "开盘"
            high_key, low_key, close_key = "最高", "最低", "收盘"
            vol_key, amt_key = "成交量", "成交额"
        else:
            get = lambda r, k: r.get(k)  # noqa: E731
            vol_unit = "股" if fn_name == "stock_zh_a_daily" else "手"
            date_key, open_key = "date", "open"
            high_key, low_key, close_key = "high", "low", "close"
            vol_key, amt_key = "volume", "amount"
        out: list[Kline] = []
        for r in rows:
            out.append(
                Kline(
                    symbol=symbol,
                    date_ms=date_to_ms(str(get(r, date_key))),
                    open=float(get(r, open_key)),
                    high=float(get(r, high_key)),
                    low=float(get(r, low_key)),
                    close=float(get(r, close_key)),
                    volume=to_shares(_f(get(r, vol_key)) or 0.0, vol_unit),
                    turnover=_f(get(r, amt_key)) or 0.0,
                    currency="CNY",
                    adjust=adjust,  # L3: 声明请求口径 (akshare 实际 qfq/hfq 见 extra)
                    source=source_name("akshare"),
                    tier="free",
                    extra={
                        "akshare_adjust": _ADJUST_MAP[adjust],
                        "upstream": fn_name,  # 实际服务上游 (可观测)
                    },
                )
            )
        return out

    async def get_financials(
        self,
        symbol: str,
        statement: str,
        *,
        period: str = "annual",
        limit: int = 4,
        name: str = "",  # Wind NL 问句需要名称; AKShare 忽略
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
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
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

    # ── edb (宏观白名单兜底, config/akshare_edb.yaml) ─────────────────

    async def get_edb(
        self,
        indicator: str,
        start_ms: int | None = None,
        end_ms: int | None = None,
        *,
        observation: int = 10,
    ) -> list[EDBPoint]:
        """AKShare 宏观兜底 — 仅白名单指标 (config/akshare_edb.yaml)。

        口径与 Wind EDB 不同: L3 标注 (unit/magnitude 未知不猜), 日期标签解析
        失败 → date_ms=None + date_label 标注 (DATA_MODEL 铁律: 不猜)。
        白名单外 → NO_DATA 提示走 Wind (免费兜底源不能最先挂, DEGRADATION 纪律)。
        """
        cfg = load_yaml("akshare_edb.yaml")["indicators"]
        q = indicator.lower().replace(" ", "")
        match: tuple[str, dict] | None = None
        for key, entry in cfg.items():
            aliases = [str(a).lower().replace(" ", "") for a in entry.get("aliases", [])]
            if any(a and a in q for a in aliases) or key in q:
                match = (key, entry)
                break
        if match is None:
            raise NoDataError(
                f"AKShare 兜底仅覆盖白名单宏观指标 {sorted(cfg)}; {indicator!r} 请走 Wind EDB",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint="edb",
            )
        key, entry = match
        fn_name = str(entry["function"])
        fn = getattr(ak, fn_name, None)
        if fn is None:
            raise InternalError(
                f"akshare 无函数 {fn_name} (白名单配置失效)",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint="edb",
            )
        df = await self._call(f"edb/{key}", fn)
        rows = self._rows(df)
        out: list[EDBPoint] = []
        for r in rows:
            # 日期列: 优先 "日期" 列 (gdp 等), 否则首列 (月份/期间标签)
            date_label = str(r.get("日期") or next(iter(r.values())))
            date_ms = _parse_cn_period(date_label)
            for col, raw in r.items():
                if col in ("日期",) or col == next(iter(r.keys())):
                    continue
                name = str(r.get("商品", ""))
                indicator = f"{name}·{col}" if name else col
                out.append(
                    EDBPoint(
                        indicator=indicator,
                        code=key,
                        date_ms=date_ms,
                        value=_f(raw),
                        date_label=date_label,
                        source=source_name(self.vendor_id),
                        tier="free",
                        extra={"note": "AKShare 白名单兜底, 口径与 Wind EDB 不同 (L3 标注不转换)"},
                    )
                )
        return out


def _parse_cn_period(label: str) -> int | None:
    """'2023年第一季度' / '2026年07月份' / '201501' / '2024-12' → Asia/Shanghai 零点 ms;
    解析失败 None (DATA_MODEL: 不猜日期)."""
    import re as _re

    m = _re.match(r"^(\d{4})年?[第]?([一二三四1-4])?季度?$", label)
    if m:
        year, q = int(m.group(1)), m.group(2)
        month = {"一": 3, "二": 6, "三": 9, "四": 12, "1": 3, "2": 6, "3": 9, "4": 12}.get(
            q or "四", 12
        )
        return date_to_ms(f"{year}-{month:02d}-28")
    m = _re.match(r"^(\d{4})[-年](\d{1,2})月?(?:份)?$", label)
    if m:
        return date_to_ms(f"{int(m.group(1))}-{int(m.group(2)):02d}-01")
    m = _re.match(r"^(\d{4})(\d{2})$", label)
    if m:
        return date_to_ms(f"{int(m.group(1))}-{int(m.group(2))}-01")
    m = _re.match(r"^(\d{4})-(\d{2})-(\d{2})$", label)
    if m:
        return date_to_ms(label)
    return None


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
