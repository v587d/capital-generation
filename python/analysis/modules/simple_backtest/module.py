"""Moving-average backtest of one price series (the "price series" input shape of the module protocol).

Input is one Dataset with a time column and a positive price column. The caller picks one of two
long-only rules (`sma_cross` = fast/slow SMA crossover, `price_above_sma` = close above one SMA),
and the module reports what that rule did on that sample: a close-to-close equity curve, one record
per round trip, and the standard interval statistics. The signal is computed from bar t's close and
executed at bar t+1's close, so no close is used before it is knowable; nothing is optimised,
forecast, rated or recommended.

Pure standard library on purpose: no numpy/pandas, so the arithmetic is auditable line by line and
the module runs on the minimal analysis runtime.

Protocol: `docs/dev/senior-analysis.md` §1.9. `module.json` `assumptions` is repeated verbatim in
ASSUMPTIONS so describe_analysis_module and run_analysis cannot contradict each other.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

MODULE_ID = "simple_backtest"
MODULE_VERSION = "1.0.0"
OUTPUT_NAME = "simple_backtest"

RULES = ("sma_cross", "price_above_sma")
PRICE_COLUMNS = ("close", "adj_close", "close_price", "price", "nav")
TIME_COLUMNS = ("trade_date_ms", "date_ms", "period_end_ms", "datetime", "date", "trade_date", "time")
ISO_DAY = re.compile(r"^(\d{4}-\d{2}-\d{2})")
MIN_OBSERVATIONS_FOR_STABLE = 20

ASSUMPTIONS = [
    "信号在第 t 根收盘算出、按第 t+1 根收盘执行：不使用未来数据，也不假设盘中成交",
    "只做多、空仓二态：持有期收益按收盘价到收盘价，卖出后空仓收益为 0",
    "手续费按单边 fee_rate 从每次买入与卖出金额中扣除；默认 0 时必须原样披露“未扣手续费”",
    "回测使用样本内价格：参数是调用方给的，模块不做参数寻优、不选择最佳窗口，也不做样本外检验",
    "结果只描述这段历史上该规则发生了什么；不构成策略推荐、收益预测或评级",
]

LIMITATIONS = [
    "信号按收盘价成交：不模拟盘中价格、滑点、冲击成本、涨跌停买不到卖不掉与停牌无法成交的情形",
    "价格口径沿用 Dataset 的取数参数（qfq / hfq / none）；本模块不检测也不做复权调整，除权跳变会原样进入净值",
    "只做多、空仓二态，不做空、杠杆、组合或仓位管理；initial_capital 只缩放净值规模，不改变收益率",
    "回测是样本内的：参数由调用方给定，不做参数寻优、窗口选择、样本外检验或统计显著性检验",
    "未计分红再投资、融资融券费用、税费与借券成本；fee_rate=0 时结果是未扣手续费的名义净值",
    "历史结果不预测未来；不构成投资建议，也不产生评级、目标价或收益承诺",
]


class AnalysisInputError(Exception):
    """The input cannot be used at all; the host maps `analysis_code` to the stable protocol code."""

    analysis_code = "analysis_input_invalid"


def _round(value):
    rounded = round(float(value), 6)
    return 0.0 if rounded == 0 else rounded


def _fmt6(value):
    """Six decimals with trailing zeros trimmed: the same shape the metrics are rounded to."""
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
        "找不到价格列：需要 close / adj_close / close_price / price / nav 之一（或用 price_column 指明）；"
        f"现有列：{sorted(names)}"
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


def _sample(values):
    shown = "、".join(str(value) for value in values[:5])
    return shown if len(values) <= 5 else f"{shown} 等 {len(values)} 行"


def _series(view, dataset_id, price_column, time_column, tz):
    rows = view.get("rows") or []
    if not rows:
        raise AnalysisInputError(f"Dataset {dataset_id} 没有数据行：无法回测")
    points, dropped, kind = [], [], None
    for row in rows:
        if not isinstance(row, dict):
            raise AnalysisInputError(f"Dataset {dataset_id} 的数据行不是对象：无法回测")
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


def _window(params, name, required):
    value = params.get(name)
    if value is None:
        if required:
            raise AnalysisInputError(f"sma_cross 需要 {name}（且必须大于 fast_window）")
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise AnalysisInputError(f"{name}={value!r} 必须是整数")
    if value < 2:
        raise AnalysisInputError(f"{name}={value} 至少为 2（均线窗口不能是 1）")
    return value


def _capital(params):
    value = params.get("initial_capital", 1.0)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AnalysisInputError(f"initial_capital={value!r} 必须是数字")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")) or number <= 0:
        raise AnalysisInputError(f"initial_capital={value!r} 必须是正的有限数字")
    return number


def _fee(params):
    value = params.get("fee_rate", 0.0)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AnalysisInputError(f"fee_rate={value!r} 必须是数字（小数，0.001 = 0.1%）")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")) or not 0 <= number < 1:
        raise AnalysisInputError(f"fee_rate={value!r} 必须在 [0, 1) 内（单边费率，0.001 = 0.1%）")
    return number


def _parameters(params):
    rule = params.get("rule")
    if rule not in RULES:
        raise AnalysisInputError(f"rule={rule!r} 只能是 sma_cross 或 price_above_sma")
    fast = _window(params, "fast_window", required=True)
    slow = _window(params, "slow_window", required=rule == "sma_cross")
    if rule == "sma_cross" and slow <= fast:
        raise AnalysisInputError(f"slow_window={slow} 必须大于 fast_window={fast}：快慢线不能相等或反置")
    return {
        "rule": rule,
        "fast_window": fast,
        "slow_window": slow if rule == "sma_cross" else None,
        "initial_capital": _capital(params),
        "fee_rate": _fee(params),
    }


def _sma(closes, window):
    n = len(closes)
    prefix, total = [], 0.0
    for close in closes:
        total += close
        prefix.append(total)
    values = [None] * n
    for index in range(window - 1, n):
        before = prefix[index - window] if index >= window else 0.0
        values[index] = (prefix[index] - before) / window
    return values


def _targets(closes, rule, fast, slow):
    """Desired state at each bar's close; `None` while a window is not yet full."""
    n = len(closes)
    fast_sma = _sma(closes, fast)
    slow_sma = _sma(closes, slow) if slow is not None else None
    targets = [None] * n
    if rule == "price_above_sma":
        for index in range(fast - 1, n):
            targets[index] = 1 if closes[index] > fast_sma[index] else 0
        return targets, fast_sma, slow_sma
    state = 0
    for index in range(slow - 1, n):
        if fast_sma[index] > slow_sma[index]:
            state = 1
        elif fast_sma[index] < slow_sma[index]:
            state = 0
        targets[index] = state
    return targets, fast_sma, slow_sma


