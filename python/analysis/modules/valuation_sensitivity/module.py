"""DCF model value plus WACC x terminal-growth sensitivity, from caller-stated assumptions only.

This is the "explicit valuation assumptions" shape of the module protocol: parameters only, no
Dataset. The caller supplies the projection-period FCFs, either WACC or the six CAPM inputs, the
perpetual growth rate, net debt, minority interest and diluted shares. The module discounts those
cash flows, builds the EV -> equity bridge and evaluates the caller's (or a default) WACC x growth
grid. It does not estimate FCF, pick a discount rate, forecast a price, rate the company or treat
the grid as a confidence interval: every number is arithmetic over the stated assumptions.

Pure standard library, so the arithmetic is auditable line by line and the module runs on the
minimal analysis runtime.

Protocol: `docs/dev/senior-analysis.md` §1.9. Conclusions and claims belong to the senior analyst;
this module only produces reproducible model values plus the assumptions behind them.
"""
from __future__ import annotations

import math

MODULE_ID = "valuation_sensitivity"
MODULE_VERSION = "1.0.0"
OUTPUT_NAME = "dcf_sensitivity"

MAX_PROJECTION_YEARS = 20
MAX_GRID_VALUES = 9
DEFAULT_GRID_STEP = 0.01
VALUE_DECIMALS = 6
CAPM_FIELDS = (
    "risk_free_rate", "beta", "equity_risk_premium",
    "cost_of_debt", "tax_rate", "debt_weight",
)

ASSUMPTIONS = [
    "预测期自由现金流与全部假设由调用方显式给出：模块只做折现与终值算术，不估计 FCF、增长率、WACC 或市场价格",
    "终值用戈登永续：TV_n = FCF_n × (1 + terminal_growth) / (wacc − terminal_growth)，再折现 n 期；wacc ≤ terminal_growth 直接拒绝",
    "企业价值 EV = Σ FCF_t/(1+wacc)^t + TV_n/(1+wacc)^n；mid_year 时每期指数为 t − 0.5，否则为 t",
    "股权价值 = EV − net_debt − minority_interest；每股模型值 = 股权价值 / shares_outstanding",
    "CAPM 路径：Ke = risk_free_rate + beta × equity_risk_premium；WACC = (1 − debt_weight) × Ke + debt_weight × cost_of_debt × (1 − tax_rate)；只作为 wacc 的推导口径，不代替市场利率",
    "输出是「给定假设下的模型值」：不是目标价、不是概率，也不代表市场价格应到哪；敏感性网格只是假设区间，不是置信区间",
]

LIMITATIONS = [
    "模型值是给定假设的算术结果：FCF、增长率与折现率换一组假设就会得出另一组数，不能当作价格预测",
    "Gordon 终值对 wacc − terminal_growth 极敏感；两者接近时模型值急剧放大，网格里的高低值不代表概率",
    "只做单阶段永续增长，不外推预测期、不做多阶段或退出倍数估值，也不处理周期性极强或亏损企业的转折",
    "不做跨币种换算、通胀调整、控制权溢价、流动性折价或税务重构；金额口径必须与预测 FCF 一致",
    "不构成投资建议，也不产生评级、目标价或收益承诺",
]


class AnalysisInputError(Exception):
    """The input cannot be used at all; the host maps `analysis_code` to the stable protocol code."""

    analysis_code = "analysis_input_invalid"


def _round(value):
    rounded = round(float(value), VALUE_DECIMALS)
    if rounded == 0:
        return 0
    return int(rounded) if float(rounded).is_integer() else rounded


def _maybe(value):
    return None if value is None else _round(value)


def _number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AnalysisInputError(f"{label} 必须是数字，实际是 {value!r}")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        raise AnalysisInputError(f"{label} 必须是有限数字，实际是 {value!r}")
    return number


def _finite(value, label):
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        raise AnalysisInputError(f"{label} 不是有限数：请检查 wacc、terminal_growth 与预测期 FCF 的量级")
    return number


