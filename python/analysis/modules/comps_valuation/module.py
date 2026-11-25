"""Comparable multiples across one same-period cross-section.

The input is a peers table: one row per company, all money columns already on the same reporting
period and currency. The module computes P/E, P/B, P/S and EV/EBITDA per row, reports the
cross-sectional median with its valid sample count, and optionally places a subject company against
that median. It never fills a missing multiple with a default, never uses a negative-earnings P/E in
the median, and never turns the median into a rating or a target price.

Protocol: `docs/dev/senior-analysis.md` §1.9. Conclusions and claims belong to the senior analyst;
this module only produces reproducible multiples plus the input values behind each one.
"""
from __future__ import annotations

MODULE_ID = "comps_valuation"
MODULE_VERSION = "1.0.0"
OUTPUT_NAME = "comps"

# Mirrors module.json `assumptions`: a result must state the same caveats the manifest promises.
ASSUMPTIONS = [
    "一行是一家公司的一个同口径截面：市值、净利润、净资产、营收、企业价值与 EBITDA 必须同为同一报告期、同一币种；模块不检查跨期或跨币种混用",
    "P/E = market_cap / net_profit，只对净利润 > 0 的公司计算；亏损公司的 P/E 无经济含义，剔除并计数，不用负值参与中位数",
    "P/B = market_cap / equity、P/S = market_cap / revenue 只对分母 > 0 的公司计算",
    "EV/EBITDA 使用数据集自带的 enterprise_value 与 ebitda 两列；缺任一一列就不算，不用 market_cap + net_debt 反推",
    "截面统计只报中位数与有效样本数：样本 < 3 时中位数没有横截面意义，写进 limitations；不把均值或最高/最低值当估值结论",
    "可选标的的相对位置只是 same-period 截面上的溢价/折价，不构成目标价、评级或买卖建议",
]

LIMITATIONS = [
    "可比性是调用方选的：同行业、同商业模式与同会计口径不在本模块的校验范围内",
    "亏损、负净资产、零营收与缺失 EBITDA 的公司会退出对应倍数的样本；每项的剔除数在 metrics 里单独列出",
    "中位数只描述这一组 peer 的截面，不推断合理估值区间，也不代表市场价格应当回归中位数",
    "不构成投资建议，也不产生评级、目标价或收益承诺",
]

SIGNATURE = ("market_cap", "net_profit")
TICKER_COLUMNS = ("ticker", "thscode", "code")
MULTIPLES = (
    ("pe", "P/E", "market_cap", "net_profit"),
    ("pb", "P/B", "market_cap", "equity"),
    ("ps", "P/S", "market_cap", "revenue"),
    ("ev_ebitda", "EV/EBITDA", "enterprise_value", "ebitda"),
)


class AnalysisInputError(Exception):
    """The input cannot be used at all; the host maps `analysis_code` to the stable protocol code."""

    analysis_code = "analysis_input_invalid"


def _round(value):
    rounded = round(float(value), 6)
    return 0.0 if rounded == 0 else rounded


def _plain(value):
    return int(value) if isinstance(value, float) and value.is_integer() else value


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


def _read_datasets(request, context):
    items = (request.get("inputs") or {}).get("datasets") or []
    if not items:
        raise AnalysisInputError("快照里没有任何 Dataset：comps_valuation 需要同行同期的 peers 横截面")
    views = {}
    for item in items:
        dataset_id = (item or {}).get("dataset_id")
        if not isinstance(dataset_id, str) or not dataset_id:
            raise AnalysisInputError("request.inputs.datasets 里有缺失 dataset_id 的条目")
        views[dataset_id] = context.read_dataset(dataset_id)
    for dataset_id, view in views.items():
        if view.get("shape") != "rows":
            raise AnalysisInputError(
                f"Dataset {dataset_id} 是 {view.get('shape')} 型：comps_valuation 只吃表格数据，"
                "文档型输入请先走 profile 或证据"
            )
    return views


def _select_datasets(views, params):
    peers_id = params.get("peers_dataset_id")
    subject_id = params.get("subject_dataset_id")
    candidates = sorted(
        dataset_id for dataset_id, view in views.items()
        if all(name in _columns_of(view) for name in SIGNATURE)
    )
    if isinstance(peers_id, str) and peers_id:
        if peers_id not in views:
            raise AnalysisInputError(f"peers_dataset_id={peers_id} 不在本次快照的 Dataset 里")
        missing = [name for name in SIGNATURE if name not in _columns_of(views[peers_id])]
        if missing:
            raise AnalysisInputError(f"peers Dataset {peers_id} 缺少 {'、'.join(missing)} 列：不是可比倍数表")
        peers = peers_id
    else:
        if not candidates:
            raise AnalysisInputError(
                "没有任何 Dataset 同时含 market_cap 与 net_profit：comps_valuation 需要同行同期的 peers 横截面"
            )
        if len(candidates) > 1:
            raise AnalysisInputError(
                f"有 {len(candidates)} 份 Dataset 都像 peers 表（{'、'.join(candidates)}）："
                "用 peers_dataset_id 指明 peers、subject_dataset_id 指明标的"
            )
        peers = candidates[0]
    subject = None
    if isinstance(subject_id, str) and subject_id:
        if subject_id not in views:
            raise AnalysisInputError(f"subject_dataset_id={subject_id} 不在本次快照的 Dataset 里")
        missing = [name for name in ("market_cap", "net_profit") if name not in _columns_of(views[subject_id])]
        if missing:
            raise AnalysisInputError(f"subject Dataset {subject_id} 缺少 {'、'.join(missing)} 列：无法计算标的倍数")
        subject = subject_id
    elif len(candidates) > 1 and peers in candidates:
        raise AnalysisInputError("有多份 Dataset 像 peers 表：请同时用 subject_dataset_id 指明标的，避免把另一份误当 peers")
    return peers, subject


