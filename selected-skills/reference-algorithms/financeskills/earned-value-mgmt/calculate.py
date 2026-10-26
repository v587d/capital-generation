# Reference implementation — not executed.
# Source: https://github.com/GAJETOso/financeskills @ b0c6239e339c1865c54bd2bb4cd4c1974120f1b8, MIT (see selected-skills/financeskills/LICENSE).
# Original path: skills/earned-value-mgmt/scripts/calculate.py
# Moved here because the runtime tree ships Markdown only; no skill body points at this file.
# Reviewed: standard library only, no network, no filesystem writes, no subprocess, no credentials.

"""Earned value management: PV/EV/AC variances, CPI/SPI, EAC forecasts (PMI)."""
from __future__ import annotations


def variances(pv: float, ev: float, ac: float) -> dict:
    return {"cv": ev - ac, "sv": ev - pv, "cpi": ev / ac, "spi": ev / pv}


def eac_cpi(bac: float, cpi: float) -> float:
    """EAC assuming current cost performance continues."""
    return bac / cpi


def eac_atypical(bac: float, ac: float, ev: float) -> float:
    """EAC assuming remaining work at budgeted rates (variance was one-off)."""
    return ac + (bac - ev)


def eac_combined(bac: float, ac: float, ev: float, cpi: float, spi: float) -> float:
    """EAC where both cost and schedule performance affect remaining work."""
    return ac + (bac - ev) / (cpi * spi)


def tcpi(bac: float, ev: float, ac: float) -> float:
    """Cost performance needed on remaining work to hit BAC."""
    return (bac - ev) / (bac - ac)


if __name__ == "__main__":
    v = variances(pv=500_000, ev=450_000, ac=520_000)
    assert v["cv"] == -70_000 and v["sv"] == -50_000
    assert abs(v["cpi"] - 0.86538) < 1e-4 and abs(v["spi"] - 0.9) < 1e-12
    assert abs(eac_cpi(2_000_000, v["cpi"]) - 2_311_111.11) < 1.0
    assert eac_atypical(2_000_000, 520_000, 450_000) == 2_070_000
    assert abs(tcpi(2_000_000, 450_000, 520_000) - 1.0473) < 1e-3
    print(f"CPI {v['cpi']:.3f} | SPI {v['spi']:.2f} | EAC {eac_cpi(2_000_000, v['cpi']):,.0f} | OK")