def _fmt6(value):
    """Six decimals with trailing zeros trimmed: the display shape of every rounded number."""
    text = f"{_round(value):.6f}".rstrip("0").rstrip(".")
    return text if text not in ("", "-0") else "0"


def _pct(value):
    return f"{value * 100:.2f}%"


def _text(value, label):
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise AnalysisInputError(f"{label} 必须是非空字符串")
    return value.strip()


def _projections(params):
    raw = params.get("projections")
    if not isinstance(raw, list) or not raw:
        raise AnalysisInputError("projections 必须是非空数组：至少给出 1 期预测期自由现金流（模块不估计 FCF）")
    if len(raw) > MAX_PROJECTION_YEARS:
        raise AnalysisInputError(f"projections 最多 {MAX_PROJECTION_YEARS} 期，实际 {len(raw)} 期")
    return [_number(item, f"projections[{index}]") for index, item in enumerate(raw)]


def _required_number(params, name, note):
    if params.get(name) is None:
        raise AnalysisInputError(f"{name} 缺失：{note}")
    return _number(params.get(name), name)


def _optional_number(params, name):
    if params.get(name) is None:
        return None
    return _number(params.get(name), name)


def _capm(params):
    """Derive WACC from the six CAPM inputs; only used when `wacc` itself is absent."""
    missing = [name for name in CAPM_FIELDS if params.get(name) is None]
    if missing:
        raise AnalysisInputError(
            f"未给 wacc，CAPM 推导缺少 {'、'.join(missing)}；"
            f"要么直接给 wacc，要么把 {' / '.join(CAPM_FIELDS)} 六个参数给全"
        )
    values = {name: _number(params[name], f"CAPM {name}") for name in CAPM_FIELDS}
    if not 0.0 <= values["debt_weight"] <= 1.0:
        raise AnalysisInputError(f"CAPM debt_weight 必须在 0..1，实际是 {values['debt_weight']!r}")
    if not 0.0 <= values["tax_rate"] <= 1.0:
        raise AnalysisInputError(f"CAPM tax_rate 必须在 0..1，实际是 {values['tax_rate']!r}")
    if values["cost_of_debt"] < 0:
        raise AnalysisInputError(f"CAPM cost_of_debt 不能为负，实际是 {values['cost_of_debt']!r}")
    cost_of_equity = values["risk_free_rate"] + values["beta"] * values["equity_risk_premium"]
    cost_of_equity = _finite(cost_of_equity, "CAPM 推导的 Ke")
    debt_weight = values["debt_weight"]
    wacc = _finite(
        (1.0 - debt_weight) * cost_of_equity
        + debt_weight * values["cost_of_debt"] * (1.0 - values["tax_rate"]),
        "CAPM 推导的 WACC",
    )
    return wacc, {
        "cost_of_equity": _round(cost_of_equity),
        "wacc": _round(wacc),
        **{name: _round(values[name]) for name in CAPM_FIELDS},
    }


def _resolve_wacc(params):
    wacc_raw = params.get("wacc")
    capm_given = any(params.get(name) is not None for name in CAPM_FIELDS)
    if wacc_raw is not None:
        return _number(wacc_raw, "wacc"), "param", None, capm_given
    wacc, capm = _capm(params)
    return wacc, "capm", capm, False


def _axis(params, key, *, floor, inclusive):
    """Explicit grid axis (sorted, de-duplicated) or None when the caller omitted it."""
    raw = params.get(key)
    if raw is None:
        return None
    if not isinstance(raw, list) or not raw:
        raise AnalysisInputError(f"{key} 必须是非空数组（省略即围绕基准值取默认标准点）")
    if len(raw) > MAX_GRID_VALUES:
        raise AnalysisInputError(f"{key} 最多 {MAX_GRID_VALUES} 个值，实际 {len(raw)} 个")
    values = []
    for index, item in enumerate(raw):
        value = _round(_number(item, f"{key}[{index}]"))
        if inclusive:
            if value < floor:
                raise AnalysisInputError(f"{key} 里的值必须 ≥ {_fmt6(floor)}，实际是 {_fmt6(value)}")
        elif value <= floor:
            raise AnalysisInputError(f"{key} 里的值必须 > {_fmt6(floor)}，实际是 {_fmt6(value)}")
        if value in values:
            raise AnalysisInputError(f"{key} 有重复值 {_fmt6(value)}：同一网格轴只能出现一次")
        values.append(value)
    return sorted(values)