def _rows_of(view, role):
    rows = view.get("rows") or []
    if not rows:
        raise AnalysisInputError(f"{role} Dataset 没有任何数据行")
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise AnalysisInputError(f"{role} Dataset 第 {index + 1} 行不是对象：无法计算")
    return rows


def _ticker_column(view, params):
    explicit = params.get("ticker_column")
    if isinstance(explicit, str) and explicit:
        if explicit not in _columns_of(view):
            raise AnalysisInputError(f"ticker_column={explicit} 不在 peers Dataset 的列里")
        return explicit
    for name in TICKER_COLUMNS:
        if name in _columns_of(view):
            return name
    return None


def _multiple_name(code):
    for candidate, label, _, _ in MULTIPLES:
        if candidate == code:
            return label
    return code


def _multiples_of(row):
    """Every multiple this row can support; denominators must be economically meaningful."""
    market_cap = _number(row, "market_cap")
    net_profit = _number(row, "net_profit")
    equity = _number(row, "equity")
    revenue = _number(row, "revenue")
    enterprise_value = _number(row, "enterprise_value")
    ebitda = _number(row, "ebitda")
    values = {}
    if market_cap is not None and net_profit is not None and net_profit > 0:
        values["pe"] = market_cap / net_profit
    if market_cap is not None and equity is not None and equity > 0:
        values["pb"] = market_cap / equity
    if market_cap is not None and revenue is not None and revenue > 0:
        values["ps"] = market_cap / revenue
    if enterprise_value is not None and ebitda is not None and ebitda > 0:
        values["ev_ebitda"] = enterprise_value / ebitda
    return values, {
        "market_cap": market_cap,
        "net_profit": net_profit,
        "equity": equity,
        "revenue": revenue,
        "enterprise_value": enterprise_value,
        "ebitda": ebitda,
    }


def _median(values):
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def _ratio_text(value):
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return text if text not in ("", "-0") else "0"


def _summary(peer_medians, subject_values, subject_premiums, excluded, gaps, subject_available):
    parts = []
    for code, label in ((item[0], item[1]) for item in MULTIPLES):
        if code not in peer_medians:
            continue
        count = peer_medians[code]["count"]
        median = peer_medians[code]["median"]
        text = f"{label} 中位数 {_ratio_text(median)}（{count} 家）"
        if subject_available and code in subject_values:
            premium = subject_premiums[code]
            sign = "+" if premium >= 0 else ""
            text += f"，标的 {_ratio_text(subject_values[code])}（{sign}{premium * 100:.2f}%）"
        parts.append(text)
    if not parts:
        return "可比倍数没有可计算的样本：所有 peer 的对应分母都不可用，见 data_gaps。"
    head = "可比公司截面：" + "；".join(parts)
    notes = []
    if excluded:
        notes.append("剔除 " + "、".join(f"{label} {count} 家" for label, count in excluded.items()))
    if gaps:
        notes.append(f"{len(gaps)} 项缺口")
    if notes:
        head += "。" + "；".join(notes)
    return head + "。"


