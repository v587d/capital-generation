"""Returns and risk for one price series (the "series" input shape of the module protocol).

Input is one Dataset with a time column and a positive price column, plus an optional benchmark
series. Every output is a stated formula over those rows — the module does not forecast, score,
rate or recommend, and it never fills a missing observation with zero. A bad price row is skipped
and reported as a gap; a duplicate or mixed-format time axis is an input error, because silently
picking one row would make every downstream number look sourced when it is not.

Pure standard library on purpose: no numpy/pandas, so the arithmetic is auditable line by line and
the module runs on the minimal analysis runtime.

Protocol: `docs/dev/senior-analysis.md` §1.9. Conclusions and claims belong to the senior analyst;
this module only produces reproducible risk figures plus the inputs behind each one.
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone

MODULE_ID = "returns_risk"
MODULE_VERSION = "1.0.0"
OUTPUT_NAME = "risk_metrics"

PERIODS_PER_YEAR_DEFAULT = 252
CONFIDENCE_DEFAULT = 0.95
MIN_RETURNS_FOR_STABLE = 30

ASSUMPTIONS = [
    "价格口径沿用 Dataset 的取数参数（qfq / hfq / none），本模块不检测也不做复权调整",
    "年化用参数 periods_per_year（默认 252）与样本内几何收益；日历天数不参与年化",
    "波动率是日收益样本标准差（ddof=1）× sqrt(periods_per_year)",
    "夏普 / 索提诺 =（年化收益 − risk_free_rate）/ 对应年化风险；risk_free_rate 为年化小数，省略时按 0 披露",
    "VaR / CVaR 为历史法单期损失（正数 = 亏损幅度），置信度取参数",
    "停牌或平盘日的价格重复会形成 0 收益，按原序列计入，不剔除",
    "beta / 相关按重叠交易日的日收益计算；基准与标的不同复权口径时 beta 有偏",
]

LIMITATIONS = [
    "历史风险不预测未来：样本期之外的波动、回撤与尾部损失可能显著更大",
    "样本越短年化指标越不稳定；少于 30 个收益观测时只能当作方向性参考",
    "不处理分红再投资、交易成本、停牌期间的机会成本与流动性折价",
    "数值时间轴按参数 timezone 标注日历日（省略按 UTC）；跨市场比较前先对齐时区",
    "不构成投资建议，也不产生评级、目标价或收益承诺",
]

PRICE_COLUMNS = ("close", "adj_close", "close_price", "price", "nav")
TIME_COLUMNS = ("trade_date_ms", "date_ms", "period_end_ms", "datetime", "date", "trade_date", "time")
ISO_DAY = re.compile(r"^(\d{4}-\d{2}-\d{2})")


class AnalysisInputError(Exception):
    """The input cannot be used at all; the host maps `analysis_code` to the stable protocol code."""

    analysis_code = "analysis_input_invalid"


def _round(value):
    rounded = round(float(value), 6)
    return 0.0 if rounded == 0 else rounded


def _number(row, name):
    if row is None:
        return None
    value = row.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _columns_of(view):
    columns = view.get("columns") or []
    names = {item.get("name") for item in columns if isinstance(item, dict)}
    for row in (view.get("rows") or [])[:1]:
        if isinstance(row, dict):
            names |= set(row)
    return names


def _text(value):
    return value if isinstance(value, str) and value.strip() else None


def _timezone(name):
    """IANA zone when the caller names one; UTC otherwise (the dataset tz is not authoritative)."""
    if name is None:
        return timezone.utc
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception as error:  # noqa: BLE001 - any load failure is a caller error
        raise AnalysisInputError(f"timezone={name!r} 无法加载（需要 IANA 时区名，如 Asia/Shanghai）") from error


def _time_column(view, override):
    names = _columns_of(view)
    if override is not None:
        if override not in names:
            raise AnalysisInputError(f"time_column={override} 不在 Dataset 的列里：可选 {sorted(names)}")
        return override
    axis = (view.get("time_axis") or {}).get("column")
    if isinstance(axis, str) and axis in names:
        return axis
    for name in TIME_COLUMNS:
        if name in names:
            return name
    raise AnalysisInputError(
        "找不到时间列：需要 time_coverage 列，或 trade_date_ms / date_ms / period_end_ms / datetime / date / trade_date 之一"
    )


def _price_column(view, override):
    names = _columns_of(view)
    if override is not None:
        if override not in names:
            raise AnalysisInputError(f"price_column={override} 不在 Dataset 的列里：可选 {sorted(names)}")
        return override
    for name in PRICE_COLUMNS:
        if name in names:
            return name
    raise AnalysisInputError(
        "找不到价格列：需要 close / adj_close / close_price / price / nav 之一（或用 price_column 指明）"
    )


def _parse_time(value, tz):
    """Return `(sort_key, day_label)`; `None` when the value is not a usable time."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        if number != number or number in (float("inf"), float("-inf")):
            return None
        stamp = datetime.fromtimestamp(number / 1000.0, tz=tz)
        return number, stamp.strftime("%Y-%m-%d")
    if isinstance(value, str):
        match = ISO_DAY.match(value.strip())
        if match is None:
            return None
        day = match.group(1)
        try:
            stamp = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            return None
        return stamp.timestamp() * 1000.0, day
    return None


