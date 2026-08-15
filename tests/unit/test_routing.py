"""M5: routing behavior — chains, failover, backoff, breaker, QUOTA gate, cache.

docs/DEGRADATION.md 判定表 applied with scripted fake adapters (offline).
"""

from __future__ import annotations

from typing import Any

import pytest

from core.adapters.base import BaseAdapter
from core.domain.errors import (
    AuthError,
    NoDataError,
    ParamError,
    QuotaError,
    RateLimitError,
    SourceDownError,
)
from core.domain.models import Envelope, Quote
from core.domain.routing import Cache, QuotaGate, Router
from core.domain.units import now_ms


class FakeAdapter(BaseAdapter):
    vendor_id = "fake"

    def __init__(self, behavior: dict[str, Any]) -> None:
        self.behavior = behavior
        self.calls: list[str] = []

    async def _hit(self, key: str) -> Any:
        self.calls.append(key)
        b = self.behavior.get(key, self.behavior.get("default"))
        if isinstance(b, Exception):
            raise b
        if callable(b):
            return b()
        return b

    async def search_symbols(self, query: str, *, market: str | None = None, limit: int = 10):
        return await self._hit("search")

    async def get_quote(self, symbols):
        return await self._hit("quote")

    async def get_klines(self, symbol, start_ms, end_ms, *, adjust="none"):
        return await self._hit("klines")

    async def get_financials(self, symbol, statement, *, period="annual", limit=4):
        return await self._hit("financials")

    async def get_calendar(self):
        return await self._hit("calendar")

    async def get_special_data(self, kind, **params):
        return await self._hit("special")


def ok_quote() -> list[Quote]:
    return [
        Quote(
            symbol="600519.SH", last_price=1.0, open_price=None, high_price=None,
            low_price=None, prev_close=None, change_pct=None, volume=1, turnover=1,
            as_of_ms=now_ms(), source="同花顺",
        )
    ]


def make_router(
    behaviors: dict[str, dict[str, Any]],
    chains: dict[str, list[str]] | None = None,
    *,
    cache: Cache | None = None,
) -> Router:
    adapters = {vid: FakeAdapter(b) for vid, b in behaviors.items()}
    return Router(adapters, chains=chains or {"quote": list(behaviors)}, cache=cache)


class TestChainOrder:
    @pytest.mark.asyncio
    async def test_first_source_wins(self) -> None:
        r = make_router({"ths": {"quote": ok_quote()}, "akshare": {"quote": ok_quote()}})
        env = await r.call("quote", symbols=["600519.SH"])
        assert env.data[0].source == "同花顺"
        assert env.warnings == ()
        assert r._adapters["ths"].calls == ["quote"]
        assert r._adapters["akshare"].calls == []

    @pytest.mark.asyncio
    async def test_failover_on_source_down(self) -> None:
        r = make_router(
            {
                "ths": {"quote": SourceDownError("5xx", vendor="ths")},
                "akshare": {"quote": ok_quote()},
            }
        )
        env = await r.call("quote", symbols=["600519.SH"])
        assert r._adapters["ths"].calls == ["quote"]
        assert r._adapters["akshare"].calls == ["quote"]  # failover 到 akshare
        assert any("降级" in w for w in env.warnings)

    @pytest.mark.asyncio
    async def test_envelope_carries_query_time(self) -> None:
        r = make_router({"ths": {"quote": ok_quote()}})
        env = await r.call("quote", symbols=["600519.SH"])
        assert isinstance(env, Envelope)
        assert env.ts_ms > 0


class TestErrorClasses:
    @pytest.mark.asyncio
    async def test_auth_raises_immediately_no_failover(self) -> None:
        r = make_router(
            {
                "ths": {"quote": AuthError("bad key", vendor="ths")},
                "akshare": {"quote": ok_quote()},
            }
        )
        with pytest.raises(AuthError):
            await r.call("quote", symbols=["600519.SH"])

    @pytest.mark.asyncio
    async def test_param_raises_immediately(self) -> None:
        r = make_router({"ths": {"quote": ParamError("bad param")}})
        with pytest.raises(ParamError):
            await r.call("quote", symbols=["600519.SH"])

    @pytest.mark.asyncio
    async def test_no_data_returns_empty_with_warnings(self) -> None:
        r = make_router(
            {
                "ths": {"quote": NoDataError("标的不存在", code=3001)},
                "akshare": {"quote": NoDataError("no data")},
            }
        )
        env = await r.call("quote", symbols=["999999.SH"])
        assert env.data == []
        assert env.warnings

    @pytest.mark.asyncio
    async def test_rate_limit_backoff_then_raise_no_switch(self) -> None:
        calls = {"n": 0}

        def flaky() -> Any:
            calls["n"] += 1
            raise RateLimitError("4001", code=4001)

        r = make_router(
            {"ths": {"quote": flaky}, "akshare": {"quote": ok_quote()}},
            chains={"quote": ["ths", "akshare"]},
        )
        import time

        t0 = time.monotonic()
        with pytest.raises(RateLimitError):
            await r.call("quote", symbols=["600519.SH"])
        elapsed = time.monotonic() - t0
        assert calls["n"] == 3  # 首次 + 2 次退避重试
        assert elapsed >= 0.6  # 200ms + 400ms
        # 不换源: akshare 未被调用
        assert r._adapters["akshare"].calls == []


