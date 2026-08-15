"""Config loading — data is config, not code (docs/DESIGN_REVIEW.md 结构).

config/ is the single home for chains.yaml / error_map.yaml / symbols.json /
wind_tools.yaml / akshare_edb.yaml.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"


def load_yaml(name: str) -> dict[str, Any]:
    with (CONFIG_DIR / name).open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_error_map(vendor: str) -> dict[int | str, str]:
    """Vendor error code → FinError kind (docs/DEGRADATION.md: 判定表外置).

    Keys may be ints (THS business codes) or strings (HTTP status / stable codes).
    """
    data = load_yaml("error_map.yaml")
    raw = data.get(vendor, {})
    out: dict[int | str, str] = {}
    for k, v in raw.items():
        try:
            out[int(k)] = v
        except (TypeError, ValueError):
            out[str(k)] = v
    return out


def load_error_text_patterns(vendor: str) -> list[tuple[re.Pattern[str], str]]:
    """Text-sniff fallback patterns → FinError kind (LESSONS §4.5: 判定表外置).

    `text_patterns.<vendor>` in error_map.yaml; patterns are tried in order.
    """
    data = load_yaml("error_map.yaml")
    out: list[tuple[re.Pattern[str], str]] = []
    for entry in data.get("text_patterns", {}).get(vendor, []):
        out.append((re.compile(entry["pattern"], re.IGNORECASE), entry["kind"]))
    return out


def load_chains() -> dict[str, list[str]]:
    """Domain → vendor chain (internal ids: ths/akshare/wind)."""
    return load_yaml("chains.yaml")["chains"]