def _default_axis(center, *, floor, inclusive, upper_exclusive=None):
    """Caller omitted the axis: center ±1pp, dropping points that would be out of range."""
    center = _round(center)
    values = []
    for candidate in (center - DEFAULT_GRID_STEP, center, center + DEFAULT_GRID_STEP):
        candidate = _round(candidate)
        if inclusive:
            if candidate < floor:
                continue
        elif candidate <= floor:
            continue
        if upper_exclusive is not None and candidate >= upper_exclusive:
            continue
        if candidate not in values:
            values.append(candidate)
    return sorted(values)


def _dcf(projections, wacc, terminal_growth, mid_year):
    """Explicit-period PVs, Gordon terminal value and enterprise value; all from the input assumptions."""
    rows, present_values = [], []
    for period, fcf in enumerate(projections, start=1):
        exponent = period - 0.5 if mid_year else float(period)
        try:
            discount_factor = 1.0 / (1.0 + wacc) ** exponent
        except OverflowError as error:
            raise AnalysisInputError(
                f"wacc={_fmt6(wacc)} 的折现因子溢出：请检查折现率与预测期期数"
            ) from error
        present_value = _finite(fcf * discount_factor, f"第 {period} 期现值")
        present_values.append(present_value)
        rows.append({
            "period": period,
            "fcf": _round(fcf),
            "exponent": exponent,
            "discount_factor": _round(discount_factor),
            "present_value": _round(present_value),
        })
    present_value_explicit = math.fsum(present_values)
    denominator = wacc - terminal_growth
    if denominator <= 0:
        raise AnalysisInputError(
            f"wacc（{_fmt6(wacc)}）必须大于 terminal_growth（{_fmt6(terminal_growth)}）："
            "否则 Gordon 终值分母 ≤ 0，模型无经济含义"
        )
    try:
        terminal_value = projections[-1] * (1.0 + terminal_growth) / denominator
    except OverflowError as error:
        raise AnalysisInputError(
            f"终值溢出：wacc={_fmt6(wacc)} 与 terminal_growth={_fmt6(terminal_growth)} 过于接近"
        ) from error
    terminal_value = _finite(terminal_value, "Gordon 终值")
    exponent = len(projections) - 0.5 if mid_year else float(len(projections))
    try:
        terminal_present_value = terminal_value / (1.0 + wacc) ** exponent
    except OverflowError as error:
        raise AnalysisInputError(f"终值折现因子溢出：wacc={_fmt6(wacc)} 过大") from error
    terminal_present_value = _finite(terminal_present_value, "终值现值")
    enterprise_value = _finite(
        math.fsum([present_value_explicit, terminal_present_value]),
        "企业价值",
    )
    return {
        "rows": rows,
        "present_value_explicit": present_value_explicit,
        "terminal_value": terminal_value,
        "terminal_present_value": terminal_present_value,
        "terminal_exponent": exponent,
        "enterprise_value": enterprise_value,
    }


def _equity_value(model, net_debt, minority_interest):
    return model["enterprise_value"] - net_debt - minority_interest


def _fit(axis, target):
    for index, value in enumerate(axis):
        if abs(value - target) <= 1e-9:
            return index
    return None