class TestQuotaGate:
    @pytest.mark.asyncio
    async def test_quota_raises_and_disables(self) -> None:
        r = make_router(
            {
                "ths": {"quote": QuotaError("积分不足", vendor="wind")},
                "akshare": {"quote": ok_quote()},
            },
            chains={"quote": ["ths", "akshare"]},
        )
        with pytest.raises(QuotaError):
            await r.call("quote", symbols=["600519.SH"])
        assert r._gate.disabled("ths")

    @pytest.mark.asyncio
    async def test_gate_auto_resets_after_ttl(self) -> None:
        gate = QuotaGate(ttl_ms=-1)  # 已过期
        gate.disable("wind", "exhausted")
        assert not gate.disabled("wind")  # 到期自动恢复
    @pytest.mark.asyncio
    async def test_disabled_vendor_skipped_with_warning(self) -> None:
        r = make_router(
            {"ths": {"quote": ok_quote()}, "akshare": {"quote": ok_quote()}},
            chains={"quote": ["ths", "akshare"]},
        )
        r._gate.disable("ths", "测试门控")
        env = await r.call("quote", symbols=["600519.SH"])
        assert r._adapters["ths"].calls == []  # 门控跳过
        assert r._adapters["akshare"].calls == ["quote"]
        assert any("门控" in w for w in env.warnings)


class TestBreaker:
    @pytest.mark.asyncio
    async def test_open_after_threshold_skips_vendor(self) -> None:
        r = make_router(
            {"ths": {"quote": SourceDownError("5xx")}, "akshare": {"quote": ok_quote()}},
            chains={"quote": ["ths", "akshare"]},
            cache=Cache(max_entries=1024),
        )
        # 缓存会吸收同参查询 → 用不同参数制造连续 live 失败
        for i in range(5):  # 连续失败 5 次 → 熔断
            env = await r.call("quote", symbols=[f"6005{i:02d}.SH"])
            assert r._adapters["akshare"].calls[-1] == "quote"
        r._adapters["ths"].behavior["quote"] = ok_quote()  # 源恢复
        env = await r.call("quote", symbols=["999999.SH"])
        assert any("熔断" in w for w in env.warnings)  # 冷却期内跳过
        assert len(r._adapters["ths"].calls) == 5  # 前 5 次失败已计数, 第 6 次被熔断跳过

    @pytest.mark.asyncio
    async def test_success_resets_breaker(self) -> None:
        r = make_router({"ths": {"quote": ok_quote()}}, chains={"quote": ["ths"]})
        r._breaker.record_failure("ths")
        r._breaker.record_failure("ths")
        r._breaker.record_success("ths")
        assert not r._breaker.open("ths")


class TestCache:
    @pytest.mark.asyncio
    async def test_quote_cached_within_ttl(self) -> None:
        r = make_router({"ths": {"quote": ok_quote()}}, chains={"quote": ["ths"]})
        await r.call("quote", symbols=["600519.SH"])
        await r.call("quote", symbols=["600519.SH"])
        assert len(r._adapters["ths"].calls) == 1  # 第二次命中缓存

    @pytest.mark.asyncio
    async def test_cache_misses_on_different_params(self) -> None:
        r = make_router({"ths": {"quote": ok_quote()}}, chains={"quote": ["ths"]})
        await r.call("quote", symbols=["600519.SH"])
        await r.call("quote", symbols=["000001.SZ"])
        assert len(r._adapters["ths"].calls) == 2

    @pytest.mark.asyncio
    async def test_cache_lru_eviction(self) -> None:
        cache = Cache(max_entries=2)
        cache.put("quote", {"a": 1}, Envelope(data=1, ts_ms=1))
        cache.put("quote", {"b": 2}, Envelope(data=2, ts_ms=1))
        cache.put("quote", {"c": 3}, Envelope(data=3, ts_ms=1))
        assert cache.get("quote", {"a": 1}) is None  # 最久未用被淘汰
        assert cache.get("quote", {"c": 3}) is not None
