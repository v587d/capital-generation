"""Scenario sensitivity: evaluate one explicit arithmetic identity over an assumption grid.

This is the "assumption grid" input shape of the module protocol. The caller supplies base values
for 1-4 factors, the identity that relates them (`product` = Π factor^exponent, or `sum` =
Σ factor×exponent), an optional grid of factor values and optional named scenarios. The module only
evaluates that identity at the points the caller chose: it does not invent assumptions, fit a
distribution, extrapolate, or forecast anything. Every row is traceable to the base values and the
explicit override that produced it.

Pure standard library (no numpy/pandas); the arithmetic is visible line by line and the module runs
on the minimal analysis runtime.

Protocol: `docs/dev/senior-analysis.md` §1.9. Conclusions and claims belong to the senior analyst;
this module only produces reproducible scenario values plus the assumptions behind each one.
"""
from __future__ import annotations

import itertools
import math

MODULE_ID = "scenario_sensitivity"
MODULE_VERSION = "1.0.0"
OUTPUT_NAME = "scenarios"

MAX_FACTORS = 4
MAX_GRID_VALUES = 32
MAX_GRID_CELLS = 256
MAX_SCENARIOS = 12

ASSUMPTIONS = [
    "目标是显式算术恒等式：product 模型 target = Π factor^exponent；sum 模型 target = Σ factor×exponent",
    "因子基准值由调用方给出，本模块不判断其来源、口径或是否来自同一期",
    "情景值由调用方给出；未在情景里出现的因子继承基准，并在 trace 里标 inherited",
    "网格是单因子扫描（oat）或网格因子笛卡尔积（full），不做随机采样、不插值",
    "输出只是同一恒等式在不同假设下的取值，不是预测、不是概率，也不构成收益承诺",
    "product 模型下负基准值只允许整数指数；零基准值不允许负指数",
]

LIMITATIONS = [
    "恒等式是调用方给的：模块不验证因子之间是否独立、口径是否一致或假设是否合理",
    "情景与网格的边界由调用方给定；模块不生成假设，也不把格点区间当置信区间",
    "不做概率分布、反馈回路或非线性模型；需要这些时本模块不适用",
    "不构成投资建议，也不产生评级、目标价或收益承诺",
]


class AnalysisInputError(Exception):
    """The input cannot be used at all; the host maps `analysis_code` to the stable protocol code."""

    analysis_code = "analysis_input_invalid"


def _round(value):
    rounded = round(float(value), 6)
    return 0.0 if rounded == 0 else rounded


def _number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AnalysisInputError(f"{label} 必须是数字，实际是 {value!r}")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        raise AnalysisInputError(f"{label} 必须是有限数字，实际是 {value!r}")
    return number


def _fmt6(value):
    """Six decimals, trailing zeros trimmed: the same shape the metrics are rounded to."""
    text = f"{_round(value):.6f}".rstrip("0").rstrip(".")
    return text if text not in ("", "-0") else "0"


def _pct(value):
    return f"{value * 100:.2f}%"


def _text(value, label, *, required=False):
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip():
        raise AnalysisInputError(f"{label} 必须是非空字符串")
    return value.strip()


def _factors(params):
    raw = params.get("factors")
    if not isinstance(raw, list) or not raw:
        raise AnalysisInputError("factors 必须是非空数组：至少给出一个因子与基准值")
    if len(raw) > MAX_FACTORS:
        raise AnalysisInputError(f"factors 最多 {MAX_FACTORS} 个，实际 {len(raw)} 个")
    factors, seen = [], set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise AnalysisInputError(f"factors[{index}] 必须是对象")
        name = _text(item.get("name"), f"factors[{index}].name", required=True)
        if name in seen:
            raise AnalysisInputError(f"因子名重复：{name}；同一因子只能出现一次")
        seen.add(name)
        base = _number(item.get("base"), f"factors[{index}].base")
        exponent = _number(item.get("exponent", 1.0), f"factors[{index}].exponent")
        unit = _text(item.get("unit"), f"factors[{index}].unit")
        factors.append({"name": name, "base": base, "unit": unit, "exponent": exponent})
    return factors


def _model(params):
    model = params.get("model", "product")
    if model not in ("product", "sum"):
        raise AnalysisInputError(f"model 只能是 product 或 sum，实际是 {model!r}")
    return model


def _check_bases(model, factors):
    if model == "sum":
        return
    for factor in factors:
        base, exponent = factor["base"], factor["exponent"]
        if base == 0 and exponent < 0:
            raise AnalysisInputError(f"因子 {factor['name']} 的基准值为 0，不允许负指数（0^-1 无定义）")
        if base < 0 and not exponent.is_integer():
            raise AnalysisInputError(
                f"因子 {factor['name']} 的基准值为负（{base}），product 模型只允许整数指数，实际是 {exponent}"
            )


