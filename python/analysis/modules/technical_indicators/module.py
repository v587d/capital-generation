"""Technical indicators for one price series (the "series" input shape of the module protocol).

Input is one Dataset with a time column and a positive price column, plus optional high/low columns
that only ATR uses. An indicator group is computed only when the caller supplies its parameters, and
only when the window is complete: an incomplete window becomes a reported gap, never a shorter window
or a default value. The values and cross states are review conditions for the senior analyst; the
module does not forecast direction, rate or recommend anything.

Pure standard library on purpose: no numpy/pandas, so the arithmetic is auditable line by line and
the module runs on the minimal analysis runtime.

Protocol: `docs/dev/senior-analysis.md` §1.9.
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone

MODULE_ID = "technical_indicators"
MODULE_VERSION = "1.0.0"
OUTPUT_NAME = "technical_indicators"

MAX_WINDOWS = 4
MAX_SERIES_BARS = 2000
MACD_DEFAULTS = (12, 26, 9)
BOLL_PERIOD_DEFAULT = 20
BOLL_MULTIPLIER_DEFAULT = 2.0

ASSUMPTIONS = [
    "价格口径沿用 Dataset 的取数参数（qfq / hfq / none），本模块不检测也不做复权调整",
    "所有指标只用收盘价序列按标准公式计算：SMA 算术平均、EMA 平滑系数 2/(n+1)、RSI 用 Wilder 平滑、MACD 为 EMA 差与信号线 EMA、布林带为 SMA ± 倍数×总体标准差、ATR 用真实波幅的 Wilder 平滑",
    "指标值只在窗口完整时给出；样本不足的窗口写进 data_gaps，不用更短窗口或默认值凑数",
    "交叉状态是「最新一根与前一根的相对位置」，是复盘条件，不是买卖信号或方向预测",
    "指标对复权口径与停牌处理敏感；不同数据源的复权价不可混算",
]

LIMITATIONS = [
    "指标窗口不完整时只报缺口：样本不足的指标不会被更短窗口或默认值代替",
    "SMA / EMA / RSI / MACD / 布林带只用收盘价；ATR 额外用 high / low；不同复权口径或停牌处理的价格不可混算",
    "交叉与相对状态只描述最新一根 bar 的位置，不代表信号有效或方向",
    "指标是复盘条件，不是买卖信号、评级或方向预测",
    "不构成投资建议，也不产生评级、目标价或收益承诺",
]

PRICE_COLUMNS = ("close", "adj_close", "close_price", "price", "nav")
TIME_COLUMNS = ("trade_date_ms", "date_ms", "period_end_ms", "datetime", "date", "trade_date", "time")
OHLC_COLUMNS = ("high", "low")
ISO_DAY = re.compile(r"^(\d{4}-\d{2}-\d{2})")


class AnalysisInputError(Exception):
    """The input cannot be used at all; the host maps `analysis_code` to the stable protocol code."""

    analysis_code = "analysis_input_invalid"


def _round(value):
    """Six decimals; `None` for a non-finite value so the JSON boundary never sees NaN/Infinity."""
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        return None
    rounded = round(number, 6)
    return 0.0 if rounded == 0 else rounded


def _publish(metrics, computed, gaps, key, label, value):
    """Publish one latest indicator value; a non-finite one is a gap, not a NaN."""
    rounded = _round(value)
    if rounded is None:
        gaps.append(f"{label} 最新值不是有限数字（价格量级导致数值溢出）：未输出")
        return
    metrics[key] = rounded
    computed.append(key)


def _fmt4(value):
    return f"{value:.4f}"


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
    """Positive prices on a time axis; bad rows are skipped and returned for `data_gaps`."""
    rows = view.get("rows") or []
    if not rows:
        raise AnalysisInputError(f"Dataset {dataset_id} 没有数据行：无法计算技术指标")
    points, dropped, kind = [], [], None
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise AnalysisInputError(f"Dataset {dataset_id} 的数据行不是对象：无法计算技术指标")
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
        if parsed is None:
            dropped.append({"index": index + 1, "time": raw_time, "reason": "时间无法解析"})
            continue
        if price is None:
            dropped.append({"index": index + 1, "time": raw_time, "reason": "价格缺失"})
            continue
        if price <= 0:
            dropped.append({"index": index + 1, "time": raw_time, "reason": f"价格非正 close={price:g}"})
            continue
        key, day = parsed
        points.append({
            "key": key,
            "day": day,
            "price": price,
            "high": _number(row, "high"),
            "low": _number(row, "low"),
        })
    points.sort(key=lambda item: item["key"])
    seen = set()
    for point in points:
        if point["day"] in seen:
            raise AnalysisInputError(
                f"Dataset {dataset_id} 在 {point['day']} 出现多行：无法判断用哪一行（请先去重）"
            )
        seen.add(point["day"])
    return points, dropped


def _sma_series(closes, window):
    values = [None] * len(closes)
    for index in range(window - 1, len(closes)):
        values[index] = math.fsum(closes[index - window + 1:index + 1]) / window
    return values


def _ema_series(closes, window):
    """EMA seeded with the SMA of the first `window` closes, then 2/(n+1) smoothing."""
    values = [None] * len(closes)
    if len(closes) < window:
        return values
    factor = 2.0 / (window + 1)
    values[window - 1] = math.fsum(closes[:window]) / window
    for index in range(window, len(closes)):
        values[index] = values[index - 1] + factor * (closes[index] - values[index - 1])
    return values


def _rsi_value(average_gain, average_loss):
    if average_loss == 0:
        return 100.0 if average_gain > 0 else 50.0
    relative = average_gain / average_loss
    return 100.0 - 100.0 / (1.0 + relative)


def _rsi_series(closes, period):
    """Wilder RSI: first average of the first `period` changes, then Wilder smoothing."""
    values = [None] * len(closes)
    if len(closes) < period + 1:
        return values
    gains, losses = [], []
    for index in range(1, period + 1):
        change = closes[index] - closes[index - 1]
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))
    average_gain = math.fsum(gains) / period
    average_loss = math.fsum(losses) / period
    values[period] = _rsi_value(average_gain, average_loss)
    for index in range(period + 1, len(closes)):
        change = closes[index] - closes[index - 1]
        average_gain = (average_gain * (period - 1) + max(change, 0.0)) / period
        average_loss = (average_loss * (period - 1) + max(-change, 0.0)) / period
        values[index] = _rsi_value(average_gain, average_loss)
    return values


def _macd_series(closes, fast, slow, signal):
    fast_series = _ema_series(closes, fast)
    slow_series = _ema_series(closes, slow)
    macd = [None] * len(closes)
    for index in range(slow - 1, len(closes)):
        macd[index] = fast_series[index] - slow_series[index]
    compact = macd[slow - 1:]
    signal_compact = _ema_series(compact, signal)
    signal_series = [None] * len(closes)
    for offset, value in enumerate(signal_compact):
        signal_series[slow - 1 + offset] = value
    hist = [None] * len(closes)
    for index, value in enumerate(macd):
        if value is not None and signal_series[index] is not None:
            hist[index] = value - signal_series[index]
    return macd, signal_series, hist


def _boll_series(closes, period, multiplier):
    middle = _sma_series(closes, period)
    upper, lower = [None] * len(closes), [None] * len(closes)
    for index in range(period - 1, len(closes)):
        mean = middle[index]
        window = closes[index - period + 1:index + 1]
        variance = math.fsum((value - mean) ** 2 for value in window) / period
        deviation = math.sqrt(variance)
        upper[index] = mean + multiplier * deviation
        lower[index] = mean - multiplier * deviation
    return upper, middle, lower


def _atr_series(points, period):
    """Wilder ATR over true range; TR starts at bar 1, so the first ATR lands on bar `period`."""
    closes = [point["price"] for point in points]
    true_ranges = [None] * len(points)
    for index in range(1, len(points)):
        high, low, previous = points[index]["high"], points[index]["low"], closes[index - 1]
        true_ranges[index] = max(high - low, abs(high - previous), abs(low - previous))
    values = [None] * len(points)
    if len(points) < period + 1:
        return values
    values[period] = math.fsum(true_ranges[1:period + 1]) / period
    for index in range(period + 1, len(points)):
        values[index] = (values[index - 1] * (period - 1) + true_ranges[index]) / period
    return values


def _windows(params, key):
    raw = params.get(key)
    if raw is None:
        return None
    if not isinstance(raw, list) or not raw:
        raise AnalysisInputError(f"{key} 必须是非空数组（或省略）")
    if len(raw) > MAX_WINDOWS:
        raise AnalysisInputError(f"{key} 最多 {MAX_WINDOWS} 个窗口，实际 {len(raw)} 个")
    windows = []
    for index, value in enumerate(raw):
        if isinstance(value, bool) or not isinstance(value, int) or value < 2:
            raise AnalysisInputError(f"{key}[{index}]={value!r} 必须是 ≥2 的整数")
        if value in windows:
            raise AnalysisInputError(f"{key} 有重复窗口 {value}：同一窗口只能出现一次")
        windows.append(value)
    return sorted(windows)


def _period(params, key, default):
    raw = params.get(key, default)
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 2:
        raise AnalysisInputError(f"{key}={raw!r} 必须是 ≥2 的整数")
    return raw


def _optional_period(params, key):
    if key not in params:
        return None
    return _period(params, key, None)


def _multiplier(params):
    raw = params.get("boll_multiplier", BOLL_MULTIPLIER_DEFAULT)
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise AnalysisInputError(f"boll_multiplier={raw!r} 必须是数字")
    value = float(raw)
    if value != value or value in (float("inf"), float("-inf")):
        raise AnalysisInputError(f"boll_multiplier={raw!r} 必须是有限数字")
    if value < 0:
        raise AnalysisInputError(f"boll_multiplier={value!r} 不能为负数")
    return value


def _groups(params):
    """Indicator groups requested by the caller: a group exists only when its parameters were given."""
    sma_windows = _windows(params, "sma_windows")
    ema_windows = _windows(params, "ema_windows")
    rsi_period = _optional_period(params, "rsi_period")
    macd = None
    if any(key in params for key in ("macd_fast", "macd_slow", "macd_signal")):
        fast = _period(params, "macd_fast", MACD_DEFAULTS[0])
        slow = _period(params, "macd_slow", MACD_DEFAULTS[1])
        signal = _period(params, "macd_signal", MACD_DEFAULTS[2])
        if fast >= slow:
            raise AnalysisInputError(f"macd_fast={fast} 必须小于 macd_slow={slow}：MACD 是快线 EMA 减慢线 EMA")
        macd = (fast, slow, signal)
    boll = None
    if "boll_period" in params or "boll_multiplier" in params:
        boll = (_period(params, "boll_period", BOLL_PERIOD_DEFAULT), _multiplier(params))
    atr_period = _optional_period(params, "atr_period")
    groups = {
        "sma": sma_windows,
        "ema": ema_windows,
        "rsi": rsi_period,
        "macd": macd,
        "boll": boll,
        "atr": atr_period,
    }
    if all(value is None for value in groups.values()):
        raise AnalysisInputError(
            "一个指标参数都没给：至少给出 sma_windows / ema_windows / rsi_period / macd_* / boll_* / atr_period 之一"
        )
    return groups


def _window_gap(label, need_text, actual):
    return f"{label} 未计算：需要 {need_text}，实际 {actual} 根（窗口不完整，不用更短窗口或默认值代替）"


def _indicators(points, groups, names):
    """Compute every requested indicator; incomplete windows stay `None` and become gaps."""
    closes = [point["price"] for point in points]
    count = len(points)
    metrics = {"close": _round(closes[-1]), "observations": count}
    series_values, metadata, gaps, computed = {}, [], [], []

    if groups["sma"] is not None:
        for window in groups["sma"]:
            key = f"sma_{window}"
            values = _sma_series(closes, window)
            series_values[key] = values
            metadata.append({
                "id": key,
                "group": "sma",
                "window": window,
                "required_observations": window,
                "formula": f"SMA({window}) = 最近 {window} 个收盘价的算术平均",
            })
            if count < window:
                gaps.append(_window_gap(f"SMA({window})", f"{window} 根收盘价", count))
                continue
            _publish(metrics, computed, gaps, key, f"SMA({window})", values[-1])

    if groups["ema"] is not None:
        for window in groups["ema"]:
            key = f"ema_{window}"
            values = _ema_series(closes, window)
            series_values[key] = values
            metadata.append({
                "id": key,
                "group": "ema",
                "window": window,
                "required_observations": window,
                "formula": f"EMA({window}) = 前值 + 2/({window}+1)×(收盘 − 前值)，首值取前 {window} 个收盘价均值",
            })
            if count < window:
                gaps.append(_window_gap(f"EMA({window})", f"{window} 根收盘价", count))
                continue
            _publish(metrics, computed, gaps, key, f"EMA({window})", values[-1])

    if groups["rsi"] is not None:
        period = groups["rsi"]
        key = f"rsi_{period}"
        values = _rsi_series(closes, period)
        series_values[key] = values
        metadata.append({
            "id": key,
            "group": "rsi",
            "window": period,
            "required_observations": period + 1,
            "formula": (
                f"RSI({period}) = 100 − 100/(1 + 平均涨幅/平均跌幅)，Wilder 平滑；"
                f"首值用前 {period} 个变动的平均涨/跌"
            ),
        })
        if count < period + 1:
            gaps.append(_window_gap(f"RSI({period})", f"{period + 1} 根（周期 + 1）", count))
        else:
            _publish(metrics, computed, gaps, key, f"RSI({period})", values[-1])

    if groups["macd"] is not None:
        fast, slow, signal = groups["macd"]
        macd_values, signal_values, hist_values = _macd_series(closes, fast, slow, signal)
        series_values["macd"] = macd_values
        series_values["macd_signal"] = signal_values
        series_values["macd_hist"] = hist_values
        metadata.extend([
            {
                "id": "macd",
                "group": "macd",
                "window": slow,
                "required_observations": slow + signal,
                "formula": f"MACD = EMA({fast}) − EMA({slow})",
            },
            {
                "id": "macd_signal",
                "group": "macd",
                "window": signal,
                "required_observations": slow + signal,
                "formula": f"signal = EMA({signal}) 于 MACD 序列，首值取前 {signal} 个 MACD 均值",
            },
            {
                "id": "macd_hist",
                "group": "macd",
                "window": signal,
                "required_observations": slow + signal,
                "formula": "hist = MACD − signal",
            },
        ])
        if count < slow + signal:
            gaps.append(_window_gap(f"MACD({fast}/{slow}/{signal})", f"{slow + signal} 根（slow + signal）", count))
        else:
            _publish(metrics, computed, gaps, "macd", "MACD", macd_values[-1])
            _publish(metrics, computed, gaps, "macd_signal", "MACD signal", signal_values[-1])
            _publish(metrics, computed, gaps, "macd_hist", "MACD hist", hist_values[-1])

    if groups["boll"] is not None:
        period, multiplier = groups["boll"]
        upper, middle, lower = _boll_series(closes, period, multiplier)
        series_values["boll_upper"] = upper
        series_values["boll_middle"] = middle
        series_values["boll_lower"] = lower
        factor = f"{multiplier:g}"
        metadata.extend([
            {
                "id": "boll_upper",
                "group": "boll",
                "window": period,
                "required_observations": period,
                "formula": f"upper = SMA({period}) + {factor}×总体标准差({period})",
            },
            {
                "id": "boll_middle",
                "group": "boll",
                "window": period,
                "required_observations": period,
                "formula": f"middle = SMA({period})",
            },
            {
                "id": "boll_lower",
                "group": "boll",
                "window": period,
                "required_observations": period,
                "formula": f"lower = SMA({period}) − {factor}×总体标准差({period})",
            },
        ])
        if count < period:
            gaps.append(_window_gap(f"BOLL({period})", f"{period} 根收盘价", count))
        else:
            _publish(metrics, computed, gaps, "boll_upper", "BOLL 上轨", upper[-1])
            _publish(metrics, computed, gaps, "boll_middle", "BOLL 中轨", middle[-1])
            _publish(metrics, computed, gaps, "boll_lower", "BOLL 下轨", lower[-1])

    if groups["atr"] is not None:
        period = groups["atr"]
        key = f"atr_{period}"
        metadata.append({
            "id": key,
            "group": "atr",
            "window": period,
            "required_observations": period + 1,
            "formula": (
                f"ATR({period}) = 真实波幅的 Wilder 平滑；"
                "TR = max(high − low, |high − 前收|, |low − 前收|)，首值取前 "
                f"{period} 个 TR 均值"
            ),
        })
        missing = [name for name in OHLC_COLUMNS if name not in names]
        invalid = sum(1 for point in points if point["high"] is None or point["low"] is None)
        if missing:
            series_values[key] = [None] * count
            gaps.append(
                f"ATR({period}) 未计算：需要 high / low / close 三列，Dataset 缺 {'、'.join(missing)}（ATR 要用真实波幅）"
            )
        elif invalid:
            series_values[key] = [None] * count
            gaps.append(f"ATR({period}) 未计算：有 {invalid} 行 high/low 不是有限数字（按缺口处理，不填默认值）")
        elif count < period + 1:
            series_values[key] = [None] * count
            gaps.append(_window_gap(f"ATR({period})", f"{period + 1} 根（周期 + 1）", count))
        else:
            values = _atr_series(points, period)
            series_values[key] = values
            _publish(metrics, computed, gaps, key, f"ATR({period})", values[-1])

    return metrics, series_values, metadata, gaps, computed


def _states(points, metrics, groups, series_values):
    """Latest-bar relative positions and cross events; absent when either side has no value."""
    close = points[-1]["price"]

    available_smas = [window for window in (groups["sma"] or []) if f"sma_{window}" in metrics]
    for window in available_smas:
        metrics[f"close_above_sma_{window}"] = close > series_values[f"sma_{window}"][-1]
    for first, second in zip(available_smas, available_smas[1:]):
        left, right = series_values[f"sma_{first}"], series_values[f"sma_{second}"]
        current = left[-1] > right[-1]
        metrics[f"sma_{first}_above_sma_{second}"] = current
        if len(left) >= 2 and left[-2] is not None and right[-2] is not None:
            previous = left[-2] > right[-2]
            metrics[f"sma_{first}_crossed_above_sma_{second}"] = current and not previous
            metrics[f"sma_{first}_crossed_below_sma_{second}"] = previous and not current

    for window in (groups["ema"] or []):
        if f"ema_{window}" in metrics:
            metrics[f"close_above_ema_{window}"] = close > series_values[f"ema_{window}"][-1]

    if "macd" in metrics and "macd_signal" in metrics:
        macd_values, signal_values = series_values["macd"], series_values["macd_signal"]
        current = macd_values[-1] > signal_values[-1]
        metrics["macd_above_signal"] = current
        if len(macd_values) >= 2 and macd_values[-2] is not None and signal_values[-2] is not None:
            previous = macd_values[-2] > signal_values[-2]
            metrics["macd_crossed_above_signal"] = current and not previous
            metrics["macd_crossed_below_signal"] = previous and not current

    if all(key in metrics for key in ("boll_upper", "boll_middle", "boll_lower")):
        metrics["close_above_boll_middle"] = close > series_values["boll_middle"][-1]
        metrics["close_above_boll_upper"] = close > series_values["boll_upper"][-1]
        metrics["close_below_boll_lower"] = close < series_values["boll_lower"][-1]


def _requested_text(groups):
    parts = []
    if groups["sma"] is not None:
        parts.append("SMA [" + ", ".join(str(window) for window in groups["sma"]) + "]")
    if groups["ema"] is not None:
        parts.append("EMA [" + ", ".join(str(window) for window in groups["ema"]) + "]")
    if groups["rsi"] is not None:
        parts.append(f"RSI({groups['rsi']})")
    if groups["macd"] is not None:
        fast, slow, signal = groups["macd"]
        parts.append(f"MACD({fast}/{slow}/{signal})")
    if groups["boll"] is not None:
        period, multiplier = groups["boll"]
        parts.append(f"BOLL({period}, {multiplier:g})")
    if groups["atr"] is not None:
        parts.append(f"ATR({groups['atr']})")
    return "、".join(parts)


def _summary(points, metrics, groups, gaps, dropped):
    parts = [
        f"{points[0]['day']}..{points[-1]['day']}，{len(points)} 个观测",
        f"最新收盘 {_fmt4(metrics['close'])}",
    ]
    if dropped:
        parts.append(f"跳过 {len(dropped)} 条坏行")
    for window in (groups["sma"] or []):
        key = f"sma_{window}"
        if key in metrics:
            parts.append(f"SMA{window} {_fmt4(metrics[key])}")
    for window in (groups["ema"] or []):
        key = f"ema_{window}"
        if key in metrics:
            parts.append(f"EMA{window} {_fmt4(metrics[key])}")
    rsi_period = groups["rsi"]
    if rsi_period is not None and f"rsi_{rsi_period}" in metrics:
        parts.append(f"RSI{rsi_period} {_fmt4(metrics[f'rsi_{rsi_period}'])}")
    if all(key in metrics for key in ("macd", "macd_signal", "macd_hist")):
        parts.append(
            f"MACD {_fmt4(metrics['macd'])}（signal {_fmt4(metrics['macd_signal'])}、"
            f"hist {_fmt4(metrics['macd_hist'])}）"
        )
    if all(key in metrics for key in ("boll_upper", "boll_middle", "boll_lower")):
        parts.append(
            f"BOLL 上 {_fmt4(metrics['boll_upper'])} / 中 {_fmt4(metrics['boll_middle'])} / "
            f"下 {_fmt4(metrics['boll_lower'])}"
        )
    atr_period = groups["atr"]
    if atr_period is not None and f"atr_{atr_period}" in metrics:
        parts.append(f"ATR{atr_period} {_fmt4(metrics[f'atr_{atr_period}'])}")
    text = "；".join(parts) + "。"
    if gaps:
        text += "（有缺口未计算，见 data_gaps）。"
    return text + "指标是复盘条件，不是买卖信号或方向预测。"


def _blocked_summary(points, dropped):
    text = (
        f"{points[0]['day']}..{points[-1]['day']}，{len(points)} 个观测；"
        "请求的指标都未能计算（见 data_gaps）。"
    )
    if dropped:
        text += f"另有 {len(dropped)} 条坏行被跳过。"
    return text + "指标是复盘条件，不是买卖信号或方向预测。"


def _skipped_gap(price_column, dropped):
    labels = []
    for item in dropped[:5]:
        labels.append(f"第 {item['index']} 行 {item['time']}（{item['reason']}）")
    shown = "、".join(labels)
    suffix = "" if len(dropped) <= 5 else f" 等 {len(dropped)} 行"
    return f"价格列 {price_column} 有 {len(dropped)} 行不是正数或时间无法解析（已跳过）：{shown}{suffix}"


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
                f"Dataset {dataset_id} 是 {view.get('shape')} 型：technical_indicators 只吃表格价格序列（rows），"
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
    groups = _groups(params)
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
                "用 price_dataset_id 指明用哪一份"
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
    if len(points) < 2:
        raise AnalysisInputError(
            f"Dataset {price_dataset_id} 只有 {len(points)} 个有效观测（跳过 {len(dropped)} 行）："
            "技术指标至少需要 2 个正价格观测"
        )

    names = _columns_of(price_view)
    metrics, series_values, metadata, gaps, computed = _indicators(points, groups, names)
    if dropped:
        gaps.insert(0, _skipped_gap(price_column, dropped))
    _states(points, metrics, groups, series_values)

    methodology = [
        f"价格 Dataset {price_dataset_id}：时间列 {time_column}、价格列 {price_column}",
        f"按时间升序取 {len(points)} 个正价格观测；跳过 {len(dropped)} 行（时间无法解析或价格非正）",
        f"请求指标：{_requested_text(groups)}",
        f"计算 {len(computed)} 项指标值、{len(gaps)} 项缺口；窗口不完整不缩短、不填默认值",
        "指标公式、窗口与所需根数见 outputs 的 indicators 元数据",
    ]
    if groups["rsi"] is not None and f"rsi_{groups['rsi']}" in metrics:
        methodology.append("RSI 平均跌幅为 0 时记 100；涨跌都为 0（完全平盘）时记 50（0/0 无定义，取中性值）")
    limitations = list(LIMITATIONS)
    if len(points) < 30:
        limitations.append(f"只有 {len(points)} 个观测：短样本上的指标不稳定，只作复盘条件")
    if price_view.get("truncated"):
        limitations.append(
            f"Dataset {price_dataset_id} 超过 max_input_rows，只用了前 {len(points)} 行：指标基于截断样本"
        )
    series_truncated = len(points) > MAX_SERIES_BARS
    if series_truncated:
        limitations.append(
            f"审计文件只保留最近 {MAX_SERIES_BARS} 根 bar（共 {len(points)} 根）：更早的 bar 未写入 outputs，指标仍用完整序列计算"
        )

    if not computed:
        context.log(f"{MODULE_ID}: blocked observations={len(points)} gaps={len(gaps)}")
        return _result(
            "blocked",
            _blocked_summary(points, dropped),
            metrics,
            methodology + ["未计算任何指标：请求的指标都没有完整窗口或必需列"],
            limitations,
            gaps,
            [],
        )

    status = "partial" if gaps else "completed"
    parameters = {}
    if groups["sma"] is not None:
        parameters["sma_windows"] = groups["sma"]
    if groups["ema"] is not None:
        parameters["ema_windows"] = groups["ema"]
    if groups["rsi"] is not None:
        parameters["rsi_period"] = groups["rsi"]
    if groups["macd"] is not None:
        fast, slow, signal = groups["macd"]
        parameters.update({"macd_fast": fast, "macd_slow": slow, "macd_signal": signal})
    if groups["boll"] is not None:
        period, multiplier = groups["boll"]
        parameters.update({"boll_period": period, "boll_multiplier": multiplier})
    if groups["atr"] is not None:
        parameters["atr_period"] = groups["atr"]

    series_ids = [item["id"] for item in metadata]
    series_rows = []
    for index, point in enumerate(points):
        row = {"date": point["day"], "close": _round(point["price"])}
        for indicator_id in series_ids:
            value = series_values[indicator_id][index]
            row[indicator_id] = None if value is None else _round(value)
        series_rows.append(row)
    if series_truncated:
        series_rows = series_rows[-MAX_SERIES_BARS:]

    payload = {
        "protocol": "capital.analysis/v1",
        "module_id": MODULE_ID,
        "module_version": MODULE_VERSION,
        "analysis_id": request.get("analysis_id"),
        "module_run_id": request.get("module_run_id"),
        "price_dataset_id": price_dataset_id,
        "time_column": time_column,
        "price_column": price_column,
        "parameters": parameters,
        "window": {"start": points[0]["day"], "end": points[-1]["day"], "observations": len(points)},
        "indicators": metadata,
        "series": series_rows,
        "series_total": len(points),
        "series_truncated": series_truncated,
        "skipped_rows": len(dropped),
        "data_gaps": gaps,
    }
    ref = context.write_output(OUTPUT_NAME, payload)
    context.log(
        f"{MODULE_ID}: {status} observations={len(points)} indicators={len(computed)} gaps={len(gaps)}"
    )

    return _result(
        status,
        _summary(points, metrics, groups, gaps, dropped),
        metrics,
        methodology,
        limitations,
        gaps,
        [{"name": OUTPUT_NAME, "ref": ref}],
    )