def _grid(projections, wacc_axis, growth_axis, net_debt, minority_interest, shares_outstanding, mid_year, gaps):
    """Evaluate every cell; a cell whose Gordon denominator is ≤ 0 stays null and is named in gaps."""
    rows, cells, null_cells = [], [], 0
    for terminal_growth in growth_axis:
        row = []
        for wacc in wacc_axis:
            value = None
            if wacc <= terminal_growth:
                gaps.append(
                    f"敏感性网格格点无定义：wacc={_fmt6(wacc)} ≤ terminal_growth={_fmt6(terminal_growth)}，"
                    "Gordon 终值分母 ≤ 0，该格写 null"
                )
            else:
                if net_debt is None or shares_outstanding is None:
                    # The bridge-level gap already explains why every cell is null here.
                    value = None
                else:
                    try:
                        model = _dcf(projections, wacc, terminal_growth, mid_year)
                        equity = _equity_value(model, net_debt, minority_interest)
                        value = _finite(equity / shares_outstanding, "每股模型值")
                    except AnalysisInputError as error:
                        gaps.append(
                            f"敏感性网格格点无法计算：wacc={_fmt6(wacc)}、terminal_growth={_fmt6(terminal_growth)}：{error}"
                        )
            cells.append({
                "wacc": _round(wacc),
                "terminal_growth": _round(terminal_growth),
                "value_per_share": None if value is None else _round(value),
            })
            if value is None:
                null_cells += 1
            row.append(value)
        rows.append(row)
    return cells, rows, null_cells


def _sensitivity(wacc_axis, growth_axis, rows, center_wacc, center_growth, gaps):
    """Center cell plus the one-standard-point differences the summary quotes."""
    center_column = _fit(wacc_axis, center_wacc)
    center_row = _fit(growth_axis, center_growth)
    center = {
        "wacc": _round(center_wacc),
        "terminal_growth": _round(center_growth),
        "value_per_share": None,
    }
    wacc_plus = growth_plus = None
    wacc_delta = growth_delta = None
    if center_column is None or center_row is None:
        gaps.append(
            f"敏感性摘要未计算：网格里没有中心格（wacc={_fmt6(center_wacc)}、"
            f"terminal_growth={_fmt6(center_growth)}）"
        )
    else:
        center_value = rows[center_row][center_column]
        center["value_per_share"] = None if center_value is None else _round(center_value)
        wacc_column = _fit(wacc_axis, _round(center_wacc + DEFAULT_GRID_STEP))
        if wacc_column is None:
            gaps.append(
                f"敏感性摘要未计算：网格没有 wacc+1pp 标准点（wacc={_fmt6(center_wacc + DEFAULT_GRID_STEP)}），"
                "wacc_1pp_value_per_share 写 null"
            )
        elif center_value is not None and rows[center_row][wacc_column] is not None:
            wacc_plus = _round(rows[center_row][wacc_column])
            wacc_delta = _round(rows[center_row][wacc_column] - center_value)
        growth_row = _fit(growth_axis, _round(center_growth + DEFAULT_GRID_STEP))
        if growth_row is None:
            gaps.append(
                f"敏感性摘要未计算：网格没有 g+1pp 标准点（g={_fmt6(center_growth + DEFAULT_GRID_STEP)}），"
                "growth_1pp_value_per_share 写 null"
            )
        elif center_value is not None and rows[growth_row][center_column] is not None:
            growth_plus = _round(rows[growth_row][center_column])
            growth_delta = _round(rows[growth_row][center_column] - center_value)
    return {
        "center": center,
        # Deltas between the center cell and the adjacent +1pp cell, not probabilities.
        "wacc_1pp_value_per_share": wacc_delta,
        "growth_1pp_value_per_share": growth_delta,
        "wacc_plus_1pp_cell_value_per_share": wacc_plus,
        "growth_plus_1pp_cell_value_per_share": growth_plus,
        "wacc_grid": [_round(value) for value in wacc_axis],
        "terminal_growth_grid": [_round(value) for value in growth_axis],
        "cells": len(wacc_axis) * len(growth_axis),
        "null_cells": sum(1 for row in rows for value in row if value is None),
    }


