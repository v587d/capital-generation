"""Routing layer — degradation chains, backoff, circuit breaker, QUOTA gate, cache.

docs/DEGRADATION.md 判定表, applied here (adapters never retry):
- AUTH / PARAM / QUOTA → return immediately (no retry, no source switch).
  QUOTA additionally disables the vendor for 1 day (对齐 Wind 每日积分重置), auto-reset.
- RATE_LIMIT → exponential backoff on the SAME source (200ms ×2, cap 3), then raise.
- TIMEOUT / SOURCE_DOWN → record failure, try next source in chain.
- NO_DATA → try next source once; if the whole chain ends on NO_DATA, return empty
  (not an error) with warnings.
- Circuit breaker: ≥5 consecutive failures per vendor → 60s cooldown (skip + warn).
- Degradation is always observable: warnings[] on the envelope, source 规范名 on results.
- Cache: quote 30s TTL; klines/calendar/financials/special 当日; LRU cap.
"""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from core.adapters.base import BaseAdapter
from core.config import load_chains
from core.domain.errors import FinError, InternalError, ParamError, RateLimitError
from core.domain.models import Envelope
from core.domain.units import now_ms, source_name

_DAY_MS = 86_400_000
_BACKOFF_MS = (200, 400)  # RATE_LIMIT 退避序列 (×2), cap 3 tries 含首次
_BREAKER_THRESHOLD = 5
_BREAKER_COOLDOWN_S = 60.0

# domain → adapter method (v0.1.0 六个 + v0.2.0 intraday/announcements/edb
# + v0.3.0 fund/index 十二域, PLAN-0.3.0.md M3/M4)
_METHODS: dict[str, str] = {
    "search": "search_symbols",
    "quote": "get_quote",
    "klines": "get_klines",
    "financials": "get_financials",
    "calendar": "get_calendar",
    "special": "get_special_data",
    "intraday": "get_intraday",
    "announcements": "get_announcements",
    "edb": "get_edb",
    "fund_quote": "get_fund_quote",
    "fund_nav": "get_fund_nav",
    "fund_kline": "get_fund_kline",
    "fund_holdings": "get_fund_holdings",
    "fund_holders": "get_fund_holders",
    "fund_performance": "get_fund_performance",
    "fund_info": "get_fund_info",
    "index_quote": "get_index_quote",
    "index_kline": "get_index_kline",
    "index_constituents": "get_index_constituents",
    "index_fundamentals": "get_index_fundamentals",
    "index_basicinfo": "get_index_basicinfo",
}

# 缓存 TTL (ms): 快照 30s, 其余当日
_CACHE_TTL_MS = {"quote": 30_000, "fund_quote": 30_000, "index_quote": 30_000}


class Cache:
    """TTL + LRU cache keyed by (domain, frozen kwargs)."""

    def __init__(self, max_entries: int = 1024) -> None:
        self._max = max_entries
        self._store: OrderedDict[
            tuple[str, tuple[tuple[str, Any], ...]], tuple[float, Envelope]
        ] = OrderedDict()

    @staticmethod
    def _key(domain: str, kwargs: dict[str, Any]) -> tuple[str, tuple[tuple[str, Any], ...]]:
        return (domain, tuple(sorted((k, repr(v)) for k, v in kwargs.items())))

    def get(self, domain: str, kwargs: dict[str, Any]) -> Envelope | None:
        key = self._key(domain, kwargs)
        hit = self._store.get(key)
        if hit is None:
            return None
        expires_at, env = hit
        if expires_at < now_ms():
            del self._store[key]
            return None
        self._store.move_to_end(key)
        return env

    def put(self, domain: str, kwargs: dict[str, Any], env: Envelope) -> None:
        ttl = _CACHE_TTL_MS.get(domain, _ttl_until_midnight())
        self._store[self._key(domain, kwargs)] = (now_ms() + ttl, env)
        while len(self._store) > self._max:
            self._store.popitem(last=False)


def _ttl_until_midnight() -> int:
    from core.domain.units import TZ_CN

    now = datetime.now(tz=TZ_CN)
    midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((midnight - now).total_seconds() * 1000)


@dataclass
class Breaker:
    """连续失败 ≥5 → 冷却 60s; 成功即复位."""

    threshold: int = _BREAKER_THRESHOLD
    cooldown_s: float = _BREAKER_COOLDOWN_S
    _failures: dict[str, int] = field(default_factory=dict)
    _opened_until: dict[str, float] = field(default_factory=dict)

    def open(self, vendor_id: str) -> bool:
        until = self._opened_until.get(vendor_id, 0.0)
        if until and until < time.monotonic():
            del self._opened_until[vendor_id]  # 冷却结束自动复位
            self._failures[vendor_id] = 0
        return until >= time.monotonic()

    def record_failure(self, vendor_id: str) -> None:
        n = self._failures.get(vendor_id, 0) + 1
        self._failures[vendor_id] = n
        if n >= self.threshold:
            self._opened_until[vendor_id] = time.monotonic() + self.cooldown_s
            self._failures[vendor_id] = 0

    def record_success(self, vendor_id: str) -> None:
        self._failures.pop(vendor_id, None)
        self._opened_until.pop(vendor_id, None)


