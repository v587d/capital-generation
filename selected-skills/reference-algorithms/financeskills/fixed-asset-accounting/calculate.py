# Reference implementation — not executed.
# Source: https://github.com/GAJETOso/financeskills @ b0c6239e339c1865c54bd2bb4cd4c1974120f1b8, MIT (see selected-skills/financeskills/LICENSE).
# Original path: skills/fixed-asset-accounting/scripts/calculate.py
# Moved here because the runtime tree ships Markdown only; no skill body points at this file.
# Reviewed: standard library only, no network, no filesystem writes, no subprocess, no credentials.

"""Fixed assets: SL / DDB / units-of-production depreciation, disposal gain or loss."""
from __future__ import annotations


def straight_line(cost: float, residual: float, life_years: float) -> float:
    return (cost - residual) / life_years


def double_declining_schedule(cost: float, residual: float, life_years: int) -> list[float]:
    """Annual DDB charges; never depreciates below residual."""
    rate, nbv, out = 2.0 / life_years, cost, []
    for _ in range(life_years):
        charge = min(nbv * rate, nbv - residual)
        out.append(max(charge, 0.0))
        nbv -= out[-1]
    return out


def units_of_production(cost: float, residual: float, total_units: float, units_this_period: float) -> float:
    return (cost - residual) / total_units * units_this_period


def disposal_result(proceeds: float, cost: float, accumulated_depreciation: float) -> float:
    """Positive = gain, negative = loss."""
    return proceeds - (cost - accumulated_depreciation)


if __name__ == "__main__":
    assert straight_line(110_000, 10_000, 5) == 20_000
    ddb = double_declining_schedule(100_000, 10_000, 5)
    assert abs(ddb[0] - 40_000) < 1e-9 and abs(sum(ddb) - 90_000) < 1e-9
    assert abs(units_of_production(110_000, 10_000, 200_000, 35_000) - 17_500) < 1e-9
    assert disposal_result(30_000, 110_000, 85_000) == 5_000
    print(f"SL: 20,000 | DDB y1: {ddb[0]:,.0f} | disposal gain: 5,000 | OK")