def _series(view, dataset_id, price_column, time_column, tz):
    rows = view.get("rows") or []
    if not rows:
        raise AnalysisInputError(f"Dataset {dataset_id} 没有数据行：无法计算收益与风险")
    points, dropped, kind = [], [], None
    for row in rows:
        if not isinstance(row, dict):
            raise AnalysisInputError(f"Dataset {dataset_id} 的数据行不是对象：无法计算")
        raw_time = row.get(time_column)
        row_kind = "ms" if isinstance(raw_time, (int, float)) and not isinstance(raw_time, bool) else "date"
        if kind is None:
            kind = row_kind
        elif row_kind != kind:
            raise AnalysisInputError(
                f"Dataset {dataset_id} 的 {time_column} 列混用了数值时间戳与日期字符串：无法排序，请取数时统一"
            )
        parsed = _parse_time(raw_time, tz)
        price = _number(row, price_column)
        if parsed is None or price is None or price <= 0:
            dropped.append(raw_time)
            continue
        key, day = parsed
        points.append({"key": key, "day": day, "price": price})
    points.sort(key=lambda item: item["key"])
    seen = set()
    for point in points:
        if point["day"] in seen:
            raise AnalysisInputError(
                f"Dataset {dataset_id} 在 {point['day']} 出现多行：无法判断用哪一行（请先去重）"
            )
        seen.add(point["day"])
    return points, dropped


def _quantile(values, q):
    if not values:
        return None
    position = (len(values) - 1) * q
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return values[lower]
    weight = position - lower
    return values[lower] * (1.0 - weight) + values[upper] * weight


def _variance(values):
    mean = sum(values) / len(values)
    return sum((value - mean) ** 2 for value in values) / (len(values) - 1), mean


def _risk(points, periods_per_year, risk_free_rate, confidence):
    closes = [point["price"] for point in points]
    returns = [closes[index] / closes[index - 1] - 1.0 for index in range(1, len(closes))]
    count = len(returns)
    total_return = closes[-1] / closes[0] - 1.0
    annualized_return = (1.0 + total_return) ** (periods_per_year / count) - 1.0
    variance, mean_return = _variance(returns)
    annualized_volatility = math.sqrt(variance) * math.sqrt(periods_per_year)

    peak, max_drawdown = closes[0], 0.0
    for close in closes:
        peak = max(peak, close)
        max_drawdown = min(max_drawdown, close / peak - 1.0)

    sharpe = (annualized_return - risk_free_rate) / annualized_volatility if annualized_volatility > 0 else None
    downside = math.sqrt(sum(min(value, 0.0) ** 2 for value in returns) / count) * math.sqrt(periods_per_year)
    sortino = (annualized_return - risk_free_rate) / downside if downside > 0 else None
    calmar = annualized_return / abs(max_drawdown) if max_drawdown < 0 else None

    ordered = sorted(returns)
    quantile = _quantile(ordered, 1.0 - confidence)
    var = 0.0 if quantile is None or quantile >= 0 else -quantile
    tail = [value for value in returns if quantile is not None and value <= quantile]
    cvar = -sum(tail) / len(tail) if tail and quantile is not None and quantile < 0 else 0.0

    metrics = {
        "observations": len(points),
        "returns_count": count,
        "total_return": _round(total_return),
        "annualized_return": _round(annualized_return),
        "annualized_volatility": _round(annualized_volatility),
        "max_drawdown": _round(max_drawdown),
        "mean_daily_return": _round(mean_return),
        "best_day": _round(max(returns)),
        "worst_day": _round(min(returns)),
        "positive_day_ratio": _round(sum(1 for value in returns if value > 0) / count),
        "var": _round(var),
        "cvar": _round(cvar),
        "confidence": confidence,
        "risk_free_rate": risk_free_rate,
        "annualization": periods_per_year,
    }
    for name, value in (("sharpe_ratio", sharpe), ("sortino_ratio", sortino), ("calmar_ratio", calmar)):
        if value is not None:
            metrics[name] = _round(value)
    return metrics, returns


