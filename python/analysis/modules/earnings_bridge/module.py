"""Earnings bridge: decompose the change in net profit into reproducible effects.

Two exact decompositions over adjacent periods, both of which must add back up to the net-profit
difference:

- revenue / margin: NP = revenue × net_margin, so ΔNP splits into a revenue effect, a margin effect
  and their interaction;
- pre-tax / tax rate: NP = profit_total × (1 − tax_rate), so ΔNP splits into a pre-tax effect, a
  tax-rate effect and their interaction.

The input is one income-statement Dataset with at least two periods. The module only explains the
difference that already happened: it does not forecast the next period, does not label an effect as
good or bad, and never emits a rating or a target price.

Protocol: `docs/dev/senior-analysis.md` §1.9. Conclusions and claims belong to the senior analyst;
this module only produces reproducible effects plus the input values behind each one.
"""
from __future__ import annotations

from datetime import datetime, timezone

MODULE_ID = "earnings_bridge"
MODULE_VERSION = "1.0.0"
OUTPUT_NAME = "earnings_bridge"

# Mirrors module.json `assumptions`: a result must state the same caveats the manifest promises.
ASSUMPTIONS = [
    "收入/净利率分解：net_profit = operating_income × net_margin，差额拆成收入效应、净利率效应与两者交互项，三项之和必须等于净利润差额",
    "税前/税率分解：net_profit = profit_total × (1 − tax_rate)，tax_rate = income_tax_expense / profit_total，只对 profit_total > 0 的两期计算；三期效应之和必须等于净利润差额",
    "两期必须来自同一份利润表 Dataset、同一币种与同一合并口径；模块不检查会计政策变更或追溯调整",
    "效应为正表示对净利润变动是正贡献；交互项是两因子同时变动的交叉部分，不小到可以忽略时不得略去",
    "不输出评级、目标价或预测：归因只解释已经发生的差额，不外推下一期",
]

LIMITATIONS = [
    "归因是恒等式分解，不说明变动的原因：收入为什么变、净利率为什么变不在本模块的回答范围内",
    "两期口径不一致（如合并范围变化、会计政策变更、追溯重述）会让效应失真，模块无法自动识别",
    "交互项同时包含收入与净利率的变化，不能单独归给任一方；报告时必须保留三项，不许合并或略去",
    "不构成投资建议，也不产生评级、目标价或收益承诺",
]

SIGNATURE = ("operating_income", "net_profit")
PERIOD_KEYS = ("period_end_ms", "period")
ROUND = 6


class AnalysisInputError(Exception):
    """The input cannot be used at all; the host maps `analysis_code` to the stable protocol code."""

    analysis_code = "analysis_input_invalid"


def _round(value):
    rounded = round(float(value), ROUND)
    return 0.0 if rounded == 0 else rounded


def _plain(value):
    return int(value) if isinstance(value, float) and value.is_integer() else value


def _amount(value):
    """Money is integer yuan in the source; binary float noise below 0.00001 is not a real amount."""
    if value is None:
        return None
    nearest = round(float(value))
    if abs(float(value) - nearest) <= 1e-5:
        return int(nearest)
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
        raise AnalysisInputError("快照里没有任何 Dataset：earnings_bridge 需要一份利润表序列")
    views = {}
    for item in items:
        dataset_id = (item or {}).get("dataset_id")
        if not isinstance(dataset_id, str) or not dataset_id:
            raise AnalysisInputError("request.inputs.datasets 里有缺失 dataset_id 的条目")
        views[dataset_id] = context.read_dataset(dataset_id)
    for dataset_id, view in views.items():
        if view.get("shape") != "rows":
            raise AnalysisInputError(
                f"Dataset {dataset_id} 是 {view.get('shape')} 型：earnings_bridge 只吃表格数据，"
                "文档型输入请先走 profile 或证据"
            )
    return views


def _select_dataset(views, params):
    explicit = params.get("income_dataset_id")
    if isinstance(explicit, str) and explicit:
        if explicit not in views:
            raise AnalysisInputError(f"income_dataset_id={explicit} 不在本次快照的 Dataset 里")
        missing = [name for name in SIGNATURE if name not in _columns_of(views[explicit])]
        if missing:
            raise AnalysisInputError(f"income Dataset {explicit} 缺少 {'、'.join(missing)} 列：不是利润表")
        return explicit
    candidates = sorted(
        dataset_id for dataset_id, view in views.items()
        if all(name in _columns_of(view) for name in SIGNATURE)
    )
    if not candidates:
        raise AnalysisInputError(
            "没有 Dataset 同时含 operating_income 与 net_profit：earnings_bridge 需要一份利润表序列"
        )
    if len(candidates) > 1:
        raise AnalysisInputError(
            f"有 {len(candidates)} 份 Dataset 都像利润表（{'、'.join(candidates)}）：用 income_dataset_id 指明用哪一份"
        )
    return candidates[0]


