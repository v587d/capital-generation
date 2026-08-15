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
    # v0.1.0 六个域; 无分钟线/公告/EDB (LESSONS §3.3 能力边界)
    capabilities = frozenset({"search", "quote", "klines", "financials", "calendar", "special"})

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

    async def _get(
        self, endpoint: str, params: dict[str, object], timeout_s: float
    ) -> dict:
        url = f"{self._base}{endpoint}"
        try:
            resp = await self._client.get(
                url, params=params, headers={"X-api-key": self._key}, timeout=timeout_s
            )
        except httpx.TimeoutException as e:
            raise FinTimeoutError(
                f"同花顺 {endpoint} timeout",
                source=source_name(self.vendor_id), vendor=self.vendor_id, endpoint=endpoint,
            ) from e
        except httpx.HTTPError as e:
            raise SourceDownError(
                f"同花顺 {endpoint} transport error: {e}",
                source=source_name(self.vendor_id), vendor=self.vendor_id, endpoint=endpoint,
            ) from e

        if resp.status_code in (401, 403):
            raise AuthError(
                "同花顺 API Key 无效或未认证 (401/403)",
                source=source_name(self.vendor_id), vendor=self.vendor_id,
                endpoint=endpoint, status=resp.status_code,
            )
        if resp.status_code == 429:
            raise RateLimitError(
                "同花顺限流 (429)", source=source_name(self.vendor_id),
                vendor=self.vendor_id, endpoint=endpoint, status=429,
            )
        if resp.status_code >= 500:
            raise SourceDownError(
                f"同花顺服务端错误 ({resp.status_code})", source=source_name(self.vendor_id),
                vendor=self.vendor_id, endpoint=endpoint, status=resp.status_code,
            )

        try:
            body = resp.json()
        except ValueError as e:
            raise InternalError(
                f"同花顺非 JSON 响应: {resp.text[:200]!r}",
                source=source_name(self.vendor_id), vendor=self.vendor_id, endpoint=endpoint,
            ) from e

        code = body.get("code")
        if code != 0:
            self._raise_business(endpoint, body)
        data = body.get("data")
        if not isinstance(data, dict):
            raise InternalError(
                f"同花顺 data 缺失或非对象: {body}",
                source=source_name(self.vendor_id), vendor=self.vendor_id, endpoint=endpoint,
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
            message, source=source_name(self.vendor_id), vendor=self.vendor_id,
            endpoint=endpoint, code=code, request_id=request_id,
        )

    @staticmethod
    def _require_canonical(symbol: str, endpoint: str) -> str:
        """THS rejects bare codes — require canonical (suffixed) symbols."""
        if "." not in symbol:
            raise ParamError(
                f"同花顺要求带后缀的完整代码, 收到裸码 {symbol!r} "
                "(先用 fin_data__search_symbols 消歧)",
                source=source_name("ths"), vendor="ths", endpoint=endpoint,
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
                )
            )
        return out

    async def get_quote(self, symbols: Sequence[str]) -> list[Quote]:
        if not symbols:
            return []
        if len(symbols) > 50:
            raise ParamError(
                f"批量快照最多 50 只, 收到 {len(symbols)}",
                source=source_name(self.vendor_id), vendor=self.vendor_id,
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
                source=source_name(self.vendor_id), vendor=self.vendor_id,
                endpoint="/api/a-share/prices/historical",
            )
        if end_ms - start_ms > 10 * 365 * _DAY_MS:
            raise ParamError(
                "历史 K 线窗口 ≤ 10 年, 请切片请求",
                source=source_name(self.vendor_id), vendor=self.vendor_id,
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
                source=source_name(self.vendor_id), vendor=self.vendor_id,
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
            source=source_name(self.vendor_id), vendor=self.vendor_id,
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
                source=source_name(self.vendor_id), vendor=self.vendor_id,
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


def _num(v: object) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