def _benchmark(points, bench_day_prices):
    common = [point for point in points if point["day"] in bench_day_prices]
    overlap = len(common) - 1
    if overlap < 2:
        return None, f"基准与价格序列重叠少于 2 个日收益（实际 {max(overlap, 0)}）：beta / 相关未计算"
    asset_returns, bench_returns = [], []
    for previous, current in zip(common, common[1:]):
        asset_returns.append(current["price"] / previous["price"] - 1.0)
        bench_returns.append(bench_day_prices[current["day"]] / bench_day_prices[previous["day"]] - 1.0)
    bench_variance, bench_mean = _variance(bench_returns)
    asset_variance, asset_mean = _variance(asset_returns)
    if bench_variance <= 0 or asset_variance <= 0:
        return None, "基准或标的在重叠窗口内零波动：beta / 相关无经济含义，未计算"
    covariance = sum(
        (asset - asset_mean) * (bench - bench_mean)
        for asset, bench in zip(asset_returns, bench_returns)
    ) / (len(asset_returns) - 1)
    beta = covariance / bench_variance
    correlation = covariance / math.sqrt(asset_variance * bench_variance)
    benchmark_return = bench_day_prices[common[-1]["day"]] / bench_day_prices[common[0]["day"]] - 1.0
    return {
        "beta": _round(beta),
        "correlation": _round(correlation),
        "benchmark_overlap": overlap,
        "benchmark_total_return": _round(benchmark_return),
    }, None


def _pct(value):
    return f"{value * 100:.2f}%"


def _ratio(value):
    return f"{value:.4f}"


def _summary(metrics, start, end, gaps):
    parts = [
        f"{start}..{end}，{metrics['observations']} 个观测 / {metrics['returns_count']} 个收益",
        f"区间收益 {_pct(metrics['total_return'])}",
        f"年化收益 {_pct(metrics['annualized_return'])}",
        f"年化波动 {_pct(metrics['annualized_volatility'])}",
        f"最大回撤 {_pct(metrics['max_drawdown'])}",
    ]
    if "sharpe_ratio" in metrics:
        parts.append(f"夏普 {_ratio(metrics['sharpe_ratio'])}（rf={_pct(metrics['risk_free_rate'])}）")
    if "sortino_ratio" in metrics:
        parts.append(f"索提诺 {_ratio(metrics['sortino_ratio'])}")
    if "calmar_ratio" in metrics:
        parts.append(f"Calmar {_ratio(metrics['calmar_ratio'])}")
    parts.append(f"VaR{int(round(metrics['confidence'] * 100))} {_pct(metrics['var'])}")
    parts.append(f"CVaR {_pct(metrics['cvar'])}")
    if "beta" in metrics:
        parts.append(
            f"基准 beta {_ratio(metrics['beta'])}、相关 {_ratio(metrics['correlation'])}"
            f"（重叠 {metrics['benchmark_overlap']} 个日收益）"
        )
    head = "；".join(parts) + "。"
    if gaps:
        head += "（有缺口未计算，见 data_gaps）"
    return head


def _result(status, summary, metrics, methodology, limitations, gaps, outputs):
    return {
        "status": status,
        "summary": summary,
        "metrics": metrics,
        "claims": [],
        "assumptions": list(ASSUMPTIONS),
        "methodology_log": methodology,
        "sensitivity": {},
        "limitations": limitations,
        "data_gaps": gaps,
        "outputs": outputs,
    }