def analyze(request: dict, context) -> dict:
    params = request.get("params") or {}
    views = _read_datasets(request, context)
    peers_id, subject_id = _select_datasets(views, params)
    methodology = [f"peers = {peers_id}" + (f"；subject = {subject_id}" if subject_id else "；未提供 subject")]
    limitations = list(LIMITATIONS)
    gaps = []

    peers_view = views[peers_id]
    if peers_view.get("truncated"):
        limitations.append(
            f"peers Dataset 被截断到 {len(peers_view.get('rows') or [])} 行（max_input_rows）：中位数只覆盖截断后的样本"
        )
    peers_rows = _rows_of(peers_view, "peers")
    ticker_column = _ticker_column(peers_view, params)

    seen_tickers = set()
    peer_records = []
    peer_values = {code: [] for code, _, _, _ in MULTIPLES}
    excluded = {}
    for index, row in enumerate(peers_rows):
        ticker = row.get(ticker_column) if ticker_column else None
        if ticker is not None:
            ticker_text = str(ticker)
            if ticker_text in seen_tickers:
                raise AnalysisInputError(f"peers 表里 ticker {ticker_text} 出现多行：一行只能是一家公司")
            seen_tickers.add(ticker_text)
        label = str(ticker) if ticker is not None else f"row_{index + 1}"
        values, inputs = _multiples_of(row)
        if not values:
            gaps.append(f"{label} 没有可计算的倍数（market_cap / net_profit 或对应分母缺失或不可用）")
        for code, _, numerator, denominator in MULTIPLES:
            if code in values:
                peer_values[code].append(values[code])
            elif _number(row, numerator) is not None and _number(row, denominator) is not None:
                excluded[_multiple_name(code)] = excluded.get(_multiple_name(code), 0) + 1
        peer_records.append({
            "ticker": label,
            "multiples": {code: _round(value) for code, value in values.items()},
            "inputs": {name: _plain(value) if value is not None else None for name, value in inputs.items()},
        })

    peer_medians = {}
    metrics = {"peers_rows": len(peers_rows), "peers_used": sum(1 for record in peer_records if record["multiples"])}
    for code, label, _, _ in MULTIPLES:
        values = peer_values[code]
        if not values:
            gaps.append(f"{label} 未计算：peers 表没有可用的 {_multiple_name(code)} 样本（缺列、分母 ≤ 0 或全被剔除）")
            metrics[f"{code}_count"] = 0
            continue
        median = _round(_median(values))
        peer_medians[code] = {"median": median, "count": len(values)}
        metrics[f"{code}_count"] = len(values)
        metrics[f"{code}_median"] = median
        methodology.append(f"{label}：{len(values)} 个有效样本，中位数 {_ratio_text(median)}")

    subject_available = subject_id is not None
    subject_values = {}
    subject_premiums = {}
    if subject_available:
        subject_rows = _rows_of(views[subject_id], "subject")
        if len(subject_rows) != 1:
            raise AnalysisInputError(f"subject Dataset 必须只有一行（当前 {len(subject_rows)} 行）：横截面口径一次只比一只标的")
        subject_values, subject_inputs = _multiples_of(subject_rows[0])
        if not subject_values:
            gaps.append("subject 没有可计算的倍数：缺 market_cap / net_profit 或分母不可用")
        for code, label, _, _ in MULTIPLES:
            if code in subject_values:
                metrics[f"{code}_subject"] = _round(subject_values[code])
                if code in peer_medians:
                    premium = _round(subject_values[code] / peer_medians[code]["median"] - 1)
                    subject_premiums[code] = premium
                    metrics[f"{code}_premium"] = premium
                    methodology.append(f"{label}：标的 {_ratio_text(subject_values[code])}，较中位数 {premium * 100:+.2f}%")
                else:
                    gaps.append(f"{label} 的相对位置未计算：peers 侧没有可用中位数")
        methodology.append("subject 倍数：" + "、".join(f"{label} {_ratio_text(subject_values[code])}" for code, label, _, _ in MULTIPLES if code in subject_values))
        subject_payload = {
            "ticker": str(subject_rows[0].get(ticker_column)) if ticker_column and subject_rows[0].get(ticker_column) is not None else "subject",
            "multiples": {code: _round(value) for code, value in subject_values.items()},
            "inputs": {name: _plain(value) if value is not None else None for name, value in subject_inputs.items()},
        }
    else:
        subject_payload = None
    metrics["subject_available"] = subject_available

    if metrics["peers_used"] == 0 and not subject_values:
        status = "blocked"
    elif gaps:
        status = "partial"
    else:
        status = "completed"
    if metrics["peers_used"] < 3:
        limitations.append(f"peers 有效样本只有 {metrics['peers_used']} 家：中位数没有横截面意义")
    if excluded:
        limitations.append("剔除的样本：" + "、".join(f"{label} {count} 家" for label, count in excluded.items()))

    payload = {
        "protocol": "capital.analysis/v1",
        "module_id": MODULE_ID,
        "module_version": MODULE_VERSION,
        "analysis_id": request.get("analysis_id"),
        "module_run_id": request.get("module_run_id"),
        "period_note": params.get("period_note"),
        "peers_dataset_id": peers_id,
        "subject_dataset_id": subject_id,
        "ticker_column": ticker_column,
        "peers": peer_records,
        "subject": subject_payload,
        "medians": {code: peer_medians[code] for code in peer_medians},
        "excluded": excluded,
        "data_gaps": gaps,
    }
    ref = context.write_output(OUTPUT_NAME, payload)
    context.log(f"{MODULE_ID}: {status} peers={len(peers_rows)} multiples={len(peer_medians)} gaps={len(gaps)}")

    return {
        "status": status,
        "summary": _summary(peer_medians, subject_values, subject_premiums, excluded, gaps, subject_available),
        "metrics": metrics,
        "claims": [],
        "assumptions": list(ASSUMPTIONS),
        "methodology_log": methodology,
        "sensitivity": {},
        "limitations": limitations,
        "data_gaps": gaps,
        "outputs": [{"name": OUTPUT_NAME, "ref": ref}],
    }