def _result(status, summary, metrics, sensitivity, methodology, limitations, gaps, outputs):
    return {
        "status": status,
        "summary": summary,
        "metrics": metrics,
        "claims": [],
        "assumptions": list(ASSUMPTIONS),
        "methodology_log": methodology,
        "sensitivity": sensitivity,
        "limitations": limitations,
        "data_gaps": gaps,
        "outputs": outputs,
    }


def analyze(request: dict, context) -> dict:
    params = request.get("params") or {}
    projections = _projections(params)
    terminal_growth = _required_number(
        params, "terminal_growth", "Gordon 终值需要永续增长率（小数）；模块不估计增长率"
    )
    net_debt = _optional_number(params, "net_debt")
    shares_outstanding = _optional_number(params, "shares_outstanding")
    minority_interest = _optional_number(params, "minority_interest")
    if minority_interest is None:
        minority_interest = 0.0
    elif minority_interest < 0:
        raise AnalysisInputError("minority_interest 不能为负：少数股东权益从 EV 里扣除，负值没有经济含义")
    mid_year = params.get("mid_year", False)
    if not isinstance(mid_year, bool):
        raise AnalysisInputError(f"mid_year 必须是布尔值，实际是 {mid_year!r}")
    currency = _text(params.get("currency"), "currency")

    if terminal_growth < 0:
        raise AnalysisInputError(f"terminal_growth 不能为负，实际是 {_fmt6(terminal_growth)}")
    wacc, wacc_source, capm, capm_given = _resolve_wacc(params)
    if wacc <= 0:
        raise AnalysisInputError(f"wacc 必须 > 0，实际是 {_fmt6(wacc)}")
    if wacc <= terminal_growth:
        raise AnalysisInputError(
            f"wacc（{_fmt6(wacc)}）必须大于 terminal_growth（{_fmt6(terminal_growth)}）："
            "否则 Gordon 终值分母 ≤ 0，模型无经济含义"
        )
    if shares_outstanding is not None and shares_outstanding <= 0:
        raise AnalysisInputError(f"shares_outstanding 必须 > 0，实际是 {_fmt6(shares_outstanding)}")

    wacc_axis = _axis(params, "wacc_grid", floor=0.0, inclusive=False)
    growth_axis = _axis(params, "terminal_growth_grid", floor=0.0, inclusive=True)
    wacc_defaulted = wacc_axis is None
    growth_defaulted = growth_axis is None
    if wacc_defaulted:
        wacc_axis = _default_axis(wacc, floor=0.0, inclusive=False)
    if growth_defaulted:
        growth_axis = _default_axis(terminal_growth, floor=0.0, inclusive=True, upper_exclusive=wacc)

    gaps = []
    model = _dcf(projections, wacc, terminal_growth, mid_year)
    enterprise_value = model["enterprise_value"]
    equity_value = None if net_debt is None else _equity_value(model, net_debt, minority_interest)
    value_per_share = None
    if equity_value is not None and shares_outstanding is not None:
        value_per_share = _finite(equity_value / shares_outstanding, "每股模型值")
    if net_debt is None:
        gaps.append("net_debt 缺失：只算到企业价值，股权价值与每股模型值未计算（不按 0 处理）")
    if shares_outstanding is None:
        gaps.append("shares_outstanding 缺失：每股模型值与敏感性网格未计算（不猜股本）")
    terminal_share = None
    if enterprise_value > 0:
        terminal_share = model["terminal_present_value"] / enterprise_value
    else:
        gaps.append(
            f"企业价值非正（{_fmt6(enterprise_value)}）：终值占比无定义，terminal_value_share 写 null"
        )

    cells, rows, null_cells = _grid(
        projections, wacc_axis, growth_axis, net_debt, minority_interest, shares_outstanding, mid_year, gaps
    )
    sensitivity = _sensitivity(wacc_axis, growth_axis, rows, wacc, terminal_growth, gaps)

    metrics = {
        "enterprise_value": _round(enterprise_value),
        "equity_value": _maybe(equity_value),
        "value_per_share": _maybe(value_per_share),
        "terminal_value": _round(model["terminal_present_value"]),
        "terminal_value_nominal": _round(model["terminal_value"]),
        "terminal_value_share": None if terminal_share is None else _round(terminal_share),
        "wacc": _round(wacc),
        "terminal_growth": _round(terminal_growth),
        "projection_years": len(projections),
        "net_debt": _maybe(net_debt),
        "minority_interest": _round(minority_interest),
        "shares_outstanding": _maybe(shares_outstanding),
    }

    exponent_text = "t − 0.5" if mid_year else "t"
    terminal_exponent_text = f"n − 0.5（{_fmt6(model['terminal_exponent'])}）" if mid_year \
        else f"n（{_fmt6(model['terminal_exponent'])}）"
    bridge_text = (
        f"股权价值 = EV − net_debt − minority_interest = {_fmt6(equity_value)}；"
        f"每股模型值 = 股权价值 / shares_outstanding = {_fmt6(value_per_share)}"
        if equity_value is not None and value_per_share is not None
        else "股权价值与每股模型值未计算（缺 net_debt 或 shares_outstanding，见 data_gaps）"
    )
    methodology = [
        f"预测期 {len(projections)} 期；{'年中' if mid_year else '年末'}折现：第 t 期指数 {exponent_text}，"
        f"终值指数 {terminal_exponent_text}（终值与最后一期同口径，不额外提前一期）",
        f"Gordon 终值：TV_n = FCF_n × (1 + g)/(wacc − g) = {_fmt6(model['terminal_value'])}；"
        f"折现后 TV 现值 {_fmt6(model['terminal_present_value'])}",
        f"EV = Σ PV_t + PV_TV = {_fmt6(enterprise_value)}；{bridge_text}",
    ]
    if wacc_source == "capm":
        methodology.append(
            f"CAPM 推 WACC：Ke = risk_free_rate + beta × equity_risk_premium = {_fmt6(capm['cost_of_equity'])}；"
            f"WACC = (1 − debt_weight) × Ke + debt_weight × cost_of_debt × (1 − tax_rate) = {_fmt6(wacc)}"
        )
    elif capm_given:
        methodology.append("调用方同时给了 CAPM 参数：按约定以显式 wacc 为准，CAPM 未参与本次计算")
    else:
        methodology.append(f"WACC 来源：调用方显式给定 wacc={_fmt6(wacc)}，未使用 CAPM 推导")
    if minority_interest == 0 and params.get("minority_interest") is None:
        methodology.append("minority_interest 省略：EV→股权桥按 0 扣除，这是披露的缺省口径，不是从数据估出")
    methodology.append(
        f"敏感性网格：wacc_grid（{'默认标准点' if wacc_defaulted else '调用方给定'}）"
        f"{[_fmt6(value) for value in wacc_axis]} × terminal_growth_grid"
        f"（{'默认标准点' if growth_defaulted else '调用方给定'}）"
        f"{[_fmt6(value) for value in growth_axis]}；"
        f"共 {len(cells)} 格、{null_cells} 格 null；标准点只是假设区间，不是置信区间"
    )
    methodology.append(
        f"sensitivity.wacc_1pp_value_per_share / growth_1pp_value_per_share 是中心格与 +1pp 相邻格的每股模型值差分；"
        f"金额与每股保留 {VALUE_DECIMALS} 位小数，{len(gaps)} 项缺口"
    )

    parts = [
        f"{len(projections)} 期预测、wacc {_pct(wacc)}"
        f"{'（CAPM 推导）' if wacc_source == 'capm' else ''}、终值增长 {_pct(terminal_growth)}"
        f"（{'年中' if mid_year else '年末'}折现）",
    ]
    if value_per_share is not None:
        parts.append(
            f"EV {_fmt6(enterprise_value)}、股权价值 {_fmt6(equity_value)}、"
            f"每股模型值 {_fmt6(value_per_share)}"
        )
    else:
        parts.append(f"EV {_fmt6(enterprise_value)}")
        parts.append("股权桥 / 每股模型值未计算（见 data_gaps）")
    if terminal_share is not None:
        parts.append(f"终值现值占 EV {_pct(terminal_share)}")
    has_deltas = (
        sensitivity["wacc_1pp_value_per_share"] is not None
        and sensitivity["growth_1pp_value_per_share"] is not None
    )
    if has_deltas:
        parts.append(
            f"WACC +1pp 每股模型值差分 {_fmt6(sensitivity['wacc_1pp_value_per_share'])}、"
            f"g +1pp {_fmt6(sensitivity['growth_1pp_value_per_share'])}"
        )
    summary = "；".join(parts) + "。"
    if gaps:
        summary += "（有缺口未计算，见 data_gaps）"
    summary += "这是给定假设下的模型值，不是目标价、不是预测。"

    payload = {
        "protocol": "capital.analysis/v1",
        "module_id": MODULE_ID,
        "module_version": MODULE_VERSION,
        "analysis_id": request.get("analysis_id"),
        "module_run_id": request.get("module_run_id"),
        "parameters": {
            "projections": [_round(value) for value in projections],
            "wacc": _round(wacc),
            "wacc_source": wacc_source,
            "terminal_growth": _round(terminal_growth),
            "net_debt": _maybe(net_debt),
            "minority_interest": _round(minority_interest),
            "minority_interest_source": "param" if params.get("minority_interest") is not None else "default_zero",
            "shares_outstanding": _maybe(shares_outstanding),
            "mid_year": mid_year,
            "currency": currency,
            "wacc_grid": [_round(value) for value in wacc_axis],
            "wacc_grid_source": "default" if wacc_defaulted else "explicit",
            "terminal_growth_grid": [_round(value) for value in growth_axis],
            "terminal_growth_grid_source": "default" if growth_defaulted else "explicit",
        },
        "capm": capm,
        "discounting": {
            "mid_year": mid_year,
            "exponent_rule": "t - 0.5" if mid_year else "t",
            "terminal_value_exponent": model["terminal_exponent"],
            "terminal_value_rule": "same n / n - 0.5 convention as the projection period",
        },
        "projections": model["rows"],
        "terminal_value": {
            "method": "gordon",
            "terminal_fcf": _round(projections[-1]),
            "growth": _round(terminal_growth),
            "wacc": _round(wacc),
            "value": _round(model["terminal_value"]),
            "present_value": _round(model["terminal_present_value"]),
            "discount_exponent": model["terminal_exponent"],
        },
        "enterprise_value": _round(enterprise_value),
        "bridge": {
            "enterprise_value": _round(enterprise_value),
            "net_debt": _maybe(net_debt),
            "minority_interest": _round(minority_interest),
            "equity_value": _maybe(equity_value),
            "shares_outstanding": _maybe(shares_outstanding),
            "value_per_share": _maybe(value_per_share),
        },
        "sensitivity": {
            "wacc_grid": [_round(value) for value in wacc_axis],
            "terminal_growth_grid": [_round(value) for value in growth_axis],
            "cells": cells,
            "null_cells": null_cells,
        },
        "assumptions": list(ASSUMPTIONS),
        "data_gaps": gaps,
    }
    ref = context.write_output(OUTPUT_NAME, payload)
    context.log(
        f"{MODULE_ID}: {len(projections)} periods wacc={_fmt6(wacc)} g={_fmt6(terminal_growth)} "
        f"grid={len(cells)} null={null_cells} gaps={len(gaps)}"
    )
    return _result(
        "partial" if gaps else "completed",
        summary,
        metrics,
        sensitivity,
        methodology,
        list(LIMITATIONS),
        gaps,
        [{"name": OUTPUT_NAME, "ref": ref}],
    )