def _sample(values):
    """First few raw time values in a gap message; enough to locate the bad rows, not a data dump."""
    shown = "、".join(str(value) for value in values[:5])
    return shown if len(values) <= 5 else f"{shown} 等 {len(values)} 行"


def _read_views(request, context):
    items = (request.get("inputs") or {}).get("datasets") or []
    if not items:
        raise AnalysisInputError("快照里没有任何 Dataset：先取价格序列再建快照")
    views = {}
    for item in items:
        dataset_id = (item or {}).get("dataset_id")
        if not isinstance(dataset_id, str) or not dataset_id:
            raise AnalysisInputError("request.inputs.datasets 里有缺失 dataset_id 的条目")
        views[dataset_id] = context.read_dataset(dataset_id)
    for dataset_id, view in views.items():
        if view.get("shape") != "rows":
            raise AnalysisInputError(
                f"Dataset {dataset_id} 是 {view.get('shape')} 型：returns_risk 只吃表格数据，"
                "文档型输入请先走 profile 或证据"
            )
    return views


def _candidate(views, price_override, time_override):
    """Dataset ids that look like a price series (a time column plus a price column)."""
    candidates = []
    for dataset_id, view in sorted(views.items()):
        try:
            time_column = _time_column(view, time_override)
            _price_column(view, price_override)
        except AnalysisInputError:
            continue
        candidates.append((dataset_id, time_column))
    return candidates


