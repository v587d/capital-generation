"""Daily K-line cleaning and quality audit (the "OHLC series" input shape of the module protocol).

Input is one Dataset whose rows are one bar per trading day. Every row is checked against the hard
rules spelled out in the manifest assumptions; a failing row is rejected with a stable reason code,
and the surviving bars form the cleaned series. Soft flags (a close-to-close move above the caller's
`jump_threshold`, missing or zero volume) never remove a bar — they are marked, counted and handed to
the auditor. Nothing here forecasts, rates or recommends, and a missing volume is never read as zero.

Pure standard library on purpose: no numpy/pandas, so every rule is auditable line by line and the
module runs on the minimal analysis runtime.

Protocol: `docs/dev/senior-analysis.md` §1.9. Conclusions and claims belong to the senior analyst;
this module only produces the cleaned series plus the evidence behind every rejection.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

MODULE_ID = "kline_quality"
MODULE_VERSION = "1.0.0"
OUTPUT_NAME = "kline_quality"

JUMP_THRESHOLD_DEFAULT = 0.5
OHLC_COLUMNS = ("open", "high", "low", "close")
TIME_COLUMNS = ("trade_date_ms", "date_ms", "period_end_ms", "datetime", "date", "trade_date", "time")
ISO_DAY = re.compile(r"^(\d{4}-\d{2}-\d{2})")

REJECT_TIME = "time_unparseable"
REJECT_PRICE = "price_invalid"
REJECT_HIGH = "high_below_max"
REJECT_LOW = "low_above_min"
REJECT_DUPLICATE = "duplicate_date"
REJECT_REASONS = (REJECT_TIME, REJECT_PRICE, REJECT_HIGH, REJECT_LOW, REJECT_DUPLICATE)

ASSUMPTIONS = [
    "一根 bar 合法当且仅当：时间可解析、open/high/low/close 都是正数、high ≥ max(open, close, low)、low ≤ min(open, close, high)",
    "时间列是 ISO 日期（YYYY-MM-DD）或 epoch 毫秒；同一交易日出现多行时保留第一行时间，其余行以 duplicate_date 拒绝并计数",
    "成交量缺失或为 0 不当作 0 参与统计：只标 volume_missing，价格 bar 仍进清洗序列",
    "价格口径沿用 Dataset 的取数参数（qfq / hfq / none）；本模块不检测也不做复权调整，除权日的跳变可能被标成可疑",
    "jump_threshold 只用于标记可疑 bar，不删除、不改写价格；阈值由调用方给出并写进结果，不是涨跌预测",
    "清洗序列只是通过硬校验的 bar：不代表数据完整，也不代表可以据此交易",
]

LIMITATIONS = [
    "清洗序列只代表通过硬校验的 bar，不代表数据完整，也不构成交易建议",
    "价格口径沿用 Dataset 的取数参数（qfq / hfq / none）；本模块不检测也不做复权调整，除权日的跳变可能被标成可疑",
    "时间列是 ISO 日期（YYYY-MM-DD）或 epoch 毫秒；数值时间轴按参数 timezone 标注日历日（省略按 UTC）",
    "成交量缺失或为 0 的 bar 只标记、不剔除，也不当作 0 参与任何统计",
    "jump_threshold 只标记可疑 bar，不猜原因：除权、停牌复牌与数据错误都可能呈现同一形态",
    "不构成投资建议，也不产生评级、目标价或收益承诺",
]


class AnalysisInputError(Exception):
    """The input cannot be used at all; the host maps `analysis_code` to the stable protocol code."""

    analysis_code = "analysis_input_invalid"


def _round(value):
    rounded = round(float(value), 6)
    return 0.0 if rounded == 0 else rounded


def _fmt6(value):
    """Six decimals, trailing zeros trimmed: readable in prose, still the stored precision."""
    text = f"{_round(value):.6f}".rstrip("0").rstrip(".")
    return text if text not in ("", "-0") else "0"


def _pct(value):
    return f"{value * 100:.2f}%"


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
    """Declared columns plus the keys of every row: a sampled schema can miss a late volume column."""
    names = set()
    for item in view.get("columns") or []:
        if isinstance(item, dict):
            name = item.get("name")
            if isinstance(name, str):
                names.add(name)
    for row in view.get("rows") or []:
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
        "找不到时间列：需要 time_coverage 列，或 trade_date_ms / date_ms / period_end_ms / datetime / date / trade_date / time 之一"
    )


def _require_ohlc(view, dataset_id):
    names = _columns_of(view)
    missing = [name for name in OHLC_COLUMNS if name not in names]
    if missing:
        raise AnalysisInputError(
            f"Dataset {dataset_id} 缺少 OHLC 列：缺 {'、'.join(missing)}；"
            f"K 线清洗需要 open/high/low/close 四列（volume 可选）。现有列：{sorted(names)}"
        )


def _threshold(value):
    if value is None:
        return JUMP_THRESHOLD_DEFAULT
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AnalysisInputError(f"jump_threshold={value!r} 必须是数字（小数，0.5 = 50%）")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")) or number < 0:
        raise AnalysisInputError(f"jump_threshold={value!r} 必须是非负有限数字（小数，0.5 = 50%）")
    return number


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


def _raw_values(row, names):
    """Original cell values for the audit trail; a missing cell simply omits its key (no nulls)."""
    values = {}
    for name in names:
        if name in row:
            values[name] = row[name]
    return values


def _rejected(index, day, reason, raw):
    entry = {"index": index, "reason": reason, "values": raw}
    if day is not None:
        entry["date"] = day
    return entry


def _clean(rows, dataset_id, time_column, volume_column, tz, threshold):
    """One pass: hard rules reject, soft flags mark. Returns cleaned bars plus the audit trail."""
    raw_names = (time_column,) + OHLC_COLUMNS + ((volume_column,) if volume_column is not None else ())
    bars, rejected, suspects, volume_missing = [], [], [], []
    seen_days = set()
    time_kinds = set()
    max_change = 0.0
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise AnalysisInputError(f"Dataset {dataset_id} 的数据行不是对象：无法清洗")
        raw_time = row.get(time_column)
        if isinstance(raw_time, (int, float)) and not isinstance(raw_time, bool):
            time_kinds.add("epoch_ms")
        elif isinstance(raw_time, str):
            time_kinds.add("iso_date")
        raw = _raw_values(row, raw_names)
        parsed = _parse_time(raw_time, tz)
        if parsed is None:
            rejected.append(_rejected(index, None, REJECT_TIME, raw))
            continue
        key, day = parsed
        prices = {name: _number(row, name) for name in OHLC_COLUMNS}
        if any(value is None or value <= 0 for value in prices.values()):
            rejected.append(_rejected(index, day, REJECT_PRICE, raw))
            continue
        open_, high, low, close = (prices[name] for name in OHLC_COLUMNS)
        if high < max(open_, close, low):
            rejected.append(_rejected(index, day, REJECT_HIGH, raw))
            continue
        if low > min(open_, close, high):
            rejected.append(_rejected(index, day, REJECT_LOW, raw))
            continue
        if day in seen_days:
            rejected.append(_rejected(index, day, REJECT_DUPLICATE, raw))
            continue
        seen_days.add(day)
        bar = {
            "index": index,
            "key": key,
            "date": day,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume_checked": volume_column is not None,
            "volume_ok": True,
        }
        if volume_column is not None:
            volume = _number(row, volume_column)
            if volume is None or volume <= 0:
                bar["volume_ok"] = False
                if volume_column in row:
                    bar["volume_raw"] = row[volume_column]
            else:
                bar["volume"] = volume
        bars.append(bar)

    bars.sort(key=lambda bar: (bar["key"], bar["index"]))
    for position, bar in enumerate(bars):
        if position > 0:
            change = bar["close"] / bars[position - 1]["close"] - 1.0
            max_change = max(max_change, abs(change))
            if abs(change) > threshold:
                suspects.append({
                    "index": position,
                    "date": bar["date"],
                    "previous_close": _round(bars[position - 1]["close"]),
                    "close": _round(bar["close"]),
                    "change": _round(change),
                })
        if bar["volume_checked"] and not bar["volume_ok"]:
            entry = {"index": position, "date": bar["date"]}
            if "volume_raw" in bar:
                entry["volume"] = bar["volume_raw"]
            volume_missing.append(entry)

    if time_kinds == {"epoch_ms"}:
        time_format = "epoch_ms"
    elif time_kinds == {"iso_date"}:
        time_format = "iso_date"
    elif time_kinds:
        time_format = "mixed"
    else:
        time_format = "unknown"
    return bars, rejected, suspects, volume_missing, max_change, time_format


def _series_row(bar):
    row = {
        "date": bar["date"],
        "open": _round(bar["open"]),
        "high": _round(bar["high"]),
        "low": _round(bar["low"]),
        "close": _round(bar["close"]),
    }
    if bar["volume_ok"] and "volume" in bar:
        row["volume"] = _round(bar["volume"])
    return row


def _breakdown(counts):
    parts = [f"{reason} {counts[reason]}" for reason in REJECT_REASONS if counts[reason] > 0]
    return "、".join(parts) if parts else "无"


def _summary(metrics, counts):
    parts = []
    if metrics["rows_cleaned"] > 0:
        parts.append(
            f"{metrics['first_date']}..{metrics['last_date']}，共 {metrics['rows_total']} 行、"
            f"清洗后 {metrics['rows_cleaned']} 根 bar（{metrics['trading_days']} 个交易日）"
        )
        if metrics["rejected_rows"] > 0:
            parts.append(f"拒绝 {metrics['rejected_rows']} 行（{_breakdown(counts)}）")
        else:
            parts.append("无硬校验拒绝")
        if metrics["suspect_rows"] > 0:
            parts.append(
                f"可疑跳变 {metrics['suspect_rows']} 行（阈值 {_pct(metrics['jump_threshold'])}，"
                f"最大相邻涨跌幅 {_pct(metrics['max_abs_daily_change'])}）"
            )
        else:
            parts.append(f"无超过 {_pct(metrics['jump_threshold'])} 的相邻跳变")
    else:
        parts.append(
            f"共 {metrics['rows_total']} 行，清洗后没有合法 bar：拒绝 {metrics['rejected_rows']} 行"
            f"（{_breakdown(counts)}）"
        )
    if metrics["rows_cleaned"] > 0:
        if metrics["volume_missing_rows"] > 0:
            parts.append(f"成交量缺失或为 0 的 bar {metrics['volume_missing_rows']} 行（不当 0 参与统计）")
        else:
            parts.append("成交量无缺失标记")
        parts.append(f"区间收盘 {_fmt6(metrics['first_close'])}..{_fmt6(metrics['last_close'])}")
    else:
        parts.append(f"jump_threshold={_fmt6(metrics['jump_threshold'])}")
    head = "；".join(parts) + "。"
    return head + "清洗序列只代表通过硬校验，不是数据完整或交易建议。"


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
        raise AnalysisInputError("快照里没有任何 Dataset：先取一份日 K 行情再建快照")
    views = {}
    for item in items:
        dataset_id = (item or {}).get("dataset_id")
        if not isinstance(dataset_id, str) or not dataset_id:
            raise AnalysisInputError("request.inputs.datasets 里有缺失 dataset_id 的条目")
        views[dataset_id] = context.read_dataset(dataset_id)
    for dataset_id, view in views.items():
        if view.get("shape") != "rows":
            raise AnalysisInputError(
                f"Dataset {dataset_id} 是 {view.get('shape')} 型：kline_quality 只吃表格数据，"
                "文档型输入请先走 profile 或证据"
            )
    return views


def _candidates(views, time_override):
    """Dataset ids that look like a daily OHLC table: a time column plus all four OHLC columns."""
    candidates = []
    for dataset_id, view in sorted(views.items()):
        names = _columns_of(view)
        if any(name not in names for name in OHLC_COLUMNS):
            continue
        try:
            time_column = _time_column(view, time_override)
        except AnalysisInputError:
            continue
        candidates.append((dataset_id, time_column))
    return candidates


def analyze(request: dict, context) -> dict:
    params = request.get("params") or {}
    views = _read_views(request, context)
    time_override = _text(params.get("time_column"))

    price_dataset_id = _text(params.get("price_dataset_id"))
    if price_dataset_id is not None:
        if price_dataset_id not in views:
            raise AnalysisInputError(f"price_dataset_id={price_dataset_id} 不在本次快照的 Dataset 里")
        price_view = views[price_dataset_id]
    else:
        candidates = _candidates(views, time_override)
        if len(candidates) > 1:
            raise AnalysisInputError(
                f"有 {len(candidates)} 份 Dataset 都像日 K 表（{'、'.join(item[0] for item in candidates)}）："
                "用 price_dataset_id 指明用哪一份"
            )
        if not candidates:
            detail = f"（time_column={time_override} 不在任何 Dataset 里）" if time_override else ""
            raise AnalysisInputError(
                f"没有可识别的日 K Dataset{detail}：需要 open/high/low/close 四列 + 时间列"
                "（time_coverage 或 trade_date_ms / date / time 等）"
            )
        price_dataset_id = candidates[0][0]
        price_view = views[price_dataset_id]

    rows = price_view.get("rows") or []
    if not rows:
        raise AnalysisInputError(f"Dataset {price_dataset_id} 没有数据行：没有可清洗的 K 线")

    time_column = _time_column(price_view, time_override)
    _require_ohlc(price_view, price_dataset_id)
    volume_column = "volume" if "volume" in _columns_of(price_view) else None
    tz = _timezone(_text(params.get("timezone")))
    threshold = _threshold(params.get("jump_threshold"))

    bars, rejected, suspects, volume_missing, max_change, time_format = _clean(
        rows, price_dataset_id, time_column, volume_column, tz, threshold
    )
    counts = {reason: 0 for reason in REJECT_REASONS}
    for entry in rejected:
        counts[entry["reason"]] += 1

    metrics = {
        "rows_total": len(rows),
        "rows_cleaned": len(bars),
        "rejected_rows": len(rejected),
        "suspect_rows": len(suspects),
        "volume_missing_rows": len(volume_missing),
        "duplicate_dates": counts[REJECT_DUPLICATE],
        "trading_days": len(bars),
        "jump_threshold": threshold,
        "max_abs_daily_change": _round(max_change),
    }
    for reason in REJECT_REASONS:
        metrics[f"rejected_{reason}"] = counts[reason]
    if bars:
        metrics["first_date"] = bars[0]["date"]
        metrics["last_date"] = bars[-1]["date"]
        metrics["first_close"] = _round(bars[0]["close"])
        metrics["last_close"] = _round(bars[-1]["close"])

    limitations = list(LIMITATIONS)
    if volume_column is None:
        limitations.append("Dataset 没有 volume 列：本次未做成交量体检（成交量缺失不计入 volume_missing_rows）")
    if time_format == "mixed":
        limitations.append("时间列混用了 epoch 毫秒与 ISO 日期：按各自解析后的时间排序，跨时区比较前先对齐口径")
    if price_view.get("truncated"):
        limitations.append(
            f"输入超过 max_input_rows 被截断：只清洗了前 {len(rows)} 行，不能据此判断整段序列的质量"
        )

    methodology = [
        f"行情 Dataset {price_dataset_id}：时间列 {time_column}、OHLC 列 open/high/low/close、"
        + (f"成交量列 {volume_column}" if volume_column is not None else "无成交量列"),
        f"时间轴 {time_format}，日期按 {_text(params.get('timezone')) or 'UTC'} 标注；"
        f"输入 {len(rows)} 行，清洗后 {len(bars)} 根 bar",
        f"硬校验拒绝 {len(rejected)} 行（{_breakdown(counts)}）；"
        f"软标记 suspect_jump {len(suspects)} 行、volume_missing {len(volume_missing)} 行",
        f"相邻收盘涨跌幅 = 清洗序列相邻两根 bar 的 close 比值 − 1，绝对值严格大于 {_fmt6(threshold)} 才标记；"
        f"{max(len(bars) - 1, 0)} 个相邻变化，最大绝对 {_fmt6(max_change)}",
    ]

    gaps = []
    if not bars:
        gaps.append(
            f"清洗后没有合法 bar：{len(rows)} 行全部被拒绝（{_breakdown(counts)}）："
            f"明细见 outputs/{OUTPUT_NAME}.json"
        )
    elif rejected:
        gaps.append(f"硬校验拒绝 {len(rejected)} 行（{_breakdown(counts)}）：明细见 outputs/{OUTPUT_NAME}.json")
    if suspects:
        gaps.append(
            f"相邻收盘涨跌幅超过阈值 {_pct(threshold)} 的 bar {len(suspects)} 行"
            f"（最大 {_pct(max_change)}）：已标 suspect_jump，保留在清洗序列"
        )

    if not bars:
        status = "blocked"
    elif rejected or suspects:
        status = "partial"
    else:
        status = "completed"

    payload = {
        "protocol": "capital.analysis/v1",
        "module_id": MODULE_ID,
        "module_version": MODULE_VERSION,
        "analysis_id": request.get("analysis_id"),
        "module_run_id": request.get("module_run_id"),
        "price_dataset_id": price_dataset_id,
        "columns": {
            "time": time_column,
            **{name: name for name in OHLC_COLUMNS},
            **({"volume": volume_column} if volume_column is not None else {}),
        },
        "time_axis": {
            "column": time_column,
            "format": time_format,
            "timezone": _text(params.get("timezone")) or "UTC",
        },
        "parameters": {
            "jump_threshold": threshold,
            "timezone": _text(params.get("timezone")) or "UTC",
        },
        "window": {
            "rows_total": len(rows),
            "rows_cleaned": len(bars),
            **({"start": bars[0]["date"], "end": bars[-1]["date"]} if bars else {}),
        },
        "statistics": metrics,
        "rejected": rejected,
        "suspects": suspects,
        "volume_missing": volume_missing,
        "series": [_series_row(bar) for bar in bars],
        "data_gaps": gaps,
    }
    ref = context.write_output(OUTPUT_NAME, payload)
    context.log(
        f"{MODULE_ID}: {status} rows={len(rows)} cleaned={len(bars)} rejected={len(rejected)} "
        f"suspect={len(suspects)} volume_missing={len(volume_missing)}"
    )

    return _result(
        status,
        _summary(metrics, counts),
        metrics,
        methodology,
        limitations,
        gaps,
        [{"name": OUTPUT_NAME, "ref": ref}],
    )
