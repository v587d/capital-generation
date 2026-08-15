"""Wind adapter — official MCP over raw JSON-RPC POST (config/wind_tools.yaml).

Transport (M0 live 核实, 2026-08-15; LESSONS §5.2/§8): POST
`{jsonrpc, id, method, params}` to `https://mcp.wind.com.cn/vserver_<server>/mcp/`
with `Authorization: Bearer <WIND_API_KEY>`. Responses are SSE (payload on the
last `data:` line) or plain JSON. The business payload rides in
`result.content[0].text` as a JSON string; success envelopes vary by tool family
(双形状解析, LESSONS §4.1):
- columnar:     `{data: {columns: [{name, type}], rows: [[...]], unit: {...}}, error: null}`
- fundamentals: `{data: {data: [{columns, rows}, ...]}, error: null}`
- EDB:          `{data: {code: 0, data: [{meta, date[], value[]}]}}`
- RAG:          `{data: {items: [{title, date, content, url, ...}]}, error: null}`

Error classification (error_map.yaml `wind` 稳定码 + `text_patterns.wind` 嗅探):
HTTP status / JSON-RPC error / result.isError text / business code != 0 / plain
"没找到数据" text → typed FinError with full context (vendor + server + status +
code). Adapters NEVER retry — backoff/gating/failover belongs to the router.

Discipline (PLAN-0.2.0.md M1): serial concurrency (asyncio.Lock, Wind 官方默认
串行), `tier=quota` on every row, canonical symbols only — `.TI` never sent
(windcode semantics per-source, LESSONS §5.2), `correction` field recorded in
error context but never auto-applied.

BYOK: WIND_API_KEY (env → DSH credentials). No key → adapter not built → chains
fall back (financials → THS, observable degradation).
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Sequence
from datetime import datetime

import httpx

from core.adapters.base import BaseAdapter
from core.config import load_error_map, load_error_text_patterns, load_yaml
from core.domain.errors import (
    AuthError,
    FinError,
    FinTimeoutError,
    InternalError,
    NoDataError,
    ParamError,
    QuotaError,
    RateLimitError,
    SourceDownError,
)
from core.domain.models import Announcement, EDBPoint, FinancialStatement, Kline
from core.domain.units import TZ_CN, date_to_ms, ms_to_date, source_name

_INIT_TIMEOUT_S = 30.0
_CALL_TIMEOUT_S = 60.0

_KIND_TO_CLS: dict[str, type[FinError]] = {
    "AUTH": AuthError,
    "PARAM": ParamError,
    "RATE_LIMIT": RateLimitError,
    "TIMEOUT": FinTimeoutError,
    "NO_DATA": NoDataError,
    "SOURCE_DOWN": SourceDownError,
    "QUOTA": QuotaError,
    "INTERNAL": InternalError,
}

# 财务 NL 问句模板 (statement → 问句; Wind 无结构化三表工具, 行 L3 透传)
_FUNDAMENTALS_QUESTIONS = {
    "income": "查询{symbol}{period_label}利润表的主要科目"
    "（营业收入、营业成本、净利润）最近{limit}期",
    "balance": "查询{symbol}{period_label}资产负债表的主要科目"
    "（总资产、总负债、股东权益）最近{limit}期",
    "cashflow": "查询{symbol}{period_label}现金流量表的主要科目"
    "（经营活动、投资活动、筹资活动现金流净额）最近{limit}期",
}
_PERIOD_LABEL = {"annual": "年度", "quarterly": "季度"}

_ANNOUNCEMENT_QUERY = "查询{name}({symbol})在{start}至{end}的公告"
_EDB_DATE_FMT = "%Y%m%d"
_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")


class WindAdapter(BaseAdapter):
    vendor_id = "wind"
    # 按需最小接线 (PLAN-0.2.0.md M0 用户裁定 + PLAN-0.3.0.md M3):
    # 财务权威 + 分钟线/公告/EDB + fund (quote/kline/holdings/performance/info)
    # + index (quote/kline/fundamentals/basicinfo)。行情快照/日K(stock) 不烧 Wind
    # 积分 (DEGRADATION 主干表: quote/klines 主干 THS)。analytics 域出局 (决策门 B)。
    capabilities = frozenset(
        {
            "financials",
            "intraday",
            "announcements",
            "edb",
            "fund_quote",
            "fund_kline",
            "fund_holdings",
            "fund_performance",
            "fund_info",
            "index_quote",
            "index_kline",
            "index_fundamentals",
            "index_basicinfo",
        }
    )

    def __init__(
        self,
        api_key: str,
        *,
        endpoints: dict[str, str] | None = None,
        client: httpx.AsyncClient | None = None,
        error_map: dict[int | str, str] | None = None,
    ) -> None:
        self._key = api_key
        cfg = load_yaml("wind_tools.yaml")
        self._endpoints = endpoints or cfg["endpoints"]
        self._tool_by_domain = cfg["tool_by_domain"]
        self._period_map = cfg["kline_period_map"]
        self._edb_aliases = cfg.get("edb_execution_mode_aliases", {})
        self._client = client or httpx.AsyncClient(timeout=_CALL_TIMEOUT_S)
        self._owns_client = client is None
        self._error_map = error_map or load_error_map("wind")
        self._text_patterns = load_error_text_patterns("wind")
        self._lock = asyncio.Lock()  # 串行纪律 (Wind 官方默认串行, 上限 10)
        self._initialized: set[str] = set()  # 每 server 一次 initialize 握手

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    # ── plumbing: transport ────────────────────────────────────────────

    async def _rpc(self, server: str, tool: str, params: dict) -> dict:
        """Raw JSON-RPC call → parsed inner payload (`result.content[0].text`).

        Verified protocol (M0 live 核实, 2026-08-15): POST method="tools/call"
        with params={name, arguments}; initialize once per server first.
        Raises typed FinError with full context; never retries (router's job).
        """
        endpoint = self._endpoints.get(server)
        if endpoint is None:
            raise InternalError(
                f"Wind server {server!r} 未配置端点",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
            )
        headers = {
            "Authorization": f"Bearer {self._key}",
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        }
        async with self._lock:  # 串行纪律
            try:
                if server not in self._initialized:
                    await self._client.post(
                        endpoint,
                        json={
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "initialize",
                            "params": {
                                "protocolVersion": "2025-03-26",
                                "capabilities": {},
                                "clientInfo": {"name": "capital-generation", "version": "0.2.0"},
                            },
                        },
                        headers=headers,
                    )
                    self._initialized.add(server)
                resp = await self._client.post(
                    endpoint,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/call",
                        "params": {"name": tool, "arguments": params},
                    },
                    headers=headers,
                )
            except httpx.TimeoutException as e:
                raise FinTimeoutError(
                    f"Wind {server}.{tool} 超时 ({type(e).__name__})",
                    source=source_name(self.vendor_id),
                    vendor=self.vendor_id,
                    endpoint=server,
                ) from e
            except httpx.HTTPError as e:
                raise SourceDownError(
                    f"Wind {server}.{tool} 网络错误: {type(e).__name__}: {e}",
                    source=source_name(self.vendor_id),
                    vendor=self.vendor_id,
                    endpoint=server,
                ) from e

        if resp.status_code >= 400:
            self._raise_http(resp.status_code, f"{server}.{tool}", resp.text[:300])
        payload = self._parse_rpc_payload(resp.text, server, tool)
        if payload.get("error"):
            self._raise_classified(
                str(payload["error"].get("message") or payload["error"]),
                code=None,
                status=resp.status_code,
                endpoint=f"{server}.{tool}",
            )
        result = payload.get("result")
        if not isinstance(result, dict):
            raise InternalError(
                f"Wind {server}.{tool} 响应缺 result: {json.dumps(payload)[:300]}",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint=f"{server}.{tool}",
            )
        if result.get("isError"):
            msg = self._first_text(result) or json.dumps(result)[:300]
            self._raise_classified(
                msg, code=None, status=resp.status_code, endpoint=f"{server}.{tool}"
            )
        raw = self._first_text(result)
        if raw is None:
            raise InternalError(
                f"Wind {server}.{tool} 响应无 text content: {json.dumps(result)[:300]}",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint=f"{server}.{tool}",
            )
        try:
            inner = json.loads(raw)
        except ValueError:
            # 明文错误响应 (实测: fundamentals 无数据返回 "没找到数据")
            if not raw.strip():
                raise NoDataError(
                    f"Wind {server}.{tool} 空响应",
                    source=source_name(self.vendor_id),
                    vendor=self.vendor_id,
                    endpoint=f"{server}.{tool}",
                ) from None
            self._raise_classified(
                raw, code=None, status=resp.status_code, endpoint=f"{server}.{tool}"
            )
            raise AssertionError("unreachable") from None  # pragma: no cover
        if not isinstance(inner, dict):
            raise InternalError(
                f"Wind {server}.{tool} 内层非对象: {raw[:200]!r}",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
                endpoint=f"{server}.{tool}",
            )
        self._check_inner_error(inner, server, tool)
        return inner

    async def _rpc_raw(self, server: str, tool: str, params: dict) -> dict:
        """同 _rpc 但返回完整 JSON-RPC 信封 (fixture 录制用; 测试 MockTransport 回放)."""
        endpoint = self._endpoints.get(server)
        if endpoint is None:
            raise InternalError(
                f"Wind server {server!r} 未配置端点",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
            )
        headers = {
            "Authorization": f"Bearer {self._key}",
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        }
        async with self._lock:
            try:
                if server not in self._initialized:
                    await self._client.post(
                        endpoint,
                        json={
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "initialize",
                            "params": {
                                "protocolVersion": "2025-03-26",
                                "capabilities": {},
                                "clientInfo": {"name": "capital-generation", "version": "0.3.0"},
                            },
                        },
                        headers=headers,
                    )
                    self._initialized.add(server)
                resp = await self._client.post(
                    endpoint,
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "tools/call",
                        "params": {"name": tool, "arguments": params},
                    },
                    headers=headers,
                )
            except httpx.HTTPError as e:
                raise SourceDownError(
                    f"Wind {server}.{tool} 网络错误: {type(e).__name__}: {e}",
                    source=source_name(self.vendor_id),
                    vendor=self.vendor_id,
                    endpoint=server,
                ) from e
        return self._parse_rpc_payload(resp.text, server, tool)

    @staticmethod
    def _first_text(result: dict) -> str | None:
        for item in result.get("content", []):
            if isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text")
                if isinstance(text, str):
                    return text
        return None

    @staticmethod
    def _parse_rpc_payload(text: str, server: str, method: str) -> dict:
        trimmed = text.strip()
        if trimmed.startswith("{"):
            try:
                return json.loads(trimmed)
            except ValueError:
                pass
        last = None
        for line in text.splitlines():
            if line.startswith("data: "):
                try:
                    last = json.loads(line[6:])
                except ValueError:
                    continue
        if last is None:
            raise InternalError(
                f"Wind {server}.{method} 响应格式无法识别 (非 SSE 非 JSON): {text[:200]!r}",
                source=source_name("wind"),
                vendor="wind",
                endpoint=f"{server}.{method}",
            )
        return last

    def _check_inner_error(self, inner: dict, server: str, method: str) -> None:
        """inner.error / inner.data.code ≠ 0 → classified FinError."""
        endpoint = f"{server}.{method}"
        body = inner.get("data")
        # 业务码 (EDB 实测: {data: {code: 1003, message}}); 其余域无 code 字段
        if isinstance(body, dict):
            code = body.get("code")
            if isinstance(code, (int, float)) and code != 0:
                message = str(body.get("message") or f"code={code}")
                if server == "economic_data" and code == 1003:
                    self._raise_classified(message, code=1003, endpoint=endpoint)
                self._raise_classified(message, code=code, endpoint=endpoint)
        err = inner.get("error")
        if err and isinstance(err, dict) and (err.get("code") or err.get("message")):
            message = str(err.get("message") or err)
            # 显式空结果: data=null + QUERY_FAILED/没找到数据 → NO_DATA
            if body is None and re.search(r"没找到数据|QUERY_FAILED", message, re.IGNORECASE):
                raise NoDataError(
                    message,
                    source=source_name(self.vendor_id),
                    vendor=self.vendor_id,
                    endpoint=endpoint,
                    code=err.get("code"),
                )
            self._raise_classified(message, code=err.get("code"), endpoint=endpoint)

    def _raise_http(self, status: int, endpoint: str, body: str) -> None:
        # error_map 数字键为 int (load_error_map 转换); "5xx" 兜底
        kind = self._error_map.get(status) or (self._error_map.get("5xx") if status >= 500 else "")
        message = f"Wind HTTP {status} (server={endpoint})" + (f" | body: {body}" if body else "")
        cls = _KIND_TO_CLS.get(kind, InternalError)
        raise cls(
            message,
            source=source_name(self.vendor_id),
            vendor=self.vendor_id,
            endpoint=endpoint,
            status=status,
        )

    def _raise_classified(
        self,
        message: str,
        *,
        code: str | int | None,
        endpoint: str,
        status: int | None = None,
    ) -> None:
        """稳定码 → text_patterns 嗅探 → INTERNAL. Never returns."""
        text = str(message or "")
        kind = ""
        if code is not None:
            kind = self._error_map.get(str(code), "")
        if not kind:
            for pattern, k in self._text_patterns:
                if pattern.search(text):
                    kind = k
                    break
        if not kind:
            kind = "INTERNAL"
        cls = _KIND_TO_CLS.get(kind, InternalError)
        raise cls(
            text,
            source=source_name(self.vendor_id),
            vendor=self.vendor_id,
            endpoint=endpoint,
            status=status,
            code=code,
        )

    # ── 响应解析 (双形状: columnar / nested / EDB / RAG) ───────────────

    @staticmethod
    def _columnar(data: dict) -> tuple[list[str], list[list[object]], dict]:
        """{columns: [{name, type}], rows: [[...]], unit: {...}} → 解析."""
        headers = [c["name"] for c in data.get("columns", [])]
        rows = data.get("rows", [])
        if not isinstance(rows, list):
            raise InternalError(
                f"Wind columnar rows 非列表: {json.dumps(data)[:200]}",
                source=source_name("wind"),
                vendor="wind",
            )
        units = data.get("unit", {}) or {}
        return headers, rows, units

    @staticmethod
    def _fnum(v: object) -> float | None:
        """字符串数值 → float; INVALID/空 → None (空值纪律: 不补零不猜)."""
        if v is None or (isinstance(v, str) and (v.strip() in ("", "INVALID", "None"))):
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _iso_ms(value: str) -> int:
        """'2026-07-08T09:35:00.000+08:00' → Asia/Shanghai ms (显式时区, 无 mktime 陷阱)."""
        dt = datetime.fromisoformat(value)
        return int(dt.timestamp() * 1000)

    @staticmethod
    def _compact_date_ms(value: str) -> int:
        """'20260708' → Asia/Shanghai 零点 ms."""
        dt = datetime.strptime(value, _EDB_DATE_FMT).replace(tzinfo=TZ_CN)
        return int(dt.timestamp() * 1000)

    # ── financials ─────────────────────────────────────────────────────

    async def get_financials(
        self,
        symbol: str,
        statement: str,
        *,
        period: str = "annual",
        limit: int = 4,
        name: str = "",
    ) -> list[FinancialStatement]:
        """Wind 财务权威链头 (chains.yaml financials: [wind, ths, akshare]).

        - income/balance/cashflow: get_stock_fundamentals (NL 问句; 行 L3 透传,
          报告期在列名中标注, report_date_ms=None — 源未声明报告期)
        - indicators: get_stock_price_indicators (结构化截面; 估值默认只问
          市盈率(TTM), 市净率 0.000 陷阱 → extra 标注 + warnings 由 shell 呈现)
        """
        domain = self._tool_by_domain["financials"]
        if statement == "indicators":
            tool = domain["indicators"]
            inner = await self._rpc(
                tool["server"],
                tool["tool"],
                {
                    "windcode": symbol,
                    "indexes": tool["indexes"],
                },
            )
            headers, rows, units = self._columnar(inner["data"])
            statements = [
                FinancialStatement(
                    symbol=symbol,
                    statement="indicators",
                    report_date_ms=None,
                    rows=tuple(dict(zip(headers, row, strict=False)) for row in rows),
                    caliber="截面(时点)",
                    source=source_name(self.vendor_id),
                    tier="quota",
                    extra={
                        "units": units,
                        "note": "Wind 时点截面无报告期; 0.000 口径异常见 LESSONS",
                    },
                )
            ]
            return statements

        template = _FUNDAMENTALS_QUESTIONS[statement]
        question = template.format(
            symbol=symbol if not name else f"{name}（{symbol}）",
            period_label=_PERIOD_LABEL.get(period, ""),
            limit=limit,
        )
        tool = domain[statement]
        inner = await self._rpc(tool["server"], tool["tool"], {"question": question})
        body = inner["data"]
        # {data: {data: [{columns, rows}, ...]}} — NL 回答可能是多表
        tables = body.get("data", []) if isinstance(body, dict) else []
        out: list[FinancialStatement] = []
        for table in tables:
            headers, rows, units = self._columnar(table)
            out.append(
                FinancialStatement(
                    symbol=symbol,
                    statement=statement,
                    report_date_ms=None,
                    rows=tuple(dict(zip(headers, row, strict=False)) for row in rows),
                    caliber="Wind NL(报告期在列名, L3 标注不转换)",
                    source=source_name(self.vendor_id),
                    tier="quota",
                    extra={
                        "units": units,
                        "note": "Wind get_stock_fundamentals NL 回答; 口径以列名为准",
                    },
                )
            )
        return out

    # ── intraday (分钟线, Wind 独家) ───────────────────────────────────

    async def get_intraday(
        self, symbol: str, period: str, start_ms: int, end_ms: int
    ) -> list[Kline]:
        tool = self._tool_by_domain["intraday"]
        backend_period = self._period_map.get(period)
        if backend_period is None:
            raise ParamError(
                f"分钟线 period 仅支持 {sorted(self._period_map)}",
                source=source_name(self.vendor_id),
                vendor=self.vendor_id,
            )
        inner = await self._rpc(
            tool["server"],
            tool["tool"],
            {
                "windcode": symbol,
                "begin_date": ms_to_date(start_ms),
                "end_date": ms_to_date(end_ms),
                "period": backend_period,
                "aftype": "0",  # 前复权; Wind 无不复权字面量 (LESSONS §5.2)
            },
        )
        headers, rows, units = self._columnar(inner["data"])
        idx = {h: i for i, h in enumerate(headers)}
        bars: list[Kline] = []
        for row in rows:
            bars.append(
                Kline(
                    symbol=symbol,
                    date_ms=self._iso_ms(str(row[idx["TIME"]])),
                    open=self._fnum(row[idx["OPEN"]]) or 0.0,
                    high=self._fnum(row[idx["HIGH"]]) or 0.0,
                    low=self._fnum(row[idx["LOW"]]) or 0.0,
                    close=self._fnum(row[idx["MATCH"]]) or 0.0,
                    volume=self._fnum(row[idx["VOLUME"]]) or 0.0,
                    turnover=self._fnum(row[idx["TURNOVER"]]) or 0.0,
                    period=period,
                    adjust="forward",
                    source=source_name(self.vendor_id),
                    tier="quota",
                    extra={
                        "note": "Wind aftype=0 前复权; 分钟序列 Wind 独家无降级源",
                        "units": units,
                    },
                )
            )
        return bars

    # ── announcements (公告, Wind 独家 RAG) ────────────────────────────

    async def get_announcements(
        self, symbol: str, start_ms: int, end_ms: int, *, top_k: int = 10, name: str = ""
    ) -> list[Announcement]:
        tool = self._tool_by_domain["announcements"]
        query = _ANNOUNCEMENT_QUERY.format(
            name=name or symbol,
            symbol=symbol,
            start=ms_to_date(start_ms),
            end=ms_to_date(end_ms),
        )
        inner = await self._rpc(tool["server"], tool["tool"], {"query": query, "top_k": top_k})
        body = inner["data"]
        items = body.get("items", []) if isinstance(body, dict) else []
        out: list[Announcement] = []
        for it in items:
            out.append(
                Announcement(
                    symbol=symbol,
                    title=str(it.get("title", "")),
                    date_ms=date_to_ms(str(it.get("date", ""))[:10]) if it.get("date") else 0,
                    content=str(it.get("content", "")),
                    url=str(it.get("url", "")),
                    source=source_name(self.vendor_id),
                    tier="quota",
                    extra={
                        "doc_type": it.get("doc_type", ""),
                        "relevance": it.get("relevance"),
                    },
                )
            )
        return out

    # ── edb (宏观/行业指标; Wind 主干 + AKShare 白名单兜底) ────────────

    async def get_edb(
        self,
        indicator: str,
        start_ms: int | None = None,
        end_ms: int | None = None,
        *,
        observation: int = 10,
    ) -> list[EDBPoint]:
        tool = self._tool_by_domain["edb"]
        params: dict[str, object] = {
            "executionMode": "searchFetch",  # 搜索并提数
            "question": indicator,
        }
        if start_ms is not None and end_ms is not None:
            params["beginDate"] = ms_to_date(start_ms)
            params["endDate"] = ms_to_date(end_ms)
        else:
            params["observation"] = str(observation)
        inner = await self._rpc(tool["server"], tool["tool"], params)
        body = inner["data"]
        # {code: 0, data: [{meta, date[], value[]}]} — LESSONS §4.1 EDB 形状
        series = body.get("data", []) if isinstance(body, dict) else []
        out: list[EDBPoint] = []
        for s in series:
            meta = s.get("meta", {}) or {}
            dates = s.get("date", []) or []
            values = s.get("value", []) or []
            for d, v in zip(dates, values, strict=False):
                out.append(
                    EDBPoint(
                        indicator=str(meta.get("name") or indicator),
                        code=str(meta.get("code", "")),
                        date_ms=self._compact_date_ms(str(d)),
                        value=self._fnum(v),
                        unit=str(meta.get("unit", "")),
                        magnitude=str(meta.get("magnitude", "")),
                        freq=str(meta.get("freq", "")),
                        currency=str(meta.get("currency", "")),
                        source=source_name(self.vendor_id),
                        tier="quota",
                    )
                )
        return out

    # ── v0.3.0 fund 域 (M0 live 核实: .SZ/.SH/.OF 直通; question 类双形状) ──

    async def get_fund_quote(self, symbol: str) -> list[Kline]:
        """基金分钟行情 (仅当日单日; THS 快照不可用时的兜底, L3 标注差异)."""
        tool = self._tool_by_domain["fund"]["quote"]
        today = datetime.now(tz=TZ_CN).strftime("%Y-%m-%d")
        inner = await self._rpc(
            tool["server"],
            tool["tool"],
            {
                "windcode": symbol,
                "begin": today,
                "end": today,
            },
        )
        return self._bars(
            inner,
            symbol,
            period="1m",
            adjust="none",
            note="Wind 分钟行情 (仅当日); 场内快照主干 THS (仅 ETF)",
        )

    async def get_fund_kline(self, symbol: str, start_ms: int, end_ms: int) -> list[Kline]:
        """基金日K (Wind 兜底: 全类型; fund kline 无 VOLUME 列 → 0 + L3 标注)."""
        tool = self._tool_by_domain["fund"]["kline"]
        inner = await self._rpc(
            tool["server"],
            tool["tool"],
            {
                "windcode": symbol,
                "begin_date": ms_to_date(start_ms),
                "end_date": ms_to_date(end_ms),
                "period": self._period_map["1d"],
                "aftype": "0",  # 前复权 (Wind 无不复权字面量, LESSONS §5.2)
            },
        )
        return self._bars(
            inner,
            symbol,
            period="1d",
            adjust="forward",
            note="Wind aftype=0 前复权; fund kline 源未提供 volume/turnover",
        )

    async def get_fund_holdings(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        tool = self._tool_by_domain["fund"]["holdings"]
        return await self._question_statement(
            tool,
            symbol,
            "holdings",
            f"查询{self._label(symbol, name)}的前十大重仓股",
        )

    async def get_fund_performance(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        tool = self._tool_by_domain["fund"]["performance"]
        return await self._question_statement(
            tool,
            symbol,
            "performance",
            f"查询{self._label(symbol, name)}近一年业绩表现",
        )

    async def get_fund_info(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        tool = self._tool_by_domain["fund"]["info"]
        return await self._question_statement(
            tool,
            symbol,
            "info",
            f"查询{self._label(symbol, name)}的基本信息",
        )

    # ── v0.3.0 index 域 (M0 live 核实: 000300.SH/H11077.SH 直通 OK) ──────

    async def get_index_quote(self, symbols: Sequence[str]) -> list[Kline]:
        """指数分钟行情 (仅当日; 单标的逐次调用, 批量 ≤50 串行 — 积分纪律)."""
        tool = self._tool_by_domain["index"]["quote"]
        today = datetime.now(tz=TZ_CN).strftime("%Y-%m-%d")
        out: list[Kline] = []
        for symbol in symbols[:50]:
            inner = await self._rpc(
                tool["server"],
                tool["tool"],
                {
                    "windcode": symbol,
                    "begin": today,
                    "end": today,
                },
            )
            out.extend(
                self._bars(
                    inner,
                    symbol,
                    period="1m",
                    adjust="none",
                    note="Wind 指数分钟行情 (仅当日); 快照主干 THS",
                )
            )
        return out

    async def get_index_kline(self, symbol: str, start_ms: int, end_ms: int) -> list[Kline]:
        tool = self._tool_by_domain["index"]["kline"]
        inner = await self._rpc(
            tool["server"],
            tool["tool"],
            {
                "windcode": symbol,
                "begin_date": ms_to_date(start_ms),
                "end_date": ms_to_date(end_ms),
                "period": self._period_map["1d"],
                "aftype": "0",
            },
        )
        return self._bars(
            inner,
            symbol,
            period="1d",
            adjust="forward",
            note="Wind 指数日K (aftype=0 前复权; 指数无复权语义, 标注仅记录请求口径)",
        )

    async def get_index_fundamentals(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        tool = self._tool_by_domain["index"]["fundamentals"]
        label = name or symbol
        return await self._question_statement(
            tool,
            symbol,
            "fundamentals",
            f"查询{label}（{symbol}）的市盈率和市净率",
        )

    async def get_index_basicinfo(
        self, symbol: str, *, asset_type: str = "", name: str = "", limit: int = 10
    ) -> list[FinancialStatement]:
        tool = self._tool_by_domain["index"]["basicinfo"]
        label = name or symbol
        return await self._question_statement(
            tool,
            symbol,
            "basicinfo",
            f"查询{label}（{symbol}）的基本信息",
        )

    # ── 共享解析 (fund/index) ───────────────────────────────────────────

    @staticmethod
    def _label(symbol: str, name: str) -> str:
        """问句用名称优先; 无名称时用 symbol (基金 thscode 即 Wind 合法码)."""
        return name or symbol

    def _bars(
        self, inner: dict, symbol: str, *, period: str, adjust: str, note: str
    ) -> list[Kline]:
        """columnar 分钟/日K → list[Kline]; VOLUME/TURNOVER 缺失时 0 + 标注 (空值纪律)."""
        headers, rows, units = self._columnar(inner["data"])
        idx = {h: i for i, h in enumerate(headers)}
        has_vol = "VOLUME" in idx
        has_turn = "TURNOVER" in idx
        bars: list[Kline] = []
        for row in rows:
            bars.append(
                Kline(
                    symbol=symbol,
                    date_ms=self._iso_ms(str(row[idx["TIME"]])),
                    open=self._fnum(row[idx["OPEN"]]) or 0.0,
                    high=self._fnum(row[idx["HIGH"]]) or 0.0,
                    low=self._fnum(row[idx["LOW"]]) or 0.0,
                    close=self._fnum(row[idx["MATCH"]]) or 0.0,
                    volume=self._fnum(row[idx["VOLUME"]]) if has_vol else 0.0,
                    turnover=self._fnum(row[idx["TURNOVER"]]) if has_turn else 0.0,
                    period=period,
                    adjust=adjust,
                    source=source_name(self.vendor_id),
                    tier="quota",
                    extra={
                        "note": note,
                        "units": units,
                        "volume_unavailable": not has_vol,
                        "turnover_unavailable": not has_turn,
                    },
                )
            )
        return bars

    async def _question_statement(
        self, tool: dict, symbol: str, statement: str, question: str
    ) -> list[FinancialStatement]:
        """question 类工具 (NL 回答, 多表嵌套形状) → FinancialStatement 行 L3 透传."""
        inner = await self._rpc(tool["server"], tool["tool"], {"question": question})
        body = inner["data"]
        tables = body.get("data", []) if isinstance(body, dict) else []
        out: list[FinancialStatement] = []
        for table in tables:
            headers, rows, units = self._columnar(table)
            out.append(
                FinancialStatement(
                    symbol=symbol,
                    statement=statement,
                    report_date_ms=None,
                    rows=tuple(dict(zip(headers, row, strict=False)) for row in rows),
                    caliber="Wind NL(报告期/口径在列名, L3 标注不转换)",
                    source=source_name(self.vendor_id),
                    tier="quota",
                    extra={"units": units, "note": f"Wind {tool['tool']} NL 回答; 口径以列名为准"},
                )
            )
        return out


__all__ = ["WindAdapter"]
