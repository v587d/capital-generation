"""Analysis-environment self-check module.

It reads the staged inputs through `context`, echoes their shape and writes a result that satisfies
the protocol. It produces no analytical conclusion on purpose: its only job is to prove that the
module protocol, the input staging and the result contract all work end to end.

Protocol: `docs/dev/senior-analysis.md` §1.9. Do not add conclusions here; add a real module instead.
"""
from __future__ import annotations


def analyze(request: dict, context) -> dict:
    datasets = []
    for item in request.get("inputs", {}).get("datasets", []):
        view = context.read_dataset(item["dataset_id"])
        datasets.append({
            "dataset_id": view["source"]["dataset_id"],
            "shape": view["shape"],
            "row_count": view["row_count"],
            "column_count": len(view["columns"]),
            "time_axis": (view.get("time_axis") or {}).get("column"),
            "truncated": view["truncated"],
        })

    profiles = []
    for item in request.get("inputs", {}).get("profiles", []):
        loaded = context.read_profile(item["profile_id"])
        profiles.append({
            "profile_id": loaded["ref"]["profile_id"],
            "dataset_id": loaded["ref"]["dataset_id"],
            "row_count": loaded["profile"]["row_count"],
        })

    note = request.get("params", {}).get("note")
    context.log(f"hello: {len(datasets)} dataset(s), {len(profiles)} profile(s), note={note!r}")

    return {
        "status": "completed",
        "summary": "分析环境自检通过：模块协议、输入读取与结果回写均可用（本模块不产出结论）。",
        "metrics": {
            "dataset_count": len(datasets),
            "profile_count": len(profiles),
            "dataset_rows": sum(item["row_count"] for item in datasets),
        },
        "claims": [],
        "assumptions": ["自检模块只回显输入形状，不解释数据含义"],
        "methodology_log": [
            "读取 request.inputs 里声明的 Dataset 与 profile",
            "按 §8.5 的视图形状回显行数、列数与时间轴",
            "回写结果，交由宿主校验",
        ],
        "sensitivity": {},
        "limitations": ["自检模块不产出分析结论，不能用于任何研究判断"],
        "data_gaps": [],
        "outputs": [],
    }