@dataclass
class QuotaGate:
    """QUOTA 门控: Disable 后 TTL 1 天自动恢复 (docs/DEGRADATION.md QUOTA 行).

    不允许"降级一次后永久按降级处理" — 到期复位, 再次耗尽再次降级.
    """

    ttl_ms: int = _DAY_MS
    _until: dict[str, int] = field(default_factory=dict)
    _reasons: dict[str, str] = field(default_factory=dict)

    def disabled(self, vendor_id: str) -> bool:
        until = self._until.get(vendor_id, 0)
        if until and until < now_ms():
            self._until.pop(vendor_id, None)  # 到期自动恢复
            self._reasons.pop(vendor_id, None)
        return vendor_id in self._until

    def disable(self, vendor_id: str, reason: str) -> None:
        self._until[vendor_id] = now_ms() + self.ttl_ms
        self._reasons[vendor_id] = reason

    def reason(self, vendor_id: str) -> str:
        return self._reasons.get(vendor_id, "quota")


class Router:
    def __init__(
        self,
        adapters: dict[str, BaseAdapter],
        *,
        chains: dict[str, list[str]] | None = None,
        cache: Cache | None = None,
    ) -> None:
        self._adapters = adapters
        self._chains = chains or load_chains()
        self._cache = cache or Cache()
        self._breaker = Breaker()
        self._gate = QuotaGate()

    @property
    def adapters(self) -> dict[str, BaseAdapter]:
        """Exposed for the reconcile engine (双源直取, 绕链 — PLAN-0.2.0.md M4)."""
        return self._adapters

    async def call(self, domain: str, **kwargs: Any) -> Envelope:
        method = _METHODS.get(domain)
        if method is None:
            raise ParamError(f"unknown domain: {domain}")
        chain = self._chains.get(domain, [])
        if not chain:
            raise InternalError(f"no chain configured for domain {domain}")

        cached = self._cache.get(domain, kwargs)
        if cached is not None:
            return cached

        warnings: list[str] = []
        last_error: FinError | None = None
        for vendor_id in chain:
            if self._gate.disabled(vendor_id):
                warnings.append(f"{source_name(vendor_id)} 配额门控中 (1 天内自动恢复)")
                continue
            if self._breaker.open(vendor_id):
                warnings.append(f"{source_name(vendor_id)} 熔断冷却中, 跳过")
                continue
            adapter = self._adapters.get(vendor_id)
            if adapter is None:
                continue
            if not adapter.supports(domain):
                # 链上存在但无此能力的源 (能力化表面, PLAN-0.2.0.md M1): 跳过
                continue
            try:
                data = await self._invoke(adapter, method, kwargs, vendor_id, warnings)
                self._breaker.record_success(vendor_id)
                env = Envelope(data=data, ts_ms=now_ms(), warnings=tuple(warnings))
                self._cache.put(domain, kwargs, env)
                return env
            except FinError as e:
                last_error = e
                if e.kind in ("AUTH", "PARAM", "INTERNAL"):
                    raise  # 不重试、不换源
                if e.kind == "QUOTA":
                    self._gate.disable(vendor_id, e.message)
                    warnings.append(f"{source_name(vendor_id)} 配额耗尽, 门控 1 天")
                    raise  # QUOTA: 立即返回, 不换源 (DEGRADATION)
                if e.kind == "RATE_LIMIT":
                    # 退避重试同源, 不换源; 仍失败 → 返回限流错误
                    backoff = await self._retry_rate_limit(adapter, method, kwargs, vendor_id)
                    if backoff is not None:
                        self._breaker.record_success(vendor_id)
                        env = Envelope(data=backoff, ts_ms=now_ms(), warnings=tuple(warnings))
                        self._cache.put(domain, kwargs, env)
                        return env
                    raise
                # TIMEOUT / NO_DATA / SOURCE_DOWN → 换源
                self._breaker.record_failure(vendor_id)
                warnings.append(f"{source_name(vendor_id)} 失败 ({e.kind}), 降级")
            except Exception as e:  # noqa: BLE001 — adapter 必须抛 FinError; 兜底
                raise InternalError(
                    f"{source_name(vendor_id)} 未分类异常: {type(e).__name__}: {e}",
                    source=source_name(vendor_id),
                    vendor=vendor_id,
                ) from e

        if last_error is not None and last_error.kind == "NO_DATA":
            # 全链 NO_DATA → 返回空结果 + 说明 (DEGRADATION)
            empty = self._empty_for(domain)
            return Envelope(data=empty, ts_ms=now_ms(), warnings=tuple(warnings))
        if last_error is not None:
            raise last_error
        raise InternalError(f"chain for {domain} exhausted with no result")

    async def _invoke(
        self,
        adapter: BaseAdapter,
        method: str,
        kwargs: dict[str, Any],
        vendor_id: str,
        warnings: list[str],
    ) -> Any:
        fn: Callable[..., Any] = getattr(adapter, method)
        return await fn(**kwargs)

    async def _retry_rate_limit(
        self, adapter: BaseAdapter, method: str, kwargs: dict[str, Any], vendor_id: str
    ) -> Any:
        """RATE_LIMIT: 指数退避 ×2 (200/400ms), 最多 3 次尝试; 不换源."""
        for delay_ms in _BACKOFF_MS:
            await _sleep(delay_ms / 1000)
            try:
                return await self._invoke(adapter, method, kwargs, vendor_id, [])
            except RateLimitError:
                continue
        return None

    @staticmethod
    def _empty_for(domain: str) -> Any:
        return []  # 全链 NO_DATA → 空结果 (Envelope 带 warnings 说明)


async def _sleep(s: float) -> None:
    await asyncio.sleep(s)


def default_router(adapters: dict[str, BaseAdapter]) -> Router:
    return Router(adapters)
