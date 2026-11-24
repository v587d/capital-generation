"""Financial quality: margins, ROE/DuPont, cash conversion, leverage, coverage, working capital.

The input is the snapshot's datasets, not a pre-joined table: each of the three statements is
recognised by its column signature and joined on one period key (`period_end_ms`, else `period`).
A missing statement, column or period becomes a `data_gaps` entry; a ratio whose denominator has no
economic meaning is skipped rather than reported as zero. This module never fills a gap with a
default value, and it never emits a rating or a target price.

Protocol: `docs/dev/senior-analysis.md` §1.9. Conclusions and claims belong to the senior analyst;
this module only produces reproducible ratios plus the input values behind each one.
"""
from __future__ import annotations

from datetime import datetime, timezone

MODULE_ID = "financial_quality"
MODULE_VERSION = "1.0.0"
OUTPUT_NAME = "ratios"

# Mirrors module.json `assumptions`: a result must state the same caveats the manifest promises.
ASSUMPTIONS = [
    "EBIT 用「利润总额 + 利息费用」近似：中国会计准则下利息费用已在利润总额之前扣除",
    "ROE、现金转换与周转率按期末余额计算，未使用期初期末平均值",
    "total_debt 是资产负债表「负债合计」（全部负债），不是有息负债；净负债与有息负债率不在本模块口径内",
    "报表期为累计口径（一季报/中报/三季报为年初至期末），不做年化或季度换算",
    "金额按数据集原币计，不做币种换算；跨币种数据集不合并",
]

LIMITATIONS = [
    "未调整会计政策变更、并购与汇率折算影响",
    "营运资本比率需要 total_current_liabilities 与 inventory 两列；缺列时按缺口处理，不用替代口径估算",
]

# A dataset belongs to a statement role when it carries the whole signature. Signatures are
# disjoint on purpose: guessing from a name or from a single column would silently join the wrong
# table and produce numbers that look sourced.
SIGNATURES = {
    "income": ("operating_income", "net_profit"),
    "balance": ("assets_total", "holder_equity_total"),
    "cashflow": ("act_cash_flow_net",),
}
LABELS = {"income": "利润表", "balance": "资产负债表", "cashflow": "现金流量表"}
REQUIRED_HINT = {
    "income": "同时含 operating_income 与 net_profit 列",
    "balance": "同时含 assets_total 与 holder_equity_total 列",
    "cashflow": "含 act_cash_flow_net 列",
}
PERIOD_KEYS = ("period_end_ms", "period")
TREND_METRICS = ("gross_margin", "net_margin", "roe", "cash_conversion", "debt_ratio")
TREND_LABELS = {
    "gross_margin_delta": ("毛利率", "pp"),
    "net_margin_delta": ("净利率", "pp"),
    "roe_delta": ("ROE", "pp"),
    "debt_ratio_delta": ("资产负债率", "pp"),
    "cash_conversion_delta": ("现金转换", "倍"),
}


class AnalysisInputError(Exception):
    """The input cannot be used at all; the host maps `analysis_code` to the stable protocol code."""

    analysis_code = "analysis_input_invalid"


def _round(value):
    rounded = round(float(value), 6)
    return 0.0 if rounded == 0 else rounded