def _evaluate(model, factors, values):
    if model == "product":
        result = 1.0
        for factor in factors:
            base = values[factor["name"]]
            exponent = factor["exponent"]
            if base == 0 and exponent < 0:
                raise AnalysisInputError(f"因子 {factor['name']} 取 0 时不允许负指数")
            if base < 0 and not exponent.is_integer():
                raise AnalysisInputError(f"因子 {factor['name']} 取负值（{base}）时只允许整数指数")
            result *= base ** exponent
    else:
        result = math.fsum(values[factor["name"]] * factor["exponent"] for factor in factors)
    if isinstance(result, complex) or result != result or result in (float("inf"), float("-inf")):
        raise AnalysisInputError("目标值不是有限实数：检查因子的基准值、指数与情景取值")
    return float(result)


def _grid(params, factors, model, base_values, base_target):
    raw = params.get("grid")
    if raw is None:
        return None, [], []
    if not isinstance(raw, list) or not raw:
        raise AnalysisInputError("grid 必须是非空数组（或省略）；空数组请直接省略")
    if len(raw) > MAX_FACTORS:
        raise AnalysisInputError(f"grid 最多覆盖 {MAX_FACTORS} 个因子，实际 {len(raw)} 个")
    known = {factor["name"] for factor in factors}
    entries, seen = [], set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise AnalysisInputError(f"grid[{index}] 必须是对象")
        name = _text(item.get("factor"), f"grid[{index}].factor", required=True)
        if name not in known:
            raise AnalysisInputError(f"grid[{index}].factor={name!r} 不是已声明的因子")
        if name in seen:
            raise AnalysisInputError(f"grid 里因子 {name} 出现了两次；每个因子只能有一组扫描值")
        seen.add(name)
        values = item.get("values")
        if not isinstance(values, list) or not values:
            raise AnalysisInputError(f"grid[{index}].values 必须是非空数组")
        if len(values) > MAX_GRID_VALUES:
            raise AnalysisInputError(f"grid[{index}].values 最多 {MAX_GRID_VALUES} 个值，实际 {len(values)} 个")
        entries.append({"factor": name, "values": [_number(value, f"grid[{index}].values") for value in values]})
    mode = params.get("grid_mode", "oat")
    if mode not in ("oat", "full"):
        raise AnalysisInputError(f"grid_mode 只能是 oat 或 full，实际是 {mode!r}")

    rows = []
    if mode == "full":
        cells = math.prod(len(entry["values"]) for entry in entries)
        if cells > MAX_GRID_CELLS:
            raise AnalysisInputError(f"full 网格 {cells} 格超过 {MAX_GRID_CELLS} 格上限：减少因子或取值")
        names = [entry["factor"] for entry in entries]
        for combo in itertools.product(*[entry["values"] for entry in entries]):
            values = dict(base_values)
            values.update(dict(zip(names, combo)))
            target = _evaluate(model, factors, values)
            rows.append(_row({"values": {name: _round(value) for name, value in zip(names, combo)}, "target": target}, base_target))
    else:
        for entry in entries:
            for value in entry["values"]:
                values = dict(base_values)
                values[entry["factor"]] = value
                target = _evaluate(model, factors, values)
                rows.append(_row({"factor": entry["factor"], "value": _round(value), "target": target}, base_target))
    summary = {
        "mode": mode,
        "cells": len(rows),
        "min": min(row["target"] for row in rows),
        "max": max(row["target"] for row in rows),
        "rows": rows,
    }
    return summary, rows, [row["target"] for row in rows]


def _row(row, base_target):
    target = row.pop("target")
    delta = _round(target - base_target)
    pct = None if base_target == 0 else _round(target / base_target - 1)
    row.update({"target": _round(target), "delta": delta, "delta_pct": pct})
    return row


def _scenarios(params, factors, model, base_values, base_target):
    raw = params.get("scenarios")
    if raw is None:
        return [], []
    if not isinstance(raw, list) or not raw:
        raise AnalysisInputError("scenarios 必须是非空数组（或省略）；空数组请直接省略")
    if len(raw) > MAX_SCENARIOS:
        raise AnalysisInputError(f"scenarios 最多 {MAX_SCENARIOS} 个，实际 {len(raw)} 个")
    known = {factor["name"] for factor in factors}
    rows, names = [], set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise AnalysisInputError(f"scenarios[{index}] 必须是对象")
        name = _text(item.get("name"), f"scenarios[{index}].name", required=True)
        if name in names:
            raise AnalysisInputError(f"情景名重复：{name}")
        names.add(name)
        overrides = item.get("values")
        if not isinstance(overrides, dict):
            raise AnalysisInputError(f"scenarios[{index}].values 必须是对象")
        values = dict(base_values)
        inherited = []
        for key, value in overrides.items():
            if key not in known:
                raise AnalysisInputError(f"scenarios[{index}].values 里的 {key!r} 不是已声明的因子")
            values[key] = _number(value, f"scenarios[{index}].values.{key}")
        for factor in factors:
            if factor["name"] not in overrides:
                inherited.append(factor["name"])
        target = _evaluate(model, factors, values)
        rows.append(_row({"name": name, "values": {factor["name"]: _round(values[factor["name"]]) for factor in factors},
                          "inherited": inherited, "target": target}, base_target))
    return rows, [row["target"] for row in rows]


