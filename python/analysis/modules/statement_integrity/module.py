"""Statement integrity: balance identity, cash-flow reconciliation, retained-earnings roll-forward.

The input is the snapshot's datasets, not a pre-joined table: the three statements are recognised
by column signature and joined on one period key (`period_end_ms`, else `period`). Every check is
an explicit identity with the same two sides; the module reports the residual, the scale it is
compared against and the tolerance the caller passed. A missing statement, column or period becomes
a `data_gaps` entry — the module never fills a gap with a default value, never decides that a
residual means fraud, and never emits a rating.

Protocol: `docs/dev/senior-analysis.md` §1.9. Conclusions and claims belong to the senior analyst;
this module only produces reproducible residuals plus the input values behind each one.
"""
from __future__ import annotations

from datetime import datetime, timezone

MODULE_ID = "statement_integrity"
MODULE_VERSION = "1.0.0"
OUTPUT_NAME = "integrity_checks"

# Mirrors module.json `assumptions`: a result must state the same caveats the manifest promises.
ASSUMPTIONS = [
    "资产负债恒等式按 assets_total = total_debt + holder_equity_total 校验；total_debt 是「负债合计」，不区分有息与无息",
    "现金流对账按 act_cash_flow_net + invest_cash_flow_net + financing_cash_flow_net = cash_equivalents_net_addition；只有数据集含 effect_of_exchange_rate_changes 列时才把汇率影响计入左边",
    "留存收益滚动只在资产负债表有 retained_earnings 列且找到上一期时校验：RE_end = RE_prev + net_profit - dividends_paid - 盈余公积增加（balance 有 surplus_reserve 列时扣除其增量）",
    "容差由参数显式给出：|差异| ≤ tolerance_abs + tolerance_ratio × 对账基准；基准取同一恒等式两边绝对值中的较大者，不按行业或规模另设阈值",
    "差异是数据质量信号，不是投资结论：本模块不判断报表是否造假、不评级，也不给目标价",
]

LIMITATIONS = [
    "勾稽成立不代表报表真实或完整：本模块不校验会计政策、科目口径、合并范围与附注披露",
    "三张报表来自不同 Dataset 时，本模块只按报告期键对齐，不检查它们是否同一个合并口径或同一币种",
    "留存收益滚动对盈余公积与现金分红的处理取决于列是否披露；缺列按缺口处理，不用默认值补齐",
    "容差是调用方给的参数：调宽容差只会让差异更容易通过，不改变差异本身",
]

SIGNATURES = {
    "balance": ("assets_total", "holder_equity_total"),
    "income": ("net_profit",),
    "cashflow": ("act_cash_flow_net",),
}
LABELS = {"balance": "资产负债表", "income": "利润表", "cashflow": "现金流量表"}
CHECK_LABELS = {
    "balance": "资产负债恒等式",
    "cash": "现金流对账",
    "retained_earnings": "留存收益滚动",
}
CHECK_FORMULAS = {
    "balance": "assets_total = total_debt + holder_equity_total",
    "cash": "act_cash_flow_net + invest_cash_flow_net + financing_cash_flow_net (+ 汇率影响) = cash_equivalents_net_addition",
    "retained_earnings": "retained_earnings(end) = retained_earnings(prev) + net_profit - dividends_paid - Δsurplus_reserve",
}
PERIOD_KEYS = ("period_end_ms", "period")
CASH_COMPONENTS = ("act_cash_flow_net", "invest_cash_flow_net", "financing_cash_flow_net")
CASH_TOTAL = "cash_equivalents_net_addition"
FX_COLUMN = "effect_of_exchange_rate_changes"
DIVIDEND_COLUMNS = ("dividends_paid", "dividends_declared")
DEFAULT_TOLERANCE_RATIO = 0.001


class AnalysisInputError(Exception):
    """The input cannot be used at all; the host maps `analysis_code` to the stable protocol code."""

    analysis_code = "analysis_input_invalid"


def _round(value):
    rounded = round(float(value), 6)
    return 0.0 if rounded == 0 else rounded


def _plain(value):
    """Integral floats as ints: the audit file then shows 100000000000, not 100000000000.0."""
    return int(value) if isinstance(value, float) and value.is_integer() else value


