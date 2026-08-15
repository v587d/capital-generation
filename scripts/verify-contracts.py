"""Contract drift check — THS adapter endpoints vs official llms-full.txt (M7).

docs/LESSONS.md §4.2: vendor contracts drift; the machine-readable contract
(https://fuyao.aicubes.cn/llms-full.txt) is the baseline. This script diffs the
endpoints the adapter actually calls against the contract and reports:
- MISSING: adapter endpoint not in the contract → vendor renamed/removed it (drift!)
- UNCOVERED: contract endpoint the adapter does not use → informational (coverage gap)
- alias match: docs may omit the /api prefix → tolerated (LESSONS §4.2)

Usage:
    uv run python scripts/verify-contracts.py           # needs network
    uv run python scripts/verify-contracts.py --offline  # cached copy
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import httpx

CONTRACT_URL = "https://fuyao.aicubes.cn/llms-full.txt"
ADAPTER = Path(__file__).resolve().parents[1] / "core" / "adapters" / "ths.py"
OFFLINE_CONTRACT = Path("/home/shawn/projects/research/ths_llms-full.txt")

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
    ap.add_argument("--offline", action="store_true", help="use cached contract copy")
    args = ap.parse_args()

    if args.offline:
        if not OFFLINE_CONTRACT.exists():
            print(f"--offline 需要缓存文件 {OFFLINE_CONTRACT}", file=sys.stderr)
            return 2
        text = OFFLINE_CONTRACT.read_text(encoding="utf-8")
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


if __name__ == "__main__":
    raise SystemExit(main())