def _expression(model, factors):
    if model == "product":
        parts = [factor["name"] if factor["exponent"] == 1 else f"{factor['name']}^{_fmt6(factor['exponent'])}"
                 for factor in factors]
        return " × ".join(parts)
    text = ""
    for index, factor in enumerate(factors):
        exponent = factor["exponent"]
        magnitude = factor["name"] if abs(exponent) == 1 else f"{_fmt6(abs(exponent))}×{factor['name']}"
        if index == 0:
            text = f"-{magnitude}" if exponent < 0 else magnitude
        else:
            text += f" {'-' if exponent < 0 else '+'} {magnitude}"
    return text


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
    target_name = _text(params.get("target_name"), "target_name", required=True)
    target_unit = _text(params.get("target_unit"), "target_unit")
    model = _model(params)
    factors = _factors(params)
    _check_bases(model, factors)
    base_values = {factor["name"]: factor["base"] for factor in factors}
    base_target = _evaluate(model, factors, base_values)

    grid_summary, grid_rows, grid_targets = _grid(params, factors, model, base_values, base_target)
    scenario_rows, scenario_targets = _scenarios(params, factors, model, base_values, base_target)
    if grid_summary is None and not scenario_rows:
        raise AnalysisInputError("至少给出 grid 或 scenarios 之一：否则只有基准值，没有可比较的假设")

    gaps = []
    if base_target == 0:
        gaps.append("基准目标值为 0：变化率（delta_pct）无定义，只给绝对值")
    metrics = {"base_target": _round(base_target), "factor_count": len(factors)}
    if scenario_rows:
        metrics.update({
            "scenario_count": len(scenario_rows),
            "scenario_min": _round(min(scenario_targets)),
            "scenario_max": _round(max(scenario_targets)),
        })
    if grid_summary is not None:
        metrics.update({
            "grid_cells": grid_summary["cells"],
            "grid_min": _round(grid_summary["min"]),
            "grid_max": _round(grid_summary["max"]),
        })

    expression = _expression(model, factors)
    unit = target_unit or ""
    parts = [f"{target_name} 基准 {_fmt6(base_target)}{unit}（{model}：{expression}）"]
    if scenario_rows:
        parts.append(
            f"情景 {len(scenario_rows)} 个，目标区间 {_fmt6(min(scenario_targets))}–{_fmt6(max(scenario_targets))}{unit}"
        )
    if grid_summary is not None:
        parts.append(
            f"网格 {grid_summary['cells']} 格（{grid_summary['mode']}），"
            f"目标区间 {_fmt6(grid_summary['min'])}–{_fmt6(grid_summary['max'])}{unit}"
        )
    summary = "；".join(parts) + "。这是调用方给出的恒等式在不同假设下的取值，不是预测。"

    methodology = [
        f"因子 {len(factors)} 个、模型 {model}：{expression}",
        f"基准目标值 {_fmt6(base_target)}（由因子基准值直接求值）",
    ]
    if grid_summary is not None:
        methodology.append(
            f"网格模式 {grid_summary['mode']}：{grid_summary['cells']} 格；"
            f"区间 {_fmt6(grid_summary['min'])}–{_fmt6(grid_summary['max'])}"
        )
    if scenario_rows:
        inherited = [name for row in scenario_rows for name in row["inherited"]]
        methodology.append(
            f"情景 {len(scenario_rows)} 个；继承基准的因子值 {len(inherited)} 处（trace 里标 inherited）"
        )
    methodology.append(f"{len(gaps)} 项缺口")

    sensitivity = {
        "model": model,
        "expression": expression,
        "scenarios": scenario_rows,
        "grid": None if grid_summary is None else {
            "mode": grid_summary["mode"],
            "cells": grid_summary["cells"],
            "rows": grid_rows,
        },
    }
    payload = {
        "protocol": "capital.analysis/v1",
        "module_id": MODULE_ID,
        "module_version": MODULE_VERSION,
        "analysis_id": request.get("analysis_id"),
        "module_run_id": request.get("module_run_id"),
        "target": {"name": target_name, "unit": target_unit, "model": model, "expression": expression},
        "factors": factors,
        "parameters": {"grid_mode": params.get("grid_mode", "oat") if grid_summary is not None else None},
        "base_target": _round(base_target),
        "scenarios": scenario_rows,
        "grid": None if grid_summary is None else {
            "mode": grid_summary["mode"],
            "cells": grid_summary["cells"],
            "rows": grid_rows,
        },
        "data_gaps": gaps,
    }
    ref = context.write_output(OUTPUT_NAME, payload)
    context.log(
        f"{MODULE_ID}: {len(factors)} factors model={model} grid={0 if grid_summary is None else grid_summary['cells']} "
        f"scenarios={len(scenario_rows)}"
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