def _amount(value):
    """Money keeps the source's integer form when it has one; otherwise 6 decimals."""
    if value is None:
        return None
    if float(value).is_integer():
        return int(value)
    return _round(value)


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
        raise AnalysisInputError("快照里没有任何 Dataset：先取齐三张报表再建快照")
    views = {}
    for item in items:
        dataset_id = (item or {}).get("dataset_id")
        if not isinstance(dataset_id, str) or not dataset_id:
            raise AnalysisInputError("request.inputs.datasets 里有缺失 dataset_id 的条目")
        views[dataset_id] = context.read_dataset(dataset_id)
    for dataset_id, view in views.items():
        if view.get("shape") != "rows":
            raise AnalysisInputError(
                f"Dataset {dataset_id} 是 {view.get('shape')} 型：statement_integrity 只吃表格数据，"
                "文档型输入请先走 profile 或证据"
            )
    return views


def _resolve_roles(views, params):
    """Map each statement role to one dataset id: explicit param first, then the column signature."""
    roles = {}
    for role, signature in SIGNATURES.items():
        explicit = params.get(f"{role}_dataset_id")
        if isinstance(explicit, str) and explicit:
            view = views.get(explicit)
            if view is None:
                raise AnalysisInputError(f"{role}_dataset_id={explicit} 不在本次快照的 Dataset 里")
            missing = [name for name in signature if name not in _columns_of(view)]
            if missing:
                raise AnalysisInputError(
                    f"Dataset {explicit} 缺少{LABELS[role]}识别列：{'、'.join(missing)}"
                )
            roles[role] = explicit
            continue
        candidates = sorted(
            dataset_id for dataset_id, view in views.items()
            if all(name in _columns_of(view) for name in signature)
        )
        if len(candidates) > 1:
            raise AnalysisInputError(
                f"有 {len(candidates)} 份 Dataset 都像{LABELS[role]}（{'、'.join(candidates)}）："
                f"用 {role}_dataset_id 指明用哪一份"
            )
        if candidates:
            roles[role] = candidates[0]
    if not roles:
        raise AnalysisInputError(
            "快照里没有任何三张报表的 Dataset：需要资产负债表（assets_total + holder_equity_total）、"
            "利润表（net_profit）或现金流量表（act_cash_flow_net）"
        )
    return roles


def _join_key(roles, views):
    for column in PERIOD_KEYS:
        if all(column in _columns_of(views[dataset_id]) for dataset_id in roles.values()):
            return column
    raise AnalysisInputError(
        "三张报表缺少共同的报告期键：需要 period_end_ms 或 period 列，否则无法对齐同一报告期"
    )


def _index_rows(view, column, role):
    indexed = {}
    for row in view.get("rows") or []:
        if not isinstance(row, dict):
            raise AnalysisInputError(f"{LABELS[role]}的数据行不是对象：无法计算")
        key = row.get(column)
        if isinstance(key, bool) or not isinstance(key, (int, float, str)) or key == "":
            raise AnalysisInputError(f"{LABELS[role]}的 {column} 列有空值：无法对齐报告期")
        if key in indexed:
            raise AnalysisInputError(f"{LABELS[role]}在报告期 {key} 出现多行：无法判断用哪一行（请先去重）")
        indexed[key] = row
    return indexed