def analyze(request: dict, context) -> dict:
    params = request.get("params") or {}
    views = _read_views(request, context)
    price_override = _text(params.get("price_column"))
    time_override = _text(params.get("time_column"))

    price_dataset_id = _text(params.get("price_dataset_id"))
    if price_dataset_id is not None:
        if price_dataset_id not in views:
            raise AnalysisInputError(f"price_dataset_id={price_dataset_id} 不在本次快照的 Dataset 里")
        price_view = views[price_dataset_id]
    else:
        candidates = _candidate(views, price_override, time_override)
        if len(candidates) > 1:
            raise AnalysisInputError(
                f"有 {len(candidates)} 份 Dataset 都像价格序列（{'、'.join(item[0] for item in candidates)}）："
                "用 price_dataset_id 指明用哪一份（基准用 benchmark_dataset_id）"
            )
        if not candidates:
            detail = f"（time_column={time_override} 不在任何 Dataset 里）" if time_override else ""
            raise AnalysisInputError(
                f"没有可识别的价格序列 Dataset{detail}：需要时间列 + close/adj_close/close_price/price/nav 之一"
            )
        price_dataset_id = candidates[0][0]
        price_view = views[price_dataset_id]

    time_column = _time_column(price_view, time_override)
    price_column = _price_column(price_view, price_override)
    tz = _timezone(_text(params.get("timezone")))
    points, dropped = _series(price_view, price_dataset_id, price_column, time_column, tz)

    periods_per_year = params.get("periods_per_year", PERIODS_PER_YEAR_DEFAULT)
    if isinstance(periods_per_year, bool) or not isinstance(periods_per_year, int) or not 1 <= periods_per_year <= 366:
        raise AnalysisInputError(f"periods_per_year={periods_per_year!r} 不在 1..366")
    risk_free_rate = params.get("risk_free_rate", 0.0)
    if isinstance(risk_free_rate, bool) or not isinstance(risk_free_rate, (int, float)) or not -1 <= float(risk_free_rate) <= 1:
        raise AnalysisInputError(f"risk_free_rate={risk_free_rate!r} 不在 -1..1")
    risk_free_rate = float(risk_free_rate)
    confidence = params.get("confidence", CONFIDENCE_DEFAULT)
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0.5 <= float(confidence) <= 0.999:
        raise AnalysisInputError(f"confidence={confidence!r} 不在 0.5..0.999")
    confidence = float(confidence)

    methodology = [
        f"价格 Dataset {price_dataset_id}：时间列 {time_column}、价格列 {price_column}",
        f"按时间升序取 {len(points)} 个正价格观测；跳过 {len(dropped)} 行（时间无法解析或价格非正）",
    ]
    limitations = list(LIMITATIONS)
    gaps = []

    if len(points) < 3:
        gaps.append(f"有效观测不足 3 个（实际 {len(points)}）：至少需要 2 个日收益才能计算风险指标")
        if dropped:
            gaps.append(f"跳过 {len(dropped)} 行（时间无法解析或价格非正）：{_sample(dropped)}")
        return _result(
            "blocked",
            "价格序列有效观测不足 3 个：无法计算收益与风险。",
            {},
            methodology + ["未计算任何指标：有效价格点不足"],
            limitations,
            gaps,
            [],
        )

    if dropped:
        gaps.append(
            f"价格列 {price_column} 有 {len(dropped)} 行不是正数或时间无法解析（已跳过）：{_sample(dropped)}"
        )

    metrics, returns = _risk(points, periods_per_year, risk_free_rate, confidence)
    if metrics["returns_count"] < MIN_RETURNS_FOR_STABLE:
        limitations.append(f"只有 {metrics['returns_count']} 个收益观测：年化指标不稳定，只能作方向性参考")
    limitations.append(f"年化因子取 {periods_per_year}；换因子会改变年化收益、波动与夏普")

    benchmark_payload = None
    benchmark_dataset_id = _text(params.get("benchmark_dataset_id"))
    if benchmark_dataset_id is not None:
        if benchmark_dataset_id not in views:
            raise AnalysisInputError(f"benchmark_dataset_id={benchmark_dataset_id} 不在本次快照的 Dataset 里")
        bench_view = views[benchmark_dataset_id]
        bench_time = _time_column(bench_view, None)
        bench_price = _price_column(bench_view, None)
        bench_points, bench_dropped = _series(bench_view, benchmark_dataset_id, bench_price, bench_time, tz)
        bench_day_prices = {point["day"]: point["price"] for point in bench_points}
        benchmark, benchmark_gap = _benchmark(points, bench_day_prices)
        if benchmark_gap is not None:
            gaps.append(benchmark_gap)
        else:
            metrics.update(benchmark)
            benchmark_payload = {
                "dataset_id": benchmark_dataset_id,
                "time_column": bench_time,
                "price_column": bench_price,
                "observations": len(bench_points),
                "skipped_rows": len(bench_dropped),
                **{key: benchmark[key] for key in ("beta", "correlation", "benchmark_overlap", "benchmark_total_return")},
            }
            methodology.append(
                f"基准 {benchmark_dataset_id}：重叠 {benchmark['benchmark_overlap']} 个日收益，"
                f"beta={_ratio(benchmark['beta'])}、corr={_ratio(benchmark['correlation'])}"
            )
    else:
        limitations.append("未提供基准 Dataset：beta 与相关未计算")

    status = "partial" if gaps else "completed"
    methodology.append(
        f"计算 {len([key for key in metrics if isinstance(metrics[key], (int, float))])} 项数值指标；{len(gaps)} 项缺口"
    )

    start_day, end_day = points[0]["day"], points[-1]["day"]
    payload = {
        "protocol": "capital.analysis/v1",
        "module_id": MODULE_ID,
        "module_version": MODULE_VERSION,
        "analysis_id": request.get("analysis_id"),
        "module_run_id": request.get("module_run_id"),
        "price_dataset_id": price_dataset_id,
        "time_column": time_column,
        "price_column": price_column,
        "parameters": {
            "periods_per_year": periods_per_year,
            "risk_free_rate": risk_free_rate,
            "confidence": confidence,
        },
        "window": {"start": start_day, "end": end_day, "observations": len(points)},
        "metrics": metrics,
        "benchmark": benchmark_payload,
        "series": [
            {
                "date": point["day"],
                "close": point["price"],
                **({"return": _round(returns[index - 1])} if index > 0 else {}),
            }
            for index, point in enumerate(points)
        ],
        "data_gaps": gaps,
    }
    ref = context.write_output(OUTPUT_NAME, payload)
    context.log(f"{MODULE_ID}: {status} observations={len(points)} metrics={len(metrics)} gaps={len(gaps)}")

    return _result(
        status,
        _summary(metrics, start_day, end_day, gaps),
        metrics,
        methodology,
        limitations,
        gaps,
        [{"name": OUTPUT_NAME, "ref": ref}],
    )
