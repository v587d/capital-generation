"""Contract drift check — THS adapter endpoints vs official llms-full.txt (M7),
Wind adapter tools vs official tool-manifest (v0.2.0 M0/M5).

docs/LESSONS.md §4.2: vendor contracts drift; the machine-readable contract
(THS: https://fuyao.aicubes.cn/llms-full.txt; Wind: 官方 wind-skills 仓库
scripts/tool-manifest.json, 快照在 config/wind/manifest.json) is the baseline.
This script diffs what the adapters actually use against the contract and reports:
- MISSING: adapter uses something not in the contract → vendor renamed/removed it (drift!)
- UNCOVERED: contract surface the adapter does not use → informational (coverage gap)
- alias match: THS docs may omit the /api prefix → tolerated (LESSONS §4.2)

Usage:
    uv run python scripts/verify-contracts.py           # needs network
    uv run python scripts/verify-contracts.py --offline  # cached copy
    uv run python scripts/verify-contracts.py --wind     # Wind manifest diff (离线)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import httpx

from core.config import CONFIG_DIR, load_yaml

CONTRACT_URL = "https://fuyao.aicubes.cn/llms-full.txt"
ADAPTER = Path(__file__).resolve().parents[1] / "core" / "adapters" / "ths.py"
# 仓库内缓存 (CI 离线用; 仓库外缓存仅作向后兼容)
OFFLINE_CONTRACT = Path(__file__).resolve().parents[1] / "config" / "ths" / "llms-full.txt"
LEGACY_OFFLINE = Path("/home/shawn/projects/research/ths_llms-full.txt")

_ENDPOINT_RE = re.compile(r'"/?(api|dump)/[a-zA-Z0-9/_-]+"')


def adapter_endpoints() -> set[str]:
    """All /api/ and /dump/ path literals in the THS adapter."""
    src = ADAPTER.read_text(encoding="utf-8")
    return {m.group(0).strip('"') for m in _ENDPOINT_RE.finditer(src)}


def contract_endpoints(text: str) -> set[str]:
    out: set[str] = set()
    for m in re.finditer(r"(/api/[a-zA-Z0-9/_-]+|/dump/[a-zA-Z0-9/_-]+)", text):
        out.add(m.group(1))
    return out


def normalize(p: str) -> str:
    """/dump/x → /api/dump/x (docs may omit the /api prefix — alias match)."""
    return p if p.startswith("/api/") else f"/api{p}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="use cached THS contract copy")
    ap.add_argument(
        "--wind", action="store_true", help="Wind 契约漂移检查 (本地官方 manifest 快照, 无需网络)"
    )
    args = ap.parse_args()

    if args.wind:
        return verify_wind()

    if args.offline:
        path = OFFLINE_CONTRACT if OFFLINE_CONTRACT.exists() else LEGACY_OFFLINE
        if not path.exists():
            print(f"--offline 需要缓存文件 {OFFLINE_CONTRACT}", file=sys.stderr)
            return 2
        text = path.read_text(encoding="utf-8")
    else:
        try:
            resp = httpx.get(CONTRACT_URL, timeout=30)
            resp.raise_for_status()
            text = resp.text
        except httpx.HTTPError as e:
            print(f"拉取契约失败 (网络): {e}", file=sys.stderr)
            return 2

    contract = {normalize(p) for p in contract_endpoints(text)}
    used = adapter_endpoints()

    missing = sorted(used - contract)
    # 过滤 markdown 链接前缀噪音 (如 /api/a-share-index 这种 2 段路径)
    uncovered = sorted(p for p in (contract - used) if len(p.split("/")) >= 4)

    if missing:
        print("❌ DRIFT — 适配器在用但契约里没有 (上游改名/下线, 需立即处理):")
        for p in missing:
            print(f"   {p}")
    else:
        print("✅ 无漂移: 适配器全部端点都在官方契约中")

    print(f"\nℹ️  契约有但适配器未使用 ({len(uncovered)} 个, 覆盖率缺口, 供参考):")
    for p in uncovered:
        print(f"   {p}")

    return 1 if missing else 0


def verify_wind() -> int:
    """Wind: config/wind_tools.yaml 使用的工具 ⊆ 官方 tool-manifest 快照."""
    cfg = load_yaml("wind_tools.yaml")
    used: set[str] = set()
    for entry in cfg["tool_by_domain"].values():
        if isinstance(entry, dict) and "tool" in entry:
            used.add(entry["tool"])
        else:
            for e in entry.values():
                if isinstance(e, dict) and "tool" in e:
                    used.add(e["tool"])

    manifest_path = CONFIG_DIR / "wind" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    official = {t for tools in manifest.values() for t in tools}

    missing = sorted(used - official)
    print(f"Wind 契约基线: {manifest_path} (官方 wind-skills tool-manifest 快照)")
    print(f"适配器使用 {len(used)} 个工具: {sorted(used)}")
    if missing:
        print("❌ DRIFT — 适配器在用但官方 manifest 没有 (工具改名/下线, 需立即处理):")
        for t in missing:
            print(f"   {t}")
    else:
        print("✅ 无漂移: 适配器全部 Wind 工具都在官方 manifest 中")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