def _backtest(points, targets, fee_rate, initial_capital):
    """Walk the bars once. A signal at t is executed at t+1's close; a held bar earns close-to-close."""
    closes = [point["price"] for point in points]
    n = len(closes)
    equity = [initial_capital]
    position = [0]
    trades, current = [], None
    for bar in range(1, n):
        value = equity[bar - 1]
        if position[bar - 1] == 1:
            value *= closes[bar] / closes[bar - 1]
        action = targets[bar - 1]
        still = position[bar - 1]
        if action == 1 and still == 0:
            value *= 1.0 - fee_rate
            still = 1
            current = {"entry_index": bar, "entry_price": closes[bar], "equity_before": equity[bar - 1]}
        elif action == 0 and still == 1:
            value *= 1.0 - fee_rate
            still = 0
            trades.append({
                "open": False,
                "entry_index": current["entry_index"],
                "entry_price": current["entry_price"],
                "exit_index": bar,
                "exit_price": closes[bar],
                "bars": bar - current["entry_index"],
                "price_return": closes[bar] / current["entry_price"] - 1.0,
                "net_return": value / current["equity_before"] - 1.0,
            })
            current = None
        equity.append(value)
        position.append(still)
    if current is not None:
        trades.append({
            "open": True,
            "entry_index": current["entry_index"],
            "entry_price": current["entry_price"],
            "last_index": n - 1,
            "last_price": closes[-1],
            "bars": n - current["entry_index"],
            "price_return": closes[-1] / current["entry_price"] - 1.0,
        })
    for trade in trades:
        trade["win"] = (not trade["open"]) and trade["net_return"] > 0
    return closes, equity, position, trades


def _metrics(equity, closes, position, trades, initial_capital):
    peak, max_drawdown = equity[0], 0.0
    for value in equity:
        peak = max(peak, value)
        max_drawdown = min(max_drawdown, value / peak - 1.0)
    closed = [trade for trade in trades if not trade["open"]]
    bars = sum(position)
    metrics = {
        "observations": len(closes),
        "total_return": _round(equity[-1] / initial_capital - 1.0),
        "buy_and_hold_return": _round(closes[-1] / closes[0] - 1.0),
        "max_drawdown": _round(max_drawdown),
        "final_equity": _round(equity[-1]),
        "trade_count": len(closed),
        "exposure_bars": bars,
        "exposure_ratio": _round(bars / len(closes)),
    }
    if closed:
        metrics["win_rate"] = _round(sum(1 for trade in closed if trade["win"]) / len(closed))
    return metrics