def _iso_date(ms):
    return datetime.fromtimestamp(float(ms) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def _period_text_is_informative(rows_by_role):
    """Trust the source's `period` text only when it identifies the period one-to-one.

    Some sources put a constant there (fuyao A-share statements: every row says "annual"), which
    makes the text useless as a label or a selection key.
    """
    keys = set()
    for rows in rows_by_role.values():
        keys |= set(rows)
    texts = set()
    for keys_by_role in rows_by_role.values():
        for key in keys:
            row = keys_by_role.get(key)
            if isinstance(row, dict) and isinstance(row.get("period"), str) and row["period"]:
                texts.add(row["period"])
    # A bare periodicity word (`annual`, `FY`) does not identify a period even when only one row
    # exists: labels derived from it ("annual 缺 ...") are not something a reader can check.
    return len(texts) == len(keys) and len(texts) > 0 and all(any(ch.isdigit() for ch in text) for text in texts)


def _row_at(rows_by_role, key, role):
    row = rows_by_role.get(role, {}).get(key)
    return row if isinstance(row, dict) else None


def _label(rows_by_role, key, key_column):
    """Human-facing period label: the source's own text when it actually varies, else the report date."""
    if _period_text_is_informative(rows_by_role):
        for role in ("balance", "income", "cashflow"):
            row = _row_at(rows_by_role, key, role)
            if row is not None and isinstance(row.get("period"), str) and row["period"]:
                return row["period"]
    if key_column == "period_end_ms" and isinstance(key, (int, float)) and not isinstance(key, bool):
        return _iso_date(key)
    return str(key)


def _period_candidates(rows_by_role, key, key_column):
    """Every way a model may spell this period: the key, its date label, fiscal year and `year-period`."""
    values = {str(key), _label(rows_by_role, key, key_column)}
    informative = _period_text_is_informative(rows_by_role)
    for role in ("balance", "income", "cashflow"):
        row = _row_at(rows_by_role, key, role)
        if row is None:
            continue
        year = row.get("fiscal_year")
        if isinstance(year, int) and not isinstance(year, bool):
            values.add(str(year))
            period = row.get("fiscal_period")
            if isinstance(period, str) and period:
                values.add(f"{year}-{period}")
        if informative and isinstance(row.get("period"), str) and row["period"]:
            values.add(row["period"])
    return values


def _select_period(rows_by_role, params, key_column):
    keys = set()
    for rows in rows_by_role.values():
        keys |= set(rows)
    if not keys:
        raise AnalysisInputError("三张报表都没有数据行：无法计算")
    requested = params.get("period")
    if isinstance(requested, str) and requested.strip():
        wanted = requested.strip()
        matches = [key for key in keys if wanted in _period_candidates(rows_by_role, key, key_column)]
        if not matches:
            available = "、".join(_label(rows_by_role, key, key_column) for key in sorted(keys))
            raise AnalysisInputError(f"报告期 {wanted} 不在这批数据集里；可选：{available}")
        if len(matches) > 1:
            labels = "、".join(_label(rows_by_role, key, key_column) for key in sorted(matches))
            raise AnalysisInputError(
                f"报告期 {wanted} 同时匹配多个报告期（{labels}）：请写完整报告期，如 {_label(rows_by_role, matches[0], key_column)}"
            )
        return matches[0]
    return max(keys)


def _param_number(params, name, default):
    value = params.get(name, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AnalysisInputError(f"{name} 必须是数字，实际是 {value!r}")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        raise AnalysisInputError(f"{name} 必须是有限数字")
    if number < 0:
        raise AnalysisInputError(f"{name} 必须 ≥ 0，实际是 {number}")
    return number


def _tolerance(tolerance_ratio, tolerance_abs, scale):
    return tolerance_abs + tolerance_ratio * scale


def _check(name, left, right, inputs, tolerance_ratio, tolerance_abs, reason=None):
    """Compare the two sides of one identity and return the audit row plus its metrics."""
    residual = float(left) - float(right)
    scale = max(abs(float(left)), abs(float(right)))
    tolerance = _tolerance(tolerance_ratio, tolerance_abs, scale)
    row = {
        "check": name,
        "label": CHECK_LABELS[name],
        "formula": CHECK_FORMULAS[name],
        "status": "pass" if abs(residual) <= tolerance else "fail",
        "residual": _amount(residual),
        "scale": _amount(scale),
        "tolerance": _amount(tolerance),
        "residual_ratio": None if scale == 0 else _round(residual / scale),
        "inputs": {field: _amount(value) for field, value in inputs.items()},
    }
    if reason:
        row["reason"] = reason
    metrics = {
        f"{name}_checked": True,
        f"{name}_residual": _amount(residual),
        f"{name}_scale": _amount(scale),
        f"{name}_residual_ratio": row["residual_ratio"],
        f"{name}_within_tolerance": row["status"] == "pass",
    }
    return row, metrics


def _skipped(name, reason):
    return {
        "check": name,
        "label": CHECK_LABELS[name],
        "formula": CHECK_FORMULAS[name],
        "status": "skipped",
        "residual": None,
        "scale": None,
        "tolerance": None,
        "residual_ratio": None,
        "inputs": {},
        "reason": reason,
    }


def _skip_pair(name, reason):
    return _skipped(name, reason), {f"{name}_checked": False}


def _money_text(value):
    return str(_amount(value))


def _summary(label, checks, gaps, tolerance_ratio, tolerance_abs):
    ran = [row for row in checks if row["status"] in ("pass", "fail")]
    if not ran:
        return f"三表勾稽没有可执行的校验：{len(gaps)} 项缺口，见 data_gaps。"
    parts = []
    for row in ran:
        amount = _money_text(row["residual"])
        tolerance_text = f"{tolerance_ratio * 100:.2f}%"
        if tolerance_abs:
            tolerance_text += f" + {tolerance_abs:g}"
        if row["status"] == "pass":
            parts.append(f"{row['label']}差异 {amount}（容差 {tolerance_text}，通过）")
        else:
            ratio = 0.0 if row["residual_ratio"] is None else row["residual_ratio"] * 100
            parts.append(f"{row['label']}差异 {amount}（占基准 {ratio:.2f}%，容差 {tolerance_text}，未通过）")
    failed = sum(1 for row in ran if row["status"] == "fail")
    tail = f"共 {len(ran)} 项校验，{failed} 项未通过"
    if gaps:
        tail += f"；另有 {len(gaps)} 项缺口"
    return f"{label} 三表勾稽：" + "；".join(parts) + "。" + tail + "。"


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


def _currency(rows_by_role, key):
    for role in ("balance", "income", "cashflow"):
        row = _row_at(rows_by_role, key, role)
        if isinstance(row, dict) and isinstance(row.get("currency"), str) and row["currency"]:
            return row["currency"]
    return None


def _balance_check(rows_by_role, key, label, tolerance_ratio, tolerance_abs):
    row = _row_at(rows_by_role, key, "balance")
    if row is None:
        return _skip_pair("balance", f"{label} 没有资产负债表数据行")
    assets = _number(row, "assets_total")
    liabilities = _number(row, "total_debt")
    equity = _number(row, "holder_equity_total")
    missing = []
    if assets is None:
        missing.append("assets_total")
    if liabilities is None:
        missing.append("total_debt")
    if equity is None:
        missing.append("holder_equity_total")
    if missing:
        return _skip_pair("balance", f"{label} 资产负债表缺 {'、'.join(missing)}（空值或非数字），恒等式无法校验")
    return _check(
        "balance", assets, liabilities + equity,
        {"assets_total": assets, "total_debt": liabilities, "holder_equity_total": equity},
        tolerance_ratio, tolerance_abs,
    )


def _cash_check(rows_by_role, key, label, views, roles, tolerance_ratio, tolerance_abs):
    row = _row_at(rows_by_role, key, "cashflow")
    if row is None:
        return _skip_pair("cash", f"{label} 没有现金流量表数据行")
    missing = [name for name in (*CASH_COMPONENTS, CASH_TOTAL) if _number(row, name) is None]
    if missing:
        return _skip_pair("cash", f"{label} 现金流量表缺 {'、'.join(missing)}（空值或非数字），对账无法校验")
    left = sum(_number(row, name) for name in CASH_COMPONENTS)
    fx_used = False
    fx_column_present = FX_COLUMN in _columns_of(views[roles["cashflow"]])
    fx = _number(row, FX_COLUMN)
    if fx_column_present and fx is not None:
        left += fx
        fx_used = True
    inputs = {name: _number(row, name) for name in CASH_COMPONENTS}
    inputs[CASH_TOTAL] = _number(row, CASH_TOTAL)
    if fx_used:
        inputs[FX_COLUMN] = fx
    result, metrics = _check(
        "cash", left, _number(row, CASH_TOTAL), inputs,
        tolerance_ratio, tolerance_abs,
    )
    result["foreign_exchange_included"] = fx_used
    return result, metrics


def _dividends(rows_by_role, key):
    """Cash dividends actually paid: an explicit column, never the combined dividend/interest line."""
    for role in ("cashflow", "balance", "income"):
        row = _row_at(rows_by_role, key, role)
        if row is None:
            continue
        for column in DIVIDEND_COLUMNS:
            value = _number(row, column)
            if value is not None:
                return value, f"{role}.{column}"
    return None, None


def _retained_earnings_check(rows_by_role, key, label, tolerance_ratio, tolerance_abs, gaps):
    balance = rows_by_role.get("balance") or {}
    current = _row_at(rows_by_role, key, "balance")
    if current is None:
        return _skip_pair("retained_earnings", f"{label} 没有资产负债表数据行")
    if "retained_earnings" not in current:
        return _skip_pair("retained_earnings", f"{label} 资产负债表没有 retained_earnings 列，无法核对留存收益滚动")
    re_end = _number(current, "retained_earnings")
    if re_end is None:
        return _skip_pair("retained_earnings", f"{label} retained_earnings 为空值，无法核对留存收益滚动")
    previous_keys = [candidate for candidate in balance if candidate < key]
    if not previous_keys:
        return _skip_pair("retained_earnings", f"没有早于 {label} 的资产负债表报告期，无法核对留存收益滚动")
    previous_key = max(previous_keys)
    previous = balance[previous_key]
    previous_label = _label(rows_by_role, previous_key, "period_end_ms" if isinstance(previous_key, (int, float)) else "period")
    re_prev = _number(previous, "retained_earnings")
    income = _row_at(rows_by_role, key, "income")
    net_profit = _number(income, "net_profit")
    missing = []
    if re_prev is None:
        missing.append(f"{previous_label} retained_earnings")
    if net_profit is None:
        missing.append(f"{label} net_profit")
    if missing:
        return _skip_pair("retained_earnings", f"留存收益滚动缺 {'、'.join(missing)}（空值或非数字）")
    dividends, dividends_source = _dividends(rows_by_role, key)
    if dividends is None:
        return _skip_pair(
            "retained_earnings",
            f"{label} 没有 dividends_paid / dividends_declared 列：分配股利口径缺失，无法核对留存收益滚动",
        )
    surplus_delta = 0.0
    surplus_note = None
    if _number(current, "surplus_reserve") is not None and _number(previous, "surplus_reserve") is not None:
        surplus_delta = _number(current, "surplus_reserve") - _number(previous, "surplus_reserve")
    else:
        surplus_note = f"{label} 资产负债表没有可比的 surplus_reserve 列：留存收益滚动未扣除盈余公积变动，差异可能包含该部分"
        gaps.append(surplus_note)
    inputs = {
        "retained_earnings_end": re_end,
        "retained_earnings_previous": re_prev,
        "net_profit": net_profit,
        "dividends_paid": dividends,
        "surplus_reserve_delta": surplus_delta,
    }
    right = re_prev + net_profit - dividends - surplus_delta
    result, metrics = _check("retained_earnings", re_end, right, inputs, tolerance_ratio, tolerance_abs)
    result["previous_period"] = previous_label
    result["dividends_source"] = dividends_source
    if surplus_note:
        result["surplus_reserve_missing"] = True
    return result, metrics


def analyze(request: dict, context) -> dict:
    params = request.get("params") or {}
    tolerance_ratio = _param_number(params, "tolerance_ratio", DEFAULT_TOLERANCE_RATIO)
    tolerance_abs = _param_number(params, "tolerance_abs", 0.0)
    views = _read_datasets(request, context)
    roles = _resolve_roles(views, params)

    methodology = [
        "按列签名识别报表：" + "、".join(f"{role}={dataset_id}" for role, dataset_id in sorted(roles.items())),
        f"容差：|差异| ≤ {tolerance_abs:g} + {tolerance_ratio:g} × 对账基准（基准 = 恒等式两边绝对值较大者）",
    ]
    limitations = list(LIMITATIONS)
    gaps = []
    checks = []

    ignored = sorted(set(views) - set(roles.values()))
    for dataset_id in ignored:
        limitations.append(f"Dataset {dataset_id} 不是三张报表（列签名不匹配），未参与勾稽")
    for role, dataset_id in sorted(roles.items()):
        view = views[dataset_id]
        if view.get("truncated"):
            limitations.append(
                f"{LABELS[role]} {dataset_id} 被截断到 {len(view.get('rows') or [])} 行（max_input_rows），"
                "勾稽只覆盖截断后的样本"
            )

    for role in ("balance", "cashflow", "income"):
        if role not in roles:
            gaps.append(f"缺少{LABELS[role]}数据集：相关勾稽未校验")

    key_column = _join_key(roles, views)
    if key_column == "period":
        limitations.append("报告期按 period 字符串排序取最新期（没有 period_end_ms 列）：格式不一致时可能选错报告期")
    rows_by_role = {role: _index_rows(views[dataset_id], key_column, role) for role, dataset_id in roles.items()}
    selected = _select_period(rows_by_role, params, key_column)
    label = _label(rows_by_role, selected, key_column)
    methodology.append(f"报告期键 {key_column}；选中 {label}")

    metrics = {}
    if "balance" in roles:
        check, check_metrics = _balance_check(rows_by_role, selected, label, tolerance_ratio, tolerance_abs)
    else:
        check, check_metrics = _skip_pair("balance", "缺少资产负债表数据集")
    metrics.update(check_metrics)
    if check["status"] == "skipped":
        gaps.append(f"{CHECK_LABELS['balance']}未校验：{check['reason']}")
    else:
        methodology.append(
            f"资产负债恒等式差异 {check['residual']}，基准 {check['scale']}，{'通过' if check['status'] == 'pass' else '未通过'}"
        )
    checks.append(check)

    if "cashflow" in roles:
        check, check_metrics = _cash_check(rows_by_role, selected, label, views, roles, tolerance_ratio, tolerance_abs)
    else:
        check, check_metrics = _skip_pair("cash", "缺少现金流量表数据集")
    metrics.update(check_metrics)
    if check["status"] == "skipped":
        gaps.append(f"{CHECK_LABELS['cash']}未校验：{check['reason']}")
    else:
        methodology.append(
            f"现金流对账差异 {check['residual']}，基准 {check['scale']}，{'通过' if check['status'] == 'pass' else '未通过'}"
        )
        if check.get("foreign_exchange_included"):
            methodology.append(f"现金流对账已计入 {FX_COLUMN}（汇率变动影响）")
        else:
            limitations.append(f"数据集没有 {FX_COLUMN} 列：现金流对账未计入汇率变动影响")
    checks.append(check)

    check, check_metrics = _retained_earnings_check(rows_by_role, selected, label, tolerance_ratio, tolerance_abs, gaps)
    metrics.update(check_metrics)
    if check["status"] == "skipped":
        gaps.append(f"{CHECK_LABELS['retained_earnings']}未校验：{check['reason']}")
    else:
        methodology.append(
            f"留存收益滚动（上一期 {check['previous_period']}）差异 {check['residual']}，"
            f"基准 {check['scale']}，{'通过' if check['status'] == 'pass' else '未通过'}"
        )
    checks.append(check)

    currency = _currency(rows_by_role, selected)
    metrics["checks_run"] = sum(1 for row in checks if row["status"] in ("pass", "fail"))
    metrics["checks_failed"] = sum(1 for row in checks if row["status"] == "fail")
    metrics["tolerance_ratio"] = tolerance_ratio
    metrics["tolerance_abs"] = tolerance_abs
    if currency:
        metrics["currency"] = currency

    ran = [row for row in checks if row["status"] in ("pass", "fail")]
    status = "blocked" if not ran else ("partial" if gaps else "completed")
    findings = [
        f"{row['label']}差异 {_money_text(row['residual'])} 超过容差 {_money_text(row['tolerance'])}（占基准 "
        f"{(0.0 if row['residual_ratio'] is None else row['residual_ratio']) * 100:.2f}%）"
        for row in ran if row["status"] == "fail"
    ]
    failures = [row["check"] for row in ran if row["status"] == "fail"]
    methodology.append(f"执行 {len(ran)} 项勾稽，{len(failures)} 项未通过；{len(gaps)} 项缺口")

    payload = {
        "protocol": "capital.analysis/v1",
        "module_id": MODULE_ID,
        "module_version": MODULE_VERSION,
        "analysis_id": request.get("analysis_id"),
        "module_run_id": request.get("module_run_id"),
        "period": label,
        "period_key": key_column,
        "statements": {role: dataset_id for role, dataset_id in sorted(roles.items())},
        "parameters": {
            "tolerance_ratio": tolerance_ratio,
            "tolerance_abs": tolerance_abs,
        },
        "checks": checks,
        "findings": findings,
        "data_gaps": gaps,
    }
    ref = context.write_output(OUTPUT_NAME, payload)
    context.log(f"{MODULE_ID}: {status} period={label} checks={len(ran)} failed={len(failures)} gaps={len(gaps)}")

    return _result(
        status,
        _summary(label, checks, gaps, tolerance_ratio, tolerance_abs),
        metrics,
        methodology,
        limitations,
        gaps,
        [{"name": OUTPUT_NAME, "ref": ref}],
    )
