"""Portfolio stress: replay one weighted portfolio through explicit historical windows.

Each position is one price-series Dataset; each window is the caller's already-happened interval.
The module only measures what those windows already did to that static weighting — window return is
first/last usable close inside the window, portfolio return is the weighted sum, concentration is
weight-only HHI/max weight. Missing coverage is a stated gap, never a borrowed date and never a
weight renormalization; no forecasting, no stress scenarios, no rating.

Pure standard library on purpose (no numpy/pandas): the arithmetic stays auditable line by line on
the minimal analysis runtime. Protocol: `docs/dev/senior-analysis.md` §1.9; conclusions and claims
belong to the senior analyst.
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone

MODULE_ID = "portfolio_stress"
MODULE_VERSION = "1.0.0"
OUTPUT_NAME = "portfolio_stress"

MAX_POSITIONS = 30
MAX_WINDOWS = 12
WEIGHT_TOLERANCE = 1e-6

ASSUMPTIONS = [
    "权重是调用方给的静态组合权重：回放期间不再平衡，也不考虑现金流出入、分红与税费",
    "组合窗口收益 = Σ 权重 × 该持仓窗口收益；持仓收益按窗口内首个与最后一个可用收盘价计算",
    "窗口是已发生的历史区间：start 必须早于 end，且两端的交易日必须落在价格序列覆盖范围内；越界写缺口，不向前/向后找替代日期",
    "集中度只用调用方权重计算（HHI = Σ w²、最大单持仓权重），与价格数据无关",
    "历史情景回放只说明这些窗口里组合会怎样；不是压力测试的假设情景，不预测、不评级，也不给仓位建议",
]

LIMITATIONS = [
    "历史窗口回放只说明这些窗口里组合会怎样：不预测未来，也不是假设情景压力测试",
    "权重是调用方给的静态权重：回放期间不再平衡，不含现金流出入、分红再投资与交易成本",
    "窗口越界或窗口内可用价格不足时写缺口，不向前/向后借日期；组合收益不按剩余权重重归一化",
    "每个持仓的价格口径沿用该 Dataset 的取数参数（qfq / hfq / none），本模块不检测也不做复权调整",
    "数值时间轴按参数 timezone 标注日历日（省略按 UTC）；跨市场比较前先对齐时区",
    "不构成投资建议，也不产生评级、目标价或收益承诺",
]

PRICE_COLUMNS = ("close", "adj_close", "close_price", "price", "nav")
TIME_COLUMNS = ("trade_date_ms", "date_ms", "period_end_ms", "datetime", "date", "trade_date", "time")
ISO_DAY = re.compile(r"^(\d{4}-\d{2}-\d{2})")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class AnalysisInputError(Exception):
    """The input cannot be used at all; the host maps `analysis_code` to the stable protocol code."""

    analysis_code = "analysis_input_invalid"


def _round(value):
    rounded = round(float(value), 6)
    return 0.0 if rounded == 0 else rounded


def _finite_number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AnalysisInputError(f"{label} 必须是数字，实际是 {value!r}")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        raise AnalysisInputError(f"{label} 必须是有限数字，实际是 {value!r}")
    return number


def _number(row, name):
    """A finite positive/negative price cell; `None` means "not usable" (the row is skipped)."""
    if row is None:
        return None
    value = row.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _text(value, label, *, required=False):
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip():
        raise AnalysisInputError(f"{label} 必须是非空字符串")
    return value.strip()


def _day(value, label):
    if not isinstance(value, str) or DAY.match(value.strip()) is None:
        raise AnalysisInputError(f"{label} 必须是 YYYY-MM-DD 日期，实际是 {value!r}")
    text = value.strip()
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError as error:
        raise AnalysisInputError(f"{label} 不是合法日期：{value!r}") from error
    return text


def _pct(value):
    return f"{value * 100:.2f}%"


def _ratio(value):
    return f"{value:.4f}"


def _fmt6(value):
    return f"{value:.6f}"


def _columns_of(view):
    columns = view.get("columns") or []
    names = {item.get("name") for item in columns if isinstance(item, dict)}
    for row in (view.get("rows") or [])[:1]:
        if isinstance(row, dict):
            names |= set(row)
    return names


def _timezone(name):
    """IANA zone when the caller names one; UTC otherwise (the dataset tz is not authoritative)."""
    if name is None:
        return timezone.utc
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception as error:  # noqa: BLE001 - any load failure is a caller error
        raise AnalysisInputError(f"timezone={name!r} 无法加载（需要 IANA 时区名，如 Asia/Shanghai）") from error


def _time_column(view, dataset_id, override):
    names = _columns_of(view)
    if override is not None:
        if override not in names:
            raise AnalysisInputError(
                f"Dataset {dataset_id} 的 time_column={override} 不在列里：可选 {sorted(names)}"
            )
        return override
    axis = (view.get("time_axis") or {}).get("column")
    if isinstance(axis, str) and axis in names:
        return axis
    for name in TIME_COLUMNS:
        if name in names:
            return name
    raise AnalysisInputError(
        f"Dataset {dataset_id} 找不到时间列：需要 time_coverage 列，或 trade_date_ms / date_ms / "
        "period_end_ms / datetime / date / trade_date 之一（或用 time_column 指明）"
    )


def _price_column(view, dataset_id, override):
    names = _columns_of(view)
    if override is not None:
        if override not in names:
            raise AnalysisInputError(
                f"Dataset {dataset_id} 的 price_column={override} 不在列里：可选 {sorted(names)}"
            )
        return override
    for name in PRICE_COLUMNS:
        if name in names:
            return name
    raise AnalysisInputError(
        f"Dataset {dataset_id} 找不到价格列：需要 close / adj_close / close_price / price / nav 之一"
        "（或用 price_column 指明）"
    )


def _parse_time(value, tz):
    """Return `(sort_key, day_label)`; `None` when the value is not a usable time."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        if number != number or number in (float("inf"), float("-inf")):
            return None
        try:
            stamp = datetime.fromtimestamp(number / 1000.0, tz=tz)
        except (OverflowError, OSError, ValueError):
            return None
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


