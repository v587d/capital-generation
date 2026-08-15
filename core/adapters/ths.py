"""同花顺 (THS) adapter — official REST, docs/.clone/Financial-API/docs/api.

Contract facts applied here (docs/LESSONS.md §3/§5):
- Success = HTTP 200 AND body code == 0; business errors carry {code, message, request_id}.
- Error codes map via config/error_map.yaml → FinError kinds; adapter NEVER retries.
- THS date ranges are (start, end] — start day EXCLUDED → we pass start-1d and
  filter client-side so callers get inclusive [start, end] (inclusiveStart).
- Bare 6-digit codes are rejected by THS → adapter requires canonical (suffixed)
  symbols; suffix inference is the resolver's job, not ours.
- volume is already 股; date_ms is Asia/Shanghai ms — no conversion needed (L2 native).
- 行情快照批量不含 name (LESSONS §3.2); limit ≤ 50 symbols per call (valuation 100
  token; quote batch keeps 50 for symmetry with the tool contract).
"""

from __future__ import annotations

from collections.abc import Sequence

import httpx

from core.adapters.base import BaseAdapter
from core.config import load_error_map
from core.domain.errors import (
    AuthError,
    FinTimeoutError,
    InternalError,
    NoDataError,
    ParamError,
    RateLimitError,
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
from core.domain.units import date_to_ms, source_name

BASE = "https://fuyao.aicubes.cn"
_DAY_MS = 86_400_000

# statement → endpoint + passthrough fields are raw rows (L3: annotate, never convert)
STATEMENT_ENDPOINTS = {
    "income": "/api/a-share/financials/income-statements",
    "balance": "/api/a-share/financials/balance-sheets",
    "cashflow": "/api/a-share/financials/cash-flow-statements",
}

SPECIAL_ENDPOINTS = {
    "limit-up": "/api/a-share/special-data/limit-up-pool",
    "limit-up-ladder": "/api/a-share/special-data/limit-up-ladder",
    "hot": "/api/a-share/special-data/hot-stock-list",
    "hot-history": "/api/a-share/special-data/hot-stock-list-history",
    "dragon-tiger": "/api/a-share/special-data/dragon-tiger-list",
    "anomaly-stock": "/api/a-share/special-data/anomaly-analysis-stock",
}

_TIMEOUTS = {"snapshot": 10.0, "kline": 30.0, "batch": 60.0}


class THSAdapter(BaseAdapter):
    vendor_id = "ths"
    # v0.1.0 六个域 + v0.3.0 fund/index 十域 (PLAN-0.3.0.md M4);
    # 无分钟线/公告/EDB (LESSONS §3.3 能力边界)
    capabilities = frozenset(
        {
            "search",
            "quote",
            "klines",
            "financials",
            "calendar",
            "special",
            "fund_quote",
            "fund_nav",
            "fund_kline",
            "fund_holdings",
            "fund_holders",
            "fund_performance",
            "fund_info",
            "index_quote",
            "index_kline",
            "index_constituents",
        }
    )

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = BASE,
        client: httpx.AsyncClient | None = None,
        error_map: dict[int | str, str] | None = None,
    ) -> None:
        self._key = api_key
        self._base = base_url
        self._client = client or httpx.AsyncClient(timeout=10.0)
        self._owns_client = client is None
        self._error_map = error_map or load_error_map("ths")

    # ── plumbing ───────────────────────────────────────────────────────

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _get(self, endpoint: str, params: dict[str, object], timeout_s: float) -> dict:
        url = f"{self._base}{endpoint}"
        try:
            resp = await self._client.get(
                url, params=params, headers={"X-api-key": self._key}, timeout=timeout_s
            )
        except httpx.TimeoutException as e:
            raise FinTimeoutError(
                f"同花顺 {endpoint} timeout",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint=endpoint,
            ) from e
        except httpx.HTTPError as e:
            raise SourceDownError(
                f"同花顺 {endpoint} transport error: {e}",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint=endpoint,
            ) from e

        if resp.status_code in (401, 403):
            raise AuthError(
                "同花顺 API Key 无效或未认证 (401/403)",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint=endpoint,
                status=resp.status_code,
            )
        if resp.status_code == 429:
            raise RateLimitError(
                "同花顺限流 (429)",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint=endpoint,
                status=429,
            )
        if resp.status_code >= 500:
            raise SourceDownError(
                f"同花顺服务端错误 ({resp.status_code})",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint=endpoint,
                status=resp.status_code,
            )

        try:
            body = resp.json()
        except ValueError as e:
            raise InternalError(
                f"同花顺非 JSON 响应: {resp.text[:200]!r}",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint=endpoint,
            ) from e

        code = body.get("code")
        if code != 0:
            self._raise_business(endpoint, body)
        data = body.get("data")
        if not isinstance(data, dict):
            raise InternalError(
                f"同花顺 data 缺失或非对象: {body}",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint=endpoint,
            )
        return data

    def _raise_business(self, endpoint: str, body: dict) -> None:
        code = body.get("code")
        kind = self._error_map.get(code)
        message = str(body.get("message") or f"code={code}")
        request_id = body.get("request_id")
        cls = {
            "AUTH": AuthError,
            "PARAM": ParamError,
            "RATE_LIMIT": RateLimitError,
            "NO_DATA": NoDataError,
            "SOURCE_DOWN": SourceDownError,
            "QUOTA": None,
        }.get(kind, InternalError)
        if cls is None:
            cls = InternalError
        raise cls(
            message,
            source=source_name(self.vendor_id),
            vendor=self.vendor_id,
            endpoint=endpoint,
            code=code,
            request_id=request_id,
        )

    @staticmethod
    def _require_canonical(symbol: str, endpoint: str) -> str:
        """THS rejects bare codes — require canonical (suffixed) symbols."""
        if "." not in symbol:
            raise ParamError(
                f"同花顺要求带后缀的完整代码, 收到裸码 {symbol!r} "
                "(先用 fin_data__search_symbols 消歧)",
                source=source_name("ths"),
                vendor="ths",
                endpoint=endpoint,
            )
        return symbol

    # ── search / quote / klines ────────────────────────────────────────

    async def search_symbols(
        self, query: str, *, market: str | None = None, limit: int = 10
    ) -> list[Instrument]:
        data = await self._get(
            "/api/meta/tickers/search",
            {"q": query, "limit": min(limit, 50)},
            _TIMEOUTS["snapshot"],
        )
        out: list[Instrument] = []
        for it in data.get("item", []):
            out.append(
                Instrument(
                    symbol=it["thscode"],
                    name=it.get("name", ""),
                    asset_type=it.get("asset_type", ""),
                    exchange=it.get("exchange") or "",
                    currency=it.get("currency", "CNY"),
                    subtype=it.get("asset_type", ""),  # THS 叶类别
                )
            )
        return out

    async def get_quote(self, symbols: Sequence[str]) -> list[Quote]:
        if not symbols:
            return []
        if len(symbols) > 50:
            raise ParamError(
                f"批量快照最多 50 只, 收到 {len(symbols)}",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint="/api/a-share/prices/snapshot",
            )
        canonical = [self._require_canonical(s, "/api/a-share/prices/snapshot") for s in symbols]
        data = await self._get(
            "/api/a-share/prices/snapshot",
            {"thscodes": ",".join(canonical)},
            _TIMEOUTS["snapshot"],
        )
        as_of = data.get("timestamp") or 0
        out: list[Quote] = []
        for it in data.get("item", []):
            out.append(
                Quote(
                    symbol=it["thscode"],
                    last_price=float(it["last_price"]),
                    open_price=_num(it.get("open_price")),
                    high_price=_num(it.get("high_price")),
                    low_price=_num(it.get("low_price")),
                    prev_close=_num(it.get("prev_price")),
                    change_pct=_num(it.get("price_change_ratio_pct")),
                    volume=float(it.get("volume") or 0),
                    turnover=float(it.get("turnover") or 0),
                    as_of_ms=as_of,
                    currency="CNY",
                    source=source_name(self.vendor_id),
                    tier="free",
                    extra={"ticker": it.get("ticker")},
                )
            )
        return out

    async def get_klines(
        self,
        symbol: str,
        start_ms: int,
        end_ms: int,
        *,
        adjust: str = "none",
    ) -> list[Kline]:
        canonical = self._require_canonical(symbol, "/api/a-share/prices/historical")
        if adjust not in ("none", "forward", "backward"):
            raise ParamError(
                f"adjust 必须是 none/forward/backward, 收到 {adjust!r}",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint="/api/a-share/prices/historical",
            )
        if end_ms - start_ms > 10 * 365 * _DAY_MS:
            raise ParamError(
                "历史 K 线窗口 ≤ 10 年, 请切片请求",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint="/api/a-share/prices/historical",
            )
        # (start, end] 开区间 → 回拨一天再过滤 (LESSONS §5.1)
        shifted = start_ms - _DAY_MS
        data = await self._get(
            "/api/a-share/prices/historical",
            {
                "thscode": canonical,
                "interval": "1d",
                "start": shifted,
                "end": end_ms,
                "adjust": adjust,
            },
            _TIMEOUTS["kline"],
        )
        out: list[Kline] = []
        for it in data.get("item", []):
            date_ms = int(it["date_ms"])
            if date_ms < start_ms:
                continue  # 过滤回拨引入的首日
            out.append(
                Kline(
                    symbol=canonical,
                    date_ms=date_ms,
                    open=float(it["open_price"]),
                    high=float(it["high_price"]),
                    low=float(it["low_price"]),
                    close=float(it["close_price"]),
                    volume=float(it.get("volume") or 0),
                    turnover=float(it.get("turnover") or 0),
                    currency="CNY",
                    adjust=adjust,
                    source=source_name(self.vendor_id),
                    tier="free",
                )
            )
        return out

    # ── financials / calendar / special ────────────────────────────────

    async def get_financials(
        self,
        symbol: str,
        statement: str,
        *,
        period: str = "annual",
        limit: int = 4,
        name: str = "",  # Wind NL 问句需要名称; THS 忽略
    ) -> list[FinancialStatement]:
        if statement == "indicators":
            return await self._indicators(symbol)
        endpoint = STATEMENT_ENDPOINTS.get(statement)
        if endpoint is None:
            raise ParamError(
                f"statement 必须是 income/balance/cashflow/indicators, 收到 {statement!r}",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint="/api/a-share/financials/*",
            )
        if period not in ("annual", "quarterly"):
            raise ParamError(f"period 必须是 annual/quarterly, 收到 {period!r}")
        if not 1 <= limit <= 20:
            raise ParamError("limit 必须是 1–20")
        canonical = self._require_canonical(symbol, endpoint)
        data = await self._get(
            endpoint,
            {"thscode": canonical, "period": period, "limit": limit},
            _TIMEOUTS["batch"],
        )
        out: list[FinancialStatement] = []
        for it in data.get("item", []):
            out.append(
                FinancialStatement(
                    symbol=canonical,
                    statement=statement,
                    report_date_ms=int(it.get("period_end_ms") or it.get("report_date_ms") or 0),
                    rows=(dict(it),),
                    currency=it.get("currency", "CNY"),
                    caliber="年度" if period == "annual" else "季度",
                    source=source_name(self.vendor_id),
                    tier="free",
                )
            )
        return out

    async def _indicators(self, symbol: str) -> list[FinancialStatement]:
        # 财务指标是单报告期快照: limit 语义退化为最新年报 YYYY-4
        raise ParamError(
            "indicators 需要 report 参数 (YYYY-1..4), 走 get_financials(report=...) 单独调用",
            source=source_name(self.vendor_id),
            vendor=self.vendor_id,
            endpoint="/api/a-share/financials/indicators",
        )

    async def get_calendar(self) -> list[CalendarDay]:
        data = await self._get("/api/a-share/calendar/trading-days", {}, _TIMEOUTS["snapshot"])
        return [
            CalendarDay(
                date_ms=int(it["date_ms"]),
                is_trading=True,
                source=source_name(self.vendor_id),
                tier="free",
            )
            for it in data.get("item", [])
        ]

    async def get_special_data(self, kind: str, **params: object) -> SpecialData:
        endpoint = SPECIAL_ENDPOINTS.get(kind)
        if endpoint is None:
            raise ParamError(
                f"kind 必须是 {sorted(SPECIAL_ENDPOINTS)} 之一, 收到 {kind!r}",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint="/api/a-share/special-data/*",
            )
        qp: dict[str, object] = {}
        for k, v in params.items():
            if v is None:
                continue
            if isinstance(v, int) and k.endswith("_ms"):
                qp[k] = v
            elif k in ("date", "start_date", "end_date") and isinstance(v, str):
                qp[k] = v
            elif k in ("page", "size", "limit", "offset"):
                qp[k] = int(v)
            elif k in ("sort_field", "sort_dir", "period", "board_type", "thscodes"):
                qp[k] = str(v)
        data = await self._get(endpoint, qp, _TIMEOUTS["batch"])
        items = tuple(data.get("item", []))
        date_ms: int | None = None
        if "date_ms" in params and isinstance(params["date_ms"], int):
            date_ms = int(params["date_ms"])
        elif "date" in params and isinstance(params["date"], str):
            date_ms = date_to_ms(params["date"])
        elif data.get("timestamp"):
            date_ms = int(data["timestamp"])
        return SpecialData(
            kind=kind,
            date_ms=date_ms,
            items=items,
            source=source_name(self.vendor_id),
            tier="free",
        )

    # ── v0.3.0 fund 域 (THS 免费主干; 3004 能力边界 → NoDataError 链内换源) ──

    @staticmethod
    def _fund_type(asset_type: str) -> str:
        """resolver asset_type → THS fund_type (otc/exchange/reits)."""
        ft = {
            "fund-etf": "exchange",
            "fund-lof": "exchange",
            "fund-otc": "otc",
            "fund-reits": "reits",
        }.get(asset_type, "")
        if not ft:
            # 未知类别: 按后缀兜底 (.OF → otc, 其余 exchange)
            return "otc" if asset_type.endswith("otc") else "exchange"
        return ft

    async def _fund_get(self, endpoint: str, params: dict[str, object]) -> dict:
        """fund 端点调用; 3004 (标的类型不支持该能力) → NoDataError (能力边界,
        链内换源 — 如 LOF 走 Wind 兜底; LESSONS §3.1 3004 原为 PARAM, 此处定向例外).
        """
        try:
            return await self._get(endpoint, params, _TIMEOUTS["batch"])
        except ParamError as e:
            if e.code == 3004:
                raise NoDataError(
                    f"同花顺不支持该基金类型 ({endpoint}): {e}",
                    source=source_name(self.vendor_id),
                    vendor=self.vendor_id,
                    endpoint=endpoint,
                    code=3004,
                ) from e
            raise

    async def get_fund_quote(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[Quote]:
        """场内行情快照 (仅 ETF; LOF/OTC/REITs → 3004 → NoDataError → Wind 兜底)."""
        data = await self._fund_get("/api/fund/market/snapshot", {"thscode": symbol})
        items = data.get("item", [])
        out: list[Quote] = []
        for it in items:
            out.append(
                Quote(
                    symbol=it["thscode"],
                    last_price=_num(it.get("last_price")) or 0.0,
                    open_price=_num(it.get("open_price")),
                    high_price=_num(it.get("high_price")),
                    low_price=_num(it.get("low_price")),
                    prev_close=_num(it.get("prev_price")),
                    change_pct=_num(it.get("price_change_ratio_pct")),
                    volume=_num(it.get("volume")) or 0.0,
                    turnover=_num(it.get("turnover")) or 0.0,
                    as_of_ms=int(data.get("timestamp") or 0),
                    source=source_name(self.vendor_id),
                    tier="free",
                    extra={"note": "THS 场内快照仅支持 ETF"},
                )
            )
        return out

    async def get_fund_nav(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        """净值 (unit/adj; range 不传 → 最新一条, 免烧 Wind)."""
        data = await self._fund_get(
            "/api/fund/performance/nav",
            {
                "fund_type": self._fund_type(asset_type),
                "thscode": symbol,
                "nav_type": "unit,adj",
            },
        )
        items = tuple(data.get("item", []))[:limit]
        return [
            FinancialStatement(
                symbol=symbol,
                statement="nav",
                report_date_ms=int(data.get("timestamp") or 0) or None,
                rows=items,
                source=source_name(self.vendor_id),
                tier="free",
                caliber="unit/adj 净值 (L3 透传)",
                extra={"nav_unit": "元"},
            )
        ]

    async def get_fund_kline(self, symbol: str, start_ms: int, end_ms: int) -> list[Kline]:
        """基金日K (仅 ETF, ≤5 年, 无复权语义 adjust=null; LOF → 3004 → Wind)."""
        data = await self._fund_get(
            "/api/fund/market/historical",
            {
                "thscode": symbol,
                "interval": "1d",
                "start": start_ms,
                "end": end_ms,
            },
        )
        out: list[Kline] = []
        for it in data.get("item", []):
            out.append(
                Kline(
                    symbol=symbol,
                    date_ms=int(it["date_ms"]),
                    open=_num(it.get("open_price")) or 0.0,
                    high=_num(it.get("high_price")) or 0.0,
                    low=_num(it.get("low_price")) or 0.0,
                    close=_num(it.get("close_price")) or 0.0,
                    volume=_num(it.get("volume")) or 0.0,
                    turnover=_num(it.get("turnover")) or 0.0,
                    period="1d",
                    adjust="none",
                    source=source_name(self.vendor_id),
                    tier="free",
                    extra={"note": "THS 基金日K 仅 ETF, ≤5 年, 无复权 (LOF 走 Wind)"},
                )
            )
        return out

    async def get_fund_holdings(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        data = await self._fund_get(
            "/api/fund/portfolio/holdings",
            {
                "fund_type": self._fund_type(asset_type),
                "thscode": symbol,
            },
        )
        return [
            FinancialStatement(
                symbol=symbol,
                statement="holdings",
                report_date_ms=int(data.get("timestamp") or 0) or None,
                rows=tuple(data.get("item", []))[:limit],
                source=source_name(self.vendor_id),
                tier="free",
                caliber="定期披露重仓股 (L3 透传)",
                extra={"note": "重仓股来自定期披露, 不代表实时持仓"},
            )
        ]

    async def get_fund_holders(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        data = await self._fund_get(
            "/api/fund/holders/detail",
            {
                "fund_type": self._fund_type(asset_type),
                "thscode": symbol,
                "merge_scope": "all",
            },
        )
        return [
            FinancialStatement(
                symbol=symbol,
                statement="holders",
                report_date_ms=int(data.get("timestamp") or 0) or None,
                rows=tuple(data.get("item", []))[:limit],
                source=source_name(self.vendor_id),
                tier="free",
                caliber="持有人结构 (L3 透传)",
            )
        ]

    async def get_fund_performance(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        data = await self._fund_get(
            "/api/fund/performance/returns",
            {
                "fund_type": self._fund_type(asset_type),
                "thscode": symbol,
            },
        )
        return [
            FinancialStatement(
                symbol=symbol,
                statement="performance",
                report_date_ms=int(data.get("timestamp") or 0) or None,
                rows=tuple(data.get("item", []))[:limit],
                source=source_name(self.vendor_id),
                tier="free",
                caliber="区间收益率 (L3 透传)",
                extra={"unit": "百分数原值"},
            )
        ]

    async def get_fund_info(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        data = await self._fund_get(
            "/api/fund/profile/detail",
            {
                "fund_type": self._fund_type(asset_type),
                "thscode": symbol,
            },
        )
        return [
            FinancialStatement(
                symbol=symbol,
                statement="info",
                report_date_ms=int(data.get("timestamp") or 0) or None,
                rows=tuple(data.get("item", []))[:limit],
                source=source_name(self.vendor_id),
                tier="free",
                caliber="基本信息 (L3 透传)",
            )
        ]

    # ── v0.3.0 index 域 (指数行情 THS 主干; 指数无复权语义) ───────────────

    async def get_index_quote(self, symbols: Sequence[str]) -> list[Quote]:
        """指数快照批量 (≤50; 无 name — 与 A股快照同款限制)."""
        data = await self._get(
            "/api/a-share-index/prices/snapshot",
            {"thscodes": ",".join(symbols[:50])},
            _TIMEOUTS["snapshot"],
        )
        out: list[Quote] = []
        for it in data.get("item", []):
            out.append(
                Quote(
                    symbol=it["thscode"],
                    last_price=_num(it.get("last_price")) or 0.0,
                    open_price=_num(it.get("open_price")),
                    high_price=_num(it.get("high_price")),
                    low_price=_num(it.get("low_price")),
                    prev_close=_num(it.get("prev_price")),
                    change_pct=_num(it.get("price_change_ratio_pct")),
                    volume=_num(it.get("volume")) or 0.0,
                    turnover=_num(it.get("turnover")) or 0.0,
                    as_of_ms=int(data.get("timestamp") or 0),
                    source=source_name(self.vendor_id),
                    tier="free",
                    extra={"note": "指数行情 (THS 主干, 无复权语义)"},
                )
            )
        return out

    async def get_index_kline(self, symbol: str, start_ms: int, end_ms: int) -> list[Kline]:
        """指数日K (≤10 年; 无 adjust 参数 — 指数无复权概念)."""
        data = await self._get(
            "/api/a-share-index/prices/historical",
            {
                "thscode": symbol,
                "interval": "1d",
                "start": start_ms,
                "end": end_ms,
            },
            _TIMEOUTS["kline"],
        )
        out: list[Kline] = []
        for it in data.get("item", []):
            out.append(
                Kline(
                    symbol=symbol,
                    date_ms=int(it["date_ms"]),
                    open=_num(it.get("open_price")) or 0.0,
                    high=_num(it.get("high_price")) or 0.0,
                    low=_num(it.get("low_price")) or 0.0,
                    close=_num(it.get("close_price")) or 0.0,
                    volume=_num(it.get("volume")) or 0.0,
                    turnover=_num(it.get("turnover")) or 0.0,
                    period="1d",
                    adjust="none",
                    source=source_name(self.vendor_id),
                    tier="free",
                    extra={"note": "指数日K, 无复权语义 (THS)"},
                )
            )
        return out

    async def get_index_constituents(self, symbol: str) -> list[FinancialStatement]:
        """指数成分股 (仅当前, 无历史 — LESSONS §7)."""
        data = await self._get(
            "/api/a-share-index/constituents/ths-stock-list",
            {"thscode": symbol},
            _TIMEOUTS["batch"],
        )
        return [
            FinancialStatement(
                symbol=symbol,
                statement="constituents",
                report_date_ms=int(data.get("timestamp") or 0) or None,
                rows=tuple(data.get("item", [])),
                source=source_name(self.vendor_id),
                tier="free",
                caliber="当前成分股 (无历史, L3 透传)",
                extra={"note": "指数成分仅当前, 无历史版本"},
            )
        ]


def _num(v: object) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