def _join_key(view):
    columns = _columns_of(view)
    for name in PERIOD_KEYS:
        if name in columns:
            return name
    raise AnalysisInputError("利润表缺少报告期键：需要 period_end_ms 或 period 列，否则无法对齐两期")


def _index_rows(view, column):
    indexed = {}
    for row in view.get("rows") or []:
        if not isinstance(row, dict):
            raise AnalysisInputError("利润表的数据行不是对象：无法计算")
        key = row.get(column)
        if isinstance(key, bool) or not isinstance(key, (int, float, str)) or key == "":
            raise AnalysisInputError(f"利润表的 {column} 列有空值：无法对齐报告期")
        if key in indexed:
            raise AnalysisInputError(f"利润表在报告期 {key} 出现多行：无法判断用哪一行（请先去重）")
        indexed[key] = row
    return indexed


def _iso_date(ms):
    return datetime.fromtimestamp(float(ms) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def _label(rows, key, key_column):
    row = rows.get(key)
    text = row.get("period") if isinstance(row, dict) else None
    if isinstance(text, str) and text and any(ch.isdigit() for ch in text):
        return text
    if key_column == "period_end_ms" and isinstance(key, (int, float)) and not isinstance(key, bool):
        return _iso_date(key)
    return str(key)


def _period_candidates(rows, key, key_column):
    values = {str(key), _label(rows, key, key_column)}
    row = rows.get(key)
    if isinstance(row, dict):
        year = row.get("fiscal_year")
        if isinstance(year, int) and not isinstance(year, bool):
            values.add(str(year))
            period = row.get("fiscal_period")
            if isinstance(period, str) and period:
                values.add(f"{year}-{period}")
    return values


def _select_period(rows, params, key_column):
    if not rows:
        raise AnalysisInputError("利润表没有数据行：无法计算两期归因")
    requested = params.get("period")
    if isinstance(requested, str) and requested.strip():
        wanted = requested.strip()
        matches = [key for key in rows if wanted in _period_candidates(rows, key, key_column)]
        if not matches:
            available = "、".join(_label(rows, key, key_column) for key in sorted(rows))
            raise AnalysisInputError(f"报告期 {wanted} 不在这份利润表里；可选：{available}")
        if len(matches) > 1:
            labels = "、".join(_label(rows, key, key_column) for key in sorted(matches))
            raise AnalysisInputError(f"报告期 {wanted} 同时匹配多个报告期（{labels}）：请写完整报告期")
        return matches[0]
    return max(rows)


def _signed(value):
    return f"+{value}" if value > 0 else str(value)


def _revenue_bridge(previous, current):
    revenue_prev = _number(previous, "operating_income")
    revenue_cur = _number(current, "operating_income")
    net_prev = _number(previous, "net_profit")
    net_cur = _number(current, "net_profit")
    if revenue_prev is None or revenue_cur is None or net_prev is None or net_cur is None:
        return None, "两期营业收入或净利润有空值（或非数字）：收入/净利率分解无法计算"
    if revenue_prev <= 0 or revenue_cur <= 0:
        return None, "两期营业收入存在 ≤ 0：净利率没有经济含义，收入/净利率分解无法计算"
    margin_prev = net_prev / revenue_prev
    margin_cur = net_cur / revenue_cur
    change = net_cur - net_prev
    delta_revenue = revenue_cur - revenue_prev
    delta_margin = margin_cur - margin_prev
    revenue_effect = delta_revenue * margin_prev
    margin_effect = revenue_prev * delta_margin
    interaction = delta_revenue * delta_margin
    residual = change - (revenue_effect + margin_effect + interaction)
    return {
        "revenue_previous": _amount(revenue_prev),
        "revenue_current": _amount(revenue_cur),
        "net_margin_previous": _round(margin_prev),
        "net_margin_current": _round(margin_cur),
        "revenue_effect": _amount(revenue_effect),
        "margin_effect": _amount(margin_effect),
        "interaction_effect": _amount(interaction),
        "bridge_residual": _amount(residual),
        "formula": "ΔNP = ΔRevenue × margin_prev + Revenue_prev × Δmargin + ΔRevenue × Δmargin",
    }, None


def _tax_bridge(previous, current):
    profit_prev = _number(previous, "profit_total")
    profit_cur = _number(current, "profit_total")
    tax_prev = _number(previous, "income_tax_expense")
    tax_cur = _number(current, "income_tax_expense")
    net_prev = _number(previous, "net_profit")
    net_cur = _number(current, "net_profit")
    if None in (profit_prev, profit_cur, tax_prev, tax_cur, net_prev, net_cur):
        return None, "两期利润总额、所得税费用或净利润有空值（或非数字）：税前/税率分解无法计算"
    if profit_prev <= 0 or profit_cur <= 0:
        return None, "两期利润总额存在 ≤ 0：税率没有经济含义，税前/税率分解无法计算"
    rate_prev = tax_prev / profit_prev
    rate_cur = tax_cur / profit_cur
    change = net_cur - net_prev
    delta_profit = profit_cur - profit_prev
    delta_rate = rate_cur - rate_prev
    pretax_effect = delta_profit * (1 - rate_prev)
    tax_effect = profit_prev * (-delta_rate)
    interaction = delta_profit * (-delta_rate)
    residual = change - (pretax_effect + tax_effect + interaction)
    return {
        "profit_total_previous": _amount(profit_prev),
        "profit_total_current": _amount(profit_cur),
        "tax_rate_previous": _round(rate_prev),
        "tax_rate_current": _round(rate_cur),
        "pretax_effect": _amount(pretax_effect),
        "tax_rate_effect": _amount(tax_effect),
        "tax_interaction_effect": _amount(interaction),
        "tax_bridge_residual": _amount(residual),
        "formula": "ΔNP = ΔProfit_total × (1 − tax_prev) − Profit_total_prev × Δtax − ΔProfit_total × Δtax",
    }, None


def _summary(current_label, previous_label, nets, revenue_bridge, tax_bridge, gaps):
    net_prev, net_cur, change = nets
    if net_prev is None or net_cur is None:
        return f"{current_label} 较 {previous_label}：两期净利润有空值，无法计算差额与归因（见 data_gaps）。"
    head = f"{current_label} 较 {previous_label}：净利润 {_amount(net_prev)} → {_amount(net_cur)}（{_signed(_amount(change))}）。"
    parts = []
    if revenue_bridge:
        parts.append(
            f"收入效应 {_signed(revenue_bridge['revenue_effect'])}、净利率效应 {_signed(revenue_bridge['margin_effect'])}、"
            f"交互 {_signed(revenue_bridge['interaction_effect'])}（合计校验 {_signed(revenue_bridge['bridge_residual'])}）"
        )
    else:
        parts.append("收入/净利率分解未执行")
    if tax_bridge:
        parts.append(
            f"税前效应 {_signed(tax_bridge['pretax_effect'])}、税率效应 {_signed(tax_bridge['tax_rate_effect'])}、"
            f"交互 {_signed(tax_bridge['tax_interaction_effect'])}（合计校验 {_signed(tax_bridge['tax_bridge_residual'])}）"
        )
    if gaps:
        parts.append(f"{len(gaps)} 项缺口")
    return head + "归因：" + "；".join(parts) + "。"


def analyze(request: dict, context) -> dict:
    params = request.get("params") or {}
    views = _read_datasets(request, context)
    dataset_id = _select_dataset(views, params)
    view = views[dataset_id]
    methodology = [f"利润表 = {dataset_id}"]
    limitations = list(LIMITATIONS)
    gaps = []

    if view.get("truncated"):
        limitations.append(
            f"利润表被截断到 {len(view.get('rows') or [])} 行（max_input_rows）：归因只覆盖截断后的样本"
        )
    key_column = _join_key(view)
    if key_column == "period":
        limitations.append("报告期按 period 字符串排序（没有 period_end_ms 列）：格式不一致时可能选错两期")
    rows = _index_rows(view, key_column)
    current_key = _select_period(rows, params, key_column)
    current_label = _label(rows, current_key, key_column)
    previous_keys = [key for key in rows if key < current_key]
    methodology.append(f"报告期键 {key_column}；本期 {current_label}")

    if not previous_keys:
        gaps.append(f"没有早于 {current_label} 的报告期：两期归因无法计算")
        current = rows[current_key]
        nets = (_number(current, "net_profit"), _number(current, "net_profit"), 0.0)
        status = "blocked"
        metrics = {"net_profit_current": _amount(nets[1])}
        payload = {
            "protocol": "capital.analysis/v1",
            "module_id": MODULE_ID,
            "module_version": MODULE_VERSION,
            "analysis_id": request.get("analysis_id"),
            "module_run_id": request.get("module_run_id"),
            "income_dataset_id": dataset_id,
            "period": current_label,
            "previous_period": None,
            "metrics": metrics,
            "revenue_bridge": None,
            "tax_bridge": None,
            "data_gaps": gaps,
        }
        ref = context.write_output(OUTPUT_NAME, payload)
        context.log(f"{MODULE_ID}: blocked period={current_label} gaps={len(gaps)}")
        return {
            "status": status,
            "summary": f"{current_label} 只有一期利润表：无法计算两期归因（见 data_gaps）。",
            "metrics": metrics,
            "claims": [],
            "assumptions": list(ASSUMPTIONS),
            "methodology_log": methodology,
            "sensitivity": {},
            "limitations": limitations,
            "data_gaps": gaps,
            "outputs": [{"name": OUTPUT_NAME, "ref": ref}],
        }

    previous_key = max(previous_keys)
    previous_label = _label(rows, previous_key, key_column)
    previous = rows[previous_key]
    current = rows[current_key]
    methodology.append(f"上一期 {previous_label}")

    net_prev = _number(previous, "net_profit")
    net_cur = _number(current, "net_profit")
    metrics = {}
    if net_prev is None or net_cur is None:
        gaps.append("两期净利润有空值（或非数字）：差额无法计算")
        status = "blocked"
        nets = (None, None, None)
    else:
        change = net_cur - net_prev
        nets = (net_prev, net_cur, change)
        metrics.update({
            "net_profit_previous": _amount(net_prev),
            "net_profit_current": _amount(net_cur),
            "net_profit_change": _amount(change),
        })
        status = "completed"

    revenue_bridge, revenue_gap = (None, "两期净利润不可用")
    tax_bridge, tax_gap = (None, None)
    if nets[0] is not None:
        revenue_bridge, revenue_gap = _revenue_bridge(previous, current)
        tax_bridge, tax_gap = _tax_bridge(previous, current)
    if revenue_gap:
        gaps.append(f"收入/净利率分解未执行：{revenue_gap}")
    else:
        metrics.update({
            "revenue_previous": revenue_bridge["revenue_previous"],
            "revenue_current": revenue_bridge["revenue_current"],
            "net_margin_previous": revenue_bridge["net_margin_previous"],
            "net_margin_current": revenue_bridge["net_margin_current"],
            "revenue_effect": revenue_bridge["revenue_effect"],
            "margin_effect": revenue_bridge["margin_effect"],
            "interaction_effect": revenue_bridge["interaction_effect"],
            "bridge_residual": revenue_bridge["bridge_residual"],
        })
        methodology.append(
            f"收入/净利率分解：ΔRevenue={_amount(revenue_bridge['revenue_current'] - revenue_bridge['revenue_previous'])}，"
            f"Δmargin={_round(revenue_bridge['net_margin_current'] - revenue_bridge['net_margin_previous'])}，"
            f"三项合计与差额的残差 {revenue_bridge['bridge_residual']}"
        )
    if tax_gap:
        gaps.append(f"税前/税率分解未执行：{tax_gap}")
    else:
        metrics.update({
            "profit_total_previous": tax_bridge["profit_total_previous"],
            "profit_total_current": tax_bridge["profit_total_current"],
            "tax_rate_previous": tax_bridge["tax_rate_previous"],
            "tax_rate_current": tax_bridge["tax_rate_current"],
            "pretax_effect": tax_bridge["pretax_effect"],
            "tax_rate_effect": tax_bridge["tax_rate_effect"],
            "tax_interaction_effect": tax_bridge["tax_interaction_effect"],
            "tax_bridge_residual": tax_bridge["tax_bridge_residual"],
        })
        methodology.append(
            f"税前/税率分解：ΔProfit_total={_amount(tax_bridge['profit_total_current'] - tax_bridge['profit_total_previous'])}，"
            f"Δtax_rate={_round(tax_bridge['tax_rate_current'] - tax_bridge['tax_rate_previous'])}，"
            f"三项合计与差额的残差 {tax_bridge['tax_bridge_residual']}"
        )

    if revenue_gap and tax_gap:
        status = "blocked"
    elif gaps:
        status = "partial"
    elif status != "blocked":
        status = "completed"
    if nets[0] is not None:
        limitations.append("交互项不是误差项：它同时含两个因子的变化，报告时不要并入收入或净利率")

    payload = {
        "protocol": "capital.analysis/v1",
        "module_id": MODULE_ID,
        "module_version": MODULE_VERSION,
        "analysis_id": request.get("analysis_id"),
        "module_run_id": request.get("module_run_id"),
        "income_dataset_id": dataset_id,
        "period": current_label,
        "previous_period": previous_label,
        "period_key": key_column,
        "metrics": metrics,
        "revenue_bridge": revenue_bridge,
        "tax_bridge": tax_bridge,
        "data_gaps": gaps,
    }
    ref = context.write_output(OUTPUT_NAME, payload)
    context.log(f"{MODULE_ID}: {status} period={current_label} previous={previous_label} gaps={len(gaps)}")
    return {
        "status": status,
        "summary": _summary(current_label, previous_label, nets, revenue_bridge, tax_bridge, gaps),
        "metrics": metrics,
        "claims": [],
        "assumptions": list(ASSUMPTIONS),
        "methodology_log": methodology,
        "sensitivity": {},
        "limitations": limitations,
        "data_gaps": gaps,
        "outputs": [{"name": OUTPUT_NAME, "ref": ref}],
    }