def _series(view, dataset_id, time_column, price_column, tz):
    """Time-ordered usable closes; bad rows are dropped and reported, ambiguity is an input error."""
    rows = view.get("rows") or []
    if not rows:
        raise AnalysisInputError(f"Dataset {dataset_id} 没有数据行：无法回放任何窗口")
    points, dropped, kind = [], [], None
    for row in rows:
        if not isinstance(row, dict):
            raise AnalysisInputError(f"Dataset {dataset_id} 的数据行不是对象：无法回放")
        raw_time = row.get(time_column)
        if isinstance(raw_time, bool) or not isinstance(raw_time, (int, float, str)):
            row_kind = None
        else:
            row_kind = "ms" if isinstance(raw_time, (int, float)) else "date"
        if row_kind is not None:
            if kind is None:
                kind = row_kind
            elif row_kind != kind:
                raise AnalysisInputError(
                    f"Dataset {dataset_id} 的 {time_column} 列混用了数值时间戳与日期字符串："
                    "无法排序，请取数时统一"
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


def _positions(params):
    raw = params.get("positions")
    if not isinstance(raw, list) or not raw:
        raise AnalysisInputError("positions 必须是非空数组：至少给出一个持仓（dataset_id + weight）")
    if len(raw) > MAX_POSITIONS:
        raise AnalysisInputError(f"positions 最多 {MAX_POSITIONS} 个，实际 {len(raw)} 个")
    positions, seen = [], set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise AnalysisInputError(f"positions[{index}] 必须是对象（dataset_id + weight）")
        dataset_id = _text(item.get("dataset_id"), f"positions[{index}].dataset_id", required=True)
        if dataset_id in seen:
            raise AnalysisInputError(f"持仓数据集 {dataset_id} 出现了多次：同一数据集只能作为一个持仓")
        seen.add(dataset_id)
        weight = _finite_number(item.get("weight"), f"positions[{index}].weight")
        if weight < 0:
            raise AnalysisInputError(f"positions[{index}].weight 不能为负，实际是 {weight:g}")
        positions.append({"dataset_id": dataset_id, "weight": weight})
    total = math.fsum(position["weight"] for position in positions)
    if abs(total - 1.0) > WEIGHT_TOLERANCE:
        raise AnalysisInputError(f"持仓权重合计必须为 1（容差 1e-6），实际 {total:.6f}")
    return positions


def _windows(params):
    raw = params.get("windows")
    if not isinstance(raw, list) or not raw:
        raise AnalysisInputError("windows 必须是非空数组：至少给出一个历史窗口")
    if len(raw) > MAX_WINDOWS:
        raise AnalysisInputError(f"windows 最多 {MAX_WINDOWS} 个，实际 {len(raw)} 个")
    windows = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise AnalysisInputError(f"windows[{index}] 必须是对象（name + start + end）")
        name = _text(item.get("name"), f"windows[{index}].name", required=True)
        start = _day(item.get("start"), f"windows[{index}].start")
        end = _day(item.get("end"), f"windows[{index}].end")
        if start >= end:
            raise AnalysisInputError(f"windows[{index}] 的 start（{start}）必须早于 end（{end}）")
        windows.append({"name": name, "start": start, "end": end})
    return windows


def _views(request, context, positions):
    items = (request.get("inputs") or {}).get("datasets") or []
    declared = set()
    for item in items:
        dataset_id = (item or {}).get("dataset_id")
        if isinstance(dataset_id, str) and dataset_id:
            declared.add(dataset_id)
    views = {}
    for position in positions:
        dataset_id = position["dataset_id"]
        if dataset_id not in declared:
            raise AnalysisInputError(
                f"持仓数据集 {dataset_id} 不在本次快照的 Dataset 里：先用 dataset_refs 把它加进快照"
            )
        view = context.read_dataset(dataset_id)
        if view.get("shape") != "rows":
            raise AnalysisInputError(
                f"Dataset {dataset_id} 是 {view.get('shape')} 型：portfolio_stress 只回放价格序列表格，"
                "文档型输入请先走 profile 或证据"
            )
        views[dataset_id] = view
    return views


def _evaluate_window(window, positions, series_by_id):
    """Per-position window rows; `None` portfolio return when any position's window is unmeasurable."""
    rows, reasons, weighted = [], [], []
    for position in positions:
        dataset_id = position["dataset_id"]
        points = series_by_id[dataset_id]["points"]
        entry = {
            "dataset_id": dataset_id,
            "weight": position["weight"],
            "status": "missing",
            "first_date": None,
            "first_price": None,
            "last_date": None,
            "last_price": None,
            "return": None,
            "contribution": None,
        }
        reason = None
        if not points:
            reason = f"{dataset_id} 没有可用价格"
        elif window["start"] < points[0]["day"]:
            reason = f"{dataset_id} 起点 {window['start']} 早于序列覆盖（首日 {points[0]['day']}）"
        elif window["end"] > points[-1]["day"]:
            reason = f"{dataset_id} 终点 {window['end']} 晚于序列覆盖（末日 {points[-1]['day']}）"
        else:
            inside = [point for point in points if window["start"] <= point["day"] <= window["end"]]
            if len(inside) < 2:
                reason = f"{dataset_id} 窗口内只有 {len(inside)} 个可用价格（至少 2 个才能算收益）"
            else:
                first, last = inside[0], inside[-1]
                exact = last["price"] / first["price"] - 1.0
                if not math.isfinite(exact):
                    reason = f"{dataset_id} 的区间收益不是有限数：检查价格量级"
                else:
                    entry.update({
                        "status": "computed",
                        "first_date": first["day"],
                        "first_price": first["price"],
                        "last_date": last["day"],
                        "last_price": last["price"],
                        "return": _round(exact),
                        "contribution": _round(position["weight"] * exact),
                    })
                    weighted.append(position["weight"] * exact)
        if reason is not None:
            reasons.append(reason)
        rows.append(entry)
    if reasons:
        return rows, reasons, None, None
    portfolio_return = _round(math.fsum(weighted))
    return rows, reasons, portfolio_return, portfolio_return


def _sample(values):
    """First few raw time values in a gap message; enough to locate the bad rows, not a data dump."""
    shown = "、".join("<缺失>" if value is None else str(value) for value in values[:5])
    return shown if len(values) <= 5 else f"{shown} 等 {len(values)} 行"


def _summary(positions, windows, metrics, gaps):
    computed = [window for window in windows if window["portfolio_return"] is not None]
    parts = [
        "历史窗口回放（不是假设情景、不预测未来）",
        f"{len(positions)} 个持仓 / {len(windows)} 个窗口",
        f"权重最大 {_pct(metrics['max_weight'])}（HHI {_ratio(metrics['hhi'])}）",
    ]
    if computed:
        parts.append("窗口收益：" + "、".join(
            f"{window['name']} {_pct(window['portfolio_return'])}" for window in computed
        ))
        parts.append(f"最差窗口 {_pct(metrics['worst_window_return'])}、最好窗口 {_pct(metrics['best_window_return'])}")
    else:
        parts.append("所有窗口都没有可回放的区间收益")
    missing = len(windows) - len(computed)
    if computed and missing:
        parts.append(f"{missing} 个窗口没有可回放的区间收益")
    if gaps:
        parts.append(f"{len(gaps)} 项缺口（见 data_gaps）")
    return "；".join(parts) + "。"


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


def analyze(request: dict, context) -> dict:
    params = request.get("params") or {}
    positions = _positions(params)
    windows = _windows(params)
    price_override = _text(params.get("price_column"), "price_column")
    time_override = _text(params.get("time_column"), "time_column")
    tz_name = _text(params.get("timezone"), "timezone")
    tz = _timezone(tz_name)

    views = _views(request, context, positions)
    series_by_id, dataset_rows = {}, []
    gaps = []
    limitations = list(LIMITATIONS)
    methodology = [
        f"持仓 {len(positions)} 个、窗口 {len(windows)} 个；权重合计 {_fmt6(math.fsum(p['weight'] for p in positions))}"
        "（容差 1e-6）",
    ]
    for position in positions:
        dataset_id = position["dataset_id"]
        view = views[dataset_id]
        if view.get("truncated"):
            limitations.append(f"Dataset {dataset_id} 超过 max_input_rows：回放只用到前 {len(view.get('rows') or [])} 行")
        time_column = _time_column(view, dataset_id, time_override)
        price_column = _price_column(view, dataset_id, price_override)
        points, dropped = _series(view, dataset_id, time_column, price_column, tz)
        series_by_id[dataset_id] = {"points": points}
        if dropped:
            gaps.append(
                f"Dataset {dataset_id}：跳过 {len(dropped)} 行（时间无法解析、价格缺失或非正）：{_sample(dropped)}"
            )
        coverage = None
        if points:
            coverage = {
                "first_date": points[0]["day"],
                "first_price": points[0]["price"],
                "last_date": points[-1]["day"],
                "last_price": points[-1]["price"],
            }
        dataset_rows.append({
            "dataset_id": dataset_id,
            "weight": position["weight"],
            "time_column": time_column,
            "price_column": price_column,
            "observations": len(points),
            "skipped_rows": len(dropped),
            "coverage": coverage,
        })
        span = "（没有可用价格）" if coverage is None else f"（{coverage['first_date']}..{coverage['last_date']}）"
        methodology.append(
            f"Dataset {dataset_id}：时间列 {time_column}、价格列 {price_column}，"
            f"有效价格 {len(points)} 个{span}，跳过 {len(dropped)} 行"
        )

    window_rows = []
    for window in windows:
        rows, reasons, portfolio_return, contribution_sum = _evaluate_window(window, positions, series_by_id)
        prefix = f"窗口 {window['name']}（{window['start']}..{window['end']}）"
        for reason in reasons:
            gaps.append(f"{prefix}：{reason}")
        if reasons:
            gaps.append(
                f"{prefix}：{len(reasons)}/{len(positions)} 个持仓缺区间收益，"
                "组合收益未计算（不按剩余权重重归一化）"
            )
        window_rows.append({
            "name": window["name"],
            "start": window["start"],
            "end": window["end"],
            "status": "computed" if portfolio_return is not None else "missing",
            "portfolio_return": portfolio_return,
            "contribution_sum": contribution_sum,
            "positions": rows,
        })

    weights = [position["weight"] for position in positions]
    metrics = {
        "positions_count": len(positions),
        "windows_count": len(windows),
        "hhi": _round(math.fsum(weight * weight for weight in weights)),
        "max_weight": _round(max(weights)),
    }
    computed_returns = [
        window["portfolio_return"] for window in window_rows if window["portfolio_return"] is not None
    ]
    for index, window in enumerate(window_rows):
        if window["portfolio_return"] is not None:
            metrics[f"window_{index + 1}_return"] = window["portfolio_return"]
    if computed_returns:
        metrics["worst_window_return"] = min(computed_returns)
        metrics["best_window_return"] = max(computed_returns)

    if not computed_returns:
        status = "blocked"
    elif gaps:
        status = "partial"
    else:
        status = "completed"

    methodology.extend([
        "逐窗口取窗口内首个与最后一个可用收盘价：ret = last / first − 1；同一 bar 不能同时当起点和终点",
        "组合收益 = Σ 权重 × 持仓窗口收益（逐窗口加权和）；贡献 = 权重 × 持仓窗口收益；不做重归一化",
        f"集中度只用权重：HHI = Σ w² = {_fmt6(metrics['hhi'])}、max_weight = {_pct(metrics['max_weight'])}",
        f"{len(computed_returns)}/{len(window_rows)} 个窗口算出组合收益；{len(gaps)} 项缺口",
    ])

    summary = _summary(positions, window_rows, metrics, gaps)
    if status == "blocked":
        context.log(f"{MODULE_ID}: blocked windows={len(windows)} gaps={len(gaps)}")
        return _result(status, summary, metrics, methodology, limitations, gaps, [])

    payload = {
        "protocol": "capital.analysis/v1",
        "module_id": MODULE_ID,
        "module_version": MODULE_VERSION,
        "analysis_id": request.get("analysis_id"),
        "module_run_id": request.get("module_run_id"),
        "parameters": {
            "price_column": price_override,
            "time_column": time_override,
            "timezone": tz_name,
        },
        "method": {
            "window_return": "last_price / first_price − 1（窗口内首个与最后一个可用收盘）",
            "portfolio_return": "Σ weight × window_return（全部持仓都算出时才计算，不按剩余权重重归一化）",
            "contribution": "weight × window_return",
            "hhi": "Σ weight²",
            "max_weight": "max(weight)",
        },
        "positions": dataset_rows,
        "windows": window_rows,
        "metrics": metrics,
        "concentration": {"hhi": metrics["hhi"], "max_weight": metrics["max_weight"]},
        "data_gaps": gaps,
    }
    ref = context.write_output(OUTPUT_NAME, payload)
    context.log(f"{MODULE_ID}: {status} windows={len(windows)} computed={len(computed_returns)} gaps={len(gaps)}")
    return _result(status, summary, metrics, methodology, limitations, gaps, [{"name": OUTPUT_NAME, "ref": ref}])