def _plain(value):
    """Integral floats as ints: the audit file then shows 100000000000, not 100000000000.0."""
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
                f"Dataset {dataset_id} 是 {view.get('shape')} 型：financial_quality 只吃表格数据，"
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
                    f"Dataset {explicit} 缺少{LABELS[role]}必需列：{'、'.join(missing)}（需要{REQUIRED_HINT[role]}）"
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
    makes the text useless as a label or a selection key; a single-period dataset is still fine.
    """
    keys = set()
    for rows in rows_by_role.values():
        keys |= set(rows)
    texts = set()
    for role in ("income", "balance", "cashflow"):
        for key in keys:
            row = _row_at(rows_by_role, key, role)
            if row is not None and isinstance(row.get("period"), str) and row["period"]:
                texts.add(row["period"])
    return len(texts) == len(keys) and len(texts) > 0


def _row_at(rows_by_role, key, role):
    row = rows_by_role.get(role, {}).get(key)
    return row if isinstance(row, dict) else None


def _label(rows_by_role, key, key_column):
    """Human-facing period label: the source's own text when it actually varies, else the report date.

    Order matters: a constant text column (fuyao A-share: `annual` everywhere) must lose to the date,
    while a varying one (`2024-4`) is the label the analyst already uses in reports.
    """
    if _period_text_is_informative(rows_by_role):
        for role in ("income", "balance", "cashflow"):
            row = _row_at(rows_by_role, key, role)
            if row is not None and isinstance(row.get("period"), str) and row["period"]:
                return row["period"]
    if key_column == "period_end_ms" and isinstance(key, (int, float)) and not isinstance(key, bool):
        return _iso_date(key)
    return str(key)


def _period_candidates(rows_by_role, key, key_column):
    """Every way a model may spell this period: the key itself, the date label, fiscal year and
    `year-period` (e.g. `2024`, `2024-FY`), plus the text column only when it is informative."""
    values = {str(key), _label(rows_by_role, key, key_column)}
    informative = _period_text_is_informative(rows_by_role)
    for role in ("income", "balance", "cashflow"):
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
            raise AnalysisInputError(f"报告期 {wanted} 同时匹配多个报告期（{labels}）：请写完整报告期，如 {_label(rows_by_role, matches[0], key_column)}")
        return matches[0]
    return max(keys)


def _compute(rows_by_role, key, label, wanted=None):
    """One period's ratios. Returns (metrics, ratio rows, gaps); `wanted` narrows to a metric subset."""
    income = rows_by_role.get("income", {}).get(key)
    balance = rows_by_role.get("balance", {}).get(key)
    cashflow = rows_by_role.get("cashflow", {}).get(key)
    metrics, ratios, gaps = {}, [], []

    def add(name, numerator, denominator, formula, inputs, *, positive_denominator=False, reason=None):
        if wanted is not None and name not in wanted:
            return
        missing = [field for field, value in inputs.items() if value is None]
        if missing:
            gaps.append(f"{name} 未计算：{label} 缺 {'、'.join(missing)}")
            return
        if denominator == 0 or (positive_denominator and denominator < 0):
            gaps.append(reason or f"{name} 未计算：{label} 分母为 0")
            return
        value = _round(numerator / denominator)
        metrics[name] = value
        ratios.append({
            "metric": name,
            "value": value,
            "formula": formula,
            "inputs": {field: _plain(raw) for field, raw in inputs.items()},
        })

    revenue = _number(income, "operating_income")
    costs = _number(income, "operating_costs")
    operating_profit = _number(income, "operating_profit")
    profit_total = _number(income, "profit_total")
    interest = _number(income, "interest_expenses")
    net_profit = _number(income, "net_profit")
    assets = _number(balance, "assets_total")
    equity = _number(balance, "holder_equity_total")
    liabilities = _number(balance, "total_debt")
    current_assets = _number(balance, "total_current_assets")
    current_liabilities = _number(balance, "total_current_liabilities")
    inventory = _number(balance, "inventory")
    receivables = _number(balance, "accounts_receivable")
    ocf = _number(cashflow, "act_cash_flow_net")
    capex = _number(cashflow, "pay_fixed_assets_etc_cash")

    gross_profit = None if revenue is None or costs is None else revenue - costs
    ebit = None if profit_total is None or interest is None else profit_total + interest
    fcf = None if ocf is None or capex is None else ocf - capex
    quick_assets = None if current_assets is None or inventory is None else current_assets - inventory

    add("gross_margin", gross_profit, revenue, "(operating_income - operating_costs) / operating_income",
        {"operating_income": revenue, "operating_costs": costs}, positive_denominator=True,
        reason=f"gross_margin 未计算：{label} 营业收入 ≤ 0，毛利率无经济含义")
    add("operating_margin", operating_profit, revenue, "operating_profit / operating_income",
        {"operating_income": revenue, "operating_profit": operating_profit}, positive_denominator=True,
        reason=f"operating_margin 未计算：{label} 营业收入 ≤ 0，营业利润率无经济含义")
    add("net_margin", net_profit, revenue, "net_profit / operating_income",
        {"operating_income": revenue, "net_profit": net_profit}, positive_denominator=True,
        reason=f"net_margin 未计算：{label} 营业收入 ≤ 0，净利率无经济含义")
    add("roe", net_profit, equity, "net_profit / holder_equity_total",
        {"net_profit": net_profit, "holder_equity_total": equity}, positive_denominator=True,
        reason=f"roe 未计算：{label} 期末净资产 ≤ 0，ROE 无经济含义")
    add("roa", net_profit, assets, "net_profit / assets_total",
        {"net_profit": net_profit, "assets_total": assets}, positive_denominator=True,
        reason=f"roa 未计算：{label} 资产总计 ≤ 0")
    add("asset_turnover", revenue, assets, "operating_income / assets_total",
        {"operating_income": revenue, "assets_total": assets}, positive_denominator=True,
        reason=f"asset_turnover 未计算：{label} 资产总计 ≤ 0")
    add("equity_multiplier", assets, equity, "assets_total / holder_equity_total",
        {"assets_total": assets, "holder_equity_total": equity}, positive_denominator=True,
        reason=f"equity_multiplier 未计算：{label} 期末净资产 ≤ 0，权益乘数无经济含义")
    add("cash_conversion", ocf, net_profit, "act_cash_flow_net / net_profit",
        {"act_cash_flow_net": ocf, "net_profit": net_profit}, positive_denominator=True,
        reason=f"cash_conversion 未计算：{label} 净利润 ≤ 0，现金转换倍数无意义")
    add("ocf_margin", ocf, revenue, "act_cash_flow_net / operating_income",
        {"act_cash_flow_net": ocf, "operating_income": revenue}, positive_denominator=True,
        reason=f"ocf_margin 未计算：{label} 营业收入 ≤ 0")
    add("fcf_amount", fcf, 1.0, "act_cash_flow_net - pay_fixed_assets_etc_cash",
        {"act_cash_flow_net": ocf, "pay_fixed_assets_etc_cash": capex})
    add("fcf_margin", fcf, revenue, "(act_cash_flow_net - pay_fixed_assets_etc_cash) / operating_income",
        {"act_cash_flow_net": ocf, "pay_fixed_assets_etc_cash": capex, "operating_income": revenue},
        positive_denominator=True, reason=f"fcf_margin 未计算：{label} 营业收入 ≤ 0")
    add("debt_ratio", liabilities, assets, "total_debt / assets_total",
        {"total_debt": liabilities, "assets_total": assets}, positive_denominator=True,
        reason=f"debt_ratio 未计算：{label} 资产总计 ≤ 0")
    add("debt_to_equity", liabilities, equity, "total_debt / holder_equity_total",
        {"total_debt": liabilities, "holder_equity_total": equity}, positive_denominator=True,
        reason=f"debt_to_equity 未计算：{label} 期末净资产 ≤ 0，产权比率无经济含义")
    add("interest_coverage", ebit, interest, "(profit_total + interest_expenses) / interest_expenses",
        {"profit_total": profit_total, "interest_expenses": interest}, positive_denominator=True,
        reason=f"interest_coverage 未计算：{label} 利息费用 ≤ 0，利息保障倍数无意义")
    add("current_ratio", current_assets, current_liabilities,
        "total_current_assets / total_current_liabilities",
        {"total_current_assets": current_assets, "total_current_liabilities": current_liabilities},
        positive_denominator=True, reason=f"current_ratio 未计算：{label} 流动负债合计 ≤ 0")
    add("quick_ratio", quick_assets, current_liabilities,
        "(total_current_assets - inventory) / total_current_liabilities",
        {"total_current_assets": current_assets, "inventory": inventory,
         "total_current_liabilities": current_liabilities},
        positive_denominator=True, reason=f"quick_ratio 未计算：{label} 流动负债合计 ≤ 0")
    add("receivable_days", None if receivables is None or revenue is None else receivables * 365, revenue,
        "accounts_receivable / operating_income * 365",
        {"accounts_receivable": receivables, "operating_income": revenue}, positive_denominator=True,
        reason=f"receivable_days 未计算：{label} 营业收入 ≤ 0")
    return metrics, ratios, gaps


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