def _trade_rows(trades, points):
    rows = []
    for number, trade in enumerate(trades, start=1):
        entry = points[trade["entry_index"]]
        if trade["open"]:
            rows.append({
                "trade": number,
                "open": True,
                "entry_date": entry["day"],
                "entry_price": _round(trade["entry_price"]),
                "entry_index": trade["entry_index"],
                "last_date": points[trade["last_index"]]["day"],
                "last_price": _round(trade["last_price"]),
                "bars": trade["bars"],
                "price_return": _round(trade["price_return"]),
            })
            continue
        exit_ = points[trade["exit_index"]]
        rows.append({
            "trade": number,
            "open": False,
            "entry_date": entry["day"],
            "entry_price": _round(trade["entry_price"]),
            "entry_index": trade["entry_index"],
            "exit_date": exit_["day"],
            "exit_price": _round(trade["exit_price"]),
            "exit_index": trade["exit_index"],
            "bars": trade["bars"],
            "price_return": _round(trade["price_return"]),
            "net_return": _round(trade["net_return"]),
            "win": trade["win"],
        })
    return rows


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


def _rule_text(rule, fast, slow):
    if rule == "sma_cross":
        return f"sma_cross（fast {fast} / slow {slow}）"
    return f"price_above_sma（close 对 SMA{fast}）"


def _fee_text(fee_rate):
    if fee_rate == 0:
        return "单边手续费 0（未扣手续费）"
    return f"单边手续费 {_pct(fee_rate)}"


DISCLAIMER = "样本内回测、参数由调用方给定、未做参数寻优；不预测、不构成策略推荐。"


def _summary(metrics, rule, fast, slow, fee_rate, points, dropped, gaps, open_trades):
    start, end = points[0]["day"], points[-1]["day"]
    head = f"{start}..{end}（有效观测 {len(points)} 个"
    head += f"，跳过 {len(dropped)} 行）" if dropped else "）"
    rule_text = _rule_text(rule, fast, slow)
    parts = [
        f"区间收益 {_pct(metrics['total_return'])}",
        f"买入持有 {_pct(metrics['buy_and_hold_return'])}",
        f"最大回撤 {_pct(metrics['max_drawdown'])}",
        f"期末净值 {_fmt6(metrics['final_equity'])}",
    ]
    trade_text = f"完整往返 {metrics['trade_count']} 笔"
    if "win_rate" in metrics:
        trade_text += f"、胜率 {_pct(metrics['win_rate'])}"
    else:
        trade_text += "（没有平仓交易，胜率无定义）"
    if open_trades:
        trade_text += f"、未平仓 {open_trades} 笔"
    parts.append(trade_text)
    parts.append(f"持有占比 {_pct(metrics['exposure_ratio'])}（{metrics['exposure_bars']}/{len(points)} 根）")
    parts.append(_fee_text(fee_rate))
    body = f"{head}，{rule_text}：" + "；".join(parts) + "。"
    if gaps:
        body += f"有 {len(gaps)} 项缺口，见 data_gaps。"
    return body + DISCLAIMER


