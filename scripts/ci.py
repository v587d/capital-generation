"""本地一体化 CI — v0.3.0 M6 (仓库无 remote, 以本地 gate 代替 GitHub Actions).

流程 (全部离线, 无实时网络):
  1. ruff check + ruff format --check
  2. pytest 全量 (fixture/golden 回放; kline golden 显式 skip)
  3. verify-contracts --offline (THS: config/ths/llms-full.txt 仓库内缓存; Wind: manifest 快照)
  4. symbols 快照新鲜度 (informational, 不 gate)

用法:
    uv run python scripts/ci.py            # 全量
    uv run python scripts/ci.py --quick    # 仅 ruff + 快速测试 (pre-commit 用)
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
STALE_WARN_DAYS = 30


def sh(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, "-m", *args], cwd=REPO, capture_output=True, text=True)


def sh_script(*args: str) -> subprocess.CompletedProcess[str]:
    """直接跑 scripts/*.py (非包模块, 不能 -m)."""
    return subprocess.run([sys.executable, *args], cwd=REPO, capture_output=True, text=True)


def run_step(name: str, proc: subprocess.CompletedProcess[str], *, gate: bool = True) -> bool:
    ok = proc.returncode == 0
    print(f"{'✅' if ok else '❌'} {name}" + ("" if ok else f" (exit={proc.returncode})"))
    if not ok and (proc.stdout or proc.stderr):
        tail = (proc.stdout or "") + (proc.stderr or "")
        for line in tail.strip().splitlines()[-12:]:
            print(f"    {line}")
    if gate and not ok:
        print(f"✋ {name} 失败 — CI 中断", file=sys.stderr)
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="仅 ruff + 快速测试")
    args = ap.parse_args()

    ok = True
    ok &= run_step("ruff check", sh("ruff", "check", "."))
    ok &= run_step("ruff format --check", sh("ruff", "format", "--check", "."))
    ok &= run_step("pytest (离线全量)", sh("pytest", "tests", "-q"))
    if not args.quick:
        ok &= run_step(
            "verify-contracts --offline (THS)",
            sh_script("scripts/verify-contracts.py", "--offline"),
        )
        ok &= run_step(
            "verify-contracts --wind", sh_script("scripts/verify-contracts.py", "--wind")
        )

    # symbols 新鲜度 (informational)
    try:
        sys.path.insert(0, str(REPO))
        from core.domain.symbols import snapshot_age_days

        age = snapshot_age_days()
        if age is None:
            print("⚠️  config/symbols.json 缺失或不可解析 (运行 scripts/sync-symbols.py)")
        elif age >= STALE_WARN_DAYS:
            print(f"⚠️  symbols.json 距今 {age} 天, 建议同步 (--if-stale {STALE_WARN_DAYS})")
        else:
            print(f"ℹ️  symbols.json 距今 {age} 天")
    except Exception:  # noqa: BLE001 — informational, 不 gate
        pass

    print("\nCI " + ("✅ 全绿" if ok else "❌ 有失败"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
