"""M1: FinError taxonomy behavior (docs/DEGRADATION.md 判定表)."""

from core.domain.errors import (
    AuthError,
    FinError,
    NoDataError,
    ParamError,
    QuotaError,
    RateLimitError,
    SourceDownError,
)


def test_auth_is_not_retryable() -> None:
    err = AuthError("bad key", vendor="ths", status=401)
    assert err.kind == "AUTH"
    assert not err.retryable
    assert err.status == 401


def test_param_not_retryable() -> None:
    err = ParamError("bad param", vendor="ths", code=1002)
    assert err.kind == "PARAM"
    assert not err.retryable
    assert err.code == 1002


def test_rate_limit_retryable() -> None:
    err = RateLimitError("throttled", vendor="ths", code=4001)
    assert err.kind == "RATE_LIMIT"
    assert err.retryable


def test_no_data_retryable_and_request_id() -> None:
    err = NoDataError("暂不可得", vendor="ths", code=3002, request_id="req-1")
    assert err.kind == "NO_DATA"
    assert err.retryable
    assert err.request_id == "req-1"


def test_source_down_retryable() -> None:
    assert SourceDownError("5xx").retryable


def test_quota_not_retryable() -> None:
    err = QuotaError("积分不足", vendor="wind")
    assert err.kind == "QUOTA"
    assert not err.retryable


def test_subclass_kind_distinct() -> None:
    kinds = {cls.kind for cls in FinError.__subclasses__()}
    assert kinds == {
        "AUTH",
        "PARAM",
        "RATE_LIMIT",
        "TIMEOUT",
        "NO_DATA",
        "SOURCE_DOWN",
        "QUOTA",
        "INTERNAL",
    }


def test_as_dict_has_full_context() -> None:
    d = AuthError(
        "nope", vendor="ths", endpoint="/api/a-share/prices/snapshot", code=2003
    ).as_dict()
    assert d["vendor"] == "ths"
    assert d["endpoint"] == "/api/a-share/prices/snapshot"
    assert d["code"] == 2003
    assert d["kind"] == "AUTH"