def _times(value):
    """Multiples keep 5 decimals: a 2-decimal form would sit outside the default anchor tolerance."""
    text = f"{value:.5f}".rstrip("0").rstrip(".")
    return text if text not in ("", "-0") else "0"


def _summary(label, metrics, trend_rows, gaps):
    # Rounding here is deliberate: 2-decimal percentages are always inside the host's percentage
    # tolerance, and 5-decimal multiples inside the default anchor precision. The summary is the most
    # likely thing a model copies into a claim, so every number in it must be anchorable as written.
    parts = []
    if "gross_margin" in metrics:
        parts.append(f"毛利率 {metrics['gross_margin'] * 100:.2f}%")
    if "net_margin" in metrics:
        parts.append(f"净利率 {metrics['net_margin'] * 100:.2f}%")
    if "roe" in metrics:
        parts.append(f"ROE {metrics['roe'] * 100:.2f}%")
    if "cash_conversion" in metrics:
        parts.append(f"现金转换 {_times(metrics['cash_conversion'])} 倍")
    if "debt_ratio" in metrics:
        parts.append(f"资产负债率 {metrics['debt_ratio'] * 100:.2f}%")
    if "interest_coverage" in metrics:
        parts.append(f"利息保障 {_times(metrics['interest_coverage'])} 倍")
    head = f"{label} 财务质量：" + ("、".join(parts) if parts else "没有可计算的指标")
    if trend_rows:
        changes = []
        for row in trend_rows:
            name, unit = TREND_LABELS[row["metric"]]
            if unit == "pp":
                changes.append(f"{name} {row['value'] * 100:+.2f}%")
            else:
                prefix = "+" if row["value"] > 0 else ""
                changes.append(f"{name} {prefix}{_times(row['value'])} 倍")
        head += "；环比 " + "、".join(changes)
    if gaps:
        head += "（有缺口未计算，见 data_gaps）"
    return head + "。"


