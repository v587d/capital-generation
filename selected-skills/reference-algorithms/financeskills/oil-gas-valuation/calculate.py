# Reference implementation — not executed.
# Source: https://github.com/GAJETOso/financeskills @ b0c6239e339c1865c54bd2bb4cd4c1974120f1b8, MIT (see selected-skills/financeskills/LICENSE).
# Original path: skills/oil-gas-valuation/scripts/calculate.py
# Moved here because the runtime tree ships Markdown only; no skill body points at this file.
# Reviewed: standard library only, no network, no filesystem writes, no subprocess, no credentials.

"""Oil & gas: exponential decline curves, PV-10, reserves-based valuation."""
from __future__ import annotations


def decline_production(initial_rate: float, decline: float, years: int) -> list[float]:
    """Annual production volumes under constant exponential decline."""
    return [initial_rate * (1 - decline) ** t for t in range(years)]


def netback(price: float, royalty_pct: float, opex_per_unit: float) -> float:
    return price * (1 - royalty_pct) - opex_per_unit


def pv10(volumes: list[float], netback_per_unit: float, rate: float = 0.10) -> float:
    """SEC-style PV-10: discounted net cashflows from year 1."""
    return sum(v * netback_per_unit / (1 + rate) ** t
               for t, v in enumerate(volumes, 1))


def reserves_to_production(reserves: float, annual_production: float) -> float:
    """R/P life in years."""
    return reserves / annual_production


if __name__ == "__main__":
    vols = decline_production(1_000_000, 0.10, 10)
    assert vols[0] == 1_000_000 and abs(vols[1] - 900_000) < 1e-6
    nb = netback(70.0, 0.15, 18.0)
    assert abs(nb - 41.5) < 1e-12
    v = pv10(vols, nb)
    manual = sum(x * nb / 1.1 ** t for t, x in enumerate(vols, 1))
    assert abs(v - manual) < 1e-6
    assert abs(reserves_to_production(50_000_000, 1_000_000) - 50.0) < 1e-12
    print(f"netback {nb:.2f}/bbl | PV-10 {v:,.0f} | OK")