def _blocked_summary(rule, fast, slow, points, required):
    start, end = points[0]["day"], points[-1]["day"]
    head = f"{start}..{end}（有效观测 {len(points)} 个）"
    return (
        f"{head}：{_rule_text(rule, fast, slow)} 样本不足，未回测"
        f"（需要 max 窗口 + 2 = {required} 个有效观测，实际 {len(points)} 个）。" + DISCLAIMER
    )


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
                f"Dataset {dataset_id} 是 {view.get('shape')} 型：simple_backtest 只吃价格表格，"
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
    settings = _parameters(params)
    rule, fast, slow = settings["rule"], settings["fast_window"], settings["slow_window"]
    fee_rate = settings["fee_rate"]

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
    tz_name = _text(params.get("timezone")) or "UTC"
    tz = _timezone(_text(params.get("timezone")))
    points, dropped = _series(price_view, price_dataset_id, price_column, time_column, tz)
    if not points:
        raise AnalysisInputError(f"Dataset {price_dataset_id} 没有有效价格观测：无法回测")

    n = len(points)
    max_window = max(fast, slow if slow is not None else 0)
    required = max_window + 2
    methodology = [
        f"价格 Dataset {price_dataset_id}：时间列 {time_column}、价格列 {price_column}；数值时间轴按 {tz_name} 标注日历日",
        f"按时间升序 {n} 个有效观测" + (f"；跳过 {len(dropped)} 行（时间无法解析或价格非正）" if dropped else "；无跳过行"),
        f"规则 {_rule_text(rule, fast, slow)}；initial_capital={_fmt6(settings['initial_capital'])}、"
        f"fee_rate={fee_rate:g}（{_fee_text(fee_rate)}）",
        "信号在第 t 根收盘用截至 t 的收盘价算出，第 t+1 根收盘成交；净值按收盘到收盘，空仓日不变",
    ]
    if rule != "sma_cross" and params.get("slow_window") is not None:
        methodology.append("price_above_sma 是单均线规则：传入的 slow_window 未生效（结果里记为 null）")
    limitations = list(LIMITATIONS)
    gaps = []
    if dropped:
        gaps.append(
            f"价格列 {price_column} 有 {len(dropped)} 行不是正数或时间无法解析（已跳过）：{_sample(dropped)}"
        )
        limitations.append(f"跳过 {len(dropped)} 行后按剩余观测重排 bar 序号，均线窗口因此跨过被跳过的日期")

    if n < required:
        gaps.insert(0, (
            f"有效观测不足 {required} 个（实际 {n} 个）：{rule} 用 fast_window={fast}"
            + (f" / slow_window={slow}" if slow is not None else "")
            + f"，需要 max 窗口 + 2 = {required} 个有效观测（填满窗口才出信号、下一根才成交）"
        ))
        methodology.append(f"有效观测 {n} < {required}：未计算净值曲线、交易与统计")
        return _result(
            "blocked",
            _blocked_summary(rule, fast, slow, points, required),
            {},
            methodology,
            limitations,
            gaps,
            [],
        )

    closes = [point["price"] for point in points]
    targets, fast_sma, slow_sma = _targets(closes, rule, fast, slow)
    closes, equity, position, trades = _backtest(points, targets, fee_rate, settings["initial_capital"])
    metrics = _metrics(equity, closes, position, trades, settings["initial_capital"])
    closed = [trade for trade in trades if not trade["open"]]
    open_trades = len(trades) - len(closed)
    if not closed:
        gaps.append("没有已平仓交易：win_rate 无定义（不写 0）")
        limitations.append("没有已平仓交易：win_rate 缺省，交易层面的统计给不出来，不是 0%")
    if open_trades:
        limitations.append(f"期末仍有 {open_trades} 笔未平仓交易：total_return 含未实现浮动盈亏，net_return 只对已平仓交易给")
    if fee_rate == 0:
        limitations.append("本次 fee_rate=0（未扣手续费）：净值不含任何交易成本，不是策略本身没有成本")
    if n < MIN_OBSERVATIONS_FOR_STABLE:
        limitations.append(f"只有 {n} 个有效观测：样本很短，胜率与净值对个别交易日敏感，只能作方向性参考")
    status = "partial" if gaps else "completed"
    methodology.append(
        f"完整往返 {len(closed)} 笔、未平仓 {open_trades} 笔；"
        f"持有占比 {metrics['exposure_bars']}/{n} = {_fmt6(metrics['exposure_ratio'])}"
    )
    methodology.append(f"{len(gaps)} 项缺口")

    series = []
    for index, point in enumerate(points):
        row = {
            "date": point["day"],
            "close": _round(closes[index]),
            "sma_fast": None if fast_sma[index] is None else _round(fast_sma[index]),
        }
        if slow_sma is not None:
            row["sma_slow"] = None if slow_sma[index] is None else _round(slow_sma[index])
        row.update({
            "signal": targets[index],
            "position": position[index],
            "equity": _round(equity[index]),
        })
        series.append(row)

    payload = {
        "protocol": "capital.analysis/v1",
        "module_id": MODULE_ID,
        "module_version": MODULE_VERSION,
        "analysis_id": request.get("analysis_id"),
        "module_run_id": request.get("module_run_id"),
        "price_dataset_id": price_dataset_id,
        "time_column": time_column,
        "price_column": price_column,
        "rule": rule,
        "parameters": {
            "rule": rule,
            "fast_window": fast,
            "slow_window": slow,
            "initial_capital": settings["initial_capital"],
            "fee_rate": fee_rate,
            "timezone": tz_name,
        },
        "window": {
            "start": points[0]["day"],
            "end": points[-1]["day"],
            "observations": n,
            "skipped_rows": len(dropped),
        },
        "statistics": metrics,
        "series": series,
        "trades": _trade_rows(trades, points),
        "data_gaps": gaps,
    }
    ref = context.write_output(OUTPUT_NAME, payload)
    context.log(
        f"{MODULE_ID}: {status} observations={n} trades={metrics['trade_count']} "
        f"open={open_trades} gaps={len(gaps)}"
    )
    return _result(
        status,
        _summary(metrics, rule, fast, slow, fee_rate, points, dropped, gaps, open_trades),
        metrics,
        methodology,
        limitations,
        gaps,
        [{"name": OUTPUT_NAME, "ref": ref}],
    )