def analyze(request: dict, context) -> dict:
    params = request.get("params") or {}
    views = _read_datasets(request, context)
    roles = _resolve_roles(views, params)
    ignored = sorted(set(views) - set(roles.values()))
    methodology = [
        "按列签名识别报表：" + ("、".join(f"{role}={dataset_id}" for role, dataset_id in sorted(roles.items())) or "一份都没识别到"),
    ]
    limitations = list(LIMITATIONS)
    gaps = []

    for dataset_id in ignored:
        limitations.append(f"Dataset {dataset_id} 不属于三张报表（列签名不匹配），未参与计算")
    for role, dataset_id in sorted(roles.items()):
        view = views[dataset_id]
        if view.get("truncated"):
            limitations.append(
                f"{LABELS[role]} {dataset_id} 被截断到 {len(view.get('rows') or [])} 行（max_input_rows），"
                "结论只覆盖截断后的样本"
            )

    if "income" not in roles:
        gaps.append("缺少利润表数据集（需要同时含 operating_income 与 net_profit 列）：利润率、ROE、现金转换都无法计算")
        context.log(f"{MODULE_ID}: 缺利润表，返回 blocked")
        return _result(
            "blocked",
            "缺少利润表数据集：无法计算财务质量指标，请补齐利润表后重跑。",
            {},
            methodology + ["未执行比率计算：利润表缺失"],
            limitations + ["没有任何指标可用，不能据此判断财务质量"],
            gaps,
            [],
        )

    for role in ("balance", "cashflow"):
        if role not in roles:
            gaps.append(f"缺少{LABELS[role]}数据集（需要{REQUIRED_HINT[role]}）：相关指标未计算")

    key_column = _join_key(roles, views)
    if key_column == "period":
        limitations.append("报告期按 period 字符串排序取最新期（没有 period_end_ms 列）：格式不一致时可能选错报告期")
    rows_by_role = {role: _index_rows(views[dataset_id], key_column, role) for role, dataset_id in roles.items()}
    selected = _select_period(rows_by_role, params, key_column)
    label = _label(rows_by_role, selected, key_column)
    methodology.append(f"报告期键 {key_column}；选中 {label}")

    currency = None
    for role in ("income", "balance", "cashflow"):
        row = rows_by_role.get(role, {}).get(selected)
        if isinstance(row, dict) and isinstance(row.get("currency"), str) and row["currency"]:
            currency = row["currency"]
            break

    metrics, ratios, period_gaps = _compute(rows_by_role, selected, label)
    gaps.extend(period_gaps)
    if currency:
        metrics = {"currency": currency, **metrics}

    trend_rows = []
    previous_label = None
    if params.get("compare_previous", True) is not False:
        candidates = [key for key in set().union(*[set(rows) for rows in rows_by_role.values()]) if key < selected]
        if not candidates:
            gaps.append(f"未计算趋势：这批数据集没有早于 {label} 的报告期")
            limitations.append("只有一期报表，没有环比趋势")
        else:
            previous = max(candidates)
            previous_label = _label(rows_by_role, previous, key_column)
            previous_metrics, _, _ = _compute(rows_by_role, previous, previous_label, wanted=TREND_METRICS)
            for name in TREND_METRICS:
                if name in metrics and name in previous_metrics:
                    delta = _round(metrics[name] - previous_metrics[name])
                    metrics[f"{name}_delta"] = delta
                    trend_rows.append({
                        "metric": f"{name}_delta",
                        "value": delta,
                        "current": metrics[name],
                        "previous": previous_metrics[name],
                        "formula": f"{name}({label}) - {name}({previous_label})",
                    })
                else:
                    gaps.append(f"{name}_delta 未计算：{previous_label} 缺少可比指标")
            methodology.append(f"上一期 {previous_label}：计算 {len(trend_rows)} 项环比变化")
    else:
        limitations.append("按参数关闭了环比趋势")

    if all(name in metrics for name in ("net_margin", "asset_turnover", "equity_multiplier", "roe")):
        residual = _round(
            metrics["net_margin"] * metrics["asset_turnover"] * metrics["equity_multiplier"] - metrics["roe"]
        )
        methodology.append(
            f"DuPont 三因子乘积与 roe 一致（差 {residual:+.6f}）" if abs(residual) <= 1e-5
            else f"DuPont 三因子乘积与 roe 不一致（差 {residual:+.6f}）：输入可能存在口径混用"
        )

    status = "partial" if gaps else "completed"
    methodology.append(
        f"计算 {len([name for name in metrics if name != 'currency'])} 项指标、{len(trend_rows)} 项环比；{len(gaps)} 项缺口"
    )

    payload = {
        "protocol": "capital.analysis/v1",
        "module_id": MODULE_ID,
        "module_version": MODULE_VERSION,
        "analysis_id": request.get("analysis_id"),
        "module_run_id": request.get("module_run_id"),
        "period": label,
        "period_key": key_column,
        "previous_period": previous_label,
        "currency": currency,
        "statements": {role: dataset_id for role, dataset_id in sorted(roles.items())},
        "ratios": ratios,
        "trend": trend_rows,
        "data_gaps": gaps,
    }
    ref = context.write_output(OUTPUT_NAME, payload)
    context.log(f"{MODULE_ID}: {status} period={label} metrics={len(metrics)} gaps={len(gaps)}")

    return _result(
        status,
        _summary(label, metrics, trend_rows, gaps),
        metrics,
        methodology,
        limitations,
        gaps,
        [{"name": OUTPUT_NAME, "ref": ref}],
    )
